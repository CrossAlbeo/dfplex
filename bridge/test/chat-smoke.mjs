// Self-contained integration test for Phase 3 chat/presence. Spawns a fresh bridge in mock mode
// on a private port, connects two WebSocket clients, and verifies that a line from one reaches the
// other (attributed) plus a live 2-then-1 roster as clients join and leave. Needs no DF and no
// already-running bridge. Node >= 22 (global WebSocket). Usage: node bridge/test/chat-smoke.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const bridgePath = resolve(here, "../bridge.mjs");
const PORT = 8099;
const WS_URL = `ws://localhost:${PORT}/ws`;

let fail = 0;
const ok = (c, m) => (c ? console.log("  ok  -", m) : (console.error("  FAIL-", m), fail++));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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
child.stderr.on("data", () => {}); // bridge warnings are noise here
child.on("exit", (code) => {
  if (!started) {
    console.error(`  FAIL- bridge exited before it was ready (code ${code})`);
    process.exit(1);
  }
});

function mkClient(nick) {
  const ws = new WebSocket(WS_URL);
  const got = { chats: [], presence: [] };
  ws.addEventListener("message", (e) => {
    let m;
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }
    if (m.type === "chat") got.chats.push(m);
    else if (m.type === "presence") got.presence.push(m);
  });
  return { ws, got, nick };
}

function open(ws) {
  return new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", () => rej(new Error("ws connect error")), { once: true });
  });
}

async function run() {
  const A = mkClient("Alice");
  const B = mkClient("Bob");
  await Promise.all([open(A.ws), open(B.ws)]);

  A.ws.send(JSON.stringify({ type: "join", nick: A.nick }));
  B.ws.send(JSON.stringify({ type: "join", nick: B.nick }));
  await wait(250);

  A.ws.send(JSON.stringify({ type: "chat", text: "stairs down here" }));
  await wait(300);

  const line = B.got.chats.find((m) => m.kind === "user" && m.text === "stairs down here");
  ok(line && line.from === "Alice", `B received A's chat, attributed to Alice (got from=${line?.from})`);
  ok(B.got.chats.some((m) => m.kind === "system" && /joined/.test(m.text)), "B saw a join notice");
  const pres = B.got.presence.at(-1);
  ok(pres && pres.list.length === 2, `roster shows 2 (${pres?.list.map((p) => p.nick).join(",")})`);

  A.ws.close(); // A leaves -> B's roster drops to 1 and a "left" notice arrives
  await wait(350);
  const after = B.got.presence.at(-1);
  ok(after && after.list.length === 1, `roster shows 1 after A leaves (${after?.list.length})`);
  ok(B.got.chats.some((m) => m.kind === "system" && /left/.test(m.text)), "B saw a leave notice");

  try {
    B.ws.close();
  } catch {}
  finish();
}

function finish() {
  clearTimeout(hardTimer);
  try {
    child.kill();
  } catch {}
  console.log(fail ? `\n${fail} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
  process.exit(fail ? 1 : 0);
}
