import {
  h, clear, fmt, fmtSigned, fmtMillions, icon, storage, makeSwitch, makeSegmented, makeRange, makeDualRange,
  makeSelect,
} from './ui.js';
import { ProfileChart } from './chart.js';
import {
  visibleLayerIds, activatePatch, chartTogglePatch, chartHidden, inSeries, effectiveSeries, currentSeries,
  hasSeriesChoice, seriesPatch, seriesGap, seriesCue, heldOutNote,
} from './viewstate.js';
import {
  AXES, RANGE_KEYS, axisSize, axisNames, axisLetters, axisTitle, normRange, rangeText, edgeText, clipSummary,
} from './clip.js';
import { presetDir } from './scene.js';
import { OPERATOR } from './operator.js';

export { visibleLayerIds };

const CAL_DASH = '8 3';

const BUDGET_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50].map((m) => m * 1e6);

export function budgetSteps(count) {
  const steps = BUDGET_STEPS.filter((s) => s < count);
  steps.push(count);
  return steps;
}

export function capText(n) {
  return n >= 1e6 && n % 1e6 === 0 ? `${n / 1e6} million` : Math.round(n).toLocaleString('en-US');
}

function validCalibration(c) {
  return c && Number.isFinite(c.slope) && Number.isFinite(c.intercept) ? c : null;
}

function calibratedValue(c, v) {
  return validCalibration(c) && Number.isFinite(v) ? c.slope * v + c.intercept : null;
}

function sentence(s) {
  const t = String(s || '').trim();
  if (!t) return '';
  const u = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(u) ? u : `${u}.`;
}

export function groupedLayers(data, st) {
  const groups = new Map();
  for (const l of data.models) {
    if (!inSeries(data, st, l)) continue;
    if (!groups.has(l.groupLabel)) groups.set(l.groupLabel, []);
    groups.get(l.groupLabel).push(l);
  }
  const out = [...groups.entries()].map(([label, layers]) => ({
    label, layers, minTier: Math.min(...layers.map((l) => l.tier)),
  }));
  out.sort((a, b) => a.minTier - b.minTier);
  return out;
}

function group(title, opts = {}) {
  const body = h('div', { class: 'group-body', id: `grp-${(opts.key || title).replace(/\W+/g, '-').toLowerCase()}` });
  const toggle = h('button', { type: 'button', class: 'group-toggle', 'aria-expanded': 'true', 'aria-controls': body.id },
    icon('chevron', { size: 16, class: 'chev' }), h('span', {}, title));
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    body.hidden = !open;
  });
  const head = h('div', { class: 'group-head' }, toggle, opts.switchEl || null);
  const el = h('div', { class: 'ctl-group' }, head, body);
  if (opts.collapsed) { toggle.setAttribute('aria-expanded', 'false'); body.hidden = true; }
  return { el, body };
}

function hint(text) {
  return h('p', { class: 'hint' }, text);
}

function seriesName(text) {
  return h('span', { class: 'series-name' }, text);
}

function mapButtons(el) {
  el.classList.add('seg-maps');
  for (const b of el.querySelectorAll('.seg-btn')) b.dataset.label = b.textContent;
}

export class LayersPanel {
  constructor(root, store, api) {
    this.root = root;
    this.store = store;
    this.api = api;
    this.data = null;
    root.appendChild(hint('The layer controls appear once a stand or date is open.'));
  }

