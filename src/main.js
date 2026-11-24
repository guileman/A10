// Simulador del A-10C — orquestación: mundo real (motor del rally) + física + modelo + armas + convoy + cámaras + UI.
import { Vector3, GLTFLoader } from 'three';
import { A10Sim, loadA10Geometry } from './physics/index.js';
import A10_GEOMETRY from './physics/a10.geometry.json';
import { createConvoy } from './game/targets.js';
import { WeaponSystem } from './game/weapons.js';
import { createCombatView, toScreen } from './game/render.js';
import { createRecorder, createMoments, groundCameraPos, frameShot } from './game/replay.js';
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
    game = { vr, cfg, world, pw, aoi, scene, model, sim, rig, rf, weapons, combat, convoy: null, paused: false, last: performance.now(), t: 0, focus: new Vector3(), crashT: 0, rec: createRecorder({ seconds: 14 }), moments: createMoments(), burst: { pts: [], hits: 0, lastT: -1 }, replay: null };
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
  if (g.replay) endReplay(g);
  g.rec.clear(); g.moments.clear(); g.burst = { pts: [], hits: 0, lastT: -1 }; hideReplayBadge();
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

const impactList = [], frameFx = [];
function handleEvents(g, s, camPos, mode) {
  const tK = s.air && s.air.tempK;
  impactList.length = 0; frameFx.length = 0;
  for (const e of g.weapons.drainEvents()) {
    const d = e.pos ? Math.hypot(e.pos[0] - camPos[0], e.pos[1] - camPos[1], e.pos[2] - camPos[2]) : 0;
    if (e.type === 'impact' || e.type === 'hit') {
      const hit = e.type === 'hit';
      g.combat.impact(e.pos, hit); impactList.push({ pos: e.pos, hit }); frameFx.push(e);
      g.burst.pts.push(e.pos); if (hit) g.burst.hits++; g.burst.lastT = g.t;
    } else if (e.type === 'explosion') { g.combat.explosion(e.pos, 1.2); audio.event('explosion', d, tK); frameFx.push(e); offerReplay(g.moments.add('explosion', g.t, e.pos)); }
  }
  // fin de una ráfaga con impactos (1 s sin impactos nuevos) => momento repetible en el centro de los impactos
  const B = g.burst;
  if (B.pts.length && g.t - B.lastT > 1.0) {
    const c = [0, 0, 0]; for (const p of B.pts) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
    c[0] /= B.pts.length; c[1] /= B.pts.length; c[2] /= B.pts.length;
    if (B.pts.length >= 5) offerReplay(g.moments.add('burst', B.lastT, c));
    g.burst = { pts: [], hits: 0, lastT: -1 };
  }
  // cada impacto de 30 mm HEI suena cuando su onda llega al oyente (distancia / c)
  if (impactList.length) audio.impacts(impactList, camPos, tK, mode);
  for (const e of g.convoy.drainEvents()) {
    if (e.type === 'kill') {
      const d = Math.hypot(e.pos[0] - camPos[0], e.pos[1] - camPos[1], e.pos[2] - camPos[2]);
      g.combat.explosion(e.pos, e.vehicle.type === 'tank' ? 1.5 : 1); audio.event('explosion', d, s.air && s.air.tempK);
      frameFx.push({ type: 'kill', pos: e.pos, size: e.vehicle.type === 'tank' ? 1.5 : 1 });
      offerReplay(g.moments.add('kill', g.t, e.pos));
      const left = g.convoy.alive().length;
      ui.toast(left ? `${e.vehicle.type === 'tank' ? 'Tanque' : e.vehicle.type === 'apc' ? 'Blindado' : 'Camión'} destruido — quedan ${left}` : '¡Convoy destruido! (R para otra misión)', 2500);
    } else if (e.type === 'alert') ui.toast('El convoy se detiene y se dispersa', 2000);
  }
}

const muzzleW = [0, 0, 0], gunDir = [0, 0, 0];
function bodyX(q, o) { const [x, y, z, w] = q; o[0] = 1 - 2 * (y * y + z * z); o[1] = 2 * (x * y + w * z); o[2] = 2 * (x * z - w * y); return o; }

/**
 * Vibración del GAU-8: temblor de alta frecuencia (aleatorio cada cuadro) + bamboleo de ~11 Hz, sobre la cámara
 * ya colocada por el rig. En cabina es fuerte (todo tiembla: tablero, capota, HUD); en persecución, menor; en la
 * cámara de mundo solo si está cerca. En VR no se mueve la cámara (mareo): se usa la vibración de los mandos.
 */
