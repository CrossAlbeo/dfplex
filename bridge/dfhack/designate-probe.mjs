// Designation-write probe (Phase 4 de-risk for Chop + Gather). RemoteFortressReader's SendDigCommand
// only covers the dig-style TileDigDesignation enum — it has NO designation for chopping trees or
// gathering plants. Those go through DFHack's core Lua designations API instead
// (dfhack.designations.markPlant / unmarkPlant, which auto-pick chop vs gather from the plant). This
// probe pins down the exact call against the user's live DF (DFHack remote on :5000), mirroring
// build-probe.mjs.
//
// Default run is SAFE — it introspects the designations API and lists tree/shrub tiles near the view
// WITHOUT mutating the game. Pass `--mark X Y Z` to actually mark the plant at one tile for
// chop/gather and read the mark back; `--unmark X Y Z` clears it again.
//
// print() surface returns as REPLY_TEXT, shown on stderr as `[df] ...` by client.mjs; the probe's
// own findings go to stdout.
//
// Usage:
//   node bridge/dfhack/designate-probe.mjs
//   node bridge/dfhack/designate-probe.mjs --mark 100 120 150
//   node bridge/dfhack/designate-probe.mjs --unmark 100 120 150
import { DFHackClient } from "./client.mjs";

const host = process.env.DF_HOST || "127.0.0.1";
const port = Number(process.env.DF_PORT) || 5000;

const args = process.argv.slice(2);
function coordFlag(flag) {
  const i = args.indexOf(flag);
  if (i < 0) return null;
  const x = Number(args[i + 1]);
  const y = Number(args[i + 2]);
  const z = Number(args[i + 3]);
  if (![x, y, z].every(Number.isFinite)) {
    console.error(`${flag} needs X Y Z tile coords`);
    process.exit(2);
  }
  return { x, y, z };
}
const mark = coordFlag("--mark");
const unmark = coordFlag("--unmark");

const client = await DFHackClient.connect({ host, port });
console.log(`connected to DFHack at ${host}:${port}`);

const info = await client.call("GetMapInfo");
const view = await client.call("GetViewInfo");
console.log(
  `map: ${info.block_size_x * 16}x${info.block_size_y * 16}x${info.block_size_z} tiles; ` +
    `view @ (${view.view_pos_x},${view.view_pos_y},${view.view_pos_z}) size ${view.view_size_x}x${view.view_size_y}`
);

// One Lua chunk via core RunCommand("lua", [code]); print() surface returns on stderr as [df] lines.
async function lua(code) {
  await client.call("RunCommand", { command: "lua", arguments: [code] });
}

// Read RFR's tile_dig_designation at one tile (the field the existing desig stream renders). If a
// plant mark shows up here, chop/gather render for free through that stream; if not, they need their
// own channel.
async function rfrDigAt(x, y, z) {
  const bl = await client.call("GetBlockList", {
    blocks_needed: 4,
    min_x: x >> 4, max_x: (x >> 4) + 1,
    min_y: y >> 4, max_y: (y >> 4) + 1,
    min_z: z, max_z: z + 1,
    force_reload: true,
  });
  for (const b of bl.map_blocks || []) {
    if (b.map_x === (x >> 4) * 16 && b.map_y === (y >> 4) * 16 && b.tile_dig_designation) {
      return b.tile_dig_designation[(y & 15) * 16 + (x & 15)];
    }
  }
  return undefined;
}

console.log("\n[1] designations API introspection ([df] PROBE lines on stderr):");
const introspect = `
local function names(t) local k={} pcall(function() for n,_ in pairs(t) do k[#k+1]=tostring(n) end end) table.sort(k) return table.concat(k,',') end
print('PROBE designations.fns: '..names(dfhack.designations))
print('PROBE maps.getPlantAtTile: '..type(dfhack.maps.getPlantAtTile))
print('PROBE plants.all count: '..tostring(#df.global.world.plants.all))
local p = df.global.world.plants.all[0]
if p then
  print('PROBE plant0 fields: '..names(p))
  print('PROBE plant0 type='..tostring(p.type)..' material='..tostring(p.material)..' tree_info='..tostring(p.tree_info~=nil))
  local raw0 = df.global.world.raws.plants.all[p.material]
  if raw0 then
    local k={} pcall(function() for fn,fv in pairs(raw0.flags) do if fv==true then k[#k+1]=tostring(fn) end end end)
    print('PROBE plant0 raw='..tostring(raw0.id)..' setflags='..table.concat(k,','))
  end
  print('PROBE plant0 pos: '..tostring(p.pos and (p.pos.x..','..p.pos.y..','..p.pos.z)))
end
`;
try {
  await lua(introspect);
  console.log("  introspection sent");
} catch (e) {
  console.log("  introspection FAILED:", e.message);
}

