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

### `buildings`
Building footprints on a z-level, re-sent per active z each tick (like `desig`), so placements and
completions show up. Each entry is a rectangle (`x0,y0`–`x1,y1`) carrying the DF building
type/subtype (`bt`/`st`, raw enum ids — the client maps these to glyphs) and `active` (1 once
built/functional, 0 while placed/under construction). `i` is the DF building index (a stable id).
```jsonc
{ "type": "buildings", "z": 3, "list": [
  { "i": 7, "x0": 10, "y0": 12, "x1": 12, "y1": 14, "bt": 13, "st": 0, "active": 0 }
] }
```

### `tick`
Heartbeat / animation pulse. Lets the client show liveness and drive non-rAF animation.
```jsonc
{ "type": "tick", "frame": 12345, "fps": 50 }
```

### `chat`
A chat line broadcast to **every** connected client — the bridge's hub is the only cross-client
channel (the map/units feed stays per-connection). `kind` is `"user"` (a player line, carrying
`from`) or `"system"` (join/leave/rename notices, no `from`). `ts` is Unix-epoch milliseconds.
```jsonc
{ "type": "chat", "kind": "user", "from": "Urist", "text": "dig here", "ts": 1718900000000 }
{ "type": "chat", "kind": "system", "text": "Urist joined", "ts": 1718900000000 }
```

### `presence`
The current roster of joined clients, re-broadcast whenever someone joins, renames, or leaves.
Drives the "online" count/list in each client.
```jsonc
{ "type": "presence", "list": [ { "id": "c1", "nick": "Urist" }, { "id": "c2", "nick": "Cog" } ] }
```

### `stockpile`
Reply to a `stockpile-get` (and the echo after a `stockpile-set`): the clicked pile's current
category state, for the editor panel. `box` is the pile's bounding rectangle on its z-level
(`x0,y0`–`x1,y1`), or `null` when the clicked tile holds no stockpile. `cats` maps each of the 17
stockpile categories (`food`, `stone`, `wood`, `furniture`, …) to whether the pile currently
accepts it — read from the pile's per-category master flags.
```jsonc
{ "type": "stockpile",
  "box":  { "x0": 10, "y0": 12, "x1": 13, "y1": 15, "z": 3 },
  "cats": { "food": true, "stone": false, "wood": true } }
{ "type": "stockpile", "box": null }   // no pile under that tile
```

### `unit`
Reply to a `unit-get`: one unit's detail for the inspect panel. The server resolves the id with
`df.unit.find` and reads the human-readable fields DFHack exposes (the streamed `units` feed only
carries position + glyph). `info` is `null` when no unit has that id. `age` is whole years;
`stressCat` is DF's 0–6 happiness bucket (higher = more stressed); `job` is the current job token
(`Idle` when none); `wounds` is the wound count.
```jsonc
{ "type": "unit", "info": {
  "id": 16665, "name": "Hanarr \"Berryforges\", Miner", "profession": "Miner", "race": "DWARF",
  "age": 57, "citizen": true, "soldier": false, "dead": false,
  "stress": 0, "stressCat": 3, "job": "Idle", "wounds": 0 } }
{ "type": "unit", "info": null }   // no unit with that id
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
Mutates game state. `op` selects the handler; remaining fields are op-specific. `kind` is always a
**known key**, never free text — the server maps it to a trusted designation/building enum, so no
client-supplied string is ever interpolated into a DF command. `tiles` is a list of `{x,y,z}`.

`op: "designate"` — apply a designation. Dig kinds `kind` ∈ `dig`, `updownstair`, `channel`, `ramp`,
`downstair`, `upstair`, `remove` (clears the designation) go through RFR's `SendDigCommand`. Plant
kinds `chop` (trees) and `gather` (shrubs/crops) share this op but have no RFR designation, so the
server marks the plant under each tile via DFHack core Lua (`dfhack.designations.markPlant`),
classifying by the plant's raw `TREE` flag; the resulting `tile_dig_designation` streams back like
any other. All kinds are trusted server-side keys, never client free text.
```jsonc
{ "type": "command", "op": "designate", "kind": "dig",
  "tiles": [ { "x": 10, "y": 12, "z": 3 } ] }
```

`op: "build"` — place buildings. `kind` is a build-palette key from `buildings.js` (e.g. `c_wall`,
`w_mason`, `f_smelter`, `fu_bed`, `depot`); the server resolves it to a DF `building_type` (+ subtype,
+ direction) and calls `dfhack.buildings.constructBuilding` at each tile with no items, so DF derives
default material filters and dwarves haul matching stone/wood. Construction kinds (`c_*`) stamp one
building per tile across the dragged rectangle; every other kind places a single building per tile,
auto-sizing multi-tile footprints (3×3 workshop, 5×5 depot) outward from that anchor.
```jsonc
{ "type": "command", "op": "build", "kind": "w_mason",
  "tiles": [ { "x": 10, "y": 12, "z": 3 } ] }
```

`op: "stockpile"` — place one stockpile spanning the whole dragged rectangle. The server derives the
bounding box from `tiles`, builds a single abstract stockpile (`constructBuilding{abstract=true}`),
and enables the preset's categories. `kind` is a stockpile preset key from `stockpiles.js`: `sp_all`
(accept everything) or one per category (`sp_food`, `sp_stone`, `sp_wood`, …) — a trusted key, never
free text.
```jsonc
{ "type": "command", "op": "stockpile", "kind": "sp_food",
  "tiles": [ { "x": 10, "y": 12, "z": 3 }, { "x": 11, "y": 12, "z": 3 } ] }
```

`op: "stockpile-get"` — read the category state of the pile under a single `tile` (the editor's
hit-test). The server resolves the pile with `dfhack.buildings.findAtTile` (any interior tile works —
the streamed `buildings` record carries no DF id) and replies with a `stockpile` message.
```jsonc
{ "type": "command", "op": "stockpile-get", "tile": { "x": 10, "y": 12, "z": 3 } }
```

`op: "stockpile-set"` — toggle categories on the pile under `tile`. `cats` maps category keys to the
desired on/off state; the server filters to the 17 known keys (unknown keys are dropped, never
interpolated), writes each pile's per-category master flag, then re-reads and echoes a `stockpile`
message so the panel reflects ground truth.
```jsonc
{ "type": "command", "op": "stockpile-set", "tile": { "x": 10, "y": 12, "z": 3 },
  "cats": { "food": true, "stone": false } }
```

`op: "unit-get"` — read one unit's detail for the inspect panel. The client clicks a dwarf and hit-
tests the streamed `units` to get its `id`; the server resolves it with `df.unit.find(id)` (the id is
integer-coerced, the only client value that reaches the Lua) and replies with a `unit` message.
```jsonc
{ "type": "command", "op": "unit-get", "id": 16665 }
```

### `chat`  *(Phase 3)*
A line to broadcast to all clients. The server attributes it to this connection's nick and stamps
the time, so the client sends only the text.
```jsonc
{ "type": "chat", "text": "dig here" }
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
