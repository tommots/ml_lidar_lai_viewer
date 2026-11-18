import { h, svg, clear, fmt } from './ui.js';

const M = { l: 46, r: 14, t: 10, b: 42 };


export class ProfileChart {
  constructor(host, opts = {}) {
    this.host = host;
    this.opts = opts;
    this.spec = null;
    this.hoverK = null;
    this.title = h('h3', { class: 'chart-title' });
    this.sub = h('p', { class: 'chart-sub' });
    this.plot = h('div', { class: 'chart-plot' });
    this.svg = svg('svg', { class: 'chart-svg', tabindex: 0, role: 'img' });
    this.tip = h('div', { class: 'chart-tip', hidden: true, role: 'status' });
    this.plot.append(this.svg, this.tip);
    this.note = h('p', { class: 'chart-note', hidden: true });
    this.legend = h('ul', { class: 'chart-legend', 'aria-label': 'Profile chart lines' });
    this.tableWrap = h('div', { class: 'table-wrap' });
    this.details = h('details', { class: 'chart-table' }, h('summary', {}, 'Profile values as a table'), this.tableWrap);
    this.details.addEventListener('toggle', () => { if (this.details.open) this.renderTable(); });
    host.append(h('div', { class: 'chart-head' }, this.title, this.sub), this.plot, this.note, this.legend, this.details);
    this.svg.addEventListener('pointermove', (e) => this.onPointer(e));
    this.svg.addEventListener('pointerleave', () => this.setHover(null));
    this.svg.addEventListener('keydown', (e) => this.onKey(e));
    this.svg.addEventListener('blur', () => this.setHover(null));
    this.ro = new ResizeObserver(() => this.render());
    this.ro.observe(this.plot);
  }

  update(spec) {
    this.spec = spec;
    this.title.textContent = spec.title;
    this.sub.textContent = spec.sub || '';
    this.note.textContent = spec.note || '';
    this.note.hidden = !spec.note;
    this.render();
    this.renderLegend();
    if (this.details.open) this.renderTable();
  }

  geometry() {
    const W = Math.max(220, this.plot.clientWidth || 300);
    const H = Math.round(Math.min(380, Math.max(250, W * 0.92)));
    return { W, H, iw: W - M.l - M.r, ih: H - M.t - M.b };
  }

  xMax() {
    let mx = 0;
    const { series, yMax, dz } = this.spec;
    const nb = Math.ceil(yMax / dz);
    for (const s of series) {
      if (s.hidden) continue;
      for (let k = 0; k < Math.min(nb, s.values.length); k++) if (Number.isFinite(s.values[k])) mx = Math.max(mx, s.values[k]);
    }
    return niceMax(mx || 0.1);
  }

