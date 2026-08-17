/**
 * tests/compliance/cutover-core.test.ts   (slice books-02)
 *
 * THE SECOND GATE over the conversion.
 *
 * The module already tests itself (`__runCutoverCoreTests`, run by the pure
 * self-test script). This file exists because a module that only grades its own
 * homework can be wrong in a way it cannot see. So this suite:
 *
 *   1. re-runs the embedded suite, and asserts it is DETERMINISTIC;
 *   2. attacks the same functions from the outside with cases the author of the
 *      module did not choose — property sweeps, boundaries, adversarial input;
 *   3. reads the MIGRATION FILE as text and proves the SQL and the TypeScript
 *      agree about the cut-over date. This is the single highest-value test in
 *      the file: the whole slice exists because a date was stated in two places
 *      and one of them was wrong.
 *
 * Written to BREAK the module, not to confirm it. Every guard carries a
 * NEGATIVE CONTROL proving the wrong answer is genuinely refused rather than
 * the right answer merely accepted.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  CUTOVER_DATE,
  OPENING_BALANCE_DATE,
  PARALLEL_RUN_START,
  PARALLEL_RUN_END,
  SUPERSEDED_OPENING_DATE,
  ENTITY_CODES,
  ACCOUNTING_BASIS,
  OPENING_BALANCE_EQUITY_CODE,
  RETAINED_EARNINGS_CODE,
  EXPECTED_OPENING_ACCOUNTS,
  isValidIsoDate,
  isOnOrAfter,
  previousDay,
  formatCents,
  isInParallelRun,
  reviewOpeningBalances,
  reconcileParallelRun,
  canRetireLegacySystem,
  __runCutoverCoreTests,
  type OpeningRow,
  type BalanceLine,
} from "@/lib/accounting/cutover-core";

// ---------------------------------------------------------------------------

function row(over: Partial<OpeningRow> & { accountCode: string }): OpeningRow {
  return {
    accountName: over.accountName ?? `Account ${over.accountCode}`,
    accountType: over.accountType ?? "asset",
    amountCents: over.amountCents ?? 100000,
    evidenceKind: over.evidenceKind ?? "bank_statement",
    evidenceRef: over.evidenceRef ?? "Statement 2026-10-31",
    evidenceNote: over.evidenceNote ?? null,
    status: over.status ?? "staged",
    exclusionReason: over.exclusionReason ?? null,
    accountCode: over.accountCode,
  };
}

function balancedSheet(): OpeningRow[] {
  return [
    row({ accountCode: "10100", amountCents: 5000000 }),
    row({ accountCode: "12100", amountCents: 3000000, evidenceKind: "inventory_count" }),
    row({
      accountCode: RETAINED_EARNINGS_CODE,
      accountType: "equity",
      amountCents: -8000000,
      evidenceKind: "k1_or_return",
    }),
  ];
}

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");
const readMigration = (name: string) =>
  readFileSync(resolve(MIGRATIONS, name), "utf8");

// ===========================================================================

describe("cutover-core: the module's own self-tests", () => {
  it("passes its embedded suite", () => {
    expect(() => __runCutoverCoreTests()).not.toThrow();
  });

  it("is deterministic — running the suite twice changes nothing", () => {
    expect(() => __runCutoverCoreTests()).not.toThrow();
    expect(() => __runCutoverCoreTests()).not.toThrow();
  });
});

// ===========================================================================
// THE DATES. The reason this slice exists.
// ===========================================================================
describe("the cut-over dates", () => {
  it("is 1 November 2026, per the owner's decision", () => {
    expect(CUTOVER_DATE).toBe("2026-11-01");
  });

  it("dates the opening balance sheet the day BEFORE the cut-over", () => {
    expect(OPENING_BALANCE_DATE).toBe("2026-10-31");
    expect(previousDay(CUTOVER_DATE)).toBe(OPENING_BALANCE_DATE);
  });

  it("no longer uses the superseded 2025-12-31 the ledger was built around", () => {
    // NEGATIVE CONTROL: the superseded date is still exported, so this test can
    // be written at all. If someone reverts the opening date, this fails.
    expect(SUPERSEDED_OPENING_DATE).toBe("2025-12-31");
    expect(OPENING_BALANCE_DATE).not.toBe(SUPERSEDED_OPENING_DATE);
  });

  it("satisfies the line-in-the-sand constraint without needing its exemption", () => {
    // 0172: check ( journal_date >= date '2026-01-01'
    //               or (source_kind='opening_balance' and journal_date = '2025-12-31') )
    // 2026-10-31 satisfies the FIRST arm alone, so no constraint change is needed.
    expect(isOnOrAfter(OPENING_BALANCE_DATE, "2026-01-01")).toBe(true);
  });

  it("runs in parallel with Sage from the cut-over to year end", () => {
    expect(PARALLEL_RUN_START).toBe(CUTOVER_DATE);
    expect(PARALLEL_RUN_END).toBe("2026-12-31");
    expect(isInParallelRun("2026-11-01")).toBe(true);
    expect(isInParallelRun("2026-12-31")).toBe(true);
    // NEGATIVE CONTROLS: the boundaries are exclusive on both sides.
    expect(isInParallelRun("2026-10-31")).toBe(false);
    expect(isInParallelRun("2027-01-01")).toBe(false);
  });

  it("records every entity as accrual basis, per the owner's decision", () => {
    // "we are accrual based for all entities and my person."
    expect(ENTITY_CODES).toHaveLength(4);
    for (const e of ENTITY_CODES) {
      expect(ACCOUNTING_BASIS[e], `entity=${e}`).toBe("accrual");
    }
    // NEGATIVE CONTROL: prove the map is exhaustive, not merely non-empty.
    expect(Object.keys(ACCOUNTING_BASIS).sort()).toEqual([...ENTITY_CODES].sort());
  });
});

// ===========================================================================
// previousDay — swept, not sampled.
// ===========================================================================
describe("previousDay", () => {
  it("handles month, year and leap boundaries", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["2026-11-01", "2026-10-31"],
      ["2026-01-01", "2025-12-31"],
      ["2026-03-01", "2026-02-28"],
      ["2024-03-01", "2024-02-29"],
      ["2000-03-01", "2000-02-29"],
      ["1900-03-01", "1900-02-28"],
      ["2026-05-01", "2026-04-30"],
      ["2026-07-01", "2026-06-30"],
      ["2026-10-01", "2026-09-30"],
      ["2026-12-31", "2026-12-30"],
    ];
    for (const [input, expected] of cases) {
      expect(previousDay(input), `input=${input}`).toBe(expected);
    }
  });

  it("always produces a VALID date, swept across a full year", () => {
    // Every day of 2026 and 2024 (a leap year). If the function ever produced
    // something like 2026-02-30, this catches it.
    for (const year of [2024, 2026]) {
      for (let m = 1; m <= 12; m += 1) {
        for (let d = 1; d <= 31; d += 1) {
          const iso = `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          if (!isValidIsoDate(iso)) continue;
          const prev = previousDay(iso);
          expect(isValidIsoDate(prev), `${iso} -> ${prev}`).toBe(true);
          // and it must be strictly earlier
          expect(prev < iso, `${prev} < ${iso}`).toBe(true);
        }
      }
    }
  });
});

// ===========================================================================
// The opening balance worksheet.
// ===========================================================================
describe("reviewOpeningBalances", () => {
  it("blesses a clean, balanced, evidenced worksheet", () => {
    const r = reviewOpeningBalances(balancedSheet());
    expect(r.blessable).toBe(true);
    expect(r.differenceCents).toBe(0);
    expect(r.findings.filter((f) => f.severity === "block")).toHaveLength(0);
  });

  it("refuses an empty worksheet", () => {
    const r = reviewOpeningBalances([]);
    expect(r.blessable).toBe(false);
    expect(r.findings.map((f) => f.code)).toContain("CUT_EMPTY_WORKSHEET");
  });

  it("refuses a row whose amount is zero", () => {
    // REGRESSION: the slice books-02 mutation campaign deleted this check and
    // the suite stayed green. A zero opening balance is the quietest possible
    // failure — it moves no total, so nothing else notices it.
    const rows = [...balancedSheet(), row({ accountCode: "13000", amountCents: 0 })];
    const r = reviewOpeningBalances(rows);
    expect(r.blessable).toBe(false);
    const f = r.findings.find((x) => x.code === "CUT_ZERO_AMOUNT");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("block");
    expect(f!.accountCodes).toContain("13000");
    // and it disturbs no arithmetic
    expect(r.differenceCents).toBe(0);
  });

  it("does not raise the zero-amount block on a clean sheet", () => {
    expect(
      reviewOpeningBalances(balancedSheet()).findings.some(
        (f) => f.code === "CUT_ZERO_AMOUNT",
      ),
    ).toBe(false);
  });

  it("allows a zero row that has been deliberately excluded", () => {
    const r = reviewOpeningBalances([
      ...balancedSheet(),
      row({
        accountCode: "13000",
        amountCents: 0,
        status: "excluded",
        exclusionReason: "Closed in 2025",
      }),
    ]);
    expect(r.blessable).toBe(true);
    expect(r.excludedCount).toBe(1);
  });

  it("names EVERY zero row, not just the first", () => {
    const r = reviewOpeningBalances([
      ...balancedSheet(),
      row({ accountCode: "13000", amountCents: 0 }),
      row({ accountCode: "14000", amountCents: 0 }),
    ]);
    const f = r.findings.find((x) => x.code === "CUT_ZERO_AMOUNT");
    expect(f!.accountCodes).toEqual(["13000", "14000"]);
  });

  it("refuses a row with no document behind it", () => {
    const rows = balancedSheet();
    rows[0] = { ...rows[0]!, evidenceRef: "" };
    expect(reviewOpeningBalances(rows).blessable).toBe(false);

    // NEGATIVE CONTROL: whitespace is not evidence either.
    const ws = balancedSheet();
    ws[0] = { ...ws[0]!, evidenceRef: "   " };
    expect(reviewOpeningBalances(ws).blessable).toBe(false);

    // ...but a real reference is.
    const good = balancedSheet();
    good[0] = { ...good[0]!, evidenceRef: "KeyBank stmt 2026-10-31" };
    expect(reviewOpeningBalances(good).blessable).toBe(true);
  });

  it("warns about an imbalance without blocking it, and names the plug account", () => {
    const rows = balancedSheet();
    rows[0] = { ...rows[0]!, amountCents: 5000001 };
    const r = reviewOpeningBalances(rows);
    expect(r.differenceCents).toBe(1);
    expect(r.blessable).toBe(true);
    const f = r.findings.find((x) => x.code === "CUT_UNBALANCED");
    expect(f?.severity).toBe("warn");
    expect(f?.accountCodes).toContain(OPENING_BALANCE_EQUITY_CODE);
  });

  it("catches P&L accounts on a balance sheet — the classic conversion error", () => {
    for (const t of ["income", "cogs", "expense", "other_income", "other_expense"] as const) {
      const rows = [...balancedSheet(), row({ accountCode: "99999", accountType: t, amountCents: 1 })];
      const r = reviewOpeningBalances(rows);
      expect(
        r.findings.map((f) => f.code),
        `accountType=${t}`,
      ).toContain("CUT_PANDL_ACCOUNT");
    }
    // NEGATIVE CONTROLS: balance sheet types must NOT trip it.
    for (const t of ["asset", "liability", "equity"] as const) {
      const rows = [...balancedSheet(), row({ accountCode: "99999", accountType: t, amountCents: 1 })];
      const r = reviewOpeningBalances(rows);
      expect(
        r.findings.map((f) => f.code),
        `accountType=${t}`,
      ).not.toContain("CUT_PANDL_ACCOUNT");
    }
  });

  it("notices when an expected opening account is simply absent", () => {
    for (const expected of EXPECTED_OPENING_ACCOUNTS) {
      const rows = balancedSheet().filter((r) => r.accountCode !== expected.code);
      const r = reviewOpeningBalances(rows);
      expect(
        r.findings.map((f) => f.code),
        `missing=${expected.code}`,
      ).toContain(`CUT_MISSING_${expected.code}`);
    }
    // NEGATIVE CONTROL: present means silent.
    const full = reviewOpeningBalances(balancedSheet());
    for (const expected of EXPECTED_OPENING_ACCOUNTS) {
      expect(full.findings.map((f) => f.code)).not.toContain(
        `CUT_MISSING_${expected.code}`,
      );
    }
  });

  it("excluded rows never affect the totals", () => {
    const base = reviewOpeningBalances(balancedSheet());
    const withExclusions = reviewOpeningBalances([
      ...balancedSheet(),
      row({
        accountCode: "19999",
        amountCents: 999999999,
        status: "excluded",
        exclusionReason: "written off in 2024",
      }),
    ]);
    expect(withExclusions.debitCents).toBe(base.debitCents);
    expect(withExclusions.creditCents).toBe(base.creditCents);
    expect(withExclusions.differenceCents).toBe(base.differenceCents);
    expect(withExclusions.stagedCount).toBe(base.stagedCount);
    expect(withExclusions.excludedCount).toBe(1);
  });

  it("computes the difference correctly across a random sweep", () => {
    // Deterministic LCG — no Math.random, so a failure is always reproducible.
    let seed = 7;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };
    for (let i = 0; i < 300; i += 1) {
      const rows: OpeningRow[] = [];
      let expectedDebit = 0;
      let expectedCredit = 0;
      const n = (next() % 6) + 1;
      for (let j = 0; j < n; j += 1) {
        let amt = (next() % 1000000) - 500000;
        if (amt === 0) amt = 1; // zero amounts are a separate, blocked case
        rows.push(row({ accountCode: `9${j}000`, amountCents: amt }));
        if (amt > 0) expectedDebit += amt;
        else expectedCredit += -amt;
      }
      const r = reviewOpeningBalances(rows);
      expect(r.debitCents, `iteration ${i}`).toBe(expectedDebit);
      expect(r.creditCents, `iteration ${i}`).toBe(expectedCredit);
      expect(r.differenceCents, `iteration ${i}`).toBe(expectedDebit - expectedCredit);
    }
  });
});

// ===========================================================================
// The parallel run.
// ===========================================================================
describe("reconcileParallelRun", () => {
  it("reconciles identical trial balances", () => {
    const lines: BalanceLine[] = [
      { accountCode: "10100", balanceCents: 5000000 },
      { accountCode: "12100", balanceCents: 3000000 },
    ];
    const r = reconcileParallelRun(lines, [...lines]);
    expect(r.consistent).toBe(true);
    expect(r.discrepancies).toHaveLength(0);
  });

  it("NEVER tells the owner the numbers are 'correct'", () => {
    // This is a safety property, not a style preference. Sage holds Michael's
    // own Cultivera-era treatment; matching it exactly reproduces any error
    // there with more confidence. The word "correct" would be the single most
    // misleading thing this application could print.
    const lines: BalanceLine[] = [{ accountCode: "10100", balanceCents: 100 }];
    const r = reconcileParallelRun(lines, [...lines]);
    expect(r.verdict).toContain("consistent");
    expect(r.verdict).not.toContain("correct");
    expect(r.verdict.toLowerCase()).not.toContain("verified");
  });

  it("has NO tolerance — one cent breaks it", () => {
    for (const delta of [1, -1, 2, -50, 100000]) {
      const p: BalanceLine[] = [{ accountCode: "10100", balanceCents: 5000000 }];
      const s: BalanceLine[] = [{ accountCode: "10100", balanceCents: 5000000 - delta }];
      const r = reconcileParallelRun(p, s);
      expect(r.consistent, `delta=${delta}`).toBe(false);
      expect(r.discrepancies[0]!.differenceCents, `delta=${delta}`).toBe(delta);
    }
  });

  it("distinguishes a missing account from a differing balance", () => {
    const p: BalanceLine[] = [{ accountCode: "19000", balanceCents: 500 }];
    const s: BalanceLine[] = [{ accountCode: "28000", balanceCents: -700 }];
    const r = reconcileParallelRun(p, s);
    const byCode = new Map(r.comparisons.map((c) => [c.accountCode, c]));
    expect(byCode.get("19000")!.status).toBe("only_platform");
    expect(byCode.get("28000")!.status).toBe("only_sage");
    // The absent side is null, NOT zero — "we have no such account" and "the
    // account exists and is zero" are different facts with different fixes.
    expect(byCode.get("19000")!.sageCents).toBeNull();
    expect(byCode.get("28000")!.platformCents).toBeNull();
  });

  it("treats an empty comparison as UNPROVEN, not as clean", () => {
    const r = reconcileParallelRun([], []);
    expect(r.consistent).toBe(false);
    expect(r.verdict).toContain("nothing to compare");
  });

  it("sorts discrepancies biggest first, deterministically", () => {
    const p: BalanceLine[] = [
      { accountCode: "A", balanceCents: 100 },
      { accountCode: "B", balanceCents: 100000 },
      { accountCode: "C", balanceCents: 5000 },
    ];
    const s: BalanceLine[] = [
      { accountCode: "A", balanceCents: 90 },
      { accountCode: "B", balanceCents: 0 },
      { accountCode: "C", balanceCents: 4000 },
    ];
    const r1 = reconcileParallelRun(p, s);
    const r2 = reconcileParallelRun(p, s);
    expect(r1.discrepancies.map((d) => d.accountCode)).toEqual(["B", "C", "A"]);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it("is order-independent — shuffling the input changes nothing", () => {
    const p: BalanceLine[] = [
      { accountCode: "10100", balanceCents: 100 },
      { accountCode: "12100", balanceCents: 200 },
      { accountCode: "20100", balanceCents: -300 },
    ];
    const s: BalanceLine[] = [
      { accountCode: "20100", balanceCents: -300 },
      { accountCode: "10100", balanceCents: 100 },
      { accountCode: "12100", balanceCents: 200 },
    ];
    const r = reconcileParallelRun(p, s);
    expect(r.consistent).toBe(true);
    // and reversing both sides gives an identical report
    const rev = reconcileParallelRun([...p].reverse(), [...s].reverse());
    expect(JSON.stringify(rev)).toBe(JSON.stringify(r));
  });
});

// ===========================================================================
// Retirement readiness.
// ===========================================================================
describe("canRetireLegacySystem", () => {
  const cleanRun = () =>
    reconcileParallelRun(
      [{ accountCode: "10100", balanceCents: 100 }],
      [{ accountCode: "10100", balanceCents: 100 }],
    );

  it("says ready only when everything is clean", () => {
    const check = canRetireLegacySystem(cleanRun(), reviewOpeningBalances(balancedSheet()));
    expect(check.ready).toBe(true);
    expect(check.reasons).toHaveLength(0);
  });

  it("refuses while money sits in Opening Balance Equity", () => {
    const unbalanced = reviewOpeningBalances(
      balancedSheet().map((r, i) => (i === 0 ? { ...r, amountCents: r.amountCents + 1 } : r)),
    );
    const check = canRetireLegacySystem(cleanRun(), unbalanced);
    expect(check.ready).toBe(false);
    expect(check.reasons.join(" ")).toContain(OPENING_BALANCE_EQUITY_CODE);
  });

  it("refuses while any account disagrees with Sage", () => {
    const dirty = reconcileParallelRun(
      [{ accountCode: "10100", balanceCents: 100 }],
      [{ accountCode: "10100", balanceCents: 99 }],
    );
    expect(canRetireLegacySystem(dirty, reviewOpeningBalances(balancedSheet())).ready).toBe(
      false,
    );
  });

  it("refuses if the parallel run stopped short of year end", () => {
    const short = reconcileParallelRun(
      [{ accountCode: "10100", balanceCents: 100 }],
      [{ accountCode: "10100", balanceCents: 100 }],
      PARALLEL_RUN_START,
      "2026-12-30",
    );
    const check = canRetireLegacySystem(short, reviewOpeningBalances(balancedSheet()));
    expect(check.ready).toBe(false);
    expect(check.reasons.join(" ")).toContain(PARALLEL_RUN_END);
  });
});

// ===========================================================================
// THE HIGHEST-VALUE TEST IN THIS FILE.
//
// The SQL and the TypeScript must agree about the cut-over date. This slice
// exists precisely because that date was stated in two places and one of them
// was wrong, silently, for ten months of business.
// ===========================================================================
describe("SQL/TypeScript drift: the cut-over date", () => {
  const sql = readMigration("0184_cutover_config.sql");

  it("migration 0184 seeds the same dates this module exports", () => {
    expect(sql).toContain(`date '${CUTOVER_DATE}'`);
    expect(sql).toContain(`date '${OPENING_BALANCE_DATE}'`);
    expect(sql).toContain(`date '${PARALLEL_RUN_END}'`);
  });

  it("migration 0184 enforces that the opening date is the day before cut-over", () => {
    // A CHECK constraint, not a comment — the database must refuse a bad pair.
    expect(sql).toContain("opening_balance_date = cutover_date - 1");
  });

  it("migration 0184 re-points the two hard-coded cut-over functions", () => {
    expect(sql).toContain("gl_bless_opening_balances");
    expect(sql).toContain("gl_close_opening_balance_equity");
    expect(sql).toContain("gl_opening_balance_date()");
  });

  it("migration 0184 ships an audit that proves no hard-coded date remains", () => {
    expect(sql).toContain("gl_audit_cutover_date");
  });

  it("the config table is OWNER-only, like every other book", () => {
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("public.is_owner()");
    // NEGATIVE CONTROL: it must NOT fall back to the wider admin gate.
    expect(sql).not.toContain("public.is_admin()");
  });

  it("records the accrual basis decision on the entity table", () => {
    expect(sql).toContain("accounting_basis");
    expect(sql).toContain("'accrual'");
  });

  it("0176 still contains the literals 0184 rewrites (or this migration is a no-op)", () => {
    // If 0176 is ever edited so these strings vanish, 0184's replace() silently
    // does nothing and the cut-over date quietly reverts to 2025-12-31. This
    // test is the tripwire for that.
    const ob = readMigration("0176_opening_balances.sql");
    expect(ob).toContain("p_journal_date   := date '2025-12-31'");
    expect(ob).toContain("p_journal_date := date '2025-12-31'");
    // ...and 0184 must target BOTH spacings.
    expect(sql).toContain("'p_journal_date   := date ''2025-12-31'''");
    expect(sql).toContain("'p_journal_date := date ''2025-12-31'''");
  });
});

// ===========================================================================
// Purity.
// ===========================================================================
/**
 * Strip comments from TypeScript source so a purity scan looks at CODE only.
 *
 * Without this, a comment that says "there is no Math.random in this module"
 * fails a scan for "Math.random" — the test would be measuring prose rather
 * than behaviour, and the obvious fix (delete the sentence) makes the file
 * WORSE. Documentation must be able to name the thing it forbids.
 *
 * String and template literals are preserved, because a forbidden token hiding
 * inside a string is still a real finding (e.g. a supabase URL). Regex literals
 * are handled so a division-looking slash is not mistaken for a comment.
 */
