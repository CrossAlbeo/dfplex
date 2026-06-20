// Live centering check (needs DF on RFR :5000): proves the bridge now CENTERS a multi-tile building
// on the clicked tile instead of anchoring its top-left corner there. df-access.build() offsets the
// constructBuilding corner by getCorrectSize's center offset, so this exercises the whole path end to
// end — palette -> generated Lua -> getCorrectSize -> constructBuilding -> RFR footprint readback.
//
// It places a 3x3 Mason's workshop and a 5x5 trade depot on an unoccupied tile in the current view,
// reads the footprint back, asserts its centre tile equals the click, then deconstructs. Several
// candidate tiles are tried so one obstructed spot (tree/unit/water) doesn't fail the run.
//   Usage: node bridge/test/build-center-live.mjs
import { DFAccess } from "../dfhack/df-access.mjs";

const df = new DFAccess({
  host: process.env.DF_HOST || "127.0.0.1",
  port: Number(process.env.DF_PORT) || 5000,
});

const findAt = (lvl, x, y) =>
  lvl.buildings.find((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1);

// Remove whatever building covers (x,y,z) — an unconstructed placement cancels immediately.
async function decon(x, y, z) {
  await df.client.call("RunCommand", {
    command: "lua",
    arguments: [
      `local b=dfhack.buildings.findAtTile(${x | 0},${y | 0},${z | 0}) if b then dfhack.buildings.deconstruct(b) end`,
    ],
  });
}

await df.connect();
await df.mapInfo();
const v = await df.view();
const z = v.z;

// Candidate click tiles: an interior grid of the viewport (skip the edges so a centred footprint
// still lands fully on-map). Drop any tile already covered by a building so we never mistake a
// pre-existing one for our placement.
const cands = [];
for (let dy = 5; dy < v.h - 5; dy += 4)
  for (let dx = 5; dx < v.w - 5; dx += 4) cands.push({ x: v.x + dx, y: v.y + dy, z });
const lvl0 = await df.level(z);
const empty = cands.filter((c) => !findAt(lvl0, c.x, c.y));
console.log(
  `view (${v.x},${v.y},${v.z}) ${v.w}x${v.h}; ${empty.length}/${cands.length} candidate tiles free; centering check:`
);

async function check(kind, label, side) {
  for (const click of empty) {
    await df.build(kind, [click]);
    const lvl = await df.level(z);
    const b = findAt(lvl, click.x, click.y);
    if (!b) continue; // nothing placed here (obstructed) — try the next candidate
    const w = b.x1 - b.x0 + 1;
    const h = b.y1 - b.y0 + 1;
    const cx = Math.floor((b.x0 + b.x1) / 2);
    const cy = Math.floor((b.y0 + b.y1) / 2);
    const centered = cx === click.x && cy === click.y;
    await decon(click.x, click.y, z);
    const ok = w === side && h === side && centered;
    console.log(
      `  ${ok ? "ok  " : "FAIL"} ${label}: click (${click.x},${click.y}) -> ${w}x${h} ` +
        `corner (${b.x0},${b.y0}) center (${cx},${cy}) ${centered ? "= click" : "!= CLICK"}`
    );
    return ok;
  }
  console.log(`  skip ${label}: no placeable tile in the view (all ${empty.length} obstructed)`);
  return null;
}

const results = [];
results.push(await check("w_mason", "Mason's workshop", 3));
results.push(await check("depot", "Trade depot", 5));
df.client.quit();

const passed = results.filter((r) => r === true).length;
const failed = results.filter((r) => r === false).length;
const skipped = results.filter((r) => r === null).length;
console.log(`build-center-live: ${passed} passed, ${failed} failed, ${skipped} skipped`);
process.exit(failed ? 1 : 0);