console.log("\n[2] markable plant tiles within the current view (concrete --mark targets):");
const survey = `
local vx,vy,vz,vw,vh = ${view.view_pos_x},${view.view_pos_y},${view.view_pos_z},${view.view_size_x},${view.view_size_y}
local d = dfhack.designations
local function shapeAt(p)
  local ok,sh = pcall(function() local tt=dfhack.maps.getTileType(p.pos.x,p.pos.y,p.pos.z) return df.tiletype.attrs[tt].shape end)
  if not ok then return nil,'ERR' end
  return sh, df.tiletype_shape[sh] or tostring(sh)
end
local SHRUB; pcall(function() SHRUB = df.tiletype_shape.SHRUB end)
print('PROBE tiletype_shape.SHRUB enum = '..tostring(SHRUB))
local n,shown,trees,shrubs = 0,0,0,0
for _,p in ipairs(df.global.world.plants.all) do
  if p.pos.z==vz and p.pos.x>=vx and p.pos.x<vx+vw and p.pos.y>=vy and p.pos.y<vy+vh then
    n=n+1
    local sh,shn = shapeAt(p)
    if sh==SHRUB then shrubs=shrubs+1 else trees=trees+1 end
    local canMark = d.canMarkPlant and d.canMarkPlant(p)
    if shown<16 and canMark then
      shown=shown+1
      local raw = df.global.world.raws.plants.all[p.material]
      local okT,isTree = pcall(function() return raw.flags.TREE end)
      print('PROBE cand '..p.pos.x..' '..p.pos.y..' '..p.pos.z..' shape='..shn..' tree_info='..tostring(p.tree_info~=nil)..' raw='..tostring(raw and raw.id)..' TREE='..tostring(okT and isTree))
    end
  end
end
print('PROBE plants on view z: '..n..' (trees='..trees..' shrubs='..shrubs..')')
-- confirm tile->plant resolution (the call the real feature will use)
local pa = dfhack.maps.getPlantAtTile(vx+math.floor(vw/2), vy+math.floor(vh/2), vz)
print('PROBE getPlantAtTile@center: '..tostring(pa and (pa.pos.x..','..pa.pos.y..','..pa.pos.z) or 'nil'))
`;
try {
  await lua(survey);
  console.log("  survey sent");
} catch (e) {
  console.log("  survey FAILED:", e.message);
}

if (mark) {
  console.log(`\n[3] MARK plant @ (${mark.x},${mark.y},${mark.z}) for chop/gather, read back:`);
  const code = `
local X,Y,Z = ${mark.x},${mark.y},${mark.z}
local d = dfhack.designations
local p = dfhack.maps.getPlantAtTile(X,Y,Z)
if not p then print('PROBE MARK: no plant at tile') return end
print('PROBE MARK: before canMark='..tostring(d.canMarkPlant and d.canMarkPlant(p))..' marked='..tostring(d.isPlantMarked and d.isPlantMarked(p)))
local ok,err = pcall(d.markPlant, p)
print('PROBE MARK: markPlant ok='..tostring(ok)..(ok and '' or (' err='..tostring(err))))
print('PROBE MARK: after marked='..tostring(d.isPlantMarked and d.isPlantMarked(p)))
local dt = d.getPlantDesignationTile and d.getPlantDesignationTile(p)
print('PROBE MARK: designation tile='..tostring(dt and (dt.x..','..dt.y..','..dt.z) or 'nil'))
`;
  try {
    const before = await rfrDigAt(mark.x, mark.y, mark.z);
    await lua(code);
    const after = await rfrDigAt(mark.x, mark.y, mark.z);
    console.log(`  RFR tile_dig_designation at tile: before=${before} after=${after}`);
    console.log(
      after && after > 0
        ? "  => chop/gather IS visible in tile_dig_designation — renders via the existing desig stream"
        : "  => NOT in tile_dig_designation — chop/gather needs its own mark channel to render"
    );
    console.log("  mark sent — check DF (the tree/shrub should now carry a chop/gather designation)");
  } catch (e) {
    console.log("  mark FAILED:", e.message);
  }
}

if (unmark) {
  console.log(`\n[4] UNMARK plant @ (${unmark.x},${unmark.y},${unmark.z}):`);
  const code = `
local X,Y,Z = ${unmark.x},${unmark.y},${unmark.z}
local d = dfhack.designations
local p = dfhack.maps.getPlantAtTile(X,Y,Z)
if not p then print('PROBE UNMARK: no plant at tile') return end
local ok,err = pcall(d.unmarkPlant, p)
print('PROBE UNMARK: unmarkPlant ok='..tostring(ok)..(ok and '' or (' err='..tostring(err))))
print('PROBE UNMARK: after marked='..tostring(d.isPlantMarked and d.isPlantMarked(p)))
`;
  try {
    await lua(code);
    console.log("  unmark sent");
  } catch (e) {
    console.log("  unmark FAILED:", e.message);
  }
}

client.quit();
console.log("\ndone.");
