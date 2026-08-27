/**
 * tests/compliance/soc-work-code.test.ts   (books-65)
 *
 * THE ESD WORK CODE.
 *
 * Michael asked for this in one sentence:
 *
 *   "for esd, they require a work code for each employee, so i will need a way
 *    to enter that code in. the code my employees use is, 41-2031."
 *
 * He is right that Washington requires it. He is not quite right that a blank
 * is a violation, and the difference is the whole reason this file is longer
 * than a validator test needs to be. RCW 50.12.070(2)(a)(i) asks for "the
 * standard occupational classification OR JOB TITLE of each worker", and ESD's
 * own wage-file specification says the code column "can be only 6 digits or
 * blank". So:
 *
 *   - a blank code is a LAWFUL filing in which the title is typed into EAMS,
 *     and blocking payroll over it would be this system inventing a rule;
 *   - a MALFORMED code is a typo that makes EAMS reject the entire upload, so
 *     it blocks here, where the error can name a person instead of a file.
 *
 * These tests pin that asymmetry in both directions, because a gate that only
 * ever refuses is as useless as one that only ever passes (rule 34).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  evaluateOnboarding,
  socCodeProblems,
  type OnboardingCandidate,
} from "@/lib/payroll/payroll-onboarding-core";
import { eamsSocCode, socCodeCanonical } from "@/lib/payroll/esd-eams-csv-core";
import { GUIDANCE_AUTHORITIES } from "@/lib/accounting/books-guidance-core";

const REPO = process.cwd();

// ---------------------------------------------------------------------------
// A candidate that is clean in every respect EXCEPT the field under test, so a
// failure can only be about the work code.
// ---------------------------------------------------------------------------

const HIRE = "2026-03-02";

function candidate(socCode: string): OnboardingCandidate {
  return {
    employeeId: "e1",
    legalFirstName: "Dana",
    legalLastName: "Reyes",
    ssn: "543-21-9876",
    w4: {
      employeeId: "e1",
      formYear: 2026,
      filingStatus: "single_or_married_filing_separately",
      step2MultipleJobs: false,
      step3AnnualCreditCents: 0,
      step4aOtherIncomeAnnualCents: 0,
      step4bDeductionsAnnualCents: 0,
      step4cExtraPerPeriodCents: 0,
      legacyAllowances: null,
      exemptFromFederalIncomeTax: false,
      signedAt: HIRE,
    },
    i9: {
      employeeId: "e1",
      section1SignedYmd: HIRE,
      section2CompletedYmd: HIRE,
      firstDayOfEmploymentYmd: HIRE,
      documents: [
        {
          category: "list_a",
          title: "U.S. Passport",
          issuingAuthority: "U.S. Department of State",
          documentNumber: "X12345678",
          expirationYmd: "2031-05-01",
        },
      ],
      copiesRetained: true,
    },
    pay: {
      employeeId: "e1",
      basis: "hourly",
      hourlyRateMilliCents: 2_000_000,
      annualSalaryCents: null,
      payFrequency: "biweekly",
      laborRoleCode: "budtender",
      cogsSplitBasisPoints: 0,
      hireYmd: HIRE,
      minimumWageMilliCentsAtHire: 1_713_000,
    },
    newHireReportedYmd: HIRE,
    socCode,
  };
}

// ===========================================================================
describe("books-65: the work code Michael asked for exists as a field", () => {
  it("a good code produces no problem at all", () => {
    expect(socCodeProblems("41-2031")).toEqual([]);
    expect(socCodeProblems("412031")).toEqual([]);
    // Rule 34: the clean case must actually reach the clean state, or every
    // refusal below is just a function that always refuses.
    const e = evaluateOnboarding(candidate("41-2031"));
    expect(e.canSaveToPayroll).toBe(true);
    expect(e.blockingProblems.map((p) => p.field)).not.toContain("socCode");
    expect(e.warnings.map((p) => p.field)).not.toContain("socCode");
  });

  it("Michael's own code, 41-2031, is the code that round-trips", () => {
    // Stated as its own test because it is the literal value in his mandate.
    expect(socCodeCanonical("41-2031")).toBe("41-2031");
    expect(eamsSocCode("41-2031")).toBe("412031");
    expect(socCodeProblems("41-2031")).toEqual([]);
  });
});

// ===========================================================================
describe("books-65: a BLANK code warns, and does NOT stop payroll", () => {
  it("blank raises exactly one warning, on the socCode field", () => {
    const problems = socCodeProblems("");
    expect(problems).toHaveLength(1);
    expect(problems[0]!.field).toBe("socCode");
    expect(problems[0]!.severity).toBe("warn");
  });

  it("whitespace is blank, not a code", () => {
    expect(socCodeProblems("   ")[0]!.severity).toBe("warn");
  });

  it("payroll still runs, because the statute takes a job title instead", () => {
    const e = evaluateOnboarding(candidate(""));
    expect(e.canSaveToPayroll).toBe(true);
    expect(e.refusalCode).toBeNull();
    // and the warning is surfaced rather than swallowed
    expect(e.warnings.some((w) => w.field === "socCode")).toBe(true);
  });

  it("the warning explains that blank is allowed, and says why", () => {
    const m = socCodeProblems("")[0]!.message;
    expect(m).toMatch(/allowed/i);
    expect(m).toMatch(/job title/i);
    // It must name the code he actually uses, so the next step is obvious.
    expect(m).toContain("41-2031");
  });

  it("the warning cites the statute that makes blank lawful", () => {
    expect(socCodeProblems("")[0]!.authorityId).toBe(
      "rcw-50-12-070-occupational-classification",
    );
  });
});

// ===========================================================================
describe("books-65: a MALFORMED code blocks, because EAMS would reject the file", () => {
  // Rule 43: walked, not hand-asserted one at a time.
  const BAD = [
    ["41203", "five digits"],
    ["4120311", "seven digits"],
    ["41-203", "five digits with a hyphen"],
    ["41-20311", "seven digits with a hyphen"],
    ["41-203X", "a letter where a digit belongs"],
    ["retail", "a job title typed into the code box"],
    ["41 2031", "a space instead of a hyphen"],
  ] as const;

  for (const [value, why] of BAD) {
    it(`refuses ${JSON.stringify(value)} - ${why}`, () => {
      const problems = socCodeProblems(value);
      expect(problems).toHaveLength(1);
      expect(problems[0]!.severity).toBe("block");
      expect(problems[0]!.field).toBe("socCode");
      // The message must quote back what was typed, so the fix is obvious.
      expect(problems[0]!.message).toContain(value);
    });
  }

  it("a malformed code actually stops the save, not merely the checklist", () => {
    const e = evaluateOnboarding(candidate("41203"));
    expect(e.canSaveToPayroll).toBe(false);
    expect(e.blockingProblems.map((p) => p.field)).toContain("socCode");
    // It is attributed to the labor-role step, which is the step that already
    // asks what kind of work this person does.
    expect(e.blockingProblems.find((p) => p.field === "socCode")!.step).toBe(
      "labor_role",
    );
    // and the refusal code follows the step, rather than being a new one
    expect(e.refusalCode).toBe("pay_defective");
  });

  it("the block cites the regulation that says six digits", () => {
    expect(socCodeProblems("41203")[0]!.authorityId).toBe(
      "wac-192-310-010-soc-six-digits",
    );
  });

  it("the block says blank would have been fine, so the fix is not guessing", () => {
    const m = socCodeProblems("41203")[0]!.message;
    expect(m).toMatch(/blank/i);
    expect(m).toMatch(/six digits/i);
  });
});

// ===========================================================================
describe("books-65: the storage spelling cannot violate the column CHECK", () => {
  /*
   * The bug this section exists to prevent, found while wiring the write:
   *
   *   "4-12031" strips to six digits, so eamsSocCode is happy, and the CHECK
   *   constraint in migration 0207 ('^[0-9]{2}-?[0-9]{4}$') refuses it because
   *   the hyphen is in the wrong place. Application says saved, database says
   *   no, and the two disagree about a record.
   */
  const CHECK = /^[0-9]{2}-?[0-9]{4}$/;

  it("the regex under test is the one migration 0207 actually contains", () => {
    // Rule 16: pin the gate to the real artefact, not to a copy of it.
    const sql = readFileSync(
      path.join(REPO, "supabase/migrations/0207_employee_esd_upload_fields.sql"),
      "utf8",
    );
    expect(sql).toContain("^[0-9]{2}-?[0-9]{4}$");
    expect(sql).toContain("add column if not exists soc_code");
  });

  it("every code the engine accepts canonicalises to something the CHECK allows", () => {
    const ACCEPTED = ["41-2031", "412031", "  41-2031  ", "4-12031", "00-0000"];
    let checked = 0;
    for (const raw of ACCEPTED) {
      expect(socCodeProblems(raw), `${raw} should be accepted`).toEqual([]);
      const stored = socCodeCanonical(raw);
      expect(stored, `${raw} canonicalised to ""`).not.toBe("");
      expect(CHECK.test(stored), `${stored} violates the 0207 CHECK`).toBe(true);
      checked += 1;
    }
    // Rule 39: an empty loop proves nothing.
    expect(checked).toBe(ACCEPTED.length);
  });

  it("the misplaced hyphen that motivated the canonicaliser is re-seated", () => {
    expect(eamsSocCode("4-12031")).toBe("412031");
    expect(CHECK.test("4-12031")).toBe(false); // the database would have refused
    expect(socCodeCanonical("4-12031")).toBe("41-2031");
    expect(CHECK.test(socCodeCanonical("4-12031"))).toBe(true);
  });

  it("canonicalising never invents a code out of a malformed one", () => {
    for (const bad of ["41203", "4120311", "41-203X", "retail", ""]) {
      expect(socCodeCanonical(bad), `${bad} was turned into a code`).toBe("");
    }
  });
});

