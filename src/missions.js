// Mission givers and three mission types: car theft, courier checkpoint run, and a hit.
import * as THREE from 'three';
import { Vehicle } from './vehicle.js';
import { N, CELL, HALF, sidewalkLoop, loopPoint } from './world.js';
import { formatMoney, rand, pick } from './util.js';

const markerGeo = new THREE.CylinderGeometry(1.4, 1.4, 2.4, 24, 1, true);
const arrowGeo = new THREE.ConeGeometry(0.5, 0.9, 4).rotateX(Math.PI);
const cpGeo = new THREE.CylinderGeometry(5, 5, 6, 32, 1, true);

function makeMarker(color, big = false) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(big ? cpGeo : markerGeo, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  m.position.y = big ? 3 : 1.2;
  g.add(m);
  if (!big) {
    const a = new THREE.Mesh(arrowGeo, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8 }));
    a.position.y = 3.2;
    g.add(a);
    g.userData.arrow = a;
  }
  return g;
}

const GIVERS = [
  { id: 'theft', name: 'Joyride', who: 'Dex', block: [3, 4], color: 0xffcc22,
    intro: "Dex: \"There's a Vortex GT sitting pretty across town. Bring it to my lockup without scratching it up.\"" },
  { id: 'courier', name: 'Courier Run', who: 'Mama Ruiz', block: [6, 5], color: 0x22ddff,
    intro: 'Mama Ruiz: "Package drops, six stops, no time to waste. Grab wheels and go!"' },
  { id: 'hit', name: 'Loose Ends', who: 'The Accountant', block: [4, 6], color: 0xff4444,
    intro: 'The Accountant: "A certain gentleman talks too much. He has bodyguards. Make it quiet... or don\'t."' },
];

export class Missions {
  constructor(G) {
    this.G = G;
    this.active = null;
    this.givers = GIVERS.map((g) => {
      const b = G.world.getBlock(g.block[0], g.block[1]);
      const x = b.x0 + 3, z = b.z1 - 3;
      const mk = makeMarker(g.color);
      mk.position.set(x, G.world.groundHeight(x, z), z);
      G.scene.add(mk);
      return { ...g, x, z, marker: mk, done: 0 };
    });
    this.cpMarker = makeMarker(0xffd020, true);
    this.cpMarker.visible = false;
    G.scene.add(this.cpMarker);
    this.cooldown = 0;
  }

  get blips() {
    const out = [];
    if (!this.active) {
      for (const g of this.givers) out.push({ x: g.x, z: g.z, color: '#' + g.color.toString(16).padStart(6, '0'), label: g.name[0], big: true });
    } else if (this.active.blip) {
      const b = this.active.blip();
      if (b) out.push({ ...b, objective: true });
    }
    return out;
  }

  update(dt) {
    const G = this.G;
    const t = G.time;
    for (const g of this.givers) {
      g.marker.visible = !this.active;
      g.marker.userData.arrow.position.y = 3.2 + Math.sin(t * 3) * 0.25;
      g.marker.userData.arrow.rotation.y += dt * 2;
    }
    this.cooldown -= dt;
    if (!this.active) {
      const pl = G.player;
      if (!pl.alive || pl.inCar) return;
      for (const g of this.givers) {
        if (Math.hypot(pl.pos.x - g.x, pl.pos.z - g.z) < 2) {
          if (G.wanted.stars > 0) {
            G.hud.prompt('Lose the cops before starting a mission.');
          } else {
            G.hud.prompt(`Press E to start mission: ${g.name}`);
            if (G.input.hit('KeyE') && this.cooldown <= 0) this.start(g);
          }
        }
      }
      return;
    }
    const res = this.active.update(dt);
    if (res === 'pass') this.pass();
    else if (res) this.fail(res);
  }

  start(g) {
    const G = this.G;
    const m = this['make_' + g.id](g);
    m.giver = g;
    this.active = m;
    G.hud.big(g.name, '', 2.5, '#ffcc22');
    G.hud.subtitle(g.intro, 6);
    G.audio.passed();
  }

  pass() {
    const G = this.G;
    const m = this.active;
    G.player.money += m.reward;
    m.giver.done++;
    m.cleanup?.(true);
    this.active = null;
    this.cpMarker.visible = false;
    G.hud.big('MISSION PASSED', formatMoney(m.reward), 4, '#ffcc22');
    G.hud.objective('');
    G.audio.passed();
    this.cooldown = 3;
    G.save();
  }

  fail(reason) {
    const G = this.G;
    const m = this.active;
    if (!m) return;
    m.cleanup?.(false);
    this.active = null;
    this.cpMarker.visible = false;
    G.hud.big('MISSION FAILED', reason, 4, '#ff4444');
    G.hud.objective('');
    G.audio.failed();
    this.cooldown = 3;
  }

  onPedKilled(p) {
    this.active?.onPedKilled?.(p);
  }

