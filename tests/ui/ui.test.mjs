import test from 'node:test';
import assert from 'node:assert/strict';
import { createUI } from '../../src/ui/index.js';
import { createInput } from '../../src/input/index.js';
import { createRouteMap, createRunwayMap } from '../../src/ui/runwaymap.js';
import { distanceM, bearingDeg, destination } from '../../src/ui/geo.js';
import { SETTINGS_KEY } from '../../src/ui/settings.js';
import { makeDom, memStorage, mockCtx, down, up } from './helpers.mjs';

class MockMapView {
  static instances = [];
  constructor(container, source, cb) { this.container = container; this.source = source; this.cb = cb; this.path = []; this.disposed = false; this.centerArgs = null; MockMapView.instances.push(this); }
  setCenter(lon, lat, zoom) { this.centerArgs = [lon, lat, zoom]; }
  getCenter() { return { lon: -60.7, lat: -32.9, zoom: 13 }; }
  getPath() { return this.path.map((p) => ({ ...p })); }
  setPath(p) { this.path = p.map((q) => ({ ...q })); }
  clear() { this.path = []; }
  fitPath() { this.fitted = true; }
  dispose() { this.disposed = true; }
  userClick(lon, lat) { this.path.push({ lon, lat }); this.cb.onChange(this.getPath()); }
}
class Syn { constructor() { this.kind = 'syn'; } }
class Tile { constructor() { this.kind = 'tile'; } }

const sleep = (ms = 5) => new Promise((r) => setTimeout(r, ms));
function setup({ engine = { MapView: MockMapView, SyntheticSource: Syn, TileSource: Tile }, storage = memStorage(), withInput = true } = {}) {
  MockMapView.instances.length = 0;
  const dom = makeDom();
  const win = dom.window;
  win.HTMLCanvasElement.prototype.getContext = () => mockCtx();
  const root = win.document.getElementById('root');
  const input = withInput ? createInput({ target: win.document.body, storage }) : null;
  const ui = createUI({ root, engine, storage, input });
  return { dom, win, doc: win.document, root, ui, input, storage };
}
const btnByText = (doc, t) => Array.from(doc.querySelectorAll('button')).find((b) => b.textContent.includes(t));
const press = (win, key, target) => { const e = new win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }); (target || win.document.activeElement || win.document.body).dispatchEvent(e); return e; };

test('menú principal: las seis entradas, foco en Volar, navegación con ↑/↓', () => {
  const { ui, doc, win } = setup();
  ui.showMainMenu();
  const labels = ['Volar', 'Ruta del convoy', 'Controles', 'Calidad gráfica', 'Hora del día y clima', 'Ayuda'];
  const btns = Array.from(doc.querySelectorAll('.hz-menu button'));
  assert.equal(btns.length, 6);
  labels.forEach((l, i) => assert.ok(btns[i].textContent.startsWith(l), l));
  assert.equal(doc.activeElement, btns[0]);
  press(win, 'ArrowDown'); assert.equal(doc.activeElement, btns[1]);
  press(win, 'ArrowUp'); press(win, 'ArrowUp'); assert.equal(doc.activeElement, btns[5], 'circular');
  assert.ok(ui.isOpen);
  ui.hideAll(); assert.equal(ui.isOpen, false);
});

test('el menú desactiva la entrada de vuelo y la reactiva al ocultarse', () => {
  const { ui, input, win } = setup();
  ui.showMainMenu();
  assert.equal(input.enabled, false);
  down(win, 'ArrowUp'); up(win, 'ArrowUp');
  ui.hideAll();
  assert.equal(input.enabled, true);
});

test('Esc vuelve atrás; en el menú principal no hace nada', () => {
  const { ui, doc, win } = setup();
  ui.showMainMenu();
  btnByText(doc, 'Calidad gráfica').click();
  assert.ok(doc.querySelector('.hz-panel h2').textContent.toLowerCase().includes('calidad'));
  press(win, 'Escape');
  assert.ok(doc.querySelector('.hz-panel h1').textContent === 'A-10C Thunderbolt II', 'volvió al menú con el título del A-10C');
  press(win, 'Escape');
  assert.ok(ui.isOpen);
});

