# BASEPLATE WORLD FILES v2 — the spec for building a whole GAME as a world

This document is the complete contract between a **world file** and the
game client (`baseplate-v2.html`, v14+). Hand this file + the two example
worlds (`island-world.json`, `tycoon-world.json`) to any AI (or write it
yourself) and it can build an entirely new world — **up to and including
a full tycoon game with custom swords and guns, droppers, conveyors,
NPC weapon shops, zombie waves and a win goal** — that every client can
join. The world file goes in this folder (`worlds/`), gets one import
line in `worlds/index.js`, is pushed to the Cloudflare Worker repo — and
it just works: it shows up in every player's **Worlds** menu, they can
switch to it, and the admin powers (give, smite, size, speed,
bring-across-worlds…) all apply there.

---

## 1. What's in a world file (v2)

A world is ONE JSON object. v1 worlds were *places* (terrain only). A
v2 world is a place **plus a game**:

```json
{
  "id": "my-game",  "name": "My Game",  "desc": "…",  "kind": "terrain",

  "spawn": { "x": 0, "z": 0 },          // where players land
  "sky": { "dayTop": "#…", "dayBottom": "#…" },

  "terrain": { … },                     // §3 — the ground (kind: terrain)
  "scatter": [ … ],                     // deterministic trees/rocks

  "items":   [ … ],                     // §4 — custom swords, guns, food
  "build":   [ … ],                     // §5 — static parts (walls, floors…)
  "economy": { … },                     // §6 — money (+ queue: visible pads)
  "logic":   [ … ],                     // §7 — the live entities
  "vars":    { … },                     // v16 — engine overrides · v20 — vars.rules = this world's room rules
  "script":  "…"                        // §9 — optional sandboxed JS
}
```

Every game field is optional — `island-world.json` uses none of them.
A `template` world (the built-in map) may also carry `items` / `build`
/ `economy` / `logic` / `script` — everything below applies the same.

**How deep can it go?** The reference world `tycoon-world.json` is a
complete 4-plot tycoon: claiming plots, a max-4 ranked buy-pad queue,
droppers spouting over belts into collectors that fill raidable vault
plates, weapon cases, a pay-per-wave zombie pad, per-plot auto resets
and admin chat commands — in pure JSON + a short script, no engine
code.

---

## 2. Positions

Everywhere a position appears (`pos`, `to`, `spawn`) it is `[x, y, z]`
in studs, world-centered on (0,0). You may write **`"ground"`** for
`y` and the game resolves it to the terrain surface at that (x, z) at
build time — including on top of `build` parts placed earlier. Use
numbers when you need exact heights.

---

## 3. The terrain recipe (kind: "terrain")

Unchanged from v1 — every field:

```json
"terrain": {
  "size": [176, 176],                  // map footprint in studs [x, z]. 64-400. columns are 1x1 studs
  "seed": 20260922,                    // any integer 1 - 2^31. EVERYTHING derives from it
  "waterLevel": 10,                    // ocean surface height in studs (0 = no water)
  "base": 30,                          // island plateau top height before noise
  "oceanFloor": 3,                     // seabed height
  "noise": [                           // 0-4 octaves, summed. smooth value noise. [] = perfectly flat
    { "scale": 64, "amp": 5.0 },      //   scale = stud wavelength (8-400), amp = stud height
    { "scale": 21, "amp": 1.8 }
  ],
  "island": {                          // OPTIONAL — omit for a flat square map
    "radius": 62, "edge": 26, "rim": 0.55
  },
  "border": {                          // OPTIONAL (v15) — blocky mountain ring that walls the map in
    "width": 26, "height": 30,        //   how many studs wide / how tall at the rim
    "steps": 7, "jitter": 1.4,         //   terrace count (bigger = smoother) + per-column crumbliness
    "block": "stone"                   //   the block the mountains are made of
  },
  "surface": {                         // which block shows on top (checked top-down):
    "default": "grass",
    "edge": { "block": "dirt", "below": 0.85 },
    "beach": { "block": "sand", "below": 12 },
    "underwater": { "block": "sand" }
  },
  "palette": { "grass": "#58a94f", "dirt": "#8a5f3b", "sand": "#e0d29a",
               "stone": "#8d9298", "water": "#2f7fbf", "leaves": "#3f8f3f", "trunk": "#6b4a2b" }
},
"scatter": [
  { "type": "tree", "per": 240, "on": "grass", "min": 0.6, "scale": [0.8, 1.3] },
  { "type": "rock", "per": 600, "on": "grass", "min": 0.5 }
]
```

Terrain math (so you can reason about it): the map is a grid of 1×1
columns; `island` masks the plateau (`t` = 1 on the plateau, 0 at the
seabed, smoothstep across `rim`); height = `round(lerp(oceanFloor,
base + noise, t))`; surface block first-match underwater → beach →
edge → default. Everything is a pure function of `seed`, so every
client generates the identical world without syncing a byte. For a
build-heavy game (tycoons!) use a big flat map: `noise: []`, no
island, `waterLevel` 0 — and a `border` ring for natural walls.
**v15 perf**: terrain physics colliders are greedy-merged (a flat
260×260 arena = ONE collider), so big flat maps are cheap.

---

## 4. `items[]` — custom weapons & consumables

Up to **24 items** per world. Each lands in the hotbar with its own
mesh, icon, name and stats, and works everywhere the classic tools
work: swings hit zombies/players, bullets fire from the real muzzle,
remote players hold them, they can be dropped and picked up.

```json
{
  "id": "void-blade",              // REQUIRED a-z0-9- 2-32, unique in this world
  "name": "Void Blade",            // REQUIRED <= 24 chars (hotbar + shop)
  "icon": "swords",                // lucide icon name, see whitelist below
  "kind": "sword",                 // REQUIRED "sword" | "gun" | "consumable" | "tool"

  "stats": {                       // all optional, sane defaults per kind
    "damage": 35,                  //   damage to zombies (1-500)
    "pvp": 40,                     //   damage to players (0-200)
    "range": 6.4,                  //   sword reach in studs (3-10)
    "cooldown": 0.3,               //   seconds between swings/shots (0.08-2)
    "kb": 30,                      //   knockback (0-60)
    "spread": 1.5,                 //   gun: cone in degrees (0-12)
    "pellets": 6,                  //   gun: bullets per shot (1-8) — shotgun!
    "ammo": 24,                    //   gun: magazine size (0 = infinite)
    "reload": 2.2,                 //   gun: seconds to reload (R key)
    "auto": false,                 //   gun: hold to fire
    "heal": 60                     //   consumable: health restored
  },
  "mesh": {                        // colors/sizes of the built-in mesh builders
    "style": "minigun",            //   v15: gun "minigun" = rotary barrels; tool "coil" | "pet"
    "sword": { "blade": "#8a5cff", "guard": "#2a1f4a", "grip": "#1a1428", "len": 3.2, "glow": 0.85 },
    "gun":   { "body": "#1e2b26", "accent": "#39d353", "len": 1.5, "glow": 0.7,
               "tracer": "#6dffa8", "flash": 1.4 },
    "consumable": { "color": "#f5c542", "size": 1.1 }
  }
}
```