  setItem(data) {
    this.data = data;
    const st = this.store.state;
    const set = (patch) => this.store.set(patch);
    const focusKey = this.root.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
    const scroller = this.root.closest('.sidebar');
    const scrollTop = scroller ? scroller.scrollTop : 0;
    clear(this.root);
    const c = this.c = {};

    c.pointsSw = makeSwitch({ label: 'Show points', hideLabel: true, checked: st.showPoints, onChange: (v) => set({ showPoints: v }) });
    const gP = group('Points', { switchEl: c.pointsSw.el });
    const colorOpts = data.attributes.map((a) => ({ value: a.name, label: a.label || a.name }));
    colorOpts.push({ value: 'single', label: 'Single color' });
    c.colorBy = makeSelect({ label: 'Color by', options: colorOpts, value: st.colorBy, onChange: (v) => set({ colorBy: v }) });
    c.single = h('input', { type: 'color', 'aria-label': 'Point color', value: st.singleColor });
    c.single.addEventListener('input', () => set({ singleColor: c.single.value }));
    c.singleRow = h('div', { class: 'field field-inline' }, h('span', { class: 'field-label' }, 'Color'), c.single);
    c.size = makeRange({ label: 'Point size', min: 0.5, max: 8, step: 0.5, value: st.pointSize, format: (v) => `${v} px`, onInput: (v) => set({ pointSize: v }) });
    c.atten = makeSwitch({ label: 'Grow when zooming in', checked: st.attenuate, onChange: (v) => set({ attenuate: v }) });
    c.pop = makeRange({ label: 'Opacity', min: 0.1, max: 1, step: 0.05, value: st.pointOpacity, format: (v) => v.toFixed(2), onInput: (v) => set({ pointOpacity: v }) });
    this.steps = budgetSteps(Math.max(1, data.pointCount));
    c.budget = makeRange({
      label: 'Points drawn', min: 0, max: this.steps.length - 1, step: 1, value: this.budgetIndex(st.budget),
      format: (i) => this.budgetText(this.stepValue(i)), onInput: (i) => set({ budget: this.stepValue(i) }),
    });
    c.budget.setText(this.budgetText(st.budget));
    gP.body.append(c.colorBy.el, c.singleRow, c.size.el, c.atten.el, c.pop.el, c.budget.el);
    if (data.previewCap) {
      const of = data.fullPointCount > data.pointCount ? ` (uniform subsample of ${fmtMillions(data.fullPointCount)})` : '';
      gP.body.appendChild(hint(`Preview version: at most ${capText(data.previewCap)} points are selectable${of}.`));
    } else if (data.fullPointCount > data.pointCount) {
      gP.body.appendChild(hint(`Included here: ${fmtMillions(data.pointCount)} of the ${fmtMillions(data.fullPointCount)} points (uniform subsample).`));
    }
    if (data.attributes.some((a) => a.name === 'ground')) {
      c.ground = makeSwitch({ label: 'Hide removed ground points', checked: st.hideGround, onChange: (v) => set({ hideGround: v }) });
      gP.body.append(c.ground.el, hint('Ground removal: the models do not use the points less than 1 m above the terrain; they are drawn gray.'));
    }

    c.voxSw = makeSwitch({ label: 'Show partial LAI', hideLabel: true, checked: st.showVoxels, onChange: (v) => set({ showVoxels: v }) });
    const gV = group('Partial LAI', { switchEl: c.voxSw.el, key: 'lai-voxels' });
    c.voxSrc = makeSelect({ label: 'Source', options: this.sourceOptions(st), value: '', onChange: (v) => this.pickVoxelSource(v) });
    c.thr = makeRange({
      label: 'Hide voxels below', min: 0, max: 0.5, step: 0.01, value: st.threshold,
      format: (v) => this.thresholdText(v), onInput: (v) => set(this.api.thresholdInfo().error ? { errThreshold: v } : { threshold: v }),
    });
    c.vop = makeRange({ label: 'Opacity', min: 0.1, max: 1, step: 0.05, value: st.voxOpacity, format: (v) => v.toFixed(2), onInput: (v) => set({ voxOpacity: v }) });
    c.vst = makeSegmented({ name: 'vst', label: 'Voxel style', options: [{ value: 'solid', label: 'Solid' }, { value: 'glass', label: 'Glass' }], value: st.voxStyle, onChange: (v) => set({ voxStyle: v }) });
    const lmaps = [{ value: 'fade_greens', label: 'Fading green' }, { value: 'viridis', label: 'Viridis' }];
    c.vmap = makeSegmented({ name: 'vmap', label: 'Partial LAI color map', options: lmaps, value: st.voxMap, onChange: (v) => set({ voxMap: v }) });
    mapButtons(c.vmap.el);
    c.scale = makeSegmented({ name: 'scale', label: 'Color scale', options: [{ value: 'shared', label: 'All layers' }, { value: 'layer', label: 'Per layer' }], value: st.scaleMode, onChange: (v) => set({ scaleMode: v }) });
    gV.body.append(c.voxSrc.el, c.thr.el, c.vop.el,
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Style'), c.vst.el),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Color map'), c.vmap.el),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Color scale'), c.scale.el));

    c.rasSw = makeSwitch({ label: 'Show total LAI', hideLabel: true, checked: st.showRaster, onChange: (v) => set({ showRaster: v }) });
    const gR = group('Total LAI', { switchEl: c.rasSw.el, key: 'lai-raster' });
    c.link = makeSwitch({ label: 'Follow the partial LAI source', checked: !st.rasterSrc, onChange: (v) => set({ rasterSrc: v ? null : this.currentVoxelKey() }) });
    c.rasSrc = makeSelect({ label: 'Source', options: this.sourceOptions(st), value: '', onChange: (v) => set({ rasterSrc: v }) });
    c.rop = makeRange({ label: 'Opacity', min: 0.1, max: 1, step: 0.05, value: st.rasterOpacity, format: (v) => v.toFixed(2), onInput: (v) => set({ rasterOpacity: v }) });
    c.rmap = makeSegmented({ name: 'rmap', label: 'Total LAI color map', options: lmaps, value: st.rasterMap, onChange: (v) => set({ rasterMap: v }) });
    mapButtons(c.rmap.el);
    const cell = `${data.grid.cell} m × ${data.grid.cell} m`;
    gR.body.append(hint(`Total LAI of each ${cell} prediction column (sum of its profile), drawn on the ground.`), c.link.el, c.rasSrc.el, c.rop.el,
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Color map'), c.rmap.el));


    const gH = group('Helpers');
    c.grid = makeSwitch({ label: 'Column grid', checked: st.showGrid, onChange: (v) => set({ showGrid: v }) });
    const kinds = new Set(data.markers.map((m) => m.type));
    c.markers = makeSwitch({ label: 'Markers', checked: st.showMarkers, onChange: (v) => set({ showMarkers: v }) });
    gH.body.append(c.grid.el, c.markers.el);
    if (kinds.has('circle')) {
      c.wall = makeSwitch({ label: 'Canopy cylinder', checked: st.showWall ?? true, onChange: (v) => set({ showWall: v }) });
      gH.body.appendChild(c.wall.el);
    }
    if (data.terrain) {
      c.terrain = makeSwitch({ label: 'Terrain', checked: !!st.showTerrain, onChange: (v) => set({ showTerrain: v }) });
      gH.body.appendChild(c.terrain.el);
    }
    c.axes = makeSwitch({ label: 'Axes', checked: st.showAxes, onChange: (v) => set({ showAxes: v }) });
    gH.body.appendChild(c.axes.el);

    this.root.append(gP.el, gV.el, gR.el, gH.el);
    this.sync(st);
    if (scroller) scroller.scrollTop = scrollTop;
    if (focusKey) {
      const el = [...this.root.querySelectorAll('[data-focus-key]')].find((x) => x.dataset.focusKey === focusKey);
      if (el) {
        el.focus({ preventScroll: true });
        el.scrollIntoView({ block: 'nearest' });
      }
    }
  }

  stepValue(i) {
    return i >= this.steps.length - 1 ? Infinity : this.steps[i];
  }

  budgetIndex(n) {
    if (!(n < (this.data ? this.data.pointCount : 0))) return this.steps.length - 1;
    let best = 0;
    for (let i = 0; i < this.steps.length; i++) if (Math.abs(this.steps[i] - n) < Math.abs(this.steps[best] - n)) best = i;
    return best;
  }

