// Lever/pressure-plate LINKING probe (de-risk for the Phase-4 "linking & triggers" slice).
//
// Levers and pressure plates are df.building_trapst (building_type.Trap=23), distinguished by
// `trap_type` (Lever=0, PressurePlate=1, …). A link to a target gate-building (Door, Floodgate, Bridge,
// Hatch, GrateWall/Floor, retracting spikes…) is created the way the native "link to lever" menu does:
// a LinkBuildingToTrigger job (job_type=146) attached to the lever, carrying a BUILDING_TRIGGERTARGET
// genref → target and a BUILDING_HOLDER genref → lever. Crucially the two mechanisms are NOT job_item
// requirement filters (that path gets cancelled with "No mechanism for target"): DF pre-attaches TWO
// specific TRAPPARTS items as job.items entries — a job_item_ref{item, role} with role LinkToTrigger
// (the mechanism installed in the lever) and role LinkToTarget (installed in the target) — sets each
// item's flags.in_job, and leaves job.pos at the (-30000) sentinel. A dwarf then hauls those 2
// mechanisms and completes the link, populating lever.linked_mechanisms. We ship the JOB path
// (faithful to DF, multiplayer-safe), NOT a raw hot-wire of the link fields. This structure was
// captured from a real DF UI-created pending link job (id 249) and is replicated below verbatim.
//
// Modes:
//   (default)                      READ-ONLY survey + struct introspection — nothing in the fort changes.
//   --inspect X Y Z                READ-ONLY: dump the trap at a tile (its jobs + linked_mechanisms/targets).
//   --link  LX LY LZ  TX TY TZ     MUTATES: queue a LinkBuildingToTrigger task on the lever at L pointing
//                                  at the target at T. Needs a BUILT lever + BUILT target + >=2 mechanisms
//                                  in stock; a dwarf completes it over real time (re-run --inspect to see
//                                  it land). Creates a normal DF task you can cancel in-game.
//
// Usage:
//   node bridge/dfhack/lever-link-probe.mjs
//   node bridge/dfhack/lever-link-probe.mjs --inspect 120 118 158
//   node bridge/dfhack/lever-link-probe.mjs --link 120 118 158 124 118 158
import { DFHackClient } from "./client.mjs";

const host = process.env.DF_HOST || "127.0.0.1";
const port = Number(process.env.DF_PORT) || 5000;

const args = process.argv.slice(2);
const triplet = (flag) => {
  const i = args.indexOf(flag);
  if (i < 0) return null;
  const nums = args.slice(i + 1).filter((a) => !a.startsWith("--")).map(Number);
  return nums;
};
let inspect = null, link = null;
const ins = triplet("--inspect");
if (ins) {
  const [x, y, z] = ins;
  if (![x, y, z].every(Number.isFinite)) { console.error("--inspect needs X Y Z"); process.exit(2); }
  inspect = { x, y, z };
}
const lk = triplet("--link");
if (lk) {
  const [lx, ly, lz, tx, ty, tz] = lk;
  if (![lx, ly, lz, tx, ty, tz].every(Number.isFinite)) { console.error("--link needs LX LY LZ TX TY TZ"); process.exit(2); }
  link = { lx, ly, lz, tx, ty, tz };
}

const client = await DFHackClient.connect({ host, port });
console.log(`connected to DFHack at ${host}:${port}`);
const info = await client.call("GetMapInfo");
console.log(`map: ${info.block_size_x * 16}x${info.block_size_y * 16}x${info.block_size_z} tiles`);

async function lua(code) {
  // Use the lower-level _invoke with our own text sink so we keep DFHack's REPLY_TEXT (including a
  // Lua compile/runtime error message) even when the command returns REPLY_FAIL (callText drops it).
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
    else console.log("  [df] " + s); // DFHack often prints a Lua error as REPLY_TEXT but still returns CR_OK
  }
  if (failed) console.log("  (RunCommand failed: " + failed.message + ")");
}

