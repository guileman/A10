// Cámaras: pilot (ojo del piloto), chase (resorte-amortiguador), world (fija en el mundo) y weapon (sigue al último Maverick; opcional).
// Marco mundo: x este, y arriba, z sur. Marco cuerpo: x proa, y arriba, z estribor.
// Sin asignaciones por cuadro: todos los temporales son del módulo.
import { Vector3, Quaternion } from 'three';

export const CAMERA_MODES = ['pilot', 'chase', 'world', 'weapon'];
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const fin = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export function defaultCameraOptions() {
  return {
    terrainClearance: 2,        // m sobre el terreno (world: world.height + 2)
    pilot: { yawLimit: 150 * D2R, pitchMin: -60 * D2R, pitchMax: 80 * D2R, returnDelay: 0.25, returnRate: 4.5, fovMin: 30, fovMax: 100 },
    chase: { dist: 30, distMin: 10, distMax: 200, elevDeg: 12, posFreq: 1.8, posZeta: 0.9, aimFreq: 4.0, aimZeta: 1.0, aimUp: 1.0, lead: 2, clearance: 1.5 },
    weapon: { dist: 9, distMin: 4, distMax: 40, up: 2.2, aheadM: 40, followRate: 9, dirRate: 8, minSpeed: 5, clearance: 1.5 },
    world: {
      viewRadius: 22,           // m de semialtura de cuadro que se quiere ver alrededor del avión (zoom automático)
      fovMin: 3.5, fovMax: 50, fovRate: 4,
      slowSpeed: 5, nearOffset: 45, nearSide: 30,
      aheadMin: 100, aheadMax: 800, aheadTime: 5,
      farMin: 150, farMax: 800, farTime: 3, farSlow: 400, hardFar: 2000,
      minInterval: 3, teleport: 250, aimRate: 20, heightFrac: 0.2, heightMin: 3, heightMax: 40,
    },
  };
}

