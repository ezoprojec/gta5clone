// Neon Bay — entry point: renderer, game state, camera, main loop.
import * as THREE from 'three';
import { World } from './world.js';
import { Player } from './player.js';
import { PedManager } from './peds.js';
import { VehicleManager, TrafficAI } from './traffic.js';
import { Vehicle, setVehicleEnvIntensity } from './vehicle.js';
import { Details } from './details.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Wanted, PoliceManager, PoliceAI } from './police.js';
import { Pickups } from './pickups.js';
import { Missions } from './missions.js';
import { HUD } from './hud.js';
import { FX } from './fx.js';
import { Audio } from './audio.js';
import { Input } from './input.js';
import { clamp, lerp, smoothstep, wrapAngle, rand, formatMoney } from './util.js';

const params = new URLSearchParams(location.search);

// ---------------- renderer / scene ----------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xa8c8e8, 120, 520);
scene.background = new THREE.Color(0xa8c8e8);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 1500);

const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x5a5040, 0.8);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d8, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const SC = 90;
Object.assign(sun.shadow.camera, { left: -SC, right: SC, top: SC, bottom: -SC, near: 1, far: 500 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.05;
scene.add(sun, sun.target);
// player car headlight (only on at night)
const headlight = new THREE.SpotLight(0xfff2d0, 0, 70, 0.55, 0.5, 1.2);
scene.add(headlight, headlight.target);

// stars for the night sky
const starGeo = new THREE.BufferGeometry();
const sp = [];
for (let i = 0; i < 1500; i++) {
  const a = Math.random() * Math.PI * 2, e = Math.random() * 1.3 + 0.1;
  sp.push(Math.cos(a) * Math.cos(e) * 1200, Math.sin(e) * 1200, Math.sin(a) * Math.cos(e) * 1200);
}
starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false });
const starPts = new THREE.Points(starGeo, starMat);
scene.add(starPts);

// gradient sky dome with a sun glow
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
  uniforms: {
    top: { value: new THREE.Color(0x3a7bd5) }, horizon: { value: new THREE.Color(0xbfd8f0) }, ground: { value: new THREE.Color(0x6a7a88) },
    sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color(0xfff0c0) }, glow: { value: 1 },
  },
  vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }`,
  fragmentShader: `uniform vec3 top, horizon, ground, sunDir, sunCol; uniform float glow; varying vec3 vDir;
    void main(){
      float h = vDir.y;
      vec3 c = h > 0.0 ? mix(horizon, top, pow(min(h * 1.6, 1.0), 0.7)) : mix(horizon, ground, min(-h * 4.0, 1.0));
      float d = max(dot(normalize(vDir), sunDir), 0.0);
      c += sunCol * (pow(d, 600.0) * 2.5 + pow(d, 24.0) * 0.35 + pow(d, 4.0) * 0.12) * glow;
      gl_FragColor = vec4(c, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});
const skyDome = new THREE.Mesh(new THREE.SphereGeometry(1300, 32, 16), skyMat);
skyDome.frustumCulled = false;
skyDome.renderOrder = -1;
scene.add(skyDome);

// reflections for car paint, glass and glass towers
const pmrem = new THREE.PMREMGenerator(renderer);
const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
Vehicle.envMap = envTex;

// post-processing: bloom makes neon, lamps and headlights glow
// multisampled HDR target: keeps anti-aliasing and full depth precision under post-processing
const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 });
rt.depthTexture = new THREE.DepthTexture(innerWidth, innerHeight, THREE.FloatType);
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.4, 0.5, 0.85);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// graphics quality presets (O to cycle)
const QUALITY = [
  { name: 'Low', pr: 1, shadow: 1024, bloom: false },
  { name: 'Medium', pr: 1.25, shadow: 2048, bloom: true },
  { name: 'High', pr: 2, shadow: 4096, bloom: true },
];
let quality = 1;
try {
  const q = parseInt(localStorage.getItem('neonbay-quality'), 10);
  if (q >= 0 && q < QUALITY.length) quality = q;
} catch { /* storage unavailable */ }
if (params.has('low')) quality = 0;
function applyQuality() {
  const Q = QUALITY[quality];
  renderer.setPixelRatio(Math.min(devicePixelRatio, Q.pr));
  renderer.setSize(innerWidth, innerHeight);
  composer.setPixelRatio(Math.min(devicePixelRatio, Q.pr));
  composer.setSize(innerWidth, innerHeight);
  bloom.resolution.set(innerWidth / 2, innerHeight / 2);
  sun.shadow.mapSize.set(Q.shadow, Q.shadow);
  if (sun.shadow.map) {
    sun.shadow.map.dispose();
    sun.shadow.map = null;
  }
  try { localStorage.setItem('neonbay-quality', String(quality)); } catch { /* ignore */ }
}
applyQuality();

