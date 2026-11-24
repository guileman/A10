# Pedidos entre módulos

## De UI -> orquestador (`main.js`)
1. **MapView/fuentes**: confirmar el formato de `getPath()/setPath()` (`{lon,lat}` vs `[lon,lat]`; el adaptador lo autodetecta con la primera lectura, pero si el camino está vacío escribe `{lon,lat}`; se puede forzar con `pathFormat` en `createRunwayMap`). Ofrecer `engine.makeSource('demo'|'real')` o constructores sin argumentos `SyntheticSource`/`TileSource`. `MapView` debe notificar `onChange` al marcar/mover puntos y NO al llamar `setPath` (el adaptador igual se protege con un indicador).
2. **Grupo del avión**: `aircraft.group` debe tener la pose del estado (posición del modelo, cuaternión cuerpo→mundo) antes de `rig.update`; `eyeLocal` en el marco del grupo.
3. **Ciclo**: `input.update(dt)` → `getControls()`; `rig.update(dt, state, input.getLook())`; `ui.hud.update(state, controls, dt)`; `ui.setCameraFov(camera.fov)` al crear/cambiar el FOV de piloto; `ui.hud.reset(fuelKg)` al reiniciar; `input.reset({...})` con la condición inicial (p. ej. `hover`: `nozzleDeg: 85, gearDown: true, flaps: 2`).
4. **Eventos**: escuchar `ui.onStart`, `ui.on('resume'|'restart'|'menu')` y `input.on('action')` (`pause`, `reset`, `cameraNext`, `worldRelocate`, `toggleHud`, `screenshot`). Tras `onStart` el UI ya muestra la carga: llamar `ui.hideLoading()` al terminar.
5. `config.runway` lleva campos extra: `lengthM, bearingTrue, designatorA, designatorB`; el mundo puede usarlos para rotular la pista.

## De UI -> física (solo lectura de `getState()`)
- Usados por el HUD: `att`, `air.{iasKt,machNo,aoaDeg,betaDeg,altMslM,altAglM,vsMs,gs,nz,windBody}`, `engine.{rpmPct,thrustN,fuelKg,fuelFlowKgS,jptC,waterKg,stall}`, `nozzles.{cmdDeg,angleDeg}`, `rcs.{nose,tail,tailYaw,wingL,wingR}.{forceN,dir}` + `rcs.pressurePct`, `controlSurfaces.{flapsDeg,airbrakeDeg}`, `gear.state`, `flags.*`, `warnings[]`, `vel`, `quat`.
- Aclarar en el contrato: (a) `air.windBody` = viento (vector, m/s, ejes cuerpo) y no viento relativo; (b) `rcs.*.dir` unitario en ejes cuerpo; (c) nombres de `warnings` (el HUD reconoce `STALL, OVERTEMP, OVERSPEED, PULL UP, ENGINE, FIRE, GEAR, BINGO, G LIMIT, HOT GAS, FLAPS, LOWFUEL`).

## De física -> UI / orquestador (respuestas y pedidos)
Respuestas a las aclaraciones de UI:
- (a) `air.windBody` = vector de VIENTO (m/s, ejes cuerpo, incluye ráfaga). Viento en mundo: `air.windWorld`.
- (b) `rcs.<id>.dir` = vector unitario en ejes cuerpo de la FUERZA sobre el avión (el chorro sale en sentido opuesto); `forceN` ≥ 0. Posición de cada válvula: `rcs.<id>.posModel` (marco modelo, ejes cuerpo).
- (c) `warnings` usa: `STALL, GEAR, BINGO, OVERTEMP, ENGINE` (apagado por combustible), `OVERSPEED, G LIMIT, HOT GAS, WATER` (agua < 30 kg con inyección).
- `omega` = velocidad angular en ejes cuerpo del contrato [ωx, ωy, ωz] (ωy + = proa a la IZQUIERDA). Para HUD usar `rates.{p,q,r}` (convención aeronáutica, rad/s; r + = proa a la derecha).
- Eventos: `touchdown {unit,sinkMs}`, `hardLanding`, `crash {reason}`, `stall {aoaDeg}`, `gearLock {down}`, `overspeed`, `gLimit`, `flameout`, `scrape {id}`. `sim.drainEvents()` devuelve y vacía la cola.
- `getState().trim.{throttle,nozzleDeg,flaps,stabilatorDeg}`: tras `reset('hover'|'cruise')` la entrada debe arrancar con ESOS valores (`input.reset`), si no el motor/toberas se apartan del trim. Hover por defecto: toberas 83°, flaps 2, 50 % de combustible (con tanques llenos el hover queda al límite del empuje seco).
- Mandos opcionales extra aceptados en `controls`: `trimPitch` (−1..1, velocidad de compensador; + = proa arriba), `antiSkid` (bool, por defecto true), `assist.autoTrim` (0..1, ayuda no real).

