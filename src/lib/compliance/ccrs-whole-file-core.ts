/**
 * R74 S47 (Round 27): why a whole CCRS file can come back "has not been
 * processed" with NO error CSV, and the two things the hub does about it.
 *
 * 1) Product.UnitWeightGrams is "Decimal (10,2)" and "Required on which
 *    operations: Insert, Update and Delete" [G L0487-L0488]; "All other
 *    product types weight can be reported as 0" [G L0489-L0490]. The
 *    2026-10-25 Product file (2,604 rows) carried 14 BLANK weights (all
 *    Concentrate for Inhalation) and 140 weights with 3 decimals. Every
 *    Product file CCRS ever processed had neither. CCRS answered with a
 *    body-only "has not been processed" email: the whole file was refused,
 *    so every Inventory row then failed "Invalid Product" and every Sale row
 *    "Invalid InventoryExternalIdentifier" (the cascade, [G L0579-L0583]
 *    [G L1302-L1304]). `ccrsUnitWeightCell` makes the cell always readable:
 *    a number with at most 2 decimals, or "0" when the type allows it.
 *    Usable Cannabis / Cannabis Mix Packaged with no weight stay held (E9).
 *
 * 2) The "has not been processed" email carries the file name (plus CCRS's
 *    receipt token) and nothing else. `parseNotProcessed` reads those names
 *    so the hub can say what it means and record the file as refused whole
 *    (outcome error-fatal: nothing landed, every row may be sent again).
 *
 * Description text also loses typographic dashes/quotes (ASCII only); the
 * 250-character limit is then measured on plain characters.
 */

const DECIMALS = 2;

/** Product types whose UnitWeightGrams must be a positive weight [G L0431] [G L0489-L0490]. */
function weightRequired(type: string): boolean {
  const t = type.replace(/\s+/g, " ").trim().toLowerCase().replace(/^useable /, "usable ");
  return t === "usable cannabis" || t === "cannabis mix packaged";
}

/**
 * The UnitWeightGrams cell CCRS can read. `grams` is our computed weight
 * ("" when unknown). Never blank for a type that may report 0; at most 2
 * decimals; a positive weight never rounds down to 0.
 */
export function ccrsUnitWeightCell(grams: string, inventoryType: string): string {
  const s = (grams ?? "").trim();
  const n = s === "" ? NaN : Number(s);
  if (!Number.isFinite(n) || n < 0) return weightRequired(inventoryType) ? "" : "0";
  if (n === 0) return "0";
  const f = 10 ** DECIMALS;
  const r = Math.max(Math.round(n * f) / f, 1 / f);
  return String(r);
}

const TYPOGRAPHIC: ReadonlyArray<[RegExp, string]> = [
  [/[\u2012\u2013\u2014\u2015\u2212]/g, "-"],
  [/[\u2018\u2019\u201A\u201B\u2032]/g, "'"],
  [/[\u201C\u201D\u201E\u201F\u2033]/g, "'"],
  [/\u2026/g, "..."],
  [/[\u00A0\u2007\u202F]/g, " "],
];

/** Free text with typographic punctuation replaced by ASCII (letters such as é are kept). */
export function plainPunctuation(s: string): string {
  let out = s;
  for (const [re, to] of TYPOGRAPHIC) out = out.replace(re, to);
  return out;
}

/** At most `maxBytes` UTF-8 bytes, cut on a whole character (CCRS may measure text(250) in bytes). */
export function fitUtf8Bytes(s: string, maxBytes: number): string {
  const bytes = (x: string) => new TextEncoder().encode(x).length;
  if (bytes(s) <= maxBytes) return s;
  const chars = [...s];
  while (chars.length > 0 && bytes(chars.join("")) > maxBytes) chars.pop();
  return chars.join("").trimEnd();
}

/* ------------------------------------------------------------------ *
 * The body-only "has not been processed" email.
 * ------------------------------------------------------------------ */
export const NOT_PROCESSED_RE = /you submitted has not been processed/i;
export const NOT_PROCESSED_MESSAGE = "File has not been processed (CCRS sent no error file)";

