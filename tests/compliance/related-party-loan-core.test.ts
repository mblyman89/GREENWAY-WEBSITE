/**
 * tests/compliance/related-party-loan-core.test.ts   (books-76)
 *
 * WHAT THIS FILE IS FOR, AND WHAT IT DELIBERATELY LEAVES TO THE SELF-TESTS.
 *
 * `__runRelatedPartyLoanCoreTests()` already proves the arithmetic and the
 * refusal reachability, and it runs in production under the pure self-test
 * harness rather than only under vitest. Repeating those assertions here would
 * cost tokens and buy a second copy of the same evidence — standing rule 73's
 * failure mode, where comparing two documents is blind to both being wrong.
 *
 * So this file tests only what the self-tests CANNOT, which is everything
 * involving the filesystem:
 *
 *   1. DRIFT. Every account code the module names is restated from migration
 *      0173. A restated fact is a fact that can go stale silently, so each one
 *      is re-read from the migration and compared. If someone renumbers 36000,
 *      the build fails here instead of the loan quietly posting to a dead code.
 *
 *   2. THE CHART FACTS THE ROUTING DECISION RESTS ON. `loanControlAccountFor`
 *      chooses 36000 over 34000 because 34000's own chart comment says it is
 *      driven by an amortization schedule. That comment is the reason, so if
 *      the comment changes the reason has to be re-examined; the test pins it.
 *
 *   3. PURITY. The module claims zero imports. Claims decay; this measures.
 *
 *   4. THE AUTHORITIES ARE WIRED, not merely written. An authority array that
 *      exists but is never merged into the registry renders as an unresolved id
 *      on every screen that cites it — which is a failure this codebase has
 *      actually shipped before (see the SHAREHOLDER_ROSTER note in
 *      books-guidance-core.ts).
 *
 * Michael's instruction for this slice was "test, but don't over test". Four
 * things the self-tests structurally cannot reach is the honest reading of that.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  RELATED_PARTY_LOAN_ACCOUNTS,
  MICHAELS_ATM_LOAN_AS_STATED,
  loanControlAccountFor,
  assessBonaFide,
  imputedInterestRequirement,
  __runRelatedPartyLoanCoreTests,
} from "@/lib/accounting/related-party-loan-core";
import { RELATED_PARTY_LOAN_AUTHORITIES } from "@/lib/accounting/related-party-loan-authorities";
import { GUIDANCE_AUTHORITIES } from "@/lib/accounting/books-guidance-core";

const REPO_ROOT = process.cwd();
const MIGRATION = join(
  REPO_ROOT,
  "supabase",
  "migrations",
  "0173_chart_of_accounts.sql",
);
const CORE = join(
  REPO_ROOT,
  "src",
  "lib",
  "accounting",
  "related-party-loan-core.ts",
);

function migrationText(): string {
  return readFileSync(MIGRATION, "utf8");
}

/** Every account code the migration seeds, as a set. */
function migrationAccountCodes(): Set<string> {
  const text = migrationText();
  const codes = new Set<string>();
  const marker = "gl_upsert_account('";
  let at = text.indexOf(marker);
  while (at !== -1) {
    const start = at + marker.length;
    const end = text.indexOf("'", start);
    if (end === -1) break;
    codes.add(text.slice(start, end));
    at = text.indexOf(marker, end);
  }
  return codes;
}

describe("related-party-loan-core: the chart facts it restates", () => {
  it("the migration parsed at all, so a later emptiness is a real failure", () => {
    // Guard against the vacuous pass: if the parser silently returned nothing,
    // every "is in the chart" assertion below would trivially need to fail, but
    // a future refactor to a subset check would trivially PASS. Pin the shape.
    const codes = migrationAccountCodes();
    expect(codes.size).toBeGreaterThan(50);
    expect(codes.has("10200")).toBe(true);
  });

  it("every account the loan module names is really in the chart", () => {
    const codes = migrationAccountCodes();
    const named = Object.entries(RELATED_PARTY_LOAN_ACCOUNTS);
    // Prove the loop has work to do; an empty object would pass vacuously.
    expect(named.length).toBe(9);
    for (const [name, code] of named) {
      expect(
        codes.has(code),
        `${name} = ${code} is not seeded by migration 0173`,
      ).toBe(true);
    }
  });

  it("34000 is still CONTROL and still driven by an amortization schedule", () => {
    // This is the ENTIRE basis for routing Michael's loan to 36000 instead.
    // If this comment ever changes, loanControlAccountFor's reasoning must be
    // re-derived rather than left standing on a sentence that no longer exists.
    const text = migrationText();
    expect(text).toContain("'34000','Notes & Loans Payable','liability'");
    expect(text).toContain(
      "CONTROL, driven by the loan subledger and its amortization schedule.",
    );
  });

  it("36000 is still the intercompany account that must net to zero", () => {
    const text = migrationText();
    expect(text).toContain("'36000','Due To / From Related Entity','liability'");
    expect(text).toContain(
      "Must net to ZERO across all four on consolidation",
    );
  });

  it("10900 still says it must clear to zero, which is what makes it custody", () => {
    const text = migrationText();
    expect(text).toContain("'10900'");
    expect(text).toContain("Must clear to zero at close.");
  });
});

