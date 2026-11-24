// HarrierSim: integra cuerpo rígido (6 GDL, cuaternión) + motor + toberas + RCS + aerodinámica + tren +
// contacto, a subpasos fijos (por defecto 480 Hz). API según docs/CONTRACT.md §3.
import {
  DEG, KT, G0, clamp, qRotate, qRotateInv, qMul, qNormalize, quatFromAttitude, attitude, cross, dot,
  mat3Inv, mat3MulV, smoothstep,
} from './math.js';
import { HARRIER_PARAMS } from './params.js';
import { loadGeometry } from './geometry.js';
import { atmosphere, meanWind, Dryden } from './atmosphere.js';
import { Engine } from './engine.js';
import { Nozzles } from './nozzles.js';
import { RCS, RCS_IDS } from './rcs.js';
import { makeAero, computeAero } from './aero.js';
import { jetInducedLift, hotGasIngestion, EMPTY_WORLD } from './ground.js';
import { GearUnit, stepGearUnit, GEAR_IDS } from './gear.js';
import { FlightControls } from './flightcontrols.js';
import { integrateRigid } from './rigidbody.js';

function deepMerge(a, b) {
  if (!b) return structuredClone(a);
  const o = structuredClone(a);
  for (const k of Object.keys(b)) {
    if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) o[k] = deepMerge(o[k], b[k]);
    else o[k] = structuredClone(b[k]);
  }
  return o;
}

const DEFAULT_CONTROLS = Object.freeze({
  pitch: 0, roll: 0, yaw: 0, throttle: 0, nozzleDeg: 0, flaps: 0, gearDown: true, brake: 0, parkingBrake: false,
  airbrake: false, waterInjection: false, assist: { stabilityAug: 0.5, hoverDamping: 0 },
});

// Parámetros de diseño/estado de referencia que no son del avión (ESTIMADOS, ver PHYSICS.md).
// Nombres de partes del modelo 3D (orquestador) asociados a cada unidad de tren, para animación.
const GEAR_PARTS = {
  nose: { wheels: ['NoseWheel'], leg: 'NoseGearLeg' },
  main: { wheels: ['MainWheelL', 'MainWheelR'], leg: 'MainGearLeg' },
  outriggerL: { wheels: ['OutriggerWheelL'], leg: 'OutriggerLegL' },
  outriggerR: { wheels: ['OutriggerWheelR'], leg: 'OutriggerLegR' },
};

const DESIGN = { hoverNozzleDeg: 83, hoverNF: 96, cgAboveThrustM: 0.20, groundPitchDeg: 1.0 };

export class HarrierSim {
  constructor({ params, geometry, seed = 1, substepHz } = {}) {
    this.p = deepMerge(HARRIER_PARAMS, params);
    this.geom = geometry && geometry.gear && geometry.gear.nose && geometry.gear.nose.tireOffsets ? geometry : loadGeometry(geometry || {});
    this.seed = seed >>> 0;
    this.dtSub = 1 / (substepHz || this.p.integration.substepHz);
    this.world = EMPTY_WORLD;
    this.env = { windKt: 0, windFromDeg: 0, tempOffsetC: 0, qnhHpa: 1013.25, turbulence: 0, surfaceWetness: 0 };
    this.engine = new Engine(this.p.engine);
    this.nozzles = new Nozzles(this.p.nozzles);
    this.rcs = new RCS(this.p.rcs);
    this.fc = new FlightControls(this.p.controls);
    this.aeroModel = makeAero(this.p.aero);
    this.dryden = new Dryden(this.seed);
    this.events = [];
    this._initGeometry();
    this._alloc();
    this.reset({});
  }

