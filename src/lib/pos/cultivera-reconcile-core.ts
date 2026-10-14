/**
 * src/lib/pos/cultivera-reconcile-core.ts  (R50 A2)
 *
 * PURE: "do the units balance?" - the go / no-go check after the cutover
 * import. Cultivera's side is the import's own stored inventories workbook
 * (the exact file the lots were made from, pos_imports.inventories_storage_key);
 * our side is the lots on that import's manifests (inventory_lots.received_qty,
 * which follows the lots when S2c re-homes them onto rebuilt manifests).
 *
 * Units rule = the import's rule, byte for byte (transform.ts collectLotSources
 * + import-lot-core planImportLots): per row `max(0, floor(Units Available For
 * Sale))`, rows summed per barcode, zero-unit rows never become lots. A row
 * with a blank Product is skipped by the transform, so its units can never
 * reach a lot - that is reported as a red line, never hidden.
 *
 * received_qty, not on_hand_qty: on-hand moves with every sale and with the
 * Oct 30 count; received_qty is what the import wrote and must equal the file.
 * On-hand is shown beside it for information only.
 *
 * Green ONLY when every read was complete and every check passes. Any doubt
 * (a failed read, a quantity that is not a whole number) is red with the
 * reason. Nothing here writes.
 */

export type WorkbookRow = Record<string, unknown>;

export type ReconcileLot = {
  id: string;
  lot_code: string | null;
  received_qty: number | string | null;
  on_hand_qty: number | string | null;
  status?: string | null;
};

export const RECONCILE_UNITS_COLUMN = "Units Available For Sale";
export const RECONCILE_NO_VENDOR = "(no vendor)";
export const RECONCILE_NO_CATEGORY = "(no category)";
export const RECONCILE_NOT_IN_FILE = "(not in the Cultivera file)";
export const RECONCILE_LINE_CAP = 200;
export const RECONCILE_NO_BARCODE = "(no barcode)";
export const RECONCILE_NO_PRODUCT = "(no product name)";

