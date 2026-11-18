import { Vector3 } from 'three';
import { Viewer } from './scene.js';
import { Store, DEFAULTS, ITEM_KEYS, parseHash, buildHash } from './state.js';
import { loadCatalog, reloadCatalog, requestPrepare, JobTracker, jobActive, jobFailed, KIND_LABELS, KIND_TABS } from './catalog.js';
import { itemBase, fetchJSON, fetchArrayBuffer, parseGrids, PointStream, FORMAT_VERSION } from './loader.js';
import { ItemData, DOI_RE } from './itemdata.js';
import { OPERATOR } from './operator.js';
import { PointCloud } from './points.js';
import { VoxelResources, VoxelLayer } from './voxels.js';
import { RasterResources, RasterLayer } from './raster.js';
import { MarkerLayer } from './markers.js';
import { LabelLayer } from './labels.js';
import { renderLegends, Gizmo, ScaleBar, LoadingBar, Tooltip } from './overlays.js';
import { Picker, itemStatus } from './picker.js';
import { LayersPanel, FoldPanel, TransectPanel, ViewsPanel, ModelsPanel, DetailsPanel, capText } from './panels.js';
import { h, clear, debounce, rafThrottle, toast, storage, icon, fmtMillions, fmtDuration, coarsePointer } from './ui.js';
import {
  voxelKey, compareKey, rasterKey, compareRasterKey, itemDefaults, itemState, hashPatch, sameFrame,
  scaleFor, legendEntries, voxelThreshold, listedLayers, effectiveSeries, defaultLayers, seriesHolds,
} from './viewstate.js';
import { seriesKeyIn, listedIn } from './series.js';
import { wireCanvas, occluderFilter } from './picking.js';
import { makeClip, cellTest, voxelTests, clipBounds } from './clip.js';

const $ = (id) => document.getElementById(id);
const DEFAULT_BUDGET = coarsePointer() ? 1_000_000 : 3_000_000;
const NARROW = window.matchMedia('(max-width: 899px)');
const PHONE = window.matchMedia('(max-width: 520px)');
const HANDHELD = window.matchMedia('(max-width: 520px), (max-height: 500px)');

const app = {
  store: null,
  viewer: null,
  catalog: null,
  cur: null,
  loadToken: 0,
  pendingLoad: null,
  pendingOpts: null,
  jobItems: new Map(),
  timings: {},
  hashReady: false,
  legend: [],
  legendCompact: new Map(),
  emptyKind: null,
};

async function init() {
  setBodyState('init');
  syncLayerChips(DEFAULTS);
  const set = document.documentElement.dataset.theme;
  const theme = set === 'light' || set === 'dark' ? set
    : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = theme;
  app.theme = theme;
  updateThemeButton();
  if (!Viewer.supported()) {
    showEmpty('WebGL is not available', 'This viewer draws point clouds with WebGL. Please use a current browser with hardware acceleration enabled.', [], 'error');
    setBodyState('error');
    return;
  }
  app.store = new Store({ ...DEFAULTS, budget: DEFAULT_BUDGET, theme });
  app.viewer = new Viewer($('canvas-host'));
  app.viewer.setBackground(cssVar('--canvas-bg'));
  app.viewer.setInsetLeft(columnInset());
  app.viewer.onFrameChange = () => { if (app.cur) applyPointSize(); };
  app.viewer.contextHandlers.lost = onContextLost;
  app.viewer.contextHandlers.restored = onContextRestored;
  app.labels = new LabelLayer($('labels'));
  app.gizmo = new Gizmo($('gizmo-host'));
  app.gizmo.onAxis = (axis) => turnView(axis);
  app.scaleBar = new ScaleBar($('scale-host'));
  app.loading = new LoadingBar($('loading'));
  app.tooltip = new Tooltip($('tooltip'));
  app.viewer.beforeRender.push(beforeRender);
  app.viewer.afterRender.push(afterRender);
  app.viewer.controls.addEventListener('change', () => writeHash());

  app.picker = new Picker($('picker'), { onSelect: (item, opts) => requestItem(item, { ...opts, push: true }) });
  app.layersPanel = new LayersPanel($('layers-panel'), app.store, {
    voxelKey: () => (app.cur ? voxelKey(app.cur.data, app.store.state) : ''),
    rasterKey: () => (app.cur ? rasterKey(app.cur.data, app.store.state) : ''),
    thresholdInfo: () => thresholdInfo(),
  });
  app.layersFold = new FoldPanel($('layers'), { title: 'Layers', body: $('layers-body'), key: 'lai-layers-folded', what: 'the layer switches', phone: HANDHELD });
  app.transect = new TransectPanel($('transect'), app.store, { phone: HANDHELD });
  app.views = new ViewsPanel($('views'), { show: (preset) => showView(preset), phone: HANDHELD });
  app.modelsPanel = new ModelsPanel($('models-panel'), app.store, {
    catalog: () => app.catalog,
    updating: (id) => app.pendingLoad === id,
    update: (id) => updateItem(id),
  });
  app.details = new DetailsPanel({ chart: $('chart'), totals: $('totals'), info: $('info'), back: $('btn-mean') }, app.store);
  app.store.subscribe(onState);
  wireChrome();
  wireCanvas(app, $('canvas-host'), { cssVar, viewport: $('viewport') });
  window.addEventListener('hashchange', applyHash);
  window.addEventListener('popstate', applyHash);

  const { state: hs, camera } = parseHash(location.hash);
  const general = { ...hs };
  delete general.itemId;
  for (const k of ITEM_KEYS) delete general[k];
  app.store.set(general, { source: 'init' });

  try {
    app.catalog = await loadCatalog();
  } catch (e) {
    console.warn('catalog failed', e);
    updateItemButton(null);
    showEmpty('No data', 'The data could not be loaded. Please reload the page.', [], 'error');
    setBodyState('error');
    return;
  }
  document.body.dataset.mode = app.catalog.mode;
  if (!app.catalog.preview || new URLSearchParams(location.search).has('debug')) exposeDebugHook();
  syncPickerSeries();
  app.picker.setCatalog(app.catalog);
  fillPreviewHelp(app.catalog);
  $('preview-badge').hidden = !app.catalog.preview;
  document.body.classList.toggle('preview', !!app.catalog.preview);
  if (app.catalog.preview) $('preview-badge').title = 'Preview version: a selection of the data (see the Help)';
  app.jobs = new JobTracker({ onUpdate: onJobUpdate, onFinished: onJobFinished });
  for (const it of app.catalog.items) if (it.job && jobActive(it.job)) trackJob(it.job, it.id);
  if (!storage.get('lai-seen-help', false)) showHelpHint();

  const fromHash = hs.itemId && app.catalog.byId.get(hs.itemId);
  if (hs.itemId && !fromHash) toast(`The linked view is ${notHere()}; showing another one.`, { kind: 'error', timeout: 6000 });
  app.lastAppliedHash = location.hash;
  let first = fromHash || defaultItem();
  if (fromHash && itemStatus(fromHash) !== 'ready' && !app.catalog.canPrepare) {
    toast(`${fromHash.short_label || fromHash.label} is ${notHere()}; showing another view.`, { kind: 'error', timeout: 6000 });
    first = defaultItem();
  }
  if (!first) {
    showNoItem();
    return;
  }
  const linked = first === fromHash;
  requestItem(first, { hashState: linked ? hs : { ...hs, itemId: first.id }, camera: linked ? camera : null });
}

