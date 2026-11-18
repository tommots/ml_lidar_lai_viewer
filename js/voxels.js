import * as THREE from 'three';

const SEAM = 0.94;

export function addInstanceAlpha(material) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float instanceAlpha;\nvarying float vInstanceAlpha;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvInstanceAlpha = instanceAlpha;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vInstanceAlpha;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n\tdiffuseColor.a *= vInstanceAlpha;');
  };
  material.customProgramCacheKey = () => 'instance-alpha';
}

export class VoxelResources {
  constructor() {
    this.box = new THREE.BoxGeometry(1, 1, 1);
    this.material = new THREE.MeshLambertMaterial({ color: 0xffffff });
    addInstanceAlpha(this.material);
    this.setStyle('solid', 0.85);
  }

  setStyle(style, opacity) {
    const m = this.material;
    const glass = style === 'glass';
    m.opacity = glass ? opacity * 0.5 : opacity;
    m.transparent = true;
    m.depthWrite = !glass;
    m.side = glass ? THREE.DoubleSide : THREE.FrontSide;
    m.needsUpdate = true;
  }

  dispose() {
    this.box.dispose();
    this.material.dispose();
  }
}

export class VoxelLayer {
  constructor(res, name) {
    this.res = res;
    this.group = new THREE.Group();
    this.group.name = name;
    this.mesh = null;
    this.count = 0;
    this.order = null;
  }

  build(src, opts) {
    this.clearMesh();
    if (!src || !src.profile) return;
    const { x0, y0, nx, ny, cell, nz, dz } = src.grid;
    const prof = src.profile;
    const thr = opts.threshold;
    const abs = src.type === 'error';
    const keep = opts.keep || null;
    const pass = (v) => Number.isFinite(v) && (abs ? Math.abs(v) >= thr && Math.abs(v) > 1e-9 : v >= thr && v > 1e-9);
    const column = (ix, iy) => src.inMask(ix, iy) && (!keep || keep.cell(ix, iy));
    const kept = (ix, iy, k, v) => pass(v) && (!keep || keep.bin(ix, iy, k));
    let n = 0;
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        if (!column(ix, iy)) continue;
        const b = (iy * nx + ix) * nz;
        for (let k = 0; k < nz; k++) if (kept(ix, iy, k, prof[b + k])) n++;
      }
    }
    this.count = n;
    if (!n) return;
    const geom = this.res.box.clone();
    const alphas = new THREE.InstancedBufferAttribute(new Float32Array(n).fill(1), 1);
    geom.setAttribute('instanceAlpha', alphas);
    const alphaOf = opts.alpha || null;
    const mesh = new THREE.InstancedMesh(geom, this.res.material, n);
    mesh.name = `${this.group.name}-mesh`;
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const rgb = [0, 0, 0];
    const sx = cell * SEAM;
    const sz = dz * SEAM;
    let i = 0;
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        if (!column(ix, iy)) continue;
        const g = src.groundAt(ix, iy);
        const cx = x0 + (ix + 0.5) * cell;
        const cy = y0 + (iy + 0.5) * cell;
        const b = (iy * nx + ix) * nz;
        for (let k = 0; k < nz; k++) {
          const v = prof[b + k];
          if (!kept(ix, iy, k, v)) continue;
          m.makeScale(sx, sx, sz);
          m.setPosition(cx, cy, g + (k + 0.5) * dz);
          mesh.setMatrixAt(i, m);
          opts.color(v, rgb);
          mesh.setColorAt(i, c.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace));
          if (alphaOf) alphas.array[i] = alphaOf(v);
          i++;
        }
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (alphaOf && mesh.instanceColor) {
      const mat = mesh.instanceMatrix.array;
      const centres = new Float32Array(n * 3);
      for (let j = 0; j < n; j++) for (let a = 0; a < 3; a++) centres[j * 3 + a] = mat[j * 16 + 12 + a];
      this.order = {
        centres, colors: mesh.instanceColor.array.slice(), alphas: alphas.array.slice(),
        dist: new Float32Array(n), index: Uint32Array.from({ length: n }, (_, j) => j), from: null,
      };
    }
    this.mesh = mesh;
    this.group.add(mesh);
  }

  sortFor(camera) {
    const o = this.order;
    if (!this.mesh || !o) return;
    const p = this.group.worldToLocal(camera.getWorldPosition(new THREE.Vector3()));
    if (o.from && o.from.distanceToSquared(p) < 1e-10) return;
    o.from = p;
    const { centres, colors, alphas, dist, index } = o;
    const n = index.length;
    for (let j = 0; j < n; j++) {
      const dx = centres[j * 3] - p.x;
      const dy = centres[j * 3 + 1] - p.y;
      const dz = centres[j * 3 + 2] - p.z;
      dist[j] = dx * dx + dy * dy + dz * dz;
    }
    index.sort((a, b) => dist[b] - dist[a]);
    const mat = this.mesh.instanceMatrix.array;
    const col = this.mesh.instanceColor.array;
    const alp = this.mesh.geometry.getAttribute('instanceAlpha');
    for (let i = 0; i < n; i++) {
      const j = index[i];
      for (let a = 0; a < 3; a++) {
        mat[i * 16 + 12 + a] = centres[j * 3 + a];
        col[i * 3 + a] = colors[j * 3 + a];
      }
      alp.array[i] = alphas[j];
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
    alp.needsUpdate = true;
  }

  clearMesh() {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.dispose();
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    this.order = null;
    this.count = 0;
  }

  dispose() {
    this.clearMesh();
  }
}
