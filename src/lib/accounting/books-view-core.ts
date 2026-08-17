/**
 * src/lib/accounting/books-view-core.ts   (slice F5-K)
 *
 * PURE presentation logic for the books screens. No I/O, no React, no
 * Supabase — every function is a computation, so all of it is testable.
 *
 * ---------------------------------------------------------------------------
 * WHY THE GATE LOGIC LIVES HERE
 * ---------------------------------------------------------------------------
 * There is a trap in this repo that this file exists to close.
 *
 * The database says the books are admin-only:
 *     is_admin()  =>  role in ('owner','admin')            [0001]
 *
 * The application's reporting permission says something DIFFERENT:
 *     "reports.view" => owner, admin, MANAGER, READONLY    [roles.ts]
 *
 * If a books page were gated on `reports.view` — the obvious choice, since it
 * is a report — a manager would pass the page gate, the page would call the
 * RPC, and Postgres would refuse with `TB_FORBIDDEN`. The manager would land
 * on a screen that exists, looks real, and is full of error text. Worse, a
 * future developer seeing that error might "fix" it by loosening the database
 * check, which would hand the entire general ledger to four roles.
 *
 * So the page gate MUST be the same set as the database gate, and
 * `canReadBooks()` below is the single place that decides it. The tests assert
 * the two agree for EVERY role — not just the ones we happened to think of.
 */

import { ALL_ROLES, can, rolesForPermission } from "@/lib/auth/roles";
import type { StaffRole } from "@/lib/supabase/types";

/**
 * Every role in the system.
 *
 * This is NOT a hand-typed array, deliberately. It is the keys of a
 * `Record<StaffRole, true>`, which means TypeScript REFUSES TO COMPILE if
 * someone adds a new role to the `StaffRole` union and forgets to list it
 * here. A plain `StaffRole[]` would have accepted a short list silently, and
 * the "every role is covered" test below would then have quietly stopped
 * covering every role -- a test that passes while testing less. The compiler
 * is a better guard than a test here, so we use it.
 */
const ROLE_PRESENCE: Record<StaffRole, true> = {
  owner: true,
  admin: true,
  manager: true,
  content_editor: true,
  staff: true,
  readonly: true,
};

export const ALL_STAFF_ROLES: readonly StaffRole[] = Object.keys(
  ROLE_PRESENCE,
) as StaffRole[];

/**
 * WHO MAY READ THE BOOKS.
 *
 * OWNER DECISION, recorded verbatim (Michael, 2026-08-17):
 *   "I know at the beginning of the books build I wanted it to be owner and
 *    admin, but I've changed my mind, there is no reason anyone else needs to
 *    see my books or my financials ever, so I want strict controls over all of
 *    those things. The only thing an admin can do is pay vendors and pay
 *    employees."
 *
 * So this is the OWNER ALONE. It mirrors `is_owner()` (migration 0179), NOT
 * `is_admin()` (migration 0001), which remains owner+admin and still guards the
 * two powers Michael deliberately preserved: paying vendors (payables.manage)
 * and paying employees (staffing.manage).
 */
export function canReadBooks(role: StaffRole | null | undefined): boolean {
  return role === "owner";
}

/**
 * The roles the DATABASE would accept, written out independently of
 * `canReadBooks` so a test can compare the two without one being defined in
 * terms of the other. Comparing a function to itself proves nothing.
 *
 * `is_owner()` in migration 0179 -- the gate the books actually use.
 */
export const DB_IS_OWNER_ROLES: readonly StaffRole[] = ["owner"] as const;

/**
 * `is_admin()` in migration 0001. Retained NOT because the books use it, but so
 * a test can prove the books gate is strictly NARROWER than it -- i.e. that the
 * lockdown genuinely removed access rather than renaming a constant.
 */
export const DB_IS_ADMIN_ROLES: readonly StaffRole[] = ["owner", "admin"] as const;

// ---------------------------------------------------------------------------
// MONEY
// ---------------------------------------------------------------------------

/**
 * Format integer cents as accounting-style money.
 *
 * Rule 7: money is integer cents everywhere. This function is the ONLY place
 * the books convert to a decimal, and it never does arithmetic on the result.
 */
export function formatCents(cents: number): string {
  if (!Number.isFinite(cents)) return "—";
  const neg = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  const s = `${dollars.toLocaleString("en-US")}.${rem.toString().padStart(2, "0")}`;
  return neg ? `(${s})` : s;
}

