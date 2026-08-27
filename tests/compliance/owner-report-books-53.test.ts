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
  /*
   * books-65: the five identity fields were missing from this list, and their
   * absence was a real defect rather than a tidy omission.
   *
   * Michael reported it directly: "i input all my company info into the company
   * info page and have green checks for all of them. but when i view the forms,
   * they do not populate with my company data in them." The cause (D-15) was
   * that the teaching specimen emitted no identity boxes at all, so all five of
   * his stored values had nowhere to land.
   *
   * They ARE printed on the paper. Measured, not assumed, with
   *   pdftotext -layout -f 1 -l 1 2ND_QTR_FORM_941.pdf
   * against his own filed second-quarter return, which prints:
   *   "Employer identification number  (EIN)  4 6 - 4 2 1 7 0 1 6"
   *   "Name (not your trade name)   LYMAN'S MARIJUANA"
   *   "Trade name (if any)   GREENWAY MARIJUANA"
   *   "Address        4851 GEIGER RD SE"
   *   "               PORT ORCHARD        WA     98366"
   * so this list was incomplete and the engine was right to emit them.
   */
  "ein",
  "name",
  "tradeName",
  "address",
  "cityStateZip",
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

/**
 * The five identity fields, separated from the numbered lines.
 *
 * books-65 added them to LABELS_ON_THE_PRINTED_941 because they really are
 * printed on the paper (see the measurement in that list). But every historical
 * claim in the books-53 letter - "all 27", "27 attempted, 27 caught" - is about
 * the NUMBERED lines, and those still number exactly 27. Keeping the two apart
 * lets the letter's figures stay checkable instead of being quietly redefined.
 */
const IDENTITY_FIELDS_ON_THE_941: readonly string[] = [
  "ein",
  "name",
  "tradeName",
  "address",
  "cityStateZip",
];

const NUMBERED_LINES_ON_THE_941 = LABELS_ON_THE_PRINTED_941.filter(
  (l) => !IDENTITY_FIELDS_ON_THE_941.includes(l),
);

describe("the report's completeness claim is true", () => {
  it("agrees with the printed form on how many lines Form 941 has", () => {
    // 27 NUMBERED lines, and specifically 27 -- not "at least 27". A form cannot
    // grow a line without the IRS reissuing it, so drift here means someone
    // invented a box. The five identity fields are counted separately; they are
    // printed on the form but they are not numbered lines, and conflating the
    // two would quietly redefine every "27" in the books-53 letter.
    expect(NUMBERED_LINES_ON_THE_941.length).toBe(27);
    expect(new Set(NUMBERED_LINES_ON_THE_941).size).toBe(27);
    // And the whole list, identity fields included, is still free of duplicates.
    expect(LABELS_ON_THE_PRINTED_941.length).toBe(32);
    expect(new Set(LABELS_ON_THE_PRINTED_941).size).toBe(32);
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
    /*
     * 27 -> 32 in books-61, DELIBERATELY.
     *
     * The five added are not lines: they are `ein`, `name`, `tradeName`,
     * `address` and `cityStateZip` - the entity area at the top of page 1. They
     * were added because the 941 was rendering with no EIN and no business name
     * on either page (18 of page 1's 70 rectangles and 32 of page 2's 35 were
     * going unplaced), and a return the IRS cannot match to a taxpayer is not a
     * return.
     *
     * They are classified `not_money`, which is the honest answer: an address
     * is nobody's money. The pin moves rather than being relaxed, so the next
     * unexplained change still fails here.
     */
    expect(Object.keys(FORM_941_WHOSE).length).toBe(32);
  });
});

