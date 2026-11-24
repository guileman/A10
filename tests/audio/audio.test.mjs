import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudio } from '../../src/audio/index.js';

test('sin Web Audio: API nula que no falla', () => {
  const a = createAudio({ AudioContextClass: null });
  // en Node no existe window: debe degradar a no-op
  assert.equal(a.supported, false);
  a.resume(); a.update({}, {}, 0.016, {}); a.setVolume(0.5); assert.equal(a.toggleMute(), false); a.stop(); a.reset();
});

// AudioContext simulado: registra las llamadas programadas en los parámetros.
function mockAC() {
  const calls = [];
  const param = (name) => ({ value: 0, name, setTargetAtTime(v, t) { calls.push({ name, v, t }); }, setValueAtTime(v, t) { calls.push({ name, v, t }); }, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} });
  const node = (kind) => ({ kind, connect() {}, start(t) { calls.push({ name: kind + '.start', t: t || 0 }); }, stop() {}, gain: param(kind + '.gain'), frequency: param(kind + '.frequency'), Q: param('Q'), playbackRate: param(kind + '.rate'), threshold: param('th'), ratio: param('ra'), attack: param('at'), release: param('re'), curve: null, oversample: 'none', fftSize: 0, type: '', buffer: null, loop: false });
  class AC {
    constructor() { this.currentTime = 10; this.sampleRate = 8000; this.state = 'running'; this.destination = node('dest'); AC.calls = calls; }
    createGain() { return node('gain'); } createBiquadFilter() { return node('biquad'); } createOscillator() { return node('osc'); }
    createBufferSource() { return node('src'); } createWaveShaper() { return node('shaper'); } createDynamicsCompressor() { return node('comp'); } createAnalyser() { return node('an'); }
    createBuffer(ch, n) { const d = new Float32Array(n); return { duration: n / 8000, getChannelData: () => d }; }
    resume() {} suspend() {}
  }
  return AC;
}

test('cañón: en cabina suena al instante; desde la cámara de mundo a 686 m llega ~2 s tarde (c a 293 K)', () => {
  const AC = mockAC(); const a = createAudio({ AudioContextClass: AC }); a.resume();
  const c = a.soundSpeed(293); assert.ok(Math.abs(c - 343.2) < 0.5, 'c(293 K) ≈ 343 m/s');
  AC.calls.length = 0;
  a.gun(1, true, { mode: 'pilot', camPos: [0, 0, 0], srcPos: [0, 0, 0], tempK: 293 });
  const t0 = AC.calls.filter((k) => k.name === 'gain.gain' && k.v > 0.5).map((k) => k.t);
  assert.ok(t0.length && t0.every((t) => Math.abs(t - 10) < 1e-6));
  a.gun(1, false, { mode: 'pilot' });
  AC.calls.length = 0;
  a.gun(1, true, { mode: 'world', camPos: [686, 0, 0], srcPos: [0, 0, 0], tempK: 293 });
  const t1 = AC.calls.filter((k) => k.name === 'gain.gain' && k.v > 0.5).map((k) => k.t);
  assert.ok(t1.length && t1.every((t) => Math.abs(t - 12) < 0.02), 'retardo ≈ 2 s: ' + t1.join(','));
});

test('impactos: cada estallido se programa con retardo distancia / c', () => {
  const AC = mockAC(); const a = createAudio({ AudioContextClass: AC }); a.resume();
  AC.calls.length = 0;
  a.impacts([{ pos: [1716, 0, 0], hit: false }], [0, 0, 0], 293, 'world');
  const starts = AC.calls.filter((k) => k.name === 'src.start').map((k) => k.t);
  assert.ok(starts.length >= 1 && starts.every((t) => t >= 14.99 && t <= 15.02), 'llega a los ~5 s: ' + starts.join(','));
});
