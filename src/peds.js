// Pedestrians, foot cops, and mission NPCs.
import * as THREE from 'three';
import { makeCharacter, animateCharacter, poseDead, randomLook } from './character.js';
import { sidewalkLoop, loopPoint, N } from './world.js';
import { clamp, rand, wrapAngle, headingTo, raySphere } from './util.js';

const COP_LOOK = () => ({ skin: [0xf1c27d, 0xc68642, 0x8d5524, 0xe0ac69][Math.floor(Math.random() * 4)], shirt: 0x24386a, pants: 0x161c2c, hair: 0x1a1a1a, cap: 0x141c34, belt: 0x111111 });
const GUARD_LOOK = () => ({ skin: [0xf1c27d, 0xc68642, 0x8d5524][Math.floor(Math.random() * 3)], shirt: 0x1a1a1a, pants: 0x1a1a1a, hair: 0x111111, sleeve: 0x1a1a1a, belt: 0x6a1010 });

// For crossing streets: which neighbouring block/corner you reach from corner k.
const CROSS = {
  0: [[-1, 0, 1], [0, -1, 3]],
  1: [[1, 0, 0], [0, -1, 2]],
  2: [[1, 0, 3], [0, 1, 1]],
  3: [[-1, 0, 2], [0, 1, 0]],
};

export class Ped {
  constructor(G, kind = 'civ', look) {
    this.G = G;
    this.kind = kind;
    this.look = look || (kind === 'cop' ? COP_LOOK() : kind === 'guard' ? GUARD_LOOK() : randomLook());
    this.model = makeCharacter(this.look);
    G.scene.add(this.model.root);
    this.pos = new THREE.Vector3();
    this.heading = 0;
    this.vel = new THREE.Vector3();
    this.health = kind === 'cop' ? 80 : kind === 'guard' ? 90 : 50;
    this.state = 'walk';
    this.timer = 0;
    this.speed = 0;
    this.shootCd = rand(0.5, 1.5);
    this.armed = kind === 'cop' || kind === 'guard';
    this.model.gun.visible = this.armed;
    this.walkSpeed = rand(1.2, 1.7);
    this.dir = Math.random() < 0.5 ? 1 : -1;
    this.deadTime = 0;
  }

  get alive() {
    return this.state !== 'dead' && this.state !== 'flung';
  }

  attachToLoop(block, t) {
    this.block = block;
    this.loop = sidewalkLoop(block);
    this.t = t;
    const p = loopPoint(this.loop, t);
    this.pos.set(p.x, this.G.world.groundHeight(p.x, p.z), p.z);
    this.state = 'walk';
  }

  // Re-attach to the nearest sidewalk loop (after fleeing etc.)
  reanchor() {
    const { world } = this.G;
    const HALFV = (N * 80) / 2;
    const bi = clamp(Math.floor((this.pos.x + HALFV) / 80), 0, N - 1);
    const bj = clamp(Math.floor((this.pos.z + HALFV) / 80), 0, N - 1);
    const b = world.getBlock(bi, bj);
    const L = sidewalkLoop(b);
    // project to rectangle perimeter
    const x = clamp(this.pos.x, L.x0, L.x1), z = clamp(this.pos.z, L.z0, L.z1);
    const dl = x - L.x0, dr = L.x1 - x, dt = z - L.z0, db = L.z1 - z;
    const m = Math.min(dl, dr, dt, db);
    let t;
    if (m === dt) t = x - L.x0;
    else if (m === dr) t = L.w + (z - L.z0);
    else if (m === db) t = L.w + L.h + (L.x1 - x);
    else t = 2 * L.w + L.h + (L.z1 - z);
    this.block = b;
    this.loop = L;
    this.t = t;
    const p = loopPoint(L, t);
    this.target = { x: p.x, z: p.z };
    this.state = 'return';
  }

  panic(fromX, fromZ, time = 8, force = false) {
    if (!this.alive || this.kind === 'cop' || this.kind === 'guard') return;
    if (this.kind === 'clerk' && !force) return; // clerks stay behind the counter
    if (this.state === 'knocked') return;
    this.state = 'flee';
    this.fleeFrom = { x: fromX, z: fromZ };
    this.timer = time + rand(0, 3);
  }

  takeDamage(amount, source, hx, hy, hz) {
    if (!this.alive) return;
    this.health -= amount;
    if (hx !== undefined) this.G.fx.blood(hx, hy, hz);
    if (this.health <= 0) {
      this.die(source);
      return;
    }
    if (this.kind !== 'civ' && source === 'player') this.G.onPedAttacked?.(this);
    if (this.kind === 'civ' || this.kind === 'target') {
      const p = this.G.player.pos;
      this.panic(p.x, p.z, 10);
    } else if (source === 'player') {
      this.state = 'hostile';
    }
  }

