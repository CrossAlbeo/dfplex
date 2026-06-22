---
name: dfplex-bridge
description: Recurring chores for the dfplex DF 53.x Node bridge in bridge/ — starting/restarting the dev bridge, running the offline vs live test tiers and probes, the probe→backend→test→client slice pattern, and the feature-branch git flow (branch, conventional commit, test-then-merge, --no-ff, separate push, delete branch). Use when building, running, testing, or committing bridge work.
---

# dfplex-bridge dev

Operational playbook for the active DF **0.47 → 53.x port**, which is the Node **bridge** in
`bridge/` — *not* the legacy C++ plugin in `server/`. Architecture is a headless state mirror: read
the live fortress over DFHack **RemoteFortressReader (RFR)** at TCP `127.0.0.1:5000`, stream it to the
browser over **WebSocket**, render client-side. There is no C++ toolchain here.

**Run node/git commands from the repo root** `D:\OneDrive\Code\dfplex`. Tests import by file path, so
cwd doesn't change results, but the examples below assume repo root. With the Bash tool, prefix with
`cd "D:/OneDrive/Code/dfplex" &&` (its cwd is not guaranteed to be `bridge/`).

## Start / restart the bridge

```
node bridge/bridge.mjs        # serves client + WS on http://localhost:8080  (ws at /ws)
```

- Reads live DF via RFR at `127.0.0.1:5000`; **falls back to mock per-connection** if DF is
  unreachable, so it runs without DF.
- Env knobs: `PORT` (8080), `DF_HOST`/`DF_PORT` (127.0.0.1/5000), `DFPLEX_SOURCE=mock` (force mock),
  `DFPLEX_SETUP_DELAY_MS` (simulate a slow DF connect, for race tests).
