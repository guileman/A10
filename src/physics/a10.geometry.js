// Geometría del A-10C en "marco modelo" = ejes cuerpo del contrato (x proa, y arriba, z derecha), metros.
// loadA10Geometry(raw) normaliza lo que entregue el agente de mallas (src/physics/a10.geometry.json) y
// completa todo campo faltante con A10_GEOMETRY_DEFAULTS. Ninguna posición está fija en el resto del código.
//
// Defaults: origen = CG de diseño (vacío + piloto), y = 0 en esa altura. Cotas reales usadas [W]: largo
// 16,26 m, envergadura 17,53 m, altura 4,47 m; rueda de proa desplazada a la DERECHA [W]. Distancia entre
// ejes 5,40 m y trocha 5,25 m: ESTIMADO (cifras de divulgación). Neumáticos: principal 36×11 (r 0,457 m),
// proa 24×7,7 (r 0,305 m): ESTIMADO. Resto: ESTIMADO sobre vistas del avión (ver PHYSICS_A10.md §Geometría).
//
// Marcos aceptados en el JSON (`frame`): 'body' (por defecto), 'cad-zup' (x proa, y izquierda, z arriba ->
// cuerpo (x, z, −y)), 'cad-zup-yright' (x, z, y) y 'three' (sinónimo de 'body').

const DEFAULTS = Object.freeze({
  frame: 'body',
  lengthM: 16.26, spanM: 17.53,
  eyeModel: [5.55, 1.05, 0],
  gear: {
    nose: { axle: [4.65, -1.445, 0.35], wheelRadius: 0.305, tireWidth: 0.20, attach: [4.75, -0.25, 0.35] },
    mainL: { axle: [-0.75, -1.29, -2.625], wheelRadius: 0.457, tireWidth: 0.28, attach: [-0.75, -0.15, -2.625] },
    mainR: { axle: [-0.75, -1.29, 2.625], wheelRadius: 0.457, tireWidth: 0.28, attach: [-0.75, -0.15, 2.625] },
  },
  // Toberas de los TF34 (punto de aplicación del empuje) y dirección del empuje en cuerpo.
  engines: {
    L: { pos: [-4.6, 1.25, -1.65], dir: [1, 0, 0] },
    R: { pos: [-4.6, 1.25, 1.65], dir: [1, 0, 0] },
  },
  // Boca del cañón (caño que dispara, sobre la línea central) y su dirección. Sólo se usa como punto de
  // aplicación de fuerzas externas genéricas (ver A10Sim.setExternalForce).
  gun: { muzzle: [8.10, -0.72, 0.0], dir: [1, 0, 0] },
  // Estaciones de carga externa 1..11 (izquierda a derecha); sólo masa, CG y resistencia.
  stations: [
    { id: 1, pos: [0.10, -0.55, -7.0] }, { id: 2, pos: [0.25, -0.65, -5.9] }, { id: 3, pos: [0.40, -0.75, -4.4] },
    { id: 4, pos: [0.45, -0.85, -2.9] }, { id: 5, pos: [0.50, -1.00, -1.05] }, { id: 6, pos: [0.50, -1.05, 0] },
    { id: 7, pos: [0.50, -1.00, 1.05] }, { id: 8, pos: [0.45, -0.85, 2.9] }, { id: 9, pos: [0.40, -0.75, 4.4] },
    { id: 10, pos: [0.25, -0.65, 5.9] }, { id: 11, pos: [0.10, -0.55, 7.0] },
  ],
  // Puntos duros para contacto de estructura con el suelo (ESTIMADOS).
  hardpoints: [
    { id: 'noseTip', pos: [7.85, -0.35, 0] },
    { id: 'gunMuzzle', pos: [8.10, -0.80, 0] },
    { id: 'bellyFwd', pos: [3.0, -1.05, 0] },
    { id: 'bellyAft', pos: [-3.0, -0.85, 0] },
    { id: 'tailcone', pos: [-7.6, 0.05, 0] },
    { id: 'stabTipL', pos: [-7.7, 0.55, -2.85] }, { id: 'stabTipR', pos: [-7.7, 0.55, 2.85] },
    { id: 'wingtipL', pos: [0.15, 0.05, -8.76] }, { id: 'wingtipR', pos: [0.15, 0.05, 8.76] },
    { id: 'nacelleL', pos: [-4.6, 0.65, -1.65] }, { id: 'nacelleR', pos: [-4.6, 0.65, 1.65] },
  ],
  cgModel: null, // null -> lo calcula la física (con defaults da ≈ [0, 0, 0])
});

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isVec = (v) => Array.isArray(v) && v.length === 3 && v.every(isNum);

function detectFrame(raw) {
  if (typeof raw.frame === 'string') return raw.frame === 'three' ? 'body' : raw.frame;
  if (isNum(raw.scaleMPerUnit) || /z\s*arriba/i.test(raw._note || '')) return 'cad-zup';
  return 'body';
}

