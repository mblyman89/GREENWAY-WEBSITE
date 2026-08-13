/**
 * posting-core.ts — F3: the decision logic behind THE ONE DOOR into the ledger.
 *
 * PURE. No I/O, no database, no Supabase client, no clock. Every function here is
 * a total function of its arguments so it can be swept, attacked and proven in
 * milliseconds. The thin service layer that actually talks to PostgreSQL calls
 * these functions and does what they say.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * F1 built the vault (tables, guards, gl_post_journal). F2 built the chart. But
 * nothing in the application could write a journal at all — the only path into
 * the ledger was hand-typed SQL in the Supabase console, which is precisely the
 * unaudited path that produced the Sage drift. This module decides, for any
 * inbound event: may it post automatically, must a human approve it, or is it
 * refused outright — and it never decides "maybe".
 *
 * THE DIVIDING LINE (owner decision Aug 2026, with pushback — see research file 12 §1)
 * Michael proposed "automate anything not tax related". In a 280E business that
 * category is almost empty: every expense dollar carries a cost_class, and that
 * tag IS the tax return. The line that actually holds is EVIDENCE:
 *
 *   AUTOMATE what is DERIVED from evidence already in the system.
 *   REFUSE to automate what is an ESTIMATE, an ALLOCATION, or a JUDGMENT.
 *
 * A POS sale is derived from a sale that exists. An accrual is an opinion about
 * the future. The first can post itself; the second must never.
 *
 * THE ONE THING DELIBERATELY NOT BUILT AS ASKED
 * Michael asked for tolerances that "loosen up after it has learned our patterns."
 * Built literally, that is the drift mechanism itself: a system that widens its own
 * tolerances based on its own track record is grading its own homework, and every
 * entry it wrongly auto-posted becomes evidence it should auto-post more. So this
 * module MEASURES readiness (see `assessTemplateReadiness`) and reports it in plain
 * English — but only a human can widen a tolerance, on a dated row, with a reason.
 * Confidence is displayed; authority is never self-granted. (Standing rule 14.)
 */

// ---------------------------------------------------------------------------
// 1) Types — mirrored from migration 0172, kept in lockstep by self-tests.
// ---------------------------------------------------------------------------

export type EntityCode = "greenway" | "atm" | "landholding" | "personal";

export type SourceKind =
  | "manual"
  | "opening_balance"
  | "pos_sale"
  | "purchase"
  | "payroll"
  | "excise"
  | "inventory"
  | "bank"
  | "loan"
  | "crypto"
  | "atm"
  | "intercompany"
  | "depreciation"
  | "accrual"
  | "close"
  | "reversal";

/** Every source kind in 0172's CHECK constraint, in order. */
export const SOURCE_KINDS: readonly SourceKind[] = [
  "manual",
  "opening_balance",
  "pos_sale",
  "purchase",
  "payroll",
  "excise",
  "inventory",
  "bank",
  "loan",
  "crypto",
  "atm",
  "intercompany",
  "depreciation",
  "accrual",
  "close",
  "reversal",
] as const;

/**
 * What the door decides to do with an inbound event.
 *   post   — write it and post it in one transaction (no human in the loop)
 *   draft  — write it as a draft; a human must review and post it
 *   refuse — do not write anything at all
 */
export type PostingDisposition = "post" | "draft" | "refuse";

export interface PostingDecision {
  disposition: PostingDisposition;
  /** Machine-readable reason code, e.g. "AUTOPOST_NOT_ELIGIBLE". */
  code: string;
  /** Plain English, written for Michael, not for a developer. */
  reason: string;
}

// ---------------------------------------------------------------------------
// 2) Which source kinds may EVER post without a human
// ---------------------------------------------------------------------------

/**
 * Derived from evidence already recorded in the platform. A machine may post
 * these, and only these, and only through an approved template within tolerance.
 *
 *   pos_sale  — the sale exists in the POS subledger; the entry is arithmetic
 *   excise    — RCW 69.50.535 applied to a sale that already exists
 *   purchase  — only when a PO, a receipt and an invoice already agree (3-way match)
 *   bank      — only a matched, already-classified recurring bill (utilities etc.)
 */
export const AUTOPOSTABLE_SOURCE_KINDS: readonly SourceKind[] = [
  "pos_sale",
  "excise",
  "purchase",
  "bank",
] as const;

/**
 * NEVER automatable, with the reason stated so nobody has to re-derive it later.
 * These are estimates, allocations, judgments, or events with legal weight.
 */
