// Unit test: the per-pile category editor backend — DFAccess.stockpileGet / stockpileSet. The editor
// has no building id (the streamed record carries none), so both resolve the pile from a clicked tile
// via dfhack.buildings.findAtTile. stockpileGet rides the Lua print() surface back through callText
// (RunCommand's output is EmptyMessage); stockpileSet writes the master flag + sub-items for enables
// and clears the flag for disables. Asserts the RPC + args, the text parse, integer coercion, the
// category-key allowlist, and that no-ops emit no RPC. Stubs the DFHack client — offline (Tier 1).
// Usage: node bridge/test/stockpile-editor-route.mjs
import { DFAccess } from "../dfhack/df-access.mjs";
import { CATEGORY_KEYS } from "../../client/js/stockpiles.js";

const calls = [];
let textReply = []; // what the stubbed callText returns as captured print() text
const df = new DFAccess();
df.client = {
  call: (m, r) => (calls.push({ via: "call", m, r }), Promise.resolve({})),
  callText: (m, r) => (calls.push({ via: "callText", m, r }), Promise.resolve({ reply: {}, text: textReply })),
};

let fail = 0;
const ok = (c, m) => (c ? console.log("  ok  -", m) : (console.error("  FAIL-", m), fail++));
const codeOf = (call) => (call && call.r && call.r.arguments && call.r.arguments[0]) || "";

// --- stockpileGet: a pile is present -------------------------------------------------------------
// print line is `box=x1,y1,x2,y2,z <cat=bit …>` — corner (5,6), far corner (8,9), z=7.
calls.length = 0;
textReply = ["dfplex spget box=5,6,8,9,7 food=1 stone=0 wood=1\n"];
let got = await df.stockpileGet({ x: 5, y: 6, z: 7 });
let c = calls[0];
ok(calls.length === 1 && c.via === "callText", "get -> exactly one callText (captures print)");
ok(c && c.m === "RunCommand" && c.r.command === "lua", "get -> RunCommand lua");
let code = codeOf(c);
ok(/findAtTile\(x,y,z\)/.test(code), "get -> resolves the pile via findAtTile");
ok(/local x,y,z=5,6,7\b/.test(code), "get -> integer tile (5,6,7) bound as locals");
ok(/getType\(\)~=df\.building_type\.Stockpile/.test(code), "get -> verifies the building is a Stockpile");
ok(/st\.flags\[c\]/.test(code), "get -> reads master flags");
ok(CATEGORY_KEYS.every((k) => code.includes(`'${k}'`)), "get -> queries all 17 categories");
ok(got.box && got.box.x0 === 5 && got.box.y0 === 6 && got.box.x1 === 8 && got.box.y1 === 9 && got.box.z === 7, "get -> parses the box");
ok(got.cats.food === true && got.cats.stone === false && got.cats.wood === true, "get -> parses each cat bit");
ok(!("ammo" in got.cats), "get -> only categories the print reported appear");

// --- stockpileGet: no pile under the tile --------------------------------------------------------
calls.length = 0;
textReply = ["dfplex spget none\n"];
got = await df.stockpileGet({ x: 5, y: 6, z: 7 });
ok(calls.length === 1 && got.box === null, "get (no pile) -> { box:null }");

// --- stockpileGet: integer coercion --------------------------------------------------------------
calls.length = 0;
textReply = ["dfplex spget none\n"];
await df.stockpileGet({ x: 5.9, y: 6.2, z: 7.8 });
code = codeOf(calls[0]);
ok(/local x,y,z=5,6,7\b/.test(code), "get -> fractional tile floored to (5,6,7)");
ok(!/5\.9|6\.2|7\.8/.test(code), "get -> no fractional coords reach the Lua");

// --- stockpileGet: non-finite / missing tile -> no RPC -------------------------------------------
calls.length = 0;
got = await df.stockpileGet({ x: NaN, y: 1, z: 2 });
ok(calls.length === 0 && got.box === null, "get (non-finite tile) -> no RPC, { box:null }");
calls.length = 0;
got = await df.stockpileGet(null);
ok(calls.length === 0 && got.box === null, "get (no tile) -> no RPC, { box:null }");

// --- stockpileSet: enable + disable in one call --------------------------------------------------
calls.length = 0;
await df.stockpileSet({ x: 5, y: 6, z: 7 }, { food: true, stone: false, wood: true });
c = calls[0];
ok(calls.length === 1 && c.via === "call", "set -> exactly one call (no reply text needed)");
ok(c && c.m === "RunCommand" && c.r.command === "lua", "set -> RunCommand lua");
code = codeOf(c);
ok(/findAtTile\(x,y,z\)/.test(code), "set -> resolves the pile via findAtTile");
ok(/local x,y,z=5,6,7\b/.test(code), "set -> integer tile (5,6,7)");
ok(/getType\(\)~=df\.building_type\.Stockpile/.test(code), "set -> verifies the building is a Stockpile");
ok(/local on=\{'food','wood'\}/.test(code), "set -> enables map to the on list");
ok(/local off=\{'stone'\}/.test(code), "set -> disables map to the off list");
ok(/for _,c in ipairs\(on\) do fill\(c\)/.test(code), "set -> fills (master flag + sub-items) each enabled category");
ok(/for _,c in ipairs\(off\) do if type\(st\.flags\[c\]\)=='boolean' then st\.flags\[c\]=false/.test(code), "set -> clears the master flag for each disabled category");
ok(!/constructBuilding/.test(code), "set -> never constructs a pile (edit only)");

// --- stockpileSet: unknown keys are filtered out of the Lua --------------------------------------
calls.length = 0;
await df.stockpileSet({ x: 1, y: 2, z: 3 }, { food: true, notacat: true, "evil'": false });
code = codeOf(calls[0]);
ok(/local on=\{'food'\}/.test(code), "set -> only known keys reach the on list");
ok(/local off=\{\}/.test(code), "set -> unknown keys never reach the off list");
ok(!/notacat/.test(code) && !/evil/.test(code), "set -> no client key text is interpolated");

// --- stockpileSet: no-ops emit no RPC ------------------------------------------------------------
calls.length = 0;
await df.stockpileSet({ x: 1, y: 2, z: 3 }, { notacat: true }); // no known keys
ok(calls.length === 0, "set (no known cats) -> no RPC");
await df.stockpileSet({ x: NaN, y: 2, z: 3 }, { food: true }); // non-finite tile
ok(calls.length === 0, "set (non-finite tile) -> no RPC");
await df.stockpileSet({ x: 1, y: 2, z: 3 }, null); // no cats object
ok(calls.length === 0, "set (no cats) -> no RPC");
await df.stockpileSet(null, { food: true }); // no tile
ok(calls.length === 0, "set (no tile) -> no RPC");

// Editor never digs.
ok(!calls.some((k) => k.m === "SendDigCommand"), "editor -> never SendDigCommand");

console.log(fail ? `\n${fail} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
process.exit(fail ? 1 : 0);
