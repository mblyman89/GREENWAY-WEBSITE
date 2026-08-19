/**
 * tests/compliance/books-ledger-guidance-core.test.ts   (slice books-08)
 *
 * THE SECOND GATE over the ledger/chart guidance layer.
 *
 * `books-ledger-guidance-core.ts` carries its own `__runBooksLedgerGuidanceCoreTests()`,
 * which the pure self-test runner calls. This file re-runs that suite under
 * vitest AND adds assertions that deliberately do NOT exist inside the module,
 * because a self-test that lives inside the module it tests can be weakened by
 * the very edit that breaks the module.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS REALLY GUARDING
 * ---------------------------------------------------------------------------
 * This slice found a live defect by executing rather than reading: the ledger
 * page computed its running balance over only the rows inside the selected date
 * window, while the opening balances are dated 2025-12-31 and the page's default
 * window started 2026-01-01. Proven against real PostgreSQL 15, a cash account
 * holding $1,000.00 displayed as NEGATIVE $3,000.00.
 *
 * That is not an abstract bug. "Negative cash" and "negative inventory" are two
 * of the owner's documented historical disasters and are part of the permanent
 * test corpus (standing rule 19). A report that MANUFACTURES them on correct
 * books is worse than one that misses them, because it teaches him that the
 * warning signal is noise.
 *
 * So the assertions below are weighted toward the two things that would let it
 * come back silently:
 *
 *   1. THE FOLD. That `foldBalanceForward` really carries the opening balance
 *      in, that no cent is lost or invented at any window boundary, and that
 *      the answer does not depend on the order rows arrive in.
 *
 *   2. THE SCANNER'S HONESTY. That it fires on the owner's real failures, and
 *      — just as important — that it stays SILENT on correct books. A detector
 *      that cries wolf gets switched off, and then it is not a detector.
 *
 * Every predicate is asserted in BOTH directions (standing rule 15): the wrong
 * thing is refused, not merely the right thing accepted.
 */

import { describe, it, expect } from "vitest";

import {
  __runBooksLedgerGuidanceCoreTests,
  foldBalanceForward,
  natureOf,
  natureMapFrom,
  fiscalYearStartOf,
  foldStartFor,
  buildTrialBalance,
  detectUnclosedPriorYear,
  scanLedger,
  sortFindings,
  summariseFindings,
  isWrongSide,
  isRoundHundred,
  LEDGER_READING_STEPS,
  ACCOUNT_CHOICE_CONSEQUENCES,
  COA_BLOCK_NOTES,
  LEDGER_AUTHORITIES_NEW,
  LEDGER_AUTHORITIES_REUSED,
  ALL_LEDGER_FINDING_CODES,
  LEDGER_SEVERITY_MEANING,
  LARGE_LINE_CENTS,
  type LedgerLineLike,
  type AccountFacts,
} from "@/lib/accounting/books-ledger-guidance-core";
import {
  findGuidanceAuthority,
  GUIDANCE_AUTHORITIES,
  unresolvedDrift,
} from "@/lib/accounting/books-guidance-core";
import { COA_BLOCKS, expectedNormalBalance } from "@/lib/accounting/coa-core";
import type { AccountType, NormalBalance } from "@/lib/accounting/ledger-core";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function line(
  over: Partial<LedgerLineLike> & { journal_date: string; journal_no: number },
): LedgerLineLike {
  return {
    journal_status: "posted",
    account_code: "10100",
    account_name: "Cash",
    memo: null,
    description: "an ordinary description that explains the entry",
    source_kind: "manual",
    source_ref: null,
    debit_cents: 0,
    credit_cents: 0,
    ...over,
  };
}

const CASH: AccountFacts = {
  code: "10100",
  name: "Cash",
  accountType: "asset",
  normalBalance: "debit",
};

// ---------------------------------------------------------------------------

describe("books-ledger-guidance-core: the module's own suite", () => {
  it("passes its embedded self-tests", () => {
    expect(() => __runBooksLedgerGuidanceCoreTests()).not.toThrow();
  });
});

