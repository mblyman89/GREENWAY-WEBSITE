/**
 * src/lib/inventory/intake-count-core.ts  (Fix Phase 3.1 · G-16 · F-04-1, PURE)
 *
 * Receive part of a line: "18 of 20".
 *
 * The owner, verbatim:
 *   "So we need the ability to tell the system that we are only accepting a
 *    part of the manifest and the rest was rejected. There are several
 *    instances where the vendor forgot to send an item, or it broke in
 *    transit, etc." (docs/ccrs-rejection-and-returns.md L15-21)
 *   D29: "we need a way to accept less than what came in, please add this to
 *        the list of serious issues to fix" (00-OWNER-REQUEST-VERBATIM.md L108)
 *   Owner message 6: "please begin work on phase 3, receiving: accept "18 of 20""
 *
 * The rules (G-16 requirements, 05-GAP-REGISTER):
 *   1. A manager types the COUNTED quantity for one line. It may not be more
 *      than the manifest's quantity: an overage is refused (refuse the line
 *      with "Overage", SOP-04 §4.11). The difference needs a reason.
 *   2. Counted 0 = nothing came in: the WHOLE line is refused at the dock
 *      with the reason (the existing refusal, not a 0-quantity lot).
 *   3. Counted = the manifest quantity = no short count (an earlier short
 *      count on the line is cleared).
 *   4. Otherwise the line is SHORT: received_qty / on_hand_qty become the
 *      counted quantity and the manifest quantity is kept in shipped_qty, so
 *      Finalize activates the counted quantity, the "receive" adjustment is
 *      the counted quantity, and the weekly CCRS InventoryTransfer reports
 *      the counted quantity (ccrs-transfer-core rule 3 reads received_qty).
 *   5. A short-counted line makes the delivery a PARTIAL acceptance: the
 *      why-partial note is required, and the timeline names every short line
 *      as shipped / counted / refused.
 *   6. A whole-unit line takes a whole count. Never guess: a count that is
 *      not a plain number is refused, never rounded.
 *
 * No I/O, no React, no environment reads.
 */
import {
  REJECT_REASON_LABELS,
  type RejectReasonCode,
} from "@/lib/inventory/intake-disposition-core";

/** Timeline event types (named constants; labelled in manifest-event-labels-core). */
export const COUNT_SHORT_EVENT = "count_short";
export const COUNT_SHORT_CLEARED_EVENT = "count_short_cleared";

/**
 * Reasons for the refused part of a short line: every dock reason except
 * "overage" (receiving MORE than the manifest says is never a short count).
 * Must match the 0319 check constraint inventory_lots_short_reason_code_chk.
 */
export const SHORT_REASON_CODES = [
  "short_shipment",
  "damaged_in_transit",
  "wrong_product",
  "failed_coa",
  "expired",
  "other",
] as const satisfies readonly RejectReasonCode[];

export type ShortReasonCode = (typeof SHORT_REASON_CODES)[number];

export function isShortReasonCode(v: string): v is ShortReasonCode {
  return (SHORT_REASON_CODES as readonly string[]).includes(v);
}

export const SHORT_REASON_LABELS: Record<ShortReasonCode, string> = {
  short_shipment: REJECT_REASON_LABELS.short_shipment,
  damaged_in_transit: REJECT_REASON_LABELS.damaged_in_transit,
  wrong_product: REJECT_REASON_LABELS.wrong_product,
  failed_coa: REJECT_REASON_LABELS.failed_coa,
  expired: REJECT_REASON_LABELS.expired,
  other: REJECT_REASON_LABELS.other,
};

/** The facts of the line the count is for, as stored. */
export type CountLineFacts = {
  /** received_qty today (the counted quantity if already short, else the manifest's). */
  receivedQty: number;
  /** shipped_qty today: null = never counted short. */
  shippedQty: number | null;
  status: string;
  disposition: string | null;
};

export type DockCountPlan =
  | {
      ok: true;
      kind: "short";
      shipped: number;
      counted: number;
      refused: number;
      reasonCode: ShortReasonCode;
      reasonText: string;
    }
  | { ok: true; kind: "refuse_whole"; shipped: number; reasonCode: ShortReasonCode; reasonText: string }
  | { ok: true; kind: "clear"; shipped: number }
  | { ok: false; code: CountRefusalCode; error: string };

export type CountRefusalCode =
  | "not_staged"
  | "refused_line"
  | "no_shipped"
  | "not_a_number"
  | "negative"
  | "fraction"
  | "overage"
  | "same_as_now"
  | "reason";

/** The manifest's quantity for this line: shipped_qty when counted short, else received_qty. */
export function manifestQtyOf(line: Pick<CountLineFacts, "receivedQty" | "shippedQty">): number {
  return line.shippedQty != null ? line.shippedQty : line.receivedQty;
}

