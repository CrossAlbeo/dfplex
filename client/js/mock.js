// MockSource: generates a small, deterministic, animated fortress entirely in-browser.
// Implements the same protocol as the live sources, so the client renders it identically.
// Used for UI development and testing with no DF and no server.

import { DataSource } from "./datasource.js";
import { PROTOCOL, S2C, TILE } from "./protocol.js";

const X = 48;
const Y = 48;
const Z = 5;
const Z_SURFACE = 3;

/** Small deterministic PRNG (mulberry32) so the mock world is stable across runs. */
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const idx = (x, y) => y * X + x;

/** Tiles a unit may stand on / walk over. */
function passable(code) {
  return (
    code === TILE.FLOOR ||
    code === TILE.GRASS ||
    code === TILE.STAIR_UP ||
    code === TILE.STAIR_DOWN ||
    code === TILE.STAIR_UPDOWN ||
    code === TILE.RAMP_UP ||
    code === TILE.RAMP_DOWN
  );
}

/** Build the per-z tile grids plus a starting set of units. Deterministic for a given seed. */
export function buildWorld(seed = 1234) {
  const rand = rng(seed);
  const levels = [];

  // Central stair shaft, shared across all z so the levels connect.
  const shaftX = 12;
  const shaftY = 12;

  for (let z = 0; z < Z; z++) {
    const tiles = new Array(X * Y);
    if (z === Z_SURFACE) {
      // Surface: grass with scattered trees/shrubs/boulders and a small pond.
      for (let y = 0; y < Y; y++) {
        for (let x = 0; x < X; x++) {
          let t = TILE.GRASS;
          const r = rand();
          if (r < 0.05) t = TILE.TREE;
          else if (r < 0.09) t = TILE.SHRUB;
          else if (r < 0.105) t = TILE.BOULDER;
          tiles[idx(x, y)] = t;
        }
      }
      // a pond
      for (let y = 30; y < 36; y++)
        for (let x = 30; x < 38; x++) tiles[idx(x, y)] = TILE.WATER;
      tiles[idx(shaftX, shaftY)] = TILE.STAIR_DOWN; // entrance down
    } else if (z > Z_SURFACE) {
      // Sky: open air.
      tiles.fill(TILE.EMPTY);
    } else {
      // Underground: solid rock with a few carved rooms joined by corridors.
      tiles.fill(TILE.WALL);
      const rooms = [
        [4, 4, 9, 7],
        [20, 6, 10, 8],
        [8, 22, 12, 9],
        [26, 24, 11, 8],
      ];
      for (const [rx, ry, rw, rh] of rooms) {
        for (let y = ry; y < ry + rh; y++)
          for (let x = rx; x < rx + rw; x++)
            if (x > 0 && y > 0 && x < X - 1 && y < Y - 1) tiles[idx(x, y)] = TILE.FLOOR;
      }
      // Corridors: an L from each room toward the shaft.
      for (const [rx, ry] of rooms) {
        const cx = rx + 2;
        const cy = ry + 2;
        for (let x = Math.min(cx, shaftX); x <= Math.max(cx, shaftX); x++)
          tiles[idx(x, cy)] = TILE.FLOOR;
        for (let y = Math.min(cy, shaftY); y <= Math.max(cy, shaftY); y++)
          tiles[idx(shaftX, y)] = TILE.FLOOR;
      }
      // Stair shaft connecting levels.
      const top = z === Z_SURFACE - 1;
      const bottom = z === 0;
      tiles[idx(shaftX, shaftY)] = bottom
        ? TILE.STAIR_UP
        : top
        ? TILE.STAIR_UPDOWN
        : TILE.STAIR_UPDOWN;
    }
    levels.push({ tiles });
  }

  // Units: a few dwarves on the surface and in the top underground rooms.
  const names = [
    "Urist McMiner",
    "Dodok Stoneborn",
    "Litast Goldhand",
    "Kogan Axebite",
    "Sibrek Deepdelver",
    "Asmel Brewmaiden",
  ];
  const units = [];
  for (let i = 0; i < names.length; i++) {
    const onSurface = i < 3;
    const z = onSurface ? Z_SURFACE : Z_SURFACE - 1;
    // find a passable starting tile
    let sx = shaftX + 1 + i;
    let sy = shaftY + (onSurface ? 2 : 1);
    if (!passable(levels[z].tiles[idx(sx, sy)])) {
      sx = shaftX;
      sy = shaftY;
    }
    units.push({
      id: 100 + i,
      x: sx,
      y: sy,
      z,
      name: names[i],
      ch: "☺", // classic DF dwarf glyph
      color: 14, // yellow
    });
  }

  // A few buildings so the client renders them without DF: a workshop + a pending bed on the
  // surface (visible immediately), and a workshop in the top underground room.
  const buildings = [
    { i: 1, z: Z_SURFACE, x0: 14, y0: 14, x1: 16, y1: 16, bt: 13, st: 0, active: 1 },
    { i: 2, z: Z_SURFACE, x0: 18, y0: 14, x1: 18, y1: 14, bt: 1, st: -1, active: 0 },
    { i: 3, z: Z_SURFACE - 1, x0: 5, y0: 5, x1: 7, y1: 7, bt: 13, st: 0, active: 1 },
  ];

  return {
    map: { xCount: X, yCount: Y, zCount: Z, zSurface: Z_SURFACE },
    levels,
    units,
    buildings,
    _rand: rand,
  };
}

