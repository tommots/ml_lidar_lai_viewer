export const RANGE_KEYS = Object.freeze({ x: 'xRange', y: 'yRange', z: 'zRange' });

export const AXES = Object.freeze(['x', 'y', 'z']);

const UNITS = { x: ['column', 'columns'], y: ['row', 'rows'], z: ['height bin', 'height bins'] };


export function binTop(data) {
  return Math.max(0, data.grid.nz - 1);
}

export function axisSize(data, axis) {
  if (axis === 'x') return data.grid.nx;
  if (axis === 'y') return data.grid.ny;
  return binTop(data) + 1;
}

export function normRange(v, n) {
  if (v === null || v === undefined) return null;
  if (!Array.isArray(v) || v.length !== 2 || !v.every(Number.isInteger)) return undefined;
  const [lo, hi] = v;
  if (lo < 0 || lo > hi || hi > n - 1) return undefined;
  return lo === 0 && hi === n - 1 ? null : [lo, hi];
}

export function binsCovering(metres, dz, n) {
  const [zmin, zmax] = Array.isArray(metres) ? metres : [];
  if (!(Number.isFinite(zmin) && Number.isFinite(zmax) && zmin <= zmax && dz > 0 && n > 0)) return undefined;
  const first = Math.floor(zmin / dz);
  const lo = Math.max(0, Math.min(n - 1, first));
  const hi = Math.max(lo, Math.min(n - 1, Math.max(first, Math.ceil(zmax / dz) - 1)));
  return normRange([lo, hi], n);
}

export function validRange(data, axis, v) {
  const n = axisSize(data, axis);
  if (axis === 'z' && v && typeof v === 'object' && !Array.isArray(v)) return binsCovering(v.metres, data.grid.dz, n);
  return normRange(v, n);
}

export function clampRange(r, n) {
  if (!Array.isArray(r) || !r.every(Number.isInteger)) return null;
  const lo = Math.max(0, Math.min(n - 1, r[0]));
  const hi = Math.max(lo, Math.min(n - 1, r[1]));
  return normRange([lo, hi], n) || null;
}

export function makeClip(data, st) {
  const r = {};
  const ends = {};
  for (const axis of AXES) {
    const v = st[RANGE_KEYS[axis]];
    const n = axisSize(data, axis);
    r[axis] = v ? normRange(v, n) || null : null;
    ends[axis] = r[axis]
      ? [r[axis][0] > 0 ? edgeOf(data, axis, r[axis][0]) : -Infinity,
        r[axis][1] < n - 1 ? edgeOf(data, axis, r[axis][1] + 1) : Infinity]
      : [-Infinity, Infinity];
  }
  return {
    x: r.x, y: r.y, z: r.z, any: !!(r.x || r.y || r.z),
    xa: ends.x[0], xb: ends.x[1], ya: ends.y[0], yb: ends.y[1], za: ends.z[0], zb: ends.z[1],
    grid: data.grid, groundAt: data.groundAt, ground0: data.ground0,
  };
}

export function keepXY(clip, x, y) {
  return x >= clip.xa && x < clip.xb && y >= clip.ya && y < clip.yb;
}

export function groundUnder(clip, x, y) {
  const g = clip.grid;
  const ix = Math.floor((x - g.x0) / g.cell);
  const iy = Math.floor((y - g.y0) / g.cell);
  return ix >= 0 && iy >= 0 && ix < g.nx && iy < g.ny ? clip.groundAt(ix, iy) : clip.ground0;
}

export function keepZ(clip, z, g) {
  const r = z - g;
  return r >= clip.za && r < clip.zb;
}

export function keepPoint(clip, x, y, z) {
  return keepXY(clip, x, y) && (!clip.z || keepZ(clip, z, groundUnder(clip, x, y)));
}

export function cellTest(clip, grid) {
  return (ix, iy) => keepXY(clip, grid.x0 + (ix + 0.5) * grid.cell, grid.y0 + (iy + 0.5) * grid.cell);
}

export function binTest(clip, src) {
  if (!clip.z) return () => true;
  const { x0, y0, cell, dz } = src.grid;
  return (ix, iy, k) => keepZ(clip, src.groundAt(ix, iy) + (k + 0.5) * dz,
    groundUnder(clip, x0 + (ix + 0.5) * cell, y0 + (iy + 0.5) * cell));
}

export function voxelTests(clip, src) {
  if (!clip || !clip.any || !src) return null;
  return { cell: cellTest(clip, src.grid), bin: binTest(clip, src) };
}


export function axisNames(data) {
  return data.m.frame && data.m.frame.crs ? { x: 'East', y: 'North', z: 'Height' } : { x: 'x', y: 'y', z: 'z' };
}

