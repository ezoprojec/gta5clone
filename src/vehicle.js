// Vehicles: procedural models + arcade driving physics + damage.
import * as THREE from 'three';
import { clamp, pick, circleVsAABB, wrapAngle } from './util.js';
import { makeCharacter, poseSeated, randomLook } from './character.js';

export const TYPES = {
  sedan: { name: 'Meridian', len: 4.5, wid: 1.9, body: 0.55, cabinH: 0.5, cabinLen: 0.5, maxSpeed: 36, accel: 13, mass: 1.2, health: 900,
    colors: [0x9a1c1c, 0x1c3f9a, 0xdedede, 0x2a2a2a, 0x6a6a72, 0x1c6a3a, 0x8a6a3a] },
  sports: { name: 'Vortex GT', len: 4.3, wid: 1.95, body: 0.45, cabinH: 0.42, cabinLen: 0.4, maxSpeed: 56, accel: 23, mass: 1.0, health: 750,
    colors: [0xff3b1f, 0xffd21f, 0x1fa0ff, 0x101010, 0xff1fae, 0x3bff6a] },
  muscle: { name: 'Stallion', len: 4.8, wid: 2.0, body: 0.6, cabinH: 0.45, cabinLen: 0.42, maxSpeed: 47, accel: 19, mass: 1.4, health: 1000,
    colors: [0x202020, 0x7a0f0f, 0x0f3a7a, 0xd0a020, 0xeeeeee] },
  van: { name: 'Packhorse', len: 5.4, wid: 2.15, body: 0.8, cabinH: 0.75, cabinLen: 0.78, maxSpeed: 29, accel: 9, mass: 2.0, health: 1300,
    colors: [0xf0f0f0, 0x3a5a8a, 0x8a3a3a, 0x5a7a4a] },
  taxi: { name: 'Cabbie', len: 4.6, wid: 1.9, body: 0.55, cabinH: 0.5, cabinLen: 0.5, maxSpeed: 37, accel: 13, mass: 1.2, health: 900,
    colors: [0xf2c21b] },
  police: { name: 'Interceptor', len: 4.7, wid: 1.95, body: 0.55, cabinH: 0.5, cabinLen: 0.48, maxSpeed: 50, accel: 20, mass: 1.5, health: 1200,
    colors: [0x111111] },
};
const TRAFFIC_TYPES = ['sedan', 'sedan', 'sedan', 'taxi', 'van', 'muscle', 'sports'];
export const randomTrafficType = () => pick(TRAFFIC_TYPES);

const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 12).rotateZ(Math.PI / 2);
const hubGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.3, 6).rotateZ(Math.PI / 2);
const tireMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
const hubMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.8, roughness: 0.3 });
const glassMat = new THREE.MeshStandardMaterial({ color: 0x1a2430, metalness: 0.6, roughness: 0.1 });
const trimMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7 });
const burntMat = new THREE.MeshStandardMaterial({ color: 0x1b1715, roughness: 1 });
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

let nextId = 1;

export class Vehicle {
  constructor(typeKey, color) {
    this.id = nextId++;
    this.typeKey = typeKey;
    this.spec = TYPES[typeKey];
    this.color = color ?? pick(this.spec.colors);
    this.pos = new THREE.Vector3();
    this.heading = 0;
    this.vel = { x: 0, z: 0 };
    this.speed = 0;  // forward speed (signed)
    this.steer = 0;
    this.input = { throttle: 0, steer: 0, handbrake: false };
    this.health = this.spec.health;
    this.alive = true;
    this.burnTimer = -1;
    this.driver = null;   // 'player' | AI controller | null
    this.isPolice = typeKey === 'police';
    this.siren = false;
    this.wheelSpin = 0;
    this.lastHitBy = null;
    this.buildModel();
  }

