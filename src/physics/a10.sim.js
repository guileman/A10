// A10Sim: cuerpo rígido 6 GDL (cuaternión) + 2 turbofanes TF34 + aerodinámica del A-10 + tren triciclo
// oleoneumático (gear.js) + contacto de estructura + masa/CG/inercia variables (combustible, munición
// interna, cargas en estaciones) + fuerzas externas genéricas (p. ej. retroceso). Subpasos fijos (480 Hz).
// Misma forma de API que HarrierSim (docs/CONTRACT.md §3); detalles en docs/PHYSICS_A10.md.
import { DEG, KT, G0, clamp, qRotate, qRotateInv, quatFromAttitude, attitude, cross, mat3Inv, mat3MulV } from './math.js';
import { A10_PARAMS } from './a10.params.js';
import { loadA10Geometry } from './a10.geometry.js';
import { atmosphere, meanWind, Dryden } from './atmosphere.js';
import { Turbofan } from './turbofan.js';
import { makeA10Aero, computeA10Aero } from './a10.aero.js';
import { A10Controls } from './a10.controls.js';
import { EMPTY_WORLD } from './ground.js';
import { GearUnit, stepGearUnit } from './gear.js';
import { integrateRigid } from './rigidbody.js';

export const A10_GEAR_IDS = ['nose', 'mainL', 'mainR'];
const GEAR_PARTS = {
  nose: { wheels: ['NoseWheel'], leg: 'NoseGearLeg' },
  mainL: { wheels: ['MainWheelL'], leg: 'MainGearLegL' },
  mainR: { wheels: ['MainWheelR'], leg: 'MainGearLegR' },
};

function deepMerge(a, b) {
  if (!b) return structuredClone(a);
  const o = structuredClone(a);
  for (const k of Object.keys(b)) {
    if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) o[k] = deepMerge(o[k], b[k]);
    else o[k] = structuredClone(b[k]);
  }
  return o;
}

export const A10_DEFAULT_CONTROLS = Object.freeze({
  pitch: 0, roll: 0, yaw: 0, throttle: 0, flaps: 0, gearDown: true, brake: 0, parkingBrake: false, speedbrake: 0,
  trim: { pitch: 0, roll: 0, yaw: 0 }, assist: { stabilityAug: 1 },
});

export class A10Sim {
  constructor({ params, geometry, seed = 1, substepHz } = {}) {
    this.p = deepMerge(A10_PARAMS, params);
    this.geom = geometry && geometry.gear && geometry.gear.mainL && geometry.gear.mainL.tireOffsets ? geometry : loadA10Geometry(geometry);
    this.seed = seed >>> 0;
    this.dtSub = 1 / (substepHz || this.p.integration.substepHz);
    this.world = EMPTY_WORLD;
    this.env = { windKt: 0, windFromDeg: 0, tempOffsetC: 0, qnhHpa: 1013.25, turbulence: 0, surfaceWetness: 0 };
    this.engL = new Turbofan(this.p.engine); this.engR = new Turbofan(this.p.engine);
    this.fc = new A10Controls(this.p.controls);
    this.aeroModel = makeA10Aero(this.p.aero);
    this.dryden = new Dryden(this.seed);
    this.events = [];
    this.stores = []; this.ammoKg = this.p.mass.ammoMaxKg; this.payloadKg = 0;
    this.extForces = new Map();
    this._alloc();
    this._initGeometry();
    this.reset({});
  }

  // ---------------------------------------------------------------- geometría, CG de diseño, tren
  _initGeometry() {
    const g = this.geom, p = this.p, gp = p.gear;
    const n = g.gear.nose, mL = g.gear.mainL, mR = g.gear.mainR;
    const xMain = (mL.axle[0] + mR.axle[0]) / 2;
    const yMainGround = (mL.axle[1] - mL.wheelRadius + mR.axle[1] - mR.wheelRadius) / 2;
    // CG vacío: del JSON o, si falta, del reparto estático supuesto (proa 13 %) y altura sobre el suelo.
    if (g.cgModel) { this.cgEmpty = g.cgModel.slice(); this.cgSource = 'json'; }
    else {
      this.cgEmpty = [xMain + gp.noseShare * (n.axle[0] - xMain), yMainGround + gp.cgHeightM, 0];
      this.cgSource = 'gear-derived';
    }
    const ce = this.cgEmpty, mp = p.mass;
    this.fuelPos = [ce[0] + mp.fuelCgOffset[0], ce[1] + mp.fuelCgOffset[1], ce[2] + mp.fuelCgOffset[2]];
    this.ammoPos = [ce[0] + mp.ammoCgOffset[0], ce[1] + mp.ammoCgOffset[1], ce[2] + mp.ammoCgOffset[2]];
    this.pilotPos = mp.pilotCgOffset ? mp.pilotCgOffset.slice() : [g.eyeModel[0], g.eyeModel[1] - 0.6, g.eyeModel[2]];
    this.aeroRef = ce.slice(); // punto de referencia de la aerodinámica (margen estático definido aquí)
    this.cg = ce.slice();
    // Diseño del tren a masa de diseño con CG vacío+combustible lleno.
    const W = gp.designMassKg * G0;
    const xs = { nose: n.axle[0], mainL: mL.axle[0], mainR: mR.axle[0] };
    const zs = { nose: n.axle[2], mainL: mL.axle[2], mainR: mR.axle[2] };
    // Equilibrio: ΣN = W; Σ N x = W xcg; Σ N z = W zcg  (3×3).
    const A = [1, 1, 1, xs.nose, xs.mainL, xs.mainR, zs.nose, zs.mainL, zs.mainR];
    const Ai = mat3Inv(new Array(9), A);
    const sol = mat3MulV([0, 0, 0], Ai, [W, W * ce[0], W * ce[2]]);
    this.staticLoads = { nose: sol[0], mainL: sol[1], mainR: sol[2], total: W, massKg: gp.designMassKg };
    const tg = Math.tan(gp.groundPitchDeg * DEG);
    const defl = (id, Wi) => Wi / (id === 'nose' ? gp.units.nose.tireK : gp.units.main.tireK);
    const yG0 = yMainGround + (defl('mainL', sol[1]) + defl('mainR', sol[2])) / 2;
    this.groundLine = { x0: xMain, y0: yG0, tan: tg };
    this.gear = {}; this.gearDiscrepancy = {};
    for (const id of A10_GEAR_IDS) {
      const gg = g.gear[id];
      const up = { ...(id === 'nose' ? gp.units.nose : gp.units.main) };
      const Wi = this.staticLoads[id];
      const yg = yG0 - tg * (gg.axle[0] - xMain);
      const ys = yg + gg.wheelRadius - defl(id, Wi);
      const axleStatic = [gg.axle[0], ys, gg.axle[2]];
      this.gearDiscrepancy[id] = ys - gg.axle[1];
      const unit = new GearUnit(id, gg, up, gp);
      unit.design(axleStatic, Wi, this.dtSub);
      unit.axleStatic = axleStatic;
      this.gear[id] = unit;
    }
    this._refreshArms();
  }

