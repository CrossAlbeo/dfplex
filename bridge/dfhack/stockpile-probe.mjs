// Stockpile probe (de-risk for the Stockpiles slice). RemoteFortressReader has no stockpile RPC —
// stockpiles are created AND configured through DFHack's core Lua API. Unlike a workshop, a stockpile
// built programmatically accepts NOTHING until its df.stockpile_settings are configured, so this probe
// pins down three things against the user's live DF (DFHack remote on :5000):
//   1. the Stockpile building_type + whether constructBuilding makes a rectangular pile that streams
//      back as an RFR building (so it renders for free, like other buildings);
//   2. the df.stockpile_settings category layout (food / furniture / stone / wood / ...), so the
//      backend can map a preset `kind` to the right flags;
//   3. how an existing, in-game-configured pile actually looks (which fields flip when a category is
//      enabled) — the ground truth for writing the enable code.
//
// SAFE by default — introspection + a read-only survey of existing piles; no mutation. Flags:
//   --place X Y Z W H [preset]   create one WxH test pile at the corner, configure it, read it back
//                                (preset: all|food|stone|wood|furniture; default all)
// print() surface returns as REPLY_TEXT, shown on stderr as `[df] ...` by client.mjs; the probe's own
// findings go to stdout.
//
// Usage:
//   node bridge/dfhack/stockpile-probe.mjs
//   node bridge/dfhack/stockpile-probe.mjs --place 100 120 150 5 4 food
import { DFHackClient } from "./client.mjs";

const host = process.env.DF_HOST || "127.0.0.1";
const port = Number(process.env.DF_PORT) || 5000;

const args = process.argv.slice(2);
let place = null;
const pi = args.indexOf("--place");
if (pi >= 0) {
  const [x, y, z, w, h] = args.slice(pi + 1, pi + 6).map(Number);
  const preset = args[pi + 6] || "all";
  if (![x, y, z, w, h].every(Number.isFinite)) {
    console.error("--place needs X Y Z W H, optional preset (all|food|stone|wood|furniture)");
    process.exit(2);
  }
  place = { x, y, z, w, h, preset };
}

const client = await DFHackClient.connect({ host, port });
console.log(`connected to DFHack at ${host}:${port}`);

const info = await client.call("GetMapInfo");
const view = await client.call("GetViewInfo");
console.log(
  `map: ${info.block_size_x * 16}x${info.block_size_y * 16}x${info.block_size_z} tiles; ` +
    `view @ (${view.view_pos_x},${view.view_pos_y},${view.view_pos_z}) size ${view.view_size_x}x${view.view_size_y}`
);

// One Lua chunk via the core RunCommand("lua", [code]); print() surface returns on stderr as [df] lines.
async function lua(code) {
  await client.call("RunCommand", { command: "lua", arguments: [code] });
}

console.log("\n[1] Stockpile building type + API surface ([df] PROBE lines on stderr):");
const introspect = `
local function names(t) local k={} pcall(function() for n,_ in pairs(t) do k[#k+1]=tostring(n) end end) table.sort(k) return table.concat(k,',') end
print('PROBE Stockpile building_type = '..tostring(df.building_type.Stockpile))
print('PROBE buildings.fns: '..names(dfhack.buildings))
print('PROBE constructBuilding: '..type(dfhack.buildings and dfhack.buildings.constructBuilding))
local ok,sp = pcall(require,'plugins.stockpiles')
print('PROBE plugins.stockpiles require = '..tostring(ok)..(ok and (' fns: '..names(sp)) or ''))
`;
try {
  await lua(introspect);
  console.log("  introspection sent");
} catch (e) {
  console.log("  introspection FAILED:", e.message);
}

console.log("\n[2] df.stockpile_settings layout (instantiate a fresh settings struct, dump fields+types):");
const layout = `
local function fieldtypes(u)
  local k={} pcall(function() for n,v in pairs(u) do k[#k+1]=tostring(n)..':'..type(v) end end) table.sort(k) return table.concat(k,', ')
end
local ok,st = pcall(function() return df.stockpile_settings:new() end)
if not ok or not st then print('PROBE settings:new failed = '..tostring(st)) else
  print('PROBE settings fields: '..fieldtypes(st))
  -- peek one category struct (food) to see how a category encodes its item flags
  local okf = pcall(function()
    print('PROBE settings.flags fields: '..fieldtypes(st.flags))
    print('PROBE settings.food fields: '..fieldtypes(st.food))
    print('PROBE settings.stone type: '..type(st.stone))
  end)
  print('PROBE category peek ok = '..tostring(okf))
  st:delete()
end
`;
try {
  await lua(layout);
  console.log("  layout sent");
} catch (e) {
  console.log("  layout FAILED:", e.message);
}

