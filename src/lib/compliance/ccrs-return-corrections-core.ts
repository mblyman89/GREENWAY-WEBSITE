/**
 * src/lib/compliance/ccrs-return-corrections-core.ts — Round 5 / Slice R5-1 (PURE).
 *
 * Customer-return CORRECTIONS of Sale.csv (Operation Update / Delete), planned
 * per sale line from the CUMULATIVE return, and — when the CCRS ledger is
 * loaded — only for sale lines CCRS demonstrably holds.
 *
 * LCB lines this module rests on (verbatim, re-checked by
 * tests/compliance/r5-return-corrections.test.ts against ../lcb/*.txt):
 *   - "If a retailer receives a valid return from a customer, the sale
 *     identifier should be deleted from CCRS, and the inventory identifier
 *     reported on an Inventory Adjustment as a return" [FAQ L0038-L0039].
 *   - Update "alter an existing record indicated by external identifier",
 *     Delete "delete a record indicated by external identifier" [G L0247-L0248].
 *   - "What happens if an Update operation is performed prior to an Insert
 *     operation? The record doesn't exist, so an error message would be
 *     received." [FAQ L0052-L0053]; "Invalid Sale Detail (UD)" /
 *     "SaleDetailExternalIdentifier not found" [G L1413-L1414].
 *   - Quantity: "No negative values allowed" [G L1345].
 *
 * Rules (each one is tested below and in the vitest file):
 *   1. Returns are grouped by SaleDetailExternalIdentifier. The correction
 *      states the line AFTER every return so far (cumulative), never "original
 *      minus this return" — the bug the old manual route had on a second
 *      partial return.
 *   2. Only lines with at least one PENDING (not yet exported) return emit a
 *      row; the row's returnIds are the pending ones (what gets marked
 *      exported once the outbox has stored the file).
 *   3. cumulative >= original -> ONE Delete restating the original line.
 *      Otherwise an Update with the remaining quantity, money pro-rated.
 *   4. More returned than sold, a blank id, or disagreeing snapshots of the
 *      same line -> INVALID, named, never sent.
 *   5. Ledger mode: emitted only when CCRS holds the line (seed / filed /
 *      confirmed), no file naming it is unanswered, and the line's own Insert
 *      is not in this same batch. Otherwise WITHHELD (E48) and the return
 *      stays pending, so the next batch picks it up. A correction CCRS has
 *      already applied (Delete of a deleted line, Update to the quantity CCRS
 *      already holds) is REFLECTED: not re-sent, reported as done.
 *   6. Legacy mode (no ledger: the manual download) emits every valid line.
 */
import { isMissingDbFunctionError, type RpcErrorLike } from "@/lib/db/rpc-fallback-core";
import { CCRS_COLUMNS, ccrsReaderSplit, type CcrsRetailerFileType } from "./ccrs-batch-core";
import { LEDGER_STATES, type LedgerEntry, type LedgerEnv, type LedgerState } from "./ccrs-ledger-core";
import { mapSaleCorrectionRow } from "./ccrs-sale-correction-core";

export const SALE_SLICE_RPC = "ccrs_sale_slice";

/** One customer_returns row, with the original-line snapshot it carries. */
export type ReturnRecord = {
  id: string;
  saleExternalId: string;
  saleDetailExternalId: string;
  inventoryExternalId: string;
  saleType: string;
  /** Original sale day (YYYY-MM-DD Pacific, or ISO). */
  saleDateISO: string;
  originalQuantity: number;
  /** Quantity returned by THIS return. */
  quantity: number;
  unitPriceMinor: number;
  discountMinor: number;
  salesTaxMinor: number;
  exciseMinor: number;
  createdAtISO: string;
  /** true = this return's correction has not been exported yet. */
  pending: boolean;
};

/** What the ledger says about one sale line (null in the map = not held). */
export type SaleHeld = { state: LedgerState; quantity: string | null; inFlight: boolean };

export type CorrectionGroup = {
  detailId: string;
  operation: "Update" | "Delete";
  cumulative: number;
  original: number;
  /** PENDING return ids this row answers (marked exported after emit). */
  returnIds: string[];
};
export type CorrectionNote = { detailId: string; returnIds: string[]; reason: string };

