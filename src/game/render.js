// Parte visual del combate: vehículos del convoy (geometría procedural), trazadoras, misiles, impactos, explosiones y humo.
import {
  Group, Mesh, BoxGeometry, CylinderGeometry, MeshStandardMaterial, BufferGeometry, BufferAttribute, LineSegments,
  LineBasicMaterial, AdditiveBlending, NormalBlending, Sprite, SpriteMaterial, CanvasTexture, Color, Object3D, Vector3,
} from 'three';

function radialTex(stops) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new CanvasTexture(c); return t;
}

const OLIVE = new MeshStandardMaterial({ color: 0x4b5232, roughness: 0.9, metalness: 0.1 });
const OLIVE_D = new MeshStandardMaterial({ color: 0x353a24, roughness: 0.95 });
const SAND = new MeshStandardMaterial({ color: 0x6e6446, roughness: 0.95 });
const BURNT = new MeshStandardMaterial({ color: 0x1a1816, roughness: 1 });
const TRACK = new MeshStandardMaterial({ color: 0x222222, roughness: 1 });

function box(w, h, l, m, x = 0, y = 0, z = 0) { const o = new Mesh(new BoxGeometry(w, h, l), m); o.position.set(x, y, z); o.castShadow = true; return o; }
function cyl(r, l, m, seg = 10) { const o = new Mesh(new CylinderGeometry(r, r, l, seg), m); o.castShadow = true; return o; }

/** Vehículo con el eje +z hacia adelante (heading del convoy = atan2(dx, dz)). */
export function buildVehicle(type) {
  const g = new Group(), parts = [];
  const add = (o) => { g.add(o); parts.push(o); return o; };
  if (type === 'tank') {
    add(box(3.5, 0.9, 6.8, TRACK, 0, 0.5, 0));
    add(box(3.3, 0.8, 6.6, OLIVE, 0, 1.25, 0));
    const tur = new Group(); tur.position.set(0, 1.95, -0.3); g.add(tur);
    const t = box(2.3, 0.75, 2.8, OLIVE_D); tur.add(t); parts.push(t);
    const b = cyl(0.09, 5.2, OLIVE_D, 8); b.rotation.x = Math.PI / 2; b.position.set(0, 0.05, 3.6); tur.add(b); parts.push(b);
    g.userData.turret = tur;
  } else if (type === 'apc') {
    for (const s of [-1, 1]) for (const z of [-2.2, -0.7, 0.8, 2.3]) { const w = cyl(0.55, 0.4, TRACK, 12); w.rotation.z = Math.PI / 2; w.position.set(s * 1.45, 0.55, z); add(w); }
    add(box(2.9, 1.4, 6.6, OLIVE, 0, 1.45, 0));
    const f = box(2.9, 0.8, 1.2, OLIVE, 0, 1.0, 3.6); f.rotation.x = -0.5; add(f);
    const tur = new Group(); tur.position.set(0, 2.3, 0.4); g.add(tur);
    const t = cyl(0.65, 0.5, OLIVE_D, 10); tur.add(t); parts.push(t);
    const b = cyl(0.05, 2.4, OLIVE_D, 6); b.rotation.x = Math.PI / 2; b.position.set(0, 0.1, 1.4); tur.add(b); parts.push(b);
    g.userData.turret = tur;
  } else {
    for (const s of [-1, 1]) for (const z of [-2.4, -1.2, 2.3]) { const w = cyl(0.5, 0.35, TRACK, 12); w.rotation.z = Math.PI / 2; w.position.set(s * 1.05, 0.5, z); add(w); }
    add(box(2.3, 0.35, 7.0, OLIVE_D, 0, 0.95, 0));
    add(box(2.4, 1.5, 1.9, OLIVE, 0, 1.85, 2.4));
    add(box(2.45, 1.8, 4.6, SAND, 0, 2.05, -1.0));
  }
  g.userData.parts = parts;
  return g;
}

