import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCameraRig } from '../../src/camera/index.js';

function setup(world = { height: () => 0 }) {
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.5, 20000);
  const group = new THREE.Group(); group.position.set(0, 100, 0);
  const aircraft = { group, eyeLocal: new THREE.Vector3(3.8, 1.0, 0) };
  const rig = createCameraRig({ camera, world, aircraft });
  return { camera, group, aircraft, rig };
}
const hdgQuat = (hdgDeg) => { // proa (x cuerpo) hacia el rumbo: forward = (sin h, 0, -cos h)
  const th = Math.PI / 2 - (hdgDeg * Math.PI) / 180;
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), th);
};
const state = (g, vel = [0, 0, 0]) => ({ pos: g.position.toArray(), quat: g.quaternion.toArray(), vel });
const finite3 = (v) => Number.isFinite(v.x + v.y + v.z);

test('pilot: la cámara está en el ojo del piloto y mira hacia la proa', () => {
  const { camera, group, rig } = setup();
  group.quaternion.copy(hdgQuat(90)); // proa al este
  group.position.set(10, 50, -20);
  rig.setMode('pilot');
  rig.update(0.016, state(group), { dyaw: 0, dpitch: 0, zoom: 0, active: false });
  assert.ok(Math.abs(camera.position.x - 13.8) < 1e-6 && Math.abs(camera.position.y - 51) < 1e-6 && Math.abs(camera.position.z + 20) < 1e-6);
  const d = camera.getWorldDirection(new THREE.Vector3());
  assert.ok(d.x > 0.999, 'mira al este: ' + d.toArray());
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  assert.ok(up.y > 0.999);
});

test('pilot: mirada libre con botón derecho y vuelta suave al frente', () => {
  const { camera, group, rig } = setup();
  group.quaternion.copy(hdgQuat(0)); // norte = -z
  rig.setMode('pilot');
  // mirar 90° a la derecha (derecha de norte = este = +x)
  rig.update(0.016, state(group), { dyaw: Math.PI / 2, dpitch: 0, zoom: 0, active: true });
  let d = camera.getWorldDirection(new THREE.Vector3());
  assert.ok(d.x > 0.999, 'mira a la derecha: ' + d.toArray());
  // mirar arriba
  rig.update(0.016, state(group), { dyaw: -Math.PI / 2, dpitch: 0.5, zoom: 0, active: true });
  d = camera.getWorldDirection(new THREE.Vector3());
  assert.ok(d.y > 0.3, 'mira arriba');
  // soltar: vuelve suavemente al frente
  let prev = Infinity;
  for (let i = 0; i < 600; i++) {
    rig.update(0.016, state(group), { dyaw: 0, dpitch: 0, zoom: 0, active: false });
    d = camera.getWorldDirection(new THREE.Vector3());
    const ang = Math.acos(Math.min(1, -d.z));
    if (i > 40) assert.ok(ang <= prev + 1e-9, 'monótono');
    prev = ang;
  }
  assert.ok(prev < 1e-3, 'vuelve al frente: ' + prev);
});

test('pilot: límites de mirada y zoom (FOV)', () => {
  const { camera, group, rig } = setup();
  rig.setMode('pilot');
  rig.update(0.016, state(group), { dyaw: 100, dpitch: 100, zoom: 0, active: true });
  assert.ok(Number.isFinite(camera.quaternion.x));
  rig.update(0.016, state(group), { dyaw: 0, dpitch: 0, zoom: -5, active: false });
  assert.ok(camera.fov < 70, 'rueda hacia adelante acerca: ' + camera.fov);
  rig.update(0.016, state(group), { dyaw: 0, dpitch: 0, zoom: -1e6, active: false });
  assert.ok(camera.fov >= 15 - 1e-9 && camera.fov <= 70 / 0.5 + 1e-9);
  rig.update(0.016, state(group), { dyaw: 0, dpitch: 0, zoom: 1e6, active: false });
  assert.ok(camera.fov <= 100 + 1e-9 && camera.fov > 70);
});

