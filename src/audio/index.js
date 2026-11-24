// Sonido sintetizado en tiempo real (Web Audio) ligado a la física: turbofanes TF34, cañón GAU-8, misiles, explosiones, tren, tren, viento y avisos.
// Sin archivos externos. Cámara de cabina = amortiguado; cámara de mundo = distancia + efecto Doppler.
const SOUND_C = 340;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
/** Suavizado exponencial independiente de dt. */
const sm = (cur, target, dt, tau) => cur + (target - cur) * (1 - Math.exp(-dt / tau));

export function createAudio({ AudioContextClass } = {}) {
  const AC = AudioContextClass !== undefined ? AudioContextClass : (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext));
  const api = { supported: !!AC, volume: 0.7, muted: false, ctx: null };
  if (!AC) { Object.assign(api, { gun() {}, event() {}, impacts() {}, crack() {}, soundSpeed: () => SOUND_C, resume() {}, update() {}, setVolume() {}, setMuted() {}, toggleMute() { return false; }, stop() {}, reset() {} }); return api; }

  let ctx = null, g = null, running = false;
  const smooth = { rpm: 0, thr: 0, wind: 0, roll: 0, rcs: 0, down: 0, skid: 0, gearMotor: 0, dop: 1, dist: 0 };
  const prev = { gearState: 'down', contacts: {}, crashed: false, vy: 0, warn: '' };
  let warnClock = 0;

  function noiseBuffer(c, seconds = 3) {
    const n = Math.floor(c.sampleRate * seconds), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, last = 0; // ruido rosado (Paul Kellet) + marrón mezclados
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; last = d[i];
    }
    // empalme cíclico sin clic
    const f = Math.floor(n * 0.01); for (let i = 0; i < f; i++) { const t = i / f; d[n - f + i] = lerp(d[n - f + i], d[i], t); }
    return buf;
  }
  /** 1 s de disparos a 65/s con fluctuación: cada disparo = chasquido (ruido, ~4 ms) + golpe grave (~60 Hz, ~14 ms). */
  function gunPulseBuffer(c) {
    const sr = c.sampleRate, n = sr, buf = c.createBuffer(1, n, sr), d = buf.getChannelData(0);
    const shots = 65; let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let k = 0; k < shots; k++) {
      const t0 = Math.floor((k + (rnd() - 0.5) * 0.12) / shots * n), amp = 0.8 + rnd() * 0.25, f = 55 + rnd() * 14;
      for (let i = 0; i < sr * 0.03; i++) {
        const j = (t0 + i + n) % n, tt = i / sr;
        const crack = (rnd() * 2 - 1) * Math.exp(-tt / 0.0035) * 0.9;
        const thump = Math.sin(2 * Math.PI * f * tt) * Math.exp(-tt / 0.014) * 1.1;
        d[j] += amp * (crack + thump);
      }
    }
    let m = 0; for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(d[i])); for (let i = 0; i < n; i++) d[i] /= m || 1;
    return buf;
  }
  function softClip(k) { const n = 1024, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); } return c; }
  function noiseSrc(c, buf) { const s = c.createBufferSource(); s.buffer = buf; s.loop = true; s.loopStart = 0; s.loopEnd = buf.duration; s.start(); return s; }
  function chain(c, src, nodes, gain0 = 0) { let n = src; for (const x of nodes) { n.connect(x); n = x; } const gn = c.createGain(); gn.gain.value = gain0; n.connect(gn); return gn; }
  function biquad(c, type, f, q = 0.7) { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }

  const N = {}; // nodos
  function build() {
    ctx = new AC(); api.ctx = ctx;
    const buf = noiseBuffer(ctx);
    g = ctx.createGain(); g.gain.value = 0;
    N.cabin = biquad(ctx, 'lowpass', 18000, 0.5);                       // filtro global: cabina / distancia
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -10; comp.ratio.value = 2.5; comp.attack.value = 0.005; comp.release.value = 0.2;
    g.connect(N.cabin); N.cabin.connect(comp); comp.connect(ctx.destination);
    api.analyser = ctx.createAnalyser(); api.analyser.fftSize = 2048; comp.connect(api.analyser);
    const bus = ctx.createGain(); bus.gain.value = 1; bus.connect(g); N.bus = bus;
    N.noiseSrcs = [];
    const ns = () => { const s = noiseSrc(ctx, buf); s.playbackRate.value = 1; N.noiseSrcs.push(s); return s; };

    // --- turbofán: rugido (ruido pasabajos que sube con el empuje), grave de fondo, silbido del fan
    N.roarLP = biquad(ctx, 'lowpass', 600, 0.6); N.roarG = chain(ctx, ns(), [N.roarLP, biquad(ctx, 'highpass', 60)], 0); N.roarG.connect(bus);
    N.rumbleLP = biquad(ctx, 'lowpass', 140, 0.9); N.rumbleG = chain(ctx, ns(), [N.rumbleLP], 0); N.rumbleG.connect(bus);
    N.hissBP = biquad(ctx, 'bandpass', 3500, 0.8); N.hissG = chain(ctx, ns(), [N.hissBP], 0); N.hissG.connect(bus);
    N.fan = []; N.fanG = ctx.createGain(); N.fanG.gain.value = 0; N.fanG.connect(bus);
    for (const [type, mult, gain] of [['sawtooth', 1, 0.05], ['triangle', 2.01, 0.04], ['sine', 3.02, 0.03]]) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = 200; const og = ctx.createGain(); og.gain.value = gain;
      const bp = biquad(ctx, 'lowpass', 4500, 0.5); o.connect(og); og.connect(bp); bp.connect(N.fanG); o.start(); N.fan.push({ o, mult });
    }
    // --- chorro vertical (toberas abajo / efecto suelo): grave turbulento
    N.downLP = biquad(ctx, 'lowpass', 260, 1.1); N.downG = chain(ctx, ns(), [N.downLP], 0); N.downG.connect(bus);
    // --- viento
    N.windBP = biquad(ctx, 'bandpass', 500, 0.5); N.windG = chain(ctx, ns(), [N.windBP], 0); N.windG.connect(bus);
    // --- rodadura y chirrido
    N.rollLP = biquad(ctx, 'lowpass', 380, 0.7); N.rollG = chain(ctx, ns(), [N.rollLP], 0); N.rollG.connect(bus);
    N.skid = ctx.createOscillator(); N.skid.type = 'sawtooth'; N.skid.frequency.value = 820; N.skidBP = biquad(ctx, 'bandpass', 1500, 4);
    N.skidG = ctx.createGain(); N.skidG.gain.value = 0; N.skid.connect(N.skidBP); N.skidBP.connect(N.skidG); N.skidG.connect(bus); N.skid.start();
    // --- RCS: siseo agudo
    N.rcsHP = biquad(ctx, 'highpass', 2500, 0.7); N.rcsG = chain(ctx, ns(), [N.rcsHP, biquad(ctx, 'lowpass', 9000)], 0); N.rcsG.connect(bus);
    // --- servo del tren
    N.servo = ctx.createOscillator(); N.servo.type = 'sawtooth'; N.servo.frequency.value = 95; N.servoLP = biquad(ctx, 'lowpass', 420, 1);
    N.servoG = ctx.createGain(); N.servoG.gain.value = 0; N.servo.connect(N.servoLP); N.servoLP.connect(N.servoG); N.servoG.connect(bus); N.servo.start();
    // --- avisos (no pasan por el filtro de distancia/cabina: van a la salida)
    N.warn = ctx.createOscillator(); N.warn.type = 'square'; N.warn.frequency.value = 880; N.warnG = ctx.createGain(); N.warnG.gain.value = 0;
    const wl = biquad(ctx, 'lowpass', 2500, 0.5); N.warn.connect(wl); wl.connect(N.warnG); N.warnG.connect(comp); N.warn.start();
    // --- TF34: silbido agudo característico del A-10 (fan de alto bypass)
    N.whine = ctx.createOscillator(); N.whine.type = 'sine'; N.whine.frequency.value = 2000;
    N.whine2 = ctx.createOscillator(); N.whine2.type = 'triangle'; N.whine2.frequency.value = 3000;
    N.whineG = ctx.createGain(); N.whineG.gain.value = 0;
    const wbp = biquad(ctx, 'bandpass', 3000, 1.5); N.whine.connect(wbp); N.whine2.connect(wbp); wbp.connect(N.whineG); N.whineG.connect(bus); N.whine.start(); N.whine2.start();
    // --- GAU-8/A: tren de pulsos real (65 disparos/s), cada disparo = chasquido + golpe grave. Distorsión suave para el "desgarro".
    N.gunBuf = gunPulseBuffer(ctx);
    N.gunSrc = ctx.createBufferSource(); N.gunSrc.buffer = N.gunBuf; N.gunSrc.loop = true; N.gunSrc.start();
    N.gunShape = ctx.createWaveShaper(); N.gunShape.curve = softClip(3.2); N.gunShape.oversample = '2x';
    N.gunLP = biquad(ctx, 'lowpass', 5000, 0.8); N.gunHS = biquad(ctx, 'lowshelf', 120, 0.7); N.gunHS.gain.value = 9;
    N.gunG = ctx.createGain(); N.gunG.gain.value = 0;
    N.gunSrc.connect(N.gunShape); N.gunShape.connect(N.gunHS); N.gunHS.connect(N.gunLP); N.gunLP.connect(N.gunG); N.gunG.connect(bus);
    // ráfaga de ruido (gases de la boca) modulada por el mismo tren de pulsos
    N.gunNoiseBP = biquad(ctx, 'bandpass', 700, 0.5); N.gunNG = chain(ctx, ns(), [N.gunNoiseBP], 0); N.gunNG.connect(bus);
    // vibración estructural (solo en cabina): sub-graves 32,5 y 65 Hz que se sienten más que se oyen
    N.gunSub = ctx.createOscillator(); N.gunSub.type = 'sine'; N.gunSub.frequency.value = 32.5;
    N.gunSub2 = ctx.createOscillator(); N.gunSub2.type = 'triangle'; N.gunSub2.frequency.value = 65;
    N.gunSubG = ctx.createGain(); N.gunSubG.gain.value = 0;
    const s2 = ctx.createGain(); s2.gain.value = 0.6; N.gunSub.connect(N.gunSubG); N.gunSub2.connect(s2); s2.connect(N.gunSubG);
    N.gunSubG.connect(bus); N.gunSub.start(); N.gunSub2.start();
    // traqueteo metálico de la cabina (paneles, capota): ruido agudo resonante
    N.rattleBP = biquad(ctx, 'bandpass', 2300, 3); N.rattleG = chain(ctx, ns(), [N.rattleBP], 0); N.rattleG.connect(bus);
    // giro de los 7 cañones (motores hidráulicos)
    N.spin = ctx.createOscillator(); N.spin.type = 'sawtooth'; N.spin.frequency.value = 80; N.spinLP = biquad(ctx, 'bandpass', 900, 2);
    N.spinG = ctx.createGain(); N.spinG.gain.value = 0; N.spin.connect(N.spinLP); N.spinLP.connect(N.spinG); N.spinG.connect(bus); N.spin.start();
    N.buf = buf;
  }

  /** Disparo único: ruido filtrado con envolvente. */
  function burst({ dur = 0.3, f = 200, q = 0.7, gain = 0.6, type = 'lowpass', attack = 0.003, tone = 0, when = 0 }) {
    if (!ctx || !running) return;
    const t = Math.max(ctx.currentTime, when || 0), s = ctx.createBufferSource(); s.buffer = N.buf; s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const flt = biquad(ctx, type, f, q), env = ctx.createGain();
    env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(gain, t + attack); env.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(flt); flt.connect(env); env.connect(N.bus); s.start(t, Math.random() * 1.5, dur + 0.05);
    if (tone) { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(tone, t); o.frequency.exponentialRampToValueAtTime(tone * 0.4, t + dur); const og = ctx.createGain(); og.gain.setValueAtTime(gain * 0.6, t); og.gain.exponentialRampToValueAtTime(0.001, t + dur); o.connect(og); og.connect(N.bus); o.start(t); o.stop(t + dur + 0.05); }
  }

  api.resume = () => {
    if (!ctx) build();
    if (ctx.state === 'suspended') ctx.resume();
    running = true; applyMaster();
  };
  function applyMaster() { if (!g) return; const v = api.muted ? 0 : api.volume; g.gain.setTargetAtTime(v * v * 1.0, ctx.currentTime, 0.05); }
  api.setVolume = (v) => { api.volume = clamp(+v || 0, 0, 1); applyMaster(); };
  api.setMuted = (m) => { api.muted = !!m; applyMaster(); };
  api.toggleMute = () => { api.setMuted(!api.muted); return api.muted; };
  api.reset = () => { Object.keys(smooth).forEach((k) => { smooth[k] = k === 'dop' ? 1 : 0; }); prev.contacts = {}; prev.crashed = false; prev.gearState = 'down'; prev.warn = ''; };
  api.stop = () => { running = false; if (g) g.gain.setTargetAtTime(0, ctx.currentTime, 0.05); if (ctx && ctx.state === 'running') ctx.suspend(); };

  /**
   * state: getState() · view: { mode:'pilot'|'chase'|'world', camPos:[x,y,z] } (mundo) · dt en s
   */
  api.update = (state, controls, dt, view = {}) => {
    if (!ctx || !running || !state) return;
    dt = clamp(dt || 0.016, 0.001, 0.2);
    const t = ctx.currentTime, e = state.engine || {}, nz = state.nozzles || {}, air = state.air || {}, fl = state.flags || {};
    const rpm = clamp((e.rpmPct || 0) / 100, 0, 1.1);
    const thrustRef = 90000, thr = clamp((e.thrustN || 0) / thrustRef, 0, 1.2);
    smooth.rpm = sm(smooth.rpm, rpm, dt, 0.35); smooth.thr = sm(smooth.thr, thr, dt, 0.25);

    // geometría del oyente (solo cámara de mundo): distancia y Doppler
    let dist = 0, dop = 1;
    const mode = view.mode || 'chase';
    if (mode === 'world' && view.camPos) {
      const dx = view.camPos[0] - state.pos[0], dy = view.camPos[1] - state.pos[1], dz = view.camPos[2] - state.pos[2];
      dist = Math.hypot(dx, dy, dz) || 1;
      const vr = (state.vel[0] * dx + state.vel[1] * dy + state.vel[2] * dz) / dist; // velocidad de la fuente hacia el oyente
      dop = clamp(SOUND_C / (SOUND_C - clamp(vr, -240, 240)), 0.7, 1.6);
    }
    smooth.dop = sm(smooth.dop, dop, dt, 0.12); smooth.dist = sm(smooth.dist, dist, dt, 0.2);
    const d = smooth.dop;

    // atenuación por modo
    let bus = 1, cabinHz = 18000;
    if (mode === 'pilot') { bus = 0.75; cabinHz = 2600; }
    else if (mode === 'world') { bus = 1 / (1 + smooth.dist / 120); cabinHz = clamp(16000 / (1 + smooth.dist / 500), 1200, 16000); }
    N.bus.gain.setTargetAtTime(bus, t, 0.08); N.cabin.frequency.setTargetAtTime(cabinHz, t, 0.1);
    const cabinFan = mode === 'pilot' ? 0.6 : 1;
    for (const s of N.noiseSrcs) s.playbackRate.setTargetAtTime(d, t, 0.05);

    // turbofán
    const idle = 0.12;
    const run = e.stall ? 0.4 : 1;
    N.roarG.gain.setTargetAtTime((idle + smooth.thr * 0.85) * 0.55 * run * (smooth.rpm > 0.05 ? 1 : 0), t, 0.05);
    N.roarLP.frequency.setTargetAtTime((350 + smooth.thr * 2600) * (0.7 + 0.3 * smooth.rpm), t, 0.08);
    N.rumbleG.gain.setTargetAtTime((0.1 + smooth.thr * 0.9) * 0.6 * (smooth.rpm > 0.05 ? 1 : 0), t, 0.08);
    N.hissG.gain.setTargetAtTime(smooth.thr * 0.12 * cabinFan, t, 0.08);
    N.hissBP.frequency.setTargetAtTime(2500 + smooth.thr * 3500, t, 0.1);
    const fanHz = (350 + smooth.rpm * 1800) * d;
    for (const f of N.fan) f.o.frequency.setTargetAtTime(fanHz * f.mult, t, 0.05);
    N.fanG.gain.setTargetAtTime((0.25 + smooth.thr * 0.5) * (smooth.rpm > 0.05 ? 1 : 0) * cabinFan, t, 0.1);
    const whHz = (1400 + smooth.rpm * 2600) * d;
    N.whine.frequency.setTargetAtTime(whHz, t, 0.08); N.whine2.frequency.setTargetAtTime(whHz * 1.51, t, 0.08);
    N.whineG.gain.setTargetAtTime((smooth.rpm > 0.05 ? 0.05 + smooth.rpm * 0.09 : 0) * (mode === 'pilot' ? 0.45 : 1), t, 0.1);

    // chorro hacia abajo: toberas giradas y poca altura => grave turbulento (más fuerte en efecto suelo)
    const noz = clamp(((nz.angleDeg || 0) / 90), 0, 1.1), agl = air.altAglM ?? 100;
    const ground = clamp(1 - agl / 60, 0, 1) * (fl.inGroundEffect ? 1.25 : 1);
    const downTarget = smooth.thr * noz * (0.35 + 0.65 * ground);
    smooth.down = sm(smooth.down, downTarget, dt, 0.3);
    N.downG.gain.setTargetAtTime(smooth.down * 0.9, t, 0.05);
    N.downLP.frequency.setTargetAtTime(160 + smooth.down * 260, t, 0.1);

    // viento
    const ias = air.iasKt || 0, wind = clamp(ias / 400, 0, 1.3);
    smooth.wind = sm(smooth.wind, wind * wind, dt, 0.4);
    N.windG.gain.setTargetAtTime(smooth.wind * 0.6 * (mode === 'pilot' ? 0.7 : 1), t, 0.1);
    N.windBP.frequency.setTargetAtTime(350 + wind * 1800, t, 0.1);

    // tren: rodadura y chirrido
    const units = state.gear && state.gear.units ? state.gear.units : [];
    const gs = air.gs || 0, onG = !!(fl.onGround || fl.weightOnWheels);
    const roll = onG ? clamp(gs / 80, 0, 1) : 0;
    smooth.roll = sm(smooth.roll, roll, dt, 0.15);
    N.rollG.gain.setTargetAtTime(smooth.roll * 0.6, t, 0.05);
    N.rollLP.frequency.setTargetAtTime((240 + smooth.roll * 500) * d, t, 0.1);
    let skid = 0; for (const u of units) if (u.contact && (u.skid || (u.slip && Math.abs(u.slip.long) > 0.7 && gs > 4))) skid = Math.max(skid, 0.4 + 0.6 * Math.min(1, Math.abs((u.slip && u.slip.long) || 0)));
    smooth.skid = sm(smooth.skid, skid, dt, 0.08);
    N.skidG.gain.setTargetAtTime(smooth.skid * 0.07 * (gs > 3 ? 1 : 0), t, 0.03);
    N.skid.frequency.setTargetAtTime((780 + gs * 3) * d, t, 0.05);

    // toque de ruedas: transición contact false->true con carga
    const vyPrev = prev.vy; prev.vy = state.vel ? state.vel[1] : 0;
    for (const u of units) {
      const was = prev.contacts[u.id]; prev.contacts[u.id] = !!u.contact;
      if (u.contact && was === false) {
        const sink = clamp(Math.abs(vyPrev), 0, 6), big = 0.25 + sink / 6 * 0.75;
        burst({ dur: 0.18 + 0.25 * big, f: 180 + 200 * big, gain: 0.55 * big, tone: 70 + 20 * big });
        burst({ dur: 0.08, f: 2500, q: 0.8, gain: 0.12 * big, type: 'bandpass' }); // chirrido de goma
      }
    }
    // tren: servo y fin de carrera
    const gstate = state.gear ? state.gear.state : 'down';
    const moving = gstate === 'transit';
    smooth.gearMotor = sm(smooth.gearMotor, moving ? 1 : 0, dt, 0.12);
    N.servoG.gain.setTargetAtTime(smooth.gearMotor * 0.1, t, 0.04);
    N.servo.frequency.setTargetAtTime((85 + (state.gear && state.gear.extension ? state.gear.extension : 0) * 30) * d, t, 0.05);
    if (prev.gearState === 'transit' && gstate !== 'transit') burst({ dur: 0.22, f: 320, gain: 0.5, tone: 110 });
    if (prev.gearState !== 'transit' && gstate === 'transit') burst({ dur: 0.12, f: 600, gain: 0.25, type: 'bandpass' });
    prev.gearState = gstate;

    // RCS
    const r = state.rcs || {}; let f = 0; let n = 0;
    for (const k of ['nose', 'tail', 'tailYaw', 'wingL', 'wingR']) if (r[k]) { f += Math.abs(r[k].forceN || 0); n++; }
    const rcs = clamp(f / 1500, 0, 1.2);
    smooth.rcs = sm(smooth.rcs, rcs, dt, rcs > smooth.rcs ? 0.03 : 0.12);
    N.rcsG.gain.setTargetAtTime(smooth.rcs * 0.55 * (smooth.rpm > 0.05 ? 1 : 0), t, 0.02);

    // choque
    if (fl.crashed && !prev.crashed) { burst({ dur: 1.4, f: 700, gain: 1.0, tone: 55 }); burst({ dur: 0.6, f: 3000, q: 0.5, gain: 0.5, type: 'bandpass' }); }
    prev.crashed = !!fl.crashed;

    // avisos: prioridad STALL > GEAR > OVERTEMP > BINGO (patrones de pitidos)
    const w = state.warnings || []; warnClock += dt;
    let pat = null;
    if (w.includes('STALL') || fl.stalled) pat = { f: 1100, on: 0.12, off: 0.12, g: 0.06 };
    else if (w.includes('GEAR')) pat = { f: 700, on: 0.25, off: 0.25, g: 0.06, two: 520 };
    else if (w.includes('OVERTEMP')) pat = { f: 1500, on: 0.5, off: 0.2, g: 0.05 };
    else if (w.includes('BINGO')) pat = { f: 900, on: 0.15, off: 1.0, g: 0.05 };
    if (pat) {
      const cyc = pat.on + pat.off, ph = warnClock % cyc, on = ph < pat.on;
      N.warn.frequency.setTargetAtTime(pat.two && Math.floor(warnClock / cyc) % 2 ? pat.two : pat.f, t, 0.005);
      N.warnG.gain.setTargetAtTime(on ? pat.g * (mode === 'pilot' ? 1.4 : 0.5) : 0, t, 0.006);
    } else N.warnG.gain.setTargetAtTime(0, t, 0.02);
    prev.warn = pat ? 'on' : '';
  };
  /** Velocidad del sonido (m/s) para la temperatura del aire (K); 340 si no se conoce. */
  const soundC = (tempK) => (tempK > 150 && tempK < 350 ? 20.05 * Math.sqrt(tempK) : SOUND_C);
  api.soundSpeed = soundC;
  const gunSt = { on: false, level: 0 };
  /**
   * Estado continuo del cañón: spin 0..1 (giro de los 7 cañones), firing (disparando).
   * view: { mode, camPos, srcPos, tempK }. Fuera de la cabina el inicio y el fin del "BRRRT" llegan con
   * retardo = distancia / c: desde lejos se ven las trazadoras e impactos antes de oír el cañón.
   */
  api.gun = (spin, firing, view = {}) => {
    if (!ctx || !running) return;
    const now = ctx.currentTime, pilot = view.mode === 'pilot';
    let delay = 0;
    if (!pilot && view.camPos && view.srcPos) delay = Math.min(30, Math.hypot(view.camPos[0] - view.srcPos[0], view.camPos[1] - view.srcPos[1], view.camPos[2] - view.srcPos[2]) / soundC(view.tempK));
    const t = now + delay;
    if (firing !== gunSt.on) {
      gunSt.on = firing;
      const atk = 0.008, rel = pilot ? 0.06 : 0.22; // afuera la cola del rugido se alarga (eco del terreno)
      const set = (param, v, tau) => { param.cancelScheduledValues(t); param.setTargetAtTime(v, t, tau); };
      set(N.gunG.gain, firing ? (pilot ? 1.15 : 0.95) : 0, firing ? atk : rel);
      set(N.gunNG.gain, firing ? (pilot ? 0.55 : 0.75) : 0, firing ? atk : rel);
      set(N.gunSubG.gain, firing && pilot ? 0.9 : 0, firing ? 0.02 : 0.1);
      set(N.rattleG.gain, firing && pilot ? 0.22 : 0, firing ? 0.03 : 0.12);
      if (firing) burst({ dur: 0.35, f: 180, gain: pilot ? 0.9 : 0.6, tone: 48, when: t }); // golpe de arranque
    }
    // filtro: en cabina se oye a través de la estructura (más grave y saturado); afuera más brillante
    N.gunLP.frequency.setTargetAtTime(pilot ? 1500 : view.mode === 'world' ? 3500 : 6500, now, 0.05);
    N.gunSrc.playbackRate.setTargetAtTime(0.92 + 0.08 * Math.max(0, Math.min(1, spin)), now, 0.05);
    N.spinG.gain.setTargetAtTime(spin > 0.02 && !firing ? (pilot ? 0.12 : 0.06) * spin : 0, now, 0.05);
    N.spin.frequency.setTargetAtTime(40 + spin * 140, now, 0.05);
  };

  /**
   * Impactos de proyectiles de 30 mm (HEI): cada uno es una pequeña explosión que llega con retardo distancia/c.
   * list: [{pos:[x,y,z], hit:bool}] del cuadro; listener: [x,y,z]. Se reproducen como máximo 8 por cuadro.
   */
  api.impacts = (list, listener, tempK, mode) => {
    if (!ctx || !running || !list || !list.length || !listener) return;
    const c = soundC(tempK), now = ctx.currentTime, pilot = mode === 'pilot';
    const step = Math.max(1, Math.ceil(list.length / 8));
    for (let i = 0; i < list.length; i += step) {
      const p = list[i].pos, d = Math.hypot(p[0] - listener[0], p[1] - listener[1], p[2] - listener[2]);
      if (d > 9000) continue;
      const att = Math.min(1, 60 / (d + 30)) * (pilot ? 0.6 : 1) * Math.min(3, step);
      if (att < 0.004) continue;
      const when = now + Math.min(30, d / c) + Math.random() * 0.01;
      burst({ dur: 0.18 + Math.min(0.5, d / 4000), f: Math.max(250, 2400 / (1 + d / 600)), q: 0.6, gain: Math.min(0.9, att * (list[i].hit ? 1.3 : 1)), tone: list[i].hit ? 90 : 0, when });
    }
  };
  /** Estampido de un proyectil supersónico (1 000 m/s) que pasa cerca del oyente. */
  api.crack = (distM) => {
    if (!ctx || !running) return;
    burst({ dur: 0.06, f: 3500, q: 0.7, gain: Math.min(0.6, 8 / (distM + 5)), type: 'highpass', attack: 0.0005 });
  };
  /** Sonidos puntuales con retardo y atenuación por distancia (m). kind: 'explosion' | 'missile' | 'hit' | 'lock' | 'nolock'. */
  api.event = (kind, distM = 0, tempK) => {
    if (!ctx || !running) return;
    const when = ctx.currentTime + Math.min(30, distM / soundC(tempK)), att = 1 / (1 + distM / 400);
    if (kind === 'explosion') { burst({ dur: 2.2 + Math.min(1.5, distM / 3000), f: 260 * (0.5 + att), gain: Math.min(1, 1.2 * att + 0.15), tone: 45, attack: 0.01, when }); burst({ dur: 0.5, f: 1800, gain: 0.35 * att, type: 'bandpass', when }); }
    else if (kind === 'missile') { burst({ dur: 1.6, f: 900, q: 0.5, gain: 0.6, type: 'bandpass', attack: 0.05 }); burst({ dur: 0.25, f: 300, gain: 0.5, tone: 90 }); }
    else if (kind === 'hit') burst({ dur: 0.12, f: 1200, gain: 0.25 * att, type: 'bandpass', when });
    else if (kind === 'lock' || kind === 'nolock') {
      const o = ctx.createOscillator(), og = ctx.createGain(), tt = ctx.currentTime;
      o.type = 'sine'; o.frequency.value = kind === 'lock' ? 1600 : 400; og.gain.setValueAtTime(0.08, tt); og.gain.exponentialRampToValueAtTime(0.001, tt + 0.25);
      o.connect(og); og.connect(N.bus); o.start(tt); o.stop(tt + 0.3);
    }
  };
  return api;
}
