// Unit test: DFAccess.resize edits one stockpile/zone's footprint IN PLACE via core Lua (no
// deconstruct), so links/settings survive. Asserts the resolve -> snapshot(for fallback) -> tryInplace
// (realloc-or-reuse extents + commit bbox + stockpile occupancy reconcile) sequence with the in-place
// path PRIMARY and the deconstruct+reconstruct path behind the `else` fallback, for both targets; plus
// the overlapping-zone `from` disambiguation, integer coercion, the mask sanitize/length gate, the
// empty-box (deconstruct-only) path, and that bad/empty input never reaches a bad RPC.
// Stubs the DFHack client — offline (Tier 1). Usage: node bridge/test/resize-route.mjs
import { DFAccess } from "../dfhack/df-access.mjs";

const calls = [];
const df = new DFAccess();
df.client = { call: (m, r) => (calls.push({ m, r }), Promise.resolve({})) };
const codeOf = () => (calls[0] && calls[0].r.arguments && calls[0].r.arguments[0]) || "";

let fail = 0;
const ok = (c, m) => (c ? console.log("  ok  -", m) : (console.error("  FAIL-", m), fail++));

const tile = { x: 5, y: 6, z: 7 };
const from = { x0: 5, y0: 6, x1: 7, y1: 8 };
const box = { x0: 5, y0: 6, z: 7, w: 4, h: 3 };
const mask = "111111111111"; // 4*3, full rectangle (12 ones)

// --- stockpile resize (in place) ---
calls.length = 0;
await df.resize("stockpile", tile, box, mask, from);
let c = calls[0];
ok(calls.length === 1 && c.m === "RunCommand" && c.r.command === "lua", "stockpile -> one RunCommand/lua");
let code = codeOf();
ok(/dfhack\.buildings\.findAtTile\(5,6,7\)/.test(code), "stockpile -> resolves via findAtTile(5,6,7)");
ok(/getType\(\)~=df\.building_type\.Stockpile/.test(code), "stockpile -> checks it's a Stockpile");
ok(/local function tryInplace\(\)/.test(code), "stockpile -> in-place attempt (tryInplace)");
ok(/df\.new,'int8_t',12/.test(code) && /df\.reinterpret_cast,df\.building_extents_type/.test(code), "stockpile -> grows via int8_t alloc + reinterpret_cast");
ok(/for i=0,11 do r\.extents\[i\]=\(\('111111111111'\):sub\(i\+1,i\+1\)=='1'\) and 1 or 0 end/.test(code), "stockpile -> writes the 12-cell mask into room.extents");
ok(/r\.x,r\.y,r\.width,r\.height=5,6,4,3/.test(code) && /b\.x1,b\.y1,b\.x2,b\.y2=5,6,8,8/.test(code), "stockpile -> commits new room dims + bbox in place");
ok(/local function setOcc\(/.test(code) && /df\.tile_building_occ\.Passable/.test(code) && /df\.tile_building_occ\.None/.test(code), "stockpile -> reconciles map occupancy (Passable on occupied, None on released)");
ok(/local s,res=pcall\(tryInplace\)/.test(code) && /if s and res then print\('dfplex resize stockpile id='.*inplace'\) else /.test(code), "stockpile -> in-place is the primary path");
ok(/else pcall\(dfhack\.buildings\.deconstruct, b\)/.test(code) && /constructBuilding,\{type=df\.building_type\.Stockpile,pos=\{x=5,y=6,z=Z\},width=4,height=3,abstract=true\}/.test(code), "stockpile -> deconstruct+reconstruct only as the `else` fallback");
ok(/local snap=\{\}.*settings\.flags/.test(code) && /for k,_ in pairs\(snap\) do fill\(k\) end/.test(code), "stockpile -> fallback re-applies the snapshotted category flags");
ok(!/SendDigCommand/.test(code), "stockpile -> never SendDigCommand");

// --- zone resize (in place; zones do NOT use building occupancy) ---
calls.length = 0;
await df.resize("zone", tile, box, mask, from);
code = codeOf();
ok(/findCivzonesAt\(xyz2pos\(5,6,7\)\)/.test(code), "zone -> resolves via findCivzonesAt(xyz2pos(...))");
ok(/zz\.x1==5 and zz\.y1==6 and zz\.x2==7 and zz\.y2==8/.test(code), "zone -> disambiguates overlaps with the `from` bbox");
ok(/local sub=b\.type local act=b\.spec_sub_flag\.active/.test(code), "zone -> snapshots use (subtype) + active (for the fallback)");
ok(/local function tryInplace\(\)/.test(code) && /r\.x,r\.y,r\.width,r\.height=5,6,4,3/.test(code), "zone -> in-place reshape commits dims + bbox");
ok(!/tile_building_occ/.test(code), "zone -> never touches building occupancy");
ok(/if s and res then print\('dfplex resize zone id='.*inplace'\) else /.test(code), "zone -> in-place is the primary path");
ok(/else pcall\(dfhack\.buildings\.deconstruct, b\)/.test(code) && /constructBuilding,\{type=df\.building_type\.Civzone,subtype=sub,pos=\{x=5,y=6,z=Z\}/.test(code), "zone -> reconstruct civzone only as the `else` fallback");
ok(/if sub==df\.civzone_type\.Pond then.*pond\.flag\.keep_filled=true/.test(code), "zone -> fallback re-applies runtime-guarded per-use defaults");

// --- empty box: resize cleared the last tile -> deconstruct only ---
calls.length = 0;
await df.resize("stockpile", tile, null, undefined, from);
code = codeOf();
ok(calls.length === 1 && /deconstruct, b\)/.test(code) && /resize stockpile removed/.test(code), "empty box -> deconstruct + 'removed'");
ok(!/constructBuilding/.test(code) && !/tryInplace/.test(code), "empty box -> no reconstruct, no in-place");

// --- integer coercion: fractional coords floored, never interpolated as floats ---
calls.length = 0;
await df.resize("stockpile", { x: 5.9, y: 6.2, z: 7.8 }, { x0: 5.7, y0: 6.4, z: 7.1, w: 4, h: 3 }, mask, from);
code = codeOf();
ok(/findAtTile\(5,6,7\)/.test(code) && /r\.x,r\.y,r\.width,r\.height=5,6,4,3/.test(code), "float coords -> floored to integers");
ok(!/5\.9|6\.2|7\.8|5\.7|6\.4|7\.1/.test(code), "no fractional coords reach the Lua");

// --- mask sanitize gate: wrong length / non-binary -> throw, no good RPC ---
const threw = async (fn) => { try { await fn(); return false; } catch { return true; } };
ok(await threw(() => df.resize("stockpile", tile, box, "1111", from)), "mask length != w*h -> throws");
ok(await threw(() => df.resize("stockpile", tile, box, "11111111111x", from)), "non-0/1 mask char -> throws");
ok(await threw(() => df.resize("bogus", tile, box, mask, from)), "unknown target -> throws");

// --- non-finite tile -> no RPC at all ---
calls.length = 0;
await df.resize("stockpile", { x: NaN, y: 6, z: 7 }, box, mask, from);
ok(calls.length === 0, "non-finite tile -> no RPC");

console.log(fail ? `\n${fail} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
process.exit(fail ? 1 : 0);
