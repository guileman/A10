// UI del A-10C: menú principal, ruta del convoy y misión, controles, calidad, hora/clima, ayuda, pausa, carga, avisos y HUD.
// Todo el DOM se crea desde JS (CSS inyectado). `root`, `storage` y `engine` se inyectan.
import { CSS } from './styles.js';
import { makeDom, focusables } from './widgets.js';
import { createHud } from './hud.js';
import { createRouteMap, makeSource } from './runwaymap.js';
import {
  computeRoute, withLengthBearing, MIN_ROUTE_LENGTH_M, MAX_ROUTE_LENGTH_M, DEFAULT_ROUTE_LENGTH_M, toLocalEN, norm360, validLatLon,
} from './geo.js';
import { loadSettings, saveSettings, buildConfig, sanitize, LIMITS } from './settings.js';
import { ACTIONS, codeLabel } from '../input/index.js';

export { createHud } from './hud.js';
export * from './geo.js';
export { loadSettings, saveSettings, buildConfig, sanitize, defaultSettings, SETTINGS_KEY, LIMITS } from './settings.js';

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
const compass = (deg) => COMPASS[Math.round(norm360(deg) / 22.5) % 16];
const QUALITY_INFO = {
  bajo: 'Prioriza la tasa de cuadros: resolución reducida, sin sombras y alcance de dibujo corto.',
  medio: 'Equilibrio entre fluidez y detalle (recomendado).',
  alto: 'Máximo detalle: mayor resolución, sombras y alcance de dibujo. Exige una GPU potente.',
};

