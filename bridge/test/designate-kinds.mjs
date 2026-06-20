// Unit test: DFAccess.designate maps each command kind to the right RFR TileDigDesignation
// and forwards locations. Stubs the DFHack client, so no DF connection is needed.
// Usage: node bridge/test/designate-kinds.mjs
import { DFAccess } from "../dfhack/df-access.mjs";

const calls = [];
const df = new DFAccess();
df.client = { call: (m, r) => (calls.push({ m, r }), Promise.resolve({})) }; // connect() returns this

let fail = 0;
const ok = (c, m) => (c ? console.log("  ok  -", m) : (console.error("  FAIL-", m), fail++));

const expect = { dig: 1, channel: 3, upstair: 6, downstair: 5, updownstair: 2, ramp: 4, remove: 0 };
for (const [kind, val] of Object.entries(expect)) {
  calls.length = 0;
  await df.designate(kind, [{ x: 1, y: 2, z: 3 }]);
  const c = calls[0];
  ok(c && c.m === "SendDigCommand" && c.r.designation === val, `${kind} -> SendDigCommand designation=${val} (got ${c ? c.r.designation : "none"})`);
  ok(c && Array.isArray(c.r.locations) && c.r.locations[0].x === 1 && c.r.locations[0].z === 3, `${kind} -> locations forwarded`);
}

calls.length = 0;
await df.designate("bogus", [{ x: 0, y: 0, z: 0 }]);
ok(calls[0] && calls[0].r.designation === 1, "unknown kind defaults to dig (1)");

calls.length = 0;
await df.designate("dig", []);
ok(calls.length === 0, "empty tile list -> no RPC sent");

console.log(fail ? `\n${fail} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
process.exit(fail ? 1 : 0);