// ===========================================================================
describe("books-65: the field is wired end to end, not just validated", () => {
  it("the setup form has an input bound to socCode", () => {
    const src = readFileSync(
      path.join(REPO, "src/components/admin/payroll/EmployeePayrollSetupForm.tsx"),
      "utf8",
    );
    expect(src).toContain("ESD work code (SOC)");
    expect(src).toContain("value={form.socCode}");
    expect(src).toContain('set("socCode", e.target.value)');
    // and it must show the error the engine emits for this exact field
    expect(src).toContain('problemFor("socCode")');
  });

  it("the form does NOT pre-fill 41-2031 as a default", () => {
    const src = readFileSync(
      path.join(REPO, "src/components/admin/payroll/EmployeePayrollSetupForm.tsx"),
      "utf8",
    );
    // It may appear as a placeholder and in help text, but the initial VALUE
    // must come from what is on file. A defaulted code states what somebody
    // does for a living without anyone having said so.
    expect(src).toContain("socCode: socCodeOnFile");
    expect(src).not.toContain('socCode: "41-2031"');
  });

  it("the store reads the column back and writes it", () => {
    const src = readFileSync(
      path.join(REPO, "src/lib/payroll/payroll-onboarding-store.ts"),
      "utf8",
    );
    expect(src).toContain("soc_code");
    expect(src).toContain("socCodeCanonical");
    // Read-back: the roster select must name the column, or the form would
    // open empty for someone who already has a code.
    expect(src).toContain("ssn_last_four, soc_code");
    // Write: one patch object, so the SSN and the code cannot half-succeed.
    expect(src).toContain("employeePatch");
  });

  it("an unsupplied code does not erase one already on file", () => {
    const src = readFileSync(
      path.join(REPO, "src/lib/payroll/payroll-onboarding-store.ts"),
      "utf8",
    );
    // The patch is built conditionally; there is no `soc_code: null` anywhere.
    expect(src).toContain('if (canonicalSoc !== "") employeePatch.soc_code = canonicalSoc;');
    expect(src).not.toContain("soc_code: null");
  });
});

