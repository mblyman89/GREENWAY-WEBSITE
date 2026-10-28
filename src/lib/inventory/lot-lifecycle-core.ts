/**
 * src/lib/inventory/lot-lifecycle-core.ts  (Fix Phase 1.1 — G-19 + G-22)
 *
 * PURE rules for a MANUAL lot status change from the lot page's
 * "Lifecycle status" box. Before this slice the box wrote any of five
 * statuses with no check, no reason and no audit row (F-04-2, F-05a-1,
 * F-05a-2). The rules, each pinned to the gap register (05):
 *
 *   G-19 req 1  Setting Active runs the SAME go-live check Finalize runs
 *               (evaluateLotActivation, lot-activation-gate-core.ts) and is
 *               refused with every reason.
 *   G-22 req 2  Destroyed is NOT a manual choice. Destruction only goes
 *               through Returns & Destruction (SOP-15), which sets it itself
 *               when the destruction empties the lot (disposition.ts
 *               completeDestruction).
 *   G-22 req 3  A reason is required on every change.
 *   G-22 req 4  Recalled -> anything else needs `inventory.recall.release`
 *               (owner + admin: the admin is the recall coordinator, D37,
 *               "Releasing a recall hold and notifying the LCB are the
 *               coordinator's job") AND a clearance reference.
 *
 * Also refused, because the alternative is silent damage:
 *   - a change FROM Destroyed (destruction is final; the CCRS Destruction
 *     adjustment has already been filed by SOP-15);
 *   - a "change" to the status the lot already has (nothing to record).
 *
 * Placing a recall hold (-> Recalled) stays open to every inventory.manage
 * login: a hold only protects customers (SOP-05a §2, open question Q-05a-7).
 *
 * No I/O. tsx-testable via __runLotLifecycleCoreTests().
 */
import { evaluateLotActivation, type LotGateFacts, type LotGateReason } from "./lot-activation-gate-core";

/** The statuses a person may pick on the lot page. Destroyed is deliberately absent. */
export const MANUAL_LOT_STATUSES = ["active", "quarantine", "recalled", "sold_out"] as const;
export type ManualLotStatus = (typeof MANUAL_LOT_STATUSES)[number];

export const MANUAL_LOT_STATUS_LABELS: Record<ManualLotStatus, string> = {
  active: "Active",
  quarantine: "Quarantine",
  recalled: "Recalled",
  sold_out: "Sold out",
};

/** Audit action written for every manual status change (who, from, to, when, reason, reference). */
export const LOT_STATUS_AUDIT_ACTION = "inventory_lot.status_changed";
/** Audit action written when a change is refused by these rules. */
export const LOT_STATUS_REFUSED_AUDIT_ACTION = "inventory_lot.status_change_refused";

export const LOT_STATUS_REASON_MAX = 500;
export const LOT_STATUS_REFERENCE_MAX = 200;

export type LifecycleRefusalCode =
  | "invalid_status"
  | "destroyed_not_manual"
  | "from_destroyed"
  | "no_change"
  | "reason_required"
  | "reason_too_long"
  | "recall_release_forbidden"
  | "clearance_reference_required"
  | "reference_too_long"
  | "go_live_check_failed";

export type LifecycleRefusal = { code: LifecycleRefusalCode; message: string };

export type LifecycleChangeInput = {
  /** The lot's current stored status. */
  fromStatus: string;
  /** The status picked on the page (raw form value). */
  toStatus: string;
  /** Required free-text reason. */
  reason: string;
  /** Recall notice / Issues row / COA reference. Required when leaving Recalled. */
  reference?: string | null;
  /** Whether the person holds `inventory.recall.release`. */
  canReleaseRecall: boolean;
  /** The lot's go-live facts; only read when the target is Active. */
  gateFacts: LotGateFacts;
};

export type LifecycleDecision =
  | {
      ok: true;
      from: string;
      to: ManualLotStatus;
      reason: string;
      reference: string | null;
      /** True when this change lifts a recall hold. */
      releasesRecall: boolean;
    }
  | { ok: false; refusals: LifecycleRefusal[]; gateReasons: LotGateReason[] };

function clean(v: string | null | undefined): string {
  return typeof v === "string" ? v.trim() : "";
}

export function isManualLotStatus(v: string): v is ManualLotStatus {
  return (MANUAL_LOT_STATUSES as readonly string[]).includes(v);
}

/**
 * Decide a manual lot status change. PURE. Returns EVERY refusal so the person
 * can fix everything in one pass.
 */
