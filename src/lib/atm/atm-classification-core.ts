/**
 * src/lib/atm/atm-classification-core.ts   (books-69 step 4)
 *
 * WHAT A DEBIT OUT OF THE ATM ACCOUNT MEANS, ON THE DATE IT HAPPENED.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE PROMISE THIS KEEPS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Michael, verbatim, in the message that started books-69:
 *
 *     "My plan is to switch to paying vendors from the atm account starting on
 *      November 1st. I will begin paying employees via the atm account on
 *      January 1st."
 *
 * and, on the same subject:
 *
 *     "Even after the start of the new year though, I don't know exactly how
 *      the cash flow will work, so we will need a system that allows
 *      flexibility."
 *
 * The books-69 recon report made him a specific promise about those two dates:
 *
 *     "In QuickBooks, a rule has no sense of time. A rule that says 'money
 *      going out of account 6228 is an ATM expense' is true in October and
 *      false in November. ... So every classification rule in your system will
 *      carry a start date and an end date. A transaction gets classified by the
 *      rule that was in force on its own date, never by today's rules. If your
 *      CPA re-runs last March in two years' time, he gets last March's answer."
 *
 * This module is that promise, made mechanical.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE TABLE THAT ALREADY EXISTED, AND WHY IT CANNOT KEEP THE PROMISE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Standing rule 25 says extend, never duplicate — so the first job was to find
 * out whether a classifier already existed. It does. Migration 0173 seeds
 * `public.gl_account_rules`, and it is a good table: `match_kind` /
 * `match_value` / `account_id` / `entity_id` / `cost_class` / `priority`, a
 * `source` of `owner | learned | seed`, and a trigger `gl_guard_rule_target()`
 * that refuses to let a rule aim at a control account "even at 100%
 * confidence". None of that is being replaced.
 *
 * But it has no `effective_from` and no `effective_to`, and it is worse than
 * merely missing them, because of this index:
 *
 *     create unique index gl_account_rules_unique_idx
 *       on public.gl_account_rules (
 *         match_kind, match_value,
 *         coalesce(entity_id, '00000000-...-000000000000'::uuid));
 *
 * One row per (kind, value, entity). So "a debit out of 6228" can exist exactly
 * ONCE. When November 1 arrives and vendor payments start, the new rule cannot
 * sit BESIDE the old one — the index forces it to REPLACE it. And the moment it
 * replaces it, every October transaction re-classifies under the November rule,
 * because there is no date anywhere to stop it.
 *
 * That is precisely the failure the recon promised would not happen, and it is
 * sitting in the schema today waiting for November. The 280E consequence is the
 * reason it matters: the ATM is a separate trade or business under CHAMP, which
 * is what keeps its expenses deductible outside the 280E wall. Misfiling the
 * store's expenses to the ATM entity, or the ATM's to the store, moves real tax
 * money in both directions — and it would happen silently, produced by a rule
 * that was correct on the day it was written.
 *
 * SO THIS MODULE IS THE DATED LAYER, AND IT LIVES IN FRONT OF THAT TABLE, NOT
 * INSTEAD OF IT. Nothing here writes to `gl_account_rules`. A proposal produced
 * here still has to be approved by Michael through the existing suggestion
 * path, and that path still enforces every guard 0173 already wrote. The
 * migration that adds `effective_from` / `effective_to` to `gl_account_rules`
 * and reshapes that unique index is a SCHEMA change, and it is written down as
 * a defect (D-30) rather than smuggled in beside a pure module.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * MIRRORED FROM THE PAYROLL RATE REGISTRY, DELIBERATELY
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `payroll-rate-registry-core.ts` already solved effective dating in this
 * repository, and solved it strictly. Rather than invent a second dialect of
 * the same idea, this module imports its date primitives (`isValidIsoDate`,
 * `addDays`) and copies its three hardest decisions:
 *
 *   1. CONSTRUCTION VALIDATES, LOOKUP DOES NOT. `create()` throws on any
 *      problem in the whole table. A registry that could be invalid at lookup
 *      time forces every caller to handle a case that should have been
 *      impossible three layers earlier.
 *
 *   2. OVERLAPS ARE A HARD ERROR, NOT A WARNING. If two rules cover one day,
 *      the answer depends on which one the search happens to hit first. That is
 *      a bug whose output is a plausible answer, which is the worst kind.
 *
 *   3. THERE IS NO `current()`, NO `latest()`, AND NO DEFAULT. A date with no
 *      rule REFUSES. It does not reach for the nearest rule. This is the whole
 *      point: on 2026-10-15 there IS no vendor-payment rule, and the correct
 *      behaviour is to say so, not to borrow November's.
 *
 * The one place this module deliberately DIVERGES from the payroll registry is
 * gaps. `findRateGaps` reports a gap as a problem, because every day of the
 * year has a PFML rate. Here a gap is NORMAL and expected — there is genuinely
 * no vendor-payment rule before November 1 — so gaps are reported for display
 * but are not construction errors. `findRuleGaps` exists and is exported so a
 * screen can show Michael the uncovered stretches; `create()` does not fail on
 * them. Silently reusing `findRateGaps` here would have made the correct table
 * unbuildable.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE POPULATION, WALKED — THE FIVE DEBITS THAT ARE NOT TRANSFERS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Standing rule 43: walk the population, do not sample it. The Timberland ATM
 * statement (301 rows, 2026-05-01..2026-08-21) contains these DEBIT rows out of
 * 6228, counted exactly:
 *
 *     66  TRANSFER FROM X6228 TO X6048   the sweep          — step 2 owns these
 *      1  TRANSFER FROM X6228 TO X3557   the distribution   — step 2 owns this
 *      3  ACCOUNT ANALYSIS CHARGE        $7.72 / $7.92 / $7.74
 *      1  EFTRANSACT PAYMENT ALLIANCE PPD   $1.85
 *      1  DLY SETTLE MVNT - HG26499 CCD     $100.00  ← as a DEBIT
 *
 * The last five are the reason this module exists. Today `atm-sweep-core` looks
 * at each of them, correctly observes that it is not a transfer, and refuses it
 * with "it is being left alone rather than guessed at." That was the honest
 * answer in step 2. It is no longer good enough, because four of those five
 * rows are ordinary bank charges with an obvious home, and leaving $25.23 of
 * real expense permanently unclassified means the ATM entity's income is
 * overstated by $25.23 — in the one entity whose expenses actually reduce tax.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE $100.00 DEBIT IS NOT A FEE, AND ASSUMING IT WAS WOULD HAVE DOUBLE-COUNTED
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The fifth row is the one that earns the reconnaissance. A `DLY SETTLE MVNT`
 * arriving as a DEBIT looks like a mystery, and the tempting move is to file it
 * with the other odd debits as some kind of charge. That would be wrong, and
 * TRACING it rather than guessing is what showed why:
 *
 *     Funds Movement, settlement day 2026-06-27 (a Saturday):
 *         Transaction   $3,060.00
 *         Surcharge       $107.50
 *         Transaction    −$100.00     ← a reversal, on the settlement report
 *
 *     Timberland bank, Monday 2026-06-29:
 *         Credit  $3,060.00
 *         Credit    $107.50
 *         DEBIT     $100.00           ← the same reversal, at the bank
 *         (plus four more legs belonging to 6/25 and 6/26, which also settled
 *          on the Monday — the weekend batch)
 *
 * It is a card-network reversal for the 6/27 settlement day, and the settlement
 * posting path (step 1) ALREADY accounts for that day's figures including the
 * −$100.00, because `mapFundsMovementCsv` adds negative legs rather than
 * dropping them (D-26). Booking the bank's $100.00 debit as an expense here
 * would record the same $100.00 twice — once as a reduced settlement and once
 * as a cost. So this module classifies it as `already_accounted`, states which
 * settlement day owns it, and proposes NO entry.
 *
 * That is the difference between a rule engine and a guessing engine, and it is
 * only visible because the reversal was chased into the other report instead of
 * being pattern-matched on its description.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * IT DOES NOT INVENT THE NOVEMBER AND JANUARY RULES. Michael gave two dates.
 * He did not give the vendor names, the bank's description text for those
 * payments, the accounts, or — the hard part — whether a vendor payment made by
 * the ATM entity on the store's behalf is an intercompany advance through
 * `36000` or a capital movement. The recon told him that plainly: "That's a
 * judgement call you'll make, on rules dated from November 1st."
 *
 * So the table contains a dated NOTICE for each boundary, not a rule. A debit
 * on 2026-11-15 that matches nothing gets refused WITH the notice attached, so
 * the screen says "this is on or after the date you told me vendor payments
 * would start, and I still need you to tell me how to treat them" instead of
 * either guessing or saying nothing. `RuleNotice` is a separate type from
 * `ClassificationRule` for exactly that reason: a notice can never be posted,
 * because it has no account to post to. That is enforced by the type, not by a
 * comment.
 *
 * IT DOES NOT POST. Every proposal is `postable: false`. `posting-core`'s
 * `AUTOPOSTABLE_SOURCE_KINDS` is exactly `pos_sale | excise | purchase | bank`,
 * and `NEVER_AUTOPOST_REASONS.atm` gives the reason in Michael's own terms.
 * A test asserts that equality rather than trusting this sentence.
 *
 * IT DOES NOT TOUCH A CONTROL ACCOUNT UNDER A MANUAL SOURCE KIND. `10300` is
 * `is_control` (0173, corrected in 0178), and migration 0172's guard (6) raises
 * `GL_CONTROL_ACCOUNT` for any `source_kind = 'manual'` line touching a control
 * account. Every proposal from here carries `source_kind = 'atm'`, which is
 * exempt from that guard and is the truthful provenance anyway. This is stated
 * because it is invisible to every pure test in the repository: a wrong
 * `sourceKind` here would be rejected by Postgres on the first button press,
 * with a green test suite.
 */