- `glow` (0-1) makes the blade/barrel **emit light** — a glowing
  energy weapon. `tracer` tints the bullet streak; `flash` scales the
  muzzle flash.
- **`tool` items (v15)** are held gadgets — no swing, no fire:
  - `stats.speed` (1-3): while HELD you run this fast (1.7 = a speed
    coil). `stats.jump` (1-3): higher jumps.
  - `stats.pet: true`: a deployable companion — click while holding
    to deploy/recall. It hovers at your shoulder, chases the nearest
    enemy player or zombie inside `stats.radius` (default 26) and
    strikes LIGHTNING for `stats.damage` every ~0.9s once inside
    `stats.zapRange` (default 10). Mesh `style: "pet"` builds the
    drone body; everyone in the room sees the orb and the bolts.
- Icon whitelist (lucide): `coins gem star crown trophy medal sword
  swords axe hammer pickaxe wand sparkles flame zap crosshair target
  bomb rocket shield heart apple gift box key lock anchor leaf droplet
  flask flask-conical briefcase banknote circle-dollar-sign store
  pocket-knife wrench gauge mountain castle skull`.
- World items are referenced everywhere as their plain `id` (`give` on
  buttons, `shop` entries, `pickup` entities). Inside the game they
  live under the hood as `<world-id>.<item-id>`.
- The classic tools `sword`, `gun` (Blaster) and `apple` are always
  available too — your shop can sell them alongside your customs.

---

## 5. `build[]` — static parts

Up to **400 parts**: the floors, walls, roofs, pillars, trim, neon
signs of your map. Parts can be **gated** so buildings APPEAR when
players buy buttons (or claim plots):

```json
{
  "id": "ne-floor",                // OPTIONAL unique id (a-z0-9- 2-32)
  "pos": [0, "ground", 0],        // REQUIRED [x, y | "ground", z]
  "size": [30, 0.6, 22],           // REQUIRED [w, h, d] (0.1-220)
  "color": "#6d7075",              // #rrggbb
  "material": "plastic",           // plastic | neon | glass | metal | wood
  "shape": "box",                  // box | cyl | ball | wedge
  "rot": 0,                        // yaw degrees (visual only for wedges)
  "lift": 0,                       // extra studs added to y
  "noCollide": false,              // decorative only (no physics box)
  "repeat": [6, 5, 0],             // [count, dx, dz] — clone the part
  "requires": ["plot-ne"]          // hidden until ALL these are bought/claimed
}
```

- `neon` = glowing emissive. `glass` = translucent. `metal` = shiny.
  `plastic` tops get the classic studs.
- `wedge` = a right-angle ramp, **always no-collide** (the physics is
  axis-aligned; for walkable slopes use stepped boxes — the engine
  auto-steps 1.5 studs).
- `repeat` clones the part `count` times, each `dx`/`dz` studs apart —
  fences, columns, walls. Every clone shares the height resolved at
  `pos` (so a `"ground"` row follows the surface under the FIRST clone).
- `"ground"` = the top of the highest collidable surface under `pos`
  (terrain OR any collidable part listed earlier in `build[]`), then
  `lift` is added to get the part's CENTER. Parts stack: a part listed
  after a slab it sits on starts at the slab's top. Every size axis
  must be at least 0.1.
- `requires` may name buttons AND claims (§7). Gated parts pop in
  with a scale animation on every screen the moment the requirement
  completes.

---

## 6. `economy` — money

```json
{ "name": "Gold", "symbol": "$", "icon": "coins", "start": 100, "goal": 25000, "queue": 4 }
```

- Money is **per player, per world, saved on their device** — rejoin
  and your balance is right where you left it.
- The HUD chip appears top-right; gains flash green, losses red, and
  collectors pop a floating `+$5` at the drop.
- `goal` is optional: the moment a player's balance reaches it, every
  screen gets the win banner + confetti.
- Money NEVER syncs into other players' wallets — income comes from
  YOUR collectors (§7 droppers; v16: they fill the plot's **vault
  plate**, §7.15), `grant` buttons, zombie bounties and script
  `Game.addMoney`.
- `queue` (v16, 1-6, default 4) — how many of a plot's ranked buy
  pads are visible at once; see §7.2 `order`.

---

## 7. `logic[]` — the live entities

Up to **160 entities**. Every entity shares:

| field | what |
|---|---|
| `id` | REQUIRED unique `a-z0-9-` 2-32 — other things reference it |
| `type` | REQUIRED (the list below) |
| `pos` | REQUIRED `[x, y \| "ground", z]` |
| `size` | trigger volume `[w, h, d]` (default per type) |
| `rot` | yaw degrees |
| `requires` | hidden/disabled until ALL named buttons are bought / plots claimed |
| `plot` | (types that make sense) this thing belongs to that claim — see `claim` |

### 7.1 `claim` — the plot door (tycoons start here)
```json
{ "id": "plot-ne", "type": "claim", "pos": [0, "ground", 11], "size": [10, 7, 1],
  "name": "NE PLOT", "cost": 0 }
```
A doorway with a translucent barrier. The **first player to touch it
claims the plot** (paying `cost` if set): the sign above shows their
name, the barrier lets only them through (on their screen), and
everything with `requires: ["plot-ne"]` appears. One claim per plot,
forever — until an admin resets the world (§10).

### 7.2 `button` — the buy pad
```json
{ "id": "ne-b-drop2", "type": "button", "pos": [-6, "ground", 7.5],
  "label": "Dropper 2", "cost": 150, "plot": "plot-ne", "order": 3,
  "maxBuys": 1, "costScale": 2.2,
  "give": "void-blade", "grant": 500, "incomeMult": 2,
  "requires": ["plot-ne"],
  "patch": { "ne-drop1": { "every": 2.5 } } }
```
**STEP ON IT to buy** (v15 — no E key). A small floating label
(name + price) hovers and bobs above the pad; the pad glows green
when you can afford it, gray when you can't, and nags politely at
most every 2.4s while you stand there broke. `requires` hides the
PAD ITSELF until its tier unlocks — gate buttons on earlier buttons
and they **pop in** the moment the requirement is bought. That is how
you build progressive reveal trees (claim → starter pads → walls →
second floor…). If `plot` is set, only the plot owner can buy
(step-on is silent for everyone else). On buy (every screen applies
it instantly):
- `requires` gates referencing this button open (buildings appear…)
- `give` puts a world item in the buyer's hotbar (v16: the pad renders
  as a glass **weapon case** with the item spinning inside); `grant` pays them
- `incomeMult` multiplies the plot's collector income (stacks ×2 ×3…)
- `patch` retunes OTHER entities live (see the whitelist below)
- `maxBuys` > 1 with `costScale` makes repeatable upgrades
  (`cost × costScale^buysSoFar`)

