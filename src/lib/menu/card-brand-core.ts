/**
 * SLICE 47 (owner Q4) — brand-else-vendor card label + display-name clipping.
 *
 * Owner directive: on the WEBSITE, the label above a product picture shows the
 * brand; when there is no brand it shows the vendor; when there is neither it
 * shows nothing. When a label IS shown, clip that label from the front of the
 * displayed product name so the card doesn't read "Fairwinds — Fairwinds
 * Healing Balm". This is DISPLAY-ONLY: item.name itself is never mutated, so
 * search, filters, admin screens, carts, receipts, and CCRS reporting all keep
 * the full untouched name.
 *
 * Real-data notes (verified against the actual Cultivera export, 3,005 cards):
 *  - the POS transform guarantees a non-blank brand (it falls back to
 *    "Greenway" when both workbooks are blank), so the vendor fallback mainly
 *    serves intake-created menu items whose DB brand_name defaults to '';
 *  - 11 real cards carry the brand MID-name (e.g. "Soda Baja Blaze" with brand
 *    "Blaze") — clipping mid-name occurrences would corrupt names, so clipping
 *    is PREFIX-ONLY;
 *  - brands like "Lil' Ray's Lemonade" appear in names with different
 *    apostrophe casing ("Lil' Ray'S Lemonade Citrus Kush"), so matching is
 *    case- and punctuation-insensitive.
 *
 * NO I/O — unit-testable via __runCardBrandCoreTests() (registered in
 * scripts/compliance/run-pure-selftests.ts).
 */

export type CardLabel = {
  /** Text to show above the product picture, or null to show nothing. */
  label: string | null;
  /** Where the label came from — "brand" labels may link to the brand filter. */
  source: "brand" | "vendor" | null;
};

/**
 * Brand-else-vendor-else-nothing. Whitespace-only values count as absent.
 */
export function cardLabelFor(brand: string | null | undefined, vendor: string | null | undefined): CardLabel {
  const b = (brand ?? "").trim();
  if (b) return { label: b, source: "brand" };
  const v = (vendor ?? "").trim();
  if (v) return { label: v, source: "vendor" };
  return { label: null, source: null };
}

/** Escape a string for use inside a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Clip a shown label from the FRONT of a display name (website display only).
 *
 * Matching is deliberately conservative:
 *  - prefix-only — a label appearing mid-name is left alone ("Soda Baja Blaze"
 *    with brand "Blaze" stays intact);
 *  - case-insensitive and punctuation-insensitive — the label is tokenized to
 *    alphanumeric runs joined by any non-alphanumeric characters, so
 *    "Lil' Ray's Lemonade" clips from "Lil' Ray'S Lemonade Citrus Kush";
 *  - a word boundary is required after the label ("Ooowee" never clips from
 *    "Oooweet Treats");
 *  - the remainder must be a real name (3+ characters) or the original name is
 *    kept unchanged — a product literally named after its brand keeps its name.
 */
export function clipLabelFromName(name: string, label: string | null | undefined): string {
  const original = (name ?? "").trim();
  const lbl = (label ?? "").trim();
  if (!original || !lbl) return original;

  const tokens = lbl.match(/[a-z0-9]+/gi);
  if (!tokens || tokens.length === 0) return original;

  const pattern = new RegExp(
    `^[^a-z0-9]*${tokens.map(escapeRegExp).join("[^a-z0-9]+")}(?:[^a-z0-9]+|$)`,
    "i",
  );
  const match = original.match(pattern);
  if (!match) return original;

  const remainder = original.slice(match[0].length).trim();
  if (remainder.length < 3) return original;
  return remainder;
}

/**
 * One-call convenience: resolve the label and the clipped display name for a
 * menu item. `name` keeps its full value when no label is shown.
 */
export function cardDisplay(item: { name: string; brand?: string | null; vendor?: string | null }): {
  label: string | null;
  source: "brand" | "vendor" | null;
  name: string;
} {
  const { label, source } = cardLabelFor(item.brand, item.vendor);
  return { label, source, name: clipLabelFromName(item.name, label) };
}