function defaultItem() {
  const cat = app.catalog;
  const series = seriesKeyIn(cat.series, app.store.state.series);
  const preferred = cat.byId.get(cat.defaultItem || OPERATOR.defaultItem);
  if (preferred && listedIn(preferred, series, cat.series, cat.models)
      && (preferred.status === 'ready' || cat.canPrepare)) return preferred;
  const ready = cat.items.filter((i) => i.status === 'ready');
  const listed = ready.filter((i) => listedIn(i, series, cat.series, cat.models));
  const prefer = (list, k) => list.find((i) => i.kind === k);
  return prefer(listed, 'ecosense') || prefer(listed, 'synthetic') || listed[0]
    || prefer(ready, 'ecosense') || prefer(ready, 'synthetic') || ready[0] || null;
}

function showNoItem() {
  const cat = app.catalog;
  updateItemButton(null);
  app.transect.clear();
  app.views.clear();
  setBodyState('empty');
  if (!cat || !cat.items.length) {
    showEmpty('No data', cat && cat.mode === 'server'
      ? OPERATOR.noData
      : 'No data available.', [], 'none');
  } else if (cat.canPrepare) {
    const est = fmtDuration(Math.max(...cat.items.map((i) => i.est_seconds || 20))) || '~20 s';
    const anyReady = cat.items.some((i) => i.status === 'ready');
    showEmpty('Choose the data', (anyReady ? OPERATOR.chooseSome : OPERATOR.chooseAny).replace('{est}', est),
    [{ label: 'Choose the data', primary: true, onclick: openPicker }], 'none');
  } else {
    showEmpty('No data ready', OPERATOR.noneReady, [], 'none');
  }
}

function requestItem(item, opts = {}) {
  const st = itemStatus(item);
  closeDrawerOnNarrow();
  if (st === 'ready' && !opts.retry) {
    loadItem(item.id, opts);
    return;
  }
  if (!app.catalog.canPrepare) {
    toast(`This view is ${notHere()}.`);
    return;
  }
  app.pendingLoad = item.id;
  app.pendingOpts = opts;
  if (st === 'running' || st === 'queued') {
    showPreparing(item);
    return;
  }
  item.status = 'queued';
  item.job = { id: `pending-${item.id}`, status: 'queued', progress: 0, message: 'starting…' };
  app.picker.render();
  showPreparing(item);
  requestPrepare(item.id, st === 'failed' || !!opts.retry).then((job) => {
    item.job = job;
    trackJob(job, item.id);
    app.picker.render();
  }).catch((e) => {
    item.status = 'failed';
    item.job = { id: '', status: 'failed', error: e.message };
    app.picker.render();
    if (app.pendingLoad === item.id) endPending();
    toast(`${item.short_label || item.label} could not be loaded: ${e.message}`, { kind: 'error' });
  });
}

function trackJob(job, itemId) {
  app.jobItems.set(job.id, itemId);
  app.jobs.track(job);
}

function syncPickerSeries() {
  if (!app.catalog) return;
  const st = app.store.state;
  app.picker.setSeries(app.cur ? effectiveSeries(app.cur.data, st) : seriesKeyIn(app.catalog.series, st.series));
}

function showPreparing(item) {
  const p = Number(item.job?.progress) || 0;
  const msg = item.job?.message ? ` — ${item.job.message}` : '';
  if (app.emptyKind !== 'context') hideEmpty();
  if (!app.cur) updateItemButton(null, `Loading ${item.short_label || item.label}…`);
  app.loading.show(`Loading ${item.short_label || item.label} · ${Math.round(p * 100)} %${msg}`, p);
}

function endPending() {
  app.pendingLoad = null;
  app.pendingOpts = null;
  app.loading.hide();
  if (!app.cur) showNoItem();
  else app.modelsPanel.render(app.store.state);
}

function updateItem(id) {
  const item = app.catalog && app.catalog.byId.get(id);
  if (!item || !app.catalog.canPrepare) return;
  requestItem(item, { retry: true });
  app.modelsPanel.render(app.store.state);
}

function onJobUpdate(job) {
  const id = app.jobItems.get(job.id);
  const item = id && app.catalog.byId.get(id);
  if (!item) return;
  item.job = job;
  item.status = String(job.status).toLowerCase() === 'queued' ? 'queued' : 'running';
  app.picker.render();
  if (app.pendingLoad === id) showPreparing(item);
}

