import test from 'node:test';
import assert from 'node:assert/strict';
import { A10Sim } from '../../src/physics/index.js';
import { createConvoy } from '../../src/game/targets.js';
import { WeaponSystem, GUN } from '../../src/game/weapons.js';

const flat = { height: () => 0, normal: (x, z, o) => { o[0] = 0; o[1] = 1; o[2] = 0; return o; }, surface: () => 2, bounds: { xMin: -1e5, xMax: 1e5, zMin: -1e5, zMax: 1e5 } };

test('convoy sigue la ruta y se detiene al final', () => {
  const c = createConvoy({ route: [[0, 0], [2000, 0]], count: 6, world: flat, speed: 12 });
  const s0 = c.vehicles[0].s;
  for (let i = 0; i < 600; i++) c.step(0.05);
  assert.ok(c.vehicles[0].s > s0 + 300);
  for (const v of c.vehicles) assert.ok(Math.abs(v.pos[2]) < 0.01 && v.pos[0] <= 2000 + 1e-6);
});

test('daño destruye y alerta al convoy', () => {
  const c = createConvoy({ route: [[0, 0], [2000, 0]], count: 4, world: flat });
  const v = c.vehicles[0];
  while (v.state !== 'burning') c.damage(v, 10, 'gun');
  assert.equal(c.alerted, true);
  assert.equal(c.alive().length, 3);
  const ev = c.drainEvents().map((e) => e.type);
  assert.ok(ev.includes('kill') && ev.includes('alert'));
});

function aircraftAt(x, y, z, pitchDeg) {
  const sim = new A10Sim({ seed: 1 });
  sim.reset({ x, z, headingDeg: 90, state: 'cruise', speedKt: 300, y, gearDown: false });
  const st = sim.getState();
  // forzar actitud de picada (rumbo este = +x)
  const p = pitchDeg * Math.PI / 180, ys = -Math.PI / 2; // body x -> world +x
  st.quat = [0, 0, Math.sin(p / 2), Math.cos(p / 2)];
  return { sim, st };
}

test('ráfaga en picada impacta cerca del CCIP y destruye un camión', () => {
  const { sim, st } = aircraftAt(0, 600, 0, -20);
  st.vel = [150 * Math.cos(-20 * Math.PI / 180), 150 * Math.sin(-20 * Math.PI / 180), 0];
  const w = new WeaponSystem({ geometry: sim.geom, mavericks: 2 });
  const ccip = w.ccipGun(st, flat);
  assert.ok(ccip && ccip[0] > 1000 && ccip[0] < 2200, 'ccip ' + (ccip && ccip[0]));
  const c = createConvoy({ route: [[ccip[0] - 50, 0], [ccip[0] + 2000, 0]], count: 1, world: flat, speed: 0 });
  c.vehicles[0].s = 50; c.vehicles[0].cruise = 0; c.step(0);
  c.vehicles[0].type = 'truck';
  const s = { ...st };
  for (let i = 0; i < 180; i++) w.step(1 / 60, s, { triggerGun: i < 60 }, flat, c, sim);
  assert.equal(c.vehicles[0].state, 'burning');
  assert.ok(w.ammo < GUN.rounds - 30);
});

test('misil bloqueado alcanza un blanco en movimiento', () => {
  const { sim, st } = aircraftAt(0, 1000, 0, -12);
  st.vel = [150, -30, 0];
  const w = new WeaponSystem({ geometry: sim.geom, mavericks: 2 });
  const c = createConvoy({ route: [[4500, -200], [4500, 3000]], count: 1, world: flat, speed: 12 });
  c.vehicles[0].type = 'tank'; c.step(0);
  assert.ok(w.lock(st, c.vehicles));
  for (let i = 0; i < 60; i++) w.step(1 / 60, st, {}, flat, c, sim);
  assert.ok(w.fireMissile(st));
  let t = 0;
  while (t < 40 && c.vehicles[0].state === 'moving') { w.step(1 / 30, st, {}, flat, c, sim); c.step(1 / 30); t += 1 / 30; }
  assert.equal(c.vehicles[0].state, 'burning', 'el tanque no fue destruido');
  assert.equal(w.missilesLeft(), 1);
});

import { createRecorder, createMoments, groundCameraPos, frameShot } from '../../src/game/replay.js';

test('repetición: el grabador guarda ~14 s y encuentra el cuadro por tiempo', () => {
  const rec = createRecorder({ seconds: 14 });
  const s = { pos: [0, 100, 0], quat: [0, 0, 0, 1], vel: [150, 0, 0], controlSurfaces: {}, engine: {}, air: { tempK: 288 }, gear: {} };
  const W = { rounds: [{ pos: [1, 2, 3], vel: [900, 0, 0] }], missiles: [], pylons: [{ loaded: true }, { loaded: false }], firing: true, spin: 1 };
  const C = { vehicles: [{ pos: [10, 0, 10], heading: 1, state: 'moving', burnT: 0 }] };
  for (let i = 0; i <= 1000; i++) { s.pos[0] = i; rec.push(i / 50, s, [0, 0, 0], W, C, i === 500 ? [{ type: 'kill', pos: [5, 0, 5] }] : null); }
  assert.ok(rec.end - rec.start <= 14 + 1e-9 && rec.end - rec.start > 13.9, 'ventana de 14 s');
  const f = rec.frames[rec.indexAt(10)];
  assert.equal(f.t, 10); assert.equal(f.ac.pos[0], 500, 'copia, no referencia');
  assert.equal(f.fx[0].type, 'kill'); assert.equal(f.pyl, 1); assert.equal(f.rounds[3], 900); assert.equal(f.vstate[0], 'moving');
  assert.equal(rec.indexAt(-5), 0); assert.equal(rec.indexAt(1e9), rec.frames.length - 1);
});

test('repetición: momentos cercanos se fusionan y gana el derribo', () => {
  const M = createMoments();
  M.add('burst', 10, [0, 0, 0]); M.add('kill', 11, [5, 0, 5]); M.add('burst', 12, [9, 0, 9]);
  assert.equal(M.list.length, 1); assert.equal(M.last().kind, 'kill'); assert.deepEqual(M.last().pos, [5, 0, 5]);
  M.add('explosion', 20, [1, 0, 1]); assert.equal(M.list.length, 2);
});

test('repetición: la cámara de suelo queda detrás del blanco, a la altura de los ojos, y encuadra avión y blanco', () => {
  const P = [0, 50, 0], A = [3000, 900, 0];
  const C = groundCameraPos(P, A, () => 50);
  assert.equal(C[1], 51.8);
  assert.ok(C[0] < P[0] - 30, 'detrás del blanco visto desde el avión');
  const sh = frameShot(C, A, P);
  const ang = (u, v) => Math.acos(u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) * 180 / Math.PI;
  const unit = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
  const dA = unit([A[0] - C[0], A[1] - C[1], A[2] - C[2]]), dP = unit([P[0] - C[0], P[1] + 1.5 - C[1], P[2] - C[2]]);
  assert.ok(ang(sh.dir, dA) < sh.fovDeg / 2 && ang(sh.dir, dP) < sh.fovDeg / 2, 'los dos dentro del cuadro (FOV ' + sh.fovDeg.toFixed(1) + '°)');
  const near = frameShot(C, [10, 120, 0], P);
  assert.ok(near.fovDeg > sh.fovDeg, 'se abre cuando el avión pasa cerca');
});
