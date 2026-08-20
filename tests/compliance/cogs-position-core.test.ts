/**
 * tests/compliance/cogs-position-core.test.ts   (books-20)
 *
 * FORM 1125-A AND THE COST OF GOODS SOLD POSITION.
 *
 * Standing rule 15: every test here must be provably failable — each one was
 * checked by breaking the engine and watching it go red. Standing rule 22: the
 * test is a suspect, not a witness; where a test and the engine disagreed, the
 * question of which was wrong was settled against the SOURCE TEXT, not against
 * whichever was easier to change.
 *
 * Section 14 records the defect the rule 38 probe found before any of these
 * tests existed, and it exists to make sure that defect can never come back.
 */
import { describe, expect, it } from "vitest";

import {
  ALL_COGS_REFUSAL_CODES,
  LAST_SUPPORTED_YEAR,
  adviseOnMethodChange,
  assertCogsCents,
  bucketsForPosition,
  comparePositions,
  computeCogsPosition,
  computeForm1125A,
  determineTaxpayerRole,
  formatCents,
  section280EAppliesTo,
  validateCogsInput,
  validatePositionElection,
  type CogsYearInput,
  type CostBucket,
  type MethodChangeFacts,
  type PositionElection,
} from "@/lib/accounting/cogs-position-core";
import { SYSTEM_START_YEAR } from "@/lib/accounting/s-corporation-year-core";
import {
  COGS_POSITION_LESSONS,
  assertEveryCogsFunctionIsTaught,
  assertEveryCogsLessonIsSubstantive,
  exportedCogsFunctionNames,
  taughtCogsFunctionNames,
} from "@/lib/accounting/cogs-position-mentor";
import { COGS_POSITION_AUTHORITIES_NEW } from "@/lib/accounting/cogs-position-authorities";
import { findGuidanceAuthority } from "@/lib/accounting/books-guidance-core";

// ---------------------------------------------------------------------------
// FIXTURES
// ---------------------------------------------------------------------------

const RETAIL_ONLY = {
  holdsRetailLicence: true,
  holdsProducerLicence: false,
  holdsProcessorLicence: false,
} as const;

const GOOD_ELECTION: PositionElection = {
  fiscalYear: 2026,
  position: "as_filed",
  decidedOnIso: "2026-08-20",
  decidedBy: "Michael Lyman",
  reason: "Continuing my grandfather's method pending federal rescheduling.",
  acknowledgedConservativeAmountCents: 1_271_070_00,
};

const BUCKETS: readonly CostBucket[] = [
  {
    label: "Inbound freight on merchandise",
    amountCents: 8_120_00,
    character: "direct",
    allocationBasis: null,
  },
  {
    label: "Budtender wages (historical treatment)",
    amountCents: 214_600_00,
    character: "allocable",
    allocationBasis: "Hours on shift x average wage",
  },
  {
    label: "Store rent allocated to inventory",
    amountCents: 46_200_00,
    character: "allocable",
    allocationBasis: "Square footage of the vault and back room",
  },
  {
    label: "Receiving clerk wages",
    amountCents: 31_900_00,
    character: "direct",
    allocationBasis: null,
  },
];

function input(over: Partial<CogsYearInput> = {}): CogsYearInput {
  return {
    fiscalYear: 2026,
    licences: RETAIL_ONLY,
    beginningInventoryCents: 182_450_00,
    purchasesCents: 1_244_900_00,
    costBuckets: BUCKETS,
    additionalSection263ACostsCents: 0,
    endingInventoryCents: 196_300_00,
    valuationMethod: "cost",
    section263AApplies: false,
    changeInQuantitiesCostOrValuations: false,
    changeExplanation: null,
    endingInventoryWasCounted: true,
    positionElection: GOOD_ELECTION,
    priorYearPosition: "as_filed",
    form3115FiledForChange: null,
    section280ERepealEffectiveForYearsAfter: null,
    ...over,
  };
}

const FACTS: MethodChangeFacts = {
  yearsTreatmentUsedConsistently: 12,
  underExamination: false,
  cogsRaisedByIrs: false,
  cumulativeDifferenceCents: 41_500_00,
};

const codesOf = (rs: readonly { code: string }[]): string[] => rs.map((r) => r.code);

// ---------------------------------------------------------------------------
// 1) MONEY
// ---------------------------------------------------------------------------

describe("money is integer cents", () => {
  it("accepts whole cents including zero and negatives", () => {
    expect(() => assertCogsCents(0, "x")).not.toThrow();
    expect(() => assertCogsCents(-5_00, "x")).not.toThrow();
    expect(() => assertCogsCents(1_234_567_89, "x")).not.toThrow();
  });

  it("refuses a fractional cent, naming the field", () => {
    expect(() => assertCogsCents(10.5, "purchases")).toThrow(/INTEGER CENTS VIOLATION: purchases/);
  });

  it("refuses a number past the safe integer range", () => {
    expect(() => assertCogsCents(Number.MAX_SAFE_INTEGER + 2, "huge")).toThrow(/UNSAFE INTEGER/);
  });

  it("formats positives plainly and negatives in parentheses", () => {
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(5)).toBe("$0.05");
    expect(formatCents(1_234_567_89)).toBe("$1,234,567.89");
    expect(formatCents(-1_00)).toBe("($1.00)");
  });
});

// ---------------------------------------------------------------------------
// 2) RESELLER OR PRODUCER — DECIDED BY STATE LAW
// ---------------------------------------------------------------------------

describe("taxpayer role is determined by licence, not opinion", () => {
  it("a retail licensee is a reseller, and the reason cites RCW 69.50.328", () => {
    const r = determineTaxpayerRole(RETAIL_ONLY);
    expect(r.role).toBe("reseller");
    expect(r.because).toContain("69.50.328");
    expect(r.because).toContain("1.471-3(b)");
  });

  it("a producer licensee with no retail licence is a producer", () => {
    const r = determineTaxpayerRole({
      holdsRetailLicence: false,
      holdsProducerLicence: true,
      holdsProcessorLicence: false,
    });
    expect(r.role).toBe("producer");
  });

  it("a processor licensee with no retail licence is a producer for §471 purposes", () => {
    const r = determineTaxpayerRole({
      holdsRetailLicence: false,
      holdsProducerLicence: false,
      holdsProcessorLicence: true,
    });
    expect(r.role).toBe("producer");
  });

  it("refuses to pick a winner when the licences contradict Washington law", () => {
    const r = determineTaxpayerRole({
      holdsRetailLicence: true,
      holdsProducerLicence: true,
      holdsProcessorLicence: false,
    });
    expect(r.role).toBe("unknown");
    expect(r.because).toContain("contradict");
  });

  it("retail plus processor is equally impossible and equally refused", () => {
    const r = determineTaxpayerRole({
      holdsRetailLicence: true,
      holdsProducerLicence: false,
      holdsProcessorLicence: true,
    });
    expect(r.role).toBe("unknown");
  });

  it("no licence at all is unknown, never a silent default to reseller", () => {
    const r = determineTaxpayerRole({
      holdsRetailLicence: false,
      holdsProducerLicence: false,
      holdsProcessorLicence: false,
    });
    expect(r.role).toBe("unknown");
    expect(r.because).toContain("guessing");
  });
});

