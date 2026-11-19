import { h, clear, fmtDuration, icon } from './ui.js';
import { KIND_LABELS, KIND_TABS, jobActive } from './catalog.js';
import { listedIn } from './series.js';
import { OPERATOR } from './operator.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const CANOPY_ORDER = ['deciduous', 'mixed', 'mixed_conifer', 'mixed_coniferous', 'coniferous'];

export function canopyLabel(g) {
  if (!g) return 'Other';
  const k = String(g).toLowerCase();
  if (k.startsWith('decid')) return 'Deciduous';
  if (k.includes('mix') || k.startsWith('conif')) return 'Mixed/coniferous';
  const s = String(g).replace(/_/g, ' ').replace(/\s+/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function count(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function canopyClass(g) {
  const s = String(g || '').toLowerCase();
  if (s.startsWith('decid')) return 'cg-deciduous';
  if (s.startsWith('conif')) return 'cg-coniferous';
  if (s.includes('mix')) return 'cg-mixed';
  return 'cg-other';
}

function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  return m ? { y: +m[1], m: +m[2] - 1, d: +m[3] } : null;
}

function progressOf(item) {
  const p = item.job && Number(item.job.progress);
  return Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : 0;
}

export function itemStatus(item) {
  if (item.job && jobActive(item.job)) return String(item.job.status).toLowerCase() === 'queued' ? 'queued' : 'running';
  return item.status || 'missing';
}

export class Picker {
  constructor(root, handlers) {
    this.root = root;
    this.handlers = handlers;
    this.cat = null;
    this.kind = null;
    this.query = '';
    this.trap = null;
    this.current = null;
    this.lastOfKind = new Map();
    this.seriesKey = null;
    this.mode = h('p', { class: 'picker-mode', hidden: true });
    this.tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Data' });
    this.search = h('input', {
      type: 'search', class: 'search-input', placeholder: 'Filter: species, height, foliation…',
      'aria-label': 'Filter the synthetic stands', autocomplete: 'off', spellcheck: 'false',
    });
    this.search.addEventListener('input', () => { this.query = this.search.value.trim().toLowerCase(); this.render(); });
    this.body = h('div', { class: 'picker-body', role: 'tabpanel' });
    this.searchBox = h('div', { class: 'search' }, icon('search', { size: 16 }), this.search);
    root.append(this.mode, this.tabs, this.searchBox, this.body);
  }

  setCatalog(cat) {
    this.cat = cat;
    if (!this.kind || !cat.kinds.includes(this.kind)) this.kind = cat.kinds[0] || null;
    const server = cat.mode === 'server';
    const ready = cat.items.filter((i) => i.status === 'ready').length;
    this.mode.textContent = server ? `${ready} of ${cat.items.length} ready` : '';
    this.mode.hidden = !server;
    this.render();
  }

  setCurrent(id) {
    this.current = id;
    const it = id && this.cat ? this.cat.byId.get(id) : null;
    if (it) {
      this.kind = it.kind;
      this.lastOfKind.set(it.kind, it.id);
      if (it.kind === 'ecosense' && it.meta.trap) this.trap = it.meta.trap;
    }
    this.render();
  }

  openable(it) {
    return !!it && this.listed(it) && itemStatus(it) !== 'failed' && this.available([it]).length > 0;
  }

  firstOf(kind) {
    const def = this.handlers.defaultItem ? this.handlers.defaultItem() : null;
    if (def && def.kind === kind && this.openable(def)) return def;
    const items = this.cat.items.filter((i) => i.kind === kind && this.openable(i));
    if (kind === 'ecosense') {
      return items.sort((a, b) => String(a.meta.trap).localeCompare(String(b.meta.trap), undefined, { numeric: true })
        || String(a.meta.date).localeCompare(String(b.meta.date)))[0] || null;
    }
    const groups = this.cat.groups.filter((g) => g.kind === kind).map((g) => g.key);
    const rank = (i) => (groups.includes(i.group) ? groups.indexOf(i.group) : groups.length);
    return items.sort((a, b) => rank(a) - rank(b) || bySortKey(a, b))[0] || null;
  }

  switchKind(k) {
    if (!this.cat || k === this.kind) return;
    const cur = this.current ? this.cat.byId.get(this.current) : null;
    this.kind = k;
    this.render();
    const last = this.cat.byId.get(this.lastOfKind.get(k));
    const it = this.openable(last) ? last : this.firstOf(k);
    if (!it) return;
    if (cur && it.id === cur.id && !(this.handlers.busy && this.handlers.busy())) return;
    this.handlers.onSelect(it, {});
  }

  focusSearch() {
    if (!this.searchBox.hidden) this.search.focus();
  }

  setSeries(key) {
    if (key === this.seriesKey) return;
    this.seriesKey = key;
    this.render();
  }

  shownSeries() {
    const list = this.cat ? this.cat.series : [];
    return list.length >= 2 ? list.find((s) => s.key === this.seriesKey) || null : null;
  }

  listed(it) {
    const s = this.shownSeries();
    return !s || listedIn(it, s.key, this.cat.series, this.cat.models);
  }

  stale(it) {
    if (it.status !== 'ready' || !Array.isArray(it.missing_models) || !it.missing_models.length) return false;
    const s = this.shownSeries();
    return !s || it.missing_models.some((k) => s.models.includes(k));
  }

  neighbourDate(delta) {
    const it = this.current && this.cat ? this.cat.byId.get(this.current) : null;
    if (!it || it.kind !== 'ecosense') return null;
    const list = this.cat.items.filter((x) => x.kind === 'ecosense' && x.meta.trap === it.meta.trap)
      .sort((a, b) => String(a.meta.date).localeCompare(String(b.meta.date)));
    const i = list.findIndex((x) => x.id === it.id);
    const usable = (x) => x.status === 'ready' || this.cat.canPrepare;
    for (let j = i + delta; j >= 0 && j < list.length; j += delta) if (usable(list[j])) return list[j];
    return null;
  }

  selectTrap(t) {
    const cur = this.current && this.cat ? this.cat.byId.get(this.current) : null;
    this.trap = t.trap;
    this.render();
    if (!cur || cur.kind !== 'ecosense' || cur.meta.trap === t.trap) return;
    const it = t.items.find((i) => i.meta.date === cur.meta.date);
    if (it && itemStatus(it) !== 'failed' && this.available([it]).length) this.handlers.onSelect(it, {});
  }

  matches(item) {
    if (!this.query) return true;
    return this.query.split(/\s+/).every((t) => item.search.includes(t));
  }

  render() {
    if (!this.cat) return;
    const focusedId = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.focusKey : null;
    const filterable = this.kind === 'synthetic';
    this.searchBox.hidden = !filterable;
    if (!filterable && this.query) { this.query = ''; this.search.value = ''; }
    this.renderTabs();
    clear(this.body);
    const all = this.cat.items.filter((i) => i.kind === this.kind);
    const items = all.filter((i) => this.listed(i));
    if (!all.length) {
      this.body.appendChild(h('p', { class: 'empty' }, 'No data.'));
    } else if (!items.length) {
      this.body.appendChild(h('p', { class: 'empty' }, 'No stand here was held out for the ',
        h('span', { class: 'series-name' }, this.shownSeries().short), ' models. Choose another model series under Models.'));
    } else if (this.kind === 'ecosense') this.renderEcosense(items);
    else this.renderList(items, all.length);
    if (focusedId) {
      const el = this.root.querySelector(`[data-focus-key="${CSS.escape(focusedId)}"]`);
      if (el) el.focus({ preventScroll: true });
    }
  }

  renderTabs() {
    clear(this.tabs);
    const kinds = this.cat.kinds;
    kinds.forEach((k, i) => {
      const n = this.cat.items.filter((it) => it.kind === k && this.listed(it) && (k !== 'synthetic' || this.matches(it))).length;
      const selected = k === this.kind;
      const btn = h('button', {
        type: 'button', role: 'tab', class: 'tab', 'aria-selected': String(selected), tabindex: selected ? 0 : -1,
        dataset: { focusKey: `tab:${k}` },
        onclick: () => this.switchKind(k),
        onkeydown: (e) => {
          if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
          const j = (i + (e.key === 'ArrowRight' ? 1 : kinds.length - 1)) % kinds.length;
          this.switchKind(kinds[j]);
          this.tabs.querySelector('[aria-selected="true"]')?.focus();
        },
        title: KIND_LABELS[k] || k,
        'aria-label': `${KIND_LABELS[k] || k}, ${k === 'synthetic' ? count(n, 'stand') : (k === 'ecosense' ? count(n, 'position-date') : n)}`,
      }, h('span', { class: 'tab-label' }, KIND_TABS[k] || KIND_LABELS[k] || k), h('span', { class: 'tab-count' }, String(n)));
      this.tabs.appendChild(btn);
    });
  }

  renderList(items, total) {
    const s = this.shownSeries();
    if (s && items.length < total) {
      this.body.appendChild(h('p', { class: 'hint picker-filter' }, 'Stands held out for the ',
        h('span', { class: 'series-name' }, s.short), ` models: ${items.length} of ${total}. Choose the model series under Models.`));
    }
    const groups = this.cat.groups.filter((g) => g.kind === this.kind);
    const known = new Set(groups.map((g) => g.key));
    const orphans = items.filter((i) => !known.has(i.group));
    const all = [...groups.map((g) => ({ ...g, items: items.filter((i) => i.group === g.key) }))];
    if (orphans.length) all.push({ key: '_other', label: groups.length ? 'Other' : '', items: orphans });
    let shown = 0;
    for (const g of all) {
      const list = g.items.filter((i) => this.matches(i)).sort(bySortKey);
      if (!list.length) continue;
      shown += list.length;
      const ul = h('ul', { class: 'item-list' });
      for (const it of list) ul.appendChild(this.row(it));
      this.body.appendChild(h('section', { class: 'item-group' },
        g.label ? h('h3', { class: 'group-title' }, g.label, h('span', { class: 'group-count' }, String(list.length))) : null,
        g.description ? h('p', { class: 'group-desc' }, g.description) : null,
        ul));
    }
    if (!shown) this.body.appendChild(h('p', { class: 'empty' }, `Nothing matches “${this.query}”.`));
  }

  status(it) {
    return [statusText(it, this.cat), this.stale(it) ? this.staleText() : ''].filter(Boolean).join(', ');
  }

  row(it) {
    const st = itemStatus(it);
    const current = it.id === this.current;
    const li = h('li', { class: `item-row status-${st}${current ? ' current' : ''}` });
    const status = this.status(it);
    li.appendChild(h('button', {
      type: 'button', class: 'item-main', 'aria-current': current ? 'true' : null,
      dataset: { focusKey: `item:${it.id}` },
      'aria-label': status ? `${it.label}. ${status}` : it.label,
      onclick: () => this.handlers.onSelect(it),
    },
    h('span', { class: 'item-title' }, it.label),
    it.subtitle ? h('span', { class: 'item-sub' }, it.subtitle) : null,
    h('span', { class: 'item-foot' },
      h('span', { class: 'item-tags' }, it.tags.map((t) => h('span', { class: 'tag' }, t))),
      this.badge(it, st))));
    if (st === 'running' || st === 'queued') li.appendChild(this.progress(it, st));
    if (st === 'failed') li.appendChild(this.failure(it));
    return li;
  }

  staleText() {
    const s = this.shownSeries();
    return s ? `some ${s.short} models are missing` : 'some models are missing';
  }

  badge(it, st) {
    if (st === 'ready') {
      const ready = this.cat.mode === 'server'
        ? h('span', { class: 'status-badge ready', title: 'Ready: opens at once' },
          h('span', { class: 'dot', 'aria-hidden': 'true' }), h('span', { class: 'badge-text' }, 'ready'))
        : null;
      if (!this.stale(it)) return ready;
      const why = this.staleText();
      const how = this.cat.canPrepare ? OPERATOR.updateClause
        : (this.cat.mode === 'server' ? OPERATOR.rebuildStaleClause : '');
      return h('span', { class: 'status-pair' }, ready, h('span', {
        class: 'status-badge stale', 'aria-hidden': 'true',
        title: `${why.charAt(0).toUpperCase()}${why.slice(1)}${how}`,
      }, 'update'));
    }
    if (st === 'missing') {
      return this.cat.canPrepare
        ? h('span', { class: 'status-badge missing', title: OPERATOR.notReadyTitle }, OPERATOR.loadsIn.replace('{est}', fmtDuration(it.est_seconds || 20) || '~20 s'))
        : h('span', { class: 'status-badge missing' }, 'not available');
    }
    if (st === 'failed') return h('span', { class: 'status-badge failed' }, icon('warning', { size: 14 }), 'failed');
    return h('span', { class: 'status-badge running' }, st === 'queued' ? 'waiting' : `${Math.round(progressOf(it) * 100)} %`);
  }

  progress(it, st) {
    return h('div', { class: 'item-progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(progressOf(it) * 100), 'aria-label': `Loading ${it.label}` },
      h('div', { class: 'bar' }, h('span', { style: { width: `${(st === 'queued' ? 0.02 : progressOf(it)) * 100}%` } })),
      h('span', { class: 'progress-msg' }, (it.job && it.job.message) || (st === 'queued' ? 'waiting…' : 'loading…')));
  }

  failure(it) {
    const msg = (it.job && (it.job.error || it.job.message)) || it.error || 'loading failed';
    return h('div', { class: 'item-error', role: 'alert' },
      h('span', { class: 'err-text' }, msg),
      this.cat.canPrepare ? h('button', { type: 'button', class: 'btn btn-small', onclick: () => this.handlers.onSelect(it, { retry: true }) }, icon('retry', { size: 14 }), 'Retry') : null);
  }

  renderEcosense(items) {
    const traps = new Map();
    for (const it of items) {
      const t = it.meta.trap || '?';
      if (!traps.has(t)) traps.set(t, { trap: t, group: it.meta.canopy_group || '', items: [] });
      traps.get(t).items.push(it);
    }
    const trapList = [...traps.values()].sort((a, b) => a.trap.localeCompare(b.trap, undefined, { numeric: true }));
    const matching = trapList.filter((t) => t.items.some((i) => this.matches(i)));
    if (!this.trap || !traps.has(this.trap) || (this.query && !matching.some((t) => t.trap === this.trap))) {
      this.trap = (matching[0] || trapList[0]).trap;
    }
    const byGroup = new Map();
    for (const t of trapList) {
      const g = t.group || '';
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(t);
    }
    const groupKeys = [...byGroup.keys()].sort((a, b) => rankGroup(a) - rankGroup(b) || a.localeCompare(b));
    const legend = h('h3', { class: 'group-title trap-legend' },
      groupKeys.map((g) => h('span', { class: 'trap-legend-item' },
        h('span', { class: `cg-badge ${canopyClass(g)}`, 'aria-hidden': 'true' }, canopyLabel(g).charAt(0)),
        `${canopyLabel(g)} canopy`, h('span', { class: 'group-count' }, String(byGroup.get(g).length)))));
    const tiles = h('div', { class: 'trap-tiles trap-map' });
    for (const t of trapList) {
      const n = this.available(t.items).length;
      const running = t.items.some((i) => ['running', 'queued'].includes(itemStatus(i)));
      const hit = t.items.some((i) => this.matches(i));
      const selected = t.trap === this.trap;
      const hasCurrent = t.items.some((i) => i.id === this.current);
      const rc = /^LT(\d)(\d)$/.exec(t.trap);
      tiles.appendChild(h('button', {
        type: 'button', class: `trap-tile${selected ? ' selected' : ''}${hit ? '' : ' dim'}${hasCurrent ? ' has-current' : ''}`,
        style: rc ? { gridRow: rc[1], gridColumn: rc[2] } : null,
        'aria-pressed': String(selected), dataset: { focusKey: `trap:${t.trap}` },
        'aria-label': `Reference position ${t.trap}, ${canopyLabel(t.group).toLowerCase()} canopy, ${count(n, 'date')}`,
        onclick: () => this.selectTrap(t),
      },
      h('span', { class: 'trap-name' }, t.trap),
      h('span', { class: `cg-badge ${canopyClass(t.group)}`, title: `${canopyLabel(t.group)} canopy`, 'aria-hidden': 'true' }, canopyLabel(t.group).charAt(0)),
      h('span', { class: 'trap-ready', 'aria-hidden': 'true' }, running ? h('span', { class: 'spinner' }) : null, count(n, 'date')),
      hasCurrent ? h('span', { class: 'sr-only' }, ' (shown now)') : null));
    }
    const trapsEl = h('div', { class: 'trap-groups' }, h('div', { class: 'trap-group' }, legend, tiles));
    this.body.appendChild(h('section', { class: 'eco-traps', 'aria-label': 'Reference positions' }, trapsEl));
    this.body.appendChild(this.dateGrid(traps.get(this.trap)));
  }

  available(list) {
    return this.cat.canPrepare ? list : list.filter((i) => i.status === 'ready');
  }

  dateGrid(t) {
    const list = [...t.items].sort((a, b) => String(a.meta.date).localeCompare(String(b.meta.date)));
    const shown = list.filter((i) => this.matches(i));
    const wrap = h('section', { class: 'date-panel', 'aria-label': `Dates at reference position ${t.trap}` });
    wrap.appendChild(h('div', { class: 'date-head' },
      h('h3', { class: 'date-title' }, `${t.trap}`,
        h('span', { class: 'date-title-sub' }, ` · ${canopyLabel(t.group).toLowerCase()} canopy · ${count(this.available(list).length, 'date')}`))));
    const years = new Map();
    for (const it of shown) {
      const d = parseDate(it.meta.date);
      if (!d) continue;
      if (!years.has(d.y)) years.set(d.y, []);
      years.get(d.y).push({ it, d });
    }
    for (const [y, arr] of [...years.entries()].sort((a, b) => a[0] - b[0])) {
      wrap.appendChild(h('div', { class: 'year' }, h('div', { class: 'year-label' }, String(y)),
        h('div', { class: 'chips' }, arr.map(({ it, d }) => this.chip(it, d)))));
    }
    if (!shown.length) wrap.appendChild(h('p', { class: 'empty' }, `No date at ${t.trap} matches “${this.query}”.`));
    const failed = shown.filter((i) => itemStatus(i) === 'failed');
    for (const it of failed) wrap.appendChild(h('div', { class: 'date-failure' }, h('strong', {}, it.meta.date), ' ', this.failure(it)));
    const active = shown.filter((i) => ['running', 'queued'].includes(itemStatus(i)));
    for (const it of active) wrap.appendChild(h('div', { class: 'date-running' }, h('strong', {}, it.meta.date), this.progress(it, itemStatus(it))));
    const server = this.cat.mode === 'server';
    const missing = list.filter((i) => itemStatus(i) === 'missing');
    const est = fmtDuration(Math.max(...missing.map((i) => i.est_seconds || 20), 0)) || '~20 s';
    let missingText = null;
    if (missing.length) missingText = this.cat.canPrepare ? OPERATOR.loadsOnClick.replace('{est}', est) : 'not available';
    const stale = shown.some((i) => this.stale(i));
    wrap.appendChild(h('p', { class: 'date-legend' },
      server ? h('span', {}, h('span', { class: 'chip-dot ready', 'aria-hidden': 'true' }), 'ready') : null,
      stale ? h('span', {}, h('span', { class: 'chip-dot ready stale', 'aria-hidden': 'true' }), this.staleText()) : null,
      missingText ? h('span', {}, h('span', { class: 'chip-dot missing', 'aria-hidden': 'true' }), missingText) : null,
      h('span', {}, h('span', { class: 'hdhp-mark', 'aria-hidden': 'true' }, 'H'), 'HDHP-LAI on this date')));
    const pv = this.cat.preview;
    if (pv) {
      wrap.appendChild(h('p', { class: 'hint date-preview' }, pv.datesTotal > pv.datesShown
        ? `Preview version: ${pv.datesShown} of the ${pv.datesTotal} LiDAR acquisition dates are available.`
        : 'Preview version: only these dates are available.'));
    }
    return wrap;
  }

  chip(it, d) {
    const st = itemStatus(it);
    const current = it.id === this.current;
    const hdhp = !!it.meta.has_hdhp;
    const stale = this.stale(it);
    const status = this.status(it);
    const desc = [`${d.d} ${MONTHS_LONG[d.m]} ${d.y}`, status, hdhp ? 'with HDHP-LAI' : ''].filter(Boolean).join(', ');
    const disabled = st === 'missing' && !this.cat.canPrepare;
    return h('button', {
      type: 'button', class: `date-chip st-${st}${current ? ' current' : ''}${hdhp ? ' hdhp' : ''}${stale ? ' stale' : ''}`,
      'aria-label': desc, title: status ? `${it.label}\n${status}` : it.label,
      'aria-current': current ? 'true' : null, disabled,
      dataset: { focusKey: `item:${it.id}` },
      onclick: () => this.handlers.onSelect(it, st === 'failed' ? { retry: true } : {}),
    },
    this.cat.mode === 'server' || stale ? h('span', { class: 'chip-dot', 'aria-hidden': 'true' }) : null,
    `${d.d} ${MONTHS[d.m]}`,
    hdhp ? h('span', { class: 'hdhp-mark', 'aria-hidden': 'true' }, 'H') : null,
    st === 'running' || st === 'queued' ? h('span', { class: 'chip-progress', style: { width: `${Math.max(4, progressOf(it) * 100)}%` }, 'aria-hidden': 'true' }) : null);
  }
}

function statusText(it, cat) {
  const st = itemStatus(it);
  if (st === 'ready') return cat.mode === 'server' ? 'ready' : '';
  if (st === 'missing') return cat.canPrepare ? OPERATOR.notReady.replace('{est}', fmtDuration(it.est_seconds || 20) || 'a moment') : 'not available';
  if (st === 'queued') return 'waiting';
  if (st === 'running') return `loading, ${Math.round(progressOf(it) * 100)} %`;
  return 'loading failed';
}

function rankGroup(g) {
  const i = CANOPY_ORDER.indexOf(String(g).toLowerCase());
  return i < 0 ? 99 : i;
}

function bySortKey(a, b) {
  const ka = Array.isArray(a.sort_key) ? a.sort_key : [a.label];
  const kb = Array.isArray(b.sort_key) ? b.sort_key : [b.label];
  for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
    const x = ka[i];
    const y = kb[i];
    if (x === y) continue;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    return String(x).localeCompare(String(y), undefined, { numeric: true });
  }
  return 0;
}
