import { test } from 'node:test';
import assert from 'node:assert/strict';
import { A10Sim } from '../../src/physics/index.js';
import { liftCurve, makeA10Aero } from '../../src/physics/a10.aero.js';
import { a10Controls, attitudeHold, clamp, KT, FT, G0 } from './a10helpers.mjs';

test('A-10: trim a 300 KIAS / 5000 ft y 60 s estables con SAS (sin mandos)', () => {
  const sim = new A10Sim({ seed: 3 });
  sim.reset({ state: 'cruise', speedKt: 300, altFt: 5000, fuelKg: 3000 });
  assert.ok(sim.trimInfo.ok, 'trim resuelto dentro del recorrido del compensador');
  const c = a10Controls({ gearDown: false, throttle: sim.trimInfo.throttle });
  const s0 = sim.getState();
  let maxDev = { ias: 0, alt: 0, pitch: 0, roll: 0, hdg: 0 };
  for (let i = 0; i < 60 * 60; i++) {
    sim.step(1 / 60, c);
    const s = sim.getState();
    maxDev.ias = Math.max(maxDev.ias, Math.abs(s.air.iasKt - 300));
    maxDev.alt = Math.max(maxDev.alt, Math.abs(s.pos[1] - s0.pos[1]) / FT);
    maxDev.pitch = Math.max(maxDev.pitch, Math.abs(s.att.pitchDeg - s0.att.pitchDeg));
    maxDev.roll = Math.max(maxDev.roll, Math.abs(s.att.rollDeg));
  }
  console.log(`  trim: α ${sim.trimInfo.aoaDeg.toFixed(2)}°, gases ${(sim.trimInfo.throttle * 100).toFixed(1)} %, compensador ${sim.trimInfo.elevatorTrimDeg.toFixed(2)}°; desvío máx. en 60 s: ${maxDev.ias.toFixed(2)} kt, ${maxDev.alt.toFixed(1)} ft, cabeceo ${maxDev.pitch.toFixed(2)}°, alabeo ${maxDev.roll.toFixed(3)}°`);
  assert.ok(maxDev.ias < 3 && maxDev.alt < 60 && maxDev.pitch < 1 && maxDev.roll < 0.5);
});

test('A-10: perturbación (escalón de palanca y pedal) amortiguada por el SAS; con turbulencia no diverge', () => {
  const sim = new A10Sim({ seed: 5 });
  sim.reset({ state: 'cruise', speedKt: 300, altFt: 5000, fuelKg: 3000 });
  const c = a10Controls({ gearDown: false, throttle: sim.trimInfo.throttle });
  c.pitch = 0.3; c.yaw = 0.5;
  for (let i = 0; i < 30; i++) sim.step(1 / 60, c);
  c.pitch = 0; c.yaw = 0;
  for (let i = 0; i < 60 * 8; i++) sim.step(1 / 60, c);
  const s = sim.getState();
  console.log(`  8 s después del pulso: q ${(s.rates.q / 0.01745).toFixed(2)}°/s, r ${(s.rates.r / 0.01745).toFixed(2)}°/s, β ${s.air.betaDeg.toFixed(2)}°`);
  assert.ok(Math.abs(s.rates.q) < 0.5 * 0.01745 && Math.abs(s.rates.r) < 0.5 * 0.01745);
  sim.setEnvironment({ turbulence: 0.5, windKt: 15, windFromDeg: 270 });
  for (let i = 0; i < 60 * 60; i++) { const st = sim.getState(); attitudeHold(c, st, sim.trimInfo.pitchDeg, 0); sim.step(1 / 60, c); }
  const s2 = sim.getState();
  assert.ok(!s2.flags.crashed && Number.isFinite(s2.pos[1]) && Math.abs(s2.att.rollDeg) < 20);
});

