// DFAccess: a higher-level, shareable view of a running DF via DFHack RemoteFortressReader.
// Owns one (lazily-established) DFHackClient connection — RPCs are serialized inside the
// client, so a single DFAccess can safely back many browser connections. Exposes fortress
// state already translated into the dfplex client protocol's terms (TILE codes, unit dicts).
import { DFHackClient } from "./client.mjs";
import { buildTileTable } from "./tiles.mjs";
import { TILE } from "../../client/js/protocol.js";
import { BUILD_BY_KIND } from "../../client/js/buildings.js";
import { STOCKPILE_BY_KIND, CATEGORY_KEYS } from "../../client/js/stockpiles.js";

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
        buildings.push({
          i: bd.index,
          x0: bd.pos_x_min | 0,
          y0: bd.pos_y_min | 0,
          x1: bd.pos_x_max | 0,
          y1: bd.pos_y_max | 0,
          bt: t.building_type ?? -1,
          st: t.building_subtype ?? -1,
          active: bd.active ? 1 : 0,
        });
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
}

