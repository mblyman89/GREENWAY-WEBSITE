/**
 * src/lib/pos/cutover-drift-core.ts  (R50 A6)
 *
 * PURE: the daily drift check for the first week after the cutover (Mon 11/02
 * to Sun 11/08). For every product on the cutover import it asks one question:
 * does "on hand now" equal "Cultivera's units, plus every recorded change"?
 *
 *     expected = received (Cultivera's units, written by the import)
 *              + every inventory_adjustments row on those lots (count, return,
 *                shrink, destruction, ...)
 *              - units sold on our register since the lots existed
 *              + units put back by a register void since then
 *     drift    = on hand now - expected
 *
 * Every term is a fact read from the code, never assumed:
 *  - The import writes received_qty = on_hand_qty and NO adjustment row
 *    (import-service.ts; no inventory_adjustments insert there).
 *  - Sales write NO adjustment rows (sale-decrement.ts header, migration 0023
 *    scope). They take units FIFO from the ACTIVE lots of one product key
 *    (lotKeyForSaleLine) and leave an `inventory_decremented` order_event.
 *  - A void puts units back on the newest non-quarantine lot of the same key
 *    and leaves a `sale_void_restocked` order_event (void-store.ts).
 *  - Every other writer (manual adjust, disposition, returns, cycle count,
 *    inventory audit, the Oct 30 count, legacy removal) inserts an
 *    inventory_adjustments row with the same delta.
 *
 * Because sales and voids are recorded per PRODUCT KEY, not per lot, a key that
 * also has lots from outside the import (a new delivery joined the same card)
 * cannot be split honestly. Those products are listed as "shared" and are not
 * judged - never guessed. A quantity that is not a whole number is red, never
 * rounded. A read that failed is red. Nothing here reads or writes anything.
 */

import { lotKeyForSaleLine } from "./variant-lot-core";
import { pacificWall } from "./cutover-weekend-core";

export const DRIFT_FIRST_DAY = "2026-11-02";
export const DRIFT_LAST_DAY = "2026-11-08";
export const DRIFT_DAYS = 7;
export const DRIFT_HREF = "/admin/menu-imports/drift";
export const DRIFT_SALE_EVENT = "inventory_decremented";
export const DRIFT_VOID_EVENT = "sale_void_restocked";
export const DRIFT_CHECKED_ACTION = "cutover_drift.checked";
export const DRIFT_NO_VENDOR = "(no vendor)";
export const DRIFT_NO_CATEGORY = "(no category)";
export const DRIFT_LINE_CAP = 300;

export type DriftLot = {
  id: string;
  pos_product_key: string | null;
  received_qty: number | string | null;
  on_hand_qty: number | string | null;
  created_at: string;
  product_name: string | null;
  category: string | null;
  vendor: string | null;
};

export type DriftAdjustment = { lot_id: string; qty_delta: number | string | null; reason: string | null };

/** One order line from a sale (or a void), stamped with WHEN its order_event was written. */
export type DriftOrderLine = { productId: string | null; variantId: string | null; quantity: number | string | null; at: string };

export type DriftLineKind = "drift" | "shared" | "not_whole";

export type DriftLine = {
  kind: DriftLineKind;
  key: string;
  product: string;
  vendor: string;
  category: string;
  lots: number;
  cultivera: number;
  adjusted: number;
  sold: number;
  voided: number;
  expected: number;
  onHand: number;
  drift: number;
  reasons: Record<string, number>;
};

export type DriftGroup = { key: string; cultivera: number; sold: number; adjusted: number; onHand: number; drift: number; red: number };

export type DriftReport = {
  ok: boolean;
  checks: { id: string; pass: boolean; detail: string }[];
  totals: { products: number; cultivera: number; adjusted: number; sold: number; voided: number; expected: number; onHand: number; drift: number; driftProducts: number; shared: number; notWhole: number };
  lines: DriftLine[];
  byVendor: DriftGroup[];
  byCategory: DriftGroup[];
  reasons: Record<string, number>;
};

