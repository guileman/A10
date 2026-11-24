// Mapeo de los mandos Touch (perfil xr-standard) a los controles del A-10. Función pura y testeable.
//  Derecho: palanca = cabeceo/alabeo · gatillo = CAÑÓN · A = lanzar Maverick · B = bloquear/siguiente blanco · agarre = aerofreno · clic = desbloquear
//  Izquierdo: stick Y = gases, X = pedales · gatillo = frenos · agarre = freno de estacionamiento · X = tren · Y = flaps
export const DEAD = 0.08;
const dz = (v) => (Math.abs(v) < DEAD ? 0 : Math.sign(v) * (Math.abs(v) - DEAD) / (1 - DEAD));
const expo = (v, k = 1.6) => Math.sign(v) * Math.pow(Math.abs(v), k);
const btn = (gp, i) => (gp && gp.buttons && gp.buttons[i] ? gp.buttons[i] : { pressed: false, value: 0 });
const axis = (gp, i) => (gp && gp.axes && Number.isFinite(gp.axes[i]) ? gp.axes[i] : 0);

/**
 * pads: { left?: Gamepad, right?: Gamepad } · prev: estado de botones del cuadro anterior (mutable)
 * api: input (setExternal, setThrottle, press, state) · onAction(name): 'fireMissile' | 'lockTarget' | 'unlockTarget'
 * Devuelve { pitch, roll, yaw, brake, gun }.
 */
export function applyXRInput(pads, prev, dt, api, { throttleRate = 0.5, onAction = null } = {}) {
  const L = pads.left, R = pads.right;
  const edge = (key, pressed) => { const was = !!prev[key]; prev[key] = pressed; return pressed && !was; };
  const sx = (gp) => (gp && gp.axes && gp.axes.length >= 4 ? axis(gp, 2) : axis(gp, 0));
  const sy = (gp) => (gp && gp.axes && gp.axes.length >= 4 ? axis(gp, 3) : axis(gp, 1));
  const pitch = expo(dz(sy(R))), roll = expo(dz(sx(R))), yaw = expo(dz(sx(L)), 1.3);
  const brake = btn(L, 0).value;
  api.setExternal({ pitch, roll, yaw, brake });
  const thr = -dz(sy(L));
  if (thr !== 0 && api.setThrottle) api.setThrottle(api.state.throttle + thr * throttleRate * dt);
  const gun = btn(R, 0).value > 0.5;
  const act = (n) => { if (onAction) onAction(n); };
  if (edge('a', btn(R, 4).pressed)) act('fireMissile');
  if (edge('b', btn(R, 5).pressed)) act('lockTarget');
  if (edge('rClick', btn(R, 3).pressed)) act('unlockTarget');
  if (edge('rGrip', btn(R, 1).pressed)) api.press('speedbrake');
  if (edge('lGrip', btn(L, 1).pressed)) api.press('parkingBrake');
  if (edge('x', btn(L, 4).pressed)) api.press('gear');
  if (edge('y', btn(L, 5).pressed)) api.press('flaps');
  return { pitch, roll, yaw, brake, gun };
}
