# Física del A-10C Thunderbolt II — modelo de vuelo, parámetros, API

Código: `src/physics/a10.sim.js` (clase `A10Sim`), `a10.params.js`, `a10.geometry.js`, `a10.aero.js`, `a10.controls.js`, `turbofan.js`.
Reutiliza sin cambios `rigidbody.js`, `math.js`, `atmosphere.js` (ISA + viento log + Dryden), `gear.js` (amortiguador oleoneumático con
brazo, neumático, frenos con anti-deslizamiento) y `ground.js` (superficies, `EMPTY_WORLD`). `HarrierSim` sigue exportado y sus pruebas pasan.
Convenciones: las de `docs/CONTRACT.md` (SI; mundo x=este, y=arriba, z=sur; cuerpo x=proa, y=arriba, z=derecha).

**Fuentes**
- [W] Wikipedia, *Fairchild Republic A-10 Thunderbolt II* (especificaciones): https://en.wikipedia.org/wiki/Fairchild_Republic_A-10_Thunderbolt_II
- [GS] GlobalSecurity, *A-10 Design*: https://www.globalsecurity.org/military/systems/aircraft/a-10-design.htm (TF34 ≈ 9 000 lbf; tren de trocha ancha y patas cortas)
- [U] cifras del encargo del proyecto (MTOW 23 000 kg, combustible 4 853 kg, CAM 3,04 m, TSFC 0,37, roll ≈ 100°/s, límites +7,33/−3 g, spool-up 6–8 s, CD0 ≈ 0,032).
- **ESTIMADO** = sin dato público encontrado; se da el razonamiento. No hubo acceso a manuales de vuelo (-1) ni a datos aerodinámicos tabulados del A-10.

## 1. Integración
Igual que el Harrier: `step(dt)` acumula y ejecuta subpasos fijos de **480 Hz**. Cada subpaso hace lo siguiente:
1. aire (ISA + viento + Dryden) → α, β, Mach, q̄;
2. mandos (servos con límite de velocidad, SAS, compensadores, flaps, decelerones) y tren;
3. motores y consumo;
4. masa, CG e inercia;
5. fuerzas (aero, empuje, fuerzas externas, tren, estructura);
6. integración por Euler semi-implícito en traslación y por la exponencial del cuaternión en rotación;
7. chequeos.

## 2. Geometría (`a10.geometry.js`)
`loadA10Geometry(raw)` acepta el JSON del agente de mallas (`src/physics/a10.geometry.json`, todavía no entregado) o nada.
- Marcos: `frame: 'body'|'three'` tal cual; `'cad-zup'` → cuerpo = (x, z, −y).
- Campos (todos opcionales): `eyeModel`, `cgModel`, `gear.{nose,mainL,mainR}.{axle|wheelCenter, wheelRadius, tireWidth, attach|legTop, pivot, armLength}` (o `gear.main.wheelCenters:[[..],[..]]`), `engines.{L,R}.{pos,dir}`, `gun.{muzzle,dir}`, `stations:[{id,pos}]`, `hardpoints:[{id,pos}]`.
- Cada campo faltante toma un valor de `A10_GEOMETRY_DEFAULTS` y deja un aviso en `geometry.notes`.

Defaults (origen = CG vacío de diseño):
- Largo 16,26 m, envergadura 17,53 m, altura 4,47 m [W].
- Rueda de proa desplazada a la derecha [W]: z = +0,35 m (ESTIMADO).
- Batalla 5,40 m y trocha 5,25 m (ESTIMADO, cifras de divulgación).
- Neumáticos: principal r = 0,457 m (36×11), proa r = 0,305 m (24×7,7) (ESTIMADO).
- Toberas de los TF34 en (−4,6; 1,25; ±1,65) m, empuje paralelo al eje x (ESTIMADO).
- Boca del cañón en (8,10; −0,72; 0) m. El cañón está montado algo a la izquierda [W] para que el caño que dispara quede en la línea central.
- 11 estaciones bajo ala y fuselaje (ESTIMADO).

**CG.** Si el JSON no trae `cgModel`, el CG vacío sale del reparto estático supuesto: proa 13 % (`gear.noseShare`) y CG a 1,75 m sobre el suelo (`gear.cgHeightM`). Con los defaults queda en ≈ (0, 0, 0). El CG real del avión se mueve con:
- combustible (centroide 0,20 m detrás del CG vacío);
- munición interna (2,6 m adelante, tambor);
- piloto;
- `payloadKg`;
- cargas en estaciones.

Las inercias se recalculan cada subpaso por ejes paralelos. La aerodinámica se aplica en el CG vacío (`aeroRef`), así que mover el CG cambia el margen estático, como en el avión real.

