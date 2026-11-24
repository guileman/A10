import test from 'node:test';
import assert from 'node:assert/strict';
import { createInput, ACTIONS, defaultBindings, INPUT_STORAGE_KEY } from '../../src/input/index.js';
import { makeDom, memStorage, down, up, stepN, mouseMove } from './helpers.mjs';

function setup(opts = {}) {
  const dom = makeDom();
  const win = dom.window;
  let t = 0;
  const input = createInput({ target: win.document.body, storage: opts.storage || null, now: () => t, ...opts });
  return { dom, win, input, setNow: (v) => { t = v; }, get now() { return t; } };
}

test('formato de controls del A-10C', () => {
  const { input } = setup();
  const c = input.getControls();
  for (const k of ['pitch', 'roll', 'yaw', 'throttle', 'flaps', 'gearDown', 'brake', 'parkingBrake', 'speedbrake', 'airbrake', 'triggerGun', 'trim', 'assist']) assert.ok(k in c, k);
  for (const k of ['nozzleDeg', 'waterInjection']) assert.ok(!(k in c), 'sin ' + k);
  assert.equal(typeof c.gearDown, 'boolean'); assert.equal(c.triggerGun, false);
  assert.deepEqual(c.trim, { pitch: 0, roll: 0, yaw: 0 });
  assert.deepEqual(c.assist, { stabilityAug: 1 });
  assert.ok([0, 1, 2].includes(c.flaps)); assert.ok(c.speedbrake === 0 || c.speedbrake === 1);
  const out = { assist: {}, trim: {} };
  assert.equal(input.getControls(out), out);
});

test('flecha arriba = proa abajo (pitch<0), abajo = pitch>0; límites ±1', () => {
  const { win, input } = setup();
  down(win, 'ArrowUp'); stepN(input, 0.016, 200);
  assert.equal(input.getControls().pitch, -1);
  up(win, 'ArrowUp'); down(win, 'ArrowDown'); stepN(input, 0.016, 300);
  assert.equal(input.getControls().pitch, 1);
});

test('rampa de teclado: sube gradual (más lenta que en el Harrier) y vuelve a cero al soltar', () => {
  const { win, input } = setup();
  down(win, 'ArrowRight');
  input.update(0.1);
  const v1 = input.getControls().roll;
  assert.ok(v1 > 0.02 && v1 < 0.2, 'subida gradual: ' + v1);
  stepN(input, 0.1, 3);
  assert.ok(input.getControls().roll < 1, 'a 0,4 s todavía no está a fondo');
  stepN(input, 0.1, 10);
  assert.equal(input.getControls().roll, 1);
  up(win, 'ArrowRight');
  input.update(0.1);
  const v2 = input.getControls().roll;
  assert.ok(v2 < 1 && v2 > 0, 'atenuación al soltar: ' + v2);
  stepN(input, 0.1, 20);
  assert.equal(input.getControls().roll, 0);
});

test('curva exponencial: suave cerca del centro, 100 % a fondo, monótona; el cabeceo tarda ≥ 0,8 s a fondo', () => {
  const { win, input } = setup();
  down(win, 'ArrowDown');
  const tr = [];
  for (let i = 0; i < 40; i++) { input.update(0.05); tr.push(input.getControls().pitch); }
  for (let i = 1; i < tr.length; i++) assert.ok(tr[i] >= tr[i - 1]);
  const t05 = tr.findIndex((v) => v >= 0.5) * 0.05 + 0.05;
  assert.ok(t05 > 0.55, 'medio recorrido no antes de 0,55 s (con rampa lineal sería 0,42 s): ' + t05);
  assert.equal(tr.at(-1), 1);
  assert.ok(tr.findIndex((v) => v >= 1) * 0.05 >= 0.8 - 0.05, 'a fondo no antes de ~0,83 s');
  // sin expo (0) la salida coincide con la rampa lineal
  const b = setup(); b.input.setSettings({ expo: { pitch: 0 } });
  down(b.win, 'ArrowDown'); b.input.update(0.1);
  assert.ok(Math.abs(b.input.getControls().pitch - 0.12) < 1e-9);
});

test('teclas opuestas simultáneas se anulan; ejes independientes', () => {
  const { win, input } = setup();
  down(win, 'ArrowLeft'); down(win, 'ArrowRight'); down(win, 'KeyD'); down(win, 'ArrowUp');
  stepN(input, 0.016, 200);
  const c = input.getControls();
  assert.equal(c.roll, 0); assert.equal(c.yaw, 1); assert.equal(c.pitch, -1);
});

