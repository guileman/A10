# Física del Harrier (AV-8A / GR.3, Pegasus 103) — modelos, parámetros y límites

Código: `src/physics/**` (ES modules, sin dependencias, sin DOM/three). Pruebas: `tests/physics/*.test.mjs` (`npm test`).
Convenciones: las de `docs/CONTRACT.md` (SI; mundo x=este, y=arriba, z=sur; cuerpo x=proa, y=arriba, z=derecha).
Internamente la aerodinámica usa ejes convencionales (X proa, Y derecha, Z abajo): X=x, Y=z, Z=−y; momentos L=Mx, M=Mz, N=−My.

**Leyenda de fuentes**
- [P] Princeton MAE Report 1466, *Transition and Conversion Trim-Maps for the AV-8A* (1980), DTIC ADA102155 — https://apps.dtic.mil/sti/tr/pdf/ADA102155.pdf
- [N] NASA TM-104021, Borchers et al., *Flight measurement of RCS bleed and control power, YAV-8B* (1994) — https://ntrs.nasa.gov/api/citations/19940030488/downloads/19940030488.pdf
- [M] NASA TM-81295, Merrick (1981), simulación AV-8A — https://ntrs.nasa.gov/api/citations/19810021598/downloads/19810021598.pdf
- [A] aerospaceweb.org, ficha Harrier GR.3/AV-8A — https://www.aerospaceweb.org/aircraft/attack/harrier/
- [V] airvectors.net, *Harrier* parte 2 — https://airvectors.net/avav8_2.html
- [W] Hawker Siddeley Harrier (copia de Wikipedia) — https://mirror2.polsri.ac.id/wiki/wp/h/Hawker_Siddeley_Harrier.htm
- [R] PPRuNe, hilo *Harrier transition/hover* (testimonios de pilotos, incl. J. Farley) — https://www.pprune.org/military-aviation/print-414038-harrier-transition-hover-2.html?pp=40
- [MIL] MIL-F-8785C (modelo de turbulencia Dryden, forma de baja altura) — conocimiento estándar, no consultado en línea en esta sesión.
- **ESTIMADO** = sin dato público encontrado; se da el razonamiento.

No conseguí el NATOPS del AV-8A ni Jane's: no hay acceso público en línea. Ningún valor de este documento viene de ellos.

## 1. Arquitectura e integración

`HarrierSim.step(dt)` acumula tiempo y ejecuta subpasos fijos de **480 Hz** (`params.integration.substepHz`). En cada subpaso:
1. Datos de aire (ISA + viento + Dryden) → α, β, Mach, q̄.
2. Actuadores: mandos de vuelo (varillaje + SAS + compensador), tren (extensión), motor (NF), toberas (motor neumático), RCS.
3. Fuerzas: aerodinámica, 4 toberas, inducidos por chorro, resistencia de toma, RCS, tren (con su propia masa no suspendida), puntos duros, gravedad.
4. Integración (`rigidbody.js`): Euler semi-implícito en traslación; rotación con ecuación de Euler ω̇ = I⁻¹(M − ω×Iω) evaluada en el punto medio, y cuaternión actualizado por la exponencial exacta del paso (q ← q ⊗ exp(ω̄ dt/2)), renormalizado.
5. Chequeos: pérdida, toques, choque, obstáculos (~30 Hz), límites, NaN.

La masa e inercia cambian con combustible y agua cada subpaso. El efecto giroscópico del motor es despreciable porque los carretes de baja y alta giran en sentidos opuestos [R]. Por eso no se modela.

`reset()`: `parked` coloca el avión en la actitud de tierra y simula 2,5 s de asentamiento sin contar tiempo. `hover` y `cruise` resuelven un **trim** por Newton (jacobiano numérico 3×3) sobre las fuerzas reales del modelo:
- hover: incógnitas (cabeceo, compensador, NF) con toberas fijas (83° por defecto);
- crucero: incógnitas (α = cabeceo, compensador, NF) con vuelo nivelado.

