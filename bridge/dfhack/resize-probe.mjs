// Resize probe (de-risk for the Resize Stockpile/Zone slice). Stockpiles (building_type.Stockpile=29)
// and activity zones (Civzone=30) are abstract buildings with a bounding box (x1,y1)-(x2,y2) AND a
// per-tile occupancy map in `building.room` (a df.building_extents_type: x, y, width, height, and a
// uint8 `extents` array, 1 = tile is in the building). Growing/shrinking — or carving a non-rectangular
// shape — means rewriting BOTH the box and that extents map. This probe pins down, against live DF
// (DFHack on :5000), WHY the obvious in-place edit is impossible and that the shipped approach works:
//
//   [1] In-place is a dead end: dfhack.buildings.setSize REJECTS a constructed building (it requires
//       bld.id == -1, i.e. a not-yet-registered placement), and you can't reallocate room.extents from
//       Lua (df.new('uint8_t',n) gives an "incompatible pointer type" on assignment). So a size change,
//       which needs a different-sized extents array, can't be done on the live building.
//   [2] Encoding (ground truth from a real building): extents is indexed dy*width+dx, value 1 = in.
//   [3] (--test X Y Z) The SHIPPED primitive on a THROWAWAY pile: DECONSTRUCT + RECONSTRUCT at the new
//       box, then write the desired extents mask (per-byte writes DO work). Proves: (a) a fresh
//       construct + hand-written mask yields any shape; (b) a non-rectangular carve PERSISTS across
//       frames (re-read in a later RPC); (c) RFR streams the carved extents back on MapBlock.buildings
//       so the client renders the exact shape. Then it deconstructs the throwaway — the fort is left
//       untouched. (This mirrors DFAccess.resize / occupancyMask.)
//
// SAFE by default — introspection + a read-only survey. --test only creates+destroys its own pile.
//
// Usage:
//   node bridge/dfhack/resize-probe.mjs
//   node bridge/dfhack/resize-probe.mjs --test 170 160 158
import { DFHackClient } from "./client.mjs";

const host = process.env.DF_HOST || "127.0.0.1";
const port = Number(process.env.DF_PORT) || 5000;

const args = process.argv.slice(2);
let test = null;
const ti = args.indexOf("--test");
if (ti >= 0) {
  const [x, y, z] = args.slice(ti + 1, ti + 4).map(Number);
  if (![x, y, z].every(Number.isFinite)) {
    console.error("--test needs X Y Z (an open spot for a throwaway pile)");
    process.exit(2);
  }
  test = { x, y, z };
}

const client = await DFHackClient.connect({ host, port });
console.log(`connected to DFHack at ${host}:${port}`);
const info = await client.call("GetMapInfo");
console.log(`map: ${info.block_size_x * 16}x${info.block_size_y * 16}x${info.block_size_z} tiles`);

async function lua(code) {
  const { text } = await client.callText("RunCommand", { command: "lua", arguments: [code] });
  for (const line of text) if (/^PROBE/.test(line)) console.log("  " + line);
}

console.log("\n[1] Why in-place resize is impossible (setSize type; the rejections are demonstrated under --test):");
await lua(`
print('PROBE setSize type = '..type(dfhack.buildings.setSize))
print('PROBE => setSize rejects a constructed building (needs bld.id==-1) and room.extents cannot be')
print('PROBE    reallocated from Lua (df.new gives "incompatible pointer type"): must reconstruct')
`);

console.log("\n[2] Encoding from a REAL multi-tile stockpile/zone (extents index + 'in' value):");
await lua(`
local n = 0
for _,b in ipairs(df.global.world.buildings.all) do
  local t = b:getType()
  if (t==df.building_type.Stockpile or t==df.building_type.Civzone) and (b.x2>b.x1 or b.y2>b.y1) and n<2 then
    n = n + 1
    local r = b.room
    local seen = {}
    if r and r.extents~=nil then for i=0,r.width*r.height-1 do seen[r.extents[i]]=(seen[r.extents[i]] or 0)+1 end end
    local vs={} for v,c in pairs(seen) do vs[#vs+1]=v..'x'..c end table.sort(vs)
    print('PROBE bt='..t..' box=('..b.x1..','..b.y1..')-('..b.x2..','..b.y2..') room='..((r and (r.width..'x'..r.height)) or 'nil')..' extents={'..table.concat(vs,' ')..'}')
  end
end
print('PROBE surveyed = '..n)
`);

