/**
 * src/lib/compliance/ccrs-held-back-core.ts - R74 S39 (owner, Round 19).
 *
 * "we can not be blocked from reporting to the state. we can hold off on
 * reporting until we know for sure, but we cant block good records from being
 * uploaded ... keep track of what we still need to report so that I can fix
 * them and then reupload them."
 *
 * PURE (no I/O). Three jobs:
 *   1. Event rows (Sale / InventoryAdjustment) whose lot cannot be reported
 *      in this emission are LEFT OUT and tracked, instead of blocking the
 *      whole batch with L_REF_INVENTORY. CCRS rejects only that row
 *      ("Invalid InventoryExternalIdentifier" [G L1302-L1304]); it accepts
 *      the rest row by row (U-17 CLOSED FALSE).
 *   2. The held-back gate issues (ccrs-submit-gate-core HELD_BACK_CODES) are
 *      flattened into one record list: what is still owed to CCRS.
 *   3. That list is what ccrs_held_sync (0297) stores per week, so the hub
 *      shows every owed record across weeks until it is reported.
 *
 * Master data (Strain/Area/Product/Inventory) and InventoryTransfer are
 * re-planned IN FULL by every batch (every live lot, every visible product,
 * the transfer catch-up), so a held one goes out with the next upload after
 * it is fixed. Sale and Adjustment rows belong to their week: once fixed,
 * rebuild THAT week and upload its files (a sale line CCRS already holds is
 * never Inserted again: routeSaleInserts / E49).
 */
import { CCRS_COLUMNS, ccrsReaderSplit, type CcrsRetailerFileType } from "./ccrs-batch-core";
import type { LedgerView } from "./ccrs-ledger-core";

/** Ledger states in which CCRS holds a lot an event row may name (Part 03 L189). */
const PRESENT = new Set(["seed", "filed", "confirmed"]);

/** Data rows of an assembled CCRS csv (after the 3 header rows + column row). */
export function csvDataRows(csv: string): string[][] {
  const body = csv.endsWith("\r\n") ? csv.slice(0, -2) : csv;
  return body
    .split("\r\n")
    .slice(4)
    .filter((l) => l !== "")
    .map(ccrsReaderSplit);
}

/**
 * Lots an event row of this emission may name: every lot this Inventory.csv
 * reports, plus every lot CCRS holds (seed / filed / confirmed). A `closed`
 * lot counts only when this Inventory.csv re-reports it (R5-1), which the
 * first set already covers. Without a ledger (legacy) nothing can be proven
 * held, so only reported lots count.
 */
export function sendableLotIds(inventoryRows: readonly (readonly string[])[], view: LedgerView | null): Set<string> {
  const ext = CCRS_COLUMNS.Inventory.indexOf("ExternalIdentifier");
  const out = new Set<string>();
  for (const r of inventoryRows) if (r[ext]) out.add(r[ext]);
  if (view) {
    for (const e of view.entries.values()) {
      if (e.fileType === "Inventory" && PRESENT.has(e.state)) out.add(e.externalId);
    }
  }
  return out;
}

export type HeldEventRow = { id: string; label: string; detail: string };

/**
 * Split event rows into those that can be sent and those held back because
 * their lot is not sendable. `heldWhy` (lot CCRS id -> the plan's withhold
 * reason) says why the lot itself is held, when known.
 */
export function dropEventRowsForHeldLots(
  type: "Sale" | "InventoryAdjustment",
  rows: readonly string[][],
  sendable: ReadonlySet<string>,
  heldWhy: ReadonlyMap<string, string> = new Map(),
): { type: "Sale" | "InventoryAdjustment"; rows: string[][]; dropped: HeldEventRow[] } {
  const C = CCRS_COLUMNS[type];
  const lotCol = C.indexOf("InventoryExternalIdentifier");
  const idCol = C.indexOf(type === "Sale" ? "SaleDetailExternalIdentifier" : "ExternalIdentifier");
  const kept: string[][] = [];
  const dropped: HeldEventRow[] = [];
  rows.forEach((r, i) => {
    const lot = r[lotCol] ?? "";
    if (lot !== "" && sendable.has(lot)) {
      kept.push(r);
      return;
    }
    const id = r[idCol] || `${type} row ${i + 1}`;
    const why = lot === "" ? "the row names no lot" : heldWhy.get(lot) ? `lot ${lot} is held back: ${heldWhy.get(lot)}` : `lot ${lot} is not in this Inventory.csv and CCRS does not hold it`;
    dropped.push({ id, label: id, detail: why });
  });
  return { type, rows: kept, dropped };
}