function ws(v: unknown): string {
  return String(v ?? "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
}

/** transform.ts toNumber + Math.max(0, Math.floor(...)): the import's units. */
export function importUnits(v: unknown): number {
  const s = ws(v).replace(/[$,]/g, "");
  if (!s) return 0;
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

/** A DB quantity as a whole number, or null (never rounded into agreement). */
export function wholeQty(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && Number.isInteger(n) ? n : null;
}

export type FileBarcode = { barcode: string; units: number; vendor: string; category: string; product: string; rows: number };

export type FileSide = {
  byBarcode: Map<string, FileBarcode>;
  /** Units on rows with no barcode (the import mints a synthetic lot code; lot_code stays null). */
  noBarcodeUnits: number;
  noBarcodeRows: number;
  zeroUnitRows: number;
  /** Rows the transform skips (blank Product) that still carry units. */
  blankProduct: { barcode: string; units: number }[];
  rows: number;
};

/** Cultivera's side, from the stored workbook rows (sheet_to_json raw:false, defval ""). */
export function fileSide(rows: readonly WorkbookRow[]): FileSide {
  const byBarcode = new Map<string, FileBarcode>();
  let noBarcodeUnits = 0;
  let noBarcodeRows = 0;
  let zeroUnitRows = 0;
  const blankProduct: FileSide["blankProduct"] = [];
  for (const r of rows) {
    const units = importUnits(r[RECONCILE_UNITS_COLUMN]);
    const barcode = ws(r.Barcode);
    if (!ws(r.Product)) {
      if (units > 0) blankProduct.push({ barcode, units });
      continue;
    }
    if (units <= 0) {
      zeroUnitRows += 1;
      continue;
    }
    if (!barcode) {
      noBarcodeUnits += units;
      noBarcodeRows += 1;
      continue;
    }
    const cur = byBarcode.get(barcode);
    if (cur) {
      cur.units += units;
      cur.rows += 1;
    } else {
      byBarcode.set(barcode, {
        barcode,
        units,
        vendor: ws(r.Vendor) || RECONCILE_NO_VENDOR,
        category: ws(r.Category) || RECONCILE_NO_CATEGORY,
        product: ws(r.Product),
        rows: 1,
      });
    }
  }
  return { byBarcode, noBarcodeUnits, noBarcodeRows, zeroUnitRows, blankProduct, rows: rows.length };
}

export type MismatchKind = "units_differ" | "missing_lot" | "extra_lot" | "not_whole" | "blank_product" | "no_barcode";

export type MismatchLine = {
  barcode: string;
  kind: MismatchKind;
  product: string;
  vendor: string;
  category: string;
  cultivera: number | null;
  ours: number | null;
  /** missing_lot: a lot with this barcode exists on a delivery from before the import. */
  elsewhere?: boolean;
  /** Our lots behind this line (links on the page). For an elsewhere line: the lots found elsewhere. */
  lotIds: string[];
};

export const KIND_ORDER: Record<MismatchKind, number> = { not_whole: 0, missing_lot: 1, units_differ: 2, extra_lot: 3, no_barcode: 4, blank_product: 5 };

export type GroupRow = { key: string; cultivera: number; ours: number; diff: number; ok: boolean };

export type ReconcileCheck = { id: string; pass: boolean; detail: string };

export type ReconcileReport = {
  go: boolean;
  checks: ReconcileCheck[];
  totals: { cultivera: number; ours: number; onHandNow: number; barcodes: number; lots: number };
  byVendor: GroupRow[];
  byCategory: GroupRow[];
  mismatches: MismatchLine[];
  mismatchCount: number;
  info: { zeroUnitRows: number; sharedBarcodeLots: number; noBarcodeRows: number; fileRows: number };
};

function groupRows(acc: Map<string, { c: number; o: number }>): GroupRow[] {
  return [...acc.entries()]
    .map(([key, v]) => ({ key, cultivera: v.c, ours: v.o, diff: v.o - v.c, ok: v.o === v.c }))
    .sort((a, b) => Number(a.ok) - Number(b.ok) || Math.abs(b.diff) - Math.abs(a.diff) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

function add(acc: Map<string, { c: number; o: number }>, key: string, c: number, o: number) {
  const cur = acc.get(key) ?? { c: 0, o: 0 };
  cur.c += c;
  cur.o += o;
  acc.set(key, cur);
}

/**
 * The comparison. `elsewhere` = for each missing barcode that DOES have a lot
 * outside this import (the import skips a CCRS id that is already a lot), the
 * ids of those lots. Still red - the units are not on this import - but named,
 * with links.
 *
 * `mismatches` is the FULL list (sorted). The page filters and pages it; the
 * CSV download writes every line.
 */
export function reconcile(input: {
  file: FileSide;
  lots: readonly ReconcileLot[];
  elsewhere?: ReadonlyMap<string, readonly string[]>;
  readsComplete: boolean;
}): ReconcileReport {
  const { file } = input;
  const ours = new Map<string, { units: number; lots: number; ids: string[] }>();
  let oursNoBarcode = 0;
  const noBarcodeIds: string[] = [];
  let oursTotal = 0;
  let onHandNow = 0;
  const notWhole: MismatchLine[] = [];
  /** Barcodes that DO have a lot here, even if its quantity is not whole (never also "missing"). */
  const notWholeCodes = new Set<string>();
  for (const l of input.lots) {
    const rec = wholeQty(l.received_qty);
    const oh = wholeQty(l.on_hand_qty);
    const code = ws(l.lot_code);
    if (rec == null) {
      if (code) notWholeCodes.add(code);
      const f = code ? file.byBarcode.get(code) : undefined;
      notWhole.push({ barcode: code || l.id, kind: "not_whole", product: f?.product ?? "", vendor: f?.vendor ?? RECONCILE_NOT_IN_FILE, category: f?.category ?? RECONCILE_NOT_IN_FILE, cultivera: f?.units ?? null, ours: null, lotIds: [l.id] });
      continue;
    }
    oursTotal += rec;
    if (oh != null) onHandNow += oh;
    if (!code) {
      oursNoBarcode += rec;
      noBarcodeIds.push(l.id);
      continue;
    }
    const cur = ours.get(code) ?? { units: 0, lots: 0, ids: [] };
    cur.units += rec;
    cur.lots += 1;
    cur.ids.push(l.id);
    ours.set(code, cur);
  }

  const vendors = new Map<string, { c: number; o: number }>();
  const cats = new Map<string, { c: number; o: number }>();
  const lines: MismatchLine[] = [...notWhole];
  let fileTotal = file.noBarcodeUnits;
  for (const f of file.byBarcode.values()) {
    fileTotal += f.units;
    const o = ours.get(f.barcode);
    add(vendors, f.vendor, f.units, o?.units ?? 0);
    add(cats, f.category, f.units, o?.units ?? 0);
    if (!o) {
      if (notWholeCodes.has(f.barcode)) continue; // already red as not_whole; a lot exists
      const away = input.elsewhere?.get(f.barcode);
      lines.push({ barcode: f.barcode, kind: "missing_lot", product: f.product, vendor: f.vendor, category: f.category, cultivera: f.units, ours: 0, lotIds: away ? [...away] : [], ...(away && away.length > 0 ? { elsewhere: true } : {}) });
    } else if (o.units !== f.units) {
      lines.push({ barcode: f.barcode, kind: "units_differ", product: f.product, vendor: f.vendor, category: f.category, cultivera: f.units, ours: o.units, lotIds: o.ids });
    }
  }
  for (const [code, o] of ours) {
    if (file.byBarcode.has(code)) continue;
    add(vendors, RECONCILE_NOT_IN_FILE, 0, o.units);
    add(cats, RECONCILE_NOT_IN_FILE, 0, o.units);
    lines.push({ barcode: code, kind: "extra_lot", product: "", vendor: RECONCILE_NOT_IN_FILE, category: RECONCILE_NOT_IN_FILE, cultivera: null, ours: o.units, lotIds: o.ids });
  }
  for (const b of file.blankProduct) {
    fileTotal += b.units;
    lines.push({ barcode: b.barcode || "(no barcode)", kind: "blank_product", product: "", vendor: RECONCILE_NO_PRODUCT, category: RECONCILE_NO_PRODUCT, cultivera: b.units, ours: null, lotIds: [] });
  }
  if (file.noBarcodeUnits > 0 || oursNoBarcode > 0) {
    add(vendors, RECONCILE_NO_BARCODE, file.noBarcodeUnits, oursNoBarcode);
    add(cats, RECONCILE_NO_BARCODE, file.noBarcodeUnits, oursNoBarcode);
    if (file.noBarcodeUnits !== oursNoBarcode) {
      lines.push({ barcode: RECONCILE_NO_BARCODE, kind: "no_barcode", product: `${file.noBarcodeRows} Cultivera row(s) with no barcode`, vendor: RECONCILE_NO_BARCODE, category: RECONCILE_NO_BARCODE, cultivera: file.noBarcodeUnits, ours: oursNoBarcode, lotIds: noBarcodeIds });
    }
  }
  const blankUnits = file.blankProduct.reduce((s, b) => s + b.units, 0);
  if (blankUnits > 0) {
    add(vendors, RECONCILE_NO_PRODUCT, blankUnits, 0);
    add(cats, RECONCILE_NO_PRODUCT, blankUnits, 0);
  }

  lines.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.barcode < b.barcode ? -1 : a.barcode > b.barcode ? 1 : 0));

  const count = (k: MismatchKind) => lines.filter((l) => l.kind === k).length;
  const missing = count("missing_lot");
  const extra = count("extra_lot");
  const differ = count("units_differ");
  const sharedBarcodeLots = [...ours.values()].filter((o) => o.lots > 1).length;
  const checks: ReconcileCheck[] = [
    { id: "reads", pass: input.readsComplete, detail: input.readsComplete ? "Every lot and the stored Cultivera file were read in full." : "Something could not be read in full, so this cannot say the units balance." },
    { id: "total", pass: fileTotal === oursTotal && notWhole.length === 0, detail: `Cultivera ${fileTotal.toLocaleString("en-US")} units, ours ${oursTotal.toLocaleString("en-US")} (received).` },
    { id: "barcodes", pass: differ === 0, detail: differ === 0 ? "Every barcode has the same units on both sides." : `${differ} barcode(s) have different units.` },
    { id: "missing", pass: missing === 0, detail: missing === 0 ? "Every Cultivera barcode with stock has a lot." : `${missing} Cultivera barcode(s) with stock have no lot on this import.` },
    { id: "extra", pass: extra === 0, detail: extra === 0 ? "Every lot is in the Cultivera file." : `${extra} lot(s) are not in the Cultivera file.` },
    { id: "no_barcode", pass: file.noBarcodeUnits === oursNoBarcode, detail: `Rows with no barcode: Cultivera ${file.noBarcodeUnits}, ours ${oursNoBarcode}.` },
    { id: "blank_product", pass: blankUnits === 0, detail: blankUnits === 0 ? "No Cultivera row with stock is missing its product name." : `${file.blankProduct.length} Cultivera row(s) with ${blankUnits} units have no product name, so the import skipped them.` },
    { id: "whole", pass: notWhole.length === 0, detail: notWhole.length === 0 ? "Every lot quantity is a whole number." : `${notWhole.length} lot(s) have a quantity that is not a whole number.` },
  ];
  return {
    go: checks.every((c) => c.pass),
    checks,
    totals: { cultivera: fileTotal, ours: oursTotal, onHandNow, barcodes: file.byBarcode.size, lots: input.lots.length },
    byVendor: groupRows(vendors),
    byCategory: groupRows(cats),
    mismatches: lines,
    mismatchCount: lines.length,
    info: { zeroUnitRows: file.zeroUnitRows, sharedBarcodeLots, noBarcodeRows: file.noBarcodeRows, fileRows: file.rows },
  };
}

/** Barcodes worth asking "is it a lot somewhere else?" (the missing ones, capped). */
export function missingBarcodes(file: FileSide, lots: readonly ReconcileLot[], cap = 2000): string[] {
  const have = new Set(lots.map((l) => ws(l.lot_code)).filter(Boolean)); // any lot, whole or not
  return [...file.byBarcode.keys()].filter((b) => !have.has(b)).sort().slice(0, cap);
}

export const MISMATCH_COPY: Record<MismatchKind, string> = {
  units_differ: "Different units",
  missing_lot: "In Cultivera, no lot here",
  extra_lot: "Lot here, not in Cultivera",
  not_whole: "Quantity is not a whole number",
  blank_product: "Cultivera row has no product name",
  no_barcode: "Rows with no barcode do not add up",
};

/**
 * What to do about each kind, in plain words. Every line on the page shows
 * its own; nothing here is applied for him.
 */
export const MISMATCH_FIX: Record<MismatchKind, string> = {
  missing_lot:
    "Press \"Create the missing lots\" below. It re-runs the import's own lot step, which only adds lots that do not exist yet, so it is safe to press again. If the line still shows afterwards, open the barcode in Cultivera and check it.",
  units_differ:
    "Open the lot. A lot's received quantity is locked (it is what came in), so do not edit it by hand. Check whether two Cultivera rows were merged into one lot or the lot was changed after the import, then write what you found in the note.",
  extra_lot:
    "Open the lot. It sits on this import's delivery but its barcode is not in the Cultivera file. It is usually a lot moved here by \"Rebuild deliveries\", or a lot from an older import. Write what you found in the note.",
  not_whole:
    "Open the lot. Cultivera only sells whole units, so a part-unit received quantity means the lot was changed by hand. Check its history before opening.",
  blank_product:
    "Fix the product name in Cultivera, then press Fetch again and import the new harvest. The import skips a row with no product name, so its units can never become a lot.",
  no_barcode:
    "Check the rows with no barcode in Cultivera. Each one became a lot with a made-up code. Add the real barcode in Cultivera if you can.",
};

export function mismatchNote(l: MismatchLine): string {
  if (l.kind === "missing_lot" && l.elsewhere) return "A lot with this barcode already existed on an earlier delivery, so the import did not add it again.";
  return MISMATCH_COPY[l.kind];
}

export function mismatchFix(l: MismatchLine): string {
  if (l.kind === "missing_lot" && l.elsewhere)
    return "Open the existing lot. If it is the same stock, its units are already counted there, so write that in the note. If it is old stock that is gone, adjust it to zero on its own page.";
  return MISMATCH_FIX[l.kind];
}

export function reconcileHeadline(r: Pick<ReconcileReport, "go" | "totals" | "mismatchCount">): string {
  if (r.go) return `GO: the units balance. Cultivera ${r.totals.cultivera.toLocaleString("en-US")} = ours ${r.totals.ours.toLocaleString("en-US")}, barcode by barcode.`;
  return `NO-GO: the units do not balance (${r.mismatchCount} line(s) to look at). Do not open on this import until each one is explained.`;
}

/* ------------------------------------------------------------------ *
 *  Explanations: the owner's "I looked at this one" notes
 * ------------------------------------------------------------------ */

/**
 * A note is tied to the exact line it explains: kind + barcode + BOTH numbers.
 * If either number changes afterwards, the note no longer matches and the line
 * is unexplained again (a note never carries over to a different problem).
 */
export function lineKey(l: Pick<MismatchLine, "kind" | "barcode" | "cultivera" | "ours">): string {
  return `${l.kind}|${l.barcode}|${l.cultivera ?? ""}|${l.ours ?? ""}`;
}

export const RECONCILE_NOTE_MAX = 500;
export const RECONCILE_EXPLAIN_ACTION = "cultivera_reconcile.explain";
export const RECONCILE_UNEXPLAIN_ACTION = "cultivera_reconcile.unexplain";
export const RECONCILE_SIGNOFF_ACTION = "cultivera_reconcile.signoff";

export type Explanation = { key: string; note: string; by: string | null; at: string };

/** One audit row (newest first or any order) -> the explanations still in force. */
export type ExplainEvent = { action: string; key: string; note: string | null; by: string | null; at: string; id: number };

export function explanationsFromEvents(events: readonly ExplainEvent[]): Map<string, Explanation> {
  const sorted = [...events].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id - b.id));
  const out = new Map<string, Explanation>();
  for (const e of sorted) {
    if (!e.key) continue;
    if (e.action === RECONCILE_EXPLAIN_ACTION && e.note && e.note.trim()) out.set(e.key, { key: e.key, note: e.note.trim(), by: e.by, at: e.at });
    else if (e.action === RECONCILE_UNEXPLAIN_ACTION) out.delete(e.key);
  }
  return out;
}

