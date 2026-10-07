/**
 * src/lib/compliance/ccrs-control-totals-core.ts — S-12b (CCRS Bible v2 Part 05 §G, LAW 5)
 *
 * PURE. Control totals per file: "stored at emitted, recomputed at verify,
 * compared at reconciliation" — derived from the entries and re-derived from
 * the file, never typed (NACHA discipline [SRC S5]).
 *
 * | Total            | Inventory          | Product | Strain  | Area | Sale                     | InventoryAdjustment |
 * |------------------|--------------------|---------|---------|------|--------------------------|---------------------|
 * | number_records   | ✓                  | ✓       | ✓       | ✓    | ✓                        | ✓                   |
 * | distinct_ids     | ✓                  | ✓       | ✓ names | ✓    | ✓ SaleDetail ids         | ✓                   |
 * | sum_qoh          | Σ QuantityOnHand   | —       | —       | —    | Σ Quantity               | Σ Quantity          |
 * | sum_total_cost   | Σ TotalCost        | —       | —       | —    | (Σ UnitPrice×Qty, Σ excise → extra) | —        |
 * | op counts        | #Insert/#Update/#Delete (every type with an Operation column)                          |
 *
 * Money and quantities are summed as EXACT decimals (BigInt at the widest
 * scale seen), never floats: a one-cent change must change the total.
 * InventoryTransfer is not in the §G table; it gets the generic totals
 * (records, ids, op counts) plus Σ Quantity, which is the same column shape.
 */
import { CCRS_COLUMNS, ccrsReaderSplit, type CcrsRetailerFileType } from "./ccrs-batch-core";

export class CcrsTotalsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CcrsTotalsError";
  }
}

/* ---------------------------- exact decimals ---------------------------- */
const DEC_RE = /^-?\d+(\.\d+)?$/;
type Dec = { n: bigint; scale: number };

export function parseDecimal(s: string, what: string): Dec {
  const t = (s ?? "").trim();
  if (!DEC_RE.test(t)) throw new CcrsTotalsError(`${what}: "${s}" is not a plain decimal number`);
  const neg = t.startsWith("-");
  const [i, f = ""] = (neg ? t.slice(1) : t).split(".");
  const n = BigInt(i + f) * (neg ? BigInt(-1) : BigInt(1));
  return { n, scale: f.length };
}
const rescale = (d: Dec, s: number): bigint => d.n * BigInt(10) ** BigInt(s - d.scale);
function addDec(a: Dec, b: Dec): Dec {
  const s = Math.max(a.scale, b.scale);
  return { n: rescale(a, s) + rescale(b, s), scale: s };
}
function mulDec(a: Dec, b: Dec): Dec {
  return { n: a.n * b.n, scale: a.scale + b.scale };
}
/** Canonical text: no trailing zeros after the point, "-0" never produced. */
export function formatDecimal(d: Dec): string {
  const neg = d.n < BigInt(0);
  let digits = (neg ? -d.n : d.n).toString();
  if (d.scale > 0) {
    digits = digits.padStart(d.scale + 1, "0");
    const i = digits.slice(0, digits.length - d.scale);
    const f = digits.slice(digits.length - d.scale).replace(/0+$/, "");
    digits = f ? `${i}.${f}` : i;
  }
  return neg && digits !== "0" ? `-${digits}` : digits;
}
export function sumDecimals(values: readonly string[], what: string): string {
  let acc: Dec = { n: BigInt(0), scale: 0 };
  values.forEach((v, i) => { acc = addDec(acc, parseDecimal(v, `${what} row ${i + 1}`)); });
  return formatDecimal(acc);
}

/* ------------------------------ the totals ------------------------------ */
export type CcrsControlTotals = {
  type: CcrsRetailerFileType;
  numberRecords: number;
  distinctIds: number;
  /** Σ QuantityOnHand (Inventory) or Σ Quantity (Sale, Adjustment, Transfer); null where §G has "—". */
  sumQoh: string | null;
  /** Σ TotalCost (Inventory only); null elsewhere. */
  sumTotalCost: string | null;
  ops: { Insert: number; Update: number; Delete: number } | null;
  /** Sale only: Σ UnitPrice×Quantity and Σ CannabisExciseTax (§G "Σ UnitPrice×Qty, Σ excise"). */
  saleGross: string | null;
  saleExcise: string | null;
};

/** The column whose value identifies a record of each type (Part 05 §G "distinct_ids"). */
export const CCRS_ID_COLUMN: Record<CcrsRetailerFileType, string> = {
  Strain: "Strain",
  Area: "ExternalIdentifier",
  Product: "ExternalIdentifier",
  Inventory: "ExternalIdentifier",
  InventoryAdjustment: "ExternalIdentifier",
  InventoryTransfer: "ExternalIdentifier",
  Sale: "SaleDetailExternalIdentifier",
};

const QTY_COLUMN: Partial<Record<CcrsRetailerFileType, string>> = {
  Inventory: "QuantityOnHand",
  Sale: "Quantity",
  InventoryAdjustment: "Quantity",
  InventoryTransfer: "Quantity",
};