// ===========================================================================
describe("books-65: both authorities are real, registered and quoted", () => {
  const IDS = [
    "rcw-50-12-070-occupational-classification",
    "wac-192-310-010-soc-six-digits",
  ];

  it("each id resolves in the guidance registry", () => {
    for (const id of IDS) {
      const a = GUIDANCE_AUTHORITIES.find((x) => x.id === id);
      expect(a, `${id} is not registered`).toBeDefined();
      expect(a!.quote.length).toBeGreaterThan(80);
      expect(a!.soWhat.length).toBeGreaterThan(120);
    }
    // Rule 66c: prove the lookup can miss, or "found" means nothing.
    expect(GUIDANCE_AUTHORITIES.find((x) => x.id === "soc-code-not-a-real-id")).toBeUndefined();
  });

  it("the statute quote contains the word that makes blank lawful", () => {
    const a = GUIDANCE_AUTHORITIES.find(
      (x) => x.id === "rcw-50-12-070-occupational-classification",
    )!;
    expect(a.quote).toContain("standard occupational classification or job title");
    expect(a.cite).toBe("RCW 50.12.070(2)(a)(i)");
  });

  it("the regulation quote contains the six-digit fact the validator relies on", () => {
    const a = GUIDANCE_AUTHORITIES.find(
      (x) => x.id === "wac-192-310-010-soc-six-digits",
    )!;
    expect(a.quote).toContain("six-digit numerical code");
    expect(a.cite).toBe("WAC 192-310-010(3)(b)(vii)");
  });

  it("both quotes appear verbatim in the mirrored source files", () => {
    // The verbatim script checks this too; doing it here means a broken quote
    // fails the ordinary test run rather than only the separate verifier.
    const files: Record<string, string> = {
      "rcw-50-12-070-occupational-classification":
        "docs/authorities/state-wa/rcw-50.12.070.txt",
      "wac-192-310-010-soc-six-digits": "docs/authorities/state-wa/wac-192-310-010.txt",
    };
    let checked = 0;
    for (const [id, rel] of Object.entries(files)) {
      const a = GUIDANCE_AUTHORITIES.find((x) => x.id === id)!;
      const corpus = readFileSync(path.join(REPO, rel), "utf8");
      expect(corpus.includes(a.quote), `${id} is not verbatim in ${rel}`).toBe(true);
      checked += 1;
    }
    expect(checked).toBe(2);
  });
});
