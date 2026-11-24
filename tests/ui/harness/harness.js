// Arnés visual (solo pruebas): monta UI + HUD + cámaras sobre una escena three mínima con un estado simulado.
import * as THREE from 'three';
import { createUI } from '../../../src/ui/index.js';
import { createInput } from '../../../src/input/index.js';
import { createCameraRig } from '../../../src/camera/index.js';
import { MockMapView } from './mockmap.js';

const q = new URLSearchParams(location.search);
const screen = q.get('screen') || 'hud';
const camMode = q.get('cam') || 'pilot';
const preset = q.get('preset') || 'transition';
const memory = new Map();
const storage = { getItem: (k) => (memory.has(k) ? memory.get(k) : null), setItem: (k, v) => memory.set(k, v) };

const root = document.getElementById('root');
const canvas3d = document.createElement('canvas');
canvas3d.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
root.appendChild(canvas3d);
const renderer = new THREE.WebGLRenderer({ canvas: canvas3d, antialias: true });
renderer.setSize(innerWidth, innerHeight, false);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x7fb4e6);
scene.fog = new THREE.Fog(0xa9cbe8, 600, 6000);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.5, 20000);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), new THREE.MeshBasicMaterial({ color: 0x5b7a45 }));
ground.rotation.x = -Math.PI / 2; scene.add(ground);
const grid = new THREE.GridHelper(40000, 400, 0x3d5530, 0x4a6638); scene.add(grid);
const rwy = new THREE.Mesh(new THREE.PlaneGeometry(45, 1500), new THREE.MeshBasicMaterial({ color: 0x33363a }));
rwy.rotation.x = -Math.PI / 2; rwy.rotation.z = -50 * Math.PI / 180; rwy.position.y = 0.05; scene.add(rwy);
for (let i = 0; i < 30; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(14, 8 + (i % 5) * 3, 14), new THREE.MeshBasicMaterial({ color: 0xb8b2a4 })); b.position.set(-900 + (i % 6) * 320, 4, -400 - Math.floor(i / 6) * 260); scene.add(b); }

const group = new THREE.Group();
const mat = new THREE.MeshBasicMaterial({ color: 0x8a949c });
const fus = new THREE.Mesh(new THREE.BoxGeometry(14, 1.6, 1.4), mat); group.add(fus);
const wing = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.2, 7.7), mat); wing.position.set(0.5, 0.2, 0); group.add(wing);
const tail = new THREE.Mesh(new THREE.BoxGeometry(2, 2.4, 0.2), mat); tail.position.set(-6, 1.4, 0); group.add(tail);
scene.add(group);
const aircraft = { group, eyeLocal: new THREE.Vector3(3.8, 1.0, 0) };

const world = { height: () => 0 };
const rig = createCameraRig({ camera, world, aircraft });
rig.setMode(camMode);

const input = createInput({ target: canvas3d, storage });
const ui = createUI({ root, engine: { MapView: MockMapView, SyntheticSource: class {} }, storage, input });
ui.hud.setMode(camMode);
ui.hud.reset(2000);
ui.hud.setEnvironment({ qnhHpa: 1013 });