  render() {
    if (!this.spec) return;
    const { W, H, iw, ih } = this.geometry();
    const { yMax, dz, series } = this.spec;
    const xm = this.xMax();
    this.sx = (v) => M.l + (v / xm) * iw;
    this.sy = (y) => M.t + ih - (y / yMax) * ih;
    this.dims = { W, H, iw, ih, xm };
    const s = this.svg;
    clear(s);
    s.setAttribute('viewBox', `0 0 ${W} ${H}`);
    s.setAttribute('width', W);
    s.setAttribute('height', H);
    const sel = this.spec.select && this.spec.select[0] < yMax ? [this.spec.select[0], Math.min(yMax, this.spec.select[1])] : null;
    s.setAttribute('aria-label', `${this.spec.title}. Height above ground on the vertical axis, ${this.spec.xLabel} on the horizontal axis.${sel ? ` The band from ${fmtH(sel[0])} to ${fmtH(sel[1])} m marks the height bins of the transect.` : ''} Use the arrow keys to read values per height bin.`);
    const css = getComputedStyle(this.host);
    if (sel) s.appendChild(svg('rect', { x: M.l, width: iw, y: this.sy(sel[1]), height: Math.max(1, this.sy(sel[0]) - this.sy(sel[1])), class: 'chart-select' }));
    const grid = svg('g', { class: 'chart-grid' });
    for (const t of ticks(xm, 5)) {
      grid.appendChild(svg('line', { x1: this.sx(t), x2: this.sx(t), y1: M.t, y2: M.t + ih }));
      s.appendChild(svg('text', { x: this.sx(t), y: M.t + ih + 15, class: 'chart-tick', 'text-anchor': 'middle' }, tickLabel(t, xm)));
    }
    const ystep = yMax <= 12 ? 2 : yMax <= 26 ? 4 : yMax <= 40 ? 5 : 10;
    for (let y = 0; y <= yMax + 1e-9; y += ystep) {
      grid.appendChild(svg('line', { x1: M.l, x2: M.l + iw, y1: this.sy(y), y2: this.sy(y) }));
      s.appendChild(svg('text', { x: M.l - 7, y: this.sy(y) + 4, class: 'chart-tick', 'text-anchor': 'end' }, String(y)));
    }
    s.insertBefore(grid, s.firstChild);
    s.appendChild(svg('line', { x1: M.l, x2: M.l, y1: M.t, y2: M.t + ih, class: 'chart-axis' }));
    s.appendChild(svg('line', { x1: M.l, x2: M.l + iw, y1: M.t + ih, y2: M.t + ih, class: 'chart-axis' }));
    s.appendChild(svg('text', { x: M.l + iw / 2, y: H - 6, class: 'chart-label', 'text-anchor': 'middle' }, this.spec.xLabel));
    s.appendChild(svg('text', { x: 12, y: M.t + ih / 2, class: 'chart-label', 'text-anchor': 'middle', transform: `rotate(-90 12 ${M.t + ih / 2})` }, 'Height above ground [m]'));
    this.band = svg('rect', { x: M.l, width: iw, y: 0, height: 0, class: 'chart-band', visibility: 'hidden' });
    s.appendChild(this.band);
    const textColor = css.getPropertyValue('--text').trim() || '#e7ecf0';
    const order = [...series].filter((x) => !x.hidden).sort((a, b) => rank(a) - rank(b));
    for (const se of order) {
      const d = stepPath(se.values, dz, yMax, this.sx, this.sy);
      if (!d) continue;
      const truth = se.kind === 'truth';
      s.appendChild(svg('path', {
        d, fill: 'none', stroke: truth ? textColor : se.color,
        'stroke-width': truth ? 3.5 : se.active ? 2.6 : 1.6,
        'stroke-opacity': truth || se.active ? 1 : 0.85,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round',
        'stroke-dasharray': se.dashed ? (se.dash || '5 4') : null,
        class: 'chart-line',
      }));
    }
    if (this.hoverK !== null) this.setHover(this.hoverK);
  }

  renderLegend() {
    clear(this.legend);
    const grid = this.spec.legendGrid;
    this.legend.classList.toggle('grid', !!grid);
    if (!grid) {
      for (const se of this.spec.series) this.legend.appendChild(h('li', {}, this.key(se)));
      return;
    }
    for (const hd of grid.heads) {
      this.legend.appendChild(h('li', { class: 'legend-head' }, h('button', {
        type: 'button', class: `chart-key head${hd.pressed ? '' : ' off'}`, 'aria-pressed': String(!!hd.pressed),
        title: hd.title || '', onclick: () => hd.onClick && hd.onClick(),
      }, h('span', { class: `line-key${hd.dashed ? ' dashed' : ''}`, 'aria-hidden': 'true' }), hd.label)));
    }
    const byId = new Map(this.spec.series.map((se) => [se.id, se]));
    const inGrid = new Set();
    for (const row of grid.rows) {
      for (const id of row) {
        const se = id ? byId.get(id) : null;
        if (se) inGrid.add(id);
        this.legend.appendChild(h('li', {}, se ? this.key(se) : null));
      }
    }
    for (const se of this.spec.series) {
      if (!inGrid.has(se.id)) this.legend.appendChild(h('li', { class: 'span' }, this.key(se)));
    }
  }

  key(se) {
    const action = se.hidden ? 'Show in chart' : 'Hide from chart';
    return h('button', {
      type: 'button', class: `chart-key${se.hidden ? ' off' : ''}${se.active ? ' active' : ''}`,
      'aria-pressed': String(!se.hidden), 'aria-label': se.ariaLabel || null,
      title: se.legend ? `${se.label} — ${action.toLowerCase()}` : action,
      onclick: () => this.opts.onToggle && this.opts.onToggle(se.id),
    },
    h('span', { class: `line-key${se.kind === 'truth' ? ' truth' : ''}${se.dashed ? ' dashed' : ''}`, style: se.kind === 'truth' ? {} : { background: se.color, '--c': se.color }, 'aria-hidden': 'true' }),
    se.legend || se.label);
  }

