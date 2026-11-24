// Turbofán de alto bypass (TF34-GE-100A): dinámica de N1 lenta (spool-up ≈ 7 s), empuje neto vs N1,
// densidad y Mach (lapso típico de alto bypass), consumo por TSFC. Un objeto por motor.
import { interp, clamp, smoothstep } from './math.js';

export class Turbofan {
  constructor(p) { this.p = p; this.reset(p.idleN1); }
  reset(n1) { this.n1 = n1; this.thrustN = 0; this.fuelFlow = 0; this.running = true; }

  /** N1 comandado (%) por la palanca 0..1. */
  commandN1(throttle) { const p = this.p; return p.idleN1 + (p.maxN1 - p.idleN1) * clamp(throttle, 0, 1); }

  /** Empuje neto (N) en régimen para N1, σ y Mach. */
  netThrust(n1, sigma, mach) {
    const p = this.p;
    const f0 = interp(p.thrustTable, n1);
    const lapseM = Math.max(1 - p.machK1 * mach + p.machK2 * mach * mach, 0.15);
    return p.staticThrustN * f0 * Math.pow(Math.max(sigma, 0), p.altExp) * lapseM;
  }

  /** Avanza dt. hasFuel=false -> apagado (molinete sin empuje). Devuelve empuje neto (N). */
  update(dt, throttle, sigma, mach, hasFuel) {
    const p = this.p;
    this.running = hasFuel;
    const cmd = hasFuel ? this.commandN1(throttle) : 12 + 20 * clamp(mach, 0, 1);
    const err = cmd - this.n1;
    const low = smoothstep(75, 40, this.n1); // 1 cerca de ralentí: aceleración lenta del núcleo
    const tau = (err > 0 ? p.accelTau : p.decelTau) * (1 + (p.lowTauMul - 1) * low);
    const rmax = err > 0 ? p.accelRateMax * (1 - 0.6 * low) : p.decelRateMax;
    this.n1 += clamp(err / tau, -rmax, rmax) * dt;
    if (Math.abs(cmd - this.n1) < 1e-6) this.n1 = cmd;
    this.thrustN = hasFuel ? this.netThrust(this.n1, sigma, mach) : 0;
    if (hasFuel) {
      const fr = this.thrustN / Math.max(p.staticThrustN * Math.pow(Math.max(sigma, 1e-3), p.altExp), 1);
      const tsfc = p.tsfc * (1 + p.tsfcMachK * mach) * (1 + p.tsfcPartK * clamp(1 - fr, 0, 1));
      this.fuelFlow = Math.max(p.idleFuelKgS * Math.min(1, sigma + 0.2), tsfc * this.thrustN);
    } else this.fuelFlow = 0;
    return this.thrustN;
  }
}