**v16 `order` (1-9999) + `economy.queue`** — the PAD QUEUE. Buttons
with a `plot` AND an `order` are ranked: only the first `queue`
(default 4) open + unbought pads are visible; buy one and the next
ranks up with a pop. A clean progression line instead of a wall of
pads. Buttons without `order` (weapon cases, event pads) are never
queued.

`patch` may only change these fields, on these types:
`dropper.every value` · `conveyor.speed` · `collector.value` ·
`killbrick.damage` · `teleport.to cooldown` · `pad.power dur amount` ·
`spawner.every max reward night`.

### 7.3 `dropper` — spawns the money
```json
{ "id": "ne-drop1", "type": "dropper", "pos": [8, "ground", 2],
  "plot": "plot-ne", "every": 4, "value": 5, "requires": ["plot-ne"],
  "tier": 3, "color": "#4a5568", "dropOff": [0, 3.2],
  "drop": { "color": "#f5c542", "size": 0.95 } }
```
Stands beside your conveyor and drops a gold cube every `every`
seconds — **but only while the plot owner is in the world** (their
client simulates it; income pauses when they leave — classic tycoon
rules). `value` is what the collector pays per drop; `drop` styles
the cube.

**v20 `tier: 1-5`** — which MACHINE this is: 1 Classic (gray box),
2 Twin (blue-steel, twin feed pipes), 3 Turbo (amber + hazard
stripes + spinning fan), 4 MEGA (big purple rig, rotating core),
5 Diamond (cyan crystal). Omit `tier` and it is read from the id
(`mega`→4, `diamond`→5, `drop2/3`→2/3).

**v20: droppers are GATED like buildings** — a dropper with
`requires` is invisible (and collider-free) until bought. Only your
starter dropper appears with the plot; the rest must be bought.

**v16 `dropOff: [ox, oz]` (WORLD-axis offset, ±8)** — where the spout
releases the ore, relative to the machine. Put the offset over the
BELT: the drop falls onto the conveyor (not onto the dropper's own
collider — that was the v15 "drops get stuck" bug) and rides to the
collector. The machine draws a spout arm to the drop point.

### 7.4 `conveyor` — carries players AND drops
```json
{ "id": "ne-conv", "type": "conveyor", "pos": [0, "ground", 2],
  "size": [20, 0.5, 4], "dir": [1, 0], "speed": 6, "requires": ["plot-ne"] }
```
Scrolling chevron belt. `dir` is the travel direction `[dx, dz]`
(length ≤ 1, not both zero). Drops ride it into the collector; players
standing on it get carried too.

### 7.5 `collector` — drops become money here
```json
{ "id": "ne-col", "type": "collector", "pos": [-12.5, "ground", 2],
  "size": [5, 8, 6], "value": 5, "plot": "plot-ne", "requires": ["plot-ne"] }
```
Drops that touch it vanish in a flash and **the plot owner gets
`value` × their income multipliers**. Place it at the end of the belt.

### 7.6 `killbrick`
```json
{ "id": "kill-1", "type": "killbrick", "pos": [62, "ground", -62],
  "size": [8, 1.2, 8], "damage": 1000 }
```
Touching it hurts (default: lethal). Translucent red.

### 7.7 `teleport`
```json
{ "id": "tp-ne", "type": "teleport", "pos": [10, "ground", -10],
  "to": [30, "ground", -20], "cooldown": 4 }
```
One-way pad, glowing blue disc. Per-player `cooldown` seconds.

### 7.8 `checkpoint`
```json
{ "id": "cp-1", "type": "checkpoint", "pos": [11, "ground", 8], "heal": true }
```
Touch it to make it your respawn point (green beam marks it). Heals
you unless `heal: false`.

### 7.9 `pad` — buff pads
```json
{ "id": "pad-speed", "type": "pad", "pos": [-7, "ground", -6],
  "effect": "speed", "power": 2.0, "dur": 8 }
```
`effect` ∈ `speed | jump | heal | launch` — speed/jump multiply your
stats for `dur` seconds; heal restores `power` health; launch is a
jump pad (`power` = studs/sec of yeet, try 78).

### 7.10 `npc` — dialogue + weapon shop
```json
{ "id": "npc-smith", "type": "npc", "pos": [12, "ground", -1], "rot": 180,
  "name": "Smith the Weaponsmith", "color": "#0D69AC",
  "lines": ["Welcome to my stall!", "Zombies come at night — arm yourself."],
  "shop": [ { "item": "steel-sword", "cost": 100 },
            { "item": "ray-gun", "cost": 4000 } ] }
```
Talk with **E** — lines type out, then the shop panel opens (if any).
Shop entries sell world items OR the classic `sword`/`gun`/`apple`.
The NPC is a blocky villager with a name tag; `color` is the shirt.

### 7.11 `spawner` — zombie waves (with bounties)
```json
{ "id": "night-a", "type": "spawner", "pos": [76, "ground", -76],
  "every": 45, "max": 5, "night": true, "reward": 15 }
```
Exactly one client (the room leader) simulates it, so waves are
identical everywhere. `night: true` = only spawns between 19:00 and
06:00 game time. **`reward` pays the KILLER** (the player who landed
the final hit, wherever they are). Zombie stats themselves come from
the room's Rules tab.

### 7.12 `pickup`
```json
{ "id": "pk-sword", "type": "pickup", "pos": [7, "ground", 7],
  "item": "steel-sword", "respawn": 60 }
```
A spinning floating item anyone can grab (E). Hidden once taken;
`respawn` seconds later (0 = once ever).

### 7.13 `door`
```json
{ "id": "door-1", "type": "door", "style": "wood", "pos": [24, 13, -130.5],
  "size": [5, 8, 0.5], "rot": 0, "swing": 1, "range": 7, "color": "#7a5230" }
```
A real hinged door with a frame (v18). `style` `"wood"` (solid panel,
recessed insets, brass knobs) or `"glass"` (translucent, the default).
`rot` 0/90/180/270 turns the whole door (the collider follows);
`swing` 1 opens toward local −z (into a house whose front faces +z),
−1 the other way; `range` 3-20 studs.
Without `plot` it opens AUTOMATICALLY when anyone (you or any remote
player) walks up and shuts behind them — every house in Maple Grove
works this way. With `plot` it opens only for the plot owner; with
`requires` it opens forever once bought. Admins can force every public
door with `Game.setDoors('open'|'locked'|'auto')`. Doors further than
90 studs from the camera are not drawn (phone performance).
Entity sizes are 0.5-120 on every axis.

### 7.14 `sign`
```json
{ "id": "st-maple", "type": "sign", "style": "board", "pos": [-104, 12, -84],
  "rot": 0, "lines": ["Maple St"], "width": 6, "height": 7,
  "color": "#1f7a4a", "textColor": "#ffffff" }
```
Signs are decoration, never UI clutter (v18). Styles:
- `"float"` — small outlined text floating in the air, fades out past
  `range` studs (use for ONE world title, not everywhere).
- `"board"` — a real board on two posts; `height` = how high the board
  sits (0.5-12), `width` 2-24. Text is printed on both faces.