/** Validate a note before it is saved. */
export function parseExplainInput(v: { key: unknown; note: unknown }): { ok: true; key: string; note: string } | { ok: false; error: string } {
  const key = typeof v.key === "string" ? v.key.trim() : "";
  const note = typeof v.note === "string" ? v.note.replace(/\s+/g, " ").trim() : "";
  if (!/^(units_differ|missing_lot|extra_lot|not_whole|blank_product|no_barcode)\|[^|]{1,200}\|\d*\|\d*$/.test(key)) return { ok: false, error: "That line could not be identified. Reload the page and try again." };
  if (note.length < 3) return { ok: false, error: "Write a short note saying what you found (at least 3 characters)." };
  if (note.length > RECONCILE_NOTE_MAX) return { ok: false, error: `Keep the note under ${RECONCILE_NOTE_MAX} characters.` };
  return { ok: true, key, note };
}

export type Verdict = "go" | "go_explained" | "no_go";

/**
 * GO = everything balances. GO (explained) = the reads were complete and every
 * line left has a current note from the owner. NO-GO otherwise. A failed read
 * is NO-GO no matter what (a note cannot vouch for rows that were never read).
 */
export function verdictFor(r: Pick<ReconcileReport, "go" | "checks" | "mismatches">, explained: ReadonlyMap<string, Explanation>): { verdict: Verdict; open: number; explained: number } {
  const readsOk = r.checks.find((c) => c.id === "reads")?.pass === true;
  const exp = r.mismatches.filter((l) => explained.has(lineKey(l))).length;
  const open = r.mismatches.length - exp;
  if (!readsOk) return { verdict: "no_go", open, explained: exp };
  if (r.go) return { verdict: "go", open: 0, explained: 0 };
  return { verdict: open === 0 && r.mismatches.length > 0 ? "go_explained" : "no_go", open, explained: exp };
}