test('gases W/S con límites 0..1', () => {
  const { win, input } = setup();
  down(win, 'KeyW'); stepN(input, 0.1, 30);
  assert.equal(input.getControls().throttle, 1);
  up(win, 'KeyW'); down(win, 'KeyS'); stepN(input, 0.1, 40);
  assert.equal(input.getControls().throttle, 0);
});

test('sin toberas, agua ni preajustes: esas teclas no hacen nada', () => {
  const { win, input } = setup();
  const got = [];
  input.on('action', (n) => got.push(n));
  for (const c of ['KeyZ', 'KeyX', 'Digit1', 'Digit2', 'Digit3', 'KeyI']) { down(win, c); up(win, c); }
  assert.deepEqual(got, []);
  for (const id of ['nozzleAft', 'nozzleDown', 'nozzlePreset1', 'water']) assert.ok(!ACTIONS.find((a) => a.id === id), id);
});

test('cañón: Espacio se mantiene → triggerGun; botón izquierdo solo con mouse-palanca o puntero bloqueado', () => {
  const { win, input } = setup();
  down(win, 'Space'); assert.equal(input.getControls().triggerGun, true);
  up(win, 'Space'); assert.equal(input.getControls().triggerGun, false);
  const click = (type, button = 0) => win.document[type === 'mouseup' ? 'dispatchEvent' : 'body'] && (type === 'mouseup' ? win.document.dispatchEvent(new win.MouseEvent(type, { button, bubbles: true })) : win.document.body.dispatchEvent(new win.MouseEvent(type, { button, bubbles: true })));
  click('mousedown'); assert.equal(input.getControls().triggerGun, false, 'sin mouse-palanca no dispara');
  click('mouseup');
  input.setMouseStick(true);
  click('mousedown'); assert.equal(input.getControls().triggerGun, true);
  click('mouseup'); assert.equal(input.getControls().triggerGun, false);
  click('mousedown'); win.dispatchEvent(new win.Event('blur'));
  assert.equal(input.getControls().triggerGun, false, 'blur suelta el gatillo');
  click('mousedown', 2); assert.equal(input.getControls().triggerGun, false, 'el botón derecho no dispara');
});

test('acciones de armas: Enter → fireMissile, L → lockTarget, U → unlockTarget', () => {
  const { win, input } = setup();
  const got = [];
  input.on('action', (n) => got.push(n));
  for (const c of ['Enter', 'KeyL', 'KeyU']) { down(win, c); up(win, c); }
  assert.deepEqual(got, ['fireMissile', 'lockTarget', 'unlockTarget']);
  input.press('missile'); assert.equal(got.at(-1), 'fireMissile');
});

test('compensador de cabeceo: Coma/Punto dan velocidad −1/+1 mientras se mantienen', () => {
  const { win, input } = setup();
  down(win, 'Period'); assert.equal(input.getControls().trim.pitch, 1);
  up(win, 'Period'); assert.equal(input.getControls().trim.pitch, 0);
  down(win, 'Comma'); assert.equal(input.getControls().trim.pitch, -1);
  down(win, 'Period'); assert.equal(input.getControls().trim.pitch, 0, 'ambas se anulan');
});

test('tren, flaps (ciclo UP/MVR/DN), freno de estacionamiento y aerofrenos alternan', () => {
  const { win, input } = setup();
  assert.equal(input.getControls().gearDown, false, 'se empieza en vuelo');
  down(win, 'KeyG'); up(win, 'KeyG'); assert.equal(input.getControls().gearDown, true);
  for (const exp of [1, 2, 0]) { down(win, 'KeyF'); up(win, 'KeyF'); assert.equal(input.getControls().flaps, exp); }
  const got = [];
  input.on('action', (n) => got.push(n));
  down(win, 'KeyV'); up(win, 'KeyV'); down(win, 'KeyK'); up(win, 'KeyK');
  let c = input.getControls();
  assert.equal(c.parkingBrake, true); assert.equal(c.speedbrake, 1); assert.equal(c.airbrake, true);
  assert.ok(got.includes('speedbrake'));
  down(win, 'KeyK'); up(win, 'KeyK');
  c = input.getControls(); assert.equal(c.speedbrake, 0); assert.equal(c.airbrake, false);
});

