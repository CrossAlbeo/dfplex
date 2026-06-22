// Renderer: draws the current z-level of the World through a Camera onto a 2D canvas.
//
// The map layer is expensive (a glyph per tile), so it's cached: tiles are drawn once into an
// offscreen canvas at a fixed CELL size whenever the level changes, and each frame we just blit
// the visible sub-rect with a single (scaled) drawImage. Units and the cursor — few and moving —
// are drawn live on top. Combined with the app's render-on-demand loop, idle frames cost nothing
// and panning costs one drawImage instead of thousands of fillText calls.

import { PALETTE, tiledict, UNIT_DEFAULT } from "./tiledict.js";
import { DESIG_STYLE, DESIG_FALLBACK } from "./designations.js";
import { styleFor } from "./buildings.js";
import { CIVZONE_BUILDING_TYPE, zoneStyleFor } from "./zones.js";

const CELL = 16; // px per tile in the offscreen map cache (blitted scaled to the live zoom)

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.cursor = null; // {x,y} tile under the mouse, or null
    this.selection = null; // {x0,y0,x1,y1} in-progress designation drag, or null

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

    // Dig designations on this z-level: a per-type colored tint, plus a high-contrast glyph for
    // the stair/channel/ramp kinds. Color-coding makes a type change visible even where the
    // glyph is small, so dig -> down-stair no longer looks identical.
    const desig = world.desigOnZ ? world.desigOnZ(cam.z) : [];
    if (desig.length) {
      // Pass 1: colored tints.
      for (const d of desig) {
        const sx = (d.x - cam.x) * cell;
        const sy = (d.y - cam.y) * cell;
        if (sx < -cell || sy < -cell || sx > W || sy > H) continue;
        ctx.fillStyle = (DESIG_STYLE[d.d] || DESIG_FALLBACK).fill;
        ctx.fillRect(sx, sy, cell, cell);
      }
      // Pass 2: glyphs — bright fill with a dark outline so they read over any tile color.
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `bold ${Math.floor(cell * 0.8)}px "Cascadia Mono","Consolas","DejaVu Sans Mono",monospace`;
      ctx.lineWidth = Math.max(1, cell * 0.12);
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(0,0,0,0.85)";
      ctx.fillStyle = "#ffffff";
      for (const d of desig) {
        const g = (DESIG_STYLE[d.d] || DESIG_FALLBACK).glyph;
        if (!g) continue;
        const sx = (d.x - cam.x) * cell;
        const sy = (d.y - cam.y) * cell;
        if (sx < -cell || sy < -cell || sx > W || sy > H) continue;
        const gx = sx + cell / 2;
        const gy = sy + cell / 2 + 1;
        ctx.strokeText(g, gx, gy);
        ctx.fillText(g, gx, gy);
      }
    }

    // Buildings on this z-level: a faint footprint tint + border, a per-type glyph at the centre.
    // Dimmed when the building isn't active yet (just placed / under construction). The glyph and
    // accent come from buildings.js styleFor(building_type).
    const blds = world.buildingsOnZ ? world.buildingsOnZ(cam.z) : [];
    if (blds.length) {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `${Math.floor(cell * 0.8)}px "Cascadia Mono","Consolas","DejaVu Sans Mono",monospace`;
      for (const b of blds) {
        const w = b.x1 - b.x0 + 1;
        const h = b.y1 - b.y0 + 1;
        const bx = (b.x0 - cam.x) * cell;
        const by = (b.y0 - cam.y) * cell;
        const bw = w * cell;
        const bh = h * cell;
        if (bx > W || by > H || bx + bw < 0 || by + bh < 0) continue;
        // Activity zones all share building_type Civzone; their use is the subtype, so style by `st`.
        const style = b.bt === CIVZONE_BUILDING_TYPE ? zoneStyleFor(b.st) : styleFor(b.bt);
        const accent = style.a;
        ctx.fillStyle = accent;
        // A non-rectangular pile/zone carries a per-tile mask: tint only its occupied cells (and skip
        // the bbox border, which would box in the holes). Rectangular ones fill+outline the whole box.
        const mask = b.mask;
        if (mask) {
          ctx.globalAlpha = b.active ? 0.22 : 0.12;
          for (let dy = 0; dy < h; dy++) {
            for (let dx = 0; dx < w; dx++) {
              if (mask[dy * w + dx] !== "1") continue;
              ctx.fillRect(bx + dx * cell, by + dy * cell, cell, cell);
            }
          }
          ctx.globalAlpha = 1;
        } else {
          ctx.globalAlpha = b.active ? 0.22 : 0.12;
          ctx.fillRect(bx, by, bw, bh);
          ctx.globalAlpha = 1;
          ctx.strokeStyle = accent;
          ctx.lineWidth = 1;
          ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
        }
        // Glyph at the bbox centre, or the first occupied cell when that centre is a hole.
        let gx = bx + bw / 2;
        let gy = by + bh / 2 + 1;
        if (mask) {
          const cdx = (w - 1) >> 1;
          const cdy = (h - 1) >> 1;
          if (mask[cdy * w + cdx] !== "1") {
            const idx = mask.indexOf("1");
            if (idx >= 0) {
              gx = bx + (idx % w) * cell + cell / 2;
              gy = by + Math.floor(idx / w) * cell + cell / 2 + 1;
            }
          }
        }
        ctx.fillStyle = accent;
        ctx.globalAlpha = b.active ? 1 : 0.6;
        ctx.fillText(style.g, gx, gy);
        ctx.globalAlpha = 1;
      }
    }

    // In-progress selection rectangle (shift-drag to designate digging).
    if (this.selection) {
      const s = this.selection;
      const sx = (s.x0 - cam.x) * cell;
      const sy = (s.y0 - cam.y) * cell;
      const w = (s.x1 - s.x0 + 1) * cell;
      const h = (s.y1 - s.y0 + 1) * cell;
      ctx.fillStyle = "rgba(232,201,58,0.20)";
      ctx.fillRect(sx, sy, w, h);
      ctx.strokeStyle = PALETTE[14];
      ctx.lineWidth = 1;
      ctx.strokeRect(sx + 0.5, sy + 0.5, w - 1, h - 1);
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
