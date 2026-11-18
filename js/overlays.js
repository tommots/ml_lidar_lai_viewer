import * as THREE from 'three';
import { h, svg, clear, icon } from './ui.js';
import { cssGradient } from './colormaps.js';


export function renderLegends(el, entries, opts = {}) {
  clear(el);
  el.hidden = !entries.length;
  const collapsed = !!opts.collapsed;
  for (const e of entries) {
    const box = h('div', { class: `legend legend-${e.type}${e.compact ? ' compact' : ''}`, hidden: collapsed });
    box.appendChild(h('button', {
      type: 'button', class: 'legend-title', title: `${e.title} — ${e.compact ? 'show' : 'fold'} this legend`,
      'aria-expanded': String(!e.compact),
      onclick: () => opts.onCompact && e.key && opts.onCompact(e.key, !e.compact),
    }, h('span', { class: 'legend-title-text' }, e.title), icon('chevron', { size: 12, class: 'chev' })));
    if (e.compact) {
      el.appendChild(box);
      continue;
    }
    if (e.type === 'seq' || e.type === 'div') {
      const from = e.from ?? 0;
      const to = e.to ?? 1;
      const div = e.type === 'div';
      const range = `${legendNum(div ? -e.max : e.min, e, div)} to ${legendNum(e.max, e, div)}`;
      box.appendChild(h('div', { class: 'cbar', style: { background: cssGradient(e.map, from, to, 16) }, role: 'img', 'aria-label': `${e.title}: color scale ${range}${e.unit ? ` ${e.unit}` : ''}` }));
      const ticks = h('div', { class: 'cbar-ticks', 'aria-hidden': 'true' });
      if (div) ticks.append(h('span', {}, legendNum(-e.max, e, true)), h('span', {}, '0'), h('span', {}, legendNum(e.max, e, true)));
      else ticks.append(h('span', {}, legendNum(e.min, e)), h('span', {}, legendNum((e.min + e.max) / 2, e)), h('span', {}, `${legendNum(e.max, e)}${e.capped ? '+' : ''}`));
      box.appendChild(ticks);
      if (div) box.appendChild(h('div', { class: 'cbar-poles', 'aria-hidden': 'true' }, h('span', {}, '← prediction lower'), h('span', {}, 'prediction higher →')));
      const unit = [e.unit, e.sub].filter(Boolean).join(' · ');
      if (unit) box.appendChild(h('div', { class: 'legend-unit' }, unit));
    } else if (e.type === 'cat') {
      const cats = e.categories.slice(0, 8);
      const list = h('ul', { class: `legend-cats${cats.length > 3 ? ' two-col' : ''}` });
      for (const c of cats) {
        list.appendChild(h('li', { title: c.label },
          h('span', { class: 'swatch', style: { background: c.color }, 'aria-hidden': 'true' }),
          h('span', { class: 'cat-label' }, c.label),
          c.share !== null && c.share !== undefined ? h('span', { class: 'cat-share' }, `${(c.share * 100).toFixed(c.share < 0.01 ? 1 : 0)} %`) : null));
      }
      if (e.categories.length > cats.length) list.appendChild(h('li', { class: 'cat-more' }, `+ ${e.categories.length - cats.length} more`));
      box.appendChild(list);
      if (e.note) box.appendChild(h('div', { class: 'legend-unit' }, e.note));
    } else if (e.type === 'rgb') {
      box.appendChild(h('div', { class: 'legend-unit' }, ['camera color of each point', e.note].filter(Boolean).join(' · ')));
    }
    el.appendChild(box);
  }
  if (entries.length) {
    el.appendChild(h('button', {
      type: 'button', class: 'legend-toggle', 'aria-expanded': String(!collapsed),
      onclick: () => opts.onToggle && opts.onToggle(!collapsed),
    }, icon('chevron', { size: 14, class: 'chev' }), collapsed ? `Legend (${entries.length})` : 'Legend'));
  }
}

function legendNum(v, e, signed = false) {
  if (!Number.isFinite(v)) return '–';
  const span = Math.abs(e.max - (e.min ?? 0));
  const d = span >= 20 ? 0 : span >= 2 ? 1 : 2;
  const s = Math.abs(v).toFixed(d);
  if (signed && Number(s) !== 0) return (v > 0 ? '+' : '−') + s;
  return v < 0 ? `−${s}` : s;
}

const AXES = [
  { v: new THREE.Vector3(1, 0, 0), color: '#e5534b' },
  { v: new THREE.Vector3(0, 1, 0), color: '#46a758' },
  { v: new THREE.Vector3(0, 0, 1), color: '#4b8fe8' },
];

function axisAction(label, i) {
  const what = i === 2 ? 'look from below or from above' : `turn the view by 180° (${label} to the other side)`;
  return `${label}: ${what}. After orbiting by hand, the first click goes back to the start view.`;
}

