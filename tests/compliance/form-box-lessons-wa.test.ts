/**
 * tests/compliance/form-box-lessons-wa.test.ts
 *
 * The Washington quarterly returns — the forms Michael said he cares about most.
 *
 * Two kinds of gate here, and both matter:
 *
 *   1. VERBATIM (rules 24, 35). Every quote is checked against the mirrored RCW
 *      text on disk. A misquoted statute is worse than an uncited one, because it
 *      is authority-shaped and wrong.
 *
 *   2. RE-DERIVED ARITHMETIC (rule 83). Every figure in every worked example is
 *      recomputed here from the rates, in integer arithmetic, and compared to the
 *      string the lesson shows Michael. A worked example with a wrong total
 *      teaches the wrong thing with complete confidence.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  GREENWAY_LNI_RISK_CLASS,
  RCW_50A_10_030_PATH,
  RCW_50_12_070_PATH,
  RCW_50_24_010_PATH,
  RCW_51_16_140_PATH,
  WAC_192_310_010_PATH,
  WA_QUARTERLY_LESSONS,
} from "@/lib/payroll/form-box-lessons-wa";
import { lessonFor, lessonsForForm } from "@/lib/payroll/form-box-core";
// The engine's own rounding helper. Re-implementing it here would let a wrong
// lesson and a wrong test agree with each other (rule 39).
import { hourlyPremiumCents } from "@/lib/payroll/wa-quarterly-core";

const corpora = new Map<string, string>([
  [RCW_50_24_010_PATH, readFileSync(RCW_50_24_010_PATH, "utf8")],
  [RCW_50A_10_030_PATH, readFileSync(RCW_50A_10_030_PATH, "utf8")],
  [RCW_51_16_140_PATH, readFileSync(RCW_51_16_140_PATH, "utf8")],
  /*
   * Added in books-56, when the six untaught Washington boxes were taught.
   *
   * WAC 192-310-010 was cited by four authority records before this slice with
   * NO held text behind it, so this gate could not check those quotes at all.
   * The rule is now mirrored, and the first thing done with the mirror was to
   * re-check all four pre-existing quotes: all four verify byte for byte. That
   * was luck rather than proof until the file existed, which is the argument
   * for holding the text of anything we quote.
   */
  [WAC_192_310_010_PATH, readFileSync(WAC_192_310_010_PATH, "utf8")],
  /*
   * Added in books-64 for the 12th-day headcount lesson.
   *
   * This map is the reason the gate has teeth: a lesson that quotes a file NOT
   * listed here fails on "no mirrored corpus" rather than passing unchecked.
   * That is how the first draft of the headcount lesson was caught, and it is
   * why the path is imported from the lessons module rather than retyped -
   * a retyped path could drift from the one the lesson actually cites, and the
   * gate would then verify a file nobody quotes.
   */
  [RCW_50_12_070_PATH, readFileSync(RCW_50_12_070_PATH, "utf8")],
]);

describe("every RCW quote is really in the statute", () => {
  it("finds each quoted passage verbatim in the mirrored file", () => {
    let checked = 0;
    for (const lesson of WA_QUARTERLY_LESSONS) {
      for (const q of lesson.quotes) {
        const corpus = corpora.get(q.sourcePath);
        expect(corpus, `no mirrored corpus for ${q.sourcePath}`).toBeDefined();
        expect(
          corpus!.includes(q.quote),
          `${lesson.formId} ${lesson.box}: quote NOT found verbatim in ${q.sourcePath}:\n${q.quote}`,
        ).toBe(true);
        checked += 1;
      }
    }
    // Rule 66d: assert existence before absence.
    expect(checked).toBeGreaterThanOrEqual(6);
    console.log(`WA lessons: ${checked} statutory quotes verified verbatim`);
  });

  it("gives every quote an openable URL, never a repo path", () => {
    for (const lesson of WA_QUARTERLY_LESSONS) {
      for (const q of lesson.quotes) {
        expect(q.sourceUrl.startsWith("https://")).toBe(true);
        expect(q.sourceUrl).not.toContain("docs/");
        expect(q.soWhat.length).toBeGreaterThan(30);
      }
    }
  });
});

