/**
 * tests/compliance/trial-balance-core.test.ts
 *
 * Adversarial mirror for the F4 trial-balance core — the first report anyone
 * actually reads, and the thing every tax form is built on top of.
 *
 * THE CENTRAL FACT THIS FILE DEFENDS, proven by execution against a real
 * PostgreSQL before a line of the core was written:
 *
 *   0174's trg_gl_mark_reversed flips the ORIGINAL journal to 'reversed' and
 *   leaves the REVERSAL itself 'posted'. So a trial balance filtered on
 *   status = 'posted' drops what was reversed and KEEPS the reversal — one
 *   naked half of a cancelled pair. The probe posted a real 1,000.00 sale plus
 *   a mistaken 2,500.00 sale that was then reversed, and measured:
 *
 *     status='posted'                  -> cash -150000, revenue +150000, FOOTS TO ZERO
 *     status IN ('posted','reversed')  -> cash  100000, revenue -100000, FOOTS TO ZERO
 *
 *   Both balance. One is fiction. "It balances" is therefore not evidence of
 *   anything, and any test that only checks footing is a test that cannot fail.
 *
 * These tests are written to BREAK the core, not to confirm it (rule 13b).
 * Predicates are SWEPT across their domain rather than sampled at one happy
 * value (rule 15b), and every guard has a NEGATIVE CONTROL proving the wrong
 * answer is genuinely refused rather than the right answer merely accepted.
 */
import { describe, it, expect } from "vitest";
import {
  ALL_JOURNAL_STATUSES,
  JOURNAL_STATUSES_IN_TRIAL_BALANCE,
  isReportableStatus,
  assertTrialBalanceStatusFilter,
  isValidYmd,
  isOnOrBefore,
  isWithinRange,
  splitDebitCredit,
  sideOf,
  isAbnormalBalance,
  buildTrialBalance,
  describeTrialBalance,
  __runTrialBalanceCoreTests,
  type LedgerLineInput,
  type BuildTrialBalanceInput,
} from "../../src/lib/accounting/trial-balance-core";

// ---------------------------------------------------------------------------
// Fixtures. Every helper produces something VALID, so each test can break
// exactly one thing and prove that one thing is what stopped it.
// ---------------------------------------------------------------------------

function line(over: Partial<LedgerLineInput> = {}): LedgerLineInput {
  return {
    accountCode: "10100",
    accountName: "Cash on Hand — Vault",
    accountType: "asset",
    normalBalance: "debit",
    amountCents: 100_000,
    status: "posted",
    journalDate: "2026-03-01",
    ...over,
  };
}

function revLine(over: Partial<LedgerLineInput> = {}): LedgerLineInput {
  return line({
    accountCode: "50010",
    accountName: "Sales — Flower",
    accountType: "income",
    normalBalance: "credit",
    amountCents: -100_000,
    ...over,
  });
}

function build(over: Partial<BuildTrialBalanceInput> = {}) {
  return buildTrialBalance({
    entityCode: "greenway",
    fromDate: "2026-01-01",
    toDate: "2026-12-31",
    lines: [line(), revLine()],
    ...over,
  });
}

