// DFAccess: a higher-level, shareable view of a running DF via DFHack RemoteFortressReader.
// Owns one (lazily-established) DFHackClient connection — RPCs are serialized inside the
// client, so a single DFAccess can safely back many browser connections. Exposes fortress
// state already translated into the dfplex client protocol's terms (TILE codes, unit dicts).
import { DFHackClient } from "./client.mjs";
import { buildTileTable } from "./tiles.mjs";
import { TILE } from "../../client/js/protocol.js";
import { BUILD_BY_KIND } from "../../client/js/buildings.js";
import { STOCKPILE_BY_KIND, CATEGORY_KEYS } from "../../client/js/stockpiles.js";
import { ZONE_BY_KIND, ZONE_CIV_NAMES } from "../../client/js/zones.js";

// Building types whose abstract footprint a resize can grow/shrink, mapped to the trusted DF struct
// name. The client sends one of these keys as `target`; nothing else is ever interpolated as the type.
const RESIZE_TARGETS = { stockpile: "Stockpile", zone: "Civzone" };

// Per-use zone defaults for a RESIZED zone, where the use (subtype) is only known at runtime (read off
// the old zone as `sub`). Each is guarded by the runtime subtype and pcall'd, so exactly the matching
// default applies — mirrors the placement defaults in zone(), which key off the known preset instead.
const zoneResizeDefaultsLua = (v) =>
  `if sub==df.civzone_type.Pen then pcall(function() ${v}.zone_settings.pen.flags.check_occupants=true end) end ` +
  `if sub==df.civzone_type.Pond then pcall(function() ${v}.zone_settings.pond.flag.keep_filled=true end) end ` +
  `if sub==df.civzone_type.ArcheryRange then pcall(function() ${v}.zone_settings.archery.dir_x=1 ${v}.zone_settings.archery.dir_y=0 end) end ` +
  `if sub==df.civzone_type.Tomb then pcall(function() ${v}.zone_settings.tomb.flags.whole=1 end) end ` +
  `if sub==df.civzone_type.PlantGathering then pcall(function() local g=${v}.zone_settings.gather.flags g.pick_trees=true g.pick_shrubs=true g.gather_fallen=true end) end `;

// Build a row-major '0'/'1' occupancy string over a stockpile/zone's bbox from RFR's streamed
// room.extents (mapped by world coords, so it's robust even if room != bbox). Returns the mask ONLY
// when the footprint is non-rectangular (has at least one empty cell); a rectangular pile/zone — and
// every non-abstract building — gets null, so the client keeps filling the whole bbox as before.
function occupancyMask(bd, x0, y0, x1, y1, bt) {
  if (bt !== 29 && bt !== 30) return null; // Stockpile / Civzone only
  const r = bd.room;
  if (!r || !r.extents || !r.extents.length) return null;
  const rx = r.pos_x | 0, ry = r.pos_y | 0, rw = r.width | 0, rh = r.height | 0;
  if (rw <= 0 || rh <= 0) return null;
  let mask = "", hole = false;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - rx, dy = y - ry;
      const on = dx >= 0 && dy >= 0 && dx < rw && dy < rh && r.extents[dy * rw + dx] > 0;
      mask += on ? "1" : "0";
      if (!on) hole = true;
    }
  }
  return hole ? mask : null;
}

// dfplex command kind -> RFR TileDigDesignation enum value.
const DESIGNATIONS = {
  dig: 1, // DEFAULT_DIG
  updownstair: 2, // UP_DOWN_STAIR_DIG
  channel: 3, // CHANNEL_DIG
  ramp: 4, // RAMP_DIG
  downstair: 5, // DOWN_STAIR_DIG
  upstair: 6, // UP_STAIR_DIG
  remove: 0, // NO_DIG (clears a designation)
};

