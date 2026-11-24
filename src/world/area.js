// Área de misión: un camino de tierra/ripio a lo largo de la ruta del convoy (A→B) sobre el mapa real o sintético.
// Sin pista: el A-10 empieza en vuelo. Se reutiliza el generador de mundo del rally (el "tramo" es la ruta del convoy).
const D2R = Math.PI / 180;
const K = 111320;

/** Puntos A y B de la ruta (acepta cfg.route {a,b} o, por compatibilidad, cfg.runway {thr1,thr2}). */
export function routeEnds(cfg) {
  const r = cfg.route || {};
  const a = r.a || (cfg.runway && cfg.runway.thr1), b = r.b || (cfg.runway && cfg.runway.thr2);
  return { a, b };
}
export function routePath(cfg) {
  const { a, b } = routeEnds(cfg);
  return [{ lon: a.lon, lat: a.lat }, { lon: b.lon, lat: b.lat }];
}
export function routeLengthM(cfg) {
  const { a, b } = routeEnds(cfg);
  return Math.hypot((b.lon - a.lon) * K * Math.cos((a.lat + b.lat) / 2 * D2R), (b.lat - a.lat) * K);
}
/** Opciones de buildAOI/buildWorld: camino rural de 7 m con su relieve natural (no una pista nivelada). */
export function areaOptions(cfg, SURF, { maxSide = 16000 } = {}) {
  const L = routeLengthM(cfg);
  const margin = Math.max(1500, (cfg.extentKm || 4) * 1000);
  const side = Math.min(maxSide, 2 * margin + L + 400);
  return {
    aoi: { closed: false, roadWidth: 7, margin, maxSide: Math.max(side, L + 1000), wantOSM: cfg.source === 'real', ...(cfg.maxTiles ? { maxTiles: cfg.maxTiles } : {}) },
    world: { seed: 1, pipeline: 'v2', roadWidth: 7, roadSurface: SURF.GRAVEL, verticalExaggeration: 1 },
  };
}
/** Ruta en el marco local (x este, z sur), su dirección y largo. */
export function routeFrame(aoi) {
  const c = aoi.path.ctrl, a = c[0], b = c[c.length - 1];
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
  const pts = (aoi.path.ctrl || [a, b]).map((p) => [p[0], p[1]]);
  return { a, b, ux: dx / L, uz: dz / L, length: L, headingDeg: (Math.atan2(dx, -dz) / D2R + 360) % 360, points: pts };
}
export { physicsWorld } from './runway.js';