describe("the arithmetic in every worked example is re-derived, not trusted", () => {
  it("unemployment: $100,000 at 0.37% is $370.00", () => {
    const wagesCents = 100_000_00;
    const milliPct = 370;
    const taxCents = Math.round((wagesCents * milliPct) / 100_000);
    expect(taxCents).toBe(370_00);
    const l = lessonFor(WA_QUARTERLY_LESSONS, "esd_5208a", "esd-ui")!;
    expect(l.examples[0].answer).toBe("$370.00");
  });

  it("EAF: $100,000 at 0.03% is $30.00", () => {
    const taxCents = Math.round((100_000_00 * 30) / 100_000);
    expect(taxCents).toBe(30_00);
    const l = lessonFor(WA_QUARTERLY_LESSONS, "esd_5208a", "esd-eaf")!;
    expect(l.examples[0].answer).toBe("$30.00");
  });

  it("Paid Leave: 1.13% of wages, then 71.43% of THE PREMIUM, is $807.16", () => {
    // The two-step calculation the lesson insists on. Collapsing it into one
    // rate is the mistake being taught against, so the test does it in two.
    const wagesCents = 100_000_00;
    const premiumCents = Math.round((wagesCents * 1_130) / 100_000);
    expect(premiumCents).toBe(1_130_00);
    const employeeCents = Math.round((premiumCents * 71_430) / 100_000);
    expect(employeeCents).toBe(807_16);
    const l = lessonFor(WA_QUARTERLY_LESSONS, "pfml_wa_cares", "pfml-employee")!;
    expect(l.examples[0].answer).toBe("$807.16");
  });

  it("WA Cares: $100,000 at 0.58% is $580.00", () => {
    const taxCents = Math.round((100_000_00 * 580) / 100_000);
    expect(taxCents).toBe(580_00);
    const l = lessonFor(WA_QUARTERLY_LESSONS, "pfml_wa_cares", "wa-cares")!;
    expect(l.examples[0].answer).toBe("$580.00");
  });

  it("L&I employee: 3,558 hours at $0.16445 is $585.11, and NOT half the premium", () => {
    // Re-derived through the ENGINE's own helper, in the engine's own units:
    // whole hours, rates in milli-cents per hour. Not a private re-implementation
    // in this test, because a re-implementation can agree with a wrong lesson.
    const hours = 3_558;
    const employeeMilliCents = 16_445;
    const employerMilliCents = 39_485;

    const employeeCents = hourlyPremiumCents(hours, employeeMilliCents);
    const employerCents = hourlyPremiumCents(hours, employerMilliCents);
    expect(employeeCents).toBe(585_11);
    // 3,558 x 0.39485 = 1,404.8763, which ROUNDS to 1,404.88. Truncating to
    // 1,404.87 was a real defect in this lesson that this line caught.
    expect(employerCents).toBe(1_404_88);

    // The premium L&I actually bills is computed on the COMBINED rate, which is
    // how the rate notice quotes it - and it equals the figure filed for Q2 2026.
    const totalCents = hourlyPremiumCents(hours, employeeMilliCents + employerMilliCents);
    expect(totalCents).toBe(1_989_99);

    // THE TRAP, PROVEN ARITHMETICALLY: half the premium is a bigger number.
    const halfThePremium = Math.round(totalCents / 2);
    expect(halfThePremium).toBe(995_00);
    expect(halfThePremium).toBeGreaterThan(employeeCents);
    expect(halfThePremium - employeeCents).toBe(409_89);

    const l = lessonFor(WA_QUARTERLY_LESSONS, "lni_quarterly", "lni-employee")!;
    expect(l.examples[0].answer).toContain("$585.11");
    expect(l.examples[0].answer).toContain("$995.00");
    expect(l.examples[0].steps.join(" ")).toContain("$409.89");
    // The lesson must quote the premium that was really filed, to the cent.
    expect(l.examples[0].steps.join(" ")).toContain("$1,989.99");
  });

  it("L&I employer share is more than twice the employee share for this risk class", () => {
    const employeeCents = hourlyPremiumCents(3_558, 16_445);
    const employerCents = hourlyPremiumCents(3_558, 39_485);
    expect(employerCents).toBeGreaterThan(employeeCents * 2);
    const l = lessonFor(WA_QUARTERLY_LESSONS, "lni_quarterly", "lni-employer")!;
    expect(l.examples[0].answer).toBe("$1,404.88");

    // The lesson claims a share of the total; prove the claimed percentage is the
    // real one rather than a round number someone liked the sound of.
    const totalCents = hourlyPremiumCents(3_558, 16_445 + 39_485);
    const employerPctToTwoDp = ((employerCents / totalCents) * 100).toFixed(2);
    expect(employerPctToTwoDp).toBe("70.60");
    expect(l.examples[0].steps.join(" ")).toContain("70.60%");
  });

  it("shows real steps and a moral in every example", () => {
    const examples = WA_QUARTERLY_LESSONS.flatMap((l) => l.examples);
    expect(examples.length).toBeGreaterThanOrEqual(7);
    for (const ex of examples) {
      expect(ex.steps.length).toBeGreaterThanOrEqual(3);
      expect(ex.moral.length).toBeGreaterThan(30);
    }
  });
});