  budgetText(n) {
    const total = this.data ? this.data.pointCount : 0;
    if (n >= total) return `all ${fmtMillions(total)} points`;
    return `${fmtMillions(n)} of ${fmtMillions(total)} points`;
  }

  thresholdText(v) {
    const info = this.api.thresholdInfo();
    if (info.error) return `${fmt(v * info.max, 2)} (${Math.round(v * 100)} % of max)`;
    return `${v.toFixed(2)} LAI`;
  }

  currentVoxelKey() {
    return this.api.voxelKey();
  }

  sourceOptions(st) {
    const opts = this.data.sourceOptions((l) => inSeries(this.data, st, l));
    this.sourceCount = opts.length;
    return opts.length ? opts : [{ value: '', label: 'No model layer for this view', disabled: true }];
  }

  refreshSources(st) {
    if (!this.c) return;
    const opts = this.sourceOptions(st);
    this.c.voxSrc.setOptions(opts);
    this.c.rasSrc.setOptions(opts);
  }

  pickVoxelSource(v) {
    const [type, ...rest] = v.split(':');
    const id = rest.join(':');
    if (type === 'layer') this.store.set({ ...activatePatch(this.data, this.store.state, id), voxMode: 'value' });
    else if (type === 'error') this.store.set({ active: id, voxMode: 'error' });
    else if (type === 'raw') this.store.set({ active: id, voxMode: 'raw' });
    else this.store.set({ voxMode: v });
  }

  sync(st) {
    const c = this.c;
    if (!c) return;
    c.pointsSw.input.checked = st.showPoints;
    c.colorBy.set(st.colorBy);
    c.singleRow.hidden = st.colorBy !== 'single';
    c.single.value = st.singleColor;
    c.size.set(st.pointSize);
    c.atten.input.checked = st.attenuate;
    c.pop.set(st.pointOpacity);
    c.budget.set(this.budgetIndex(st.budget));
    c.budget.setText(this.budgetText(st.budget));
    if (c.ground) c.ground.input.checked = st.hideGround;
    c.voxSw.input.checked = st.showVoxels;
    c.voxSrc.set(this.api.voxelKey());
    c.voxSrc.select.disabled = !this.sourceCount;
    const err = this.api.thresholdInfo().error;
    c.thr.el.querySelector('label').textContent = err ? 'Hide |prediction − label| below' : 'Hide voxels below';
    c.thr.input.max = err ? '0.6' : '0.5';
    c.thr.set(err ? st.errThreshold : st.threshold);
    c.vop.set(st.voxOpacity);
    c.vst.set(st.voxStyle);
    c.vmap.set(st.voxMap);
    c.rmap.set(st.rasterMap);
    c.scale.set(st.scaleMode);
    c.rasSw.input.checked = st.showRaster;
    c.link.input.checked = !st.rasterSrc;
    c.link.input.disabled = !this.sourceCount;
    c.rasSrc.set(st.rasterSrc || this.api.rasterKey());
    c.rasSrc.select.disabled = !st.rasterSrc || !this.sourceCount;
    c.rop.set(st.rasterOpacity);
    c.grid.input.checked = st.showGrid;
    c.markers.input.checked = st.showMarkers;
    if (c.wall) c.wall.input.checked = st.showWall !== false;
    if (c.terrain) c.terrain.input.checked = !!st.showTerrain;
    c.axes.input.checked = st.showAxes;
  }
}

const TRANSECT_FOLDED = 'lai-transect-folded';

export class FoldPanel {
  constructor(root, opts) {
    this.root = root;
    this.body = opts.body;
    this.key = opts.key;
    this.what = opts.what;
    this.chosen = false;
    this.toggle = h('button', {
      type: 'button', class: 'fold-toggle', 'aria-controls': this.body.id,
      onclick: () => this.setFolded(!this.folded, true),
    }, icon('chevron', { size: 14, class: 'chev' }), h('span', {}, opts.title));
    root.insertBefore(h('div', { class: 'fold-head' }, this.toggle), this.body);
    const saved = storage.get(this.key, null);
    this.setFolded(typeof saved === 'boolean' ? saved : opts.phone.matches);
    opts.phone.addEventListener('change', () => {
      if (!this.chosen && typeof storage.get(this.key, null) !== 'boolean') this.setFolded(opts.phone.matches);
    });
  }

  setFolded(folded, remember = false) {
    if (folded && this.body.contains(document.activeElement)) this.toggle.focus({ preventScroll: true });
    this.folded = folded;
    this.root.classList.toggle('folded', folded);
    this.toggle.setAttribute('aria-expanded', String(!folded));
    this.toggle.title = folded ? `Show ${this.what}` : `Fold ${this.what}`;
    this.body.hidden = folded;
    if (remember) {
      this.chosen = true;
      storage.set(this.key, folded);
    }
  }
}

const VIEWS_FOLDED = 'lai-views-folded';

const VIEW_BUTTONS = [
  { preset: 'alongX', letter: ['E', '+x'], title: ['East: from the east, looking west', '+x: from the +x side, looking toward −x'] },
  { preset: 'west', letter: ['W', '−x'], title: ['West: from the west, looking east', '−x: from the −x side, looking toward +x'] },
  { preset: 'north', letter: ['N', '+y'], title: ['North: from the north, looking south', '+y: from the +y side, looking toward −y'] },
  { preset: 'side', letter: ['S', '−y'], title: ['South: from the south, looking north', '−y: from the −y side, looking toward +y'] },
  { preset: 'top', icon: 'viewTop', title: 'Top: from above' },
  { preset: 'bottom', icon: 'viewBottom', title: 'Bottom: from below' },
  { preset: 'oblique', icon: 'oblique', title: 'Isometric front: the start view' },
  { preset: 'obliqueBack', icon: 'isoBack', title: 'Isometric back: the start view from the opposite side' },
];

