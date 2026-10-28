/**
 * src/lib/inventory/destruction-lot-status-core.ts  (Fix Phase 1.3 — G-28)
 *
 * PURE rules for what a destruction does to the LOT'S STATUS. Before this
 * slice (findings in docs/sop-program/03-FINDINGS-LEDGER.md):
 *   F-05a-17  the destruction form listed only Active lots;
 *   F-05a-18  scheduling wrote Quarantine over Recalled, lifting the
 *             register's recall hold (S1);
 *   F-05a-19  Cancel always set the lot Active, whatever it was before;
 *   F-15-9    Cancel also set Active a lot a customer-return destruction never
 *             touched, any manager could cancel, and no reason was kept;
 *   F-15-11   after a partial destruction the rest of the lot stayed in
 *             Quarantine.
 *
 * The design is SOP-15 Appendix B, G-28 (extended), with owner decision D65
 * (Michael, verbatim: "Let's treat recalls like a transfer back to the vendor
 * for now."): Recalled product is NEVER destroyed by us. So:
 *   - Scheduling lists and accepts Active and Quarantine lots only. A
 *     Recalled lot is refused (it goes back to the vendor, SOP-15 §4.21) and
 *     is never touched; the reason "Recall" is refused for the same reason.
 *   - The event stores the lot's status before scheduling. Only an Active
 *     lot is moved to Quarantine; a Quarantine lot stays Quarantine.
 *   - Cancel is the owner's (SOP-15 §2 rule 3), needs a written reason, and
 *     puts back the stored status — but only while the lot is still in the
 *     Quarantine the destruction put it in, and only when no other open
 *     destruction holds the lot. A customer-return event stored no status
 *     (it never touched the lot), so its Cancel never touches the lot.
 *   - After a PARTIAL completion the same restore rule applies; an emptied
 *     lot becomes Destroyed (unchanged).
 *   - Completing a destruction is refused while the lot is Recalled.
 *
 * "Put back" can only ever mean Quarantine -> Active, and only for a lot that
 * was Active (go-live checked) when it was scheduled. Every other case leaves
 * the lot alone and says why, so a person decides on the lot page (the gated
 * Lifecycle status box, Phase 1.1).
 *
 * No I/O. tsx-testable via __runDestructionLotStatusCoreTests().
 */

/** Lot statuses a destruction may be scheduled for (D65: never Recalled). */
export const DESTROYABLE_LOT_STATUSES = ["active", "quarantine"] as const;
export type DestroyableLotStatus = (typeof DESTROYABLE_LOT_STATUSES)[number];

export const DESTROYABLE_LOT_STATUS_LABELS: Record<DestroyableLotStatus, string> = {
  active: "Active",
  quarantine: "Quarantine",
};

/** Destruction-event statuses that are still open (hold running or ready). */
export const OPEN_DESTRUCTION_STATUSES = ["pending_quarantine", "ready"] as const;

export const DESTRUCTION_CANCEL_REASON_MAX = 500;

/** Audit action for an owner cancel (before/after lot status, reason). */
export const DESTRUCTION_CANCEL_AUDIT_ACTION = "destruction.cancel";
/** Audit action for a refused cancel. */
export const DESTRUCTION_CANCEL_REFUSED_AUDIT_ACTION = "destruction.cancel_refused";

export const RECALL_NEVER_DESTROYED_MESSAGE =
  "Recalled product is never destroyed by us (owner decision D65). It goes back to the vendor: the admin tells the LCB officer, then Log a vendor return with reason Recall (SOP-15 §4.21).";

export function isDestroyableLotStatus(s: string | null | undefined): s is DestroyableLotStatus {
  return s === "active" || s === "quarantine";
}

/** Destruction reasons a person may pick when scheduling (Recall removed, D65). */
export function schedulableDestructionReasons<T extends string>(all: readonly T[]): T[] {
  return all.filter((r) => r !== "recall");
}

// ── Schedule ─────────────────────────────────────────────────────────────────

export type ScheduleRefusalCode = "recall_never_destroyed" | "lot_recalled" | "lot_destroyed" | "lot_sold_out" | "lot_status_unknown";

export type ScheduleDecision =
  | {
      ok: true;
      /** Stored on the event; null = the event does not touch the lot status. */
      previousLotStatus: DestroyableLotStatus | null;
      /** Move the lot Active -> Quarantine (compare-and-set on Active). */
      setQuarantine: boolean;
    }
  | { ok: false; code: ScheduleRefusalCode; message: string };

