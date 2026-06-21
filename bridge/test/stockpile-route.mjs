// Unit test: DFAccess.stockpile places ONE abstract stockpile spanning the drag rectangle and
// configures it to the preset's categories via the core Lua API (constructBuilding + settings), since
// RFR has no stockpile RPC. Asserts the server-side bounding-box math, abstract=true, the per-category
// enable (master flag + sub-items), integer coercion, and that empty/non-finite input emits no RPC.
// Stubs the DFHack client — offline (Tier 1). Usage: node bridge/test/stockpile-route.mjs
import { DFAccess } from "../dfhack/df-access.mjs";

const calls = [];
const df = new DFAccess();
df.client = { call: (m, r) => (calls.push({ m, r }), Promise.resolve({})) }; // connect() returns this

let fail = 0;
const ok = (c, m) => (c ? console.log("  ok  -", m) : (console.error("  FAIL-", m), fail++));

// A 4x3 rectangle from (5,6) to (8,8) at z=7, tiles pushed out of order — the bbox must still resolve
// to corner (5,6) and span 4x3.
const rect = [];
for (let y = 8; y >= 6; y--) for (let x = 8; x >= 5; x--) rect.push({ x, y, z: 7 });

// Food preset -> exactly one category.
calls.length = 0;
await df.stockpile("sp_food", rect);
let c = calls[0];
ok(calls.length === 1 && c.m === "RunCommand", `sp_food -> RunCommand (got ${c ? c.m : "none"})`);
ok(c && c.r.command === "lua", "sp_food -> lua command");
let code = (c && c.r.arguments && c.r.arguments[0]) || "";
ok(/building_type\.Stockpile/.test(code), "sp_food -> constructs a Stockpile");
ok(/abstract=true/.test(code), "sp_food -> abstract=true (no materials)");
ok(/local x0,y0,z,w,h=5,6,7,4,3\b/.test(code), "sp_food -> bbox corner (5,6) z=7 span 4x3");
ok(/pos=\{x=x0,y=y0,z=z\}/.test(code) && /width=w\b/.test(code) && /height=h\b/.test(code), "sp_food -> places at the computed bbox");
ok(/'food'/.test(code), "sp_food -> enables the food category");
ok(/st\.flags\[name\]=true/.test(code), "sp_food -> sets the master flag bit per category");
ok(!/'stone'/.test(code) && !/'wood'/.test(code), "sp_food -> enables no other category");
ok(!calls.some((k) => k.m === "SendDigCommand"), "sp_food -> never SendDigCommand");

// All preset -> every category appears.
calls.length = 0;
await df.stockpile("sp_all", rect);
code = calls[0].r.arguments[0];
for (const cat of ["animals", "food", "stone", "wood", "weapons", "armor", "sheet", "coins"]) {
  ok(code.includes(`'${cat}'`), `sp_all -> includes ${cat}`);
}

// Integer coercion: fractional coords are floored, never interpolated as floats.
calls.length = 0;
await df.stockpile("sp_food", [{ x: 5.9, y: 6.2, z: 7 }, { x: 8.4, y: 8.7, z: 7 }]);
code = calls[0].r.arguments[0];
ok(/local x0,y0,z,w,h=5,6,7,4,3\b/.test(code), "float coords -> floored to corner (5,6) z=7 span 4x3");
ok(!/5\.9|6\.2|8\.4|8\.7/.test(code), "no fractional coords reach the Lua");

// Unknown kind throws; empty / all-non-finite -> no RPC at all.
let threw = false;
try {
  await df.stockpile("sp_nope", rect);
} catch {
  threw = true;
}
ok(threw, "unknown kind -> throws");
calls.length = 0;
await df.stockpile("sp_food", []);
ok(calls.length === 0, "empty tiles -> no RPC");
calls.length = 0;
await df.stockpile("sp_food", [{ x: NaN, y: 1, z: 2 }, { x: 3, y: Infinity, z: 2 }]);
ok(calls.length === 0, "all-non-finite tiles -> no RPC");

console.log(fail ? `\n${fail} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
process.exit(fail ? 1 : 0);
