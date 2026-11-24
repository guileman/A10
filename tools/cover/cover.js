// Portada del juego: el A-10 (modelo del simulador) sobre un desierto montañoso con explosiones. Render con three.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { loadA10Model } from '../../src/aircraft/a10model.js';
import { WeaponSystem } from '../../src/game/weapons.js';
import { loadA10Geometry } from '../../src/physics/index.js';
import GEOM from '../../src/physics/a10.geometry.json';

const P = new URLSearchParams(location.search);
const W = +(P.get('w') || 1600), H = +(P.get('h') || 900);

// ---- ruido de gradiente 2D + fBm ----
const perm = new Uint8Array(512); { let s = 1337; const p = [...Array(256).keys()]; for (let i = 255; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) perm[i] = p[i & 255]; }
const grad = (h, x, y) => { const a = (h & 7) * Math.PI / 4; return Math.cos(a) * x + Math.sin(a) * y; };
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
function noise(x, y) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255; x -= Math.floor(x); y -= Math.floor(y);
  const u = fade(x), v = fade(y), a = perm[X] + Y, b = perm[X + 1] + Y;
  const l = (t, p, q) => p + t * (q - p);
  return l(v, l(u, grad(perm[a], x, y), grad(perm[b], x - 1, y)), l(u, grad(perm[a + 1], x, y - 1), grad(perm[b + 1], x - 1, y - 1)));
}
const fbm = (x, y, o = 6) => { let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { s += a * noise(x * f, y * f); f *= 2.03; a *= 0.5; } return s; };
const ridged = (x, y, o = 6) => { let s = 0, a = 0.55, f = 1; for (let i = 0; i < o; i++) { const n = 1 - Math.abs(noise(x * f, y * f)); s += a * n * n; f *= 2.1; a *= 0.5; } return s; };

// valle: suelo plano alrededor de los blancos; montañas crecen con la distancia a la cámara
const TGT = new THREE.Vector3(170, 0, -950);
function height(x, z) {
  const d = Math.hypot(x - 0, z - 400);
  const dv = Math.hypot(x - TGT.x, (z - TGT.z) * 0.6);
  const mountMask = THREE.MathUtils.smoothstep(d, 1300, 4200) * (1 - 0.85 * Math.exp(-dv * dv / (900 * 900)));
  const mounts = ridged(x / 2600, z / 2600) * 1250 * mountMask;
  const hills = fbm(x / 900 + 7, z / 900 - 3, 5) * 90 * THREE.MathUtils.smoothstep(d, 300, 2500);
  const dunes = (Math.sin(x / 38 + fbm(x / 400, z / 400) * 6) * 0.5 + 0.5) * 3 + fbm(x / 120, z / 120, 3) * 6;
  return mounts + hills + dunes;
}

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H); renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = +(P.get('exp') || 0.82);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
{ const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.55; }
const HORIZ = new THREE.Color(0.96, 0.78, 0.58), ZEN = new THREE.Color(0.10, 0.30, 0.66);
scene.fog = new THREE.FogExp2(new THREE.Color(0.86, 0.68, 0.50), +(P.get('fog') || 0.00006));
const camera = new THREE.PerspectiveCamera(38, W / H, 0.5, 40000);