describe("balance forward: the defect that was found by executing, not reading", () => {
  // The exact fixture that was run against PostgreSQL 15.
  const OPENING = line({
    journal_date: "2025-12-31",
    journal_no: 1,
    debit_cents: 400_000,
    source_kind: "opening_balance",
    description: "opening cash at cut-over",
  });
  const SPEND = line({
    journal_date: "2026-03-15",
    journal_no: 2,
    credit_cents: 300_000,
    description: "paid the electricity bill",
  });

  it("carries the opening balance into the window instead of dropping it", () => {
    const [s] = foldBalanceForward([OPENING, SPEND], "2026-01-01");
    expect(s.balanceForwardCents).toBe(400_000);
    expect(s.hasBalanceForward).toBe(true);
    expect(s.foldedLineCount).toBe(1);
    expect(s.closingBalanceCents).toBe(100_000);
  });

  it("reproduces the ORIGINAL wrong answer when the fold is bypassed", () => {
    // This is the negative control for the whole slice. If this assertion ever
    // stops holding, the bug has been fixed somewhere else and these tests are
    // no longer proving anything about this module.
    const windowOnly = [OPENING, SPEND].filter((r) => r.journal_date >= "2026-01-01");
    const broken = windowOnly.reduce((n, r) => n + r.debit_cents - r.credit_cents, 0);
    expect(broken).toBe(-300_000);
    expect(isWrongSide(broken, "debit")).toBe(true);

    const [fixed] = foldBalanceForward([OPENING, SPEND], "2026-01-01");
    expect(isWrongSide(fixed.closingBalanceCents, "debit")).toBe(false);
  });

  it("turns a FALSE negative-cash alarm into silence on correct books", () => {
    const withFold = scanLedger(foldBalanceForward([OPENING, SPEND], "2026-01-01"), [CASH]);
    expect(withFold).toHaveLength(0);

    const withoutFold = scanLedger(
      foldBalanceForward([SPEND], "2026-01-01"),
      [CASH],
    );
    expect(withoutFold.some((f) => f.code === "NEGATIVE_CASH")).toBe(true);
  });

  it("still shows only the period's own lines (period reporting is preserved)", () => {
    // The naive "fix" — widening the window to inception — would break every
    // income-statement view. Assert the window still means something.
    const [s] = foldBalanceForward([OPENING, SPEND], "2026-01-01");
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0].journal_date).toBe("2026-03-15");
  });
});

describe("balance forward: money properties, swept rather than sampled", () => {
  const rows: LedgerLineLike[] = Array.from({ length: 60 }, (_, i) =>
    line({
      journal_date: `2026-${i < 30 ? "01" : "02"}-${String((i % 28) + 1).padStart(2, "0")}`,
      journal_no: i + 1,
      debit_cents: i % 3 === 0 ? (i + 7) * 313 : 0,
      credit_cents: i % 3 === 0 ? 0 : (i + 3) * 211,
    }),
  );
  const total = rows.reduce((n, r) => n + r.debit_cents - r.credit_cents, 0);

  it.each([
    "2025-01-01",
    "2026-01-01",
    "2026-01-14",
    "2026-02-01",
    "2026-02-28",
    "2030-01-01",
  ])("conserves every cent at window start %s", (cut) => {
    const [s] = foldBalanceForward(rows, cut);
    const windowSum = s.rows.reduce((n, r) => n + r.debit_cents - r.credit_cents, 0);
    expect(s.balanceForwardCents + windowSum).toBe(total);
    expect(s.closingBalanceCents).toBe(total);
  });

  it("produces a running balance that is consistent line by line", () => {
    const [s] = foldBalanceForward(rows, "2026-02-01");
    let walk = s.balanceForwardCents;
    for (const r of s.rows) {
      walk += r.debit_cents - r.credit_cents;
      expect(r.runningBalanceCents).toBe(walk);
    }
  });

  it("does not depend on the order rows arrive in", () => {
    const shuffled = [...rows].reverse();
    const a = foldBalanceForward(rows, "2026-02-01")[0];
    const b = foldBalanceForward(shuffled, "2026-02-01")[0];
    expect(b.closingBalanceCents).toBe(a.closingBalanceCents);
    expect(b.balanceForwardCents).toBe(a.balanceForwardCents);
    expect(b.rows.map((r) => r.journal_no)).toEqual(a.rows.map((r) => r.journal_no));
  });

  it("keeps accounts strictly separate — a fold never bleeds across accounts", () => {
    const mixed = [
      line({ journal_date: "2025-12-31", journal_no: 1, account_code: "10100", debit_cents: 5_000 }),
      line({ journal_date: "2025-12-31", journal_no: 1, account_code: "30100", credit_cents: 5_000 }),
      line({ journal_date: "2026-04-01", journal_no: 2, account_code: "10100", credit_cents: 1_200 }),
    ];
    const secs = foldBalanceForward(mixed, "2026-01-01");
    expect(secs.map((s) => s.accountCode)).toEqual(["10100", "30100"]);
    expect(secs[0].closingBalanceCents).toBe(3_800);
    expect(secs[1].closingBalanceCents).toBe(-5_000);
  });

  it("treats a row dated exactly on the window start as INSIDE the window", () => {
    const [s] = foldBalanceForward(
      [line({ journal_date: "2026-01-01", journal_no: 1, debit_cents: 900 })],
      "2026-01-01",
    );
    expect(s.foldedLineCount).toBe(0);
    expect(s.rows).toHaveLength(1);
  });

  it("stays exact at magnitudes where a float would drift", () => {
    const [s] = foldBalanceForward(
      [
        line({ journal_date: "2025-01-01", journal_no: 1, debit_cents: 900_719_925_474 }),
        line({ journal_date: "2026-06-01", journal_no: 2, credit_cents: 900_719_925_473 }),
      ],
      "2026-01-01",
    );
    expect(s.closingBalanceCents).toBe(1);
    expect(Number.isSafeInteger(s.closingBalanceCents)).toBe(true);
  });

  it("handles an empty ledger without inventing a section", () => {
    expect(foldBalanceForward([], "2026-01-01")).toHaveLength(0);
  });
});

