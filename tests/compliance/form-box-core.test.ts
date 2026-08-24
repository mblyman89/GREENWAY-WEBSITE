/**
 * tests/compliance/form-box-core.test.ts
 *
 * The generic Form/Why/Check model. Every assertion here is about a rule that,
 * if broken, produces a screen that LOOKS right — which is why they exist.
 */
import { describe, it, expect } from "vitest";
import {
  ALL_FORM_TABS,
  ALL_WHOSE_MONEY,
  boxIsEmpty,
  boxTone,
  formatBoxValue,
  formatMilliPct,
  formTabLabel,
  formTabPurpose,
  lessonFor,
  lessonsForForm,
  splitMeaning,
  splitMoney,
  whoseMoneyConsequence,
  whoseMoneyLabel,
  whoseMoneyTone,
  __runFormBoxCoreTests,
  type BoxLesson,
  type FormBox,

} from "@/lib/payroll/form-box-core";

function box(over: Partial<FormBox>): FormBox {
  return {
    formId: "test_form",
    box: "1",
    caption: "Test box",
    measure: "money",
    amountCents: 0,
    quantity: null,
    whose: "employer_cost",
    derivation: "test",
    blankOnPurpose: null,
    notComputedYet: null,
    emphasise: false,
    ...over,
  };
}

describe("form-box-core self-tests", () => {
  it("passes its embedded suite", () => {
    expect(() => __runFormBoxCoreTests()).not.toThrow();
    console.log("form-box-core: PASSED embedded self-tests");
  });
});

describe("the unit of a box is never assumed", () => {
  it("never prints a dollar sign on an hours box", () => {
    const b = box({ measure: "hours", amountCents: 0, quantity: 355_800 });
    expect(formatBoxValue(b)).toBe("3,558.00 hours");
    expect(formatBoxValue(b)).not.toContain("$");
  });

  it("never prints a dollar sign on a count box", () => {
    const b = box({ measure: "count", amountCents: 0, quantity: 12 });
    expect(formatBoxValue(b)).toBe("12");
    expect(formatBoxValue(b)).not.toContain("$");
  });

  it("carries hours in hundredths so a half hour survives", () => {
    // 7.5 hours = 750 hundredths. A whole-number hours field would lose this.
    const b = box({ measure: "hours", amountCents: 0, quantity: 750 });
    expect(formatBoxValue(b)).toBe("7.50 hours");
  });

  it("formats money exactly, including one cent and negatives", () => {
    expect(formatBoxValue(box({ amountCents: 1 }))).toBe("$0.01");
    expect(formatBoxValue(box({ amountCents: 0 }))).toBe("$0.00");
    expect(formatBoxValue(box({ amountCents: -2_500 }))).toBe("-$25.00");
    expect(formatBoxValue(box({ amountCents: 1_143_900 }))).toBe("$11,439.00");
  });

  it("judges a money box on its cents even if a stray quantity is present", () => {
    expect(boxIsEmpty(box({ measure: "money", amountCents: 0, quantity: 999 }))).toBe(true);
  });

  it("does not call a zero-hours box non-empty just because cents are zero", () => {
    expect(boxIsEmpty(box({ measure: "hours", amountCents: 0, quantity: 0 }))).toBe(true);
    expect(boxIsEmpty(box({ measure: "hours", amountCents: 0, quantity: 1 }))).toBe(false);
  });
});

describe("trap 2: a deliberate blank must never look like a forgotten one", () => {
  it("paints a blank-on-purpose box neutral even when it is employee money", () => {
    const b = box({
      whose: "employee_money",
      blankOnPurpose: "Washington has no personal income tax.",
    });
    expect(boxTone(b)).toBe("neutral");
  });

  it("still paints an ordinary employee-money box green", () => {
    expect(boxTone(box({ whose: "employee_money" }))).toBe("green");
  });

  it("gives blank-on-purpose precedence over EVERY money category", () => {
    // Rule 34: run the gate in both directions. If any category could override
    // the neutral, box 17 would be coloured as though money had moved.
    // Walked from the exported vocabulary, not a copy typed here: a hand-typed
    // list silently stops covering a category the day a new one is added (rule 43).
    for (const whose of ALL_WHOSE_MONEY) {
      expect(boxTone(box({ whose, blankOnPurpose: "correct reason" }))).toBe("neutral");
    }
  });
});

