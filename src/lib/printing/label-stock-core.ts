/**
 * label-stock-core.ts — the Label Studio's catalogue of label STOCK (the
 * physical roll/stack a label is printed on) and of the PRINTERS it can go
 * through, plus the fit checks that stop an employee from designing a label
 * the store's printer cannot physically feed. (D177, owner: "I need to be able
 * to select from the various size labels, not just rollo but any vendors
 * sizes.")
 *
 * Pure + deterministic: no React, no DB, no fetch. Every catalogue entry
 * carries the URL it was verified against (standing rule 2 — never guess).
 * Research notes: docs/rollo-label-printing.md § "Label Studio (D177)".
 *
 * ORIENTATION CONVENTION: `acrossIn` is the dimension ACROSS the roll (the
 * direction of the print head / the width between the printer's guides);
 * `feedIn` is the dimension along the feed. Rollo and OnlineLabels list sizes
 * as across × feed (a 4×6 label is 4″ across); DYMO lists them as the narrow
 * liner dimension first, which is also across. We keep the vendor's printed
 * order and say so in the UI so staff can confirm with a ruler.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type StockVendor = "rollo" | "onlinelabels" | "zebra" | "dymo" | "custom";
export type LabelShape = "rect" | "circle";

export type LabelStock = {
  /** Stable id stored in templates and print history (never reuse). */
  id: string;
  vendor: StockVendor;
  /** The vendor's own part / SKU number, exactly as listed. */
  partNumber: string;
  /** Short human name, e.g. "Barcode label". */
  name: string;
  acrossIn: number;
  feedIn: number;
  shape: LabelShape;
  /** Labels side by side on the liner (DYMO 30333 is 2). Default 1. */
  across?: number;
  labelsPerRoll?: number;
  coreIn?: number;
  /** Where the size was verified. */
  sourceUrl: string;
  /** Anything staff should know when they buy or load it. */
  note?: string;
};

export type PrinterProfile = {
  id: string;
  name: string;
  dpi: number;
  /** Across-the-roll width the printer's guides accept, inclusive. null = unknown. */
  minAcrossIn: number | null;
  maxAcrossIn: number | null;
  media: "direct-thermal" | "any";
  /** True when the printer needs die-cut labels with a gap or perforation. */
  needsGapOrPerf: boolean;
  /** Vendors whose stock the maker itself recommends. */
  nativeVendors: StockVendor[];
  sourceUrls: string[];
  note?: string;
};

export type FitSeverity = "ok" | "warn" | "block";
export type FitMessage = { severity: FitSeverity; code: string; text: string };
export type FitResult = { severity: FitSeverity; messages: FitMessage[] };

// ── Sources (verified 2026; see docs/rollo-label-printing.md) ────────────────

export const SRC = {
  rolloVsOthers: "https://www.rollo.com/rollo-vs-others",
  rolloSupportLabels:
    "https://support.rollo.com/support/solutions/articles/29000050961-which-labels-work-with-rollo-direct-thermal-only-no-ink-or-ribbon-and-recommended-sizes",
  rolloShop: "https://www.rollo.com/shop",
  rollo2x1: "https://www.rollo.com/product/2x1-barcode-label",
  rolloCircle: "https://www.rollo.com/product/2-in-circle-label",
  olRollo: "https://www.onlinelabels.com/uses/ro-labels",
  zebra10010043: "https://www.barcodesinc.com/zebra/part-10010043.htm",
  zebra10015340: "https://www.barcodesinc.com/zebra/part-10015340.htm",
  dymoGuide:
    "https://labels123.net/blogs/articles/dymo-label-sizes-explained-a-practical-guide-to-dymo-labelwriter-part-numbers",
  dymo30334: "https://www.labelvalue.com/dymo-lv-30334-2-1-4-x-1-1-4-polypropylene-labels-p-1056.html",
  dymo30336: "https://www.enkoproducts.com/shop/dymo-labels/dymo-30336-labels",
} as const;

// ── Printers ─────────────────────────────────────────────────────────────────

