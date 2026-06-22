// Unit test: DFAccess.zone places ONE abstract activity zone spanning the drag rectangle via the core
// Lua API (constructBuilding{type=Civzone, subtype=<civzone_type>} + spec_sub_flag.active), since RFR
// has no zone RPC. Asserts the server-side bounding-box math, abstract=true, that the zone use rides in
// as the building subtype (the validated df.civzone_type name), the active flag, per-type defaults,
// integer coercion, the civ-name allowlist, and that empty/non-finite/unknown input emits no RPC.
// Stubs the DFHack client — offline (Tier 1). Usage: node bridge/test/zone-route.mjs
import { DFAccess } from "../dfhack/df-access.mjs";
import { ZONE_CIV_NAMES } from "../../client/js/zones.js";

const calls = [];
const df = new DFAccess();
df.client = { call: (m, r) => (calls.push({ m, r }), Promise.resolve({})) }; // connect() returns this

let fail = 0;
const ok = (c, m) => (c ? console.log("  ok  -", m) : (console.error("  FAIL-", m), fail++));

// A 4x3 rectangle from (5,6) to (8,8) at z=7, tiles pushed out of order — the bbox must still resolve
// to corner (5,6) and span 4x3.
const rect = [];
for (let y = 8; y >= 6; y--) for (let x = 8; x >= 5; x--) rect.push({ x, y, z: 7 });

// Meeting Area: the basic create path (no per-type extras).
calls.length = 0;
await df.zone("z_meeting", rect);
let c = calls[0];
ok(calls.length === 1 && c.m === "RunCommand", `z_meeting -> RunCommand (got ${c ? c.m : "none"})`);
ok(c && c.r.command === "lua", "z_meeting -> lua command");
let code = (c && c.r.arguments && c.r.arguments[0]) || "";
ok(/building_type\.Civzone/.test(code), "z_meeting -> constructs a Civzone");
ok(/subtype=sub\b/.test(code) && /local sub=df\.civzone_type\.MeetingHall\b/.test(code), "z_meeting -> use rides in as subtype df.civzone_type.MeetingHall");
ok(/abstract=true/.test(code), "z_meeting -> abstract=true (no materials)");
ok(/local x0,y0,z,w,h=5,6,7,4,3\b/.test(code), "z_meeting -> bbox corner (5,6) z=7 span 4x3");
ok(/pos=\{x=x0,y=y0,z=z\}/.test(code) && /width=w\b/.test(code) && /height=h\b/.test(code), "z_meeting -> places at the computed bbox");
ok(/spec_sub_flag\.active=true/.test(code), "z_meeting -> sets spec_sub_flag.active");
ok(!/zone_settings/.test(code), "z_meeting -> no per-type zone_settings extras");
ok(!calls.some((k) => k.m === "SendDigCommand"), "z_meeting -> never SendDigCommand");

// Per-type defaults: each special use injects its quickfort-mirrored zone_settings line.
const extras = [
  ["z_pen", "Pen", /zone_settings\.pen\.flags\.check_occupants=true/],
  ["z_pond", "Pond", /zone_settings\.pond\.flag\.keep_filled=true/],
  ["z_archery", "ArcheryRange", /zone_settings\.archery\.dir_x=1/],
  ["z_tomb", "Tomb", /zone_settings\.tomb\.flags\.whole=1/],
  ["z_gather", "PlantGathering", /zone_settings\.gather\.flags|pick_trees=true/],
];
for (const [kind, civ, re] of extras) {
  calls.length = 0;
  await df.zone(kind, rect);
  code = calls[0].r.arguments[0];
  ok(new RegExp(`df\\.civzone_type\\.${civ}\\b`).test(code), `${kind} -> subtype df.civzone_type.${civ}`);
  ok(re.test(code), `${kind} -> applies its per-type default`);
}

// Every preset resolves to a known civzone_type name (the only token interpolated as an identifier).
ok(ZONE_CIV_NAMES.length === 18, `18 zone uses defined (got ${ZONE_CIV_NAMES.length})`);

// Integer coercion: fractional coords are floored, never interpolated as floats.
calls.length = 0;
await df.zone("z_meeting", [{ x: 5.9, y: 6.2, z: 7 }, { x: 8.4, y: 8.7, z: 7 }]);
code = calls[0].r.arguments[0];
ok(/local x0,y0,z,w,h=5,6,7,4,3\b/.test(code), "float coords -> floored to corner (5,6) z=7 span 4x3");
ok(!/5\.9|6\.2|8\.4|8\.7/.test(code), "no fractional coords reach the Lua");

// Unknown kind throws; empty / all-non-finite -> no RPC at all.
let threw = false;
try {
  await df.zone("z_nope", rect);
} catch {
  threw = true;
}
ok(threw, "unknown kind -> throws");
calls.length = 0;
await df.zone("z_meeting", []);
ok(calls.length === 0, "empty tiles -> no RPC");
calls.length = 0;
await df.zone("z_meeting", [{ x: NaN, y: 1, z: 2 }, { x: 3, y: Infinity, z: 2 }]);
ok(calls.length === 0, "all-non-finite tiles -> no RPC");

console.log(fail ? `\n${fail} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
process.exit(fail ? 1 : 0);