El resultado queda en `getState().trim`. La entrada debe arrancar con `trim.throttle` y `trim.nozzleDeg`.

## 2. Geometría y CG

`loadGeometry()` lee `src/physics/harrier.geometry.json`. Ese archivo está en marco CAD de terna derecha: x proa, **y izquierda**, z arriba. La conversión es **cuerpo = (x, z, −y)**. La terna se detecta por `frame`, `scaleMPerUnit` o el texto "z arriba" en `_note`. Todo campo faltante toma un default de `GEOMETRY_DEFAULTS`, que son los valores del CAD convertidos más estimados propios para toma, puntos duros y anchos de neumático. No hay posiciones fijas en el resto del código.

**CG (`cgModel`).** No conseguí un dato público de reparto estático por rueda. Sí está documentado el CG de diseño de los mapas de trim, 7,8 % CAM [P], pero no la posición de la CAM en el modelo. Por eso el CG sale de la restricción física más fuerte del VTOL: en vuelo estacionario, la resultante de las 4 toberas pasa por el CG sin necesitar RCS.
- Centroide de empuje ponderado por el reparto delantero/trasero a NF de hover: M = f·front + (1−f)·rear, con f = 0,506.
- CG = M + 0,20 m hacia arriba (ESTIMADO: el ala y la estructura quedan sobre el eje del motor), desplazado sobre la recta de empuje a 83°.
- Resultado: **cgModel = (0,069, −0,735, 0) m** en ejes cuerpo.

Consecuencias, medidas en las pruebas:
- el momento de empuje se anula a **83,5°** de toberas;
- en hover trimado el brazo equivalente es de 3 mm y el sangrado de RCS de 0,5 %;
- el **reparto estático** que resulta es **proa 48,6 %, principal 39,3 %, estabilizadores 6 % c/u**.

Esto **discrepa** de lo que cabría esperar en un tren biciclo, donde la principal suele llevar más carga. Las causas posibles son la distancia entre ejes del CAD (2,875 m) o las posiciones de toberas del CAD (centros de ductos 453/454, no salidas). Si el orquestador entrega un reparto real o un CG real, se pone `cgModel` en el JSON y la física lo usa tal cual.

**Actitud de tierra 1°** (ESTIMADO; Farley [R]: el ala está calada con el borde de ataque arriba para tener AoA en la carrera).
- La línea de suelo estática se ancla en la rueda principal del CAD.
- Con esa actitud, el eje de la rueda de proa del CAD queda **0,156 m más bajo** que la posición estática necesaria; los estabilizadores, 0,013 m.
- La física usa su propia posición estática y expone `wheelPosWorld`, `wheelTravel` y `armAngleDeg` para que el modelo 3D se anime desde el estado.

**Ancho**: las válvulas de punta de ala del JSON quedan a ±4,81 m (envergadura de 9,6 m, contra 7,70 m reales [A][W]) y los estabilizadores a ±2,475 m. Las fuerzas de RCS se calculan como momento ÷ brazo, así que la potencia de control no depende de ese error. El vuelco en rodaje sí depende de él (ver §8).

## 3. Atmósfera, viento, turbulencia (`atmosphere.js`)
- ISA: troposfera con gradiente de 6,5 K/km y tropopausa a 11 km. La presión se ancla en el **QNH**. `tempOffsetC` se suma a la temperatura ISA. ρ = p/(R T), a = √(γRT).
- Viento medio: perfil logarítmico con z0 = 0,03 m, referido a 10 m y constante desde 300 m (ESTIMADO, campo abierto). `windFromDeg` es la dirección DESDE la que sopla.
- Turbulencia Dryden [MIL], forma de baja altura:
  - σw = 0,1·W20, con W20 = turbulence·45 kt;
  - σu = σv = σw/(0,177+0,000823h)^0,4;
  - Lu = h/(0,177+0,000823h)^1,2, Lw = h (h en ft), con mezcla hasta 1750 ft por encima de 2000 ft.
  - **Limitación**: los filtros son de 1.er orden (Ornstein-Uhlenbeck exacto en tiempo discreto) en los 3 ejes. El de la componente vertical/lateral en Dryden es de 2.º orden.
  - Usa PRNG con semilla (mulberry32 + Box-Muller).

