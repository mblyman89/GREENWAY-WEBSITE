/**
 * tests/compliance/internal-control-core.test.ts   (books-28)
 *
 * THE ENGINE THAT REFUSES TO AVERAGE.
 *
 * COSO's rule is that one major deficiency stops the conclusion. That is a
 * REFUSAL, and standing rule 60 says a branch that excuses a difference must be
 * tested on the day it refuses to - so most of this file is about making the
 * engine say "no" for the right reason, not about the happy path.
 *
 * The other theme is the difference between "we looked and it is broken" and
 * "nobody looked". Treating silence as a pass is the most flattering bug a
 * control review can have, so it is tested directly.
 */
import { describe, expect, it } from "vitest";

import {
  assessPrinciple,
  changeRiskForCutover,
  controlAuthorityFor,
  describeComponent,
  evaluateInternalControlSystem,
  segregationOfDutiesFinding,
  type PrincipleAssessment,
} from "@/lib/accounting/internal-control-core";
import {
  assertEveryCitedAuthorityExists,
  assertEveryExportedFunctionIsTaught,
  exportedCoreFunctionNames,
  findControlLesson,
  INTERNAL_CONTROL_LESSONS,
  lessonsByComponent,
  principleNumbersFor,
  taughtFunctionNames,
} from "@/lib/accounting/internal-control-mentor";

/** A full set of clean answers, for tests that need one. */
function allGood(): PrincipleAssessment[] {
  return Array.from({ length: 17 }, (_, i) => ({
    principle: i + 1,
    state: "present_and_functioning" as const,
    reason: `Principle ${i + 1} is done this way, by this person, on this schedule.`,
  }));
}

describe("describeComponent", () => {
  it("returns the component with its principles", () => {
    const c = describeComponent("Control Environment");
    expect(c?.principleNumbers).toEqual([1, 2, 3, 4, 5]);
    expect(c?.plainEnglish.length).toBeGreaterThan(60);
  });

  it("is forgiving about case and stray spaces", () => {
    expect(describeComponent("  risk assessment ")?.component).toBe("Risk Assessment");
  });

  it("returns undefined for something that is not a component, rather than throwing", () => {
    expect(describeComponent("Vibes")).toBeUndefined();
  });
});

describe("assessPrinciple refuses answers that cannot mean anything", () => {
  it("accepts a real answer with a reason", () => {
    const r = assessPrinciple({
      principle: 5,
      state: "present_and_functioning",
      reason: "Angela counts the drawer at close and initials the sheet; I check it weekly.",
    });
    expect(r.problems).toEqual([]);
    expect(r.assessment?.principle).toBe(5);
  });

  it.each([0, 18, -1, 1.5, Number.NaN])("refuses principle number %s", (n) => {
    const r = assessPrinciple({ principle: n, state: "absent", reason: "x" });
    expect(r.assessment).toBeUndefined();
    expect(r.problems.length).toBeGreaterThan(0);
    expect(r.problems[0].problem).toContain("seventeen COSO principles");
  });

  it("refuses a tick with no reason", () => {
    const r = assessPrinciple({ principle: 3, state: "present_and_functioning" });
    expect(r.assessment).toBeUndefined();
    expect(r.problems[0].problem).toContain("needs a reason");
  });

  it("allows not_assessed with no reason, because that IS the honest state", () => {
    const r = assessPrinciple({ principle: 3, state: "not_assessed" });
    expect(r.problems).toEqual([]);
    expect(r.assessment?.state).toBe("not_assessed");
  });

  it("treats whitespace as no reason at all", () => {
    const r = assessPrinciple({ principle: 3, state: "absent", reason: "   \n  " });
    expect(r.assessment).toBeUndefined();
    expect(r.problems[0].problem).toContain("needs a reason");
  });

  /**
   * THE FLATTERING CONTRADICTION. Marking a principle fully satisfied while
   * listing what compensates for it is the exact shape of a review that wants
   * to pass. Rule 60: this is the refusal branch, so it gets its own test.
   */
  it("refuses 'fully working' AND compensating controls in the same breath", () => {
    const r = assessPrinciple({
      principle: 10,
      state: "present_and_functioning",
      reason: "One person does it all but I watch closely.",
      compensatingControls: ["Owner reviews the bank feed weekly"],
    });
    expect(r.assessment).toBeUndefined();
    expect(r.problems[0].problem).toContain("Pick one");
  });

  it("accepts compensating controls alongside an honest partial answer", () => {
    const r = assessPrinciple({
      principle: 10,
      state: "present_not_functioning",
      reason: "One person records, counts, pays and reconciles.",
      compensatingControls: ["Owner reviews what the owner did not enter", "Bank feed match"],
    });
    expect(r.problems).toEqual([]);
    expect(r.assessment?.compensatingControls).toHaveLength(2);
  });

  it("reports EVERY fault at once, not one per submission", () => {
    const r = assessPrinciple({ principle: 99, state: "present_and_functioning" });
    // Bad number AND missing reason - a form should show both.
    expect(r.problems.length).toBe(2);
  });
});