  renderTable() {
    if (!this.spec) return;
    const { dz, yMax, series } = this.spec;
    const vis = series.filter((s) => !s.hidden);
    const nb = Math.ceil(yMax / dz);
    const thead = h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Height above ground [m]'), vis.map((s) => h('th', { scope: 'col' }, s.label))));
    const tbody = h('tbody');
    for (let k = nb - 1; k >= 0; k--) {
      tbody.appendChild(h('tr', {}, h('th', { scope: 'row' }, `${fmtH(k * dz)}–${fmtH((k + 1) * dz)}`),
        vis.map((s) => h('td', {}, fmt(s.values[k], 3)))));
    }
    clear(this.tableWrap).appendChild(h('table', { class: 'data-table' }, thead, tbody));
  }

  onPointer(e) {
    if (!this.spec || !this.dims) return;
    const r = this.svg.getBoundingClientRect();
    const y = ((e.clientY - r.top) / r.height) * this.dims.H;
    const height = ((M.t + this.dims.ih - y) / this.dims.ih) * this.spec.yMax;
    if (height < 0 || height > this.spec.yMax) { this.setHover(null); return; }
    this.setHover(Math.floor(height / this.spec.dz));
  }

  onKey(e) {
    if (!this.spec) return;
    const nb = Math.ceil(this.spec.yMax / this.spec.dz);
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const k0 = this.hoverK === null ? 0 : this.hoverK + (e.key === 'ArrowUp' ? 1 : -1);
      this.setHover(Math.max(0, Math.min(nb - 1, k0)));
    } else if (e.key === 'Escape') this.setHover(null);
  }

  setHover(k) {
    this.hoverK = k;
    if (!this.band) return;
    if (k === null || !this.spec) {
      this.band.setAttribute('visibility', 'hidden');
      this.tip.hidden = true;
      return;
    }
    const { dz, yMax, series } = this.spec;
    const y0 = k * dz;
    const y1 = Math.min(yMax, (k + 1) * dz);
    this.band.setAttribute('y', this.sy(y1));
    this.band.setAttribute('height', Math.max(1, this.sy(y0) - this.sy(y1)));
    this.band.setAttribute('visibility', 'visible');
    clear(this.tip);
    this.tip.appendChild(h('div', { class: 'tt-title' }, `${fmtH(y0)}–${fmtH(y1)} m above ground`));
    for (const se of series) {
      if (se.hidden) continue;
      this.tip.appendChild(h('div', { class: 'tt-row' },
        h('span', { class: `tt-line${se.kind === 'truth' ? ' truth' : ''}${se.dashed ? ' dashed' : ''}`, style: se.kind === 'truth' ? {} : { background: se.color, '--c': se.color }, 'aria-hidden': 'true' }),
        h('span', { class: 'tt-value' }, fmt(se.values[k], 3)),
        h('span', { class: 'tt-label' }, se.label)));
    }
    this.tip.hidden = false;
    const scale = this.svg.getBoundingClientRect().width / this.dims.W || 1;
    const top = Math.max(0, (this.sy(y1) * scale) - this.tip.offsetHeight - 6);
    const left = this.plot.clientWidth - this.tip.offsetWidth - 4;
    this.tip.style.transform = `translate(${Math.max(0, left)}px, ${top}px)`;
  }
}

function rank(s) {
  if (s.kind === 'truth') return 0;
  return s.active ? 2 : 1;
}

function stepPath(values, dz, yMax, sx, sy) {
  let d = '';
  let open = false;
  for (let k = 0; k < values.length; k++) {
    const y0 = k * dz;
    if (y0 >= yMax - 1e-9) break;
    const y1 = Math.min(yMax, (k + 1) * dz);
    const v = values[k];
    if (!Number.isFinite(v)) { open = false; continue; }
    const X = sx(Math.max(0, v)).toFixed(1);
    if (!open) { d += `M${X},${sy(y0).toFixed(1)}`; open = true; } else d += `H${X}`;
    d += `V${sy(y1).toFixed(1)}`;
  }
  return d;
}

function niceMax(v) {
  const e = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * e >= v * 1.02) return m * e;
  return 10 * e;
}

function ticks(max, n) {
  const raw = max / n;
  const e = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * e).find((s) => s >= raw) || 10 * e;
  const out = [];
  for (let t = 0; t <= max + 1e-9; t += step) out.push(+t.toFixed(10));
  return out;
}

function tickLabel(t, max) {
  return max < 0.1 ? t.toFixed(3) : max < 1 ? t.toFixed(2) : max < 10 ? t.toFixed(1) : t.toFixed(0);
}

function fmtH(v) {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
