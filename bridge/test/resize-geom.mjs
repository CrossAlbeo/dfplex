// Unit test: the pure resize geometry in client/js/resize.js — occupiedSet / buildingCovers /
// computeResize. A resize stroke unions (extend) or subtracts (reduce) the dragged rectangle against a
// building's current tiles, producing the new {box, mask} the bridge rebuilds to. Covers rectangular
// and masked (non-rectangular) inputs, bbox growth + shrink, hole-carving, and emptying. Offline
// (Tier 1). Usage: node bridge/test/resize-geom.mjs
import { isResizable, buildingCovers, occupiedSet, computeResize, RESIZE_TARGET_BY_BT } from "../../client/js/resize.js";

let fail = 0;
const ok = (c, m) => (c ? console.log("  ok  -", m) : (console.error("  FAIL-", m), fail++));

// --- isResizable / target mapping ---
ok(isResizable({ bt: 29 }) && isResizable({ bt: 30 }), "stockpile(29) + zone(30) are resizable");
ok(!isResizable({ bt: 13 }) && !isResizable(null), "a workshop / null is not resizable");
ok(RESIZE_TARGET_BY_BT[29] === "stockpile" && RESIZE_TARGET_BY_BT[30] === "zone", "bt -> trusted target key");

// --- buildingCovers respects the mask ---
const L = { bt: 30, x0: 0, y0: 0, x1: 3, y1: 3, mask: "1111111111001100" }; // 4x4 L: bottom-right 2x2 holes
ok(buildingCovers(L, 0, 0) && buildingCovers(L, 1, 1), "covers an occupied cell");
ok(!buildingCovers(L, 2, 2) && !buildingCovers(L, 3, 3), "does NOT cover a masked-out hole");
ok(!buildingCovers(L, 9, 9), "does not cover a tile outside the bbox");
ok(occupiedSet(L).size === 12, "occupiedSet counts only occupied tiles (12 of 16)");
ok(occupiedSet({ bt: 29, x0: 0, y0: 0, x1: 2, y1: 2 }).size === 9, "no mask -> full bbox occupied (9)");

// --- extend: union a column onto a rectangle stays rectangular ---
let r = computeResize({ bt: 29, x0: 10, y0: 10, x1: 12, y1: 12 }, { x0: 13, y0: 10, x1: 13, y1: 12 }, "extend");
ok(r.box && r.box.x0 === 10 && r.box.y0 === 10 && r.box.w === 4 && r.box.h === 3, "extend east column -> 4x3 box at (10,10)");
ok(r.mask === "111111111111", "extend column -> full rectangle mask (12 ones)");

// --- extend: a disjoint rectangle makes a non-rectangular shape with holes ---
r = computeResize({ bt: 29, x0: 10, y0: 10, x1: 12, y1: 12 }, { x0: 13, y0: 13, x1: 14, y1: 14 }, "extend");
ok(r.box.x0 === 10 && r.box.y0 === 10 && r.box.w === 5 && r.box.h === 5, "extend diagonal -> 5x5 bounding box");
ok(r.mask === "1110011100111000001100011", "extend diagonal -> exact carved mask (orig 3x3 + far 2x2)");
ok([...r.mask].filter((c) => c === "1").length === 13, "extend diagonal -> 13 occupied (9+4)");

// --- reduce: subtract a corner -> L-shape, bbox unchanged ---
r = computeResize({ bt: 30, x0: 0, y0: 0, x1: 3, y1: 3 }, { x0: 2, y0: 2, x1: 3, y1: 3 }, "reduce");
ok(r.box.x0 === 0 && r.box.y0 === 0 && r.box.w === 4 && r.box.h === 4, "reduce inner corner -> bbox stays 4x4");
ok(r.mask === "1111111111001100", "reduce corner -> L-shaped mask");

// --- reduce: removing a whole edge shrinks the bounding box ---
r = computeResize({ bt: 29, x0: 0, y0: 0, x1: 2, y1: 2 }, { x0: 2, y0: 0, x1: 2, y1: 2 }, "reduce");
ok(r.box.w === 2 && r.box.h === 3, "reduce east column -> bbox shrinks to 2x3");
ok(r.mask === "111111", "reduce column -> full 2x3 mask (6 ones)");

// --- reduce to nothing -> empty (the bridge then just deconstructs) ---
r = computeResize({ bt: 29, x0: 5, y0: 5, x1: 5, y1: 5 }, { x0: 5, y0: 5, x1: 5, y1: 5 }, "reduce");
ok(r.empty === true && !r.box, "reduce the last tile -> { empty: true }");

// --- extend can fill a masked building's hole back to a full rectangle ---
r = computeResize(L, { x0: 2, y0: 2, x1: 3, y1: 3 }, "extend");
ok(r.box.w === 4 && r.box.h === 4 && r.mask === "1111111111111111", "extend fills the L's hole -> full 4x4");

// --- a single-tile extend inside the building is a no-op shape ---
r = computeResize({ bt: 29, x0: 10, y0: 10, x1: 12, y1: 12 }, { x0: 11, y0: 11, x1: 11, y1: 11 }, "extend");
ok(r.box.w === 3 && r.box.h === 3 && r.mask === "111111111", "extend an interior tile -> unchanged 3x3");

console.log(fail ? `\n${fail} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
process.exit(fail ? 1 : 0);