test('Volar entrega el config (route, mission, sin start) y muestra la carga', () => {
  const { ui, doc } = setup();
  let cfg = null;
  ui.onStart((c) => { cfg = c; });
  ui.showMainMenu();
  btnByText(doc, 'Volar').click();
  btnByText(doc, 'Iniciar vuelo').click();
  assert.ok(cfg, 'onStart llamado');
  for (const k of ['source', 'route', 'runway', 'extentKm', 'mission', 'timeOfDay', 'quality', 'environment', 'fuelKg', 'assist', 'camera']) assert.ok(k in cfg, k);
  assert.ok(!('start' in cfg));
  const d = distanceM(cfg.route.a, cfg.route.b);
  assert.ok(Math.abs(d - 3000) < 0.1); assert.equal(cfg.extentKm, 4); assert.equal(cfg.source, 'real'); assert.equal(cfg.fuelKg, 3000);
  assert.deepEqual(cfg.runway.thr1, cfg.route.a);
  assert.deepEqual(cfg.mission, { convoySize: 8, mix: 'mixto', startDistanceKm: 7, startAltFt: 3000, startSpeedKt: 300, loadout: { mavericks: 4 } });
  assert.equal(ui.isOpen, false);
  assert.ok(doc.querySelector('.hz-load.on'), 'pantalla de carga visible');
  assert.equal(doc.querySelector('.hz-load h1').textContent, 'A-10C Thunderbolt II');
  ui.setLoading(0.5, 'Generando terreno');
  assert.equal(parseFloat(doc.querySelector('.hz-bar i').style.width), 50);
  assert.equal(doc.querySelector('.hz-load .msg').textContent, 'Generando terreno');
  ui.setLoading(7, 'x'); assert.equal(parseFloat(doc.querySelector('.hz-bar i').style.width), 100);
  ui.setLoading(NaN); assert.equal(parseFloat(doc.querySelector('.hz-bar i').style.width), 0);
  ui.hideLoading(); assert.ok(!doc.querySelector('.hz-load.on'));
});

test('"Volar": sin condición inicial parado/estacionario; las opciones de misión llegan al config', () => {
  const { ui, doc, win } = setup();
  let cfg;
  ui.onStart((c) => { cfg = c; });
  ui.showMainMenu(); btnByText(doc, 'Volar').click();
  for (const t of ['Estacionario', 'En pista', 'En crucero']) assert.ok(!btnByText(doc, t), 'sin ' + t);
  assert.ok(!doc.querySelector('input[aria-label="Amortiguación en estacionario"]'));
  btnByText(doc, 'Blindados').click();
  btnByText(doc, 'Mundo').click();
  const set = (label, v) => { const i = doc.querySelector(`input[aria-label="${label}"]`); assert.ok(i, label); i.value = String(v); i.dispatchEvent(new win.Event('input', { bubbles: true })); };
  set('Combustible', 1200); set('Vehículos del convoy', 12); set('Distancia al convoy', 9); set('Altitud inicial', 5000);
  set('Velocidad inicial', 250); set('Mavericks (AGM-65)', 6); set('Aumento de estabilidad', 0.5);
  btnByText(doc, 'Iniciar vuelo').click();
  assert.equal(cfg.camera, 'world'); assert.equal(cfg.fuelKg, 1200);
  assert.deepEqual(cfg.mission, { convoySize: 12, mix: 'blindados', startDistanceKm: 9, startAltFt: 5000, startSpeedKt: 250, loadout: { mavericks: 6 } });
  assert.deepEqual(cfg.assist, { stabilityAug: 0.5 });
});

