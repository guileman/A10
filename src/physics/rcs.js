// Controles de reacción (RCS) del Harrier de 1.ª generación.
// Lógica real (documentada en PHYSICS.md): las válvulas están unidas MECÁNICAMENTE a las superficies:
//  - cabeceo: válvula de proa (sopla hacia abajo -> proa arriba) y válvula de cola (sopla hacia abajo ->
//    proa abajo), unidas al estabilizador (incluido el compensador);
//  - alabeo: válvulas de punta de ala con salida arriba/abajo, unidas a los alerones;
//  - guiñada: salidas laterales en la válvula de cola, unidas al timón (pedales).
// El aire viene del compresor de alta (sangrado); una válvula de corte lo habilita según el ángulo de
// toberas (nada a 0°, ~50 % a 10°, pleno ≥ 20°). Fuerza ∝ presión de sangrado (∝ RPM). El gasto total está
// limitado por el sangrado disponible: si la demanda lo excede, todas las válvulas pierden fuerza
// (Princeton MAE 1466: el momento de cabeceo máximo cae al usar alabeo/guiñada). El sangrado resta empuje.
import { clamp } from './math.js';

export const RCS_IDS = ['nose', 'tail', 'tailYaw', 'wingL', 'wingR'];

export class RCS {
  constructor(p) {
    this.p = p;
    this.valves = {};
    for (const id of RCS_IDS) this.valves[id] = { id, pos: [0, 0, 0], r: [0, 0, 0], forceN: 0, dir: [0, 1, 0], fmax: 0, open: 0, flow: 0 };
    this.pressureFrac = 0; this.bleedKgS = 0; this.thrustLossN = 0; this.phase = 0;
  }
  /** Configura posiciones (marco modelo) y fuerzas máximas a partir de inercias y brazos reales. */
  configure(geomRcs, cg, inertia) {
    const v = this.valves, a = this.p.maxAccel;
    for (const id of RCS_IDS) {
      v[id].pos = geomRcs[id].pos.slice();
      v[id].r = [v[id].pos[0] - cg[0], v[id].pos[1] - cg[1], v[id].pos[2] - cg[2]];
    }
    const Mp = a.pitch * inertia.Iyy, Mr = a.roll * inertia.Ixx, My = a.yaw * inertia.Izz;
    v.nose.fmax = Mp / Math.max(Math.abs(v.nose.r[0]), 0.5);
    v.tail.fmax = Mp / Math.max(Math.abs(v.tail.r[0]), 0.5);
    const armW = Math.max(Math.abs(v.wingL.r[2]) + Math.abs(v.wingR.r[2]), 1);
    v.wingL.fmax = v.wingR.fmax = Mr / armW;
    v.tailYaw.fmax = My / Math.max(Math.abs(v.tailYaw.r[0]), 0.5);
  }
  static pressureFromNF(nf) { return Math.pow(clamp((nf - 25) / 75, 0, 1.08), 1.6); }

  /**
   * dt; demandas normalizadas desde las superficies: pitch (+ proa arriba), roll (+ ala der. abajo),
   * yaw (+ proa a la derecha); nozzleDeg; nf (%). Devuelve fuerzas por válvula (marco cuerpo).
   */
  update(dt, pitch, roll, yaw, nozzleDeg, nf, engineRunning) {
    const p = this.p, v = this.valves;
    // Rampa lineal 0 % a 0°, 50 % a 10°, 100 % a ≥20° (Princeton MAE 1466).
    const phase = clamp((nozzleDeg - p.phaseInDeg[0]) / (p.phaseInDeg[1] - p.phaseInDeg[0]), 0, 1);
    this.phase = phase;
    const pr = engineRunning ? RCS.pressureFromNF(nf) : 0;
    this.pressureFrac = pr;
    const k = phase * pr;
    // Fuerzas objetivo (con signo, a lo largo del eje de cada válvula).
    const tgt = this._tgt || (this._tgt = {});
    tgt.nose = Math.max(pitch, 0) * v.nose.fmax * k;           // +y
    tgt.tail = Math.max(-pitch, 0) * v.tail.fmax * k;          // +y
    tgt.wingL = roll * v.wingL.fmax * k;                       // +y en punta izq. para alabeo a la derecha
    tgt.wingR = -roll * v.wingR.fmax * k;                      // -y en punta der.
    tgt.tailYaw = -yaw * v.tailYaw.fmax * k;                   // -z (fuerza a la izquierda) para proa a la derecha
    // Limitación por sangrado disponible.
    let flow = 0;
    for (const id of RCS_IDS) flow += Math.abs(tgt[id]) / p.jetVelocity;
    const avail = p.bleedAvailKgS * pr;
    const sc = flow > avail && flow > 0 ? avail / flow : 1;
    const a = 1 - Math.exp(-dt / p.valveTau);
    let total = 0;
    for (const id of RCS_IDS) {
      const val = v[id];
      val.forceN += (tgt[id] * sc - val.forceN) * a;
      val.flow = Math.abs(val.forceN) / p.jetVelocity;
      total += val.flow;
      const s = val.forceN >= 0 ? 1 : -1;
      if (id === 'tailYaw') { val.dir[0] = 0; val.dir[1] = 0; val.dir[2] = s; }
      else { val.dir[0] = 0; val.dir[1] = s; val.dir[2] = 0; }
    }
    this.bleedKgS = total;
    this.bleedPct = p.bleedAvailKgS > 0 ? 100 * total / p.bleedAvailKgS : 0;
    this.thrustLossN = total * p.thrustLossPerKgS;
    return this;
  }
}