import {
  AUTOPOSTABLE_SOURCE_KINDS,
  NEVER_AUTOPOST_REASONS,
  type EntityCode,
  type SourceKind,
} from "@/lib/accounting/posting-core";
import { formatMoneyCents } from "@/lib/atm/atm-core";
import { BANK_ATM, BANK_PERSONAL } from "@/lib/atm/atm-sweep-core";
// Rule 25: the effective-dating primitives already exist and are already
// leap-year correct. Importing them means a fix to either one fixes both.
import { addDays, isValidIsoDate } from "@/lib/payroll/payroll-rate-registry-core";

/* ═════════════════════════════════════════════════════════════════════════
 * THE ACCOUNTS
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * `76040 Bank Fees`, an expense. Seeded in 0173 with
 * `default_cost_class = 'nondeductible_280e'` because the chart is written
 * greenway-first, and 0173's own block comment says why that is not a problem
 * here: "The ATM and landholding entities post to the SAME accounts and pick up
 * separate_business via their entity."
 *
 * `is_control` is false, `allowed_entity_codes` is null (all four entities).
 * Both verified against the migration, not assumed.
 */
export const ACCOUNT_BANK_FEES = "76040";

/**
 * `76050 Merchant & Payment Processing Fees`, an expense. Same shape as 76040.
 *
 * Kept DISTINCT from bank fees rather than folded into it. The bank's own
 * account-analysis charge and a card processor's debit are two different
 * counterparties, and 0173 deliberately seeded two accounts for them. Merging
 * them here would undo that on the way in.
 */
export const ACCOUNT_PROCESSING_FEES = "76050";

/**
 * `10300 Bank — ATM Vault Account`, an asset, DEBIT-normal after 0178 corrected
 * 0173's `is_contra`/`is_control` argument slip.
 *
 * `is_control = true`. See the header: safe under `source_kind = 'atm'`,
 * forbidden under `'manual'`. Re-exported through this module's own constant so
 * the classification path and the sweep path cannot drift onto two different
 * account codes for the same bank account.
 */
export const ACCOUNT_ATM_VAULT = "10300";

/** The ATM entity. Surcharge income and ATM-side costs live here (CHAMP). */
export const ATM_ENTITY: EntityCode = "atm";

/**
 * Provenance on every proposal from this module.
 *
 * `'atm'` and not `'manual'`, for two independent reasons: it is the truthful
 * answer to "where did this entry come from", and `'manual'` would trip
 * migration 0172's control-account guard on the `10300` line.
 */
export const CLASSIFICATION_SOURCE_KIND: SourceKind = "atm";

/**
 * The cost class for an ATM-entity expense line.
 *
 * `coa-core.ts::defaultCostClass('expense', 'atm')` returns `separate_business`,
 * and 0172's line-level check allows it. Hard-coded here rather than computed so
 * the value is visible in review; a test asserts it equals what
 * `defaultCostClass` returns, so the two cannot drift.
 */
export const ATM_EXPENSE_COST_CLASS = "separate_business";

/* ═════════════════════════════════════════════════════════════════════════
 * SHAPES
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * How a rule recognises a transaction.
 *
 * `description_exact` covers the whole measured population: the bank's
 * vocabulary on this account is five fixed strings across 301 rows. Rule 1 says
 * do not guess, and an exact match cannot. A `description_contains` kind is
 * deliberately ABSENT until a real row needs it — a substring matcher added
 * speculatively is a substring matcher nobody has tested against a hostile row.
 */
export type RuleMatchKind = "description_exact";

/**
 * What the transaction turns out to be.
 *
 * `already_accounted` is the one that is not obvious, and it is the reason this
 * is a union rather than a boolean. Some real debits are neither expenses nor
 * unknowns: they are the bank's side of something another posting path has
 * already recorded. See the header on the 2026-06-27 reversal.
 */
export type RuleTreatment = "atm_expense" | "already_accounted";

/**
 * One effective-dated classification rule.
 *
 * `effectiveTo` is INCLUSIVE, matching `PayrollRateRow`, and matching how
 * Michael reads a date. An exclusive end date here would be a one-day-a-year
 * bug, and mixing the two conventions between two registries in one repository
 * would be worse than either.
 */
export type ClassificationRule = {
  /** Stable identifier, for the audit trail and for `history()`. */
  readonly key: string;
  readonly matchKind: RuleMatchKind;
  /** The bank's text, VERBATIM. Compared after trim + upper-case only. */
  readonly matchValue: string;
  /** Inclusive ISO `yyyy-mm-dd` the rule starts applying. */
  readonly effectiveFrom: string;
  /** INCLUSIVE ISO end date, or null for "still in force". */
  readonly effectiveTo: string | null;
  readonly treatment: RuleTreatment;
  /**
   * The account to debit. NULL only when `treatment` is `already_accounted`,
   * which posts nothing. Validation enforces that correspondence in both
   * directions, so an expense rule cannot exist without an account and an
   * already-accounted rule cannot smuggle one in.
   */
  readonly debitAccountCode: string | null;
  readonly entityCode: EntityCode;
  /** Plain English, for Michael. Never blank. */
  readonly note: string;
  /**
   * WHERE THIS RULE CAME FROM. `measured` means a real row in a real statement
   * was traced to reach it. Never blank — a rule with no evidence is a guess
   * with a start date.
   */
  readonly evidence: string;
};

/**
 * A dated thing Michael has TOLD me about but has not yet decided how to treat.
 *
 * This is a separate type from `ClassificationRule` on purpose, and the
 * distinction is load-bearing rather than cosmetic. A notice has no account and
 * no treatment, so there is nothing on it that could be posted — the compiler
 * enforces "cannot be acted on", instead of a comment asking someone to
 * remember. It exists so that a transaction on 2026-11-15 that matches no rule
 * is refused WITH context, rather than refused blankly.
 */
export type RuleNotice = {
  readonly key: string;
  /** Inclusive ISO date from which this notice applies. */
  readonly effectiveFrom: string;
  /** What Michael said, verbatim where possible. */
  readonly what: string;
  /** The single concrete decision that turns this notice into a rule. */
  readonly whatIsStillNeeded: string;
};