export function createCameraRig({ camera, world = null, aircraft = null, options = null, onModeChange = null } = {}) {
  const o = defaultCameraOptions();
  if (options) for (const k of Object.keys(options)) o[k] = typeof o[k] === 'object' ? { ...o[k], ...options[k] } : options[k];

  // temporales
  const _pos = new Vector3(), _q = new Quaternion(), _s = new Vector3();
  const _eye = new Vector3(), _fwd = new Vector3(), _tmp = new Vector3(), _vel = new Vector3();
  const _qa = new Quaternion(), _qb = new Quaternion();
  const _wp = new Vector3(), _wq = new Quaternion(), _ws = new Vector3(), _wd = new Vector3();
  const _AX_Y = new Vector3(0, 1, 0), _AX_Z = new Vector3(0, 0, 1);
  // cámara (-z, +x, +y) -> cuerpo (+x, +z, +y): giro de -90° sobre y
  const Q_CAM2BODY = new Quaternion().setFromAxisAngle(_AX_Y, -Math.PI / 2);

  const r = {
    mode: 'pilot', time: 0,
    baseFov: camera ? camera.fov : 60,
    // mirada
    lookYaw: 0, lookPitch: 0, sinceLook: 99,
    zoomK: 1,                                   // pilot: factor de zoom; world: factor sobre el radio de vista
    chaseDist: o.chase.dist,
    // chase
    cPos: new Vector3(), cVel: new Vector3(), cDes: new Vector3(), aim: new Vector3(), aimVel: new Vector3(), aimDes: new Vector3(),
    backX: 0, backZ: 1, chaseInit: false,
    // world
    wPos: new Vector3(), wAim: new Vector3(), wInit: false, wSide: 1, lastReloc: -99, lastP: new Vector3(), wFov: 40, wForce: false,
    // weapon
    weaponTarget: null, wpInit: false, wpPos: new Vector3(), wpOff: new Vector3(), wpPrev: new Vector3(), wpDir: new Vector3(1, 0, 0), weaponDist: o.weapon.dist, prevMode: 'chase',
    pose: { pos: _pos, quat: _q },
  };
  let world_ = world, aircraft_ = aircraft;

  const ground = (x, z) => {
    if (!world_ || !world_.height) return 0;
    const h = world_.height(x, z);
    return Number.isFinite(h) ? h : 0;
  };
  const setFov = (fov) => {
    if (!camera) return;
    if (Math.abs(camera.fov - fov) > 0.005) { camera.fov = fov; camera.updateProjectionMatrix(); }
  };

  // Pose del avión (grupo 3D si está; si no, el estado)
  const readPose = (state) => {
    const g = aircraft_ && aircraft_.group;
    if (g && g.matrixWorld) {
      g.updateWorldMatrix(true, false);
      g.matrixWorld.decompose(_pos, _q, _s);
    } else if (state && state.pos && state.quat) {
      _pos.set(fin(state.pos[0]), fin(state.pos[1]), fin(state.pos[2]));
      _q.set(fin(state.quat[0]), fin(state.quat[1]), fin(state.quat[2]), fin(state.quat[3], 1));
    } else { _q.identity(); }
    if (!Number.isFinite(_pos.x + _pos.y + _pos.z)) _pos.set(0, 0, 0);
    const ql = _q.lengthSq();
    if (!(ql > 1e-12) || !Number.isFinite(ql)) _q.identity(); else if (Math.abs(ql - 1) > 1e-6) _q.normalize();
    if (state && state.vel) _vel.set(fin(state.vel[0]), fin(state.vel[1]), fin(state.vel[2]));
    else _vel.set(0, 0, 0);
  };

  const updateLook = (dt, look, p) => {
    if (look && look.active) {
      r.lookYaw = clamp(r.lookYaw + fin(look.dyaw ?? look.yaw), -p.yawLimit, p.yawLimit);
      r.lookPitch = clamp(r.lookPitch + fin(look.dpitch ?? look.pitch), p.pitchMin, p.pitchMax);
      r.sinceLook = 0;
    } else {
      r.sinceLook += dt;
      if (r.sinceLook > p.returnDelay) {
        const k = Math.exp(-p.returnRate * dt);
        r.lookYaw *= k; r.lookPitch *= k;
        if (Math.abs(r.lookYaw) < 1e-4) r.lookYaw = 0;
        if (Math.abs(r.lookPitch) < 1e-4) r.lookPitch = 0;
      }
    }
  };

  // ---------- pilot ----------
  const updatePilot = (dt, state, look) => {
    updateLook(dt, look, o.pilot);
    if (look && look.zoom) r.zoomK = clamp(r.zoomK * Math.exp(-0.1 * look.zoom), 0.5, 3);
    const g = aircraft_ && aircraft_.group;
    const eyeL = aircraft_ && aircraft_.eyeLocal;
    if (g && g.matrixWorld && eyeL) _eye.copy(eyeL).applyMatrix4(g.matrixWorld);
    else { _eye.copy(_pos); if (eyeL) _eye.add(_tmp.copy(eyeL).applyQuaternion(_q)); }
    camera.position.copy(_eye);
    // q = q_avion * Ry(-yaw) * Rz(pitch) * Q_cam2body
    _qa.setFromAxisAngle(_AX_Y, -r.lookYaw);
    _qb.setFromAxisAngle(_AX_Z, r.lookPitch);
    camera.quaternion.copy(_q).multiply(_qa).multiply(_qb).multiply(Q_CAM2BODY);
    setFov(clamp(r.baseFov / r.zoomK, o.pilot.fovMin * 0.5, o.pilot.fovMax));
  };

  // ---------- chase ----------
  // resorte-amortiguador con subpasos (semi-implícito): x'' = -w²(x-d) - 2 z w v
  const spring = (x, v, d, f, zeta, dt) => {
    const w = 2 * Math.PI * f;
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      v.x += (-w * w * (x.x - d.x) - 2 * zeta * w * v.x) * h;
      v.y += (-w * w * (x.y - d.y) - 2 * zeta * w * v.y) * h;
      v.z += (-w * w * (x.z - d.z) - 2 * zeta * w * v.z) * h;
      x.x += v.x * h; x.y += v.y * h; x.z += v.z * h;
    }
  };

  const chaseDesired = () => {
    const c = o.chase;
    _fwd.set(1, 0, 0).applyQuaternion(_q);
    const h = Math.hypot(_fwd.x, _fwd.z);
    if (h > 0.2) { r.backX = -_fwd.x / h; r.backZ = -_fwd.z / h; }   // si el morro apunta casi vertical, se conserva el último rumbo
    const a = r.lookYaw, ca = Math.cos(a), sa = Math.sin(a);
    const bx = r.backX * ca + r.backZ * sa, bz = -r.backX * sa + r.backZ * ca;
    const el = clamp(c.elevDeg * D2R - r.lookPitch, -10 * D2R, 85 * D2R);
    const d = r.chaseDist, ce = Math.cos(el), se = Math.sin(el);
    r.cDes.set(_pos.x + bx * d * ce, _pos.y + d * se, _pos.z + bz * d * ce);
    const floor = ground(r.cDes.x, r.cDes.z) + c.clearance;
    if (r.cDes.y < floor) r.cDes.y = floor;
    r.aimDes.set(_pos.x + _fwd.x * c.lead, _pos.y + c.aimUp + _fwd.y * c.lead, _pos.z + _fwd.z * c.lead);
  };

  const updateChase = (dt, state, look) => {
    const c = o.chase;
    updateLook(dt, look, { yawLimit: Math.PI, pitchMin: -60 * D2R, pitchMax: 70 * D2R, returnDelay: 1.2, returnRate: 2.5 });
    if (look && look.zoom) r.chaseDist = clamp(r.chaseDist * Math.exp(0.1 * look.zoom), c.distMin, c.distMax);
    chaseDesired();
    if (!r.chaseInit) {
      r.cPos.copy(r.cDes); r.cVel.set(0, 0, 0); r.aim.copy(r.aimDes); r.aimVel.set(0, 0, 0); r.chaseInit = true;
    } else {
      const d = Math.min(dt, 0.1);
      spring(r.cPos, r.cVel, r.cDes, c.posFreq, c.posZeta, d);
      spring(r.aim, r.aimVel, r.aimDes, c.aimFreq, c.aimZeta, d);
      if (!Number.isFinite(r.cPos.x + r.cPos.y + r.cPos.z + r.aim.x + r.aim.y + r.aim.z)) { r.chaseInit = false; return updateChase(0, state, null); }
    }
    const floor = ground(r.cPos.x, r.cPos.z) + c.clearance;
    if (r.cPos.y < floor) { r.cPos.y = floor; if (r.cVel.y < 0) r.cVel.y = 0; }
    camera.position.copy(r.cPos);
    if (_tmp.copy(r.aim).sub(r.cPos).lengthSq() > 1e-4) camera.lookAt(r.aim);
    setFov(r.baseFov);
  };

  // ---------- world ----------
  const placeWorld = (state) => {
    const w = o.world;
    const speed = Math.hypot(_vel.x, _vel.z);
    const gP = ground(_pos.x, _pos.z);
    const agl = Math.max(0, _pos.y - gP);
    let dx, dz;
    if (speed >= w.slowSpeed) { dx = _vel.x / speed; dz = _vel.z / speed; }
    else {
      _fwd.set(1, 0, 0).applyQuaternion(_q);
      const h = Math.hypot(_fwd.x, _fwd.z) || 1;
      dx = _fwd.x / h; dz = _fwd.z / h;
      if (!(Math.hypot(_fwd.x, _fwd.z) > 0.01)) { dx = 0; dz = -1; }
    }
    const rx = -dz, rz = dx;                    // derecha horizontal de la dirección (x este, z sur)
    let ahead, side;
    if (speed >= w.slowSpeed) {
      ahead = clamp(speed * w.aheadTime, w.aheadMin, w.aheadMax);
      side = clamp(speed * 0.6, 40, 150) * r.wSide;
    } else { ahead = w.nearOffset; side = w.nearSide * r.wSide; }
    r.wSide = -r.wSide;
    r.wPos.x = _pos.x + dx * ahead + rx * side;
    r.wPos.z = _pos.z + dz * ahead + rz * side;
    const gC = ground(r.wPos.x, r.wPos.z);
    const hgt = speed >= w.slowSpeed ? clamp(agl * w.heightFrac, w.heightMin, w.heightMax) : w.heightMin;
    r.wPos.y = Math.max(gC + hgt, gC + o.terrainClearance);
    r.lastReloc = r.time;
    r.wInit = true;
  };

  const updateWorld = (dt, state, look) => {
    const w = o.world;
    if (look && look.zoom) r.zoomK = clamp(r.zoomK * Math.exp(0.1 * look.zoom), 0.3, 4);
    const speed = Math.hypot(_vel.x, _vel.z);
    if (!r.wInit || r.wForce) { placeWorld(state); r.wForce = false; r.wAim.copy(_pos); }
    else {
      _tmp.copy(_pos).sub(r.wPos);
      const dist = _tmp.length();
      const jumped = _tmp.copy(_pos).sub(r.lastP).length() > w.teleport && dt < 0.5;
      const radial = dist > 1e-3 ? _vel.dot(_tmp.copy(_pos).sub(r.wPos)) / dist : 0;
      const far = speed >= w.slowSpeed ? clamp(speed * w.farTime, w.farMin, w.farMax) : w.farSlow;
      const can = r.time - r.lastReloc > w.minInterval;
      if (jumped || dist > w.hardFar || (can && dist > far && radial > 0)) { placeWorld(state); if (jumped) r.wAim.copy(_pos); }
    }
    r.lastP.copy(_pos);
    // nunca bajo el terreno
    const floor = ground(r.wPos.x, r.wPos.z) + o.terrainClearance;
    if (r.wPos.y < floor) r.wPos.y = floor;
    camera.position.copy(r.wPos);
    const k = 1 - Math.exp(-w.aimRate * Math.min(dt, 0.1));
    r.wAim.x += (_pos.x - r.wAim.x) * k; r.wAim.y += (_pos.y - r.wAim.y) * k; r.wAim.z += (_pos.z - r.wAim.z) * k;
    if (_tmp.copy(r.wAim).sub(r.wPos).lengthSq() > 1e-4) camera.lookAt(r.wAim);
    const dist = _tmp.copy(_pos).sub(r.wPos).length();
    const target = clamp(2 * Math.atan2(w.viewRadius * r.zoomK, Math.max(dist, 1)) * R2D, w.fovMin, w.fovMax);
    const kf = 1 - Math.exp(-w.fovRate * Math.min(dt, 0.1));
    r.wFov += (target - r.wFov) * kf;
    setFov(r.wFov);
  };

  // ---------- weapon ----------
  // Detrás y un poco arriba del misil, mirando hacia donde va (dirección = velocidad suavizada; si está casi parado, su eje +x local).
  const updateWeapon = (dt, state, look) => {
    const w = o.weapon, tg = r.weaponTarget;
    if (!tg) { api.setMode(r.prevMode === 'weapon' ? 'chase' : r.prevMode); return; }
    if (look && look.zoom) r.weaponDist = clamp(r.weaponDist * Math.exp(0.1 * look.zoom), w.distMin, w.distMax);
    if (tg.updateWorldMatrix) tg.updateWorldMatrix(true, false);
    if (tg.matrixWorld) tg.matrixWorld.decompose(_wp, _wq, _ws); else _wp.copy(tg.position || _wp);
    if (!Number.isFinite(_wp.x + _wp.y + _wp.z)) return;
    _fwd.set(1, 0, 0).applyQuaternion(_wq);
    if (!r.wpInit) {
      r.wpDir.copy(_vel.lengthSq() > 25 ? _wd.copy(_vel).normalize() : _fwd);
      r.wpPrev.copy(_wp); r.wpOff.copy(r.wpDir).multiplyScalar(-r.weaponDist); r.wpOff.y += w.up; r.wpInit = true;
    } else if (dt > 1e-6) {
      _tmp.copy(_wp).sub(r.wpPrev);
      const sp = _tmp.length() / dt;
      if (sp > w.minSpeed && sp < 5000) {
        _tmp.multiplyScalar(1 / (sp * dt));
        r.wpDir.lerp(_tmp, 1 - Math.exp(-w.dirRate * Math.min(dt, 0.1))).normalize();
      } else r.wpDir.lerp(_fwd, 1 - Math.exp(-w.dirRate * Math.min(dt, 0.1))).normalize();
      r.wpPrev.copy(_wp);
    }
    // se suaviza el DESFASE respecto del misil (no la posición absoluta): así no queda rezagado a alta velocidad
    _tmp.copy(r.wpDir).multiplyScalar(-r.weaponDist); _tmp.y += w.up;
    r.wpOff.lerp(_tmp, 1 - Math.exp(-w.followRate * Math.min(dt, 0.1)));
    r.wpPos.copy(_wp).add(r.wpOff);
    if (!Number.isFinite(r.wpPos.x + r.wpPos.y + r.wpPos.z)) { r.wpInit = false; return; }
    const floor = ground(r.wpPos.x, r.wpPos.z) + w.clearance;
    if (r.wpPos.y < floor) r.wpPos.y = floor;
    camera.position.copy(r.wpPos);
    _tmp.copy(_wp).addScaledVector(r.wpDir, w.aheadM);
    camera.lookAt(_tmp);
    setFov(r.baseFov);
  };

  const modeAvailable = (m) => CAMERA_MODES.includes(m) && (m !== 'weapon' || !!r.weaponTarget);

  const api = {
    get mode() { return r.mode; },
    get distance() { return r.chaseDist; },
    get worldPosition() { return r.wPos; },
    options: o,
    get hasWeaponTarget() { return !!r.weaponTarget; },
    /**
     * Objeto 3D del último Maverick lanzado (o null al terminar su vuelo). El modo 'weapon' solo existe mientras haya blanco:
     * entra en el ciclo de next(); con null, si estaba activo vuelve al modo anterior. opts.switchTo = true pasa a 'weapon' ya.
     */
    setWeaponTarget(obj, opts = {}) {
      r.weaponTarget = obj || null; r.wpInit = false; r.weaponDist = o.weapon.dist;
      if (!r.weaponTarget) { if (r.mode === 'weapon') api.setMode(r.prevMode === 'weapon' ? 'chase' : r.prevMode); }
      else if (opts && opts.switchTo) api.setMode('weapon');
      return r.mode;
    },
    setMode(m) {
      if (!modeAvailable(m) || m === r.mode) return r.mode;
      if (r.mode !== 'weapon') r.prevMode = r.mode;
      r.mode = m; r.wpInit = false;
      r.lookYaw = 0; r.lookPitch = 0; r.sinceLook = 99;
      r.chaseInit = false; r.wInit = false; r.wFov = r.wFov || 40;
      r.zoomK = 1;
      setFov(r.baseFov);
      if (onModeChange) { try { onModeChange(m); } catch { /* el callback no debe romper la cámara */ } }
      return m;
    },
    /** Siguiente modo del ciclo pilot → chase → world → (weapon, solo si hay misil) → pilot. */
    next() {
      const n = CAMERA_MODES.length, i0 = CAMERA_MODES.indexOf(r.mode);
      for (let k = 1; k <= n; k++) { const m = CAMERA_MODES[(i0 + k) % n]; if (modeAvailable(m)) return api.setMode(m); }
      return r.mode;
    },
    /** Reubica la cámara de mundo adelante de la trayectoria (tecla T). */
    relocate() { r.wForce = true; },
    /** Fuerza reinicialización (p. ej. al reiniciar el vuelo). */
    snap() { r.chaseInit = false; r.wInit = false; r.wpInit = false; r.lookYaw = 0; r.lookPitch = 0; },
    setWorld(w) { world_ = w; },
    setAircraft(a) { aircraft_ = a; },
    update(dt, state, inputLook) {
      if (!camera) return;
      dt = fin(dt, 0.016); if (dt < 0) dt = 0; if (dt > 0.25) dt = 0.25;
      r.time += dt;
      readPose(state);
      if (r.mode === 'pilot') updatePilot(dt, state, inputLook);
      else if (r.mode === 'chase') updateChase(dt, state, inputLook);
      else if (r.mode === 'weapon') updateWeapon(dt, state, inputLook);
      else updateWorld(dt, state, inputLook);
    },
  };
  return api;
}