describe("trial-balance-core: the module's own self-tests", () => {
  it("passes its embedded suite (the same one the CI gate runs)", () => {
    expect(() => __runTrialBalanceCoreTests()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 1) THE HEADLINE. The reversal must not invent money.
// ---------------------------------------------------------------------------

describe("trial-balance-core: THE HEADLINE — reversals must not invent money", () => {
  /**
   * The exact scenario from the SQL probe, expressed as ledger lines.
   * A real 1,000.00 sale; a mistaken 2,500.00 sale; and its reversal.
   * After 0174's trigger runs, the mistake is 'reversed' and the reversal
   * is 'posted'.
   */
  const keeperCash = line({ amountCents: 100_000, status: "posted" });
  const keeperRev = revLine({ amountCents: -100_000, status: "posted" });
  const mistakeCash = line({ amountCents: 250_000, status: "reversed" });
  const mistakeRev = revLine({ amountCents: -250_000, status: "reversed" });
  const undoCash = line({ amountCents: -250_000, status: "posted" });
  const undoRev = revLine({ amountCents: 250_000, status: "posted" });

  const allSix = [keeperCash, keeperRev, mistakeCash, mistakeRev, undoCash, undoRev];

  it("THE MONEY PROOF: reports only the one real sale", () => {
    const tb = build({ lines: allSix });
    const cash = tb.rows.find((r) => r.accountCode === "10100");
    const rev = tb.rows.find((r) => r.accountCode === "50010");
    expect(cash?.balanceCents).toBe(100_000);
    expect(rev?.balanceCents).toBe(-100_000);
    expect(tb.balanced).toBe(true);
    expect(describeTrialBalance(tb).exportable).toBe(true);
  });

  it("NEGATIVE CONTROL: the naive status='posted' line set invents money AND STILL BALANCES", () => {
    // This is the whole reason the core exists. If this assertion ever starts
    // failing, the naive filter has stopped being wrong and the headline test
    // above has quietly become a tautology (rule 15b). It must keep failing
    // in exactly this way, forever.
    const naive = allSix.filter((l) => l.status === "posted");
    const tb = buildTrialBalance({
      entityCode: "greenway",
      fromDate: "2026-01-01",
      toDate: "2026-12-31",
      lines: naive,
    });
    const cash = tb.rows.find((r) => r.accountCode === "10100");
    const rev = tb.rows.find((r) => r.accountCode === "50010");

    expect(cash?.balanceCents).toBe(-150_000); // cash that does not exist
    expect(rev?.balanceCents).toBe(150_000); // revenue with the sign inverted
    expect(tb.balanced).toBe(true); // ...and it balances
    expect(tb.differenceCents).toBe(0); // ...perfectly

    // And the two answers genuinely differ, so the filter is load-bearing.
    expect(cash?.balanceCents).not.toBe(100_000);
  });

  it("a reversed original keeps its lines: dropping them is what loses the money", () => {
    const withReversed = build({ lines: allSix });
    const withoutReversed = build({
      lines: allSix.filter((l) => l.status !== "reversed"),
    });
    expect(withReversed.lineCount).toBe(6);
    expect(withoutReversed.lineCount).toBe(4);
    expect(withReversed.rows.find((r) => r.accountCode === "10100")?.balanceCents).not.toBe(
      withoutReversed.rows.find((r) => r.accountCode === "10100")?.balanceCents,
    );
  });
});

// ---------------------------------------------------------------------------
// 2) The status rule and its wired enforcement.
// ---------------------------------------------------------------------------

describe("trial-balance-core: the status filter", () => {
  it("knows exactly the three statuses migration 0172 allows", () => {
    expect([...ALL_JOURNAL_STATUSES].sort()).toEqual(["draft", "posted", "reversed"]);
  });

  it("reports on exactly two of them, and drafts are not one", () => {
    expect([...JOURNAL_STATUSES_IN_TRIAL_BALANCE].sort()).toEqual(["posted", "reversed"]);
    expect(isReportableStatus("posted")).toBe(true);
    expect(isReportableStatus("reversed")).toBe(true);
    expect(isReportableStatus("draft")).toBe(false);
  });

  it("SWEEP: every status is classified, and unknown strings are never reportable", () => {
    for (const s of ALL_JOURNAL_STATUSES) {
      expect(typeof isReportableStatus(s)).toBe("boolean");
    }
    for (const junk of ["", " ", "POSTED", "Posted", "void", "deleted", "approved", "null"]) {
      expect(isReportableStatus(junk), `${junk} must not be reportable`).toBe(false);
    }
  });

  it("REFUSES the naive ['posted'] filter by name, with an explanation", () => {
    expect(() => assertTrialBalanceStatusFilter(["posted"])).toThrow(
      /TB_STATUS_FILTER_ORPHANS_REVERSALS/,
    );
    // The message has to teach, not just fail. Michael reads these.
    let msg = "";
    try {
      assertTrialBalanceStatusFilter(["posted"]);
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e);
    }
    expect(msg).toMatch(/still foots to zero/i);
  });

  it("refuses an empty filter, a draft-inclusive filter, and reversed-only", () => {
    expect(() => assertTrialBalanceStatusFilter([])).toThrow(/TB_STATUS_FILTER_EMPTY/);
    expect(() => assertTrialBalanceStatusFilter(["posted", "reversed", "draft"])).toThrow(
      /TB_STATUS_FILTER_DRAFT/,
    );
    expect(() => assertTrialBalanceStatusFilter(["reversed"])).toThrow(
      /TB_STATUS_FILTER_REVERSED_ONLY/,
    );
    expect(() => assertTrialBalanceStatusFilter(["posted", "banana"])).toThrow(
      /TB_STATUS_FILTER_UNKNOWN/,
    );
  });

  it("NEGATIVE CONTROL: the correct filter is accepted, in either order", () => {
    expect(() => assertTrialBalanceStatusFilter(["posted", "reversed"])).not.toThrow();
    expect(() => assertTrialBalanceStatusFilter(["reversed", "posted"])).not.toThrow();
  });

  it("IS WIRED, not merely available: a draft line reaching the builder is REFUSED", () => {
    // Rule 16. A guard that exists but is never called is decoration. The only
    // way to prove it is wired is to drive real input through the real entry
    // point and watch it stop.
    expect(() =>
      build({ lines: [line({ status: "draft" }), revLine()] }),
    ).toThrow(/TB_UNREPORTABLE_STATUS/);
  });

  it("a draft can never contribute money, whatever it claims to be worth", () => {
    // The draft is enormous. If it leaked in, the TB would be off by 9,999,900.
    expect(() =>
      build({
        lines: [line(), revLine(), line({ status: "draft", amountCents: 999_990_000 })],
      }),
    ).toThrow(/TB_UNREPORTABLE_STATUS/);
  });
});

// ---------------------------------------------------------------------------
// 3) Dates. No Date objects, no timezone drift, no silent rollover.
// ---------------------------------------------------------------------------

describe("trial-balance-core: dates", () => {
  it("accepts real dates and refuses impossible ones", () => {
    for (const good of ["2026-01-01", "2026-12-31", "2026-02-28", "2028-02-29", "2000-02-29"]) {
      expect(isValidYmd(good), `${good} should be valid`).toBe(true);
    }
    for (const bad of [
      "2026-02-30",
      "2027-02-29",
      "2100-02-29",
      "2026-13-01",
      "2026-00-10",
      "2026-1-1",
      "26-01-01",
      "2026/01/01",
      "not-a-date",
      "",
      " 2026-01-01",
    ]) {
      expect(isValidYmd(bad), `${bad} should be invalid`).toBe(false);
    }
  });

  it("THE ROLLOVER TRAP: 2026-02-30 is refused, not silently read as March 2", () => {
    // new Date("2026-02-30") rolls forward to 2026-03-02. In a date-ranged
    // financial report that means quietly reporting a DIFFERENT PERIOD than the
    // one on the page — and then filing it.
    expect(isValidYmd("2026-02-30")).toBe(false);
    expect(() => build({ fromDate: "2026-02-30" })).toThrow(/TB_BAD_FROM_DATE/);
    expect(() => build({ toDate: "2026-02-30" })).toThrow(/TB_BAD_TO_DATE/);
  });

  it("LEAP-YEAR SWEEP: the century rule is implemented, not approximated", () => {
    // Divisible by 4 => leap, EXCEPT centuries, EXCEPT multiples of 400.
    // 1900 and 2100 are not leap years; 2000 is. Sampling one year hides this.
    const cases: Array<[number, boolean]> = [
      [2024, true],
      [2025, false],
      [2026, false],
      [2027, false],
      [2028, true],
      [2100, false],
      [2400, true],
      [2000, true],
    ];
    for (const [year, isLeap] of cases) {
      expect(isValidYmd(`${year}-02-29`), `${year}-02-29`).toBe(isLeap);
    }
  });

  it("SWEEP: every month's real length is respected, both sides of the edge", () => {
    const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, "0");
      const last = lengths[m - 1];
      expect(isValidYmd(`2026-${mm}-${String(last).padStart(2, "0")}`)).toBe(true);
      expect(isValidYmd(`2026-${mm}-${String(last + 1).padStart(2, "0")}`)).toBe(false);
    }
  });

  it("compares and ranges inclusively at both ends", () => {
    expect(isOnOrBefore("2026-03-01", "2026-03-01")).toBe(true);
    expect(isOnOrBefore("2026-03-01", "2026-02-28")).toBe(false);
    expect(isWithinRange("2026-03-01", "2026-03-01", "2026-03-31")).toBe(true);
    expect(isWithinRange("2026-03-31", "2026-03-01", "2026-03-31")).toBe(true);
    expect(isWithinRange("2026-02-28", "2026-03-01", "2026-03-31")).toBe(false);
    expect(isWithinRange("2026-04-01", "2026-03-01", "2026-03-31")).toBe(false);
  });

  it("refuses a backwards range instead of returning an empty report", () => {
    // A backwards range returns nothing, which on screen is indistinguishable
    // from "the business had no activity". That is the dangerous kind of wrong.
    expect(() => build({ fromDate: "2026-03-31", toDate: "2026-03-01" })).toThrow(
      /TB_RANGE_BACKWARDS/,
    );
  });

  it("a single-day range is legal and inclusive", () => {
    const tb = build({
      fromDate: "2026-03-01",
      toDate: "2026-03-01",
      lines: [line({ journalDate: "2026-03-01" }), revLine({ journalDate: "2026-03-01" })],
    });
    expect(tb.lineCount).toBe(2);
  });

  it("refuses a line dated outside the requested range rather than including it", () => {
    expect(() =>
      build({
        fromDate: "2026-03-01",
        toDate: "2026-03-31",
        lines: [line({ journalDate: "2026-04-01" }), revLine({ journalDate: "2026-03-01" })],
      }),
    ).toThrow(/TB_LINE_OUT_OF_RANGE/);
  });

  it("refuses a line with an unreadable date", () => {
    expect(() => build({ lines: [line({ journalDate: "2026-02-30" }), revLine()] })).toThrow(
      /TB_BAD_LINE_DATE/,
    );
  });
});

// ---------------------------------------------------------------------------
// 4) Money. Integer cents, signs, and the debit/credit presentation.
// ---------------------------------------------------------------------------

describe("trial-balance-core: money", () => {
  it("puts a positive balance in the debit column and a negative in the credit column", () => {
    expect(splitDebitCredit(100_000)).toEqual({ debitCents: 100_000, creditCents: 0 });
    expect(splitDebitCredit(-100_000)).toEqual({ debitCents: 0, creditCents: 100_000 });
    expect(splitDebitCredit(0)).toEqual({ debitCents: 0, creditCents: 0 });
  });

  it("SWEEP: debits minus credits reproduces the signed balance for every value", () => {
    // The invariant that makes the presentation trustworthy. Swept, not sampled,
    // and deliberately stepped by an odd number so it lands on odd cents.
    for (let cents = -100_000; cents <= 100_000; cents += 137) {
      const { debitCents, creditCents } = splitDebitCredit(cents);
      expect(debitCents - creditCents, `at ${cents}`).toBe(cents);
      expect(debitCents).toBeGreaterThanOrEqual(0);
      expect(creditCents).toBeGreaterThanOrEqual(0);
      // Never both columns at once — that is not what a trial balance means.
      expect(debitCents === 0 || creditCents === 0).toBe(true);
    }
  });

  it("refuses fractional cents, because a fraction means a float leaked in", () => {
    expect(() => splitDebitCredit(1.5)).toThrow(/TB_NON_INTEGER_CENTS/);
    expect(() => splitDebitCredit(0.1 + 0.2)).toThrow(/TB_NON_INTEGER_CENTS/);
    expect(() => splitDebitCredit(Number.NaN)).toThrow(/TB_NON_INTEGER_CENTS/);
    expect(() => splitDebitCredit(Number.POSITIVE_INFINITY)).toThrow(/TB_NON_INTEGER_CENTS/);
  });

  it("refuses a fractional or non-finite amount arriving on a line", () => {
    expect(() => build({ lines: [line({ amountCents: 1.5 }), revLine()] })).toThrow(
      /TB_NON_INTEGER_CENTS/,
    );
    expect(() => build({ lines: [line({ amountCents: Number.NaN }), revLine()] })).toThrow(
      /TB_NON_INTEGER_CENTS/,
    );
  });

  it("refuses a zero-value line, which 0172 forbids at the database too", () => {
    expect(() => build({ lines: [line({ amountCents: 0 }), revLine()] })).toThrow(/TB_ZERO_LINE/);
  });

  it("names the side of a balance, and gives zero no side at all", () => {
    expect(sideOf(1)).toBe("debit");
    expect(sideOf(-1)).toBe("credit");
    expect(sideOf(0)).toBe("zero");
  });

  it("adds up hundreds of awkward amounts without losing a cent", () => {
    const lines: LedgerLineInput[] = [];
    let running = 0;
    for (let i = 1; i <= 300; i++) {
      const amt = i * 37 + 1; // odd cents, never round
      running += amt;
      lines.push(line({ amountCents: amt }));
      lines.push(revLine({ amountCents: -amt }));
    }
    const tb = build({ lines });
    expect(tb.rows.find((r) => r.accountCode === "10100")?.balanceCents).toBe(running);
    expect(tb.balanced).toBe(true);
    expect(tb.differenceCents).toBe(0);
    expect(tb.lineCount).toBe(600);
  });
});

// ---------------------------------------------------------------------------
// 5) Abnormal balances — surfaced, never suppressed.
// ---------------------------------------------------------------------------

describe("trial-balance-core: abnormal balances", () => {
  it("flags a balance sitting opposite its normal side, and never flags zero", () => {
    expect(isAbnormalBalance(-500, "debit")).toBe(true); // asset with a credit balance
    expect(isAbnormalBalance(500, "credit")).toBe(true); // income with a debit balance
    expect(isAbnormalBalance(500, "debit")).toBe(false);
    expect(isAbnormalBalance(-500, "credit")).toBe(false);
    expect(isAbnormalBalance(0, "debit")).toBe(false);
    expect(isAbnormalBalance(0, "credit")).toBe(false);
  });

  it("SWEEP: the predicate flips exactly at zero and is never stuck", () => {
    let debitFlips = 0;
    let prev = isAbnormalBalance(-50, "debit");
    for (let c = -49; c <= 50; c++) {
      const now = isAbnormalBalance(c, "debit");
      if (now !== prev) debitFlips++;
      prev = now;
    }
    // -50..-1 abnormal, 0 not, 1..50 not => exactly one transition.
    expect(debitFlips).toBe(1);
    // And it can return both answers, so it is not a constant.
    expect(isAbnormalBalance(-1, "debit")).toBe(true);
    expect(isAbnormalBalance(1, "debit")).toBe(false);
  });

  it("NEGATIVE INVENTORY (rule 19) is reported and does NOT block the report", () => {
    // Michael's real books carried impossible negative category balances that
    // were offset by a 4,624,697.31 plug. The fix is not to hide the negative
    // balance — it is to SHOW it and refuse to paper over it.
    const tb = build({
      lines: [
        line({
          accountCode: "20010",
          accountName: "Inventory — Flower",
          accountType: "asset",
          normalBalance: "debit",
          amountCents: -500_000,
        }),
        line({
          accountCode: "60010",
          accountName: "COGS — Flower",
          accountType: "cogs",
          normalBalance: "debit",
          amountCents: 500_000,
        }),
      ],
    });
    const inv = tb.rows.find((r) => r.accountCode === "20010");
    expect(inv?.isAbnormal).toBe(true);
    expect(tb.abnormalRows.length).toBe(1);
    expect(tb.balanced).toBe(true);

    const verdict = describeTrialBalance(tb);
    // Honest and usable: a real balance, reported, with a warning attached.
    expect(verdict.exportable).toBe(true);
    expect(verdict.warnings.length).toBeGreaterThan(0);
    expect(verdict.warnings.join(" ")).toMatch(/negative inventory/i);
  });
});

// ---------------------------------------------------------------------------
// 6) Refusals on the shape of the request itself.
// ---------------------------------------------------------------------------

describe("trial-balance-core: refusals", () => {
  it("refuses a blank entity, because four entities file four different returns", () => {
    for (const bad of ["", "   ", "\t"]) {
      expect(() => build({ entityCode: bad })).toThrow(/TB_NO_ENTITY/);
    }
  });

  it("refuses the same account described two different ways", () => {
    // If 10100 arrives once as an asset and once as income, one of the two is
    // wrong, and silently picking either would misstate the balance sheet.
    expect(() =>
      build({
        lines: [
          line({ accountCode: "10100", accountType: "asset", normalBalance: "debit" }),
          line({
            accountCode: "10100",
            accountType: "income",
            normalBalance: "credit",
            amountCents: -100_000,
          }),
        ],
      }),
    ).toThrow(/TB_ACCOUNT_INCONSISTENT/);
  });

  it("reports an out-of-balance TB rather than throwing — it is a FINDING, not a crash", () => {
    // Every journal is forced to balance on the way in, so an unbalanced trial
    // balance means lines were lost or double-counted. Michael must SEE that.
    const tb = build({ lines: [line({ amountCents: 100_000 }), revLine({ amountCents: -90_000 })] });
    expect(tb.balanced).toBe(false);
    expect(tb.differenceCents).toBe(10_000);

    const verdict = describeTrialBalance(tb);
    expect(verdict.exportable).toBe(false);
    expect(verdict.headline).toMatch(/DO NOT BALANCE/i);
  });

  it("REFUSES TO SUGGEST A PLUG, which is how the original drift began", () => {
    const tb = build({ lines: [line({ amountCents: 100_000 }), revLine({ amountCents: -90_000 })] });
    const text = [describeTrialBalance(tb).headline, ...describeTrialBalance(tb).warnings].join(" ");
    expect(text).toMatch(/find the cause/i);
    expect(text).toMatch(/Do not adjust anything/i);
    // It must never propose the balancing figure. Naming the number is the
    // first step to typing it in.
    expect(text).not.toMatch(/adjusting entry/i);
    expect(text).not.toMatch(/to balance, post/i);
  });
});

// ---------------------------------------------------------------------------
// 7) The verdict. Empty is not healthy.
// ---------------------------------------------------------------------------

describe("trial-balance-core: the plain-English verdict", () => {
  it("an EMPTY trial balance is NOT a clean bill of health", () => {
    // Zero equals zero, so an empty TB balances trivially. A report that says
    // BALANCED after reading nothing is exactly how a broken query, a wrong
    // entity, or a backwards range masquerades as healthy books.
    const tb = build({ lines: [] });
    expect(tb.balanced).toBe(true); // it does technically balance
    expect(tb.lineCount).toBe(0);

    const verdict = describeTrialBalance(tb);
    expect(verdict.exportable).toBe(false); // ...and it is still not usable
    expect(verdict.headline).toMatch(/NOT a clean bill of health/i);
  });

  it("NEGATIVE CONTROL: a real, balanced trial balance IS exportable", () => {
    // Without this, every assertion above would pass on a core that simply
    // refused everything.
    const verdict = describeTrialBalance(build());
    expect(verdict.exportable).toBe(true);
    expect(verdict.warnings).toEqual([]);
  });

  it("speaks plain English — no error codes, no jargon, in every verdict", () => {
    const cases = [
      build(),
      build({ lines: [] }),
      build({ lines: [line({ amountCents: 100_000 }), revLine({ amountCents: -90_000 })] }),
    ];
    for (const tb of cases) {
      const v = describeTrialBalance(tb);
      expect(v.headline.length).toBeGreaterThan(30);
      expect(v.headline).not.toMatch(/TB_[A-Z_]+/); // no raw codes at a human
      expect(typeof v.exportable).toBe("boolean");
    }
  });
});

// ---------------------------------------------------------------------------
// 8) Hostile input. It must decide or refuse — never corrupt.
// ---------------------------------------------------------------------------

describe("trial-balance-core: hostile input", () => {
  it("never returns a silently wrong trial balance for malformed input", () => {
    const hostile: unknown[] = [
      { entityCode: null, fromDate: "2026-01-01", toDate: "2026-12-31", lines: [] },
      { entityCode: "greenway", fromDate: null, toDate: "2026-12-31", lines: [] },
      { entityCode: "greenway", fromDate: "2026-01-01", toDate: 20261231, lines: [] },
      { entityCode: "greenway", fromDate: "2026-01-01", toDate: "2026-12-31", lines: [{}] },
    ];
    for (const h of hostile) {
      let threw = false;
      let result: unknown = null;
      try {
        result = buildTrialBalance(h as BuildTrialBalanceInput);
      } catch {
        threw = true;
      }
      // Either it refuses (preferred) or it returns something empty and
      // non-exportable. What it must never do is return confident numbers.
      if (!threw) {
        const tb = result as ReturnType<typeof buildTrialBalance>;
        expect(describeTrialBalance(tb).exportable).toBe(false);
      } else {
        expect(threw).toBe(true);
      }
    }
  });

  it("handles very large but legal amounts without losing precision", () => {
    const big = 900_000_000_000; // 9 billion dollars, well inside MAX_SAFE_INTEGER
    const tb = build({
      lines: [line({ amountCents: big }), revLine({ amountCents: -big })],
    });
    expect(tb.rows.find((r) => r.accountCode === "10100")?.balanceCents).toBe(big);
    expect(tb.balanced).toBe(true);
    expect(tb.differenceCents).toBe(0);
  });

  it("does not mutate the caller's input array or line objects", () => {
    // A report that edits the data it was handed is a report that corrupts the
    // next report.
    const original = line();
    const frozenCopy = { ...original };
    const lines = [original, revLine()];
    const snapshot = [...lines];
    build({ lines });
    expect(original).toEqual(frozenCopy);
    expect(lines).toEqual(snapshot);
  });
});