  die(source, flingVel) {
    if (!this.alive) return;
    this.health = 0;
    this.model.gun.visible = false;
    if (flingVel) {
      this.state = 'flung';
      this.vel.copy(flingVel);
    } else {
      this.state = 'dead';
      poseDead(this.model);
    }
    this.deadTime = 0;
    this.G.onPedKilled(this, source);
  }

  // Move toward (x,z) at speed with building collision. Returns remaining distance.
  moveToward(x, z, speed, dt, collide = true) {
    const dx = x - this.pos.x, dz = z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.05) {
      const step = Math.min(d, speed * dt);
      this.pos.x += (dx / d) * step;
      this.pos.z += (dz / d) * step;
      const want = headingTo(dx, dz);
      this.heading += wrapAngle(want - this.heading) * Math.min(1, dt * 10);
    }
    if (collide) this.G.world.collideCircle(this.pos, 0.35, 1);
    this.speed = d > 0.05 ? speed : 0;
    return d;
  }

  update(dt) {
    const G = this.G;
    const m = this.model;
    let aim = false;
    let crouch = false;
    this.speed = 0;

    switch (this.state) {
      case 'walk': {
        const L = this.loop;
        const prevT = this.t;
        this.t += this.dir * this.walkSpeed * dt;
        const len = L.len;
        const a = ((prevT % len) + len) % len, b = ((this.t % len) + len) % len;
        // corner crossing chance
        for (let k = 0; k < 4; k++) {
          const c = L.corners[k];
          const crossed = this.dir > 0
            ? (a < c && b >= c) || (b < a && c === 0)
            : (a > c && b <= c) || (b > a && c === 0);
          if (crossed && Math.random() < 0.3) {
            const [di, dj, ck] = CROSS[k][Math.random() < 0.5 ? 0 : 1];
            const nb = G.world.getBlock(this.block.bi + di, this.block.bj + dj);
            if (nb) {
              const nl = sidewalkLoop(nb);
              const nt = nl.corners[ck];
              const p = loopPoint(nl, nt);
              this.state = 'cross';
              this.target = { x: p.x, z: p.z };
              this.next = { block: nb, t: nt };
            }
            break;
          }
        }
        const p = loopPoint(L, this.t);
        this.pos.x = p.x;
        this.pos.z = p.z;
        this.heading = headingTo(p.dx * this.dir, p.dz * this.dir);
        this.speed = this.walkSpeed;
        if (Math.random() < dt * 0.02) this.dir *= -1;
        break;
      }
      case 'cross': {
        const d = this.moveToward(this.target.x, this.target.z, this.walkSpeed * 1.2, dt, false);
        if (d < 0.3) {
          this.attachToLoop(this.next.block, this.next.t);
        }
        break;
      }
      case 'return': {
        const d = this.moveToward(this.target.x, this.target.z, this.walkSpeed, dt);
        if (d < 0.5) this.attachToLoop(this.block, this.t);
        break;
      }
      case 'flee': {
        this.timer -= dt;
        const dx = this.pos.x - this.fleeFrom.x, dz = this.pos.z - this.fleeFrom.z;
        const d = Math.hypot(dx, dz) || 1;
        this.moveToward(this.pos.x + (dx / d) * 5, this.pos.z + (dz / d) * 5, 5.6, dt);
        if (this.timer <= 0) {
          if (Math.random() < 0.4) {
            this.state = 'cower';
            this.timer = rand(4, 8);
          } else this.reanchor();
        }
        break;
      }
      case 'cower':
        crouch = true;
        this.timer -= dt;
        if (this.timer <= 0) this.reanchor();
        break;
      case 'knocked':
        this.timer -= dt;
        if (this.timer <= 0) {
          m.body.rotation.set(0, 0, 0);
          m.body.position.y = 0.92;
          const p = G.player.pos;
          if (this.kind === 'civ' || this.kind === 'target') this.panic(p.x, p.z, 8);
          else this.state = 'hostile';
        }
        break;
      case 'idle':
        if (this.kind === 'guard' || this.kind === 'target') {
          const pp = G.player.pos;
          if (this.pos.distanceTo(pp) < 22 && !G.world.segmentBlocked(this.pos.x, this.pos.z, pp.x, pp.z)) {
            G.onPedAttacked?.(this);
          }
        }
        if (this.idleFace !== undefined) this.heading = this.idleFace;
        break;
      case 'hostile':
        aim = this.updateHostile(dt);
        break;
      case 'leave': {
        const p = G.player.pos;
        const dx = this.pos.x - p.x, dz = this.pos.z - p.z;
        const d = Math.hypot(dx, dz) || 1;
        this.moveToward(this.pos.x + (dx / d) * 5, this.pos.z + (dz / d) * 5, 1.6, dt);
        break;
      }
      case 'flung': {
        this.vel.y -= 22 * dt;
        this.pos.addScaledVector(this.vel, dt);
        G.world.collideCircle(this.pos, 0.35, 1);
        m.body.rotation.x -= dt * 8;
        m.body.rotation.z += dt * 3;
        const gy = G.world.groundHeight(this.pos.x, this.pos.z);
        if (this.pos.y <= gy) {
          this.pos.y = gy;
          this.state = 'dead';
          poseDead(m);
          G.fx.dust(this.pos.x, 0.2, this.pos.z);
        }
        break;
      }
      case 'dead':
        this.deadTime += dt;
        break;
    }

    if (this.state !== 'flung') {
      const gy = G.world.groundHeight(this.pos.x, this.pos.z);
      this.pos.y += (gy - this.pos.y) * Math.min(1, dt * 15);
    }
    m.root.position.copy(this.pos);
    m.root.rotation.y = this.heading;
    if (this.alive && this.state !== 'knocked') animateCharacter(m, dt, this.speed, aim, crouch);
  }

  // Cop / guard combat behaviour. Returns true while aiming.
  updateHostile(dt) {
    const G = this.G;
    const pl = G.player;
    if (!pl.alive) return false;
    const tp = pl.inCar ? pl.inCar.pos : pl.pos;
    const d = Math.hypot(tp.x - this.pos.x, tp.z - this.pos.z);
    const los = d < 70 && !G.world.segmentBlocked(this.pos.x, this.pos.z, tp.x, tp.z);
    if (this.kind === 'cop' && los && d < 60) G.wanted.reportSeen();
    const lethal = this.kind === 'guard' || G.wanted.stars >= 2;
    let aim = false;

    if (!lethal && this.kind === 'cop') {
      // Try to arrest
      if (d > 1.3) this.moveToward(tp.x, tp.z, 5.2, dt);
      else this.heading = headingTo(tp.x - this.pos.x, tp.z - this.pos.z);
      if (d < 1.8 && !pl.inCar) pl.arrest(dt);
      if (d < 3.6 && pl.inCar && Math.abs(pl.inCar.speed) < 1.5) pl.arrest(dt);
      return false;
    }

    const wantRange = this.kind === 'guard' ? 16 : 14;
    if (!los || d > wantRange) {
      this.moveToward(tp.x, tp.z, 5.2, dt);
    } else {
      this.heading += wrapAngle(headingTo(tp.x - this.pos.x, tp.z - this.pos.z) - this.heading) * Math.min(1, dt * 8);
      if (d < 4) this.moveToward(this.pos.x - (tp.x - this.pos.x), this.pos.z - (tp.z - this.pos.z), 2, dt);
    }
    if (los && d < 45) {
      aim = true;
      this.shootCd -= dt;
      if (this.shootCd <= 0) {
        this.shootCd = rand(0.7, 1.4);
        this.fireAt(tp, d);
      }
    }
    return aim;
  }

  fireAt(tp, d) {
    const G = this.G;
    const pl = G.player;
    const mx = this.pos.x + Math.sin(this.heading) * 0.5, mz = this.pos.z + Math.cos(this.heading) * 0.5, my = this.pos.y + 1.45;
    const moving = pl.inCar ? Math.abs(pl.inCar.speed) : pl.speed;
    const chance = clamp(0.6 - d * 0.012 - moving * 0.02, 0.08, 0.6);
    const hit = Math.random() < chance;
    const ty = pl.inCar ? 1.1 : pl.pos.y + 1.2;
    const off = hit ? 0 : rand(1, 2.5);
    G.fx.muzzle(mx, my, mz);
    G.fx.tracer(mx, my, mz, tp.x + rand(-off, off), ty + rand(-off, off) * 0.4, tp.z + rand(-off, off));
    G.audio.gunshot(clamp(1 - d / 80, 0.1, 0.8));
    if (hit) {
      if (pl.inCar) {
        pl.inCar.damage(25, G, null);
        if (Math.random() < 0.25) pl.takeDamage(4);
      } else pl.takeDamage(this.kind === 'guard' ? 9 : 7);
    }
    // gunfire scares civilians
    G.panic(this.pos.x, this.pos.z, 30);
  }

  // ray test for bullets
  rayHit(ox, oy, oz, dx, dy, dz) {
    if (!this.alive) return null;
    const p = this.pos;
    const crouchOff = this.state === 'cower' ? -0.35 : 0;
    const head = raySphere(ox, oy, oz, dx, dy, dz, p.x, p.y + 1.76 + crouchOff, p.z, 0.2);
    let best = Infinity, part = null;
    if (head < best) { best = head; part = 'head'; }
    for (const h of [0.45, 0.95, 1.35]) {
      const t = raySphere(ox, oy, oz, dx, dy, dz, p.x, p.y + h + crouchOff, p.z, 0.34);
      if (t < best) { best = t; part = 'body'; }
    }
    return part ? { t: best, part } : null;
  }

  dispose() {
    this.G.scene.remove(this.model.root);
  }
}

