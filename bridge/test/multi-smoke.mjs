// Two simultaneous WebSocket clients on different z-levels. Verifies independent per-connection
// views AND that the shared DFHack connection's serialized RPCs don't corrupt under concurrency.
// Requires the bridge running against live DF. Usage: node bridge/test/multi-smoke.mjs
const url = process.env.WS || "ws://localhost:8080/ws";

function client(name, wantZ) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const got = { hello: null, mapZ: new Set(), units: 0, errors: [] };
    ws.onmessage = (e) => {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.type === "hello") {
        got.hello = m;
        ws.send(JSON.stringify({ type: "viewport", z: wantZ, min: { x: 0, y: 0 }, max: { x: 1, y: 1 } }));
      } else if (m.type === "map") got.mapZ.add(m.z);
      else if (m.type === "units") got.units++;
      else if (m.type === "error") got.errors.push(m.message);
    };
    ws.onerror = () => got.errors.push("ws error");
    setTimeout(() => {
      try {
        ws.close();
      } catch {}
      resolve({ name, wantZ, got });
    }, 2500);
  });
}

const [a, b] = await Promise.all([client("A", 158), client("B", 140)]);
let fail = 0;
const ok = (c, m) => (c ? console.log("  ok  -", m) : (console.error("  FAIL-", m), fail++));
for (const c of [a, b]) {
  ok(c.got.hello, `${c.name}: received hello`);
  ok(c.got.mapZ.has(c.wantZ), `${c.name}: got map for its own z=${c.wantZ} (levels seen: ${[...c.got.mapZ].join(",")})`);
  ok(c.got.units >= 1, `${c.name}: received units`);
  ok(c.got.errors.length === 0, `${c.name}: no errors${c.got.errors.length ? " — " + c.got.errors.join("; ") : ""}`);
}
console.log(fail ? `\n${fail} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
process.exit(fail ? 1 : 0);
