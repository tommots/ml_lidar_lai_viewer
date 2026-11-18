import * as THREE from 'three';
import { keepXY } from './clip.js';

const THEMES = {
  dark: { line: 0xc3cdd6, grid: 0x5d6b78, trap: 0xf2b84b, circle: 0xf2b84b, wall: 0xf2b84b, terrain: 0x7a6a55, select: 0x5cc8a4, hover: 0xe7ecf0 },
  light: { line: 0x3a4652, grid: 0x8f9ba6, trap: 0xb26a00, circle: 0xb26a00, wall: 0x5d6b78, terrain: 0xb8a588, select: 0x17705a, hover: 0x16212b },
};

export class MarkerLayer {
  constructor(data, theme) {
    this.data = data;
    this.group = new THREE.Group();
    this.group.name = 'helpers';
    this.markers = new THREE.Group();
    this.markers.name = 'markers';
    this.wall = null;
    this.materials = {};
    this.geometries = [];
    this.labels = [];
    this.top = data.canopyTop();
    this.mat('line', new THREE.LineBasicMaterial({ transparent: true, opacity: 0.4 }));
    this.mat('grid', new THREE.LineBasicMaterial({ transparent: true, opacity: 0.55 }));
    this.mat('trap', new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, opacity: 1 }));
    this.mat('circle', new THREE.LineBasicMaterial({ transparent: true, opacity: 1 }));
    this.mat('wall', new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.045, side: THREE.DoubleSide, depthWrite: false }));
    this.mat('terrain', new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.55, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
    this.mat('select', new THREE.LineBasicMaterial({ depthTest: false, transparent: true, opacity: 0.95 }));
    this.mat('hover', new THREE.LineBasicMaterial({ depthTest: false, transparent: true, opacity: 0.8 }));
    this.buildMarkers();
    this.gridLines = this.buildGrid();
    this.terrain = this.buildTerrain();
    this.selection = new THREE.LineSegments(this.geo(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1))), this.materials.select);
    this.selection.visible = false;
    this.selection.renderOrder = 10;
    const sq = this.geo(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.5, -0.5, 0), new THREE.Vector3(0.5, -0.5, 0), new THREE.Vector3(0.5, 0.5, 0), new THREE.Vector3(-0.5, 0.5, 0),
    ]));
    this.hover = new THREE.LineLoop(sq, this.materials.hover);
    this.hover.visible = false;
    this.hover.renderOrder = 10;
    this.group.add(this.markers, this.gridLines, this.selection, this.hover);
    if (this.terrain) this.group.add(this.terrain);
    this.setTheme(theme);
  }

  mat(name, m) {
    this.materials[name] = m;
    return m;
  }

  geo(g) {
    this.geometries.push(g);
    return g;
  }

  groundUnder(x, y) {
    const c = this.data.cellOf(x, y);
    return c ? this.data.groundAt(c[0], c[1]) : this.data.groundAt(0, 0);
  }

  buildMarkers() {
    const d = this.data;
    const zTop = Math.max(this.top, 2) + (d.groundAt(0, 0) || 0);
    for (const mk of d.markers) {
      if (!Number.isFinite(mk.x) || !Number.isFinite(mk.y)) continue;
      if (mk.type === 'tree') {
        const z0 = Number.isFinite(mk.z) ? mk.z : this.groundUnder(mk.x, mk.y);
        const stem = new THREE.Line(this.geo(new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(mk.x, mk.y, z0), new THREE.Vector3(mk.x, mk.y, zTop),
        ])), this.materials.line);
        const ring = new THREE.LineLoop(this.geo(circleGeometry(0.35, 24)), this.materials.line);
        ring.position.set(mk.x, mk.y, z0 + 0.02);
        this.markers.add(stem, ring);
        if (mk.label) this.labels.push({ x: mk.x, y: mk.y, z: zTop, text: mk.label, cls: 'lbl-tree' });
      } else if (mk.type === 'trap') {
        const z = Number.isFinite(mk.z) ? mk.z : this.groundUnder(mk.x, mk.y);
        const sq = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(0.6, 0.6)), this.materials.trap);
        sq.position.set(mk.x, mk.y, z + 0.06);
        sq.renderOrder = 3;
        this.markers.add(sq);
        if (mk.label) this.labels.push({ x: mk.x, y: mk.y, z: z + 0.06, text: mk.label, cls: 'lbl-trap', ground: true });
      } else if (mk.type === 'circle' && Number.isFinite(mk.r)) {
        const z = Number.isFinite(mk.z) ? mk.z : this.groundUnder(mk.x, mk.y);
        const loop = new THREE.LineLoop(this.geo(circleGeometry(mk.r, 160)), this.materials.circle);
        loop.position.set(mk.x, mk.y, z + 0.05);
        loop.renderOrder = 2.5;
        this.markers.add(loop);
        const h = Math.max(2, Math.min(50, this.top + 2));
        const wallGeo = this.geo(new THREE.CylinderGeometry(mk.r, mk.r, h, 120, 1, true));
        wallGeo.rotateX(Math.PI / 2);
        this.wall = new THREE.Mesh(wallGeo, this.materials.wall);
        this.wall.position.set(mk.x, mk.y, z + h / 2);
        this.wall.renderOrder = 4;
        this.markers.add(this.wall);
        if (mk.label) {
          const a = -Math.PI / 4;
          this.labels.push({ x: mk.x + mk.r * Math.cos(a), y: mk.y + mk.r * Math.sin(a), z: z + 0.05, text: mk.label, cls: 'lbl-circle', ground: true });
        }
      }
    }
  }

  buildGrid() {
    const d = this.data;
    const { x0, y0, nx, ny, cell } = d.grid;
    const pts = [];
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        if (!d.inMask(ix, iy)) continue;
        const z = d.rasterZ(ix, iy) + 0.05;
        const xa = x0 + ix * cell;
        const ya = y0 + iy * cell;
        const xb = xa + cell;
        const yb = ya + cell;
        pts.push(xa, ya, z, xb, ya, z, xb, ya, z, xb, yb, z, xb, yb, z, xa, yb, z, xa, yb, z, xa, ya, z);
      }
    }
    const g = this.geo(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const lines = new THREE.LineSegments(g, this.materials.grid);
    lines.name = 'footprint-grid';
    lines.renderOrder = 1.5;
    return lines;
  }

  buildTerrain() {
    const t = this.data.terrain;
    if (!t) return null;
    const { x0, y0, nx, ny, cell } = t.grid;
    const pos = new Float32Array(nx * ny * 3);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const o = (j * nx + i) * 3;
        const z = t.z[j * nx + i];
        pos[o] = x0 + i * cell;
        pos[o + 1] = y0 + j * cell;
        pos[o + 2] = Number.isFinite(z) ? z : 0;
      }
    }
    const idx = [];
    const quads = [];
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i;
        const b = a + 1;
        const c = a + nx;
        const e = c + 1;
        if (![a, b, c, e].every((n) => Number.isFinite(t.z[n]))) continue;
        idx.push(a, b, e, a, e, c);
        quads.push(i, j);
      }
    }
    const g = this.geo(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.terrainIndex = g.index.array.slice();
    this.terrainQuads = quads;
    const mesh = new THREE.Mesh(g, this.materials.terrain);
    mesh.name = 'terrain';
    mesh.renderOrder = 0;
    return mesh;
  }

  setTheme(theme) {
    const c = THEMES[theme] || THEMES.dark;
    for (const [k, m] of Object.entries(this.materials)) if (c[k] !== undefined) m.color.setHex(c[k]);
    this.materials.wall.opacity = theme === 'light' ? 0.035 : 0.045;
  }

  setVisible(v) {
    this.markers.visible = !!v.markers;
    if (this.wall) this.wall.visible = !!v.wall;
    this.gridLines.visible = !!v.grid;
    if (this.terrain) this.terrain.visible = !!v.terrain;
  }

  setClip(clip) {
    if (!this.terrain) return;
    const g = this.terrain.geometry;
    const t = this.data.terrain.grid;
    const idx = g.index.array;
    const q = this.terrainQuads;
    let n = 0;
    for (let k = 0; k < q.length / 2; k++) {
      if (!keepXY(clip, t.x0 + (q[2 * k] + 0.5) * t.cell, t.y0 + (q[2 * k + 1] + 0.5) * t.cell)) continue;
      idx.set(this.terrainIndex.subarray(6 * k, 6 * k + 6), 6 * n);
      n++;
    }
    g.index.needsUpdate = true;
    g.setDrawRange(0, 6 * n);
  }

  setSelection(fp) {
    if (!fp || !this.data.inMask(fp[0], fp[1])) {
      this.selection.visible = false;
      return;
    }
    const { cell } = this.data.grid;
    const [cx, cy] = this.data.cellCenter(fp[0], fp[1]);
    const g = this.data.groundAt(fp[0], fp[1]);
    const h = Math.max(this.top, 2);
    this.selection.scale.set(cell, cell, h);
    this.selection.position.set(cx, cy, g + h / 2);
    this.selection.visible = true;
  }

  setHover(h) {
    if (!h) {
      this.hover.visible = false;
      return;
    }
    const { x0, y0, cell } = h.grid;
    this.hover.scale.set(cell, cell, 1);
    this.hover.position.set(x0 + (h.ix + 0.5) * cell, y0 + (h.iy + 0.5) * cell, h.z + 0.08);
    this.hover.visible = true;
  }

  dispose() {
    for (const g of this.geometries) g.dispose();
    for (const m of Object.values(this.materials)) m.dispose();
    this.group.clear();
    this.labels = [];
  }
}

function circleGeometry(r, n) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0));
  }
  return new THREE.BufferGeometry().setFromPoints(pts);
}