describe("related-party-loan-core: purity", () => {
  it("has no imports at all, so it can never reach a clock, a network or a DB", () => {
    const src = readFileSync(CORE, "utf8");
    // Strip block and line comments before looking for import statements, so a
    // comment that merely MENTIONS an import does not trip the check and, more
    // importantly, so a real import cannot hide behind one.
    const noBlock = src.split("/*").map((chunk, i) => {
      if (i === 0) return chunk;
      const close = chunk.indexOf("*/");
      return close === -1 ? "" : chunk.slice(close + 2);
    }).join("");
    const stripped = noBlock
      .split("\n")
      .map((line) => {
        const at = line.indexOf("//");
        return at === -1 ? line : line.slice(0, at);
      })
      .join("\n");

    expect(stripped).not.toContain("import ");
    expect(stripped).not.toContain("require(");
    // Determinism: no clock, no randomness. A tax figure that depends on when
    // it was computed is not reproducible, and a reviewer cannot re-derive it.
    expect(stripped).not.toContain("Date.now");
    expect(stripped).not.toContain("new Date");
    expect(stripped).not.toContain("Math.random");
  });
});

describe("related-party-loan-core: the authorities are wired, not just written", () => {
  it("every §1.482-2 authority resolves in the merged registry", () => {
    expect(RELATED_PARTY_LOAN_AUTHORITIES.length).toBe(8);
    const merged = new Set(GUIDANCE_AUTHORITIES.map((a) => a.id));
    for (const a of RELATED_PARTY_LOAN_AUTHORITIES) {
      expect(
        merged.has(a.id),
        `${a.id} is declared but never merged, so every screen citing it renders an unresolved id`,
      ).toBe(true);
    }
  });

  it("the two rules that contradict Michael's assumptions are both present", () => {
    const ids = RELATED_PARTY_LOAN_AUTHORITIES.map((a) => a.id);
    // "It doesn't need to be interest bearing" -> AFR is imputed anyway.
    expect(ids).toContain("REG_1_482_2_A_2_III_B_AFR_IS_IMPUTED");
    // "or have a term limit" -> that makes it a demand loan.
    expect(ids).toContain("REG_1_482_2_A_2_III_C_DEMAND_LOAN_SHORT_TERM_RATE");
  });
});

describe("related-party-loan-core: Michael's loan, as he actually described it", () => {
  it("routes to 36000 and needs no subledger, because it has no schedule", () => {
    const choice = loanControlAccountFor(MICHAELS_ATM_LOAN_AS_STATED);
    expect(choice.account).toBe(RELATED_PARTY_LOAN_ACCOUNTS.DUE_TO_FROM);
    expect(choice.requiresSubledger).toBe(false);
  });

  it("is UNDETERMINED rather than favourable, and names the open questions", () => {
    const a = assessBonaFide(MICHAELS_ATM_LOAN_AS_STATED, "out");
    expect(a.verdict).toBe("UNDETERMINED");
    // The value is in WHICH questions are open, not in the count.
    expect(a.unknown.join(" ")).toContain("tracked");
    expect(a.unknown.join(" ")).toContain("demand");
  });

  it("refuses to compute interest today, and says which input is missing", () => {
    const r = imputedInterestRequirement({
      principalCents: 52_693_758,
      chargedRateMilliPct: 0,
      termMonths: null,
      afrLowerLimitMilliPct: null,
      facts: MICHAELS_ATM_LOAN_AS_STATED,
      direction: "out",
    });
    expect(r.kind).toBe("refused");
    if (r.kind === "refused") {
      expect(r.code).toBe("BONA_FIDE_UNDETERMINED");
      expect(r.resolution.length).toBeGreaterThan(40);
    }
  });
});