async function onJobFinished(job, ok) {
  const id = app.jobItems.get(job.id);
  app.jobItems.delete(job.id);
  let fresh = null;
  try {
    fresh = await reloadCatalog(app.catalog.mode);
    app.catalog = fresh;
    app.picker.setCatalog(fresh);
    for (const it of fresh.items) if (it.job && jobActive(it.job) && !app.jobs.jobs.has(it.job.id)) trackJob(it.job, it.id);
  } catch (e) {  }
  const item = id && app.catalog.byId.get(id);
  if (!item) {
    if (app.pendingLoad === id) endPending();
    return;
  }
  const label = item.short_label || item.label;
  const waiting = app.pendingLoad === id;
  const reason = (fresh && item.job && (item.job.error || (jobFailed(item.job) && item.job.message))) || job.error || job.message || 'unknown error';
  if (!fresh && ok && !job.lost && !jobFailed(job)) {
    item.status = 'ready';
    item.job = null;
    app.picker.render();
    if (waiting) loadItem(id, app.pendingOpts || {});
    return;
  }
  if (item.status === 'ready' && !jobActive(item.job)) {
    if (waiting && !job.lost && (!ok || jobFailed(job))) {
      endPending();
      toast(`Updating ${label} failed: ${reason}. The shown data are unchanged.`, { kind: 'error', timeout: 7000 });
      return;
    }
    if (waiting) loadItem(id, app.pendingOpts || {});
    return;
  }
  const st = itemStatus(item);
  if (fresh && (st === 'running' || st === 'queued')) {
    if (waiting) showPreparing(item);
    return;
  }
  const lost = !!job.lost;
  const failed = !lost && (!ok || jobFailed(job) || item.status === 'failed');
  if (failed) {
    item.status = 'failed';
    item.job = { ...(item.job || {}), id: job.id, status: 'failed', error: reason };
    app.picker.render();
    if (waiting) {
      endPending();
      toast(`Loading ${label} failed: ${reason}`, { kind: 'error', timeout: 7000 });
    }
    return;
  }
  if (!fresh) item.status = 'missing';
  if (!jobActive(item.job)) item.job = null;
  app.picker.render();
  if (waiting) {
    endPending();
    toast(lost ? OPERATOR.jobLostToast.replace('{label}', label)
      : `${label} is not ready. Choose it again to retry.`, { kind: 'error', timeout: 7000 });
  }
}

async function loadItem(id, opts = {}) {
  const token = ++app.loadToken;
  app.pendingLoad = null;
  app.pendingOpts = null;
  const t0 = performance.now();
  app.timings[id] = { start: t0 };
  const catItem = app.catalog.byId.get(id);
  const label = catItem ? (catItem.short_label || catItem.label) : id;
  if (app.loadCtrl) app.loadCtrl.abort();
  const ctrl = new AbortController();
  app.loadCtrl = ctrl;
  setBodyState('loading');
  if (app.emptyKind !== 'context') hideEmpty();
  if (!app.cur) updateItemButton(null, `Loading ${label}…`);
  app.loading.show(`Loading ${label}…`, null);
  try {
    const base = itemBase(id);
    const manifest = await fetchJSON(`${base}manifest.json`, { signal: ctrl.signal });
    if (token !== app.loadToken) return;
    if (manifest.format_version !== FORMAT_VERSION) throw new Error(`unsupported format version ${manifest.format_version}`);
    app.timings[id].manifest = performance.now() - t0;
    app.loading.show(`Loading ${label} · LAI values`, 0);
    const buf = await fetchArrayBuffer(`${base}${manifest.grids.file}`, {
      signal: ctrl.signal, expected: manifest.grids.bytes,
      onProgress: (l, t) => app.loading.show(`Loading ${label} · LAI values`, t ? (l / t) * 0.05 : null),
    });
    if (token !== app.loadToken) return;
    const data = new ItemData(id, manifest, parseGrids(buf, manifest.grids), {
      series: app.catalog.series, models: app.catalog.models, entry: app.catalog.byId.get(id) || null,
      groups: app.catalog.groups, preview: app.catalog.preview,
    });
    app.timings[id].grids = performance.now() - t0;
    const prev = app.cur ? app.cur.data : null;
    teardownItem();
    buildItem(data);
    if (opts.push && prev && prev.id !== id) {
      history.pushState(null, '', `#item=${encodeURIComponent(id)}`);
      app.lastAppliedHash = location.hash;
    }
    const patch = itemState(data, opts.hashState || {}, prev, app.store.state, DEFAULT_BUDGET);
    app.store.set(patch, { source: 'item' });
    app.cur.defaults = itemDefaults(data, DEFAULT_BUDGET);
    if (opts.camera) {
      app.viewer.fit(data.fitBounds(), 'oblique', false);
      app.viewer.setCameraState(opts.camera);
    } else if (!sameFrame(prev, data)) app.viewer.fit(data.fitBounds(), 'oblique', false);
    app.layersPanel.setItem(data);
    app.transect.setItem(data);
    app.views.setItem(data);
    app.modelsPanel.setItem(data);
    app.details.setItem(data);
    applyAll();
    syncPickerSeries();
    app.picker.setCurrent(id);
    updateItemButton(data);
    document.title = `${data.short} · LAI canopy viewer`;
    $('viewport').setAttribute('aria-label', `3D view of ${data.label}`);
    startStream(token);
    app.hashReady = true;
    writeHash();
  } catch (e) {
    if (e.name === 'AbortError' || token !== app.loadToken) return;
    console.warn('load failed', e);
    app.loading.hide();
    const actions = [{ label: 'Try again', icon: 'retry', primary: true, onclick: () => loadItem(id, opts) }];
    if (app.cur) app.loadToken = app.cur.token;
    if (app.cur) {
      actions.push({ label: `Back to ${app.cur.data.short}`, onclick: () => { hideEmpty(); setBodyState(app.cur && app.cur.ready ? 'ready' : 'loading'); } });
    } else {
      updateItemButton(null);
      app.transect.clear();
      app.views.clear();
    }
    showEmpty(`Could not load ${label}`, 'The data could not be loaded. Please try again or reload the page.', actions, 'error');
    setBodyState('error');
  }
}

function buildItem(data) {
  const v = app.viewer;
  const cur = { data, ready: false };
  cur.points = new PointCloud(data.m.points, { theme: app.theme, floatTextures: v.floatTextures });
  cur.points.setCellMask(data.grid, data.mask);
  cur.points.setCellGround(data.grid, data.groundAt, data.ground0);
  cur.voxRes = new VoxelResources();
  cur.rasRes = new RasterResources();
  cur.vox = { main: new VoxelLayer(cur.voxRes, 'voxels-main'), cmp: new VoxelLayer(cur.voxRes, 'voxels-cmp') };
  cur.ras = { main: new RasterLayer(cur.rasRes, 'raster-main'), cmp: new RasterLayer(cur.rasRes, 'raster-cmp') };
  cur.markers = new MarkerLayer(data, app.theme);
  cur.clip = makeClip(data, {});
  v.shared.add(cur.points.group, cur.markers.group);
  v.views.main.add(cur.vox.main.group, cur.ras.main.group);
  v.views.cmp.add(cur.vox.cmp.group, cur.ras.cmp.group);
  const axisLabels = data.m.frame && data.m.frame.crs ? ['E', 'N', 'z'] : ['x', 'y', 'z'];
  app.gizmo.setLabels(axisLabels);
  app.labels.set('markers', cur.markers.labels, { declutter: true, blocker: true, occluded: markerOccluded });
  app.cur = cur;
  app.hoverKey = '';
  document.body.classList.add('has-item');
}