describe("whose money it is — the legal distinction, not a label", () => {
  it("gives every category a label, a consequence and a tone", () => {
    for (const w of ALL_WHOSE_MONEY) {
      expect(whoseMoneyLabel(w).length).toBeGreaterThan(3);
      expect(whoseMoneyConsequence(w).length).toBeGreaterThan(40);
      expect(whoseMoneyTone(w)).toBeTruthy();
    }
  });

  it("cites the statute that makes deducting employer cost unlawful", () => {
    const c = whoseMoneyConsequence("employer_cost");
    expect(c).toContain("RCW 50.24.010");
    expect(c).toContain("RCW 51.16.140(2)");
    expect(c).toContain("gross misdemeanour");
  });

  it("says employee money is held as agent, and cites where that word comes from", () => {
    const c = whoseMoneyConsequence("employee_money");
    expect(c).toContain("RCW 50A.10.030(7)(b)");
    expect(c.toLowerCase()).toContain("agent");
  });

  it("warns that the L&I deduction is half the MEDICAL AID part, not half the premium", () => {
    const c = whoseMoneyConsequence("shared");
    expect(c).toContain("RCW 51.16.140(1)");
    expect(c).toContain("MEDICAL AID");
    // The trap is thinking "half the premium". The text must say that is wrong.
    expect(c.toLowerCase()).toContain("half the whole premium is not the same");
  });

  it("treats a wage base as something NOBODY owes", () => {
    // Form 941 line 2 and Form 940 line 3 are wages. They are the biggest
    // figures on either form and no one owes a cent of them. Reading a base as
    // an amount due is the classic misreading of a payroll return.
    const c = whoseMoneyConsequence("tax_base");
    expect(c).toContain("Nobody owes");
    expect(c.toLowerCase()).toContain("wages");
    expect(whoseMoneyLabel("tax_base").toLowerCase()).toContain("not the tax");
  });

  it("keeps a wage base VISUALLY QUIET even though it is the biggest number", () => {
    // The tempting change is to colour the biggest figure. That would send the
    // eye to the one box that carries no obligation.
    expect(whoseMoneyTone("tax_base")).toBe("neutral");
  });

  it("keeps a wage base OUT of the employer/employee split", () => {
    const fica = [
      box({ box: "employee-fica", amountCents: 527_36, whose: "employee_money" }),
      box({ box: "employer-fica", amountCents: 527_36, whose: "employer_cost" }),
    ];
    const clean = splitMoney(fica);
    const polluted = splitMoney([
      box({ box: "2", amountCents: 6_892_345, whose: "tax_base" }),
      ...fica,
    ]);
    expect(polluted.totalCents).toBe(clean.totalCents);
    // FICA is 50/50 by law. If the base leaked in it would read about 87/13,
    // which is wrong AND plausible - the worst combination.
    expect(polluted.employerMilliPct).toBe(50_000);
    expect(polluted.employeeMilliPct).toBe(50_000);
  });

  it("gives the four categories four DISTINCT tones where it matters", () => {
    // employer/employee/shared must be visually distinguishable or the palette
    // teaches nothing.
    const tones = new Set([
      whoseMoneyTone("employer_cost"),
      whoseMoneyTone("employee_money"),
      whoseMoneyTone("shared"),
    ]);
    expect(tones.size).toBe(3);
  });
});

