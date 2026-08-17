/**
 * src/lib/accounting/journal-advisor-core.ts   (slice books-01)
 *
 * THE ADVISOR. A PURE module — no database, no network, no clock — that reads a
 * draft general journal entry and says what a good accountant would say.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE OWNER'S INSTRUCTION, RECORDED VERBATIM (standing rule 1)
 *
 *   "I want push back, but I know how business goes, and I know there is always
 *    some strange thing that will come up that I will need to account for, like
 *    if I loan my employees some money, or things like that. I want to be able
 *    to make entries manually, but the system pushes back and try's to help me
 *    enter it correctly rather than rejecting it out right."
 *
 * So this module is built on one law:
 *
 *   THE SYSTEM MUST KNOW ENOUGH ACCOUNTING TO ARGUE WITH THE OWNER,
 *   AND MUST ALWAYS LOSE THE ARGUMENT GRACEFULLY.
 *
 * Every finding below therefore has a SEVERITY, and severity decides who wins:
 *
 *   "block"   — the entry is not accounting. Refused, always. There are only
 *               three of these, listed in HARD_BLOCK_REASONS, and each one is
 *               either arithmetic or statute, never opinion.
 *   "confirm" — the entry is probably miscoded. The advisor names the concern,
 *               offers a specific fix, and REQUIRES an acknowledgement. Then it
 *               yields and posts what the owner asked for.
 *   "advise"  — worth knowing, no acknowledgement required.
 *
 * The distinction matters because a system that blocks what it merely dislikes
 * teaches its owner to work around it, and work-arounds are how Sage ended up
 * with 511 of 595 purchase lines in "20009 LAZY INVENTORY ENTRY".
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * WHY PURE, AND WHY THIS SHAPE
 * The advice is the risky part, not the plumbing. Plumbing fails loudly; bad
 * advice fails silently and confidently. So the advice lives in a module with no
 * I/O that can be exercised thousands of times per second by the test gate, and
 * `evaluateJournalDraft` is a total function: same input, same findings, always.
 *
 * MONEY IS INTEGER CENTS THROUGHOUT (standing rule 7). Positive = debit,
 * negative = credit, matching gl_journal_lines.amount_cents and posting-service.
 */

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

/** The four sets of books. Mirrors gl_entities.code (migration 0172). */
export type AdvisorEntityCode = "greenway" | "atm" | "landholding" | "personal";

/**
 * 280E / §471 tagging. Mirrors the cost_class CHECK in 0172 line 362.
 * This is the single most valuable column in the ledger for tax purposes.
 */
export type AdvisorCostClass =
  | "cogs_direct"
  | "cogs_allocable"
  | "nondeductible_280e"
  | "separate_business"
  | "personal"
  | "none";

export const ADVISOR_COST_CLASSES: readonly AdvisorCostClass[] = [
  "cogs_direct",
  "cogs_allocable",
  "nondeductible_280e",
  "separate_business",
  "personal",
  "none",
] as const;

/**
 * The minimum an advisor needs to know about an account. Supplied by the caller
 * from gl_accounts so this module never touches a database.
 */
export type AdvisorAccount = {
  code: string;
  name: string;
  /** gl_accounts.account_type */
  type: "asset" | "liability" | "equity" | "revenue" | "cogs" | "expense" | "other";
  /** gl_accounts.normal_balance — 'debit' or 'credit'. */
  normalBalance: "debit" | "credit";
  /** True when gl_accounts.requires_cost_class is set. */
  requiresCostClass: boolean;
  /**
   * A control account is maintained by a subsidiary ledger (AP, AR, inventory,
   * payroll). Hand-keying one is how a subledger stops agreeing with the GL.
   */
  isControl: boolean;
  /** Which entities may use this account. Empty = all. */
  allowedEntities?: readonly AdvisorEntityCode[];
  /** gl_accounts.is_active */
  isActive: boolean;
};

export type AdvisorLine = {
  accountCode: string;
  /** Signed integer cents. POSITIVE = debit, NEGATIVE = credit. */
  amountCents: number;
  costClass?: AdvisorCostClass | null;
  description?: string | null;
};

export type AdvisorDraft = {
  entityCode: AdvisorEntityCode;
  /** ISO yyyy-mm-dd, Pacific business day (standing rule 8). */
  journalDate: string;
  memo: string;
  lines: readonly AdvisorLine[];
};

export type AdvisorSeverity = "block" | "confirm" | "advise";

export type AdvisorFinding = {
  /** Stable machine code, e.g. ADV_UNBALANCED. Used by tests and the UI. */
  code: string;
  severity: AdvisorSeverity;
  /** What the advisor is worried about, in plain English. */
  concern: string;
  /** The specific thing to do about it. Never vague. */
  suggestion: string;
  /** Line numbers (1-based) this finding is about. Empty = whole entry. */
  lines: readonly number[];
  /**
   * Authority for the position, when there is one. A finding that cites
   * something is a finding Michael can take to his grandfather and check.
   */
  authority?: string;
};

export type AdvisorVerdict = {
  /** False only when at least one "block" finding exists. */
  postable: boolean;
  /** True when at least one "confirm" finding needs acknowledging first. */
  needsAcknowledgement: boolean;
  findings: readonly AdvisorFinding[];
  /** Sum of debits in cents (always >= 0). */
  debitCents: number;
  /** Sum of credits in cents, as a positive number. */
  creditCents: number;
  /** debitCents - creditCents. Zero for a balanced entry. */
  differenceCents: number;
};

/**
 * The ONLY three reasons the advisor refuses outright. Exported so a test can
 * assert the list has not grown — the guarantee to the owner is that pushback
 * is advice and only these three are law.
 */
export const HARD_BLOCK_REASONS: readonly string[] = [
  "ADV_UNBALANCED",
  "ADV_PERIOD_CLOSED",
  "ADV_EXCISE_MISCODED",
] as const;

// ---------------------------------------------------------------------------
// SMALL PURE HELPERS
// ---------------------------------------------------------------------------

/** Sum of the positive (debit) amounts, in cents. */
export function sumDebits(lines: readonly AdvisorLine[]): number {
  let total = 0;
  for (const l of lines) if (l.amountCents > 0) total += l.amountCents;
  return total;
}

/** Sum of the negative (credit) amounts, returned POSITIVE, in cents. */
export function sumCredits(lines: readonly AdvisorLine[]): number {
  let total = 0;
  for (const l of lines) if (l.amountCents < 0) total += -l.amountCents;
  return total;
}

/**
 * True when the entry balances. Deliberately exact: there is no tolerance on a
 * hand-keyed journal entry. Tolerance belongs to machine matching, where a
 * penny of rounding is expected; a human typing numbers that do not add up is
 * a typo, and a system that silently absorbs typos is how a ledger drifts.
 */
export function isBalanced(lines: readonly AdvisorLine[]): boolean {
  return sumDebits(lines) - sumCredits(lines) === 0;
}

/** Format integer cents as plain dollars for a human-facing message. */
export function formatCents(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  const body = `$${dollars.toLocaleString("en-US")}.${String(rem).padStart(2, "0")}`;
  return negative ? `-${body}` : body;
}

/** Strict yyyy-mm-dd validation with real calendar checking. */
export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map((p) => Number(p));
  if (m < 1 || m > 12 || d < 1) return false;
  // Days in month, leap-year aware.
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return d <= dim;
}

// ---------------------------------------------------------------------------
// THE PATTERN LIBRARY
//
// Each pattern recognises a real-world situation Michael described or that a
// cannabis retailer predictably hits, and produces a "confirm" finding: named
// concern, specific fix, then it yields.
//
// These are deliberately DATA, not code branches, so the list can be reviewed
// by a human (or his grandfather) without reading TypeScript, and so a test can
// assert every pattern is reachable.
// ---------------------------------------------------------------------------

export type AdvisorPattern = {
  code: string;
  /** Human label used in the UI. */
  label: string;
  concern: string;
  suggestion: string;
  authority?: string;
};

/**
 * §7872 de minimis ceiling for compensation-related below-market loans, in
 * cents. Verified verbatim at 26 U.S.C. §7872(c)(3)(A) (Cornell LII):
 * the section does not apply to a compensation-related loan where the aggregate
 * outstanding amount does not exceed $10,000.
 */
export const SECTION_7872_DE_MINIMIS_CENTS = 1000000;