function teardownItem(dispose = true) {
  const cur = app.cur;
  if (!cur) return;
  if (cur.stream) cur.stream.close();
  const v = app.viewer;
  v.shared.clear();
  v.views.main.clear();
  v.views.cmp.clear();
  if (dispose) {
    cur.points.dispose();
    cur.vox.main.dispose();
    cur.vox.cmp.dispose();
    cur.ras.main.dispose();
    cur.ras.cmp.dispose();
    cur.voxRes.dispose();
    cur.rasRes.dispose();
    cur.markers.dispose();
  }
  app.labels.clear();
  app.tooltip.hide();
  app.cur = null;
}

function startStream(token) {
  const cur = app.cur;
  const data = cur.data;
  const id = data.id;
  const label = data.short;
  cur.token = token;
  cur.stream = new PointStream(itemBase(id), data.m.points, {
    onChunk: (chunk) => {
      if (app.cur !== cur) return;
      cur.points.addChunk(chunk);
      if (chunk.index === 0) {
        updateLegends();
        app.timings[id].firstChunk = performance.now() - app.timings[id].start;
      }
      app.viewer.requestRender();
    },
    onProgress: (p) => {
      if (app.cur !== cur || token !== app.loadToken || app.pendingLoad) return;
      const frac = Math.min(1, (p.loadedPoints + p.fraction * (data.m.points.chunks[p.chunk]?.count || 0)) / Math.max(1, p.target));
      app.loading.show(`Loading ${label} · ${fmtMillions(p.loadedPoints)} of ${fmtMillions(p.target)} points`, 0.05 + 0.95 * frac);
    },
    onIdle: () => {
      if (app.cur !== cur) return;
      if (token === app.loadToken && !app.pendingLoad) app.loading.hide();
      if (!cur.ready) {
        cur.ready = true;
        app.timings[id].ready = performance.now() - app.timings[id].start;
        app.viewer.requestRender();
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (token === app.loadToken && app.cur === cur) setBodyState('ready');
        }));
      }
    },
    onError: (e) => {
      if (app.cur !== cur) return;
      if (token === app.loadToken && !app.pendingLoad) app.loading.hide();
      console.warn('points failed', e);
      toast('Loading the points failed. Please reload the page.', { kind: 'error', timeout: 6000 });
      if (token === app.loadToken) setBodyState('ready');
    },
  });
  cur.stream.setBudget(app.store.state.budget);
}

function thresholdInfo() {
  if (!app.cur) return { error: false, max: 1 };
  const st = app.store.state;
  const d = app.cur.data;
  const src = d.source(voxelKey(d, st));
  if (!src || src.type !== 'error') return { error: false, max: 1 };
  return { error: true, max: scaleFor(d, st, src, 'partial').max };
}

const POINT_KEYS = new Set(['showPoints', 'colorBy', 'singleColor', 'pointSize', 'attenuate', 'pointOpacity', 'budget', 'xRange', 'yRange', 'zRange', 'hideGround']);
const VOX_KEYS = new Set(['active', 'compareLayer', 'voxMode', 'threshold', 'errThreshold', 'scaleMode', 'showVoxels', 'compare', 'voxOpacity', 'voxStyle', 'voxMap', 'showAllTiers', 'series', 'theme', 'xRange', 'yRange', 'zRange']);
const CLIP_KEYS = new Set(['xRange', 'yRange', 'zRange']);
const RAS_KEYS = new Set(['active', 'compareLayer', 'voxMode', 'rasterSrc', 'rasterMap', 'scaleMode', 'showRaster', 'rasterOpacity', 'compare', 'showVoxels', 'showAllTiers', 'series', 'theme', 'xRange', 'yRange']);
const HELPER_KEYS = new Set(['showGrid', 'showMarkers', 'showWall', 'showTerrain', 'showAxes', 'footprint']);
const PANEL_KEYS = new Set(['active', 'compareLayer', 'voxMode', 'showAllTiers', 'hiddenLayers', 'shownCalibrated', 'footprint', 'series', 'theme']);
const LEGEND_KEYS = ['colorBy', 'hideGround', 'showPoints', 'showVoxels', 'showRaster', 'active', 'compareLayer', 'voxMode', 'rasterSrc', 'scaleMode', 'voxMap', 'rasterMap', 'compare', 'showAllTiers', 'series', 'theme'];

function syncLayerChips(st) {
  for (const btn of document.querySelectorAll('[data-layer]')) btn.setAttribute('aria-pressed', String(!!st[btn.dataset.layer]));
}

function onState(changed, st, meta) {
  if (['showPoints', 'showVoxels', 'showRaster'].some((k) => changed.has(k))) syncLayerChips(st);
  if (changed.has('compare')) {
    app.viewer.setCompare(st.compare);
    $('btn-compare').setAttribute('aria-pressed', String(st.compare));
    document.body.classList.toggle('comparing', st.compare);
  }
  if (changed.has('compare') || changed.has('showAxes')) fitOverlays();
  if (!app.cur || meta.source === 'item') return;
  const has = (set) => [...changed].some((k) => set.has(k));
  if (changed.has('theme')) {
    app.cur.points.setTheme(st.theme);
    app.cur.markers.setTheme(st.theme);
  }
  if (has(CLIP_KEYS)) {
    app.cur.clip = makeClip(app.cur.data, st);
    app.cur.markers.setClip(app.cur.clip);
  }
  if (has(POINT_KEYS)) applyPoints(changed);
  if (has(VOX_KEYS)) applyVoxels();
  if (has(RAS_KEYS)) applyRaster();
  if (has(HELPER_KEYS)) applyHelpers();
  if (has(PANEL_KEYS)) {
    app.modelsPanel.render(st);
    app.details.update(st);
  } else if (changed.has('zRange')) app.details.renderChart(st);
  if (changed.has('series')) {
    app.layersPanel.refreshSources(st);
    syncPickerSeries();
  }
  if (['active', 'compareLayer', 'voxMode', 'compare', 'series', 'theme'].some((k) => changed.has(k))) updateCompareLabels();
  if (LEGEND_KEYS.some((k) => changed.has(k))) updateLegends();
  app.layersPanel.sync(st);
  app.transect.sync(st);
  app.viewer.requestRender();
  writeHash();
}

