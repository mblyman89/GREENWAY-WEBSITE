/**
 * tests/compliance/books-view-core.test.ts
 *
 * Adversarial mirror for `books-view-core.ts` -- the module that decides WHO
 * MAY SEE THE BOOKS, how money is rendered, and what the banner at the top of
 * the trial balance says.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS (the audit finding it closes)
 * ---------------------------------------------------------------------------
 * This module shipped with a 104-assertion self-test suite that was wired into
 * NEITHER gate: it was absent from `scripts/compliance/run-pure-selftests.ts`
 * and it had no vitest mirror. The assertions passed, but they only ran if a
 * human typed the command by hand. A regression in `canReadBooks` -- the
 * function that mirrors the database's `is_admin()` -- would have merged green.
 *
 * This is the SAME defect the repo already caught once, in `trial-balance-core`
 * (see todo.md, F4-M): registered in vitest but never invoked by the runner.
 * It was left open in two more files. Both halves are now closed: the runner
 * calls both suites, and this file mirrors them.
 *
 * ---------------------------------------------------------------------------
 * HOW THESE TESTS ARE WRITTEN
 * ---------------------------------------------------------------------------
 * They are written to BREAK the module, not to confirm it (rule 13b).
 * Predicates are SWEPT across their whole domain rather than sampled at one
 * happy value (rule 15b), and every guard carries a NEGATIVE CONTROL proving
 * the wrong answer is genuinely refused rather than the right answer merely
 * accepted.
 *
 * The single most important test in this file is the one that proves
 * `canReadBooks` and `DB_IS_ADMIN_ROLES` agree ACROSS EVERY ROLE. They are
 * written independently in the source precisely so a test can compare them;
 * comparing a function to itself proves nothing.
 */
import { describe, it, expect } from "vitest";
import {
  ALL_STAFF_ROLES,
  canReadBooks,
  DB_IS_ADMIN_ROLES,
  formatCents,
  splitDebitCredit,
  describeBooks,
  ACCOUNT_TYPE_ORDER,
  ACCOUNT_TYPE_LABELS,
  accountBelongsToEntity,
  shouldShowCostClassBadge,
  costClassBadgeLabel,
  groupAccountsByType,
  LINE_IN_THE_SAND,
  isValidYmd,
  validateRange,
  __runBooksViewCoreTests,
} from "../../src/lib/accounting/books-view-core";

describe("books-view-core: the embedded self-tests", () => {
  it("passes its own suite", () => {
    expect(() => __runBooksViewCoreTests()).not.toThrow();
  });
});

// ===========================================================================
// ACCESS -- the most consequential function in the file
// ===========================================================================
describe("books-view-core: who may read the books", () => {
  it("agrees with DB_IS_ADMIN_ROLES for EVERY role, swept", () => {
    // The whole point: two independent statements of the same rule must match
    // across the entire domain, not at one sampled value.
    for (const role of ALL_STAFF_ROLES) {
      expect(canReadBooks(role), `role=${role}`).toBe(
        DB_IS_ADMIN_ROLES.includes(role),
      );
    }
  });

  it("admits exactly owner and admin -- and nobody else", () => {
    expect(canReadBooks("owner")).toBe(true);
    expect(canReadBooks("admin")).toBe(true);

    // NEGATIVE CONTROLS. Each of these is a real role in this system.
    expect(canReadBooks("manager")).toBe(false);
    expect(canReadBooks("content_editor")).toBe(false);
    expect(canReadBooks("staff")).toBe(false);
    expect(canReadBooks("readonly")).toBe(false);
  });

  it("counts exactly two admitted roles (a widened gate fails here)", () => {
    const admitted = ALL_STAFF_ROLES.filter((r) => canReadBooks(r));
    expect(admitted.sort()).toEqual(["admin", "owner"]);
    expect(admitted).toHaveLength(2);
  });

  it("refuses null, undefined and unknown roles rather than defaulting open", () => {
    expect(canReadBooks(null)).toBe(false);
    expect(canReadBooks(undefined)).toBe(false);
    // A role that does not exist must never be admitted by accident.
    expect(canReadBooks("superuser" as never)).toBe(false);
    expect(canReadBooks("" as never)).toBe(false);
    expect(canReadBooks("OWNER" as never)).toBe(false); // case matters
    expect(canReadBooks(" owner" as never)).toBe(false); // no trimming
  });

  it("covers all six known roles (a shrunken role list fails here)", () => {
    expect([...ALL_STAFF_ROLES].sort()).toEqual([
      "admin",
      "content_editor",
      "manager",
      "owner",
      "readonly",
      "staff",
    ]);
  });
});

