// Adaptador fino entre la pantalla de ruta del convoy (A→B) y `engine.MapView` (clase del motor del rally; la inyecta el orquestador).
// Interfaz esperada de MapView: new MapView(container, source, {onChange,onSelect}); setCenter(lon,lat,zoom);
// getPath()/setPath(pts); clear(); fitPath(pad); getCenter(); dispose().
// El formato de los puntos del camino se detecta (objeto {lon,lat} / {lng,lat} o arreglo [lon,lat]) y se conserva al escribir.
import { normPoint, validLatLon } from './geo.js';

export function makeSource(engine, kind) {
  if (!engine) return null;
  try {
    if (typeof engine.makeSource === 'function') return engine.makeSource(kind);
    if (kind === 'real' && engine.TileSource) return new engine.TileSource();
    if (engine.SyntheticSource) return new engine.SyntheticSource();
  } catch (e) { /* sin fuente: el mapa queda no disponible */ }
  return null;
}

/**
 * Crea el mapa de selección de la ruta del convoy. Mantiene como máximo 2 puntos (se conservan los dos últimos marcados).
 * onChange({a, b}) con null en los que falten (punto 1 = inicio A, punto 2 = fin B).
 */
export function createRouteMap({ engine, container, source, center, pathFormat = null, onChange }) {
  const out = { available: false, error: null };
  let view = null, fmt = pathFormat, busy = false, disposed = false;
  const toExt = (p) => (fmt === 'array' ? [p.lon, p.lat] : fmt === 'lng' ? { lng: p.lon, lat: p.lat } : { lon: p.lon, lat: p.lat });
  const readPts = () => {
    let path = [];
    try { path = view.getPath() || []; } catch { path = []; }
    if (!fmt && path.length) fmt = Array.isArray(path[0]) ? 'array' : ('lng' in path[0] && !('lon' in path[0]) ? 'lng' : 'object');
    return path.map(normPoint).filter(Boolean);
  };
  const write = (pts) => {
    busy = true;
    try { view.setPath(pts.map(toExt)); } finally { busy = false; }
  };
  const handle = () => {
    if (busy || disposed) return;
    let pts = readPts();
    if (pts.length > 2) { pts = pts.slice(-2); write(pts); }
    onChange && onChange({ a: pts[0] || null, b: pts[1] || null });
  };

  try {
    if (!engine || !engine.MapView) throw new Error('MapView no disponible');
    if (!source) throw new Error('fuente de mapa no disponible');
    view = new engine.MapView(container, source, { onChange: handle, onSelect: () => {} });
    if (center && validLatLon(center)) view.setCenter(center.lon, center.lat, center.zoom || 14);
    out.available = true;
  } catch (e) {
    out.error = e && e.message ? e.message : String(e);
    view = null;
  }

  Object.assign(out, {
    setPoints(a, b) {
      if (!view) return;
      write([a, b].filter(Boolean));
    },
    clear() { if (view) { busy = true; try { view.clear(); } finally { busy = false; } onChange && onChange({ a: null, b: null }); } },
    fit(pad = 0.25) { if (view && view.fitPath) { try { view.fitPath(pad); } catch { /* sin camino */ } } },
    center(lon, lat, zoom) { if (view && view.setCenter) view.setCenter(lon, lat, zoom); },
    getCenter() {
      if (!view || !view.getCenter) return null;
      try {
        const c = view.getCenter();
        if (!c) return null;
        const lon = Array.isArray(c) ? c[0] : (c.lon ?? c.lng), lat = Array.isArray(c) ? c[1] : c.lat, zoom = Array.isArray(c) ? c[2] : c.zoom;
        return Number.isFinite(lon) && Number.isFinite(lat) ? { lon, lat, zoom: Number.isFinite(zoom) ? zoom : undefined } : null;
      } catch { return null; }
    },
    dispose() { disposed = true; if (view && view.dispose) { try { view.dispose(); } catch { /* ya liberado */ } } view = null; },
  });
  return out;
}

/** Alias de compatibilidad con el nombre del Harrier. */
export const createRunwayMap = createRouteMap;
