// Simulador del A-10C — orquestación: mundo real (motor del rally) + física + modelo + armas + convoy + cámaras + UI.
import { Vector3, GLTFLoader } from 'three';
import { A10Sim, loadA10Geometry } from './physics/index.js';
import A10_GEOMETRY from './physics/a10.geometry.json';
import { createConvoy } from './game/targets.js';
import { WeaponSystem } from './game/weapons.js';
import { createCombatView, toScreen } from './game/render.js';
import { loadA10Model } from './aircraft/a10model.js';
import { routePath, areaOptions, routeFrame, physicsWorld } from './world/area.js';
import { createInput } from './input/index.js';
import { createCameraRig } from './camera/index.js';
import { createUI } from './ui/index.js';
import { createAudio } from './audio/index.js';
import { createVR } from './xr/vr.js';

// WebXR en PC: el contexto WebGL debe nacer «xrCompatible» para que Chrome lo cree en la misma GPU que el visor
// (la página de ejemplo de WebXR lo hace así); sin esto, requestSession puede fallar aunque el visor esté detectado.
{
  const gc = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') attrs = { ...(attrs || {}), xrCompatible: true };
    return gc.call(this, type, attrs);
  };
}
const E = window.RallyEngine;
const root = document.getElementById('ui'), view = document.getElementById('view');
const input = createInput({ target: view, storage: localStorage });
const ui = createUI({ root, engine: { MapView: E.MapView, SyntheticSource: E.SyntheticSource, TileSource: E.TileSource }, storage: localStorage, input });

const audio = createAudio();
let game = null, raf = 0, genAbort = null;
const stateObj = {}, controlsObj = {}, lookObj = {};
const nextTick = () => new Promise((r) => setTimeout(r, 0));

function stopGame() {
  cancelAnimationFrame(raf); raf = 0;
  if (game) { try { game.vr && game.vr.exit(); game.scene.renderer.setAnimationLoop(null); vrBtn.style.display = 'none'; } catch (e) { console.warn(e); } try { game.scene.dispose(); } catch (e) { console.warn(e); } game = null; view.innerHTML = ''; }
}