## 4. Motor Pegasus 103 (`engine.js`)

| Parámetro | Valor | Fuente |
|---|---|---|
| Empuje bruto instalado SL ISA estático vs NF | 90 %: 12 900 lbf; 94,4: 15 500; 100: 17 700; 102,7: 18 650 (short lift dry); 104,1: 19 300; 105,8: 19 600 (short lift wet) | [P] Tabla 1 |
| Empuje no instalado de catálogo | 21 500 lbf (95,6 kN) | [W][A] (referencia; la física usa la tabla instalada) |
| Debajo de 90 % | F ∝ NF³ hasta ralentí 27 % | ESTIMADO |
| Límites de régimen | seco 102,7 %, con agua 105,8 % | [P] |
| Dinámica NF | τ_acel 0,45 s, τ_desac 0,35 s, ×4 cerca de ralentí; límites 22 %/s (acel) y 30 %/s (desac) | ESTIMADO. Resultado: ralentí → 95 % del empuje en 5,0 s |
| Gasto másico máx. | 196 kg/s (≈432 lb/s), ṁ ∝ (F/Fmax)^0,6·δ/√θ·(1+0,15M²) | ESTIMADO (cifra de divulgación) |
| Empuje vs Mach | F_bruto = F0(NF/√θ)·δ·(1+0,56M+0,28M²) | ESTIMADO, calibrado para que el neto (bruto − ram drag) a nivel del mar sea ≈0,93 a M 0,45 y ≈0,9 a M 0,9 del estático (lapso típico de un turbofán de bajo bypass) |
| TSFC | 19,5 mg/(N·s) ≈ 0,69 lb/lbf/h; ×(1+0,35·(1−NF/100)) | ESTIMADO |
| Agua | 227 kg (500 lb), 2,5 kg/s; sólo con gases > 90 %; baja la JPT 70 °C y habilita 105,8 % | ESTIMADO (el límite "wet" de 1,5 min de [P] es coherente con ≈90 s) |
| JPT | JPT = T2·(1+k·(NFc/100)³) − 273, calibrada a 680 °C a 100 % ISA; limitador a 760 °C | ESTIMADO. Efecto: con ISA+20 la NF corregida cae a 99,3 % y el empuje seco máximo a 17 430 lbf |
| Reparto delantero (fan)/trasero | 0,50 a 100 %, +0,0015 por % NF debajo de 100 | "casi igual" [P]; la pendiente es ESTIMADA (a carga parcial cae más la presión de la tobera caliente) |
| Molinete sin combustible | NF → 8 + 25·M %, sin empuje | ESTIMADO |

El gobernador manda NF física. El empuje depende de la NF corregida NF/√θ2. θ2 incluye la reingestión de gases calientes (HGI), así que la HGI y el día caluroso bajan el empuje de forma física.

## 5. Toberas (`nozzles.js`)
- 4 toberas que giran juntas, de 0° (empuje hacia adelante) a **98,5°** [P][W]. Dirección del empuje en cuerpo: (cos θ, sin θ, 0). Se aplica en la posición de cada tobera del JSON.
- Las delanteras llevan f·T (aire de fan); las traseras (1−f)·T (gases calientes).
- Accionamiento: motor neumático por cadena alimentado con sangrado [V]. Es un servo de posición con velocidad máxima 90°/s·√(presión de sangrado) y aceleración 600°/s². La cifra de 90°/s es de divulgación y es **ESTIMADO**: no la encontré en fuente primaria. [M] usa 1°/s como tasa de programa de transición en simulador, que no es la velocidad del actuador.
- Tope de hover a 82° en la palanca [P]: queda sólo como dato; la palanca del contrato va hasta 98,5°.

