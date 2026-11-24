// Tren de aterrizaje: 4 unidades (proa, principal de 2 neumáticos, estabilizadores de punta de ala) con
// suspensión por unidad:
//  - brazo pivotante (cinemática exacta en el plano x-y del cuerpo; ventaja mecánica MA(u) = ds/du variable)
//  - amortiguador oleoneumático: resorte de gas politrópico F = A[p0 (V0/(V0−A s))^n − patm]
//    + amortiguación hidráulica por orificio F = c_q ṡ|ṡ| (rebote c_q·k_reb) + término lineal pequeño
//  - masa no suspendida con 1 GDL (recorrido vertical de eje u), integración semi-implícita
//  - neumático: rigidez/amortiguación radial con tope de llanta, deslizamiento longitudinal/lateral
//    combinado (elipse de fricción con saturación suave), μ por superficie seca/mojada, rodadura
//  - rueda con inercia y giro (spin) integrados implícitamente; frenos con anti-deslizamiento opcional;
//    rueda de proa direccionable; estabilizadores de ala con rueda loca (castor).
import { DEG, G0, clamp, interp, qRotate, cross, dot, smoothstep } from './math.js';
import { surfaceFriction } from './ground.js';

const N_TAB = 48;
export const GEAR_IDS = ['nose', 'main', 'outriggerL', 'outriggerR'];

export class GearUnit {
  constructor(id, geom, up, gp) {
    this.id = id; this.geom = geom; this.up = up; this.gp = gp;
    this.u = 0; this.uDot = 0; this.steerDeg = 0; this.contact = false; this.loadN = 0;
    this.tires = geom.tireOffsets.map((zOff) => ({ zOff, spin: 0, omega: 0, contact: false, N: 0, slipLong: 0, slipLat: 0, skid: false, defl: 0, brakeT: 0, surface: 4, pos: [0, 0, 0] }));
    this.wheelRadius = geom.wheelRadius;
  }

