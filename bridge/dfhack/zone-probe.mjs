// Zone probe (de-risk for the Activity Zones slice). RemoteFortressReader has no zone RPC — activity
// zones (df.building_civzonest) are created through DFHack's core Lua building API, like stockpiles.
// Unlike a workshop, a zone built programmatically does nothing until its `type`/`zone_flags` are set,
// so this probe pins down — against the user's live DF (DFHack remote on :5000):
//   1. df.building_type.Civzone, and whether constructBuilding makes a rectangular abstract civzone;
//   2. the df.civzone_type enum (id -> name) — the 18 zone uses (Meeting Area … Clay) the UI exposes;
//   3. the df.building_civzonest struct + zone_flags layout, so the backend knows what to flip to make
//      a created zone a Pen / Meeting Area / etc.;
//   4. how existing in-game zones look (ground truth);
//   5. THE CRITICAL ONE — whether a created civzone streams back on RFR's MapBlock.buildings list (the
//      same channel stockpiles ride). If it does, the zone renders client-side for free; if not, the
//      slice needs a different feedback path. The streaming check runs on the JS side via GetBlockList,
//      exactly the read path df-access uses.
//
// SAFE by default — introspection + a read-only survey; no mutation. Flags:
//   --place X Y Z W H [type]   create one WxH zone at the corner, set its type, read it back, confirm
//                              it streams via GetBlockList, then DECONSTRUCT it (fort left untouched).
//                              type: a civzone_type name (e.g. MeetingHall, Pen, Pond); default MeetingHall
// print() surface returns as REPLY_TEXT, shown on stderr as `[df] ...` by client.mjs; the probe's own
// findings go to stdout.
//
// Usage:
//   node bridge/dfhack/zone-probe.mjs
//   node bridge/dfhack/zone-probe.mjs --place 100 120 150 5 4 Pen
import { DFHackClient } from "./client.mjs";

const host = process.env.DF_HOST || "127.0.0.1";
const port = Number(process.env.DF_PORT) || 5000;

const args = process.argv.slice(2);
let place = null;
const pi = args.indexOf("--place");
if (pi >= 0) {
  const [x, y, z, w, h] = args.slice(pi + 1, pi + 6).map(Number);
  const type = args[pi + 6] || "MeetingHall";
  if (![x, y, z, w, h].every(Number.isFinite)) {
    console.error("--place needs X Y Z W H, optional civzone_type name (default MeetingHall)");
    process.exit(2);
  }
  place = { x, y, z, w, h, type };
}

const client = await DFHackClient.connect({ host, port });
console.log(`connected to DFHack at ${host}:${port}`);

const info = await client.call("GetMapInfo");
console.log(`map: ${info.block_size_x * 16}x${info.block_size_y * 16}x${info.block_size_z} tiles`);

// One Lua chunk via the core RunCommand("lua", [code]); print() surface returns on stderr as [df] lines.
async function lua(code) {
  await client.call("RunCommand", { command: "lua", arguments: [code] });
}

console.log("\n[1] Civzone building type + civzone_type enum ([df] PROBE lines on stderr):");
const introspect = `
local function names(t) local k={} pcall(function() for n,_ in pairs(t) do k[#k+1]=tostring(n) end end) table.sort(k) return table.concat(k,',') end
print('PROBE Civzone building_type = '..tostring(df.building_type.Civzone))
print('PROBE constructBuilding type = '..type(dfhack.buildings and dfhack.buildings.constructBuilding))
-- enumerate the civzone_type enum (the zone uses). numeric scan; df.<enum>[i] gives the name.
local okct = pcall(function() return df.civzone_type end)
print('PROBE df.civzone_type exists = '..tostring(okct and df.civzone_type ~= nil))
if okct and df.civzone_type ~= nil then
  local out = {}
  for i = 0, 40 do local n = df.civzone_type[i] if n then out[#out+1] = i..':'..tostring(n) end end
  print('PROBE civzone_type = '..table.concat(out, ' '))
end
`;
try { await lua(introspect); console.log("  introspection sent"); }
catch (e) { console.log("  introspection FAILED:", e.message); }

