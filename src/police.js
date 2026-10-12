// Wanted level, police pursuit AI, and the police helicopter.
import * as THREE from 'three';
import { Vehicle } from './vehicle.js';
import { TrafficAI, steerToward, obstacleSpeed, applySpeed } from './traffic.js';
import { N, CELL } from './world.js';
import { clamp, rand } from './util.js';

function nodeNeighbors(n) {
  const out = [];
  if (n.i > 0) out.push({ i: n.i - 1, j: n.j });
  if (n.i < N) out.push({ i: n.i + 1, j: n.j });
  if (n.j > 0) out.push({ i: n.i, j: n.j - 1 });
  if (n.j < N) out.push({ i: n.i, j: n.j + 1 });
  return out;
}

export class PoliceAI {
  constructor(v, crew = 2) {
    this.v = v;
    this.crew = crew;
    this.state = 'pursuit';
    this.nav = null;
    this.prevNav = null;
    this.stuckT = 0;
    this.reverseT = 0;
  }
  update(dt, G) {
    const v = this.v;
    if (!v.alive) return;
    const pl = G.player;
    const tgt = pl.inCar ? pl.inCar : null;
    const tp = tgt ? tgt.pos : pl.pos;
    const dx = tp.x - v.pos.x, dz = tp.z - v.pos.z;
    const d = Math.hypot(dx, dz);
    const los = d < 120 && !G.world.segmentBlocked(v.pos.x, v.pos.z, tp.x, tp.z, 1);
    if (los && d < 90) G.wanted.reportSeen();

    // Deploy officers when the suspect is on foot nearby.
    const suspectStopped = !pl.inCar || Math.abs(pl.inCar.speed) < 2;
    if (suspectStopped && d < 16 && this.crew > 0 && Math.abs(v.speed) < 3) {
      G.police.deployCrew(v, this);
      return;
    }

    let tx, tz, desired;
    if (los || d < 30) {
      // aim slightly ahead of a moving target
      const lead = tgt ? clamp(d / 30, 0, 1) * 0.6 : 0;
      tx = tp.x + (tgt ? tgt.vel.x * lead : 0);
      tz = tp.z + (tgt ? tgt.vel.z * lead : 0);
      desired = d > 50 ? v.spec.maxSpeed : tgt ? Math.max(Math.abs(tgt.speed) + 8, 16) : clamp(d - 8, 0, 20);
      this.nav = null;
    } else {
      // route through intersections toward the player
      const cur = G.world.nearestNode(v.pos.x, v.pos.z);
      if (!this.nav) this.nav = cur;
      const np = TrafficAI.nodeXZ(this.nav);
      if (Math.hypot(np.x - v.pos.x, np.z - v.pos.z) < 9) {
        let best = null, bd = Infinity;
        for (const n of nodeNeighbors(this.nav)) {
          const p = TrafficAI.nodeXZ(n);
          let dd = Math.hypot(p.x - tp.x, p.z - tp.z);
          if (this.prevNav && n.i === this.prevNav.i && n.j === this.prevNav.j) dd += CELL * 0.6;
          if (dd < bd) { bd = dd; best = n; }
        }
        this.prevNav = this.nav;
        this.nav = best;
      }
      const p = TrafficAI.nodeXZ(this.nav);
      tx = p.x;
      tz = p.z;
      desired = v.spec.maxSpeed * 0.8;
    }
    let { steer, diff } = steerToward(v, tx, tz);
    if (Math.abs(diff) > 0.6 && Math.abs(v.speed) > 14) desired = Math.min(desired, 12);
    if (Math.abs(diff) > 1.4) desired = Math.min(desired, 9);
    // only avoid non-target obstacles at speed; ram the player's car
    desired = obstacleSpeed(v, G, desired, tgt);

    if (this.reverseT > 0) {
      this.reverseT -= dt;
      v.input.throttle = -1;
      v.input.steer = -steer;
      v.input.handbrake = false;
      return;
    }
    if (desired > 3 && Math.abs(v.speed) < 1) {
      this.stuckT += dt;
      if (this.stuckT > 1.6) {
        this.stuckT = 0;
        this.reverseT = 1.2;
      }
    } else this.stuckT = 0;
    applySpeed(v, desired, steer, dt);
    v.input.handbrake = v.input.handbrake || (Math.abs(diff) > 1.2 && Math.abs(v.speed) > 18);
  }
}