function applyAll() {
  app.cur.clip = makeClip(app.cur.data, app.store.state);
  app.cur.markers.setClip(app.cur.clip);
  applyPoints(null);
  applyVoxels();
  applyRaster();
  applyHelpers();
  app.viewer.setCompare(app.store.state.compare);
  updateCompareLabels();
  updateLegends();
  app.modelsPanel.render(app.store.state);
  app.details.update(app.store.state);
  app.layersPanel.sync(app.store.state);
  app.transect.sync(app.store.state);
  app.viewer.requestRender();
}

function applyPointSize() {
  const st = app.store.state;
  app.cur.points.setSize(st.pointSize, st.attenuate, app.viewer.renderer.getPixelRatio(), app.viewer.refDistance);
}

function applyPoints(changed) {
  const st = app.store.state;
  const p = app.cur.points;
  const all = !changed;
  p.group.visible = st.showPoints;
  if (all || changed.has('colorBy') || changed.has('singleColor')) p.setColorBy(st.colorBy, st.singleColor);
  applyPointSize();
  p.setOpacity(st.pointOpacity);
  p.setClip(app.cur.clip);
  p.setHideGround(st.hideGround);
  p.setHClip(app.cur.data.cylinder ? 'cells' : 'none');
  if (all || changed.has('budget')) {
    p.setBudget(st.budget);
    if (app.cur.stream) app.cur.stream.setBudget(st.budget);
  }
}

function applyVoxels() {
  const st = app.store.state;
  const cur = app.cur;
  const d = cur.data;
  cur.voxRes.setStyle(st.voxStyle, st.voxOpacity);
  const build = (layer, key) => {
    const src = d.source(key);
    if (!st.showVoxels || !src) { layer.build(null); return; }
    const sc = scaleFor(d, st, src, 'partial');
    layer.build(src, { threshold: voxelThreshold(d, st, src), color: sc.color, alpha: sc.alpha, keep: voxelTests(cur.clip, src) });
  };
  build(cur.vox.main, voxelKey(d, st));
  if (st.compare) build(cur.vox.cmp, compareKey(d, st));
  else cur.vox.cmp.build(null);
}

function applyRaster() {
  const st = app.store.state;
  const cur = app.cur;
  const d = cur.data;
  cur.rasRes.setStyle(st.rasterOpacity, !d.cylinder, st.rasterMap === 'fade_greens');
  const build = (layer, key) => {
    const src = d.source(key);
    if (!st.showRaster || !src) {
      layer.build(null);
      return;
    }
    const sc = scaleFor(d, st, src, 'total');
    const keep = cur.clip.x || cur.clip.y ? cellTest(cur.clip, src.grid) : null;
    layer.build(src, { color: sc.color, alpha: sc.alpha, keep });
  };
  build(cur.ras.main, rasterKey(d, st));
  if (st.compare) build(cur.ras.cmp, compareRasterKey(d, st));
  else cur.ras.cmp.build(null);
}

function applyHelpers() {
  const st = app.store.state;
  const cur = app.cur;
  cur.markers.setVisible({ markers: st.showMarkers, grid: st.showGrid, terrain: st.showTerrain, wall: st.showWall !== false });
  app.labels.setVisible('markers', st.showMarkers);
  cur.markers.setSelection(st.footprint);
  $('gizmo-wrap').hidden = !st.showAxes;
}

const _dir = new Vector3();

function markerOccluded(it, vpId) {
  const cur = app.cur;
  const st = app.store.state;
  if (!cur || !it.ground || !st.showVoxels) return false;
  const d = cur.data;
  const src = d.source(vpId === 'cmp' ? compareKey(d, st) : voxelKey(d, st));
  if (!src || !src.profile) return false;
  const o = app.viewer.camera.position;
  _dir.set(it.x - o.x, it.y - o.y, it.z - o.z);
  const dist = _dir.length();
  if (dist < 1e-6) return false;
  _dir.divideScalar(dist);
  const hit = d.raycastVoxels({ origin: o, direction: _dir }, src, occluderFilter(d, st, src), voxelTests(cur.clip, src));
  return !!hit && hit.t < dist - 0.1;
}

function turnView(axis) {
  if (!app.cur) return;
  if (app.viewer.isSettled()) app.viewer.turn(axis === 2 ? 'v' : 'h');
  else app.viewer.fit(app.cur.data.fitBounds(), 'oblique', true);
}

function showView(preset) {
  if (!app.cur) return;
  const d = app.cur.data;
  app.viewer.fit(clipBounds(d, app.store.state), preset, true, d.fitBounds());
}

function updateCompareLabels() {
  const st = app.store.state;
  const wrap = $('compare-labels');
  if (!app.cur || !st.compare) { wrap.hidden = true; return; }
  wrap.hidden = false;
  const d = app.cur.data;
  const sel = $('cmp-select');
  clear(sel);
  const listed = listedLayers(d, st);
  for (const l of listed) {
    const src = d.source(compareKey(d, { ...st, compareLayer: l.id }));
    sel.appendChild(h('option', { value: l.id }, src ? src.label : l.label));
  }
  if (!listed.length) sel.appendChild(h('option', { value: '' }, '–'));
  sel.disabled = !listed.length;
  sel.value = st.compareLayer || '';
  const right = d.source(voxelKey(d, st));
  $('cmp-right-text').textContent = right ? right.label : '–';
  paintSwatch($('cmp-right-swatch'), d.layer(st.active));
  paintSwatch($('cmp-left-swatch'), d.layer(st.compareLayer));
}

function paintSwatch(el, l) {
  const color = l && l.kind !== 'truth' ? l.color : cssVar('--text');
  const cal = !!(l && l.calibrated);
  el.classList.toggle('swatch-cal', cal);
  el.style.background = cal ? '' : color;
  el.style.setProperty('--c', color);
  el.style.visibility = l ? '' : 'hidden';
}