- `"wall"` — a plaque mounted flat: `pos` is the board CENTER; put it a
  hair in front of a wall (store fronts, "ARMORY" plaques).
`rot` sets which way the board plane faces (0 = faces ±z). Up to 4 lines.

### 7.15 `claimer` — the MONEY VAULT plate (v16)
```json
{ "id": "ne-vault", "type": "claimer", "pos": [11, "ground", -3],
  "plot": "plot-ne", "label": "Money Vault",
  "steal": 0.25, "cool": 60, "requires": ["plot-ne"] }
```
The plot's bank. A gold dais with a live `$balance` hover label —
this is where collector income lands now (instead of the owner's
wallet). **The owner steps on it to sweep the whole balance** into
their wallet. **Anyone else who steps on it skims `steal` (default
25%) of what's inside** — then the plate seals for `cool` seconds
(default 60). Steal a lot and the owner sees a warning toast. Build
walls if you want to keep your gold.

### 7.16 `zwave` — the zombie-wave pad (v16)
```json
{ "id": "wave", "type": "zwave", "pos": [0, "ground", 0], "label": "Zombie Wave",
  "cost": 500, "count": 4, "radius": 50, "reward": 100 }
```
A skull totem. **Step on + pay `cost` and `count` zombies rise at
random spots in a `radius` ring around the pad** — through the normal
zspawn channel, so every screen agrees. **Spammable** as long as you
can pay; the room's zombie cap (`vars.maxZombies`, §3) is the only
brake. Kills pay `reward` to the killer. With this you control when
zombies exist at all — no default spawning.

---

### 7.17 `swing` — a playground swing set (v18)
```json
{ "id": "swing-a", "type": "swing", "pos": [16, 12, -38], "seats": 3,
  "length": 7, "rot": 0, "color": "#2f6fb5" }
```
An A-frame with 1-3 seats (`length` 4-10 = rope length). Walk up and
press **E** (or tap the prompt) to sit, hold **W / S** to pump, **SPACE**
to hop off with a fling. Each seat is a damped pendulum simulated by
its rider and streamed to the room, so everyone sees you swing.

### 7.18 Weapon stands that you keep (`button.reclaim`, `vars.loseOnDeath`) (v18)
```json
{ "id": "ne-arm-steel-sword", "type": "button", "plot": "plot-ne",
  "give": "steel-sword", "cost": 100, "reclaim": true, "pos": [112, 12.6, -76] }
```
A `give` button with `reclaim: true` is a weapon STAND: pay once, and
from then on stepping on it re-equips the item for free whenever you
don't already carry it. Pair it with `"vars": { "loseOnDeath": true }`
— dying clears your tools, you walk back to your armory and grab them
again. The stand keeps its display case (hidden past 95 studs).

### 7.19 Orphan plots (v18)
A claim whose owner is no longer in the room (a stale save, a crashed
tab) is released automatically ~7 s after you connect, so plots are
never stuck "owned" by ghosts.

### 7.20 Water you can swim in (v19)
Any build part with `"material": "water"` is real water: translucent,
rippling (one shared texture, so ten pools cost the same as one), no
collider. Chest-deep = **swimming** (Roblox-style): you float head-up,
SPACE swims up, look down while moving to dive, look up to rise, C sinks,
jump at the surface to hop out. Water breaks every fall and tints the
screen blue while your camera is under it. Recipe for a pool:

1. Dig the pit with `terrain.carve` (below).
2. Line it with tile parts (floor + 4 walls), then drop ONE water box in
   whose top sits ~0.6 below the ground. Add steps/ladders to climb out.

`terrain.carve: [{ x, z, w, d, depth, block? }]` (≤ 16) lowers the
terrain inside that rectangle by `depth` blocks (`block`: grass | dirt |
sand | stone for the pit walls). Collision follows the carved ground.

### 7.21 `laser` — buyable laser doors (v19)
`{ "type":"laser", "id":"plot-ne-laser", "plot":"plot-ne", "pos":[x,y,z],
"rot":0, "size":[w,h,0.8], "requires":"ne-b08", "panel":[x,y,z] }`.
Until the `requires` button is bought the doorway is open to everyone.
After that the owner toggles it at the `panel` console (press E) or an
admin runs `/laser`. ON = red beams that block and zap (20 hp + knock
back) everyone except the owner. `size` must have 3 numbers.

### 7.22 `upgrader` — conveyor multiplier (v19)
`{ "type":"upgrader", "id":"ne-up1", "plot":"plot-ne", "pos":[x,y,z],
"rot":0, "size":[t,h,w], "mult":1.5, "color":"#39c7d8", "requires":"ne-b10" }`.
Place it OVER a conveyor: every drop that rides through is worth `mult`
times more (once per upgrader; different upgraders stack). Replaces the
old incomeMult buttons.

### 7.23 Progression, claims and toggles (v19)
- Progression route: give every plot button an `order` and chain them
  with `requires: [plot, "ne-b03"]` — a pad only appears once the
  button before it is bought, and `economy.queue` (default 4; Gold
  Rush uses 3) caps how many pads show at once, so players only ever
  see the next steps.
- Button labels only show while their pad is visible (and within ~70
  studs), so a fresh map has no floating text.
- One player can own **one** plot. A second claim is refused.
- `claim.open: true` — anyone may walk into the plot (the door still
  only swings for the owner unless laser doors say otherwise).
- Synced toggles (`state.tg`) back laser doors and manual doors. The
  relay stores them, so late joiners see the same state.

### 7.24 Manual house doors (v19)
`vars.doors: "manual"` (or `door.mode: "manual"`) makes every non-plot
door a press-E / tap-the-prompt door: "Open door" / "Close door". The
state is a synced toggle, so a door you open is open for everyone.
Admin door modes (`/doors`, `Game.setDoors`) still override it.

### 7.25 `car` — NPC traffic that yeets players (v20)
```json
{ "id": "car-red", "type": "car", "pos": [-125.5, 12.2, 105.5],
  "wps": [[-125.5, 105.5], [125.5, 105.5], [125.5, -105.5], [-125.5, -105.5]],
  "speed": 17, "color": "#C4281C", "driver": "#2f6fb3", "damage": 25,
  "phase": 240 }
```
A blocky Roblox car with an NPC driver looping the `wps` waypoint
circuit (3-40 `[x, z]` points; the loop closes itself). Every screen
simulates its own copy with the phase taken from the wall clock, so
traffic never needs syncing and never drifts apart. `speed` 4-40
studs/s, `phase` staggers cars around their loop, `color`/`driver`
style it. Clip one and it flings you down the road with the full
Roblox tumble — `damage` is the hit.

### 7.26 `vars.rules` — this world's room rules (v20)
```json
"vars": { "rules": { "fallDamage": false, "knockback": 22 } }
```
A world can preset its own ROOM RULES — any subset of the admin
Rules tab (gravity, speeds, damage, knockback, smite tuning,
zombies...). Entering the world applies them (the Rules tab shows
"<world> preset"); admin tweaks still broadcast live and the relay
keeps them per room, so admin > world > factory defaults.

