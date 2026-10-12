/**
 * R50 S9 — turn ONE crawler Phase A run (crawler/app/cultivera_pos.py) into the two
 * workbooks the existing import (`runImport` → `transformWorkbooks`) already takes,
 * applying every safeguard proven in tests/compliance/r50-cultivera-fetch-pipeline.test.ts:
 *
 *   1. rewriteDateCells     — the live export stores Received date as a DATE cell; the
 *                             transform reads formatted text, so time of day would be lost.
 *   2. supplementListOnly   — the export drops lots the list API has (rehearsal #1: 23);
 *                             the LIST is the inventory of record (bible §3b.2). Their
 *                             received time comes from the batch (UTC Z → Pacific wall).
 *   3. filterProductsToInventory — the product export has ~17k catalogue rows; only names
 *                             that are in inventory become product masters (no stockless cards).
 *   4. checkCompleteness + goNoGo — numbers, not vibes (§3b.6).
 *
 * The output is just two xlsx buffers + a report; nothing here writes to the database,
 * so a NO-GO never touches the menu. The caller decides (refuse on no-go, or stage as test).
 */
import * as XLSX from "xlsx";
import {
  supplementListOnly,
  rewriteDateCells,
  filterProductsToInventory,
  checkCompleteness,
  goNoGo,
  reconcileControlTotals,
  INVENTORY_EXPORT_COLUMNS,
  PRODUCT_EXPORT_COLUMNS,
  type ListLot,
  type SheetRow,
  type GoNoGoCheck,
  type SupplementedLot,
  type ReconcileReport,
} from "@/lib/pos/cultivera-fetch-core";
import { transformWorkbooks } from "@/lib/pos/transform";

export const ASSEMBLED_INVENTORY_SHEET = "Inventories";
export const ASSEMBLED_PRODUCT_SHEET = "Sheet1";

export type BatchRecord = { Id: number; ReceivedDate?: string | null; [k: string]: unknown };

export type AssembleInput = {
  inventoryExport: Buffer;
  productExport: Buffer;
  /** inventories.json `data` — the list API lots. */
  listLots: ListLot[];
  /** batches.jsonl records (only list-only lots' batches are fetched). */
  batches: BatchRecord[];
  /** Phase A seconds (state.json) — for the time-budget check. */
  harvestSeconds: number;
  budgetSeconds?: number;
};

export type AssembleReport = {
  go: boolean;
  checks: GoNoGoCheck[];
  counts: {
    exportRows: number;
    listLots: number;
    supplemented: number;
    exportOnly: number;
    dateCellsRewritten: number;
    productRowsIn: number;
    productRowsKept: number;
    items: number;
    visibleItems: number;
    hiddenItems: number;
    variants: number;
    transformErrors: number;
    transformWarnings: number;
    hiddenForMissingMaster: number;
  };
  supplemented: SupplementedLot[];
  /** Supplemented lots whose name matched 0 or 2+ product rows (a human should glance). */
  ambiguousProductMatches: SupplementedLot[];
  inventoryNamesWithoutProduct: string[];
  missingBarcodes: string[];
  hiddenReasons: Record<string, number>;
  reconcile: ReconcileReport;
};

export type AssembleResult = {
  productsBuffer: Buffer;
  inventoriesBuffer: Buffer;
  report: AssembleReport;
};

/** First sheet as raw cells (numbers stay numbers so date serials can be rewritten). */
export function readFirstSheet(buf: Buffer): { rows: SheetRow[]; columns: string[] } {
  const wb = XLSX.read(buf, { cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error("workbook has no sheet");
  const header = (XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, range: 0, blankrows: false })[0] ?? []).map((h) => String(h ?? "").trim());
  const rows = XLSX.utils.sheet_to_json<SheetRow>(ws, { defval: "", raw: true });
  return { rows, columns: header.filter(Boolean) };
}

