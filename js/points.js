import * as THREE from 'three';
import { categoryColors, hexToRgb, sample, pointRampRange } from './colormaps.js';
import { keepPoint } from './clip.js';

const FAR = 1e9;

export function defaultColorBy(attributes) {
  const names = attributes.map((a) => a.name);
  if (names.includes('material')) return 'material';
  if (names.includes('rgb')) return 'rgb';
  if (names.includes('height')) return 'height';
  return names[0] || 'single';
}

function glslName(name) {
  return `a_${String(name).replace(/[^A-Za-z0-9_]/g, '_')}`;
}

export class PointCloud {
  constructor(pointsMeta, opts) {
    this.meta = pointsMeta;
    this.attributes = pointsMeta.attributes || [];
    this.group = new THREE.Group();
    this.group.name = 'points';
    this.objects = [];
    this.chunks = [];
    this.budget = Infinity;
    this.theme = opts.theme || 'dark';
    this.floatTextures = opts.floatTextures !== false;
    this.paletteAttrs = this.attributes.filter((a) => a.kind !== 'rgb');
    this.rows = Math.max(1, this.paletteAttrs.length);
    this.paletteData = new Uint8Array(256 * this.rows * 4);
    this.palette = new THREE.DataTexture(this.paletteData, 256, this.rows, THREE.RGBAFormat);
    this.palette.magFilter = THREE.NearestFilter;
    this.palette.minFilter = THREE.NearestFilter;
    this.palette.needsUpdate = true;
    this.hist = new Map(this.paletteAttrs.map((a) => [a.name, new Float64Array(256)]));
    this.ranges = new Map();
    const pos = pointsMeta.position;
    this.min = new THREE.Vector3(...pos.min);
    this.scale = new THREE.Vector3(...pos.scale);
    const lo = new THREE.Vector3(...pos.min);
    const hi = new THREE.Vector3(...(pos.max || pos.min.map((m, i) => m + pos.scale[i] * 65535)));
    this.sphere = new THREE.Sphere(lo.clone().add(hi).multiplyScalar(0.5), lo.distanceTo(hi) / 2 + 0.01);
    this.hasGround = this.attributes.some((a) => a.name === 'ground');
    this.cellMask = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
    this.cellMask.needsUpdate = true;
    this.cellMaskData = null;
    this.cellGround = groundTexture([0], 1, 1, this.floatTextures).texture;
    this.clip = null;
    this.uniforms = this.makeUniforms();
    this.materials = new Map();
    this.colorBy = null;
    this.material = this.materialFor(defaultColorBy(this.attributes));
    this.buildPalette();
  }

  makeUniforms() {
    return {
      uMin: { value: this.min.clone() },
      uScale: { value: this.scale.clone() },
      uSize: { value: 2 },
      uMaxSize: { value: 32 },
      uAtten: { value: 1 },
      uRefDist: { value: 50 },
      uRow: { value: 0.5 },
      uPalette: { value: this.palette },
      uSingle: { value: new THREE.Vector3(0.62, 0.7, 0.76) },
      uNoColor: { value: new THREE.Vector3(0.55, 0.57, 0.6) },
      uClipXY: { value: new THREE.Vector4(-FAR, FAR, -FAR, FAR) },
      uClipZ: { value: new THREE.Vector3(-FAR, FAR, 0) },
      uCellGround: { value: this.cellGround },
      uGround0: { value: 0 },
      uGroundEnc: { value: new THREE.Vector3(0, 0, 1) },
      uHClip: { value: 0 },
      uHParams: { value: new THREE.Vector4(0, 0, 0, 0) },
      uCellMask: { value: this.cellMask },
      uCellGrid: { value: new THREE.Vector4(0, 0, 1, 1) },
      uCellN: { value: new THREE.Vector2(1, 1) },
      uHideGround: { value: 0 },
      uGroundColor: { value: new THREE.Vector3(0.35, 0.38, 0.42) },
      uOpacity: { value: 1 },
      uRound: { value: 1 },
    };
  }

  materialFor(name) {
    const attr = this.attributes.find((a) => a.name === name) || null;
    const key = attr ? attr.name : 'single';
    if (!this.materials.has(key)) {
      const m = this.makeMaterial(attr);
      if (this.material) {
        m.transparent = this.material.transparent;
        m.depthWrite = this.material.depthWrite;
      }
      this.materials.set(key, m);
    }
    return this.materials.get(key);
  }

