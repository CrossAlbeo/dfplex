# dfplex client protocol (DF 53.x rewrite)

This is the message contract between a **data source** and the **web client** for the
post-0.47 dfplex architecture (see `../README.md` and the plan). The same contract is
implemented by every data source, so the client never knows or cares which one it is talking to:

- **`MockSource`** — generates a fake fortress in-browser (no server). Used for client dev/testing.
- **`WebSocketSource`** — connects to a server over WebSocket (the RFR bridge, later the plugin).

Transport is JSON messages (one object per message). We may switch to a binary/delta encoding
later for the map payload; until then JSON keeps the contract legible while the renderer matures.

Every message is `{ "type": "<name>", ... }`.

## Server → client

### `hello`
Sent once on connect. Establishes protocol version, map dimensions, and the client's identity.
`start` is optional: where the client should open its camera (the live source sends DF's own
view center so the browser shows the fortress; the mock omits it and the client uses map center).
```jsonc
{
  "type": "hello",
  "protocol": "dfplex2",
  "server": "mock|rfr-bridge|plugin",
  "you":   { "id": "c3", "nick": "Urist" },
  "map":   { "xCount": 48, "yCount": 48, "zCount": 5, "zSurface": 3 },
  "start": { "x": 97, "y": 126, "z": 158 }   // optional camera focus
}
```

### `map`
A rectangular block of tiles for a single z-level. The client assembles these into per-z grids.
`tiles` is row-major (`length === w*h`); each entry is a **shape code** (see `TILE` below).
`mats` is an optional parallel array of material-color hints (palette index, or `-1` for default).
```jsonc
{
  "type": "map",
  "z": 3,
  "origin": { "x": 0, "y": 0 },
  "w": 48, "h": 48,
  "tiles": [ 2, 2, 1, 1, 0, ... ],
  "mats":  [ -1, -1, 4, 4, -1, ... ]   // optional
}
```

### `units`
The full set of visible units (mock/early bridge send the whole list; later we diff).
```jsonc
{
  "type": "units",
  "list": [
    { "id": 101, "x": 10, "y": 12, "z": 3, "name": "Urist McMiner", "ch": "☺", "color": 14 }
  ]
}
```

### `desig`
Sparse list of dig designations on a z-level (`d` is the designation kind: 1=dig, 2=updown
stair, 3=channel, 4=ramp, 5=down stair, 6=up stair). Sent per active z each tick, so user
designations and dwarves finishing a dig both show up. The client draws these as marks.
```jsonc
{ "type": "desig", "z": 3, "list": [ { "x": 10, "y": 12, "d": 1 } ] }
```

### `tick`
Heartbeat / animation pulse. Lets the client show liveness and drive non-rAF animation.
```jsonc
{ "type": "tick", "frame": 12345, "fps": 50 }
```

### `chat`  *(Phase 3)*
```jsonc
{ "type": "chat", "from": "Urist", "color": 14, "text": "dig here" }
```

### `error`
```jsonc
{ "type": "error", "message": "..." }
```

## Client → server

The mock ignores most of these; the bridge/plugin act on them.

### `join`
```jsonc
{ "type": "join", "nick": "Urist" }
```

### `viewport`
Tells the server what area/z this client is looking at, so reads can be scoped to it.
This is per-client and is the mechanism behind independent views.
```jsonc
{ "type": "viewport", "z": 3, "min": { "x": 0, "y": 0 }, "max": { "x": 47, "y": 47 } }
```

### `command`  *(Phase 2+)*
Mutates game state. `op` selects the handler; remaining fields are op-specific.
```jsonc
{ "type": "command", "op": "designate", "kind": "dig",
  "tiles": [ { "x": 10, "y": 12, "z": 3 } ] }
```

## `TILE` shape codes

The client owns the visual mapping (shape → glyph + colors) in `tiledict.js`. Data sources emit
shape codes, not DF tiletype ids, so the renderer is decoupled from DF internals. The RFR bridge
will translate DF tiletypes → these shapes.

| code | name          | code | name          |
|------|---------------|------|---------------|
| 0    | EMPTY (air)   | 7    | WATER         |
| 1    | FLOOR         | 8    | MAGMA         |
| 2    | WALL          | 9    | TREE          |
| 3    | RAMP_UP       | 10   | SHRUB         |
| 4    | RAMP_DOWN     | 11   | BOULDER       |
| 5    | STAIR_UP      | 12   | GRASS         |
| 6    | STAIR_DOWN    | 13   | STAIR_UPDOWN  |

Colors are palette indices into the 16-color DF-style palette defined in `tiledict.js`.
