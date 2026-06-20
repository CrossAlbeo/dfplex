// Regression test for the "first user chats as ?" bug.
//
// The client sends its `join` as the very first frame on socket open. The bridge used to attach its
// message listener only *after* `await df.connect()`, so on a live DF connection that join landed in
// the async setup gap and was lost — the peer stayed nick-less and its chat came through attributed
// to "?". The mock smoke test never caught it because mock mode has no await gap.
//
// This test recreates the gap deterministically with DFPLEX_SETUP_DELAY_MS (still in mock mode, no
// DF needed): each client fires its join immediately on open — inside the delay window — then chats
// only after the window has closed. If joins are dropped, the chat is attributed "?" and no join
// notice/roster appears; with the fix (listener attached synchronously) the join always registers.
// Node >= 22 (global WebSocket). Usage: node bridge/test/chat-join-race.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const bridgePath = resolve(here, "../bridge.mjs");
const PORT = 8100;
const WS_URL = `ws://localhost:${PORT}/ws`;
const SETUP_DELAY_MS = 150; // bridge stalls this long before its source is ready — the danger window

let fail = 0;
const ok = (c, m) => (c ? console.log("  ok  -", m) : (console.error("  FAIL-", m), fail++));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(process.execPath, [bridgePath], {
  env: { ...process.env, PORT: String(PORT), DFPLEX_SOURCE: "mock", DFPLEX_SETUP_DELAY_MS: String(SETUP_DELAY_MS) },
  stdio: ["ignore", "pipe", "pipe"],
});

const hardTimer = setTimeout(() => {
  console.error("  FAIL- timed out waiting for the scenario");
  fail++;
  finish();
}, 9000);

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
  // Fire the join the instant the socket opens — i.e. while the bridge is still in its setup delay.
  ws.addEventListener("open", () => ws.send(JSON.stringify({ type: "join", nick })), { once: true });
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
  await Promise.all([open(A.ws), open(B.ws)]); // joins are sent here, inside the setup-delay window

  await wait(SETUP_DELAY_MS + 200); // let the window close and the sources come up
  A.ws.send(JSON.stringify({ type: "chat", text: "joined before the source was ready" }));
  await wait(300);

  const line = B.got.chats.find((m) => m.kind === "user" && m.text === "joined before the source was ready");
  ok(line, "B received A's chat");
  ok(line && line.from === "Alice", `chat attributed to Alice, not "?" (got from=${line?.from})`);
  ok(!B.got.chats.some((m) => m.kind === "user" && m.from === "?"), 'no chat is attributed to "?"');
  ok(B.got.chats.some((m) => m.kind === "system" && /Alice joined/.test(m.text)), "join notice for Alice survived the gap");

  const pres = B.got.presence.at(-1);
  const nicks = (pres?.list || []).map((p) => p.nick).sort();
  ok(nicks.length === 2 && nicks[0] === "Alice" && nicks[1] === "Bob", `roster shows both nicks (${nicks.join(",")})`);

  try {
    A.ws.close();
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