// ===========================================================================
// MONEY
// ===========================================================================
describe("books-view-core: formatCents", () => {
  it("renders whole and fractional dollars with two decimals", () => {
    expect(formatCents(0)).toBe("0.00");
    expect(formatCents(1)).toBe("0.01");
    expect(formatCents(10)).toBe("0.10");
    expect(formatCents(100)).toBe("1.00");
    expect(formatCents(999)).toBe("9.99");
  });

  it("groups thousands", () => {
    expect(formatCents(100_000)).toBe("1,000.00");
    expect(formatCents(123_456_789)).toBe("1,234,567.89");
  });

  it("shows negatives in PARENTHESES, never with a minus sign", () => {
    // Accounting convention. A minus sign in a money column is a reader's cue
    // that the report was built by someone who does not read reports.
    expect(formatCents(-1)).toBe("(0.01)");
    expect(formatCents(-150_000)).toBe("(1,500.00)");
    expect(formatCents(-1)).not.toContain("-");
  });

  it("never loses the cents to floating point across a swept range", () => {
    for (let c = 0; c <= 250; c++) {
      const s = formatCents(c);
      const expectedRem = (c % 100).toString().padStart(2, "0");
      expect(s.endsWith(`.${expectedRem}`), `cents=${c} -> ${s}`).toBe(true);
    }
  });

  it("returns an em-dash for values that are not finite", () => {
    // NEGATIVE CONTROL: NaN must not render as "NaN.00" or "0.00". Printing a
    // broken number as zero is how a missing figure becomes an invisible one.
    expect(formatCents(Number.NaN)).toBe("\u2014");
    expect(formatCents(Number.POSITIVE_INFINITY)).toBe("\u2014");
    expect(formatCents(Number.NEGATIVE_INFINITY)).toBe("\u2014");
  });

  it("truncates rather than rounding a fractional cent", () => {
    // Money is integer cents (rule 7). A fractional input is already a bug
    // upstream; this must not silently round it into a different number.
    expect(formatCents(100.9)).toBe("1.00");
    expect(formatCents(-100.9)).toBe("(1.00)");
  });
});

describe("books-view-core: splitDebitCredit", () => {
  it("puts a positive balance in the debit column only", () => {
    expect(splitDebitCredit(150_000)).toEqual({ debit: 150_000, credit: 0 });
  });

  it("puts a negative balance in the credit column, as a POSITIVE number", () => {
    expect(splitDebitCredit(-150_000)).toEqual({ debit: 0, credit: 150_000 });
  });

  it("puts zero in neither column", () => {
    expect(splitDebitCredit(0)).toEqual({ debit: 0, credit: 0 });
  });

  it("never emits a negative number into either column, swept", () => {
    for (let v = -500; v <= 500; v += 7) {
      const { debit, credit } = splitDebitCredit(v);
      expect(debit >= 0, `debit for ${v}`).toBe(true);
      expect(credit >= 0, `credit for ${v}`).toBe(true);
      // Exactly one column is populated for a non-zero balance.
      if (v !== 0) expect(debit === 0 || credit === 0).toBe(true);
    }
  });

  it("preserves magnitude: debit or credit always equals |balance|", () => {
    for (let v = -300; v <= 300; v += 11) {
      const { debit, credit } = splitDebitCredit(v);
      expect(debit + credit).toBe(Math.abs(v));
    }
  });
});

