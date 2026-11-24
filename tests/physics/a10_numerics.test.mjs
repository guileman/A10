import { test } from 'node:test';
import assert from 'node:assert/strict';
import { A10Sim, mulberry32 } from '../../src/physics/index.js';
import { a10Controls } from './a10helpers.mjs';

test('A-10: 10 min de mandos aleatorios sin NaN; eventos coherentes', () => {
  const sim = new A10Sim({ seed: 11 });
  sim.setEnvironment({ turbulence: 0.7, windKt: 20, windFromDeg: 120 });
  sim.reset({ state: 'cruise', speedKt: 300, altFt: 8000 });
  const r = mulberry32(99);
  const c = a10Controls({ gearDown: false, throttle: 0.8 });
  for (let i = 0; i < 60 * 600; i++) {
    if (i % 30 === 0) {
      c.pitch = r() * 2 - 1; c.roll = r() * 2 - 1; c.yaw = r() * 2 - 1; c.throttle = r();
      c.speedbrake = r() < 0.2 ? 1 : 0; c.flaps = Math.floor(r() * 3); c.gearDown = r() < 0.3;
    }
    sim.step(1 / 60, c);
    if (sim.getState().flags.crashed) sim.reset({ state: 'cruise', speedKt: 300, altFt: 8000 });
  }
  const s = sim.getState();
  assert.ok([...s.pos, ...s.vel, ...s.quat, ...s.omega].every(Number.isFinite));
  assert.ok(sim.crashReason !== 'numeric');
});

test('A-10: costo por cuadro (1/60 s, 480 Hz) en Node', () => {
  const bench = (setup, frames = 3000) => {
    const sim = new A10Sim({ seed: 1 });
    const c = setup(sim);
    for (let i = 0; i < 600; i++) sim.step(1 / 60, c); // calentamiento del JIT
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < frames; i++) sim.step(1 / 60, c);
    return Number(process.hrtime.bigint() - t0) / 1e6 / frames;
  };
  const cruise = bench((s) => { s.reset({ state: 'cruise', speedKt: 300, altFt: 5000 }); return a10Controls({ gearDown: false, throttle: s.trimInfo.throttle }); });
  const low = bench((s) => { s.reset({ state: 'cruise', speedKt: 160, aglM: 8, gearDown: true, flaps: 2 }); return a10Controls({ throttle: s.trimInfo.throttle, flaps: 2 }); }, 400);
  const ground = bench((s) => { s.reset({ state: 'parked' }); return a10Controls({ throttle: 0.3, yaw: 0.3 }); });
  const recoil = bench((s) => { s.reset({ state: 'cruise', speedKt: 300, altFt: 5000 }); s.setExternalForce('gun', { forceBody: [-45000, 0, 0], vibration: { frac: 0.15, hz: 65 } }); return a10Controls({ gearDown: false, throttle: 1 }); });
  console.log(`  ms/cuadro: crucero ${cruise.toFixed(3)}, cerca del suelo ${low.toFixed(3)}, en tierra ${ground.toFixed(3)}, con fuerza externa ${recoil.toFixed(3)}`);
  assert.ok(Math.max(cruise, ground, recoil) < 0.3);
});