function updateLegends() {
  const st = app.store.state;
  const all = app.cur ? legendEntries(app.cur.data, st, app.cur.points.legend()) : [];
  const pref = storage.get('lai-legend-collapsed', null);
  const render = (collapsed, foldPoints) => {
    for (const e of all) {
      const own = app.legendCompact.get(e.key);
      e.compact = own !== undefined ? own : !!(e.compactDefault || (foldPoints && e.key === 'points'));
    }
    app.legend = all;
    const opts = {
      collapsed,
      onToggle: (c) => { storage.set('lai-legend-collapsed', c); updateLegends(); },
      onCompact: (key, c) => { app.legendCompact.set(key, c); updateLegends(); },
    };
    renderLegends($('legends'), st.compare ? all.filter((e) => e.side !== 'right') : all, opts);
    renderLegends($('legends-right'), st.compare ? all.filter((e) => e.side === 'right') : [], opts);
  };
  if (typeof pref === 'boolean') { render(pref, false); return; }
  if (PHONE.matches) { render(true, true); return; }
  render(false, false);
  if (legendsTooTall()) {
    render(false, true);
    if (legendsTooTall()) render(true, true);
  }
}

function legendsTooTall() {
  const limit = 0.4 * $('viewport').clientHeight;
  return ['legends', 'legends-right'].some((id) => !$(id).hidden && $(id).scrollHeight > limit);
}

const OVERLAY_GAP = 6;
const LOADING_MIN_W = 360;
const LOADING_H = 28;

function columnInset() {
  const left = parseFloat(getComputedStyle($('view-stack')).left) || 0;
  const w = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--col-w')) || 0;
  return left + w + OVERLAY_GAP;
}

const fitOverlays = rafThrottle(() => {
  const vp = $('viewport');
  const stack = $('view-stack');
  const rect = (el) => (el && el.getClientRects().length ? el.getBoundingClientRect() : null);
  stack.style.maxHeight = '';
  const v = vp.getBoundingClientRect();
  const gizmo = rect($('gizmo-wrap'));
  vp.style.setProperty('--gizmo-h', gizmo ? `${Math.ceil(gizmo.height + OVERLAY_GAP)}px` : '0px');
  let s = stack.getBoundingClientRect();
  const shares = (r) => !!r && r.left < s.right && r.right > s.left;
  let floor = (shares(gizmo) ? gizmo.top : v.bottom) - OVERLAY_GAP;
  const rows = rect($('transect-body'));
  const row = rect(document.querySelector('#transect .dual-row'));
  const bare = s.bottom - (rows ? rows.height : 0);
  const one = Math.min(s.bottom, bare + (row ? row.height : 0));
  const shared = [];
  for (const id of ['legends', 'legends-right']) {
    const el = $(id);
    el.style.maxHeight = '';
    const l = rect(el);
    if (!shares(l)) continue;
    shared.push([el, l]);
    const lowest = rect([...el.children].find((c) => c.getClientRects().length));
    const button = rect(el.querySelector('.legend-toggle'));
    if (!lowest) continue;
    const end = l.bottom - OVERLAY_GAP;
    const low = Math.ceil(lowest.height);
    const least = Math.min(low, button ? Math.ceil(button.height) : low);
    floor = Math.min(floor, Math.max(bare, Math.min(end - least, Math.max(one, end - low))));
  }
  if (rows) floor = Math.max(floor, one);
  if (s.bottom > floor) {
    stack.style.maxHeight = `${Math.max(0, Math.floor(floor - s.top))}px`;
    s = stack.getBoundingClientRect();
  }
  for (const [el, l] of shared) {
    const room = Math.floor(l.bottom - s.bottom - OVERLAY_GAP);
    if (l.height > room) el.style.maxHeight = `${Math.max(0, room)}px`;
  }
  const reach = s.bottom - v.top;
  const reserve = reach > 50 && s.height > 0 ? Math.ceil(s.right - v.left + OVERLAY_GAP) : 0;
  const lows = ['legends', 'legends-right', 'gizmo-wrap'].map((id) => rect($(id))).filter(Boolean);
  const below = reserve > 0 && v.width - reserve < LOADING_MIN_W
    && s.bottom + 2 * OVERLAY_GAP + LOADING_H <= Math.min(v.bottom, ...lows.map((r) => r.top));
  const panel = $('transect');
  const open = panel.hidden && !panel.classList.contains('folded') ? parseFloat(getComputedStyle(panel).width) : 0;
  const hint = open > 0 ? Math.ceil(s.left - v.left + open + OVERLAY_GAP) : 0;
  vp.style.setProperty('--stack-w', `${Math.max(reserve, hint)}px`);
  vp.style.setProperty('--loading-w', below ? '0px' : `${reserve}px`);
  vp.style.setProperty('--loading-top', below ? `${Math.ceil(reach + OVERLAY_GAP)}px` : '');
  app.viewer.setInsetLeft(columnInset());
});

function beforeRender(viewer) {
  const cur = app.cur;
  if (!cur) return;
  cur.vox.main.sortFor(viewer.camera);
  cur.vox.cmp.sortFor(viewer.camera);
}

function afterRender(viewer) {
  const vps = viewer.viewports();
  app.labels.update(viewer.camera, vps, (vp) => viewer.applyProjection(vp));
  if (app.cur) app.views.update(viewer.viewDir());
  if (app.store && app.store.state.showAxes) {
    app.gizmo.update(viewer.camera);
    app.scaleBar.update(viewer.camera, viewer.targetDistance(), vps[0].h, app.store.state.compare ? 60 : 130);
  }
  const cur = app.cur;
  if (cur) {
    const t = app.timings[cur.data.id];
    const now = performance.now() - t.start;
    if (cur.points.objects.length && t.firstPoints === undefined) t.firstPoints = now;
    if (cur.ready && t.readyFrame === undefined) t.readyFrame = now;
  }
}

const writeHash = debounce(() => {
  if (!app.cur || !app.hashReady) return;
  const st = app.store.state;
  const d = app.cur.data;
  const series = effectiveSeries(d, st);
  const defaults = { ...(app.cur.defaults || {}), ...defaultLayers(d, series) };
  const hash = seriesHolds(d, series) ? buildHash(st, app.viewer.getCameraState(), defaults)
    : buildHash({ ...st, series }, app.viewer.getCameraState(), { ...defaults, series: null });
  if (`#${hash}` !== location.hash) history.replaceState(null, '', `#${hash}`);
  app.lastAppliedHash = location.hash;
}, 350);

