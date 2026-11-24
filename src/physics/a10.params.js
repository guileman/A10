// Parámetros físicos del A-10C Thunderbolt II (2 × TF34-GE-100A). Unidades SI.
// Fuente o ESTIMADO de cada valor: docs/PHYSICS_A10.md. [W] = artículo de Wikipedia del A-10 (especificaciones),
// [U] = cifra dada en el encargo del proyecto, ESTIMADO = razonamiento propio documentado.
const LB = 0.45359237, LBF = 4.4482216, FT = 0.3048;

export const A10_PARAMS = {
  mass: {
    emptyKg: 11320,               // [U][W] 24 959 lb
    pilotKg: 110,                 // ESTIMADO (piloto + equipo)
    fuelMaxKg: 4853,              // [U] (W da 11 000 lb = 4 990 kg)
    mtowKg: 23000,                // [U] ≈ 51 000 lb (W da 46 000 lb para el A-10A)
    ammoMaxKg: 790,               // ESTIMADO: carga interna del tambor del cañón como masa (sin otros efectos)
    // Inercias de la aeronave VACÍA + piloto (sin combustible, munición ni cargas), convención aeronáutica,
    // kg·m². ESTIMADAS por distribución de masas (ver PHYSICS_A10.md §Inercias).
    Ixx: 52000, Iyy: 88000, Izz: 132000, Ixz: 2500,
    // Radios de giro del combustible respecto de su centroide (fuselaje + tanques integrales de ala), ESTIMADO.
    fuelRadiusGyr: { roll: 2.2, pitch: 1.4, yaw: 2.5 },
    // Centroides relativos al CG vacío (marco modelo): combustible levemente atrás, munición adelante.
    fuelCgOffset: [-0.20, -0.05, 0],
    ammoCgOffset: [2.6, -0.45, 0],
    pilotCgOffset: null,          // null -> en el ojo del piloto bajado 0,6 m
  },
  aero: {
    S: 47.0,                      // m² [U][W] 506 ft²
    b: 17.53,                     // m [U][W]
    cbar: 3.04,                   // m [U]
    sweepQcDeg: 0,                // ala recta [U]
    CL0: 0.20,                    // ESTIMADO (perfil NACA 67xx con curvatura + calaje)
    alphaStallDeg: 16,            // ESTIMADO, calibrado con Vs 120 KIAS a 30 000 lb [W]
    kneeDeg: 6,                   // redondeo del CL antes de la pérdida (pérdida suave de ala gruesa recta)
    postStallWidthDeg: 2.5,       // ancho de la mezcla post-pérdida (suave)
    postStallCLfrac: 0.80,        // CL post-pérdida / CLmax (caída moderada)
    CD0: 0.032,                   // [U] limpio
    pylonsCD0: 0.010,             // 11 pilones fijos vacíos, ESTIMADO (calibra Vmax ≈ 380–400 kt a nivel del mar)
    oswald: 0.80,                 // ESTIMADO (ala recta AR 6,5)
    mach: { Mcrit: 0.68, waveK: 25 }, // ESTIMADO (perfil grueso 16 %)
    staticMargin: 0.12,           // fracción de CAM, ESTIMADO
    Cm0: 0.02,
    CmQ: -14, CmAlphaDot: -5,     // /rad ESTIMADO (gran brazo de cola, l_t/c ≈ 2,3)
    CmDeltaE: -1.55, CLDeltaE: 0.38, // /rad ESTIMADO
    CYbeta: -0.80, Clbeta: -0.10, Cnbeta: 0.12,          // /rad ESTIMADO (diedro en paneles externos, doble deriva)
    Clp: -0.48, Cnr: -0.22, Clr: 0.14, Cnp: -0.06,       // ESTIMADO
    ClDeltaA: 0.113, CnDeltaA: -0.006,                   // /rad ESTIMADO, calibrado a ≈100°/s a 300 kt
    CnDeltaR: -0.085, ClDeltaR: 0.010, CYDeltaR: 0.14,   // /rad ESTIMADO (convención: + timón = proa a la derecha)
    flaps: { dCL: [0, 0.10, 0.30], dCD: [0, 0.006, 0.030], dCm: [0, -0.012, -0.04], dAlphaStallDeg: [0, -0.5, -1.5] },
    gear: { dCD: 0.015, dCDtransit: 0.006 },             // ESTIMADO (tren semirretráctil: ruedas asoman)
    speedbrake: { dCD: 0.075, dCL: -0.03, dCm: 0.005 },  // decelerones a fondo, ESTIMADO
    groundEffect: true,
    wingDrop: { dCl: 0.018, tau: 0.8 },                  // caída de ala moderada (ΔCl máx. y constante de tiempo)
  },
  controls: {
    elevatorUpDeg: 30, elevatorDownDeg: 20,             // ESTIMADO
    aileronDeg: 25, rudderDeg: 20,                      // ESTIMADO
    surfaceRateDegS: 50,
    trimRangeDeg: [-10, 10], trimRateDegS: 1.5,          // compensador de cabeceo como desplazamiento del timón de profundidad
    rollTrimRangeDeg: 3, yawTrimRangeDeg: 4,
    flapDeg: [0, 7, 20],                                 // UP / MVR / DN [U]
    flapRateDegS: 4,
    flapBlowbackKt: 210,                                 // DN se retrae a MVR por encima de 210 KIAS (ESTIMADO)
    speedbrakeMaxDeg: 40, speedbrakeRateDegS: 30,        // por hoja, ESTIMADO
    // SAS (A-10C: cabeceo y guiñada). Ganancias por unidad de stabilityAug (1 = nominal).
    sas: { pitchGain: 0.9, yawGain: 1.4, betaGain: 0.25, washoutS: 1.5, authorityFrac: 0.25 },
  },
  engine: {
    count: 2,
    staticThrustN: 9065 * LBF,    // 40,3 kN c/u [U][W]
    // Fracción de empuje estático vs N1 (%) físico. ESTIMADO (turbofán de alto bypass: F ≈ ∝ N1²–N1³).
    thrustTable: [[32, 0.045], [50, 0.15], [60, 0.26], [70, 0.40], [80, 0.57], [90, 0.77], [95, 0.885], [100, 1.0]],
    idleN1: 32, maxN1: 100,
    // Dinámica de N1: τ grande cerca de ralentí; ralentí -> 95 % de empuje ≈ 7 s (ESTIMADO, [U] 6–8 s).
    accelTau: 1.0, decelTau: 0.9, lowTauMul: 2.4, accelRateMax: 18, decelRateMax: 20,
    // Lapso: F = F0(N1)·σ^altExp·(1 − k1 M + k2 M²). ESTIMADO, bypass 6,2.
    altExp: 0.75, machK1: 1.0, machK2: 0.55,
    tsfc: 0.37 * LB / (LBF * 3600),  // 0,37 lb/(lbf·h) [U] -> 1,048e-5 kg/(N·s)
    tsfcMachK: 0.75, tsfcPartK: 0.30,                     // TSFC×(1+k M)×(1+kp(1−F/Fmax)) ESTIMADO
    idleFuelKgS: 0.035,
  },
  gear: {
    designMassKg: 19000,          // masa para dimensionar amortiguadores (ESTIMADO)
    units: {
      nose: { travel: 0.30, staticFrac: 0.65, armLength: 0.45, armStaticDeg: 18, pivotForward: true, unsprungKg: 60,
        tireK: 9.0e5, tireC: 2.0e3, tireMaxDefl: 0.08, wheelInertia: 1.5, brake: false, castor: false,
        steerMaxDeg: 55, steerHighSpeedDeg: 6, steerLowKt: 8, steerHighKt: 40, steerRateDegS: 40 },
      main: { travel: 0.40, staticFrac: 0.65, armLength: 0.55, armStaticDeg: 15, pivotForward: true, unsprungKg: 160,
        tireK: 1.6e6, tireC: 4.0e3, tireMaxDefl: 0.10, wheelInertia: 5.0, brake: true, brakeTorqueMax: 32000, castor: false },
    },
    gasN: 1.1, staticPressurePa: 9e6, fullToStaticRatio: 3.2, atmPa: 101325,
    designSinkMs: 3.05,           // 10 ft/s (ESTIMADO, valor típico de diseño)
    reboundRatio: 2.5, zetaLinear: 0.35,
    extendTimeS: 6, retractTimeS: 6, limitSpeedKt: 200, // ESTIMADO
    crashSinkMs: 5.0, hardSinkMs: 3.3,
    antiSkidSlip: 0.12,
    noseShare: 0.13,              // fracción estática en proa usada si no hay CG en la geometría (ESTIMADO)
    cgHeightM: 1.75,              // altura del CG sobre el suelo apoyado (ESTIMADO) si no hay CG
    groundPitchDeg: 0.5,
  },
  contact: { hardK: 4e6, hardC: 8e4, mu: 0.5, crashNormalVel: 3.0 },
  limits: { vneKt: 450, gMax: 7.33, gMin: -3.0 },
  integration: { substepHz: 480 },
};

export const A10_LB = LB; export const A10_FT = FT;