/**
 * Accounting convention: a debit balance and a credit balance go in different
 * COLUMNS, and neither is ever shown as a negative number. Showing "-1,500.00"
 * in a debit column is the kind of thing that makes a reader distrust the whole
 * report.
 */
export function splitDebitCredit(balanceCents: number): {
  debit: number;
  credit: number;
} {
  if (balanceCents > 0) return { debit: balanceCents, credit: 0 };
  if (balanceCents < 0) return { debit: 0, credit: -balanceCents };
  return { debit: 0, credit: 0 };
}

// ---------------------------------------------------------------------------
// THE VERDICT BANNER
// ---------------------------------------------------------------------------

export type BooksVerdictTone = "good" | "warning" | "bad";

export type BooksVerdict = {
  tone: BooksVerdictTone;
  headline: string;
  detail: string;
};

/**
 * Turn the trial balance figures into the sentence at the top of the screen.
 *
 * THE RULE THAT MATTERS: "it balances" is NOT the same as "it is right", and
 * this function must never imply otherwise. An empty set of books balances
 * perfectly. So does a set of books missing half its entries, because every
 * journal individually sums to zero. The wording below is deliberate.
 */
export function describeBooks(input: {
  balanced: boolean;
  certified: boolean;
  lineCount: number;
  accountCount: number;
  differenceCents: number;
  abnormalCount: number;
}): BooksVerdict {
  const { balanced, lineCount, accountCount, differenceCents, abnormalCount } = input;

  if (lineCount === 0) {
    return {
      tone: "warning",
      headline: "There is nothing here yet.",
      detail:
        "No entries fall in this period, so there is nothing to check. An empty set of books balances perfectly — which is exactly why an empty report should never be mistaken for a clean one.",
    };
  }

  if (!balanced) {
    return {
      tone: "bad",
      headline: `Out of balance by $${formatCents(Math.abs(differenceCents))}.`,
      detail:
        "Debits and credits do not agree. Something is wrong and it must be found before these figures are used for anything.",
    };
  }

  const abnormalNote =
    abnormalCount > 0
      ? ` ${abnormalCount} account${abnormalCount === 1 ? " has" : "s have"} a balance on the unusual side — worth a look, though not necessarily wrong.`
      : "";

  return {
    tone: abnormalCount > 0 ? "warning" : "good",
    headline: "Debits equal credits.",
    detail:
      `${lineCount.toLocaleString("en-US")} entries across ${accountCount.toLocaleString("en-US")} accounts. ` +
      "This proves the arithmetic holds — it does not prove the figures are right, because a set of books can balance and still be missing entries entirely." +
      abnormalNote,
  };
}

// ---------------------------------------------------------------------------
// GROUPING THE CHART OF ACCOUNTS
// ---------------------------------------------------------------------------

export const ACCOUNT_TYPE_ORDER = [
  "asset",
  "liability",
  "equity",
  "revenue",
  "expense",
] as const;

export const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  asset: "Assets — what the business owns",
  liability: "Liabilities — what it owes",
  equity: "Equity — the owner's stake",
  revenue: "Revenue — money coming in",
  expense: "Expenses — money going out",
};

export type GroupedAccounts<T> = { type: string; label: string; accounts: T[] }[];

/**
 * Group accounts by type in BALANCE SHEET ORDER, not alphabetically.
 *
 * Alphabetical order would put Expenses before Liabilities and Revenue last,
 * which is not how any accountant reads a chart. Unknown types are kept and
 * appended rather than dropped — silently discarding an account because its
 * type was not on a hard-coded list is how an account goes missing.
 */
/**
 * Does this account belong in the chart for `entityCode`?
 *
 * `allowed_entity_codes` is NULL when an account is shared by all four sets of
 * books (cash, retained earnings, and so on), and a list when it is restricted
 * -- and a list genuinely can hold more than one, e.g. account 10300 (Bank --
 * ATM Vault) is allowed for both `atm` and `greenway`.
 *
 * The rule is written here, in the pure file, rather than inline in the query
 * layer, because "which accounts show up on which set of books" is an
 * accounting decision and it is testable. A wrong answer in the permissive
 * direction shows Michael accounts that belong to another entity; a wrong
 * answer in the restrictive direction makes accounts silently vanish from the
 * chart, and an account nobody can see is an account nobody reconciles.
 */
