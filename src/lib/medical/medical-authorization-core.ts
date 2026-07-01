/**
 * src/lib/medical/medical-authorization-core.ts  (Slices 100 + 101)
 *
 * PURE issuance + validity guardrails for medical recognition cards, grounded in
 * DOH 608-048 (issuance) and RCW 69.51A / WAC 314-55-090 (validity for the tax
 * exemptions). No I/O, no `server-only` — tsx-testable.
 *
 * Slice 100 — validateAuthorizationIssuance: BEFORE a card is created, enforce
 *   the four 608-048 form checks (already gated in tax.canIssueCard) PLUS the
 *   data-integrity rules that were previously NOT checked:
 *     - a Unique Patient Identifier (UPID) is REQUIRED when the card is in the
 *       Medical Cannabis Registry (in_doh_database) — a carded/in-MCR record
 *       without a UPID cannot support the WAC 314-55-090(2) 5-yr excise ledger;
 *     - effective_on ≤ expires_on (no inverted date range);
 *     - the card is NOT already expired at issuance (no back-dated dead card);
 *     - holder type is one of patient | designated_provider.
 *
 * Slice 101 — authorizationValidityAt: a single "is this card valid on date D,
 *   and is it expiring soon?" answer, layered on tax.cardValidity so the exempt-
 *   sale path can never grant a tax exemption on an expired / inactive / not-yet-
 *   effective / not-in-MCR / no-UPID card, and can warn staff before expiry.
 *
 * DRAFTS-ONLY note: this is a guardrail, not automation — it BLOCKS bad issuance
 * and reports precise reasons; a human still makes the call.
 */
import {
  canIssueCard,
  cardValidity,
  type FormChecklist,
  type RecognitionCard,
} from "@/lib/medical/tax";

// ── Slice 100: issuance ─────────────────────────────────────────────────────

export type AuthorizationIssuanceInput = {
  uniquePatientIdentifier: string | null;
  holderType: string; // validated here
  effectiveOn: string | null; // ISO YYYY-MM-DD
  expiresOn: string | null; // ISO YYYY-MM-DD
  inDohDatabase: boolean;
  checklist: FormChecklist;
};

export type IssuanceValidation = {
  ok: boolean;
  errors: string[];
};

