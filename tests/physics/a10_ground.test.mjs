import { test } from 'node:test';
import assert from 'node:assert/strict';
import { A10Sim, loadA10Geometry, A10_GEOMETRY_DEFAULTS } from '../../src/physics/index.js';
import { a10Controls, payloadFor, takeoff, headingHold, attitudeHold, clamp, KT, FT, G0 } from './a10helpers.mjs';

test('A-10 geometría: defaults, JSON parcial y marco CAD z-arriba', () => {
  const d = loadA10Geometry();
  assert.equal(d.source, 'defaults');
  assert.ok(d.gear.nose.axle[2] > 0, 'rueda de proa desplazada a la derecha');
  const j = loadA10Geometry({ frame: 'cad-zup', gear: { main: { wheelCenters: [[-0.8, 2.6, -1.3], [-0.8, -2.6, -1.3]], wheelRadius: 0.46 } }, gun: { muzzle: [8, 0.1, -0.7] } });
  assert.deepEqual(j.gear.mainL.axle, [-0.8, -1.3, -2.6]);
  assert.deepEqual(j.gear.mainR.axle, [-0.8, -1.3, 2.6]);
  assert.deepEqual(j.gun.muzzle, [8, -0.7, -0.1]);
  assert.ok(j.notes.some((n) => n.startsWith('gear.nose')), 'avisa campos por defecto');
  assert.equal(j.stations.length, A10_GEOMETRY_DEFAULTS.stations.length);
  const sim = new A10Sim({ geometry: { gear: { nose: { axle: [4.5, -1.4, 0.3] } } } });
  sim.reset({ state: 'parked' });
  assert.ok(!sim.getState().flags.crashed);
});

test('A-10 cargas estáticas por rueda: suman el peso; proa ≈ 13–16 %; izquierda/derecha según el desvío de la proa', () => {
  const sim = new A10Sim({ seed: 1 });
  sim.reset({ state: 'parked' });
  const c = a10Controls({ parkingBrake: true });
  for (let i = 0; i < 120; i++) sim.step(1 / 60, c);
  const s = sim.getState();
  const W = s.massKg * G0;
  const L = Object.fromEntries(s.gear.units.map((u) => [u.id, u.loadN]));
  const sum = L.nose + L.mainL + L.mainR;
  console.log(`  ${s.massKg.toFixed(0)} kg: proa ${(100 * L.nose / W).toFixed(1)} %, izq. ${(100 * L.mainL / W).toFixed(1)} %, der. ${(100 * L.mainR / W).toFixed(1)} %; suma/W ${(sum / W).toFixed(4)}; actitud ${s.att.pitchDeg.toFixed(2)}°/${s.att.rollDeg.toFixed(2)}°; carrera ${s.gear.units.map((u) => (u.compressionFrac * 100).toFixed(0) + ' %').join(' / ')}`);
  assert.ok(Math.abs(sum / W - 1) < 0.01);
  assert.ok(L.nose / W > 0.12 && L.nose / W < 0.18);
  assert.ok(L.mainL > L.mainR, 'proa a la derecha descarga la principal derecha');
  for (const u of s.gear.units) assert.ok(u.compressionFrac > 0.2 && u.compressionFrac < 0.95);
  assert.ok(Math.abs(s.att.rollDeg) < 0.5);
});

test('A-10 despegue a MTOW (23 t, flaps MVR): carrera ≈ 1 200 m', () => {
  const sim = new A10Sim({ seed: 1 });
  sim.reset({ state: 'parked', flaps: 1, payloadKg: payloadFor(23000, sim) });
  assert.ok(Math.abs(sim.mass - 23000) < 1);
  const r = takeoff(sim, { flaps: 1, vrKt: 140, rotDeg: 12 });
  assert.ok(r, 'despegó');
  const c = r.controls;
  let integ = 0;
  for (let i = 0; i < 60 * 10; i++) {
    const s = sim.getState(), err = 11 - s.att.pitchDeg;
    integ = clamp(integ + 0.05 * err / 60, -0.6, 0.6);
    c.pitch = clamp(0.15 * err + integ - 0.3 * s.rates.q * 57.3 / 10, -1, 1);
    if (s.air.altAglM > 10) c.gearDown = false;
    sim.step(1 / 60, c);
  }
  const s = sim.getState();
  console.log(`  23 t: carrera ${r.distM.toFixed(0)} m, despegue a ${r.iasKt.toFixed(0)} KIAS en ${r.timeS.toFixed(1)} s; 10 s después ${s.air.altAglM.toFixed(0)} m AGL, ${s.air.vsMs.toFixed(1)} m/s, ${s.air.iasKt.toFixed(0)} KIAS`);
  assert.ok(r.distM > 900 && r.distM < 1500);
  assert.ok(!s.flags.crashed && s.air.altAglM > 8 && s.air.vsMs > 1, 'sube (despacio: a MTOW el A-10 tiene T/W ≈ 0,36)');
});