test('"Volar": los deslizadores respetan los rangos (convoy 4–16, combustible 500–4853, Mavericks 0–6)', () => {
  const { ui, doc } = setup();
  ui.showMainMenu(); btnByText(doc, 'Volar').click();
  const rng = (l) => { const i = doc.querySelector(`input[aria-label="${l}"]`); return [+i.min, +i.max]; };
  assert.deepEqual(rng('Vehículos del convoy'), [4, 16]); assert.deepEqual(rng('Combustible'), [500, 4853]);
  assert.deepEqual(rng('Mavericks (AGM-65)'), [0, 6]); assert.deepEqual(rng('Distancia al convoy'), [4, 12]);
  assert.deepEqual(rng('Altitud inicial'), [1000, 8000]); assert.deepEqual(rng('Velocidad inicial'), [200, 380]);
});

test('persistencia: un UI nuevo recupera los ajustes', () => {
  const a = setup();
  a.ui.showMainMenu(); btnByText(a.doc, 'Calidad gráfica').click();
  btnByText(a.doc, 'Alta').click();
  assert.ok(a.storage.getItem(SETTINGS_KEY).includes('"alto"'));
  a.ui.dispose();
  const b = setup({ storage: a.storage });
  assert.equal(b.ui.getConfig().quality, 'alto');
});

test('clima: viento/QNH/turbulencia/hora llegan al config', () => {
  const { ui, doc, win } = setup();
  ui.showMainMenu(); btnByText(doc, 'Hora del día').click();
  btnByText(doc, 'Atardecer').click();
  const set = (label, v) => { const i = doc.querySelector(`input[aria-label="${label}"]`); i.value = String(v); i.dispatchEvent(new win.Event('input', { bubbles: true })); };
  set('Intensidad del viento', 22); set('Procedencia del viento', 270); set('QNH', 1005); set('Turbulencia', 0.6); set('Desvío de temperatura', 15);
  const c = ui.getConfig();
  assert.equal(c.timeOfDay, 'atardecer'); assert.equal(c.environment.windKt, 22); assert.equal(c.environment.windFromDeg, 270);
  assert.equal(c.environment.qnhHpa, 1005); assert.equal(c.environment.turbulence, 0.6); assert.equal(c.environment.tempOffsetC, 15);
});

test('pausa: Reanudar / Esc / P emiten resume; reiniciar y volver al menú emiten sus eventos', () => {
  const { ui, doc, win, input } = setup();
  const ev = [];
  ui.on('resume', () => ev.push('resume')); ui.on('restart', () => ev.push('restart')); ui.on('menu', () => ev.push('menu'));
  ui.showPause();
  assert.ok(doc.querySelector('.hz-screen.on.hz-dim'));
  press(win, 'Escape'); assert.deepEqual(ev, ['resume']); assert.equal(ui.isOpen, false); assert.equal(input.enabled, true);
  ui.showPause(); press(win, 'p'); assert.equal(ev.at(-1), 'resume');
  ui.showPause(); btnByText(doc, 'Reiniciar').click(); assert.equal(ev.at(-1), 'restart');
  ui.showPause(); btnByText(doc, 'Volver al menú principal').click(); assert.equal(ev.at(-1), 'menu');
  assert.ok(doc.querySelector('.hz-panel h1'), 'muestra el menú principal');
  ui.showPause(); btnByText(doc, 'Controles').click(); press(win, 'Escape');
  assert.ok(doc.querySelector('.hz-menu'), 'Esc en Controles vuelve a la pausa');
});