export function heldEventRowsMessage(type: "Sale" | "InventoryAdjustment", n: number): string {
  const what = type === "Sale" ? "sale line(s)" : "adjustment(s)";
  return `${n} ${what} were held back from ${type}.csv because their lot is held back too (not in this Inventory.csv and not on the CCRS record). CCRS would reject only these rows ("Invalid InventoryExternalIdentifier" [G L1302-L1304]), so every other row still goes out. They are tracked as owed: fix the lot (see the Inventory items), then rebuild THIS week and upload it again. Lines CCRS already holds are not sent twice.`;
}

/* ------------------------------------------------------------------ *
 * The owed-records list (what ccrs_held_sync stores)
 * ------------------------------------------------------------------ */

/** Types re-planned in full by every batch (a fixed record goes out with any later upload). */
export const HELD_MASTER_TYPES: ReadonlySet<string> = new Set(["Strain", "Area", "Product", "Inventory", "InventoryTransfer"]);

export type HeldRecord = { t: string; id: string; label: string; code: string; reason: string };

type HeldIssueLike = { file: string; code?: string; rows?: readonly { id: string; label: string; detail?: string }[] };

/** Flatten held-back issues into one record per (file type, id). First reason wins. */
export function heldRecordsOf(issues: readonly HeldIssueLike[]): HeldRecord[] {
  const seen = new Set<string>();
  const out: HeldRecord[] = [];
  for (const i of issues) {
    if (i.file === "General" || !i.code) continue;
    for (const r of i.rows ?? []) {
      const id = (r.id ?? "").trim().slice(0, 300);
      if (!id) continue;
      const k = `${i.file}\u0000${id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ t: i.file, id, label: (r.label || id).slice(0, 300), code: i.code, reason: (r.detail ?? "").slice(0, 1000) });
    }
  }
  return out;
}

export type OwedRow = { week_start: string; record_type: string; record_id: string; label: string | null; code: string; reason: string | null; first_held_at: string };

export type OwedWeek = {
  weekStart: string;
  total: number;
  byType: { type: string; count: number; rebuildWeek: boolean }[];
  rows: OwedRow[];
};

/** Group open owed records by week (newest first), then by file type. */
export function owedByWeek(rows: readonly OwedRow[]): OwedWeek[] {
  const weeks = new Map<string, OwedRow[]>();
  for (const r of rows) weeks.set(r.week_start, [...(weeks.get(r.week_start) ?? []), r]);
  return [...weeks.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([weekStart, list]) => {
      const counts = new Map<string, number>();
      for (const r of list) counts.set(r.record_type, (counts.get(r.record_type) ?? 0) + 1);
      return {
        weekStart,
        total: list.length,
        byType: [...counts.entries()]
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([type, count]) => ({ type, count, rebuildWeek: !HELD_MASTER_TYPES.has(type) })),
        rows: list,
      };
    });
}

/** One line for the banner. */
export function owedSentence(weeks: readonly OwedWeek[]): string {
  const total = weeks.reduce((a, w) => a + w.total, 0);
  if (total === 0) return "Nothing is owed to CCRS: every record from earlier uploads has been reported.";
  const rebuild = weeks.filter((w) => w.byType.some((t) => t.rebuildWeek)).length;
  return `${total} record(s) from ${weeks.length} week(s) are still owed to CCRS.${rebuild > 0 ? ` ${rebuild} week(s) hold sale or adjustment rows: after fixing, rebuild that week and upload it again.` : ""} Products and lots go out with the next upload once fixed.`;
}

/* ------------------------------------------------------------------ *
 * Self-tests
 * ------------------------------------------------------------------ */

export function __runCcrsHeldBackTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error("FAIL ccrs-held-back-core: " + m);
    }
  };
  const S = CCRS_COLUMNS.Sale;
  const sale = (detail: string, lot: string) => S.map((c) => (c === "SaleDetailExternalIdentifier" ? detail : c === "InventoryExternalIdentifier" ? lot : "x"));
  const inv = (ext: string) => CCRS_COLUMNS.Inventory.map((c) => (c === "ExternalIdentifier" ? ext : "y"));
  const view = {
    env: "prod",
    entries: new Map([
      ["Inventory\u0000L-ON", { fileType: "Inventory", externalId: "L-ON", filedName: null, state: "seed" }],
      ["Inventory\u0000L-CLOSED", { fileType: "Inventory", externalId: "L-CLOSED", filedName: null, state: "closed" }],
    ]),
  } as unknown as LedgerView;

  const sendable = sendableLotIds([inv("L-NEW")], view);
  ok(sendable.has("L-NEW") && sendable.has("L-ON") && !sendable.has("L-CLOSED"), "reported + held lots are sendable; closed only when re-reported");
  ok(sendableLotIds([inv("A")], null).size === 1, "legacy: only reported lots");

  const d = dropEventRowsForHeldLots("Sale", [sale("D1", "L-NEW"), sale("D2", "L-HELD"), sale("D3", "L-ON"), sale("D4", "")], sendable, new Map([["L-HELD", "Cultivera lot not on record"]]));
  ok(d.rows.length === 2 && d.dropped.length === 2, "good rows kept, held rows dropped");
  ok(d.dropped[0].id === "D2" && d.dropped[0].detail.includes("Cultivera lot not on record"), "dropped row says why its lot is held");
  ok(d.dropped[1].detail === "the row names no lot", "blank lot is held, never sent");

  const csv = ["SubmittedBy,x", "SubmittedDate,x", "NumberRecords,1", S.join(","), sale("D9", "L").join(",")].join("\r\n") + "\r\n";
  ok(csvDataRows(csv).length === 1 && csvDataRows(csv)[0][S.indexOf("SaleDetailExternalIdentifier")] === "D9", "csvDataRows reads data rows only");

  const recs = heldRecordsOf([
    { file: "Inventory", code: "E52_CULTIVERA_LOT_NOT_ON_RECORD", rows: [{ id: "lot1", label: "LOT 1", detail: "held" }, { id: "lot1", label: "dup" }] },
    { file: "Sale", code: "E56_EVENT_ROW_LOT_HELD", rows: [{ id: "D2", label: "D2", detail: "why" }] },
    { file: "General", code: "X", rows: [{ id: "g", label: "g" }] },
  ]);
  ok(recs.length === 2 && recs[0].t === "Inventory" && recs[1].code === "E56_EVENT_ROW_LOT_HELD", "records flattened, deduped, General skipped");

  const weeks = owedByWeek([
    { week_start: "2026-10-11", record_type: "Inventory", record_id: "a", label: null, code: "E52", reason: null, first_held_at: "" },
    { week_start: "2026-10-18", record_type: "Sale", record_id: "b", label: null, code: "E56", reason: null, first_held_at: "" },
    { week_start: "2026-10-18", record_type: "Inventory", record_id: "c", label: null, code: "E52", reason: null, first_held_at: "" },
  ]);
  ok(weeks[0].weekStart === "2026-10-18" && weeks[0].total === 2, "newest week first");
  ok(weeks[0].byType.find((t) => t.type === "Sale")?.rebuildWeek === true && weeks[0].byType.find((t) => t.type === "Inventory")?.rebuildWeek === false, "only event rows need their week rebuilt");
  ok(owedSentence(weeks).startsWith("3 record(s) from 2 week(s)") && owedSentence([]).startsWith("Nothing is owed"), "owed sentence");

  return { passed, failed };
}