export class ViewsPanel {
  constructor(root, api) {
    this.root = root;
    this.api = api;
    this.chosen = false;
    root.hidden = true;
    this.toggle = h('button', {
      type: 'button', class: 'views-toggle', 'aria-controls': 'views-body',
      onclick: () => this.setFolded(!this.folded, true),
    }, icon('chevron', { size: 14, class: 'chev' }), h('span', {}, 'Views'));
    this.buttons = VIEW_BUTTONS.map((v) => h('button', {
      type: 'button', class: 'views-btn', 'aria-pressed': 'false', dataset: { view: v.preset },
      onclick: () => this.api.show(v.preset),
    }, v.icon ? icon(v.icon, { size: 18 }) : h('span', { class: 'views-letter', 'aria-hidden': 'true' })));
    this.dirs = VIEW_BUTTONS.map((v) => presetDir(v.preset));
    this.body = h('div', { class: 'views-grid', id: 'views-body' }, this.buttons);
    root.append(h('div', { class: 'views-head' }, this.toggle), this.body);
    this.setLabels(true);
    const saved = storage.get(VIEWS_FOLDED, null);
    this.setFolded(typeof saved === 'boolean' ? saved : api.phone.matches);
    api.phone.addEventListener('change', () => {
      if (!this.chosen && typeof storage.get(VIEWS_FOLDED, null) !== 'boolean') this.setFolded(api.phone.matches);
    });
  }

  setLabels(geo) {
    const k = geo ? 0 : 1;
    VIEW_BUTTONS.forEach((v, i) => {
      const b = this.buttons[i];
      const title = Array.isArray(v.title) ? v.title[k] : v.title;
      if (v.letter) b.firstChild.textContent = v.letter[k];
      b.title = title;
      b.setAttribute('aria-label', title);
    });
  }

  setFolded(folded, remember = false) {
    if (folded && this.body.contains(document.activeElement)) this.toggle.focus({ preventScroll: true });
    this.folded = folded;
    this.root.classList.toggle('folded', folded);
    this.toggle.setAttribute('aria-expanded', String(!folded));
    this.toggle.title = folded ? 'Show the view buttons' : 'Fold the view buttons';
    this.body.hidden = folded;
    if (remember) {
      this.chosen = true;
      storage.set(VIEWS_FOLDED, folded);
    }
  }

  setItem(data) {
    this.setLabels(axisLetters(data).x === 'E');
    this.root.hidden = false;
  }

  clear() {
    if (this.root.contains(document.activeElement)) document.activeElement.blur();
    this.root.hidden = true;
  }

  update(dir) {
    const cos = Math.cos((0.5 * Math.PI) / 180);
    this.dirs.forEach((d, i) => {
      const on = String(d.dot(dir) > cos);
      if (this.buttons[i].getAttribute('aria-pressed') !== on) this.buttons[i].setAttribute('aria-pressed', on);
    });
  }
}

export class TransectPanel {
  constructor(root, store, api) {
    this.root = root;
    this.store = store;
    this.api = api;
    this.data = null;
    this.rows = {};
    this.rowsKey = '';
    this.chosen = false;
    root.hidden = true;
    this.dot = h('span', { class: 'transect-dot', hidden: true }, h('span', { class: 'sr-only' }, ' (transect active)'));
    this.toggle = h('button', {
      type: 'button', class: 'transect-toggle', 'aria-controls': 'transect-body', dataset: { focusKey: 'clip:toggle' },
      onclick: () => this.setFolded(!this.folded, true),
    }, icon('chevron', { size: 14, class: 'chev' }), h('span', {}, 'Transect'), this.dot);
    this.reset = h('button', {
      type: 'button', class: 'icon-btn transect-reset', hidden: true, dataset: { focusKey: 'clip:reset' },
      'aria-label': 'Reset the transect', title: 'Reset the transect (show all data)',
      onclick: () => this.store.set({ xRange: null, yRange: null, zRange: null }),
    }, icon('close', { size: 14 }));
    this.list = h('div', { class: 'transect-rows' });
    this.readout = h('p', { class: 'transect-readout', hidden: true });
    this.body = h('div', { class: 'transect-body', id: 'transect-body' }, this.list, this.readout);
    root.append(h('div', { class: 'transect-head' }, this.toggle, this.reset), this.body);
    const b = this.body;
    const more = () => b.classList.toggle('more', b.scrollHeight - b.scrollTop - b.clientHeight > 1);
    b.addEventListener('scroll', more, { passive: true });
    const ro = new ResizeObserver(more);
    for (const el of [b, this.list, this.readout]) ro.observe(el);
    const saved = storage.get(TRANSECT_FOLDED, null);
    this.setFolded(typeof saved === 'boolean' ? saved : api.phone.matches);
    api.phone.addEventListener('change', () => {
      if (!this.chosen && typeof storage.get(TRANSECT_FOLDED, null) !== 'boolean') this.setFolded(api.phone.matches);
    });
  }

  setFolded(folded, remember = false) {
    if (folded && this.body.contains(document.activeElement)) this.toggle.focus({ preventScroll: true });
    this.folded = folded;
    this.root.classList.toggle('folded', folded);
    this.toggle.setAttribute('aria-expanded', String(!folded));
    this.toggle.title = folded ? 'Show the transect sliders' : 'Fold the transect sliders';
    this.body.hidden = folded;
    if (remember) {
      this.chosen = true;
      storage.set(TRANSECT_FOLDED, folded);
    }
    if (this.data) this.sync(this.store.state);
  }

