import test from 'node:test';
import assert from 'node:assert/strict';
import { runwayLengthM, runwayOptions, runwayFrame, physicsWorld } from '../../src/world/runway.js';

const cfg = { source: 'demo', extentKm: 3, runway: { thr1: { lat: -32.9, lon: -60.78 }, thr2: { lat: -32.89133, lon: -60.76769 }, widthM: 45, surface: 'asphalt' } };
const SURF = { ASPHALT: 4, GRASS: 2 };

test('largo de pista ~1500 m', () => { assert.ok(Math.abs(runwayLengthM(cfg) - 1500) < 5); });
test('opciones: área centrada con margen y pista plana', () => {
  const o = runwayOptions(cfg, SURF);
  assert.equal(o.aoi.margin, 3000); assert.ok(o.aoi.maxSide >= 2 * 3000 + 1500);
  assert.equal(o.world.maxRoadGrade, 0.02); assert.equal(o.world.roadSurface, 4); assert.equal(o.world.verticalExaggeration, 1);
});
test('marco de pista: rumbo compás (x este, z sur)', () => {
  const f = runwayFrame({ path: { ctrl: [[0, 0], [100, -100]] } });   // hacia el noreste
  assert.ok(Math.abs(f.headingDeg - 45) < 1e-6); assert.ok(Math.abs(f.length - Math.hypot(100, 100)) < 1e-9);
});
test('adaptador del mundo acepta out arreglo u objeto', () => {
  const pw = physicsWorld({ bounds: null, height: () => 3, normal: (x, z, o) => { o.x = 0; o.y = 1; o.z = 0; return o; }, surface: () => 4 });
  const a = [0, 0, 0], o = { x: 0, y: 0, z: 0 };
  pw.normal(0, 0, a); pw.normal(0, 0, o);
  assert.deepEqual(a, [0, 1, 0]); assert.equal(o.y, 1); assert.equal(pw.height(0, 0), 3);
});
