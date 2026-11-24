# Malla del A-10 Thunderbolt II

Se genera todo con `python3 tools/a10_export.py` (unos 50 s; con `--no-render` no hace las imágenes). Entradas, solo lectura:

| Archivo | Uso |
|---|---|
| `/mnt/user-data/uploads/A10_thunderbolt_2.STEP` | **modelo base**: cuerpo, superficies, cabina (butaca, piloto, tablero), canopy, cañón, tren |
| `/mnt/user-data/uploads/8b180f4f-a10_warthog.stp` | solo las plantillas **AGM-65** y **Mk-82** |

Salidas:

- `assets/a10.glb`
- `assets/a10.parts.json`
- `src/physics/a10.geometry.json`
- `docs/mesh/*.png`
- `tools/a10_render.py`: los renders de verificación, con un rasterizador z-buffer hecho con numpy y matplotlib.

La teselación (OCP, deflexión 0,08 u, ángulo 0,35 rad) queda en caché en `~/.cache/a10_export/`. Por cada triángulo guarda su cara B-rep y su sólido, y eso permite separar las superficies de control.

## Ejes y escala

- **Archivo STEP**: x = **izquierda** (babor), y = arriba, z = **proa**. Es una terna derecha. Se verificó así:
  - la cabina y el cañón están en +z;
  - el cañón está en +x, o sea a la izquierda, y la rueda de proa en −x, a la derecha, como en el A-10 real.
- **Marco del GLB, que es también el marco del modelo y del cuerpo**: x = proa, y = arriba, z = derecha (estribor), en metros. La conversión es `cuerpo = (z, y, −x)·S − origen`. Es una rotación pura, sin espejo.
- **Escala**: `S = 0,067490 m por unidad del archivo`. Se forzó la envergadura a 17,53 m. El archivo **no** está en mm, a pesar de lo que se suponía.

| Dimensión | Modelo | A-10 real | Diferencia |
|---|---|---|---|
| Envergadura | 17,530 m | 17,53 m | (forzada) |
| Largo, con la boca del cañón | 15,807 m | 16,26 m | −2,8 % |
| Largo del fuselaje, sin cañón | 15,518 m | — | |
| Altura, de la rueda a la punta de la deriva | 4,357 m | 4,47 m | −2,5 % |
| Área alar medida en planta (con la parte dentro del fuselaje) | 50,0 m² | 47,0 m² | +6 % |
| CMA medida | 2,909 m | 3,04 m | −4 % |
| Trocha del tren principal | 5,15 m | ≈ 5,25 m | −2 % |
| Distancia entre ejes | 4,49 m | ≈ 5,4 m (fichas públicas, verificar) | **−17 %** |

Las escalas longitudinal y vertical quedan algo cortas porque el modelo no está a escala exacta; no se corrigieron con escala no uniforme. La física debe usar las referencias reales (`wing.refAreaM2 = 47`, `macM = 3,04`), que están en `a10.geometry.json`, y no el área medida.

## Origen = CG supuesto (ESTIMADO)

El origen está en el **27 % de la CMA medida**, sobre el plano de simetría:

- **Altura**: la mitad entre el techo del fuselaje y la panza en esa estación. Esto equivale a archivo (0; 1,49; −6,03).
- **Longitud**: el borde de ataque de la CMA queda en x = +0,785 m y la CMA está en la estación de envergadura de 4,09 m. El CG queda entonces en x = 0,785 − 0,27·2,909 = 0. `cgModel = [0,0,0]`.
- **Atención**: con este CG el eje del tren principal queda apenas **0,18 m detrás del CG**, así que la rueda de proa lleva ≈ 4 % del peso. El modelo tiene el tren principal ≈ 0,9 m más adelante que el avión real, que tiene unos 5,4 m entre ejes. Si la física necesita una carga de proa realista (≈ 10–12 %), puede correr `cgModel` a x ≈ +0,30…+0,35 m, que es ≈ 16–17 % de la CMA. La decisión queda para la física; el GLB no cambia.

## Nodos (`assets/a10.parts.json` trae bbox, pivote, eje, rango y padre)

