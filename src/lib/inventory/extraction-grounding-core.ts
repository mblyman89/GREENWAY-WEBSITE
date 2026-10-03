/**
 * src/lib/inventory/extraction-grounding-core.ts  (R26, PURE)
 *
 * GROUNDING: a value read by the vision parser (LlamaParse) is only trusted
 * when the PDF's own text layer contains it.
 *
 * WHY (enterprise practice + our own evidence, never assumed):
 *  - Azure Document Intelligence documents that its key-value pairs "are
 *    always spans of text contained in the document" — an extractor that can
 *    only return document spans cannot invent a value. Vision/LLM parsers do
 *    not have that guarantee.
 *  - On the real QGT Contingency Manifest a generic image reader returned a
 *    departure of "03/15/2025" and a VIN that is not on the page; the text
 *    layer says "03/13/2025 07:00 am" and "W1Y40BHY9LT036548". A vision value
 *    that contradicts the layer is a hallucination and must never reach the
 *    receiving form.
 *
 * RULES:
 *  - A PDF with a usable text layer (unpdf found real text): every
 *    vision-derived value must be FOUND in that layer (case/space-insensitive;
 *    dates by calendar day across formats; composed descriptions token by
 *    token). Not found -> dropped and reported, never kept.
 *  - A PDF with NO text layer (a scanned image): there is nothing to ground
 *    against, so values pass with groundedBy "vision-only" — the caller keeps
 *    them as review drafts (they are always editable, never auto-accepted).
 *
 * PURE: no I/O. Self-tests: __runExtractionGroundingTests.
 */
import { emptyTransport, type ParsedTransport } from "@/lib/inventory/intake-parser";
import { normalizeAnyDate } from "@/lib/inventory/pdf-generic-transport-core";

/** Minimum non-space characters for a text layer to count as "usable". */
export const MIN_LAYER_CHARS = 40;

export function hasUsableLayer(layerText: string | null | undefined): boolean {
  return (layerText ?? "").replace(/\s+/g, "").length >= MIN_LAYER_CHARS;
}

/** Lowercase, drop all whitespace — unpdf glues words ("WhiteA3169588"). */
function squash(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "");
}

/** Every calendar day (YYYY-MM-DD) printed in the text, in any format. */
export function datesInText(text: string): Set<string> {
  const out = new Set<string>();
  const patterns = [
    /\b\d{1,2}\/\d{1,2}\/\d{4}\b/g,
    /\b\d{4}-\d{2}-\d{2}\b/g,
    /\b[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}\b/g,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const d = normalizeAnyDate(m[0]);
      if (d) out.add(d);
    }
  }
  // Two-digit years (Cultivera "3/12/25"): 20YY. Unambiguous only for m/d/yy.
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{2})\b(?!\/)/g)) {
    out.add(`20${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`);
  }
  return out;
}

/** Is a plain value (id, name, plate) present in the layer? */
export function valueInLayer(value: string | null | undefined, layerText: string): boolean {
  const v = squash(value ?? "");
  if (!v) return false;
  return squash(layerText).includes(v);
}

/** Is a date/datetime value's calendar day printed in the layer? */
export function dateInLayer(value: string | null | undefined, layerText: string): boolean {
  const day = normalizeAnyDate(value ?? "");
  if (!day) return false;
  return datesInText(layerText).has(day);
}

/** Every whitespace token of a composed value is in the layer. */
export function tokensInLayer(value: string | null | undefined, layerText: string): boolean {
  const toks = (value ?? "").split(/\s+/).filter((t) => t.length > 0);
  if (toks.length === 0) return false;
  const hay = squash(layerText);
  return toks.every((t) => hay.includes(squash(t)));
}

export type GroundingResult = {
  transport: ParsedTransport;
  /** "text-layer" when checked against a usable layer, else "vision-only". */
  groundedBy: "text-layer" | "vision-only";
  /** Fields removed because the layer does not contain them. */
  dropped: { field: keyof ParsedTransport; value: string }[];
};

const DATE_FIELDS: ReadonlySet<keyof ParsedTransport> = new Set(["departed_at", "eta_date", "arrived_at"]);
const TOKEN_FIELDS: ReadonlySet<keyof ParsedTransport> = new Set(["vehicle_description", "route_notes"]);

/**
 * Keep only the transport values the PDF's text layer supports. With no
 * usable layer the transport passes unchanged (vision-only).
 */
export function groundTransport(
  transport: ParsedTransport | null | undefined,
  layerText: string | null | undefined,
): GroundingResult {
  const t: ParsedTransport = { ...emptyTransport(), ...(transport ?? {}) };
  if (!hasUsableLayer(layerText)) return { transport: t, groundedBy: "vision-only", dropped: [] };
  const layer = layerText as string;
  const dropped: GroundingResult["dropped"] = [];
  for (const field of Object.keys(t) as (keyof ParsedTransport)[]) {
    const v = t[field];
    if (v == null || String(v).trim() === "") continue;
    const ok = DATE_FIELDS.has(field)
      ? dateInLayer(v, layer)
      : TOKEN_FIELDS.has(field)
        ? tokensInLayer(v, layer)
        : valueInLayer(v, layer);
    if (!ok) {
      dropped.push({ field, value: String(v) });
      t[field] = null;
    }
  }
  return { transport: t, groundedBy: "text-layer", dropped };
}