  setItem(data) {
    this.data = data;
    const names = axisNames(data);
    const letters = axisLetters(data);
    const axes = AXES.map((axis) => ({ axis, n: axisSize(data, axis), label: names[axis], short: letters[axis], title: axisTitle(data, axis) }));
    const key = JSON.stringify(axes);
    if (key !== this.rowsKey) {
      const focusKey = this.root.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
      this.rowsKey = key;
      clear(this.list);
      for (const { axis, n, label, short, title } of axes) {
        const range = RANGE_KEYS[axis];
        this.rows[axis] = makeDualRange({
          label, short, title, n, value: [0, n - 1], focusKey: `clip:${axis}`,
          text: (lo, hi) => rangeText(this.data, axis, normRange([lo, hi], n)),
          edgeText: (e) => edgeText(this.data, axis, e),
          onChange: (lo, hi) => this.store.set({ [range]: normRange([lo, hi], n) || null }),
        });
        this.list.appendChild(this.rows[axis].el);
      }
      if (focusKey) {
        const el = [...this.root.querySelectorAll('[data-focus-key]')].find((x) => x.dataset.focusKey === focusKey);
        if (el) el.focus({ preventScroll: true });
      }
    }
    this.root.hidden = false;
    this.sync(this.store.state);
  }

  clear() {
    if (this.root.contains(document.activeElement)) document.activeElement.blur();
    this.data = null;
    this.root.hidden = true;
  }

  sync(st) {
    const d = this.data;
    if (!d) return;
    const names = axisNames(d);
    const full = [];
    for (const axis of AXES) {
      const n = axisSize(d, axis);
      const r = normRange(st[RANGE_KEYS[axis]], n);
      this.rows[axis].set(...(r || [0, n - 1]));
      if (r) full.push(`${names[axis]} ${rangeText(d, axis, r)}`.replace(/\u00a0/g, ' '));
    }
    const clipped = full.length > 0;
    if (!clipped && document.activeElement === this.reset) this.toggle.focus({ preventScroll: true });
    this.reset.hidden = !clipped;
    this.dot.hidden = !(clipped && this.folded);
    this.readout.hidden = !clipped;
    const summary = clipSummary(d, st);
    if (this.readout.textContent !== summary) {
      clear(this.readout);
      for (const [i, part] of (summary ? summary.split(' · ') : []).entries()) {
        if (i) this.readout.append(' · ');
        this.readout.appendChild(h('span', {}, part));
      }
    }
    this.readout.title = clipped ? `${full.join('\n')}\nThe chart and the totals cover all data.` : '';
  }
}

export class ModelsPanel {
  constructor(root, store, api = {}) {
    this.root = root;
    this.store = store;
    this.api = api;
    this.data = null;
    this.descOpen = false;
    root.appendChild(hint('The models appear once a stand or date is open.'));
  }

  setItem(data) {
    this.data = data;
    this.render(this.store.state);
  }

  catalogItem() {
    const cat = this.api.catalog ? this.api.catalog() : null;
    return cat && this.data ? cat.byId.get(this.data.id) || null : null;
  }

  render(st) {
    const data = this.data;
    if (!data) return;
    const focusKey = this.root.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
    clear(this.root);
    if (hasSeriesChoice(data)) this.root.appendChild(this.seriesControl(st));
    const gap = seriesGap(data, st, this.catalogItem());
    if (gap) this.root.appendChild(this.notice(gap));
    const left = gap ? '' : heldOutNote(data, st, this.catalogItem());
    if (left) this.root.appendChild(hint(left));
    const models = data.models.filter((l) => inSeries(data, st, l));
    const hiddenTiers = models.filter((l) => l.tier > 2).length;
    if (hiddenTiers && models.some((l) => l.tier <= 2)) {
      const sw = makeSwitch({ label: 'Show side experiments', checked: st.showAllTiers, onChange: (v) => this.store.set({ showAllTiers: v }) });
      sw.input.dataset.focusKey = 'tiers';
      sw.el.title = `${hiddenTiers} more model${hiddenTiers === 1 ? '' : 's'} from the paper’s side experiments`;
      this.root.appendChild(sw.el);
    }
    const vis = visibleLayerIds(data, st);
    if (vis.size) this.root.appendChild(hint('Click a row to show its partial and total LAI. The eye hides it from the profile chart.'));
    const calibrated = data.calibrated.filter((l) => inSeries(data, st, l));
    if (calibrated.length) {
      this.root.appendChild(hint('Rows marked “calibrated” (hatched swatch): the model scaled to its calibrated mean LAI of the canopy cylinder; the eye draws its dashed line in the chart.'));
    }
    const sections = [];
    if (data.truth) sections.push({ label: 'Label', layers: [data.truth] });
    sections.push(...groupedLayers(data, st));
    for (const sec of sections) {
      const layers = sec.layers.filter((l) => vis.has(l.id));
      if (!layers.length) continue;
      const ul = h('ul', { class: 'model-list' });
      for (const l of layers) {
        ul.appendChild(this.row(l, st));
        if (l.cal && vis.has(l.cal.id)) ul.appendChild(this.calRow(l.cal, st));
      }
      this.root.appendChild(h('section', { class: 'model-group' }, h('h3', { class: 'group-title' }, sec.label), ul));
    }
    if (focusKey) {
      const find = (key) => [...this.root.querySelectorAll('[data-focus-key]')].find((x) => x.dataset.focusKey === key);
      const el = find(focusKey) || (focusKey === 'update' ? find(`series:${effectiveSeries(data, st)}`) : null);
      if (el) el.focus({ preventScroll: true });
    }
  }

  seriesControl(st) {
    const d = this.data;
    const cur = currentSeries(d, st);
    const seg = makeSegmented({
      name: 'series', label: 'Model series', value: effectiveSeries(d, st),
      options: d.seriesList.map((s) => ({ value: s.key, label: s.short })),
      onChange: (key) => this.store.set(seriesPatch(this.data, this.store.state, key)),
    });
    for (const b of seg.el.querySelectorAll('.seg-btn')) {
      b.dataset.focusKey = `series:${b.dataset.value}`;
      b.title = d.seriesList.find((s) => s.key === b.dataset.value)?.label || '';
    }
    const box = h('div', { class: 'series-ctl' }, h('span', { class: 'field-label', 'aria-hidden': 'true' }, 'Model series'), seg.el);
    if (cur && cur.description) {
      const desc = h('details', { class: 'series-desc', open: this.descOpen },
        h('summary', { dataset: { focusKey: 'series-desc' } }, cur.description));
      desc.addEventListener('toggle', () => { this.descOpen = desc.open; });
      box.appendChild(desc);
    }
    return box;
  }

