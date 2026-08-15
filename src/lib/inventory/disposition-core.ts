/**
 * src/lib/inventory/disposition-core.ts  (Task Q)
 *
 * PURE logic for the Returns & Destruction command center. No server-only or
 * DB imports so it can be unit-tested directly. Grounded in
 * docs/RETURNS_DESTRUCTION_COMPLIANCE.md (verified current-rule research):
 *
 *  • Customer returns — WAC 314-55-079(12): open products MAY be returned, but
 *    ONLY in original packaging with the lot/batch/inventory ID fully legible.
 *    CCRS FAQ: delete/update the sale identifier + report the inventory
 *    identifier on an InventoryAdjustment "as a return, with details".
 *  • Destruction — current WAC 314-55-097: render unusable BEFORE leaving the
 *    premises (grind + mix to ≥50% non-cannabis by volume; other methods need
 *    PRIOR LCB approval); keep records of method + final destination
 *    (3-year retention, WAC 314-55-087).
 *  • Recalls — WAC 314-55-225: destruction of recall-affected product is
 *    PROHIBITED until LCB is notified and destruction is coordinated with the
 *    enforcement officer.
 *  • Hold policy — the old 72-hour WSLCB destruction notice was REMOVED from
 *    current rule (WSR 22-14-111). A pre-destruction hold is retained as a
 *    configurable STORE POLICY (default 72h, 0–336h), not asserted as law.
 *
 * Money is MINOR UNITS (cents) everywhere.
 */

// ---------------------------------------------------------------------------
// Hold policy (store policy — see header; NOT a current-rule mandate)
// ---------------------------------------------------------------------------

export const HOLD_HOURS_DEFAULT = 72;
export const HOLD_HOURS_MIN = 0;
export const HOLD_HOURS_MAX = 336; // 14 days

/** Clamp an arbitrary input to the valid hold-policy range. */
export function clampHoldHours(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return HOLD_HOURS_DEFAULT;
  return Math.min(HOLD_HOURS_MAX, Math.max(HOLD_HOURS_MIN, n));
}

/** Earliest allowed completion time for a destruction under the hold policy. */
export function computeEarliestDestroyAt(startISO: string, holdHours: number): string {
  const start = new Date(startISO).getTime();
  return new Date(start + clampHoldHours(holdHours) * 60 * 60 * 1000).toISOString();
}

/** Has the hold elapsed? (No earliest time ⇒ no hold ⇒ elapsed.) */
export function holdElapsed(earliestDestroyAtISO: string | null, nowMs: number): boolean {
  if (!earliestDestroyAtISO) return true;
  return new Date(earliestDestroyAtISO).getTime() <= nowMs;
}

// ---------------------------------------------------------------------------
// Customer returns — WAC 314-55-079(12)
// ---------------------------------------------------------------------------

export const CUSTOMER_RETURN_REASONS = [
  "defective",
  "wrong_item",
  "adverse_reaction",
  "quality",
  "mislabeled",
  "other",
] as const;
export type CustomerReturnReason = (typeof CUSTOMER_RETURN_REASONS)[number];

export type CustomerReturnDisposition = "restock" | "destroy";

export type CustomerReturnDraft = {
  /** Quantity the customer is returning. */
  quantity: number;
  /** Quantity on the ORIGINAL sale line (partial vs full ⇒ Update vs Delete). */
  originalQuantity: number;
  /** WAC 314-55-079(12): product is in its original packaging. */
  originalPackaging: boolean;
  /** WAC 314-55-079(12): lot/batch/inventory ID is fully legible. */
  lotIdLegible: boolean;
  disposition: CustomerReturnDisposition;
  reason: string;
  /** Refund given, MINOR UNITS (cents). */
  refundMinor: number;
  /**
   * OPTIONAL ceiling on the refund, MINOR UNITS (cents). When present, any
   * refund above this is REFUSED. The server derives this from the original
   * sale line (what the customer actually paid for the returned quantity, minus
   * what was already refunded on the line) so a form can never pay out more
   * than was taken in. When omitted (legacy callers), no ceiling is applied.
   */
  maxRefundMinor?: number;
};

export type CustomerReturnValidation =
  | { ok: true; correctionOperation: "Delete" | "Update" }
  | { ok: false; error: string };

/**
 * Validate a customer-return draft against the hard rules. Determines the
 * CCRS Sale correction operation: full-line return ⇒ Delete, partial ⇒ Update.
 */