  /** Brazos relativos al CG actual (se recalculan cuando el CG se mueve). */
  _refreshArms() {
    const g = this.geom, cg = this.cg;
    const rel = (p) => [p[0] - cg[0], p[1] - cg[1], p[2] - cg[2]];
    this.r = {
      engL: rel(g.engines.L.pos), engR: rel(g.engines.R.pos), aero: rel(this.aeroRef),
      hard: (this.r && this.r.hard) || g.hardpoints.map((h) => ({ id: h.id, pos: h.pos, r: [0, 0, 0], contact: false })),
    };
    for (const h of this.r.hard) { h.r[0] = h.pos[0] - cg[0]; h.r[1] = h.pos[1] - cg[1]; h.r[2] = h.pos[2] - cg[2]; }
    for (const f of this.extForces.values()) f.r = rel(f.posModel);
    this._cgArms = cg.slice();
  }

  _alloc() {
    this.pos = [0, 0, 0]; this.vel = [0, 0, 0]; this.quat = [0, 0, 0, 1]; this.omega = [0, 0, 0];
    this.F = [0, 0, 0]; this.Mb = [0, 0, 0];
    this.I = new Array(9).fill(0); this.Iinv = new Array(9).fill(0);
    this._t = { a: [0, 0, 0], b: [0, 0, 0], c: [0, 0, 0], d: [0, 0, 0], e: [0, 0, 0], n: [0, 0, 0] };
    this.air = { V: 0, alpha: 0, beta: 0, mach: 0, qbar: 0, rho: 1.225, T: 288.15, p: 101325, a: 340, vAirB: [0, 0, 0], windW: [0, 0, 0], windB: [0, 0, 0], agl: 0, hGround: 0, alphaDot: 0, prevAlpha: 0, sigma: 1 };
    this.aeroOut = {}; this.atm = {}; this.gust = [0, 0, 0];
    this.ctx = { pos: this.pos, vel: this.vel, quat: this.quat, omegaW: [0, 0, 0], cg: null, ext: 1, world: null, wetness: 0, dt: 0, brake: 0, parking: false, antiSkid: true, yawCmd: 0, gs: 0, Fw: [0, 0, 0], Tw: [0, 0, 0] };
    this._axTmp = [0, 0, 0]; this.specific = [0, 0, 0];
    this._ctlSt = { q: 0, r: 0, betaRad: 0, iasKt: 0 };
  }

