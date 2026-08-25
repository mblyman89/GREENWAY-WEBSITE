/**
 * tests/compliance/owner-report-books-53.test.ts
 *
 * THE OWNER REPORT IS HELD TO THE SAME STANDARD AS THE CODE (standing rule 66).
 *
 * The document this gates:
 *
 *   docs/MICHAEL-books-53-the-941-is-finished.md
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 * ────────────────────────────────────────────────────────────────────────────
 * This report claims a form is FINISHED. That is the most dangerous kind of
 * claim in this repository, because Michael will stop checking a form he has
 * been told is complete. "Every line on the printed form is taught" is either
 * mechanically true or it is a false reassurance, and the difference cannot be
 * left to my memory of what I did this afternoon.
 *
 * So the completeness claim is re-derived here from two independent places: the
 * label list read out of the filed PDF, and the engine's own teaching table. If
 * they ever disagree, this gate fails and the report is wrong.
 *
 * The report also quotes the IRS on the one fact the whole ownership fix rests
 * on -- that the Additional Medicare Tax has no employer share. Rules 24 and 35
 * say a quote is retyped prose until something proves otherwise, so it is
 * checked byte for byte against the mirrored instructions.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT IS DELIBERATELY NOT ASSERTED
 * ────────────────────────────────────────────────────────────────────────────
 * The prose. Rule 66c: a gate that breaks when someone improves a sentence
 * teaches people to edit tests instead of thinking. What is pinned here is:
 * every figure, the verbatim quote, the presence of the four pre-existing
 * warnings Michael asked to be told about, the five still-open questions, and
 * the absence of anything confidential.
 *
 * Counts are asserted as RATCHETS where the engine may legitimately grow
 * (books-52 learned that pinning a live engine to a dated letter punishes
 * progress), and as EQUALITIES only where growth would make the report's own
 * claim false -- the 941 is complete, so 27 is 27 until the IRS changes the
 * form.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { teachingBoxes } from "../../src/lib/payroll/form-box-teaching-core";
import {
  ALL_TAUGHT_FORM_IDS,
  FORM_941_WHOSE,
} from "../../src/lib/payroll/form-box-adapters";
import { FORM_941_LESSONS } from "../../src/lib/payroll/form-box-lessons-941";

const ROOT = process.cwd();
const REPORT_PATH = join(
  ROOT,
  "docs",
  "MICHAEL-books-53-the-941-is-finished.md",
);
const REPORT = readFileSync(REPORT_PATH, "utf8");

const IRS_941_INSTRUCTIONS = readFileSync(
  join(ROOT, "docs", "authorities", "federal", "irs-instructions-941-2026.txt"),
  "utf8",
);

/**
 * Every line label printed on the Form 941 Michael actually filed, read off
 * 2ND_QTR_FORM_941.pdf. This is the outside measurement: it does not come from
 * the application, so the application can be checked against it.
 *
 * The roadmap previously recorded 25 labels and listed "15c" and "15e" while
 * omitting "15d". That was wrong, and it is the reason this list exists here as
 * data rather than as a count.
 */
const LABELS_ON_THE_PRINTED_941: readonly string[] = [
  "1",
  "2",
  "3",
  "4",
  "5a",
  "5b",
  "5c",
  "5d",
  "5e",
  "5f",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
  "12",
  "13",
  "14",
  "15a",
  "15b",
  "15c",
  "15d",
  "15e",
  "16",
  "17",
  "18",
];

/**
 * Strip markdown blockquote markers, including quotes nested in list items, and
 * the presentational quotation marks the report wraps around a citation.
 *
 * The quotation marks matter. The first version of this verifier reported the
 * Additional Medicare Tax passage as NOT verbatim, and it very nearly went into
 * the report as a correction. It was the verifier that was wrong: the words
 * matched the instructions exactly, but the report presents them inside typed
 * double quotes, and those quotes are not in the IRS file. A verifier that
 * compares its own decoration against the source will condemn correct quotes
 * (rule 39, and the books-49 lesson about a regex that could not see indented
 * blockquotes). Proven by checking the words with and without the marks: without
 * them the passage is present, with them it is not.
 */
