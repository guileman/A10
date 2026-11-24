// Armamento del A-10 a nivel de juego (sin DOM ni three): cañón de 30 mm con trazadoras, misil guiado
// simplificado y punto de impacto previsto (CCIP) para el HUD. Daño por puntos de vida, estilo arcade.

const G = 9.81;
const rot = (q, v, o = [0, 0, 0]) => {
  const [x, y, z, w] = q, [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  o[0] = vx + w * tx + (y * tz - z * ty); o[1] = vy + w * ty + (z * tx - x * tz); o[2] = vz + w * tz + (x * ty - y * tx);
  return o;
};
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export const GUN = {
  rounds: 1150, rate: 65, spinUp: 0.4, muzzleVel: 1000, decel: 3.0e-4 /* 1/m: caída exponencial de velocidad */,
  spread: 0.004, roundKg: 0.69, recoilN: 45000, damage: 10, maxLife: 6,
};
export const MISSILE = { massKg: 210, speed: 320, accel: 70, drop: 0.35, turnRate: 0.42 /* rad/s */, lockCone: 0.105 /* ~6° */, lockRange: 10000, lockTime: 0.6, hitR: 6, splashR: 16, damage: 260, life: 45 };

export class WeaponSystem {
  constructor({ geometry, mavericks = 4, seed = 3 } = {}) {
    this.geom = geometry || {};
    this.rnd = mulberry32(seed);
    this.muzzle = (this.geom.gun && this.geom.gun.muzzle) || [8.1, -0.72, 0];
    // estaciones para Mavericks: las exteriores primero (pares simétricos)
    const st = (this.geom.stations || []).filter((s) => s.id !== 'gunMuzzle' && Math.abs(s.pos[2]) > 1.5);
    st.sort((a, b) => Math.abs(a.pos[2]) - Math.abs(b.pos[2]));
    this.stations = st;
    this.reset({ mavericks });
  }
  reset({ mavericks = this.loadMav ?? 4 } = {}) {
    this.loadMav = mavericks;
    this.ammo = GUN.rounds; this.spin = 0; this.fireAcc = 0; this.firing = false;
    this.rounds = []; this.missiles = []; this.events = [];
    this.lockTarget = null; this.lockProgress = 0;
    // reparto alternado izquierda/derecha
    const n = Math.min(mavericks, this.stations.length || mavericks);
    this.pylons = [];
    for (let i = 0; i < n; i++) {
      const s = this.stations[i] || { id: 'st' + i, pos: [0.6, -0.9, (i % 2 ? 1 : -1) * (3 + i)] };
      this.pylons.push({ station: s.id, pos: s.pos.slice(), loaded: true });
    }
    this.nextPylon = 0;
  }
  missilesLeft() { return this.pylons.filter((p) => p.loaded).length; }
  stores() { return this.pylons.filter((p) => p.loaded).map((p) => ({ station: p.station, massKg: MISSILE.massKg, dCD: 0.0012 })); }

  _worldPoint(s, local, out) {
    const cg = s.cgModel || [0, 0, 0];
    rot(s.quat, [local[0] - cg[0], local[1] - cg[1], local[2] - cg[2]], out);
    out[0] += s.pos[0]; out[1] += s.pos[1]; out[2] += s.pos[2];
    return out;
  }

  /** Busca el blanco vivo más cercano al eje del avión (dentro del cono y alcance) y lo bloquea; si ya hay uno, pasa al siguiente. */
  lock(s, vehicles) {
    const fwd = rot(s.quat, [1, 0, 0]);
    const cands = [];
    for (const v of vehicles) {
      if (v.state === 'burning' || v.state === 'destroyed') continue;
      const dx = v.pos[0] - s.pos[0], dy = v.pos[1] + 1 - s.pos[1], dz = v.pos[2] - s.pos[2], d = Math.hypot(dx, dy, dz);
      if (d > MISSILE.lockRange) continue;
      const ang = Math.acos(Math.max(-1, Math.min(1, (dx * fwd[0] + dy * fwd[1] + dz * fwd[2]) / d)));
      if (ang < MISSILE.lockCone * 3.5) cands.push({ v, ang });
    }
    cands.sort((a, b) => a.ang - b.ang);
    if (!cands.length) { this.events.push({ type: 'lockFail' }); return null; }
    let pick = cands[0].v;
    if (this.lockTarget) { const i = cands.findIndex((c) => c.v === this.lockTarget); if (i >= 0) pick = cands[(i + 1) % cands.length].v; }
    if (pick !== this.lockTarget) this.lockProgress = 0;
    this.lockTarget = pick;
    this.events.push({ type: 'lock', vehicle: pick });
    return pick;
  }
  unlock() { this.lockTarget = null; this.lockProgress = 0; }

  /** Lanza un misil hacia el blanco bloqueado (si el bloqueo está completo). */
  fireMissile(s) {
    if (!this.lockTarget || this.lockProgress < 1) { this.events.push({ type: 'noLock' }); return false; }
    const p = this.pylons.find((q) => q.loaded);
    if (!p) { this.events.push({ type: 'noMissiles' }); return false; }
    p.loaded = false;
    const pos = this._worldPoint(s, p.pos, [0, 0, 0]);
    const dir = rot(s.quat, [1, 0, 0]);
    this.missiles.push({ pos, vel: s.vel.slice(), dir, t: 0, target: this.lockTarget, alive: true, pylon: p, trail: 0 });
    this.events.push({ type: 'missileLaunch', pos: pos.slice(), pylon: p.station });
    return true;
  }

  /** Punto de impacto previsto de una ráfaga disparada ahora (para el pipper del HUD). */
  ccipGun(s, world, out = [0, 0, 0]) {
    const p = this._worldPoint(s, this.muzzle, [0, 0, 0]);
    const d = rot(s.quat, [1, 0, 0]);
    let vx = s.vel[0] + d[0] * GUN.muzzleVel, vy = s.vel[1] + d[1] * GUN.muzzleVel, vz = s.vel[2] + d[2] * GUN.muzzleVel;
    const h = 0.02;
    for (let i = 0; i < 300; i++) {
      const sp = Math.hypot(vx, vy, vz), k = Math.exp(-GUN.decel * sp * h);
      vx *= k; vz *= k; vy = vy * k - G * h;
      const nx = p[0] + vx * h, ny = p[1] + vy * h, nz = p[2] + vz * h;
      const gh = world.height(nx, nz);
      if (ny <= gh) { out[0] = nx; out[1] = gh; out[2] = nz; out.t = i * h; return out; }
      p[0] = nx; p[1] = ny; p[2] = nz;
    }
    return null;
  }

  /**
   * step(dt, s, controls, world, convoy, sim)
   * s: getState() del avión; controls.triggerGun; convoy: createConvoy(); sim: A10Sim (retroceso, masa).
   */
  step(dt, s, controls, world, convoy, sim) {
    const want = !!(controls && controls.triggerGun) && this.ammo > 0 && !(s.flags && s.flags.crashed);
    this.spin = Math.max(0, Math.min(1, this.spin + (want ? dt / GUN.spinUp : -dt / 0.6)));
    const firing = want && this.spin > 0.75;
    if (firing !== this.firing && sim) {
      if (firing) sim.setExternalForce('gunRecoil', { forceBody: [-GUN.recoilN, 0, 0], vibration: { frac: 0.3, hz: GUN.rate } });
      else sim.clearExternalForce('gunRecoil');
      this.events.push({ type: firing ? 'gunStart' : 'gunStop' });
    }
    this.firing = firing;
    if (firing) {
      this.fireAcc += dt * GUN.rate;
      const d = rot(s.quat, [1, 0, 0]), up = rot(s.quat, [0, 1, 0]), rt = rot(s.quat, [0, 0, 1]);
      const m0 = this._worldPoint(s, this.muzzle, [0, 0, 0]);
      while (this.fireAcc >= 1 && this.ammo > 0) {
        this.fireAcc -= 1; this.ammo--;
        const a = this.rnd() * Math.PI * 2, r = GUN.spread * Math.sqrt(this.rnd());
        const ex = Math.cos(a) * r, ey = Math.sin(a) * r;
        const dir = [d[0] + up[0] * ey + rt[0] * ex, d[1] + up[1] * ey + rt[1] * ex, d[2] + up[2] * ey + rt[2] * ex];
        // avance sub-cuadro para que la ráfaga no salga "en bloque"
        const lead = this.rnd() * dt;
        this.rounds.push({
          pos: [m0[0] + s.vel[0] * lead, m0[1] + s.vel[1] * lead, m0[2] + s.vel[2] * lead],
          vel: [s.vel[0] + dir[0] * GUN.muzzleVel, s.vel[1] + dir[1] * GUN.muzzleVel, s.vel[2] + dir[2] * GUN.muzzleVel],
          t: 0, prev: m0.slice(),
        });
      }
      if (sim && (this._ammoSync = (this._ammoSync || 0) + dt) > 0.5) { this._ammoSync = 0; sim.setAmmoKg(this.ammo * GUN.roundKg); }
    } else this.fireAcc = Math.min(this.fireAcc, 1);
    if (this.ammo <= 0 && this.firing === false && want === false) { /* sin munición */ }

    const vehicles = convoy ? convoy.vehicles : [];
    this._stepRounds(dt, world, convoy, vehicles);
    this._stepMissiles(dt, world, convoy, vehicles, s);

    // bloqueo: avanza mientras el blanco siga vivo, en alcance y delante del avión
    if (this.lockTarget) {
      const v = this.lockTarget;
      const dx = v.pos[0] - s.pos[0], dy = v.pos[1] - s.pos[1], dz = v.pos[2] - s.pos[2], d = Math.hypot(dx, dy, dz);
      const f = rot(s.quat, [1, 0, 0]), cos = (dx * f[0] + dy * f[1] + dz * f[2]) / (d || 1);
      if (v.state === 'burning' || v.state === 'destroyed' || d > MISSILE.lockRange * 1.3 || cos < 0.5) this.unlock();
      else this.lockProgress = Math.min(1, this.lockProgress + dt / MISSILE.lockTime);
    }
    if (sim && this._lastMav !== this.missilesLeft()) { this._lastMav = this.missilesLeft(); sim.setStores(this.stores()); }
  }

  _stepRounds(dt, world, convoy, vehicles) {
    const R = this.rounds;
    for (let i = R.length - 1; i >= 0; i--) {
      const r = R[i];
      r.t += dt;
      let sub = Math.max(1, Math.ceil(dt / 0.02)), h = dt / sub, dead = false;
      for (let k = 0; k < sub && !dead; k++) {
        const p = r.pos, v = r.vel;
        const sp = Math.hypot(v[0], v[1], v[2]), f = Math.exp(-GUN.decel * sp * h);
        v[0] *= f; v[2] *= f; v[1] = v[1] * f - G * h;
        const nx = p[0] + v[0] * h, ny = p[1] + v[1] * h, nz = p[2] + v[2] * h;
        // vehículos: segmento contra esfera
        for (const veh of vehicles) {
          if (veh.state === 'destroyed') continue;
          const cy = veh.pos[1] + 1.2;
          const ax = p[0] - veh.pos[0], ay = p[1] - cy, az = p[2] - veh.pos[2];
          const bx = nx - p[0], by = ny - p[1], bz = nz - p[2];
          const L2 = bx * bx + by * by + bz * bz;
          let t = -(ax * bx + ay * by + az * bz) / (L2 || 1); t = t < 0 ? 0 : t > 1 ? 1 : t;
          const qx = ax + bx * t, qy = ay + by * t, qz = az + bz * t;
          if (qx * qx + qy * qy * 2 + qz * qz < veh.radius * veh.radius) {
            const hp = [p[0] + bx * t, p[1] + by * t, p[2] + bz * t];
            if (convoy) convoy.damage(veh, GUN.damage, 'gun');
            this.events.push({ type: 'hit', pos: hp, vehicle: veh });
            dead = true; break;
          }
        }
        if (dead) break;
        const gh = world.height(nx, nz);
        if (ny <= gh) {
          this.events.push({ type: 'impact', pos: [nx, gh, nz], surface: world.surface ? world.surface(nx, nz) : 0 });
          // esquirlas: daño menor a vehículos muy cercanos (ráfaga que "camina" sobre el blanco)
          for (const veh of vehicles) {
            if (veh.state === 'destroyed' || veh.state === 'burning') continue;
            const d = Math.hypot(veh.pos[0] - nx, veh.pos[2] - nz);
            if (d < veh.radius + 2.5 && convoy) convoy.damage(veh, GUN.damage * 0.25, 'gun');
          }
          dead = true; break;
        }
        r.prev[0] = p[0]; r.prev[1] = p[1]; r.prev[2] = p[2];
        p[0] = nx; p[1] = ny; p[2] = nz;
      }
      if (dead || r.t > GUN.maxLife) { R[i] = R[R.length - 1]; R.pop(); }
    }
  }

  _stepMissiles(dt, world, convoy, vehicles, s) {
    for (const m of this.missiles) {
      if (!m.alive) continue;
      m.t += dt;
      const v = m.vel;
      if (m.t < MISSILE.drop) { v[1] -= G * dt; }
      else {
        const sp = Math.hypot(v[0], v[1], v[2]) || 1;
        const tgt = m.target;
        let want = [v[0] / sp, v[1] / sp, v[2] / sp];
        if (tgt && tgt.state !== 'destroyed') {
          // persecución con adelanto simple (posición futura del blanco)
          const tx = tgt.pos[0], ty = tgt.pos[1] + 1.2, tz = tgt.pos[2];
          const dx = tx - m.pos[0], dy = ty - m.pos[1], dz = tz - m.pos[2], d = Math.hypot(dx, dy, dz) || 1;
          const tgo = d / Math.max(sp, 100);
          const hx = Math.sin(tgt.heading) * tgt.speed, hz = Math.cos(tgt.heading) * tgt.speed;
          const lx = dx + hx * tgo, ly = dy + 0.5 * G * tgo * tgo * 0.3, lz = dz + hz * tgo, ll = Math.hypot(lx, ly, lz) || 1;
          want = [lx / ll, ly / ll, lz / ll];
        }
        // girar la dirección hacia "want" con límite de velocidad angular
        const cur = [v[0] / sp, v[1] / sp, v[2] / sp];
        const dot = Math.max(-1, Math.min(1, cur[0] * want[0] + cur[1] * want[1] + cur[2] * want[2]));
        const ang = Math.acos(dot), maxA = MISSILE.turnRate * dt;
        let nd = want;
        if (ang > maxA && ang > 1e-6) {
          const t = maxA / ang;
          nd = [cur[0] + (want[0] - cur[0]) * t, cur[1] + (want[1] - cur[1]) * t, cur[2] + (want[2] - cur[2]) * t];
          const l = Math.hypot(nd[0], nd[1], nd[2]) || 1; nd = [nd[0] / l, nd[1] / l, nd[2] / l];
        }
        const nsp = Math.min(MISSILE.speed, sp + MISSILE.accel * dt);
        v[0] = nd[0] * nsp; v[1] = nd[1] * nsp; v[2] = nd[2] * nsp;
        m.dir = nd; m.motor = m.t < MISSILE.drop + 4;
      }
      const np = [m.pos[0] + v[0] * dt, m.pos[1] + v[1] * dt, m.pos[2] + v[2] * dt];
      // impacto: blanco o suelo
      let boom = null;
      for (const veh of vehicles) {
        if (veh.state === 'destroyed') continue;
        const d = Math.hypot(np[0] - veh.pos[0], np[1] - (veh.pos[1] + 1.2), np[2] - veh.pos[2]);
        if (d < MISSILE.hitR) { boom = np; break; }
      }
      const gh = world.height(np[0], np[2]);
      if (!boom && np[1] <= gh) boom = [np[0], gh, np[2]];
      m.pos = np;
      if (boom || m.t > MISSILE.life) {
        m.alive = false;
        if (boom) this._explode(boom, convoy, vehicles);
      }
    }
    this.missiles = this.missiles.filter((m) => m.alive || m.t < 0);
  }

  _explode(p, convoy, vehicles) {
    this.events.push({ type: 'explosion', pos: p.slice(), size: 1 });
    for (const veh of vehicles) {
      if (veh.state === 'destroyed') continue;
      const d = Math.hypot(p[0] - veh.pos[0], p[1] - veh.pos[1] - 1.2, p[2] - veh.pos[2]);
      if (d < MISSILE.splashR && convoy) convoy.damage(veh, MISSILE.damage * (d < MISSILE.hitR ? 1 : 0.6 * (1 - d / MISSILE.splashR)), 'missile');
    }
  }

  getState() {
    return {
      ammo: this.ammo, spin: this.spin, firing: this.firing,
      missilesLeft: this.missilesLeft(), locked: !!this.lockTarget && this.lockProgress >= 1, lockProgress: this.lockProgress,
      lockTarget: this.lockTarget, rounds: this.rounds, missiles: this.missiles,
    };
  }
  drainEvents() { return this.events.splice(0, this.events.length); }
}
