/**
 * tests/compliance/payroll-setup-screen.test.ts   (slice books-25)
 *
 * THE GUIDED SETUP SCREEN, AND THE PROMISES IT MAKES.
 *
 * Michael's requirement for this slice, verbatim:
 *
 *   "It should have a check list of task to be completed before it lets you save
 *    them to the system, and if a field is missing, it should highlight it so
 *    something can't silently fail me in some way."
 *
 * That sentence contains three separate testable claims, and this file tests
 * all three as claims about the SHIPPED FILES rather than about a mock:
 *
 *   1. There is a checklist, and it gates the save.
 *   2. A missing field is HIGHLIGHTED - which means the field paths the engine
 *      names must be paths the form actually renders. A highlight that points
 *      at a field the form does not have highlights nothing.
 *   3. Nothing fails silently - the save path refuses on the server's own
 *      authority, not on the client's word.
 *
 * WHY THIS IS A SOURCE-READING TEST AND NOT A RENDER TEST
 *
 * There is no React testing library in this project's dependencies, and adding
 * one to assert on markup would test React rather than the promises above. What
 * actually breaks these promises is a WIRING mistake: a field renamed in the
 * engine and not in the form, a `problemFor` call with a typo'd path, a Save
 * button that forgets `disabled`, an action that stops calling the gate. Those
 * are all visible in the source, and every one of them is a real defect this
 * file has already caught once.
 *
 * A LIVE EXAMPLE OF WHY (3) NEEDS TESTING AT THE PATH LEVEL
 *
 * While wiring this screen the page passed `ssnLastFour` into `maskSsn()`. That
 * function normalises to nine digits first, so four digits in returns
 * "XXX-XX-????" - the mask blanking out the only four digits it exists to
 * preserve. Verified by running it, not by reading it. The last test in this
 * file pins that behaviour so nobody re-introduces the shortcut.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  maskSsn,
  payRequiredFieldPaths,
  w4RequiredFieldPaths,
  i9RequiredFieldPaths,
  type I9Record,
  type OnboardingCandidate,
  type PayRecord,
} from "@/lib/payroll/payroll-onboarding-core";
import {
  buildChecklistView,
  buildWorkedPaycheck,
} from "@/lib/payroll/payroll-onboarding-ui-core";
import { findGuidanceAuthority } from "@/lib/accounting/books-guidance-core";
import { ALL_PAY_FREQUENCIES, type W4Record } from "@/lib/payroll/payroll-w4-core";

const REPO = path.resolve(__dirname, "../..");

// ---------------------------------------------------------------------------
// FIXTURES
//
// A complete, saveable employee, so that a fixture which is refused is refused
// for exactly ONE reason - the one the test is about. A fixture that is broken
// in six ways proves nothing about which break was noticed.
//
// These mirror the verified fixtures in payroll-onboarding-ui-core.test.ts
// rather than inventing new ones (rule 25).
// ---------------------------------------------------------------------------

const HIRE = "2027-01-04"; // the first Monday after Michael's Jan 1 2027 cutover

const COMPLETE_W4: W4Record = {
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
};

const COMPLETE_I9: I9Record = {
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
      expirationYmd: "2032-05-01",
    },
  ],
  copiesRetained: true,
};

const COMPLETE_PAY: PayRecord = {
  employeeId: "e1",
  basis: "hourly",
  hourlyRateMilliCents: 1_800_000, // $18.00/hr
  annualSalaryCents: null,
  payFrequency: "biweekly", // "every two weeks on friday"
  laborRoleCode: "budtender",
  cogsSplitBasisPoints: 0,
  hireYmd: HIRE,
  minimumWageMilliCentsAtHire: 1_713_000, // $17.13/hr
};

const COMPLETE_CANDIDATE: OnboardingCandidate = {
  employeeId: "e1",
  legalFirstName: "Dana",
  legalLastName: "Reyes",
  ssn: "543-21-9876",
  w4: COMPLETE_W4,
  i9: COMPLETE_I9,
  pay: COMPLETE_PAY,
  newHireReportedYmd: HIRE,
  socCode: "41-2031",
};

const FORM_PATH = path.join(
  REPO,
  "src/components/admin/payroll/EmployeePayrollSetupForm.tsx",
);
const ACTIONS_PATH = path.join(REPO, "src/app/admin/books/payroll-setup/actions.ts");
const PAGE_PATH = path.join(REPO, "src/app/admin/books/payroll-setup/page.tsx");

const FORM = readFileSync(FORM_PATH, "utf8");
const ACTIONS = readFileSync(ACTIONS_PATH, "utf8");
const PAGE = readFileSync(PAGE_PATH, "utf8");

/**
 * Source with comments removed.
 *
 * These files EXPLAIN the mistakes they avoid, at length, so a raw-text scan is
 * dangerous in both directions (rule 34): "the form does not call X" can fail
 * merely because a comment says it does not call X. Structural claims are made
 * against this stripped text.
 */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
}