- It's a long-running server: launch it as a **background job**. No hot reload — after editing
  anything under `bridge/` (bridge.mjs, rfr-source.mjs, dfhack/*), **stop and relaunch** the job.
- Confirm it's up: `curl -s http://localhost:8080/ | head`. Browser test: open
  http://localhost:8080, choose **WebSocket**, Connect.

## Run tests

No aggregate runner (`npm test` runs only ws-smoke). Run files individually:
`node bridge/test/<name>.mjs`. Syntax-only check: `node --check <file>`.

**Tier 1 — offline suite (no DF, no running bridge). The always-runnable gate; run after any change:**

```
cd "D:/OneDrive/Code/dfplex" && for t in \
  designate-kinds chop-gather-route build-route stockpile-route stockpile-editor-route zone-route resize-route unit-route \
  designations buildings-unit stockpiles-unit resize-geom chat-hub chat-join-race buildings-smoke chat-smoke; do \
  echo "=== $t ==="; node "bridge/test/$t.mjs" 2>&1 | tail -2; done
```

(`*-route` / `designate-kinds` / `chop-gather-route` stub `df.client` and assert the right RPC + the
coord guard — `stockpile-route` also checks the server-side bbox math + per-category enable,
`stockpile-editor-route` the findAtTile read/write-by-tile + the callText print parse + the category
allowlist, `zone-route` the abstract-civzone create (subtype = validated `df.civzone_type`,
`spec_sub_flag.active`, per-use defaults) + bbox + civ-name allowlist, `resize-route` the
resolve→in-place extents edit (realloc when growing / reuse when shrinking) + bbox+dims commit +
stockpile occupancy reconcile, with deconstruct+reconstruct only as the hard-failure fallback (target
allowlist, overlapping-zone `from` disambiguation, integer coercion, mask `^[01]+$`/length gate,
empty-box deconstruct-only), and `unit-route` the df.unit.find(id) read + integer id coercion + the
tagged-blob parse;
`buildings-unit` / `stockpiles-unit` / `designations` are pure logic, as is `resize-geom` (the
client-side extend/reduce union/subtract → new {box, mask}); `buildings-smoke` /
`chat-smoke` spawn their own mock-mode bridge on a private port; `chat-hub` / `chat-join-race` are
headless.)

**Tier 2 — needs a running bridge:** `ws-smoke` (any bridge, mock fallback is fine),
`multi-smoke` (bridge must be on **live DF** — two real z-levels). Start the bridge first, then run.

**Tier 3 — needs DF on :5000 directly (live):** `rfr-smoke`, `build-live`, `build-categories-live`,
`build-center-live`, `build-size-probe`. These open their own DFAccess to :5000.

**Probes (`bridge/dfhack/*-probe.mjs`, live DF):** manual de-risk scripts (dig-probe, replace-probe,
build-probe, designate-probe, stockpile-probe, zone-probe, resize-probe, resize-inplace-probe,
unit-probe). Safe to run by default; any mutating action is behind an explicit flag (e.g. `--mark X Y
Z`, stockpile-probe's `--place X Y Z W H`, zone-probe's `--place X Y Z W H [type]`, resize-probe's
`--test X Y Z` which builds+carves+destroys its own throwaway pile, resize-inplace-probe's
`--survey`/`--occ X Y Z`/`--mirror` which proved the in-place extents edit + occupancy reconcile the
shipped resize now uses — `--survey` is read-only). unit-probe is read-only (`--id N` just picks which
unit to detail-read). Use one to pin down a DFHack call **before** writing the backend for it.

## Add a backend slice (the repeated pattern)

Every designate/build feature has followed this; keep to it:

1. **Probe first** — write/extend `bridge/dfhack/<x>-probe.mjs` against live DF to pin the exact
   DFHack call: an RFR RPC if one exists, else core `RunCommand("lua", [code])`. Confirm the result
   lands as RFR state that already streams (e.g. `tile_dig_designation`) so it renders for free.
2. **Backend** — add a method on `DFAccess` (`bridge/dfhack/df-access.mjs`) routing the `kind` to that
   call.
3. **Route unit test** — `bridge/test/<x>-route.mjs`, stub `df.client`, assert the RPC + args and that
   empty/non-finite tiles emit **no** RPC. Offline (Tier 1).
4. **Client** — un-pend / add the menu entry in `client/js/app.js` (`CATEGORIES`); the client sends
   `{ type, op, kind, tiles }` using only **known kind keys**.
5. **Gate** — Tier-1 suite green → restart bridge → **user browser-tests in-game** → then commit/merge.

## Safety (non-negotiable)

DFPlex is **not sandboxed**. Generated Lua must never interpolate client free text:
- The client sends only **known `kind` keys**, looked up in trusted server-side tables — never a raw
  string from the client into a Lua chunk.
- **Coords are coerced to integers** (`t.x | 0`) and filtered to finite before building any Lua.
- Treat any exposed instance as untrusted; isolate (container/VM) before opening it beyond trusted
  people. Keep these invariants in every new slice.

## Git flow

- **Branch per feature** off master: `git checkout -b feat/<slug>`.
- **Conventional commits** (`feat(scope): …`, `fix(scope): …`) with a body explaining *why*. Footer:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- **Test, then merge** — Tier-1 suite green, and for UI work the **user confirms in-browser** first.
- Merge **`--no-ff`**. **Merge and push are SEPARATE commands** (never chained). Then **delete** the
  merged branch (`git branch -d feat/<slug>`).
- **Commit explicit paths**, never `git add -A` — keeps stray probes/scratch files and unrelated
  in-flight work out of the commit (e.g. don't sweep up a half-done feature sitting in the tree).
- `CLAUDE.md` is a tracked file — keep it current as the port evolves (it points here for the dev
  flow). Update it in the same spirit as code: on its own branch, explicit-path commit.

```
git checkout -b feat/foo
# … work; run Tier-1 suite; user browser-tests …
git add bridge/dfhack/df-access.mjs client/js/app.js bridge/test/foo-route.mjs
git commit -m "feat(foo): …"            # with body + Co-Authored-By footer
git checkout master
git merge --no-ff feat/foo              # one command
git push                                # separate command
git branch -d feat/foo
```