/** Normaliza el JSON crudo (o {} / undefined). Devuelve un objeto nuevo; no muta el argumento. */
export function loadA10Geometry(raw) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const frame = detectFrame(raw);
  const conv = frame === 'cad-zup' ? (p) => [p[0], p[2], -p[1]]
    : frame === 'cad-zup-yright' ? (p) => [p[0], p[2], p[1]] : (p) => [p[0], p[1], p[2]];
  const D = DEFAULTS;
  const pick = (r) => (isVec(r) ? r : r && isVec(r.pos) ? r.pos : null);
  const g = { frame, source: Object.keys(raw).length ? 'json' : 'defaults', notes: [] };
  const P = (v, def, name) => { if (isVec(v)) return conv(v); if (name) g.notes.push(`${name}: por defecto`); return def.slice(); };

  g.lengthM = isNum(raw.lengthM) ? raw.lengthM : D.lengthM;
  g.spanM = isNum(raw.spanM) ? raw.spanM : D.spanM;
  g.eyeModel = P(raw.eyeModel || raw.eyeLocal, D.eyeModel, 'eyeModel');

  // Tren: nose, mainL, mainR. También acepta `main.wheelCenters` [[L],[R]] o `mainLeft/mainRight`.
  const rg = raw.gear || {};
  const alias = { nose: ['nose'], mainL: ['mainL', 'mainLeft', 'leftMain'], mainR: ['mainR', 'mainRight', 'rightMain'] };
  g.gear = {};
  for (const id of ['nose', 'mainL', 'mainR']) {
    let r = null;
    for (const a of alias[id]) if (rg[a]) { r = rg[a]; break; }
    if (!r && id !== 'nose' && rg.main && Array.isArray(rg.main.wheelCenters) && rg.main.wheelCenters.length === 2) {
      const cs = rg.main.wheelCenters.map(conv).sort((a, b) => a[2] - b[2]);
      r = { ...rg.main, _axleBody: id === 'mainL' ? cs[0] : cs[1] };
    }
    r = r || {};
    const d = D.gear[id];
    const u = { id };
    if (r._axleBody) u.axle = r._axleBody;
    else if (isVec(r.axle)) u.axle = conv(r.axle);
    else if (isVec(r.wheelCenter)) u.axle = conv(r.wheelCenter);
    else { u.axle = d.axle.slice(); g.notes.push(`gear.${id}: eje por defecto`); }
    u.tireOffsets = [0]; u.tireCount = 1;
    u.wheelRadius = isNum(r.wheelRadius) ? r.wheelRadius : d.wheelRadius;
    u.tireWidth = isNum(r.tireWidth) ? r.tireWidth : d.tireWidth;
    u.attach = isVec(r.attach) ? conv(r.attach) : isVec(r.legTop) ? conv(r.legTop) : [u.axle[0] + (d.attach[0] - d.axle[0]), d.attach[1] - d.axle[1] + u.axle[1], u.axle[2]];
    u.pivot = isVec(r.pivot) ? conv(r.pivot) : null;
    u.armLength = isNum(r.armLength) ? r.armLength : null;
    g.gear[id] = u;
  }

  const re = raw.engines || {};
  g.engines = {};
  for (const id of ['L', 'R']) {
    const r = re[id] || re[id === 'L' ? 'left' : 'right'];
    const pos = pick(r);
    const dir = r && isVec(r.dir) ? conv(r.dir) : D.engines[id].dir.slice();
    const dl = Math.hypot(...dir) || 1;
    g.engines[id] = { pos: pos ? conv(pos) : D.engines[id].pos.slice(), dir: dir.map((v) => v / dl) };
    if (!pos) g.notes.push(`engines.${id}: por defecto`);
  }

  const rgun = raw.gun || {};
  g.gun = { muzzle: P(rgun.muzzle || rgun.muzzlePos, D.gun.muzzle, 'gun.muzzle'), dir: isVec(rgun.dir) ? conv(rgun.dir) : D.gun.dir.slice() };

  if (Array.isArray(raw.stations) && raw.stations.length) {
    g.stations = raw.stations.map((s, i) => ({ id: s.id ?? i + 1, pos: pick(s) ? conv(pick(s)) : (D.stations[i] || D.stations[5]).pos.slice() }));
  } else if (raw.stations && typeof raw.stations === 'object') {
    g.stations = Object.entries(raw.stations).map(([k, s]) => ({ id: isNaN(+k) ? k : +k, pos: pick(s) ? conv(pick(s)) : D.stations[5].pos.slice() }));
  } else g.stations = D.stations.map((s) => ({ id: s.id, pos: s.pos.slice() }));

  g.hardpoints = Array.isArray(raw.hardpoints) && raw.hardpoints.some((h) => h && isVec(h.pos))
    ? raw.hardpoints.filter((h) => h && isVec(h.pos)).map((h) => ({ id: h.id || 'hp', pos: conv(h.pos) }))
    : D.hardpoints.map((h) => ({ id: h.id, pos: h.pos.slice() }));

  g.cgModel = isVec(raw.cgModel) ? conv(raw.cgModel) : null;
  return g;
}

export { DEFAULTS as A10_GEOMETRY_DEFAULTS };
