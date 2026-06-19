// De-risk the write path: place ONE dig designation via RFR SendDigCommand and read it back
// from GetBlockList's tile_dig_designation to confirm it took. Reversible (cancel in DF, or
// re-run with DESIG=0). Picks a revealed WALL tile nearest DF's view center.
// Usage: node bridge/dfhack/dig-probe.mjs   (DESIG overrides designation: 1=dig,0=cancel)
import { DFAccess } from "./df-access.mjs";
import { TILE } from "../../client/js/protocol.js";

const DESIG = process.env.DESIG != null ? Number(process.env.DESIG) : 1; // 1 = DEFAULT_DIG

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
    if (dist < best) { best = dist; cand = { x: gx, y: gy, z, block: b }; }
  }
}

if (!cand) {
  console.error("  FAIL- no revealed wall tile found near the view to test on");
  process.exit(1);
}
console.log(`  target wall tile: (${cand.x},${cand.y},${cand.z})  near view center (${cx},${cy})`);
console.log(`  designation before: ${digAt(cand.block, cand.x, cand.y)} (undefined = none)`);

await client.call("SendDigCommand", { designation: DESIG, locations: [{ x: cand.x, y: cand.y, z: cand.z }] });
console.log(`  sent SendDigCommand designation=${DESIG}`);

// Read the same block back and check the designation changed.
const bl2 = await client.call("GetBlockList", blockReq);
const b2 = (bl2.map_blocks || []).find(
  (b) => b.map_x === cand.block.map_x && b.map_y === cand.block.map_y && b.map_z === z
);
const after = b2 ? digAt(b2, cand.x, cand.y) : undefined;
console.log(`  designation after:  ${after}`);

const ok = after === DESIG;
console.log(ok ? "\nOK - write path works (designation read back as expected)" : "\nFAIL - designation did not take");
process.exit(ok ? 0 : 1);
