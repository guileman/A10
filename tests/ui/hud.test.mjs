import test from 'node:test';
import assert from 'node:assert/strict';
import { createHud } from '../../src/ui/hud.js';
import { mockCtx } from './helpers.mjs';

const base = () => ({
  t: 1, pos: [0, 100, 0], quat: [0, 0, 0, 1], vel: [50, 0, 0], omega: [0, 0, 0],
  att: { headingDeg: 90, pitchDeg: 3, rollDeg: -5 },
  air: { iasKt: 220, tasKt: 225, machNo: 0.35, aoaDeg: 6, betaDeg: 1, qbar: 5000, rho: 1.2, tempK: 288, altMslM: 500, altAglM: 120, vsMs: 2, gs: 110, nz: 1, windBody: [-2, 0, 1] },
  engine: { rpmPct: 90, thrustN: 60000, fuelKg: 2800, fuelFlowKgS: 0.5, jptC: 600, stall: false },
  n1Pct: [87.3, 85.1],
  controlSurfaces: { flapsDeg: 7, speedbrakeDeg: 0 },
  gear: { state: 'transit', extension: 0.4, units: [] },
  flags: {}, warnings: [],
});
const ctl = () => ({ pitch: 0, roll: 0, yaw: 0, throttle: 0.5, flaps: 1, gearDown: true, brake: 0.3, parkingBrake: true, speedbrake: 1, airbrake: true, triggerGun: false, trim: { pitch: 0, roll: 0, yaw: 0 }, assist: {} });
const extra = () => ({
  gun: { ammo: 1034, firing: true, spin: 1 }, missiles: { left: 3, locked: true, lockProgress: 1 },
  ccip: { x: 0.1, y: -0.05 },
  targets: [{ x: 0.1, y: -0.05, dist: 2100, type: 'T-72', locked: true, alive: true }, { x: -0.4, y: -0.1, dist: 3300, type: 'BTR', locked: false, alive: true }, { x: 0.2, y: 0, dist: 900, alive: false }, null],
  range: 2100, message: 'BLANCO DESTRUIDO',
});
const mk = (opts) => { const ctx = mockCtx(); return { ctx, hud: createHud({ canvas: null, ctx, options: opts }) }; };
const texts = (ctx) => ctx.__calls.texts;

test('HUD completo y reducido dibujan un estado normal sin errores (con y sin extra)', () => {
  for (const mode of ['pilot', 'chase', 'world', 'weapon']) {
    for (const ex of [undefined, null, extra()]) {
      const { ctx, hud } = mk();
      hud.setMode(mode);
      hud.update(base(), ctl(), 0.016, ex);
      assert.equal(hud.errors, 0, mode);
      assert.ok(ctx.__calls.n > 50, mode + ' dibuja algo');
    }
  }
});

test('HUD en pantallas 1280x720 y 1920x1080 (escala) sin errores', () => {
  const { hud } = mk();
  for (const [w, h] of [[1280, 720], [1920, 1080], [800, 600], [320, 240], [3840, 2160]]) {
    hud.resize && hud.resize(w, h, 1);
    hud.update(base(), ctl(), 0.016, extra());
  }
  assert.equal(hud.errors, 0);
});

test('estados extremos y datos basura no lanzan excepciones (estado y extra)', () => {
  const evil = [NaN, Infinity, -Infinity, 1e300, -1e300, null, undefined, 'x', {}, []];
  for (const mode of ['pilot', 'chase', 'world', 'weapon']) {
    const { hud } = mk(); hud.setMode(mode);
    for (const v of evil) {
      const s = base();
      s.att = { headingDeg: v, pitchDeg: v, rollDeg: v };
      s.air = { iasKt: v, tasKt: v, machNo: v, aoaDeg: v, betaDeg: v, altMslM: v, altAglM: v, vsMs: v, gs: v, nz: v, windBody: [v, v, v] };
      s.engine = { rpmPct: v, thrustN: v, fuelKg: v, fuelFlowKgS: v, jptC: v, stall: true };
      s.n1Pct = [v, v]; s.buffet = v; s.stall = v;
      s.vel = [v, v, v]; s.quat = [v, v, v, v];
      s.gear = { state: v, extension: v };
      s.warnings = [v, 'STALL', 'OVERTEMP', 'GEAR', 'BINGO', 'DESCONOCIDO', 'PULL UP', 'x'.repeat(50)];
      s.flags = { crashed: true, onGround: true };
      const c = { pitch: v, flaps: v, brake: v, parkingBrake: v, speedbrake: v };
      const ex = { gun: { ammo: v, firing: v, spin: v }, missiles: { left: v, locked: v, lockProgress: v }, ccip: { x: v, y: v }, range: v, message: v,
        targets: [{ x: v, y: v, dist: v, type: v, locked: v, alive: v }, v, { x: 0, y: 0 }], weapon: v };
      hud.update(s, c, v, ex);
      hud.update(s, c, v, v);
      hud.update(s, c, 0.01, { targets: v, gun: v, missiles: v, ccip: v });
    }
    assert.equal(hud.errors, 0, mode + ' errores: ' + hud.errors);
  }
});