test('A-10 despegue liviano (15 t, flaps MVR): bastante más corto', () => {
  const sim = new A10Sim({ seed: 1 });
  sim.reset({ state: 'parked', flaps: 1, fuelKg: 2500 });
  const r = takeoff(sim, { flaps: 1, vrKt: 105, rotDeg: 12 });
  console.log(`  ${sim.mass.toFixed(0)} kg: carrera ${r.distM.toFixed(0)} m, ${r.iasKt.toFixed(0)} KIAS`);
  assert.ok(r.distM > 250 && r.distM < 800);
});

test('A-10 aproximación (flaps DN, 3°), toque y frenado: distancia razonable', () => {
  const sim = new A10Sim({ seed: 2 });
  const app = 130;
  sim.reset({ state: 'cruise', speedKt: app, aglM: 120, fuelKg: 2000, gearDown: true, flaps: 2, x: 0, z: 2300 });
  const c = a10Controls({ throttle: sim.trimInfo.throttle, flaps: 2, gearDown: true });
  let td = null, stop = null, vsTd = 0;
  for (let i = 0; i < 60 * 150 && !stop; i++) {
    const s = sim.getState();
    headingHold(c, s);
    if (!td) {
      const h = s.air.altAglM;
      const vsT = h > 10 ? -app * KT * Math.tan(3 * Math.PI / 180) : -0.6 - 0.04 * h;
      const pitchT = sim.trimInfo.pitchDeg + clamp(2.0 * (vsT - s.air.vsMs), -6, 8);
      attitudeHold(c, s, pitchT, 0, 0.10, 0.35);
      c.throttle = h > 5 ? clamp(sim.trimInfo.throttle + 0.06 * (app - s.air.iasKt), 0, 1) : 0;
    } else {
      c.throttle = 0; c.speedbrake = 1; c.pitch = 0;
      if (sim.t - td.t > 1.5) c.brake = 1;
    }
    sim.step(1 / 60, c);
    const ev = sim.events.find((e) => e.type === 'touchdown');
    if (ev && !td) { const s2 = sim.getState(); td = { t: sim.t, pos: s2.pos.slice(), ias: s2.air.iasKt }; vsTd = ev.data.sinkMs; }
    if (td && sim.getState().air.gs < 0.5) stop = sim.getState();
  }
  assert.ok(td && stop, 'tocó y se detuvo');
  const roll = Math.hypot(stop.pos[0] - td.pos[0], stop.pos[2] - td.pos[2]);
  console.log(`  ${sim.mass.toFixed(0)} kg: toque a ${td.ias.toFixed(0)} KIAS, ${vsTd.toFixed(2)} m/s; carrera de aterrizaje ${roll.toFixed(0)} m; ${sim.events.filter((e) => e.type === 'hardLanding').length} aterrizajes duros`);
  assert.ok(!stop.flags.crashed && vsTd < 3.0);
  assert.ok(roll > 300 && roll < 1100);
});

test('A-10 frenos: ≥ 3,5 m/s² medios en asfalto seco, con anti-deslizamiento', () => {
  const sim = new A10Sim({ seed: 1 });
  sim.reset({ state: 'parked', fuelKg: 3000 });
  const v0 = 80 * KT;
  sim.vel[2] = -v0;
  const p0 = sim.pos.slice();
  const c = a10Controls({ brake: 1 });
  for (let i = 0; i < 60 * 40 && sim.getState().air.gs > 0.3; i++) { headingHold(c, sim.getState()); sim.step(1 / 60, c); }
  const s = sim.getState();
  const d = Math.hypot(s.pos[0] - p0[0], s.pos[2] - p0[2]);
  console.log(`  80 kt → 0 en ${d.toFixed(0)} m, ${s.t.toFixed(1)} s: ${(v0 * v0 / (2 * d)).toFixed(2)} m/s²`);
  assert.ok(v0 * v0 / (2 * d) > 3.5);
  assert.ok(Math.abs(s.att.headingDeg - 0) < 3 || Math.abs(s.att.headingDeg - 360) < 3, 'frena derecho');
});

