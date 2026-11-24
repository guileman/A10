// Aerodinámica del A-10 por coeficientes (ejes convencionales: X proa, Y derecha, Z abajo).
// Ala recta de alargamiento 6,5 (perfil grueso NACA 67xx): CLα por DATCOM (Helmbold + Prandtl-Glauert),
// redondeo cuadrático del CL antes de la pérdida y caída MODERADA y suave pasada la pérdida (sin giros
// violentos: ΔCl de caída de ala chico, filtrado en el tiempo y con amortiguamiento de alabeo conservado).
// Resistencia: CD0 alto (avión "sucio") + pilones + cargas + inducida (Oswald, efecto suelo de Wieselsberger)
// + onda + flaps + tren + decelerones abiertos.
import { DEG, clamp, smoothstep } from './math.js';

export function makeA10Aero(p) {
  const A = p.b * p.b / p.S;
  const k = 1 / (Math.PI * A * p.oswald);
  const tanL = Math.tan(p.sweepQcDeg * DEG);
  function CLalpha(M) {
    const Mm = Math.min(M, 0.85);
    const beta2 = 1 - Mm * Mm;
    return 2 * Math.PI * A / (2 + Math.sqrt(A * A * (beta2 + tanL * tanL) / 0.95 + 4)); // κ = 0,95
  }
  return { A, k, CLalpha, p };
}

/** CL estático (sin pérdida dinámica) y su derivada, para un α y estado de flaps; útil para trim y pruebas. */
export function liftCurve(model, alpha, mach, flapIdxF, geCL = 1) {
  const p = model.p;
  const CLa = model.CLalpha(mach) * geCL;
  const fl = flapInterp(p.flaps, flapIdxF);
  const aS = (p.alphaStallDeg + fl.dAlphaStallDeg) * DEG * (1 - 0.25 * clamp((mach - 0.35) / 0.4, 0, 1));
  const knee = p.kneeDeg * DEG;
  const a1 = aS - knee;
  const CL0 = p.CL0 + fl.dCL;
  // Tramo lineal hasta a1; parábola de a1 a aS con pendiente nula en aS (CLmax = CL(a1) + CLa·knee/2).
  let CLs;
  if (alpha <= a1 && alpha >= -a1) CLs = CL0 + CLa * alpha;
  else if (alpha > a1) { const d = Math.min(alpha, aS) - a1; CLs = CL0 + CLa * a1 + CLa * (d - d * d / (2 * knee)); }
  else { const d = Math.min(-alpha, aS) - a1; CLs = CL0 - CLa * a1 - CLa * (d - d * d / (2 * knee)); }
  const CLmax = CL0 + CLa * (a1 + knee / 2);
  return { CLs, CLmax, aS, CLa };
}

function flapInterp(f, x) {
  const i = clamp(Math.floor(x), 0, 1), t = clamp(x - i, 0, 1);
  const L = (arr) => arr[i] + (arr[i + 1] - arr[i]) * t;
  return { dCL: L(f.dCL), dCD: L(f.dCD), dCm: L(f.dCm), dAlphaStallDeg: L(f.dAlphaStallDeg) };
}

/**
 * in: { V, alpha, beta, pr, qr, rr (rad/s conv.), alphaDot, mach, flapIdxF (0..2 continuo), gearExt, gearTransit,
 *       speedbrakeFrac 0..1, elevDeg (+ = borde de fuga abajo, proa abajo), aileronDeg (+ = alabeo derecha),
 *       rudderDeg (+ = proa derecha), hWing (m sobre el suelo), wingDrop (−1..1 filtrado), storesCD }
 */
