// Build-placement probe (Phase 4 de-risk). RemoteFortressReader has no building-placement RPC —
// only the core RunCommand/RunLua methods plus DFHack's Lua building API can place a building. This
// probe works out exactly how, against the user's live DF (DFHack remote on :5000).
//
// Default run is SAFE — it introspects the Lua building API and tests the core transport WITHOUT
// mutating the game. Pass `--place X Y Z [kind]` to actually place one test building
// (kind: wall|workshop|bed|depot) so we can confirm dwarves build it.
//
// DF's own console output (from print()) comes back as REPLY_TEXT and is shown on stderr as
// `[df] ...` by client.mjs; the probe's own findings go to stdout.
//
// Usage:
//   node bridge/dfhack/build-probe.mjs
//   node bridge/dfhack/build-probe.mjs --place 100 120 150 wall
import { DFHackClient } from "./client.mjs";

const host = process.env.DF_HOST || "127.0.0.1";
const port = Number(process.env.DF_PORT) || 5000;

const args = process.argv.slice(2);
const testplace = args.includes("--testplace"); // non-destructive: construct then deconstruct
let place = null;
const pi = args.indexOf("--place");
if (pi >= 0) {
  const x = Number(args[pi + 1]);
  const y = Number(args[pi + 2]);
  const z = Number(args[pi + 3]);
  const kind = args[pi + 4] || "wall";
  if (![x, y, z].every(Number.isFinite)) {
    console.error("--place needs X Y Z tile coords, optional kind (wall|workshop|bed|depot)");
    process.exit(2);
  }
  place = { x, y, z, kind };
}

const client = await DFHackClient.connect({ host, port });
console.log(`connected to DFHack at ${host}:${port}`);

// Sanity: RFR reads still work, and learn coords near the player (handy for a --place target).
const info = await client.call("GetMapInfo");
const view = await client.call("GetViewInfo");
console.log(
  `map: ${info.block_size_x * 16}x${info.block_size_y * 16}x${info.block_size_z} tiles; ` +
    `view @ (${view.view_pos_x},${view.view_pos_y},${view.view_pos_z}) size ${view.view_size_x}x${view.view_size_y}`
);

// Run one Lua chunk via the core RunCommand("lua", [code]); the DFHack `lua` command runs its
// argument as code (no -e flag), and prints surface on stderr as REPLY_TEXT.
async function lua(code) {
  await client.call("RunCommand", { command: "lua", arguments: [code] });
}

console.log("\n[1] RunCommand transport (want a '[df] PROBE: ...' line on stderr):");
try {
  await lua("print('PROBE: lua works; DF '..dfhack.getDFVersion())");
  console.log("  RunCommand('lua', [code]) returned OK");
} catch (e) {
  console.log("  RunCommand('lua', ...) FAILED:", e.message);
}

console.log("\n[2] Building API introspection (results on stderr as [df] PROBE lines):");
const introspect = `
local function names(t) local k={} if type(t)=='table' then for n,_ in pairs(t) do k[#k+1]=n end end table.sort(k) return table.concat(k,',') end
print('PROBE buildings.fns: '..names(dfhack.buildings))
print('PROBE constructBuilding: '..type(dfhack.buildings and dfhack.buildings.constructBuilding))
print('PROBE enums: building_type='..type(df.building_type)..' construction_type='..type(df.construction_type)..' workshop_type='..type(df.workshop_type))
local ok,bp = pcall(require,'plugins.buildingplan')
print('PROBE buildingplan.require: '..tostring(ok))
if ok then print('PROBE buildingplan.fns: '..names(bp)) end
`;
try {
  await lua(introspect);
  console.log("  introspection sent");
} catch (e) {
  console.log("  introspection FAILED:", e.message);
}

console.log("\n[3] RunLua core method (structured result, if the server implements it):");
try {
  const r = await client.call("RunLua", { module: "dfhack", function: "getDFVersion", arguments: [] });
  console.log(`  RunLua(dfhack.getDFVersion) -> ${JSON.stringify(r.value || [])}`);
} catch (e) {
  console.log(`  RunLua FAILED: ${e.message}  (will use RunCommand+lua instead)`);
}

