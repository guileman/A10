// Integración de cuerpo rígido 6 GDL: Euler semi-implícito en traslación; en rotación, ecuación de Euler
// ω̇ = I⁻¹(M − ω×Iω) con ω en ejes cuerpo y actualización del cuaternión por exponencial exacta del paso
// (q ← q ⊗ exp(ω dt/2)), renormalizado. Sin asignaciones de memoria.
import { cross, mat3MulV, qMul, qNormalize } from './math.js';

const _a = [0, 0, 0], _b = [0, 0, 0], _c = [0, 0, 0], _d = [0, 0, 0], _q = [0, 0, 0, 1];

/** s: {pos, vel, quat, omega}; F mundo (N); Mb cuerpo (N·m) respecto del CG. */
export function integrateRigid(s, F, Mb, m, I, Iinv, dt) {
  s.vel[0] += F[0] / m * dt; s.vel[1] += F[1] / m * dt; s.vel[2] += F[2] / m * dt;
  s.pos[0] += s.vel[0] * dt; s.pos[1] += s.vel[1] * dt; s.pos[2] += s.vel[2] * dt;
  const w = s.omega;
  // Punto medio para el término giroscópico (mejora la conservación de |L| con ω grande).
  mat3MulV(_a, I, w); cross(_b, w, _a);
  _c[0] = Mb[0] - _b[0]; _c[1] = Mb[1] - _b[1]; _c[2] = Mb[2] - _b[2];
  mat3MulV(_d, Iinv, _c);
  const wm0 = w[0] + 0.5 * dt * _d[0], wm1 = w[1] + 0.5 * dt * _d[1], wm2 = w[2] + 0.5 * dt * _d[2];
  _b[0] = wm0; _b[1] = wm1; _b[2] = wm2;
  mat3MulV(_a, I, _b); cross(_c, _b, _a);
  _c[0] = Mb[0] - _c[0]; _c[1] = Mb[1] - _c[1]; _c[2] = Mb[2] - _c[2];
  mat3MulV(_d, Iinv, _c);
  w[0] += _d[0] * dt; w[1] += _d[1] * dt; w[2] += _d[2] * dt;
  const ax = (wm0 + w[0]) / 2, ay = (wm1 + w[1]) / 2, az = (wm2 + w[2]) / 2;
  const wl = Math.hypot(ax, ay, az);
  if (wl > 1e-12) {
    const sn = Math.sin(wl * dt / 2) / wl;
    _q[0] = ax * sn; _q[1] = ay * sn; _q[2] = az * sn; _q[3] = Math.cos(wl * dt / 2);
    qMul(s.quat, s.quat, _q); qNormalize(s.quat);
  }
  return s;
}
