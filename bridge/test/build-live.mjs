// Live write-path smoke (needs DF). Exercises the real bridge code path: DFAccess.build() ->
// RunCommand("lua", constructBuilding). Finds a free FLOOR tile near the view, places a Wall via
// df.build("c_wall", ...), reads the level back to confirm a building now covers that tile, then
// deconstructs it so the fort is left untouched. Usage: node bridge/test/build-live.mjs
import { DFAccess } from "../dfhack/df-access.mjs";
import { TILE } from "../../client/js/protocol.js";

const df = new DFAccess({
  host: process.env.DF_HOST || "127.0.0.1",
  port: Number(process.env.DF_PORT) || 5000,
});

let fail = 0;
const ok = (c, m) => (c ? console.log("  ok  -", m) : (console.error("  FAIL-", m), fail++));

await df.connect();
await df.mapInfo();
const v = await df.view();
const W = df.dims.xCount;
const z = v.z;

// Find a FLOOR tile near the view centre that isn't already under a building.
const lvl0 = await df.level(z);
const covered = (x, y) => lvl0.buildings.some((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1);
const cx = v.x + (v.w >> 1);
const cy = v.y + (v.h >> 1);
let spot = null;
for (let r = 0; r < 14 && !spot; r++)
  for (let dy = -r; dy <= r && !spot; dy++)
    for (let dx = -r; dx <= r && !spot; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= W) continue;
      if (lvl0.tiles[y * W + x] === TILE.FLOOR && !covered(x, y)) spot = { x, y, z };
    }

if (!spot) {
  console.log("  (no free floor tile near the view — skipping; not a failure)");
  df.client.quit();
  process.exit(0);
}
console.log(`  target floor tile: (${spot.x},${spot.y},${spot.z})`);

await df.build("c_wall", [spot]);
const lvl1 = await df.level(z);
const placed = lvl1.buildings.find((b) => spot.x >= b.x0 && spot.x <= b.x1 && spot.y >= b.y0 && spot.y <= b.y1);
ok(!!placed, `a building now covers the tile (${placed ? `bt=${placed.bt}` : "none"})`);

// Clean up so we leave the fort exactly as we found it.
await df.client.call("RunCommand", {
  command: "lua",
  arguments: [`local b=dfhack.buildings.findAtTile(${spot.x},${spot.y},${spot.z}) if b then print('dfplex test cleanup '..tostring(dfhack.buildings.deconstruct(b))) end`],
});
const lvl2 = await df.level(z);
const stillThere = lvl2.buildings.some((b) => spot.x >= b.x0 && spot.x <= b.x1 && spot.y >= b.y0 && spot.y <= b.y1);
ok(!stillThere, "test building cleaned up (fort untouched)");

df.client.quit();
console.log(fail ? `\n${fail} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
process.exit(fail ? 1 : 0);
