import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HarrierSim } from '../../src/physics/index.js';
import { baseControls } from './helpers.mjs';

function hoverSim() {
  const sim = new HarrierSim({ seed: 1 });
  sim.reset({ state: 'hover', aglM: 50 });
  const tr = sim.getState().trim;
  return { sim, c: baseControls({ throttle: tr.throttle, nozzleDeg: tr.nozzleDeg, flaps: 2, assist: { stabilityAug: 0, hoverDamping: 0 } }) };
}

test('RCS en hover: escalón de alabeo, cabeceo y guiñada -> aceleración angular con signo correcto', () => {
  for (const [axis, key, rateKey, sign] of [['roll', 'roll', 'p', 1], ['pitch', 'pitch', 'q', 1], ['yaw', 'yaw', 'r', 1]]) {
    const { sim, c } = hoverSim();
    c[key] = 0.5;
    for (let i = 0; i < 30; i++) sim.step(1 / 60, c); // 0,5 s
    const s = sim.getState();
    const rate = s.rates[rateKey];
    const acc = rate / 0.5;
    const max = sim.p.rcs.maxAccel[axis];
    console.log(`  ${axis}: 50 % palanca -> ${rateKey}=${(rate * 57.3).toFixed(1)}°/s tras 0,5 s (≈${acc.toFixed(2)} rad/s², máx. de diseño ${max}), sangrado ${s.engine.bleedPct.toFixed(0)} %, ΔT ${(s.engine.grossN - s.engine.thrustN).toFixed(0)} N`);
    assert.ok(sign * rate > 0, `${axis} con signo correcto`);
    assert.ok(acc > 0.15 * max && acc < 1.2 * max);
    assert.ok(s.engine.thrustN < s.engine.grossN, 'el sangrado resta empuje');
  }
});

test('RCS: sin efecto con toberas a 0°, 50 % a 10°, y fuerza ∝ presión de sangrado (RPM)', () => {
  const { sim } = hoverSim();
  const r = sim.rcs;
  r.update(10, 1, 0, 0, 0, 100, true); assert.equal(r.valves.nose.forceN, 0);
  r.update(10, 1, 0, 0, 10, 100, true); const f10 = r.valves.nose.forceN;
  r.update(10, 1, 0, 0, 30, 100, true); const f30 = r.valves.nose.forceN;
  assert.ok(Math.abs(f10 / f30 - 0.5) < 0.01);
  r.update(10, 1, 0, 0, 30, 70, true); const f70 = r.valves.nose.forceN;
  assert.ok(f70 < 0.6 * f30);
  // Limitación por sangrado disponible con mando combinado.
  r.update(10, 1, 1, 1, 90, 100, true);
  assert.ok(r.bleedKgS <= sim.p.rcs.bleedAvailKgS * 1.0001);
  console.log(`  nariz: 10° ${f10.toFixed(0)} N, 30° ${f30.toFixed(0)} N, 70 %NF ${f70.toFixed(0)} N; mando combinado: ${r.bleedKgS.toFixed(2)} kg/s (máx ${sim.p.rcs.bleedAvailKgS})`);
});