test('ruta: el mapa recibe la fuente real y el centro; se conservan solo los dos últimos puntos', async () => {
  const { ui, doc } = setup();
  ui.showMainMenu(); btnByText(doc, 'Ruta del convoy').click();
  await sleep();
  const m = MockMapView.instances.at(-1);
  assert.ok(m, 'MapView creado'); assert.equal(m.source.kind, 'tile', 'fuente real por defecto'); assert.ok(m.centerArgs);
  assert.equal(m.path.length, 2, 'se cargó la ruta actual');
  m.path = []; m.userClick(-60.93, -32.905);
  assert.equal(doc.querySelector('.hz-status').className.includes('bad'), true, 'falta el punto B');
  m.userClick(-60.9, -32.905);   // ~2,8 km
  assert.equal(doc.querySelector('.hz-status').className.includes('ok'), true);
  m.userClick(-60.88, -32.89);  // 3.er punto: se descarta el más antiguo
  assert.equal(m.path.length, 2);
  assert.ok(Math.abs(m.path[0].lon + 60.9) < 1e-9 && Math.abs(m.path[1].lon + 60.88) < 1e-9);
  const s = ui.getSettings().route;
  assert.ok(Math.abs(s.a.lon + 60.9) < 1e-9 && Math.abs(s.b.lat + 32.89) < 1e-9);
});

test('ruta: largo/rumbo calculados y editables (1–8 km); sin ancho, superficie ni designadores', async () => {
  const { ui, doc, win } = setup();
  ui.showMainMenu(); btnByText(doc, 'Ruta del convoy').click(); await sleep();
  const field = (label) => doc.querySelector(`input[aria-label="${label}"]`);
  const commit = (el, v) => { el.value = String(v); el.dispatchEvent(new win.Event('change', { bubbles: true })); };
  assert.equal(field('Largo (m)').value, '3000');
  assert.equal(field('Rumbo verdadero (°)').value, '270,0');
  for (const l of ['Ancho (m)', 'Variación magnética (°E)']) assert.ok(!field(l), 'sin ' + l);
  for (const t of ['Asfalto', 'Hormigón', 'Césped']) assert.ok(!btnByText(doc, t), t);
  assert.ok(!/designador|05 \/ 23/i.test(doc.body.textContent));
  assert.ok(doc.body.textContent.includes('Ruta del convoy: inicio') && doc.body.textContent.includes('Ruta del convoy: fin'));
  commit(field('Largo (m)'), 5000);
  let r = ui.getSettings().route;
  assert.ok(Math.abs(distanceM(r.a, r.b) - 5000) < 0.05);
  assert.ok(Math.abs(bearingDeg(r.a, r.b) - 270) < 1e-3);
  commit(field('Largo (m)'), 100);
  r = ui.getSettings().route; assert.ok(Math.abs(distanceM(r.a, r.b) - 1000) < 0.05, 'mínimo 1 km');
  commit(field('Largo (m)'), 20000);
  r = ui.getSettings().route; assert.ok(Math.abs(distanceM(r.a, r.b) - 8000) < 0.05, 'máximo 8 km');
  commit(field('Rumbo verdadero (°)'), '90,5');
  r = ui.getSettings().route; assert.ok(Math.abs(bearingDeg(r.a, r.b) - 90.5) < 1e-3);
  // margen (extentKm 2–8)
  const ext = field('Margen alrededor de la ruta'); assert.equal(+ext.min, 2); assert.equal(+ext.max, 8);
  ext.value = '6'; ext.dispatchEvent(new win.Event('input', { bubbles: true })); assert.equal(ui.getConfig().extentKm, 6);
  // edición de coordenadas y validación
  const lat = field('Ruta inicio: latitud');
  commit(lat, '-33,000'); assert.ok(Math.abs(ui.getSettings().route.a.lat + 33) < 1e-9);
  commit(lat, '999'); assert.ok(lat.classList.contains('bad')); assert.ok(Math.abs(ui.getSettings().route.a.lat + 33) < 1e-9, 'no se aplica');
  const m = MockMapView.instances.at(-1);
  assert.equal(m.path.length, 2);
  press(win, 'Escape'); assert.ok(m.disposed);
});

