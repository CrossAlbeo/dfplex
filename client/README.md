# dfplex web client (DF 53.x)

The rewritten browser client for dfplex. It renders the fortress **itself** from a stream of
state messages (see [`../docs/protocol.md`](../docs/protocol.md)) rather than mirroring DF's
screen. Each browser owns its own camera, z-level, and cursor — independent views come for free.

The client is decoupled from where its data comes from via a **data source**:

- `MockSource` — a fake fortress generated in-browser. No server, no DF needed. For UI dev/testing.
- `WebSocketSource` — a live feed from the RFR bridge or the dfplex plugin (added later).

## Test it (no toolchain, no DF required)

A zero-dependency static dev server is included (Node only):

```bash
node client/serve.mjs        # serves on http://localhost:8080
```

Then open <http://localhost:8080> and select **Mock** as the source. You should see a small
multi-z fortress with wandering units. Controls:

- **Drag** / arrow keys / WASD — pan
- **Mouse wheel** — zoom
- **Q / E** or **PageUp / PageDown** — change z-level
- Hover — tile cursor + coordinates in the HUD

## Headless sanity check

The core logic (protocol, mock generator, world model) runs in Node too:

```bash
node client/test/smoke.mjs
```