describe("the money split must not double-count a total line", () => {
  const lni = [
    box({ box: "hours", measure: "hours", quantity: 355_800, whose: "shared" }),
    box({ box: "employee", amountCents: 58_511, whose: "employee_money" }),
    box({ box: "employer", amountCents: 140_467, whose: "employer_cost" }),
    box({ box: "total", amountCents: 198_978, whose: "shared" }),
  ];

  it("counts only the component boxes", () => {
    const s = splitMoney(lni);
    expect(s.employeeCents).toBe(58_511);
    expect(s.employerCents).toBe(140_467);
    expect(s.totalCents).toBe(198_978);
  });

  it("cross-foots against the form's own total line", () => {
    // The whole point: our computed total must equal the total the FORM prints.
    const s = splitMoney(lni);
    const printedTotal = lni.find((b) => b.box === "total")!.amountCents;
    expect(s.totalCents).toBe(printedTotal);
  });

  it("produces percentages that sum to 100%", () => {
    const s = splitMoney(lni);
    expect((s.employerMilliPct ?? 0) + (s.employeeMilliPct ?? 0)).toBeCloseTo(100_000, -1);
  });

  it("ignores hours boxes entirely — hours are not money", () => {
    const onlyHours = splitMoney([
      box({ measure: "hours", quantity: 355_800, whose: "shared" }),
    ]);
    expect(onlyHours.totalCents).toBe(0);
  });

  it("returns NULL percentages on a zero total, never zero", () => {
    const s = splitMoney([box({ amountCents: 0 })]);
    expect(s.employerMilliPct).toBeNull();
    expect(s.employeeMilliPct).toBeNull();
  });

  it("says a nil return still has to be filed", () => {
    const s = splitMoney([box({ amountCents: 0 })]);
    expect(splitMeaning(s)).toContain("still has to be filed");
  });

  it("says plainly when none of the money was Greenway's", () => {
    const s = splitMoney([box({ amountCents: 5_000, whose: "employee_money" })]);
    expect(splitMeaning(s)).toContain("never your money");
  });

  it("says plainly when all of it was Greenway's own cost", () => {
    const s = splitMoney([box({ amountCents: 5_000, whose: "employer_cost" })]);
    expect(splitMeaning(s)).toContain("Greenway's own cost");
    expect(splitMeaning(s)).toContain("None of it came out");
  });

  it("names both figures when the money is mixed", () => {
    const s = splitMoney([
      box({ amountCents: 140_467, whose: "employer_cost" }),
      box({ amountCents: 58_511, whose: "employee_money" }),
    ]);
    const m = splitMeaning(s);
    expect(m).toContain("$1,404.67");
    expect(m).toContain("$585.11");
    expect(m).toContain("$1,989.78");
    expect(m).toContain("never your money");
  });

  it("formats a milli-percent the way the State writes it", () => {
    expect(formatMilliPct(71_430)).toBe("71.43%");
    expect(formatMilliPct(580)).toBe("0.58%");
    expect(formatMilliPct(100_000)).toBe("100.00%");
  });
});

describe("the three tabs are the workflow", () => {
  it("has exactly three, in Form → Why → Check order", () => {
    expect(ALL_FORM_TABS).toEqual(["form", "why", "check"]);
  });

  it("gives each tab a label and a promise about what it holds", () => {
    for (const t of ALL_FORM_TABS) {
      expect(formTabLabel(t).length).toBeGreaterThan(2);
      expect(formTabPurpose(t).length).toBeGreaterThan(30);
    }
  });

  it("promises the Why tab quotes the law word for word", () => {
    expect(formTabPurpose("why").toLowerCase()).toContain("word for word");
  });

  it("tells the reader the Form tab is clickable", () => {
    expect(formTabPurpose("form").toLowerCase()).toContain("click");
  });
});

describe("lesson lookup is scoped to a form", () => {
  const stub = (formId: string, boxNo: string): BoxLesson => ({
    formId,
    box: boxNo,
    headline: `${formId} ${boxNo}`,
    plainEnglish: "x",
    whereItComesFrom: "x",
    howToReadIt: "x",
    commonMistake: null,
    whatToDo: "x",
    examples: [],
    quotes: [],
    tiesTo: [],
  });
  const lessons = [stub("form_941", "1"), stub("form_w2", "1"), stub("form_941", "5a")];

  it("does not confuse two forms that both have a box 1", () => {
    expect(lessonFor(lessons, "form_941", "1")?.headline).toBe("form_941 1");
    expect(lessonFor(lessons, "form_w2", "1")?.headline).toBe("form_w2 1");
  });

  it("returns undefined rather than a stand-in lesson", () => {
    // Rule 50: a cheerful "no guidance available" panel looks like teaching, so
    // the reader stops looking for the real answer.
    expect(lessonFor(lessons, "form_940", "1")).toBeUndefined();
  });

  it("returns every lesson for one form", () => {
    expect(lessonsForForm(lessons, "form_941")).toHaveLength(2);
    expect(lessonsForForm(lessons, "form_940")).toHaveLength(0);
  });
});
