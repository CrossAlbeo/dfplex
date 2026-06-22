// Resize tools for stockpiles and activity zones — the only two building kinds DF stores as an
// abstract footprint you can grow or shrink (building_type Stockpile=29, Civzone=30). Both keep their
// real shape in a per-tile occupancy map (DF's room.extents), which the bridge streams to us as a
// building's `mask` (a row-major '0'/'1' string over its bbox; absent means a full rectangle).
//
// "Extend" and "Reduce" are the same gesture as placement — press inside the building, drag a
// rectangle — but instead of making a new building, the dragged rectangle is unioned into (extend) or
// subtracted from (reduce) that building's current tiles. Several strokes build any shape, exactly like
// DF's own zone/stockpile painting. The geometry here is pure (no DOM), so it unit-tests offline and
// keeps app.js thin; the bridge rebuilds the building to the {box, mask} this computes.

import { CIVZONE_BUILDING_TYPE } from "./zones.js";

export const STOCKPILE_BUILDING_TYPE = 29; // df.building_type.Stockpile
export { CIVZONE_BUILDING_TYPE };

// The two building types a resize tool can grab, mapped to the bridge's trusted `target` key.
export const RESIZE_TARGET_BY_BT = Object.freeze({
  [STOCKPILE_BUILDING_TYPE]: "stockpile",
  [CIVZONE_BUILDING_TYPE]: "zone",
});

// Menu orders (consumed by app.js CATEGORIES, same shape as the other tools).
export const RESIZE_EXTEND = Object.freeze({
  op: "resize", kind: "extend", label: "Extend", glyph: "⊕", accent: "#d98c5f", tileMode: "rect",
});
export const RESIZE_REDUCE = Object.freeze({
  op: "resize", kind: "reduce", label: "Reduce", glyph: "⊖", accent: "#d98c5f", tileMode: "rect",
});
export const RESIZE_ORDERS = Object.freeze([RESIZE_EXTEND, RESIZE_REDUCE]);

/** Is this a building a resize tool can act on (a stockpile or activity zone)? */
export function isResizable(b) {
  return b && (b.bt === STOCKPILE_BUILDING_TYPE || b.bt === CIVZONE_BUILDING_TYPE);
}

/** True iff (x,y) lies within building `b`'s footprint — its bbox AND, if non-rectangular, its mask. */
export function buildingCovers(b, x, y) {
  if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) return false;
  if (!b.mask) return true; // no mask == full rectangle
  const w = b.x1 - b.x0 + 1;
  const idx = (y - b.y0) * w + (x - b.x0);
  return b.mask[idx] === "1";
}

// Set-of-tiles helpers keyed by a packed "x,y" string (z is fixed per stroke).
const key = (x, y) => x + "," + y;

/** The building's current occupied tiles as a Set of "x,y" keys (from its mask, or the full bbox). */
export function occupiedSet(b) {
  const s = new Set();
  const w = b.x1 - b.x0 + 1;
  for (let y = b.y0; y <= b.y1; y++) {
    for (let x = b.x0; x <= b.x1; x++) {
      if (!b.mask || b.mask[(y - b.y0) * w + (x - b.x0)] === "1") s.add(key(x, y));
    }
  }
  return s;
}

/**
 * Apply a resize stroke to a building and return the new footprint as { box:{x0,y0,w,h}, mask } —
 * the absolute new bounding box plus a row-major '0'/'1' occupancy string the bridge writes verbatim.
 * `rect` is the dragged rectangle {x0,y0,x1,y1} (already normalized). `kind` is "extend" (union the
 * rectangle in) or "reduce" (subtract it). Returns { empty:true } when a reduce clears the last tile
 * (the bridge then just deconstructs the building). Pure — no DOM, no z (the caller stamps z).
 */
export function computeResize(b, rect, kind) {
  const s = occupiedSet(b);
  for (let y = rect.y0; y <= rect.y1; y++) {
    for (let x = rect.x0; x <= rect.x1; x++) {
      if (kind === "reduce") s.delete(key(x, y));
      else s.add(key(x, y));
    }
  }
  if (s.size === 0) return { empty: true };

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const k of s) {
    const c = k.indexOf(",");
    const x = +k.slice(0, c), y = +k.slice(c + 1);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const w = maxX - minX + 1, h = maxY - minY + 1;
  let mask = "";
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) mask += s.has(key(x, y)) ? "1" : "0";
  }
  return { box: { x0: minX, y0: minY, w, h }, mask };
}