export const ADVISOR_PATTERNS: readonly AdvisorPattern[] = [
  {
    code: "ADV_EMPLOYEE_LOAN",
    label: "Money to an employee",
    concern:
      "This looks like money going to an employee, but it is coded to an expense account. " +
      "If you expect to be paid back it is not an expense — it is a receivable, an asset you still own.",
    suggestion:
      "If you expect repayment, use the employee-advance receivable account instead of an expense account. " +
      "If you do NOT expect repayment, it is compensation and belongs in wages so it runs through payroll and gets taxed correctly.",
    authority:
      "26 U.S.C. §7872(c)(1)(B) treats a compensation-related below-market loan as producing imputed interest; " +
      "§7872(c)(3)(A) exempts loans while the aggregate outstanding balance stays at or under $10,000.",
  },
  {
    code: "ADV_OWNER_DRAW_AS_EXPENSE",
    label: "Owner money coded as an expense",
    concern:
      "This entry moves money to or from you personally but codes it as a business expense. " +
      "An owner taking money out of an S-corp is a distribution or a shareholder loan, not a deduction.",
    suggestion:
      "Code it to shareholder distributions or to the shareholder loan account. If it was genuinely a business " +
      "cost you paid personally, code the expense AND credit shareholder contributions, so both halves are recorded.",
    authority:
      "An S-corp distribution reduces the shareholder's basis; it is not a deductible expense of the corporation.",
  },
  {
    code: "ADV_CAPITALISABLE",
    label: "Large purchase coded as an expense",
    concern:
      "This is a large amount coded straight to an expense account. If it bought something with a useful life " +
      "beyond this year, it is an asset that should be capitalised and depreciated rather than deducted all at once.",
    suggestion:
      "If it is equipment, a vehicle, or a leasehold improvement, code it to the fixed-asset account and let the " +
      "depreciation schedule spread it. If it is genuinely a consumable or a repair, expensing it is correct.",
    authority:
      "Treas. Reg. §1.263(a)-1 requires capitalisation of amounts paid to acquire or produce a unit of property; " +
      "the de minimis safe harbour under §1.263(a)-1(f) permits expensing below the elected threshold.",
  },
  {
    code: "ADV_CONTROL_ACCOUNT",
    label: "Hand-keying a subledger account",
    concern:
      "This line posts directly to an account that is maintained automatically by another part of the system " +
      "(accounts payable, accounts receivable, inventory, or payroll). Hand-keying it makes the ledger and that " +
      "subledger disagree, and nothing will tell you they have.",
    suggestion:
      "Record this through the feature that owns the account — enter the bill, the payment, or the inventory " +
      "adjustment — so both records move together. If you genuinely need a manual correction here, say so and it will post.",
  },
  {
    code: "ADV_MISSING_COST_CLASS",
    label: "Cannabis cost with no 280E tag",
    concern:
      "This account requires a 280E cost class and none was given. Under §280E a cannabis retailer may only " +
      "reduce income by cost of goods sold, so whether a cost is inventoriable or not is the single biggest " +
      "factor in the tax bill — and it has to be decided when the entry is made, not reconstructed in April.",
    suggestion:
      "Tag the line: 'cogs_direct' for the cost of the product itself, 'cogs_allocable' for costs §471 lets you " +
      "capitalise into inventory, or 'nondeductible_280e' for ordinary selling costs that §280E disallows.",
    authority:
      "IRC §280E denies deductions for a trade or business trafficking in controlled substances; " +
      "IRC §471 and Treas. Reg. §1.471-3(b) govern what enters inventory cost. " +
      "Chief Counsel Advice 201504011 addresses the interaction for cannabis resellers.",
  },
  {
    code: "ADV_PERSONAL_IN_BUSINESS",
    label: "Personal cost in a business set of books",
    concern:
      "This line is tagged as personal but it is being posted into a business set of books. Mixing personal " +
      "spending into business books is the fastest way to lose an audit, because it invites the examiner to " +
      "question everything else too.",
    suggestion:
      "Post it in the 'personal' books instead. If the business paid for it, code it to shareholder " +
      "distributions here — that records the money leaving the business without claiming it as a deduction.",
  },
  {
    code: "ADV_ROUND_NUMBER",
    label: "Suspiciously round amount",
    concern:
      "Every amount in this entry is a round number. That is normal for a transfer or a loan payment, and it is " +
      "a warning sign for an estimate that was never trued up to a document.",
    suggestion:
      "If this came off a receipt or a statement, no change is needed. If you estimated it, note that in the memo " +
      "so the assumption is recorded rather than forgotten.",
  },
  {
    code: "ADV_INTERCOMPANY",
    label: "Both sides of a related-party deal",
    concern:
      "This entry mentions another one of your entities. A transaction between two of your own businesses has to " +
      "be recorded in BOTH sets of books, or the combined picture stops making sense and the rent deduction on " +
      "one side has no matching income on the other.",
    suggestion:
      "Use the paired intercompany entry so both halves post together, or make the matching entry in the other " +
      "entity immediately and reference this journal number in its memo.",
    authority:
      "IRC §482 permits the IRS to reallocate income between commonly controlled businesses that do not deal at arm's length.",
  },
] as const;

/** Look up a pattern by code. Returns undefined for an unknown code. */
export function findPattern(code: string): AdvisorPattern | undefined {
  return ADVISOR_PATTERNS.find((p) => p.code === code);
}

// ---------------------------------------------------------------------------
// KEYWORD DETECTION
//
// The advisor reads the memo and line descriptions for words that betray what
// the entry really is. This is intentionally conservative: a false "confirm" is
// a mild annoyance the owner clicks past; a missed one is a wrong tax return.
// ---------------------------------------------------------------------------

const EMPLOYEE_LOAN_WORDS = [
  "loan",
  "advance",
  "lend",
  "lent",
  "borrow",
  "payday",
  "float",
  "spot",
  "iou",
];

const EMPLOYEE_WORDS = ["employee", "staff", "budtender", "worker", "crew", "team member"];

const OWNER_WORDS = [
  "owner",
  "michael",
  "myself",
  "personal",
  "draw",
  "distribution",
  "shareholder",
  "my own",
];

const ENTITY_WORDS: Readonly<Record<AdvisorEntityCode, readonly string[]>> = {
  greenway: ["greenway", "the store", "the shop", "retail"],
  atm: ["atm", "cash machine", "vault"],
  landholding: ["landholding", "land holding", "geiger", "rent", "landlord", "lease"],
  personal: ["personal", "household"],
};

/**
 * Lowercased haystack of every human-written word in the draft.
 *
 * Line descriptions are joined with a NUL sentinel so a multi-word phrase can
 * never straddle the boundary between two separate descriptions (e.g. a line
 * ending "...team" followed by a line starting "member..." must NOT match the
 * phrase "team member").
 */
function draftText(draft: AdvisorDraft): string {
  const parts: string[] = [draft.memo || ""];
  for (const l of draft.lines) if (l.description) parts.push(l.description);
  return parts.join(" \u0000 ").toLowerCase();
}

/**
 * WHY THIS IS NOT `String.includes`.
 *
 * The first version of this advisor matched keywords by naive substring. It
 * fired an owner-draw warning on the memo "Cash purchase of shop supplies from
 * Costco, receipt in the drawer" because "drawer" contains "draw". A sweep of
 * ordinary bookkeeping vocabulary found 27 more:
 *
 *   "calendar" -> "lend"        "previous"/"serious"/"obvious" -> "iou"
 *   "excellent"/"talent" -> "lent"   "different"/"parent"/"current" -> "rent"
 *   "please"/"release" -> "lease"    "treatment" -> "atm"
 *   "withdrawal"/"drawn" -> "draw"   "screw" -> "crew"
 *   "spotless" -> "spot"             "advanced" -> "advance"
 *
 * That matters more than it looks. An advisor that cries wolf on "please" and
 * "different" teaches the owner to click past every warning it ever raises,
 * which silently destroys the value of the ones that are real. Precision here
 * IS the safety feature.
 *
 * So matching is whole-word. The haystack is split into word tokens; a needle
 * matches only if it lines up with complete tokens. A short list of regular
 * English inflections is allowed on the FINAL token so that "loans", "advanced",
 * "floating", "draws" and "team members" still match, while "drawer",
 * "calendar" and "please" do not.
 *
 * Pure, allocation-cheap, no regular expressions, no `RegExp` construction from
 * data (the needles are compile-time constants, but building regexes from
 * strings is a habit worth not having in a module this important).
 */
const INFLECTIONS: readonly string[] = ["", "s", "es", "d", "ed", "ing"];

/**
 * A token that no needle can ever contain (needles are alphabetic), emitted
 * wherever the NUL sentinel separates two distinct human-written fields. Its
 * presence in the token stream is what stops a multi-word phrase from
 * straddling the boundary between the memo and a line description, or between
 * two line descriptions.
 */
const BARRIER = "\u0000";

/**
 * Split into lowercase alphabetic word tokens. Digits and punctuation are word
 * breaks; the NUL field separator becomes an explicit BARRIER token.
 */
function tokenise(haystack: string): string[] {
  const out: string[] = [];
  let cur = "";
  const flush = (): void => {
    if (cur.length > 0) {
      out.push(cur);
      cur = "";
    }
  };
  for (let i = 0; i < haystack.length; i += 1) {
    const ch = haystack[i]!;
    // a-z only; everything else (digits, punctuation) is a plain break
    if (ch >= "a" && ch <= "z") {
      cur += ch;
    } else {
      flush();
      if (ch === BARRIER) out.push(BARRIER);
    }
  }
  flush();
  return out;
}

/** Does `token` equal `word`, allowing a regular English inflection suffix? */
function tokenMatches(token: string, word: string): boolean {
  if (token === word) return true;
  if (token.length <= word.length) return false;
  if (!token.startsWith(word)) return false;
  const suffix = token.slice(word.length);
  for (const inf of INFLECTIONS) {
    if (inf.length > 0 && suffix === inf) return true;
  }
  return false;
}

/**
 * Whole-word (phrase-aware) containment.
 *
 * Every word of a multi-word needle must match exactly, except the last, which
 * may carry an inflection: "team member" matches "team members" but "the store"
 * does not match "the storefront".
 */