test('estados vacíos / parciales', () => {
  const { hud } = mk();
  for (const s of [{}, { air: {} }, { gear: null, warnings: null, flags: null }, null, undefined]) {
    for (const c of [undefined, null, {}]) hud.update(s, c, 0.016);
  }
  assert.equal(hud.errors, 0);
});

test('sin toberas, RCS ni VTOL; con N1 de ambos motores, TREN, flaps UP/MVR/DN, SPD BRK', () => {
  const { ctx, hud } = mk();
  hud.update(base(), ctl(), 0);
  const all = texts(ctx).join('|');
  assert.ok(!/TOBERA|RCS|VTOL|STOL|PRES /i.test(all), all);
  assert.ok(all.includes('KIAS') && all.includes('BARO ft') && all.includes('RAD 394') && all.includes('COMB') && all.includes('TREN'), all.slice(0, 400));
  assert.ok(texts(ctx).includes('87.3%') && texts(ctx).includes('85.1%'), 'N1 izquierdo y derecho');
  assert.ok(all.includes('MVR 7°') && all.includes('SPD BRK') && all.includes('ABIERTO'));
  assert.ok(all.includes('220') && all.includes('G 1.0') && all.includes('VS fpm'));
});

test('N1: sin n1Pct se usa engine.rpmPct para ambos', () => {
  const { ctx, hud } = mk();
  const s = base(); delete s.n1Pct; s.engine.rpmPct = 66.6;
  hud.update(s, ctl(), 0);
  assert.equal(texts(ctx).filter((t) => t === '66.6%').length, 4)   // 2 motores × (trazo + relleno);
});

test('avisos: STALL por state.stall / flags.stalled, BUFFET en ámbar, ACCIDENTE', () => {
  for (const mut of [(s) => { s.stall = true; }, (s) => { s.flags = { stalled: true }; }, (s) => { s.warnings = ['STALL']; }]) {
    const { ctx, hud } = mk();
    const s = base(); mut(s);
    hud.update(s, ctl(), 0);   // t = 0 → el parpadeo rojo está encendido
    assert.ok(texts(ctx).includes('STALL'));
  }
  const b = mk(); const s = base(); s.buffet = 0.6;
  b.hud.update(s, ctl(), 0); assert.ok(texts(b.ctx).includes('BUFFET'));
  const c = mk(); const s2 = base(); s2.buffet = 0.1; c.hud.update(s2, ctl(), 0); assert.ok(!texts(c.ctx).includes('BUFFET'));
  const d = mk(); const s3 = base(); s3.warnings = ['GEAR', 'BINGO']; s3.flags = { crashed: true };
  d.hud.update(s3, ctl(), 0);
  const all = texts(d.ctx).join('|');
  assert.ok(all.includes('GEAR') && all.includes('BINGO') && all.includes('ACCIDENTE'));
});

test('armas: munición, Mavericks, modo, pipper, IN RNG y SHOOT (pipper sobre blanco < 2,5 km)', () => {
  const { ctx, hud } = mk();
  hud.update(base(), ctl(), 0, extra());     // t=0: el parpadeo de SHOOT está encendido
  const all = texts(ctx).join('|');
  assert.ok(texts(ctx).includes('1034'), 'cartuchos');
  assert.ok(all.includes('AGM-65') && all.includes('CART'));
  assert.ok(texts(ctx).includes('3'), 'Mavericks restantes');
  assert.ok(all.includes('IN RNG'), 'blanco bloqueado a 2,1 km');
  assert.ok(all.includes('SHOOT'), 'pipper sobre el blanco a 2,1 km');
  assert.ok(all.includes('2.1 km') && all.includes('T-72') && all.includes('LOCK'));
  assert.ok(all.includes('BLANCO DESTRUIDO'));
  assert.ok(!all.includes('GIRANDO'));
});

