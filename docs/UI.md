# UI, entrada y cámaras — `src/ui`, `src/input`, `src/camera`

Simulador **A-10C Thunderbolt II** (fork del Harrier). Sin dependencias salvo `three` (solo la cámara). Todo el DOM, `localStorage` y `MapView` se **inyectan**; se prueba con jsdom (`tests/ui`).
Convenciones del contrato (`docs/CONTRACT.md`): SI en el motor, unidades de aviación solo en el HUD. Se empieza **siempre en vuelo** (no hay pista ni despegue).

## 1. Integración mínima (`main.js`)

```js
import { createInput } from './input/index.js';
import { createCameraRig } from './camera/index.js';
import { createUI } from './ui/index.js';

const input = createInput({ target: canvas, storage: localStorage });
const ui    = createUI({ root, engine /*{MapView, SyntheticSource, TileSource}*/, storage: localStorage, input });
const rig   = createCameraRig({ camera, world, aircraft /*{group, eyeLocal}*/, onModeChange: (m) => ui.hud.setMode(m) });
ui.onStart((config) => { /* generar mundo; ui.setLoading(p, msg); ... ui.hideLoading(); input.reset({ throttle, gearDown:false, flaps:0, assist: config.assist }); rig.setMode(config.camera) */ });
ui.on('resume' | 'restart' | 'menu', ...);
input.on('action', (n) => {
  if (n === 'pause') { paused = true; ui.showPause(); }
  else if (n === 'cameraNext') rig.next();            // onModeChange actualiza el HUD
  else if (n === 'worldRelocate') rig.relocate();
  else if (n === 'toggleHud') ui.hud.toggle();
  else if (n === 'fireMissile') /* lanzar Maverick */;
  else if (n === 'lockTarget') /* fijar el blanco más cercano al centro / ciclar */;
  else if (n === 'unlockTarget') /* soltar */;
});
// cada cuadro:
input.update(dt); const controls = input.getControls(controlsObj);   // controls.triggerGun = gatillo del cañón
sim.step(dt, controls); const s = sim.getState(stateObj);
rig.update(dt, s, input.getLook(lookObj)); ui.hud.update(s, controls, dt, extra);
// al lanzar un Maverick: rig.setWeaponTarget(missileObject3D); al impactar/expirar: rig.setWeaponTarget(null)
```
- Al mostrarse cualquier pantalla del UI, `input.setEnabled(false)`; al ocultarla (`hideAll`/Reanudar/`hideLoading`) vuelve a `true`.
- `ui.onStart` ya muestra la pantalla de carga; el orquestador la actualiza con `ui.setLoading(0..1, 'mensaje')` y la cierra con `ui.hideLoading()`.
- `ui.setCameraFov(fov)` con el FOV vertical de la cámara de piloto: la escalera de cabeceo del HUD queda **conforme** con el paisaje (el centro del HUD es el centro de pantalla).
- `ui.hud.setEnvironment({qnhHpa})` y `ui.hud.reset(fuelKg)` se llaman solos en `start`; si reinicia sin pasar por el menú, llamar a `ui.hud.reset(fuelKg)`.
- Claves de `localStorage`: `a10.ui.v1` y `a10.input.v1` (no se mezclan con las del Harrier).

## 2. `config` que entrega el menú (`ui.onStart(fn)` / `ui.getConfig()`)

