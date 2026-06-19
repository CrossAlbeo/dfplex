// Renderer: draws the current z-level of the World through a Camera onto a 2D canvas.
//
// The map layer is expensive (a glyph per tile), so it's cached: tiles are drawn once into an
// offscreen canvas at a fixed CELL size whenever the level changes, and each frame we just blit
// the visible sub-rect with a single (scaled) drawImage. Units and the cursor — few and moving —
// are drawn live on top. Combined with the app's render-on-demand loop, idle frames cost nothing
// and panning costs one drawImage instead of thousands of fillText calls.

import { PALETTE, tiledict, UNIT_DEFAULT } from "./tiledict.js";

const CELL = 16; // px per tile in the offscreen map cache (blitted scaled to the live zoom)

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.cursor = null; // {x,y} tile under the mouse, or null

    this.mapCanvas = document.createElement("canvas");
    this.mapCtx = this.mapCanvas.getContext("2d", { alpha: false });
    this._mapZ = null; // z-level currently baked into mapCanvas
    this._mapDirty = true; // tiles changed -> rebuild needed
  }

  /** Resize the backing store to the displayed size (accounting for devicePixelRatio). */
  resize() {
    const dpr = globalThis.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._w = rect.width;
    this._h = rect.height;
  }

  /** Mark the cached map layer stale (call when tiles change). */
  invalidateMap() {
    this._mapDirty = true;
  }

  /** Bake the given z-level into the offscreen map canvas. */
  _rebuildMap(world, z) {
    const W = world.map.xCount;
    const H = world.map.yCount;
    if (this.mapCanvas.width !== W * CELL || this.mapCanvas.height !== H * CELL) {
      this.mapCanvas.width = W * CELL;
      this.mapCanvas.height = H * CELL;
    }
    const ctx = this.mapCtx;
    ctx.fillStyle = PALETTE[0];
    ctx.fillRect(0, 0, this.mapCanvas.width, this.mapCanvas.height);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${CELL}px "Cascadia Mono","Consolas","DejaVu Sans Mono",monospace`;

    const lvl = world.levels.get(z);
    if (lvl) {
      const tiles = lvl.tiles;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const t = tiledict[tiles[y * W + x]];
          const sx = x * CELL;
          const sy = y * CELL;
          if (t.bg) {
            ctx.fillStyle = PALETTE[t.bg];
            ctx.fillRect(sx, sy, CELL, CELL);
          }
          if (t.ch !== " ") {
            ctx.fillStyle = PALETTE[t.fg];
            ctx.fillText(t.ch, sx + CELL / 2, sy + CELL / 2 + 1);
          }
        }
      }
    }
    this._mapZ = z;
    this._mapDirty = false;
  }

  draw(world, cam) {
    const ctx = this.ctx;
    const cell = cam.cell;
    const W = this._w || this.canvas.width;
    const H = this._h || this.canvas.height;

    ctx.fillStyle = PALETTE[0];
    ctx.fillRect(0, 0, W, H);
    if (!world.map) return;

    // Refresh the cached map layer if the tiles or the viewed z-level changed.
    if (this._mapDirty || this._mapZ !== cam.z) this._rebuildMap(world, cam.z);

    // Blit the visible window of the cached map, clamped to the map's bounds so off-map
    // area stays the (already-painted) background.
    const mapW = this.mapCanvas.width;
    const mapH = this.mapCanvas.height;
    let sX = cam.x * CELL;
    let sY = cam.y * CELL;
    let sW = (W / cell) * CELL;
    let sH = (H / cell) * CELL;
    let dX = 0;
    let dY = 0;
    let dW = W;
    let dH = H;
    const kx = W / sW; // dest px per source px
    const ky = H / sH;
    if (sX < 0) { dX += -sX * kx; dW -= -sX * kx; sW += sX; sX = 0; }
    if (sY < 0) { dY += -sY * ky; dH -= -sY * ky; sH += sY; sY = 0; }
    if (sX + sW > mapW) { const cut = sX + sW - mapW; dW -= cut * kx; sW -= cut; }
    if (sY + sH > mapH) { const cut = sY + sH - mapH; dH -= cut * ky; sH -= cut; }
    if (sW > 0 && sH > 0) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.mapCanvas, sX, sY, sW, sH, dX, dY, dW, dH);
    }

    // Units on this z-level (live, in screen space).
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${Math.floor(cell)}px "Cascadia Mono","Consolas","DejaVu Sans Mono",monospace`;
    for (const u of world.unitsOnZ(cam.z)) {
      const sx = (u.x - cam.x) * cell;
      const sy = (u.y - cam.y) * cell;
      if (sx < -cell || sy < -cell || sx > W || sy > H) continue;
      ctx.fillStyle = PALETTE[u.color ?? UNIT_DEFAULT.color];
      ctx.fillText(u.ch || UNIT_DEFAULT.ch, sx + cell / 2, sy + cell / 2 + 1);
    }

    // Mouse cursor highlight.
    if (this.cursor) {
      const sx = (this.cursor.x - cam.x) * cell;
      const sy = (this.cursor.y - cam.y) * cell;
      ctx.strokeStyle = PALETTE[15];
      ctx.lineWidth = 1;
      ctx.strokeRect(sx + 0.5, sy + 0.5, cell - 1, cell - 1);
    }
  }
}
