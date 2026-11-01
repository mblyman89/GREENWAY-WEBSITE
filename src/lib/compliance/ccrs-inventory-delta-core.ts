/**
 * R6-3: send only what changed in Inventory.csv (closes N-03's re-send half).
 * PURE: rows + the 0286 answer in, rows + a report out. No I/O, no clock.
 *
 * The rule, verbatim: "Inventory.CSV is required weekly by any licensed
 * facility that owns the inventory, only when inventory exists that is
 * unreported, or unreported updates to an existing inventory. No report is
 * needed if there are no changes." [G L0525-L0527]. And: "if there is nothing
 * new to report, there is no report to submit" [FAQ L0049].
 *
 * Before R6-3 every live lot CCRS holds went out as an Update every week,
 * changed or not. Now an Update row is LEFT OUT only when ALL of these hold:
 *   1. the 0286 answer is loaded (migration applied);
 *   2. CCRS ACCEPTED an earlier row for the lot (`told` is the payload of that
 *      row; null when the last row's answer is missing or left it uncertain);
 *   3. no file naming the lot is still waiting for an answer (in_flight);
 *   4. no event row of THIS batch (Sale / InventoryAdjustment /
 *      InventoryTransfer) names the lot. A `closed` lot must be re-reported
 *      in the same emission (R5-1, [G L1302-L1304]); sending every named lot
 *      keeps that rule without a second state check;
 *   5. every data cell equals what CCRS last accepted (numbers compared as
 *      numbers, IsMedical case-insensitively, text exactly).
 * Insert rows are never touched: a lot CCRS does not hold is "unreported".
 * Anything unsure is SENT: re-sending an unchanged Update is harmless (the
 * pre-R6-3 behaviour); leaving out a changed lot is an under-report.
 *
 * Every Update that IS sent now carries UpdatedBy and UpdatedDate: "UpdatedBy
 * ... the user who subsequently updated a file", "UpdatedDate ... the date
 * that the file was modified", and "Updated Date cannot be prior to Created
 * Date" [G L0234-L0242]. UpdatedDate = the batch day, clamped up to the row's
 * CreatedDate. The shape is the one PREprod accepted (P20261007A file 7, an
 * Update with both filled; Part 17 §B).
 */
import { CCRS_COLUMNS } from "./ccrs-batch-core";
import { LEDGER_STATES, updatedDateFor, type LedgerEnv, type LedgerState } from "./ccrs-ledger-core";
import { isMissingDbFunctionError, type RpcErrorLike } from "@/lib/db/rpc-fallback-core";

export const INVENTORY_TOLD_RPC = "ccrs_inventory_last_told";

export type InventoryTold = {
  state: LedgerState | null;
  /** Column -> cell CCRS last accepted; null = unknown. */
  told: Readonly<Record<string, string>> | null;
  inFlight: boolean;
};

export type InventoryToldOutcome = { kind: "absent" } | { kind: "loaded"; byId: Map<string, InventoryTold> };

const COLS = CCRS_COLUMNS.Inventory;
const C = (name: string): number => {
  const i = COLS.indexOf(name);
  if (i < 0) throw new Error(`R6-3: Inventory has no column ${name}`);
  return i;
};
const EXT = C("ExternalIdentifier");
const OP = C("Operation");
const UPDATED_BY = C("UpdatedBy");
const UPDATED_DATE = C("UpdatedDate");
const CREATED_DATE = C("CreatedDate");

/** Cells that are a fact about the lot. UpdatedBy/UpdatedDate/Operation describe the row itself. */
export const COMPARED_COLUMNS: readonly string[] = COLS.filter((c) => c !== "UpdatedBy" && c !== "UpdatedDate" && c !== "Operation");
const NUMERIC = new Set(["InitialQuantity", "QuantityOnHand", "TotalCost"]);

const bad = (m: string): never => {
  throw new Error(`R6-3: ccrs_inventory_last_told answer is malformed: ${m}`);
};