**Resistencia de toma (ram drag)**: F = −ṁ·v_local en el labio de toma, con v_local = v_aire + ω×r. Se aplica en el labio (ESTIMADO a x = 2,9 m del origen del modelo). Así aparecen el momento de cabeceo y la inestabilidad de guiñada del Harrier con viento cruzado. Prueba: con 15 kt de viento de costado, 2,0 kN y −5,8 kN·m, que llevan la proa a sotavento. Es consistente con la modelización por ram drag y brazos de toma de [P] y con la discusión de momentos de guiñada de toma de [N].

## 6. RCS — controles de reacción (`rcs.js`) y lógica real

**Lógica real del Harrier de 1.ª generación** ([V], [P], [N]):
- Las válvulas están unidas **mecánicamente a las superficies de control** (y por lo tanto a palanca, pedales, compensador y autoestabilizador). La de cola (guiñada) y las de punta de ala (alabeo) están "esclavizadas" a timón y alerones [V].
- **Cabeceo**: válvula de proa, que sopla hacia abajo y levanta la proa, más válvula de cola, que sopla hacia abajo y baja la proa. Ambas están unidas al estabilizador.
- **Alabeo**: válvulas de punta de ala con salida arriba y abajo.
- **Guiñada**: salidas laterales en la válvula de cola. El Harrier tiene guiñada por RCS [V].
- El aire es sangrado del compresor de alta. Una válvula de corte lo habilita según el ángulo de toberas: 0 a 0°, ≈50 % a 10°, pleno desde 20° [P][V].
- El momento de cabeceo máximo cae al usar alabeo o guiñada a la vez [P], porque comparten el sangrado.

**Modelo**
- Demanda de cada eje = deflexión de superficie normalizada (incluye compensador y SAS).
- F_válvula = F_máx·demanda·fase(θ)·pr(NF), con pr = ((NF−25)/75)^1,6 (ESTIMADO) y lag de 60 ms.
- Gasto por válvula = |F|/v_jet, con v_jet = 750 m/s (">2700 km/h" [V]).
- Si el gasto total supera el disponible (8,35 kg/s·pr, de [N]: 9,2 lbm/s = 50 % del disponible), todas las válvulas se escalan juntas.
- **Penalización**: −800 N de empuje principal por kg/s sangrado (ESTIMADO; el aire de alta presión deja de expandirse en la turbina).
- F_máx = (aceleración angular de diseño × inercia) / brazo según la geometría:
  - cabeceo 0,45 rad/s², alabeo 1,3 rad/s², guiñada 0,35 rad/s² (ESTIMADO, por encima de los picos medidos en hover del YAV-8B [N]: 0,26 / 0,56 / 0,15, y 1,23 rad/s² en alabeo durante traslación lateral);
  - fuerzas resultantes: proa 3,27 kN, cola 2,82 kN, guiñada 2,44 kN, puntas 1,01 kN c/u (con brazo de ±4,81 m).
  - Con todo a la vez la demanda (≈12,8 kg/s) supera el disponible, que es lo que [P] describe.

Prueba con 50 % de palanca en hover y SAS en cero:
- alabeo: 0,55 rad/s², sangrado 15 %, −1,0 kN de empuje;
- cabeceo: 0,16 rad/s²;
- guiñada: 0,12 rad/s².

## 7. Aerodinámica (`aero.js`)