Jerarquía: `A10` → nodos de abajo, más `Stations` y `Templates`. El pivote es la posición **absoluta** del origen del nodo en el marco del modelo. Los hijos guardan en el glTF una traslación relativa a su padre. Cada nodo tiene un solo mesh, y el eje y el rango van en `extras`, que three.js lee como `userData`.

| Nodo | Tri | Pivote (m) | Eje | Rango (°) / signo |
|---|---|---|---|---|
| Body | 62 000 | 0 | — | fuselaje, alas, góndolas, derivas, pilones, interior de la cubierta trasera |
| Gun | 8 000 | 0 | — | morro del GAU-8 (7 tubos) |
| CockpitPanel *(interior)* | 9 000 | 0 | — | tablero, visera y consola, sacados del cuerpo por caras |
| PilotSeat *(interior)* | 7 800 | 0 | — | butaca eyectable |
| Pilot *(interior)* | 12 750 | 0 | — | piloto; **ocultarlo en la vista en primera persona** |
| WindshieldFrame / WindshieldGlass | 2 500 / 970 | 0 | — | parabrisas fijo |
| CanopyFrame → CanopyGlass (hija) | 2 500 / 1 400 | (2,236; 0,673; 0) | +z | 0…40; + = abre hacia arriba-atrás, con bisagra trasera |
| AileronL/R | 1 200 c/u | (−1,380; −0,108; ∓6,876) | ≈ +z (sigue el diedro) | −25…25; + = borde de fuga abajo |
| FlapInnerL/R | 1 200 c/u | (−1,623; −0,437; ∓1,583) | +z | 0…40; + = abajo |
| FlapOuterL/R | 1 200 c/u | (−1,587; −0,318; ∓4,002) | ≈ +z | 0…40 |
| ElevatorL/R | 483 c/u | (−7,552; −0,352; ∓1,401) | +z (común) | −30…20; + = borde de fuga abajo |
| RudderL/R | 1 800 c/u | (−7,613; 0,632; ∓2,531) | +y | −30…30; + = borde de fuga a la derecha |
| NoseGear → NoseWheel (hija) | 3 500 / 2 500 | pata (4,312; −0,538; 0,177); eje de rueda (4,312; −2,070; 0,177) | pata +z | pata 0…90: + = retrae hacia ADELANTE. Rueda: giro en z local, dirección en y local (±60) |
| NoseGearLinks | 1 600 | (3,886; −0,438; 0,177) | — | brazos y compuerta trasera; **ocultarlos con extensión < 0,6** |
| NoseGearDoor | 1 850 | (5,440; −0,571; 0,469) | +x | 0 = abierta (como está en el CAD); +90 = cerrada, gira hacia el centro |
| MainGearL/R → MainWheelL/R (hija) | 3 500 / 3 000 | pata (−0,180; −0,296; ∓2,322); eje de rueda (−0,180; −1,952; ∓2,575) | +z | 0…88: + = la pata gira hacia ADELANTE dentro de la góndola y la rueda queda semiexpuesta. Rodar hacia adelante = rotación **negativa** en z |
| MainGearBraceL/R | 600 c/u | — | — | riostra; **ocultarla con extensión < 0,6**, porque no se modela su pliegue |
| Stations/STA1…STA11 | — | puntos de enganche | — | nodos vacíos (ver más abajo) |
| Templates/AGM65, Templates/Mk82 | 2 500 c/u | origen en el centro, x = proa | — | **grupo oculto** (`extras.hidden`, que el cargador debe aplicar) |

Las mitades izquierda y derecha tienen el mismo pivote con z negativa a la izquierda. En la tabla, ∓ quiere decir L = −, R = +.

Triángulos:

| Grupo | Triángulos |
|---|---|
| Exterior | **112 784** (≤ 120 k) |
| Interior de cabina | **29 549** (≤ 40 k) |
| Plantillas | 5 000 |

El exterior incluye el tren, las superficies, el canopy y el cañón.

Materiales PBR, con color base lineal:

| Material | Uso y color |
|---|---|
| `gunship` | FS 36118 Gunship Gray ≈ sRGB #4E5452 |
| `gunmetal` | cañón |
| `gear` | gris claro |
| `tire` | neumáticos |
| `glass` | BLEND, α = 0,22, doble cara |
| `cockpit` | gris muy oscuro |
| `seat` | butaca |
| `pilot` | oliva |
| `weaponw` | Maverick, gris claro, doble cara |
| `weapon` | Mk-82, oliva, doble cara |