/** Ground a single id (invoice/order/manifest #). */
export function groundValue(
  value: string | null | undefined,
  layerText: string | null | undefined,
): { value: string | null; groundedBy: "text-layer" | "vision-only" | "rejected" } {
  const v = (value ?? "").trim();
  if (!v) return { value: null, groundedBy: "rejected" };
  if (!hasUsableLayer(layerText)) return { value: v, groundedBy: "vision-only" };
  return valueInLayer(v, layerText as string)
    ? { value: v, groundedBy: "text-layer" }
    : { value: null, groundedBy: "rejected" };
}

// ---------------------------------------------------------------------------
// Self-tests — the layer is the REAL unpdf text of QGT_FreddysFuego_MANIFEST.pdf
// page 1 (verbatim prefix); the "vision" values include the hallucinations a
// generic image reader produced on that page.
// ---------------------------------------------------------------------------
export function __runExtractionGroundingTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL: extraction-grounding", msg);
    }
  };
  const layer =
    "3/12/25 (360)930-8790 03/13/2025 07:00 am 03/13/2025 04:00 pm Chris Gibilterra Standard Delivery " +
    "QUALITY GREEN TREES 413632 26268 12 TREES LN NW STE 140 POULSBO, WA 983706402 sales@freddysfuego.com " +
    "W1Y40BHY9LT036548 WhiteA3169588 Mercedes Benz Sprinters250 1Manifest ID: 15410217973875889";

  const good: ParsedTransport = {
    ...emptyTransport(),
    driver_name: "Chris Gibilterra",
    vehicle_vin: "W1Y40BHY9LT036548",
    vehicle_plate: "A3169588",
    vehicle_description: "White Mercedes Benz Sprinters250",
    departed_at: "2025-03-13T07:00",
    eta_date: "2025-03-13",
  };
  const g = groundTransport(good, layer);
  ok(g.groundedBy === "text-layer", "usable layer");
  ok(g.dropped.length === 0, `all real values grounded (dropped ${JSON.stringify(g.dropped)})`);
  ok(g.transport.vehicle_plate === "A3169588", "glued plate still grounded");

  const hallucinated: ParsedTransport = {
    ...good,
    departed_at: "2025-03-15T07:30", // the image reader's wrong date
    vehicle_vin: "04146007476150008", // the image reader's wrong VIN
    driver_name: "Jane Doe",
    vehicle_description: "White Ford Transit",
  };
  const h = groundTransport(hallucinated, layer);
  ok(h.transport.departed_at === null, "hallucinated date dropped");
  ok(h.transport.vehicle_vin === null, "hallucinated VIN dropped");
  ok(h.transport.driver_name === null, "hallucinated driver dropped");
  ok(h.transport.vehicle_description === null, "partially-hallucinated description dropped");
  ok(h.transport.vehicle_plate === "A3169588", "real plate kept");
  ok(h.dropped.length === 4, `4 drops reported (got ${h.dropped.length})`);

  // No usable layer (scanned): vision-only passthrough.
  const s = groundTransport(hallucinated, "  ");
  ok(s.groundedBy === "vision-only" && s.dropped.length === 0, "scan -> vision-only, nothing dropped");
  ok(s.transport.driver_name === "Jane Doe", "scan keeps vision values as drafts");
  ok(groundTransport(null, layer).dropped.length === 0, "null transport");

  // Dates across formats.
  ok(datesInText("Arrival date : Thursday, March 13, 2025").has("2025-03-13"), "prose date");
  ok(datesInText("3/12/25 x").has("2025-03-12"), "two-digit year");
  ok(dateInLayer("2025-03-13", layer), "iso vs us date");
  ok(!dateInLayer("2025-03-14", layer), "different day rejected");
  ok(!dateInLayer("not a date", layer), "non-date rejected");

  // Ids.
  ok(groundValue("20636", "INVOICE Created By: March 11, 2025 20636Order #: Order Date: Cultivera Support xx").groundedBy === "text-layer", "glued order # grounded");
  ok(groundValue("0000020830", layer).value === null, "absent id rejected");
  ok(groundValue("20636", "").groundedBy === "vision-only", "no layer -> vision-only");
  ok(groundValue("  ", layer).groundedBy === "rejected", "blank rejected");
  ok(!hasUsableLayer("short text") && hasUsableLayer(layer), "layer threshold");
  ok(!tokensInLayer("", layer) && !valueInLayer("", layer), "empty never grounded");

  console.log(`extraction-grounding self-tests: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
