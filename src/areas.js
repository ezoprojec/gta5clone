// Unique areas and landmarks: the Ironworks freight yard, Bay Arena stadium, a stunt park,
// Lantern Market, gas stations with explosive pumps, a construction site, Apex Tower,
// the Lucky Star Hotel, the Old Town clock tower, Palm Heights pools, a lighthouse,
// a marina, the hills to the north — plus district names and hidden Neon Tokens.
import * as THREE from 'three';
import { GeoBuilder, CURB, HALF, N, CELL, BEACH_Z, WATER_Z, PIER, SIDEWALK } from './world.js';
import { mulberry32, formatMoney, rayAABB, rand } from './util.js';

const C = (hex) => new THREE.Color(hex);
const m4 = new THREE.Matrix4();
const qq = new THREE.Quaternion();
const sv = new THREE.Vector3();
const pv = new THREE.Vector3();
const ee = new THREE.Euler();
const place = (mesh, k, x, y, z, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) => {
  m4.compose(pv.set(x, y, z), qq.setFromEuler(ee.set(rx, ry, rz)), sv.set(sx, sy, sz));
  mesh.setMatrixAt(k, m4);
};
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...o });

// Text on a transparent canvas, used for signs. Brightness can exceed 1 for bloom.
function textSign(text, w, h, { fg = '#fff', bg = null, font = 'italic 900', glow = null } = {}) {
  const cv = document.createElement('canvas');
  cv.width = 1024;
  cv.height = Math.round((1024 * h) / w);
  const c = cv.getContext('2d');
  if (bg) {
    c.fillStyle = bg;
    c.fillRect(0, 0, cv.width, cv.height);
  }
  let size = cv.height * 0.75;
  c.font = `${font} ${size}px Impact, 'Arial Black', sans-serif`;
  while (c.measureText(text).width > cv.width * 0.92 && size > 10) {
    size -= 4;
    c.font = `${font} ${size}px Impact, 'Arial Black', sans-serif`;
  }
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  if (glow) {
    c.shadowColor = glow;
    c.shadowBlur = 24;
  }
  c.fillStyle = fg;
  c.fillText(text, cv.width / 2, cv.height / 2);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  const mat = new THREE.MeshBasicMaterial({ map: t, transparent: !bg, side: THREE.DoubleSide, depthWrite: !!bg });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
}