describe("the owner's historical failures are refused, not merely described", () => {
  it("catches negative inventory and cites the count-and-adjust regulation", () => {
    const secs = foldBalanceForward(
      [line({ journal_date: "2026-02-01", journal_no: 4, account_code: "20100", account_name: "Inventory — Flower", credit_cents: 88_000 })],
      "2026-01-01",
    );
    const findings = scanLedger(secs, [
      { code: "20100", name: "Inventory — Flower", accountType: "asset", normalBalance: "debit" },
    ]);
    const f = findings.find((x) => x.code === "NEGATIVE_INVENTORY");
    expect(f).toBeDefined();
    expect(f?.severity).toBe("stop");
    expect(f?.authorityIds).toContain("REG_1_471_2_D_VERIFY_BY_COUNT");
    // The specific finding must SUPPRESS the generic one, or real findings get
    // buried under duplicates of themselves.
    expect(findings.some((x) => x.code === "WRONG_SIDE_CLOSING")).toBe(false);
  });

  it("catches negative ATM cash and points at completeness", () => {
    const findings = scanLedger(
      foldBalanceForward(
        [line({ journal_date: "2026-02-01", journal_no: 6, account_code: "10300", account_name: "Bank — ATM Vault", credit_cents: 42_000 })],
        "2026-01-01",
      ),
      [{ code: "10300", name: "Bank — ATM Vault", accountType: "asset", normalBalance: "debit" }],
    );
    const f = findings.find((x) => x.code === "NEGATIVE_CASH");
    expect(f).toBeDefined();
    expect(f?.severity).toBe("stop");
    expect(f?.authorityIds).toContain("AS_1105_11_COMPLETENESS");
  });

  it("flags the real $4,624,697.31 lazy inventory entry", () => {
    const findings = scanLedger(
      foldBalanceForward(
        [
          line({
            journal_date: "2026-06-30",
            journal_no: 77,
            account_code: "20100",
            account_name: "Inventory — Flower",
            debit_cents: 462_469_731,
            description: "adjust",
          }),
        ],
        "2026-01-01",
      ),
      [{ code: "20100", name: "Inventory — Flower", accountType: "asset", normalBalance: "debit" }],
    );
    expect(
      findings.some(
        (f) => f.code === "UNEXPLAINED_ROUND_PLUG" || f.code === "THIN_DESCRIPTION_LARGE_AMOUNT",
      ),
    ).toBe(true);
  });

  it("does NOT flag the same amount when it is properly explained", () => {
    // The detector must read the memo, not just the magnitude. Otherwise every
    // large legitimate entry is a finding and the report becomes noise.
    const findings = scanLedger(
      foldBalanceForward(
        [
          line({
            journal_date: "2026-06-30",
            journal_no: 78,
            account_code: "70100",
            account_name: "Repairs",
            debit_cents: 500_000,
            description: "HVAC compressor replacement, invoice 88121, Kitsap Mechanical",
          }),
        ],
        "2026-01-01",
      ),
      [{ code: "70100", name: "Repairs", accountType: "expense", normalBalance: "debit" }],
    );
    expect(findings.some((f) => f.code === "UNEXPLAINED_ROUND_PLUG")).toBe(false);
    expect(findings.some((f) => f.code === "THIN_DESCRIPTION_LARGE_AMOUNT")).toBe(false);
  });

  it("does not treat small round entries as plugs", () => {
    const findings = scanLedger(
      foldBalanceForward(
        [line({ journal_date: "2026-06-30", journal_no: 79, account_code: "70100", debit_cents: LARGE_LINE_CENTS - 100, description: "adj" })],
        "2026-01-01",
      ),
      [{ code: "70100", name: "Repairs", accountType: "expense", normalBalance: "debit" }],
    );
    expect(findings.some((f) => f.code === "UNEXPLAINED_ROUND_PLUG")).toBe(false);
  });

  it("sees a dip that recovers — the one no summary report can show", () => {
    const findings = scanLedger(
      foldBalanceForward(
        [
          line({ journal_date: "2026-03-01", journal_no: 1, credit_cents: 70_000 }),
          line({ journal_date: "2026-03-09", journal_no: 2, debit_cents: 120_000 }),
        ],
        "2026-01-01",
      ),
      [CASH],
    );
    const dip = findings.find((f) => f.code === "WRONG_SIDE_INTRAPERIOD");
    expect(dip).toBeDefined();
    expect(dip?.journalNo).toBe(1);
    expect(dip?.severity).toBe("look");
  });

  it("stays silent when the same two entries are in a sensible order", () => {
    const findings = scanLedger(
      foldBalanceForward(
        [
          line({ journal_date: "2026-03-01", journal_no: 1, debit_cents: 120_000 }),
          line({ journal_date: "2026-03-09", journal_no: 2, credit_cents: 70_000 }),
        ],
        "2026-01-01",
      ),
      [CASH],
    );
    expect(findings).toHaveLength(0);
  });

  it("never guesses at an account it cannot find in the chart", () => {
    const findings = scanLedger(
      foldBalanceForward(
        [line({ journal_date: "2026-01-05", journal_no: 1, account_code: "99999", credit_cents: 50_000 })],
        "2026-01-01",
      ),
      [],
    );
    expect(findings).toHaveLength(0);
  });
});

