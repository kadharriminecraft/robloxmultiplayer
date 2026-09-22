# BASEPLATE WORLD FILES — the spec an AI follows to build a new world

This document is the complete contract between a **world file** and the
game client (`baseplate-v2.html`). Hand this file + `island-world.json`
to any AI (or write it yourself) and it can build an entirely new world
that every client can join. The world file goes in this folder
(`worlds/`), gets one import line in `worlds/index.js`, is pushed to the
Cloudflare Worker repo — and it just works: it shows up in every
player's **Worlds** menu, they can switch to it, and the admin powers
(give, smite, size, speed, bring-across-worlds…) all apply there.

---

## 1. The two kinds of world

| kind | what it is | who builds the geometry |
|------|------------|-------------------------|
| `template` | The classic hand-coded map (baseplate, house, watchtower, rides). A world file with `"kind": "template"` just points at it. | the game client, built in |
| `terrain` | A data-driven island/heightmap world — everything comes from the JSON below. | the client's **terrain interpreter**, from your recipe |

`baseplate.json` is the template world. `island-world.json` is the
reference terrain world — copy it to start a new one.

## 2. Terrain world recipe — every field

```json
{
  "id": "my-world",                     // REQUIRED. lowercase a-z 0-9 hyphens, 3-32 chars, unique
  "name": "My World",                    // REQUIRED. shown in the Worlds menu (<= 40 chars)
  "desc": "One line about it.",          // shown under the name (<= 120 chars)
  "kind": "terrain",                     // REQUIRED. must be exactly "terrain"
  "spawn": { "x": 0, "z": 0 },           // spawn point (top surface height is found automatically)

  "sky": {                               // OPTIONAL — day-time sky colors
    "dayTop": "#4aa3e0",                 //   zenith color at midday
    "dayBottom": "#d9eef7"               //   horizon color at midday (also the fog color)
  },                                     //   (night + dusk colors are built in; every world
                                         //    gets the same day/night cycle)

  "terrain": {                           // REQUIRED for terrain worlds
    "size": [176, 176],                  // map footprint in studs [x, z]. 64-400. columns are 1x1 studs
    "seed": 20260922,                    // any integer 1 - 2^31. EVERYTHING derives from it
    "waterLevel": 10,                    // ocean surface height in studs (0 = no water)
    "base": 30,                          // island plateau top height before noise
    "oceanFloor": 3,                     // seabed height
    "noise": [                           // 1-4 octaves, summed. smooth value noise
      { "scale": 64, "amp": 5.0 },      //   scale = stud wavelength (8-400), amp = stud height
      { "scale": 21, "amp": 1.8 }
    ],
    "island": {                          // OPTIONAL — omit for a flat square map
      "radius": 62,                      //   island core radius (studs)
      "edge": 26,                        //   slope width from plateau down to the seabed
      "rim": 0.55                        //   0.3-0.9: fraction of the full radius that stays flat
    },
    "surface": {                         // which block shows on top (checked top-down):
      "default": "grass",                //   the plateau top
      "edge": { "block": "dirt", "below": 0.85 },   // island-mask below 0.85 -> dirt ring
      "beach": { "block": "sand", "below": 12 },     // column top <= 12 -> sand
      "underwater": { "block": "sand" }             // column top < waterLevel -> sand
    },
    "palette": {                         // OPTIONAL — hex colors for the block set
      "grass": "#58a94f",                //   grass, dirt, sand, stone, water,
      "dirt": "#8a5f3b",                 //   leaves, trunk are the recognized keys;
      "sand": "#e0d29a",                 //   anything missing falls back to built-ins
      "stone": "#8d9298",
      "water": "#2f7fbf",
      "leaves": "#3f8f3f",
      "trunk": "#6b4a2b"
    }
  },

  "scatter": [                           // OPTIONAL — deterministic decorations
    { "type": "tree", "per": 240, "on": "grass", "min": 0.6, "scale": [0.8, 1.3] },
    { "type": "rock", "per": 600, "on": "grass", "min": 0.5 }
  ]
}
```

### How the terrain is built (so you can reason about it)

1. Every map is a grid of **1×1 stud columns** covering `size`, centered
   on (0,0). Column tops are quantized to whole studs (blocky Roblox
   terrain).
2. **Island mask** `t`: distance `d = hypot(x, z) / (radius + edge)`.
   `t = 1` (plateau) while `d <= rim`, smoothly 1 → 0 across the rim,
   `t = 0` (seabed) at `d >= 1`. Without `island`, `t` stays 1 to the
   map edge (a square continent — the map edge IS the void).
3. **Column height** = `round( lerp(oceanFloor, base + noise, t) )`.
4. **Surface block**: first match of underwater → beach → edge → default.
   The slope from plateau to shore is walkable in both directions
   (1-stud steps, the engine auto-steps 1.5).
5. **Water** fills a translucent block from `oceanFloor` up to
   `waterLevel` — solid on top, so players can walk across the ocean
   surface (and fall onto it from the island rim).
6. **Scatter**: for each eligible column, a hash test `1/per` decides a
   decoration. `on` = surface block it grows from; `min` = minimum
   island mask (keeps trees off the rim); `scale` = `[min, max]` size
   range for trees. Nothing spawns within 5 studs of spawn.
7. The **spawn pad** (gray studded plate) lands at `spawn` on the
   surface, and respawns use a small ring around it.

Everything is a pure function of `seed` — no `Math.random` anywhere — so
every client generates the identical world without syncing a single
terrain byte.

## 3. Hard rules (the client validates every recipe)

1. **Valid JSON, no comments, no trailing commas.**
2. `id`: `^[a-z0-9][a-z0-9-]{2,31}$`, unique across all worlds, and not
   `baseplate` (reserved).
3. `kind`: `template` or `terrain`. A `template` world ignores everything
   except `id`/`name`/`desc`/`spawn`.
4. `size`: 64–400 per axis. `radius + edge <= max(size) / 2`.
5. `waterLevel` < `base` (the island must rise above the water), and
   `oceanFloor` < `waterLevel`.
6. `noise`: 0–4 octaves, each `scale` 8–400 and `amp` 0–30.
7. `palette` values: `#rrggbb` hex strings. Recognized keys only.
8. `scatter` entries: `type` in `tree | rock`; `per` 4–5000; `on` in
   `grass | dirt | sand | stone`; `min` 0–1.
9. Spawn must be inside the map (`|x| < size/2 - 8`, same for `z`) —
   and on an island world, near the plateau so players don't spawn in
   the sea.

If ANY check fails, the client ignores the world: it never appears in
the Worlds menu, and a player already pointed at it falls back to the
built-in Baseplate World. The worker also refuses unknown rooms, so a
bad id can never strand anyone.

## 4. Publishing checklist

- [ ] Copied `island-world.json`, renamed `<your-id>.json` in `worlds/`.
- [ ] Unique `id`, honest `name` + `desc` (players see them in the menu).
- [ ] Tuned `seed` until you like the shape (change nothing else).
- [ ] Added the import + `WORLD_LIST` line in `worlds/index.js`.
- [ ] `node --check` on the worker + `python3 -m json.tool` on your JSON
      both pass (or just: the worker health page still loads after deploy).
- [ ] Pushed. `GET https://<worker>/api/worlds` now lists your world.

## 5. What a world file does NOT control (by design)

Player physics, items, zombies, rides, room rules, day/night speed,
admin powers, the player list — all of that is game-level and works the
same in every world. A world file is *only* the place: terrain shape,
blocks, water, sky tint, decorations, spawn.
