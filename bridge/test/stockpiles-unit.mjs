// Headless unit test for the stockpile presets (client/js/stockpiles.js). Pure data invariants, no DF
// or bridge — runs anywhere with `node bridge/test/stockpiles-unit.mjs`. Guards the preset table the
// browser menu and the bridge configuration both read: unique sp_* kinds, op === "stockpile", every
// preset category is a real df.stockpile_settings.flags field name, the "All" pile covers every
// category, and the lookups are frozen + complete. Catches a bad category key here, instead of as a
// silent settings no-op inside DF.
import assert from "node:assert/strict";
import {
  STOCKPILE_CATEGORIES,
  CATEGORY_KEYS,
  STOCKPILE_PRESETS,
  STOCKPILE_BY_KIND,
} from "../../client/js/stockpiles.js";

let checks = 0;
const ok = (c, m) => (assert.ok(c, m), checks++);
const isHex = (s) => typeof s === "string" && /^#[0-9a-fA-F]{6}$/.test(s);

// 1. Categories: lua-safe identifier keys, labels, uniqueness.
ok(STOCKPILE_CATEGORIES.length === 17, "17 categories");
const keys = new Set();
for (const cat of STOCKPILE_CATEGORIES) {
  ok(typeof cat.key === "string" && /^[a-z_]+$/.test(cat.key), `category key is a lua-safe identifier: ${cat.key}`);
  ok(typeof cat.label === "string" && cat.label, `category ${cat.key} has a label`);
  ok(!keys.has(cat.key), `category key unique: ${cat.key}`);
  keys.add(cat.key);
}
ok(CATEGORY_KEYS.length === STOCKPILE_CATEGORIES.length, "CATEGORY_KEYS mirrors the categories");
ok(CATEGORY_KEYS.every((k) => keys.has(k)), "CATEGORY_KEYS are all category keys");
ok(Object.isFrozen(STOCKPILE_CATEGORIES) && Object.isFrozen(CATEGORY_KEYS), "category exports frozen");

// 2. Presets: shape, unique kinds, and cats that reference only real categories.
ok(STOCKPILE_PRESETS.length >= 2, "has presets");
const kinds = new Set();
for (const o of STOCKPILE_PRESETS) {
  ok(o.op === "stockpile", `${o.kind}: op === "stockpile"`);
  ok(typeof o.kind === "string" && /^sp_[a-z_]+$/.test(o.kind), `${o.kind}: kind is sp_*`);
  ok(!kinds.has(o.kind), `kind unique: ${o.kind}`);
  kinds.add(o.kind);
  ok(typeof o.label === "string" && o.label, `${o.kind}: has label`);
  ok(typeof o.glyph === "string" && o.glyph, `${o.kind}: has glyph`);
  ok(isHex(o.accent), `${o.kind}: accent is #rrggbb`);
  ok(o.tileMode === "rect", `${o.kind}: tileMode rect (pile spans the rectangle)`);
  ok(Array.isArray(o.cats) && o.cats.length, `${o.kind}: has cats`);
  ok(o.cats.every((c) => keys.has(c)), `${o.kind}: every cat is a real category`);
  ok(new Set(o.cats).size === o.cats.length, `${o.kind}: cats are unique`);
}

// 3. The "All" preset enables every category.
const all = STOCKPILE_BY_KIND["sp_all"];
ok(all && all.cats.length === CATEGORY_KEYS.length, "sp_all covers every category");
ok(all && CATEGORY_KEYS.every((k) => all.cats.includes(k)), "sp_all includes each category key");

// 4. STOCKPILE_BY_KIND mirrors the presets exactly and is immutable.
ok(Object.isFrozen(STOCKPILE_BY_KIND), "STOCKPILE_BY_KIND is frozen");
ok(Object.keys(STOCKPILE_BY_KIND).length === STOCKPILE_PRESETS.length, "by-kind covers every preset once");
for (const o of STOCKPILE_PRESETS) ok(STOCKPILE_BY_KIND[o.kind] === o, `by-kind[${o.kind}] is its order`);

console.log(
  `stockpiles-unit OK: ${checks} checks, ${STOCKPILE_CATEGORIES.length} categories, ${STOCKPILE_PRESETS.length} presets`
);
