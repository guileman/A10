import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HarrierSim } from '../../src/physics/index.js';

const DEG = Math.PI / 180;

test('balance de momentos de empuje con toberas 0–98,5° (sin aire, sin RCS)', () => {
  const sim = new HarrierSim({ seed: 1 });
  sim.reset({ state: 'hover', aglM: 200, fuelKg: 1150 });
  const nfHover = sim.getState().engine.rpmPct;
  const rows = [];
  let prev = null, zeroCross = null;
  for (let deg = 0; deg <= 98.5 + 1e-9; deg += 0.5) {
    sim.nozzles.reset(deg);
    sim.engine.nf = nfHover;
    sim.vel.fill(0); sim.omega.fill(0);
    sim._airData(0, false);
    sim.engine.update(0, 1, false, sim.air.T / 288.15, sim.air.p / 101325, 0);
    for (const v of Object.values(sim.rcs.valves)) v.forceN = 0;
    sim.rcs.thrustLossN = 0;
    sim._forces(0, sim.lastControls, false);
    const M = sim.Mb[2], T = sim.engine.grossN;
    if (prev !== null) {
      assert.ok(Math.abs(M - prev.M) < 0.02 * T, `momento continuo en ${deg}°`);
      if (prev.M * M <= 0 && zeroCross === null) zeroCross = deg;
    }
    prev = { deg, M };
    if (Math.abs(deg % 10) < 1e-9 || deg === 98.5) rows.push(`${deg.toFixed(1)}°: M=${(M / 1000).toFixed(2)} kN·m (${(M / T * 100).toFixed(1)} cm)`);
  }
  console.log('  ' + rows.join(' | '));
  console.log(`  cruce por cero del momento de empuje: ${zeroCross}° (diseño: 83°)`);
  // Autoridad RCS de cabeceo disponible (≥20°) frente al momento de empuje.
  const rcsMax = sim.p.rcs.maxAccel.pitch * sim.p.mass.Iyy;
  for (let deg = 20; deg <= 98.5; deg += 0.5) {
    sim.nozzles.reset(deg); sim._forces(0, sim.lastControls, false);
    assert.ok(Math.abs(sim.Mb[2]) < rcsMax, `momento de empuje dentro de la autoridad RCS a ${deg}°`);
  }
  assert.ok(zeroCross > 75 && zeroCross < 92);
});

test('resistencia de toma (ram drag): en hover con viento cruzado desestabiliza en guiñada', () => {
  const sim = new HarrierSim({ seed: 1 });
  sim.setEnvironment({ windKt: 15, windFromDeg: 90 }); // rumbo 0 (norte), viento desde el este = desde la derecha
  sim.reset({ state: 'hover', aglM: 200 });
  sim._airData(0, false);
  sim._forces(0, sim.lastControls, false);
  const s = sim.getState();
  // Sólo el término de toma: recomputar con flujo de toma nulo para aislarlo.
  const yawTotal = -sim.Mb[1];
  const mdot = sim.engine.massFlow; sim.engine.massFlow = 0; sim._forces(0, sim.lastControls, false); sim.engine.massFlow = mdot;
  const yawRam = yawTotal - (-sim.Mb[1]);
  console.log(`  viento de la derecha 15 kt: ram drag ${s.engine.ramDragN.toFixed(0)} N, momento de guiñada de la toma ${yawRam.toFixed(0)} N·m (− = proa a la izquierda, a sotavento)`);
  assert.ok(s.engine.ramDragN > 500);
  assert.ok(yawRam < 0, 'la toma lleva la proa a sotavento (inestabilidad de guiñada del Harrier)');
});