console.log("\n[2] building_civzonest bitfields — find where the zone USES (Meeting/Pen/Pond/...) live:");
const layout = `
local function bits(u) local k={} pcall(function() for n,v in pairs(u) do k[#k+1]=tostring(n)..'='..tostring(v) end end) table.sort(k) return table.concat(k,', ') end
local function fieldtypes(u) local k={} pcall(function() for n,v in pairs(u) do k[#k+1]=tostring(n)..':'..type(v) end end) table.sort(k) return table.concat(k,', ') end
local ok,b = pcall(function() return df.building_civzonest:new() end)
if not ok or not b then print('PROBE civzonest:new failed = '..tostring(b)) else
  pcall(function() print('PROBE .flags bits: '..bits(b.flags)) end)
  pcall(function() print('PROBE .spec_sub_flag bits: '..bits(b.spec_sub_flag)) end)
  pcall(function() print('PROBE .zone_settings fields: '..fieldtypes(b.zone_settings)) end)
  pcall(function() print('PROBE .zone_settings.whole fields: '..fieldtypes(b.zone_settings.whole)) end)
  pcall(function() print('PROBE .zone_settings.whole.flags bits: '..bits(b.zone_settings.whole.flags)) end)
  pcall(function() print('PROBE .zone_settings.pen fields: '..fieldtypes(b.zone_settings.pen)) end)
  pcall(function() print('PROBE .zone_settings.pond fields: '..fieldtypes(b.zone_settings.pond)) end)
  pcall(function() print('PROBE .zone_settings.gather fields: '..fieldtypes(b.zone_settings.gather)) end)
  pcall(function() print('PROBE .activities type: '..type(b.activities)) end)
  b:delete()
end
`;
try { await lua(layout); console.log("  layout sent"); }
catch (e) { console.log("  layout FAILED:", e.message); }

console.log("\n[3] Survey existing activity zones in the fort (ground truth — which fields a real zone sets):");
const survey = `
local function bitson(u) local k={} pcall(function() for n,v in pairs(u) do if v==true then k[#k+1]=tostring(n) end end end) return table.concat(k,',') end
local n = 0
for _,b in ipairs(df.global.world.buildings.all) do
  if b:getType() == df.building_type.Civzone then
    n = n + 1
    if n <= 12 then
      local box = '('..b.x1..','..b.y1..')-('..b.x2..','..b.y2..')@'..b.z
      print('PROBE zone id='..b.id..' box='..box..' type='..tostring(b.type)..' flags=['..bitson(b.flags)..'] spec_sub=['..bitson(b.spec_sub_flag)..'] zs=['..bitson(b.zone_settings)..']')
    end
  end
end
print('PROBE zone count = '..n)
`;
try { await lua(survey); console.log("  survey sent"); }
catch (e) { console.log("  survey FAILED:", e.message); }