  // ---------------------------------------------------------------- masa / CG / inercia
  _massProps() {
    const mp = this.p.mass;
    const m0 = mp.emptyKg + mp.pilotKg, mf = this.fuelKg, ma = this.ammoKg, mpay = this.payloadKg;
    const ce = this.cgEmpty;
    let M = m0 + mf + ma + mpay;
    let sx = m0 * ce[0] + mf * this.fuelPos[0] + ma * this.ammoPos[0] + mpay * ce[0];
    let sy = m0 * ce[1] + mf * this.fuelPos[1] + ma * this.ammoPos[1] + mpay * ce[1];
    let sz = m0 * ce[2] + mf * this.fuelPos[2] + ma * this.ammoPos[2] + mpay * ce[2];
    for (const s of this.stores) { M += s.massKg; sx += s.massKg * s.pos[0]; sy += s.massKg * s.pos[1]; sz += s.massKg * s.pos[2]; }
    const cg = this.cg; cg[0] = sx / M; cg[1] = sy / M; cg[2] = sz / M;
    // Inercias (convención aeronáutica: roll ⟂ y,z; pitch ⟂ x,y; yaw ⟂ x,z en ejes cuerpo del contrato).
    let Ixx = mp.Ixx, Iyy = mp.Iyy, Izz = mp.Izz;
    const pt = (m, p, rr, rp, ry) => {
      const dx = p[0] - cg[0], dy = p[1] - cg[1], dz = p[2] - cg[2];
      Ixx += m * (dy * dy + dz * dz + rr * rr); Iyy += m * (dx * dx + dy * dy + rp * rp); Izz += m * (dx * dx + dz * dz + ry * ry);
    };
    pt(m0, ce, 0, 0, 0);
    const rg = mp.fuelRadiusGyr;
    pt(mf, this.fuelPos, rg.roll, rg.pitch, rg.yaw);
    pt(ma, this.ammoPos, 0.4, 0.5, 0.5);
    pt(mpay, ce, 0.5, 0.5, 0.5);
    for (const s of this.stores) pt(s.massKg, s.pos, 0.2, 0.8, 0.8);
    this.mass = M;
    this.inertiaConv = { Ixx, Iyy, Izz, Ixz: mp.Ixz };
    const I = this.I;
    I[0] = Ixx; I[1] = mp.Ixz; I[2] = 0;
    I[3] = mp.Ixz; I[4] = Izz; I[5] = 0;
    I[6] = 0; I[7] = 0; I[8] = Iyy;
    mat3Inv(this.Iinv, I);
    const a = this._cgArms;
    if (!a || Math.abs(a[0] - cg[0]) + Math.abs(a[1] - cg[1]) + Math.abs(a[2] - cg[2]) > 1e-3) this._refreshArms();
  }

  // ---------------------------------------------------------------- API pública
  setWorld(world) { this.world = world || EMPTY_WORLD; }
  setEnvironment(e = {}) { Object.assign(this.env, e); }

  /**
   * Cargas externas (sólo masa, CG y resistencia). list: [{ station (id de geometry.stations) | posModel,
   * massKg, dCD (incremento de CD0 referido a S) , id? }]. Llamar de nuevo al lanzar algo (sin ese ítem).
   */
  setStores(list = []) {
    const st = this.geom.stations;
    this.stores = list.filter((s) => s && s.massKg > 0).map((s) => {
      const def = st.find((x) => x.id === s.station);
      const pos = Array.isArray(s.posModel) ? s.posModel.slice() : def ? def.pos.slice() : this.cgEmpty.slice();
      return { id: s.id ?? s.station, station: s.station ?? null, pos, massKg: s.massKg, dCD: s.dCD || 0 };
    });
    this.storesCD = this.stores.reduce((a, s) => a + s.dCD, 0);
    if (this.fuelKg !== undefined) this._massProps();
  }
  /** Masa de munición interna (kg). Sólo afecta masa, CG e inercia. */
  setAmmoKg(kg) { this.ammoKg = clamp(kg, 0, this.p.mass.ammoMaxKg); if (this.fuelKg !== undefined) this._massProps(); }

  /**
   * Fuerza externa genérica aplicada en cada subpaso hasta que se cambie o se quite.
   * forceBody: [fx,fy,fz] N en ejes cuerpo; posModel: punto de aplicación (marco modelo; por defecto la boca
   * del cañón de la geometría); vibration: { frac 0..1, hz } modulación determinista opcional.
   * Uso típico: retroceso del cañón (ver docs/PHYSICS_A10.md §Fuerzas externas).
   */
  setExternalForce(id, { forceBody, posModel, vibration } = {}) {
    if (!forceBody || !forceBody.some((v) => v !== 0)) { this.extForces.delete(id); return; }
    const pm = Array.isArray(posModel) ? posModel.slice() : this.geom.gun.muzzle.slice();
    const cg = this.cg;
    this.extForces.set(id, { forceBody: forceBody.slice(), posModel: pm, r: [pm[0] - cg[0], pm[1] - cg[1], pm[2] - cg[2]], vibration: vibration || null, phase: (this.extForces.size + 1) * 1.7 });
  }
  clearExternalForce(id) { this.extForces.delete(id); }

