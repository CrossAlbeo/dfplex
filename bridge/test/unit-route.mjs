// Unit test: the inspect-panel backend — DFAccess.unitGet. The client clicks a dwarf and sends its
// id (taken from the streamed `units` feed); the backend resolves it with df.unit.find(id) in core
// Lua and rides the print() surface back through callText (RunCommand's output is EmptyMessage).
// Asserts the RPC, integer coercion of the id, the pcall-guarded field reads, the multi-line blob
// parse (incl. a free-form name carrying commas/quotes/'='), and that a non-finite/missing id emits
// no RPC. Stubs the DFHack client — offline (Tier 1). Usage: node bridge/test/unit-route.mjs
import { DFAccess } from "../dfhack/df-access.mjs";

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

// --- unitGet: a real unit ------------------------------------------------------------------------
// Each field is its own `dfplex unit <key>=<value>` line; the name carries commas + quotes.
calls.length = 0;
textReply = [
  "dfplex unit id=16665\n" +
    'dfplex unit name=Hanarr Berafli "Berryforges", Miner\n' +
    "dfplex unit prof=Miner\n" +
    "dfplex unit race=DWARF\n" +
    "dfplex unit age=57.33\n" +
    "dfplex unit citizen=true\n" +
    "dfplex unit dead=false\n" +
    "dfplex unit soldier=false\n" +
    "dfplex unit stress=0\n" +
    "dfplex unit stresscat=3\n" +
    "dfplex unit job=Idle\n" +
    "dfplex unit wounds=0\n",
];
let got = await df.unitGet(16665.9); // fractional on purpose -> floored to 16665
let c = calls[0];
ok(calls.length === 1 && c.via === "callText", "get -> exactly one callText (captures print)");
ok(c && c.m === "RunCommand" && c.r.command === "lua", "get -> RunCommand lua");
let code = codeOf(c);
ok(/df\.unit\.find\(16665\)/.test(code), "get -> integer id bound in df.unit.find (16665.9 floored to 16665)");
ok(!/16665\.9/.test(code), "get -> no fractional id reaches the Lua");
ok(/pcall\(/.test(code), "get -> field reads are pcall-guarded");
ok(/getProfessionName/.test(code) && /getReadableName/.test(code), "get -> uses the readable-name/profession helpers");
for (const k of ["name", "prof", "race", "age", "citizen", "dead", "soldier", "stress", "stresscat", "job", "wounds"])
  ok(code.includes(`'${k}'`), `get -> queries the ${k} field`);
ok(got.info && got.info.id === 16665, "get -> info.id is the resolved id");
ok(got.info.name === 'Hanarr Berafli "Berryforges", Miner', "get -> free-form name (commas/quotes) parses whole");
ok(got.info.profession === "Miner" && got.info.race === "DWARF", "get -> profession + race parse");
ok(got.info.age === 57, "get -> age floored to whole years");
ok(got.info.citizen === true && got.info.soldier === false && got.info.dead === false, "get -> booleans parse");
ok(got.info.stress === 0 && got.info.stressCat === 3 && got.info.wounds === 0, "get -> numeric fields parse");
ok(got.info.job === "Idle", "get -> job token parses");

// --- unitGet: a name containing '=' still parses (split on the first '=' only) --------------------
calls.length = 0;
textReply = ["dfplex unit id=7\ndfplex unit name=A=B, C\ndfplex unit prof=Peasant\n"];
got = await df.unitGet(7);
ok(got.info && got.info.name === "A=B, C", "get -> name with '=' keeps everything after the first '='");

// --- unitGet: no such unit -----------------------------------------------------------------------
calls.length = 0;
textReply = ["dfplex unit none\n"];
got = await df.unitGet(999999);
ok(calls.length === 1 && got.info === null, "get (no unit) -> { info:null }");

// --- unitGet: non-finite / missing id -> no RPC --------------------------------------------------
calls.length = 0;
got = await df.unitGet(NaN);
ok(calls.length === 0 && got.info === null, "get (NaN id) -> no RPC, { info:null }");
calls.length = 0;
got = await df.unitGet(null);
ok(calls.length === 0 && got.info === null, "get (null id) -> no RPC, { info:null }");
calls.length = 0;
got = await df.unitGet(undefined);
ok(calls.length === 0 && got.info === null, "get (undefined id) -> no RPC, { info:null }");

// Inspect is read-only.
calls.length = 0;
textReply = ["dfplex unit none\n"];
await df.unitGet(1);
ok(!calls.some((k) => k.via === "call"), "inspect -> read-only (never the write `call` path)");
ok(!calls.some((k) => k.m === "SendDigCommand"), "inspect -> never SendDigCommand");

console.log(fail ? `\n${fail} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
process.exit(fail ? 1 : 0);
