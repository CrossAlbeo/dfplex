// Read-path smoke test for buildings (Phase 4). Spawns a fresh bridge in mock mode on a private
// port, connects one WebSocket client, and verifies the client receives a `buildings` message
// carrying the mock's building footprints — i.e. the protocol enum + source emit + ws plumbing all
// line up. Needs no DF. Node >= 22 (global WebSocket). Usage: node bridge/test/buildings-smoke.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const bridgePath = resolve(here, "../bridge.mjs");
const PORT = 8101;
const WS_URL = `ws://localhost:${PORT}/ws`;

let fail = 0;
const ok = (c, m) => (c ? console.log("  ok  -", m) : (console.error("  FAIL-", m), fail++));

const child = spawn(process.execPath, [bridgePath], {
  env: { ...process.env, PORT: String(PORT), DFPLEX_SOURCE: "mock" },
  stdio: ["ignore", "pipe", "pipe"],
});

const hardTimer = setTimeout(() => {
  console.error("  FAIL- timed out waiting for the scenario");
  fail++;
  finish();
}, 8000);

let started = false;
child.stdout.on("data", (buf) => {
  if (!started && buf.toString().includes("dfplex bridge")) {
    started = true;
    run().catch((e) => {
      console.error("  FAIL-", e.message);
      fail++;
      finish();
    });
  }
});
child.stderr.on("data", () => {});
child.on("exit", (code) => {
  if (!started) {
    console.error(`  FAIL- bridge exited before it was ready (code ${code})`);
    process.exit(1);
  }
});

function run() {
  return new Promise((res, rej) => {
    const ws = new WebSocket(WS_URL);
    const got = [];
    ws.addEventListener("error", () => rej(new Error("ws connect error")), { once: true });
    ws.addEventListener("open", () => ws.send(JSON.stringify({ type: "join", nick: "Reader" })));
    ws.addEventListener("message", (e) => {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      got.push(m);
    });
    setTimeout(() => {
      const bmsgs = got.filter((m) => m.type === "buildings");
      ok(got.some((m) => m.type === "hello"), "received hello");
      ok(got.some((m) => m.type === "map"), "received at least one map");
      ok(bmsgs.length > 0, `received a buildings message (${bmsgs.length})`);
      const all = bmsgs.flatMap((m) => m.list || []);
      ok(all.length > 0, `buildings list is non-empty (${all.length} total)`);
      const b = all[0];
      ok(
        b &&
          ["x0", "y0", "x1", "y1", "bt"].every((k) => Number.isFinite(b[k])),
        `a building has rectangle + type fields (${JSON.stringify(b)})`
      );
      try {
        ws.close();
      } catch {}
      res();
      finish();
    }, 600);
  });
}

function finish() {
  clearTimeout(hardTimer);
  try {
    child.kill();
  } catch {}
  console.log(fail ? `\n${fail} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
  process.exit(fail ? 1 : 0);
}