// cielo
const sunDir = new THREE.Vector3(+(P.get('sx') || 0.85), +(P.get('sy') || 0.38), +(P.get('sz') || 0.35)).normalize();
scene.add(new THREE.Mesh(new THREE.SphereGeometry(30000, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { hz: { value: HORIZ }, zn: { value: ZEN }, sd: { value: sunDir } },
  vertexShader: 'varying vec3 vd; void main(){ vd = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: `uniform vec3 hz, zn, sd; varying vec3 vd;
    void main(){ float h = clamp(vd.y, -0.1, 1.); vec3 c = mix(hz, zn, pow(max(h,0.), 0.32));
      float s = max(dot(vd, sd), 0.); c += vec3(1.,.75,.45) * (pow(s, 8.) * .55 + pow(s, 600.) * 6.);
      gl_FragColor = vec4(c, 1.); }`,
})));

// terreno
const N = 420, S = 16000;
const tg = new THREE.PlaneGeometry(S, S, N, N); tg.rotateX(-Math.PI / 2); tg.translate(0, 0, -5000);
const pos = tg.attributes.position, col = new Float32Array(pos.count * 3);
for (let i = 0; i < pos.count; i++) pos.setY(i, height(pos.getX(i), pos.getZ(i)));
tg.computeVertexNormals();
const nrm = tg.attributes.normal;
const sand = new THREE.Color(0.78, 0.58, 0.36), ochre = new THREE.Color(0.62, 0.38, 0.21), rock = new THREE.Color(0.36, 0.25, 0.18), dark = new THREE.Color(0.22, 0.15, 0.11), c = new THREE.Color();
for (let i = 0; i < pos.count; i++) {
  const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), slope = 1 - nrm.getY(i);
  c.copy(sand).lerp(ochre, THREE.MathUtils.clamp(0.5 + fbm(x / 300, z / 300, 4) * 1.4, 0, 1));
  c.lerp(rock, THREE.MathUtils.smoothstep(slope, 0.08, 0.35));
  c.lerp(dark, THREE.MathUtils.smoothstep(slope, 0.35, 0.7) * 0.8);
  c.lerp(ochre, THREE.MathUtils.smoothstep(y, 500, 1100) * 0.3);
  col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
}
tg.setAttribute('color', new THREE.BufferAttribute(col, 3));
scene.add(new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 })));

// luces
const sun = new THREE.DirectionalLight(0xffdcb0, 3.6); sun.position.copy(sunDir).multiplyScalar(1000); scene.add(sun);
scene.add(new THREE.HemisphereLight(0xa8c4ff, 0xa06a40, 0.75));

// partículas: fuego aditivo y humo
function radialTex(stops) { const cv = document.createElement('canvas'); cv.width = cv.height = 128; const g = cv.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); for (const [o, cc] of stops) gr.addColorStop(o, cc); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; }
const texFire = radialTex([[0, 'rgba(255,255,235,1)'], [0.2, 'rgba(255,215,120,1)'], [0.5, 'rgba(255,110,25,.75)'], [0.8, 'rgba(160,30,0,.25)'], [1, 'rgba(80,10,0,0)']]);
const texSmoke = radialTex([[0, 'rgba(255,255,255,.85)'], [0.55, 'rgba(255,255,255,.4)'], [1, 'rgba(255,255,255,0)']]);
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
function sprite(tex, p, size, color, opacity, additive) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: !additive }));
  s.position.copy(p); s.scale.set(size, size, 1); scene.add(s); return s;
}
function explosion(x, z, k = 1) {
  const y = height(x, z);
  // columna de humo
  for (let i = 0; i < 26; i++) { const t = i / 26; sprite(texSmoke, new THREE.Vector3(x + (rnd() - 0.5) * 40 * k + t * 120 * k, y + 20 + t * 420 * k, z + (rnd() - 0.5) * 40 * k), (40 + t * 160) * k, new THREE.Color().setScalar(0.07 + t * 0.2), 0.92 - t * 0.4, false); }
  // bola de fuego
  for (let i = 0; i < 12; i++) sprite(texFire, new THREE.Vector3(x + (rnd() - 0.5) * 55 * k, y + 15 + rnd() * 75 * k, z + (rnd() - 0.5) * 55 * k), (35 + rnd() * 55) * k, 0xffa048, 0.85, true);
  sprite(texFire, new THREE.Vector3(x, y + 30 * k, z), 200 * k, 0xff7a30, 0.22, true);
  const L = new THREE.PointLight(0xff8a3a, 4e5 * k, 900 * k, 2); L.position.set(x, y + 60, z); scene.add(L);
  // polvo en la base
  for (let i = 0; i < 10; i++) sprite(texSmoke, new THREE.Vector3(x + (rnd() - 0.5) * 160 * k, y + 10, z + (rnd() - 0.5) * 160 * k), 90 * k, new THREE.Color(0.62, 0.48, 0.34), 0.55, false);
}
explosion(TGT.x, TGT.z, 1.4);
explosion(TGT.x - 210, TGT.z + 160, 1.0);
explosion(TGT.x + 240, TGT.z - 220, 1.15);
explosion(TGT.x - 480, TGT.z - 360, 0.8);
explosion(TGT.x + 520, TGT.z + 60, 0.7);
// impactos del cañón: polvo y destellos en hilera
for (let i = 0; i < 22; i++) { const x = TGT.x - 140 + i * 9 + (rnd() - 0.5) * 12, z = TGT.z + 170 - i * 14 + (rnd() - 0.5) * 12, y = height(x, z); sprite(texSmoke, new THREE.Vector3(x, y + 8, z), 26 + rnd() * 18, new THREE.Color(0.66, 0.52, 0.38), 0.7, false); if (rnd() < 0.6) sprite(texFire, new THREE.Vector3(x, y + 5, z), 14 + rnd() * 10, 0xffffff, 0.9, true); }

// A-10
const model = await loadA10Model(GLTFLoader);
const geom = loadA10Geometry(GEOM);
const ws = new WeaponSystem({ geometry: geom, mavericks: 4 });
model.setPylons(ws.pylons);
const g = model.group; scene.add(g);
const AC = new THREE.Vector3(-14, 330, 330);
// rumbo hacia los blancos, picando y alabeado
const fwd = new THREE.Vector3().subVectors(new THREE.Vector3(TGT.x, height(TGT.x, TGT.z), TGT.z), AC).normalize();
const yaw = Math.atan2(-fwd.z, fwd.x), pitch = Math.asin(fwd.y) * 0.75, roll = THREE.MathUtils.degToRad(+(P.get('roll') || -24));
const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(roll, yaw, pitch, 'YZX'));
model.update({ pos: [AC.x, AC.y, AC.z], quat: [q.x, q.y, q.z, q.w], controlSurfaces: { aileronLDeg: -6, aileronRDeg: 6 }, gear: { extension: 0, state: 'up', units: [] } }, [0, 0, 0]);
g.traverse((o) => { if (o.isMesh && o.material) { o.material.envMapIntensity = 1; } });
// cañón disparando: trazadoras, fogonazo y humo
const muzzle = new THREE.Vector3(...(geom.gun && geom.gun.muzzle || [7.26, -0.51, -0.12])).applyQuaternion(q).add(AC);
const dir = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
const IMP = new THREE.Vector3(TGT.x - 40, 0, TGT.z + 30); IMP.y = height(IMP.x, IMP.z);
const aim = IMP.clone().sub(muzzle).normalize(), aimLen = IMP.distanceTo(muzzle);
const trMat = new THREE.MeshBasicMaterial({ color: 0xffa040, fog: false, toneMapped: false });
const trGeo = new THREE.CylinderGeometry(0.16, 0.16, 1, 6); trGeo.rotateZ(Math.PI / 2);
for (let i = 0; i < 55; i++) {
  const d0 = 2.5 + Math.pow(i / 55, 1.7) * (aimLen - 20) + rnd() * 3; if (d0 > aimLen - 12) continue;
  const _u = 0, L = Math.min(5 + rnd() * 4, 1.6 + d0 * 0.18), sp = 0.005;
  const dd = aim.clone().add(new THREE.Vector3((rnd() - 0.5) * sp, (rnd() - 0.5) * sp, (rnd() - 0.5) * sp)).normalize();
  const m = new THREE.Mesh(trGeo, trMat); m.frustumCulled = false; const w = 1 + d0 / 160;
  m.scale.set(L, w, w); m.position.copy(muzzle).addScaledVector(dd, d0 + L / 2);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dd); scene.add(m);
}
sprite(texFire, muzzle.clone().addScaledVector(dir, 1.3), 1.9, 0xffc070, 1, true);
sprite(texFire, muzzle.clone().addScaledVector(dir, 0.5), 1.0, 0xffffff, 1, true);
for (let i = 0; i < 10; i++) { const t = i / 10; sprite(texSmoke, muzzle.clone().addScaledVector(dir, 3 - t * 40).add(new THREE.Vector3((rnd() - 0.5) * 3, -2.5 - t * 9, (rnd() - 0.5) * 3)), 3 + t * 14, new THREE.Color().setScalar(0.5 + t * 0.15), 0.55 - t * 0.4, false); }

// cámara: 3/4 delantera, por debajo del ala, con el valle y las explosiones detrás
const camPos = AC.clone().add(new THREE.Vector3(+(P.get('cx') || 20), +(P.get('cy') || 3), +(P.get('cz') || 29)));
camera.position.copy(camPos);
camera.lookAt(AC.clone().lerp(new THREE.Vector3(TGT.x, 250, TGT.z), +(P.get('lk') || 0.008)));
camera.fov = +(P.get('fov') || 38); camera.updateProjectionMatrix();
renderer.render(scene, camera);

// composición: viñeta + título
function compose(withTitle) {
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const x = cv.getContext('2d');
  x.filter = 'contrast(1.12) saturate(1.18)'; x.drawImage(renderer.domElement, 0, 0); x.filter = 'none';
  const vg = x.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.55)');
  x.fillStyle = vg; x.fillRect(0, 0, W, H);
  if (withTitle) {
    const gr = x.createLinearGradient(0, H * 0.62, 0, H); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.72)'); x.fillStyle = gr; x.fillRect(0, H * 0.6, W, H * 0.4);
    const u = W / 1600;
    x.font = `900 ${118 * u}px Impact, "Arial Black", sans-serif`; x.textBaseline = 'alphabetic';
    x.fillStyle = 'rgba(0,0,0,.55)'; x.fillText('A-10C', 64 * u + 4, H - 150 * u + 5);
    x.fillStyle = '#f3e6c8'; x.fillText('A-10C', 64 * u, H - 150 * u);
    x.font = `800 ${54 * u}px Impact, "Arial Black", sans-serif`; x.fillStyle = '#ffb347'; x.fillText('THUNDERBOLT II', 68 * u, H - 92 * u);
    x.font = `600 ${24 * u}px "Segoe UI", system-ui, sans-serif`; x.fillStyle = 'rgba(255,240,220,.88)';
    x.fillText('SIMULADOR · ATAQUE A TIERRA · GAU-8/A AVENGER · AGM-65 MAVERICK', 70 * u, H - 48 * u);
  }
  return cv.toDataURL('image/jpeg', 0.9);
}
window.__out = { clean: compose(false), title: compose(true) };
window.__done = true;