## 3. Masa e inercias
| Parámetro | Valor | Fuente |
|---|---|---|
| Vacío | 11 320 kg | [U][W] |
| Combustible interno | 4 853 kg | [U] ([W]: 4 990 kg) |
| MTOW | 23 000 kg | [U] ([W] da 46 000 lb = 20 865 kg para el A-10A) |
| Munición interna (sólo como masa) | 790 kg | ESTIMADO |
| Ixx / Iyy / Izz / Ixz (vacío + piloto) | 52 000 / 88 000 / 132 000 / 2 500 kg·m² | ESTIMADO (ver abajo) |

Razonamiento de las inercias: Ixx ≈ m·(0,25·b/2)², con masa repartida en alas largas y góndolas. Iyy ≈ m·(0,33·L/2)². Izz ≈ Ixx + Iyy − pequeño. El combustible suma con radios de giro 2,2 / 1,4 / 2,5 m y las cargas como masas puntuales. Comprobación: constante de tiempo de alabeo ≈ 0,25 s a 300 kt (prueba: 63 % de p máx. en 0,50 s incluyendo el servo).

## 4. Motores TF34-GE-100A (`turbofan.js`, uno por motor)
| Parámetro | Valor | Fuente |
|---|---|---|
| Empuje estático SL | 40,3 kN (9 065 lbf) c/u | [U][W] |
| Empuje vs N1 | tabla 32 % → 4,5 % … 100 % → 100 % | ESTIMADO (alto bypass, F ≈ ∝ N1²–³) |
| Lapso | F = F0(N1)·σ^0,75·(1 − 1,0 M + 0,55 M²) | ESTIMADO (bypass 6,2): a M 0,5 queda 64 % del estático |
| Dinámica N1 | τ 1,0 s (×2,4 cerca de ralentí), límite 18 %/s | ESTIMADO; resultado: **ralentí → 95 % del empuje en 6,7 s** [U: 6–8 s] |
| TSFC | 0,37 lb/(lbf·h) × (1 + 0,75 M) × (1 + 0,3 (1 − F/Fmax)) | 0,37 [U]; correcciones ESTIMADAS |
| Gases | `throttle` a los dos; `throttleL`/`throttleR` opcionales | |

Sin combustible los dos motores se apagan (evento `flameout`) y N1 cae a molinete.

## 5. Aerodinámica (`a10.aero.js`)
| Parámetro | Valor | Fuente |
|---|---|---|
| S, b, CAM, AR | 47,0 m², 17,53 m, 3,04 m, 6,54 | [U][W] |
| Perfil | NACA 6716 raíz / 6713 punta, sin flecha | [W] |
| CLα | DATCOM (Helmbold + Prandtl-Glauert, κ 0,95): 4,4 /rad a M 0,2 | calculado |
| CL0, α pérdida, rodilla | 0,20; 16°; redondeo cuadrático desde 10° (CLmax 1,25 limpio) | ESTIMADO, calibrado con Vs = 120 KIAS a 30 000 lb [W] |
| Post-pérdida | mezcla sigmoide de 2,5° hacia 0,8·CLmax·sin2α/sin2αs | ESTIMADO (pérdida suave de ala recta gruesa) |
| Caída de ala | ΔCl ±0,018·profundidad de pérdida, lado por semilla, τ 0,8 s | ESTIMADO, **moderada** (prueba: ≤ 8°/s de alabeo inducido) |
| CD0 | 0,032 limpio + 0,010 de los 11 pilones fijos | 0,032 [U]; pilones ESTIMADO (da Vmax ≈ 380 KIAS a 1 000 ft; [W] 381 kt SL) |
| Oswald / onda | 0,80 / ΔCD = 25(M − 0,68)⁴ | ESTIMADO |
| Margen estático | 0,12 CAM | ESTIMADO |
| Cmq, Cmα̇, Cmδe, CLδe | −14, −5, −1,55, 0,38 /rad | ESTIMADO (brazo de cola l_t/c ≈ 2,3) |
| Lateral | CYβ −0,80; Clβ −0,10; Cnβ 0,12; Clp −0,48; Cnr −0,22; Clr 0,14; Cnp −0,06 | ESTIMADO |
| Alerones / timón | Clδa 0,113 (±25°); Cnδa −0,006; Cnδr 0,085 (±20°); CYδr 0,14 | ESTIMADO, calibrado a **≈ 100°/s a 300 kt** [U] |
| Flaps UP/MVR/DN | 0/7/20° [U]; ΔCL 0/0,10/0,30; ΔCD 0/0,006/0,030; ΔCm 0/−0,012/−0,04 | ESTIMADO; DN se retrae a MVR sobre 210 KIAS (ESTIMADO) |
| Decelerones | hojas de ±40°; ΔCD 0,075, ΔCL −0,03 a fondo; **sin momento de alabeo** | ESTIMADO |
| Tren | ΔCD 0,015 (+0,006 en tránsito) | ESTIMADO |
| Cargas | Σ `dCD` de `setStores` sobre CD0 | dato que pasa quien carga |
| Efecto suelo | Wieselsberger sobre la inducida; +10 %(1 − φ) en CLα | clásico |