/** Compute the totals from data rows (cells in template column order). */
export function computeControlTotals(type: CcrsRetailerFileType, rows: readonly (readonly string[])[]): CcrsControlTotals {
  const C = CCRS_COLUMNS[type];
  const col = (name: string) => {
    const i = C.indexOf(name);
    if (i < 0) throw new CcrsTotalsError(`${type} has no ${name} column`);
    return i;
  };
  rows.forEach((r, i) => {
    if (r.length !== C.length) throw new CcrsTotalsError(`${type} row ${i + 1} has ${r.length} cells; the template has ${C.length}`);
  });
  const idI = col(CCRS_ID_COLUMN[type]);
  const opI = C.indexOf("Operation");
  let ops: CcrsControlTotals["ops"] = null;
  if (opI >= 0) {
    ops = { Insert: 0, Update: 0, Delete: 0 };
    rows.forEach((r, i) => {
      const op = r[opI];
      if (op !== "Insert" && op !== "Update" && op !== "Delete") throw new CcrsTotalsError(`${type} row ${i + 1}: Operation "${op}" is not Insert, Update or Delete`);
      ops![op] += 1;
    });
  }
  const q = QTY_COLUMN[type];
  const sumQoh = q ? sumDecimals(rows.map((r) => r[col(q)]), `${type}.${q}`) : null;
  const sumTotalCost = type === "Inventory" ? sumDecimals(rows.map((r) => r[col("TotalCost")]), "Inventory.TotalCost") : null;
  let saleGross: string | null = null;
  let saleExcise: string | null = null;
  if (type === "Sale") {
    const pi = col("UnitPrice"), qi = col("Quantity"), ei = col("CannabisExciseTax");
    let g: Dec = { n: BigInt(0), scale: 0 };
    rows.forEach((r, i) => { g = addDec(g, mulDec(parseDecimal(r[pi], `Sale.UnitPrice row ${i + 1}`), parseDecimal(r[qi], `Sale.Quantity row ${i + 1}`))); });
    saleGross = formatDecimal(g);
    saleExcise = sumDecimals(rows.map((r) => r[ei]), "Sale.CannabisExciseTax");
  }
  return {
    type,
    numberRecords: rows.length,
    distinctIds: new Set(rows.map((r) => r[idI])).size,
    sumQoh,
    sumTotalCost,
    ops,
    saleGross,
    saleExcise,
  };
}

/**
 * Re-derive the totals from the ASSEMBLED bytes, splitting each data line the
 * way CCRS's reader does (every comma). Header shape is the verifier's job;
 * this only needs the 4 header lines to be present.
 */
export function controlTotalsFromCsv(type: CcrsRetailerFileType, csv: string): CcrsControlTotals {
  const lines = csv.replace(/\r\n$/, "").split("\r\n");
  if (lines.length < 4) throw new CcrsTotalsError(`${type}: fewer than 4 header lines`);
  return computeControlTotals(type, lines.slice(4).map(ccrsReaderSplit));
}

export type TotalsMismatch = { field: keyof CcrsControlTotals | `ops.${"Insert" | "Update" | "Delete"}`; stored: string; recomputed: string };

/** Field-by-field comparison; empty = identical. */
export function compareControlTotals(stored: CcrsControlTotals, recomputed: CcrsControlTotals): TotalsMismatch[] {
  const out: TotalsMismatch[] = [];
  const keys = ["type", "numberRecords", "distinctIds", "sumQoh", "sumTotalCost", "saleGross", "saleExcise"] as const;
  for (const k of keys) {
    if (String(stored[k]) !== String(recomputed[k])) out.push({ field: k, stored: String(stored[k]), recomputed: String(recomputed[k]) });
  }
  for (const op of ["Insert", "Update", "Delete"] as const) {
    const a = stored.ops?.[op] ?? null, b = recomputed.ops?.[op] ?? null;
    if (a !== b) out.push({ field: `ops.${op}`, stored: String(a), recomputed: String(b) });
  }
  return out;
}

export function __runCcrsControlTotalsCoreTests(): void {
  const assert = (c: unknown, m: string) => { if (!c) throw new Error("ccrs-control-totals-core: " + m); };
  assert(sumDecimals(["0.1", "0.2"], "x") === "0.3", "exact 0.1+0.2");
  assert(sumDecimals(["10.00", "0.01", "-0.01"], "x") === "10", "trailing zeros trimmed");
  assert(sumDecimals([], "x") === "0", "empty sum");
  assert(formatDecimal(parseDecimal("-0.50", "x")) === "-0.5" && formatDecimal(parseDecimal("-0", "x")) === "0", "sign");
  let threw = false; try { parseDecimal("1e3", "x"); } catch (e) { threw = e instanceof CcrsTotalsError; }
  assert(threw, "exponent refused");
  const inv = (id: string, qoh: string, cost: string, op: string) => ["413541", "S", "Sales Floor", "P", "10", qoh, cost, "FALSE", id, "G", "10/07/2026", "", "", op];
  const t = computeControlTotals("Inventory", [inv("A", "3", "12.50", "Update"), inv("B", "0", "0.01", "Insert")]);
  assert(t.numberRecords === 2 && t.distinctIds === 2 && t.sumQoh === "3" && t.sumTotalCost === "12.51", "inventory totals");
  assert(t.ops!.Update === 1 && t.ops!.Insert === 1 && t.ops!.Delete === 0, "op counts");
  const t2 = computeControlTotals("Inventory", [inv("A", "3", "12.51", "Update"), inv("B", "0", "0.01", "Insert")]);
  assert(compareControlTotals(t, t2).map((m) => m.field).join() === "sumTotalCost", "one cent changes sum_total_cost only");
  const st = computeControlTotals("Strain", [["413541", "Zkittlez", "Hybrid", "G", "10/07/2026"]]);
  assert(st.ops === null && st.sumQoh === null && st.sumTotalCost === null && st.distinctIds === 1, "strain totals");
  console.log("ccrs-control-totals-core: all tests passed");
}
