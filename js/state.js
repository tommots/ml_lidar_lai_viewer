import { CAL_PREFIX as CAL } from './itemdata.js';
import { LAI_MAPS } from './colormaps.js';

export const DEFAULTS = Object.freeze({
  itemId: null,
  series: null,
  active: null,
  compareLayer: null,
  compare: false,
  voxMode: 'value',
  rasterSrc: null,
  showPoints: true,
  showVoxels: true,
  showRaster: true,
  showGrid: true,
  showMarkers: true,
  showAxes: true,
  showWall: true,
  showTerrain: false,
  colorBy: null,
  singleColor: '#9fb3c2',
  pointSize: 2,
  attenuate: true,
  pointOpacity: 1,
  budget: 3_000_000,
  threshold: 0,
  errThreshold: 0.15,
  voxOpacity: 0.85,
  voxStyle: 'solid',
  voxMap: 'fade_greens',
  scaleMode: 'shared',
  rasterOpacity: 0.9,
  rasterMap: 'fade_greens',
  xRange: null,
  yRange: null,
  zRange: null,
  hideGround: false,
  showAllTiers: false,
  hiddenLayers: [],
  shownCalibrated: [],
  footprint: null,
});

export const ITEM_KEYS = ['active', 'compareLayer', 'voxMode', 'rasterSrc', 'colorBy', 'xRange', 'yRange', 'zRange', 'footprint'];

const RANGE_HASH = [['xr', 'xRange'], ['yr', 'yRange'], ['zr', 'zRange']];

export class Store {
  constructor(initial) {
    this.state = { ...initial };
    this.listeners = new Set();
  }