if (test) {
  const { x, y, z } = test;

  console.log(`\n[1b] In-place rejection demo @ (${x},${y},${z}) — setSize + extents realloc on a built pile:`);
  await lua(`
local X,Y,Z = ${x},${y},${z}
local ok,b = pcall(dfhack.buildings.constructBuilding,{type=df.building_type.Stockpile,pos={x=X,y=Y,z=Z},width=2,height=2,abstract=true})
if not ok or not b then print('PROBE 1b construct FAILED = '..tostring(b)) return end
local s,e = pcall(dfhack.buildings.setSize, b, 3, 3, 0)
print('PROBE 1b setSize on a constructed pile -> ok='..tostring(s)..' err='..tostring(e))
local n; pcall(function() n=df.new('uint8_t',4) end)
local s2,e2 = pcall(function() b.room.extents = n end)
print('PROBE 1b reassign room.extents from df.new -> ok='..tostring(s2)..' err='..tostring(e2))
pcall(df.delete, n)
pcall(dfhack.buildings.deconstruct, b)
`);

  const W = 5, H = 4;
  // Desired L-shape mask (remove the bottom-right 2x2), row-major dy*W+dx — same convention as extents.
  let mask = "";
  for (let dy = 0; dy < H; dy++) for (let dx = 0; dx < W; dx++) mask += dx >= 3 && dy >= 2 ? "0" : "1";

  console.log(`\n[3] SHIPPED primitive @ (${x},${y},${z}) — reconstruct a ${W}x${H} pile as an L, then verify it sticks:`);
  console.log(`    desired L (row-major): ${mask}`);
  await lua(`
local X,Y,Z,W,H,mask = ${x},${y},${z},${W},${H},'${mask}'
for i=#df.global.world.buildings.all-1,0,-1 do local b=df.global.world.buildings.all[i] if b:getType()==df.building_type.Stockpile and b.z==Z and not(b.x2<X or b.x1>X+W or b.y2<Y or b.y1>Y+H) then pcall(dfhack.buildings.deconstruct,b) end end
local ok,b = pcall(dfhack.buildings.constructBuilding,{type=df.building_type.Stockpile,pos={x=X,y=Y,z=Z},width=W,height=H,abstract=true})
if not ok or not b then print('PROBE create FAILED = '..tostring(b)) return end
if type(b.settings.flags.food)=='boolean' then b.settings.flags.food=true end
local r = b.room
for i=0,W*H-1 do r.extents[i]=(mask:sub(i+1,i+1)=='1') and 1 or 0 end
print('PROBE built id='..b.id..' box=('..b.x1..','..b.y1..')-('..b.x2..','..b.y2..') food='..tostring(b.settings.flags.food))
`);

  // Re-read in a SEPARATE RPC (frames later) — does DF keep the non-rectangular shape, or rectangularize?
  console.log("  [persistence] re-read the same pile's extents in a later RPC:");
  await lua(`
local X,Y,Z = ${x},${y},${z}
local b = dfhack.buildings.findAtTile(X,Y,Z)
if not b then print('PROBE persistence NOT FOUND') return end
local r = b.room
for dy=0,r.height-1 do local s='' for dx=0,r.width-1 do s=s..tostring(r.extents[dy*r.width+dx]) end print('PROBE persist row '..s) end
`);

  // RFR streaming check — does the carved extents come back on the read path the client uses?
  console.log("  [stream] GetBlockList: does RFR carry the carved extents?");
  const bl = await client.call("GetBlockList", {
    blocks_needed: 16, min_x: x >> 4, max_x: (x >> 4) + 1, min_y: y >> 4, max_y: (y >> 4) + 1,
    min_z: z, max_z: z + 1, force_reload: true,
  });
  const seen = new Set();
  for (const blk of bl.map_blocks || []) {
    for (const bd of blk.buildings || []) {
      if (seen.has(bd.index)) continue;
      seen.add(bd.index);
      const t = bd.building_type || {};
      if ((t.building_type ?? -1) !== 29) continue;
      if (!(x >= bd.pos_x_min && x <= bd.pos_x_max && y >= bd.pos_y_min && y <= bd.pos_y_max)) continue;
      const r = bd.room;
      console.log(r ? `    RFR room ${r.width}x${r.height} extents=[${(r.extents || []).join(",")}]` : "    RFR room absent");
    }
  }

  // cleanup
  await lua(`
local X,Y,Z,W,H = ${x},${y},${z},${W},${H}
local removed=0
for i=#df.global.world.buildings.all-1,0,-1 do local b=df.global.world.buildings.all[i] if b:getType()==df.building_type.Stockpile and b.z==Z and not(b.x2<X or b.x1>X+W or b.y2<Y or b.y1>Y+H) then if pcall(dfhack.buildings.deconstruct,b) then removed=removed+1 end end end
print('PROBE CLEANUP removed = '..removed)
`);
}

client.quit();
console.log("\ndone.");