export function writeSheet(rows: SheetRow[], columns: readonly string[], sheet: string): Buffer {
  const ws = XLSX.utils.json_to_sheet(rows.map((r) => {
    const o: SheetRow = {};
    for (const c of columns) o[c] = r[c] ?? "";
    return o;
  }), { header: [...columns] });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheet);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/** Batch ReceivedDate by lot Id (lot.BatchId → batch.Id). Keyed by lot, not barcode:
 *  live data has barcodes shared by several lots with different batches. */
export function receivedUtcByLotId(lots: ListLot[], batches: BatchRecord[]): Record<number, string | null> {
  const byId = new Map(batches.map((b) => [Number(b.Id), b]));
  const out: Record<number, string | null> = {};
  for (const l of lots) {
    const bid = Number((l as ListLot & { BatchId?: number | null }).BatchId);
    const b = Number.isFinite(bid) ? byId.get(bid) : undefined;
    if (b) out[l.Id] = (b.ReceivedDate as string | null | undefined) ?? null;
  }
  return out;
}

export function assembleFromRun(input: AssembleInput): AssembleResult {
  const inv = readFirstSheet(input.inventoryExport);
  const prod = readFirstSheet(input.productExport);

  const dates = rewriteDateCells(inv.rows);
  const supp = supplementListOnly({
    exportRows: dates.rows,
    listLots: input.listLots,
    productRows: prod.rows,
    receivedUtcById: receivedUtcByLotId(input.listLots, input.batches),
  });
  const filtered = filterProductsToInventory(prod.rows, supp.rows);
  const productColumns = [...PRODUCT_EXPORT_COLUMNS, "Description"];

  const inventoriesBuffer = writeSheet(supp.rows, INVENTORY_EXPORT_COLUMNS, ASSEMBLED_INVENTORY_SHEET);
  const productsBuffer = writeSheet(filtered.rows, productColumns, ASSEMBLED_PRODUCT_SHEET);

  // Dry-run the REAL transform on exactly the bytes we will hand to runImport.
  const t = transformWorkbooks({
    productsBuffer,
    inventoriesBuffer,
    productsSheet: ASSEMBLED_PRODUCT_SHEET,
    inventoriesSheet: ASSEMBLED_INVENTORY_SHEET,
  });
  const hidden = t.diagnostics.filter((d) => d.code === "inventory_without_product_master").length;
  const completeness = checkCompleteness(input.listLots, supp.rows, supp.supplemented.length, supp.exportOnly.length);
  const reconcile = reconcileControlTotals(input.listLots, supp.rows);
  const gate = goNoGo({
    reconcile,
    loginOk: true,
    inventoryColumns: inv.columns,
    productColumns: prod.columns,
    completeness,
    transformErrors: t.diagnosticCounts.errors,
    hiddenForMissingMaster: hidden,
    inventoryNamesWithoutProduct: filtered.inventoryNamesWithoutProduct.length,
    elapsedMs: Math.round(input.harvestSeconds * 1000),
    budgetMs: Math.round((input.budgetSeconds ?? 1800) * 1000),
  });

  return {
    productsBuffer,
    inventoriesBuffer,
    report: {
      go: gate.go,
      checks: gate.checks,
      counts: {
        exportRows: inv.rows.length,
        listLots: input.listLots.length,
        supplemented: supp.supplemented.length,
        exportOnly: supp.exportOnly.length,
        dateCellsRewritten: dates.rewritten,
        productRowsIn: prod.rows.length,
        productRowsKept: filtered.kept,
        items: t.summary.output.menuItems,
        visibleItems: t.summary.output.menuItems - t.summary.output.hiddenItems,
        hiddenItems: t.summary.output.hiddenItems,
        variants: t.summary.output.variants,
        transformErrors: t.diagnosticCounts.errors,
        transformWarnings: t.diagnosticCounts.warnings,
        hiddenForMissingMaster: hidden,
      },
      supplemented: supp.supplemented,
      ambiguousProductMatches: supp.supplemented.filter((s) => s.productMatches !== 1),
      inventoryNamesWithoutProduct: filtered.inventoryNamesWithoutProduct,
      missingBarcodes: completeness.missingBarcodes,
      hiddenReasons: t.summary.output.hiddenReasons,
      reconcile,
    },
  };
}
