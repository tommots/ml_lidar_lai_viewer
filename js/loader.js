export const FORMAT_VERSION = 1;

export function itemBase(id) {
  return `cache/items/${encodeURIComponent(id)}/`;
}

export async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, { signal: opts.signal, cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

export async function fetchArrayBuffer(url, opts = {}) {
  const res = await fetch(url, { signal: opts.signal });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const header = Number(res.headers.get('content-length'));
  const encoded = !!res.headers.get('content-encoding');
  const total = !encoded && header > 0 ? header : (opts.expected || 0);
  if (!res.body || !res.body.getReader) {
    const buf = await res.arrayBuffer();
    if (opts.onProgress) opts.onProgress(buf.byteLength, buf.byteLength);
    return buf;
  }
  const reader = res.body.getReader();
  let loaded = 0;
  let target = !encoded && header > 0 ? new Uint8Array(header) : null;
  const parts = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (target && loaded + value.length <= target.length) target.set(value, loaded);
    else {
      if (target) { parts.push(target.subarray(0, loaded)); target = null; }
      parts.push(value);
    }
    loaded += value.length;
    if (opts.onProgress) opts.onProgress(loaded, Math.max(total, loaded));
  }
  if (target) return loaded === target.length ? target.buffer : target.slice(0, loaded).buffer;
  const out = new Uint8Array(loaded);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out.buffer;
}

export function parseGrids(buffer, meta) {
  const out = new Map();
  for (const [name, a] of Object.entries(meta.arrays || {})) {
    if (a.dtype && a.dtype !== 'float32') throw new Error(`grid ${name}: unsupported dtype ${a.dtype}`);
    const count = (a.shape || []).reduce((p, n) => p * n, 1);
    if (a.offset % 4 !== 0 || a.offset + count * 4 > buffer.byteLength) throw new Error(`grid ${name}: bad offset/shape`);
    out.set(name, { data: new Float32Array(buffer, a.offset, count), shape: a.shape || [] });
  }
  return out;
}


export function parseChunk(buffer, chunk, attributes, index) {
  const n = chunk.count;
  const posOff = chunk.offsets.position || 0;
  if (posOff % 2 !== 0 || posOff + n * 6 > buffer.byteLength) throw new Error(`chunk ${index}: bad position section`);
  const position = new Uint16Array(buffer, posOff, n * 3);
  const attrs = {};
  for (const a of attributes) {
    const off = chunk.offsets[a.name];
    const c = a.components || 1;
    if (off === undefined || off + n * c > buffer.byteLength) throw new Error(`chunk ${index}: bad section ${a.name}`);
    attrs[a.name] = new Uint8Array(buffer, off, n * c);
  }
  return { index, count: n, position, attrs, bytes: buffer.byteLength };
}

export class PointStream {
  constructor(base, points, handlers) {
    this.base = base;
    this.points = points;
    this.handlers = handlers;
    this.chunks = points.chunks || [];
    this.loaded = 0;
    this.loadedPoints = 0;
    this.budget = 0;
    this.running = false;
    this.ctrl = new AbortController();
    this.closed = false;
  }

  target() {
    return Math.min(this.budget, this.points.count || 0);
  }

  setBudget(n) {
    this.budget = n;
    this.pump();
  }

  satisfied() {
    return this.loadedPoints >= this.target() || this.loaded >= this.chunks.length;
  }

  async pump() {
    if (this.running || this.closed) return;
    if (this.satisfied()) { this.handlers.onIdle(); return; }
    this.running = true;
    try {
      while (!this.closed && !this.satisfied()) {
        const i = this.loaded;
        const ch = this.chunks[i];
        const target = this.target();
        const buf = await fetchArrayBuffer(this.base + ch.file, {
          signal: this.ctrl.signal,
          expected: ch.bytes,
          onProgress: (l, t) => this.handlers.onProgress({
            chunk: i, chunks: this.chunksFor(target), fraction: t ? l / t : 0,
            loadedPoints: this.loadedPoints, target,
          }),
        });
        if (this.closed) return;
        const parsed = parseChunk(buf, ch, this.points.attributes || [], i);
        this.loaded += 1;
        this.loadedPoints += parsed.count;
        this.handlers.onChunk(parsed);
      }
      if (!this.closed) this.handlers.onIdle();
    } catch (e) {
      if (!this.closed && e.name !== 'AbortError') this.handlers.onError(e);
    } finally {
      this.running = false;
    }
  }

  chunksFor(n) {
    let acc = 0;
    for (let i = 0; i < this.chunks.length; i++) {
      acc += this.chunks[i].count;
      if (acc >= n) return i + 1;
    }
    return this.chunks.length;
  }

  close() {
    this.closed = true;
    this.ctrl.abort();
  }
}