/** Step the world one tick: wander each unit to a random adjacent passable tile. */
export function stepWorld(world) {
  const rand = world._rand;
  for (const u of world.units) {
    const lvl = world.levels[u.z];
    const dirs = [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    const [dx, dy] = dirs[Math.floor(rand() * dirs.length)];
    const nx = u.x + dx;
    const ny = u.y + dy;
    if (nx >= 0 && ny >= 0 && nx < X && ny < Y && passable(lvl.tiles[idx(nx, ny)])) {
      u.x = nx;
      u.y = ny;
    }
  }
}

export class MockSource extends DataSource {
  constructor(opts = {}) {
    super();
    this.seed = opts.seed ?? 1234;
    this.tickMs = opts.tickMs ?? 100;
    this.nick = opts.nick ?? "Mock";
    this.world = null;
    this.frame = 0;
    this._timer = null;
  }

  start() {
    super.start();
    this.world = buildWorld(this.seed);
    const m = this.world.map;

    this._emit({
      type: S2C.HELLO,
      protocol: PROTOCOL,
      server: "mock",
      you: { id: "local", nick: this.nick },
      map: m,
    });

    for (let z = 0; z < m.zCount; z++) {
      this._emit({
        type: S2C.MAP,
        z,
        origin: { x: 0, y: 0 },
        w: m.xCount,
        h: m.yCount,
        tiles: this.world.levels[z].tiles,
      });
    }
    this._emitUnits();

    // Buildings are static in the mock: emit once per z that has any.
    const byZ = new Map();
    for (const b of this.world.buildings || []) {
      if (!byZ.has(b.z)) byZ.set(b.z, []);
      byZ.get(b.z).push(b);
    }
    for (const [z, list] of byZ) this._emit({ type: S2C.BUILDINGS, z, list });

    if (typeof setInterval === "function") {
      this._timer = setInterval(() => this.step(), this.tickMs);
    }
  }

  /** Advance one animation tick (also callable directly from tests). */
  step() {
    if (!this.world) return;
    this.frame++;
    stepWorld(this.world);
    this._emit({ type: S2C.TICK, frame: this.frame, fps: Math.round(1000 / this.tickMs) });
    this._emitUnits();
  }

  _emitUnits() {
    this._emit({ type: S2C.UNITS, list: this.world.units.map((u) => ({ ...u })) });
  }

  stop() {
    super.stop();
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }
}