class Heli {
  constructor(G) {
    this.G = G;
    const g = new THREE.Group();
    const m = (c) => new THREE.MeshStandardMaterial({ color: c, metalness: 0.4, roughness: 0.5 });
    const add = (geo, mat, x, y, z) => {
      const o = new THREE.Mesh(geo, mat);
      o.position.set(x, y, z);
      o.castShadow = true;
      g.add(o);
      return o;
    };
    add(new THREE.BoxGeometry(2.2, 2, 4.2), m(0x1a2440), 0, 0, 0);
    add(new THREE.BoxGeometry(1.9, 1.1, 1.4), new THREE.MeshStandardMaterial({ color: 0x223344, metalness: 0.8, roughness: 0.1 }), 0, 0.2, 2.2);
    add(new THREE.BoxGeometry(0.5, 0.6, 5), m(0x1a2440), 0, 0.3, -4.3);
    add(new THREE.BoxGeometry(0.15, 1.6, 0.8), m(0xffffff), 0.3, 0.9, -6.5);
    add(new THREE.BoxGeometry(0.15, 0.15, 3.4), m(0x222222), -1.1, -1.25, 0);
    add(new THREE.BoxGeometry(0.15, 0.15, 3.4), m(0x222222), 1.1, -1.25, 0);
    this.rotor = add(new THREE.BoxGeometry(11, 0.08, 0.4), m(0x111111), 0, 1.2, 0);
    this.rotor2 = add(new THREE.BoxGeometry(0.4, 0.08, 11), m(0x111111), 0, 1.2, 0);
    this.light = new THREE.SpotLight(0xe8f0ff, 0, 90, 0.22, 0.4, 1);
    this.light.position.set(0, -1.2, 1.5);
    g.add(this.light);
    g.add(this.light.target);
    // visible search-light cone
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(6, 40, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xdde8ff, transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })
    );
    cone.position.y = -20;
    this.cone = cone;
    g.add(cone);
    this.root = g;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.health = 700;
    this.alive = true;
    this.angle = Math.random() * Math.PI * 2;
    this.shootCd = 2;
    G.scene.add(g);
  }
  update(dt) {
    const G = this.G;
    const pl = G.player;
    const tp = pl.inCar ? pl.inCar.pos : pl.pos;
    this.rotor.rotation.y += dt * 30;
    this.rotor2.rotation.y += dt * 30;
    if (!this.alive) {
      this.vel.y -= 15 * dt;
      this.pos.addScaledVector(this.vel, dt);
      this.root.rotation.y += dt * 4;
      if (Math.random() < dt * 30) G.fx.fire(this.pos.x, this.pos.y, this.pos.z);
      if (this.pos.y < 1) {
        G.explosion(this.pos.x, 1, this.pos.z, 'player');
        this.remove = true;
      }
      this.root.position.copy(this.pos);
      return;
    }
    this.angle += dt * 0.25;
    const goal = new THREE.Vector3(tp.x + Math.sin(this.angle) * 25, 38, tp.z + Math.cos(this.angle) * 25);
    const to = goal.sub(this.pos);
    this.vel.lerp(to.multiplyScalar(0.6).clampLength(0, 35), Math.min(1, dt * 1.5));
    this.pos.addScaledVector(this.vel, dt);
    this.root.position.copy(this.pos);
    const yaw = Math.atan2(tp.x - this.pos.x, tp.z - this.pos.z);
    this.root.rotation.y = yaw;
    this.root.rotation.x = clamp(this.vel.length() * 0.01, 0, 0.25);
    // searchlight
    const lp = new THREE.Vector3(tp.x, 0, tp.z);
    this.root.worldToLocal(lp);
    this.light.target.position.copy(lp);
    this.light.intensity = G.night * 900;
    this.cone.material.opacity = G.night * 0.08;
    const dir = lp.clone().sub(new THREE.Vector3(0, -1.2, 1.5)).normalize();
    this.cone.position.copy(new THREE.Vector3(0, -1.2, 1.5).addScaledVector(dir, 20));
    this.cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);

    G.wanted.reportSeen();
    if (G.wanted.stars >= 4 && pl.alive) {
      this.shootCd -= dt;
      if (this.shootCd <= 0) {
        this.shootCd = rand(0.15, 0.25);
        const ox = this.pos.x, oy = this.pos.y - 1.5, oz = this.pos.z;
        const hit = Math.random() < 0.18;
        const off = hit ? 0.3 : rand(1.5, 4);
        const tx = tp.x + rand(-off, off), tz = tp.z + rand(-off, off);
        G.fx.tracer(ox, oy, oz, tx, 0.8, tz);
        G.fx.sparks(tx, 0.2, tz, 2);
        G.audio.gunshot(0.25);
        if (hit) {
          if (pl.inCar) pl.inCar.damage(18, G);
          else pl.takeDamage(4);
        }
        G.panic(tp.x, tp.z, 25);
      }
    }
  }
  rayHit(ox, oy, oz, dx, dy, dz) {
    if (!this.alive) return null;
    const lx = this.pos.x - ox, ly = this.pos.y - oy, lz = this.pos.z - oz;
    const tca = lx * dx + ly * dy + lz * dz;
    if (tca < 0) return null;
    const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
    if (d2 > 3.2 * 3.2) return null;
    return { t: tca - Math.sqrt(3.2 * 3.2 - d2) };
  }
  damage(n) {
    if (!this.alive) return;
    this.health -= n;
    this.G.fx.sparks(this.pos.x, this.pos.y, this.pos.z, 4);
    if (this.health <= 0) {
      this.alive = false;
      this.vel.set(rand(-4, 4), 2, rand(-4, 4));
      this.G.wanted.addHeat(1);
      this.G.hud.notify('Police helicopter down!');
    }
  }
  dispose() {
    this.G.scene.remove(this.root);
  }
}