export class PedManager {
  constructor(G) {
    this.G = G;
    this.list = [];
    this.target = 42;
    this.spawnCd = 0;
  }

  spawnCiv(near, minD, maxD) {
    const s = this.G.world.randomSidewalkNear(near.x, near.z, minD, maxD);
    if (!s) return null;
    const p = new Ped(this.G, 'civ');
    p.attachToLoop(s.block, s.t);
    this.list.push(p);
    return p;
  }

  spawnAt(kind, x, z, state = 'hostile') {
    const p = new Ped(this.G, kind);
    p.pos.set(x, this.G.world.groundHeight(x, z), z);
    p.state = state;
    this.list.push(p);
    return p;
  }

  remove(p) {
    p.dispose();
    const i = this.list.indexOf(p);
    if (i >= 0) this.list.splice(i, 1);
  }

  update(dt) {
    const G = this.G;
    const pp = G.player.inCar ? G.player.inCar.pos : G.player.pos;
    // spawn / despawn civilians
    let civs = 0;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      const d = Math.hypot(p.pos.x - pp.x, p.pos.z - pp.z);
      if (p.kind === 'civ') civs++;
      const far = p.kind === 'civ' ? 160 : p.state === 'leave' ? 70 : 260;
      if ((d > far && !p.mission) || (p.state === 'dead' && p.deadTime > 40 && !p.mission)) {
        this.remove(p);
      }
    }
    this.spawnCd -= dt;
    if (civs < this.target && this.spawnCd <= 0) {
      this.spawnCd = 0.15;
      this.spawnCiv(pp, civs < this.target * 0.5 ? 25 : 70, 140);
    }