  // ---------------- mission: car theft ----------------
  make_theft() {
    const G = this.G;
    const garage = G.world.landmarks.garage;
    const spots = G.world.parkingSpots.filter((s) => !s.used && Math.hypot(s.x - garage.x, s.z - garage.z) > 300);
    const s = pick(spots);
    const car = new Vehicle('sports', 0xff7a00);
    car.place(s.x, s.z, s.h);
    car.mission = true;
    G.traffic.add(car);
    let stolen = false;
    this.cpMarker.visible = false;
    G.hud.objective('Steal the orange <b>Vortex GT</b>.');
    const mission = {
      reward: 1000,
      blip: () => (stolen && G.player.inCar === car ? { x: garage.x, z: garage.z, color: '#ffcc22' } : { x: car.pos.x, z: car.pos.z, color: '#3fa0ff' }),
      update: () => {
        if (!car.alive || car.burnTimer >= 0) return 'The car was destroyed.';
        if (G.player.inCar === car) {
          if (!stolen) {
            stolen = true;
            G.wanted.addHeat(0, 1);
            G.hud.notify('The alarm tripped! Lose the heat or just floor it.');
          }
          G.hud.objective(`Deliver the car to the <b>lockup garage</b>. Condition: ${Math.round((car.health / car.spec.health) * 100)}%`);
          this.cpMarker.visible = true;
          this.cpMarker.position.set(garage.x, 0, garage.z);
          if (Math.hypot(car.pos.x - garage.x, car.pos.z - garage.z) < 6 && Math.abs(car.speed) < 4) {
            if (G.wanted.stars > 0) G.hud.prompt('Lose the cops first — you\'ll lead them to the lockup!');
            else {
              mission.reward = 1000 + Math.round((car.health / car.spec.health) * 1000);
              return 'pass';
            }
          }
        } else {
          this.cpMarker.visible = false;
          G.hud.objective(stolen ? 'Get back in the <b>Vortex GT</b>.' : 'Steal the orange <b>Vortex GT</b>.');
        }
        return null;
      },
      cleanup: (ok) => {
        if (ok) {
          G.player.exitCar(true);
          G.traffic.remove(car);
        } else car.mission = false;
      },
    };
    return mission;
  }

  // ---------------- mission: courier checkpoints ----------------
  make_courier() {
    const G = this.G;
    const pts = [];
    let n = G.world.nearestNode(G.player.pos.x, G.player.pos.z);
    for (let k = 0; k < 6; k++) {
      let next;
      do {
        next = { i: Math.max(0, Math.min(N, n.i + Math.round(rand(-3, 3)))), j: Math.max(0, Math.min(N, n.j + Math.round(rand(-3, 3)))) };
      } while ((next.i === n.i && next.j === n.j) || Math.abs(next.i - n.i) + Math.abs(next.j - n.j) < 2);
      pts.push({ x: -HALF + next.i * CELL, z: -HALF + next.j * CELL });
      n = next;
    }
    let idx = 0;
    let time = 0;
    let started = false;
    G.hud.objective('Get in a <b>vehicle</b>.');
    return {
      reward: 1000,
      blip: () => (started ? { x: pts[idx].x, z: pts[idx].z, color: '#ffcc22' } : null),
      update: (dt) => {
        const pl = G.player;
        if (!started) {
          if (pl.inCar) {
            started = true;
            const p = pl.inCar.pos;
            time = Math.hypot(pts[0].x - p.x, pts[0].z - p.z) / 13 + 12;
          } else return null;
        }
        time -= dt;
        G.hud.timer(time);
        const cp = pts[idx];
        this.cpMarker.visible = true;
        this.cpMarker.position.set(cp.x, 0, cp.z);
        G.hud.objective(`Deliver package <b>${idx + 1}/6</b>.`);
        const p = pl.inCar ? pl.inCar.pos : pl.pos;
        if (Math.hypot(p.x - cp.x, p.z - cp.z) < 6) {
          idx++;
          G.audio.pickup();
          if (idx >= pts.length) return 'pass';
          time += Math.hypot(pts[idx].x - cp.x, pts[idx].z - cp.z) / 13 + 6;
        }
        if (time <= 0) return 'Out of time.';
        return null;
      },
      cleanup: () => G.hud.timer(null),
    };
  }

  // ---------------- mission: hit ----------------
  make_hit() {
    const G = this.G;
    const pp = G.player.pos;
    let block;
    do {
      block = G.world.getBlock(Math.floor(rand(0, N)), Math.floor(rand(0, N)));
    } while (Math.hypot((block.x0 + block.x1) / 2 - pp.x, (block.z0 + block.z1) / 2 - pp.z) < 180);
    const L = sidewalkLoop(block);
    const c = loopPoint(L, rand(0, L.len));
    const target = G.peds.spawnAt('target', c.x, c.z, 'idle');
    target.look = null;
    target.mission = true;
    target.health = 60;
    // recolour target in a sharp white suit
    target.model.torso.material = target.model.torso.material.clone();
    target.model.torso.material.color.setHex(0xf4f4f4);
    const guards = [];
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      const g = G.peds.spawnAt('guard', c.x + Math.sin(a) * 2.5, c.z + Math.cos(a) * 2.5, 'idle');
      g.idleFace = a;
      g.mission = true;
      guards.push(g);
    }
    let alerted = false;
    this.alert = () => {
      if (alerted) return;
      alerted = true;
      for (const g of guards) if (g.alive) g.state = 'hostile';
      if (target.alive) target.panic(G.player.pos.x, G.player.pos.z, 30);
      G.hud.notify('The target is running!');
    };
    G.onPedAttacked = (p) => {
      if (p === target || guards.includes(p)) this.alert();
    };
    G.hud.objective('Take out the <b>target</b> (white suit).');
    return {
      reward: 2500,
      blip: () => ({ x: target.pos.x, z: target.pos.z, color: '#ff3030' }),
      update: () => {
        if (!target.alive) return 'pass';
        const d = Math.hypot(target.pos.x - G.player.pos.x, target.pos.z - G.player.pos.z);
        if (alerted && d > 260) return 'The target got away.';
        return null;
      },
      onPedKilled: (p) => {
        if (p === target) G.wanted.addHeat(1, 2);
        else if (guards.includes(p)) this.alert();
      },
      cleanup: () => {
        G.onPedAttacked = null;
        for (const g of [target, ...guards]) {
          g.mission = false;
          if (g.alive && g.kind === 'guard') g.state = 'leave';
        }
      },
    };
  }
}