function applyHash() {
  if (!app.catalog) return;
  if (location.hash === app.lastAppliedHash) return;
  app.lastAppliedHash = location.hash;
  const { state: hs, camera } = parseHash(location.hash);
  if (hs.itemId && (!app.cur || hs.itemId !== app.cur.data.id)) {
    const it = app.catalog.byId.get(hs.itemId);
    if (it) requestItem(it, { hashState: hs, camera });
    else toast(`The linked view is ${notHere()}.`, { kind: 'error' });
    return;
  }
  if (!app.cur) return;
  const base = { ...DEFAULTS, budget: DEFAULT_BUDGET, ...app.cur.defaults };
  delete base.itemId;
  const patch = hashPatch(app.cur.data, hs, base);
  app.store.set(patch);
  if (camera) app.viewer.setCameraState(camera);
}

function fillPreviewHelp(cat) {
  const pv = cat.preview;
  const sec = $('help-preview');
  if (!pv || !sec) return;
  const syn = cat.items.filter((i) => i.kind === 'synthetic');
  const eco = cat.items.filter((i) => i.kind === 'ecosense');
  const what = [];
  if (syn.length) what.push(`the ${syn.length} synthetic test stands`);
  if (eco.length) {
    const of = pv.datesTotal > pv.datesShown ? `${pv.datesShown} of the ${pv.datesTotal}` : String(pv.datesShown);
    what.push(`the ${new Set(eco.map((i) => i.meta.trap)).size} reference positions on ${of} LiDAR acquisition dates`);
  }
  const cs = syn.length ? pv.capFor('synthetic') : null;
  const ce = eco.length ? pv.capFor('ecosense') : null;
  let caps = [];
  if (cs && ce && cs === ce) caps = [`${capText(cs)} points per data set`];
  else {
    if (cs) caps.push(`${capText(cs)} points per synthetic stand`);
    if (ce) caps.push(`${capText(ce)}${caps.length ? '' : ' points'} per ECOSENSE data set`);
  }
  const refs = eco.length ? pv.references : [];
  const refText = refs.length === 1 ? ` On these dates, the field reference is ${refs[0]}.`
    : refs.length > 1 ? ` On these dates, the field references are ${refs.slice(0, -1).join(', ')} and ${refs[refs.length - 1]}.` : '';
  $('help-preview-text').textContent = `It holds ${what.join(' and ')}`
    + (caps.length ? `, with at most ${caps.join(' and ')} (uniform subsamples).` : '.') + refText;
  const cite = $('help-cite');
  clear(cite);
  if (pv.paper) {
    const link = (doi) => (DOI_RE.test(doi)
      ? h('a', { href: `https://doi.org/${doi}`, target: '_blank', rel: 'noopener' }, `https://doi.org/${doi}`)
      : `https://doi.org/${doi}`);
    cite.append('When you use the viewer or its data, please cite the paper, ', h('em', {}, pv.paper.title));
    if (pv.paper.doi) cite.append(' (', link(pv.paper.doi), ')');
    if (pv.dataDoi) cite.append(', the data (', link(pv.dataDoi), ')');
    cite.append(', and the data references below.');
  }
  sec.hidden = false;
}

function wireChrome() {
  $('btn-compare').addEventListener('click', () => app.store.set({ compare: !app.store.state.compare }));
  const help = $('help');
  const openHelp = () => {
    $('help-hint').hidden = true;
    storage.set('lai-seen-help', true);
    if (typeof help.showModal === 'function') help.showModal(); else help.setAttribute('open', '');
  };
  $('btn-help').addEventListener('click', openHelp);
  $('help-hint-open').addEventListener('click', openHelp);
  $('help-hint-close').addEventListener('click', () => { $('help-hint').hidden = true; storage.set('lai-seen-help', true); });
  $('help-close').addEventListener('click', () => help.close());
  help.addEventListener('click', (e) => { if (e.target === help) help.close(); });
  $('btn-theme').addEventListener('click', () => setTheme(app.theme === 'dark' ? 'light' : 'dark'));
  $('btn-item').addEventListener('click', openPicker);
  $('btn-prev-date').addEventListener('click', () => stepDate(-1));
  $('btn-next-date').addEventListener('click', () => stepDate(1));
  $('btn-menu').addEventListener('click', () => (document.body.classList.contains('drawer-open') ? closeDrawer() : openDrawer(true)));
  $('drawer-close').addEventListener('click', closeDrawer);
  $('drawer-backdrop').addEventListener('click', closeDrawer);
  NARROW.addEventListener('change', () => { if (!NARROW.matches) closeDrawer(); syncDrawer(); });
  PHONE.addEventListener('change', () => { placeHelpHint(); updateLegends(); });
  syncDrawer();
  placeHelpHint();
  const relayout = debounce(() => { if (app.cur) updateLegends(); }, 200);
  new ResizeObserver(() => { relayout(); fitOverlays(); }).observe($('viewport'));
  const overlays = new ResizeObserver(() => fitOverlays());
  for (const id of ['view-stack', 'legends', 'legends-right']) overlays.observe($(id));
  $('btn-details').addEventListener('click', () => {
    const collapsed = document.body.classList.toggle('details-collapsed');
    $('btn-details').setAttribute('aria-expanded', String(!collapsed));
    $('btn-details-open').hidden = !collapsed;
    storage.set('lai-details-collapsed', collapsed);
  });
  $('btn-details-open').addEventListener('click', () => $('btn-details').click());
  if (storage.get('lai-details-collapsed', false)) $('btn-details').click();
  $('btn-mean').addEventListener('click', () => app.store.set({ footprint: null }));
  for (const sec of document.querySelectorAll('.panel')) {
    const btn = sec.querySelector('.sec-toggle');
    const key = `lai-sec-${sec.id}`;
    btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') !== 'true';
      setSectionOpen(sec, open);
      storage.set(key, open);
    });
    const saved = storage.get(key, null);
    if (saved !== null) setSectionOpen(sec, saved);
  }
  $('cmp-select').addEventListener('change', (e) => app.store.set({ compareLayer: e.target.value }));
  for (const btn of document.querySelectorAll('[data-layer]')) {
    btn.addEventListener('click', () => app.store.set({ [btn.dataset.layer]: !app.store.state[btn.dataset.layer] }));
  }
  document.addEventListener('keydown', onKey);
}