test('IN RNG / SHOOT no aparecen fuera de rango o con el pipper lejos del blanco', () => {
  const far = extra(); far.range = 5200; far.targets[0].dist = 5200; far.targets[1].dist = 6000;
  const a = mk(); a.hud.update(base(), ctl(), 0, far);
  assert.ok(!texts(a.ctx).join('|').includes('IN RNG') && !texts(a.ctx).join('|').includes('SHOOT'));
  const off = extra(); off.ccip = { x: -0.8, y: 0.5 };
  const b = mk(); b.hud.update(base(), ctl(), 0, off);
  assert.ok(texts(b.ctx).join('|').includes('IN RNG'));
  assert.ok(!texts(b.ctx).join('|').includes('SHOOT'), 'pipper lejos del blanco');
  const mid = extra(); mid.range = 3000; mid.targets[0].dist = 3000;   // en IN RNG pero fuera de 2,5 km
  const c = mk(); c.hud.update(base(), ctl(), 0, mid);
  assert.ok(texts(c.ctx).join('|').includes('IN RNG') && !texts(c.ctx).join('|').includes('SHOOT'));
});

test('sin extra no dibuja armas ni blancos; ccip null no dibuja pipper; modo GUN por defecto', () => {
  const a = mk(); a.hud.update(base(), ctl(), 0);
  const all = texts(a.ctx).join('|');
  assert.ok(!/CART|AGM|IN RNG|SHOOT|ARMA/.test(all), all);
  const ex = extra(); ex.ccip = null; ex.missiles = { left: 2, locked: false, lockProgress: 0 }; ex.range = null; ex.targets = [];
  const b = mk(); b.hud.update(base(), ctl(), 0, ex);
  const t = texts(b.ctx);
  assert.ok(t.includes('GUN') && !t.includes('AGM-65 ') && !t.join('|').includes('LOCK') && !t.join('|').includes('SHOOT'));
  const n0 = a.ctx.__calls.n;
  const c = mk(); c.hud.update(base(), ctl(), 0, { ...extra(), ccip: null, targets: [] });
  const d = mk(); d.hud.update(base(), ctl(), 0, extra());
  assert.ok(d.ctx.__calls.n > c.ctx.__calls.n, 'el pipper y los blancos agregan trazos');
  void n0;
});

test('adquisición del Maverick: progreso de enganche', () => {
  const ex = extra(); ex.missiles = { left: 4, locked: false, lockProgress: 0.5 }; ex.targets = []; ex.ccip = null; ex.range = null;
  const { ctx, hud } = mk(); hud.update(base(), ctl(), 0, ex);
  assert.ok(texts(ctx).includes('LOCK 50%'));
});

test('opción noPanels (VR) se mantiene y dibuja sin errores', () => {
  const { ctx, hud } = mk({ noPanels: true });
  hud.update(base(), ctl(), 0, extra());
  assert.equal(hud.errors, 0); assert.ok(ctx.__calls.n > 50);
  assert.equal(hud.options.noPanels, true);
});

test('el HUD oculto no dibuja nada', () => {
  const { ctx, hud } = mk();
  hud.setVisible(false);
  const n = ctx.__calls.n;
  hud.update(base(), ctl(), 0.016, extra());
  assert.ok(ctx.__calls.n - n < 5, 'oculto: solo limpia');
  assert.equal(hud.toggle(), true);
});

test('unidades de aviación: kt, ft, ft/min y °', () => {
  const { ctx, hud } = mk();
  const s = base(); s.air.altMslM = 1000; s.air.altAglM = 304.8; s.air.vsMs = 5.08; s.air.iasKt = 123.4; s.att.headingDeg = 7;
  hud.update(s, ctl(), 0);
  const t = texts(ctx);
  assert.ok(t.includes('3281'), 'altitud en ft: ' + t.join(','));
  assert.ok(t.includes('RAD 1000'), 'radar 1000 ft');
  assert.ok(t.includes('1000'), 'VS 1000 ft/min'); // 5,08 m/s = 1000 ft/min
  assert.ok(t.includes('123'), 'KIAS');
  assert.ok(t.includes('007°'), 'rumbo');
});

test('capacidad de combustible observada y reset', () => {
  const { hud } = mk();
  hud.update(base(), ctl(), 0);
  hud.reset(3000);
  hud.update(base(), ctl(), 0);
  assert.equal(hud.errors, 0);
});