| Parámetro | Valor | Fuente |
|---|---|---|
| S, b, CAM | 18,68 m², 7,70 m, 2,57 m (8,43 ft) | [P][A][W] |
| Flecha ¼ cuerda | 34° | ESTIMADO (divulgación) |
| CLα | DATCOM (Helmbold-Diederich + Prandtl-Glauert): 3,23 /rad a M 0, 3,75 a M 0,8; cae 35 % entre M 0,92 y 1,1 | calculado |
| CL0 / CD0 / e | 0,10 / 0,025 / 0,78 | ESTIMADO |
| Pérdida | α_s = 17° (buffet 16–18° [P]), −2° con flaps 50°, menor con Mach; mezcla sigmoide (ancho 1,2°) hacia placa plana 1,05·sin2α; caída de ala aleatoria con semilla (ΔCl 0,035) | ESTIMADO salvo el rango de buffet |
| Onda | ΔCD = 18(M−0,80)⁴ | ESTIMADO (Vmax SL M 0,97 [A]) |
| Margen estático | 0,10 CAM, crece en transónico | ESTIMADO |
| Cmq, Cmα̇, Cmδs, CLδs | −8, −3, −1,55, 0,45 /rad | ESTIMADO (volumen de cola ≈0,5) |
| Lateral | CYβ −0,9; Clβ −0,08 (anhedro); Cnβ 0,10; Clp −0,30; Cnr −0,25; Clδa 0,085; Cnδr 0,065 /rad | ESTIMADO |
| Flaps | 0 / 25 / 50°; ΔCL 0,42, ΔCD 0,055, ΔCm −0,05 a 50° | 50° despegue y aterrizaje, 0° crucero [P]; posición intermedia de 25° ESTIMADA |
| Aerofreno | máx. 66°, 25° con tren abajo, ΔCm −0,02 | [P]; ΔCD 0,035 ESTIMADO |
| Tren | ΔCD 0,022 (+0,010 en tránsito) | ESTIMADO |
| Estabilizador | +11,25° borde de fuga abajo (tope delantero) [P]; −13° (ESTIMADO) | |
| Efecto suelo aero | Wieselsberger φ = (16h/b)²/(1+(16h/b)²) sobre resistencia inducida; +12 %(1−φ) en CLα | clásico |

**Inducidos por chorro (`ground.js`)**, como fracción del empuje vertical:
- ΔL/T = −0,015 − 0,08·V/(V+40) − 0,055(De/h)^1,6 + 0,03·e^(−h/De), con De = 1,2 m;
- los términos de suelo se desvanecen con e^(−V/18);
- [P] confirma la pérdida de sustentación por interacción chorro-ala al aumentar δj y Vj/V, pero da sólo gráficos. Todos los coeficientes son ESTIMADOS. Con el avión apoyado da ≈ −3,7 %.

**Reingestión (HGI)**: ΔT2 = 25 K·e^(−h/8)·f(viento de proa), activa con toberas > 55°. ESTIMADO.

Resultados medidos:
- CLmax limpio 0,86 a α ≈ 15° (evento de pérdida a 16,6°); CL cae a 0,72 pasada la pérdida.
- Trim a 420 kt: NF 67 %, α 0,95°.
- Transición hover → 307 KIAS sin pérdida de altura.

## 8. Tren de aterrizaje (`gear.js`)

**Unidades**: proa (1 neumático, direccionable), principal (2 neumáticos sobre un eje, una pata), estabilizadores izquierdo y derecho (rueda loca o castor).

**Cinemática de brazo pivotante** (plano x-y del cuerpo):
- Pivote P y brazo L; el eje de la rueda está en A(α) = P − L(cos α, sin α).
- Coordenada generalizada: recorrido vertical del eje u (0 = extendido).
- El amortiguador va del anclaje superior Q (`attach` del JSON) a un perno en el 60 % del brazo.
- Carrera s(u) = l(0) − l(u). **Ventaja mecánica MA(u) = ds/du**, tabulada (49 puntos) y variable con el ángulo.
- Fuerza vertical en la rueda = F_amortiguador·MA.
- Si el anclaje supuesto diera MA < 0,2, se reubica (no ocurrió con el JSON actual).