  reset(o = {}) {
    const p = this.p, mp = p.mass;
    this.t = 0; this.events.length = 0; this.crashed = false; this.crashReason = null;
    this.dryden.reseed(this.seed); this.gust.fill(0);
    this.wingDrop = 0; this.wingDropSign = 0; this._rngState = (this.seed * 2654435761) >>> 0 || 1;
    this.acc = 0;
    const state = o.state || 'parked';
    this.fuelKg = clamp(o.fuelKg ?? mp.fuelMaxKg, 0, mp.fuelMaxKg);
    if (o.ammoKg !== undefined) this.ammoKg = clamp(o.ammoKg, 0, mp.ammoMaxKg);
    if (o.payloadKg !== undefined) this.payloadKg = Math.max(0, o.payloadKg);
    if (o.stores) this.setStores(o.stores);
    this.storesCD = this.stores.reduce((a, s) => a + s.dCD, 0);
    this.engL.reset(p.engine.idleN1); this.engR.reset(p.engine.idleN1);
    this._massProps();
    const hdg = (o.headingDeg || 0) * DEG;
    const x = o.x || 0, z = o.z || 0;
    const hG = this.world.height(x, z);
    this.gearExt = (o.gearDown ?? (state !== 'cruise')) ? 1 : 0;
    this.flags = { onGround: false, weightOnWheels: false, stalled: false, inGroundEffect: false, crashed: false, overspeed: false, gLimit: false };
    this.prevContact = {}; for (const id of A10_GEAR_IDS) this.prevContact[id] = false;
    this.prevStalled = false; this._lastStallEv = -1e9;
    this.omega.fill(0);
    const flapIdx = clamp(o.flaps ?? (state === 'cruise' ? 0 : 1), 0, 2);
    this.fc.reset(0, p.controls.flapDeg[flapIdx]);
    this.trimInfo = { ok: true, throttle: 0, elevatorTrimDeg: 0, flaps: flapIdx };
    for (const id of A10_GEAR_IDS) { const u = this.gear[id]; u.u = this.gearExt ? u.uStatic : 0; u.uDot = 0; u.steerDeg = 0; for (const t of u.tires) { t.omega = 0; t.spin = 0; } }
    this.lastControls = { ...A10_DEFAULT_CONTROLS, flaps: flapIdx, gearDown: this.gearExt === 1 };
    if (state === 'parked') {
      quatFromAttitude(hdg, p.gear.groundPitchDeg * DEG, 0, this.quat);
      const mL = this.gear.mainL, rb = [mL.axleStatic[0] - this.cg[0], mL.axleStatic[1] - this.cg[1], mL.axleStatic[2] - this.cg[2]];
      const rw = qRotate([0, 0, 0], this.quat, rb);
      this.pos[0] = x; this.pos[2] = z;
      this.pos[1] = o.y ?? (hG - rw[1] + mL.wheelRadius - this.staticLoads.mainL / p.gear.units.main.tireK);
      this.vel.fill(0);
      const c = { ...A10_DEFAULT_CONTROLS, parkingBrake: true, flaps: flapIdx };
      for (let i = 0; i < Math.round(2.5 / this.dtSub); i++) this._substep(this.dtSub, c);
      this.t = 0; this.events.length = 0;
    } else {
      const V = (o.speedKt ?? 300) * KT; // velocidad VERDADERA respecto del aire si no se pide IAS
      this.pos[0] = x; this.pos[2] = z;
      this.pos[1] = o.y ?? (o.altFt !== undefined ? o.altFt * 0.3048 : hG + (o.aglM ?? 300));
      atmosphere(this.pos[1], this.env, this.atm);
      const tas = o.speedIsIas === false ? V : V * Math.sqrt(1.225 / this.atm.rho); // speedKt = KIAS por defecto
      this._trim(hdg, tas);
    }
    this.lastControls.throttle = this.trimInfo.throttle;
    return this;
  }

  step(dt, controls) {
    const c = controls || this.lastControls;
    this.lastControls = c;
    this.acc += Math.min(Math.max(dt, 0), 0.25);
    const h = this.dtSub;
    while (this.acc >= h - 1e-12) { this._substep(h, c); this.acc -= h; }
    return this;
  }

  drainEvents() { const e = this.events.slice(); this.events.length = 0; return e; }
  _event(type, data) { this.events.push({ t: this.t, type, data }); if (this.events.length > 200) this.events.shift(); }

  // ---------------------------------------------------------------- subpaso
  _substep(dt, c) {
    if (this.crashed) { this.t += dt; return; }
    const p = this.p, a = this.air;
    this._airData(dt, true);
    const st = this._ctlSt;
    st.q = this.omega[2]; st.r = -this.omega[1]; st.betaRad = a.beta; st.iasKt = a.V * Math.sqrt(a.rho / 1.225) / KT;
    this.fc.update(dt, c, st);
    // Tren: no sube con peso en ruedas.
    const wantDown = c.gearDown !== false;
    if (wantDown || !this.flags.weightOnWheels) {
      const prev = this.gearExt;
      this.gearExt = wantDown ? Math.min(1, this.gearExt + dt / p.gear.extendTimeS) : Math.max(0, this.gearExt - dt / p.gear.retractTimeS);
      if (prev < 1 && this.gearExt === 1) this._event('gearLock', { down: true });
      if (prev > 0 && this.gearExt === 0) this._event('gearLock', { down: false });
    }
    // Motores (un tanque común; se alimentan mientras haya combustible).
    const thr = clamp(c.throttle ?? 0, 0, 1);
    const tL = clamp(c.throttleL ?? thr, 0, 1), tR = clamp(c.throttleR ?? thr, 0, 1);
    const hasFuel = this.fuelKg > 0;
    const wasRunning = this.engL.running || this.engR.running;
    this.engL.update(dt, tL, a.sigma, a.mach, hasFuel);
    this.engR.update(dt, tR, a.sigma, a.mach, hasFuel);
    if (wasRunning && !hasFuel) this._event('flameout', { engine: 'both' });
    this.fuelKg = Math.max(0, this.fuelKg - (this.engL.fuelFlow + this.engR.fuelFlow) * dt);
    this._massProps();
    this._forces(dt, c, true);
    integrateRigid(this, this.F, this.Mb, this.mass, this.I, this.Iinv, dt);
    this.t += dt;
    this._checks(dt);
  }

