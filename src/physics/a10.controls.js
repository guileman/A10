// Mandos de vuelo del A-10C: timón de profundidad, alerones (partidos: decelerones), timones de dirección
// gemelos, flaps de 3 posiciones (UP/MVR/DN), compensadores en los 3 ejes y SAS en cabeceo y guiñada
// (el A-10C tiene SAS de cabeceo y guiñada; no de alabeo). Los SAS son amortiguadores con filtro de lavado
// (washout): amortiguan sin oponerse a un giro sostenido. Autoridad limitada.
import { clamp, DEG } from './math.js';

export class A10Controls {
  constructor(p) { this.p = p; this.reset(); }
  reset(trimElevDeg = 0, flapsDeg = 0) {
    this.elevDeg = trimElevDeg; this.aileronDeg = 0; this.rudderDeg = 0;
    this.trimElevDeg = trimElevDeg; this.trimAilDeg = 0; this.trimRudDeg = 0;
    this.flapsDeg = flapsDeg; this.speedbrakeDeg = 0;
    this.qLP = 0; this.rLP = 0; // pasabajos para el washout
    this.sasPitchDeg = 0; this.sasYawDeg = 0;
  }
  /** Profundidad (+ borde de fuga abajo) para palanca normalizada (+ atrás = proa arriba). */
  stickToElev(pitch) { const p = this.p; return pitch >= 0 ? -pitch * p.elevatorUpDeg : -pitch * p.elevatorDownDeg; }
  /** Índice continuo de flaps (0..2) desde el ángulo actual, para interpolar coeficientes. */
  flapIdxF() {
    const f = this.p.flapDeg, d = this.flapsDeg;
    if (d <= f[1]) return f[1] > 0 ? d / f[1] : 0;
    return 1 + (d - f[1]) / (f[2] - f[1]);
  }
  /**
   * c: controls; st: { q, r (rad/s conv.), betaRad, iasKt }
   */
  update(dt, c, st) {
    const p = this.p;
    const assist = c.assist || {};
    const k = clamp(assist.stabilityAug ?? 1, 0, 1);
    const pitch = clamp(c.pitch || 0, -1, 1), roll = clamp(c.roll || 0, -1, 1), yaw = clamp(c.yaw || 0, -1, 1);
    // Compensadores (entradas = velocidad de compensación −1..1; + = proa arriba / ala derecha abajo / proa derecha).
    const tr = c.trim || {};
    if (tr.pitch) this.trimElevDeg = clamp(this.trimElevDeg - tr.pitch * p.trimRateDegS * dt, p.trimRangeDeg[0], p.trimRangeDeg[1]);
    if (tr.roll) this.trimAilDeg = clamp(this.trimAilDeg + tr.roll * p.trimRateDegS * dt, -p.rollTrimRangeDeg, p.rollTrimRangeDeg);
    if (tr.yaw) this.trimRudDeg = clamp(this.trimRudDeg + tr.yaw * p.trimRateDegS * dt, -p.yawTrimRangeDeg, p.yawTrimRangeDeg);
    // SAS con washout: señal = q − pasabajos(q).
    const s = p.sas;
    const a = dt / (s.washoutS + dt);
    this.qLP += (st.q - this.qLP) * a; this.rLP += (st.r - this.rLP) * a;
    const qHP = (st.q - this.qLP) / DEG, rHP = (st.r - this.rLP) / DEG;
    const authE = s.authorityFrac * (p.elevatorUpDeg + p.elevatorDownDeg), authR = s.authorityFrac * 2 * p.rudderDeg;
    this.sasPitchDeg = clamp(k * s.pitchGain * qHP, -authE, authE);
    this.sasYawDeg = clamp(k * (-s.yawGain * rHP + s.betaGain * st.betaRad / DEG), -authR, authR);
    const eCmd = clamp(this.trimElevDeg + this.stickToElev(pitch) + this.sasPitchDeg, -p.elevatorUpDeg, p.elevatorDownDeg);
    const aCmd = clamp(roll * p.aileronDeg + this.trimAilDeg, -p.aileronDeg, p.aileronDeg);
    const rCmd = clamp(yaw * p.rudderDeg + this.trimRudDeg + this.sasYawDeg, -p.rudderDeg, p.rudderDeg);
    const rl = p.surfaceRateDegS * dt;
    this.elevDeg += clamp(eCmd - this.elevDeg, -rl, rl);
    this.aileronDeg += clamp(aCmd - this.aileronDeg, -rl, rl);
    this.rudderDeg += clamp(rCmd - this.rudderDeg, -rl, rl);
    // Flaps, con retracción automática de DN a MVR por velocidad (ESTIMADO).
    let fIdx = clamp(Math.round(c.flaps ?? 0), 0, 2);
    if (fIdx === 2 && st.iasKt > p.flapBlowbackKt) fIdx = 1;
    this.flapsBlownUp = fIdx !== clamp(Math.round(c.flaps ?? 0), 0, 2);
    const fT = p.flapDeg[fIdx], fr = p.flapRateDegS * dt;
    this.flapsDeg += clamp(fT - this.flapsDeg, -fr, fr);
    // Decelerones (frenos aerodinámicos): apertura simétrica de las hojas superior e inferior de cada alerón.
    const sbT = clamp(c.speedbrake ?? (c.airbrake ? 1 : 0), 0, 1) * p.speedbrakeMaxDeg, sr = p.speedbrakeRateDegS * dt;
    this.speedbrakeDeg += clamp(sbT - this.speedbrakeDeg, -sr, sr);
    return this;
  }
}
