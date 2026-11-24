// Geometría del avión en "marco modelo" = ejes cuerpo del contrato (x proa, y arriba, z derecha), metros.
// loadGeometry(raw) normaliza lo que entregue el orquestador (src/physics/harrier.geometry.json) y completa
// con valores por defecto. NINGUNA posición de rueda/tobera/válvula está fija en el resto del código.
//
// El JSON entregado (nov-2026) viene en marco CAD de terna derecha: x proa, y = IZQUIERDA, z arriba.
// Conversión: cuerpo = [x_cad, z_cad, −y_cad]. Se detecta por `frame:"cad-zup"`, por `scaleMPerUnit` o por
// el texto "z arriba" en `_note`. `frame:"cad-zup-yright"` (y = derecha, versión preliminar) -> [x, z, y].
// Con `frame:"body"` se toman tal cual.

const DEFAULT_RAW = Object.freeze({
  frame: 'body',
  // Valores por defecto = los del modelo CAD entregado, convertidos a marco cuerpo. Coinciden en orden
  // de magnitud con el avión real (largo 13,9–14,3 m, envergadura 7,7 m) salvo donde se indica en PHYSICS.md.
  lengthM: 14.09,
  eyeModel: [3.762, 0.502, 0],
  gear: {
    nose: { axle: [1.567, -2.633, 0], wheelRadius: 0.334, tireWidth: 0.22, tireCount: 1, attach: [1.965, -1.17, 0] },
    main: { axle: [-1.308, -2.387, 0], tireOffsets: [-0.238, 0.238], wheelRadius: 0.334, tireWidth: 0.22, tireCount: 2, attach: [-1.308, -1.045, 0] },
    outriggerL: { axle: [-1.492, -2.479, -2.475], wheelRadius: 0.226, tireWidth: 0.13, tireCount: 1, attach: [-1.492, -0.736, -2.475] },
    outriggerR: { axle: [-1.492, -2.479, 2.475], wheelRadius: 0.226, tireWidth: 0.13, tireCount: 1, attach: [-1.492, -0.736, 2.475] },
  },
  nozzles: {
    frontL: { pos: [1.17, -1.003, -0.874], radius: 0.36 },
    frontR: { pos: [1.17, -1.003, 0.874], radius: 0.36 },
    rearL: { pos: [-1.108, -0.865, -0.752], radius: 0.34 },
    rearR: { pos: [-1.108, -0.865, 0.752], radius: 0.34 },
  },
  // Labios de toma de aire (no vienen en el JSON): ESTIMADO, a los lados de la cabina, detrás del piloto.
  intake: { L: [2.9, -0.55, -0.95], R: [2.9, -0.55, 0.95] },
  rcs: {
    nose: { pos: [6.27, -1.045, 0] },
    tail: { pos: [-7.106, 0.0, 0] },
    tailYaw: { pos: [-7.106, 0.836, 0] },
    wingL: { pos: [-1.923, -0.961, -4.807] },
    wingR: { pos: [-1.923, -0.961, 4.807] },
  },
  // Puntos duros de fuselaje/alas para contacto con el suelo (ESTIMADOS sobre el modelo).
  hardpoints: [
    { id: 'noseTip', pos: [6.98, -1.15, 0] },
    { id: 'bellyFwd', pos: [3.0, -1.55, 0] },
    { id: 'bellyAft', pos: [-3.2, -1.45, 0] },
    { id: 'tailBumper', pos: [-5.8, -1.35, 0] },
    { id: 'tailcone', pos: [-7.11, -0.45, 0] },
    { id: 'wingtipL', pos: [-1.923, -1.05, -4.807] },
    { id: 'wingtipR', pos: [-1.923, -1.05, 4.807] },
  ],
  cgModel: null, // null -> lo calcula la física (ver harrier.sim.js / PHYSICS.md §CG)
});

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isVec = (v) => Array.isArray(v) && v.length === 3 && v.every(isNum);

function detectFrame(raw) {
  if (raw.frame) return raw.frame;
  if (isNum(raw.scaleMPerUnit) || /z\s*arriba/i.test(raw._note || '')) return 'cad-zup';
  return 'body';
}