// Lua helper (expects a settings struct `st` in scope) defining fill(name): enable one stockpile
// category by setting its master flag bit AND flipping every boolean — and every boolean inside a
// nested vector — under that category's sub-struct true. A pile built or edited this way "accepts
// everything in the category", matching the DF UI's category master toggle. Shared by the preset
// placement (stockpile) and the per-pile editor (stockpileSet) so "on" means the same in both.
const STOCKPILE_FILL_LUA =
  `local function fill(name) ` +
  `if type(st.flags[name])=='boolean' then st.flags[name]=true end ` +
  `local cat=st[name] ` +
  `if type(cat)=='userdata' then for k,v in pairs(cat) do ` +
  `if type(v)=='boolean' then cat[k]=true ` +
  `elseif type(v)=='userdata' then for i,vv in pairs(v) do if type(vv)=='boolean' then v[i]=true end end end ` +
  `end end end `;

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

    const desig = []; // sparse dig designations on this level: { x, y, d }
    const buildings = []; // deduped building footprints intersecting this level
    const seenBld = new Set();
    for (const b of bl.map_blocks || []) {
      // Buildings ride along on the block list (MapBlock.buildings); collect once per index.
      for (const bd of b.buildings || []) {
        if (seenBld.has(bd.index)) continue;
        const zmin = bd.pos_z_min ?? z;
        const zmax = bd.pos_z_max ?? z;
        if (z < zmin || z > zmax) continue;
        seenBld.add(bd.index);
        const t = bd.building_type || {};
        const x0 = bd.pos_x_min | 0, y0 = bd.pos_y_min | 0, x1 = bd.pos_x_max | 0, y1 = bd.pos_y_max | 0;
        const bt = t.building_type ?? -1;
        const rec = { i: bd.index, x0, y0, x1, y1, bt, st: t.building_subtype ?? -1, active: bd.active ? 1 : 0 };
        // A non-rectangular stockpile/zone carries its per-tile shape so the client renders it exactly.
        const mask = occupancyMask(bd, x0, y0, x1, y1, bt);
        if (mask) rec.mask = mask;
        buildings.push(rec);
      }
      const bt = b.tiles;
      if (!bt || !bt.length) continue;
      const ox = b.map_x; // tile coords of the block's corner
      const oy = b.map_y;
      const water = b.water;
      const magma = b.magma;
      const hidden = b.hidden;
      const dig = b.tile_dig_designation;
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
        if (dig && dig[i] > 0) desig.push({ x: gx, y: gy, d: dig[i] });
      }
    }
    // Cheap FNV-1a over the level so a source can skip re-sending an unchanged z-level.
    let hash = 0x811c9dc5;
    for (let i = 0; i < tiles.length; i++) {
      hash = Math.imul((hash ^ tiles[i]) >>> 0, 0x01000193) >>> 0;
    }
    return { z, w: W, h: H, tiles: Array.from(tiles), hash, desig, buildings };
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

  /**
   * Apply a designation to a list of {x,y,z} tiles. Dig-style kinds go through RFR SendDigCommand;
   * chop/gather have no RFR designation, so they mark the plant under each tile via DFHack's core
   * Lua designations API (see _markPlants). markPlant lands a tile_dig_designation either way, so
   * both paths stream back to clients through the normal desig channel.
   */
  async designate(kind, tiles) {
    await this.connect();
    if (!tiles || !tiles.length) return;
    if (kind === "chop" || kind === "gather") return this._markPlants(kind, tiles);
    const designation = DESIGNATIONS[kind] ?? DESIGNATIONS.dig;
    await this.client.call("SendDigCommand", {
      designation,
      locations: tiles.map((t) => ({ x: t.x, y: t.y, z: t.z })),
    });
  }

  /**
   * Mark the plant under each tile for chopping (trees) or gathering (shrubs) via DFHack's core Lua
   * designations API — RFR's SendDigCommand has no chop/gather designation. dfhack.maps.getPlantAtTile
   * resolves the plant; dfhack.designations.markPlant auto-selects chop vs gather *from the plant
   * itself* (it ignores `kind`), so each tool must filter which plants it touches — else one drag
   * would chop every tree AND gather every shrub under it. We classify by plant *species* via its raw
   * TREE flag (world.raws.plants.all[plant.material].flags.TREE): chop marks only TREE species (incl.
   * saplings), gather only non-trees (bushes/crops/grasses). Tile shape proved unreliable — some
   * gatherable bushes aren't SHRUB-shaped, so a shape rule leaked them into chop. canMarkPlant still
   * skips unmarkable tiles. The mark lands as RFR
   * tile_dig_designation, so it streams back through the normal desig path with no extra channel.
   * `kind` (chop|gather) is a trusted label only (never client free text); coords are coerced to
   * integers — nothing client-controlled is interpolated as code.
   */
  async _markPlants(kind, tiles) {
    const ps = tiles
      .filter((t) => Number.isFinite(t.x) && Number.isFinite(t.y) && Number.isFinite(t.z))
      .map((t) => `{x=${t.x | 0},y=${t.y | 0},z=${t.z | 0}}`)
      .join(",");
    if (!ps) return;
    const wantTree = kind === "chop"; // chop => TREE species (incl. saplings); gather => everything else
    const code =
      `local ps={${ps}} local d=dfhack.designations local pr=df.global.world.raws.plants.all local placed=0 ` +
      `for _,p in ipairs(ps) do ` +
      `local pl=dfhack.maps.getPlantAtTile(p.x,p.y,p.z) ` +
      `if pl then local raw=pr[pl.material] local isTree=(raw~=nil) and raw.flags.TREE ` +
      `if isTree==${wantTree} and d.canMarkPlant(pl) then local ok=pcall(d.markPlant,pl) if ok then placed=placed+1 end end ` +
      `end end ` +
      `print('dfplex ${kind} placed='..placed)`;
    await this.client.call("RunCommand", { command: "lua", arguments: [code] });
  }

  /**
   * Place buildings of `kind` (a build-palette key) at each of `tiles` via DFHack's Lua building
   * API. RFR has no building RPC, so this runs `dfhack.buildings.constructBuilding` through the
   * core RunCommand("lua", ...) channel. With no items, DFHack derives default material filters,
   * so dwarves haul any matching stone/wood. The building type/subtype come from the trusted
   * palette (never client input); coordinates are coerced to integers — nothing client-controlled
   * is interpolated as code.
   */
  async build(kind, tiles) {
    await this.connect();
    const order = BUILD_BY_KIND[kind];
    if (!order) throw new Error(`unknown build kind: ${kind}`);
    if (!tiles || !tiles.length) return;
    const ps = tiles
      .filter((t) => Number.isFinite(t.x) && Number.isFinite(t.y) && Number.isFinite(t.z))
      .map((t) => `{x=${t.x | 0},y=${t.y | 0},z=${t.z | 0}}`)
      .join(",");
    if (!ps) return;
    // Subtype + direction come only from the trusted palette (never client input). Keep them as
    // numeric DF enum values so they double as getCorrectSize args below; -1 means "none".
    const st = order.subEnum ? `df.${order.subEnum}.${order.subName}` : "-1";
    const dr = Number.isInteger(order.dir) ? String(order.dir) : "-1";
    // Center each building on the clicked tile. constructBuilding takes `pos` as the top-left corner,
    // so first ask DFHack for this building's footprint: getCorrectSize returns
    // (is_flexible, w, h, centerx, centery), where center{x,y} is the centre tile's offset from the
    // corner; shifting the corner back by it lands the centre on the click. 1×1 buildings (and
    // constructions, which place one tile each) have offset 0, so they stay on the clicked tile.
    const code =
      `local ps={${ps}} local bt=df.building_type.${order.btype} local st=${st} local dr=${dr} ` +
      `local placed,err=0,nil ` +
      `for _,p in ipairs(ps) do ` +
      `local _,_,_,cx,cy=dfhack.buildings.getCorrectSize(1,1,bt,st,-1,dr) cx=cx or 0 cy=cy or 0 ` +
      `local a={type=bt,pos={x=p.x-cx,y=p.y-cy,z=p.z}} ` +
      `if st>=0 then a.subtype=st end if dr>=0 then a.direction=dr end ` +
      `local ok,b=pcall(dfhack.buildings.constructBuilding,a) if ok and b then placed=placed+1 else err=tostring(b) end end ` +
      `print('dfplex build ${kind} placed='..placed..(err and (' err='..err) or ''))`;
    await this.client.call("RunCommand", { command: "lua", arguments: [code] });
  }

  /**
   * Place one stockpile spanning the drag rectangle and pre-configure it to a preset type. RFR has no
   * stockpile RPC, so this runs dfhack.buildings.constructBuilding through RunCommand("lua", ...).
   * Stockpiles are *abstract* buildings (abstract=true, no materials) and, built this way, accept
   * NOTHING until configured — so for each category in the preset we set settings.flags.<cat> (the
   * master enable the DF UI toggles) and fill that category's sub-item flags. building_type Stockpile
   * (29) streams back on the normal buildings channel, so the pile renders with no extra wiring.
   * `kind` is a trusted preset key (never client free text); the category names come from the frozen
   * preset table and are re-checked against CATEGORY_KEYS; coords are integer-coerced and the bounding
   * box is computed server-side — nothing client-controlled is interpolated as code.
   */
  async stockpile(kind, tiles) {
    await this.connect();
    const preset = STOCKPILE_BY_KIND[kind];
    if (!preset) throw new Error(`unknown stockpile kind: ${kind}`);
    if (!tiles || !tiles.length) return;
    // Bounding box (corner + span) over the finite tiles of the drag rectangle; z from the first.
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, z = null, n = 0;
    for (const t of tiles) {
      if (!Number.isFinite(t.x) || !Number.isFinite(t.y) || !Number.isFinite(t.z)) continue;
      const x = t.x | 0, y = t.y | 0;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
      if (z === null) z = t.z | 0;
      n++;
    }
    if (!n) return;
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    // Categories come from the trusted preset table; re-filter to known keys as defense-in-depth so
    // only df.stockpile_settings.flags field names are ever interpolated.
    const known = new Set(CATEGORY_KEYS);
    const cats = preset.cats.filter((c) => known.has(c));
    if (!cats.length) return;
    const catList = cats.map((c) => `'${c}'`).join(",");
    const code =
      `local x0,y0,z,w,h=${x0},${y0},${z},${w},${h} local cats={${catList}} ` +
      `local ok,b=pcall(dfhack.buildings.constructBuilding,{type=df.building_type.Stockpile,pos={x=x0,y=y0,z=z},width=w,height=h,abstract=true}) ` +
      `if not ok or not b then print('dfplex stockpile ${kind} err='..tostring(b)) return end ` +
      `local st=b.settings ` +
      STOCKPILE_FILL_LUA +
      `for _,c in ipairs(cats) do fill(c) end ` +
      // A fresh constructBuilding can leave a few extents bytes uninitialized until DF's next building
      // pass (which never runs while paused); fill the rectangle so the pile streams as a clean shape.
      `local r=b.room if r then for i=0,w*h-1 do r.extents[i]=1 end end ` +
      `print('dfplex stockpile ${kind} id='..tostring(b.id)..' '..w..'x'..h)`;
    await this.client.call("RunCommand", { command: "lua", arguments: [code] });
  }

  /**
   * Read the category state of the stockpile under a single tile, for the editor panel. RFR has no
   * stockpile RPC and a pile carries no stable id on the streamed building record, so the client
   * sends the clicked tile and the backend resolves the pile with dfhack.buildings.findAtTile
   * (probe-confirmed to match from any interior tile, not just the corner). Returns
   * { box:{x0,y0,x1,y1,z}, cats:{ <key>:bool, … } } for each of the 17 master flags, or { box:null }
   * when the tile holds no pile. Coords are integer-coerced; the category names come only from the
   * frozen CATEGORY_KEYS — nothing client-controlled is interpolated as code. The reply rides back on
   * the Lua print() surface (RunCommand's output type is EmptyMessage), captured via callText.
   */
  async stockpileGet(tile) {
    await this.connect();
    if (!tile || !Number.isFinite(tile.x) || !Number.isFinite(tile.y) || !Number.isFinite(tile.z)) {
      return { box: null };
    }
    const x = tile.x | 0, y = tile.y | 0, z = tile.z | 0;
    const known = new Set(CATEGORY_KEYS);
    const catList = CATEGORY_KEYS.map((c) => `'${c}'`).join(",");
    const code =
      `local x,y,z=${x},${y},${z} local cats={${catList}} ` +
      `local b=dfhack.buildings.findAtTile(x,y,z) ` +
      `if not b or b:getType()~=df.building_type.Stockpile then print('dfplex spget none') return end ` +
      `local st=b.settings local out={} ` +
      `for _,c in ipairs(cats) do out[#out+1]=c..'='..(st.flags[c] and '1' or '0') end ` +
      `print('dfplex spget box='..b.x1..','..b.y1..','..b.x2..','..b.y2..','..b.z..' '..table.concat(out,' '))`;
    const { text } = await this.client.callText("RunCommand", { command: "lua", arguments: [code] });
    const blob = text.join("\n");
    if (/dfplex spget none/.test(blob)) return { box: null };
    const m = blob.match(/dfplex spget box=(-?\d+),(-?\d+),(-?\d+),(-?\d+),(-?\d+)[ \t]+([^\n]*)/);
    if (!m) return { box: null };
    const cats = {};
    for (const tok of m[6].trim().split(/\s+/)) {
      const eq = tok.indexOf("=");
      if (eq <= 0) continue;
      const k = tok.slice(0, eq);
      if (known.has(k)) cats[k] = tok.slice(eq + 1) === "1";
    }
    return { box: { x0: +m[1], y0: +m[2], x1: +m[3], y1: +m[4], z: +m[5] }, cats };
  }

  /**
   * Toggle categories on the stockpile under a tile (the editor's write path). `cats` is a sparse
   * map { <key>:bool } of changes: true enables a category (master flag + sub-items via the shared
   * fill helper, same as preset placement), false disables it (clear the master flag — the gate DF
   * checks; sub-items are left untouched). Keys are filtered to CATEGORY_KEYS and coords are
   * integer-coerced, so only known flag names and integers ever reach the Lua. No-ops (no known
   * keys, non-finite tile) emit no RPC.
   */
  async stockpileSet(tile, cats) {
    await this.connect();
    if (!tile || !Number.isFinite(tile.x) || !Number.isFinite(tile.y) || !Number.isFinite(tile.z)) return;
    if (!cats || typeof cats !== "object") return;
    const known = new Set(CATEGORY_KEYS);
    const on = [], off = [];
    for (const [k, v] of Object.entries(cats)) {
      if (!known.has(k)) continue;
      (v ? on : off).push(k);
    }
    if (!on.length && !off.length) return;
    const x = tile.x | 0, y = tile.y | 0, z = tile.z | 0;
    const onList = on.map((c) => `'${c}'`).join(",");
    const offList = off.map((c) => `'${c}'`).join(",");
    const code =
      `local x,y,z=${x},${y},${z} local on={${onList}} local off={${offList}} ` +
      `local b=dfhack.buildings.findAtTile(x,y,z) ` +
      `if not b or b:getType()~=df.building_type.Stockpile then print('dfplex spset none') return end ` +
      `local st=b.settings ` +
      STOCKPILE_FILL_LUA +
      `for _,c in ipairs(on) do fill(c) end ` +
      `for _,c in ipairs(off) do if type(st.flags[c])=='boolean' then st.flags[c]=false end end ` +
      `print('dfplex spset id='..tostring(b.id)..' on='..#on..' off='..#off)`;
    await this.client.call("RunCommand", { command: "lua", arguments: [code] });
  }

  /**
   * Read one unit's detail for the inspect panel. The client clicks a dwarf; it already has that
   * unit's id from the streamed `units` feed (RFR GetUnitList), so it sends the id and the backend
   * resolves it with df.unit.find(id) in core Lua — that unlocks the human-readable fields GetUnitList
   * doesn't carry (profession name, race name, happiness, current job, wounds). The id is integer-
   * coerced and finite-guarded, so only an integer ever reaches the Lua (no client free text); a
   * non-finite / missing id emits no RPC. Each lookup is pcall-guarded in the Lua so a helper that's
   * absent in this DFHack build comes back empty rather than blanking the whole read. The reply rides
   * the print() surface (RunCommand's output type is EmptyMessage), captured via callText. Each field
   * is its own `dfplex unit <key>=<value>` line so a free-form value — the readable name carries
   * commas, quotes and '=' — parses cleanly. Returns { info:{…} }, or { info:null } when no such unit.
   */
  async unitGet(id) {
    await this.connect();
    if (id == null || !Number.isFinite(Number(id))) return { info: null };
    const i = Number(id) | 0;
    const code =
      `local u=df.unit.find(${i}) ` +
      `if not u then print('dfplex unit none') return end ` +
      `local function s(f) local ok,v=pcall(f) if ok and v~=nil then return tostring(v) end return '' end ` +
      `local function p(k,f) print('dfplex unit '..k..'='..s(f)) end ` +
      `print('dfplex unit id=${i}') ` +
      `p('name',function() return dfhack.units.getReadableName(u) end) ` +
      `p('prof',function() return dfhack.units.getProfessionName(u) end) ` +
      `p('race',function() return dfhack.units.getRaceName(u) end) ` +
      `p('age',function() return dfhack.units.getAge(u,true) end) ` +
      `p('citizen',function() return dfhack.units.isCitizen(u) end) ` +
      `p('dead',function() return dfhack.units.isDead(u) end) ` +
      `p('soldier',function() return u.military and u.military.squad_id>=0 end) ` +
      `p('stress',function() return u.status.current_soul.personality.stress end) ` +
      `p('stresscat',function() return dfhack.units.getStressCategory and dfhack.units.getStressCategory(u) end) ` +
      `p('job',function() local j=u.job.current_job if j then return df.job_type[j.job_type] end return 'Idle' end) ` +
      `p('wounds',function() return #u.body.wounds end)`;
    const { text } = await this.client.callText("RunCommand", { command: "lua", arguments: [code] });
    const blob = text.join("\n");
    if (/^dfplex unit none$/m.test(blob)) return { info: null };
    const f = {};
    for (const line of blob.split("\n")) {
      const m = line.match(/^dfplex unit (\w+)=(.*)$/);
      if (m) f[m[1]] = m[2];
    }
    if (f.id == null) return { info: null };
    const num = (v) => (v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
    const age = num(f.age);
    return {
      info: {
        id: i,
        name: f.name || "",
        profession: f.prof || "",
        race: f.race || "",
        age: age != null ? Math.floor(age) : null,
        citizen: f.citizen === "true",
        dead: f.dead === "true",
        soldier: f.soldier === "true",
        stress: num(f.stress),
        stressCat: num(f.stresscat),
        job: f.job || "",
        wounds: num(f.wounds),
      },
    };
  }

  /**
   * Place one activity zone spanning the drag rectangle. RFR has no zone RPC, so this runs
   * dfhack.buildings.constructBuilding through RunCommand("lua", ...), mirroring DFHack's own
   * quickfort/zone.lua recipe: a zone is an *abstract* civzone (building_type Civzone = 30) whose use
   * (Meeting Area / Pen / Pond / …) rides in as the building `subtype` (a df.civzone_type value);
   * spec_sub_flag.active makes it live. A few uses get the DF UI's default per-type settings (pen
   * occupant-check, pond keep-filled, gather pick-all, archery facing, tomb whole-body) so they behave
   * like a hand-placed zone. The created civzone streams back on the normal buildings channel as
   * { bt:30, st:<subtype> } (confirmed via zone-probe.mjs), so it renders with no extra wiring.
   *
   * `kind` is a trusted preset key (never client free text); its `civ` enum name is re-checked against
   * ZONE_CIV_NAMES so only a vetted df.civzone_type identifier is interpolated; coords are integer-
   * coerced and the bounding box is computed server-side — nothing client-controlled reaches the Lua
   * as code. Empty / all-non-finite tiles emit no RPC.
   */
  async zone(kind, tiles) {
    await this.connect();
    const preset = ZONE_BY_KIND[kind];
    if (!preset) throw new Error(`unknown zone kind: ${kind}`);
    // Defense-in-depth: the civzone_type name must be a known enum identifier (presets are trusted, but
    // this guarantees only a vetted token is ever interpolated into the Lua chunk).
    if (!ZONE_CIV_NAMES.includes(preset.civ)) throw new Error(`unknown civzone type: ${preset.civ}`);
    if (!tiles || !tiles.length) return;
    // Bounding box (corner + span) over the finite tiles of the drag rectangle; z from the first.
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, z = null, n = 0;
    for (const t of tiles) {
      if (!Number.isFinite(t.x) || !Number.isFinite(t.y) || !Number.isFinite(t.z)) continue;
      const x = t.x | 0, y = t.y | 0;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
      if (z === null) z = t.z | 0;
      n++;
    }
    if (!n) return;
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    // Per-use defaults, keyed by the validated civ name (mirrors quickfort/zone.lua); each pcall-guarded.
    const EXTRA = {
      Pen: `pcall(function() b.zone_settings.pen.flags.check_occupants=true end) `,
      Pond: `pcall(function() b.zone_settings.pond.flag.keep_filled=true end) `,
      ArcheryRange: `pcall(function() b.zone_settings.archery.dir_x=1 b.zone_settings.archery.dir_y=0 end) `,
      Tomb: `pcall(function() b.zone_settings.tomb.flags.whole=1 end) `,
      PlantGathering: `pcall(function() local g=b.zone_settings.gather.flags g.pick_trees=true g.pick_shrubs=true g.gather_fallen=true end) `,
    };
    const code =
      `local x0,y0,z,w,h=${x0},${y0},${z},${w},${h} ` +
      `local sub=df.civzone_type.${preset.civ} ` +
      `local ok,b=pcall(dfhack.buildings.constructBuilding,{type=df.building_type.Civzone,subtype=sub,pos={x=x0,y=y0,z=z},width=w,height=h,abstract=true}) ` +
      `if not ok or not b then print('dfplex zone ${kind} err='..tostring(b)) return end ` +
      `pcall(function() if type(b.spec_sub_flag.active)=='boolean' then b.spec_sub_flag.active=true end end) ` +
      (EXTRA[preset.civ] || "") +
      // Fill the rectangle's extents (a fresh construct can leave stray bytes until DF's next pass,
      // which never runs while paused), so the zone streams as a clean shape rather than spurious holes.
      `local r=b.room if r then for i=0,w*h-1 do r.extents[i]=1 end end ` +
      `print('dfplex zone ${kind} id='..tostring(b.id)..' '..w..'x'..h)`;
    await this.client.call("RunCommand", { command: "lua", arguments: [code] });
  }

  /**
   * Grow/shrink/reshape one stockpile/zone to a new footprint IN PLACE — without deconstructing — so
   * the building keeps its identity and ALL its settings/links (stockpile category + item-level config,
   * zone assignments). We mutate `b.room`'s extents + bbox directly: the extents element type is the
   * enum `building_extents_type` (base int8_t), which `df.new` can't array-allocate, so to GROW we
   * allocate an int8_t buffer and `df.reinterpret_cast` it to the enum pointer before assigning (proven
   * in resize-inplace-probe.mjs); a same-or-smaller footprint reuses the existing buffer. DF does NOT
   * fold in-place extent changes into per-tile map occupancy, so for a stockpile we set it to match what
   * constructBuilding produces (occupancy.building = Passable on occupied tiles, None on released ones);
   * zones don't use building occupancy (verified live), so they only get the extents+bbox poke. RFR
   * streams `room.extents` back, so any shape round-trips and renders for free.
   *
   * The client computes the new shape (it already has the building's streamed mask) and sends:
   *   target  trusted key "stockpile" | "zone" (the only thing mapped to a DF struct name)
   *   tile    a tile inside the OLD building, to resolve it (findAtTile / findCivzonesAt)
   *   from    the old bbox {x0,y0,x1,y1}, to disambiguate overlapping zones (else the first is taken)
   *   box     the new bbox {x0,y0,w,h}; null/empty means the resize cleared it -> just deconstruct
   *   mask    row-major '0'/'1' over box, length w*h — the new occupancy
   * Coords are integer-coerced; the mask is re-validated to ^[01]+$ of exactly w*h before it's ever
   * interpolated (so it can't carry Lua); a non-finite tile emits no RPC; a bad mask throws (surfaced
   * to the client as an error). If the in-place attempt fails outright (e.g. the realloc is rejected),
   * it falls back to the original DECONSTRUCT + RECONSTRUCT path (which re-applies a snapshot of the
   * stockpile's 17 category flags / the zone's use+active+per-use defaults, but — like a fresh placement
   * — does not preserve assignments/links). That fallback is the only lossy path and shouldn't trigger.
   */
  async resize(target, tile, box, mask, from) {
    await this.connect();
    const btName = RESIZE_TARGETS[target];
    if (!btName) throw new Error(`unknown resize target: ${target}`);
    if (!tile || !Number.isFinite(tile.x) || !Number.isFinite(tile.y) || !Number.isFinite(tile.z)) return;
    const tx = tile.x | 0, ty = tile.y | 0, tz = tile.z | 0;

    // Resolve the target. Stockpiles can't overlap, so findAtTile is exact; zones can, so prefer the
    // civzone at the tile whose box matches the client's `from` hint, else fall back to the first.
    const hb = from && [from.x0, from.y0, from.x1, from.y1].every(Number.isFinite)
      ? { x0: from.x0 | 0, y0: from.y0 | 0, x1: from.x1 | 0, y1: from.y1 | 0 }
      : { x0: -2147483648, y0: 0, x1: 0, y1: 0 }; // sentinel matches nothing -> first civzone
    const resolve = target === "stockpile"
      ? `local b=dfhack.buildings.findAtTile(${tx},${ty},${tz}) ` +
        `if not b or b:getType()~=df.building_type.Stockpile then print('dfplex resize none') return end `
      : `local _l=dfhack.buildings.findCivzonesAt(xyz2pos(${tx},${ty},${tz})) local b=nil ` +
        `if _l then for _,zz in ipairs(_l) do if zz.x1==${hb.x0} and zz.y1==${hb.y0} and zz.x2==${hb.x1} and zz.y2==${hb.y1} then b=zz break end end if not b and #_l>0 then b=_l[1] end end ` +
        `if not b then print('dfplex resize none') return end `;

    // Empty box: the resize cleared the last tile -> resolve + deconstruct, building removed.
    const boxOk = box && [box.x0, box.y0, box.w, box.h].every(Number.isFinite) && box.w >= 1 && box.h >= 1;
    if (!boxOk) {
      const code = resolve + `pcall(dfhack.buildings.deconstruct, b) print('dfplex resize ${target} removed')`;
      await this.client.call("RunCommand", { command: "lua", arguments: [code] });
      return;
    }
    const x0 = box.x0 | 0, y0 = box.y0 | 0, w = box.w | 0, h = box.h | 0;
    if (typeof mask !== "string" || !/^[01]+$/.test(mask) || mask.length !== w * h) {
      throw new Error(`resize: bad mask (len ${typeof mask === "string" ? mask.length : "?"} != ${w * h})`);
    }
    // mask is sanitized to 0/1 of exactly w*h, so interpolating it as a Lua string literal is safe.
    const isPile = target === "stockpile";
    const nN = w * h;

    // Snapshot settings — only the rebuild FALLBACK uses these; the in-place path preserves everything
    // by never destroying the building.
    const snap = isPile
      ? `local snap={} for k,v in pairs(b.settings.flags) do if type(v)=='boolean' and v then snap[k]=true end end `
      : `local sub=b.type local act=b.spec_sub_flag.active `;

    // Occupancy reconcile (STOCKPILE only): DF won't fold an in-place extent change into the per-tile
    // map occupancy, so set it ourselves to match constructBuilding — Passable on every occupied tile,
    // None on tiles the old footprint occupied but the new one doesn't. Zones don't use it (occ === "").
    const occ = isPile
      ? `local function setOcc(x,y,v) local blk=dfhack.maps.getTileBlock(x,y,Z) if blk then blk.occupancy[x%16][y%16].building=v end end ` +
        `for _,c in ipairs(oldocc) do setOcc(c[1],c[2],df.tile_building_occ.None) end ` +
        `for dy=0,${h - 1} do for dx=0,${w - 1} do if r.extents[dy*${w}+dx]~=0 then setOcc(${x0}+dx,${y0}+dy,df.tile_building_occ.Passable) end end end `
      : ``;

    // In-place edit: reshape b.room's extents + bbox with no deconstruct (links/settings survive).
    const inplace =
      `local function tryInplace() ` +
      `local r=b.room if not r then return false end ` +
      `local oW,oH,oX,oY=r.width,r.height,r.x,r.y ` +
      // capture the old occupied world tiles first (for the stockpile occupancy clear)
      `local oldocc={} if r.extents~=nil then for dy=0,oH-1 do for dx=0,oW-1 do if r.extents[dy*oW+dx]~=0 then oldocc[#oldocc+1]={oX+dx,oY+dy} end end end end ` +
      // grow needs a bigger extents buffer: enum building_extents_type can't be array-new'd, so make an
      // int8_t array and reinterpret_cast it (assign while dims are still old so reads stay in-bounds).
      `if ${nN} > oW*oH then ` +
      `local old=r.extents ` +
      `local okM,buf=pcall(df.new,'int8_t',${nN}) if not(okM and buf) then return false end ` +
      `local okR,view=pcall(df.reinterpret_cast,df.building_extents_type,buf) if not(okR and view) then pcall(df.delete,buf) return false end ` +
      `local okA=pcall(function() r.extents=view end) if not okA then pcall(df.delete,buf) return false end ` +
      `pcall(df.delete,old) end ` +
      // write the new mask linearly (row-major over WxH), then commit dims + bbox
      `for i=0,${nN - 1} do r.extents[i]=(('${mask}'):sub(i+1,i+1)=='1') and 1 or 0 end ` +
      `r.x,r.y,r.width,r.height=${x0},${y0},${w},${h} ` +
      `b.x1,b.y1,b.x2,b.y2=${x0},${y0},${x0 + w - 1},${y0 + h - 1} ` +
      occ +
      `return true end `;

    // Rebuild FALLBACK (only if tryInplace fails): the original deconstruct + reconstruct path.
    const writeMaskNb = `local r=nb.room for i=0,${nN - 1} do r.extents[i]=(('${mask}'):sub(i+1,i+1)=='1') and 1 or 0 end `;
    const rebuild = isPile
      ? `pcall(dfhack.buildings.deconstruct, b) ` +
        `local ok,nb=pcall(dfhack.buildings.constructBuilding,{type=df.building_type.Stockpile,pos={x=${x0},y=${y0},z=Z},width=${w},height=${h},abstract=true}) ` +
        `if not ok or not nb then print('dfplex resize err='..tostring(nb)) return end ` +
        `local st=nb.settings ` + STOCKPILE_FILL_LUA + `for k,_ in pairs(snap) do fill(k) end ` +
        writeMaskNb +
        `print('dfplex resize stockpile id='..tostring(nb.id)..' ${w}x${h} rebuilt')`
      : `pcall(dfhack.buildings.deconstruct, b) ` +
        `local ok,nb=pcall(dfhack.buildings.constructBuilding,{type=df.building_type.Civzone,subtype=sub,pos={x=${x0},y=${y0},z=Z},width=${w},height=${h},abstract=true}) ` +
        `if not ok or not nb then print('dfplex resize err='..tostring(nb)) return end ` +
        `pcall(function() if type(nb.spec_sub_flag.active)=='boolean' then nb.spec_sub_flag.active=act end end) ` +
        zoneResizeDefaultsLua("nb") +
        writeMaskNb +
        `print('dfplex resize zone id='..tostring(nb.id)..' ${w}x${h} rebuilt')`;

    const body =
      `local Z=b.z ` + snap + inplace +
      `local s,res=pcall(tryInplace) ` +
      `if s and res then print('dfplex resize ${target} id='..tostring(b.id)..' ${w}x${h} inplace') else ` +
      rebuild + ` end`;

    await this.client.call("RunCommand", { command: "lua", arguments: [resolve + body] });
  }
}

