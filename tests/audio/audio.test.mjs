import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudio } from '../../src/audio/index.js';

test('sin Web Audio: API nula que no falla', () => {
  const a = createAudio({ AudioContextClass: null });
  // en Node no existe window: debe degradar a no-op
  assert.equal(a.supported, false);
  a.resume(); a.update({}, {}, 0.016, {}); a.setVolume(0.5); assert.equal(a.toggleMute(), false); a.stop(); a.reset();
});
