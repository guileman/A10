# Simulador del Harrier — contrato entre módulos

Proyecto: simulador de vuelo del Harrier (1.ª generación: AV-8A / Harrier GR.3, motor Pegasus) para navegador, **un solo HTML**
(three r187 + esbuild). Foco: **fidelidad física del sistema aeronáutico y del sistema VTOL**. Mando por teclado y mouse (por ahora).
Idioma de interfaz: español rioplatense neutro. Identificadores de código en inglés.

Dueños de carpetas (no escribir fuera de la propia; si falta algo, dejarlo escrito en `docs/REQUESTS.md`):

| Carpeta | Dueño | Contenido |
|---|---|---|
| `src/physics/**`, `tests/physics/**`, `docs/PHYSICS.md` | agente de física (Opus) | modelo de vuelo, motor, toberas, RCS, tren, suelo |
| `src/ui/**`, `src/input/**`, `src/camera/**`, `tests/ui/**`, `docs/UI.md` | agente de menús/UI (Sonnet) | menús, HUD, entradas, cámaras |
| `src/world/**`, `src/aircraft/**`, `src/main.js`, `vendor/**`, `build.mjs`, `tools/**` | orquestador | mundo, pista, modelo 3D, integración |

## 1. Convenciones

- **SI**: metros, kg, segundos, newton, radianes (las UI muestran kt, ft, °, etc. convirtiendo en la capa de UI).
- **Marco mundo** (el mismo del simulador de rally y de three.js): x = este, **y = arriba**, z = sur. Sistema derecho.
  Norte = −z. Rumbo de brújula (0 = norte, horario) = `atan2(forward.x, −forward.z)`.
- **Marco cuerpo** (del modelo 3D y de la física): **x = hacia adelante (proa), y = arriba, z = hacia la derecha (estribor)**.
  Sistema derecho (x × y = z). Giro de alabeo positivo = ala derecha abajo; cabeceo positivo = proa arriba; guiñada positiva = proa a la derecha.
- Cuaternión `quat = [x, y, z, w]` rota vectores **cuerpo → mundo**. Velocidad angular `omega` en ejes cuerpo.
- **Marco del modelo** (geometría): origen = origen del modelo 3D (metros), mismos ejes que el marco cuerpo. La física integra
  alrededor del **CG** (`cgModel`, posición del CG en marco modelo; se mueve con el combustible). Toda geometría (ruedas, toberas,
  válvulas RCS, ojo del piloto, superficies) se da en marco modelo y se convierte internamente a relativa al CG.
- Geometría real del modelo 3D: `src/physics/harrier.geometry.json` (la entrega el orquestador; ver §5). La física **no** debe tener
  posiciones de rueda/tobera "quemadas" en el código: se leen de ahí con valores por defecto razonables si falta un campo.
- Tiempo: la física corre con **subpasos fijos** internos (≥ 240 Hz, configurable; el tren y el RCS son rígidos). `step(dt)` acumula.
- Determinismo: sin `Math.random()` sin semilla; usar PRNG con semilla (mulberry32) para turbulencia.
- Sin DOM ni three en `src/physics/**` (se prueba en Node con `node --test`).

## 2. Interfaz del mundo (la consume la física; la implementa el motor de mundo del rally)

```js
world.height(x, z)               // altura del suelo (m, marco mundo)
world.normal(x, z, out)          // normal unitaria del suelo en out=[x,y,z]
world.surface(x, z)              // id SURF: GRAVEL 0, DIRT 1, GRASS 2, FOREST 3, ASPHALT 4, MUD 5, WATER 6, SAND 7, ROCK 8
world.obstacles.query(x, z, r, out, max)   // árboles/casas cercanos (opcional; puede faltar)
world.bounds                     // {xMin,xMax,zMin,zMax}
```
Si no hay mundo: suelo plano `y = 0` de asfalto (`EMPTY_WORLD`).

## 3. API de la física (`src/physics/index.js`)

```js
import { HarrierSim, HARRIER_PARAMS, attitude, loadGeometry } from './physics/index.js';

const sim = new HarrierSim({ params, geometry, seed });
sim.setWorld(world);
sim.reset({ x, z, headingDeg, y /*opcional: si falta, sobre el suelo*/, state: 'parked' | 'hover' | 'cruise',
            speedKt, fuelKg, gearDown, nozzleDeg, flaps });       // 'hover': trim de vuelo estacionario; 'cruise': trim a speedKt
sim.setEnvironment({ windKt, windFromDeg, tempOffsetC, qnhHpa, turbulence /*0..1*/, surfaceWetness /*0..1*/ });
sim.step(dt, controls);          // avanza dt segundos (acumula; subpasos fijos)
sim.getState(out?)               // snapshot inmutable-por-copia (ver §3.2)
sim.events                       // cola de eventos {t, type, data}: 'touchdown','crash','stall','gearLock','overspeed',...
```

### 3.1 `controls` (todo normalizado; la UI/entrada lo produce una vez por cuadro)

