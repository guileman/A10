// Utilidades de prueba: controles base y "piloto" simple (P-D) para maniobras con guion.
export const baseControls = (o = {}) => ({
  pitch: 0, roll: 0, yaw: 0, throttle: 0, nozzleDeg: 0, flaps: 0, gearDown: true, brake: 0, parkingBrake: false,
  airbrake: false, waterInjection: false, assist: { stabilityAug: 0.5, hoverDamping: 0 }, ...o,
});
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
/** Retención de actitud (cabeceo/alabeo en grados) con la palanca. */
export function attitudeHold(c, s, pitchRefDeg, rollRefDeg = 0, kp = 0.12, kd = 0.25) {
  c.pitch = clamp(kp * (pitchRefDeg - s.att.pitchDeg) - kd * s.rates.q * 57.3 / 10, -1, 1);
  c.roll = clamp(0.08 * (rollRefDeg - s.att.rollDeg) - 0.15 * s.rates.p * 57.3 / 10, -1, 1);
  c.yaw = clamp(-0.3 * s.rates.r * 57.3 / 10 - 0.05 * s.air.betaDeg, -1, 1);
}
