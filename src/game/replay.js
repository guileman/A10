// Repetición instantánea: graba los últimos segundos del combate y los reproduce desde una cámara fija en el suelo,
// junto al blanco, como la de un observador. Sin three ni DOM: solo datos y geometría (se prueba en Node).

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Copia los campos del estado del avión que usan el modelo, el audio y el arma. */
function acSnapshot(s, cg) {
  const cs = s.controlSurfaces || {}, e = s.engine || {}, a = s.air || {}, gr = s.gear || {};
  return {
    pos: s.pos.slice(), quat: s.quat.slice(), vel: s.vel.slice(), cgModel: (s.cgModel || cg || [0, 0, 0]).slice(),
    controlSurfaces: { aileronLDeg: cs.aileronLDeg, aileronRDeg: cs.aileronRDeg, elevatorDeg: cs.elevatorDeg, rudderDeg: cs.rudderDeg, flapsDeg: cs.flapsDeg, speedbrakeDeg: cs.speedbrakeDeg },
    gear: { extension: gr.extension, state: gr.state, units: [] },
    engine: { rpmPct: e.rpmPct, thrustN: e.thrustN, stall: false },
    air: { iasKt: a.iasKt, tempK: a.tempK, altAglM: a.altAglM, gs: a.gs },
    flags: {}, warnings: [], nozzles: {}, rcs: {},
  };
}

/**
 * createRecorder({ seconds }) → grabador circular.
 * push(t, s, cg, weapons, convoy, fx) cada cuadro de vuelo; fx = eventos visuales del cuadro
 * ({type:'impact'|'hit'|'explosion'|'kill', pos, size?}).
 */
export function createRecorder({ seconds = 14 } = {}) {
  const frames = [];
  const rec = {
    frames,
    push(t, s, cg, weapons, convoy, fx) {
      const R = weapons.rounds, rounds = new Float32Array(R.length * 6);
      for (let i = 0; i < R.length; i++) { const r = R[i], o = i * 6; rounds[o] = r.pos[0]; rounds[o + 1] = r.pos[1]; rounds[o + 2] = r.pos[2]; rounds[o + 3] = r.vel[0]; rounds[o + 4] = r.vel[1]; rounds[o + 5] = r.vel[2]; }
      const missiles = [];
      for (const m of weapons.missiles) if (m.alive) missiles.push({ ref: m, pos: m.pos.slice(), dir: (m.dir || [1, 0, 0]).slice(), motor: !!m.motor });
      const V = convoy.vehicles, veh = new Float32Array(V.length * 5), vstate = new Array(V.length);
      for (let i = 0; i < V.length; i++) { const v = V[i], o = i * 5; veh[o] = v.pos[0]; veh[o + 1] = v.pos[1]; veh[o + 2] = v.pos[2]; veh[o + 3] = v.heading; veh[o + 4] = v.burnT || 0; vstate[i] = v.state; }
      let pyl = 0; weapons.pylons.forEach((p, i) => { if (p.loaded) pyl |= 1 << i; });
      frames.push({ t, ac: acSnapshot(s, cg), rounds, missiles, veh, vstate, pyl, firing: !!weapons.firing, spin: weapons.spin || 0, fx: fx && fx.length ? fx.map((e) => ({ type: e.type, pos: e.pos.slice(), size: e.size })) : null });
      while (frames.length && frames[0].t < t - seconds) frames.shift();
    },
    clear() { frames.length = 0; },
    get start() { return frames.length ? frames[0].t : 0; },
    get end() { return frames.length ? frames[frames.length - 1].t : 0; },
    /** Índice del último cuadro con t <= tt (búsqueda binaria). */
    indexAt(tt) {
      let lo = 0, hi = frames.length - 1;
      if (hi < 0) return -1;
      if (tt <= frames[0].t) return 0;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (frames[mid].t <= tt) lo = mid; else hi = mid - 1; }
      return lo;
    },
  };
  return rec;
}

/**
 * Momentos dignos de repetición: derribos, explosiones de misil y ráfagas del cañón con impactos.
 * add(kind, t, pos) fusiona los que caen a menos de 2,5 s (gana el de mayor prioridad: kill > explosion > burst).
 */
export function createMoments() {
  const PRI = { kill: 3, explosion: 2, burst: 1 };
  const list = [];
  return {
    list,
    add(kind, t, pos) {
      const last = list[list.length - 1];
      if (last && Math.abs(t - last.t) < 2.5) {
        if (PRI[kind] >= PRI[last.kind]) { last.kind = kind; last.t = t; last.pos = pos.slice(); }
        return last;
      }
      const m = { kind, t, pos: pos.slice() }; list.push(m); if (list.length > 20) list.shift();
      return m;
    },
    last() { return list[list.length - 1] || null; },
    clear() { list.length = 0; },
  };
}

/**
 * Posición de la cámara de suelo: detrás del blanco (visto desde el avión al inicio de la repetición) y a un costado,
 * a la altura de los ojos. Así el blanco queda en primer plano y el avión llega de frente, picando hacia la cámara.
 */
export function groundCameraPos(P, A, height, { back = 50, side = 26, eye = 1.8, bounds = null } = {}) {
  let dx = A[0] - P[0], dz = A[2] - P[2]; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
  const px = -dz, pz = dx;
  let x = P[0] - dx * back + px * side, z = P[2] - dz * back + pz * side;
  if (bounds) { const m = 50; x = clamp(x, bounds.xMin + m, bounds.xMax - m); z = clamp(z, bounds.zMin + m, bounds.zMax - m); }
  return [x, height(x, z) + eye, z];
}

/**
 * Encuadre: dirección y FOV vertical (°) que contienen al avión A y al blanco P vistos desde C.
 * Con el avión lejos queda un teleobjetivo; al pasar cerca se abre. Si no entran los dos, se privilegia el blanco.
 */
export function frameShot(C, A, P, out = { dir: [0, 0, -1], fovDeg: 40 }) {
  const da = [A[0] - C[0], A[1] - C[1], A[2] - C[2]], dp = [P[0] - C[0], P[1] + 1.5 - C[1], P[2] - C[2]];
  const la = Math.hypot(...da) || 1, lp = Math.hypot(...dp) || 1;
  for (let i = 0; i < 3; i++) { da[i] /= la; dp[i] /= lp; }
  const ang = Math.acos(clamp(da[0] * dp[0] + da[1] * dp[1] + da[2] * dp[2], -1, 1)) * 180 / Math.PI;
  let wa = 0.5, fov = ang * 1.35 + 7;
  if (ang > 55) { wa = 0.3; fov = 75; }                       // no entran: el blanco manda
  fov = Math.max(fov, 2 * Math.atan(12 / la) * 180 / Math.PI); // el avión (~17 m) entra entero
  const d = [da[0] * wa + dp[0] * (1 - wa), da[1] * wa + dp[1] * (1 - wa), da[2] * wa + dp[2] * (1 - wa)];
  const l = Math.hypot(...d) || 1;
  out.dir[0] = d[0] / l; out.dir[1] = d[1] / l; out.dir[2] = d[2] / l; out.fovDeg = clamp(fov, 8, 75);
  return out;
}