/** One debit off the ATM statement, as handed to the classifier. */
export type ClassificationFacts = {
  /** ISO `yyyy-mm-dd`, the bank's processed date. */
  readonly processedDate: string;
  /** The statement description, VERBATIM. */
  readonly description: string;
  /** Positive integer cents. Direction is carried separately. */
  readonly amountCents: number;
  /** The bank's own word: "Debit" leaves 6228, "Credit" arrives in it. */
  readonly creditOrDebit: string;
};

/** One line of a proposed entry. Positive = debit, negative = credit. */
export type ClassificationLine = {
  readonly accountCode: string;
  readonly amountCents: number;
  readonly costClass: string;
  readonly description: string;
};

export type ClassificationOutcome =
  /** A rule was in force on the transaction's own date and it posts. */
  | "classified"
  /** A rule was in force and says another path already recorded this. */
  | "already_accounted"
  /** No rule covered this date. Nothing is assumed. */
  | "no_rule_for_date"
  /** The row itself cannot be classified (bad date, wrong direction, zero). */
  | "not_classifiable";

/**
 * The answer for one transaction.
 *
 * A refusal is still a full result with the reason attached, never a dropped
 * row. `appliedRule` is non-null only for `classified` and `already_accounted`,
 * so a screen can always show WHICH dated rule produced the answer — which is
 * the entire audit point of effective dating.
 */
export type ClassificationProposal = {
  readonly outcome: ClassificationOutcome;
  readonly journalDate: string;
  readonly description: string;
  readonly amountCents: number;
  readonly entityCode: EntityCode;
  readonly sourceKind: SourceKind;
  readonly memo: string;
  readonly lines: readonly ClassificationLine[];
  /** The rule that decided this, with its dates. Null when nothing applied. */
  readonly appliedRule: ClassificationRule | null;
  /** Always false. Nothing in this module is automatable. */
  readonly postable: false;
  readonly whyNotAutomatic: string;
  /** Set whenever no entry is proposed. Plain English, for Michael. */
  readonly refusal: string | null;
  /** The dated notices that were already in force on this date, if any. */
  readonly notices: readonly RuleNotice[];
};

/**
 * Quoted from `NEVER_AUTOPOST_REASONS.atm`, so the words on Michael's screen
 * and the rule in the ledger cannot drift apart. A test asserts the equality
 * rather than trusting the copy.
 */
export const CLASSIFICATION_WHY_NOT_AUTOMATIC = NEVER_AUTOPOST_REASONS.atm as string;

/* ═════════════════════════════════════════════════════════════════════════
 * VALIDATION
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * Structural check on one rule. Returns a human-readable problem, or null.
 *
 * Everything here is a refusal rather than a warning, for the same reason
 * `validateRateRow` refuses: a malformed classification rule is not a cosmetic
 * issue, it is a wrong account on somebody's tax return.
 */
export function validateClassificationRule(rule: ClassificationRule): string | null {
  if (rule.key.trim().length === 0) {
    return "a rule has a blank key, so it could never be shown or superseded";
  }
  if (rule.matchValue.trim().length === 0) {
    return `${rule.key}: matchValue is blank, which would match every transaction`;
  }
  if (!isValidIsoDate(rule.effectiveFrom)) {
    return `${rule.key}: effectiveFrom "${rule.effectiveFrom}" is not a real YYYY-MM-DD date`;
  }
  if (rule.effectiveTo !== null && !isValidIsoDate(rule.effectiveTo)) {
    return `${rule.key}: effectiveTo "${rule.effectiveTo}" is not a real YYYY-MM-DD date`;
  }
  if (rule.effectiveTo !== null && rule.effectiveTo < rule.effectiveFrom) {
    return `${rule.key}: effectiveTo "${rule.effectiveTo}" is before effectiveFrom "${rule.effectiveFrom}"`;
  }
  // The two-way correspondence. An expense rule with no account could never
  // post; an already-accounted rule WITH an account is an invitation to post
  // something that is already in the books once.
  if (rule.treatment === "atm_expense") {
    if (rule.debitAccountCode === null || rule.debitAccountCode.trim().length === 0) {
      return `${rule.key}: an expense rule must name the account to debit`;
    }
  } else if (rule.debitAccountCode !== null) {
    return (
      `${rule.key}: this rule says another path already records the transaction, ` +
      `so it must not also carry an account to post to`
    );
  }
  if (rule.note.trim().length === 0) {
    return `${rule.key}: note is blank - Michael has to be able to read this`;
  }
  if (rule.evidence.trim().length === 0) {
    return `${rule.key}: evidence is blank - a rule with no evidence is a guess with a start date`;
  }
  return null;
}

/** Structural check on one notice. */
export function validateRuleNotice(notice: RuleNotice): string | null {
  if (notice.key.trim().length === 0) return "a notice has a blank key";
  if (!isValidIsoDate(notice.effectiveFrom)) {
    return `${notice.key}: effectiveFrom "${notice.effectiveFrom}" is not a real YYYY-MM-DD date`;
  }
  if (notice.what.trim().length === 0) return `${notice.key}: what is blank`;
  if (notice.whatIsStillNeeded.trim().length === 0) {
    return `${notice.key}: whatIsStillNeeded is blank - a notice that names no decision cannot be cleared`;
  }
  return null;
}

/** Trim + upper-case. The ONLY normalisation applied to a bank description. */
export function normaliseMatchValue(s: string): string {
  return (s ?? "").trim().toUpperCase();
}

/**
 * Rules whose date ranges collide on the same matcher.
 *
 * A HARD ERROR, exactly as in `findRateOverlaps`. If two rules cover one day
 * for the same bank description, the answer depends on which one `find` reaches
 * first — a bug that produces a plausible account code. It also catches the
 * single most likely real editing mistake: adding the November rule without
 * closing out the October one, which is the failure this whole module exists
 * to prevent.
 */
export function findRuleOverlaps(rules: readonly ClassificationRule[]): string[] {
  const problems: string[] = [];
  const byMatcher = new Map<string, ClassificationRule[]>();
  for (const r of rules) {
    // Entity is part of the grouping key: the same bank text on two different
    // sets of books is two different rules, not a collision.
    const k = `${r.matchKind}\u0000${normaliseMatchValue(r.matchValue)}\u0000${r.entityCode}`;
    const list = byMatcher.get(k);
    if (list) list.push(r);
    else byMatcher.set(k, [r]);
  }
  for (const [k, list] of byMatcher) {
    const label = k.split("\u0000")[1] ?? "";
    const sorted = [...list].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
    for (let i = 0; i < sorted.length - 1; i++) {
      const cur = sorted[i] as ClassificationRule;
      const next = sorted[i + 1] as ClassificationRule;
      // An open-ended rule followed by anything is always an overlap:
      // "forever" and "starting in November" cannot both be true.
      if (cur.effectiveTo === null) {
        problems.push(
          `"${label}": the rule starting ${cur.effectiveFrom} never ends, but another starts ${next.effectiveFrom}`,
        );
        continue;
      }
      if (cur.effectiveTo >= next.effectiveFrom) {
        problems.push(
          `"${label}": ${cur.effectiveFrom}..${cur.effectiveTo} overlaps ${next.effectiveFrom}..${next.effectiveTo ?? "open"}`,
        );
      }
    }
  }
  return problems;
}

/**
 * Uncovered stretches between two rules for the same matcher.
 *
 * REPORTED, NOT REFUSED — and this is the one deliberate divergence from
 * `payroll-rate-registry-core`, where `findRateGaps` feeds a hard error. There,
 * a gap is always a defect: every day of the year has a PFML rate. Here a gap
 * is the normal, correct state of affairs — there is genuinely no
 * vendor-payment rule before November 1, and there SHOULD not be one. Wiring
 * this into `create()` as a failure would have made the correct table
 * unbuildable, which is how a borrowed abstraction turns into a bug.
 *
 * It is still exported, because a screen showing Michael his rules should be
 * able to show him the stretches nothing covers.
 */
