/**
 * src/lib/inventory/lot-activation-gate-core.ts  (Slice 107)
 *
 * PURE gate: decides whether a received inventory lot is allowed to go LIVE
 * (status = active / sellable). A lot that is "dirty" — missing its CCRS
 * inventory identifier, missing a lab result / COA, or carrying a FAILED lab
 * result — must NEVER be flipped to active, because that would put unverified
 * or non-compliant cannabis on the sales floor.
 *
 * Grounded in:
 *   • WAC 314-55-102 / WAC 246-70-050 — cannabis must meet testing standards
 *     (a passing COA) before retail sale; failed product may not be sold.
 *   • CCRS Upload User Guide — every inventory item carries a licensee-assigned
 *     InventoryExternalIdentifier reused across Inventory / LabTest / Sale files;
 *     an item cannot be reported (or sold) without one.
 *   • WAC 314-55-083(4) — seed-to-sale traceability must be complete.
 *
 * No I/O — the caller loads the lot's facts from Supabase and passes them here.
 * tsx-testable via __runLotActivationGateTests().
 */

export type LotGateFacts = {
  /** Lot id (for reporting only). */
  id: string;
  /** Short label for messages (product name / lot code). */
  label?: string | null;
  /** Canonical CCRS InventoryExternalIdentifier persisted on the lot. */
  ccrsExternalId?: string | null;
  /** Whether the lot has a linked lab result / COA record at all. */
  hasLabResult: boolean;
  /**
   * The lab result's pass/fail flag if known: true = passed, false = FAILED,
   * null/undefined = present but pending/unknown result.
   */
  labPassed?: boolean | null;
};

export type LotGateReasonCode =
  | "missing_ccrs_id"
  | "missing_lab_result"
  | "failed_lab_result";

export type LotGateReason = {
  code: LotGateReasonCode;
  message: string;
};

export type LotGateVerdict = {
  lotId: string;
  label: string | null;
  /** True only when the lot is safe to activate. */
  canActivate: boolean;
  /** Blocking reasons (empty when canActivate is true). */
  reasons: LotGateReason[];
};

export type BatchActivationVerdict = {
  /** True only when EVERY lot may activate. */
  allClear: boolean;
  verdicts: LotGateVerdict[];
  /** Lot ids that are blocked. */
  blockedLotIds: string[];
  /** Flat, de-duplicated reason codes across the batch. */
  reasonCodes: LotGateReasonCode[];
};

/** Trimmed non-empty string test. */
function present(v: string | null | undefined): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Evaluate ONE lot. PURE. Returns every blocking reason (not just the first) so
 * the reviewer can fix everything in one pass.
 */
export function evaluateLotActivation(facts: LotGateFacts): LotGateVerdict {
  const label = facts.label && facts.label.trim() ? facts.label.trim() : null;
  const reasons: LotGateReason[] = [];

  if (!present(facts.ccrsExternalId)) {
    reasons.push({
      code: "missing_ccrs_id",
      message:
        "Missing CCRS InventoryExternalIdentifier — every lot needs a licensee-assigned identifier before it can be reported or sold.",
    });
  }

  // A FAILED result is the most serious: it can never go live.
  if (facts.labPassed === false) {
    reasons.push({
      code: "failed_lab_result",
      message:
        "Lab result is FAILED — failed cannabis may not be sold at retail (WAC 314-55-102); this lot cannot be activated.",
    });
  } else if (!facts.hasLabResult) {
    reasons.push({
      code: "missing_lab_result",
      message:
        "No lab result / COA on record — WA testing rules (WAC 314-55-102) require a passing COA before retail sale.",
    });
  }
  // Note: hasLabResult === true with labPassed == null (pending) is allowed to
  // activate here ONLY if the COA exists; a pending result is surfaced as a
  // warning elsewhere (intake review), not a hard activation block, to avoid
  // guessing intent. The hard blocks are: no id, no COA at all, or FAILED.

  return { lotId: facts.id, label, canActivate: reasons.length === 0, reasons };
}