test('chase: se coloca detrás y arriba, resorte converge sin NaN con dt extremos', () => {
  const { camera, group, rig } = setup();
  group.quaternion.copy(hdgQuat(90)); // proa al este
  rig.setMode('chase');
  for (const dt of [0.016, 0.016, 1e-9, 0, 5, NaN, -1, 0.25, 0.001]) {
    rig.update(dt, state(group, [50, 0, 0]), null);
    assert.ok(finite3(camera.position), 'dt=' + dt);
    assert.ok(Number.isFinite(camera.quaternion.w));
  }
  for (let i = 0; i < 600; i++) rig.update(0.016, state(group), null);
  assert.ok(camera.position.x < group.position.x - 15, 'detrás (oeste): ' + camera.position.x);
  assert.ok(camera.position.y > group.position.y + 1, 'arriba');
  assert.ok(Math.abs(camera.position.z - group.position.z) < 0.5);
});

test('chase: el resorte sigue al avión con retraso y no oscila sin amortiguación', () => {
  const { camera, group, rig } = setup();
  group.quaternion.copy(hdgQuat(90));
  rig.setMode('chase');
  rig.update(0.016, state(group), null);
  group.position.x += 40; // salto
  let maxOver = -Infinity;
  const d = [];
  for (let i = 0; i < 400; i++) { rig.update(0.016, state(group), null); d.push(group.position.x - camera.position.x); }
  const final = d.at(-1);
  for (const v of d) maxOver = Math.max(maxOver, Math.abs(v - final));
  assert.ok(maxOver < 40 + 5, 'sin sobreimpulso grande');
  assert.ok(Math.abs(d.at(-1) - d.at(-50)) < 0.05, 'estable');
});

test('chase: rueda cambia la distancia dentro de límites; nunca bajo el terreno', () => {
  const hill = { height: (x) => (x > 0 ? 80 + x * 0.1 : 0) };
  const { camera, group, rig } = setup(hill);
  group.position.set(-5, 2, 0);
  group.quaternion.copy(hdgQuat(270)); // proa al oeste: la cámara queda al este, sobre la colina
  rig.setMode('chase');
  for (let i = 0; i < 300; i++) {
    rig.update(0.016, state(group), null);
    assert.ok(camera.position.y >= hill.height(camera.position.x) + 1.5 - 1e-6, 'bajo el terreno en cuadro ' + i);
  }
  const d0 = rig.distance;
  rig.update(0.016, state(group), { dyaw: 0, dpitch: 0, zoom: 10, active: false });
  assert.ok(rig.distance > d0);
  rig.update(0.016, state(group), { dyaw: 0, dpitch: 0, zoom: -1e6, active: false });
  assert.equal(rig.distance, rig.options.chase.distMin);
});

test('chase: estado inválido (NaN en pose) no contamina la cámara', () => {
  const { camera, group, rig } = setup();
  rig.setMode('chase');
  rig.update(0.016, state(group), null);
  group.position.set(NaN, Infinity, 0);
  rig.update(0.016, state(group), null);
  rig.update(0.016, null, null);
  assert.ok(finite3(camera.position));
});

test('world: cámara fija en el mundo mientras el avión está cerca; mira al avión', () => {
  const { camera, group, rig } = setup();
  group.quaternion.copy(hdgQuat(90));
  rig.setMode('world');
  rig.update(0.016, state(group, [0, 0, 0]), null);
  const p0 = camera.position.clone();
  group.position.x += 10;
  for (let i = 0; i < 60; i++) rig.update(0.016, state(group, [0, 0, 0]), null);
  assert.ok(camera.position.distanceTo(p0) < 1e-9, 'fija');
  const toAc = group.position.clone().sub(camera.position).normalize();
  assert.ok(camera.getWorldDirection(new THREE.Vector3()).dot(toAc) > 0.999);
});

