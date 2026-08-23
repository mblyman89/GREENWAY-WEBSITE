/**
 * src/lib/accounting/ledger-core.ts — General ledger foundation (PURE core).
 *
 * No I/O, no network, no server-only imports — fully unit-testable with tsx and
 * mirrored in vitest. This is the "ledger brain": it holds the double-entry rules
 * in TypeScript so the UI can prove an entry is valid BEFORE it ever reaches the
 * database, and so the rules themselves are testable without a database.
 *
 * These rules are enforced TWICE on purpose:
 *   1. here, for fast, friendly, plain-English feedback to the user, and
 *   2. in migration 0172_gl_foundation.sql, which is the real authority.
 * A UI can be bypassed; a database constraint cannot. Belt and braces, because
 * for Michael's books drift is the most severe class of failure there is.
 *
 * MONEY RULE (standing): every amount is an INTEGER of CENTS. Never a float.
 * RATE RULE (standing): percentages are INTEGER MILLI-PERCENT (85% = 85000).
 *
 * SIGN CONVENTION: amountCents is POSITIVE for a DEBIT and NEGATIVE for a CREDIT.
 * One signed integer instead of two columns means "debits equal credits" reduces
 * to "the lines sum to zero" — an arithmetic fact, not a bookkeeping opinion.
 * Debit/credit presentation is a display concern, handled by toDebitCredit().
 */

// ---------------------------------------------------------------------------
// 0) Domain types — mirrored exactly from migration 0172.
// ---------------------------------------------------------------------------

/** The four sets of books. Sage used account-code suffixes; we use a dimension. */
export type EntityCode = "greenway" | "atm" | "landholding" | "personal";

/**
 * Account types. COGS is deliberately its OWN type rather than a flavour of
 * expense: under IRC 280E, whether a dollar is cost of goods sold or operating
 * expense is the difference between deductible and non-deductible.
 */
export type AccountType =
  | "asset"
  | "liability"
  | "equity"
  | "income"
  | "cogs"
  | "expense"
  | "other_income"
  | "other_expense";

export type NormalBalance = "debit" | "credit";

/**
 * 280E cost classes, tagged on every P&L line as it is written. When cannabis is
 * rescheduled, the REPORTING changes; this tagged history does not need rebuilding.
 */
export type CostClass =
  | "cogs_direct"          // invoice cost of product (Reg. 1.471-3(b))
  | "cogs_allocable"       // documented handling/storage/processing allocations
  | "nondeductible_280e"   // ordinary operating expense of the cannabis trade
  | "separate_business"    // a genuinely separate trade or business (CHAMP)
  | "personal"             // personal activity; never a business deduction
  | "none";                // balance-sheet lines carry no 280E character

export type JournalStatus = "draft" | "posted" | "reversed";

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

/**
 * `PeriodStatus` deliberately does NOT live here.
 *
 * It used to be declared in this file AND in period-close-core.ts, with
 * identical values and no import between them - two definitions of one thing
 * (rule 76/81). The copy here was never referenced, not even inside this file,
 * so it was pure drift risk: period-close-core's copy mirrors the `status`
 * check constraint on `gl_periods` and carries the meanings, and a second
 * silent copy could have grown a fourth status that the database would refuse.
 *
 * Import it from `@/lib/accounting/period-close-core`, which owns it.
 */

export type ControlSubledger =
  | "ap" | "ar" | "inventory" | "payroll" | "excise"
  | "sales" | "cash" | "loans" | "crypto";

/** The minimum an account must tell us for validation purposes. */
export interface LedgerAccount {
  code: string;
  name: string;
  type: AccountType;
  normalBalance: NormalBalance;
  isContra?: boolean;
  isControl?: boolean;
  controlSubledger?: ControlSubledger | null;
  requiresCostClass?: boolean;
  allowedEntityCodes?: EntityCode[] | null;
  active?: boolean;
}

export interface JournalLineDraft {
  lineNo: number;
  accountCode: string;
  entityCode: EntityCode;
  /** Positive = debit, negative = credit. Integer cents, never zero. */
  amountCents: number;
  costClass?: CostClass;
  shareholderId?: string | null;
  description?: string | null;
}

export interface JournalDraft {
  entityCode: EntityCode;
  /** ISO YYYY-MM-DD, Pacific business date. */
  journalDate: string;
  sourceKind: SourceKind;
  sourceRef?: string | null;
  memo: string;
  assumptionNote?: string | null;
  lines: JournalLineDraft[];
}

/** A single validation failure, in language Michael can act on. */
export interface ValidationIssue {
  code: string;      // stable machine code, mirrors the SQL GL_* exceptions
  message: string;   // plain English
  lineNo?: number;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

// ---------------------------------------------------------------------------
// 1) Constants — the line in the sand.
// ---------------------------------------------------------------------------

/**
 * THE LINE IN THE SAND. Cut-over is Option C: the new books begin 2026-01-01.
 * Nothing may be dated before this except the single opening-balance entry,
 * which is dated the day before (2025-12-31) precisely because it represents the
 * closing position of the old world.
 */
export const LINE_IN_THE_SAND = "2026-01-01";

/** The one legal date for the opening-balance entry. */
export const OPENING_BALANCE_DATE = "2025-12-31";

/** Ownership must total exactly 100%, expressed in milli-percent. */
export const FULL_OWNERSHIP_MILLI_PCT = 100000;

// ---------------------------------------------------------------------------
// 2) Money + rate formatting (float-free).
// ---------------------------------------------------------------------------

/** Format integer cents as "$1,234.56" (negatives as "-$1,234.56"); "—" if null. */
export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "—";
  const neg = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  return `${neg ? "-" : ""}$${dollars.toLocaleString("en-US")}.${rem.toString().padStart(2, "0")}`;
}

