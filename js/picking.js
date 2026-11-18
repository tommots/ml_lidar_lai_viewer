import { Vector3 } from 'three';
import { fmt, fmtSigned, rafThrottle } from './ui.js';
import { voxelKey, compareKey, rasterKey, compareRasterKey, voxelThreshold, scaleFor } from './viewstate.js';
import { keepXY, voxelTests } from './clip.js';

export function voxelFilter(thr, abs) {
  return (v) => (abs ? Math.abs(v) >= thr && Math.abs(v) > 1e-9 : v >= thr && v > 1e-9);
}

const OCCLUDER_MIN_ALPHA = 0.1;

export function occluderFilter(d, st, src) {
  const drawn = voxelFilter(voxelThreshold(d, st, src), src.type === 'error');
  const alpha = scaleFor(d, st, src, 'partial').alpha;
  return alpha ? (v) => drawn(v) && alpha(v) >= OCCLUDER_MIN_ALPHA : drawn;
}

export function pickAt(app, clientX, clientY) {
  if (!app.cur) return null;
  const r = app.viewer.rayAt(clientX, clientY);
  if (!r) return null;
  const st = app.store.state;
  const d = app.cur.data;
  const view = r.vp.id;
  const vSrc = d.source(view === 'cmp' ? compareKey(d, st) : voxelKey(d, st));
  const rSrc = d.source(view === 'cmp' ? compareRasterKey(d, st) : rasterKey(d, st));
  const res = { view, vp: r.vp, x: r.x, y: r.y, ray: r.ray, vSrc, rSrc };
  const clip = app.cur.clip;
  if (st.showVoxels && vSrc) {
    const visible = voxelFilter(voxelThreshold(d, st, vSrc), vSrc.type === 'error');
    const hit = d.raycastVoxels(r.ray, vSrc, visible, voxelTests(clip, vSrc));
    if (hit) {
      const [cx, cy] = d.cellCenter(hit.ix, hit.iy, vSrc.grid);
      return {
        ...res, voxel: hit, fp: d.cellOf(cx, cy), point: r.ray.at(hit.t, new Vector3()),
        grid: vSrc.grid, cell: [hit.ix, hit.iy], zCell: vSrc.rasterZ(hit.ix, hit.iy),
      };
    }
  }
  const src = (st.showRaster && rSrc) || (st.active ? d.source(`layer:${st.active}`) : null);
  const grid = src ? src.grid : d.grid;
  const zOf = src ? (src.rasterZ || src.groundAt) : d.rasterZ;
  const g = d.raycastGround(r.ray, grid, zOf);
  if (!g) return res;
  const extra = !!(src && src.extra);
  const inside = (extra ? src.inMask(g.ix, g.iy) : d.inMask(g.ix, g.iy)) && keepXY(clip, ...d.cellCenter(g.ix, g.iy, grid));
  if (!inside) return { ...res, groundPoint: g.point };
  const fp = extra ? d.cellOf(...d.cellCenter(g.ix, g.iy, grid)) : [g.ix, g.iy];
  return { ...res, fp, grid, cell: [g.ix, g.iy], zCell: zOf(g.ix, g.iy), groundPoint: g.point };
}

export function wireCanvas(app, el, env) {
  el.tabIndex = 0;
  el.setAttribute('role', 'application');
  el.setAttribute('aria-label', '3D view. Arrow keys pan, Shift and arrow keys rotate, plus and minus zoom, Home resets the view.');
  app.viewer.controls.listenToKeyEvents(el);
  el.addEventListener('keydown', (e) => {
    if (!app.cur) return;
    const v = app.viewer;
    if (['+', '=', '-', '_'].includes(e.key)) {
      e.preventDefault();
      const f = e.key === '-' || e.key === '_' ? 1.15 : 1 / 1.15;
      const t = v.controls.target;
      v.moveTo(v.camera.position.clone().sub(t).multiplyScalar(f).add(t), t.clone(), false);
    } else if (e.key === 'Home') {
      e.preventDefault();
      v.fit(app.cur.data.fitBounds(), 'oblique', true);
    }
  });

  const hover = rafThrottle((e) => onHover(app, el, env, e));
  let down = null;
  el.addEventListener('pointermove', hover);
  el.addEventListener('pointerleave', () => {
    app.tooltip.hide();
    setHoverOutline(app, null);
  });
  el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; app.tooltip.hide(); });
  el.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const dt = performance.now() - down.t;
    down = null;
    if (moved < 5 && dt < 600 && e.button === 0) {
      const p = pickAt(app, e.clientX, e.clientY);
      const d = app.cur && app.cur.data;
      app.store.set({ footprint: p && p.fp && d && d.inMask(p.fp[0], p.fp[1]) ? p.fp : null });
    }
  });
  el.addEventListener('dblclick', (e) => onDoubleClick(app, e));
}