// sun / moon disc
const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(25, 16, 8), new THREE.MeshBasicMaterial({ color: 0xfff2c0, fog: false }));
scene.add(sunDisc);

// ---------------- game state ----------------
const G = {
  scene, camera, renderer,
  time: 0,
  hour: params.has('night') ? 22 : 15.5,
  night: 0,
  camYaw: 0,
  camPitch: -0.2,
  camShake: 0,
  paused: true,
  started: false,
  vehicles: [],
  godMode: params.has('god'),
};
window.G = G; // handy for debugging in the console

G.input = new Input(renderer.domElement);
G.audio = new Audio();
G.fx = new FX(scene);
G.world = new World(scene);
for (const m of G.world.reflective) {
  m.envMap = envTex;
  m.needsUpdate = true;
}
G.details = new Details(G.world, scene);
G.weather = { rain: params.has('rain') ? 1 : 0, clouds: params.has('rain') ? 1 : 0.2, target: params.has('rain') ? 'rain' : 'clear', timer: 240, flash: 0 };
G.player = new Player(G);
G.peds = new PedManager(G);
G.traffic = new VehicleManager(G);
G.wanted = new Wanted(G);
G.police = new PoliceManager(G);
G.pickups = new Pickups(G);
G.missions = new Missions(G);
G.hud = new HUD(G);
G.pickups.setupFixed();

// ---------------- save / load ----------------
G.save = () => {
  try {
    const p = G.player;
    localStorage.setItem('neonbay-save', JSON.stringify({ money: p.money, weapons: p.weapons, cur: p.cur, done: G.missions.givers.map((g) => g.done) }));
  } catch { /* storage unavailable */ }
};
try {
  const s = JSON.parse(localStorage.getItem('neonbay-save') || 'null');
  if (s && !params.has('fresh')) {
    G.player.money = s.money ?? 500;
    if (s.weapons) G.player.weapons = s.weapons;
    if (s.cur && G.player.weapons[s.cur]) G.player.cur = s.cur;
    s.done?.forEach((d, i) => G.missions.givers[i] && (G.missions.givers[i].done = d));
  }
} catch { /* ignore corrupted saves */ }

// ---------------- spawn ----------------
{
  const b = G.world.getBlock(4, 5);
  const x = b.x0 + 6, z = b.z0 + 1.8;
  G.player.respawnAt(x, z, Math.PI);
  G.camYaw = Math.PI;
  const car = new Vehicle('muscle', 0x2a6ad8);
  car.place(b.x0 + 14, b.z0 - 1.6, Math.PI / 2);
  G.traffic.add(car);
  for (let i = 0; i < 12; i++) G.traffic.spawnTraffic(G.player.pos, 30, 160);
  for (let i = 0; i < 25; i++) G.peds.spawnCiv(G.player.pos, 10, 120);
}

// ---------------- global events ----------------
G.panic = (x, z, r) => {
  for (const p of G.peds.list) {
    if (p.kind !== 'civ' || !p.alive) continue;
    if (Math.hypot(p.pos.x - x, p.pos.z - z) < r) p.panic(x, z, 8);
  }
  for (const v of G.vehicles) {
    if (v.driver instanceof TrafficAI && Math.hypot(v.pos.x - x, v.pos.z - z) < r) v.driver.panicT = 8;
  }
};

const copCanSee = (x, z, range) => {
  for (const p of G.peds.list) {
    if (p.kind === 'cop' && p.alive && Math.hypot(p.pos.x - x, p.pos.z - z) < range && !G.world.segmentBlocked(p.pos.x, p.pos.z, x, z)) return true;
  }
  for (const v of G.vehicles) {
    if (v.isPolice && v.alive && (v.driver instanceof PoliceAI || v.driver) && Math.hypot(v.pos.x - x, v.pos.z - z) < range && !G.world.segmentBlocked(v.pos.x, v.pos.z, x, z)) return true;
  }
  return false;
};

G.crimeWitnessed = (x, z, heat) => {
  if (copCanSee(x, z, 45)) G.wanted.addHeat(heat, 1);
};

