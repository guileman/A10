# Simulador A-10C Thunderbolt II (HTML único)

**Abrir (también desde la Quest):** https://guileman.github.io/A10/ — o descargar `a10-sim.html` y abrirlo directo en el navegador.

Simulador del A-10C sobre mapa real (satélite + relieve + OSM). Empieza en vuelo; el objetivo es un convoy (tanques, blindados y camiones) que recorre una ruta A→B. Armas: cañón GAU-8/A y AGM-65 Maverick. Física de cuerpo rígido con dos TF34 (`docs/PHYSICS_A10.md`), menús y HUD (`docs/UI.md`), malla (`docs/MESH.md`), VR por WebXR (Quest 2 / Rift S).

Mouse (por defecto): adelante/atrás = cabeceo, izq./der. = alabeo; la palanca queda donde la dejás (indicador «PALANCA» en el HUD); Q o botón central = centrar; primer clic = tomar el mouse, luego botón izq. = cañón; M activa/desactiva.

Armas: Espacio = cañón · L = bloquear · Enter = Maverick · U = desbloquear · K = aerofreno · C = cámara · P/Esc = pausa.
Repetición: tras un derribo, un impacto de Maverick o una ráfaga con impactos aparece «X = VER REPETICIÓN»; X muestra los últimos segundos desde una cámara fija en el suelo junto al blanco (con el sonido llegando con su retardo). X o Esc vuelven al vuelo.

VR: gatillo derecho = cañón · A = misil · B = bloquear.

Compilar: `npm install && npm run build` → `dist/a10-sim.html` (copiado en la raíz como `index.html` para GitHub Pages).

---
Base heredada del simulador Harrier:

# Simulador del Harrier (VTOL) — HTML único

`dist/harrier-sim.html` (≈9 MB) se abre directo en el navegador, sin servidor.

## Compilar
`npm install && npm run build` → `dist/harrier-sim.html`. `npm test` corre las 94 pruebas (física, UI, pista).
`python3 tools/extract_engine.py` regenera `vendor/rally-engine.js` desde `simulador-rally-v2-e.html`;
`python3 tools/export_glb.py` regenera `assets/harrier.glb` desde la malla del IGES (requiere los `.npz` de análisis).

## Estructura
- `src/physics` — física de vuelo (Pegasus, 4 toberas, RCS, aerodinámica, tren con brazos pivotantes). Ver `docs/PHYSICS.md` (parámetros, fuentes y qué es ESTIMADO).
- `src/ui`, `src/input`, `src/camera` — menús, HUD, mando teclado+mouse, 3 cámaras. Ver `docs/UI.md`.
- `src/world` — pista recta (a partir de dos umbrales), adaptador al mundo del rally y malla de pista con marcas.
- `src/aircraft/model.js` — GLB por partes articulado con el estado de la física.
- `vendor/rally-engine.js` — motor de mundo del rally (three r187 incluido, una sola copia).
- `docs/CONTRACT.md` — contrato entre módulos.

## Controles por defecto
↑/↓ cabeceo (↑ = proa abajo) · ←/→ alabeo · A/D pedales · W/S gases · Z/X toberas · 1/2/3 toberas 0°/55°/85° · G tren · F flaps · B frenos · V estacionamiento · K aerofreno · I agua · C cámara · T reubicar cámara de mundo · H HUD · N silenciar · M mouse-palanca · botón derecho mirar · P/Esc pausa · R reiniciar. Todo reasignable en el menú.

## Realidad virtual (WebXR, Quest 2)
Abrir el HTML en el Navegador de la Quest (mejor por HTTPS), generar el mundo y tocar **Entrar en VR** (esquina inferior derecha).
Cabina con seguimiento de cabeza, HUD en el parabrisas, sin sombras y resolución al 80 % para rendir. Mandos Touch:
- **Derecho:** stick = cabeceo/alabeo · gatillo = freno · agarre = preajuste de toberas (0→55→85°) · A/B = toberas atrás/abajo · clic del stick = aerofreno
- **Izquierdo:** stick adelante/atrás = gases, izq./der. = pedales · gatillo = freno · agarre = freno de estacionamiento · X = tren · Y = flaps · clic del stick = inyección de agua
Código: `src/xr/vr.js` (sesión, dolly, HUD, mandos) y `src/xr/mapping.js` (mapeo puro, con pruebas). No probado con un visor real.

### Modo VR: rendimiento (Quest 2)
Al entrar en VR se aplica un perfil liviano: sin sombras, sin pasto, bosque ralo, visión a 1,6 km, tren de aterrizaje oculto, terreno/vegetación actualizados cada 3 cuadros, HUD a la mitad de frecuencia y sin paneles oscuros (solo simbología verde, a 4 m). Al salir de VR se restaura la calidad elegida en el menú.

### Carga rápida en la Quest
En el Navegador de la Quest (o con `?lite` al final de la URL) el simulador usa un perfil liviano de carga: calidad baja, margen de 2 km y como máximo 30 teselas de foto sintética en vez de ~150. La generación del mundo baja a la mitad en una PC de prueba (32 s → 17 s).

### Iniciar directamente en VR
En «Volar» hay un botón **Iniciar en modo VR**: carga el mundo y, cuando termina, muestra «Mundo listo» con un botón **Entrar en VR ahora** (el navegador exige un clic para abrir la sesión). También se puede elegir «Volar sin VR».