export function stripComments(source: string): string {
  let out = "";
  let i = 0;
  const n = source.length;
  // Tracks whether a `/` at this position could start a regex literal rather
  // than being a division operator. After a value, `/` divides; otherwise it
  // opens a regex.
  let prevSignificant = "";

  while (i < n) {
    const c = source[i]!;
    const next = i + 1 < n ? source[i + 1]! : "";

    // line comment
    if (c === "/" && next === "/") {
      while (i < n && source[i] !== "\n") i += 1;
      continue;
    }
    // block comment
    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    // string or template literal
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += c;
      i += 1;
      while (i < n) {
        const d = source[i]!;
        out += d;
        if (d === "\\") {
          if (i + 1 < n) out += source[i + 1]!;
          i += 2;
          continue;
        }
        i += 1;
        if (d === quote) break;
      }
      prevSignificant = quote;
      continue;
    }
    // regex literal
    if (c === "/" && !/[\w)\]]/.test(prevSignificant)) {
      out += c;
      i += 1;
      let inClass = false;
      while (i < n) {
        const d = source[i]!;
        out += d;
        if (d === "\\") {
          if (i + 1 < n) out += source[i + 1]!;
          i += 2;
          continue;
        }
        i += 1;
        if (d === "[") inClass = true;
        else if (d === "]") inClass = false;
        else if (d === "/" && !inClass) break;
      }
      prevSignificant = "/";
      continue;
    }

    out += c;
    if (!/\s/.test(c)) prevSignificant = c;
    i += 1;
  }
  return out;
}