  /**
   * Diseña cinemática y amortiguador para que, con carga vertical estática W (N), la unidad quede con el
   * eje en `axleStatic` (marco modelo) y recorrido estático staticFrac·travel.
   */
  design(axleStatic, W, dtSub) {
    const up = this.up, gp = this.gp, g = this.geom;
    this.travel = up.travel;
    const uS = up.staticFrac * up.travel;
    this.uStatic = uS;
    const sx = up.pivotForward ? 1 : -1;
    let L, aS, P;
    if (g.pivot) {
      P = [g.pivot[0], g.pivot[1]];
      L = Math.hypot(axleStatic[0] - P[0], axleStatic[1] - P[1]);
      aS = Math.asin(clamp((P[1] - axleStatic[1]) / L, -0.99, 0.99));
    } else {
      aS = up.armStaticDeg * DEG;
      L = g.armLength || up.armLength;
      L = Math.max(L, uS / (1 - Math.sin(aS)) * 1.08, (up.travel - uS) / (Math.sin(aS) + 0.85));
      P = [axleStatic[0] + sx * L * Math.cos(aS), axleStatic[1] + L * Math.sin(aS)];
    }
    this.sx = sx; this.L = L; this.P = P; this.aStatic = aS;
    this.yExt = axleStatic[1] - uS;
    this.zAxle = axleStatic[2];
    const a = 0.6 * L;
    let Q = [g.attach[0], g.attach[1]];
    const pin = (alpha) => [P[0] - sx * a * Math.cos(alpha), P[1] - a * Math.sin(alpha)];
    const alphaOf = (u) => Math.asin(clamp((P[1] - (this.yExt + u)) / L, -1, 1));
    const lenOf = (u, Qp) => { const s = pin(alphaOf(u)); return Math.hypot(Qp[0] - s[0], Qp[1] - s[1]); };
    // Comprobación de ventaja mecánica; si el punto de anclaje supuesto no da una MA útil, se recoloca el
    // anclaje superior sobre el perno inferior (documentado: los anclajes del JSON son supuestos).
    const maOf = (Qp) => (lenOf(uS - 0.005, Qp) - lenOf(uS + 0.005, Qp)) / 0.01;
    this.attachRelocated = false;
    if (!(maOf(Q) > 0.2)) { const s = pin(aS); Q = [s[0] + 0.1 * sx, s[1] + 0.9]; this.attachRelocated = true; }
    this.Q = Q;
    const l0 = lenOf(0, Q);
    this.tab = [];
    for (let i = 0; i <= N_TAB; i++) {
      const u = (i / N_TAB) * up.travel;
      const al = alphaOf(u);
      const s = l0 - lenOf(u, Q);
      const ma = (lenOf(u - 1e-4, Q) - lenOf(u + 1e-4, Q)) / 2e-4;
      this.tab.push({ u, s, ma: Math.max(ma, 0.05), alpha: al, x: P[0] - sx * L * Math.cos(al) });
    }
    this.sTab = this.tab.map((t) => [t.u, t.s]);
    this.maTab = this.tab.map((t) => [t.u, t.ma]);
    this.xTab = this.tab.map((t) => [t.u, t.x]);
    this.alTab = this.tab.map((t) => [t.u, t.alpha]);
    // Amortiguador.
    const maS = interp(this.maTab, uS);
    const Fst = W / maS;
    const pst = gp.staticPressurePa, patm = gp.atmPa, n = gp.gasN;
    const A = Fst / (pst - patm);
    const Stot = interp(this.sTab, up.travel), sSt = interp(this.sTab, uS);
    const rr = Math.pow(up.fullToStaticRatio ?? gp.fullToStaticRatio, 1 / n);
    const V0 = A * (rr * Stot - sSt) / (rr - 1);
    const p0 = pst * Math.pow((V0 - A * sSt) / V0, n);
    Object.assign(this, { A, V0, p0, Stot, sStatic: sSt, Fst, W, maStatic: maS });
    this.cq = Fst / Math.pow(maS * gp.designSinkMs, 2);
    const dFds = n * A * p0 * Math.pow(V0, n) * A / Math.pow(V0 - A * sSt, n + 1);
    const kw = maS * maS * dFds;
    this.kWheelStatic = kw;
    this.clin = 2 * gp.zetaLinear * Math.sqrt(kw * W / G0) / (maS * maS);
    this.mu_ = up.unsprungKg;
    this.kStop = 1.5 * this.mu_ / (dtSub * dtSub);
    this.cStop = 0.6 * this.mu_ / dtSub;
    this.u = uS; this.uDot = 0;
    return this;
  }
  gasForce(s) {
    const sMax = this.Stot * 1.02;
    const sc = Math.min(s, sMax);
    return this.A * (this.p0 * Math.pow(this.V0 / (this.V0 - this.A * sc), this.gp.gasN) - this.gp.atmPa);
  }
  /** Fuerza vertical (cuerpo) que la pata ejerce sobre la rueda hacia arriba(+)/abajo(−) y su pendiente en uDot. */
  strutOnWheel(u, uDot) {
    const uc = clamp(u, 0, this.travel);
    const ma = interp(this.maTab, uc);
    const s = interp(this.sTab, uc);
    const sd = ma * uDot;
    let Fh = sd >= 0 ? this.cq * sd * sd : -this.cq * this.gp.reboundRatio * sd * sd;
    Fh += this.clin * sd;
    let F = -(this.gasForce(s) + Fh) * ma; // empuja la rueda hacia abajo
    let c = (2 * this.cq * Math.abs(sd) * (sd >= 0 ? 1 : this.gp.reboundRatio) + this.clin) * ma * ma;
    if (u < 0) { F += this.kStop * (-u) - this.cStop * uDot; c += this.cStop; }
    if (u > this.travel) { F -= this.kStop * (u - this.travel) + this.cStop * uDot; c += this.cStop; }
    return { F, c, ma, s };
  }
  /** Posición del eje en marco modelo según u y extensión del tren (0 = recogido). */
  axleModel(out, ext) {
    const uc = clamp(this.u, 0, this.travel);
    out[0] = interp(this.xTab, uc);
    out[1] = this.yExt + this.u + (1 - ext) * 0.9;
    out[2] = this.zAxle;
    return out;
  }
  armAngleDeg() { return (interp(this.alTab, clamp(this.u, 0, this.travel)) - this.aStatic) / DEG; }
}