let hudEl = null;
function applyGunShake(g, cam, mode, s) {
  const w = g.weapons, target = w.firing ? 1 : w.spin > 0.05 ? 0.12 * w.spin : 0;
  const dt = Math.min(0.1, g.lastDt || 0.016);
  g.shake = (g.shake || 0) + (target - (g.shake || 0)) * (1 - Math.exp(-dt / (target > (g.shake || 0) ? 0.03 : 0.16)));
  const k = g.shake;
  if (!hudEl) hudEl = document.querySelector('.hz-hud');
  if (k < 0.002) { if (hudEl && hudEl.style.transform) hudEl.style.transform = ''; return; }
  let pos = 0, ang = 0;
  if (mode === 'pilot') { pos = 0.007; ang = 0.0075; }            // ≈ 0,43° de temblor angular a pleno
  else if (mode === 'chase') { pos = 0.05; ang = 0.0025; }
  else { const d = cam.position.distanceTo(new Vector3(s.pos[0], s.pos[1], s.pos[2])); const f = Math.max(0, 1 - d / 400); pos = 0.04 * f; ang = 0.003 * f; }
  const r = () => Math.random() * 2 - 1, wob = Math.sin(g.t * 2 * Math.PI * 11) * 0.5;
  cam.position.x += r() * pos * k; cam.position.y += r() * pos * k; cam.position.z += r() * pos * k;
  cam.rotateX((r() + wob) * ang * k); cam.rotateY(r() * ang * 0.7 * k); cam.rotateZ(r() * ang * 0.5 * k);
  if (hudEl) hudEl.style.transform = mode === 'pilot' ? `translate(${(r() * 2.2 * k).toFixed(2)}px, ${(r() * 2.8 * k).toFixed(2)}px)` : '';
}

/** Chasquido supersónico: un proyectil (≈1 000 m/s, Mach 3) que pasa a menos de 35 m del oyente. */
function supersonicCracks(g, camPos) {
  let n = 0;
  for (const r of g.weapons.rounds) {
    if (r.cracked) continue;
    const d = Math.hypot(r.pos[0] - camPos[0], r.pos[1] - camPos[1], r.pos[2] - camPos[2]);
    if (d < 35) { r.cracked = true; if (n++ < 4) audio.crack(d); }
  }
}

// ======================= Repetición desde una cámara en el suelo =======================
const replayBadge = document.createElement('div');
replayBadge.style.cssText = 'display:none;position:fixed;left:50%;top:150px;transform:translateX(-50%);z-index:40;padding:6px 14px;font:700 15px ui-monospace,monospace;letter-spacing:.08em;color:#ffcf4a;background:rgba(0,0,0,.45);border:1px solid #ffcf4a;border-radius:6px;pointer-events:none';
document.body.appendChild(replayBadge);
const replayOverlay = document.createElement('div');
replayOverlay.style.cssText = 'display:none;position:fixed;inset:0;z-index:39;pointer-events:none;font:700 16px ui-monospace,monospace;color:#fff;text-shadow:0 1px 3px #000';
replayOverlay.innerHTML = '<div style="position:absolute;left:22px;top:18px"><span style="color:#ff4040">●</span> REPETICIÓN · CÁMARA DE SUELO <span data-k="t"></span></div><div style="position:absolute;left:22px;bottom:18px;font-weight:500;font-size:13px;opacity:.85">X o Esc = volver al vuelo</div><div style="position:absolute;inset:0;border:3px solid rgba(255,64,64,.5)"></div>';
document.body.appendChild(replayOverlay);
let badgeTimer = 0;
const KIND_TXT = { kill: 'BLANCO DESTRUIDO', explosion: 'IMPACTO DE MAVERICK', burst: 'RÁFAGA' };
function offerReplay(m) {
  if (!m || !game || (game.vr && game.vr.presenting)) return;
  replayBadge.textContent = `▶ ${KIND_TXT[m.kind] || 'IMPACTO'} — X = VER REPETICIÓN`;
  replayBadge.style.display = 'block';
  clearTimeout(badgeTimer); badgeTimer = setTimeout(hideReplayBadge, 10000);
}
function hideReplayBadge() { replayBadge.style.display = 'none'; }