test('ruta fuera de 1–8 km (marcada en el mapa) bloquea el vuelo y lleva a la pantalla de ruta', async () => {
  const { ui, doc } = setup();
  let started = false; ui.onStart(() => { started = true; });
  ui.showMainMenu(); btnByText(doc, 'Ruta del convoy').click(); await sleep();
  const m = MockMapView.instances.at(-1);
  m.path = []; m.userClick(-60.93, -32.905); m.userClick(-60.9299, -32.905); // ~9 m
  btnByText(doc, 'Volver al menú').click();
  btnByText(doc, 'Volar').click();
  assert.ok(doc.querySelector('.hz-status.bad'));
  btnByText(doc, 'Iniciar vuelo').click();
  assert.equal(started, false);
  assert.ok(doc.querySelector('.hz-toast'));
  assert.ok(doc.querySelector('.hz-panel h2').textContent.toLowerCase().includes('ruta del convoy'));
});

test('sin MapView: la pantalla funciona con coordenadas numéricas; showScreen("runway") es alias de la ruta', async () => {
  const { ui, doc, win } = setup({ engine: null });
  ui.showMainMenu(); ui.showScreen('runway'); await sleep();
  assert.ok(doc.querySelector('.nomap'));
  const lenIn = doc.querySelector('input[aria-label="Largo (m)"]');
  lenIn.value = '2000'; lenIn.dispatchEvent(new win.Event('change', { bubbles: true }));
  const r = ui.getSettings().route; assert.ok(Math.abs(distanceM(r.a, r.b) - 2000) < 0.05);
});

test('fuente real (por defecto) usa TileSource y demo SyntheticSource', async () => {
  const { ui, doc } = setup();
  ui.showMainMenu(); btnByText(doc, 'Ruta del convoy').click(); await sleep();
  assert.equal(MockMapView.instances.at(-1).source.kind, 'tile');
  assert.equal(ui.getConfig().source, 'real');
  btnByText(doc, 'Demo (sintético)').click();
  assert.equal(MockMapView.instances.at(-1).source.kind, 'syn');
  assert.equal(ui.getConfig().source, 'demo');
});

test('"Ruta por defecto (Roldán)" restablece A→B de 3 km', async () => {
  const { ui, doc, win } = setup();
  ui.showMainMenu(); btnByText(doc, 'Ruta del convoy').click(); await sleep();
  const lenIn = doc.querySelector('input[aria-label="Largo (m)"]');
  lenIn.value = '7000'; lenIn.dispatchEvent(new win.Event('change', { bubbles: true }));
  btnByText(doc, 'Ruta por defecto').click();
  const r = ui.getSettings().route;
  assert.ok(Math.abs(distanceM(r.a, r.b) - 3000) < 0.1); assert.equal(r.a.lat, -32.905);
});

test('controles: reasignar una tecla desde el menú', () => {
  const { ui, doc, win, input } = setup();
  ui.showMainMenu(); btnByText(doc, 'Controles').click();
  const row = doc.querySelector('[data-action="gear"]');
  row.click();
  assert.ok(row.classList.contains('cap'));
  down(win, 'KeyL');
  assert.ok(input.getBindings().gear[0] === 'KeyL');
  assert.ok(doc.querySelector('[data-action="gear"]').textContent.includes('L'));
  btnByText(doc, 'Restablecer teclas').click();
  assert.deepEqual(input.getBindings().gear, ['KeyG']);
});

test('toast, HUD y modos', () => {
  const { ui, doc } = setup();
  ui.toast('Hola', 5);
  assert.equal(doc.querySelector('.hz-toast').textContent, 'Hola');
  ui.hud.setMode('chase'); assert.equal(ui.hud.mode, 'chase');
  ui.hud.update({ att: {}, air: {}, engine: {}, gear: {}, flags: {}, warnings: [] }, {}, 0.016);
  assert.equal(ui.hud.errors, 0);
});