function corrugatedTexture() {
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 64;
  const c = cv.getContext('2d');
  for (let x = 0; x < 64; x++) {
    const v = 200 + Math.sin((x / 64) * Math.PI * 16) * 40;
    c.fillStyle = `rgb(${v},${v},${v})`;
    c.fillRect(x, 0, 1, 64);
  }
  c.fillStyle = 'rgba(120,70,30,0.15)';
  for (let i = 0; i < 20; i++) c.fillRect(Math.random() * 64, Math.random() * 64, 3, 8);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Areas {
  constructor(G) {
    this.G = G;
    this.world = G.world;
    this.scene = G.scene;
    this.rng = mulberry32(777);
    this.plain = new GeoBuilder();
    this.neon = new GeoBuilder();
    this.metal = new GeoBuilder();
    this.corr = new GeoBuilder();
    this.fb = { glass: new GeoBuilder(), office: new GeoBuilder(), brick: new GeoBuilder(), store: new GeoBuilder() };
    this.destructibles = [];
    this.smokers = [];
    this.tokens = [];
    this.collected = new Set();
    this.labels = []; // big-map labels
    this.district = null;
    this.blinkers = [];

    const byType = (t) => this.world.blocks.filter((b) => b.type === t);
    byType('industrial').forEach((b) => this.buildIndustrial(b));
    byType('stadium').forEach((b) => this.buildStadium(b));
    byType('stunt').forEach((b) => this.buildStuntPark(b));
    this.buildBeachRamps();
    const markets = byType('market');
    markets.forEach((b) => this.buildMarket(b));
    byType('gas').forEach((b) => this.buildGasStation(b));
    byType('construction').forEach((b) => this.buildConstruction(b));
    byType('tower').forEach((b) => this.buildApexTower(b));
    byType('hotel').forEach((b) => this.buildHotel(b));
    byType('clocktower').forEach((b) => this.buildClockTower(b));
    this.world.blocks.filter((b) => b.pools).forEach((b) => this.buildPools(b));
    this.buildLighthouse();
    this.buildMarina();
    this.buildHills();
    this.flush();
    this.buildTokens();

    // district labels for the big map
    const seen = new Set();
    for (const b of this.world.blocks) {
      if (seen.has(b.district)) continue;
      const same = this.world.blocks.filter((o) => o.district === b.district);
      const x = same.reduce((s, o) => s + (o.x0 + o.x1) / 2, 0) / same.length;
      const z = same.reduce((s, o) => s + (o.z0 + o.z1) / 2, 0) / same.length;
      this.labels.push({ x, z, text: b.district });
      seen.add(b.district);
    }
    this.labels.push({ x: -200, z: BEACH_Z + 30, text: 'Neon Bay Beach' });
  }

  // ---------------------------------------------------------------- helpers
  building(style, x0, z0, x1, z1, h, color, opts = {}) {
    const us = opts.us ?? (style === 'glass' ? 1 / 48 : 1 / 32);
    const vs = opts.vs ?? (style === 'glass' ? 1 / 56 : 1 / 28);
    this.fb[style].box(x0, opts.y0 ?? CURB, z0, x1, h, z1, C(color), us, vs, true);
    if (!opts.noCollide) this.world.addCollider({ minX: x0, minZ: z0, maxX: x1, maxZ: z1, h });
  }
  collider(x0, z0, x1, z1, h, small = true) {
    this.world.addCollider({ minX: Math.min(x0, x1), minZ: Math.min(z0, z1), maxX: Math.max(x0, x1), maxZ: Math.max(z0, z1), h, small });
  }
  label(b, text, icon, blip) {
    this.labels.push({ x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2, text, landmark: true, icon, blip });
  }
  inner(b) {
    return { x0: b.x0 + SIDEWALK, z0: b.z0 + SIDEWALK, x1: b.x1 - SIDEWALK, z1: b.z1 - SIDEWALK, cx: (b.x0 + b.x1) / 2, cz: (b.z0 + b.z1) / 2 };
  }
  // wedge ramp that also raises the ground for driving
  ramp(x0, z0, x1, z1, axis, dir, h, base, color = 0x9a9a9e, flat = false) {
    this.world.ramps.push({ x0, z0, x1, z1, axis, dir, h, base, flat });
    const g = this.plain;
    const col = C(color);
    const y0 = base + 0.01, y1 = base + h;
    if (flat) {
      g.box(x0, base, z0, x1, y1, z1, col, 0, 0);
      return;
    }
    // corners: low edge and high edge
    let lo, hi; // each is [[x,z],[x,z]]
    if (axis === 'x') {
      const lx = dir > 0 ? x0 : x1, hx = dir > 0 ? x1 : x0;
      lo = [[lx, z0], [lx, z1]];
      hi = [[hx, z0], [hx, z1]];
    } else {
      const lz = dir > 0 ? z0 : z1, hz = dir > 0 ? z1 : z0;
      lo = [[x0, lz], [x1, lz]];
      hi = [[x0, hz], [x1, hz]];
    }
    const P = (p, y) => [p[0], y, p[1]];
    const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
    // slope (both windings so it shows regardless of orientation)
    g.quad(P(lo[0], y0), P(lo[1], y0), P(hi[1], y1), P(hi[0], y1), [0, 1, 0], uv, col);
    g.quad(P(hi[0], y1), P(hi[1], y1), P(lo[1], y0), P(lo[0], y0), [0, 1, 0], uv, col);
    // back face + sides
    const dark = col.clone().multiplyScalar(0.6);
    g.quad(P(hi[0], y0), P(hi[1], y0), P(hi[1], y1), P(hi[0], y1), [0, 0, 1], uv, dark);
    g.quad(P(hi[1], y0), P(hi[0], y0), P(hi[0], y1), P(hi[1], y1), [0, 0, -1], uv, dark);
    for (const k of [0, 1]) {
      g.quad(P(lo[k], y0), P(hi[k], y0), P(hi[k], y1), P(hi[k], y1), [1, 0, 0], uv, dark);
      g.quad(P(hi[k], y0), P(lo[k], y0), P(hi[k], y1), P(hi[k], y1), [-1, 0, 0], uv, dark);
    }
    // chevrons on the slope
    for (let t = 0.2; t < 0.9; t += 0.3) {
      const a = [lo[0][0] + (hi[0][0] - lo[0][0]) * t, lo[0][1] + (hi[0][1] - lo[0][1]) * t];
      const b = [lo[1][0] + (hi[1][0] - lo[1][0]) * t, lo[1][1] + (hi[1][1] - lo[1][1]) * t];
      const t2 = t + 0.08;
      const c2 = [lo[1][0] + (hi[1][0] - lo[1][0]) * t2, lo[1][1] + (hi[1][1] - lo[1][1]) * t2];
      const d2 = [lo[0][0] + (hi[0][0] - lo[0][0]) * t2, lo[0][1] + (hi[0][1] - lo[0][1]) * t2];
      const ya = y0 + h * t + 0.03, yb = y0 + h * t2 + 0.03;
      this.neon.quad(P(a, ya), P(b, ya), P(c2, yb), P(d2, yb), [0, 1, 0], uv, C(0xffc21a));
      this.neon.quad(P(d2, yb), P(c2, yb), P(b, ya), P(a, ya), [0, 1, 0], uv, C(0xffc21a));
    }
  }
  flush() {
    const add = (g, mat, shadow = true) => {
      if (!g.pos.length) return;
      const m = new THREE.Mesh(g.build(), mat);
      m.castShadow = shadow;
      m.receiveShadow = true;
      this.scene.add(m);
    };
    add(this.plain, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
    add(this.metal, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.6 }));
    const corrTex = corrugatedTexture();
    add(this.corr, new THREE.MeshStandardMaterial({ map: corrTex, vertexColors: true, roughness: 0.6, metalness: 0.3 }));
    add(this.neon, new THREE.MeshBasicMaterial({ vertexColors: true }), false);
    for (const [style, g] of Object.entries(this.fb)) add(g, this.world.facadeMats[style]);
  }

  // ---------------------------------------------------------------- Ironworks
  buildIndustrial(b) {
    const rng = this.rng;
    const I = this.inner(b);
    const kind = b.bj % 3;
    if (kind === 0) {
      // big warehouse with loading bays
      const x0 = I.x0 + 3, x1 = I.x1 - 3, z0 = I.z0 + 4, z1 = I.z1 - 14;
      const col = [0x8a9aa8, 0xa8846a, 0x7a8a7a][b.bj % 3];
      this.corr.box(x0, CURB, z0, x1, CURB + 11, z1, C(col), 1 / 3, 1 / 11, true);
      this.collider(x0, z0, x1, z1, 11.2, false);
      // pitched roof
      this.metal.box(x0 - 0.5, CURB + 11, z0 - 0.5, x1 + 0.5, CURB + 11.4, z1 + 0.5, C(0x5a5f66));
      this.metal.box(x0, CURB + 11.4, (z0 + z1) / 2 - 4, x1, CURB + 13, (z0 + z1) / 2 + 4, C(0x5a5f66));
      for (let k = 0; k < 4; k++) {
        const dx = x0 + 4 + k * ((x1 - x0 - 8) / 3);
        this.plain.box(dx - 2.2, CURB, z1, dx + 2.2, CURB + 5, z1 + 0.15, C(0x3a3a3e), 0, 0); // roll-up door
        this.plain.box(dx - 2.6, CURB, z1, dx + 2.6, CURB + 1.2, z1 + 2.4, C(0x7a7a7e), 0, 0); // dock
        this.neon.box(dx - 0.3, CURB + 5.4, z1 + 0.1, dx + 0.3, CURB + 5.7, z1 + 0.4, C(0xffb040));
      }
    } else if (kind === 1) {
      // container yard: stacks of colourful shipping containers in rows
      const cols = [0xc0392b, 0x2e86c1, 0x27ae60, 0xd68910, 0x7d3c98, 0x839192, 0xa04000];
      const list = [];
      for (let row = 0; row < 4; row++) {
        for (let k = 0; k < 3; k++) {
          if (row === 2 && k === 1) continue; // a gap in the maze
          const x = I.x0 + 6 + k * 16, z = I.z0 + 5 + row * 12;
          const hgt = 1 + Math.floor(rng() * 3);
          for (let l = 0; l < hgt; l++) list.push([x, z, l, cols[Math.floor(rng() * cols.length)]]);
          this.collider(x - 6.2, z - 1.3, x + 6.2, z + 1.3, 2.6 * hgt, false);
        }
      }
      const geo = new THREE.BoxGeometry(12.2, 2.6, 2.5);
      const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ map: corrugatedTextureCached(), roughness: 0.6, metalness: 0.3 }), list.length);
      list.forEach(([x, z, l, c], k) => {
        place(im, k, x, CURB + 1.3 + l * 2.6, z);
        im.setColorAt(k, C(c));
      });
      im.castShadow = im.receiveShadow = true;
      this.scene.add(im);
      // gantry crane over the yard
      const gx0 = I.x0 + 1, gx1 = I.x1 - 1, gz = (I.z0 + I.z1) / 2;
      for (const x of [gx0, gx1]) {
        this.metal.box(x - 0.6, CURB, gz - 8, x + 0.6, CURB + 16, gz - 7, C(0xe0b020));
        this.metal.box(x - 0.6, CURB, gz + 7, x + 0.6, CURB + 16, gz + 8, C(0xe0b020));
        this.collider(x - 0.7, gz - 8, x + 0.7, gz - 7, 16);
        this.collider(x - 0.7, gz + 7, x + 0.7, gz + 8, 16);
      }
      this.metal.box(gx0 - 0.6, CURB + 16, gz - 8, gx1 + 0.6, CURB + 17.5, gz - 6.5, C(0xe0b020));
      this.metal.box(gx0 - 0.6, CURB + 16, gz + 6.5, gx1 + 0.6, CURB + 17.5, gz + 8, C(0xe0b020));
      this.metal.box(gx0 + 10, CURB + 15, gz - 7, gx0 + 14, CURB + 18, gz + 7, C(0x3a3a3e));
      if (!this.yardToken) this.yardToken = { x: I.x0 + 22, z: I.z0 + 29 };
    } else {
      // fuel tanks + a smokestack
      const tankGeo = new THREE.CylinderGeometry(6, 6, 9, 24);
      const tanks = new THREE.InstancedMesh(tankGeo, std(0xdedede, { metalness: 0.5, roughness: 0.4 }), 4);
      [[I.x0 + 10, I.z0 + 10], [I.x0 + 26, I.z0 + 10], [I.x0 + 10, I.z0 + 26], [I.x0 + 26, I.z0 + 26]].forEach(([x, z], k) => {
        place(tanks, k, x, CURB + 4.5, z);
        this.collider(x - 6, z - 6, x + 6, z + 6, 9, false);
        this.metal.box(x - 6.1, CURB + 3.5, z - 0.3, x + 6.1, CURB + 4, z + 0.3, C(0xc0392b));
      });
      tanks.castShadow = tanks.receiveShadow = true;
      this.scene.add(tanks);
      const sx = I.x1 - 8, sz = I.z1 - 8;
      const stack = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.4, 42, 16), std(0x9a9a9a));
      stack.position.set(sx, CURB + 21, sz);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.75, 4, 16), std(0xc0392b));
      band.position.set(sx, CURB + 38, sz);
      stack.castShadow = true;
      this.scene.add(stack, band);
      this.collider(sx - 2.4, sz - 2.4, sx + 2.4, sz + 2.4, 42, false);
      this.smokers.push({ x: sx, y: CURB + 43, z: sz });
      this.blinkers.push(this.beacon(sx, CURB + 42.6, sz));
    }
  }
  beacon(x, y, z) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
    m.position.set(x, y, z);
    this.scene.add(m);
    return m;
  }

  // ---------------------------------------------------------------- Bay Arena
  buildStadium(b) {
    const I = this.inner(b);
    const cx = I.cx, cz = I.cz;
    const R = 26.5, sz = 0.88;
    const gap = 0.32;
    const g = new THREE.Group();
    g.position.set(cx, CURB, cz);
    g.scale.set(1, 1, sz);
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 15, 64, 1, true, gap, Math.PI * 2 - gap * 2), std(0xd8d4cc, { side: THREE.DoubleSide }));
    wall.position.y = 7.5;
    const stands = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.5, 17, 13, 64, 6, true, gap, Math.PI * 2 - gap * 2), std(0x2f5f9a, { side: THREE.DoubleSide, flatShading: true }));
    stands.position.y = 7;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.6, 6, 64, Math.PI * 2 - gap * 2), std(0xf2f2f2));
    rim.rotation.x = Math.PI / 2;
    rim.rotation.z = -Math.PI / 2 - (Math.PI * 2 - gap * 2) - gap + Math.PI;
    rim.position.y = 15;
    g.add(wall, stands, rim);
    // pitch
    const cv = document.createElement('canvas');
    cv.width = 256;
    cv.height = 256;
    const c = cv.getContext('2d');
    for (let i = 0; i < 8; i++) {
      c.fillStyle = i % 2 ? '#3f8f3a' : '#4a9a42';
      c.fillRect(0, i * 32, 256, 32);
    }
    c.strokeStyle = '#fff';
    c.lineWidth = 3;
    c.strokeRect(40, 30, 176, 196);
    c.beginPath();
    c.moveTo(40, 128);
    c.lineTo(216, 128);
    c.stroke();
    c.beginPath();
    c.arc(128, 128, 24, 0, Math.PI * 2);
    c.stroke();
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.pitchMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0 });
    const pitch = new THREE.Mesh(new THREE.CircleGeometry(17.2, 48).rotateX(-Math.PI / 2), this.pitchMat);
    pitch.position.y = 0.04;
    pitch.receiveShadow = true;
    g.add(pitch);
    wall.castShadow = stands.castShadow = true;
    stands.receiveShadow = true;
    this.scene.add(g);
    // ring colliders (leave the south entrance open)
    for (let k = 0; k < 20; k++) {
      const a = (k / 20) * Math.PI * 2 + Math.PI / 20;
      if (a < gap + 0.15 || a > Math.PI * 2 - gap - 0.15) continue;
      const x = cx + Math.sin(a) * (R - 3), z = cz + Math.cos(a) * (R - 3) * sz;
      this.collider(x - 3.2, z - 3.2, x + 3.2, z + 3.2, 15, false);
    }
    // floodlight towers
    this.floodMat = new THREE.MeshBasicMaterial({ color: 0x555555 });
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const x = cx + dx * 25, z = cz + dz * 25;
      this.metal.box(x - 0.4, CURB, z - 0.4, x + 0.4, CURB + 30, z + 0.4, C(0x8a8a8e));
      const head = new THREE.Mesh(new THREE.BoxGeometry(4, 2.4, 0.6), this.floodMat);
      head.position.set(x, CURB + 30, z);
      head.lookAt(cx, CURB, cz);
      this.scene.add(head);
      this.collider(x - 0.5, z - 0.5, x + 0.5, z + 0.5, 30);
    }
    // name sign over the entrance
    const sign = textSign('BAY ARENA', 18, 3.2, { fg: '#ffffff', glow: '#3fa0ff' });
    sign.position.set(cx, CURB + 17.5, cz + R * sz + 0.5);
    this.scene.add(sign);
    this.stadiumSign = sign;
    this.stadiumToken = { x: cx, z: cz };
    this.label(b, 'Bay Arena', 'A', '#3fa0ff');
  }

  // ---------------------------------------------------------------- stunts
  buildStuntPark(b) {
    const I = this.inner(b);
    // main jump: launch ramp heading south, gap, landing ramp
    const w0 = I.cx - 5, w1 = I.cx + 5;
    this.ramp(w0, I.z0 + 2, w1, I.z0 + 14, 'z', 1, 3.2, CURB, 0xb0b0b4);
    this.ramp(w0, I.z1 - 16, w1, I.z1 - 2, 'z', -1, 3.2, CURB, 0xb0b0b4);
    // side kicker ramps heading east and west
    this.ramp(I.x0 + 2, I.z0 + 20, I.x0 + 12, I.z0 + 27, 'x', 1, 2.2, CURB, 0xd05a2a);
    this.ramp(I.x1 - 12, I.z1 - 27, I.x1 - 2, I.z1 - 20, 'x', -1, 2.2, CURB, 0xd05a2a);
    // tyre stacks + barriers
    const tyres = new THREE.InstancedMesh(new THREE.TorusGeometry(0.45, 0.22, 6, 12).rotateX(Math.PI / 2), std(0x151515), 60);
    let k = 0;
    for (let i = 0; i < 12; i++) {
      const x = i < 6 ? I.x0 + 1.5 : I.x1 - 1.5, z = I.z0 + 5 + (i % 6) * 9;
      for (let l = 0; l < 5 && k < 60; l++) place(tyres, k++, x, CURB + 0.22 + l * 0.42, z);
      this.collider(x - 0.7, z - 0.7, x + 0.7, z + 0.7, 2);
    }
    tyres.count = k;
    tyres.castShadow = true;
    this.scene.add(tyres);
    // flags + banner
    const banner = textSign('STUNT PARK', 20, 3.5, { bg: '#111', fg: '#ffc21a' });
    banner.position.set(I.cx, CURB + 7, I.z0 - 0.5);
    banner.rotation.y = Math.PI; // faces the street to the north
    this.scene.add(banner);
    for (const x of [I.cx - 10.5, I.cx + 10.5]) {
      this.metal.box(x - 0.2, CURB, I.z0 - 0.7, x + 0.2, CURB + 9, I.z0 - 0.3, C(0x2a2a2e));
      this.collider(x - 0.3, I.z0 - 0.8, x + 0.3, I.z0 - 0.2, 9);
    }
    this.stuntToken = { x: I.cx, z: I.z0 + 13, y: 3.2 };
    this.label(b, 'Stunt Park', 'S', '#ffc21a');
  }
  buildBeachRamps() {
    const z0 = BEACH_Z + 14, z1 = BEACH_Z + 22;
    for (const x of [-330, -170, 260]) this.ramp(x, z0, x + 14, z1, 'x', 1, 2.6, 0, 0xe8a030);
    for (const x of [-60]) this.ramp(x, z0, x + 14, z1, 'x', -1, 2.6, 0, 0xe8a030);
  }

  // ---------------------------------------------------------------- Lantern Market
  buildMarket(b) {
    const rng = this.rng;
    const I = this.inner(b);
    const awn = [0xc0392b, 0xe67e22, 0xf1c40f, 0x16a085, 0x8e44ad, 0x2980b9];
    // two rows of stalls with an aisle in the middle
    for (const side of [-1, 1]) {
      for (let k = 0; k < 6; k++) {
        const x0 = I.x0 + 2 + k * 9, x1 = x0 + 7;
        const zc = I.cz + side * 9;
        const z0 = zc - 2.5, z1 = zc + 2.5;
        this.plain.box(x0, CURB, z0, x1, CURB + 1.1, z1, C(0x8a5a32), 0, 0); // counter
        for (let g = 0; g < 5; g++) {
          const gx = x0 + 0.6 + g * 1.3;
          this.plain.box(gx, CURB + 1.1, zc - 0.8, gx + 0.9, CURB + 1.4 + rng() * 0.3, zc + 0.8, C(awn[Math.floor(rng() * awn.length)]), 0, 0);
        }
        for (const px of [x0, x1 - 0.15]) for (const pz of [z0, z1 - 0.15]) this.plain.box(px, CURB, pz, px + 0.15, CURB + 3, pz + 0.15, C(0x5a3a22), 0, 0);
        this.plain.box(x0 - 0.5, CURB + 3, z0 - 0.8, x1 + 0.5, CURB + 3.25, z1 + 0.8, C(awn[(k + (side > 0 ? 3 : 0)) % awn.length]), 0, 0);
        this.collider(x0, z0, x1, z1, 3);
      }
    }
    // lantern strings across the aisle
    const pts = [];
    for (let k = 0; k <= 6; k++) {
      const x = I.x0 + 1 + k * 9;
      for (const side of [-1, 1]) {
        const z = I.cz + side * 5.5;
        this.metal.box(x - 0.12, CURB, z - 0.12, x + 0.12, CURB + 5.2, z + 0.12, C(0x6a1a1a));
      }
      // string from north pole to south pole, sagging
      for (let t = 0.1; t < 1; t += 0.16) {
        const z = I.cz - 5.5 + t * 11;
        pts.push([x, CURB + 5 - Math.sin(t * Math.PI) * 0.8, z]);
      }
      // and along the aisle to the next pole
      if (k < 6) {
        for (let t = 0.12; t < 1; t += 0.15) {
          for (const side of [-1, 1]) pts.push([x + t * 9, CURB + 5 - Math.sin(t * Math.PI) * 0.7, I.cz + side * 5.5]);
        }
      }
    }
    const lc = [0xff3b2f, 0xff8a1f, 0xffd21f, 0xff4fa8];
    this.lanternMat = this.lanternMat || new THREE.MeshBasicMaterial({ color: 0xffffff });
    const lan = new THREE.InstancedMesh(new THREE.SphereGeometry(0.28, 8, 6), this.lanternMat, pts.length);
    pts.forEach(([x, y, z], k) => {
      place(lan, k, x, y, z, 0, 1, 1.3, 1);
      lan.setColorAt(k, C(lc[k % lc.length]));
    });
    this.scene.add(lan);
    // entrance arch on the first market block
    if (!this.marketArch) {
      this.marketArch = true;
      const x = I.cx, z = b.z0 + 1.2;
      this.plain.box(x - 7.5, CURB, z - 0.6, x - 6.3, CURB + 7, z + 0.6, C(0xa01a1a), 0, 0);
      this.plain.box(x + 6.3, CURB, z - 0.6, x + 7.5, CURB + 7, z + 0.6, C(0xa01a1a), 0, 0);
      this.plain.box(x - 9, CURB + 7, z - 1, x + 9, CURB + 8, z + 1, C(0x7a1010), 0, 0);
      this.collider(x - 7.5, z - 0.6, x - 6.3, z + 0.6, 7);
      this.collider(x + 6.3, z - 0.6, x + 7.5, z + 0.6, 7);
      const sign = textSign('LANTERN MARKET', 11, 1.4, { bg: '#7a1010', fg: '#ffd27a' });
      sign.position.set(x, CURB + 6.2, z - 0.62);
      sign.rotation.y = Math.PI;
      this.scene.add(sign);
      this.marketToken = { x: I.cx, z: I.cz };
      this.label(b, 'Lantern Market');
    }
  }

  // ---------------------------------------------------------------- gas stations
  buildGasStation(b) {
    const I = this.inner(b);
    const cx = I.cx, cz = I.cz + 4;
    // canopy on pillars, glowing underside
    this.plain.box(cx - 11, CURB + 5, cz - 7, cx + 11, CURB + 6.2, cz + 7, C(0xf4f4f4), 0, 0);
    this.neon.box(cx - 11.1, CURB + 5.4, cz - 7.1, cx + 11.1, CURB + 6, cz - 6.9, C(0x1fa04a));
    this.neon.box(cx - 11.1, CURB + 5.4, cz + 6.9, cx + 11.1, CURB + 6, cz + 7.1, C(0x1fa04a));
    this.canopyLights = this.canopyLights || new THREE.MeshBasicMaterial({ color: 0x777777 });
    const under = new THREE.Mesh(new THREE.PlaneGeometry(21, 13).rotateX(Math.PI / 2), this.canopyLights);
    under.position.set(cx, CURB + 4.98, cz);
    this.scene.add(under);
    for (const [dx, dz] of [[-8, -4], [8, -4], [-8, 4], [8, 4]]) {
      this.metal.box(cx + dx - 0.3, CURB, cz + dz - 0.3, cx + dx + 0.3, CURB + 5, cz + dz + 0.3, C(0xdedede));
      this.collider(cx + dx - 0.35, cz + dz - 0.35, cx + dx + 0.35, cz + dz + 0.35, 5);
    }
    // pumps (destructible!)
    for (const dx of [-4, 4]) {
      for (const dz of [-4, 4]) {
        const x = cx + dx, z = cz + dz;
        this.plain.box(x - 1.6, CURB, z - 0.7, x + 1.6, CURB + 0.2, z + 0.7, C(0xb0b0b0), 0, 0);
        const pump = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.9, 0.6), std(0x1f9a4a, { roughness: 0.4 }));
        body.position.y = 0.95 + 0.2;
        const screen = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.35, 0.62), new THREE.MeshBasicMaterial({ color: 0x9fe8ff }));
        screen.position.y = 1.5;
        pump.add(body, screen);
        pump.position.set(x, CURB, z);
        pump.traverse((o) => { o.castShadow = true; });
        this.scene.add(pump);
        this.destructibles.push({ x, z, y0: CURB, y1: CURB + 2.1, r: 0.55, health: 50, max: 50, mesh: pump, alive: true, respawn: 0 });
        this.collider(x - 0.5, z - 0.35, x + 0.5, z + 0.35, 2);
      }
    }
    // shop + price sign
    this.building('store', I.x0 + 6, I.z0 + 2, I.x1 - 6, I.z0 + 9, CURB + 4.6, 0xffffff, { us: 1 / 24, vs: 1 / 4.6 });
    this.plain.box(I.x0 + 5.5, CURB + 4.6, I.z0 + 1.5, I.x1 - 5.5, CURB + 5.2, I.z0 + 9.5, C(0x1f9a4a), 0, 0);
    const brand = textSign('GOFAST FUEL', 14, 1.6, { bg: '#1f9a4a', fg: '#fff' });
    brand.position.set(I.cx, CURB + 5.9, I.z0 + 9.6);
    this.scene.add(brand);
    const sx = I.x1 - 2, sz = I.z1 - 2;
    this.metal.box(sx - 0.25, CURB, sz - 0.25, sx + 0.25, CURB + 8, sz + 0.25, C(0x3a3a3e));
    const price = textSign('3.99', 3.2, 1.8, { bg: '#111', fg: '#ffcf3a' });
    price.position.set(sx, CURB + 7.5, sz + 0.3);
    this.scene.add(price);
    this.collider(sx - 0.3, sz - 0.3, sx + 0.3, sz + 0.3, 8);
    if (!this.gasToken) this.gasToken = { x: I.x0 + 3, z: I.z0 + 3 };
    this.label(b, 'Gas', 'F', '#1fa04a');
    // a shop clerk you can hold up (spawned when you're nearby)
    this.stores = this.stores || [];
    this.stores.push({ x: I.cx + 4, z: I.z0 + 10.6, clerk: null, cooldown: 0, progress: 0, name: 'GoFast Kiosk' });
    this.plain.box(I.cx + 2.5, CURB, I.z0 + 9.2, I.cx + 5.5, CURB + 1.1, I.z0 + 9.9, C(0x1f9a4a), 0, 0);
    if (b.bi === 7 && b.bj === 7) this.buildPaintShop(b);
  }

  // ---------------------------------------------------------------- paint & body shop
  buildPaintShop(b) {
    const I = this.inner(b);
    const x0 = I.x1 - 17, x1 = I.x1 - 5, z0 = I.z1 - 13, z1 = I.z1 - 1;
    const wall = 0x5a6a7a;
    // three walls + roof, open to the south road
    this.plain.box(x0, CURB, z0, x1, CURB + 5.5, z0 + 0.4, C(wall), 0, 0);
    this.plain.box(x0, CURB, z0, x0 + 0.4, CURB + 5.5, z1, C(wall), 0, 0);
    this.plain.box(x1 - 0.4, CURB, z0, x1, CURB + 5.5, z1, C(wall), 0, 0);
    this.plain.box(x0 - 0.3, CURB + 5.5, z0 - 0.3, x1 + 0.3, CURB + 6.1, z1 + 0.3, C(0x3a4450), 0, 0);
    this.collider(x0, z0, x1, z0 + 0.4, 6, false);
    this.collider(x0, z0, x0 + 0.4, z1, 6, false);
    this.collider(x1 - 0.4, z0, x1, z1, 6, false);
    // striped entrance + lit sign
    for (let k = 0; k < 6; k++) this.neon.box(x0 + 0.4 + k * 1.9, CURB + 5.1, z1 - 0.1, x0 + 1.4 + k * 1.9, CURB + 5.5, z1 + 0.05, C(k % 2 ? 0x111111 : 0xffc21a));
    const sign = textSign('QUICK COAT  PAINT & BODY', 11, 1.2, { bg: '#1a2a6a', fg: '#ffffff' });
    sign.position.set((x0 + x1) / 2, CURB + 6.9, z1 + 0.32);
    this.scene.add(sign);
    this.paintShop = { x0: x0 + 1, z0: z0 + 1, x1: x1 - 1, z1: z1 - 0.5, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, busy: 0 };
    this.labels.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, text: 'Quick Coat', landmark: true, icon: 'Q', blip: '#ff8a3a' });
  }

  // drive in -> fresh paint, repaired, wanted level cleared
  updatePaintShop(dt) {
    const G = this.G, P = this.paintShop;
    if (!P) return;
    const v = G.player.inCar;
    if (P.busy > 0) {
      P.busy -= dt;
      if (P.busy <= 0) {
        G.hud.fade(false);
        G.player.inputLocked = false;
      }
      return;
    }
    if (!v || v.pos.x < P.x0 || v.pos.x > P.x1 || v.pos.z < P.z0 || v.pos.z > P.z1 || Math.abs(v.speed) > 3) return;
    const dirty = G.wanted.stars > 0 || v.health < v.spec.health;
    if (!dirty) {
      G.hud.prompt('Quick Coat: your ride is already looking sharp.');
      return;
    }
    const cost = 250;
    if (G.player.money < cost) {
      G.hud.prompt(`A respray costs ${formatMoney(cost)}. Come back with cash.`);
      return;
    }
    G.player.money -= cost;
    P.busy = 2.2;
    G.player.inputLocked = true;
    v.vel.x = v.vel.z = 0;
    G.hud.fade(true);
    setTimeout(() => {
      const col = new THREE.Color().setHSL(Math.random(), 0.7, 0.45);
      v.bodyMat.color.copy(col);
      v.health = v.spec.health;
      v.burnTimer = -1;
      if (G.wanted.stars > 0) {
        G.wanted.clear();
        G.police.standDown();
        G.hud.big('NEW LOOK', 'Cops lost your trail', 3, '#ffc21a');
      } else G.hud.big('RESPRAYED', formatMoney(cost), 2.5, '#ffc21a');
      G.audio.pickup();
    }, 900);
  }

  // hold-ups: aim a gun at a shop clerk until they hand over the till
  updateStores(dt) {
    const G = this.G, pl = G.player;
    for (const st of this.stores || []) {
      st.cooldown -= dt;
      const d = Math.hypot(pl.pos.x - st.x, pl.pos.z - st.z);
      if (!st.clerk && d < 120 && st.cooldown <= 0) {
        st.clerk = G.peds.spawnAt('clerk', st.x, st.z, 'idle');
        st.clerk.mission = true;
        st.clerk.idleFace = 0;
        st.clerk.heading = 0;
        st.progress = 0;
      }
      const c = st.clerk;
      if (!c) continue;
      if (d > 180 || !c.alive) {
        if (!c.alive) st.cooldown = 120;
        if (d > 180 || c.deadTime > 20) {
          c.mission = false;
          if (d > 180) G.peds.remove(c);
          st.clerk = null;
        }
        continue;
      }
      if (st.robbed) continue;
      const armed = !pl.weapon.melee && !pl.inCar && pl.alive;
      if (armed && pl.aiming && d < 9) {
        // is the crosshair on the clerk?
        const o = G.camera.position, dir = new THREE.Vector3();
        G.camera.getWorldDirection(dir);
        const hit = c.rayHit(o.x, o.y, o.z, dir.x, dir.y, dir.z);
        if (hit) {
          st.progress += dt;
          c.state = 'idle';
          c.model.armL.rotation.x = c.model.armR.rotation.x = -2.9; // hands up!
          if (Math.random() < dt * 2) G.panic(st.x, st.z, 15);
          G.hud.prompt(`Robbing ${st.name}... ${'▮'.repeat(Math.ceil(st.progress * 4))}${'▯'.repeat(Math.max(0, 10 - Math.ceil(st.progress * 4)))}`);
          if (st.progress >= 2.5) {
            st.robbed = true;
            const cash = 300 + Math.floor(Math.random() * 500);
            G.pickups.spawnCash(st.x, st.z + 1.5, cash);
            G.hud.notify(`The clerk dropped the cash: ${formatMoney(cash)}. Grab it and run!`, 4);
            G.wanted.addHeat(0, 2);
            c.panic(pl.pos.x, pl.pos.z, 20, true);
            st.cooldown = 300;
            setTimeout(() => { st.robbed = false; }, 300000);
          }
          continue;
        }
      }
      if (st.progress > 0 && !pl.aiming) st.progress = Math.max(0, st.progress - dt * 0.5);
      if (d < 4 && !st.progress && pl.alive && !pl.inCar && !pl.weapon.melee) G.hud.prompt('Aim your gun at the clerk to rob the till.');
    }
  }

  // ---------------------------------------------------------------- construction site
  buildConstruction(b) {
    const I = this.inner(b);
    const ox = I.x0 + 8, oz = I.z0 + 8;
    const sp = 8, n = 4, floors = 9, fh = 4;
    // steel frame (columns + beams), concrete core
    const beams = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const x = ox + i * sp, z = oz + j * sp;
        beams.push([x, CURB + (floors * fh) / 2, z, 0.5, floors * fh, 0.5]);
        this.collider(x - 0.4, z - 0.4, x + 0.4, z + 0.4, floors * fh);
      }
    }
    for (let f = 1; f <= floors; f++) {
      const y = CURB + f * fh;
      for (let i = 0; i < n; i++) {
        beams.push([ox + ((n - 1) * sp) / 2, y, oz + i * sp, (n - 1) * sp, 0.4, 0.35]);
        beams.push([ox + i * sp, y, oz + ((n - 1) * sp) / 2, 0.35, 0.4, (n - 1) * sp]);
      }
      if (f <= 4) this.plain.box(ox - 0.4, y - 0.25, oz - 0.4, ox + (n - 1) * sp + 0.4, y, oz + (n - 1) * sp + 0.4, C(0x9a9a96), 0, 0); // poured floors
    }
    const bm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), std(0xc0562a, { metalness: 0.5, roughness: 0.5 }), beams.length);
    beams.forEach(([x, y, z, sx, sy, sz], k) => place(bm, k, x, y, z, 0, sx, sy, sz));
    bm.castShadow = true;
    this.scene.add(bm);
    // tower crane with a slowly slewing jib
    const cx = I.x1 - 5, cz = I.z1 - 5;
    this.metal.box(cx - 1, CURB, cz - 1, cx + 1, CURB + 58, cz + 1, C(0xf2c21b));
    this.collider(cx - 1.1, cz - 1.1, cx + 1.1, cz + 1.1, 58);
    const jib = new THREE.Group();
    jib.position.set(cx, CURB + 58, cz);
    const ymat = std(0xf2c21b, { metalness: 0.4 });
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 48), ymat);
    arm.position.z = 14;
    const counter = new THREE.Mesh(new THREE.BoxGeometry(3, 2, 4), std(0x6a6a6a));
    counter.position.set(0, -0.3, -9);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, 2.2), std(0xeeeeee));
    cab.position.set(1.6, -1.6, 0.5);
    const cable = new THREE.Mesh(new THREE.BoxGeometry(0.06, 22, 0.06), std(0x222222));
    cable.position.set(0, -11, 30);
    const hook = new THREE.Mesh(new THREE.BoxGeometry(5, 0.8, 0.8), std(0xc0562a));
    hook.position.set(0, -22, 30);
    jib.add(arm, counter, cab, cable, hook);
    jib.traverse((o) => { o.castShadow = true; });
    this.scene.add(jib);
    this.crane = jib;
    this.blinkers.push(this.beacon(cx, CURB + 59.5, cz));
    // plywood hoarding with a gap for the gate, dirt piles, portable toilets, cones
    const hz = [I.z0, I.z1];
    for (const z of hz) {
      this.plain.box(I.x0, CURB, z - 0.1, I.cx - 4, CURB + 2.4, z + 0.1, C(0xb08a5a), 0, 0);
      this.plain.box(I.cx + 4, CURB, z - 0.1, I.x1, CURB + 2.4, z + 0.1, C(0xb08a5a), 0, 0);
      this.collider(I.x0, z - 0.15, I.cx - 4, z + 0.15, 2.4, false);
      this.collider(I.cx + 4, z - 0.15, I.x1, z + 0.15, 2.4, false);
    }
    for (const x of [I.x0, I.x1]) {
      this.plain.box(x - 0.1, CURB, I.z0, x + 0.1, CURB + 2.4, I.z1, C(0xb08a5a), 0, 0);
      this.collider(x - 0.15, I.z0, x + 0.15, I.z1, 2.4, false);
    }
    const dirt = new THREE.InstancedMesh(new THREE.ConeGeometry(4, 3, 7), std(0x7a5a3a, { flatShading: true }), 3);
    [[I.x0 + 6, I.z1 - 7], [I.x0 + 15, I.z1 - 5], [I.x1 - 14, I.z0 + 5]].forEach(([x, z], k) => place(dirt, k, x, CURB + 1.5, z, k));
    this.scene.add(dirt);
    for (let k = 0; k < 3; k++) {
      const x = I.x1 - 3 - k * 1.6, z = I.z0 + 3;
      this.plain.box(x - 0.6, CURB, z - 0.6, x + 0.6, CURB + 2.3, z + 0.6, C(0x2a7ac0), 0, 0);
    }
    const cones = new THREE.InstancedMesh(new THREE.ConeGeometry(0.25, 0.7, 8), std(0xff6a1a), 10);
    for (let k = 0; k < 10; k++) place(cones, k, I.cx - 4 + k * 0.9, CURB + 0.35, I.z1 + 1.2);
    this.scene.add(cones);
    const sign = textSign('COMING SOON: SKYLINE ONE', 14, 1.4, { bg: '#1a2a4a', fg: '#fff' });
    sign.position.set(I.cx - 14, CURB + 1.6, I.z1 + 0.15);
    this.scene.add(sign);
    this.siteToken = { x: ox + sp * 1.5, z: oz + sp * 1.5 };
    this.label(b, 'Skyline One site');
  }

  // ---------------------------------------------------------------- Apex Tower
  buildApexTower(b) {
    const I = this.inner(b);
    const cx = I.cx, cz = I.cz - 4;
    this.building('glass', cx - 15, cz - 15, cx + 15, cz + 15, 170, 0x9fb8d0);
    this.building('glass', cx - 12, cz - 12, cx + 12, cz + 12, 230, 0x9fb8d0, { y0: 170, noCollide: true });
    this.building('glass', cx - 8, cz - 8, cx + 8, cz + 8, 270, 0xb0c8e0, { y0: 230, noCollide: true });
    // lit crowns between setbacks
    this.neon.box(cx - 15.2, 168, cz - 15.2, cx + 15.2, 170.2, cz + 15.2, C(0x3fd0ff));
    this.neon.box(cx - 12.2, 228, cz - 12.2, cx + 12.2, 230.2, cz + 12.2, C(0x3fd0ff));
    this.metal.box(cx - 0.6, 270, cz - 0.6, cx + 0.6, 310, cz + 0.6, C(0xdddddd));
    this.blinkers.push(this.beacon(cx, 311, cz));
    // podium + plaza fountain
    this.building('store', cx - 18, cz - 18, cx + 18, cz + 18, CURB + 6, 0xffffff, { us: 1 / 24, vs: 1 / 6, noCollide: true });
    const fz = I.z1 - 4.5;
    this.plain.box(cx - 5, CURB, fz - 2.2, cx + 5, CURB + 0.6, fz + 2.2, C(0xbab6ae), 0, 0);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(9.4, 3.8).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3aa0d0, roughness: 0.1, metalness: 0.3, emissive: 0x0a3050 }));
    water.position.set(cx, CURB + 0.55, fz);
    this.scene.add(water);
    this.collider(cx - 5, fz - 2.2, cx + 5, fz + 2.2, 0.7);
    const sign = textSign('APEX TOWER', 14, 2.2, { fg: '#eaf6ff', glow: '#3fd0ff' });
    sign.position.set(cx, CURB + 7.5, cz + 18.1);
    this.scene.add(sign);
    this.towerToken = { x: cx + 7, z: fz };
    this.label(b, 'Apex Tower', '▲', '#9fe8ff');
  }

  // ---------------------------------------------------------------- Lucky Star Hotel
  buildHotel(b) {
    const I = this.inner(b);
    const cx = I.cx, cz = I.cz - 6;
    this.building('glass', cx - 22, cz - 12, cx + 22, cz + 10, 64, 0xd8b8e8);
    this.building('store', cx - 22.4, cz - 12.4, cx + 22.4, cz + 10.4, CURB + 5, 0xffffff, { us: 1 / 24, vs: 1 / 4.85, noCollide: true });
    this.neon.box(cx - 22.3, 30, cz + 10, cx + 22.3, 30.6, cz + 10.4, C(0xff4fd8));
    this.neon.box(cx - 22.3, 63, cz + 10, cx + 22.3, 63.6, cz + 10.4, C(0xff4fd8));
    // entrance canopy with bulbs
    this.plain.box(cx - 8, CURB + 4, cz + 10, cx + 8, CURB + 4.5, cz + 17, C(0xb0902a), 0, 0);
    for (let k = 0; k < 9; k++) this.neon.box(cx - 7.6 + k * 1.9, CURB + 3.85, cz + 16.8, cx - 7.3 + k * 1.9, CURB + 4.05, cz + 17.1, C(0xfff0a0));
    for (const x of [cx - 7.6, cx + 7.3]) {
      this.metal.box(x, CURB, cz + 16.6, x + 0.3, CURB + 4, cz + 16.9, C(0xb0902a));
      this.collider(x, cz + 16.6, x + 0.3, cz + 16.9, 4);
    }
    const name = textSign('LUCKY STAR HOTEL', 30, 4, { fg: '#ffe066', glow: '#ff9a1f' });
    name.position.set(cx, 50, cz + 10.5);
    this.scene.add(name);
    // giant rotating star on the roof (brightness > 1 so it blooms)
    const sh = new THREE.Shape();
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
      const r = k % 2 ? 4 : 9;
      const x = Math.cos(a) * r, y = -Math.sin(a) * r;
      if (k === 0) sh.moveTo(x, y);
      else sh.lineTo(x, y);
    }
    sh.closePath();
    const starGeo = new THREE.ExtrudeGeometry(sh, { depth: 1.2, bevelEnabled: false });
    starGeo.center();
    this.starMat = new THREE.MeshBasicMaterial({ color: 0xffd23f });
    const star = new THREE.Mesh(starGeo, this.starMat);
    star.position.set(cx, 64 + 12, cz - 1);
    this.scene.add(star);
    this.metal.box(cx - 0.4, 64, cz - 1.4, cx + 0.4, 70, cz - 0.6, C(0x8a8a8e));
    this.star = star;
    this.hotelToken = { x: cx, z: cz + 14 };
    this.label(b, 'Lucky Star Hotel', '★', '#ffd23f');
  }

  // ---------------------------------------------------------------- Old Town clock tower
  buildClockTower(b) {
    const I = this.inner(b);
    const cx = I.cx, cz = I.cz;
    // plaza paving pattern + benches
    for (let r = 0; r < 3; r++) this.plain.box(cx - 20 + r * 4, CURB, cz - 20 + r * 4, cx + 20 - r * 4, CURB + 0.02 + r * 0.01, cz + 20 - r * 4, C([0xb0a090, 0xa08a78, 0xc0b0a0][r]), 0, 0);
    this.building('brick', cx - 4, cz - 4, cx + 4, cz + 4, 34, 0xa8583a, { us: 1 / 16, vs: 1 / 16 });
    this.plain.box(cx - 4.6, 34, cz - 4.6, cx + 4.6, 35, cz + 4.6, C(0xe6dccc));
    const roof = new THREE.Mesh(new THREE.ConeGeometry(6.4, 9, 4).rotateY(Math.PI / 4), std(0x2f5a4a, { flatShading: true }));
    roof.position.set(cx, 35 + 4.5, cz);
    roof.castShadow = true;
    this.scene.add(roof);
    // clock faces drawn from the in-game time
    this.clockCanvas = document.createElement('canvas');
    this.clockCanvas.width = this.clockCanvas.height = 128;
    this.clockTex = new THREE.CanvasTexture(this.clockCanvas);
    this.clockTex.colorSpace = THREE.SRGBColorSpace;
    const faceMat = new THREE.MeshStandardMaterial({ map: this.clockTex, emissive: 0xfff2d0, emissiveMap: this.clockTex, emissiveIntensity: 0.2 });
    this.clockMat = faceMat;
    for (let k = 0; k < 4; k++) {
      const face = new THREE.Mesh(new THREE.CircleGeometry(2.6, 32), faceMat);
      const a = (k / 4) * Math.PI * 2;
      face.position.set(cx + Math.sin(a) * 4.02, 29, cz + Math.cos(a) * 4.02);
      face.rotation.y = a;
      this.scene.add(face);
    }
    this.drawClock(12);
    this.clockToken = { x: cx + 7, z: cz + 7 };
    this.label(b, 'Clock Tower');
  }
  drawClock(hour) {
    const c = this.clockCanvas.getContext('2d');
    c.fillStyle = '#f4ecd8';
    c.fillRect(0, 0, 128, 128);
    c.strokeStyle = '#2a2a2a';
    c.lineWidth = 5;
    c.beginPath();
    c.arc(64, 64, 58, 0, Math.PI * 2);
    c.stroke();
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      c.fillStyle = '#2a2a2a';
      c.fillRect(64 + Math.sin(a) * 48 - 2, 64 - Math.cos(a) * 48 - 2, 4, 4);
    }
    const h = hour % 12, m = (hour % 1) * 60;
    const hand = (a, len, w) => {
      c.lineWidth = w;
      c.beginPath();
      c.moveTo(64, 64);
      c.lineTo(64 + Math.sin(a) * len, 64 - Math.cos(a) * len);
      c.stroke();
    };
    hand((h / 12) * Math.PI * 2, 30, 6);
    hand((m / 60) * Math.PI * 2, 46, 4);
    this.clockTex.needsUpdate = true;
  }

  // ---------------------------------------------------------------- Palm Heights pools
  buildPools(b) {
    this.poolMat = this.poolMat || new THREE.MeshStandardMaterial({ color: 0x3fc0e8, roughness: 0.05, metalness: 0.2, emissive: 0x1a8ac0, emissiveIntensity: 0 });
    for (const p of b.pools) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(p.x1 - p.x0, p.z1 - p.z0).rotateX(-Math.PI / 2), this.poolMat);
      w.position.set((p.x0 + p.x1) / 2, CURB + 0.14, (p.z0 + p.z1) / 2);
      this.scene.add(w);
    }
    if (!this.poolToken) this.poolToken = { x: b.pools[0].x0 - 0.5, z: b.pools[0].z0 - 0.5 };
  }

  // ---------------------------------------------------------------- lighthouse + marina + hills
  buildLighthouse() {
    const x = -HALF - 14, z = WATER_Z - 8;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 5.5, 3, 16), std(0x8a8a86));
    base.position.set(x, 1.5, z);
    this.scene.add(base);
    for (let k = 0; k < 5; k++) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(2.8 - k * 0.2, 3 - k * 0.2, 5, 16), std(k % 2 ? 0xc0392b : 0xf4f4f4));
      seg.position.set(x, 3 + 2.5 + k * 5, z);
      seg.castShadow = true;
      this.scene.add(seg);
    }
    const top = 28;
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 2.6, 12), new THREE.MeshStandardMaterial({ color: 0xfff6c0, emissive: 0xfff0a0, emissiveIntensity: 0.3 }));
    lamp.position.set(x, top + 1.3, z);
    this.lampMat = lamp.material;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(2.4, 2.4, 12), std(0x2a2a2a));
    cap.position.set(x, top + 3.8, z);
    this.scene.add(lamp, cap);
    this.collider(x - 5, z - 5, x + 5, z + 5, 30, false);
    // rotating light beams
    const beamGeo = new THREE.ConeGeometry(5, 80, 16, 1, true).translate(0, -40, 0).rotateX(-Math.PI / 2);
    this.beamMat = new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.lhBeam = new THREE.Group();
    this.lhBeam.position.set(x, top + 1.3, z);
    const b1 = new THREE.Mesh(beamGeo, this.beamMat);
    const b2 = new THREE.Mesh(beamGeo, this.beamMat);
    b2.rotation.y = Math.PI;
    this.lhBeam.add(b1, b2);
    this.scene.add(this.lhBeam);
    this.lighthouseToken = { x: x + 8, z: z - 6 };
    this.labels.push({ x, z, text: 'Lighthouse', landmark: true });
  }
  buildMarina() {
    // wooden docks reaching into the water + bobbing boats (decorative)
    const z0 = WATER_Z - 2;
    for (let k = 0; k < 4; k++) {
      const x = 260 + k * 35;
      this.plain.box(x - 1.5, 0.6, z0, x + 1.5, 0.9, z0 + 40, C(0x8a6a4a), 0, 0);
    }
    this.plain.box(250, 0.6, z0 - 1, 380, 0.9, z0 + 2, C(0x8a6a4a), 0, 0);
    this.boats = [];
    const hullMat = std(0xf4f4f4, { roughness: 0.4 });
    const cols = [0x1f5fbf, 0xc0392b, 0x1fa04a, 0x2a2a2a];
    for (let k = 0; k < 7; k++) {
      const g = new THREE.Group();
      const hull = new THREE.Mesh(new THREE.BoxGeometry(3, 1.2, 9), hullMat);
      const bow = new THREE.Mesh(new THREE.ConeGeometry(1.5, 3, 4).rotateX(Math.PI / 2).rotateZ(Math.PI / 4), hullMat);
      bow.scale.set(1, 0.55, 1);
      bow.position.set(0, 0, 6);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(3.05, 0.25, 9), std(cols[k % cols.length]));
      stripe.position.y = 0.2;
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.2, 3), std(0xeeeeee));
      cabin.position.set(0, 1.1, -1);
      g.add(hull, bow, stripe, cabin);
      if (k % 3 === 0) {
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 9, 6), std(0xdddddd));
        mast.position.set(0, 5, 0.5);
        g.add(mast);
      }
      const side = k % 2 ? 1 : -1;
      g.position.set(260 + Math.floor(k / 2) * 35 + side * 4.5, 0.4, z0 + 10 + (k % 3) * 10);
      g.traverse((o) => { o.castShadow = true; });
      this.scene.add(g);
      this.boats.push({ g, ph: Math.random() * 6 });
    }
    this.labels.push({ x: 320, z: z0 + 20, text: 'Marina', landmark: true });
  }
  buildHills() {
    const rng = this.rng;
    const mat = std(0x5a7a42, { flatShading: true, roughness: 1 });
    const rock = std(0x7a7466, { flatShading: true, roughness: 1 });
    for (let k = 0; k < 16; k++) {
      const r = 60 + rng() * 90, h = 50 + rng() * 90;
      const geo = new THREE.ConeGeometry(r, h, 9, 3);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        if (p.getY(i) > h / 2 - 0.1) continue;
        p.setX(i, p.getX(i) * (0.8 + rng() * 0.4));
        p.setZ(i, p.getZ(i) * (0.8 + rng() * 0.4));
        p.setY(i, p.getY(i) + (rng() - 0.5) * 8);
      }
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, k % 4 === 0 ? rock : mat);
      const x = -650 + k * 85 + (rng() - 0.5) * 40;
      m.position.set(x, h / 2 - 6, -HALF - 120 - rng() * 120 - (Math.abs(x) > 400 ? 0 : 0));
      this.scene.add(m);
    }
    // hillside sign
    const sign = textSign('NEON BAY', 150, 26, { fg: '#ffffff', font: '900' });
    sign.position.set(-60, 52, -HALF - 128);
    sign.rotation.x = -0.35;
    this.scene.add(sign);
    this.hillSign = sign;
  }

  // ---------------------------------------------------------------- tokens
  buildTokens() {
    const spots = [
      this.stadiumToken, this.stuntToken, this.marketToken, this.siteToken, this.towerToken, this.clockToken,
      this.lighthouseToken, { x: PIER.x, z: PIER.z1 - 4, y: PIER.deck }, this.yardToken, this.poolToken, this.gasToken, this.hotelToken,
    ].filter(Boolean);
    const geo = new THREE.OctahedronGeometry(0.45);
    this.tokenMat = new THREE.MeshBasicMaterial({ color: 0xff4fd8 });
    spots.forEach((s, i) => {
      const y = (s.y ?? this.world.groundHeight(s.x, s.z)) + 1;
      const m = new THREE.Mesh(geo, this.tokenMat);
      m.position.set(s.x, y, s.z);
      this.scene.add(m);
      this.tokens.push({ id: i, x: s.x, y, z: s.z, mesh: m });
    });
  }
  loadCollected(list) {
    this.collected = new Set(list || []);
    for (const t of this.tokens) t.mesh.visible = !this.collected.has(t.id);
  }

  // ---------------------------------------------------------------- interaction
  // Bullet hits on destructible props. Returns {t, obj} or null.
  rayHit(o, d, maxT) {
    let best = null;
    for (const p of this.destructibles) {
      if (!p.alive) continue;
      const t = rayAABB(o.x, o.y, o.z, d.x, d.y, d.z, p.x - p.r, p.y0, p.z - p.r, p.x + p.r, p.y1, p.z + p.r);
      if (t < maxT && (!best || t < best.t)) best = { t, obj: p };
    }
    return best;
  }
  damageProp(p, n, source) {
    if (!p.alive) return;
    p.health -= n;
    this.G.fx.sparks(p.x, p.y0 + 1.2, p.z, 3);
    if (p.health <= 0) {
      p.alive = false;
      p.mesh.visible = false;
      p.respawn = 90;
      // fuel pumps go up in a fireball that can chain to the next pump
      setTimeout(() => this.G.explosion(p.x, p.y0 + 1, p.z, source), 120);
    }
  }
  damageArea(x, z, R, source) {
    for (const p of this.destructibles) {
      if (!p.alive) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < R + 1.5) this.damageProp(p, 200, source); // reaches the neighbouring pump
    }
  }

  update(dt) {
    const G = this.G;
    this.updatePaintShop(dt);
    this.updateStores(dt);
    const t = G.time, night = G.night;
    const pl = G.player;
    const pp = pl.inCar ? pl.inCar.pos : pl.pos;
    // tokens spin and bob; collect on touch
    for (const tk of this.tokens) {
      if (this.collected.has(tk.id)) continue;
      tk.mesh.rotation.y += dt * 2.5;
      tk.mesh.position.y = tk.y + Math.sin(t * 3 + tk.id) * 0.2;
      if (pl.alive && Math.hypot(pp.x - tk.x, pp.z - tk.z) < (pl.inCar ? 2.6 : 1.4) && Math.abs(pp.y + 1 - tk.y) < 2.5) {
        this.collected.add(tk.id);
        tk.mesh.visible = false;
        pl.money += 250;
        G.audio.passed();
        const n = this.collected.size;
        if (n === this.tokens.length) {
          pl.money += 5000;
          G.hud.big('ALL TOKENS FOUND', formatMoney(5000) + ' bonus', 4, '#ff4fd8');
        } else G.hud.big(`NEON TOKEN ${n}/${this.tokens.length}`, formatMoney(250), 2.5, '#ff4fd8');
        G.save();
      }
    }
    this.tokenMat.color.setHSL(0.86, 1, 0.55).multiplyScalar(1 + night * 2);
    // blinking aircraft beacons
    const on = Math.floor(t * 1.2) % 2 === 0;
    for (const b of this.blinkers) b.material.color.setScalar(0).setRGB(on ? 1 + night * 3 : 0.15, 0, 0);
    // lights that come on at night
    if (this.lanternMat) this.lanternMat.color.setScalar(0.7 + night * 2.2);
    if (this.floodMat) this.floodMat.color.setScalar(0.35 + night * 3.5);
    if (this.pitchMat) this.pitchMat.emissiveIntensity = night * 0.35;
    if (this.canopyLights) this.canopyLights.color.setScalar(0.45 + night * 2);
    if (this.starMat) this.starMat.color.setRGB(1, 0.82, 0.25).multiplyScalar(0.9 + night * 0.6);
    if (this.poolMat) this.poolMat.emissiveIntensity = night * 0.9;
    if (this.clockMat) this.clockMat.emissiveIntensity = 0.1 + night * 0.9;
    if (this.star) this.star.rotation.y += dt * 0.8;
    if (this.crane) this.crane.rotation.y = Math.sin(t * 0.05) * 1.6;
    if (this.lhBeam) {
      this.lhBeam.rotation.y += dt * 0.9;
      this.beamMat.opacity = night * 0.12 + G.weather.rain * 0.05;
      this.lampMat.emissiveIntensity = 0.3 + night * 2.5;
    }
    for (const b of this.boats || []) {
      b.g.position.y = 0.35 + Math.sin(t * 1.3 + b.ph) * 0.18;
      b.g.rotation.z = Math.sin(t * 1.1 + b.ph) * 0.05;
      b.g.rotation.x = Math.sin(t * 0.9 + b.ph) * 0.03;
    }
    // clock hands follow the in-game time
    const minute = Math.floor(G.hour * 60);
    if (this.clockCanvas && minute !== this._minute) {
      this._minute = minute;
      this.drawClock(G.hour);
    }
    // chimney smoke near the player
    for (const s of this.smokers) {
      if (Math.hypot(s.x - pp.x, s.z - pp.z) < 300 && Math.random() < dt * 6) G.fx.smoke(s.x + rand(-0.5, 0.5), s.y, s.z + rand(-0.5, 0.5), 0.55);
    }
    // pumps come back after a while
    for (const p of this.destructibles) {
      if (p.alive) continue;
      p.respawn -= dt;
      if (p.respawn <= 0 && Math.hypot(p.x - pp.x, p.z - pp.z) > 80) {
        p.alive = true;
        p.health = p.max;
        p.mesh.visible = true;
      }
    }
    // district name when you enter a new area
    const name = this.districtAt(pp.x, pp.z);
    if (name !== this.district) {
      if (this.district !== null) G.hud.district(name);
      this.district = name;
    }
  }

  districtAt(x, z) {
    if (Math.abs(x - PIER.x) < PIER.w && z > WATER_Z - 4) return 'The Pier';
    if (z > HALF + 8) return 'Neon Bay Beach';
    const bi = Math.floor((x + HALF) / CELL), bj = Math.floor((z + HALF) / CELL);
    if (bi < 0 || bj < 0 || bi >= N || bj >= N) return 'Outskirts';
    return this.world.getBlock(bi, bj).district;
  }
}

let _corrCache;
function corrugatedTextureCached() {
  return (_corrCache ||= corrugatedTexture());
}
