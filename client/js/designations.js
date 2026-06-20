// Single source of truth for dig designations, shared by the renderer (how a designation looks
// on the map) and the app (the bottom order bar). Each order maps a dfplex command `kind` to its
// RFR TileDigDesignation enum value `d`, a button glyph, an accent colour, and a 1-key hotkey.
export const ORDERS = [
  { kind: "dig",         d: 1, label: "Dig",        glyph: "▒", accent: "#e89628", hotkey: "1" },
  { kind: "channel",     d: 3, label: "Channel",    glyph: "↓", accent: "#3cb9dc", hotkey: "2" },
  { kind: "upstair",     d: 6, label: "Up stair",   glyph: "<", accent: "#bed23c", hotkey: "3" },
  { kind: "downstair",   d: 5, label: "Down stair", glyph: ">", accent: "#508beb", hotkey: "4" },
  { kind: "updownstair", d: 2, label: "U/D stair",  glyph: "X", accent: "#d25ad2", hotkey: "5" },
  { kind: "ramp",        d: 4, label: "Ramp",       glyph: "▲", accent: "#6ecd5a", hotkey: "6" },
  { kind: "remove",      d: 0, label: "Remove",     glyph: "✕", accent: "#9aa0a6", hotkey: "7" },
];

function tint(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// RFR TileDigDesignation enum value -> on-map tint + glyph, derived from ORDERS so the map and
// the order bar always agree. Plain dig (1) is tint-only; remove (0) leaves no mark.
export const DESIG_STYLE = {};
for (const o of ORDERS) {
  if (o.d > 0) DESIG_STYLE[o.d] = { fill: tint(o.accent, o.d === 1 ? 0.4 : 0.46), glyph: o.d === 1 ? "" : o.glyph };
}
export const DESIG_FALLBACK = { fill: "rgba(232,201,58,0.34)", glyph: "?" };
