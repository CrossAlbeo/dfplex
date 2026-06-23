// Cage / chain OCCUPANT-ASSIGNMENT probe (de-risk for the Phase-4 "cage/chain occupant assignment"
// slice). A built **cage** is df.building_cagest (building_type.Cage); a built **chain/restraint** is
// df.building_chainst (building_type.Chain). In the DF UI you open the building and assign a creature
// (or item) to it; a dwarf then hauls the creature there and cages/chains it. We need to learn the
// FAITHFUL assignment recipe — which field(s) DF writes, and whether assignment also spawns a job —
// so the backend can replicate it (the way we captured the lever-link job), NOT raw-hot-wire a guess.
//
// Modes:
//   (default)            READ-ONLY survey: enums, built cages/chains, and assignable creatures.
//   --inspect X Y Z      READ-ONLY: dump the cage/chain at a tile — its assignment fields + any jobs.
//                        Use this AFTER assigning a creature in the DF UI to capture the ground truth.
//   --assign  BX BY BZ  UNIT_ID
//                        MUTATES: assign unit UNIT_ID to the cage/chain at (BX,BY,BZ). Recipe is filled
//                        in once --inspect on a real UI-created assignment confirms the fields.
//
// Usage:
//   node bridge/dfhack/cage-chain-probe.mjs
//   node bridge/dfhack/cage-chain-probe.mjs --inspect 120 118 158
//   node bridge/dfhack/cage-chain-probe.mjs --assign 120 118 158 1234
import { DFHackClient } from "./client.mjs";

const host = process.env.DF_HOST || "127.0.0.1";
const port = Number(process.env.DF_PORT) || 5000;

const args = process.argv.slice(2);
const nums = (flag) => {
  const i = args.indexOf(flag);
  if (i < 0) return null;
  return args.slice(i + 1).filter((a) => !a.startsWith("--")).map(Number);
};
let inspect = null, assign = null;
const ins = nums("--inspect");
if (ins) {
  const [x, y, z] = ins;
  if (![x, y, z].every(Number.isFinite)) { console.error("--inspect needs X Y Z"); process.exit(2); }
  inspect = { x, y, z };
}
const asg = nums("--assign");
if (asg) {
  const [bx, by, bz, uid] = asg;
  if (![bx, by, bz, uid].every(Number.isFinite)) { console.error("--assign needs BX BY BZ UNIT_ID"); process.exit(2); }
  assign = { bx, by, bz, uid };
}

const client = await DFHackClient.connect({ host, port });
console.log(`connected to DFHack at ${host}:${port}`);
const info = await client.call("GetMapInfo");
console.log(`map: ${info.block_size_x * 16}x${info.block_size_y * 16}x${info.block_size_z} tiles`);

async function lua(code) {
  // Lower-level _invoke with our own text sink so we keep DFHack's REPLY_TEXT (incl. a Lua error
  // message) even on REPLY_FAIL (callText drops it) — same idiom as lever-link-probe.
  const text = [];
  let failed = null;
  try {
    await client._invoke("RunCommand", { command: "lua", arguments: [code] }, text);
  } catch (e) {
    failed = e;
  }
  for (const line of text) {
    const s = line.replace(/\s+$/, "");
    if (!s) continue;
    if (/^PROBE/.test(s)) console.log("  " + s);
    else console.log("  [df] " + s);
  }
  if (failed) console.log("  (RunCommand failed: " + failed.message + ")");
}

console.log("\n[1] Enums the assignment code depends on:");
await lua(`
print('PROBE building_type.Cage='..tostring(df.building_type.Cage)..' Chain='..tostring(df.building_type.Chain))
-- job_type names touching cages/chains/pits/pens/animals (so we know what a dwarf-haul job would be)
for i=df.job_type._first_item, df.job_type._last_item do
  local n = df.job_type[i]
  if n and (n:find('Chain') or n:find('Cage') or n:find('Pit') or n:find('Pen') or n:find('Animal')) then
    print('PROBE job_type '..i..'='..n)
  end
end
`);