function ws(v: unknown): string {
  return String(v ?? "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
}

/** A DB quantity as a whole number, or null (never rounded into agreement). */
export function wholeOrNull(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && Number.isInteger(n) ? n : null;
}

/** The key sales/voids use for a lot. A lot with no key can never be sold through the register. */
export function lotDriftKey(l: Pick<DriftLot, "id" | "pos_product_key">): string {
  const k = ws(l.pos_product_key);
  return k ? k : `lot:${l.id}`;
}

/** Units per key from order lines, counting only lines at/after that key's own start instant. */
export function unitsByKey(lines: readonly DriftOrderLine[], startByKey: ReadonlyMap<string, string>): { units: Map<string, number>; notWhole: Set<string> } {
  const units = new Map<string, number>();
  const notWhole = new Set<string>();
  for (const l of lines) {
    const key = lotKeyForSaleLine({ productId: l.productId, variantId: l.variantId });
    if (!key) continue;
    const start = startByKey.get(key);
    if (start === undefined || l.at < start) continue;
    const q = wholeOrNull(l.quantity);
    if (q === null) {
      notWhole.add(key);
      continue;
    }
    // The decrement takes max(0, trunc(qty)) (sale-decrement-core buildLotDecrementPlan).
    if (q <= 0) continue;
    units.set(key, (units.get(key) ?? 0) + q);
  }
  return { units, notWhole };
}

function group(lines: readonly DriftLine[], field: "vendor" | "category"): DriftGroup[] {
  const m = new Map<string, DriftGroup>();
  for (const l of lines) {
    if (l.kind === "not_whole") continue;
    const k = l[field];
    const g = m.get(k) ?? { key: k, cultivera: 0, sold: 0, adjusted: 0, onHand: 0, drift: 0, red: 0 };
    g.cultivera += l.cultivera;
    g.sold += l.sold - l.voided;
    g.adjusted += l.adjusted;
    g.onHand += l.onHand;
    if (l.kind === "drift" && l.drift !== 0) {
      g.drift += l.drift;
      g.red += 1;
    }
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => b.red - a.red || Math.abs(b.drift) - Math.abs(a.drift) || a.key.localeCompare(b.key));
}

export function driftReport(input: {
  lots: readonly DriftLot[];
  adjustments: readonly DriftAdjustment[];
  sold: readonly DriftOrderLine[];
  voided: readonly DriftOrderLine[];
  /** Keys that also have lots NOT on this import (cannot be split from ours). */
  sharedKeys: ReadonlySet<string>;
  /** Sale decrements whose marker says they FAILED partway (stock state unknown). */
  failedDecrements: number;
  readsComplete: boolean;
  readError?: string | null;
}): DriftReport {
  const lotKey = new Map<string, string>();
  const byKey = new Map<string, DriftLot[]>();
  for (const l of input.lots) {
    const k = lotDriftKey(l);
    lotKey.set(l.id, k);
    const arr = byKey.get(k) ?? [];
    arr.push(l);
    byKey.set(k, arr);
  }
  const startByKey = new Map<string, string>();
  for (const [k, ls] of byKey) startByKey.set(k, ls.map((l) => l.created_at).sort()[0]);

  const adjByKey = new Map<string, number>();
  const reasonsByKey = new Map<string, Record<string, number>>();
  const adjNotWhole = new Set<string>();
  for (const a of input.adjustments) {
    const k = lotKey.get(a.lot_id);
    if (!k) continue;
    const d = wholeOrNull(a.qty_delta);
    if (d === null) {
      adjNotWhole.add(k);
      continue;
    }
    adjByKey.set(k, (adjByKey.get(k) ?? 0) + d);
    const r = ws(a.reason) || "other";
    const rec = reasonsByKey.get(k) ?? {};
    rec[r] = (rec[r] ?? 0) + d;
    reasonsByKey.set(k, rec);
  }
  const sold = unitsByKey(input.sold, startByKey);
  const voided = unitsByKey(input.voided, startByKey);

  const lines: DriftLine[] = [];
  const reasons: Record<string, number> = {};
  for (const [k, ls] of byKey) {
    let cultivera = 0;
    let onHand = 0;
    let whole = !adjNotWhole.has(k) && !sold.notWhole.has(k) && !voided.notWhole.has(k);
    for (const l of ls) {
      const r = wholeOrNull(l.received_qty);
      const o = wholeOrNull(l.on_hand_qty);
      if (r === null || o === null) whole = false;
      else {
        cultivera += r;
        onHand += o;
      }
    }
    const first = ls[0];
    const adjusted = adjByKey.get(k) ?? 0;
    const s = sold.units.get(k) ?? 0;
    const v = voided.units.get(k) ?? 0;
    const expected = cultivera + adjusted - s + v;
    const drift = onHand - expected;
    const kind: DriftLineKind = !whole ? "not_whole" : input.sharedKeys.has(k) ? "shared" : "drift";
    const rec = reasonsByKey.get(k) ?? {};
    if (whole) for (const [r, d] of Object.entries(rec)) reasons[r] = (reasons[r] ?? 0) + d;
    lines.push({
      kind,
      key: k,
      product: ws(first.product_name) || "(no product name)",
      vendor: ws(first.vendor) || DRIFT_NO_VENDOR,
      category: ws(first.category) || DRIFT_NO_CATEGORY,
      lots: ls.length,
      cultivera,
      adjusted,
      sold: s,
      voided: v,
      expected,
      onHand,
      drift: kind === "drift" ? drift : 0,
      reasons: rec,
    });
  }

  const judged = lines.filter((l) => l.kind === "drift");
  const red = judged.filter((l) => l.drift !== 0);
  const notWhole = lines.filter((l) => l.kind === "not_whole");
  const shared = lines.filter((l) => l.kind === "shared");
  const sum = (f: (l: DriftLine) => number, ls: readonly DriftLine[]) => ls.reduce((a, l) => a + f(l), 0);
  const counted = lines.filter((l) => l.kind !== "not_whole");
  const totals = {
    products: lines.length,
    cultivera: sum((l) => l.cultivera, counted),
    adjusted: sum((l) => l.adjusted, counted),
    sold: sum((l) => l.sold, counted),
    voided: sum((l) => l.voided, counted),
    expected: sum((l) => l.expected, counted),
    onHand: sum((l) => l.onHand, counted),
    drift: sum((l) => l.drift, judged),
    driftProducts: red.length,
    shared: shared.length,
    notWhole: notWhole.length,
  };

  const checks = [
    {
      id: "reads",
      pass: input.readsComplete,
      detail: input.readsComplete ? "Every lot, adjustment, sale and void was read." : `Something could not be read, so nothing below can be trusted. ${input.readError ?? ""}`.trim(),
    },
    { id: "lots", pass: input.lots.length > 0, detail: input.lots.length > 0 ? `${input.lots.length} lot(s) on the cutover import.` : "No lots on this import." },
    {
      id: "drift",
      pass: red.length === 0,
      detail: red.length === 0 ? `Every unit on ${judged.length} product(s) is explained.` : `${red.length} product(s) have units nobody recorded (net ${signedNum(totals.drift)}).`,
    },
    {
      id: "decrements",
      pass: input.failedDecrements === 0,
      detail: input.failedDecrements === 0 ? "No sale failed to take its units off." : `${input.failedDecrements} sale(s) failed partway taking units off. Their products need a recount.`,
    },
    {
      id: "whole",
      pass: notWhole.length === 0,
      detail: notWhole.length === 0 ? "Every quantity is a whole number." : `${notWhole.length} product(s) have a quantity that is not a whole number (never rounded).`,
    },
  ];
  const ok = checks.every((c) => c.pass);

  const order: Record<DriftLineKind, number> = { not_whole: 0, drift: 1, shared: 2 };
  const shown = lines
    .filter((l) => l.kind !== "drift" || l.drift !== 0)
    .sort((a, b) => order[a.kind] - order[b.kind] || Math.abs(b.drift) - Math.abs(a.drift) || a.product.localeCompare(b.product) || a.key.localeCompare(b.key));

  return { ok, checks, totals, lines: shown, byVendor: group(lines, "vendor"), byCategory: group(lines, "category"), reasons };
}

export function signedNum(v: number): string {
  return v > 0 ? `+${v}` : String(v);
}

/** Plain-English meaning of one line (what the numbers say, never a guess about why). */
export function driftLineNote(l: DriftLine): string {
  if (l.kind === "not_whole") return "A quantity here is not a whole number, so it was not added up. Open the lot and fix the quantity.";
  if (l.kind === "shared") return "This product also has lots from a delivery after the cutover. Sales take from all of them, so ours cannot be split out. Count it on the shelf if it looks wrong.";
  if (l.drift < 0) return `${-l.drift} fewer on hand than recorded. Units left without a sale or an adjustment. Count the shelf, then adjust with the right reason.`;
  return `${l.drift} more on hand than recorded. Units came back without a void or an adjustment, or a sale was rung for more than we had (stock never goes below 0). Count the shelf, then adjust with the right reason.`;
}

export type DriftPhase = { phase: "before" | "during" | "after"; day: number | null; date: string; label: string };

/** Where the store's Pacific date sits in the 11/02-11/08 window. */
export function driftPhase(nowMs: number): DriftPhase {
  const date = pacificWall(nowMs).date;
  if (date < DRIFT_FIRST_DAY) return { phase: "before", day: null, date, label: `Before the first week (it runs ${DRIFT_FIRST_DAY} to ${DRIFT_LAST_DAY}). Running it now is a rehearsal.` };
  if (date > DRIFT_LAST_DAY) return { phase: "after", day: null, date, label: `The first week is over (${DRIFT_FIRST_DAY} to ${DRIFT_LAST_DAY}). This daily check is switched off.` };
  const day = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${DRIFT_FIRST_DAY}T00:00:00Z`)) / 86_400_000) + 1;
  return { phase: "during", day, date, label: `Day ${day} of ${DRIFT_DAYS} (${date}). Run it once today.` };
}

/** The seven dates of the window. */
export function driftDates(): string[] {
  const out: string[] = [];
  const base = Date.parse(`${DRIFT_FIRST_DAY}T00:00:00Z`);
  for (let i = 0; i < DRIFT_DAYS; i++) out.push(new Date(base + i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

export type DriftCheckRecord = { date: string; ok: boolean; drift: number; driftProducts: number; by: string | null; at: string };

/** Last record per Pacific date (a later press on the same day replaces the earlier one). */
export function checksByDate(records: readonly DriftCheckRecord[]): Map<string, DriftCheckRecord> {
  const m = new Map<string, DriftCheckRecord>();
  for (const r of [...records].sort((a, b) => a.at.localeCompare(b.at))) m.set(r.date, r);
  return m;
}

/** sale-decrement.ts writes these exact notes (the marker row, or a plain note when the claim itself failed). */
export const DECREMENT_IN_PROGRESS_NOTE = "Inventory decrement in progress\u2026";
export const DECREMENT_FAILED_PARTWAY_PREFIX = "Inventory decrement FAILED partway";
export const DECREMENT_FAILED_NOT_REDUCED_PREFIX = "Inventory decrement FAILED (stock not reduced";
/** A marker still "in progress" this long after it was claimed did not finish. */
export const DECREMENT_STUCK_MINUTES = 15;

/** Did this sale's stock step go wrong? (A marker row or a note row; anything else is fine.) */
export function decrementTrouble(note: string | null, createdAt: string, nowMs: number): boolean {
  const n = note ?? "";
  if (n.startsWith(DECREMENT_FAILED_PARTWAY_PREFIX) || n.startsWith(DECREMENT_FAILED_NOT_REDUCED_PREFIX)) return true;
  if (n === DECREMENT_IN_PROGRESS_NOTE) {
    const t = Date.parse(createdAt);
    return !Number.isFinite(t) || nowMs - t >= DECREMENT_STUCK_MINUTES * 60_000;
  }
  return false;
}

/** Should the page load the numbers? Off after the week unless he asks once. */
export function driftShouldRun(p: DriftPhase, anyway: boolean): boolean {
  return p.phase !== "after" || anyway;
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runCutoverDriftCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL cutover-drift-core: " + msg);
    passed += 1;
  };
  const T0 = "2026-11-01T14:20:00Z";
  const lot = (id: string, key: string | null, rec: number | string | null, oh: number | string | null, extra: Partial<DriftLot> = {}): DriftLot => ({
    id,
    pos_product_key: key,
    received_qty: rec,
    on_hand_qty: oh,
    created_at: T0,
    product_name: `P-${id}`,
    category: "Flower",
    vendor: "V1",
    ...extra,
  });
  const line = (productId: string | null, quantity: number | string | null, at = "2026-11-02T18:00:00Z", variantId: string | null = null): DriftOrderLine => ({ productId, variantId, quantity, at });
  const base = { adjustments: [] as DriftAdjustment[], sold: [] as DriftOrderLine[], voided: [] as DriftOrderLine[], sharedKeys: new Set<string>(), failedDecrements: 0, readsComplete: true };

  // the identity
  const r1 = driftReport({ ...base, lots: [lot("a", "K1", 10, 7)], sold: [line("K1", 3)] });
  ok(r1.ok && r1.totals.drift === 0 && r1.lines.length === 0, "sold 3 of 10, 7 on hand: no drift");
  const r2 = driftReport({ ...base, lots: [lot("a", "K1", 10, 6)], sold: [line("K1", 3)] });
  ok(!r2.ok && r2.totals.drift === -1 && r2.lines[0].drift === -1 && r2.totals.driftProducts === 1, "one unit missing is red");
  const r3 = driftReport({ ...base, lots: [lot("a", "K1", 10, 9)], sold: [line("K1", 3)], voided: [line("K1", 2)] });
  ok(r3.ok && r3.totals.voided === 2, "a void puts units back");
  const r4 = driftReport({ ...base, lots: [lot("a", "K1", 10, 8)], adjustments: [{ lot_id: "a", qty_delta: -2, reason: "count" }] });
  ok(r4.ok && r4.reasons.count === -2 && r4.totals.adjusted === -2, "a count adjustment explains units");
  const r5 = driftReport({ ...base, lots: [lot("a", "K1", 10, 11)], adjustments: [{ lot_id: "a", qty_delta: "1", reason: "return" }] });
  ok(r5.ok && r5.totals.expected === 11, "a return add-back explains units (string delta)");
  const r6 = driftReport({ ...base, lots: [lot("a", "K1", 10, 12)] });
  ok(!r6.ok && r6.lines[0].drift === 2 && driftLineNote(r6.lines[0]).startsWith("2 more"), "units from nowhere are red");
  ok(driftLineNote(r2.lines[0]).startsWith("1 fewer"), "fewer note");

  // FIFO across two lots of one key: judged together
  const r7 = driftReport({ ...base, lots: [lot("a", "K1", 4, 0), lot("b", "K1", 6, 5)], sold: [line("K1", 5)] });
  ok(r7.ok && r7.totals.cultivera === 10 && r7.totals.onHand === 5 && r7.totals.products === 1, "two lots of a key sum");

  // sales before the lots existed never count
  const r8 = driftReport({ ...base, lots: [lot("a", "K1", 10, 10)], sold: [line("K1", 3, "2026-10-30T18:00:00Z")] });
  ok(r8.ok && r8.totals.sold === 0, "a sale before the import is ignored");
  const r8b = driftReport({ ...base, lots: [lot("a", "K1", 10, 7)], sold: [line("K1", 3, T0)] });
  ok(r8b.ok && r8b.totals.sold === 3, "a sale at the very instant counts");
  const r8c = driftReport({ ...base, lots: [lot("a", "K1", 10, 10)], voided: [line("K1", 3, "2026-10-30T18:00:00Z")] });
  ok(r8c.ok && r8c.totals.voided === 0, "a void before the import is ignored");
  // per-key start: a lot created later only counts later sales
  const r9 = driftReport({ ...base, lots: [lot("a", "K1", 5, 5), lot("b", "K2", 5, 4, { created_at: "2026-11-03T00:00:00Z" })], sold: [line("K2", 1, "2026-11-02T18:00:00Z"), line("K2", 1, "2026-11-03T18:00:00Z")] });
  ok(r9.ok && r9.totals.sold === 1, "per-key start instant");

  // other keys / custom lines are ignored; variant-encoded keys resolve
  const r10 = driftReport({ ...base, lots: [lot("a", "K1", 10, 8)], sold: [line("OTHER", 9), line("pos-custom-merch", 4), line("CARD", 2, undefined, "K1-onboarded")] });
  ok(r10.ok && r10.totals.sold === 2, "variant-encoded lot key used; others ignored");
  const r11 = driftReport({ ...base, lots: [lot("a", "K1", 10, 10)], sold: [line("K1", 0), line("K1", -2)] });
  ok(r11.ok && r11.totals.sold === 0, "zero and negative quantities take nothing");

  // shared keys are shown, never judged
  const r12 = driftReport({ ...base, lots: [lot("a", "K1", 10, 3)], sharedKeys: new Set(["K1"]) });
  ok(r12.ok && r12.lines[0].kind === "shared" && r12.lines[0].drift === 0 && r12.totals.shared === 1 && r12.totals.drift === 0, "shared key not judged");
  ok(driftLineNote(r12.lines[0]).includes("cannot be split"), "shared note");

  // not whole: red, excluded from sums
  const r13 = driftReport({ ...base, lots: [lot("a", "K1", "10.5", 10), lot("b", "K2", 4, 4)] });
  ok(!r13.ok && r13.totals.notWhole === 1 && r13.totals.cultivera === 4 && r13.lines[0].kind === "not_whole", "non-whole lot red, not summed");
  const r13b = driftReport({ ...base, lots: [lot("a", "K1", "10.5", 10), lot("a2", "K1", 5, 5), lot("b", "K2", 4, 4)] });
  ok(!r13b.ok && r13b.totals.cultivera === 4 && r13b.totals.onHand === 4 && r13b.totals.expected === 4, "a not-whole product's other lots stay out of the totals");
  const r14 = driftReport({ ...base, lots: [lot("a", "K1", 10, 10)], adjustments: [{ lot_id: "a", qty_delta: "0.5", reason: "count" }] });
  ok(!r14.ok && r14.totals.notWhole === 1, "non-whole adjustment red");
  const r14b = driftReport({ ...base, lots: [lot("a", "K1", 10, 10)], sold: [line("K1", "1.5")] });
  ok(!r14b.ok && r14b.totals.notWhole === 1, "non-whole sale red");
  const r14c = driftReport({ ...base, lots: [lot("a", "K1", 10, null)] });
  ok(!r14c.ok && r14c.totals.notWhole === 1, "missing on-hand red");
  ok(driftLineNote(r13.lines[0]).includes("not a whole number"), "not-whole note");

  // adjustments on lots not on the import are ignored
  const r15 = driftReport({ ...base, lots: [lot("a", "K1", 10, 10)], adjustments: [{ lot_id: "zz", qty_delta: -4, reason: "count" }] });
  ok(r15.ok && r15.totals.adjusted === 0, "foreign adjustment ignored");
  const r15b = driftReport({ ...base, lots: [lot("a", "K1", 10, 9)], adjustments: [{ lot_id: "a", qty_delta: -1, reason: null }] });
  ok(r15b.ok && r15b.reasons.other === -1, "blank reason is 'other'");

  // a lot with no key is its own product (sales can never reach it)
  const r16 = driftReport({ ...base, lots: [lot("a", null, 3, 3), lot("b", "  ", 2, 1)] });
  ok(!r16.ok && r16.totals.products === 2 && r16.lines[0].key === "lot:b", "no-key lots judged alone");
  ok(lotDriftKey({ id: "x", pos_product_key: " K " }) === "K", "key trimmed");

  // reads, failed decrements, empty
  const r17 = driftReport({ ...base, lots: [lot("a", "K1", 10, 10)], readsComplete: false, readError: "boom" });
  ok(!r17.ok && r17.checks[0].detail.includes("boom"), "failed read is red");
  const r18 = driftReport({ ...base, lots: [lot("a", "K1", 10, 10)], failedDecrements: 2 });
  ok(!r18.ok && r18.checks.find((c) => c.id === "decrements")!.detail.startsWith("2 sale(s)"), "failed decrement red");
  ok(!driftReport({ ...base, lots: [] }).ok, "no lots is red");

  // grouping
  const r19 = driftReport({ ...base, lots: [lot("a", "K1", 10, 9, { vendor: "VA" }), lot("b", "K2", 5, 5, { vendor: "VB", category: "" })] });
  ok(r19.byVendor[0].key === "VA" && r19.byVendor[0].red === 1 && r19.byVendor[0].drift === -1 && r19.byVendor[1].red === 0, "by vendor, red first");
  ok(r19.byCategory.some((g) => g.key === DRIFT_NO_CATEGORY), "blank category labelled");
  const r19b = driftReport({ ...base, lots: [lot("a", "K1", 10, 7, { vendor: null })], sold: [line("K1", 3)] });
  ok(r19b.byVendor[0].key === DRIFT_NO_VENDOR && r19b.byVendor[0].sold === 3 && r19b.byVendor[0].onHand === 7, "group sums");
  // ordering: not_whole, then biggest drift, then shared
  const r20 = driftReport({ ...base, lots: [lot("s", "KS", 1, 1), lot("d1", "K1", 10, 9), lot("d2", "K2", 10, 5), lot("n", "KN", "x", 1)], sharedKeys: new Set(["KS"]) });
  ok(r20.lines.map((l) => l.key).join(",") === "KN,K2,K1,KS", "line order");

  // phase
  ok(driftPhase(Date.UTC(2026, 10, 1, 20)).phase === "before", "11/01 is before");
  ok(driftPhase(Date.UTC(2026, 10, 2, 20)).day === 1 && driftPhase(Date.UTC(2026, 10, 8, 20)).day === 7, "day 1 and day 7");
  ok(driftPhase(Date.UTC(2026, 10, 9, 7, 30)).phase === "during", "11/08 23:30 Pacific is still day 7");
  ok(driftPhase(Date.UTC(2026, 10, 9, 20)).phase === "after", "11/09 is after");
  ok(!driftShouldRun(driftPhase(Date.UTC(2026, 10, 9, 20)), false) && driftShouldRun(driftPhase(Date.UTC(2026, 10, 9, 20)), true), "switched off after, unless asked");
  ok(driftShouldRun(driftPhase(Date.UTC(2026, 10, 1, 20)), false) && driftShouldRun(driftPhase(Date.UTC(2026, 10, 4, 20)), false), "runs before and during");
  const ds = driftDates();
  ok(ds.length === 7 && ds[0] === DRIFT_FIRST_DAY && ds[6] === DRIFT_LAST_DAY, "seven dates");

  // check records
  const recs = checksByDate([
    { date: "2026-11-02", ok: false, drift: -1, driftProducts: 1, by: "m", at: "2026-11-02T20:00:00Z" },
    { date: "2026-11-02", ok: true, drift: 0, driftProducts: 0, by: "m", at: "2026-11-02T22:00:00Z" },
    { date: "2026-11-03", ok: true, drift: 0, driftProducts: 0, by: "m", at: "2026-11-03T22:00:00Z" },
  ]);
  ok(recs.size === 2 && recs.get("2026-11-02")!.ok === true, "latest record per day wins");
  // decrement trouble (the exact notes sale-decrement.ts writes)
  const now = Date.parse("2026-11-02T20:00:00Z");
  ok(decrementTrouble("Inventory decrement FAILED partway (x). The latch is kept", "2026-11-02T19:00:00Z", now), "failed partway");
  ok(decrementTrouble("Inventory decrement FAILED (stock not reduced \u2014 run a cycle count or retry): x", "2026-11-02T19:00:00Z", now), "failed, not reduced");
  ok(decrementTrouble(DECREMENT_IN_PROGRESS_NOTE, "2026-11-02T19:45:00Z", now) && !decrementTrouble(DECREMENT_IN_PROGRESS_NOTE, "2026-11-02T19:45:01Z", now), "stuck at exactly 15 minutes");
  ok(!decrementTrouble("Inventory decremented for 2 line(s): 2 menu variant(s), 2 lot touch(es).", "2026-11-02T19:00:00Z", now) && !decrementTrouble(null, "x", now), "a finished decrement is fine");
  ok(decrementTrouble(DECREMENT_IN_PROGRESS_NOTE, "garbage", now), "unreadable time on a stuck marker counts");
  ok(signedNum(3) === "+3" && signedNum(-2) === "-2" && signedNum(0) === "0", "signed");
  ok(wholeOrNull("") === null && wholeOrNull(" 4 ") === 4 && wholeOrNull(2.5) === null && wholeOrNull(undefined) === null, "wholeOrNull");

  return { passed, failed: 0 };
}
