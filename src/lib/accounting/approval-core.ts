// =============================================================================
// approval-core.ts — WHAT HAS TO HAPPEN TO A DRAFT, decided in pure code.
//
// D-67 said every entry this system writes is stranded: a draft that nothing
// approves and nothing posts. This file is the thinking half of the fix. The
// doing half is approval-service.ts; the screen is
// src/app/admin/books/drafts/.
//
// WHY A PURE CORE AT ALL, when the database already enforces every rule.
// Because the SEQUENCE is a decision, and the sequence is where the bug would
// live. Approving and posting are two separate database functions with two
// different rulebooks, and the naive answer — "always approve, then always
// post" — is WRONG in a way that is invisible until an auditor asks. This file
// exists so that decision is written down once, in code that can be read and
// mutation-tested without a database.
//
// THE MEASURED FACTS THIS FILE ENCODES (all read from the migrations, not
// assumed — every line number below was opened and read):
//
//   1. Approving does NOT post. `gl_approve_journal` (0174:735) writes
//      approved_by / approved_at / approval_note and an audit event, and never
//      touches `status`. `gl_post_journal` (0172:668) is a separate function
//      that assigns the gapless number and sets status='posted'. Two calls.
//
//   2. The approval requirement is NOT universal. The BEFORE UPDATE trigger
//      `gl_guard_journal_approval` (0174:805) polices only draft -> posted, and
//      it RETURNS EARLY — no approver needed — for these source kinds:
//         pos_sale, excise, purchase, bank    (0174:817)
//         reversal                            (0174:823)
//      The migration's own reason: an approved, active, in-window template IS
//      the approval, granted in advance by a human, and "requiring a click per
//      POS sale would defeat the automation entirely." A reversal is exempt
//      because blocking an undo "would turn this control into a trap that
//      PRESERVES an error."
//
//   3. Even for a NON-exempt kind, approval is only required AT OR ABOVE the
//      entity's threshold (0174:838: `if v_total < v_pol.threshold_cents then
//      return new`). The seeded threshold is 500000 cents = $5,000 (0174:724).
//
//   4. Self-approval is refused at or above the threshold when the approver is
//      the author (0174:777 in the function, 0174:846 in the trigger), unless
//      allow_self_approval is deliberately switched on with a written reason.
//
// WHY THAT COMBINATION IS DANGEROUS, AND WHAT THIS FILE DOES ABOUT IT.
// Michael is, today, the only person who touches these books. He is the author
// of essentially every manual entry. So for any manual entry of $5,000 or more,
// calling gl_approve_journal AS MICHAEL raises GL_SELF_APPROVAL_REFUSED — and
// that is correct, it is the control working. But a naive "approve then post"
// would ALSO call approve on a $40 POS sale that needs no approval at all, and
// on a reversal that must never be blocked. If Michael happened to be the
// author of those too, the approve call would refuse and the entry would stay
// stranded — the exact defect D-67 describes, reintroduced by the fix.
//
// So: DO NOT APPROVE WHAT DOES NOT NEED APPROVING. This file decides, per
// draft, whether the approve call is required, harmless-but-pointless, or
// actively harmful, and returns one of three plans. It refuses to guess when
// it lacks a fact (standing rule 1).
//
// UNITS: money is INTEGER CENTS everywhere. No floats, ever.
// =============================================================================

