// Unit test for the shared designation metadata (client/js/designations.js): the order list is
// well-formed and the on-map DESIG_STYLE is correctly derived from it, so the bottom order bar
// and the map renderer can never drift apart. Usage: node bridge/test/designations.mjs
import { ORDERS, DESIG_STYLE, DESIG_FALLBACK } from "../../client/js/designations.js";

let fail = 0;
const ok = (c, m) => (c ? console.log("  ok  -", m) : (console.error("  FAIL-", m), fail++));
const uniq = (xs) => new Set(xs).size === xs.length;

ok(ORDERS.length >= 7, `ORDERS has all kinds (${ORDERS.length})`);
ok(uniq(ORDERS.map((o) => o.kind)), "kinds are unique");
ok(uniq(ORDERS.map((o) => o.hotkey)), "hotkeys are unique");
ok(uniq(ORDERS.map((o) => o.d)), "designation enum values are unique");
ok(ORDERS.every((o) => /^#[0-9a-f]{6}$/i.test(o.accent)), "every order has a hex accent colour");

// DESIG_STYLE must cover exactly the diggable orders (d > 0), and match each order's glyph
// (plain dig is tint-only).
const expectKeys = ORDERS.filter((o) => o.d > 0).map((o) => String(o.d)).sort();
ok(JSON.stringify(Object.keys(DESIG_STYLE).sort()) === JSON.stringify(expectKeys),
  `DESIG_STYLE keys = diggable enums (${Object.keys(DESIG_STYLE).sort().join(",")})`);

for (const o of ORDERS) {
  if (o.d <= 0) continue;
  const s = DESIG_STYLE[o.d];
  const wantGlyph = o.d === 1 ? "" : o.glyph;
  ok(s && /^rgba\(/.test(s.fill) && s.glyph === wantGlyph,
    `d=${o.d} (${o.kind}): fill set, glyph='${s ? s.glyph : "?"}' (want '${wantGlyph}')`);
}

ok(/^rgba\(/.test(DESIG_FALLBACK.fill) && typeof DESIG_FALLBACK.glyph === "string", "DESIG_FALLBACK well-formed");

console.log(fail ? `\n${fail} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
process.exit(fail ? 1 : 0);
