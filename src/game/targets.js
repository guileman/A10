// Convoy enemigo (lógica de juego, sin DOM ni three): vehículos que siguen una ruta pegados al terreno.
// Daño por puntos de vida simplificado (nivel arcade), no un modelo de efectos reales.

export const VEHICLE_TYPES = {
  tank:  { label: 'Tanque',      hp: 100, armor: 0.3, len: 6.9, wid: 3.6, hgt: 2.3, radius: 3.6 },
  apc:   { label: 'Blindado',    hp: 60,  armor: 0.7, len: 6.8, wid: 3.1, hgt: 2.3, radius: 3.4 },
  truck: { label: 'Camión',      hp: 28,  armor: 1.0, len: 7.2, wid: 2.5, hgt: 3.0, radius: 3.7 },
};

const MIXES = {
  blindados: ['tank', 'apc', 'tank', 'apc', 'tank'],
  mixto:     ['apc', 'tank', 'truck', 'truck', 'tank', 'apc', 'truck'],
  camiones:  ['truck', 'truck', 'apc', 'truck'],
};

function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Polilínea [[x,z],...] con longitud acumulada y muestreo por arco. */
export function makeRoute(points) {
  const P = points.map((p) => [p[0], p[1]]);
  const S = [0];
  for (let i = 1; i < P.length; i++) S.push(S[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const length = S[S.length - 1];
  function at(s, out = {}) {
    s = Math.max(0, Math.min(length, s));
    let i = 1; while (i < S.length - 1 && S[i] < s) i++;
    const seg = S[i] - S[i - 1] || 1, t = (s - S[i - 1]) / seg;
    const dx = P[i][0] - P[i - 1][0], dz = P[i][1] - P[i - 1][1], l = Math.hypot(dx, dz) || 1;
    out.x = P[i - 1][0] + dx * t; out.z = P[i - 1][1] + dz * t; out.tx = dx / l; out.tz = dz / l;
    return out;
  }
  return { points: P, length, at };
}

/**
 * createConvoy({ route:[[x,z]...], count, mix, seed, world:{height(x,z)}, speed, spacing })
 * Devuelve { vehicles, step(dt), damage(v, amount, kind), alive(), alerted, events }.
 */
export function createConvoy({ route, count = 8, mix = 'mixto', seed = 7, world, speed = 10, spacing = 38 } = {}) {
  const R = makeRoute(route);
  const rnd = mulberry32(seed);
  const order = MIXES[mix] || MIXES.mixto;
  const n = Math.max(1, Math.min(24, count | 0));
  const head0 = Math.min(R.length * 0.25 + n * spacing, R.length * 0.6);
  const vehicles = [];
  for (let i = 0; i < n; i++) {
    const type = order[(i + Math.floor(rnd() * 2)) % order.length];
    const T = VEHICLE_TYPES[type];
    vehicles.push({
      id: i, type, hp: T.hp, maxHp: T.hp, radius: T.radius,
      s: head0 - i * spacing, lat: 0, latTarget: 0,
      pos: [0, 0, 0], heading: 0, speed: 0, cruise: speed * (0.95 + rnd() * 0.1),
      state: 'moving', burnT: 0, hitT: 0,
    });
  }
  const events = [];
  const tmp = {};
  const c = { route: R, vehicles, events, alerted: false, alertT: 0 };

  function place(v) {
    R.at(v.s, tmp);
    // desplazamiento lateral (dispersión fuera del camino)
    const nx = -tmp.tz, nz = tmp.tx;
    v.pos[0] = tmp.x + nx * v.lat; v.pos[2] = tmp.z + nz * v.lat;
    v.pos[1] = world ? world.height(v.pos[0], v.pos[2]) : 0;
    const yawTarget = Math.atan2(tmp.tx + nx * (v.latTarget - v.lat) * 0.05, tmp.tz + nz * (v.latTarget - v.lat) * 0.05);
    v.heading = yawTarget; // ángulo en el plano x,z (0 = +z)
  }
  vehicles.forEach(place);

  c.step = (dt) => {
    if (c.alerted) c.alertT += dt;
    for (const v of vehicles) {
      if (v.state === 'destroyed' || v.state === 'burning') {
        v.speed = Math.max(0, v.speed - 6 * dt);
        if (v.state === 'burning') { v.burnT += dt; if (v.burnT > 45) v.state = 'destroyed'; }
        v.s += v.speed * dt; place(v); continue;
      }
      v.hitT = Math.max(0, v.hitT - dt);
      let target = v.cruise;
      if (c.alerted) {
        // primero frenan, luego se dispersan a los costados del camino y se detienen
        if (c.alertT < 3) target = 0;
        else if (Math.abs(v.lat - v.latTarget) > 1) target = 5; else target = 0;
        if (v.latTarget === 0 && c.alertT >= 3) v.latTarget = (rnd() < 0.5 ? -1 : 1) * (14 + rnd() * 18);
        v.state = target > 0 ? 'moving' : 'stopped';
        v.lat += Math.sign(v.latTarget - v.lat) * Math.min(Math.abs(v.latTarget - v.lat), 3.5 * dt) * (c.alertT >= 3 ? 1 : 0);
      }
      if (v.s >= R.length - 5) target = 0;
      v.speed += Math.max(-4 * dt, Math.min(2 * dt, target - v.speed));
      v.s += v.speed * dt;
      // no chocar con el de adelante
      place(v);
    }
  };

  /** Aplica daño. kind: 'gun' | 'missile' | 'splash'. Devuelve true si el vehículo quedó fuera de combate. */
  c.damage = (v, amount, kind = 'gun') => {
    if (v.state === 'burning' || v.state === 'destroyed') return false;
    const T = VEHICLE_TYPES[v.type];
    const eff = kind === 'gun' ? amount * T.armor : amount;
    v.hp -= eff; v.hitT = 0.25;
    if (!c.alerted) { c.alerted = true; c.alertT = 0; events.push({ type: 'alert' }); }
    if (v.hp <= 0) {
      v.hp = 0; v.state = 'burning'; v.burnT = 0;
      events.push({ type: 'kill', vehicle: v, pos: v.pos.slice() });
      return true;
    }
    return false;
  };
  c.alive = () => vehicles.filter((v) => v.state !== 'burning' && v.state !== 'destroyed');
  c.drainEvents = () => events.splice(0, events.length);
  return c;
}