  // ---------------------------------------------------------------- geometría, CG, tren
  _initGeometry() {
    const g = this.geom, p = this.p;
    // CG: sobre la línea de empuje resultante de vuelo estacionario (ver PHYSICS.md §CG).
    const f = clamp(p.engine.frontSplit100 + p.engine.frontSplitSlope * (100 - DESIGN.hoverNF), 0.42, 0.62);
    const avg = (a, b) => [0, 1, 2].map((k) => (a[k] + b[k]) / 2);
    const Fm = avg(g.nozzles.frontL.pos, g.nozzles.frontR.pos), Rm = avg(g.nozzles.rearL.pos, g.nozzles.rearR.pos);
    const M = [0, 1, 2].map((k) => f * Fm[k] + (1 - f) * Rm[k]);
    const th = DESIGN.hoverNozzleDeg * DEG;
    let cg;
    if (g.cgModel) cg = g.cgModel.slice();
    else { const dy = DESIGN.cgAboveThrustM; cg = [M[0] + dy * Math.cos(th) / Math.sin(th), M[1] + dy, 0]; }
    this.cg = cg; this.cgSource = g.cgModel ? 'json' : 'hover-balance';
    this.thrustCentroid = M;
    this.r = {
      noz: {}, intake: [(g.intake.L[0] + g.intake.R[0]) / 2 - cg[0], (g.intake.L[1] + g.intake.R[1]) / 2 - cg[1], 0],
      hard: g.hardpoints.map((h) => ({ id: h.id, r: [h.pos[0] - cg[0], h.pos[1] - cg[1], h.pos[2] - cg[2]], contact: false })),
    };
    for (const id of ['frontL', 'frontR', 'rearL', 'rearR']) {
      const n = g.nozzles[id];
      this.r.noz[id] = [n.pos[0] - cg[0], n.pos[1] - cg[1], n.pos[2] - cg[2]];
    }
    // RCS: fuerzas máximas a partir de inercias de referencia y brazos de la geometría.
    const mp = p.mass;
    this.rcs.configure(g.rcs, cg, { Ixx: mp.Ixx, Iyy: mp.Iyy, Izz: mp.Izz });
    // Masa de diseño del tren: vacío + piloto + combustible y agua llenos.
    const mDesign = mp.emptyKg + mp.pilotKg + mp.fuelMaxKg + mp.waterMaxKg;
    const W = mDesign * G0;
    const gu = p.gear.units;
    const xs = { nose: g.gear.nose.axle[0], main: g.gear.main.axle[0], oL: g.gear.outriggerL.axle[0], oR: g.gear.outriggerR.axle[0] };
    const o = p.gear.staticShare.outrigger;
    // Equilibrio estático: N + Mn = W(1-2o); N xn + Mn xm = W(xcg - o(xoL + xoR)).
    const rhsF = W * (1 - 2 * o), rhsM = W * cg[0] - W * o * (xs.oL + xs.oR);
    const Nn = (rhsM - rhsF * xs.main) / (xs.nose - xs.main);
    const Nm = rhsF - Nn;
    this.staticLoads = { nose: Nn, main: Nm, outriggerL: W * o, outriggerR: W * o, total: W, massKg: mDesign };
    // Línea de suelo estática (actitud de tierra DESIGN.groundPitchDeg) anclada en la rueda principal del JSON.
    const tg = Math.tan(DESIGN.groundPitchDeg * DEG);
    const mainG = g.gear.main;
    const defl = (id, Wi) => Wi / ((id === 'main' ? gu.main.tireK : id === 'nose' ? gu.nose.tireK : gu.outrigger.tireK) * g.gear[id].tireCount);
    const yGroundMain = mainG.axle[1] - mainG.wheelRadius + defl('main', Nm);
    this.groundLine = { x0: mainG.axle[0], y0: yGroundMain, tan: tg };
    this.gear = {};
    this.gearDiscrepancy = {};
    for (const id of GEAR_IDS) {
      const gg = g.gear[id];
      const up = id === 'nose' ? gu.nose : id === 'main' ? gu.main : gu.outrigger;
      const Wi = this.staticLoads[id];
      const yg = yGroundMain - tg * (gg.axle[0] - mainG.axle[0]);
      const ys = yg + gg.wheelRadius - defl(id, Wi);
      const axleStatic = [gg.axle[0], ys, gg.axle[2]];
      this.gearDiscrepancy[id] = ys - gg.axle[1];
      const unit = new GearUnit(id, gg, up, p.gear);
      unit.design(axleStatic, Wi, this.dtSub);
      unit.axleStatic = axleStatic;
      this.gear[id] = unit;
    }
  }

  _alloc() {
    this.pos = [0, 0, 0]; this.vel = [0, 0, 0]; this.quat = [0, 0, 0, 1]; this.omega = [0, 0, 0];
    this.F = [0, 0, 0]; this.Mb = [0, 0, 0]; this.Tw = [0, 0, 0];
    this.I = new Array(9).fill(0); this.Iinv = new Array(9).fill(0);
    this._t = { a: [0, 0, 0], b: [0, 0, 0], c: [0, 0, 0], d: [0, 0, 0], e: [0, 0, 0], q: [0, 0, 0, 1], ax: [0, 0, 0], n: [0, 0, 0] };
    this.air = { V: 0, alpha: 0, beta: 0, mach: 0, qbar: 0, rho: 1.225, T: 288.15, p: 101325, a: 340, vAirB: [0, 0, 0], windW: [0, 0, 0], windB: [0, 0, 0], agl: 0, hGround: 0, alphaDot: 0, prevAlpha: 0 };
    this.aeroOut = {}; this.atm = {};
    this.gust = [0, 0, 0];
    this.ctx = { pos: this.pos, vel: this.vel, quat: this.quat, omegaW: [0, 0, 0], cg: null, ext: 1, world: null, wetness: 0, dt: 0, brake: 0, parking: false, antiSkid: true, yawCmd: 0, gs: 0, Fw: [0, 0, 0], Tw: [0, 0, 0] };
    this._axTmp = [0, 0, 0];
    this.specific = [0, 0, 0];
  }

  // ---------------------------------------------------------------- masa / inercia
  _massProps() {
    const mp = this.p.mass;
    const fuel = this.engine.fuelKg, water = this.engine.waterKg;
    const m = mp.emptyKg + mp.pilotKg + fuel + water;
    const fuelRef = 2000, rg = mp.fuelRadiusGyr;
    const Ixx = mp.Ixx - fuelRef * rg.roll ** 2 + fuel * rg.roll ** 2 + water * 0.25;
    const Iyy = mp.Iyy - fuelRef * rg.pitch ** 2 + fuel * rg.pitch ** 2 + water * 0.25;
    const Izz = mp.Izz - fuelRef * rg.yaw ** 2 + fuel * rg.yaw ** 2 + water * 0.25;
    this.mass = m;
    this.inertiaConv = { Ixx, Iyy, Izz, Ixz: mp.Ixz };
    // Tensor en ejes cuerpo del contrato (x proa, y arriba, z derecha): yy = guiñada, zz = cabeceo.
    const I = this.I;
    I[0] = Ixx; I[1] = mp.Ixz; I[2] = 0;
    I[3] = mp.Ixz; I[4] = Izz; I[5] = 0;
    I[6] = 0; I[7] = 0; I[8] = Iyy;
    mat3Inv(this.Iinv, I);
  }