// Perfil liviano para la Quest (o ?lite en la URL): menos teselas de foto, área menor y calidad baja → carga mucho más rápida.
const LITE = /OculusBrowser|Quest/i.test(navigator.userAgent) || new URLSearchParams(location.search).has('lite');
async function startFlight(cfg) {
  if (LITE) cfg = { ...cfg, quality: 'bajo', extentKm: Math.min(cfg.extentKm || 4, 2.5), maxTiles: 40 };
  stopGame(); ui.showLoading('Preparando el vuelo…', 0);
  audio.setVolume(cfg.audio ? cfg.audio.volume : 0.7); audio.setMuted(cfg.audio ? cfg.audio.muted : false); audio.resume();
  try {
    const ro = areaOptions(cfg, E.SURF, { maxSide: LITE ? 9000 : 16000 });
    const source = cfg.source === 'demo' ? new E.SyntheticSource() : new E.TileSource();
    ui.setLoading(0.01, 'Preparando el área…');
    const ac = genAbort = new AbortController();
    const aoi = await E.buildAOI(source, routePath(cfg), { ...ro.aoi, signal: ac.signal, onProgress: (p, m) => ui.setLoading(p * 0.35, m) });
    await nextTick();
    const world = await E.buildWorld(aoi, ro.world, (p, m) => ui.setLoading(0.35 + p * 0.35, m));
    await nextTick();
    const qn = cfg.quality || 'medio';
    const base = E.QUALITY_PRESETS[qn] ? E.QUALITY_PRESETS[qn]() : E.QUALITY_PRESETS.medio();
    const vd = { bajo: 4500, medio: 7000, alto: 10000 }[qn] || 7000;
    const scene = new E.RallyScene(view, { quality: { ...base, viewDistance: vd } });
    scene.setTimeOfDay(cfg.timeOfDay || 'dia');
    scene.camera.near = 0.3; scene.camera.far = vd * 1.3; scene.camera.updateProjectionMatrix();
    await scene.loadWorld(world, (p, m) => ui.setLoading(0.7 + p * 0.2, m));
    const rf = routeFrame(aoi);
    const mid = [(rf.a[0] + rf.b[0]) / 2, (rf.a[1] + rf.b[1]) / 2];
    scene.prewarm(new Vector3(mid[0], world.height(mid[0], mid[1]) + 50, mid[1]));
    ui.setLoading(0.93, 'Cargando el A-10…');
    const model = await loadA10Model(GLTFLoader);
    scene.scene.add(model.group);
    const geom = loadA10Geometry(A10_GEOMETRY);
    geom.cgModel = [0.32, (geom.cgModel && geom.cgModel[1]) || 0, 0];   // CG algo adelante del eje principal (≈14 % de carga en la proa)
    const sim = new A10Sim({ geometry: geom, seed: 1 });
    model.setEye(sim.geom.eyeModel);
    const pw = physicsWorld(world);
    sim.setWorld(pw);
    const env = cfg.environment || {}; sim.setEnvironment(env);
    const mission = cfg.mission || {};
    const weapons = new WeaponSystem({ geometry: sim.geom, mavericks: (mission.loadout && mission.loadout.mavericks) ?? 4 });
    const combat = createCombatView(scene.scene, { maverickTemplate: model.maverickTemplate });
    const rig = createCameraRig({ camera: scene.camera, world: pw, aircraft: { group: model.group, eyeLocal: model.eyeLocal } });
    rig.setMode(cfg.camera || 'pilot');
    const vr = createVR({ renderer: scene.renderer, scene: scene.scene, camera: scene.camera, input, hudOptions: { scale: 1, color: (cfg.hud && cfg.hud.color) || 'verde' } });
    vr.onAction = (n) => weaponAction(n);
    game = { vr, cfg, world, pw, aoi, scene, model, sim, rig, rf, weapons, combat, convoy: null, paused: false, last: performance.now(), t: 0, focus: new Vector3(), crashT: 0 };
    resetFlight();
    ui.hud.setMode(rig.mode);
    window.__a10 = window.__harrier = game;
    ui.hideLoading();
    game.last = performance.now(); scene.renderer.setAnimationLoop(loop);
    showVrButton();
    if (cfg.vr) vrGate();
  } catch (e) {
    console.error(e); ui.toast('Error al generar el mundo: ' + (e && e.message || e), 8000); ui.showMainMenu();
  }
}

function resetFlight() {
  const g = game, { cfg, rf, sim, rig, world, weapons } = g;
  const mission = cfg.mission || {};
  // convoy: recorre la ruta A→B
  if (g.convoy) for (const v of g.convoy.vehicles) { /* las mallas viejas se quitan al recrear la vista */ }
  g.combat.dispose(); g.combat = createCombatView(g.scene.scene, { maverickTemplate: g.model.maverickTemplate });
  g.convoy = createConvoy({ route: rf.points.length >= 2 ? rf.points : [rf.a, rf.b], count: mission.convoySize ?? 8, mix: mission.mix || 'mixto', seed: (Date.now() & 0xffff), world: g.pw, speed: 10 });
  weapons.reset({ mavericks: (mission.loadout && mission.loadout.mavericks) ?? 4 });
  g.model.setPylons(weapons.pylons);
  sim.setStores(weapons.stores());
  // posición inicial: a distancia del convoy, de frente a él, dentro del área
  const head = g.convoy.vehicles[0].pos;
  const b = world.bounds, dist = (mission.startDistanceKm ?? 7) * 1000;
  const side = rf.uz * 1 - 0, perp = [-rf.uz, rf.ux];
  let dx = -rf.ux * 0.6 + perp[0] * 0.8, dz = -rf.uz * 0.6 + perp[1] * 0.8; const dl = Math.hypot(dx, dz); dx /= dl; dz /= dl;
  let x = head[0] + dx * dist, z = head[2] + dz * dist;
  const m = 400; x = Math.min(b.xMax - m, Math.max(b.xMin + m, x)); z = Math.min(b.zMax - m, Math.max(b.zMin + m, z));
  const hdg = (Math.atan2(head[0] - x, -(head[2] - z)) * 180 / Math.PI + 360) % 360;
  const y = world.height(x, z) + (mission.startAltFt ?? 3000) * 0.3048;
  sim.reset({ x, z, y, headingDeg: hdg, state: 'cruise', speedKt: mission.startSpeedKt ?? 300, fuelKg: cfg.fuelKg ?? 3000, gearDown: false, flaps: 0 });
  sim.setStores(weapons.stores());
  const tr = sim.getState().trim || {};
  input.reset({ throttle: tr.throttle ?? 0.78, gearDown: false, flaps: 0, assist: cfg.assist });
  ui.hud.reset(cfg.fuelKg ?? 3000);
  g.t = 0; g.crashT = 0; g.done = false; rig.snap && rig.snap();
  audio.reset && audio.reset();
}