export function createUI({ root, engine = null, storage = null, input = null, document: docOverride = null, setTimeoutFn = null } = {}) {
  if (!root) throw new Error('createUI: falta root');
  const doc = docOverride || root.ownerDocument;
  const win = doc.defaultView;
  const timeout = setTimeoutFn || ((fn, ms) => (win && win.setTimeout ? win.setTimeout(fn, ms) : setTimeout(fn, ms)));
  const D = makeDom(doc);
  const { h, comma, btn, segment, slider, row, numField } = D;

  // ---- estilos y contenedores ----
  if (!doc.getElementById('hz-ui-style')) {
    const st = doc.createElement('style'); st.id = 'hz-ui-style'; st.textContent = CSS; (doc.head || root).appendChild(st);
  }
  const host = h('div', { class: 'hz' });
  const canvas = h('canvas', { class: 'hz-hud', 'aria-hidden': 'true' });
  const screenEl = h('div', { class: 'hz-screen', role: 'dialog', 'aria-modal': 'true' });
  const loadBar = h('i');
  const loadMsg = h('div', { class: 'msg', role: 'status', 'aria-live': 'polite' });
  const loadEl = h('div', { class: 'hz-load' }, h('h1', { text: 'A-10C Thunderbolt II' }), loadMsg, h('div', { class: 'hz-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100 }, loadBar));
  const toasts = h('div', { class: 'hz-toasts', 'aria-live': 'polite' });
  host.append(canvas, toasts, screenEl, loadEl);
  root.appendChild(host);

  let settings = loadSettings(storage);
  const save = () => saveSettings(storage, settings);
  const hud = createHud({ canvas, options: { scale: settings.hud.scale, color: settings.hud.color } });
  const listeners = {};
  const emit = (name, ...a) => { for (const f of (listeners[name] || []).slice()) f(...a); };
  const on = (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); return () => { listeners[name] = listeners[name].filter((f) => f !== fn); }; };

  // ---- navegación ----
  let current = null;        // {name, el, onLeave}
  let stack = [];            // nombres de pantallas previas
  let context = 'menu';      // 'menu' | 'pause'
  let capturing = null;      // fila en captura de tecla
  const screens = {};

  const setInputEnabled = (b) => { if (input && input.setEnabled) input.setEnabled(b); };

  const leave = () => { if (current && current.onLeave) { try { current.onLeave(); } catch { /* nada */ } } current = null; };
  function go(name, push = true) {
    if (current && push) stack.push(current.name);
    leave();
    screenEl.textContent = '';
    const s = screens[name]();
    s.name = name;
    current = s;
    screenEl.classList.toggle('hz-dim', context === 'pause');
    screenEl.append(s.el);
    screenEl.classList.add('on');
    setInputEnabled(false);
    const f = s.focus || focusables(s.el)[0];
    if (f && f.focus) f.focus();
    screenEl.scrollTop = 0;
  }
  function back() {
    if (!current) return;
    const prev = stack.pop();
    if (prev) go(prev, false);
    else if (context === 'pause') resume();
  }
  function hideAll() {
    leave(); stack = []; screenEl.classList.remove('on'); screenEl.textContent = '';
    setInputEnabled(true);
  }
  function resume() { hideAll(); emit('resume'); }
  const isOpen = () => screenEl.classList.contains('on');

  // ---- piezas comunes ----
  const panel = (title, sub, ...kids) => h('div', { class: 'hz-panel' }, h('h2', { text: title }), sub ? h('p', { class: 'sub', text: sub }) : null, ...kids);
  const backBtn = (label = 'Volver') => btn('← ' + label, () => back(), { cls: 'sm' });
  const footer = () => h('div', { class: 'hz-footer', text: '↑ ↓ navegar · ← → cambiar valor · Enter aceptar · Esc volver' });
  const km = (m, d = 1) => comma(m / 1000, d) + ' km';
  const routeSummary = () => {
    const r = computeRoute(settings.route.a, settings.route.b);
    return { r, text: `Convoy ${km(r.lengthM)} · rumbo ${comma(r.bearingTrue, 0)}° V · fuente ${settings.source === 'real' ? 'satelital real' : 'demo'}` };
  };
  const MIX_LABEL = { blindados: 'Blindados', mixto: 'Mixto', camiones: 'Camiones' };

  // ============ Menú principal ============
  screens.main = () => {
    const sm = routeSummary();
    const m = settings.mission;
    const el = h('div', { class: 'hz-panel narrow' },
      h('h1', { text: 'A-10C Thunderbolt II' }),
      h('p', { class: 'sub', text: 'Simulador de ataque a tierra · interdicción de un convoy · mando por teclado y mouse' }),
      h('div', { class: 'hz-menu' },
        btn('Volar', () => go('fly'), { cls: 'primary', sub: `${m.convoySize} vehículos · ${MIX_LABEL[m.mix].toLowerCase()} · ${m.loadout.mavericks} Maverick` }),
        btn('Ruta del convoy', () => go('route'), { sub: sm.text }),
        btn('Controles', () => go('controls'), { sub: 'teclas y palanca con mouse' }),
        btn('Calidad gráfica', () => go('quality'), { sub: settings.quality }),
        btn('Hora del día y clima', () => go('weather'), { sub: `${settings.timeOfDay} · viento ${settings.environment.windKt} kt` }),
        btn('Ayuda', () => go('help'), {}),
      ),
      footer());
    return { el };
  };

  // ============ Preparación del vuelo ("Volar") ============
  screens.fly = () => {
    const sm = routeSummary();
    const status = h('div', { class: 'hz-status ' + (sm.r.valid ? 'ok' : 'bad'), text: sm.r.valid ? sm.text : `La ruta mide ${comma(sm.r.lengthM, 0)} m: debe medir entre ${comma(MIN_ROUTE_LENGTH_M, 0)} y ${comma(MAX_ROUTE_LENGTH_M, 0)} m. Corregila en «Ruta del convoy».` });
    const go_ = btn('Iniciar vuelo', () => start(), { cls: 'primary' });
    const goVR = btn('Iniciar en modo VR', () => start({ vr: true }), { sub: 'Carga el mundo y te pide entrar en VR' });
    const ms = settings.mission, L = LIMITS;
    const sl = (label, key, step, fmt, get, set, hint) => row(label, slider({ min: L[key][0], max: L[key][1], step, value: get(), fmt, label, onInput: (v) => { set(v); save(); } }), hint);
    const el = panel('Preparación del vuelo', 'Misión, condición inicial y ayudas. Se empieza siempre en vuelo. Los ajustes se guardan.',
      status,
      h('h3', { text: 'Convoy enemigo' }),
      sl('Vehículos del convoy', 'convoySize', 1, (v) => String(Math.round(v)), () => ms.convoySize, (v) => { ms.convoySize = Math.round(v); }),
      row('Composición', segment([{ v: 'blindados', label: 'Blindados' }, { v: 'mixto', label: 'Mixto' }, { v: 'camiones', label: 'Camiones' }], ms.mix, (v) => { ms.mix = v; save(); }, 'Composición del convoy'),
        'Blindados: más resistentes. Camiones: más rápidos y frágiles.'),
      h('h3', { text: 'Punto de partida' }),
      sl('Distancia al convoy', 'startDistanceKm', 0.5, (v) => comma(v, 1) + ' km', () => ms.startDistanceKm, (v) => { ms.startDistanceKm = v; }, 'Desde el inicio de la ruta, enfilado hacia el convoy.'),
      sl('Altitud inicial', 'startAltFt', 100, (v) => comma(v, 0) + ' ft', () => ms.startAltFt, (v) => { ms.startAltFt = v; }),
      sl('Velocidad inicial', 'startSpeedKt', 10, (v) => v + ' kt', () => ms.startSpeedKt, (v) => { ms.startSpeedKt = v; }),
      h('h3', { text: 'Avión' }),
      sl('Mavericks (AGM-65)', 'mavericks', 1, (v) => String(Math.round(v)), () => ms.loadout.mavericks, (v) => { ms.loadout.mavericks = Math.round(v); }, 'El cañón GAU-8/A siempre lleva 1 150 cartuchos.'),
      sl('Combustible', 'fuelKg', 50, (v) => comma(v, 0) + ' kg', () => settings.fuelKg, (v) => { settings.fuelKg = v; }, 'Interno máx. 4 853 kg.'),
      row('Aumento de estabilidad (SAS)', slider({ min: 0, max: 1, step: 0.05, value: settings.assist.stabilityAug, fmt: (v) => Math.round(v * 100) + ' %', label: 'Aumento de estabilidad', onInput: (v) => { settings.assist.stabilityAug = v; save(); } }), 'El A-10C real tiene SAS de cabeceo y guiñada.'),
      row('Cámara inicial', segment([{ v: 'pilot', label: 'Piloto' }, { v: 'chase', label: 'Persecución' }, { v: 'world', label: 'Mundo' }], settings.camera, (v) => { settings.camera = v; save(); }, 'Cámara')),
      h('div', { class: 'hz-actions' }, go_, goVR, backBtn()),
      footer());
    return { el, focus: go_ };
  };

  function start(opts) {
    const r = computeRoute(settings.route.a, settings.route.b);
    if (!r.valid) { toast(`Ruta fuera de rango (${comma(MIN_ROUTE_LENGTH_M / 1000, 0)}–${comma(MAX_ROUTE_LENGTH_M / 1000, 0)} km)`); go('route'); return; }
    save();
    const cfg = buildConfig(settings);
    hud.setEnvironment(cfg.environment);
    hud.reset(cfg.fuelKg);
    hud.setMode(cfg.camera);
    context = 'menu';
    hideAll();
    api.showLoading('Preparando el vuelo…', 0);
    setInputEnabled(false);
    emit('start', opts && opts.vr ? { ...cfg, vr: true } : cfg);
  }

  // ============ Ruta del convoy ============
  screens.route = () => {
    // borrador: permite 0/1 puntos mientras se marca en el mapa
    const draft = { a: { ...settings.route.a }, b: { ...settings.route.b } };
    const mapBox = h('div', { class: 'hz-map' });
    const svgHolder = h('div', {});
    const status = h('div', { class: 'hz-status' });
    const kv = h('div', { class: 'hz-kv' });
    let map = null;
    const refs = {};
    const fmtC = (v) => v.toFixed(5);

    const mk = (label, key, get, set) => numField({ value: get(), label, onCommit: (v, el) => { if (validLatLon({ lat: key === 'lat' ? v : 0, lon: key === 'lon' ? v : 0 })) { set(v); el.classList.remove('bad'); } else el.classList.add('bad'); } });
    const coord = (which) => ({
      lat: mk('lat', 'lat', () => (draft[which] ? fmtC(draft[which].lat) : ''), (v) => { draft[which] = { ...(draft[which] || { lon: draft.a ? draft.a.lon : settings.map.lon }), lat: v }; changed('num'); }),
      lon: mk('lon', 'lon', () => (draft[which] ? fmtC(draft[which].lon) : ''), (v) => { draft[which] = { ...(draft[which] || { lat: draft.a ? draft.a.lat : settings.map.lat }), lon: v }; changed('num'); }),
    });
    refs.c1 = coord('a'); refs.c2 = coord('b');
    for (const [c, w] of [[refs.c1, 'inicio'], [refs.c2, 'fin']]) { c.lat.setAttribute('aria-label', `Ruta ${w}: latitud`); c.lon.setAttribute('aria-label', `Ruta ${w}: longitud`); }

    const lenIn = numField({ value: '', label: 'Largo (m)', onCommit: (v) => { if (draft.a && draft.b && Number.isFinite(v)) { const r = computeRoute(draft.a, draft.b); draft.b = withLengthBearing(draft.a, v, r.bearingTrue); changed('num'); } } });
    const brgIn = numField({ value: '', label: 'Rumbo verdadero (°)', onCommit: (v) => { if (draft.a && draft.b && Number.isFinite(v)) { const r = computeRoute(draft.a, draft.b); draft.b = withLengthBearing(draft.a, r.lengthM, v); changed('num'); } } });

    function commitDraft() {
      if (draft.a && draft.b && validLatLon(draft.a) && validLatLon(draft.b)) {
        settings.route.a = { ...draft.a }; settings.route.b = { ...draft.b };
        save();
      }
    }
    function changed(src) {
      commitDraft();
      if (src !== 'map' && map && map.available && draft.a && draft.b) { map.setPoints(draft.a, draft.b); }
      render(src);
    }
    function render(src) {
      const have = draft.a && draft.b;
      const r = have ? computeRoute(draft.a, draft.b) : null;
      if (src !== 'num') {
        for (const [w, c] of [['a', refs.c1], ['b', refs.c2]]) {
          c.lat.value = draft[w] ? fmtC(draft[w].lat) : ''; c.lon.value = draft[w] ? fmtC(draft[w].lon) : '';
        }
      }
      if (r) { lenIn.value = comma(r.lengthM, 0); brgIn.value = comma(r.bearingTrue, 1); }
      else { lenIn.value = ''; brgIn.value = ''; }
      kv.textContent = '';
      if (r) kv.append(h('span', { text: 'Sentido de marcha del convoy' }), h('b', { text: `${comma(r.bearingTrue, 0)}° V (${compass(r.bearingTrue)})` }),
        h('span', { text: 'Rumbo inverso (verdadero)' }), h('b', { text: comma(norm360(r.bearingTrue + 180), 1) + '°' }));
      status.className = 'hz-status ' + (r && r.valid ? 'ok' : 'bad');
      status.textContent = !have ? 'Marcá en el mapa (o escribí) el inicio y el fin de la ruta del convoy.'
        : r.valid ? `Largo ${comma(r.lengthM, 0)} m (entre ${comma(MIN_ROUTE_LENGTH_M, 0)} y ${comma(MAX_ROUTE_LENGTH_M, 0)} m).` : `Largo ${comma(r.lengthM, 0)} m: debe medir entre ${comma(MIN_ROUTE_LENGTH_M, 0)} y ${comma(MAX_ROUTE_LENGTH_M, 0)} m.`;
      lenIn.classList.toggle('bad', !!r && !r.valid);
      svgHolder.textContent = '';
      if (r) svgHolder.append(routeSvg(doc, draft.a, draft.b, r));
    }

    const onMapChange = ({ a, b }) => {
      draft.a = a; draft.b = b;
      changed('map');
    };
    // el mapa se crea después de insertar el contenedor (MapView necesita tamaño)
    const initMap = () => {
      const src = makeSource(engine, settings.source);
      map = createRouteMap({ engine, container: mapBox, source: src, center: { lon: settings.map.lon, lat: settings.map.lat, zoom: settings.map.zoom }, onChange: onMapChange });
      if (map.available) { map.setPoints(draft.a, draft.b); map.fit(0.4); }
      else mapBox.append(h('div', { class: 'nomap', text: 'Mapa no disponible' + (map.error ? ' (' + map.error + ')' : '') + '. Podés definir la ruta con las coordenadas de inicio y fin.' }));
    };

    const el = h('div', { class: 'hz-panel' },
      h('h2', { text: 'Ruta del convoy' }),
      h('p', { class: 'sub', text: `Ruta recta A→B por la que avanza el convoy enemigo. Largo por defecto ${comma(DEFAULT_ROUTE_LENGTH_M / 1000, 0)} km; de ${comma(MIN_ROUTE_LENGTH_M / 1000, 0)} a ${comma(MAX_ROUTE_LENGTH_M / 1000, 0)} km.` }),
      h('div', { class: 'hz-cols' },
        h('div', {}, mapBox, h('div', { class: 'hz-actions' },
          btn('Limpiar marcas', () => { draft.a = null; draft.b = null; if (map) map.clear(); render(); }, { cls: 'sm' }),
          btn('Encuadrar ruta', () => { if (map) map.fit(0.4); }, { cls: 'sm' }),
          btn('Ruta por defecto (Roldán)', () => { const d = sanitize(null).route; draft.a = d.a; draft.b = d.b; changed('init'); if (map) map.fit(0.4); }, { cls: 'sm' })),
          svgHolder),
        h('div', {},
          row('Fuente de datos', segment([{ v: 'real', label: 'Real (satelital)' }, { v: 'demo', label: 'Demo (sintético)' }], settings.source, (v) => { settings.source = v; save(); const c = map && map.getCenter(); if (c) { settings.map = { ...settings.map, ...c }; } if (map) map.dispose(); mapBox.textContent = ''; initMap(); }, 'Fuente de datos'),
            'Real requiere conexión; demo funciona sin red.'),
          h('h3', { text: 'Ruta del convoy: inicio (A)' }), h('div', { class: 'hz-pair' }, refs.c1.lat, refs.c1.lon),
          h('h3', { text: 'Ruta del convoy: fin (B)' }), h('div', { class: 'hz-pair' }, refs.c2.lat, refs.c2.lon),
          h('h3', { text: 'Ruta (editable)' }),
          row('Largo (m)', lenIn, `Entre ${comma(MIN_ROUTE_LENGTH_M, 0)} y ${comma(MAX_ROUTE_LENGTH_M, 0)} m. Mueve el fin (B).`),
          row('Rumbo verdadero (°)', brgIn, 'De A a B (0 = norte, horario).'),
          kv, status,
          row('Margen alrededor de la ruta', slider({ min: LIMITS.extentKm[0], max: LIMITS.extentKm[1], step: 0.5, value: settings.extentKm, fmt: (v) => comma(v, 1) + ' km', label: 'Margen alrededor de la ruta', onInput: (v) => { settings.extentKm = v; save(); } }), 'Extensión del mundo generado a cada lado de la ruta.'))),
      h('div', { class: 'hz-actions' }, backBtn('Volver al menú')),
      footer());
    // diferir la creación del mapa al próximo tick para que el contenedor tenga tamaño
    timeout(() => { if (current && current.name === 'route' && !map) { initMap(); } }, 0);
    render('init');
    return {
      el,
      focus: refs.c1.lat,
      onLeave: () => {
        if (map) { const c = map.getCenter(); if (c) { settings.map = { ...settings.map, ...c }; } map.dispose(); map = null; }
        commitDraft(); save();
      },
    };
  };
  screens.runway = screens.route;   // alias del Harrier

  // ============ Controles ============
  screens.controls = () => {
    const wrap = h('div', {});
    const keysBox = h('div', {});
    const hintEl = h('p', { class: 'sub', text: 'Seleccioná una acción y pulsá la nueva tecla (Supr borra, Esc cancela).' });
    const renderKeys = () => {
      keysBox.textContent = '';
      if (!input) { keysBox.append(h('p', { text: 'Entrada no disponible.' })); return; }
      const b = input.getBindings();
      const groups = {};
      for (const a of ACTIONS) (groups[a.group] = groups[a.group] || []).push(a);
      for (const g of Object.keys(groups)) {
        keysBox.append(h('h3', { text: g }));
        const grid = h('div', { class: 'hz-keys' });
        for (const a of groups[g]) {
          const k = h('button', { type: 'button', class: 'hz-key hz-nav', 'data-action': a.id,
            onClick: (e) => capture(a, e.currentTarget) },
          h('span', { text: a.label }), h('span', {}, (b[a.id] || []).length ? (b[a.id] || []).map((c) => h('span', { class: 'hz-kbd', text: codeLabel(c) })) : h('span', { class: 'hz-kbd', text: '—' })));
          grid.append(k);
        }
        keysBox.append(grid);
      }
    };
    const capture = (a, el) => {
      if (capturing) capturing.cancel();
      el.classList.add('cap');
      el.lastChild.textContent = 'Pulsá una tecla…';
      const cancel = input.capture((code) => {
        capturing = null;
        if (code === 'Escape') { /* cancelar */ }
        else if (code === 'Delete') input.setBinding(a.id, []);
        else {
          const cur = input.getBindings()[a.id] || [];
          const displaced = input.setBinding(a.id, [code, ...cur.filter((c) => c !== code)].slice(0, 2));
          if (displaced.length) toast('«' + codeLabel(code) + '» quitada de: ' + displaced.map((id) => (ACTIONS.find((x) => x.id === id) || {}).label).join(', '));
        }
        renderKeys();
        const again = keysBox.querySelector(`[data-action="${a.id}"]`); if (again) again.focus();
      });
      capturing = { cancel: () => { cancel(); capturing = null; renderKeys(); } };
    };
    renderKeys();
    const s = input ? input.getSettings() : null;
    const set = (p) => input && input.setSettings(p);
    const tuning = !input ? h('div') : h('div', {},
      h('h3', { text: 'Ajustes de control' }),
      row('Mouse como palanca', segment([{ v: 'off', label: 'No' }, { v: 'on', label: 'Sí (tecla M)' }], s.mouseStick ? 'on' : 'off', (v) => set({ mouseStick: v === 'on' }), 'Mouse como palanca'), 'Mouse adelante/atrás = cabeceo, izq./der. = alabeo. La palanca queda donde la dejás; Q o el botón central la centran. El primer clic toma el mouse.'),
      row('Sensibilidad del mouse', slider({ min: 100, max: 1200, step: 25, value: s.mouseSensitivity, fmt: (v) => v + ' px', label: 'Sensibilidad del mouse', onInput: (v) => set({ mouseSensitivity: v }) }), 'Píxeles de recorrido para deflexión total (menos = más sensible).'),
      row('Recentrado del mouse', slider({ min: 0, max: 8, step: 0.2, value: s.mouseRecenterRate, fmt: (v) => (v === 0 ? 'sin recentrar' : comma(v, 1) + ' /s'), label: 'Recentrado del mouse', onInput: (v) => set({ mouseRecenterRate: v }) })),
      row('Invertir eje Y del mouse', segment([{ v: 'off', label: 'No' }, { v: 'on', label: 'Sí' }], s.invertMouseY ? 'on' : 'off', (v) => set({ invertMouseY: v === 'on' }), 'Invertir eje Y')),
      row('Rampa de teclado: cabeceo y alabeo', slider({ min: 0.5, max: 8, step: 0.1, value: s.ramp.rise, fmt: (v) => comma(1 / v, 2) + ' s a fondo', label: 'Rampa de subida', onInput: (v) => set({ ramp: { rise: v } }) }), 'Más lenta = giros menos bruscos al exigir el cabeceo.'),
      row('Rampa de teclado: pedales', slider({ min: 0.5, max: 8, step: 0.1, value: s.ramp.yawRise, fmt: (v) => comma(1 / v, 2) + ' s a fondo', label: 'Rampa de pedales', onInput: (v) => set({ ramp: { yawRise: v } }) })),
      row('Rampa de teclado: retorno', slider({ min: 0.5, max: 12, step: 0.1, value: s.ramp.fall, fmt: (v) => comma(1 / v, 2) + ' s a neutro', label: 'Rampa de retorno', onInput: (v) => set({ ramp: { fall: v } }) })),
      row('Suavizado del cabeceo (curva exp.)', slider({ min: 0, max: 0.9, step: 0.05, value: s.expo.pitch, fmt: (v) => (v === 0 ? 'lineal' : Math.round(v * 100) + ' %'), label: 'Suavizado del cabeceo', onInput: (v) => set({ expo: { pitch: v } }) }), 'Reduce la sensibilidad cerca del centro; a fondo sigue siendo 100 %.'),
      row('Suavizado del alabeo (curva exp.)', slider({ min: 0, max: 0.9, step: 0.05, value: s.expo.roll, fmt: (v) => (v === 0 ? 'lineal' : Math.round(v * 100) + ' %'), label: 'Suavizado del alabeo', onInput: (v) => set({ expo: { roll: v } }) })),
      row('Velocidad de gases (W/S)', slider({ min: 0.1, max: 2, step: 0.05, value: s.throttleRate, fmt: (v) => comma(1 / v, 1) + ' s de 0 a 100 %', label: 'Velocidad de gases', onInput: (v) => set({ throttleRate: v }) })));
    const reset = btn('Restablecer teclas', () => { if (input) { input.resetBindings(); renderKeys(); toast('Teclas restablecidas'); } }, { cls: 'sm warn' });
    wrap.append(hintEl, keysBox,
      h('p', { class: 'sub', text: 'Mouse: mover = cabeceo y alabeo · botón izquierdo = cañón · botón central o Q = centrar palanca · botón derecho = mirar · rueda = distancia / zoom de cámara.' }), tuning,
      h('div', { class: 'hz-actions' }, reset, backBtn()));
    const el = panel('Controles', null, wrap, footer());
    return { el, onLeave: () => { if (capturing) capturing.cancel(); } };
  };

  // ============ Calidad gráfica y pantalla ============
  screens.quality = () => {
    const info = h('p', { class: 'sub', text: QUALITY_INFO[settings.quality] });
    const el = panel('Calidad gráfica', 'Se aplica al iniciar el vuelo (y en vivo si el motor lo permite).',
      row('Calidad', segment([{ v: 'bajo', label: 'Baja' }, { v: 'medio', label: 'Media' }, { v: 'alto', label: 'Alta' }], settings.quality, (v) => { settings.quality = v; info.textContent = QUALITY_INFO[v]; save(); emit('quality', v); emit('settings', settings); }, 'Calidad gráfica')),
      info,
      h('h3', { text: 'Sonido' }),
      row('Volumen', slider({ min: 0, max: 1, step: 0.05, value: settings.audio.volume, fmt: (v) => Math.round(v * 100) + ' %', label: 'Volumen', onInput: (v) => { settings.audio.volume = v; save(); emit('settings', settings); } })),
      row('Silenciar', segment([{ v: 'no', label: 'Con sonido' }, { v: 'si', label: 'Silenciado' }], settings.audio.muted ? 'si' : 'no', (v) => { settings.audio.muted = v === 'si'; save(); emit('settings', settings); }, 'Silenciar')),
      h('h3', { text: 'HUD' }),
      row('Tamaño del HUD', slider({ min: 0.7, max: 1.6, step: 0.05, value: settings.hud.scale, fmt: (v) => Math.round(v * 100) + ' %', label: 'Tamaño del HUD', onInput: (v) => { settings.hud.scale = v; hud.setOptions({ scale: v }); save(); } })),
      row('Color del HUD', segment([{ v: 'verde', label: 'Verde' }, { v: 'ambar', label: 'Ámbar' }], settings.hud.color, (v) => { settings.hud.color = v; hud.setOptions({ color: v }); save(); }, 'Color del HUD')),
      h('div', { class: 'hz-actions' }, backBtn()), footer());
    return { el };
  };

  // ============ Hora del día y clima ============
  screens.weather = () => {
    const e = settings.environment;
    const dirTxt = h('span');
    const pct = (v) => Math.round(v * 100) + ' %';
    const el = panel('Hora del día y clima', 'Condiciones atmosféricas del vuelo (atmósfera estándar + desvío).',
      row('Hora del día', segment([{ v: 'amanecer', label: 'Amanecer' }, { v: 'dia', label: 'Día' }, { v: 'tarde', label: 'Tarde' }, { v: 'atardecer', label: 'Atardecer' }], settings.timeOfDay, (v) => { settings.timeOfDay = v; save(); }, 'Hora del día')),
      row('Viento: intensidad', slider({ min: 0, max: 40, step: 1, value: e.windKt, fmt: (v) => v + ' kt', label: 'Intensidad del viento', onInput: (v) => { e.windKt = v; save(); } })),
      row('Viento: procedencia', slider({ min: 0, max: 355, step: 5, value: e.windFromDeg, fmt: (v) => `${String(Math.round(v)).padStart(3, '0')}° ${compass(v)}`, label: 'Procedencia del viento', onInput: (v) => { e.windFromDeg = v; save(); } }), 'Rumbo verdadero desde el que sopla el viento.'),
      row('Temperatura (desvío ISA)', slider({ min: -20, max: 35, step: 1, value: e.tempOffsetC, fmt: (v) => `ISA ${v >= 0 ? '+' : '−'}${Math.abs(v)} °C`, label: 'Desvío de temperatura', onInput: (v) => { e.tempOffsetC = v; save(); } }), 'Afecta la densidad y por lo tanto el empuje disponible.'),
      row('QNH', slider({ min: 980, max: 1040, step: 1, value: e.qnhHpa, fmt: (v) => v + ' hPa', label: 'QNH', onInput: (v) => { e.qnhHpa = v; save(); } })),
      row('Turbulencia', slider({ min: 0, max: 1, step: 0.05, value: e.turbulence, fmt: pct, label: 'Turbulencia', onInput: (v) => { e.turbulence = v; save(); } })),
      h('div', { class: 'hz-actions' }, backBtn()), footer());
    void dirTxt;
    return { el };
  };

  // ============ Ayuda ============
  screens.help = () => {
    const b = input ? input.getBindings() : {};
    const lab = (id) => (b[id] || []).map(codeLabel).join(' / ') || '—';
    const rows = ACTIONS.filter((a) => b[a.id]).map((a) => h('tr', {}, h('td', { text: a.label }), h('td', {}, h('span', { class: 'hz-kbd', text: lab(a.id) }))));
    const el = panel('Ayuda', 'Resumen de mando, instrumentos y técnica de ataque a tierra.',
      h('h3', { text: 'Teclas actuales' }), h('table', {}, h('tbody', {}, rows)),
      h('p', { text: 'Mouse (palanca, activada por defecto): adelante = proa abajo, atrás = proa arriba, izq./der. = alabeo. La palanca queda donde la dejás (indicador «PALANCA» en el HUD); Q o el botón central la centran. Primer clic = tomar el mouse; después, botón izquierdo = cañón · botón derecho = mirar · rueda = zoom · M = activar/desactivar · Esc = soltar el mouse y pausar.' }),
      h('h3', { text: 'Armas' }),
      h('p', { text: 'Cañón GAU-8/A: mantené Espacio (o el botón izquierdo del mouse). Lleva 1 150 cartuchos; al apretar el gatillo los cañones tardan un instante en girar hasta la cadencia plena.' }),
      h('p', { text: 'Maverick AGM-65: L fija el blanco más cercano al centro (pulsá de nuevo para ciclar), U lo suelta, Enter dispara. El blanco fijado se marca con un diamante.' }),
      h('p', { text: 'Pipper CCIP: el círculo con punto central es el punto de impacto previsto del cañón. El anillo exterior se llena con la distancia al blanco. «IN RNG» aparece con el blanco a menos de 4 km; «SHOOT», cuando el pipper está sobre un blanco a menos de 2,5 km.' }),
      h('h3', { text: 'Instrumentos (unidades de aviación)' }),
      h('p', { text: 'KIAS en kt · altitud barométrica y de radar (RAD, sobre el terreno) en ft · régimen de ascenso (VS) en ft/min · rumbo en grados · g · Mach · N1 de cada motor TF34 en % · combustible en kg.' }),
      h('p', { text: 'Tren: tres luces (nariz, izquierda, derecha): verde = abajo y trabado, rojo = en tránsito, apagadas = recogido. Flaps: UP / MVR / DN. Aerofrenos (K): decelerones abiertos o cerrados.' }),
      h('p', { text: 'Avisos: STALL (pérdida) en rojo; BUFFET (sacudida previa a la pérdida) en ámbar. Compensador de cabeceo: Coma = proa abajo, Punto = proa arriba (mantener).' }),
      h('h3', { text: 'Técnica básica (orientativa)' }),
      h('p', { text: 'Ataque con cañón: picá suave hacia el convoy desde unos 3 000 ft, poné el pipper sobre el vehículo y disparale en ráfagas cortas a menos de 2,5 km; recuperá antes de pasar los 1 000 ft sobre el terreno. Ataque con Maverick: fijá el blanco a 4–8 km, esperá que se complete el enganche y disparalo; podés seguir al misil con la cámara de arma (C).' }),
      h('div', { class: 'hz-actions' }, backBtn()), footer());
    return { el };
  };

  // ============ Pausa ============
  screens.pause = () => {
    const first = btn('Reanudar', () => resume(), { cls: 'primary' });
    const el = h('div', { class: 'hz-panel narrow' }, h('h2', { text: 'Pausa' }), h('p', { class: 'sub', text: 'Simulación detenida.' }),
      h('div', { class: 'hz-menu' }, first,
        btn('Reiniciar vuelo', () => { hideAll(); emit('restart'); }, { sub: 'R' }),
        btn('Controles', () => go('controls')), btn('Calidad gráfica', () => go('quality')), btn('Ayuda', () => go('help')),
        btn('Volver al menú principal', () => { context = 'menu'; stack = []; emit('menu'); go('main', false); }, { cls: 'warn' })),
      footer());
    return { el, focus: first };
  };

  // ---- toasts / carga ----
  function toast(text, ms = 2600) {
    const t = h('div', { class: 'hz-toast', text });
    toasts.append(t);
    while (toasts.children.length > 4) toasts.firstChild.remove();
    timeout(() => t.remove(), ms);
    return t;
  }

  // ---- teclado de navegación ----
  const onKey = (e) => {
    if (!isOpen() || e.defaultPrevented || (input && input.capturing)) return;
    const t = e.target;
    const k = e.key;
    if (k === 'Escape' || (k === 'p' || k === 'P') && current && current.name === 'pause' && !(t && t.tagName === 'INPUT')) {
      e.preventDefault();
      if (current && current.name === 'main') return;
      back(); return;
    }
    if (k === 'ArrowUp' || k === 'ArrowDown') {
      const list = focusables(current ? current.el : screenEl);
      if (!list.length) return;
      let i = list.indexOf(t);
      if (i < 0 && t && t.closest) { const g = t.closest('.hz-seg'); if (g) i = list.findIndex((x) => g.contains(x)); }
      i = i < 0 ? 0 : (i + (k === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
      list[i].focus(); e.preventDefault(); return;
    }
    if ((k === 'ArrowLeft' || k === 'ArrowRight') && t && t.closest && t.closest('.hz-seg')) {
      const g = t.closest('.hz-seg'); if (g.step) g.step(k === 'ArrowRight' ? 1 : -1); e.preventDefault(); return;
    }
    if (k === 'Enter' && t && t.tagName === 'BUTTON') { /* click nativo */ }
  };
  doc.addEventListener('keydown', onKey);

  const onResize = () => hud.resize();
  if (win) win.addEventListener('resize', onResize);
  hud.resize();

  const api = {
    hud,
    root: host,
    get settings() { return settings; },
    getSettings() { return settings; },
    getConfig() { return buildConfig(settings); },
    setSettings(s) { settings = sanitize(s); save(); },
    on,
    onStart(fn) { return on('start', fn); },
    onResume(fn) { return on('resume', fn); },
    onRestart(fn) { return on('restart', fn); },
    onMenu(fn) { return on('menu', fn); },
    get isOpen() { return isOpen(); },
    showMainMenu() { context = 'menu'; stack = []; hideAll(); go('main', false); },
    showPause() { context = 'pause'; stack = []; hideAll(); go('pause', false); },
    showScreen(name) { if (name === 'runway') name = 'route'; if (screens[name]) { stack = []; go(name, false); } },
    hideAll,
    toast,
    attachInput(i) { input = i; },
    /** FOV vertical (°) de la cámara de piloto, para que la escalera de cabeceo del HUD sea conforme con el paisaje. */
    setCameraFov(fov) { if (Number.isFinite(fov)) hud.setOptions({ vfovDeg: fov }); },
    showLoading(msg = 'Cargando…', p = 0) { api.setLoading(p, msg); loadEl.classList.add('on'); },
    setLoading(p, msg) {
      const f = Math.min(1, Math.max(0, Number.isFinite(p) ? p : 0));
      loadBar.style.width = (f * 100).toFixed(1) + '%';
      loadBar.parentNode.setAttribute('aria-valuenow', String(Math.round(f * 100)));
      if (msg !== undefined) loadMsg.textContent = msg;
    },
    hideLoading() { loadEl.classList.remove('on'); if (!isOpen()) setInputEnabled(true); },
    resize: onResize,
    dispose() { doc.removeEventListener('keydown', onKey); if (win) win.removeEventListener('resize', onResize); leave(); host.remove(); },
    // para pruebas
    _screens: screens,
  };
  return api;
}

/** Vista previa de la ruta del convoy (SVG): puntos A y B a escala, sentido de marcha y norte. */
export function routeSvg(doc, a, b, r) {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (n, at, t) => { const e = doc.createElementNS(NS, n); for (const k in at) e.setAttribute(k, at[k]); if (t) e.textContent = t; return e; };
  const W = 520, H = 130, svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'rwy', role: 'img', 'aria-label': `Ruta del convoy de ${Math.round(r.lengthM)} m` });
  const e = toLocalEN(a, b);
  const len = Math.hypot(e.e, e.n) || 1;
  const L = W - 120, x0 = 60, x1 = 60 + L, y = H / 2 + 6;
  svg.append(el('line', { x1: x0, y1: y, x2: x1, y2: y, stroke: '#46ff9c', 'stroke-width': 2, 'stroke-dasharray': '12 7' }));
  svg.append(el('polygon', { points: `${x1},${y} ${x1 - 10},${y - 5} ${x1 - 10},${y + 5}`, fill: '#46ff9c' }));
  for (const [x, t] of [[x0, 'A'], [x1, 'B']]) {
    svg.append(el('circle', { cx: x, cy: y, r: 6, fill: '#101713', stroke: '#ffb000', 'stroke-width': 2 }));
    svg.append(el('text', { x, y: y + 24, 'text-anchor': 'middle', fill: '#ffb000', 'font-size': 14, 'font-family': 'monospace' }, t));
  }
  svg.append(el('text', { x: W / 2, y: 18, 'text-anchor': 'middle', fill: '#8aa596', 'font-size': 12, 'font-family': 'monospace' }, `${Math.round(len)} m · rumbo ${r.bearingTrue.toFixed(0)}° V  (A → B, el convoy avanza hacia B)`));
  // flecha norte respecto de la ruta (dibujo horizontal = rumbo verdadero A→B)
  const an = r.bearingTrue * Math.PI / 180, cx = W - 26, cy = H - 28;
  svg.append(el('line', { x1: cx, y1: cy, x2: cx + Math.cos(an) * 16, y2: cy - Math.sin(an) * 16, stroke: '#ffb000', 'stroke-width': 2 }));
  svg.append(el('text', { x: cx, y: cy + 18, 'text-anchor': 'middle', fill: '#ffb000', 'font-size': 11, 'font-family': 'monospace' }, 'N'));
  return svg;
}