describe("the criminal-exposure trap is taught, not softened", () => {
  const lni = () => lessonFor(WA_QUARTERLY_LESSONS, "lni_quarterly", "lni-employee")!;

  it("says the deduction is half the MEDICAL AID part, not half the premium", () => {
    const l = lni();
    expect(l.plainEnglish).toContain("MEDICAL BENEFITS");
    expect(l.plainEnglish.toLowerCase()).toContain("not permit deducting half of the total premium");
  });

  it("names the criminal consequence in the lesson, not only in the statute", () => {
    const l = lni();
    const text = `${l.plainEnglish} ${l.commonMistake}`;
    expect(text.toUpperCase()).toContain("GROSS MISDEMEANOUR");
  });

  it("quotes both subsections of RCW 51.16.140", () => {
    const cites = lni().quotes.map((q) => q.cite);
    expect(cites).toContain("RCW 51.16.140(1)");
    expect(cites).toContain("RCW 51.16.140(2)");
  });

  it("quotes the 'or attempt to make' language, because the offence precedes the money", () => {
    const quoted = lni().quotes.map((q) => q.quote).join("\n");
    expect(quoted).toContain("attempt to make any such deduction shall be a gross misdemeanor");
  });

  it("says unemployment may not be deducted in whole OR IN PART", () => {
    const l = lessonFor(WA_QUARTERLY_LESSONS, "esd_5208a", "esd-ui")!;
    const quoted = l.quotes.map((q) => q.quote).join("\n");
    expect(quoted).toContain("in whole or in part");
    expect(quoted).toContain("shall be unlawful");
  });
});

describe("a correct zero is explained, never left silent", () => {
  it("explains that Greenway's employer PFML share is zero BY EXEMPTION", () => {
    const l = lessonFor(WA_QUARTERLY_LESSONS, "pfml_wa_cares", "pfml-employer")!;
    expect(l.plainEnglish).toContain("CORRECT ANSWER");
    expect(l.examples[0].answer).toBe("$0.00");
    expect(l.examples[0].moral.toLowerCase()).toContain("exemption working");
  });

  it("quotes the fewer-than-50 exemption that makes the zero right", () => {
    const l = lessonFor(WA_QUARTERLY_LESSONS, "pfml_wa_cares", "pfml-employer")!;
    const quoted = l.quotes.map((q) => q.quote).join("\n");
    expect(quoted).toContain("fewer than 50 employees");
    expect(quoted).toContain("not required to pay the employer portion");
  });

  it("warns the size test is a 30 September average, not a live headcount", () => {
    const l = lessonFor(WA_QUARTERLY_LESSONS, "pfml_wa_cares", "pfml-employer")!;
    const quoted = l.quotes.map((q) => q.quote).join("\n");
    expect(quoted).toContain("September 30th");
    expect(quoted).toContain("average the number of employees");
    expect(l.commonMistake).toContain("Counting today's employees");
  });
});