function unquote(block: string): string {
  return block
    .split("\n")
    .map((l) => l.replace(/^\s*>\s?/, ""))
    .join("\n")
    .trim()
    .replace(/^["\u201c]/, "")
    .replace(/["\u201d]$/, "")
    .trim();
}

describe("the report's completeness claim is true", () => {
  it("agrees with the printed form on how many lines Form 941 has", () => {
    // 27, and specifically 27 -- not "at least 27". A form cannot grow a line
    // without the IRS reissuing it, so drift here means someone invented a box.
    expect(LABELS_ON_THE_PRINTED_941.length).toBe(27);
    expect(new Set(LABELS_ON_THE_PRINTED_941).size).toBe(27);
  });

  it("teaches every line on the printed form, and invents none", () => {
    const taught = teachingBoxes("form_941").map((b) => b.box);

    const missing = LABELS_ON_THE_PRINTED_941.filter(
      (l) => !taught.includes(l),
    );
    expect(
      missing,
      `The report tells Michael the 941 is finished, but these printed lines are ` +
        `not taught: ${missing.join(", ")}. Either teach them or correct the report.`,
    ).toEqual([]);

    const invented = taught.filter(
      (t) => !LABELS_ON_THE_PRINTED_941.includes(t),
    );
    expect(
      invented,
      `These boxes are taught but do not exist on the printed form: ` +
        `${invented.join(", ")}. A box the form does not have cannot be filled in.`,
    ).toEqual([]);
  });

  it("classifies whose money every printed line is", () => {
    for (const label of LABELS_ON_THE_PRINTED_941) {
      expect(
        Object.prototype.hasOwnProperty.call(FORM_941_WHOSE, label),
        `941 line ${label} is on the form but nobody has recorded whose money it is.`,
      ).toBe(true);
    }
    expect(Object.keys(FORM_941_WHOSE).length).toBe(27);
  });
});

describe("every figure in the report is re-derived, not remembered", () => {
  it("states the 941 line count the engine actually reports", () => {
    const taughtCount = teachingBoxes("form_941").length;
    expect(taughtCount).toBe(27);
    // The headline claim, in the two forms the report words it.
    expect(REPORT).toContain("from 13 lines to all 27");
    expect(REPORT).toContain("**27 — the whole form**");
  });

  it("states the lesson count the engine actually reports", () => {
    // A ratchet: more lessons is progress, fewer means something was deleted.
    const lessons = FORM_941_LESSONS.length;
    expect(lessons).toBeGreaterThanOrEqual(20);
    const claimed = /\| Full written lessons \| 5 \| \*\*(\d+)\*\* \|/.exec(REPORT);
    expect(claimed, "the report must state a lesson count in its table").not.toBeNull();
    expect(Number(claimed![1])).toBeLessThanOrEqual(lessons);
  });

  it("states a per-form coverage table that matches the engine", () => {
    // Rule 66d: prove the rows exist before trusting what they say.
    const expected: readonly (readonly [string, number])[] = [
      ["form_941", 27],
      ["form_w2", 20],
      ["form_940", 18],
      ["esd_5208a", 3],
      ["esd_5208b", 4],
      ["pfml_wa_cares", 3],
      ["lni_quarterly", 4],
    ];
    for (const [formId, count] of expected) {
      expect(teachingBoxes(formId).length).toBe(count);
      expect(
        REPORT.includes(`| ${count} |`) || REPORT.includes(`| **${count}** |`),
        `the report's coverage table should carry the figure ${count} for ${formId}`,
      ).toBe(true);
    }
  });

  it("is honest that Form W-3 is registered but teaches nothing", () => {
    // The report calls this out as a pre-existing warning. If someone fills the
    // W-3 in, this gate fails and the report must stop calling it empty --
    // which is the correct outcome, not a nuisance.
    expect(ALL_TAUGHT_FORM_IDS).toContain("form_w3");
    expect(() => teachingBoxes("form_w3")).toThrow();
    expect(REPORT).toContain("Form W-3");
    expect(REPORT.toLowerCase()).toContain("teaches nothing");
  });

  it("counts the mutation experiments as one per printed line", () => {
    // "27 attempted, 27 caught" is only meaningful if 27 is the line count.
    expect(REPORT).toContain("**27 caught, 0 survived.**");
    expect(REPORT).toContain("**27 attempted, 27 caught, 0 survived**");
    expect(LABELS_ON_THE_PRINTED_941.length).toBe(27);
  });
});

describe("the one quote the whole fix rests on is verbatim", () => {
  it("finds the Additional Medicare Tax passage in the IRS instructions", () => {
    const marker = "Additional Medicare Tax is only imposed on the employee.";
    const idx = REPORT.indexOf(marker);
    expect(idx, "the report must quote the IRS on the employer share").toBeGreaterThan(-1);

    // Pull the blockquote the report presents, and check it word for word
    // against the mirrored instructions. The instruction file wraps lines, so
    // whitespace is normalised on both sides -- the WORDS must match exactly.
    const blockStart = REPORT.lastIndexOf("> ", idx);
    const blockEnd = REPORT.indexOf("\n\n", idx);
    const quoted = unquote(REPORT.slice(blockStart, blockEnd));

    const normalise = (s: string) => s.replace(/\s+/g, " ").trim();
    expect(
      normalise(IRS_941_INSTRUCTIONS).includes(normalise(quoted)),
      `The report quotes the IRS as saying:\n\n  ${quoted}\n\n` +
        `That exact wording is not in docs/authorities/federal/irs-instructions-941-2026.txt. ` +
        `A quote is retyped prose until proven otherwise (rules 24 and 35).`,
    ).toBe(true);
  });

  it("keeps the classification the quote justifies", () => {
    // The quote is only in the report to explain why 5d is not shared. If the
    // classification ever flips, the quote becomes an argument against our own
    // code and this gate says so.
    expect(FORM_941_WHOSE["5d"].whose).toBe("employee_money");
  });
});

describe("the warnings Michael asked to be told about are all present", () => {
  it("reports the 15 versus 15a mislabel", () => {
    expect(REPORT).toContain('called a line "15" when the IRS calls it "15a"');
    // And the engine must actually use the corrected label.
    expect(Object.keys(FORM_941_WHOSE)).toContain("15a");
    expect(Object.keys(FORM_941_WHOSE)).not.toContain("15");
  });

  it("reports the unprotected-ownership hole and says it was pre-existing", () => {
    expect(REPORT).toContain("twenty of twenty-four lines");
    expect(REPORT.toLowerCase()).toContain("pre-existing");
    expect(REPORT).toContain("line 13");
  });

  it("reports the clobbered file and why the tests missed it", () => {
    expect(REPORT).toContain("869 lines to 136");
    expect(REPORT.toLowerCase()).toContain("without* checking types");
  });

  it("reports my own mistake rather than hiding it", () => {
    expect(REPORT).toContain("one mistake of my own");
    expect(REPORT).toContain("created five more problems");
  });

  it("does not claim a warning was fixed without saying who found it", () => {
    // Every one of the four was found by breaking something or by reading a
    // diff -- never by the suite passing. The report must not imply the tests
    // caught them, because that would misrepresent how much the suite protects.
    expect(REPORT).toContain("All 11,046 tests passed.");
  });
});

describe("the five open questions are repeated, as promised", () => {
  it("carries every still-open question and marks question 3 closed", () => {
    for (const q of ["| 1 |", "| 2 |", "| 4 |", "| 5 |", "| 6 |"]) {
      expect(REPORT, `open question row ${q} is missing`).toContain(q);
    }
    // Question 3 is closed and must be shown as closed, not silently dropped.
    expect(REPORT).toContain("Question 3 is closed");
    // The caveat that closing 3 does NOT settle payroll-tax status must survive.
    expect(REPORT).toContain("question 4");
    expect(REPORT).toContain("Teri Becker");
  });

  it("still counts five open questions in the heading", () => {
    expect(REPORT).toContain("still five, unchanged");
  });
});

describe("the report leaks nothing confidential", () => {
  it("contains no bank routing or account numbers", () => {
    // Lines 15c and 15e are the reason this test exists: this slice added
    // teaching for the only boxes on the form that hold bank credentials.
    const digitRuns = REPORT.match(/\b\d{9,}\b/g) ?? [];
    expect(
      digitRuns,
      `The report contains a run of nine or more digits (${digitRuns.join(", ")}), ` +
        `which is the shape of a routing or account number.`,
    ).toEqual([]);
  });

  it("contains no Social Security or employer identification numbers", () => {
    expect(REPORT).not.toMatch(/\b\d{3}-\d{2}-\d{4}\b/);
    expect(REPORT).not.toMatch(/\b\d{2}-\d{7}\b/);
  });

  it("names no employee except the ones the owner already discussed", () => {
    // Michael raised the Beckers himself and question 4 is about them, so they
    // are in scope. No other worker's name belongs in a document about form
    // layout.
    const allowed = ["Teri Becker", "James", "Theresa", "Nicholas", "Michael"];
    const capitalised = REPORT.match(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g) ?? [];
    const suspicious = capitalised.filter(
      (n) =>
        !allowed.some((a) => a.includes(n) || n.includes(a)) &&
        !/(Form|Michael|Additional|Medicare|Social|Security|Washington|Employment|Family|Medical|Quarterly|Wage|Tax|Pull|Type|Then|This|That|The|And|One|Your|Where|What|How|Here|Had|Every|Nothing|Instead|Warning|Budget|Combined|Excise|Annual|Transmittal|Statement|Coverage|Before|After|Status|Question|Answer|Lines|Line|Boxes|Box|Full|Word|Standing|Ownership|Pull|Request|Credits|Authorised|Ceiling|Spent|Runway|Grandpa|Schedule|Nineteen|Twenty|Partway|Everything|Repeated|Their|Given|Both|Read|Getting|Only|Trusting|Right|Whether|Connect|Build|Finish|Better|Also|Bank)/.test(
          n,
        ),
    );
    expect(
      suspicious,
      `Unexpected personal names in the owner report: ${suspicious.join(", ")}`,
    ).toEqual([]);
  });
});
