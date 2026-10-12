// The player: on-foot movement, vehicles, weapons, health.
import * as THREE from 'three';
import { makeCharacter, animateCharacter, poseSeated, poseDead } from './character.js';
import { rayVehicle } from './vehicle.js';
import { PoliceAI } from './police.js';
import { TrafficAI } from './traffic.js';
import { clamp, wrapAngle, headingTo, rand } from './util.js';

export const WEAPONS = {
  fist: { name: 'Fists', melee: true, rate: 0.45, dmg: 22, reach: 1.9 },
  bat: { name: 'Baseball Bat', melee: true, rate: 0.6, dmg: 45, reach: 2.4, knock: true },
  pistol: { name: 'Pistol', dmg: 34, rate: 0.22, clip: 12, spread: 0.012, range: 160, auto: false },
  smg: { name: 'SMG', dmg: 19, rate: 0.075, clip: 30, spread: 0.035, range: 130, auto: true },
  shotgun: { name: 'Shotgun', dmg: 17, pellets: 8, rate: 0.85, clip: 6, spread: 0.075, range: 50, auto: false, heavy: true },
  grenade: { name: 'Grenades', throwable: true, rate: 0.9, clip: 1, heavy: true },
  rpg: { name: 'Rocket Launcher', rocket: true, rate: 1.4, clip: 1, heavy: true },
};
export const WEAPON_ORDER = ['fist', 'bat', 'pistol', 'smg', 'shotgun', 'grenade', 'rpg'];

// The three playable characters (all original to this game).
export const CHARACTERS = [
  { id: 'rico', name: 'Rico Vance', tag: 'Getaway driver', color: '#4fd88a',
    look: { skin: 0xc68642, shirt: 0x2e5e4e, sleeve: 0x2e5e4e, pants: 0x2b3448, hair: 0x161616, belt: 0x3a2a1a, hairStyle: 'short' } },
  { id: 'dana', name: 'Dana Reyes', tag: 'Hacker', color: '#4fb8ff',
    look: { skin: 0xe0ac69, shirt: 0x1fb0b0, jacket: 0x1a1a1a, pants: 0x222230, hair: 0x7a1a1a, shoes: 0xeeeeee, slim: true, hairStyle: 'long' } },
  { id: 'moe', name: 'Big Moe', tag: 'Biker', color: '#ffb04f', scale: 1.1,
    look: { skin: 0xf1c27d, shirt: 0x8a8a8a, jacket: 0x4a2a18, pants: 0x1c2a40, hair: 0x5a3a20, shoes: 0x3a2a1a, hairStyle: 'bald', cap: 0x1a1a1a } },
];
const PLAYER_LOOK = CHARACTERS[0].look;

export class Player {
  constructor(G) {
    this.G = G;
    this.model = makeCharacter(PLAYER_LOOK);
    G.scene.add(this.model.root);
    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3();
    this.heading = 0;
    this.speed = 0;
    this.health = 100;
    this.armor = 0;
    this.money = 500;
    this.alive = true;
    this.inCar = null;
    this.grounded = true;
    this.weapons = { fist: {}, pistol: { clip: 12, ammo: 48 } };
    this.cur = 'pistol';
    this.cooldown = 0;
    this.reloadT = 0;
    this.aiming = false;
    this.faceAimT = 0;
    this.knockT = 0;
    this.arrestT = 0;
    this.arrestTouched = false;
    this.horn = false;
  }

  get weapon() {
    return WEAPONS[this.cur];
  }

  giveWeapon(key, ammo) {
    if (!this.weapons[key]) this.weapons[key] = { clip: 0, ammo: 0 };
    const w = this.weapons[key];
    w.ammo += ammo;
    this.cur = key;
    if (w.clip === 0) this.reload(true);
  }