const _w = [0, 0, 0], _r = [0, 0, 0], _vc = [0, 0, 0], _n = [0, 0, 0], _f = [0, 0, 0], _rt = [0, 0, 0], _tmp = [0, 0, 0], _upw = [0, 0, 0], _fb = [0, 0, 0], _F = [0, 0, 0], _m = [0, 0, 0], _rb = [0, 0, 0];

/**
 * Calcula fuerzas de una unidad y avanza sus estados internos (u, spin, dirección) un subpaso.
 * ctx: { pos, vel, quat, omegaW (mundo), cg, ext, locked, world, wetness, dt, brake, parking, antiSkid,
 *        yawCmd, gs (vel. suelo), Fw (acum. fuerza mundo), Tw (acum. momento mundo respecto del CG) }
 */
export function stepGearUnit(unit, ctx, axleModelTmp) {
  const up = unit.up, gp = unit.gp, dt = ctx.dt;
  const q = ctx.quat;
  qRotate(_upw, q, [0, 1, 0]);
  // Dirección.
  if (!up.castor && unit.id === 'nose') {
    const lim = up.steerMaxDeg + (up.steerHighSpeedDeg - up.steerMaxDeg) * smoothstep(2, 12, ctx.gs);
    const tgt = clamp(ctx.yawCmd, -1, 1) * lim;
    unit.steerDeg += clamp(tgt - unit.steerDeg, -up.steerRateDegS * dt, up.steerRateDegS * dt);
  }
  unit.axleModel(axleModelTmp, ctx.ext);
  const r = unit.wheelRadius;
  let Nup = 0, cUp = 0, load = 0, anyContact = false;
  const steer = unit.steerDeg * DEG;
  _fb[0] = Math.cos(steer); _fb[1] = 0; _fb[2] = Math.sin(steer);
  qRotate(_f, q, _fb);
  const brakeIn = up.brake ? Math.max(ctx.brake, ctx.parking ? 1 : 0) : 0;
  for (const t of unit.tires) {
    t.contact = false; t.N = 0; t.skid = false; t.brakeT = 0;
    _rb[0] = axleModelTmp[0] - ctx.cg[0]; _rb[1] = axleModelTmp[1] - ctx.cg[1]; _rb[2] = axleModelTmp[2] + t.zOff - ctx.cg[2];
    qRotate(_r, q, _rb);
    _w[0] = ctx.pos[0] + _r[0]; _w[1] = ctx.pos[1] + _r[1]; _w[2] = ctx.pos[2] + _r[2];
    t.pos[0] = _w[0]; t.pos[1] = _w[1]; t.pos[2] = _w[2];
    if (ctx.ext < 0.999) { t.omega *= Math.exp(-dt * 2); t.spin += t.omega * dt; continue; }
    const h = ctx.world.height(_w[0], _w[2]);
    if (_w[1] - h > r + 0.5) { t.omega *= Math.exp(-dt * 0.3); t.spin += t.omega * dt; continue; }
    ctx.world.normal(_w[0], _w[2], _n);
    const d = (_w[1] - h) * _n[1];
    const defl = r - d;
    t.defl = Math.max(defl, 0);
    if (defl <= 0) { t.omega *= Math.exp(-dt * 0.3); t.spin += t.omega * dt; continue; }
    // Punto de contacto y su velocidad (incluye velocidad relativa del eje uDot).
    _rt[0] = _r[0] - _n[0] * d; _rt[1] = _r[1] - _n[1] * d; _rt[2] = _r[2] - _n[2] * d;
    cross(_vc, ctx.omegaW, _rt);
    _vc[0] += ctx.vel[0] + _upw[0] * unit.uDot; _vc[1] += ctx.vel[1] + _upw[1] * unit.uDot; _vc[2] += ctx.vel[2] + _upw[2] * unit.uDot;
    const vn = dot(_vc, _n);
    let N = up.tireK * defl - up.tireC * vn;
    if (defl > up.tireMaxDefl) N += 10 * up.tireK * (defl - up.tireMaxDefl);
    if (N < 0) N = 0;
    const sf = surfaceFriction(ctx.world.surface(_w[0], _w[2]), ctx.wetness);
    t.surface = ctx.world.surface(_w[0], _w[2]);
    // Ejes de la rueda sobre el plano del suelo.
    const fn = dot(_f, _n);
    _tmp[0] = _f[0] - fn * _n[0]; _tmp[1] = _f[1] - fn * _n[1]; _tmp[2] = _f[2] - fn * _n[2];
    const fl = Math.hypot(_tmp[0], _tmp[1], _tmp[2]) || 1;
    _tmp[0] /= fl; _tmp[1] /= fl; _tmp[2] /= fl;
    const fx = _tmp[0], fy = _tmp[1], fz = _tmp[2];
    // derecha = adelante × normal
    const rx = fy * _n[2] - fz * _n[1], ry = fz * _n[0] - fx * _n[2], rz = fx * _n[1] - fy * _n[0];
    const vLong = _vc[0] * fx + _vc[1] * fy + _vc[2] * fz;
    const vLat = _vc[0] * rx + _vc[1] * ry + _vc[2] * rz;
    const rEff = r - t.defl / 3;
    const denom = Math.max(Math.abs(vLong), 3);
    const Ck = 12 * N, Ca = (up.castor ? 0.6 : 8) * N;
    const muN = sf.mu * N;
    // Giro de rueda implícito.
    const I = up.wheelInertia;
    const slip0 = (t.omega * rEff - vLong) / denom;
    let FxLin = Ck * slip0;
    const FyLin = -Ca * Math.atan2(vLat, denom) * (up.castor ? 0.1 : 1);
    let tot = Math.hypot(FxLin, FyLin);
    let sat = tot > 1e-9 ? muN * Math.tanh(tot / Math.max(muN, 1e-9)) / tot : 1;
    const Kx = Ck * rEff / denom * sat;
    const Fx0 = FxLin * sat;
    let omegaFree = t.omega + dt * (-rEff * Fx0) / (I + dt * rEff * Kx * rEff);
    // Freno (Coulomb) + anti-deslizamiento.
    let bT = (up.brakeTorqueMax || 0) * brakeIn;
    // Anti-deslizamiento proporcional: reduce par si el deslizamiento supera el objetivo (ESTIMADO).
    if (ctx.antiSkid && bT > 0 && Math.abs(vLong) > 2 && slip0 < -gp.antiSkidSlip) bT *= clamp(1 - (-slip0 - gp.antiSkidSlip) * 10, 0.15, 1);
    if (bT > 0) {
      const dw = dt * bT / (I + dt * rEff * Kx * rEff);
      omegaFree = Math.abs(omegaFree) <= dw ? 0 : omegaFree - Math.sign(omegaFree) * dw;
      t.brakeT = bT;
    }
    t.omega = omegaFree;
    t.spin += t.omega * dt;
    // Fuerzas con el giro actualizado.
    const slip = (t.omega * rEff - vLong) / denom;
    FxLin = Ck * slip;
    tot = Math.hypot(FxLin, FyLin);
    sat = tot > 1e-9 ? muN * Math.tanh(tot / Math.max(muN, 1e-9)) / tot : 1;
    let Fx = FxLin * sat, Fy = FyLin * sat;
    t.skid = tot > 1.1 * muN && N > 100;
    // Resistencia a la rodadura (suave en velocidad nula).
    Fx -= sf.roll * N * Math.tanh(vLong / 0.3);
    t.slipLong = slip; t.slipLat = Math.atan2(vLat, Math.max(Math.abs(vLong), 0.5));
    t.contact = true; t.N = N; anyContact = true; load += N;
    _F[0] = N * _n[0] + Fx * fx + Fy * rx;
    _F[1] = N * _n[1] + Fx * fy + Fy * ry;
    _F[2] = N * _n[2] + Fx * fz + Fy * rz;
    // Parte a lo largo del eje de la pata (cuerpo arriba) va a la masa no suspendida; el resto, al fuselaje
    // en el punto de contacto.
    const Fu = dot(_F, _upw);
    Nup += Fu;
    cUp += up.tireC * Math.max(_upw[0] * _n[0] + _upw[1] * _n[1] + _upw[2] * _n[2], 0);
    _F[0] -= Fu * _upw[0]; _F[1] -= Fu * _upw[1]; _F[2] -= Fu * _upw[2];
    ctx.Fw[0] += _F[0]; ctx.Fw[1] += _F[1]; ctx.Fw[2] += _F[2];
    cross(_m, _rt, _F);
    ctx.Tw[0] += _m[0]; ctx.Tw[1] += _m[1]; ctx.Tw[2] += _m[2];
    // Castor: orientación de la rueda loca sigue a la velocidad (sólo visual + amortiguación de shimmy).
    if (up.castor && Math.abs(vLong) + Math.abs(vLat) > 0.3) {
      const tgt = clamp(Math.atan2(vLat, Math.abs(vLong)) / DEG + unit.steerDeg, -60, 60);
      unit.steerDeg += (tgt - unit.steerDeg) * (1 - Math.exp(-dt * 8));
    }
  }
  unit.contact = anyContact; unit.loadN = load;
  // Dinámica de la masa no suspendida (u positivo = rueda sube respecto del fuselaje).
  if (ctx.ext >= 0.999) {
    const st = unit.strutOnWheel(unit.u, unit.uDot);
    const m = up.unsprungKg;
    const c = st.c + cUp;
    const F0 = Nup + st.F + c * unit.uDot;
    unit.uDot = (unit.uDot + dt * F0 / m) / (1 + dt * c / m);
    unit.u += unit.uDot * dt;
    // Reacción sobre el fuselaje: −(fuerza de la pata sobre la rueda), en el eje (modelo).
    const st2 = unit.strutOnWheel(unit.u, unit.uDot);
    const Fa = -st2.F;
    unit.strutForce = Fa; unit.ma = st2.ma; unit.stroke = st2.s;
    _rb[0] = axleModelTmp[0] - ctx.cg[0]; _rb[1] = axleModelTmp[1] - ctx.cg[1]; _rb[2] = axleModelTmp[2] - ctx.cg[2];
    qRotate(_r, q, _rb);
    _F[0] = _upw[0] * Fa; _F[1] = _upw[1] * Fa; _F[2] = _upw[2] * Fa;
    ctx.Fw[0] += _F[0]; ctx.Fw[1] += _F[1]; ctx.Fw[2] += _F[2];
    cross(_m, _r, _F);
    ctx.Tw[0] += _m[0]; ctx.Tw[1] += _m[1]; ctx.Tw[2] += _m[2];
    unit.bottomed = unit.u > unit.travel;
  } else {
    unit.u += (0 - unit.u) * (1 - Math.exp(-dt * 5)); unit.uDot = 0; unit.strutForce = 0; unit.bottomed = false;
  }
  return unit;
}
