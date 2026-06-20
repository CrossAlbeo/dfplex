// Build palette: the categories + tool boxes shown under the bottom "Build" menu. Shared by the
// client (display) and the bridge (placement), the same way designations.js backs the dig menu.
//
// Each order maps a palette `kind` to a DF building type/subtype plus how it places:
//   tileMode "rect"   — stamp one building per tile in a drag rectangle (constructions).
//   tileMode "single" — place one building at the drag anchor tile (workshops, furniture, …);
//                       multi-tile buildings (3×3 workshop, 5×5 depot, …) auto-size from that
//                       anchor — DFHack's constructBuilding fills in the footprint.
// The bridge (df-access.build) turns btype/subEnum/subName (+ optional dir) into a
// dfhack.buildings.constructBuilding call; the client only needs label/glyph/accent for the menu.
// Enum names are authoritative (dumped from DF 0.53.14 via build-probe.mjs --enums).

// Per-category accent colors (also reused by BUILDING_STYLE so a placed building matches its menu).
const CON = "#9aa0a6"; // constructions
const DOOR = "#c08a3e"; // doors, hatches, grates, bars
const WS = "#6ea8d8"; // workshops
const FUR = "#d8704a"; // furnaces
const FRN = "#b58fd0"; // furniture
const MCH = "#d8b84a"; // machines & fluids
const CAGE = "#9fb0bf"; // cages & restraints
const TRAP = "#d85a5a"; // traps & levers
const MIL = "#c04a4a"; // military
const DEPOT = "#5ab87a"; // trade depot