```js
{
  source: 'real' | 'demo',                       // por defecto 'real' (mapa satelital real); 'demo' = sintético
  route:  { a:{lat,lon}, b:{lat,lon}, lengthM, bearingTrue },   // ruta del convoy A→B  ← FUENTE DE VERDAD
  runway: { thr1, thr2, lengthM, bearingTrue, widthM:8, surface:'asphalt', designators:false },  // ALIAS de route (thr1=a, thr2=b)
  extentKm: 2..8 (def. 4),                       // margen alrededor de la ruta
  mission: {
    convoySize: 4..16 (def. 8),
    mix: 'blindados' | 'mixto' | 'camiones' (def. 'mixto'),
    startDistanceKm: 4..12 (def. 7),             // distancia inicial al convoy
    startAltFt: 1000..8000 (def. 3000),
    startSpeedKt: 200..380 (def. 300),
    loadout: { mavericks: 0..6 (def. 4) },
  },
  timeOfDay: 'amanecer'|'dia'|'tarde'|'atardecer',
  quality: 'bajo'|'medio'|'alto',
  environment: { windKt, windFromDeg, tempOffsetC, qnhHpa, turbulence, surfaceWetness /*siempre 0: sin UI*/ },
  fuelKg: 500..4853 (def. 3000),
  assist: { stabilityAug: 0..1 (def. 1) },       // SAS de cabeceo/guiñada
  camera: 'pilot'|'chase'|'world' (def. 'pilot'), // cámara inicial
  audio: { volume, muted },
  vr?: true                                      // solo si se inició con «Iniciar en modo VR»
}
```
- **`route` vs `runway`**: la UI y los ajustes guardados usan `route {a,b}`. `cfg.runway` se conserva **solo como alias** (mismos puntos A→B como `thr1`/`thr2`, más `lengthM`/`bearingTrue`) para el código de mundo heredado; `widthM: 8`, `surface: 'asphalt'`, `designators: false` son valores fijos (ya no son opciones). No hay `start`, `nozzle` ni `hoverDamping`.
- Largo de la ruta: por defecto 3 km, permitido 1–8 km (si se marca fuera de rango, «Iniciar vuelo» avisa y vuelve a la pantalla de ruta). Ubicación por defecto: ruta rural cerca de Roldán (Santa Fe): A = (−32,905; −60,93), B = A + 3 km al oeste.
- Los ajustes guardados con el formato viejo (`runway.thr1/thr2`) se leen como `route.a/b`.

## 3. `createInput({ target, storage, config, document, window, now })`
Devuelve: `update(dt)`, `getControls(out?)`, `getLook(out?)`, `on('action', fn)`, `setEnabled(b)`, `reset({throttle, gearDown, flaps, assist})`,
`setAssist`, `setThrottle`, `setMouseStick(b)`, `setExternal({pitch,roll,yaw,brake})` (VR), `press(id)`, `getBindings()/setBinding(acción, [códigos])/resetBindings()`, `getSettings()/setSettings(p)`, `capture(cb)`, `dispose()`.

### 3.1 `controls` (lo que recibe `sim.step`)
```js
{
  pitch: -1..1,        // + = palanca atrás (proa arriba). Teclado con curva expo
  roll:  -1..1,        // + = ala derecha abajo
  yaw:   -1..1,        // + = pedal derecho
  throttle: 0..1,
  flaps: 0 | 1 | 2,    // UP / MVR / DN
  gearDown: boolean,
  brake: 0..1, parkingBrake: boolean,
  speedbrake: 0 | 1,   // aerofrenos (decelerones)
  airbrake: boolean,   // igual a speedbrake, por compatibilidad
  triggerGun: boolean, // cañón GAU-8/A (Espacio o botón izq. del mouse), mientras se mantiene
  trim: { pitch: -1..1, roll: 0, yaw: 0 },  // VELOCIDAD de compensación mientras se mantiene la tecla (+ = proa arriba)
  assist: { stabilityAug: 0..1 },
}
```
Sin `nozzleDeg` ni `waterInjection`. `getControls(out)` reutiliza `out`, `out.assist` y `out.trim` (sin asignaciones por cuadro).

### 3.2 Acciones (`input.on('action', name)`)
Emitidas al pulsar: `cameraNext, worldRelocate, toggleHud, toggleMouse, screenshot, pause, reset, gear, flaps, parkingBrake, speedbrake`,
y las de armas, con **nombre de evento distinto del id de la acción**: `fireMissile` (Enter), `lockTarget` (L), `unlockTarget` (U).
Las de tipo «mantener» (`gun`, `brake`, `trimPitch*`, ejes) no emiten eventos: se leen en `controls`.
`input.press('airbrake')` es alias de `speedbrake`; `press('water' | 'nozzlePreset*')`, `setNozzleDeg()` y `state.nozzleCmd` (siempre 0) quedan como no-op **solo** porque `src/xr/mapping.js` aún los llama.

