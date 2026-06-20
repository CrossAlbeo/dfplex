// Live category probe (needs DF). Verifies the step-4 palette actually places: for one
// representative of each build category it runs the real df.build() path (RunCommand -> lua
// constructBuilding), reads the level back to confirm a building of the expected building_type now
// covers the anchor, checks that multi-tile buildings (3x3 workshop/furnace, 5x5 depot) auto-sized,
// then deconstructs each so the fort is left exactly as found. Per-kind pass/fail is reported; a
// kind that can't place (e.g. needs more space) is flagged, not crashed on.
//   Usage: node bridge/test/build-categories-live.mjs
import { DFAccess } from "../dfhack/df-access.mjs";
import { TILE } from "../../client/js/protocol.js";

const df = new DFAccess({
  host: process.env.DF_HOST || "127.0.0.1",
  port: Number(process.env.DF_PORT) || 5000,
});

// One representative per category: kind, expected building_type number, min footprint side.
const REPS = [
  { cat: "Construction",     kind: "c_wall",        bt: 34, side: 1 },
  { cat: "Doors & hatches",  kind: "d_door",        bt: 8,  side: 1 },
  { cat: "Workshops",        kind: "w_mason",       bt: 13, side: 3 },
  { cat: "Furnaces",         kind: "f_smelter",     bt: 5,  side: 3 },
  { cat: "Furniture",        kind: "fu_bed",        bt: 1,  side: 1 },
  { cat: "Machines & fluids",kind: "m_gear",        bt: 40, side: 1 },
  { cat: "Cages & restraints",kind: "cg_cage",      bt: 28, side: 1 },
  { cat: "Traps & levers",   kind: "t_lever",       bt: 23, side: 1 },
  { cat: "Military",         kind: "mil_weaponrack",bt: 11, side: 1 },
  { cat: "Trade depot",      kind: "depot",         bt: 6,  side: 5 },
];

const findAt = (lvl, x, y) =>
  lvl.buildings.find((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1);

async function deconstructAt(x, y, z) {
  await df.client.call("RunCommand", {
    command: "lua",
    arguments: [
      `local b=dfhack.buildings.findAtTile(${x},${y},${z}) if b then dfhack.buildings.deconstruct(b) end`,
    ],
  });
}

await df.connect();
await df.mapInfo();
const v = await df.view();
const W = df.dims.xCount;
const z = v.z;
const cx = v.x + (v.w >> 1);
const cy = v.y + (v.h >> 1);

// Find an anchor whose surrounding square (up to 5x5) is all FLOOR and unbuilt, so even the depot
// fits. Prefer the largest clear square near the view centre.
const lvl0 = await df.level(z);
const isClear = (x, y) =>
  x >= 0 && y >= 0 && x < W && lvl0.tiles[y * W + x] === TILE.FLOOR && !findAt(lvl0, x, y);
const clearRadius = (x, y) => {
  for (let r = 0; r <= 2; r++) {
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) if (!isClear(x + dx, y + dy)) return r - 1;
  }
  return 2;
};
// Scan the whole z-level for the largest clear square, preferring ones nearer the view centre.
// Early-exit as soon as a 5x5 (clearRadius 2) is found — that fits every representative.
const H = df.dims.yCount;
let anchor = null;
let best = -1;
let bestDist = Infinity;
outer: for (let y = 2; y < H - 2; y++)
  for (let x = 2; x < W - 2; x++) {
    if (!isClear(x, y)) continue;
    const cr = clearRadius(x, y);
    const dist = Math.abs(x - cx) + Math.abs(y - cy);
    if (cr > best || (cr === best && dist < bestDist)) {
      best = cr;
      bestDist = dist;
      anchor = { x, y, z };
      if (best >= 2) break outer;
    }
  }

if (!anchor) {
  console.log("  (no clear floor near the view — run with the camera over open dug-out floor)");
  df.client.quit();
  process.exit(0);
}
const maxSide = best * 2 + 1; // 1, 3, or 5
console.log(`  anchor (${anchor.x},${anchor.y},${anchor.z}), clear square up to ${maxSide}x${maxSide}\n`);

let fail = 0;
let skipped = 0;
for (const rep of REPS) {
  if (rep.side > maxSide) {
    console.log(`  skip  - ${rep.cat} (${rep.kind}): needs ${rep.side}x${rep.side}, only ${maxSide}x${maxSide} clear`);
    skipped++;
    continue;
  }
  try {
    await df.build(rep.kind, [anchor]);
    const lvl = await df.level(z);
    const b = findAt(lvl, anchor.x, anchor.y);
    if (!b) {
      console.log(`  FAIL  - ${rep.cat} (${rep.kind}): nothing placed`);
      fail++;
      continue;
    }
    const w = b.x1 - b.x0 + 1;
    const h = b.y1 - b.y0 + 1;
    const btOk = b.bt === rep.bt;
    const sizeOk = w >= rep.side && h >= rep.side;
    if (btOk && sizeOk) {
      console.log(`  ok    - ${rep.cat} (${rep.kind}): bt=${b.bt} ${w}x${h}`);
    } else {
      console.log(`  FAIL  - ${rep.cat} (${rep.kind}): bt=${b.bt} (want ${rep.bt}) ${w}x${h} (want >=${rep.side})`);
      fail++;
    }
    await deconstructAt(anchor.x, anchor.y, z);
  } catch (e) {
    console.log(`  FAIL  - ${rep.cat} (${rep.kind}): ${e.message}`);
    fail++;
    await deconstructAt(anchor.x, anchor.y, z).catch(() => {});
  }
}

// Final safety sweep: make sure nothing the probe placed is left at the anchor.
await deconstructAt(anchor.x, anchor.y, z);
const lvlEnd = await df.level(z);
const leftover = findAt(lvlEnd, anchor.x, anchor.y);
console.log(`\n  cleanup: anchor ${leftover ? `STILL has bt=${leftover.bt}` : "clear"}`);

df.client.quit();
console.log(
  fail ? `\n${fail} FAILED, ${skipped} skipped` : `\nALL PLACED (${REPS.length - skipped} categories, ${skipped} skipped)`
);
process.exit(fail ? 1 : 0);