if (testplace) {
  console.log("\n[4] Non-destructive placement test (auto-find floor near view; construct → verify → deconstruct):");
  const cx = view.view_pos_x + (view.view_size_x >> 1);
  const cy = view.view_pos_y + (view.view_size_y >> 1);
  const cz = view.view_pos_z;
  const code = `
local cx,cy,cz = ${cx},${cy},${cz}
local FLOOR = df.tiletype_shape.FLOOR
local function shapeAt(x,y,z) local tt=dfhack.maps.getTileType(x,y,z) if not tt then return nil end return df.tiletype.attrs[tt].shape end
local found
for r=0,8 do
  for dy=-r,r do for dx=-r,r do
    local x,y = cx+dx, cy+dy
    if shapeAt(x,y,cz)==FLOOR and not dfhack.buildings.findAtTile(x,y,cz) then found={x=x,y=y,z=cz} break end
  end if found then break end end
  if found then break end
end
if not found then print('PROBE TESTPLACE: no free floor tile near view') return end
local ok,b = pcall(dfhack.buildings.constructBuilding, {type=df.building_type.Construction, subtype=df.construction_type.Wall, pos=found})
if not ok then print('PROBE TESTPLACE: constructBuilding error: '..tostring(b)) return end
print('PROBE TESTPLACE: constructed @ '..found.x..','..found.y..','..found.z..' name="'..tostring(dfhack.buildings.getName(b))..'"')
print('PROBE TESTPLACE: findAtTile registered = '..tostring(dfhack.buildings.findAtTile(found.x,found.y,found.z) ~= nil))
local okd,ed = pcall(dfhack.buildings.deconstruct, b)
print('PROBE TESTPLACE: deconstruct = '..tostring(okd)..' '..tostring(ed))
`;
  try {
    await lua(code);
    console.log("  test placement sent (fort left untouched)");
  } catch (e) {
    console.log("  test placement FAILED:", e.message);
  }
}

if (place) {
  console.log(`\n[4] PLACE ${place.kind} @ (${place.x},${place.y},${place.z}):`);
  const spec = {
    wall: "type=df.building_type.Construction, subtype=df.construction_type.Wall",
    workshop: "type=df.building_type.Workshop, subtype=df.workshop_type.Carpenters",
    bed: "type=df.building_type.Bed",
    depot: "type=df.building_type.TradeDepot",
  }[place.kind] || "type=df.building_type.Construction, subtype=df.construction_type.Wall";
  const code = `
local ok,b = pcall(dfhack.buildings.constructBuilding, {${spec}, pos={x=${place.x},y=${place.y},z=${place.z}}})
if not ok then print('PROBE PLACE error: '..tostring(b)) return end
print('PROBE PLACE constructed='..tostring(b ~= nil)..' type='..tostring(b and b:getType()))
local okp,bp = pcall(require,'plugins.buildingplan')
if okp and type(bp)=='table' then
  for _,fn in ipairs({'addPlannedBuilding','planBuilding','assign'}) do
    if type(bp[fn])=='function' then local o,e = pcall(bp[fn], b) print('PROBE PLACE buildingplan.'..fn..'='..tostring(o)..' '..tostring(e)) end
  end
end
`;
  try {
    await lua(code);
    console.log("  placement sent — check DF (look for a planned/!!building!! at that tile) and re-read with explore.mjs");
  } catch (e) {
    console.log("  placement FAILED:", e.message);
  }
}

if (args.includes("--readbuildings")) {
  console.log("\n[5] Read buildings from GetBlockList at the view z (confirms the read path's data):");
  const z = view.view_pos_z;
  const bl = await client.call("GetBlockList", {
    blocks_needed: info.block_size_x * info.block_size_y + 8,
    min_x: 0, max_x: info.block_size_x, min_y: 0, max_y: info.block_size_y,
    min_z: z, max_z: z + 1, force_reload: true,
  });
  const seen = new Map();
  for (const b of bl.map_blocks || []) for (const bd of b.buildings || []) if (!seen.has(bd.index)) seen.set(bd.index, bd);
  console.log(`  unique buildings on z=${z}: ${seen.size}`);
  for (const s of [...seen.values()].slice(0, 10)) {
    const t = s.building_type || {};
    console.log(
      `    idx=${s.index} type=${t.building_type}/${t.building_subtype}/${t.building_custom} ` +
        `box=(${s.pos_x_min},${s.pos_y_min})-(${s.pos_x_max},${s.pos_y_max}) active=${s.active}`
    );
  }
}

client.quit();
console.log("\ndone.");