### 3.3 Mapa de teclas por defecto (editable, persistente)
| Acción | Tecla | Acción | Tecla |
|---|---|---|---|
| Cabeceo proa abajo / arriba | ↑ / ↓ | Cañón (mantener) | Espacio · botón izq. del mouse |
| Alabeo izq. / der. | ← / → | Disparar Maverick | Enter |
| Pedales izq. / der. | A / D | Fijar blanco / ciclar | L |
| Gases +/− | W / S | Soltar blanco | U |
| Compensador cabeceo: abajo / arriba (mantener) | Coma / Punto | Tren | G |
| Flaps (ciclo UP→MVR→DN) | F | Frenos (mantener) | B |
| Freno de estacionamiento | V | Aerofrenos | K |
| Cámara siguiente | C | Reubicar cámara de mundo | T |
| HUD | H | Mouse-palanca | M |
| Pausa | P / Esc | Reiniciar | R |
| Captura | F2 | Mirar / zoom | botón der. / rueda |

### 3.4 Comportamiento
- **Teclas** por `KeyboardEvent.code`. Asignar una tecla a una acción se la quita a las demás (devuelve las afectadas). Se ignoran teclas con Ctrl/Alt/Meta y dentro de `<input>`.
- **Rampas de teclado** (cabeceo y alabeo): sube a `ramp.rise` = **1,2 /s** (0,83 s a fondo; el Harrier usaba 2,5 y daba giros bruscos al exigir el cabeceo), vuelve a neutro a `ramp.fall` = 4 /s; pedales `ramp.yawRise` = 2,5 /s. Cruzar al lado opuesto suma subida y caída. Teclas opuestas se anulan.
- **Curva expo** solo del teclado: `salida = (1−e)·v + e·v³` con `expo` = {pitch 0,45; roll 0,35; yaw 0,2}; a fondo sigue siendo ±1. No afecta al mouse ni a VR.
- **Gases** W/S a `throttleRate` 0,5 /s.
- **Mouse como palanca** (M): movimiento relativo acumulado, recentrado exponencial tras `mouseRecenterDelay`; pide Pointer Lock; Esc fuera del bloqueo emite `pause`. **Botón izquierdo = cañón** solo si el mouse-palanca está activo o el puntero bloqueado (no dispara al clicar menús). Botón derecho: mirada libre; rueda: zoom/distancia.
- `reset({throttle, gearDown, flaps, assist})`: defaults si falta algo → throttle 0,7; `gearDown` false; flaps 0; `stabilityAug` 1.
- `blur`, pestaña oculta o `setEnabled(false)` sueltan todo (incluido el gatillo); los interruptores (tren, flaps, aerofrenos…) se conservan.
- Ajustes (`getSettings/setSettings`): `ramp{rise,fall,yawRise}`, `expo{pitch,roll,yaw}`, `throttleRate`, `mouseStick`, `mouseSensitivity`, `mouseRecenterDelay`, `mouseRecenterRate`, `invertMouseY`, `lookSensitivity`, `invertLookY`.

