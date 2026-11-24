import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceM, bearingDeg, destination, computeRoute, withLengthBearing, MIN_ROUTE_LENGTH_M, MAX_ROUTE_LENGTH_M, DEFAULT_ROUTE_LENGTH_M, normPoint, validLatLon } from '../../src/ui/geo.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);

test('rumbo y largo entre dos coordenadas conocidas', () => {
  const a = { lat: 0, lon: 0 };
  near(bearingDeg(a, { lat: 0, lon: 1 }), 90, 1e-6, 'este');
  near(bearingDeg(a, { lat: 1, lon: 0 }), 0, 1e-6, 'norte');
  near(bearingDeg(a, { lat: -1, lon: 0 }), 180, 1e-6, 'sur');
  near(bearingDeg(a, { lat: 0, lon: -1 }), 270, 1e-6, 'oeste');
  near(distanceM(a, { lat: 1, lon: 0 }), 111195, 30, '1° de latitud');
  near(distanceM(a, { lat: 0, lon: 1 }), 111195, 30, '1° de longitud en el ecuador');
  const b = { lat: -32.9, lon: -60.78 };
  near(distanceM(b, b), 0, 1e-9);
});

test('destination es la inversa de (distancia, rumbo)', () => {
  const o = { lat: -32.9, lon: -60.78 };
  for (const [brg, d] of [[0, 1500], [50, 1500], [123.4, 2300], [270, 800], [359, 600]]) {
    const p = destination(o, brg, d);
    near(distanceM(o, p), d, 0.01, 'dist');
    near(((bearingDeg(o, p) - brg + 540) % 360) - 180, 0, 1e-4, 'rumbo');
  }
});

test('computeRoute: largo, rumbo y validez (1–8 km)', () => {
  const a = { lat: -32.905, lon: -60.93 };
  const r = computeRoute(a, destination(a, 270, DEFAULT_ROUTE_LENGTH_M));
  near(r.lengthM, 3000, 0.01); near(r.bearingTrue, 270, 1e-4); assert.equal(r.valid, true);
  assert.equal(computeRoute(a, destination(a, 270, 999)).valid, false);
  assert.equal(computeRoute(a, destination(a, 270, MIN_ROUTE_LENGTH_M)).valid, true);
  assert.equal(computeRoute(a, destination(a, 270, MAX_ROUTE_LENGTH_M)).valid, true);
  assert.equal(computeRoute(a, destination(a, 270, 8001)).valid, false);
});

test('withLengthBearing mantiene A y acota el largo a 1–8 km', () => {
  const a = { lat: 10, lon: 20 };
  near(distanceM(a, withLengthBearing(a, 100, 33)), MIN_ROUTE_LENGTH_M, 0.01);
  near(distanceM(a, withLengthBearing(a, 99999, 33)), MAX_ROUTE_LENGTH_M, 0.01);
  const q = withLengthBearing(a, 2500, -45);
  near(bearingDeg(a, q), 315, 1e-4); near(distanceM(a, q), 2500, 0.01);
});

test('normPoint acepta varios formatos y rechaza inválidos', () => {
  assert.deepEqual(normPoint({ lat: 1, lon: 2 }), { lat: 1, lon: 2 });
  assert.deepEqual(normPoint({ lat: 1, lng: 2 }), { lat: 1, lon: 2 });
  assert.deepEqual(normPoint([2, 1]), { lat: 1, lon: 2 });
  assert.equal(normPoint({ lat: NaN, lon: 2 }), null); assert.equal(normPoint(null), null); assert.equal(normPoint({ lat: 95, lon: 0 }), null);
  assert.equal(validLatLon({ lat: 0, lon: 181 }), false);
});