Las normales son suaves, con un ángulo de quiebre de 35°: se duplican los vértices en las aristas vivas.

## Qué se pudo articular

- **Alerones, flaps (interior y exterior) y timones de dirección**: son **sólidos separados** dentro de "thunderbolt body", así que el corte es limpio. Las bisagras son el borde de ataque de cada superficie, medido en sus dos extremos. En el A-10 real los alerones son "decelerones" (se abren en tijera como aerofreno). El modelo trae una sola hoja: el aerofreno no se puede representar sin modelar más.
- **Timón de profundidad**: el tramo interior (de |z| 0,37 a 1,42 m) tiene caras B-rep propias detrás de la bisagra, en z = −118,3 u del archivo. En el tramo exterior, las pieles superior e inferior del estabilizador son **una sola cara** que incluye al elevador. Se **cortaron con el plano de la bisagra**, en z = −118,42 u del archivo, que es la misma recta del tramo interior. El corte es recto y deja el borde abierto: cuando el elevador deflecta se ve una ranura fina, con caras traseras, sobre la bisagra exterior. No hay tapas.
- **Canopy**: la pieza trasera, `CanopyFrame` + `CanopyGlass`, abre con bisagra trasera. El parabrisas es fijo.
- **Tren**: las ruedas se separaron de las patas por caras (las que están completamente dentro del cilindro del neumático).
  - El "wing wheel rh" del STEP **ya trae las dos patas principales**, como 2 sólidos, así que no hizo falta espejar.
  - Las riostras diagonales del tren principal (`thunderbolt wing wheel strut`) y los brazos y la compuerta trasera del tren de proa no se pueden plegar como piezas rígidas. Van en nodos aparte para ocultarlos con el tren arriba.
  - Retraído, el tren principal deja la rueda en la nariz de la góndola, semiexpuesta como en el A-10. La rueda de proa queda bajo la nariz, parcialmente expuesta. Ver `docs/mesh/pose_retracted.png`.
- **Cabina**: el tablero, la visera y la consola delantera se sacaron del cuerpo por caras B-rep completas dentro de la caja de la cabina. La cubierta trasera detrás de la butaca quedó en Body.

## Datos para la física (`src/physics/a10.geometry.json`, con `frame: "body"`)

- **eyeModel / eyeLocal** = (4,072; 1,184; −0,002). Está 7 cm delante del centro del casco y 14 cm bajo su tope. El tubo de oxígeno se excluye al buscar el casco.
- **Cañón**: la boca está en (7,256; −0,513; **−0,116**) y el eje es +x. La boca queda **0,12 m a la izquierda** de la línea central. En el A-10 real es ≈ 0,3 m: el modelo base lo tiene más centrado y no se corrigió. La rueda de proa está desplazada **0,18 m a la derecha**, igual que en el avión real.
- **Tren**:

  | Unidad | Eje | Radio | Contacto con el suelo |
  |---|---|---|---|
  | Proa | (4,312; −2,070; 0,177) | 0,236 m (el real es ≈ 0,30 m) | y = −2,307 |
  | Principal | (−0,180; −1,952; ±2,575) | 0,336 m (el real es ≈ 0,46 m) | y = −2,288 |

  Con el modelo apoyado en sus ruedas, la actitud es ≈ 0,1° de proa abajo. Las carreras del amortiguador son **ESTIMADAS**: 0,30 m en la proa y 0,36 m en el principal. El eje de dirección de la proa es +y y pasa por el eje de la rueda, que está debajo de la pata.
