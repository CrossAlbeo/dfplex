// Unit test: DFAccess.assignOccupant writes a cage/chain's assignment field via core Lua. Asserts the
// resolve (findAtTile for the building) -> validate (Cage/Chain, unit exists, assignable guard) ->
// write (cage: assigned_units vector insert with a dup guard; chain: `assigned` unit-pointer set)
// sequence, plus integer coercion of both the tile and the unit id, the ok/err reply parse, and that
// bad/non-finite input never reaches an RPC. Stubs the DFHack client's callText (assign rides the
// print() reply surface) — offline (Tier 1).
// Usage: node bridge/test/cage-chain-route.mjs
import { DFAccess } from "../dfhack/df-access.mjs";

const calls = [];
const okText = ["dfplex assign ok cage=49 unit=16672 count=2"];
const mkdf = (text) => {
  const df = new DFAccess();
  df.client = { callText: (m, r) => (calls.push({ m, r }), Promise.resolve({ text })) };
  return df;
};
const codeOf = () => (calls[0] && calls[0].r.arguments && calls[0].r.arguments[0]) || "";

let fail = 0;
const ok = (c, m) => (c ? console.log("  ok  -", m) : (console.error("  FAIL-", m), fail++));

const tile = { x: 10, y: 20, z: 30 };
const unit = 16672;

// --- happy path: assign a creature ---
calls.length = 0;
let res = await mkdf(okText).assignOccupant(tile, unit);
let c = calls[0];
ok(calls.length === 1 && c.m === "RunCommand" && c.r.command === "lua", "assign -> one RunCommand/lua via callText");
let code = codeOf();
ok(/findAtTile\(10,20,30\)/.test(code), "resolves the building via findAtTile");
ok(/t==df\.building_type\.Cage or t==df\.building_type\.Chain/.test(code), "validates the building is a Cage or Chain");
ok(/local uid=16672\b/.test(code), "binds the unit id to a local (kept off the '..' numeric-literal trap)");
ok(/df\.unit\.find\(uid\)/.test(code), "looks the unit up by (coerced) id");
ok(/isOwnCiv/.test(code) && /isAnimal/.test(code) && /flags1\.caged/.test(code), "assignable guard: own-civ animal or already-caged creature");
ok(/b\.assigned_units:insert\('#',uid\)/.test(code), "cage branch: appends the id to the assigned_units vector");
ok(/b\.assigned_units\[i\]==uid then print\('dfplex assign ok already/.test(code), "cage branch: idempotent dup guard");
ok(/b\.assigned=u\b/.test(code), "chain branch: sets the `assigned` unit pointer (not an id / not assigned_unit)");
ok(!/assigned_unit\b(?!s)/.test(code), "never touches a (non-existent) scalar `assigned_unit` field");
ok(res.ok === true && /^ok\b/.test(res.msg), "parses the ok reply -> { ok:true }");

// --- err reply -> { ok:false, msg } ---
calls.length = 0;
res = await mkdf(["dfplex assign err=not a cage/chain"]).assignOccupant(tile, unit);
ok(res.ok === false && /not a cage\/chain/.test(res.msg) && !/^err=/.test(res.msg), "parses an err reply -> { ok:false } with the bare message");

// --- integer coercion: fractional tile + unit floored, never interpolated as floats ---
calls.length = 0;
await mkdf(okText).assignOccupant({ x: 10.9, y: 20.2, z: 30.7 }, 16672.8);
code = codeOf();
ok(/findAtTile\(10,20,30\)/.test(code), "float tile coords -> floored to integers");
ok(/local uid=16672\b/.test(code) && !/16672\.8/.test(code), "float unit id -> floored to integer");
ok(!/10\.9|20\.2|30\.7/.test(code), "no fractional coords reach the Lua");

// --- non-finite / missing input -> no RPC at all, returns { ok:false } ---
calls.length = 0;
res = await mkdf(okText).assignOccupant({ x: NaN, y: 20, z: 30 }, unit);
ok(calls.length === 0 && res.ok === false, "non-finite tile -> no RPC, { ok:false }");
calls.length = 0;
res = await mkdf(okText).assignOccupant(tile, NaN);
ok(calls.length === 0 && res.ok === false, "non-finite unit id -> no RPC, { ok:false }");
calls.length = 0;
res = await mkdf(okText).assignOccupant(null, unit);
ok(calls.length === 0 && res.ok === false, "missing tile -> no RPC, { ok:false }");

console.log(fail ? `\n${fail} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
process.exit(fail ? 1 : 0);
