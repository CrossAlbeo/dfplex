// RFRSource: a DataSource backed by a live DF via RemoteFortressReader (through DFAccess).
// One instance per browser connection — it tracks that client's active z-level (from its
// `viewport` messages) and streams hello/map/units/tick for it. Multiple instances share one
// DFAccess (and thus one DFHack socket); the client serializes the actual RPCs.
import { DataSource } from "../client/js/datasource.js";
import { PROTOCOL, S2C, C2S } from "../client/js/protocol.js";

export class RFRSource extends DataSource {
  constructor(df, opts = {}) {
    super();
    this.df = df; // shared DFAccess
    this.pollMs = opts.pollMs ?? 750;
    this.nick = opts.nick ?? "Player";
    this.activeZ = null;
    this.frame = 0;
    this._timer = null;
    this._busy = false;
    this._sentHash = new Map(); // z -> last level hash sent to this client
  }

  async start() {
    super.start();
    await this.df.mapInfo(); // cache dims on df for level()/units()
    const dims = this.df.dims;
    const v = await this.df.view();
    const z = v.z;
    this.activeZ = z;

    this._emit({
      type: S2C.HELLO,
      protocol: PROTOCOL,
      server: "rfr-bridge",
      you: { id: "local", nick: this.nick },
      map: { xCount: dims.xCount, yCount: dims.yCount, zCount: dims.zCount, zSurface: z },
      // Where to open the camera: DF's own view center, so the browser shows your fort.
      start: { x: v.x + (v.w >> 1), y: v.y + (v.h >> 1), z },
    });

    await this._streamZ(z);
    await this._sendUnits();

    if (typeof setInterval === "function") {
      this._timer = setInterval(() => this._poll(), this.pollMs);
    }
  }

  /** Client -> source messages: join / viewport / command. */
  send(msg) {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === C2S.JOIN && typeof msg.nick === "string") {
      this.nick = msg.nick;
    } else if (msg.type === C2S.VIEWPORT && Number.isInteger(msg.z)) {
      this.activeZ = msg.z; // refresh this z from the next poll on (single event loop: safe to set now)
    } else if (msg.type === C2S.COMMAND && msg.op === "designate") {
      const tiles = Array.isArray(msg.tiles) ? msg.tiles : [];
      this.df
        .designate(msg.kind || "dig", tiles)
        // Refresh exactly the z-level(s) we just mutated, regardless of activeZ, so the new
        // designation always reaches this client — even when it designated right after changing z.
        .then(() => {
          const zs = tiles.length ? [...new Set(tiles.map((t) => t.z))] : [this.activeZ];
          return Promise.all(zs.map((z) => this._streamZ(z)));
        })
        .catch((e) => this._emit({ type: S2C.ERROR, message: `designate: ${e.message}` }));
    } else if (msg.type === C2S.COMMAND && msg.op === "build") {
      const tiles = Array.isArray(msg.tiles) ? msg.tiles : [];
      this.df
        .build(msg.kind, tiles)
        // Refresh the z-level(s) we mutated so the new building reaches this client promptly.
        .then(() => {
          const zs = tiles.length ? [...new Set(tiles.map((t) => t.z))] : [this.activeZ];
          return Promise.all(zs.map((z) => this._streamZ(z)));
        })
        .catch((e) => this._emit({ type: S2C.ERROR, message: `build: ${e.message}` }));
    } else if (msg.type === C2S.COMMAND && msg.op === "stockpile") {
      // One pile spans the whole drag rectangle; the bridge derives its bounding box from these tiles.
      const tiles = Array.isArray(msg.tiles) ? msg.tiles : [];
      this.df
        .stockpile(msg.kind, tiles)
        // Refresh the z-level(s) we mutated so the new stockpile reaches this client promptly.
        .then(() => {
          const zs = tiles.length ? [...new Set(tiles.map((t) => t.z))] : [this.activeZ];
          return Promise.all(zs.map((z) => this._streamZ(z)));
        })
        .catch((e) => this._emit({ type: S2C.ERROR, message: `stockpile: ${e.message}` }));
    }
  }

  async _poll() {
    if (this._busy || !this.running) return;
    this._busy = true;
    try {
      this.frame++;
      await this._streamZ(this.activeZ);
      await this._sendUnits();
      this._emit({ type: S2C.TICK, frame: this.frame, fps: Math.round(1000 / this.pollMs) });
    } catch (e) {
      this._emit({ type: S2C.ERROR, message: `RFR poll: ${e.message}` });
    } finally {
      this._busy = false;
    }
  }

  // Stream a z-level: the map only when its tiles changed (hash), plus the (cheap, sparse)
  // dig designations every time so user actions show up promptly.
  async _streamZ(z) {
    const lvl = await this.df.level(z);
    if (this._sentHash.get(z) !== lvl.hash) {
      this._sentHash.set(z, lvl.hash);
      this._emit({ type: S2C.MAP, z, origin: { x: 0, y: 0 }, w: lvl.w, h: lvl.h, tiles: lvl.tiles });
    }
    this._emit({ type: S2C.DESIG, z, list: lvl.desig });
    this._emit({ type: S2C.BUILDINGS, z, list: lvl.buildings });
  }

  async _sendUnits() {
    this._emit({ type: S2C.UNITS, list: await this.df.units() });
  }

  stop() {
    super.stop();
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }
}