  _airData(dt, advanceTurb) {
    const a = this.air, env = this.env, t = this._t;
    atmosphere(this.pos[1], env, this.atm);
    a.rho = this.atm.rho; a.T = this.atm.T; a.p = this.atm.p; a.a = this.atm.a; a.sigma = this.atm.sigma;
    a.hGround = this.world.height(this.pos[0], this.pos[2]);
    a.agl = this.pos[1] - a.hGround;
    meanWind(env, a.agl, a.windW);
    if (advanceTurb) {
      const tasEst = Math.hypot(this.vel[0] - a.windW[0], this.vel[2] - a.windW[2]);
      this.dryden.step(dt, env.turbulence || 0, a.agl, tasEst, this.gust);
    }
    qRotate(t.e, this.quat, [1, 0, 0]);
    const hl = Math.hypot(t.e[0], t.e[2]) || 1, fx = t.e[0] / hl, fz = t.e[2] / hl;
    a.windW[0] += this.gust[0] * fx - this.gust[1] * fz;
    a.windW[2] += this.gust[0] * fz + this.gust[1] * fx;
    a.windW[1] += this.gust[2];
    t.a[0] = this.vel[0] - a.windW[0]; t.a[1] = this.vel[1] - a.windW[1]; t.a[2] = this.vel[2] - a.windW[2];
    qRotateInv(a.vAirB, this.quat, t.a);
    qRotateInv(a.windB, this.quat, a.windW);
    const u = a.vAirB[0], v = a.vAirB[2], wc = -a.vAirB[1];
    a.V = Math.hypot(u, v, wc);
    const alpha = a.V > 0.5 ? Math.atan2(wc, u) : 0;
    a.beta = a.V > 0.5 ? Math.asin(clamp(v / a.V, -1, 1)) : 0;
    if (dt > 0) { const ad = (alpha - a.prevAlpha) / dt; a.alphaDot = Math.abs(ad) < 10 ? ad : 0; }
    a.prevAlpha = alpha; a.alpha = alpha;
    a.mach = a.V / a.a; a.qbar = 0.5 * a.rho * a.V * a.V;
  }

  _forces(dt, c, withGround) {
    const a = this.air, t = this._t, F = this.F, Mb = this.Mb;
    const fb = this._fb || (this._fb = [0, 0, 0]);
    fb[0] = fb[1] = fb[2] = 0; Mb[0] = Mb[1] = Mb[2] = 0;
    const addB = (fx, fy, fz, r) => {
      fb[0] += fx; fb[1] += fy; fb[2] += fz;
      if (r) { Mb[0] += r[1] * fz - r[2] * fy; Mb[1] += r[2] * fx - r[0] * fz; Mb[2] += r[0] * fy - r[1] * fx; }
    };
    const ao = this.aeroOut;
    if (a.V > 1) {
      // Altura del ala sobre el suelo (ala baja, ≈ 0,4 m debajo del CG).
      computeA10Aero(this.aeroModel, {
        V: a.V, alpha: a.alpha, beta: a.beta, pr: this.omega[0], qr: this.omega[2], rr: -this.omega[1], alphaDot: a.alphaDot,
        mach: a.mach, flapIdxF: this.fc.flapIdxF(), gearExt: this.gearExt, gearTransit: this.gearExt > 0 && this.gearExt < 1,
        speedbrakeFrac: this.fc.speedbrakeDeg / this.p.controls.speedbrakeMaxDeg, elevDeg: this.fc.elevDeg,
        aileronDeg: this.fc.aileronDeg, rudderDeg: this.fc.rudderDeg, hWing: a.agl - 0.4, wingDrop: this.wingDrop,
        storesCD: this.storesCD,
      }, a.qbar, ao);
      addB(ao.X, -ao.Z, ao.Y, this.r.aero);
      Mb[0] += ao.Lm; Mb[1] += -ao.Nm; Mb[2] += ao.Mm;
    } else { ao.stalled = false; ao.inGroundEffect = false; ao.CL = 0; ao.CD = 0; ao.stallBlend = 0; ao.buffet = 0; }
    // Empuje (neto) en cada nacela.
    const dL = this.geom.engines.L.dir, dR = this.geom.engines.R.dir;
    const TL = this.engL.thrustN, TR = this.engR.thrustN;
    addB(TL * dL[0], TL * dL[1], TL * dL[2], this.r.engL);
    addB(TR * dR[0], TR * dR[1], TR * dR[2], this.r.engR);
    // Fuerzas externas (retroceso, etc.).
    let ext = 0;
    for (const f of this.extForces.values()) {
      let k = 1, side = 0;
      if (f.vibration && f.vibration.frac > 0) {
        const w = 2 * Math.PI * (f.vibration.hz || 30) * this.t + f.phase;
        k = 1 + f.vibration.frac * Math.sin(w);
        side = f.vibration.frac * 0.3 * Math.sin(1.618 * w);
      }
      const fbx = f.forceBody[0] * k, fby = f.forceBody[1] * k + side * Math.abs(f.forceBody[0]), fbz = f.forceBody[2] * k + 0.5 * side * Math.abs(f.forceBody[0]);
      addB(fbx, fby, fbz, f.r);
      ext += fbx;
    }
    this.extForceX = ext;
    qRotate(F, this.quat, fb);
    F[1] -= this.mass * G0;
    if (withGround) this._ground(dt, c);
    t.a[0] = F[0]; t.a[1] = F[1] + this.mass * G0; t.a[2] = F[2];
    qRotateInv(this.specific, this.quat, t.a);
    const mg = this.mass * G0;
    this.specific[0] /= mg; this.specific[1] /= mg; this.specific[2] /= mg;
  }