console.log("\n[1] Enums + helpers the linking code depends on:");
await lua(`
print('PROBE building_type.Trap='..tostring(df.building_type.Trap)..' Door='..tostring(df.building_type.Door)..' Floodgate='..tostring(df.building_type.Floodgate))
print('PROBE trap_type: Lever='..tostring(df.trap_type.Lever)..' PressurePlate='..tostring(df.trap_type.PressurePlate))
print('PROBE genref: BUILDING_HOLDER='..tostring(df.general_ref_type.BUILDING_HOLDER)..' BUILDING_TRIGGERTARGET='..tostring(df.general_ref_type.BUILDING_TRIGGERTARGET))
print('PROBE job_type.LinkBuildingToTrigger='..tostring(df.job_type.LinkBuildingToTrigger)..' item_type.TRAPPARTS='..tostring(df.item_type.TRAPPARTS))
`);

// Shared Lua: resolve a trap (lever/plate) and describe its links + any pending link job in detail.
const inspectLua = (x, y, z) => `
local b = dfhack.buildings.findAtTile(${x},${y},${z})
if not b then print('PROBE inspect: NO building at (${x},${y},${z})') return end
local t = b:getType()
print('PROBE inspect id='..b.id..' type='..((df.building_type[t]) or t)..((t==df.building_type.Trap) and (' trap_type='..((df.trap_type[b.trap_type]) or b.trap_type)) or ''))
-- pending jobs on the building, with the detail that explains why a dwarf would/wouldn't take it
if b.jobs then for _,j in ipairs(b.jobs) do
  print('PROBE   job '..((df.job_type[j.job_type]) or j.job_type)..' id='..tostring(j.id)
    ..' worker='..tostring(j.general_refs and (function() for _,r in ipairs(j.general_refs) do if df.general_ref_unit_workerst:is_instance(r) then return r.unit_id end end return 'none' end)())
    ..' susp='..tostring(j.flags.suspend)
    ..' posting='..tostring(j.posting_index))
  -- job_items: what the job is asking for
  local nji = 0; pcall(function() nji = #j.job_items.elements end)
  print('PROBE     job_items='..nji)
  for k=0,nji-1 do local ji=j.job_items.elements[k]
    print('PROBE       want item_type='..((df.item_type[ji.item_type]) or ji.item_type)..' qty='..ji.quantity..' filled='..tostring(ji.flags1 and 'n/a' or 'n/a'))
  end
  -- items already attached to the job (the two mechanisms, with their link roles)
  local nit = 0; pcall(function() nit = #j.items end)
  print('PROBE     items_attached='..nit)
  for k=0,nit-1 do local ref=j.items[k]
    print('PROBE       attached id='..tostring(ref.item and ref.item.id)..' role='..tostring(df.job_role_type[ref.role] or ref.role)
      ..' type='..tostring(ref.item and (df.item_type[ref.item:getType()]) or '?'))
  end
  -- is this job still registered in the global job list? (linked list — walk .next)
  local inworld=false; local link=df.global.world.jobs.list.next while link do if link.item and link.item.id==j.id then inworld=true break end link=link.next end
  print('PROBE     in_world_job_list='..tostring(inworld))
end end
-- completed links
if t==df.building_type.Trap and b.linked_mechanisms then
  print('PROBE   linked_mechanisms='..#b.linked_mechanisms)
  for _,m in ipairs(b.linked_mechanisms) do
    local tref = dfhack.items.getGeneralRef(m, df.general_ref_type.BUILDING_HOLDER)
    local tg = tref and tref:getBuilding() or nil
    print('PROBE   -> '..(tg and (tg.id..'/'..((df.building_type[tg:getType()]) or tg:getType())) or 'unresolved'))
  end
end
`;

