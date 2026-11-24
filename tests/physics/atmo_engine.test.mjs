import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atmosphere } from '../../src/physics/atmosphere.js';
import { Engine } from '../../src/physics/engine.js';
import { HARRIER_PARAMS } from '../../src/physics/index.js';

const LBF = 4.4482216;

test('atmósfera ISA, QNH y desvío de temperatura', () => {
  const a0 = atmosphere(0, {});
  assert.ok(Math.abs(a0.rho - 1.225) < 1e-3 && Math.abs(a0.a - 340.29) < 0.1);
  const a11 = atmosphere(11000, {});
  assert.ok(Math.abs(a11.T - 216.65) < 0.01 && Math.abs(a11.p - 22632) < 30);
  const hot = atmosphere(0, { tempOffsetC: 20 });
  assert.ok(hot.rho < a0.rho * 0.94);
  const lowQ = atmosphere(0, { qnhHpa: 990 });
  assert.ok(Math.abs(lowQ.p - 99000) < 1);
});

test('Pegasus: tabla de empuje instalado, día caluroso, agua y aceleración de RPM', () => {
  const e = new Engine(HARRIER_PARAMS.engine);
  for (const [nf, lb] of [[90, 12900], [100, 17700], [102.7, 18650]]) assert.ok(Math.abs(e.staticThrust(nf) / LBF - lb) < 1);
  const run = (theta, water, t = 15) => { e.reset(27, 2000, 227); for (let i = 0; i < t * 480; i++) e.update(1 / 480, 1, water, theta, 1, 0); return e; };
  const isa = run(1, false).grossN, nfIsa = e.nf;
  const hot = run(308.15 / 288.15, false).grossN, nfHot = e.nfc;
  const wet = run(308.15 / 288.15, true).grossN;
  console.log(`  ISA seco ${(isa / LBF).toFixed(0)} lbf @${nfIsa.toFixed(1)} %; ISA+20 seco ${(hot / LBF).toFixed(0)} lbf (NFcorr ${nfHot.toFixed(1)} %), con agua ${(wet / LBF).toFixed(0)} lbf`);
  assert.ok(hot < isa && wet > hot);
  // Aceleración ralentí -> 95 % de empuje máx.
  e.reset(27, 2000, 0);
  let t = 0; while (e.grossN < 0.95 * isa && t < 20) { e.update(1 / 480, 1, false, 1, 1, 0); t += 1 / 480; }
  console.log(`  ralentí -> 95 % empuje: ${t.toFixed(2)} s`);
  assert.ok(t > 2 && t < 8);
});
