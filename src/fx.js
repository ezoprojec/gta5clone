// Lightweight particle + tracer effects using a pooled set of sprites.
import * as THREE from 'three';
import { rand } from './util.js';

function radialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const MAX = 420;

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.tex = radialTexture();
    this.pool = [];
    this.active = [];
    for (let i = 0; i < MAX; i++) {
      const m = new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false });
      const s = new THREE.Sprite(m);
      s.visible = false;
      scene.add(s);
      this.pool.push({ s, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size0: 1, size1: 1, gravity: 0, additive: false });
    }
    this.tracers = [];
    this.tracerMat = new THREE.LineBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.9 });
    // skid marks: one ring-buffered mesh of thin quads laid on the road
    this.SKID_MAX = 1500;
    const sg = new THREE.BufferGeometry();
    this.skidPos = new Float32Array(this.SKID_MAX * 6 * 3);
    sg.setAttribute('position', new THREE.BufferAttribute(this.skidPos, 3));
    this.skidMesh = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({
      color: 0x111111, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
    }));
    this.skidMesh.frustumCulled = false;
    scene.add(this.skidMesh);
    this.skidIdx = 0;
    // rain: a box of falling streaks that follows the camera
    const RN = 2600;
    const rp = new Float32Array(RN * 6);
    for (let i = 0; i < RN; i++) {
      const x = rand(-40, 40), y = rand(0, 40), z = rand(-40, 40);
      rp.set([x, y, z, x + 0.05, y - 0.7, z], i * 6);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xaabbcc, transparent: true, opacity: 0 }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    scene.add(this.rain);
    this.flash = new THREE.PointLight(0xffaa55, 0, 12, 2);
    scene.add(this.flash);
    this.flashT = 0;
  }

  spawn(x, y, z, o) {
    const p = this.pool.pop() || this.active.shift();
    if (!p) return;
    p.s.position.set(x, y, z);
    p.vx = o.vx || 0; p.vy = o.vy || 0; p.vz = o.vz || 0;
    p.life = p.max = o.life || 1;
    p.size0 = o.size0 ?? 0.5; p.size1 = o.size1 ?? 1;
    p.gravity = o.gravity || 0;
    p.drag = o.drag ?? 0;
    p.alpha = o.alpha ?? 1;
    p.s.material.color.setHex(o.color ?? 0xffffff);
    p.s.material.blending = o.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    p.s.material.opacity = p.alpha;
    p.s.scale.setScalar(p.size0);
    p.s.visible = true;
    this.active.push(p);
  }

  smoke(x, y, z, shade = 0.5) {
    const g = Math.floor(shade * 255);
    this.spawn(x + rand(-0.3, 0.3), y, z + rand(-0.3, 0.3), {
      vx: rand(-0.4, 0.4), vy: rand(1.2, 2.2), vz: rand(-0.4, 0.4), life: rand(1.4, 2.2),
      size0: 0.6, size1: 2.6, color: (g << 16) | (g << 8) | g, alpha: 0.55, drag: 0.5,
    });
  }
  fire(x, y, z) {
    this.spawn(x + rand(-0.5, 0.5), y, z + rand(-0.5, 0.5), {
      vx: rand(-0.3, 0.3), vy: rand(2, 3.5), vz: rand(-0.3, 0.3), life: rand(0.4, 0.8),
      size0: 1.1, size1: 0.2, color: Math.random() < 0.5 ? 0xff7a1a : 0xffc23a, additive: true,
    });
    if (Math.random() < 0.3) this.smoke(x, y + 1, z, 0.12);
  }
  sparks(x, y, z, n = 6, color = 0xffd36a) {
    for (let i = 0; i < n; i++) {
      this.spawn(x, y, z, {
        vx: rand(-5, 5), vy: rand(1, 6), vz: rand(-5, 5), life: rand(0.2, 0.45),
        size0: 0.18, size1: 0.05, color, additive: true, gravity: 18,
      });
    }
  }
  blood(x, y, z) {
    for (let i = 0; i < 8; i++) {
      this.spawn(x, y, z, {
        vx: rand(-2, 2), vy: rand(0, 3), vz: rand(-2, 2), life: rand(0.3, 0.6),
        size0: 0.22, size1: 0.12, color: 0x9a0a0a, gravity: 12,
      });
    }
  }
  dust(x, y, z) {
    this.spawn(x, y, z, { vx: rand(-1, 1), vy: rand(0.5, 1.5), vz: rand(-1, 1), life: 0.5, size0: 0.3, size1: 0.9, color: 0xb8b0a0, alpha: 0.5 });
  }
  muzzle(x, y, z) {
    this.spawn(x, y, z, { life: 0.06, size0: 0.7, size1: 0.3, color: 0xffd080, additive: true });
    this.flash.position.set(x, y, z);
    this.flash.intensity = 30;
    this.flashT = 0.05;
  }
  explosion(x, y, z) {
    for (let i = 0; i < 40; i++) {
      this.spawn(x + rand(-1, 1), y + rand(0, 1), z + rand(-1, 1), {
        vx: rand(-9, 9), vy: rand(2, 12), vz: rand(-9, 9), life: rand(0.5, 1.1),
        size0: rand(2, 3.5), size1: 0.5, color: Math.random() < 0.5 ? 0xff6a10 : 0xffd040, additive: true, drag: 2.5,
      });
    }
    for (let i = 0; i < 18; i++) {
      this.spawn(x + rand(-2, 2), y + rand(0, 2), z + rand(-2, 2), {
        vx: rand(-3, 3), vy: rand(2, 6), vz: rand(-3, 3), life: rand(2, 3.5),
        size0: 2, size1: 7, color: 0x262626, alpha: 0.7, drag: 1,
      });
    }
    this.flash.position.set(x, y + 2, z);
    this.flash.intensity = 800;
    this.flash.distance = 60;
    this.flashT = 0.25;
  }
  skid(ax, az, bx, bz, y = 0) {
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.05 || len > 3) return;
    const w = 0.13, nx = (-dz / len) * w, nz = (dx / len) * w;
    const yy = y + 0.035;
    const v = [ax - nx, yy, az - nz, bx - nx, yy, bz - nz, bx + nx, yy, bz + nz, ax - nx, yy, az - nz, bx + nx, yy, bz + nz, ax + nx, yy, az + nz];
    this.skidPos.set(v, this.skidIdx * 18);
    this.skidIdx = (this.skidIdx + 1) % this.SKID_MAX;
    const attr = this.skidMesh.geometry.attributes.position;
    attr.needsUpdate = true;
  }
  tireSmoke(x, y, z) {
    this.spawn(x + rand(-0.2, 0.2), y, z + rand(-0.2, 0.2), {
      vx: rand(-0.6, 0.6), vy: rand(0.4, 1.2), vz: rand(-0.6, 0.6), life: rand(0.8, 1.4),
      size0: 0.6, size1: 2.4, color: 0xdddddd, alpha: 0.35, drag: 1.2,
    });
  }
  // intensity 0..1, follows the camera position
  setRain(k, cam, dt) {
    this.rain.visible = k > 0.02;
    if (!this.rain.visible) return;
    this.rain.material.opacity = 0.45 * k;
    const a = this.rain.geometry.attributes.position.array;
    const fall = 32 * dt;
    for (let i = 0; i < a.length; i += 6) {
      a[i + 1] -= fall;
      a[i + 4] -= fall;
      if (a[i + 4] < 0) {
        a[i + 1] += 40;
        a[i + 4] += 40;
      }
    }
    this.rain.geometry.attributes.position.needsUpdate = true;
    this.rain.position.set(Math.floor(cam.x / 20) * 20, Math.floor(cam.y / 40) * 40 - 8, Math.floor(cam.z / 20) * 20);
    // splashes near the camera
    if (Math.random() < k * 0.8) this.spawn(cam.x + rand(-10, 10), 0.1, cam.z + rand(-10, 10), { life: 0.2, size0: 0.15, size1: 0.35, color: 0xcfe0ff, alpha: 0.5 });
  }
  tracer(ax, ay, az, bx, by, bz) {
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(ax, ay, az), new THREE.Vector3(bx, by, bz)]);
    const l = new THREE.Line(g, this.tracerMat);
    this.scene.add(l);
    this.tracers.push({ l, life: 0.05 });
  }

  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.s.visible = false;
        this.active.splice(i, 1);
        this.pool.push(p);
        continue;
      }
      const k = 1 - p.life / p.max;
      p.vy -= p.gravity * dt;
      if (p.drag) {
        const f = Math.exp(-p.drag * dt);
        p.vx *= f; p.vy *= f; p.vz *= f;
      }
      p.s.position.x += p.vx * dt;
      p.s.position.y = Math.max(0.05, p.s.position.y + p.vy * dt);
      p.s.position.z += p.vz * dt;
      p.s.scale.setScalar(p.size0 + (p.size1 - p.size0) * k);
      p.s.material.opacity = p.alpha * (1 - k);
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      if (t.life <= 0) {
        this.scene.remove(t.l);
        t.l.geometry.dispose();
        this.tracers.splice(i, 1);
      }
    }
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) {
        this.flash.intensity = 0;
        this.flash.distance = 12;
      }
    }
  }
}
