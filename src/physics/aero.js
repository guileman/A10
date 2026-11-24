// Aerodinámica de cuerpo rígido por coeficientes (ejes convencionales: X proa, Y derecha, Z abajo).
// CLα por DATCOM (Helmbold-Diederich con Prandtl-Glauert), pérdida con mezcla sigmoide a placa plana,
// resistencia parabólica + onda (transónico), flaps/tren/aerofreno, estabilizador móvil total, alerones,
// timón, derivadas de amortiguamiento y efecto suelo (Wieselsberger).
import { DEG, clamp, smoothstep } from './math.js';

export function makeAero(p) {
  const A = p.b * p.b / p.S;
  const k = 1 / (Math.PI * A * p.oswald);
  const tanL = Math.tan((p.sweepQcDeg - 4) * DEG); // flecha a media cuerda ≈ ¼ cuerda − 4° (ESTIMADO)
  function CLalpha(M) {
    const Mm = Math.min(M, 0.92);
    const beta2 = 1 - Mm * Mm;
    const base = 2 * Math.PI * A / (2 + Math.sqrt(A * A * (beta2 + tanL * tanL) + 4));
    return base * (1 - 0.35 * smoothstep(0.92, 1.1, M));
  }
  return { A, k, CLalpha, p };
}

/**
 * in: { V, alpha, beta, pr, qr, rr (rad/s, convencional), alphaDot, mach, flapsDeg, gearExt, gearTransit,
 *       airbrakeDeg, stabDeg (+ borde de fuga abajo), aileronDeg (+ = alabeo a la derecha),
 *       rudderDeg (+ = proa a la derecha), hWing (m sobre el suelo, Infinity si lejos), wingDropSign }
 * out: coeficientes y fuerzas/momentos en ejes convencionales (N, N·m) y flags.
 */
export function computeAero(model, inp, qbar, out) {
  const p = model.p;
  const { V, alpha, beta, mach } = inp;
  const fl = inp.flapsDeg / 50;
  const CLa = model.CLalpha(mach);
  // Pérdida: ángulo de pérdida baja con flaps y con Mach (ESTIMADO).
  const aStall = (p.alphaStallDeg + p.flaps.dAlphaStallPer50Deg * fl) * DEG * (1 - 0.35 * clamp((mach - 0.3) / 0.6, 0, 1));
  const aStallNeg = -12 * DEG;
  // Efecto suelo aerodinámico.
  let phi = 1, geCL = 1;
  if (p.groundEffect && inp.hWing < p.b * 1.5) {
    const r = 16 * Math.max(inp.hWing, 0.1) / p.b; phi = r * r / (1 + r * r);
    geCL = 1 + 0.12 * (1 - phi);
  }
  const ds = inp.stabDeg * DEG;
  const CLlin = (p.CL0 + CLa * alpha) * geCL + p.flaps.dCLper50 * fl + p.CLDeltaS * ds;
  // Mezcla post-pérdida.
  const w = 1.2 * DEG;
  const sPos = 1 / (1 + Math.exp(-(alpha - aStall) / w));
  const sNeg = 1 / (1 + Math.exp((alpha - aStallNeg) / w));
  const sig = Math.max(sPos, sNeg);
  const CLflat = p.stallBreak.postStallCLmax * Math.sin(2 * alpha) + p.flaps.dCLper50 * fl * 0.5;
  const CL = (1 - sig) * CLlin + sig * CLflat;
  // Resistencia.
  const Mc = p.mach.Mcrit;
  const wave = mach > Mc ? p.mach.waveK * Math.pow(mach - Mc, 4) / (1 + 8 * Math.max(mach - 1.0, 0)) : 0;
  const CLi = (1 - sig) * CLlin;
  const abFrac = inp.airbrakeDeg / p.airbrake.maxDeg;
  const CD = p.CD0 + wave + model.k * phi * CLi * CLi + sig * 1.25 * Math.sin(alpha) * Math.sin(alpha) +
    p.flaps.dCDper50 * fl * fl + p.gear.dCD * inp.gearExt + (inp.gearTransit ? p.gear.dCDtransit : 0) +
    p.airbrake.dCDmax * abFrac + 0.5 * Math.abs(Math.sin(beta)) * Math.abs(Math.sin(beta));
  // Cabeceo.
  const cEff = 1 - 0.3 * smoothstep(0.85, 1.0, mach);
  const Cma = -CLa * p.staticMargin * (1 + 0.6 * smoothstep(0.85, 1.0, mach)); // corrimiento del CA en transónico
  const c2V = p.cbar / (2 * Math.max(V, 1));
  const Cm = p.Cm0 + Cma * alpha + p.CmDeltaS * ds * cEff + c2V * (p.CmQ * inp.qr + p.CmAlphaDot * inp.alphaDot) +
    p.flaps.dCmPer50 * fl + p.airbrake.dCmMax * abFrac - sig * 0.08 * Math.sin(alpha);
  // Lateral-direccional.
  const b2V = p.b / (2 * Math.max(V, 1));
  const da = inp.aileronDeg * DEG, dr = inp.rudderDeg * DEG;
  const CY = p.CYbeta * beta - p.CYDeltaR * dr;
  const lowSpeedFade = 1 - 0.5 * sig;
  const Cl = p.Clbeta * beta + b2V * (p.Clp * inp.pr + (p.Clr + CL / 4) * inp.rr) + (p.ClDeltaA * da) * lowSpeedFade * cEff -
    p.ClDeltaR * dr + sig * p.stallBreak.wingDropCl * (inp.wingDropSign || 0);
  const Cn = p.Cnbeta * beta * (1 - 0.4 * sig) + b2V * ((p.Cnp - CL / 8) * inp.pr + p.Cnr * inp.rr) + p.CnDeltaA * da + Math.abs(p.CnDeltaR) * dr;

  const qS = qbar * p.S;
  const L = CL * qS, D = CD * qS, Y = CY * qS;
  // Direcciones: v̂ en ejes convencionales; sustentación ⟂ v̂ en plano X-Z.
  const ca = Math.cos(alpha), sa = Math.sin(alpha), cb = Math.cos(beta), sb = Math.sin(beta);
  out.X = -D * ca * cb + L * sa;
  out.Y = -D * sb + Y;
  out.Z = -D * sa * cb - L * ca;
  out.Lm = Cl * qS * p.b; out.Mm = Cm * qS * p.cbar; out.Nm = Cn * qS * p.b;
  out.CL = CL; out.CD = CD; out.Cm = Cm; out.CY = CY; out.Cl = Cl; out.Cn = Cn;
  out.stalled = sPos > 0.5 || sNeg > 0.5; out.stallBlend = sig;
  out.alphaStall = aStall; out.inGroundEffect = phi < 0.9;
  return out;
}
