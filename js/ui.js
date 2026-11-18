const SVG_NS = 'http://www.w3.org/2000/svg';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  applyAttrs(el, attrs);
  append(el, children);
  return el;
}

export function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  applyAttrs(el, attrs);
  append(el, children);
  return el;
}

function applyAttrs(el, attrs) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'text') el.textContent = String(v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) el.style.setProperty(sk, sv);
        else el.style[sk] = sv;
      }
    }
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function fmt(v, d = 2) {
  return v === null || v === undefined || !Number.isFinite(v) ? '–' : v.toFixed(d);
}

export function fmtSigned(v, d = 2) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  const s = Math.abs(v).toFixed(d);
  if (Number(s) === 0) return s;
  return (v > 0 ? '+' : '−') + s;
}

export function fmtCount(n) {
  if (!Number.isFinite(n)) return '–';
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2).replace(/\.?0+$/, '')} M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} k`;
  return String(n);
}

export function fmtMillions(n) {
  if (!Number.isFinite(n)) return '–';
  if (n < 1e5) return `${fmtCount(n)}`;
  return `${(n / 1e6).toFixed(n < 1e6 ? 2 : 1)} M`;
}

export function fmtBytes(n) {
  if (!Number.isFinite(n)) return '–';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} kB`;
  return `${n} B`;
}

export function fmtDuration(s) {
  if (!Number.isFinite(s) || s <= 0) return '';
  if (s < 60) return `~${Math.max(5, Math.round(s / 5) * 5)} s`;
  return `~${Math.round(s / 60)} min`;
}

export function debounce(fn, ms) {
  let t = null;
  let lastArgs = [];
  const d = (...args) => {
    lastArgs = args;
    clearTimeout(t);
    t = setTimeout(() => { t = null; fn(...lastArgs); }, ms);
  };
  d.flush = () => { if (t !== null) { clearTimeout(t); t = null; fn(...lastArgs); } };
  d.cancel = () => { clearTimeout(t); t = null; };
  return d;
}

export function rafThrottle(fn) {
  let pending = false;
  let lastArgs = [];
  return (...args) => {
    lastArgs = args;
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; fn(...lastArgs); });
  };
}

export const storage = {
  get(key, fallback = null) {
    try {
      const v = window.localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) {
      return fallback;
    }
  },
  set(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) {  }
  },
};

export function toast(message, opts = {}) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = h('div', { class: `toast toast-${opts.kind || 'info'}`, role: opts.kind === 'error' ? 'alert' : 'status' }, message);
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, opts.timeout || 2600);
}

export function reducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function coarsePointer() {
  return window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
}

const ICONS = {
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'M6 6l12 12M18 6L6 18',
  chevron: 'M6 9l6 6 6-6',
  compare: 'M12 4v16M4 5h16v14H4z',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 100-8 4 4 0 000 8z',
  link: 'M10 14a4 4 0 005.66 0l3-3a4 4 0 00-5.66-5.66l-1 1M14 10a4 4 0 00-5.66 0l-3 3a4 4 0 005.66 5.66l1-1',
  help: 'M12 21a9 9 0 100-18 9 9 0 000 18zM9.5 9.5a2.5 2.5 0 114 2c-.9.6-1.5 1.1-1.5 2.2M12 17h.01',
  sun: 'M12 16a4 4 0 100-8 4 4 0 000 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  eyeOff: 'M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.1A9.7 9.7 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3.2 4.1M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7c1.7 0 3.2-.4 4.5-1.1',
  warning: 'M12 3l10 18H2zM12 10v5M12 18h.01',
  retry: 'M4 12a8 8 0 0113.7-5.7L20 8.6M20 4v4.6h-4.6M20 12a8 8 0 01-13.7 5.7L4 15.4M4 20v-4.6h4.6',
  target: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 16a4 4 0 100-8 4 4 0 000 8zM12 12h.01',
  oblique: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5',
  top: 'M4 4h16v16H4zM4 12h16M12 4v16',
  side: 'M3 20h18M7 20V9l5-5 5 5v11',
  search: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3',
  panel: 'M4 4h16v16H4zM15 4v16',
  check: 'M5 12l5 5 9-10',
  viewTop: 'M3 18l5-4h13l-5 4zM12.5 2.5V11M9.5 8l3 3 3-3',
  viewBottom: 'M3 9l5-4h13l-5 4zM12.5 21.5V13M9.5 16l3-3 3 3',
  isoBack: 'M12 2.5l5.6 3.15v6.3L12 15.1l-5.6-3.15v-6.3zM12 8.8l5.6-3.15M12 8.8v6.3M12 8.8L6.4 5.65M6 18c1.5 2.8 10.5 2.8 12 0M15.3 19.3L18 18l.3 3',
  leaf: 'M5 19c0-8 5-14 15-15-1 10-7 15-15 15zM5 19l7-7',
};

