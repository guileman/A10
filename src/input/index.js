// Entrada: teclado + mouse -> `controls` (contrato §3.1). Sin dependencias de three.
// El DOM y el almacenamiento se inyectan (probable con jsdom).

export const INPUT_STORAGE_KEY = 'a10.input.v1';

/**
 * Definición de acciones: id, etiqueta, grupo, tipo y teclas por defecto (KeyboardEvent.code).
 * kind 'hold' = se mantiene (no emite evento); 'press' = pulsación (emite `emit || id` por input.on('action')).
 */
export const ACTIONS = [
  { id: 'pitchDown', label: 'Cabeceo: proa abajo (palanca adelante)', group: 'Vuelo', kind: 'hold', keys: ['ArrowUp'] },
  { id: 'pitchUp', label: 'Cabeceo: proa arriba (palanca atrás)', group: 'Vuelo', kind: 'hold', keys: ['ArrowDown'] },
  { id: 'rollLeft', label: 'Alabeo izquierda', group: 'Vuelo', kind: 'hold', keys: ['ArrowLeft'] },
  { id: 'rollRight', label: 'Alabeo derecha', group: 'Vuelo', kind: 'hold', keys: ['ArrowRight'] },
  { id: 'yawLeft', label: 'Pedal izquierdo', group: 'Vuelo', kind: 'hold', keys: ['KeyA'] },
  { id: 'yawRight', label: 'Pedal derecho', group: 'Vuelo', kind: 'hold', keys: ['KeyD'] },
  { id: 'trimPitchDown', label: 'Compensador de cabeceo: proa abajo (mantener)', group: 'Vuelo', kind: 'hold', keys: ['Comma'] },
  { id: 'trimPitchUp', label: 'Compensador de cabeceo: proa arriba (mantener)', group: 'Vuelo', kind: 'hold', keys: ['Period'] },
  { id: 'throttleUp', label: 'Gases: aumentar', group: 'Motor', kind: 'hold', keys: ['KeyW'] },
  { id: 'throttleDown', label: 'Gases: reducir', group: 'Motor', kind: 'hold', keys: ['KeyS'] },
  { id: 'gun', label: 'Cañón GAU-8 (mantener; también botón izq. del mouse)', group: 'Armas', kind: 'hold', keys: ['Space'] },
  { id: 'missile', label: 'Disparar Maverick', group: 'Armas', kind: 'press', emit: 'fireMissile', keys: ['Enter'] },
  { id: 'lock', label: 'Fijar blanco (más cercano al centro / ciclar)', group: 'Armas', kind: 'press', emit: 'lockTarget', keys: ['KeyL'] },
  { id: 'unlock', label: 'Soltar blanco', group: 'Armas', kind: 'press', emit: 'unlockTarget', keys: ['KeyU'] },
  { id: 'replay', label: 'Repetición del último impacto (cámara de suelo)', group: 'Vista', kind: 'press', keys: ['KeyX'] },
  { id: 'gear', label: 'Tren de aterrizaje', group: 'Aeronave', kind: 'press', keys: ['KeyG'] },
  { id: 'flaps', label: 'Flaps (ciclo UP / MVR / DN)', group: 'Aeronave', kind: 'press', keys: ['KeyF'] },
  { id: 'brake', label: 'Frenos de ruedas (mantener)', group: 'Aeronave', kind: 'hold', keys: ['KeyB'] },
  { id: 'parkingBrake', label: 'Freno de estacionamiento', group: 'Aeronave', kind: 'press', keys: ['KeyV'] },
  { id: 'speedbrake', label: 'Aerofrenos (decelerones)', group: 'Aeronave', kind: 'press', keys: ['KeyK'] },
  { id: 'cameraNext', label: 'Cambiar cámara', group: 'Vista', kind: 'press', keys: ['KeyC'] },
  { id: 'worldRelocate', label: 'Reubicar cámara de mundo', group: 'Vista', kind: 'press', keys: ['KeyT'] },
  { id: 'toggleHud', label: 'Mostrar/ocultar HUD', group: 'Vista', kind: 'press', keys: ['KeyH'] },
  { id: 'toggleMouse', label: 'Mouse como palanca (on/off)', group: 'Vista', kind: 'press', keys: ['KeyM'] },
  { id: 'centerStick', label: 'Centrar palanca del mouse (también botón central)', group: 'Vuelo', kind: 'press', keys: ['KeyQ'] },
  { id: 'screenshot', label: 'Captura de pantalla', group: 'Sistema', kind: 'press', keys: ['F2'] },
  { id: 'pause', label: 'Pausa / menú', group: 'Sistema', kind: 'press', keys: ['KeyP', 'Escape'] },
  { id: 'reset', label: 'Reiniciar', group: 'Sistema', kind: 'press', keys: ['KeyR'] },
];
const ACTION_IDS = new Set(ACTIONS.map((a) => a.id));
const PRESS = new Set(ACTIONS.filter((a) => a.kind === 'press').map((a) => a.id));
const EMIT = Object.fromEntries(ACTIONS.filter((a) => a.emit).map((a) => [a.id, a.emit]));

