// Activity-zone palette: the tools under the Place ▸ Zones menu. Shared by the client (the menu +
// per-subtype render style) and the bridge (placement), the same way buildings.js backs Build and
// stockpiles.js backs Stockpiles.
//
// A DF activity zone is an *abstract* civzone (df.building_type.Civzone = 30) whose "use" — Meeting
// Area, Pen/Pasture, Pit/Pond, … — is the building SUBTYPE, a df.civzone_type value. The bridge
// (df-access.zone) creates one with dfhack.buildings.constructBuilding{type=Civzone, subtype=<civ>}
// and flips spec_sub_flag.active, mirroring DFHack's own quickfort/zone.lua recipe. The created zone
// streams back on the normal buildings channel as { bt:30, st:<civ number> } (confirmed via
// zone-probe.mjs), so it renders for free — keyed on the subtype here.
//
// `civ` is the df.civzone_type enum NAME (the only token the bridge interpolates, re-checked against
// ZONE_CIV_NAMES); `subtype` is its number on this DF build (DF 0.53.14, dumped via zone-probe.mjs) —
// used only client-side to pick the render glyph from the streamed `st`.

const ZA = "#3c9dba"; // zones menu accent

// df.building_type.Civzone — the building_type every activity zone streams back as (its use is in st).
export const CIVZONE_BUILDING_TYPE = 30;

// One zone menu order. tileMode "rect": the client sends the whole drag rectangle and the bridge spans
// one zone across its bounding box (like a stockpile preset).
const z = (kind, civ, subtype, label, glyph, accent) =>
  Object.freeze({ op: "zone", kind, civ, subtype, label, glyph, accent, tileMode: "rect" });

// The Zones menu — DF's full activity-zone set (the 18 uses in the in-game Zones palette). Order
// follows the in-game menu (left column then right).
export const ZONE_PRESETS = Object.freeze([
  z("z_meeting",     "MeetingHall",    87, "Meeting Area",    "☺", "#5ab87a"),
  z("z_bedroom",     "Bedroom",        92, "Bedroom",         "θ", "#b58fd0"),
  z("z_dining",      "DiningHall",     80, "Dining Hall",     "╥", "#d8a84a"),
  z("z_pen",         "Pen",            88, "Pen/Pasture",     "♞", "#8d6e3a"),
  z("z_pond",        "Pond",           86, "Pit/Pond",        "○", "#4a7fd8"),
  z("z_water",       "WaterSource",    82, "Water Source",    "≈", "#4aa3d8"),
  z("z_dungeon",     "Dungeon",        96, "Dungeon",         "Π", "#9a6ea0"),
  z("z_fishing",     "FishingArea",    85, "Fishing",         "≋", "#4a90c8"),
  z("z_sand",        "SandCollection", 84, "Sand",            "░", "#d8c878"),
  z("z_office",      "Office",         93, "Office",          "⌂", "#c0a060"),
  z("z_dormitory",   "Dormitory",      79, "Dormitory",       "≡", "#a98fd0"),
  z("z_barracks",    "Barracks",       95, "Barracks",        "↑", "#c04a4a"),
  z("z_archery",     "ArcheryRange",   94, "Archery Range",   "◎", "#c85a5a"),
  z("z_dump",        "Dump",           83, "Garbage Dump",    "⊗", "#9aa0a6"),
  z("z_animaltrain", "AnimalTraining", 90, "Animal Training", "⌘", "#8d6e3a"),
  z("z_tomb",        "Tomb",           97, "Tomb",            "⚰", "#9a9aa0"),
  z("z_gather",      "PlantGathering", 91, "Gather Fruit",    "♣", "#5aa84f"),
  z("z_clay",        "ClayCollection", 89, "Clay",            "▣", "#c08a5a"),
]);

// Flat lookup for the bridge: kind -> zone order (carries `civ` + per-type config). The client uses
// the same orders directly in its menu.
export const ZONE_BY_KIND = Object.freeze(
  Object.fromEntries(ZONE_PRESETS.map((o) => [o.kind, o]))
);

// Valid df.civzone_type names — the bridge re-checks each preset's `civ` against this before building
// Lua, so only a known enum identifier is ever interpolated (belt-and-suspenders; presets are trusted).
export const ZONE_CIV_NAMES = Object.freeze(ZONE_PRESETS.map((o) => o.civ));

// Render style keyed by civzone_type NUMBER (the streamed building subtype `st`). Built from the preset
// table so the menu glyph and the on-map glyph always agree.
const ZONE_STYLE = Object.freeze(
  Object.fromEntries(ZONE_PRESETS.map((o) => [o.subtype, Object.freeze({ g: o.glyph, a: o.accent })]))
);
const ZONE_DEFAULT = Object.freeze({ g: "⬚", a: ZA });

/** Render style ({ g, a }) for an activity zone, keyed by its streamed civzone_type subtype `st`. */
export function zoneStyleFor(st) {
  return ZONE_STYLE[st >>> 0] || ZONE_DEFAULT;
}