describe("evaluateInternalControlSystem does not average", () => {
  it("calls a complete clean review effective", () => {
    const v = evaluateInternalControlSystem(allGood());
    expect(v.effective).toBe(true);
    expect(v.blockers).toEqual([]);
    expect(v.unanswered).toEqual([]);
    expect(v.counts.present_and_functioning).toBe(17);
    expect(v.conclusion).toContain("reasonably say your controls");
  });

  /**
   * SIXTEEN OF SEVENTEEN IS NOT 94 PER CENT. This is the whole reason the
   * verdict is a boolean with named blockers instead of a score.
   */
  it("one absent principle sinks the whole conclusion", () => {
    const a = allGood();
    a[9] = { principle: 10, state: "absent", reason: "Nobody separates the duties and nothing covers it." };
    const v = evaluateInternalControlSystem(a);
    expect(v.effective).toBe(false);
    expect(v.blockers).toHaveLength(1);
    expect(v.blockers[0].principle).toBe(10);
    expect(v.conclusion).toContain("cannot be called effective");
    // And it must NOT offer a comforting percentage anywhere.
    expect(v.conclusion).not.toMatch(/\d+\s?%/);
    expect(v.conclusion).toContain("not a score you can average up");
  });

  /**
   * THE QUIET FAILURE. Present on paper, not running. COSO counts this as a
   * deficiency, and it is the one small businesses actually have.
   */
  it("counts 'exists but does not run' as a blocker, not partial credit", () => {
    const a = allGood();
    a[0] = {
      principle: 1,
      state: "present_not_functioning",
      reason: "We have a written code of conduct that nobody has read since 2019.",
    };
    const v = evaluateInternalControlSystem(a);
    expect(v.effective).toBe(false);
    expect(v.blockers[0].why).toContain("exists on paper but is not actually running");
  });

  /**
   * SILENCE IS NOT CONSENT. An unanswered principle must never be counted as a
   * pass, and the message must distinguish it from a failure.
   */
  it("never treats an unanswered principle as a pass", () => {
    const v = evaluateInternalControlSystem(allGood().slice(0, 16));
    expect(v.effective).toBe(false);
    expect(v.unanswered).toEqual([17]);
    expect(v.blockers).toEqual([]);
    expect(v.conclusion).toContain("An unanswered question is not a pass");
  });

  it("treats an explicit not_assessed exactly like a missing answer", () => {
    const a = allGood();
    a[4] = { principle: 5, state: "not_assessed", reason: "" };
    const v = evaluateInternalControlSystem(a);
    expect(v.unanswered).toEqual([5]);
    expect(v.counts.not_assessed).toBe(1);
  });

  it("an empty review is not an effective one", () => {
    const v = evaluateInternalControlSystem([]);
    expect(v.effective).toBe(false);
    expect(v.unanswered).toHaveLength(17);
    expect(v.counts.not_assessed).toBe(17);
  });

  it("names every blocker, not just the first", () => {
    const a = allGood();
    a[1] = { principle: 2, state: "absent", reason: "No independent oversight at all." };
    a[6] = { principle: 7, state: "absent", reason: "Risks were never listed." };
    a[15] = { principle: 16, state: "present_not_functioning", reason: "Nobody has reviewed it this year." };
    const v = evaluateInternalControlSystem(a);
    expect(v.blockers.map((b) => b.principle)).toEqual([2, 7, 16]);
    expect(v.conclusion).toContain("2, 7, 16");
  });

  it("mentions unanswered principles as well as failures when both exist", () => {
    const a = allGood().slice(0, 15);
    a[3] = { principle: 4, state: "absent", reason: "No training, no retention, no records." };
    const v = evaluateInternalControlSystem(a);
    expect(v.conclusion).toContain("were never answered");
  });

  it("uses singular English for a single blocker", () => {
    const a = allGood();
    a[0] = { principle: 1, state: "absent", reason: "Not in place." };
    const v = evaluateInternalControlSystem(a);
    // "1 principle ... is not working" - a report that says "1 principles are"
    // reads as broken and undermines trust in the number beside it.
    expect(v.conclusion).toContain("1 principle ");
    expect(v.conclusion).not.toContain("1 principles");
  });

  it("counts add up to seventeen no matter what went in", () => {
    const a = allGood();
    a[2] = { principle: 3, state: "absent", reason: "no" };
    a[3] = { principle: 4, state: "present_not_functioning", reason: "lapsed" };
    const v = evaluateInternalControlSystem(a.slice(0, 16));
    const total = Object.values(v.counts).reduce((x, y) => x + y, 0);
    expect(total).toBe(17);
  });

  it("ignores a duplicate answer rather than double-counting it", () => {
    const a = allGood();
    a.push({ principle: 1, state: "absent", reason: "Contradicts the earlier answer." });
    const v = evaluateInternalControlSystem(a);
    // Last answer for a principle wins; the totals must still be 17.
    const total = Object.values(v.counts).reduce((x, y) => x + y, 0);
    expect(total).toBe(17);
  });
});

