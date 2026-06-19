// DFAccess: a higher-level, shareable view of a running DF via DFHack RemoteFortressReader.
// Owns one (lazily-established) DFHackClient connection — RPCs are serialized inside the
// client, so a single DFAccess can safely back many browser connections. Exposes fortress
// state already translated into the dfplex client protocol's terms (TILE codes, unit dicts).
import { DFHackClient } from "./client.mjs";
import { buildTileTable } from "./tiles.mjs";
import { TILE } from "../../client/js/protocol.js";

export class DFAccess {
  constructor(opts = {}) {
    this.opts = opts; // { host, port }
    this.client = null;
    this.info = null; // cached GetMapInfo
    this._tileTable = null; // cached tiletype id -> TILE code
    this._connecting = null;
  }

  async connect() {
    if (this.client) return this.client;
    if (!this._connecting) {
      this._connecting = DFHackClient.connect(this.opts).catch((e) => {
        this._connecting = null; // allow a later retry once DF is up
        throw e;
      });
    }
    this.client = await this._connecting;
    return this.client;
  }

  async mapInfo() {
    await this.connect();
    this.info = await this.client.call("GetMapInfo");
    return this.info;
  }

  async viewZ() {
    return (await this.view()).z;
  }

  /** DF's current viewport: corner position + size, in tiles. */
  async view() {
    await this.connect();
    const v = await this.client.call("GetViewInfo");
    return {
      x: v.view_pos_x | 0,
      y: v.view_pos_y | 0,
      z: v.view_pos_z | 0,
      w: v.view_size_x | 0,
      h: v.view_size_y | 0,
    };
  }

  async tileTable() {
    if (this._tileTable) return this._tileTable;
    await this.connect();
    const tl = await this.client.call("GetTiletypeList");
    this._tileTable = buildTileTable(tl.tiletype_list || []);
    return this._tileTable;
  }

  /** Map dimensions in tiles, or null until mapInfo() has run. */
  get dims() {
    const i = this.info;
    return i
      ? { xCount: i.block_size_x * 16, yCount: i.block_size_y * 16, zCount: i.block_size_z }
      : null;
  }

  /**
   * Translate a single z-level into a full-level, row-major tiles array (xCount*yCount),
   * with water/magma/hidden applied. Returns { z, w, h, tiles: number[] }.
   */
  async level(z) {
    await this.connect();
    const info = this.info || (await this.mapInfo());
    const table = await this.tileTable();
    const W = info.block_size_x * 16;
    const H = info.block_size_y * 16;
    const tiles = new Uint8Array(W * H); // 0 == EMPTY (also covers unsent/edge blocks)

    const bl = await this.client.call("GetBlockList", {
      blocks_needed: info.block_size_x * info.block_size_y + 8,
      min_x: 0,
      max_x: info.block_size_x,
      min_y: 0,
      max_y: info.block_size_y,
      min_z: z,
      max_z: z + 1,
      force_reload: true, // v1: always a full snapshot (delta streaming is a later optimization)
    });

    for (const b of bl.map_blocks || []) {
      const bt = b.tiles;
      if (!bt || !bt.length) continue;
      const ox = b.map_x; // tile coords of the block's corner
      const oy = b.map_y;
      const water = b.water;
      const magma = b.magma;
      const hidden = b.hidden;
      for (let i = 0; i < bt.length; i++) {
        const gx = ox + (i & 15); // x fastest: index = y*16 + x
        const gy = oy + (i >> 4);
        if (gx < 0 || gy < 0 || gx >= W || gy >= H) continue;
        let code;
        if (hidden && hidden[i]) {
          code = TILE.EMPTY; // undiscovered rock — keep it black, don't reveal the map
        } else {
          const id = bt[i];
          code = id < table.length ? table[id] : TILE.EMPTY;
          if (magma && magma[i] > 0) code = TILE.MAGMA;
          else if (water && water[i] > 0) code = TILE.WATER;
        }
        tiles[gy * W + gx] = code;
      }
    }
    // Cheap FNV-1a over the level so a source can skip re-sending an unchanged z-level.
    let hash = 0x811c9dc5;
    for (let i = 0; i < tiles.length; i++) {
      hash = Math.imul((hash ^ tiles[i]) >>> 0, 0x01000193) >>> 0;
    }
    return { z, w: W, h: H, tiles: Array.from(tiles), hash };
  }

  /** Visible on-map units as client unit dicts. */
  async units() {
    await this.connect();
    const info = this.info || (await this.mapInfo());
    const W = info.block_size_x * 16;
    const H = info.block_size_y * 16;
    const ul = await this.client.call("GetUnitList");
    const out = [];
    for (const u of ul.creature_list || []) {
      const x = u.pos_x;
      const y = u.pos_y;
      const z = u.pos_z;
      if (x == null || y == null || z == null) continue;
      if (x < 0 || y < 0 || z < 0 || x >= W || y >= H) continue; // off-map / sentinel positions
      out.push({ id: u.id, x, y, z, name: u.name || "", ch: "☺", color: 14 });
    }
    return out;
  }
}
