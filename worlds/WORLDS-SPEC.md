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
  "economy": { … },                     // §6 — money
  "logic":   [ … ],                     // §7 — the live entities
  "script":  "…"                        // §9 — optional sandboxed JS
}
```

Every game field is optional — `island-world.json` uses none of them.
A `template` world (the built-in map) may also carry `items` / `build`
/ `economy` / `logic` / `script` — everything below applies the same.

**How deep can it go?** The reference world `tycoon-world.json` is a
complete 4-plot tycoon: claiming plots, an 8-button upgrade tree per
plot, droppers feeding conveyors into collectors, income multipliers, a
weapon-shop NPC selling 5 custom weapons, night zombie waves with kill
bounties, teleporters, checkpoints, buff pads and a $25,000 win goal —
in ~1,000 lines of pure JSON, no code.

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
  "noise": [                           // 1-4 octaves, summed. smooth value noise
    { "scale": 64, "amp": 5.0 },      //   scale = stud wavelength (8-400), amp = stud height
    { "scale": 21, "amp": 1.8 }
  ],
  "island": {                          // OPTIONAL — omit for a flat square map
    "radius": 62, "edge": 26, "rim": 0.55
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
build-heavy game (tycoons!) use a big flat-ish map: small noise amps,
no island, `waterLevel` 0.

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
  "kind": "sword",                 // REQUIRED "sword" | "gun" | "consumable"

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
  fences, columns, walls.
- `requires` may name buttons AND claims (§7). Gated parts pop in
  with a scale animation on every screen the moment the requirement
  completes.

---

## 6. `economy` — money

```json
{ "name": "Gold", "symbol": "$", "icon": "coins", "start": 100, "goal": 25000 }
```

- Money is **per player, per world, saved on their device** — rejoin
  and your balance is right where you left it.
- The HUD chip appears top-right; gains flash green, losses red, and
  collectors pop a floating `+$5` at the drop.
- `goal` is optional: the moment a player's balance reaches it, every
  screen gets the win banner + confetti.
- Money NEVER syncs into other players' wallets — income comes from
  YOUR collectors (§7 droppers), `grant` buttons, zombie bounties and
  script `Game.addMoney`.

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
  "label": "Dropper 2", "cost": 150, "plot": "plot-ne",
  "maxBuys": 1, "costScale": 2.2,
  "give": "void-blade", "grant": 500, "incomeMult": 2,
  "patch": { "ne-drop1": { "every": 2.5 } } }
```
Stand on the pad and press **E**. Green when you can afford it, gray
when you can't, price on the billboard above. If `plot` is set, only
the plot owner can buy. On buy (every screen applies it instantly):
- `requires` gates referencing this button open (buildings appear…)
- `give` puts a world item in the buyer's hotbar; `grant` pays them
- `incomeMult` multiplies the plot's collector income (stacks ×2 ×3…)
- `patch` retunes OTHER entities live (see the whitelist below)
- `maxBuys` > 1 with `costScale` makes repeatable upgrades
  (`cost × costScale^buysSoFar`)

`patch` may only change these fields, on these types:
`dropper.every value` · `conveyor.speed` · `collector.value` ·
`killbrick.damage` · `teleport.to cooldown` · `pad.power dur amount` ·
`spawner.every max reward night`.

### 7.3 `dropper` — spawns the money
```json
{ "id": "ne-drop1", "type": "dropper", "pos": [8, "ground", 2],
  "plot": "plot-ne", "every": 4, "value": 5, "requires": ["plot-ne"],
  "color": "#4a5568", "drop": { "color": "#f5c542", "size": 0.95 } }
```
Hangs over your conveyor and drops a gold cube every `every` seconds —
**but only while the plot owner is in the world** (their client
simulates it; income pauses when they leave — classic tycoon rules).
`value` is what the collector pays per drop; `drop` styles the cube.

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
{ "id": "vault", "type": "door", "pos": [0, "ground", 5],
  "size": [7, 7, 0.6], "color": "#7fd0ff", "plot": "plot-ne" }
```
A swinging translucent door. With `plot` it opens for the plot owner
as they approach; with `requires` it opens forever once bought.

### 7.14 `sign`
```json
{ "id": "sign-welcome", "type": "sign", "pos": [0, "ground", -8.2],
  "lines": ["GOLD RUSH TYCOON", "Claim a plot!"], "width": 13 }
