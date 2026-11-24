import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSettings, saveSettings, sanitize, defaultSettings, buildConfig, SETTINGS_KEY } from '../../src/ui/settings.js';
import { distanceM, bearingDeg } from '../../src/ui/geo.js';
import { memStorage } from './helpers.mjs';

test('valores por defecto: ruta de 3 km cerca de Roldán, margen 4 km, fuente real, misión', () => {
  const d = defaultSettings();
  assert.equal(d.source, 'real'); assert.equal(d.extentKm, 4); assert.equal(d.fuelKg, 3000);
  assert.deepEqual(d.route.a, { lat: -32.905, lon: -60.93 });
  assert.ok(Math.abs(distanceM(d.route.a, d.route.b) - 3000) < 0.1);
  assert.ok(Math.abs(bearingDeg(d.route.a, d.route.b) - 270) < 1e-3, 'B al oeste de A');
  assert.deepEqual(d.mission, { convoySize: 8, mix: 'mixto', startDistanceKm: 7, startAltFt: 3000, startSpeedKt: 300, loadout: { mavericks: 4 } });
  assert.deepEqual(d.assist, { stabilityAug: 1 });
  assert.ok(!('start' in d) && !('nozzle' in d.mission));
});

test('guardar y recargar ajustes', () => {
  const st = memStorage();
  const s = defaultSettings();
  s.quality = 'alto'; s.environment.windKt = 17; s.mission.convoySize = 12; s.mission.mix = 'blindados'; s.source = 'demo';
  assert.equal(saveSettings(st, s), true);
  assert.ok(st.getItem(SETTINGS_KEY));
  const r = loadSettings(st);
  assert.equal(r.quality, 'alto'); assert.equal(r.environment.windKt, 17); assert.equal(r.mission.convoySize, 12); assert.equal(r.mission.mix, 'blindados'); assert.equal(r.source, 'demo');
});

test('almacenamiento corrupto, ausente o que falla no rompe', () => {
  assert.deepEqual(loadSettings(null), defaultSettings());
  assert.deepEqual(loadSettings(memStorage({ [SETTINGS_KEY]: '{{{' })), defaultSettings());
  assert.equal(saveSettings({ setItem() { throw new Error('cuota'); } }, defaultSettings()), false);
  assert.deepEqual(loadSettings({ getItem() { throw new Error('x'); } }), defaultSettings());
});

test('sanitize limita rangos y reemplaza valores inválidos', () => {
  const s = sanitize({ quality: 'ultra', source: 'x', extentKm: 999, fuelKg: -5, camera: 'foo',
    route: { a: { lat: 200, lon: 0 } },
    mission: { convoySize: 99, mix: 'tanques', startDistanceKm: 1, startAltFt: 1e6, startSpeedKt: 0, loadout: { mavericks: 40 } },
    environment: { windKt: 1e9, qnhHpa: 0, turbulence: 5, windFromDeg: -90, tempOffsetC: NaN }, assist: { stabilityAug: 2 } });
  const d = defaultSettings();
  assert.equal(s.quality, 'medio'); assert.equal(s.source, 'real'); assert.equal(s.extentKm, 8); assert.equal(s.fuelKg, 500);
  assert.equal(s.camera, 'pilot'); assert.deepEqual(s.route.a, d.route.a);
  assert.deepEqual(s.mission, { convoySize: 16, mix: 'mixto', startDistanceKm: 4, startAltFt: 8000, startSpeedKt: 200, loadout: { mavericks: 6 } });
  assert.equal(sanitize({ fuelKg: 1e9 }).fuelKg, 4853); assert.equal(sanitize({ extentKm: 0 }).extentKm, 2);
  assert.equal(sanitize({ mission: { convoySize: 1 } }).mission.convoySize, 4);
  assert.equal(s.environment.windKt, 50); assert.equal(s.environment.qnhHpa, 950); assert.equal(s.environment.turbulence, 1);
  assert.equal(s.environment.windFromDeg, 270); assert.equal(s.environment.tempOffsetC, 0);
  assert.equal(s.assist.stabilityAug, 1);
  for (const bad of [null, undefined, 5, 'x', [], { route: 5, environment: 'x', mission: 7 }]) assert.doesNotThrow(() => sanitize(bad));
});

test('sanitize corrige una ruta fuera de 1–8 km y acepta el formato viejo runway.thr1/thr2', () => {
  const d = defaultSettings();
  const far = sanitize({ route: { a: d.route.a, b: { lat: d.route.a.lat, lon: d.route.a.lon - 1 } } });   // ~93 km
  assert.ok(Math.abs(distanceM(far.route.a, far.route.b) - 8000) < 1);
  const near1 = sanitize({ route: { a: d.route.a, b: d.route.a } });
  assert.ok(Math.abs(distanceM(near1.route.a, near1.route.b) - 1000) < 1);
  const old = sanitize({ runway: { thr1: { lat: -33, lon: -60.5 }, thr2: { lat: -33, lon: -60.48 } } });
  assert.equal(old.route.a.lat, -33);
});

test('buildConfig: route canónico + runway como alias, misión y sin campos del Harrier', () => {
  const c = buildConfig(defaultSettings());
  for (const k of ['source', 'route', 'runway', 'extentKm', 'mission', 'timeOfDay', 'quality', 'environment', 'fuelKg', 'assist', 'camera']) assert.ok(k in c, k);
  assert.ok(!('start' in c));
  assert.deepEqual(c.runway.thr1, c.route.a); assert.deepEqual(c.runway.thr2, c.route.b);
  assert.ok(Math.abs(c.route.lengthM - 3000) < 0.1); assert.ok(Math.abs(c.route.bearingTrue - 270) < 1e-3);
  assert.equal(c.runway.lengthM, c.route.lengthM);
  assert.ok(['demo', 'real'].includes(c.source));
  assert.ok(['amanecer', 'dia', 'tarde', 'atardecer'].includes(c.timeOfDay));
  for (const k of ['windKt', 'windFromDeg', 'tempOffsetC', 'qnhHpa', 'turbulence', 'surfaceWetness']) assert.ok(Number.isFinite(c.environment[k]), k);
  assert.deepEqual(Object.keys(c.mission).sort(), ['convoySize', 'loadout', 'mix', 'startAltFt', 'startDistanceKm', 'startSpeedKt']);
  assert.notEqual(c.mission, buildConfig(defaultSettings()).mission);
});