test('A-10 dirección de rueda de proa: giro cerrado en rodaje lento, autoridad reducida con la velocidad', () => {
  const sim = new A10Sim({ seed: 1 });
  sim.reset({ state: 'parked', fuelKg: 3000 });
  const c = a10Controls({ throttle: 0.25 });
  for (let i = 0; i < 60 * 12; i++) { const s = sim.getState(); c.throttle = s.air.gs > 4 ? 0.0 : 0.3; c.brake = s.air.gs > 4.5 ? 0.2 : 0; sim.step(1 / 60, c); }
  c.yaw = 1;
  const h0 = sim.getState().att.headingDeg;
  for (let i = 0; i < 60 * 6; i++) { const s = sim.getState(); c.throttle = s.air.gs > 4 ? 0.0 : 0.3; c.brake = s.air.gs > 4.5 ? 0.2 : 0; sim.step(1 / 60, c); }
  const s1 = sim.getState();
  const turned = ((s1.att.headingDeg - h0) + 360) % 360;
  const steerLow = s1.gear.units[0].steerDeg;
  sim.reset({ state: 'parked', fuelKg: 3000 });
  sim.vel[2] = -40 * KT;
  for (let i = 0; i < 60 * 2; i++) sim.step(1 / 60, c);
  const steerHigh = sim.getState().gear.units[0].steerDeg;
  console.log(`  ~8 kt: ${turned.toFixed(0)}° en 6 s (dirección ${steerLow.toFixed(1)}°); a 40 kt dirección ${steerHigh.toFixed(1)}°`);
  assert.ok(turned > 45 && turned < 360); // radio ≈ batalla / tan(dirección) ≈ 5 m
  assert.ok(Math.abs(steerHigh) < 8 && Math.abs(steerLow) > 25);
  assert.ok(!s1.flags.crashed);
});

test('A-10 caída: 0,3 m sin daño; 3 m colapsa el tren', () => {
  const sim = new A10Sim({ seed: 1 });
  const c = a10Controls();
  sim.reset({ state: 'parked' }); sim.pos[1] += 0.3;
  let maxFrac = 0;
  for (let i = 0; i < 300; i++) { sim.step(1 / 60, c); maxFrac = Math.max(maxFrac, ...sim.getState().gear.units.map((u) => u.compressionFrac)); }
  assert.ok(!sim.getState().flags.crashed && maxFrac > 0.7 && maxFrac <= 1);
  sim.reset({ state: 'parked' }); sim.pos[1] += 3;
  for (let i = 0; i < 300; i++) sim.step(1 / 60, c);
  assert.ok(sim.getState().flags.crashed);
  console.log(`  0,3 m: carrera máx. ${(maxFrac * 100).toFixed(0)} %; 3 m: ${sim.crashReason}`);
});

test('A-10 determinismo con semilla y turbulencia; tren no sube con peso en ruedas', () => {
  const run = (seed) => {
    const sim = new A10Sim({ seed });
    sim.setEnvironment({ turbulence: 0.6, windKt: 10, windFromDeg: 45 });
    sim.reset({ state: 'cruise', speedKt: 250, aglM: 500 });
    const c = a10Controls({ gearDown: false, throttle: sim.trimInfo.throttle });
    for (let i = 0; i < 600; i++) sim.step(1 / 60, c);
    return sim.getState().pos;
  };
  assert.deepEqual(run(7), run(7));
  assert.notDeepEqual(run(7), run(8));
  const sim = new A10Sim();
  sim.reset({ state: 'parked' });
  for (let i = 0; i < 120; i++) sim.step(1 / 60, a10Controls({ gearDown: false }));
  assert.equal(sim.getState().gear.state, 'down');
});