function startReplay(g) {
  if (g.vr && g.vr.presenting) { ui.toast('La repetición no está disponible en VR', 2000); return; }
  const m = g.moments.last(), rec = g.rec;
  if (!m || rec.frames.length < 10 || m.t < rec.start) { ui.toast('Todavía no hay ningún impacto para repetir', 2000); return; }
  const t0 = Math.max(rec.start, m.t - 6.5), t1 = Math.min(rec.end, m.t + 4.5);
  const f0 = rec.frames[rec.indexAt(t0)];
  const C = groundCameraPos(m.pos, f0.ac.pos, (x, z) => g.pw.height(x, z), { bounds: g.world.bounds });
  const cam = g.scene.camera;
  g.replay = {
    t0, t1, t: t0, idx: rec.indexAt(t0) - 1, m, C, hold: 0, dir: null, fov: null,
    saved: {
      veh: g.convoy.vehicles.map((v) => ({ pos: v.pos.slice(), heading: v.heading, state: v.state, burnT: v.burnT })),
      pyl: g.weapons.pylons.map((p) => p.loaded), fov: cam.fov, hud: ui.hud.visible,
    },
    proxy: { rounds: [], missiles: [], pool: [], mprox: new Map() },
  };
  hideReplayBadge();
  g.combat.clearFx();
  ui.hud.setVisible(false);
  g.model.setFirstPerson(false);
  audio.gun(0, false, { mode: 'world' });
  replayOverlay.style.display = 'block'; vrBtn.style.visibility = 'hidden';
}

function endReplay(g) {
  const R = g.replay; if (!R) return;
  g.convoy.vehicles.forEach((v, i) => { const s0 = R.saved.veh[i]; if (!s0) return; v.pos[0] = s0.pos[0]; v.pos[1] = s0.pos[1]; v.pos[2] = s0.pos[2]; v.heading = s0.heading; v.state = s0.state; v.burnT = s0.burnT; });
  g.weapons.pylons.forEach((p, i) => { p.loaded = R.saved.pyl[i]; });
  g.combat.clearFx(); g.combat.syncVehicles(g.convoy);
  const cam = g.scene.camera; cam.fov = R.saved.fov; cam.updateProjectionMatrix();
  ui.hud.setVisible(R.saved.hud);
  audio.gun(0, false, { mode: g.rig.mode });
  replayOverlay.style.display = 'none'; vrBtn.style.visibility = '';
  g.replay = null; g.last = performance.now();
}

const _look = new Vector3(), shot = { dir: [0, 0, -1], fovDeg: 40 }, rMuzzle = [0, 0, 0], rDir = [0, 0, 0];
function replayStep(g, dt) {
  const R = g.replay, rec = g.rec, F = rec.frames;
  R.t = Math.min(R.t + dt, R.t1);
  const idx = rec.indexAt(R.t), C = R.C, tK = F[idx].ac.air.tempK;
  // efectos de los cuadros que se atravesaron (impactos, explosiones), con su sonido desde la cámara de suelo
  impactList.length = 0;
  for (let i = Math.max(0, R.idx + 1); i <= idx; i++) {
    const fx = F[i].fx; if (!fx) continue;
    for (const e of fx) {
      const d = Math.hypot(e.pos[0] - C[0], e.pos[1] - C[1], e.pos[2] - C[2]);
      if (e.type === 'impact' || e.type === 'hit') { g.combat.impact(e.pos, e.type === 'hit'); impactList.push({ pos: e.pos, hit: e.type === 'hit' }); }
      else if (e.type === 'explosion') { g.combat.explosion(e.pos, 1.2); audio.event('explosion', d, tK); }
      else if (e.type === 'kill') { g.combat.explosion(e.pos, e.size || 1); audio.event('explosion', d, tK); }
    }
  }
  if (impactList.length) audio.impacts(impactList, C, tK, 'world');
  R.idx = idx;
  const f = F[idx], ac = f.ac;
  // estado del mundo en ese instante
  g.model.update(ac, ac.cgModel);
  g.convoy.vehicles.forEach((v, i) => { const o = i * 5; if (o + 4 >= f.veh.length) return; v.pos[0] = f.veh[o]; v.pos[1] = f.veh[o + 1]; v.pos[2] = f.veh[o + 2]; v.heading = f.veh[o + 3]; v.burnT = f.veh[o + 4]; v.state = f.vstate[i]; });
  g.weapons.pylons.forEach((p, i) => { p.loaded = !!(f.pyl & (1 << i)); });
  const P = R.proxy, n = f.rounds.length / 6;
  P.rounds.length = 0;
  for (let i = 0; i < n; i++) {
    const r = P.pool[i] || (P.pool[i] = { pos: [0, 0, 0], vel: [0, 0, 0] }), o = i * 6;
    r.pos[0] = f.rounds[o]; r.pos[1] = f.rounds[o + 1]; r.pos[2] = f.rounds[o + 2]; r.vel[0] = f.rounds[o + 3]; r.vel[1] = f.rounds[o + 4]; r.vel[2] = f.rounds[o + 5];
    P.rounds.push(r);
  }
  P.missiles.length = 0;
  for (const m of f.missiles) {
    let q = P.mprox.get(m.ref); if (!q) { q = { alive: true }; P.mprox.set(m.ref, q); }
    q.pos = m.pos; q.dir = m.dir; q.motor = m.motor; P.missiles.push(q);
  }
  // cámara fija en el suelo, encuadrando avión y blanco (suavizado)
  const cam = g.scene.camera;
  frameShot(C, ac.pos, R.m.pos, shot);
  const k = R.dir ? 1 - Math.exp(-dt / 0.22) : 1;
  if (!R.dir) { R.dir = shot.dir.slice(); R.fov = shot.fovDeg; }
  for (let i = 0; i < 3; i++) R.dir[i] += (shot.dir[i] - R.dir[i]) * k;
  R.fov += (shot.fovDeg - R.fov) * k;
  cam.position.set(C[0], C[1], C[2]); cam.up.set(0, 1, 0);
  cam.lookAt(_look.set(C[0] + R.dir[0], C[1] + R.dir[1], C[2] + R.dir[2]));
  cam.fov = R.fov; cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
  g.scene.update(dt, cam.position);
  // combate, humo del cañón y sonido (con el retardo de la distancia a la cámara)
  g.combat.syncVehicles(g.convoy);
  const muzzle = g.weapons._worldPoint(ac, g.weapons.muzzle, rMuzzle); bodyX(ac.quat, rDir);
  g.combat.gunFire(dt, f.firing, muzzle, rDir, ac.vel, 1);
  g.combat.update(dt, P, g.convoy);
  audio.update(ac, controlsObj, dt, { mode: 'world', camPos: C });
  audio.gun(f.spin, f.firing, { mode: 'world', camPos: C, srcPos: muzzle, tempK: tK });
  const el = replayOverlay.querySelector('[data-k="t"]'); if (el) el.textContent = (R.t - R.m.t >= 0 ? '+' : '−') + Math.abs(R.t - R.m.t).toFixed(1) + ' s';
  if (R.t >= R.t1) { R.hold += dt; if (R.hold > 2.0) endReplay(g); }
}

