import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const DEG = Math.PI / 180;

export const PRESETS = {
  oblique: { az: -55, el: 28 },
  obliqueBack: { az: 125, el: 28 },
  top: { az: -90, el: 89.9 },
  bottom: { az: -90, el: -89.9 },
  side: { az: -90, el: 1.5 },
  north: { az: 90, el: 1.5 },
  alongX: { az: 0, el: 1.5 },
  west: { az: 180, el: 1.5 },
};

export function presetDir(name) {
  const p = PRESETS[name] || PRESETS.oblique;
  return new THREE.Vector3(
    Math.cos(p.el * DEG) * Math.cos(p.az * DEG),
    Math.cos(p.el * DEG) * Math.sin(p.az * DEG),
    Math.sin(p.el * DEG),
  );
}

export class Viewer {
  constructor(host) {
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.localClippingEnabled = true;
    this.floatTextures = this.renderer.capabilities.isWebGL2 || this.renderer.extensions.has('OES_texture_float');
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    host.appendChild(this.renderer.domElement);
    this.contextHandlers = { lost: null, restored: null };
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      if (this.contextHandlers.lost) this.contextHandlers.lost();
    });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      if (this.contextHandlers.restored) this.contextHandlers.restored();
      this.requestRender();
    });

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(30, -40, 25);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.zoomToCursor = true;
    this.lastCam = { p: new THREE.Vector3(Infinity, 0, 0), q: new THREE.Quaternion(), t: new THREE.Vector3() };
    this.controls.addEventListener('change', () => { if (this.cameraMoved()) this.requestRender(); });

    const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 2.3);
    hemi.position.set(0, 0, 1);
    const sun = new THREE.DirectionalLight(0xffffff, 1.25);
    sun.position.set(-0.45, -0.75, 1.0);
    this.scene.add(hemi, sun);

    this.shared = new THREE.Group();
    this.shared.name = 'shared';
    this.views = { main: new THREE.Group(), cmp: new THREE.Group() };
    this.views.main.name = 'view-main';
    this.views.cmp.name = 'view-cmp';
    this.scene.add(this.shared, this.views.main, this.views.cmp);

    this.frame = this.frame.bind(this);
    this.compare = false;
    this.width = 1;
    this.height = 1;
    this.pending = false;
    this.animations = [];
    this.goal = null;
    this.settledDir = null;
    this.beforeRender = [];
    this.afterRender = [];
    this.stats = { frames: 0, lastMs: 0, avgMs: 0 };
    this.refDistance = 50;
    this.radius = 20;
    this.insetLeft = 0;
    this.onFrameChange = null;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
  }

  static supported() {
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      if (!gl) return false;
      const ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
      return true;
    } catch (e) {
      return false;
    }
  }

  setBackground(css) {
    this.scene.background = new THREE.Color(css);
    this.requestRender();
  }

  resize() {
    const r = this.host.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.requestRender();
  }

  setCompare(on) {
    on = !!on;
    if (on === this.compare) return 1;
    const before = this.viewports()[0];
    this.compare = on;
    const after = this.viewports()[0];
    const k = this.fitScale(this.freeAspect(after)) / this.fitScale(this.freeAspect(before));
    if (Number.isFinite(k) && k > 0 && Math.abs(k - 1) > 1e-4) {
      this.animations = [];
      const t = this.controls.target;
      this.camera.position.sub(t).multiplyScalar(k).add(t);
      this.refDistance *= k;
      this.controls.update();
      if (this.onFrameChange) this.onFrameChange();
    }
    this.requestRender();
    return k;
  }

  setInsetLeft(px) {
    const v = Math.max(0, Math.round(px) || 0);
    if (v === this.insetLeft) return;
    this.insetLeft = v;
    this.requestRender();
  }

  insetFor(vp) {
    return this.insetLeft > 0 && this.insetLeft <= vp.w / 2 ? this.insetLeft : 0;
  }

  freeAspect(vp) {
    return (vp.w - this.insetFor(vp)) / vp.h;
  }

  applyProjection(vp) {
    const c = this.camera;
    const inset = this.insetFor(vp);
    if (inset > 0) {
      c.setViewOffset(vp.w + inset, vp.h, 0, 0, vp.w, vp.h);
    } else {
      c.aspect = vp.w / vp.h;
      c.clearViewOffset();
    }
  }

  fitScale(aspect) {
    const vfov = this.camera.fov * DEG;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * Math.max(1e-3, aspect));
    return 1 / Math.sin(Math.min(vfov, hfov) / 2);
  }

  viewports() {
    const { width: w, height: h } = this;
    if (!this.compare) return [{ id: 'main', x: 0, y: 0, w, h }];
    const hw = Math.floor(w / 2);
    return [{ id: 'cmp', x: 0, y: 0, w: hw, h }, { id: 'main', x: hw, y: 0, w: w - hw, h }];
  }

  requestRender() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(this.frame);
  }

  frame(now) {
    this.pending = false;
    let moving = false;
    if (this.animations.length) {
      this.animations = this.animations.filter((a) => a(now));
      moving = this.animations.length > 0;
    }
    this.controls.update();
    const moved = this.cameraMoved();
    this.render();
    if (moved || moving) this.requestRender();
  }

  cameraMoved() {
    const c = this.camera;
    const l = this.lastCam;
    const eps = Math.max(1e-10, (this.radius * 1e-5) ** 2);
    return l.p.distanceToSquared(c.position) > eps
      || 8 * (1 - Math.abs(l.q.dot(c.quaternion))) > 1e-8
      || l.t.distanceToSquared(this.controls.target) > eps;
  }

  render() {
    const t0 = performance.now();
    const { renderer, scene, camera } = this;
    const vps = this.viewports();
    this.applyProjection(vps[0]);
    for (const cb of this.beforeRender) cb(this);
    renderer.setScissorTest(vps.length > 1);
    for (const vp of vps) {
      this.views.main.visible = vp.id === 'main';
      this.views.cmp.visible = vp.id === 'cmp';
      const y = this.height - vp.y - vp.h;
      renderer.setViewport(vp.x, y, vp.w, vp.h);
      if (vps.length > 1) renderer.setScissor(vp.x, y, vp.w, vp.h);
      renderer.render(scene, camera);
    }
    renderer.setScissorTest(false);
    this.views.main.visible = true;
    this.lastCam.p.copy(camera.position);
    this.lastCam.q.copy(camera.quaternion);
    this.lastCam.t.copy(this.controls.target);
    const ms = performance.now() - t0;
    this.stats.frames += 1;
    this.stats.lastMs = ms;
    this.stats.avgMs = this.stats.avgMs ? this.stats.avgMs * 0.9 + ms * 0.1 : ms;
    for (const cb of this.afterRender) cb(this);
  }

  viewAt(clientX, clientY) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const x = clientX - r.left;
    const y = clientY - r.top;
    for (const vp of this.viewports()) {
      if (x >= vp.x && x < vp.x + vp.w && y >= vp.y && y < vp.y + vp.h) {
        const ndc = new THREE.Vector2(((x - vp.x) / vp.w) * 2 - 1, -((y - vp.y) / vp.h) * 2 + 1);
        return { vp, ndc, x, y };
      }
    }
    return null;
  }

  rayAt(clientX, clientY) {
    const v = this.viewAt(clientX, clientY);
    if (!v) return null;
    const rc = new THREE.Raycaster();
    this.applyProjection(v.vp);
    rc.setFromCamera(v.ndc, this.camera);
    return { ray: rc.ray, vp: v.vp, x: v.x, y: v.y };
  }

  fit(bounds, preset = 'oblique', animate = false, limits = null) {
    const half = (b) => new THREE.Vector3(...b.max).sub(new THREE.Vector3(...b.min)).length() / 2;
    const min = new THREE.Vector3(...bounds.min);
    const max = new THREE.Vector3(...bounds.max);
    const center = min.clone().add(max).multiplyScalar(0.5);
    const radius = Math.max(1, half(bounds));
    const outer = limits ? Math.max(radius, half(limits)) : radius;
    this.radius = outer;
    const vp = this.viewports()[0];
    const dist = radius * this.fitScale(this.freeAspect(vp)) * 0.82;
    const pos = center.clone().addScaledVector(presetDir(preset), dist);
    this.camera.near = Math.max(0.02, radius / 300);
    this.camera.far = outer * 40;
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = Math.max(0.3, radius / 60);
    this.controls.maxDistance = outer * 12;
    this.refDistance = outer * this.fitScale(this.freeAspect(vp)) * 0.82;
    if (this.onFrameChange) this.onFrameChange();
    this.moveTo(pos, center, animate);
  }

  moveTo(pos, target, animate = true) {
    this.settle(pos, target);
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!animate || reduce) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
      this.requestRender();
      return;
    }
    const p0 = this.camera.position.clone();
    const t0 = this.controls.target.clone();
    const start = performance.now();
    const dur = 450;
    this.animations = [(now) => {
      const u = Math.min(1, (now - start) / dur);
      const e = 1 - (1 - u) ** 3;
      this.camera.position.lerpVectors(p0, pos, e);
      this.controls.target.lerpVectors(t0, target, e);
      return u < 1;
    }];
    this.requestRender();
  }

  settle(pos, target) {
    this.goal = { pos: pos.clone(), target: target.clone() };
    this.settledDir = pos.clone().sub(target).normalize();
  }

  isSettled() {
    if (!this.settledDir) return false;
    if (this.animations.length) return true;
    return this.viewDir().dot(this.settledDir) > Math.cos(0.5 * DEG);
  }

  viewDir(out = new THREE.Vector3()) {
    return out.subVectors(this.camera.position, this.controls.target).normalize();
  }

  turn(kind) {
    if (this.animations.length && this.goal) {
      this.animations = [];
      this.camera.position.copy(this.goal.pos);
      this.controls.target.copy(this.goal.target);
      this.controls.update();
    }
    const target = this.controls.target.clone();
    const off = this.camera.position.clone().sub(target);
    const r = off.length();
    if (r < 1e-9) return;
    const az0 = Math.atan2(off.y, off.x);
    const el0 = Math.asin(Math.min(1, Math.max(-1, off.z / r)));
    const az1 = kind === 'h' ? az0 + Math.PI : az0;
    const el1 = kind === 'h' ? el0 : -el0;
    const at = (u) => {
      const az = az0 + (az1 - az0) * u;
      const el = el0 + (el1 - el0) * u;
      return new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el))
        .multiplyScalar(r).add(target);
    };
    const end = at(1);
    this.settle(end, target);
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      this.camera.position.copy(end);
      this.controls.update();
      this.requestRender();
      return;
    }
    const start = performance.now();
    const dur = 600;
    this.animations = [(now) => {
      const u = Math.min(1, (now - start) / dur);
      const e = u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2;
      this.camera.position.copy(at(e));
      return u < 1;
    }];
    this.requestRender();
  }

  getCameraState() {
    return { position: this.camera.position.toArray(), target: this.controls.target.toArray() };
  }

  setCameraState(s) {
    this.animations = [];
    this.camera.position.fromArray(s.position);
    this.controls.target.fromArray(s.target);
    this.controls.update();
    this.settle(this.camera.position, this.controls.target);
    this.requestRender();
  }

  targetDistance() {
    return this.camera.position.distanceTo(this.controls.target);
  }

  benchmark(frames = 30) {
    const gl = this.renderer.getContext();
    const target = this.controls.target.clone();
    const offset = this.camera.position.clone().sub(target);
    const pos0 = this.camera.position.clone();
    const px = new Uint8Array(4);
    this.render();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) {
      const a = (i / frames) * Math.PI * 0.5;
      const o = offset.clone().applyAxisAngle(new THREE.Vector3(0, 0, 1), a);
      this.camera.position.copy(target).add(o);
      this.camera.lookAt(target);
      this.render();
    }
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const ms = (performance.now() - t0) / frames;
    this.camera.position.copy(pos0);
    this.controls.update();
    this.requestRender();
    return { frames, msPerFrame: ms };
  }
}