describe("segregationOfDutiesFinding tells the truth about a one-person department", () => {
  it("finds the weakness when one person holds all four duties", () => {
    const f = segregationOfDutiesFinding({
      recordsTransactions: true,
      holdsCashOrInventory: true,
      authorisesPayments: true,
      reconcilesAccounts: true,
    });
    expect(f.weaknessExists).toBe(true);
    expect(f.conflictingDuties).toHaveLength(4);
    expect(f.finding).toContain("will not be fixed by being careful");
  });

  it("says loudly when NOTHING is written down to cover it", () => {
    const f = segregationOfDutiesFinding({
      recordsTransactions: true,
      holdsCashOrInventory: true,
      authorisesPayments: false,
      reconcilesAccounts: true,
    });
    expect(f.finding).toContain("NOTHING IS WRITTEN DOWN");
    expect(f.compensatingControls).toEqual([]);
  });

  it("recognises documented compensating controls as the defensible position", () => {
    const f = segregationOfDutiesFinding({
      recordsTransactions: true,
      holdsCashOrInventory: true,
      authorisesPayments: true,
      reconcilesAccounts: true,
      compensatingControls: [
        "Owner reviews every entry the owner did not make",
        "Bank feed matched against records nobody can silently edit",
        "Audit trail retained",
      ],
    });
    expect(f.finding).toContain("defensible position");
    expect(f.finding).not.toContain("NOTHING IS WRITTEN DOWN");
    expect(f.compensatingControls).toHaveLength(3);
  });

  /** The refusal direction: no conflict must NOT be reported as one. */
  it("reports no weakness when the duties are actually split", () => {
    const f = segregationOfDutiesFinding({
      recordsTransactions: true,
      holdsCashOrInventory: false,
      authorisesPayments: false,
      reconcilesAccounts: false,
    });
    expect(f.weaknessExists).toBe(false);
    expect(f.finding).toContain("No conflict here");
  });

  it("reports no weakness when this person holds none of them", () => {
    const f = segregationOfDutiesFinding({
      recordsTransactions: false,
      holdsCashOrInventory: false,
      authorisesPayments: false,
      reconcilesAccounts: false,
    });
    expect(f.weaknessExists).toBe(false);
    expect(f.conflictingDuties).toEqual([]);
  });

  it("two duties is already a conflict - the threshold is not four", () => {
    const f = segregationOfDutiesFinding({
      recordsTransactions: true,
      holdsCashOrInventory: false,
      authorisesPayments: false,
      reconcilesAccounts: true,
    });
    expect(f.weaknessExists).toBe(true);
    expect(f.conflictingDuties).toEqual(["records the transactions", "reconciles the accounts"]);
  });

  it("always cites the authority behind the finding", () => {
    const f = segregationOfDutiesFinding({
      recordsTransactions: true,
      holdsCashOrInventory: true,
      authorisesPayments: true,
      reconcilesAccounts: true,
    });
    expect(f.authorityIds).toContain("green-book-2025-segregation-of-duties");
    for (const id of f.authorityIds) expect(controlAuthorityFor(id)).toBeDefined();
  });
});

describe("changeRiskForCutover", () => {
  it("names concrete risks, each with a control", () => {
    const risks = changeRiskForCutover();
    expect(risks.length).toBeGreaterThanOrEqual(4);
    for (const r of risks) {
      expect(r.risk.length).toBeGreaterThan(30);
      expect(r.whyItMatters.length).toBeGreaterThan(60);
      // A risk list with no control beside it is just anxiety.
      expect(r.control.length).toBeGreaterThan(40);
    }
  });

  it("covers the payroll year-boundary risk specifically", () => {
    const text = changeRiskForCutover().map((r) => `${r.risk} ${r.whyItMatters} ${r.control}`).join(" ");
    expect(text).toContain("W-2");
    expect(text).toContain("2027");
    expect(text.toLowerCase()).toContain("opening");
  });
});