export const NEVER_AUTOPOST_REASONS: Readonly<Record<string, string>> = {
  manual: "A person typed it, so a person reviews it.",
  opening_balance:
    "The opening balance is the foundation of every future number and requires evidence and your grandfather's blessing.",
  accrual: "An accrual is an estimate about the future, not a recorded fact.",
  depreciation: "Depreciation is a schedule and a judgment, not an observed event.",
  close: "Closing a period is a decision, not a transaction.",
  reversal: "Undoing a posted entry always requires a human and a written reason.",
  intercompany:
    "Money moving between your own books is the most drift-prone entry there is, and it is only about 24 entries a year — automation would save minutes and risk the balance sheet.",
  payroll: "Payroll carries the 280E cost-class judgment on every dollar.",
  inventory: "Inventory moves only when goods move, and a person confirms goods moved.",
  loan: "Loan splits between principal and interest are a judgment.",
  crypto: "Crypto cost basis is a judgment with a tax consequence.",
  atm: "ATM cash movements are reconciled against a physical count, by a person.",
};

export function isAutopostableSourceKind(kind: SourceKind): boolean {
  return AUTOPOSTABLE_SOURCE_KINDS.includes(kind);
}

// ---------------------------------------------------------------------------
// 3) Idempotency — the natural key
// ---------------------------------------------------------------------------

/**
 * The same real-world event may be submitted any number of times (a retry, a
 * double-click, a webhook redelivery, a re-run of the 2026 replay) and must
 * produce exactly ONE journal.
 *
 * The key is `entity:source_kind:source_ref` rather than a hash of the content,
 * deliberately: an auditor reading the ledger can see WHICH invoice or WHICH sale
 * a journal came from. A hash is opaque, and opacity is how drift hides.
 *
 * Refuses a blank source_ref: without a stable external id there is nothing to be
 * idempotent ON, and silently generating one would mean every retry creates a new
 * journal — the exact duplicate-posting bug this key exists to prevent.
 */
export function buildIdempotencyKey(
  entityCode: string,
  sourceKind: string,
  sourceRef: string,
): string {
  const e = (entityCode ?? "").trim().toLowerCase();
  const k = (sourceKind ?? "").trim().toLowerCase();
  const r = (sourceRef ?? "").trim();
  if (e === "" || k === "" || r === "") {
    throw new Error(
      "GL_NO_IDEMPOTENCY_KEY: an automatic entry needs an entity, a source kind and a stable source reference. Without one, a retry would post the same money twice.",
    );
  }
  // Colons inside a component would let two different events collide on one key
  // ("a:b" + "c" vs "a" + "b:c"), so they are escaped rather than stripped.
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
  return `${esc(e)}:${esc(k)}:${esc(r)}`;
}

/** Outcome of comparing a resubmitted event against the journal already on file. */
export type IdempotencyOutcome = "fresh" | "duplicate" | "conflict";

export interface ExistingJournalSummary {
  idempotencyKey: string;
  /** Signed cents, positive = debit. Sorted line fingerprint of what was posted. */
  lineFingerprint: string;
}

/**
 * Builds a fingerprint of a journal's economic content. Two submissions of the
 * same event must fingerprint identically; a changed amount must not.
 *
 * Line ORDER is deliberately normalised away (sorted), because the order lines
 * arrive in is an accident of iteration, not economic content. Amount, account
 * and cost class are all included, because a change to any of them is a different
 * entry wearing the same invoice number — which is a real fraud pattern.
 */
export function fingerprintLines(
  lines: ReadonlyArray<{ accountCode: string; amountCents: number; costClass?: string }>,
): string {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error("GL_NO_LINES: cannot fingerprint an entry with no lines.");
  }
  const parts = lines.map((l) => {
    if (!Number.isSafeInteger(l.amountCents)) {
      throw new Error(
        `GL_BAD_AMOUNT: ${String(l.amountCents)} is not a safe integer number of cents.`,
      );
    }
    return `${(l.accountCode ?? "").trim()}|${l.amountCents}|${(l.costClass ?? "none").trim()}`;
  });
  parts.sort();
  return parts.join(";");
}

/**
 * THE DUPLICATE-VS-CONFLICT DECISION.
 *
 * - No existing journal            → "fresh", post it.
 * - Exists, identical content      → "duplicate", return the original, write nothing.
 * - Exists, DIFFERENT content      → "conflict", REFUSE.
 *
 * The third case is the one that matters. The same invoice number arriving with a
 * different amount is either an error or someone editing an invoice after the
 * fact. Silently returning the original would hide it; silently posting the new
 * one would double-count it. Both are drift, so the door refuses and asks for a
 * human. (Standing rule 14: when in doubt, refuse.)
 */
export function classifyIdempotency(
  incomingKey: string,
  incomingFingerprint: string,
  existing: ExistingJournalSummary | null | undefined,
): IdempotencyOutcome {
  if (!existing) return "fresh";
  if (existing.idempotencyKey !== incomingKey) return "fresh";
  return existing.lineFingerprint === incomingFingerprint ? "duplicate" : "conflict";
}