export const VERDICT_COPY: Record<Verdict, string> = {
  go: "GO - the units balance, barcode by barcode.",
  go_explained: "GO (explained) - every difference left has your note.",
  no_go: "NO-GO - there are differences nobody has explained yet.",
};

/* ------------------------------------------------------------------ *
 *  Filters, paging, barcode lookup, CSV
 * ------------------------------------------------------------------ */

export type LineFilter = { kind?: string; vendor?: string; category?: string; q?: string; open?: boolean };

export function filterLines(lines: readonly MismatchLine[], f: LineFilter, explained?: ReadonlyMap<string, Explanation>): MismatchLine[] {
  const q = ws(f.q).toLowerCase();
  return lines.filter((l) => {
    if (f.kind && l.kind !== f.kind) return false;
    if (f.vendor && l.vendor !== f.vendor) return false;
    if (f.category && l.category !== f.category) return false;
    if (f.open && explained && explained.has(lineKey(l))) return false;
    if (q && !(l.barcode.toLowerCase().includes(q) || l.product.toLowerCase().includes(q) || l.vendor.toLowerCase().includes(q))) return false;
    return true;
  });
}

export function pageOf<T>(items: readonly T[], page: number, size = RECONCILE_LINE_CAP): { items: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const p = Number.isInteger(page) && page >= 1 ? Math.min(page, pages) : 1;
  return { items: items.slice((p - 1) * size, p * size), page: p, pages };
}

export type BarcodeLookup = {
  barcode: string;
  file: FileBarcode | null;
  lots: { id: string; received: number | null; onHand: number | null; status: string | null }[];
  line: MismatchLine | null;
};