G.onGunfire = (x, z) => {
  G.panic(x, z, 40);
  if (copCanSee(x, z, 50)) G.wanted.addHeat(0, 1);
  else {
    for (const p of G.peds.list) {
      if (p.kind === 'civ' && p.alive && Math.hypot(p.pos.x - x, p.pos.z - z) < 16) {
        G.wanted.addHeat(0, 1);
        break;
      }
    }
  }
};

G.onPedKilled = (p, source) => {
  if (Math.random() < 0.6 || p.kind !== 'civ') G.pickups.spawnCash(p.pos.x + rand(-0.5, 0.5), p.pos.z + rand(-0.5, 0.5), Math.floor(rand(8, p.kind === 'civ' ? 45 : 90)));
  if (p.kind === 'cop') G.pickups.add({ type: 'ammo', weapon: 'pistol', ammo: 12, x: p.pos.x + 0.8, z: p.pos.z, life: 30 });
  if (source === 'player') {
    if (p.kind === 'civ') G.wanted.addHeat(0.5, 1);
    else if (p.kind === 'cop') G.wanted.addHeat(1, 2);
  }
  G.panic(p.pos.x, p.pos.z, 25);
  G.missions.onPedKilled(p);
};

G.explosion = (x, y, z, source) => {
  G.fx.explosion(x, y, z);
  const pl = G.player;
  const pp = pl.inCar ? pl.inCar.pos : pl.pos;
  const d = Math.hypot(pp.x - x, pp.z - z);
  G.audio.explosion(clamp(1.2 - d / 150, 0.1, 1));
  G.camShake = Math.max(G.camShake, clamp(1 - d / 60, 0, 1));
  const R = 8;
  for (const p of G.peds.list) {
    const pd = Math.hypot(p.pos.x - x, p.pos.z - z);
    if (pd < R && p.alive) {
      const k = 1 - pd / R;
      p.die(source, new THREE.Vector3((p.pos.x - x) / (pd || 1) * 10 * k, 6 + 6 * k, (p.pos.z - z) / (pd || 1) * 10 * k));
    }
  }
  for (const v of G.vehicles) {
    const vd = Math.hypot(v.pos.x - x, v.pos.z - z);
    if (vd < R && vd > 0.1 && v.alive) {
      v.damage(1200 * (1 - vd / R), G, source);
      if (v.burnTimer > 1) v.burnTimer = rand(0.6, 1.5);
      v.vel.x += ((v.pos.x - x) / vd) * 8;
      v.vel.z += ((v.pos.z - z) / vd) * 8;
    }
  }
  if (d < R) pl.takeDamage(90 * (1 - d / R) + 10);
  G.panic(x, z, 60);
  if (source === 'player') G.wanted.addHeat(0.5, 1);
};

G.onVehicleCollision = (a, b) => {
  const pc = G.player.inCar;
  if (!pc) return;
  const other = a === pc ? b : b === pc ? a : null;
  if (!other) return;
  if (other.isPolice && other.alive) G.wanted.addHeat(0, 1);
  if (other.driver instanceof TrafficAI) other.driver.panicT = 6;
};

let downT = 0;
let downKind = null;
G.onPlayerDown = (kind) => {
  downKind = kind;
  downT = 5;
  if (kind === 'wasted') {
    G.hud.big('FLATLINED', '', 5, '#c82020');
    G.audio.wasted();
  } else {
    G.hud.big('ARRESTED', '', 5, '#4a7aff');
    G.audio.failed();
  }
  if (G.missions.active) {
    const m = G.missions.active;
    m.cleanup?.(false);
    G.missions.active = null;
    G.missions.cpMarker.visible = false;
    G.hud.objective('');
  }
  document.body.classList.add('down');
};

function respawn() {
  const pl = G.player;
  const L = G.world.landmarks;
  const spot = downKind === 'wasted' ? L.hospital : L.police;
  let fee;
  if (downKind === 'wasted') {
    fee = Math.min(pl.money, 200);
    G.hud.subtitle(`Hospital bill: ${formatMoney(fee)}`, 5);
  } else {
    fee = Math.min(pl.money, 150 + G.wanted.stars * 100);
    G.hud.subtitle(`Bail: ${formatMoney(fee)}. Your weapons were confiscated.`, 5);
    pl.weapons = { fist: {} };
    pl.cur = 'fist';
  }
  pl.money -= fee;
  G.wanted.clear();
  // remove all police units
  for (const v of [...G.vehicles]) if (v.isPolice) G.traffic.remove(v);
  for (const p of [...G.peds.list]) if (p.kind === 'cop' || p.kind === 'guard') G.peds.remove(p);
  if (G.police.heli) {
    G.police.heli.dispose();
    G.police.heli = null;
  }
  pl.respawnAt(spot.x, spot.z, spot.heading);
  G.camYaw = spot.heading ?? 0;
  G.hour = (G.hour + 6) % 24;
  document.body.classList.remove('down');
  G.save();
}