/** Decode the 0286 answer. `absent` = migration not applied (send every row, as before). Anything else malformed THROWS. */
export function decodeInventoryTold(env: LedgerEnv, data: unknown, error: RpcErrorLike | null | undefined): InventoryToldOutcome {
  if (error) {
    if (isMissingDbFunctionError(error)) return { kind: "absent" };
    bad(`${error.code ?? "?"} ${error.message ?? ""}`.trim());
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) bad("answer is not an object");
  const d = data as Record<string, unknown>;
  if (d.env !== env) bad(`answer is for env ${String(d.env)}, asked for ${env}`);
  if (!Array.isArray(d.entries)) bad("`entries` is not an array");
  const byId = new Map<string, InventoryTold>();
  (d.entries as unknown[]).forEach((x, i) => {
    if (!Array.isArray(x) || x.length !== 4) bad(`entry ${i} is not [id,state,told,in_flight]`);
    const [id, state, told, inFlight] = x as unknown[];
    if (typeof id !== "string" || id === "") bad(`entry ${i}: id`);
    if (state !== null && (typeof state !== "string" || !(LEDGER_STATES as readonly string[]).includes(state))) bad(`entry ${i}: state ${String(state)}`);
    if (told !== null && (typeof told !== "object" || Array.isArray(told))) bad(`entry ${i}: told is not an object`);
    if (told !== null && Object.values(told as Record<string, unknown>).some((v) => v !== null && typeof v !== "string")) bad(`entry ${i}: told cells are not text`);
    if (typeof inFlight !== "boolean") bad(`entry ${i}: in_flight is not a boolean`);
    if (byId.has(id as string)) bad(`entry ${i}: ${String(id)} appears twice`);
    byId.set(id as string, { state: state as LedgerState | null, told: told as Record<string, string> | null, inFlight: inFlight as boolean });
  });
  return { kind: "loaded", byId };
}

function sameCell(column: string, ours: string, told: string | null | undefined): boolean {
  if (told === null || told === undefined) return false;
  if (NUMERIC.has(column)) {
    const a = ours.trim();
    const b = told.trim();
    if (a === "" || b === "") return a === b;
    const x = Number(a);
    const y = Number(b);
    return Number.isFinite(x) && Number.isFinite(y) && x === y;
  }
  if (column === "IsMedical") return ours.trim().toLowerCase() === told.trim().toLowerCase();
  return ours === told;
}

/** The compared columns whose cell differs from what CCRS last accepted ([] = unchanged). */
export function changedColumns(row: readonly string[], told: Readonly<Record<string, string>>): string[] {
  return COMPARED_COLUMNS.filter((c) => !sameCell(c, row[C(c)] ?? "", told[c]));
}

/** UpdatedDate never precedes CreatedDate [G L0242]. Lives in ledger-core (Product Updates use it too). */
export { updatedDateFor };

export type SkipReason = "unchanged";
export type SendReason = "insert" | "no-told-answer" | "never-accepted" | "in-flight" | "named-by-event" | "changed";

export type InventoryDeltaPlan = {
  rows: string[][];
  /** Update rows left out: CCRS already holds exactly these values. */
  unchanged: { id: string; state: LedgerState | null }[];
  /** Why each sent row was sent (by id), for the report. */
  sent: Map<string, { reason: SendReason; changed?: string[] }>;
};

export function planInventoryDelta(input: {
  rows: readonly string[][];
  told: InventoryToldOutcome;
  /** Lots named by an event row (Sale / InventoryAdjustment / InventoryTransfer) of THIS batch. */
  namedByEvents: ReadonlySet<string>;
  updatedBy: string;
  /** The batch day, MM/DD/YYYY (Pacific). */
  batchDay: string;
}): InventoryDeltaPlan {
  const rows: string[][] = [];
  const unchanged: InventoryDeltaPlan["unchanged"] = [];
  const sent: InventoryDeltaPlan["sent"] = new Map();
  for (const src of input.rows) {
    if (src.length !== COLS.length) throw new Error(`R6-3: Inventory row has ${src.length} cells, expected ${COLS.length}`);
    const id = src[EXT];
    const op = src[OP];
    if (op !== "Update") {
      rows.push([...src]);
      sent.set(id, { reason: "insert" });
      continue;
    }
    const withUpdated = (): string[] => {
      const r = [...src];
      r[UPDATED_BY] = input.updatedBy;
      r[UPDATED_DATE] = updatedDateFor(src[CREATED_DATE], input.batchDay);
      return r;
    };
    if (input.told.kind !== "loaded") {
      rows.push(withUpdated());
      sent.set(id, { reason: "no-told-answer" });
      continue;
    }
    const t = input.told.byId.get(id);
    if (!t || !t.told) {
      rows.push(withUpdated());
      sent.set(id, { reason: "never-accepted" });
      continue;
    }
    if (t.inFlight) {
      rows.push(withUpdated());
      sent.set(id, { reason: "in-flight" });
      continue;
    }
    if (input.namedByEvents.has(id)) {
      rows.push(withUpdated());
      sent.set(id, { reason: "named-by-event" });
      continue;
    }
    const changed = changedColumns(src, t.told);
    if (changed.length > 0) {
      rows.push(withUpdated());
      sent.set(id, { reason: "changed", changed });
      continue;
    }
    unchanged.push({ id, state: t.state });
  }
  return { rows, unchanged, sent };
}

