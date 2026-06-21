// App: wires a data source -> World -> Renderer, handles per-client input (pan/zoom/z),
// and drives the render loop + HUD. This is the only file that touches the DOM.

import { S2C, C2S } from "./protocol.js";
import { World } from "./world.js";
import { Camera } from "./camera.js";
import { Renderer } from "./renderer.js";
import { MockSource } from "./mock.js";
import { WebSocketSource } from "./websocketsource.js";
import { ORDERS } from "./designations.js";
import { BUILD_CATEGORIES } from "./buildings.js";

const view = document.getElementById("view");
const hud = document.getElementById("hud");
const statusEl = document.getElementById("status");
const sourceSel = document.getElementById("source");
const wsUrl = document.getElementById("wsurl");
const connectBtn = document.getElementById("connect");
const orderbar = document.getElementById("orderbar");
const menubar = document.getElementById("menubar");
const nickInput = document.getElementById("nick");
const chat = document.getElementById("chat");
const chathead = document.getElementById("chathead");
const chatlog = document.getElementById("chatlog");
const chatform = document.getElementById("chatform");
const chatinput = document.getElementById("chatinput");
const onlineEl = document.getElementById("online");

const cam = new Camera();
const renderer = new Renderer(view);

let world = new World();
let source = null;

function setStatus(text) {
  statusEl.textContent = text;
}

// ---- order menu: top-level group buttons split across two boxes at the top — Designate (dig,
// chop, gather, engrave, remove) and Place (build, stockpiles, zones). A group is either a *leaf*
// (its tool boxes show directly), a *branch* (Build — opening it lists sub-categories, and picking
// one descends to that category's tool boxes with a back chip), or *pending* (scaffolded, no backend
// yet — dimmed and inert). Each tool carries the op it sends (designate vs build) and how it places
// (tileMode). Dig tools come from designations.js; build categories from buildings.js. ----
const DIG_ORDERS = ORDERS.map((o) => ({
  op: "designate", kind: o.kind, label: o.label, glyph: o.glyph, accent: o.accent, hotkey: o.hotkey, tileMode: "rect",
}));
// Mining orders fill the Dig box; "remove" gets its own box (it clears designations today, and will
// grow to clear chop/gather/engrave once those land). The other boxes are scaffolded `pending` —
// shown but not wired, each awaiting a live write-path probe before it does anything.
const MINING_ORDERS = DIG_ORDERS.filter((o) => o.kind !== "remove");
const REMOVE_ORDER = DIG_ORDERS.find((o) => o.kind === "remove");
const CATEGORIES = [
  { box: "designate", glyph: "⛏", label: "Dig", accent: "#e89628", orders: MINING_ORDERS },
  { box: "designate", glyph: "♣", label: "Chop", accent: "#8d6e3a", orders: [], pending: true },
  { box: "designate", glyph: "✿", label: "Gather", accent: "#5aa84f", orders: [], pending: true },
  { box: "designate", glyph: "✎", label: "Engrave", accent: "#b08bd9", orders: [], pending: true },
  { box: "designate", glyph: "✕", label: "Remove", accent: "#9aa0a6", orders: [REMOVE_ORDER] },
  { box: "place", glyph: "▣", label: "Build", accent: "#9aa0a6", children: BUILD_CATEGORIES },
  { box: "place", glyph: "▦", label: "Stockpiles", accent: "#c9a227", orders: [], pending: true },
  { box: "place", glyph: "⬚", label: "Zones", accent: "#3c9dba", orders: [], pending: true },
];

let currentTool = MINING_ORDERS[0];
let openCat = -1; // open top-level group, or -1 when collapsed
let openSub = -1; // within an open branch group: open sub-category, or -1 to show the category list
const orderButtons = new Map(); // order -> its tool button (only for the submenu currently shown)
const catButtons = []; // per top-level group: { btn, current, caret }
const mkSpan = (cls, text) => {
  const s = document.createElement("span");
  s.className = cls;
  s.textContent = text;
  return s;
};

