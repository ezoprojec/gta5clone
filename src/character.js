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
  arm: new THREE.BoxGeometry(0.15, 0.68, 0.17).translate(0, -0.32, 0),
  hand: new THREE.BoxGeometry(0.13, 0.12, 0.13),
  cap: new THREE.BoxGeometry(0.34, 0.08, 0.42),
  shoe: new THREE.BoxGeometry(0.22, 0.1, 0.32),
  gun: new THREE.BoxGeometry(0.08, 0.12, 0.34),
  belt: new THREE.BoxGeometry(0.58, 0.08, 0.32),
  eye: new THREE.BoxGeometry(0.05, 0.04, 0.02),
};

export const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0x6b4226];
export const SHIRTS = [0xd94848, 0x3b6fd9, 0x40a860, 0xe0c040, 0xffffff, 0x222222, 0x9050c0, 0xf08030, 0x50b0c0, 0xc06090];
export const PANTS = [0x2a3a5a, 0x222222, 0x6b5a40, 0x3a3a3a, 0x8a7a60, 0x4a5a70];
export const HAIR = [0x1a1a1a, 0x4a3020, 0x8a6030, 0xd0b060, 0x606060];

export function randomLook() {
  return { skin: pick(SKIN), shirt: pick(SHIRTS), pants: pick(PANTS), hair: pick(HAIR), cap: Math.random() < 0.2 ? pick(SHIRTS) : null };
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
  mesh(G.shoe, 0x1c1c1c, 0, -0.87, 0.04, legL);
  mesh(G.shoe, 0x1c1c1c, 0, -0.87, 0.04, legR);
  const torso = mesh(G.torso, look.shirt, 0, 0, 0, body);
  if (look.belt) mesh(G.belt, look.belt, 0, 0.03, 0, body);
  const head = mesh(G.head, look.skin, 0, 0.84, 0, body);
  mesh(G.hair, look.hair, 0, 0.16, 0, head);
  if (look.cap) {
    const c = mesh(G.cap, look.cap, 0, 0.19, 0.04, head);
    c.castShadow = false;
  }
  // eyes
  const eyeGeo = G.eye;
  mesh(eyeGeo, 0x111111, -0.07, 0.03, 0.155, head).castShadow = false;
  mesh(eyeGeo, 0x111111, 0.07, 0.03, 0.155, head).castShadow = false;

  const armL = new THREE.Group(); armL.position.set(-0.36, 0.6, 0); body.add(armL);
  const armR = new THREE.Group(); armR.position.set(0.36, 0.6, 0); body.add(armR);
  mesh(G.arm, look.sleeve ?? look.shirt, 0, 0, 0, armL);
  mesh(G.arm, look.sleeve ?? look.shirt, 0, 0, 0, armR);
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