export function findRuleGaps(rules: readonly ClassificationRule[]): string[] {
  const gaps: string[] = [];
  const byMatcher = new Map<string, ClassificationRule[]>();
  for (const r of rules) {
    const k = `${r.matchKind}\u0000${normaliseMatchValue(r.matchValue)}\u0000${r.entityCode}`;
    const list = byMatcher.get(k);
    if (list) list.push(r);
    else byMatcher.set(k, [r]);
  }
  for (const [k, list] of byMatcher) {
    const label = k.split("\u0000")[1] ?? "";
    const sorted = [...list].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
    for (let i = 0; i < sorted.length - 1; i++) {
      const cur = sorted[i] as ClassificationRule;
      const next = sorted[i + 1] as ClassificationRule;
      if (cur.effectiveTo === null) continue; // the overlap check owns this case
      const dayAfter = addDays(cur.effectiveTo, 1);
      if (dayAfter < next.effectiveFrom) {
        gaps.push(`"${label}": nothing covers ${dayAfter} through ${addDays(next.effectiveFrom, -1)}`);
      }
    }
  }
  return gaps;
}

/* ═════════════════════════════════════════════════════════════════════════
 * THE REGISTRY
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * A validated set of dated rules and notices.
 *
 * Construction validates; lookup does not. Same reasoning as
 * `PayrollRateRegistry`: there is no useful "mostly valid" state for a table
 * that decides which account somebody's money lands in.
 */
export class ClassificationRegistry {
  private readonly rules: readonly ClassificationRule[];
  private readonly notices: readonly RuleNotice[];

  private constructor(rules: readonly ClassificationRule[], notices: readonly RuleNotice[]) {
    this.rules = rules;
    this.notices = notices;
  }

  /**
   * Builds a registry, or explains exactly what is wrong with the input.
   *
   * Throws rather than returning a partial registry, and does NOT fail on gaps
   * — see `findRuleGaps` for why a gap here is correct rather than broken.
   */
  static create(
    rules: readonly ClassificationRule[],
    notices: readonly RuleNotice[] = [],
  ): ClassificationRegistry {
    const problems: string[] = [];
    for (const r of rules) {
      const p = validateClassificationRule(r);
      if (p) problems.push(p);
    }
    for (const n of notices) {
      const p = validateRuleNotice(n);
      if (p) problems.push(p);
    }
    // Duplicate keys would make `history()` and the audit trail ambiguous.
    const seen = new Set<string>();
    for (const r of rules) {
      const k = r.key.trim();
      if (seen.has(k)) problems.push(`duplicate rule key "${k}"`);
      seen.add(k);
    }
    problems.push(...findRuleOverlaps(rules));
    if (problems.length > 0) {
      throw new Error(
        `ClassificationRegistry: ${problems.length} problem(s) in the rule table\n  - ${problems.join("\n  - ")}`,
      );
    }
    return new ClassificationRegistry([...rules], [...notices]);
  }

  /** Every rule, for display and for reconciliation. */
  all(): readonly ClassificationRule[] {
    return this.rules;
  }

  /** Every notice, oldest first. */
  allNotices(): readonly RuleNotice[] {
    return [...this.notices].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
  }

  /**
   * Every version of one matcher, oldest first. This is the audit trail: it is
   * how Michael's CPA sees that October and November were treated differently
   * ON PURPOSE.
   */
  history(matchValue: string): readonly ClassificationRule[] {
    const want = normaliseMatchValue(matchValue);
    return this.rules
      .filter((r) => normaliseMatchValue(r.matchValue) === want)
      .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
  }

  /** The notices in force on a date. Used to explain a refusal, never to post. */
  noticesOn(onIsoDate: string): readonly RuleNotice[] {
    if (!isValidIsoDate(onIsoDate)) return [];
    return this.allNotices().filter((n) => n.effectiveFrom <= onIsoDate);
  }

  /**
   * THE ONLY WAY TO GET A RULE.
   *
   * There is deliberately no `current()`, no `latest()`, and no default — the
   * same three functions `PayrollRateRegistry` refuses to provide, refused here
   * for the same reason. A transaction is classified by the rule in force on
   * ITS OWN date. A date with no rule returns null and the caller REFUSES.
   *
   * This is what makes the recon's promise true: "If your CPA re-runs last
   * March in two years' time, he gets last March's answer."
   */
  lookup(matchValue: string, onIsoDate: string, entityCode: EntityCode): ClassificationRule | null {
    if (!isValidIsoDate(onIsoDate)) return null;
    const want = normaliseMatchValue(matchValue);
    if (want.length === 0) return null;
    return (
      this.rules.find(
        (r) =>
          r.entityCode === entityCode &&
          normaliseMatchValue(r.matchValue) === want &&
          r.effectiveFrom <= onIsoDate &&
          (r.effectiveTo === null || onIsoDate <= r.effectiveTo),
      ) ?? null
    );
  }
}

/* ═════════════════════════════════════════════════════════════════════════
 * THE RULES THAT ARE EVIDENCED, AND THE DATES THAT ARE NOT YET RULES
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * The measured statement descriptions, VERBATIM from the CSV.
 *
 * Held as constants because they are matched exactly, and a typo in a matcher
 * fails silently — the rule simply never fires and the transaction falls to
 * "no rule for this date", which looks like a missing rule rather than a typo.
 */
export const DESC_ACCOUNT_ANALYSIS = "ACCOUNT ANALYSIS CHARGE";
export const DESC_EFTRANSACT = "EFTRANSACT PAYMENT ALLIANCE PPD";
export const DESC_DLY_SETTLE = "DLY SETTLE MVNT - HG26499 CCD";

/**
 * THE OPENING DATE FOR EVERY MEASURED RULE.
 *
 * 2026-05-01 is the first day of the statement Michael provided, and therefore
 * the first day for which there is EVIDENCE of anything. Rule 11: opening facts
 * come from evidence, not from memory. Dating these rules earlier would be
 * claiming knowledge of a period nobody has looked at; a statement from April
 * can extend them backwards when one exists.
 */
export const EVIDENCE_OPENS_ON = "2026-05-01";

/**
 * Michael's own dates, verbatim from his message. These are NOTICES, not rules.
 *
 * "My plan is to switch to paying vendors from the atm account starting on
 *  November 1st. I will begin paying employees via the atm account on
 *  January 1st."
 *
 * A date is not a rule. He has told me WHEN, and has explicitly said he does
 * not yet know HOW: "Even after the start of the new year though, I don't know
 * exactly how the cash flow will work." Inventing the accounts would be
 * exactly the guess standing rule 1 forbids, and the recon already told him
 * this is his judgement call to make.
 */
export const VENDOR_SWITCH_DATE = "2026-11-01";
export const PAYROLL_SWITCH_DATE = "2027-01-01";

/**
 * The rules that a real statement row actually justifies. Four of them, and
 * not one more.
 */