test('world: se reubica adelante de la trayectoria cuando el avión se aleja', () => {
  const { camera, group, rig } = setup();
  group.quaternion.copy(hdgQuat(90)); // al este
  rig.setMode('world');
  const vel = [80, 0, 0];
  rig.update(0.016, state(group, vel), null);
  const first = camera.position.clone();
  let relocated = false, last = first.clone();
  for (let i = 0; i < 6000; i++) {
    group.position.x += 80 * 0.016;
    rig.update(0.016, state(group, vel), null);
    if (camera.position.distanceTo(last) > 1) {
      relocated = true;
      assert.ok(camera.position.x > group.position.x + 50, 'queda adelante del avión: cam ' + camera.position.x + ' avión ' + group.position.x);
      break;
    }
    last.copy(camera.position);
  }
  assert.ok(relocated, 'se reubicó');
  // el avión siempre queda a distancia razonable (nunca se pierde)
  let maxDist = 0;
  for (let i = 0; i < 3000; i++) {
    group.position.x += 80 * 0.016; rig.update(0.016, state(group, vel), null);
    maxDist = Math.max(maxDist, camera.position.distanceTo(group.position));
  }
  assert.ok(maxDist < 900, 'distancia máx: ' + maxDist);
});

test('world: reubicación por tecla y nunca bajo el terreno (world.height + 2)', () => {
  const rough = { height: (x, z) => 30 + 25 * Math.sin(x * 0.01) * Math.cos(z * 0.013) };
  const { camera, group, rig } = setup(rough);
  group.position.set(0, 40, 0);
  group.quaternion.copy(hdgQuat(45));
  rig.setMode('world');
  for (let k = 0; k < 40; k++) {
    group.position.set(k * 137, 31 + rough.height(k * 137, k * 59), k * 59);
    rig.relocate();
    const vel = [Math.cos(k) * 120, 0, Math.sin(k) * 120];
    rig.update(0.016, state(group, vel), null);
    const g = rough.height(camera.position.x, camera.position.z);
    assert.ok(camera.position.y >= g + 2 - 1e-9, `k=${k} y=${camera.position.y} suelo=${g}`);
    assert.ok(finite3(camera.position));
  }
});

test('world: zoom automático por distancia (FOV disminuye al alejarse) y la rueda lo ajusta', () => {
  const { camera, group, rig } = setup();
  rig.setMode('world');
  rig.update(0.016, state(group, [0, 0, 0]), null);
  for (let i = 0; i < 200; i++) rig.update(0.016, state(group, [0, 0, 0]), null);
  const near = camera.fov;
  group.position.add(new THREE.Vector3(0, 0, 100)); // más lejos sin disparar reubicación
  for (let i = 0; i < 400; i++) rig.update(0.016, state(group, [0, 0, 0]), null);
  assert.ok(camera.fov < near, `fov lejos ${camera.fov} < cerca ${near}`);
  assert.ok(camera.fov >= 3.5 - 1e-6 && camera.fov <= 50);
  const f = camera.fov;
  rig.update(0.016, state(group, [0, 0, 0]), { zoom: -20, active: false });
  for (let i = 0; i < 400; i++) rig.update(0.016, state(group, [0, 0, 0]), null);
  assert.ok(camera.fov < f, 'zoom con rueda acerca (FOV menor)');
});

test('modos: next() cicla pilot -> chase -> world -> pilot; el cambio reinicia sin saltos NaN', () => {
  const { camera, group, rig } = setup();
  assert.equal(rig.mode, 'pilot');
  const seq = [rig.next(), rig.next(), rig.next()];
  assert.deepEqual(seq, ['chase', 'world', 'pilot']);
  assert.equal(rig.setMode('inexistente'), 'pilot');
  for (const m of ['pilot', 'chase', 'world']) { rig.setMode(m); rig.update(0.016, state(group, [10, 0, 0]), null); assert.ok(finite3(camera.position), m); }
});

test('sin mundo ni grupo: funciona con el estado', () => {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  const rig = createCameraRig({ camera, world: null, aircraft: { eyeLocal: new THREE.Vector3(1, 0, 0) } });
  const s = { pos: [0, 10, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0] };
  for (const m of ['pilot', 'chase', 'world']) { rig.setMode(m); rig.update(0.016, s, null); assert.ok(finite3(camera.position), m); }
});

test('chase: distancia por defecto 30 m (tamaño del A-10)', () => {
  const { camera, group, rig } = setup();
  group.quaternion.copy(hdgQuat(90));
  assert.equal(rig.distance, 30);
  rig.setMode('chase');
  for (let i = 0; i < 600; i++) rig.update(0.016, state(group), null);
  const d = camera.position.distanceTo(group.position);
  assert.ok(d > 28 && d < 32, 'distancia al avión: ' + d);
});