export type ReturnCorrectionPlan = {
  rows: string[][];
  groups: CorrectionGroup[];
  withheld: CorrectionNote[];
  invalid: CorrectionNote[];
  reflected: { detailId: string; returnIds: string[] }[];
};

const HELD: ReadonlySet<LedgerState> = new Set(["seed", "filed", "confirmed"]);

const SNAPSHOT_FIELDS = [
  "saleExternalId",
  "inventoryExternalId",
  "saleType",
  "saleDateISO",
  "originalQuantity",
  "unitPriceMinor",
  "discountMinor",
  "salesTaxMinor",
  "exciseMinor",
] as const;

const byCreated = (a: ReturnRecord, b: ReturnRecord) =>
  a.createdAtISO < b.createdAtISO ? -1 : a.createdAtISO > b.createdAtISO ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export function planReturnCorrections(input: {
  returns: readonly ReturnRecord[];
  license: { licenseNumber: string; submittedBy: string };
  ledger: "legacy" | ReadonlyMap<string, SaleHeld | null>;
  /** Sale lines Inserted by THIS batch's Sale rows. */
  insertedDetailIds: ReadonlySet<string>;
  /** Lines CCRS does not hold yet but whose Insert file is unanswered. */
  inFlightOnly?: ReadonlySet<string>;
}): ReturnCorrectionPlan {
  const plan: ReturnCorrectionPlan = { rows: [], groups: [], withheld: [], invalid: [], reflected: [] };
  const groups = new Map<string, ReturnRecord[]>();
  for (const r of input.returns) {
    const id = (r.saleDetailExternalId ?? "").trim();
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id)!.push(r);
  }
  const emitted: { row: string[]; group: CorrectionGroup }[] = [];

  for (const detailId of [...groups.keys()].sort()) {
    const list = [...groups.get(detailId)!].sort(byCreated);
    const pendingIds = list.filter((r) => r.pending).map((r) => r.id);
    if (pendingIds.length === 0) continue; // already exported; never re-sent
    const note = (reason: string): CorrectionNote => ({ detailId, returnIds: pendingIds, reason });

    if (detailId === "") {
      plan.invalid.push(note("the return has no SaleDetailExternalIdentifier, so CCRS cannot be told which sale line to correct"));
      continue;
    }
    const first = list[0];
    const clash = SNAPSHOT_FIELDS.find((f) => list.some((r) => r[f] !== first[f]));
    if (clash) {
      plan.invalid.push(note(`the returns of this sale line disagree about the original ${clash}; fix the return records before reporting`));
      continue;
    }
    const original = first.originalQuantity;
    if (!(Number.isFinite(original) && original > 0) || list.some((r) => !(Number.isFinite(r.quantity) && r.quantity > 0))) {
      plan.invalid.push(note("sold and returned quantities must be positive numbers"));
      continue;
    }
    const cumulative = list.reduce((s, r) => s + r.quantity, 0);
    if (cumulative > original) {
      plan.invalid.push(note(`${cumulative} returned but only ${original} sold on this line ("No negative values allowed" [G L1345])`));
      continue;
    }
    const operation: "Update" | "Delete" = cumulative >= original ? "Delete" : "Update";
    const remaining = original - cumulative;
    const latest = list[list.length - 1].createdAtISO;
    const mapped = mapSaleCorrectionRow(
      {
        correctionOperation: operation,
        saleExternalId: first.saleExternalId,
        saleDetailExternalId: detailId,
        inventoryExternalId: first.inventoryExternalId,
        saleType: first.saleType,
        saleDateISO: first.saleDateISO,
        originalQuantity: original,
        returnQuantity: cumulative,
        unitPriceMinor: first.unitPriceMinor,
        discountMinor: first.discountMinor,
        salesTaxMinor: first.salesTaxMinor,
        exciseMinor: first.exciseMinor,
        returnedAtISO: latest,
      },
      input.license,
    );
    if (!mapped.row) {
      plan.invalid.push(note(mapped.skipReason ?? "the correction row could not be built"));
      continue;
    }

    if (input.ledger !== "legacy") {
      if (input.insertedDetailIds.has(detailId)) {
        plan.withheld.push(note("the sale itself is Inserted in this same batch; the correction waits until CCRS has answered that file"));
        continue;
      }
      const h = input.ledger.get(detailId) ?? null;
      if (h === null) {
        plan.withheld.push(
          note(
            input.inFlightOnly?.has(detailId)
              ? "the file that Inserts this sale line is not answered yet; record its outcome first"
              : 'CCRS does not hold this sale line ("SaleDetailExternalIdentifier not found" [G L1414]); report the sale first',
          ),
        );
        continue;
      }
      if (h.inFlight) {
        plan.withheld.push(note("a file naming this sale line is not answered yet; record its outcome first"));
        continue;
      }
      if (operation === "Delete" && h.state === "deleted") {
        plan.reflected.push({ detailId, returnIds: pendingIds });
        continue;
      }
      if (!HELD.has(h.state)) {
        plan.withheld.push(note(`the ledger has this sale line in state ${h.state}; resolve it before correcting`));
        continue;
      }
      if (operation === "Update" && h.quantity !== null && h.quantity === String(remaining)) {
        plan.reflected.push({ detailId, returnIds: pendingIds });
        continue;
      }
    }
    emitted.push({ row: mapped.row, group: { detailId, operation, cumulative, original, returnIds: pendingIds } });
  }
  plan.rows = emitted.map((e) => e.row);
  plan.groups = emitted.map((e) => e.group);
  return plan;
}