## 6. Mandos (`a10.controls.js`)
- Servos a 50°/s.
- Profundidad: +20° / −30° (ESTIMADO).
- Compensadores en los tres ejes. `controls.trim.{pitch,roll,yaw}` son **velocidades** de −1..1: cabeceo a 1,5°/s en ±10°, alabeo ±3°, guiñada ±4°. Después de `reset('cruise')` el compensador queda en el valor de trim: no hace falta mantener la palanca.
- **SAS de cabeceo y guiñada** (el A-10C los tiene; no tiene SAS de alabeo):
  - amortiguador con filtro de lavado de 1,5 s, así no se opone a un giro sostenido;
  - guiñada más 0,25°/° de β;
  - autoridad del 25 % del recorrido;
  - `assist.stabilityAug` 0..1, donde **1 = nominal (por defecto)**.
- `speedbrake` 0..1 (o `airbrake` bool) a 30°/s.
- `controls.nwsOff` desactiva la dirección de proa.

## 7. Tren (`gear.js` reutilizado: `nose`, `mainL`, `mainR`)
- Dimensionado a 19 000 kg: presión estática 9 MPa, relación 3,2 y sink de diseño 3,05 m/s (ESTIMADO).
- Rigidez de neumático 0,9 / 1,6 MN/m.
- Frenos de 32 kN·m por rueda principal, con anti-deslizamiento al 12 % de deslizamiento.
- Dirección de proa ±55° hasta 2 m/s, que baja a ±6° desde 12 m/s (ley de `gear.js`). Radio de giro ≈ 5 m.
- Tiempos de subida y bajada 6 s, límite 200 KIAS (ESTIMADO).
- No sube con peso en ruedas.
- Colapso con sink > 5 m/s; aterrizaje duro con sink > 3,3 m/s.
- Por el desplazamiento de la rueda de proa a la derecha, la principal izquierda carga más (43,4 % contra 41,4 %). Es coherente con que el A-10 gira más cerrado a la derecha [W].
- Puntos duros de contacto: nariz, boca del cañón, panza, cono de cola, puntas de estabilizador, puntas de ala y góndolas.

## 8. Fuerzas externas, cargas y munición (puntos de enganche)
La física **no** incluye simulación de armas, proyectiles ni blancos. Expone tres entradas genéricas:
```js
sim.setExternalForce(id, { forceBody:[fx,fy,fz] /*N, cuerpo*/, posModel /*opcional: por defecto geometry.gun.muzzle*/,
                           vibration /*opcional {frac, hz}: modulación determinista*/ });
sim.clearExternalForce(id);
sim.setStores([{ station, massKg, dCD }])   // masa, CG, inercia y resistencia; volver a llamar al soltar algo
sim.setAmmoKg(kg)                           // masa interna (CG adelante)
```
Retroceso del cañón: quien maneje el disparo llama a `setExternalForce('gunRecoil', { forceBody: [-F, 0, 0], vibration: {...} })` mientras dispara y a `clearExternalForce('gunRecoil')` al soltar. La fuerza se mantiene en todos los subpasos hasta que se cambie. El punto de aplicación por defecto es la boca: el momento de cabeceo sale de su altura respecto del CG y el de guiñada de su desplazamiento lateral, si la geometría lo trae.

Desaceleración que resulta (física pura, F/m): una fuerza de 45 kN da 3,0 m/s² ≈ **5,8 kt/s a 15,2 t** y ≈ 3,8 kt/s a 23 t. La prueba mide **5,0 kt/s** a 300 KIAS con gases constantes: el resto lo compensa el aumento de α y de q̄ que corrige el SAS. Ese valor es mayor que la estimación de 1–2 kt/s del encargo, que no cierra con F = 45 kN y m ≈ 15 t.

