// Reproduce "replace a dig with a down-stair": on one revealed wall tile, designate dig (1),
// read it back, then RE-designate the same tile down-stair (5) and read back again. This
// isolates whether re-designating an already-designated tile is reflected in RFR's
// tile_dig_designation (bridge read path) or whether the bug is client-side. Cleans up after
// itself (sets the tile back to NO_DIG). Usage: node bridge/dfhack/replace-probe.mjs
import { DFAccess } from "./df-access.mjs";
import { TILE } from "../../client/js/protocol.js";

const df = new DFAccess({
  host: process.env.DF_HOST || "127.0.0.1",
  port: Number(process.env.DF_PORT) || 5000,
});
await df.connect();
const info = await df.mapInfo();
const table = await df.tileTable();
const view = await df.view();
const z = view.z;
const cx = view.x + (view.w >> 1);
const cy = view.y + (view.h >> 1);
const client = df.client;

const blockReq = {
  blocks_needed: info.block_size_x * info.block_size_y + 8,
  min_x: 0, max_x: info.block_size_x, min_y: 0, max_y: info.block_size_y,
  min_z: z, max_z: z + 1, force_reload: true,
};

function digAt(b, gx, gy) {
  const d = b.tile_dig_designation;
  if (!d || !d.length) return undefined;
  return d[(gy - b.map_y) * 16 + (gx - b.map_x)];
}

async function readDig(gx, gy) {
  const bl = await client.call("GetBlockList", blockReq);
  for (const b of bl.map_blocks || []) {
    if (gx >= b.map_x && gx < b.map_x + 16 && gy >= b.map_y && gy < b.map_y + 16 && b.map_z === z) {
      return digAt(b, gx, gy);
    }
  }
  return undefined;
}

// Find the revealed wall tile nearest the view center.
const bl = await client.call("GetBlockList", blockReq);
let cand = null;
let best = Infinity;
for (const b of bl.map_blocks || []) {
  const t = b.tiles;
  if (!t) continue;
  for (let i = 0; i < t.length; i++) {
    if (b.hidden && b.hidden[i]) continue;
    if (table[t[i]] !== TILE.WALL) continue;
    const gx = b.map_x + (i & 15);
    const gy = b.map_y + (i >> 4);
    const dist = (gx - cx) ** 2 + (gy - cy) ** 2;
    if (dist < best) { best = dist; cand = { x: gx, y: gy, z }; }
  }
}
if (!cand) {
  console.error("  FAIL- no revealed wall tile found near the view to test on");
  process.exit(1);
}

let fail = 0;
const step = async (label, kind, want) => {
  await df.designate(kind, [cand]);
  const got = await readDig(cand.x, cand.y);
  const ok = got === want;
  console.log(`  ${ok ? "ok  " : "FAIL"}- ${label}: designate "${kind}" -> read back ${got} (want ${want})`);
  if (!ok) fail++;
};

console.log(`  target wall tile: (${cand.x},${cand.y},${cand.z})  near view center (${cx},${cy})`);
console.log(`  designation before: ${await readDig(cand.x, cand.y)} (undefined/0 = none)`);

await step("initial dig", "dig", 1);
await step("REPLACE dig -> down-stair", "downstair", 5); // the user's exact case

// Verify the DESIG payload the bridge actually streams (level() builds the sparse list the
// browser receives) reflects the down-stair on this tile, not the stale dig.
const lvl = await df.level(z);
const entry = lvl.desig.find((e) => e.x === cand.x && e.y === cand.y);
const lvlOk = entry && entry.d === 5;
console.log(`  ${lvlOk ? "ok  " : "FAIL"}- level().desig for the tile: ${entry ? `d=${entry.d}` : "MISSING"} (want d=5)`);
if (!lvlOk) fail++;

await step("REPLACE down-stair -> ramp", "ramp", 4); // a second replace, for good measure
await step("cleanup remove", "remove", 0);

console.log(fail ? `\n${fail} CHECK(S) FAILED — re-designate not reflected at RFR layer` : "\nALL CHECKS PASSED — RFR reflects re-designations; bug is client/streaming side");
process.exit(fail ? 1 : 0);