if (inspect) {
  console.log(`\n[inspect] trap/target at (${inspect.x},${inspect.y},${inspect.z}):`);
  await lua(inspectLua(inspect.x, inspect.y, inspect.z));
} else if (link) {
  const { lx, ly, lz, tx, ty, tz } = link;
  console.log(`\n[link] queue LinkBuildingToTrigger: lever (${lx},${ly},${lz}) -> target (${tx},${ty},${tz}):`);
  await lua(`
-- Whole body wrapped in pcall so ANY error (findAtTile, guards, job build) surfaces as a printed
-- message — RunCommand("lua") otherwise only returns FAIL with no detail.
local ok, err = pcall(function()
  local L = dfhack.buildings.findAtTile(${lx},${ly},${lz})
  local T = dfhack.buildings.findAtTile(${tx},${ty},${tz})
  if not L then print('PROBE link ERR: no building at lever tile') return end
  if not T then print('PROBE link ERR: no building at target tile') return end
  if not (L:getType()==df.building_type.Trap and (L.trap_type==df.trap_type.Lever or L.trap_type==df.trap_type.PressurePlate)) then
    print('PROBE link ERR: source is not a lever/pressure plate (type='..((df.building_type[L:getType()]) or L:getType())..')') return end
  if L.id==T.id then print('PROBE link ERR: lever and target are the same building') return end
  -- cleanup: cancel any stale LinkBuildingToTrigger jobs already on this lever (idempotent re-runs)
  local stale = {}
  for _,j in ipairs(L.jobs) do if j.job_type==df.job_type.LinkBuildingToTrigger then stale[#stale+1]=j end end
  for _,j in ipairs(stale) do pcall(dfhack.job.removeJob, j) end
  if #stale>0 then print('PROBE cleaned '..#stale..' stale link job(s)') end
  -- build the job exactly as DF's "link to lever" UI does (captured from real pending job id 249):
  --   * job.pos left at the (-30000) sentinel, NOT the lever center
  --   * general_refs: TRIGGERTARGET -> target, then HOLDER -> lever (DF's order)
  --   * NO job_item requirement filters; instead two specific TRAPPARTS attached as job.items entries
  --     with roles LinkToTrigger (-> lever) and LinkToTarget (-> target), each item flagged in_job
  local job = df.job:new()
  job.job_type = df.job_type.LinkBuildingToTrigger
  job.pos.x, job.pos.y, job.pos.z = -30000, -30000, -30000
  local tt = df.general_ref_building_triggertargetst:new(); tt.building_id = T.id; job.general_refs:insert('#', tt)
  local h  = df.general_ref_building_holderst:new();         h.building_id  = L.id; job.general_refs:insert('#', h)
  -- find two FREE mechanisms (TRAPPARTS not reserved/forbidden/installed/owned/etc.)
  local mechs = {}
  for _,it in ipairs(df.global.world.items.other.TRAPPARTS or {}) do
    local f = it.flags
    if not (f.in_job or f.forbid or f.in_building or f.removed or f.garbage_collect or f.owned
            or f.construction or f.dump or f.on_fire or f.trader or f.hostile) then
      mechs[#mechs+1] = it
      if #mechs >= 2 then break end
    end
  end
  if #mechs < 2 then print('PROBE link ERR: need 2 free mechanisms, found '..#mechs..' (build more / un-forbid)'); pcall(df.delete, job); return end
  -- attach the two mechanisms with their link roles via DFHack's own API (handles a mechanism stored
  -- in a bin/stockpile, sets item.flags.in_job, and builds the job_item_ref) — same resulting
  -- structure DF's UI job carries.
  local a1 = dfhack.job.attachJobItem(job, mechs[1], df.job_role_type.LinkToTrigger, -1, -1)
  local a2 = dfhack.job.attachJobItem(job, mechs[2], df.job_role_type.LinkToTarget,  -1, -1)
  if not (a1 and a2) then
    print('PROBE link ERR: attachJobItem failed ('..tostring(a1)..','..tostring(a2)..')')
    mechs[1].flags.in_job=false; mechs[2].flags.in_job=false; pcall(df.delete, job); return
  end
  L.jobs:insert('#', job)
  dfhack.job.linkIntoWorld(job, true)
  -- POST it: linkIntoWorld leaves posting_index=-1, so the labor system never offers the job to a
  -- dwarf. Reuse a dead posting slot if one exists, else append, and back-link job.posting_index.
  local P = df.global.world.jobs.postings
  local idx = -1
  for i=0,#P-1 do if P[i].job==nil or P[i].flags.dead then idx=i break end end
  if idx>=0 then P[idx].job=job; P[idx].flags.dead=false else P:insert('#', {new=true, job=job}); idx=#P-1 end
  job.posting_index = idx
  print('PROBE link queued: lever id='..L.id..' target id='..T.id..' job id='..tostring(job.id)
    ..' mechs='..mechs[1].id..','..mechs[2].id..' attached='..#job.items..' posting_index='..tostring(job.posting_index)..' lever.jobs='..#L.jobs)
  print('PROBE (now unpause; a mechanic hauls 2 mechanisms; re-run --inspect ${lx} ${ly} ${lz} to confirm linked_mechanisms)')
end)
if not ok then print('PROBE link ERROR: '..tostring(err)) end
`);
} else {
  console.log("\n[2] Existing levers / pressure plates and their links:");
  await lua(`
local nt = 0
for _,b in ipairs(df.global.world.buildings.all) do
  if b:getType()==df.building_type.Trap then
    nt = nt + 1
    local nm='?'; pcall(function() nm = dfhack.buildings.getName(b) end)
    local lm = b.linked_mechanisms
    print('PROBE trap id='..b.id..' '..((df.trap_type[b.trap_type]) or b.trap_type)..' pos=('..b.x1..','..b.y1..','..b.z..') name="'..nm..'" linked='..(lm and #lm or 'nil'))
    if nt >= 8 then break end
  end
end
print('PROBE traps_surveyed = '..nt)
`);

  console.log("\n[3] Candidate targets (doors/floodgates) + TRAPPARTS supply:");
  await lua(`
local nd = 0
for _,b in ipairs(df.global.world.buildings.all) do
  local t = b:getType()
  if t==df.building_type.Door or t==df.building_type.Floodgate then
    nd = nd + 1
    print('PROBE target id='..b.id..' '..((df.building_type[t]) or t)..' pos=('..b.x1..','..b.y1..','..b.z..')')
    if nd >= 6 then break end
  end
end
print('PROBE targets_surveyed = '..nd)
local mech = 0
for _,it in ipairs(df.global.world.items.other.TRAPPARTS or {}) do mech = mech + 1 end
print('PROBE TRAPPARTS total = '..mech)
`);

  console.log("\n[4] LinkBuildingToTrigger struct check (allocates throwaway structs, frees them — no world change):");
  await lua(`
local okj, j = pcall(function() return df.job:new() end)
print('PROBE df.job:new ok='..tostring(okj))
if okj and j then
  j.job_type = df.job_type.LinkBuildingToTrigger
  local has_elements = false
  pcall(function() local _ = #j.job_items.elements; has_elements = true end)
  print('PROBE job.job_items.elements present='..tostring(has_elements)..' (insert mechanism job_items there)')
  pcall(df.delete, j)
end
print('PROBE holderst:new='..tostring(pcall(function() local r=df.general_ref_building_holderst:new(); df.delete(r) end))..' triggertargetst:new='..tostring(pcall(function() local r=df.general_ref_building_triggertargetst:new(); df.delete(r) end)))
local oki, ji = pcall(function() return df.job_item:new() end)
print('PROBE job_item:new='..tostring(oki))
if oki and ji then pcall(df.delete, ji) end
`);
}

client.quit();
console.log("\ndone.");
