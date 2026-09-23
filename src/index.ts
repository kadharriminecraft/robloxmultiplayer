// @ts-nocheck — plain-JS worker (wrangler bundles it with esbuild; no type-check step)
/* ============================================================
   BASEPLATE MULTIPLAYER RELAY v9 — verified admins + worlds + game state
   ------------------------------------------------------------
   WHY v8?  Security + cost fixes (game v17):

     - ADMIN IS VERIFIED BY THE RELAY. Before v8 the admin flag in a
       state message was whatever the client claimed, and the code was
       readable in the game's page source — anyone could crown
       themselves and kick / smite / reset. Now a client sends
       {t:'auth', c:<code>} and the relay checks it (secret ADMIN_CODE,
       see below). The relay then STAMPS the admin flag on every state
       and chat message it forwards, so other players only ever see a
       crown the relay vouched for. Admin-only room writes (stored room
       rules, world progress reset) are dropped from non-admins.
     - IDENTITY IS PINNED. A socket's player id is fixed by its first
       message; messages claiming a different id are dropped, so nobody
       can impersonate another player (or an admin) in world events.
     - Empty rooms stop waking up every 25 s forever (the heartbeat
       alarm now only re-arms while someone is connected).

     ADMIN CODE: set a Worker secret named ADMIN_CODE in the
     Cloudflare dashboard (Worker → Settings → Variables and Secrets →
     Add → type Secret) or with  npx wrangler secret put ADMIN_CODE.
     Until you do, the relay accepts the legacy code (checked by
     SHA-256 hash only). The legacy code is in this repo's git history,
     so PLEASE set a new secret.

   This is the code for the worker at:
     robloxmultiplayer.kadharri-minecraft.workers.dev

   WHY v7?  v16 of the game added per-plot vaults and auto-resets:

     - 'tyc' {t:'bank', p, v} — the plot vault balance rides the
       stored state too, so joiners see real vault totals.
     - 'tyc' {t:'pr', e, ids} — a PLOT reset (the owner left).
       Clears the claim, its button buys and the vault, so a plot
       can't resurrect for the next joiner after its owner left.
       (Old v6 clients still send the old event mix and keep
       working — v7 simply understands two more.)

   WHY v6?  v5 gave every world its own room and stored room rules.
   v14 of the game turned world files into full GAMES (tycoons with
   buy buttons, claimed plots, taken pickups — see
   worlds/WORLDS-SPEC.md). v6 stores that game state too:

     - 'w' events of kind 'tyc' (buy / claim / pickup / win) update
       a compact  gstate  map in the Durable Object's storage, so a
       world's progress SURVIVES the room going empty and every
       joiner catches up instantly.
     - a 'tyc' {t:'r'} (admin "Reset world progress") clears it.
     - new sockets are handed the stored state as a direct 'tycs'
       message right alongside the stored room rules.
     - the per-message size cap went 1024 → 4096 so chunked
       snapshots from clients fit.

   WHY v5?  v4 relayed one room ('baseplate-world') and stored
   its room rules. v5 added WORLDS:

     - The game asks  GET /api/worlds        for the world list
       and            GET /api/worlds/<id>   for a world recipe
       (JSON). Worlds live in the  worlds/  folder of this repo —
       drop a new  <id>.json  in there, add one line to
       worlds/index.js, deploy, and every game client can switch
       to it (see worlds/WORLDS-SPEC.md).
     - Each world is its own Durable Object room:  ?room=world-<id>
       on the websocket (the classic baseplate world keeps the
       legacy room name 'baseplate-world' so stored room rules
       survive the upgrade). Rooms are per-world, so chat, rides,
       zombies, room rules... all stay inside one world.
     - GLOBAL PRESENCE: every room reports who is in it to a
       registry (a '__registry__' instance of this same class).
       The registry pushes the everyone-everywhere list ('gp'
       messages) back to every room, so the game's player list
       shows ALL players no matter which world they are in.
     - CROSS-WORLD ADMIN POWERS: an admin can "bring" a player
       from another world — the sender's room verifies the admin
       flag, looks the target up in its presence cache, and asks
       the target's room to send that one client a 'forceworld'
       message (switch world + teleport).

   The relay stays DUMB about game logic: 's' state / 'c' chat /
   'w' world events still pass straight through to the room, and
   any NEW world feature the game invents later flows through
   automatically. Old v4/v3 clients (no ?room= param) keep landing
   in the legacy baseplate room and simply ignore the new
   'gp' / 'forceworld' message types.

   DEPLOY (your GitHub repo — kadharriminecraft/robloxmultiplayer):
     Your repo's actual layout (what the import below assumes):
         src/index.ts          ← the entry wrangler builds (wrangler.json "main")
         worlds/index.js       ← the world registry (repo ROOT, next to src/)
         worlds/<world>.json   ← the world files
     1. src/index.ts = this file's contents, pasted over it.
        The import near the bottom is '../worlds/index.js' — one folder
        UP, out of src/, to the root worlds/ folder. THE PATH MATTERS:
        it must point FROM the entry file TO the worlds folder.
        './worlds/index.js' would look for src/worlds/ — the build
        fails with "Could not resolve './worlds/index.js'" and the
        LAST good deploy keeps serving (exactly what happened on
        2026-09-23).
     2. Commit + push to main — Workers Builds redeploys on merge
        (about a minute).
     3. Verify the deploy: open
            https://robloxmultiplayer.kadharri-minecraft.workers.dev/
        It must say "Baseplate multiplayer relay v8 is live" and
        "Worlds served: N (GET /api/worlds)" (N = worlds in index.js). If a push does NOT
        change that page, the build failed — check the worker's
        Builds / Deployments tab in the Cloudflare dashboard for the
        red error line (it names the file it couldn't resolve).
     No wrangler.toml changes are needed: the registry is just
     another instance of the SAME MyDurableObject class (room
     name '__registry__'), and .json imports work out of the box.

   DEPLOY (dashboard quick-edit, no repo):
     Paste this file as the entry, then ADD the files
     worlds/index.js + the two .json files as additional modules
     in the editor's file panel (create the folder if it lets
     you; if it does not support folders, put the three files in
     the root and change the import below to './worlds.js' and
     the two imports inside it to './baseplate.json' etc.).

   WHAT IT DOES:
     - GET  /            → health: total players + who's in which
                            world + the list of worlds served
     - GET  /api/worlds  → [{id, name, desc}] manifest (CORS: *)
     - GET  /api/worlds/<id> → the full world recipe JSON
     - WS   /ws?room=…   → join that world's room
                            (no param → legacy baseplate room)
   ============================================================ */

