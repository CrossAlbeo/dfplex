// Unit test: DFAccess.designate routes chop/gather through the core Lua designations API
// (dfhack.designations.markPlant via RunCommand("lua", ...)) instead of RFR SendDigCommand, because
// RFR's dig enum has no chop/gather designation. markPlant auto-picks chop vs gather from the plant,
// so each tool filters by the plant's raw TREE flag (TREE species => chop, else gather); this asserts
// that distinction so the "both tools mark everything" bug can't return. Also checks the coord guard so nothing
// client-controlled is interpolated as code. Stubs the DFHack client — no DF connection needed.
// Usage: node bridge/test/chop-gather-route.mjs
import { DFAccess } from "../dfhack/df-access.mjs";

const calls = [];
const df = new DFAccess();
df.client = { call: (m, r) => (calls.push({ m, r }), Promise.resolve({})) }; // connect() returns this

let fail = 0;
const ok = (c, m) => (c ? console.log("  ok  -", m) : (console.error("  FAIL-", m), fail++));

for (const kind of ["chop", "gather"]) {
  calls.length = 0;
  await df.designate(kind, [{ x: 5, y: 6, z: 7 }, { x: 8, y: 9, z: 7 }]);
  const c = calls[0];
  ok(calls.length === 1 && c.m === "RunCommand", `${kind} -> RunCommand (got ${c ? c.m : "none"})`);
  ok(c && c.r.command === "lua", `${kind} -> lua command`);
  const code = (c && c.r.arguments && c.r.arguments[0]) || "";
  ok(/getPlantAtTile/.test(code) && /markPlant/.test(code), `${kind} -> uses getPlantAtTile + markPlant`);
  ok(/canMarkPlant/.test(code), `${kind} -> gated by canMarkPlant`);
  ok(/raws\.plants\.all/.test(code) && /flags\.TREE/.test(code), `${kind} -> classifies by plant raw TREE flag`);
  ok(code.includes(`isTree==${kind === "chop"}`), `${kind} -> only marks ${kind === "chop" ? "trees" : "non-trees"} (isTree==${kind === "chop"})`);
  ok(code.includes("{x=5,y=6,z=7}") && code.includes("{x=8,y=9,z=7}"), `${kind} -> forwards integer coords`);
  ok(code.includes(`dfplex ${kind} `), `${kind} -> labels the print with kind`);
  ok(!calls.some((k) => k.m === "SendDigCommand"), `${kind} -> never calls SendDigCommand`);
}

// Dig-style kinds must be untouched by the chop/gather branch.
calls.length = 0;
await df.designate("dig", [{ x: 1, y: 2, z: 3 }]);
ok(calls[0] && calls[0].m === "SendDigCommand", "dig still -> SendDigCommand");

// Empty / non-finite inputs emit no RPC (no client string ever reaches the Lua chunk).
calls.length = 0;
await df.designate("chop", []);
ok(calls.length === 0, "chop with empty tiles -> no RPC");
calls.length = 0;
await df.designate("gather", [{ x: 1.5, y: NaN, z: "x" }]);
ok(calls.length === 0, "gather with non-finite coords -> no RPC");

console.log(fail ? `\n${fail} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
process.exit(fail ? 1 : 0);
