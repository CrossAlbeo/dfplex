// Unit test: DFAccess.link queues a faithful LinkBuildingToTrigger job via core Lua. Asserts the
// resolve (findAtTile for lever + target) -> validate (Trap+trap_type, target allowlist, distinct) ->
// build (sentinel pos, TRIGGERTARGET+HOLDER refs, NO job_item filters, two mechanisms attached with the
// LinkToTrigger/LinkToTarget roles) -> linkIntoWorld -> POST sequence, plus integer coercion, the
// ok/err reply parse, and that bad/non-finite tiles never reach an RPC. Stubs the DFHack client's
// callText (link rides the print() reply surface) — offline (Tier 1).
// Usage: node bridge/test/lever-link-route.mjs
import { DFAccess } from "../dfhack/df-access.mjs";

const calls = [];
const okText = ["dfplex link ok lever=46 target=48 job=261"];
const mkdf = (text) => {
  const df = new DFAccess();
  df.client = { callText: (m, r) => (calls.push({ m, r }), Promise.resolve({ text })) };
  return df;
};
const codeOf = () => (calls[0] && calls[0].r.arguments && calls[0].r.arguments[0]) || "";

let fail = 0;
const ok = (c, m) => (c ? console.log("  ok  -", m) : (console.error("  FAIL-", m), fail++));

const lever = { x: 10, y: 20, z: 30 };
const target = { x: 13, y: 20, z: 30 };

// --- happy path: queue a link ---
calls.length = 0;
let res = await mkdf(okText).link(lever, target);
let c = calls[0];
ok(calls.length === 1 && c.m === "RunCommand" && c.r.command === "lua", "link -> one RunCommand/lua via callText");
let code = codeOf();
ok(/findAtTile\(10,20,30\)/.test(code) && /findAtTile\(13,20,30\)/.test(code), "resolves lever + target via findAtTile");
ok(/getType\(\)==df\.building_type\.Trap and \(L\.trap_type==df\.trap_type\.Lever or L\.trap_type==df\.trap_type\.PressurePlate\)/.test(code), "validates source is a lever / pressure plate");
ok(/if L\.id==T\.id then/.test(code), "rejects linking a building to itself");
ok(/'Floodgate'/.test(code) && /df\.building_type\[n\]==tt/.test(code), "checks target against the gate allowlist");
ok(!/'Door'/.test(code), "Door is NOT in the target allowlist (DF doesn't lever-link doors)");
ok(/job_type=df\.job_type\.LinkBuildingToTrigger/.test(code), "builds a LinkBuildingToTrigger job");
ok(/job\.pos\.x,job\.pos\.y,job\.pos\.z=-30000,-30000,-30000/.test(code), "leaves job.pos at the (-30000) sentinel");
ok(/general_ref_building_triggertargetst:new\(\)[\s\S]*tg\.building_id=T\.id/.test(code) && /general_ref_building_holderst:new\(\)[\s\S]*h\.building_id=L\.id/.test(code), "TRIGGERTARGET -> target, HOLDER -> lever");
ok(!/job_items\.elements/.test(code), "no job_item requirement filters (the half-link bug)");
ok(/attachJobItem\(job,mechs\[1\],df\.job_role_type\.LinkToTrigger,-1,-1\)/.test(code) && /attachJobItem\(job,mechs\[2\],df\.job_role_type\.LinkToTarget,-1,-1\)/.test(code), "attaches 2 mechanisms with the LinkToTrigger / LinkToTarget roles");
ok(/world\.items\.other\.TRAPPARTS/.test(code) && /#mechs<2 then/.test(code), "finds two FREE TRAPPARTS, bails if fewer");
ok(/dfhack\.job\.linkIntoWorld\(job,true\)/.test(code), "links the job into the world");
ok(/world\.jobs\.postings/.test(code) && /job\.posting_index=idx/.test(code), "posts the job (sets posting_index)");
ok(/removeJob/.test(code) && /LinkBuildingToTrigger then stale/.test(code), "clears stale link jobs first (idempotent re-clicks)");
ok(res.ok === true && /^ok\b/.test(res.msg), "parses the ok reply -> { ok:true }");

// --- err reply -> { ok:false, msg } ---
calls.length = 0;
res = await mkdf(["dfplex link err=target not linkable: Door"]).link(lever, target);
ok(res.ok === false && /not linkable/.test(res.msg) && !/^err=/.test(res.msg), "parses an err reply -> { ok:false } with the bare message");

// --- integer coercion: fractional coords floored, never interpolated as floats ---
calls.length = 0;
await mkdf(okText).link({ x: 10.9, y: 20.2, z: 30.7 }, { x: 13.4, y: 20.8, z: 30.1 });
code = codeOf();
ok(/findAtTile\(10,20,30\)/.test(code) && /findAtTile\(13,20,30\)/.test(code), "float coords -> floored to integers");
ok(!/10\.9|20\.2|30\.7|13\.4|20\.8|30\.1/.test(code), "no fractional coords reach the Lua");

// --- non-finite tiles -> no RPC at all, returns { ok:false } ---
calls.length = 0;
res = await mkdf(okText).link({ x: NaN, y: 20, z: 30 }, target);
ok(calls.length === 0 && res.ok === false, "non-finite lever -> no RPC, { ok:false }");
calls.length = 0;
res = await mkdf(okText).link(lever, { x: 13, y: 20, z: Infinity });
ok(calls.length === 0 && res.ok === false, "non-finite target -> no RPC, { ok:false }");
calls.length = 0;
res = await mkdf(okText).link(null, target);
ok(calls.length === 0 && res.ok === false, "missing lever -> no RPC, { ok:false }");

console.log(fail ? `\n${fail} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
process.exit(fail ? 1 : 0);