// Shared Lua: dump a cage/chain building's assignment fields + jobs, fully field-name-introspected.
const inspectLua = (x, y, z) => `
local b = dfhack.buildings.findAtTile(${x},${y},${z})
if not b then print('PROBE inspect: NO building at (${x},${y},${z})') return end
local t = b:getType()
print('PROBE inspect id='..b.id..' type='..((df.building_type[t]) or t)..' pos=('..b.x1..','..b.y1..','..b.z..')')
-- enumerate the building's own fields so we see the EXACT assignment field names for this DF build
local fields = {}
for k,v in pairs(b) do fields[#fields+1]=k end
table.sort(fields)
print('PROBE   fields: '..table.concat(fields, ', '))
-- candidate assignment fields, dumped if present. Reading a field absent from THIS struct throws
-- (cage has no scalar assigned_unit; chain has no assigned_units vector), so guard every access.
local assignedIds = {}
local function dumpvec(name)
  local ok, v = pcall(function() return b[name] end)
  if not ok or v == nil then return end
  local okn, n = pcall(function() return #v end)
  local isUnitField = (name=='assigned_units') -- only this vector holds unit ids
  if okn then
    local ids = {}
    for i=0,math.min(n,8)-1 do ids[#ids+1]=tostring(v[i]); if isUnitField then assignedIds[#assignedIds+1]=v[i] end end
    print('PROBE   '..name..' (#'..n..'): '..table.concat(ids, ','))
  else
    print('PROBE   '..name..' = '..tostring(v))
    if name=='assigned_unit' and tonumber(v) and v>=0 then assignedIds[#assignedIds+1]=v end
  end
end
for _,nm in ipairs({'assigned_units','assigned_items','assigned_unit','assigned_item','assigned_creature','contained_items','cage_flags'}) do dumpvec(nm) end
-- jobs sitting on the building (a UI assignment may spawn a haul job here)
local njobs=0; pcall(function() njobs=#b.jobs end)
print('PROBE   building.jobs = '..njobs)
for k=0,njobs-1 do local j=b.jobs[k]
  print('PROBE   job '..((df.job_type[j.job_type]) or j.job_type)..' id='..tostring(j.id)..' posting='..tostring(j.posting_index)..' susp='..tostring(j.flags.suspend))
  local nref=0; pcall(function() nref=#j.general_refs end)
  for r=0,nref-1 do local ref=j.general_refs[r]
    print('PROBE     genref '..tostring(getmetatable(ref) and getmetatable(ref).__name or '?')..' unit='..tostring(ref.unit_id)..' bld='..tostring(ref.building_id))
  end
end
-- the assigned creature's side: its refs (does DF point the unit back at the cage?) + any job in the
-- GLOBAL job list (linked list) that targets it — the haul job may live there, not on the building.
for _,uid in ipairs(assignedIds) do
  local u = df.unit.find(uid)
  if u then
    local nm='?'; pcall(function() nm=dfhack.units.getReadableName(u) end)
    print('PROBE   assigned unit '..uid..' "'..nm..'" caged='..tostring(u.flags1 and u.flags1.caged)..' refs:')
    local nr=0; pcall(function() nr=#u.general_refs end)
    for r=0,nr-1 do local ref=u.general_refs[r]
      local bld='-'; pcall(function() bld=tostring(ref.building_id) end)
      local item='-'; pcall(function() item=tostring(ref.item_id) end)
      print('PROBE     uref '..tostring(getmetatable(ref) and getmetatable(ref).__name or '?')..' bld='..bld..' item='..item)
    end
  end
end
local link=df.global.world.jobs.list.next
while link do local j=link.item
  if j then
    local hit=false
    local nref=0; pcall(function() nref=#j.general_refs end)
    for r=0,nref-1 do local ref=j.general_refs[r]
      pcall(function() if ref.building_id==b.id then hit=true end end)
      pcall(function() for _,uid in ipairs(assignedIds) do if ref.unit_id==uid then hit=true end end end)
    end
    if hit then print('PROBE   GLOBAL job '..((df.job_type[j.job_type]) or j.job_type)..' id='..tostring(j.id)..' pos=('..j.pos.x..','..j.pos.y..','..j.pos.z..') posting='..tostring(j.posting_index)) end
  end
  link=link.next
end
`;