/* ------------------------------------------------------------------ *
 * Decoder for public.ccrs_sale_slice (migration 0283)
 * ------------------------------------------------------------------ */

export type SaleSliceOutcome =
  | { kind: "absent" }
  | { kind: "loaded"; held: Map<string, SaleHeld | null>; inFlightOnly: Set<string> };

export class CcrsSaleSliceError extends Error {}
function bad(m: string): never {
  throw new CcrsSaleSliceError(`ccrs_sale_slice: ${m}`);
}

/**
 * Missing function (0283 not applied) -> absent: the batch then withholds
 * every correction (it cannot prove CCRS holds the line). Any other error or
 * a malformed answer THROWS: a garbled answer could send an Update CCRS lacks.
 */
export function decodeSaleSlice(env: LedgerEnv, data: unknown, error: RpcErrorLike | null | undefined): SaleSliceOutcome {
  if (error) {
    if (isMissingDbFunctionError(error)) return { kind: "absent" };
    bad(`${error.code ?? "?"} ${error.message ?? ""}`.trim());
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) bad("answer is not an object");
  const d = data as Record<string, unknown>;
  if (d.env !== env) bad(`answer is for env ${String(d.env)}, asked for ${env}`);
  if (!Array.isArray(d.entries)) bad("`entries` is not an array");
  const held = new Map<string, SaleHeld | null>();
  const inFlightOnly = new Set<string>();
  (d.entries as unknown[]).forEach((x, i) => {
    if (!Array.isArray(x) || x.length !== 4) bad(`entry ${i} is not [detail_id,state,quantity,in_flight]`);
    const [id, state, qty, inFlight] = x as unknown[];
    if (typeof id !== "string" || id === "") bad(`entry ${i}: detail id`);
    if (state !== null && (typeof state !== "string" || !(LEDGER_STATES as readonly string[]).includes(state))) bad(`entry ${i}: state ${String(state)}`);
    if (qty !== null && typeof qty !== "string") bad(`entry ${i}: quantity`);
    if (typeof inFlight !== "boolean") bad(`entry ${i}: in_flight is not a boolean`);
    if (held.has(id)) bad(`entry ${i}: ${id} appears twice`);
    if (state === null) {
      held.set(id, null);
      if (inFlight) inFlightOnly.add(id);
    } else {
      held.set(id, { state: state as LedgerState, quantity: qty as string | null, inFlight });
    }
  });
  return { kind: "loaded", held, inFlightOnly };
}

/** Held sale lines as Sale ledger entries, so the outbox self-check sees them. */
export function saleLedgerEntries(held: ReadonlyMap<string, SaleHeld | null>): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  for (const [externalId, h] of held) {
    if (h) out.push({ fileType: "Sale", externalId, filedName: null, state: h.state, productExternalId: null });
  }
  return out;
}