const HOLDER_TYPES = new Set(["patient", "designated_provider"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's Pacific-agnostic ISO day; overridable for tests. */
function todayIso(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Validate a proposed card issuance. Returns every violation (not just the
 * first) so the consultant can fix them in one pass. PURE.
 */
export function validateAuthorizationIssuance(
  input: AuthorizationIssuanceInput,
  now: Date = new Date(),
): IssuanceValidation {
  const errors: string[] = [];

  // 1) DOH 608-048 four checks (reuse the single source of truth).
  if (!canIssueCard(input.checklist)) {
    errors.push(
      "All DOH 608-048 form checks (complete/signed, tamper-resistant, identity, embossed seal) must be verified before issuing a card.",
    );
  }

  // 2) Holder type.
  if (!HOLDER_TYPES.has(input.holderType)) {
    errors.push('Holder type must be "patient" or "designated_provider".');
  }

  // 3) UPID required when in the MCR.
  const upid = (input.uniquePatientIdentifier ?? "").trim();
  if (input.inDohDatabase && !upid) {
    errors.push(
      "A Unique Patient Identifier (UPID) is required when the card is entered in the Medical Cannabis Registry (needed for the WAC 314-55-090(2) excise-exempt sales ledger).",
    );
  }

  // 4) Date shape + ordering + not-already-expired.
  const eff = (input.effectiveOn ?? "").trim();
  const exp = (input.expiresOn ?? "").trim();
  if (eff && !ISO_DATE.test(eff)) errors.push("Effective date must be a valid YYYY-MM-DD date.");
  if (exp && !ISO_DATE.test(exp)) errors.push("Expiration date must be a valid YYYY-MM-DD date.");

  if (eff && exp && ISO_DATE.test(eff) && ISO_DATE.test(exp) && eff > exp) {
    errors.push("Effective date cannot be after the expiration date.");
  }

  if (exp && ISO_DATE.test(exp)) {
    const today = todayIso(now);
    if (exp < today) {
      errors.push("Cannot issue a card that is already expired (expiration date is in the past).");
    }
  }

  return { ok: errors.length === 0, errors };
}

// ── Slice 101: validity for exemptions ──────────────────────────────────────

export type AuthorizationValidity = {
  valid: boolean;
  reason: string | null;
  /** True when valid AND within `soonDays` of expiring (a soft warning). */
  expiringSoon: boolean;
  /** Days until expiry (negative if already expired; null if no expiry set). */
  daysUntilExpiry: number | null;
};

/**
 * Is a recognition card valid for tax-exemption purposes on `onDate`, and is it
 * expiring soon? Layers on tax.cardValidity (the exemption source of truth) so
 * an expired / inactive / not-yet-effective / not-in-MCR / no-UPID card is NEVER
 * valid and grants NO exemption. PURE.
 */
export function authorizationValidityAt(
  card: RecognitionCard,
  onDate: Date = new Date(),
  soonDays = 30,
): AuthorizationValidity {
  const base = cardValidity(card, onDate);

  let daysUntilExpiry: number | null = null;
  if (card.expiresOn && ISO_DATE.test(card.expiresOn)) {
    const day = onDate.toISOString().slice(0, 10);
    const expMs = Date.parse(`${card.expiresOn}T00:00:00Z`);
    const dayMs = Date.parse(`${day}T00:00:00Z`);
    daysUntilExpiry = Math.round((expMs - dayMs) / 86_400_000);
  }

  const expiringSoon =
    base.valid && daysUntilExpiry !== null && daysUntilExpiry >= 0 && daysUntilExpiry <= soonDays;

  return {
    valid: base.valid,
    reason: base.reason,
    expiringSoon,
    daysUntilExpiry,
  };
}

// ── Self-tests (tsx) ────────────────────────────────────────────────────────

export function __runMedicalAuthorizationTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL:", msg);
    }
  };

  const goodChecklist: FormChecklist = {
    formCompleteSigned: true,
    tamperResistantVerified: true,
    identityVerified: true,
    embossedSealVerified: true,
  };
  const now = new Date("2026-06-30T12:00:00Z");

  // Fully-valid issuance passes.
  const valid = validateAuthorizationIssuance(
    {
      uniquePatientIdentifier: "UPID-123",
      holderType: "patient",
      effectiveOn: "2026-01-01",
      expiresOn: "2027-01-01",
      inDohDatabase: true,
      checklist: goodChecklist,
    },
    now,
  );
  ok(valid.ok && valid.errors.length === 0, "valid issuance passes");

  // Missing a 608-048 check blocks.
  const noCheck = validateAuthorizationIssuance(
    {
      uniquePatientIdentifier: "UPID-1",
      holderType: "patient",
      effectiveOn: "2026-01-01",
      expiresOn: "2027-01-01",
      inDohDatabase: true,
      checklist: { ...goodChecklist, embossedSealVerified: false },
    },
    now,
  );
  ok(!noCheck.ok, "missing 608-048 check blocks");
  ok(noCheck.errors.some((e) => e.includes("608-048")), "608-048 error present");

  // In-MCR without UPID blocks.
  const noUpid = validateAuthorizationIssuance(
    {
      uniquePatientIdentifier: "",
      holderType: "patient",
      effectiveOn: "2026-01-01",
      expiresOn: "2027-01-01",
      inDohDatabase: true,
      checklist: goodChecklist,
    },
    now,
  );
  ok(!noUpid.ok && noUpid.errors.some((e) => e.includes("UPID")), "in-MCR without UPID blocks");

  // NOT in MCR without UPID is allowed (no excise exemption path anyway).
  const notInMcrNoUpid = validateAuthorizationIssuance(
    {
      uniquePatientIdentifier: "",
      holderType: "patient",
      effectiveOn: "2026-01-01",
      expiresOn: "2027-01-01",
      inDohDatabase: false,
      checklist: goodChecklist,
    },
    now,
  );
  ok(notInMcrNoUpid.ok, "not-in-MCR without UPID allowed");

  // Inverted date range blocks.
  const inverted = validateAuthorizationIssuance(
    {
      uniquePatientIdentifier: "UPID-1",
      holderType: "patient",
      effectiveOn: "2027-01-01",
      expiresOn: "2026-01-01",
      inDohDatabase: true,
      checklist: goodChecklist,
    },
    now,
  );
  ok(!inverted.ok && inverted.errors.some((e) => e.includes("after")), "inverted dates block");

  // Already-expired blocks.
  const expired = validateAuthorizationIssuance(
    {
      uniquePatientIdentifier: "UPID-1",
      holderType: "patient",
      effectiveOn: "2020-01-01",
      expiresOn: "2021-01-01",
      inDohDatabase: true,
      checklist: goodChecklist,
    },
    now,
  );
  ok(!expired.ok && expired.errors.some((e) => e.includes("already expired")), "already-expired blocks");

  // Bad holder type blocks.
  const badHolder = validateAuthorizationIssuance(
    {
      uniquePatientIdentifier: "UPID-1",
      holderType: "caregiver",
      effectiveOn: "2026-01-01",
      expiresOn: "2027-01-01",
      inDohDatabase: true,
      checklist: goodChecklist,
    },
    now,
  );
  ok(!badHolder.ok && badHolder.errors.some((e) => e.includes("Holder type")), "bad holder type blocks");

  // ── Validity (Slice 101) ──
  const card: RecognitionCard = {
    uniquePatientIdentifier: "UPID-123",
    effectiveOn: "2026-01-01",
    expiresOn: "2026-07-15",
    inDohDatabase: true,
    status: "active",
  };
  const v = authorizationValidityAt(card, now, 30); // 2026-06-30, expires 07-15 = 15 days
  ok(v.valid, "active card valid");
  ok(v.daysUntilExpiry === 15, `daysUntilExpiry=15 (got ${v.daysUntilExpiry})`);
  ok(v.expiringSoon, "expiring soon within 30 days");

  const notSoon = authorizationValidityAt({ ...card, expiresOn: "2027-01-01" }, now, 30);
  ok(notSoon.valid && !notSoon.expiringSoon, "not expiring soon");

  const expiredCard = authorizationValidityAt({ ...card, expiresOn: "2020-01-01" }, now);
  ok(!expiredCard.valid && !expiredCard.expiringSoon, "expired card invalid, not 'soon'");
  ok((expiredCard.daysUntilExpiry ?? 0) < 0, "expired daysUntilExpiry negative");

  const notInMcr = authorizationValidityAt({ ...card, inDohDatabase: false }, now);
  ok(!notInMcr.valid, "not-in-MCR card invalid for exemption");

  const noUpidCard = authorizationValidityAt({ ...card, uniquePatientIdentifier: null }, now);
  ok(!noUpidCard.valid, "no-UPID card invalid for exemption");

  if (failed === 0) console.log(`medical-authorization-core: all ${passed} tests passed`);
  return { passed, failed };
}