  // ---------------------------------------------------------------- API
  setWorld(world) { this.world = world || EMPTY_WORLD; }
  setEnvironment(e = {}) { Object.assign(this.env, e); }

  reset(o = {}) {
    const p = this.p, mp = p.mass;
    this.t = 0; this.events.length = 0; this.crashed = false; this.crashReason = null;
    this.dryden.reseed(this.seed);
    this.wingDropSign = 0; this._rngState = (this.seed * 2654435761) >>> 0;
    this.acc = 0;
    const state = o.state || 'parked';
    // Por defecto: tanques llenos; en 'hover', 50 % de combustible (con lleno se está al límite de empuje seco).
    const fuel = clamp(o.fuelKg ?? (state === 'hover' ? 0.5 * mp.fuelMaxKg : mp.fuelMaxKg), 0, mp.fuelMaxKg);
    const water = clamp(o.waterKg ?? mp.waterMaxKg, 0, mp.waterMaxKg);
    this.engine.reset(p.engine.idleNF, fuel, water);
    this.engine.flameout = false;
    this._massProps();
    const hdg = (o.headingDeg || 0) * DEG;
    const x = o.x || 0, z = o.z || 0;
    const hG = this.world.height(x, z);
    this.gearExt = (o.gearDown ?? (state !== 'cruise')) ? 1 : 0;
    this.gearCmdDown = this.gearExt === 1;
    this.flags = { onGround: false, weightOnWheels: false, stalled: false, inGroundEffect: false, hotGasIngestion: false, crashed: false, overspeed: false, gLimit: false };
    this.prevContact = {}; for (const id of GEAR_IDS) this.prevContact[id] = false;
    this.prevStalled = false;
    this.omega.fill(0);
    const flapIdx = o.flaps ?? (state === 'cruise' ? 0 : state === 'hover' ? 2 : 1);
    this.fc.reset(0, p.controls.flapDeg[clamp(flapIdx, 0, 2)]);
    this.trimInfo = { throttle: 0, stabilatorDeg: 0, nozzleDeg: 0, flaps: flapIdx, ok: true };
    for (const id of GEAR_IDS) { const u = this.gear[id]; u.u = this.gearExt ? u.uStatic : 0; u.uDot = 0; u.steerDeg = 0; for (const t of u.tires) { t.omega = 0; t.spin = 0; } }
    this.lastControls = { ...DEFAULT_CONTROLS, nozzleDeg: o.nozzleDeg ?? 0, flaps: flapIdx, gearDown: this.gearExt === 1 };

    if (state === 'parked') {
      const pitch = DESIGN.groundPitchDeg * DEG;
      quatFromAttitude(hdg, pitch, 0, this.quat);
      // Altura: rueda principal en su posición estática apoyada en el suelo.
      const main = this.gear.main, rb = [main.axleStatic[0] - this.cg[0], main.axleStatic[1] - this.cg[1], 0];
      const rw = qRotate([0, 0, 0], this.quat, rb);
      const defl = this.staticLoads.main / (main.up.tireK * main.tires.length);
      this.pos[0] = x; this.pos[2] = z;
      this.pos[1] = o.y ?? (hG - rw[1] + main.wheelRadius - defl);
      this.vel.fill(0);
      this.nozzles.reset(o.nozzleDeg ?? 0);
      this.engine.nf = p.engine.idleNF;
      // Asentamiento interno (no cuenta tiempo ni eventos).
      const c = { ...DEFAULT_CONTROLS, throttle: 0, parkingBrake: true, nozzleDeg: this.nozzles.angleDeg, flaps: flapIdx };
      for (let i = 0; i < Math.round(2.5 / this.dtSub); i++) this._substep(this.dtSub, c);
      this.t = 0; this.events.length = 0;
      this.trimInfo.nozzleDeg = this.nozzles.angleDeg;
    } else if (state === 'hover') {
      this.pos[0] = x; this.pos[2] = z; this.pos[1] = o.y ?? (hG + (o.aglM ?? 15));
      const noz = o.nozzleDeg ?? DESIGN.hoverNozzleDeg;
      this.nozzles.reset(noz);
      this._trim('hover', hdg, 0, noz);
    } else {
      this.pos[0] = x; this.pos[2] = z; this.pos[1] = o.y ?? (hG + (o.aglM ?? 300));
      const V = (o.speedKt ?? 300) * KT;
      const noz = o.nozzleDeg ?? 0;
      this.nozzles.reset(noz);
      this._trim('cruise', hdg, V, noz);
    }
    this.lastControls.throttle = this.trimInfo.throttle;
    this.lastControls.nozzleDeg = this.nozzles.angleDeg;
    this._updateDerived(this.lastControls);
    return this;
  }

  /** Avanza dt segundos (acumulador; subpasos fijos). */
  step(dt, controls) {
    const c = controls || this.lastControls;
    this.lastControls = c;
    this.acc += Math.min(Math.max(dt, 0), 0.25);
    const h = this.dtSub;
    while (this.acc >= h - 1e-12) { this._substep(h, c); this.acc -= h; }
    this._updateDerived(c);
    return this;
  }

  drainEvents() { const e = this.events.slice(); this.events.length = 0; return e; }
  _event(type, data) { this.events.push({ t: this.t, type, data }); if (this.events.length > 200) this.events.shift(); }