    for (const p of this.list) {
      p.update(dt);
    }
    this.vehicleContacts(dt);
  }

  // Cars knocking pedestrians over.
  vehicleContacts() {
    const G = this.G;
    for (const v of G.vehicles) {
      const sp = Math.hypot(v.vel.x, v.vel.z);
      for (const p of this.list) {
        if (!p.alive) continue;
        const dx0 = p.pos.x - v.pos.x, dz0 = p.pos.z - v.pos.z;
        if (dx0 * dx0 + dz0 * dz0 > 16) continue;
        for (const c of v.circles()) {
          const dx = p.pos.x - c.x, dz = p.pos.z - c.z;
          const d = Math.hypot(dx, dz);
          const min = c.r + 0.35;
          if (d >= min) continue;
          const nx = d > 1e-4 ? dx / d : 1, nz = d > 1e-4 ? dz / d : 0;
          const source = v.driver === 'player' ? 'player' : 'traffic';
          if (sp > 7) {
            G.fx.blood(p.pos.x, 1, p.pos.z);
            p.die(source, new THREE.Vector3(v.vel.x * 0.7 + nx * 2, 3 + sp * 0.15, v.vel.z * 0.7 + nz * 2));
            G.audio.crash(0.4);
            v.vel.x *= 0.93;
            v.vel.z *= 0.93;
          } else if (sp > 3) {
            p.takeDamage(sp * 4, source);
            if (p.alive) {
              p.state = 'knocked';
              p.timer = 2;
              p.model.body.rotation.x = -Math.PI / 2;
              p.model.body.position.y = 0.25;
            }
            p.pos.x += nx * (min - d);
            p.pos.z += nz * (min - d);
          } else {
            p.pos.x += nx * (min - d);
            p.pos.z += nz * (min - d);
            if (v.driver === 'player' && (p.state === 'walk' || p.state === 'cross')) p.panic(v.pos.x, v.pos.z, 4);
          }
          break;
        }
      }
    }
  }
}
