import * as THREE from 'three';
import { addInstanceAlpha } from './voxels.js';

const LIFT = 0.03;
const GAP = 0.96;

export class RasterResources {
  constructor() {
    this.plane = new THREE.PlaneGeometry(1, 1);
    this.material = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    addInstanceAlpha(this.material);
  }

  setStyle(opacity, onTop = false, fading = false) {
    const m = this.material;
    m.opacity = opacity;
    m.transparent = opacity < 0.999 || fading;
    m.depthTest = !onTop;
    m.depthWrite = !onTop;
    m.needsUpdate = true;
  }

  dispose() {
    this.plane.dispose();
    this.material.dispose();
  }
}

export class RasterLayer {
  constructor(res, name) {
    this.res = res;
    this.group = new THREE.Group();
    this.group.name = name;
    this.mesh = null;
  }

  build(src, opts) {
    this.clearMesh();
    if (!src || !src.total) return;
    const { x0, y0, nx, ny, cell } = src.grid;
    const tot = src.total;
    const keep = opts.keep || null;
    const cells = [];
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        if (!src.inMask(ix, iy) || !Number.isFinite(tot[iy * nx + ix])) continue;
        if (!keep || keep(ix, iy)) cells.push([ix, iy]);
      }
    }
    if (!cells.length) return;
    const geom = this.res.plane.clone();
    const alphas = new THREE.InstancedBufferAttribute(new Float32Array(cells.length).fill(1), 1);
    geom.setAttribute('instanceAlpha', alphas);
    const mesh = new THREE.InstancedMesh(geom, this.res.material, cells.length);
    mesh.name = `${this.group.name}-mesh`;
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const rgb = [0, 0, 0];
    const zOf = src.rasterZ || src.groundAt;
    cells.forEach(([ix, iy], i) => {
      const v = tot[iy * nx + ix];
      const z = zOf(ix, iy) + LIFT;
      const cx = x0 + (ix + 0.5) * cell;
      const cy = y0 + (iy + 0.5) * cell;
      m.makeScale(cell * GAP, cell * GAP, 1);
      m.setPosition(cx, cy, z);
      mesh.setMatrixAt(i, m);
      opts.color(v, rgb);
      mesh.setColorAt(i, c.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace));
      if (opts.alpha) alphas.array[i] = opts.alpha(v);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.mesh = mesh;
    this.group.add(mesh);
  }

  clearMesh() {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.dispose();
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
  }

  dispose() {
    this.clearMesh();
  }
}