export function validateCustomerReturn(d: CustomerReturnDraft): CustomerReturnValidation {
  if (!d.originalPackaging) {
    return {
      ok: false,
      error:
        "Cannot accept: product must be in its ORIGINAL packaging (WAC 314-55-079(12)). Refuse the return.",
    };
  }
  if (!d.lotIdLegible) {
    return {
      ok: false,
      error:
        "Cannot accept: the lot/batch/inventory ID on the package must be FULLY LEGIBLE (WAC 314-55-079(12)). Refuse the return.",
    };
  }
  if (!(Number.isFinite(d.quantity) && d.quantity > 0)) {
    return { ok: false, error: "Return quantity must be greater than zero." };
  }
  if (!(Number.isFinite(d.originalQuantity) && d.originalQuantity > 0)) {
    return { ok: false, error: "Original sale quantity is missing or invalid." };
  }
  if (d.quantity > d.originalQuantity) {
    return {
      ok: false,
      error: `Return quantity (${d.quantity}) exceeds the quantity sold on this line (${d.originalQuantity}).`,
    };
  }
  if (!Number.isInteger(d.refundMinor) || d.refundMinor < 0) {
    return { ok: false, error: "Refund must be a non-negative whole number of cents." };
  }
  // F-1: never refund more than the customer actually paid for the returned
  // quantity (less any refund already given on this line). The server supplies
  // the ceiling; a tampered/typo'd form cannot push the payout above it.
  if (d.maxRefundMinor !== undefined && d.refundMinor > d.maxRefundMinor) {
    return {
      ok: false,
      error:
        `Refund exceeds what the customer paid for the returned quantity ` +
        `(max ${(d.maxRefundMinor / 100).toFixed(2)}). Reduce the refund.`,
    };
  }
  if (d.disposition !== "restock" && d.disposition !== "destroy") {
    return { ok: false, error: "Disposition must be restock or destroy." };
  }
  if (!(CUSTOMER_RETURN_REASONS as readonly string[]).includes(d.reason)) {
    return { ok: false, error: "Unknown return reason." };
  }
  return { ok: true, correctionOperation: d.quantity >= d.originalQuantity ? "Delete" : "Update" };
}

/**
 * The CCRS InventoryAdjustment detail for the ADD-BACK. CCRS quantities are
 * never negative, so the direction MUST be stated in the detail — and detail
 * is REQUIRED whenever reason maps to Other. Clamped to 250 chars.
 */
export function buildCustomerReturnAdjustmentNote(opts: {
  quantity: number;
  unit: string | null;
  reason: string;
  disposition: CustomerReturnDisposition;
  saleExternalId: string | null;
  detail?: string | null;
}): string {
  const qty = `${opts.quantity}${opts.unit ? ` ${opts.unit}` : ""}`;
  const parts = [
    `Customer return — ADD ${qty} back to inventory (WAC 314-55-079(12))`,
    `reason: ${opts.reason.replace(/_/g, " ")}`,
    opts.saleExternalId ? `original sale ${opts.saleExternalId}` : "",
    opts.disposition === "destroy" ? "product quarantined for destruction" : "product restocked",
    (opts.detail ?? "").trim(),
  ].filter(Boolean);
  return parts.join("; ").replace(/\s+/g, " ").trim().slice(0, 250);
}

// ---------------------------------------------------------------------------
// Destruction — current WAC 314-55-097
// ---------------------------------------------------------------------------

export const RENDERING_METHODS = [
  "grind_mix_compostable",
  "grind_mix_noncompostable",
  "lcb_approved_other",
] as const;
export type RenderingMethod = (typeof RENDERING_METHODS)[number];

export const RENDERING_METHOD_LABELS: Record<RenderingMethod, string> = {
  grind_mix_compostable: "Grind + mix ≥50% compostable waste (food/yard waste, vegetable grease)",
  grind_mix_noncompostable: "Grind + mix ≥50% non-compostable waste (paper, cardboard, plastic)",
  lcb_approved_other: "Other method (requires PRIOR LCB approval)",
};

/** Example mixing materials, per current WAC 314-55-097. */
export const MIX_MATERIAL_EXAMPLES: Record<Exclude<RenderingMethod, "lcb_approved_other">, string[]> = {
  grind_mix_compostable: ["food waste", "yard waste", "vegetable-based grease or oils"],
  grind_mix_noncompostable: ["paper waste", "cardboard waste", "plastic waste"],
};

