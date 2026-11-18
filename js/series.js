import {
  ORDER, DEFAULT_KEY, ANCHOR_KEY, FALLBACK, FALLBACK_COUNTERPART, fallbackSeries,
} from './series_fallback.js';

export { fallbackSeries };


export function seriesOf(m) {
  if (!m) return '';
  return typeof m.series === 'string' ? m.series : fallbackSeries(m);
}

export function counterpartFrom(id, ...sources) {
  for (const m of sources) {
    if (m && 'counterpart' in m) return typeof m.counterpart === 'string' && m.counterpart ? m.counterpart : null;
  }
  return FALLBACK_COUNTERPART[id] || null;
}

export function layerSeries(l, keys) {
  const s = seriesOf(l);
  if (!s || !keys.size || keys.has(s)) return s;
  const f = fallbackSeries(l);
  return keys.has(f) ? f : s;
}

function seriesEntry(key, s = {}, models = []) {
  const fb = FALLBACK[key] || {};
  return {
    key,
    label: String(s.label || fb.label || key),
    short: String(s.short || fb.short || s.label || key),
    description: String(s.description || fb.description || ''),
    default: typeof s.default === 'boolean' ? s.default : key === DEFAULT_KEY,
    models: Array.isArray(s.models) ? s.models.map(String) : [...models],
  };
}

function byDisplayOrder(list) {
  const rank = (s) => (ORDER.includes(s.key) ? ORDER.indexOf(s.key) : ORDER.length);
  return list.map((s, i) => [s, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([s]) => s);
}

export function catalogSeries(cat) {
  const models = cat.models || {};
  const keysOf = (key) => Object.keys(models).filter((k) => seriesOf(models[k]) === key);
  if (Array.isArray(cat.series) && cat.series.length) {
    return cat.series.filter((s) => s && typeof s.key === 'string' && s.key)
      .map((s) => seriesEntry(s.key, s, keysOf(s.key))).filter((s) => s.models.length);
  }
  const byKey = new Map();
  for (const [key, m] of Object.entries(models)) {
    const s = seriesOf(m);
    if (!s) continue;
    if (!byKey.has(s)) byKey.set(s, []);
    byKey.get(s).push(key);
  }
  return byDisplayOrder([...byKey].map(([key, keys]) => seriesEntry(key, {}, keys)));
}

export function knownSeries(list, models) {
  const out = list.map((s) => ({ ...s, models: [...s.models] }));
  const added = [];
  for (const l of models) {
    if (!l.series) continue;
    let s = out.find((x) => x.key === l.series) || added.find((x) => x.key === l.series);
    if (!s) {
      s = seriesEntry(l.series, l.seriesLabel ? { label: l.seriesLabel } : {});
      added.push(s);
    }
    if (!s.models.includes(l.id)) s.models.push(l.id);
  }
  return [...out, ...byDisplayOrder(added)];
}

export function defaultSeriesKey(list) {
  const s = list.find((x) => x.default) || list.find((x) => x.key === DEFAULT_KEY)
    || list.find((x) => x.key === ANCHOR_KEY) || list[0];
  return s ? s.key : '';
}

export function seriesKeyIn(list, key) {
  return key && list.some((s) => s.key === key) ? key : defaultSeriesKey(list);
}

export function itemSeries(entry, list, models = {}) {
  if (!entry || entry.kind !== 'synthetic' || list.length < 2) return null;
  const meta = entry.meta || {};
  const sm = meta.series_models;
  let keys = null;
  if (sm && typeof sm === 'object' && !Array.isArray(sm)) {
    keys = Object.keys(sm).filter((k) => Array.isArray(sm[k]) && sm[k].length);
  } else if (Array.isArray(meta.model_keys)) {
    keys = meta.model_keys.map((k) => {
      const s = list.find((x) => x.models.includes(String(k)));
      return s ? s.key : seriesOf(models[k] || null);
    });
  }
  const held = keys ? list.filter((s) => keys.includes(s.key)).map((s) => s.key) : [];
  return held.length ? held : null;
}

export function listedIn(entry, key, list, models = {}) {
  const held = itemSeries(entry, list, models);
  return !held || held.includes(key);
}
