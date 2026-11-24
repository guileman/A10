// Modelo 3D del Harrier (GLB por partes) articulado con el estado de la física.
import { Group, Vector3, Quaternion, Matrix4, GLTFLoader } from 'three';
import GLB_B64 from '../../assets/harrier.glb';

const D2R = Math.PI / 180;
function b64ToBuf(s) { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; }

export function loadHarrierModel() {
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(b64ToBuf(GLB_B64), '', (gltf) => resolve(new HarrierModel(gltf.scene)), reject);
  });
}

/** Marco del grupo = marco cuerpo con origen en el origen del CAD (x proa, y arriba, z derecha). */
export class HarrierModel {
  constructor(root) {
    this.group = new Group(); this.group.name = 'harrier';
    this.root = root; this.group.add(root);
    this.parts = {}; root.traverse((o) => { if (o.name) this.parts[o.name] = o; });
    this.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
    // posición base (pivote) de cada parte
    for (const n in this.parts) { const p = this.parts[n]; p._base = p.position.clone(); }
    // unidades de tren: [pierna, ruedas], con sus pivotes superiores
    this.units = {
      nose: { leg: 'NoseGearLeg', wheels: ['NoseWheel'], retract: [0, 0, -1], deg: 95, steer: true },
      main: { leg: 'MainGearLeg', wheels: ['MainWheelL', 'MainWheelR'], retract: [0, 0, 1], deg: 95 },
      outriggerL: { leg: 'OutriggerLegL', wheels: ['OutriggerWheelL'], retract: [1, 0, 0], deg: 90 },
      outriggerR: { leg: 'OutriggerLegR', wheels: ['OutriggerWheelR'], retract: [-1, 0, 0], deg: 90 },
    };
    this.eyeLocal = new Vector3(3.762, 0.502, 0);
    this._q = new Quaternion(); this._v = new Vector3();
    for (const n of ['NozzleFront', 'NozzleRear']) if (this.parts[n]) this.parts[n].rotation.order = 'XYZ';
    this.missing = ['NoseWheel', 'NoseGearLeg', 'MainWheelL', 'MainWheelR', 'MainGearLeg', 'OutriggerLegL', 'OutriggerLegR', 'OutriggerWheelL', 'OutriggerWheelR', 'NozzleFront', 'NozzleRear'].filter((n) => !this.parts[n]);
  }
  /** Modo VR: oculta el tren (el piloto no lo ve desde la cabina) para ahorrar ~65 mil triángulos por ojo. */
  setLite(on) {
    for (const u of Object.values(this.units)) for (const n of [u.leg, ...u.wheels]) if (this.parts[n]) this.parts[n].visible = !on;
  }
  setEye(v) { if (Array.isArray(v)) this.eyeLocal.set(v[0], v[1], v[2]); }
  /** Coloca el grupo: el origen del CAD queda en pos - R·cg (pos = CG en el mundo). */
  update(state, cg) {
    const g = this.group, q = state.quat;
    this._q.set(q[0], q[1], q[2], q[3]); g.quaternion.copy(this._q);
    this._v.set(cg[0], cg[1], cg[2]).applyQuaternion(this._q);
    g.position.set(state.pos[0] - this._v.x, state.pos[1] - this._v.y, state.pos[2] - this._v.z);
    g.updateMatrixWorld(true);
    // toberas: la geometría CAD está dibujada a 90° (hacia abajo); ángulo físico 0 = atrás
    const th = ((state.nozzles && state.nozzles.angleDeg) || 0) - 90;
    for (const n of ['NozzleFront', 'NozzleRear']) { const p = this.parts[n]; if (p) p.rotation.z = th * D2R; }
    // tren
    const ext = state.gear ? (state.gear.extension ?? (state.gear.state === 'up' ? 0 : 1)) : 1;
    const units = state.gear && state.gear.units ? state.gear.units : [];
    for (const id in this.units) {
      const u = this.units[id], leg = this.parts[u.leg], st = units.find((x) => x.id === id);
      const comp = st ? st.compression || 0 : 0;
      const fold = (1 - ext) * u.deg * D2R;
      const all = [leg, ...u.wheels.map((w) => this.parts[w])].filter(Boolean);
      for (const p of all) {
        p.visible = ext > 0.02;
        p.position.copy(p._base);
        p.rotation.set(0, 0, 0);
      }
      // la rueda sube con la compresión del amortiguador (carrera vertical en el marco cuerpo)
      for (const w of u.wheels) { const p = this.parts[w]; if (p) { p.position.y += comp; p.rotation.order = 'YZX'; p.rotation.y = (st && u.steer ? (st.steerDeg || 0) * D2R : 0); p.rotation.z = -(st ? st.spinRad || 0 : 0); } }
      if (leg && u.steer && st) { leg.rotation.y = (st.steerDeg || 0) * D2R; }
      if (fold > 1e-3) for (const p of all) { // pliegue alrededor del punto de anclaje superior de la pierna
        const piv = leg ? leg._base : p._base; const rel = this._v.copy(p._base).sub(piv);
        const ax = u.retract; // eje de giro
        const axis = new Vector3(ax[0], ax[1], ax[2]); const qq = new Quaternion().setFromAxisAngle(axis, fold);
        rel.applyQuaternion(qq); p.position.copy(piv).add(rel); p.quaternion.premultiply(qq);
      }
    }
  }
}
