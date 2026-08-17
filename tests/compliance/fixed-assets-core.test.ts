/**
 * fixed-assets-core — vitest mirror.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `src/lib/accounting/fixed-assets-core.ts` carries its own embedded
 * `__runFixedAssetsCoreTests()`, but until this slice that suite was not
 * registered anywhere, so it ran in CI exactly never. This mirror puts the
 * module on the vitest gate as well, so a regression has to get past two
 * independent harnesses instead of zero.
 *
 * WHAT IS BEING PROTECTED
 * -----------------------
 * This is depreciation on a real building Michael owns. Get it wrong and the
 * error does not show up as a crash — it shows up as a wrong number on a filed
 * tax return, repeated silently for 39 years, and discovered by an examiner
 * rather than by us. The three things that must never break:
 *
 *   1. LAND IS NEVER DEPRECIATED. Not by default, not by accident, not ever.
 *   2. ACCUMULATED DEPRECIATION NEVER EXCEEDS BASIS. You cannot deduct more
 *      than the asset cost.
 *   3. THE PERCENTAGES ARE THE IRS'S, NOT OURS. No derivations, no guesses.
 *
 * GROUNDING (standing rule: never guess, cite the authoritative source)
 * --------------------------------------------------------------------
 * Every table value and worked example below was verified DURING THIS SLICE by
 * downloading the current IRS publication and reading it, not from memory:
 *
 *   $ curl -sL -o p946.pdf https://www.irs.gov/pub/irs-pdf/p946.pdf
 *   $ pdftotext -layout p946.pdf p946.txt
 *
 *   p946.txt:5044  Table A-7a. Nonresidential Real Property
 *                  Mid-Month Convention / Straight Line—39 Years
 *     Year 1 : 2.461% 2.247% 2.033% 1.819% 1.605% 1.391%
 *              1.177% 0.963% 0.749% 0.535% 0.321% 0.107%
 *     Year 2–39: 2.564 in every month
 *     Year 40: 0.107 0.321 0.535 0.749 0.963 1.177
 *              1.391 1.605 1.819 2.033 2.247 2.461
 *
 *   p946.txt:2610  Example 1. "You bought a building and land for $120,000 and
 *                  placed it in service on March 8. The sales contract showed
 *                  that the building cost $100,000 and the land cost $20,000."
 *                  ... 1st year 2.033% = $2,033; 2nd 2.564% = $2,564;
 *                      3rd 2.564% = $2,564.
 *
 * The account codes are checked against supabase/migrations/0178_fixed_assets.sql
 * BY READING THE FILE at test time, so the TypeScript constants and the database
 * cannot drift apart quietly.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import {
  RATE_SCALE,
  PROPERTY_CLASSES,
  NONRES_REAL_TABLE_YEARS,
  FIXED_ASSET_ACCOUNTS,
  ACCUMULATED_DEPRECIATION_IS_CONTRA,
  propertyClassInfo,
  isDepreciable,
  assertDepreciable,
  macrsRateMilliPct,
  assertBasisCents,
  mulDivRoundHalfUp,
  applyRateCents,
  disposalHalfMonths,
  buildDepreciationSchedule,
  depreciationForYearCents,
  accumulatedThroughCents,
  adjustedBasisCents,
  assertAccumulatedWithinBasis,
  allocatePurchasePrice,
  accountCodeForClass,
  explainSchedule,
  __runFixedAssetsCoreTests,
  type PropertyClass,
  type FixedAssetInput,
} from "@/lib/accounting/fixed-assets-core";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/** IRS Pub. 946 (2025) Example 1, expressed in CENTS. */
const PUB946_EXAMPLE_1: FixedAssetInput = {
  assetTag: "PUB946-EX1",
  description: "IRS Publication 946 Example 1 building",
  entityCode: "landholding",
  propertyClass: "nonresidential_real",
  depreciableBasisCents: 100_000_00, // building only — NOT the $120,000 total
  placedInServiceYear: 2025,
  placedInServiceMonth: 3, // March
  disposedYear: null,
  disposedMonth: null,
};

function asset(over: Partial<FixedAssetInput> = {}): FixedAssetInput {
  return { ...PUB946_EXAMPLE_1, ...over };
}

/** Table A-7a year-1 row, transcribed from the PDF read during this slice. */
const A7A_YEAR_1_FROM_IRS_PDF = [
  2461, 2247, 2033, 1819, 1605, 1391, 1177, 963, 749, 535, 321, 107,
] as const;

/** Table A-7a year-40 row, from the same read. */
const A7A_YEAR_40_FROM_IRS_PDF = [
  107, 321, 535, 749, 963, 1177, 1391, 1605, 1819, 2033, 2247, 2461,
] as const;

const A7A_MIDDLE_YEARS_FROM_IRS_PDF = 2564;

const ALL_CLASSES: readonly PropertyClass[] = PROPERTY_CLASSES.map((c) => c.slug);

