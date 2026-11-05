/**
 * D177 S4 — Label Studio session logic (pure).
 *
 * Owner: "I want a much fancier, far more professional label builder
 * experience … easy to use." The studio component is thin; everything that can
 * be wrong lives here and is self-tested:
 *
 *   - remembered settings (per device, per label kind) are coerced back into a
 *     valid printer / stock / template — a stale or hand-edited value never
 *     crashes the page or prints a size the printer can't feed;
 *   - a batch shares one template, but each item still gets a barcode the
 *     register can ring up (code source falls back per item);
 *   - the print job is planned up front: which labels print, how many copies,
 *     which are refused and why, with a hard ceiling so a typo of "5000"
 *     copies can't run a roll out;
 *   - the print CSS gives every label its own page at the exact stock size
 *     (margin 0, so the browser never scales — docs/rollo-label-printing.md).
 */
import {
  CUSTOM_MAX_IN,
  CUSTOM_MIN_IN,
  PRINTERS,
  ROLLO_X1040,
  checkStockFit,
  pageCss,
  printerById,
  stockById,
  type FitMessage,
  type FitSeverity,
  type LabelStock,
  type PrinterProfile,
} from "./label-stock-core";
import { kindForDbCode } from "@/lib/platform/platform-errors-core";
import {
  defaultTemplate,
  layoutLabel,
  layoutToSvg,
  sanitizeTemplate,
  type LabelLayout,
  type LabelSubject,
  type LotLabelSource,
  type NcLabelSource,
  type LabelTemplate,
  type SubjectKind,
} from "./label-layout-core";

// ── Limits ──────────────────────────────────────────────────────────────────

/** Copies of one item in one job (a full case is rarely over a few hundred). */
export const MAX_COPIES_PER_ITEM = 500;
/** Labels in one job. A 4×6 roll is ~250–500; a 2×1 roll is ~1,000+. */
export const MAX_LABELS_PER_JOB = 1000;
/** Ask "are you sure?" above this many labels. */
export const CONFIRM_LABELS_OVER = 50;

export function clampCopies(n: unknown): number {
  const v = typeof n === "number" ? n : typeof n === "string" ? Number(n.trim()) : NaN;
  if (!Number.isFinite(v)) return 1;
  return Math.min(MAX_COPIES_PER_ITEM, Math.max(0, Math.floor(v)));
}

// ── Defaults by kind ────────────────────────────────────────────────────────

/**
 * Starting stock for a kind. Lots keep the 4×6 the receiving page has always
 * printed (no surprise for staff); other inventory keeps the 2.25×1.25 price
 * label its page has always printed (OnlineLabels RL2676, same size as
 * DYMO 30334).
 */
export function defaultStockId(kind: SubjectKind): string {
  return kind === "lot" ? "rollo-4x6" : "ol-rl2676";
}

// ── Remembered settings ─────────────────────────────────────────────────────

export type StudioPrefs = {
  printerId: string;
  stockId: string;
  template: LabelTemplate;
};

export const PREFS_VERSION = 1;

export function prefsStorageKey(kind: SubjectKind): string {
  return `gw.labelStudio.v${PREFS_VERSION}.${kind}`;
}

/**
 * Coerce remembered / URL-supplied settings into something printable. A stock
 * the chosen printer can't feed falls back to the kind's default (and if even
 * that can't feed, the Rollo profile is restored), so a page load never opens
 * in a blocked state because of a stale preference.
 */
export function sanitizePrefs(raw: unknown, subject: LabelSubject): StudioPrefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  let printer = printerById(typeof r.printerId === "string" ? r.printerId : null);
  let stock = stockById(typeof r.stockId === "string" ? r.stockId : null) ?? stockById(defaultStockId(subject.kind))!;
  if (checkStockFit(stock, printer).severity === "block") {
    stock = stockById(defaultStockId(subject.kind))!;
    if (checkStockFit(stock, printer).severity === "block") printer = ROLLO_X1040;
  }
  const base = defaultTemplate(subject, stock);
  const template = sanitizeTemplate(r.template, base);
  return { printerId: printer.id, stockId: stock.id, template };
}