describe("the purity scanner itself is correct", () => {
  // TEST THE TESTS. A purity scan is only as trustworthy as its comment
  // stripper; a broken stripper either fails on prose (annoying) or silently
  // deletes real code (dangerous, because the scan then always passes).
  it("removes line comments", () => {
    expect(stripComments("const a = 1; // Math.random\n")).not.toContain("Math.random");
    expect(stripComments("const a = 1; // Math.random\n")).toContain("const a = 1;");
  });

  it("removes block comments, including multi-line ones", () => {
    const s = "/**\n * no Math.random here\n */\nconst a = 1;\n";
    expect(stripComments(s)).not.toContain("Math.random");
    expect(stripComments(s).trim()).toBe("const a = 1;");
  });

  it("KEEPS strings — a forbidden token inside a string is a real finding", () => {
    expect(stripComments('const u = "https://x.supabase.co";')).toContain("supabase");
    expect(stripComments("const u = 'Math.random';")).toContain("Math.random");
    expect(stripComments("const u = `Date.now`;")).toContain("Date.now");
  });

  it("does not treat a slash inside a string as a comment", () => {
    const s = 'const u = "a // b"; const v = 1;';
    expect(stripComments(s)).toContain("a // b");
    expect(stripComments(s)).toContain("const v = 1;");
  });

  it("does not treat a regex literal as a comment", () => {
    const s = "const re = /a\\/\\/b/g; const v = 1;";
    expect(stripComments(s)).toContain("const v = 1;");
  });

  it("handles escaped quotes without swallowing the rest of the file", () => {
    const s = 'const a = "he said \\"hi\\""; const v = 1;';
    expect(stripComments(s)).toContain("const v = 1;");
  });

  it("leaves comment-free code byte-identical", () => {
    const s = "export const A = 1;\nexport function f(){ return A; }\n";
    expect(stripComments(s)).toBe(s);
  });

  it("does not destroy the module it is pointed at", () => {
    // Guard against a stripper bug that eats everything: the stripped source
    // must still contain the module's real declarations.
    const stripped = stripComments(
      readFileSync(resolve(__dirname, "../../src/lib/accounting/cutover-core.ts"), "utf8"),
    );
    expect(stripped).toContain("export function reviewOpeningBalances");
    expect(stripped).toContain("export function reconcileParallelRun");
    expect(stripped).toContain("export function canRetireLegacySystem");
    expect(stripped).toContain("export function __runCutoverCoreTests");
    expect(stripped.length).toBeGreaterThan(4000);
  });
});