export function defaultBindings() {
  const o = {};
  for (const a of ACTIONS) o[a.id] = a.keys.slice();
  return o;
}

export function defaultInputSettings() {
  return {
    // Rampa de teclado en cabeceo y alabeo: sube a `rise` 1/s (1,2 → 0,83 s a fondo; en el Harrier 2,5 daba giros bruscos)
    // y vuelve a neutro a `fall` 1/s. Los pedales usan `yawRise` (más rápido).
    ramp: { rise: 1.2, fall: 4.0, yawRise: 2.5 },
    // Curva exponencial del teclado: salida = (1-e)·v + e·v³ (e = 0: lineal). Solo para el teclado, no para mouse/VR.
    expo: { pitch: 0.45, roll: 0.35, yaw: 0.2 },
    throttleRate: 0.5,                  // 1/s con W/S
    // Mouse como palanca (por defecto): el mouse mueve una palanca virtual de cabeceo (adelante/atrás) y alabeo
    // (izq./der.) que QUEDA donde se la deja, como una palanca real; Q o el botón central la centran.
    mouseStick: true,
    mouseSensitivity: 400,              // px de movimiento para deflexión total
    mouseRecenterDelay: 0.35,           // s sin mover antes de recentrar (si mouseRecenterRate > 0)
    mouseRecenterRate: 0,               // 1/s (decaimiento exponencial); 0 = la palanca se queda donde se la deja
    mouseDeadzone: 0.03,                // zona muerta en el centro (fracción de la deflexión)
    mouseExpo: 0.3,                     // curva del mouse: más fino cerca del centro
    invertMouseY: false,
    lookSensitivity: 0.0035,            // rad/px
    invertLookY: false,
  };
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const fin = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Etiqueta legible de un KeyboardEvent.code. */
export function codeLabel(code) {
  if (!code) return '—';
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return 'Num' + code.slice(6);
  const map = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc', Space: 'Espacio', Backquote: '`',
    Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
    Backslash: '\\', ShiftLeft: 'Shift izq.', ShiftRight: 'Shift der.', ControlLeft: 'Ctrl izq.', ControlRight: 'Ctrl der.',
    Enter: 'Enter', Tab: 'Tab', Backspace: 'Retroceso', Delete: 'Supr', PageUp: 'Re Pág', PageDown: 'Av Pág' };
  return map[code] || code;
}

export function createInput(opts = {}) {
  const { target = null, storage = null } = opts;
  const doc = opts.document || (target && (target.ownerDocument || target.document)) || (typeof document !== 'undefined' ? document : null);
  const win = opts.window || (doc && doc.defaultView) || (typeof window !== 'undefined' ? window : null);
  const now = opts.now || (() => (typeof performance !== 'undefined' ? performance.now() / 1000 : Date.now() / 1000));
  const pointerTarget = (target && target.addEventListener) ? target : doc;

  // ---- configuración persistente ----
  let bindings = defaultBindings();
  let settings = defaultInputSettings();
  const loadCfg = (cfg) => {
    if (!cfg || typeof cfg !== 'object') return;
    if (cfg.bindings && typeof cfg.bindings === 'object') {
      for (const id of Object.keys(cfg.bindings)) {
        if (ACTION_IDS.has(id) && Array.isArray(cfg.bindings[id])) bindings[id] = cfg.bindings[id].filter((c) => typeof c === 'string').slice(0, 4);
      }
    }
    if (cfg.settings) {
      const st0 = cfg.v === 1 ? { ...cfg.settings, mouseStick: true, mouseRecenterRate: 0, mouseSensitivity: 400 } : cfg.settings;
      applySettings(st0, false);
    }
  };
  const applySettings = (p, save = true) => {
    const s = settings, d = defaultInputSettings();
    if (p.ramp) {
      s.ramp.rise = clamp(fin(p.ramp.rise, s.ramp.rise), 0.3, 20); s.ramp.fall = clamp(fin(p.ramp.fall, s.ramp.fall), 0.3, 30);
      s.ramp.yawRise = clamp(fin(p.ramp.yawRise, s.ramp.yawRise), 0.3, 20);
    }
    if (p.expo) for (const k of ['pitch', 'roll', 'yaw']) if (k in p.expo) s.expo[k] = clamp(fin(p.expo[k], d.expo[k]), 0, 0.95);
    if ('throttleRate' in p) s.throttleRate = clamp(fin(p.throttleRate, d.throttleRate), 0.05, 5);
    if ('mouseStick' in p) s.mouseStick = !!p.mouseStick;
    if ('mouseSensitivity' in p) s.mouseSensitivity = clamp(fin(p.mouseSensitivity, d.mouseSensitivity), 50, 3000);
    if ('mouseRecenterDelay' in p) s.mouseRecenterDelay = clamp(fin(p.mouseRecenterDelay, d.mouseRecenterDelay), 0, 3);
    if ('mouseRecenterRate' in p) s.mouseRecenterRate = clamp(fin(p.mouseRecenterRate, d.mouseRecenterRate), 0, 20);
    if ('invertMouseY' in p) s.invertMouseY = !!p.invertMouseY;
    if ('mouseDeadzone' in p) s.mouseDeadzone = clamp(fin(p.mouseDeadzone, d.mouseDeadzone), 0, 0.3);
    if ('mouseExpo' in p) s.mouseExpo = clamp(fin(p.mouseExpo, d.mouseExpo), 0, 0.95);
    if ('lookSensitivity' in p) s.lookSensitivity = clamp(fin(p.lookSensitivity, d.lookSensitivity), 0.0005, 0.02);
    if ('invertLookY' in p) s.invertLookY = !!p.invertLookY;
    if (save) persist();
  };
  const persist = () => {
    if (!storage) return;
    try { storage.setItem(INPUT_STORAGE_KEY, JSON.stringify({ v: 2, bindings, settings })); } catch { /* cuota/privado */ }
  };
  try {
    const t = storage && storage.getItem(INPUT_STORAGE_KEY);
    if (t) loadCfg(JSON.parse(t));
  } catch { /* JSON corrupto: se usan los valores por defecto */ }
  if (opts.config) loadCfg(opts.config);

  let codeToActions = new Map();
  const rebuild = () => {
    codeToActions = new Map();
    for (const id of Object.keys(bindings)) for (const c of bindings[id]) {
      if (!codeToActions.has(c)) codeToActions.set(c, []);
      codeToActions.get(c).push(id);
    }
  };
  rebuild();

  // ---- estado ----
  const down = new Set();            // códigos apretados
  const held = Object.create(null);  // acción -> nº de teclas apretadas que la activan
  const st = {
    pitch: 0, roll: 0, yaw: 0, throttle: 0,
    flaps: 0, gearDown: false, parkingBrake: false, speedbrake: false, mouseGun: false,
    mx: 0, my: 0, lastMouseMove: -1e9, brake: 0,
    xp: 0, xr: 0, xy: 0, xb: 0,         // entradas externas (palancas de VR)
    stab: 1,
  };
  const look = { dyaw: 0, dpitch: 0, zoom: 0, active: false, yaw: 0, pitch: 0 };
  let enabled = opts.enabled !== false;
  let rightDown = false;
  let locked = false, wantLock = false;
  let captureCb = null;
  const listeners = new Map();
  const emit = (name, ...a) => { const l = listeners.get(name); if (l) for (const f of l.slice()) f(...a); };
  const on = (name, fn) => {
    if (!listeners.has(name)) listeners.set(name, []);
    listeners.get(name).push(fn);
    return () => { const l = listeners.get(name); const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); };
  };

  const releaseAll = () => {
    down.clear();
    for (const k of Object.keys(held)) held[k] = 0;
    rightDown = false; look.active = false; st.mx = 0; st.my = 0; st.mouseGun = false;
  };

  const doPress = (id) => {
    switch (id) {
      case 'gear': st.gearDown = !st.gearDown; break;
      case 'flaps': st.flaps = (st.flaps + 1) % 3; break;
      case 'parkingBrake': st.parkingBrake = !st.parkingBrake; break;
      case 'speedbrake': st.speedbrake = !st.speedbrake; break;
      case 'toggleMouse': api.setMouseStick(!settings.mouseStick); break;
      case 'centerStick': st.mx = 0; st.my = 0; break;
      default: break;
    }
    emit('action', EMIT[id] || id);
  };

  const isTextTarget = (e) => {
    const t = e.target, n = t && t.tagName;
    return n === 'INPUT' || n === 'TEXTAREA' || n === 'SELECT' || (t && t.isContentEditable);
  };

  const onKeyDown = (e) => {
    if (captureCb) {
      e.preventDefault();
      const cb = captureCb; captureCb = null;
      cb(e.code, e);
      return;
    }
    if (!enabled || isTextTarget(e)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const acts = codeToActions.get(e.code);
    if (!acts) return;
    e.preventDefault();
    if (down.has(e.code)) return; // autorepetición: ignorar
    down.add(e.code);
    for (const id of acts) {
      if (PRESS.has(id)) doPress(id);
      else held[id] = (held[id] || 0) + 1;
    }
  };
  const onKeyUp = (e) => {
    if (!down.has(e.code)) return;
    down.delete(e.code);
    const acts = codeToActions.get(e.code);
    if (acts) for (const id of acts) if (!PRESS.has(id)) held[id] = Math.max(0, (held[id] || 0) - 1);
  };
  const onBlur = () => releaseAll();
  const onVis = () => { if (doc && doc.hidden) releaseAll(); };

  const onMouseMove = (e) => {
    if (!enabled) return;
    const mx = fin(e.movementX, 0), my = fin(e.movementY, 0);
    if (rightDown) {
      look.dyaw += mx * settings.lookSensitivity;
      look.dpitch += (settings.invertLookY ? 1 : -1) * my * settings.lookSensitivity;
      return;
    }
    if (settings.mouseStick) {
      const k = 1 / settings.mouseSensitivity;
      st.mx = clamp(st.mx + mx * k, -1, 1);
      st.my = clamp(st.my + (settings.invertMouseY ? -1 : 1) * my * k, -1, 1);
      st.lastMouseMove = now();
    }
  };
  const onMouseDown = (e) => {
    if (!enabled) return;
    if (e.button === 2) { rightDown = true; look.active = true; e.preventDefault && e.preventDefault(); }
    else if (e.button === 1) { st.mx = 0; st.my = 0; if (e.preventDefault) e.preventDefault(); }
    else if (e.button === 0) {
      // botón izquierdo = cañón con el puntero tomado. El primer clic solo toma el mouse (no dispara).
      if (settings.mouseStick && !locked && pointerTarget && pointerTarget.requestPointerLock) { requestLock(); return; }
      if (settings.mouseStick || locked) st.mouseGun = true;
    }
  };
  const onMouseUp = (e) => { if (e.button === 2) { rightDown = false; look.active = false; } else if (e.button === 0) st.mouseGun = false; };
  const onWheel = (e) => {
    if (!enabled) return;
    const dy = fin(e.deltaY, 0);
    look.zoom += Math.sign(dy) * Math.min(3, Math.abs(dy) / 100 || 1);
    if (e.preventDefault) e.preventDefault();
  };
  const onContext = (e) => { if (enabled) e.preventDefault(); };
  const onLockChange = () => {
    const was = locked;
    locked = !!(doc && doc.pointerLockElement);
    if (was && !locked && wantLock && settings.mouseStick) { st.mx = 0; st.my = 0; emit('action', 'pause'); }
  };
  const requestLock = () => {
    if (!settings.mouseStick || !pointerTarget || !pointerTarget.requestPointerLock) return;
    wantLock = true;
    try { const r = pointerTarget.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch { /* sin gesto */ }
  };
  const exitLock = () => {
    wantLock = false;
    try { if (doc && doc.pointerLockElement && doc.exitPointerLock) doc.exitPointerLock(); } catch { /* nada */ }
  };

  const ev = (t, type, fn, o) => t && t.addEventListener && t.addEventListener(type, fn, o);
  const evOff = (t, type, fn) => t && t.removeEventListener && t.removeEventListener(type, fn);
  const bindAll = (on_) => {
    const f = on_ ? ev : evOff;
    f(doc, 'keydown', onKeyDown); f(doc, 'keyup', onKeyUp);
    f(win, 'blur', onBlur); f(doc, 'visibilitychange', onVis);
    f(doc, 'mousemove', onMouseMove);
    f(pointerTarget, 'mousedown', onMouseDown); f(doc, 'mouseup', onMouseUp);
    f(pointerTarget, 'wheel', onWheel, { passive: false });
    f(pointerTarget, 'contextmenu', onContext);
    f(doc, 'pointerlockchange', onLockChange);
  };
  bindAll(true);

  // ---- API ----
  const axisTarget = (neg, pos) => ((held[pos] > 0 ? 1 : 0) - (held[neg] > 0 ? 1 : 0));
  const ramp = (v, t, dt, rise) => {
    const { fall } = settings.ramp;
    if (t === 0) { const s = fall * dt; return v > s ? v - s : v < -s ? v + s : 0; }
    // cruzar el neutro hacia el lado opuesto es más rápido (sumando la caída)
    const r = (Math.sign(v) === -t ? rise + fall : rise) * dt;
    return clamp(v + t * r, -1, 1);
  };
  /** Curva exponencial suave: (1-e)·v + e·v³ (monótona, f(±1) = ±1). */
  const expo = (v, e) => (1 - e) * v + e * v * v * v;
  const stepToward = (v, t, r) => (v < t ? Math.min(t, v + r) : Math.max(t, v - r));

  const api = {
    on,
    get enabled() { return enabled; },
    setEnabled(b) { enabled = !!b; if (!enabled) { releaseAll(); if (locked) exitLock(); } },
    update(dt) {
      if (!(dt > 0)) return;
      dt = Math.min(dt, 0.1);
      st.pitch = ramp(st.pitch, axisTarget('pitchDown', 'pitchUp'), dt, settings.ramp.rise);
      st.roll = ramp(st.roll, axisTarget('rollLeft', 'rollRight'), dt, settings.ramp.rise);
      st.yaw = ramp(st.yaw, axisTarget('yawLeft', 'yawRight'), dt, settings.ramp.yawRise);
      st.throttle = clamp(st.throttle + axisTarget('throttleDown', 'throttleUp') * settings.throttleRate * dt, 0, 1);
      st.brake = stepToward(st.brake, held.brake > 0 ? 1 : 0, (held.brake > 0 ? 4 : 6) * dt);
      // palanca con mouse: recentrado exponencial tras un instante sin movimiento
      if (settings.mouseStick && (st.mx !== 0 || st.my !== 0)) {
        if (now() - st.lastMouseMove > settings.mouseRecenterDelay) {
          const k = Math.exp(-settings.mouseRecenterRate * dt);
          st.mx *= k; st.my *= k;
          if (Math.abs(st.mx) < 1e-3) st.mx = 0;
          if (Math.abs(st.my) < 1e-3) st.my = 0;
        }
      }
      if (!settings.mouseStick) { st.mx = 0; st.my = 0; }
    },
    getControls(out) {
      const c = out || {};
      if (!c.assist) c.assist = {};
      if (!c.trim) c.trim = {};
      const ex = settings.expo;
      const mdz = (v) => { const a = Math.abs(v), z = settings.mouseDeadzone; return a <= z ? 0 : Math.sign(v) * expo((a - z) / (1 - z), settings.mouseExpo); };
      const mp = mdz(st.my), mr = mdz(st.mx);
      c.pitch = clamp(expo(st.pitch, ex.pitch) + mp + st.xp, -1, 1);
      c.roll = clamp(expo(st.roll, ex.roll) + mr + st.xr, -1, 1);
      c.mouseStick = settings.mouseStick; c.mouseLocked = locked; c.stickX = st.mx; c.stickY = st.my;
      c.yaw = clamp(expo(st.yaw, ex.yaw) + st.xy, -1, 1);
      c.throttle = st.throttle;
      c.flaps = st.flaps;
      c.gearDown = st.gearDown;
      c.brake = Math.max(st.brake, st.xb);
      c.parkingBrake = st.parkingBrake;
      c.speedbrake = st.speedbrake ? 1 : 0;
      c.airbrake = st.speedbrake;                                   // compatibilidad con el contrato del Harrier
      c.triggerGun = (held.gun || 0) > 0 || st.mouseGun;
      // compensadores: VELOCIDAD de compensación (−1..1) mientras se mantiene la tecla; + = proa arriba
      c.trim.pitch = axisTarget('trimPitchDown', 'trimPitchUp'); c.trim.roll = 0; c.trim.yaw = 0;
      c.assist.stabilityAug = st.stab;
      return c;
    },
    /** Mirada libre/zoom para el rig de cámara. dyaw/dpitch/zoom son deltas acumulados desde la última lectura (se consumen). */
    getLook(out) {
      const l = out || {};
      l.yaw = look.dyaw; l.pitch = look.dpitch; l.dyaw = look.dyaw; l.dpitch = look.dpitch; l.zoom = look.zoom; l.active = look.active;
      look.dyaw = 0; look.dpitch = 0; look.zoom = 0;
      return l;
    },
    /** Sincroniza el estado de las palancas al iniciar/reiniciar (se empieza en vuelo: el tren arriba por defecto). */
    reset(p = {}) {
      releaseAll();
      st.pitch = st.roll = st.yaw = 0; st.mx = st.my = 0; st.brake = 0;
      st.throttle = clamp(fin(p.throttle, 0.7), 0, 1);
      st.flaps = [0, 1, 2].includes(p.flaps) ? p.flaps : 0;
      st.gearDown = p.gearDown !== undefined ? !!p.gearDown : false;
      st.parkingBrake = false; st.speedbrake = false; st.mouseGun = false;
      st.stab = p.assist ? clamp(fin(p.assist.stabilityAug, 1), 0, 1) : 1;
    },
    setAssist(a) { if (a) st.stab = clamp(fin(a.stabilityAug, st.stab), 0, 1); },
    /** Entrada externa (mandos de VR): palanca en [-1,1] y freno en [0,1]; se suma a la del teclado. */
    setExternal({ pitch = 0, roll = 0, yaw = 0, brake = 0 } = {}) { st.xp = clamp(fin(pitch, 0), -1, 1); st.xr = clamp(fin(roll, 0), -1, 1); st.xy = clamp(fin(yaw, 0), -1, 1); st.xb = clamp(fin(brake, 0), 0, 1); },
    /** Dispara una acción de tipo 'press' (tren, flaps, missile…) como si fuera la tecla. 'airbrake' es alias de 'speedbrake'. */
    press(id) { if (id === 'airbrake') id = 'speedbrake'; if (PRESS.has(id)) doPress(id); },
    get state() { return { throttle: st.throttle, nozzleCmd: 0 }; },   // nozzleCmd: solo para src/xr/mapping.js (heredado; siempre 0)
    setThrottle(v) { st.throttle = clamp(fin(v, 0), 0, 1); },
    setNozzleDeg() { /* sin toberas en el A-10C: no-op (compatibilidad con src/xr/mapping.js) */ },
    // ---- mouse ----
    get mouseStick() { return settings.mouseStick; },
    setMouseStick(b) {
      settings.mouseStick = !!b; st.mx = 0; st.my = 0;
      if (b) requestLock(); else exitLock();
      persist(); emit('mouseStick', settings.mouseStick);
    },
    get pointerLocked() { return locked; },
    // ---- configuración ----
    getBindings() { const o = {}; for (const k of Object.keys(bindings)) o[k] = bindings[k].slice(); return o; },
    /** Asigna teclas a una acción; las quita de otras acciones y devuelve las acciones que perdieron alguna tecla. */
    setBinding(action, codes) {
      if (!ACTION_IDS.has(action)) throw new Error('acción desconocida: ' + action);
      const list = (Array.isArray(codes) ? codes : [codes]).filter(Boolean);
      const displaced = [];
      for (const id of Object.keys(bindings)) {
        if (id === action) continue;
        const before = bindings[id].length;
        bindings[id] = bindings[id].filter((c) => !list.includes(c));
        if (bindings[id].length !== before) displaced.push(id);
      }
      bindings[action] = list.slice(0, 4);
      rebuild(); releaseAll(); persist();
      return displaced;
    },
    resetBindings() { bindings = defaultBindings(); rebuild(); releaseAll(); persist(); },
    getSettings() { return JSON.parse(JSON.stringify(settings)); },
    setSettings(p) { applySettings(p || {}, true); },
    resetSettings() { settings = defaultInputSettings(); persist(); },
    /** Captura la próxima tecla (para reasignar). cb(code, event). Devuelve función de cancelación. */
    capture(cb) { captureCb = cb; return () => { if (captureCb === cb) captureCb = null; }; },
    get capturing() { return !!captureCb; },
    codeLabel,
    actions: ACTIONS,
    dispose() { bindAll(false); exitLock(); listeners.clear(); },
    /** Solo para pruebas. */
    _state: st,
    _releaseAll: releaseAll,
  };
  return api;
}
