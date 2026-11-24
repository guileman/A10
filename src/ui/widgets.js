// Utilidades de DOM y widgets del menú (accesibles por teclado). `doc` se inyecta (jsdom en pruebas).
export function makeDom(doc) {
  const h = (tag, props, ...kids) => {
    const e = doc.createElement(tag);
    if (props) for (const k of Object.keys(props)) {
      const v = props[k];
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
      else e.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of kids.flat(3)) if (c !== undefined && c !== null && c !== false) e.append(c.nodeType ? c : String(c));
    return e;
  };
  const comma = (n, d = 0) => Number(n).toFixed(d).replace('.', ',');

  /** Botón de menú. */
  const btn = (label, onClick, { cls = '', sub = '', id } = {}) =>
    h('button', { type: 'button', class: 'hz-btn hz-nav ' + cls, id, onClick }, h('span', { text: label }), sub ? h('small', { text: sub }) : null);

  /** Grupo de opciones (radiogroup). Izq/Der cambia; solo la opción activa entra en el orden de foco (↑↓ saltan de fila). */
  const segment = (options, value, onChange, label) => {
    const wrap = h('div', { class: 'hz-seg', role: 'radiogroup', 'aria-label': label || '' });
    const set = (v, notify = true) => {
      for (const b of wrap.children) { const on = b.dataset.v === String(v); b.setAttribute('aria-checked', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; b.classList.toggle('hz-nav', on); }
      if (notify) onChange && onChange(v);
    };
    for (const o of options) {
      const b = h('button', { type: 'button', role: 'radio', 'data-v': o.v, text: o.label, onClick: () => { set(o.v); b.focus(); } });
      wrap.append(b);
    }
    wrap.step = (dir) => {
      const vals = options.map((o) => String(o.v));
      const cur = Math.max(0, vals.indexOf(String(Array.from(wrap.children).find((b) => b.getAttribute('aria-checked') === 'true')?.dataset.v)));
      const nx = Math.min(vals.length - 1, Math.max(0, cur + dir));
      if (nx !== cur) { set(options[nx].v); wrap.children[nx].focus(); }
    };
    wrap.setValue = (v) => set(v, false);
    set(value, false);
    return wrap;
  };

  /** Deslizador con lectura. fmt(v) -> texto. */
  const slider = ({ min, max, step, value, fmt, onInput, label }) => {
    const out = h('span', { class: 'v' });
    const inp = h('input', { type: 'range', class: 'hz-nav', min, max, step, value, 'aria-label': label || '' });
    const upd = () => { out.textContent = fmt ? fmt(+inp.value) : inp.value; };
    inp.addEventListener('input', () => { upd(); onInput && onInput(+inp.value); });
    upd();
    const wrap = h('div', { class: 'hz-sl' }, inp, out);
    wrap.input = inp; wrap.setValue = (v) => { inp.value = v; upd(); };
    return wrap;
  };

  const row = (label, control, hint) => h('div', { class: 'hz-row' }, h('label', { class: 'lbl', text: label }), control, hint ? h('div', { class: 'hint', text: hint }) : null);

  /** Campo de texto numérico (acepta coma o punto). onCommit(number|NaN) en 'change'/Enter. */
  const numField = ({ value, onCommit, label, inputmode = 'decimal' }) => {
    const i = h('input', { type: 'text', class: 'hz-in hz-nav', inputmode, 'aria-label': label || '', value });
    const commit = () => { const v = parseFloat(String(i.value).replace(',', '.')); onCommit && onCommit(v, i); };
    i.addEventListener('change', commit);
    i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commit(); } });
    return i;
  };

  return { h, comma, btn, segment, slider, row, numField, doc };
}

/** Orden de foco (↑/↓) dentro de un contenedor. */
export function focusables(container) {
  return Array.from(container.querySelectorAll('.hz-nav')).filter((e) => !e.disabled && e.tabIndex >= 0 && !(e.closest && e.closest('[hidden]')));
}