if (inspect) {
  console.log(`\n[inspect] cage/chain at (${inspect.x},${inspect.y},${inspect.z}):`);
  await lua(inspectLua(inspect.x, inspect.y, inspect.z));
} else if (assign) {
  // Recipe captured from the UI reference (cage id=49): assignment = the unit id in the building's
  // assignment field — cage's assigned_units vector (multi-occupant) / chain's assigned_unit scalar
  // (single). DF's building-process logic is expected to spawn the CageLargeCreature/CageSmallCreature
  // (or ChainAnimal) haul job on its own for a free creature. This mode tests exactly that hypothesis.
  const { bx, by, bz, uid } = assign;
  console.log(`\n[assign] cage/chain (${bx},${by},${bz}) <- unit ${uid} (unpause after to watch for a haul job):`);
  await lua(`
local ok,err = pcall(function()
  local uid = ${uid}
  local b = dfhack.buildings.findAtTile(${bx},${by},${bz})
  if not b then print('PROBE assign ERR: no building at tile') return end
  local t = b:getType()
  if not (t==df.building_type.Cage or t==df.building_type.Chain) then print('PROBE assign ERR: not a cage/chain (type='..((df.building_type[t]) or t)..')') return end
  local u = df.unit.find(uid)
  if not u then print('PROBE assign ERR: no unit '..uid) return end
  if t==df.building_type.Cage then
    -- cage: multi-occupant; assigned_units is a vector of unit IDS. DF's building pass then spawns the
    -- CageLargeCreature/CageSmallCreature haul job on unpause (proven end-to-end with unit 16672).
    for i=0,#b.assigned_units-1 do if b.assigned_units[i]==uid then print('PROBE assign: unit already assigned') return end end
    b.assigned_units:insert('#', uid)
    print('PROBE assign ok: cage '..b.id..' assigned_units now #'..#b.assigned_units)
  else
    -- chain (restraint): single-occupant; the assigned field is a unit POINTER (not an id, not a
    -- scalar assigned_unit). DF sets the companion chained field once the dwarf restrains the creature.
    b.assigned = u
    print('PROBE assign ok: chain '..b.id..' assigned='..tostring(b.assigned and b.assigned.id))
  end
end)
if not ok then print('PROBE assign ERROR: '..tostring(err)) end
`);
  console.log("  (now unpause; re-run --inspect to see building.jobs / the unit's refs / the GLOBAL job)");
} else {
  console.log("\n[2] Built cages + chains:");
  await lua(`
local nc = 0
for _,b in ipairs(df.global.world.buildings.all) do
  local t = b:getType()
  if t==df.building_type.Cage or t==df.building_type.Chain then
    nc = nc + 1
    local nm='?'; pcall(function() nm = dfhack.buildings.getName(b) end)
    local au = b.assigned_units and #b.assigned_units or nil
    local one = nil; pcall(function() one = b.assigned_unit end)
    print('PROBE '..((df.building_type[t]) or t)..' id='..b.id..' pos=('..b.x1..','..b.y1..','..b.z..') name="'..nm..'" assigned_units='..tostring(au)..' assigned_unit='..tostring(one))
    if nc >= 10 then break end
  end
end
print('PROBE cages_chains_surveyed = '..nc)
`);

  console.log("\n[3] Assignable creatures (fort's own tame animals + any caged units):");
  await lua(`
local na = 0
for _,u in ipairs(df.global.world.units.active) do
  local own = false; pcall(function() own = dfhack.units.isOwnCiv(u) end)
  local tame = false; pcall(function() tame = dfhack.units.isTame(u) end)
  local animal = false; pcall(function() animal = dfhack.units.isAnimal(u) end)
  local caged = u.flags1 and u.flags1.caged
  if (own and (tame or animal)) or caged then
    na = na + 1
    local nm='?'; pcall(function() nm = dfhack.units.getReadableName(u) end)
    print('PROBE unit id='..u.id..' "'..nm..'" pos=('..u.pos.x..','..u.pos.y..','..u.pos.z..') tame='..tostring(tame)..' caged='..tostring(caged))
    if na >= 12 then break end
  end
end
print('PROBE assignable_surveyed = '..na)
`);
}

client.quit();
console.log("\ndone.");
