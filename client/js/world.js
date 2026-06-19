// World: the client's local model of fortress state, assembled from protocol messages.
// Map blocks are blitted into full per-z grids at their origin, so the same code handles
// the mock's whole-level sends and the bridge's future partial/scoped updates.

import { S2C, TILE } from "./protocol.js";

export class World {
  constructor() {
    this.map = null; // { xCount, yCount, zCount, zSurface }
    this.levels = new Map(); // z -> { w, h, tiles: Uint8Array }
    this.units = new Map(); // id -> unit
    this.designations = new Map(); // z -> [{ x, y, d }] sparse dig designations
    this.frame = 0;
    this.fps = 0;
    this.you = null;
    this.server = null;
    this.lastError = null;
  }

  /** Apply one server->client message. Returns the message type for convenience. */
  apply(msg) {
    switch (msg.type) {
      case S2C.HELLO:
        this.map = msg.map;
        this.you = msg.you;
        this.server = msg.server;
        break;
      case S2C.MAP:
        this._applyMap(msg);
        break;
      case S2C.UNITS:
        this.units = new Map(msg.list.map((u) => [u.id, u]));
        break;
      case S2C.DESIG:
        this.designations.set(msg.z, msg.list || []);
        break;
      case S2C.TICK:
        this.frame = msg.frame;
        this.fps = msg.fps;
        break;
      case S2C.ERROR:
        this.lastError = msg.message;
        break;
      // CHAT is handled by the app/UI layer, not the world model.
    }
    return msg.type;
  }

  _ensureLevel(z) {
    let lvl = this.levels.get(z);
    if (!lvl && this.map) {
      lvl = {
        w: this.map.xCount,
        h: this.map.yCount,
        tiles: new Uint8Array(this.map.xCount * this.map.yCount),
      };
      this.levels.set(z, lvl);
    }
    return lvl;
  }

  _applyMap(msg) {
    const lvl = this._ensureLevel(msg.z);
    if (!lvl) return;
    const ox = msg.origin?.x ?? 0;
    const oy = msg.origin?.y ?? 0;
    for (let ry = 0; ry < msg.h; ry++) {
      const gy = oy + ry;
      if (gy < 0 || gy >= lvl.h) continue;
      for (let rx = 0; rx < msg.w; rx++) {
        const gx = ox + rx;
        if (gx < 0 || gx >= lvl.w) continue;
        lvl.tiles[gy * lvl.w + gx] = msg.tiles[ry * msg.w + rx];
      }
    }
  }

  /** Tile shape code at (x,y,z), or EMPTY if unknown/out of range. */
  tileAt(x, y, z) {
    const lvl = this.levels.get(z);
    if (!lvl) return TILE.EMPTY;
    if (x < 0 || y < 0 || x >= lvl.w || y >= lvl.h) return TILE.EMPTY;
    return lvl.tiles[y * lvl.w + x];
  }

  unitsOnZ(z) {
    const out = [];
    for (const u of this.units.values()) if (u.z === z) out.push(u);
    return out;
  }

  /** Sparse dig designations on z-level `z`: [{ x, y, d }]. */
  desigOnZ(z) {
    return this.designations.get(z) || [];
  }
}
