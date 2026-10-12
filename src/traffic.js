// Traffic AI (lane following on the road grid) and the vehicle manager.
import { Vehicle, randomTrafficType, collideVehicles } from './vehicle.js';
import { N, LANE, ROAD, CELL } from './world.js';
import { clamp, wrapAngle, headingTo, rand } from './util.js';
import { lightState } from './details.js';

function neighbors(n) {
  const out = [];
  if (n.i > 0) out.push({ i: n.i - 1, j: n.j });
  if (n.i < N) out.push({ i: n.i + 1, j: n.j });
  if (n.j > 0) out.push({ i: n.i, j: n.j - 1 });
  if (n.j < N) out.push({ i: n.i, j: n.j + 1 });
  return out;
}
const same = (a, b) => a.i === b.i && a.j === b.j;

// Shared low-level "drive toward a point" helper.
export function steerToward(v, tx, tz) {
  const want = headingTo(tx - v.pos.x, tz - v.pos.z);
  const diff = wrapAngle(want - v.heading);
  return { steer: clamp(diff * 2.2, -1, 1), diff };
}

// Look for obstacles in front of the vehicle. Returns the max safe speed.
export function obstacleSpeed(v, G, desired, ignore) {
  const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
  const rx = -fz, rz = fx;
  const look = 7 + Math.abs(v.speed) * 1.1;
  let best = desired;
  const test = (x, z, halfW) => {
    const dx = x - v.pos.x, dz = z - v.pos.z;
    const ahead = dx * fx + dz * fz;
    if (ahead <= 0 || ahead > look) return;
    const lat = dx * rx + dz * rz;
    if (Math.abs(lat) > 1.4 + halfW) return;
    const gap = ahead - v.spec.len / 2 - 2.5;
    best = Math.min(best, Math.max(0, gap * 0.9));
  };
  for (const o of G.vehicles) {
    if (o === v || o === ignore) continue;
    const dx = o.pos.x - v.pos.x, dz = o.pos.z - v.pos.z;
    if (dx * dx + dz * dz > look * look + 30) continue;
    test(o.pos.x, o.pos.z, o.spec.wid / 2);
  }
  if (!G.player.inCar && G.player.alive) test(G.player.pos.x, G.player.pos.z, 0.4);
  for (const p of G.peds.list) {
    if (!p.alive) continue;
    const dx = p.pos.x - v.pos.x, dz = p.pos.z - v.pos.z;
    if (dx * dx + dz * dz > look * look) continue;
    test(p.pos.x, p.pos.z, 0.4);
  }
  return best;
}

export function applySpeed(v, desired, steer, dt) {
  const err = desired - v.speed;
  let throttle = clamp(err * 0.4, -1, 1);
  let handbrake = false;
  if (desired < 0.5 && Math.abs(v.speed) < 1) {
    throttle = 0;
    handbrake = true;
  }
  v.input.throttle = throttle;
  v.input.steer = steer;
  v.input.handbrake = handbrake;
}

export class TrafficAI {
  constructor(v, from, to) {
    this.v = v;
    this.from = from;
    this.to = to;
    this.wps = [];
    this.stuckT = 0;
    this.reverseT = 0;
    this.panicT = 0;
    this.cruise = rand(11, 15);
    this.planSegment();
  }
  static nodeXZ(n) {
    return { x: -(N * CELL) / 2 + n.i * CELL, z: -(N * CELL) / 2 + n.j * CELL };
  }
  planSegment() {
    const a = TrafficAI.nodeXZ(this.from), b = TrafficAI.nodeXZ(this.to);
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
    const rx = -dz, rz = dx;
    this.wps.push({ x: b.x + rx * LANE - dx * (ROAD / 2 + 2), z: b.z + rz * LANE - dz * (ROAD / 2 + 2), stop: true });
  }
  chooseNext() {
    const opts = neighbors(this.to).filter((n) => !same(n, this.from));
    const next = opts.length ? opts[Math.floor(Math.random() * opts.length)] : this.from;
    const b = TrafficAI.nodeXZ(this.to), c = TrafficAI.nodeXZ(next);
    const len = Math.hypot(c.x - b.x, c.z - b.z) || 1;
    const dx = (c.x - b.x) / len, dz = (c.z - b.z) / len;
    const rx = -dz, rz = dx;
    this.wps.push({ x: b.x + rx * LANE + dx * (ROAD / 2 + 1), z: b.z + rz * LANE + dz * (ROAD / 2 + 1), turn: true });
    this.from = this.to;
    this.to = next;
    this.planSegment();
  }
  update(dt, G) {
    const v = this.v;
    if (!v.alive) return;
    if (!this.wps.length) this.planSegment();
    const wp = this.wps[0];
    const d = Math.hypot(wp.x - v.pos.x, wp.z - v.pos.z);
    // traffic lights: hold at the stop line on red (or yellow when there's room to stop)
    let redLight = false;
    if (wp.stop && this.panicT <= 0) {
      const axis = this.from.j === this.to.j ? 'x' : 'z';
      const st = lightState(this.to.i, this.to.j, axis, G.time);
      if (st === 'red' || (st === 'yellow' && d > 9)) redLight = true;
    }
    if (d < (wp.stop ? 6 : 4) && !redLight) {
      this.wps.shift();
      if (wp.stop) this.chooseNext();
      return;
    }
    let { steer, diff } = steerToward(v, wp.x, wp.z);
    let desired = this.panicT > 0 ? 24 : this.cruise;
    this.panicT -= dt;
    if (Math.abs(diff) > 0.35) desired = Math.min(desired, 7);
    if (wp.stop && d < 14) desired = Math.min(desired, 8);
    if (redLight) desired = Math.min(desired, Math.max(0, (d - 1.5) * 0.7));
    desired = obstacleSpeed(v, G, desired);

    if (this.reverseT > 0) {
      this.reverseT -= dt;
      v.input.throttle = -0.8;
      v.input.steer = -steer;
      v.input.handbrake = false;
      return;
    }
    if (desired > 3 && Math.abs(v.speed) < 0.8) {
      this.stuckT += dt;
      if (this.stuckT > 3.5) {
        this.stuckT = 0;
        this.reverseT = 1.3;
      }
    } else this.stuckT = 0;
    applySpeed(v, desired, steer, dt);
  }
}

