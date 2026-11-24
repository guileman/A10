// HUD de ataque estilo A-10C en canvas 2D (verde), con unidades de aviación (kt, ft, °, hPa; combustible en kg).
// Lee el esquema getState() del contrato §3.2 (+ n1Pct [l,r], buffet/stall del A-10) y, opcionalmente, `extra` de ataque:
//   hud.update(state, controls, dt, extra)
//   extra = { gun:{ammo,firing,spin}, missiles:{left,locked,lockProgress}, ccip:{x,y}|null, targets:[{x,y,dist,type,locked,alive}],
//             range:m|null, message:string, weapon?:'gun'|'agm65' }   (x,y normalizadas de pantalla −1..1: x derecha, y arriba)
// Tolera campos faltantes y valores no finitos. Sin `extra` no dibuja nada de armas.
import { M_TO_FT, MS_TO_KT, MS_TO_FPM, clamp, finite } from './units.js';

const FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
const D2R = Math.PI / 180;
const OUT = 'rgba(0,10,5,0.9)';
const AMBER = '#ffb000', RED = '#ff4a3d', WHITE = '#e9fff2';
const COLORS = { verde: '#46ff9c', ambar: '#ffc24a' };

export const HUD_MODES = ['pilot', 'chase', 'world', 'weapon'];

export function defaultHudOptions() {
  return {
    scale: 1,                // multiplicador del usuario sobre la escala automática
    color: 'verde',
    vfovDeg: 70,             // campo de visión vertical de la cámara de piloto (escalera de cabeceo conforme)
    gunCapacity: 1150,       // cartuchos del GAU-8/A (fracción de la barra de munición)
    inRangeM: 4000,          // «IN RNG»: blanco bloqueado/más cercano a menos de esta distancia
    shootRangeM: 2500,       // «SHOOT»: pipper sobre un blanco a menos de esta distancia
    pipperCaptureFrac: 0.035, // radio (fracción de la altura de pantalla) en que el pipper «cae sobre» un blanco
    noPanels: false,         // VR: sin paneles oscuros, solo simbología
  };
}

const num = (v, d = 0) => finite(v, d);
const f0 = (v) => String(Math.round(v));
const f1 = (v) => v.toFixed(1);
const pad = (n, w) => String(Math.abs(Math.round(n))).padStart(w, '0');
const MAX_TARGETS = 64;

// Nombre de avisos -> severidad y texto
const WARN = {
  STALL: { sev: 2, txt: 'STALL' }, OVERTEMP: { sev: 2, txt: 'OVERTEMP' }, OVERSPEED: { sev: 2, txt: 'OVERSPEED' },
  PULLUP: { sev: 2, txt: 'PULL UP' }, 'PULL UP': { sev: 2, txt: 'PULL UP' }, ENGINE: { sev: 2, txt: 'MOTOR' }, FIRE: { sev: 2, txt: 'FUEGO' },
  GEAR: { sev: 1, txt: 'GEAR' }, BINGO: { sev: 1, txt: 'BINGO' }, GLIMIT: { sev: 1, txt: 'G LIMIT' }, 'G LIMIT': { sev: 1, txt: 'G LIMIT' },
  FLAPS: { sev: 1, txt: 'FLAPS' }, LOWFUEL: { sev: 1, txt: 'COMB BAJO' }, BUFFET: { sev: 1, txt: 'BUFFET' },
};