/** Normaliza el JSON crudo. Devuelve un objeto nuevo (no muta el argumento). */
export function loadGeometry(raw = {}) {
  raw = raw || {};
  const frame = detectFrame(raw);
  const conv = frame === 'cad-zup' ? (p) => [p[0], p[2], -p[1]]
    : frame === 'cad-zup-yright' ? (p) => [p[0], p[2], p[1]] : (p) => [p[0], p[1], p[2]];
  const P = (v, def) => (isVec(v) ? conv(v) : def.slice());
  const D = DEFAULT_RAW;
  const g = { frame, source: raw === DEFAULT_RAW ? 'defaults' : 'json', notes: [] };

  g.lengthM = isNum(raw.lengthM) ? raw.lengthM : D.lengthM;
  g.eyeModel = P(raw.eyeModel || raw.eyeLocal, D.eyeModel);

  g.gear = {};
  const rg = raw.gear || {};
  for (const id of ['nose', 'main', 'outriggerL', 'outriggerR']) {
    const d = D.gear[id], r = rg[id] || {};
    const u = { id };
    if (isVec(r.axle)) u.axle = conv(r.axle);
    else if (isVec(r.wheelCenter)) u.axle = conv(r.wheelCenter);
    else if (Array.isArray(r.wheelCenters) && r.wheelCenters.length && r.wheelCenters.every(isVec)) {
      const cs = r.wheelCenters.map(conv);
      u.axle = [0, 1, 2].map((k) => cs.reduce((s, c) => s + c[k], 0) / cs.length);
      u.tireOffsets = cs.map((c) => c[2] - u.axle[2]).sort((a, b) => a - b);
    } else { u.axle = d.axle.slice(); g.notes.push(`gear.${id}: eje por defecto`); }
    if (!u.tireOffsets) u.tireOffsets = d.tireOffsets ? d.tireOffsets.slice() : [0];
    u.tireCount = u.tireOffsets.length;
    u.wheelRadius = isNum(r.wheelRadius) ? r.wheelRadius : d.wheelRadius;
    u.tireWidth = isNum(r.tireWidth) ? r.tireWidth : d.tireWidth;
    u.attach = isVec(r.attach) ? conv(r.attach) : isVec(r.legTop) ? conv(r.legTop) : d.attach.slice();
    u.pivot = isVec(r.pivot) ? conv(r.pivot) : null;
    u.armLength = isNum(r.armLength) ? r.armLength : null;
    g.gear[id] = u;
  }

  g.nozzles = {};
  const rn = raw.nozzles || {};
  for (const id of ['frontL', 'frontR', 'rearL', 'rearR']) {
    const r = rn[id];
    const pos = isVec(r) ? r : r && isVec(r.pos) ? r.pos : null;
    g.nozzles[id] = { pos: pos ? conv(pos) : D.nozzles[id].pos.slice(), radius: r && isNum(r.radius) ? r.radius : D.nozzles[id].radius };
  }

  const ri = raw.intake || {};
  g.intake = { L: P(ri.L, D.intake.L), R: P(ri.R, D.intake.R) };

  const rr = raw.rcs || {};
  const alias = { nose: ['nose', 'noseVertical'], tail: ['tail', 'tailVertical'], tailYaw: ['tailYaw'], wingL: ['wingL', 'wingtipL'], wingR: ['wingR', 'wingtipR'] };
  g.rcs = {};
  for (const id of Object.keys(alias)) {
    let pos = null;
    for (const a of alias[id]) { const r = rr[a]; if (isVec(r)) pos = r; else if (r && isVec(r.pos)) pos = r.pos; if (pos) break; }
    g.rcs[id] = { pos: pos ? conv(pos) : D.rcs[id].pos.slice() };
  }

  g.hardpoints = Array.isArray(raw.hardpoints)
    ? raw.hardpoints.filter((h) => h && isVec(h.pos)).map((h) => ({ id: h.id || 'hp', pos: conv(h.pos) }))
    : D.hardpoints.map((h) => {
      // Las puntas de ala siguen a las válvulas RCS de punta de ala si vinieron en el JSON.
      if (h.id === 'wingtipL') return { id: h.id, pos: [g.rcs.wingL.pos[0], g.rcs.wingL.pos[1] - 0.09, g.rcs.wingL.pos[2]] };
      if (h.id === 'wingtipR') return { id: h.id, pos: [g.rcs.wingR.pos[0], g.rcs.wingR.pos[1] - 0.09, g.rcs.wingR.pos[2]] };
      return { id: h.id, pos: h.pos.slice() };
    });

  g.cgModel = isVec(raw.cgModel) ? conv(raw.cgModel) : null;
  return g;
}

export { DEFAULT_RAW as GEOMETRY_DEFAULTS };