/* '../worlds/index.js' — the entry file (src/index.ts) sits one folder
   BELOW the repo-root worlds/ folder, so the path goes UP one level.
   If you ever move the entry or the worlds folder, this import must
   still point from the entry file to worlds/index.js or the deploy
   build fails. */
import { WORLD_LIST } from '../worlds/index.js';

const MAX_CLIENTS = 40;
/* SHA-256 of the pre-v8 admin code — only used when no ADMIN_CODE secret is set */
const LEGACY_ADMIN_SHA256 = '0957e5fcf512803b9c6ea0c106fc939cc838ac996184539a23dda95e190ddc94';
async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function checkAdminCode(code, env) {
  if (typeof code !== 'string' || !code || code.length > 64) return false;
  const secret = env && typeof env.ADMIN_CODE === 'string' ? env.ADMIN_CODE : '';
  if (secret) {
    // constant-time compare on the hashes (both fixed length)
    const [a, b] = await Promise.all([sha256hex(code), sha256hex(secret)]);
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }
  return (await sha256hex(code)) === LEGACY_ADMIN_SHA256;
}
const REGISTRY_NAME = '__registry__';
const LEGACY_ROOM = 'baseplate-world';   // keeps v4's stored room rules
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'cache-control': 'no-store'
};

/* room name <-> world id (must match the game's Worlds.roomName()) */
const roomFor = id => id === 'baseplate' ? LEGACY_ROOM : 'world-' + id;
const worldIds = WORLD_LIST.map(w => String(w.id));

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: CORS });

    /* ---- world API (CORS-open so the file:// game can call it) ---- */
    if (url.pathname === '/api/worlds')
      return new Response(
        JSON.stringify(WORLD_LIST.map(w => ({ id: w.id, name: w.name, desc: w.desc || '' }))),
        { headers: Object.assign({ 'content-type': 'application/json' }, CORS) });

    if (url.pathname.startsWith('/api/worlds/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/worlds/'.length));
      const w = WORLD_LIST.find(x => String(x.id) === id);
      if (!w) return new Response('unknown world\n', { status: 404, headers: CORS });
      return new Response(JSON.stringify(w), { headers: Object.assign({ 'content-type': 'application/json' }, CORS) });
    }

    /* ---- health: players per world, from the registry ---- */
    if (url.pathname === '/' || url.pathname === '/health') {
      if (!env.ROOM)
        return new Response(
          'Baseplate relay is deployed, but the Durable Object binding is MISSING.\n' +
          'Open the worker → Settings → Bindings → Add binding → Durable Object Namespace:\n' +
          '    Variable name: ROOM\n    Class name: MyDurableObject\n' +
          'then Save and Deploy.\n',
          { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } });
      try {
        const reg = env.ROOM.get(env.ROOM.idFromName(REGISTRY_NAME));
        const j = JSON.parse(await (await reg.fetch('https://reg/presence')).text());
        const byWorld = {};
        for (const p of (j.players || [])) (byWorld[p.w] = byWorld[p.w] || []).push(p.n);
        const meta = {};
        for (const w of WORLD_LIST) meta[w.id] = w.name;
        const lines = Object.keys(byWorld).sort().map(w =>
          '  ' + (meta[w] || w) + ' — ' + byWorld[w].length + ' player' +
          (byWorld[w].length === 1 ? '' : 's') + ': ' + byWorld[w].join(', '));
        return new Response(
          'Baseplate multiplayer relay v8 is live — ' + (j.players || []).length +
          ' player(s) connected\nWorlds served: ' + WORLD_LIST.length +
          ' (GET /api/worlds)\n' + (lines.length ? lines.join('\n') + '\n' : ''),
          { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } });
      } catch (e) {
        return new Response('Relay error: ' + (e && e.message ? e.message : e) + '\n',
          { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } });
      }
    }

    if (url.pathname !== '/ws')
      return new Response('Not found\n', { status: 404, headers: CORS });

    if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket')
      return new Response('Expected WebSocket\n', { status: 426, headers: CORS });

    if (!env.ROOM)
      return new Response('ROOM binding missing — see the deploy steps\n', { status: 500 });

    /* which world room?  ?room=world-<id>  (or the legacy name).
       Anything unknown (or no param) falls back to the classic
       baseplate room, so old clients keep working. */
    let room = url.searchParams.get('room') || LEGACY_ROOM;
    let worldId = room === LEGACY_ROOM ? 'baseplate'
      : room.startsWith('world-') ? room.slice(6) : null;
    if (worldIds.indexOf(worldId) < 0) { room = LEGACY_ROOM; worldId = 'baseplate'; }

    const stub = env.ROOM.get(env.ROOM.idFromName(room));
    /* hand the DO its identity on the internal fetch — it can't
       reverse its own id back into a name */
    const u = new URL(request.url);
    u.searchParams.set('w', worldId);
    u.searchParams.set('room', room);
    return stub.fetch(new Request(u, request));
  }
};