function weaponAction(n) {
  const g = game; if (!g) return;
  const s = g.sim.getState(stateObj);
  if (n === 'lockTarget') { const v = g.weapons.lock(s, g.convoy.vehicles); audio.event(v ? 'lock' : 'nolock'); if (!v) ui.toast('Sin blanco en el cono de la mira', 1500); }
  else if (n === 'unlockTarget') g.weapons.unlock();
  else if (n === 'fireMissile') {
    if (g.weapons.fireMissile(s)) audio.event('missile');
    else { audio.event('nolock'); ui.toast(g.weapons.missilesLeft() ? 'Bloqueá un blanco primero (L)' : 'Sin Mavericks', 1500); }
  }
}

const extra = { gun: {}, missiles: {}, ccip: null, targets: [], range: null, message: null };
const ccipTmp = [0, 0, 0], scrTmp = {};
function buildExtra(g, s, cam) {
  const w = g.weapons, ws = w.getState();
  extra.gun.ammo = ws.ammo; extra.gun.firing = ws.firing; extra.gun.spin = ws.spin;
  extra.missiles.left = ws.missilesLeft; extra.missiles.locked = ws.locked; extra.missiles.lockProgress = ws.lockProgress;
  const c = w.ccipGun(s, g.pw, ccipTmp);
  extra.ccip = c ? toScreen(cam, c, { }) : null;
  if (extra.ccip) extra.ccip.dist = Math.hypot(c[0] - s.pos[0], c[1] - s.pos[1], c[2] - s.pos[2]);
  extra.targets.length = 0;
  for (const v of g.convoy.vehicles) {
    if (v.state === 'destroyed') continue;
    const p = toScreen(cam, [v.pos[0], v.pos[1] + 1.2, v.pos[2]], {});
    if (!p || Math.abs(p.x) > 1.2 || Math.abs(p.y) > 1.2) continue;
    const dist = Math.hypot(v.pos[0] - s.pos[0], v.pos[1] - s.pos[1], v.pos[2] - s.pos[2]);
    if (dist > 12000) continue;
    extra.targets.push({ x: p.x, y: p.y, dist, type: v.type, locked: ws.lockTarget === v, alive: v.state !== 'burning' });
  }
  extra.range = ws.lockTarget ? Math.hypot(ws.lockTarget.pos[0] - s.pos[0], ws.lockTarget.pos[1] - s.pos[1], ws.lockTarget.pos[2] - s.pos[2]) : null;
  const b = g.world.bounds, p = s.pos;
  const out = p[0] < b.xMin + 300 || p[0] > b.xMax - 300 || p[2] < b.zMin + 300 || p[2] > b.zMax - 300;
  const alive = g.convoy.alive().length;
  extra.message = out ? 'SALIENDO DEL ÁREA — VIRÁ' : alive === 0 ? 'CONVOY DESTRUIDO' : null;
  return extra;
}

function handleEvents(g, s, camPos) {
  for (const e of g.weapons.drainEvents()) {
    const d = e.pos ? Math.hypot(e.pos[0] - camPos[0], e.pos[1] - camPos[1], e.pos[2] - camPos[2]) : 0;
    if (e.type === 'impact') g.combat.impact(e.pos, false);
    else if (e.type === 'hit') { g.combat.impact(e.pos, true); if (Math.random() < 0.3) audio.event('hit', d); }
    else if (e.type === 'explosion') { g.combat.explosion(e.pos, 1.2); audio.event('explosion', d); }
  }
  for (const e of g.convoy.drainEvents()) {
    if (e.type === 'kill') {
      const d = Math.hypot(e.pos[0] - camPos[0], e.pos[1] - camPos[1], e.pos[2] - camPos[2]);
      g.combat.explosion(e.pos, e.vehicle.type === 'tank' ? 1.5 : 1); audio.event('explosion', d);
      const left = g.convoy.alive().length;
      ui.toast(left ? `${e.vehicle.type === 'tank' ? 'Tanque' : e.vehicle.type === 'apc' ? 'Blindado' : 'Camión'} destruido — quedan ${left}` : '¡Convoy destruido! (R para otra misión)', 2500);
    } else if (e.type === 'alert') ui.toast('El convoy se detiene y se dispersa', 2000);
  }
}