// ---------------- day / night ----------------
const skyDay = new THREE.Color(0x9cc8f0), skyDusk = new THREE.Color(0xf09060), skyNight = new THREE.Color(0x0a1022);
const tmpC = new THREE.Color();
const moonCol = new THREE.Color(0x9fb4ff), sunCol = new THREE.Color(0xfff0d8);
const hemiNight = new THREE.Color(0x7080b8), hemiDay = new THREE.Color(0xcfe6ff);
const skyTopDay = new THREE.Color(0x2f6fcf), skyTopNight = new THREE.Color(0x02040c);
const grey = new THREE.Color();

// ---------------- weather ----------------
function updateWeather(dt) {
  const W = G.weather;
  W.timer -= dt;
  if (W.timer <= 0 && !params.has('rain')) {
    const r = Math.random();
    W.target = r < 0.6 ? 'clear' : r < 0.82 ? 'cloudy' : 'rain';
    W.timer = rand(150, 360);
    if (W.target === 'rain') G.hud.notify('Storm rolling in...', 3);
  }
  const wantClouds = W.target === 'clear' ? 0.15 : W.target === 'cloudy' ? 0.65 : 1;
  const wantRain = W.target === 'rain' ? 1 : 0;
  W.clouds += clamp(wantClouds - W.clouds, -dt / 25, dt / 25);
  W.rain += clamp(wantRain - W.rain, -dt / 20, dt / 20);
  if (W.rain > 0.95 && Math.random() < dt * 0.04) {
    W.flash = 1;
    setTimeout(() => G.audio.thunder?.(), 600 + Math.random() * 1500);
  }
  W.flash = Math.max(0, W.flash - dt * 4);
  G.fx.setRain(W.rain, camera.position, dt);
  G.world.setWet(W.rain);
}
function updateSky(dt) {
  G.hour = (G.hour + dt / 30) % 24; // 1 in-game hour = 30 s
  const h = G.hour;
  const sunAng = ((h - 6) / 12) * Math.PI; // 0 at 6am, PI at 6pm
  const elev = Math.sin(sunAng);
  const dayF = smoothstep(-0.08, 0.25, elev);
  G.night = 1 - dayF;
  const duskF = clamp(1 - Math.abs(elev) / 0.3, 0, 1);
  const W = G.weather;
  const overcast = W.clouds;
  tmpC.copy(skyNight).lerp(skyDay, dayF).lerp(skyDusk, duskF * 0.55);
  tmpC.lerp(grey.setScalar(0.55 * dayF + 0.06), overcast * 0.7);
  skyMat.uniforms.horizon.value.copy(tmpC);
  skyMat.uniforms.top.value.copy(skyTopNight).lerp(skyTopDay, dayF).lerp(grey.setScalar(0.45 * dayF + 0.04), overcast * 0.75);
  skyMat.uniforms.ground.value.copy(tmpC).multiplyScalar(0.7);
  skyMat.uniforms.glow.value = (1 - overcast * 0.85) * clamp(elev * 4 + 0.3, 0, 1);
  skyMat.uniforms.sunCol.value.setRGB(1, 0.85 + dayF * 0.1, 0.6 + dayF * 0.3);
  skyDome.position.copy(camera.position);
  scene.background.copy(tmpC);
  scene.fog.color.copy(tmpC);
  scene.fog.near = lerp(60, 140, dayF) * (1 - W.rain * 0.5);
  scene.fog.far = lerp(380, 650, dayF) * (1 - W.rain * 0.45);
  const pp = G.player.inCar ? G.player.inCar.pos : G.player.pos;
  const sx = Math.cos(sunAng), sy = Math.max(Math.sin(sunAng), 0.15);
  sun.position.set(pp.x + sx * 150, sy * 200, pp.z + 60);
  sun.target.position.set(pp.x, 0, pp.z);
  // moonlight at night keeps the streets readable
  sun.intensity = lerp(0.7, 2.4, dayF) * (1 - overcast * 0.6);
  sun.color.copy(moonCol).lerp(sunCol, dayF);
  hemi.intensity = lerp(0.75, 0.9, dayF) + W.flash * 3;
  hemi.color.copy(hemiNight).lerp(hemiDay, dayF);
  renderer.toneMappingExposure = lerp(1.15, 1.0, dayF);
  starMat.opacity = G.night * (1 - overcast);
  skyMat.uniforms.sunDir.value.set(sx, Math.sin(sunAng), 0.35).normalize();
  // reflections fade with daylight so cars don't glow at night
  const envI = lerp(0.12, 1, dayF) * (1 - overcast * 0.4);
  G.envI = envI;
  setVehicleEnvIntensity(envI);
  for (const m of G.world.reflective) m.envMapIntensity = envI;
  bloom.strength = lerp(0.5, 0.28, dayF);
  bloom.threshold = lerp(0.82, 0.9, dayF);
  bloom.radius = 0.35;
  starPts.position.copy(camera.position);
  const night = Math.sin(sunAng) < 0;
  sunDisc.position.set(camera.position.x + (night ? -sx : sx) * 900, Math.abs(Math.sin(sunAng)) * 700 + 40, camera.position.z + 300);
  sunDisc.material.color.setHex(night ? 0xdde4ff : 0xfff2c0);
  sunDisc.scale.setScalar(night ? 0.7 : 1);
  sunDisc.visible = overcast < 0.6;
  G.world.setNight(G.night);
}