```
A billboard on a post, up to 4 lines, always facing the reader.

---

## 8. How it all syncs (multiplayer model)

| thing | who owns it | how it syncs |
|---|---|---|
| money | each player | saved on their device; shown in their HUD |
| buys / claims / pickups | one event each | `tyc` events — every client applies them, so gated buildings unfold on every screen at once |
| drops | plot owner's client | `dspawn` event + deterministic sim everywhere; only the owner's client pays the money in |
| zombie waves | room leader | existing zombie replication; `zrew` pays the killer |
| world progress | the relay (v6) | stored in the room's Durable Object storage and pushed to every joiner — **your tycoon survives everyone leaving** |
| late joiners | peers + relay | new clients ask (`tycq`); everyone answers chunked snapshots; the relay also pushes its stored copy |

The relay stays dumb: it just stores + forwards the compact state map.
An admin's **Reset World Progress** (Server tab) broadcasts a reset,
clears the relay's copy, and every plot/button/pickup returns to day
one (player money is kept).

---

## 9. `script` — the deep-logic escape hatch (optional, ≤ 8 KB)

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
· `tp(entityId)`.

**API:** `Game.money()` · `Game.addMoney(n)` · `Game.spendMoney(n)` ·
`Game.give(itemId)` · `Game.heal(n)` · `Game.hurt(n)` ·
`Game.tp(x,y,z)` · `Game.banner(text)` · `Game.toast(text)` ·
`Game.bought(buttonId)` · `Game.claims()` · `Game.players()` ·
`Game.myId()` · `Game.time()` · `Game.dayTime()` · `Game.config` (the
whole recipe, read-only) · `Game.after(sec, fn)` · `Game.every(sec, fn)`
(local timers — self effects) · `Game.broadcast(key, data)` /
`Game.onNet(key, fn)` (custom synced events ≤ 700 B) · `Game.log(…)`.

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

## 10. Hard rules (the client validates every recipe)

Everything is checked on load; ANY failure = the world never appears
(and a player pointed at it falls back to the Baseplate World):

1. Valid JSON, no comments, no trailing commas.
2. `id` `^[a-z0-9][a-z0-9-]{2,31}$`, unique, not `baseplate`.
3. `kind` `template` or `terrain`; terrain fields as §3 (size 64-400,
   waterLevel < base, ≤ 4 noise octaves 8-400 / 0-30, island
   radius + edge ≤ max(size)/2, palette `#rrggbb`).
4. Spawn inside the map (`|x| < size/2 - 8`, same for z).
5. `items` ≤ 24; ids `^[a-z0-9][a-z0-9-]{1,31}$` unique; kinds
   `sword|gun|consumable`; stats within §4 ranges; mesh colors hex;
   icons from the §4 whitelist.
6. `build` ≤ 400 parts; pos `[-1000..1000, -200..500 | "ground",
   -1000..1000]`; sizes 0.1-220; material/shape from the lists;
   repeat `[1-40, ±500, ±500]`.
7. `economy`: name ≤ 16, symbol ≤ 3 chars, start/goal 0-10^9, icon
   whitelisted.
8. `logic` ≤ 160; unique ids; per-type fields within §7 ranges; every
   `requires`/`plot`/`give`/`shop`/`pickup` reference must EXIST;
   `patch` keys must be §7.2-whitelisted fields on patchable types;
   npc lines ≤ 6 × 140 chars; shops ≤ 8 entries.
9. `script` ≤ 8000 chars and lint-clean (§9).

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

## 12. The reference game — tycoon-world.json

`tycoon-world.json` in this folder is a complete, commented-by-shape
example of every feature: 4 mirrored plots (each with claim door,
conveyor + 3 buyable droppers + collector, 8-button upgrade chain
including income multipliers and a MEGA dropper), a central plaza with
a weapon-shop NPC (5 custom items: two swords, two guns, one food),
free pickups, speed/launch pads, teleporters to each plot,
checkpoints, night zombie spawners with bounties, killbrick pits, the
`$25,000` goal, and a 6-line world script. Copy it, reskin it, ship
it.