export type DestructionCompletionDraft = {
  /** Internal destruction reason (expired | failed_qa | recall | damaged | contaminated | other). */
  reason: string;
  renderingMethod: string;
  /** What the waste was mixed with (required for the grind+mix methods). */
  mixMaterial: string | null;
  /** Operator attests the result is ≥50% non-cannabis by volume. */
  fiftyPercentAttested: boolean;
  witnessedBy: string | null;
  /** WAC 314-55-097 record: where the rendered waste goes. */
  finalDestination: string | null;
  disposalFacility: string | null;
  /** WAC 314-55-225 (recall path): LCB coordination confirmed. */
  lcbCoordinated: boolean;
  lcbOfficer: string | null;
  /** Hold policy. */
  earliestDestroyAt: string | null;
  nowMs: number;
};

export type DestructionValidation = { ok: true } | { ok: false; error: string };

/**
 * Validate completion of a destruction. Enforces (1) the recall LCB-coordination
 * prohibition, (2) the rendering-unusable method rules, (3) the waste-record
 * fields, and (4) the store hold policy.
 */
export function validateDestructionCompletion(d: DestructionCompletionDraft): DestructionValidation {
  if (!holdElapsed(d.earliestDestroyAt, d.nowMs)) {
    const when = new Date(d.earliestDestroyAt as string).toLocaleString();
    return { ok: false, error: `Hold policy not elapsed — earliest destroy at ${when}.` };
  }
  if (d.reason === "recall") {
    // WAC 314-55-225: PROHIBITED from destroying before notifying LCB and
    // coordinating destruction with the enforcement officer.
    if (!d.lcbCoordinated) {
      return {
        ok: false,
        error:
          "RECALL product: destruction is prohibited until LCB has been notified and destruction is coordinated with your enforcement officer (WAC 314-55-225). Confirm coordination first.",
      };
    }
    if (!(d.lcbOfficer ?? "").trim()) {
      return { ok: false, error: "Record the LCB enforcement officer you coordinated with." };
    }
  }
  if (!(RENDERING_METHODS as readonly string[]).includes(d.renderingMethod)) {
    return { ok: false, error: "Choose how the product was rendered unusable (WAC 314-55-097)." };
  }
  if (d.renderingMethod !== "lcb_approved_other") {
    if (!(d.mixMaterial ?? "").trim()) {
      return {
        ok: false,
        error: "Record what the ground cannabis waste was mixed with (WAC 314-55-097).",
      };
    }
    if (!d.fiftyPercentAttested) {
      return {
        ok: false,
        error:
          "Confirm the mixed result is at least 50% non-cannabis waste by volume (WAC 314-55-097).",
      };
    }
  }
  if (!(d.finalDestination ?? "").trim() && !(d.disposalFacility ?? "").trim()) {
    return {
      ok: false,
      error:
        "Record the final destination / disposal facility for the waste — WAC 314-55-097 requires it in your records (kept 3 years).",
    };
  }
  return { ok: true };
}