/**
 * Read the typed count. Plain decimal digits only ("18", "18.5"); anything
 * else (blank, "18 units", "1e3", "-2", ",") is refused, never coerced.
 */
export function parseCountedQty(raw: unknown): { ok: true; value: number } | { ok: false; code: "not_a_number" | "negative" } {
  const t = typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw) : "";
  if (/^-\s*\d/.test(t)) return { ok: false, code: "negative" };
  if (!/^\d+(\.\d{1,3})?$/.test(t)) return { ok: false, code: "not_a_number" };
  const v = Number(t);
  if (!Number.isFinite(v)) return { ok: false, code: "not_a_number" };
  return { ok: true, value: v };
}

/** Thousandths, so 18.1 - 0.1 never prints 17.999999. */
function q(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function fmtCountQty(n: number): string {
  return String(q(n));
}

/**
 * Validate one dock count and say what it does. The reason is needed for
 * "short" and "refuse_whole", never for "clear".
 */
export function planDockCount(
  line: CountLineFacts,
  input: { counted: unknown; reasonCode?: string | null; reasonText?: string | null },
): DockCountPlan {
  if (line.status !== "quarantine" && line.status !== "pending") {
    return {
      ok: false,
      code: "not_staged",
      error: "This line is no longer waiting at the dock (it was finalized). A count can only be entered before Finalize.",
    };
  }
  if (line.disposition === "rejected_at_dock") {
    return {
      ok: false,
      code: "refused_line",
      error: "This line is refused at the dock. Press \u201caccept instead\u201d first if part of it came in.",
    };
  }
  const shipped = q(manifestQtyOf(line));
  if (!(shipped > 0)) {
    return { ok: false, code: "no_shipped", error: "The manifest shows no quantity for this line, so there is nothing to count short." };
  }
  const parsed = parseCountedQty(input.counted);
  if (!parsed.ok) {
    return parsed.code === "negative"
      ? { ok: false, code: "negative", error: "A count cannot be negative." }
      : { ok: false, code: "not_a_number", error: "Type the count as a plain number, for example 18." };
  }
  const counted = q(parsed.value);
  if (Number.isInteger(shipped) && !Number.isInteger(counted)) {
    return {
      ok: false,
      code: "fraction",
      error: `This line came as whole units (${fmtCountQty(shipped)}), so the count must be a whole number.`,
    };
  }
  if (counted > shipped) {
    return {
      ok: false,
      code: "overage",
      error: `You counted ${fmtCountQty(counted)} but the manifest says ${fmtCountQty(shipped)}. More than the manifest cannot be received: refuse the line with \u201cOverage\u201d, or call the manager (SOP-04 \u00a74.11).`,
    };
  }
  if (counted === shipped) {
    if (line.shippedQty == null) {
      return {
        ok: false,
        code: "same_as_now",
        error: `The count matches the manifest (${fmtCountQty(shipped)}). Nothing to change: Finalize accepts the full line.`,
      };
    }
    return { ok: true, kind: "clear", shipped };
  }
  const code = (input.reasonCode ?? "").trim();
  if (!isShortReasonCode(code)) {
    return { ok: false, code: "reason", error: "Pick why the rest was refused (a reason is required)." };
  }
  const text = (input.reasonText ?? "").trim().slice(0, 500);
  if (code === "other" && !text) {
    return { ok: false, code: "reason", error: "Please explain the \u2018Other\u2019 reason." };
  }
  const reasonText = text ? `${SHORT_REASON_LABELS[code]} \u2014 ${text}` : SHORT_REASON_LABELS[code];
  if (counted === 0) return { ok: true, kind: "refuse_whole", shipped, reasonCode: code, reasonText };
  return { ok: true, kind: "short", shipped, counted, refused: q(shipped - counted), reasonCode: code, reasonText };
}

/** One line on the timeline / in the audit row. */
export function countShortNote(
  label: string,
  p: { shipped: number; counted: number; refused: number; reasonText: string },
  unit: string | null,
): string {
  const u = unit && unit !== "each" ? ` ${unit}` : "";
  return `${label}: counted ${fmtCountQty(p.counted)} of ${fmtCountQty(p.shipped)}${u} shipped; ${fmtCountQty(p.refused)}${u} refused at the dock (${p.reasonText}). The lot will be received at ${fmtCountQty(p.counted)}; the refused units go back with the driver and the vendor corrects their CCRS manifest (Update).`;
}

export function countClearedNote(label: string, shipped: number, unit: string | null): string {
  const u = unit && unit !== "each" ? ` ${unit}` : "";
  return `${label}: short count removed; the line is back to the manifest quantity, ${fmtCountQty(shipped)}${u}.`;
}

/** A short-counted line as Finalize sees it. */
export type ShortLine = {
  label: string;
  shipped: number;
  counted: number;
  reason: string | null;
};

/**
 * The sentence Finalize adds to its timeline event for short-counted lines
 * that were accepted. Empty when none.
 */
export function finalizeShortSummary(lines: readonly ShortLine[]): string {
  if (lines.length === 0) return "";
  const parts = lines.map(
    (l) =>
      `${l.label} ${fmtCountQty(l.counted)} of ${fmtCountQty(l.shipped)} (${fmtCountQty(q(l.shipped - l.counted))} refused${l.reason ? `: ${l.reason}` : ""})`,
  );
  return ` Received short: ${parts.join("; ")}.`;
}

/**
 * A delivery with a short-counted line that is going in is a PARTIAL
 * acceptance (the owner: "we are only accepting a part of the manifest and
 * the rest was rejected"), so the why-partial note is required. Used by the
 * Finalize pre-flight, the Finalize outcome and the page's button plan, so
 * the three can never disagree.
 */
export function statusWithShortLines<S extends string>(status: S, shortGoingIn: number): S | "partially_accepted" {
  if (status === "accepted" && shortGoingIn > 0) return "partially_accepted";
  return status;
}

/** The inventory_adjustments note for a lot activated at its counted quantity. */
export function receiveAdjustmentNote(shortLine: { shipped: number; counted: number } | null): string {
  if (!shortLine) return "Accepted from vendor manifest intake (partial-accept flow).";
  return `Accepted from vendor manifest intake at the dock count: ${fmtCountQty(shortLine.counted)} of ${fmtCountQty(shortLine.shipped)} shipped (Fix Phase 3.1).`;
}

/** The quantity cell on the receiving page. */
export function qtyCellText(line: { receivedQty: number; shippedQty: number | null }): { main: string; short: string | null } {
  if (line.shippedQty == null) return { main: fmtCountQty(line.receivedQty), short: null };
  return {
    main: `${fmtCountQty(line.receivedQty)} of ${fmtCountQty(line.shippedQty)}`,
    short: `${fmtCountQty(q(line.shippedQty - line.receivedQty))} refused`,
  };
}

/** Postgres "column does not exist" (42703) / PostgREST schema-cache miss (PGRST204) for the 0319 columns. */
export function isMissingCountColumns(e: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!e) return false;
  if (e.code === "42703" || e.code === "PGRST204") return true;
  const msg = String(e.message ?? "");
  return /shipped_qty|short_reason_code|counted_by|counted_at/.test(msg) && /does not exist|schema cache|could not find/i.test(msg);
}