export function evaluateDestructionSchedule(input: {
  reason: string;
  /** false for a customer-return unit (the rest of the lot stays sellable). */
  touchesLot: boolean;
  /** The lot's status now (ignored when touchesLot is false). */
  lotStatus: string | null;
  /**
   * The stored previous status of the EARLIEST other open destruction on this
   * lot that touched it, if any. A lot already in Quarantine because of that
   * event inherits it, so cancelling either event can never "restore"
   * Quarantine over the status the lot really had.
   */
  openEventPrevious: string | null;
}): ScheduleDecision {
  if (input.reason === "recall") {
    return { ok: false, code: "recall_never_destroyed", message: RECALL_NEVER_DESTROYED_MESSAGE };
  }
  if (!input.touchesLot) return { ok: true, previousLotStatus: null, setQuarantine: false };
  const s = input.lotStatus;
  if (s === "recalled") return { ok: false, code: "lot_recalled", message: RECALL_NEVER_DESTROYED_MESSAGE };
  if (s === "destroyed") {
    return { ok: false, code: "lot_destroyed", message: "This lot is already Destroyed; there is nothing left to destroy." };
  }
  if (s === "sold_out") {
    return { ok: false, code: "lot_sold_out", message: "This lot is Sold out; there is nothing on hand to destroy." };
  }
  if (!isDestroyableLotStatus(s)) {
    return { ok: false, code: "lot_status_unknown", message: "This lot could not be read (or has an unknown status), so nothing was scheduled." };
  }
  const inherited = s === "quarantine" && isDestroyableLotStatus(input.openEventPrevious) ? input.openEventPrevious : null;
  return { ok: true, previousLotStatus: inherited ?? s, setQuarantine: s === "active" };
}

// ── When an event closes (cancel, or a partial completion) ───────────────────

export type LotCloseAction =
  | { action: "restore_active"; why: "restored" }
  | { action: "leave"; why: "untouched" | "was_quarantine" | "other_open_event" | "changed_since" | "unknown_previous" };

/**
 * What happens to the lot when a destruction event closes without emptying
 * it. Only ever Quarantine -> Active (literal, compare-and-set on Quarantine
 * in the store), and only for a lot that was Active when it was scheduled.
 */
export function lotStatusAfterEventCloses(input: {
  /** The event's stored previous status (null = never touched the lot, or legacy). */
  previousLotStatus: string | null;
  /** True when the event touched the lot (new events: previous != null). */
  touchedLot: boolean;
  lotStatus: string | null;
  otherOpenEvents: number;
}): LotCloseAction {
  if (!input.touchedLot) return { action: "leave", why: "untouched" };
  if (!isDestroyableLotStatus(input.previousLotStatus)) return { action: "leave", why: "unknown_previous" };
  if (input.lotStatus !== "quarantine") return { action: "leave", why: "changed_since" };
  if (input.previousLotStatus === "quarantine") return { action: "leave", why: "was_quarantine" };
  if (input.otherOpenEvents > 0) return { action: "leave", why: "other_open_event" };
  return { action: "restore_active", why: "restored" };
}

export function lotCloseMessage(a: LotCloseAction): string {
  switch (a.why) {
    case "restored":
      return "The lot was put back to Active, the status it had before the destruction was scheduled.";
    case "untouched":
      return "The lot status was not changed (this destruction never moved the lot).";
    case "was_quarantine":
      return "The lot stays in Quarantine, the status it had before the destruction was scheduled.";
    case "other_open_event":
      return "The lot stays in Quarantine because another destruction for it is still open.";
    case "changed_since":
      return "The lot status was not changed: someone changed it after the destruction was scheduled.";
    case "unknown_previous":
      return "The lot stays as it is: this destruction was scheduled before the app kept the earlier status. Set the status on the lot page (Lifecycle status) if it should change.";
  }
}

// ── Cancel ───────────────────────────────────────────────────────────────────

export type CancelRefusalCode = "not_owner" | "reason_required" | "reason_too_long" | "already_completed" | "already_cancelled" | "not_found";

export type CancelDecision =
  | { ok: true; reason: string }
  | { ok: false; refusals: { code: CancelRefusalCode; message: string }[] };

export function evaluateDestructionCancel(input: {
  eventStatus: string | null;
  canCancel: boolean;
  reason: string | null | undefined;
}): CancelDecision {
  const refusals: { code: CancelRefusalCode; message: string }[] = [];
  if (input.eventStatus == null) refusals.push({ code: "not_found", message: "Destruction event not found." });
  else if (input.eventStatus === "completed") refusals.push({ code: "already_completed", message: "Completed events cannot be cancelled." });
  else if (input.eventStatus === "cancelled") refusals.push({ code: "already_cancelled", message: "This event was already cancelled." });
  if (!input.canCancel) {
    refusals.push({ code: "not_owner", message: "Only the owner can cancel a scheduled destruction (SOP-15 §2 rule 3)." });
  }
  const reason = (input.reason ?? "").trim();
  if (!reason) refusals.push({ code: "reason_required", message: "Write why the destruction is being cancelled." });
  else if (reason.length > DESTRUCTION_CANCEL_REASON_MAX) {
    refusals.push({ code: "reason_too_long", message: `Keep the reason under ${DESTRUCTION_CANCEL_REASON_MAX} characters.` });
  }
  return refusals.length ? { ok: false, refusals } : { ok: true, reason };
}

// ── Complete ─────────────────────────────────────────────────────────────────

/** Completing is refused while the lot is Recalled (D65), whatever the event's reason. */
export function completionLotRefusal(lotStatus: string | null): string | null {
  return lotStatus === "recalled" ? RECALL_NEVER_DESTROYED_MESSAGE : null;
}