/** The source kinds the schema allows (0172:277-280), read, not assumed. */
export const SOURCE_KINDS = [
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

export type SourceKindName = (typeof SOURCE_KINDS)[number];

/**
 * The source kinds `gl_guard_journal_approval` waves through without an
 * approver. Copied from 0174:817 and 0174:823 — if that trigger ever changes,
 * this list is wrong and the test that pins it to the migration text will say
 * so out loud.
 */
export const APPROVAL_EXEMPT_SOURCE_KINDS = [
  "pos_sale",
  "excise",
  "purchase",
  "bank",
  "reversal",
] as const;

export type ApprovalExemptKind = (typeof APPROVAL_EXEMPT_SOURCE_KINDS)[number];

export function isApprovalExempt(sourceKind: string): boolean {
  return (APPROVAL_EXEMPT_SOURCE_KINDS as readonly string[]).includes(sourceKind);
}

/** What we know about a draft, in the units the database keeps it in. */
export type DraftFacts = {
  /** gl_journals.id */
  readonly journalId: string;
  /** gl_journals.status — only 'draft' can be approved or posted. */
  readonly status: string;
  /** gl_journals.source_kind */
  readonly sourceKind: string;
  /** Half the sum of |amount_cents| over the lines: the entry's debit total. */
  readonly totalCents: number;
  /** gl_journals.created_by (auth user id), or null if the row has none. */
  readonly createdBy: string | null;
  /** gl_journals.approved_by, or null when nobody has blessed it yet. */
  readonly approvedBy: string | null;
  /** How many lines the entry has. Fewer than two can never post. */
  readonly lineCount: number;
};

/** The policy in force for the entity that owns the draft. */
export type ApprovalPolicyFacts = {
  /** gl_approval_policy.threshold_cents */
  readonly thresholdCents: number;
  /** gl_approval_policy.allow_self_approval */
  readonly allowSelfApproval: boolean;
};

/** Who is asking, and whether they may act on the books at all. */
export type ActorFacts = {
  /** auth.uid() of the signed-in human, or null when nobody is signed in. */
  readonly actorId: string | null;
  /** True only for the active owner (mirrors is_owner(), migration 0185). */
  readonly isOwner: boolean;
};

export type ApprovalRefusalCode =
  | "GL_FORBIDDEN"
  | "GL_NO_APPROVER_IDENTITY"
  | "GL_ALREADY_POSTED"
  | "GL_TOO_FEW_LINES"
  | "GL_SELF_APPROVAL_REFUSED"
  | "GL_NO_APPROVAL_POLICY";

/**
 * The plan. Exactly one of three shapes, so a caller cannot half-understand it.
 *
 *   approve_then_post — the entry needs a blessing and then a number.
 *   post_only         — the entry is exempt, or below threshold, or already
 *                       blessed. Calling approve would be noise at best.
 *   refuse            — do not touch the database; here is why, in English.
 */
export type ApprovalPlan =
  | {
      readonly ok: true;
      readonly action: "approve_then_post";
      readonly journalId: string;
      readonly reason: string;
    }
  | {
      readonly ok: true;
      readonly action: "post_only";
      readonly journalId: string;
      readonly reason: string;
    }
  | {
      readonly ok: false;
      readonly action: "refuse";
      readonly code: ApprovalRefusalCode;
      readonly message: string;
    };

function refuse(code: ApprovalRefusalCode, message: string): ApprovalPlan {
  return { ok: false, action: "refuse", code, message };
}

/**
 * Decide what to do with one draft.
 *
 * Order matters and is deliberate: identity and permission first (an answer
 * about an entry the asker may not see is itself a leak), then the entry's own
 * state, then the money question. Each refusal is the FIRST true reason, not a
 * summary, so the sentence the owner reads is the sentence that actually
 * stopped it.
 *
 * `policy` may be null, meaning "no policy row exists for this entity". That
 * FAILS CLOSED, exactly as the database does (0174:772). With no policy there
 * is no threshold, and inventing one would be guessing.
 */
export function planApproval(
  draft: DraftFacts,
  policy: ApprovalPolicyFacts | null,
  actor: ActorFacts,
): ApprovalPlan {
  // (1) PERMISSION. The books are the owner's alone (owner decision 2026-08-17,
  // enforced in the database by is_owner(), migration 0185).
  if (!actor.isOwner) {
    return refuse(
      "GL_FORBIDDEN",
      "The books are owner-only. Approving and posting entries is something only you can do.",
    );
  }

  // (2) IDENTITY. gl_approve_journal refuses a null auth.uid() outright, and
  // gl_post_journal writes posted_by = auth.uid(), so an anonymous post would
  // record history nobody can be held to.
  if (actor.actorId === null || actor.actorId.trim() === "") {
    return refuse(
      "GL_NO_APPROVER_IDENTITY",
      "Nobody is signed in, so this could not be attributed to a person. An approval nobody can be held to is not an approval. Sign in and try again.",
    );
  }

  // (3) STATE. Only a draft can be approved or posted.
  if (draft.status !== "draft") {
    return refuse(
      "GL_ALREADY_POSTED",
      `This entry is already ${draft.status}, so there is nothing waiting to be posted. Posted history is never edited — if it is wrong, reverse it.`,
    );
  }

  // (4) DOUBLE ENTRY. gl_post_journal refuses fewer than two lines; saying so
  // here saves a round trip and reads better than a database exception.
  if (draft.lineCount < 2) {
    return refuse(
      "GL_TOO_FEW_LINES",
      "An entry needs at least two lines — double-entry is not optional. This draft cannot post as it stands.",
    );
  }

  // (5) EXEMPT KINDS. The trigger waves these through with no approver at all,
  // so calling gl_approve_journal on them is at best pointless and at worst
  // fatal: for a large machine-written entry that Michael authored, approve
  // would raise GL_SELF_APPROVAL_REFUSED and strand an entry the posting rules
  // were perfectly happy to accept.
  if (isApprovalExempt(draft.sourceKind)) {
    return {
      ok: true,
      action: "post_only",
      journalId: draft.journalId,
      reason:
        draft.sourceKind === "reversal"
          ? "A reversal never needs approval — blocking an undo would trap the error in place. Posting it directly."
          : `A ${draft.sourceKind} entry posts against a template you approved in advance, so it needs no separate sign-off. Posting it directly.`,
    };
  }

  // (6) ALREADY BLESSED. Approving twice would overwrite the first approver's
  // name and timestamp, quietly erasing who actually looked at it.
  if (draft.approvedBy !== null && draft.approvedBy.trim() !== "") {
    return {
      ok: true,
      action: "post_only",
      journalId: draft.journalId,
      reason: "This entry has already been approved. All that is left is to post it.",
    };
  }

  // (7) POLICY. Fail closed when there is none — the same answer the database
  // gives, for the same reason: with no threshold, the safe answer is to stop.
  if (policy === null) {
    return refuse(
      "GL_NO_APPROVAL_POLICY",
      "These books have no approval policy yet, so nothing can be approved or posted until one is set. This is deliberate: with no policy there is no threshold, and the safe answer is to stop rather than let everything through.",
    );
  }

  // (8) BELOW THRESHOLD. The trigger returns early, so no approver is needed.
  // Approving anyway would still work, but it would put a sign-off on the
  // record for an entry that never required one, which misrepresents the
  // control as having been exercised.
  if (draft.totalCents < policy.thresholdCents) {
    return {
      ok: true,
      action: "post_only",
      journalId: draft.journalId,
      reason: `At ${draft.totalCents} cents this is below the ${policy.thresholdCents}-cent threshold for these books, so it needs no second signature. Posting it directly.`,
    };
  }

  // (9) SELF-APPROVAL. At or above the threshold, the author cannot be the
  // approver. We say so BEFORE calling the database, because the useful version
  // of this message names the amount and the threshold and tells the owner what
  // his options actually are.
  const isAuthor = draft.createdBy !== null && draft.createdBy === actor.actorId;
  if (isAuthor && !policy.allowSelfApproval) {
    return refuse(
      "GL_SELF_APPROVAL_REFUSED",
      `You wrote this entry, and at ${draft.totalCents} cents it is at or above the ${policy.thresholdCents}-cent threshold for these books, so it needs a second pair of eyes. Ask someone else to review it. If you genuinely are the only person available, self-approval can be switched on deliberately in the approval policy, but it has to be explained in writing and it stays on the record permanently.`,
    );
  }

  return {
    ok: true,
    action: "approve_then_post",
    journalId: draft.journalId,
    reason: `At ${draft.totalCents} cents this is at or above the ${policy.thresholdCents}-cent threshold, so it needs a signature before it can post. Approving, then posting.`,
  };
}

/**
 * Half the sum of absolute line amounts — the entry's debit total, which is
 * exactly what the database computes (0174:766 and 0174:829, both
 * `coalesce(sum(abs(amount_cents)), 0) / 2`).
 *
 * Integer division, matching PostgreSQL's bigint `/`. For a BALANCED entry the
 * sum of absolute values is always even, so this is exact. For an unbalanced
 * one it may truncate — but an unbalanced entry cannot post anyway, and this
 * mirroring the database is worth more than a "nicer" answer that disagrees
 * with it.
 */
export function debitTotalCents(amounts: readonly number[]): number {
  let sum = 0;
  for (const a of amounts) {
    if (!Number.isSafeInteger(a)) {
      throw new Error(
        `debitTotalCents: ${a} is not a safe integer. Money is integer cents; a float here is a rounding bug waiting to happen.`,
      );
    }
    sum += Math.abs(a);
  }
  return Math.trunc(sum / 2);
}

// =============================================================================
// SELF-TESTS — run by scripts/compliance/run-pure-selftests.ts.
// =============================================================================

function ok(cond: boolean, what: string): void {
  if (!cond) throw new Error(`approval-core self-test FAILED: ${what}`);
}

const OWNER: ActorFacts = { actorId: "u-michael", isOwner: true };
const POLICY: ApprovalPolicyFacts = { thresholdCents: 500000, allowSelfApproval: false };

function draft(over: Partial<DraftFacts> = {}): DraftFacts {
  return {
    journalId: "j-1",
    status: "draft",
    sourceKind: "manual",
    totalCents: 100000,
    createdBy: "u-michael",
    approvedBy: null,
    lineCount: 2,
    ...over,
  };
}

export function __runApprovalCoreTests(): void {
  // Permission comes first, before anything else is even considered.
  const notOwner = planApproval(draft(), POLICY, { actorId: "u-staff", isOwner: false });
  ok(notOwner.ok === false && notOwner.code === "GL_FORBIDDEN", "a non-owner is refused");

  // Identity beats state: an anonymous caller is stopped even on a good draft.
  const anon = planApproval(draft(), POLICY, { actorId: null, isOwner: true });
  ok(
    anon.ok === false && anon.code === "GL_NO_APPROVER_IDENTITY",
    "a signed-out caller is refused",
  );

  // Already posted.
  const posted = planApproval(draft({ status: "posted" }), POLICY, OWNER);
  ok(posted.ok === false && posted.code === "GL_ALREADY_POSTED", "a posted entry is refused");

  // One line is not double entry.
  const oneLine = planApproval(draft({ lineCount: 1 }), POLICY, OWNER);
  ok(oneLine.ok === false && oneLine.code === "GL_TOO_FEW_LINES", "a one-line draft is refused");

  // THE CENTRAL CASE. A large machine-written entry Michael authored must post
  // WITHOUT an approve call, because the trigger exempts its kind. If this
  // returned approve_then_post, the approve call would raise
  // GL_SELF_APPROVAL_REFUSED and strand an entry the posting rules accept.
  for (const kind of APPROVAL_EXEMPT_SOURCE_KINDS) {
    const p = planApproval(draft({ sourceKind: kind, totalCents: 9_000_000 }), POLICY, OWNER);
    ok(p.ok === true && p.action === "post_only", `${kind} posts without an approve call`);
  }

  // A manual entry below the threshold needs no signature.
  const small = planApproval(draft({ totalCents: 499_999 }), POLICY, OWNER);
  ok(small.ok === true && small.action === "post_only", "below threshold posts directly");

  // Exactly AT the threshold is ABOVE it: the database uses `>=`.
  const atThreshold = planApproval(
    draft({ totalCents: 500_000, createdBy: "someone-else" }),
    POLICY,
    OWNER,
  );
  ok(
    atThreshold.ok === true && atThreshold.action === "approve_then_post",
    "exactly at the threshold needs approval",
  );

  // Author == approver at/above threshold is the self-review refusal.
  const self = planApproval(draft({ totalCents: 500_000 }), POLICY, OWNER);
  ok(
    self.ok === false && self.code === "GL_SELF_APPROVAL_REFUSED",
    "self-approval at threshold is refused",
  );

  // ...unless it has been switched on deliberately.
  const allowed = planApproval(draft({ totalCents: 500_000 }), {
    thresholdCents: 500000,
    allowSelfApproval: true,
  }, OWNER);
  ok(
    allowed.ok === true && allowed.action === "approve_then_post",
    "self-approval allowed by policy proceeds",
  );

  // No policy fails closed.
  const noPolicy = planApproval(draft(), null, OWNER);
  ok(
    noPolicy.ok === false && noPolicy.code === "GL_NO_APPROVAL_POLICY",
    "a missing policy fails closed",
  );

  // Already approved: post, do not re-approve and overwrite the approver.
  const blessed = planApproval(
    draft({ totalCents: 900_000, approvedBy: "u-someone" }),
    POLICY,
    OWNER,
  );
  ok(blessed.ok === true && blessed.action === "post_only", "an approved entry only needs posting");

  // The exempt list must match the trigger exactly — no more, no less.
  ok(APPROVAL_EXEMPT_SOURCE_KINDS.length === 5, "five exempt kinds, as in 0174");
  ok(!isApprovalExempt("manual"), "manual is NOT exempt");
  ok(!isApprovalExempt("payroll"), "payroll is NOT exempt");
  ok(!isApprovalExempt("intercompany"), "intercompany is NOT exempt");

  // The debit total mirrors the database's own arithmetic.
  ok(debitTotalCents([1000, -1000]) === 1000, "a balanced pair totals one side");
  ok(debitTotalCents([1000, -600, -400]) === 1000, "a split credit still totals one side");
  ok(debitTotalCents([]) === 0, "an empty entry totals zero");
  let threw = false;
  try {
    debitTotalCents([10.5]);
  } catch {
    threw = true;
  }
  ok(threw, "a non-integer amount is refused, not rounded");

  console.log("approval-core self-tests: all passed");
}