/** Lots named by the event rows of a batch, read from the rows (never from a CSV re-parse). */
export function lotsNamedByEventRows(input: {
  adjustment: readonly string[][];
  sale: readonly string[][];
  transfer: readonly string[][];
}): Set<string> {
  const out = new Set<string>();
  const a = CCRS_COLUMNS.InventoryAdjustment.indexOf("InventoryExternalIdentifier");
  const s = CCRS_COLUMNS.Sale.indexOf("InventoryExternalIdentifier");
  const t = CCRS_COLUMNS.InventoryTransfer.indexOf("ToInventoryExternalIdentifier");
  for (const r of input.adjustment) if (r[a]) out.add(r[a]);
  for (const r of input.sale) if (r[s]) out.add(r[s]);
  for (const r of input.transfer) if (r[t]) out.add(r[t]);
  return out;
}

/* ------------------------------------------------------------------ *
 * Self-tests (tsx/vitest-runnable — PURE module)
 * ------------------------------------------------------------------ */

export function __runInventoryDeltaTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL:", msg);
    }
  };
  const row = (id: string, op: string, over: Partial<Record<string, string>> = {}): string[] =>
    COLS.map((c) =>
      c === "ExternalIdentifier" ? id
        : c === "Operation" ? op
          : over[c] ?? ({ LicenseNumber: "413541", Strain: "Kush", Area: "Sales Floor", Product: "P 1g", InitialQuantity: "10", QuantityOnHand: "4", TotalCost: "20.00", IsMedical: "FALSE", CreatedBy: "Greenway", CreatedDate: "10/01/2026", UpdatedBy: "", UpdatedDate: "" } as Record<string, string>)[c] ?? "");
  const toldOf = (r: string[]): Record<string, string> => Object.fromEntries(COLS.map((c, i) => [c, r[i]]));
  const loaded = (m: [string, InventoryTold][]): InventoryToldOutcome => ({ kind: "loaded", byId: new Map(m) });
  const base = { namedByEvents: new Set<string>(), updatedBy: "Greenway", batchDay: "10/26/2026" };

  const same = row("L1", "Update");
  const p = planInventoryDelta({ ...base, rows: [same, row("N1", "Insert")], told: loaded([["L1", { state: "filed", told: toldOf(row("L1", "Insert")), inFlight: false }]]) });
  ok(p.rows.length === 1 && p.rows[0][EXT] === "N1" && p.unchanged[0]?.id === "L1", "unchanged Update is left out; Insert kept");
  ok(p.rows[0][UPDATED_BY] === "" && p.rows[0][UPDATED_DATE] === "", "Insert keeps UpdatedBy/UpdatedDate empty");

  const moved = planInventoryDelta({ ...base, rows: [row("L1", "Update", { QuantityOnHand: "3" })], told: loaded([["L1", { state: "filed", told: toldOf(same), inFlight: false }]]) });
  ok(moved.rows.length === 1 && moved.sent.get("L1")?.reason === "changed" && moved.sent.get("L1")?.changed?.[0] === "QuantityOnHand", "changed QoH is sent");
  ok(moved.rows[0][UPDATED_BY] === "Greenway" && moved.rows[0][UPDATED_DATE] === "10/26/2026", "sent Update fills UpdatedBy/UpdatedDate");

  const numeric = planInventoryDelta({ ...base, rows: [row("L1", "Update", { TotalCost: "20.0" })], told: loaded([["L1", { state: "filed", told: toldOf(same), inFlight: false }]]) });
  ok(numeric.rows.length === 0, "20.0 equals 20.00 as a number");
  const med = planInventoryDelta({ ...base, rows: [row("L1", "Update")], told: loaded([["L1", { state: "filed", told: { ...toldOf(same), IsMedical: "False" }, inFlight: false }]]) });
  ok(med.rows.length === 0, "IsMedical compared case-insensitively");
  const strainCase = planInventoryDelta({ ...base, rows: [row("L1", "Update")], told: loaded([["L1", { state: "filed", told: { ...toldOf(same), Strain: "kush" }, inFlight: false }]]) });
  ok(strainCase.rows.length === 1, "text is compared exactly (strain casing change is sent)");
  const missingCell = planInventoryDelta({ ...base, rows: [row("L1", "Update")], told: loaded([["L1", { state: "filed", told: { QuantityOnHand: "4" }, inFlight: false }]]) });
  ok(missingCell.rows.length === 1, "a told payload missing a column is not 'unchanged'");

  ok(planInventoryDelta({ ...base, rows: [same], told: { kind: "absent" } }).sent.get("L1")?.reason === "no-told-answer", "0286 absent -> send");
  ok(planInventoryDelta({ ...base, rows: [same], told: loaded([]) }).sent.get("L1")?.reason === "never-accepted", "no entry -> send");
  ok(planInventoryDelta({ ...base, rows: [same], told: loaded([["L1", { state: "seed", told: null, inFlight: false }]]) }).sent.get("L1")?.reason === "never-accepted", "seed (no accepted row) -> send");
  ok(planInventoryDelta({ ...base, rows: [same], told: loaded([["L1", { state: "filed", told: toldOf(same), inFlight: true }]]) }).sent.get("L1")?.reason === "in-flight", "in flight -> send");
  ok(planInventoryDelta({ ...base, namedByEvents: new Set(["L1"]), rows: [same], told: loaded([["L1", { state: "closed", told: toldOf(same), inFlight: false }]]) }).sent.get("L1")?.reason === "named-by-event", "named by an event row -> send");

  ok(updatedDateFor("10/30/2026", "10/26/2026") === "10/30/2026", "UpdatedDate clamped up to CreatedDate");
  ok(updatedDateFor("12/31/2025", "01/02/2026") === "01/02/2026", "year boundary compares by year first");

  const dec = decodeInventoryTold("prod", { env: "prod", entries: [["L1", "filed", { QuantityOnHand: "4" }, false], ["L2", null, null, true]] }, null);
  ok(dec.kind === "loaded" && dec.byId.get("L1")?.told?.QuantityOnHand === "4" && dec.byId.get("L2")?.inFlight === true, "decode");
  ok(decodeInventoryTold("prod", null, { code: "42883", message: "" }).kind === "absent", "missing fn -> absent");
  const throws = (f: () => unknown) => {
    try {
      f();
      return false;
    } catch {
      return true;
    }
  };
  ok(throws(() => decodeInventoryTold("prod", { env: "preprod", entries: [] }, null)), "env mismatch throws");
  ok(throws(() => decodeInventoryTold("prod", { env: "prod", entries: [["L1", "filed", null, false], ["L1", "filed", null, false]] }, null)), "duplicate id throws");
  ok(throws(() => decodeInventoryTold("prod", { env: "prod", entries: [["L1", "filed", [], false]] }, null)), "told array throws");
  ok(throws(() => decodeInventoryTold("prod", null, { code: "XX000", message: "boom" })), "other rpc error throws");

  const named = lotsNamedByEventRows({
    adjustment: [CCRS_COLUMNS.InventoryAdjustment.map((c) => (c === "InventoryExternalIdentifier" ? "A1" : "x"))],
    sale: [CCRS_COLUMNS.Sale.map((c) => (c === "InventoryExternalIdentifier" ? "S1" : "x"))],
    transfer: [CCRS_COLUMNS.InventoryTransfer.map((c) => (c === "ToInventoryExternalIdentifier" ? "T1" : "x"))],
  });
  ok(named.has("A1") && named.has("S1") && named.has("T1") && named.size === 3, "event lots from all three event files");
  return { passed, failed };
}