export function accountBelongsToEntity(
  account: { allowed_entity_codes: string[] | null },
  entityCode: string,
): boolean {
  const allowed = account.allowed_entity_codes;
  // Shared by everyone.
  if (allowed === null || allowed === undefined) return true;
  // An EMPTY list is not the same as NULL. NULL says "no restriction"; an empty
  // list says "restricted to nothing", which no entity can satisfy. Treating
  // the two alike would quietly publish an account that was deliberately
  // fenced off, so they are kept distinct.
  return allowed.includes(entityCode);
}

/**
 * Should the 280E cost-class badge be shown for this account on THIS set of books?
 *
 * THE DEFECT (Michael, 2026-08-15): "All the businesses and even my personal COA
 * have the 280E non-deductible label on them. It should only be on the greenway
 * business and not the other three."
 *
 * He is right, and the fault was purely in the DISPLAY layer — the accounting
 * logic was already correct. `defaultCostClass()` in coa-core.ts has always
 * returned `separate_business` for atm/landholding and `personal` for personal;
 * only `greenway` ever yields `nondeductible_280e`.
 *
 * The problem: `gl_accounts.default_cost_class` is a property of the ACCOUNT, and
 * shared accounts have no entity. Account 70010 "Rent" carries
 * `default_cost_class = 'nondeductible_280e'` with `allowed_entity_codes = null`,
 * because it is deliberately ONE rent account serving all four books (its own
 * comment says so). The page rendered that stored value verbatim, so rent on the
 * ATM books wore a 280E badge it could never actually earn.
 *
 * Why this matters beyond cosmetics: 280E is the single most expensive rule in
 * this industry. A label claiming the ATM's rent is non-deductible invites the
 * owner to NOT claim a deduction he is fully entitled to — CHAMP v. Commissioner
 * (128 T.C. 173) is the authority for treating a genuinely separate trade or
 * business as outside 280E. A cosmetic bug that suppresses a real deduction is
 * not cosmetic.
 */
export function shouldShowCostClassBadge(
  costClass: string | null | undefined,
  entityCode: string,
): boolean {
  if (!costClass || costClass === "none") return false;
  // 280E is a cannabis-trafficking rule. It can only ever apply to the cannabis
  // business, no matter what the shared account row happens to store.
  if (costClass === "nondeductible_280e" || costClass === "cogs_direct" || costClass === "cogs_allocable") {
    return entityCode === "greenway";
  }
  return true;
}

/**
 * The badge text to show, or null for no badge. Separated from the predicate so
 * the wording lives in one place and can be tested without a browser.
 */
export function costClassBadgeLabel(
  costClass: string | null | undefined,
  entityCode: string,
): string | null {
  if (!shouldShowCostClassBadge(costClass, entityCode)) return null;
  switch (costClass) {
    case "nondeductible_280e":
      return "280E — not deductible";
    case "cogs_direct":
      return "COGS — deductible";
    case "cogs_allocable":
      return "COGS — allocable";
    case "separate_business":
      return "Separate business";
    case "personal":
      return "Personal";
    default:
      return costClass ?? null;
  }
}

export function groupAccountsByType<T extends { account_type: string }>(
  accounts: readonly T[],
): GroupedAccounts<T> {
  const buckets = new Map<string, T[]>();
  for (const a of accounts) {
    const key = a.account_type;
    const list = buckets.get(key);
    if (list) list.push(a);
    else buckets.set(key, [a]);
  }

  const out: GroupedAccounts<T> = [];
  for (const t of ACCOUNT_TYPE_ORDER) {
    const list = buckets.get(t);
    if (list && list.length > 0) {
      out.push({ type: t, label: ACCOUNT_TYPE_LABELS[t] ?? t, accounts: list });
      buckets.delete(t);
    }
  }
  // Anything with an unexpected type still gets shown.
  for (const [t, list] of [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    out.push({ type: t, label: ACCOUNT_TYPE_LABELS[t] ?? t, accounts: list });
  }
  return out;
}

// ---------------------------------------------------------------------------
// DATES
// ---------------------------------------------------------------------------

/** The date the books begin. Nothing before this belongs in them (rule 10). */
export const LINE_IN_THE_SAND = "2026-01-01";

export function isValidYmd(value: string): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
  );
}