  reload(instant = false) {
    const def = WEAPONS[this.cur];
    const w = this.weapons[this.cur];
    if (def.melee || !w || w.ammo <= 0 || w.clip >= def.clip) return;
    const take = Math.min(def.clip - w.clip, w.ammo);
    if (instant) {
      w.clip += take;
      w.ammo -= take;
    } else if (this.reloadT <= 0) {
      this.reloadT = def.throwable ? 0.5 : def.rocket ? 2 : def.heavy ? 1.6 : 1.1;
      this.G.audio.click();
    }
  }

  cycleWeapon(dir) {
    const owned = WEAPON_ORDER.filter((k) => this.weapons[k]);
    let i = owned.indexOf(this.cur);
    i = (i + dir + owned.length) % owned.length;
    this.cur = owned[i];
    this.reloadT = 0;
  }

  takeDamage(n) {
    if (!this.alive || this.G.godMode) return;
    if (this.armor > 0) {
      const a = Math.min(this.armor, n * 0.7);
      this.armor -= a;
      n -= a;
    }
    this.health -= n;
    this.G.hud.damageFlash();
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      if (this.inCar) this.exitCar(true);
      poseDead(this.model);
      this.G.onPlayerDown('wasted');
    }
  }

  arrest(dt) {
    if (!this.alive) return;
    this.arrestTouched = true;
    this.arrestT += dt;
    if (this.arrestT > 1.4) {
      this.alive = false;
      if (this.inCar) this.exitCar(true);
      this.G.onPlayerDown('busted');
    }
  }

  // ---- vehicles ----
  tryEnterCar() {
    const G = this.G;
    let best = null, bd = 4.2;
    for (const v of G.vehicles) {
      if (!v.alive) continue;
      const d = Math.hypot(v.pos.x - this.pos.x, v.pos.z - this.pos.z);
      if (d < bd) { bd = d; best = v; }
    }
    if (!best) return false;
    const v = best;
    // carjack!
    if (v.driver && v.driver !== 'player') {
      const isCop = v.driver instanceof PoliceAI;
      const crew = isCop ? v.driver.crew : 1;
      const lx = Math.cos(v.heading), lz = -Math.sin(v.heading);
      const x = v.pos.x + lx * (v.spec.wid / 2 + 0.9), z = v.pos.z + lz * (v.spec.wid / 2 + 0.9);
      if (isCop) {
        for (let k = 0; k < Math.max(1, crew); k++) G.peds.spawnAt('cop', x + k * 0.8, z, 'hostile');
        G.wanted.addHeat(1, 2);
      } else {
        const p = G.peds.spawnAt('civ', x, z, 'flee');
        p.fleeFrom = { x: this.pos.x, z: this.pos.z };
        p.timer = 8;
        G.crimeWitnessed(v.pos.x, v.pos.z, 0.5);
      }
      G.audio.punch();
    }
    this.inCar = v;
    v.driver = 'player';
    v.keep = true;
    v.setOccupied(false);
    v.siren = false;
    if (v.parkSpot) {
      v.parkSpot.used = false;
      v.parkSpot = null;
    }
    // seat our model in the car
    v.root.add(this.model.root);
    poseSeated(this.model);
    this.model.root.position.set(v.seatX ?? 0.4, v.seatY ?? 0.05, v.cabinZ + 0.1);
    this.model.root.rotation.set(0, 0, 0);
    this.model.root.scale.setScalar(0.92 * (this.charScale || 1));
    this.model.root.traverse((o) => { o.castShadow = false; });
    G.hud.notify(v.spec.name, 1.6, true);
    G.onEnterVehicle?.(v);
    return true;
  }

  exitCar(force = false) {
    const v = this.inCar;
    if (!v) return;
    if (!force && Math.abs(v.speed) > 6) return;
    const G = this.G;
    v.driver = null;
    v.keep = false;
    v.input.throttle = 0;
    v.input.steer = 0;
    v.input.handbrake = true;
    this.inCar = null;
    v.root.remove(this.model.root);
    G.scene.add(this.model.root);
    this.model.root.scale.setScalar(this.charScale || 1);
    this.model.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    const lx = Math.cos(v.heading), lz = -Math.sin(v.heading);
    const off = v.spec.wid / 2 + 0.8;
    const p = { x: v.pos.x + lx * off, z: v.pos.z + lz * off };
    G.world.collideCircle(p, 0.4, 1);
    if (Math.hypot(p.x - (v.pos.x + lx * off), p.z - (v.pos.z + lz * off)) > 0.5) {
      p.x = v.pos.x - lx * off;
      p.z = v.pos.z - lz * off;
    }
    this.pos.set(p.x, G.world.groundHeight(p.x, p.z), p.z);
    this.vel.set(v.vel.x * 0.3, 0, v.vel.z * 0.3);
    this.heading = v.heading;
  }

  // ---- combat ----
  muzzlePoint() {
    if (this.inCar) {
      const v = this.inCar;
      const lx = Math.cos(v.heading), lz = -Math.sin(v.heading);
      return new THREE.Vector3(v.pos.x + lx * 1.2, v.pos.y + 1.3, v.pos.z + lz * 1.2);
    }
    const f = { x: Math.sin(this.heading), z: Math.cos(this.heading) };
    const r = { x: -f.z, z: f.x };
    return new THREE.Vector3(this.pos.x + f.x * 0.6 + r.x * 0.36, this.pos.y + 1.5, this.pos.z + f.z * 0.6 + r.z * 0.36);
  }

  fire() {
    const G = this.G;
    const def = this.weapon;
    if (this.cooldown > 0 || this.reloadT > 0) return;
    if (def.melee) {
      if (this.inCar) return;
      this.cooldown = def.rate;
      this.punchT = 0.25;
      this.heading = G.camYaw;
      const f = { x: Math.sin(this.heading), z: Math.cos(this.heading) };
      let best = null, bd = def.reach;
      for (const p of G.peds.list) {
        if (!p.alive) continue;
        const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < bd && (dx * f.x + dz * f.z) / (d || 1) > 0.4) { bd = d; best = p; }
      }
      if (best) {
        G.audio.punch();
        if (best.kind === 'cop') G.wanted.addHeat(0, 1);
        best.takeDamage(def.dmg, 'player', best.pos.x, best.pos.y + 1.5, best.pos.z);
        if (best.alive && (def.knock || Math.random() < 0.4)) {
          best.state = 'knocked';
          best.timer = 1.6;
          best.model.body.rotation.x = -Math.PI / 2;
          best.model.body.position.y = 0.25;
        }
        G.crimeWitnessed(best.pos.x, best.pos.z, 0);
      }
      return;
    }
    const w = this.weapons[this.cur];
    if (!w || w.clip <= 0) {
      if (w && w.ammo > 0) this.reload();
      else {
        G.audio.click();
        this.cooldown = 0.3;
      }
      return;
    }
    if (this.inCar && def.heavy) return;
    w.clip--;
    this.cooldown = def.rate;
    if (!this.inCar) {
      this.heading = G.camYaw;
      this.faceAimT = 0.8;
    }
    const cam = G.camera;
    const origin = cam.position.clone();
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    const muzzle = this.muzzlePoint();
    if (def.throwable || def.rocket) {
      // aim point = whatever the crosshair is on, then launch from the hand toward it
      const r = G.world.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, 200);
      let tAim = r.hit ? r.t : 200;
      const tMin = muzzle.clone().sub(origin).dot(dir);
      for (const v of G.vehicles) {
        if (v === this.inCar) continue;
        const t = rayVehicle(v, origin.x, origin.y, origin.z, dir.x, dir.y, dir.z);
        if (t > tMin && t < tAim) tAim = t;
      }
      for (const ped of G.peds.list) {
        const h = ped.alive && ped.rayHit(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z);
        if (h && h.t > tMin && h.t < tAim) tAim = h.t;
      }
      const target = origin.clone().addScaledVector(dir, tAim);
      const aim = target.sub(muzzle).normalize();
      if (def.throwable) {
        G.projectiles.grenade(muzzle, aim.multiplyScalar(19).add(new THREE.Vector3(0, 5, 0)));
        this.punchT = 0.25;
      } else {
        G.projectiles.rocket(muzzle, aim);
        G.audio.gunshot(0.8, true);
        G.onGunfire(this.pos.x, this.pos.z);
      }
      if (w.clip === 0 && w.ammo > 0) this.reload(true);
      return;
    }
    // start the ray at the player's depth so we don't hit things behind us
    const tMin = Math.max(0, muzzle.clone().sub(origin).dot(dir) - 0.5);
    const pellets = def.pellets || 1;
    for (let k = 0; k < pellets; k++) {
      const d = dir.clone();
      d.x += rand(-1, 1) * def.spread;
      d.y += rand(-1, 1) * def.spread;
      d.z += rand(-1, 1) * def.spread;
      d.normalize();
      this.castBullet(origin, d, tMin, def, muzzle);
    }
    G.fx.muzzle(muzzle.x, muzzle.y, muzzle.z);
    G.audio.gunshot(1, def.heavy);
    G.onGunfire(this.pos.x, this.pos.z);
    if (w.clip === 0 && w.ammo > 0) this.reload();
  }

  castBullet(o, d, tMin, def, muzzle) {
    const G = this.G;
    let best = def.range, hit = null;
    const wr = G.world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, def.range);
    if (wr.hit && wr.t > tMin) {
      best = wr.t;
      hit = { type: 'world', normal: wr.normal };
    }
    for (const p of G.peds.list) {
      if (!p.alive) continue;
      const r = p.rayHit(o.x, o.y, o.z, d.x, d.y, d.z);
      if (r && r.t > tMin && r.t < best) {
        best = r.t;
        hit = { type: 'ped', ped: p, part: r.part };
      }
    }
    for (const v of G.vehicles) {
      if (v === this.inCar) continue;
      const dx = v.pos.x - o.x, dz = v.pos.z - o.z;
      if (dx * dx + dz * dz > (best + 5) * (best + 5)) continue;
      const t = rayVehicle(v, o.x, o.y, o.z, d.x, d.y, d.z);
      if (t > tMin && t < best) {
        best = t;
        hit = { type: 'vehicle', v };
      }
    }
    const prop = G.areas.rayHit(o, d, best);
    if (prop && prop.t > tMin) {
      best = prop.t;
      hit = { type: 'prop', obj: prop.obj };
    }
    const heli = G.police.heli;
    if (heli) {
      const r = heli.rayHit(o.x, o.y, o.z, d.x, d.y, d.z);
      if (r && r.t > tMin && r.t < best) {
        best = r.t;
        hit = { type: 'heli' };
      }
    }
    const hx = o.x + d.x * best, hy = o.y + d.y * best, hz = o.z + d.z * best;
    G.fx.tracer(muzzle.x, muzzle.y, muzzle.z, hx, hy, hz);
    if (!hit) return;
    if (hit.type === 'world') G.fx.sparks(hx, hy, hz, 3, 0xd8d0c0);
    else if (hit.type === 'ped') {
      const p = hit.ped;
      const dmg = hit.part === 'head' ? def.dmg * 4 : def.dmg;
      if (p.kind === 'cop') G.wanted.addHeat(0, 2);
      p.takeDamage(dmg, 'player', hx, hy, hz);
    } else if (hit.type === 'vehicle') {
      G.fx.sparks(hx, hy, hz, 4);
      hit.v.damage(def.dmg * 1.6, G, 'player');
      if (hit.v.isPolice) G.wanted.addHeat(0.1, 1);
      if (hit.v.driver instanceof TrafficAI) hit.v.driver.panicT = 10;
    } else if (hit.type === 'prop') {
      G.areas.damageProp(hit.obj, def.dmg, 'player');
    } else if (hit.type === 'heli') {
      heli.damage(def.dmg);
    }
  }

  // ---- per-frame ----
  update(dt) {
    const G = this.G;
    const inp = G.input;
    this.cooldown -= dt;
    if (!this.arrestTouched) this.arrestT = Math.max(0, this.arrestT - dt);
    this.arrestTouched = false;
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) this.reload(true);
    }
    if (!this.alive) return;

    // weapon switching
    if (inp.mouse.wheel && !G.wheelOpen) this.cycleWeapon(inp.mouse.wheel > 0 ? 1 : -1);
    WEAPON_ORDER.forEach((k, i) => {
      if (inp.hit('Digit' + (i + 1)) && this.weapons[k]) {
        this.cur = k;
        this.reloadT = 0;
      }
    });
    if (inp.hit('KeyR')) this.reload();

    if (this.inCar) {
      this.updateDriving(dt);
      return;
    }

    if (inp.hit('KeyF') && this.knockT <= 0) {
      if (this.tryEnterCar()) return;
    }

    // knocked down by a car
    if (this.knockT > 0) {
      this.knockT -= dt;
      this.pos.addScaledVector(this.vel, dt);
      this.vel.multiplyScalar(Math.exp(-3 * dt));
      G.world.collideCircle(this.pos, 0.4, 1);
      if (this.knockT <= 0) {
        this.model.body.rotation.set(0, 0, 0);
      }
      this.model.root.position.copy(this.pos);
      return;
    }

    // movement
    const yaw = G.camYaw;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const rx = -fz, rz = fx;
    const fwd = inp.axis('KeyS', 'KeyW');
    const str = inp.axis('KeyA', 'KeyD');
    let mx = fx * fwd + rx * str, mz = fz * fwd + rz * str;
    const ml = Math.hypot(mx, mz);
    if (ml > 0) { mx /= ml; mz /= ml; }
    this.aiming = inp.mouse.right && !this.weapon.melee;
    const sprint = inp.down('ShiftLeft') || inp.down('ShiftRight');
    const sp = this.aiming ? 3 : sprint ? 7.6 : 4.4;
    const accel = this.grounded ? 12 : 3;
    this.vel.x += (mx * sp - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (mz * sp - this.vel.z) * Math.min(1, accel * dt);

    // jump / gravity
    const gy = G.world.groundHeight(this.pos.x, this.pos.z);
    if (this.grounded && inp.hit('Space')) {
      this.vel.y = 6.5;
      this.grounded = false;
    }
    this.vel.y -= 20 * dt;
    this.pos.addScaledVector(this.vel, dt);
    if (this.pos.y <= gy) {
      this.pos.y = gy;
      this.vel.y = 0;
      this.grounded = true;
    } else if (this.pos.y - gy > 0.05 && this.vel.y < 0 && this.pos.y - gy < 0.2 && this.grounded) {
      this.pos.y = gy; // step down curbs smoothly
    }
    G.world.collideCircle(this.pos, 0.4, this.pos.y + 0.5);
    // vehicles block us / hit us
    for (const v of G.vehicles) {
      const dx0 = this.pos.x - v.pos.x, dz0 = this.pos.z - v.pos.z;
      if (dx0 * dx0 + dz0 * dz0 > 20) continue;
      for (const c of v.circles()) {
        const dx = this.pos.x - c.x, dz = this.pos.z - c.z;
        const d = Math.hypot(dx, dz);
        const min = c.r + 0.4;
        if (d >= min || d < 1e-4) continue;
        const nx = dx / d, nz = dz / d;
        const vs = Math.hypot(v.vel.x, v.vel.z);
        if (vs > 6) {
          this.takeDamage(vs * 2.2);
          this.knockT = 1.3;
          this.vel.set(v.vel.x * 0.8 + nx * 3, 0, v.vel.z * 0.8 + nz * 3);
          this.model.body.rotation.x = -Math.PI / 2;
          this.model.body.position.y = 0.25;
          G.audio.crash(0.5);
        } else if (this.pos.y < 1.2) {
          this.pos.x += nx * (min - d);
          this.pos.z += nz * (min - d);
        }
        break;
      }
    }
    this.speed = Math.hypot(this.vel.x, this.vel.z);

    // facing
    this.faceAimT -= dt;
    if (this.aiming || this.faceAimT > 0) this.heading = yaw;
    else if (ml > 0) this.heading += wrapAngle(headingTo(mx, mz) - this.heading) * Math.min(1, dt * 12);

    // shooting
    const def = this.weapon;
    if (inp.mouse.leftPressed || (def.auto && inp.mouse.left)) this.fire();

    // model
    const m = this.model;
    m.root.position.copy(this.pos);
    m.root.rotation.y = this.heading;
    animateCharacter(m, dt, this.grounded ? this.speed : 0, (this.aiming || this.faceAimT > 0) && !def.melee);
    m.gun.visible = !def.melee;
    if (this.punchT > 0) {
      this.punchT -= dt;
      m.armR.rotation.x = -Math.PI / 2 * Math.sin((this.punchT / 0.25) * Math.PI);
    }
    if (!this.grounded) {
      m.legL.rotation.x = -0.6;
      m.legR.rotation.x = 0.3;
    }
  }

  updateDriving(dt) {
    const G = this.G;
    const inp = G.input;
    const v = this.inCar;
    if (this.inputLocked) {
      v.input.throttle = 0;
      v.input.steer = 0;
      v.input.handbrake = true;
      return;
    }
    if (inp.hit('KeyF')) {
      this.exitCar();
      if (!this.inCar) return;
    }
    v.input.throttle = inp.axis('KeyS', 'KeyW');
    v.input.steer = -inp.axis('KeyA', 'KeyD');
    v.input.handbrake = inp.down('Space');
    this.horn = inp.down('KeyH');
    if (this.horn) {
      for (const p of G.peds.list) {
        if (p.alive && p.state === 'walk' && p.pos.distanceTo(v.pos) < 12) p.panic(v.pos.x, v.pos.z, 3);
      }
    }
    if (v.isPolice && inp.hit('KeyG')) v.siren = !v.siren;
    this.pos.copy(v.pos);
    this.speed = Math.abs(v.speed);
    if (!v.alive) {
      // car is burning: bail out!
      this.exitCar(true);
      return;
    }
    if (v.burnTimer >= 0 && v.burnTimer < 1.5) {
      this.exitCar(true);
      G.hud.notify('Bail out!');
    }
    // drive-by shooting
    const def = this.weapon;
    if (!def.melee && !def.heavy && (inp.mouse.leftPressed || (def.auto && inp.mouse.left))) this.fire();
  }

  // Thrown over the handlebars in a bike crash.
  ejectFromBike(v) {
    const speed = Math.hypot(v.vel.x, v.vel.z);
    this.exitCar(true);
    this.knockT = 1.6;
    this.vel.set(v.vel.x * 0.6, 0, v.vel.z * 0.6);
    this.model.body.rotation.x = -Math.PI / 2;
    this.model.body.position.y = 0.25;
    this.takeDamage(Math.min(40, speed * 1.2));
    this.G.hud.notify('Thrown off the bike!', 2);
  }

  // Swap the visible model for a different character's look.
  setLook(c) {
    const G = this.G;
    const parent = this.model.root.parent;
    parent?.remove(this.model.root);
    this.model = makeCharacter(c.look);
    this.charScale = c.scale || 1;
    this.model.root.scale.setScalar(this.charScale);
    G.scene.add(this.model.root);
  }

  respawnAt(x, z, heading) {
    this.alive = true;
    this.health = 100;
    this.armor = 0;
    this.knockT = 0;
    this.arrestT = 0;
    this.pos.set(x, this.G.world.groundHeight(x, z), z);
    this.vel.set(0, 0, 0);
    this.heading = heading ?? 0;
    const m = this.model;
    m.body.rotation.set(0, 0, 0);
    m.armL.rotation.set(0, 0, 0);
    m.armR.rotation.set(0, 0, 0);
    m.body.position.y = 0.92;
    m.root.position.copy(this.pos);
  }
}

export { clamp };