  // ---------------------------------------------------------------- subpaso
  _substep(dt, c) {
    if (this.crashed) { this.t += dt; return; }
    const p = this.p;
    this._airData(dt, true);
    // Actuadores.
    const a = this.air;
    const st = this._ctlState || (this._ctlState = {});
    st.p = this.omega[0]; st.q = this.omega[2]; st.r = -this.omega[1];
    const att = this._att || (this._att = {}); attitude(this.quat, att);
    st.pitchRad = att.pitchDeg * DEG; st.rollRad = att.rollDeg * DEG;
    st.ias = a.V * Math.sqrt(a.rho / 1.225); st.nozzleDeg = this.nozzles.angleDeg; st.gearDown = this.gearExt > 0.5;
    this.fc.update(dt, c, st, p.aero);
    // Tren (mando, enclavamiento de peso sobre ruedas).
    const wantDown = c.gearDown !== false;
    if (!wantDown && this.flags.weightOnWheels) { /* enclavamiento: no sube con peso en ruedas */ }
    else {
      const prev = this.gearExt;
      if (wantDown) this.gearExt = Math.min(1, this.gearExt + dt / p.gear.extendTimeS);
      else this.gearExt = Math.max(0, this.gearExt - dt / p.gear.retractTimeS);
      if (prev < 1 && this.gearExt === 1) this._event('gearLock', { down: true });
      if (prev > 0 && this.gearExt === 0) this._event('gearLock', { down: false });
    }
    this.gearCmdDown = wantDown;
    const hgiK = hotGasIngestion(p.groundJet, this._hNoz, a.vAirB[0], this.nozzles.angleDeg);
    this.hgiK = hgiK;
    const theta2 = (a.T + hgiK) / 288.15, delta = a.p / 101325;
    const wasFlameout = this.engine.flameout;
    this.engine.update(dt, clamp(c.throttle ?? 0, 0, 1), !!c.waterInjection, theta2, delta, a.mach);
    if (!wasFlameout && this.engine.flameout) this._event('flameout', {});
    const pr = RCS.pressureFromNF(this.engine.nf);
    this.nozzles.update(dt, c.nozzleDeg ?? 0, this.engine.flameout ? 0 : Math.max(pr, 0.15));
    this.rcs.update(dt, this.fc.pitchDemand, this.fc.rollDemand, this.fc.yawDemand, this.nozzles.angleDeg, this.engine.nf, !this.engine.flameout);
    this._massProps();
    // Fuerzas.
    this._forces(dt, c, true);
    // Integración (Euler semi-implícito; rotación por exponencial exacta del paso).
    integrateRigid(this, this.F, this.Mb, this.mass, this.I, this.Iinv, dt);
    this.t += dt;
    this._checks(dt);
  }

  /** Datos de aire (atmósfera, viento, turbulencia, α, β, Mach, q̄). */
  _airData(dt, advanceTurb) {
    const a = this.air, env = this.env, t = this._t;
    atmosphere(this.pos[1], env, this.atm);
    a.rho = this.atm.rho; a.T = this.atm.T; a.p = this.atm.p; a.a = this.atm.a;
    a.hGround = this.world.height(this.pos[0], this.pos[2]);
    a.agl = this.pos[1] - a.hGround;
    meanWind(env, a.agl, a.windW);
    // Turbulencia en ejes de la masa de aire (lon según rumbo del avión).
    if (advanceTurb) {
      const tasEst = Math.hypot(this.vel[0] - a.windW[0], this.vel[2] - a.windW[2]);
      this.dryden.step(dt, env.turbulence || 0, a.agl, tasEst, this.gust);
    }
    qRotate(t.e, this.quat, [1, 0, 0]);
    const hx = t.e[0], hz = t.e[2], hl = Math.hypot(hx, hz) || 1;
    const fx = hx / hl, fz = hz / hl; // adelante horizontal
    a.windW[0] += this.gust[0] * fx - this.gust[1] * fz; // lateral: derecha = (-fz, fx)?  derecha = adelante × arriba
    a.windW[2] += this.gust[0] * fz + this.gust[1] * fx;
    a.windW[1] += this.gust[2];
    t.a[0] = this.vel[0] - a.windW[0]; t.a[1] = this.vel[1] - a.windW[1]; t.a[2] = this.vel[2] - a.windW[2];
    qRotateInv(a.vAirB, this.quat, t.a);
    qRotateInv(a.windB, this.quat, a.windW);
    const u = a.vAirB[0], v = a.vAirB[2], wc = -a.vAirB[1];
    a.V = Math.hypot(u, v, wc);
    const alpha = a.V > 0.5 ? Math.atan2(wc, u) : 0;
    a.beta = a.V > 0.5 ? Math.asin(clamp(v / a.V, -1, 1)) : 0;
    if (dt > 0) { const ad = (alpha - a.prevAlpha) / dt; a.alphaDot = Math.abs(ad) < 20 ? ad : 0; }
    a.prevAlpha = alpha; a.alpha = alpha;
    a.mach = a.V / a.a; a.qbar = 0.5 * a.rho * a.V * a.V;
    // Altura media de las toberas sobre el suelo.
    qRotate(t.b, this.quat, [this.thrustCentroid[0] - this.cg[0], this.thrustCentroid[1] - this.cg[1], 0]);
    this._hNoz = a.agl + t.b[1];
  }