/** Adjustment note for a completed destruction (250-char clamped downstream). */
export function buildDestructionAdjustmentNote(opts: {
  reason: string;
  detail: string | null;
  renderingMethod: string;
  mixMaterial: string | null;
  finalDestination: string | null;
  disposalFacility: string | null;
}): string {
  const method =
    opts.renderingMethod === "grind_mix_compostable"
      ? `ground + mixed ≥50% compostable (${(opts.mixMaterial ?? "").trim() || "mix"})`
      : opts.renderingMethod === "grind_mix_noncompostable"
        ? `ground + mixed ≥50% non-compostable (${(opts.mixMaterial ?? "").trim() || "mix"})`
        : "LCB pre-approved method";
  const dest = [(opts.finalDestination ?? "").trim(), (opts.disposalFacility ?? "").trim()]
    .filter(Boolean)
    .join(" / ");
  const parts = [
    `Destruction (${opts.reason.replace(/_/g, " ")})`,
    (opts.detail ?? "").trim(),
    `rendered unusable: ${method}`,
    dest ? `final destination: ${dest}` : "",
  ].filter(Boolean);
  return parts.join("; ").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Vendor returns — manifest workflow (WAC 314-55-079(11) / -085)
// ---------------------------------------------------------------------------

export const MANIFEST_STATUSES = [
  "none",
  "requested",
  "submitted",
  "confirmed",
  "picked_up",
] as const;
export type ManifestStatus = (typeof MANIFEST_STATUSES)[number];

export const MANIFEST_STATUS_LABELS: Record<ManifestStatus, string> = {
  none: "No manifest yet",
  requested: "Processor agreed (RMA)",
  submitted: "Manifest submitted in CCRS",
  confirmed: "Manifest confirmed by LCB",
  picked_up: "Picked up / in transit",
};

/** Legal forward transitions (may also stay put). */
export function nextManifestStatuses(current: string): ManifestStatus[] {
  switch (current) {
    case "none":
      return ["requested", "submitted"];
    case "requested":
      return ["submitted"];
    case "submitted":
      return ["confirmed"];
    case "confirmed":
      return ["picked_up"];
    default:
      return [];
  }
}

/**
 * Operator guidance for the vendor-return manifest workflow. Verified against
 * WAC 314-55-085 + LCB/industry practice (see compliance doc §3): manifests
 * must be generated in CCRS (POS PDFs are not valid; contingency manifests
 * were discontinued Nov 2025), submitted 48–72h before pickup, and LCB
 * confirms Mon/Wed/Fri by email.
 */
export const VENDOR_RETURN_MANIFEST_STEPS: readonly string[] = [
  "Get the processor's written acceptance (RMA number) BEFORE anything moves.",
  "Create the transport manifest in the CCRS portal — POS-generated manifests are not valid and contingency manifests were discontinued (Nov 2025).",
  "Submit the manifest 48–72 hours before pickup; LCB confirms manifests Mon/Wed/Fri by email (info@lcb.wa.gov).",
  "Do not release product until the manifest is confirmed. Keep the manifest + RMA with this record for 3 years (WAC 314-55-087).",
];

// ---------------------------------------------------------------------------
// Self-tests (tsx/vitest-runnable — PURE module)
// ---------------------------------------------------------------------------

export function __runDispositionCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      throw new Error("FAIL: " + msg);
    }
  };
  const eq = (a: unknown, b: unknown, msg: string) =>
    ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)})`);

  // Hold policy
  eq(clampHoldHours(72), 72, "clamp 72");
  eq(clampHoldHours(-5), 0, "clamp below min");
  eq(clampHoldHours(9999), HOLD_HOURS_MAX, "clamp above max");
  eq(clampHoldHours("abc"), HOLD_HOURS_DEFAULT, "clamp NaN → default");
  eq(
    computeEarliestDestroyAt("2026-01-01T00:00:00.000Z", 72),
    "2026-01-04T00:00:00.000Z",
    "72h hold math",
  );
  eq(
    computeEarliestDestroyAt("2026-01-01T00:00:00.000Z", 0),
    "2026-01-01T00:00:00.000Z",
    "0h hold ⇒ immediate",
  );
  ok(holdElapsed(null, Date.now()), "no earliest ⇒ elapsed");
  ok(!holdElapsed("2999-01-01T00:00:00Z", Date.now()), "future ⇒ not elapsed");

  // Customer returns
  const base: CustomerReturnDraft = {
    quantity: 1,
    originalQuantity: 2,
    originalPackaging: true,
    lotIdLegible: true,
    disposition: "destroy",
    reason: "defective",
    refundMinor: 1500,
  };
  const v1 = validateCustomerReturn(base);
  ok(v1.ok && v1.correctionOperation === "Update", "partial return ⇒ Update");
  const v2 = validateCustomerReturn({ ...base, quantity: 2 });
  ok(v2.ok && v2.correctionOperation === "Delete", "full return ⇒ Delete");
  ok(!validateCustomerReturn({ ...base, originalPackaging: false }).ok, "no original packaging ⇒ refuse");
  ok(!validateCustomerReturn({ ...base, lotIdLegible: false }).ok, "illegible lot ID ⇒ refuse");
  ok(!validateCustomerReturn({ ...base, quantity: 3 }).ok, "over-return blocked");
  ok(!validateCustomerReturn({ ...base, refundMinor: 10.5 }).ok, "fractional cents blocked");
  ok(!validateCustomerReturn({ ...base, refundMinor: -1 }).ok, "negative refund blocked");
  ok(!validateCustomerReturn({ ...base, reason: "nope" }).ok, "unknown reason blocked");

  // F-1 refund ceiling (maxRefundMinor): overpay blocked, exact + partial allowed.
  // base.refundMinor = 1500.
  ok(
    !validateCustomerReturn({ ...base, maxRefundMinor: 1499 }).ok,
    "refund 1\u00a2 over the ceiling is blocked",
  );
  ok(
    validateCustomerReturn({ ...base, maxRefundMinor: 1500 }).ok,
    "refund exactly at the ceiling is allowed",
  );
  ok(
    validateCustomerReturn({ ...base, refundMinor: 400, maxRefundMinor: 1500 }).ok,
    "partial refund under the ceiling is allowed",
  );
  ok(
    validateCustomerReturn({ ...base, refundMinor: 0, maxRefundMinor: 0 }).ok,
    "zero refund with a zero ceiling (fully refunded line) is allowed",
  );
  ok(
    !validateCustomerReturn({ ...base, refundMinor: 1, maxRefundMinor: 0 }).ok,
    "any refund on a fully-refunded line is blocked",
  );
  // Legacy callers that omit the ceiling keep the old behavior (no cap).
  ok(
    validateCustomerReturn({ ...base, refundMinor: 999999 }).ok,
    "omitted ceiling \u21d2 no cap (legacy)",
  );

  const note = buildCustomerReturnAdjustmentNote({
    quantity: 1,
    unit: "ea",
    reason: "adverse_reaction",
    disposition: "destroy",
    saleExternalId: "GW-1001",
    detail: "customer reported headache",
  });
  ok(note.includes("ADD 1 ea back"), "note states ADD direction");
  ok(note.includes("GW-1001"), "note carries sale id");
  ok(note.length <= 250, "note clamped to CCRS 250");
  ok(note.length > 0, "note never empty (detail REQUIRED for Other)");

  // Destruction completion
  const dBase: DestructionCompletionDraft = {
    reason: "expired",
    renderingMethod: "grind_mix_compostable",
    mixMaterial: "food waste",
    fiftyPercentAttested: true,
    witnessedBy: "A. Manager",
    finalDestination: "Kitsap County transfer station",
    disposalFacility: "Olympic View Transfer Station",
    lcbCoordinated: false,
    lcbOfficer: null,
    earliestDestroyAt: null,
    nowMs: Date.now(),
  };
  ok(validateDestructionCompletion(dBase).ok, "valid completion passes");
  ok(
    !validateDestructionCompletion({ ...dBase, earliestDestroyAt: "2999-01-01T00:00:00Z" }).ok,
    "hold not elapsed blocks",
  );
  ok(
    !validateDestructionCompletion({ ...dBase, renderingMethod: "burn" }).ok,
    "unknown rendering method blocks",
  );
  ok(
    !validateDestructionCompletion({ ...dBase, mixMaterial: " " }).ok,
    "grind+mix requires mix material",
  );
  ok(
    !validateDestructionCompletion({ ...dBase, fiftyPercentAttested: false }).ok,
    "≥50% attestation required for grind+mix",
  );
  ok(
    validateDestructionCompletion({
      ...dBase,
      renderingMethod: "lcb_approved_other",
      mixMaterial: null,
      fiftyPercentAttested: false,
    }).ok,
    "LCB-approved other method skips mix requirements",
  );
  ok(
    !validateDestructionCompletion({ ...dBase, finalDestination: null, disposalFacility: "" }).ok,
    "final destination/facility required (WAC 314-55-097 records)",
  );
  ok(
    !validateDestructionCompletion({ ...dBase, reason: "recall" }).ok,
    "recall without LCB coordination blocked (WAC 314-55-225)",
  );
  ok(
    !validateDestructionCompletion({ ...dBase, reason: "recall", lcbCoordinated: true }).ok,
    "recall coordination needs officer name",
  );
  ok(
    validateDestructionCompletion({
      ...dBase,
      reason: "recall",
      lcbCoordinated: true,
      lcbOfficer: "Officer Smith",
    }).ok,
    "recall with coordination + officer passes",
  );

  const dNote = buildDestructionAdjustmentNote({
    reason: "failed_qa",
    detail: "moldy",
    renderingMethod: "grind_mix_noncompostable",
    mixMaterial: "cardboard",
    finalDestination: "landfill",
    disposalFacility: "Olympic View",
  });
  ok(dNote.includes("non-compostable"), "destruction note names method");
  ok(dNote.includes("final destination"), "destruction note carries destination");

  // Manifest workflow
  eq(nextManifestStatuses("none"), ["requested", "submitted"], "none → requested|submitted");
  eq(nextManifestStatuses("submitted"), ["confirmed"], "submitted → confirmed");
  eq(nextManifestStatuses("picked_up"), [], "picked_up terminal");
  eq(nextManifestStatuses("bogus"), [], "unknown status has no transitions");

  return { passed, failed };
}