  buildModel() {
    const s = this.spec;
    const root = new THREE.Group();
    this.bodyMat = new THREE.MeshStandardMaterial({ color: this.color, metalness: 0.5, roughness: 0.35 });
    const add = (geo, m, x, y, z, parent = root, shadow = true) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = shadow;
      parent.add(mesh);
      return mesh;
    };
    const L = s.len, W = s.wid;
    const by = 0.38 + s.body / 2;
    add(box(W, s.body, L), this.bodyMat, 0, by, 0);
    // cabin
    const cl = L * s.cabinLen;
    const cz = this.typeKey === 'van' ? -L * 0.08 : -L * 0.06;
    const cy = 0.38 + s.body + s.cabinH / 2;
    add(box(W * 0.86, s.cabinH, cl), glassMat, 0, cy, cz);
    add(box(W * 0.88, 0.06, cl * 0.92), this.bodyMat, 0, cy + s.cabinH / 2, cz);
    // pillars
    add(box(W * 0.9, s.cabinH, 0.1), this.bodyMat, 0, cy, cz - cl / 2 + 0.05);
    // bumpers
    add(box(W * 0.98, 0.22, 0.18), trimMat, 0, 0.45, L / 2 + 0.03);
    add(box(W * 0.98, 0.22, 0.18), trimMat, 0, 0.45, -L / 2 - 0.03);
    // lights
    this.headMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, emissive: 0xfff4d0, emissiveIntensity: 0.3 });
    this.tailMat = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1010, emissiveIntensity: 0.4 });
    for (const sx of [-1, 1]) {
      add(box(0.42, 0.16, 0.06), this.headMat, sx * (W / 2 - 0.3), by + 0.05, L / 2 + 0.01, root, false);
      add(box(0.36, 0.14, 0.06), this.tailMat, sx * (W / 2 - 0.25), by + 0.08, -L / 2 - 0.01, root, false);
    }
    if (this.typeKey === 'taxi') {
      const sign = add(box(0.7, 0.22, 0.3), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe060, emissiveIntensity: 0.6 }), 0, cy + s.cabinH / 2 + 0.14, cz);
      sign.castShadow = false;
      add(box(W * 1.002, 0.12, L * 0.5), trimMat, 0, by, 0, root, false);
    }
    if (this.typeKey === 'sports') {
      add(box(W * 0.9, 0.06, 0.4), this.bodyMat, 0, by + s.body / 2 + 0.25, -L / 2 + 0.25);
      add(box(0.08, 0.25, 0.08), trimMat, -0.6, by + s.body / 2 + 0.1, -L / 2 + 0.25);
      add(box(0.08, 0.25, 0.08), trimMat, 0.6, by + s.body / 2 + 0.1, -L / 2 + 0.25);
    }
    if (this.typeKey === 'muscle') {
      add(box(0.5, 0.12, 1.0), trimMat, 0, by + s.body / 2 + 0.06, L * 0.3);
      add(box(0.25, s.body * 1.01, L * 1.001), new THREE.MeshStandardMaterial({ color: 0xeeeeee }), 0, by, 0, root, false);
    }
    if (this.isPolice) {
      const doorMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, metalness: 0.4, roughness: 0.4 });
      add(box(W * 1.004, s.body * 0.7, L * 0.42), doorMat, 0, by + 0.04, -0.1, root, false);
      this.lightRed = new THREE.MeshStandardMaterial({ color: 0x440000, emissive: 0xff0000, emissiveIntensity: 0 });
      this.lightBlue = new THREE.MeshStandardMaterial({ color: 0x000044, emissive: 0x2050ff, emissiveIntensity: 0 });
      add(box(0.6, 0.14, 0.26), this.lightRed, -0.33, cy + s.cabinH / 2 + 0.1, cz, root, false);
      add(box(0.6, 0.14, 0.26), this.lightBlue, 0.33, cy + s.cabinH / 2 + 0.1, cz, root, false);
    }
    // wheels
    this.wheels = [];
    const wx = W / 2 - 0.12, wz = L / 2 - 0.85;
    for (const [x, z, front] of [[-wx, wz, true], [wx, wz, true], [-wx, -wz, false], [wx, -wz, false]]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.36, z);
      root.add(pivot);
      const spin = new THREE.Group();
      pivot.add(spin);
      const t = new THREE.Mesh(wheelGeo, tireMat);
      t.castShadow = true;
      spin.add(t, new THREE.Mesh(hubGeo, hubMat));
      this.wheels.push({ pivot, spin, front });
    }
    this.cabinZ = cz;
    this.root = root;
    this.radius = W / 2;
  }

  // Seated driver model is created lazily (parked cars never need one).
  setOccupied(visibleDriver) {
    if (visibleDriver && !this.driverModel) {
      this.driverModel = makeCharacter(this.isPolice
        ? { skin: pick([0xf1c27d, 0xc68642, 0x8d5524, 0xe0ac69]), shirt: 0x1f2f5a, pants: 0x1a1a2a, hair: 0x1a1a1a, cap: 0x1a2440 }
        : randomLook());
      poseSeated(this.driverModel);
      this.driverModel.root.position.set(0.4, 0.05, this.cabinZ + 0.1);
      this.driverModel.root.scale.setScalar(0.92);
      this.driverModel.root.traverse((o) => { o.castShadow = false; });
      this.root.add(this.driverModel.root);
    }
    if (this.driverModel) this.driverModel.root.visible = visibleDriver;
  }

  place(x, z, heading) {
    this.pos.set(x, 0, z);
    this.heading = heading;
    this.vel.x = this.vel.z = 0;
    this.syncMesh();
  }

  syncMesh() {
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.heading;
  }

  // Front/rear collision circles in world space.
  circles() {
    const off = this.spec.len / 2 - this.spec.wid / 2;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    return [
      { x: this.pos.x + fx * off, z: this.pos.z + fz * off, r: this.radius },
      { x: this.pos.x - fx * off, z: this.pos.z - fz * off, r: this.radius },
    ];
  }

  get forward() {
    return { x: Math.sin(this.heading), z: Math.cos(this.heading) };
  }

  damage(amount, G, source) {
    if (!this.alive) return;
    this.health -= amount;
    if (source) this.lastHitBy = source;
    if (this.health <= 0 && this.burnTimer < 0) {
      this.burnTimer = 4.5;
    }
  }

  update(dt, G) {
    const s = this.spec;
    const inp = this.alive ? this.input : { throttle: 0, steer: 0, handbrake: true };
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const rx = -fz, rz = fx;
    let vf = this.vel.x * fx + this.vel.z * fz;
    let vl = this.vel.x * rx + this.vel.z * rz;

    // engine & brakes
    const maxSpeed = s.maxSpeed * (this.health < s.health * 0.25 ? 0.6 : 1);
    if (inp.throttle > 0) {
      if (vf < -0.5) vf += 30 * dt * inp.throttle;
      else vf += s.accel * inp.throttle * (1 - clamp(vf / maxSpeed, 0, 1) ** 2) * dt;
    } else if (inp.throttle < 0) {
      if (vf > 0.5) vf += 30 * dt * inp.throttle;
      else vf += s.accel * 0.6 * inp.throttle * (1 - clamp(-vf / 14, 0, 1)) * dt;
    } else {
      const roll = 3 * dt;
      vf = Math.abs(vf) < roll ? 0 : vf - Math.sign(vf) * roll;
    }
    vf -= vf * 0.04 * dt;
    if (inp.handbrake) {
      const hb = 14 * dt;
      vf = Math.abs(vf) < hb ? 0 : vf - Math.sign(vf) * hb;
    }
    // lateral grip (low grip while handbraking => drifts)
    const grip = inp.handbrake ? 1.4 : 7.5;
    vl *= Math.exp(-grip * dt);

    // steering (bicycle model)
    this.steer += (inp.steer - this.steer) * Math.min(1, dt * 7);
    const speedFactor = 1 - 0.55 * clamp(Math.abs(vf) / s.maxSpeed, 0, 1);
    const delta = this.steer * 0.6 * speedFactor;
    const wheelbase = s.len * 0.6;
    let yaw = (vf / wheelbase) * Math.tan(delta);
    if (inp.handbrake) yaw *= 1.5;
    this.heading = wrapAngle(this.heading + yaw * dt);

    // keep velocity in world frame (heading change creates slip naturally)
    this.vel.x = fx * vf + rx * vl;
    this.vel.z = fz * vf + rz * vl;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.speed = vf;

    // static collisions using front/rear circles
    for (const c of this.circles()) {
      const before = { x: c.x, z: c.z };
      const hit = G.world.collideCircle(c, c.r, 0.5);
      if (hit) {
        this.pos.x += c.x - before.x;
        this.pos.z += c.z - before.z;
        const vn = this.vel.x * hit.nx + this.vel.z * hit.nz;
        if (vn < 0) {
          this.vel.x -= hit.nx * vn * 1.35;
          this.vel.z -= hit.nz * vn * 1.35;
          this.vel.x *= 0.8;
          this.vel.z *= 0.8;
          const impact = -vn;
          if (impact > 6) {
            this.damage(impact * impact * 0.5, G);
            G.fx.sparks(c.x - hit.nx * c.r, 0.6, c.z - hit.nz * c.r, 6);
            if (this.driver === 'player') G.audio.crash(Math.min(1, impact / 25));
            if (this.driver === 'player') G.camShake = Math.min(1, impact / 30);
          }
        }
      }
    }

    // ground height (curbs)
    const gy = G.world.groundHeight(this.pos.x, this.pos.z);
    this.pos.y += (gy - this.pos.y) * Math.min(1, dt * 12);

    // wheels
    this.wheelSpin += (vf / 0.36) * dt;
    for (const w of this.wheels) {
      w.spin.rotation.x = this.wheelSpin;
      if (w.front) w.pivot.rotation.y = this.steer * 0.5;
    }

    // body roll for feel
    this.root.rotation.z = clamp(-vl * 0.015 - yaw * vf * 0.004, -0.12, 0.12);
    this.syncMesh();
    this.root.rotation.y = this.heading;

    // lights
    const night = G.night;
    this.headMat.emissiveIntensity = 0.3 + night * 2.2;
    this.tailMat.emissiveIntensity = (inp.throttle < 0 && vf > 0.5) || inp.handbrake ? 2.2 : 0.3 + night * 0.8;
    if (this.isPolice) {
      const on = this.siren && this.alive;
      const ph = Math.floor(G.time * 6) % 2;
      this.lightRed.emissiveIntensity = on && ph ? 3 : 0;
      this.lightBlue.emissiveIntensity = on && !ph ? 3 : 0;
    }

    // damage effects
    if (this.alive) {
      if (this.health < s.health * 0.35 && Math.random() < dt * 8) {
        const f = this.forward;
        G.fx.smoke(this.pos.x + f.x * s.len * 0.4, 1.1, this.pos.z + f.z * s.len * 0.4, this.health < s.health * 0.15 ? 0.15 : 0.6);
      }
      if (this.burnTimer >= 0) {
        this.burnTimer -= dt;
        if (Math.random() < dt * 25) {
          const f = this.forward;
          G.fx.fire(this.pos.x + f.x * s.len * 0.35, 1.2, this.pos.z + f.z * s.len * 0.35);
        }
        if (this.burnTimer <= 0) this.explode(G);
      }
    }
  }

  explode(G) {
    this.alive = false;
    this.health = 0;
    this.siren = false;
    this.root.traverse((o) => {
      if (o.isMesh && o.material !== tireMat) o.material = burntMat;
    });
    if (this.driverModel) this.driverModel.root.visible = false;
    this.vel.x *= 0.3;
    this.vel.z *= 0.3;
    G.explosion(this.pos.x, 1, this.pos.z, this.lastHitBy);
  }
}