export function setHoverOutline(app, hov) {
  const key = hov ? `${hov.view}|${hov.grid.x0}|${hov.grid.y0}|${hov.grid.cell}|${hov.ix}|${hov.iy}|${hov.z.toFixed(3)}` : '';
  if (key === (app.hoverKey || '')) return;
  app.hoverKey = key;
  if (!app.cur) return;
  app.cur.markers.setHover(hov);
  app.viewer.requestRender();
}

function onHover(app, el, env, e) {
  if (!app.cur || e.buttons) { app.tooltip.hide(); return; }
  const p = pickAt(app, e.clientX, e.clientY);
  const d = app.cur.data;
  if (!p || !p.fp || !d.inMask(p.fp[0], p.fp[1])) {
    app.tooltip.hide();
    setHoverOutline(app, null);
    el.style.cursor = '';
    return;
  }
  const host = env.viewport.getBoundingClientRect();
  const at = { x: e.clientX - host.left, y: e.clientY - host.top, bounds: { w: host.width, h: host.height } };
  const tipKey = `${p.view}|${p.fp}|${p.voxel ? p.voxel.k : '-'}|${p.vSrc ? p.vSrc.key : ''}`;
  if (app.tooltip.key === tipKey && !app.tooltip.el.hidden) {
    app.tooltip.move(at.x, at.y, at.bounds);
    return;
  }
  const st = app.store.state;
  const textColor = env.cssVar('--text');
  const rows = [];
  let title = `Prediction column (${p.fp[0]}, ${p.fp[1]})`;
  if (p.voxel) {
    const dz = p.vSrc.grid.dz;
    title += ` · ${fmtH(p.voxel.k * dz)}–${fmtH((p.voxel.k + 1) * dz)} m`;
    if (p.vSrc.extra) title += ` · ${p.vSrc.label}`;
    const err = p.vSrc.type === 'error';
    rows.push({ value: err ? fmtSigned(p.voxel.value, 3) : fmt(p.voxel.value, 3), label: `partial LAI · ${p.vSrc.short}`, color: p.vSrc.color || null });
  }
  const rSrc = d.source(p.view === 'cmp' ? compareRasterKey(d, st) : rasterKey(d, st));
  const c = !rSrc || !rSrc.total ? null : (rSrc.grid === d.grid ? p.fp : (p.cell && p.grid === rSrc.grid ? p.cell : null));
  if (c) {
    const v = rSrc.total[c[1] * rSrc.grid.nx + c[0]];
    const err = rSrc.type === 'error';
    const base = rSrc.layerId ? d.layer(rSrc.layerId) : null;
    const plain = rSrc.extra || (base && base.kind === 'truth');
    rows.push({ value: err ? fmtSigned(v, 2) : fmt(v, 2), label: `total LAI · ${rSrc.short}`, color: plain ? textColor : (rSrc.color || null) });
    if (d.truth && base && base.kind === 'model' && !err && rSrc.grid === d.grid) {
      const tt = d.totalAt(d.truth.id, p.fp);
      rows.push({ value: fmt(tt, 2), label: `total LAI · ${d.truth.short}`, color: textColor });
      rows.push({ value: fmtSigned(v - tt, 2), label: 'prediction − label' });
    }
  }
  app.tooltip.show(at.x, at.y, { title, rows, note: 'Click: profile of this column · double-click: orbit here' }, at.bounds, tipKey);
  setHoverOutline(app, {
    view: p.view, ix: p.cell ? p.cell[0] : p.fp[0], iy: p.cell ? p.cell[1] : p.fp[1], grid: p.grid || d.grid,
    z: p.zCell ?? d.rasterZ(p.fp[0], p.fp[1]),
  });
  el.style.cursor = 'pointer';
}

function onDoubleClick(app, e) {
  if (!app.cur) return;
  const v = app.viewer.viewAt(e.clientX, e.clientY);
  if (!v) return;
  const cam = app.viewer.camera;
  app.viewer.applyProjection(v.vp);
  cam.updateMatrixWorld();
  let point = app.store.state.showPoints ? app.cur.points.pick(cam, v.vp, v.x, v.y, 8) : null;
  if (!point) {
    const p = pickAt(app, e.clientX, e.clientY);
    if (p && p.point) point = p.point;
    else if (p && p.groundPoint) point = new Vector3(...p.groundPoint);
  }
  if (point) app.viewer.focusOn(point);
}

function fmtH(v) {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