export function axisLetters(data) {
  return data.m.frame && data.m.frame.crs ? { x: 'E', y: 'N', z: 'H' } : { x: 'x', y: 'y', z: 'z' };
}

export function groundPerFootprint(data) {
  return !!(data.m.grid && data.m.grid.ground && data.m.grid.ground.mode === 'per_cell');
}

export function axisTitle(data, axis) {
  const names = axisNames(data);
  const { cell, dz } = data.grid;
  if (axis !== 'z') return `${names[axis]}: steps of one ${cell} m prediction column`;
  const per = groundPerFootprint(data);
  const name = names.z === 'Height' ? 'Height' : `${names.z}, height`;
  return `${name} above ${per ? 'each column’s' : 'the'} ground: ${dz} m height bins${per ? ', one bin follows the terrain' : ''}`;
}

export function edgeOf(data, axis, e) {
  const { x0, y0, cell, dz } = data.grid;
  if (axis === 'z') return e * dz;
  return (axis === 'x' ? x0 : y0) + e * cell;
}

function metres(v, compact = false) {
  const r = Math.round(v * 10) / 10;
  const s = compact && Number.isInteger(r) ? String(Math.abs(r)) : Math.abs(r).toFixed(1);
  return r < 0 ? `−${s}` : s;
}

function height(v) {
  return Number.isInteger(v) ? String(v) : metres(v);
}

export function edgeText(data, axis, e) {
  const v = edgeOf(data, axis, e);
  if (axis === 'z') return `${height(v)} m above the ${groundPerFootprint(data) ? 'column’s ' : ''}ground`;
  return `${metres(v)} m`;
}

export function rangeText(data, axis, r) {
  const n = axisSize(data, axis);
  const [lo, hi] = r || [0, n - 1];
  const a = edgeOf(data, axis, lo);
  const b = edgeOf(data, axis, hi + 1);
  const [one, many] = UNITS[axis];
  const k = hi - lo + 1;
  const nb = (s) => s.replace(/ /g, ' ');
  const count = nb(r ? `${k} of ${n} ${n === 1 ? one : many}` : `all ${n} ${n === 1 ? one : many}`);
  if (axis === 'z') return `${nb(`${height(a)}–${height(b)} m`)}${groundPerFootprint(data) ? ' above each column’s ground' : ''} · ${count}`;
  return `${nb(`${metres(a)} … ${metres(b)} m`)} · ${count}`;
}

export function clipSummary(data, st) {
  const clip = makeClip(data, st);
  const letters = axisLetters(data);
  const parts = [];
  for (const axis of AXES) {
    const r = clip[axis];
    if (!r) continue;
    const a = edgeOf(data, axis, r[0]);
    const b = edgeOf(data, axis, r[1] + 1);
    const span = axis === 'z' ? `${height(a)}–${height(b)}` : `${metres(a, true)}…${metres(b, true)}`;
    parts.push(`${letters[axis]}\u00a0${span}\u00a0m`);
  }
  return parts.join(' · ');
}

export function clipBounds(data, st) {
  const fit = data.fitBounds();
  const min = [...fit.min];
  const max = [...fit.max];
  const clip = makeClip(data, st);
  if (clip.x) { min[0] = edgeOf(data, 'x', clip.x[0]); max[0] = edgeOf(data, 'x', clip.x[1] + 1); }
  if (clip.y) { min[1] = edgeOf(data, 'y', clip.y[0]); max[1] = edgeOf(data, 'y', clip.y[1] + 1); }
  if (clip.z) {
    const { nx, ny } = data.grid;
    const [xlo, xhi] = clip.x || [0, nx - 1];
    const [ylo, yhi] = clip.y || [0, ny - 1];
    let gmin = Infinity;
    let gmax = -Infinity;
    for (let iy = ylo; iy <= yhi; iy++) {
      for (let ix = xlo; ix <= xhi; ix++) {
        const g = data.groundAt(ix, iy);
        gmin = Math.min(gmin, g);
        gmax = Math.max(gmax, g);
      }
    }
    if (!Number.isFinite(gmin)) gmin = gmax = data.ground0;
    const lo = gmin + edgeOf(data, 'z', clip.z[0]);
    const hi = gmax + edgeOf(data, 'z', clip.z[1] + 1);
    const cutLo = Math.max(fit.min[2], lo);
    const cutHi = Math.min(fit.max[2], hi);
    [min[2], max[2]] = cutHi > cutLo ? [cutLo, cutHi] : [lo, hi];
  }
  return { min, max };
}