// ===========================================================================
// THE VERDICT BANNER -- where a wrong word costs the most
// ===========================================================================
describe("books-view-core: describeBooks", () => {
  const base = {
    balanced: true,
    certified: true,
    lineCount: 10,
    accountCount: 4,
    differenceCents: 0,
    abnormalCount: 0,
  };

  it("calls an EMPTY period a warning, never good news", () => {
    // THE TRAP: an empty set of books balances perfectly. If this ever returns
    // tone "good", the screen congratulates Michael for having no data.
    const v = describeBooks({ ...base, lineCount: 0, accountCount: 0 });
    expect(v.tone).toBe("warning");
    expect(v.tone).not.toBe("good");
    expect(v.headline).toMatch(/nothing here/i);
  });

  it("explains WHY an empty report is not a clean one", () => {
    const v = describeBooks({ ...base, lineCount: 0, accountCount: 0 });
    expect(v.detail).toMatch(/empty set of books balances perfectly/i);
  });

  it("calls an out-of-balance period BAD and names the amount", () => {
    const v = describeBooks({
      ...base,
      balanced: false,
      differenceCents: -250_000,
    });
    expect(v.tone).toBe("bad");
    // The amount is shown as an absolute value, not "(2,500.00)".
    expect(v.headline).toContain("2,500.00");
    expect(v.headline).not.toContain("(");
  });

  it("out-of-balance beats abnormal accounts (worst news wins)", () => {
    const v = describeBooks({
      ...base,
      balanced: false,
      differenceCents: 1,
      abnormalCount: 99,
    });
    expect(v.tone).toBe("bad");
  });

  it("never claims a balanced set of books is PROVEN right", () => {
    // The wording rule that matters most in this file.
    const v = describeBooks(base);
    expect(v.tone).toBe("good");
    expect(v.headline).toMatch(/debits equal credits/i);
    expect(v.detail).toMatch(/does not prove the figures are right/i);
  });

  it("downgrades good -> warning when an account sits on the unusual side", () => {
    const v = describeBooks({ ...base, abnormalCount: 1 });
    expect(v.tone).toBe("warning");
    expect(v.detail).toMatch(/unusual side/i);
  });

  it("uses singular and plural correctly for abnormal accounts", () => {
    expect(describeBooks({ ...base, abnormalCount: 1 }).detail).toMatch(
      /1 account has/,
    );
    expect(describeBooks({ ...base, abnormalCount: 3 }).detail).toMatch(
      /3 accounts have/,
    );
  });

  it("never returns an empty headline or detail for any input shape", () => {
    const cases = [
      base,
      { ...base, lineCount: 0 },
      { ...base, balanced: false, differenceCents: 5 },
      { ...base, abnormalCount: 2 },
    ];
    for (const c of cases) {
      const v = describeBooks(c);
      expect(v.headline.length, JSON.stringify(c)).toBeGreaterThan(0);
      expect(v.detail.length, JSON.stringify(c)).toBeGreaterThan(0);
      expect(["good", "warning", "bad"]).toContain(v.tone);
    }
  });
});

// ===========================================================================
// ENTITY SCOPING -- an account nobody can see is an account nobody reconciles
// ===========================================================================
describe("books-view-core: accountBelongsToEntity", () => {
  it("treats NULL allowed_entity_codes as shared by all four sets of books", () => {
    for (const e of ["greenway", "atm", "landholding", "personal"]) {
      expect(accountBelongsToEntity({ allowed_entity_codes: null }, e)).toBe(true);
    }
  });

  it("treats an EMPTY list as restricted-to-nothing, NOT as shared", () => {
    // THE DISTINCTION THAT MATTERS. NULL means "no restriction"; [] means
    // "restricted to nothing". Collapsing them would publish an account that
    // was deliberately fenced off.
    for (const e of ["greenway", "atm", "landholding", "personal"]) {
      expect(accountBelongsToEntity({ allowed_entity_codes: [] }, e)).toBe(false);
    }
  });

  it("honours a multi-entity list (10300 is both atm and greenway)", () => {
    const acct = { allowed_entity_codes: ["atm", "greenway"] };
    expect(accountBelongsToEntity(acct, "atm")).toBe(true);
    expect(accountBelongsToEntity(acct, "greenway")).toBe(true);
    // NEGATIVE CONTROLS
    expect(accountBelongsToEntity(acct, "personal")).toBe(false);
    expect(accountBelongsToEntity(acct, "landholding")).toBe(false);
  });

  it("matches exactly -- no prefix, case or whitespace leniency", () => {
    const acct = { allowed_entity_codes: ["greenway"] };
    expect(accountBelongsToEntity(acct, "green")).toBe(false);
    expect(accountBelongsToEntity(acct, "greenway2")).toBe(false);
    expect(accountBelongsToEntity(acct, "GREENWAY")).toBe(false);
    expect(accountBelongsToEntity(acct, " greenway")).toBe(false);
  });
});

