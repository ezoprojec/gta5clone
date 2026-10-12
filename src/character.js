// Blocky humanoid model with a simple procedural walk cycle.
import * as THREE from 'three';
import { pick } from './util.js';

const matCache = new Map();
export function mat(color, extra) {
  const key = color + (extra ? JSON.stringify(extra) : '');
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...(extra || {}) });
    matCache.set(key, m);
  }
  return m;
}

const G = {
  leg: new THREE.BoxGeometry(0.22, 0.9, 0.24).translate(0, -0.45, 0),
  torso: new THREE.BoxGeometry(0.56, 0.66, 0.3).translate(0, 0.33, 0),
  head: new THREE.BoxGeometry(0.3, 0.32, 0.3),
  hair: new THREE.BoxGeometry(0.32, 0.1, 0.32),
  hand: new THREE.BoxGeometry(0.13, 0.12, 0.13),
  cap: new THREE.BoxGeometry(0.34, 0.08, 0.42),
  shoe: new THREE.BoxGeometry(0.22, 0.1, 0.32),
  gun: new THREE.BoxGeometry(0.08, 0.12, 0.34),
  belt: new THREE.BoxGeometry(0.58, 0.08, 0.32),
  eye: new THREE.BoxGeometry(0.05, 0.04, 0.02),
  neck: new THREE.BoxGeometry(0.14, 0.1, 0.14),
  upper: new THREE.BoxGeometry(0.16, 0.36, 0.18).translate(0, -0.16, 0),
  lower: new THREE.BoxGeometry(0.14, 0.34, 0.16).translate(0, -0.5, 0),
  hairLong: new THREE.BoxGeometry(0.33, 0.36, 0.1),
  bun: new THREE.BoxGeometry(0.14, 0.12, 0.12),
  panel: new THREE.BoxGeometry(0.2, 0.62, 0.04),
  collar: new THREE.BoxGeometry(0.4, 0.06, 0.32),
  mouth: new THREE.BoxGeometry(0.1, 0.025, 0.02),
  nose: new THREE.BoxGeometry(0.05, 0.07, 0.04),
};

export const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0x6b4226];
export const SHIRTS = [0xd94848, 0x3b6fd9, 0x40a860, 0xe0c040, 0xffffff, 0x222222, 0x9050c0, 0xf08030, 0x50b0c0, 0xc06090];
export const PANTS = [0x2a3a5a, 0x222222, 0x6b5a40, 0x3a3a3a, 0x8a7a60, 0x4a5a70];
export const HAIR = [0x1a1a1a, 0x4a3020, 0x8a6030, 0xd0b060, 0x606060];

export const SHOES = [0x1c1c1c, 0xeeeeee, 0x6b4a2f, 0x2a3a6a, 0xb03030];
export function randomLook() {
  const slim = Math.random() < 0.45;
  return {
    skin: pick(SKIN), shirt: pick(SHIRTS), pants: pick(PANTS), hair: pick(HAIR), shoes: pick(SHOES),
    cap: Math.random() < 0.18 ? pick(SHIRTS) : null,
    slim,
    hairStyle: slim ? pick(['long', 'long', 'bun', 'short']) : pick(['short', 'short', 'short', 'bald', 'long']),
    shortSleeve: Math.random() < 0.45,
    jacket: Math.random() < 0.25 ? pick([0x2a2a2a, 0x5a3a22, 0x24324a, 0x6a6a6a]) : null,
  };
}