// ---------------------------------------------------------------------------
// 4) Tolerance — the three-way-match gate
// ---------------------------------------------------------------------------

/**
 * A template's tolerance. Both bounds apply and BOTH must pass: an absolute cent
 * floor (so a $0.02 variance on a $12 bill is not blocked) and a percentage
 * ceiling (so a $50,000 variance on a $1,000,000 invoice is not waved through).
 *
 * Percentages are integer MILLI-PERCENT (standing rule 4): 1500 = 1.5%.
 */
export interface Tolerance {
  absCents: number;
  milliPct: number;
}

export const ZERO_TOLERANCE: Tolerance = { absCents: 0, milliPct: 0 };

/**
 * Is `actualCents` within tolerance of `expectedCents`?
 *
 * INTEGER-ONLY ARITHMETIC. `expected * milliPct` overflows IEEE-754's exact range
 * at surprisingly ordinary invoice sizes once multiplied by 100000, and a float
 * rounding error here means a variance is silently accepted. Standing rule 13e
 * forbids float in money paths, so the percentage leg is computed in BigInt and
 * only the comparison result crosses back. (tsconfig targets ES2017 — BigInt
 * literals like 0n are not available, so BigInt(0) is used throughout.)
 */
export function isWithinTolerance(
  expectedCents: number,
  actualCents: number,
  tol: Tolerance,
): boolean {
  if (!Number.isSafeInteger(expectedCents) || !Number.isSafeInteger(actualCents)) {
    throw new Error("GL_BAD_AMOUNT: amounts must be safe integer cents.");
  }
  if (!Number.isSafeInteger(tol.absCents) || tol.absCents < 0) {
    throw new Error("GL_BAD_TOLERANCE: absolute tolerance must be a non-negative integer of cents.");
  }
  if (!Number.isSafeInteger(tol.milliPct) || tol.milliPct < 0) {
    throw new Error("GL_BAD_TOLERANCE: percentage tolerance must be non-negative milli-percent.");
  }

  const diff = BigInt(Math.abs(actualCents - expectedCents));
  if (diff <= BigInt(tol.absCents)) return true;

  // |expected| * milliPct / 100000, floored — the allowance never rounds UP, so a
  // variance one cent over the line is refused rather than generously admitted.
  const allowance =
    (BigInt(Math.abs(expectedCents)) * BigInt(tol.milliPct)) / BigInt(100000);
  return diff <= allowance;
}

// ---------------------------------------------------------------------------
// 5) Templates — pre-approved recurring entries
// ---------------------------------------------------------------------------

export interface PostingTemplate {
  code: string;
  entityCode: EntityCode;
  sourceKind: SourceKind;
  /** false = a human deliberately parked it; it must not fire. */
  isActive: boolean;
  /** Michael approved this template; unapproved templates never auto-post. */
  approvedBy: string | null;
  approvedAt: string | null;
  /** ISO dates bounding when the template may fire. Null end = open-ended. */
  effectiveFrom: string;
  effectiveTo: string | null;
  tolerance: Tolerance;
  /** Hard ceiling: no single automatic entry may exceed this, ever. */
  maxAutoPostCents: number;
}

export interface PostingRequest {
  entityCode: EntityCode;
  sourceKind: SourceKind;
  sourceRef: string;
  journalDate: string;
  /** Total absolute debit value of the entry, in cents. */
  amountCents: number;
  /** What the template/PO said it should be. Null when nothing to match against. */
  expectedCents: number | null;
  templateCode: string | null;
  /** True only when a PO, a goods receipt and an invoice all exist and agree. */
  threeWayMatched?: boolean;
}

