// City dressing: traffic lights, street furniture, rooftop billboards, palm trees,
// the beach pier with its Ferris wheel, and drifting clouds.
import * as THREE from 'three';
import { N, CELL, HALF, ROAD, CURB, BLOCK, BEACH_Z, WATER_Z, PIER } from './world.js';
import { mulberry32 } from './util.js';

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const sv = new THREE.Vector3();
const pv = new THREE.Vector3();
const eul = new THREE.Euler();
const place = (mesh, k, x, y, z, ry = 0, sx = 1, sy = 1, sz = 1) => {
  m4.compose(pv.set(x, y, z), q.setFromEuler(eul.set(0, ry, 0)), sv.set(sx, sy, sz));
  mesh.setMatrixAt(k, m4);
};
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...o });

// --- traffic light timing -------------------------------------------------
// Each intersection cycles: east-west green, yellow, all-red, north-south green, yellow, all-red.
const CYCLE = 24;
export function lightState(i, j, axis, time) {
  const t = (time + ((i * 7 + j * 3) % 4) * 6) % CYCLE;
  if (axis === 'x') return t < 9 ? 'green' : t < 11.5 ? 'yellow' : 'red';
  return t < 12 ? 'red' : t < 21 ? 'green' : t < 23.5 ? 'yellow' : 'red';
}