export class Gizmo {
  constructor(host, labels = ['x', 'y', 'z']) {
    this.svg = svg('svg', { class: 'gizmo', viewBox: '-40 -40 80 80', width: 72, height: 72, role: 'group', 'aria-label': 'Axis orientation' });
    this.axes = svg('g', {});
    this.hits = AXES.map((a, i) => svg('circle', { r: 10, class: 'gizmo-hit', role: 'button', tabindex: '0', dataset: { axis: String(i) } }, svg('title', {})));
    this.svg.append(svg('circle', { cx: 0, cy: 0, r: 37, class: 'gizmo-bg' }), this.axes, ...this.hits);
    host.appendChild(this.svg);
    this.onAxis = null;
    const fire = (e) => {
      const t = e.target.closest ? e.target.closest('.gizmo-hit') : null;
      if (!t || !this.onAxis) return false;
      this.onAxis(Number(t.dataset.axis));
      return true;
    };
    this.svg.addEventListener('click', fire);
    this.svg.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && fire(e)) e.preventDefault();
    });
    this.setLabels(labels);
    this.dir = new THREE.Vector3();
  }

  setLabels(labels) {
    this.labels = labels;
    this.hits.forEach((c, i) => {
      const text = axisAction(labels[i], i);
      c.setAttribute('aria-label', text);
      c.firstChild.textContent = text;
    });
  }

  update(camera) {
    const items = AXES.map((a, i) => {
      const d = a.v.clone().transformDirection(camera.matrixWorldInverse);
      return { d, a, i };
    }).sort((p, q) => p.d.z - q.d.z);
    clear(this.axes);
    for (const { d, a, i } of items) {
      const x = d.x * 24;
      const y = -d.y * 24;
      const faint = d.z < -0.2;
      this.axes.appendChild(svg('line', { x1: 0, y1: 0, x2: x, y2: y, stroke: a.color, 'stroke-width': faint ? 1.8 : 2.5, 'stroke-linecap': 'round', opacity: faint ? 0.45 : 1 }));
      this.axes.appendChild(svg('circle', { cx: x * 1.3, cy: y * 1.3, r: faint ? 6.5 : 7.5, fill: a.color }));
      this.axes.appendChild(svg('text', { x: x * 1.3, y: y * 1.3 + 3.3, 'text-anchor': 'middle', class: 'gizmo-text' }, this.labels[i]));
      this.hits[i].setAttribute('cx', (x * 1.3).toFixed(2));
      this.hits[i].setAttribute('cy', (y * 1.3).toFixed(2));
    }
  }
}

const NICE = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];

export class ScaleBar {
  constructor(host) {
    this.el = h('div', { class: 'scalebar', title: 'Scale at the depth of the orbit center (perspective view)' },
      this.bar = h('div', { class: 'scalebar-bar' }), this.text = h('span', { class: 'scalebar-text' }));
    host.appendChild(this.el);
  }

  update(camera, distance, viewportHeight, maxPx = 130) {
    const pxPerM = viewportHeight / (2 * distance * Math.tan((camera.fov * Math.PI) / 360));
    let len = NICE[0];
    for (const n of NICE) if (n * pxPerM <= maxPx) len = n;
    this.bar.style.width = `${Math.max(8, len * pxPerM).toFixed(1)}px`;
    this.text.textContent = `${len < 1 ? len.toFixed(1) : len} m`;
  }
}

export class LoadingBar {
  constructor(el) {
    this.el = el;
    this.fill = el.querySelector('.loading-fill');
    this.text = el.querySelector('.loading-text');
  }

  show(text, fraction) {
    this.el.hidden = false;
    this.text.textContent = text;
    this.el.classList.toggle('indeterminate', fraction === null || fraction === undefined);
    if (Number.isFinite(fraction)) this.fill.style.width = `${(Math.max(0, Math.min(1, fraction)) * 100).toFixed(1)}%`;
  }

  hide() {
    this.el.hidden = true;
  }
}

export class Tooltip {
  constructor(el) {
    this.el = el;
    this.key = null;
    this.size = { w: 0, h: 0 };
  }

  show(x, y, content, bounds, key = null) {
    const el = this.el;
    clear(el);
    el.appendChild(h('div', { class: 'tt-title' }, content.title));
    for (const r of content.rows) {
      el.appendChild(h('div', { class: 'tt-row' },
        r.color ? h('span', { class: 'tt-key', style: { background: r.color }, 'aria-hidden': 'true' }) : h('span', { class: 'tt-key tt-key-none' }),
        h('span', { class: 'tt-value' }, r.value),
        h('span', { class: 'tt-label' }, r.label)));
    }
    if (content.note) el.appendChild(h('div', { class: 'tt-note' }, content.note));
    el.hidden = false;
    this.key = key;
    this.size = { w: el.offsetWidth, h: el.offsetHeight };
    this.move(x, y, bounds);
  }

  move(x, y, bounds) {
    const { w, h: hh } = this.size;
    let left = x + 14;
    let top = y + 14;
    if (left + w > bounds.w - 6) left = x - w - 14;
    if (top + hh > bounds.h - 6) top = y - hh - 14;
    this.el.style.transform = `translate(${Math.max(6, left)}px, ${Math.max(6, top)}px)`;
  }

  hide() {
    this.el.hidden = true;
    this.key = null;
  }
}