  /** Suma de fuerzas (mundo, this.F) y momentos (cuerpo, this.Mb) respecto del CG. */
  _forces(dt, c, withGround) {
    const p = this.p, a = this.air, t = this._t, F = this.F, Mb = this.Mb;
    const fb = this._fb || (this._fb = [0, 0, 0]);
    fb[0] = fb[1] = fb[2] = 0; Mb[0] = Mb[1] = Mb[2] = 0;
    const addB = (fx, fy, fz, r) => { // fuerza en cuerpo aplicada en r (cuerpo, relativo al CG)
      fb[0] += fx; fb[1] += fy; fb[2] += fz;
      if (r) { Mb[0] += r[1] * fz - r[2] * fy; Mb[1] += r[2] * fx - r[0] * fz; Mb[2] += r[0] * fy - r[1] * fx; }
    };
    // --- Aerodinámica (sólo si hay velocidad apreciable).
    const ao = this.aeroOut;
    if (a.V > 1) {
      const hWing = a.agl - 1.0;
      computeAero(this.aeroModel, {
        V: a.V, alpha: a.alpha, beta: a.beta, pr: this.omega[0], qr: this.omega[2], rr: -this.omega[1], alphaDot: a.alphaDot,
        mach: a.mach, flapsDeg: this.fc.flapsDeg, gearExt: this.gearExt, gearTransit: this.gearExt > 0 && this.gearExt < 1,
        airbrakeDeg: this.fc.airbrakeDeg, stabDeg: this.fc.stabDeg, aileronDeg: this.fc.aileronDeg, rudderDeg: this.fc.rudderDeg,
        hWing, wingDropSign: this.wingDropSign,
      }, a.qbar, ao);
      // Convencional (X proa, Y der., Z abajo) -> cuerpo (x proa, y arriba, z der.)
      addB(ao.X, -ao.Z, ao.Y, null);
      Mb[0] += ao.Lm; Mb[1] += -ao.Nm; Mb[2] += ao.Mm;
    } else { ao.stalled = false; ao.inGroundEffect = false; ao.CL = 0; ao.CD = 0; }
    // --- Empuje de toberas.
    const eng = this.engine;
    const gross = Math.max(eng.grossN - this.rcs.thrustLossN, 0);
    const split = eng.frontSplit();
    const th = this.nozzles.angleDeg * DEG, ct = Math.cos(th), sn = Math.sin(th);
    const Ff = gross * split / 2, Fr = gross * (1 - split) / 2;
    this.nozzleThrust = { front: Ff * 2, rear: Fr * 2 };
    addB(Ff * ct, Ff * sn, 0, this.r.noz.frontL); addB(Ff * ct, Ff * sn, 0, this.r.noz.frontR);
    addB(Fr * ct, Fr * sn, 0, this.r.noz.rearL); addB(Fr * ct, Fr * sn, 0, this.r.noz.rearR);
    // --- Efectos inducidos por los chorros (suelo + transición): fracción del empuje vertical.
    const jl = jetInducedLift(p.groundJet, this._hNoz, a.V, this.nozzles.angleDeg);
    this.jetLift = jl;
    addB(0, jl.total * gross * Math.max(sn, 0), 0, null);
    // --- Resistencia de toma (ram drag): -ṁ · v_local en el labio de toma.
    const ri = this.r.intake;
    cross(t.a, this.omega, ri);
    const md = eng.massFlow;
    const vl0 = a.vAirB[0] + t.a[0], vl1 = a.vAirB[1] + t.a[1], vl2 = a.vAirB[2] + t.a[2];
    this.ramDragN = md * Math.hypot(vl0, vl1, vl2);
    addB(-md * vl0, -md * vl1, -md * vl2, ri);
    // --- RCS.
    for (const id of RCS_IDS) {
      const v = this.rcs.valves[id];
      if (v.forceN !== 0) addB(v.dir[0] * Math.abs(v.forceN), v.dir[1] * Math.abs(v.forceN), v.dir[2] * Math.abs(v.forceN), v.r);
    }
    // A mundo.
    qRotate(F, this.quat, fb);
    F[1] -= this.mass * G0;
    // Fuerza específica (factores de carga) en cuerpo, sin suelo todavía.
    if (withGround) this._ground(dt, c);
    // Fuerza específica = (F + m g)/m
    t.a[0] = F[0]; t.a[1] = F[1] + this.mass * G0; t.a[2] = F[2];
    qRotateInv(this.specific, this.quat, t.a);
    this.specific[0] /= this.mass * G0; this.specific[1] /= this.mass * G0; this.specific[2] /= this.mass * G0;
  }

  /** Tren + puntos duros + obstáculos. Suma a this.F (mundo) y this.Mb (cuerpo). */
  _ground(dt, c) {
    const ctx = this.ctx, t = this._t;
    ctx.cg = this.cg; ctx.ext = this.gearExt; ctx.world = this.world; ctx.wetness = this.env.surfaceWetness || 0; ctx.dt = dt;
    ctx.brake = clamp(c.brake || 0, 0, 1); ctx.parking = !!c.parkingBrake; ctx.antiSkid = c.antiSkid !== false;
    ctx.yawCmd = c.yaw || 0; ctx.gs = Math.hypot(this.vel[0], this.vel[2]);
    qRotate(ctx.omegaW, this.quat, this.omega);
    ctx.Fw[0] = ctx.Fw[1] = ctx.Fw[2] = 0; ctx.Tw[0] = ctx.Tw[1] = ctx.Tw[2] = 0;
    const nearGround = this.air.agl < 12;
    if (nearGround || this.gearExt < 1) {
      for (const id of GEAR_IDS) stepGearUnit(this.gear[id], ctx, this._axTmp);
    } else {
      for (const id of GEAR_IDS) { const u = this.gear[id]; u.contact = false; u.loadN = 0; for (const tt of u.tires) { tt.contact = false; tt.N = 0; tt.omega *= Math.exp(-dt * 0.3); tt.spin += tt.omega * dt; } u.u += (0 - u.u) * Math.min(1, dt * 20); u.uDot = 0; }
    }
    // Puntos duros (fuselaje, puntas de ala) + salidas de toberas.
    if (nearGround) this._hardpoints(dt, ctx);
    this.F[0] += ctx.Fw[0]; this.F[1] += ctx.Fw[1]; this.F[2] += ctx.Fw[2];
    qRotateInv(t.a, this.quat, ctx.Tw);
    this.Mb[0] += t.a[0]; this.Mb[1] += t.a[1]; this.Mb[2] += t.a[2];
  }