export function evaluateLotLifecycleChange(input: LifecycleChangeInput): LifecycleDecision {
  const from = clean(input.fromStatus).toLowerCase();
  const to = clean(input.toStatus).toLowerCase();
  const reason = clean(input.reason);
  const reference = clean(input.reference);
  const refusals: LifecycleRefusal[] = [];
  let gateReasons: LotGateReason[] = [];

  if (to === "destroyed") {
    refusals.push({
      code: "destroyed_not_manual",
      message:
        "Destroyed cannot be set by hand. Schedule the destruction under Inventory \u2192 Returns & Destruction (SOP-15); it records the destruction, files the CCRS Destruction adjustment and sets Destroyed itself when the lot is empty.",
    });
  } else if (!isManualLotStatus(to)) {
    refusals.push({ code: "invalid_status", message: "Choose Active, Quarantine, Recalled or Sold out." });
  }

  if (from === "destroyed") {
    refusals.push({
      code: "from_destroyed",
      message: "This lot is Destroyed. A destruction is final and has been reported to CCRS; its status cannot be changed.",
    });
  }

  if (from && to && from === to) {
    refusals.push({ code: "no_change", message: "The lot already has that status. Nothing was changed." });
  }

  if (!reason) {
    refusals.push({ code: "reason_required", message: "Write the reason for this status change. It is saved in the status history." });
  } else if (reason.length > LOT_STATUS_REASON_MAX) {
    refusals.push({ code: "reason_too_long", message: `Keep the reason under ${LOT_STATUS_REASON_MAX} characters.` });
  }
  if (reference.length > LOT_STATUS_REFERENCE_MAX) {
    refusals.push({ code: "reference_too_long", message: `Keep the reference under ${LOT_STATUS_REFERENCE_MAX} characters.` });
  }

  const releasesRecall = from === "recalled" && to !== "recalled";
  if (releasesRecall) {
    if (!input.canReleaseRecall) {
      refusals.push({
        code: "recall_release_forbidden",
        message:
          "Only the owner or the admin (recall coordinator) can release a recall hold. Leave the lot Recalled and call the admin.",
      });
    }
    if (!reference) {
      refusals.push({
        code: "clearance_reference_required",
        message:
          "Releasing a recall hold needs the written clearance reference (the recall notice or LCB clearance that names this lot).",
      });
    }
  }

  if (to === "active") {
    const verdict = evaluateLotActivation(input.gateFacts);
    if (!verdict.canActivate) {
      gateReasons = verdict.reasons;
      refusals.push({
        code: "go_live_check_failed",
        message: `This lot fails the go-live check: ${verdict.reasons.map((r) => r.message).join(" ")}`,
      });
    }
  }

  if (refusals.length > 0) return { ok: false, refusals, gateReasons };
  return {
    ok: true,
    from,
    to: to as ManualLotStatus,
    reason,
    reference: reference || null,
    releasesRecall,
  };
}

/** One row of the lot page's Status history (built from audit rows). */
export type StatusHistoryRow = {
  id: string;
  at: string;
  from: string | null;
  to: string | null;
  reason: string | null;
  reference: string | null;
  who: string;
};

type AuditLike = {
  id: string | number;
  created_at: string;
  actor_id: string | null;
  actor_email: string | null;
  before_json: unknown;
  after_json: unknown;
};

function field(obj: unknown, key: string): string | null {
  if (!obj || typeof obj !== "object") return null;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "string" && v.trim() ? v : null;
}

/**
 * Turn `inventory_lot.status_changed` audit rows into history rows, newest
 * first. The name is the staff profile's full name, else the email, else
 * "Unknown" (never a guess).
 */
export function buildStatusHistory(rows: readonly AuditLike[], names: ReadonlyMap<string, string>): StatusHistoryRow[] {
  return [...rows]
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
    .map((r) => ({
      id: String(r.id),
      at: r.created_at,
      from: field(r.before_json, "status"),
      to: field(r.after_json, "status"),
      reason: field(r.after_json, "reason"),
      reference: field(r.after_json, "reference"),
      who: (r.actor_id && names.get(r.actor_id)) || r.actor_email || "Unknown",
    }));
}

/** Pacific wall-clock label, e.g. "Oct 28, 2026, 9:05 AM PDT" (business clock is America/Los_Angeles). */
export function formatPacificDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(d);
}

// ── Self-tests (tsx) ─────────────────────────────────────────────────────