/** The lots (InventoryExternalIdentifier) named by Adjustment and Sale rows, first-seen order. */
export function eventLotRefs(sources: readonly { type: CcrsRetailerFileType; csv: string }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of sources) {
    if (s.type !== "InventoryAdjustment" && s.type !== "Sale") continue;
    const col = CCRS_COLUMNS[s.type].indexOf("InventoryExternalIdentifier");
    const body = s.csv.endsWith("\r\n") ? s.csv.slice(0, -2) : s.csv;
    for (const line of body.split("\r\n").slice(4)) {
      if (line === "") continue;
      const lot = ccrsReaderSplit(line)[col];
      if (lot && !seen.has(lot)) {
        seen.add(lot);
        out.push(lot);
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Self-tests (tsx/vitest-runnable — PURE module)
 * ------------------------------------------------------------------ */

export function __runReturnCorrectionsTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      throw new Error("FAIL: " + msg);
    }
  };
  const lic = { licenseNumber: "413541", submittedBy: "Greenway" };
  const base: ReturnRecord = {
    id: "r1",
    saleExternalId: "S",
    saleDetailExternalId: "S-1",
    inventoryExternalId: "L",
    saleType: "RecreationalRetail",
    saleDateISO: "2026-10-05",
    originalQuantity: 2,
    quantity: 1,
    unitPriceMinor: 1000,
    discountMinor: 0,
    salesTaxMinor: 200,
    exciseMinor: 740,
    createdAtISO: "2026-10-06T18:00:00Z",
    pending: true,
  };
  const Q = CCRS_COLUMNS.Sale.indexOf("Quantity");
  const OP = CCRS_COLUMNS.Sale.indexOf("Operation");

  const part = planReturnCorrections({ returns: [base], license: lic, ledger: "legacy", insertedDetailIds: new Set() });
  ok(part.rows.length === 1 && part.rows[0][OP] === "Update" && part.rows[0][Q] === "1", "partial -> Update remaining 1");

  const second = planReturnCorrections({
    returns: [{ ...base, id: "r2", createdAtISO: "2026-10-07T18:00:00Z" }, { ...base, pending: false }],
    license: lic,
    ledger: "legacy",
    insertedDetailIds: new Set(),
  });
  ok(second.rows[0]?.[OP] === "Delete" && second.rows[0][Q] === "2", "cumulative 2 of 2 -> Delete restating original");
  ok(JSON.stringify(second.groups[0].returnIds) === '["r2"]', "only pending ids are answered");

  const over = planReturnCorrections({ returns: [{ ...base, quantity: 3 }], license: lic, ledger: "legacy", insertedDetailIds: new Set() });
  ok(over.rows.length === 0 && over.invalid.length === 1, "over-return refused");

  const held = (h: SaleHeld | null) => new Map([["S-1", h]]);
  const L = (h: SaleHeld | null, inserted: string[] = []) =>
    planReturnCorrections({ returns: [base], license: lic, ledger: held(h), insertedDetailIds: new Set(inserted) });
  ok(L({ state: "filed", quantity: "2", inFlight: false }).rows.length === 1, "held -> emitted");
  ok(L(null).withheld.length === 1, "not held -> withheld");
  ok(L({ state: "filed", quantity: "2", inFlight: true }).withheld.length === 1, "in flight -> withheld");
  ok(L({ state: "filed", quantity: "2", inFlight: false }, ["S-1"]).withheld.length === 1, "same batch -> withheld");
  ok(L({ state: "filed", quantity: "1", inFlight: false }).reflected.length === 1, "already at remaining -> reflected");
  ok(L({ state: "uncertain", quantity: "2", inFlight: false }).withheld[0]?.reason.includes("uncertain") === true, "uncertain named");

  const dec = decodeSaleSlice("prod", { env: "prod", entries: [["S-1", "filed", "2", false], ["S-2", null, null, true]] }, null);
  ok(dec.kind === "loaded" && dec.held.get("S-1")?.state === "filed" && dec.inFlightOnly.has("S-2"), "decode");
  ok(decodeSaleSlice("prod", null, { code: "42883", message: "" }).kind === "absent", "missing fn -> absent");
  let threw = false;
  try {
    decodeSaleSlice("prod", { env: "preprod", entries: [] }, null);
  } catch {
    threw = true;
  }
  ok(threw, "env mismatch throws");
  ok(saleLedgerEntries(held(null)).length === 0, "null lines are not ledger entries");

  return { passed, failed };
}
