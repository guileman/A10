// Punto de entrada de la física (ver docs/CONTRACT.md §3 y docs/PHYSICS.md).
import GEOMETRY_JSON from './harrier.geometry.json' with { type: 'json' };
import { HarrierSim as HarrierSimBase } from './harrier.sim.js';
import { loadGeometry as loadGeometryRaw, GEOMETRY_DEFAULTS } from './geometry.js';
export { HARRIER_PARAMS, SURFACE_TABLE } from './params.js';
export { attitude, quatFromAttitude, mulberry32 } from './math.js';
export { EMPTY_WORLD } from './ground.js';
export { GEOMETRY_DEFAULTS, GEOMETRY_JSON };

/** Normaliza geometría; sin argumento usa src/physics/harrier.geometry.json. */
export function loadGeometry(raw) { return loadGeometryRaw(raw === undefined ? GEOMETRY_JSON : raw); }

/** HarrierSim; si no se pasa `geometry`, usa la geometría entregada (harrier.geometry.json). */
export class HarrierSim extends HarrierSimBase {
  constructor(opts = {}) { super({ ...opts, geometry: opts.geometry ?? GEOMETRY_JSON }); }
}

// ---- A-10C Thunderbolt II (docs/PHYSICS_A10.md). La geometría del agente de mallas
// (src/physics/a10.geometry.json) se pasa como `geometry` cuando exista; si no, se usan los defaults.
export { A10Sim, A10_GEAR_IDS, A10_DEFAULT_CONTROLS } from './a10.sim.js';
export { A10_PARAMS } from './a10.params.js';
export { loadA10Geometry, A10_GEOMETRY_DEFAULTS } from './a10.geometry.js';
export { Turbofan } from './turbofan.js';