function isIsoDate(s: string): boolean {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * THE DECISION. Returns post / draft / refuse and never throws for ordinary bad
 * input — an unexpected exception in a posting path is itself a hazard, so every
 * rejection is a structured decision the caller can log and show to Michael.
 *
 * Order matters: the cheapest, most absolute refusals come first, and anything
 * not positively cleared for automation falls through to `draft`. The default is
 * always "a human looks at it", never "post it".
 */
export function decidePosting(
  req: PostingRequest,
  template: PostingTemplate | null | undefined,
): PostingDecision {
  // --- absolute refusals -------------------------------------------------
  if (!isIsoDate(req.journalDate)) {
    return {
      disposition: "refuse",
      code: "GL_BAD_DATE",
      reason: `"${String(req.journalDate)}" is not a real calendar date.`,
    };
  }
  if (!Number.isSafeInteger(req.amountCents)) {
    return {
      disposition: "refuse",
      code: "GL_BAD_AMOUNT",
      reason: "The amount is not a whole number of cents.",
    };
  }
  if (req.amountCents === 0) {
    return {
      disposition: "refuse",
      code: "GL_ZERO_AMOUNT",
      reason: "An entry for zero moves no money and does not belong in the ledger.",
    };
  }

  // --- never-automatable kinds ------------------------------------------
  if (!isAutopostableSourceKind(req.sourceKind)) {
    const why =
      NEVER_AUTOPOST_REASONS[req.sourceKind] ??
      "This kind of entry always gets a human review.";
    return { disposition: "draft", code: "AUTOPOST_NOT_ELIGIBLE", reason: why };
  }

  // --- a purchase needs its three documents ------------------------------
  if (req.sourceKind === "purchase" && req.threeWayMatched !== true) {
    return {
      disposition: "draft",
      code: "AUTOPOST_NO_THREE_WAY_MATCH",
      reason:
        "A bill only posts itself when the purchase order, the goods receipt and the invoice all agree. Here they do not, so it is waiting for you.",
    };
  }

  // --- template gates ----------------------------------------------------
  if (!req.templateCode || !template) {
    return {
      disposition: "draft",
      code: "AUTOPOST_NO_TEMPLATE",
      reason:
        "Nothing posts automatically without a template you approved in advance. This one has no template, so it is waiting for you.",
    };
  }
  if (template.code !== req.templateCode) {
    return {
      disposition: "refuse",
      code: "AUTOPOST_TEMPLATE_MISMATCH",
      reason: `This entry asked for template "${req.templateCode}" but was handed template "${template.code}".`,
    };
  }
  if (template.entityCode !== req.entityCode) {
    return {
      disposition: "refuse",
      code: "AUTOPOST_WRONG_ENTITY",
      reason: `Template "${template.code}" belongs to the ${template.entityCode} books and cannot post into the ${req.entityCode} books.`,
    };
  }
  if (template.sourceKind !== req.sourceKind) {
    return {
      disposition: "refuse",
      code: "AUTOPOST_WRONG_SOURCE_KIND",
      reason: `Template "${template.code}" is for ${template.sourceKind} entries, not ${req.sourceKind} entries.`,
    };
  }
  if (!template.isActive) {
    return {
      disposition: "draft",
      code: "AUTOPOST_TEMPLATE_INACTIVE",
      reason: `Template "${template.code}" is switched off, so this is waiting for you instead.`,
    };
  }
  if (!template.approvedBy || !template.approvedAt) {
    return {
      disposition: "draft",
      code: "AUTOPOST_TEMPLATE_UNAPPROVED",
      reason: `Template "${template.code}" has never been approved, so it cannot post anything by itself.`,
    };
  }
  if (!isIsoDate(template.effectiveFrom)) {
    return {
      disposition: "refuse",
      code: "AUTOPOST_TEMPLATE_BAD_DATES",
      reason: `Template "${template.code}" has an unreadable start date.`,
    };
  }
  if (req.journalDate < template.effectiveFrom) {
    return {
      disposition: "draft",
      code: "AUTOPOST_TEMPLATE_NOT_YET_EFFECTIVE",
      reason: `Template "${template.code}" does not take effect until ${template.effectiveFrom}.`,
    };
  }
  if (template.effectiveTo !== null) {
    if (!isIsoDate(template.effectiveTo)) {
      return {
        disposition: "refuse",
        code: "AUTOPOST_TEMPLATE_BAD_DATES",
        reason: `Template "${template.code}" has an unreadable end date.`,
      };
    }
    if (req.journalDate > template.effectiveTo) {
      return {
        disposition: "draft",
        code: "AUTOPOST_TEMPLATE_EXPIRED",
        reason: `Template "${template.code}" expired on ${template.effectiveTo}.`,
      };
    }
  }

  // --- hard ceiling ------------------------------------------------------
  if (!Number.isSafeInteger(template.maxAutoPostCents) || template.maxAutoPostCents <= 0) {
    return {
      disposition: "refuse",
      code: "AUTOPOST_BAD_CEILING",
      reason: `Template "${template.code}" has no usable maximum, so nothing may post through it.`,
    };
  }
  if (Math.abs(req.amountCents) > template.maxAutoPostCents) {
    return {
      disposition: "draft",
      code: "AUTOPOST_OVER_LIMIT",
      reason: `This entry is larger than the ceiling you set on template "${template.code}", so it is waiting for you.`,
    };
  }

  // --- tolerance ---------------------------------------------------------
  if (req.expectedCents !== null) {
    if (!Number.isSafeInteger(req.expectedCents)) {
      return {
        disposition: "refuse",
        code: "GL_BAD_AMOUNT",
        reason: "The expected amount is not a whole number of cents.",
      };
    }
    if (!isWithinTolerance(req.expectedCents, req.amountCents, template.tolerance)) {
      return {
        disposition: "draft",
        code: "AUTOPOST_OUT_OF_TOLERANCE",
        reason:
          "The amount does not match what was expected closely enough, so it is waiting for you rather than posting itself.",
      };
    }
  }

  return {
    disposition: "post",
    code: "AUTOPOST_OK",
    reason: `Matched approved template "${template.code}" within tolerance.`,
  };
}

// ---------------------------------------------------------------------------
// 6) Segregation of duties
// ---------------------------------------------------------------------------

/**
 * Above a threshold, the person who prepared an entry may not be the only person
 * who approves it. This is the standard SOX journal control, and it is the reason
 * a single individual cannot move material money unobserved.
 *
 * Michael is the owner of a small business and will often be both parties; the
 * point is not to obstruct him but to make the fact VISIBLE and recorded, so his
 * grandfather (and any examiner) can see exactly where it happened.
 */
export function requiresSecondApprover(
  amountCents: number,
  thresholdCents: number,
): boolean {
  if (!Number.isSafeInteger(amountCents) || !Number.isSafeInteger(thresholdCents)) {
    throw new Error("GL_BAD_AMOUNT: amounts must be safe integer cents.");
  }
  if (thresholdCents < 0) {
    throw new Error("GL_BAD_THRESHOLD: threshold cannot be negative.");
  }
  return Math.abs(amountCents) >= thresholdCents;
}

export function canSelfApprove(
  preparerId: string,
  approverId: string,
  amountCents: number,
  thresholdCents: number,
): boolean {
  if (preparerId !== approverId) return true;
  return !requiresSecondApprover(amountCents, thresholdCents);
}

// ---------------------------------------------------------------------------
// 7) Readiness — measured, reported, never self-applied
// ---------------------------------------------------------------------------

export interface TemplateHistory {
  templateCode: string;
  matchedWithinTolerance: number;
  exceptions: number;
  distinctMonths: number;
}

export interface ReadinessAssessment {
  templateCode: string;
  /** Integer milli-percent, 0..100000. */
  successMilliPct: number;
  eligibleForWidening: boolean;
  recommendation: string;
}

/**
 * Reports whether a template has EARNED a wider tolerance. It does not widen
 * anything. Michael asked for controls that loosen as the system learns; this is
 * that idea with the trigger left in human hands, because a system that widens its
 * own tolerances on the strength of its own record is grading its own homework —
 * every wrongly auto-posted entry becomes evidence it should auto-post more.
 *
 * Bar: at least 50 matches, across at least 6 distinct months, with a success rate
 * of at least 98%. Volume alone is not enough — 50 matches in one week says nothing
 * about a quarterly bill, hence the distinct-month requirement.
 */
export function assessTemplateReadiness(h: TemplateHistory): ReadinessAssessment {
  const matched = Math.max(0, Math.trunc(h.matchedWithinTolerance || 0));
  const exceptions = Math.max(0, Math.trunc(h.exceptions || 0));
  const months = Math.max(0, Math.trunc(h.distinctMonths || 0));
  const total = matched + exceptions;

  // Integer milli-percent, no float division in a number Michael will read.
  const successMilliPct =
    total === 0
      ? 0
      : Number((BigInt(matched) * BigInt(100000)) / BigInt(total));

  const eligible = total >= 50 && months >= 6 && successMilliPct >= 98000;

  let recommendation: string;
  if (total === 0) {
    recommendation = "No history yet. Leave the tolerance where it is.";
  } else if (eligible) {
    recommendation =
      `Matched ${matched} of ${total} times across ${months} months. This template has earned a wider tolerance if you want to grant one — but you have to change it yourself, and the change gets recorded.`;
  } else if (months < 6) {
    recommendation = `Only ${months} month(s) of history. Not enough of a pattern yet.`;
  } else if (successMilliPct < 98000) {
    recommendation = `${exceptions} exception(s) out of ${total}. This template is not reliable enough to relax.`;
  } else {
    recommendation = `Only ${total} entries so far. Not enough history yet.`;
  }

  return { templateCode: h.templateCode, successMilliPct, eligibleForWidening: eligible, recommendation };
}

// ---------------------------------------------------------------------------
// 8) Embedded self-tests (repo convention: __run<Name>CoreTests()).
// ---------------------------------------------------------------------------

function expect(label: string, cond: boolean): void {
  if (!cond) throw new Error(`posting-core self-test FAILED: ${label}`);
}
function eq<T>(actual: T, want: T, label: string): void {
  if (actual !== want) {
    throw new Error(
      `posting-core self-test FAILED: ${label} — expected ${String(want)}, got ${String(actual)}`,
    );
  }
}
function throws(label: string, fn: () => unknown): void {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  if (!threw) throw new Error(`posting-core self-test FAILED: ${label} (expected a refusal)`);
}

const T_OK: PostingTemplate = {
  code: "UTIL-PSE",
  entityCode: "greenway",
  sourceKind: "bank",
  isActive: true,
  approvedBy: "michael",
  approvedAt: "2026-01-15T00:00:00Z",
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  tolerance: { absCents: 500, milliPct: 1000 },
  maxAutoPostCents: 500000,
};

const R_OK: PostingRequest = {
  entityCode: "greenway",
  sourceKind: "bank",
  sourceRef: "PSE-2026-10",
  journalDate: "2026-10-31",
  amountCents: 42350,
  expectedCents: 42350,
  templateCode: "UTIL-PSE",
};

export function __runPostingCoreTests(): void {
  // --- source kinds ------------------------------------------------------
  eq(SOURCE_KINDS.length, 16, "16 source kinds, matching 0172's CHECK");
  expect("pos_sale may auto-post", isAutopostableSourceKind("pos_sale"));
  expect("excise may auto-post", isAutopostableSourceKind("excise"));
  expect("manual may NEVER auto-post", !isAutopostableSourceKind("manual"));
  expect("accrual may NEVER auto-post", !isAutopostableSourceKind("accrual"));
  expect("opening_balance may NEVER auto-post", !isAutopostableSourceKind("opening_balance"));
  expect("intercompany may NEVER auto-post", !isAutopostableSourceKind("intercompany"));
  expect("close may NEVER auto-post", !isAutopostableSourceKind("close"));
  expect("reversal may NEVER auto-post", !isAutopostableSourceKind("reversal"));
  // Every non-autopostable kind must carry a written reason a human can read.
  for (const k of SOURCE_KINDS) {
    if (!isAutopostableSourceKind(k)) {
      expect(`a reason is on file for refusing to automate ${k}`, typeof NEVER_AUTOPOST_REASONS[k] === "string");
    }
  }

  // --- idempotency key ---------------------------------------------------
  eq(buildIdempotencyKey("greenway", "pos_sale", "S-1"), "greenway:pos_sale:S-1", "key shape");
  eq(buildIdempotencyKey(" GREENWAY ", " POS_SALE ", " S-1 "), "greenway:pos_sale:S-1", "key normalises");
  throws("blank source ref is refused", () => buildIdempotencyKey("greenway", "pos_sale", "   "));
  throws("blank entity is refused", () => buildIdempotencyKey("", "pos_sale", "S-1"));
  throws("blank kind is refused", () => buildIdempotencyKey("greenway", "", "S-1"));
  // Two different events must never collide on one key.
  expect(
    "colon in a component cannot forge another key",
    buildIdempotencyKey("greenway", "bank", "a:b") !== buildIdempotencyKey("greenway", "bank:a", "b"),
  );

  // --- fingerprint -------------------------------------------------------
  const l1 = [
    { accountCode: "10100", amountCents: 1000 },
    { accountCode: "50010", amountCents: -1000 },
  ];
  const l2 = [
    { accountCode: "50010", amountCents: -1000 },
    { accountCode: "10100", amountCents: 1000 },
  ];
  eq(fingerprintLines(l1), fingerprintLines(l2), "line order does not change the fingerprint");
  expect(
    "a changed amount DOES change the fingerprint",
    fingerprintLines(l1) !==
      fingerprintLines([
        { accountCode: "10100", amountCents: 1001 },
        { accountCode: "50010", amountCents: -1001 },
      ]),
  );
  expect(
    "a changed account DOES change the fingerprint",
    fingerprintLines(l1) !==
      fingerprintLines([
        { accountCode: "10110", amountCents: 1000 },
        { accountCode: "50010", amountCents: -1000 },
      ]),
  );
  expect(
    "a changed cost class DOES change the fingerprint",
    fingerprintLines([{ accountCode: "60010", amountCents: 1000, costClass: "cogs_direct" }]) !==
      fingerprintLines([{ accountCode: "60010", amountCents: 1000, costClass: "nondeductible_280e" }]),
  );
  throws("empty line list is refused", () => fingerprintLines([]));

  // --- duplicate vs conflict --------------------------------------------
  const key = buildIdempotencyKey("greenway", "bank", "PSE-2026-10");
  const fp = fingerprintLines(l1);
  eq(classifyIdempotency(key, fp, null), "fresh", "nothing on file = fresh");
  eq(
    classifyIdempotency(key, fp, { idempotencyKey: key, lineFingerprint: fp }),
    "duplicate",
    "same key + same content = duplicate",
  );
  eq(
    classifyIdempotency(key, fp, { idempotencyKey: key, lineFingerprint: "different" }),
    "conflict",
    "same key + DIFFERENT content = conflict (the changed-invoice trap)",
  );
  eq(
    classifyIdempotency(key, fp, { idempotencyKey: "other:key:1", lineFingerprint: fp }),
    "fresh",
    "a different key is a different event",
  );

  // --- tolerance ---------------------------------------------------------
  expect("exact match is within tolerance", isWithinTolerance(10000, 10000, ZERO_TOLERANCE));
  expect("zero tolerance refuses one cent", !isWithinTolerance(10000, 10001, ZERO_TOLERANCE));
  expect("absolute floor admits small variance", isWithinTolerance(1200, 1202, { absCents: 5, milliPct: 0 }));
  expect("exactly at the absolute bound passes", isWithinTolerance(1200, 1205, { absCents: 5, milliPct: 0 }));
  expect("one cent past the absolute bound fails", !isWithinTolerance(1200, 1206, { absCents: 5, milliPct: 0 }));
  expect("percentage leg admits 1% of 100000", isWithinTolerance(100000, 101000, { absCents: 0, milliPct: 1000 }));
  expect("one cent past the percentage bound fails", !isWithinTolerance(100000, 101001, { absCents: 0, milliPct: 1000 }));
  expect("tolerance is symmetric (under as well as over)", isWithinTolerance(100000, 99000, { absCents: 0, milliPct: 1000 }));
  // The overflow trap: expected * milliPct exceeds 2^53 here. Float would lie.
  expect(
    "huge amounts stay exact (no float overflow)",
    isWithinTolerance(900000000000, 900000000000, { absCents: 0, milliPct: 100000 }),
  );
  expect(
    "huge amount just outside a 1% band is refused",
    !isWithinTolerance(900000000000, 910000000001, { absCents: 0, milliPct: 1000 }),
  );
  throws("negative absolute tolerance is refused", () =>
    isWithinTolerance(100, 100, { absCents: -1, milliPct: 0 }),
  );
  throws("negative percentage tolerance is refused", () =>
    isWithinTolerance(100, 100, { absCents: 0, milliPct: -1 }),
  );
  throws("non-integer amount is refused", () => isWithinTolerance(1.5, 100, ZERO_TOLERANCE));

  // --- the decision ------------------------------------------------------
  eq(decidePosting(R_OK, T_OK).disposition, "post", "a clean templated match posts");

  eq(
    decidePosting({ ...R_OK, sourceKind: "manual" }, null).disposition,
    "draft",
    "a hand-keyed entry always drafts",
  );
  eq(
    decidePosting({ ...R_OK, sourceKind: "accrual" }, null).code,
    "AUTOPOST_NOT_ELIGIBLE",
    "an accrual is an estimate and always drafts",
  );
  eq(
    decidePosting({ ...R_OK, sourceKind: "intercompany" }, null).code,
    "AUTOPOST_NOT_ELIGIBLE",
    "intercompany always drafts",
  );
  eq(
    decidePosting({ ...R_OK, sourceKind: "opening_balance", journalDate: "2025-12-31" }, null).code,
    "AUTOPOST_NOT_ELIGIBLE",
    "the opening balance never posts itself",
  );

  eq(decidePosting({ ...R_OK, templateCode: null }, null).code, "AUTOPOST_NO_TEMPLATE", "no template = draft");
  eq(
    decidePosting(R_OK, { ...T_OK, isActive: false }).code,
    "AUTOPOST_TEMPLATE_INACTIVE",
    "a switched-off template does not fire",
  );
  eq(
    decidePosting(R_OK, { ...T_OK, approvedBy: null, approvedAt: null }).code,
    "AUTOPOST_TEMPLATE_UNAPPROVED",
    "an unapproved template does not fire",
  );
  eq(
    decidePosting(R_OK, { ...T_OK, effectiveTo: "2026-06-30" }).code,
    "AUTOPOST_TEMPLATE_EXPIRED",
    "an expired template does not fire",
  );
  eq(
    decidePosting({ ...R_OK, journalDate: "2026-01-01" }, { ...T_OK, effectiveFrom: "2026-02-01" }).code,
    "AUTOPOST_TEMPLATE_NOT_YET_EFFECTIVE",
    "a future template does not fire yet",
  );
  eq(
    decidePosting(R_OK, { ...T_OK, entityCode: "atm" }).code,
    "AUTOPOST_WRONG_ENTITY",
    "a template cannot post into another entity's books",
  );
  eq(
    decidePosting(R_OK, { ...T_OK, entityCode: "atm" }).disposition,
    "refuse",
    "wrong entity is a refusal, not a draft",
  );
  eq(
    decidePosting(R_OK, { ...T_OK, sourceKind: "purchase" }).code,
    "AUTOPOST_WRONG_SOURCE_KIND",
    "a template cannot be reused for another source kind",
  );
  eq(
    decidePosting(R_OK, { ...T_OK, code: "OTHER" }).code,
    "AUTOPOST_TEMPLATE_MISMATCH",
    "the template handed over must be the one asked for",
  );
  eq(
    decidePosting({ ...R_OK, amountCents: 500001 }, T_OK).code,
    "AUTOPOST_OVER_LIMIT",
    "over the ceiling = draft",
  );
  eq(
    decidePosting({ ...R_OK, amountCents: 500000, expectedCents: 500000 }, T_OK).disposition,
    "post",
    "exactly at the ceiling still posts",
  );
  eq(
    decidePosting({ ...R_OK, amountCents: 99999, expectedCents: 42350 }, T_OK).code,
    "AUTOPOST_OUT_OF_TOLERANCE",
    "outside tolerance = draft",
  );
  eq(
    decidePosting({ ...R_OK, sourceKind: "purchase", templateCode: "PO-1" }, { ...T_OK, code: "PO-1", sourceKind: "purchase" }).code,
    "AUTOPOST_NO_THREE_WAY_MATCH",
    "a bill without three matching documents drafts",
  );
  eq(
    decidePosting(
      { ...R_OK, sourceKind: "purchase", templateCode: "PO-1", threeWayMatched: true },
      { ...T_OK, code: "PO-1", sourceKind: "purchase" },
    ).disposition,
    "post",
    "a fully matched bill posts",
  );
  eq(decidePosting({ ...R_OK, amountCents: 0 }, T_OK).code, "GL_ZERO_AMOUNT", "zero is refused");
  eq(decidePosting({ ...R_OK, journalDate: "2026-02-30" }, T_OK).code, "GL_BAD_DATE", "Feb 30 is refused");
  eq(decidePosting({ ...R_OK, journalDate: "not-a-date" }, T_OK).code, "GL_BAD_DATE", "garbage date refused");
  eq(decidePosting({ ...R_OK, amountCents: 1.5 }, T_OK).code, "GL_BAD_AMOUNT", "fractional cents refused");
  eq(
    decidePosting(R_OK, { ...T_OK, maxAutoPostCents: 0 }).code,
    "AUTOPOST_BAD_CEILING",
    "a template with no ceiling cannot post",
  );
  // A leap day is a real date and must be accepted (rule 13f).
  eq(
    decidePosting({ ...R_OK, journalDate: "2028-02-29" }, T_OK).disposition,
    "post",
    "a leap day is a real date",
  );
  eq(decidePosting({ ...R_OK, journalDate: "2027-02-29" }, T_OK).code, "GL_BAD_DATE", "Feb 29 in a non-leap year is not");

  // THE DEFAULT. Anything not positively cleared must land on a human's desk,
  // never post. Sweep every source kind with no template at all.
  for (const k of SOURCE_KINDS) {
    const d = decidePosting({ ...R_OK, sourceKind: k, templateCode: null }, null);
    expect(`${k} without a template never posts by itself`, d.disposition !== "post");
  }

  // --- segregation of duties --------------------------------------------
  expect("a big entry needs a second pair of eyes", requiresSecondApprover(100000, 50000));
  expect("exactly at the threshold needs a second approver", requiresSecondApprover(50000, 50000));
  expect("a small entry does not", !requiresSecondApprover(4999, 50000));
  expect("self-approval is fine below the threshold", canSelfApprove("mike", "mike", 100, 50000));
  expect("self-approval is refused above the threshold", !canSelfApprove("mike", "mike", 99999999, 50000));
  expect("a second person may always approve", canSelfApprove("mike", "grandpa", 99999999, 50000));
  expect("sign does not matter to the threshold", requiresSecondApprover(-100000, 50000));

  // --- readiness ---------------------------------------------------------
  const green = assessTemplateReadiness({
    templateCode: "UTIL-PSE",
    matchedWithinTolerance: 60,
    exceptions: 0,
    distinctMonths: 7,
  });
  expect("a long clean record is eligible for widening", green.eligibleForWidening);
  eq(green.successMilliPct, 100000, "60/60 is 100%");
  expect(
    "high volume in too few months is NOT eligible",
    !assessTemplateReadiness({
      templateCode: "X",
      matchedWithinTolerance: 500,
      exceptions: 0,
      distinctMonths: 2,
    }).eligibleForWidening,
  );
  expect(
    "a spotty record is NOT eligible",
    !assessTemplateReadiness({
      templateCode: "X",
      matchedWithinTolerance: 90,
      exceptions: 10,
      distinctMonths: 12,
    }).eligibleForWidening,
  );
  expect(
    "no history is NOT eligible",
    !assessTemplateReadiness({
      templateCode: "X",
      matchedWithinTolerance: 0,
      exceptions: 0,
      distinctMonths: 0,
    }).eligibleForWidening,
  );
  eq(
    assessTemplateReadiness({ templateCode: "X", matchedWithinTolerance: 0, exceptions: 0, distinctMonths: 0 })
      .successMilliPct,
    0,
    "no history scores zero, and does not divide by zero",
  );
}
