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
| Wheel or 1–4 | Switch weapon (fists, pistol, SMG, shotgun) |
| R | Reload |
| E | Interact: start missions, buy from the gun shop |
| H | Horn |
| G | Toggle siren (in a police car) |
| M | Full-screen map |
| P / Esc | Pause |

## Features

- **Procedural city.** A 10×10 grid of blocks: a downtown of skyscrapers, commercial streets with neon trim, suburbs, parks with fountains, and a beach on the south edge. Windows light up at night.
- **Day/night cycle.** One in-game hour takes 30 seconds, with dusk skies, stars, a moon, street lamps and headlights.
- **Vehicles.** Six car types with arcade physics: drifting, body roll, crash damage, smoke, fire and explosions that can chain.
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
- `?fresh`: ignore the saved game
- `?god`: invulnerable
- `?autostart`: skip the title screen (used for automated testing)

## Code layout

```
index.html, style.css     page + HUD markup
vendor/three.module.min.js  Three.js r160 (MIT, see vendor/THREE_LICENSE)
src/main.js       renderer, game loop, camera, day/night, global game events
src/world.js      city generation, collision grid, raycasts, map rendering
src/vehicle.js    car models, driving physics, damage, car-vs-car collisions
src/traffic.js    lane-following traffic AI + vehicle spawning
src/police.js     wanted level, pursuit AI, helicopter
src/peds.js       pedestrians, cops on foot, mission NPCs
src/player.js     player movement, carjacking, weapons
src/missions.js   mission givers + mission logic
src/pickups.js    pickups + gun shop
src/hud.js        HUD, minimap, big map
src/fx.js         particles, tracers, muzzle flash
src/audio.js      synthesized WebAudio sound effects
src/input.js      keyboard / mouse / pointer lock
```

All names, places and characters are original to this project.
