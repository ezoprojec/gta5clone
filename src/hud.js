// DOM HUD: minimap, stars, money, weapon, health, messages, big map.
import { formatMoney, clamp } from './util.js';
import { WEAPONS } from './player.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor(G) {
    this.G = G;
    this.mini = $('minimap');
    this.mctx = this.mini.getContext('2d');
    this.mapData = G.world.renderMapCanvas(1400);
    this.notifyT = 0;
    this.bigT = 0;
    this.subT = 0;
    this.promptText = '';
    this.shownMoney = G.player.money;
    this.starFlashT = 0;
    this.dmgT = 0;
    this.vehT = 0;
    this.bigMap = false;
    const stars = $('stars');
    for (let i = 0; i < 5; i++) {
      const s = document.createElement('span');
      s.textContent = '★';
      stars.appendChild(s);
    }
    this.starEls = [...stars.children];
  }

  notify(text, time = 4, vehicle = false) {
    if (vehicle) {
      $('vehname').textContent = text;
      $('vehname').style.opacity = 1;
      this.vehT = time;
      return;
    }
    $('notify').innerHTML = text;
    $('notify').style.opacity = 1;
    this.notifyT = time;
  }
  big(text, sub = '', time = 3, color = '#fff') {
    $('big').innerHTML = `<div style="color:${color}">${text}</div><small>${sub}</small>`;
    $('big').style.opacity = 1;
    this.bigT = time;
  }
  subtitle(text, time = 4) {
    $('subtitle').innerHTML = text;
    $('subtitle').style.opacity = 1;
    this.subT = time;
  }
  objective(text) {
    $('objective').innerHTML = text;
    $('objective').style.display = text ? 'block' : 'none';
  }
  timer(t) {
    const el = $('timer');
    if (t === null) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'block';
    const s = Math.max(0, Math.ceil(t));
    el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    el.style.color = t < 10 ? '#ff5050' : '#fff';
  }
  prompt(text) {
    this.promptText = text;
  }
  flashStars() {
    this.starFlashT = 2;
  }
  damageFlash() {
    this.dmgT = 0.35;
  }
  moneyPop(n) {
    const el = $('moneypop');
    el.textContent = '+' + formatMoney(n);
    el.style.opacity = 1;
    clearTimeout(this._mp);
    this._mp = setTimeout(() => (el.style.opacity = 0), 1200);
  }
  toggleMap() {
    this.bigMap = !this.bigMap;
    $('bigmap').style.display = this.bigMap ? 'flex' : 'none';
    if (this.bigMap) this.drawBigMap();
  }

  blips() {
    const G = this.G;
    const out = [];
    const L = G.world.landmarks;
    if (L.hospital) out.push({ x: L.hospital.x, z: L.hospital.z, color: '#ff4a4a', label: 'H' });
    if (L.police) out.push({ x: L.police.x, z: L.police.z, color: '#4a7aff', label: 'P' });
    if (L.gunshop) out.push({ x: L.gunshop.x, z: L.gunshop.z, color: '#ff7a3a', label: 'G' });
    out.push(...G.missions.blips);
    const flash = Math.floor(G.time * 4) % 2;
    for (const v of G.vehicles) {
      if (v.isPolice && v.siren) out.push({ x: v.pos.x, z: v.pos.z, color: flash ? '#ff3030' : '#3060ff', small: true });
    }
    for (const p of G.peds.list) {
      if (p.alive && (p.kind === 'cop' || p.kind === 'guard') && p.state === 'hostile') out.push({ x: p.pos.x, z: p.pos.z, color: p.kind === 'cop' ? '#6f8fff' : '#ff4040', tiny: true });
    }
    if (G.police.heli) out.push({ x: G.police.heli.pos.x, z: G.police.heli.pos.z, color: flash ? '#ff3030' : '#3060ff', label: '✈' });
    return out;
  }

  drawMinimap() {
    const G = this.G;
    const c = this.mctx;
    const W = this.mini.width, H = this.mini.height;
    const pl = G.player;
    const p = pl.inCar ? pl.inCar.pos : pl.pos;
    const speed = pl.inCar ? Math.abs(pl.inCar.speed) : 0;
    this.zoom = (this.zoom || 1.4) + ((speed > 15 ? 0.8 : 1.4) - (this.zoom || 1.4)) * 0.03;
    const zoom = this.zoom;
    const yaw = G.camYaw;
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    c.save();
    c.fillStyle = '#1f3a5a';
    c.fillRect(0, 0, W, H);
    c.translate(W / 2, H / 2 + 20);
    c.save();
    // world (dx,dz) -> screen ( -cos*dx + sin*dz, -(sin*dx + cos*dz) ) * zoom
    c.transform(-zoom * cs, -zoom * sn, zoom * sn, -zoom * cs, 0, 0);
    const { canvas, ext } = this.mapData;
    c.drawImage(canvas, -ext - p.x, -ext - p.z, ext * 2, ext * 2);
    c.restore();
    const toScreen = (x, z) => {
      const dx = x - p.x, dz = z - p.z;
      return [zoom * (-cs * dx + sn * dz), -zoom * (sn * dx + cs * dz)];
    };
    const R = W / 2 - 6;
    for (const b of this.blips()) {
      let [sx, sy] = toScreen(b.x, b.z);
      sy += 20;
      const d = Math.hypot(sx, sy);
      if (d > R) {
        if (!b.label && !b.objective) continue;
        sx *= R / d;
        sy *= R / d;
      }
      sy -= 20;
      c.fillStyle = b.color;
      c.strokeStyle = '#000';
      c.lineWidth = 1.5;
      if (b.label) {
        c.beginPath();
        c.arc(sx, sy, 8, 0, Math.PI * 2);
        c.fill();
        c.stroke();
        c.fillStyle = '#000';
        c.font = 'bold 10px sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(b.label, sx, sy + 0.5);
      } else {
        const r = b.tiny ? 2.5 : b.small ? 4 : 6;
        c.beginPath();
        c.arc(sx, sy, r, 0, Math.PI * 2);
        c.fill();
        c.stroke();
      }
    }
    // player arrow
    const h = (pl.inCar ? pl.inCar.heading : pl.heading) - yaw;
    c.rotate(-h);
    c.fillStyle = '#fff';
    c.strokeStyle = '#000';
    c.beginPath();
    c.moveTo(0, -8);
    c.lineTo(6, 6);
    c.lineTo(0, 3);
    c.lineTo(-6, 6);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();
  }

  drawBigMap() {
    const cv = $('bigmapcanvas');
    const size = Math.min(innerWidth, innerHeight) * 0.9;
    cv.width = cv.height = size;
    const c = cv.getContext('2d');
    const { canvas, ext } = this.mapData;
    // rotate 180° so it matches the default camera view (north = -z at the top)
    c.save();
    c.translate(size / 2, size / 2);
    c.rotate(Math.PI);
    c.drawImage(canvas, -size / 2, -size / 2, size, size);
    c.restore();
    const sc = size / (ext * 2);
    const tx = (x) => size / 2 - x * sc, tz = (z) => size / 2 - z * sc;
    for (const b of this.blips()) {
      c.fillStyle = b.color;
      c.beginPath();
      c.arc(tx(b.x), tz(b.z), b.label ? 9 : 5, 0, Math.PI * 2);
      c.fill();
      if (b.label) {
        c.fillStyle = '#000';
        c.font = 'bold 11px sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(b.label, tx(b.x), tz(b.z));
      }
    }
    const G = this.G;
    const p = G.player.inCar ? G.player.inCar.pos : G.player.pos;
    c.fillStyle = '#fff';
    c.strokeStyle = '#000';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(tx(p.x), tz(p.z), 7, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.font = 'bold 16px sans-serif';
    c.fillStyle = '#fff';
    c.textAlign = 'center';
    c.fillText('NEON BAY', size / 2, 26);
    c.fillText('Beach ↓', size / 2, size - 14);
  }

  update(dt) {
    const G = this.G;
    const pl = G.player;
    // fades
    if ((this.notifyT -= dt) <= 0) $('notify').style.opacity = 0;
    if ((this.bigT -= dt) <= 0) $('big').style.opacity = 0;
    if ((this.subT -= dt) <= 0) $('subtitle').style.opacity = 0;
    if ((this.vehT -= dt) <= 0) $('vehname').style.opacity = 0;
    $('prompt').textContent = this.promptText;
    $('prompt').style.opacity = this.promptText ? 1 : 0;
    this.promptText = '';

    // money ticks up
    this.shownMoney += (pl.money - this.shownMoney) * Math.min(1, dt * 6);
    if (Math.abs(pl.money - this.shownMoney) < 1) this.shownMoney = pl.money;
    $('money').textContent = formatMoney(this.shownMoney);

    // clock
    const hrs = Math.floor(G.hour), mins = Math.floor((G.hour % 1) * 60);
    $('clock').textContent = `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;

    // stars
    const stars = G.wanted.stars;
    this.starFlashT -= dt;
    const blink = (G.wanted.searching || this.starFlashT > 0) && Math.floor(G.time * 4) % 2 === 0;
    this.starEls.forEach((el, i) => {
      el.className = i < stars ? (blink ? 'on dim' : 'on') : '';
    });

    // weapon
    const w = pl.weapons[pl.cur];
    const def = WEAPONS[pl.cur];
    $('weapon').innerHTML = def.melee ? `${def.name}` : `${def.name} <span>${w.clip}<small>/${w.ammo}</small></span>${pl.reloadT > 0 ? ' <em>reloading</em>' : ''}`;

    // bars
    $('hp').style.width = clamp(pl.health, 0, 100) + '%';
    $('hp').style.background = pl.health < 25 ? '#e33' : '#4c4';
    $('armor').style.width = clamp(pl.armor, 0, 100) + '%';

    // crosshair
    const armed = !def.melee;
    $('crosshair').style.display = pl.alive && (pl.aiming || (pl.inCar && armed && G.input.mouse.right)) ? 'block' : armed && !pl.inCar && pl.alive ? 'block' : 'none';
    $('crosshair').className = pl.aiming ? 'aim' : '';

    // speedo
    if (pl.inCar) {
      $('speedo').style.display = 'block';
      $('speedo').innerHTML = `${Math.round(Math.abs(pl.inCar.speed) * 3.6)}<small> km/h</small><div class="vh"><i style="width:${clamp((pl.inCar.health / pl.inCar.spec.health) * 100, 0, 100)}%"></i></div>`;
    } else $('speedo').style.display = 'none';

    // damage overlay
    this.dmgT -= dt;
    const low = pl.alive && pl.health < 25 ? 0.25 + 0.15 * Math.sin(G.time * 6) : 0;
    $('damage').style.opacity = Math.max(low, this.dmgT > 0 ? this.dmgT * 2 : 0);

    this.drawMinimap();
    if (this.bigMap && Math.floor(G.time * 4) !== this._bm) {
      this._bm = Math.floor(G.time * 4);
      this.drawBigMap();
    }
  }
}
