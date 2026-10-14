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

export type MismatchKind = "units_differ" | "missing_lot" | "extra_lot" | "not_whole";

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
};

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
 * The comparison. `elsewhere` = barcodes (of the missing ones) that DO have a
 * lot on a delivery outside this import (the import skips a barcode that is
 * already a lot). Still red - the units are not on this import - but named.
 */
export function reconcile(input: {
  file: FileSide;
  lots: readonly ReconcileLot[];
  elsewhere?: ReadonlySet<string>;
  readsComplete: boolean;
}): ReconcileReport {
  const { file } = input;
  const ours = new Map<string, { units: number; lots: number }>();
  let oursNoBarcode = 0;
  let oursTotal = 0;
  let onHandNow = 0;
  const notWhole: MismatchLine[] = [];
  for (const l of input.lots) {
    const rec = wholeQty(l.received_qty);
    const oh = wholeQty(l.on_hand_qty);
    const code = ws(l.lot_code);
    if (rec == null) {
      const f = code ? file.byBarcode.get(code) : undefined;
      notWhole.push({ barcode: code || l.id, kind: "not_whole", product: f?.product ?? "", vendor: f?.vendor ?? RECONCILE_NOT_IN_FILE, category: f?.category ?? RECONCILE_NOT_IN_FILE, cultivera: f?.units ?? null, ours: null });
      continue;
    }
    oursTotal += rec;
    if (oh != null) onHandNow += oh;
    if (!code) {
      oursNoBarcode += rec;
      continue;
    }
    const cur = ours.get(code) ?? { units: 0, lots: 0 };
    cur.units += rec;
    cur.lots += 1;
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
    if (!o) lines.push({ barcode: f.barcode, kind: "missing_lot", product: f.product, vendor: f.vendor, category: f.category, cultivera: f.units, ours: 0, ...(input.elsewhere?.has(f.barcode) ? { elsewhere: true } : {}) });
    else if (o.units !== f.units) lines.push({ barcode: f.barcode, kind: "units_differ", product: f.product, vendor: f.vendor, category: f.category, cultivera: f.units, ours: o.units });
  }
  for (const [code, o] of ours) {
    if (file.byBarcode.has(code)) continue;
    add(vendors, RECONCILE_NOT_IN_FILE, 0, o.units);
    add(cats, RECONCILE_NOT_IN_FILE, 0, o.units);
    lines.push({ barcode: code, kind: "extra_lot", product: "", vendor: RECONCILE_NOT_IN_FILE, category: RECONCILE_NOT_IN_FILE, cultivera: null, ours: o.units });
  }
  for (const b of file.blankProduct) fileTotal += b.units;
  if (file.noBarcodeUnits > 0 || oursNoBarcode > 0) {
    add(vendors, "(no barcode)", file.noBarcodeUnits, oursNoBarcode);
    add(cats, "(no barcode)", file.noBarcodeUnits, oursNoBarcode);
  }
  const blankUnits = file.blankProduct.reduce((s, b) => s + b.units, 0);
  if (blankUnits > 0) {
    add(vendors, "(no product name)", blankUnits, 0);
    add(cats, "(no product name)", blankUnits, 0);
  }

  const kindOrder: Record<MismatchKind, number> = { not_whole: 0, missing_lot: 1, units_differ: 2, extra_lot: 3 };
  lines.sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || (a.barcode < b.barcode ? -1 : a.barcode > b.barcode ? 1 : 0));

  const missing = lines.filter((l) => l.kind === "missing_lot").length;
  const extra = lines.filter((l) => l.kind === "extra_lot").length;
  const differ = lines.filter((l) => l.kind === "units_differ").length;
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
    mismatches: lines.slice(0, RECONCILE_LINE_CAP),
    mismatchCount: lines.length,
    info: { zeroUnitRows: file.zeroUnitRows, sharedBarcodeLots, noBarcodeRows: file.noBarcodeRows, fileRows: file.rows },
  };
}

/** Barcodes worth asking "is it a lot somewhere else?" (the missing ones, capped). */
export function missingBarcodes(file: FileSide, lots: readonly ReconcileLot[], cap = 2000): string[] {
  const have = new Set(lots.map((l) => ws(l.lot_code)).filter(Boolean));
  return [...file.byBarcode.keys()].filter((b) => !have.has(b)).sort().slice(0, cap);
}

export const MISMATCH_COPY: Record<MismatchKind, string> = {
  units_differ: "Different units",
  missing_lot: "In Cultivera, no lot here",
  extra_lot: "Lot here, not in Cultivera",
  not_whole: "Quantity is not a whole number",
};

export function mismatchNote(l: MismatchLine): string {
  if (l.kind === "missing_lot" && l.elsewhere) return "A lot with this barcode already existed on an earlier delivery, so the import did not add it again.";
  return MISMATCH_COPY[l.kind];
}

export function reconcileHeadline(r: Pick<ReconcileReport, "go" | "totals" | "mismatchCount">): string {
  if (r.go) return `GO: the units balance. Cultivera ${r.totals.cultivera.toLocaleString("en-US")} = ours ${r.totals.ours.toLocaleString("en-US")}, barcode by barcode.`;
  return `NO-GO: the units do not balance (${r.mismatchCount} line(s) to look at). Do not open on this import until each one is explained.`;
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
  const r4 = reconcile({ file: f1, lots: [lot("A", 3)], elsewhere: new Set(["B"]), readsComplete: true });
  ok(!r4.go && r4.mismatches.some((l) => l.kind === "missing_lot" && l.barcode === "B" && l.elsewhere === true), "missing lot, elsewhere named");
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

  // sort + cap
  const many = fileSide(Array.from({ length: 250 }, (_, i) => row(`B${String(i).padStart(3, "0")}`, 1)));
  const r10 = reconcile({ file: many, lots: [], readsComplete: true });
  ok(r10.mismatches.length === RECONCILE_LINE_CAP && r10.mismatchCount === 250, "lines capped, count kept");
  ok(r10.mismatches[0].barcode === "B000" && r10.mismatches[1].barcode === "B001", "lines sorted by barcode");
  const mixed = reconcile({ file: f1, lots: [lot("A", 4), lot("X", 1), lot("Q", "1.5")], readsComplete: true });
  ok(mixed.mismatches.map((l) => l.kind).join(",") === "not_whole,missing_lot,units_differ,extra_lot", "kind order");

  // missingBarcodes
  ok(missingBarcodes(f1, [lot("A", 3)]).join() === "B", "missing barcodes");
  ok(missingBarcodes(many, [], 10).length === 10, "missing barcodes capped");

  // empty everything: 0 = 0 and go only when reads complete
  ok(reconcile({ file: fileSide([]), lots: [], readsComplete: true }).go, "empty balances");
  ok(!reconcile({ file: fileSide([]), lots: [], readsComplete: false }).go, "empty but unread = no-go");

  return { passed, failed };
}