const FORM_CODE = codeOnly(FORM);
const ACTIONS_CODE = codeOnly(ACTIONS);
const PAGE_CODE = codeOnly(PAGE);

// ===========================================================================
describe("the comment stripper works, or every test below is reading prose", () => {
  it("removed something from each file but left the code behind", () => {
    // Rule 39: if codeOnly() returned its input unchanged, the "does not
    // contain" assertions further down would be scanning explanatory comments
    // and passing for the wrong reason.
    for (const [name, raw, stripped] of [
      ["form", FORM, FORM_CODE],
      ["actions", ACTIONS, ACTIONS_CODE],
      ["page", PAGE, PAGE_CODE],
    ] as const) {
      expect(stripped.length, `${name}: nothing was stripped`).toBeLessThan(raw.length);
      expect(stripped, `${name}: real code was stripped away`).toContain("export");
    }
  });

  it("the stripper actually removes a line comment it can be checked against", () => {
    // A specific, checkable case rather than only a length comparison: a
    // stripper that deleted one character would pass the test above.
    expect(FORM).toContain("// ---");
    expect(FORM_CODE).not.toContain("// ---");
  });
});

// ===========================================================================
describe("1) there is a checklist, and it gates the save", () => {
  it("the form builds the checklist from the engine, not from its own opinion", () => {
    expect(FORM_CODE).toContain("buildChecklistView(candidate)");
  });

  it("the Save button is disabled while the checklist says no", () => {
    // The specific defect this prevents: a Save button that is always live and
    // relies on the server to say no. That works, but it teaches nothing and it
    // makes every refusal feel like a rejection instead of a checklist.
    expect(FORM_CODE).toMatch(/disabled=\{pending \|\| !view\.canSave\}/);
  });

  it("the form never decides for itself whether a step is complete", () => {
    // If the view layer could decide, two screens could disagree about the
    // same employee and whichever one Michael was looking at would become the
    // truth. The engine owns this judgement.
    expect(FORM_CODE).not.toMatch(/canSave\s*=\s*(true|false)/);
    expect(FORM_CODE).not.toMatch(/function\s+\w*[Ii]sComplete/);
  });

  it("recomputes as you type rather than only on submit", () => {
    // useMemo over the candidate, not an onSubmit handler. Guidance that
    // arrives after Save is a complaint, not guidance.
    expect(FORM_CODE).toMatch(/useMemo\(\(\)\s*=>\s*buildChecklistView\(candidate\)/);
  });
});

// ===========================================================================
describe("2) a missing field is highlighted, and the highlight points somewhere real", () => {
  /**
   * Candidates that MUST be refused, chosen to exercise the conditional
   * highlight paths rather than only the always-required ones.
   *
   * The second one is Michael's Sage screenshot rendered as a fixture: a fully
   * documented, signed, correctly-classified hourly employee with no wage.
   */
  const CANDIDATES_THAT_MUST_BE_REFUSED: {
    label: string;
    candidate: OnboardingCandidate;
    /**
     * The field the engine must ask to highlight, and - for the one-defect
     * fixtures - the ONLY field. Naming it is what makes the fixture honest:
     * a fixture broken in six ways is refused no matter what the code does,
     * so it proves nothing about which break was noticed.
     */
    mustHighlight: string;
    /** True when this fixture is deliberately broken in exactly one way. */
    exactlyOne: boolean;
  }[] = [
    {
      label: "a brand new employee with nothing entered yet",
      candidate: {
        employeeId: "e1",
        legalFirstName: "",
        legalLastName: "",
        ssn: "",
        w4: null,
        i9: null,
        pay: null,
        newHireReportedYmd: null,
        socCode: "",
      },
      mustHighlight: "ssn",
      exactlyOne: false,
    },
    {
      // Hourly, everything else in order, NO RATE. Sage saves this.
      label: "hourly, fully documented, no wage - Michael's screenshot",
      candidate: {
        ...COMPLETE_CANDIDATE,
        pay: { ...COMPLETE_PAY, basis: "hourly", hourlyRateMilliCents: null },
      },
      mustHighlight: "pay.hourlyRateMilliCents",
      exactlyOne: true,
    },
    {
      // Salaried with no salary - the mirror-image omission, which is
      // Michael's own arrangement: salary, paid once at year end.
      label: "salaried, paid annually, no salary figure",
      candidate: {
        ...COMPLETE_CANDIDATE,
        pay: {
          ...COMPLETE_PAY,
          basis: "salary",
          hourlyRateMilliCents: null,
          annualSalaryCents: null,
          payFrequency: "annually",
        },
      },
      mustHighlight: "pay.annualSalaryCents",
      exactlyOne: true,
    },
    {
      label: "a W-4 with data on it but no signature",
      candidate: { ...COMPLETE_CANDIDATE, w4: { ...COMPLETE_W4, signedAt: null } },
      mustHighlight: "w4.signedAt",
      exactlyOne: true,
    },
  ];

  it("the BASE fixture is genuinely complete, so a refusal below means one thing", () => {
    // RULE 22, THE TEST IS A SUSPECT - and this one caught a real hole.
    //
    // A mutant blanked out COMPLETE_W4.signedAt, making the "complete"
    // fixture incomplete. Every derived fixture was then broken in TWO ways,
    // every "must be refused" assertion still passed, and the suite stayed
    // green while no longer testing what it claimed. The fixtures were
    // proving the engine says no, not proving WHY.
    //
    // Verified by running it: this candidate returns canSave=true with an
    // empty highlight set.
    const view = buildChecklistView(COMPLETE_CANDIDATE);
    expect(
      view.canSave,
      `the base fixture is supposed to be a saveable employee, but the engine ` +
        `refused it: ${view.blockedBecause}`,
    ).toBe(true);
    for (const row of view.rows) {
      expect(row.highlightFields, `row "${row.label}" highlighted a complete employee`)
        .toEqual([]);
    }
  });

  it("each one-defect fixture is refused for EXACTLY the defect it was built for", () => {
    // This is the assertion the size check could not make. If a fixture is
    // refused for two reasons, one of them is an accident, and the test that
    // depends on it is passing for a reason nobody chose.
    for (const c of CANDIDATES_THAT_MUST_BE_REFUSED) {
      if (!c.exactlyOne) continue;
      const view = buildChecklistView(c.candidate);
      const emitted: string[] = [];
      for (const row of view.rows) for (const f of row.highlightFields) emitted.push(f);
      expect(view.canSave, `"${c.label}" was supposed to be refused`).toBe(false);
      expect(
        emitted,
        `"${c.label}" should be refused only over ${c.mustHighlight}`,
      ).toEqual([c.mustHighlight]);
    }
  });

  /**
   * Every field path the form asks about, pulled out of its problemFor() calls.
   * This is the set of fields that CAN be highlighted on screen.
   */
  function pathsTheFormRenders(): Set<string> {
    const found = new Set<string>();
    for (const m of FORM_CODE.matchAll(/problemFor\("([^"]+)"\)/g)) found.add(m[1]);
    return found;
  }

  it("asks about a substantial number of fields, so the check is not vacuous", () => {
    // Rule 39. If the regex matched nothing, every assertion below would pass.
    expect(pathsTheFormRenders().size).toBeGreaterThan(15);
  });

  it("EVERY required W-4, I-9 and pay field the engine names is rendered by the form", () => {
    // THE CENTRAL CLAIM OF THIS SLICE. The engine's refusal names a field path
    // so the screen can highlight it. If the form does not render that exact
    // path, the refusal names a field Michael cannot see, and the save fails
    // with a message pointing at nothing - which is the silent failure he
    // asked to have eliminated, wearing a helpful face.
    const rendered = pathsTheFormRenders();
    const required = [
      ...w4RequiredFieldPaths(),
      ...i9RequiredFieldPaths(),
      ...payRequiredFieldPaths(),
    ];

    // Guard the fixture itself: an empty required list would make this pass.
    expect(required.length).toBeGreaterThan(10);

    const unrenderable = required.filter((p) => !rendered.has(p));
    expect(
      unrenderable,
      `the engine can name ${JSON.stringify(unrenderable)} in a refusal, but the ` +
        `setup form renders no field with that path, so nothing would be highlighted`,
    ).toEqual([]);
  });

  it("EVERY path the engine ACTUALLY emits for a realistic bad setup is renderable", () => {
    // WHY THIS EXISTS ON TOP OF THE TEST ABOVE.
    //
    // A mutant deleted the highlight from the hourly-rate field - the single
    // field Michael's own Sage screenshots show sitting at 0.00 on saved
    // employees - and the suite stayed green. The static required-paths lists
    // do not contain "pay.hourlyRateMilliCents"; it is emitted CONDITIONALLY,
    // only when an hourly employee has no rate. Checking the declared lists
    // therefore missed the most important field on the screen.
    //
    // So this drives the engine with real candidates and collects what it
    // really asks to highlight. Verified by running it: the hourly-no-rate
    // candidate emits ["newHireReportedYmd", "pay.hourlyRateMilliCents",
    // "ssn"].
    const emitted = new Set<string>();
    for (const c of CANDIDATES_THAT_MUST_BE_REFUSED) {
      const view = buildChecklistView(c.candidate);
      expect(view.canSave, `"${c.label}" was supposed to be refused`).toBe(false);
      for (const row of view.rows) for (const f of row.highlightFields) emitted.add(f);
      // The fixture must contribute the path it exists to contribute, or it
      // has quietly stopped covering its case.
      expect(emitted, `"${c.label}" stopped emitting ${c.mustHighlight}`)
        .toContain(c.mustHighlight);
    }

    // Rule 39: an empty set would make the filter below vacuous.
    expect(emitted.size).toBeGreaterThan(6);
    // And the specific field the mutant exposed must be in here, or this test
    // has quietly stopped covering the case it was written for.
    expect(emitted).toContain("pay.hourlyRateMilliCents");
    expect(emitted).toContain("pay.annualSalaryCents");
    expect(emitted).toContain("w4.signedAt");

    const rendered = pathsTheFormRenders();
    // Top-level step paths ("w4", "i9", "pay") name a whole missing record
    // rather than one input, and are shown by the checklist itself rather than
    // by a field outline. Everything with a dot in it is a real field.
    const fieldPaths = [...emitted].filter((p) => p.includes("."));
    const unrenderable = fieldPaths.filter((p) => !rendered.has(p));
    expect(
      unrenderable,
      `the engine emitted ${JSON.stringify(unrenderable)} as a field to highlight, ` +
        `but the form renders no such field - so the refusal would point at nothing`,
    ).toEqual([]);
  });

  it("highlights come from the engine's own field paths, never a hand-made list", () => {
    expect(FORM_CODE).toContain("row.highlightFields");
    // A second, hand-typed list of "important fields" is the defect this whole
    // codebase keeps finding: it drifts, and the drift is invisible.
    expect(FORM_CODE).not.toMatch(/const\s+REQUIRED_FIELDS\s*=/);
  });

  it("a highlighted field always gets a sentence, never a bare red outline", () => {
    // Michael's complaint about Sage is being stopped without being told
    // anything. problemFor() falls through to a real sentence rather than
    // returning an empty string, which would render a red box with no text.
    expect(FORM_CODE).toContain("This still needs an answer before payroll can run.");
  });
});

// ===========================================================================
describe("3) nothing fails silently: the server refuses on its own authority", () => {
  it("every exported action gates on requireBooksAccess FIRST", () => {
    const actionNames = [...ACTIONS_CODE.matchAll(/export async function (\w+)/g)].map(
      (m) => m[1],
    );
    // Rule 39: no actions found would make the loop below vacuous. Two is the
    // real count - save and reveal - after checkSetupAction was deleted for
    // having no caller.
    expect(actionNames.length).toBeGreaterThanOrEqual(2);
    expect(actionNames).toContain("saveSetupAction");
    expect(actionNames).toContain("revealSsnAction");

    for (const name of actionNames) {
      const start = ACTIONS_CODE.indexOf(`export async function ${name}`);
      const body = ACTIONS_CODE.slice(start, start + 900);
      expect(body, `${name} does not call requireBooksAccess`).toContain(
        "requireBooksAccess()",
      );
    }
  });

  it("the save action re-evaluates server-side instead of trusting the client", () => {
    expect(ACTIONS_CODE).toContain("evaluateOnboarding(input.candidate)");
    expect(ACTIONS_CODE).toContain("canSaveToPayroll");
  });

  it("the save action never accepts a verdict, a role, or a checklist from the caller", () => {
    // A client-supplied role would make the SSN gate decorative, and a
    // client-supplied verdict would make the whole checklist decorative.
    expect(ACTIONS_CODE).not.toMatch(/role:\s*input\.role/);
    expect(ACTIONS_CODE).not.toMatch(/canSave:\s*input\./);
    // The role must come from the session that the server resolved itself.
    expect(ACTIONS_CODE).toContain("session.profile.role");
  });

  it("the save action refuses by RETURNING, not by throwing into an error boundary", () => {
    // A thrown error renders a blank error screen where the guidance used to
    // be. The refusal has to arrive as a value the form can print next to the
    // field at fault. Failing into silence is the one thing forbidden here.
    const start = ACTIONS_CODE.indexOf("export async function saveSetupAction");
    const end = ACTIONS_CODE.indexOf("export async function revealSsnAction");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = ACTIONS_CODE.slice(start, end);
    expect(body).toContain("ok: false");
    // And the refusal must carry the reason, not just the fact of refusal.
    expect(body).toMatch(/blockingProblems|blockedBecause|message/);
  });

  it("there is no second server door into the same verdict", () => {
    // RULE 50, CAUGHT IN THIS SLICE. `checkSetupAction` was written, exported,
    // gated and tested - and imported by nothing. The form already recomputes
    // the checklist locally on every keystroke from the same engine, so the
    // action was a second way to ask one question, kept alive by its own tests.
    // Two doors into one judgement is how two screens start disagreeing about
    // one employee, which is the specific failure this slice exists to prevent.
    expect(ACTIONS_CODE).not.toContain("checkSetupAction");

    // Every action this file exports must be imported by something that is not
    // a test. An exported server action with no caller is a live, authenticated
    // endpoint that no reviewer is watching.
    const exported = [...ACTIONS_CODE.matchAll(/export async function (\w+)/g)].map(
      (m) => m[1],
    );
    expect(exported.length).toBeGreaterThanOrEqual(2); // rule 39
    const callers = FORM_CODE + PAGE_CODE;
    for (const name of exported) {
      expect(callers, `${name} is exported but nothing in src/ calls it`).toContain(name);
    }
  });
});

// ===========================================================================
describe("the form does not re-implement the engine", () => {
  it("computes no tax of its own", () => {
    // Every rate and every formula must arrive from the UI core. A local
    // multiplication here is a second copy of a payroll rule, and the second
    // copy eventually disagrees with the first - on a 941, nine months later.
    for (const forbidden of [
      "OASDI_RATE",
      "MEDICARE_RATE",
      "0.062",
      "0.0145",
      "computeWorksheet1A",
    ]) {
      expect(FORM_CODE, `the form references ${forbidden} directly`).not.toContain(
        forbidden,
      );
    }
  });

  it("PRINTS the citation behind each paycheck line, not just the arithmetic", () => {
    // FOUND BY CHECKING THE REPORT AGAINST THE CODE (rule 47). The owner-facing
    // write-up claimed every paycheck line shows the authority that backs it.
    // Every line did carry an authorityId - and the screen dropped it on the
    // floor, rendering "x 6.2%" with nothing standing behind the 6.2%.
    //
    // "6.2%" is a number somebody typed. "26 U.S.C. 3101(a)" is the reason it
    // is 6.2%. This slice exists so a figure can be traced, so the trace has
    // to reach the page.
    expect(FORM_CODE).toContain("citeFor(line.authorityId)");
    // And the citation must be LOOKED UP, never typed here. A hand-typed cite
    // next to a computed number looks authoritative and drifts in silence.
    expect(FORM_CODE).toContain("findGuidanceAuthority");
    expect(FORM_CODE).not.toMatch(/"26 U\.S\.C\./);
  });

  it("the citations the paycheck asks for actually resolve to real authorities", () => {
    // A lookup that returns undefined renders nothing, which is safe but
    // useless: the promise of a traceable figure quietly stops being kept.
    // So resolve the ids the paycheck really uses, through the real registry.
    const view = buildWorkedPaycheck({
      w4: COMPLETE_W4,
      pay: COMPLETE_PAY,
      hundredthHours: 8_000, // 80 hours, one biweekly period
      onIsoDate: "2026-06-15", // inside the evidenced 2026 rate rows
    });
    const ids = [...view.employeeLines, ...view.employerLines]
      .map((l) => l.authorityId)
      .filter((id): id is string => typeof id === "string");

    // Rule 39: no ids would make the loop below prove nothing.
    expect(ids.length).toBeGreaterThan(3);
    for (const id of ids) {
      const found = findGuidanceAuthority(id);
      expect(found, `paycheck line cites "${id}", which is in no authority registry`)
        .toBeDefined();
      expect(found!.cite.length).toBeGreaterThan(5);
    }
  });

  it("gets the paycheck, its formulas and its citations from the UI core", () => {
    expect(FORM_CODE).toContain("buildWorkedPaycheck");
    // The formulas are DISPLAYED, not built here. This is the "show and teach
    // me the tax formulas" half of the requirement.
    expect(FORM_CODE).toContain("line.formula");
    expect(FORM_CODE).toContain("grossFormula");
    expect(FORM_CODE).toContain("takeHomeFormula");
    expect(FORM_CODE).toContain("employerCostFormula");
  });

  it("never adds employee tax to employer tax", () => {
    // Adding the two sides produces a "total taxes" figure that means nothing
    // and hides who actually bears the cost. They are rendered by the same
    // component but from separate arrays.
    expect(FORM_CODE).toContain("paycheck.employeeLines");
    expect(FORM_CODE).toContain("paycheck.employerLines");
    expect(FORM_CODE).not.toMatch(/employeeLines.*\.concat\(.*employerLines/);
    expect(FORM_CODE).not.toMatch(/\.\.\.paycheck\.employeeLines,\s*\.\.\.paycheck\.employerLines/);
  });

  it("surfaces an uncollected-tax shortfall rather than showing a clean zero", () => {
    // A take-home of zero with a silent shortfall behind it looks fine on
    // screen and turns up on a 941.
    expect(FORM_CODE).toContain("uncollectedEmployeeTaxCents");
  });

  it("surfaces refusals rather than swallowing them", () => {
    expect(FORM_CODE).toContain("paycheck.refusals");
  });
});

// ===========================================================================
describe("money never becomes a float on the way in", () => {
  it("converts typed text to integer cents, milli-cents and basis points", () => {
    for (const fn of ["dollarsToCents", "dollarsToMilliCents", "percentToBasisPoints"]) {
      expect(FORM_CODE, `${fn} is missing`).toContain(`function ${fn}`);
    }
  });

  it("uses no parseFloat or Number-times-100 on a money field", () => {
    // parseFloat("17.85") * 100 is 1784.9999999999998. Rule 4: integer cents,
    // and the conversion happens once, at the boundary, by string surgery.
    expect(FORM_CODE).not.toContain("parseFloat");
  });

  it("treats a blank money field as unanswered rather than as zero", () => {
    // Rule 46: a zero nobody entered looks exactly like a zero somebody
    // entered. The converters return null for "" so the engine reports the
    // field as missing, which is the truth.
    expect(FORM_CODE).toMatch(/if \(t === ""\) return null;/);
  });

  it("does not silently prefill a minimum wage into the saved record", () => {
    // The input still starts empty. What CHANGED in books-26 is that the
    // screen now knows the figure and displays it; it just refuses to type it
    // in on the user's behalf, because the stored value is "the minimum wage
    // AT HIRE" - a historical fact somebody should confirm, not a live lookup.
    expect(FORM_CODE).toContain('payMinimumWage: ""');
  });

  it("shows the minimum wage for the HIRE DATE, from the rate registry", () => {
    // books-25 shipped this field blank and told the user "this system has no
    // verified source for it". books-26 gave it one, so that sentence had to
    // go - a help text that describes a limitation the system no longer has is
    // just a wrong instruction (rule 47).
    expect(FORM_CODE).not.toContain("no verified source for it");
    expect(FORM_CODE).toContain('GREENWAY_RATES.lookupValue("wa_minimum_wage"');
    // Keyed to the hire date the user typed, NOT to today. Backdating a hire
    // into a prior year must surface that year's floor.
    expect(FORM_CODE).toContain("[form.payHireYmd]");
  });

  it("asks the registry for milli-cents per hour, never an unstated unit", () => {
    // $17.13 is 1_713_000 milli-cents, 1_713 cents and 1_713 as milli-percent.
    // All three are plausible integers, so the unit is named at the call site
    // and the registry refuses on a mismatch.
    expect(FORM_CODE).toContain('"milli_cents_per_hour"');
  });

  it("renders the refusal when the state has not published a floor for that year", () => {
    // The 2027 case, which is Michael's first payroll year. The screen must
    // show the refusal's whatToDo rather than falling back to $17.13.
    expect(FORM_CODE).toContain("minimumWageForHireDate.whatToDo");
    // And it must distinguish "no date typed yet" from "date typed, no rate
    // exists". Collapsing those two tells a user to go find a notice when all
    // they did was leave the date blank.
    expect(FORM_CODE).toContain("minimumWageForHireDate === null");
  });
});

// ===========================================================================
describe("the pay-frequency dropdown offers exactly what can be stored", () => {
  it("iterates the engine's own list rather than a hand-typed set of options", () => {
    expect(FORM_CODE).toContain("ALL_PAY_FREQUENCIES.map");
    // Named <option> elements for individual cadences would drift from the
    // engine and from migration 0195 independently.
    expect(FORM_CODE).not.toMatch(/<option value="biweekly"/);
  });

  it("and that list is the one migration 0195 accepts", () => {
    // The cross-check itself lives in payroll-migration-0195.test.ts, in both
    // directions. This asserts the SCREEN is wired to the same list, so the
    // three-way agreement (screen / engine / database) is complete rather than
    // two-thirds done. That gap was real: the CHECK accepted six cadences
    // while the engine had eight, verified against live PostgreSQL.
    expect(ALL_PAY_FREQUENCIES.length).toBe(8);
    expect(FORM_CODE).toContain("PAY_FREQUENCY_LABELS[f]");
  });

  it("pre-selects biweekly, which is a fact about Greenway", () => {
    // Michael: "every two weeks on friday". Sage defaults to Weekly while he
    // pays biweekly, which silently mis-annualizes every withholding figure -
    // 52 vs 26 is a 2x error in the annualized wage.
    expect(FORM_CODE).toContain('payFrequency: "biweekly"');
  });
});

// ===========================================================================
describe("the SSN is masked by default and the reveal is logged", () => {
  it("the full number is never sent to the browser with the page", () => {
    // The page hands the component a MASKED value only. The full number is
    // fetched by an action that writes the audit row before it reads.
    expect(PAGE_CODE).toContain("maskedSsnOnFile");
    expect(PAGE_CODE).not.toContain("ssn_full");
    expect(PAGE_CODE).not.toContain("formatSsnUnmasked");
  });

  it("the reveal requires a reason", () => {
    expect(FORM_CODE).toContain("revealReason");
    expect(ACTIONS_CODE).toContain("reason: input.reason");
  });

  it("the roster masks from the last four, NOT by re-masking a full number", () => {
    // The store's roster type carries last-four only, by design.
    expect(PAGE_CODE).toContain("maskFromLastFour");
  });

  it("maskSsn() cannot be used on a four-digit value - PROVEN, not assumed", () => {
    // THE DEFECT THIS PINS. The page originally passed ssnLastFour into
    // maskSsn(). maskSsn normalises to nine digits first and returns the
    // unknown-mask for anything else, so the result blanked out the only four
    // digits the mask exists to preserve - the ones that let two employees be
    // told apart. Behaviour verified by running it:
    expect(maskSsn("1234")).toBe("XXX-XX-????");
    expect(maskSsn("123456789")).toBe("XXX-XX-6789");
    // ...so the page must not do it, in either file.
    expect(PAGE_CODE).not.toMatch(/maskSsn\(\s*\w*[sS]snLastFour/);
    expect(PAGE_CODE).not.toMatch(/maskSsn\(\s*r\.ssnLastFour/);
  });
});

// ===========================================================================
describe("the screen extends the existing page rather than replacing it", () => {
  it("the books-13 teaching sections are still there", () => {
    // Rule 25: extend, do not duplicate. The lessons this page already taught
    // are not collateral damage of adding data entry to it.
    for (const heading of [
      "What the W-4 controls",
      "Filing statuses",
      "When an employee gives you nothing",
    ]) {
      expect(PAGE, `the section "${heading}" was lost`).toContain(heading);
    }
  });

  it("there is exactly one payroll setup page, not a second one alongside it", () => {
    expect(PAGE_CODE).toContain("EmployeePayrollSetupForm");
    expect(PAGE_CODE).toContain("listEmployeeSetup");
  });

  it("says plainly when migration 0195 has not been applied", () => {
    // The owner applies migrations by hand. A form whose Save always fails
    // because the tables do not exist yet is the opposite of a safety net.
    expect(PAGE_CODE).toContain("migrationApplied");
    expect(PAGE).toContain("0195_employee_payroll_setup.sql");
  });
});