export const ATM_CLASSIFICATION_RULES: readonly ClassificationRule[] = [
  {
    key: "atm.bank-analysis-charge",
    matchKind: "description_exact",
    matchValue: DESC_ACCOUNT_ANALYSIS,
    effectiveFrom: EVIDENCE_OPENS_ON,
    effectiveTo: null,
    treatment: "atm_expense",
    debitAccountCode: ACCOUNT_BANK_FEES,
    entityCode: ATM_ENTITY,
    note:
      "Timberland's monthly account-analysis charge on the ATM account. A cost of the ATM business, " +
      "which is a separate trade or business, so it is an ordinary deductible expense rather than a " +
      "280E-blocked one.",
    evidence:
      "Timberland ATM statement 2026-05-01..2026-08-21: exactly 3 rows, all Debit — 2026-05-29 $7.74, " +
      "2026-06-30 $7.92, 2026-07-31 $7.72. One per month-end.",
  },
  {
    key: "atm.processor-debit",
    matchKind: "description_exact",
    matchValue: DESC_EFTRANSACT,
    effectiveFrom: EVIDENCE_OPENS_ON,
    effectiveTo: null,
    treatment: "atm_expense",
    debitAccountCode: ACCOUNT_PROCESSING_FEES,
    entityCode: ATM_ENTITY,
    note:
      "A debit from Payment Alliance, the ATM processor. Processing cost of the ATM business. Kept in " +
      "76050 rather than 76040 because the counterparty is the processor, not the bank, and 0173 " +
      "deliberately seeded two accounts to keep them apart.",
    evidence:
      "Timberland ATM statement: exactly 1 row — 2026-07-07 Debit $1.85, described " +
      "\"EFTRANSACT PAYMENT ALLIANCE PPD\".",
  },
  {
    key: "atm.settlement-reversal",
    matchKind: "description_exact",
    matchValue: DESC_DLY_SETTLE,
    effectiveFrom: EVIDENCE_OPENS_ON,
    effectiveTo: null,
    treatment: "already_accounted",
    debitAccountCode: null,
    entityCode: ATM_ENTITY,
    note:
      "A settlement movement arriving as a debit is a card-network reversal, not a cost. The " +
      "settlement posting path already accounts for it, because the Funds Movement report carries the " +
      "negative leg and it is added rather than dropped. Booking it again here would record the same " +
      "money twice.",
    evidence:
      "Traced, not assumed. Funds Movement settlement day 2026-06-27 (Saturday) carries " +
      "Transaction $3,060.00, Surcharge $107.50 AND Transaction −$100.00. All three land in the " +
      "Timberland account on Monday 2026-06-29, the −$100.00 as the statement's only DLY SETTLE " +
      "debit. Exactly 1 such row in the whole statement.",
  },
  {
    /*
     * THE SWEEP, RECORDED HERE ONLY TO SAY IT BELONGS SOMEWHERE ELSE.
     *
     * 67 of the 72 debits off this account are transfers, and `atm-sweep-core`
     * already handles them properly as intercompany pairs and one
     * distribution. This rule exists so that the classifier's coverage of the
     * population is COMPLETE and provable: without it, "no rule for this date"
     * would mean two different things — genuinely unknown, and known but owned
     * by another module. Rule 48: a check that cannot classify its input must
     * fail, never blur.
     */
    key: "atm.sweep-owned-elsewhere",
    matchKind: "description_exact",
    matchValue: `TRANSFER FROM X${BANK_ATM} TO X6048`,
    effectiveFrom: EVIDENCE_OPENS_ON,
    effectiveTo: null,
    treatment: "already_accounted",
    debitAccountCode: null,
    entityCode: ATM_ENTITY,
    note:
      "The cash sweep to the cannabis account. Handled as an intercompany pair through 36000 by the " +
      "sweep path, on both sets of books at once. Nothing for this classifier to add.",
    evidence:
      "Timberland ATM statement: 66 rows, all Debit, totalling $526,937.58. Walked, not sampled.",
  },
  {
    /*
     * THE PERSONAL TRANSFER, AND WHY IT IS NOT LEFT AS AN UNKNOWN.
     *
     * Walking the real statement through this classifier left exactly one row
     * reported as "I have no dated rule for this": the 2026-07-03 transfer of
     * $5,242.50 to Michael's personal checking. That reading was WRONG, and
     * wrong in the direction that does quiet damage — `atm-sweep-core` knows
     * precisely what that row is and already proposes it as a single-sided
     * owner distribution through 41000 (D-23 explains at length why it is one
     * entry and not a pair).
     *
     * So reporting it as unknown is a FALSE ALARM. It puts a $5,242.50 item on
     * a "needs your attention" list that is already correctly handled two
     * modules over. False alarms are how real alarms come to be ignored, and
     * this one is 208 times larger than the four genuine costs put together —
     * it would dominate the screen while being the one row needing nothing.
     */
    key: "atm.personal-transfer-owned-elsewhere",
    matchKind: "description_exact",
    matchValue: `TRANSFER FROM X${BANK_ATM} TO X${BANK_PERSONAL}`,
    effectiveFrom: EVIDENCE_OPENS_ON,
    effectiveTo: null,
    treatment: "already_accounted",
    debitAccountCode: null,
    entityCode: ATM_ENTITY,
    note:
      "A transfer to your personal checking. Handled by the sweep path as an owner distribution " +
      "through 41000 on the ATM books only — not as a loan and not as a pair, because an " +
      "undocumented owner loan gets re-characterised as a distribution anyway. Nothing for this " +
      "classifier to add.",
    evidence:
      "Timberland ATM statement: exactly 1 row — 2026-07-03 Debit $5,242.50 to X3557. This is the " +
      "row the books-69 recon miscounted as a 67th sweep to the cannabis account.",
  },
];

/** Michael's two dates, as notices awaiting his decision. */
export const ATM_CLASSIFICATION_NOTICES: readonly RuleNotice[] = [
  {
    key: "notice.vendor-payments-from-atm",
    effectiveFrom: VENDOR_SWITCH_DATE,
    what:
      "You told me: \"My plan is to switch to paying vendors from the atm account starting on " +
      "November 1st.\" From this date, debits out of the ATM account may be the store's vendor " +
      "payments rather than anything the ATM business spent.",
    whatIsStillNeeded:
      "One decision from you, and it is a real judgement call: when the ATM entity pays a store " +
      "vendor, is that an intercompany advance the store owes back through 36000, or a capital " +
      "movement? I also need the bank's exact description text for those payments, which nobody can " +
      "know until the first one appears on a statement.",
  },
  {
    key: "notice.payroll-from-atm",
    effectiveFrom: PAYROLL_SWITCH_DATE,
    what:
      "You told me: \"I will begin paying employees via the atm account on January 1st.\" From this " +
      "date, debits out of the ATM account may be the store's payroll.",
    whatIsStillNeeded:
      "Payroll is never a simple expense line — it splits across wages, employee withholding and " +
      "employer taxes, and 31000 Accrued Payroll is a CONTROL account that only the payroll " +
      "subledger may move. So the rule here must route to the payroll run, not to an account. Tell " +
      "me when the first ATM-paid payroll is scheduled and I will wire it to the existing payroll " +
      "path rather than inventing a second one.",
  },
];

/**
 * The registry, built at module load so a malformed table fails immediately and
 * loudly rather than on the unlucky transaction that first needs it.
 */
export const ATM_CLASSIFICATION_REGISTRY = ClassificationRegistry.create(
  ATM_CLASSIFICATION_RULES,
  ATM_CLASSIFICATION_NOTICES,
);

/* ═════════════════════════════════════════════════════════════════════════
 * THE CLASSIFIER
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * Why this row cannot be classified at all, or null when it can.
 *
 * Separate from "no rule covers this date", because those are two genuinely
 * different situations and collapsing them would tell Michael to write a rule
 * when the real problem is a broken row.
 */
export function classificationRefusal(f: ClassificationFacts): string | null {
  if (!isValidIsoDate(f.processedDate)) {
    return `"${String(f.processedDate)}" is not a real calendar date, so this transaction cannot be dated, and without a date there is no way to know which rule was in force.`;
  }
  if (!Number.isSafeInteger(f.amountCents)) {
    return "This transaction's amount is not a whole number of cents, so it is not a figure the ledger can hold exactly.";
  }
  if (f.amountCents <= 0) {
    return "This transaction has no amount, and an entry for zero moves no money.";
  }
  if ((f.description ?? "").trim().length === 0) {
    return "This transaction has no description, so there is nothing to match a rule against. It is being shown to you rather than guessed at.";
  }
  if ((f.creditOrDebit ?? "").trim().toLowerCase() !== "debit") {
    return (
      `The bank recorded this as a "${String(f.creditOrDebit)}" rather than a debit, so money moved ` +
      `INTO the ATM account rather than out of it. Money arriving is settlement income, which the ` +
      `settlement path handles, so it is not classified as a cost here.`
    );
  }
  return null;
}