describe("WA Cares and Paid Leave must not be conflated", () => {
  it("states WA Cares has no wage cap", () => {
    const l = lessonFor(WA_QUARTERLY_LESSONS, "pfml_wa_cares", "wa-cares")!;
    expect(l.plainEnglish).toContain("NO WAGE CAP");
    expect(l.commonMistake).toContain("Applying the Paid Leave wage cap");
  });

  it("routes both to W-2 box 14, never box 17", () => {
    for (const boxId of ["pfml-employee", "wa-cares"]) {
      const l = lessonFor(WA_QUARTERLY_LESSONS, "pfml_wa_cares", boxId)!;
      const tie = l.tiesTo.find((t) => t.formId === "form_w2");
      expect(tie, `${boxId} must tie to the W-2`).toBeDefined();
      expect(tie!.box).toBe("14");
      expect(tie!.why).toContain("box 17");
    }
  });
});

describe("the L&I hours box teaches the thing only it can teach", () => {
  const hours = () => lessonFor(WA_QUARTERLY_LESSONS, "lni_quarterly", "lni-hours")!;

  it("explains that workers' comp is priced on time, not wages", () => {
    expect(hours().plainEnglish).toContain("per HOUR WORKED");
    expect(hours().plainEnglish).toContain(GREENWAY_LNI_RISK_CLASS);
  });

  it("shows that a raise costs nothing here and overtime costs twice", () => {
    const ex = hours().examples[0];
    const joined = ex.steps.join(" ");
    expect(joined).toContain("unchanged");
    expect(ex.moral.toLowerCase()).toContain("overtime is expensive twice");
  });

  it("warns against reporting paid hours instead of hours worked", () => {
    // commonMistake is deliberately nullable on BoxLesson, because some boxes
    // have no common mistake worth naming. This one must have one, so prove it
    // is present before reading it rather than asserting the type away.
    const mistake = hours().commonMistake;
    expect(mistake).not.toBeNull();
    expect(mistake).toContain("hours WORKED");
    expect(mistake!.toLowerCase()).toContain("vacation");
  });
});

describe("coverage: every WA form has taught boxes", () => {
  it("covers all three money-bearing WA forms", () => {
    expect(lessonsForForm(WA_QUARTERLY_LESSONS, "esd_5208a").length).toBeGreaterThanOrEqual(2);
    expect(lessonsForForm(WA_QUARTERLY_LESSONS, "pfml_wa_cares").length).toBeGreaterThanOrEqual(3);
    expect(lessonsForForm(WA_QUARTERLY_LESSONS, "lni_quarterly").length).toBeGreaterThanOrEqual(3);
  });

  it("gives every lesson the full set of teaching fields", () => {
    for (const l of WA_QUARTERLY_LESSONS) {
      expect(l.headline.length).toBeGreaterThan(20);
      expect(l.plainEnglish.length).toBeGreaterThan(120);
      expect(l.whereItComesFrom.length).toBeGreaterThan(80);
      expect(l.howToReadIt.length).toBeGreaterThan(80);
      expect(l.whatToDo.length).toBeGreaterThan(50);
      expect(l.commonMistake).not.toBeNull();
      expect(l.commonMistake!.length).toBeGreaterThan(60);
    }
  });

  it("uses stable box ids that match the engine's own line ids", () => {
    // These strings are the contract with wa-quarterly-core's WaQuarterLine.id.
    // If the engine renames a line, the adapter test catches it — but this list
    // is what makes the failure legible.
    const ids = WA_QUARTERLY_LESSONS.map((l) => `${l.formId}:${l.box}`);
    expect(ids).toContain("esd_5208a:esd-ui");
    expect(ids).toContain("esd_5208a:esd-eaf");
    expect(ids).toContain("pfml_wa_cares:pfml-employee");
    expect(ids).toContain("pfml_wa_cares:pfml-employer");
    expect(ids).toContain("pfml_wa_cares:wa-cares");
    expect(ids).toContain("lni_quarterly:lni-hours");
    expect(ids).toContain("lni_quarterly:lni-employee");
    expect(ids).toContain("lni_quarterly:lni-employer");
  });
});