---

## 8. How it all syncs (multiplayer model)

| thing | who owns it | how it syncs |
|---|---|---|
| money | each player | saved on their device; shown in their HUD |
| buys / claims / pickups | one event each | `tyc` events — every client applies them, so gated buildings unfold on every screen at once |
| plot vaults (v16) | plot owner's client | `tyc` `bank` events throttle-sync the balance to every screen + the relay's stored state |
| vault raids (v16) | the raider's client | the cut lands in the raider's wallet; the owner gets a `rob` toast; the balance syncs |
| plot resets (v16) | every client | when a player leaves (`bye`), their plots reset to day one everywhere; a `tyc` `pr` event also clears the relay's stored copy |
| drops | plot owner's client | `dspawn` event + deterministic sim everywhere; only the owner's client fills the vault |
| zombie waves | the pad presser | normal zombie replication; `zrew` pays the killer |
| world progress | the relay (v6+) | stored in the room's Durable Object storage and pushed to every joiner — **your tycoon survives everyone leaving** (a v7 relay also stores vaults + plot resets) |
| late joiners | peers + relay | new clients ask (`tycq`); everyone answers chunked snapshots (incl. vault totals); the relay also pushes its stored copy |

The relay stays dumb: it just stores + forwards the compact state map.
An admin's **Reset World Progress** (Server tab) broadcasts a reset,
clears the relay's copy, and every plot/button/pickup returns to day
one (player money is kept). v16 also auto-resets a plot when its
owner leaves the world, and ignores stored claims whose owner isn't
in the room anymore (works even against an old v6 relay).

---

## 9. `script` — the deep-logic escape hatch (optional, ≤ 20000 chars)

When the declarative entities aren't enough, add a sandboxed JS script.
It runs identically on every client with a small, safe `Game` API:

```js
Game.on('join', function (name) { Game.toast(name + ' joined!'); });
Game.every(60, function () { Game.addMoney(25); Game.toast('Online bonus +$25'); });
Game.on('buy', function (label) { if (label === 'MEGA Dropper') Game.banner('MEGA!'); });
Game.onNet('boss', function (d) { /* custom net events */ });
```

**Hooks:** `tick(dt)` (visuals only!) · `join(name)` · `buy(label, buyer)`
· `claim(plotId, ownerName)` · `collect(value, plotId)` · `win(name)`
· `tp(entityId)` · `chat(text, name, isLocal)` · `leave(playerId)` ·
`cmd(text)` (v16: a chat line starting with `/` — return `true` to
claim it; claimed lines are NOT sent as player chat) ·
`zwave(count)` (v16: someone pressed a zombie-wave pad).

**API:** `Game.money()` · `Game.addMoney(n)` · `Game.spendMoney(n)` ·
`Game.give(itemId)` · `Game.heal(n)` · `Game.hurt(n)` ·
`Game.tp(x,y,z)` · `Game.banner(text)` · `Game.toast(text)` ·
`Game.bought(buttonId)` · `Game.claims()` · `Game.players()` ·
`Game.myId()` · `Game.time()` · `Game.dayTime()` · `Game.config` (the
whole recipe, read-only) · `Game.after(sec, fn)` · `Game.every(sec, fn)`
(local timers — self effects) · `Game.broadcast(key, data)` /
`Game.onNet(key, fn)` (custom synced events ≤ 700 B) · `Game.log(…)` ·
(v16 admin helpers) `Game.tuneItem(itemId, stats)` — retune a weapon
or pet LIVE with validator clamps · `Game.itemStats(itemId)` — read
the live stats · `Game.zombies(n, x, z, r)` — spawn a wave around a
point · `Game.resetWorld()` — broadcast a full reset ·
`Game.resetPlot(plotId)`.

**v25 block-physics toolkit (natural-disaster maps):**
`Game.debris(x, y, z, w, h, d, color, count, power)` — spawn up to 40
physics blocks (`w×h×d` studs each, `#rrggbb` color) scattered around
(x,y,z), launched with `power` (0 = just drop). Blocks tumble, bounce,
stack and settle via the same v24 rigid-body engine that crumbles the
smash house; settled blocks linger ~4s, fade, and recycle (cap 120
live). `Game.blast(x, y, z, radius, power)` — a shockwave that hurls
every loose block (and any house rubble) away from a point. Both are
LOCAL visual effects: drive them from `Game.onNet`/`Game.broadcast`
hooks so every screen runs the same disaster, e.g.

```js
Game.onNet('quake', function (d) {
  var p = Game.pos();                                  // my own screen's chunk
  Game.debris(p.x, p.y + 6, p.z, 3, 3, 3, '#8a7a63', 24, 26);
  Game.blast(d.x, d.y, d.z, 40, 30);
});
```


**v18 world-admin API:** `Game.isAdmin()` (me, verified by the relay
admin code) / `Game.isAdmin(fromId)` — trust an `onNet` message only
when the SENDER is an admin · `Game.setTime(h)` (local sky; broadcast
it to apply for everyone) · `Game.setDoors('open'|'locked'|'auto')` ·
`Game.adminBuy(buttonId)` · `Game.buttons(plotId?)` · `Game.myPlots()` ·
`Game.items()` · `Game.pos()`. Both shipped worlds implement
admin-only chat commands this way (`/help` lists them).

