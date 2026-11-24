// Pista recta: de los dos umbrales (lat/lon) a trazado, opciones del generador de mundo y colocación inicial.
const D2R = Math.PI / 180;
export function runwayPath(cfg) {
  const { thr1, thr2 } = cfg.runway;
  return [{ lon: thr1.lon, lat: thr1.lat }, { lon: thr2.lon, lat: thr2.lat }];
}
export function runwayLengthM(cfg) {
  const { thr1: a, thr2: b } = cfg.runway; const k = 111320;
  return Math.hypot((b.lon - a.lon) * k * Math.cos((a.lat + b.lat) / 2 * D2R), (b.lat - a.lat) * k);
}
/** Opciones de buildAOI/buildWorld para una pista: plana, sin bombeo/cunetas/rugosidad, franja nivelada. */
export function runwayOptions(cfg, SURF) {
  const surf = { asphalt: SURF.ASPHALT, concrete: SURF.ASPHALT, grass: SURF.GRASS }[cfg.runway.surface] ?? SURF.ASPHALT;
  const margin = Math.max(500, (cfg.extentKm || 3) * 1000);
  const L = runwayLengthM(cfg);
  return {
    aoi: { closed: false, roadWidth: cfg.runway.widthM || 45, margin, maxSide: Math.max(4000, 2 * margin + L + 400), wantOSM: cfg.source === 'real', ...(cfg.maxTiles ? { maxTiles: cfg.maxTiles } : {}) },
    world: {
      seed: 1, pipeline: 'v2', roadWidth: cfg.runway.widthM || 45, roadSurface: surf,
      verticalExaggeration: 1, maxRoadGrade: 0.02, minVertRadius: 8000, roadCrown: 0.008, ditchDepth: 0.02, shoulder: 25,
      offroadBump: 0.004, roughness: { washboard: { amp: 0, fraction: 0 }, potholes: { ratePer100m: 0, depth: 0 } },
    },
  };
}
/** Umbral 1, dirección y largo en el marco local del mundo (x este, z sur). */
export function runwayFrame(aoi) {
  const c = aoi.path.ctrl, a = c[0], b = c[c.length - 1];
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
  return { thr1: a, thr2: b, ux: dx / L, uz: dz / L, length: L, headingDeg: (Math.atan2(dx, -dz) / D2R + 360) % 360 };
}
/** Adaptador del mundo del motor a la interfaz de la física (normal(x,z,out) acepta arreglo u objeto). */
export function physicsWorld(w) {
  const tmp = { x: 0, y: 1, z: 0 };
  return {
    bounds: w.bounds,
    height: (x, z) => w.height(x, z),
    normal(x, z, out) {
      w.normal(x, z, tmp);
      if (Array.isArray(out) || ArrayBuffer.isView(out)) { out[0] = tmp.x; out[1] = tmp.y; out[2] = tmp.z; } else { out.x = tmp.x; out.y = tmp.y; out.z = tmp.z; }
      return out;
    },
    surface: (x, z) => w.surface(x, z),
    obstacles: w.obstacles || { query: () => 0 },
  };
}