/** Sistema de partículas simple con sprites (fuego, humo, polvo, chispas). */
class Particles {
  constructor(parent, max, tex, additive) {
    this.list = []; this.pool = [];
    this.parent = parent; this.tex = tex; this.additive = additive; this.max = max;
  }
  spawn(p, { vel = [0, 0, 0], life = 1, size0 = 1, size1 = 3, color = 0xffffff, alpha = 1, rise = 0, drag = 0.5 }) {
    if (this.list.length >= this.max) return;
    let s = this.pool.pop();
    if (!s) {
      s = new Sprite(new SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false, blending: this.additive ? AdditiveBlending : NormalBlending }));
      s.renderOrder = this.additive ? 3 : 2; this.parent.add(s);
    }
    s.visible = true; s.position.set(p[0], p[1], p[2]); s.material.color.set(color);
    s.userData = { vel: vel.slice(), life, t: 0, size0, size1, alpha, rise, drag };
    this.list.push(s);
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i], u = s.userData; u.t += dt;
      const k = u.t / u.life;
      if (k >= 1) { s.visible = false; this.pool.push(s); this.list[i] = this.list[this.list.length - 1]; this.list.pop(); continue; }
      const f = Math.exp(-u.drag * dt);
      u.vel[0] *= f; u.vel[2] *= f; u.vel[1] = u.vel[1] * f + u.rise * dt;
      s.position.x += u.vel[0] * dt; s.position.y += u.vel[1] * dt; s.position.z += u.vel[2] * dt;
      const sz = u.size0 + (u.size1 - u.size0) * Math.sqrt(k); s.scale.set(sz, sz, 1);
      s.material.opacity = u.alpha * (1 - k) * Math.min(1, u.t * 12);
    }
  }
}