export function __runLotLifecycleCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`FAIL: ${msg}`);
    }
  };
  const clear: LotGateFacts = { id: "L1", label: "Lot", ccrsExternalId: "X1", hasLabResult: true, labPassed: true };
  const dirty: LotGateFacts = { id: "L1", label: "Lot", ccrsExternalId: null, hasLabResult: false };
  const base = { fromStatus: "quarantine", toStatus: "active", reason: "Now clear on Issues", canReleaseRecall: false, gateFacts: clear };
  const codes = (d: LifecycleDecision) => (d.ok ? [] : d.refusals.map((r) => r.code));

  ok(evaluateLotLifecycleChange(base).ok, "clear quarantine -> active with reason passes");
  const g = evaluateLotLifecycleChange({ ...base, gateFacts: dirty });
  ok(!g.ok && codes(g).includes("go_live_check_failed"), "dirty lot -> active refused by go-live check");
  ok(!g.ok && g.gateReasons.length === 2, "both gate reasons surfaced");
  const failedLab = evaluateLotLifecycleChange({ ...base, gateFacts: { ...clear, labPassed: false } });
  ok(!failedLab.ok && codes(failedLab).includes("go_live_check_failed"), "FAILED lab never activates");
  ok(codes(evaluateLotLifecycleChange({ ...base, toStatus: "destroyed" })).includes("destroyed_not_manual"), "destroyed refused");
  ok(codes(evaluateLotLifecycleChange({ ...base, toStatus: "bogus" })).includes("invalid_status"), "unknown status refused");
  ok(codes(evaluateLotLifecycleChange({ ...base, reason: "  " })).includes("reason_required"), "blank reason refused");
  ok(codes(evaluateLotLifecycleChange({ ...base, reason: "x".repeat(501) })).includes("reason_too_long"), "long reason refused");
  ok(codes(evaluateLotLifecycleChange({ ...base, fromStatus: "active", toStatus: "active" })).includes("no_change"), "same status refused");
  ok(codes(evaluateLotLifecycleChange({ ...base, fromStatus: "destroyed", toStatus: "quarantine" })).includes("from_destroyed"), "from destroyed refused");
  // Recall release.
  const rel = { ...base, fromStatus: "recalled", toStatus: "quarantine" };
  const noPerm = evaluateLotLifecycleChange({ ...rel, reference: "LCB-123" });
  ok(codes(noPerm).includes("recall_release_forbidden"), "manager cannot release a recall");
  const noRef = evaluateLotLifecycleChange({ ...rel, canReleaseRecall: true });
  ok(codes(noRef).includes("clearance_reference_required"), "release needs a clearance reference");
  const good = evaluateLotLifecycleChange({ ...rel, canReleaseRecall: true, reference: "Notice 2026-14" });
  ok(good.ok && good.releasesRecall && good.reference === "Notice 2026-14", "coordinator with reference releases");
  const relActiveDirty = evaluateLotLifecycleChange({ ...rel, toStatus: "active", canReleaseRecall: true, reference: "N1", gateFacts: dirty });
  ok(codes(relActiveDirty).includes("go_live_check_failed"), "recalled -> active still runs the go-live check");
  // Placing a hold is open (protects customers).
  const place = evaluateLotLifecycleChange({ ...base, fromStatus: "active", toStatus: "recalled", gateFacts: dirty });
  ok(place.ok && !place.releasesRecall, "manager may place a recall hold; no gate on non-active targets");
  ok(!(MANUAL_LOT_STATUSES as readonly string[]).includes("destroyed"), "destroyed is not a manual choice");
  // History.
  const hist = buildStatusHistory(
    [
      { id: 1, created_at: "2026-10-01T16:00:00Z", actor_id: "u1", actor_email: "a@x", before_json: { status: "quarantine" }, after_json: { status: "active", reason: "clear" } },
      { id: 2, created_at: "2026-10-02T16:00:00Z", actor_id: "u2", actor_email: "b@x", before_json: { status: "active" }, after_json: { status: "recalled", reason: "notice", reference: "R1" } },
      { id: 3, created_at: "2026-10-03T16:00:00Z", actor_id: null, actor_email: null, before_json: null, after_json: null },
    ],
    new Map([["u1", "Michael"]]),
  );
  ok(hist[0].id === "3" && hist[2].id === "1", "history newest first");
  ok(hist[2].who === "Michael" && hist[1].who === "b@x" && hist[0].who === "Unknown", "name, then email, then Unknown");
  ok(hist[1].reference === "R1" && hist[1].from === "active" && hist[1].to === "recalled", "from/to/reference read");
  ok(formatPacificDateTime("2026-07-01T19:05:00Z").includes("12:05") && /P[DS]T/.test(formatPacificDateTime("2026-07-01T19:05:00Z")), "Pacific time label");
  return { passed, failed };
}