// Flat hotkey map across all groups (the dig tools carry 1–7 today) -> where the tool lives.
const HOTKEYS = new Map();
CATEGORIES.forEach((cat, t) => {
  const groups = cat.orders ? [[-1, cat.orders]] : cat.children.map((s, si) => [si, s.orders]);
  for (const [sub, orders] of groups)
    for (const o of orders) if (o.hotkey) HOTKEYS.set(o.hotkey, { order: o, top: t, sub });
});

// Locate a tool in the menu tree: { top, sub } indices (sub = -1 for leaf groups).
function locate(o) {
  for (let t = 0; t < CATEGORIES.length; t++) {
    const c = CATEGORIES[t];
    if (c.orders) {
      if (c.orders.includes(o)) return { top: t, sub: -1 };
    } else {
      const s = c.children.findIndex((sub) => sub.orders.includes(o));
      if (s >= 0) return { top: t, sub: s };
    }
  }
  return { top: -1, sub: -1 };
}

// One group button per top-level category, dropped into its box (Designate vs Place).
const MENUBOXES = {
  designate: document.getElementById("box-designate"),
  place: document.getElementById("box-place"),
};
CATEGORIES.forEach((cat, ci) => {
  const btn = document.createElement("button");
  btn.className = cat.pending ? "category pending" : "category";
  btn.style.setProperty("--order-accent", cat.accent || "#e89628");
  const current = mkSpan("cat-current", "");
  const caret = mkSpan("cat-caret", "▴");
  btn.append(mkSpan("cat-glyph", cat.glyph), mkSpan("cat-label", cat.label), current, caret);
  btn.addEventListener("click", () => {
    btn.blur();
    if (cat.pending) {
      setStatus(`${cat.label} — coming soon`); // scaffolded box; no backend wired yet
      return;
    }
    setOpenCat(openCat === ci ? -1 : ci); // toggle this group; only one open at a time
  });
  (MENUBOXES[cat.box] || menubar).appendChild(btn);
  catButtons.push({ btn, current, caret });
});

// A tool box (glyph over label over hotkey) for the open submenu.
function appendOrder(o) {
  const btn = document.createElement("button");
  btn.className = "order";
  btn.style.setProperty("--order-accent", o.accent);
  btn.title = o.hotkey ? `${o.label} (${o.hotkey})` : o.label;
  btn.append(mkSpan("glyph", o.glyph), mkSpan("label", o.label), mkSpan("key", o.hotkey || ""));
  btn.addEventListener("click", () => {
    setTool(o); // picking a tool leaves the submenu open, like DF
    btn.blur(); // hand keyboard focus back to the map
  });
  orderbar.appendChild(btn);
  orderButtons.set(o, btn);
  btn.classList.toggle("active", o === currentTool);
}

// A row chip (glyph + label + optional caret) used inside the orderbar to navigate sub-categories.
function appendNavChip(glyph, label, accent, caret, onClick) {
  const btn = document.createElement("button");
  btn.className = "category";
  btn.style.setProperty("--order-accent", accent || "#9aa0a6");
  btn.append(mkSpan("cat-glyph", glyph), mkSpan("cat-label", label));
  if (caret) btn.append(mkSpan("cat-caret", caret));
  btn.addEventListener("click", () => {
    onClick();
    btn.blur();
  });
  orderbar.appendChild(btn);
}

// (Re)populate the submenu (#orderbar) for the open group `ci`, honoring openSub for branches.
function buildSubmenu(ci) {
  orderbar.replaceChildren();
  orderButtons.clear();
  const cat = CATEGORIES[ci];
  if (cat.children) {
    if (openSub < 0) {
      // Branch group: list its sub-categories; clicking one descends to that category's tools.
      cat.children.forEach((sub, si) =>
        appendNavChip(sub.glyph, sub.label, sub.accent, "▸", () => {
          openSub = si;
          buildSubmenu(ci);
        })
      );
      return;
    }
    // A sub-category is open: a back chip to the category list, then that category's tool boxes.
    appendNavChip("◂", cat.label, cat.accent, "", () => {
      openSub = -1;
      buildSubmenu(ci);
    });
    cat.children[openSub].orders.forEach(appendOrder);
    return;
  }
  cat.orders.forEach(appendOrder); // leaf group: tool boxes directly
}

