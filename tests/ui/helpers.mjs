import { JSDOM } from 'jsdom';

export function makeDom(html = '<!doctype html><html><body><div id="root"></div></body></html>') {
  const dom = new JSDOM(html, { pretendToBeVisual: true, url: 'http://localhost/' });
  return dom;
}
export function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}
export const key = (win, type, code, extra = {}) => {
  const e = new win.KeyboardEvent(type, { code, key: extra.key || code, bubbles: true, cancelable: true, ...extra });
  win.document.dispatchEvent(e);
  return e;
};
export const down = (win, code, extra) => key(win, 'keydown', code, extra);
export const up = (win, code, extra) => key(win, 'keyup', code, extra);
export function stepN(input, dt, n) { for (let i = 0; i < n; i++) input.update(dt); }

/** Contexto 2D falso: acepta cualquier llamada y propiedad. */
export function mockCtx() {
  const calls = { n: 0, texts: [] };
  const target = {};
  const p = new Proxy(target, {
    get(t, k) {
      if (k === '__calls') return calls;
      if (k in t) return t[k];
      return (...a) => { calls.n++; if (k === 'fillText' || k === 'strokeText') calls.texts.push(a[0]); return k === 'measureText' ? { width: 10 } : undefined; };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  return p;
}

export function mouseMove(win, x, y) {
  const e = new win.MouseEvent('mousemove', { bubbles: true });
  Object.defineProperty(e, 'movementX', { value: x });
  Object.defineProperty(e, 'movementY', { value: y });
  win.document.dispatchEvent(e);
}
