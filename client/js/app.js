// App: wires a data source -> World -> Renderer, handles per-client input (pan/zoom/z),
// and drives the render loop + HUD. This is the only file that touches the DOM.

import { S2C, C2S } from "./protocol.js";
import { World } from "./world.js";
import { Camera } from "./camera.js";
import { Renderer } from "./renderer.js";
import { MockSource } from "./mock.js";
import { WebSocketSource } from "./websocketsource.js";

const view = document.getElementById("view");
const hud = document.getElementById("hud");
const statusEl = document.getElementById("status");
const sourceSel = document.getElementById("source");
const wsUrl = document.getElementById("wsurl");
const connectBtn = document.getElementById("connect");

const cam = new Camera();
const renderer = new Renderer(view);

let world = new World();
let source = null;

function setStatus(text) {
  statusEl.textContent = text;
}

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
      ? new WebSocketSource(wsUrl.value, "Web")
      : new MockSource({ tickMs: 120 });

  source.onMessage((m) => {
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

let dragging = false;
view.addEventListener("mousedown", () => (dragging = true));
window.addEventListener("mouseup", () => (dragging = false));
window.addEventListener("mousemove", (e) => {
  const rect = view.getBoundingClientRect();
  const ox = e.clientX - rect.left;
  const oy = e.clientY - rect.top;
  if (dragging) {
    cam.panByPixels(e.movementX, e.movementY);
    invalidate();
  }
  if (ox >= 0 && oy >= 0 && ox <= rect.width && oy <= rect.height) {
    renderer.cursor = cam.screenToTile(ox, oy);
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
