import { ITEM_KEYS } from './state.js';
import { CAL_PREFIX } from './itemdata.js';
import { defaultColorBy } from './points.js';
import { sample, seen, errorMapFor, laiMapRange, laiTableFor, fades, fadeAlpha, LAI_MAPS } from './colormaps.js';
import { AXES, RANGE_KEYS, validRange, clampRange, axisSize } from './clip.js';


function seriesKey(data, key) {
  return key && data.seriesList.some((s) => s.key === key) ? key : data.defaultSeries;
}

function seriesValue(data, key) {
  const k = seriesKey(data, key);
  return k === data.defaultSeries ? null : k;
}

export function effectiveSeries(data, st) {
  return seriesKey(data, st.series);
}

export function currentSeries(data, st) {
  const key = effectiveSeries(data, st);
  return data.seriesList.find((s) => s.key === key) || null;
}

export function hasSeriesChoice(data) {
  return data.seriesList.length >= 2;
}

export function layerInSeries(data, l, series) {
  if (!l) return false;
  const s = (l.calibrated ? l.base : l).series;
  return !s || !hasSeriesChoice(data) || s === series;
}

export function inSeries(data, st, l) {
  return layerInSeries(data, l, effectiveSeries(data, st));
}

export function seriesHolds(data, key) {
  return !data.heldBy || data.heldBy.includes(key);
}

export function toSeries(data, id, series) {
  if (!id) return null;
  const key = String(id);
  const l = data.layer(key);
  const inS = (x) => !hasSeriesChoice(data) || layerInSeries(data, x, series);
  if (l && inS(l)) return l.id;
  if (key.startsWith(CAL_PREFIX)) {
    const b = data.layer(toSeries(data, key.slice(CAL_PREFIX.length), series));
    return b && b.cal ? b.cal.id : null;
  }
  const anchor = data.counterpartOf(key) || key;
  const a = data.layer(anchor);
  if (a && inS(a)) return a.id;
  const m = data.models.find((x) => x.counterpart === anchor && inS(x));
  return m ? m.id : null;
}

export function defaultLayers(data, series, active) {
  const m = data.m;
  const models = data.models.filter((l) => layerInSeries(data, l, series));
  const act = toSeries(data, m.default_layer, series) || (models[0] || data.truth || {}).id || null;
  const a = active === undefined ? act : active;
  let cmp = toSeries(data, m.compare_default, series);
  if (!cmp) cmp = data.truth ? data.truth.id : (models.find((l) => l.id !== a)?.id || a);
  return { active: act, compareLayer: cmp };
}

function distinctCompare(data, series, active, cmp, two) {
  if (!two || !cmp || cmp !== active) return cmp;
  const ids = [defaultLayers(data, series, active).compareLayer, data.truth && data.truth.id,
    ...data.models.filter((l) => layerInSeries(data, l, series)).map((l) => l.id)];
  return ids.find((id) => id && id !== active) || cmp;
}

function sourceInSeries(data, key, series) {
  if (!key || !data.source(key)) return false;
  const [type, ...rest] = key.split(':');
  return type === 'extra' || layerInSeries(data, data.layer(rest.join(':')), series);
}

function hashSeries(data, hs, fallback, link) {
  const known = (k) => !!k && data.seriesList.some((s) => s.key === k);
  if (known(hs.series)) return seriesValue(data, hs.series);
  if (!link) return seriesValue(data, fallback);
  const named = [hs.active, hs.compareLayer].map((id) => (id ? data.seriesOfKey(id) : '')).filter(known);
  const holds = (k) => seriesHolds(data, k);
  const key = [...named, data.defaultSeries].find(holds) || data.seriesList.map((s) => s.key).find(holds);
  return seriesValue(data, key || data.defaultSeries);
}