/**
 * Classify one debit off the ATM account, using the rule in force on the
 * transaction's OWN date.
 *
 * THE ENTRY, when one is proposed:
 *
 *     DEBIT  76040 or 76050   the cost, tagged separate_business
 *     CREDIT 10300            cash left the ATM vault account
 *
 * Nothing is posted. Every return carries `postable: false`, and the reason is
 * quoted from the ledger's own rule rather than restated.
 */
export function classifyAtmDebit(
  f: ClassificationFacts,
  registry: ClassificationRegistry = ATM_CLASSIFICATION_REGISTRY,
): ClassificationProposal {
  const refusal = classificationRefusal(f);
  const description = (f.description ?? "").trim();
  // Notices are attached to EVERY outcome, including refusals: if a row on
  // 2026-11-15 cannot be read, the fact that vendor payments were supposed to
  // start that month is still the most useful thing on the screen.
  const notices = isValidIsoDate(f.processedDate) ? registry.noticesOn(f.processedDate) : [];

  const base = {
    journalDate: f.processedDate,
    description,
    amountCents: f.amountCents,
    entityCode: ATM_ENTITY,
    sourceKind: CLASSIFICATION_SOURCE_KIND,
    postable: false as const,
    whyNotAutomatic: CLASSIFICATION_WHY_NOT_AUTOMATIC,
    notices,
  };

  if (refusal !== null) {
    return {
      ...base,
      outcome: "not_classifiable",
      memo: `Debit out of the ATM account on ${String(f.processedDate)} — not classified`,
      lines: [],
      appliedRule: null,
      refusal,
    };
  }

  const rule = registry.lookup(description, f.processedDate, ATM_ENTITY);

  if (rule === null) {
    // THE REFUSAL THAT IS THE WHOLE POINT. No reaching for the nearest rule.
    const known = registry.history(description);
    const coverage =
      known.length === 0
        ? "I have no rule on file for this description at all."
        : `What I do have on file for it: ${known
            .map((r) => `${r.effectiveFrom} to ${r.effectiveTo ?? "open-ended"}`)
            .join("; ")}.`;
    const noticeText =
      notices.length === 0
        ? ""
        : ` ${notices.map((n) => n.whatIsStillNeeded).join(" ")}`;
    return {
      ...base,
      outcome: "no_rule_for_date",
      memo: `Debit out of the ATM account on ${f.processedDate} — needs classifying`,
      lines: [],
      appliedRule: null,
      refusal:
        `${formatMoneyCents(f.amountCents)} left the ATM account on ${f.processedDate}, described ` +
        `"${description}", and I have no rule that was in force on that date to say what it was. ` +
        `${coverage} I am refusing rather than using a rule from a different period, because a rule ` +
        `that was written after the fact produces books that add up perfectly and are still wrong.` +
        noticeText,
    };
  }

  if (rule.treatment === "already_accounted") {
    return {
      ...base,
      outcome: "already_accounted",
      memo: `${description} on ${f.processedDate} — already recorded elsewhere`,
      lines: [],
      appliedRule: rule,
      refusal:
        `${formatMoneyCents(f.amountCents)} on ${f.processedDate}: ${rule.note} No entry is proposed ` +
        `here, because recording it again would count the same money twice.`,
    };
  }

  // `validateClassificationRule` has already guaranteed a non-null account for
  // an expense rule, and `create()` refuses to build a registry containing one
  // without it. The fallback is unreachable and is here only because the type
  // is nullable for the other treatment.
  const account = rule.debitAccountCode ?? ACCOUNT_BANK_FEES;

  return {
    ...base,
    outcome: "classified",
    memo: `${description} on ${f.processedDate}`,
    lines: [
      {
        accountCode: account,
        amountCents: f.amountCents,
        costClass: ATM_EXPENSE_COST_CLASS,
        description: `${rule.note} Classified by the rule in force from ${rule.effectiveFrom}.`,
      },
      {
        accountCode: ACCOUNT_ATM_VAULT,
        amountCents: -f.amountCents,
        costClass: "none",
        description: `Paid out of the ATM account on ${f.processedDate}.`,
      },
    ],
    appliedRule: rule,
    refusal: null,
  };
}

/** Sum a proposal's lines. A balanced entry sums to exactly zero. */
export function proposalBalanceCents(p: ClassificationProposal): number {
  return p.lines.reduce((sum, l) => sum + l.amountCents, 0);
}

/**
 * Classify many rows. Refused rows are KEPT, never filtered.
 *
 * A row that cannot be classified is the most interesting row in the file, and
 * dropping it is how $25.23 of real expense stays invisible for a year.
 */
export function classifyAtmDebits(
  rows: readonly ClassificationFacts[],
  registry: ClassificationRegistry = ATM_CLASSIFICATION_REGISTRY,
): readonly ClassificationProposal[] {
  return rows.map((r) => classifyAtmDebit(r, registry));
}

/** Counts and totals, for the sentence Michael reads. */
export type ClassificationSummary = {
  readonly total: number;
  readonly classified: number;
  readonly alreadyAccounted: number;
  readonly needsRule: number;
  readonly notClassifiable: number;
  readonly classifiedCents: number;
  readonly needsRuleCents: number;
  readonly noticesInForce: readonly RuleNotice[];
};

export function summariseClassification(
  proposals: readonly ClassificationProposal[],
): ClassificationSummary {
  let classified = 0;
  let alreadyAccounted = 0;
  let needsRule = 0;
  let notClassifiable = 0;
  let classifiedCents = 0;
  let needsRuleCents = 0;
  const noticeKeys = new Set<string>();
  const noticesInForce: RuleNotice[] = [];

  for (const p of proposals) {
    switch (p.outcome) {
      case "classified":
        classified += 1;
        classifiedCents += p.amountCents;
        break;
      case "already_accounted":
        alreadyAccounted += 1;
        break;
      case "no_rule_for_date":
        needsRule += 1;
        needsRuleCents += p.amountCents;
        break;
      default:
        notClassifiable += 1;
        break;
    }
    for (const n of p.notices) {
      if (!noticeKeys.has(n.key)) {
        noticeKeys.add(n.key);
        noticesInForce.push(n);
      }
    }
  }

  return {
    total: proposals.length,
    classified,
    alreadyAccounted,
    needsRule,
    notClassifiable,
    classifiedCents,
    needsRuleCents,
    noticesInForce: noticesInForce.sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1)),
  };
}

/**
 * The plain-English sentence for the screen.
 *
 * Says the number of rows AND the money, because "3 transactions need
 * classifying" and "$25.23 needs classifying" prompt very different reactions,
 * and only one of them is proportionate.
 */
export function classificationMessage(s: ClassificationSummary): string {
  if (s.total === 0) return "No money left the ATM account in this period other than the sweeps.";
  const parts: string[] = [];
  if (s.classified > 0) {
    parts.push(
      `${s.classified} ${s.classified === 1 ? "cost" : "costs"} totalling ${formatMoneyCents(s.classifiedCents)} ready for your approval`,
    );
  }
  if (s.alreadyAccounted > 0) {
    parts.push(
      `${s.alreadyAccounted} ${s.alreadyAccounted === 1 ? "movement" : "movements"} already recorded elsewhere`,
    );
  }
  if (s.needsRule > 0) {
    parts.push(
      `${s.needsRule} ${s.needsRule === 1 ? "transaction" : "transactions"} totalling ${formatMoneyCents(s.needsRuleCents)} I have no dated rule for`,
    );
  }
  if (s.notClassifiable > 0) {
    parts.push(`${s.notClassifiable} I could not read`);
  }
  let msg = `Of ${s.total} ${s.total === 1 ? "debit" : "debits"} out of the ATM account: ${parts.join(", ")}.`;
  for (const n of s.noticesInForce) {
    msg += ` ${n.what}`;
  }
  return msg;
}

/* ═════════════════════════════════════════════════════════════════════════
 * SELF-TESTS
 * ═════════════════════════════════════════════════════════════════════════ */