export function icon(name, opts = {}) {
  const size = opts.size || 18;
  return svg('svg', {
    class: `icon ${opts.class || ''}`, width: size, height: size, viewBox: '0 0 24 24',
    fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round',
    'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false',
  }, svg('path', { d: ICONS[name] || '' }));
}

export function makeSwitch(opts) {
  const input = h('input', { type: 'checkbox', role: 'switch', id: opts.id });
  input.checked = !!opts.checked;
  if (opts.onChange) input.addEventListener('change', () => opts.onChange(input.checked));
  const el = h('label', { class: `switch${opts.hideLabel ? ' switch-bare' : ''}` },
    input, h('span', { class: 'switch-track', 'aria-hidden': 'true' }),
    h('span', { class: opts.hideLabel ? 'sr-only' : 'switch-label' }, opts.label));
  return { el, input };
}

export function makeSegmented(opts) {
  const buttons = opts.options.map((o) => h('button', {
    type: 'button', class: 'seg-btn', 'aria-pressed': String(o.value === opts.value), dataset: { value: o.value },
    onclick: () => { set(o.value); opts.onChange(o.value); },
  }, o.label));
  const el = h('div', { class: 'segmented', role: 'group', 'aria-label': opts.label }, buttons);
  function set(v) {
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.value === v));
  }
  return { el, set };
}

export function makeRange(opts) {
  const id = opts.id || `r-${Math.random().toString(36).slice(2, 8)}`;
  const input = h('input', { type: 'range', id, min: opts.min, max: opts.max, step: opts.step });
  input.value = String(opts.value);
  const out = h('output', { for: id, class: 'range-value' });
  const format = opts.format || ((v) => String(v));
  out.textContent = format(opts.value);
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = format(v);
    opts.onInput(v);
  });
  const el = h('div', { class: 'field field-range' },
    h('div', { class: 'field-head' }, h('label', { for: id }, opts.label), out), input);
  return {
    el, input,
    set(v) { input.value = String(v); out.textContent = format(Number(input.value)); },
    setText(s) { out.textContent = s; },
  };
}

