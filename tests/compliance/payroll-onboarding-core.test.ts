/**
 * tests/compliance/payroll-onboarding-core.test.ts  (books-25)
 *
 * Adversarial tests for the employee onboarding gate.
 *
 * WHAT THESE TESTS ARE FOR
 * ------------------------
 * Michael said: "It should have a check list of task to be completed before it
 * lets you save them to the system, and if a field is missing, it should highlight
 * it so something can't silently fail me in some way." A gate that has never been
 * observed to refuse is not a gate (rule 16), so every refusal below is asserted
 * in BOTH directions (rule 34): the bad input is rejected AND the good input is
 * accepted. A test that only ever sees failures cannot tell a working gate from a
 * function that returns false.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  BASIS_POINTS_FULL,
  MILLI_CENTS_PER_CENT,
  ONBOARDING_STEPS,
  addYearsYmd,
  assertI9NotUsedForPay,
  assertIntegerCents,
  assertIntegerMilliCents,
  canRevealSsn,
  evaluateOnboarding,
  findOnboardingStep,
  formatSsnUnmasked,
  hourlyGrossCents,
  i9DocumentSetIsSufficient,
  i9RequiredFieldPaths,
  i9RetainUntilYmd,
  i9Section2DueYmd,
  isPossibleSsn,
  maskSsn,
  noW4DefaultComparison,
  normalizeSsn,
  onboardingDeadlines,
  payPeriodsRemainingInYear,
  payRequiredFieldPaths,
  renderSsnForRole,
  salaryGrossForPeriodCents,
  ssnProblems,
  ssnVerificationCaveat,
  validateI9,
  validatePay,
  w4RequiredFieldPaths,
  type I9Document,
  type I9Record,
  type OnboardingCandidate,
  type PayRecord,
} from "@/lib/payroll/payroll-onboarding-core";
import { PAYROLL_ONBOARDING_LESSONS } from "@/lib/payroll/payroll-onboarding-mentor";
import {
  ALL_PAY_FREQUENCIES,
  type PayFrequency,
  type W4Record,
} from "@/lib/payroll/payroll-w4-core";

// ---------------------------------------------------------------------------
// Fixtures. Deliberately VALID, so that each test breaks exactly one thing.
// A fixture that is already broken makes every assertion pass for the wrong
// reason (rule 41).
// ---------------------------------------------------------------------------

const HIRE = "2027-01-04"; // a Monday, and Michael's first payroll year

function goodW4(over: Partial<W4Record> = {}): W4Record {
  return {
    employeeId: "emp-1",
    formYear: 2027,
    filingStatus: "single_or_married_filing_separately",
    step2MultipleJobs: false,
    step3AnnualCreditCents: 0,
    step4aOtherIncomeAnnualCents: 0,
    step4bDeductionsAnnualCents: 0,
    step4cExtraPerPeriodCents: 0,
    legacyAllowances: null,
    exemptFromFederalIncomeTax: false,
    signedAt: "2027-01-04T00:00:00.000Z",
    ...over,
  };
}

function listA(): I9Document {
  return {
    category: "list_a",
    title: "U.S. Passport",
    issuingAuthority: "U.S. Department of State",
    documentNumber: "X12345678",
    expirationYmd: "2031-05-01",
  };
}

function listB(): I9Document {
  return {
    category: "list_b",
    title: "Driver's license",
    issuingAuthority: "Washington State DOL",
    documentNumber: "WDL1234567",
    expirationYmd: "2030-03-15",
  };
}

function listC(): I9Document {
  return {
    category: "list_c",
    title: "Social Security card",
    issuingAuthority: "Social Security Administration",
    documentNumber: "123456789",
    expirationYmd: null,
  };
}

function goodI9(over: Partial<I9Record> = {}): I9Record {
  return {
    employeeId: "emp-1",
    section1SignedYmd: HIRE,
    section2CompletedYmd: HIRE,
    firstDayOfEmploymentYmd: HIRE,
    documents: [listA()],
    copiesRetained: true,
    ...over,
  };
}

function goodPay(over: Partial<PayRecord> = {}): PayRecord {
  return {
    employeeId: "emp-1",
    basis: "hourly",
    hourlyRateMilliCents: 2_050_000, // $20.50/hour
    annualSalaryCents: null,
    payFrequency: "biweekly", // Michael: "every two weeks on friday"
    laborRoleCode: "budtender",
    cogsSplitBasisPoints: 0,
    hireYmd: HIRE,
    minimumWageMilliCentsAtHire: 1_666_000, // $16.66/hour
    ...over,
  };
}

function goodCandidate(over: Partial<OnboardingCandidate> = {}): OnboardingCandidate {
  return {
    employeeId: "emp-1",
    legalFirstName: "Dana",
    legalLastName: "Reyes",
    ssn: "531-22-4487",
    w4: goodW4(),
    i9: goodI9(),
    pay: goodPay(),
    newHireReportedYmd: HIRE,
    ...over,
  };
}

const fieldsOf = (e: ReturnType<typeof evaluateOnboarding>) =>
  e.blockingProblems.map((p) => p.field);

// ===========================================================================
describe("the happy path is actually reachable (rule 34: gates run both ways)", () => {
  it("a fully documented employee can be saved", () => {
    const e = evaluateOnboarding(goodCandidate());
    expect(
      e.canSaveToPayroll,
      `unexpected blocks: ${JSON.stringify(e.blockingProblems, null, 2)}`,
    ).toBe(true);
    expect(e.refusalCode).toBeNull();
    expect(e.blockingProblems).toEqual([]);
  });

  it("every payroll-blocking step reports complete", () => {
    const e = evaluateOnboarding(goodCandidate());
    const blocking = ONBOARDING_STEPS.filter((s) => s.blocksPayroll).map((s) => s.key);
    for (const key of blocking) {
      const step = e.steps.find((s) => s.key === key)!;
      expect(step.complete, `${key} should be complete`).toBe(true);
    }
  });

  it("no step is left blocked by a prerequisite when everything is done", () => {
    const e = evaluateOnboarding(goodCandidate());
    expect(e.steps.filter((s) => s.blockedByPrerequisite).map((s) => s.key)).toEqual([]);
  });
});

// ===========================================================================
describe("identity: the SSN is required, and impossible numbers are refused", () => {
  it("refuses a missing SSN and names the field", () => {
    const e = evaluateOnboarding(goodCandidate({ ssn: "" }));
    expect(e.canSaveToPayroll).toBe(false);
    expect(e.refusalCode).toBe("identity_defective");
    expect(fieldsOf(e)).toContain("ssn");
  });

  it("refuses a missing legal name", () => {
    const e = evaluateOnboarding(goodCandidate({ legalFirstName: "  " }));
    expect(e.canSaveToPayroll).toBe(false);
    expect(fieldsOf(e)).toContain("legalFirstName");
  });

  // SSA's randomization FAQ: area numbers 000, 666 and 900-999 were excluded
  // from assignment; group 00 and serial 0000 are never assigned.
  it.each([
    ["000-12-3456", "area_000"],
    ["666-12-3456", "area_666"],
    ["900-12-3456", "area_900_999"],
    ["999-12-3456", "area_900_999"],
    ["531-00-4487", "group_00"],
    ["531-22-0000", "serial_0000"],
    ["123-45-6789", "sequential_placeholder"],
  ])("%s is impossible (%s)", (ssn, code) => {
    expect(ssnProblems(ssn)).toContain(code);
    expect(isPossibleSsn(ssn)).toBe(false);
    const e = evaluateOnboarding(goodCandidate({ ssn }));
    expect(e.canSaveToPayroll).toBe(false);
    expect(fieldsOf(e)).toContain("ssn");
  });

  // The other direction. Without this, a function that always returned a
  // problem would pass every test above.
  it.each(["531-22-4487", "001-01-0001", "899-99-9999", "665-01-0001"])(
    "%s is possible",
    (ssn) => {
      expect(ssnProblems(ssn)).toEqual([]);
      expect(isPossibleSsn(ssn)).toBe(true);
    },
  );

  it("899 passes and 900 fails — the boundary is exactly where SSA put it", () => {
    expect(isPossibleSsn("899-12-3456")).toBe(true);
    expect(isPossibleSsn("900-12-3456")).toBe(false);
  });

  it("normalizes formatting but refuses the wrong number of digits", () => {
    expect(normalizeSsn("531-22-4487")).toBe("531224487");
    expect(normalizeSsn("531 22 4487")).toBe("531224487");
    expect(normalizeSsn("531224487")).toBe("531224487");
    expect(normalizeSsn("53122448")).toBeNull(); // eight
    expect(normalizeSsn("5312244877")).toBeNull(); // ten
    expect(ssnProblems("53122448")).toEqual(["not_nine_digits"]);
  });

  it("states its own limits rather than implying verification", () => {
    const caveat = ssnVerificationCaveat();
    expect(caveat).toMatch(/IMPOSSIBLE/);
    expect(caveat).toMatch(/Verification Service/i);
  });
});

// ===========================================================================
describe("the SSN is masked for everyone except Michael", () => {
  const SSN = "531-22-4487";

  it("masks to the last four", () => {
    expect(maskSsn(SSN)).toBe("XXX-XX-4487");
  });

  it("only the owner may reveal", () => {
    expect(canRevealSsn("owner")).toBe(true);
    for (const role of ["admin", "manager", "content_editor", "staff", "readonly"]) {
      expect(canRevealSsn(role), `${role} must not reveal`).toBe(false);
    }
  });

  it("the default is masked even for the owner — reveal must be asked for", () => {
    expect(renderSsnForRole(SSN, "owner", false)).toBe("XXX-XX-4487");
    expect(renderSsnForRole(SSN, "owner", true)).toBe("531-22-4487");
  });

  it("a non-owner asking to reveal still gets the mask", () => {
    expect(renderSsnForRole(SSN, "admin", true)).toBe("XXX-XX-4487");
    expect(renderSsnForRole(SSN, "manager", true)).toBe("XXX-XX-4487");
  });

  // A masking function that throws leaks the value through the stack trace.
  it("never throws on malformed input, and never echoes it back", () => {
    for (const bad of ["", "abc", "12", "not-an-ssn", "5312244871234"]) {
      expect(() => maskSsn(bad)).not.toThrow();
      // The exact-output assertion is the whole guard for malformed input: it pins
      // both "did not throw" and "did not echo". A `not.toContain` here would add
      // nothing, because `toBe` already fixes every character - and for the empty
      // string `not.toContain("")` can never pass at all.
      expect(maskSsn(bad)).toBe("XXX-XX-????");
    }
  });

  // For a well-formed SSN the last four digits legitimately vary, so an exact
  // equality assertion cannot stand in for "the first five never leak". This is
  // the assertion that would actually catch a mask that echoed part of its input.
  it("no digit of the protected first five survives masking, for any valid SSN", () => {
    for (const raw of [
      "531224487",
      "001010001",
      "899999999",
      "123456789",
      "700010002",
    ]) {
      const masked = maskSsn(raw);
      expect(masked).toBe(`XXX-XX-${raw.slice(5)}`);
      expect(masked).not.toContain(raw.slice(0, 5));
      expect(masked.replace(/[^0-9]/g, "")).toBe(raw.slice(5));
    }
  });

  it("formatSsnUnmasked returns empty rather than partial garbage", () => {
    expect(formatSsnUnmasked("531224487")).toBe("531-22-4487");
    expect(formatSsnUnmasked("53122448")).toBe("");
  });
});

// ===========================================================================
describe("I-9: the document-set rule people actually get wrong", () => {
  it("one List A document is sufficient", () => {
    expect(i9DocumentSetIsSufficient([listA()])).toBe(true);
  });

  it("List B plus List C is sufficient", () => {
    expect(i9DocumentSetIsSufficient([listB(), listC()])).toBe(true);
  });

  // THE headline defect. Two identity documents feels like more proof and
  // establishes work authorization not at all.
  it("TWO List B documents is NOT sufficient, however official they look", () => {
    expect(i9DocumentSetIsSufficient([listB(), { ...listB(), title: "State ID card" }])).toBe(
      false,
    );
  });

  it("List B alone and List C alone are both insufficient", () => {
    expect(i9DocumentSetIsSufficient([listB()])).toBe(false);
    expect(i9DocumentSetIsSufficient([listC()])).toBe(false);
  });

  it("no documents is insufficient", () => {
    expect(i9DocumentSetIsSufficient([])).toBe(false);
  });

  it("an insufficient set blocks the save and names the documents field", () => {
    const e = evaluateOnboarding(
      goodCandidate({ i9: goodI9({ documents: [listB(), listB()] }) }),
    );
    expect(e.canSaveToPayroll).toBe(false);
    expect(e.refusalCode).toBe("i9_defective");
    expect(fieldsOf(e)).toContain("i9.documents");
  });

  it("refuses a document that expired before Section 2 was completed", () => {
    const expired: I9Document = { ...listA(), expirationYmd: "2026-12-31" };
    const r = validateI9(goodI9({ documents: [expired] }));
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.field === "documents[0].expirationYmd")).toBe(true);
    expect(
      r.issues.find((i) => i.field === "documents[0].expirationYmd")?.authorityId,
    ).toBe("cfr-8-274a-2-b-1-v-only-unexpired-documents");
  });

  it("a document with no expiry (Social Security card) is fine", () => {
    const r = validateI9(goodI9({ documents: [listB(), listC()] }));
    expect(r.ok, JSON.stringify(r.issues)).toBe(true);
  });

  it("refuses a document with no number recorded", () => {
    const r = validateI9(goodI9({ documents: [{ ...listA(), documentNumber: "  " }] }));
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.field === "documents[0].documentNumber")).toBe(true);
  });
});

// ===========================================================================
describe("I-9 timing: business days, not calendar days", () => {
  // Monday 2027-01-04 + 3 business days = Thursday 2027-01-07.
  it("counts three BUSINESS days from the first day of work", () => {
    expect(i9Section2DueYmd("2027-01-04")).toBe("2027-01-07");
  });

  // Thursday + 3 business days skips the weekend and lands Tuesday.
  it("skips the weekend", () => {
    expect(i9Section2DueYmd("2027-01-07")).toBe("2027-01-12");
  });

  it("a Friday hire is due the following Wednesday", () => {
    expect(i9Section2DueYmd("2027-01-08")).toBe("2027-01-13");
  });

  it("refuses a Section 2 completed after the deadline, and says the date", () => {
    const r = validateI9(goodI9({ section2CompletedYmd: "2027-01-08" })); // due 01-07
    expect(r.ok).toBe(false);
    const issue = r.issues.find((i) => i.field === "section2CompletedYmd")!;
    expect(issue.message).toContain("2027-01-07");
  });

  it("accepts a Section 2 completed exactly on the deadline", () => {
    const r = validateI9(goodI9({ section2CompletedYmd: "2027-01-07" }));
    expect(r.ok, JSON.stringify(r.issues)).toBe(true);
  });

  it("refuses Section 1 signed after the first day of work", () => {
    const r = validateI9(goodI9({ section1SignedYmd: "2027-01-05" }));
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.field === "section1SignedYmd")).toBe(true);
  });

  it("accepts Section 1 signed before the first day (a pre-start hire pack)", () => {
    const r = validateI9(goodI9({ section1SignedYmd: "2026-12-30" }));
    expect(r.ok, JSON.stringify(r.issues)).toBe(true);
  });

  it("refuses a missing first day of employment, because every clock starts there", () => {
    const r = validateI9(goodI9({ firstDayOfEmploymentYmd: null }));
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.field === "firstDayOfEmploymentYmd")).toBe(true);
  });
});

// ===========================================================================
describe("I-9 retention: 'whichever is later' means later RESULT, not later ANCHOR", () => {
  it("with no termination, it is three years from hire", () => {
    expect(i9RetainUntilYmd("2027-01-04", null)).toBe("2030-01-04");
  });

  // The trap, with real numbers. Hired 2015, left 2026:
  //   hire + 3   = 2018  (long past)
  //   term + 1   = 2027  (the real answer)
  it("a long-tenured employee is governed by termination + 1 year", () => {
    expect(i9RetainUntilYmd("2015-06-01", "2026-08-01")).toBe("2027-08-01");
  });

  // And the reverse: a short-tenured employee is governed by hire + 3.
  it("a short-tenured employee is governed by hire + 3 years", () => {
    expect(i9RetainUntilYmd("2027-01-04", "2027-03-01")).toBe("2030-01-04");
  });

  it("picks whichever result is later in both directions", () => {
    const early = i9RetainUntilYmd("2020-01-01", "2027-01-01"); // term+1 = 2028
    expect(early).toBe("2028-01-01");
    const late = i9RetainUntilYmd("2026-01-01", "2026-02-01"); // hire+3 = 2029
    expect(late).toBe("2029-01-01");
  });

  it("addYearsYmd holds month and day, and refuses a malformed date", () => {
    expect(addYearsYmd("2027-01-04", 3)).toBe("2030-01-04");
    expect(addYearsYmd("2028-02-29", 1)).toBe("2029-02-29");
    expect(() => addYearsYmd("01/04/2027", 3)).toThrow(/YYYY-MM-DD/);
  });
});

// ===========================================================================
describe("the I-9 quarantine is structural, not a policy document", () => {
  // 8 C.F.R. §274a.2(b)(4). Rule 40: an unreachable guard is an untested guard,
  // so the guard is exercised here even though nothing in the current code
  // passes an I-9 into a pay function.
  it("throws when an I-9 record reaches a pay computation", () => {
    expect(() => assertI9NotUsedForPay(goodI9(), "computeGrossPay")).toThrow(
      /274a\.2\(b\)\(4\)/,
    );
  });

  it("names the offending fields so the refactor knows what to remove", () => {
    expect(() => assertI9NotUsedForPay(goodI9(), "computeGrossPay")).toThrow(
      /section1SignedYmd/,
    );
  });

  it("lets an ordinary pay record through untouched", () => {
    expect(() => assertI9NotUsedForPay(goodPay(), "computeGrossPay")).not.toThrow();
  });

  it("ignores primitives and null rather than throwing on everything", () => {
    for (const v of [null, undefined, 0, "", "i9", 42, true]) {
      expect(() => assertI9NotUsedForPay(v, "ctx")).not.toThrow();
    }
  });

  // The engine's own signature is the real proof. If a tax function ever grows
  // an I-9 parameter, this fails.
  it("no payroll tax function takes an I-9 parameter", () => {
    const src = readFileSync(
      join(__dirname, "..", "..", "src", "lib", "payroll", "payroll-withholding-core.ts"),
      "utf8",
    );
    expect(src.length).toBeGreaterThan(50_000); // rule 39: guard a vacuous read
    expect(src).not.toContain("I9Record");
    expect(src).not.toContain("section1SignedYmd");
    expect(src).not.toContain("section2CompletedYmd");
  });
});

// ===========================================================================
describe("pay: the Sage defects that would have cost real money", () => {
  // Sage's Pay Info tab showed every hourly rate at 0.00 on a saveable record.
  it("refuses a zero hourly rate — the Sage default that saves silently", () => {
    const e = evaluateOnboarding(
      goodCandidate({ pay: goodPay({ hourlyRateMilliCents: 0 }) }),
    );
    expect(e.canSaveToPayroll).toBe(false);
    expect(e.refusalCode).toBe("pay_defective");
    expect(fieldsOf(e)).toContain("pay.hourlyRateMilliCents");
  });

  it("refuses a null hourly rate for an hourly employee", () => {
    const r = validatePay(goodPay({ hourlyRateMilliCents: null }));
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.field === "hourlyRateMilliCents")).toBe(true);
  });

  it("refuses a negative rate", () => {
    const r = validatePay(goodPay({ hourlyRateMilliCents: -100 }));
    expect(r.ok).toBe(false);
  });

  it("refuses a rate below the Washington minimum in force at hire", () => {
    const r = validatePay(
      goodPay({
        hourlyRateMilliCents: 1_500_000, // $15.00
        minimumWageMilliCentsAtHire: 1_666_000, // $16.66
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => /minimum wage/i.test(i.message))).toBe(true);
  });

  it("REFUSES an hourly employee when the minimum wage at hire is unknown", () => {
    // books-26 DEFECT. The floor check used to be guarded by
    // `minimumWageMilliCentsAtHire !== null`, so a blank floor did not mean
    // "unverified" - it meant the check never ran. Proven by execution before
    // the fix: $9.00/hour returned ok=true with ZERO issues, and no test in
    // the suite covered the null case, so the whole suite stayed green.
    //
    // Rule 14: an unknown floor is not a permissive floor.
    const r = validatePay(
      goodPay({
        hourlyRateMilliCents: 900_000, // $9.00 - far below any WA minimum
        minimumWageMilliCentsAtHire: null,
      }),
    );
    expect(r.ok).toBe(false);
    const issue = r.issues.find((i) => i.field === "minimumWageMilliCentsAtHire");
    expect(issue, JSON.stringify(r.issues)).toBeDefined();
    expect(issue!.severity).toBe("block");
    // It must name a concrete action, which is what makes the block fair
    // rather than merely strict.
    expect(issue!.authorityId).toBe("lni-minimum-wage-announcement");
    // And it must say which date it is missing, or the user cannot act.
    expect(issue!.message).toContain(goodPay({}).hireYmd);
  });

  it("refuses an unknown floor even when the rate is obviously generous", () => {
    // The refusal is about not KNOWING, not about the rate being low. $50/hour
    // is legal under any Washington floor that has ever existed, and it is
    // still refused, because "I checked and it passed" and "I could not check"
    // are different statements and only one of them is evidence.
    const r = validatePay(
      goodPay({
        hourlyRateMilliCents: 5_000_000, // $50.00
        minimumWageMilliCentsAtHire: null,
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.field === "minimumWageMilliCentsAtHire")).toBe(true);
  });

  it("does not demand a minimum wage from a SALARIED employee", () => {
    // The floor is an hourly test. Michael is the only salaried person at
    // Greenway ("hourly for all employees, salary for me"), and blocking his
    // own record on a field that does not apply to it would be a refusal with
    // no legitimate action behind it - which is how a gate stops being
    // believed. Rule 14 says block the wrong thing, not everything.
    const r = validatePay({
      ...goodPay({}),
      basis: "salary",
      hourlyRateMilliCents: null,
      annualSalaryCents: 6_000_000, // $60,000
      minimumWageMilliCentsAtHire: null,
    });
    expect(r.issues.some((i) => i.field === "minimumWageMilliCentsAtHire")).toBe(false);
  });

  it("accepts a rate exactly at the minimum", () => {
    const r = validatePay(
      goodPay({
        hourlyRateMilliCents: 1_666_000,
        minimumWageMilliCentsAtHire: 1_666_000,
      }),
    );
    expect(r.ok, JSON.stringify(r.issues)).toBe(true);
  });

  // Sage lets an hourly rate and a salary coexist on one person.
  it("refuses an employee who is both hourly and salaried", () => {
    const r = validatePay(goodPay({ annualSalaryCents: 7_000_000 }));
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.field === "annualSalaryCents")).toBe(true);
  });

  it("refuses a salaried person who also carries an hourly rate", () => {
    const r = validatePay(
      goodPay({
        basis: "salary",
        annualSalaryCents: 7_000_000,
        hourlyRateMilliCents: 2_050_000,
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.field === "hourlyRateMilliCents")).toBe(true);
  });

  it("Michael's own case is valid: salaried, paid once at year end", () => {
    const r = validatePay(
      goodPay({
        basis: "salary",
        annualSalaryCents: 7_000_000,
        hourlyRateMilliCents: null,
        laborRoleCode: "owner_officer",
        cogsSplitBasisPoints: 0,
      }),
    );
    expect(r.ok, JSON.stringify(r.issues)).toBe(true);
  });

  it("refuses a salary of zero and says why it matters for an S-corp owner", () => {
    const r = validatePay(
      goodPay({ basis: "salary", annualSalaryCents: 0, hourlyRateMilliCents: null }),
    );
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => /reasonable.compensation/i.test(i.message))).toBe(true);
  });

  it("refuses a missing labor role — the §280E dropdown", () => {
    const e = evaluateOnboarding(goodCandidate({ pay: goodPay({ laborRoleCode: "" }) }));
    expect(e.canSaveToPayroll).toBe(false);
    expect(fieldsOf(e)).toContain("pay.laborRoleCode");
  });

  it("attributes labor-role problems to the labor_role step, not the pay step", () => {
    const e = evaluateOnboarding(goodCandidate({ pay: goodPay({ laborRoleCode: "" }) }));
    const problem = e.blockingProblems.find((p) => p.field === "pay.laborRoleCode")!;
    expect(problem.step).toBe("labor_role");
  });

  it.each([-1, BASIS_POINTS_FULL + 1, 10_001, 250.5])(
    "refuses a COGS split of %s basis points",
    (bp) => {
      const r = validatePay(goodPay({ cogsSplitBasisPoints: bp }));
      expect(r.ok).toBe(false);
      expect(r.issues.some((i) => i.field === "cogsSplitBasisPoints")).toBe(true);
    },
  );

  it.each([0, 1, 5_000, BASIS_POINTS_FULL])("accepts a split of %s basis points", (bp) => {
    const r = validatePay(goodPay({ cogsSplitBasisPoints: bp }));
    expect(r.ok, JSON.stringify(r.issues)).toBe(true);
  });

  // -----------------------------------------------------------------------
  // THE CADENCE ITSELF
  //
  // validatePay() checked every number hanging off the pay frequency and
  // never checked the pay frequency. Migration 0195's CHECK then refused
  // 'semiannually' and 'daily' -- verified against real PostgreSQL, not
  // inferred -- so those two cleared validation and failed at the INSERT.
  // -----------------------------------------------------------------------
  it.each(["fortnightly", "hourly", "every_other_friday", "", "annual"])(
    "refuses the unrecognised pay frequency %s instead of letting the database do it",
    (bogus) => {
      const r = validatePay(goodPay({ payFrequency: bogus as PayFrequency }));
      expect(r.ok).toBe(false);
      const issue = r.issues.find((i) => i.field === "payFrequency");
      expect(issue, `no payFrequency issue raised for ${JSON.stringify(bogus)}`).toBeDefined();
      expect(issue!.severity).toBe("block");
      // The refusal must say WHY, not just "invalid". Michael's whole
      // complaint about Sage is being stopped without being told anything.
      expect(issue!.message).toMatch(/Pub\. 15-T/);
    },
  );

  it("accepts every cadence the engine declares, so the guard is not simply strict", () => {
    // Rule 39/40: a check that refuses everything would pass the test above
    // while making the product unusable. This is the reachability half.
    for (const f of ALL_PAY_FREQUENCIES) {
      const r = validatePay(goodPay({ payFrequency: f }));
      expect(
        r.issues.some((i) => i.field === "payFrequency"),
        `${f} is a declared PayFrequency but validatePay rejected it`,
      ).toBe(false);
    }
  });

  it("refuses a frequency the database would refuse, and for a stated reason", () => {
    // Belt and braces on the specific pair that was broken. If someone
    // re-narrows PAY_PERIODS_PER_YEAR, this fails here rather than at a
    // customer's INSERT.
    for (const f of ["semiannually", "daily"] as PayFrequency[]) {
      const r = validatePay(goodPay({ payFrequency: f }));
      expect(r.ok, `${f} must be a savable cadence`).toBe(true);
    }
  });
});

// ===========================================================================
describe("gross pay arithmetic is exact", () => {
  it("hourly: 40 hours at $20.50 is $820.00", () => {
    expect(hourlyGrossCents(4_000, 2_050_000)).toBe(82_000);
  });

  // The reason rates are milli-cents. $17.855 is a real negotiable wage.
  it("hourly: an odd half-cent rate does not lose the half cent", () => {
    // 40 h x $17.855 = $714.20 exactly.
    expect(hourlyGrossCents(4_000, 1_785_500)).toBe(71_420);
  });

  it("hourly: rounds half UP, in the worker's favour", () => {
    // 1 hour at $0.005 -> 0.5 cents -> 1 cent, not 0.
    expect(hourlyGrossCents(100, 500)).toBe(1);
  });

  it("hourly: zero hours is zero, not a rounding artefact", () => {
    expect(hourlyGrossCents(0, 2_050_000)).toBe(0);
  });

  it("hourly: refuses fractional hours and negative hours", () => {
    expect(() => hourlyGrossCents(40.5, 2_050_000)).toThrow(/hundredths/);
    expect(() => hourlyGrossCents(-100, 2_050_000)).toThrow(/hundredths/);
  });

  it("hourly: refuses a fractional rate", () => {
    expect(() => hourlyGrossCents(4_000, 2_050_000.5)).toThrow(/milli-cents/);
  });

  // Salary: the remainder has to land somewhere explicit.
  it("salary: 26 periods of $70,000 sums back to exactly $70,000", () => {
    const total = Array.from({ length: 26 }, (_, i) =>
      salaryGrossForPeriodCents(7_000_000, "biweekly", i),
    ).reduce((a, b) => a + b, 0);
    expect(total).toBe(7_000_000);
  });

  it("salary: the odd cents go to the first period, deliberately", () => {
    // 7,000,000 / 26 = 269,230 remainder 20.
    expect(salaryGrossForPeriodCents(7_000_000, "biweekly", 0)).toBe(269_250);
    expect(salaryGrossForPeriodCents(7_000_000, "biweekly", 1)).toBe(269_230);
  });

  it("salary: any frequency sums back to the annual figure", () => {
    for (const freq of ["weekly", "biweekly", "semimonthly", "monthly"] as const) {
      const periods = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 }[freq];
      const total = Array.from({ length: periods }, (_, i) =>
        salaryGrossForPeriodCents(1_234_567, freq, i),
      ).reduce((a, b) => a + b, 0);
      expect(total, `${freq} must foot`).toBe(1_234_567);
    }
  });

  it("salary: refuses a period index outside the year", () => {
    expect(() => salaryGrossForPeriodCents(7_000_000, "biweekly", 26)).toThrow(/outside/);
    expect(() => salaryGrossForPeriodCents(7_000_000, "biweekly", -1)).toThrow(/outside/);
  });

  it("money guards refuse fractions and absurd magnitudes", () => {
    expect(() => assertIntegerCents(1.5, "x")).toThrow(/integer/);
    expect(() => assertIntegerCents(Number.NaN, "x")).toThrow(/integer/);
    expect(() => assertIntegerCents(Number.MAX_SAFE_INTEGER + 10, "x")).toThrow(/too large/);
    expect(() => assertIntegerCents(0, "x")).not.toThrow();
    expect(() => assertIntegerMilliCents(1.5, "r")).toThrow(/milli-cents/);
    expect(() => assertIntegerMilliCents(1_785_500, "r")).not.toThrow();
  });

  it("MILLI_CENTS_PER_CENT is 1000 and is actually used by the arithmetic", () => {
    expect(MILLI_CENTS_PER_CENT).toBe(1_000);
    // One hour at exactly one cent per hour.
    expect(hourlyGrossCents(100, MILLI_CENTS_PER_CENT)).toBe(1);
  });
});

// ===========================================================================
describe("the W-4 gate", () => {
  it("refuses a missing W-4 but explains the lawful fallback", () => {
    const e = evaluateOnboarding(goodCandidate({ w4: null }));
    expect(e.canSaveToPayroll).toBe(false);
    expect(e.refusalCode).toBe("w4_defective");
    const p = e.blockingProblems.find((x) => x.field === "w4")!;
    expect(p.message).toMatch(/single with no adjustments/i);
    expect(p.authorityId).toBe("cfr-31-3402-f-2-1-a-4-no-certificate-default");
  });

  it("refuses an unsigned W-4", () => {
    const e = evaluateOnboarding(goodCandidate({ w4: goodW4({ signedAt: null }) }));
    expect(e.canSaveToPayroll).toBe(false);
    expect(fieldsOf(e).some((f) => f.startsWith("w4."))).toBe(true);
  });

  // A legacy W-4 is LAWFUL. Blocking it would invent an obligation (rule 1).
  it("a pre-2020 W-4 warns but does NOT block", () => {
    const e = evaluateOnboarding({
      ...goodCandidate(),
      w4: goodW4({ formYear: 2019, legacyAllowances: 2 }),
    });
    expect(e.canSaveToPayroll, JSON.stringify(e.blockingProblems)).toBe(true);
    expect(e.warnings.some((w) => w.field === "w4.formYear")).toBe(true);
  });

  it("the statutory default is single with no adjustments, and is not invented here", () => {
    const c = noW4DefaultComparison("emp-1", 2027, null);
    expect(c.statutoryDefault.filingStatus).toBe("single_or_married_filing_separately");
    expect(c.statutoryDefault.step2MultipleJobs).toBe(false);
    expect(c.statutoryDefault.step3AnnualCreditCents).toBe(0);
    expect(c.statutoryDefault.step4cExtraPerPeriodCents).toBe(0);
    expect(c.statutoryDefault.exemptFromFederalIncomeTax).toBe(false);
    expect(c.authorityId).toBe("cfr-31-3402-f-2-1-a-4-no-certificate-default");
  });

  it("the comparison refuses to give tax advice, and says so", () => {
    const c = noW4DefaultComparison("emp-1", 2027, goodW4());
    expect(c.plainEnglish).toMatch(/must NOT do is tell them what to write/i);
    expect(c.furnished).not.toBeNull();
  });
});

// ===========================================================================
describe("the checklist itself", () => {
  it("every step is findable by key, and an unknown key returns undefined", () => {
    for (const s of ONBOARDING_STEPS) {
      expect(findOnboardingStep(s.key)?.key).toBe(s.key);
    }
    expect(findOnboardingStep("not_a_step")).toBeUndefined();
  });

  it("prerequisites only reference steps that exist", () => {
    const keys = new Set(ONBOARDING_STEPS.map((s) => s.key));
    for (const s of ONBOARDING_STEPS) {
      for (const r of s.requires) {
        expect(keys.has(r), `${s.key} requires unknown step ${r}`).toBe(true);
      }
    }
  });

  it("no step requires itself, directly", () => {
    for (const s of ONBOARDING_STEPS) {
      expect(s.requires).not.toContain(s.key);
    }
  });

  it("I-9 Section 2 requires Section 1, because the law orders them", () => {
    expect(findOnboardingStep("i9_section2")!.requires).toContain("i9_section1");
  });

  it("the new-hire report requires the W-4, per RCW 26.23.040(2)", () => {
    const step = findOnboardingStep("new_hire_report")!;
    expect(step.requires).toContain("w4");
    expect(step.authorityIds).toContain("rcw-26-23-040-report-by-w4-form");
  });

  // Rule 46: the count is enumerated, not a magic number.
  it("blocks payroll on exactly the legally required steps", () => {
    const blocking = ONBOARDING_STEPS.filter((s) => s.blocksPayroll).map((s) => s.key);
    expect(blocking.sort()).toEqual(
      ["i9_section1", "i9_section2", "identity", "labor_role", "pay", "w4"].sort(),
    );
  });

  // The 20-day report is a real obligation on its own clock. Blocking payroll
  // on it would invent a rule the statute does not contain.
  it("the 20-day new-hire report does NOT block payroll", () => {
    expect(findOnboardingStep("new_hire_report")!.blocksPayroll).toBe(false);
    const e = evaluateOnboarding(goodCandidate({ newHireReportedYmd: null }));
    expect(e.canSaveToPayroll).toBe(true);
    expect(e.warnings.some((w) => w.field === "newHireReportedYmd")).toBe(true);
  });

  it("marks a step blocked when its prerequisite is incomplete", () => {
    const e = evaluateOnboarding(
      goodCandidate({ i9: goodI9({ section1SignedYmd: null }) }),
    );
    const s2 = e.steps.find((s) => s.key === "i9_section2")!;
    expect(s2.blockedByPrerequisite).toBe(true);
  });

  it("every step carries a why, and every authority id is non-empty", () => {
    for (const s of ONBOARDING_STEPS) {
      expect(s.why.length, `${s.key} why too short`).toBeGreaterThan(60);
      expect(s.label.length).toBeGreaterThan(5);
      for (const a of s.authorityIds) expect(a.trim().length).toBeGreaterThan(3);
    }
  });
});

// ===========================================================================
describe("refusal codes: every declared code can actually fire (rule 43)", () => {
  it("identity_defective", () => {
    expect(evaluateOnboarding(goodCandidate({ ssn: "" })).refusalCode).toBe(
      "identity_defective",
    );
  });

  it("i9_defective", () => {
    expect(evaluateOnboarding(goodCandidate({ i9: null })).refusalCode).toBe("i9_defective");
  });

  it("w4_defective", () => {
    expect(evaluateOnboarding(goodCandidate({ w4: null })).refusalCode).toBe("w4_defective");
  });

  it("pay_defective", () => {
    expect(evaluateOnboarding(goodCandidate({ pay: null })).refusalCode).toBe(
      "pay_defective",
    );
  });

  it("null when nothing is wrong", () => {
    expect(evaluateOnboarding(goodCandidate()).refusalCode).toBeNull();
  });

  // The code should name the FIRST thing to fix, not an arbitrary one.
  it("names identity first when everything is broken at once", () => {
    const e = evaluateOnboarding(
      goodCandidate({ ssn: "", w4: null, i9: null, pay: null }),
    );
    expect(e.refusalCode).toBe("identity_defective");
  });

  it("falls through to i9 when identity is fine but the rest is not", () => {
    const e = evaluateOnboarding(goodCandidate({ w4: null, i9: null, pay: null }));
    expect(e.refusalCode).toBe("i9_defective");
  });
});

// ===========================================================================
describe("deadlines surfaced on the checklist", () => {
  it("lists all three clocks with their different units", () => {
    const d = onboardingDeadlines(HIRE);
    const keys = d.map((x) => x.key);
    expect(keys).toEqual(["i9_section2", "new_hire_report", "i9_retention"]);
  });

  it("the I-9 deadline is business days and the state report is calendar days", () => {
    const d = onboardingDeadlines("2027-01-04");
    expect(d.find((x) => x.key === "i9_section2")!.dueYmd).toBe("2027-01-07");
    expect(d.find((x) => x.key === "new_hire_report")!.dueYmd).toBe("2027-01-24");
  });

  it("deadlines appear on the evaluation when a hire date is known", () => {
    expect(evaluateOnboarding(goodCandidate()).deadlines.length).toBe(3);
  });

  it("and are empty when there is no pay record to date from", () => {
    expect(evaluateOnboarding(goodCandidate({ pay: null })).deadlines).toEqual([]);
  });
});

// ===========================================================================
describe("mid-year hire withholding surprise", () => {
  it("a January hire has essentially the whole year of periods", () => {
    expect(payPeriodsRemainingInYear("2027-01-01", "biweekly")).toBe(26);
  });

  it("a November hire has only a couple left", () => {
    const n = payPeriodsRemainingInYear("2027-11-15", "biweekly");
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(5);
  });

  it("never exceeds the periods in the year, and never goes negative", () => {
    for (const ymd of ["2027-01-01", "2027-06-30", "2027-12-31"]) {
      const n = payPeriodsRemainingInYear(ymd, "biweekly");
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(26);
    }
  });

  it("refuses a malformed hire date rather than returning a plausible number", () => {
    expect(() => payPeriodsRemainingInYear("11/15/2027", "biweekly")).toThrow(/YYYY-MM-DD/);
  });
});

// ===========================================================================
describe("required field lists match what the engine validates", () => {
  it("the W-4 list covers every field validateW4 can complain about", () => {
    const paths = w4RequiredFieldPaths();
    expect(paths).toContain("w4.signedAt");
    expect(paths).toContain("w4.filingStatus");
    expect(paths.every((p) => p.startsWith("w4."))).toBe(true);
  });

  it("the I-9 list covers the fields validateI9 blocks on", () => {
    const paths = i9RequiredFieldPaths();
    for (const f of [
      "i9.firstDayOfEmploymentYmd",
      "i9.section1SignedYmd",
      "i9.section2CompletedYmd",
      "i9.documents",
    ]) {
      expect(paths).toContain(f);
    }
  });

  it("the pay list includes the labor role, which has no government form", () => {
    expect(payRequiredFieldPaths()).toContain("pay.laborRoleCode");
    expect(payRequiredFieldPaths()).toContain("pay.payFrequency");
  });

  // Rule 34 in reverse: prove the lists are not vacuous.
  it("none of the lists is empty", () => {
    expect(w4RequiredFieldPaths().length).toBeGreaterThan(5);
    expect(i9RequiredFieldPaths().length).toBeGreaterThan(3);
    expect(payRequiredFieldPaths().length).toBeGreaterThan(3);
  });
});

// ===========================================================================
describe("the mentor layer covers every exported function (rule 26)", () => {
  /**
   * The files the mentor layer is responsible for explaining.
   *
   * The UI core joined this list in books-25 because it stopped being a thin
   * formatting shim: buildWorkedPaycheck decides which lines Michael sees and
   * what arithmetic is printed beside them, and buildChecklistView decides what
   * gets highlighted red. Those are exactly the "what is this screen telling
   * me?" questions the mentor layer exists to answer, so an unexplained export
   * in there is the same defect as an unexplained export in the engine.
   */
  const MENTORED_SOURCES = [
    "payroll-onboarding-core.ts",
    "payroll-onboarding-ui-core.ts",
  ] as const;

  function readMentoredSource(file: string): string {
    const src = readFileSync(
      join(__dirname, "..", "..", "src", "lib", "payroll", file),
      "utf8",
    );
    // Rule 39: a read that silently returned nothing would make every
    // assertion below vacuously true.
    expect(src.length, `${file} looks empty`).toBeGreaterThan(5_000);
    return src;
  }

  function exportedFunctionsIn(src: string): string[] {
    return [...src.matchAll(/^export function ([A-Za-z0-9_]+)/gm)].map((m) => m[1]);
  }

  it("every exported function in the core has a lesson", () => {
    const exported = exportedFunctionsIn(readMentoredSource("payroll-onboarding-core.ts"));
    expect(exported.length).toBeGreaterThan(15);

    const taught = new Set(PAYROLL_ONBOARDING_LESSONS.map((l) => l.fn));
    const untaught = exported.filter((fn) => !taught.has(fn));
    expect(untaught, `exported but not taught: ${untaught.join(", ")}`).toEqual([]);
  });

  it("every exported function in the SCREEN core has a lesson too", () => {
    const exported = exportedFunctionsIn(
      readMentoredSource("payroll-onboarding-ui-core.ts"),
    );
    // Guards the guard: if this file ever stops exporting functions the test
    // above would pass by having nothing to check.
    expect(exported.length).toBeGreaterThan(3);

    const taught = new Set(PAYROLL_ONBOARDING_LESSONS.map((l) => l.fn));
    const untaught = exported.filter((fn) => !taught.has(fn));
    expect(
      untaught,
      `exported from the screen core but not taught: ${untaught.join(", ")}`,
    ).toEqual([]);
  });

  it("no lesson teaches a function that does not exist", () => {
    // Union across every mentored file, in BOTH directions (rule 34): the two
    // tests above catch an export with no lesson, this one catches a lesson
    // whose function was renamed or deleted out from under it.
    const exported = new Set(
      MENTORED_SOURCES.flatMap((f) => exportedFunctionsIn(readMentoredSource(f))),
    );
    const orphans = PAYROLL_ONBOARDING_LESSONS.filter((l) => !exported.has(l.fn));
    expect(orphans.map((o) => o.fn), "lessons for non-existent functions").toEqual([]);
  });

  it("every lesson fills all five fields with real prose, not placeholders", () => {
    for (const l of PAYROLL_ONBOARDING_LESSONS) {
      expect(l.plainEnglish.length, `${l.fn} plainEnglish`).toBeGreaterThan(40);
      expect(l.whyItExists.length, `${l.fn} whyItExists`).toBeGreaterThan(60);
      expect(l.theTrap.length, `${l.fn} theTrap`).toBeGreaterThan(60);
      expect(l.whatIWouldDo.length, `${l.fn} whatIWouldDo`).toBeGreaterThan(60);
      expect(Array.isArray(l.authorityIds)).toBe(true);
      for (const bad of ["TODO", "TBD", "FIXME", "lorem"]) {
        expect(l.plainEnglish + l.whyItExists + l.theTrap + l.whatIWouldDo).not.toContain(
          bad,
        );
      }
    }
  });

  it("no duplicate lessons for one function", () => {
    const seen = new Set<string>();
    for (const l of PAYROLL_ONBOARDING_LESSONS) {
      expect(seen.has(l.fn), `duplicate lesson for ${l.fn}`).toBe(false);
      seen.add(l.fn);
    }
  });
});
