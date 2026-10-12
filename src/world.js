// Procedural city: road grid, blocks, buildings, parks, beach, lamps, trees,
// plus the collision / query helpers every other system uses.
import * as THREE from 'three';
import { mulberry32, circleVsAABB, rayAABB, clamp } from './util.js';

export const N = 10;            // blocks per side
export const CELL = 80;         // distance between road centre lines
export const ROAD = 16;         // road width
export const BLOCK = CELL - ROAD;
export const HALF = (N * CELL) / 2;
export const LANE = 4;          // lane offset from road centre
export const SIDEWALK = 4;
export const CURB = 0.15;
export const BEACH_Z = HALF + ROAD / 2;
export const WATER_Z = HALF + 52;
export const BOUNDS = { minX: -HALF - 30, maxX: HALF + 30, minZ: -HALF - 30, maxZ: WATER_Z - 2 };

const GRID = 20;

// --- Canvas textures ------------------------------------------------------

function makeWindowTextures() {
  const S = 256, C = 32;
  const col = document.createElement('canvas');
  col.width = col.height = S;
  const em = document.createElement('canvas');
  em.width = em.height = S;
  const c = col.getContext('2d');
  const e = em.getContext('2d');
  c.fillStyle = '#e8e8e8';
  c.fillRect(0, 0, S, S);
  e.fillStyle = '#000';
  e.fillRect(0, 0, S, S);
  const rng = mulberry32(99);
  for (let y = 0; y < S / C; y++) {
    for (let x = 0; x < S / C; x++) {
      const px = x * C, py = y * C;
      // subtle panel noise
      c.fillStyle = `rgba(0,0,0,${rng() * 0.06})`;
      c.fillRect(px, py, C, C);
      c.fillStyle = '#2a3646';
      c.fillRect(px + 8, py + 6, 16, 16);
      c.fillStyle = 'rgba(255,255,255,0.15)';
      c.fillRect(px + 8, py + 6, 16, 4);
      if (rng() < 0.38) {
        const warm = rng() < 0.75;
        e.fillStyle = warm ? '#ffd38a' : '#bfe4ff';
        e.fillRect(px + 8, py + 6, 16, 16);
      }
    }
  }
  const map = new THREE.CanvasTexture(col);
  const emissiveMap = new THREE.CanvasTexture(em);
  for (const t of [map, emissiveMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
  }
  return { map, emissiveMap };
}

function makeRoadTexture() {
  const W = 64, H = 256;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d');
  c.fillStyle = '#3a3a3e';
  c.fillRect(0, 0, W, H);
  const rng = mulberry32(7);
  for (let i = 0; i < 900; i++) {
    const g = 40 + rng() * 30;
    c.fillStyle = `rgba(${g},${g},${g + 4},0.5)`;
    c.fillRect(rng() * W, rng() * H, 1.5, 1.5);
  }
  // edge lines
  c.fillStyle = '#d8d8d8';
  c.fillRect(2, 0, 1.5, H);
  c.fillRect(W - 3.5, 0, 1.5, H);
  // double yellow centre
  c.fillStyle = '#e8b830';
  c.fillRect(W / 2 - 2.5, 14, 1.5, H - 28);
  c.fillRect(W / 2 + 1, 14, 1.5, H - 28);
  // crosswalk stripes at both ends
  c.fillStyle = '#e6e6e6';
  for (let x = 4; x < W - 4; x += 6) {
    c.fillRect(x, 1, 3.5, 10);
    c.fillRect(x, H - 11, 3.5, 10);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// --- Merged geometry builder ---------------------------------------------

class GeoBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
  }
  quad(a, b, c, d, n, uvs, color) {
    // a,b,c,d counter-clockwise when viewed from the normal side
    const verts = [a, b, c, a, c, d];
    const uvv = [uvs[0], uvs[1], uvs[2], uvs[0], uvs[2], uvs[3]];
    for (let i = 0; i < 6; i++) {
      this.pos.push(verts[i][0], verts[i][1], verts[i][2]);
      this.nor.push(n[0], n[1], n[2]);
      this.uv.push(uvv[i][0], uvv[i][1]);
      this.col.push(color.r, color.g, color.b);
    }
  }
  // Box with world-scaled UVs on the sides; top face samples a flat wall texel.
  box(x0, y0, z0, x1, y1, z1, color, us = 1 / 32, vs = 1 / 28, top = true) {
    const h = y1 - y0, w = x1 - x0, d = z1 - z0;
    const ou = (x0 * 0.37 + z0 * 0.21) % 1; // offset so lit windows differ per building
    // +Z face
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1],
      [[ou, 0], [ou + w * us, 0], [ou + w * us, h * vs], [ou, h * vs]], color);
    // -Z face
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1],
      [[ou, 0], [ou + w * us, 0], [ou + w * us, h * vs], [ou, h * vs]], color);
    // +X face
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0],
      [[ou, 0], [ou + d * us, 0], [ou + d * us, h * vs], [ou, h * vs]], color);
    // -X face
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0],
      [[ou, 0], [ou + d * us, 0], [ou + d * us, h * vs], [ou, h * vs]], color);
    if (top) {
      const t = [0.005, 0.005];
      this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [t, t, t, t], color);
    }
  }
  // Flat horizontal quad (y up) with explicit uv rect.
  flat(x0, z0, x1, z1, y, color, u0 = 0, v0 = 0, u1 = 1, v1 = 1) {
    this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0],
      [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], color);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

