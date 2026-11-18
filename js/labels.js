import * as THREE from 'three';

const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

function labelBox(it, sx, sy) {
  const value = !!it.ink;
  const w = it.text.length * (value ? 6.6 : 7) + (value ? 4 : 16);
  return value ? { x0: sx - w / 2, x1: sx + w / 2, y0: sy - 8, y1: sy + 8 } : { x0: sx - w / 2, x1: sx + w / 2, y0: sy - 28, y1: sy - 4 };
}

function overlaps(a, b) {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

export class LabelLayer {
  constructor(container) {
    this.container = container;
    this.sets = new Map();
  }

  set(name, items, opts = {}) {
    this.remove(name);
    this.sets.set(name, {
      items, view: opts.view ?? null, minPx: opts.minPx || 0, declutter: !!opts.declutter, visible: true, els: new Map(),
      blocker: !!opts.blocker, yields: !!opts.yields, occluded: opts.occluded || null,
    });
  }

  setVisible(name, on) {
    const s = this.sets.get(name);
    if (!s) return;
    s.visible = on;
    if (!on) for (const els of s.els.values()) for (const el of els) el.style.display = 'none';
  }

  remove(name) {
    const s = this.sets.get(name);
    if (!s) return;
    for (const els of s.els.values()) for (const el of els) el.remove();
    this.sets.delete(name);
  }

  clear() {
    for (const name of [...this.sets.keys()]) this.remove(name);
  }

  elementsFor(set, vpId) {
    let els = set.els.get(vpId);
    if (!els) {
      els = set.items.map((it) => {
        const el = document.createElement('div');
        el.className = `lbl ${it.cls || ''}`;
        el.textContent = it.text;
        if (it.ink) {
          el.style.color = it.ink;
          el.classList.add(it.ink === '#ffffff' ? 'lbl-on-dark' : 'lbl-on-light');
        }
        el.style.display = 'none';
        this.container.appendChild(el);
        return el;
      });
      set.els.set(vpId, els);
    }
    return els;
  }

  update(camera, viewports, project = null) {
    const ids = new Set(viewports.map((v) => v.id));
    const sets = [...this.sets.values()];
    for (const set of sets) {
      for (const [vpId, els] of set.els) if (!ids.has(vpId)) for (const el of els) el.style.display = 'none';
    }
    const ordered = [...sets.filter((s) => s.blocker), ...sets.filter((s) => !s.blocker)];
    for (const vp of viewports) {
      if (project) project(vp);
      else {
        camera.aspect = vp.w / vp.h;
        camera.updateProjectionMatrix();
      }
      const blocked = [];
      for (const set of ordered) {
        if (!set.visible) continue;
        if (set.view && set.view !== vp.id) continue;
        const els = this.elementsFor(set, vp.id);
        const placed = [];
        for (let i = 0; i < set.items.length; i++) {
          const it = set.items[i];
          const el = els[i];
          _v.set(it.x, it.y, it.z).project(camera);
          if (_v.z < -1 || _v.z > 1 || Math.abs(_v.x) > 1.05 || Math.abs(_v.y) > 1.05) {
            el.style.display = 'none';
            continue;
          }
          if (set.minPx && it.cell) {
            _a.set(it.x - it.cell / 2, it.y, it.z).project(camera);
            _b.set(it.x + it.cell / 2, it.y, it.z).project(camera);
            const px = Math.hypot((_a.x - _b.x) * vp.w / 2, (_a.y - _b.y) * vp.h / 2);
            _a.set(it.x, it.y - it.cell / 2, it.z).project(camera);
            _b.set(it.x, it.y + it.cell / 2, it.z).project(camera);
            const py = Math.hypot((_a.x - _b.x) * vp.w / 2, (_a.y - _b.y) * vp.h / 2);
            if (Math.max(px, py) < set.minPx) {
              el.style.display = 'none';
              continue;
            }
          }
          const sx = vp.x + (_v.x + 1) * 0.5 * vp.w;
          const sy = vp.y + (1 - _v.y) * 0.5 * vp.h;
          if (sx < vp.x || sx > vp.x + vp.w) {
            el.style.display = 'none';
            continue;
          }
          const box = labelBox(it, sx, sy);
          if ((set.yields && blocked.some((b) => overlaps(b, box))) || (set.occluded && set.occluded(it, vp.id))) {
            el.style.display = 'none';
            continue;
          }
          placed.push({ el, sx, sy, z: _v.z, box });
        }
        if (set.declutter) {
          placed.sort((a, b) => a.z - b.z);
          const kept = [];
          for (const p of placed) {
            if (kept.some((k) => overlaps(k.box, p.box))) { p.el.style.display = 'none'; continue; }
            kept.push(p);
          }
          placed.length = 0;
          placed.push(...kept);
        }
        for (const p of placed) {
          p.el.style.display = '';
          p.el.style.transform = `translate(${p.sx.toFixed(1)}px, ${p.sy.toFixed(1)}px)`;
          if (set.blocker) blocked.push(p.box);
        }
      }
    }
  }
}