export function seriesPatch(data, st, key) {
  const series = seriesKey(data, key);
  const standIn = !data.models.some((l) => inSeries(data, st, l));
  const active = (!standIn && toSeries(data, st.active, series)) || defaultLayers(data, series).active;
  const compareLayer = distinctCompare(data, series, active,
    (!standIn && toSeries(data, st.compareLayer, series)) || defaultLayers(data, series, active).compareLayer,
    !!st.compareLayer && st.compareLayer !== st.active);
  const patch = {
    series: seriesValue(data, series),
    active,
    compareLayer,
    voxMode: validMode(data, st.voxMode, active) ? st.voxMode : 'value',
    rasterSrc: sourceInSeries(data, st.rasterSrc, series) ? st.rasterSrc : null,
  };
  const shown = st.shownCalibrated || [];
  const l = data.layer(active);
  if (l && l.calibrated && shown.includes(st.active) && !shown.includes(active)) patch.shownCalibrated = [...shown, active];
  return patch;
}

export function seriesGap(data, st, catItem) {
  const choice = hasSeriesChoice(data);
  const series = currentSeries(data, st) || (!choice && data.seriesList.length === 1 ? data.seriesList[0] : null);
  if (!series) return null;
  const have = data.models.filter((l) => l.series === series.key).length;
  let keys = null;
  if (catItem && Array.isArray(catItem.missing_models)) keys = catItem.missing_models;
  else if (catItem && catItem.meta && Array.isArray(catItem.meta.model_keys)) keys = catItem.meta.model_keys;
  const missing = keys ? keys.map(String).filter((k) => !data.layer(k) && data.seriesOfKey(k) === series.key) : [];
  const gap = { series, missing, have, heldBy: [] };
  if (missing.length) return { ...gap, kind: 'stale' };
  if (have || !choice) return null;
  if (!seriesHolds(data, series.key)) {
    return { ...gap, kind: 'none', heldBy: data.seriesList.filter((s) => data.heldBy.includes(s.key)) };
  }
  return { ...gap, kind: keys ? 'none' : 'unknown' };
}

export function heldOutNote(data, st, catItem) {
  if (!data.m || data.m.kind !== 'synthetic') return '';
  const series = currentSeries(data, st) || (data.seriesList.length === 1 ? data.seriesList[0] : null);
  if (!series || !series.models.length) return '';
  const meta = (catItem && catItem.meta) || {};
  const listed = Array.isArray(meta.model_keys) ? new Set(meta.model_keys.map(String)) : null;
  const absent = series.models.filter((k) => !(listed ? listed.has(k) : data.layer(k)));
  if (!absent.length || absent.length === series.models.length) return '';
  const roles = meta.split_roles && typeof meta.split_roles === 'object' ? meta.split_roles : null;
  const roleOf = (k) => {
    const ds = (data.catalogModels[k] || {}).training_dataset;
    return roles && ds ? (roles[ds] || 'none') : 'unknown';
  };
  const what = {
    train: 'were trained on this stand', val: 'used this stand for validation',
    none: 'were neither trained nor tested on this stand', unknown: 'were not tested on this stand',
  };
  const count = { train: 0, val: 0, none: 0, unknown: 0 };
  for (const k of absent) {
    const r = roleOf(k);
    count[r in what ? r : 'unknown'] += 1;
  }
  const groups = Object.keys(what).filter((r) => count[r]);
  const name = hasSeriesChoice(data) ? `${series.short} ` : '';
  const head = `Not shown: ${absent.length} of the ${series.models.length} ${name}models`;
  const why = groups.length === 1 ? `, which ${what[groups[0]]}`
    : ` (${groups.map((r) => `${count[r]} ${what[r]}`).join('; ')})`;
  return `${head}${why}.`;
}

export function seriesCue(data, st) {
  if (!hasSeriesChoice(data)) return '';
  const s = currentSeries(data, st);
  const held = new Set(data.models.map((l) => l.series).filter(Boolean));
  return s && (held.size >= 2 || s.key !== data.defaultSeries) ? `models ${s.short}` : '';
}

export function visibleLayerIds(data, st) {
  const out = new Set();
  const all = st.showAllTiers || !data.models.some((l) => l.tier <= 2 && inSeries(data, st, l));
  const pinned = (l) => !!l && (l.id === st.active || l.id === st.compareLayer);
  for (const l of data.layers) {
    if (l.calibrated || !inSeries(data, st, l)) continue;
    if (l.kind === 'truth' || all || l.tier <= 2 || pinned(l) || pinned(l.cal)) {
      out.add(l.id);
      if (l.cal) out.add(l.cal.id);
    }
  }
  return out;
}

