# robloxmultiplayer — agent notes

A fake-Roblox browser game. Everything the client runs lives in **one file**:
`Clientcode.html` (~11k lines, ~560 KB). The only other runtime assets are the
world definitions in `worlds/*.json` (served by a Cloudflare Durable Objects
worker in `worlds/index.js`).

## Layout

| Path | What it is |
| --- | --- |
| `Clientcode.html` | the entire client: renderer, physics, entity factories, UI, admin menu |
| `worlds/<id>.json` | one world each: `build[]` (static blocks), `logic[]` (typed entities), `script` (a JS string run in the game sandbox), `vars.rules` (room rules) |
| `worlds/index.js` | the worker that lists/serves worlds |
| `worlds/WORLDS-SPEC.md` | the authoring spec for world JSON |

## Editing Clientcode.html

The whole game is inside a single `<script type="module">`. To syntax-check
without a browser, extract that block and run `node --check`:

```sh
python3 -c "
s=open('Clientcode.html',encoding='utf-8').read()
a=s.index('<script type=\"module\">')+len('<script type=\"module\">')
b=s.rindex('</script>')
open('/tmp/client_module.mjs','w',encoding='utf-8').write(s[a:b])
"
node --check /tmp/client_module.mjs
```

### Test harness pattern (used throughout)

Playwright + a tiny static server, with the world API stubbed so a world can be
booted offline. There is no dev server to start; the harness serves
`Clientcode.html` directly. Always seed localStorage before load:

```js
localStorage.setItem('baseplate.user.v1','T');
localStorage.setItem('baseplate.world.v1','obby-world');
```

`window.BASEPLATE` is the debug handle. It exports `GameLogic`, `PHYS`,
`HOUSES`, `VEH`, `LAMP`, `debug` (`adminEngineCommands`, `openMenu`,
`buildAdminTab`, `isAdmin`, `camera`, `scene`, `player`).

Two gotchas that waste time:

- **The render loop owns `camera`.** Setting `camera.position`/`lookAt` directly
  is overwritten every frame, so screenshots come out identical. Drive the
  *player* and the orbit instead: set `player.x/y/z`, `cam.yaw`, `cam.pitch`,
  `cam.zoom`, `cam.dist`, and `cam.subject`.
- **The canvas is not readable via `getImageData`** (no
  `preserveDrawingBuffer`). Use `page.screenshot()` and decode the PNG.

## House destruction

`HOUSES` entities are built from *panels* — one breakable mesh each, held in
`rec.panels` and tiled into blocks (walls, roof, gables, slabs). `smash()`
queues every panel with a staggered delay, then `breakPanel` hands it to
`PHYS.add` as a dynamic body tagged `'house'`; `rebuildHouse()` puts the panels
back.

Solver notes that matter (they are why the pile looked broken before):

- Body count cap is `PHYS.MAX` (currently 240). It must exceed the panel count
  or `recycleOldest` kills the earliest-spawned rubble, which silently drops
  the ones that spawned first — a whole house is 216 panels.
- Bodies sleep (`b.asleep`) once `b.sleep > 0.8`; `PHYS.step` skips
  gravity/collision/integration for sleeping bodies but keeps syncing meshes.
- **Every panel must stay small.** One oversized body (a 14 m gable bar, an
  8.5 m roof slab) destabilises the whole pile and jitters forever. Panels are
  currently ≤ 2.8 m in every axis. If you add geometry, tile it.

## World rules (admin-tunable)

`vars.rules` is the per-room settings bag. The admin tab is built from
`WORLD_RULE_KEYS` (~line 841) and each rule gets a `bindSlider` row. Rules
relevant here: `carYeet`, `carDamage`, `carYeetAngle` (default 35),
`lampBright`. The obby world also exposes an `obbyend` command (teleport to the
end of the obby) via its world script.

## Verified commands

- `obby-world`: `spawn, tpto, healme, clearzombies, announce, resetworld, obbyend, lampbright`
- `neighborhood-world`: `spawn, tpto, healme, clearzombies, announce, resetworld, lampbright`
- `baseplate`: `spawn, tpto, healme, clearzombies, announce`