// ---------------- camera ----------------
const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3();
let camDist = 6;
function updateCamera(dt) {
  const inp = G.input;
  const pl = G.player;
  const sens = 0.0024 * (pl.aiming ? 0.6 : 1);
  G.camYaw -= inp.mouse.dx * sens;
  G.camPitch = clamp(G.camPitch - inp.mouse.dy * sens, -1.2, 0.7);
  if (inp.down('ArrowLeft')) G.camYaw += dt * 2;
  if (inp.down('ArrowRight')) G.camYaw -= dt * 2;
  if (inp.down('ArrowUp')) G.camPitch = clamp(G.camPitch + dt, -1.2, 0.7);
  if (inp.down('ArrowDown')) G.camPitch = clamp(G.camPitch - dt, -1.2, 0.7);

  let wantDist, height;
  if (pl.inCar) {
    const v = pl.inCar;
    camTarget.set(v.pos.x, v.pos.y + 1.6, v.pos.z);
    wantDist = 7 + v.spec.len * 0.6 + clamp(Math.abs(v.speed) / 12, 0, 2.5);
    height = 0;
    // auto-follow behind the car when the mouse is idle
    const idle = performance.now() - inp.lastMouseMove > 1200;
    if (idle && v.speed > 3) {
      G.camYaw += wrapAngle(v.heading - G.camYaw) * Math.min(1, dt * 2.5);
      G.camPitch += (-0.22 - G.camPitch) * Math.min(1, dt * 2);
    } else if (idle && v.speed < -3) {
      G.camYaw += wrapAngle(v.heading - G.camYaw) * Math.min(1, dt * 0.5);
    }
  } else {
    const aim = pl.aiming;
    const fx = Math.sin(G.camYaw), fz = Math.cos(G.camYaw);
    const rx = -fz, rz = fx;
    const side = aim ? 0.75 : 0.45;
    camTarget.set(pl.pos.x + rx * side, pl.pos.y + (aim ? 1.6 : 1.55), pl.pos.z + rz * side);
    wantDist = aim ? 2.4 : 4.6;
    height = 0;
  }
  if (!pl.alive) {
    wantDist = 9;
    G.camYaw += dt * 0.3;
    G.camPitch += (-0.5 - G.camPitch) * Math.min(1, dt);
  }
  camDist += (wantDist - camDist) * Math.min(1, dt * 6);
  const cp = Math.cos(G.camPitch);
  const dx = Math.sin(G.camYaw) * cp, dy = Math.sin(G.camPitch), dz = Math.cos(G.camYaw) * cp;
  // camera collision against buildings
  const r = G.world.raycast(camTarget.x, camTarget.y, camTarget.z, -dx, -dy, -dz, camDist + 0.3);
  const dist = r.hit ? Math.max(0.6, r.t - 0.3) : camDist;
  camPos.set(camTarget.x - dx * dist, Math.max(0.3, camTarget.y - dy * dist + height), camTarget.z - dz * dist);
  if (G.camShake > 0) {
    camPos.x += rand(-1, 1) * G.camShake * 0.3;
    camPos.y += rand(-1, 1) * G.camShake * 0.3;
    G.camShake = Math.max(0, G.camShake - dt * 2);
  }
  camera.position.copy(camPos);
  camera.lookAt(camTarget.x + dx, camTarget.y + dy, camTarget.z + dz);
  const fov = pl.aiming ? 50 : pl.inCar ? 72 + clamp(Math.abs(pl.inCar.speed) / 4, 0, 10) : 68;
  if (Math.abs(camera.fov - fov) > 0.1) {
    camera.fov += (fov - camera.fov) * Math.min(1, dt * 8);
    camera.updateProjectionMatrix();
  }
}