## 4. `createCameraRig({ camera, world, aircraft, options, onModeChange })`
`setMode('pilot'|'chase'|'world'|'weapon')`, `next()`, `relocate()`, `snap()`, `update(dt, state, look)`, `setWorld`, `setAircraft`, **`setWeaponTarget(object3D|null, {switchTo?})`**, `hasWeaponTarget`, `mode`, `distance`, `options` (ver `defaultCameraOptions()`).
- **pilot**: ojo = `aircraft.eyeLocal` (del modelo) en el marco del grupo. Mirada libre ±150° / −60…+80° con vuelta suave; la rueda cambia el FOV.
- **chase**: **30 m** atrás (rango 10–200 m) y 12° arriba, referido al rumbo; resorte-amortiguador estable con cualquier `dt`; nunca a menos de 1,5 m del terreno.
- **world**: fija en el mundo, mira al avión con zoom automático; se reubica adelante de la trayectoria; nunca bajo `world.height + 2`.
- **weapon** (opcional): sigue al último Maverick lanzado, detrás (9 m, rueda 4–40 m) y 2,2 m arriba, mirando 40 m por delante de su trayectoria (dirección = velocidad suavizada; con el misil casi parado usa su eje +x local). Se suaviza el desfase respecto del misil, no la posición, así no se rezaga a alta velocidad. **Solo existe mientras haya blanco**: `setMode('weapon')` sin misil se ignora y `next()` lo salta (ciclo pilot → chase → world → weapon → pilot). `setWeaponTarget(obj)` no cambia de cámara sola salvo `{switchTo:true}`; `setWeaponTarget(null)` en modo weapon vuelve al modo anterior. `onModeChange(mode)` avisa de cada cambio (para `ui.hud.setMode`).

## 5. `createUI({ root, engine, storage, input })`
`showMainMenu()`, `showPause()`, `showScreen(name)`, `hideAll()`, `onStart(fn)`, `on('start'|'resume'|'restart'|'menu'|'quality'|'settings', fn)`, `toast(text, ms)`, `showLoading/setLoading/hideLoading`, `getSettings()/setSettings()/getConfig()`, `setCameraFov(fov)`, `hud`, `dispose()`.
- Menú «A-10C Thunderbolt II»: **Volar**, **Ruta del convoy**, **Controles**, **Calidad gráfica**, **Hora del día y clima**, **Ayuda**. Pausa: Reanudar, Reiniciar, Controles, Calidad, Ayuda, Menú principal. Pantallas: `main, fly, route (alias runway), controls, quality, weather, help, pause`.
- **Volar**: convoy (vehículos 4–16, composición blindados/mixto/camiones), punto de partida (distancia 4–12 km, altitud 1 000–8 000 ft, velocidad 200–380 kt), avión (Mavericks 0–6, combustible 500–4 853 kg, SAS), cámara inicial. Sin condición inicial parado/estacionario.
- **Ruta del convoy**: mapa (`engine.MapView`) para marcar **inicio (A) y fin (B)** (se conservan los dos últimos puntos), coordenadas editables, largo (1–8 km, mueve B) y rumbo verdadero, vista previa SVG, margen alrededor de la ruta 2–8 km, fuente real (def.) / demo, botón «Ruta por defecto (Roldán)». El adaptador `src/ui/runwaymap.js` exporta `createRouteMap` (alias `createRunwayMap`); `onChange({a, b})`. Si no hay MapView la pantalla funciona con coordenadas.
- **Controles**: reasignación de teclas (incluye armas) y ajustes: mouse, rampas de cabeceo/alabeo/pedales/retorno, suavizado (expo) de cabeceo y alabeo, velocidad de gases.
- **Ayuda**: teclas actuales, armas, pipper CCIP, instrumentos y técnica de ataque.

## 6. HUD (`ui.hud`, canvas 2D, `createHud`)
`update(state, controls, dt, extra?)`, `setMode('pilot'|'chase'|'world'|'weapon')`, `setVisible/toggle`, `setOptions({scale,color,vfovDeg,gunCapacity,inRangeM,shootRangeM,pipperCaptureFrac,noPanels})`, `resize()`, `reset(fuelKg)`, `setEnvironment({qnhHpa})`. Escala automática con la resolución (referencia 1280×720). `createHud({canvas, options:{noPanels:true}})` para VR (solo simbología, sin paneles oscuros).