// Sync the menubar buttons + orderbar visibility to the current openCat/openSub.
function renderOpen() {
  orderbar.classList.toggle("hidden", openCat < 0);
  if (openCat >= 0) buildSubmenu(openCat);
  catButtons.forEach((c, i) => {
    c.btn.classList.toggle("active", i === openCat);
    c.caret.textContent = i === openCat ? "▾" : "▴";
  });
}

function setOpenCat(ci) {
  openCat = ci;
  // Opening a branch jumps straight to the armed tool's sub-category if it lives there, else the
  // category list. Leaf groups have no sub-level.
  openSub =
    ci >= 0 && CATEGORIES[ci].children
      ? CATEGORIES[ci].children.findIndex((s) => s.orders.includes(currentTool))
      : -1;
  renderOpen();
}

function setTool(o) {
  currentTool = o;
  for (const [ord, b] of orderButtons) b.classList.toggle("active", ord === o);
  // Reflect the armed tool on its top-level button (label + accent), so the collapsed bar reads right.
  const { top } = locate(o);
  if (top >= 0) {
    catButtons[top].current.textContent = o.label;
    catButtons[top].btn.style.setProperty("--order-accent", o.accent);
  }
}

setOpenCat(-1);
setTool(currentTool);

// ---- chat + presence: the one cross-client channel (the bridge hub broadcasts these to all) ----
const savedNick = localStorage.getItem("dfplex.nick") || `Player-${Math.floor(1000 + Math.random() * 9000)}`;
nickInput.value = savedNick;
nickInput.addEventListener("change", () => {
  const n = nickInput.value.trim();
  if (n) localStorage.setItem("dfplex.nick", n);
  if (source && source.running) source.send({ type: C2S.JOIN, nick: n }); // live rename
});

function addChat({ kind, from, text, ts }) {
  // Keep the view pinned to the newest line only if the user is already at the bottom.
  const atBottom = chatlog.scrollHeight - chatlog.scrollTop - chatlog.clientHeight < 4;
  const line = document.createElement("div");
  line.className = "msg";
  const d = new Date(ts || Date.now());
  line.append(mkSpan("time", `${`${d.getHours()}`.padStart(2, "0")}:${`${d.getMinutes()}`.padStart(2, "0")}`));
  if (kind === "system") {
    line.append(mkSpan("sys", text));
  } else {
    line.append(mkSpan("from", `${from}: `));
    const body = document.createElement("span");
    body.textContent = text; // textContent, never innerHTML: chat is never interpreted as markup
    line.append(body);
  }
  chatlog.append(line);
  while (chatlog.children.length > 200) chatlog.firstChild.remove();
  if (atBottom) chatlog.scrollTop = chatlog.scrollHeight;
}

function setPresence(list) {
  onlineEl.textContent = `online: ${list.length}`;
  onlineEl.title = list.map((p) => p.nick).join(", ");
}

chatform.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = chatinput.value;
  chatinput.value = "";
  if (!text.trim()) {
    chatinput.blur();
    return;
  }
  if (source && source.running) source.send({ type: C2S.CHAT, text });
  else addChat({ kind: "system", text: "(not connected — chat needs the WebSocket source)" });
});

chatinput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    chatinput.blur();
    e.preventDefault();
  }
  e.stopPropagation(); // typing in chat must never drive the map/keyboard controls
});

chathead.addEventListener("click", () => {
  const collapsed = chat.classList.toggle("collapsed");
  document.getElementById("chattoggle").textContent = collapsed ? "▸" : "▾";
});

// Render-on-demand: the loop only repaints when something changed (data, camera, or cursor),
// so an idle view costs nothing instead of re-drawing the map 60x/second.
let needsDraw = true;
function invalidate() {
  needsDraw = true;
}