/** "Show me everything about this one barcode" - both sides, side by side. */
export function lookupBarcode(barcode: string, file: FileSide, lots: readonly ReconcileLot[], report: Pick<ReconcileReport, "mismatches">): BarcodeLookup | null {
  const b = ws(barcode);
  if (!b) return null;
  return {
    barcode: b,
    file: file.byBarcode.get(b) ?? null,
    lots: lots.filter((l) => ws(l.lot_code) === b).map((l) => ({ id: l.id, received: wholeQty(l.received_qty), onHand: wholeQty(l.on_hand_qty), status: l.status ?? null })),
    line: report.mismatches.find((l) => l.barcode === b) ?? null,
  };
}

/** Spreadsheet-safe cell: RFC 4180 quoting + a leading ' on formula starters (=,+,-,@). */
export function reconcileCsvCell(v: string | number | null | undefined): string {
  if (v == null) return "";
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const RECONCILE_CSV_HEADER = ["Kind", "Barcode", "Product", "Vendor", "Category", "Cultivera units", "Our units", "Difference", "What it means", "What to do", "Your note", "Lot ids"];

export function reconcileCsv(lines: readonly MismatchLine[], explained: ReadonlyMap<string, Explanation> = new Map()): string {
  const out = [RECONCILE_CSV_HEADER.map(reconcileCsvCell).join(",")];
  for (const l of lines) {
    const diff = l.cultivera != null && l.ours != null ? l.ours - l.cultivera : null;
    out.push(
      [MISMATCH_COPY[l.kind], l.barcode, l.product, l.vendor, l.category, l.cultivera, l.ours, diff, mismatchNote(l), mismatchFix(l), explained.get(lineKey(l))?.note ?? "", l.lotIds.join(" ")]
        .map(reconcileCsvCell)
        .join(","),
    );
  }
  return out.join("\r\n") + "\r\n";
}

/* ------------------------------------------------------------------ *
 *  Page helpers
 * ------------------------------------------------------------------ */

export const RECONCILE_HREF = "/admin/menu-imports/reconcile";
export const RECONCILE_KINDS = Object.keys(KIND_ORDER) as MismatchKind[];

/** Lines per kind (in page order), open = not explained. Kinds with no lines are left out. */
export function kindCounts(lines: readonly MismatchLine[], explained: ReadonlyMap<string, Explanation> = new Map()): { kind: MismatchKind; total: number; open: number }[] {
  return RECONCILE_KINDS.map((kind) => {
    const of = lines.filter((l) => l.kind === kind);
    return { kind, total: of.length, open: of.filter((l) => !explained.has(lineKey(l))).length };
  }).filter((c) => c.total > 0);
}

/** Missing lines the "Create the missing lots" button can actually help (not the elsewhere ones). */
export function creatableMissing(lines: readonly MismatchLine[]): number {
  return lines.filter((l) => l.kind === "missing_lot" && !l.elsewhere).length;
}

/** A link back to this page with filters (empty values dropped). */
export function reconcileHref(importId: string, q: Partial<Record<"kind" | "vendor" | "category" | "q" | "open" | "page" | "barcode", string | number>> = {}): string {
  const p = new URLSearchParams();
  if (importId) p.set("import", importId);
  for (const k of ["kind", "vendor", "category", "q", "open", "page", "barcode"] as const) {
    const v = q[k];
    if (v != null && String(v) !== "") p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `${RECONCILE_HREF}?${s}` : RECONCILE_HREF;
}

/** The kind filter from the URL, or "" when it is not a real kind. */
export function parseKind(v: unknown): MismatchKind | "" {
  return typeof v === "string" && (RECONCILE_KINDS as string[]).includes(v) ? (v as MismatchKind) : "";
}

/* ------------------------------------------------------------------ *
 *  Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
 * ------------------------------------------------------------------ */

export function __runCultiveraReconcileCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error("FAIL cultivera-reconcile-core:", m);
    }
  };
  const row = (b: string, u: unknown, o: Partial<Record<string, unknown>> = {}): WorkbookRow => ({ Barcode: b, Product: "P " + b, Vendor: "Acme", Category: "Flower", [RECONCILE_UNITS_COLUMN]: u, ...o });
  const lot = (code: string | null, rec: unknown, oh: unknown = rec, id = "L-" + code): ReconcileLot => ({ id, lot_code: code, received_qty: rec as number, on_hand_qty: oh as number });

  // importUnits mirrors transform: floor, never negative, $/, stripped, junk = 0
  ok(importUnits("4") === 4 && importUnits(4.9) === 4 && importUnits("1,204") === 1204, "units floor + commas");
  ok(importUnits(-3) === 0 && importUnits("") === 0 && importUnits("abc") === 0 && importUnits(null) === 0, "units never negative / junk 0");
  ok(importUnits(" 7 ") === 7 && importUnits("$5") === 5, "units trim + $");
  ok(wholeQty("5") === 5 && wholeQty(5) === 5 && wholeQty("5.5") === null && wholeQty(null) === null && wholeQty("") === null, "wholeQty");

  // fileSide
  const fs = fileSide([row("A", 3), row("A", 2), row("B", 0), row("", 4), row("C", 1, { Product: "" }), row("D", "x"), row("E", 1, { Vendor: "", Category: "" })]);
  ok(fs.byBarcode.get("A")?.units === 5 && fs.byBarcode.get("A")?.rows === 2, "rows summed per barcode");
  ok(!fs.byBarcode.has("B") && fs.zeroUnitRows === 2, "zero/junk unit rows skipped (B, D)");
  ok(fs.noBarcodeUnits === 4 && fs.noBarcodeRows === 1, "no-barcode bucket");
  ok(fs.blankProduct.length === 1 && fs.blankProduct[0].units === 1 && !fs.byBarcode.has("C"), "blank product kept aside with units");
  ok(fs.byBarcode.get("E")?.vendor === RECONCILE_NO_VENDOR && fs.byBarcode.get("E")?.category === RECONCILE_NO_CATEGORY, "blank vendor/category labelled");
  ok(fs.rows === 7, "row count");
  ok(fileSide([row("Z", 0, { Product: "" })]).blankProduct.length === 0, "blank product with 0 units is not a red line");

  // balanced
  const f1 = fileSide([row("A", 3), row("B", 2, { Vendor: "Bee", Category: "Edible" })]);
  const r1 = reconcile({ file: f1, lots: [lot("A", 3, 1), lot("B", 2)], readsComplete: true });
  ok(r1.go && r1.mismatchCount === 0, "balanced = go");
  ok(r1.totals.cultivera === 5 && r1.totals.ours === 5 && r1.totals.onHandNow === 3, "totals + on-hand info");
  ok(r1.byVendor.length === 2 && r1.byVendor.every((g) => g.ok), "vendor groups green");
  ok(r1.byCategory.find((g) => g.key === "Edible")?.cultivera === 2, "category group");
  ok(reconcileHeadline(r1).startsWith("GO:"), "GO headline");

  // on-hand never decides
  ok(reconcile({ file: f1, lots: [lot("A", 3, 0), lot("B", 2, 0)], readsComplete: true }).go, "on-hand moved (sales/count) still go");

  // reads incomplete -> never go
  const r2 = reconcile({ file: f1, lots: [lot("A", 3), lot("B", 2)], readsComplete: false });
  ok(!r2.go && r2.checks.find((c) => c.id === "reads")?.pass === false, "incomplete read = no-go");

  // units differ
  const r3 = reconcile({ file: f1, lots: [lot("A", 4), lot("B", 2)], readsComplete: true });
  ok(!r3.go && r3.mismatches[0].kind === "units_differ" && r3.mismatches[0].cultivera === 3 && r3.mismatches[0].ours === 4, "units differ line");
  ok(r3.byVendor[0].key === "Acme" && !r3.byVendor[0].ok && r3.byVendor[0].diff === 1, "red vendor sorted first with diff");
  ok(reconcileHeadline(r3).startsWith("NO-GO"), "NO-GO headline");

  // missing lot (+ elsewhere)
  const r4 = reconcile({ file: f1, lots: [lot("A", 3)], elsewhere: new Map([["B", ["OLD-1"]]]), readsComplete: true });
  ok(!r4.go && r4.mismatches.some((l) => l.kind === "missing_lot" && l.barcode === "B" && l.elsewhere === true && l.lotIds.join() === "OLD-1"), "missing lot, elsewhere named with its lot");
  ok(mismatchNote(r4.mismatches.find((l) => l.barcode === "B")!).includes("earlier delivery"), "elsewhere note");
  ok(r4.checks.find((c) => c.id === "missing")?.pass === false && r4.checks.find((c) => c.id === "total")?.pass === false, "missing fails total + missing");
  const r4b = reconcile({ file: f1, lots: [lot("A", 3)], readsComplete: true });
  ok(r4b.mismatches.find((l) => l.barcode === "B")?.elsewhere === undefined, "not elsewhere = no flag");
  ok(mismatchNote(r4b.mismatches.find((l) => l.barcode === "B")!) === MISMATCH_COPY.missing_lot, "plain missing note");

  // extra lot
  const r5 = reconcile({ file: f1, lots: [lot("A", 3), lot("B", 2), lot("X", 9)], readsComplete: true });
  ok(!r5.go && r5.mismatches.some((l) => l.kind === "extra_lot" && l.barcode === "X" && l.ours === 9), "extra lot");
  ok(r5.byVendor.some((g) => g.key === RECONCILE_NOT_IN_FILE && g.ours === 9 && !g.ok), "extra lot grouped as not-in-file");
  ok(r5.checks.find((c) => c.id === "extra")?.pass === false, "extra check fails");

  // two lots same barcode summed
  const r6 = reconcile({ file: fileSide([row("A", 5)]), lots: [lot("A", 2, 2, "L1"), lot("A", 3, 3, "L2")], readsComplete: true });
  ok(r6.go && r6.info.sharedBarcodeLots === 1, "shared barcode lots summed, info counted");

  // no barcode bucket
  const f7 = fileSide([row("", 4), row("A", 1)]);
  ok(reconcile({ file: f7, lots: [lot(null, 4), lot("A", 1)], readsComplete: true }).go, "no-barcode bucket balances");
  const r7 = reconcile({ file: f7, lots: [lot(null, 3), lot("A", 1)], readsComplete: true });
  ok(!r7.go && r7.checks.find((c) => c.id === "no_barcode")?.pass === false, "no-barcode bucket differs = no-go");
  ok(r7.byVendor.some((g) => g.key === "(no barcode)" && g.diff === -1), "no-barcode group row");

  // blank product -> red even though no lot
  const f8 = fileSide([row("A", 1), row("C", 2, { Product: "" })]);
  const r8 = reconcile({ file: f8, lots: [lot("A", 1)], readsComplete: true });
  ok(!r8.go && r8.checks.find((c) => c.id === "blank_product")?.pass === false && r8.totals.cultivera === 3, "blank product row red + counted in total");
  ok(r8.byVendor.some((g) => g.key === "(no product name)" && g.cultivera === 2), "blank product group row");

  // not whole
  const r9 = reconcile({ file: f1, lots: [lot("A", "2.5"), lot("B", 2)], readsComplete: true });
  ok(!r9.go && r9.mismatches[0].kind === "not_whole" && r9.checks.find((c) => c.id === "whole")?.pass === false, "non-whole qty red, first");
  ok(r9.totals.ours === 2, "non-whole excluded from total (never rounded)");
  ok(r9.mismatches.filter((l) => l.barcode === "A").length === 1 && creatableMissing(r9.mismatches) === 0, "non-whole lot is one red line, never also 'missing' (nothing to create)");

  // sort + cap
  const many = fileSide(Array.from({ length: 250 }, (_, i) => row(`B${String(i).padStart(3, "0")}`, 1)));
  const r10 = reconcile({ file: many, lots: [], readsComplete: true });
  ok(r10.mismatches.length === 250 && r10.mismatchCount === 250, "full line list kept (page pages it)");
  ok(r10.mismatches[0].barcode === "B000" && r10.mismatches[1].barcode === "B001", "lines sorted by barcode");
  const mixed = reconcile({ file: f1, lots: [lot("A", 4), lot("X", 1), lot("Q", "1.5")], readsComplete: true });
  ok(mixed.mismatches.map((l) => l.kind).join(",") === "not_whole,missing_lot,units_differ,extra_lot", "kind order");
  ok(mixed.mismatches.find((l) => l.kind === "units_differ")?.lotIds.join() === "L-A" && mixed.mismatches.find((l) => l.kind === "not_whole")?.lotIds.join() === "L-Q", "lines carry lot ids");


  // blank product + no barcode are LINES too (so they can be explained / exported)
  ok(r8.mismatches.some((l) => l.kind === "blank_product" && l.barcode === "C" && l.cultivera === 2 && l.ours === null), "blank product line");
  ok(r7.mismatches.some((l) => l.kind === "no_barcode" && l.cultivera === 4 && l.ours === 3 && l.lotIds.join() === "L-null"), "no-barcode line with its lots");
  ok(!reconcile({ file: f7, lots: [lot(null, 4), lot("A", 1)], readsComplete: true }).mismatches.some((l) => l.kind === "no_barcode"), "balanced no-barcode = no line");
  const r4c = reconcile({ file: f1, lots: [lot("A", 3)], elsewhere: new Map([["B", []]]), readsComplete: true });
  ok(r4c.mismatches.find((l) => l.barcode === "B")?.elsewhere === undefined, "empty elsewhere list = not elsewhere");
  ok(KIND_ORDER.no_barcode > KIND_ORDER.extra_lot && KIND_ORDER.blank_product > KIND_ORDER.no_barcode, "new kinds sort last");

  // fix copy
  ok(mismatchFix(r4b.mismatches.find((l) => l.barcode === "B")!) === MISMATCH_FIX.missing_lot && MISMATCH_FIX.missing_lot.includes("Create the missing lots"), "missing fix copy");
  ok(mismatchFix(r4.mismatches.find((l) => l.barcode === "B")!).includes("existing lot"), "elsewhere fix copy");
  ok(Object.keys(MISMATCH_FIX).length === 6 && Object.keys(MISMATCH_COPY).length === 6, "every kind has copy + fix");

  // explanations
  const dl = r3.mismatches[0];
  const k = lineKey(dl);
  ok(k === "units_differ|A|3|4", "line key carries both numbers");
  ok(lineKey({ ...dl, ours: 5 }) !== k, "a changed number = a different key (note does not carry over)");
  const ev = (action: string, key: string, note: string | null, at: string, id: number): ExplainEvent => ({ action, key, note, by: "o@x", at, id });
  const ex1 = explanationsFromEvents([ev(RECONCILE_EXPLAIN_ACTION, k, " moved ", "2026-10-31T01:00:00Z", 1)]);
  ok(ex1.get(k)?.note === "moved", "explain event in force, trimmed");
  const ex2 = explanationsFromEvents([ev(RECONCILE_UNEXPLAIN_ACTION, k, null, "2026-10-31T02:00:00Z", 2), ev(RECONCILE_EXPLAIN_ACTION, k, "moved", "2026-10-31T01:00:00Z", 1)]);
  ok(!ex2.has(k), "a later unexplain removes it (order by time, not by input)");
  const ex3 = explanationsFromEvents([ev(RECONCILE_EXPLAIN_ACTION, k, "a", "2026-10-31T01:00:00Z", 1), ev(RECONCILE_EXPLAIN_ACTION, k, "b", "2026-10-31T01:00:00Z", 2)]);
  ok(ex3.get(k)?.note === "b", "same instant: higher id wins");
  ok(explanationsFromEvents([ev(RECONCILE_EXPLAIN_ACTION, k, "  ", "2026-10-31T01:00:00Z", 1)]).size === 0, "blank note ignored");
  ok(explanationsFromEvents([ev("other.action", k, "x", "2026-10-31T01:00:00Z", 1)]).size === 0, "other actions ignored");

  // parse
  ok(parseExplainInput({ key: k, note: "  checked   it " }).ok === true && (parseExplainInput({ key: k, note: "checked  it" }) as { note: string }).note === "checked it", "parse ok + whitespace collapsed");
  ok(!parseExplainInput({ key: k, note: "ab" }).ok, "note too short");
  ok(!parseExplainInput({ key: k, note: "x".repeat(RECONCILE_NOTE_MAX + 1) }).ok, "note too long");
  ok(!parseExplainInput({ key: "bogus|A|1|2", note: "fine" }).ok && !parseExplainInput({ key: 5, note: "fine" }).ok, "bad key refused");
  ok(parseExplainInput({ key: "missing_lot|B|2|0", note: "fine" }).ok && parseExplainInput({ key: "extra_lot|X||9", note: "fine" }).ok, "null side keys accepted");

  // verdicts
  ok(verdictFor(r1, new Map()).verdict === "go", "balanced = go");
  ok(verdictFor(r3, new Map()).verdict === "no_go" && verdictFor(r3, new Map()).open === 1, "unexplained = no-go");
  const allEx = new Map(r3.mismatches.map((l) => [lineKey(l), { key: lineKey(l), note: "ok", by: null, at: "t" }]));
  ok(verdictFor(r3, allEx).verdict === "go_explained" && verdictFor(r3, allEx).explained === 1, "all explained = go (explained)");
  ok(verdictFor(r2, new Map()).verdict === "no_go", "failed read = no-go");
  const r2b = reconcile({ file: f1, lots: [lot("A", 4), lot("B", 2)], readsComplete: false });
  ok(verdictFor(r2b, new Map(r2b.mismatches.map((l) => [lineKey(l), { key: lineKey(l), note: "ok", by: null, at: "t" }]))).verdict === "no_go", "notes cannot rescue a failed read");
  const half = new Map([[lineKey(r5.mismatches[0]), { key: "", note: "ok", by: null, at: "t" }]]);
  const r5b = reconcile({ file: f1, lots: [lot("A", 9), lot("X", 9)], readsComplete: true });
  ok(verdictFor(r5b, half).verdict === "no_go", "partly explained = no-go");
  ok(VERDICT_COPY.go_explained.includes("explained"), "verdict copy");

  // filters + paging
  ok(filterLines(mixed.mismatches, { kind: "extra_lot" }).length === 1, "filter by kind");
  ok(filterLines(r5.mismatches, { vendor: RECONCILE_NOT_IN_FILE }).length === 1, "filter by vendor");
  ok(filterLines(r10.mismatches, { q: "b24" }).length === 10, "search barcode substring, case-insensitive");
  ok(filterLines(r3.mismatches, { q: "p a" }).length === 1, "search product");
  ok(filterLines(r3.mismatches, { open: true }, allEx).length === 0 && filterLines(r3.mismatches, { open: true }, new Map()).length === 1, "open-only hides explained");
  ok(filterLines(r3.mismatches, { category: "Flower" }).length === 1 && filterLines(r3.mismatches, { category: "Edible" }).length === 0, "filter by category");
  const pg = pageOf(r10.mismatches, 2);
  ok(pg.page === 2 && pg.pages === 2 && pg.items.length === 50 && pg.items[0].barcode === "B200", "page 2");
  ok(pageOf(r10.mismatches, 99).page === 2 && pageOf(r10.mismatches, 0).page === 1 && pageOf([], 1).pages === 1, "page clamped");

  // lookup
  const lk = lookupBarcode(" A ", f1, [lot("A", 4, 1), lot("B", 2)], r3);
  ok(lk?.file?.units === 3 && lk.lots.length === 1 && lk.lots[0].received === 4 && lk.lots[0].onHand === 1 && lk.line?.kind === "units_differ", "lookup both sides");
  ok(lookupBarcode("", f1, [], r3) === null && lookupBarcode("ZZ", f1, [], r3)?.file === null, "lookup blank / unknown");

  // csv
  ok(reconcileCsvCell("=1+1") === "'=1+1" && reconcileCsvCell("-x") === "'-x" && reconcileCsvCell(-3) === "-3", "formula guard (strings only)");
  ok(reconcileCsvCell('a,"b"') === '"a,""b"""' && reconcileCsvCell(null) === "", "rfc4180");
  const csv = reconcileCsv(r3.mismatches, allEx);
  const csvLines = csv.trim().split("\r\n");
  ok(csvLines.length === 2 && csvLines[0].startsWith("Kind,Barcode") && csvLines[1].includes("Different units,A,P A,Acme,Flower,3,4,1") && csvLines[1].includes(",ok,L-A"), "csv row with diff, note, lots");
  ok(csv.endsWith("\r\n"), "csv crlf");


  // page helpers
  const kc = kindCounts(mixed.mismatches);
  ok(kc.map((c) => c.kind).join() === "not_whole,missing_lot,units_differ,extra_lot" && kc.every((c) => c.total === 1 && c.open === 1), "kind counts in page order");
  const kcEx = kindCounts(r3.mismatches, allEx);
  ok(kcEx.length === 1 && kcEx[0].open === 0 && kcEx[0].total === 1, "kind counts open excludes explained");
  ok(creatableMissing(r4.mismatches) === 0 && creatableMissing(r4b.mismatches) === 1, "elsewhere lines are not creatable");
  ok(reconcileHref("abc") === "/admin/menu-imports/reconcile?import=abc" && reconcileHref("") === "/admin/menu-imports/reconcile", "href base");
  ok(reconcileHref("abc", { kind: "extra_lot", vendor: "A & B", page: 2, q: "" }) === "/admin/menu-imports/reconcile?import=abc&kind=extra_lot&vendor=A+%26+B&page=2", "href encodes + drops empty");
  ok(parseKind("missing_lot") === "missing_lot" && parseKind("bogus") === "" && parseKind(undefined) === "", "parse kind");
  ok(RECONCILE_KINDS.length === 6, "six kinds");

  // missingBarcodes
  ok(missingBarcodes(f1, [lot("A", 3)]).join() === "B", "missing barcodes");
  ok(missingBarcodes(many, [], 10).length === 10, "missing barcodes capped");

  // empty everything: 0 = 0 and go only when reads complete
  ok(reconcile({ file: fileSide([]), lots: [], readsComplete: true }).go, "empty balances");
  ok(!reconcile({ file: fileSide([]), lots: [], readsComplete: false }).go, "empty but unread = no-go");

  return { passed, failed };
}