/** The store's printer (equipment asset PRN-LABEL-01, migration 0061). */
export const ROLLO_X1040: PrinterProfile = {
  id: "rollo-x1040",
  name: "Rollo Wireless (X1040)",
  dpi: 203,
  minAcrossIn: 1.57,
  maxAcrossIn: 4.1,
  media: "direct-thermal",
  needsGapOrPerf: true,
  nativeVendors: ["rollo", "onlinelabels"],
  sourceUrls: [SRC.rolloVsOthers, SRC.rolloSupportLabels],
  note:
    "Direct thermal only (no ink, no ribbon). Paper labels with a gap or perforation between them. " +
    "No clear/film labels; black-mark or punch-hole stock is unreliable. After changing to a new size, " +
    "hold the feed button until it beeps once so it re-measures the label.",
};

/** Escape hatch for any other printer: no width check, staff picks the dpi. */
export function genericPrinter(dpi: 203 | 300 | 600 = 203): PrinterProfile {
  return {
    id: `generic-${dpi}`,
    name: `Other printer (${dpi} dpi)`,
    dpi,
    minAcrossIn: null,
    maxAcrossIn: null,
    media: "any",
    needsGapOrPerf: false,
    nativeVendors: [],
    sourceUrls: [],
    note: "No width limits are known for this printer — check its manual before buying stock.",
  };
}

export const PRINTERS: PrinterProfile[] = [ROLLO_X1040, genericPrinter(203), genericPrinter(300)];

export function printerById(id: string | null | undefined): PrinterProfile {
  return PRINTERS.find((p) => p.id === id) ?? ROLLO_X1040;
}

// ── Stock catalogue ──────────────────────────────────────────────────────────

const ol = (part: string, a: number, f: number, name: string, extra: Partial<LabelStock> = {}): LabelStock => ({
  id: `ol-${part.toLowerCase()}`,
  vendor: "onlinelabels",
  partNumber: part,
  name,
  acrossIn: a,
  feedIn: f,
  shape: "rect",
  sourceUrl: SRC.olRollo,
  ...extra,
});

const dymo = (part: string, a: number, f: number, name: string, extra: Partial<LabelStock> = {}): LabelStock => ({
  id: `dymo-${part}`,
  vendor: "dymo",
  partNumber: part,
  name,
  acrossIn: a,
  feedIn: f,
  shape: "rect",
  sourceUrl: SRC.dymoGuide,
  note: "Made for DYMO LabelWriter printers. Rollo does not list DYMO rolls as compatible.",
  ...extra,
});