**Oleoneumático**:
- Gas: F_gas = A[p0(V0/(V0−A s))^n − p_atm], con n = 1,1.
- Diseño por unidad: carga estática exacta en la pose estática; p_estática = 8 MPa; razón p_máx/p_estática = 3 (estabilizadores 8, más progresivos).
- Hidráulica: F_h = c_q ṡ|ṡ| (rebote ×2,5) más un término lineal (ζ = 0,35). c_q se dimensiona para 1·F_estática a 3,66 m/s (12 ft/s, sink típico de diseño VL, ESTIMADO).
- Topes de extensión y de fondo.

| Unidad | Recorrido de eje | Estático | L brazo | MA estática | Carrera de amortiguador | Área de pistón | p0 |
|---|---|---|---|---|---|---|---|
| proa | 0,30 m | 70 % | 0,42 m | 0,553 | 0,162 m | 89 cm² | 3,1 MPa |
| principal | 0,45 m | 72 % | 0,55 m | 0,618 | 0,296 m | 64 cm² | 2,6 MPa |
| estabilizador | 0,25 m | 50 % | 0,45 m | 0,619 | 0,155 m | 9,8 cm² | 4,0 MPa |

No encontré datos públicos de carreras, presiones ni tamaños de neumático: **todo ESTIMADO**. Los radios de rueda (0,334 m y 0,226 m) vienen del CAD.

**Masa no suspendida** (40 / 110 / 20 kg) con 1 GDL. Integración semi-implícita: la amortiguación entra implícita. Se ignoran la gravedad y las fuerzas de inercia del marco sobre esa masa. En caída libre las dos se cancelan exactamente; el error real es el de las aceleraciones de rotación, que es pequeño.

**Neumático**:
- Radial: k = 0,7 / 1,0 / 0,3 MN/m, con amortiguación y tope de llanta (×10 k pasada la deflexión máxima).
- Deslizamiento: longitudinal κ = (ωr − v)/max(|v|, 3) con rigidez 12·N; lateral atan(v_lat/max(|v|, 3)) con rigidez 8·N (castor 0,06·N).
- Combinado por elipse con saturación tanh a μN.
- μ por superficie SURF, seco/mojado interpolado con `surfaceWetness`, y rodadura (`SURFACE_TABLE`, valores típicos de ingeniería, ESTIMADO).
- Giro de rueda con inercia, integración implícita linealizada.
- Freno de Coulomb sólo en la principal: 9 kN·m por neumático (ESTIMADO).
- Anti-deslizamiento proporcional: objetivo de deslizamiento 12 %.

**Dirección de proa**:
- ±30° hasta 2 m/s, bajando a ±6° a 12 m/s, a 60°/s (ESTIMADO; no encontré la autoridad real).
- Estabilizadores con castor: Farley y otros pilotos mencionan su "flopping" y shimmy [R].

**Recogida y extensión**:
- 7 s / 6 s (ESTIMADO), con resistencia extra en tránsito.
- No sube con peso en ruedas.
- Si hay contacto con el tren en tránsito, se registra un choque.
- Límite de velocidad con tren abajo: 250 kt (ESTIMADO).

**Contacto de estructura**: puntos duros (punta de nariz, panza, cola, puntas de ala) más las 4 salidas de tobera, que se mueven con θ. Penalización resorte-amortiguador con fricción 0,5. Choque si la velocidad normal de impacto supera 3 m/s, o con agua a más de 25 m/s. Tocar el tren con sink > 5,5 m/s también es choque (colapso); entre 3,7 y 5,5 m/s se registra aterrizaje duro. Obstáculos: cilindros consultados a 30 Hz.

**Resultados medidos**:
- Suma de cargas estáticas / peso = 0,999.
- Caída de 0,3 m: carrera máxima 91 %, sin daño. Caída de 2,5 m: colapso.
- Frenado de 15 m/s a 0 en 72 m (1,8 m/s²; sólo la principal frena y lleva el 39 % del peso).
- **Vuelco lateral**: el avión se vuelca hacia ≈0,2 g de aceleración lateral sostenida, que es poco. Se debe a un CG cargado a proa más trocha estrecha del CAD (±2,475 m). Por eso la autoridad de la dirección de proa se reduce con la velocidad. Revisar cuando haya trocha y CG reales.