test('A-10: velocidad de pérdida en rango (≈120 KIAS a 30 000 lb, limpio) y pérdida suave', () => {
  const sim = new A10Sim({ seed: 1 });
  const mStall = 30000 * 0.45359237;
  const fuel = mStall - (sim.p.mass.emptyKg + sim.p.mass.pilotKg + sim.p.mass.ammoMaxKg);
  sim.reset({ state: 'cruise', speedKt: 170, altFt: 5000, fuelKg: fuel });
  const model = makeA10Aero(sim.p.aero);
  const CLmax = liftCurve(model, 0, 0.18, 0).CLmax;
  const vs1g = Math.sqrt(2 * sim.mass * G0 / (1.225 * sim.p.aero.S * CLmax)) / KT;
  // Entrada lenta en pérdida: gases bajos, se mantiene altura hasta la pérdida (desaceleración ≈ 1 kt/s).
  const c = a10Controls({ gearDown: false, throttle: 0 });
  let ev = null, iasAtStall = 0, maxRollRate = 0, minRoll = 0;
  const h0 = sim.pos[1];
  for (let i = 0; i < 60 * 90 && !ev; i++) {
    const s = sim.getState();
    const vsErr = -(s.pos[1] - h0) * 0.05 - s.vel[1];
    c.pitch = clamp(c.pitch + 0.004 * vsErr - 0.02 * s.rates.q * 57.3 / 10, -1, 1);
    c.roll = clamp(-0.05 * s.att.rollDeg - 0.05 * s.rates.p * 57.3, -1, 1);
    sim.step(1 / 60, c);
    ev = sim.events.find((e) => e.type === 'stall');
    if (ev) iasAtStall = sim.getState().air.iasKt;
  }
  assert.ok(ev, 'hubo pérdida');
  // 3 s en pérdida con la palanca atrás: caída de ala moderada.
  c.pitch = 1; c.roll = 0;
  for (let i = 0; i < 180; i++) { sim.step(1 / 60, c); const s = sim.getState(); maxRollRate = Math.max(maxRollRate, Math.abs(s.rates.p) / 0.01745); minRoll = Math.max(minRoll, Math.abs(s.att.rollDeg)); }
  console.log(`  masa ${sim.mass.toFixed(0)} kg: CLmax ${CLmax.toFixed(3)}, Vs(1 g) ${vs1g.toFixed(1)} KIAS; aviso de pérdida a ${iasAtStall.toFixed(1)} KIAS, α ${ev.data.aoaDeg.toFixed(1)}°; caída de ala: p máx. ${maxRollRate.toFixed(1)}°/s, alabeo ${minRoll.toFixed(1)}° en 3 s`);
  assert.ok(vs1g > 110 && vs1g < 130, 'Vs 1 g en rango');
  assert.ok(iasAtStall > 95 && iasAtStall < 130);
  assert.ok(maxRollRate < 40, 'caída de ala moderada, no violenta');
  // Recuperación: palanca adelante y gases.
  c.throttle = 1;
  let tRec = null;
  for (let i = 0; i < 60 * 10; i++) {
    const s = sim.getState();
    c.pitch = clamp(0.15 * (2 - s.air.aoaDeg), -1, 0.3);
    c.roll = clamp(-0.04 * s.att.rollDeg - 0.05 * s.rates.p * 57.3, -1, 1);
    sim.step(1 / 60, c);
    if (tRec === null && !sim.getState().flags.stalled) tRec = i / 60;
  }
  const sr = sim.getState();
  console.log(`  recuperación: sin pérdida a los ${tRec?.toFixed(1)} s; a los 10 s α ${sr.air.aoaDeg.toFixed(1)}°, alabeo ${sr.att.rollDeg.toFixed(1)}°`);
  assert.ok(tRec !== null && tRec < 3 && !sr.flags.stalled && !sr.flags.crashed && Math.abs(sr.att.rollDeg) < 10);
});