export function makeCharacter(look) {
  const root = new THREE.Group();
  const body = new THREE.Group(); // pivot at hips so we can tilt/fall
  body.position.y = 0.92;
  root.add(body);

  const mesh = (geo, color, x, y, z, parent) => {
    const m = new THREE.Mesh(geo, mat(color));
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  const legL = new THREE.Group(); legL.position.set(-0.13, 0, 0); body.add(legL);
  const legR = new THREE.Group(); legR.position.set(0.13, 0, 0); body.add(legR);
  mesh(G.leg, look.pants, 0, 0, 0, legL);
  mesh(G.leg, look.pants, 0, 0, 0, legR);
  mesh(G.shoe, look.shoes ?? 0x1c1c1c, 0, -0.87, 0.04, legL);
  mesh(G.shoe, look.shoes ?? 0x1c1c1c, 0, -0.87, 0.04, legR);
  const torso = mesh(G.torso, look.shirt, 0, 0, 0, body);
  if (look.slim) torso.scale.set(0.86, 1, 0.92);
  if (look.belt) mesh(G.belt, look.belt, 0, 0.03, 0, body);
  if (look.jacket) {
    // open jacket: side panels + collar over the shirt
    mesh(G.panel, look.jacket, -0.19, 0.33, 0.14, body);
    mesh(G.panel, look.jacket, 0.19, 0.33, 0.14, body);
    mesh(G.collar, look.jacket, 0, 0.64, 0, body);
  }
  mesh(G.neck, look.skin, 0, 0.7, 0, body);
  const head = mesh(G.head, look.skin, 0, 0.84, 0, body);
  if (look.hairStyle !== 'bald') mesh(G.hair, look.hair, 0, 0.16, 0, head);
  if (look.hairStyle === 'long') mesh(G.hairLong, look.hair, 0, -0.02, -0.12, head);
  if (look.hairStyle === 'bun') mesh(G.bun, look.hair, 0, 0.15, -0.17, head);
  mesh(G.nose, look.skin, 0, -0.02, 0.165, head).castShadow = false;
  mesh(G.mouth, 0x6a3030, 0, -0.09, 0.155, head).castShadow = false;
  if (look.cap) {
    const c = mesh(G.cap, look.cap, 0, 0.19, 0.04, head);
    c.castShadow = false;
  }
  // eyes
  const eyeGeo = G.eye;
  mesh(eyeGeo, 0x111111, -0.07, 0.03, 0.155, head).castShadow = false;
  mesh(eyeGeo, 0x111111, 0.07, 0.03, 0.155, head).castShadow = false;

  const sh = look.slim ? 0.32 : 0.36;
  const armL = new THREE.Group(); armL.position.set(-sh, 0.6, 0); body.add(armL);
  const armR = new THREE.Group(); armR.position.set(sh, 0.6, 0); body.add(armR);
  const sleeve = look.jacket ?? look.sleeve ?? look.shirt;
  const fore = look.shortSleeve && !look.jacket ? look.skin : sleeve;
  for (const arm of [armL, armR]) {
    mesh(G.upper, sleeve, 0, 0, 0, arm);
    mesh(G.lower, fore, 0, 0, 0, arm);
  }
  mesh(G.hand, look.skin, 0, -0.7, 0, armL);
  mesh(G.hand, look.skin, 0, -0.7, 0, armR);
  const gun = mesh(G.gun, 0x202020, 0, -0.72, 0.12, armR);
  gun.visible = false;

  return { root, body, legL, legR, armL, armR, head, torso, gun, phase: Math.random() * 6 };
}

// speed: horizontal speed in m/s. aim: arm raised pose.
export function animateCharacter(c, dt, speed, aim = false, crouch = false) {
  const amt = Math.min(1, speed / 6);
  c.phase += dt * (2 + speed * 1.6);
  const s = Math.sin(c.phase) * 0.9 * amt;
  c.legL.rotation.x = s;
  c.legR.rotation.x = -s;
  c.armL.rotation.x = -s * 0.8;
  c.body.position.y = 0.92 + Math.abs(Math.cos(c.phase)) * 0.05 * amt - (crouch ? 0.35 : 0);
  if (crouch) {
    c.legL.rotation.x = -1.2;
    c.legR.rotation.x = -1.2;
    c.armL.rotation.x = -2.4;
    c.armR.rotation.x = -2.4;
    c.body.rotation.x = 0.3;
    return;
  }
  c.body.rotation.x = 0;
  if (aim) {
    c.armR.rotation.x = -Math.PI / 2;
    c.armR.rotation.z = 0;
  } else {
    c.armR.rotation.x = s * 0.8;
  }
}

export function poseDead(c) {
  c.body.rotation.set(-Math.PI / 2, 0, 0);
  c.body.position.y = 0.2;
  c.legL.rotation.x = 0.1;
  c.legR.rotation.x = -0.2;
  c.armL.rotation.set(0, 0, 1.2);
  c.armR.rotation.set(0, 0, -1.2);
}

// Seated pose for drivers.
export function poseSeated(c) {
  c.legL.rotation.x = -1.5;
  c.legR.rotation.x = -1.5;
  c.armL.rotation.x = -1.1;
  c.armR.rotation.x = -1.1;
  c.body.position.y = 0.5;
}
