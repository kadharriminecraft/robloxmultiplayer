/* ============================================================
   WORLDS INDEX — the worker's world registry (v6).
   ------------------------------------------------------------
   Add a world:
     1. Drop  my-world.json  into this folder (follow the recipe
        schema in WORLDS-SPEC.md — start from a copy of
        island-world.json for a place, tycoon-world.json for a
        full game with logic, weapons and shops).
     2. Add ONE line below:
          import myWorld from './my-world.json';
        and list it in WORLD_LIST.
     3. Commit + push. The worker redeploys and every game client
        can see + join the new world immediately.

   Rules that keep every world compatible with the game client:
   unique ids, valid recipe JSON (the client validates + falls
   back to the built-in baseplate world on any error), and
   deterministic generation (no randomness the game can't
   reproduce on every screen — the noise is seeded).
   ============================================================ */

import baseplate from './baseplate.json';
import islandWorld from './island-world.json';
import tycoonWorld from './tycoon-world.json';
import neighborhoodWorld from './neighborhood-world.json';
import obbyWorld from './obby-world.json';

export const WORLD_LIST = [
  baseplate,
  islandWorld,
  tycoonWorld,
  neighborhoodWorld,
  obbyWorld
];