export const LABEL_STOCK: LabelStock[] = [
  // Rollo's own stock (support article: recommended 4×6, 2×1, 2″ round, 2×2).
  { id: "rollo-4x6", vendor: "rollo", partNumber: "4x6 roll / fanfold stack", name: "Shipping label", acrossIn: 4, feedIn: 6, shape: "rect", sourceUrl: SRC.rolloShop },
  { id: "rollo-2x1", vendor: "rollo", partNumber: "2x1 barcode label", name: "Barcode label", acrossIn: 2, feedIn: 1, shape: "rect", sourceUrl: SRC.rollo2x1 },
  { id: "rollo-circle-2", vendor: "rollo", partNumber: "2 in circle label", name: "Circle label", acrossIn: 2, feedIn: 2, shape: "circle", sourceUrl: SRC.rolloCircle },

  // OnlineLabels "Rollo-compatible" thermal rolls.
  ol("RL785", 4, 6, "Shipping label"),
  ol("FF6497", 4, 6, "Shipping label (fanfold)"),
  ol("RL777", 2, 1, "Barcode label (1″ core)", { coreIn: 1 }),
  ol("RL778", 2, 1, "Barcode label (3″ core)", { coreIn: 3 }),
  ol("RL2077", 2, 0.5, "Slim barcode label"),
  ol("RL938", 2, 2, "Square label"),
  ol("RL2676", 2.25, 1.25, "Price / SKU label", { labelsPerRoll: 1125, coreIn: 1 }),
  ol("RL2763", 2.625, 1, "Address-style label"),
  ol("RL928", 3, 1, "Wide barcode label"),
  ol("RL936", 3, 1.5, "Product label"),
  ol("RL940", 3, 2, "Product label"),
  ol("RL946", 3, 3, "Square label"),
  ol("RL779", 4, 1, "Shelf strip"),
  ol("RL1483", 4, 1.5, "Shelf label"),
  ol("RL781", 4, 2, "Bin / shelf label"),
  ol("RL942", 4, 2.5, "Case label"),
  ol("RL783", 4, 3, "Case label"),
  ol("RL951", 4, 4, "Square case label"),
  ol("RL926", 1.5, 1, "Mini label"),
  ol("RL2056", 1.5, 0.5, "Mini slim label"),

  // Zebra Z-Select 4000D (direct thermal) — only part numbers we could verify.
  { id: "zebra-10010043", vendor: "zebra", partNumber: "10010043", name: "Z-Select 4000D 3×1", acrossIn: 3, feedIn: 1, shape: "rect", labelsPerRoll: 2340, coreIn: 1, sourceUrl: SRC.zebra10010043, note: "Sold in cases of rolls for Zebra desktop printers." },
  { id: "zebra-10015340", vendor: "zebra", partNumber: "10015340", name: "Z-Select 4000D 2.25×0.75", acrossIn: 2.25, feedIn: 0.75, shape: "rect", labelsPerRoll: 3315, sourceUrl: SRC.zebra10015340, note: "Sold in cases of rolls for Zebra desktop printers." },

  // DYMO LabelWriter.
  dymo("30252", 1.125, 3.5, "Address label"),
  dymo("30320", 1.125, 3.5, "Address label"),
  dymo("30321", 1.4, 3.5, "Large address label"),
  dymo("30330", 0.75, 2, "Return address label"),
  dymo("30334", 2.25, 1.25, "Multi-purpose label", { sourceUrl: SRC.dymo30334 }),
  dymo("30336", 1, 2.125, "Small multi-purpose label", { sourceUrl: SRC.dymo30336 }),
  dymo("30332", 1, 1, "Square multi-purpose label"),
  dymo("30333", 0.5, 1, "Mini label (2 across)", { across: 2 }),
  dymo("30327", 0.5625, 3.4375, "File folder label"),
  dymo("30857", 2.25, 4, "Name badge label"),
  dymo("30324", 2.125, 2.75, "Diskette label"),
  dymo("30373", 0.875, 0.9375, "Price tag label"),
];

export const VENDOR_LABEL: Record<StockVendor, string> = {
  rollo: "Rollo",
  onlinelabels: "OnlineLabels",
  zebra: "Zebra",
  dymo: "DYMO",
  custom: "Custom size",
};

export function stockById(id: string | null | undefined): LabelStock | null {
  if (!id) return null;
  return LABEL_STOCK.find((s) => s.id === id) ?? parseCustomStockId(id);
}

// ── Custom sizes ─────────────────────────────────────────────────────────────

/** Bounds for a typed-in size; wide enough for any desktop label printer. */
export const CUSTOM_MIN_IN = 0.5;
export const CUSTOM_MAX_IN = 8;