test('freno B se mantiene y se suelta; autorepetición no duplica', () => {
  const { win, input } = setup();
  down(win, 'KeyB'); down(win, 'KeyB'); down(win, 'KeyB');
  stepN(input, 0.1, 10);
  assert.equal(input.getControls().brake, 1);
  up(win, 'KeyB'); stepN(input, 0.1, 10);
  assert.equal(input.getControls().brake, 0);
});

test('eventos de acción', () => {
  const { win, input } = setup();
  const got = [];
  input.on('action', (n) => got.push(n));
  for (const c of ['KeyC', 'KeyP', 'KeyR', 'KeyH', 'KeyT', 'F2']) { down(win, c); up(win, c); }
  assert.deepEqual(got, ['cameraNext', 'pause', 'reset', 'toggleHud', 'worldRelocate', 'screenshot']);
  const e = down(win, 'Escape'); up(win, 'Escape');
  assert.equal(got.at(-1), 'pause'); assert.ok(e.defaultPrevented);
});

test('pérdida de foco (blur / pestaña oculta) suelta todo', () => {
  const { win, input } = setup();
  down(win, 'ArrowUp'); down(win, 'KeyW'); down(win, 'KeyB');
  input.update(0.1);
  win.dispatchEvent(new win.Event('blur'));
  stepN(input, 0.1, 30);
  const c = input.getControls();
  assert.equal(c.pitch, 0); assert.equal(c.brake, 0);
  const th = c.throttle;
  stepN(input, 0.1, 10);
  assert.equal(input.getControls().throttle, th, 'los gases no siguen subiendo');
});

test('setEnabled(false) ignora teclas y suelta; campos de texto no disparan acciones', () => {
  const { win, input } = setup();
  input.setEnabled(false);
  down(win, 'ArrowUp'); stepN(input, 0.1, 20);
  assert.equal(input.getControls().pitch, 0);
  input.setEnabled(true);
  const inp = win.document.createElement('input'); win.document.body.append(inp);
  const ev = new win.KeyboardEvent('keydown', { code: 'KeyG', bubbles: true, cancelable: true });
  inp.dispatchEvent(ev);
  assert.equal(input.getControls().gearDown, false);
  down(win, 'KeyG', { ctrlKey: true });
  assert.equal(input.getControls().gearDown, false, 'Ctrl+G no es una acción');
});

test('palanca con mouse: movimiento relativo, recentrado suave tras una pausa', () => {
  const t = setup();
  const { win, input } = t;
  input.setMouseStick(true);
  const mm = (x, y) => mouseMove(win, x, y);
  t.setNow(1); mm(175, -70);
  let c = input.getControls();
  assert.ok(Math.abs(c.roll - 0.5) < 1e-9, 'roll 0,5: ' + c.roll);
  assert.ok(Math.abs(c.pitch + 0.2) < 1e-9, 'mouse arriba = pitch negativo');
  t.setNow(1.1); input.update(0.1);
  assert.ok(Math.abs(input.getControls().roll - 0.5) < 1e-9, 'sin recentrar durante la demora');
  const trace = [];
  for (let i = 0; i < 100; i++) { t.setNow(1.5 + i * 0.05); input.update(0.05); trace.push(input.getControls().roll); }
  assert.ok(trace[0] < 0.5 && trace[0] > trace[10], 'decae de forma monótona');
  for (let i = 1; i < trace.length; i++) assert.ok(trace[i] <= trace[i - 1] + 1e-12);
  assert.equal(trace.at(-1), 0);
  t.setNow(10); mm(5000, 5000);
  c = input.getControls(); assert.equal(c.roll, 1); assert.equal(c.pitch, 1);
});

test('mouse como palanca desactivado: el movimiento no mueve controles; M alterna', () => {
  const { win, input } = setup();
  const mm = () => mouseMove(win, 100, 0);
  mm(); assert.equal(input.getControls().roll, 0);
  down(win, 'KeyM'); up(win, 'KeyM');
  assert.equal(input.mouseStick, true);
  mm(); assert.ok(input.getControls().roll > 0);
  down(win, 'KeyM'); up(win, 'KeyM');
  assert.equal(input.mouseStick, false); assert.equal(input.getControls().roll, 0);
});