// ── Self-tests ───────────────────────────────────────────────────────────────

export function __runDestructionLotStatusCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const eq = (a: unknown, b: unknown, label: string) => {
    if (JSON.stringify(a) === JSON.stringify(b)) passed++;
    else {
      failed++;
      console.error(`FAIL destruction-lot-status-core: ${label}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
    }
  };
  const sch = (o: Partial<Parameters<typeof evaluateDestructionSchedule>[0]>) =>
    evaluateDestructionSchedule({ reason: "expired", touchesLot: true, lotStatus: "active", openEventPrevious: null, ...o });

  eq(sch({}), { ok: true, previousLotStatus: "active", setQuarantine: true }, "active -> quarantine, stores active");
  eq(sch({ lotStatus: "quarantine" }), { ok: true, previousLotStatus: "quarantine", setQuarantine: false }, "quarantine stays");
  eq(sch({ lotStatus: "quarantine", openEventPrevious: "active" }), { ok: true, previousLotStatus: "active", setQuarantine: false }, "inherits earlier event's active");
  eq(sch({ lotStatus: "active", openEventPrevious: "quarantine" }), { ok: true, previousLotStatus: "active", setQuarantine: true }, "active lot ignores inheritance");
  eq((sch({ lotStatus: "recalled" }) as { code: string }).code, "lot_recalled", "recalled refused (D65)");
  eq((sch({ reason: "recall" }) as { code: string }).code, "recall_never_destroyed", "recall reason refused");
  eq((sch({ reason: "recall", touchesLot: false }) as { code: string }).code, "recall_never_destroyed", "recall reason refused on customer path too");
  eq((sch({ lotStatus: "destroyed" }) as { code: string }).code, "lot_destroyed", "destroyed refused");
  eq((sch({ lotStatus: "sold_out" }) as { code: string }).code, "lot_sold_out", "sold out refused");
  eq((sch({ lotStatus: null }) as { code: string }).code, "lot_status_unknown", "unread lot refused");
  eq(sch({ touchesLot: false, lotStatus: "recalled" }), { ok: true, previousLotStatus: null, setQuarantine: false }, "customer-return event never touches lot");
  eq(schedulableDestructionReasons(["expired", "recall", "other"] as const), ["expired", "other"], "recall not schedulable");

  const close = (o: Partial<Parameters<typeof lotStatusAfterEventCloses>[0]>) =>
    lotStatusAfterEventCloses({ previousLotStatus: "active", touchedLot: true, lotStatus: "quarantine", otherOpenEvents: 0, ...o });
  eq(close({}), { action: "restore_active", why: "restored" }, "restore active");
  eq(close({ previousLotStatus: "quarantine" }).why, "was_quarantine", "was quarantine stays");
  eq(close({ lotStatus: "recalled" }).why, "changed_since", "recalled since: untouched");
  eq(close({ lotStatus: "active" }).why, "changed_since", "set by hand since: untouched");
  eq(close({ otherOpenEvents: 1 }).why, "other_open_event", "another open event keeps quarantine");
  eq(close({ touchedLot: false, previousLotStatus: null }).why, "untouched", "customer-return never touches");
  eq(close({ previousLotStatus: null }).why, "unknown_previous", "legacy event leaves lot");
  eq(close({ previousLotStatus: "recalled" }).why, "unknown_previous", "never restores recalled from an event");
  eq(typeof lotCloseMessage(close({})), "string", "message");

  const can = (o: Partial<Parameters<typeof evaluateDestructionCancel>[0]>) =>
    evaluateDestructionCancel({ eventStatus: "pending_quarantine", canCancel: true, reason: "Vendor will take it back", ...o });
  eq(can({}), { ok: true, reason: "Vendor will take it back" }, "owner with reason");
  eq((can({ canCancel: false }) as { refusals: { code: string }[] }).refusals.map((r) => r.code), ["not_owner"], "manager refused");
  eq((can({ reason: "  " }) as { refusals: { code: string }[] }).refusals.map((r) => r.code), ["reason_required"], "reason required");
  eq((can({ reason: "x".repeat(501) }) as { refusals: { code: string }[] }).refusals.map((r) => r.code), ["reason_too_long"], "reason too long");
  eq((can({ eventStatus: "completed" }) as { refusals: { code: string }[] }).refusals.map((r) => r.code), ["already_completed"], "completed");
  eq((can({ eventStatus: "cancelled" }) as { refusals: { code: string }[] }).refusals.map((r) => r.code), ["already_cancelled"], "cancelled");
  eq((can({ eventStatus: null, canCancel: false, reason: "" }) as { refusals: { code: string }[] }).refusals.length, 3, "all refusals listed");

  eq(completionLotRefusal("recalled"), RECALL_NEVER_DESTROYED_MESSAGE, "complete refused when recalled");
  eq(completionLotRefusal("quarantine"), null, "complete allowed from quarantine");
  eq(completionLotRefusal("active"), null, "complete allowed from active (customer-return)");
  return { passed, failed };
}
