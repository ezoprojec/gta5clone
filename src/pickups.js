// Pickups (cash, health, armor, weapons) and gun-shop counters.
import * as THREE from 'three';
import { formatMoney } from './util.js';
import { BEACH_Z } from './world.js';

const geo = {
  cross1: new THREE.BoxGeometry(0.7, 0.22, 0.22),
  cross2: new THREE.BoxGeometry(0.22, 0.7, 0.22),
  shield: new THREE.CylinderGeometry(0.38, 0.38, 0.14, 6).rotateX(Math.PI / 2),
  cash: new THREE.BoxGeometry(0.5, 0.28, 0.3),
  gun: new THREE.BoxGeometry(0.16, 0.22, 0.75),
  ring: new THREE.RingGeometry(0.7, 0.9, 24).rotateX(-Math.PI / 2),
  shop: new THREE.CylinderGeometry(1.1, 1.1, 0.12, 24),
};
const M = (c, e = 0.6) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: e, roughness: 0.4 });
const mats = {
  health: M(0x30e060), armor: M(0x3090ff), cash: M(0x40c040, 0.3), gun: M(0x9a9aa8, 0.25),
  ring: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
  shop: new THREE.MeshBasicMaterial({ color: 0xff4040, transparent: true, opacity: 0.45 }),
};

export class Pickups {
  constructor(G) {
    this.G = G;
    this.list = [];
  }

  add(o) {
    const g = new THREE.Group();
    const y = 0.9;
    if (o.type === 'health') {
      const a = new THREE.Mesh(geo.cross1, mats.health), b = new THREE.Mesh(geo.cross2, mats.health);
      g.add(a, b);
    } else if (o.type === 'armor') g.add(new THREE.Mesh(geo.shield, mats.armor));
    else if (o.type === 'cash') g.add(new THREE.Mesh(geo.cash, mats.cash));
    else if (o.type === 'weapon' || o.type === 'ammo') g.add(new THREE.Mesh(geo.gun, mats.gun));
    else if (o.type === 'shop') {
      const disk = new THREE.Mesh(geo.shop, mats.shop);
      disk.position.y = -0.85;
      g.add(disk);
      const icon = new THREE.Mesh(o.item === 'armor' ? geo.shield : geo.gun, o.item === 'armor' ? mats.armor : mats.gun);
      g.add(icon);
    }
    if (o.type !== 'shop') {
      const ring = new THREE.Mesh(geo.ring, mats.ring);
      ring.position.y = -0.8;
      g.add(ring);
    }
    const gy = this.G.world.groundHeight(o.x, o.z);
    g.position.set(o.x, gy + y, o.z);
    this.G.scene.add(g);
    const p = { ...o, mesh: g, active: true, timer: 0, life: o.life ?? Infinity };
    this.list.push(p);
    return p;
  }

  spawnCash(x, z, amount) {
    this.add({ type: 'cash', x, z, amount, life: 30 });
  }

  setupFixed() {
    const W = this.G.world;
    for (const b of W.blocks) {
      if (b.type === 'park' && b.fountain) this.add({ type: 'health', x: b.fountain.x + 6, z: b.fountain.z + 6, respawn: 60 });
    }
    // armor & weapon stashes around town
    const stash = [
      { type: 'armor', block: [3, 3] }, { type: 'armor', block: [7, 6] },
      { type: 'weapon', weapon: 'smg', ammo: 90, block: [5, 2] },
      { type: 'weapon', weapon: 'shotgun', ammo: 18, block: [2, 8] },
      { type: 'weapon', weapon: 'pistol', ammo: 36, block: [8, 5] },
      { type: 'cash', amount: 250, block: [0, 9], respawn: 120 },
      { type: 'cash', amount: 250, block: [9, 0], respawn: 120 },
    ];
    for (const s of stash) {
      const b = W.getBlock(s.block[0], s.block[1]);
      this.add({ ...s, x: b.x0 + 2.5, z: b.z0 + 2.5, respawn: s.respawn ?? 90 });
    }
    // beach shotgun
    this.add({ type: 'weapon', weapon: 'shotgun', ammo: 12, x: 40, z: BEACH_Z + 20, respawn: 120 });
    // gun shop counters
    const gs = W.landmarks.gunshop;
    if (gs) {
      const items = [
        { item: 'pistol', label: 'Pistol ammo x48', price: 150 },
        { item: 'smg', label: 'SMG + 120 rounds', price: 900 },
        { item: 'shotgun', label: 'Shotgun + 24 shells', price: 1300 },
        { item: 'armor', label: 'Body armor', price: 350 },
      ];
      items.forEach((it, k) => this.add({ type: 'shop', ...it, x: gs.x - 9 + k * 6, z: gs.z - 7 }));
    }
  }

  update(dt) {
    const G = this.G;
    const pl = G.player;
    const pp = pl.inCar ? pl.inCar.pos : pl.pos;
    let prompt = null;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      if (!p.active) {
        p.timer -= dt;
        if (p.timer <= 0) {
          p.active = true;
          p.mesh.visible = true;
        }
        continue;
      }
      p.life -= dt;
      if (p.life <= 0) {
        G.scene.remove(p.mesh);
        this.list.splice(i, 1);
        continue;
      }
      if (p.type !== 'shop') {
        p.mesh.children[0].rotation.y += dt * 2;
        if (p.mesh.children[1] && p.type === 'health') p.mesh.children[1].rotation.y = p.mesh.children[0].rotation.y;
      } else p.mesh.children[1].rotation.y += dt * 1.5;
      if (!pl.alive) continue;
      const d = Math.hypot(p.x - pp.x, p.z - pp.z);
      const reach = pl.inCar ? 2.6 : 1.3;
      if (d > reach) continue;
      if (p.type === 'shop') {
        if (pl.inCar) continue;
        prompt = `Press E to buy ${p.label} — ${formatMoney(p.price)}`;
        if (G.input.hit('KeyE')) {
          if (pl.money < p.price) {
            G.hud.notify("You can't afford that.");
          } else {
            pl.money -= p.price;
            if (p.item === 'armor') pl.armor = 100;
            else pl.giveWeapon(p.item, p.item === 'pistol' ? 48 : p.item === 'smg' ? 120 : 24);
            G.audio.pickup();
            G.hud.notify(`Purchased: ${p.label}`);
          }
        }
        continue;
      }
      let taken = true;
      if (p.type === 'health') {
        if (pl.health >= 100) taken = false;
        else pl.health = Math.min(100, pl.health + 50);
      } else if (p.type === 'armor') {
        if (pl.armor >= 100) taken = false;
        else pl.armor = 100;
      } else if (p.type === 'cash') {
        pl.money += p.amount;
        G.hud.moneyPop(p.amount);
      } else if (p.type === 'weapon' || p.type === 'ammo') {
        pl.giveWeapon(p.weapon, p.ammo);
        G.hud.notify(`Picked up ${p.weapon.toUpperCase()}`);
      }
      if (!taken) continue;
      G.audio.pickup();
      if (p.respawn) {
        p.active = false;
        p.timer = p.respawn;
        p.mesh.visible = false;
      } else {
        G.scene.remove(p.mesh);
        this.list.splice(i, 1);
      }
    }
    if (prompt) G.hud.prompt(prompt);
  }
}
