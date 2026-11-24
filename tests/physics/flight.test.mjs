import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HarrierSim } from '../../src/physics/index.js';
import { baseControls, attitudeHold, clamp } from './helpers.mjs';

test('despegue corto (STO): toberas 10°, a 70 kt toberas a 50°, flaps intermedios', () => {
  const sim = new HarrierSim({ seed: 1 });
  sim.reset({ state: 'parked', flaps: 1 }); // tanques llenos: ≈ 8,16 t
  const c = baseControls({ throttle: 1, nozzleDeg: 10, flaps: 1 });
  const z0 = sim.getState().pos[2];
  let lift = null;
  for (let i = 0; i < 60 * 25 && !lift; i++) {
    const s = sim.getState();
    if (s.air.iasKt > 70) c.nozzleDeg = 50;
    attitudeHold(c, s, 10);
    sim.step(1 / 60, c);
    const s2 = sim.getState();
    if (s2.t > 1 && !s2.gear.units.some((u) => u.contact)) lift = { dist: z0 - s2.pos[2], ias: s2.air.iasKt, t: s2.t, m: s2.massKg };
  }
  assert.ok(lift, 'despegó');
  console.log(`  STO ${lift.m.toFixed(0)} kg: carrera ${lift.dist.toFixed(0)} m, ${lift.ias.toFixed(0)} KIAS, ${lift.t.toFixed(1)} s`);
  assert.ok(lift.dist > 50 && lift.dist < 350, 'distancia plausible');
  // Sigue subiendo 10 s después.
  const h0 = sim.getState().air.altAglM;
  for (let i = 0; i < 600; i++) { const s = sim.getState(); attitudeHold(c, s, 10); sim.step(1 / 60, c); }
  assert.ok(sim.getState().air.altAglM > h0 + 20);
  assert.ok(!sim.getState().flags.crashed);
});

test('despegue convencional (toberas 0°, flaps intermedios): carrera mayor que STO', () => {
  const sim = new HarrierSim({ seed: 1 });
  sim.reset({ state: 'parked', flaps: 1 });
  const c = baseControls({ throttle: 1, nozzleDeg: 0, flaps: 1 });
  const z0 = sim.getState().pos[2];
  let lift = null;
  for (let i = 0; i < 60 * 60 && !lift; i++) {
    const s = sim.getState();
    attitudeHold(c, s, s.air.iasKt > 120 ? 10 : 2);
    sim.step(1 / 60, c);
    const s2 = sim.getState();
    if (s2.t > 1 && !s2.gear.units.some((u) => u.contact)) lift = { dist: z0 - s2.pos[2], ias: s2.air.iasKt };
  }
  assert.ok(lift);
  console.log(`  CTO: carrera ${lift.dist.toFixed(0)} m a ${lift.ias.toFixed(0)} KIAS`);
  assert.ok(lift.dist > 300 && lift.dist < 2000);
});

test('transición vuelo estacionario -> vuelo convencional', () => {
  const sim = new HarrierSim({ seed: 1 });
  sim.reset({ state: 'hover', aglM: 30 });
  const tr = sim.getState().trim;
  const c = baseControls({ throttle: tr.throttle, nozzleDeg: tr.nozzleDeg, flaps: 2 });
  const y0 = sim.getState().pos[1];
  let minAgl = 1e9;
  for (let i = 0; i < 60 * 45; i++) {
    const s = sim.getState();
    if (s.t > 2) c.nozzleDeg = Math.max(0, tr.nozzleDeg - 4 * (s.t - 2));
    if (s.nozzles.angleDeg < 40) c.flaps = 1;
    if (s.air.iasKt > 200) c.flaps = 0;
    const altErr = y0 - s.pos[1];
    attitudeHold(c, s, clamp(4 + 0.3 * altErr - 1.0 * s.air.vsMs, -2, 12));
    c.throttle = clamp(tr.throttle + 0.05 * altErr - 0.1 * s.air.vsMs, 0, 1);
    sim.step(1 / 60, c);
    minAgl = Math.min(minAgl, sim.getState().air.altAglM);
  }
  const s = sim.getState();
  console.log(`  transición: ${s.air.iasKt.toFixed(0)} KIAS, toberas ${s.nozzles.angleDeg.toFixed(0)}°, AoA ${s.air.aoaDeg.toFixed(1)}°, CL ${s.air.CL.toFixed(2)}, NF ${s.engine.rpmPct.toFixed(1)} %, altura mín ${minAgl.toFixed(1)} m`);
  assert.ok(s.air.iasKt > 250 && s.nozzles.angleDeg < 1);
  assert.ok(minAgl > 15 && !s.flags.crashed);
  // Sustentación alar sostiene el peso.
  assert.ok(s.air.CL * s.air.qbar * 18.68 > 0.8 * s.massKg * 9.80665);
});

test('pérdida: evento, AoA de pérdida 15–19° y caída de CL', () => {
  const sim = new HarrierSim({ seed: 1 });
  sim.reset({ state: 'cruise', speedKt: 220, aglM: 3000, gearDown: false });
  const c = baseControls({ throttle: sim.getState().trim.throttle, gearDown: false });
  let maxCL = 0, aoaAtMax = 0, after = null;
  for (let i = 0; i < 60 * 25; i++) {
    const s = sim.getState();
    c.pitch = clamp(0.03 * s.t, 0, 1); c.roll = clamp(-0.05 * s.att.rollDeg, -1, 1);
    if (s.air.aoaDeg < 20 && s.air.CL > maxCL) { maxCL = s.air.CL; aoaAtMax = s.air.aoaDeg; }
    if (s.air.aoaDeg > 18.5 && after === null) after = s.air.CL;
    sim.step(1 / 60, c);
  }
  const ev = sim.events.find((e) => e.type === 'stall');
  console.log(`  CLmax ${maxCL.toFixed(2)} a α=${aoaAtMax.toFixed(1)}°, evento a α=${ev && ev.data.aoaDeg.toFixed(1)}°, CL post (α>18,5°) ${after && after.toFixed(2)}`);
  assert.ok(ev, 'evento stall');
  assert.ok(ev.data.aoaDeg > 15 && ev.data.aoaDeg < 19);
  assert.ok(maxCL > 0.75 && maxCL < 1.2);
  assert.ok(after !== null && after < maxCL - 0.05);
});

test('crucero trimado a 420 kt: vuelo nivelado estable 20 s', () => {
  const sim = new HarrierSim({ seed: 1 });
  sim.reset({ state: 'cruise', speedKt: 420, aglM: 1000, gearDown: false });
  const s0 = sim.getState();
  assert.ok(s0.trim.ok);
  const c = baseControls({ throttle: s0.trim.throttle, gearDown: false });
  for (let i = 0; i < 1200; i++) sim.step(1 / 60, c);
  const s = sim.getState();
  console.log(`  crucero 420 kt: NF ${s0.trim.nf.toFixed(1)} %, α ${s0.air.aoaDeg.toFixed(2)}°, estab. ${s0.trim.stabilatorDeg.toFixed(2)}°; tras 20 s Δh ${(s.pos[1] - s0.pos[1]).toFixed(1)} m, ΔV ${(s.air.tasKt - s0.air.tasKt).toFixed(1)} kt`);
  assert.ok(Math.abs(s.pos[1] - s0.pos[1]) < 60 && Math.abs(s.air.tasKt - s0.air.tasKt) < 10);
});