// ---------------------------------------------------------------------------
// 3) THE FORM ITSELF
// ---------------------------------------------------------------------------

describe("Form 1125-A arithmetic", () => {
  it("has the eight numbered lines of the published form, in order", () => {
    const f = computeForm1125A(input(), "conservative");
    expect(f.lines.map((l) => l.line)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
  });

  it("line 6 is the sum of lines 1 through 5", () => {
    const f = computeForm1125A(input(), "as_filed");
    const [l1, l2, l3, l4, l5, l6] = f.lines.map((l) => l.amountCents);
    expect(l6).toBe(l1 + l2 + l3 + l4 + l5);
  });

  it("line 8 is line 6 minus line 7, and is the reported COGS", () => {
    const f = computeForm1125A(input(), "as_filed");
    const l6 = f.lines[5].amountCents;
    const l7 = f.lines[6].amountCents;
    expect(f.lines[7].amountCents).toBe(l6 - l7);
    expect(f.costOfGoodsSoldCents).toBe(l6 - l7);
  });

  it("computes the conservative figure to the cent, checked by hand", () => {
    // 182,450 + 1,244,900 + (8,120 + 31,900 direct) + 0 - 196,300
    const f = computeForm1125A(input(), "conservative");
    expect(f.costOfGoodsSoldCents).toBe(1_271_070_00);
  });

  it("computes the as-filed figure to the cent, checked by hand", () => {
    // conservative + 214,600 + 46,200 allocable
    const f = computeForm1125A(input(), "as_filed");
    expect(f.costOfGoodsSoldCents).toBe(1_531_870_00);
  });

  it("routes wages to line 3 and non-wage costs to line 5", () => {
    const f = computeForm1125A(input(), "as_filed");
    // receiving clerk 31,900 + budtender 214,600
    expect(f.lines[2].amountCents).toBe(246_500_00);
    // freight 8,120 + rent 46,200
    expect(f.lines[4].amountCents).toBe(54_320_00);
  });

  it("puts only the direct wage on line 3 under the conservative position", () => {
    const f = computeForm1125A(input(), "conservative");
    expect(f.lines[2].amountCents).toBe(31_900_00);
    expect(f.lines[4].amountCents).toBe(8_120_00);
  });

  it("carries §263A costs onto line 4 untouched", () => {
    const f = computeForm1125A(input({ additionalSection263ACostsCents: 12_345_00 }), "conservative");
    expect(f.lines[3].amountCents).toBe(12_345_00);
    expect(f.costOfGoodsSoldCents).toBe(1_271_070_00 + 12_345_00);
  });

  it("ending inventory REDUCES cost of goods sold dollar for dollar", () => {
    const lo = computeForm1125A(input({ endingInventoryCents: 100_000_00 }), "conservative");
    const hi = computeForm1125A(input({ endingInventoryCents: 150_000_00 }), "conservative");
    expect(lo.costOfGoodsSoldCents - hi.costOfGoodsSoldCents).toBe(50_000_00);
  });

  it("labels the position it computed, so a form cannot be mistaken for the other", () => {
    expect(computeForm1125A(input(), "conservative").position).toBe("conservative");
    expect(computeForm1125A(input(), "as_filed").position).toBe("as_filed");
  });
});

// ---------------------------------------------------------------------------
// 4) BUCKET SELECTION
// ---------------------------------------------------------------------------

describe("which costs are allowed into inventory", () => {
  it("the conservative position admits only §1.471-3(b) direct costs", () => {
    const b = bucketsForPosition(input(), "conservative");
    expect(b).toHaveLength(2);
    expect(b.every((x) => x.character === "direct")).toBe(true);
  });

  it("the as-filed position admits everything, including contested costs", () => {
    expect(bucketsForPosition(input(), "as_filed")).toHaveLength(4);
  });

  it("an all-direct cost set produces no gap at all", () => {
    const all = BUCKETS.map((b) => ({ ...b, character: "direct" as const }));
    const c = comparePositions(input({ costBuckets: all }));
    expect(c.additionalCogsClaimedCents).toBe(0);
    expect(c.plainEnglish).toContain("nothing at risk");
  });

  it("an empty cost set is handled without error", () => {
    const c = comparePositions(input({ costBuckets: [] }));
    expect(c.additionalCogsClaimedCents).toBe(0);
    expect(c.conservative.costOfGoodsSoldCents).toBe(c.asFiled.costOfGoodsSoldCents);
  });
});

// ---------------------------------------------------------------------------
// 5) THE GAP
// ---------------------------------------------------------------------------

describe("the gap between the two positions", () => {
  it("equals the sum of the contested buckets", () => {
    const c = comparePositions(input());
    expect(c.additionalCogsClaimedCents).toBe(214_600_00 + 46_200_00);
  });

  it("itemises the contested buckets rather than only totalling them", () => {
    const c = comparePositions(input());
    expect(c.contestedBuckets).toHaveLength(2);
    expect(c.contestedBuckets.map((b) => b.label)).toContain("Budtender wages (historical treatment)");
  });

  it("always returns BOTH computations, never only the chosen one", () => {
    const c = comparePositions(input());
    expect(c.conservative.costOfGoodsSoldCents).toBe(1_271_070_00);
    expect(c.asFiled.costOfGoodsSoldCents).toBe(1_531_870_00);
  });

  it("states the exposure in dollars, in plain English, while §280E applies", () => {
    const c = comparePositions(input());
    expect(c.plainEnglish).toContain("$260,800.00");
    expect(c.plainEnglish).toContain("disappear");
  });
});

// ---------------------------------------------------------------------------
// 6) THE ELECTION — AN UNCHOSEN POSITION IS NOT A CHOSEN POSITION
// ---------------------------------------------------------------------------

describe("the owner must actually choose, on the record", () => {
  it("refuses a year with no election at all", () => {
    expect(codesOf(validatePositionElection(null, 2026))).toEqual(["POSITION_NOT_ELECTED"]);
  });

  it("accepts a complete, dated, reasoned election for the right year", () => {
    expect(validatePositionElection(GOOD_ELECTION, 2026)).toHaveLength(0);
  });

  it("does NOT refuse merely because the aggressive position was chosen", () => {
    // Standing rule 28. The engine records the choice; it does not veto it.
    const r = validatePositionElection({ ...GOOD_ELECTION, position: "as_filed" }, 2026);
    expect(r).toHaveLength(0);
  });

  it("refuses an election carried over from another year", () => {
    const r = validatePositionElection({ ...GOOD_ELECTION, fiscalYear: 2025 }, 2026);
    expect(codesOf(r)).toContain("POSITION_ACKNOWLEDGEMENT_WRONG_YEAR");
  });

  it("refuses an undated election", () => {
    const r = validatePositionElection({ ...GOOD_ELECTION, decidedOnIso: "sometime" }, 2026);
    expect(codesOf(r)).toContain("POSITION_ACKNOWLEDGEMENT_UNDATED");
  });

  it("refuses a date that is not ISO format", () => {
    const r = validatePositionElection({ ...GOOD_ELECTION, decidedOnIso: "08/20/2026" }, 2026);
    expect(codesOf(r)).toContain("POSITION_ACKNOWLEDGEMENT_UNDATED");
  });

  it("refuses an election with no stated reason", () => {
    const r = validatePositionElection({ ...GOOD_ELECTION, reason: "n/a" }, 2026);
    expect(codesOf(r)).toContain("POSITION_ACKNOWLEDGEMENT_NO_REASON");
  });

  it("accepts 'because we always have' as a reason — it is one", () => {
    const r = validatePositionElection(
      { ...GOOD_ELECTION, reason: "Because we have always done it this way." },
      2026,
    );
    expect(r).toHaveLength(0);
  });

  it("refuses an election with no named decision-maker", () => {
    const r = validatePositionElection({ ...GOOD_ELECTION, decidedBy: "   " }, 2026);
    expect(codesOf(r)).toContain("POSITION_ACKNOWLEDGEMENT_NO_DECIDER");
  });

  it("refuses an as-filed election that never recorded the conservative number seen", () => {
    const r = validatePositionElection(
      { ...GOOD_ELECTION, acknowledgedConservativeAmountCents: null },
      2026,
    );
    expect(codesOf(r)).toContain("POSITION_ACKNOWLEDGEMENT_AMOUNT_NOT_SHOWN");
  });

  it("does not demand the acknowledged figure when the conservative position was chosen", () => {
    const r = validatePositionElection(
      { ...GOOD_ELECTION, position: "conservative", acknowledgedConservativeAmountCents: null },
      2026,
    );
    expect(r).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 7) INPUT VALIDATION
// ---------------------------------------------------------------------------

describe("validation refuses rather than warns", () => {
  it("passes clean input", () => {
    expect(validateCogsInput(input())).toHaveLength(0);
  });

  it("refuses a year before the S election and stops there", () => {
    const r = validateCogsInput(input({ fiscalYear: SYSTEM_START_YEAR - 1 }));
    expect(codesOf(r)).toEqual(["FISCAL_YEAR_OUT_OF_RANGE"]);
  });

  it("refuses a year past the supported range", () => {
    const r = validateCogsInput(input({ fiscalYear: LAST_SUPPORTED_YEAR + 1 }));
    expect(codesOf(r)).toEqual(["FISCAL_YEAR_OUT_OF_RANGE"]);
  });

  it("accepts the first and last supported years at the boundary", () => {
    const first = validateCogsInput(
      input({
        fiscalYear: SYSTEM_START_YEAR,
        positionElection: { ...GOOD_ELECTION, fiscalYear: SYSTEM_START_YEAR },
      }),
    );
    expect(codesOf(first)).not.toContain("FISCAL_YEAR_OUT_OF_RANGE");
    const last = validateCogsInput(
      input({
        fiscalYear: LAST_SUPPORTED_YEAR,
        positionElection: { ...GOOD_ELECTION, fiscalYear: LAST_SUPPORTED_YEAR },
      }),
    );
    expect(codesOf(last)).not.toContain("FISCAL_YEAR_OUT_OF_RANGE");
  });

  it("refuses a negative money field", () => {
    const r = validateCogsInput(input({ purchasesCents: -1 }));
    expect(codesOf(r)).toContain("NEGATIVE_AMOUNT");
  });

  it("refuses a fractional money field", () => {
    const r = validateCogsInput(input({ beginningInventoryCents: 10.5 }));
    expect(codesOf(r)).toContain("NOT_INTEGER_CENTS");
  });

  it("refuses an allocable bucket with no stated allocation basis", () => {
    const r = validateCogsInput(
      input({
        costBuckets: [
          { label: "Mystery overhead", amountCents: 500_00, character: "allocable", allocationBasis: null },
        ],
      }),
    );
    expect(codesOf(r)).toContain("COST_ALLOCATION_UNEXPLAINED");
  });

  it("refuses an allocable bucket whose basis is only whitespace", () => {
    const r = validateCogsInput(
      input({
        costBuckets: [
          { label: "Vague", amountCents: 500_00, character: "allocable", allocationBasis: "   " },
        ],
      }),
    );
    expect(codesOf(r)).toContain("COST_ALLOCATION_UNEXPLAINED");
  });

  it("does NOT demand an allocation basis for a direct cost", () => {
    const r = validateCogsInput(
      input({
        costBuckets: [
          { label: "Freight", amountCents: 500_00, character: "direct", allocationBasis: null },
        ],
      }),
    );
    expect(codesOf(r)).not.toContain("COST_ALLOCATION_UNEXPLAINED");
  });

  it("refuses an uncounted ending inventory", () => {
    expect(codesOf(validateCogsInput(input({ endingInventoryWasCounted: false })))).toContain(
      "INVENTORY_NOT_COUNTED",
    );
  });

  it("refuses an ending inventory nobody has answered for", () => {
    expect(codesOf(validateCogsInput(input({ endingInventoryWasCounted: null })))).toContain(
      "INVENTORY_NOT_COUNTED",
    );
  });

  it("refuses a missing line 9a valuation method", () => {
    expect(codesOf(validateCogsInput(input({ valuationMethod: null })))).toContain(
      "VALUATION_METHOD_MISSING",
    );
  });

  it("refuses an unanswered line 9e §263A question", () => {
    expect(codesOf(validateCogsInput(input({ section263AApplies: null })))).toContain(
      "SECTION_263A_ANSWER_MISSING",
    );
  });

  it("refuses an unanswered line 9f", () => {
    expect(
      codesOf(validateCogsInput(input({ changeInQuantitiesCostOrValuations: null }))),
    ).toContain("QUANTITY_OR_VALUATION_CHANGE_UNEXPLAINED");
  });

  it("refuses a yes on line 9f with no explanation attached", () => {
    const r = validateCogsInput(
      input({ changeInQuantitiesCostOrValuations: true, changeExplanation: "  " }),
    );
    expect(codesOf(r)).toContain("QUANTITY_OR_VALUATION_CHANGE_UNEXPLAINED");
  });

  it("accepts a yes on line 9f WITH an explanation, and points at §446(e)", () => {
    const r = validateCogsInput(
      input({
        changeInQuantitiesCostOrValuations: true,
        changeExplanation: "Switched from weighted average to specific identification for concentrates.",
      }),
    );
    expect(codesOf(r)).not.toContain("QUANTITY_OR_VALUATION_CHANGE_UNEXPLAINED");
  });

  it("refuses licence facts that contradict RCW 69.50.328", () => {
    const r = validateCogsInput(
      input({
        licences: { holdsRetailLicence: true, holdsProducerLicence: true, holdsProcessorLicence: false },
      }),
    );
    expect(codesOf(r)).toContain("PRODUCER_CLAIM_CONTRADICTS_STATE_LICENCE");
  });

  it("refuses when no licence is recorded at all", () => {
    const r = validateCogsInput(
      input({
        licences: { holdsRetailLicence: false, holdsProducerLicence: false, holdsProcessorLicence: false },
      }),
    );
    expect(codesOf(r)).toContain("TAXPAYER_ROLE_UNKNOWN");
  });

  it("reports every problem at once rather than one at a time", () => {
    const r = validateCogsInput(
      input({
        valuationMethod: null,
        section263AApplies: null,
        endingInventoryWasCounted: null,
        positionElection: null,
      }),
    );
    expect(r.length).toBeGreaterThanOrEqual(4);
  });

  it("every refusal carries a remedy, never a bare complaint", () => {
    const r = validateCogsInput(
      input({
        valuationMethod: null,
        section263AApplies: null,
        endingInventoryWasCounted: null,
        positionElection: null,
        changeInQuantitiesCostOrValuations: null,
      }),
    );
    expect(r.length).toBeGreaterThan(0);
    for (const x of r) {
      expect(x.message.length).toBeGreaterThan(20);
      expect(x.whatToDo.length).toBeGreaterThan(20);
    }
  });

  it("every emitted code is a declared code", () => {
    const r = validateCogsInput(
      input({
        purchasesCents: -1,
        valuationMethod: null,
        section263AApplies: null,
        endingInventoryWasCounted: null,
        positionElection: null,
        changeInQuantitiesCostOrValuations: null,
      }),
    );
    for (const x of r) expect(ALL_COGS_REFUSAL_CODES).toContain(x.code);
  });
});

// ---------------------------------------------------------------------------
// 8) THE §280E SWITCH — STANDING RULE 8
// ---------------------------------------------------------------------------

describe("the §280E sunset is a switch, not a rebuild", () => {
  it("applies indefinitely when no repeal year is set", () => {
    expect(section280EAppliesTo(input())).toBe(true);
  });

  it("still applies in the final restricted year itself", () => {
    expect(
      section280EAppliesTo(input({ fiscalYear: 2027, section280ERepealEffectiveForYearsAfter: 2027 })),
    ).toBe(true);
  });

  it("stops applying the year after the sunset year", () => {
    expect(
      section280EAppliesTo(input({ fiscalYear: 2028, section280ERepealEffectiveForYearsAfter: 2027 })),
    ).toBe(false);
  });

  it("is not retroactive: an earlier year stays restricted", () => {
    expect(
      section280EAppliesTo(input({ fiscalYear: 2026, section280ERepealEffectiveForYearsAfter: 2027 })),
    ).toBe(true);
  });

  it("changes the narrative from permanent loss to timing", () => {
    const before = comparePositions(input());
    const after = comparePositions(input({ section280ERepealEffectiveForYearsAfter: 2025 }));
    expect(before.plainEnglish).toContain("disappear");
    expect(after.plainEnglish).toContain("timing difference");
  });
});

// ---------------------------------------------------------------------------
// 9) METHOD CHANGE ADVICE
// ---------------------------------------------------------------------------

describe("advice on changing the method", () => {
  it("twelve consistent years is a method, not an error", () => {
    expect(adviseOnMethodChange(FACTS).isMethodNotError).toBe(true);
  });

  it("two consistent years is already a method", () => {
    expect(adviseOnMethodChange({ ...FACTS, yearsTreatmentUsedConsistently: 2 }).isMethodNotError).toBe(
      true,
    );
  });

  it("a single year may still be a correctable error", () => {
    expect(adviseOnMethodChange({ ...FACTS, yearsTreatmentUsedConsistently: 1 }).isMethodNotError).toBe(
      false,
    );
  });

  it("finds audit protection available when not under exam and never raised", () => {
    expect(adviseOnMethodChange(FACTS).auditProtectionLikelyAvailable).toBe(true);
  });

  it("finds it unavailable once under examination", () => {
    expect(
      adviseOnMethodChange({ ...FACTS, underExamination: true }).auditProtectionLikelyAvailable,
    ).toBe(false);
  });

  it("finds it unavailable once the issue has been raised", () => {
    expect(
      adviseOnMethodChange({ ...FACTS, cogsRaisedByIrs: true }).auditProtectionLikelyAvailable,
    ).toBe(false);
  });

  it("refuses to guess when the examination status is unknown", () => {
    expect(
      adviseOnMethodChange({ ...FACTS, underExamination: null }).auditProtectionLikelyAvailable,
    ).toBeNull();
  });

  it("refuses to guess when it is unknown whether the issue was raised", () => {
    expect(
      adviseOnMethodChange({ ...FACTS, cogsRaisedByIrs: null }).auditProtectionLikelyAvailable,
    ).toBeNull();
  });

  it("spreads a positive adjustment over four years, per §7.03(1)", () => {
    expect(adviseOnMethodChange({ ...FACTS, cumulativeDifferenceCents: 90_000_00 }).adjustmentPeriodYears).toBe(4);
  });

  it("takes a negative adjustment in one year, per §7.03(1)", () => {
    expect(adviseOnMethodChange({ ...FACTS, cumulativeDifferenceCents: -5_000_00 }).adjustmentPeriodYears).toBe(1);
  });

  it("treats a zero adjustment as a single year", () => {
    expect(adviseOnMethodChange({ ...FACTS, cumulativeDifferenceCents: 0 }).adjustmentPeriodYears).toBe(1);
  });

  it("offers the de minimis election just under $50,000", () => {
    expect(
      adviseOnMethodChange({ ...FACTS, cumulativeDifferenceCents: 49_999_99 }).deMinimisElectionAvailable,
    ).toBe(true);
  });

  it("does NOT offer it at exactly $50,000 — the rule says 'less than'", () => {
    expect(
      adviseOnMethodChange({ ...FACTS, cumulativeDifferenceCents: 50_000_00 }).deMinimisElectionAvailable,
    ).toBe(false);
  });

  it("does not offer it for a negative adjustment, which is already one year", () => {
    expect(
      adviseOnMethodChange({ ...FACTS, cumulativeDifferenceCents: -1_00 }).deMinimisElectionAvailable,
    ).toBe(false);
  });

  it("refuses to guess the period when the adjustment is uncomputed", () => {
    const a = adviseOnMethodChange({ ...FACTS, cumulativeDifferenceCents: null });
    expect(a.adjustmentPeriodYears).toBeNull();
    expect(a.deMinimisElectionAvailable).toBeNull();
  });

  it("gives five ordered steps, each with a why and an authority", () => {
    const a = adviseOnMethodChange(FACTS);
    expect(a.steps.map((s) => s.step)).toEqual([1, 2, 3, 4, 5]);
    for (const s of a.steps) {
      expect(s.why.length).toBeGreaterThan(30);
      expect(s.authorityIds.length).toBeGreaterThan(0);
    }
  });

  it("tells the owner NOT to simply start doing it right next year", () => {
    const a = adviseOnMethodChange(FACTS);
    expect(a.steps[1].what).toContain("Do NOT simply start");
  });

  it("makes the audit-protection argument explicitly when it is available", () => {
    expect(adviseOnMethodChange(FACTS).theCase).toContain("AVAILABLE today");
  });

  it("says plainly when the protection has already been lost", () => {
    expect(adviseOnMethodChange({ ...FACTS, underExamination: true }).theCase).toContain(
      "NOT available",
    );
  });

  it("does not claim protection either way when the facts are unknown", () => {
    const c = adviseOnMethodChange({ ...FACTS, underExamination: null }).theCase;
    expect(c).toContain("cannot be assessed");
  });

  it("cites §446(f) so the 'I never asked' argument is closed on the page", () => {
    expect(adviseOnMethodChange(FACTS).theCase).toContain("446(f)");
  });
});

// ---------------------------------------------------------------------------
// 10) THE ENTRY POINT
// ---------------------------------------------------------------------------

describe("computeCogsPosition", () => {
  it("returns the full picture on clean input", () => {
    const r = computeCogsPosition(input(), FACTS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.role).toBe("reseller");
    expect(r.comparison.additionalCogsClaimedCents).toBe(260_800_00);
    expect(r.advice.steps).toHaveLength(5);
  });

  it("files the as-filed form when that is what was elected", () => {
    const r = computeCogsPosition(input(), FACTS);
    if (!r.ok) throw new Error("expected ok");
    expect(r.filed.position).toBe("as_filed");
    expect(r.filed.costOfGoodsSoldCents).toBe(1_531_870_00);
  });

  it("files the conservative form when that is what was elected", () => {
    const r = computeCogsPosition(
      // form3115FiledForChange: true because moving to the conservative
      // treatment IS a change of method, and §446(e) requires consent first.
      input({
        positionElection: { ...GOOD_ELECTION, position: "conservative" },
        form3115FiledForChange: true,
      }),
      FACTS,
    );
    if (!r.ok) throw new Error("expected ok");
    expect(r.filed.position).toBe("conservative");
    expect(r.filed.costOfGoodsSoldCents).toBe(1_271_070_00);
  });

  it("computes NOTHING when anything is missing", () => {
    const r = computeCogsPosition(input({ positionElection: null }), FACTS);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(codesOf(r.refusals)).toContain("POSITION_NOT_ELECTED");
    expect(r).not.toHaveProperty("filed");
  });

  it("still shows both computations even when the aggressive one is filed", () => {
    const r = computeCogsPosition(input(), FACTS);
    if (!r.ok) throw new Error("expected ok");
    expect(r.comparison.conservative.costOfGoodsSoldCents).toBe(1_271_070_00);
    expect(r.comparison.asFiled.costOfGoodsSoldCents).toBe(1_531_870_00);
  });
});

// ---------------------------------------------------------------------------
// 11) AUTHORITIES AND REGISTRY WIRING — STANDING RULE 25
// ---------------------------------------------------------------------------

describe("authorities are wired into the one registry", () => {
  it("declares the expected number of new authorities", () => {
    expect(COGS_POSITION_AUTHORITIES_NEW).toHaveLength(15);
  });

  it("every new authority is reachable through findGuidanceAuthority", () => {
    for (const a of COGS_POSITION_AUTHORITIES_NEW) {
      expect(findGuidanceAuthority(a.id), `${a.id} not reachable`).toBeTruthy();
    }
  });

  it("every authority the engine cites actually exists in the registry", () => {
    const r = computeCogsPosition(input(), FACTS);
    if (!r.ok) throw new Error("expected ok");
    for (const id of r.advice.authorityIds) {
      expect(findGuidanceAuthority(id), `${id} missing`).toBeTruthy();
    }
    for (const s of r.advice.steps) {
      for (const id of s.authorityIds) {
        expect(findGuidanceAuthority(id), `${id} missing`).toBeTruthy();
      }
    }
  });

  it("every authority cited by a refusal exists in the registry", () => {
    const r = validateCogsInput(
      input({
        valuationMethod: null,
        section263AApplies: null,
        endingInventoryWasCounted: null,
        positionElection: null,
        changeInQuantitiesCostOrValuations: null,
        licences: { holdsRetailLicence: false, holdsProducerLicence: false, holdsProcessorLicence: false },
      }),
    );
    for (const x of r) {
      for (const id of x.authorityIds) {
        expect(findGuidanceAuthority(id), `${id} missing`).toBeTruthy();
      }
    }
  });

  it("every authority cited by a mentor lesson exists in the registry", () => {
    for (const l of COGS_POSITION_LESSONS) {
      for (const id of l.authorityIds) {
        expect(findGuidanceAuthority(id), `${id} missing from lesson ${l.fn}`).toBeTruthy();
      }
    }
  });

  it("no new authority duplicates an id declared elsewhere with different text", () => {
    for (const a of COGS_POSITION_AUTHORITIES_NEW) {
      const merged = findGuidanceAuthority(a.id);
      expect(merged?.quote).toBe(a.quote);
    }
  });

  it("carries the §8.01 audit protection sentence verbatim", () => {
    const a = findGuidanceAuthority("REVPROC_2015_13_AUDIT_PROTECTION");
    expect(a?.quote).toContain(
      "the IRS will not require the taxpayer to change its method of accounting for the same item",
    );
  });

  it("carries the §1.446-1(e)(2)(i) 'whether or not proper' sentence verbatim", () => {
    const a = findGuidanceAuthority("REG_1_446_1_E_2_I_PROPER_OR_NOT");
    expect(a?.quote).toContain("whether or not such method is proper");
  });

  it("carries the RCW 69.50.328 prohibition verbatim", () => {
    const a = findGuidanceAuthority("RCW_69_50_328_NO_CROSS_OWNERSHIP");
    expect(a?.quote).toContain(
      "shall have a direct or indirect financial interest in a licensed cannabis retailer",
    );
  });

  it("presents the consistency argument that cuts in the owner's favour", () => {
    const a = findGuidanceAuthority("REG_1_471_2_B_CONSISTENCY_WEIGHT");
    expect(a?.quote).toContain("greater weight is to be given to consistency");
    // ...and does not oversell it: the soWhat must state the limiting clause.
    expect(a?.soWhat).toContain("1.471-11");
  });
});

// ---------------------------------------------------------------------------
// 12) MENTOR LAYER — STANDING RULES 26, 39
// ---------------------------------------------------------------------------

describe("mentor coverage", () => {
  it("teaches every exported function of the core module", () => {
    expect(() => assertEveryCogsFunctionIsTaught()).not.toThrow();
  });

  it("every lesson is substantive in all four fields", () => {
    expect(() => assertEveryCogsLessonIsSubstantive()).not.toThrow();
  });

  it("teaches exactly the exported set, with nothing taught that does not exist", () => {
    const exported = new Set(exportedCogsFunctionNames());
    for (const t of taughtCogsFunctionNames()) expect(exported.has(t)).toBe(true);
  });

  it("THE GATE FIRES: an untaught export is caught (rule 39, real file)", () => {
    // Point the gate at a file it does not know, and prove it complains.
    // basis-aaa-core.ts exports functions no COGS lesson covers.
    expect(() =>
      assertEveryCogsFunctionIsTaught("src/lib/accounting/basis-aaa-core.ts"),
    ).toThrow(/COGS MENTOR COVERAGE GAP/);
  });

  it("THE GATE FIRES: a file with no exports is treated as a broken gate", () => {
    expect(() =>
      assertEveryCogsFunctionIsTaught("docs/authorities/state-wa/rcw-69.50.328.txt"),
    ).toThrow(/COGS MENTOR COVERAGE GATE BROKEN/);
  });

  it("THE GATE FIRES: an empty lesson list is not a pass", () => {
    expect(() => assertEveryCogsLessonIsSubstantive([])).toThrow(/COGS MENTOR GATE BROKEN/);
  });

  it("THE GATE FIRES: a thin lesson is caught", () => {
    expect(() =>
      assertEveryCogsLessonIsSubstantive([
        {
          fn: "x",
          plainEnglish: "short",
          whyItExists: "short",
          theTrap: "short",
          whatIWouldDo: "short",
          authorityIds: [],
        },
      ]),
    ).toThrow(/COGS MENTOR LESSONS TOO THIN/);
  });
});

// ---------------------------------------------------------------------------
// 13) THE OWNER'S POSITION IS RECORDED, NOT BLESSED AND NOT BLOCKED
// ---------------------------------------------------------------------------

describe("the system neither refuses to operate nor silently agrees", () => {
  it("computes a complete return under the aggressive position", () => {
    const r = computeCogsPosition(input(), FACTS);
    expect(r.ok).toBe(true);
  });

  it("never returns the filed number without the conservative one beside it", () => {
    const r = computeCogsPosition(input(), FACTS);
    if (!r.ok) throw new Error("expected ok");
    expect(r.comparison.conservative).toBeTruthy();
    expect(r.comparison.asFiled).toBeTruthy();
    expect(r.comparison.plainEnglish.length).toBeGreaterThan(100);
  });

  it("always ships the argument for doing it properly, even when nothing is wrong", () => {
    const r = computeCogsPosition(
      // form3115FiledForChange: true because moving to the conservative
      // treatment IS a change of method, and §446(e) requires consent first.
      input({
        positionElection: { ...GOOD_ELECTION, position: "conservative" },
        form3115FiledForChange: true,
      }),
      FACTS,
    );
    if (!r.ok) throw new Error("expected ok");
    expect(r.advice.theCase).toContain("446(f)");
  });
});

// ---------------------------------------------------------------------------
// 14) THE DEFECT THE RULE 38 PROBE FOUND
//
// Before any test in this file existed, the probe was run and its output read
// as an auditor would read it. It showed the CONSERVATIVE cost of goods sold
// changing when the §280E repeal switch was thrown — rising from $1,271,070 to
// $1,531,870 and closing the gap to zero.
//
// That was a real engine defect, and a dangerous one, because it looked like
// good news. Repealing §280E does not amend §471. §280E denies "deduction or
// credit" and never mentions inventories; §1.471-3 never mentions §280E. So
// repeal cannot make a budtender's wage inventoriable. It makes it deductible
// under §162 instead of disallowed. The engine had closed the gap by bending
// the conservative yardstick rather than by removing the exposure.
//
// These tests exist so that defect cannot return.
// ---------------------------------------------------------------------------

describe("§280E repeal does not change what §471 allows into inventory", () => {
  it("the conservative figure is IDENTICAL before and after repeal", () => {
    const before = computeForm1125A(input(), "conservative");
    const after = computeForm1125A(
      input({ section280ERepealEffectiveForYearsAfter: 2025 }),
      "conservative",
    );
    expect(after.costOfGoodsSoldCents).toBe(before.costOfGoodsSoldCents);
  });

  it("the conservative position still excludes allocable costs after repeal", () => {
    const b = bucketsForPosition(input({ section280ERepealEffectiveForYearsAfter: 2025 }), "conservative");
    expect(b.every((x) => x.character === "direct")).toBe(true);
  });

  it("the gap SURVIVES repeal rather than collapsing to zero", () => {
    const after = comparePositions(input({ section280ERepealEffectiveForYearsAfter: 2025 }));
    expect(after.additionalCogsClaimedCents).toBe(260_800_00);
  });

  it("but the gap is reframed as timing, not as permanent disallowance", () => {
    const after = comparePositions(input({ section280ERepealEffectiveForYearsAfter: 2025 }));
    expect(after.section280EApplies).toBe(false);
    expect(after.plainEnglish).toContain("162");
    expect(after.plainEnglish).toContain("timing difference");
  });

  it("and still warns that moving the costs out is itself a method change", () => {
    const after = comparePositions(input({ section280ERepealEffectiveForYearsAfter: 2025 }));
    expect(after.plainEnglish).toContain("446(e)");
  });
});

// ---------------------------------------------------------------------------
// 15) WHAT THE SECOND HOSTILE PROBE FOUND (standing rules 38, 40, 23)
//
// Section 14 recorded what the FIRST probe found. This section records the
// second, which was deliberately hostile rather than illustrative: it attacked
// boundaries, degenerate inputs, and the acknowledgement mechanism itself.
// It found three real defects that 116 passing tests had not.
//
// Every test below was watched go red against the pre-fix engine before being
// kept (standing rule 15).
// ---------------------------------------------------------------------------

describe("probe 2 finding A: an authority id must be an AUTHORITY id", () => {
  // The refusal that tells the owner to count inventory cited
  // "INVENTORY_COUNTED" — which is real, but is a PERIOD-CLOSE CHECK id from
  // period-close-core.ts, not a GuidanceAuthority id. Two namespaces, both
  // SCREAMING_SNAKE, and one leaked into the other. Invisible to the compiler
  // because authorityIds is readonly string[]; invisible to the eye because it
  // looks exactly like an authority id. Only visible at the moment the owner
  // clicks "why?" and gets an empty panel.
  //
  // Fixed here, and the CLASS is fixed by the permanent repo-wide tripwire in
  // tests/compliance/authority-id-resolution.test.ts (standing rule 23).
  it("the count-inventory refusal cites only ids that resolve", () => {
    const r = validateCogsInput(input({ endingInventoryWasCounted: false }));
    const counted = r.find((x) => x.code === "INVENTORY_NOT_COUNTED");
    expect(counted).toBeTruthy();
    for (const id of counted!.authorityIds) {
      expect(findGuidanceAuthority(id), `${id} does not resolve`).toBeTruthy();
    }
  });

  it("specifically, it no longer cites the period-close check id", () => {
    const r = validateCogsInput(input({ endingInventoryWasCounted: false }));
    const counted = r.find((x) => x.code === "INVENTORY_NOT_COUNTED")!;
    expect(counted.authorityIds).not.toContain("INVENTORY_COUNTED");
  });
});

describe("probe 2 finding B: three different failures need three different codes", () => {
  // A missing reason, a missing decider, and never having been shown the
  // conservative number are three distinct facts about the record, and the
  // screen has to be able to highlight the right field for each. All three
  // returned POSITION_ACKNOWLEDGEMENT_NO_REASON, so the code — which is the
  // machine-readable half of the contract — was lying about two of them. The
  // message was lying too: it said "has no stated reason" about an election
  // whose reason was perfectly good.
  const el = (over: Partial<PositionElection>): PositionElection => ({
    ...GOOD_ELECTION,
    ...over,
  });

  it("a missing decider is NO_DECIDER, not NO_REASON", () => {
    const r = validatePositionElection(el({ decidedBy: "   " }), 2026);
    expect(codesOf(r)).toEqual(["POSITION_ACKNOWLEDGEMENT_NO_DECIDER"]);
  });

  it("a missing reason is still NO_REASON", () => {
    const r = validatePositionElection(el({ reason: "" }), 2026);
    expect(codesOf(r)).toEqual(["POSITION_ACKNOWLEDGEMENT_NO_REASON"]);
  });

  it("never having been shown the number is AMOUNT_NOT_SHOWN", () => {
    const r = validatePositionElection(
      el({ acknowledgedConservativeAmountCents: null }),
      2026,
    );
    expect(codesOf(r)).toEqual(["POSITION_ACKNOWLEDGEMENT_AMOUNT_NOT_SHOWN"]);
  });

  it("the three codes are genuinely distinct", () => {
    const a = codesOf(validatePositionElection(el({ decidedBy: "" }), 2026))[0];
    const b = codesOf(validatePositionElection(el({ reason: "" }), 2026))[0];
    const c = codesOf(
      validatePositionElection(el({ acknowledgedConservativeAmountCents: null }), 2026),
    )[0];
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("each new code is declared in the exported code list", () => {
    expect(ALL_COGS_REFUSAL_CODES).toContain("POSITION_ACKNOWLEDGEMENT_NO_DECIDER");
    expect(ALL_COGS_REFUSAL_CODES).toContain("POSITION_ACKNOWLEDGEMENT_AMOUNT_NOT_SHOWN");
  });

  it("choosing conservative does not require having been shown the number", () => {
    // The acknowledgement exists to prove the owner saw the alternative before
    // taking the aggressive position. Choosing the conservative one IS the
    // alternative, so there is nothing to warn him away from.
    const r = validatePositionElection(
      el({ position: "conservative", acknowledgedConservativeAmountCents: null }),
      2026,
    );
    expect(r).toEqual([]);
  });
});

describe("probe 2 finding C: a declared refusal that never fires (rule 40)", () => {
  // ENDING_INVENTORY_EXCEEDS_AVAILABLE was declared in the refusal-code union
  // AND in ALL_COGS_REFUSAL_CODES, but no line of the engine ever emitted it.
  // A guard that cannot fire is not a guard; it is a comment that type-checks.
  // The probe drove closing inventory above everything available and the
  // engine cheerfully reported a cost of goods sold of MINUS $899,999.
  //
  // Rule 40: an unreachable guard is an untested guard — give it a door.
  const impossible = () =>
    input({
      beginningInventoryCents: 0,
      purchasesCents: 1_00,
      endingInventoryCents: 900_000_00,
      costBuckets: [],
    });

  it("refuses when closing inventory exceeds everything available", () => {
    expect(codesOf(validateCogsInput(impossible()))).toContain(
      "ENDING_INVENTORY_EXCEEDS_AVAILABLE",
    );
  });

  it("the refusal names both figures so the owner can see the mismatch", () => {
    const r = validateCogsInput(impossible()).find(
      (x) => x.code === "ENDING_INVENTORY_EXCEEDS_AVAILABLE",
    )!;
    expect(r.message).toContain("$900,000.00");
    expect(r.message).toContain("$1.00");
  });

  it("it tells him to find the cause rather than plug the number", () => {
    const r = validateCogsInput(impossible()).find(
      (x) => x.code === "ENDING_INVENTORY_EXCEEDS_AVAILABLE",
    )!;
    expect(r.whatToDo).toContain("Do not adjust a number");
  });

  it("the test is measured against the CONSERVATIVE pool, not the as-filed one", () => {
    // The conservative pool is the smaller of the two and is therefore the
    // binding constraint. If the as-filed pool were used, allocable costs
    // could paper over an impossible conservative figure and the guard would
    // stay silent on exactly the computation the slice exists to protect.
    const justOverConservative = input({
      beginningInventoryCents: 0,
      purchasesCents: 0,
      endingInventoryCents: 40_020_01,
      costBuckets: [
        { label: "Direct", amountCents: 40_020_00, character: "direct", allocationBasis: null },
        { label: "Allocable", amountCents: 500_000_00, character: "allocable", allocationBasis: "x" },
      ],
    });
    expect(codesOf(validateCogsInput(justOverConservative))).toContain(
      "ENDING_INVENTORY_EXCEEDS_AVAILABLE",
    );
  });

  it("does NOT fire when closing inventory exactly equals what was available", () => {
    // Equality is possible in the real world — nothing sold — and a guard that
    // fires on a legitimate boundary is worse than no guard, because it trains
    // the owner to click past it.
    const exact = input({
      beginningInventoryCents: 0,
      purchasesCents: 500_00,
      endingInventoryCents: 500_00,
      costBuckets: [],
    });
    expect(codesOf(validateCogsInput(exact))).not.toContain(
      "ENDING_INVENTORY_EXCEEDS_AVAILABLE",
    );
  });

  it("and the resulting cost of goods sold is exactly zero, not negative", () => {
    const exact = input({
      beginningInventoryCents: 0,
      purchasesCents: 500_00,
      endingInventoryCents: 500_00,
      costBuckets: [],
    });
    expect(computeForm1125A(exact, "conservative").costOfGoodsSoldCents).toBe(0);
  });
});

describe("probe 2 finding D: every declared refusal code can actually fire", () => {
  // The generalisation of finding C. A refusal code that no code path emits is
  // dead law: it looks like protection in review and provides none in use.
  // This test does not check that each code fires on some hand-picked input —
  // that would just re-implement the engine (rule 39). It checks the cheaper
  // and stronger property that every declared code appears somewhere in the
  // engine's own source as an emitted code.
  it("no declared code is dead", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    const src = readFileSync(
      join(__dirname, "..", "..", "src", "lib", "accounting", "cogs-position-core.ts"),
      "utf8",
    );
    // Guard against a vacuous read (rule 39).
    expect(src.length).toBeGreaterThan(5_000);

    // A code may be emitted either directly (`code: "X"`) or as a branch of a
    // ternary (`? "X"` / `: "X"`). Matching only the first form produced two
    // false positives on the first run of this very test — which is a fair
    // reminder that a detector is a suspect too (standing rule 22).
    const emitted = (code: string): boolean =>
      src.includes(`code: "${code}"`) ||
      src.includes(`? "${code}"`) ||
      src.includes(`: "${code}"`);
    const dead = ALL_COGS_REFUSAL_CODES.filter((code) => !emitted(code));
    expect(dead, `declared but never emitted: ${dead.join(", ")}`).toEqual([]);
  });
});

describe("probe 2 finding E: §446(e) consent — the guard that was declared and never fired", () => {
  // METHOD_CHANGE_WITHOUT_CONSENT was in the code union and in
  // ALL_COGS_REFUSAL_CODES from the day the file was written, and no line of
  // the engine ever emitted it. It could not have: the input type carried no
  // prior-year position, so the engine had nothing to compare this year's
  // election against.
  //
  // This is the most consequential dead guard in the slice. §446(e) is the
  // sentence that defeats the plan every taxpayer in this position has, which
  // is "we will just start doing it right next year and say nothing about the
  // old years." Without this refusal, the screen would have let Michael tick
  // "conservative" after twelve years of the historical treatment and file it
  // believing he had finally done the right thing — when what he would have
  // done is make an unauthorised change of method, forfeit the audit
  // protection that a voluntary Form 3115 would have bought him, and leave the
  // §481(a) adjustment for the earlier years hanging.

  const changing = (over: Partial<CogsYearInput> = {}) =>
    input({
      priorYearPosition: "as_filed",
      positionElection: { ...GOOD_ELECTION, position: "conservative" },
      form3115FiledForChange: null,
      ...over,
    });

  it("refuses a change of position with no Form 3115", () => {
    expect(codesOf(validateCogsInput(changing()))).toContain("METHOD_CHANGE_WITHOUT_CONSENT");
  });

  it("treats an UNKNOWN Form 3115 as a no, because §446(e) requires consent first", () => {
    const r = validateCogsInput(changing({ form3115FiledForChange: null })).find(
      (x) => x.code === "METHOD_CHANGE_WITHOUT_CONSENT",
    )!;
    expect(r.message).toContain("not known whether one was filed");
  });

  it("an explicit 'no Form 3115' is refused without the unknown wording", () => {
    const r = validateCogsInput(changing({ form3115FiledForChange: false })).find(
      (x) => x.code === "METHOD_CHANGE_WITHOUT_CONSENT",
    )!;
    expect(r.message).not.toContain("not known whether one was filed");
  });

  it("allows the change once consent has been secured", () => {
    expect(
      codesOf(validateCogsInput(changing({ form3115FiledForChange: true }))),
    ).not.toContain("METHOD_CHANGE_WITHOUT_CONSENT");
  });

  // STANDING RULE 34: the gate must run in BOTH directions.
  it("FIRES ON THE CHANGE TOWARDS THE CONSERVATIVE TREATMENT", () => {
    const r = validateCogsInput(changing()).find(
      (x) => x.code === "METHOD_CHANGE_WITHOUT_CONSENT",
    )!;
    expect(r.message).toContain("toward the conservative computation");
  });

  it("AND FIRES ON THE CHANGE AWAY FROM IT", () => {
    const away = input({
      priorYearPosition: "conservative",
      positionElection: { ...GOOD_ELECTION, position: "as_filed" },
      form3115FiledForChange: false,
    });
    const r = validateCogsInput(away).find(
      (x) => x.code === "METHOD_CHANGE_WITHOUT_CONSENT",
    )!;
    expect(r).toBeTruthy();
    expect(r.message).toContain("away from the conservative computation");
  });

  it("stays silent when the position has not changed", () => {
    expect(
      codesOf(
        validateCogsInput(
          input({ priorYearPosition: "as_filed", form3115FiledForChange: null }),
        ),
      ),
    ).not.toContain("METHOD_CHANGE_WITHOUT_CONSENT");
  });

  it("stays silent in the first year, where there is nothing to change from", () => {
    expect(
      codesOf(
        validateCogsInput(
          input({
            priorYearPosition: null,
            positionElection: { ...GOOD_ELECTION, position: "conservative" },
          }),
        ),
      ),
    ).not.toContain("METHOD_CHANGE_WITHOUT_CONSENT");
  });

  it("tells him the correct route rather than merely blocking him", () => {
    // Standing rule 27 is refuse, don't warn — but a refusal with no exit is
    // just an obstacle. The whole value of the voluntary change is the audit
    // protection, so the refusal has to say so.
    const r = validateCogsInput(changing()).find(
      (x) => x.code === "METHOD_CHANGE_WITHOUT_CONSENT",
    )!;
    expect(r.whatToDo).toContain("3115");
    expect(r.whatToDo).toContain("481(a)");
    expect(r.whatToDo).toContain("audit protection");
  });

  it("cites §446(e), the inventory-valuation method rule, §481(a) and §8.01", () => {
    const r = validateCogsInput(changing()).find(
      (x) => x.code === "METHOD_CHANGE_WITHOUT_CONSENT",
    )!;
    expect(r.authorityIds).toEqual([
      "IRC_446_E_CONSENT_REQUIRED",
      "REG_1_446_1_E_2_II_A_INVENTORY_VALUATION",
      "IRC_481_A_ADJUSTMENT",
      "REVPROC_2015_13_AUDIT_PROTECTION",
    ]);
    for (const id of r.authorityIds) expect(findGuidanceAuthority(id)).toBeTruthy();
  });
});
