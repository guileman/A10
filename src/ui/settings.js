// Ajustes persistentes del menú del A-10C. El almacenamiento (localStorage) se inyecta.
import { clamp, finite } from './units.js';
import { destination, computeRoute, validLatLon, DEFAULT_ROUTE_LENGTH_M, MIN_ROUTE_LENGTH_M, MAX_ROUTE_LENGTH_M } from './geo.js';

export const SETTINGS_KEY = 'a10.ui.v1';
export const QUALITIES = ['bajo', 'medio', 'alto'];
export const TIMES = ['amanecer', 'dia', 'tarde', 'atardecer'];
export const CAMERAS = ['pilot', 'chase', 'world'];
export const SOURCES = ['demo', 'real'];
export const MIXES = ['blindados', 'mixto', 'camiones'];

/** Rangos de la misión y del avión (única fuente para la UI y para sanitize). */
export const LIMITS = {
  convoySize: [4, 16], startDistanceKm: [4, 12], startAltFt: [1000, 8000], startSpeedKt: [200, 380],
  mavericks: [0, 6], fuelKg: [500, 4853], extentKm: [2, 8],
};

// Ruta rural real cerca de Roldán (Santa Fe, Argentina): A y B ≈ 3 km al oeste.
const ROUTE_A = { lat: -32.905, lon: -60.93 };

export function defaultSettings() {
  return {
    source: 'real',
    route: { a: { ...ROUTE_A }, b: destination(ROUTE_A, 270, DEFAULT_ROUTE_LENGTH_M) },
    extentKm: 4,
    mission: { convoySize: 8, mix: 'mixto', startDistanceKm: 7, startAltFt: 3000, startSpeedKt: 300, loadout: { mavericks: 4 } },
    timeOfDay: 'dia',
    quality: 'medio',
    environment: { windKt: 5, windFromDeg: 50, tempOffsetC: 0, qnhHpa: 1013, turbulence: 0.1, surfaceWetness: 0 },
    fuelKg: 3000,
    assist: { stabilityAug: 1 },
    camera: 'pilot',
    hud: { scale: 1, color: 'verde' },
    audio: { volume: 0.7, muted: false },
    map: { lon: ROUTE_A.lon, lat: ROUTE_A.lat, zoom: 13 },
  };
}

const pick = (v, list, d) => (list.includes(v) ? v : d);
const pt = (p, d) => (p && Number.isFinite(+p.lat) && Number.isFinite(+p.lon) && Math.abs(p.lat) <= 85 && Math.abs(p.lon) <= 180 ? { lat: +p.lat, lon: +p.lon } : { ...d });
const rng = (v, key, d) => clamp(finite(v, d), LIMITS[key][0], LIMITS[key][1]);

/** Normaliza (clamp + valores por defecto) un objeto de ajustes arbitrario. */
export function sanitize(raw) {
  const d = defaultSettings();
  const s = raw && typeof raw === 'object' ? raw : {};
  // `route` {a,b}; se acepta el formato viejo `runway` {thr1,thr2} como alias de lectura
  const r = (s.route && typeof s.route === 'object' ? s.route : null) || (s.runway && typeof s.runway === 'object' ? { a: s.runway.thr1, b: s.runway.thr2 } : {});
  const e = s.environment || {}, a = s.assist || {}, h = s.hud || {}, m = s.map || {}, ms = s.mission || {};
  const route = { a: pt(r.a, d.route.a), b: pt(r.b, d.route.b) };
  const hasLen = computeRoute(route.a, route.b);
  if (!hasLen.valid) route.b = destination(route.a, hasLen.bearingTrue || 270, clamp(hasLen.lengthM, MIN_ROUTE_LENGTH_M, MAX_ROUTE_LENGTH_M));
  return {
    source: pick(s.source, SOURCES, d.source),
    route,
    extentKm: rng(s.extentKm, 'extentKm', d.extentKm),
    mission: {
      convoySize: Math.round(rng(ms.convoySize, 'convoySize', d.mission.convoySize)),
      mix: pick(ms.mix, MIXES, d.mission.mix),
      startDistanceKm: rng(ms.startDistanceKm, 'startDistanceKm', d.mission.startDistanceKm),
      startAltFt: rng(ms.startAltFt, 'startAltFt', d.mission.startAltFt),
      startSpeedKt: rng(ms.startSpeedKt, 'startSpeedKt', d.mission.startSpeedKt),
      loadout: { mavericks: Math.round(rng((ms.loadout || {}).mavericks, 'mavericks', d.mission.loadout.mavericks)) },
    },
    timeOfDay: pick(s.timeOfDay, TIMES, d.timeOfDay),
    quality: pick(s.quality, QUALITIES, d.quality),
    environment: {
      windKt: clamp(finite(e.windKt, d.environment.windKt), 0, 50),
      windFromDeg: ((finite(e.windFromDeg, d.environment.windFromDeg) % 360) + 360) % 360,
      tempOffsetC: clamp(finite(e.tempOffsetC, 0), -30, 40),
      qnhHpa: clamp(finite(e.qnhHpa, 1013), 950, 1060),
      turbulence: clamp(finite(e.turbulence, d.environment.turbulence), 0, 1),
      surfaceWetness: clamp(finite(e.surfaceWetness, 0), 0, 1),
    },
    fuelKg: rng(s.fuelKg, 'fuelKg', d.fuelKg),
    assist: { stabilityAug: clamp(finite(a.stabilityAug, d.assist.stabilityAug), 0, 1) },
    camera: pick(s.camera, CAMERAS, d.camera),
    hud: { scale: clamp(finite(h.scale, 1), 0.7, 1.6), color: pick(h.color, ['verde', 'ambar'], 'verde') },
    audio: { volume: clamp(finite((s.audio || {}).volume, 0.7), 0, 1), muted: !!(s.audio || {}).muted },
    map: { lon: finite(m.lon, d.map.lon), lat: finite(m.lat, d.map.lat), zoom: clamp(finite(m.zoom, d.map.zoom), 1, 20) },
  };
}

export function loadSettings(storage) {
  try {
    const t = storage && storage.getItem(SETTINGS_KEY);
    return sanitize(t ? JSON.parse(t) : null);
  } catch { return sanitize(null); }
}

export function saveSettings(storage, s) {
  try { storage && storage.setItem(SETTINGS_KEY, JSON.stringify(s)); return true; } catch { return false; }
}

/**
 * Construye el `config` que entrega el menú al arrancar.
 * `route` es la fuente de verdad; `runway` es un ALIAS de compatibilidad (mismos puntos A→B como thr1/thr2)
 * para el código de mundo heredado del Harrier. widthM/surface/designators ya no son opciones del usuario:
 * van con valores fijos de carretera rural para no romper a quien aún los lea.
 */
export function buildConfig(s) {
  const rt = computeRoute(s.route.a, s.route.b);
  const a = { ...s.route.a }, b = { ...s.route.b };
  return {
    source: s.source,
    route: { a, b, lengthM: rt.lengthM, bearingTrue: rt.bearingTrue },
    runway: { thr1: { ...a }, thr2: { ...b }, lengthM: rt.lengthM, bearingTrue: rt.bearingTrue, widthM: 8, surface: 'asphalt', designators: false },
    extentKm: s.extentKm,
    mission: { ...s.mission, loadout: { ...s.mission.loadout } },
    timeOfDay: s.timeOfDay,
    quality: s.quality,
    environment: { ...s.environment },
    fuelKg: s.fuelKg,
    assist: { ...s.assist },
    camera: s.camera,
    audio: { ...s.audio },
  };
}