function loop(now) {
  if (!game) return;
  const g = game; let dt = Math.min(0.1, Math.max(0, (now - g.last) / 1000)); g.last = now; g.lastDt = dt;
  if (g.replay) replayStep(g, dt);
  else if (!g.paused) {
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
      applyGunShake(g, cam, mode, s);
      cam.updateMatrixWorld(true);
      g.scene.update(dt, cam.position);
      const ex = buildExtra(g, s, cam);
      if (g.rig.mode !== 'pilot') ex.ccip = null;
      ui.hud.update(s, c, dt, ex);
      camPos = [cam.position.x, cam.position.y, cam.position.z];
    }
    g.combat.syncVehicles(g.convoy);
    const muzzle = g.weapons._worldPoint(s, g.weapons.muzzle, muzzleW);
    bodyX(s.quat, gunDir);
    g.combat.gunFire(dt, g.weapons.firing, muzzle, gunDir, s.vel, inVR ? 0.5 : 1);
    g.combat.update(dt, g.weapons, g.convoy);
    handleEvents(g, s, camPos, mode);
    if (mode !== 'pilot') supersonicCracks(g, camPos);
    g.rec.push(g.t, s, s.cgModel || g.sim.cg, g.weapons, g.convoy, frameFx);
    audio.update(s, c, dt, { mode, camPos });
    audio.gun(g.weapons.spin, g.weapons.firing, { mode, camPos, srcPos: muzzle, tempK: s.air && s.air.tempK });
    if (inVR && g.vr.rumble) { if (g.weapons.firing) g.vr.rumble(1, 60); else if (g.weapons.spin > 0.05) g.vr.rumble(0.15 * g.weapons.spin, 40); }
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
  if (game.replay) { if (n === 'pause' || n === 'replay') endReplay(game); return; }
  if (n === 'replay') startReplay(game);
  else if (n === 'pause') { game.paused = true; audio.stop(); ui.showPause(); }
  else if (n === 'reset') { resetFlight(); audio.reset(); }
  else if (n === 'cameraNext') { game.rig.next(); ui.hud.setMode(game.rig.mode); }
  else if (n === 'worldRelocate') game.rig.relocate();
  else if (n === 'toggleHud') ui.hud.toggle();
  else if (n === 'fireMissile' || n === 'lockTarget' || n === 'unlockTarget') weaponAction(n);
});
ui.showMainMenu();
window.__a10Dev = window.__harrierDev = { audio, start: (c) => { ui.hideAll(); return startFlight(c); }, ui, input, getConfig: () => ui.getConfig && ui.getConfig() };