describe("related-party-loan-core: the MIXED routing cases", () => {
  /*
   * FOUND BY MUTATION M4. Loosening the routing condition from `&&` to `||`
   * survived, because every case tested had the maturity date and the
   * repayment schedule either BOTH present or BOTH absent. The two halves were
   * never separated, so the conjunction was never actually exercised.
   *
   * The mixed cases are the ones that matter, and the answer is the same for
   * both: 34000's chart comment says it is 'driven by the loan subledger and
   * its amortization schedule'. A maturity date with no repayment schedule
   * gives you an end point and no payments; a repayment schedule with no
   * maturity date gives you payments that never end. Neither produces an
   * amortization schedule, so neither can drive 34000, and routing there would
   * mean inventing the missing half.
   */
  const base = {
    hasWrittenInstrument: true,
    statesInterestRate: true,
    hasActualRepayments: true,
    balanceCyclesBothWays: true,
    balanceIsTracked: true,
    demandEverMade: true,
  } as const;

  it("a maturity date with no repayment schedule still goes to 36000", () => {
    const choice = loanControlAccountFor({
      ...base,
      hasMaturityDate: true,
      hasRepaymentSchedule: false,
    });
    expect(choice.account).toBe(RELATED_PARTY_LOAN_ACCOUNTS.DUE_TO_FROM);
    expect(choice.requiresSubledger).toBe(false);
  });

  it("a repayment schedule with no maturity date still goes to 36000", () => {
    const choice = loanControlAccountFor({
      ...base,
      hasMaturityDate: false,
      hasRepaymentSchedule: true,
    });
    expect(choice.account).toBe(RELATED_PARTY_LOAN_ACCOUNTS.DUE_TO_FROM);
    expect(choice.requiresSubledger).toBe(false);
  });

  it("only both together earn 34000 and its subledger requirement", () => {
    const choice = loanControlAccountFor({
      ...base,
      hasMaturityDate: true,
      hasRepaymentSchedule: true,
    });
    expect(choice.account).toBe(RELATED_PARTY_LOAN_ACCOUNTS.NOTES_PAYABLE);
    expect(choice.requiresSubledger).toBe(true);
  });
});

describe("related-party-loan-core: a BELOW-market rate, not just a zero rate", () => {
  /*
   * FOUND BY MUTATION M3, AND IT IS NOT AN EQUIVALENT MUTANT.
   *
   * Changing `imputedRateMilliPct: afrLowerLimit` to
   * `afrLowerLimit - chargedRate` survived the entire suite. The reason is that
   * every case written up to that point charged ZERO interest, and when the
   * charged rate is zero the two expressions are arithmetically identical. The
   * tests were not wrong; they were all standing on the same special case.
   *
   * The distinction is worth real money the moment Michael acts on the advice
   * in this slice. If he writes the contract and states a rate — say 3.0% when
   * the AFR has since moved to 4.2% — §1.482-2(a)(2)(iii)(B)(2) does NOT impute
   * the 1.2% gap. It says the arm's length rate "shall be equal to the lower
   * limit", so the whole 4.2% is the arm's length rate and the 3.0% he charged
   * counts against it. Imputing the shortfall as though it were the rate would
   * understate the adjustment by nearly three quarters here.
   */
  it("imputes the full lower limit, not the gap between charged and market", () => {
    const r = imputedInterestRequirement({
      principalCents: 10_000_00,
      // Some interest IS charged, but below 100% of the AFR.
      chargedRateMilliPct: 3_000,
      termMonths: 24,
      afrLowerLimitMilliPct: 4_200,
      facts: {
        hasWrittenInstrument: true,
        statesInterestRate: true,
        hasMaturityDate: true,
        hasRepaymentSchedule: true,
        hasActualRepayments: true,
        balanceCyclesBothWays: true,
        balanceIsTracked: true,
        demandEverMade: true,
      },
      direction: "out",
    });

    expect(r.kind).toBe("required");
    if (r.kind === "required") {
      // The lower limit itself. NOT 4200 - 3000 = 1200.
      expect(r.imputedRateMilliPct).toBe(4_200);
      // A stated 24-month term is a term loan, so it is not the demand case.
      expect(r.termClass).toBe("short_term");
    }
  });
});

describe("related-party-loan-core: the self-tests run under vitest too", () => {
  it("passes its own in-production invariants", () => {
    expect(() => __runRelatedPartyLoanCoreTests()).not.toThrow();
  });
});