  notice(gap) {
    const d = this.data;
    const cat = this.api.catalog ? this.api.catalog() : null;
    const s = () => seriesName(gap.series.short);
    const text = [];
    let action = null;
    if (gap.kind === 'none') {
      const what = d.kind === 'synthetic' ? 'stand' : 'view';
      if (gap.heldBy.length) {
        const holders = gap.heldBy.flatMap((x, i) => [i ? ' and ' : '', seriesName(x.short)]);
        text.push('No ', s(), ` model was evaluated on this ${what}: it is a test stand of the `, holders, ' models. ',
          'The list shows the test stands of the ', s(), ' models.');
      } else text.push('No ', s(), ` model was evaluated on this ${what}.`);
    } else {
      const names = gap.missing.map((k) => (cat && cat.models[k] && cat.models[k].label) || k);
      const series = hasSeriesChoice(d) ? [s(), ' '] : [];
      if (gap.kind === 'unknown') text.push('No ', ...series, 'model is available here.');
      else if (gap.have) text.push(`${names.length === 1 ? 'One' : names.length} `, ...series, `model${names.length === 1 ? ' is' : 's are'} missing here (${names.join(', ')}).`);
      else text.push('The ', ...series, 'models are missing here.');
      if (cat && cat.canPrepare && this.api.update) {
        const updating = () => !!(this.api.updating && this.api.updating(d.id));
        action = h('button', {
          type: 'button', class: 'btn btn-small', 'aria-disabled': updating() ? 'true' : null, dataset: { focusKey: 'update' },
          title: OPERATOR.updateTitle,
          onclick: () => { if (!updating()) this.api.update(d.id); },
        }, icon('retry', { size: 14 }), updating() ? 'Updating…' : 'Update');
      } else if (cat && cat.mode === 'server') text.push(` ${OPERATOR.rebuildStale}`);
    }
    return h('div', { class: `series-notice${gap.kind === 'none' ? '' : ' stale'}`, role: 'note' }, h('p', {}, text), action);
  }

  activate(id) {
    this.store.set(activatePatch(this.data, this.store.state, id));
  }

  eye(l, hidden) {
    return h('button', {
      type: 'button', class: 'icon-btn eye', 'aria-pressed': String(!hidden),
      'aria-label': `${hidden ? 'Show' : 'Hide'} ${l.label} in the profile chart`,
      dataset: { focusKey: `eye:${l.id}` },
      onclick: () => this.store.set(chartTogglePatch(this.data, this.store.state, l.id)),
    }, icon(hidden ? 'eyeOff' : 'eye', { size: 16 }));
  }

  row(l, st) {
    const active = l.id === st.active;
    const hidden = chartHidden(l, st);
    const stats = this.data.stats(l.id);
    const badges = [];
    const main = h('button', {
      type: 'button', class: 'model-main', 'aria-pressed': String(active),
      title: l.notes ? `${l.label}\n${l.notes}` : l.label, dataset: { focusKey: `main:${l.id}` },
      onclick: () => this.activate(l.id),
    },
    h('span', { class: `swatch${l.kind === 'truth' ? ' swatch-truth' : ''}`, style: l.kind === 'truth' ? {} : { background: l.color }, 'aria-hidden': 'true' }),
    h('span', { class: 'model-text' }, h('span', { class: 'model-label' }, l.label), badges.length ? h('span', { class: 'model-badges' }, badges) : null),
    h('span', { class: 'model-value', title: 'Mean total LAI of the prediction columns' }, fmt(stats.mean, 2)));
    return h('li', { class: `model-row${active ? ' active' : ''}${hidden ? ' muted' : ''}` }, main, this.eye(l, hidden));
  }

  calRow(l, st) {
    const active = l.id === st.active;
    const hidden = chartHidden(l, st);
    const main = h('button', {
      type: 'button', class: 'model-main', 'aria-pressed': String(active),
      title: l.notes, dataset: { focusKey: `main:${l.id}` },
      onclick: () => this.activate(l.id),
    },
    h('span', { class: 'swatch swatch-cal', style: { '--c': l.color }, 'aria-hidden': 'true' }),
    h('span', { class: 'model-text' }, h('span', { class: 'model-label' },
      h('span', { class: 'sr-only' }, `${l.base.label} `), 'calibrated',
      l.clipped ? [' ', h('span', { class: 'badge badge-warn', title: 'Calibrated value ≤ 0, shown as 0' }, 'shown as 0')] : null)),
    h('span', { class: 'model-value', title: 'Calibrated mean LAI of the canopy cylinder (slope × value + offset)' }, fmt(l.calValue, 2)));
    return h('li', { class: `model-row model-sub${active ? ' active' : ''}${hidden ? ' muted' : ''}` }, main, this.eye(l, hidden));
  }
}

export class DetailsPanel {
  constructor(els, store) {
    this.els = els;
    this.store = store;
    this.data = null;
    this.chart = new ProfileChart(els.chart, {
      onToggle: (id) => { if (this.data) this.store.set(chartTogglePatch(this.data, this.store.state, id)); },
    });
  }

  setItem(data) {
    this.data = data;
    this.renderInfo(this.store.state);
    this.update(this.store.state);
  }

  update(st) {
    if (!this.data) return;
    if (effectiveSeries(this.data, st) !== this.infoSeries) this.renderInfo(st);
    this.renderChart(st);
    this.renderTotals(st);
  }

