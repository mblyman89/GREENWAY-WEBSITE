/**
 * src/lib/inventory/manual-adjustment-core.ts — Fix Phase 1.2 (gap G-23).
 *
 * PURE rules for the lot page's **Adjust quantity** box. No server-only or
 * database imports, so the rules run under tsx self-tests and vitest.
 *
 * Before this slice (findings F-05a-3 … F-05a-7, F-05a-13):
 *   - the write was read-then-write with no zero floor and no Sold out flip,
 *     and no audit row (F-05a-3);
 *   - an empty note was accepted, although CCRS withholds an Other / Theft row
 *     without a detail (E13; F-05a-4);
 *   - Destruction and Recall removal were offered, which bypass SOP-15
 *     (F-05a-5); Receive (add) put units on the books CCRS never hears about
 *     (F-05a-7); Theft and Seizure were missing (F-05a-6);
 *   - the history showed no name (F-05a-13).
 *
 * Owner decision D39 (verbatim, 00-OWNER-REQUEST-VERBATIM.md):
 *   "Q-05a-4- remove receive, for destruction and recall, how should it work
 *    on the lot detail page when using the destructions manager page in the
 *    back office? Should the destructions page handle marking those fields
 *    automatically? Add theft and seizure."
 */
import { mapAdjustmentReason, type CcrsAdjustmentReason } from "@/lib/compliance/ccrs-inventory-adjustment-core";
import { adjustmentDetailRequired } from "@/lib/compliance/ccrs-preflight-core";

/** The reasons the lot page offers (D39: no Receive, Destruction, Recall removal; Theft + Seizure added). */
export const MANUAL_ADJUSTMENT_REASONS = [
  "shrink",
  "damage",
  "sample",
  "employee_sample",
  "count",
  "theft",
  "seizure",
  "other",
] as const;
export type ManualAdjustmentReason = (typeof MANUAL_ADJUSTMENT_REASONS)[number];

export const MANUAL_ADJUSTMENT_REASON_LABELS: Record<ManualAdjustmentReason, string> = {
  shrink: "Shrink",
  damage: "Damage",
  sample: "Sample (lab/QA)",
  employee_sample: "Employee sample (WAC 314-55-096)",
  count: "Cycle-count correction",
  theft: "Theft (incident reference required)",
  seizure: "Seizure (incident reference required)",
  other: "Other",
};

/** Reasons that need an incident reference (SOP-20: police or LCB report number). */
export const INCIDENT_REFERENCE_REASONS: readonly ManualAdjustmentReason[] = ["theft", "seizure"];

/** Reasons that were removed from the manual list (D39) and where each now lives. */
export const RETIRED_ADJUSTMENT_REASONS: Readonly<Record<string, string>> = {
  receive:
    "Receive (add) was removed (owner decision D39). Stock arrives through Receiving (SOP-04), so CCRS hears about it. If units were truly missed at receiving, tell the owner.",
  destruction:
    "Destruction was removed from this box (owner decision D39). Use Schedule destruction (Inventory \u2192 Returns & Destruction, SOP-15): it keeps the hold, method, witness and waste record and files the CCRS Destruction adjustment.",
  recall:
    "Recall removal was removed from this box (owner decision D39). A recalled lot is destroyed only through Returns & Destruction (SOP-15) after the LCB is told (SOP-05a \u00a74.10).",
};

/** Audit action written for every manual adjustment. */
export const LOT_ADJUSTED_AUDIT_ACTION = "inventory_lot.adjusted";

/** CCRS AdjustmentDetail is Text 250 (ccrs-inventory-adjustment-core.ts adjustmentDetail). */
export const ADJUSTMENT_NOTE_MAX = 250;
export const INCIDENT_REFERENCE_MAX = 100;

export function isManualAdjustmentReason(v: string): v is ManualAdjustmentReason {
  return (MANUAL_ADJUSTMENT_REASONS as readonly string[]).includes(v);
}

export type ManualAdjustmentInput = {
  reason: string;
  qtyDelta: number;
  note: string | null | undefined;
  incidentReference?: string | null;
  /** The lot as read just before the write (a pre-check; the database is the real floor). */
  onHand: number | null;
  lotStatus: string | null;
};

export type ManualAdjustmentRefusal = { code: string; message: string };

export type ManualAdjustmentDecision =
  | {
      ok: true;
      reason: ManualAdjustmentReason;
      qtyDelta: number;
      /** The note saved on the adjustment and sent to CCRS as the AdjustmentDetail. */
      note: string | null;
      incidentReference: string | null;
      ccrsReason: CcrsAdjustmentReason;
      /** Shown after Saved when the note was left blank on a reason CCRS does not force. */
      noteWarning: string | null;
    }
  | { ok: false; refusals: ManualAdjustmentRefusal[] };

const clean = (v: string | null | undefined): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/**
 * Decide a manual adjustment. PURE. Returns every refusal at once.
 */