describe("controlAuthorityFor returns verified words or nothing", () => {
  it("finds a real authority", () => {
    const a = controlAuthorityFor("coso-2013-definition-of-internal-control");
    expect(a?.quote).toContain("reasonable assurance");
  });

  it("returns undefined for an id that does not exist, rather than a near miss", () => {
    expect(controlAuthorityFor("coso-2013-principle-18-invented")).toBeUndefined();
    expect(controlAuthorityFor("")).toBeUndefined();
  });
});

describe("the mentor teaches every function, provably", () => {
  it("every exported engine function has a lesson", () => {
    expect(() => assertEveryExportedFunctionIsTaught()).not.toThrow();
    expect(taughtFunctionNames()).toHaveLength(INTERNAL_CONTROL_LESSONS.length);
  });

  it("reads a real, non-empty list of exports from disk", () => {
    // Guard against a vacuous gate: if the regex stopped matching, the gate
    // would approve everything forever.
    const exported = exportedCoreFunctionNames();
    expect(exported.length).toBeGreaterThanOrEqual(6);
    expect(exported).toContain("evaluateInternalControlSystem");
  });

  /**
   * PROVE THE GATE FIRES (standing rule 16). Point it at a file that exports a
   * function nobody taught and require a throw. Without this the only evidence
   * the gate works is that it has never complained.
   */
  it("THROWS when an exported function has no lesson", () => {
    const decoy = "/tmp/internal-control-core-decoy.ts";
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { writeFileSync } = require("node:fs") as typeof import("node:fs");
    writeFileSync(decoy, "export function aFunctionNobodyTaught(): void {}\n");
    expect(() => assertEveryExportedFunctionIsTaught(decoy)).toThrow(/MENTOR COVERAGE GAP/);
  });

  it("THROWS when it can read no exports at all, instead of passing vacuously", () => {
    const empty = "/tmp/internal-control-core-empty.ts";
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { writeFileSync } = require("node:fs") as typeof import("node:fs");
    writeFileSync(empty, "// nothing exported here\nconst x = 1;\n");
    expect(() => assertEveryExportedFunctionIsTaught(empty)).toThrow(/GATE BROKEN/);
  });

  it("every authority a lesson cites actually exists", () => {
    expect(() => assertEveryCitedAuthorityExists()).not.toThrow();
  });

  it("every lesson is substantial, not a placeholder", () => {
    for (const l of INTERNAL_CONTROL_LESSONS) {
      expect(l.plainEnglish.length, `${l.fn} plainEnglish`).toBeGreaterThan(60);
      expect(l.whyItExists.length, `${l.fn} whyItExists`).toBeGreaterThan(100);
      expect(l.theTrap.length, `${l.fn} theTrap`).toBeGreaterThan(80);
      expect(l.whatIWouldDo.length, `${l.fn} whatIWouldDo`).toBeGreaterThan(60);
      expect(l.authorityIds.length, `${l.fn} cites nothing`).toBeGreaterThan(0);
    }
  });

  it("finds a lesson by function name", () => {
    expect(findControlLesson("segregationOfDutiesFinding")?.theTrap).toContain("embarrassing");
    expect(findControlLesson("noSuchFunction")).toBeUndefined();
  });
});

describe("principleNumbersFor reads the number out of the id", () => {
  it("extracts single and double digit principle numbers", () => {
    expect(principleNumbersFor("coso-2013-principle-3-structures")).toEqual([3]);
    expect(principleNumbersFor("coso-2013-principle-17-communicates-deficiencies")).toEqual([17]);
    expect(principleNumbersFor("green-book-2025-principle-1-integrity")).toEqual([1]);
  });

  it("returns nothing for ids that are not principle statements", () => {
    // The definition and the limitation records are not principles, and
    // pretending otherwise would put them under a component they do not belong to.
    expect(principleNumbersFor("coso-2013-definition-of-internal-control")).toEqual([]);
    expect(principleNumbersFor("green-book-2025-segregation-of-duties")).toEqual([]);
  });

  it("refuses a number outside 1-17 even if the id looks right", () => {
    expect(principleNumbersFor("coso-2013-principle-18-invented")).toEqual([]);
    expect(principleNumbersFor("coso-2013-principle-0-invented")).toEqual([]);
  });
});

describe("lessonsByComponent walks COSO's own structure", () => {
  it("returns all five components", () => {
    const byComponent = lessonsByComponent();
    expect(byComponent).toHaveLength(5);
    expect(byComponent.map((c) => c.component)).toContain("Monitoring Activities");
  });

  it("attaches at least one lesson to every component", () => {
    // A component with no lesson attached is a hole in the teaching, and it
    // would show up on the review screen as an empty section.
    for (const c of lessonsByComponent()) {
      expect(c.lessons.length, `${c.component} has no lesson`).toBeGreaterThan(0);
    }
  });
});
