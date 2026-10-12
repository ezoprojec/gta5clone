# Neon Bay

An open-world crime sandbox in the style of the classic 3D "steal a car, cause chaos, outrun the cops" games, built from scratch in the browser with [Three.js](https://threejs.org). Everything is generated in code, including the city, cars, characters, textures and sound, so there are no asset files.

## Play

There's no build step. Serve the folder with any static file server and open it in a desktop browser:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

(Opening `index.html` straight from disk won't work, because browsers block ES modules on `file://`.)

## Controls

| Key | Action |
| --- | --- |
| WASD | Walk / drive |
| Mouse | Look (click to capture the mouse) |
| Shift | Sprint |
| Space | Jump / handbrake (drift!) |
| F | Enter, exit, or carjack a vehicle |
| LMB / RMB | Shoot / aim (you can shoot from cars too) |
| Wheel or 1–7 | Switch weapon |
| R | Reload |
| Tab (hold) | Weapon wheel (time slows while it's open) |
| X | Slow-motion special ability |
| Z | Switch character (Rico → Dana → Moe) |
| Q | Next radio station (in a vehicle) |
| ` | Cheat console |
| E | Interact: start missions, buy from the gun shop |
| H | Horn |
| G | Toggle siren (in a police car) |
| M | Full-screen map |
| O | Graphics quality (Low / Medium / High) |
| P / Esc | Pause |

## Features

- **Procedural city.** A 10×10 grid of blocks: a downtown of skyscrapers, commercial streets with neon trim, suburbs, parks with fountains, and a beach on the south edge. Windows light up at night.
- **Three playable characters.** Rico Vance (getaway driver), Dana Reyes (hacker) and Big Moe (biker). Each has their own location, cash, weapons and ride. Press **Z** to switch, with a swooping sky-cam transition. Switching isn't allowed while you're wanted or on a mission.
- **Car radio.** Four stations of endlessly generated original music (synthwave, hip-hop, rock and island lounge), plus Radio Off. Press **Q** in a vehicle to change station.
- **Weapons.** Fists, a baseball bat, pistol, SMG, shotgun, grenades (bounce, then explode) and a rocket launcher, picked with a weapon wheel.
- **Slow motion.** A special ability (**X**) with a recharging meter under the health bar.
- **Motorcycles.** The Zephyr 600 shows up in traffic and in parking spots. Bikes lean into turns, and a hard crash throws you over the handlebars.
- **Quick Coat Paint & Body.** Next to the Eastgate gas station. Drive in while wanted or damaged: for $250 you get a fresh paint job, a full repair, and the cops lose your trail.
- **Store robberies.** Aim a gun at a GoFast kiosk clerk until they drop the till money. Expect two stars.
- **Cheat codes.** Press **`** and type one: `PATCHMEUP`, `LOCKNLOAD`, `CLEANSLATE`, `BRINGTHEHEAT`, `SHOWROOM`, `TWOWHEELS`, `STORMFRONT`, `BLUESKIES`, `RECHARGE`.
- **Districts.** Each district has its own look, and its name pops up when you enter: Downtown, Midtown, Northside, Eastgate, the Ironworks freight yard, Palm Heights villas with pools, brick Old Town, the neon-soaked Sunset Strip, Lantern Market, and the beach. The full map (M) labels them all.
- **Landmarks.**
  - **Apex Tower:** a 300 m skyscraper with a blinking spire.
  - **Bay Arena:** a stadium with floodlights. Walk in through the south gate.
  - **Lucky Star Hotel:** a hotel with a spinning neon star on its roof.
  - **Old Town clock tower:** its clock shows the in-game time.
  - **Lantern Market:** stalls strung with lanterns that glow at night.
  - **Skyline One:** a construction site with a slewing tower crane.
  - **The coast:** a lighthouse whose beam sweeps the sky at night, a marina with bobbing boats, and hills to the north with a big hillside sign.
- **Stunts.** Ramps in the Stunt Park and on the beach launch your car into the air. Big airtime pays a stunt bonus.
- **Gas stations.** Three GoFast Fuel stations, whose pumps explode when shot and can set off the next pump.
- **Neon Tokens.** 12 hidden collectibles around the landmarks, worth $250 each, plus $5,000 for finding them all. Your progress is saved.
- **Day/night cycle.** One in-game hour takes 30 seconds. There's a gradient sky with a sun glow, drifting clouds, stars and a moon. At night, street lamps cast pools of light and car headlights light up the road.
- **Weather.** Clear, cloudy and rainy spells come and go. Rain brings wet, glossy roads, heavier fog, lightning and thunder.
- **Graphics.** Bloom makes neon, lamps and lit windows glow. Car paint, glass towers and the sea are reflective. There are several building styles (glass towers, office grids, brick, houses) and shops with awnings at street level.
- **Street life.** Working traffic lights that AI drivers stop for, hydrants, bins, benches, bus shelters, planters, and rooftop billboards for made-up brands. There's also a palm-lined beach road and a pier with a Ferris wheel that lights up at night.
- **Vehicles.** Six car types with curved bodies, wheel arches, mirrors and plates, and arcade physics: drifting, body roll, skid marks, tire smoke, crash damage, smoke, fire and explosions that can chain.
- **Traffic.** AI drivers follow lanes and pick random turns at intersections. They brake for obstacles and speed off when there's gunfire.
- **Pedestrians.** They walk the sidewalks, cross streets, panic, cower, and drop cash.
- **Wanted level (1–5 stars).** Police chase you on the road grid, ram your car, get out and arrest you at 1 star, and shoot at 2+ stars. A searchlight helicopter joins at 3+ stars and opens fire at 4+. Break line of sight long enough and the stars fade.
- **Missions.** Three repeatable missions from the markers on the map:
  - *Joyride*: steal a sports car and deliver it to the lockup. The pay depends on the car's condition.
  - *Courier Run*: drive through six timed checkpoints.
  - *Loose Ends*: take out a guarded target.
- **Economy.** Cash pickups, health and armor, weapon stashes, and a gun shop. Getting killed or arrested costs you a hospital bill or bail, and an arrest also takes your weapons.
- **HUD.** A rotating minimap with blips, a full map, money, wanted stars, ammo and a speedometer.
- **Autosave.** Your money, weapons and mission progress are saved to `localStorage`.

## URL flags

- `?night`: start at 22:00
- `?rain`: keep it raining
- `?low`: force the Low graphics preset
- `?fresh`: ignore the saved game
- `?god`: invulnerable
- `?autostart`: skip the title screen (used for automated testing)

## Code layout

```
index.html, style.css     page + HUD markup
vendor/three.module.min.js  Three.js r160 (MIT, see vendor/THREE_LICENSE)
vendor/addons/    official Three.js add-ons: bloom post-processing, room environment
src/main.js       renderer, game loop, camera, day/night, global game events
src/world.js      city generation, facades, roads, water, collision grid, raycasts, map rendering
src/details.js    traffic lights, street props, billboards, palms, pier + Ferris wheel, clouds
src/areas.js      districts, landmarks, stunt ramps, gas stations, lighthouse, marina, hills, Neon Tokens
src/vehicle.js    car models, driving physics, damage, car-vs-car collisions
src/traffic.js    lane-following traffic AI + vehicle spawning
src/police.js     wanted level, pursuit AI, helicopter
src/peds.js       pedestrians, cops on foot, mission NPCs
src/player.js     player movement, carjacking, weapons, playable characters
src/projectiles.js grenades and rockets
src/radio.js      procedural radio stations
src/missions.js   mission givers + mission logic
src/pickups.js    pickups + gun shop
src/hud.js        HUD, minimap, big map
src/fx.js         particles, tracers, muzzle flash
src/audio.js      synthesized WebAudio sound effects
src/input.js      keyboard / mouse / pointer lock
```

All names, places and characters are original to this project.
