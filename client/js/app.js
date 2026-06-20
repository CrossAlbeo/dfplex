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

// ---- order menu: a row of category buttons along the bottom (Digging orders, Construction, …);
// clicking one opens its submenu of DF-style tool boxes. Each tool carries the op it sends
// (designate vs build) and how it places (tileMode). Dig tools come from designations.js; build
// categories from buildings.js. New build categories slot in with no UI changes. ----
const DIG_ORDERS = ORDERS.map((o) => ({
  op: "designate", kind: o.kind, label: o.label, glyph: o.glyph, accent: o.accent, hotkey: o.hotkey, tileMode: "rect",
}));
const CATEGORIES = [
  { glyph: "⛏", label: "Digging orders", accent: "#e89628", orders: DIG_ORDERS },
  ...BUILD_CATEGORIES,
];

let currentTool = DIG_ORDERS[0];
let openCat = -1; // index of the category whose submenu is open, or -1 when collapsed
const orderButtons = new Map(); // order object -> its submenu button (only for the open category)
const catButtons = []; // per category: { btn, current, caret }
const mkSpan = (cls, text) => {
  const s = document.createElement("span");
  s.className = cls;
  s.textContent = text;
  return s;
};

// One category button per category along the menubar.
CATEGORIES.forEach((cat, ci) => {
  const btn = document.createElement("button");
  btn.className = "category";
  btn.style.setProperty("--order-accent", cat.accent || "#e89628");
  const current = mkSpan("cat-current", "");
  const caret = mkSpan("cat-caret", "▴");
  btn.append(mkSpan("cat-glyph", cat.glyph), mkSpan("cat-label", cat.label), current, caret);
  btn.addEventListener("click", () => {
    setOpenCat(openCat === ci ? -1 : ci); // toggle this category; only one open at a time
    btn.blur();
  });
  menubar.appendChild(btn);
  catButtons.push({ btn, current, caret });
});

// (Re)populate the submenu (#orderbar) with the tool boxes of category `ci`.
function buildSubmenu(ci) {
  orderbar.replaceChildren();
  orderButtons.clear();
  for (const o of CATEGORIES[ci].orders) {
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
}

function setOpenCat(ci) {
  openCat = ci;
  orderbar.classList.toggle("hidden", ci < 0);
  if (ci >= 0) buildSubmenu(ci);
  catButtons.forEach((c, i) => {
    c.btn.classList.toggle("active", i === ci);
    c.caret.textContent = i === ci ? "▾" : "▴";
  });
}

function setTool(o) {
  currentTool = o;
  for (const [ord, b] of orderButtons) b.classList.toggle("active", ord === o);
  // Reflect the armed tool on its category button (label + accent), so the collapsed bar reads right.
  const ci = CATEGORIES.findIndex((c) => c.orders.includes(o));
  if (ci >= 0) {
    catButtons[ci].current.textContent = o.label;
    catButtons[ci].btn.style.setProperty("--order-accent", o.accent);
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
    setOpenCat(-1);
    e.preventDefault();
    return;
  }
  // Number keys pick a tool by hotkey across categories (currently the dig tools 1–7); selecting
  // one opens its category so the submenu shows the choice.
  for (let ci = 0; ci < CATEGORIES.length; ci++) {
    const ord = CATEGORIES[ci].orders.find((o) => o.hotkey === e.key);
    if (ord) {
      setOpenCat(ci);
      setTool(ord);
      setStatus(`tool: ${ord.label}`);
      e.preventDefault();
      return;
    }
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