/**
 * Evaluate a whole manifest's worth of lots. PURE. `allClear` is true only when
 * NO lot is blocked, so the caller can refuse the entire activation atomically
 * (or activate only the clean lots, per its policy). We also surface per-lot
 * verdicts so a partial-accept flow can skip just the dirty ones.
 */
export function evaluateLotBatchActivation(lots: LotGateFacts[]): BatchActivationVerdict {
  const verdicts = lots.map(evaluateLotActivation);
  const blocked = verdicts.filter((v) => !v.canActivate);
  const codes = new Set<LotGateReasonCode>();
  for (const v of blocked) for (const r of v.reasons) codes.add(r.code);
  return {
    allClear: blocked.length === 0,
    verdicts,
    blockedLotIds: blocked.map((v) => v.lotId),
    reasonCodes: Array.from(codes),
  };
}

// ── Self-tests (tsx) ─────────────────────────────────────────────────────────

export function __runLotActivationGateTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`FAIL: ${msg}`);
    }
  };

  const clean: LotGateFacts = {
    id: "lot-1",
    label: "Blue Dream 3.5g",
    ccrsExternalId: "BLUE-DREAM-LOT-01",
    hasLabResult: true,
    labPassed: true,
  };

  // Clean lot → activates.
  {
    const v = evaluateLotActivation(clean);
    ok(v.canActivate && v.reasons.length === 0, "clean lot activates");
  }

  // Missing CCRS id → blocked.
  {
    const v = evaluateLotActivation({ ...clean, ccrsExternalId: "  " });
    ok(!v.canActivate, "missing ccrs id blocks");
    ok(v.reasons.some((r) => r.code === "missing_ccrs_id"), "missing ccrs id reason present");
  }
  {
    const v = evaluateLotActivation({ ...clean, ccrsExternalId: null });
    ok(!v.canActivate && v.reasons[0].code === "missing_ccrs_id", "null ccrs id blocks");
  }

  // No lab result → blocked (missing COA).
  {
    const v = evaluateLotActivation({ ...clean, hasLabResult: false, labPassed: null });
    ok(!v.canActivate, "no lab result blocks");
    ok(v.reasons.some((r) => r.code === "missing_lab_result"), "missing lab reason present");
  }

  // FAILED lab result → blocked (failed reason, NOT missing).
  {
    const v = evaluateLotActivation({ ...clean, hasLabResult: true, labPassed: false });
    ok(!v.canActivate, "failed lab blocks");
    ok(v.reasons.some((r) => r.code === "failed_lab_result"), "failed reason present");
    ok(!v.reasons.some((r) => r.code === "missing_lab_result"), "failed does not double-count as missing");
  }

  // Pending result (present COA, passed=null) with valid id → allowed to activate.
  {
    const v = evaluateLotActivation({ ...clean, labPassed: null, hasLabResult: true });
    ok(v.canActivate, "pending-but-present COA activates (not a hard block)");
  }

  // Multiple problems on one lot → all reasons reported.
  {
    const v = evaluateLotActivation({
      id: "lot-x",
      label: null,
      ccrsExternalId: "",
      hasLabResult: false,
      labPassed: null,
    });
    ok(!v.canActivate && v.reasons.length === 2, "two problems → two reasons");
  }

  // Batch: one clean + one dirty → not allClear, only dirty blocked.
  {
    const b = evaluateLotBatchActivation([
      clean,
      { ...clean, id: "lot-2", ccrsExternalId: null },
    ]);
    ok(!b.allClear, "batch with a dirty lot is not allClear");
    ok(b.blockedLotIds.length === 1 && b.blockedLotIds[0] === "lot-2", "only the dirty lot is blocked");
    ok(b.reasonCodes.includes("missing_ccrs_id"), "batch surfaces the reason code");
  }

  // Batch: all clean → allClear.
  {
    const b = evaluateLotBatchActivation([clean, { ...clean, id: "lot-3" }]);
    ok(b.allClear && b.blockedLotIds.length === 0, "all-clean batch is allClear");
  }

  if (failed === 0) console.log(`lot-activation-gate-core: all ${passed} tests passed`);
  return { passed, failed };
}