// --- World ------------------------------------------------------------------

export class World {
  constructor(scene) {
    this.scene = scene;
    this.rng = mulberry32(1337);
    this.colliders = [];
    this.grid = new Map();
    this.stamp = 0;
    this.blocks = [];
    this.landmarks = {};
    this.lampBulbs = null;
    this.mapFeatures = []; // for minimap: {type, x0,z0,x1,z1,color}
    this.build();
  }

  // ---- layout helpers ----
  nodePos(i, j) {
    return { x: -HALF + i * CELL, z: -HALF + j * CELL };
  }
  nearestNode(x, z) {
    const i = clamp(Math.round((x + HALF) / CELL), 0, N);
    const j = clamp(Math.round((z + HALF) / CELL), 0, N);
    return { i, j };
  }
  blockAt(x, z) {
    const bi = Math.floor((x + HALF) / CELL), bj = Math.floor((z + HALF) / CELL);
    if (bi < 0 || bj < 0 || bi >= N || bj >= N) return null;
    const b = this.blocks[bi * N + bj];
    if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) return null;
    return b;
  }
  getBlock(bi, bj) {
    if (bi < 0 || bj < 0 || bi >= N || bj >= N) return null;
    return this.blocks[bi * N + bj];
  }
  isOnRoad(x, z) {
    if (x < -HALF - ROAD / 2 || x > HALF + ROAD / 2 || z < -HALF - ROAD / 2 || z > HALF + ROAD / 2) return false;
    const fx = ((x + HALF) % CELL + CELL) % CELL;
    const fz = ((z + HALF) % CELL + CELL) % CELL;
    const r = ROAD / 2;
    return fx < r || fx > CELL - r || fz < r || fz > CELL - r;
  }
  groundHeight(x, z) {
    return this.blockAt(x, z) ? CURB : 0;
  }

  // ---- collision grid ----
  addCollider(b) {
    b.id = this.colliders.length;
    b.stamp = 0;
    this.colliders.push(b);
    const gx0 = Math.floor(b.minX / GRID), gx1 = Math.floor(b.maxX / GRID);
    const gz0 = Math.floor(b.minZ / GRID), gz1 = Math.floor(b.maxZ / GRID);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gz = gz0; gz <= gz1; gz++) {
        const k = gx * 10007 + gz;
        let cell = this.grid.get(k);
        if (!cell) this.grid.set(k, (cell = []));
        cell.push(b);
      }
    }
  }
  query(minX, minZ, maxX, maxZ, out = []) {
    out.length = 0;
    const s = ++this.stamp;
    const gx0 = Math.floor(minX / GRID), gx1 = Math.floor(maxX / GRID);
    const gz0 = Math.floor(minZ / GRID), gz1 = Math.floor(maxZ / GRID);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gz = gz0; gz <= gz1; gz++) {
        const cell = this.grid.get(gx * 10007 + gz);
        if (!cell) continue;
        for (const b of cell) {
          if (b.stamp !== s) {
            b.stamp = s;
            out.push(b);
          }
        }
      }
    }
    return out;
  }
  // Resolve a circle against static geometry. `p` is mutated (needs x,z).
  // Returns the strongest contact normal or null.
  collideCircle(p, r, y = 0) {
    let contact = null;
    const list = this.query(p.x - r, p.z - r, p.x + r, p.z + r, this._tmp || (this._tmp = []));
    for (let iter = 0; iter < 2; iter++) {
      for (const b of list) {
        if (y > b.h) continue;
        const res = circleVsAABB(p.x, p.z, r, b);
        if (res) {
          p.x += res.nx * res.depth;
          p.z += res.nz * res.depth;
          if (!contact || res.depth > contact.depth) contact = res;
        }
      }
    }
    // world bounds
    if (p.x < BOUNDS.minX + r) { p.x = BOUNDS.minX + r; contact = { nx: 1, nz: 0, depth: 0.1 }; }
    if (p.x > BOUNDS.maxX - r) { p.x = BOUNDS.maxX - r; contact = { nx: -1, nz: 0, depth: 0.1 }; }
    if (p.z < BOUNDS.minZ + r) { p.z = BOUNDS.minZ + r; contact = { nx: 0, nz: 1, depth: 0.1 }; }
    if (p.z > BOUNDS.maxZ - r) { p.z = BOUNDS.maxZ - r; contact = { nx: 0, nz: -1, depth: 0.1 }; }
    return contact;
  }
  // Is the straight line between two points blocked by a building?
  segmentBlocked(ax, az, bx, bz, y = 1.5) {
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return false;
    const list = this.query(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), this._tmp2 || (this._tmp2 = []));
    for (const b of list) {
      if (y > b.h || b.small) continue;
      const t = rayAABB(ax, y, az, dx / len, 0, dz / len, b.minX, 0, b.minZ, b.maxX, b.h, b.maxZ);
      if (t < len) return true;
    }
    return false;
  }
  // 3D ray vs buildings + ground. Returns {t, normal} for the nearest hit.
  raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    let best = maxDist, normal = null;
    if (dy < -1e-6) {
      const tg = -oy / dy;
      if (tg >= 0 && tg < best) {
        best = tg;
        normal = [0, 1, 0];
      }
    }
    const ex = ox + dx * best, ez = oz + dz * best;
    const list = this.query(Math.min(ox, ex), Math.min(oz, ez), Math.max(ox, ex), Math.max(oz, ez), this._tmp3 || (this._tmp3 = []));
    for (const b of list) {
      const t = rayAABB(ox, oy, oz, dx, dy, dz, b.minX, 0, b.minZ, b.maxX, b.h, b.maxZ);
      if (t < best) {
        best = t;
        const hx = ox + dx * t, hy = oy + dy * t, hz = oz + dz * t;
        const e = 0.02;
        if (Math.abs(hx - b.minX) < e) normal = [-1, 0, 0];
        else if (Math.abs(hx - b.maxX) < e) normal = [1, 0, 0];
        else if (Math.abs(hz - b.minZ) < e) normal = [0, 0, -1];
        else if (Math.abs(hz - b.maxZ) < e) normal = [0, 0, 1];
        else if (Math.abs(hy - b.h) < e) normal = [0, 1, 0];
        else normal = [0, 1, 0];
      }
    }
    return { t: best, normal, hit: normal !== null };
  }

  // ---- build ----
  build() {
    const rng = this.rng;
    const scene = this.scene;
    const tex = makeWindowTextures();
    this.buildingMat = new THREE.MeshStandardMaterial({
      map: tex.map,
      emissiveMap: tex.emissiveMap,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0,
      vertexColors: true,
      roughness: 0.75,
      metalness: 0.1,
    });
    const bld = new GeoBuilder();
    const plain = new GeoBuilder(); // sidewalks, roofs, misc untextured
    const neon = new GeoBuilder();
    const grass = new GeoBuilder();
    const roads = new GeoBuilder();
    const inter = new GeoBuilder();
    const C = (hex) => new THREE.Color(hex);

    // Assign block types
    const special = {
      '1,1': 'hospital',
      '8,2': 'police',
      '7,8': 'garage',
      '2,6': 'gunshop',
    };
    for (let bi = 0; bi < N; bi++) {
      for (let bj = 0; bj < N; bj++) {
        const x0 = -HALF + bi * CELL + ROAD / 2;
        const z0 = -HALF + bj * CELL + ROAD / 2;
        const dc = Math.max(Math.abs(bi - 4.5), Math.abs(bj - 4.5));
        let type = dc < 2 ? 'downtown' : dc < 3.5 ? 'commercial' : 'residential';
        if (special[`${bi},${bj}`]) type = special[`${bi},${bj}`];
        else if ((bi === 4 && bj === 4) || (bi === 6 && bj === 1) || (bi === 1 && bj === 8) || rng() < 0.08) type = 'park';
        this.blocks.push({ bi, bj, x0, z0, x1: x0 + BLOCK, z1: z0 + BLOCK, type });
      }
    }

    const sidewalkCol = C(0x9a9a9a);
    const pal = {
      downtown: [0x8fa3b8, 0x6f8094, 0xb9c4cf, 0x9fb3a5, 0x7d8ea6, 0xc8b8a0, 0x5d6b7c],
      commercial: [0xc29a72, 0xa86f5a, 0xd7c09b, 0x9c8c7a, 0xbfa58a, 0x8a9a8f, 0xd0a080],
      residential: [0xf0e0c0, 0xe8c8a8, 0xc8d8e0, 0xf8f0e0, 0xd8c0d0, 0xb8d0b0, 0xf0d0a0],
    };
    const neonCols = [0xff2bd6, 0x2bf0ff, 0xffd02b, 0x7cff4a, 0xff5a2b];
    const trees = [];
    const addBuilding = (x0, z0, x1, z1, h, color, opts = {}) => {
      bld.box(x0, CURB, z0, x1, h, z1, C(color), opts.us, opts.vs, true);
      this.addCollider({ minX: x0, minZ: z0, maxX: x1, maxZ: z1, h });
    };

    for (const b of this.blocks) {
      const { x0, z0, x1, z1, type } = b;
      // sidewalk slab
      plain.box(x0, 0, z0, x1, CURB, z1, sidewalkCol, 0, 0, true);
      const ix0 = x0 + SIDEWALK, iz0 = z0 + SIDEWALK, ix1 = x1 - SIDEWALK, iz1 = z1 - SIDEWALK;
      const featureColor = { downtown: '#59606b', commercial: '#6b625a', residential: '#4b6a45', park: '#3f7a3a' }[type] || '#666';
      this.mapFeatures.push({ x0, z0, x1, z1, color: featureColor });

      if (type === 'park') {
        grass.flat(ix0, iz0, ix1, iz1, CURB + 0.01, C(0x4f8f3f));
        // path cross
        plain.box(ix0, CURB, (iz0 + iz1) / 2 - 1.5, ix1, CURB + 0.03, (iz0 + iz1) / 2 + 1.5, C(0xc8b68e), 0, 0);
        plain.box((ix0 + ix1) / 2 - 1.5, CURB, iz0, (ix0 + ix1) / 2 + 1.5, CURB + 0.03, iz1, C(0xc8b68e), 0, 0);
        // fountain
        const cx = (ix0 + ix1) / 2, cz = (iz0 + iz1) / 2;
        plain.box(cx - 4, CURB, cz - 4, cx + 4, CURB + 0.8, cz + 4, C(0xb0b0b0), 0, 0);
        this.addCollider({ minX: cx - 4, minZ: cz - 4, maxX: cx + 4, maxZ: cz + 4, h: 0.9, small: true });
        b.fountain = { x: cx, z: cz };
        for (let k = 0; k < 22; k++) {
          const tx = ix0 + 3 + rng() * (ix1 - ix0 - 6), tz = iz0 + 3 + rng() * (iz1 - iz0 - 6);
          if (Math.abs(tx - cx) < 4 || Math.abs(tz - cz) < 4) continue;
          trees.push([tx, tz, 0.8 + rng() * 0.6]);
        }
        continue;
      }
      if (type === 'hospital' || type === 'police' || type === 'garage' || type === 'gunshop') {
        plain.flat(ix0, iz0, ix1, iz1, CURB + 0.01, C(0x55585c), 0, 0, 0, 0);
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        if (type === 'hospital') {
          addBuilding(cx - 20, cz - 20, cx + 20, cz + 6, 26, 0xf2f2f2);
          // red cross on the roof and facade
          neon.box(cx - 6, 26, cz - 8.5, cx + 6, 26.3, cz - 5.5, C(0xff2020));
          neon.box(cx - 1.5, 26, cz - 13, cx + 1.5, 26.3, cz - 1, C(0xff2020));
          neon.box(cx - 3, 18, cz + 6, cx + 3, 19, cz + 6.3, C(0xff2020));
          neon.box(cx - 0.5, 16.5, cz + 6, cx + 0.5, 20.5, cz + 6.3, C(0xff2020));
          this.landmarks.hospital = { x: cx, z: z1 + 3, heading: 0, label: 'Hospital' };
        } else if (type === 'police') {
          addBuilding(cx - 22, cz - 22, cx + 22, cz + 4, 14, 0x3d5a8a);
          neon.box(cx - 10, 11, cz + 4, cx + 10, 12, cz + 4.3, C(0x2b6bff));
          this.landmarks.police = { x: cx, z: z1 + 3, heading: 0, label: 'Police Station' };
        } else if (type === 'garage') {
          addBuilding(cx - 20, cz - 22, cx + 20, cz - 4, 8, 0x8a7a6a);
          neon.box(cx - 8, 6, cz - 4, cx + 8, 6.8, cz - 3.7, C(0xffa02b));
          this.landmarks.garage = { x: cx, z: cz + 12, label: 'Lockup Garage' };
        } else {
          addBuilding(cx - 14, cz - 18, cx + 14, cz + 2, 9, 0x6a5a4a);
          neon.box(cx - 7, 6, cz + 2, cx + 7, 7, cz + 2.3, C(0xff3030));
          this.landmarks.gunshop = { x: cx, z: z1 + 3, label: 'Gun Shop' };
        }
        continue;
      }

      const colors = pal[type];
      if (type === 'residential') {
        grass.flat(ix0, iz0, ix1, iz1, CURB + 0.01, C(0x5f9a4a));
        const lots = 3, lw = (ix1 - ix0) / lots, ld = (iz1 - iz0) / lots;
        for (let a = 0; a < lots; a++) {
          for (let c = 0; c < lots; c++) {
            if (a === 1 && c === 1) {
              trees.push([ix0 + lw * 1.5, iz0 + ld * 1.5, 1.2]);
              continue;
            }
            const lx0 = ix0 + a * lw, lz0 = iz0 + c * ld;
            const m = 2.5 + rng() * 1.5;
            const h = 6 + rng() * 6;
            const col = colors[Math.floor(rng() * colors.length)];
            addBuilding(lx0 + m, lz0 + m, lx0 + lw - m, lz0 + ld - m, h, col, { us: 1 / 20, vs: 1 / 24 });
            // roof cap
            const rc = new THREE.Color(rng() < 0.5 ? 0x8a3b2b : 0x4a4a52);
            plain.box(lx0 + m - 0.4, h, lz0 + m - 0.4, lx0 + lw - m + 0.4, h + 0.6, lz0 + ld - m + 0.4, rc);
            plain.box(lx0 + m + 1.5, h + 0.6, lz0 + m + 1.5, lx0 + lw - m - 1.5, h + 1.8, lz0 + ld - m - 1.5, rc);
            if (rng() < 0.6) trees.push([lx0 + 1.6, lz0 + 1.6, 0.7 + rng() * 0.3]);
          }
        }
        continue;
      }

      // downtown / commercial: plaza + 2x2 lots (sometimes one big tower)
      plain.flat(ix0, iz0, ix1, iz1, CURB + 0.01, C(type === 'downtown' ? 0x8a8a8e : 0x7f7a74), 0, 0, 0, 0);
      const big = type === 'downtown' && rng() < 0.3;
      const lots = big ? 1 : 2;
      const lw = (ix1 - ix0) / lots, ld = (iz1 - iz0) / lots;
      for (let a = 0; a < lots; a++) {
        for (let c = 0; c < lots; c++) {
          const lx0 = ix0 + a * lw, lz0 = iz0 + c * ld;
          const m = big ? 6 : 1.5 + rng() * 3;
          const h = type === 'downtown'
            ? (big ? 110 + rng() * 60 : 35 + rng() * 85)
            : 12 + rng() * 28;
          const col = colors[Math.floor(rng() * colors.length)];
          const bx0 = lx0 + m, bz0 = lz0 + m, bx1 = lx0 + lw - m, bz1 = lz0 + ld - m;
          addBuilding(bx0, bz0, bx1, bz1, h, col);
          // setback crown for tall towers
          if (h > 60 && rng() < 0.7) {
            const s = 3 + rng() * 3;
            const h2 = h + 8 + rng() * 25;
            bld.box(bx0 + s, h, bz0 + s, bx1 - s, h2, bz1 - s, C(col));
            plain.box((bx0 + bx1) / 2 - 0.3, h2, (bz0 + bz1) / 2 - 0.3, (bx0 + bx1) / 2 + 0.3, h2 + 12, (bz0 + bz1) / 2 + 0.3, C(0x777777));
            neon.box((bx0 + bx1) / 2 - 0.5, h2 + 12, (bz0 + bz1) / 2 - 0.5, (bx0 + bx1) / 2 + 0.5, h2 + 13, (bz0 + bz1) / 2 + 0.5, C(0xff2020));
          } else {
            plain.box(bx0, h, bz0, bx1, h + 1, bz1, C(0x5a5a5e));
          }
          // neon trim on commercial / some downtown buildings
          if (type === 'commercial' ? rng() < 0.75 : rng() < 0.35) {
            const nc = C(neonCols[Math.floor(rng() * neonCols.length)]);
            const y = 4 + rng() * 2;
            const t = 0.25;
            if (rng() < 0.5) neon.box(bx0 + 2, y, bz1, bx1 - 2, y + 0.8, bz1 + t, nc);
            else neon.box(bx1, y, bz0 + 2, bx1 + t, y + 0.8, bz1 - 2, nc);
            neon.box(bx0, h - 0.6, bz0, bx1, h - 0.2, bz0 - t, nc);
          }
        }
      }
    }

    // ---- roads ----
    const roadTex = makeRoadTexture();
    const white = C(0xffffff);
    const segLen = CELL - ROAD;
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        const { x, z } = this.nodePos(i, j);
        inter.flat(x - ROAD / 2, z - ROAD / 2, x + ROAD / 2, z + ROAD / 2, 0.02, white, 0, 0, 0, 0);
        // segment towards +x (horizontal road along x): texture v along length
        if (i < N) {
          const sx0 = x + ROAD / 2, sx1 = sx0 + segLen;
          // u across width (z), v along length (x) -> custom quad
          roads.quad([sx0, 0.02, z + ROAD / 2], [sx1, 0.02, z + ROAD / 2], [sx1, 0.02, z - ROAD / 2], [sx0, 0.02, z - ROAD / 2], [0, 1, 0],
            [[0, 0], [0, 1], [1, 1], [1, 0]], white);
        }
        if (j < N) {
          const sz0 = z + ROAD / 2, sz1 = sz0 + segLen;
          roads.quad([x - ROAD / 2, 0.02, sz1], [x + ROAD / 2, 0.02, sz1], [x + ROAD / 2, 0.02, sz0], [x - ROAD / 2, 0.02, sz0], [0, 1, 0],
            [[0, 1], [1, 1], [1, 0], [0, 0]], white);
        }
      }
    }

    const addMesh = (geo, mat, shadow = true) => {
      const m = new THREE.Mesh(geo.build(), mat);
      m.receiveShadow = true;
      m.castShadow = shadow;
      scene.add(m);
      return m;
    };
    addMesh(bld, this.buildingMat, true);
    addMesh(plain, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), true);
    this.neonMesh = addMesh(neon, new THREE.MeshBasicMaterial({ vertexColors: true }), false);
    addMesh(grass, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }), false);
    addMesh(roads, new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.95 }), false);
    addMesh(inter, new THREE.MeshStandardMaterial({ color: 0x3a3a3e, roughness: 0.95 }), false);

    // ---- ground, beach, ocean ----
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ color: 0x4d7a3c, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    scene.add(ground);
    const sand = new THREE.Mesh(new THREE.PlaneGeometry(3000, WATER_Z - BEACH_Z + 40), new THREE.MeshStandardMaterial({ color: 0xe2cf9a, roughness: 1 }));
    sand.rotation.x = -Math.PI / 2;
    sand.position.set(0, 0.0, (BEACH_Z + WATER_Z + 40) / 2);
    sand.receiveShadow = true;
    scene.add(sand);
    this.waterMat = new THREE.MeshStandardMaterial({ color: 0x1f6f9a, roughness: 0.15, metalness: 0.4, transparent: true, opacity: 0.92 });
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(3000, 1200, 60, 30), this.waterMat);
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.set(0, 0.08, WATER_Z + 600);
    scene.add(this.water);
    this.mapFeatures.push({ x0: -HALF - 60, z0: BEACH_Z, x1: HALF + 60, z1: WATER_Z, color: '#cdb87f' });
    this.mapFeatures.push({ x0: -HALF - 60, z0: WATER_Z, x1: HALF + 60, z1: WATER_Z + 200, color: '#1f5f88' });

    // Palms on the beach
    for (let x = -HALF; x <= HALF; x += 22) {
      trees.push([x + rng() * 8, BEACH_Z + 10 + rng() * 25, 1, true]);
    }
    // Perimeter treeline
    for (let t = -HALF - 20; t <= HALF + 20; t += 9) {
      trees.push([t, -HALF - 20 - rng() * 6, 1.3]);
      trees.push([-HALF - 20 - rng() * 6, t, 1.3]);
      trees.push([HALF + 20 + rng() * 6, t, 1.3]);
    }

    // ---- trees (instanced) ----
    const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 1, 6);
    trunkGeo.translate(0, 0.5, 0);
    const leafGeo = new THREE.IcosahedronGeometry(1, 0);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x6b4a2f }), trees.length);
    const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshStandardMaterial({ color: 0x3f7f35, flatShading: true }), trees.length);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    trees.forEach(([x, z, sc, palm], k) => {
      const gy = this.groundHeight(x, z);
      const th = palm ? 7 : 3 * sc;
      m4.compose(p.set(x, gy, z), q.identity(), s.set(sc, th, sc));
      trunks.setMatrixAt(k, m4);
      if (palm) {
        m4.compose(p.set(x, gy + th, z), q.identity(), s.set(1, 0.6, 1));
        leaves.setColorAt(k, new THREE.Color(0x4c8f3a));
      } else {
        m4.compose(p.set(x, gy + th + 1.2 * sc, z), q.setFromEuler(new THREE.Euler(rng(), rng(), rng())), s.set(2 * sc, 1.8 * sc, 2 * sc));
        leaves.setColorAt(k, new THREE.Color().setHSL(0.25 + rng() * 0.08, 0.45, 0.28 + rng() * 0.1));
      }
      leaves.setMatrixAt(k, m4);
      this.addCollider({ minX: x - 0.4, minZ: z - 0.4, maxX: x + 0.4, maxZ: z + 0.4, h: 8, small: true });
    });
    trunks.castShadow = leaves.castShadow = true;
    scene.add(trunks, leaves);

    // ---- street lamps (instanced) ----
    const lampPts = [];
    for (const b of this.blocks) {
      for (let t = 8; t < BLOCK - 4; t += 20) {
        lampPts.push([b.x0 + t, b.z0 + 0.8, 0]);
        lampPts.push([b.x0 + t, b.z1 - 0.8, Math.PI]);
        lampPts.push([b.x0 + 0.8, b.z0 + t, Math.PI / 2]);
        lampPts.push([b.x1 - 0.8, b.z0 + t, -Math.PI / 2]);
      }
    }
    const poleGeo = new THREE.CylinderGeometry(0.08, 0.12, 6, 5);
    poleGeo.translate(0, 3, 0);
    const bulbGeo = new THREE.BoxGeometry(0.5, 0.18, 0.9);
    const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0x333338, metalness: 0.6, roughness: 0.4 }), lampPts.length);
    this.lampMat = new THREE.MeshStandardMaterial({ color: 0x777777, emissive: 0xffe6a8, emissiveIntensity: 0 });
    const bulbs = new THREE.InstancedMesh(bulbGeo, this.lampMat, lampPts.length);
    lampPts.forEach(([x, z, r], k) => {
      m4.compose(p.set(x, CURB, z), q.setFromEuler(new THREE.Euler(0, r, 0)), s.set(1, 1, 1));
      poles.setMatrixAt(k, m4);
      // bulb sticks out over the road
      const ox = r === 0 ? 0 : r === Math.PI ? 0 : r > 0 ? -0.9 : 0.9;
      const oz = r === 0 ? -0.9 : r === Math.PI ? 0.9 : 0;
      m4.compose(p.set(x + ox, CURB + 6, z + oz), q.setFromEuler(new THREE.Euler(0, r, 0)), s.set(1, 1, 1));
      bulbs.setMatrixAt(k, m4);
    });
    poles.castShadow = true;
    scene.add(poles, bulbs);

    // ---- road graph segments for traffic spawning ----
    this.segments = [];
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        if (i < N) this.segments.push({ a: { i, j }, b: { i: i + 1, j } });
        if (j < N) this.segments.push({ a: { i, j }, b: { i, j: j + 1 } });
      }
    }

    // ---- parking spots (along curbs) for parked cars ----
    this.parkingSpots = [];
    for (const b of this.blocks) {
      if (rng() < 0.55) {
        const side = Math.floor(rng() * 4);
        const t = 12 + rng() * (BLOCK - 24);
        let x, z, h;
        if (side === 0) { x = b.x0 + t; z = b.z0 - 1.6; h = Math.PI / 2; }
        else if (side === 1) { x = b.x0 + t; z = b.z1 + 1.6; h = -Math.PI / 2; }
        else if (side === 2) { x = b.x0 - 1.6; z = b.z0 + t; h = Math.PI; }
        else { x = b.x1 + 1.6; z = b.z0 + t; h = 0; }
        this.parkingSpots.push({ x, z, h });
      }
    }
  }

  // Day/night dependent visuals
  setNight(f) {
    this.buildingMat.emissiveIntensity = f * 1.1;
    this.lampMat.emissiveIntensity = f * 2.5;
  }
  update(dt, t) {
    // gentle water bob via material colour shift
    const k = 0.5 + 0.5 * Math.sin(t * 0.6);
    this.waterMat.color.setRGB(0.1 + k * 0.03, 0.42 + k * 0.04, 0.6 + k * 0.05);
  }

  // Random point on a sidewalk loop near (x,z)
  randomSidewalkNear(x, z, minD, maxD) {
    for (let tries = 0; tries < 30; tries++) {
      const a = Math.random() * Math.PI * 2;
      const d = minD + Math.random() * (maxD - minD);
      const px = x + Math.sin(a) * d, pz = z + Math.cos(a) * d;
      const bi = Math.floor((px + HALF) / CELL), bj = Math.floor((pz + HALF) / CELL);
      const b = this.getBlock(bi, bj);
      if (!b) continue;
      const loop = sidewalkLoop(b);
      const t = Math.random() * loop.len;
      const pt = loopPoint(loop, t);
      return { block: b, t, x: pt.x, z: pt.z };
    }
    return null;
  }

  // Pre-render the full city map to a canvas (used by minimap + pause map).
  renderMapCanvas(px = 1024) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = px;
    const c = cv.getContext('2d');
    const ext = HALF + 80;
    const sc = px / (ext * 2);
    const tx = (x) => (x + ext) * sc, tz = (z) => (z + ext) * sc;
    c.fillStyle = '#3e5f33';
    c.fillRect(0, 0, px, px);
    for (const f of this.mapFeatures) {
      c.fillStyle = f.color;
      c.fillRect(tx(f.x0), tz(f.z0), (f.x1 - f.x0) * sc, (f.z1 - f.z0) * sc);
    }
    c.fillStyle = '#2a2a2e';
    for (let i = 0; i <= N; i++) {
      const p = -HALF + i * CELL;
      c.fillRect(tx(p - ROAD / 2), tz(-HALF - ROAD / 2), ROAD * sc, (HALF * 2 + ROAD) * sc);
      c.fillRect(tx(-HALF - ROAD / 2), tz(p - ROAD / 2), (HALF * 2 + ROAD) * sc, ROAD * sc);
    }
    c.fillStyle = 'rgba(0,0,0,0.25)';
    for (const b of this.colliders) {
      if (b.small) continue;
      c.fillRect(tx(b.minX), tz(b.minZ), (b.maxX - b.minX) * sc, (b.maxZ - b.minZ) * sc);
    }
    return { canvas: cv, ext, scale: sc };
  }
}

// Sidewalk walking loop for a block (a rectangle inset from the block edge).
export function sidewalkLoop(b) {
  const inset = 1.8;
  const x0 = b.x0 + inset, z0 = b.z0 + inset, x1 = b.x1 - inset, z1 = b.z1 - inset;
  const w = x1 - x0, h = z1 - z0;
  return { x0, z0, x1, z1, w, h, len: 2 * (w + h), corners: [0, w, w + h, 2 * w + h] };
}
export function loopPoint(L, t) {
  t = ((t % L.len) + L.len) % L.len;
  if (t < L.w) return { x: L.x0 + t, z: L.z0, dx: 1, dz: 0 };
  t -= L.w;
  if (t < L.h) return { x: L.x1, z: L.z0 + t, dx: 0, dz: 1 };
  t -= L.h;
  if (t < L.w) return { x: L.x1 - t, z: L.z1, dx: -1, dz: 0 };
  t -= L.w;
  return { x: L.x0, z: L.z1 - t, dx: 0, dz: -1 };
}