## 9. Mandos de vuelo (`flightcontrols.js`)
- Varillaje mecánico de ganancia constante. No hay programa de superficies con la velocidad porque el GR.3 no lo tenía; la sensación artificial no afecta a la física.
- Servos a 60°/s.
- Autoestabilizador (SAS) en los 3 ejes con autoridad del 15 % del recorrido. Mueve las superficies y, por el varillaje, también las válvulas RCS. `assist.stabilityAug` 0..1, donde 0,5 es el nominal: ganancia ×2·valor. Ganancias ESTIMADAS.
- Compensador de cabeceo de −8° a +6° a 1°/s (mueve también las válvulas de cabeceo; así se trima el hover).
- `assist.hoverDamping` (NO real): retención de actitud y amortiguación en vuelo lento (toberas > 20°, < 45 m/s). Opera dentro de la misma autoridad de superficies y RCS.
- `assist.autoTrim` (NO real, por defecto 0).

## 10. Resultados de las pruebas (esta máquina, `npm test`)

| Prueba | Resultado |
|---|---|
| Hover, 7011 kg (1150 kg de combustible) | NF 95,2 %, T 69,8 kN; T_vert/W = 1,015 (compensa ΔL_chorro −1,56 %); actitud +7,1°; deriva en 10 s: 0,15 m horizontal, +0,31 m vertical (por combustible quemado) |
| Hover, 8156 kg (tanques llenos + agua) | requiere NF 102,1 % (límite seco 102,7 %) |
| Balance de momento de toberas | de +14 kN·m a 0° (empuje 20 cm debajo del CG) a −3,7 kN·m a 98,5°; cero en 83,5°; siempre dentro de la autoridad RCS a partir de 20° |
| STO, 8148 kg (toberas 10°, a 70 kt toberas a 50°, flaps 25°) | despegue a **104 m**, 79 KIAS, 8,1 s |
| CTO (toberas 0°) | 374 m, 159 KIAS |
| VTO con 50 % de combustible | sube; VL con toque a 1,3 m/s |
| Transición hover → 307 KIAS | altura mínima 29,6 m sobre 30 m iniciales |
| Pérdida | evento a α 16,6°, CLmax 0,86 |
| Determinismo con semilla y turbulencia | idéntico bit a bit; otra semilla da otro resultado |
| Conservación sin fuerzas (ω ≈ 1,5 rad/s, 20 s a 480 Hz) | \|ΔL\|/\|L\| = 3,4·10⁻⁴; ΔE/E = 3,6·10⁻⁷ |
| 10 min con entradas aleatorias | sin NaN (los choques por las entradas aleatorias son esperables) |
| **Rendimiento** (Node 22, 480 Hz, 8 subpasos por cuadro) | **0,03–0,06 ms de CPU por cuadro de 1/60 s** (suelo 0,061; hover bajo 0,042; crucero 0,029). Primera medición sin calentamiento de JIT: 0,18 ms |

## 11. Limitaciones conocidas
- Casi toda la aerodinámica, las inercias (Ixx 7 500, Iyy 45 000, Izz 50 000, Ixz 1 500 kg·m² a 7,9 t; estimadas por distribución de masas y comparadas con otro caza) y el tren son **ESTIMADOS**. No hay tablas públicas del AV-8A en formato numérico: [P] sólo tiene gráficos.
- El CG se infiere del equilibrio de hover y no de un dato de peso y balance.
- Sin efecto suelo sobre los momentos (sólo sustentación inducida) y sin momento de cabeceo inducido por chorro en transición.
- Turbulencia de 1.er orden por eje.
- No se modela empuje inverso por toberas a 98,5° más allá de la geometría (la componente hacia atrás sí sale de cos 98,5°), ni el VIFF como sistema aparte (sale solo de la geometría).
- Sin modelo de ingestión de agua o FOD, sin daño progresivo (sólo eventos y choque) y sin hidroplaneo.