function setSectionOpen(sec, open) {
  const btn = sec.querySelector('.sec-toggle');
  btn.setAttribute('aria-expanded', String(open));
  sec.querySelector('.sec-body').hidden = !open;
}

function openPicker() {
  openDrawer();
  const sec = $('sec-picker');
  setSectionOpen(sec, true);
  sec.scrollIntoView({ block: 'start', behavior: 'smooth' });
  app.picker.focusSearch();
}

function onKey(e) {
  const tag = (e.target && e.target.tagName) || '';
  const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(tag);
  if (e.key === 'Escape') {
    if (document.body.classList.contains('drawer-open')) { closeDrawer(); return; }
    if ($('help').open) return;
    if (app.store.state.footprint) app.store.set({ footprint: null });
    return;
  }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '?') { e.preventDefault(); $('btn-help').click(); }
  else if (e.key === '[') stepDate(-1);
  else if (e.key === ']') stepDate(1);
}

function stepDate(delta) {
  const it = app.picker.neighbourDate(delta);
  if (it) {
    requestItem(it, { push: true });
    return;
  }
  if (!app.cur || app.cur.data.kind !== 'ecosense') {
    toast('Only the ECOSENSE reference positions have dates.');
    return;
  }
  const pv = app.catalog && app.catalog.preview;
  const where = pv && pv.datesTotal > pv.datesShown
    ? ` in this preview (${pv.datesShown} of the ${pv.datesTotal} LiDAR acquisition dates)`
    : ' at this reference position';
  toast(`No ${delta < 0 ? 'earlier' : 'later'} date${where}`);
}

function notHere() {
  return app.catalog && app.catalog.preview ? 'not in this preview' : 'not available here';
}

function openDrawer(focusInside = false) {
  if (!NARROW.matches) return;
  document.body.classList.add('drawer-open');
  $('btn-menu').setAttribute('aria-expanded', 'true');
  $('drawer-backdrop').hidden = false;
  syncDrawer();
  if (focusInside) $('drawer-close').focus();
}

function closeDrawer() {
  const wasOpen = document.body.classList.contains('drawer-open');
  const focusInside = $('sidebar').contains(document.activeElement);
  document.body.classList.remove('drawer-open');
  $('btn-menu').setAttribute('aria-expanded', 'false');
  $('drawer-backdrop').hidden = true;
  syncDrawer();
  if (wasOpen && focusInside && NARROW.matches) $('btn-menu').focus();
}

function syncDrawer() {
  $('sidebar').inert = NARROW.matches && !document.body.classList.contains('drawer-open');
}

function closeDrawerOnNarrow() {
  if (NARROW.matches) closeDrawer();
}

function placeHelpHint() {
  const hint = $('help-hint');
  if (PHONE.matches) {
    if (hint.parentElement !== $('main')) $('viewport').after(hint);
  } else if (hint.parentElement !== $('viewport')) $('viewport').appendChild(hint);
}

function showHelpHint() {
  placeHelpHint();
  $('help-hint').hidden = false;
}

function setTheme(t) {
  app.theme = t;
  document.documentElement.dataset.theme = t;
  storage.set('lai-canopy-theme', t);
  updateThemeButton();
  app.viewer.setBackground(cssVar('--canvas-bg'));
  app.store.set({ theme: t });
  app.viewer.requestRender();
}

function updateThemeButton() {
  const btn = $('btn-theme');
  clear(btn);
  const dark = (app.theme || 'dark') === 'dark';
  btn.appendChild(icon(dark ? 'sun' : 'moon'));
  btn.setAttribute('aria-label', dark ? 'Switch to the light theme' : 'Switch to the dark theme');
  btn.title = dark ? 'Light theme' : 'Dark theme';
}

function updateItemButton(data, text) {
  if (!data) {
    $('item-btn-label').textContent = text || 'Choose the data';
    $('btn-item').title = 'Choose the data';
    $('item-btn-kind').textContent = 'Data';
    $('item-btn-kind').title = '';
    $('date-nav').hidden = true;
    return;
  }
  $('item-btn-label').textContent = data.short;
  $('btn-item').title = `${data.label} · choose other data`;
  $('item-btn-kind').textContent = KIND_TABS[data.kind] || data.kind;
  $('item-btn-kind').title = KIND_LABELS[data.kind] || data.kind;
  const eco = data.kind === 'ecosense' || (app.catalog.byId.get(data.id)?.kind === 'ecosense');
  $('date-nav').hidden = !eco;
}

function onContextLost() {
  writeHash.flush();
  showEmpty('The 3D view was interrupted', 'The browser stopped the graphics (WebGL), e.g. after a GPU reset or when memory ran short. It usually comes back by itself; otherwise reload the page, which keeps this view.',
    [{ label: 'Reload', icon: 'retry', primary: true, onclick: () => { writeHash.flush(); location.reload(); } }], 'context');
}

function onContextRestored() {
  if (app.emptyKind === 'context') hideEmpty();
  const cur = app.cur;
  if (!cur) return;
  writeHash.flush();
  const { state: hs, camera } = parseHash(location.hash);
  teardownItem(false);
  loadItem(cur.data.id, { hashState: hs, camera });
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#000000';
}

function setBodyState(s) {
  document.body.dataset.state = s;
}

function showEmpty(title, text, actions = [], kind = 'error') {
  const el = $('empty-state');
  clear(el);
  el.append(h('h2', {}, title), h('p', {}, text));
  if (actions.length) {
    el.appendChild(h('div', { class: 'empty-actions' }, actions.map((a) => h('button', {
      type: 'button', class: `btn${a.primary ? ' btn-primary' : ''}`, onclick: a.onclick,
    }, a.icon ? icon(a.icon, { size: 16 }) : null, a.label))));
  }
  el.hidden = false;
  app.emptyKind = kind;
}

function hideEmpty() {
  $('empty-state').hidden = true;
  app.emptyKind = null;
}

function exposeDebugHook() {
  window.__lai = {
    app,
    get state() { return app.store && app.store.state; },
    get memory() { return app.viewer && { ...app.viewer.renderer.info.memory, programs: app.viewer.renderer.info.programs?.length }; },
    benchmark: (n) => app.viewer.benchmark(n),
    timings: app.timings,
  };
}

init();
