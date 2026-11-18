import { seriesOf, layerSeries, counterpartFrom, knownSeries, defaultSeriesKey, itemSeries } from './series.js';

const PCT = 0.98;

export const CAL_PREFIX = 'cal:';

function percentile(arrays, keep, abs = false, stride = 1) {
  let n = 0;
  for (const a of arrays) n += a.length;
  const vals = new Float32Array(n);
  let m = 0;
  for (const a of arrays) {
    for (let i = 0; i < a.length; i++) {
      if (keep && !keep(Math.floor(i / stride))) continue;
      let v = a[i];
      if (!Number.isFinite(v)) continue;
      if (abs) v = Math.abs(v);
      if (v > 1e-9) vals[m++] = v;
    }
  }
  if (!m) return 1;
  const s = vals.subarray(0, m).sort();
  return s[Math.min(m - 1, Math.floor(PCT * (m - 1)))] || 1;
}



export const DOI_RE = /^10\.\d{4,9}\/[^\s"<>]+$/;

export const DOI_PENDING = 'pending';

function citationsOf(entry, groups) {
  const group = entry && Array.isArray(groups) ? groups.find((g) => g && g.key === entry.group) : null;
  const list = group && Array.isArray(group.citations) ? group.citations : [];
  return list
    .map((c) => ({
      role: c && c.role ? String(c.role) : '',
      text: c && c.text ? String(c.text) : '',
      doi: c && typeof c.doi === 'string' && (DOI_RE.test(c.doi) || c.doi === DOI_PENDING) ? c.doi : '',
    }))
    .filter((c) => c.role && (c.text || c.doi));
}

function displayOrder(layers) {
  const groups = new Map();
  for (const l of layers) {
    const g = l.kind === 'truth' ? '' : l.groupLabel;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(l);
  }
  const rank = (g, ls) => (g === '' ? -Infinity : Math.min(...ls.map((l) => l.tier)));
  return [...groups.entries()].map(([g, ls], i) => ({ ls, r: rank(g, ls), i }))
    .sort((a, b) => a.r - b.r || a.i - b.i).flatMap((x) => x.ls);
}

export class ItemData {
  constructor(id, manifest, grids, context = {}) {
    this.id = id;
    this.m = manifest;
    this.kind = manifest.kind || 'item';
    this.label = manifest.label || id;
    this.short = manifest.short_label || this.label;
    this.grids = grids;
    this.seriesKeys = new Set((context.series || []).map((s) => s.key));
    this.catalogModels = context.models || {};
    this.citations = citationsOf(context.entry, context.groups);
    const g = manifest.grid || {};
    this.grid = {
      x0: +g.x0 || 0, y0: +g.y0 || 0, nx: g.nx | 0, ny: g.ny | 0,
      cell: +g.cell || 2, nz: g.nz | 0 || 25, dz: +g.dz || 2,
    };
    this.groundAt = this.makeGround(g.ground, this.grid);
    this.ground0 = g.ground && Number.isFinite(g.ground.z) ? +g.ground.z : 0;
    const { nx, ny } = this.grid;
    const maskArr = manifest.mask && grids.get(manifest.mask);
    this.mask = new Uint8Array(nx * ny);
    for (let i = 0; i < nx * ny; i++) {
      this.mask[i] = maskArr ? (maskArr.data[i] > 0.5 ? 1 : 0) : 1;
    }
    this.maskCount = this.mask.reduce((a, b) => a + b, 0);
    this.inMask = (ix, iy) => ix >= 0 && iy >= 0 && ix < nx && iy < ny && this.mask[iy * nx + ix] === 1;
    const rz = g.raster_z && grids.get(g.raster_z);
    this.rasterZ = rz && rz.data.length === nx * ny
      ? (ix, iy) => { const v = rz.data[iy * nx + ix]; return Number.isFinite(v) ? v : this.groundAt(ix, iy); }
      : this.groundAt;
    this.terrain = this.normaliseTerrain(manifest.terrain);

    this.layers = (manifest.layers || []).map((l) => this.normaliseLayer(l)).filter((l) => l.profile || l.total)
      .filter((l) => !this.seriesKeys.size || l.kind === 'truth' || !l.series || this.seriesKeys.has(l.series));
    this.layers = displayOrder(this.layers);
    this.layerById = new Map(this.layers.map((l) => [l.id, l]));
    this.truth = this.layers.find((l) => l.kind === 'truth') || null;
    this.models = this.layers.filter((l) => l.kind !== 'truth');
    this.calibrated = this.models.map((l) => this.calibratedLayer(l)).filter(Boolean);
    for (const c of this.calibrated) {
      c.base.cal = c;
      this.layers.push(c);
      this.layerById.set(c.id, c);
    }
    this.seriesList = knownSeries(context.series || [], this.models);
    this.defaultSeries = defaultSeriesKey(this.seriesList);
    this.heldBy = itemSeries(context.entry || null, this.seriesList, this.catalogModels);

    this.extras = (manifest.extra_grids || []).map((e) => this.normaliseExtra(e)).filter(Boolean);
    const values = manifest.values || {};
    this.references = Array.isArray(values.references) ? values.references : [];
    this.baselines = Array.isArray(values.baselines) ? values.baselines : [];
    this.cylinder = values.cylinder && Number.isFinite(values.cylinder.radius_m) ? values.cylinder : null;
    this.dateInfo = values.date_info && typeof values.date_info === 'object' ? values.date_info : null;
    this.bounds = manifest.bounds || manifest.points?.position || { min: [0, 0, 0], max: [1, 1, 1] };
    this.markers = Array.isArray(manifest.markers) ? manifest.markers : [];
    this.attributes = manifest.points?.attributes || [];
    this.pointCount = manifest.points?.count || 0;
    this.fullPointCount = manifest.points?.full_count || this.pointCount;
    this.previewCap = context.preview ? context.preview.capFor(manifest.kind) : null;
    this.cache = new Map();
  }

  makeGround(spec, grid) {
    if (spec && spec.mode === 'per_cell' && spec.array && this.grids.get(spec.array)) {
      const arr = this.grids.get(spec.array).data;
      const fallback = Number.isFinite(spec.z) ? spec.z : 0;
      return (ix, iy) => {
        const v = arr[iy * grid.nx + ix];
        return Number.isFinite(v) ? v : fallback;
      };
    }
    const z = spec && Number.isFinite(spec.z) ? spec.z : 0;
    return () => z;
  }

  normaliseLayer(l) {
    const prof = l.profile && this.grids.get(l.profile);
    const tot = l.total && this.grids.get(l.total);
    const raw = l.profile_raw && this.grids.get(l.profile_raw);
    const { nx, ny, nz } = this.grid;
    const profile = prof && prof.data.length === nx * ny * nz ? prof.data : null;
    let total = tot && tot.data.length === nx * ny ? tot.data : null;
    if (!total && profile) total = sumProfile(profile, nx * ny, nz);
    const cal = l.calibration;
    const calibration = cal && Number.isFinite(cal.slope) && Number.isFinite(cal.intercept) ? cal : null;
    return {
      id: String(l.id),
      kind: l.kind === 'truth' ? 'truth' : 'model',
      label: l.label || l.id,
      short: l.short || l.label || l.id,
      group: l.group || (l.kind === 'truth' ? 'truth' : 'model'),
      groupLabel: l.group_label || (l.kind === 'truth' ? 'Label' : (l.group || 'Models')),
      tier: Number.isFinite(l.tier) ? l.tier : (l.kind === 'truth' ? 0 : 1),
      tierLabel: l.tier_label || '',
      color: l.color || '#888888',
      heldOut: l.held_out === undefined ? null : l.held_out,
      meanTotal: Number.isFinite(l.mean_total) ? l.mean_total : null,
      itemValue: Number.isFinite(l.item_value) ? l.item_value : null,
      notes: l.notes || '',
      provenance: l.provenance || null,
      trainingDataset: l.training_dataset || '',
      series: layerSeries(l, this.seriesKeys),
      seriesLabel: l.series_label || '',
      counterpart: counterpartFrom(String(l.id), l, this.catalogModels[l.id]),
      returns: l.returns,
      profile,
      total,
      profileRaw: raw && raw.data.length === nx * ny * nz ? raw.data : null,
      calibration,
      cal: null,
    };
  }

  calibratedLayer(l) {
    const c = l.calibration;
    const V = l.itemValue;
    if (!c || l.kind !== 'model' || !(Number.isFinite(V) && V > 0)) return null;
    const value = c.slope * V + c.intercept;
    const clipped = !(value > 0);
    const f = clipped ? 0 : value / V;
    const target = c.target || 'the field reference';
    const fit = `${signed(c.slope, 3)} × ${V.toFixed(2)} ${c.intercept < 0 ? '−' : '+'} ${Math.abs(c.intercept).toFixed(3)} = ${signed(value, 2)}`;
    const notes = clipped
      ? `${l.label}, calibrated to ${target}: ${fit}. Calibrated value ≤ 0, shown as 0.`
      : `${l.label} × ${f.toFixed(3)}, calibrated to ${target}: ${fit} (linear calibration of the mean LAI of the canopy cylinder; the profile’s shape is unchanged).`;
    return {
      ...l,
      id: `${CAL_PREFIX}${l.id}`,
      label: `${l.label} (calibrated)`,
      short: `${l.short} (calibrated)`,
      calibrated: true,
      base: l,
      cal: null,
      factor: f,
      calValue: value,
      clipped,
      meanTotal: clipped ? 0 : value,
      itemValue: value,
      notes,
      provenance: null,
      profile: scaled(l.profile, f),
      total: scaled(l.total, f),
      profileRaw: null,
      calibration: null,
    };
  }

  normaliseTerrain(t) {
    if (!t || !t.grid || !t.array || !this.grids.get(t.array)) return null;
    const g = t.grid;
    const grid = { x0: +g.x0 || 0, y0: +g.y0 || 0, nx: g.nx | 0, ny: g.ny | 0, cell: +g.cell || 1 };
    const arr = this.grids.get(t.array).data;
    if (arr.length !== grid.nx * grid.ny || grid.nx < 2 || grid.ny < 2) return null;
    return { label: t.label || 'Terrain', grid, z: arr };
  }

  normaliseExtra(e) {
    const g = e.grid || {};
    const grid = {
      x0: +g.x0 || 0, y0: +g.y0 || 0, nx: g.nx | 0, ny: g.ny | 0,
      cell: +g.cell || 1, nz: g.nz | 0 || 1, dz: +g.dz || 1,
    };
    const arr = e.profile && this.grids.get(e.profile);
    if (!arr || arr.data.length !== grid.nx * grid.ny * grid.nz) return null;
    const total = sumProfile(arr.data, grid.nx * grid.ny, grid.nz);
    return {
      id: String(e.id), label: e.label || e.id, grid, profile: arr.data, total,
      groundAt: this.makeGround(g.ground, grid),
      inMask: (ix, iy) => ix >= 0 && iy >= 0 && ix < grid.nx && iy < grid.ny && Number.isFinite(total[iy * grid.nx + ix]),
    };
  }

  layer(id) {
    return this.layerById.get(id) || null;
  }

  seriesOfKey(id) {
    const raw = String(id || '');
    const key = raw.startsWith(CAL_PREFIX) ? raw.slice(CAL_PREFIX.length) : raw;
    const l = this.layer(key);
    if (l) return l.series;
    const s = this.seriesList.find((x) => x.models.includes(key));
    if (s) return s.key;
    return this.catalogModels[key] ? seriesOf(this.catalogModels[key]) : '';
  }

  counterpartOf(id) {
    const l = this.layer(id);
    return l ? l.counterpart : counterpartFrom(String(id), this.catalogModels[id]);
  }

  hasTruth() {
    return !!(this.truth && this.truth.profile);
  }

  sourceOptions(keep = null) {
    const ok = (l) => !keep || keep(l);
    const out = [];
    const values = this.calibrated.length ? 'Uncalibrated' : (this.truth ? 'Label and predictions' : 'Predictions');
    for (const l of this.layers) if (!l.calibrated && ok(l)) out.push({ value: `layer:${l.id}`, label: l.label, group: values });
    for (const l of this.calibrated) {
      if (ok(l)) out.push({ value: `layer:${l.id}`, label: l.label, group: `Calibrated to ${l.base.calibration.target || 'the field reference'}` });
    }
    if (this.hasTruth()) {
      for (const l of this.models) if (l.profile && ok(l)) out.push({ value: `error:${l.id}`, label: `${l.label} − label`, group: 'Prediction − label' });
    }
    for (const l of this.layers) {
      if (l.profileRaw && ok(l)) out.push({ value: `raw:${l.id}`, label: `${l.label} · profile without rescaling`, group: 'Profiles without rescaling' });
    }
    for (const e of this.extras) out.push({ value: `extra:${e.id}`, label: e.label, group: 'Finer grids' });
    return out;
  }

  source(key) {
    if (!key) return null;
    if (this.cache.has(`src:${key}`)) return this.cache.get(`src:${key}`);
    const [type, ...rest] = key.split(':');
    const id = rest.join(':');
    let src = null;
    if (type === 'layer' && this.layer(id)) {
      const l = this.layer(id);
      src = {
        key, type: 'value', extra: false, label: l.label, short: l.short, layerId: l.id, color: l.color,
        grid: this.grid, groundAt: this.groundAt, rasterZ: this.rasterZ, inMask: this.inMask, profile: l.profile, total: l.total,
        calibrated: !!l.calibrated,
      };
    } else if (type === 'raw' && this.layer(id) && this.layer(id).profileRaw) {
      const l = this.layer(id);
      const { nx, ny, nz } = this.grid;
      src = {
        key, type: 'value', extra: false, raw: true, label: `${l.label} · profile without rescaling`, short: `${l.short} · profile without rescaling`,
        layerId: l.id, color: l.color, grid: this.grid, groundAt: this.groundAt, rasterZ: this.rasterZ,
        inMask: this.inMask, profile: l.profileRaw, total: sumProfile(l.profileRaw, nx * ny, nz),
      };
    } else if (type === 'error' && this.layer(id) && this.hasTruth() && this.layer(id).kind === 'model') {
      const l = this.layer(id);
      src = {
        key, type: 'error', extra: false, label: `${l.label} − label`, short: `${l.short} − label`, layerId: l.id,
        color: l.color, grid: this.grid, groundAt: this.groundAt, rasterZ: this.rasterZ, inMask: this.inMask,
        profile: l.profile ? diff(l.profile, this.truth.profile) : null,
        total: l.total && this.truth.total ? diff(l.total, this.truth.total) : null,
      };
    } else if (type === 'extra') {
      const e = this.extras.find((x) => x.id === id);
      if (e) {
        src = {
          key, type: 'value', extra: true, label: e.label, short: e.label, layerId: null, color: null,
          grid: e.grid, groundAt: e.groundAt, rasterZ: e.groundAt, inMask: e.inMask, profile: e.profile, total: e.total,
        };
      }
    }
    if (src) this.cache.set(`src:${key}`, src);
    return src;
  }

  range(src, what, mode, pool = null) {
    const own = src.extra || mode === 'layer';
    const key = `range:${src.key}:${what}:${own ? 'own' : `shared:${pool ? pool.join(',') : '*'}`}`;
    if (this.cache.has(key)) return this.cache.get(key);
    let v;
    const nz = this.grid.nz;
    const maskFn = (i) => this.mask[i] === 1;
    const inPool = (l) => (pool ? pool.includes(l.id) : !l.calibrated);
    if (src.extra) {
      const nzE = src.grid.nz;
      v = what === 'partial' ? percentile([src.profile], null, false, nzE) : percentile([src.total], null, false);
    } else if (mode === 'layer') {
      const arr = what === 'partial' ? src.profile : src.total;
      v = arr ? percentile([arr], maskFn, src.type === 'error', what === 'partial' ? nz : 1) : 1;
    } else if (src.type === 'error') {
      const arrs = this.models.filter(inPool).map((l) => this.source(`error:${l.id}`)).filter(Boolean)
        .map((s) => (what === 'partial' ? s.profile : s.total)).filter(Boolean);
      if (!arrs.length) arrs.push(what === 'partial' ? src.profile : src.total);
      v = percentile(arrs.filter(Boolean), maskFn, true, what === 'partial' ? nz : 1);
    } else {
      const arrs = this.layers.filter(inPool).map((l) => (what === 'partial' ? l.profile : l.total)).filter(Boolean);
      if (!arrs.length) arrs.push(what === 'partial' ? src.profile : src.total);
      v = percentile(arrs.filter(Boolean), maskFn, false, what === 'partial' ? nz : 1);
    }
    this.cache.set(key, v);
    return v;
  }

  profile(layerId, fp = null) {
    const l = this.layer(layerId);
    if (!l || !l.profile) return null;
    const { nx, ny, nz } = this.grid;
    const out = new Float64Array(nz);
    if (fp) {
      const [ix, iy] = fp;
      if (ix < 0 || iy < 0 || ix >= nx || iy >= ny) return null;
      const base = (iy * nx + ix) * nz;
      for (let k = 0; k < nz; k++) out[k] = l.profile[base + k];
      return out;
    }
    const key = `mean:${layerId}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const cnt = new Uint32Array(nz);
    for (let c = 0; c < nx * ny; c++) {
      if (!this.mask[c]) continue;
      for (let k = 0; k < nz; k++) {
        const v = l.profile[c * nz + k];
        if (Number.isFinite(v)) { out[k] += v; cnt[k] += 1; }
      }
    }
    for (let k = 0; k < nz; k++) out[k] = cnt[k] ? out[k] / cnt[k] : NaN;
    this.cache.set(key, out);
    return out;
  }

  totalAt(layerId, fp) {
    const l = this.layer(layerId);
    if (!l || !l.total || !fp) return NaN;
    const [ix, iy] = fp;
    if (ix < 0 || iy < 0 || ix >= this.grid.nx || iy >= this.grid.ny) return NaN;
    return l.total[iy * this.grid.nx + ix];
  }

  stats(layerId) {
    const key = `stats:${layerId}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const l = this.layer(layerId);
    const out = { mean: null, computedMean: null, bias: null, mae: null, n: 0 };
    if (l && l.total) {
      let s = 0;
      let n = 0;
      let sb = 0;
      let sa = 0;
      let nb = 0;
      const t = this.truth && this.truth.total && l.kind === 'model' ? this.truth.total : null;
      for (let c = 0; c < l.total.length; c++) {
        if (!this.mask[c]) continue;
        const v = l.total[c];
        if (!Number.isFinite(v)) continue;
        s += v; n += 1;
        if (t && Number.isFinite(t[c])) { sb += v - t[c]; sa += Math.abs(v - t[c]); nb += 1; }
      }
      out.n = n;
      out.computedMean = n ? s / n : null;
      out.mean = l.meanTotal !== null ? l.meanTotal : out.computedMean;
      if (nb) { out.bias = sb / nb; out.mae = sa / nb; }
    }
    this.cache.set(key, out);
    return out;
  }

  pointsTop() {
    if (this.cache.has('ptop')) return this.cache.get('ptop');
    const { nx, ny } = this.grid;
    let gmin = Infinity;
    for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) gmin = Math.min(gmin, this.groundAt(ix, iy));
    if (!Number.isFinite(gmin)) gmin = 0;
    const pmax = this.m.points?.position?.max;
    const top = pmax ? Math.max(0, pmax[2] - gmin) : 0;
    this.cache.set('ptop', top);
    return top;
  }

  layerTop(layerId) {
    const mean = this.profile(layerId);
    if (!mean) return 0;
    for (let k = this.grid.nz - 1; k >= 0; k--) if (mean[k] >= 0.01) return (k + 1) * this.grid.dz;
    return 0;
  }

  canopyTop() {
    if (this.cache.has('top')) return this.cache.get('top');
    let top = this.pointsTop();
    if (this.truth) top = Math.max(top, this.layerTop(this.truth.id));
    if (!(top > 0)) top = Math.max(...this.layers.filter((l) => !l.calibrated).map((l) => this.layerTop(l.id)), 0) || this.grid.nz * this.grid.dz;
    top = Math.min(top, this.grid.nz * this.grid.dz);
    this.cache.set('top', top);
    return top;
  }

  fitBounds() {
    if (this.cache.has('fit')) return this.cache.get('fit');
    const { x0, y0, nx, ny, cell } = this.grid;
    const pos = this.m.points?.position;
    const b = this.bounds;
    const min = pos ? [...pos.min] : [...b.min];
    const max = pos ? [...pos.max] : [...b.max];
    if (nx && ny) {
      min[0] = Math.min(min[0], x0); min[1] = Math.min(min[1], y0);
      max[0] = Math.max(max[0], x0 + nx * cell); max[1] = Math.max(max[1], y0 + ny * cell);
    }
    let gmin = Infinity;
    for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) gmin = Math.min(gmin, this.groundAt(ix, iy));
    if (Number.isFinite(gmin)) {
      min[2] = Math.min(min[2], gmin);
      max[2] = Math.max(max[2], gmin + this.canopyTop());
    }
    const out = { min, max };
    this.cache.set('fit', out);
    return out;
  }

  cellOf(x, y, grid = this.grid) {
    const ix = Math.floor((x - grid.x0) / grid.cell);
    const iy = Math.floor((y - grid.y0) / grid.cell);
    if (ix < 0 || iy < 0 || ix >= grid.nx || iy >= grid.ny) return null;
    return [ix, iy];
  }

  cellCenter(ix, iy, grid = this.grid) {
    return [grid.x0 + (ix + 0.5) * grid.cell, grid.y0 + (iy + 0.5) * grid.cell];
  }

  raycastVoxels(ray, src, visible, keep = null) {
    if (!src || !src.profile) return null;
    const { x0, y0, nx, ny, cell, nz, dz } = src.grid;
    const o = ray.origin;
    const d = ray.direction;
    const hits = [];
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        if (!src.inMask(ix, iy) || (keep && !keep.cell(ix, iy))) continue;
        const g = src.groundAt(ix, iy);
        const t = slab(o, d, x0 + ix * cell, x0 + (ix + 1) * cell, y0 + iy * cell, y0 + (iy + 1) * cell, g, g + nz * dz);
        if (t) hits.push([t[0], t[1], ix, iy, g]);
      }
    }
    hits.sort((a, b) => a[0] - b[0]);
    for (const [t0, t1, ix, iy, g] of hits) {
      const za = o.z + d.z * t0;
      const zb = o.z + d.z * t1;
      const ka = Math.floor((za - g) / dz);
      const kb = Math.floor((zb - g) / dz);
      const step = kb >= ka ? 1 : -1;
      for (let k = ka; step > 0 ? k <= kb : k >= kb; k += step) {
        if (k < 0 || k >= nz) continue;
        const v = src.profile[(iy * nx + ix) * nz + k];
        if (Number.isFinite(v) && visible(v) && (!keep || keep.bin(ix, iy, k))) {
          const zEdge = step > 0 ? g + k * dz : g + (k + 1) * dz;
          const tk = Math.abs(d.z) > 1e-9 ? Math.max(t0, (zEdge - o.z) / d.z) : t0;
          return { ix, iy, k, t: tk, value: v };
        }
      }
    }
    return null;
  }

  raycastGround(ray, grid = this.grid, groundAt = this.groundAt) {
    const o = ray.origin;
    const d = ray.direction;
    if (Math.abs(d.z) < 1e-6) return null;
    let z = groundAt(Math.floor(grid.nx / 2), Math.floor(grid.ny / 2));
    let cell = null;
    let p = null;
    for (let it = 0; it < 4; it++) {
      const t = (z - o.z) / d.z;
      if (t <= 0) return null;
      p = [o.x + d.x * t, o.y + d.y * t, z];
      const c = this.cellOf(p[0], p[1], grid);
      if (!c) return null;
      const gz = groundAt(c[0], c[1]);
      cell = c;
      if (Math.abs(gz - z) < 1e-3) break;
      z = gz;
    }
    return cell ? { ix: cell[0], iy: cell[1], point: p } : null;
  }
}

function sumProfile(profile, cells, nz) {
  const out = new Float32Array(cells);
  for (let c = 0; c < cells; c++) {
    let s = 0;
    let any = false;
    for (let k = 0; k < nz; k++) {
      const v = profile[c * nz + k];
      if (Number.isFinite(v)) { s += v; any = true; }
    }
    out[c] = any ? s : NaN;
  }
  return out;
}

function diff(a, b) {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] - b[i];
  return out;
}

function signed(v, d) {
  return v.toFixed(d).replace('-', '−');
}

function scaled(a, f) {
  if (!a) return null;
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] * f;
  return out;
}

function slab(o, d, xa, xb, ya, yb, za, zb) {
  if (zb <= za) return null;
  let t0 = 0;
  let t1 = Infinity;
  const axes = [[o.x, d.x, xa, xb], [o.y, d.y, ya, yb], [o.z, d.z, za, zb]];
  for (const [oo, dd, lo, hi] of axes) {
    if (Math.abs(dd) < 1e-12) {
      if (oo < lo || oo > hi) return null;
    } else {
      let ta = (lo - oo) / dd;
      let tb = (hi - oo) / dd;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) return null;
    }
  }
  return [t0, t1];
}