test('createRouteMap: detecta el formato de puntos del MapView y lo conserva (alias createRunwayMap)', () => {
  assert.equal(createRunwayMap, createRouteMap);
  for (const fmt of ['array', 'object']) {
    const writes = [];
    class V {
      constructor(c, s, cb) { this.cb = cb; this.path = []; V.last = this; }
      setCenter() {} getPath() { return this.path; } setPath(p) { writes.push(p); this.path = p; } clear() {} fitPath() {} getCenter() { return null; } dispose() {}
    }
    const events = [];
    const m = createRouteMap({ engine: { MapView: V }, container: {}, source: {}, onChange: (e) => events.push(e) });
    assert.equal(m.available, true);
    V.last.path = fmt === 'array' ? [[-60, -32], [-59.9, -32], [-59.8, -32]] : [{ lon: -60, lat: -32 }, { lon: -59.9, lat: -32 }, { lon: -59.8, lat: -32 }];
    V.last.cb.onChange();
    assert.equal(V.last.path.length, 2);
    assert.equal(Array.isArray(V.last.path[0]), fmt === 'array');
    assert.equal(events.at(-1).b.lon, -59.8); assert.equal(events.at(-1).a.lon, -59.9);
    m.setPoints({ lat: 1, lon: 2 }, { lat: 3, lon: 4 });
    assert.equal(Array.isArray(V.last.path[0]), fmt === 'array');
    m.dispose(); m.dispose();
  }
  const bad = createRouteMap({ engine: { MapView: class { constructor() { throw new Error('sin WebGL'); } } }, container: {}, source: {}, onChange() {} });
  assert.equal(bad.available, false); assert.ok(bad.error.includes('sin WebGL'));
  assert.doesNotThrow(() => { bad.setPoints({ lat: 0, lon: 0 }); bad.clear(); bad.fit(); bad.dispose(); });
});

test('destination/ rumbo coherentes con la ruta por defecto', () => {
  const { ui } = setup();
  const r = ui.getSettings().route;
  assert.ok(Math.abs(distanceM(r.a, r.b) - 3000) < 0.1);
  assert.ok(Math.abs(bearingDeg(r.a, destination(r.a, 50, 100)) - 50) < 1e-3);
});

test('controles: lista las teclas de armas y ya no las de toberas/agua; ajustes sin toberas', () => {
  const { ui, doc } = setup();
  ui.showMainMenu(); btnByText(doc, 'Controles').click();
  for (const a of ['gun', 'missile', 'lock', 'unlock', 'speedbrake', 'trimPitchUp', 'trimPitchDown']) assert.ok(doc.querySelector(`[data-action="${a}"]`), a);
  for (const a of ['nozzleAft', 'nozzlePreset1', 'water', 'airbrake']) assert.ok(!doc.querySelector(`[data-action="${a}"]`), a);
  assert.ok(doc.querySelector('[data-action="gun"]').textContent.includes('Espacio'));
  assert.ok(doc.querySelector('[data-action="missile"]').textContent.includes('Enter'));
  assert.ok(!/tobera/i.test(doc.body.textContent));
  assert.ok(doc.querySelector('input[aria-label="Suavizado del cabeceo"]'));
});

test('ayuda: describe armas, pipper y teclas nuevas; sin toberas/VTOL/RCS', () => {
  const { ui, doc } = setup();
  ui.showMainMenu(); btnByText(doc, 'Ayuda').click();
  const t = doc.body.textContent;
  for (const w of ['GAU-8', 'Maverick', 'CCIP', 'IN RNG', 'SHOOT', 'Espacio', 'Enter', 'KIAS', 'RAD']) assert.ok(t.includes(w), w);
  assert.ok(!/tobera|VTOL|RCS|Harrier/i.test(t));
});

test('clima: sin "pista mojada"; HUD acepta el 4.º parámetro extra', () => {
  const { ui, doc } = setup();
  ui.showMainMenu(); btnByText(doc, 'Hora del día').click();
  assert.ok(!/pista mojada/i.test(doc.body.textContent));
  ui.hud.setMode('weapon'); assert.equal(ui.hud.mode, 'weapon');
  ui.hud.update({ att: {}, air: {}, engine: {}, gear: {}, flags: {}, warnings: [] }, {}, 0.016, { gun: { ammo: 1150 }, missiles: { left: 4 }, targets: [] });
  assert.equal(ui.hud.errors, 0);
});