export const BUILD_CATEGORIES = [
  {
    glyph: "▣",
    label: "Construction",
    accent: CON,
    orders: [
      { op: "build", kind: "c_wall",      label: "Wall",          glyph: "█", accent: "#b8b8b8", tileMode: "rect", btype: "Construction", subEnum: "construction_type", subName: "Wall" },
      { op: "build", kind: "c_floor",     label: "Floor",         glyph: "▒", accent: "#8a8a8a", tileMode: "rect", btype: "Construction", subEnum: "construction_type", subName: "Floor" },
      { op: "build", kind: "c_ramp",      label: "Ramp",          glyph: "▲", accent: "#6ecd5a", tileMode: "rect", btype: "Construction", subEnum: "construction_type", subName: "Ramp" },
      { op: "build", kind: "c_upstair",   label: "Up stair",      glyph: "<", accent: "#bed23c", tileMode: "rect", btype: "Construction", subEnum: "construction_type", subName: "UpStair" },
      { op: "build", kind: "c_downstair", label: "Down stair",    glyph: ">", accent: "#508beb", tileMode: "rect", btype: "Construction", subEnum: "construction_type", subName: "DownStair" },
      { op: "build", kind: "c_udstair",   label: "U/D stair",     glyph: "X", accent: "#d25ad2", tileMode: "rect", btype: "Construction", subEnum: "construction_type", subName: "UpDownStair" },
      { op: "build", kind: "c_fortify",   label: "Fortification", glyph: "≡", accent: "#c0a060", tileMode: "rect", btype: "Construction", subEnum: "construction_type", subName: "Fortification" },
    ],
  },
  {
    glyph: "⊓",
    label: "Doors & hatches",
    accent: DOOR,
    orders: [
      { op: "build", kind: "d_door",        label: "Door",         glyph: "+", accent: DOOR, tileMode: "single", btype: "Door" },
      { op: "build", kind: "d_hatch",       label: "Floor hatch",  glyph: "◰", accent: DOOR, tileMode: "single", btype: "Hatch" },
      { op: "build", kind: "d_floodgate",   label: "Floodgate",    glyph: "▦", accent: DOOR, tileMode: "single", btype: "Floodgate" },
      { op: "build", kind: "d_grate_wall",  label: "Wall grate",   glyph: "▤", accent: DOOR, tileMode: "single", btype: "GrateWall" },
      { op: "build", kind: "d_grate_floor", label: "Floor grate",  glyph: "▦", accent: DOOR, tileMode: "single", btype: "GrateFloor" },
      { op: "build", kind: "d_bars_vert",   label: "Vertical bars",glyph: "║", accent: DOOR, tileMode: "single", btype: "BarsVertical" },
      { op: "build", kind: "d_bars_floor",  label: "Floor bars",   glyph: "═", accent: DOOR, tileMode: "single", btype: "BarsFloor" },
    ],
  },
  {
    glyph: "⚒",
    label: "Workshops",
    accent: WS,
    orders: [
      { op: "build", kind: "w_carpenter",   label: "Carpenter's",        glyph: "⚒", accent: WS, tileMode: "single", btype: "Workshop", subEnum: "workshop_type", subName: "Carpenters" },
      { op: "build", kind: "w_mason",       label: "Mason's",            glyph: "◳", accent: WS, tileMode: "single", btype: "Workshop", subEnum: "workshop_type", subName: "Masons" },
      { op: "build", kind: "w_craftsdwarf", label: "Craftsdwarf's",      glyph: "✧", accent: WS, tileMode: "single", btype: "Workshop", subEnum: "workshop_type", subName: "Craftsdwarfs" },
      { op: "build", kind: "w_mechanic",    label: "Mechanic's",         glyph: "⚙", accent: WS, tileMode: "single", btype: "Workshop", subEnum: "workshop_type", subName: "Mechanics" },
      { op: "build", kind: "w_forge",       label: "Metalsmith's forge", glyph: "⚒", accent: WS, tileMode: "single", btype: "Workshop", subEnum: "workshop_type", subName: "MetalsmithsForge" },
      { op: "build", kind: "w_jeweler",     label: "Jeweler's",          glyph: "◆", accent: WS, tileMode: "single", btype: "Workshop", subEnum: "workshop_type", subName: "Jewelers" },
      { op: "build", kind: "w_bowyer",      label: "Bowyer's",           glyph: "➶", accent: WS, tileMode: "single", btype: "Workshop", subEnum: "workshop_type", subName: "Bowyers" },
      { op: "build", kind: "w_siege",       label: "Siege workshop",     glyph: "⊗", accent: WS, tileMode: "single", btype: "Workshop", subEnum: "workshop_type", subName: "Siege" },
      { op: "build", kind: "w_butcher",     label: "Butcher's",          glyph: "⚔", accent: WS, tileMode: "single", btype: "Workshop", subEnum: "workshop_type", subName: "Butchers" },
      { op: "build", kind: "w_tanner",      label: "Tanner's",           glyph: "▭", accent: WS, tileMode: "single", btype: "Workshop", subEnum: "workshop_type", subName: "Tanners" },
      { op: "build", kind: "w_leather",     label: "Leather works",      glyph: "▱", accent: WS, tileMode: "single", btype: "Workshop", subEnum: "workshop_type", subName: "Leatherworks" },
      { op: "build", kind: "w_clothier",    label: "Clothier's",         glyph: "✄", accent: WS, tileMode: "single", btype: "Workshop", subEnum: "workshop_type", subName: "Clothiers" },
      { op: "build", kind: "w_fishery",     label: "Fishery",            glyph: "≈", accent: WS, tileMode: "single", btype: "Workshop", subEnum: "workshop_type", subName: "Fishery" },
      { op: "build", kind: "w_still",       label: "Still",              glyph: "❀", accent: WS, tileMode: "single", btype: "Workshop", subEnum: "workshop_type", subName: "Still" },
      { op: "build", kind: "w_loom",        label: "Loom",               glyph: "▤", accent: WS, tileMode: "single", btype: "Workshop", subEnum: "workshop_type", subName: "Loom" },
      { op: "build", kind: "w_quern",       label: "Quern",              glyph: "◯", accent: WS, tileMode: "single", btype: "Workshop", subEnum: "workshop_type", subName: "Quern" },
      { op: "build", kind: "w_kennels",     label: "Kennels",            glyph: "⌘", accent: WS, tileMode: "single", btype: "Workshop", subEnum: "workshop_type", subName: "Kennels" },
      { op: "build", kind: "w_kitchen",     label: "Kitchen",            glyph: "♨", accent: WS, tileMode: "single", btype: "Workshop", subEnum: "workshop_type", subName: "Kitchen" },
      { op: "build", kind: "w_ashery",      label: "Ashery",             glyph: "▦", accent: WS, tileMode: "single", btype: "Workshop", subEnum: "workshop_type", subName: "Ashery" },
      { op: "build", kind: "w_dyer",        label: "Dyer's",             glyph: "❉", accent: WS, tileMode: "single", btype: "Workshop", subEnum: "workshop_type", subName: "Dyers" },
      { op: "build", kind: "w_farmer",      label: "Farmer's",           glyph: "♣", accent: WS, tileMode: "single", btype: "Workshop", subEnum: "workshop_type", subName: "Farmers" },
      { op: "build", kind: "w_millstone",   label: "Millstone",          glyph: "◍", accent: WS, tileMode: "single", btype: "Workshop", subEnum: "workshop_type", subName: "Millstone" },
    ],
  },
  {
    glyph: "♨",
    label: "Furnaces",
    accent: FUR,
    orders: [
      { op: "build", kind: "f_wood",        label: "Wood furnace",        glyph: "♨", accent: FUR, tileMode: "single", btype: "Furnace", subEnum: "furnace_type", subName: "WoodFurnace" },
      { op: "build", kind: "f_smelter",     label: "Smelter",             glyph: "♨", accent: FUR, tileMode: "single", btype: "Furnace", subEnum: "furnace_type", subName: "Smelter" },
      { op: "build", kind: "f_glass",       label: "Glass furnace",       glyph: "◇", accent: FUR, tileMode: "single", btype: "Furnace", subEnum: "furnace_type", subName: "GlassFurnace" },
      { op: "build", kind: "f_kiln",        label: "Kiln",                glyph: "♨", accent: FUR, tileMode: "single", btype: "Furnace", subEnum: "furnace_type", subName: "Kiln" },
      { op: "build", kind: "f_magmasmelt",  label: "Magma smelter",       glyph: "♨", accent: FUR, tileMode: "single", btype: "Furnace", subEnum: "furnace_type", subName: "MagmaSmelter" },
      { op: "build", kind: "f_magmaglass",  label: "Magma glass furnace", glyph: "◇", accent: FUR, tileMode: "single", btype: "Furnace", subEnum: "furnace_type", subName: "MagmaGlassFurnace" },
      { op: "build", kind: "f_magmakiln",   label: "Magma kiln",          glyph: "♨", accent: FUR, tileMode: "single", btype: "Furnace", subEnum: "furnace_type", subName: "MagmaKiln" },
    ],
  },
  {
    glyph: "▢",
    label: "Furniture",
    accent: FRN,
    orders: [
      { op: "build", kind: "fu_bed",      label: "Bed",            glyph: "θ", accent: FRN, tileMode: "single", btype: "Bed" },
      { op: "build", kind: "fu_chair",    label: "Chair",          glyph: "h", accent: FRN, tileMode: "single", btype: "Chair" },
      { op: "build", kind: "fu_table",    label: "Table",          glyph: "╥", accent: FRN, tileMode: "single", btype: "Table" },
      { op: "build", kind: "fu_cabinet",  label: "Cabinet",        glyph: "▤", accent: FRN, tileMode: "single", btype: "Cabinet" },
      { op: "build", kind: "fu_coffer",   label: "Coffer",         glyph: "▢", accent: FRN, tileMode: "single", btype: "Box" },
      { op: "build", kind: "fu_statue",   label: "Statue",         glyph: "☻", accent: FRN, tileMode: "single", btype: "Statue" },
      { op: "build", kind: "fu_coffin",   label: "Coffin",         glyph: "⚰", accent: FRN, tileMode: "single", btype: "Coffin" },
      { op: "build", kind: "fu_slab",     label: "Slab",           glyph: "▬", accent: FRN, tileMode: "single", btype: "Slab" },
      { op: "build", kind: "fu_bookcase", label: "Bookcase",       glyph: "▥", accent: FRN, tileMode: "single", btype: "Bookcase" },
      { op: "build", kind: "fu_nestbox",  label: "Nest box",       glyph: "◓", accent: FRN, tileMode: "single", btype: "NestBox" },
      { op: "build", kind: "fu_hive",     label: "Hive",           glyph: "⬡", accent: FRN, tileMode: "single", btype: "Hive" },
      { op: "build", kind: "fu_well",     label: "Well",           glyph: "○", accent: FRN, tileMode: "single", btype: "Well" },
      { op: "build", kind: "fu_traction", label: "Traction bench", glyph: "≡", accent: FRN, tileMode: "single", btype: "TractionBench" },
      { op: "build", kind: "fu_offering", label: "Offering place", glyph: "⊕", accent: FRN, tileMode: "single", btype: "OfferingPlace" },
    ],
  },
  {
    glyph: "⚙",
    label: "Machines & fluids",
    accent: MCH,
    orders: [
      { op: "build", kind: "m_gear",       label: "Gear assembly",   glyph: "✲", accent: MCH, tileMode: "single", btype: "GearAssembly" },
      { op: "build", kind: "m_vaxle",      label: "Vertical axle",   glyph: "•", accent: MCH, tileMode: "single", btype: "AxleVertical" },
      { op: "build", kind: "m_haxle",      label: "Horizontal axle", glyph: "─", accent: MCH, tileMode: "single", btype: "AxleHorizontal", dir: 0 },
      { op: "build", kind: "m_screwpump",  label: "Screw pump",      glyph: "Φ", accent: MCH, tileMode: "single", btype: "ScrewPump", dir: 0 },
      { op: "build", kind: "m_waterwheel", label: "Water wheel",     glyph: "◍", accent: MCH, tileMode: "single", btype: "WaterWheel", dir: 0 },
      { op: "build", kind: "m_windmill",   label: "Windmill",        glyph: "✦", accent: MCH, tileMode: "single", btype: "Windmill" },
      { op: "build", kind: "m_rollers",    label: "Rollers",         glyph: "▭", accent: MCH, tileMode: "single", btype: "Rollers", dir: 0 },
    ],
  },
  {
    glyph: "▓",
    label: "Cages & restraints",
    accent: CAGE,
    orders: [
      { op: "build", kind: "cg_cage",      label: "Cage",      glyph: "▓", accent: CAGE, tileMode: "single", btype: "Cage" },
      { op: "build", kind: "cg_restraint", label: "Restraint", glyph: "§", accent: CAGE, tileMode: "single", btype: "Chain" },
    ],
  },
  {
    glyph: "^",
    label: "Traps & levers",
    accent: TRAP,
    orders: [
      { op: "build", kind: "t_lever",      label: "Lever",           glyph: "⌐", accent: TRAP, tileMode: "single", btype: "Trap", subEnum: "trap_type", subName: "Lever" },
      { op: "build", kind: "t_pressure",   label: "Pressure plate",  glyph: "▣", accent: TRAP, tileMode: "single", btype: "Trap", subEnum: "trap_type", subName: "PressurePlate" },
      { op: "build", kind: "t_cagetrap",   label: "Cage trap",       glyph: "▒", accent: TRAP, tileMode: "single", btype: "Trap", subEnum: "trap_type", subName: "CageTrap" },
      { op: "build", kind: "t_stonefall",  label: "Stone-fall trap", glyph: "▼", accent: TRAP, tileMode: "single", btype: "Trap", subEnum: "trap_type", subName: "StoneFallTrap" },
      { op: "build", kind: "t_weapontrap", label: "Weapon trap",     glyph: "‡", accent: TRAP, tileMode: "single", btype: "Trap", subEnum: "trap_type", subName: "WeaponTrap" },
      { op: "build", kind: "t_trackstop",  label: "Track stop",      glyph: "⊓", accent: TRAP, tileMode: "single", btype: "Trap", subEnum: "trap_type", subName: "TrackStop" },
      { op: "build", kind: "t_animaltrap", label: "Animal trap",     glyph: "∩", accent: TRAP, tileMode: "single", btype: "AnimalTrap" },
    ],
  },
  {
    glyph: "↑",
    label: "Military",
    accent: MIL,
    orders: [
      { op: "build", kind: "mil_archery",    label: "Archery target", glyph: "◎", accent: MIL, tileMode: "single", btype: "ArcheryTarget" },
      { op: "build", kind: "mil_weaponrack", label: "Weapon rack",    glyph: "↑", accent: MIL, tileMode: "single", btype: "Weaponrack" },
      { op: "build", kind: "mil_armorstand", label: "Armor stand",    glyph: "†", accent: MIL, tileMode: "single", btype: "Armorstand" },
    ],
  },
  {
    glyph: "$",
    label: "Trade depot",
    accent: DEPOT,
    orders: [
      { op: "build", kind: "depot", label: "Trade depot", glyph: "$", accent: DEPOT, tileMode: "single", btype: "TradeDepot" },
    ],
  },
];

