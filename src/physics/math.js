// Utilidades vectoriales/cuaterniones sin asignaciones en el lazo caliente.
// Vectores = arrays [x,y,z]; cuaternión = [x,y,z,w] (cuerpo -> mundo).

export const DEG = Math.PI / 180;
export const KT = 0.514444; // m/s por nudo
export const G0 = 9.80665;

export const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
export function set(o, x, y, z) { o[0] = x; o[1] = y; o[2] = z; return o; }
export function copy(o, a) { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; return o; }
export function add(o, a, b) { o[0] = a[0] + b[0]; o[1] = a[1] + b[1]; o[2] = a[2] + b[2]; return o; }
export function sub(o, a, b) { o[0] = a[0] - b[0]; o[1] = a[1] - b[1]; o[2] = a[2] - b[2]; return o; }
export function scale(o, a, s) { o[0] = a[0] * s; o[1] = a[1] * s; o[2] = a[2] * s; return o; }
export function addScaled(o, a, b, s) { o[0] = a[0] + b[0] * s; o[1] = a[1] + b[1] * s; o[2] = a[2] + b[2] * s; return o; }
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export function cross(o, a, b) {
  const x = a[1] * b[2] - a[2] * b[1], y = a[2] * b[0] - a[0] * b[2], z = a[0] * b[1] - a[1] * b[0];
  o[0] = x; o[1] = y; o[2] = z; return o;
}
export function normalize(o, a) { const l = len(a) || 1; return scale(o, a, 1 / l); }
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

// Rota v (cuerpo) a mundo con q.
export function qRotate(o, q, v) {
  const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
  const vx = v[0], vy = v[1], vz = v[2];
  const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx);
  o[0] = vx + qw * tx + (qy * tz - qz * ty);
  o[1] = vy + qw * ty + (qz * tx - qx * tz);
  o[2] = vz + qw * tz + (qx * ty - qy * tx);
  return o;
}
// Rota v (mundo) a cuerpo (conjugado).
export function qRotateInv(o, q, v) {
  const qx = -q[0], qy = -q[1], qz = -q[2], qw = q[3];
  const vx = v[0], vy = v[1], vz = v[2];
  const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx);
  o[0] = vx + qw * tx + (qy * tz - qz * ty);
  o[1] = vy + qw * ty + (qz * tx - qx * tz);
  o[2] = vz + qw * tz + (qx * ty - qy * tx);
  return o;
}
export function qMul(o, a, b) {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3], bx = b[0], by = b[1], bz = b[2], bw = b[3];
  o[0] = aw * bx + ax * bw + ay * bz - az * by;
  o[1] = aw * by - ax * bz + ay * bw + az * bx;
  o[2] = aw * bz + ax * by - ay * bx + az * bw;
  o[3] = aw * bw - ax * bx - ay * by - az * bz;
  return o;
}
export function qAxisAngle(o, ax, ay, az, ang) {
  const s = Math.sin(ang / 2);
  o[0] = ax * s; o[1] = ay * s; o[2] = az * s; o[3] = Math.cos(ang / 2); return o;
}
export function qNormalize(q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  q[0] /= l; q[1] /= l; q[2] /= l; q[3] /= l; return q;
}

// Actitud -> cuaternión. heading = rumbo de brújula (0 = norte = -z, horario), pitch + = proa arriba,
// roll + = ala derecha abajo. q = Ry(90°-h) · Rz(θ) · Rx(φ).
export function quatFromAttitude(headingRad, pitchRad, rollRad, o = [0, 0, 0, 1]) {
  const a = [0, 0, 0, 1], b = [0, 0, 0, 1], c = [0, 0, 0, 1];
  qAxisAngle(a, 0, 1, 0, Math.PI / 2 - headingRad);
  qAxisAngle(b, 0, 0, 1, pitchRad);
  qAxisAngle(c, 1, 0, 0, rollRad);
  qMul(o, a, b); qMul(o, o, c);
  return qNormalize(o);
}

const _f = [0, 0, 0], _u = [0, 0, 0], _r = [0, 0, 0];
/** attitude(quat) -> { headingDeg (0..360, brújula), pitchDeg, rollDeg } */
export function attitude(q, out = {}) {
  qRotate(_f, q, [1, 0, 0]); qRotate(_u, q, [0, 1, 0]); qRotate(_r, q, [0, 0, 1]);
  let h = Math.atan2(_f[0], -_f[2]) / DEG; if (h < 0) h += 360;
  out.headingDeg = h;
  out.pitchDeg = Math.asin(clamp(_f[1], -1, 1)) / DEG;
  out.rollDeg = Math.atan2(-_r[1], _u[1]) / DEG;
  return out;
}

// 3x3 (array plano de 9, fila mayor)
export function mat3Inv(o, m) {
  const a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5], g = m[6], h = m[7], i = m[8];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const id = 1 / det;
  o[0] = A * id; o[1] = -(b * i - c * h) * id; o[2] = (b * f - c * e) * id;
  o[3] = B * id; o[4] = (a * i - c * g) * id; o[5] = -(a * f - c * d) * id;
  o[6] = C * id; o[7] = -(a * h - b * g) * id; o[8] = (a * e - b * d) * id;
  return o;
}
export function mat3MulV(o, m, v) {
  const x = v[0], y = v[1], z = v[2];
  o[0] = m[0] * x + m[1] * y + m[2] * z;
  o[1] = m[3] * x + m[4] * y + m[5] * z;
  o[2] = m[6] * x + m[7] * y + m[8] * z;
  return o;
}

// Interpolación lineal en tabla [[x,y],...] (x creciente), con extrapolación plana.
export function interp(table, x) {
  const n = table.length;
  if (x <= table[0][0]) return table[0][1];
  if (x >= table[n - 1][0]) return table[n - 1][1];
  for (let k = 1; k < n; k++) {
    if (x <= table[k][0]) {
      const x0 = table[k - 1][0], x1 = table[k][0];
      return table[k - 1][1] + (table[k][1] - table[k - 1][1]) * (x - x0) / (x1 - x0);
    }
  }
  return table[n - 1][1];
}

// PRNG con semilla (mulberry32) + gaussiana (Box-Muller).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function makeGauss(rand) {
  let spare = null;
  return function () {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let u = 0; while (u === 0) u = rand();
    const v = rand();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
}