  makeMaterial(attr) {
    const ground = this.attributes.find((a) => a.name === 'ground' && a.kind !== 'rgb');
    const decl = [];
    let colour = 'vec3 col = uSingle;';
    if (attr && attr.kind === 'rgb') {
      decl.push(`attribute vec3 ${glslName(attr.name)};`);
      colour = `vec3 col = ${glslName(attr.name)};\n  if (col.r + col.g + col.b < 0.002) col = uNoColor;`;
    } else if (attr) {
      decl.push(`attribute float ${glslName(attr.name)};`);
      colour = `vec3 col = texture2D(uPalette, vec2((${glslName(attr.name)} + 0.5) / 256.0, uRow)).rgb;`;
    }
    if (ground && ground !== attr) decl.push(`attribute float ${glslName(ground.name)};`);
    const vertex = `
uniform vec3 uMin;
uniform vec3 uScale;
uniform float uSize;
uniform float uMaxSize;
uniform float uAtten;
uniform float uRefDist;
uniform float uRow;
uniform sampler2D uPalette;
uniform vec3 uSingle;
uniform vec3 uNoColor;
uniform vec4 uClipXY;
uniform vec3 uClipZ;
uniform highp sampler2D uCellGround;
uniform float uGround0;
uniform vec3 uGroundEnc;
uniform int uHClip;
uniform vec4 uHParams;
uniform sampler2D uCellMask;
uniform vec4 uCellGrid;
uniform vec2 uCellN;
uniform float uHideGround;
uniform vec3 uGroundColor;
${decl.join('\n')}
varying vec3 vColor;
void main() {
  vec3 p = uMin + position * uScale;
  bool keep = p.x >= uClipXY.x && p.x < uClipXY.y && p.y >= uClipXY.z && p.y < uClipXY.w;
  if (keep && uClipZ.z > 0.5) {
    vec2 gc = floor((p.xy - uCellGrid.xy) / uCellGrid.z);
    bool onGrid = gc.x >= 0.0 && gc.y >= 0.0 && gc.x < uCellN.x && gc.y < uCellN.y;
    vec4 gt = texture2D(uCellGround, (gc + 0.5) / uCellN);
    float g = uGroundEnc.x > 0.5
      ? uGroundEnc.y + (floor(gt.r * 255.0 + 0.5) * 256.0 + floor(gt.g * 255.0 + 0.5)) / 65535.0 * uGroundEnc.z
      : gt.r;
    float h = p.z - (onGrid ? g : uGround0);
    keep = h >= uClipZ.x && h < uClipZ.y;
  }
  if (uHClip == 1) {
    vec2 d = p.xy - uHParams.xy;
    keep = keep && dot(d, d) <= uHParams.z * uHParams.z;
  } else if (uHClip == 2) {
    keep = keep && p.x >= uHParams.x && p.x <= uHParams.z && p.y >= uHParams.y && p.y <= uHParams.w;
  } else if (uHClip == 3) {
    vec2 c = floor((p.xy - uCellGrid.xy) / uCellGrid.z);
    bool inside = c.x >= 0.0 && c.y >= 0.0 && c.x < uCellN.x && c.y < uCellN.y;
    keep = keep && inside && texture2D(uCellMask, (c + 0.5) / uCellN).r > 0.5;
  }
  ${colour}
  float sizeScale = 1.0;
  ${ground ? `if (${glslName(ground.name)} > 0.5) { if (uHideGround > 0.5) keep = false; col = mix(col, uGroundColor, 0.78); sizeScale = 0.5; }` : ''}
  vColor = col;
  if (!keep) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float s = uSize * sizeScale;
  if (uAtten > 0.5) s *= uRefDist / max(-mv.z, 0.001);
  gl_PointSize = clamp(s, 1.0, uMaxSize);
}`;
    const fragment = `
uniform float uOpacity;
uniform float uRound;
varying vec3 vColor;
void main() {
  if (uRound > 0.5) {
    vec2 c = gl_PointCoord - vec2(0.5);
    if (dot(c, c) > 0.25) discard;
  }
  gl_FragColor = vec4(vColor, uOpacity);
}`;
    return new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: this.uniforms,
      transparent: false,
      depthWrite: true,
    });
  }

  addChunk(chunk) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(chunk.position, 3, false));
    for (const a of this.attributes) {
      const arr = chunk.attrs[a.name];
      if (!arr) continue;
      g.setAttribute(glslName(a.name), new THREE.BufferAttribute(arr, a.kind === 'rgb' ? 3 : 1, a.kind === 'rgb'));
    }
    g.boundingSphere = this.sphere.clone();
    g.boundingBox = new THREE.Box3().setFromCenterAndSize(this.sphere.center, new THREE.Vector3(1, 1, 1).multiplyScalar(this.sphere.radius * 2));
    const obj = new THREE.Points(g, this.material);
    obj.matrixAutoUpdate = false;
    obj.name = `points-${chunk.index}`;
    this.objects.push(obj);
    this.chunks.push(chunk);
    this.group.add(obj);
    if (this.chunks.length === 1) this.fillHistograms(chunk);
    this.applyBudget();
  }

  fillHistograms(chunk) {
    for (const a of this.paletteAttrs) {
      const h = this.hist.get(a.name);
      const arr = chunk.attrs[a.name];
      if (!arr) continue;
      for (let i = 0; i < arr.length; i++) h[arr[i]] += 1;
    }
    for (const a of this.paletteAttrs) {
      if (a.kind !== 'scalar') continue;
      const h = this.hist.get(a.name);
      const lo = a.name === 'height' ? valueToCode(a, 0) : quantile(h, 0.005);
      const hi = Math.max(lo + 1, quantile(h, 0.995));
      this.ranges.set(a.name, [lo, hi]);
    }
    this.buildPalette();
  }

  buildPalette() {
    const d = this.paletteData;
    const [from, to] = pointRampRange(this.theme);
    const tmp = [0, 0, 0];
    this.paletteAttrs.forEach((a, row) => {
      const base = row * 256 * 4;
      if (a.kind === 'scalar') {
        const [lo, hi] = this.ranges.get(a.name) || [0, 255];
        for (let c = 0; c < 256; c++) {
          const t = Math.min(1, Math.max(0, (c - lo) / Math.max(1, hi - lo)));
          sample('batlow', from + (to - from) * t, tmp);
          d.set([tmp[0] * 255, tmp[1] * 255, tmp[2] * 255, 255], base + c * 4);
        }
      } else {
        const colors = categoryColors(a);
        for (let c = 0; c < 256; c++) {
          const rgb = colors.has(c) ? cssToRgb(colors.get(c)) : [0.5, 0.5, 0.5];
          d.set([rgb[0] * 255, rgb[1] * 255, rgb[2] * 255, 255], base + c * 4);
        }
      }
    });
    this.palette.needsUpdate = true;
  }

  setColorBy(name, single) {
    const u = this.uniforms;
    const idx = this.paletteAttrs.findIndex((a) => a.name === name);
    if (idx >= 0) u.uRow.value = (idx + 0.5) / this.rows;
    if (single) u.uSingle.value.fromArray(hexToRgb(single));
    const attr = this.attributes.find((a) => a.name === name);
    this.colorBy = attr ? name : 'single';
    this.material = this.materialFor(this.colorBy);
    for (const o of this.objects) o.material = this.material;
  }

  setSize(px, attenuate, pixelRatio, refDistance) {
    const u = this.uniforms;
    u.uSize.value = px * pixelRatio;
    u.uMaxSize.value = Math.max(16, 2 * px) * pixelRatio;
    u.uAtten.value = attenuate ? 1 : 0;
    u.uRefDist.value = refDistance;
    u.uRound.value = px * pixelRatio >= 2.5 || attenuate ? 1 : 0;
  }

  setOpacity(a) {
    this.uniforms.uOpacity.value = a;
    const transparent = a < 0.999;
    for (const m of this.materials.values()) {
      if (m.transparent !== transparent) {
        m.transparent = transparent;
        m.depthWrite = !transparent;
        m.needsUpdate = true;
      }
    }
  }

  setClip(clip) {
    this.clip = clip;
    const lim = (v) => Math.max(-FAR, Math.min(FAR, v));
    this.uniforms.uClipXY.value.set(lim(clip.xa), lim(clip.xb), lim(clip.ya), lim(clip.yb));
    this.uniforms.uClipZ.value.set(lim(clip.za), lim(clip.zb), clip.z ? 1 : 0);
  }

  setCellGround(grid, groundAt, ground0) {
    const { nx, ny } = grid;
    const values = [];
    for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) values.push(groundAt(ix, iy));
    this.cellGround.dispose();
    const { texture, enc } = groundTexture(values, nx, ny, this.floatTextures);
    this.cellGround = texture;
    const u = this.uniforms;
    u.uCellGround.value = this.cellGround;
    u.uGroundEnc.value.set(...enc);
    u.uGround0.value = ground0;
    u.uCellGrid.value.set(grid.x0, grid.y0, grid.cell, 0);
    u.uCellN.value.set(nx, ny);
  }

  setHClip(mode, params = []) {
    const u = this.uniforms;
    u.uHClip.value = { circle: 1, rect: 2, cells: 3 }[mode] || 0;
    if (mode === 'cells' && !this.cellMaskData) u.uHClip.value = 0;
    u.uHParams.value.set(params[0] || 0, params[1] || 0, params[2] || 0, params[3] || 0);
  }

  setCellMask(grid, mask) {
    const { nx, ny } = grid;
    const data = new Uint8Array(nx * ny * 4);
    for (let i = 0; i < nx * ny; i++) data.fill(mask[i] ? 255 : 0, i * 4, i * 4 + 4);
    this.cellMask.dispose();
    this.cellMask = new THREE.DataTexture(data, nx, ny, THREE.RGBAFormat);
    this.cellMask.magFilter = THREE.NearestFilter;
    this.cellMask.minFilter = THREE.NearestFilter;
    this.cellMask.needsUpdate = true;
    this.cellMaskData = { grid: { ...grid }, mask };
    const u = this.uniforms;
    u.uCellMask.value = this.cellMask;
    u.uCellGrid.value.set(grid.x0, grid.y0, grid.cell, 0);
    u.uCellN.value.set(nx, ny);
  }

  setHideGround(hide) {
    this.uniforms.uHideGround.value = hide ? 1 : 0;
  }

  setTheme(theme) {
    this.theme = theme;
    const u = this.uniforms;
    u.uGroundColor.value.fromArray(theme === 'light' ? [0.66, 0.69, 0.72] : [0.3, 0.33, 0.37]);
    u.uNoColor.value.fromArray(theme === 'light' ? [0.55, 0.57, 0.6] : [0.6, 0.62, 0.65]);
    this.buildPalette();
  }

  setBudget(n) {
    this.budget = n;
    this.applyBudget();
  }

  applyBudget() {
    let left = this.budget;
    for (let i = 0; i < this.objects.length; i++) {
      const obj = this.objects[i];
      const count = this.chunks[i].count;
      const use = Math.max(0, Math.min(count, left));
      obj.visible = use > 0;
      obj.geometry.setDrawRange(0, use);
      left -= use;
    }
  }

  drawnCount() {
    let n = 0;
    for (let i = 0; i < this.objects.length; i++) if (this.objects[i].visible) n += this.objects[i].geometry.drawRange.count;
    return n;
  }

  legend() {
    const name = this.colorBy;
    const a = this.attributes.find((x) => x.name === name);
    if (!a) return { type: 'single', title: 'Points', label: 'single color' };
    if (a.kind === 'rgb') return { type: 'rgb', title: a.label || a.name };
    const h = this.hist.get(a.name);
    const total = h ? h.reduce((s, v) => s + v, 0) : 0;
    if (a.kind === 'scalar') {
      const [lo, hi] = this.ranges.get(a.name) || [0, 255];
      const [from, to] = pointRampRange(this.theme);
      return {
        type: 'seq', map: 'batlow', from, to, title: a.label || a.name, unit: a.unit || '',
        min: codeToValue(a, lo), max: codeToValue(a, hi),
      };
    }
    const colors = categoryColors(a);
    const cats = Object.entries(a.categories || {}).map(([code, label]) => ({
      code: Number(code), label, color: colors.get(Number(code)),
      share: total ? (h[Number(code)] || 0) / total : null,
    })).filter((c) => c.share === null || c.share > 0);
    return { type: 'cat', title: a.label || a.name, categories: cats, dimGround: this.hasGround && a.name !== 'ground' };
  }

  pick(camera, vp, sx, sy, radius = 8) {
    const m = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements;
    const u = this.uniforms;
    const clip = this.clip && this.clip.any ? this.clip : null;
    const hc = u.uHClip.value;
    const hp = u.uHParams.value;
    const groundAttr = this.hasGround && u.uHideGround.value > 0.5 ? 'ground' : null;
    const cm = hc === 3 && this.cellMaskData ? this.cellMaskData : null;
    const inCells = (x, y) => {
      const ix = Math.floor((x - cm.grid.x0) / cm.grid.cell);
      const iy = Math.floor((y - cm.grid.y0) / cm.grid.cell);
      return ix >= 0 && iy >= 0 && ix < cm.grid.nx && iy < cm.grid.ny && cm.mask[iy * cm.grid.nx + ix] === 1;
    };
    const [mnx, mny, mnz] = [this.min.x, this.min.y, this.min.z];
    const [scx, scy, scz] = [this.scale.x, this.scale.y, this.scale.z];
    let best = null;
    let bestW = Infinity;
    let budget = 1_500_000;
    for (let ci = 0; ci < this.objects.length && budget > 0; ci++) {
      const obj = this.objects[ci];
      if (!obj.visible) continue;
      const n = Math.min(obj.geometry.drawRange.count, budget);
      budget -= n;
      const pos = this.chunks[ci].position;
      const gr = groundAttr ? this.chunks[ci].attrs.ground : null;
      for (let i = 0; i < n; i++) {
        const x = mnx + pos[i * 3] * scx;
        const y = mny + pos[i * 3 + 1] * scy;
        const z = mnz + pos[i * 3 + 2] * scz;
        const w = m[3] * x + m[7] * y + m[11] * z + m[15];
        if (w <= 0) continue;
        const px = vp.x + ((m[0] * x + m[4] * y + m[8] * z + m[12]) / w + 1) * 0.5 * vp.w;
        if (Math.abs(px - sx) > radius) continue;
        const py = vp.y + (1 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w) * 0.5 * vp.h;
        if (Math.abs(py - sy) > radius) continue;
        if (w >= bestW) continue;
        if (clip && !keepPoint(clip, x, y, z)) continue;
        if (hc === 1 && (x - hp.x) ** 2 + (y - hp.y) ** 2 > hp.z * hp.z) continue;
        if (hc === 2 && (x < hp.x || x > hp.z || y < hp.y || y > hp.w)) continue;
        if (cm && !inCells(x, y)) continue;
        if (gr && gr[i] > 0) continue;
        bestW = w;
        best = [x, y, z];
      }
    }
    return best ? new THREE.Vector3(...best) : null;
  }

  dispose() {
    for (const o of this.objects) o.geometry.dispose();
    for (const m of this.materials.values()) m.dispose();
    this.materials.clear();
    this.palette.dispose();
    this.cellMask.dispose();
    this.cellGround.dispose();
    this.group.clear();
    this.objects = [];
    this.chunks = [];
  }
}