  renderChart(st) {
    const d = this.data;
    const fp = st.footprint && d.inMask(st.footprint[0], st.footprint[1]) ? st.footprint : null;
    const vis = visibleLayerIds(d, st);
    const series = [];
    const ordered = [d.truth, ...groupedLayers(d, st).flatMap((g) => g.layers)].filter(Boolean);
    for (const l of ordered) {
      if (!vis.has(l.id) || !l.profile) continue;
      series.push({
        id: l.id, label: l.label, color: l.color, kind: l.kind, active: l.id === st.active,
        hidden: st.hiddenLayers.includes(l.id), values: d.profile(l.id, fp),
      });
      const c = l.cal;
      if (c && c.profile && vis.has(c.id) && !chartHidden(c, st)) {
        series.push({
          id: c.id, label: c.label, legend: c.short, color: c.color, kind: 'model', dashed: true, dash: CAL_DASH,
          active: c.id === st.active, hidden: false, values: d.profile(c.id, fp),
        });
      }
      if (st.voxMode === 'raw' && l.id === st.active && l.profileRaw) {
        const rawId = `${l.id}:raw`;
        series.push({
          id: rawId, label: `${l.label} · profile without rescaling`, color: l.color, kind: 'model', dashed: true,
          hidden: st.hiddenLayers.includes(rawId), values: rawProfile(d, l, fp),
        });
      }
    }
    const { dz, nz } = d.grid;
    const yMax = Math.min(nz * dz, Math.max(6, Math.ceil((d.canopyTop() + 2) / dz - 1e-9) * dz));
    const kTop = Math.round(yMax / dz);
    const above = [];
    for (const se of series) {
      if (se.hidden || !se.values) continue;
      let s = 0;
      for (let k = kTop; k < se.values.length; k++) if (Number.isFinite(se.values[k])) s += se.values[k];
      if (s >= 0.01) above.push(`${se.label} ${fmt(s, 2)}`);
    }
    const cue = seriesCue(d, st);
    const cell = `${d.grid.cell} m × ${d.grid.cell} m`;
    const cyl = d.cylinder ? ` of the canopy cylinder (radius ${fmt(d.cylinder.radius_m, 1)} m)` : '';
    const sub = fp ? `${cell} · ground at ${fmt(d.groundAt(fp[0], fp[1]), 2).replace('-', '−')} m`
      : `${cell} columns${cyl}; ${dz} m height bins`;
    const zr = normRange(st.zRange, axisSize(d, 'z'));
    this.chart.update({
      title: fp ? `Prediction column (${fp[0]}, ${fp[1]})` : `Mean profile over the ${d.maskCount} prediction columns`,
      sub: cue ? `${cue.charAt(0).toUpperCase()}${cue.slice(1)} · ${sub}` : sub,
      dz, yMax, xLabel: `Partial LAI per ${dz} m height bin [m² m⁻²]`, series,
      select: zr ? [zr[0] * dz, (zr[1] + 1) * dz] : null,
      note: series.length ? (above.length ? `Above ${yMax} m (not drawn): ${above.join(' · ')} LAI.` : '')
        : 'No model profile for this view.',
    });
    this.els.back.hidden = !fp;
  }