// ---------------------------------------------------------------------------
// Self-tests (house pattern)
// ---------------------------------------------------------------------------

export function __runIntakeCountCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: unknown, what: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`  \u2717 intake-count-core: ${what}`);
    }
  };
  const staged: CountLineFacts = { receivedQty: 20, shippedQty: null, status: "quarantine", disposition: null };

  // 18 of 20
  const p18 = planDockCount(staged, { counted: "18", reasonCode: "damaged_in_transit" });
  ok(p18.ok && p18.kind === "short" && p18.counted === 18 && p18.shipped === 20 && p18.refused === 2, "18 of 20 is short, 2 refused");
  ok(p18.ok && p18.kind === "short" && p18.reasonText === SHORT_REASON_LABELS.damaged_in_transit, "reason text = label");
  // a reason is required
  const noReason = planDockCount(staged, { counted: "18" });
  ok(!noReason.ok && noReason.code === "reason", "short with no reason refused");
  ok(!planDockCount(staged, { counted: "18", reasonCode: "overage" }).ok, "overage is not a short reason");
  const other = planDockCount(staged, { counted: "18", reasonCode: "other" });
  ok(!other.ok && other.code === "reason", "other needs words");
  const otherOk = planDockCount(staged, { counted: "18", reasonCode: "other", reasonText: "  box crushed " });
  ok(otherOk.ok && otherOk.kind === "short" && otherOk.reasonText.endsWith("\u2014 box crushed"), "other keeps the words");
  // overage
  const over = planDockCount(staged, { counted: "21", reasonCode: "short_shipment" });
  ok(!over.ok && over.code === "overage" && over.error.includes("Overage"), "21 of 20 refused as overage");
  // zero = refuse whole
  const zero = planDockCount(staged, { counted: "0", reasonCode: "short_shipment" });
  ok(zero.ok && zero.kind === "refuse_whole" && zero.shipped === 20, "0 counted = refuse the whole line");
  ok(!planDockCount(staged, { counted: "0" }).ok, "0 counted still needs a reason");
  // equal
  const same = planDockCount(staged, { counted: "20" });
  ok(!same.ok && same.code === "same_as_now", "20 of 20 on an uncounted line = nothing to change");
  const shortNow: CountLineFacts = { receivedQty: 18, shippedQty: 20, status: "quarantine", disposition: null };
  const clear = planDockCount(shortNow, { counted: "20" });
  ok(clear.ok && clear.kind === "clear" && clear.shipped === 20, "20 on a line counted 18 of 20 = clear");
  // recount keeps the manifest quantity
  const re = planDockCount(shortNow, { counted: "19", reasonCode: "short_shipment" });
  ok(re.ok && re.kind === "short" && re.shipped === 20 && re.counted === 19, "recount measures against shipped_qty, not the old count");
  ok(!planDockCount(shortNow, { counted: "21", reasonCode: "short_shipment" }).ok, "recount above shipped refused");
  // parsing
  ok(!planDockCount(staged, { counted: "" }).ok, "blank refused");
  ok(!planDockCount(staged, { counted: "18 units", reasonCode: "short_shipment" }).ok, "words refused");
  ok(!planDockCount(staged, { counted: "1e1", reasonCode: "short_shipment" }).ok, "exponent refused");
  const neg = planDockCount(staged, { counted: "-2", reasonCode: "short_shipment" });
  ok(!neg.ok && neg.code === "negative", "negative refused");
  const frac = planDockCount(staged, { counted: "18.5", reasonCode: "short_shipment" });
  ok(!frac.ok && frac.code === "fraction", "whole-unit line refuses a fraction");
  const bulk: CountLineFacts = { receivedQty: 453.6, shippedQty: null, status: "quarantine", disposition: null };
  const bulkP = planDockCount(bulk, { counted: "450.1", reasonCode: "short_shipment" });
  ok(bulkP.ok && bulkP.kind === "short" && bulkP.refused === 3.5, "decimal line: 450.1 of 453.6 = 3.5 refused (no float dust)");
  // states
  ok(!planDockCount({ ...staged, status: "active" }, { counted: "18", reasonCode: "short_shipment" }).ok, "active lot refused");
  const refused = planDockCount({ ...staged, disposition: "rejected_at_dock" }, { counted: "18", reasonCode: "short_shipment" });
  ok(!refused.ok && refused.code === "refused_line", "refused line refused");
  ok(planDockCount({ ...staged, status: "pending" }, { counted: "18", reasonCode: "short_shipment" }).ok, "pending lot allowed");
  ok(!planDockCount({ ...staged, receivedQty: 0 }, { counted: "0", reasonCode: "short_shipment" }).ok, "no manifest quantity refused");
  // texts
  const note = countShortNote("Blue Dream 1g", { shipped: 20, counted: 18, refused: 2, reasonText: "Damaged" }, "each");
  ok(note.includes("counted 18 of 20 shipped; 2 refused at the dock (Damaged)"), "timeline note says shipped / counted / refused");
  ok(finalizeShortSummary([]) === "", "no short lines = no sentence");
  ok(
    finalizeShortSummary([{ label: "A", shipped: 20, counted: 18, reason: "Damaged" }]) === " Received short: A 18 of 20 (2 refused: Damaged).",
    "finalize summary",
  );
  ok(receiveAdjustmentNote(null) === "Accepted from vendor manifest intake (partial-accept flow).", "full line keeps the old adjustment note");
  ok(receiveAdjustmentNote({ shipped: 20, counted: 18 }).includes("18 of 20 shipped"), "short line adjustment note");
  const cell = qtyCellText({ receivedQty: 18, shippedQty: 20 });
  ok(cell.main === "18 of 20" && cell.short === "2 refused", "quantity cell 18 of 20, 2 refused");
  ok(qtyCellText({ receivedQty: 20, shippedQty: null }).short === null, "uncounted cell plain");
  ok(statusWithShortLines("accepted", 1) === "partially_accepted", "a short line going in makes the delivery partial");
  ok(statusWithShortLines("accepted", 0) === "accepted", "no short line keeps accepted");
  ok(statusWithShortLines("rejected", 1) === "rejected", "rejected stays rejected");
  ok(SHORT_REASON_CODES.length === 6 && !(SHORT_REASON_CODES as readonly string[]).includes("overage"), "six short reasons, no overage");
  ok(isMissingCountColumns({ code: "42703", message: 'column "shipped_qty" does not exist' }), "missing column recognised");
  ok(!isMissingCountColumns({ code: "23514", message: "violates check constraint" }), "check violation is not a missing column");
  return { passed, failed };
}