  set(patch, meta = {}) {
    const changed = new Set();
    for (const [k, v] of Object.entries(patch)) {
      if (!same(this.state[k], v)) {
        this.state[k] = v;
        changed.add(k);
      }
    }
    if (changed.size) for (const fn of this.listeners) fn(changed, this.state, meta);
    return changed;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

function same(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => v === b[i]);
  return false;
}

const VIS = {
  p: 'showPoints', v: 'showVoxels', r: 'showRaster', g: 'showGrid', m: 'showMarkers', a: 'showAxes', w: 'showWall', t: 'showTerrain',
};

function num(s) {
  const v = Number(s);
  return Number.isFinite(v) ? v : undefined;
}

function nums(s, n) {
  if (!s) return undefined;
  const parts = s.split(',').map(Number);
  return parts.length === n && parts.every(Number.isFinite) ? parts : undefined;
}

export function parseHash(hash) {
  const p = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const s = {};
  const str = (k) => (p.has(k) ? p.get(k) : undefined);
  if (str('item')) s.itemId = str('item');
  if (str('series')) s.series = str('series');
  if (str('layer')) s.active = str('layer');
  if (str('cmp')) s.compareLayer = str('cmp');
  if (p.has('compare')) s.compare = p.get('compare') === '1';
  if (str('mode')) s.voxMode = str('mode');
  if (str('rsrc')) s.rasterSrc = str('rsrc');
  if (p.has('vis')) {
    const v = p.get('vis');
    for (const [c, key] of Object.entries(VIS)) s[key] = v.includes(c);
  }
  if (str('color')) s.colorBy = str('color');
  if (str('pcol') && /^[0-9a-fA-F]{6}$/.test(str('pcol'))) s.singleColor = `#${str('pcol')}`;
  const setNum = (k, key, lo, hi) => {
    const v = num(str(k));
    if (v !== undefined && v >= lo && v <= hi) s[key] = v;
  };
  setNum('psize', 'pointSize', 0.5, 16);
  if (p.has('patt')) s.attenuate = p.get('patt') !== '0';
  setNum('pop', 'pointOpacity', 0.05, 1);
  if (str('budget') === 'all') s.budget = Infinity;
  else setNum('budget', 'budget', 10_000, 1e9);
  setNum('thr', 'threshold', 0, 100);
  setNum('ethr', 'errThreshold', 0, 1);
  setNum('vop', 'voxOpacity', 0.05, 1);
  if (['solid', 'glass'].includes(str('vst'))) s.voxStyle = str('vst');
  if (LAI_MAPS.includes(str('vmap'))) s.voxMap = str('vmap');
  if (LAI_MAPS.includes(str('rmap'))) s.rasterMap = str('rmap');
  if (['shared', 'layer'].includes(str('scale'))) s.scaleMode = str('scale');
  setNum('rop', 'rasterOpacity', 0.05, 1);
  for (const [k, key] of RANGE_HASH) {
    const r = nums(str(k), 2);
    if (r && r.every(Number.isInteger)) s[key] = r;
  }
  const clip = nums(str('clip'), 2);
  if (clip && s.zRange === undefined) s.zRange = { metres: clip };
  if (p.has('ground')) s.hideGround = p.get('ground') === 'hide';
  if (p.has('side')) s.showAllTiers = p.get('side') === '1';
  else if (p.has('tiers')) s.showAllTiers = p.get('tiers') === 'all';
  if (str('hide')) s.hiddenLayers = str('hide').split(',').filter(Boolean);
  if (str('cal')) s.shownCalibrated = str('cal').split(',').filter(Boolean).map((id) => (id.startsWith(CAL) ? id : `${CAL}${id}`));
  const fp = nums(str('fp'), 2);
  if (fp) s.footprint = fp.map((v) => Math.round(v));
  const cam = nums(str('cam'), 6);
  return { state: s, camera: cam ? { position: cam.slice(0, 3), target: cam.slice(3) } : null };
}

export function buildHash(st, camera, itemDefaults = {}) {
  const p = new URLSearchParams();
  if (st.itemId) p.set('item', st.itemId);
  if (st.series && st.series !== itemDefaults.series) p.set('series', st.series);
  if (st.active) p.set('layer', st.active);
  if (st.compareLayer && st.compareLayer !== itemDefaults.compareLayer) p.set('cmp', st.compareLayer);
  if (st.compare) p.set('compare', '1');
  if (st.voxMode && st.voxMode !== 'value') p.set('mode', st.voxMode);
  if (st.rasterSrc) p.set('rsrc', st.rasterSrc);
  const vis = Object.entries(VIS).filter(([, key]) => st[key]).map(([c]) => c).join('');
  const visDefault = Object.entries(VIS).filter(([, key]) => DEFAULTS[key]).map(([c]) => c).join('');
  if (vis !== visDefault) p.set('vis', vis || '-');
  if (st.colorBy && st.colorBy !== itemDefaults.colorBy) p.set('color', st.colorBy);
  if (st.colorBy === 'single' && st.singleColor !== DEFAULTS.singleColor) p.set('pcol', st.singleColor.replace('#', ''));
  const putNum = (k, key, d) => { if (st[key] !== null && st[key] !== DEFAULTS[key]) p.set(k, Number(st[key]).toFixed(d).replace(/\.?0+$/, '') || '0'); };
  putNum('psize', 'pointSize', 1);
  if (st.attenuate !== DEFAULTS.attenuate) p.set('patt', st.attenuate ? '1' : '0');
  putNum('pop', 'pointOpacity', 2);
  if (st.budget !== itemDefaults.budget) p.set('budget', st.budget === Infinity ? 'all' : String(Math.round(st.budget)));
  putNum('thr', 'threshold', 3);
  putNum('ethr', 'errThreshold', 3);
  putNum('vop', 'voxOpacity', 2);
  if (st.voxStyle !== DEFAULTS.voxStyle) p.set('vst', st.voxStyle);
  if (st.voxMap !== DEFAULTS.voxMap) p.set('vmap', st.voxMap);
  if (st.rasterMap !== DEFAULTS.rasterMap) p.set('rmap', st.rasterMap);
  if (st.scaleMode !== DEFAULTS.scaleMode) p.set('scale', st.scaleMode);
  putNum('rop', 'rasterOpacity', 2);
  for (const [k, key] of RANGE_HASH) if (Array.isArray(st[key])) p.set(k, st[key].join(','));
  if (st.hideGround) p.set('ground', 'hide');
  if (st.showAllTiers) p.set('side', '1');
  if (st.hiddenLayers && st.hiddenLayers.length) p.set('hide', st.hiddenLayers.join(','));
  if (st.shownCalibrated && st.shownCalibrated.length) p.set('cal', st.shownCalibrated.map((id) => (id.startsWith(CAL) ? id.slice(CAL.length) : id)).join(','));
  if (st.footprint) p.set('fp', st.footprint.join(','));
  if (camera) p.set('cam', [...camera.position, ...camera.target].map((v) => v.toFixed(2)).join(','));
  return p.toString().replace(/%2C/g, ',').replace(/%3A/g, ':');
}