/** Our file names in a "has not been processed" email (receipt token removed), each once, in order. */
export function parseNotProcessed(text: string): string[] {
  if (!NOT_PROCESSED_RE.test(text)) return [];
  const re = /\b((?:Strain|Area|Product|InventoryAdjustment|InventoryTransfer|Inventory|Sale)_\d+_\d{14})(?:_[0-9A-Za-z]+)?\.csv\s+you submitted has not been processed/gi;
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    const name = `${m[1]}.csv`;
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/** What the owner reads on the hub for such an email. */
export function notProcessedAdvice(names: readonly string[]): string {
  const product = names.some((n) => n.startsWith("Product_"));
  return [
    `CCRS refused ${names.length === 1 ? names[0] : `${names.length} files (${names.join(", ")})`} as a whole and sent no error file, so no row of it is on file.`,
    product
      ? "Every Inventory row naming these products will then fail \"Invalid Product\", and every sale of those lots \"Invalid InventoryExternalIdentifier\". Fix the Product file first."
      : "Every later file that depends on it will fail too.",
    "Press \"Record as not processed\": the file is closed as refused, nothing is marked on file, and the next export sends its rows again.",
  ].join(" ");
}

/* ------------------------------------------------------------------ *
 * Self-tests (run-pure-selftests + vitest).
 * ------------------------------------------------------------------ */
export function __runCcrsWholeFileTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`ccrs-whole-file-core: ${m}`);
    }
  };
  ok(ccrsUnitWeightCell("", "Concentrate for Inhalation") === "0", "blank weight, other type -> 0 [G L0489-L0490]");
  ok(ccrsUnitWeightCell("", "Usable Cannabis") === "", "blank weight, usable -> stays blank (E9 holds it)");
  ok(ccrsUnitWeightCell("", "Cannabis Mix Packaged") === "", "blank weight, mix packaged -> blank (held)");
  ok(ccrsUnitWeightCell("56.699", "Usable Cannabis") === "56.7", "3 decimals -> 2");
  ok(ccrsUnitWeightCell("453.592", "Usable Cannabis") === "453.59", "1 lb -> 453.59");
  ok(ccrsUnitWeightCell("3.5", "Usable Cannabis") === "3.5" && ccrsUnitWeightCell("1", "Solid Edible") === "1", "accepted shapes unchanged");
  ok(ccrsUnitWeightCell("0.001", "Tincture") === "0.01", "positive never rounds to 0");
  ok(ccrsUnitWeightCell("0", "Capsule") === "0", "0 stays 0");
  ok(ccrsUnitWeightCell("abc", "Capsule") === "0" && ccrsUnitWeightCell("-1", "Capsule") === "0", "unreadable -> 0 for other types");
  ok(plainPunctuation("cultivars\u2014White Truffle \u201Cx\u201D it\u2019s\u2026") === "cultivars-White Truffle 'x' it's...", "typographic -> ASCII");
  ok(fitUtf8Bytes("a".repeat(248) + "\u00e8\u00e9", 250) === "a".repeat(248) + "\u00e8", "250 bytes, whole characters");
  ok(fitUtf8Bytes("short", 250) === "short", "short text unchanged");
  ok(plainPunctuation("Cr\u00e8me Br\u00fbl\u00e9e") === "Cr\u00e8me Br\u00fbl\u00e9e", "letters kept");
  const body = "PRE The file Product_413541_20261025122117_20261025T1415944.csv you submitted has not been processed. For assistance contact:";
  ok(JSON.stringify(parseNotProcessed(body)) === JSON.stringify(["Product_413541_20261025122117.csv"]), "real 2026-10-25 body -> our name");
  ok(parseNotProcessed("The file Sale_413541_20261020165833_X.csv you submitted has been processed.").length === 0, "a success is not a refusal");
  ok(parseNotProcessed(`${body} ${body}`).length === 1, "each name once");
  ok(notProcessedAdvice(["Product_413541_20261025122117.csv"]).includes("Invalid Product"), "advice names the cascade");
  return { passed, failed };
}
