// Geodesia mínima para configurar la ruta del convoy (sin DOM). Esfera de radio medio terrestre: suficiente para <20 km.
export const EARTH_R = 6371008.8;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export const norm360 = (d) => ((d % 360) + 360) % 360;

/** Distancia (m) entre dos puntos {lat,lon} (haversine). */
export function distanceM(a, b) {
  const p1 = a.lat * D2R, p2 = b.lat * D2R;
  const dp = p2 - p1, dl = (b.lon - a.lon) * D2R;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Rumbo verdadero inicial (°, 0 = norte, horario) de a hacia b. */
export function bearingDeg(a, b) {
  const p1 = a.lat * D2R, p2 = b.lat * D2R, dl = (b.lon - a.lon) * D2R;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return norm360(Math.atan2(y, x) * R2D);
}

/** Punto a distanceM metros de a siguiendo el rumbo verdadero brg (°). */
export function destination(a, brg, distM) {
  const d = distM / EARTH_R, t = brg * D2R, p1 = a.lat * D2R, l1 = a.lon * D2R;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
  const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 * R2D, lon: ((l2 * R2D + 540) % 360) - 180 };
}

/** Largo mínimo / máximo / por defecto de la ruta del convoy (m). */
export const MIN_ROUTE_LENGTH_M = 1000;
export const MAX_ROUTE_LENGTH_M = 8000;
export const DEFAULT_ROUTE_LENGTH_M = 3000;

/** Ruta del convoy A→B: largo (m), rumbo verdadero A→B y validez (1–8 km). */
export function computeRoute(a, b) {
  const lengthM = distanceM(a, b);
  return {
    lengthM,
    bearingTrue: bearingDeg(a, b),
    valid: lengthM >= MIN_ROUTE_LENGTH_M - 0.05 && lengthM <= MAX_ROUTE_LENGTH_M + 0.05,   // tolerancia de redondeo
  };
}

/** Mueve B para que la ruta tenga largo (acotado a 1–8 km) y/o rumbo dados, manteniendo A. */
export function withLengthBearing(a, lengthM, brgTrue) {
  return destination(a, norm360(brgTrue), Math.min(MAX_ROUTE_LENGTH_M, Math.max(MIN_ROUTE_LENGTH_M, lengthM)));
}

/** Metros este/norte de p respecto de origen o (aprox. equirectangular, para vistas previas). */
export function toLocalEN(o, p) {
  const k = Math.cos(o.lat * D2R);
  return { e: (p.lon - o.lon) * D2R * EARTH_R * k, n: (p.lat - o.lat) * D2R * EARTH_R };
}

export function validLatLon(p) {
  return !!p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 85 && Math.abs(p.lon) <= 180;
}

/** Acepta {lat,lon}, {lat,lng}, {latitude,longitude} o [lon,lat]. */
export function normPoint(p) {
  if (!p) return null;
  if (Array.isArray(p)) return validLatLon({ lon: +p[0], lat: +p[1] }) ? { lon: +p[0], lat: +p[1] } : null;
  const lat = +(p.lat ?? p.latitude), lon = +(p.lon ?? p.lng ?? p.longitude);
  return validLatLon({ lat, lon }) ? { lat, lon } : null;
}