/**
 * Validate a requested range BEFORE calling the database, so the common
 * mistakes get a good message without a round trip. The database checks again
 * — this is the courtesy, that is the guarantee.
 */
export function validateRange(
  from: string,
  to: string,
): { ok: true } | { ok: false; problem: string } {
  if (!isValidYmd(from)) return { ok: false, problem: `"${from}" is not a valid date.` };
  if (!isValidYmd(to)) return { ok: false, problem: `"${to}" is not a valid date.` };
  if (from > to) {
    return {
      ok: false,
      problem:
        "The start date is after the end date. That would return nothing at all, which looks exactly like a quiet month.",
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// SELF-TESTS
//
// Run with:
//   npx tsx -e "require('./src/lib/accounting/books-view-core').__runBooksViewCoreTests()"
// ---------------------------------------------------------------------------
export function __runBooksViewCoreTests(): void {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
    passed++;
  };
  const eq = (a: unknown, b: unknown, msg: string) =>
    ok(
      JSON.stringify(a) === JSON.stringify(b),
      `${msg} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`,
    );

  // --- THE GATE. The most important assertions in this file. -----------
  // The app gate and the database gate must agree for EVERY role. If they
  // ever diverge, someone reaches a page they cannot use, or — far worse —
  // reaches data they should not see.
  for (const role of ALL_STAFF_ROLES) {
    const app = canReadBooks(role);
    const db = DB_IS_OWNER_ROLES.includes(role);
    ok(
      app === db,
      `the page gate and the database gate agree for role "${role}" (page=${app}, db=${db})`,
    );
  }
  ok(canReadBooks("owner"), "owner can read the books");
  // NEGATIVE CONTROLS (rule 15b). These are the roles that pass "reports.view"
  // but must NOT reach the ledger. As of the 2026-08-17 owner decision, ADMIN
  // is one of them.
  ok(!canReadBooks("admin"), "an ADMIN cannot read the books (owner decision 2026-08-17)");
  ok(!canReadBooks("manager"), "a MANAGER cannot read the books (passes reports.view!)");
  ok(!canReadBooks("readonly"), "READONLY cannot read the books (passes reports.view!)");
  ok(!canReadBooks("staff"), "staff cannot read the books");
  ok(!canReadBooks("content_editor"), "a content editor cannot read the books");
  ok(!canReadBooks(null), "a signed-out user cannot read the books");
  ok(!canReadBooks(undefined), "an unknown role cannot read the books");
  // Coverage: if a new role is added to the system and not to this list, this
  // fails rather than silently defaulting.
  eq(ALL_STAFF_ROLES.length, 6, "all six roles are covered by the gate test");

  // DRIFT CHECK. `ALL_STAFF_ROLES` is derived from a Record keyed by the
  // StaffRole union, so the COMPILER already stops us from forgetting a role.
  // But the app keeps its own registry in roles.ts, and if that one grew a
  // role the union did not, the gate test above would still pass while
  // covering less than the real system. So compare the two registries
  // directly. Sorted, because neither promises an order.
  const mine = [...ALL_STAFF_ROLES].sort();
  const theirs = [...ALL_ROLES].sort();
  eq(mine, theirs, "our role list matches the app's own ALL_ROLES registry");

  // And every role the app knows about must get an explicit gate answer --
  // never `undefined`, which would be neither allowed nor denied.
  for (const role of ALL_ROLES) {
    eq(
      typeof canReadBooks(role),
      "boolean",
      `the gate returns a real true/false for role "${role}"`,
    );
  }

  // --- IS THE GATE ACTUALLY WIRED? (rule 16) ---------------------------
  // The page gate is `canReadBooks`. The NAV gate is the "books.view"
  // permission in the roles matrix. Two separate mechanisms, and a user only
  // has a good experience if they agree: if the nav is more generous than the
  // page, someone clicks a link and gets bounced; if the page is more generous
  // than the nav, a legitimate user cannot find their own books. Assert they
  // agree for EVERY role rather than trusting that we edited both.
  for (const role of ALL_ROLES) {
    const pageGate = canReadBooks(role);
    const navGate = can(role, "books.view");
    ok(
      pageGate === navGate,
      `the nav permission and the page gate agree for role "${role}" (page=${pageGate}, nav=${navGate})`,
    );
  }

  // And the permission must NOT have been hung off reports.view, which also
  // grants manager and readonly. This is the specific mistake F5-K exists to
  // prevent, so it gets its own named assertion.
  //
  // OWNER DECISION 2026-08-17 (supersedes the earlier owner+admin rule):
  //   "there is no reason anyone else needs to see my books or my financials
  //    ever... The only thing an admin can do is pay vendors and pay employees."
  // This assertion previously read ["admin", "owner"]. It is now owner alone.
  const booksRoles = [...rolesForPermission("books.view")];
  eq(booksRoles, ["owner"], "books.view is OWNER ONLY");
  for (const role of ALL_ROLES) {
    if (role === "owner") continue;
    ok(!can(role, "books.view"), `role "${role}" does NOT get books.view`);
    ok(!canReadBooks(role), `role "${role}" cannot read the books`);
  }
  ok(!can("admin", "books.view"), "an admin does NOT get books.view (owner decision)");
  // Negative control: the admin must KEEP the two powers Michael preserved,
  // otherwise this lockdown has gone too far and broken vendor/employee payment.
  ok(can("admin", "payables.manage"), "an admin KEEPS pay-vendors (payables.manage)");
  ok(can("admin", "staffing.manage"), "an admin KEEPS pay-employees (staffing.manage)");
  // Negative control (rule 15b): prove those two roles really do hold
  // reports.view, otherwise the two assertions above would be trivially true
  // and would still pass if the whole matrix were empty.
  ok(can("manager", "reports.view"), "NEGATIVE CONTROL: manager does hold reports.view");
  ok(can("readonly", "reports.view"), "NEGATIVE CONTROL: readonly does hold reports.view");

  // --- formatCents ------------------------------------------------------
  eq(formatCents(0), "0.00", "zero");
  eq(formatCents(1), "0.01", "one cent");
  eq(formatCents(100), "1.00", "one dollar");
  eq(formatCents(123456), "1,234.56", "thousands separator");
  eq(formatCents(100000000), "1,000,000.00", "millions");
  eq(formatCents(-2500), "(25.00)", "negatives use accounting parentheses");
  eq(formatCents(5), "0.05", "five cents pads correctly");
  eq(formatCents(50), "0.50", "fifty cents pads correctly");
  // NEGATIVE CONTROL: a naive `cents/100` implementation produces "0.5" here.
  ok(formatCents(50).endsWith(".50"), "half a dollar is .50 not .5");
  eq(formatCents(Number.NaN), "—", "NaN does not render as money");
  eq(formatCents(Number.POSITIVE_INFINITY), "—", "Infinity does not render as money");

  // --- splitDebitCredit -------------------------------------------------
  eq(splitDebitCredit(1000), { debit: 1000, credit: 0 }, "positive is a debit");
  eq(splitDebitCredit(-1000), { debit: 0, credit: 1000 }, "negative is a credit, unsigned");
  eq(splitDebitCredit(0), { debit: 0, credit: 0 }, "zero is neither");
  ok(splitDebitCredit(-5).credit > 0, "a credit is never shown negative");

  // --- describeBooks ----------------------------------------------------
  const empty = describeBooks({
    balanced: true, certified: false, lineCount: 0,
    accountCount: 0, differenceCents: 0, abnormalCount: 0,
  });
  eq(empty.tone, "warning", "an EMPTY set of books is a warning, not 'good'");
  ok(
    /empty/i.test(empty.detail),
    "the empty case explicitly warns that empty books balance perfectly",
  );

  const bad = describeBooks({
    balanced: false, certified: false, lineCount: 10,
    accountCount: 4, differenceCents: -12345, abnormalCount: 0,
  });
  eq(bad.tone, "bad", "out of balance is bad");
  ok(bad.headline.includes("123.45"), "the out-of-balance headline states the amount");

  const good = describeBooks({
    balanced: true, certified: true, lineCount: 100,
    accountCount: 20, differenceCents: 0, abnormalCount: 0,
  });
  eq(good.tone, "good", "balanced with entries is good");
  // THE ASSERTION THAT PROTECTS AGAINST FALSE CONFIDENCE.
  ok(
    /does not prove/i.test(good.detail),
    "a balanced verdict must NEVER claim the figures are correct",
  );

  const abnormal = describeBooks({
    balanced: true, certified: true, lineCount: 100,
    accountCount: 20, differenceCents: 0, abnormalCount: 3,
  });
  eq(abnormal.tone, "warning", "abnormal balances downgrade the tone");
  ok(abnormal.detail.includes("3 accounts"), "abnormal count is reported");

  // --- groupAccountsByType ---------------------------------------------
  const accts = [
    { account_type: "expense", code: "e" },
    { account_type: "asset", code: "a" },
    { account_type: "revenue", code: "r" },
    { account_type: "liability", code: "l" },
    { account_type: "equity", code: "q" },
  ];
  const grouped = groupAccountsByType(accts);
  eq(
    grouped.map((g) => g.type),
    ["asset", "liability", "equity", "revenue", "expense"],
    "balance-sheet order, not alphabetical",
  );
  // NEGATIVE CONTROL: an unknown type must be KEPT, not silently dropped.
  const withWeird = groupAccountsByType([...accts, { account_type: "mystery", code: "m" }]);
  eq(withWeird.length, 6, "an unknown account type is kept, never dropped");
  ok(
    withWeird[withWeird.length - 1].type === "mystery",
    "unknown types are appended at the end",
  );
  eq(groupAccountsByType([]).length, 0, "empty in, empty out");
  // Nothing is lost overall.
  eq(
    withWeird.reduce((n, g) => n + g.accounts.length, 0),
    6,
    "every account survives grouping",
  );

  // --- dates ------------------------------------------------------------
  ok(isValidYmd("2026-01-01"), "valid date");
  ok(!isValidYmd("2026-13-01"), "month 13 is invalid");
  ok(!isValidYmd("2026-02-30"), "30 February is invalid");
  ok(!isValidYmd("2026-1-1"), "unpadded is invalid");
  ok(!isValidYmd(""), "empty is invalid");
  ok(isValidYmd("2024-02-29"), "a real leap day is valid");
  ok(!isValidYmd("2025-02-29"), "a fake leap day is invalid");

  eq(validateRange("2026-01-01", "2026-12-31").ok, true, "a sane range is accepted");
  const backwards = validateRange("2026-12-31", "2026-01-01");
  eq(backwards.ok, false, "a backwards range is rejected");
  ok(
    backwards.ok === false && /quiet month/i.test(backwards.problem),
    "the backwards-range message explains WHY it matters",
  );
  eq(validateRange("nonsense", "2026-01-01").ok, false, "an invalid start is rejected");
  eq(validateRange("2026-01-01", "nonsense").ok, false, "an invalid end is rejected");
  // NEGATIVE CONTROL: equal dates are a single valid day, not backwards.
  eq(validateRange("2026-05-05", "2026-05-05").ok, true, "a one-day range is valid");

  eq(LINE_IN_THE_SAND, "2026-01-01", "the books begin 1 January 2026");

  // --- accountBelongsToEntity -------------------------------------------
  //
  // THESE TESTS EXIST BECAUSE OF A REAL OUTAGE. The chart of accounts page
  // was dead in production: the query asked for a column named `entity_id`,
  // which does not exist on `gl_accounts`. The real column is
  // `allowed_entity_codes`, and it is a LIST, because an account can be
  // shared by several sets of books. The old code modelled it as one uuid,
  // so account 10300 (Bank -- ATM Vault, allowed for BOTH `atm` and
  // `greenway`) could not have been represented correctly even if the name
  // had been right. Rule 19: the failure becomes permanent test corpus.
  ok(
    accountBelongsToEntity({ allowed_entity_codes: null }, "greenway"),
    "a NULL list means the account is shared by every set of books",
  );
  ok(
    accountBelongsToEntity({ allowed_entity_codes: null }, "personal"),
    "shared accounts appear on the personal books too",
  );
  ok(
    accountBelongsToEntity({ allowed_entity_codes: ["greenway"] }, "greenway"),
    "an account restricted to greenway appears on greenway",
  );
  ok(
    !accountBelongsToEntity({ allowed_entity_codes: ["greenway"] }, "atm"),
    "an account restricted to greenway does NOT appear on the ATM books",
  );
  // The real 10300 row, verbatim from the seeded chart.
  ok(
    accountBelongsToEntity({ allowed_entity_codes: ["atm", "greenway"] }, "atm"),
    "10300 is allowed for the ATM books",
  );
  ok(
    accountBelongsToEntity({ allowed_entity_codes: ["atm", "greenway"] }, "greenway"),
    "10300 is ALSO allowed for greenway -- a single entity_id could never say this",
  );
  ok(
    !accountBelongsToEntity({ allowed_entity_codes: ["atm", "greenway"] }, "landholding"),
    "10300 stays off the landholding books",
  );
  // NEGATIVE CONTROL: an empty list is a restriction to nothing, and must NOT
  // be confused with NULL's "no restriction". If these two ever collapse
  // together, a deliberately fenced-off account starts appearing everywhere.
  ok(
    !accountBelongsToEntity({ allowed_entity_codes: [] }, "greenway"),
    "an EMPTY list restricts to nothing and is not the same as NULL",
  );
  // Exact matching only: no prefix or case games.
  ok(
    !accountBelongsToEntity({ allowed_entity_codes: ["greenway"] }, "green"),
    "matching is exact, not by prefix",
  );
  ok(
    !accountBelongsToEntity({ allowed_entity_codes: ["greenway"] }, "GREENWAY"),
    "matching is case-sensitive, matching the database's own comparison",
  );

  // ---------------------------------------------------------------------------
  // 280E BADGE SCOPING (owner defect, 2026-08-15).
  // "All the businesses and even my personal COA have the 280E non-deductible
  // label on them. It should only be on the greenway business."
  // ---------------------------------------------------------------------------
  ok(
    shouldShowCostClassBadge("nondeductible_280e", "greenway"),
    "280E badge SHOWS on the cannabis books",
  );
  ok(
    !shouldShowCostClassBadge("nondeductible_280e", "atm"),
    "280E badge HIDDEN on the ATM books",
  );
  ok(
    !shouldShowCostClassBadge("nondeductible_280e", "landholding"),
    "280E badge HIDDEN on the landholding books",
  );
  ok(
    !shouldShowCostClassBadge("nondeductible_280e", "personal"),
    "280E badge HIDDEN on the personal books",
  );
  // COGS classes are equally 280E-flavoured and must be scoped the same way.
  ok(
    shouldShowCostClassBadge("cogs_direct", "greenway"),
    "COGS badge shows on greenway",
  );
  ok(
    !shouldShowCostClassBadge("cogs_direct", "atm"),
    "COGS badge hidden on the ATM books",
  );
  ok(
    !shouldShowCostClassBadge("cogs_allocable", "landholding"),
    "allocable-COGS badge hidden on landholding",
  );
  // Non-280E classes are still informative everywhere.
  ok(
    shouldShowCostClassBadge("separate_business", "atm"),
    "separate_business badge still shows on the ATM books",
  );
  ok(
    shouldShowCostClassBadge("personal", "personal"),
    "personal badge still shows on the personal books",
  );
  // Empty states.
  ok(!shouldShowCostClassBadge("none", "greenway"), "'none' never badges");
  ok(!shouldShowCostClassBadge(null, "greenway"), "null never badges");
  ok(!shouldShowCostClassBadge(undefined, "greenway"), "undefined never badges");
  ok(!shouldShowCostClassBadge("", "greenway"), "empty string never badges");

  // Labels.
  ok(
    costClassBadgeLabel("nondeductible_280e", "greenway") === "280E — not deductible",
    "280E label is plain English on greenway",
  );
  ok(
    costClassBadgeLabel("nondeductible_280e", "atm") === null,
    "no 280E label at all on the ATM books",
  );
  ok(
    costClassBadgeLabel("separate_business", "landholding") === "Separate business",
    "separate business label reads plainly",
  );
  ok(
    costClassBadgeLabel("mystery_class", "atm") === "mystery_class",
    "an unknown class falls back to its raw name rather than vanishing",
  );

  // THE EXACT SHARED-ACCOUNT CASE THAT CAUSED THE BUG: 70010 Rent is one account
  // for all four books, stored as nondeductible_280e, with no entity restriction.
  {
    const rent = { code: "70010", cost_class: "nondeductible_280e", allowed_entity_codes: null };
    ok(
      accountBelongsToEntity(rent, "atm") && !shouldShowCostClassBadge(rent.cost_class, "atm"),
      "shared rent account is USABLE on the ATM books but carries NO 280E badge there",
    );
    ok(
      accountBelongsToEntity(rent, "greenway") && shouldShowCostClassBadge(rent.cost_class, "greenway"),
      "the same shared rent account DOES carry the badge on greenway",
    );
  }

  console.log(`books-view-core: PASSED ${passed} assertions`);
}