// ---------------- main loop ----------------
function simulate(dt) {
  G.time += dt;
  updateWeather(dt);
  updateSky(dt);
  G.details.update(dt, G.time, G.night, G.weather.clouds, camera.position);
  G.player.update(dt);
  G.traffic.update(dt);
  G.peds.update(dt);
  G.police.update(dt);
  G.wanted.update(dt);
  G.pickups.update(dt);
  G.missions.update(dt);
  G.world.update(dt, G.time);
  G.fx.update(dt);

  if (!G.player.alive && downKind) {
    downT -= dt;
    if (downT <= 0) {
      respawn();
      downKind = null;
    }
  }

  // player car headlight at night
  const v = G.player.inCar;
  if (v && G.night > 0.3) {
    const f = v.forward;
    headlight.intensity = 60 * G.night;
    headlight.position.set(v.pos.x + f.x * 2, 1.0, v.pos.z + f.z * 2);
    headlight.target.position.set(v.pos.x + f.x * 20, 0, v.pos.z + f.z * 20);
  } else headlight.intensity = 0;

  G.audio.update({
    inCar: !!v,
    speed: v ? v.speed : 0,
    throttle: v ? Math.abs(v.input.throttle) : 0,
    siren: G.police.sirenLevel || 0,
    horn: v && G.player.horn,
  });
}
G.simulate = (dt, steps = 1) => {
  for (let i = 0; i < steps; i++) {
    simulate(dt);
    updateCamera(dt);
    G.input.endFrame();
  }
};

const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  const inp = G.input;

  if (inp.hit('KeyM')) G.hud.toggleMap();
  if (inp.hit('KeyP') && G.started) setPaused(!G.paused);
  if (inp.hit('KeyO')) {
    quality = (quality + 1) % QUALITY.length;
    applyQuality();
    G.hud.notify(`Graphics: ${QUALITY[quality].name}`, 2);
  }

  if (!G.paused) simulate(dt);
  updateCamera(G.paused ? 0 : dt);
  G.hud.update(G.paused ? 0 : dt);
  if (QUALITY[quality].bloom) composer.render();
  else renderer.render(scene, camera);
  inp.endFrame();
  G.fps = 1 / Math.max(dt, 1e-3);
}

// ---------------- start / pause ----------------
const overlay = document.getElementById('overlay');
function setPaused(p) {
  G.paused = p;
  overlay.style.display = p ? 'flex' : 'none';
  document.getElementById('start-btn').textContent = G.started ? 'Resume' : 'Play';
  if (p) G.audio.ctx?.suspend();
  else G.audio.resume();
}
function start() {
  G.audio.init();
  G.audio.resume();
  G.input.lock();
  G.started = true;
  setPaused(false);
  if (!G._welcomed) {
    G._welcomed = true;
    G.hud.big('NEON BAY', 'Welcome to the city', 3.5, '#ff4fd8');
    G.hud.notify('Walk into a coloured marker to start a mission.<br>Press <b>F</b> near a car to get in. <b>M</b> for map.', 8);
  }
}
document.getElementById('start-btn').addEventListener('click', start);
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && G.started && !G.paused && !params.has('autostart')) setPaused(true);
});
renderer.domElement.addEventListener('click', () => {
  if (G.started && !G.paused && !G.input.locked) G.input.lock();
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  bloom.resolution.set(innerWidth / 2, innerHeight / 2);
});
setInterval(() => G.started && G.save(), 15000);

if (params.has('autostart')) {
  overlay.style.display = 'none';
  G.started = true;
  G.paused = false;
}
frame();