test('botón derecho: el movimiento va a la mirada, no a la palanca; rueda acumula zoom', () => {
  const { win, input } = setup();
  input.setMouseStick(true);
  win.document.body.dispatchEvent(new win.MouseEvent('mousedown', { button: 2, bubbles: true }));
  mouseMove(win, 100, 40);
  assert.equal(input.getControls().roll, 0);
  const l = input.getLook();
  assert.equal(l.active, true); assert.ok(l.dyaw > 0); assert.ok(l.dpitch < 0);
  assert.equal(input.getLook().dyaw, 0, 'los deltas se consumen');
  win.document.dispatchEvent(new win.MouseEvent('mouseup', { button: 2, bubbles: true }));
  assert.equal(input.getLook().active, false);
  win.document.body.dispatchEvent(new win.WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
  assert.ok(input.getLook().zoom > 0);
});

test('reasignación de teclas: quita duplicados, persiste y se recarga', () => {
  const storage = memStorage();
  const a = setup({ storage });
  const displaced = a.input.setBinding('gear', ['KeyJ']);
  assert.deepEqual(displaced, []);
  const d2 = a.input.setBinding('flaps', ['KeyJ']);
  assert.deepEqual(d2, ['gear']);
  assert.deepEqual(a.input.getBindings().gear, []);
  down(a.win, 'KeyJ'); up(a.win, 'KeyJ');
  assert.equal(a.input.getControls().flaps, 1);
  assert.equal(a.input.getControls().gearDown, false);
  assert.ok(storage.getItem(INPUT_STORAGE_KEY));
  const b = setup({ storage });
  assert.deepEqual(b.input.getBindings().flaps, ['KeyJ']);
  down(b.win, 'KeyF'); up(b.win, 'KeyF');
  assert.equal(b.input.getControls().flaps, 0, 'la tecla F ya no está asignada a flaps');
  b.input.resetBindings();
  assert.deepEqual(b.input.getBindings(), defaultBindings());
  assert.throws(() => b.input.setBinding('noExiste', ['KeyQ']));
});

test('ajustes persistentes con validación y almacenamiento corrupto', () => {
  const storage = memStorage({ [INPUT_STORAGE_KEY]: '{no es json' });
  const a = setup({ storage });
  assert.equal(a.input.getSettings().ramp.rise, 1.2);
  a.input.setSettings({ throttleRate: 9999, ramp: { rise: -3 }, mouseSensitivity: 'x', expo: { pitch: 5 } });
  const s = a.input.getSettings();
  assert.equal(s.throttleRate, 5); assert.ok(s.ramp.rise >= 0.3); assert.equal(s.mouseSensitivity, 350); assert.equal(s.expo.pitch, 0.95);
  const b = setup({ storage });
  assert.equal(b.input.getSettings().throttleRate, 5);
});

test('captura de tecla para reasignar no dispara acciones', () => {
  const { win, input } = setup();
  let got = null; const acts = [];
  input.on('action', (n) => acts.push(n));
  input.capture((c) => { got = c; });
  down(win, 'KeyG');
  assert.equal(got, 'KeyG'); assert.equal(acts.length, 0); assert.equal(input.capturing, false);
});

test('reset() sincroniza palancas con la condición inicial (sin toberas)', () => {
  const { input } = setup();
  input.reset({ throttle: 0.7, gearDown: false, flaps: 1, assist: { stabilityAug: 0.3 } });
  let c = input.getControls();
  assert.equal(c.throttle, 0.7); assert.equal(c.flaps, 1); assert.equal(c.gearDown, false); assert.equal(c.assist.stabilityAug, 0.3);
  input.reset({ throttle: 0.2, gearDown: true, flaps: 2 });
  c = input.getControls(); assert.equal(c.gearDown, true); assert.equal(c.flaps, 2); assert.equal(c.assist.stabilityAug, 1);
  assert.ok(ACTIONS.length > 20);
});

test('compatibilidad con src/xr/mapping.js: press(airbrake) alterna aerofrenos; toberas/agua no hacen nada', () => {
  const { input } = setup();
  input.press('airbrake'); assert.equal(input.getControls().speedbrake, 1);
  assert.doesNotThrow(() => { input.setNozzleDeg(50); input.press('nozzlePreset2'); input.press('water'); });
  assert.equal(input.state.nozzleCmd, 0);
});

test('update con dt inválido no produce NaN', () => {
  const { win, input } = setup();
  down(win, 'ArrowUp');
  input.update(NaN); input.update(-1); input.update(0); input.update(1e9);
  const c = input.getControls();
  for (const k of ['pitch', 'roll', 'yaw', 'throttle', 'brake']) assert.ok(Number.isFinite(c[k]), k);
});