  renderTotals(st) {
    const d = this.data;
    const el = this.els.totals;
    clear(el);
    const fp = st.footprint && d.inMask(st.footprint[0], st.footprint[1]) ? st.footprint : null;
    const vis = visibleLayerIds(d, st);
    const hasTruth = !!(d.truth && d.truth.total);
    const calModel = d.models.find((l) => l.calibration && inSeries(d, st, l));
    const hasCal = !!calModel || d.baselines.some((b) => validCalibration(b.calibration));
    const cue = seriesCue(d, st);
    el.appendChild(h('div', { class: 'totals-head' }, h('h3', {}, fp ? `Total LAI of prediction column (${fp[0]}, ${fp[1]})` : 'Total LAI',
      cue ? h('span', { class: 'series-cue' }, ' · ', seriesName(cue)) : null)));
    const cols = hasCal ? ['Layer', 'Uncalibrated', 'Calibrated'] : ['Layer', fp ? 'Total' : 'Mean'];
    if (hasTruth) cols.push(...(fp ? [['Prediction', h('br'), '− label']] : ['Bias', ['MAE', h('sub', {}, '1:1')]]));
    const thead = h('thead', {}, h('tr', {}, cols.map((c, i) => h('th', { scope: 'col', class: i ? 'num' : '' }, c))));
    const tbody = h('tbody');
    const ordered = [d.truth, ...groupedLayers(d, st).flatMap((g) => g.layers)].filter(Boolean);
    const calCell = hasCal ? 1 : -1;
    for (const l of ordered) {
      if (!vis.has(l.id) || !l.total) continue;
      const activeCal = !!(l.cal && l.cal.id === st.active);
      const active = l.id === st.active || activeCal;
      const cells = [];
      let title = l.notes || '';
      if (fp) {
        const v = d.totalAt(l.id, fp);
        cells.push(fmt(v, 2));
        if (hasCal) cells.push(l.cal ? fmt(d.totalAt(l.cal.id, fp), 2) : '–');
        if (hasTruth) cells.push(l.kind === 'truth' ? '' : fmtSigned(v - d.totalAt(d.truth.id, fp), 2));
      } else {
        const s = d.stats(l.id);
        cells.push(fmt(s.mean, 2));
        if (hasCal) cells.push(fmt(calibratedValue(l.calibration, l.itemValue), 2));
        if (hasTruth) cells.push(l.kind === 'truth' ? '' : fmtSigned(s.bias, 2), l.kind === 'truth' ? '' : fmt(s.mae, 2));
        if (l.itemValue !== null && s.mean !== null && Math.abs(l.itemValue - s.mean) > 0.005) title = `${title}${title ? '\n' : ''}Mean LAI of the canopy cylinder in the paper’s evaluation: ${fmt(l.itemValue, 2)}`;
      }
      if (hasCal && l.cal && l.cal.clipped) title = `${title}${title ? '\n' : ''}Calibrated value ≤ 0: the calibrated layer is shown as 0.`;
      tbody.appendChild(h('tr', { class: `${active ? 'active' : ''}${l.kind === 'truth' ? ' truth' : ''}`, title: title || null },
        h('th', { scope: 'row' }, h('span', { class: 'row-head' }, h('span', { class: `swatch${l.kind === 'truth' ? ' swatch-truth' : ''}`, style: l.kind === 'truth' ? {} : { background: l.color }, 'aria-hidden': 'true' }), h('span', { class: 'row-name' }, l.label))),
        cells.map((c, i) => h('td', { class: `num${active && (i === calCell) === activeCal ? ' active-cell' : ''}` }, c))));
    }
    if (!fp) {
      const extra = [
        ...d.references.map((r) => ({ r, kind: 'Reference' })),
        ...d.baselines.map((r) => ({ r, kind: 'Baseline' })),
      ];
      if (extra.length) {
        tbody.appendChild(h('tr', { class: 'sep' }, h('th', { scope: 'rowgroup', colspan: cols.length }, 'Without a vertical profile')));
      }
      for (const { r, kind } of extra) {
        const val = Number.isFinite(r.value) ? fmt(r.value, 2) : '–';
        const note = r.value === null || r.value === undefined ? 'no value on this date' : (r.interpolated ? 'interpolated' : '');
        const row = h('tr', { class: 'ref', title: r.description || null },
          h('th', { scope: 'row' }, h('span', { class: 'row-head' },
            h('span', { class: `swatch ${kind === 'Reference' ? 'swatch-ref' : ''}`, style: r.color ? { background: r.color } : {}, 'aria-hidden': 'true' }),
            h('span', { class: 'row-name' }, r.label || r.key,
              h('span', { class: 'row-kind' }, kind === 'Reference' ? ' · field reference' : ' · baseline'),
              note ? h('span', { class: 'row-note' }, ` · ${note}`) : null))));
        let span = 1;
        if (hasCal && kind === 'Reference') {
          row.appendChild(h('td', { class: 'num span-both', colspan: 2 }, val));
          span = 2;
        } else {
          row.appendChild(h('td', { class: 'num' }, val));
          if (hasCal) {
            row.appendChild(h('td', { class: 'num' }, fmt(calibratedValue(r.calibration, r.value), 2)));
            span = 2;
          }
        }
        for (let i = 1 + span; i < cols.length; i++) row.appendChild(h('td', { class: 'num' }, ''));
        tbody.appendChild(row);
      }
    }
    el.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: `data-table totals${hasCal ? ' cal-cols' : ''}` }, thead, tbody)));
    const notes = [];
    if (hasTruth && !fp) {
      notes.push(['Bias = mean (prediction − label) and MAE', h('sub', {}, '1:1'),
        ` = mean |prediction − label| over the ${d.maskCount} prediction columns of this stand; the paper pools all test stands.`]);
    }
    if (!hasTruth && (d.kind === 'ecosense' || d.references.length || d.baselines.length)) {
      if (!fp && d.cylinder) notes.push(`Model values: ${hasCal ? '' : 'uncalibrated '}mean over the ${d.maskCount} prediction columns of the canopy cylinder.`);
      else if (!hasCal) notes.push('Model values are uncalibrated.');
    }
    if (hasCal) {
      const cal = calModel?.calibration || d.baselines.map((b) => validCalibration(b.calibration)).find(Boolean);
      const desc = cal && cal.description ? sentence(cal.description)
        : `Linear calibration to ${(cal && cal.target) || 'the field reference'}, fitted on the same observations it is evaluated on; defined for the mean LAI of the canopy cylinder only.`;
      notes.push(`Calibrated = slope × value + offset. ${desc} The calibrated layers scale partial and total LAI by one factor per method, so the profile’s shape is unchanged.`);
    }
    for (const n of notes) el.appendChild(h('p', { class: 'note' }, n));
  }

  renderInfo(st) {
    const d = this.data;
    const el = this.els.info;
    this.infoSeries = effectiveSeries(d, st);
    clear(el);
    const m = d.m;
    el.appendChild(h('h3', {}, 'About'));
    if (m.description) el.appendChild(h('p', { class: 'desc' }, m.description));
    const rows = Array.isArray(m.info) ? m.info.filter((r) => Array.isArray(r) && r.length >= 2) : [];
    const dl = h('dl', { class: 'info-list' });
    for (const [k, v] of rows) dl.append(h('dt', {}, String(k)), h('dd', {}, String(v)));
    for (const c of d.citations || []) {
      const link = c.doi ? h('a', { href: `https://doi.org/${c.doi}`, target: '_blank', rel: 'noopener noreferrer' }, `doi:${c.doi}`) : null;
      dl.append(h('dt', {}, c.role), h('dd', { class: 'cite' }, c.text, c.text && link ? ' · ' : null, link));
    }
    el.appendChild(dl);
  }
}

function rawProfile(d, l, fp) {
  const { nx, ny, nz } = d.grid;
  const out = new Float64Array(nz);
  if (fp) {
    const b = (fp[1] * nx + fp[0]) * nz;
    for (let k = 0; k < nz; k++) out[k] = l.profileRaw[b + k];
    return out;
  }
  const cnt = new Uint32Array(nz);
  for (let c = 0; c < nx * ny; c++) {
    if (!d.mask[c]) continue;
    for (let k = 0; k < nz; k++) {
      const v = l.profileRaw[c * nz + k];
      if (Number.isFinite(v)) { out[k] += v; cnt[k]++; }
    }
  }
  for (let k = 0; k < nz; k++) out[k] = cnt[k] ? out[k] / cnt[k] : NaN;
  return out;
}