export function __runAtmClassificationCoreTests(): void {
  const failures: string[] = [];
  const ok = (cond: boolean, name: string): void => {
    if (!cond) failures.push(name);
  };

  /* ---- the real rows, verbatim from the statement ---- */

  const analysisCharge: ClassificationFacts = {
    processedDate: "2026-07-31",
    description: DESC_ACCOUNT_ANALYSIS,
    amountCents: 772,
    creditOrDebit: "Debit",
  };
  const processorDebit: ClassificationFacts = {
    processedDate: "2026-07-07",
    description: DESC_EFTRANSACT,
    amountCents: 185,
    creditOrDebit: "Debit",
  };
  const reversal: ClassificationFacts = {
    processedDate: "2026-06-29",
    description: DESC_DLY_SETTLE,
    amountCents: 10000,
    creditOrDebit: "Debit",
  };

  /* ---- 1. the measured rows classify as measured ---- */

  const a = classifyAtmDebit(analysisCharge);
  ok(a.outcome === "classified", "rules: the real $7.72 analysis charge classifies");
  ok(a.lines.length === 2, "rules: the analysis charge proposes exactly two lines");
  ok(a.lines[0]?.accountCode === ACCOUNT_BANK_FEES, "rules: a bank charge debits 76040");
  ok(a.lines[0]?.amountCents === 772, "rules: the debit is the real $7.72");
  ok(a.lines[1]?.accountCode === ACCOUNT_ATM_VAULT, "rules: the credit leaves 10300");
  ok(proposalBalanceCents(a) === 0, "rules: the proposed entry balances to zero");
  ok(a.lines[0]?.costClass === ATM_EXPENSE_COST_CLASS, "rules: an ATM cost is separate_business, not 280E");
  ok(a.lines[1]?.costClass === "none", "rules: the bank line carries no cost class");

  const p = classifyAtmDebit(processorDebit);
  ok(p.outcome === "classified", "rules: the real $1.85 processor debit classifies");
  ok(
    p.lines[0]?.accountCode === ACCOUNT_PROCESSING_FEES,
    "rules: a processor debit goes to 76050, not the bank-fee account",
  );

  /* ---- 2. the reversal is not an expense ---- */

  const r = classifyAtmDebit(reversal);
  ok(r.outcome === "already_accounted", "reversal: the $100.00 settlement debit is already accounted");
  ok(r.lines.length === 0, "reversal: nothing is proposed for money already recorded");
  ok(r.refusal !== null, "reversal: the reason is stated, not left blank");
  ok(
    (r.refusal ?? "").includes("twice"),
    "reversal: the explanation says why booking it again would double-count",
  );

  /* ---- 3. THE POINT: a date before the rule refuses ---- */

  const beforeEvidence = classifyAtmDebit({ ...analysisCharge, processedDate: "2026-04-30" });
  ok(
    beforeEvidence.outcome === "no_rule_for_date",
    "dates: a charge one day before the evidence opens has no rule",
  );
  ok(
    beforeEvidence.lines.length === 0,
    "dates: a transaction with no rule for its date proposes nothing at all",
  );
  ok(
    (beforeEvidence.refusal ?? "").includes("2026-05-01"),
    "dates: the refusal states which period IS covered",
  );

  /* ---- 4. a superseded rule keeps giving the old answer ---- */

  const dated = ClassificationRegistry.create([
    {
      key: "t.old",
      matchKind: "description_exact",
      matchValue: "WIDGET FEE",
      effectiveFrom: "2026-05-01",
      effectiveTo: "2026-10-31",
      treatment: "atm_expense",
      debitAccountCode: ACCOUNT_BANK_FEES,
      entityCode: "atm",
      note: "Old treatment.",
      evidence: "test fixture.",
    },
    {
      key: "t.new",
      matchKind: "description_exact",
      matchValue: "WIDGET FEE",
      effectiveFrom: "2026-11-01",
      effectiveTo: null,
      treatment: "atm_expense",
      debitAccountCode: ACCOUNT_PROCESSING_FEES,
      entityCode: "atm",
      note: "New treatment from November.",
      evidence: "test fixture.",
    },
  ]);
  const octoberRow: ClassificationFacts = {
    processedDate: "2026-10-31",
    description: "WIDGET FEE",
    amountCents: 500,
    creditOrDebit: "Debit",
  };
  const oct = classifyAtmDebit(octoberRow, dated);
  const nov = classifyAtmDebit({ ...octoberRow, processedDate: "2026-11-01" }, dated);
  ok(
    oct.lines[0]?.accountCode === ACCOUNT_BANK_FEES,
    "dates: October is still classified by October's rule after November's exists",
  );
  ok(
    nov.lines[0]?.accountCode === ACCOUNT_PROCESSING_FEES,
    "dates: November uses November's rule",
  );
  ok(oct.appliedRule?.key === "t.old", "dates: the proposal names WHICH dated rule decided it");

  /* ---- 5. overlaps are refused at construction ---- */

  let threw = false;
  try {
    ClassificationRegistry.create([
      {
        key: "t.a",
        matchKind: "description_exact",
        matchValue: "WIDGET FEE",
        effectiveFrom: "2026-05-01",
        effectiveTo: null,
        treatment: "atm_expense",
        debitAccountCode: ACCOUNT_BANK_FEES,
        entityCode: "atm",
        note: "n.",
        evidence: "e.",
      },
      {
        key: "t.b",
        matchKind: "description_exact",
        matchValue: "WIDGET FEE",
        effectiveFrom: "2026-11-01",
        effectiveTo: null,
        treatment: "atm_expense",
        debitAccountCode: ACCOUNT_PROCESSING_FEES,
        entityCode: "atm",
        note: "n.",
        evidence: "e.",
      },
    ]);
  } catch {
    threw = true;
  }
  ok(threw, "overlap: an open-ended rule plus a later rule is refused, not silently resolved");
  ok(
    findRuleOverlaps(ATM_CLASSIFICATION_RULES).length === 0,
    "overlap: the real rule table has none",
  );

  /* ---- 6. a gap is reported but does not break construction ---- */

  ok(
    findRuleGaps(dated.all()).length === 0,
    "gaps: consecutive rules that touch exactly report no gap",
  );
  const gapped = ClassificationRegistry.create([
    {
      key: "g.a",
      matchKind: "description_exact",
      matchValue: "WIDGET FEE",
      effectiveFrom: "2026-05-01",
      effectiveTo: "2026-05-31",
      treatment: "atm_expense",
      debitAccountCode: ACCOUNT_BANK_FEES,
      entityCode: "atm",
      note: "n.",
      evidence: "e.",
    },
    {
      key: "g.b",
      matchKind: "description_exact",
      matchValue: "WIDGET FEE",
      effectiveFrom: "2026-07-01",
      effectiveTo: null,
      treatment: "atm_expense",
      debitAccountCode: ACCOUNT_BANK_FEES,
      entityCode: "atm",
      note: "n.",
      evidence: "e.",
    },
  ]);
  const gaps = findRuleGaps(gapped.all());
  ok(gaps.length === 1, "gaps: an uncovered June is reported");
  ok(
    (gaps[0] ?? "").includes("2026-06-01") && (gaps[0] ?? "").includes("2026-06-30"),
    "gaps: the uncovered stretch is stated with real dates",
  );
  ok(
    classifyAtmDebit({ ...octoberRow, processedDate: "2026-06-15" }, gapped).outcome ===
      "no_rule_for_date",
    "gaps: a transaction inside the gap refuses rather than borrowing a neighbour",
  );

  /* ---- 7. malformed rules are refused ---- */

  const bad = (r: Partial<ClassificationRule>): boolean => {
    const full: ClassificationRule = {
      key: "x",
      matchKind: "description_exact",
      matchValue: "V",
      effectiveFrom: "2026-05-01",
      effectiveTo: null,
      treatment: "atm_expense",
      debitAccountCode: ACCOUNT_BANK_FEES,
      entityCode: "atm",
      note: "n.",
      evidence: "e.",
      ...r,
    };
    return validateClassificationRule(full) !== null;
  };
  ok(bad({ effectiveFrom: "2026-02-30" }), "validate: an impossible date is refused");
  ok(bad({ effectiveFrom: "2026-11-01", effectiveTo: "2026-05-01" }), "validate: end before start is refused");
  ok(bad({ matchValue: "   " }), "validate: a blank matcher, which would match everything, is refused");
  ok(bad({ debitAccountCode: null }), "validate: an expense rule with no account is refused");
  ok(
    bad({ treatment: "already_accounted", debitAccountCode: ACCOUNT_BANK_FEES }),
    "validate: an already-accounted rule may not carry an account to post to",
  );
  ok(bad({ evidence: "" }), "validate: a rule with no evidence is refused");
  ok(bad({ note: "" }), "validate: a rule with no plain-English note is refused");
  ok(
    validateClassificationRule({
      key: "x",
      matchKind: "description_exact",
      matchValue: "V",
      effectiveFrom: "2026-05-01",
      effectiveTo: null,
      treatment: "already_accounted",
      debitAccountCode: null,
      entityCode: "atm",
      note: "n.",
      evidence: "e.",
    }) === null,
    "validate: a well-formed already-accounted rule passes",
  );

  /* ---- 8. bad rows are refused, not classified ---- */

  ok(
    classifyAtmDebit({ ...analysisCharge, creditOrDebit: "Credit" }).outcome === "not_classifiable",
    "rows: money arriving in the ATM account is not classified as a cost",
  );
  ok(
    classifyAtmDebit({ ...analysisCharge, amountCents: 0 }).outcome === "not_classifiable",
    "rows: a zero-amount row is refused",
  );
  ok(
    classifyAtmDebit({ ...analysisCharge, processedDate: "2026-02-30" }).outcome === "not_classifiable",
    "rows: an impossible date is refused",
  );
  ok(
    classifyAtmDebit({ ...analysisCharge, description: "  " }).outcome === "not_classifiable",
    "rows: a row with no description is refused rather than matched",
  );

  /* ---- 9. nothing is ever postable ---- */

  const everyOutcome = [a, p, r, beforeEvidence, classifyAtmDebit({ ...analysisCharge, amountCents: 0 })];
  ok(
    everyOutcome.every((x) => x.postable === false),
    "posting: every outcome, including the successful ones, is postable false",
  );
  ok(
    everyOutcome.every((x) => x.whyNotAutomatic === NEVER_AUTOPOST_REASONS.atm),
    "posting: the reason shown is the ledger's own reason, not a paraphrase",
  );
  ok(
    !AUTOPOSTABLE_SOURCE_KINDS.includes(CLASSIFICATION_SOURCE_KIND),
    "posting: the source kind used here is not on the autopostable list",
  );
  ok(
    CLASSIFICATION_SOURCE_KIND !== "manual",
    "posting: the source kind is not manual, which would trip the control-account guard on 10300",
  );

  /* ---- 10. the notices are notices, not rules ---- */

  const novemberUnknown = classifyAtmDebit({
    processedDate: "2026-11-15",
    description: "SOME VENDOR ACH",
    amountCents: 250000,
    creditOrDebit: "Debit",
  });
  ok(
    novemberUnknown.outcome === "no_rule_for_date",
    "notices: an unknown November debit is refused, not guessed into a vendor rule",
  );
  ok(
    novemberUnknown.notices.some((n) => n.key === "notice.vendor-payments-from-atm"),
    "notices: the November notice is attached to the refusal",
  );
  ok(
    (novemberUnknown.refusal ?? "").includes("36000"),
    "notices: the refusal names the actual decision still needed",
  );
  const octoberUnknown = classifyAtmDebit({
    processedDate: "2026-10-31",
    description: "SOME VENDOR ACH",
    amountCents: 250000,
    creditOrDebit: "Debit",
  });
  ok(
    octoberUnknown.notices.length === 0,
    "notices: the November notice does NOT apply on October 31st",
  );
  ok(
    classifyAtmDebit({
      processedDate: "2027-01-01",
      description: "SOME PAYROLL ACH",
      amountCents: 250000,
      creditOrDebit: "Debit",
    }).notices.length === 2,
    "notices: on January 1st both of Michael's dates are in force",
  );

  /* ---- 11. lookup discipline ---- */

  ok(
    ATM_CLASSIFICATION_REGISTRY.lookup(DESC_ACCOUNT_ANALYSIS, "2026-07-31", "atm") !== null,
    "lookup: a covered date finds its rule",
  );
  ok(
    ATM_CLASSIFICATION_REGISTRY.lookup(DESC_ACCOUNT_ANALYSIS, "2026-07-31", "greenway") === null,
    "lookup: an ATM rule does not fire for the store's books",
  );
  ok(
    ATM_CLASSIFICATION_REGISTRY.lookup(DESC_ACCOUNT_ANALYSIS, "not-a-date", "atm") === null,
    "lookup: a malformed date finds nothing rather than the first row",
  );
  ok(
    ATM_CLASSIFICATION_REGISTRY.lookup("  account analysis charge  ", "2026-07-31", "atm") !== null,
    "lookup: matching is case-insensitive and trims, because bank exports are inconsistent",
  );
  ok(
    ATM_CLASSIFICATION_REGISTRY.lookup("ACCOUNT ANALYSIS", "2026-07-31", "atm") === null,
    "lookup: an exact matcher does not fire on a prefix",
  );

  /* ---- 12. the summary sentence ---- */

  const summary = summariseClassification(
    classifyAtmDebits([analysisCharge, processorDebit, reversal]),
  );
  ok(summary.total === 3, "summary: counts every row handed in");
  ok(summary.classified === 2, "summary: two of the three real rows are costs");
  ok(summary.alreadyAccounted === 1, "summary: the reversal is counted separately from the costs");
  ok(summary.classifiedCents === 957, "summary: $7.72 + $1.85 = $9.57 of real ATM cost");
  const sentence = classificationMessage(summary);
  ok(sentence.includes("$9.57"), "summary: the sentence states the money, not just the count");
  ok(!sentence.includes("$-"), "summary: money is never printed as $-");

  /* ---- 13. the measured population is COVERED, with no false alarms ----
   *
   * Walking the real statement produced exactly five distinct debit
   * descriptions. Each is asserted separately, because one assertion covering
   * all five would pass while four of them regressed (rule 129).
   */

  const sweepRow: ClassificationFacts = {
    processedDate: "2026-08-21",
    description: `TRANSFER FROM X${BANK_ATM} TO 6048`.replace("TO 6048", "TO X6048"),
    amountCents: 1142750,
    creditOrDebit: "Debit",
  };
  const personalRow: ClassificationFacts = {
    processedDate: "2026-07-03",
    description: `TRANSFER FROM X${BANK_ATM} TO X${BANK_PERSONAL}`,
    amountCents: 524250,
    creditOrDebit: "Debit",
  };
  ok(
    classifyAtmDebit(sweepRow).outcome === "already_accounted",
    "population: the sweep to 6048 is owned by the sweep path, not reported as unknown",
  );
  ok(
    classifyAtmDebit(personalRow).outcome === "already_accounted",
    "population: the $5,242.50 personal transfer is NOT a false alarm — the sweep path handles it",
  );
  ok(
    classifyAtmDebit(personalRow).lines.length === 0,
    "population: the personal transfer proposes no entry here, so it cannot be double-counted",
  );
  const wholePopulation = summariseClassification(
    classifyAtmDebits([analysisCharge, processorDebit, reversal, sweepRow, personalRow]),
  );
  ok(
    wholePopulation.needsRule === 0,
    "population: not one of the five measured description shapes is left needing a rule",
  );
  ok(
    wholePopulation.notClassifiable === 0,
    "population: not one of the five measured description shapes is unreadable",
  );

  if (failures.length > 0) {
    throw new Error(
      `atm-classification-core: ${failures.length} self-test(s) failed\n  - ${failures.join("\n  - ")}`,
    );
  }
}