export function makeDualRange(opts) {
  const id = `d-${Math.random().toString(36).slice(2, 8)}`;
  const n = Math.max(1, opts.n | 0);
  let [lo, hi] = opts.value;
  const out = h('span', { class: 'dual-readout sr-only', id: `${id}-o` });
  const fill = h('div', { class: 'dual-fill' });
  const track = h('div', { class: 'dual-track' }, fill);
  const knob = (which) => h('div', {
    class: `dual-knob dual-${which}`, role: 'slider', tabindex: '0', 'aria-orientation': 'horizontal',
    'aria-label': `${opts.label}, ${which === 'lo' ? 'lower' : 'upper'} edge`, 'aria-describedby': out.id,
    dataset: opts.focusKey ? { focusKey: `${opts.focusKey}:${which}` } : null,
  });
  const knobs = { lo: knob('lo'), hi: knob('hi') };
  const rail = h('div', { class: 'dual', style: { '--n': String(n) } },
    h('div', { class: 'dual-ticks', 'aria-hidden': 'true' }), track, knobs.lo, knobs.hi);
  const el = h('div', { class: 'dual-row', role: 'group', 'aria-label': opts.label, title: opts.title || null },
    h('span', { class: 'dual-axis', 'aria-hidden': 'true' }, opts.short || opts.label), rail, opts.action || null, out);

  const edge = (which) => (which === 'lo' ? lo : hi + 1);
  const limits = (which) => (which === 'lo' ? [0, hi] : [lo + 1, n]);
  function render() {
    fill.style.left = `${(lo / n) * 100}%`;
    fill.style.width = `${((hi + 1 - lo) / n) * 100}%`;
    for (const which of ['lo', 'hi']) {
      const k = knobs[which];
      const [a, b] = limits(which);
      k.style.left = `${(edge(which) / n) * 100}%`;
      k.setAttribute('aria-valuemin', String(a));
      k.setAttribute('aria-valuemax', String(b));
      k.setAttribute('aria-valuenow', String(edge(which)));
      k.setAttribute('aria-valuetext', opts.edgeText(edge(which)));
    }
    const text = opts.text(lo, hi);
    if (out.textContent !== text) out.textContent = text;
  }
  function moveTo(which, e) {
    const [a, b] = limits(which);
    const v = Math.max(a, Math.min(b, Math.round(e)));
    const nlo = which === 'lo' ? v : lo;
    const nhi = which === 'hi' ? v - 1 : hi;
    if (nlo === lo && nhi === hi) return;
    lo = nlo;
    hi = nhi;
    render();
    opts.onChange(lo, hi);
  }
  for (const which of ['lo', 'hi']) {
    knobs[which].addEventListener('keydown', (e) => {
      const cur = edge(which);
      const big = Math.max(1, Math.round(n / 10));
      const [a, b] = limits(which);
      const to = {
        ArrowLeft: cur - 1, ArrowDown: cur - 1, ArrowRight: cur + 1, ArrowUp: cur + 1,
        PageDown: cur - big, PageUp: cur + big, Home: a, End: b,
      }[e.key];
      if (to === undefined || e.altKey || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      moveTo(which, to);
    });
  }
  const at = (clientX) => {
    const r = track.getBoundingClientRect();
    return r.width > 0 ? Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * n : 0;
  };
  let drag = null;
  rail.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const pos = at(e.clientX);
    const grabbed = e.target === knobs.lo ? 'lo' : (e.target === knobs.hi ? 'hi' : null);
    const dlo = Math.abs(pos - edge('lo'));
    const dhi = Math.abs(pos - edge('hi'));
    const which = grabbed || (dlo < dhi || (dlo === dhi && pos < lo) ? 'lo' : 'hi');
    const touching = !!grabbed && Math.abs(knobs.lo.offsetLeft - knobs.hi.offsetLeft) < knobs.lo.offsetWidth;
    drag = { id: e.pointerId, which: touching ? null : which, x: e.clientX, pos };
    rail.setPointerCapture(e.pointerId);
    if (!grabbed && e.pointerType === 'touch') {
      drag.pending = true;
      drag.offset = 0;
      return;
    }
    knobs[which].focus({ preventScroll: true });
    if (!grabbed) moveTo(which, pos);
    drag.offset = grabbed && drag.which ? pos - edge(drag.which) : 0;
    e.preventDefault();
  });
  rail.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.pending) {
      if (Math.abs(e.clientX - drag.x) < 6) return;
      drag.pending = false;
      knobs[drag.which].focus({ preventScroll: true });
    }
    if (!drag.which) {
      if (Math.abs(e.clientX - drag.x) < 3) return;
      drag.which = e.clientX < drag.x ? 'lo' : 'hi';
      drag.offset = drag.pos - edge(drag.which);
      knobs[drag.which].focus({ preventScroll: true });
    }
    moveTo(drag.which, at(e.clientX) - drag.offset);
  });
  const end = (e) => { if (drag && e.pointerId === drag.id) drag = null; };
  rail.addEventListener('pointerup', (e) => {
    if (drag && e.pointerId === drag.id && drag.pending) {
      knobs[drag.which].focus({ preventScroll: true });
      moveTo(drag.which, drag.pos);
    }
    end(e);
  });
  rail.addEventListener('pointercancel', end);
  render();
  return {
    el,
    set(l, hh) {
      lo = l;
      hi = hh;
      render();
    },
  };
}

export function makeSelect(opts) {
  const id = opts.id || `s-${Math.random().toString(36).slice(2, 8)}`;
  const select = h('select', { id });
  select.addEventListener('change', () => opts.onChange(select.value));
  function setOptions(options, value) {
    clear(select);
    const groups = new Map();
    for (const o of options) {
      const opt = h('option', { value: o.value, disabled: !!o.disabled }, o.label);
      if (o.group) {
        if (!groups.has(o.group)) {
          const g = h('optgroup', { label: o.group });
          groups.set(o.group, g);
          select.appendChild(g);
        }
        groups.get(o.group).appendChild(opt);
      } else select.appendChild(opt);
    }
    if (value !== undefined) select.value = value;
  }
  setOptions(opts.options, opts.value);
  const el = h('div', { class: 'field field-select' }, h('label', { for: id }, opts.label), select);
  return { el, select, set(v) { select.value = v; }, setOptions };
}