```js
{
  pitch:  -1..1,    // +1 = palanca atrás (proa arriba)
  roll:   -1..1,    // +1 = palanca a la derecha (ala derecha abajo)
  yaw:    -1..1,    // +1 = pedal derecho (proa a la derecha); también orienta la rueda de proa en tierra
  throttle: 0..1,   // palanca de gases (la física modela el motor: retardo de RPM, límites, etc.)
  nozzleDeg: 0..98.5, // posición COMANDADA de la palanca de toberas (la física las mueve con velocidad máxima y topes)
  flaps: 0 | 1 | 2, // 0 = arriba, 1 = intermedia (despegue corto / STOL), 2 = abajo/VTOL (según el flap-schedule real que documente la física)
  gearDown: boolean,
  brake: 0..1,      // frenos de ruedas (presión)
  parkingBrake: boolean,
  airbrake: boolean,
  waterInjection: boolean,
  assist: { stabilityAug: 0..1, hoverDamping: 0..1 } // ayudas opcionales (el Harrier GR.3 tiene SAS limitado). Por defecto 0.5/0.
}
```

### 3.2 `getState()` — esquema mínimo (se puede añadir, no quitar sin avisar)

```js
{
  t, pos:[x,y,z] /*CG, mundo*/, quat:[x,y,z,w], vel:[x,y,z] /*mundo*/, omega:[p,q,r] /*cuerpo*/,
  att: { headingDeg, pitchDeg, rollDeg },            // derivados (compass heading)
  air: { iasKt, tasKt, machNo, aoaDeg, betaDeg, qbar, rho, tempK, altMslM, altAglM, vsMs, gs /*vel. suelo m/s*/, nz, ny, nx /*factores de carga*/,
         windBody:[...] },
  engine: { rpmPct, thrustN /*total*/, fuelKg, fuelFlowKgS, jptC, waterKg, bleedPct, stall:false },
  nozzles: { cmdDeg, angleDeg, front:{thrustN}, rear:{thrustN}, fore/aft pos en marco modelo si hace falta },
  rcs: { nose:{forceN,dir}, tail:{...}, tailYaw:{...}, wingL:{...}, wingR:{...}, pressurePct },  // fuerza real de cada boquilla (para dibujar chorros/HUD)
  controlSurfaces: { stabilatorDeg, aileronLDeg, aileronRDeg, rudderDeg, flapsDeg, airbrakeDeg },
  gear: {
    state: 'up'|'down'|'transit', extension: 0..1,   // 0 = recogido, 1 = extendido y trabado
    units: [   // uno por unidad: nose, main, outriggerL, outriggerR  (ids estables)
      { id:'nose', contact:bool, compression: m /*carrera del amortiguador*/, compressionFrac:0..1,
        armAngleDeg /*ángulo del brazo pivotante respecto de su posición estática*/, steerDeg, spinRad /*acumulado*/, wheelSpeedRadS,
        loadN, slip:{long,lat}, surface:SURF, skid:bool, brakeTorqueNm, wheelPosWorld:[x,y,z], tireDeflection: m }
      // la rueda 'main' tiene 2 neumáticos -> spinRad y contacto compartidos o `tires:[...]`
    ]
  },
  flags: { onGround, weightOnWheels, stalled, inGroundEffect, hotGasIngestion, crashed, overspeed, gLimit },
  warnings: ['STALL','GEAR','BINGO','OVERTEMP', ...],
  trim: { stabilatorDeg, ... }  // opcional
}
```

### 3.3 Qué debe modelar la física (fidelidad aeronáutica + VTOL)

Pegasus (4 toberas: 2 delanteras de aire del fan "frío", 2 traseras de gases calientes), rotación común 0–98,5° (la 1.ª gen. gira con
motor neumático a velocidad limitada), empuje según RPM/densidad/temperatura/Mach, inyección de agua, **resistencia de toma (ram drag)** y
su momento, **aerodinámica** (CL/CD/Cm con Mach, flaps, tren, aerofreno; pérdida y post-pérdida; control por estabilizador móvil total,
alerones, timón), **RCS** (válvulas de aire sangrado: proa y cola para cabeceo, cola para guiñada, puntas de ala para alabeo; fuerza ∝ presión
de sangrado, que depende de RPM; penaliza empuje principal), **efecto suelo** (aerodinámico y de chorro: succión + "fuente" en vuelo
estacionario cerca del suelo; ingestión de gases calientes opcional), **tren** (nariz + principal + 2 estabilizadores de punta de ala) con
**suspensión por rueda**: amortiguador oleoneumático (resorte de gas politrópico + amortiguación hidráulica por orificio con retorno),
**brazo pivotante** (ventaja mecánica según el ángulo del brazo), neumático (rigidez/amortiguación radial, deslizamiento long./lateral
combinado, fricción por superficie SURF seco/mojado, resistencia a la rodadura), frenos, dirección de rueda de proa, recogida/extensión
con tiempos y resistencia; contacto del fuselaje/toberas/puntas de ala con el suelo (daño/choque), choque con obstáculos, masa e inercia
variables con el combustible, atmósfera ISA con offset, viento + turbulencia (Dryden, con semilla).
Todo parámetro con **fuente** (o marcado `ESTIMADO` con razonamiento) en `docs/PHYSICS.md`.
Pruebas en `tests/physics/` (Node): equilibrio de vuelo estacionario, balance de momentos en tobera 0–98,5°, rodaje y despegue
(distancia plausible), transición, pérdida, cargas estáticas por rueda, conservación (energía/momento sin fuerzas), determinismo.