console.log("\n[3] Survey existing stockpiles in the fort (ground truth for enabled categories):");
const survey = `
local CATS = {'animals','food','furniture','refuse','stone','ordnance','ammo','coins','bars_blocks','gems','finished_goods','leather','cloth','wood','weapons','armor','sheet','corpses'}
local function enabledCats(st)
  local on = {}
  for _,c in ipairs(CATS) do
    local ok,cat = pcall(function() return st[c] end)
    if ok and cat ~= nil then
      -- a category counts as "on" if any boolean field anywhere under it is true
      local any = false
      pcall(function()
        for _,v in pairs(cat) do
          if v == true then any = true break end
          if type(v) == 'userdata' then
            for _,w in pairs(v) do if w == true then any = true break end end
          end
          if any then break end
        end
      end)
      if any then on[#on+1] = c end
    end
  end
  return table.concat(on, ',')
end
local n = 0
for _,b in ipairs(df.global.world.buildings.all) do
  if b:getType() == df.building_type.Stockpile then
    n = n + 1
    if n <= 6 then
      local box = '('..b.x1..','..b.y1..')-('..b.x2..','..b.y2..')@'..b.z
      print('PROBE pile id='..b.id..' box='..box..' enabled=['..enabledCats(b.settings)..']')
    end
  end
end
print('PROBE stockpile count = '..n)
`;
try {
  await lua(survey);
  console.log("  survey sent");
} catch (e) {
  console.log("  survey FAILED:", e.message);
}

if (place) {
  console.log(`\n[4] PLACE ${place.w}x${place.h} '${place.preset}' pile @ (${place.x},${place.y},${place.z}):`);
  // Create the pile spanning the rect, then turn the whole preset category on by flipping every
  // boolean under it (the brute-force enable; the real backend will use whatever [2]/[3] reveal).
  const code = `
local X,Y,Z,W,H,preset = ${place.x},${place.y},${place.z},${place.w},${place.h},'${place.preset}'
local ok,b = pcall(dfhack.buildings.constructBuilding, {type=df.building_type.Stockpile, pos={x=X,y=Y,z=Z}, width=W, height=H, abstract=true})
if not ok then print('PROBE PLACE constructBuilding error: '..tostring(b)) return end
local aw,ah = (b.x2-b.x1+1),(b.y2-b.y1+1)
print('PROBE PLACE constructed id='..tostring(b.id)..' box=('..b.x1..','..b.y1..')-('..b.x2..','..b.y2..') = '..aw..'x'..ah..' (asked '..W..'x'..H..')')
local st = b.settings
-- enable one category = master flag bit + every sub-item boolean/vector under the category struct
local function fillCat(name)
  pcall(function() if type(st.flags[name])=='boolean' then st.flags[name]=true end end)
  local okc,cat = pcall(function() return st[name] end)
  if okc and type(cat)=='userdata' then
    pcall(function()
      for n,v in pairs(cat) do
        if type(v)=='boolean' then cat[n]=true
        elseif type(v)=='userdata' then for i,w in pairs(v) do if type(w)=='boolean' then v[i]=true end end end
      end
    end)
  end
end
local ALL = {'animals','food','furniture','refuse','stone','ammo','coins','bars_blocks','gems','finished_goods','leather','cloth','wood','weapons','armor','sheet','corpses'}
local sel = (preset=='all') and ALL or {preset}
for _,c in ipairs(sel) do fillCat(c) end
-- read the master flags back to confirm config stuck
local on = {}
for _,c in ipairs(ALL) do local okf,fv = pcall(function() return st.flags[c] end) if okf and fv==true then on[#on+1]=c end end
print('PROBE PLACE preset='..preset..' flags.on=['..table.concat(on,',')..']')
local f = dfhack.buildings.findAtTile(X,Y,Z)
print('PROBE PLACE findAtTile registered = '..tostring(f~=nil and f.id==b.id))
-- self-clean: remove the test pile so the fort is left untouched
local okd,ed = pcall(dfhack.buildings.deconstruct, b)
print('PROBE PLACE deconstruct = '..tostring(okd)..(okd and '' or (' '..tostring(ed))))
`;
  try {
    await lua(code);
    console.log("  place sent — check DF for the new stockpile; re-run with no args to see it in [3]");
  } catch (e) {
    console.log("  place FAILED:", e.message);
  }
}

client.quit();
console.log("\ndone.");