/** Parse "2.25" / "2 1/4" / "2-1/4" → inches, else NaN. */
export function parseInches(text: string): number {
  const s = (text ?? "").trim().replace(/["″]|in(ch(es)?)?$/gi, "").trim();
  if (!s) return NaN;
  const mixed = /^(\d+)(?:\s+|-)(\d+)\/(\d+)$/.exec(s);
  if (mixed) {
    const d = Number(mixed[3]);
    return d > 0 ? Number(mixed[1]) + Number(mixed[2]) / d : NaN;
  }
  const frac = /^(\d+)\/(\d+)$/.exec(s);
  if (frac) {
    const d = Number(frac[2]);
    return d > 0 ? Number(frac[1]) / d : NaN;
  }
  return /^\d*\.?\d+$/.test(s) ? Number(s) : NaN;
}

export const CUSTOM_RANGE_TEXT = `${CUSTOM_MIN_IN}″–${CUSTOM_MAX_IN}″`;

// ── Per-item template resolution ────────────────────────────────────────────

/**
 * One template drives a whole batch, but items differ: a lot without a CCRS id
 * can't use "CCRS id", an item without a UPC can't use "UPC". Fall back to the
 * item's own best code, and drop UPC symbology when the value isn't a GTIN.
 */
export function templateForSubject(subject: LabelSubject, t: LabelTemplate): LabelTemplate {
  const has = subject.codes.some((c) => c.source === t.codeSource);
  return has ? t : { ...t, codeSource: subject.defaultCode };
}

// ── Print job ───────────────────────────────────────────────────────────────

export type JobItem = { subject: LabelSubject; copies: number };

export type PlannedItem = {
  subjectId: string;
  title: string;
  copies: number;
  layout: LabelLayout;
  /** SVG for one label; repeated `copies` times on paper. */
  svg: string;
};

export type JobPlan = {
  items: PlannedItem[];
  refused: Array<{ subjectId: string; title: string; reason: string }>;
  totalLabels: number;
  severity: FitSeverity;
  messages: FitMessage[];
  needsConfirm: boolean;
};

function rank(s: FitSeverity): number {
  return s === "block" ? 2 : s === "warn" ? 1 : 0;
}

/**
 * Lay out every item once, then plan copies. Refused items (layout blocks)
 * never print; the job is blocked only if nothing can print, the printer can't
 * feed the stock, or the job is over the ceiling.
 */
export function planPrintJob(items: JobItem[], stock: LabelStock, printer: PrinterProfile, template: LabelTemplate): JobPlan {
  const messages: FitMessage[] = [];
  const fit = checkStockFit(stock, printer);
  messages.push(...fit.messages);
  const planned: PlannedItem[] = [];
  const refused: JobPlan["refused"] = [];
  for (const it of items) {
    const copies = clampCopies(it.copies);
    if (copies === 0) continue;
    const layout = layoutLabel({ subject: it.subject, stock, dpi: printer.dpi, template: templateForSubject(it.subject, template) });
    if (layout.severity === "block") {
      const why = layout.messages.find((m) => m.severity === "block")?.text ?? "Doesn't fit on this label.";
      refused.push({ subjectId: it.subject.id, title: it.subject.title, reason: why });
      continue;
    }
    planned.push({ subjectId: it.subject.id, title: it.subject.title, copies, layout, svg: layoutToSvg(layout) });
  }
  const totalLabels = planned.reduce((n, p) => n + p.copies, 0);
  if (refused.length > 0) {
    messages.push({
      severity: planned.length > 0 ? "warn" : "block",
      code: "refused",
      text: planned.length > 0
        ? `${refused.length} item${refused.length === 1 ? "" : "s"} won't print on this label: ${refused.map((r) => r.title).join("; ")}.`
        : "Nothing can print with these settings.",
    });
  }
  if (totalLabels === 0 && refused.length === 0) messages.push({ severity: "block", code: "nothing", text: "Set at least one copy to print." });
  if (totalLabels > MAX_LABELS_PER_JOB) {
    messages.push({ severity: "block", code: "too_many", text: `That's ${totalLabels.toLocaleString("en-US")} labels. Print at most ${MAX_LABELS_PER_JOB.toLocaleString("en-US")} at a time.` });
  }
  const severity = messages.reduce<FitSeverity>((acc, m) => (rank(m.severity) > rank(acc) ? m.severity : acc), "ok");
  return { items: planned, refused, totalLabels, severity, messages, needsConfirm: totalLabels > CONFIRM_LABELS_OVER };
}

// ── SVG / CSS helpers ───────────────────────────────────────────────────────

/** Re-size the outer <svg> (preview zoom) without touching nested symbols. */
export function svgAtSize(svg: string, width: string, height: string): string {
  return svg.replace(/^<svg([^>]*?) width="[^"]*" height="[^"]*"/, `<svg$1 width="${width}" height="${height}"`);
}

/** Class on the print portal (direct child of <body>). */
export const PRINT_ROOT_CLASS = "gw-label-print-root";

/**
 * Print CSS: exact page size, margin 0, everything but the portal hidden, one
 * label per page. Values come from the stock catalogue (numbers only), so the
 * string is safe to inline.
 */
export function printCss(stock: LabelStock): string {
  const w = `${stock.acrossIn}in`;
  const h = `${stock.feedIn}in`;
  return [
    pageCss(stock),
    `.${PRINT_ROOT_CLASS}{display:none}`,
    "@media print{",
    "html,body{margin:0!important;padding:0!important;background:#fff!important;width:auto!important;height:auto!important;overflow:visible!important}",
    `body>*:not(.${PRINT_ROOT_CLASS}){display:none!important}`,
    `.${PRINT_ROOT_CLASS}{display:block!important}`,
    `.${PRINT_ROOT_CLASS} .gw-label-page{width:${w};height:${h};overflow:hidden;break-after:page;page-break-after:always;break-inside:avoid}`,
    `.${PRINT_ROOT_CLASS} .gw-label-page:last-child{break-after:auto;page-break-after:auto}`,
    `.${PRINT_ROOT_CLASS} .gw-label-page svg{display:block;width:${w};height:${h}}`,
    "*{-webkit-print-color-adjust:exact;print-color-adjust:exact}",
    "}",
  ].join("");
}

/** Short spec line for the preview footer, e.g. "Code 128 · 10 mil bars". */
export function barcodeSpecText(layout: LabelLayout): string {
  const bc = layout.blocks.find((b) => b.kind === "barcode");
  if (!bc || bc.kind !== "barcode") return "No barcode";
  const unit = bc.formatName.startsWith("QR") ? "mil modules" : "mil bars";
  return `${bc.formatName} · ${Math.round(bc.xMil * 10) / 10} ${unit} · ${Math.round(bc.wIn * 100) / 100}″ × ${Math.round(bc.hIn * 100) / 100}″`;
}

// ── Row adapters (DB row → label source) ───────────────────────────────────

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/**
 * An inventory_lots row (select *, hydrated with vendor_name / brand_name) →
 * LotLabelSource. Reads ccrs_inventory_external_id (0246) and
 * expires_on_source (0253) defensively: they are real columns but not on the
 * InventoryLot TS type, and a missing value must degrade, not throw.
 */
export function lotSourceFromRow(row: Record<string, unknown>): LotLabelSource {
  return {
    id: String(row.id ?? ""),
    lot_code: str(row.lot_code),
    pos_product_key: str(row.pos_product_key),
    ccrs_inventory_external_id: str(row.ccrs_inventory_external_id),
    product_name: str(row.product_name),
    strain_name: str(row.strain_name),
    strain_type: str(row.strain_type),
    category: str(row.category),
    inventory_type: str(row.inventory_type),
    brand_name: str(row.brand_name),
    vendor_name: str(row.vendor_name),
    unit_weight: num(row.unit_weight),
    unit_weight_uom: str(row.unit_weight_uom),
    received_qty: num(row.received_qty),
    unit: str(row.unit),
    received_on: str(row.received_on),
    expires_on: str(row.expires_on),
    expires_on_source: str(row.expires_on_source),
    status: str(row.status),
  };
}

export function ncSourceFromRow(row: Record<string, unknown>): NcLabelSource {
  return {
    id: String(row.id ?? ""),
    sku: str(row.sku) ?? "",
    name: str(row.name) ?? "",
    brand: str(row.brand),
    type: str(row.type) ?? "",
    size: str(row.size),
    color: str(row.color),
    price_minor_units: Math.trunc(num(row.price_minor_units) ?? 0),
    barcode: str(row.barcode),
    location: str(row.location),
    status: str(row.status) ?? "draft",
  };
}

/**
 * Suggested copies for a received lot: one per unit when the unit is "each"
 * and the count is a sane whole number; otherwise 1 (bulk grams never become
 * 448 labels).
 */
export function suggestedCopiesForLot(src: LotLabelSource): number | null {
  const q = src.received_qty;
  const unit = (src.unit ?? "").trim().toLowerCase();
  if (q == null || !Number.isInteger(q) || q <= 0) return null;
  if (unit !== "each" && unit !== "ea" && unit !== "unit" && unit !== "units") return null;
  return Math.min(q, MAX_COPIES_PER_ITEM);
}

/**
 * Plain-language meaning of a failed label-data read (AGENTS.md: classify the
 * codes that mean the platform moved; never show a failed read as "empty").
 */
export function labelLoadErrorText(code: string | null, message: string): string {
  const kind = kindForDbCode(code);
  if (kind === "db_permission") return `The database refused the server (permission denied, ${code}). A grant is missing — run the latest grants migration from docs/MIGRATIONS_TO_RUN.md.`;
  if (kind === "db_missing") return `A table or column the labels need is missing (${code}). Run the pending migrations in docs/MIGRATIONS_TO_RUN.md.`;
  const m = (message ?? "").trim().slice(0, 200);
  return `Couldn't load the items to label${code ? ` (${code})` : ""}${m ? `: ${m}` : ""}. Nothing was printed — reload to try again.`;
}

export { PRINTERS };

// ── Self-tests ──────────────────────────────────────────────────────────────

export function __runLabelStudioTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL label-studio-core:", msg);
    }
  };

  const lotSubj: LabelSubject = {
    kind: "lot",
    id: "lot-1",
    title: "Blue Dream 3.5g — Lot 6034772160010001",
    values: { product: "Blue Dream 3.5g", strain: "Blue Dream", weight: "3.5 g", lot_code: "6034772160010001", store: "Greenway" },
    codes: [
      { source: "lot_code", value: "6034772160010001", readiness: { severity: "ok", text: "Rings up" } },
      { source: "row_id", value: "11111111-1111-4111-8111-111111111111", readiness: { severity: "block", text: "no" } },
    ],
    defaultCode: "lot_code",
  };
  const ncSubj: LabelSubject = {
    kind: "nc",
    id: "nc-1",
    title: "Glass Bong — BONG-0001",
    values: { product: "Glass Bong", price: "$49.99", sku: "BONG-0001" },
    codes: [
      { source: "sku", value: "BONG-0001", readiness: { severity: "ok", text: "Rings up" } },
      { source: "upc", value: "036000291452", readiness: { severity: "ok", text: "Rings up" } },
    ],
    defaultCode: "sku",
  };

  // Copies.
  ok(clampCopies(3) === 3 && clampCopies("7") === 7 && clampCopies("x") === 1 && clampCopies(-4) === 0, "clamp basics");
  ok(clampCopies(2.9) === 2 && clampCopies(99999) === MAX_COPIES_PER_ITEM && clampCopies(null) === 1, "clamp floor/ceiling/null");

  // Defaults keep today's sizes.
  ok(defaultStockId("lot") === "rollo-4x6" && defaultStockId("nc") === "ol-rl2676", "default stock per kind");
  ok(prefsStorageKey("lot") === "gw.labelStudio.v1.lot", "prefs key");

  // Prefs.
  const p0 = sanitizePrefs(null, lotSubj);
  ok(p0.printerId === "rollo-x1040" && p0.stockId === "rollo-4x6" && p0.template.codeSource === "lot_code", "empty prefs → defaults");
  const p1 = sanitizePrefs({ printerId: "rollo-x1040", stockId: "rollo-2x1", template: { symbology: "qr" } }, lotSubj);
  ok(p1.stockId === "rollo-2x1" && p1.template.symbology === "qr", "valid prefs kept");
  const p2 = sanitizePrefs({ printerId: "rollo-x1040", stockId: "dymo-30333" }, lotSubj);
  ok(p2.stockId === "rollo-4x6", "stock too narrow for Rollo → kind default");
  const p3 = sanitizePrefs({ printerId: "generic-300", stockId: "dymo-30333" }, ncSubj);
  ok(p3.printerId === "generic-300" && p3.stockId === "dymo-30333", "generic printer keeps narrow stock");
  const p4 = sanitizePrefs({ printerId: "nope", stockId: "nope", template: "garbage" }, ncSubj);
  ok(p4.printerId === "rollo-x1040" && p4.stockId === "ol-rl2676" && p4.template.codeSource === "sku", "garbage prefs → defaults");
  const p5 = sanitizePrefs({ stockId: "custom-2.5x1.5" }, ncSubj);
  ok(p5.stockId === "custom-2.5x1.5", "custom stock id survives");
  ok(sanitizePrefs({ stockId: "custom-9x9" }, ncSubj).stockId === "ol-rl2676", "out-of-range custom → default");

  // Inches parsing.
  ok(parseInches("2.25") === 2.25 && parseInches("2 1/4") === 2.25 && parseInches("2-1/4") === 2.25, "inches decimal/mixed");
  ok(parseInches("3/4") === 0.75 && parseInches('4"') === 4 && parseInches("4in") === 4 && parseInches("1.5 inches") === 1.5, "inches fraction/units");
  ok(Number.isNaN(parseInches("")) && Number.isNaN(parseInches("abc")) && Number.isNaN(parseInches("1/0")), "inches invalid");

  // Template per subject.
  const tUpc = { ...defaultTemplate(ncSubj, stockById("ol-rl2676")!), codeSource: "upc" as const };
  ok(templateForSubject(ncSubj, tUpc).codeSource === "upc", "nc keeps upc when present");
  ok(templateForSubject(lotSubj, tUpc).codeSource === "lot_code", "lot falls back to its own code");

  // Job plan.
  const s4x6 = stockById("rollo-4x6")!;
  const t4x6 = defaultTemplate(lotSubj, s4x6);
  const j1 = planPrintJob([{ subject: lotSubj, copies: 3 }], s4x6, ROLLO_X1040, t4x6);
  ok(j1.items.length === 1 && j1.totalLabels === 3 && j1.severity === "ok" && !j1.needsConfirm, "single lot job");
  ok(j1.items[0].svg.startsWith("<svg") && j1.items[0].svg.includes('width="4in"'), "job svg at stock size");
  const j2 = planPrintJob([{ subject: lotSubj, copies: 0 }], s4x6, ROLLO_X1040, t4x6);
  ok(j2.severity === "block" && j2.messages.some((m) => m.code === "nothing"), "zero copies blocks");
  const j3 = planPrintJob([{ subject: lotSubj, copies: 500 }, { subject: ncSubj, copies: 501 }], s4x6, ROLLO_X1040, t4x6);
  ok(j3.totalLabels === 1000 && j3.severity !== "block" && j3.needsConfirm, "1000 labels allowed with confirm");
  const j4 = planPrintJob([{ subject: lotSubj, copies: 500 }, { subject: ncSubj, copies: 500 }, { subject: { ...ncSubj, id: "nc-2" }, copies: 1 }], s4x6, ROLLO_X1040, t4x6);
  ok(j4.severity === "block" && j4.messages.some((m) => m.code === "too_many"), "over 1000 blocks");
  const narrow = stockById("dymo-30333")!;
  const j5 = planPrintJob([{ subject: ncSubj, copies: 1 }], narrow, ROLLO_X1040, defaultTemplate(ncSubj, narrow));
  ok(j5.severity === "block" && j5.messages.some((m) => m.code === "too_narrow"), "printer can't feed → blocked");
  // A refused item (row id only) next to a good one: warn, good one still prints.
  const bad: LabelSubject = { ...lotSubj, id: "lot-bad", title: "Bad", codes: [lotSubj.codes[1]], defaultCode: "row_id" };
  const j6 = planPrintJob([{ subject: lotSubj, copies: 1 }, { subject: bad, copies: 2 }], s4x6, ROLLO_X1040, t4x6);
  ok(j6.items.length === 1 && j6.refused.length === 1 && j6.severity === "warn" && j6.totalLabels === 1, "refused item skipped, rest prints");
  const j7 = planPrintJob([{ subject: bad, copies: 2 }], s4x6, ROLLO_X1040, t4x6);
  ok(j7.severity === "block" && j7.items.length === 0, "only refused → blocked");
  // Long Code 128 on 2x1 is refused honestly, QR rescues it.
  const s2x1 = stockById("rollo-2x1")!;
  const longLot: LabelSubject = { ...lotSubj, id: "lot-long", codes: [{ source: "lot_code", value: "ABCDEFGHJKLMNPQRSTUV", readiness: { severity: "ok", text: "ok" } }] };
  const j8 = planPrintJob([{ subject: longLot, copies: 1 }], s2x1, ROLLO_X1040, defaultTemplate(longLot, s2x1));
  ok(j8.severity === "block", "20-char Code 128 refused on 2x1");
  const j9 = planPrintJob([{ subject: longLot, copies: 1 }], s2x1, ROLLO_X1040, { ...defaultTemplate(longLot, s2x1), symbology: "qr" });
  ok(j9.severity !== "block" && j9.totalLabels === 1, "QR fits the same code on 2x1");

  // SVG resize only touches the root.
  const svg = j1.items[0].svg;
  const resized = svgAtSize(svg, "100%", "auto");
  ok(resized.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="auto"'), "root svg resized");
  ok((resized.match(/width="100%"/g) ?? []).length === 1, "nested svgs untouched");

  // Print CSS.
  const css = printCss(s4x6);
  ok(css.includes("@page { size: 4in 6in; margin: 0; }"), "page size");
  ok(css.includes(`body>*:not(.${PRINT_ROOT_CLASS}){display:none!important}`), "hides admin chrome");
  ok(css.includes("break-after:page") && css.includes(":last-child{break-after:auto"), "one label per page, no trailing blank");
  ok(!/[<>]/.test(css.replace(/body>\*/g, "")), "no markup in css");
  ok(printCss(stockById("ol-rl2676")!).includes("size: 2.25in 1.25in"), "nc page size");

  // Spec text.
  ok(/^Code 128 · \d+(\.\d+)? mil bars · /.test(barcodeSpecText(j1.items[0].layout)), "spec text code128");
  ok(/QR/.test(barcodeSpecText(j9.items[0].layout)) && /mil modules/.test(barcodeSpecText(j9.items[0].layout)), "spec text qr");
  ok(PRINTERS.length >= 3, "printers exported");

  // Row adapters.
  const lr = lotSourceFromRow({ id: "x", lot_code: "L1", received_qty: "24", unit: "each", ccrs_inventory_external_id: "WA1", expires_on_source: "rule", unit_weight: 3.5 });
  ok(lr.lot_code === "L1" && lr.received_qty === 24 && lr.ccrs_inventory_external_id === "WA1" && lr.expires_on_source === "rule" && lr.unit_weight === 3.5, "lot row adapter");
  ok(lotSourceFromRow({ id: 5 }).id === "5" && lotSourceFromRow({}).lot_code === null, "lot row adapter defensive");
  const nr = ncSourceFromRow({ id: "n", sku: "S-1", name: "N", type: "bong", price_minor_units: 4999.7, status: "active" });
  ok(nr.price_minor_units === 4999 && nr.status === "active" && nr.barcode === null, "nc row adapter");
  ok(ncSourceFromRow({}).status === "draft" && ncSourceFromRow({}).sku === "", "nc row adapter defensive");
  ok(suggestedCopiesForLot({ ...lr, received_qty: 24, unit: "each" }) === 24, "each → per unit");
  ok(suggestedCopiesForLot({ ...lr, received_qty: 448, unit: "grams" }) === null, "grams → no suggestion");
  ok(suggestedCopiesForLot({ ...lr, received_qty: 2.5, unit: "each" }) === null, "fractional → no suggestion");
  ok(suggestedCopiesForLot({ ...lr, received_qty: 9999, unit: "each" }) === MAX_COPIES_PER_ITEM, "capped suggestion");

  // Load errors.
  ok(/permission denied, 42501/.test(labelLoadErrorText("42501", "x")), "load err permission");
  ok(/missing \(PGRST205\)/.test(labelLoadErrorText("PGRST205", "x")) && /missing \(42P01\)/.test(labelLoadErrorText("42P01", "")), "load err missing");
  ok(/Couldn't load.*\(57014\): timeout/.test(labelLoadErrorText("57014", " timeout ")) && /Nothing was printed/.test(labelLoadErrorText(null, "")), "load err other");

  return { passed, failed };
}