## 4. API de UI / entrada / cámaras (la implementa el agente de UI; la consume `main.js`)

```js
// src/input/index.js
const input = createInput({ target: canvasOrWindow, config /*mapa de teclas editable, persistente en localStorage*/ });
input.update(dt);                 // integra rampas de teclado, mouse-stick con recentrado, etc.
input.getControls(out?) -> controls   // formato §3.1  (nozzleDeg comandado se integra aquí con rampa configurable)
input.on('action', (name) => ...) // 'cameraNext','pause','reset','toggleHud','toggleMouse','screenshot', ...
input.setEnabled(bool)

// src/camera/index.js
const rig = createCameraRig({ camera /*THREE.PerspectiveCamera*/, world, aircraft /*{ group: THREE.Object3D, eyeLocal:Vector3 }*/ });
rig.setMode('pilot'|'chase'|'world'); rig.next();
rig.update(dt, state /*getState()*/, inputLook /*{yaw,pitch,zoom}*/);
//  pilot : ojo del piloto (eyeLocal), mirada libre con mouse (botón derecho) y vuelta suave al frente
//  chase : desde atrás y arriba, resorte-amortiguador (posición y mirada), distancia con la rueda del mouse
//  world : cámara FIJA en el marco del mundo; el avión pasa; mira al avión con zoom automático por distancia; se reubica
//          adelante de la trayectoria cuando el avión se aleja (y por tecla); nunca bajo el terreno (world.height + 2 m)

// src/ui/index.js
const ui = createUI({ root: HTMLElement, engine /*{MapView, SyntheticSource, TileSource, ...}*/, storage: localStorage });
ui.showMainMenu(); ui.showPause(); ui.hideAll();
ui.onStart((config) => ...)       // config §4.1
ui.hud.update(state, controls, dt)  // HUD (canvas 2D o DOM) con unidades de aviación
ui.hud.setMode('pilot'|'chase'|'world') // HUD completo en cabina, reducido afuera
ui.toast(text)
```

### 4.1 `config` que entrega el menú al arrancar

```js
{
  source: 'demo' | 'real',
  runway: { thr1:{lat,lon}, thr2:{lat,lon}, widthM, surface:'asphalt'|'concrete'|'grass', designators:true },
  extentKm: number,           // radio del mundo generado alrededor de la pista (default 3)
  start: 'parked' | 'hover' | 'cruise',
  timeOfDay: 'amanecer'|'dia'|'tarde'|'atardecer',
  quality: 'bajo'|'medio'|'alto',
  environment: { windKt, windFromDeg, tempOffsetC, qnhHpa, turbulence, surfaceWetness },
  fuelKg, assist: {...}, camera: 'pilot'|'chase'|'world'
}
```

Mapa de teclas por defecto (editable): ↑/↓ cabeceo (↑ = proa abajo), ←/→ alabeo, A/D pedales, W/S gases, Z/X toberas (continuo, aft↔abajo),
1/2/3 toberas preajuste (0° / ~55° / ~85°), G tren, F flaps, B frenos (mantener), V freno de estacionamiento, K aerofreno, I inyección de agua,
C cámara, H HUD, M mouse-palanca (movimiento relativo, recentrado suave), Botón derecho = mirar, Rueda = distancia/zoom de cámara, P/Esc pausa, R reiniciar.

HUD mínimo: velocidad indicada (kt), altitud MSL/AGL (ft), rumbo, horizonte artificial, variómetro, AoA, g, Mach, **indicador de ángulo de toberas**
(estilo cabina Harrier), RPM/empuje/JPT, combustible, tren, flaps, frenos, **indicador de RCS** (cuatro válvulas), viento, avisos.

## 5. Geometría real del modelo (entrega del orquestador)

`src/physics/harrier.geometry.json`: metros, marco modelo. Campos previstos (cualquiera puede faltar → usar defaults):
`scale`, `cgModel`, `eyeModel`, `gear.{nose,main,outriggerL,outriggerR}.{legTop, axle, wheelRadius, tireWidth, tireCount, pivot, armLength}`,
`nozzles.{frontL,frontR,rearL,rearR}.{pos, radius}`, `rcs.{nose,tail,tailYaw,wingL,wingR}.{pos, dir}`, `surfaces.{...}`.
Las cifras vienen del modelo CAD; las propiedades reales (rigideces, masas, empuje) las pone la física con fuentes.
