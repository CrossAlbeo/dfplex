// One-off probe (needs DF): reveals dfhack.buildings.getCorrectSize's return contract so the bridge
// can center a multi-tile building on the clicked tile instead of anchoring its top-left there.
// constructBuilding takes `pos` as the min corner, so to center we need DF's own default footprint
// (workshops are mostly 3x3, but Quern/Millstone are 1x1; depot 5x5; machines vary by direction).
// getCorrectSize is the source of truth — this prints what it returns for representatives.
// Lua print() arrives as REPLY_TEXT -> stderr as "[df] ...".
//   Usage: node bridge/test/build-size-probe.mjs
import { DFAccess } from "../dfhack/df-access.mjs";

const df = new DFAccess({
  host: process.env.DF_HOST || "127.0.0.1",
  port: Number(process.env.DF_PORT) || 5000,
});

await df.connect();

const code = [
  "local function sz(name, t, s, d)",
  "  local r = {dfhack.buildings.getCorrectSize(1, 1, t, s or -1, -1, d or -1)}",
  "  local out = {}",
  "  for i, v in ipairs(r) do out[i] = tostring(v) end",
  "  print('SIZE ' .. name .. ' nret=' .. #r .. ' vals=' .. table.concat(out, ','))",
  "end",
  "sz('Masons', df.building_type.Workshop, df.workshop_type.Masons, -1)",
  "sz('Quern', df.building_type.Workshop, df.workshop_type.Quern, -1)",
  "sz('Smelter', df.building_type.Furnace, df.furnace_type.Smelter, -1)",
  "sz('Depot', df.building_type.TradeDepot, -1, -1)",
  "sz('ScrewPump', df.building_type.ScrewPump, -1, 0)",
  "sz('WaterWheel', df.building_type.WaterWheel, -1, 0)",
  "sz('Bed', df.building_type.Bed, -1, -1)",
  "sz('Door', df.building_type.Door, -1, -1)",
].join(" ");

console.log("calling getCorrectSize (watch [df] lines on stderr) ...");
await df.client.call("RunCommand", { command: "lua", arguments: [code] });
// Give the REPLY_TEXT frames a moment to flush to stderr before we close.
await new Promise((r) => setTimeout(r, 250));
df.client.quit();