- **Estaciones**: el enganche es la cara inferior del pilón sobre la carga original del modelo base. La numeración sigue la real, de 1 a 11 desde la punta izquierda; la **6 (central) no existe** en el modelo.

  | Estación | x | y | z | Carga original |
  |---|---|---|---|---|
  | STA1 / STA11 | −0,223 | −0,486 | ∓5,90 / 5,88 | misil |
  | STA2 / STA10 | −0,070 | −0,582 | ∓4,75 / 4,76 | misil |
  | STA3 / STA9 | 0,384 / 0,378 | −0,692 / −0,689 | ∓3,62 | lanzacohetes / misil |
  | STA4 / STA8 | 0,435 | −0,791 | ∓1,39 | misil |
  | STA5 / STA7 | 0,230 | −0,799 | ∓0,38 | bomba, pilones de fuselaje |

  Para colgar una plantilla: `pos = estación − (0, lugOffsetM, 0)`. `lugOffsetM` es el radio del cuerpo: 0,1525 en el AGM65 y 0,1365 en el Mk82.
- **Plantillas**:
  - **AGM65**: escalada por largo a 2,49 m. El modelo fuente tenía 0,247 m de diámetro y se escaló radialmente ×1,235 hasta 0,305 m.
  - **Mk82**: 2,21 m de largo; radialmente ×0,889, hasta 0,273 m.
  - La proa se identificó como el extremo sin aletas, lo que coincide con la orientación del ensamble fuente.
  - Las aletas del AGM-65 fuente son superficies de una sola cara, por eso los materiales de armas tienen doble cara.
- **Motores TF34**:

  | Dato | Valor |
  |---|---|
  | Salida | (−5,428; 0,450; ±1,219), radio 0,515 m, chorro hacia −x |
  | Toma | (−2,088; 0,450; ±1,219) |

- **Puntos de colisión (`hardpoints`)**: boca del cañón, punta y fondo de la nariz, panza delantera, media y trasera, tailBumper (−4,72; −0,91; 0), cono de cola, bases y topes de derivas, puntas de ala (−2,019; −0,288; ±8,764).
- **Referencias del ala**: S = 47,0 m², CMA = 3,04 m, b = 17,53 m. Los valores medidos van aparte, en `wing.measured`.

## Verificación (`docs/mesh/`)

| Imagen | Qué muestra |
|---|---|
| `top.png`, `side.png`, `front.png`, `three_quarter.png` | Vistas generales. Las superficies móviles están resaltadas: alerón naranja, flap azul, elevador verde, timón rosa. Las caras traseras visibles se pintan en **rojo**. |
| `pose_retracted.png` | Tren arriba, canopy 40°, flaps 40°, elevador −25°, timón +25°, alerones ±20. Sirve para verificar pivotes, ejes y signos. |
| `cockpit_eye.png` | Vista desde `eyeModel` mirando adelante (FOV 90°, sin el piloto, con las caras traseras descartadas como en FrontSide), más un lateral de la cabina con el ojo marcado. |
| `loadout.png` | Plantillas colgadas en todas las estaciones. |
| `weapons.png` | Las dos plantillas. |

Caras invertidas: comparadas con la teselación original, después de simplificar quedan < 0,2 % de los triángulos por pieza con la normal opuesta (en Body, 17 de 62 k). No hay rojo apreciable en los renders, salvo en la ranura del corte del elevador.

## Problemas y supuestos

1. **Escala**: largo −2,8 % y altura −2,5 % con la envergadura real; entre ejes −17 %; ruedas más chicas que las reales. Es geometría del modelo base y no se corrigió.
2. **CG**: es un supuesto (27 % de la CMA medida). Queda muy cerca del tren principal (ver más arriba).
3. **Desplazamiento del cañón**: 0,12 m en el modelo contra ≈ 0,3 m en el real.
4. **Riostras y brazos del tren**: no se pliegan; hay que ocultarlos.
5. **Rueda de proa retraída**: queda parcialmente fuera del fuselaje. Las puertas del tren principal no existen en el CAD.
6. **Elevador exterior**: está cortado por un plano y no tiene tapas en la ranura.
7. **Decelerones**: no están modelados, porque el alerón es de una sola hoja.
8. **Carreras de amortiguador, rangos de superficies y rango de apertura del canopy**: ESTIMADOS.
9. **Carga original del modelo base**: misiles, bombas y lanzacohetes **no** se exportan. Solo se usaron para ubicar las estaciones.
10. **`Templates`**: glTF no tiene "oculto" estándar, así que el cargador debe hacer `visible = false` cuando `userData.hidden` es verdadero.
