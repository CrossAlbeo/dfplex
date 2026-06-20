// Headless unit test for the build palette (client/js/buildings.js). No DF, no bridge — pure data
// invariants, so it runs anywhere with `node bridge/test/buildings-unit.mjs`. It guards the palette
// that the browser menu and the bridge placement both read: unique kinds, valid building_type /
// subtype *enum names* (checked against an authoritative DF 0.53.14 dump), tileMode discipline, and
// that every placeable type has a render style. This catches an enum typo (e.g. "Carpenter" vs
// "Carpenters", or a subName that doesn't belong to its subEnum) here, instead of as a silent
// constructBuilding failure inside DF.
import assert from "node:assert/strict";
import {
  BUILD_CATEGORIES,
  BUILD_BY_KIND,
  BUILDING_STYLE,
  styleFor,
} from "../../client/js/buildings.js";

// Authoritative enum name -> number, dumped from DF 0.53.14 via build-probe.mjs --enums. The bridge
// interpolates `df.building_type.<btype>` / `df.<subEnum>.<subName>` into Lua, so a name absent here
// would be a name absent in DF too.
const BUILDING_TYPE = {
  Chair: 0, Bed: 1, Table: 2, Coffin: 3, FarmPlot: 4, Furnace: 5, TradeDepot: 6, Door: 8,
  Floodgate: 9, Box: 10, Weaponrack: 11, Armorstand: 12, Workshop: 13, Cabinet: 14, Statue: 15,
  Well: 18, Bridge: 19, SiegeEngine: 22, Trap: 23, AnimalTrap: 24, Support: 25, ArcheryTarget: 26,
  Chain: 27, Cage: 28, Stockpile: 29, Wagon: 32, ScrewPump: 33, Construction: 34, Hatch: 35,
  GrateWall: 36, GrateFloor: 37, BarsVertical: 38, BarsFloor: 39, GearAssembly: 40,
  AxleHorizontal: 41, AxleVertical: 42, WaterWheel: 43, Windmill: 44, TractionBench: 45, Slab: 46,
  NestBox: 48, Hive: 49, Rollers: 50, Bookcase: 52, OfferingPlace: 54,
};
const SUBENUMS = {
  construction_type: new Set([
    "Fortification", "Wall", "Floor", "UpStair", "DownStair", "UpDownStair", "Ramp",
  ]),
  workshop_type: new Set([
    "Carpenters", "Farmers", "Masons", "Craftsdwarfs", "Jewelers", "MetalsmithsForge", "MagmaForge",
    "Bowyers", "Mechanics", "Siege", "Butchers", "Leatherworks", "Tanners", "Clothiers", "Fishery",
    "Still", "Loom", "Quern", "Kennels", "Kitchen", "Ashery", "Dyers", "Millstone", "Custom", "Tool",
  ]),
  furnace_type: new Set([
    "WoodFurnace", "Smelter", "GlassFurnace", "Kiln", "MagmaSmelter", "MagmaGlassFurnace",
    "MagmaKiln", "Custom",
  ]),
  trap_type: new Set([
    "Lever", "PressurePlate", "CageTrap", "StoneFallTrap", "WeaponTrap", "TrackStop",
  ]),
};
const isHex = (s) => typeof s === "string" && /^#[0-9a-fA-F]{6}$/.test(s);

let checks = 0;
const ok = (cond, msg) => {
  assert.ok(cond, msg);
  checks++;
};

const orders = BUILD_CATEGORIES.flatMap((c) => c.orders);

// 1. Categories are well-formed.
ok(BUILD_CATEGORIES.length >= 1, "at least one category");
for (const c of BUILD_CATEGORIES) {
  ok(typeof c.label === "string" && c.label, `category has label`);
  ok(typeof c.glyph === "string" && c.glyph, `category ${c.label} has glyph`);
  ok(isHex(c.accent), `category ${c.label} accent is #rrggbb`);
  ok(Array.isArray(c.orders) && c.orders.length, `category ${c.label} has orders`);
}

// 2. Orders are well-formed and reference only real enum names.
const kinds = new Set();
for (const o of orders) {
  ok(o.op === "build", `${o.kind}: op === "build"`);
  ok(typeof o.kind === "string" && o.kind, `order has a kind (${o.label})`);
  ok(!kinds.has(o.kind), `kind is unique: ${o.kind}`);
  kinds.add(o.kind);
  ok(typeof o.label === "string" && o.label, `${o.kind}: has label`);
  ok(typeof o.glyph === "string" && o.glyph, `${o.kind}: has glyph`);
  ok(isHex(o.accent), `${o.kind}: accent is #rrggbb`);
  ok(o.tileMode === "rect" || o.tileMode === "single", `${o.kind}: tileMode rect|single`);
  ok(o.btype in BUILDING_TYPE, `${o.kind}: btype "${o.btype}" is a real building_type`);
  // Rectangle placement is constructions-only; every other building stamps one anchor tile.
  ok((o.tileMode === "rect") === (o.btype === "Construction"), `${o.kind}: rect iff Construction`);
  // Subtype discipline: subEnum and subName travel together, and the name must belong to the enum.
  if (o.subEnum || o.subName) {
    ok(o.subEnum && o.subName, `${o.kind}: subEnum and subName both present`);
    ok(o.subEnum in SUBENUMS, `${o.kind}: subEnum "${o.subEnum}" is known`);
    ok(SUBENUMS[o.subEnum].has(o.subName), `${o.kind}: "${o.subName}" is in ${o.subEnum}`);
  }
  // dir (directional machines) is a small non-negative integer when present.
  if ("dir" in o) ok(Number.isInteger(o.dir) && o.dir >= 0, `${o.kind}: dir is a non-negative int`);
  // Every placeable type must have a render style, so a placed building never falls back to the
  // generic glyph in the renderer.
  ok(BUILDING_STYLE[BUILDING_TYPE[o.btype]], `${o.kind}: BUILDING_STYLE has btype ${o.btype}`);
}

// 3. BUILD_BY_KIND mirrors the orders exactly and is immutable.
ok(Object.isFrozen(BUILD_BY_KIND), "BUILD_BY_KIND is frozen");
ok(Object.keys(BUILD_BY_KIND).length === orders.length, "BUILD_BY_KIND covers every order once");
for (const o of orders) ok(BUILD_BY_KIND[o.kind] === o, `BUILD_BY_KIND[${o.kind}] is its order`);

// 4. styleFor: known type, shared fallback for unknowns, and junk-tolerant (bt >>> 0).
ok(styleFor(13).g === "⚒", "styleFor(13) -> workshop glyph");
ok(styleFor(6).g === "$", "styleFor(6) -> depot glyph");
ok(styleFor(9999) === styleFor(9998), "unknown bt -> one shared default object");
ok(styleFor(9999).g === "⌂", "unknown bt -> default glyph");
ok(styleFor(-1).g && styleFor(undefined).g, "styleFor tolerates negative/undefined");
ok(Object.isFrozen(BUILDING_STYLE), "BUILDING_STYLE is frozen");
for (const [k, v] of Object.entries(BUILDING_STYLE)) {
  ok(typeof v.g === "string" && v.g, `style ${k}: has glyph`);
  ok(isHex(v.a), `style ${k}: accent is #rrggbb`);
}

console.log(
  `buildings-unit OK: ${checks} checks, ${BUILD_CATEGORIES.length} categories, ${orders.length} orders`
);
