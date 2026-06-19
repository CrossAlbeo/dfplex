# dfplex bridge

A small Node service that sits between the web client and Dwarf Fortress. It serves the client
(static files) and a WebSocket endpoint at `/ws` on one port, translating live fortress state
into the [dfplex protocol](../docs/protocol.md).

**Status:** reads the **live** fortress from DFHack's **RemoteFortressReader** (TCP
`127.0.0.1:5000`) and streams it to the browser. If DF isn't reachable, each connection falls
back to the in-browser `MockSource` so the bridge still runs. Force the mock with
`DFPLEX_SOURCE=mock`.

## Run

```bash
cd bridge
npm install        # once: installs ws + protobufjs
npm start          # serves http://localhost:8080 and ws://localhost:8080/ws
```

Start DF with a fortress loaded and DFHack's RemoteFortressReader enabled, then open
<http://localhost:8080>, choose **WebSocket** as the source, and Connect. The browser opens on
DF's current view and renders your actual fort. `DF_HOST` / `DF_PORT` override where the bridge
looks for DFHack (default `127.0.0.1:5000`).

## How it works

```
DF + RemoteFortressReader (TCP 5000)
  -> dfhack/connection.mjs   handshake + RPC framing
  -> dfhack/client.mjs       protobuf bind/call (protos vendored from DFHack 53.14-r2)
  -> dfhack/df-access.mjs    translate tiletypes -> TILE shape codes, plus units + view
  -> rfr-source.mjs          per-connection stream: hello / map / units / tick
  -> bridge.mjs              WebSocket to the browser
```

`dfhack/protos/` is vendored from the DFHack repo by `dfhack/fetch-protos.mjs` (re-run to
refresh). `dfhack/probe.mjs`, `test-call.mjs`, and `explore.mjs` are live diagnostics.

## Test

```bash
npm start                 # in one terminal
npm test                  # ws smoke: asserts hello/map/units arrive over the WebSocket

node test/rfr-smoke.mjs   # live RFR path: DFAccess -> RFRSource -> protocol (needs DF up)
node dfhack/probe.mjs     # just the DFHack handshake
```
