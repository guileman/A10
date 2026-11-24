import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HarrierSim, mulberry32 } from '../../src/physics/index.js';
import { integrateRigid } from '../../src/physics/rigidbody.js';
import { mat3Inv, mat3MulV, qRotate } from '../../src/physics/math.js';
import { baseControls } from './helpers.mjs';

test('determinismo: misma semilla => estado idéntico (con turbulencia); otra semilla => distinto', () => {
  const run = (seed) => {
    const sim = new HarrierSim({ seed });
    sim.setEnvironment({ windKt: 15, windFromDeg: 250, turbulence: 0.6 });
    sim.reset({ state: 'cruise', speedKt: 250, aglM: 300, gearDown: false });
    const c = baseControls({ throttle: sim.getState().trim.throttle, gearDown: false });
    for (let i = 0; i < 600; i++) { c.roll = Math.sin(i / 40) * 0.2; sim.step(1 / 60, c); }
    return sim.getState();
  };
  const a = run(7), b = run(7), d = run(8);
  assert.deepEqual(a.pos, b.pos); assert.deepEqual(a.quat, b.quat); assert.deepEqual(a.vel, b.vel);
  assert.notDeepEqual(a.pos, d.pos);
});

test('conservación: cuerpo rígido sin fuerzas conserva cantidad de movimiento y momento angular', () => {
  const I = [7500, 1500, 0, 1500, 50000, 0, 0, 0, 45000], Iinv = mat3Inv(new Array(9), I);
  const s = { pos: [0, 0, 0], vel: [3, -1, 2], quat: [0, 0, 0, 1], omega: [1.2, 0.4, -0.8] };
  const Lw = () => { const Lb = mat3MulV([0, 0, 0], I, s.omega); return qRotate([0, 0, 0], s.quat, Lb); };
  const E = () => 0.5 * (s.omega[0] * mat3MulV([0, 0, 0], I, s.omega)[0] + s.omega[1] * mat3MulV([0, 0, 0], I, s.omega)[1] + s.omega[2] * mat3MulV([0, 0, 0], I, s.omega)[2]);
  const L0 = Lw(), E0 = E();
  for (let i = 0; i < 480 * 20; i++) integrateRigid(s, [0, 0, 0], [0, 0, 0], 8000, I, Iinv, 1 / 480);
  const L1 = Lw(), E1 = E();
  const dL = Math.hypot(L1[0] - L0[0], L1[1] - L0[1], L1[2] - L0[2]) / Math.hypot(...L0);
  console.log(`  20 s a 480 Hz: |ΔL|/|L| = ${dL.toExponential(2)}, ΔE/E = ${((E1 - E0) / E0).toExponential(2)}`);
  assert.ok(dL < 1e-3 && Math.abs(E1 - E0) / E0 < 1e-3);
  assert.deepEqual(s.vel, [3, -1, 2]);
  assert.ok(Math.abs(s.pos[0] - 60) < 1e-6);
});

test('estabilidad numérica: 10 min simulados con entradas aleatorias sin NaN', () => {
  const rnd = mulberry32(12345);
  const sim = new HarrierSim({ seed: 3 });
  sim.setEnvironment({ windKt: 12, windFromDeg: 90, turbulence: 0.5, surfaceWetness: 0.3 });
  const states = ['parked', 'hover', 'cruise'];
  let k = 0, crashes = 0, resets = 0;
  sim.reset({ state: 'hover' });
  const c = baseControls({ assist: { stabilityAug: 0.5, hoverDamping: 0.5 } });
  const N = 60 * 600;
  for (let i = 0; i < N; i++) {
    if (i % 90 === 0) {
      c.pitch = rnd() * 2 - 1; c.roll = rnd() * 2 - 1; c.yaw = rnd() * 2 - 1; c.throttle = rnd();
      c.nozzleDeg = rnd() * 98.5; c.flaps = Math.floor(rnd() * 3); c.gearDown = rnd() > 0.3; c.brake = rnd() > 0.7 ? 1 : 0;
      c.airbrake = rnd() > 0.8; c.waterInjection = rnd() > 0.8;
    }
    sim.step(1 / 60, c);
    if (i % 600 === 0) {
      const s = sim.getState();
      for (const v of [...s.pos, ...s.vel, ...s.quat, ...s.omega, s.engine.thrustN, s.air.iasKt]) assert.ok(Number.isFinite(v), 'finito');
      if (s.flags.crashed) { crashes++; assert.notEqual(s.crashReason, 'numeric'); }
      if (s.flags.crashed || i % 3600 === 0) { sim.reset({ state: states[k++ % 3], speedKt: 250 }); resets++; }
    }
  }
  const s = sim.getState();
  for (const v of [...s.pos, ...s.vel, ...s.quat, ...s.omega]) assert.ok(Number.isFinite(v));
  console.log(`  10 min: ${resets} reinicios, ${crashes} choques (por entradas aleatorias), ningún NaN`);
});

test('rendimiento: CPU por cuadro de 1/60 s (presupuesto ≤ 1,5 ms)', () => {
  const sim = new HarrierSim({ seed: 1 });
  sim.setEnvironment({ turbulence: 0.4, windKt: 10 });
  const c = baseControls({ throttle: 1, nozzleDeg: 10, flaps: 1 });
  sim.reset({ state: 'parked' });
  for (let i = 0; i < 120; i++) sim.step(1 / 60, c); // calentamiento JIT
  const measure = (setup, n = 1200) => {
    setup();
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < n; i++) { sim.step(1 / 60, c); if (i % 4 === 0) sim.getState(); }
    return Number(process.hrtime.bigint() - t0) / 1e6 / n;
  };
  const ground = measure(() => { sim.reset({ state: 'parked' }); c.nozzleDeg = 10; c.throttle = 1; });
  const hover = measure(() => { sim.reset({ state: 'hover', aglM: 3 }); c.nozzleDeg = sim.getState().trim.nozzleDeg; c.throttle = sim.getState().trim.throttle; });
  const cruise = measure(() => { sim.reset({ state: 'cruise', speedKt: 300 }); c.nozzleDeg = 0; c.throttle = sim.getState().trim.throttle; c.gearDown = false; });
  console.log(`  ms por cuadro (480 Hz internos, 8 subpasos): suelo ${ground.toFixed(3)}, hover bajo ${hover.toFixed(3)}, crucero ${cruise.toFixed(3)}`);
  assert.ok(Math.max(ground, hover, cruise) < 1.5);
});