function connect() {
  if (source) source.stop();
  world = new World();
  renderer.cursor = null;

  const kind = sourceSel.value;
  source =
    kind === "ws"
      ? new WebSocketSource(wsUrl.value, nickInput.value.trim() || "Player")
      : new MockSource({ tickMs: 120 });

  source.onMessage((m) => {
    // Chat + presence are UI-only and cross-client; handle them before the world model.
    if (m.type === S2C.CHAT) {
      addChat(m);
      return;
    }
    if (m.type === S2C.PRESENCE) {
      setPresence(m.list || []);
      return;
    }
    world.apply(m);
    if (m.type === S2C.MAP) renderer.invalidateMap();
    if (m.type === S2C.HELLO) {
      renderer.invalidateMap();
      // Open where the source suggests (live DF's view center), else the map middle.
      const start = m.start;
      cam.z = start?.z ?? world.map.zSurface ?? 0;
      const fx = start?.x ?? world.map.xCount / 2;
      const fy = start?.y ?? world.map.yCount / 2;
      cam.centerOn(fx, fy, view.clientWidth, view.clientHeight);
      setStatus(`${world.server} · you are "${world.you?.nick ?? "?"}"`);
    } else if (m.type === S2C.ERROR) {
      setStatus(`error: ${m.message}`);
    }
    invalidate();
  });

  source.start();
  setStatus(`connecting (${kind})…`);
}

// ---- input: all client-side, so each browser has an independent view ----
// Middle button drags the map; left button applies the current order (a single tile, or a
// click-drag rectangle). Keyboard (WASD/arrows pan, Q/E z, 1–7 order) mirrors the bar.

let panning = false; // middle-drag = pan
let selecting = false; // left-drag/click = apply current order
let selStart = null;
let selEnd = null;

function selRect() {
  return {
    x0: Math.min(selStart.x, selEnd.x),
    y0: Math.min(selStart.y, selEnd.y),
    x1: Math.max(selStart.x, selEnd.x),
    y1: Math.max(selStart.y, selEnd.y),
  };
}

view.addEventListener("mousedown", (e) => {
  const rect = view.getBoundingClientRect();
  const tile = cam.screenToTile(e.clientX - rect.left, e.clientY - rect.top);
  if (e.button === 1) {
    panning = true;
    view.style.cursor = "grabbing";
    e.preventDefault(); // suppress middle-click autoscroll
  } else if (e.button === 0) {
    selecting = true;
    selStart = selEnd = tile;
    renderer.selection = selRect();
    invalidate();
    e.preventDefault();
  }
});

// Middle-click can also start autoscroll on some browsers; cancel that too.
view.addEventListener("auxclick", (e) => {
  if (e.button === 1) e.preventDefault();
});

window.addEventListener("mouseup", (e) => {
  if (e.button === 1 && panning) {
    panning = false;
    view.style.cursor = "";
  }
  if (e.button === 0 && selecting) {
    selecting = false;
    renderer.selection = null;
    const r = selRect();
    const tiles = [];
    for (let y = r.y0; y <= r.y1 && tiles.length < 4096; y++) {
      for (let x = r.x0; x <= r.x1 && tiles.length < 4096; x++) tiles.push({ x, y, z: cam.z });
    }
    if (source && source.running && tiles.length) {
      if (currentTool.op === "build") {
        // Single-tile buildings place once at the drag anchor; constructions stamp the rectangle.
        const place = currentTool.tileMode === "single" ? [tiles[0]] : tiles;
        source.send({ type: C2S.COMMAND, op: "build", kind: currentTool.kind, tiles: place });
        setStatus(`build ${currentTool.label}: ${place.length} tile(s)`);
      } else {
        source.send({ type: C2S.COMMAND, op: "designate", kind: currentTool.kind, tiles });
        setStatus(`${currentTool.label}: ${tiles.length} tile(s)`);
      }
    }
    invalidate();
  }
});

