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
