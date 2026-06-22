// dfplex client protocol — shared vocabulary for all data sources and the renderer.
// See ../../docs/protocol.md for the wire format. ES module; usable in the browser and Node.

/** Protocol identifier sent in `hello`. Bump on breaking wire changes. */
export const PROTOCOL = "dfplex2";

/** Server → client message types. */
export const S2C = Object.freeze({
  HELLO: "hello",
  MAP: "map",
  UNITS: "units",
  DESIG: "desig",
  BUILDINGS: "buildings",
  TICK: "tick",
  CHAT: "chat",
  PRESENCE: "presence",
  // Reply to a `command`/`stockpile-get`: the clicked pile's current category state, for the editor
  // panel. { type:"stockpile", box:{x0,y0,x1,y1,z}, cats:{ food:bool, stone:bool, … } } — or
  // { type:"stockpile", box:null } when the clicked tile holds no pile.
  STOCKPILE: "stockpile",
  // Reply to a `command`/`unit-get`: one unit's detail for the inspect panel.
  // { type:"unit", info:{ id, name, profession, race, age, citizen, soldier, dead, stress, stressCat,
  // job, wounds } } — or { type:"unit", info:null } when no unit has that id.
  UNIT: "unit",
  ERROR: "error",
});

/** Client → server message types. */
export const C2S = Object.freeze({
  JOIN: "join",
  VIEWPORT: "viewport",
  COMMAND: "command",
  CHAT: "chat",
});

/** Tile shape codes. Data sources emit these; the client maps them to glyphs/colors. */
export const TILE = Object.freeze({
  EMPTY: 0,
  FLOOR: 1,
  WALL: 2,
  RAMP_UP: 3,
  RAMP_DOWN: 4,
  STAIR_UP: 5,
  STAIR_DOWN: 6,
  WATER: 7,
  MAGMA: 8,
  TREE: 9,
  SHRUB: 10,
  BOULDER: 11,
  GRASS: 12,
  STAIR_UPDOWN: 13,
});

/** Number of distinct shape codes (for validation / iteration). */
export const TILE_COUNT = 14;

/** True if `code` is a valid TILE shape. */
export function isTile(code) {
  return Number.isInteger(code) && code >= 0 && code < TILE_COUNT;
}
