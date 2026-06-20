// Build palette: the categories + tool boxes shown in the bottom build menu. Shared by the client
// (display) and the bridge (placement), the same way designations.js backs the dig menu.
//
// Each order maps a palette `kind` to a DF building type/subtype plus how it places:
//   tileMode "rect"   — stamp one building per tile in a drag rectangle (constructions).
//   tileMode "single" — place one building at the drag anchor tile (workshops, furniture, …).
// The bridge (df-access.build) turns btype/subEnum/subName into a dfhack.buildings.constructBuilding
// call; the client only needs label/glyph/accent/hotkey for the menu. Enum names are authoritative
// (dumped from DF 0.53.14 via build-probe.mjs --enums). More categories arrive in step 4.

export const BUILD_CATEGORIES = [
  {
    glyph: "▣",
    label: "Construction",
    accent: "#9aa0a6",
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
];

// Flat lookup for the bridge: kind -> order (the placement params live on the order). The client
// uses the same map when it needs an order by kind.
export const BUILD_BY_KIND = Object.freeze(
  Object.fromEntries(BUILD_CATEGORIES.flatMap((c) => c.orders.map((o) => [o.kind, o])))
);