// ===========================================================================
// 280E BADGES -- a cosmetic bug here suppresses a real deduction
// ===========================================================================
describe("books-view-core: the 280E badge", () => {
  const CANNABIS_ONLY = ["nondeductible_280e", "cogs_direct", "cogs_allocable"];

  it("shows cannabis cost classes ONLY on the greenway books", () => {
    // Michael's reported defect: shared account 70010 (Rent) stores
    // nondeductible_280e with allowed_entity_codes = null, so the ATM's rent
    // wore a 280E badge it could never earn. CHAMP v. Commissioner (128 T.C.
    // 173) is why that is not merely cosmetic.
    for (const cc of CANNABIS_ONLY) {
      expect(shouldShowCostClassBadge(cc, "greenway"), cc).toBe(true);
      for (const e of ["atm", "landholding", "personal"]) {
        expect(shouldShowCostClassBadge(cc, e), `${cc}/${e}`).toBe(false);
      }
    }
  });

  it("shows non-cannabis classes on every set of books", () => {
    for (const e of ["greenway", "atm", "landholding", "personal"]) {
      expect(shouldShowCostClassBadge("separate_business", e)).toBe(true);
      expect(shouldShowCostClassBadge("personal", e)).toBe(true);
    }
  });

  it("shows no badge at all for 'none', null, undefined or empty", () => {
    for (const e of ["greenway", "atm", "landholding", "personal"]) {
      expect(shouldShowCostClassBadge("none", e)).toBe(false);
      expect(shouldShowCostClassBadge(null, e)).toBe(false);
      expect(shouldShowCostClassBadge(undefined, e)).toBe(false);
      expect(shouldShowCostClassBadge("", e)).toBe(false);
    }
  });

  it("labels agree with the predicate everywhere (no orphan labels)", () => {
    const classes = [
      "nondeductible_280e",
      "cogs_direct",
      "cogs_allocable",
      "separate_business",
      "personal",
      "none",
      null,
      undefined,
      "",
    ];
    for (const cc of classes) {
      for (const e of ["greenway", "atm", "landholding", "personal"]) {
        const shown = shouldShowCostClassBadge(cc, e);
        const label = costClassBadgeLabel(cc, e);
        // A label must exist if and only if the badge is shown.
        expect(label !== null, `${String(cc)}/${e}`).toBe(shown);
      }
    }
  });

  it("uses the exact agreed wording", () => {
    expect(costClassBadgeLabel("nondeductible_280e", "greenway")).toBe(
      "280E \u2014 not deductible",
    );
    expect(costClassBadgeLabel("cogs_direct", "greenway")).toBe("COGS \u2014 deductible");
    expect(costClassBadgeLabel("cogs_allocable", "greenway")).toBe("COGS \u2014 allocable");
    expect(costClassBadgeLabel("separate_business", "atm")).toBe("Separate business");
    expect(costClassBadgeLabel("personal", "personal")).toBe("Personal");
  });

  it("never prints the words 'not deductible' on a non-cannabis book", () => {
    // The specific harm: a label that discourages a deduction Michael is
    // entitled to on the ATM / landholding / personal returns.
    for (const e of ["atm", "landholding", "personal"]) {
      expect(costClassBadgeLabel("nondeductible_280e", e)).toBeNull();
    }
  });

  it("passes an unknown cost class through rather than swallowing it", () => {
    // Surfacing an unrecognised value is better than hiding it (rule 3).
    expect(costClassBadgeLabel("brand_new_class", "atm")).toBe("brand_new_class");
  });
});