  _ground(dt, c) {
    const ctx = this.ctx, t = this._t;
    ctx.cg = this.cg; ctx.ext = this.gearExt; ctx.world = this.world; ctx.wetness = this.env.surfaceWetness || 0; ctx.dt = dt;
    ctx.brake = clamp(c.brake || 0, 0, 1); ctx.parking = !!c.parkingBrake; ctx.antiSkid = c.antiSkid !== false;
    ctx.gs = Math.hypot(this.vel[0], this.vel[2]);
    // Dirección de rueda de proa (NWS): autoridad limitada con la velocidad (gear.js baja de máx. a 6° entre 2 y 12 m/s).
    ctx.yawCmd = c.nwsOff ? 0 : (c.yaw || 0);
    qRotate(ctx.omegaW, this.quat, this.omega);
    ctx.Fw[0] = ctx.Fw[1] = ctx.Fw[2] = 0; ctx.Tw[0] = ctx.Tw[1] = ctx.Tw[2] = 0;
    const near = this.air.agl < 15;
    if (near || this.gearExt < 1) for (const id of A10_GEAR_IDS) stepGearUnit(this.gear[id], ctx, this._axTmp);
    else for (const id of A10_GEAR_IDS) {
      const u = this.gear[id]; u.contact = false; u.loadN = 0;
      for (const tt of u.tires) { tt.contact = false; tt.N = 0; tt.omega *= Math.exp(-dt * 0.3); tt.spin += tt.omega * dt; }
      u.u += (0 - u.u) * Math.min(1, dt * 20); u.uDot = 0;
    }
    if (near) this._hardpoints(ctx);
    this.F[0] += ctx.Fw[0]; this.F[1] += ctx.Fw[1]; this.F[2] += ctx.Fw[2];
    qRotateInv(t.a, this.quat, ctx.Tw);
    this.Mb[0] += t.a[0]; this.Mb[1] += t.a[1]; this.Mb[2] += t.a[2];
  }

  _hardpoints(ctx) {
    const pc = this.p.contact, t = this._t, w = this.world;
    for (const h of this.r.hard) {
      qRotate(t.b, this.quat, h.r);
      const x = this.pos[0] + t.b[0], y = this.pos[1] + t.b[1], z = this.pos[2] + t.b[2];
      const pen = w.height(x, z) - y;
      if (pen <= 0) { h.contact = false; continue; }
      w.normal(x, z, t.n);
      cross(t.c, ctx.omegaW, t.b);
      const vx = this.vel[0] + t.c[0], vy = this.vel[1] + t.c[1], vz = this.vel[2] + t.c[2];
      const vn = vx * t.n[0] + vy * t.n[1] + vz * t.n[2];
      if (!h.contact) {
        h.contact = true;
        const surf = w.surface(x, z);
        if (-vn > pc.crashNormalVel || (surf === 6 && Math.hypot(vx, vz) > 25)) this._crash('impact:' + h.id, { vn, speed: Math.hypot(vx, vy, vz) });
        else this._event('scrape', { id: h.id, vn });
      }
      let N = pc.hardK * pen - pc.hardC * vn; if (N < 0) N = 0;
      const vtx = vx - vn * t.n[0], vty = vy - vn * t.n[1], vtz = vz - vn * t.n[2];
      const vt = Math.hypot(vtx, vty, vtz);
      const fr = vt > 1e-6 ? pc.mu * N * Math.tanh(vt / 0.5) / vt : 0;
      t.d[0] = N * t.n[0] - fr * vtx; t.d[1] = N * t.n[1] - fr * vty; t.d[2] = N * t.n[2] - fr * vtz;
      ctx.Fw[0] += t.d[0]; ctx.Fw[1] += t.d[1]; ctx.Fw[2] += t.d[2];
      cross(t.e, t.b, t.d);
      ctx.Tw[0] += t.e[0]; ctx.Tw[1] += t.e[1]; ctx.Tw[2] += t.e[2];
    }
  }

  _crash(reason, data) {
    if (this.crashed) return;
    this.crashed = true; this.crashReason = reason; this.flags.crashed = true;
    this._event('crash', { reason, ...data });
    this.vel.fill(0); this.omega.fill(0);
  }

  _rand() { let x = this._rngState; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this._rngState = x >>> 0; return this._rngState / 4294967296; }