  _hardpoints(dt, ctx) {
    const pc = this.p.contact, t = this._t, w = this.world;
    const th = this.nozzles.angleDeg * DEG;
    const list = this._hpList || (this._hpList = [...this.r.hard, ...['frontL', 'frontR', 'rearL', 'rearR'].map((id) => ({ id: 'nozzle_' + id, noz: id, r: [0, 0, 0], contact: false }))]);
    for (const h of list) {
      if (h.noz) { // salida de tobera: a ~0,45 m del pivote, opuesta al empuje
        const base = this.r.noz[h.noz];
        h.r[0] = base[0] - 0.45 * Math.cos(th); h.r[1] = base[1] - 0.45 * Math.sin(th); h.r[2] = base[2];
      }
      qRotate(t.b, this.quat, h.r);
      const x = this.pos[0] + t.b[0], y = this.pos[1] + t.b[1], z = this.pos[2] + t.b[2];
      const hg = w.height(x, z);
      const pen = hg - y;
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

  _rand() { // PRNG interno determinista para la caída de ala en pérdida
    let x = this._rngState; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this._rngState = x >>> 0; return this._rngState / 4294967296;
  }

  _checks(dt) {
    const p = this.p, a = this.air, f = this.flags;
    // Pérdida
    const stalled = !!this.aeroOut.stalled && a.V > 15;
    if (stalled && !this.prevStalled) {
      if (this.wingDropSign === 0) this.wingDropSign = this._rand() < 0.5 ? -1 : 1;
      if (this.t - (this._lastStallEv ?? -1e9) > 3) { this._lastStallEv = this.t; this._event('stall', { aoaDeg: a.alpha / DEG }); }
    }
    if ((this.aeroOut.stallBlend || 0) < 0.05) this.wingDropSign = 0;
    this.prevStalled = stalled; f.stalled = stalled;
    // Toques de tren
    let any = false;
    for (const id of GEAR_IDS) {
      const u = this.gear[id];
      if (u.contact && !this.prevContact[id]) {
        const vs = this.vel[1];
        if (!this._anyPrevContact()) this._event('touchdown', { unit: id, sinkMs: -vs });
        if (-vs > p.gear.crashSinkMs) this._crash('gearCollapse:' + id, { sinkMs: -vs });
        else if (-vs > p.gear.hardSinkMs) this._event('hardLanding', { unit: id, sinkMs: -vs });
      }
      if (u.contact) any = true;
    }
    for (const id of GEAR_IDS) this.prevContact[id] = this.gear[id].contact;
    f.weightOnWheels = any && (this.gear.main.loadN + this.gear.nose.loadN) > 0.1 * this.mass * G0;
    f.onGround = any || this.r.hard.some((h) => h.contact);
    if (any && this.gearExt < 1 && this.gearExt > 0) this._crash('gearNotLocked', {});
    // Obstáculos (≈30 Hz)
    this._obsT = (this._obsT || 0) + dt;
    if (this._obsT > 1 / 30 && this.world.obstacles && this.world.obstacles.query) { this._obsT = 0; this._obstacles(); }
    // Límites
    const ias = a.V * Math.sqrt(a.rho / 1.225) / KT;
    const nz = this.specific[1];
    const gl = nz > 7.8 || nz < -4.2;
    if (gl && !f.gLimit) this._event('gLimit', { nz });
    f.gLimit = gl;
    const over = (this.gearExt > 0 && ias > p.gear.limitSpeedKt) || a.mach > 0.98;
    if (over && !f.overspeed) this._event('overspeed', { iasKt: ias, mach: a.mach });
    f.overspeed = over;
    if (![this.pos[0], this.pos[1], this.pos[2], this.vel[0], this.vel[1], this.vel[2], this.omega[0], this.omega[1], this.omega[2]].every(Number.isFinite)) {
      this._crash('numeric', {});
    }
  }
  _anyPrevContact() { for (const id of GEAR_IDS) if (this.prevContact[id]) return true; return false; }

  _obstacles() {
    const o = this.world.obstacles, out = this._obsOut || (this._obsOut = []);
    out.length = 0;
    const res = o.query(this.pos[0], this.pos[2], 8, out, 16);
    const arr = Array.isArray(res) ? res : out;
    const n = typeof res === 'number' ? res : arr.length;
    for (let i = 0; i < n; i++) {
      const ob = arr[i]; if (!ob) continue;
      const r = ob.r ?? ob.radius ?? 1, hgt = ob.h ?? ob.height ?? 10;
      const base = ob.y ?? this.world.height(ob.x, ob.z);
      for (const hp of [{ r: [0, 0, 0] }, ...this.r.hard]) {
        const t = this._t; qRotate(t.b, this.quat, hp.r);
        const x = this.pos[0] + t.b[0], y = this.pos[1] + t.b[1], z = this.pos[2] + t.b[2];
        if (Math.hypot(x - ob.x, z - ob.z) < r + 0.3 && y < base + hgt && y > base - 1) { this._crash('obstacle', { obstacle: ob.type || 'obstacle' }); return; }
      }
    }
  }

  // ---------------------------------------------------------------- trim
  /** Evalúa fuerzas sin integrar (actuadores fijados). Devuelve residuos [Fh, Fv, Mpitch] normalizados. */
  _trimEval(mode, hdg, V, noz, x) {
    const [pitch, stab, nf] = x;
    const alphaOrPitch = pitch;
    quatFromAttitude(hdg, alphaOrPitch, 0, this.quat);
    const fwdH = [Math.sin(hdg), 0, -Math.cos(hdg)];
    this.vel[0] = fwdH[0] * V; this.vel[1] = 0; this.vel[2] = fwdH[2] * V;
    this.omega.fill(0);
    this.gust.fill(0);
    this._airData(0, false); this.air.alphaDot = 0;
    this.fc.trimDeg = stab; this.fc.stabDeg = stab; this.fc.aileronDeg = 0; this.fc.rudderDeg = 0;
    this.fc.pitchDemand = clamp(this.fc.stabToDemand(stab), -1, 1); this.fc.rollDemand = 0; this.fc.yawDemand = 0;
    this.nozzles.reset(noz);
    this.engine.nf = nf;
    const a = this.air;
    this.hgiK = hotGasIngestion(this.p.groundJet, this._hNoz, a.vAirB[0], noz);
    this.engine.update(0, 1, false, (a.T + this.hgiK) / 288.15, a.p / 101325, a.mach);
    this.engine.nf = nf;
    this.rcs.update(1e3, this.fc.pitchDemand, 0, 0, noz, nf, true);
    this._forces(0, this.lastControls, false);
    const W = this.mass * G0;
    return [(this.F[0] * fwdH[0] + this.F[2] * fwdH[2]) / W, this.F[1] / W, this.Mb[2] / (W * this.p.aero.cbar)];
  }

  _trim(mode, hdg, V, noz) {
    const p = this.p;
    let x = mode === 'hover' ? [(90 - noz) * DEG, 0, 95] : [4 * DEG, -1, 85];
    const lo = [-15 * DEG, -p.controls.stabTEupDeg, p.engine.idleNF], hi = [25 * DEG, p.controls.stabTEdownDeg, p.engine.dryMaxNF];
    let r = this._trimEval(mode, hdg, V, noz, x), err = Math.hypot(...r);
    const h = [1e-4, 1e-3, 1e-3];
    for (let it = 0; it < 40 && err > 1e-7; it++) {
      const J = [];
      for (let j = 0; j < 3; j++) {
        const xp = x.slice(); xp[j] += h[j];
        const rp = this._trimEval(mode, hdg, V, noz, xp);
        J.push([(rp[0] - r[0]) / h[j], (rp[1] - r[1]) / h[j], (rp[2] - r[2]) / h[j]]);
      }
      // Resolver J^T columnas: A[i][j] = d r_i / d x_j
      const A = [[J[0][0], J[1][0], J[2][0]], [J[0][1], J[1][1], J[2][1]], [J[0][2], J[1][2], J[2][2]]];
      const Ai = mat3Inv(new Array(9), A.flat());
      const dx = mat3MulV([0, 0, 0], Ai, r);
      if (!dx.every(Number.isFinite)) break;
      let s = 1;
      for (let ls = 0; ls < 8; ls++) {
        const xn = [0, 1, 2].map((k) => clamp(x[k] - s * dx[k], lo[k], hi[k]));
        const rn = this._trimEval(mode, hdg, V, noz, xn), en = Math.hypot(...rn);
        if (en < err || ls === 7) { x = xn; r = rn; err = en; break; }
        s *= 0.5;
      }
    }
    this._trimEval(mode, hdg, V, noz, x);
    const e = p.engine;
    this.trimInfo = {
      ok: err < 1e-4, residual: err, pitchDeg: x[0] / DEG, stabilatorDeg: x[1], nf: x[2], nozzleDeg: noz,
      throttle: clamp((x[2] - e.idleNF) / (e.dryMaxNF - e.idleNF), 0, 1), flaps: this.trimInfo.flaps,
    };
    this.fc.trimDeg = x[1];
    for (const v of Object.values(this.rcs.valves)) v.forceN = v.forceN; // ya en régimen
  }

  // ---------------------------------------------------------------- estado
  _updateDerived(c) { this._lastC = c; }

  getState(out = {}) {
    const a = this.air, eng = this.engine, att = attitude(this.quat, {});
    out.t = this.t;
    out.pos = this.pos.slice(); out.quat = this.quat.slice(); out.vel = this.vel.slice(); out.omega = this.omega.slice();
    out.rates = { p: this.omega[0], q: this.omega[2], r: -this.omega[1] }; // rad/s, convención aeronáutica
    out.att = att;
    out.cgModel = this.cg.slice();
    out.massKg = this.mass;
    const ias = a.V * Math.sqrt(a.rho / 1.225);
    out.air = {
      iasKt: ias / KT, tasKt: a.V / KT, machNo: a.mach, aoaDeg: a.alpha / DEG, betaDeg: a.beta / DEG, qbar: a.qbar, rho: a.rho,
      tempK: a.T, altMslM: this.pos[1], altAglM: a.agl, vsMs: this.vel[1], gs: Math.hypot(this.vel[0], this.vel[2]),
      nz: this.specific[1], ny: this.specific[2], nx: this.specific[0], windBody: a.windB.slice(), windWorld: a.windW.slice(),
      CL: this.aeroOut.CL || 0, CD: this.aeroOut.CD || 0,
    };
    out.engine = {
      rpmPct: eng.nf, nfCorrPct: eng.nfc, thrustN: Math.max(eng.grossN - this.rcs.thrustLossN, 0), grossN: eng.grossN,
      ramDragN: this.ramDragN || 0, massFlowKgS: eng.massFlow, fuelKg: eng.fuelKg, fuelFlowKgS: eng.fuelFlow, jptC: eng.jptC,
      waterKg: eng.waterKg, waterOn: eng.waterOn, bleedPct: this.rcs.bleedPct || 0, bleedKgS: this.rcs.bleedKgS, stall: false,
      flameout: eng.flameout, hgiK: this.hgiK || 0,
    };
    const nz = this.nozzleThrust || { front: 0, rear: 0 };
    const g = this.geom.nozzles;
    out.nozzles = {
      cmdDeg: this.nozzles.cmdDeg, angleDeg: this.nozzles.angleDeg, rateDegS: this.nozzles.rateDegS,
      front: { thrustN: nz.front, posL: g.frontL.pos.slice(), posR: g.frontR.pos.slice() },
      rear: { thrustN: nz.rear, posL: g.rearL.pos.slice(), posR: g.rearR.pos.slice() },
      jetLiftFrac: this.jetLift ? this.jetLift.total : 0,
    };
    out.rcs = { pressurePct: 100 * this.rcs.pressureFrac, phase: this.rcs.phase, bleedKgS: this.rcs.bleedKgS };
    for (const id of RCS_IDS) {
      const v = this.rcs.valves[id];
      out.rcs[id] = { forceN: Math.abs(v.forceN), dir: v.dir.slice(), posModel: v.pos.slice() };
    }
    out.controlSurfaces = {
      stabilatorDeg: this.fc.stabDeg, aileronLDeg: -this.fc.aileronDeg, aileronRDeg: this.fc.aileronDeg, rudderDeg: this.fc.rudderDeg,
      flapsDeg: this.fc.flapsDeg, airbrakeDeg: this.fc.airbrakeDeg,
    };
    const units = [];
    for (const id of GEAR_IDS) {
      const u = this.gear[id], t0 = u.tires[0];
      const wp = [0, 0, 0];
      for (const t of u.tires) { wp[0] += t.pos[0] / u.tires.length; wp[1] += t.pos[1] / u.tires.length; wp[2] += t.pos[2] / u.tires.length; }
      units.push({
        id, parts: GEAR_PARTS[id], contact: u.contact, compression: u.stroke ?? 0, compressionFrac: clamp((u.stroke ?? 0) / u.Stot, 0, 1),
        wheelTravel: u.u, armAngleDeg: u.armAngleDeg(), steerDeg: u.steerDeg, spinRad: t0.spin, wheelSpeedRadS: t0.omega,
        loadN: u.loadN, strutForceN: u.strutForce || 0, slip: { long: t0.slipLong, lat: t0.slipLat }, surface: t0.surface,
        skid: u.tires.some((t) => t.skid), brakeTorqueNm: u.tires.reduce((s, t) => s + t.brakeT, 0), wheelPosWorld: wp,
        tireDeflection: t0.defl, bottomed: !!u.bottomed,
        tires: u.tires.map((t, k) => ({ part: GEAR_PARTS[id].wheels[k], contact: t.contact, loadN: t.N, spinRad: t.spin, wheelSpeedRadS: t.omega, posWorld: t.pos.slice(), deflection: t.defl, skid: t.skid })),
      });
    }
    out.gear = { state: this.gearExt >= 1 ? 'down' : this.gearExt <= 0 ? 'up' : 'transit', extension: this.gearExt, units };
    this.flags.inGroundEffect = !!this.aeroOut.inGroundEffect || (this._hNoz < 3 * this.p.groundJet.De && this.nozzles.angleDeg > 30);
    this.flags.hotGasIngestion = (this.hgiK || 0) > 2;
    this.flags.crashed = this.crashed;
    out.flags = { ...this.flags };
    const w = [];
    if (this.flags.stalled) w.push('STALL');
    if (this.gearExt < 1 && a.agl < 150 && ias < 90 * KT && this.vel[1] < 0) w.push('GEAR');
    if (eng.fuelKg < 400) w.push('BINGO');
    if (eng.jptC > this.p.engine.jptLimitC - 10) w.push('OVERTEMP');
    if (eng.flameout) w.push('ENGINE');
    if (this.flags.overspeed) w.push('OVERSPEED');
    if (this.flags.gLimit) w.push('G LIMIT');
    if (this.flags.hotGasIngestion) w.push('HOT GAS');
    if (eng.waterOn && eng.waterKg < 30) w.push('WATER');
    out.warnings = w;
    out.trim = { ...this.trimInfo, currentStabTrimDeg: this.fc.trimDeg };
    out.crashReason = this.crashReason;
    return out;
  }
}
