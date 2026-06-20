// Routing test (no DF): a C2S {op:"build"} command must reach df.build with the palette kind and
// the placement tiles, then re-stream the mutated z; {op:"designate"} must still reach df.designate.
// Drives RFRSource with a stub DFAccess that records calls. Usage: node bridge/test/build-route.mjs
import { RFRSource } from "../rfr-source.mjs";

let fail = 0;
const ok = (c, m) => (c ? console.log("  ok  -", m) : (console.error("  FAIL-", m), fail++));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const calls = { build: [], designate: [], level: [] };
const stubDf = {
  dims: { xCount: 48, yCount: 48, zCount: 5 },
  async mapInfo() {},
  async view() {
    return { x: 0, y: 0, z: 2, w: 10, h: 10 };
  },
  async level(z) {
    calls.level.push(z);
    return { z, w: 48, h: 48, tiles: [], hash: z, desig: [], buildings: [] };
  },
  async units() {
    return [];
  },
  async build(kind, tiles) {
    calls.build.push({ kind, tiles });
  },
  async designate(kind, tiles) {
    calls.designate.push({ kind, tiles });
  },
};

const src = new RFRSource(stubDf, { pollMs: 100000 }); // effectively no polling
src.onMessage(() => {});
await src.start();
calls.level.length = 0; // ignore the start-time streams

src.send({ type: "command", op: "build", kind: "c_wall", tiles: [{ x: 5, y: 6, z: 2 }, { x: 7, y: 8, z: 2 }] });
await wait(50);
ok(calls.build.length === 1, `df.build called once (${calls.build.length})`);
ok(calls.build[0]?.kind === "c_wall", `build kind forwarded (${calls.build[0]?.kind})`);
ok(calls.build[0]?.tiles?.length === 2, `build tiles forwarded (${calls.build[0]?.tiles?.length})`);
ok(calls.level.includes(2), "z=2 re-streamed after build");

src.send({ type: "command", op: "designate", kind: "dig", tiles: [{ x: 1, y: 1, z: 2 }] });
await wait(50);
ok(calls.designate.length === 1, "df.designate still routes");
ok(calls.build.length === 1, "designate did not trigger a build");

src.stop();
console.log(fail ? `\n${fail} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
process.exit(fail ? 1 : 0);