// ===========================================================================
// GROUPING -- a dropped account is an unreconciled account
// ===========================================================================
describe("books-view-core: groupAccountsByType", () => {
  it("orders groups as a balance sheet reads, not alphabetically", () => {
    const accounts = [
      { account_type: "expense" },
      { account_type: "revenue" },
      { account_type: "equity" },
      { account_type: "liability" },
      { account_type: "asset" },
    ];
    expect(groupAccountsByType(accounts).map((g) => g.type)).toEqual([
      "asset",
      "liability",
      "equity",
      "revenue",
      "expense",
    ]);
    // NEGATIVE CONTROL: alphabetical would be asset, equity, expense, ...
    expect(groupAccountsByType(accounts).map((g) => g.type)).not.toEqual(
      [...accounts.map((a) => a.account_type)].sort(),
    );
  });

  it("NEVER drops an account with an unexpected type", () => {
    const accounts = [
      { account_type: "asset" },
      { account_type: "wormhole" },
      { account_type: "revenue" },
    ];
    const grouped = groupAccountsByType(accounts);
    const total = grouped.reduce((n, g) => n + g.accounts.length, 0);
    expect(total).toBe(3);
    expect(grouped.map((g) => g.type)).toContain("wormhole");
  });

  it("appends unknown types AFTER the known ones", () => {
    const grouped = groupAccountsByType([
      { account_type: "zzz_unknown" },
      { account_type: "asset" },
    ]);
    expect(grouped[0].type).toBe("asset");
    expect(grouped[grouped.length - 1].type).toBe("zzz_unknown");
  });

  it("omits groups that have no accounts rather than showing empty headings", () => {
    const grouped = groupAccountsByType([{ account_type: "asset" }]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].type).toBe("asset");
  });

  it("preserves input order within a group", () => {
    const grouped = groupAccountsByType([
      { account_type: "asset", code: "10000" },
      { account_type: "asset", code: "10100" },
      { account_type: "asset", code: "10200" },
    ]);
    expect(grouped[0].accounts.map((a) => a.code)).toEqual([
      "10000",
      "10100",
      "10200",
    ]);
  });

  it("handles an empty list without inventing groups", () => {
    expect(groupAccountsByType([])).toEqual([]);
  });

  it("gives every known type a plain-English label", () => {
    for (const t of ACCOUNT_TYPE_ORDER) {
      expect(ACCOUNT_TYPE_LABELS[t], t).toBeTruthy();
      // Plain English means the label explains the term, not just repeats it.
      expect(ACCOUNT_TYPE_LABELS[t].length).toBeGreaterThan(t.length);
    }
  });
});

// ===========================================================================
// DATES
// ===========================================================================
describe("books-view-core: dates", () => {
  it("pins the line in the sand at 2026-01-01", () => {
    expect(LINE_IN_THE_SAND).toBe("2026-01-01");
    expect(isValidYmd(LINE_IN_THE_SAND)).toBe(true);
  });

  it("accepts real dates and rejects impossible ones", () => {
    expect(isValidYmd("2026-01-01")).toBe(true);
    expect(isValidYmd("2026-12-31")).toBe(true);
    // Leap-year arithmetic, both directions.
    expect(isValidYmd("2028-02-29")).toBe(true); // 2028 IS a leap year
    expect(isValidYmd("2026-02-29")).toBe(false); // 2026 is not
    expect(isValidYmd("2026-02-30")).toBe(false);
    expect(isValidYmd("2026-04-31")).toBe(false); // April has 30
    expect(isValidYmd("2026-13-01")).toBe(false);
    expect(isValidYmd("2026-00-01")).toBe(false);
    expect(isValidYmd("2026-01-00")).toBe(false);
  });

  it("rejects anything not in strict YYYY-MM-DD shape", () => {
    for (const bad of [
      "2026-1-1",
      "26-01-01",
      "2026/01/01",
      "01-01-2026",
      "2026-01-01T00:00:00Z",
      "2026-01-01 ",
      "",
      "not a date",
    ]) {
      expect(isValidYmd(bad), bad).toBe(false);
    }
  });

  it("rejects non-string inputs rather than coercing them", () => {
    expect(isValidYmd(null as never)).toBe(false);
    expect(isValidYmd(undefined as never)).toBe(false);
    expect(isValidYmd(20260101 as never)).toBe(false);
  });

  it("accepts a well-formed range", () => {
    expect(validateRange("2026-01-01", "2026-12-31")).toEqual({ ok: true });
  });

  it("accepts a single-day range (from === to)", () => {
    // A one-day trial balance is a legitimate request; an off-by-one here
    // would refuse it.
    expect(validateRange("2026-06-15", "2026-06-15")).toEqual({ ok: true });
  });

  it("REFUSES a backwards range and explains why it is dangerous", () => {
    const r = validateRange("2026-12-31", "2026-01-01");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // The message must say WHY: an empty result looks like a quiet month.
      expect(r.problem).toMatch(/quiet month/i);
    }
  });

  it("names the offending value when a date is malformed", () => {
    const r = validateRange("garbage", "2026-01-01");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toContain("garbage");

    const r2 = validateRange("2026-01-01", "also-garbage");
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.problem).toContain("also-garbage");
  });
});