test('A-10: régimen de alabeo ≈100°/s a 300 KIAS', () => {
  const sim = new A10Sim({ seed: 1 });
  sim.reset({ state: 'cruise', speedKt: 300, altFt: 5000, fuelKg: 3000 });
  const c = a10Controls({ gearDown: false, throttle: sim.trimInfo.throttle, roll: 1 });
  let pmax = 0, t63 = null;
  for (let i = 0; i < 120; i++) { sim.step(1 / 60, c); const p = sim.getState().rates.p / 0.01745; pmax = Math.max(pmax, p); }
  sim.reset({ state: 'cruise', speedKt: 300, altFt: 5000, fuelKg: 3000 });
  for (let i = 0; i < 120 && t63 === null; i++) { sim.step(1 / 60, c); if (sim.getState().rates.p / 0.01745 > 0.63 * pmax) t63 = sim.t; }
  console.log(`  p máx. ${pmax.toFixed(1)}°/s; 63 % en ${t63.toFixed(2)} s (incluye servo a 50°/s)`);
  assert.ok(pmax > 85 && pmax < 120);
});

test('A-10: techo por empuje (gases necesarios a velocidad óptima) y velocidad máxima a nivel del mar', () => {
  const sim = new A10Sim({ seed: 1 });
  const minThr = (ft) => {
    let best = 9;
    for (let kt = 120; kt <= 260; kt += 10) { sim.reset({ state: 'cruise', speedKt: kt, altFt: ft, fuelKg: 1500 }); if (sim.trimInfo.residual < 1e-5 && sim.trimInfo.throttle < best) best = sim.trimInfo.throttle; }
    return best;
  };
  // Busca la altitud donde el empuje máximo apenas sostiene el vuelo nivelado (≈ techo absoluto) con 1500 kg de combustible.
  let lo = 30000, hi = 60000;
  for (let k = 0; k < 10; k++) { const mid = (lo + hi) / 2; if (minThr(mid) < 0.999) lo = mid; else hi = mid; }
  let vmax = 300;
  for (let kt = 300; kt <= 480; kt += 2) { sim.reset({ state: 'cruise', speedKt: kt, altFt: 1000, fuelKg: 2500 }); if (sim.trimInfo.throttle >= 0.999) break; vmax = kt; }
  console.log(`  techo absoluto (≈${(sim.mass / 1000).toFixed(1)} t) ${lo.toFixed(0)} ft; Vmax a 1000 ft ≈ ${vmax} KIAS (limpio con pilones)`);
  assert.ok(lo > 38000 && lo < 52000);
  assert.ok(vmax > 360 && vmax < 420);
});

test('A-10: consumo (TSFC 0,37 estático; crucero 300 kt / 5000 ft)', () => {
  const sim = new A10Sim({ seed: 1 });
  sim.reset({ state: 'parked' });
  const c = a10Controls({ throttle: 1, parkingBrake: true });
  for (let i = 0; i < 60 * 12; i++) sim.step(1 / 60, c);
  let s = sim.getState();
  const tsfc = s.engine.fuelFlowKgS * 3600 / 0.45359237 / (s.engine.thrustN / 4.4482216);
  sim.reset({ state: 'cruise', speedKt: 300, altFt: 5000, fuelKg: 4000 });
  const c2 = a10Controls({ gearDown: false, throttle: sim.trimInfo.throttle });
  const f0 = sim.fuelKg, m0 = sim.mass;
  for (let i = 0; i < 60 * 60; i++) sim.step(1 / 60, c2);
  s = sim.getState();
  const burnKgH = (f0 - s.mass.fuelKg) * 60;
  console.log(`  estático máx.: ${(s.engine.thrustN ? '' : '')}TSFC ${tsfc.toFixed(3)} lb/(lbf·h); crucero: ${burnKgH.toFixed(0)} kg/h (autonomía con 4853 kg ≈ ${(4853 / burnKgH).toFixed(1)} h); masa −${(m0 - sim.mass).toFixed(1)} kg en 60 s; CG x ${s.cgModel[0].toFixed(3)} m`);
  assert.ok(Math.abs(tsfc - 0.37) < 0.02);
  assert.ok(burnKgH > 1000 && burnKgH < 2600);
  assert.ok(Math.abs((f0 - s.mass.fuelKg) - (m0 - sim.mass)) < 1e-6, 'la masa baja con el combustible');
});

