// Pista de asfalto con marcas (umbrales, designadores, zona de toma, punto de mira, eje, bordes) sobre el terreno nivelado.
import { Group, Mesh, BufferGeometry, BufferAttribute, MeshLambertMaterial, CanvasTexture, RepeatWrapping, ClampToEdgeWrapping, SRGBColorSpace, LinearMipmapLinearFilter, LinearFilter } from 'three';

const PPM = 8;           // píxeles por metro en las texturas
const LIFT = 0.05;       // m sobre el terreno
const END_LEN = 330;     // largo (m) de la zona de marcas de cada cabecera

function asphaltBase(ctx, w, h, seed) {
  ctx.fillStyle = '#3a3c3f'; ctx.fillRect(0, 0, w, h);
  let s = seed >>> 0; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * 16; d[i] += n; d[i + 1] += n; d[i + 2] += n * 1.05; }
  ctx.putImageData(img, 0, 0);
}
function tex(canvas, repeatAlong) {
  const t = new CanvasTexture(canvas); t.flipY = false; t.colorSpace = SRGBColorSpace;
  t.wrapS = repeatAlong ? RepeatWrapping : ClampToEdgeWrapping; t.wrapT = ClampToEdgeWrapping;
  t.generateMipmaps = true; t.minFilter = LinearMipmapLinearFilter; t.magFilter = LinearFilter; t.anisotropy = 16; return t;
}
function edgeLines(ctx, W, h) {
  ctx.fillStyle = '#e8e8e4';
  const lw = Math.max(2, 0.45 * PPM), off = 0.9 * PPM;
  ctx.fillRect(0, off, h, lw); ctx.fillRect(0, W - off - lw, h, lw);
}
/** Textura repetitiva del tramo central: bordes + eje discontinuo (30 m / 20 m). Eje largo = x del canvas. */
function midCanvas(widthM) {
  const along = 50 * PPM, across = Math.round(widthM * PPM);
  const c = document.createElement('canvas'); c.width = along; c.height = across; const ctx = c.getContext('2d');
  asphaltBase(ctx, along, across, 7);
  ctx.fillStyle = '#e8e8e4'; const lw = Math.max(2, 0.45 * PPM), off = 0.9 * PPM;
  ctx.fillRect(0, off, along, lw); ctx.fillRect(0, across - off - lw, along, lw);
  ctx.fillRect(0, across / 2 - 0.45 * PPM, 30 * PPM, 0.9 * PPM);
  return c;
}
/** Cabecera (x = distancia desde el umbral, y = a lo ancho de izq. a der. vista desde la aproximación). */
function endCanvas(widthM, designator) {
  const L = END_LEN * PPM, W = Math.round(widthM * PPM);
  const c = document.createElement('canvas'); c.width = L; c.height = W; const ctx = c.getContext('2d');
  asphaltBase(ctx, L, W, 11);
  ctx.fillStyle = '#e8e8e4';
  const m = (v) => v * PPM;
  // bordes
  ctx.fillRect(0, m(0.9), L, m(0.45)); ctx.fillRect(0, W - m(1.35), L, m(0.45));
  // umbral: barras longitudinales de 30 m × 1,8 m, simétricas, a 6 m del extremo
  const half = Math.max(2, Math.min(8, Math.floor((widthM - 8) / 3.6 / 2)));
  for (let i = 0; i < half; i++) {
    const off = m(1.8) + i * m(3.6);
    ctx.fillRect(m(6), W / 2 - off - m(1.8), m(30), m(1.8)); ctx.fillRect(m(6), W / 2 + off, m(30), m(1.8));
  }
  // designador (texto en eje: arriba del texto hacia +x, lectura de izq. a der. para quien se aproxima)
  ctx.save(); ctx.translate(m(48), W / 2); ctx.rotate(Math.PI / 2);
  ctx.font = `bold ${m(9)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(designator, 0, 0); ctx.restore();
  // eje discontinuo desde 90 m
  for (let x = 90; x < END_LEN; x += 50) ctx.fillRect(m(x), W / 2 - m(0.45), m(30), m(0.9));
  // marcas de zona de toma: pares de barras 22,5 m × 3 m a 150, 300 (punto de mira, más gruesas), 450 m (solo se ve hasta END_LEN)
  const pair = (x, len, wd, lat) => { ctx.fillRect(m(x), W / 2 - m(lat) - m(wd), m(len), m(wd)); ctx.fillRect(m(x), W / 2 + m(lat), m(len), m(wd)); };
  pair(150, 22.5, 1.8, 9); pair(150, 22.5, 1.8, 13.5);
  pair(300, 45, 6, 9);
  return c;
}
function stripGeometry(world, p1, ux, uz, s0, s1, widthM, uRep, step = 6) {
  const nx = Math.max(1, Math.ceil((s1 - s0) / step)), ny = 4;
  const rx = -uz, rz = ux, hw = widthM / 2, pos = [], uv = [], idx = [];
  for (let i = 0; i <= nx; i++) {
    const s = s0 + (s1 - s0) * i / nx;
    for (let j = 0; j <= ny; j++) {
      const t = j / ny, o = (t - 0.5) * widthM, x = p1[0] + ux * s + rx * o, z = p1[1] + uz * s + rz * o;
      pos.push(x, world.height(x, z) + LIFT, z); uv.push(((s - s0) / (s1 - s0)) * uRep, t);
    }
  }
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const a = i * (ny + 1) + j, b = a + 1, c = a + ny + 1, d = c + 1; idx.push(a, b, c, b, d, c);
  }
  const g = new BufferGeometry(); g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3)); g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx); g.computeVertexNormals(); return g;
}
const mat = (map) => new MeshLambertMaterial({ map, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });

export function buildRunwayMesh(world, rf, { widthM = 45, designatorA = '05', designatorB = '23' } = {}) {
  const grp = new Group(); grp.name = 'runway';
  const L = rf.length, p1 = rf.thr1, ux = rf.ux, uz = rf.uz;
  const endL = Math.min(END_LEN, L / 2 - 1);
  const e1 = endL === END_LEN ? endCanvas(widthM, designatorA) : null;
  if (e1) {
    // cabecera 1: sentido de avance = +u
    grp.add(new Mesh(stripGeometry(world, p1, ux, uz, 0, END_LEN, widthM, 1), mat(tex(e1, false))));
    // cabecera 2: textura recorrida hacia atrás: u'=−u, partiendo de thr2; el lado derecho también se invierte
    const p2 = rf.thr2;
    grp.add(new Mesh(stripGeometry(world, p2, -ux, -uz, 0, END_LEN, widthM, 1), mat(tex(endCanvas(widthM, designatorB), false))));
    // tramo central repetitivo
    const mid = tex(midCanvas(widthM), true);
    grp.add(new Mesh(stripGeometry(world, p1, ux, uz, END_LEN, L - END_LEN, widthM, (L - 2 * END_LEN) / 50), mat(mid)));
  } else {
    const mid = tex(midCanvas(widthM), true);
    grp.add(new Mesh(stripGeometry(world, p1, ux, uz, 0, L, widthM, L / 50), mat(mid)));
  }
  grp.traverse((o) => { if (o.isMesh) { o.receiveShadow = true; o.renderOrder = 1; o.frustumCulled = false; } });
  return grp;
}
