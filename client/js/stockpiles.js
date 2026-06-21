// Stockpile presets + item categories. Shared by the client (the Stockpiles menu now; the per-pile
// category editor next) and the bridge (placement + configuration), the same way buildings.js backs
// the build menu. A stockpile created over RFR/Lua accepts NOTHING until its df.stockpile_settings are
// configured, so every preset lists which item categories to switch on; the bridge sets
// settings.flags.<cat> (the master enable the DF UI toggles) plus that category's sub-item flags.
//
// Category keys are the df.stockpile_settings.flags field names (dumped from DF 0.53.14 via
// stockpile-probe.mjs). The pile is built abstract=true (no materials), as Stockpile (building_type
// 29), which already has a render style in buildings.js, so a placed pile streams + renders for free.

const SP = "#c9a227"; // stockpile menu accent

// The 17 toggleable stockpile categories (df.stockpile_settings.flags booleans), in DF's menu order,
// each with a display label. Drives the preset cat-lists below and (next slice) the editor panel.
export const STOCKPILE_CATEGORIES = Object.freeze(
  [
    { key: "animals", label: "Animals" },
    { key: "food", label: "Food" },
    { key: "furniture", label: "Furniture" },
    { key: "corpses", label: "Corpses" },
    { key: "refuse", label: "Refuse" },
    { key: "stone", label: "Stone" },
    { key: "wood", label: "Wood" },
    { key: "gems", label: "Gems" },
    { key: "bars_blocks", label: "Bars & Blocks" },
    { key: "cloth", label: "Cloth" },
    { key: "leather", label: "Leather" },
    { key: "ammo", label: "Ammo" },
    { key: "coins", label: "Coins" },
    { key: "finished_goods", label: "Finished Goods" },
    { key: "weapons", label: "Weapons" },
    { key: "armor", label: "Armor" },
    { key: "sheet", label: "Sheets" },
  ].map(Object.freeze)
);

// Valid category keys — the bridge filters every preset's cats through this before building Lua, so
// only known field names ever reach df.stockpile_settings (belt-and-suspenders; presets are trusted).
export const CATEGORY_KEYS = Object.freeze(STOCKPILE_CATEGORIES.map((c) => c.key));
const ALL = CATEGORY_KEYS;

// One preset menu order. cats = which categories the placed pile accepts. tileMode "rect": the client
// sends the whole drag rectangle and the bridge spans one pile across its bounding box.
const sp = (kind, label, glyph, cats) =>
  Object.freeze({ op: "stockpile", kind, label, glyph, accent: SP, tileMode: "rect", cats: Object.freeze(cats) });

// The Stockpiles menu: an "All" pile plus DF's classic one-type piles. Drag a rectangle to place one
// pile spanning it, pre-configured to the chosen type. (Fine-grained per-pile editing arrives with the
// category editor.)
export const STOCKPILE_PRESETS = Object.freeze([
  sp("sp_all", "All", "▦", ALL),
  sp("sp_animals", "Animals", "☺", ["animals"]),
  sp("sp_food", "Food", "♨", ["food"]),
  sp("sp_furniture", "Furniture", "▢", ["furniture"]),
  sp("sp_corpses", "Corpses", "‡", ["corpses"]),
  sp("sp_refuse", "Refuse", "☣", ["refuse"]),
  sp("sp_stone", "Stone", "●", ["stone"]),
  sp("sp_wood", "Wood", "♣", ["wood"]),
  sp("sp_gems", "Gems", "◆", ["gems"]),
  sp("sp_bars", "Bars & Blocks", "▬", ["bars_blocks"]),
  sp("sp_cloth", "Cloth", "≈", ["cloth"]),
  sp("sp_leather", "Leather", "▱", ["leather"]),
  sp("sp_ammo", "Ammo", "➹", ["ammo"]),
  sp("sp_coins", "Coins", "¢", ["coins"]),
  sp("sp_goods", "Finished Goods", "✦", ["finished_goods"]),
  sp("sp_weapons", "Weapons", "↑", ["weapons"]),
  sp("sp_armor", "Armor", "†", ["armor"]),
  sp("sp_sheet", "Sheets", "▤", ["sheet"]),
]);

// Flat lookup for the bridge: kind -> preset order (carries the cat list). The client uses the same
// orders directly in its menu.
export const STOCKPILE_BY_KIND = Object.freeze(
  Object.fromEntries(STOCKPILE_PRESETS.map((o) => [o.kind, o]))
);