export class Wanted {
  constructor(G) {
    this.G = G;
    this.heat = 0;
    this.unseen = 0;
    this.seenThisFrame = false;
  }
  get stars() {
    return Math.min(5, Math.floor(this.heat + 1e-6));
  }
  get searching() {
    return this.stars > 0 && this.unseen > 2.5;
  }
  addHeat(n, min = 0) {
    const before = this.stars;
    this.heat = Math.min(5.99, Math.max(this.heat + n, min));
    this.unseen = 0;
    if (this.stars > before) this.G.hud.flashStars();
  }
  setMin(min) {
    if (this.heat < min) this.addHeat(0, min);
  }
  reportSeen() {
    this.seenThisFrame = true;
  }
  clear() {
    this.heat = 0;
    this.unseen = 0;
  }
  update(dt) {
    if (this.stars > 0) {
      if (this.seenThisFrame) this.unseen = 0;
      else this.unseen += dt;
      const need = 10 + this.stars * 4;
      if (this.unseen > need) {
        this.clear();
        this.G.hud.notify('You lost the cops.');
        this.G.police.standDown();
      }
    }
    this.seenThisFrame = false;
  }
}

export class PoliceManager {
  constructor(G) {
    this.G = G;
    this.spawnCd = 0;
    this.heli = null;
  }
  get cars() {
    return this.G.vehicles.filter((v) => v.driver instanceof PoliceAI);
  }
  deployCrew(v, ai) {
    const G = this.G;
    const f = v.forward;
    const rx = -f.z, rz = f.x;
    for (let k = 0; k < ai.crew; k++) {
      const side = k === 0 ? 1 : -1;
      const x = v.pos.x + rx * side * 1.8, z = v.pos.z + rz * side * 1.8;
      const cop = G.peds.spawnAt('cop', x, z, 'hostile');
      cop.heading = v.heading;
    }
    ai.crew = 0;
    v.driver = null;
    v.setOccupied(false);
    v.input.throttle = 0;
    v.keep = false;
  }
  standDown() {
    const G = this.G;
    for (const v of G.vehicles) {
      if (v.driver instanceof PoliceAI) {
        v.siren = false;
        const n = G.world.nearestNode(v.pos.x, v.pos.z);
        const nb = nodeNeighbors(n);
        v.driver = new TrafficAI(v, n, nb[Math.floor(Math.random() * nb.length)]);
      }
    }
    for (const p of G.peds.list) {
      if (p.kind === 'cop' && p.alive) p.state = 'leave';
    }
  }
  spawnCar() {
    const G = this.G;
    const pp = G.player.inCar ? G.player.inCar.pos : G.player.pos;
    const v = G.traffic.spawnTraffic(pp, 90, 150, 'police', false);
    if (!v) return;
    v.driver = new PoliceAI(v, G.wanted.stars >= 3 ? 2 : 2);
    v.setOccupied(true);
    v.siren = true;
  }
  update(dt) {
    const G = this.G;
    const stars = G.wanted.stars;
    if (stars > 0 && G.player.alive) {
      const pp = G.player.inCar ? G.player.inCar.pos : G.player.pos;
      let units = 0;
      for (const v of G.vehicles) {
        if (v.driver instanceof PoliceAI && v.alive && v.pos.distanceTo(pp) < 220) units++;
      }
      let foot = 0;
      for (const p of G.peds.list) if (p.kind === 'cop' && p.alive && p.state === 'hostile') foot++;
      units += Math.ceil(foot / 2);
      const want = stars === 1 ? 1 : stars === 2 ? 2 : stars + 1;
      this.spawnCd -= dt;
      if (units < want && this.spawnCd <= 0) {
        this.spawnCd = stars >= 3 ? 2 : 4;
        this.spawnCar();
      }
      if (stars >= 3 && !this.heli) {
        this.heli = new Heli(G);
        const a = Math.random() * Math.PI * 2;
        this.heli.pos.set(pp.x + Math.sin(a) * 160, 60, pp.z + Math.cos(a) * 160);
      }
      // cops on foot re-engage
      for (const p of G.peds.list) if (p.kind === 'cop' && p.alive && p.state === 'leave') p.state = 'hostile';
    }
    if (this.heli) {
      if (stars < 3 && this.heli.alive) {
        // fly away
        this.heli.pos.y += dt * 10;
        this.heli.root.position.copy(this.heli.pos);
        this.heli.light.intensity = 0;
        this.heli.cone.material.opacity = 0;
        if (this.heli.pos.y > 120) {
          this.heli.dispose();
          this.heli = null;
        }
      } else {
        this.heli.update(dt);
        if (this.heli.remove) {
          this.heli.dispose();
          this.heli = null;
        }
      }
    }
    // siren audio intensity: nearest active police car
    let near = Infinity;
    const pp = G.player.inCar ? G.player.inCar.pos : G.player.pos;
    for (const v of G.vehicles) {
      if (v.isPolice && v.siren) near = Math.min(near, v.pos.distanceTo(pp));
    }
    this.sirenLevel = near < 150 ? 1 - near / 150 : 0;
  }
}