// ---------------------------------------------------------------------------
// 0) The module's own embedded suite must pass under vitest too
// ---------------------------------------------------------------------------
describe("embedded self-tests", () => {
  it("passes its own suite", () => {
    // Contract: accounting cores return void and THROW on failure.
    expect(() => __runFixedAssetsCoreTests()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 1) THE IRS TABLE — the numbers must be the IRS's, digit for digit
// ---------------------------------------------------------------------------
describe("MACRS Table A-7a matches IRS Pub. 946 exactly", () => {
  it("year 1 matches the published row for all 12 months", () => {
    for (let month = 1; month <= 12; month++) {
      expect(
        macrsRateMilliPct("nonresidential_real", 1, month),
        `year 1, month ${month}`,
      ).toBe(A7A_YEAR_1_FROM_IRS_PDF[month - 1]);
    }
  });

  it("years 2 through 39 are 2.564% in every month", () => {
    for (let year = 2; year <= 39; year++) {
      for (let month = 1; month <= 12; month++) {
        expect(
          macrsRateMilliPct("nonresidential_real", year, month),
          `year ${year}, month ${month}`,
        ).toBe(A7A_MIDDLE_YEARS_FROM_IRS_PDF);
      }
    }
  });

  it("year 40 matches the published row for all 12 months", () => {
    for (let month = 1; month <= 12; month++) {
      expect(
        macrsRateMilliPct("nonresidential_real", 40, month),
        `year 40, month ${month}`,
      ).toBe(A7A_YEAR_40_FROM_IRS_PDF[month - 1]);
    }
  });

  it("year 1 and year 40 are mirror images — the mid-month convention's signature", () => {
    // Whatever fraction of year 1 you miss, you pick up in year 40. If a
    // transcription typo existed, this symmetry would almost certainly break.
    for (let month = 1; month <= 12; month++) {
      expect(macrsRateMilliPct("nonresidential_real", 1, month)).toBe(
        macrsRateMilliPct("nonresidential_real", 40, 13 - month),
      );
    }
  });

  it("every month's full 40-year column sums to 100.000% — no basis lost or invented", () => {
    // THE SINGLE STRONGEST CHECK ON THE TABLE. The whole cost must be
    // recovered: no more (that is deducting money never spent) and no less
    // (that is money silently abandoned).
    for (let month = 1; month <= 12; month++) {
      let total = 0;
      for (let year = 1; year <= NONRES_REAL_TABLE_YEARS; year++) {
        total += macrsRateMilliPct("nonresidential_real", year, month);
      }
      expect(total, `month ${month} column must total 100%`).toBe(RATE_SCALE);
    }
  });

  it("returns 0 outside the recovery period instead of throwing", () => {
    // A 41st year is a FACT (no depreciation), not an error.
    expect(macrsRateMilliPct("nonresidential_real", 41, 3)).toBe(0);
    expect(macrsRateMilliPct("nonresidential_real", 999, 3)).toBe(0);
    expect(macrsRateMilliPct("nonresidential_real", 0, 3)).toBe(0);
    expect(macrsRateMilliPct("nonresidential_real", -5, 3)).toBe(0);
  });

  it("refuses an impossible month rather than clamping it", () => {
    for (const bad of [0, 13, -1, 1.5, NaN, Infinity]) {
      expect(() => macrsRateMilliPct("nonresidential_real", 1, bad)).toThrow(/FA_BAD_MONTH/);
    }
  });

  it("refuses a fractional recovery year", () => {
    expect(() => macrsRateMilliPct("nonresidential_real", 1.5, 3)).toThrow(/FA_BAD_YEAR/);
  });

  it("no rate is negative and none exceeds the whole basis", () => {
    for (let year = 1; year <= NONRES_REAL_TABLE_YEARS + 2; year++) {
      for (let month = 1; month <= 12; month++) {
        const r = macrsRateMilliPct("nonresidential_real", year, month);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(RATE_SCALE);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 2) IRS Pub. 946 Example 1 — the published worked example, to the cent
// ---------------------------------------------------------------------------
describe("Pub. 946 Example 1 reproduces the published deductions", () => {
  it("years 1-3 are $2,033 / $2,564 / $2,564 exactly", () => {
    // p946.txt:2610 — the IRS's own arithmetic. If we cannot match a printed
    // example there is no reason to trust us on anything harder.
    expect(depreciationForYearCents(PUB946_EXAMPLE_1, 2025)).toBe(2_033_00);
    expect(depreciationForYearCents(PUB946_EXAMPLE_1, 2026)).toBe(2_564_00);
    expect(depreciationForYearCents(PUB946_EXAMPLE_1, 2027)).toBe(2_564_00);
  });

  it("depreciates the BUILDING ($100,000), never the $120,000 purchase price", () => {
    // The single most expensive mistake available here: depreciating the land.
    const schedule = buildDepreciationSchedule(PUB946_EXAMPLE_1);
    const total = schedule.reduce((s, r) => s + r.depreciationCents, 0);
    expect(total).toBe(100_000_00);
    expect(total).not.toBe(120_000_00);
  });

  it("accumulated through year 3 is the sum of the three published years", () => {
    expect(accumulatedThroughCents(PUB946_EXAMPLE_1, 2027)).toBe(
      2_033_00 + 2_564_00 + 2_564_00,
    );
  });

  it("adjusted basis falls by exactly the depreciation taken", () => {
    expect(adjustedBasisCents(PUB946_EXAMPLE_1, 2027)).toBe(
      100_000_00 - (2_033_00 + 2_564_00 + 2_564_00),
    );
  });

  it("the split of the Example 1 purchase reproduces $20,000 land / $100,000 building", () => {
    const split = allocatePurchasePrice(
      120_000_00,
      20_000_00,
      100_000_00,
      "Pub. 946 Example 1 sales contract",
    );
    expect(split.landCents).toBe(20_000_00);
    expect(split.improvementCents).toBe(100_000_00);
  });
});

// ---------------------------------------------------------------------------
// 3) THE LAND GUARD — hard rule 1
// ---------------------------------------------------------------------------
describe("land is never depreciated, by any route", () => {
  it("land is flagged non-depreciable", () => {
    expect(isDepreciable("land")).toBe(false);
    expect(propertyClassInfo("land").depreciable).toBe(false);
    expect(propertyClassInfo("land").recoveryYears).toBeNull();
    expect(propertyClassInfo("land").convention).toBeNull();
  });

  it("assertDepreciable refuses land with a message that explains WHY", () => {
    expect(() => assertDepreciable("land")).toThrow(/FA_LAND_NOT_DEPRECIABLE/);
    // The refusal must teach, not just deny.
    try {
      assertDepreciable("land");
      throw new Error("should have thrown");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toMatch(/never depreciated/i);
      expect(msg).toMatch(/land does not wear out|become obsolete|used up/i);
    }
  });

  it("EVERY computation entry point refuses land — not just the obvious one", () => {
    // A guard on one function is not a guard. This walks all the public doors.
    const landAsset = asset({ propertyClass: "land" });
    expect(() => buildDepreciationSchedule(landAsset)).toThrow(/FA_LAND_NOT_DEPRECIABLE/);
    expect(() => depreciationForYearCents(landAsset, 2025)).toThrow(/FA_LAND_NOT_DEPRECIABLE/);
    expect(() => accumulatedThroughCents(landAsset, 2025)).toThrow(/FA_LAND_NOT_DEPRECIABLE/);
    expect(() => adjustedBasisCents(landAsset, 2025)).toThrow(/FA_LAND_NOT_DEPRECIABLE/);
    expect(() => macrsRateMilliPct("land", 1, 3)).toThrow(/FA_LAND_NOT_DEPRECIABLE/);
  });

  it("land still gets an account and a plain-English explanation (recorded, not depreciated)", () => {
    // Refusing to depreciate must not mean refusing to RECORD. Land carries
    // basis forever and is half of every building purchase.
    expect(accountCodeForClass("land")).toBe(FIXED_ASSET_ACCOUNTS.land);
    const text = explainSchedule(asset({ propertyClass: "land" }));
    expect(text).toMatch(/never depreciated/i);
    expect(text).not.toMatch(/\bFA_[A-Z_]+\b/); // no raw error codes at the owner
  });

  it("construction in progress is also never depreciated (not yet in service)", () => {
    expect(isDepreciable("construction_in_progress")).toBe(false);
    expect(() => buildDepreciationSchedule(asset({ propertyClass: "construction_in_progress" }))).toThrow(
      /FA_LAND_NOT_DEPRECIABLE/,
    );
  });

  it("an unknown property class REFUSES rather than falling back to a default", () => {
    expect(() => propertyClassInfo("commercial_spaceship" as PropertyClass)).toThrow(
      /FA_UNSUPPORTED_CLASS/,
    );
    expect(() => accountCodeForClass("commercial_spaceship" as PropertyClass)).toThrow(
      /FA_UNSUPPORTED_CLASS/,
    );
  });

  it("classes without a shipped table refuse to guess instead of computing something plausible", () => {
    // Silently substituting a rate we did not verify is exactly how a wrong
    // number reaches a filed return.
    for (const info of PROPERTY_CLASSES) {
      if (info.depreciable && !info.computable) {
        expect(() => assertDepreciable(info.slug), info.slug).toThrow(/FA_UNSUPPORTED_CLASS/);
        expect(() => assertDepreciable(info.slug), info.slug).toThrow(/Refusing to guess/i);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 4) THE BASIS CAP — hard rule 2
// ---------------------------------------------------------------------------
describe("accumulated depreciation can never exceed basis", () => {
  it("a full 39-year schedule recovers exactly the basis, never a cent more", () => {
    for (let month = 1; month <= 12; month++) {
      const rows = buildDepreciationSchedule(asset({ placedInServiceMonth: month }));
      const total = rows.reduce((s, r) => s + r.depreciationCents, 0);
      expect(total, `month ${month} must recover exactly basis`).toBe(100_000_00);
      const last = rows[rows.length - 1];
      expect(last.accumulatedCents, `month ${month} accumulated`).toBe(100_000_00);
      expect(last.remainingBasisCents, `month ${month} remaining`).toBe(0);
    }
  });

  it("holds across awkward bases where rounding could leak a cent", () => {
    // Odd, prime-ish and tiny amounts are where half-up rounding shows up.
    for (const basis of [1, 2, 3, 7, 99, 101, 12_345_67, 999_999_99, 1_000_000_00]) {
      for (const month of [1, 3, 7, 12]) {
        const rows = buildDepreciationSchedule(
          asset({ depreciableBasisCents: basis, placedInServiceMonth: month }),
        );
        const total = rows.reduce((s, r) => s + r.depreciationCents, 0);
        expect(total, `basis ${basis} month ${month}`).toBe(basis);
      }
    }
  });

  it("no single row is negative, and accumulated only ever climbs", () => {
    const rows = buildDepreciationSchedule(asset({ depreciableBasisCents: 777_777_77 }));
    let prev = -1;
    for (const r of rows) {
      expect(r.depreciationCents).toBeGreaterThanOrEqual(0);
      expect(r.remainingBasisCents).toBeGreaterThanOrEqual(0);
      expect(r.accumulatedCents).toBeGreaterThan(prev);
      prev = r.accumulatedCents;
    }
  });

  it("every row's arithmetic ties out internally", () => {
    // accumulated = prior + this year; remaining = basis - accumulated.
    const basis = 543_210_99;
    const rows = buildDepreciationSchedule(asset({ depreciableBasisCents: basis }));
    let running = 0;
    for (const r of rows) {
      running += r.depreciationCents;
      expect(r.accumulatedCents, `year ${r.taxYear} accumulated`).toBe(running);
      expect(r.remainingBasisCents, `year ${r.taxYear} remaining`).toBe(basis - running);
    }
  });

  it("D7 REGRESSION: a tiny basis recovers in full instead of vanishing", () => {
    // FOUND BY THIS TEST FILE. The published table percentages are rounded to
    // three decimals, so applying them literally for all 40 years stranded
    // basis: a 1-cent asset rounded to zero every single year and recovered
    // NOTHING AT ALL. Stranded basis is money never deducted and never
    // explained, and it breaks the tie-out to the balance sheet.
    // Fixed per IRS Pub. 946 (p946.txt:2768): "If you hold the property for the
    // entire recovery period, your depreciation deduction for the year that
    // includes the final month of the recovery period is the amount of your
    // unrecovered basis in the property."
    for (const basis of [1, 2, 3, 7, 50, 99]) {
      for (let month = 1; month <= 12; month++) {
        const rows = buildDepreciationSchedule(
          asset({ depreciableBasisCents: basis, placedInServiceMonth: month }),
        );
        const total = rows.reduce((s, r) => s + r.depreciationCents, 0);
        expect(total, `basis ${basis}c month ${month} must recover in full`).toBe(basis);
      }
    }
  });

  it("D7 REGRESSION: a large realistic building strands no cents either", () => {
    // $1,234,567.89 stranded 2-3 cents depending on the month before the fix.
    for (const basis of [123_456_789, 999_999_99, 437_512_33]) {
      for (let month = 1; month <= 12; month++) {
        const rows = buildDepreciationSchedule(
          asset({ depreciableBasisCents: basis, placedInServiceMonth: month }),
        );
        const total = rows.reduce((s, r) => s + r.depreciationCents, 0);
        expect(total, `basis ${basis} month ${month}`).toBe(basis);
      }
    }
  });

  it("the final-year sweep cites the IRS rule it is applying", () => {
    // A number that differs from the published table MUST justify itself, or
    // it looks like a bug to whoever reads the schedule next.
    const rows = buildDepreciationSchedule(asset({ depreciableBasisCents: 123_456_789 }));
    const last = rows[rows.length - 1];
    expect(last.note).toMatch(/final year of the recovery period/i);
    expect(last.note).toMatch(/unrecovered basis/i);
    expect(last.note).toMatch(/Pub\. 946/i);
  });

  it("the hard cap stays REACHABLE — the sweep must not turn it into dead code", () => {
    // If the final-year sweep ever swallowed every case, the "never exceed
    // basis" cap would become unreachable and that guarantee would rest on
    // nothing. $0.59 in September is a basis found by search where the rounded
    // percentages OVERSHOOT and the cap bites in recovery year 31.
    const rows = buildDepreciationSchedule(
      asset({ depreciableBasisCents: 59, placedInServiceMonth: 9 }),
    );
    const cappedEarly = rows.filter(
      (r) =>
        r.recoveryYear < NONRES_REAL_TABLE_YEARS &&
        (r.note ?? "").includes("Capped at unrecovered basis"),
    );
    expect(cappedEarly.length).toBeGreaterThan(0);
    expect(rows.reduce((s, r) => s + r.depreciationCents, 0)).toBe(59);
  });

  it("a schedule never contains a zero-depreciation year", () => {
    // A row that deducts nothing is either a bug or noise on the schedule.
    for (const basis of [1, 59, 100, 100_001_00, 123_456_789]) {
      for (let month = 1; month <= 12; month++) {
        const rows = buildDepreciationSchedule(
          asset({ depreciableBasisCents: basis, placedInServiceMonth: month }),
        );
        for (const r of rows) {
          expect(r.depreciationCents, `basis ${basis} m${month} year ${r.recoveryYear}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("a DISPOSAL in the final year prorates and does NOT sweep the remainder", () => {
    // The asset left mid-year, so the unrecovered basis is settled through
    // gain or loss on the sale — deducting it here would overstate the
    // deduction in the year of sale.
    const finalYear = 2025 + NONRES_REAL_TABLE_YEARS - 1;
    const rows = buildDepreciationSchedule(
      asset({ disposedYear: finalYear, disposedMonth: 6 }),
    );
    const last = rows[rows.length - 1];
    expect(last.note).toMatch(/disposal year/i);
    expect(last.note ?? "").not.toMatch(/final year of the recovery period/i);
    expect(last.remainingBasisCents).toBeGreaterThan(0);
  });

  it("a disposal in the final year prorates the TABLE rate, not the remainder", () => {
    // FOUND BY MUTATION TESTING. Dropping the `notDisposedThisYear` condition
    // (so the sweep also fires on a disposal) SURVIVED the note-based test
    // above, because the disposal branch runs afterwards and overwrites the
    // note — the note looked right while the AMOUNT was wrong. Asserting on
    // explanations alone is not enough; this pins the number.
    //
    // Distinguishing case found by search, not chosen for convenience: a 2-cent
    // basis where the year-40 table rate rounds to 0 but the unrecovered
    // remainder is 2 cents. Correct = prorate the table amount (0). The mutant
    // = prorate the remainder (1 cent), deducting money in the year of sale
    // that belongs in the gain/loss calculation instead.
    const finalYear = 2025 + NONRES_REAL_TABLE_YEARS - 1;
    for (let month = 1; month <= 12; month++) {
      const rows = buildDepreciationSchedule(
        asset({
          depreciableBasisCents: 2,
          placedInServiceMonth: month,
          disposedYear: finalYear,
          disposedMonth: 6,
        }),
      );
      const finalRow = rows.find((r) => r.recoveryYear === NONRES_REAL_TABLE_YEARS);
      if (!finalRow) continue;
      const tableAmount = applyRateCents(
        2,
        macrsRateMilliPct("nonresidential_real", NONRES_REAL_TABLE_YEARS, month),
      );
      const expected = Number(mulDivRoundHalfUp(BigInt(tableAmount), BigInt(11), BigInt(24)));
      expect(
        finalRow.depreciationCents,
        `month ${month}: disposal year must prorate the table rate, not the remainder`,
      ).toBe(expected);
    }
  });

  it("a disposal never deducts more than the table would have allowed that year", () => {
    // The general form of the rule above, across many bases and months: the
    // year of sale is a PARTIAL year, so it can never exceed the full-year
    // table amount for that recovery year.
    const finalYear = 2025 + NONRES_REAL_TABLE_YEARS - 1;
    for (const basis of [2, 59, 100, 100_001_00, 123_456_789]) {
      for (const month of [1, 3, 8, 12]) {
        const rows = buildDepreciationSchedule(
          asset({
            depreciableBasisCents: basis,
            placedInServiceMonth: month,
            disposedYear: finalYear,
            disposedMonth: 6,
          }),
        );
        const finalRow = rows.find((r) => r.recoveryYear === NONRES_REAL_TABLE_YEARS);
        if (!finalRow) continue;
        const fullYear = applyRateCents(
          basis,
          macrsRateMilliPct("nonresidential_real", NONRES_REAL_TABLE_YEARS, month),
        );
        expect(
          finalRow.depreciationCents,
          `basis ${basis} month ${month}: partial year cannot exceed the full-year amount`,
        ).toBeLessThanOrEqual(fullYear);
      }
    }
  });

  it("the capped final year says so, in words", () => {
    const rows = buildDepreciationSchedule(asset({ placedInServiceMonth: 3 }));
    const capped = rows.filter((r) => (r.note ?? "").includes("Capped at unrecovered basis"));
    // Whether the cap bites depends on rounding; when it does it must explain.
    for (const r of capped) {
      expect(r.note).toMatch(/never exceed the depreciable basis/i);
    }
  });

  it("the independent guard catches an imported figure that is too big", () => {
    // Deliberately a SEPARATE code path from the schedule cap, so one bug
    // cannot disarm both.
    expect(() => assertAccumulatedWithinBasis("GEIGER", 100_000_01, 100_000_00)).toThrow(
      /FA_ACCUM_EXCEEDS_BASIS/,
    );
    expect(() => assertAccumulatedWithinBasis("GEIGER", 100_000_00, 100_000_00)).not.toThrow();
    expect(() => assertAccumulatedWithinBasis("GEIGER", 0, 100_000_00)).not.toThrow();
    expect(() => assertAccumulatedWithinBasis("GEIGER", -1, 100_000_00)).toThrow(
      /FA_ACCUM_EXCEEDS_BASIS/,
    );
    expect(() => assertAccumulatedWithinBasis("GEIGER", 1.5, 100_000_00)).toThrow(
      /FA_ACCUM_EXCEEDS_BASIS/,
    );
  });

  it("a zero-basis asset produces an empty schedule rather than a divide-by-nothing", () => {
    expect(buildDepreciationSchedule(asset({ depreciableBasisCents: 0 }))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5) Money handling — integers only, no floats anywhere
// ---------------------------------------------------------------------------
describe("money is integer cents, always", () => {
  it("rejects dollars-with-decimals as a basis", () => {
    // 1234.56 "dollars" passed where cents are expected is a 100x error.
    for (const bad of [1234.56, 0.1, NaN, Infinity, -Infinity, Number.MAX_VALUE]) {
      expect(() => assertBasisCents(bad), String(bad)).toThrow(/FA_BAD_BASIS/);
    }
  });

  it("rejects a negative basis", () => {
    expect(() => assertBasisCents(-1)).toThrow(/FA_BAD_BASIS/);
    expect(() => assertBasisCents(-100_000_00)).toThrow(/negative/i);
  });

  it("accepts zero and legitimate whole cents", () => {
    expect(() => assertBasisCents(0)).not.toThrow();
    expect(() => assertBasisCents(1)).not.toThrow();
    expect(() => assertBasisCents(Number.MAX_SAFE_INTEGER)).not.toThrow();
  });

  it("mulDivRoundHalfUp rounds half AWAY from zero, symmetrically", () => {
    // 5/2 = 2.5 -> 3 ; -5/2 = -2.5 -> -3. Asymmetric rounding is how a
    // reversal fails to reverse.
    expect(mulDivRoundHalfUp(BigInt(5), BigInt(1), BigInt(2))).toBe(BigInt(3));
    expect(mulDivRoundHalfUp(BigInt(-5), BigInt(1), BigInt(2))).toBe(BigInt(-3));
    expect(mulDivRoundHalfUp(BigInt(4), BigInt(1), BigInt(2))).toBe(BigInt(2));
    expect(mulDivRoundHalfUp(BigInt(-4), BigInt(1), BigInt(2))).toBe(BigInt(-2));
    expect(mulDivRoundHalfUp(BigInt(1), BigInt(1), BigInt(3))).toBe(BigInt(0));
    expect(mulDivRoundHalfUp(BigInt(2), BigInt(1), BigInt(3))).toBe(BigInt(1));
  });

  it("mulDivRoundHalfUp refuses a non-positive denominator", () => {
    expect(() => mulDivRoundHalfUp(BigInt(1), BigInt(1), BigInt(0))).toThrow(/FA_BAD_BASIS/);
    expect(() => mulDivRoundHalfUp(BigInt(1), BigInt(1), BigInt(-2))).toThrow(/FA_BAD_BASIS/);
  });

  it("stays exact past the float barrier", () => {
    // 2^53 + 1 is not representable as a double; BigInt must carry it.
    const big = BigInt("9007199254740993");
    expect(mulDivRoundHalfUp(big, BigInt(1), BigInt(1))).toBe(big);
  });

  it("applyRateCents reproduces the IRS's own $100,000 x 2.564% = $2,564", () => {
    expect(applyRateCents(100_000_00, 2564)).toBe(2_564_00);
    expect(applyRateCents(100_000_00, 2033)).toBe(2_033_00);
  });

  it("applyRateCents refuses a negative or fractional rate", () => {
    expect(() => applyRateCents(100_00, -1)).toThrow(/FA_BAD_BASIS/);
    expect(() => applyRateCents(100_00, 1.5)).toThrow(/FA_BAD_BASIS/);
  });

  it("a 100% rate returns the whole basis and 0% returns nothing", () => {
    expect(applyRateCents(123_456_78, RATE_SCALE)).toBe(123_456_78);
    expect(applyRateCents(123_456_78, 0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6) Disposal — the mid-month convention in the year the asset leaves
// ---------------------------------------------------------------------------
describe("disposal proration", () => {
  it("counts the month of disposition as HALF a month", () => {
    // Pub. 946: a March disposal is 2.5 months of service = 5 half-months.
    expect(disposalHalfMonths(3)).toBe(5);
    expect(disposalHalfMonths(1)).toBe(1); // 0.5 month
    expect(disposalHalfMonths(12)).toBe(23); // 11.5 months
    for (let m = 1; m <= 12; m++) expect(disposalHalfMonths(m)).toBe(2 * m - 1);
  });

  it("never returns a full 24 half-months — a disposal year is never a full year", () => {
    for (let m = 1; m <= 12; m++) expect(disposalHalfMonths(m)).toBeLessThan(24);
  });

  it("refuses an impossible disposal month", () => {
    for (const bad of [0, 13, -1, 2.5]) {
      expect(() => disposalHalfMonths(bad)).toThrow(/FA_BAD_MONTH/);
    }
  });

  it("the disposal year takes a prorated amount and stops the schedule", () => {
    const rows = buildDepreciationSchedule(
      asset({ disposedYear: 2030, disposedMonth: 6 }),
    );
    const last = rows[rows.length - 1];
    expect(last.taxYear).toBe(2030);
    // 11/24 of the full-year 2.564% on $100,000 = 2564 * 11/24, half-up.
    const fullYear = applyRateCents(100_000_00, 2564);
    const expected = Number(mulDivRoundHalfUp(BigInt(fullYear), BigInt(11), BigInt(24)));
    expect(last.depreciationCents).toBe(expected);
    expect(last.depreciationCents).toBeLessThan(fullYear);
    expect(rows.some((r) => r.taxYear > 2030)).toBe(false);
  });

  it("the disposal row explains the proration in words", () => {
    const rows = buildDepreciationSchedule(asset({ disposedYear: 2030, disposedMonth: 6 }));
    const last = rows[rows.length - 1];
    expect(last.note).toMatch(/disposal year/i);
    expect(last.note).toMatch(/11\/24/);
    expect(last.note).toMatch(/half a month/i);
  });

  it("refuses a disposal BEFORE the asset was placed in service", () => {
    expect(() =>
      buildDepreciationSchedule(asset({ disposedYear: 2024, disposedMonth: 1 })),
    ).toThrow(/FA_BAD_DISPOSAL/);
    // Same year, earlier month, must also be caught.
    expect(() =>
      buildDepreciationSchedule(asset({ disposedYear: 2025, disposedMonth: 1 })),
    ).toThrow(/FA_BAD_DISPOSAL/);
  });

  it("accepts a disposal in the very month it was placed in service", () => {
    expect(() =>
      buildDepreciationSchedule(asset({ disposedYear: 2025, disposedMonth: 3 })),
    ).not.toThrow();
  });

  it("refuses half a disposal — both year and month or neither", () => {
    expect(() => buildDepreciationSchedule(asset({ disposedYear: 2030, disposedMonth: null }))).toThrow(
      /FA_BAD_DISPOSAL/,
    );
    expect(() => buildDepreciationSchedule(asset({ disposedYear: null, disposedMonth: 6 }))).toThrow(
      /FA_BAD_DISPOSAL/,
    );
  });

  it("a disposal never lets accumulated exceed basis", () => {
    for (let m = 1; m <= 12; m++) {
      const rows = buildDepreciationSchedule(asset({ disposedYear: 2060, disposedMonth: m }));
      const total = rows.reduce((s, r) => s + r.depreciationCents, 0);
      expect(total, `disposal month ${m}`).toBeLessThanOrEqual(100_000_00);
    }
  });
});

// ---------------------------------------------------------------------------
// 7) Asset shape validation
// ---------------------------------------------------------------------------
describe("asset shape validation", () => {
  it("requires a usable asset tag", () => {
    expect(() => buildDepreciationSchedule(asset({ assetTag: "" }))).toThrow(/FA_BAD_BASIS/);
    expect(() => buildDepreciationSchedule(asset({ assetTag: " " }))).toThrow(/FA_BAD_BASIS/);
    expect(() => buildDepreciationSchedule(asset({ assetTag: "X" }))).toThrow(/FA_BAD_BASIS/);
  });

  it("refuses an implausible placed-in-service year", () => {
    for (const bad of [1899, 2201, 0, -2025, 2025.5]) {
      expect(() => buildDepreciationSchedule(asset({ placedInServiceYear: bad })), String(bad)).toThrow(
        /FA_BAD_YEAR/,
      );
    }
  });

  it("refuses an impossible placed-in-service month", () => {
    for (const bad of [0, 13, -1, 6.5]) {
      expect(() => buildDepreciationSchedule(asset({ placedInServiceMonth: bad })), String(bad)).toThrow(
        /FA_BAD_MONTH/,
      );
    }
  });

  it("tax-year queries validate the year they are asked about", () => {
    expect(() => depreciationForYearCents(PUB946_EXAMPLE_1, 1800)).toThrow(/FA_BAD_YEAR/);
    expect(() => accumulatedThroughCents(PUB946_EXAMPLE_1, 3000)).toThrow(/FA_BAD_YEAR/);
  });

  it("a year before service is zero, and a year after recovery is zero", () => {
    expect(depreciationForYearCents(PUB946_EXAMPLE_1, 2024)).toBe(0);
    expect(depreciationForYearCents(PUB946_EXAMPLE_1, 2100)).toBe(0);
    // ...and accumulated before service is nothing, after recovery is all of it.
    expect(accumulatedThroughCents(PUB946_EXAMPLE_1, 2024)).toBe(0);
    expect(accumulatedThroughCents(PUB946_EXAMPLE_1, 2100)).toBe(100_000_00);
  });
});

// ---------------------------------------------------------------------------
// 8) Land / building allocation — the most consequential single number
// ---------------------------------------------------------------------------
describe("allocatePurchasePrice", () => {
  it("REQUIRES an evidence reference — no split from a convenient assumption", () => {
    for (const bad of ["", "  ", "ab"]) {
      expect(() => allocatePurchasePrice(120_000_00, 20_000_00, 100_000_00, bad)).toThrow(
        /FA_ALLOCATION_MISMATCH/,
      );
    }
    expect(() =>
      allocatePurchasePrice(120_000_00, 20_000_00, 100_000_00, "2019 closing statement"),
    ).not.toThrow();
  });

  it("names the evidence in the note it writes for the file", () => {
    const s = allocatePurchasePrice(120_000_00, 20_000_00, 100_000_00, "Kitsap assessor roll 2019");
    expect(s.basisNote).toContain("Kitsap assessor roll 2019");
    expect(s.basisNote).toMatch(/never depreciated/i);
  });

  it("the two sides always add back to the exact purchase price", () => {
    // A split that loses a cent is a balance sheet that never ties again.
    const cases: Array<[number, number, number]> = [
      [120_000_00, 20_000_00, 100_000_00],
      [1, 1, 1],
      [3, 1, 1],
      [999_999_99, 333_333_33, 666_666_66],
      [1_000_000_01, 1, 2],
      [7, 3, 4],
      [12_345_67, 5_000_00, 7_000_00],
    ];
    for (const [total, land, imp] of cases) {
      const s = allocatePurchasePrice(total, land, imp, "test evidence");
      expect(s.landCents + s.improvementCents, `${total}/${land}/${imp}`).toBe(total);
      expect(s.landCents).toBeGreaterThanOrEqual(0);
      expect(s.improvementCents).toBeGreaterThanOrEqual(0);
    }
  });

  it("the odd cent goes to LAND — the conservative, reproducible direction", () => {
    // 3 cents split 50/50 = 1.5 each. Land takes 2, building takes 1: the
    // smaller deduction. Deterministic beats clever.
    const s = allocatePurchasePrice(3, 1, 1, "odd cent case");
    expect(s.landCents).toBe(2);
    expect(s.improvementCents).toBe(1);
  });

  it("refuses when the reference values sum to zero — no ratio exists", () => {
    expect(() => allocatePurchasePrice(120_000_00, 0, 0, "nothing to go on")).toThrow(
      /FA_ALLOCATION_MISMATCH/,
    );
  });

  it("an all-land purchase depreciates nothing at all", () => {
    const s = allocatePurchasePrice(50_000_00, 50_000_00, 0, "raw land purchase");
    expect(s.landCents).toBe(50_000_00);
    expect(s.improvementCents).toBe(0);
    expect(s.landMilliPct).toBe(RATE_SCALE);
  });

  it("reports the land percentage as milli-percent consistent with the split", () => {
    const s = allocatePurchasePrice(120_000_00, 20_000_00, 100_000_00, "contract");
    // 20,000 / 120,000 = 16.667%
    expect(s.landMilliPct).toBe(16667);
    expect(s.landMilliPct).toBeGreaterThanOrEqual(0);
    expect(s.landMilliPct).toBeLessThanOrEqual(RATE_SCALE);
  });

  it("refuses negative or fractional inputs", () => {
    expect(() => allocatePurchasePrice(-1, 1, 1, "evidence")).toThrow(/FA_BAD_BASIS/);
    expect(() => allocatePurchasePrice(100, -1, 1, "evidence")).toThrow(/FA_BAD_BASIS/);
    expect(() => allocatePurchasePrice(100.5, 1, 1, "evidence")).toThrow(/FA_BAD_BASIS/);
  });
});

// ---------------------------------------------------------------------------
// 9) Account codes — must not drift from migration 0178
// ---------------------------------------------------------------------------
describe("GL account codes stay in step with migration 0178", () => {
  const MIGRATION = join(process.cwd(), "supabase/migrations/0178_fixed_assets.sql");

  it("the migration file is where we think it is (guards a silently vacuous test)", () => {
    expect(existsSync(MIGRATION)).toBe(true);
  });

  it("every code in FIXED_ASSET_ACCOUNTS is actually created by the migration", () => {
    // A constant that no longer exists in the database is a posting that fails
    // at runtime, in production, on a real journal entry.
    const sql = readFileSync(MIGRATION, "utf8");
    const created = new Set<string>();
    for (const m of sql.matchAll(/gl_upsert_account\(\s*'(\d{5})'/g)) created.add(m[1]);
    expect(created.size, "migration should create the fixed-asset block").toBeGreaterThanOrEqual(10);
    for (const [name, code] of Object.entries(FIXED_ASSET_ACCOUNTS)) {
      expect(created.has(code), `${name} (${code}) is not created by 0178`).toBe(true);
    }
  });

  it("all codes are bare 5-digit codes at or above 21000, as the migration asserts", () => {
    for (const [name, code] of Object.entries(FIXED_ASSET_ACCOUNTS)) {
      expect(code, name).toMatch(/^\d{5}$/);
      expect(Number(code), name).toBeGreaterThanOrEqual(21000);
    }
  });

  it("no two account constants collide", () => {
    const codes = Object.values(FIXED_ASSET_ACCOUNTS);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("accumulated depreciation is the contra account, and the migration agrees", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    expect(ACCUMULATED_DEPRECIATION_IS_CONTRA).toBe(true);
    expect(FIXED_ASSET_ACCOUNTS.accumulatedDepreciation).toBe("21900");
    expect(sql).toMatch(/21900[\s\S]{0,400}CONTRA-ASSET/i);
  });

  it("every property class maps to a real account in the block", () => {
    const valid = new Set<string>(Object.values(FIXED_ASSET_ACCOUNTS));
    for (const slug of ALL_CLASSES) {
      const code = accountCodeForClass(slug);
      expect(valid.has(code), `${slug} -> ${code}`).toBe(true);
      // Nothing may post to the parent.
      expect(code, `${slug} must not post to the parent`).not.toBe(FIXED_ASSET_ACCOUNTS.parent);
    }
  });

  it("land maps to its OWN account, separate from buildings", () => {
    // If these ever merged, land would silently start depreciating.
    expect(accountCodeForClass("land")).toBe(FIXED_ASSET_ACCOUNTS.land);
    expect(accountCodeForClass("nonresidential_real")).toBe(FIXED_ASSET_ACCOUNTS.buildings);
    expect(accountCodeForClass("land")).not.toBe(accountCodeForClass("nonresidential_real"));
    // ...and land improvements are NOT land, or the deduction is lost forever.
    expect(accountCodeForClass("land_improvement")).not.toBe(accountCodeForClass("land"));
  });
});

// ---------------------------------------------------------------------------
// 10) The class table itself
// ---------------------------------------------------------------------------
describe("the property class table is internally consistent", () => {
  it("every class round-trips through propertyClassInfo", () => {
    for (const slug of ALL_CLASSES) {
      expect(propertyClassInfo(slug).slug).toBe(slug);
    }
  });

  it("no duplicate slugs", () => {
    expect(new Set(ALL_CLASSES).size).toBe(ALL_CLASSES.length);
  });

  it("non-depreciable classes carry no recovery period and no convention", () => {
    for (const info of PROPERTY_CLASSES) {
      if (!info.depreciable) {
        expect(info.recoveryYears, info.slug).toBeNull();
        expect(info.convention, info.slug).toBeNull();
      } else {
        expect(info.recoveryYears, info.slug).not.toBeNull();
        expect(info.convention, info.slug).not.toBeNull();
      }
    }
  });

  it("mid-month is used for real property ONLY, per Pub. 946", () => {
    // MM never applies to personal property, and HY/MQ never to real property.
    const realProperty = new Set([
      "nonresidential_real",
      "nonresidential_real_315",
      "residential_rental",
    ]);
    for (const info of PROPERTY_CLASSES) {
      if (info.convention === "MM") {
        expect(realProperty.has(info.slug), `${info.slug} should not use MM`).toBe(true);
      }
      if (realProperty.has(info.slug)) {
        expect(info.convention, info.slug).toBe("MM");
      }
    }
  });

  it("every class explains itself in plain English, with no jargon-only notes", () => {
    for (const info of PROPERTY_CLASSES) {
      expect(info.note.length, info.slug).toBeGreaterThan(40);
      expect(info.label.length, info.slug).toBeGreaterThan(2);
    }
  });
});

// ---------------------------------------------------------------------------
// 11) The mentor surface — refusals must teach, not just deny
// ---------------------------------------------------------------------------
describe("explainSchedule speaks plain English", () => {
  it("never leaks a raw error code at the owner", () => {
    for (const slug of ALL_CLASSES) {
      const text = explainSchedule(asset({ propertyClass: slug }));
      expect(text, slug).not.toMatch(/FA_[A-Z_]{3,}/);
      expect(text.length, slug).toBeGreaterThan(40);
    }
  });

  it("says what happens next for a depreciable asset", () => {
    const text = explainSchedule(PUB946_EXAMPLE_1);
    expect(text.length).toBeGreaterThan(80);
  });

  it("explains an un-computable class without pretending it computed one", () => {
    for (const info of PROPERTY_CLASSES) {
      if (info.depreciable && !info.computable) {
        const text = explainSchedule(asset({ propertyClass: info.slug }));
        expect(text, info.slug).toMatch(/not.*(yet|compute)|will not guess/i);
      }
    }
  });

  it("never throws, for any class, even the ones that refuse to compute", () => {
    for (const slug of ALL_CLASSES) {
      expect(() => explainSchedule(asset({ propertyClass: slug })), slug).not.toThrow();
    }
  });
});
