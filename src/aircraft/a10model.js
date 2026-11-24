// Modelo 3D del A-10 (GLB por partes) articulado con el estado de la física.
// Marco del grupo = marco cuerpo con origen en el origen del modelo (x proa, y arriba, z derecha).
import { Group, Vector3, Quaternion } from 'three';
import GLB_B64 from '../../assets/a10.glb';

const D2R = Math.PI / 180;
function b64ToBuf(s) { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; }

export function loadA10Model(GLTFLoader) {
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(b64ToBuf(GLB_B64), '', (gltf) => resolve(new A10Model(gltf.scene)), reject);
  });
}

export class A10Model {
  constructor(root) {
    this.group = new Group(); this.group.name = 'a10';
    this.root = root; this.group.add(root);
    this.parts = {}; root.traverse((o) => { if (o.name) this.parts[o.name] = o; });
    root.traverse((o) => {
      if (o.userData && o.userData.hidden) o.visible = false;
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; }
      if (o.isMesh && o.material && /glass/i.test(o.material.name || o.name)) { o.material.transparent = true; o.material.opacity = Math.min(o.material.opacity ?? 1, 0.28); o.material.depthWrite = false; o.castShadow = false; }
    });
    for (const n in this.parts) { const p = this.parts[n]; p._bq = p.quaternion.clone(); p._bp = p.position.clone(); }
    const tpl = this.parts.AGM65;
    this.maverickTemplate = tpl || null;
    this.eyeLocal = new Vector3(4.072, 1.184, 0);
    this._q = new Quaternion(); this._v = new Vector3(); this._qa = new Quaternion(); this._ax = new Vector3();
    this.pylonMeshes = [];
    this.firstPerson = false;
  }
  /** Gira la parte `name` un ángulo (°) alrededor del eje guardado en userData.axis (en su marco), sobre su orientación base. */
  _turn(name, deg) {
    const p = this.parts[name]; if (!p) return;
    const ax = (p.userData && p.userData.axis) || [0, 0, 1];
    this._ax.set(ax[0], ax[1], ax[2]).normalize();
    this._qa.setFromAxisAngle(this._ax, deg * D2R);
    p.quaternion.copy(p._bq).multiply(this._qa);
  }
  setEye(v) { if (Array.isArray(v)) this.eyeLocal.set(v[0], v[1], v[2]); }
  /** En primera persona se oculta la figura del piloto (la cámara está dentro de su casco). */
  setFirstPerson(on) { this.firstPerson = !!on; if (this.parts.Pilot) this.parts.Pilot.visible = !on; }
  setLite(on) { for (const n of ['NoseGear', 'NoseGearLinks', 'NoseGearDoor', 'MainGearL', 'MainGearR', 'MainGearBraceL', 'MainGearBraceR']) if (this.parts[n]) this.parts[n].visible = !on; this._lite = !!on; }

  /** Cuelga Mavericks en las estaciones (lista de {station, pos, loaded}). */
  setPylons(pylons) {
    for (const m of this.pylonMeshes) m.parent && m.parent.remove(m);
    this.pylonMeshes = [];
    if (!this.maverickTemplate) return;
    for (const p of pylons) {
      const m = this.maverickTemplate.clone(true); m.visible = true;
      m.traverse((o) => { o.visible = true; });
      m.quaternion.identity(); m.position.set(p.pos[0], p.pos[1] - 0.1525, p.pos[2]);
      this.root.add(m); m.userData.pylon = p; this.pylonMeshes.push(m);
    }
  }

  update(state, cg) {
    const g = this.group, q = state.quat;
    this._q.set(q[0], q[1], q[2], q[3]); g.quaternion.copy(this._q);
    this._v.set(cg[0], cg[1], cg[2]).applyQuaternion(this._q);
    g.position.set(state.pos[0] - this._v.x, state.pos[1] - this._v.y, state.pos[2] - this._v.z);

    // superficies de mando (grados, signos según parts.json: + = borde de fuga abajo / a la derecha)
    const cs = state.controlSurfaces || {};
    const ele = cs.elevatorDeg ?? 0, rud = cs.rudderDeg ?? 0, flap = cs.flapsDeg ?? 0;
    this._turn('AileronL', cs.aileronLDeg ?? 0); this._turn('AileronR', cs.aileronRDeg ?? 0);
    this._turn('ElevatorL', ele); this._turn('ElevatorR', ele);
    this._turn('RudderL', rud); this._turn('RudderR', rud);
    for (const n of ['FlapInnerL', 'FlapInnerR', 'FlapOuterL', 'FlapOuterR']) this._turn(n, flap);

    // tren: 0 = abajo; retracción hacia adelante. Ruedas giran según la velocidad del suelo.
    const gear = state.gear || {};
    const ext = gear.extension ?? (gear.state === 'up' ? 0 : 1);
    const units = gear.units || [];
    const nose = units.find((u) => u.id === 'nose'), mL = units.find((u) => u.id === 'mainL'), mR = units.find((u) => u.id === 'mainR');
    const showLegs = ext > 0.01 && !this._lite;
    this._turn('NoseGear', (1 - ext) * 90); this._turn('MainGearL', (1 - ext) * 88); this._turn('MainGearR', (1 - ext) * 88);
    this._turn('NoseGearDoor', ext > 0.02 ? 0 : 90);
    for (const n of ['NoseGear', 'MainGearL', 'MainGearR', 'NoseGearDoor']) if (this.parts[n]) this.parts[n].visible = showLegs || n === 'NoseGearDoor';
    for (const n of ['NoseGearLinks', 'MainGearBraceL', 'MainGearBraceR']) if (this.parts[n]) this.parts[n].visible = ext > 0.6 && !this._lite;
    const spin = (name, u, r) => {
      const p = this.parts[name]; if (!p) return;
      const ang = u ? (u.spinRad || 0) : 0;
      this._qa.setFromAxisAngle(this._ax.set(0, 0, 1), -ang); p.quaternion.copy(p._bq).multiply(this._qa);
      p.position.copy(p._bp); if (u && u.compression) p.position.y += u.compression;
    };
    spin('NoseWheel', nose, 0.236); spin('MainWheelL', mL, 0.336); spin('MainWheelR', mR, 0.336);
    if (nose && this.parts.NoseGear && nose.steerDeg) { this._qa.setFromAxisAngle(this._ax.set(0, 1, 0), nose.steerDeg * D2R); this.parts.NoseGear.quaternion.multiply(this._qa); }

    // Mavericks colgados
    for (const m of this.pylonMeshes) m.visible = !!(m.userData.pylon && m.userData.pylon.loaded);
    g.updateMatrixWorld(true);
  }
}