// ---------------------------------------------------------------------------
// Self-tests (pure, no I/O)
// ---------------------------------------------------------------------------
export function __runCardBrandCoreTests(): void {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`card-brand-core self-test failed: ${msg}`);
    passed += 1;
  };

  // --- cardLabelFor: brand else vendor else nothing ---
  ok(cardLabelFor("Fairwinds", "Vendor Co").label === "Fairwinds", "brand wins over vendor");
  ok(cardLabelFor("Fairwinds", "Vendor Co").source === "brand", "brand source reported");
  ok(cardLabelFor("", "Seattle Bubble Works").label === "Seattle Bubble Works", "blank brand falls to vendor");
  ok(cardLabelFor("", "Seattle Bubble Works").source === "vendor", "vendor source reported");
  ok(cardLabelFor("   ", "Vendor Co").label === "Vendor Co", "whitespace-only brand counts as absent");
  ok(cardLabelFor("", "").label === null, "neither -> null label");
  ok(cardLabelFor(null, undefined).label === null, "null/undefined -> null label");
  ok(cardLabelFor(null, undefined).source === null, "null source when hidden");
  ok(cardLabelFor("  Phat Panda  ", "").label === "Phat Panda", "label trimmed");

  // --- clipLabelFromName: prefix-only, punctuation/case-insensitive ---
  ok(clipLabelFromName("Fairwinds Healing Balm", "Fairwinds") === "Healing Balm", "simple prefix clips");
  ok(clipLabelFromName("fairwinds Healing Balm", "Fairwinds") === "Healing Balm", "case-insensitive clip");
  ok(clipLabelFromName("Fairwinds - Healing Balm", "Fairwinds") === "Healing Balm", "separator after label consumed");
  ok(clipLabelFromName("Lil' Ray'S Lemonade Citrus Kush", "Lil' Ray's Lemonade") === "Citrus Kush",
    "apostrophe/case variants clip (real data)");
  ok(clipLabelFromName("2727 Doh Dragon'S Piss", "2727") === "Doh Dragon'S Piss", "numeric brand clips (real data)");
  ok(clipLabelFromName("Soda Baja Blaze", "Blaze") === "Soda Baja Blaze", "mid-name brand NOT clipped (real data)");
  ok(clipLabelFromName("Green Revolution Mini Doozies Blue Raspberry", "Doozies") === "Green Revolution Mini Doozies Blue Raspberry",
    "mid-name brand NOT clipped (real data #2)");
  ok(clipLabelFromName("Oooweet Treats", "Ooowee") === "Oooweet Treats", "word boundary required after label");
  ok(clipLabelFromName("Ooowee Marker", "Ooowee") === "Marker", "boundary-respecting clip still works");
  ok(clipLabelFromName("Fairwinds", "Fairwinds") === "Fairwinds", "name == label keeps original (empty remainder)");
  ok(clipLabelFromName("Fairwinds Co", "Fairwinds") === "Fairwinds Co", "sub-3-char remainder keeps original");
  ok(clipLabelFromName("Blue Dream", "") === "Blue Dream", "blank label -> untouched");
  ok(clipLabelFromName("Blue Dream", null) === "Blue Dream", "null label -> untouched");
  ok(clipLabelFromName("", "Fairwinds") === "", "blank name stays blank");
  ok(clipLabelFromName("C&C Gummies (Special)", "C&C.") === "Gummies (Special)", "regex-special chars in label are safe");
  ok(clipLabelFromName("  Fairwinds   Healing Balm  ", "Fairwinds") === "Healing Balm", "whitespace normalized at edges");

  // --- cardDisplay: integration ---
  const d1 = cardDisplay({ name: "Fairwinds Healing Balm", brand: "Fairwinds", vendor: "Someone" });
  ok(d1.label === "Fairwinds" && d1.name === "Healing Balm" && d1.source === "brand", "cardDisplay clips shown brand");
  const d2 = cardDisplay({ name: "Seattle Bubble Works Hash", brand: "", vendor: "Seattle Bubble Works" });
  ok(d2.label === "Seattle Bubble Works" && d2.name === "Hash" && d2.source === "vendor", "cardDisplay clips shown vendor");
  const d3 = cardDisplay({ name: "Blue Dream", brand: "", vendor: "" });
  ok(d3.label === null && d3.name === "Blue Dream" && d3.source === null, "cardDisplay hides label, keeps name");
  const d4 = cardDisplay({ name: "Soda Baja Blaze", brand: "Blaze" });
  ok(d4.label === "Blaze" && d4.name === "Soda Baja Blaze", "cardDisplay never clips mid-name");

  console.log(`card-brand-core: ${passed} assertions passed`);
}
