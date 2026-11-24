// Utilidades de prueba del A-10: controles base y pilotos simples (P-D) para maniobras con guion.
import { A10Sim } from '../../src/physics/index.js';
export const KT = 0.514444, FT = 0.3048, G0 = 9.80665;
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const a10Controls = (o = {}) => ({
  pitch: 0, roll: 0, yaw: 0, throttle: 0, flaps: 0, gearDown: true, brake: 0, parkingBrake: false, speedbrake: 0,
  trim: { pitch: 0, roll: 0, yaw: 0 }, assist: { stabilityAug: 1 }, ...o,
});
/** Carga útil para llegar a una masa total dada (con combustible y munición llenos). */
export function payloadFor(totalKg, sim = new A10Sim()) {
  const m = sim.p.mass;
  return totalKg - (m.emptyKg + m.pilotKg + m.fuelMaxKg + m.ammoMaxKg);
}
export const hdgErr = (s, ref = 0) => { let h = s.att.headingDeg - ref; if (h > 180) h -= 360; if (h < -180) h += 360; return h; };
/** Mantiene rumbo en tierra con pedales/rueda de proa. */
export function headingHold(c, s, ref = 0) { c.yaw = clamp(-0.15 * hdgErr(s, ref) - 0.3 * s.rates.r * 57.3, -1, 1); }
/** Retención de cabeceo y alabeo con palanca. */
export function attitudeHold(c, s, pitchRefDeg, rollRefDeg = 0, kp = 0.12, kd = 0.3) {
  c.pitch = clamp(kp * (pitchRefDeg - s.att.pitchDeg) - kd * s.rates.q * 57.3 / 10, -1, 1);
  c.roll = clamp(0.06 * (rollRefDeg - s.att.rollDeg) - 0.1 * s.rates.p * 57.3 / 10, -1, 1);
}
/** Despegue: frenos a fondo con gases al máximo 8 s, suelta, rota a `rotDeg` desde `vrKt`. */
export function takeoff(sim, { flaps = 1, vrKt = 140, rotDeg = 12, maxS = 90 } = {}) {
  const c = a10Controls({ throttle: 1, flaps, brake: 1 });
  for (let i = 0; i < 60 * 8; i++) sim.step(1 / 60, c);
  c.brake = 0;
  const p0 = sim.pos.slice(), t0 = sim.t;
  for (let i = 0; i < 60 * maxS; i++) {
    const s = sim.getState();
    headingHold(c, s);
    c.pitch = s.air.iasKt > vrKt ? clamp(0.25 * (rotDeg - s.att.pitchDeg) - 0.4 * s.rates.q * 57.3 / 10, -1, 1) : 0;
    sim.step(1 / 60, c);
    const s2 = sim.getState();
    if (!s2.gear.units.some((u) => u.contact)) return { distM: Math.hypot(s2.pos[0] - p0[0], s2.pos[2] - p0[2]), iasKt: s2.air.iasKt, timeS: s2.t - t0, controls: c };
  }
  return null;
}