export function evaluateManualAdjustment(input: ManualAdjustmentInput): ManualAdjustmentDecision {
  const reason = clean(input.reason).toLowerCase();
  const note = clean(input.note);
  const ref = clean(input.incidentReference);
  const refusals: ManualAdjustmentRefusal[] = [];

  if (RETIRED_ADJUSTMENT_REASONS[reason]) {
    refusals.push({ code: `retired_${reason}`, message: RETIRED_ADJUSTMENT_REASONS[reason] });
  } else if (!isManualAdjustmentReason(reason)) {
    refusals.push({ code: "invalid_reason", message: "Choose a reason from the list." });
  }

  const delta = Number(input.qtyDelta);
  if (!Number.isFinite(delta) || delta === 0) {
    refusals.push({ code: "qty_required", message: "Enter a non-zero quantity (negative removes stock)." });
  }

  const status = clean(input.lotStatus).toLowerCase();
  if (status === "destroyed") {
    refusals.push({
      code: "lot_destroyed",
      message: "This lot is Destroyed. A destruction is final and has been reported to CCRS; its quantity cannot be adjusted.",
    });
  }

  if (Number.isFinite(delta) && delta < 0 && input.onHand != null && Number.isFinite(Number(input.onHand))) {
    const onHand = Number(input.onHand);
    if (onHand + delta < 0) {
      refusals.push({
        code: "below_zero",
        message: `This removes ${Math.abs(delta)} but the lot has ${onHand} on hand. An adjustment can never take a lot below zero. Count again.`,
      });
    }
  }

  const isIncident = isManualAdjustmentReason(reason) && INCIDENT_REFERENCE_REASONS.includes(reason);
  if (isIncident && !ref) {
    refusals.push({
      code: "incident_reference_required",
      message: "Theft and Seizure need the incident reference (the police or LCB report number, SOP-20). Call the owner first.",
    });
  }
  if (ref.length > INCIDENT_REFERENCE_MAX) {
    refusals.push({ code: "incident_reference_too_long", message: `Keep the incident reference under ${INCIDENT_REFERENCE_MAX} characters.` });
  }

  // The note CCRS receives: for Theft / Seizure the reference leads, so the
  // AdjustmentDetail always carries it.
  const composed = isIncident && ref ? (note ? `Incident ${ref}: ${note}` : `Incident ${ref}`) : note;

  const ccrsReason = mapAdjustmentReason(reason);
  if (isManualAdjustmentReason(reason) && adjustmentDetailRequired(ccrsReason) && !composed) {
    refusals.push({
      code: "note_required",
      message: `A note is required for this reason. CCRS reports it as "${ccrsReason}" and withholds the row without a detail (E13). Say what happened, who found it and where the product is now.`,
    });
  }
  if (composed.length > ADJUSTMENT_NOTE_MAX) {
    refusals.push({
      code: "note_too_long",
      message: `Keep the note under ${ADJUSTMENT_NOTE_MAX} characters (the CCRS detail limit), including the incident reference.`,
    });
  }

  if (refusals.length > 0) return { ok: false, refusals };
  return {
    ok: true,
    reason: reason as ManualAdjustmentReason,
    qtyDelta: delta,
    note: composed || null,
    incidentReference: ref || null,
    ccrsReason,
    noteWarning: composed
      ? null
      : "No note was written. SOP-05a \u00a74.6 asks for a note on every adjustment: what happened, who found it, where the product is now.",
  };
}

/**
 * Should this adjustment ask the database for the automatic status flip?
 *
 * apply_lot_delta's auto-status (migration 0129 L144-149) flips BOTH ways:
 * Active at zero -> Sold out, and Sold out above zero -> Active. The second
 * direction would put a lot on sale without the go-live check (G-19), so a
 * manual adjustment asks for the flip ONLY when it removes stock from an
 * Active lot. A Sold out lot that gains units stays Sold out until someone
 * sets Active under Lifecycle status, which runs the go-live check.
 */
export function wantsAutoSoldOut(currentStatus: string, qtyDelta: number): boolean {
  return currentStatus === "active" && qtyDelta < 0;
}

/** The status the pre-0129 fallback writes (Active at zero -> Sold out; anything else unchanged). */
export function fallbackStatusAfter(currentStatus: string, nextQty: number, autoSoldOut: boolean): string {
  if (autoSoldOut && nextQty <= 0 && currentStatus === "active") return "sold_out";
  return currentStatus;
}

/** One row of the Adjustment history with the person's name and the Pacific time. */
export type AdjustmentHistoryRow = {
  id: string;
  qtyDelta: number;
  reasonLabel: string;
  note: string | null;
  who: string;
  at: string;
};

const LEGACY_LABELS: Record<string, string> = {
  receive: "Receive (add) (retired)",
  destruction: "Destruction (retired from this box)",
  recall: "Recall removal (retired from this box)",
  return: "Customer return",
};

