// Headless check of the live RFR path: DFAccess -> RFRSource -> protocol messages.
// Requires DF running with a fortress loaded and DFHack remote on 127.0.0.1:5000.
// Usage: node bridge/test/rfr-smoke.mjs
import { DFAccess } from "../dfhack/df-access.mjs";
import { RFRSource } from "../rfr-source.mjs";
import { TILE } from "../../client/js/protocol.js";

const df = new DFAccess({
  host: process.env.DF_HOST || "127.0.0.1",
  port: Number(process.env.DF_PORT) || 5000,
});

const seen = { hello: null, map: [], units: null, desig: null, tick: 0, error: [] };
const source = new RFRSource(df, { pollMs: 400 });
source.onMessage((m) => {
  if (m.type === "hello") seen.hello = m;
  else if (m.type === "map") seen.map.push(m);
  else if (m.type === "units") seen.units = m;
  else if (m.type === "desig") seen.desig = m;
  else if (m.type === "tick") seen.tick++;
  else if (m.type === "error") seen.error.push(m.message);
});

try {
  await source.start();
} catch (e) {
  console.error("  FAIL- start threw:", e.message);
  process.exit(1);
}
await new Promise((r) => setTimeout(r, 1100)); // let ~2 poll cycles run
source.stop();

let fail = 0;
const ok = (c, m) => (c ? console.log("  ok  -", m) : (console.error("  FAIL-", m), fail++));

ok(seen.hello, "received hello");
if (seen.hello) {
  const d = seen.hello.map;
  ok(d.xCount > 0 && d.yCount > 0 && d.zCount > 0, `hello map dims ${d.xCount}x${d.yCount}x${d.zCount}, zSurface=${d.zSurface}`);
}

ok(seen.map.length >= 1, `received ${seen.map.length} map message(s)`);
if (seen.map.length) {
  const m = seen.map[0];
  ok(m.tiles.length === m.w * m.h, `map tiles length ${m.tiles.length} == w*h (${m.w}x${m.h})`);
  let nonEmpty = 0, floor = 0, wall = 0;
  for (const t of m.tiles) {
    if (t !== TILE.EMPTY) nonEmpty++;
    if (t === TILE.FLOOR) floor++;
    if (t === TILE.WALL) wall++;
  }
  ok(nonEmpty > 1000, `map has real terrain (${nonEmpty} non-empty, ${floor} floor, ${wall} wall)`);
}

ok(seen.units && Array.isArray(seen.units.list), `received units (${seen.units ? seen.units.list.length : 0})`);
ok(seen.desig && Array.isArray(seen.desig.list), `received desig (${seen.desig ? seen.desig.list.length : 0} designations)`);
ok(seen.tick >= 1, `received ${seen.tick} tick(s)`);
ok(seen.error.length === 0, seen.error.length ? `errors: ${seen.error.join("; ")}` : "no errors");

console.log(fail ? `\n${fail} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
process.exit(fail ? 1 : 0);