if (place) {
  console.log(`\n[4] PLACE ${place.w}x${place.h} '${place.type}' zone @ (${place.x},${place.y},${place.z}):`);
  // Construct the civzone spanning the rect (abstract, like a stockpile), set its type + active flag,
  // read the result back. We DON'T deconstruct here yet — section [5] (JS-side) needs it on the map to
  // confirm streaming; the cleanup happens after that, keyed by the id we print on the `RESULT` line.
  // The real recipe (mirrors DFHack quickfort/zone.lua create_zone): the zone type rides in as the
  // building `subtype`; spec_sub_flag.active=true makes it live. No raw bit-poking.
  const code = `
local X,Y,Z,W,H,typ = ${place.x},${place.y},${place.z},${place.w},${place.h},'${place.type}'
local tv = df.civzone_type[typ]
if tv == nil then print('PROBE PLACE unknown civzone_type: '..typ) return end
local ok,b = pcall(dfhack.buildings.constructBuilding, {type=df.building_type.Civzone, subtype=tv, pos={x=X,y=Y,z=Z}, width=W, height=H, abstract=true})
if not ok or not b then print('PROBE PLACE constructBuilding error: '..tostring(b)) return end
local aw,ah = (b.x2-b.x1+1),(b.y2-b.y1+1)
print('PROBE PLACE constructed id='..tostring(b.id)..' box=('..b.x1..','..b.y1..')-('..b.x2..','..b.y2..') = '..aw..'x'..ah..' (asked '..W..'x'..H..')')
pcall(function() if type(b.spec_sub_flag.active)=='boolean' then b.spec_sub_flag.active = true end end)
local tn = '?'
pcall(function() tn = tostring(df.civzone_type[b.type]) end)
print('PROBE PLACE type='..tostring(b.type)..'('..tn..') active='..tostring(b.spec_sub_flag.active)..' isActivityZone='..tostring(dfhack.buildings.isActivityZone and dfhack.buildings.isActivityZone(b)))
local f = dfhack.buildings.findAtTile(X,Y,Z)
print('PROBE PLACE findAtTile registered = '..tostring(f~=nil and f.id==b.id))
print('PROBE PLACE RESULT id='..tostring(b.id)..' bt='..tostring(b:getType()))
`;
  try { await lua(code); }
  catch (e) { console.log("  place FAILED:", e.message); }

  // [5] Streaming check — read the covering blocks back via GetBlockList (df-access's read path) and
  // report whether a building with our zone's footprint shows up, and with what building_type. This is
  // the make-or-break answer: does a civzone ride the same MapBlock.buildings channel as a stockpile?
  console.log(`\n[5] STREAMING CHECK — GetBlockList over the zone's blocks:`);
  const bxMin = place.x >> 4, bxMax = ((place.x + place.w) >> 4) + 1;
  const byMin = place.y >> 4, byMax = ((place.y + place.h) >> 4) + 1;
  try {
    const bl = await client.call("GetBlockList", {
      blocks_needed: (bxMax - bxMin + 1) * (byMax - byMin + 1) + 4,
      min_x: bxMin, max_x: bxMax, min_y: byMin, max_y: byMax,
      min_z: place.z, max_z: place.z + 1, force_reload: true,
    });
    let found = 0;
    const seen = new Set();
    for (const blk of bl.map_blocks || []) {
      for (const bd of blk.buildings || []) {
        if (seen.has(bd.index)) continue;
        seen.add(bd.index);
        const t = bd.building_type || {};
        const bt = t.building_type ?? -1;
        const x0 = bd.pos_x_min, y0 = bd.pos_y_min, x1 = bd.pos_x_max, y1 = bd.pos_y_max;
        // does this footprint cover our placed corner?
        if (place.x >= x0 && place.x <= x1 && place.y >= y0 && place.y <= y1) {
          found++;
          console.log(`  STREAMED building idx=${bd.index} bt=${bt} st=${t.building_subtype ?? -1} box=(${x0},${y0})-(${x1},${y1}) active=${bd.active ? 1 : 0}`);
        }
      }
    }
    console.log(found
      ? `  => civzone STREAMS BACK on MapBlock.buildings (found ${found} at the corner). Renders for free.`
      : `  => civzone does NOT appear in MapBlock.buildings — zones need a separate feedback path.`);
  } catch (e) {
    console.log("  streaming check FAILED:", e.message);
  }

  // cleanup: deconstruct the test zone so the fort is left untouched. NB: findAtTile does NOT find
  // civzones (they're abstract overlays, not tile occupants) — iterate world.buildings for the Civzone
  // overlapping the test box instead.
  const cleanup = `
local X,Y,Z,W,H = ${place.x},${place.y},${place.z},${place.w},${place.h}
local removed = 0
for i=#df.global.world.buildings.all-1,0,-1 do
  local b = df.global.world.buildings.all[i]
  if b:getType()==df.building_type.Civzone and b.z==Z and b.x1>=X and b.x2<=X+W-1 and b.y1>=Y and b.y2<=Y+H-1 then
    local okd,ed = pcall(dfhack.buildings.deconstruct, b)
    if okd then removed = removed + 1 end
  end
end
print('PROBE CLEANUP removed = '..removed)
`;
  try { await lua(cleanup); console.log("  cleanup sent"); }
  catch (e) { console.log("  cleanup FAILED:", e.message); }
}

client.quit();
console.log("\ndone.");
