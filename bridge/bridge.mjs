// dfplex dev bridge.
//
// Serves the web client (static files) AND a WebSocket endpoint at /ws on one port, so the
// browser can connect same-origin. Each WebSocket connection is fed by an RFRSource that reads
// the live fortress from a running DF via DFHack's RemoteFortressReader (shared DFAccess /
// DFHack socket). If DF isn't reachable, the connection falls back to the in-browser MockSource
// so the bridge still runs without DF. Force mock with DFPLEX_SOURCE=mock.
//
// Usage: node bridge/bridge.mjs   (then open http://localhost:8080, choose "WebSocket")
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { MockSource } from "../client/js/mock.js";
import { DFAccess } from "./dfhack/df-access.mjs";
import { RFRSource } from "./rfr-source.mjs";

const CLIENT_ROOT = resolve(fileURLToPath(new URL("../client/", import.meta.url)));
const PORT = Number(process.env.PORT) || 8080;
const SEP = process.platform === "win32" ? "\\" : "/";

// One shared DF connection backs every browser; DFHackClient serializes the actual RPCs.
const df = new DFAccess({
  host: process.env.DF_HOST || "127.0.0.1",
  port: Number(process.env.DF_PORT) || 5000,
});
const forceMock = process.env.DFPLEX_SOURCE === "mock";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

// --- static file serving (mirrors client/serve.mjs, rooted at the client dir) ---
const httpServer = http.createServer(async (req, res) => {
  try {
    let pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (pathname === "/" || pathname === "") pathname = "/index.html";
    const filePath = normalize(join(CLIENT_ROOT, pathname));
    if (filePath !== CLIENT_ROOT && !filePath.startsWith(CLIENT_ROOT + SEP)) {
      res.writeHead(403);
      return res.end("forbidden");
    }
    const data = await readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME[extname(filePath)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});

// --- WebSocket endpoint at /ws ---
const wss = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url, "http://localhost");
  if (pathname === "/ws") {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  } else {
    socket.destroy();
  }
});

wss.on("connection", async (ws) => {
  // One independent data source per client — exactly the multiplayer model.
  let source = null;
  if (!forceMock) {
    try {
      await df.connect(); // confirm DF is reachable before committing this client to RFR
      source = new RFRSource(df);
    } catch (e) {
      console.warn(`[bridge] DF unreachable (${e.message}); using mock for this client`);
    }
  }
  if (!source) source = new MockSource({ tickMs: 120 });

  const unsub = source.onMessage((msg) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  });

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    source.send(msg); // join / viewport (command lands in Phase 2)
  });

  ws.on("close", () => {
    source.stop();
    unsub();
  });

  Promise.resolve(source.start()).catch((e) => {
    console.warn(`[bridge] source.start failed: ${e.message}`);
    try {
      ws.send(JSON.stringify({ type: "error", message: String(e.message || e) }));
    } catch {
      /* socket gone */
    }
  });
});

httpServer.listen(PORT, () => {
  const mode = forceMock ? "mock (forced)" : `RFR @ ${df.opts.host}:${df.opts.port}, mock fallback`;
  console.log(`dfplex bridge [${mode}]: http://localhost:${PORT}  ·  ws://localhost:${PORT}/ws`);
});