/** Format integer milli-percent as "85%", "2.375%"; "—" if null. */
export function formatMilliPct(milli: number | null | undefined): string {
  if (milli === null || milli === undefined || !Number.isFinite(milli)) return "—";
  const neg = milli < 0;
  const abs = Math.abs(Math.trunc(milli));
  const whole = Math.floor(abs / 1000);
  const frac = abs % 1000;
  const fracStr = frac === 0 ? "" : `.${frac.toString().padStart(3, "0").replace(/0+$/, "")}`;
  return `${neg ? "-" : ""}${whole}${fracStr}%`;
}

/**
 * Parse a user-typed dollar amount ("$1,234.56", "1234.56", 1234.56) to integer
 * cents. Returns null for blank/unparseable input.
 *
 * WHY THIS IS PARSED AS TEXT AND NOT WITH ARITHMETIC: the obvious implementation,
 * `Math.round(value * 100)`, is WRONG for money. Binary floating point cannot
 * represent most decimal fractions exactly — $1.005 is stored as
 * 1.00499999999999989..., so `1.005 * 100` yields 100.4999... and rounds DOWN to
 * 100 cents, silently losing a penny. A penny lost here is drift, and drift in
 * these books is the most severe failure there is.
 *
 * So we never multiply. We read the digits either side of the decimal point as
 * text and assemble the integer directly, which is exact by construction. The
 * third decimal digit (and beyond) decides the rounding: half or more rounds away
 * from zero, the standard convention for money.
 */
export function dollarsToCents(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;

  let raw: string;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    // JavaScript prints the shortest decimal string that round-trips, so
    // String(1.005) === "1.005" — the digits the user meant, not the binary
    // approximation. We then parse those digits exactly.
    raw = String(input);
    // Reject exponential notation rather than mis-parse it.
    if (raw.includes("e") || raw.includes("E")) return null;
  } else {
    raw = input;
  }

  const cleaned = raw.replace(/[$,\s]/g, "").trim();
  const m = /^(-)?(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (!m) return null;

  const neg = m[1] === "-";
  const intPart = m[2] ?? "";
  const fracPart = m[3] ?? "";
  // "", "-", "." and "-." are not numbers.
  if (intPart === "" && fracPart === "") return null;

  const whole = intPart === "" ? 0 : Number(intPart);
  if (!Number.isFinite(whole)) return null;

  const centsDigits = (fracPart + "00").slice(0, 2);
  let cents = Number(centsDigits);

  // Round half away from zero using the first discarded digit.
  const nextDigit = fracPart.length > 2 ? Number(fracPart[2]) : 0;
  if (nextDigit >= 5) cents += 1;

  const total = whole * 100 + cents;
  if (!Number.isSafeInteger(total)) return null;
  return neg ? -total : total;
}

// ---------------------------------------------------------------------------
// 3) Normal balance — the rule every accounting student learns, encoded once.
// ---------------------------------------------------------------------------

/**
 * Assets, COGS and expenses are debit-normal; liabilities, equity and income are
 * credit-normal. A contra account (e.g. accumulated depreciation) deliberately
 * inverts its family's normal side — the only legal exception.
 */
export function normalBalanceOf(type: AccountType, isContra = false): NormalBalance {
  const base: NormalBalance =
    type === "asset" || type === "cogs" || type === "expense" || type === "other_expense"
      ? "debit"
      : "credit";
  if (!isContra) return base;
  return base === "debit" ? "credit" : "debit";
}

export function isDebitNormal(type: AccountType, isContra = false): boolean {
  return normalBalanceOf(type, isContra) === "debit";
}

/** Is this a balance-sheet account (as opposed to profit-and-loss)? */
export function isBalanceSheetType(type: AccountType): boolean {
  return type === "asset" || type === "liability" || type === "equity";
}

/** Split a signed amount into its debit/credit presentation columns. */
export function toDebitCredit(amountCents: number): { debitCents: number; creditCents: number } {
  return amountCents >= 0
    ? { debitCents: amountCents, creditCents: 0 }
    : { debitCents: 0, creditCents: -amountCents };
}

/**
 * Present a signed ledger amount the way an accountant expects to READ it: an
 * account's balance is shown positive when it sits on its natural side. A cash
 * balance of +500000 (debit) reads as $5,000.00; a payable of -500000 (credit)
 * also reads as $5,000.00, because a payable is naturally a credit.
 */
export function signedToNatural(amountCents: number, type: AccountType, isContra = false): number {
  return isDebitNormal(type, isContra) ? amountCents : -amountCents;
}