test('A-10: spool-up de ralentí a 95 % del empuje en 6–8 s', () => {
  const sim = new A10Sim({ seed: 1 });
  sim.reset({ state: 'parked' });
  const c = a10Controls({ throttle: 1, parkingBrake: true });
  const Fmax = 2 * sim.p.engine.staticThrustN;
  let t95 = null;
  for (let i = 0; i < 60 * 15 && t95 === null; i++) { sim.step(1 / 60, c); if (sim.getState().engine.thrustN > 0.95 * Fmax) t95 = sim.t; }
  console.log(`  ralentí → 95 %: ${t95.toFixed(2)} s`);
  assert.ok(t95 > 6 && t95 < 8);
});

test('A-10: fuerza externa tipo retroceso (≈45 kN en la boca) desacelera de forma medible', () => {
  const run = (withForce) => {
    const sim = new A10Sim({ seed: 1 });
    sim.reset({ state: 'cruise', speedKt: 300, altFt: 5000, fuelKg: 3000 });
    const c = a10Controls({ gearDown: false, throttle: sim.trimInfo.throttle });
    if (withForce) sim.setExternalForce('gunRecoil', { forceBody: [-45000, 0, 0], vibration: { frac: 0.15, hz: 65 } });
    const v0 = sim.getState().air.iasKt;
    let maxQ = 0;
    for (let i = 0; i < 120; i++) { sim.step(1 / 60, c); maxQ = Math.max(maxQ, Math.abs(sim.getState().rates.q)); }
    return { dv: (v0 - sim.getState().air.iasKt) / 2, maxQ, mass: sim.mass };
  };
  const a = run(true), b = run(false);
  const expect = 45000 / a.mass / KT; // kt/s
  const dv = a.dv - b.dv;
  console.log(`  desaceleración por la fuerza: ${dv.toFixed(2)} kt/s (F/m = ${expect.toFixed(2)} kt/s a ${a.mass.toFixed(0)} kg); q máx. ${(a.maxQ / 0.01745).toFixed(2)}°/s`);
  assert.ok(dv > 0.75 * expect && dv < 1.05 * expect, 'desaceleración ≈ F/m (menos el ajuste del SAS/arrastre)');
});

test('A-10: cargas en estaciones cambian masa, CG y resistencia; al quitarlas se recuperan', () => {
  const sim = new A10Sim({ seed: 1 });
  sim.reset({ state: 'cruise', speedKt: 300, altFt: 5000, fuelKg: 3000 });
  const thr0 = sim.trimInfo.throttle, m0 = sim.mass;
  sim.setStores([{ station: 3, massKg: 230, dCD: 0.004 }, { station: 9, massKg: 230, dCD: 0.004 }, { station: 1, massKg: 200, dCD: 0.003 }]);
  sim.reset({ state: 'cruise', speedKt: 300, altFt: 5000, fuelKg: 3000 });
  const m1 = sim.mass, thr1 = sim.trimInfo.throttle, cgz = sim.cg[2];
  assert.ok(Math.abs(m1 - m0 - 660) < 1e-6);
  assert.ok(thr1 > thr0 && cgz < 0, 'más gases por resistencia; CG corrido a la izquierda por la estación 1');
  sim.setStores([]);
  assert.ok(Math.abs(sim.mass - m0) < 1e-6);
  console.log(`  +660 kg: gases de trim ${(thr0 * 100).toFixed(1)} → ${(thr1 * 100).toFixed(1)} %; CG z ${cgz.toFixed(3)} m`);
});
