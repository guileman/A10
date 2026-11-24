// Efectos de chorro cerca del suelo y en transición + reingestión de gases calientes (HGI) + superficie.
import { clamp, smoothstep } from './math.js';
import { SURFACE_TABLE } from './params.js';

/**
 * Incremento de sustentación inducido por los chorros, como fracción del empuje vertical (negativo = pérdida).
 * hNoz: altura media de salida de toberas sobre el suelo (m); V: velocidad aire (m/s); nozzleDeg.
 *  ΔL/T = −k0 − kt·V/(V+40) (interacción chorro-ala en transición)
 *         −ks·(De/h)^n (succión por arrastre de aire entre chorros y suelo)
 *         +kf·exp(−h/(De·hf)) (fuente/"fountain" entre chorros delanteros y traseros)
 * Los términos de suelo se desvanecen con la velocidad (los chorros se barren hacia atrás).
 */
export function jetInducedLift(p, hNoz, V, nozzleDeg) {
  const vert = smoothstep(30, 80, nozzleDeg);
  const h = Math.max(hNoz, 0.3);
  const fade = Math.exp(-V / 18);
  const suck = p.suckK * Math.pow(p.De / h, p.suckN);
  const fount = p.fountainK * Math.exp(-h / (p.De * p.fountainHde));
  const ground = (-suck + fount) * fade * vert;
  const free = -(p.freeAirLossFrac + p.transitionLossK * V / (V + 40)) * vert;
  return { total: ground + free, ground, free };
}

/** Subida de temperatura de entrada por reingestión (K). uAir: componente de aire relativo de frente (m/s, + = de proa). */
export function hotGasIngestion(p, hNoz, uAir, nozzleDeg) {
  if (nozzleDeg < 55) return 0;
  const hf = Math.exp(-Math.max(hNoz, 0) / p.hgiHeightM);
  const wf = clamp(1 - uAir / p.hgiWindMs, 0, 1.6) / 1.6;
  return p.hgiMaxK * hf * wf * smoothstep(55, 85, nozzleDeg);
}

export function surfaceFriction(surf, wetness) {
  const s = SURFACE_TABLE[surf] || SURFACE_TABLE[4];
  return { mu: s.muDry + (s.muWet - s.muDry) * clamp(wetness || 0, 0, 1), roll: s.roll, name: s.name, water: surf === 6 };
}

/** Mundo vacío: suelo plano y = 0 de asfalto. */
export const EMPTY_WORLD = {
  height: () => 0,
  normal: (x, z, out) => { out = out || [0, 0, 0]; out[0] = 0; out[1] = 1; out[2] = 0; return out; },
  surface: () => 4,
  obstacles: null,
  bounds: { xMin: -1e6, xMax: 1e6, zMin: -1e6, zMax: 1e6 },
};