export function listedLayers(data, st) {
  const vis = visibleLayerIds(data, st);
  const out = [];
  for (const l of data.layers) {
    if (l.calibrated || !vis.has(l.id)) continue;
    out.push(l);
    if (l.cal && vis.has(l.cal.id)) out.push(l.cal);
  }
  return out;
}

export function activatePatch(data, st, id) {
  const l = data.layer(id);
  const patch = { active: id };
  if (st.voxMode === 'error' && l && l.kind === 'truth') patch.voxMode = 'value';
  if (st.voxMode === 'raw' && !(l && l.profileRaw)) patch.voxMode = 'value';
  if (String(st.voxMode).startsWith('extra:')) patch.voxMode = 'value';
  const shown = st.shownCalibrated || [];
  if (l && l.calibrated && !shown.includes(id)) patch.shownCalibrated = [...shown, id];
  const hidden = st.hiddenLayers || [];
  if (l && !l.calibrated && hidden.includes(id)) patch.hiddenLayers = hidden.filter((x) => x !== id);
  return patch;
}

export function chartTogglePatch(data, st, id) {
  const flip = (list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const l = data.layer(id);
  if (l && l.calibrated) return { shownCalibrated: flip(st.shownCalibrated || []) };
  return { hiddenLayers: flip(st.hiddenLayers) };
}

export function chartHidden(l, st) {
  return l.calibrated ? !(st.shownCalibrated || []).includes(l.id) : st.hiddenLayers.includes(l.id);
}

export function voxelKey(data, st) {
  if (typeof st.voxMode === 'string' && st.voxMode.startsWith('extra:') && data.source(st.voxMode)) return st.voxMode;
  if (!st.active) return '';
  if (st.voxMode === 'error' && data.source(`error:${st.active}`)) return `error:${st.active}`;
  if (st.voxMode === 'raw' && data.source(`raw:${st.active}`)) return `raw:${st.active}`;
  return `layer:${st.active}`;
}

export function compareKey(data, st) {
  const c = st.compareLayer;
  if (!c) return '';
  if (st.voxMode === 'error' && data.source(`error:${c}`)) return `error:${c}`;
  if (st.voxMode === 'raw' && data.source(`raw:${c}`)) return `raw:${c}`;
  return `layer:${c}`;
}

export function rasterKey(data, st) {
  if (st.rasterSrc && data.source(st.rasterSrc)) return st.rasterSrc;
  const k = voxelKey(data, st);
  return k.startsWith('raw:') ? `layer:${st.active}` : k;
}

export function compareRasterKey(data, st) {
  const k = compareKey(data, st);
  return k.startsWith('raw:') ? `layer:${st.compareLayer}` : k;
}

export function validMode(data, mode, active) {
  if (mode === 'value') return true;
  if (mode === 'error') return !!data.source(`error:${active}`);
  if (mode === 'raw') return !!data.source(`raw:${active}`);
  return typeof mode === 'string' && mode.startsWith('extra:') && !!data.source(mode);
}

export function itemDefaults(data, defaultBudget, series = data.defaultSeries) {
  const { active, compareLayer } = defaultLayers(data, seriesKey(data, series));
  return {
    series: data.defaultSeries,
    active, compareLayer, voxMode: 'value', rasterSrc: null,
    colorBy: defaultColorBy(data.attributes), xRange: null, yRange: null, zRange: null,
    footprint: null, budget: defaultBudget,
  };
}

export function itemState(data, hs, prev, st, defaultBudget) {
  const out = { itemId: data.id };
  out.series = hashSeries(data, hs, st.series, !!hs.itemId);
  const series = seriesKey(data, out.series);
  const def = itemDefaults(data, defaultBudget, series);
  const pick = (key, valid) => {
    if (hs[key] !== undefined && hs[key] !== null && valid(hs[key])) return hs[key];
    if (prev && st[key] !== null && st[key] !== undefined && valid(st[key])) return st[key];
    return def[key];
  };
  const standIn = !!prev && hasSeriesChoice(prev)
    && !prev.models.some((l) => layerInSeries(prev, l, seriesKey(prev, st.series)));
  const layerPick = (key) => {
    const h = hs[key] !== undefined && hs[key] !== null ? toSeries(data, hs[key], series) : null;
    if (h) return h;
    const c = prev && !standIn && st[key] !== null && st[key] !== undefined ? toSeries(data, st[key], series) : null;
    return c || def[key];
  };
  const named = (key) => (hs[key] !== undefined && hs[key] !== null ? hs[key]
    : (prev && !standIn && st[key] !== null && st[key] !== undefined ? st[key] : null));
  out.active = layerPick('active');
  out.compareLayer = distinctCompare(data, series, out.active, layerPick('compareLayer'),
    !!named('active') && !!named('compareLayer') && named('active') !== named('compareLayer'));
  const mode = pick('voxMode', (m) => validMode(data, m, out.active));
  out.voxMode = validMode(data, mode, out.active) ? mode : 'value';
  out.rasterSrc = hs.rasterSrc && sourceInSeries(data, hs.rasterSrc, series) ? hs.rasterSrc
    : (prev && st.rasterSrc && sourceInSeries(data, st.rasterSrc, series) ? st.rasterSrc : null);
  out.colorBy = pick('colorBy', (c) => c === 'single' || data.attributes.some((a) => a.name === c));
  const sameGrid = prev && prev.kind === data.kind && prev.grid.nx === data.grid.nx && prev.grid.ny === data.grid.ny
    && Math.abs(prev.grid.x0 - data.grid.x0) < 1e-6 && Math.abs(prev.grid.y0 - data.grid.y0) < 1e-6;
  const fpOk = (fp) => Array.isArray(fp) && data.inMask(fp[0], fp[1]);
  out.footprint = hs.footprint && fpOk(hs.footprint) ? hs.footprint : (sameGrid && fpOk(st.footprint) ? st.footprint : null);
  for (const axis of AXES) {
    const key = RANGE_KEYS[axis];
    const h = hs[key] !== undefined ? validRange(data, axis, hs[key]) : undefined;
    out[key] = h !== undefined ? h : (sameGrid ? clampRange(st[key], axisSize(data, axis)) : null);
  }
  for (const [k, v] of Object.entries(hs)) if (!(k in out) && k !== 'itemId' && !ITEM_KEYS.includes(k)) out[k] = v;
  return out;
}

export function hashPatch(data, hs, base) {
  const patch = { ...base, ...hs };
  delete patch.itemId;
  patch.series = hashSeries(data, hs, null, true);
  const series = seriesKey(data, patch.series);
  const def = defaultLayers(data, series);
  patch.active = toSeries(data, hs.active, series) || def.active;
  patch.compareLayer = distinctCompare(data, series, patch.active, toSeries(data, hs.compareLayer, series) || def.compareLayer,
    !!hs.active && !!hs.compareLayer && hs.active !== hs.compareLayer);
  if (!validMode(data, patch.voxMode, patch.active)) patch.voxMode = 'value';
  if (patch.rasterSrc && !sourceInSeries(data, patch.rasterSrc, series)) patch.rasterSrc = null;
  if (patch.colorBy !== 'single' && !data.attributes.some((a) => a.name === patch.colorBy)) patch.colorBy = base.colorBy;
  if (patch.footprint && !data.inMask(patch.footprint[0], patch.footprint[1])) patch.footprint = null;
  for (const axis of AXES) patch[RANGE_KEYS[axis]] = validRange(data, axis, hs[RANGE_KEYS[axis]]) || null;
  return patch;
}

export function sameFrame(a, b) {
  if (!a || !b || a.kind !== b.kind) return false;
  const c = (bb) => [0, 1, 2].map((i) => (bb.min[i] + bb.max[i]) / 2);
  const size = (bb) => Math.hypot(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]);
  const ca = c(a.bounds);
  const cb = c(b.bounds);
  const sa = size(a.bounds);
  const sb = size(b.bounds);
  return Math.hypot(ca[0] - cb[0], ca[1] - cb[1]) < 2 && Math.abs(sa - sb) / Math.max(sa, sb) < 0.25;
}

