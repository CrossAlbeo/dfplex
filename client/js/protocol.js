// dfplex client protocol — shared vocabulary for all data sources and the renderer.
// See ../../docs/protocol.md for the wire format. ES module; usable in the browser and Node.

/** Protocol identifier sent in `hello`. Bump on breaking wire changes. */
export const PROTOCOL = "dfplex2";

/** Server → client message types. */
export const S2C = Object.freeze({
  HELLO: "hello",
  MAP: "map",
  UNITS: "units",
  TICK: "tick",
  CHAT: "chat",
  ERROR: "error",
});

/** Client → server message types. */
export const C2S = Object.freeze({
  JOIN: "join",
  VIEWPORT: "viewport",
  COMMAND: "command",
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