export function adjustmentReasonLabel(reason: string): string {
  const r = clean(reason).toLowerCase();
  if (isManualAdjustmentReason(r)) return MANUAL_ADJUSTMENT_REASON_LABELS[r].replace(/ \(incident reference required\)$/, "");
  return LEGACY_LABELS[r] ?? (r || "\u2014");
}

/** Name: staff full name, else "Unknown" (never a guess); system rows say System. */
export function adjustmentActorName(actorId: string | null, names: ReadonlyMap<string, string>): string {
  if (!actorId) return "System";
  return names.get(actorId) ?? "Unknown";
}

export function __runManualAdjustmentCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`FAIL manual-adjustment-core: ${name}`);
    }
  };
  const base = { qtyDelta: -1, note: "Broken jar found at shelf B", onHand: 5, lotStatus: "active" };
  const codes = (d: ManualAdjustmentDecision) => (d.ok ? [] : d.refusals.map((r) => r.code));

  ok(!(MANUAL_ADJUSTMENT_REASONS as readonly string[]).includes("receive"), "receive removed");
  ok(!(MANUAL_ADJUSTMENT_REASONS as readonly string[]).includes("destruction"), "destruction removed");
  ok(!(MANUAL_ADJUSTMENT_REASONS as readonly string[]).includes("recall"), "recall removed");
  ok((MANUAL_ADJUSTMENT_REASONS as readonly string[]).includes("theft") && (MANUAL_ADJUSTMENT_REASONS as readonly string[]).includes("seizure"), "theft + seizure added");
  ok(codes(evaluateManualAdjustment({ ...base, reason: "receive", qtyDelta: 3 })).includes("retired_receive"), "receive refused");
  ok(codes(evaluateManualAdjustment({ ...base, reason: "destruction" })).includes("retired_destruction"), "destruction refused");
  ok(codes(evaluateManualAdjustment({ ...base, reason: "recall" })).includes("retired_recall"), "recall refused");
  ok(evaluateManualAdjustment({ ...base, reason: "damage" }).ok, "damage with note ok");
  ok(codes(evaluateManualAdjustment({ ...base, reason: "damage", qtyDelta: -6 })).includes("below_zero"), "below zero refused");
  ok(evaluateManualAdjustment({ ...base, reason: "damage", qtyDelta: -5 }).ok, "exactly zero allowed");
  ok(codes(evaluateManualAdjustment({ ...base, reason: "other", note: "" })).includes("note_required"), "Other needs a note");
  ok(codes(evaluateManualAdjustment({ ...base, reason: "employee_sample", note: " " })).includes("note_required"), "employee sample needs a note");
  const d1 = evaluateManualAdjustment({ ...base, reason: "shrink", note: "" });
  ok(d1.ok && d1.noteWarning !== null, "shrink without note saves with a warning");
  ok(codes(evaluateManualAdjustment({ ...base, reason: "theft", note: "x" })).includes("incident_reference_required"), "theft needs reference");
  ok(codes(evaluateManualAdjustment({ ...base, reason: "seizure", note: "x" })).includes("incident_reference_required"), "seizure needs reference");
  const t = evaluateManualAdjustment({ ...base, reason: "theft", note: "", incidentReference: "KCSO 26-1234" });
  ok(t.ok && t.note === "Incident KCSO 26-1234" && t.ccrsReason === "Theft", "theft note carries reference, CCRS Theft");
  const s = evaluateManualAdjustment({ ...base, reason: "seizure", incidentReference: "LCB-9" });
  ok(s.ok && s.ccrsReason === "Seizure" && (s.note ?? "").startsWith("Incident LCB-9: "), "seizure maps to Seizure");
  ok(codes(evaluateManualAdjustment({ ...base, reason: "damage", lotStatus: "destroyed" })).includes("lot_destroyed"), "destroyed lot refused");
  ok(codes(evaluateManualAdjustment({ ...base, reason: "damage", qtyDelta: 0 })).includes("qty_required"), "zero qty refused");
  ok(codes(evaluateManualAdjustment({ ...base, reason: "damage", note: "x".repeat(251) })).includes("note_too_long"), "note over 250 refused");
  ok(codes(evaluateManualAdjustment({ ...base, reason: "bogus" })).includes("invalid_reason"), "unknown reason refused");
  ok(wantsAutoSoldOut("active", -1) && !wantsAutoSoldOut("sold_out", -1) && !wantsAutoSoldOut("sold_out", 3) && !wantsAutoSoldOut("active", 2), "auto flip only when removing from Active");
  ok(fallbackStatusAfter("active", 0, true) === "sold_out" && fallbackStatusAfter("sold_out", 2, false) === "sold_out" && fallbackStatusAfter("recalled", 0, false) === "recalled", "fallback never restocks to Active");
  ok(adjustmentActorName(null, new Map()) === "System" && adjustmentActorName("u1", new Map()) === "Unknown", "never guess a name");
  ok(adjustmentReasonLabel("destruction").includes("retired") && adjustmentReasonLabel("theft") === "Theft", "history labels");
  return { passed, failed };
}