export function scalePool(data, st) {
  return [...visibleLayerIds(data, st)].filter((id) => {
    const l = data.layer(id);
    return !(l && l.calibrated) || id === st.active || id === st.compareLayer;
  }).sort();
}

export function scaleFor(data, st, src, what) {
  const max = data.range(src, what, st.scaleMode, scalePool(data, st));
  const theme = st.theme === 'light' ? 'light' : 'dark';
  if (src.type === 'error') {
    const map = errorMapFor(theme);
    return { type: 'div', map, from: 0, to: 1, max, color: (v, out) => sample(map, 0.5 + (0.5 * v) / max, out) };
  }
  const chosen = what === 'partial' ? st.voxMap : st.rasterMap;
  const map = laiTableFor(LAI_MAPS.includes(chosen) ? chosen : LAI_MAPS[0], theme);
  const [from, to] = laiMapRange(map, theme);
  const at = (v) => from + (to - from) * Math.min(1, Math.max(0, v / max));
  return {
    type: 'seq', map, from, to, max,
    color: (v, out) => sample(map, at(v), out),
    alpha: fades(map) ? (v) => fadeAlpha(at(v)) : null,
    seen: (v, out) => seen(map, at(v), out),
  };
}

export function voxelThreshold(data, st, src) {
  if (src && src.type === 'error') return (st.errThreshold ?? 0.15) * scaleFor(data, st, src, 'partial').max;
  return st.threshold;
}