function loop(now) {
  if (!game) return;
  const g = game; let dt = Math.min(0.1, Math.max(0, (now - g.last) / 1000)); g.last = now;
  if (!g.paused) {
    input.update(dt);
    const c = input.getControls(controlsObj);
    if (g.vr.presenting && g.vr.gun) c.triggerGun = true;
    if (c.airbrake !== undefined && c.speedbrake === undefined) c.speedbrake = c.airbrake ? 1 : 0;
    c.gearDown = !!c.gearDown;
    g.sim.step(dt, c);
    const s = g.sim.getState(stateObj);
    g.weapons.step(dt, s, c, g.pw, g.convoy, g.sim);
    g.convoy.step(dt);
    g.model.update(s, s.cgModel || g.sim.cg);
    const cam = g.scene.camera, inVR = g.vr.presenting;
    let camPos, mode = g.rig.mode;
    if (inVR) {
      g.model.setFirstPerson(true);
      g.vr.update(dt, s, c, g.model);
      g.vrAcc = (g.vrAcc || 0) + dt; g.vrN = (g.vrN || 0) + 1;
      g.vr.headWorld(g.focus);
      if (!g.vr.lite || g.vrN % 3 === 0) {
        const real = g.scene.camera; g.scene.camera = g.vr.lodCamera(real.far);
        g.scene.update(g.vrAcc, g.focus); g.scene.camera = real; g.vrAcc = 0;
      }
      camPos = [g.focus.x, g.focus.y, g.focus.z]; mode = 'pilot';
      // HUD de VR: proyección con la cámara auxiliar (mirada del casco)
      g.vr.extra = buildExtra(g, s, g.vr.lodCamera(cam.far));
    } else {
      g.model.setFirstPerson(g.rig.mode === 'pilot');
      g.rig.update(dt, s, input.getLook(lookObj));
      cam.updateMatrixWorld(true);
      g.scene.update(dt, cam.position);
      const ex = buildExtra(g, s, cam);
      if (g.rig.mode !== 'pilot') ex.ccip = null;
      ui.hud.update(s, c, dt, ex);
      camPos = [cam.position.x, cam.position.y, cam.position.z];
    }
    g.combat.syncVehicles(g.convoy);
    g.combat.update(dt, g.weapons, g.convoy);
    handleEvents(g, s, camPos);
    audio.update(s, c, dt, { mode, camPos });
    audio.gun(g.weapons.spin, g.weapons.firing, { mode });
    if (s.flags && s.flags.crashed) {
      if (!g.crashT) { g.combat.explosion(s.pos, 2.5); audio.event('explosion', 0); ui.toast('Impacto contra el terreno — reiniciando…', 3000); }
      g.crashT += dt; if (g.crashT > 3.5) resetFlight();
    }
    g.t += dt; g.frames = (g.frames || 0) + 1;
  }
  g.scene.render();
}

