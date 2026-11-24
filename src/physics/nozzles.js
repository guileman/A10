// Toberas: 4 (2 delanteras de fan, 2 traseras calientes), rotación común por motor neumático (aire de
// sangrado) y cadena. Velocidad limitada (∝ √presión de sangrado), aceleración limitada, topes 0 y 98,5°.
import { clamp } from './math.js';

export class Nozzles {
  constructor(p) { this.p = p; this.reset(0); }
  reset(deg) { this.angleDeg = clamp(deg, 0, this.p.maxDeg); this.rateDegS = 0; this.cmdDeg = this.angleDeg; }
  /** pressureFrac: presión de sangrado relativa (0..~1.1). */
  update(dt, cmdDeg, pressureFrac) {
    const p = this.p;
    this.cmdDeg = clamp(cmdDeg, 0, p.maxDeg);
    const vmax = p.rateDegS * Math.sqrt(clamp(pressureFrac, 0, 1.2));
    const err = this.cmdDeg - this.angleDeg;
    // Servo de posición: velocidad deseada proporcional al error (lazo mecánico de seguimiento), saturada.
    const vdes = clamp(err * 12, -vmax, vmax);
    const dv = clamp(vdes - this.rateDegS, -p.accelDegS2 * dt, p.accelDegS2 * dt);
    this.rateDegS += dv;
    this.angleDeg += this.rateDegS * dt;
    if (this.angleDeg <= 0) { this.angleDeg = 0; if (this.rateDegS < 0) this.rateDegS = 0; }
    if (this.angleDeg >= p.maxDeg) { this.angleDeg = p.maxDeg; if (this.rateDegS > 0) this.rateDegS = 0; }
    return this;
  }
}