### 6.1 `extra` (lo arma el orquestador; todo opcional, nada rompe si falta o trae basura)
```js
hud.update(state, controls, dt, {
  gun:      { ammo, firing, spin },                  // cartuchos restantes (de 1150), disparando, giro de cañones 0..1
  missiles: { left, locked: boolean, lockProgress },  // Mavericks restantes, bloqueado, 0..1
  ccip:     { x, y } | null,                          // punto de impacto previsto del cañón (normalizado −1..1; x derecha, y arriba)
  targets:  [{ x, y, dist, type, locked, alive }],    // blancos visibles ya proyectados (x,y normalizados; null o fuera si están detrás)
  range:    metros | null,                            // distancia al blanco bloqueado
  message:  'texto opcional',
  weapon?:  'gun' | 'agm65',                          // opcional; si falta: AGM-65 cuando locked o lockProgress > 0, si no GUN
});
```
Sin `extra` no se dibuja nada de armas (ni panel de munición, ni pipper, ni recuadros). Las coordenadas deben salir de **la cámara activa** (en vistas externas el orquestador puede pasar `ccip: null` / `targets: []`).

### 6.2 Contenido
- **pilot** (HUD completo, verde): escalera de cabeceo conforme y escala de alabeo, marcador de trayectoria, cinta de rumbo, cinta **KIAS** (con Mach y g), cinta de **altitud barométrica** + **RAD** (radar, AGL < 5 000 ft; ámbar < 200 ft), régimen de ascenso (VS, ft/min), AoA / GS / β y bola de derrape, **N1 de ambos motores** (`state.n1Pct [l,r]`; si falta usa `engine.rpmPct`), combustible (kg y kg/min), tren (3 luces), flaps UP/MVR/DN, **SPD BRK** abierto/cerrado, frenos, avisos.
- **Armas** (con `extra`): panel central con modo GUN / AGM-65, cartuchos (barra; ámbar < 10 %), «GIRANDO» durante el arranque del cañón y Mavericks restantes; **pipper CCIP** (círculo con punto central, marcas cardinales y anillo de distancia que se llena con el alcance al blanco); recuadros sobre blancos visibles y **diamante** con distancia/tipo sobre el bloqueado; progreso de enganche (`LOCK n %` con marco que se cierra, `LOCK` al bloquear); `IN RNG` con el blanco (bloqueado, o el más cercano) a < 4 km; `SHOOT` (parpadeante) cuando el pipper cae sobre un blanco a < 2,5 km (radio de captura 3,5 % de la altura de pantalla); `message` en el centro.
- **chase / world / weapon** (reducido): franja inferior con KIAS, BARO, RAD, rumbo, VS, N1 medio, g, cartuchos y Mavericks (si hay `extra`), tren, combustible y avisos; también dibuja pipper/blancos si `extra` los trae.
- **Avisos**: `STALL` (rojo, parpadea) si `state.stall`, `flags.stalled` o `warnings` contiene `STALL`; `BUFFET` (ámbar) si `state.buffet` (número 0..1 > 0,25 o `true`) y no hay pérdida; además `OVERTEMP, OVERSPEED, PULL UP, ENGINE, FIRE` (rojo) y `GEAR, BINGO, G LIMIT, FLAPS, LOWFUEL` (ámbar); desconocidos en ámbar. `flags.crashed` → «ACCIDENTE».
- Robusto: todo valor se acota y cualquier excepción del dibujo se captura (`hud.errors`). Se quitó todo lo de toberas, RCS, VTOL, inyección de agua y viento relativo.

## 7. Decisiones
- `KeyboardEvent.code` y no `key`: funciona igual en teclado español/inglés.
- La palanca con mouse es una entrada **relativa** que se suma al teclado y se recentra sola.
- `ccip`/`targets` llegan **ya proyectados** (el HUD no conoce la cámara): evita duplicar la matemática de proyección y funciona igual en VR.
- Umbrales de «IN RNG» (4 km) y «SHOOT» (2,5 km) configurables con `hud.setOptions({inRangeM, shootRangeM})`.