export function createCombatView(scene, { maverickTemplate = null } = {}) {
  const root = new Group(); root.name = 'combat'; scene.add(root);
  const texFire = radialTex([[0, 'rgba(255,250,220,1)'], [0.25, 'rgba(255,190,80,0.9)'], [0.6, 'rgba(220,80,20,0.4)'], [1, 'rgba(120,20,0,0)']]);
  const texSmoke = radialTex([[0, 'rgba(255,255,255,0.75)'], [0.5, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']]);
  const fire = new Particles(root, 500, texFire, true);
  const smoke = new Particles(root, 1100, texSmoke, false);

  // trazadoras: segmentos con brillo aditivo
  const MAXR = 900;
  const tPos = new Float32Array(MAXR * 6), tCol = new Float32Array(MAXR * 6);
  const tGeo = new BufferGeometry(); tGeo.setAttribute('position', new BufferAttribute(tPos, 3)); tGeo.setAttribute('color', new BufferAttribute(tCol, 3));
  const tracers = new LineSegments(tGeo, new LineBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false }));
  tracers.frustumCulled = false; tracers.renderOrder = 4; root.add(tracers);

  const vehMeshes = new Map();
  const missileMeshes = new Map();
  function missileMesh() {
    if (maverickTemplate) { const m = maverickTemplate.clone(true); m.visible = true; return m; }
    const g = new Group(); const b = cyl(0.15, 2.5, new MeshStandardMaterial({ color: 0xc8c8be, roughness: 0.6 }), 10); b.rotation.z = Math.PI / 2; g.add(b); return g;
  }

  const tmpV = new Vector3();
  const api = { root, fire, smoke };

  api.syncVehicles = (convoy) => {
    for (const v of convoy.vehicles) {
      let m = vehMeshes.get(v);
      if (!m) { m = buildVehicle(v.type); root.add(m); vehMeshes.set(v, m); m.userData.burnt = false; }
      m.position.set(v.pos[0], v.pos[1], v.pos[2]);
      m.rotation.set(0, v.heading, 0);
      if ((v.state === 'burning' || v.state === 'destroyed') && !m.userData.burnt) {
        m.userData.burnt = true;
        for (const p of m.userData.parts) p.material = BURNT;
        if (m.userData.turret) { m.userData.turret.rotation.set(0.25, 0.6, 0.1); m.userData.turret.position.y += 0.3; }
      }
    }
  };

  api.explosion = (p, size = 1) => {
    for (let i = 0; i < 14 * size; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 8 * size;
      fire.spawn([p[0], p[1] + 1, p[2]], { vel: [Math.cos(a) * r, 4 + Math.random() * 10 * size, Math.sin(a) * r], life: 0.6 + Math.random() * 0.5, size0: 3 * size, size1: 12 * size, color: 0xffffff, drag: 2 });
    }
    for (let i = 0; i < 10 * size; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 4;
      smoke.spawn([p[0], p[1] + 2, p[2]], { vel: [Math.cos(a) * r, 3 + Math.random() * 4, Math.sin(a) * r], life: 5 + Math.random() * 3, size0: 5 * size, size1: 22 * size, color: 0x2b2b2b, alpha: 0.8, rise: 1.5, drag: 0.6 });
    }
  };
  api.impact = (p, onVehicle) => {
    if (onVehicle) fire.spawn(p, { vel: [0, 2, 0], life: 0.12, size0: 1.5, size1: 3.5, color: 0xffe0a0, drag: 1 });
    else {
      // 30 mm HEI: destello, tierra levantada y humo
      if (Math.random() < 0.6) fire.spawn([p[0], p[1] + 0.5, p[2]], { vel: [0, 3, 0], life: 0.09, size0: 2.2, size1: 4, color: 0xffd090, drag: 1 });
      smoke.spawn(p, { vel: [(Math.random() - 0.5) * 3, 5 + Math.random() * 5, (Math.random() - 0.5) * 3], life: 2.4, size0: 2, size1: 10, color: 0x7d6c52, alpha: 0.8, rise: -2.0, drag: 1.4 });
    }
  };

  /**
   * Humo y fogonazo del GAU-8. muzzle/dir: boca del cañón y eje del avión en el mundo; vel: velocidad del avión.
   * Los gases salen hacia adelante a gran velocidad, el aire los frena en ~0,3 s y la nube queda atrás del avión:
   * a 300 kt pasa por debajo y a los costados de la cabina. intensity 0..1 escala la cantidad (VR: menos).
   */
  let gunAcc = 0, flashAcc = 0;
  api.gunFire = (dt, firing, muzzle, dir, vel, intensity = 1) => {
    if (!firing) { gunAcc = 0; return; }
    gunAcc += dt * 60 * intensity; flashAcc += dt;
    while (gunAcc >= 1) {
      gunAcc -= 1;
      const j = Math.random(), sp = 40 + Math.random() * 60, lat = 4;
      const p = [muzzle[0] - vel[0] * j * dt, muzzle[1] - vel[1] * j * dt, muzzle[2] - vel[2] * j * dt];
      smoke.spawn(p, {
        vel: [vel[0] * 0.55 + dir[0] * sp + (Math.random() - 0.5) * lat, vel[1] * 0.55 + dir[1] * sp + (Math.random() - 0.3) * lat, vel[2] * 0.55 + dir[2] * sp + (Math.random() - 0.5) * lat],
        life: 4 + Math.random() * 4, size0: 1.8, size1: 14 + Math.random() * 10, color: Math.random() < 0.5 ? 0x7a7872 : 0x5e5c58, alpha: 0.75, rise: 0.35, drag: 2.4,
      });
    }
    // fogonazo: destellos cortos pegados a la boca (se mueven con el avión)
    if (flashAcc > 0.03) {
      flashAcc = 0;
      fire.spawn([muzzle[0] + dir[0] * 1.2, muzzle[1] + dir[1] * 1.2, muzzle[2] + dir[2] * 1.2], { vel: vel.slice(), life: 0.045, size0: 1.6 + Math.random(), size1: 2.6, color: 0xffe6b0, drag: 0 });
    }
  };

  let burnAcc = 0;
  api.update = (dt, weapons, convoy) => {
    // trazadoras: cada proyectil como un segmento corto, fuego anaranjado
    const R = weapons.rounds; let n = 0;
    for (let i = 0; i < R.length && n < MAXR; i++) {
      const r = R[i], v = r.vel, sp = Math.hypot(v[0], v[1], v[2]) || 1, L = Math.min(18, sp * 0.02);
      const o = n * 6;
      tPos[o] = r.pos[0]; tPos[o + 1] = r.pos[1]; tPos[o + 2] = r.pos[2];
      tPos[o + 3] = r.pos[0] - v[0] / sp * L; tPos[o + 4] = r.pos[1] - v[1] / sp * L; tPos[o + 5] = r.pos[2] - v[2] / sp * L;
      tCol[o] = 1; tCol[o + 1] = 0.75; tCol[o + 2] = 0.35; tCol[o + 3] = 0.5; tCol[o + 4] = 0.2; tCol[o + 5] = 0.05;
      n++;
    }
    tGeo.setDrawRange(0, n * 2); tGeo.attributes.position.needsUpdate = true; tGeo.attributes.color.needsUpdate = true;

    // misiles en vuelo
    const alive = new Set();
    for (const m of weapons.missiles) {
      if (!m.alive) continue; alive.add(m);
      let mesh = missileMeshes.get(m);
      if (!mesh) { mesh = missileMesh(); root.add(mesh); missileMeshes.set(m, mesh); }
      mesh.position.set(m.pos[0], m.pos[1], m.pos[2]);
      const d = m.dir || [1, 0, 0];
      tmpV.set(m.pos[0] + d[0], m.pos[1] + d[1], m.pos[2] + d[2]);
      mesh.up.set(0, 1, 0); mesh.lookAt(tmpV); mesh.rotateY(-Math.PI / 2); // eje +x del modelo hacia adelante
      if (m.motor) {
        fire.spawn([m.pos[0] - d[0] * 1.6, m.pos[1] - d[1] * 1.6, m.pos[2] - d[2] * 1.6], { life: 0.08, size0: 1.6, size1: 0.6, color: 0xffd080, drag: 0 });
        smoke.spawn([m.pos[0] - d[0] * 2, m.pos[1] - d[1] * 2, m.pos[2] - d[2] * 2], { vel: [0, 0.5, 0], life: 3, size0: 1, size1: 6, color: 0xd8d8d8, alpha: 0.55, drag: 0.2 });
      }
    }
    for (const [m, mesh] of missileMeshes) if (!alive.has(m)) { root.remove(mesh); missileMeshes.delete(m); }

    // vehículos en llamas: columna de humo y fuego
    burnAcc += dt;
    if (burnAcc > 0.12) {
      burnAcc = 0;
      for (const v of convoy.vehicles) if (v.state === 'burning') {
        const k = Math.max(0.3, 1 - v.burnT / 45);
        fire.spawn([v.pos[0] + (Math.random() - 0.5) * 2, v.pos[1] + 1.8, v.pos[2] + (Math.random() - 0.5) * 2], { vel: [0, 3, 0], life: 0.7, size0: 2.5 * k, size1: 4 * k, color: 0xffffff, drag: 1 });
        smoke.spawn([v.pos[0], v.pos[1] + 3, v.pos[2]], { vel: [(Math.random() - 0.5), 4, (Math.random() - 0.5)], life: 9, size0: 3, size1: 18, color: 0x222222, alpha: 0.65 * k, rise: 0.8, drag: 0.4 });
      }
    }
    fire.update(dt); smoke.update(dt);
  };
  api.dispose = () => { scene.remove(root); };
  return api;
}

/** Proyecta un punto del mundo a coordenadas normalizadas de pantalla (-1..1, y arriba); null si queda detrás. */
export function toScreen(camera, p, out = {}) {
  const v = new Vector3(p[0], p[1], p[2]).applyMatrix4(camera.matrixWorldInverse);
  if (v.z > -1) return null;
  v.applyMatrix4(camera.projectionMatrix);
  out.x = v.x; out.y = v.y; return out;
}