// Flat lookup for the bridge: kind -> order (the placement params live on the order). The client
// uses the same map when it needs an order by kind.
export const BUILD_BY_KIND = Object.freeze(
  Object.fromEntries(BUILD_CATEGORIES.flatMap((c) => c.orders.map((o) => [o.kind, o])))
);

// Per-building-type render style, keyed by DF building_type number (authoritative, dumped from DF
// 0.53.14). The renderer draws fort/placed buildings with this glyph + accent. Many subtypes share
// one building_type (all workshops are 13, all furnaces 5, all traps 23), so this is type-level; the
// menu carries the finer per-subtype glyphs.
const STYLE = {
  0: { g: "h", a: FRN }, 1: { g: "θ", a: FRN }, 2: { g: "╥", a: FRN }, 3: { g: "⚰", a: FRN },
  4: { g: "≈", a: "#6ecd5a" }, 5: { g: "♨", a: FUR }, 6: { g: "$", a: DEPOT }, 8: { g: "+", a: DOOR },
  9: { g: "▦", a: DOOR }, 10: { g: "▢", a: FRN }, 11: { g: "↑", a: MIL }, 12: { g: "†", a: MIL },
  13: { g: "⚒", a: WS }, 14: { g: "▤", a: FRN }, 15: { g: "☻", a: FRN }, 18: { g: "○", a: FRN },
  19: { g: "═", a: CON }, 22: { g: "⊗", a: MIL }, 23: { g: "^", a: TRAP }, 24: { g: "∩", a: TRAP },
  25: { g: "Π", a: CON }, 26: { g: "◎", a: MIL }, 27: { g: "§", a: CAGE }, 28: { g: "▓", a: CAGE },
  29: { g: "▦", a: "#8a8a8a" }, 32: { g: "▄", a: DOOR }, 33: { g: "Φ", a: MCH }, 34: { g: "▒", a: CON },
  35: { g: "◰", a: DOOR }, 36: { g: "▤", a: DOOR }, 37: { g: "▦", a: DOOR }, 38: { g: "║", a: DOOR },
  39: { g: "═", a: DOOR }, 40: { g: "✲", a: MCH }, 41: { g: "─", a: MCH }, 42: { g: "•", a: MCH },
  43: { g: "◍", a: MCH }, 44: { g: "✦", a: MCH }, 45: { g: "≡", a: FRN }, 46: { g: "▬", a: FRN },
  48: { g: "◓", a: FRN }, 49: { g: "⬡", a: FRN }, 50: { g: "▭", a: MCH }, 52: { g: "▥", a: FRN },
  54: { g: "⊕", a: FRN },
};
const DEFAULT_STYLE = Object.freeze({ g: "⌂", a: CON });
export const BUILDING_STYLE = Object.freeze(STYLE);

/** Render style ({ g, a }) for a building_type number, with a generic fallback. */
export function styleFor(bt) {
  return STYLE[bt >>> 0] || DEFAULT_STYLE;
}
