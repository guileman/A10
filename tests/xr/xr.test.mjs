import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Quaternion, PerspectiveCamera, Group } from 'three';
import { applyXRInput } from '../../src/xr/mapping.js';
import { ROT_Y_M90 } from '../../src/xr/vr.js';

const pad = (axes = [0, 0, 0, 0], pressed = []) => ({ axes, buttons: Array.from({ length: 6 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })) });
function fakeApi() {
  const st = { throttle: 0.5, nozzleCmd: 0 }, log = [];
  return { state: st, log, ext: null,
    setExternal(e) { this.ext = e; }, setThrottle(v) { st.throttle = Math.max(0, Math.min(1, v)); }, setNozzleDeg(v) { st.nozzleCmd = Math.max(0, Math.min(98.5, v)); }, press(id) { log.push(id); } };
}

test('palanca derecha: adelante = proa abajo (pitch<0), derecha = alabeo +', () => {
  const api = fakeApi(), prev = {};
  applyXRInput({ right: pad([0, 0, 0.9, -0.9]) }, prev, 0.016, api);
  assert.ok(api.ext.pitch < -0.5 && api.ext.roll > 0.5);
});
test('zona muerta y curva progresiva', () => {
  const api = fakeApi(); applyXRInput({ right: pad([0, 0, 0.05, 0.05]) }, {}, 0.016, api);
  assert.equal(api.ext.pitch, 0); assert.equal(api.ext.roll, 0);
  applyXRInput({ right: pad([0, 0, 0.5, 0]) }, {}, 0.016, api); assert.ok(api.ext.roll < 0.35); // 0,5 -> menos de 0,35
});
test('gases con el stick izquierdo y pedales con X', () => {
  const api = fakeApi(); applyXRInput({ left: pad([0, 0, 0.7, -1]) }, {}, 0.5, api);
  assert.ok(api.state.throttle > 0.5 && api.ext.yaw > 0.3);
});
test('acciones por flanco: una pulsación = una acción', () => {
  const api = fakeApi(), prev = {};
  for (let i = 0; i < 5; i++) applyXRInput({ left: pad([0, 0, 0, 0], [4]) }, prev, 0.016, api);   // X mantenida
  applyXRInput({ left: pad() }, prev, 0.016, api);
  applyXRInput({ left: pad([0, 0, 0, 0], [5]) }, prev, 0.016, api);                             // Y
  assert.deepEqual(api.log, ['gear', 'flaps']);
});
test('gatillo derecho = cañón; A = misil, B = bloqueo (por flanco); gatillo izq. = freno', () => {
  const api = fakeApi(), prev = {}, acts = [];
  const r = applyXRInput({ right: pad([0, 0, 0, 0], [0, 4]), left: pad([0, 0, 0, 0], [0]) }, prev, 0.016, api, { onAction: (n) => acts.push(n) });
  assert.equal(r.gun, true); assert.equal(api.ext.brake, 1);
  applyXRInput({ right: pad([0, 0, 0, 0], [4]) }, prev, 0.016, api, { onAction: (n) => acts.push(n) });
  applyXRInput({ right: pad([0, 0, 0, 0], [5]) }, prev, 0.016, api, { onAction: (n) => acts.push(n) });
  assert.deepEqual(acts, ['fireMissile', 'lockTarget']);
});
test('el dolly alinea la mirada del casco con la proa del avión', () => {
  const dolly = new Group(), cam = new PerspectiveCamera(); dolly.add(cam);
  const aq = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.7).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.2)); // guiñada + cabeceo
  dolly.quaternion.copy(aq).multiply(ROT_Y_M90); dolly.updateMatrixWorld(true);
  const look = new Vector3(); cam.getWorldDirection(look);
  const nose = new Vector3(1, 0, 0).applyQuaternion(aq), up = new Vector3(0, 1, 0).applyQuaternion(aq).dot(new Vector3(0, 1, 0).applyQuaternion(cam.getWorldQuaternion(new Quaternion())));
  assert.ok(look.distanceTo(nose) < 1e-9); assert.ok(up > 0.999);
  const right = new Vector3(1, 0, 0).applyQuaternion(cam.getWorldQuaternion(new Quaternion())), bodyRight = new Vector3(0, 0, 1).applyQuaternion(aq);
  assert.ok(right.distanceTo(bodyRight) < 1e-9);
});
