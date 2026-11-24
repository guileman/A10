// Parámetros físicos del Harrier de 1.ª generación (AV-8A / GR.3, Pegasus 103 = Pegasus 11).
// Fuente o ESTIMADO de cada valor: docs/PHYSICS.md (tabla de parámetros). Unidades SI.
const LB = 0.45359237, LBF = 4.4482216, FT = 0.3048;

export const HARRIER_PARAMS = {
  mass: {
    emptyKg: 12200 * LB,          // 5534 kg, peso vacío GR.3 (aerospaceweb). Princeton MAE 1466: OEW ≈ 12 000 lb.
    pilotKg: 100,                 // ESTIMADO (piloto + equipo)
    fuelMaxKg: 5060 * LB,         // 2295 kg combustible interno (aerospaceweb)
    waterMaxKg: 500 * LB,         // ESTIMADO 227 kg (no verificado en fuente primaria)
    // Inercias a masa de referencia (ESTIMADAS por distribución de masas, ver PHYSICS.md). Convención aeronáutica.
    refMassKg: 7900,
    Ixx: 7500, Iyy: 45000, Izz: 50000, Ixz: 1500,   // kg·m² (roll, pitch, yaw, producto)
    fuelRadiusGyr: { roll: 1.3, pitch: 1.2, yaw: 1.7 }, // m, radio de giro del combustible (alas+fuselaje central) ESTIMADO
    fuelCgOffset: [0, 0, 0],      // el sistema de combustible del Harrier mantiene el CG; ESTIMADO 0
  },
  // Referencias aerodinámicas
  aero: {
    S: 201.1 * FT * FT,          // 18.68 m² (Princeton MAE 1466; aerospaceweb)
    b: 25.25 * FT,               // 7.70 m
    cbar: 8.43 * FT,             // 2.57 m CAM (Princeton MAE 1466)
    sweepQcDeg: 34,              // ESTIMADO (valor de divulgación; no verificado en primaria)
    CD0: 0.025,                  // ESTIMADO
    oswald: 0.78,                // ESTIMADO
    CL0: 0.10,                   // ESTIMADO (calaje del ala con borde de ataque arriba, Farley/PPRuNe)
    alphaStallDeg: 17,           // ESTIMADO: buffet 16–18° (Princeton MAE 1466)
    staticMargin: 0.10,          // fracción de CAM, ESTIMADO
    Cm0: 0.015,
    CmQ: -8.0, CmAlphaDot: -3.0, // /rad ESTIMADO (volumen de cola)
    CmDeltaS: -1.55,             // /rad estabilizador móvil total, ESTIMADO
    CLDeltaS: 0.45,              // /rad
    CYbeta: -0.9, Clbeta: -0.08, Cnbeta: 0.10,          // /rad ESTIMADO
    Clp: -0.30, Cnr: -0.25, Clr: 0.10, Cnp: -0.05,       // ESTIMADO
    ClDeltaA: 0.085, CnDeltaA: -0.008, CnDeltaR: -0.065, ClDeltaR: 0.008, CYDeltaR: 0.12, // /rad
    flaps: { // por grado de flap (ESTIMADO, ala de alto ala flecha moderada)
      dCLper50: 0.42, dCDper50: 0.055, dCmPer50: -0.05, dAlphaStallPer50Deg: -2.0,
    },
    gear: { dCD: 0.022, dCDtransit: 0.010 }, // ESTIMADO
    airbrake: { maxDeg: 66, gearDownDeg: 25, dCDmax: 0.035, dCmMax: -0.02 }, // 66°/25°/ΔCm -0,02: Princeton MAE 1466
    mach: { Mcrit: 0.80, waveK: 18, clMachMax: 0.88 },   // ESTIMADO (máx. a nivel del mar M 0,97)
    groundEffect: true,
    stallBreak: { wingDropCl: 0.035, postStallCLmax: 1.05 }, // ESTIMADO
  },
  controls: {
    stabTEdownDeg: 11.25,        // tope delantero de palanca = 11,25° borde de fuga abajo (Princeton MAE 1466)
    stabTEupDeg: 13,             // ESTIMADO
    stabTrimRangeDeg: [-8, 6],   // ESTIMADO (TE arriba negativo)
    aileronDeg: 15, rudderDeg: 15, // ESTIMADO
    flapDeg: [0, 25, 50],        // ARRIBA / INTERMEDIA (ESTIMADO 25°) / ABAJO 50° (Princeton MAE 1466)
    flapRateDegS: 10,            // ESTIMADO
    surfaceRateDegS: 60,         // actuadores hidráulicos, ESTIMADO
    sas: { pitchGain: 0.25, rollGain: 0.12, yawGain: 0.5, authorityFrac: 0.15 }, // autoestabilizador de autoridad limitada (ESTIMADO)
    trimRateDegS: 1.0,
  },
  engine: {
    // Pegasus 11 (Mk 103) empuje bruto INSTALADO, nivel del mar ISA estático (Princeton MAE 1466, Tabla 1):
    // %NF -> lbf. Debajo de 90 % se extiende con F ∝ NF^3 hasta ralentí (ESTIMADO).
    thrustTable: [
      [27, 12900 * Math.pow(27 / 90, 3) * LBF],
      [60, 12900 * Math.pow(60 / 90, 3) * LBF],
      [75, 12900 * Math.pow(75 / 90, 3) * LBF],
      [90, 12900 * LBF], [94.4, 15500 * LBF], [100, 17700 * LBF], [102.7, 18650 * LBF],
      [104.1, 19300 * LBF], [105.8, 19600 * LBF],
    ],
    idleNF: 27,                  // ESTIMADO
    dryMaxNF: 102.7,             // "short lift dry" (Princeton MAE 1466)
    wetMaxNF: 105.8,             // "short lift wet"
    massFlowMax: 196,            // kg/s ESTIMADO (≈432 lb/s, cifra de divulgación del Pegasus 11)
    tsfcMax: 19.5e-6,            // kg/(N·s) ≈ 0,69 lb/lbf/h ESTIMADO
    accelTau: 0.45, decelTau: 0.35, accelRateMax: 22, decelRateMax: 30, // %NF y s, ESTIMADO
    lowSpoolTauMul: 4,           // respuesta más lenta cerca de ralentí, ESTIMADO
    waterFlowKgS: 2.5,           // ESTIMADO (227 kg en ~90 s: límite "normal lift wet" 1,5 min)
    jptIsa100C: 680, jptWaterDropC: 70, jptLimitC: 760, // ESTIMADO
    gross: { machK1: 0.56, machK2: 0.28 }, // F_bruto(M) = F0(1+k1 M + k2 M²), calibrado ESTIMADO
    frontSplit100: 0.50,         // "casi igual" delantero/trasero (Princeton MAE 1466)
    frontSplitSlope: 0.0015,     // por %NF debajo de 100, ESTIMADO
    hgiLossPerK: 0.006,          // pérdida de empuje por K de reingestión, ESTIMADO
  },
  nozzles: {
    maxDeg: 98.5,                // Princeton MAE 1466
    hoverStopDeg: 82,            // tope de vuelo estacionario en palanca (Princeton MAE 1466) -- informativo
    rateDegS: 90,                // ESTIMADO (cifra de divulgación; motor neumático por cadena)
    accelDegS2: 600,             // ESTIMADO (inercia del motor neumático)
  },
  rcs: {
    // Potencia de control máxima (rad/s²) a 100 % NF con presión plena. ESTIMADO, por encima de los picos
    // medidos en hover del YAV-8B (NASA TM-104021: cabeceo 0,26, alabeo 0,56, guiñada 0,15; alabeo 1,23 en
    // traslación lateral).
    maxAccel: { pitch: 0.45, roll: 1.3, yaw: 0.35 },
    jetVelocity: 750,            // m/s ("más de 2700 km/h", airvectors.net)
    bleedAvailKgS: 8.35,         // 18,4 lbm/s (NASA TM-104021: 9,2 lbm/s = 50 % del disponible)
    thrustLossPerKgS: 800,       // N de empuje principal perdidos por kg/s sangrado, ESTIMADO
    phaseInDeg: [0, 20],         // válvula de corte: 0 a 0°, plena a ≥20° (Princeton MAE 1466; airvectors)
    valveTau: 0.06,
  },
  groundJet: {
    freeAirLossFrac: 0.015,      // pérdida de sustentación inducida fuera de suelo (ESTIMADO)
    suckK: 0.055, suckN: 1.6,    // ΔL/T = -k (De/h)^n, ESTIMADO
    fountainK: 0.03, fountainHde: 1.0, // ESTIMADO
    De: 1.2,                     // diámetro equivalente de los 4 chorros, m, ESTIMADO
    hgiMaxK: 25, hgiHeightM: 8, hgiWindMs: 8, // ESTIMADO
    transitionLossK: 0.08,       // pérdida de sustentación jet-ala en transición (Princeton cualitativo), ESTIMADO
  },
  gear: {
    // Reparto estático de carga del tren (ESTIMADO, ver PHYSICS.md: no hay dato público).
    staticShare: { outrigger: 0.06 },
    units: {
      nose: { travel: 0.30, staticFrac: 0.70, armLength: 0.42, armStaticDeg: 18, pivotForward: true, unsprungKg: 40,
        tireK: 7.0e5, tireC: 1.2e3, tireMaxDefl: 0.09, wheelInertia: 1.6, steerMaxDeg: 30, steerHighSpeedDeg: 6, steerRateDegS: 60, brake: false, castor: false },
      main: { travel: 0.45, staticFrac: 0.72, armLength: 0.55, armStaticDeg: 15, pivotForward: true, unsprungKg: 110,
        tireK: 1.0e6, tireC: 1.6e3, tireMaxDefl: 0.09, wheelInertia: 2.2, brake: true, brakeTorqueMax: 9000, castor: false },
      outrigger: { travel: 0.25, staticFrac: 0.50, fullToStaticRatio: 8, armLength: 0.45, armStaticDeg: 20, pivotForward: true, unsprungKg: 20,
        tireK: 3.0e5, tireC: 5e2, tireMaxDefl: 0.06, wheelInertia: 0.3, brake: false, castor: true },
    },
    gasN: 1.1, staticPressurePa: 8e6, fullToStaticRatio: 3.0, atmPa: 101325,
    designSinkMs: 3.66,          // 12 ft/s (ESTIMADO: valor típico de diseño VL)
    reboundRatio: 2.5,
    zetaLinear: 0.35,
    extendTimeS: 6, retractTimeS: 7, // ESTIMADO
    limitSpeedKt: 250,           // ESTIMADO
    crashSinkMs: 5.5, hardSinkMs: 3.7,
    antiSkidSlip: 0.12,
  },
  contact: { hardK: 3e6, hardC: 6e4, mu: 0.5, crashNormalVel: 3.0, crashNoseVel: 6.0 },
  integration: { substepHz: 480 },
};

// Coeficientes de fricción neumático-superficie (pico). SURF: GRAVEL 0, DIRT 1, GRASS 2, FOREST 3, ASPHALT 4,
// MUD 5, WATER 6, SAND 7, ROCK 8. Fuentes: valores típicos de ingeniería vial/aeroportuaria (ESTIMADO).
export const SURFACE_TABLE = [
  { name: 'GRAVEL', muDry: 0.60, muWet: 0.50, roll: 0.030 },
  { name: 'DIRT', muDry: 0.62, muWet: 0.40, roll: 0.040 },
  { name: 'GRASS', muDry: 0.45, muWet: 0.25, roll: 0.060 },
  { name: 'FOREST', muDry: 0.45, muWet: 0.30, roll: 0.080 },
  { name: 'ASPHALT', muDry: 0.80, muWet: 0.50, roll: 0.015 },
  { name: 'MUD', muDry: 0.30, muWet: 0.20, roll: 0.150 },
  { name: 'WATER', muDry: 0.05, muWet: 0.05, roll: 0.300 },
  { name: 'SAND', muDry: 0.40, muWet: 0.35, roll: 0.200 },
  { name: 'ROCK', muDry: 0.70, muWet: 0.50, roll: 0.020 },
];