/** "custom-2.25x1.25" or "custom-2x2-circle" → a stock, else null. */
export function parseCustomStockId(id: string): LabelStock | null {
  const m = /^custom-(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(-circle)?$/.exec(id);
  if (!m) return null;
  const r = customStock(Number(m[1]), Number(m[2]), m[3] ? "circle" : "rect");
  return r.ok ? r.stock : null;
}

export function customStock(
  acrossIn: number,
  feedIn: number,
  shape: LabelShape = "rect",
): { ok: true; stock: LabelStock } | { ok: false; error: string } {
  if (!Number.isFinite(acrossIn) || !Number.isFinite(feedIn)) return { ok: false, error: "Enter the width and height in inches." };
  if (acrossIn < CUSTOM_MIN_IN || feedIn < CUSTOM_MIN_IN) return { ok: false, error: `Labels must be at least ${CUSTOM_MIN_IN}″ each way.` };
  if (acrossIn > CUSTOM_MAX_IN || feedIn > CUSTOM_MAX_IN) return { ok: false, error: `Labels can be at most ${CUSTOM_MAX_IN}″ each way.` };
  // Round to 1/1000″ so ids are stable and readable.
  const a = Math.round(acrossIn * 1000) / 1000;
  const f = shape === "circle" ? a : Math.round(feedIn * 1000) / 1000;
  return {
    ok: true,
    stock: {
      id: `custom-${a}x${f}${shape === "circle" ? "-circle" : ""}`,
      vendor: "custom",
      partNumber: "—",
      name: shape === "circle" ? `${fmtIn(a)} circle` : `${fmtIn(a)} × ${fmtIn(f)}`,
      acrossIn: a,
      feedIn: f,
      shape,
      sourceUrl: "",
      note: "Typed-in size. Measure a label on the roll with a ruler first.",
    },
  };
}

// ── Geometry helpers ─────────────────────────────────────────────────────────

/** Inches → whole printer dots (the head cannot print part of a dot). */
export function inToDots(inches: number, dpi: number): number {
  return Math.round(inches * dpi);
}

export function dotsToIn(dots: number, dpi: number): number {
  return dots / dpi;
}

/** Snap a length to the nearest whole dot, returned in inches. */
export function snapIn(inches: number, dpi: number): number {
  return dotsToIn(inToDots(inches, dpi), dpi);
}

/** 1.5 → `1.5″`, 2.25 → `2.25″`, 0.5625 → `0.563″`. */
export function fmtIn(inches: number): string {
  const r = Math.round(inches * 1000) / 1000;
  return `${r}″`;
}

export function stockSizeText(s: LabelStock): string {
  return s.shape === "circle" ? `${fmtIn(s.acrossIn)} circle` : `${fmtIn(s.acrossIn)} × ${fmtIn(s.feedIn)}`;
}

/** Full-page CSS for a single label. Margin 0 so the browser never scales. */
export function pageCss(s: LabelStock): string {
  return `@page { size: ${s.acrossIn}in ${s.feedIn}in; margin: 0; }`;
}

/**
 * Inset we keep clear inside the label edge. Not a vendor spec — a design
 * choice: die-cut labels drift a little on any roll printer, so we keep 1/16″
 * (≈13 dots at 203 dpi) clear and the fit engine warns if content crowds it.
 */
export const SAFE_INSET_IN = 0.0625;

export function printableArea(s: LabelStock, dpi: number): { widthIn: number; heightIn: number; widthDots: number; heightDots: number } {
  // A circle's usable area is the inscribed square.
  const side = s.shape === "circle" ? s.acrossIn / Math.SQRT2 : null;
  const w = (side ?? s.acrossIn) - 2 * SAFE_INSET_IN;
  const h = (side ?? s.feedIn) - 2 * SAFE_INSET_IN;
  return { widthIn: w, heightIn: h, widthDots: inToDots(w, dpi), heightDots: inToDots(h, dpi) };
}

// ── Fit check ────────────────────────────────────────────────────────────────

function worst(a: FitSeverity, b: FitSeverity): FitSeverity {
  const rank: Record<FitSeverity, number> = { ok: 0, warn: 1, block: 2 };
  return rank[a] >= rank[b] ? a : b;
}

/** Can this printer physically feed this stock? */
export function checkStockFit(stock: LabelStock, printer: PrinterProfile): FitResult {
  const messages: FitMessage[] = [];
  const across = stock.acrossIn * (stock.across ?? 1);
  if (printer.minAcrossIn != null && across < printer.minAcrossIn) {
    messages.push({
      severity: "block",
      code: "too_narrow",
      text: `${stockSizeText(stock)} is too narrow for the ${printer.name}. Its guides take labels ${fmtIn(printer.minAcrossIn)}–${fmtIn(printer.maxAcrossIn ?? printer.minAcrossIn)} wide.`,
    });
  }
  if (printer.maxAcrossIn != null && across > printer.maxAcrossIn) {
    messages.push({
      severity: "block",
      code: "too_wide",
      text: `${stockSizeText(stock)} is too wide for the ${printer.name} (max ${fmtIn(printer.maxAcrossIn)}).`,
    });
  }
  if ((stock.across ?? 1) > 1) {
    messages.push({
      severity: "warn",
      code: "multi_across",
      text: `This roll has ${stock.across} labels side by side. The Label Studio prints one label per page, so only one of each row is used.`,
    });
  }
  if (printer.nativeVendors.length > 0 && stock.vendor !== "custom" && !printer.nativeVendors.includes(stock.vendor)) {
    messages.push({
      severity: "warn",
      code: "not_native",
      text: `${VENDOR_LABEL[stock.vendor]} stock is not on ${printer.name.split(" (")[0]}'s compatible list. The size fits, but test one roll first — it must be direct thermal paper with a gap between labels.`,
    });
  }
  if (stock.vendor === "custom" && printer.needsGapOrPerf) {
    messages.push({
      severity: "warn",
      code: "custom_media",
      text: "Make sure the roll is direct thermal paper with a gap or perforation between labels (no clear film, no black-mark stock).",
    });
  }
  const severity = messages.reduce<FitSeverity>((acc, m) => worst(acc, m.severity), "ok");
  return { severity, messages };
}

/** Catalogue filtered/sorted for a picker: printable stock first, then by size. */
export function stockForPicker(printer: PrinterProfile, vendor: StockVendor | "all" = "all"): Array<{ stock: LabelStock; fit: FitResult }> {
  const rank: Record<FitSeverity, number> = { ok: 0, warn: 1, block: 2 };
  return LABEL_STOCK.filter((s) => vendor === "all" || s.vendor === vendor)
    .map((stock) => ({ stock, fit: checkStockFit(stock, printer) }))
    .sort(
      (a, b) =>
        rank[a.fit.severity] - rank[b.fit.severity] ||
        a.stock.acrossIn * a.stock.feedIn - b.stock.acrossIn * b.stock.feedIn ||
        a.stock.id.localeCompare(b.stock.id),
    );
}

// ── Self-tests ───────────────────────────────────────────────────────────────

export function __runLabelStockTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL label-stock-core:", msg);
    }
  };

  // Catalogue integrity.
  const ids = new Set<string>();
  for (const s of LABEL_STOCK) {
    ok(!ids.has(s.id), `unique id ${s.id}`);
    ids.add(s.id);
    ok(s.acrossIn > 0 && s.feedIn > 0, `positive size ${s.id}`);
    ok(/^https:\/\//.test(s.sourceUrl), `source url ${s.id}`);
    ok(s.shape !== "circle" || s.acrossIn === s.feedIn, `circle is square ${s.id}`);
  }
  ok(LABEL_STOCK.length >= 35, "catalogue has every verified size");
  ok(ROLLO_X1040.sourceUrls.every((u) => u.startsWith("https://")), "printer sources");

  // Rollo X1040 limits (rollo.com/rollo-vs-others: 1.57″–4.1″).
  const f = (id: string) => checkStockFit(stockById(id)!, ROLLO_X1040);
  ok(f("rollo-4x6").severity === "ok", "4x6 fits Rollo");
  ok(f("rollo-2x1").severity === "ok", "2x1 fits Rollo");
  ok(f("rollo-circle-2").severity === "ok", "2in circle fits Rollo");
  ok(f("ol-rl2676").severity === "ok", "OnlineLabels 2.25x1.25 fits");
  ok(f("ol-rl926").severity === "block", "1.5in wide is blocked (narrower than 1.57)");
  ok(f("ol-rl2056").messages.some((m) => m.code === "too_narrow"), "1.5x0.5 too narrow");
  ok(f("dymo-30332").severity === "block", "DYMO 1x1 blocked");
  ok(f("dymo-30333").severity === "block", "DYMO 2-across mini blocked (1in total)");
  ok(f("dymo-30333").messages.some((m) => m.code === "multi_across"), "2-across warned");
  ok(f("dymo-30334").severity === "warn", "DYMO 2.25 fits size but is not native");
  ok(f("zebra-10010043").severity === "warn", "Zebra 3x1 fits size but warns");
  ok(f("ol-rl951").severity === "ok", "4x4 fits");

  const wide = customStock(4.5, 2);
  ok(wide.ok && checkStockFit(wide.stock, ROLLO_X1040).messages.some((m) => m.code === "too_wide"), "4.5in blocked as too wide");
  const edge = customStock(1.57, 1);
  ok(edge.ok && checkStockFit(edge.stock, ROLLO_X1040).severity !== "block", "1.57 inclusive lower bound");
  const edge2 = customStock(4.1, 1);
  ok(edge2.ok && checkStockFit(edge2.stock, ROLLO_X1040).severity !== "block", "4.1 inclusive upper bound");
  ok(edge.ok && checkStockFit(edge.stock, ROLLO_X1040).messages.some((m) => m.code === "custom_media"), "custom stock reminds about media");

  // Generic printer: no width check.
  ok(checkStockFit(stockById("dymo-30332")!, genericPrinter(300)).severity === "ok", "generic printer accepts anything");
  ok(printerById("nope").id === "rollo-x1040", "unknown printer falls back to Rollo");
  ok(printerById("generic-300").dpi === 300, "generic 300 lookup");

  // Custom parsing.
  ok(!customStock(0.2, 1).ok, "too small rejected");
  ok(!customStock(9, 1).ok, "too large rejected");
  ok(!customStock(Number.NaN, 1).ok, "NaN rejected");
  const c = customStock(2.25, 1.25);
  ok(c.ok && c.stock.id === "custom-2.25x1.25", "custom id");
  ok(stockById("custom-2.25x1.25")?.feedIn === 1.25, "custom id round-trips");
  ok(stockById("custom-2x9")?.id == null, "out-of-range custom id → null");
  const circ = customStock(2, 3, "circle");
  ok(circ.ok && circ.stock.feedIn === 2 && circ.stock.id === "custom-2x2-circle", "custom circle forced square");
  ok(stockById("custom-2x2-circle")?.shape === "circle", "circle id round-trips");
  ok(stockById("garbage") === null && stockById(null) === null, "unknown id null");

  // Geometry: 4×6 at 203 dpi = 812 × 1218 dots (docs/rollo-label-printing.md).
  ok(inToDots(4, 203) === 812 && inToDots(6, 203) === 1218, "4x6 dots");
  ok(Math.abs(snapIn(0.01, 203) - 2 / 203) < 1e-12, "snap 10 mil to 2 dots");
  ok(snapIn(1, 300) === 1, "snap exact");
  const pa = printableArea(stockById("rollo-4x6")!, 203);
  ok(Math.abs(pa.widthIn - 3.875) < 1e-9 && pa.widthDots === 787, "printable width 4x6");
  const pc = printableArea(stockById("rollo-circle-2")!, 203);
  ok(pc.widthIn < 1.42 && pc.widthIn > 1.28, "circle uses inscribed square");
  ok(pageCss(stockById("rollo-2x1")!) === "@page { size: 2in 1in; margin: 0; }", "page css");
  ok(stockSizeText(stockById("dymo-30327")!) === "0.563″ × 3.438″", "fmt fractional");
  ok(stockSizeText(stockById("rollo-circle-2")!) === "2″ circle", "fmt circle");

  // Picker ordering: printable first.
  const pick = stockForPicker(ROLLO_X1040);
  const firstBlock = pick.findIndex((p) => p.fit.severity === "block");
  ok(firstBlock > 0 && pick.slice(firstBlock).every((p) => p.fit.severity === "block"), "blocked stock sorts last");
  ok(stockForPicker(ROLLO_X1040, "dymo").every((p) => p.stock.vendor === "dymo"), "vendor filter");

  return { passed, failed };
}