test('pilot: usa eyeLocal del modelo (ojo del A-10)', () => {
  const { camera, group, aircraft, rig } = setup();
  aircraft.eyeLocal.set(5.5, 1.7, 0);
  group.quaternion.copy(hdgQuat(90));
  rig.update(0.016, state(group), null);
  assert.ok(Math.abs(camera.position.x - 5.5) < 1e-6 && Math.abs(camera.position.y - 101.7) < 1e-6);
});

test('weapon: se salta en el ciclo si no hay misil; con misil entra en next() y vuelve a pilot', () => {
  const { camera, group, rig } = setup();
  assert.equal(rig.hasWeaponTarget, false);
  assert.equal(rig.setMode('weapon'), 'pilot', 'sin misil no se puede entrar');
  assert.deepEqual([rig.next(), rig.next(), rig.next()], ['chase', 'world', 'pilot']);
  const missile = new THREE.Object3D(); missile.position.set(0, 100, 0);
  const modes = [];
  const rig2 = createCameraRig({ camera, world: { height: () => 0 }, aircraft: { group, eyeLocal: new THREE.Vector3(3, 1, 0) }, onModeChange: (m) => modes.push(m) });
  rig2.setWeaponTarget(missile);
  assert.equal(rig2.mode, 'pilot', 'no cambia sola');
  assert.deepEqual([rig2.next(), rig2.next(), rig2.next(), rig2.next()], ['chase', 'world', 'weapon', 'pilot']);
  assert.deepEqual(modes, ['chase', 'world', 'weapon', 'pilot']);
});

test('weapon: sigue al misil desde atrás mirando hacia donde va; sin NaN; nunca bajo el terreno', () => {
  const { camera, group, rig } = setup({ height: () => 50 });
  group.quaternion.copy(hdgQuat(90));
  const missile = new THREE.Object3D(); missile.position.set(0, 120, 0);
  const sp = [200, 0, 0];
  rig.setWeaponTarget(missile, { switchTo: true });
  assert.equal(rig.mode, 'weapon');
  for (let i = 0; i < 300; i++) {
    missile.position.x += sp[0] * 0.016; missile.position.y -= 0.05;
    rig.update(0.016, state(group, sp), null);
    assert.ok(finite3(camera.position), 'cuadro ' + i);
    assert.ok(camera.position.y >= 50 + 1.5 - 1e-6);
  }
  assert.ok(camera.position.x < missile.position.x - 3 && camera.position.x > missile.position.x - 20, 'detrás del misil: ' + (missile.position.x - camera.position.x));
  const dir = camera.getWorldDirection(new THREE.Vector3());
  assert.ok(dir.x > 0.9, 'mira hacia +x (rumbo del misil): ' + dir.x);
  for (const dt of [0, NaN, -1, 5, 1e-9]) { rig.update(dt, state(group, sp), null); assert.ok(finite3(camera.position), 'dt=' + dt); }
  // misil parado: usa su eje +x local
  const still = new THREE.Object3D(); still.position.set(1000, 200, 0); still.rotation.y = Math.PI;  // +x local → −x mundo
  rig.setWeaponTarget(still);
  for (let i = 0; i < 400; i++) rig.update(0.016, state(group, [0, 0, 0]), null);
  assert.ok(camera.position.x > still.position.x, 'detrás de un misil que apunta a −x');
});

test('weapon: setWeaponTarget(null) en modo weapon vuelve al modo anterior; zoom limitado', () => {
  const { camera, group, rig } = setup();
  const m = new THREE.Object3D(); m.position.set(0, 100, 0);
  rig.setMode('world'); rig.update(0.016, state(group), null);
  rig.setWeaponTarget(m, { switchTo: true }); assert.equal(rig.mode, 'weapon');
  rig.update(0.016, state(group), { zoom: 1e6 }); rig.update(0.016, state(group), { zoom: -1e6 });
  assert.ok(finite3(camera.position));
  assert.equal(rig.setWeaponTarget(null), 'world');
  rig.setMode('pilot'); rig.setWeaponTarget(m, { switchTo: true });
  assert.equal(rig.setWeaponTarget(null), 'pilot');
  rig.setWeaponTarget(m, { switchTo: true }); rig.snap();
  assert.doesNotThrow(() => rig.update(0.016, state(group), null));
});