function simState(t) {
  const P = {
    transition: { hdg: 50, pitch: 6, roll: -8, ias: 62, alt: 180, agl: 150, vs: 3.2, noz: 58, cmd: 40, gear: 'up', flaps: 1, thr: 0.8 },
    hover: { hdg: 50, pitch: 2, roll: 1.5, ias: 4, alt: 60, agl: 22, vs: -0.6, noz: 85, cmd: 85, gear: 'down', flaps: 2, thr: 0.92 },
    extreme: { hdg: 359.9, pitch: 88, roll: 175, ias: 640, alt: 45000, agl: 1e9, vs: -120, noz: 98.5, cmd: 0, gear: 'transit', flaps: 2, thr: 1 },
  }[preset];
  const d2r = Math.PI / 180;
  const e = new THREE.Euler(0, 0, 0, 'YXZ');
  // cuerpo x=proa: giro de rumbo sobre y (rumbo horario => -yaw), cabeceo sobre z, alabeo sobre x
  const qh = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -(P.hdg - 90 + 90) * d2r + Math.PI / 2 * 0);
  // el eje x del cuerpo debe apuntar al rumbo: forward = (sin h, 0, -cos h)
  const fwdAng = Math.atan2(-Math.cos(P.hdg * d2r), Math.sin(P.hdg * d2r)); // ángulo en plano xz desde +x hacia +z
  const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -fwdAng);
  const qp = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), P.pitch * d2r);
  const qr = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), P.roll * d2r);
  const quat = qy.multiply(qp).multiply(qr);
  void qh; void e;
  const sp = P.ias / 1.944, hx = Math.sin(P.hdg * d2r), hz = -Math.cos(P.hdg * d2r);
  const pos = [hx * 300 * (1 + 0 * t), P.alt * 0.3048 > 0 ? Math.min(P.agl, 5000) * 0.3048 + 0 : 0, hz * 300];
  if (preset !== 'extreme') pos[1] = P.alt * 0.3048 * 0 + P.agl * 0.3048;
  return {
    t, pos, quat: [quat.x, quat.y, quat.z, quat.w], vel: [hx * sp, P.vs * 0.3048 * 0 + P.vs, hz * sp], omega: [0, 0, 0],
    att: { headingDeg: P.hdg, pitchDeg: P.pitch, rollDeg: P.roll },
    air: { iasKt: P.ias, tasKt: P.ias * 1.02, machNo: P.ias / 661, aoaDeg: 9.4, betaDeg: -2.1, qbar: 1000, rho: 1.2, tempK: 288, altMslM: P.alt * 0.3048, altAglM: P.agl * 0.3048, vsMs: P.vs, gs: sp, nz: preset === 'extreme' ? 8.4 : 1.15, ny: 0, nx: 0, windBody: [-3.1, 0, 2.2] },
    engine: { rpmPct: 96.3, thrustN: 81500, fuelKg: 1650, fuelFlowKgS: 0.62, jptC: preset === 'extreme' ? 760 : 655, waterKg: 90, bleedPct: 20, stall: false },
    n1Pct: [88.5, 87.9], buffet: preset === 'extreme' ? 0.7 : 0,
    controlSurfaces: { stabilatorDeg: -3, aileronLDeg: 2, aileronRDeg: -2, rudderDeg: 0, flapsDeg: [0, 25, 50][P.flaps], airbrakeDeg: 0 },
    gear: { state: P.gear, extension: P.gear === 'down' ? 1 : P.gear === 'up' ? 0 : 0.5, units: [] },
    flags: { onGround: false, weightOnWheels: false, stalled: false, inGroundEffect: preset === 'hover', hotGasIngestion: false, crashed: false, overspeed: false, gLimit: false },
    warnings: preset === 'extreme' ? ['STALL', 'OVERTEMP', 'GEAR', 'BINGO'] : preset === 'hover' ? ['BINGO'] : [],
  };
}
const controls = { pitch: 0, roll: 0, yaw: 0, throttle: 0.8, flaps: 1, gearDown: false, brake: 0, parkingBrake: false, speedbrake: preset === 'hover' ? 1 : 0, airbrake: preset === 'hover', triggerGun: false, trim: { pitch: 0, roll: 0, yaw: 0 }, assist: { stabilityAug: 1 } };
if (preset === 'hover') { controls.flaps = 2; controls.gearDown = true; }
// extra de ataque de ejemplo (pipper CCIP sobre un blanco a 2,1 km)
const extra = { gun: { ammo: 1034, firing: false, spin: 1 }, missiles: { left: 3, locked: true, lockProgress: 1 }, ccip: { x: 0.08, y: -0.12 },
  targets: [{ x: 0.08, y: -0.12, dist: 2100, type: 'T-72', locked: true, alive: true }, { x: -0.35, y: -0.08, dist: 3300, type: 'BTR', locked: false, alive: true }], range: 2100, message: '' };

if (screen === 'hud') {
  ui.hideAll();
  const s = simState(0);
  group.position.set(...s.pos); group.quaternion.set(...s.quat);
  let n = 0;
  const frame = () => {
    s.t = n * 0.016;
    if (preset !== 'extreme') { s.pos[0] += s.vel[0] * 0.016; s.pos[2] += s.vel[2] * 0.016; group.position.set(...s.pos); }
    rig.update(0.016, s, { yaw: 0, pitch: 0, zoom: 0, active: false });
    renderer.render(scene, camera);
    ui.hud.update(s, controls, 0.016, extra);
    if (++n < 140) requestAnimationFrame(frame); else window.__ready = true;
  };
  frame();
} else if (screen === 'loading') {
  ui.showLoading('Generando terreno y pista… (2 de 4)', 0.55); window.__ready = true;
} else {
  scene.background = new THREE.Color(0x0a0f0c);
  renderer.render(scene, camera);
  if (screen === 'pause') ui.showPause(); else if (screen === 'main') ui.showMainMenu(); else { ui.showMainMenu(); ui.showScreen(screen); }
  setTimeout(() => { window.__ready = true; }, 300);
}
window.__ui = ui; window.__rig = rig;