/* ============================================================
   MyDurableObject — one instance PER WORLD (plus one special
   '__registry__' instance that tracks who is where).

   Every WebSocket from every device for one world is forwarded
   to that world's instance, so the player list below is the
   world, not a per-machine copy. Each room:
     - relays 's' state / 'c' chat / 'w' world events (v3)
     - stores room rules and hands them to joiners (v4)
     - reports its players to the registry, caches the global
       presence list it gets pushed back, and fans it out as
       'gp' messages (v5)
     - routes admin cross-world 'bring' requests to the target
       player's room (v5)

   The '__registry__' instance never holds WebSockets — it only
   serves two tiny internal routes (POST /report, GET /presence),
   pushes {t:'gp'} updates to every known room (debounced), and
   prunes worlds that stopped reporting after 90 s.
   ============================================================ */
export class MyDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.clients = new Set();   // every open socket in this world
    this.w = null;              // world id (from the ?w= query)
    this.isRegistry = false;    // set when /report or /presence arrive
    this.rooms = new Map();     // registry mode: world id -> {at, players}
    this.presence = null;       // room mode: last 'gp' list from the registry
    this._regTO = null;         // room: report debounce
    this._pushTO = null;        // registry: push debounce
    this._dirty = false;        // registry: push needed
  }

  async fetch(request) {
    const url = new URL(request.url);

    /* ---------- REGISTRY routes (no ?w= on these calls) ---------- */
    if (url.pathname === '/report' && request.method === 'POST') {
      this.isRegistry = true;
      try {
        const j = JSON.parse(await request.text());
        const w = url.searchParams.get('w') || 'baseplate';
        const l = Array.isArray(j && j.l) ? j.l : [];
        if (!l.length) this.rooms.delete(w);
        else this.rooms.set(w, {
          at: Date.now(),
          players: l.filter(p => p && typeof p.i === 'string').slice(0, MAX_CLIENTS)
        });
        this._registryTouch();
      } catch (e) {}
      return new Response('ok');
    }
    if (url.pathname === '/presence') {
      this.isRegistry = true;
      const all = this._allPlayers();
      return new Response(JSON.stringify({ players: all }),
        { headers: { 'content-type': 'application/json' } });
    }

    /* ---------- ROOM routes ---------- */

    /* identity: the worker passes ?w=<world id> on the ws fetch */
    const qW = url.searchParams.get('w');
    if (qW && this.w === null) this.w = qW;

    /* health check — how many players this room holds */
    if (url.pathname === '/count')
      return new Response(String(this.clients.size));

    /* registry pushes the global presence list → cache + fan out */
    if (url.pathname === '/push' && request.method === 'POST') {
      try {
        const j = JSON.parse(await request.text());
        this.presence = Array.isArray(j.p) ? j.p : null;
      } catch (e) { this.presence = null; }
      const msg = JSON.stringify({ t: 'gp', p: this.presence || [] });
      for (const ws of this.clients)
        if (ws.readyState === 1) { try { ws.send(msg); } catch (e) {} }
      return new Response('ok');
    }

    /* another room asks us to force one of OUR players into a
       world/position (admin cross-world bring) */
    if (url.pathname === '/force' && request.method === 'POST') {
      let j;
      try { j = JSON.parse(await request.text()); } catch (e) { return new Response('bad'); }
      if (!j || typeof j.tg !== 'string') return new Response('bad');
      for (const ws of this.clients)
        if (ws._info && ws._info.i === j.tg && ws.readyState === 1) {
          try {
            ws.send(JSON.stringify({ t: 'forceworld', w: j.w, x: j.x, y: j.y, z: j.z, by: j.by || '' }));
            return new Response('ok');
          } catch (e) { return new Response('gone'); }
        }
      return new Response('gone');
    }

    if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket')
      return new Response('Expected WebSocket\n', { status: 426 });

    if (this.clients.size >= MAX_CLIENTS)
      return new Response('Relay is full\n', { status: 503 });

    const myWorld = this.w || 'baseplate';

    /* upgrade to WebSocket and join the room */
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    this.clients.add(server);

    /* v4: hand the new socket the stored room rules (if any) so
       the world's gravity / damage / zoom / smite tuning apply to
       whoever joins — even if nobody was online when they were
       set. Sent as a direct 'rrules' message (t:'w' relay events
       from other players arrive separately, as before). */
    this.state.storage.get('rules').then(rules => {
      if (rules && server.readyState === 1) {
        try { server.send(JSON.stringify({ t: 'rrules', d: rules })); } catch (e) {}
      }
    }).catch(() => {});
    /* v6: the world's game progress (claimed plots, bought buttons) */
    this.state.storage.get('gstate').then(gs => {
      if (gs && server.readyState === 1) {
        try { server.send(JSON.stringify({ t: 'tycs', d: gs })); } catch (e) {}
      }
    }).catch(() => {});

    let id = null;                          // bound from the first message (then pinned)
    let msgs = 0, winStart = Date.now(), authTries = 0;
    server._admin = false;                  // v8: set only by a verified {t:'auth'}

    server.addEventListener('message', ev => {
      if (typeof ev.data !== 'string' || ev.data.length > 4096) return;   // size cap (v6: room for chunked snapshots)
      const now = Date.now();
      if (now - winStart > 1000) { winStart = now; msgs = 0; }             // rate cap
      if (++msgs > 90) return;

      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }

      if (!m || typeof m !== 'object') return;
      if (m.t === 'p') { try { server.send('{"t":"q"}'); } catch (e) {} return; }  // keepalive ping

      /* v8: admin login — the relay checks the code, never the client */
      if (m.t === 'auth') {
        if (++authTries > 5) { try { server.send('{"t":"auth","ok":0,"lim":1}'); } catch (e) {} return; }
        checkAdminCode(m.c, this.env).then(ok => {
          server._admin = !!ok;
          if (server._info) server._info.a = ok ? 1 : 0;
          try { server.send(JSON.stringify({ t: 'auth', ok: ok ? 1 : 0 })); } catch (e) {}
          this._report();                              // presence crown follows
        }).catch(() => {});
        return;
      }

      /* v5: admin cross-world bring — never relayed to the room.
         The sender must be a KNOWN admin (their state broadcast
         carries the admin flag), and the target must be a real
         player from the registry's presence list. */
      if (m.t === 'x' && m.k === 'bring' && typeof m.tg === 'string') {
        const sender = [...this.clients].find(ws => ws._info && ws._info.i === m.id);
        if (sender === server && server._admin && Array.isArray(this.presence)) {
          const target = this.presence.find(p => p && p.i === m.tg && p.w !== myWorld);
          if (target) {
            const stub = this.env.ROOM.get(this.env.ROOM.idFromName(roomFor(target.w)));
            stub.fetch(new Request('https://do/force', {
              method: 'POST',
              body: JSON.stringify({ tg: m.tg, w: myWorld, x: +m.x || 0, y: +m.y || 0, z: +m.z || 0, by: sender._info.n })
            })).catch(() => {});
          }
        }
        return;
      }

      if (m.t === 's' || m.t === 'c' || m.t === 'w') {  // state / chat / world event → pass through
        if (typeof m.id !== 'string' || !m.id || m.id.length > 64) return;
        if (id === null) { id = m.id; this._report(); }  // first bind → presence update
        else if (m.id !== id) return;                   // v8: no impersonating other players
        let out = ev.data;
        if (m.t === 's' || m.t === 'c') {               // v8: the relay stamps the admin flag
          const a = server._admin ? 1 : 0;
          if ((m.a ? 1 : 0) !== a) { m.a = a; out = JSON.stringify(m); }
        }
        if (m.t === 's') {                              // v5: track name/admin/pos for presence
          server._info = {
            i: id, n: String(m.n || 'Player').slice(0, 20),
            a: server._admin ? 1 : 0, x: +m.x || 0, y: +m.y || 0, z: +m.z || 0
          };
        }
        if (m.t === 'w' && m.k === 'rrules') {          // admin-only: room rules
          if (!server._admin) return;
          if (m.d && typeof m.d === 'object' && !Array.isArray(m.d))
            this.state.storage.put('rules', m.d).catch(() => {});   // v4: remember for joiners
        }
        if (m.t === 'w' && m.k === 'tyc' && m.d && m.d.t === 'r' && !server._admin) return;  // admin-only reset
        /* v6: world GAME state — buys, claims, taken pickups (tyc
           events from the v14 game logic, §9.7). Stored so tycoon
           progress survives an empty room; joiners get it below. */
        if (m.t === 'w' && m.k === 'tyc' && m.d && typeof m.d === 'object')
          this._gameApply(m.d, id).catch(() => {});
        for (const ws of this.clients) {
          if (ws === server || ws.readyState !== 1) continue;
          try { ws.send(out); } catch (e) {}
        }
      }
    });

    const bye = () => {
      this.clients.delete(server);
      this._report();                                  // v5: presence shrinks right away
      if (id) for (const ws of this.clients) {         // tell the others they left
        if (ws.readyState !== 1) continue;
        try { ws.send(JSON.stringify({ t: 'bye', id })); } catch (e) {}
      }
    };
    server.addEventListener('close', bye);
    server.addEventListener('error', bye);

    return new Response(null, { status: 101, webSocket: client });
  }

  /* ---- v6: the world GAME-state reducer --------------------
     Compact map, capped so a runaway world can't bloat storage:
       b  { buttonId: 1 }        bn { buttonId: buyCount }
       c  { plotId: {i, n} }     pk { pickupId: 1 }
       k  { plotId: vaultMoney }                    (v7: vaults)
       tg { entityId: [0|1, timestampMs] }          (v9: toggles —
          house doors, laser doors; newest timestamp wins)
     'tyc' {t:'r'} from an admin resets everything.
     'tyc' {t:'pr'} clears one plot (owner left).   (v7) */
  async _gameApply(d, from) {
    if (!d || typeof d !== 'object') return;
    if (d.t === 'r') { await this.state.storage.delete('gstate').catch(() => {}); return; }
    if (d.t === 'pr' && typeof d.e === 'string') {
      let g = await this.state.storage.get('gstate').catch(() => null);
      if (!g || typeof g !== 'object') return;              // nothing stored yet
      if (!g.b) g.b = {}; if (!g.bn) g.bn = {}; if (!g.c) g.c = {}; if (!g.pk) g.pk = {}; if (!g.k) g.k = {};
      delete g.c[d.e];
      delete g.k[d.e];
      if (!g.tg) g.tg = {};
      if (Array.isArray(d.ids)) for (const id of d.ids.slice(0, 120)) { delete g.b[id]; delete g.bn[id]; delete g.pk[id]; delete g.tg[id]; }
      await this.state.storage.put('gstate', g).catch(() => {});
      return;
    }
    if (d.t !== 'b' && d.t !== 'c' && d.t !== 'pk' && d.t !== 'bank' && d.t !== 'tg') return;
    let g = await this.state.storage.get('gstate').catch(() => null);
    if (!g || typeof g !== 'object') g = { b: {}, bn: {}, c: {}, pk: {} };
    if (!g.b) g.b = {}; if (!g.bn) g.bn = {}; if (!g.c) g.c = {}; if (!g.pk) g.pk = {}; if (!g.k) g.k = {};
    if (!g.tg) g.tg = {};
    if (d.t === 'tg' && typeof d.e === 'string') {                 // v9: toggles, newest wins
      const id = d.e.slice(0, 64), ts = +d.s || 0, cur = g.tg[id];
      if (!cur || ts > cur[1]) g.tg[id] = [d.v === 1 ? 1 : 0, ts];
      if (Object.keys(g.tg).length > 300) g.tg = Object.fromEntries(Object.entries(g.tg).slice(-300));
    } else if (d.t === 'b') { g.b[d.e] = 1; g.bn[d.e] = (g.bn[d.e] || 0) + 1; }
    else if (d.t === 'c') g.c[d.e] = { i: String(from || '').slice(0, 64), n: String(d.n || 'Player').slice(0, 20) };
    else if (d.t === 'pk') g.pk[d.e] = 1;
    else if (d.t === 'bank' && typeof d.p === 'string') g.k[d.p] = Math.max(0, Math.round(+d.v || 0));   // v7: vault total
    if (Object.keys(g.b).length > 400) g.b = Object.fromEntries(Object.entries(g.b).slice(-400));
    if (Object.keys(g.bn).length > 400) g.bn = Object.fromEntries(Object.entries(g.bn).slice(-400));
    if (Object.keys(g.c).length > 60) g.c = Object.fromEntries(Object.entries(g.c).slice(-60));
    if (Object.keys(g.pk).length > 300) g.pk = Object.fromEntries(Object.entries(g.pk).slice(-300));
    if (Object.keys(g.k).length > 80) g.k = Object.fromEntries(Object.entries(g.k).slice(-80));
    await this.state.storage.put('gstate', g).catch(() => {});
  }

  /* ---- room: tell the registry exactly who is here ----
     Debounced ~400 ms so a burst of joins reports once. Re-armed by
     an alarm every 25 s while the room is non-empty (self-healing
     if the registry ever restarts and forgets us). */
  _report() {
    if (this._regTO) return;
    this._regTO = setTimeout(() => {
      this._regTO = null;
      const l = [];
      for (const ws of this.clients)
        if (ws._info) l.push({ i: ws._info.i, n: ws._info.n, a: ws._info.a, x: ws._info.x, y: ws._info.y, z: ws._info.z });
      const reg = this.env.ROOM.get(this.env.ROOM.idFromName(REGISTRY_NAME));
      reg.fetch(new Request('https://reg/report?w=' + encodeURIComponent(this.w || 'baseplate'),
        { method: 'POST', body: JSON.stringify({ l }) })).catch(() => {});
      if (this.clients.size) this._scheduleAlarm();   // v8: empty rooms go back to sleep
    }, 400);
  }
  async _scheduleAlarm() {
    try { await this.state.storage.setAlarm(Date.now() + 25000); } catch (e) {}
  }

  /* ---- registry helpers ---- */
  _allPlayers() {
    const all = [];
    for (const [w, room] of this.rooms)
      for (const p of room.players) all.push({ i: p.i, n: p.n, a: p.a, w, x: p.x, y: p.y, z: p.z });
    return all;
  }
  _registryPush() {
    this._dirty = false;
    const all = this._allPlayers();
    for (const w of this.rooms.keys()) {
      const stub = this.env.ROOM.get(this.env.ROOM.idFromName(roomFor(w)));
      stub.fetch(new Request('https://do/push', { method: 'POST', body: JSON.stringify({ p: all }) }))
        .catch(() => {});
    }
  }
  _registryTouch() {
    this._dirty = true;
    if (!this._pushTO) this._pushTO = setTimeout(() => {
      this._pushTO = null;
      this._registryPush();
    }, 800);
    this._registryArm();
  }
  async _registryArm() {
    try { await this.state.storage.setAlarm(Date.now() + 30000); } catch (e) {}
  }

  /* alarm: room heartbeat OR registry prune, by role */
  async alarm() {
    if (this.isRegistry) {
      const now = Date.now();
      for (const [w, room] of [...this.rooms])
        if (now - room.at > 90000) this.rooms.delete(w);
      if (this._dirty || this.rooms.size) this._registryPush();
      if (this.rooms.size) this._registryArm();
      return;
    }
    if (!this.w) return;                 // evicted + forgot our world: nothing to report
    this._report();                      // (re-arms itself while anyone is connected)
  }
}
