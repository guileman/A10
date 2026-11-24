// Atmósfera ISA (troposfera + tropopausa) con desvío de temperatura y QNH, viento medio con perfil
// logarítmico cerca del suelo y turbulencia Dryden (MIL-F-8785C, forma de baja altura) con semilla.
import { KT, DEG, clamp, mulberry32, makeGauss } from './math.js';

export const R_AIR = 287.053, GAMMA = 1.4;
const T0 = 288.15, P0 = 101325, L = 0.0065, G = 9.80665;

/** Estado atmosférico a altitud geométrica h (m MSL). env: {tempOffsetC, qnhHpa}. */
export function atmosphere(h, env, out = {}) {
  const dT = env.tempOffsetC || 0;
  const qnh = (env.qnhHpa || 1013.25) * 100;
  // Presión: perfil ISA anclado en QNH al nivel del mar (altímetro estándar).
  const hp = Math.min(h, 11000);
  const tIsa = T0 - L * hp;
  let p = qnh * Math.pow(tIsa / T0, G / (L * R_AIR));
  if (h > 11000) p *= Math.exp(-G * (h - 11000) / (R_AIR * 216.65));
  const T = (h > 11000 ? 216.65 : tIsa) + dT;
  out.p = p; out.T = T; out.rho = p / (R_AIR * T);
  out.a = Math.sqrt(GAMMA * R_AIR * T);
  out.theta = T / T0; out.delta = p / P0; out.sigma = out.rho / 1.225;
  return out;
}

/** Viento medio (mundo) a altura AGL. Perfil log con z0=0.03 m referido a 10 m (ESTIMADO, campo abierto). */
export function meanWind(env, aglM, out) {
  const spd = (env.windKt || 0) * KT;
  const from = (env.windFromDeg || 0) * DEG;
  const h = Math.max(aglM, 0.5);
  const f = h >= 300 ? Math.log(300 / 0.03) / Math.log(10 / 0.03) : Math.log(h / 0.03) / Math.log(10 / 0.03);
  const s = spd * Math.max(0, f);
  // Viento DESDE 'from' sopla HACIA from+180. Rumbo c -> (sin c, 0, -cos c).
  out[0] = -Math.sin(from) * s; out[1] = 0; out[2] = Math.cos(from) * s;
  return out;
}

/**
 * Turbulencia Dryden (aprox. de 1.er orden por eje, filtros discretos exactos).
 * Intensidad: turbulence 0..1 -> W20 = 0..45 kt (ligera 15, moderada 30, severa 45; MIL-F-8785C).
 * Escalas y sigmas de baja altura (h<1000 ft): Lw = h, Lu=Lv = h/(0.177+0.000823h)^1.2,
 * σw = 0.1 W20, σu=σv = σw/(0.177+0.000823h)^0.4  (h en ft). Por encima de 2000 ft: L=1750 ft, σ=σw.
 */
export class Dryden {
  constructor(seed = 1) { this.reseed(seed); }
  reseed(seed) {
    this.rand = mulberry32(seed ^ 0x9E3779B9);
    this.gauss = makeGauss(this.rand);
    this.u = 0; this.v = 0; this.w = 0;
  }
  /** Avanza dt; devuelve ráfaga en marco "masa de aire": [lon, lat, vert] (m/s). */
  step(dt, intensity, aglM, tas, out) {
    if (!(intensity > 0)) { this.u = this.v = this.w = 0; out[0] = out[1] = out[2] = 0; return out; }
    const hft = clamp(aglM / 0.3048, 10, 1e5);
    const W20 = intensity * 45 * 1.68781; // kt -> ft/s
    let Lu, Lw, su, sw;
    sw = 0.1 * W20;
    if (hft < 1000) {
      const k = 0.177 + 0.000823 * hft;
      Lu = hft / Math.pow(k, 1.2); Lw = hft; su = sw / Math.pow(k, 0.4);
    } else if (hft < 2000) {
      const k = 0.177 + 0.000823 * 1000, t = (hft - 1000) / 1000;
      Lu = (1000 / Math.pow(k, 1.2)) * (1 - t) + 1750 * t; Lw = 1000 * (1 - t) + 1750 * t;
      su = (sw / Math.pow(k, 0.4)) * (1 - t) + sw * t;
    } else { Lu = Lw = 1750; su = sw; }
    const V = Math.max(tas / 0.3048, 15); // ft/s (evita escalas de tiempo nulas en vuelo estacionario)
    const fu = this._ou(dt, V / Lu, su), fw = this._ou(dt, V / Lw, sw);
    this.u = this.u * fu[0] + fu[1] * this.gauss();
    this.v = this.v * fu[0] + fu[1] * this.gauss();
    this.w = this.w * fw[0] + fw[1] * this.gauss();
    out[0] = this.u * 0.3048; out[1] = this.v * 0.3048; out[2] = this.w * 0.3048;
    return out;
  }
  _ou(dt, a, sigma) { const e = Math.exp(-a * dt); this._t = this._t || [0, 0]; this._t[0] = e; this._t[1] = sigma * Math.sqrt(1 - e * e); return this._t; }
}
