/**
 * intake-disposition-core.ts — PURE logic for CCRS-compliant partial acceptance.
 *
 * No I/O, no `server-only`, no Supabase — so it is unit-testable under tsx.
 *
 * RESEARCH-GROUNDED (docs/ccrs-rejection-and-returns.md): rejecting inbound
 * product = refuse-at-dock. Refused lots never enter our reported inventory, so
 * we file NOTHING with CCRS and NEVER auto-destroy. This module only computes:
 *   - the allowed per-lot dispositions + reason codes,
 *   - the derived manifest status (accepted | rejected | partially_accepted),
 *   - the accepted/rejected lot counts,
 *   - input validation (a rejection MUST carry a reason).
 */

export type LotDisposition = "pending" | "accepted" | "rejected_at_dock";

/** Manifest status may now be partially_accepted in addition to the prior set. */
export type DerivedManifestStatus =
  | "accepted"
  | "rejected"
  | "partially_accepted";

/** Curated reject reasons — the owner's examples plus common receiving cases. */
export const REJECT_REASON_CODES = [
  "short_shipment", // vendor forgot to send it / came up short
  "damaged_in_transit", // broke / crushed / leaked in transit
  "wrong_product", // not what was ordered
  "failed_coa", // failed COA / quality / potency
  "expired", // expired or too short-dated
  "overage", // more than ordered / not on the PO
  "other", // free-text required
] as const;

export type RejectReasonCode = (typeof REJECT_REASON_CODES)[number];

export const REJECT_REASON_LABELS: Record<RejectReasonCode, string> = {
  short_shipment: "Short shipment — vendor forgot it / came up short",
  damaged_in_transit: "Damaged / broke in transit",
  wrong_product: "Wrong product",
  failed_coa: "Failed COA / quality",
  expired: "Expired / short-dated",
  overage: "Overage — more than ordered",
  other: "Other (explain)",
};

export function isRejectReasonCode(v: string): v is RejectReasonCode {
  return (REJECT_REASON_CODES as readonly string[]).includes(v);
}

/** A single lot's decision as submitted by the intake employee. */
export type LotDecision = {
  lotId: string;
  disposition: LotDisposition;
  reasonCode?: string | null;
  reasonText?: string | null;
};

export type NormalizedRejection = {
  reasonCode: RejectReasonCode;
  /** Human-readable reason we persist to inventory_lots.reject_reason. */
  reasonText: string;
};

/**
 * Validate + normalize a rejection reason. Every rejected lot MUST have a reason
 * (guard rail). For code 'other', free text is mandatory.
 */
export function normalizeRejection(
  reasonCode: string | null | undefined,
  reasonText: string | null | undefined,
): { ok: true; value: NormalizedRejection } | { ok: false; error: string } {
  const code = (reasonCode ?? "").trim();
  if (!code) return { ok: false, error: "A reject reason is required." };
  if (!isRejectReasonCode(code)) {
    return { ok: false, error: `Unknown reject reason: ${code}` };
  }
  const text = (reasonText ?? "").trim();
  if (code === "other" && !text) {
    return { ok: false, error: "Please explain the 'Other' reject reason." };
  }
  const label = REJECT_REASON_LABELS[code];
  const finalText = text ? `${label} — ${text}` : label;
  return { ok: true, value: { reasonCode: code, reasonText: finalText } };
}

export type DispositionSummary = {
  total: number;
  accepted: number;
  rejected: number;
  pending: number;
  /** null while any lot is still pending (no final status yet). */
  derivedStatus: DerivedManifestStatus | null;
};

/**
 * Compute manifest rollups from the final per-lot dispositions.
 *   - all accepted  -> 'accepted'
 *   - all rejected  -> 'rejected'
 *   - a mix         -> 'partially_accepted'
 *   - any pending   -> derivedStatus null (decision incomplete)
 */
export function summarizeDispositions(
  dispositions: LotDisposition[],
): DispositionSummary {
  let accepted = 0;
  let rejected = 0;
  let pending = 0;
  for (const d of dispositions) {
    if (d === "accepted") accepted++;
    else if (d === "rejected_at_dock") rejected++;
    else pending++;
  }
  const total = dispositions.length;
  let derivedStatus: DerivedManifestStatus | null = null;
  if (total > 0 && pending === 0) {
    if (accepted > 0 && rejected > 0) derivedStatus = "partially_accepted";
    else if (accepted > 0) derivedStatus = "accepted";
    else derivedStatus = "rejected";
  }
  return { total, accepted, rejected, pending, derivedStatus };
}

/**
 * SLICE 101 — the ONE derivation of a finalized manifest's status, shared by
 * the finalize path and its pre-flight prediction (same inputs → same answer):
 *   - some activated + some refused/held  -> partially_accepted
 *   - only activated                      -> accepted
 *   - only held (dirty lots in quarantine)-> partially_accepted (not a refusal)
 *   - nothing activated or held           -> rejected
 */
export function deriveManifestStatus(
  activated: number,
  rejected: number,
  blockedCount: number,
): DerivedManifestStatus {
  if ((activated > 0 && rejected > 0) || (activated > 0 && blockedCount > 0)) {
    return "partially_accepted";
  }
  if (activated > 0) return "accepted";
  if (blockedCount > 0) return "partially_accepted";
  return "rejected";
}

/**
 * SLICE 101 — the owner's rule: a partial acceptance MUST carry a note
 * explaining why, for the audit trail. Validation is pure so the finalize
 * path can enforce it BEFORE any lot is touched. A note on a non-partial
 * finalize is kept (harmless context), never required. Capped at 2000 chars.
 */