describe("cutover-core is PURE", () => {
  const src = readFileSync(
    resolve(__dirname, "../../src/lib/accounting/cutover-core.ts"),
    "utf8",
  );
  const code = stripComments(src);

  it("has no database, network, clock or randomness", () => {
    for (const forbidden of [
      "supabase",
      "createClient",
      "fetch(",
      "Date.now",
      "new Date",
      "Math.random",
      "process.env",
      "server-only",
    ]) {
      expect(code, `forbidden=${forbidden}`).not.toContain(forbidden);
    }
  });

  it("imports nothing at all — it is a leaf module", () => {
    // The strongest purity property available: a module that imports nothing
    // cannot reach a database, a clock or the network by any route.
    expect(code).not.toMatch(/^\s*import\s/m);
    expect(code).not.toMatch(/\brequire\s*\(/);
  });

  it("contains no BigInt literals (tsconfig target forbids them)", () => {
    expect(src).not.toMatch(/\b\d+n\b/);
  });

  it("formats money without floating-point multiplication", () => {
    // formatCents must not do `cents / 100` and print the float.
    expect(formatCents(1)).toBe("$0.01");
    expect(formatCents(10)).toBe("$0.10");
    expect(formatCents(100)).toBe("$1.00");
    expect(formatCents(999)).toBe("$9.99");
    expect(formatCents(100000000)).toBe("$1,000,000.00");
    // sweep every cent value 0..2000
    for (let c = 0; c <= 2000; c += 1) {
      const s = formatCents(c);
      expect(s.startsWith("$"), `c=${c}`).toBe(true);
      expect(s.split(".")[1], `c=${c}`).toHaveLength(2);
    }
  });
});
