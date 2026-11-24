// Mandos de vuelo del Harrier de 1.ª gen.: varillaje MECÁNICO (ganancia palanca->superficie constante, no
// programada con la velocidad), servos hidráulicos con velocidad limitada, autoestabilizador (SAS) de
// autoridad limitada en los 3 ejes que mueve las mismas superficies (y por lo tanto las válvulas RCS),
// compensador de cabeceo (mueve el estabilizador y la válvula de cabeceo), flaps de 3 posiciones y
// aerofreno limitado a 25° con el tren abajo.
// Ayudas opcionales NO reales (assist): hoverDamping (retención de actitud en vuelo lento), autoTrim.
import { clamp, DEG } from './math.js';

export class FlightControls {
  constructor(p) { this.p = p; this.reset(); }
  reset(trimDeg = 0, flapsDeg = 0) {
    this.stabDeg = trimDeg; this.aileronDeg = 0; this.rudderDeg = 0;
    this.trimDeg = trimDeg; this.flapsDeg = flapsDeg; this.airbrakeDeg = 0;
    this.pitchDemand = 0; this.rollDemand = 0; this.yawDemand = 0;
    this.hoverRef = null;
  }
  /** Normaliza estabilizador -> demanda de válvula de cabeceo (+ proa arriba). */
  stabToDemand(stabDeg) {
    const p = this.p;
    return stabDeg <= 0 ? -stabDeg / p.stabTEupDeg : -stabDeg / p.stabTEdownDeg;
  }
  /** Estabilizador (° , + borde de fuga abajo) para una demanda de palanca normalizada (+ atrás). */
  stickToStab(pitch) { const p = this.p; return pitch >= 0 ? -pitch * p.stabTEupDeg : -pitch * p.stabTEdownDeg; }

  /**
   * c: controls; st: { p,q,r (rad/s conv.), pitchRad, rollRad, ias (m/s), nozzleDeg, gearDown }
   */
  update(dt, c, st, aeroP) {
    const p = this.p;
    const assist = c.assist || {};
    const sasK = clamp(assist.stabilityAug ?? 0.5, 0, 1) * 2; // 0.5 = SAS nominal
    const hd = clamp(assist.hoverDamping ?? 0, 0, 1);
    let pitch = clamp(c.pitch || 0, -1, 1), roll = clamp(c.roll || 0, -1, 1), yaw = clamp(c.yaw || 0, -1, 1);
    // Ayuda de vuelo lento: actitud de referencia + amortiguación (actúa como un piloto automático simple).
    const slow = st.nozzleDeg > 20 && st.ias < 45;
    if (hd > 0 && slow) {
      if (!this.hoverRef) this.hoverRef = { pitch: st.pitchRad };
      if (Math.abs(c.pitch || 0) > 0.05) this.hoverRef.pitch = st.pitchRad;
      pitch += hd * (-2.0 * (st.pitchRad - this.hoverRef.pitch) - 1.2 * st.q);
      if (Math.abs(c.roll || 0) < 0.05) roll += hd * (-2.5 * st.rollRad - 1.0 * st.p);
      else roll += hd * (-0.6 * st.p);
      yaw += hd * (-2.0 * st.r);
      pitch = clamp(pitch, -1, 1); roll = clamp(roll, -1, 1); yaw = clamp(yaw, -1, 1);
    } else this.hoverRef = null;
    // Compensador.
    const tr = p.stabTrimRangeDeg;
    if (c.trimPitch) this.trimDeg = clamp(this.trimDeg - c.trimPitch * p.trimRateDegS * dt, tr[0], tr[1]);
    if ((assist.autoTrim || 0) > 0 && !slow) {
      this.trimDeg = clamp(this.trimDeg + this.stickToStab(c.pitch || 0) * assist.autoTrim * 0.3 * dt, tr[0], tr[1]);
    }
    // SAS de autoridad limitada.
    const sas = p.sas;
    const authS = sas.authorityFrac * (p.stabTEupDeg + p.stabTEdownDeg);
    const authA = sas.authorityFrac * 2 * p.aileronDeg, authR = sas.authorityFrac * 2 * p.rudderDeg;
    const sP = clamp(sasK * sas.pitchGain * st.q / DEG, -authS, authS);
    const sR = clamp(-sasK * sas.rollGain * st.p / DEG, -authA, authA);
    const sY = clamp(-sasK * sas.yawGain * st.r / DEG, -authR, authR);
    const stabCmd = clamp(this.trimDeg + this.stickToStab(pitch) + sP, -p.stabTEupDeg, p.stabTEdownDeg);
    const ailCmd = clamp(roll * p.aileronDeg + sR, -p.aileronDeg, p.aileronDeg);
    const rudCmd = clamp(yaw * p.rudderDeg + sY, -p.rudderDeg, p.rudderDeg);
    const rl = p.surfaceRateDegS * dt;
    this.stabDeg += clamp(stabCmd - this.stabDeg, -rl, rl);
    this.aileronDeg += clamp(ailCmd - this.aileronDeg, -rl, rl);
    this.rudderDeg += clamp(rudCmd - this.rudderDeg, -rl, rl);
    // Flaps.
    const fIdx = clamp(Math.round(c.flaps ?? 0), 0, 2);
    const fTgt = p.flapDeg[fIdx];
    this.flapsDeg += clamp(fTgt - this.flapsDeg, -p.flapRateDegS * dt, p.flapRateDegS * dt);
    // Aerofreno (Princeton MAE 1466: máx. 66°, con tren abajo limitado a 25°).
    const abMax = st.gearDown ? aeroP.airbrake.gearDownDeg : aeroP.airbrake.maxDeg;
    const abTgt = c.airbrake ? abMax : 0;
    this.airbrakeDeg += clamp(abTgt - this.airbrakeDeg, -40 * dt, 40 * dt);
    // Demandas a válvulas RCS (unidas a las superficies).
    this.pitchDemand = clamp(this.stabToDemand(this.stabDeg), -1, 1);
    this.rollDemand = clamp(this.aileronDeg / p.aileronDeg, -1, 1);
    this.yawDemand = clamp(this.rudderDeg / p.rudderDeg, -1, 1);
    return this;
  }
}
