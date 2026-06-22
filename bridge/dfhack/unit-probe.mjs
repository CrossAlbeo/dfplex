// Unit probe (de-risk for the Unit-info panel slice). The panel reads ONE unit's detail on demand
// when a player clicks a dwarf. RemoteFortressReader's GetUnitList already returns name / profession_id
// / noble_positions / is_soldier / age / race / flags per unit, but the genuinely useful, human-readable
// fields (profession name, race name, happiness, current job, wounds) come from DFHack's core Lua via
// df.unit.find(id). This probe pins down, against the user's live DF (DFHack remote on :5000):
//   1. that GetUnitList ids resolve in df.unit.find(id) (so a clicked unit's id is a valid Lua handle);
//   2. which dfhack.units.* helpers actually exist in this build and what they print, so the backend
//      knows exactly which calls are safe to rely on (each is pcall-guarded so one missing API can't
//      blank the whole read);
//   3. the shape of the printed detail blob, so the backend parse + the route test can mirror it.
//
// SAFE — read-only introspection; never mutates a unit. The id reaching the Lua is an integer taken
// from GetUnitList (the real backend coerces it with `id | 0`); no client free text is involved.
// print() surface is captured here via callText and echoed to stdout.
//
// Usage:
//   node bridge/dfhack/unit-probe.mjs            # survey + detail-read the first on-map unit
//   node bridge/dfhack/unit-probe.mjs --id 1234  # detail-read a specific unit id
import { DFHackClient } from "./client.mjs";

const host = process.env.DF_HOST || "127.0.0.1";
const port = Number(process.env.DF_PORT) || 5000;

const args = process.argv.slice(2);
const idArg = args.indexOf("--id");
const wantId = idArg >= 0 ? Number(args[idArg + 1]) : null;

const client = await DFHackClient.connect({ host, port });
console.log(`connected to DFHack at ${host}:${port}`);

const info = await client.call("GetMapInfo");
const W = info.block_size_x * 16;
const H = info.block_size_y * 16;
console.log(`map: ${W}x${H}x${info.block_size_z} tiles\n`);

// [1] Survey GetUnitList — what RFR hands us per unit, with no extra RPC.
const ul = await client.call("GetUnitList");
const all = ul.creature_list || [];
const onMap = all.filter(
  (u) => u.pos_x != null && u.pos_x >= 0 && u.pos_y >= 0 && u.pos_z >= 0 && u.pos_x < W && u.pos_y < H,
);
console.log(`GetUnitList: ${all.length} total, ${onMap.length} on-map`);
for (const u of onMap.slice(0, 10)) {
  const desc = (u.appearance && u.appearance.physical_description) || "";
  console.log(
    `  id=${u.id} @(${u.pos_x},${u.pos_y},${u.pos_z}) ` +
      `name="${u.name || ""}" prof_id=${u.profession_id} soldier=${u.is_soldier ? 1 : 0} ` +
      `nobles=[${(u.noble_positions || []).join(",")}] age=${u.age} ` +
      `blood=${u.blood_count}/${u.blood_max} race=${u.race ? u.race.mat_type + ":" + u.race.mat_index : "?"}` +
      (desc ? `\n      desc: ${desc.slice(0, 90)}${desc.length > 90 ? "…" : ""}` : ""),
  );
}

// [2] Detail-read one unit via core Lua. Each lookup is pcall-guarded so a helper that doesn't exist
// in this DFHack build prints empty rather than aborting the chunk. Same chunk shape the backend will
// generate (id coerced to an integer literal).
const target = wantId != null ? wantId : onMap.length ? onMap[0].id : null;
if (target == null) {
  console.log("\nno on-map unit to detail-read");
  client.disconnect?.();
  process.exit(0);
}
const id = target | 0;
const lua =
  `local u=df.unit.find(${id}) ` +
  `if not u then print('dfplex unit none') return end ` +
  `local function s(f) local ok,v=pcall(f) if ok and v~=nil then return tostring(v) end return '' end ` +
  `print('dfplex unit id=${id}') ` +
  `print('name='..s(function() return dfhack.units.getReadableName(u) end)) ` +
  `print('prof='..s(function() return dfhack.units.getProfessionName(u) end)) ` +
  `print('race='..s(function() return dfhack.units.getRaceName(u) end)) ` +
  `print('age='..s(function() return dfhack.units.getAge(u,true) end)) ` +
  `print('citizen='..s(function() return dfhack.units.isCitizen(u) end)) ` +
  `print('dead='..s(function() return dfhack.units.isDead(u) end)) ` +
  `print('soldier='..s(function() return u.military and u.military.squad_id>=0 end)) ` +
  `print('stress='..s(function() return u.status.current_soul.personality.stress end)) ` +
  `print('stresscat='..s(function() return dfhack.units.getStressCategory and dfhack.units.getStressCategory(u) end)) ` +
  `print('job='..s(function() local j=u.job.current_job if j then return df.job_type[j.job_type] end return 'Idle' end)) ` +
  `print('wounds='..s(function() return #u.body.wounds end))`;

console.log(`\n[detail-read id=${id}] running Lua via callText…`);
const { text } = await client.callText("RunCommand", { command: "lua", arguments: [lua] });
console.log("captured print() blob:");
for (const line of text.join("").split("\n")) if (line.trim()) console.log("  " + line);

client.disconnect?.();
process.exit(0);
