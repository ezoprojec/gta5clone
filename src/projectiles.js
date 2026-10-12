// Thrown grenades (bounce, then explode on a fuse) and rockets (fly straight, explode on impact).
import * as THREE from 'three';
import { rayVehicle } from './vehicle.js';

const grenadeGeo = new THREE.SphereGeometry(0.14, 8, 6);
const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x3a4a2a, roughness: 0.6 });
const rocketGeo = new THREE.CylinderGeometry(0.08, 0.1, 0.8, 8).rotateX(Math.PI / 2);
const rocketMat = new THREE.MeshStandardMaterial({ color: 0x5a6a4a, metalness: 0.4 });

export class Projectiles {
  constructor(G) {
    this.G = G;
    this.list = [];
  }

  grenade(pos, vel) {
    const m = new THREE.Mesh(grenadeGeo, grenadeMat);
    m.position.copy(pos);
    m.castShadow = true;
    this.G.scene.add(m);
    this.list.push({ kind: 'grenade', m, pos: pos.clone(), vel: vel.clone(), fuse: 2.4 });
  }

  rocket(pos, dir) {
    const m = new THREE.Mesh(rocketGeo, rocketMat);
    m.position.copy(pos);
    m.lookAt(pos.clone().add(dir));
    this.G.scene.add(m);
    this.list.push({ kind: 'rocket', m, pos: pos.clone(), vel: dir.clone().multiplyScalar(70), life: 3 });
  }

  boom(p) {
    this.G.scene.remove(p.m);
    this.G.explosion(p.pos.x, Math.max(0.5, p.pos.y), p.pos.z, 'player');
  }

  update(dt) {
    const G = this.G;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      let done = false;
      if (p.kind === 'grenade') {
        p.vel.y -= 20 * dt;
        const next = p.pos.clone().addScaledVector(p.vel, dt);
        const gy = G.world.groundHeight(next.x, next.z) + 0.14;
        if (next.y < gy) {
          // bounce off the ground, losing energy
          next.y = gy;
          p.vel.y = Math.abs(p.vel.y) * 0.4;
          p.vel.x *= 0.6;
          p.vel.z *= 0.6;
        }
        const c = { x: next.x, z: next.z };
        const hit = G.world.collideCircle(c, 0.15, next.y);
        if (hit) {
          // bounce off walls
          const vn = p.vel.x * hit.nx + p.vel.z * hit.nz;
          p.vel.x -= 1.6 * vn * hit.nx;
          p.vel.z -= 1.6 * vn * hit.nz;
          next.x = c.x;
          next.z = c.z;
        }
        p.pos.copy(next);
        p.m.position.copy(p.pos);
        p.m.rotation.x += dt * 8;
        p.fuse -= dt;
        if (p.fuse <= 0) done = true;
      } else {
        // rocket: step along its path and check for anything in the way
        const step = p.vel.length() * dt;
        const dir = p.vel.clone().normalize();
        const r = G.world.raycast(p.pos.x, p.pos.y, p.pos.z, dir.x, dir.y, dir.z, step);
        let t = r.hit ? r.t : Infinity;
        for (const v of G.vehicles) {
          if (v === G.player.inCar) continue;
          if (v.pos.distanceToSquared(p.pos) > (step + 4) ** 2) continue;
          const tv = rayVehicle(v, p.pos.x, p.pos.y, p.pos.z, dir.x, dir.y, dir.z);
          if (tv < t && tv <= step) t = tv;
        }
        for (const ped of G.peds.list) {
          if (!ped.alive) continue;
          const hr = ped.rayHit(p.pos.x, p.pos.y, p.pos.z, dir.x, dir.y, dir.z);
          if (hr && hr.t < t && hr.t <= step) t = hr.t;
        }
        const heli = G.police.heli;
        if (heli) {
          const hr = heli.rayHit(p.pos.x, p.pos.y, p.pos.z, dir.x, dir.y, dir.z);
          if (hr && hr.t < t && hr.t <= step) {
            t = hr.t;
            heli.damage(1000);
          }
        }
        if (t <= step) {
          p.pos.addScaledVector(dir, t);
          done = true;
        } else {
          p.pos.addScaledVector(dir, step);
          p.m.position.copy(p.pos);
          G.fx.fire(p.pos.x - dir.x * 0.5, p.pos.y, p.pos.z - dir.z * 0.5);
          if (Math.random() < 0.6) G.fx.smoke(p.pos.x, p.pos.y, p.pos.z, 0.7);
        }
        p.life -= dt;
        if (p.life <= 0) done = true;
      }
      if (done) {
        this.boom(p);
        this.list.splice(i, 1);
      }
    }
  }
}