  _checks(dt) {
    const p = this.p, a = this.air, f = this.flags, ao = this.aeroOut;
    // Pérdida + caída de ala moderada: el lado se sortea (semilla) y la intensidad sigue a la profundidad
    // de la pérdida con una constante de tiempo (sin escalones).
    const stalled = !!ao.stalled && a.V > 15;
    if (stalled && !this.prevStalled) {
      if (this.wingDropSign === 0) this.wingDropSign = this._rand() < 0.5 ? -1 : 1;
      if (this.t - this._lastStallEv > 3) { this._lastStallEv = this.t; this._event('stall', { aoaDeg: a.alpha / DEG }); }
    }
    const depth = ao.stallBlend || 0;
    if (depth < 0.02) this.wingDropSign = 0;
    const tgt = this.wingDropSign * depth;
    this.wingDrop += (tgt - this.wingDrop) * (1 - Math.exp(-dt / p.aero.wingDrop.tau));
    this.prevStalled = stalled; f.stalled = stalled;
    let any = false;
    for (const id of A10_GEAR_IDS) {
      const u = this.gear[id];
      if (u.contact && !this.prevContact[id]) {
        const vs = this.vel[1];
        if (!this._anyPrevContact()) this._event('touchdown', { unit: id, sinkMs: -vs });
        if (-vs > p.gear.crashSinkMs) this._crash('gearCollapse:' + id, { sinkMs: -vs });
        else if (-vs > p.gear.hardSinkMs) this._event('hardLanding', { unit: id, sinkMs: -vs });
      }
      if (u.contact) any = true;
    }
    for (const id of A10_GEAR_IDS) this.prevContact[id] = this.gear[id].contact;
    let wow = 0; for (const id of A10_GEAR_IDS) wow += this.gear[id].loadN;
    f.weightOnWheels = any && wow > 0.1 * this.mass * G0;
    f.onGround = any || this.r.hard.some((h) => h.contact);
    if (any && this.gearExt < 1 && this.gearExt > 0) this._crash('gearNotLocked', {});
    this._obsT = (this._obsT || 0) + dt;
    if (this._obsT > 1 / 30 && this.world.obstacles && this.world.obstacles.query) { this._obsT = 0; this._obstacles(); }
    const ias = a.V * Math.sqrt(a.rho / 1.225) / KT;
    const nz = this.specific[1];
    const gl = !f.onGround && (nz > p.limits.gMax || nz < p.limits.gMin);
    if (gl && !f.gLimit) this._event('gLimit', { nz });
    f.gLimit = gl;
    const over = ias > p.limits.vneKt || (this.gearExt > 0 && ias > p.gear.limitSpeedKt);
    if (over && !f.overspeed) this._event('overspeed', { iasKt: ias, mach: a.mach });
    f.overspeed = over;
    if (!(Number.isFinite(this.pos[0] + this.pos[1] + this.pos[2] + this.vel[0] + this.vel[1] + this.vel[2] + this.omega[0] + this.omega[1] + this.omega[2]))) this._crash('numeric', {});
  }
  _anyPrevContact() { for (const id of A10_GEAR_IDS) if (this.prevContact[id]) return true; return false; }

  _obstacles() {
    const o = this.world.obstacles, out = this._obsOut || (this._obsOut = []);
    out.length = 0;
    const res = o.query(this.pos[0], this.pos[2], 10, out, 16);
    const arr = Array.isArray(res) ? res : out;
    const n = typeof res === 'number' ? res : arr.length;
    const t = this._t;
    for (let i = 0; i < n; i++) {
      const ob = arr[i]; if (!ob) continue;
      const r = ob.r ?? ob.radius ?? 1, hgt = ob.h ?? ob.height ?? 10;
      const base = ob.y ?? this.world.height(ob.x, ob.z);
      for (const hp of this.r.hard) {
        qRotate(t.b, this.quat, hp.r);
        const x = this.pos[0] + t.b[0], y = this.pos[1] + t.b[1], z = this.pos[2] + t.b[2];
        if (Math.hypot(x - ob.x, z - ob.z) < r + 0.3 && y < base + hgt && y > base - 1) { this._crash('obstacle', { obstacle: ob.type || 'obstacle' }); return; }
      }
    }
  }

  // ---------------------------------------------------------------- trim de crucero (nivelado, alas niveladas)
  _trimEval(hdg, V, x) {
    const [pitch, trimE, thr] = x;
    quatFromAttitude(hdg, pitch, 0, this.quat);
    this.vel[0] = Math.sin(hdg) * V; this.vel[1] = 0; this.vel[2] = -Math.cos(hdg) * V;
    this.omega.fill(0); this.gust.fill(0);
    this._airData(0, false); this.air.alphaDot = 0;
    const fc = this.fc;
    fc.trimElevDeg = trimE; fc.elevDeg = trimE; fc.aileronDeg = 0; fc.rudderDeg = 0; fc.speedbrakeDeg = 0;
    fc.qLP = 0; fc.rLP = 0;
    const a = this.air;
    for (const e of [this.engL, this.engR]) { e.n1 = e.commandN1(thr); e.update(0, thr, a.sigma, a.mach, true); }
    this._forces(0, this.lastControls, false);
    const W = this.mass * G0;
    const fh = this.F[0] * Math.sin(hdg) - this.F[2] * Math.cos(hdg);
    return [fh / W, this.F[1] / W, this.Mb[2] / (W * this.p.aero.cbar)];
  }

  _trim(hdg, V) {
    const p = this.p;
    let x = [3 * DEG, -1, 0.6];
    const lo = [-10 * DEG, p.controls.trimRangeDeg[0] - 15, 0], hi = [20 * DEG, p.controls.trimRangeDeg[1] + 15, 1];
    let r = this._trimEval(hdg, V, x), err = Math.hypot(...r);
    const h = [1e-4, 1e-3, 1e-4];
    for (let it = 0; it < 50 && err > 1e-8; it++) {
      const J = [];
      for (let j = 0; j < 3; j++) { const xp = x.slice(); xp[j] += h[j]; const rp = this._trimEval(hdg, V, xp); J.push(rp.map((v, i) => (v - r[i]) / h[j])); }
      const A = [J[0][0], J[1][0], J[2][0], J[0][1], J[1][1], J[2][1], J[0][2], J[1][2], J[2][2]];
      const dx = mat3MulV([0, 0, 0], mat3Inv(new Array(9), A), r);
      if (!dx.every(Number.isFinite)) break;
      let s = 1;
      for (let ls = 0; ls < 10; ls++) {
        const xn = x.map((v, k) => clamp(v - s * dx[k], lo[k], hi[k]));
        const rn = this._trimEval(hdg, V, xn), en = Math.hypot(...rn);
        if (en < err || ls === 9) { x = xn; r = rn; err = en; break; }
        s *= 0.5;
      }
    }
    this._trimEval(hdg, V, x);
    // El compensador real tiene recorrido limitado: el resto lo pondría la palanca (se informa).
    const tr = p.controls.trimRangeDeg;
    this.fc.trimElevDeg = clamp(x[1], tr[0], tr[1]);
    this.trimInfo = {
      ok: err < 1e-5 && x[2] < 1 && x[1] >= tr[0] && x[1] <= tr[1], residual: err, pitchDeg: x[0] / DEG, aoaDeg: this.air.alpha / DEG,
      elevatorTrimDeg: x[1], throttle: x[2], flaps: this.trimInfo.flaps, tasKt: V / KT,
    };
  }