export class VehicleManager {
  constructor(G) {
    this.G = G;
    this.trafficTarget = 22;
    this.spawnCd = 0;
    this.parkedCd = 0;
  }

  add(v) {
    this.G.vehicles.push(v);
    this.G.scene.add(v.root);
    return v;
  }
  remove(v) {
    const G = this.G;
    G.scene.remove(v.root);
    const i = G.vehicles.indexOf(v);
    if (i >= 0) G.vehicles.splice(i, 1);
    if (v.parkSpot) v.parkSpot.used = false;
  }

  spaceFree(x, z, r = 7) {
    for (const o of this.G.vehicles) {
      if (Math.hypot(o.pos.x - x, o.pos.z - z) < r) return false;
    }
    const p = this.G.player.pos;
    return Math.hypot(p.x - x, p.z - z) > r;
  }

  // Spawn a car driving in a lane, at distance [minD, maxD] from point.
  spawnTraffic(near, minD, maxD, type, ai = true) {
    const segs = this.G.world.segments;
    for (let tries = 0; tries < 20; tries++) {
      const s = segs[Math.floor(Math.random() * segs.length)];
      const flip = Math.random() < 0.5;
      const from = flip ? s.b : s.a, to = flip ? s.a : s.b;
      const a = TrafficAI.nodeXZ(from), b = TrafficAI.nodeXZ(to);
      const t = rand(0.3, 0.65);
      const dx = (b.x - a.x) / CELL, dz = (b.z - a.z) / CELL;
      const x = a.x + (b.x - a.x) * t - dz * LANE;
      const z = a.z + (b.z - a.z) * t + dx * LANE;
      const dist = Math.hypot(x - near.x, z - near.z);
      if (dist < minD || dist > maxD) continue;
      if (!this.spaceFree(x, z, 9)) continue;
      const v = new Vehicle(type || randomTrafficType());
      v.place(x, z, headingTo(dx, dz));
      if (ai) {
        v.driver = new TrafficAI(v, from, to);
        v.setOccupied(true);
        v.vel.x = dx * 8;
        v.vel.z = dz * 8;
      }
      return this.add(v);
    }
    return null;
  }

  update(dt) {
    const G = this.G;
    const pp = G.player.inCar ? G.player.inCar.pos : G.player.pos;
    let traffic = 0;
    for (let i = G.vehicles.length - 1; i >= 0; i--) {
      const v = G.vehicles[i];
      const d = Math.hypot(v.pos.x - pp.x, v.pos.z - pp.z);
      if (v.driver instanceof TrafficAI) traffic++;
      const limit = v.parkSpot ? 230 : 210;
      if (d > limit && v.driver !== 'player' && !v.mission && !v.keep) this.remove(v);
      else if (!v.alive && d > 120 && !v.mission) this.remove(v);
    }
    this.spawnCd -= dt;
    if (traffic < this.trafficTarget && this.spawnCd <= 0) {
      this.spawnCd = 0.25;
      this.spawnTraffic(pp, traffic < 8 ? 40 : 110, 190);
    }
    // parked cars around the player
    this.parkedCd -= dt;
    if (this.parkedCd <= 0) {
      this.parkedCd = 1;
      for (const s of G.world.parkingSpots) {
        if (s.used) continue;
        const d = Math.hypot(s.x - pp.x, s.z - pp.z);
        if (d < 180 && d > 70 && this.spaceFree(s.x, s.z, 5)) {
          const v = new Vehicle(randomTrafficType());
          v.place(s.x, s.z, s.h);
          v.parkSpot = s;
          s.used = true;
          this.add(v);
        }
      }
    }

    for (const v of G.vehicles) {
      if (v.driver && v.driver !== 'player') v.driver.update(dt, G);
      else if (v.driver !== 'player') {
        v.input.throttle = 0;
        v.input.steer = 0;
        v.input.handbrake = true;
      }
      v.update(dt, G);
    }
    collideVehicles(G.vehicles, G);
  }
}