// --- billboard ads (all brands are made up for the game) ------------------
const ADS = [
  { bg: ['#ff2d55', '#ff9f0a'], title: 'ZAPP! COLA', sub: 'Taste the voltage', fg: '#fff' },
  { bg: ['#141432', '#5b2bd6'], title: 'NEON BAY 101.5', sub: 'All hits. All night.', fg: '#3ef0ff' },
  { bg: ['#1c1c1c', '#3a3a3a'], title: 'GRIPTIDE TIRES', sub: 'Hold the road', fg: '#ffd21f' },
  { bg: ['#e8f6ff', '#8fd3ff'], title: 'DR. MOLAR', sub: 'Smile like you mean it', fg: '#0a3a6a' },
  { bg: ['#ffe066', '#ffb703'], title: 'BURGER BARN', sub: 'Double stack $4.99', fg: '#7a1a00' },
  { bg: ['#0b3d2e', '#2a9d8f'], title: 'SUNNYSIDE INSURANCE', sub: "We've got you. Mostly.", fg: '#fff' },
  { bg: ['#ff7a00', '#1a1a1a'], title: 'VORTEX GT', sub: 'Drive faster', fg: '#fff' },
  { bg: ['#ffd6e8', '#ff8fb8'], title: 'PAWS & CLAWS', sub: 'Pet spa & grooming', fg: '#6a0f3a' },
];
function makeAdAtlas() {
  const W = 512, H = 256;
  const cv = document.createElement('canvas');
  cv.width = W * 2;
  cv.height = H * 4;
  const c = cv.getContext('2d');
  ADS.forEach((ad, k) => {
    const x = (k % 2) * W, y = Math.floor(k / 2) * H;
    const g = c.createLinearGradient(x, y, x + W, y + H);
    g.addColorStop(0, ad.bg[0]);
    g.addColorStop(1, ad.bg[1]);
    c.fillStyle = g;
    c.fillRect(x, y, W, H);
    // simple decorative shapes
    c.globalAlpha = 0.18;
    c.fillStyle = '#fff';
    for (let i = 0; i < 5; i++) {
      c.beginPath();
      c.arc(x + 60 + i * 110, y + H - 30 - (i % 2) * 40, 40 + i * 6, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
    c.fillStyle = ad.fg;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    let size = 74;
    c.font = `italic 900 ${size}px Impact, 'Arial Black', sans-serif`;
    while (c.measureText(ad.title).width > W - 40 && size > 30) {
      size -= 4;
      c.font = `italic 900 ${size}px Impact, 'Arial Black', sans-serif`;
    }
    c.fillText(ad.title, x + W / 2, y + H * 0.42);
    c.font = `bold 30px 'Trebuchet MS', sans-serif`;
    c.fillText(ad.sub, x + W / 2, y + H * 0.75);
    c.strokeStyle = 'rgba(0,0,0,0.6)';
    c.lineWidth = 10;
    c.strokeRect(x + 5, y + 5, W - 10, H - 10);
  });
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function cloudTexture() {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 128;
  const c = cv.getContext('2d');
  const rng = mulberry32(3);
  for (let i = 0; i < 26; i++) {
    const x = 40 + rng() * 176, y = 50 + rng() * 40, r = 18 + rng() * 30;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Details {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    this.rng = mulberry32(4242);
    this.buildTrafficLights();
    this.buildProps();
    this.buildBillboards();
    this.buildPalms();
    this.buildPier();
    this.buildClouds();
    this.lightT = 0;
  }

  // ---------------------------------------------------------------- lights
  buildTrafficLights() {
    const R = ROAD / 2 + 0.7;
    const heads = [];
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        const x = -HALF + i * CELL, z = -HALF + j * CELL;
        // [poleX, poleZ, facing (heading the light points to), axis, armDirX, armDirZ]
        if (i > 0) heads.push({ i, j, x: x - R, z: z + R, ry: -Math.PI / 2, axis: 'x', ax: 0, az: -1 }); // eastbound
        if (i < N) heads.push({ i, j, x: x + R, z: z - R, ry: Math.PI / 2, axis: 'x', ax: 0, az: 1 }); // westbound
        if (j > 0) heads.push({ i, j, x: x - R, z: z - R, ry: Math.PI, axis: 'z', ax: 1, az: 0 }); // northbound (+z)
        if (j < N) heads.push({ i, j, x: x + R, z: z + R, ry: 0, axis: 'z', ax: -1, az: 0 }); // southbound (-z)
      }
    }
    this.heads = heads;
    const n = heads.length;
    const metal = std(0x2c2f33, { metalness: 0.6, roughness: 0.45 });
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.11, 0.14, 6, 6).translate(0, 3, 0), metal, n);
    const arms = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.12, 4.2).translate(0, 0, 2.1), metal, n);
    const boxes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.45, 1.25, 0.35), std(0x1a1a1a), n);
    this.bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), n * 3);
    heads.forEach((h, k) => {
      place(poles, k, h.x, CURB, h.z);
      // arm points out over the lane the light controls
      const armRy = Math.atan2(h.ax, h.az);
      place(arms, k, h.x, CURB + 5.7, h.z, armRy);
      const hx = h.x + h.ax * 3.4, hz = h.z + h.az * 3.4;
      place(boxes, k, hx, CURB + 5.2, hz, h.ry);
      const fx = Math.sin(h.ry) * 0.19, fz = Math.cos(h.ry) * 0.19;
      for (let b = 0; b < 3; b++) place(this.bulbs, k * 3 + b, hx + fx, CURB + 5.6 - b * 0.38, hz + fz);
    });
    poles.castShadow = arms.castShadow = boxes.castShadow = true;
    this.scene.add(poles, arms, boxes, this.bulbs);
    this.updateLights(0, true);
  }
  updateLights(time, force = false) {
    const col = new THREE.Color();
    const OFF = [0x2a0806, 0x2a2006, 0x062a0e];
    const ON = [0xff2a1a, 0xffc21a, 0x2aff6a];
    let changed = force;
    this.heads.forEach((h, k) => {
      const st = lightState(h.i, h.j, h.axis, time);
      if (!force && h.state === st) return;
      h.state = st;
      changed = true;
      const on = st === 'red' ? 0 : st === 'yellow' ? 1 : 2;
      for (let b = 0; b < 3; b++) this.bulbs.setColorAt(k * 3 + b, col.setHex(b === on ? ON[b] : OFF[b]));
    });
    if (changed) this.bulbs.instanceColor.needsUpdate = true;
  }

  // ---------------------------------------------------------------- props
  buildProps() {
    const rng = this.rng;
    const W = this.world;
    const hyd = [], bins = [], benches = [], stops = [], boxes = [], planters = [];
    for (const b of W.blocks) {
      const sides = [
        { x: (t) => b.x0 + t, z: () => b.z0 + 0.7, ry: 0, out: [0, -1] },
        { x: (t) => b.x0 + t, z: () => b.z1 - 0.7, ry: Math.PI, out: [0, 1] },
        { x: () => b.x0 + 0.7, z: (t) => b.z0 + t, ry: -Math.PI / 2, out: [-1, 0] },
        { x: () => b.x1 - 0.7, z: (t) => b.z0 + t, ry: Math.PI / 2, out: [1, 0] },
      ];
      sides.forEach((sd, si) => {
        const t1 = 14 + rng() * 6;
        hyd.push([sd.x(t1), sd.z(t1)]);
        const t2 = 30 + rng() * 8;
        bins.push([sd.x(t2), sd.z(t2)]);
        if (b.type !== 'residential' && rng() < 0.5) boxes.push([sd.x(t2 + 1.2), sd.z(t2 + 1.2), sd.ry]);
        // benches sit near the buildings, facing the street
        const t3 = 46 + rng() * 6;
        const inset = 3.2;
        const bx = sd.x(t3) - sd.out[0] * (inset - 0.7), bz = sd.z(t3) - sd.out[1] * (inset - 0.7);
        if (b.type === 'park' || rng() < 0.4) benches.push([bx, bz, sd.ry + Math.PI]);
        if (b.type !== 'residential' && b.type !== 'park' && si === (b.bi + b.bj) % 4) {
          const t4 = 24;
          const sx = sd.x(t4) - sd.out[0] * 2.4, sz = sd.z(t4) - sd.out[1] * 2.4;
          stops.push([sx, sz, sd.ry + Math.PI]);
          W.addCollider({ minX: sx - 2, minZ: sz - 2, maxX: sx + 2, maxZ: sz + 2, h: 2.6, small: true, tiny: true });
        }
        if (b.type === 'downtown' && rng() < 0.6) {
          const t5 = 8 + rng() * 4;
          planters.push([sd.x(t5) - sd.out[0] * 2.6, sd.z(t5) - sd.out[1] * 2.6]);
        }
      });
    }
    const inst = (geo, mat, list, y, fn) => {
      const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
      m.count = list.length;
      list.forEach((it, k) => fn(m, k, it, y));
      m.castShadow = true;
      m.receiveShadow = true;
      this.scene.add(m);
      return m;
    };
    // fire hydrants
    const hg = new THREE.CylinderGeometry(0.16, 0.2, 0.7, 8).translate(0, 0.35, 0);
    inst(hg, std(0xc0201a, { roughness: 0.45 }), hyd, CURB, (m, k, [x, z], y) => place(m, k, x, y, z));
    inst(new THREE.SphereGeometry(0.17, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), std(0xc0201a), hyd, CURB + 0.7, (m, k, [x, z], y) => place(m, k, x, y, z));
    // trash bins
    inst(new THREE.CylinderGeometry(0.32, 0.27, 0.95, 10).translate(0, 0.475, 0), std(0x24402c, { roughness: 0.7 }), bins, CURB, (m, k, [x, z], y) => place(m, k, x, y, z));
    inst(new THREE.CylinderGeometry(0.35, 0.35, 0.08, 10), std(0x1a1a1a), bins, CURB + 0.98, (m, k, [x, z], y) => place(m, k, x, y, z));
    // newspaper boxes
    inst(new THREE.BoxGeometry(0.5, 1.0, 0.45).translate(0, 0.5, 0), std(0x1f5fbf, { roughness: 0.5 }), boxes, CURB, (m, k, [x, z, r], y) => place(m, k, x, y, z, r));
    // benches: seat, back and legs as one merged instanced geometry
    const bench = new THREE.BoxGeometry(1.8, 0.08, 0.5).translate(0, 0.45, 0);
    const back = new THREE.BoxGeometry(1.8, 0.45, 0.06).translate(0, 0.75, -0.24);
    inst(bench, std(0x8a5a32, { roughness: 0.8 }), benches, CURB, (m, k, [x, z, r], y) => place(m, k, x, y, z, r));
    inst(back, std(0x8a5a32, { roughness: 0.8 }), benches, CURB, (m, k, [x, z, r], y) => place(m, k, x, y, z, r));
    inst(new THREE.BoxGeometry(1.7, 0.45, 0.45).translate(0, 0.22, 0), std(0x2a2a2a, { metalness: 0.5 }), benches, CURB, (m, k, [x, z, r], y) => place(m, k, x, y, z, r, 1, 1, 0.9));
    // bus stops: roof, glass back panel, posts, bench
    inst(new THREE.BoxGeometry(4, 0.12, 1.8).translate(0, 2.6, 0), std(0x3a3f46, { metalness: 0.5 }), stops, CURB, (m, k, [x, z, r], y) => place(m, k, x, y, z, r));
    inst(new THREE.BoxGeometry(3.8, 2.3, 0.05).translate(0, 1.35, -0.85), new THREE.MeshStandardMaterial({ color: 0x9ec8e0, transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.3 }), stops, CURB, (m, k, [x, z, r], y) => place(m, k, x, y, z, r));
    inst(new THREE.BoxGeometry(0.1, 2.6, 0.1).translate(1.9, 1.3, -0.85), std(0x3a3f46), stops, CURB, (m, k, [x, z, r], y) => place(m, k, x, y, z, r));
    inst(new THREE.BoxGeometry(0.1, 2.6, 0.1).translate(-1.9, 1.3, -0.85), std(0x3a3f46), stops, CURB, (m, k, [x, z, r], y) => place(m, k, x, y, z, r));
    inst(new THREE.BoxGeometry(2.4, 0.08, 0.45).translate(0, 0.48, -0.55), std(0x8a8a8e), stops, CURB, (m, k, [x, z, r], y) => place(m, k, x, y, z, r));
    // lit ad panel on the shelter side (glows at night)
    this.shelterAdMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2e0, emissiveIntensity: 0.2, map: null });
    inst(new THREE.BoxGeometry(0.08, 1.8, 1.3).translate(1.95, 1.3, -0.1), this.shelterAdMat, stops, CURB, (m, k, [x, z, r], y) => place(m, k, x, y, z, r));
    // planters with shrubs downtown
    inst(new THREE.BoxGeometry(1.4, 0.6, 1.4).translate(0, 0.3, 0), std(0x8a8580), planters, CURB, (m, k, [x, z], y) => place(m, k, x, y, z));
    inst(new THREE.IcosahedronGeometry(0.75, 0), std(0x3f7a35, { flatShading: true }), planters, CURB + 1, (m, k, [x, z], y) => place(m, k, x, y, z, k));
  }

  // ---------------------------------------------------------------- billboards
  buildBillboards() {
    const rng = this.rng;
    const atlas = makeAdAtlas();
    const pos = [], uv = [], nor = [];
    const posts = [];
    for (const b of this.world.blocks) {
      for (const r of b.roofs || []) {
        if (r.crown || rng() > 0.4) continue;
        const w = Math.min(14, r.x1 - r.x0 - 2), h = w * 0.42;
        const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
        const ry = [0, Math.PI / 2, Math.PI, -Math.PI / 2][Math.floor(rng() * 4)];
        const ad = Math.floor(rng() * ADS.length);
        const u0 = (ad % 2) * 0.5, v1 = 1 - Math.floor(ad / 2) * 0.25, v0 = v1 - 0.25;
        const y0 = r.h + 3, y1 = y0 + h;
        const fx = Math.sin(ry), fz = Math.cos(ry), rx = Math.cos(ry), rz = -Math.sin(ry);
        const corner = (s, y) => [cx + rx * s * w / 2, y, cz + rz * s * w / 2];
        // front face (faces +f) and a plain back
        const a = corner(-1, y0), bb = corner(1, y0), c = corner(1, y1), d = corner(-1, y1);
        for (const [p, t] of [[a, [u0, v0]], [bb, [u0 + 0.5, v0]], [c, [u0 + 0.5, v1]], [a, [u0, v0]], [c, [u0 + 0.5, v1]], [d, [u0, v1]]]) {
          pos.push(p[0] + fx * 0.1, p[1], p[2] + fz * 0.1);
          uv.push(t[0], t[1]);
          nor.push(fx, 0, fz);
        }
        posts.push([cx + rx * w * 0.3, r.h, cz + rz * w * 0.3, y0, ry], [cx - rx * w * 0.3, r.h, cz - rz * w * 0.3, y0, ry]);
        posts.push([cx, (y0 + y1) / 2, cz, 0, ry, w, h]); // backing board
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    this.adMat = new THREE.MeshStandardMaterial({ map: atlas, emissiveMap: atlas, emissive: 0xffffff, emissiveIntensity: 0.05, roughness: 0.5 });
    this.scene.add(new THREE.Mesh(g, this.adMat));
    const legs = posts.filter((p) => p.length === 5);
    const boards = posts.filter((p) => p.length === 7);
    const metal = std(0x3a3d42, { metalness: 0.6 });
    const legMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 1, 0.3).translate(0, 0.5, 0), metal, Math.max(1, legs.length));
    legs.forEach(([x, y, z, top, ry], k) => place(legMesh, k, x, y, z, ry, 1, top - y, 1));
    const boardMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 0.18), metal, Math.max(1, boards.length));
    boards.forEach(([x, y, z, , ry, w, h], k) => place(boardMesh, k, x, y, z, ry, w + 0.4, h + 0.4, 1));
    legMesh.castShadow = boardMesh.castShadow = true;
    this.scene.add(legMesh, boardMesh);
  }

  // ---------------------------------------------------------------- palms
  buildPalms() {
    const rng = this.rng;
    const pts = [];
    for (let x = -HALF; x <= HALF; x += 18) {
      if (Math.abs(x - PIER.x) < 10) continue;
      pts.push([x + rng() * 6, BEACH_Z + 8 + rng() * 22]);
    }
    // palm-lined boulevard along the southern road
    for (const b of this.world.blocks) {
      if (b.bj === N - 1) for (let t = 6; t < BLOCK; t += 14) pts.push([b.x0 + t, b.z1 - 2.6]);
    }
    // bent trunk geometry
    const trunk = new THREE.CylinderGeometry(0.18, 0.32, 8, 7, 8).translate(0, 4, 0);
    const tp = trunk.attributes.position;
    for (let i = 0; i < tp.count; i++) {
      const y = tp.getY(i);
      tp.setX(i, tp.getX(i) + (y / 8) ** 2 * 1.2);
      // ring texture via slight bulges
      const bulge = 1 + 0.08 * Math.max(0, Math.sin(y * 6));
      tp.setX(i, tp.getX(i) * bulge);
      tp.setZ(i, tp.getZ(i) * bulge);
    }
    trunk.computeVertexNormals();
    // crown: drooping fronds merged into one geometry
    const fronds = [];
    for (let k = 0; k < 8; k++) {
      const f = new THREE.PlaneGeometry(0.9, 4.2, 1, 6).translate(0, 2.1, 0);
      const fp = f.attributes.position;
      for (let i = 0; i < fp.count; i++) {
        const y = fp.getY(i);
        const w = Math.sin((y / 4.2) * Math.PI) + 0.15;
        fp.setX(i, fp.getX(i) * w);
        fp.setZ(i, -((y / 4.2) ** 2) * 2.2); // droop
      }
      f.rotateX(-Math.PI / 2 + 0.4);
      f.rotateY((k / 8) * Math.PI * 2);
      fronds.push(f);
    }
    const crown = mergeGeos(fronds);
    crown.computeVertexNormals();
    const tm = new THREE.InstancedMesh(trunk, std(0x8a6a48, { roughness: 0.95 }), pts.length);
    const cm = new THREE.InstancedMesh(crown, new THREE.MeshStandardMaterial({ color: 0x3f8a3a, roughness: 0.8, side: THREE.DoubleSide }), pts.length);
    pts.forEach(([x, z], k) => {
      const ry = rng() * Math.PI * 2, s = 0.85 + rng() * 0.35;
      const gy = this.world.groundHeight(x, z);
      place(tm, k, x, gy, z, ry, s, s, s);
      // crown sits on the bent trunk tip
      const tipX = 1.2 * s, tipY = 8 * s;
      place(cm, k, x + Math.cos(ry) * tipX, gy + tipY, z - Math.sin(ry) * tipX, ry, s, s, s);
      this.world.addCollider({ minX: x - 0.35, minZ: z - 0.35, maxX: x + 0.35, maxZ: z + 0.35, h: 8, small: true });
    });
    tm.castShadow = cm.castShadow = true;
    this.scene.add(tm, cm);
  }

  // ---------------------------------------------------------------- pier
  buildPier() {
    const { x, w, z0, z1, deck } = PIER;
    const wood = std(0x8a6a4a, { roughness: 0.9 });
    const g = new THREE.Group();
    // ramp + deck
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, 10.4), wood);
    ramp.position.set(x, deck / 2 - 0.1, z0 + 5);
    ramp.rotation.x = -Math.atan2(deck, 10);
    const len = z1 - (z0 + 10);
    const plank = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, len), wood);
    plank.position.set(x, deck - 0.15, z0 + 10 + len / 2);
    g.add(ramp, plank);
    // railings
    for (const sx of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.12, len), std(0xeeeeee));
      rail.position.set(x + sx * (w / 2 - 0.1), deck + 1, z0 + 10 + len / 2);
      g.add(rail);
    }
    const nPost = Math.floor(len / 4);
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.15, 1, 0.15), std(0xeeeeee), nPost * 2);
    const piles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.3, 4, 6), std(0x4a3a2a), nPost * 2);
    for (let k = 0; k < nPost; k++) {
      const pz = z0 + 10 + k * 4 + 2;
      for (const sx of [0, 1]) {
        place(posts, k * 2 + sx, x + (sx ? 1 : -1) * (w / 2 - 0.1), deck + 0.5, pz);
        place(piles, k * 2 + sx, x + (sx ? 1 : -1) * (w / 2 - 0.4), -1.2, pz);
      }
    }
    g.add(posts, piles);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.scene.add(g);

    // Ferris wheel at the end of the pier
    const wheel = new THREE.Group();
    const R = 15, cy = deck + R + 3, cz = z1 - 16;
    wheel.position.set(x, cy, cz);
    const steel = std(0xf2f2f2, { metalness: 0.5, roughness: 0.4 });
    // the wheel faces the shore (its plane is XY)
    for (const sz of [-1.2, 1.2]) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.18, 6, 48), steel);
      rim.position.z = sz;
      wheel.add(rim);
    }
    const spokes = 16;
    for (let k = 0; k < spokes; k++) {
      const a = (k / spokes) * Math.PI * 2;
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.1, R * 2, 0.1), steel);
      sp.rotation.z = a;
      wheel.add(sp);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 3, 12).rotateX(Math.PI / 2), std(0x888888, { metalness: 0.7 }));
    wheel.add(hub);
    // rim light bulbs (glow at night via bloom)
    this.wheelBulbMat = new THREE.MeshBasicMaterial({ color: 0x333333 });
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 6, 4), this.wheelBulbMat, 48);
    for (let k = 0; k < 48; k++) {
      const a = (k / 48) * Math.PI * 2;
      place(bulbs, k, Math.cos(a) * R, Math.sin(a) * R, k % 2 ? 1.25 : -1.25);
    }
    wheel.add(bulbs);
    this.scene.add(wheel);
    this.wheel = wheel;
    // gondolas hang from the rim and stay level
    this.gondolas = [];
    const gcols = [0xff4f6a, 0x3fb0ff, 0xffd23f, 0x5fe06a, 0xc06aff, 0xff9a3f];
    for (let k = 0; k < 12; k++) {
      const gg = new THREE.Group();
      const cab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 1.8), std(gcols[k % gcols.length], { roughness: 0.4 }));
      cab.position.y = -1.3;
      const roof = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.2, 2), steel);
      roof.position.y = -0.4;
      gg.add(cab, roof);
      gg.position.set(x, cy, cz);
      this.scene.add(gg);
      this.gondolas.push({ g: gg, a: (k / 12) * Math.PI * 2 });
    }
    // A-frame legs
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, cy - deck + 1, 0.5), steel);
        leg.position.set(x + sx * 3.2, (cy + deck) / 2, cz + sz * 2.2);
        leg.rotation.z = sx * 0.2;
        leg.castShadow = true;
        this.scene.add(leg);
      }
    }
    for (const sx of [-1, 1]) this.world.addCollider({ minX: x + sx * 4.5 - 0.6, minZ: cz - 3, maxX: x + sx * 4.5 + 0.6, maxZ: cz + 3, h: 6, small: true });
    this.wheelR = R;
    this.world.mapFeatures.push({ x0: x - w / 2, z0, x1: x + w / 2, z1, color: '#8a6a4a' });
    // a couple of food stands on the pier
    const stand = (sz, col) => {
      const s = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(3, 2.2, 2.4), std(0xf4f0e6));
      base.position.y = 1.1;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(2.6, 1.2, 4).rotateY(Math.PI / 4), std(col));
      roof.position.y = 2.8;
      s.add(base, roof);
      s.position.set(x - w / 2 + 2, deck, sz);
      s.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.scene.add(s);
      this.world.addCollider({ minX: x - w / 2 + 0.5, minZ: sz - 1.2, maxX: x - w / 2 + 3.5, maxZ: sz + 1.2, h: 3, small: true });
    };
    stand(WATER_Z + 15, 0xff4f6a);
    stand(WATER_Z + 40, 0x3fb0ff);
  }

  // ---------------------------------------------------------------- clouds
  buildClouds() {
    const tex = cloudTexture();
    this.cloudMat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.85, depthWrite: false, fog: false });
    this.clouds = [];
    const rng = this.rng;
    for (let k = 0; k < 28; k++) {
      const s = new THREE.Sprite(this.cloudMat);
      s.position.set((rng() - 0.5) * 1600, 160 + rng() * 120, (rng() - 0.5) * 1600);
      const sc = 120 + rng() * 160;
      s.scale.set(sc, sc * 0.45, 1);
      this.scene.add(s);
      this.clouds.push(s);
    }
  }

  update(dt, time, night, cloudiness, camPos) {
    this.lightT -= dt;
    if (this.lightT <= 0) {
      this.lightT = 0.2;
      this.updateLights(time);
    }
    // Ferris wheel
    const a0 = time * 0.06;
    this.wheel.rotation.z = a0;
    for (const g of this.gondolas) {
      const a = g.a + a0;
      g.g.position.set(PIER.x + Math.cos(a) * this.wheelR, this.wheel.position.y + Math.sin(a) * this.wheelR, this.wheel.position.z);
    }
    const hue = (time * 0.05) % 1;
    this.wheelBulbMat.color.setHSL(hue, 1, 0.5).multiplyScalar(0.3 + night * 3); // >1 at night so bloom picks it up
    this.adMat.emissiveIntensity = 0.05 + night * 0.85;
    this.shelterAdMat.emissiveIntensity = 0.2 + night * 1.2;
    // clouds drift and wrap around the camera
    const sky = 0.85 * (1 - night * 0.6);
    this.cloudMat.opacity = Math.min(0.95, sky * (0.55 + cloudiness * 0.6));
    const shade = 1 - night * 0.75 - cloudiness * 0.25;
    this.cloudMat.color.setRGB(shade, shade, shade * (1 + night * 0.15));
    for (const c of this.clouds) {
      c.position.x += dt * 4;
      if (c.position.x - camPos.x > 800) c.position.x -= 1600;
      if (c.position.x - camPos.x < -800) c.position.x += 1600;
      if (c.position.z - camPos.z > 800) c.position.z -= 1600;
      if (c.position.z - camPos.z < -800) c.position.z += 1600;
    }
  }
}

// Minimal geometry merge (non-indexed) for the palm crowns.
function mergeGeos(list) {
  const pos = [], nor = [], uv = [];
  for (let g of list) {
    g = g.index ? g.toNonIndexed() : g;
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
    uv.push(...g.attributes.uv.array);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return out;
}