// Resolve vehicle-vs-vehicle overlaps (circle pairs) with a simple impulse.
export function collideVehicles(list, G) {
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      const dx0 = a.pos.x - b.pos.x, dz0 = a.pos.z - b.pos.z;
      const reach = (a.spec.len + b.spec.len) / 2 + 0.5;
      if (dx0 * dx0 + dz0 * dz0 > reach * reach) continue;
      const ca = a.circles(), cb = b.circles();
      for (const p of ca) {
        for (const q of cb) {
          const dx = p.x - q.x, dz = p.z - q.z;
          const d = Math.hypot(dx, dz);
          const min = p.r + q.r;
          if (d >= min || d < 1e-5) continue;
          const nx = dx / d, nz = dz / d;
          const pen = min - d;
          const ma = a.spec.mass, mb = b.spec.mass;
          const ta = mb / (ma + mb), tb = ma / (ma + mb);
          a.pos.x += nx * pen * ta; a.pos.z += nz * pen * ta;
          b.pos.x -= nx * pen * tb; b.pos.z -= nz * pen * tb;
          const rvx = a.vel.x - b.vel.x, rvz = a.vel.z - b.vel.z;
          const vn = rvx * nx + rvz * nz;
          if (vn < 0) {
            const jimp = (-(1.3) * vn) / (1 / ma + 1 / mb);
            a.vel.x += (jimp / ma) * nx; a.vel.z += (jimp / ma) * nz;
            b.vel.x -= (jimp / mb) * nx; b.vel.z -= (jimp / mb) * nz;
            const impact = -vn;
            if (impact > 5) {
              const dmg = impact * impact * 0.4;
              const src = a.driver === 'player' ? 'player' : b.driver === 'player' ? 'player' : null;
              a.damage(dmg * ta, G, src === 'player' && a.driver !== 'player' ? 'player' : null);
              b.damage(dmg * tb, G, src === 'player' && b.driver !== 'player' ? 'player' : null);
              G.fx.sparks((p.x + q.x) / 2, 0.7, (p.z + q.z) / 2, 8);
              if (src) G.audio.crash(Math.min(1, impact / 25));
              G.onVehicleCollision?.(a, b, impact);
            }
          }
        }
      }
    }
  }
}

// Ray vs vehicle oriented box. Returns distance or Infinity.
export function rayVehicle(v, ox, oy, oz, dx, dy, dz) {
  const c = Math.cos(-v.heading), s = Math.sin(-v.heading);
  // transform into local frame (rotate by -heading around Y)
  const lx = ox - v.pos.x, lz = oz - v.pos.z;
  const px = lx * c + lz * s, pz = -lx * s + lz * c;
  const qx = dx * c + dz * s, qz = -dx * s + dz * c;
  const hw = v.spec.wid / 2, hl = v.spec.len / 2;
  const top = 0.38 + v.spec.body + v.spec.cabinH;
  let tmin = 0, tmax = Infinity;
  for (const [o, d, mn, mx] of [[px, qx, -hw, hw], [oy - v.pos.y, dy, 0.15, top], [pz, qz, -hl, hl]]) {
    if (Math.abs(d) < 1e-9) {
      if (o < mn || o > mx) return Infinity;
      continue;
    }
    let t1 = (mn - o) / d, t2 = (mx - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

export { circleVsAABB };