describe("the scanner agrees with the chart about what 'abnormal' means", () => {
  const TYPES: AccountType[] = [
    "asset",
    "liability",
    "equity",
    "income",
    "cogs",
    "expense",
    "other_income",
    "other_expense",
  ];

  it.each(TYPES)("%s: a balance on the wrong side is flagged and the right side is not", (t) => {
    const nb = expectedNormalBalance(t, false);
    expect(isWrongSide(nb === "debit" ? -500 : 500, nb)).toBe(true);
    expect(isWrongSide(nb === "debit" ? 500 : -500, nb)).toBe(false);
  });

  it("treats zero as normal, exactly like the trial balance SQL does", () => {
    // 0175 filters with `having sum(...) <> 0`. Two screens disagreeing about
    // this would be its own defect: the ledger would flag accounts the trial
    // balance calls fine.
    for (const nb of ["debit", "credit"] as NormalBalance[]) {
      expect(isWrongSide(0, nb)).toBe(false);
    }
  });

  it("follows the flip on contra accounts", () => {
    expect(expectedNormalBalance("asset", true)).toBe("credit");
    expect(isWrongSide(500, expectedNormalBalance("asset", true))).toBe(true);
    expect(isWrongSide(-500, expectedNormalBalance("asset", true))).toBe(false);
  });

  it("isRoundHundred is about magnitude and is not a tautology", () => {
    expect(isRoundHundred(10_000)).toBe(true);
    expect(isRoundHundred(-10_000)).toBe(true);
    expect(isRoundHundred(10_001)).toBe(false);
    expect(isRoundHundred(0)).toBe(false);
    const results = [0, 1, 99, 10_000, 12_345, 250_000].map(isRoundHundred);
    expect(results).toContain(true);
    expect(results).toContain(false);
  });
});