window.addEventListener("mousemove", (e) => {
  const rect = view.getBoundingClientRect();
  const ox = e.clientX - rect.left;
  const oy = e.clientY - rect.top;
  if (panning) {
    cam.panByPixels(e.movementX, e.movementY);
    invalidate();
  }
  if (ox >= 0 && oy >= 0 && ox <= rect.width && oy <= rect.height) {
    const tile = cam.screenToTile(ox, oy);
    renderer.cursor = tile;
    if (selecting) {
      selEnd = tile;
      renderer.selection = selRect();
    }
    invalidate();
  }
});

view.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const rect = view.getBoundingClientRect();
    cam.zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - rect.left, e.clientY - rect.top);
    invalidate();
  },
  { passive: false }
);

window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === "Enter") {
    chatinput.focus(); // jump to chat from the map, like an in-game chat key
    e.preventDefault();
    return;
  }
  if (e.key === "Escape" && openCat >= 0) {
    if (CATEGORIES[openCat].children && openSub >= 0) {
      openSub = -1; // step back from a sub-category to the build category list
      buildSubmenu(openCat);
    } else {
      setOpenCat(-1); // collapse the menu
    }
    e.preventDefault();
    return;
  }
  // Number keys pick a tool by hotkey across all groups (currently the dig tools 1–7); selecting
  // one opens the group (and sub-category) holding it so the submenu shows the choice.
  const hit = HOTKEYS.get(e.key);
  if (hit) {
    openCat = hit.top;
    openSub = hit.sub;
    renderOpen();
    setTool(hit.order);
    setStatus(`tool: ${hit.order.label}`);
    e.preventDefault();
    return;
  }
  const PAN = 2;
  switch (e.key) {
    case "ArrowLeft": case "a": cam.panByTiles(-PAN, 0); break;
    case "ArrowRight": case "d": cam.panByTiles(PAN, 0); break;
    case "ArrowUp": case "w": cam.panByTiles(0, -PAN); break;
    case "ArrowDown": case "s": cam.panByTiles(0, PAN); break;
    case "e": case "PageUp": cam.changeZ(1, world.map?.zCount ?? 1); break;
    case "q": case "PageDown": cam.changeZ(-1, world.map?.zCount ?? 1); break;
    default: return;
  }
  // Report the new viewport so future sources can scope their reads to it.
  if (source && source.running) {
    source.send({
      type: C2S.VIEWPORT,
      z: cam.z,
      min: cam.screenToTile(0, 0),
      max: cam.screenToTile(view.clientWidth, view.clientHeight),
    });
  }
  invalidate();
  e.preventDefault();
});

connectBtn.addEventListener("click", connect);
sourceSel.addEventListener("change", () => {
  wsUrl.style.display = sourceSel.value === "ws" ? "" : "none";
});

window.addEventListener("resize", () => {
  renderer.resize();
  invalidate();
});

// ---- render loop ----

function hudText() {
  const c = renderer.cursor;
  const code = c ? world.tileAt(c.x, c.y, cam.z) : -1;
  return [
    `server: ${world.server ?? "—"}`,
    `z: ${cam.z}/${(world.map?.zCount ?? 1) - 1}`,
    `zoom: ${cam.zoom.toFixed(2)}`,
    `cursor: ${c ? `${c.x},${c.y} (tile ${code})` : "—"}`,
    `units: ${world.units.size}`,
    `frame: ${world.frame}  fps(sim): ${world.fps}`,
    `tool: ${currentTool.label}`,
    `[L-drag: ${currentTool.op === "build" ? "build" : "designate"} · M-drag: pan]`,
  ].join("   ");
}

function loop() {
  if (needsDraw) {
    renderer.draw(world, cam);
    hud.textContent = hudText();
    needsDraw = false;
  }
  requestAnimationFrame(loop);
}

renderer.resize();
sourceSel.dispatchEvent(new Event("change"));
connect(); // start on Mock by default
requestAnimationFrame(loop);
