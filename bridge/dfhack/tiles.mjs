// Translate DFHack RemoteFortressReader tiletypes into the client's TILE shape codes.
// RFR already abstracts DF's ~700 raw tiletypes into a small, version-independent
// `TiletypeShape` enum (plus a material), so we map shape (+material) -> our TILE code.
// Per-tile water/magma/hidden overrides are applied by the caller (df-access.mjs).
import { TILE } from "../../client/js/protocol.js";

// RFR TiletypeShape enum value -> our client TILE code (base, pre-override).
// (See RemoteFortressReader.proto: NO_SHAPE=-1, EMPTY=0 ... TWIG=19.)
const SHAPE_TO_TILE = {
  "-1": TILE.EMPTY, // NO_SHAPE
  0: TILE.EMPTY, // EMPTY (open space)
  1: TILE.FLOOR, // FLOOR
  2: TILE.BOULDER, // BOULDER
  3: TILE.FLOOR, // PEBBLES
  4: TILE.WALL, // WALL
  5: TILE.WALL, // FORTIFICATION (render as wall for now)
  6: TILE.STAIR_UP, // STAIR_UP
  7: TILE.STAIR_DOWN, // STAIR_DOWN
  8: TILE.STAIR_UPDOWN, // STAIR_UPDOWN
  9: TILE.RAMP_UP, // RAMP
  10: TILE.RAMP_DOWN, // RAMP_TOP (the open tile above a ramp)
  11: TILE.FLOOR, // BROOK_BED
  12: TILE.WATER, // BROOK_TOP (walkable surface over a brook)
  13: TILE.TREE, // TREE_SHAPE
  14: TILE.SHRUB, // SAPLING
  15: TILE.SHRUB, // SHRUB
  16: TILE.EMPTY, // ENDLESS_PIT
  17: TILE.TREE, // BRANCH
  18: TILE.TREE, // TRUNK_BRANCH
  19: TILE.TREE, // TWIG
};

// TiletypeMaterial values that are grass (GRASS_LIGHT/DARK/DRY/DEAD) -> render floors as grass.
const GRASS_MATERIALS = new Set([8, 9, 10, 11]);

/**
 * Build a lookup table from GetTiletypeList: tiletype id -> base TILE code, folding grassy
 * floors into GRASS. Returns a Uint8Array indexed by tiletype id (unknown ids -> EMPTY).
 */
export function buildTileTable(tiletypeList) {
  let maxId = 0;
  for (const t of tiletypeList) if (t.id > maxId) maxId = t.id;
  const table = new Uint8Array(maxId + 1); // 0 == TILE.EMPTY
  for (const t of tiletypeList) {
    let code = SHAPE_TO_TILE[t.shape] ?? TILE.EMPTY;
    if (code === TILE.FLOOR && GRASS_MATERIALS.has(t.material)) code = TILE.GRASS;
    table[t.id] = code;
  }
  return table;
}