const vrBtn = document.createElement('button');
vrBtn.textContent = 'Entrar en VR';
vrBtn.style.cssText = 'display:none;position:fixed;right:14px;top:14px;z-index:50;padding:7px 12px;font:600 13px system-ui,sans-serif;color:#d6ffe6;background:#0e2a1d;border:1px solid #39d98a;border-radius:8px;cursor:pointer;pointer-events:auto';
// El botón se muestra siempre que el navegador tenga WebXR; si el visor no está listo lo avisa en el texto y vuelve a comprobar.
let xrWatching = false;
function showVrButton() {
  if (!navigator.xr) return;
  vrBtn.style.display = 'block';
  const upd = () => { if (!game || !game.vr) return; game.vr.checkSupport().then((ok) => { vrBtn.textContent = ok ? 'Entrar en VR' : 'Entrar en VR (visor no detectado)'; vrBtn.style.opacity = ok ? '1' : '0.75'; }); };
  upd();
  if (!xrWatching) { xrWatching = true; try { navigator.xr.addEventListener('devicechange', upd); } catch {} setInterval(upd, 4000); }
}
// Pantalla «Mundo listo»: el navegador exige un clic para abrir la sesión VR, así que se pide recién cuando el mundo terminó de cargar.
function vrGate() {
  if (!game) return;
  game.paused = true;
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:60;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:rgba(4,14,10,.82);color:#d6ffe6;font:16px system-ui,sans-serif;text-align:center;padding:24px';
  const t = document.createElement('div'); t.style.cssText = 'font-size:22px;font-weight:700'; t.textContent = 'Mundo listo';
  const m = document.createElement('div'); m.style.cssText = 'max-width:520px;opacity:.85'; m.textContent = 'Conectá el visor, tocá el botón y recién entonces ponételo.';
  const b = document.createElement('button'); b.textContent = 'Entrar en VR ahora';
  b.style.cssText = 'padding:16px 34px;font:700 18px system-ui,sans-serif;color:#d6ffe6;background:#0e2a1d;border:2px solid #39d98a;border-radius:10px;cursor:pointer';
  const s = document.createElement('button'); s.textContent = 'Volar sin VR';
  s.style.cssText = 'padding:8px 16px;font:14px system-ui,sans-serif;color:#9fd9b8;background:transparent;border:1px solid #2c6b4c;border-radius:8px;cursor:pointer';
  const err = document.createElement('div'); err.style.cssText = 'max-width:560px;color:#ffb4a8;min-height:1.2em';
  const close = () => { ov.remove(); if (game) { game.paused = false; game.last = performance.now(); } };
  b.onclick = async () => { err.textContent = ''; try { if (game && !game.vr.presenting) { await game.vr.enter(game); } close(); } catch (e) { console.error(e); err.textContent = 'No se pudo iniciar la VR: ' + (e && e.message || e); } };
  s.onclick = close;
  ov.append(t, m, b, err, s); document.body.appendChild(ov);
}
vrBtn.onclick = async () => { try { if (game && !game.vr.presenting) { game.paused = false; await game.vr.enter(game); } } catch (e) { console.error(e); ui.toast('No se pudo iniciar la VR: ' + (e && e.message || e), 6000); } };
document.body.appendChild(vrBtn);
ui.onStart((cfg) => startFlight(cfg));
ui.on('restart', () => { if (game) { resetFlight(); audio.resume(); game.paused = false; ui.hideAll(); } });
ui.on('resume', () => { if (game) { game.paused = false; game.last = performance.now(); audio.resume(); } });
ui.on('menu', () => { stopGame(); audio.stop(); ui.showMainMenu(); });
ui.on('settings', (st) => { if (st && st.audio) { audio.setVolume(st.audio.volume); audio.setMuted(st.audio.muted); } });
addEventListener('keydown', (ev) => { if (ev.code === 'KeyN' && !ev.repeat && game && !/INPUT|TEXTAREA/.test((ev.target || {}).tagName || '')) { const m = audio.toggleMute(); ui.toast(m ? 'Sonido silenciado' : 'Sonido activado', 1200); } });
ui.on('quality', () => {});
input.on('action', (n) => {
  if (!game) return;
  if (n === 'pause') { game.paused = true; audio.stop(); ui.showPause(); }
  else if (n === 'reset') { resetFlight(); audio.reset(); }
  else if (n === 'cameraNext') { game.rig.next(); ui.hud.setMode(game.rig.mode); }
  else if (n === 'worldRelocate') game.rig.relocate();
  else if (n === 'toggleHud') ui.hud.toggle();
  else if (n === 'fireMissile' || n === 'lockTarget' || n === 'unlockTarget') weaponAction(n);
});
ui.showMainMenu();
window.__a10Dev = window.__harrierDev = { audio, start: (c) => { ui.hideAll(); return startFlight(c); }, ui, input, getConfig: () => ui.getConfig && ui.getConfig() };