function mentionsAny(haystack: string, needles: readonly string[]): boolean {
  const tokens = tokenise(haystack);
  if (tokens.length === 0) return false;

  for (const needle of needles) {
    const words = tokenise(needle);
    if (words.length === 0) continue;

    for (let start = 0; start + words.length <= tokens.length; start += 1) {
      let hit = true;
      for (let w = 0; w < words.length; w += 1) {
        const token = tokens[start + w]!;
        const word = words[w]!;
        const isLast = w === words.length - 1;
        const matched = isLast ? tokenMatches(token, word) : token === word;
        if (!matched) {
          hit = false;
          break;
        }
      }
      if (hit) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// THE MAIN EVALUATION
// ---------------------------------------------------------------------------

export type AdvisorContext = {
  /** Accounts referenced by the draft, keyed by code. */
  accounts: Readonly<Record<string, AdvisorAccount>>;
  /**
   * True when the period containing journalDate is CLOSED. Supplied by the
   * caller from gl_periods; the advisor never queries.
   */
  periodClosed?: boolean;
  /**
   * Accounts that hold Washington cannabis excise tax. Posting excise to
   * revenue or expense is a hard block — see the finding for why.
   */
  exciseAccountCodes?: readonly string[];
  /**
   * Amount above which an expense line prompts the capitalisation question, in
   * cents. Defaults to the §1.263(a)-1(f) de minimis safe-harbour amount of
   * $2,500 per invoice/item for a taxpayer without an applicable financial
   * statement.
   */
  capitalisationThresholdCents?: number;
  /** Codes treated as employee-advance receivables, for the loan suggestion. */
  employeeAdvanceAccountCodes?: readonly string[];
};

/** §1.263(a)-1(f)(1)(ii)(D) de minimis safe harbour, in cents. */
export const DE_MINIMIS_CAPITALISATION_CENTS = 250000;

/**
 * Read a draft entry and report everything a good accountant would mention.
 *
 * Findings come back in severity order (block, then confirm, then advise) and
 * within a severity in a stable, deterministic order, so the UI never reshuffles
 * and tests never flake.
 */
export function evaluateJournalDraft(
  draft: AdvisorDraft,
  ctx: AdvisorContext,
): AdvisorVerdict {
  const findings: AdvisorFinding[] = [];
  const lines = draft.lines ?? [];
  const debitCents = sumDebits(lines);
  const creditCents = sumCredits(lines);
  const differenceCents = debitCents - creditCents;

  const text = draftText(draft);
  const threshold =
    ctx.capitalisationThresholdCents ?? DE_MINIMIS_CAPITALISATION_CENTS;
  const exciseCodes = ctx.exciseAccountCodes ?? [];

  // ─── HARD BLOCK 1: arithmetic ────────────────────────────────────────────
  // Not an opinion. An entry whose debits and credits differ is not an entry.
  if (lines.length < 2) {
    findings.push({
      code: "ADV_UNBALANCED",
      severity: "block",
      concern:
        "An entry needs at least two lines. Double-entry means every amount goes two places: " +
        "what changed, and where it came from.",
      suggestion: "Add the other side of the entry.",
      lines: [],
      authority: "Double-entry bookkeeping; enforced by gl_post_journal (migration 0172).",
    });
  } else if (differenceCents !== 0) {
    findings.push({
      code: "ADV_UNBALANCED",
      severity: "block",
      concern:
        `Debits are ${formatCents(debitCents)} and credits are ${formatCents(creditCents)}, ` +
        `a difference of ${formatCents(Math.abs(differenceCents))}. This cannot be posted, and no ` +
        "amount of confirming will change that — an unbalanced entry is not a mistake of judgement, it is arithmetic.",
      suggestion:
        differenceCents > 0
          ? `Add ${formatCents(differenceCents)} of credits, or reduce debits by the same amount.`
          : `Add ${formatCents(-differenceCents)} of debits, or reduce credits by the same amount.`,
      lines: [],
      authority: "Enforced independently by gl_post_journal (migration 0172).",
    });
  }

  // ─── HARD BLOCK 2: a closed period ───────────────────────────────────────
  // Once a period is closed the numbers in it have been reported. Reaching back
  // silently changes a figure someone already relied on.
  if (ctx.periodClosed) {
    findings.push({
      code: "ADV_PERIOD_CLOSED",
      severity: "block",
      concern:
        `The period containing ${draft.journalDate} is closed. The numbers in it have already been ` +
        "reported, so changing them now would make this month's books disagree with what was filed.",
      suggestion:
        "Date the entry in the current open period instead. If it genuinely belongs in the closed month, " +
        "reopen that period deliberately — that is a decision with an audit record, not a side effect of typing a date.",
      lines: [],
      authority: "ASC 250 — corrections are made prospectively or by restatement, never by silent revision.",
    });
  }

  // ─── HARD BLOCK 3: excise tax miscoded ───────────────────────────────────
  // Washington cannabis excise is money the store never owned.
  if (exciseCodes.length > 0) {
    const badExcise: number[] = [];
    lines.forEach((l, i) => {
      if (!exciseCodes.includes(l.accountCode)) return;
      const acct = ctx.accounts[l.accountCode];
      if (!acct) return;
      if (acct.type === "revenue" || acct.type === "expense" || acct.type === "cogs") {
        badExcise.push(i + 1);
      }
    });
    if (badExcise.length > 0) {
      findings.push({
        code: "ADV_EXCISE_MISCODED",
        severity: "block",
        concern:
          "Cannabis excise tax is being recorded as revenue or as an expense. It is neither. That money was " +
          "never yours — you collected it and you owe it to the state.",
        suggestion:
          "Code excise to the excise tax payable liability account. It leaves the balance sheet when you remit it, " +
          "and it never touches the profit and loss.",
        lines: badExcise,
        authority:
          "RCW 69.50.535(4) — the excise tax is held in trust for the state until remitted.",
      });
    }
  }

  // ─── Per-line checks ─────────────────────────────────────────────────────
  const unknownAccounts: number[] = [];
  const inactiveAccounts: number[] = [];
  const wrongEntityAccounts: number[] = [];
  const controlAccounts: number[] = [];
  const missingCostClass: number[] = [];
  const personalInBusiness: number[] = [];
  const bigExpenses: number[] = [];
  const zeroLines: number[] = [];
  const nonIntegerLines: number[] = [];

  lines.forEach((l, idx) => {
    const n = idx + 1;
    const acct = ctx.accounts[l.accountCode];

    if (!Number.isFinite(l.amountCents) || !Number.isInteger(l.amountCents)) {
      nonIntegerLines.push(n);
      return;
    }
    if (l.amountCents === 0) zeroLines.push(n);

    if (!acct) {
      unknownAccounts.push(n);
      return;
    }
    if (!acct.isActive) inactiveAccounts.push(n);

    if (
      acct.allowedEntities &&
      acct.allowedEntities.length > 0 &&
      !acct.allowedEntities.includes(draft.entityCode)
    ) {
      wrongEntityAccounts.push(n);
    }

    if (acct.isControl) controlAccounts.push(n);

    if (acct.requiresCostClass) {
      const cc = l.costClass ?? null;
      if (cc === null || cc === "none") missingCostClass.push(n);
    }

    if (l.costClass === "personal" && draft.entityCode !== "personal") {
      personalInBusiness.push(n);
    }

    // Capitalisation question: a DEBIT to an expense account above the safe
    // harbour. Credits are refunds/reversals and are not capitalisable.
    if (acct.type === "expense" && l.amountCents >= threshold) {
      bigExpenses.push(n);
    }
  });

  if (nonIntegerLines.length > 0) {
    findings.push({
      code: "ADV_NON_INTEGER_AMOUNT",
      severity: "block",
      concern:
        "An amount is not a whole number of cents. Money in this system is always exact whole cents, because " +
        "fractions of a cent are where rounding errors are born.",
      suggestion: "Re-enter the amount as a whole number of cents.",
      lines: nonIntegerLines,
      authority: "Standing rule 7 — money in minor units.",
    });
  }

  if (unknownAccounts.length > 0) {
    findings.push({
      code: "ADV_UNKNOWN_ACCOUNT",
      severity: "block",
      concern:
        "One or more lines point at an account that is not in the chart of accounts. The entry cannot be " +
        "recorded against an account that does not exist.",
      suggestion:
        "Pick an existing account. If you genuinely need a new one, add it to the chart first so it gets a " +
        "type, a normal balance, and a 280E rule.",
      lines: unknownAccounts,
    });
  }

  if (zeroLines.length > 0) {
    findings.push({
      code: "ADV_ZERO_LINE",
      severity: "confirm",
      concern:
        "A line has an amount of zero. A zero line records nothing and usually means a number was left unfilled.",
      suggestion: "Fill in the amount, or remove the line.",
      lines: zeroLines,
    });
  }

  if (inactiveAccounts.length > 0) {
    findings.push({
      code: "ADV_INACTIVE_ACCOUNT",
      severity: "confirm",
      concern:
        "This posts to an account that has been switched off. Accounts get retired for a reason — usually " +
        "because something replaced them — and using one again quietly splits your history across two accounts.",
      suggestion:
        "Use the account that replaced it. If the old one is genuinely still right, reactivate it deliberately.",
      lines: inactiveAccounts,
    });
  }

  if (wrongEntityAccounts.length > 0) {
    findings.push({
      code: "ADV_WRONG_ENTITY",
      severity: "confirm",
      concern:
        `This account is not meant for the ${draft.entityCode} books. Posting it here mixes two businesses ` +
        "together, and the whole reason they are separate is that they are taxed separately.",
      suggestion:
        "Switch to the entity this account belongs to, or pick the equivalent account that does belong to " +
        `the ${draft.entityCode} books.`,
      lines: wrongEntityAccounts,
    });
  }

  if (controlAccounts.length > 0) {
    const p = findPattern("ADV_CONTROL_ACCOUNT");
    findings.push({
      code: "ADV_CONTROL_ACCOUNT",
      severity: "confirm",
      concern: p ? p.concern : "This posts directly to a subledger control account.",
      suggestion: p ? p.suggestion : "Use the feature that owns this account.",
      lines: controlAccounts,
    });
  }

  if (missingCostClass.length > 0) {
    const p = findPattern("ADV_MISSING_COST_CLASS");
    findings.push({
      code: "ADV_MISSING_COST_CLASS",
      severity: "confirm",
      concern: p ? p.concern : "A 280E cost class is required and missing.",
      suggestion: p ? p.suggestion : "Tag the line with a cost class.",
      lines: missingCostClass,
      authority: p?.authority,
    });
  }

  if (personalInBusiness.length > 0) {
    const p = findPattern("ADV_PERSONAL_IN_BUSINESS");
    findings.push({
      code: "ADV_PERSONAL_IN_BUSINESS",
      severity: "confirm",
      concern: p ? p.concern : "A personal cost is being posted into business books.",
      suggestion: p ? p.suggestion : "Post it in the personal books.",
      lines: personalInBusiness,
    });
  }

  if (bigExpenses.length > 0) {
    const p = findPattern("ADV_CAPITALISABLE");
    findings.push({
      code: "ADV_CAPITALISABLE",
      severity: "confirm",
      concern: p ? p.concern : "A large amount is coded straight to an expense.",
      suggestion: p ? p.suggestion : "Consider capitalising it.",
      lines: bigExpenses,
      authority: p?.authority,
    });
  }

  // ─── Narrative patterns (read the words, not just the numbers) ────────────

  // Employee loan: money out, employee mentioned, loan-ish word, and the debit
  // landed on an expense rather than a receivable.
  const advanceCodes = ctx.employeeAdvanceAccountCodes ?? [];
  const mentionsEmployee = mentionsAny(text, EMPLOYEE_WORDS);
  const mentionsLoan = mentionsAny(text, EMPLOYEE_LOAN_WORDS);
  if (mentionsEmployee && mentionsLoan) {
    const expenseDebits: number[] = [];
    lines.forEach((l, i) => {
      const acct = ctx.accounts[l.accountCode];
      if (!acct) return;
      if (
        l.amountCents > 0 &&
        (acct.type === "expense" || acct.type === "cogs") &&
        !advanceCodes.includes(l.accountCode)
      ) {
        expenseDebits.push(i + 1);
      }
    });
    if (expenseDebits.length > 0) {
      const p = findPattern("ADV_EMPLOYEE_LOAN");
      const total = sumDebits(lines);
      const overDeMinimis = total > SECTION_7872_DE_MINIMIS_CENTS;
      findings.push({
        code: "ADV_EMPLOYEE_LOAN",
        severity: "confirm",
        concern: p ? p.concern : "This looks like an employee loan coded as an expense.",
        suggestion:
          (p ? p.suggestion : "Use a receivable account.") +
          (overDeMinimis
            ? ` Note: ${formatCents(total)} is above the $10,000 threshold, so if you charge little or no ` +
              "interest the tax rules impute interest income to you. Below $10,000 there is nothing extra to do."
            : ` At ${formatCents(total)} you are under the $10,000 threshold, so there is no imputed-interest ` +
              "problem as long as the total outstanding stays there."),
        lines: expenseDebits,
        authority: p?.authority,
      });
    }
  }

  // Owner draw dressed up as an expense.
  if (mentionsAny(text, OWNER_WORDS) && draft.entityCode !== "personal") {
    const ownerExpense: number[] = [];
    lines.forEach((l, i) => {
      const acct = ctx.accounts[l.accountCode];
      if (!acct) return;
      if (l.amountCents > 0 && acct.type === "expense") ownerExpense.push(i + 1);
    });
    if (ownerExpense.length > 0) {
      const p = findPattern("ADV_OWNER_DRAW_AS_EXPENSE");
      findings.push({
        code: "ADV_OWNER_DRAW_AS_EXPENSE",
        severity: "confirm",
        concern: p ? p.concern : "Owner money is coded as a business expense.",
        suggestion: p ? p.suggestion : "Use distributions or the shareholder loan account.",
        lines: ownerExpense,
        authority: p?.authority,
      });
    }
  }

  // Intercompany: the words name a DIFFERENT entity than the one being posted.
  const otherEntities = (Object.keys(ENTITY_WORDS) as AdvisorEntityCode[]).filter(
    (e) => e !== draft.entityCode && mentionsAny(text, ENTITY_WORDS[e]),
  );
  if (otherEntities.length > 0) {
    const p = findPattern("ADV_INTERCOMPANY");
    findings.push({
      code: "ADV_INTERCOMPANY",
      severity: "confirm",
      concern:
        (p ? p.concern : "This mentions another entity.") +
        ` (Mentioned: ${otherEntities.join(", ")}.)`,
      suggestion: p ? p.suggestion : "Record both halves.",
      lines: [],
      authority: p?.authority,
    });
  }

  // Round numbers: advisory only.
  if (lines.length >= 2) {
    const allRound =
      lines.every((l) => Number.isInteger(l.amountCents) && l.amountCents % 100000 === 0) &&
      lines.some((l) => l.amountCents !== 0);
    if (allRound) {
      const p = findPattern("ADV_ROUND_NUMBER");
      findings.push({
        code: "ADV_ROUND_NUMBER",
        severity: "advise",
        concern: p ? p.concern : "Every amount is round.",
        suggestion: p ? p.suggestion : "Note the source in the memo.",
        lines: [],
      });
    }
  }

  // Memo quality. A memo nobody can read is an entry nobody can audit.
  const memo = (draft.memo ?? "").trim();
  if (memo.length < 3) {
    findings.push({
      code: "ADV_MEMO_TOO_SHORT",
      severity: "block",
      concern:
        "Every entry needs a memo of at least three characters. In a year you will not remember what this was, " +
        "and neither will anyone reading the books after you.",
      suggestion: "Describe what happened in a short sentence.",
      lines: [],
      authority: "Enforced independently by gl_journals.memo (migration 0172).",
    });
  } else if (memo.length < 12 || /^(test|misc|adjustment|correction|fix|entry)$/i.test(memo)) {
    findings.push({
      code: "ADV_MEMO_VAGUE",
      severity: "advise",
      concern:
        "The memo is very short or generic. Memos like 'adjustment' are the reason old books become unreadable — " +
        "they record that something happened without recording what.",
      suggestion:
        "Say what it was and why, e.g. 'Cash purchase of shop supplies from Costco, receipt in the drawer'.",
      lines: [],
    });
  }

  // Date sanity.
  if (!isValidIsoDate(draft.journalDate)) {
    findings.push({
      code: "ADV_BAD_DATE",
      severity: "block",
      concern: `'${draft.journalDate}' is not a real calendar date.`,
      suggestion: "Enter the date as yyyy-mm-dd.",
      lines: [],
      authority: "Standing rule 8 — Pacific time is the business clock.",
    });
  }

  // Stable ordering: severity first, then the order findings were produced.
  const rank: Record<AdvisorSeverity, number> = { block: 0, confirm: 1, advise: 2 };
  const ordered = findings
    .map((f, i) => ({ f, i }))
    .sort((a, b) => rank[a.f.severity] - rank[b.f.severity] || a.i - b.i)
    .map((x) => x.f);

  const hasBlock = ordered.some((f) => f.severity === "block");
  const hasConfirm = ordered.some((f) => f.severity === "confirm");

  return {
    postable: !hasBlock,
    needsAcknowledgement: hasConfirm,
    findings: ordered,
    debitCents,
    creditCents,
    differenceCents,
  };
}

/**
 * Decide whether a draft may be submitted, given what the owner has already
 * acknowledged.
 *
 * THIS IS THE YIELD. Once every "confirm" code has been acknowledged, the
 * advisor steps aside. It does not escalate, it does not require a second
 * opinion, and it does not remember its objection as a veto — it records it and
 * lets the owner through, because the owner is the accountant here.
 */
export function canSubmit(
  verdict: AdvisorVerdict,
  acknowledgedCodes: readonly string[],
): { ok: boolean; reason: string; unacknowledged: readonly string[] } {
  const blocks = verdict.findings.filter((f) => f.severity === "block");
  if (blocks.length > 0) {
    return {
      ok: false,
      reason: blocks[0].concern,
      unacknowledged: blocks.map((b) => b.code),
    };
  }
  const ack = new Set(acknowledgedCodes);
  const missing = verdict.findings
    .filter((f) => f.severity === "confirm" && !ack.has(f.code))
    .map((f) => f.code);
  if (missing.length > 0) {
    return {
      ok: false,
      reason:
        "There are things worth a second look before this posts. Read them and confirm you meant it.",
      unacknowledged: missing,
    };
  }
  return { ok: true, reason: "", unacknowledged: [] };
}

/**
 * Build the assumption note that gets stored on the journal
 * (gl_journals.assumption_note) whenever the owner posted over a warning.
 *
 * WHY THIS EXISTS: standing rule 3 says assumptions are RECORDED, never applied
 * silently. If the advisor objected and the owner proceeded anyway, that is the
 * single most useful sentence in the entire audit trail — it is the moment a
 * judgement call was made. Losing it would make the books look more certain than
 * they are.
 */
export function buildAssumptionNote(
  verdict: AdvisorVerdict,
  acknowledgedCodes: readonly string[],
): string | null {
  const ack = new Set(acknowledgedCodes);
  const overridden = verdict.findings.filter(
    (f) => f.severity === "confirm" && ack.has(f.code),
  );
  if (overridden.length === 0) return null;
  const parts = overridden.map((f) => `${f.code}: ${f.concern}`);
  return (
    "Posted after acknowledging advisory warning(s). " +
    parts.join(" | ") +
    " The owner confirmed the entry as written."
  );
}

// ---------------------------------------------------------------------------
// SELF-TESTS
//
// Called bare by scripts/compliance/run-pure-selftests.ts, and again by
// tests/compliance/journal-advisor-core.test.ts. Returns void and THROWS on
// failure, matching the convention of every other accounting core in this repo.
// ---------------------------------------------------------------------------

function ok(cond: boolean, label: string): void {
  if (!cond) throw new Error(`journal-advisor-core: ${label}`);
}

function eq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(
      `journal-advisor-core: ${label} — expected ${String(expected)}, got ${String(actual)}`,
    );
  }
}

function acct(over: Partial<AdvisorAccount> & { code: string }): AdvisorAccount {
  return {
    name: over.name ?? `Account ${over.code}`,
    type: over.type ?? "expense",
    normalBalance: over.normalBalance ?? "debit",
    requiresCostClass: over.requiresCostClass ?? false,
    isControl: over.isControl ?? false,
    isActive: over.isActive ?? true,
    allowedEntities: over.allowedEntities,
    code: over.code,
  };
}

/** A minimal, valid, balanced, uncontroversial draft + context. */
function baseline(): { draft: AdvisorDraft; ctx: AdvisorContext } {
  return {
    draft: {
      entityCode: "greenway",
      journalDate: "2026-11-15",
      memo: "Cash purchase of shop supplies from Costco, receipt in the drawer",
      lines: [
        { accountCode: "60100", amountCents: 4523 },
        { accountCode: "10100", amountCents: -4523 },
      ],
    },
    ctx: {
      accounts: {
        "60100": acct({ code: "60100", name: "Shop supplies", type: "expense" }),
        "10100": acct({
          code: "10100",
          name: "Bank — operating",
          type: "asset",
          normalBalance: "debit",
        }),
      },
    },
  };
}

export function __runJournalAdvisorCoreTests(): void {
  // ── helpers ────────────────────────────────────────────────────────────────
  eq(sumDebits([{ accountCode: "a", amountCents: 100 }, { accountCode: "b", amountCents: -100 }]), 100, "sumDebits adds only positives");
  eq(sumCredits([{ accountCode: "a", amountCents: 100 }, { accountCode: "b", amountCents: -100 }]), 100, "sumCredits returns credits positive");
  eq(sumDebits([]), 0, "sumDebits of nothing is zero");
  eq(sumCredits([]), 0, "sumCredits of nothing is zero");
  ok(isBalanced([{ accountCode: "a", amountCents: 5 }, { accountCode: "b", amountCents: -5 }]), "balanced pair balances");
  ok(!isBalanced([{ accountCode: "a", amountCents: 5 }, { accountCode: "b", amountCents: -4 }]), "one cent out does not balance");

  eq(formatCents(0), "$0.00", "zero formats");
  eq(formatCents(5), "$0.05", "five cents formats");
  eq(formatCents(4523), "$45.23", "dollars and cents format");
  eq(formatCents(100000), "$1,000.00", "thousands get a separator");
  eq(formatCents(123456789), "$1,234,567.89", "millions get separators");
  eq(formatCents(-4523), "-$45.23", "negatives keep the sign outside");

  ok(isValidIsoDate("2026-11-01"), "a real date is valid");
  ok(isValidIsoDate("2024-02-29"), "leap day 2024 is valid");
  ok(!isValidIsoDate("2026-02-29"), "2026 has no 29 February");
  ok(!isValidIsoDate("2026-13-01"), "month 13 is invalid");
  ok(!isValidIsoDate("2026-00-01"), "month 0 is invalid");
  ok(!isValidIsoDate("2026-11-31"), "November has 30 days");
  ok(!isValidIsoDate("2026-11-00"), "day 0 is invalid");
  ok(!isValidIsoDate("11/01/2026"), "US format is rejected");
  ok(!isValidIsoDate(""), "empty is rejected");
  ok(isValidIsoDate("2000-02-29"), "2000 is a leap year (÷400)");
  ok(!isValidIsoDate("1900-02-29"), "1900 is not a leap year (÷100 not ÷400)");

  // ── WHOLE-WORD MATCHING (regression: "drawer" must not mean "draw") ───────
  // Every one of these fired a false warning under the original substring
  // matcher. They are ordinary words a real memo contains. See mentionsAny.
  {
    const innocent: ReadonlyArray<readonly [string, readonly string[]]> = [
      ["drawer", OWNER_WORDS],
      ["drawn", OWNER_WORDS],
      ["withdrawal", OWNER_WORDS],
      ["calendar", EMPLOYEE_LOAN_WORDS],
      ["excellent", EMPLOYEE_LOAN_WORDS],
      ["talent", EMPLOYEE_LOAN_WORDS],
      ["silent", EMPLOYEE_LOAN_WORDS],
      ["equivalent", EMPLOYEE_LOAN_WORDS],
      ["various", EMPLOYEE_LOAN_WORDS],
      ["curious", EMPLOYEE_LOAN_WORDS],
      ["obvious", EMPLOYEE_LOAN_WORDS],
      ["previous", EMPLOYEE_LOAN_WORDS],
      ["serious", EMPLOYEE_LOAN_WORDS],
      ["spotless", EMPLOYEE_LOAN_WORDS],
      ["treatment", ENTITY_WORDS.atm],
      ["current", ENTITY_WORDS.landholding],
      ["different", ENTITY_WORDS.landholding],
      ["parent", ENTITY_WORDS.landholding],
      ["apparent", ENTITY_WORDS.landholding],
      ["inherent", ENTITY_WORDS.landholding],
      ["transparent", ENTITY_WORDS.landholding],
      ["please", ENTITY_WORDS.landholding],
      ["release", ENTITY_WORDS.landholding],
      ["screw", EMPLOYEE_WORDS],
      ["storefront", ENTITY_WORDS.greenway],
    ];
    for (const [word, list] of innocent) {
      ok(!mentionsAny(word, list), `"${word}" must not match a keyword by substring`);
      ok(
        !mentionsAny(`paid for ${word} today`, list),
        `"${word}" in a sentence must not match a keyword`,
      );
    }
  }

  // ...but the real words, and their normal inflections, MUST still match.
  {
    ok(mentionsAny("owner draw for the month", OWNER_WORDS), "draw still matches");
    ok(mentionsAny("owner draws for the month", OWNER_WORDS), "draws (plural) matches");
    ok(mentionsAny("shareholder distribution", OWNER_WORDS), "distribution matches");
    ok(mentionsAny("loan to the budtender", EMPLOYEE_LOAN_WORDS), "loan matches");
    ok(mentionsAny("loans to the budtender", EMPLOYEE_LOAN_WORDS), "loans matches");
    ok(mentionsAny("advanced him his pay", EMPLOYEE_LOAN_WORDS), "advanced matches advance");
    ok(mentionsAny("floating him until friday", EMPLOYEE_LOAN_WORDS), "floating matches float");
    ok(mentionsAny("lent him cash", EMPLOYEE_LOAN_WORDS), "lent matches");
    ok(mentionsAny("a team member", EMPLOYEE_WORDS), "phrase 'team member' matches");
    ok(mentionsAny("two team members", EMPLOYEE_WORDS), "phrase inflection matches");
    ok(mentionsAny("rent to landholding", ENTITY_WORDS.landholding), "rent matches");
    ok(mentionsAny("ATM vault refill", ENTITY_WORDS.atm), "uppercase ATM matches");
    ok(mentionsAny("cash machine", ENTITY_WORDS.atm), "phrase 'cash machine' matches");
    // a phrase must not straddle two separate line descriptions
    ok(
      !mentionsAny("bonus for the team \u0000 member of the year", EMPLOYEE_WORDS),
      "a phrase must not straddle the description boundary",
    );
    // punctuation and digits are word boundaries, not letters
    ok(mentionsAny("owner-draw", OWNER_WORDS), "hyphen is a word boundary");
    ok(mentionsAny("(draw)", OWNER_WORDS), "parentheses are word boundaries");
    ok(!mentionsAny("", OWNER_WORDS), "empty text matches nothing");
    ok(!mentionsAny("draw", []), "an empty needle list matches nothing");
  }

  // ── the clean case produces no obstruction ────────────────────────────────
  {
    const { draft, ctx } = baseline();
    const v = evaluateJournalDraft(draft, ctx);
    ok(v.postable, "a clean entry is postable");
    ok(!v.needsAcknowledgement, "a clean entry needs no acknowledgement");
    eq(v.debitCents, 4523, "debits are summed");
    eq(v.creditCents, 4523, "credits are summed");
    eq(v.differenceCents, 0, "a clean entry has no difference");
    eq(canSubmit(v, []).ok, true, "a clean entry submits with no acknowledgements");
  }

  // ── HARD BLOCK 1: arithmetic ──────────────────────────────────────────────
  {
    const { draft, ctx } = baseline();
    const bad = { ...draft, lines: [{ accountCode: "60100", amountCents: 5000 }, { accountCode: "10100", amountCents: -4523 }] };
    const v = evaluateJournalDraft(bad, ctx);
    ok(!v.postable, "an unbalanced entry is not postable");
    ok(v.findings.some((f) => f.code === "ADV_UNBALANCED" && f.severity === "block"), "unbalanced is a hard block");
    eq(v.differenceCents, 477, "the difference is reported exactly");
    // The suggestion must name the amount, and the direction must be right.
    const f = v.findings.find((x) => x.code === "ADV_UNBALANCED")!;
    ok(f.suggestion.includes("$4.77"), "the fix names the exact amount short");
    ok(f.suggestion.toLowerCase().includes("credit"), "debits exceeding credits asks for credits");
    // And it cannot be acknowledged away — this is the yield boundary.
    eq(canSubmit(v, ["ADV_UNBALANCED"]).ok, false, "a hard block cannot be acknowledged away");
  }
  {
    // The mirror direction.
    const { draft, ctx } = baseline();
    const bad = { ...draft, lines: [{ accountCode: "60100", amountCents: 4000 }, { accountCode: "10100", amountCents: -4523 }] };
    const v = evaluateJournalDraft(bad, ctx);
    const f = v.findings.find((x) => x.code === "ADV_UNBALANCED")!;
    eq(v.differenceCents, -523, "credits exceeding debits gives a negative difference");
    ok(f.suggestion.toLowerCase().includes("debit"), "credits exceeding debits asks for debits");
    ok(f.suggestion.includes("$5.23"), "the mirror fix names the amount without a minus sign");
  }
  {
    const { draft, ctx } = baseline();
    const oneLine = { ...draft, lines: [{ accountCode: "60100", amountCents: 4523 }] };
    const v = evaluateJournalDraft(oneLine, ctx);
    ok(!v.postable, "a one-line entry is not postable");
    ok(v.findings.some((f) => f.code === "ADV_UNBALANCED"), "one line is reported as unbalanced");
  }

  // ── HARD BLOCK 2: closed period ───────────────────────────────────────────
  {
    const { draft, ctx } = baseline();
    const v = evaluateJournalDraft(draft, { ...ctx, periodClosed: true });
    ok(!v.postable, "a closed period blocks");
    const f = v.findings.find((x) => x.code === "ADV_PERIOD_CLOSED")!;
    eq(f.severity, "block", "closed period is a hard block");
    ok(f.concern.includes("2026-11-15"), "the block names the offending date");
    eq(canSubmit(v, ["ADV_PERIOD_CLOSED"]).ok, false, "a closed period cannot be acknowledged away");
  }

  // ── HARD BLOCK 3: excise miscoded ─────────────────────────────────────────
  {
    const v = evaluateJournalDraft(
      {
        entityCode: "greenway",
        journalDate: "2026-11-15",
        memo: "Excise tax on November cannabis sales",
        lines: [
          { accountCode: "40100", amountCents: 100000 },
          { accountCode: "10100", amountCents: -100000 },
        ],
      },
      {
        accounts: {
          "40100": acct({ code: "40100", name: "Cannabis revenue", type: "revenue", normalBalance: "credit" }),
          "10100": acct({ code: "10100", name: "Bank", type: "asset" }),
        },
        exciseAccountCodes: ["40100"],
      },
    );
    ok(!v.postable, "excise as revenue is blocked");
    const f = v.findings.find((x) => x.code === "ADV_EXCISE_MISCODED")!;
    eq(f.severity, "block", "excise miscoding is a hard block");
    ok(f.authority!.includes("69.50.535"), "the excise block cites the statute");
    ok(f.concern.includes("never yours"), "the excise block explains whose money it is");
    eq(f.lines.length, 1, "the excise block points at the offending line");
    eq(f.lines[0], 1, "the excise block names line 1");
  }
  {
    // Excise coded correctly to a LIABILITY must NOT block. This is the control:
    // if it fired here the check would be worthless.
    const v = evaluateJournalDraft(
      {
        entityCode: "greenway",
        journalDate: "2026-11-15",
        memo: "Excise tax accrued on November cannabis sales",
        lines: [
          { accountCode: "10100", amountCents: 100000 },
          { accountCode: "20500", amountCents: -100000 },
        ],
      },
      {
        accounts: {
          "10100": acct({ code: "10100", name: "Bank", type: "asset" }),
          "20500": acct({ code: "20500", name: "Excise tax payable", type: "liability", normalBalance: "credit" }),
        },
        exciseAccountCodes: ["20500"],
      },
    );
    ok(!v.findings.some((f) => f.code === "ADV_EXCISE_MISCODED"), "excise in a liability account does not block");
  }

  // ── the three hard blocks are the ONLY hard blocks by policy ───────────────
  eq(HARD_BLOCK_REASONS.length, 3, "there are exactly three policy hard blocks");
  ok(HARD_BLOCK_REASONS.includes("ADV_UNBALANCED"), "unbalanced is one");
  ok(HARD_BLOCK_REASONS.includes("ADV_PERIOD_CLOSED"), "closed period is one");
  ok(HARD_BLOCK_REASONS.includes("ADV_EXCISE_MISCODED"), "excise miscoding is one");

  // ── the employee loan: the owner's own worked example ─────────────────────
  {
    const v = evaluateJournalDraft(
      {
        entityCode: "greenway",
        journalDate: "2026-11-15",
        memo: "Loaned employee Dave $500 against his next cheque",
        lines: [
          { accountCode: "60900", amountCents: 50000 },
          { accountCode: "10100", amountCents: -50000 },
        ],
      },
      {
        accounts: {
          "60900": acct({ code: "60900", name: "Miscellaneous expense", type: "expense" }),
          "10100": acct({ code: "10100", name: "Bank", type: "asset" }),
        },
        employeeAdvanceAccountCodes: ["11800"],
      },
    );
    ok(v.postable, "the employee loan is NOT blocked — the owner may record it");
    ok(v.needsAcknowledgement, "the employee loan asks for confirmation");
    const f = v.findings.find((x) => x.code === "ADV_EMPLOYEE_LOAN")!;
    eq(f.severity, "confirm", "the employee loan is advice, not law");
    ok(f.concern.includes("receivable"), "it explains what the entry really is");
    ok(f.authority!.includes("7872"), "it cites §7872");
    ok(f.suggestion.includes("under the $10,000 threshold"), "$500 is correctly described as under the de minimis");
    // AND THE YIELD: acknowledge it and it posts.
    eq(canSubmit(v, ["ADV_EMPLOYEE_LOAN"]).ok, true, "acknowledging the loan warning lets it post");
  }
  {
    // Over the de minimis the wording must change. Same finding, different advice.
    const v = evaluateJournalDraft(
      {
        entityCode: "greenway",
        journalDate: "2026-11-15",
        memo: "Loan to employee Dave for his truck repair",
        lines: [
          { accountCode: "60900", amountCents: 1500000 },
          { accountCode: "10100", amountCents: -1500000 },
        ],
      },
      {
        accounts: {
          "60900": acct({ code: "60900", type: "expense" }),
          "10100": acct({ code: "10100", type: "asset" }),
        },
      },
    );
    const f = v.findings.find((x) => x.code === "ADV_EMPLOYEE_LOAN")!;
    ok(f.suggestion.includes("above the $10,000 threshold"), "$15,000 is correctly described as above the de minimis");
    ok(f.suggestion.includes("impute"), "above the threshold it warns about imputed interest");
  }
  {
    // Exactly AT the de minimis is NOT above it. §7872(c)(3)(A) says "does not
    // exceed", so $10,000 exactly is still exempt. Boundary matters.
    const v = evaluateJournalDraft(
      {
        entityCode: "greenway",
        journalDate: "2026-11-15",
        memo: "Loan to employee Dave, ten thousand even",
        lines: [
          { accountCode: "60900", amountCents: SECTION_7872_DE_MINIMIS_CENTS },
          { accountCode: "10100", amountCents: -SECTION_7872_DE_MINIMIS_CENTS },
        ],
      },
      {
        accounts: {
          "60900": acct({ code: "60900", type: "expense" }),
          "10100": acct({ code: "10100", type: "asset" }),
        },
      },
    );
    const f = v.findings.find((x) => x.code === "ADV_EMPLOYEE_LOAN")!;
    ok(f.suggestion.includes("under the $10,000 threshold"), "exactly $10,000 does not exceed the threshold");
  }
  {
    // If it is ALREADY coded to the advance receivable, do not nag.
    const v = evaluateJournalDraft(
      {
        entityCode: "greenway",
        journalDate: "2026-11-15",
        memo: "Loaned employee Dave $500 against his next cheque",
        lines: [
          { accountCode: "11800", amountCents: 50000 },
          { accountCode: "10100", amountCents: -50000 },
        ],
      },
      {
        accounts: {
          "11800": acct({ code: "11800", name: "Employee advances", type: "asset" }),
          "10100": acct({ code: "10100", type: "asset" }),
        },
        employeeAdvanceAccountCodes: ["11800"],
      },
    );
    ok(!v.findings.some((f) => f.code === "ADV_EMPLOYEE_LOAN"), "a correctly coded loan draws no objection");
  }

  // ── owner draw as expense ─────────────────────────────────────────────────
  {
    const v = evaluateJournalDraft(
      {
        entityCode: "greenway",
        journalDate: "2026-11-15",
        memo: "Michael took money out for personal use",
        lines: [
          { accountCode: "60900", amountCents: 200000 },
          { accountCode: "10100", amountCents: -200000 },
        ],
      },
      {
        accounts: {
          "60900": acct({ code: "60900", type: "expense" }),
          "10100": acct({ code: "10100", type: "asset" }),
        },
      },
    );
    const f = v.findings.find((x) => x.code === "ADV_OWNER_DRAW_AS_EXPENSE")!;
    eq(f.severity, "confirm", "an owner draw miscoding is advice");
    ok(f.concern.includes("distribution"), "it names what it should be");
    ok(v.postable, "the owner draw finding does not block");
  }
  {
    // In the PERSONAL books, personal words are expected and must not fire.
    const v = evaluateJournalDraft(
      {
        entityCode: "personal",
        journalDate: "2026-11-15",
        memo: "Michael personal grocery spending for the month",
        lines: [
          { accountCode: "60900", amountCents: 200000 },
          { accountCode: "10100", amountCents: -200000 },
        ],
      },
      {
        accounts: {
          "60900": acct({ code: "60900", type: "expense" }),
          "10100": acct({ code: "10100", type: "asset" }),
        },
      },
    );
    ok(!v.findings.some((f) => f.code === "ADV_OWNER_DRAW_AS_EXPENSE"), "personal books do not trigger the owner-draw warning");
  }

  // ── 280E cost class ───────────────────────────────────────────────────────
  {
    const ctx: AdvisorContext = {
      accounts: {
        "50100": acct({ code: "50100", name: "Cannabis COGS", type: "cogs", requiresCostClass: true }),
        "10100": acct({ code: "10100", type: "asset" }),
      },
    };
    const untagged = evaluateJournalDraft(
      {
        entityCode: "greenway",
        journalDate: "2026-11-15",
        memo: "Cash purchase of flower from a farm, invoice 4471",
        lines: [
          { accountCode: "50100", amountCents: 123456 },
          { accountCode: "10100", amountCents: -123456 },
        ],
      },
      ctx,
    );
    const f = untagged.findings.find((x) => x.code === "ADV_MISSING_COST_CLASS")!;
    eq(f.severity, "confirm", "a missing cost class asks, it does not block");
    ok(f.authority!.includes("280E"), "the cost-class finding cites §280E");
    ok(f.authority!.includes("471"), "the cost-class finding cites §471");
    ok(untagged.postable, "a missing cost class does not stop the entry");

    const tagged = evaluateJournalDraft(
      {
        entityCode: "greenway",
        journalDate: "2026-11-15",
        memo: "Cash purchase of flower from a farm, invoice 4471",
        lines: [
          { accountCode: "50100", amountCents: 123456, costClass: "cogs_direct" },
          { accountCode: "10100", amountCents: -123456 },
        ],
      },
      ctx,
    );
    ok(!tagged.findings.some((x) => x.code === "ADV_MISSING_COST_CLASS"), "a tagged line draws no cost-class objection");

    // 'none' on a requiring account is the same as absent — this is the subtle
    // one, because 'none' is a legal enum value and looks like an answer.
    const noned = evaluateJournalDraft(
      {
        entityCode: "greenway",
        journalDate: "2026-11-15",
        memo: "Cash purchase of flower from a farm, invoice 4471",
        lines: [
          { accountCode: "50100", amountCents: 123456, costClass: "none" },
          { accountCode: "10100", amountCents: -123456 },
        ],
      },
      ctx,
    );
    ok(noned.findings.some((x) => x.code === "ADV_MISSING_COST_CLASS"), "'none' on a requiring account still asks");
  }

  // ── personal cost inside business books ───────────────────────────────────
  {
    const v = evaluateJournalDraft(
      {
        entityCode: "greenway",
        journalDate: "2026-11-15",
        memo: "Bought a birthday gift, not a business cost",
        lines: [
          { accountCode: "60900", amountCents: 5000, costClass: "personal" },
          { accountCode: "10100", amountCents: -5000 },
        ],
      },
      {
        accounts: {
          "60900": acct({ code: "60900", type: "expense" }),
          "10100": acct({ code: "10100", type: "asset" }),
        },
      },
    );
    const f = v.findings.find((x) => x.code === "ADV_PERSONAL_IN_BUSINESS")!;
    eq(f.severity, "confirm", "personal-in-business asks");
    ok(f.concern.includes("audit"), "it explains the real risk");
    // In the personal books the same line is fine.
    const okDraft = evaluateJournalDraft(
      {
        entityCode: "personal",
        journalDate: "2026-11-15",
        memo: "Bought a birthday gift, not a business cost",
        lines: [
          { accountCode: "60900", amountCents: 5000, costClass: "personal" },
          { accountCode: "10100", amountCents: -5000 },
        ],
      },
      {
        accounts: {
          "60900": acct({ code: "60900", type: "expense" }),
          "10100": acct({ code: "10100", type: "asset" }),
        },
      },
    );
    ok(!okDraft.findings.some((f2) => f2.code === "ADV_PERSONAL_IN_BUSINESS"), "personal tag in personal books is fine");
  }

  // ── capitalisation ────────────────────────────────────────────────────────
  {
    const ctx: AdvisorContext = {
      accounts: {
        "60900": acct({ code: "60900", type: "expense" }),
        "10100": acct({ code: "10100", type: "asset" }),
      },
    };
    const big = evaluateJournalDraft(
      {
        entityCode: "greenway",
        journalDate: "2026-11-15",
        memo: "Bought a walk-in safe for the back room, invoice 88120",
        lines: [
          { accountCode: "60900", amountCents: 900000 },
          { accountCode: "10100", amountCents: -900000 },
        ],
      },
      ctx,
    );
    const f = big.findings.find((x) => x.code === "ADV_CAPITALISABLE")!;
    eq(f.severity, "confirm", "a large expense asks about capitalising");
    ok(f.authority!.includes("263"), "it cites the capitalisation regulation");

    // Just BELOW the safe harbour must not fire. Boundary test.
    const small = evaluateJournalDraft(
      {
        entityCode: "greenway",
        journalDate: "2026-11-15",
        memo: "Bought a printer for the back office, invoice 88121",
        lines: [
          { accountCode: "60900", amountCents: DE_MINIMIS_CAPITALISATION_CENTS - 1 },
          { accountCode: "10100", amountCents: -(DE_MINIMIS_CAPITALISATION_CENTS - 1) },
        ],
      },
      ctx,
    );
    ok(!small.findings.some((x) => x.code === "ADV_CAPITALISABLE"), "one cent under the safe harbour does not ask");

    // Exactly AT the threshold DOES fire (>= is the rule).
    const atLimit = evaluateJournalDraft(
      {
        entityCode: "greenway",
        journalDate: "2026-11-15",
        memo: "Bought a display case for the sales floor, invoice 88122",
        lines: [
          { accountCode: "60900", amountCents: DE_MINIMIS_CAPITALISATION_CENTS },
          { accountCode: "10100", amountCents: -DE_MINIMIS_CAPITALISATION_CENTS },
        ],
      },
      ctx,
    );
    ok(atLimit.findings.some((x) => x.code === "ADV_CAPITALISABLE"), "exactly at the safe harbour does ask");

    // A CREDIT to an expense (a refund) is not capitalisable.
    const refund = evaluateJournalDraft(
      {
        entityCode: "greenway",
        journalDate: "2026-11-15",
        memo: "Refund received on the returned display case, credit note 91",
        lines: [
          { accountCode: "60900", amountCents: -900000 },
          { accountCode: "10100", amountCents: 900000 },
        ],
      },
      ctx,
    );
    ok(!refund.findings.some((x) => x.code === "ADV_CAPITALISABLE"), "a refund credit is not a capitalisation question");

    // A custom threshold must be honoured.
    const custom = evaluateJournalDraft(
      {
        entityCode: "greenway",
        journalDate: "2026-11-15",
        memo: "Bought two office chairs for the back office, invoice 88123",
        lines: [
          { accountCode: "60900", amountCents: 60000 },
          { accountCode: "10100", amountCents: -60000 },
        ],
      },
      { ...ctx, capitalisationThresholdCents: 50000 },
    );
    ok(custom.findings.some((x) => x.code === "ADV_CAPITALISABLE"), "a lowered threshold is honoured");
  }

  // ── control accounts ──────────────────────────────────────────────────────
  {
    const v = evaluateJournalDraft(
      {
        entityCode: "greenway",
        journalDate: "2026-11-15",
        memo: "Adjusting accounts payable by hand for a vendor credit",
        lines: [
          { accountCode: "20100", amountCents: 25000 },
          { accountCode: "60900", amountCents: -25000 },
        ],
      },
      {
        accounts: {
          "20100": acct({ code: "20100", name: "Accounts payable", type: "liability", normalBalance: "credit", isControl: true }),
          "60900": acct({ code: "60900", type: "expense" }),
        },
      },
    );
    const f = v.findings.find((x) => x.code === "ADV_CONTROL_ACCOUNT")!;
    eq(f.severity, "confirm", "hand-keying a control account asks");
    ok(f.concern.includes("disagree"), "it explains the subledger consequence");
    ok(v.postable, "a control account warning does not block");
    eq(canSubmit(v, ["ADV_CONTROL_ACCOUNT"]).ok, true, "acknowledging lets the manual correction through");
  }

  // ── inactive + wrong entity ───────────────────────────────────────────────
  {
    const v = evaluateJournalDraft(
      {
        entityCode: "greenway",
        journalDate: "2026-11-15",
        memo: "Posting to a retired account by mistake",
        lines: [
          { accountCode: "69999", amountCents: 1000 },
          { accountCode: "10100", amountCents: -1000 },
        ],
      },
      {
        accounts: {
          "69999": acct({ code: "69999", type: "expense", isActive: false }),
          "10100": acct({ code: "10100", type: "asset" }),
        },
      },
    );
    ok(v.findings.some((f) => f.code === "ADV_INACTIVE_ACCOUNT" && f.severity === "confirm"), "an inactive account asks");
  }
  {
    const v = evaluateJournalDraft(
      {
        entityCode: "greenway",
        journalDate: "2026-11-15",
        memo: "Posting an ATM-only account into the store books",
        lines: [
          { accountCode: "10300", amountCents: 1000 },
          { accountCode: "10100", amountCents: -1000 },
        ],
      },
      {
        accounts: {
          "10300": acct({ code: "10300", name: "Bank — ATM vault", type: "asset", allowedEntities: ["atm"] }),
          "10100": acct({ code: "10100", type: "asset" }),
        },
      },
    );
    const f = v.findings.find((x) => x.code === "ADV_WRONG_ENTITY")!;
    eq(f.severity, "confirm", "a wrong-entity account asks");
    ok(f.concern.includes("taxed separately"), "it explains why entities are separate");
  }
  {
    // An account with an EMPTY allowedEntities list means "any entity".
    const v = evaluateJournalDraft(
      {
        entityCode: "greenway",
        journalDate: "2026-11-15",
        memo: "Using a shared account available to every entity",
        lines: [
          { accountCode: "10100", amountCents: 1000 },
          { accountCode: "60900", amountCents: -1000 },
        ],
      },
      {
        accounts: {
          "10100": acct({ code: "10100", type: "asset", allowedEntities: [] }),
          "60900": acct({ code: "60900", type: "expense" }),
        },
      },
    );
    ok(!v.findings.some((f) => f.code === "ADV_WRONG_ENTITY"), "an empty allowed-entity list means all entities");
  }

  // ── unknown account is a block (cannot post to nothing) ───────────────────
  {
    const v = evaluateJournalDraft(
      {
        entityCode: "greenway",
        journalDate: "2026-11-15",
        memo: "Typed an account code that does not exist anywhere",
        lines: [
          { accountCode: "99999", amountCents: 1000 },
          { accountCode: "10100", amountCents: -1000 },
        ],
      },
      { accounts: { "10100": acct({ code: "10100", type: "asset" }) } },
    );
    ok(!v.postable, "an unknown account blocks");
    ok(v.findings.some((f) => f.code === "ADV_UNKNOWN_ACCOUNT" && f.severity === "block"), "unknown account is a block");
  }

  // ── zero and non-integer amounts ──────────────────────────────────────────
  {
    const v = evaluateJournalDraft(
      {
        entityCode: "greenway",
        journalDate: "2026-11-15",
        memo: "Entry with a line left unfilled by accident",
        lines: [
          { accountCode: "60900", amountCents: 0 },
          { accountCode: "10100", amountCents: 0 },
        ],
      },
      {
        accounts: {
          "60900": acct({ code: "60900", type: "expense" }),
          "10100": acct({ code: "10100", type: "asset" }),
        },
      },
    );
    ok(v.findings.some((f) => f.code === "ADV_ZERO_LINE"), "zero lines are flagged");
  }
  {
    const v = evaluateJournalDraft(
      {
        entityCode: "greenway",
        journalDate: "2026-11-15",
        memo: "Entry with a fractional cent amount typed in",
        lines: [
          { accountCode: "60900", amountCents: 10.5 },
          { accountCode: "10100", amountCents: -10.5 },
        ],
      },
      {
        accounts: {
          "60900": acct({ code: "60900", type: "expense" }),
          "10100": acct({ code: "10100", type: "asset" }),
        },
      },
    );
    ok(!v.postable, "a fractional cent blocks");
    ok(v.findings.some((f) => f.code === "ADV_NON_INTEGER_AMOUNT"), "fractional cents are named");
  }

  // ── intercompany ──────────────────────────────────────────────────────────
  {
    const v = evaluateJournalDraft(
      {
        entityCode: "greenway",
        journalDate: "2026-11-15",
        memo: "Monthly rent paid to landholding for the Geiger building",
        lines: [
          { accountCode: "60900", amountCents: 200000 },
          { accountCode: "10100", amountCents: -200000 },
        ],
      },
      {
        accounts: {
          "60900": acct({ code: "60900", type: "expense" }),
          "10100": acct({ code: "10100", type: "asset" }),
        },
      },
    );
    const f = v.findings.find((x) => x.code === "ADV_INTERCOMPANY")!;
    eq(f.severity, "confirm", "intercompany asks");
    ok(f.concern.includes("landholding"), "it names the other entity it spotted");
    ok(f.authority!.includes("482"), "it cites §482");
  }
  {
    // Words matching the CURRENT entity must not trigger it.
    const v = evaluateJournalDraft(
      {
        entityCode: "greenway",
        journalDate: "2026-11-15",
        memo: "Greenway retail supplies purchased for the store floor",
        lines: [
          { accountCode: "60900", amountCents: 2000 },
          { accountCode: "10100", amountCents: -2000 },
        ],
      },
      {
        accounts: {
          "60900": acct({ code: "60900", type: "expense" }),
          "10100": acct({ code: "10100", type: "asset" }),
        },
      },
    );
    ok(!v.findings.some((f) => f.code === "ADV_INTERCOMPANY"), "mentioning your own entity is not intercompany");
  }

  // ── memo quality + date ───────────────────────────────────────────────────
  {
    const { ctx } = baseline();
    const v = evaluateJournalDraft(
      { entityCode: "greenway", journalDate: "2026-11-15", memo: "x", lines: [{ accountCode: "60100", amountCents: 1 }, { accountCode: "10100", amountCents: -1 }] },
      ctx,
    );
    ok(!v.postable, "a one-character memo blocks");
    ok(v.findings.some((f) => f.code === "ADV_MEMO_TOO_SHORT"), "too-short memo is named");
  }
  {
    const { ctx } = baseline();
    const v = evaluateJournalDraft(
      { entityCode: "greenway", journalDate: "2026-11-15", memo: "adjustment", lines: [{ accountCode: "60100", amountCents: 1 }, { accountCode: "10100", amountCents: -1 }] },
      ctx,
    );
    ok(v.postable, "a vague memo does not block");
    ok(v.findings.some((f) => f.code === "ADV_MEMO_VAGUE" && f.severity === "advise"), "a vague memo is advisory only");
    eq(canSubmit(v, []).ok, true, "advisory findings never require acknowledgement");
  }
  {
    const { ctx } = baseline();
    const v = evaluateJournalDraft(
      { entityCode: "greenway", journalDate: "2026-02-30", memo: "A perfectly reasonable memo here", lines: [{ accountCode: "60100", amountCents: 1 }, { accountCode: "10100", amountCents: -1 }] },
      ctx,
    );
    ok(!v.postable, "an impossible date blocks");
    ok(v.findings.some((f) => f.code === "ADV_BAD_DATE"), "the bad date is named");
  }

  // ── round numbers are advice only ─────────────────────────────────────────
  {
    const v = evaluateJournalDraft(
      {
        entityCode: "greenway",
        journalDate: "2026-11-15",
        memo: "Transferred cash between the two operating accounts",
        lines: [
          { accountCode: "10100", amountCents: 500000 },
          { accountCode: "10200", amountCents: -500000 },
        ],
      },
      {
        accounts: {
          "10100": acct({ code: "10100", type: "asset" }),
          "10200": acct({ code: "10200", type: "asset" }),
        },
      },
    );
    ok(v.findings.some((f) => f.code === "ADV_ROUND_NUMBER" && f.severity === "advise"), "all-round amounts are noted");
    ok(v.postable && !v.needsAcknowledgement, "round numbers never obstruct");
  }

  // ── ordering is stable and severity-sorted ────────────────────────────────
  {
    const v = evaluateJournalDraft(
      {
        entityCode: "greenway",
        journalDate: "2026-11-15",
        memo: "misc",
        lines: [
          { accountCode: "50100", amountCents: 900000 },
          { accountCode: "10100", amountCents: -800000 },
        ],
      },
      {
        accounts: {
          "50100": acct({ code: "50100", type: "cogs", requiresCostClass: true }),
          "10100": acct({ code: "10100", type: "asset" }),
        },
      },
    );
    const sev = v.findings.map((f) => f.severity);
    const rank: Record<AdvisorSeverity, number> = { block: 0, confirm: 1, advise: 2 };
    for (let i = 1; i < sev.length; i += 1) {
      ok(rank[sev[i - 1]] <= rank[sev[i]], "findings are sorted blocks first, advice last");
    }
    // Determinism: the same input twice gives the identical finding order.
    const again = evaluateJournalDraft(
      {
        entityCode: "greenway",
        journalDate: "2026-11-15",
        memo: "misc",
        lines: [
          { accountCode: "50100", amountCents: 900000 },
          { accountCode: "10100", amountCents: -800000 },
        ],
      },
      {
        accounts: {
          "50100": acct({ code: "50100", type: "cogs", requiresCostClass: true }),
          "10100": acct({ code: "10100", type: "asset" }),
        },
      },
    );
    eq(
      again.findings.map((f) => f.code).join(","),
      v.findings.map((f) => f.code).join(","),
      "evaluation is deterministic",
    );
  }

  // ── canSubmit semantics ───────────────────────────────────────────────────
  {
    const v = evaluateJournalDraft(
      {
        entityCode: "greenway",
        journalDate: "2026-11-15",
        memo: "Loaned employee Dave money and also hand-keyed payables",
        lines: [
          { accountCode: "60900", amountCents: 25000 },
          { accountCode: "20100", amountCents: -25000 },
        ],
      },
      {
        accounts: {
          "60900": acct({ code: "60900", type: "expense" }),
          "20100": acct({ code: "20100", type: "liability", normalBalance: "credit", isControl: true }),
        },
      },
    );
    const confirms = v.findings.filter((f) => f.severity === "confirm").map((f) => f.code);
    ok(confirms.length >= 2, "the combined case raises at least two confirmations");
    // Partial acknowledgement is not enough.
    const partial = canSubmit(v, [confirms[0]]);
    eq(partial.ok, false, "acknowledging only one of two is not enough");
    ok(partial.unacknowledged.includes(confirms[1]), "the outstanding one is named");
    // Full acknowledgement yields.
    eq(canSubmit(v, confirms).ok, true, "acknowledging all confirmations posts the entry");
    // Unknown extra acknowledgements are harmless.
    eq(canSubmit(v, [...confirms, "ADV_NOT_A_REAL_CODE"]).ok, true, "stray acknowledgements are ignored");
  }

  // ── the assumption note: the audit trail of a judgement call ──────────────
  {
    const v = evaluateJournalDraft(
      {
        entityCode: "greenway",
        journalDate: "2026-11-15",
        memo: "Loaned employee Dave $500 against his next cheque",
        lines: [
          { accountCode: "60900", amountCents: 50000 },
          { accountCode: "10100", amountCents: -50000 },
        ],
      },
      {
        accounts: {
          "60900": acct({ code: "60900", type: "expense" }),
          "10100": acct({ code: "10100", type: "asset" }),
        },
      },
    );
    eq(buildAssumptionNote(v, []), null, "no acknowledgement means no assumption note");
    const note = buildAssumptionNote(v, ["ADV_EMPLOYEE_LOAN"])!;
    ok(note.includes("ADV_EMPLOYEE_LOAN"), "the note names the warning that was overridden");
    ok(note.includes("owner confirmed"), "the note records that the owner confirmed");
    // An advisory-only finding is NOT an override and must not appear.
    const clean = evaluateJournalDraft(baseline().draft, baseline().ctx);
    eq(buildAssumptionNote(clean, ["ADV_ROUND_NUMBER"]), null, "advisory findings are not overrides");
  }

  // ── the pattern library is coherent ───────────────────────────────────────
  {
    const codes = new Set<string>();
    for (const p of ADVISOR_PATTERNS) {
      ok(p.code.startsWith("ADV_"), `pattern ${p.code} uses the ADV_ prefix`);
      ok(!codes.has(p.code), `pattern ${p.code} is not duplicated`);
      codes.add(p.code);
      ok(p.label.length > 0, `pattern ${p.code} has a label`);
      ok(p.concern.length > 40, `pattern ${p.code} explains the concern properly`);
      ok(p.suggestion.length > 40, `pattern ${p.code} offers a real suggestion`);
      // THE CENTRAL GUARANTEE: a pattern must never be phrased as a refusal.
      ok(
        !/\bcannot be posted\b|\brefused\b|\bnot allowed\b/i.test(p.suggestion),
        `pattern ${p.code} offers help rather than refusing`,
      );
    }
    eq(findPattern("ADV_EMPLOYEE_LOAN")!.code, "ADV_EMPLOYEE_LOAN", "findPattern finds a real pattern");
    eq(findPattern("nope"), undefined, "findPattern returns undefined for nonsense");
    ok(ADVISOR_PATTERNS.length >= 8, "the pattern library covers at least eight situations");
  }

  // ── cost class list matches the database enum exactly ────────────────────
  {
    eq(ADVISOR_COST_CLASSES.length, 6, "there are six cost classes");
    for (const c of ["cogs_direct", "cogs_allocable", "nondeductible_280e", "separate_business", "personal", "none"]) {
      ok(ADVISOR_COST_CLASSES.includes(c as AdvisorCostClass), `${c} is a known cost class`);
    }
  }

  // ── §7872 and §1.263 constants are the verified values ───────────────────
  eq(SECTION_7872_DE_MINIMIS_CENTS, 1000000, "the §7872 de minimis is $10,000");
  eq(DE_MINIMIS_CAPITALISATION_CENTS, 250000, "the §1.263(a)-1(f) safe harbour is $2,500");
}