export function normalizePartialNote(
  raw: string | null | undefined,
  willBePartial: boolean,
):
  | { ok: true; note: string | null }
  | { ok: false; error: string } {
  const t = (raw ?? "").trim();
  if (t.length === 0) {
    if (willBePartial) {
      return {
        ok: false,
        error:
          "This intake is partial (some lines refused or held) — a note explaining why is required for the audit trail.",
      };
    }
    return { ok: true, note: null };
  }
  return { ok: true, note: t.slice(0, 2000) };
}

/** Badge tone/label for the intake list + detail. */
export function manifestStatusBadge(status: string): {
  tone: "green" | "gold" | "orange" | "danger" | "neutral";
  label: string;
} {
  switch (status) {
    case "accepted":
      return { tone: "green", label: "Accepted" };
    case "partially_accepted":
      return { tone: "gold", label: "Partially Accepted" };
    case "rejected":
      return { tone: "danger", label: "Rejected" };
    case "received":
      return { tone: "orange", label: "Received" };
    case "in_transit":
      return { tone: "orange", label: "In transit" };
    case "pending":
    default:
      return { tone: "neutral", label: "Pending" };
  }
}

// ---------------------------------------------------------------------------
// Unit tests (pure). Called from a throwaway _zt.ts under tsx during verify.
// ---------------------------------------------------------------------------
export function __runDispositionTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error("FAIL:", msg);
    }
  };

  // summarizeDispositions
  let s = summarizeDispositions(["accepted", "accepted"]);
  ok(s.derivedStatus === "accepted" && s.accepted === 2, "all accepted");
  s = summarizeDispositions(["rejected_at_dock", "rejected_at_dock"]);
  ok(s.derivedStatus === "rejected" && s.rejected === 2, "all rejected");
  s = summarizeDispositions(["accepted", "rejected_at_dock"]);
  ok(s.derivedStatus === "partially_accepted", "mixed -> partial");
  ok(s.accepted === 1 && s.rejected === 1, "mixed counts");
  s = summarizeDispositions(["accepted", "pending"]);
  ok(s.derivedStatus === null, "any pending -> null status");
  ok(s.pending === 1, "pending counted");
  s = summarizeDispositions([]);
  ok(s.derivedStatus === null && s.total === 0, "empty -> null");

  // normalizeRejection
  let r = normalizeRejection("short_shipment", "");
  ok(r.ok === true, "valid coded reason");
  if (r.ok) ok(r.value.reasonText.includes("Short shipment"), "label applied");
  r = normalizeRejection("", "");
  ok(r.ok === false, "empty reason rejected");
  r = normalizeRejection("other", "");
  ok(r.ok === false, "other w/o text rejected");
  r = normalizeRejection("other", "customer damaged sample box");
  ok(r.ok === true, "other w/ text ok");
  if (r.ok) ok(r.value.reasonText.includes("customer damaged"), "other text kept");
  r = normalizeRejection("bogus_code", "x");
  ok(r.ok === false, "unknown code rejected");
  r = normalizeRejection("damaged_in_transit", "crushed pallet");
  ok(r.ok === true && r.value.reasonCode === "damaged_in_transit", "damaged ok");

  // isRejectReasonCode
  ok(isRejectReasonCode("failed_coa"), "failed_coa is a code");
  ok(!isRejectReasonCode("nope"), "nope is not a code");

  // manifestStatusBadge
  ok(manifestStatusBadge("partially_accepted").tone === "gold", "partial gold");
  ok(manifestStatusBadge("rejected").tone === "danger", "rejected danger");
  ok(manifestStatusBadge("accepted").tone === "green", "accepted green");
  ok(manifestStatusBadge("pending").label === "Pending", "pending label");
  ok(
    manifestStatusBadge("partially_accepted").label === "Partially Accepted",
    "partial label distinct from Accepted",
  );

  // SLICE 101 — deriveManifestStatus (shared prediction + outcome)
  ok(deriveManifestStatus(2, 1, 0) === "partially_accepted", "mixed accept/refuse -> partial");
  ok(deriveManifestStatus(2, 0, 1) === "partially_accepted", "accept + held -> partial");
  ok(deriveManifestStatus(3, 0, 0) === "accepted", "all activated -> accepted");
  ok(deriveManifestStatus(0, 0, 2) === "partially_accepted", "only held -> partial (not rejected)");
  ok(deriveManifestStatus(0, 3, 0) === "rejected", "all refused -> rejected");
  ok(deriveManifestStatus(0, 0, 0) === "rejected", "nothing -> rejected (no lots activate)");

  // SLICE 101 — normalizePartialNote (mandatory why-partial for the audit trail)
  let n = normalizePartialNote("", true);
  ok(n.ok === false, "partial without note refused");
  if (!n.ok) ok(/required for the audit trail/.test(n.error), "refusal names the audit trail");
  n = normalizePartialNote("   ", true);
  ok(n.ok === false, "whitespace-only note refused on partial");
  n = normalizePartialNote("2 cases crushed in transit; vendor short-shipped the pre-rolls", true);
  ok(n.ok === true, "real note accepted on partial");
  if (n.ok) ok(n.note === "2 cases crushed in transit; vendor short-shipped the pre-rolls", "note trimmed/kept");
  n = normalizePartialNote(null, false);
  ok(n.ok === true && n.note === null, "clean accept: no note required, none stored");
  n = normalizePartialNote("extra context", false);
  ok(n.ok === true && n.note === "extra context", "optional note kept on clean accept");
  n = normalizePartialNote("x".repeat(3000), true);
  ok(n.ok === true && n.ok && n.note !== null && n.note.length === 2000, "note capped at 2000 chars");

  return { passed, failed };
}
