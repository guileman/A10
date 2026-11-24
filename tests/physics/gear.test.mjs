import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HarrierSim, loadGeometry } from '../../src/physics/index.js';
import { baseControls } from './helpers.mjs';

const G0 = 9.80665;

test('geometría: conversión marco CAD (z arriba) -> marco cuerpo (y arriba)', () => {
  const g = loadGeometry();
  assert.equal(g.frame, 'cad-zup');
  assert.ok(g.gear.nose.axle[1] < -2, 'eje de rueda de proa debajo del origen (y cuerpo)');
  assert.equal(g.gear.main.tireCount, 2);
  assert.ok(g.gear.outriggerR.axle[2] > 2 && g.gear.outriggerL.axle[2] < -2, 'z cuerpo = derecha');
  const d = loadGeometry({});
  assert.equal(d.frame, 'body');
});

test('cargas estáticas por rueda: suman el peso y coinciden con el diseño', () => {
  const sim = new HarrierSim({ seed: 1 });
  sim.reset({ state: 'parked' });
  const c = baseControls({ parkingBrake: true });
  for (let i = 0; i < 120; i++) sim.step(1 / 60, c);
  const s = sim.getState();
  const W = s.massKg * G0;
  const loads = Object.fromEntries(s.gear.units.map((u) => [u.id, u.loadN]));
  const sum = Object.values(loads).reduce((a, b) => a + b, 0);
  const share = Object.fromEntries(Object.entries(loads).map(([k, v]) => [k, (100 * v / W).toFixed(1) + ' %']));
  console.log('  reparto estático:', JSON.stringify(share), `suma/W = ${(sum / W).toFixed(4)}`);
  console.log('  compresión:', s.gear.units.map((u) => `${u.id} ${(u.compressionFrac * 100).toFixed(0)} % brazo ${u.armAngleDeg.toFixed(2)}°`).join(', '));
  assert.ok(Math.abs(sum / W - 1) < 0.02);
  for (const id of ['nose', 'main', 'outriggerL', 'outriggerR']) {
    assert.ok(Math.abs(loads[id] - sim.staticLoads[id]) < 0.05 * W, `${id} cerca de la carga de diseño`);
  }
  for (const u of s.gear.units) {
    assert.ok(u.contact && u.compressionFrac > 0.2 && u.compressionFrac < 0.95, `${u.id} con carrera estática útil`);
    assert.ok(Math.abs(u.armAngleDeg) < 1.5, `${u.id} brazo cerca de su ángulo estático`);
    assert.ok(Number.isFinite(u.wheelPosWorld[1]));
  }
  assert.ok(Math.abs(s.att.rollDeg) < 0.2);
});

test('caída de 0,3 m: sin daño; caída de 2,5 m: colapso del tren', () => {
  const sim = new HarrierSim({ seed: 1 });
  sim.reset({ state: 'parked' }); sim.pos[1] += 0.3;
  const c = baseControls();
  let maxFrac = 0;
  for (let i = 0; i < 300; i++) { sim.step(1 / 60, c); maxFrac = Math.max(maxFrac, ...sim.getState().gear.units.map((u) => u.compressionFrac)); }
  assert.ok(sim.events.some((e) => e.type === 'touchdown'));
  assert.ok(!sim.getState().flags.crashed);
  assert.ok(maxFrac > 0.75 && maxFrac <= 1.0);
  sim.reset({ state: 'parked' }); sim.pos[1] += 2.5;
  for (let i = 0; i < 300; i++) sim.step(1 / 60, c);
  assert.ok(sim.getState().flags.crashed);
  console.log(`  caída 0,3 m: carrera máx ${(maxFrac * 100).toFixed(0)} %; caída 2,5 m: ${sim.crashReason}`);
});

test('rodaje, frenado y dirección de rueda de proa', () => {
  const sim = new HarrierSim({ seed: 1 });
  sim.reset({ state: 'parked' });
  let c = baseControls({ throttle: 0.55 });
  let t = 0;
  while (sim.getState().air.gs < 15 && t < 60) { sim.step(1 / 60, c); t += 1 / 60; }
  const z0 = sim.getState().pos[2];
  c = baseControls({ throttle: 0, brake: 1 });
  let tb = 0;
  while (sim.getState().air.gs > 0.3 && tb < 60) { sim.step(1 / 60, c); tb += 1 / 60; }
  const dist = z0 - sim.getState().pos[2];
  console.log(`  0→15 m/s en ${t.toFixed(1)} s; frenado 15→0 en ${dist.toFixed(1)} m (${tb.toFixed(1)} s, desac. media ${(15 / tb).toFixed(2)} m/s²)`);
  assert.ok(dist > 20 && dist < 150);
  // Giro a baja velocidad con pedal derecho: rumbo crece (horario).
  sim.reset({ state: 'parked' });
  c = baseControls({ throttle: 0.45 });
  t = 0; while (sim.getState().air.gs < 2.5 && t < 60) { sim.step(1 / 60, c); t += 1 / 60; }
  c = baseControls({ throttle: 0.2, yaw: 0.6 });
  for (let i = 0; i < 180; i++) sim.step(1 / 60, c);
  const s = sim.getState();
  const nose = s.gear.units.find((u) => u.id === 'nose');
  console.log(`  giro: rumbo ${s.att.headingDeg.toFixed(1)}°, dirección proa ${nose.steerDeg.toFixed(1)}°, alabeo ${s.att.rollDeg.toFixed(2)}°`);
  assert.ok(s.att.headingDeg > 5 && s.att.headingDeg < 180);
  assert.ok(!s.flags.crashed);
});

test('tren: recogida con tiempos, enclavamiento con peso en ruedas', () => {
  const sim = new HarrierSim({ seed: 1 });
  sim.reset({ state: 'parked' });
  const c = baseControls({ gearDown: false });
  for (let i = 0; i < 60; i++) sim.step(1 / 60, c);
  assert.equal(sim.getState().gear.state, 'down', 'no se recoge con peso en ruedas');
  sim.reset({ state: 'cruise', speedKt: 200, gearDown: true, aglM: 500 });
  for (let i = 0; i < 60 * 3; i++) sim.step(1 / 60, { ...c, throttle: sim.getState().trim.throttle });
  assert.equal(sim.getState().gear.state, 'transit');
  for (let i = 0; i < 60 * 5; i++) sim.step(1 / 60, { ...c, throttle: sim.getState().trim.throttle });
  assert.equal(sim.getState().gear.state, 'up');
  assert.ok(sim.events.some((e) => e.type === 'gearLock' && e.data.down === false));
});