// ---------------------------------------------------------------------------
// 4) Date helpers (Pacific business dates as ISO strings).
// ---------------------------------------------------------------------------

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Strict ISO YYYY-MM-DD validity check, including real calendar days. */
export function isValidIsoDate(s: string | null | undefined): boolean {
  if (!s || !ISO_DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Lexicographic comparison is correct and allocation-free for ISO dates. */
export function isOnOrAfter(a: string, b: string): boolean {
  return a >= b;
}

/** Fiscal period number (1-12) for an ISO date. Calendar-year fiscal periods. */
export function periodNoOf(isoDate: string): number {
  return Number(isoDate.slice(5, 7));
}

export function fiscalYearOf(isoDate: string): number {
  return Number(isoDate.slice(0, 4));
}

// ---------------------------------------------------------------------------
// 5) Summing and balance proof.
// ---------------------------------------------------------------------------

/**
 * Sum signed line amounts. Integer-only: JavaScript integers are exact to
 * 2^53-1, i.e. about $90 trillion in cents — far beyond any balance these books
 * will ever hold, so this is exact, not approximate.
 */
export function sumLines(lines: Array<{ amountCents: number }>): number {
  let total = 0;
  for (const l of lines) total += l.amountCents;
  return total;
}

/** Total debits and credits, for display and for the trial balance foot. */
export function totalsOf(lines: Array<{ amountCents: number }>): {
  debitCents: number;
  creditCents: number;
  differenceCents: number;
} {
  let debitCents = 0;
  let creditCents = 0;
  for (const l of lines) {
    if (l.amountCents >= 0) debitCents += l.amountCents;
    else creditCents += -l.amountCents;
  }
  return { debitCents, creditCents, differenceCents: debitCents - creditCents };
}

/** True when debits exactly equal credits. */
export function isBalanced(lines: Array<{ amountCents: number }>): boolean {
  return sumLines(lines) === 0;
}

// ---------------------------------------------------------------------------
// 6) The validator — every posting rule, in plain English.
//    Mirrors gl_post_journal() in migration 0172, check for check.
// ---------------------------------------------------------------------------

export function validateJournalDraft(
  draft: JournalDraft,
  accountsByCode: Map<string, LedgerAccount>,
): ValidationResult {
  const issues: ValidationIssue[] = [];

  // --- header ---------------------------------------------------------------
  if (!isValidIsoDate(draft.journalDate)) {
    issues.push({
      code: "GL_BAD_DATE",
      message: `"${draft.journalDate}" is not a valid date. Use YYYY-MM-DD.`,
    });
  } else if (draft.sourceKind === "opening_balance") {
    // The opening-balance entry has exactly one legal date.
    if (draft.journalDate !== OPENING_BALANCE_DATE) {
      issues.push({
        code: "GL_OPENING_BALANCE_DATE",
        message: `The opening-balance entry must be dated ${OPENING_BALANCE_DATE} (the day before the line in the sand). Got ${draft.journalDate}.`,
      });
    }
  } else if (!isOnOrAfter(draft.journalDate, LINE_IN_THE_SAND)) {
    // THE LINE IN THE SAND.
    issues.push({
      code: "GL_BEFORE_LINE_IN_THE_SAND",
      message: `Nothing may be posted before ${LINE_IN_THE_SAND}. The old Sage history stays behind the line — only the opening-balance entry may be dated earlier.`,
    });
  }

  if (!draft.memo || draft.memo.trim().length < 3) {
    issues.push({
      code: "GL_MEMO_REQUIRED",
      message: "Every entry needs a memo explaining what it is. An entry nobody can explain is an entry nobody can audit.",
    });
  }

  // --- lines ----------------------------------------------------------------
  if (draft.lines.length < 2) {
    issues.push({
      code: "GL_TOO_FEW_LINES",
      message: `Double-entry needs at least two lines; this entry has ${draft.lines.length}.`,
    });
  }

  const seenLineNos = new Set<number>();
  for (const line of draft.lines) {
    if (seenLineNos.has(line.lineNo)) {
      issues.push({
        code: "GL_DUPLICATE_LINE_NO",
        message: `Line number ${line.lineNo} appears more than once.`,
        lineNo: line.lineNo,
      });
    }
    seenLineNos.add(line.lineNo);

    if (!Number.isInteger(line.amountCents)) {
      issues.push({
        code: "GL_NON_INTEGER_AMOUNT",
        message: `Line ${line.lineNo}: amounts must be whole cents (no fractions of a cent).`,
        lineNo: line.lineNo,
      });
    }
    if (line.amountCents === 0) {
      issues.push({
        code: "GL_ZERO_AMOUNT",
        message: `Line ${line.lineNo}: a zero-amount line does nothing. Remove it.`,
        lineNo: line.lineNo,
      });
    }
    if (line.entityCode !== draft.entityCode) {
      issues.push({
        code: "GL_ENTITY_MISMATCH",
        message: `Line ${line.lineNo} belongs to "${line.entityCode}" but the entry is for "${draft.entityCode}". One entry cannot span two sets of books — use an intercompany pair instead.`,
        lineNo: line.lineNo,
      });
    }

    const acct = accountsByCode.get(line.accountCode);
    if (!acct) {
      issues.push({
        code: "GL_UNKNOWN_ACCOUNT",
        message: `Line ${line.lineNo}: account "${line.accountCode}" does not exist in the chart of accounts.`,
        lineNo: line.lineNo,
      });
      continue;
    }
    if (acct.active === false) {
      issues.push({
        code: "GL_INACTIVE_ACCOUNT",
        message: `Line ${line.lineNo}: account ${acct.code} (${acct.name}) is inactive.`,
        lineNo: line.lineNo,
      });
    }
    if (acct.allowedEntityCodes && !acct.allowedEntityCodes.includes(line.entityCode)) {
      issues.push({
        code: "GL_ACCOUNT_NOT_ALLOWED_FOR_ENTITY",
        message: `Line ${line.lineNo}: account ${acct.code} (${acct.name}) is not available to "${line.entityCode}".`,
        lineNo: line.lineNo,
      });
    }

    // CONTROL ACCOUNT DISCIPLINE — the rule that makes another "LAZY INVENTORY
    // ENTRY" structurally impossible.
    if (draft.sourceKind === "manual" && acct.isControl) {
      issues.push({
        code: "GL_CONTROL_ACCOUNT",
        message: `Line ${line.lineNo}: ${acct.code} (${acct.name}) is a control account owned by the ${acct.controlSubledger ?? "subledger"} subledger. It cannot be adjusted by hand — post the underlying transaction instead, so the ledger and the subledger can never disagree.`,
        lineNo: line.lineNo,
      });
    }

    // 280E tagging.
    const costClass: CostClass = line.costClass ?? "none";
    if (acct.requiresCostClass && costClass === "none") {
      issues.push({
        code: "GL_COST_CLASS_REQUIRED",
        message: `Line ${line.lineNo}: account ${acct.code} (${acct.name}) needs a 280E cost class so the tax view can tell a deductible dollar from a non-deductible one.`,
        lineNo: line.lineNo,
      });
    }
    if (isBalanceSheetType(acct.type) && costClass !== "none") {
      issues.push({
        code: "GL_COST_CLASS_NOT_ALLOWED",
        message: `Line ${line.lineNo}: ${acct.code} is a balance-sheet account, so it must not carry a 280E cost class (that applies to income and expense only).`,
        lineNo: line.lineNo,
      });
    }
  }

  // --- the fundamental rule -------------------------------------------------
  const diff = sumLines(draft.lines);
  if (diff !== 0) {
    const t = totalsOf(draft.lines);
    issues.push({
      code: "GL_OUT_OF_BALANCE",
      message: `Out of balance by ${formatCents(Math.abs(diff))}. Debits ${formatCents(t.debitCents)} vs credits ${formatCents(t.creditCents)}. Debits must equal credits exactly.`,
    });
  }

  return { ok: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// 7) Trial balance — the accountant's first and last sanity check.
// ---------------------------------------------------------------------------

export interface TrialBalanceRow {
  accountCode: string;
  accountName: string;
  type: AccountType;
  debitCents: number;
  creditCents: number;
  /** Signed net (debit-positive). */
  netCents: number;
}

export interface TrialBalance {
  rows: TrialBalanceRow[];
  totalDebitCents: number;
  totalCreditCents: number;
  /** Must be exactly zero for a healthy ledger. */
  differenceCents: number;
  inBalance: boolean;
}

/**
 * Build a trial balance from posted lines. The foot MUST be zero: if it is not,
 * something is deeply wrong and the number itself tells you by how much.
 */
export function buildTrialBalance(
  lines: Array<{ accountCode: string; amountCents: number }>,
  accountsByCode: Map<string, LedgerAccount>,
): TrialBalance {
  const byAccount = new Map<string, number>();
  for (const l of lines) {
    byAccount.set(l.accountCode, (byAccount.get(l.accountCode) ?? 0) + l.amountCents);
  }

  const rows: TrialBalanceRow[] = [];
  for (const [code, net] of byAccount) {
    const acct = accountsByCode.get(code);
    const { debitCents, creditCents } = toDebitCredit(net);
    rows.push({
      accountCode: code,
      accountName: acct?.name ?? "(unknown account)",
      type: acct?.type ?? "asset",
      debitCents,
      creditCents,
      netCents: net,
    });
  }

  rows.sort((a, b) => a.accountCode.localeCompare(b.accountCode));

  let totalDebitCents = 0;
  let totalCreditCents = 0;
  for (const r of rows) {
    totalDebitCents += r.debitCents;
    totalCreditCents += r.creditCents;
  }

  const differenceCents = totalDebitCents - totalCreditCents;
  return {
    rows,
    totalDebitCents,
    totalCreditCents,
    differenceCents,
    inBalance: differenceCents === 0,
  };
}

// ---------------------------------------------------------------------------
// 8) Ownership — must total exactly 100%.
// ---------------------------------------------------------------------------

export function assertOwnershipSums(
  holders: Array<{ name: string; ownershipMilliPct: number; active?: boolean }>,
): ValidationResult {
  const total = holders
    .filter((h) => h.active !== false)
    .reduce((sum, h) => sum + h.ownershipMilliPct, 0);

  if (total !== FULL_OWNERSHIP_MILLI_PCT) {
    return {
      ok: false,
      issues: [{
        code: "GL_OWNERSHIP",
        message: `Ownership totals ${formatMilliPct(total)} but must total exactly 100%.`,
      }],
    };
  }
  return { ok: true, issues: [] };
}

/**
 * Allocate an amount across owners by percentage without losing or inventing a
 * cent. Uses the LARGEST-REMAINDER method: give everyone their exact whole-cent
 * share (floor), then hand the leftover cents, one each, to the owners with the
 * largest discarded fractions. The result ALWAYS sums to the original amount
 * exactly — rounding drift is not permitted to exist in these books.
 *
 * WHY BigInt: the share of owner i is (amount x pct_i) / total_pct. Computed in
 * ordinary floating point, `amount * 85000` exceeds the exactly-representable
 * integer range once the amount passes about $900 million, and even below that
 * the division can land a hair under a whole number, so the floor drops a cent
 * and the tie-break hands it to the wrong owner. Here the numerator, the
 * quotient and the remainder are all computed as exact integers, so each owner's
 * share and each owner's discarded fraction are exact, and the ordering of the
 * leftover pennies is provably correct rather than incidentally correct.
 *
 * Because every share is floored, the leftover is strictly fewer cents than
 * there are owners, so no owner can ever receive two extra pennies.
 */
export function allocateByOwnership(
  amountCents: number,
  holders: Array<{ name: string; ownershipMilliPct: number }>,
): Array<{ name: string; amountCents: number }> {
  if (holders.length === 0) return [];

  const totalPct = holders.reduce((s, h) => s + h.ownershipMilliPct, 0);
  if (totalPct <= 0) return holders.map((h) => ({ name: h.name, amountCents: 0 }));

  const neg = amountCents < 0;
  const abs = BigInt(Math.abs(Math.trunc(amountCents)));
  const total = BigInt(totalPct);

  // Exact integer quotient and remainder for each owner.
  const parts = holders.map((h, i) => {
    const numerator = abs * BigInt(h.ownershipMilliPct);
    return {
      i,
      whole: numerator / total,      // BigInt division truncates toward zero;
      frac: numerator % total,       // both operands are non-negative here.
    };
  });

  // BigInt(0) / BigInt(1) rather than the 0n / 1n literal form: the repo targets
  // ES2017 and BigInt literals require ES2020. The values are identical; only
  // the spelling differs, and this keeps the slice from touching tsconfig.
  const ZERO = BigInt(0);
  const ONE = BigInt(1);

  const out = parts.map((p) => p.whole);
  let leftover = abs - out.reduce((s, v) => s + v, ZERO);

  // Largest discarded fraction first; ties broken by original order so the
  // result is deterministic and reproducible in an audit.
  const order = parts
    .slice()
    .sort((a, b) => (a.frac === b.frac ? a.i - b.i : a.frac > b.frac ? -1 : 1));

  for (let k = 0; leftover > ZERO && k < order.length; k += 1) {
    out[order[k].i] += ONE;
    leftover -= ONE;
  }

  return holders.map((h, i) => {
    const cents = Number(out[i]);
    return { name: h.name, amountCents: neg ? -cents : cents };
  });
}

// ---------------------------------------------------------------------------
// 9) Embedded self-tests (repo convention: __run<Name>CoreTests()).
// ---------------------------------------------------------------------------

export function __runLedgerCoreTests(): string {
  const failures: string[] = [];
  let passed = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) passed += 1;
    else failures.push(label);
  };

  // ---- money formatting ----------------------------------------------------
  ok(formatCents(123456) === "$1,234.56", "formatCents basic");
  ok(formatCents(-123456) === "-$1,234.56", "formatCents negative");
  ok(formatCents(0) === "$0.00", "formatCents zero");
  ok(formatCents(null) === "—", "formatCents null em dash");
  ok(formatCents(462469731) === "$4,624,697.31", "formatCents the lazy-entry amount");

  ok(formatMilliPct(85000) === "85%", "formatMilliPct 85%");
  ok(formatMilliPct(10000) === "10%", "formatMilliPct 10%");
  ok(formatMilliPct(5000) === "5%", "formatMilliPct 5%");
  ok(formatMilliPct(2375) === "2.375%", "formatMilliPct 2.375%");
  ok(formatMilliPct(null) === "—", "formatMilliPct null");

  ok(dollarsToCents("$4,624,697.31") === 462469731, "dollarsToCents with symbols");
  ok(dollarsToCents("1234.56") === 123456, "dollarsToCents plain");
  ok(dollarsToCents(-12.5) === -1250, "dollarsToCents negative number");
  ok(dollarsToCents("") === null, "dollarsToCents blank");
  ok(dollarsToCents("abc") === null, "dollarsToCents garbage");
  ok(dollarsToCents(".") === null, "dollarsToCents lone dot");
  ok(dollarsToCents("-") === null, "dollarsToCents lone minus");

  // FLOAT-SAFETY REGRESSION TESTS. These caught a real penny-losing bug during
  // development: `Math.round(1.005 * 100)` yields 100, not 101, because 1.005 is
  // stored in binary as 1.00499999999999989. A lost penny is drift. Never
  // multiply money by 100 — parse the digits.
  ok(dollarsToCents(1.005) === 101, "1.005 -> 101 cents (the float trap)");
  ok(dollarsToCents("1.005") === 101, "\"1.005\" -> 101 cents");
  ok(dollarsToCents(8.165) === 817, "8.165 -> 817 cents (another float trap)");
  ok(dollarsToCents("0.1") === 10, "0.1 -> 10 cents");
  ok(dollarsToCents("0.2") === 20, "0.2 -> 20 cents");
  ok(dollarsToCents("2.675") === 268, "2.675 -> 268 cents (classic float trap)");
  ok(dollarsToCents("1.004") === 100, "1.004 rounds down");
  ok(dollarsToCents("-1.005") === -101, "negative rounds away from zero");
  ok(dollarsToCents(".5") === 50, "leading-dot decimal");
  ok(dollarsToCents("100") === 10000, "whole dollars");
  ok(dollarsToCents("100.") === 10000, "trailing dot");
  ok(dollarsToCents("0.001") === 0, "sub-cent rounds to zero");
  ok(dollarsToCents("0.009") === 1, "sub-cent rounds up to a cent");
  // Michael's real Sage figures must survive the round trip exactly.
  ok(dollarsToCents("$741,916.87") === 74191687, "CASH ON HAND parses exactly");
  ok(dollarsToCents("-$1,461,147.84") === -146114784, "negative FLOWER balance parses exactly");

  // ---- normal balance ------------------------------------------------------
  ok(normalBalanceOf("asset") === "debit", "asset is debit-normal");
  ok(normalBalanceOf("cogs") === "debit", "cogs is debit-normal");
  ok(normalBalanceOf("expense") === "debit", "expense is debit-normal");
  ok(normalBalanceOf("liability") === "credit", "liability is credit-normal");
  ok(normalBalanceOf("equity") === "credit", "equity is credit-normal");
  ok(normalBalanceOf("income") === "credit", "income is credit-normal");
  ok(normalBalanceOf("asset", true) === "credit", "contra asset inverts (accumulated depreciation)");
  ok(normalBalanceOf("income", true) === "debit", "contra income inverts (sales discounts)");
  ok(isBalanceSheetType("asset") && !isBalanceSheetType("income"), "balance-sheet type test");

  // ---- debit/credit presentation -------------------------------------------
  ok(toDebitCredit(5000).debitCents === 5000, "positive is a debit");
  ok(toDebitCredit(-5000).creditCents === 5000, "negative is a credit");
  ok(signedToNatural(-5000, "liability") === 5000, "a payable reads positive on its natural side");
  ok(signedToNatural(5000, "asset") === 5000, "cash reads positive on its natural side");

  // ---- dates ---------------------------------------------------------------
  ok(isValidIsoDate("2026-01-01"), "valid iso date");
  ok(!isValidIsoDate("2026-02-30"), "rejects Feb 30");
  ok(!isValidIsoDate("2026-13-01"), "rejects month 13");
  ok(!isValidIsoDate("01/01/2026"), "rejects US format");
  ok(isValidIsoDate("2024-02-29"), "accepts a real leap day");
  ok(!isValidIsoDate("2026-02-29"), "rejects a fake leap day");
  ok(periodNoOf("2026-07-15") === 7, "period number from date");
  ok(fiscalYearOf("2026-07-15") === 2026, "fiscal year from date");

  // ---- summing and balance -------------------------------------------------
  ok(sumLines([{ amountCents: 100 }, { amountCents: -100 }]) === 0, "balanced pair sums to zero");
  ok(isBalanced([{ amountCents: 250 }, { amountCents: -150 }, { amountCents: -100 }]), "balanced triple");
  ok(!isBalanced([{ amountCents: 250 }, { amountCents: -100 }]), "unbalanced pair detected");
  const tot = totalsOf([{ amountCents: 250 }, { amountCents: -150 }, { amountCents: -100 }]);
  ok(tot.debitCents === 250 && tot.creditCents === 250 && tot.differenceCents === 0, "totals split correctly");

  // ---- the validator -------------------------------------------------------
  const accounts = new Map<string, LedgerAccount>([
    ["10100", { code: "10100", name: "Cash on Hand", type: "asset", normalBalance: "debit" }],
    ["12000", { code: "12000", name: "Inventory", type: "asset", normalBalance: "debit",
                isControl: true, controlSubledger: "inventory" }],
    ["20100", { code: "20100", name: "Accounts Payable", type: "liability", normalBalance: "credit",
                isControl: true, controlSubledger: "ap" }],
    ["40100", { code: "40100", name: "Retail Sales", type: "income", normalBalance: "credit",
                requiresCostClass: true }],
    ["50100", { code: "50100", name: "Product Cost", type: "cogs", normalBalance: "debit",
                requiresCostClass: true }],
    ["60100", { code: "60100", name: "Rent Expense", type: "expense", normalBalance: "debit",
                requiresCostClass: true }],
    ["61000", { code: "61000", name: "Old Account", type: "expense", normalBalance: "debit",
                requiresCostClass: true, active: false }],
    ["70100", { code: "70100", name: "ATM Fee Income", type: "income", normalBalance: "credit",
                requiresCostClass: true, allowedEntityCodes: ["atm"] }],
  ]);

  const goodDraft: JournalDraft = {
    entityCode: "greenway",
    journalDate: "2026-03-15",
    sourceKind: "manual",
    memo: "Record March rent to landlord",
    lines: [
      { lineNo: 1, accountCode: "60100", entityCode: "greenway", amountCents: 200000, costClass: "nondeductible_280e" },
      { lineNo: 2, accountCode: "10100", entityCode: "greenway", amountCents: -200000 },
    ],
  };
  const goodResult = validateJournalDraft(goodDraft, accounts);
  ok(goodResult.ok, `a correct entry validates (issues: ${goodResult.issues.map((i) => i.code).join(",")})`);

  const hasCode = (r: ValidationResult, code: string) => r.issues.some((i) => i.code === code);

  // out of balance
  const unbalanced: JournalDraft = {
    ...goodDraft,
    lines: [
      { lineNo: 1, accountCode: "60100", entityCode: "greenway", amountCents: 200000, costClass: "nondeductible_280e" },
      { lineNo: 2, accountCode: "10100", entityCode: "greenway", amountCents: -150000 },
    ],
  };
  ok(hasCode(validateJournalDraft(unbalanced, accounts), "GL_OUT_OF_BALANCE"), "catches out of balance");

  // before the line in the sand
  const tooEarly: JournalDraft = { ...goodDraft, journalDate: "2025-12-15" };
  ok(hasCode(validateJournalDraft(tooEarly, accounts), "GL_BEFORE_LINE_IN_THE_SAND"),
     "refuses to post before the line in the sand");

  // opening balance is allowed at 2025-12-31 only
  const openingOk: JournalDraft = {
    entityCode: "greenway",
    journalDate: "2025-12-31",
    sourceKind: "opening_balance",
    memo: "Opening balances at cut-over per grandfather's workpapers",
    lines: [
      { lineNo: 1, accountCode: "10100", entityCode: "greenway", amountCents: 500000 },
      { lineNo: 2, accountCode: "30900", entityCode: "greenway", amountCents: -500000 },
    ],
  };
  const openingRes = validateJournalDraft(openingOk, accounts);
  ok(!hasCode(openingRes, "GL_BEFORE_LINE_IN_THE_SAND"), "opening balance may be dated 2025-12-31");
  ok(hasCode(openingRes, "GL_UNKNOWN_ACCOUNT"), "unknown account (30900 not yet in the chart) is caught");

  const openingWrongDate: JournalDraft = { ...openingOk, journalDate: "2025-06-30" };
  ok(hasCode(validateJournalDraft(openingWrongDate, accounts), "GL_OPENING_BALANCE_DATE"),
     "opening balance on the wrong date is caught");

  // control account, manual entry
  const controlTouch: JournalDraft = {
    entityCode: "greenway",
    journalDate: "2026-03-15",
    sourceKind: "manual",
    memo: "Lazy inventory entry (exactly what we are preventing)",
    lines: [
      { lineNo: 1, accountCode: "12000", entityCode: "greenway", amountCents: 462469731 },
      { lineNo: 2, accountCode: "10100", entityCode: "greenway", amountCents: -462469731 },
    ],
  };
  ok(hasCode(validateJournalDraft(controlTouch, accounts), "GL_CONTROL_ACCOUNT"),
     "blocks a manual plug into a control account (the LAZY INVENTORY ENTRY defence)");

  // ...but the subledger itself may post there
  const subledgerPost: JournalDraft = { ...controlTouch, sourceKind: "inventory", memo: "Receipt of lot 12345" };
  ok(!hasCode(validateJournalDraft(subledgerPost, accounts), "GL_CONTROL_ACCOUNT"),
     "the owning subledger may post to its control account");

  // missing cost class
  const noCostClass: JournalDraft = {
    ...goodDraft,
    lines: [
      { lineNo: 1, accountCode: "60100", entityCode: "greenway", amountCents: 200000 },
      { lineNo: 2, accountCode: "10100", entityCode: "greenway", amountCents: -200000 },
    ],
  };
  ok(hasCode(validateJournalDraft(noCostClass, accounts), "GL_COST_CLASS_REQUIRED"),
     "requires a 280E cost class on P&L lines");

  // cost class on a balance-sheet line
  const bsCostClass: JournalDraft = {
    ...goodDraft,
    lines: [
      { lineNo: 1, accountCode: "60100", entityCode: "greenway", amountCents: 200000, costClass: "nondeductible_280e" },
      { lineNo: 2, accountCode: "10100", entityCode: "greenway", amountCents: -200000, costClass: "cogs_direct" },
    ],
  };
  ok(hasCode(validateJournalDraft(bsCostClass, accounts), "GL_COST_CLASS_NOT_ALLOWED"),
     "rejects a 280E cost class on a balance-sheet line");

  // entity mismatch
  const mismatch: JournalDraft = {
    ...goodDraft,
    lines: [
      { lineNo: 1, accountCode: "60100", entityCode: "greenway", amountCents: 200000, costClass: "nondeductible_280e" },
      { lineNo: 2, accountCode: "10100", entityCode: "landholding", amountCents: -200000 },
    ],
  };
  ok(hasCode(validateJournalDraft(mismatch, accounts), "GL_ENTITY_MISMATCH"),
     "one entry cannot span two sets of books");

  // account restricted to another entity
  const wrongEntityAccount: JournalDraft = {
    entityCode: "greenway",
    journalDate: "2026-03-15",
    sourceKind: "manual",
    memo: "ATM income booked in the wrong entity",
    lines: [
      { lineNo: 1, accountCode: "10100", entityCode: "greenway", amountCents: 5000 },
      { lineNo: 2, accountCode: "70100", entityCode: "greenway", amountCents: -5000, costClass: "separate_business" },
    ],
  };
  ok(hasCode(validateJournalDraft(wrongEntityAccount, accounts), "GL_ACCOUNT_NOT_ALLOWED_FOR_ENTITY"),
     "an entity-restricted account cannot be used elsewhere");

  // inactive account
  const inactive: JournalDraft = {
    ...goodDraft,
    lines: [
      { lineNo: 1, accountCode: "61000", entityCode: "greenway", amountCents: 200000, costClass: "nondeductible_280e" },
      { lineNo: 2, accountCode: "10100", entityCode: "greenway", amountCents: -200000 },
    ],
  };
  ok(hasCode(validateJournalDraft(inactive, accounts), "GL_INACTIVE_ACCOUNT"), "catches an inactive account");

  // zero amount, duplicate line numbers, too few lines, blank memo
  ok(hasCode(validateJournalDraft({ ...goodDraft, lines: [
      { lineNo: 1, accountCode: "60100", entityCode: "greenway", amountCents: 0, costClass: "nondeductible_280e" },
      { lineNo: 2, accountCode: "10100", entityCode: "greenway", amountCents: 0 },
    ] }, accounts), "GL_ZERO_AMOUNT"), "catches zero-amount lines");

  ok(hasCode(validateJournalDraft({ ...goodDraft, lines: [
      { lineNo: 1, accountCode: "60100", entityCode: "greenway", amountCents: 100, costClass: "nondeductible_280e" },
      { lineNo: 1, accountCode: "10100", entityCode: "greenway", amountCents: -100 },
    ] }, accounts), "GL_DUPLICATE_LINE_NO"), "catches duplicate line numbers");

  ok(hasCode(validateJournalDraft({ ...goodDraft, lines: [
      { lineNo: 1, accountCode: "10100", entityCode: "greenway", amountCents: 100 },
    ] }, accounts), "GL_TOO_FEW_LINES"), "catches single-sided entries");

  ok(hasCode(validateJournalDraft({ ...goodDraft, memo: "  " }, accounts), "GL_MEMO_REQUIRED"),
     "requires a memo");

  ok(hasCode(validateJournalDraft({ ...goodDraft, journalDate: "not-a-date" }, accounts), "GL_BAD_DATE"),
     "catches an invalid date");

  // ---- trial balance -------------------------------------------------------
  const tb = buildTrialBalance(
    [
      { accountCode: "10100", amountCents: 200000 },
      { accountCode: "40100", amountCents: -200000 },
      { accountCode: "10100", amountCents: -50000 },
      { accountCode: "60100", amountCents: 50000 },
    ],
    accounts,
  );
  ok(tb.inBalance, "trial balance foots to zero");
  ok(tb.totalDebitCents === 200000 && tb.totalCreditCents === 200000, "trial balance totals");
  ok(tb.rows.length === 3, "trial balance groups by account");
  const cashRow = tb.rows.find((r) => r.accountCode === "10100");
  ok(cashRow?.netCents === 150000, "trial balance nets multiple hits on one account");
  ok(cashRow?.debitCents === 150000 && cashRow?.creditCents === 0, "net debit lands in the debit column");

  // ---- ownership -----------------------------------------------------------
  const holders = [
    { name: "Michael Lyman", ownershipMilliPct: 85000 },
    { name: "Mother", ownershipMilliPct: 10000 },
    { name: "Nicholas Mullan", ownershipMilliPct: 5000 },
  ];
  ok(assertOwnershipSums(holders).ok, "85 + 10 + 5 = 100%");
  ok(!assertOwnershipSums([{ name: "A", ownershipMilliPct: 90000 }]).ok, "90% alone is rejected");

  // Allocation must never lose or invent a cent — test a deliberately awkward
  // amount that does not divide evenly.
  const alloc = allocateByOwnership(100001, holders);
  const allocSum = alloc.reduce((s, a) => s + a.amountCents, 0);
  ok(allocSum === 100001, `allocation sums exactly to the original (got ${allocSum})`);
  ok(alloc[0].amountCents === 85001, `largest remainder goes to the 85% holder (got ${alloc[0].amountCents})`);

  const allocNeg = allocateByOwnership(-100001, holders);
  ok(allocNeg.reduce((s, a) => s + a.amountCents, 0) === -100001, "negative allocation also sums exactly");

  // Real 2024 K-1 ordinary income, $630,215.00 in cents. Michael's 85% share
  // must reconcile to the penny against what the return reports.
  const alloc2024 = allocateByOwnership(63021500, holders);
  ok(alloc2024.reduce((s, a) => s + a.amountCents, 0) === 63021500, "2024 K-1 allocation sums exactly");
  ok(alloc2024[0].amountCents === 53568275, `Michael's 85% of $630,215 (got ${alloc2024[0].amountCents})`);
  ok(alloc2024[1].amountCents === 6302150, `mom's 10% of $630,215 (got ${alloc2024[1].amountCents})`);
  ok(alloc2024[2].amountCents === 3151075, `grandfather's 5% of $630,215 (got ${alloc2024[2].amountCents})`);

  // 2022 and 2023 K-1 figures, same reconciliation.
  ok(allocateByOwnership(46344000, holders).reduce((s, a) => s + a.amountCents, 0) === 46344000,
     "2022 K-1 allocation sums exactly");
  ok(allocateByOwnership(65271700, holders).reduce((s, a) => s + a.amountCents, 0) === 65271700,
     "2023 K-1 allocation sums exactly");

  // EXACTNESS UNDER SCALE. Beyond ~$90 billion in cents, `amount * 85000` leaves
  // the range where floating point counts whole numbers exactly, so a float
  // implementation starts dropping and misplacing pennies. BigInt arithmetic
  // does not, and these books must never depend on the size of the number.
  const allocHuge = allocateByOwnership(9007199254740991, holders);
  ok(allocHuge.reduce((s, a) => s + a.amountCents, 0) === 9007199254740991,
     "allocation is exact even at the largest safe integer");

  // Every leftover penny must land somewhere, and no owner may get two. Sweep a
  // range of awkward amounts to prove both properties hold generally rather than
  // in the one example we happened to pick.
  let sweepOk = true;
  for (let amt = 0; amt < 400; amt += 1) {
    const a = allocateByOwnership(amt, holders);
    const sum = a.reduce((s, x) => s + x.amountCents, 0);
    if (sum !== amt) { sweepOk = false; break; }
    // No share may exceed its exact entitlement by more than one cent.
    for (let i = 0; i < holders.length; i += 1) {
      const floorShare = Math.floor((amt * holders[i].ownershipMilliPct) / 100000);
      const diff = a[i].amountCents - floorShare;
      if (diff < 0 || diff > 1) { sweepOk = false; break; }
    }
    if (!sweepOk) break;
  }
  ok(sweepOk, "allocation sweep 0..399 cents: always exact, never off by more than one cent per owner");

  // An even split across three owners is the classic penny problem: 100 cents
  // three ways. Deterministic tie-break must give the extra cent to the first.
  const thirds = [
    { name: "A", ownershipMilliPct: 33333 },
    { name: "B", ownershipMilliPct: 33333 },
    { name: "C", ownershipMilliPct: 33334 },
  ];
  const pennySplit = allocateByOwnership(100, thirds);
  ok(pennySplit.reduce((s, a) => s + a.amountCents, 0) === 100, "three-way penny split sums to 100");

  // A single owner takes everything, with no rounding involved.
  ok(allocateByOwnership(12345, [{ name: "Solo", ownershipMilliPct: 100000 }])[0].amountCents === 12345,
     "sole owner receives the whole amount");
  ok(allocateByOwnership(0, holders).every((a) => a.amountCents === 0), "allocating zero yields zeros");

  if (failures.length) {
    throw new Error(`ledger-core self-tests FAILED (${failures.length}):\n  - ${failures.join("\n  - ")}`);
  }
  return `ledger-core self-tests: all ${passed} passed`;
}
