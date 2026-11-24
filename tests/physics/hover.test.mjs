import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HarrierSim } from '../../src/physics/index.js';
import { baseControls } from './helpers.mjs';

const G0 = 9.80665, DEG = Math.PI / 180;

test('vuelo estacionario: trim converge y empuje ≈ peso (+ pérdidas inducidas)', () => {
  const sim = new HarrierSim({ seed: 1 });
  sim.reset({ state: 'hover', aglM: 20, fuelKg: 1150 });
  const s = sim.getState();
  assert.ok(s.trim.ok, 'trim de hover convergió');
  const W = s.massKg * G0;
  // Componente vertical (mundo) del empuje de las toberas.
  const thrustVert = s.engine.thrustN * Math.sin((s.trim.nozzleDeg + s.att.pitchDeg) * DEG);
  const ratio = thrustVert / W;
  console.log(`  hover: masa ${s.massKg.toFixed(0)} kg, NF ${s.engine.rpmPct.toFixed(1)} %, T ${(s.engine.thrustN / 1e3).toFixed(1)} kN, ` +
    `T_vert/W = ${ratio.toFixed(4)}, ΔL_chorro/T = ${(s.nozzles.jetLiftFrac * 100).toFixed(2)} %, actitud ${s.att.pitchDeg.toFixed(2)}°`);
  // T_vert·(1+ΔL/T) = W  (equilibrio vertical con pérdida inducida por chorro)
  assert.ok(Math.abs(thrustVert * (1 + s.nozzles.jetLiftFrac) / W - 1) < 0.01);
  assert.ok(ratio > 1.0 && ratio < 1.06, 'empuje vertical algo mayor que el peso por pérdidas inducidas');
  assert.ok(s.att.pitchDeg > 3 && s.att.pitchDeg < 12, 'actitud de hover con proa algo arriba');
});

test('vuelo estacionario: cabeceo trimado por el reparto delantero/trasero (casi sin RCS)', () => {
  const sim = new HarrierSim({ seed: 1 });
  sim.reset({ state: 'hover', aglM: 20, fuelKg: 1150 });
  const s = sim.getState();
  // Momento de las 4 toberas respecto del CG (cuerpo, eje z = cabeceo) calculado aquí a partir de la geometría.
  const cg = s.cgModel, th = s.nozzles.angleDeg * DEG;
  const d = [Math.cos(th), Math.sin(th)];
  let M = 0;
  for (const [pos, F] of [[s.nozzles.front.posL, s.nozzles.front.thrustN / 2], [s.nozzles.front.posR, s.nozzles.front.thrustN / 2],
    [s.nozzles.rear.posL, s.nozzles.rear.thrustN / 2], [s.nozzles.rear.posR, s.nozzles.rear.thrustN / 2]]) {
    const rx = pos[0] - cg[0], ry = pos[1] - cg[1];
    M += rx * F * d[1] - ry * F * d[0];
  }
  const T = s.engine.thrustN;
  console.log(`  momento de toberas en hover = ${M.toFixed(0)} N·m (${(M / T * 1000).toFixed(1)} mm de brazo equivalente), RCS nariz ${s.rcs.nose.forceN.toFixed(0)} N, cola ${s.rcs.tail.forceN.toFixed(0)} N, sangrado ${s.engine.bleedPct.toFixed(1)} %`);
  assert.ok(Math.abs(M / T) < 0.03, 'brazo equivalente < 3 cm');
  assert.ok(s.engine.bleedPct < 5, 'trim con poco sangrado');
});

test('vuelo estacionario: se mantiene 10 s con mandos fijos en el trim', () => {
  const sim = new HarrierSim({ seed: 1 });
  sim.reset({ state: 'hover', aglM: 20, fuelKg: 1150 });
  const s0 = sim.getState();
  const c = baseControls({ throttle: s0.trim.throttle, nozzleDeg: s0.trim.nozzleDeg, flaps: 2 });
  for (let i = 0; i < 600; i++) sim.step(1 / 60, c);
  const s = sim.getState();
  const dx = Math.hypot(s.pos[0] - s0.pos[0], s.pos[2] - s0.pos[2]), dy = s.pos[1] - s0.pos[1];
  console.log(`  deriva 10 s: horiz ${dx.toFixed(2)} m, vert ${dy.toFixed(2)} m (combustible quemado ${(s0.engine.fuelKg - s.engine.fuelKg).toFixed(1)} kg), cabeceo ${s.att.pitchDeg.toFixed(2)}°`);
  assert.ok(dx < 1.5 && Math.abs(dy) < 1.5);
  assert.ok(Math.abs(s.att.pitchDeg - s0.att.pitchDeg) < 2 && Math.abs(s.att.rollDeg) < 1);
  assert.equal(s.flags.crashed, false);
});

test('despegue vertical con 50 % de combustible y aterrizaje vertical', () => {
  const sim = new HarrierSim({ seed: 2 });
  sim.reset({ state: 'parked', fuelKg: 1150, flaps: 2 });
  const c = baseControls({ throttle: 1, nozzleDeg: 83, flaps: 2, assist: { stabilityAug: 0.5, hoverDamping: 1 } });
  let maxAgl = 0;
  for (let i = 0; i < 60 * 8; i++) { sim.step(1 / 60, c); maxAgl = Math.max(maxAgl, sim.getState().air.altAglM); }
  const sUp = sim.getState();
  assert.ok(!sUp.gear.units.some((u) => u.contact), 'despegó');
  assert.ok(maxAgl > 8, `subió (${maxAgl.toFixed(1)} m)`);
  // Descenso: reducir algo de gases y apoyar.
  c.throttle = sUp.trim.throttle; // throttle de referencia no definido en parked; usar regla:
  let landed = false, sink = 0;
  for (let i = 0; i < 60 * 40 && !landed; i++) {
    const s = sim.getState();
    c.throttle = Math.min(1, Math.max(0, 0.9 + 0.08 * (-1.5 - s.air.vsMs)));
    sim.step(1 / 60, c);
    const e = sim.events.find((ev) => ev.type === 'touchdown');
    if (e) { landed = true; sink = e.data.sinkMs; }
  }
  console.log(`  VTO: altura máx ${maxAgl.toFixed(1)} m; VL: toque a ${sink.toFixed(2)} m/s`);
  assert.ok(landed, 'aterrizó');
  assert.ok(!sim.getState().flags.crashed);
});