  // ---------------------------------------------------------------- estado
  getState(out = {}) {
    const a = this.air, att = attitude(this.quat, {});
    out.t = this.t;
    out.pos = this.pos.slice(); out.quat = this.quat.slice(); out.vel = this.vel.slice(); out.omega = this.omega.slice();
    out.rates = { p: this.omega[0], q: this.omega[2], r: -this.omega[1] };
    out.att = att;
    out.cgModel = this.cg.slice(); out.massKg = this.mass;
    out.mass = { massKg: this.mass, fuelKg: this.fuelKg, ammoKg: this.ammoKg, payloadKg: this.payloadKg, storesKg: this.stores.reduce((s, x) => s + x.massKg, 0), cgModel: this.cg.slice(), inertia: { ...this.inertiaConv } };
    const ias = a.V * Math.sqrt(a.rho / 1.225);
    out.air = {
      iasKt: ias / KT, tasKt: a.V / KT, machNo: a.mach, aoaDeg: a.alpha / DEG, betaDeg: a.beta / DEG, qbar: a.qbar, rho: a.rho,
      tempK: a.T, altMslM: this.pos[1], altAglM: a.agl, vsMs: this.vel[1], gs: Math.hypot(this.vel[0], this.vel[2]),
      nz: this.specific[1], ny: this.specific[2], nx: this.specific[0], windBody: a.windB.slice(), windWorld: a.windW.slice(),
      CL: this.aeroOut.CL || 0, CD: this.aeroOut.CD || 0, buffet: this.aeroOut.buffet || 0,
    };
    const eL = this.engL, eR = this.engR;
    out.engine = {
      rpmPct: (eL.n1 + eR.n1) / 2, n1Pct: [eL.n1, eR.n1], thrustN: eL.thrustN + eR.thrustN, thrustLN: eL.thrustN, thrustRN: eR.thrustN,
      fuelKg: this.fuelKg, fuelFlowKgS: eL.fuelFlow + eR.fuelFlow, running: [eL.running, eR.running], flameout: !eL.running && !eR.running, stall: false,
    };
    out.controlSurfaces = {
      elevatorDeg: this.fc.elevDeg, aileronLDeg: -this.fc.aileronDeg, aileronRDeg: this.fc.aileronDeg, rudderDeg: this.fc.rudderDeg,
      flapsDeg: this.fc.flapsDeg, speedbrakeDeg: this.fc.speedbrakeDeg, deceleronSplitDeg: 2 * this.fc.speedbrakeDeg,
      flapsBlownUp: !!this.fc.flapsBlownUp, sasPitchDeg: this.fc.sasPitchDeg, sasYawDeg: this.fc.sasYawDeg,
    };
    const units = [];
    for (const id of A10_GEAR_IDS) {
      const u = this.gear[id], t0 = u.tires[0];
      units.push({
        id, parts: GEAR_PARTS[id], contact: u.contact, compression: u.stroke ?? 0, compressionFrac: clamp((u.stroke ?? 0) / u.Stot, 0, 1),
        wheelTravel: u.u, armAngleDeg: u.armAngleDeg(), steerDeg: u.steerDeg, spinRad: t0.spin, wheelSpeedRadS: t0.omega,
        loadN: u.loadN, strutForceN: u.strutForce || 0, slip: { long: t0.slipLong, lat: t0.slipLat }, surface: t0.surface,
        skid: t0.skid, brakeTorqueNm: t0.brakeT, wheelPosWorld: t0.pos.slice(), tireDeflection: t0.defl, bottomed: !!u.bottomed,
      });
    }
    out.gear = { state: this.gearExt >= 1 ? 'down' : this.gearExt <= 0 ? 'up' : 'transit', extension: this.gearExt, units };
    this.flags.inGroundEffect = !!this.aeroOut.inGroundEffect;
    this.flags.crashed = this.crashed;
    out.flags = { ...this.flags };
    const w = [];
    if (this.flags.stalled) w.push('STALL');
    if (this.gearExt < 1 && a.agl < 150 && ias < 150 * KT && this.vel[1] < 0) w.push('GEAR');
    if (this.fuelKg < 900) w.push('BINGO');
    if (this.fuelKg <= 0) w.push('ENGINE');
    if (this.flags.overspeed) w.push('OVERSPEED');
    if (this.flags.gLimit) w.push('G LIMIT');
    if (this.fc.flapsBlownUp) w.push('FLAPS');
    out.warnings = w;
    out.trim = { ...this.trimInfo, currentElevTrimDeg: this.fc.trimElevDeg, rollTrimDeg: this.fc.trimAilDeg, yawTrimDeg: this.fc.trimRudDeg };
    out.external = { forceXN: this.extForceX || 0, ids: [...this.extForces.keys()] };
    out.crashReason = this.crashReason;
    return out;
  }
}