**Rules the linter enforces (the script is REJECTED if it uses any):**
`fetch XMLHttpRequest WebSocket localStorage sessionStorage indexedDB
document window globalThis self top parent location navigator eval
Function import postMessage Worker crypto Date setTimeout setInterval
requestAnimationFrame alert confirm prompt`. The script can't touch
the page or the network — only the Game API. Money added by a script
goes only to the local player; use `Game.broadcast` for shared state.
`tick` runs on every client for visuals — never for game rules (frames
aren't in lockstep); shared logic belongs in events.

---

### 9.1 Admin commands from a world script (v19)
```js
Game.command({ id: 'money', cat: 'Money', label: 'Give money',
  desc: 'Add cash to a player (or everyone).',
  args: [{ n: 'amount', t: 'num', d: 1000, min: -1e6, max: 1e6 },
         { n: 'player', t: 'player', o: ['all'] }],
  quick: [['+$1k', { amount: 1000 }]],
  run: function (a) { Game.addMoney(a.amount); return 'Done'; } });
```
Every command shows as a card in **Menu → Admin → World**, grouped by
`cat` with a search box, AND works in chat as `/id arg1 arg2`. The
engine checks admin before `run` is called. Arg types: `num`, `text`,
`pick` (`o` = options), `player` (returns a player id, `'all'` if listed
in `o`; chat accepts `me`), `plot` (returns an id like `plot-ne`).
`run` may return a string, shown as a toast. Up to 60 commands, 4 args.
Handlers of `Game.onNet` events that do admin things must check
`Game.isAdmin(from)` themselves.

Extra v19 helpers: `Game.plotIds()`, `Game.plotOwnerName(id)`,
`Game.toggle(id)`, `Game.setToggle(id, on)`, `Game.setAllDoors(open)`,
`Game.playerPos(id)`, `Game.playerName(id)`.

The Admin menu has tabs **World** (this world's commands) · Players ·
Rules · Zombies · Server; engine commands that work everywhere are
listed under "Everywhere".

## 10. Hard rules (the client validates every recipe)

Everything is checked on load; ANY failure = the world never appears
(and a player pointed at it falls back to the Baseplate World):

1. Valid JSON, no comments, no trailing commas.
2. `id` `^[a-z0-9][a-z0-9-]{2,31}$`, unique, not `baseplate`.
3. `kind` `template` or `terrain`; terrain fields as §3 (size 64-400,
   waterLevel < base, ≤ 4 noise octaves 8-400 / 0-30, island
   radius + edge ≤ max(size)/2, `border` width 4-80 / height 1-120 /
   steps 1-12 / jitter 0-3 and width×2 < min(size), palette
   `#rrggbb`).
4. Spawn inside the map (`|x| < size/2 - 8`, same for z).
5. `items` ≤ 24; ids `^[a-z0-9][a-z0-9-]{1,31}$` unique; kinds
   `sword|gun|consumable|tool`; stats within §4 ranges (tools:
   speed/jump 1-3, pet radius 8-60, zapRange 4-30); mesh colors hex;
   mesh.style ∈ `coil|minigun|pet`; icons from the §4 whitelist.
6. `build` ≤ 2500 parts (v20 — static parts are merged per material, so
   parts are cheap; gated parts merge per `requires` group); pos `[-1000..1000, -200..500 | "ground",
   -1000..1000]`; sizes 0.1-420 on x/z, 0.1-220 on y; wedges/boxes take `rot`; material/shape from the lists;
   repeat `[1-40, ±500, ±500]`.
7. `economy`: name ≤ 16, symbol ≤ 3 chars, start/goal 0-10^9, icon
   whitelisted, `queue` 1-6. `vars` (optional): `maxZombies` 1-40
   (applied on load, restored on world exit); `loseOnDeath` boolean;
   `doors` `auto|manual`; `rules` = room-rule presets (§7.26).
8. `logic` ≤ 320; unique ids; per-type fields within §7 ranges; every
   `requires`/`plot`/`give`/`shop`/`pickup` reference must EXIST;
   `patch` keys must be §7.2-whitelisted fields on patchable types;
   npc lines ≤ 6 × 140 chars; shops ≤ 8 entries; button `order` 1-9999;
   dropper `dropOff` two × ±8; claimer `steal` 0.05-0.9 / `cool` 5-600;
   zwave `cost` 0-10^9 / `count` 1-8 / `radius` 10-120 / `reward` 0-10^4;
   car `wps` 3-40 × ±1000 / `speed` 4-40 / `damage` 1-200.
9. `script` ≤ 20000 chars and lint-clean (§9).

## 11. Publishing checklist

- [ ] Copied an example world, renamed `<your-id>.json` in `worlds/`.
- [ ] Unique `id`, honest `name` + `desc` (players see them in the menu).
- [ ] Added the import + `WORLD_LIST` line in `worlds/index.js`.
- [ ] `python3 -m json.tool <your-id>.json` passes; `node --check` on
      the worker passes after pasting it in (or the health page loads).
- [ ] Pushed. `GET https://<worker>/api/worlds` lists your world.
- [ ] Joined it, claimed a plot, bought a button, fired a custom gun —
      then used Admin → Server → **Reset World Progress** to test day
      one again.

## 12. The reference games

**tycoon-world.json — Gold Rush Tycoon (v18).** A flat 400×400 arena in
a stone border ring. Four HUGE 64×64 two-storey bases (22-stud ground
floor, 20-stud upper floor — high ceilings for the 3rd-person camera)
at the corners of a central plaza with the $500 zombie-wave skull. The
base doorway faces the boulevard and only the owner can walk through
it. 12 ordered buy-pads (queue of 4): FREE dropper → faster drops → 2nd
dropper → walls → 3rd dropper → 2nd floor + stairs → MEGA → upper walls
→ roof + towers → DIAMOND → income ×1.5 → ×2. Every base has an ARMORY
wall of reclaim weapon stands (§7.18, `loseOnDeath` on). Admin
commands: `/help /money /setmoney /give /weapons /weapon /pet /zombies
/unlock /heal /tp /resetplot /reset /time /announce`.

**neighborhood-world.json — Maple Grove (v18).** A LIFE-SIZE suburb
(~3 studs per metre): two streets + two avenues with sidewalks, lamps
and parked cars, 20 houses you can walk into (auto wood doors, living
room, bedroom, kitchen), a corner store with a glass door, a basketball
court and a big park (fountain, pond, slide, two working swing sets).
Admin commands: `/help /tp house 1-20|park|store|court|pond|swings|spawn
/time /doors open|close|auto /party /heal /announce`.

### 7.27 `mover` — the moving platform (v21)
```json
{ "id": "mover1", "type": "mover", "pos": [-5, 14, 80],
  "to": [10, 0, 0], "speed": 7, "pause": 0.5,
  "size": [5, 1, 5], "color": "#4aa3e0", "phase": 0 }
```
Glides from `pos` to `pos+to` and back (smoothstep easing, `pause`
seconds at each end), on wall-clock phase — every screen agrees where
it is with zero network traffic. Anyone standing on it rides along.
`phase` (seconds) staggers multiple movers on the same span. The obby
classic: crossing lava, timing gaps, climbing shafts.

### 7.28 `lamp` — the street lamp (v21, upgraded v22)
```json
{ "id": "lamp-s3", "type": "lamp", "pos": [-90, 24.7, -44],
  "color": "#ffe9b0", "intensity": 2.2, "range": 34,
  "radius": 3.4, "pool": 0.5, "headSize": 0.5 }
```
A LIGHT SOURCE, not a mesh — pair it with ordinary `build[]` posts
and neon heads. v22 LIGHTING KIT: every lamp builds its own emissive
bulb, additive glow sprite and a pool of light on the ground below
(it finds the ground itself), and the nearest 8 lamps also get REAL
pooled point lights — so a whole street reads as lit at night for the
cost of 8 lights. Intensity rides the day/night cycle (on at dusk,
blaze at midnight, off at dawn). New knobs: `radius` (1–8, glow size,
default 3.4), `pool` (0–1, ground-light strength, default 0.5),
`headSize` (0.25–1.5, bulb size). Admin patches retune `intensity`,
`color`, `range` live.

### 7.29 NPC traffic rules (v21)
`carSpeed` (0.25–2.5, ×traffic), `carYeet` (5–150) and `carDamage`
(1–200) are ROOM RULES now — per-world presets in `vars.rules`, live
admin sliders in the Rules tab. A car clip yeets with `carYeet` power
(spinning Roblox fling) and deals `carDamage`.

### 7.30 The worlds (v23)

* **baseplate** — the classic flat builder's canvas.
* **island-world** — terrain + water.
* **tycoon-world** — Gold Rush: plots, droppers, raids. Every weapon
  is its OWN case — claim a plot and all 8 weapon pads (sword → storm
  pet) are visible with the weapon spinning inside; buy them one by
  one, re-equip free forever (`reclaim`). v23: all 32 display cases
  sit ON real platform strips spaced 7 studs (two museum rows per
  plot, gold center line); `economy.epoch: 22` (see §7.36 — bumping
  it resets everyone's saved buys/claims; claims only count while
  their owner is actually in the room).
* **neighborhood-world** — the suburb: 22 street lamps that light up
  at night, NPC traffic yeets on contact (tunable rules), two park
  trampolines (§7.35), NPC cars glow at night (headlight + taillight
  sprites).
* **obby-world** — Rainbow Rush v4: see §7.33.

### 7.31 `spinner` — the rotating hazard bar (v21.1 obby kit)
```json
{ "id": "spin-1", "type": "spinner", "pos": [0, 10, 100],
  "size": [14, 1.1, 1.2], "speed": 70, "arms": 2,
  "height": 2.2, "kill": true, "phase": 0, "color": "#d1332a" }
```
The classic obby windmill. `size` is the BAR — `[length, height,
thickness]`. It sweeps around a hub pole on wall-clock phase (zero
network sync; `phase` in seconds staggers rotors). Fields:
* `speed` (−360..360, degrees/second; negative spins the other way)
* `arms` (1–4 bars radiating from the hub, default 2)
* `height` (0–20, bar centre above the entity pos — default 2.2 is
  just jumpable with `jumpPower` 48)
* `kill` (default `true`): a red lava bar that hurts like a
  killbrick (`damage` optional, default 1000); `kill:false` = a solid
  gray rotor that BONKS players flying — the fun rideable kind
* `color` (hex, default red for kill / gray for bonk)
The hub pole is a real collider — hug it to duck, or jump the bar.
Admin-patchable: `speed` (live).

### 7.32 `blink` — the disappearing platform (v21.1 obby kit)
```json
{ "id": "blink-1", "type": "blink", "pos": [3, 9, 272],
  "size": [5, 1, 5], "period": 4.2, "on": 0.58,
  "phase": 1.15, "color": "#4aa3e0" }
```
Solid for the `on` share of every `period` seconds, then ghosts
away — anyone standing on it drops. `phase` (seconds) staggers a
staircase of blinks so every screen agrees on the rhythm (wall
clock, no sync). Re-appearing under a player pops them ON TOP
instead of trapping them; the last moments before a vanish pulse a
warning glow. Admin-patchable: `period`, `on` (both live).

### 7.33 obby-world — Rainbow Rush v4 (v23)
REDESIGNED to be SIMPLE and EASY (the v21.1 version was too hard
and parts clipped): 156 build parts + 64 entities, ~21 KB, 8 easy
stages — rainbow steps with safety rails, a wide beam walk with one
slow spinner, a TRAMPOLINE alley (steer while airborne!), a
forgiving blink bridge, two slow movers over lava, an easy spinner
gauntlet with a rideable bonk rotor, a launch-pad finale — and then
THE PARKING LOT: a HUGE striped lot (118 × 130) with six lamp posts,
an attendant booth, TWO drivable cars (the life-size CYBERTRUCK + a
blocky runabout — §7.34), a telepad home, and a COLLAPSIBLE HOUSE to
smash with the truck (§7.37 — it rebuilds every 25 s). 8
checkpoints; the kill floor at y −30 runs under everything.
Regenerate with `scripts/gen_oby3.py` or author a new one per §8.

### 7.34 `vehicle` — the drivable car (v23: life-size)
```json
{ "id": "cybertruck", "type": "vehicle", "pos": [0, 16.2, 500],
  "rot": 0, "model": "cybertruck", "speed": 42, "accel": 14,
  "turn": 1.15, "color": "#c3c8cf" }
```
A car the players DRIVE. Walk up → the `Drive` prompt (E or tap) →
joystick / WASD steers (fwd/back = throttle, left/right = steer),
E hops out beside the car. `model` is `cybertruck` (default) or
`blocky`:
* **cybertruck** — LIFE-SIZE: 15 studs nose to tail (the player is
  5.4), a one-piece stainless wedge with the full-width front light
  bar, wraparound glass canopy, black cladding + wheel-arch band and
  the rear red strip. The cabin is tall enough that the driver RIDES
  VISIBLE — seated on a real bucket seat (dashboard, steering wheel,
  console) seen through the transparent glass. Its headlight is a
  REAL spotlight at night (620 cd) and it SMASHES house panels
  (§7.37) above ~13 studs/s.
* **blocky** — the chunky 10-stud runabout; the driver hides (its
  cab is too small for a seated rig).
Tuning: `speed` (8–70 top speed studs/s), `accel` (4–40), `turn`
(0.4–2.6 rad/s at full lock, scales with speed). The car is a REAL
collider (walking players get flung along its direction of travel —
diagonal, like every v23 yeet), follows the ground, and bounces off
walls. At night both models get white/red glow bars — taillights
flash when braking. Multiplayer: the driver broadcasts the car's pose
at ~8 Hz (`veh` world events — no worker changes needed); other
screens ease their copy toward it (and their houses smash on contact
with the eased pose). Admin patches retune `speed` / `accel` live.

### 7.35 `trampoline` — the bounce pad (v22)
```json
{ "id": "park-tramp-big", "type": "trampoline",
  "pos": [20, 12.5, -5], "radius": 5, "power": 70, "color": "2f6fb3" }
```
A round trampoline with legs and a colorful ring. The bed is a real
collider you can stand on — but anyone whose feet touch it while
falling (or standing) gets LAUNCHED with `power` velocity (30–110,
default 64 ≈ 14 studs of air). The ring flashes and the bed squashes
on every bounce. `radius` is 2–9. Walking across it still boings you
— classic playground behavior. Admin-patchable: `power`.

### 7.36 `economy.epoch` — the progress reset lever (v22)
```json
"economy": { "name": "Gold", "symbol": "$", "start": 25, "goal": 25000,
             "epoch": 22 }
```
The relay stores every buy/claim so progress survives empty rooms.
Bump `epoch` to a new number and every client IGNORES (and clears,
relay-side) progress stored under the old epoch — a clean slate for
everyone, no admin action needed. Peer snapshots carry their epoch;
relay-stored state without one is legacy and is ignored by epoch'd
worlds. v22 also fixed orphaned claims: a stored claim only counts
while its owner is actually in the room (MP ids are per-session).

### 7.37 `house` — the collapsible house (v23, v26 total collapse)
```json
{ "id": "smash-house", "type": "house", "pos": [34, 15.25, 552],
  "size": [20, 4.6, 16], "rebuild": 25, "rot": 1,
  "wall": "#e8e0d0", "roof": "#c0392b", "trim": "#8a6a44" }
```
A small basic home assembled from BREAKABLE panels: four panel-grid
walls (an open doorway + window glass), two roof slopes and the
gable ends. Drive a `vehicle` (§7.34) through it above ~13 studs/s
and the panels it touches BLAST OUT along the car's direction — and
v26 takes the WHOLE house with them: a DEMOLITION WAVE ripples out
from the impact, nearest panels first, over about a second — walls
buckle outward, the roof pancakes in — until every single panel is
physics rubble on the slab. The v24 PHYSICS ENGINE (§7.40) then
makes each piece TUMBLE, bounce, stack on the others and slide to
rest as a real PILE that keeps lying there (it fades only near the
`rebuild` moment, or ~26 s on a one-shot). Driving through the pile
kicks the pieces around. Smite lightning triggers the same total
collapse from its strike point.
Each wall is a real collider until it loses its first panel (then
you can walk through the hole your truck made). When every panel
is down, the house rebuilds itself after `rebuild` seconds (0 =
one-shot — it stays demolished) with a pop-in, ready for another
run. `size` is `[width, wallHeight, depth]` (footprint 8–30 each,
height 3–8); `rot` in DEGREES turns the door (0 = −z, 90 = −x, 180 = +z, 270 = +x). Colors:
`wall`, `roof`, `trim`. Admin-patchable: `rebuild`. Multiplayer:
every screen runs the smash against the cars it can see — the
driver's screen is exact, remote screens break the same panels a
beat later off the eased pose.

### 7.38 Lighting v3 (v23) — the Roblox look
The engine's night is now properly DARK so lights read: sun/hemisphere
bottom out near zero at midnight, the environment IBL dims to ~16 %
(you rarely need to care), and a moon rises opposite the sun. Lamp
entities (§7.28) get pooled PointLights at ~3× their v22 intensity —
a lamp now draws a real pool of light on the ground under its head,
plus its emissive bulb, additive glow sprite and ground decal. Use
`lamp` entities wherever a world should feel lit at night — the pool
follows the nearest 8 posts to each player automatically.

### 7.39 v24 — party lamps (`lamp.strobe`)
```json
{ "id": "pool-lamp-nw", "type": "lamp", "pos": [-89, "ground", 26],
  "color": "#ff4fd8", "intensity": 2.0, "range": 26, "radius": 3.0,
  "pool": 0.55, "headSize": 0.45, "strobe": true }
```
`strobe: true` turns a lamp into a PARTY LIGHT: after dark its hue
cycles continuously (slow rainbow, gentle brightness pulse) — bulb,
glow, ground pool and the pooled real light all follow. Six of them
around a pool read as a pool party. Use sparingly: strobing lamps
re-tint every frame (a handful is free, a hundred is not).

### 7.40 v24 — the physics engine (PHYS) behind the house
The collapsible house (§7.37) now runs on a real RIGID-BODY engine:
every broken panel is a full 3D box body — position + quaternion +
linear/angular velocity, box inertia — solved with OBB/OBB SAT
contact generation (up to 4 clipped contact points per pair) and
sequential impulses with restitution, Coulomb friction and a
Baumgarte bias, at a fixed 60 Hz step (≤ 2 substeps/frame). Panels
now TUMBLE, BOUNCE, STACK ON EACH OTHER, slide down the pile and go
to sleep when settled. Three extras make the crumble read right:
- **demolition wave (v26)** — a real ram (or a smite strike) doesn't
  punch a hole, it takes the WHOLE house: every panel still standing
  is queued with a delay that grows with distance from the impact,
  so the structure visibly ripples apart nearest-first over ~1 s;
- **rubble plowing (v26)** — `PHYS.kick(cx, cz, hx, hz, y0, y1, vx,
  vy, vz)` wakes and shoves every body inside a world-space box, so
  a truck driving through its own rubble parts the pile;
- **blast shockwave** — smite lightning (and `house.blast`) adds an
  impulse away from the blast center to every loose chunk already
  on the ground.
World-recipe knobs are unchanged (`size`, `rebuild`, colors); the
client API `PHYS.add/remove/clear/blast/kick` is what future
natural-disaster entities will drive.

### 7.41 v24 — smite strikes NEAR you, NPC cars light the road
Admin lightning now lands at a random spot 2.5–7 studs from the
target (picked once by the sender, so every screen agrees where the
crater is) and the victim is hurled AWAY from the strike — a
different random compass every bolt, 1.35× power horizontally.
NPC traffic cars (§7.25) now carry real-looking headlights at night:
bigger additive glows plus a soft BEAM wash laid on the road ahead
of each car (zero real lights — a street of traffic still costs
nothing). Straight-on car hits fling you along the car's direction
of travel with a shallow rise (the v24 yeet-steal fix means the
fling survives even while you hold the joystick).

### 7.42 v24 — the built-in Flashlight
`flashlight` is a built-in item id (like `sword`/`gun`/`apple`):
give it from the admin Players menu → Give Items (works on yourself,
any player, or everyone). Equip it and the beam comes ON; click/tap
to toggle it off/on. The beam is a real SpotLight that follows your
head and aims wherever the CAMERA looks — first or third person.

### 8. Building a world JSON with AI (v21.1)
The client is a GENERIC ENGINE: it knows nothing about any map.
A world JSON that passes `validateRecipe` + `validateGameLogic`
renders and plays, full stop. To have an AI build you a new map:
1. Feed it this spec (the whole `worlds/WORLDS-SPEC.md`).
2. Ask for a single JSON file `{id,name,desc,spawn,sky,terrain,
   scatter,build,logic,vars}` — the vocabulary is: `build[]` static
   parts (§5: `pos/size/color/material/shape/rot/lift/repeat/
   noCollide/id/requires`) and the 26 `logic[]` entity types
   (§7.1–§7.37: button claim dropper conveyor collector killbrick
   teleport checkpoint pad npc spawner pickup door sign claimer
   zwave swing laser upgrader car mover lamp spinner blink vehicle
   trampoline house).
3. Drop the file in `worlds/` and add one entry to `worlds/index.js`
   (the `/api/worlds` manifest the worker serves). No client
   changes, ever — that is the point.

Hard limits the validator enforces: 2500 build parts, 320 logic
entities, 24 items, ids `^[a-z0-9][a-z0-9-]{1,31}$` unique across
build+logic, `pos` ±1000 (y −200..500), part sizes ≤ 420, entity
sizes 0.5..120. Physics envelope to design against: default GRAV 165,
`walkSpeed` 12 / `runSpeed` 20 / `jumpPower` 48 ⇒ jump height ~7
studs, run-jump reach ~11 — keep edge gaps ≤ 9 and rises ≤ +2 per
hop (or gate them behind pads/movers). Spawn fall-safety: put a
kill floor (tiled big killbricks, y ≈ −30) under everything so
falls respawn at the last `checkpoint`. Tuning tips: stagger
`phase` values on movers/blinks/spinners sharing a view; use
`repeat:[n,dx,dz]` rows for tiled tops (one entry per row);
`vars.rules` presets per-world (`fallDamage`, `jumpPower`,
`maxZombies`, car/lamp rules — §7.26/§7.29).