export function createHud({ canvas, ctx: injectedCtx = null, options = null } = {}) {
  const ctx = injectedCtx || (canvas && canvas.getContext ? canvas.getContext('2d') : null);
  const opt = { ...defaultHudOptions(), ...(options || {}) };
  const P = (c) => (opt.noPanels ? 'rgba(0,12,6,0)' : c);   // VR: sin paneles oscuros, solo simbología
  const S = {
    mode: 'pilot', visible: true, W: 1280, H: 720, dpr: 1, u: 1, time: 0, fuelCap: 0, qnhHpa: null,
    lastFuel: 0, errors: 0,
  };
  let col = COLORS[opt.color] || COLORS.verde;

  const resize = (w, h, dpr) => {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
    const cw = w || (rect && rect.width) || canvas.clientWidth || 1280;
    const ch = h || (rect && rect.height) || canvas.clientHeight || 720;
    const d = dpr || (typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1) || 1;
    S.W = Math.max(320, cw); S.H = Math.max(240, ch); S.dpr = clamp(d, 1, 3);
    canvas.width = Math.round(S.W * S.dpr); canvas.height = Math.round(S.H * S.dpr);
  };

  // ---------- primitivas ----------
  const text = (s, x, y, size, color, align = 'center', bold = false) => {
    ctx.font = (bold ? '700 ' : '') + size + 'px ' + FONT;
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(2.5, size * 0.24); ctx.strokeStyle = OUT; ctx.lineJoin = 'round';
    ctx.strokeText(s, x, y);
    ctx.fillStyle = color; ctx.fillText(s, x, y);
  };
  const line2 = (build, color, w) => {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    build(); ctx.lineWidth = w + 2.4; ctx.strokeStyle = OUT; ctx.stroke();
    build(); ctx.lineWidth = w; ctx.strokeStyle = color; ctx.stroke();
  };
  const seg = (x1, y1, x2, y2) => () => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); };
  const box = (x, y, w, h, color, fill = P('rgba(0,12,6,0.82)')) => {
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.fillStyle = fill; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = color; ctx.stroke();
  };
  const bar = (x, y, w, h, frac, color) => {
    frac = clamp(frac, 0, 1);
    ctx.fillStyle = P('rgba(0,12,6,0.6)'); ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color; ctx.fillRect(x, y, w * frac, h);
    ctx.lineWidth = 1.2; ctx.strokeStyle = col; ctx.strokeRect(x, y, w, h);
  };
  const dot = (x, y, r, fill, stroke) => {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    ctx.lineWidth = 1.5; ctx.strokeStyle = stroke || col; ctx.stroke();
  };

  // ---------- datos ----------
  const D = {};
  const X = { has: false, ammo: 0, firing: false, spin: 0, missiles: 0, locked: false, lockP: 0, ccip: null, targets: [], nT: 0, range: null, msg: '', weapon: 'gun' };
  const n1of = (s) => {
    const a = s && s.n1Pct;
    if (Array.isArray(a)) return [clamp(num(a[0]), 0, 130), clamp(num(a[1], num(a[0])), 0, 130)];
    const r = clamp(num(s && s.engine && s.engine.rpmPct), 0, 130);
    return [r, r];
  };
  const extract = (s, c) => {
    const air = s.air || {}, eng = s.engine || {}, att = s.att || {}, gear = s.gear || {}, flags = s.flags || {}, cs = s.controlSurfaces || {};
    // todo valor se acota: los bucles de las cintas dependen de rangos finitos y razonables
    D.pitch = clamp(num(att.pitchDeg), -90, 90); D.roll = num(att.rollDeg) % 360; D.hdg = ((num(att.headingDeg) % 360) + 360) % 360;
    D.ias = clamp(num(air.iasKt), 0, 3000); D.mach = clamp(num(air.machNo), 0, 20); D.aoa = clamp(num(air.aoaDeg), -180, 180); D.beta = clamp(num(air.betaDeg), -180, 180);
    D.nz = clamp(num(air.nz, 1), -50, 50); D.gs = clamp(num(air.gs) * MS_TO_KT, -3000, 3000);
    D.alt = clamp(num(air.altMslM) * M_TO_FT, -2000, 300000);
    D.hasAgl = typeof air.altAglM === 'number' && Number.isFinite(air.altAglM);
    D.agl = clamp(num(air.altAglM) * M_TO_FT, -2000, 1e7);
    D.vs = clamp(num(air.vsMs) * MS_TO_FPM, -1e5, 1e5);
    D.n1 = n1of(s); D.fuel = clamp(num(eng.fuelKg), 0, 1e6); D.flow = clamp(num(eng.fuelFlowKgS) * 60, -1e4, 1e4);
    D.engStall = !!eng.stall;
    D.gearState = gear.state === 'down' || gear.state === 'transit' || gear.state === 'up' ? gear.state : 'up';
    D.flapsIdx = c && [0, 1, 2].includes(c.flaps) ? c.flaps : 0;
    D.flapsDeg = clamp(num(cs.flapsDeg), -360, 360);
    const sbDeg = clamp(num(cs.speedbrakeDeg, num(cs.airbrakeDeg)), -360, 360);
    D.speedbrake = !!(c && (c.speedbrake > 0.5 || c.airbrake === true)) || sbDeg > 1;
    D.brake = clamp(num(c && c.brake), 0, 1); D.parking = !!(c && c.parkingBrake);
    D.flags = flags;
    D.warn = Array.isArray(s.warnings) ? s.warnings : [];
    D.stall = !!(s.stall || flags.stalled || D.warn.includes('STALL'));
    const bf = s.buffet; D.buffet = bf === true ? 1 : clamp(num(bf), 0, 1);
    D.vel = Array.isArray(s.vel) ? s.vel : null; D.quat = Array.isArray(s.quat) ? s.quat : null;
    if (D.fuel > S.fuelCap) S.fuelCap = D.fuel;
  };
  const extractExtra = (e) => {
    X.has = !!e && typeof e === 'object';
    X.nT = 0; X.ccip = null; X.range = null; X.msg = '';
    if (!X.has) return;
    const g = e.gun || {}, m = e.missiles || {};
    X.ammo = clamp(num(g.ammo), 0, 1e5); X.firing = !!g.firing; X.spin = clamp(num(g.spin), 0, 1);
    X.missiles = clamp(Math.round(num(m.left)), 0, 99); X.locked = !!m.locked; X.lockP = clamp(num(m.lockProgress), 0, 1);
    X.weapon = e.weapon === 'agm65' || e.weapon === 'gun' ? e.weapon : (X.locked || X.lockP > 0 ? 'agm65' : 'gun');
    const c = e.ccip;
    if (c && Number.isFinite(c.x) && Number.isFinite(c.y)) X.ccip = { x: clamp(c.x, -3, 3), y: clamp(c.y, -3, 3) };
    if (typeof e.range === 'number' && Number.isFinite(e.range) && e.range >= 0) X.range = e.range;
    if (typeof e.message === 'string') X.msg = e.message.slice(0, 80);
    const ts = Array.isArray(e.targets) ? e.targets : [];
    for (let i = 0; i < ts.length && X.nT < MAX_TARGETS; i++) {
      const t = ts[i];
      if (!t || t.alive === false || !Number.isFinite(t.x) || !Number.isFinite(t.y)) continue;   // detrás de la cámara (null) o destruido
      let o = X.targets[X.nT]; if (!o) o = X.targets[X.nT] = {};
      o.x = clamp(t.x, -3, 3); o.y = clamp(t.y, -3, 3); o.dist = Number.isFinite(t.dist) && t.dist >= 0 ? t.dist : null; o.locked = !!t.locked;
      o.type = typeof t.type === 'string' ? t.type.slice(0, 12) : '';
      X.nT++;
    }
  };

  // ---------- elementos ----------
  const drawPitchLadder = (cx, cy, u) => {
    const ppd = S.H / clamp(opt.vfovDeg, 20, 120);
    ctx.save();
    ctx.beginPath(); ctx.rect(cx - 330 * u, cy - 190 * u, 660 * u, 360 * u); ctx.clip();
    ctx.translate(cx, cy); ctx.rotate(-D.roll * D2R);
    const half = 195 * u / ppd;
    const p0 = Math.floor((D.pitch - half) / 5) * 5, p1 = Math.ceil((D.pitch + half) / 5) * 5;
    for (let p = Math.max(-90, p0); p <= Math.min(90, p1); p += 5) {
      const y = (D.pitch - p) * ppd;
      if (p === 0) {
        line2(seg(-300 * u, y, -60 * u, y), col, 2 * u); line2(seg(60 * u, y, 300 * u, y), col, 2 * u);
        continue;
      }
      const major = p % 10 === 0, w = (major ? 60 : 28) * u, gap = 24 * u;
      const dn = p < 0;
      ctx.setLineDash(dn ? [6 * u, 5 * u] : []);
      line2(seg(-gap - w, y, -gap, y), col, 1.6 * u); line2(seg(gap, y, gap + w, y), col, 1.6 * u);
      ctx.setLineDash([]);
      if (major) {
        const tick = (p > 0 ? 7 : -7) * u;
        line2(seg(-gap - w, y, -gap - w, y + tick), col, 1.6 * u); line2(seg(gap + w, y, gap + w, y + tick), col, 1.6 * u);
        text(String(Math.abs(p)), -gap - w - 16 * u, y, 12 * u, col, 'center');
        text(String(Math.abs(p)), gap + w + 16 * u, y, 12 * u, col, 'center');
      }
    }
    ctx.restore();
    // escala de alabeo (arco superior fijo, puntero móvil)
    const R = 175 * u;
    ctx.save(); ctx.translate(cx, cy);
    for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
      const t = a * D2R, l = (a % 30 === 0 || a === 45 ? 12 : 7) * u;
      line2(seg(Math.sin(t) * R, -Math.cos(t) * R, Math.sin(t) * (R - l), -Math.cos(t) * (R - l)), col, 1.4 * u);
    }
    ctx.rotate(-D.roll * D2R);
    ctx.beginPath(); ctx.moveTo(0, -R + 2 * u); ctx.lineTo(-7 * u, -R + 15 * u); ctx.lineTo(7 * u, -R + 15 * u); ctx.closePath();
    ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = OUT; ctx.stroke();
    ctx.restore();
  };

  const drawAircraftSymbol = (cx, cy, u) => {
    line2(() => { ctx.beginPath(); ctx.moveTo(cx - 40 * u, cy); ctx.lineTo(cx - 14 * u, cy); ctx.lineTo(cx - 8 * u, cy + 9 * u); ctx.lineTo(cx, cy); ctx.lineTo(cx + 8 * u, cy + 9 * u); ctx.lineTo(cx + 14 * u, cy); ctx.lineTo(cx + 40 * u, cy); }, WHITE, 2.2 * u);
  };

  // vector velocidad (marcador de trayectoria) respecto del morro
  const drawFlightPath = (cx, cy, u) => {
    if (!D.vel || !D.quat) return;
    const [vx, vy, vz] = D.vel.map((v) => num(v)), [qx, qy, qz, qw] = D.quat.map((v) => num(v));
    const sp = Math.hypot(vx, vy, vz);
    if (sp < 3) return;
    // v_cuerpo = q^-1 * v (rotación con el cuaternión conjugado)
    const cqx = -qx, cqy = -qy, cqz = -qz;
    const ux = 2 * (cqy * vz - cqz * vy), uy = 2 * (cqz * vx - cqx * vz), uz = 2 * (cqx * vy - cqy * vx);
    const rx = vx + qw * ux + (cqy * uz - cqz * uy), ry = vy + qw * uy + (cqz * ux - cqx * uz), rz = vz + qw * uz + (cqx * uy - cqy * ux);
    if (rx < 0.2 * sp) return; // velocidad hacia atrás: sin marcador
    const ppd = S.H / clamp(opt.vfovDeg, 20, 120);
    const dxDeg = Math.atan2(rz, rx) / D2R, dyDeg = Math.atan2(ry, rx) / D2R;
    // se ubica relativo al símbolo de aeronave, rotado por el alabeo no (referido al cuerpo)
    const x = cx + clamp(dxDeg * ppd, -150 * u, 150 * u), y = cy - clamp(dyDeg * ppd, -150 * u, 150 * u);
    ctx.lineWidth = 2 * u;
    line2(() => { ctx.beginPath(); ctx.arc(x, y, 7 * u, 0, Math.PI * 2); }, col, 1.8 * u);
    line2(seg(x - 7 * u, y, x - 17 * u, y), col, 1.8 * u); line2(seg(x + 7 * u, y, x + 17 * u, y), col, 1.8 * u); line2(seg(x, y - 7 * u, x, y - 15 * u), col, 1.8 * u);
  };

  const drawHeadingTape = (cx, y, u) => {
    const w = 380 * u, ppd = 5.2 * u, h = 26 * u;
    ctx.save(); ctx.beginPath(); ctx.rect(cx - w / 2, y - 4 * u, w, h + 28 * u); ctx.clip();
    const half = w / 2 / ppd;
    for (let a = Math.floor((D.hdg - half) / 5) * 5; a <= D.hdg + half; a += 5) {
      const x = cx + (a - D.hdg) * ppd, aa = ((a % 360) + 360) % 360, major = aa % 10 === 0;
      line2(seg(x, y + h - (major ? 12 : 6) * u, x, y + h), col, 1.4 * u);
      if (aa % 30 === 0) {
        const card = { 0: 'N', 90: 'E', 180: 'S', 270: 'O' }[aa];
        text(card || pad(aa / 10 || 36, 2), x, y + h - 22 * u + 8 * u, (card ? 15 : 12) * u, card ? WHITE : col, 'center', !!card);
      }
    }
    ctx.restore();
    const bw = 54 * u;
    box(cx - bw / 2, y - 26 * u, bw, 22 * u, col);
    text(pad(D.hdg, 3) + '°', cx, y - 15 * u, 16 * u, col, 'center', true);
    line2(() => { ctx.beginPath(); ctx.moveTo(cx - 5 * u, y + h + 8 * u); ctx.lineTo(cx, y + h + 1 * u); ctx.lineTo(cx + 5 * u, y + h + 8 * u); }, WHITE, 1.8 * u);
  };

  // cinta vertical genérica; side = 1: números a la izquierda de la marca (cinta a la derecha), -1 al revés
  const tape = (x, cy, h, value, ppu, step, labelEvery, side, u, minV) => {
    ctx.save(); ctx.beginPath(); ctx.rect(x - 70 * u, cy - h / 2, 140 * u, h); ctx.clip();
    const half = h / 2 / ppu;
    for (let v = Math.ceil((value - half) / step) * step; v <= value + half; v += step) {
      if (minV !== undefined && v < minV) continue;
      const y = cy - (v - value) * ppu, major = Math.round(v / step) % labelEvery === 0;
      line2(seg(x, y, x + side * (major ? 12 : 6) * u, y), col, 1.4 * u);
      if (major) text(f0(v), x + side * 16 * u, y, 13 * u, col, side > 0 ? 'left' : 'right');
    }
    ctx.restore();
    line2(seg(x, cy - h / 2, x, cy + h / 2), col, 1.4 * u);
  };

  const drawSpeedAlt = (cx, cy, u) => {
    const h = 250 * u;
    // IAS a la izquierda
    const xs = cx - 270 * u;
    tape(xs, cy, h, D.ias, 2.2 * u, 5, 2, -1, u, 0);
    box(xs - 66 * u, cy - 12 * u, 52 * u, 24 * u, col);
    text(f0(D.ias), xs - 40 * u, cy, 17 * u, col, 'center', true);
    text('KIAS', xs - 40 * u, cy - h / 2 - 12 * u, 11 * u, col, 'center');
    text('M ' + D.mach.toFixed(2), xs - 40 * u, cy + h / 2 + 14 * u, 13 * u, col, 'center');
    text('G ' + f1(D.nz), xs - 40 * u, cy + h / 2 + 30 * u, 13 * u, D.nz > 6 || D.nz < -1 ? AMBER : col, 'center', true);
    // altitud a la derecha
    const xa = cx + 270 * u;
    tape(xa, cy, h, D.alt, 0.4 * u, 50, 2, 1, u);
    box(xa + 14 * u, cy - 12 * u, 76 * u, 24 * u, col);
    text(f0(D.alt), xa + 52 * u, cy, 17 * u, col, 'center', true);
    text('BARO ft', xa + 52 * u, cy - h / 2 - 12 * u, 11 * u, col, 'center');
    if (D.hasAgl && D.agl < 5000) {   // altímetro de radar (AGL)
      const a = D.agl < 500 ? Math.round(D.agl) : Math.round(D.agl / 10) * 10;
      const low = D.agl < 200;
      text('RAD ' + a, xa + 52 * u, cy + h / 2 + 14 * u, 15 * u, low ? AMBER : col, 'center', true);
    } else text('RAD ---', xa + 52 * u, cy + h / 2 + 14 * u, 13 * u, col, 'center');
    if (S.qnhHpa) text('QNH ' + f0(S.qnhHpa), xa + 52 * u, cy + h / 2 + 30 * u, 12 * u, col, 'center');
    // variómetro
    const xv = xa + 120 * u, hv = h * 0.9, top = cy - hv / 2;
    line2(seg(xv, top, xv, top + hv), col, 1.4 * u);
    for (let v = -2000; v <= 2000; v += 500) {
      const y = cy - (v / 2000) * (hv / 2), m = v % 1000 === 0;
      line2(seg(xv, y, xv + (m ? 11 : 6) * u, y), col, 1.4 * u);
      if (m) text(String(Math.abs(v / 1000)), xv + 22 * u, y, 11 * u, col, 'left');
    }
    const vy = cy - (clamp(D.vs, -2000, 2000) / 2000) * (hv / 2);
    ctx.beginPath(); ctx.moveTo(xv, vy); ctx.lineTo(xv - 12 * u, vy - 6 * u); ctx.lineTo(xv - 12 * u, vy + 6 * u); ctx.closePath();
    ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = OUT; ctx.stroke();
    text('VS fpm', xv, top - 12 * u, 11 * u, col, 'center');
    text(f0(Math.round(D.vs / 50) * 50), xv, top + hv + 14 * u, 13 * u, Math.abs(D.vs) > 2000 ? AMBER : col, 'center', true);
  };

  const drawAeroReadouts = (cx, cy, u) => {
    const x = cx - 270 * u - 200 * u;
    const rows = [['AoA', f1(D.aoa) + '°', Math.abs(D.aoa) > 14 ? AMBER : col], ['GS kt', f0(D.gs), col], ['β', f1(D.beta) + '°', col]];
    rows.forEach((r, i) => {
      text(r[0], x, cy - 30 * u + i * 20 * u, 12 * u, col, 'left');
      text(r[1], x + 98 * u, cy - 30 * u + i * 20 * u, 15 * u, r[2], 'right', true);
    });
  };


  const drawEnginePanel = (x, y, u) => {
    const w = 150 * u, bh = 10 * u;
    const lab = ['N1 IZQ', 'N1 DER'];
    D.n1.forEach((v, i) => {
      const yy = y + i * 28 * u, c = D.engStall ? RED : v > 100 ? AMBER : col;
      text(lab[i], x, yy, 12 * u, col, 'left'); text(f1(v) + '%', x + w, yy, 14 * u, c, 'right', true);
      bar(x, yy + 10 * u, w, bh, v / 105, c);
    });
    const bingo = D.warn.includes('BINGO') || D.warn.includes('LOWFUEL');
    const fc = bingo ? AMBER : col, cap = S.fuelCap > 1 ? S.fuelCap : Math.max(D.fuel, 1);
    text('COMB', x, y + 66 * u, 12 * u, col, 'left'); text(f0(D.fuel) + ' kg', x + w, y + 66 * u, 14 * u, fc, 'right', true);
    bar(x, y + 76 * u, w, bh, D.fuel / cap, fc);
    text(f1(D.flow) + ' kg/min', x, y + 98 * u, 11 * u, col, 'left');
  };

  const drawSystems = (x, y, u) => {
    // x,y = esquina superior derecha del bloque, alineado a la derecha
    const lights = ['N', 'I', 'D'];
    const gcol = D.gearState === 'down' ? '#2dff80' : D.gearState === 'transit' ? RED : 'rgba(0,0,0,0.55)';
    text('TREN', x - 150 * u, y, 12 * u, col, 'left');
    lights.forEach((l, i) => {
      const cx = x - 90 * u + i * 26 * u;
      dot(cx, y, 9 * u, gcol, col);
      text(l, cx, y, 10 * u, D.gearState === 'up' ? col : '#00140a', 'center', true);
    });
    text(D.gearState === 'down' ? 'ABAJO' : D.gearState === 'transit' ? 'EN TRÁNSITO' : 'ARRIBA', x, y + 22 * u, 11 * u, D.gearState === 'transit' ? RED : col, 'right');
    const flapTxt = ['UP', 'MVR', 'DN'][D.flapsIdx];
    text('FLAPS', x - 150 * u, y + 46 * u, 12 * u, col, 'left');
    text(flapTxt + ' ' + f0(D.flapsDeg) + '°', x, y + 46 * u, 14 * u, col, 'right', true);
    text('SPD BRK', x - 150 * u, y + 70 * u, 12 * u, col, 'left');
    text(D.speedbrake ? 'ABIERTO' : 'CERRADO', x, y + 70 * u, 14 * u, D.speedbrake ? AMBER : col, 'right', true);
    const br = [];
    if (D.parking) br.push('PARK');
    if (D.brake > 0.02) br.push('FRENO ' + f0(D.brake * 100) + '%');
    text(br.length ? br.join('  ') : ' ', x, y + 90 * u, 11 * u, AMBER, 'right', true);
    if (D.flags.weightOnWheels || D.flags.onGround) text('EN TIERRA', x, y + 106 * u, 11 * u, col, 'right');
  };

  // ---------- simbología de ataque ----------
  const px = (nx, ny) => [S.W / 2 + nx * S.W / 2, S.H / 2 - ny * S.H / 2];
  const onScreen = (x, y, m) => x > -m && x < S.W + m && y > -m && y < S.H + m;

  // distancia relevante al blanco: bloqueado (range), o el bloqueado visible, o el más cercano vivo
  const targetDist = () => {
    if (X.range !== null) return X.range;
    let best = null;
    for (let i = 0; i < X.nT; i++) { const t = X.targets[i]; if (t.dist !== null && (t.locked || best === null || t.dist < best)) { best = t.dist; if (t.locked) return best; } }
    return best;
  };

  const drawTargets = (u) => {
    for (let i = 0; i < X.nT; i++) {
      const t = X.targets[i], [x, y] = px(t.x, t.y);
      if (!onScreen(x, y, 40)) continue;
      if (t.locked) {
        const r = 17 * u;      // diamante: blanco bloqueado
        line2(() => { ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); }, AMBER, 2.4 * u);
        if (t.dist !== null) text((t.dist / 1000).toFixed(1) + ' km', x, y + r + 12 * u, 12 * u, AMBER, 'center', true);
        if (t.type) text(t.type, x, y - r - 10 * u, 11 * u, AMBER, 'center');
      } else {
        const r = 8 * u;       // recuadro: blanco visible
        line2(() => { ctx.beginPath(); ctx.rect(x - r, y - r, 2 * r, 2 * r); }, col, 1.6 * u);
      }
    }
  };

  const drawPipper = (u) => {
    if (!X.ccip) return;
    const [x, y] = px(X.ccip.x, X.ccip.y);
    if (!onScreen(x, y, 60)) return;
    const R = 24 * u;
    line2(() => { ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); }, col, 2 * u);
    dot(x, y, 2.6 * u, col, OUT);
    // anillo de distancia: arco horario desde las 12 proporcional a range / shootRange
    const rg = X.range !== null ? X.range : targetDist();
    if (rg !== null) {
      const f = clamp(rg / (opt.inRangeM * 1.25), 0, 1), a0 = -Math.PI / 2;
      line2(() => { ctx.beginPath(); ctx.arc(x, y, R + 7 * u, a0, a0 + f * Math.PI * 2); }, rg < opt.shootRangeM ? AMBER : col, 3 * u);
    }
    for (const a of [0, 90, 180, 270]) {   // marcas cardinales
      const t = a * D2R, s = Math.sin(t), c = Math.cos(t);
      line2(seg(x + s * R, y - c * R, x + s * (R + 5 * u), y - c * (R + 5 * u)), col, 1.4 * u);
    }
  };

  const drawAttack = (cx, cy, u) => {
    drawTargets(u);
    drawPipper(u);
    // aviso IN RNG / SHOOT
    const rg = targetDist();
    if (rg !== null && rg < opt.inRangeM) text('IN RNG', cx, cy - 150 * u, 18 * u, col, 'center', true);
    if (X.ccip && opt.shootRangeM > 0) {
      const [x, y] = px(X.ccip.x, X.ccip.y), cap = opt.pipperCaptureFrac * S.H;
      let shoot = false;
      for (let i = 0; i < X.nT && !shoot; i++) {
        const t = X.targets[i];
        if (t.dist === null || t.dist >= opt.shootRangeM) continue;
        const [tx, ty] = px(t.x, t.y);
        if (Math.hypot(tx - x, ty - y) <= cap) shoot = true;
      }
      if (shoot && Math.floor(S.time * 4) % 2 === 0) text('SHOOT', x, y + 46 * u, 20 * u, AMBER, 'center', true);
    }
    // adquisición del Maverick
    if (X.weapon === 'agm65' && !X.locked && X.lockP > 0) {
      const r = (46 - 28 * X.lockP) * u;
      line2(() => { ctx.beginPath(); ctx.rect(cx - r, cy - r, 2 * r, 2 * r); }, AMBER, 1.8 * u);
      text('LOCK ' + f0(X.lockP * 100) + '%', cx, cy - 122 * u, 12 * u, AMBER, 'center');
    } else if (X.locked) text('LOCK', cx, cy - 122 * u, 14 * u, AMBER, 'center', true);
    if (X.msg) text(X.msg, cx, cy + 118 * u, 16 * u, WHITE, 'center', true);
  };

  const drawWeaponPanel = (cx, y, u) => {
    const agm = X.weapon === 'agm65';
    text('ARMA', cx - 100 * u, y, 12 * u, col, 'left');
    text(agm ? 'AGM-65' : 'GUN', cx + 100 * u, y, 16 * u, X.firing ? AMBER : col, 'right', true);
    text('CART', cx - 100 * u, y + 24 * u, 12 * u, col, 'left');
    const low = X.ammo < opt.gunCapacity * 0.1;
    text(f0(X.ammo), cx + 100 * u, y + 24 * u, 16 * u, low ? AMBER : col, 'right', true);
    bar(cx - 100 * u, y + 36 * u, 200 * u, 8 * u, X.ammo / Math.max(1, opt.gunCapacity), low ? AMBER : col);
    if (X.spin > 0.02 && X.spin < 0.98) text('GIRANDO ' + f0(X.spin * 100) + '%', cx, y + 56 * u, 10 * u, AMBER, 'center');
    text('AGM-65', cx - 100 * u, y + 70 * u, 12 * u, col, 'left');
    text(String(X.missiles), cx + 100 * u, y + 70 * u, 16 * u, X.missiles === 0 ? AMBER : col, 'right', true);
  };

  const drawSlip = (cx, y, u) => {
    const w = 90 * u;
    ctx.beginPath(); ctx.rect(cx - w / 2, y - 6 * u, w, 12 * u); ctx.fillStyle = P('rgba(0,12,6,0.4)'); ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.stroke();
    line2(seg(cx - 6 * u, y - 6 * u, cx - 6 * u, y + 6 * u), col, 1 * u); line2(seg(cx + 6 * u, y - 6 * u, cx + 6 * u, y + 6 * u), col, 1 * u);
    dot(cx + clamp(D.beta / 10, -1, 1) * (w / 2 - 6 * u), y, 4.5 * u, col, OUT);
  };


  const drawWarnings = (cx, y, u) => {
    const list = [];
    const seen = {};
    for (const w of D.warn) {
      const k = String(w).toUpperCase();
      if (seen[k]) continue; seen[k] = 1;
      const m = WARN[k];
      list.push({ txt: m ? m.txt : k.slice(0, 14), sev: m ? m.sev : 1 });
    }
    if (D.stall && !seen.STALL) list.push({ txt: 'STALL', sev: 2 });
    if (D.buffet > 0.25 && !D.stall && !seen.BUFFET) list.push({ txt: 'BUFFET', sev: 1 });
    if (D.flags.crashed) list.unshift({ txt: 'ACCIDENTE  -  R PARA REINICIAR', sev: 2 });
    if (D.engStall) list.push({ txt: 'PÉRDIDA DE COMPRESOR', sev: 2 });
    list.sort((a, b) => b.sev - a.sev);
    const blinkOn = Math.floor(S.time * 2.5) % 2 === 0;
    list.slice(0, 5).forEach((w, i) => {
      const color = w.sev === 2 ? RED : AMBER;
      if (w.sev === 2 && !blinkOn && !D.flags.crashed) return;
      text(w.txt, cx, y + i * 28 * u, (w.sev === 2 ? 22 : 18) * u, color, 'center', true);
    });
  };

  const drawReduced = (u) => {
    const W = S.W, H = S.H, bw = Math.min(W - 24, 880 * u), x0 = (W - bw) / 2, h = 62 * u, y0 = H - h - 12 * u;
    ctx.fillStyle = P('rgba(0,10,5,0.55)'); ctx.fillRect(x0, y0, bw, h);
    ctx.lineWidth = 1.2; ctx.strokeStyle = col; ctx.strokeRect(x0, y0, bw, h);
    const n1 = (D.n1[0] + D.n1[1]) / 2;
    const cells = [
      ['KIAS', f0(D.ias)], ['BARO ft', f0(D.alt)], ['RAD ft', D.hasAgl ? f0(D.agl) : '--'], ['RUMBO', pad(D.hdg, 3) + '°'],
      ['VS fpm', f0(Math.round(D.vs / 50) * 50)], ['N1', f0(n1) + '%'], ['G', f1(D.nz)],
    ];
    if (X.has) cells.push(['CART', f0(X.ammo)], ['AGM', String(X.missiles)]);
    const cw = (bw - 150 * u) / cells.length;
    cells.forEach((c, i) => {
      const cx = x0 + 10 * u + cw * (i + 0.5);
      text(c[0], cx, y0 + 15 * u, 10 * u, col, 'center');
      text(c[1], cx, y0 + 40 * u, 19 * u, col, 'center', true);
    });
    const gx = x0 + bw - 130 * u;
    const gcol = D.gearState === 'down' ? '#2dff80' : D.gearState === 'transit' ? RED : 'rgba(0,0,0,0.55)';
    for (let i = 0; i < 3; i++) dot(gx + i * 16 * u, y0 + 16 * u, 5 * u, gcol, col);
    const cap = S.fuelCap > 1 ? S.fuelCap : Math.max(D.fuel, 1);
    bar(gx - 4 * u, y0 + 32 * u, 70 * u, 8 * u, D.fuel / cap, D.warn.includes('BINGO') ? AMBER : col);
    text('COMB ' + f0(D.fuel), gx - 4 * u, y0 + 51 * u, 10 * u, col, 'left');
    drawWarnings(W / 2, 54 * u, u);
    if (X.has) drawAttack(W / 2, H / 2, u);
  };

  const drawFull = (u) => {
    const W = S.W, H = S.H, cx = W / 2, cy = H * 0.5;   // centro de pantalla: escalera conforme con la vista de cabina
    drawPitchLadder(cx, cy, u);
    drawFlightPath(cx, cy, u);
    drawAircraftSymbol(cx, cy, u);
    drawHeadingTape(cx, 14 * u + 26 * u, u);
    drawSpeedAlt(cx, cy, u);
    drawAeroReadouts(cx, cy, u);
    drawSlip(cx, cy + 178 * u, u);
    drawWarnings(cx, 108 * u, u);
    if (X.has) drawAttack(cx, cy, u);
    // bloque inferior
    const by = H - 150 * u;
    drawEnginePanel(24 * u, by, u);
    if (X.has) drawWeaponPanel(cx, by + 6 * u, u);
    drawSystems(W - 24 * u, by + 12 * u, u);
  };

  const api = {
    canvas, resize,
    get mode() { return S.mode; },
    get visible() { return S.visible; },
    options: opt,
    setMode(m) { if (HUD_MODES.includes(m)) S.mode = m; },
    setVisible(v) { S.visible = !!v; if (!S.visible) api.clear(); },
    toggle() { api.setVisible(!S.visible); return S.visible; },
    setOptions(p) {
      Object.assign(opt, p || {});
      col = COLORS[opt.color] || COLORS.verde;
    },
    setEnvironment(e) { if (e && Number.isFinite(e.qnhHpa)) S.qnhHpa = e.qnhHpa; },
    /** Al (re)iniciar vuelo: olvida la capacidad de combustible observada. */
    reset(fuelKg) { S.fuelCap = Number.isFinite(fuelKg) ? fuelKg : 0; },
    clear() { if (ctx) { ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0); ctx.clearRect(0, 0, S.W, S.H); } },
    /** extra (opcional): { gun, missiles, ccip, targets, range, message, weapon } — ver cabecera del archivo. */
    update(state, controls, dt, extra) {
      if (!ctx) return;
      S.time += num(dt, 0.016);
      ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
      ctx.clearRect(0, 0, S.W, S.H);
      if (!S.visible || !state) return;
      const u = clamp(Math.min(S.W / 1280, S.H / 720), 0.6, 2.4) * clamp(opt.scale, 0.5, 2);
      ctx.save();
      try {
        extract(state, controls);
        extractExtra(extra);
        if (S.mode === 'pilot') drawFull(u); else drawReduced(u);
      } catch (e) {
        // el HUD nunca debe tumbar el bucle principal
        S.errors++;
        if (S.errors < 3 && typeof console !== 'undefined') console.warn('[hud]', e);
      } finally { ctx.restore(); }
    },
    get errors() { return S.errors; },
  };
  return api;
}