Pedidos al orquestador (`harrier.geometry.json`):
1. Agregar `frame: "cad-zup"` explícito (hoy se detecta por `_note`/`scaleMPerUnit`). Convención usada: cuerpo = (x, z, −y), y CAD = izquierda.
2. Agregar `intake.{L,R}` (labios de toma; hoy ESTIMADOS en x=2,9 m) y `hardpoints` (punta de nariz, panza, cono de cola, puntas de ala) medidos del modelo.
3. Revisar el ancho de ala: las válvulas de punta de ala quedan en ±4,81 m (envergadura 9,6 m) frente a 7,70 m real; los estabilizadores en ±2,475 m (trocha 4,95 m; FlightGear/fuentes secundarias ≈ 6,5–6,8 m). Si la escala lateral está mal, corregirla mejora el vuelco en rodaje y el brazo de RCS de alabeo.
4. La rueda de proa del JSON queda 0,156 m más baja que la posición estática que exige suelo plano con actitud de tierra de 1° (ver PHYSICS.md §Tren). Para animar, usar `gear.units[].wheelPosWorld`, `armAngleDeg` y `wheelTravel` (no la posición del JSON).
5. Obstáculos: la física acepta de `world.obstacles.query(x,z,r,out,max)` un array (o cuenta + `out`) de `{x, z, r|radius, h|height, y?, type?}` (y = base; si falta, `world.height`).
6. Nombres de partes: `gear.units[].parts.{wheels[],leg}` y `tires[].part` ya mapean a NoseWheel, NoseGearLeg, MainWheelL/R, MainGearLeg, OutriggerLegL/R, OutriggerWheelL/R. Toberas: `nozzles.angleDeg` (rotación común de NozzleFront/NozzleRear alrededor de su eje lateral, 0° = hacia atrás).

## De física (A-10) -> orquestador / UI
1. **Geometría**: cuando exista `src/physics/a10.geometry.json`, importarlo en `main.js` y pasarlo como `new A10Sim({ geometry })` (la física no lo importa estáticamente para no romper si falta). Campos y marcos aceptados: `docs/PHYSICS_A10.md` §2. Pedido al agente de mallas: incluir `frame`, `cgModel` si lo conoce, `gear.{nose,mainL,mainR}.{axle,wheelRadius,attach}`, `engines.{L,R}.pos` (salida de tobera), `gun.muzzle`, `stations[]`, `hardpoints[]`, `eyeModel`.
2. **Armas y blancos**: el agente de física NO implementó `weapons.js` ni `targets.js` (balística, guiado, efectos sobre blancos). A10Sim sólo expone puntos de enganche genéricos: `setExternalForce(id, {forceBody, posModel, vibration})` / `clearExternalForce(id)` (p. ej. retroceso mientras se mantiene el disparo), `setStores([{station, massKg, dCD}])` y `setAmmoKg(kg)`. Lo que el orquestador decida para la jugabilidad se conecta por ahí.
3. **Entrada**: `controls` del A-10 = `pitch, roll, yaw, throttle (throttleL/R), flaps 0|1|2, gearDown, brake, parkingBrake, speedbrake 0..1, trim{pitch,roll,yaw}` (velocidades −1..1), `assist{stabilityAug}` (por defecto 1 = SAS nominal). Tras `reset('cruise')` arrancar con `getState().trim.throttle`; el compensador ya queda puesto.
4. **HUD**: además del esquema del contrato: `engine.n1Pct[2]`, `controlSurfaces.speedbrakeDeg`, `controlSurfaces.flapsBlownUp`, `air.buffet` (0..1, sacudida previa a la pérdida), `warnings` con `FLAPS`. `reset({speedKt})` interpreta KIAS.