describe("every figure in the report is re-derived, not remembered", () => {
  it("states the 941 line count the engine actually reports", () => {
    /*
     * books-65: the engine now emits 32, not 27. The extra five are the identity
     * fields (EIN, name, trade name, address, city/state/ZIP), which is D-15 -
     * the defect behind Michael's report that his company information never
     * appeared on the forms despite being stored correctly.
     *
     * The books-53 letter is NOT edited. Its "all 27" was true of the numbered
     * lines then and is still true of them now, so both facts are asserted: the
     * letter's words, and today's real total.
     */
    const taughtCount = teachingBoxes("form_941").length;
    expect(taughtCount).toBe(32);
    expect(taughtCount).toBe(
      NUMBERED_LINES_ON_THE_941.length + IDENTITY_FIELDS_ON_THE_941.length,
    );
    // The headline claim, in the two forms the report words it, still standing.
    expect(REPORT).toContain("from 13 lines to all 27");
    expect(REPORT).toContain("**27 — the whole form**");
    // ...and it is still true of the numbered lines specifically.
    const taughtBoxes941 = teachingBoxes("form_941").map((b) => b.box);
    for (const line of NUMBERED_LINES_ON_THE_941) {
      expect(taughtBoxes941, `numbered line ${line} is no longer emitted`).toContain(line);
    }
  });

  it("states the lesson count the engine actually reports", () => {
    // A ratchet: more lessons is progress, fewer means something was deleted.
    const lessons = FORM_941_LESSONS.length;
    expect(lessons).toBeGreaterThanOrEqual(20);
    const claimed = /\| Full written lessons \| 5 \| \*\*(\d+)\*\* \|/.exec(REPORT);
    expect(claimed, "the report must state a lesson count in its table").not.toBeNull();
    expect(Number(claimed![1])).toBeLessThanOrEqual(lessons);
  });

  /**
   * ═══ WHY THIS TEST NOW CARRIES TWO NUMBERS PER FORM (books-54) ═══
   *
   * It used to assert one figure per form and use it for both sides: the engine
   * must teach exactly N boxes, AND the report must contain "| N |". That works
   * only while coverage is frozen. books-54 took Form 940 from 18 boxes to 30,
   * and the test failed with `expected 30 to be 18` — correctly, because the
   * report does say 18.
   *
   * The tempting fix is to relax the engine side to `toBeGreaterThanOrEqual`.
   * That would be a QUIET LOOSENING: the report's figure would then only have
   * to appear somewhere in the document, and would no longer be checked against
   * anything at all. The whole point of this file is that the report's numbers
   * are re-derived rather than remembered.
   *
   * So both sides stay exact and are simply named separately:
   *
   *   `claimed` — what the books-53 letter told Michael, and must still say.
   *   `engineNow` — what the engine teaches today.
   *
   * When coverage grows, `engineNow` must be edited deliberately, and the diff
   * shows the growth. When they differ, the comment must say why. A silent
   * change to either is still a failure.
   */
  it("states a per-form coverage table that matches the engine", () => {
    // Rule 66d: prove the rows exist before trusting what they say.
    const expected: readonly {
      readonly formId: string;
      readonly claimed: number;
      readonly engineNow: number;
      readonly note: string | null;
    }[] = [
      {
        formId: "form_941",
        claimed: 27,
        engineNow: 32,
        note:
          "books-65 added the five identity fields printed above line 1: EIN, name (not your " +
          "trade name), trade name, address and city/state/ZIP. Like the W-2 row below and " +
          "unlike the 940 row, 27 was NOT true when it was written \u2014 it was a complete count of " +
          "an incomplete form. The five were missing for the same reason the W-2's were: every " +
          "slice built the form outward from what the engine COMPUTES, and the engine computes " +
          "money, not a company's name. This is D-15, and it is the direct cause of Michael's " +
          "report that \"i input all my company info into the company info page and have green " +
          "checks for all of them. but when i view the forms, they do not populate with my " +
          "company data in them.\" With no boxes to land in, all five stored values had nowhere " +
          "to go. Measured against his own filed return with pdftotext, which prints all five.",
      },
      {
        formId: "form_w2",
        claimed: 20,
        engineNow: 26,
        note:
          "books-56 added the six lettered boxes the paper prints above box 1: a (employee's " +
          "SSN), b (employer's EIN), c (employer's name and address), d (control number), e " +
          "(employee's name) and f (employee's address). Unlike the 940 row below, 20 was NOT " +
          "true when it was written — it was a complete count of an incomplete form. The six " +
          "were missing because every slice built this form outward from what the W-2 engine " +
          "computes, and the engine computes money; nothing computes a person's name. Found by " +
          "assertEveryTieResolves refusing a new ESD 5208B lesson's tie to form_w2 box e.",
      },
      {
        formId: "form_940",
        claimed: 18,
        engineNow: 35,
        note:
          "books-54 added the twelve lines that are printed on the paper form but carry no " +
          "amount: 1a, 1b, 2, 4a-4e and 15b-15e. The books-53 letter said 18 and 18 was true " +
          "when it was written. books-65 then added the same five identity fields as the 941 " +
          "row above \u2014 same defect, same cause, same measurement \u2014 taking 30 to 35.",
      },
      {
        formId: "esd_5208a",
        claimed: 3,
        engineNow: 5,
        note:
          "books-64 added the two boxes that bite on the unemployment return: line 14 (excess " +
          "wages) and line 12 (the number of employees paid in the payroll period containing " +
          "the 12th day of each month). 3 was true when the books-53 letter was written \u2014 the " +
          "form taught exactly the three boxes the ENGINE emits, being the UI tax, the EAF tax " +
          "and their total. The two added here emit no amount and are deliberately not " +
          "computed: excess wages is derived on the worksheet by subtraction, and the headcount " +
          "is a fact about three specific dates that this system does not hold. They are taught " +
          "because they are the two boxes on this return Michael can get wrong without any " +
          "arithmetic disagreeing with him.",
      },
      { formId: "esd_5208b", claimed: 4, engineNow: 4, note: null },
      { formId: "pfml_wa_cares", claimed: 3, engineNow: 3, note: null },
      { formId: "lni_quarterly", claimed: 4, engineNow: 4, note: null },
    ];

    for (const row of expected) {
      // The engine side: exact, so a box lost anywhere fails here.
      expect(
        teachingBoxes(row.formId).length,
        `${row.formId} teaches a different number of boxes than this test pins`,
      ).toBe(row.engineNow);

      // The report side: exact, so the letter cannot be quietly edited either.
      expect(
        REPORT.includes(`| ${row.claimed} |`) || REPORT.includes(`| **${row.claimed}** |`),
        `the report's coverage table should carry the figure ${row.claimed} for ${row.formId}`,
      ).toBe(true);

      // A divergence between the two must be EXPLAINED, not merely allowed.
      if (row.claimed !== row.engineNow) {
        expect(
          row.note,
          `${row.formId} now teaches ${row.engineNow} boxes but the report says ` +
            `${row.claimed}, and no reason is recorded`,
        ).not.toBeNull();
        // Coverage may grow. It may never shrink below what Michael was told.
        expect(
          row.engineNow,
          `${row.formId} teaches FEWER boxes than the books-53 letter promised`,
        ).toBeGreaterThan(row.claimed);
      }
    }

    /*
     * Rule 39: if `expected` were ever emptied the loop above would pass in
     * silence. Pinned to the number of forms the engine actually teaches, so
     * adding a form without adding a row here fails.
     */
    expect(expected).toHaveLength(7);
  });

  /*
   * ═══ CLOSED IN books-55. THE PREDICTION IN THE OLD COMMENT CAME TRUE. ═══
   *
   * The original comment on this test read: "If someone fills the W-3 in, this
   * gate fails and the report must stop calling it empty -- which is the
   * correct outcome, not a nuisance." That is exactly what happened, so the
   * assertion is being changed deliberately and the reason is recorded here
   * rather than in a commit message nobody re-reads.
   *
   * What is NOT being changed is the books-53 report itself. It said the W-3
   * taught nothing, and at books-53 that was true. A report is a statement
   * about a date. Editing it to match today would destroy the only record of
   * what was known then, so the report text is still asserted verbatim below —
   * only the claim about TODAY'S code is updated.
   */
  it("was honest that Form W-3 taught nothing, a hole now closed", () => {
    // The report's own words, unchanged, because they were true when written.
    expect(REPORT).toContain("Form W-3");
    expect(REPORT.toLowerCase()).toContain("teaches nothing");

    // And the state of the code TODAY: the hole is closed, not merely renamed.
    expect(ALL_TAUGHT_FORM_IDS).toContain("form_w3");
    expect(() => teachingBoxes("form_w3")).not.toThrow();
    expect(teachingBoxes("form_w3").length).toBe(31);
  });

  it("counts the mutation experiments as one per printed line", () => {
    // "27 attempted, 27 caught" is only meaningful if 27 is the line count.
    // books-65 added five identity fields to the printed-labels list, so the
    // count that makes this sentence true is the NUMBERED-line count, which is
    // unchanged. The mutation run itself was one per numbered line.
    expect(REPORT).toContain("**27 caught, 0 survived.**");
    expect(REPORT).toContain("**27 attempted, 27 caught, 0 survived**");
    expect(NUMBERED_LINES_ON_THE_941.length).toBe(27);
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