export function unitFor(src, what) {
  const base = what === 'partial' ? `partial LAI per ${src.grid.dz} m height bin` : 'total LAI';
  return src.type === 'error' ? `Prediction − label, ${base} [m² m⁻²]` : `${base.charAt(0).toUpperCase()}${base.slice(1)} [m² m⁻²]`;
}

export function legendEntries(data, st, pointsLegend) {
  const out = [];
  const cmp = !!st.compare;
  if (st.showPoints && pointsLegend && pointsLegend.type !== 'single') {
    const dimmed = data.attributes.some((a) => a.name === 'ground') && !st.hideGround && st.colorBy !== 'ground';
    out.push({
      ...pointsLegend, key: 'points', side: cmp ? 'shared' : 'main', compactDefault: cmp,
      title: `Points · ${pointsLegend.title}`, note: dimmed ? 'gray: removed ground points' : null,
    });
  }
  const add = (what, pairs, visible) => {
    if (!visible) return;
    const entries = pairs.map(([side, key]) => {
      const src = data.source(key);
      return src ? { side, src, sc: scaleFor(data, st, src, what) } : null;
    }).filter(Boolean);
    if (!entries.length) return;
    const name = what === 'partial' ? 'Partial LAI' : 'Total LAI';
    const entry = (e, side, title) => ({
      key: `${what}-${side}`, side, type: e.sc.type, map: e.sc.map, from: e.sc.from, to: e.sc.to,
      min: 0, max: e.sc.max, capped: true, title, unit: unitFor(e.src, what),
      sub: st.scaleMode === 'shared' && !e.src.extra ? 'shared scale' : 'own scale',
    });
    if (entries.length === 1) {
      out.push(entry(entries[0], entries[0].side, `${name} · ${entries[0].src.short}`));
      return;
    }
    const [l, r] = entries;
    const same = l.sc.type === r.sc.type && l.sc.map === r.sc.map && l.src.grid.dz === r.src.grid.dz
      && Math.abs(l.sc.max - r.sc.max) < 1e-9;
    if (same) out.push(entry(r, 'shared', `${name} · both halves`));
    else out.push(entry(l, 'left', `${name} · ${l.src.short}`), entry(r, 'right', `${name} · ${r.src.short}`));
  };
  const vox = cmp ? [['left', compareKey(data, st)], ['right', voxelKey(data, st)]] : [['main', voxelKey(data, st)]];
  const ras = cmp ? [['left', compareRasterKey(data, st)], ['right', rasterKey(data, st)]] : [['main', rasterKey(data, st)]];
  add('partial', vox, st.showVoxels);
  add('total', ras, st.showRaster);
  return out;
}