export function computeA10Aero(model, inp, qbar, out) {
  const p = model.p;
  const { V, alpha, beta, mach } = inp;
  const fl = flapInterp(p.flaps, inp.flapIdxF);
  let phi = 1, geCL = 1;
  if (p.groundEffect && inp.hWing < p.b * 1.5) {
    const r = 16 * Math.max(inp.hWing, 0.1) / p.b; phi = r * r / (1 + r * r);
    geCL = 1 + 0.10 * (1 - phi);
  }
  const lc = liftCurve(model, alpha, mach, inp.flapIdxF, geCL);
  const de = inp.elevDeg * DEG;
  const sbF = clamp(inp.speedbrakeFrac, 0, 1);
  // Mezcla post-pérdida suave (positiva y negativa).
  const w = p.postStallWidthDeg * DEG;
  const aSn = -(lc.aS - 2 * DEG);
  const sPos = 1 / (1 + Math.exp(-(alpha - lc.aS - w) / w));
  const sNeg = 1 / (1 + Math.exp((alpha - aSn + w) / w));
  const sig = Math.max(sPos, sNeg);
  const CLpost = p.postStallCLfrac * lc.CLmax * Math.sin(2 * Math.max(Math.abs(alpha), lc.aS)) / Math.sin(2 * lc.aS) * Math.sign(alpha || 1);
  const CLwing = (1 - sig) * lc.CLs + sig * CLpost;
  const CL = CLwing + p.CLDeltaE * de + p.speedbrake.dCL * sbF;
  // Resistencia.
  const Mc = p.mach.Mcrit;
  const wave = mach > Mc ? p.mach.waveK * Math.pow(mach - Mc, 4) : 0;
  const CLi = (1 - sig) * CLwing;
  const CD = p.CD0 + p.pylonsCD0 + (inp.storesCD || 0) + wave + model.k * phi * CLi * CLi +
    sig * 1.1 * Math.sin(alpha) * Math.sin(alpha) + fl.dCD + p.gear.dCD * inp.gearExt +
    (inp.gearTransit ? p.gear.dCDtransit : 0) + p.speedbrake.dCD * sbF + 0.45 * Math.sin(beta) * Math.sin(beta);
  // Cabeceo.
  const CLa = lc.CLa;
  const c2V = p.cbar / (2 * Math.max(V, 1));
  const Cm = p.Cm0 - CLa * p.staticMargin * alpha + p.CmDeltaE * de + c2V * (p.CmQ * inp.qr + p.CmAlphaDot * inp.alphaDot) +
    fl.dCm + p.speedbrake.dCm * sbF - sig * 0.10 * Math.sin(alpha);
  // Lateral-direccional. El alerón pierde algo de eficacia en pérdida pero el amortiguamiento de alabeo se
  // conserva (ala recta: no hay autorrotación violenta).
  const b2V = p.b / (2 * Math.max(V, 1));
  const da = inp.aileronDeg * DEG, dr = inp.rudderDeg * DEG;
  const CY = p.CYbeta * beta - p.CYDeltaR * dr; // timón a la derecha: fuerza de deriva hacia la izquierda
  const Cl = p.Clbeta * beta + b2V * (p.Clp * (1 - 0.3 * sig) * inp.pr + (p.Clr + CLwing / 6) * inp.rr) +
    p.ClDeltaA * da * (1 - 0.35 * sig) - p.ClDeltaR * dr + p.wingDrop.dCl * (inp.wingDrop || 0);
  const Cn = p.Cnbeta * beta * (1 - 0.3 * sig) + b2V * ((p.Cnp - CLwing / 10) * inp.pr + p.Cnr * inp.rr) +
    p.CnDeltaA * da - p.CnDeltaR * dr;

  const qS = qbar * p.S;
  const L = CL * qS, D = CD * qS, Y = CY * qS;
  const ca = Math.cos(alpha), sa = Math.sin(alpha), cb = Math.cos(beta), sb = Math.sin(beta);
  out.X = -D * ca * cb + L * sa;
  out.Y = -D * sb + Y;
  out.Z = -D * sa * cb - L * ca;
  out.Lm = Cl * qS * p.b; out.Mm = Cm * qS * p.cbar; out.Nm = Cn * qS * p.b;
  out.CL = CL; out.CD = CD; out.Cm = Cm; out.CY = CY; out.Cl = Cl; out.Cn = Cn;
  out.CLmax = lc.CLmax; out.alphaStall = lc.aS;
  out.stallBlend = sig; out.stalled = sPos > 0.5 || sNeg > 0.5;
  out.buffet = smoothstep(lc.aS - 3 * DEG, lc.aS, Math.abs(alpha)); // para efectos/sonido de sacudida
  out.inGroundEffect = phi < 0.9;
  return out;
}
