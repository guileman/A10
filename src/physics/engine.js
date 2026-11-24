// Pegasus 103 (Pegasus 11): dinámica de RPM (NF, %), empuje bruto vs NF corregida/presión/Mach,
// gasto másico (para resistencia de toma), consumo, inyección de agua, JPT y limitador.
import { interp, clamp, smoothstep } from './math.js';

export class Engine {
  constructor(p) {
    this.p = p;
    this.Fmax = interp(p.thrustTable, p.dryMaxNF);
    this.reset(0, 0, 0);
  }
  reset(nf, fuelKg, waterKg) {
    this.nf = nf; this.fuelKg = fuelKg; this.waterKg = waterKg;
    this.running = nf > 0 || fuelKg > 0;
    this.grossN = 0; this.massFlow = 0; this.fuelFlow = 0; this.jptC = 15; this.waterOn = false;
    this.nfc = nf; this.flameout = false;
  }
  /** NF física de régimen para un throttle (sin limitador de JPT). */
  commandNF(throttle, water) {
    const p = this.p;
    const max = water ? p.wetMaxNF : p.dryMaxNF;
    return p.idleNF + (max - p.idleNF) * clamp(throttle, 0, 1);
  }
  /** Máxima NF física permitida por el limitador de JPT a θ2 dado. */
  jptLimitedNF(theta2, water) {
    const p = this.p, T2 = 288.15 * theta2;
    const kJ = (p.jptIsa100C + 273.15) / 288.15 - 1;
    const lim = p.jptLimitC + 273.15 + (water ? p.jptWaterDropC : 0);
    const x3 = (lim / T2 - 1) / kJ;
    return 100 * Math.cbrt(Math.max(x3, 0)) * Math.sqrt(theta2);
  }
  /** Empuje bruto estático (ISA) para NF corregida. */
  staticThrust(nfc) { return nfc <= 0 ? 0 : interp(this.p.thrustTable, nfc) * (nfc < this.p.thrustTable[0][0] ? nfc / this.p.thrustTable[0][0] : 1); }

  /**
   * dt: s; throttle 0..1; water bool; theta2/delta: razones de temperatura (incl. reingestión) y presión;
   * mach. Actualiza nf, grossN (sin pérdidas de sangrado), massFlow, fuelFlow, jptC.
   */
  update(dt, throttle, water, theta2, delta, mach) {
    const p = this.p;
    if (this.fuelKg <= 0) { this.fuelKg = 0; this.flameout = true; }
    const waterOn = water && this.waterKg > 0 && !this.flameout && throttle > 0.9;
    this.waterOn = waterOn;
    let cmd;
    if (this.flameout) cmd = 8 + 25 * clamp(mach, 0, 1); // molinete (ESTIMADO)
    else cmd = Math.min(this.commandNF(throttle, waterOn), this.jptLimitedNF(theta2, waterOn));
    const err = cmd - this.nf;
    const low = smoothstep(70, 35, this.nf); // 1 cerca de ralentí
    const tau = (err > 0 ? p.accelTau : p.decelTau) * (1 + (p.lowSpoolTauMul - 1) * low);
    let rate = err / tau;
    const rmax = err > 0 ? p.accelRateMax * (1 - 0.6 * low) : p.decelRateMax;
    rate = clamp(rate, -rmax, rmax);
    this.nf += rate * dt;
    if (Math.abs(cmd - this.nf) < 1e-6) this.nf = cmd;

    const nfc = this.nf / Math.sqrt(theta2);
    this.nfc = nfc;
    const Fs = this.flameout ? 0 : this.staticThrust(nfc);
    const machF = 1 + p.gross.machK1 * mach + p.gross.machK2 * mach * mach;
    this.grossN = Fs * delta * machF;
    const fr = Math.max(Fs, 0) / this.Fmax;
    // Gasto corregido ∝ (F/Fmax)^0.6 (ESTIMADO); físico = corregido·δ/√θ, + recuperación de ram.
    this.massFlow = p.massFlowMax * Math.pow(Math.max(fr, 1e-4), 0.6) * delta / Math.sqrt(theta2) * (1 + 0.15 * mach * mach);
    if (this.flameout) this.massFlow *= 0.3;
    // Consumo: TSFC sobre empuje bruto estático equivalente, peor a baja potencia (ESTIMADO).
    this.fuelFlow = this.flameout ? 0 : Math.max(0.06, p.tsfcMax * Fs * delta * (1 + 0.35 * clamp(1 - nfc / 100, 0, 1)));
    this.fuelKg = Math.max(0, this.fuelKg - this.fuelFlow * dt);
    if (waterOn) this.waterKg = Math.max(0, this.waterKg - p.waterFlowKgS * dt);
    const kJ = (p.jptIsa100C + 273.15) / 288.15 - 1;
    const T2 = 288.15 * theta2;
    this.jptC = this.flameout ? T2 - 273.15 : T2 * (1 + kJ * Math.pow(Math.max(nfc, 0) / 100, 3)) - 273.15 - (waterOn ? p.jptWaterDropC : 0);
    return this;
  }
  /** Fracción del empuje bruto en las toberas delanteras (aire de fan). */
  frontSplit() {
    const p = this.p;
    return clamp(p.frontSplit100 + p.frontSplitSlope * (100 - this.nfc), 0.42, 0.62);
  }
}