## 8. Verificación
`npm test` (tests/ui: input, cámara, geo, ajustes, HUD, UI con jsdom y MapView simulado). Capturas: `node_modules/.bin/esbuild tests/ui/harness/harness.js --bundle --format=iife --outfile=tests/ui/harness/dist/harness.js` y `python3 tests/ui/harness/shoot.py "nombre,screen=main|route|controls|weather|quality|help|pause|loading|fly|hud&cam=pilot|chase|world&preset=transition|hover|extreme,1280x720"` → `tests/ui/shots/`.

### 8.1 Prueba de punta a punta (navegador)
`python3 tests/e2e/menu_a10.py` recorre el menú real con clics: Ruta del convoy → Demo → Volar → Iniciar vuelo. Después vuela, bloquea (L), lanza un Maverick (Enter), dispara el cañón (Espacio), cambia de cámara (C) y pausa (P), y guarda capturas `m1…m9`. Verificado el 2026-11-23 con Chrome headless (swiftshader, ≈1 cuadro/s): no hubo errores de página, el Maverick salió y el cañón disparó 175 cartuchos en 15 s reales.

## 9. Ajustes posteriores
- El botón «Entrar en VR» quedó arriba a la derecha y más chico: abajo a la derecha tapaba el bloque de tren, flaps y aerofreno del HUD.
- Las etiquetas `LOCK` y `LOCK n %` se dibujan sobre el centro del HUD (debajo de `IN RNG`). Antes iban debajo y se superponían con la distancia del diamante del blanco bloqueado.

## 10. Cañón GAU-8/A: sonido, vibración, humo y velocidad del sonido
- **Sonido** (`src/audio/index.js`). Es un tren de pulsos real de 65 disparos/s: cada disparo combina un chasquido de ruido de ~4 ms y un golpe grave de ~60 Hz y ~14 ms. Pasa por una saturación suave y un realce de graves.
  - En cabina se oye «a través de la estructura»: pasabajos de 1,5 kHz, sub-graves de 32,5 y 65 Hz, traqueteo metálico de paneles y capota, y un golpe al arrancar.
  - Afuera el sonido es más brillante y la cola del rugido se alarga.
  - El silbido del giro de los 7 cañones suena durante el arranque y la parada.
- **Velocidad del sonido**: c = 20,05·√T, con la temperatura del aire de la física (343 m/s a 20 °C).
  - Fuera de la cabina, el comienzo y el fin del «BRRRT» llegan con retardo = distancia/c (cámaras de persecución y de mundo). Desde lejos primero se ven las trazadoras y los impactos y después se oye el cañón, como en los videos reales.
  - Cada impacto HEI de 30 mm se programa como una pequeña explosión que llega con su propio retardo (`audio.impacts`).
  - Los proyectiles van a ≈1 000 m/s (Mach 3). Los que pasan a menos de 35 m de una cámara externa producen un chasquido supersónico (`audio.crack`).
  - Las explosiones también usan retardo programado en el reloj de audio, hasta 30 s.
- **Vibración** (`applyGunShake` en `main.js`). La envolvente sube en 30 ms y cae en 160 ms. Mientras los cañones giran sin disparar queda un 12 % de vibración.
  - En cabina: temblor aleatorio de ±7 mm y ≈0,43° por cuadro, más un bamboleo de 11 Hz. El HUD también tiembla (±2–3 px).
  - En persecución la vibración es menor. En la cámara de mundo solo vibra a menos de 400 m del avión.
  - En VR la cámara **no** se sacude, para evitar el mareo. En su lugar vibran los dos mandos (`vr.rumble`, `hapticActuators.pulse`).
  - En la física, la modulación del retroceso (45 kN a 65 Hz) pasó del 15 % al 30 %.
- **Humo** (`combat.gunFire` en `render.js`).
  - Salen ~60 bocanadas/s de gas gris desde la boca, a la velocidad del avión más 40–100 m/s hacia adelante. El aire las frena enseguida y forman la nube que queda atrás y debajo del avión.
  - El fogonazo dura 45 ms.
  - En VR la cantidad baja a la mitad.
  - Los impactos levantan tierra y producen un destello.
