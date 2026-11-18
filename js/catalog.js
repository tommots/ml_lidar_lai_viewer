import { catalogSeries } from './series.js';
import { OPERATOR } from './operator.js';

const ACTIVE = new Set(['queued', 'running', 'pending', 'started', 'starting']);
const FAILED = new Set(['failed', 'error', 'cancelled', 'canceled']);

export const KIND_LABELS = { synthetic: 'Synthetic stands', ecosense: 'ECOSENSE forest', demo: 'Demo' };

export const KIND_TABS = { synthetic: 'Synthetic', ecosense: 'ECOSENSE', demo: 'Demo' };

export function jobActive(job) {
  return !!job && ACTIVE.has(String(job.status || '').toLowerCase());
}

export function jobFailed(job) {
  return !!job && FAILED.has(String(job.status || '').toLowerCase());
}

async function getJSON(url, init = {}) {
  const res = await fetch(url, { cache: 'no-store', ...init });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const type = res.headers.get('content-type') || '';
  const text = await res.text();
  if (!type.includes('json') && !/^\s*[{[]/.test(text)) throw new Error(`${url}: not JSON`);
  return JSON.parse(text);
}

export async function loadCatalog() {
  try {
    const cat = await getJSON('catalog.json');
    if (cat && Array.isArray(cat.items)) {
      if (cat.mode === 'server') return normalise(cat, 'server');
      return normalise(cat, 'static');
    }
  } catch (e) {  }
  const cat = await getJSON('api/catalog');
  if (!cat || !Array.isArray(cat.items)) throw new Error('api/catalog: no items');
  return normalise(cat, cat.mode === 'server' ? 'server' : 'static');
}

export async function reloadCatalog(mode) {
  return normalise(await getJSON(mode === 'server' ? 'api/catalog' : 'catalog.json'), mode);
}



function normalise(cat, mode) {
  const items = (cat.items || []).filter((it) => it && typeof it.id === 'string');
  if (mode === 'static') for (const it of items) it.status = it.status || 'ready';
  for (const it of items) {
    it.search = String(it.search || `${it.label || ''} ${it.subtitle || ''} ${it.id}`).toLowerCase();
    it.meta = it.meta || {};
    it.tags = Array.isArray(it.tags) ? it.tags : [];
    it.missing_models = Array.isArray(it.missing_models) ? it.missing_models.map(String) : null;
  }
  const order = ['synthetic', 'ecosense', 'demo'];
  const kinds = [...new Set(items.map((it) => it.kind))].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return {
    mode,
    canPrepare: mode === 'server' && cat.can_prepare !== false,
    title: cat.title || 'LAI canopy viewer',
    groups: Array.isArray(cat.groups) ? cat.groups : [],
    items,
    byId: new Map(items.map((it) => [it.id, it])),
    kinds,
    models: cat.models || {},
    series: catalogSeries(cat),
    defaultItem: typeof cat.default_item === 'string' ? cat.default_item : null,
    preview: normalisePreview(cat.preview, items),
  };
}

function normalisePreview(p, items = []) {
  if (!p || typeof p !== 'object') return null;
  const mp = p.max_points;
  const ok = (v) => (Number.isFinite(v) && v > 0 ? v : null);
  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const capFor = (kind) => ok(typeof mp === 'number' ? mp : (mp && typeof mp === 'object' ? mp[kind] : null));
  const paper = p.paper && typeof p.paper === 'object' && str(p.paper.title)
    ? { title: str(p.paper.title), doi: str(p.paper.doi) } : null;
  const datesShown = new Set(items.filter((i) => i.kind === 'ecosense').map((i) => i.meta && i.meta.date)).size;
  const references = Array.isArray(p.references) ? p.references.map(String).filter(Boolean) : [];
  return { capFor, datesTotal: ok(p.ecosense_dates_total), datesShown, references, paper, dataDoi: str(p.data_doi) };
}

export async function requestPrepare(id, force = false) {
  const res = await getJSON('api/prepare', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, force }),
  });
  if (!res || !res.job) throw new Error('api/prepare: no job in the answer');
  return res.job;
}

export class JobTracker {
  constructor(handlers) {
    this.handlers = handlers;
    this.jobs = new Map();
    this.timer = null;
  }

  track(job) {
    if (!job || !job.id) return;
    this.jobs.set(job.id, job);
    if (!this.timer) this.timer = setInterval(() => this.poll(), 1000);
  }

  async poll() {
    if (this.busy) return;
    this.busy = true;
    try {
      await Promise.all([...this.jobs.keys()].map(async (id) => {
        let job;
        try {
          const res = await getJSON(`api/jobs/${encodeURIComponent(id)}`);
          job = res.job || res;
          job.errors = 0;
        } catch (e) {
          const prev = this.jobs.get(id) || {};
          job = { ...prev, errors: (prev.errors || 0) + 1, message: 'waiting…' };
          if (job.errors >= 5) {
            this.jobs.delete(id);
            this.handlers.onFinished({ ...job, status: 'unknown', lost: true, error: null, message: OPERATOR.jobLost }, true);
            return;
          }
        }
        if (!job.id) job.id = id;
        this.jobs.set(id, job);
        if (jobActive(job)) this.handlers.onUpdate(job);
        else {
          this.jobs.delete(id);
          this.handlers.onFinished(job, !jobFailed(job));
        }
      }));
    } finally {
      this.busy = false;
      if (!this.jobs.size && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    }
  }
}