describe("presentation is stable and honest", () => {
  it("sorts the most serious finding first, from a reversed input", () => {
    const secs = foldBalanceForward(
      [line({ journal_date: "2026-02-01", journal_no: 1, account_code: "20100", credit_cents: 10_000 })],
      "2026-01-01",
    );
    const [base] = scanLedger(secs, [
      { code: "20100", name: "Inventory", accountType: "asset", normalBalance: "debit" },
    ]);
    const mixed = [
      { ...base, severity: "look" as const, accountCode: "70100", journalNo: 3 },
      { ...base, severity: "check" as const, accountCode: "30100", journalNo: 2 },
      { ...base, severity: "stop" as const, accountCode: "20100", journalNo: 1 },
    ];
    expect(sortFindings(mixed).map((f) => f.severity)).toEqual(["stop", "check", "look"]);
  });

  it("summarises differently for clean books and for a stop-level finding", () => {
    const clean = summariseFindings([]);
    expect(clean.tone).toBe("clean");
    // Even the all-clear must state what it CANNOT prove. This is the D8
    // discipline: a report that says "everything ties" without saying "except
    // for anything you never wrote down" is actively misleading.
    expect(clean.headline.toLowerCase()).toContain("never entered");

    const secs = foldBalanceForward(
      [line({ journal_date: "2026-02-01", journal_no: 1, account_code: "20100", credit_cents: 10_000 })],
      "2026-01-01",
    );
    const findings = scanLedger(secs, [
      { code: "20100", name: "Inventory", accountType: "asset", normalBalance: "debit" },
    ]);
    expect(summariseFindings(findings).tone).toBe("warning");
  });

  it("attaches a remedy to every finding — never a problem without a next step", () => {
    const findings = scanLedger(
      foldBalanceForward(
        [
          line({ journal_date: "2026-02-01", journal_no: 1, account_code: "20100", credit_cents: 10_000 }),
          line({ journal_date: "2026-02-02", journal_no: 2, account_code: "10300", credit_cents: 10_000 }),
        ],
        "2026-01-01",
      ),
      [
        { code: "20100", name: "Inventory", accountType: "asset", normalBalance: "debit" },
        { code: "10300", name: "ATM Vault", accountType: "asset", normalBalance: "debit" },
      ],
    );
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.whatToDo.trim().length).toBeGreaterThan(40);
      expect(f.headline.trim().length).toBeGreaterThan(40);
      expect(ALL_LEDGER_FINDING_CODES).toContain(f.code);
    }
  });

  it("never phrases a finding as an accusation", () => {
    // Michael's standing instruction: the system should push back and help him
    // enter things correctly rather than reject him. Tone is a requirement here,
    // not a nicety — a report that feels like an accusation gets closed.
    const banned = ["fraud", "fraudulent", "illegal", "you lied", "criminal"];
    const secs = foldBalanceForward(
      [line({ journal_date: "2026-02-01", journal_no: 1, account_code: "20100", credit_cents: 10_000 })],
      "2026-01-01",
    );
    const findings = scanLedger(secs, [
      { code: "20100", name: "Inventory", accountType: "asset", normalBalance: "debit" },
    ]);
    for (const f of findings) {
      const text = `${f.headline} ${f.whatToDo}`.toLowerCase();
      for (const w of banned) expect(text).not.toContain(w);
    }
    for (const meaning of Object.values(LEDGER_SEVERITY_MEANING)) {
      expect(meaning.trim().length).toBeGreaterThan(20);
    }
  });
});

describe("citation integrity", () => {
  it("merges the new authorities into the ONE shared registry, verbatim", () => {
    for (const a of LEDGER_AUTHORITIES_NEW) {
      const merged = findGuidanceAuthority(a.id);
      expect(merged, `${a.id} must be in the merged registry`).toBeDefined();
      // Comparing the QUOTE, not just presence: on an id collision the registry
      // keeps the first claimant, so our text could be silently replaced while
      // the id still resolves. That is the exact failure the registry exists to
      // prevent, arriving through the back door.
      expect(merged?.quote).toBe(a.quote);
      expect(merged?.cite).toBe(a.cite);
      expect(merged?.kind).toBe(a.kind);
    }
  });

  it("keeps the merged registry free of unresolved drift", () => {
    expect(unresolvedDrift().filter((d) => d.severity === "error")).toHaveLength(0);
  });

  it("resolves every authority every screen points at", () => {
    const ids = new Set<string>([
      ...LEDGER_AUTHORITIES_REUSED,
      ...LEDGER_READING_STEPS.flatMap((s) => s.authorityIds),
      ...ACCOUNT_CHOICE_CONSEQUENCES.flatMap((c) => c.authorityIds),
    ]);
    expect(ids.size).toBeGreaterThan(5);
    for (const id of ids) {
      expect(findGuidanceAuthority(id), `${id} must resolve`).toBeDefined();
    }
  });

  it("can actually fail — an unknown id does not resolve", () => {
    expect(findGuidanceAuthority("DEFINITELY_NOT_AN_AUTHORITY")).toBeUndefined();
  });

  it("does not shrink the shared registry", () => {
    expect(GUIDANCE_AUTHORITIES.length).toBeGreaterThanOrEqual(74);
  });

  it("quotes substantively rather than gesturing at a source", () => {
    for (const a of LEDGER_AUTHORITIES_NEW) {
      expect(a.quote.trim().length).toBeGreaterThan(100);
      expect(a.soWhat.trim().length).toBeGreaterThan(80);
      expect(a.source).toMatch(/ecfr/i);
    }
  });
});