## 9. API
```js
import { A10Sim, A10_PARAMS, loadA10Geometry, A10_GEOMETRY_DEFAULTS, A10_GEAR_IDS, A10_DEFAULT_CONTROLS } from './physics/index.js';
const sim = new A10Sim({ params /*se fusiona sobre A10_PARAMS*/, geometry /*JSON crudo o normalizado*/, seed, substepHz });
sim.setWorld(world); sim.setEnvironment({ windKt, windFromDeg, tempOffsetC, qnhHpa, turbulence, surfaceWetness });
sim.reset({ x, z, headingDeg, y, state: 'parked'|'cruise', speedKt /*KIAS; speedIsIas:false -> TAS*/, altFt /*MSL*/ | aglM,
            fuelKg, gearDown, flaps, payloadKg, ammoKg, stores });
sim.step(dt, controls);  // controls: pitch, roll, yaw, throttle (throttleL/R), flaps 0|1|2, gearDown, brake, parkingBrake,
                         // speedbrake 0..1, trim{pitch,roll,yaw}, assist{stabilityAug}, antiSkid, nwsOff
sim.getState(out?)       // esquema del contrato §3.2 + engine.n1Pct[2], thrustLN/RN; controlSurfaces.{elevatorDeg, speedbrakeDeg,
                         // deceleronSplitDeg, sasPitchDeg, sasYawDeg, flapsBlownUp}; mass{...}; air.buffet; external{forceXN, ids}
sim.events / sim.drainEvents()  // touchdown, hardLanding, crash, stall, gearLock, overspeed, gLimit, flameout, scrape
```
- `trim` del estado: `{ok, throttle, pitchDeg, aoaDeg, elevatorTrimDeg, tasKt}`. Después de `reset('cruise')` la entrada debe arrancar con `trim.throttle`.
- Unidades del tren: `nose`, `mainL`, `mainR`. Partes 3D sugeridas: `NoseWheel`, `NoseGearLeg`, `MainWheelL/R`, `MainGearLegL/R`.
- `warnings`: `STALL, GEAR, BINGO (<900 kg), ENGINE, OVERSPEED (>450 KIAS o tren >200), G LIMIT (+7,33/−3,0), FLAPS` (retracción automática).

## 10. Resultados (`node --test tests/physics/a10*.test.mjs`)
| Prueba | Resultado |
|---|---|
| Trim 300 KIAS / 5 000 ft (15,2 t) | α 0,20°, gases 77,8 %, compensador −0,27°; en 60 s sin mandos: 0,2 kt, 9 ft, 0,03°, sin alabeo |
| Pulso de palanca y pedal | 8 s después q −0,14°/s y r 0,44°/s (amortiguado); 60 s con turbulencia 0,5 sin divergir |
| Pérdida a 30 000 lb | CLmax 1,25 → **Vs 118,5 KIAS** (1 g); aviso a 119,6 KIAS en entrada lenta (α 18,5°); caída de ala: p máx. 8°/s; recupera en 1,7 s |
| Régimen de alabeo a 300 KIAS | **102°/s** |
| Techo absoluto (≈14,7 t) | 46 800 ft ([W]: techo de servicio 45 000 ft) |
| Vmax a 1 000 ft | ≈ 380 KIAS ([W]: 381 kt) |
| TSFC estático | 0,371 lb/(lbf·h); crucero 300 kt / 5 000 ft: 1 880 kg/h (≈ 2,6 h con el interno) |
| Spool-up | ralentí → 95 % en **6,7 s** |
| Fuerza de 45 kN en la boca | 5,0 kt/s de desaceleración (F/m = 5,75); q máx. 1°/s |
| Cargas | +660 kg: gases de trim 77,8 → 89,6 %; CG lateral −0,09 m |
| Reparto estático (17,1 t) | proa 15,2 %, izquierda 43,4 %, derecha 41,4 %; suma/W 1,0001 |
| Despegue a **23 t** (MVR, rotación a 140 KIAS hasta 12°) | **1 072 m**, 146 KIAS, 26,6 s; asciende despacio (3,6 m/s a los 10 s) |
| Despegue a 14,7 t | 418 m, 119 KIAS |
| Aterrizaje (14,2 t, flaps DN, 3°, decelerones + frenos) | toque a 122 KIAS y 0,8 m/s; carrera 470 m |
| Frenos 80 kt → 0 | 169 m: **5,0 m/s²** medios |
| Dirección de proa | ±49° a ≈8 kt (giro de 210° en 6 s), 6° a 40 kt |
| Caídas | 0,3 m: 88 % de carrera sin daño; 3 m: colapso |
| Determinismo | idéntico con la misma semilla |
| 10 min de mandos aleatorios | sin NaN |
| **Costo por cuadro** (Node 22, 480 Hz, 8 subpasos) | crucero 0,012 ms; cerca del suelo 0,028 ms; en tierra 0,040 ms; con fuerza externa 0,008 ms (objetivo < 0,3 ms) |

## 11. Limitaciones
- Casi toda la aerodinámica, las inercias, el tren y la tabla del motor son **ESTIMADOS**, calibrados a las pocas cifras públicas (Vs, Vmax, techo, roll rate, spool-up, TSFC).
- No hay efecto del empuje asimétrico sobre la guiñada más allá del brazo geométrico (sí se modela: con un motor apagado aparece el momento).
- No hay daño progresivo, hielo ni hidroplaneo.
- El modo de reversión manual de mandos no está modelado.
- Geometría por defecto hasta que llegue `a10.geometry.json`.