function groundTexture(values, w, h, asFloat) {
  let t;
  let enc = [0, 0, 1];
  if (asFloat) {
    const data = new Float32Array(w * h * 4);
    values.forEach((v, i) => { data[i * 4] = v; });
    t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
  } else {
    const lo = Math.min(...values);
    const span = Math.max(...values) - lo || 1;
    const data = new Uint8Array(w * h * 4);
    values.forEach((v, i) => {
      const q = Math.round(((v - lo) / span) * 65535);
      data[i * 4] = q >> 8;
      data[i * 4 + 1] = q & 255;
    });
    t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
    enc = [1, lo, span];
  }
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return { texture: t, enc };
}

function quantile(hist, q) {
  let total = 0;
  for (let i = 0; i < 256; i++) total += hist[i];
  if (!total) return q < 0.5 ? 0 : 255;
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= q * total) return i;
  }
  return 255;
}

function valueToCode(a, v) {
  const [lo, hi] = a.value_range || [0, 255];
  return Math.max(0, Math.min(255, Math.round(((v - lo) / (hi - lo || 1)) * 255)));
}

function codeToValue(a, c) {
  const [lo, hi] = a.value_range || [0, 255];
  return lo + (c / 255) * (hi - lo);
}

function cssToRgb(css) {
  if (css.startsWith('#')) return hexToRgb(css);
  const ctx = cssToRgb.ctx || (cssToRgb.ctx = document.createElement('canvas').getContext('2d'));
  ctx.fillStyle = '#000';
  ctx.fillStyle = css;
  return hexToRgb(ctx.fillStyle);
}