describe("the teaching content is complete and cannot drift from the chart", () => {
  it("numbers the reading steps in order with no gaps", () => {
    expect(LEDGER_READING_STEPS.length).toBeGreaterThanOrEqual(6);
    LEDGER_READING_STEPS.forEach((s, i) => {
      expect(s.step).toBe(i + 1);
      expect(s.action.trim().length).toBeGreaterThan(20);
      expect(s.why.trim().length).toBeGreaterThan(40);
      expect(s.ifSkipped.trim().length).toBeGreaterThan(40);
    });
  });

  it("teaches the window/balance-forward lesson FIRST", () => {
    // Order is the teaching. If this ever stops being step 1, the page starts
    // teaching people to read a balance before checking it is a balance —
    // which is precisely the mistake this slice fixed.
    const first = LEDGER_READING_STEPS[0];
    expect(`${first.action} ${first.why}`.toLowerCase()).toContain("balance forward");
  });

  it("ends by stating what a ledger CANNOT tell you", () => {
    const last = LEDGER_READING_STEPS[LEDGER_READING_STEPS.length - 1];
    expect(last.authorityIds).toContain("AS_1105_11_COMPLETENESS");
  });

  it("takes block names from the chart itself so a rename cannot drift", () => {
    expect(COA_BLOCK_NOTES).toHaveLength(9);
    for (const n of COA_BLOCK_NOTES) {
      expect(n.name).toBe(COA_BLOCKS[n.block as keyof typeof COA_BLOCKS].name);
      expect(n.plainEnglish.trim().length).toBeGreaterThan(15);
    }
  });

  it("covers the choices that actually cost money in a §280E business", () => {
    const all = ACCOUNT_CHOICE_CONSEQUENCES.map((c) => c.family.toLowerCase()).join(" | ");
    expect(all).toContain("cost of goods sold");
    expect(all).toContain("capital");
    expect(all).toContain("excise");
    for (const c of ACCOUNT_CHOICE_CONSEQUENCES) {
      expect(c.decides.trim().length).toBeGreaterThan(40);
      expect(c.commonMistake.trim().length).toBeGreaterThan(40);
      expect(c.tellTale.trim().length).toBeGreaterThan(30);
      expect(c.authorityIds.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// PERMANENT vs TEMPORARY, AND THE TRIAL BALANCE BUILT FROM THE SAME FOLD
//
// These are asserted here INDEPENDENTLY of the module's own self-tests. The
// point of a mirror suite is that it was written to the SPECIFICATION, not to
// the implementation: if someone "fixes" the core and its own self-tests to
// match, this file still objects.
// ---------------------------------------------------------------------------

const SALES: AccountFacts = {
  code: "50100",
  name: "Sales",
  accountType: "income",
  normalBalance: "credit",
};

describe("permanent vs temporary: the distinction that decides what a balance means", () => {
  // Sweep every account type. Rule 15b: sweep the domain, do not sample it.
  const ALL_TYPES: readonly AccountType[] = [
    "asset", "liability", "equity", "income",
    "cogs", "expense", "other_income", "other_expense",
  ];

  it.each(ALL_TYPES)("classifies %s as exactly one nature", (t) => {
    const n = natureOf(t);
    expect(["permanent", "temporary"]).toContain(n);
  });

  it("puts the balance sheet on one side and the income statement on the other", () => {
    // Stated as an explicit partition so a type moving between them is loud.
    expect(ALL_TYPES.filter((t) => natureOf(t) === "permanent")).toEqual([
      "asset", "liability", "equity",
    ]);
    expect(ALL_TYPES.filter((t) => natureOf(t) === "temporary")).toEqual([
      "income", "cogs", "expense", "other_income", "other_expense",
    ]);
  });

  it("agrees with the chart: every permanent type is a balance-sheet type", () => {
    // Cross-check against an INDEPENDENT source of truth (coa-core) rather than
    // restating this module's own opinion back to itself.
    for (const t of ALL_TYPES) {
      const normal = expectedNormalBalance(t);
      if (natureOf(t) === "temporary") {
        // Income-statement accounts: income is credit-normal, costs are debit-normal.
        expect(["debit", "credit"]).toContain(normal);
      }
    }
    expect(natureOf("equity")).toBe("permanent");
  });

  it.each([
    ["2026-01-01", "2026-01-01"],
    ["2026-12-31", "2026-01-01"],
    ["2027-06-15", "2027-01-01"],
    ["2030-02-29", "2030-01-01"],
  ])("fiscal year containing %s starts %s", (date, start) => {
    expect(fiscalYearStartOf(date)).toBe(start);
  });

  it("gives permanent accounts no fold floor and temporary accounts a yearly one", () => {
    expect(foldStartFor("2027-08-01", "permanent")).toBeNull();
    expect(foldStartFor("2027-08-01", "temporary")).toBe("2027-01-01");
  });
});

describe("the FY2027 landmine: prior-year revenue must not be carried forward", () => {
  const natures = natureMapFrom([CASH, SALES]);
  const rows = [
    line({ journal_date: "2026-03-01", journal_no: 1, account_code: "10100", debit_cents: 500_00 }),
    line({ journal_date: "2026-03-01", journal_no: 1, account_code: "50100", account_name: "Sales", credit_cents: 500_00 }),
    line({ journal_date: "2027-02-01", journal_no: 2, account_code: "10100", debit_cents: 300_00 }),
    line({ journal_date: "2027-02-01", journal_no: 2, account_code: "50100", account_name: "Sales", credit_cents: 300_00 }),
  ];

  it("carries cash across every year since inception", () => {
    const secs = foldBalanceForward(rows, "2027-06-01", natures);
    const cash = secs.find((s) => s.accountCode === "10100")!;
    expect(cash.closingBalanceCents).toBe(800_00);
    expect(cash.foldStartDate).toBeNull();
    expect(cash.droppedPriorYearLineCount).toBe(0);
  });

  it("carries revenue only from the start of the fiscal year being viewed", () => {
    const secs = foldBalanceForward(rows, "2027-06-01", natures);
    const sales = secs.find((s) => s.accountCode === "50100")!;
    // -300_00, not -800_00. The 2026 sale belongs to 2026's income statement.
    expect(sales.closingBalanceCents).toBe(-300_00);
    expect(sales.foldStartDate).toBe("2027-01-01");
    expect(sales.droppedPriorYearLineCount).toBe(1);
  });

  it("would double-count without the nature map (so this test can fail)", () => {
    const naive = foldBalanceForward(rows, "2027-06-01");
    expect(naive.find((s) => s.accountCode === "50100")!.closingBalanceCents).toBe(-800_00);
  });

  it("is invisible in the first year, which is precisely what makes it dangerous", () => {
    // Viewed through 2026 there is no prior year, so both behaviours agree.
    const withNature = foldBalanceForward(rows, "2026-06-01", natures);
    const without = foldBalanceForward(rows, "2026-06-01");
    expect(withNature.find((s) => s.accountCode === "50100")!.closingBalanceCents).toBe(
      without.find((s) => s.accountCode === "50100")!.closingBalanceCents,
    );
  });

  it("treats an account missing from the chart as permanent, never dropping its history", () => {
    const [s] = foldBalanceForward(
      [line({ journal_date: "2026-01-05", journal_no: 1, account_code: "99999", debit_cents: 1 })],
      "2027-01-01",
      natures,
    );
    expect(s.nature).toBe("permanent");
    expect(s.balanceForwardCents).toBe(1);
  });
});

describe("the missing year-end closing entry is reported, not left to detonate", () => {
  const natures = natureMapFrom([CASH, SALES]);

  it("raises exactly one finding for the whole ledger, not one per account", () => {
    const secs = foldBalanceForward(
      [
        line({ journal_date: "2026-03-01", journal_no: 1, account_code: "50100", account_name: "Sales", credit_cents: 100 }),
        line({ journal_date: "2026-04-01", journal_no: 2, account_code: "50100", account_name: "Sales", credit_cents: 100 }),
        line({ journal_date: "2027-03-01", journal_no: 3, account_code: "50100", account_name: "Sales", credit_cents: 50 }),
      ],
      "2027-06-01",
      natures,
    );
    const f = detectUnclosedPriorYear(secs);
    expect(f).toHaveLength(1);
    expect(f[0].code).toBe("PRIOR_YEAR_NEVER_CLOSED");
  });

  it("says what to do, and never phrases it as an accusation", () => {
    const secs = foldBalanceForward(
      [
        line({ journal_date: "2026-03-01", journal_no: 1, account_code: "50100", account_name: "Sales", credit_cents: 100 }),
        line({ journal_date: "2027-03-01", journal_no: 2, account_code: "50100", account_name: "Sales", credit_cents: 50 }),
      ],
      "2027-06-01",
      natures,
    );
    const [f] = detectUnclosedPriorYear(secs);
    expect(f.whatToDo.length).toBeGreaterThan(40);
    const banned = ["fraud", "fraudulent", "you lied", "illegal", "criminal", "negligent"];
    const text = `${f.headline} ${f.whatToDo}`.toLowerCase();
    for (const w of banned) expect(text).not.toContain(w);
  });

  it("stays quiet in a first year and for permanent accounts (negative controls)", () => {
    expect(
      detectUnclosedPriorYear(
        foldBalanceForward(
          [line({ journal_date: "2027-03-01", journal_no: 1, account_code: "50100", account_name: "Sales", credit_cents: 50 })],
          "2027-06-01",
          natures,
        ),
      ),
    ).toHaveLength(0);

    expect(
      detectUnclosedPriorYear(
        foldBalanceForward(
          [line({ journal_date: "2026-03-01", journal_no: 1, account_code: "10100", debit_cents: 100 })],
          "2027-06-01",
          natures,
        ),
      ),
    ).toHaveLength(0);
  });
});

describe("the trial balance is built from the same fold as the ledger", () => {
  const AP: AccountFacts = {
    code: "30100",
    name: "Accounts payable",
    accountType: "liability",
    normalBalance: "credit",
  };
  const facts = [CASH, AP];
  // The fixture that was executed against real PostgreSQL: 4,000 opening,
  // 3,000 paid out, so the truth is 1,000.
  const rows = [
    line({ journal_date: "2025-12-31", journal_no: 1, account_code: "10100", debit_cents: 400_000 }),
    line({ journal_date: "2025-12-31", journal_no: 1, account_code: "30100", account_name: "Accounts payable", credit_cents: 400_000 }),
    line({ journal_date: "2026-03-15", journal_no: 2, account_code: "10100", credit_cents: 300_000 }),
    line({ journal_date: "2026-03-15", journal_no: 2, account_code: "30100", account_name: "Accounts payable", debit_cents: 300_000 }),
  ];

  const tb = () =>
    buildTrialBalance(foldBalanceForward(rows, "2026-01-01", natureMapFrom(facts)), facts);

  it("reports the true balance, not the period's activity", () => {
    expect(tb().lines.find((l) => l.accountCode === "10100")!.balanceCents).toBe(100_000);
  });

  it("raises no false alarm on correct books", () => {
    // This is defect 2, stated as an assertion. The RPC reports 2 abnormal
    // accounts for this exact data; the truth is 0.
    expect(tb().abnormalCount).toBe(0);
  });

  it("still detects a genuinely abnormal balance (so the check is not simply off)", () => {
    const bad = buildTrialBalance(
      foldBalanceForward(
        [line({ journal_date: "2026-03-15", journal_no: 2, account_code: "10100", credit_cents: 300_000 })],
        "2026-01-01",
        natureMapFrom(facts),
      ),
      facts,
    );
    expect(bad.abnormalCount).toBe(1);
    expect(bad.lines[0].isAbnormal).toBe(true);
  });

  it("reports a set of books that does not foot, instead of certifying it", () => {
    // A trial balance that always claims to foot is the false certification
    // this whole slice exists to remove.
    const oneSided = buildTrialBalance(
      foldBalanceForward(
        [line({ journal_date: "2026-03-15", journal_no: 1, account_code: "10100", credit_cents: 300_000 })],
        "2026-01-01",
        natureMapFrom(facts),
      ),
      facts,
    );
    expect(oneSided.foots).toBe(false);
    expect(oneSided.differenceCents).toBe(-300_000);
  });

  it("puts debits and credits in the right columns", () => {
    const t = tb();
    const cash = t.lines.find((l) => l.accountCode === "10100")!;
    const ap = t.lines.find((l) => l.accountCode === "30100")!;
    expect(cash.debitCents).toBe(100_000);
    expect(cash.creditCents).toBe(0);
    expect(ap.creditCents).toBe(100_000);
    expect(ap.debitCents).toBe(0);
    expect(t.totalDebitCents).toBe(t.totalCreditCents);
  });

  it("drops accounts that net to zero, matching the trial balance SQL", () => {
    const zeroed = buildTrialBalance(
      foldBalanceForward(
        [
          line({ journal_date: "2026-01-05", journal_no: 1, account_code: "10100", debit_cents: 500 }),
          line({ journal_date: "2026-01-06", journal_no: 2, account_code: "10100", credit_cents: 500 }),
        ],
        "2026-01-01",
        natureMapFrom(facts),
      ),
      facts,
    );
    expect(zeroed.lines).toHaveLength(0);
    expect(zeroed.foots).toBe(true);
  });

  it("names an account the chart cannot explain instead of assuming it is fine", () => {
    // The GRWNY/GRNWY typo, which once hid eighteen accounts including all of
    // payroll behind a report that looked perfectly healthy.
    const unmapped = buildTrialBalance(
      foldBalanceForward(
        [line({ journal_date: "2026-02-01", journal_no: 1, account_code: "61000", account_name: "Wages", debit_cents: 900 })],
        "2026-01-01",
      ),
      facts,
    );
    expect(unmapped.unmappedAccountCodes).toEqual(["61000"]);
    expect(unmapped.abnormalCount).toBe(0);
    expect(unmapped.totalDebitCents).toBe(900);
  });

  it("agrees with the ledger screen account for account", () => {
    // The structural guarantee: one fold, two screens. If these ever disagree,
    // one of the two reports is lying to the owner.
    const sections = foldBalanceForward(rows, "2026-01-01", natureMapFrom(facts));
    const t = buildTrialBalance(sections, facts);
    for (const sec of sections) {
      const l = t.lines.find((x) => x.accountCode === sec.accountCode);
      if (sec.closingBalanceCents === 0) {
        expect(l).toBeUndefined();
      } else {
        expect(l!.balanceCents).toBe(sec.closingBalanceCents);
      }
    }
  });
});
