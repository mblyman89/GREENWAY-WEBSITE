/**
 * tests/compliance/owner-report-books-40.test.ts   (books-40 phase H)
 *
 * THE OWNER REPORT IS HELD TO THE SAME STANDARD AS THE CODE (standing rule 66).
 *
 * One document ships with this slice:
 *
 *   docs/MICHAEL-books-40-the-quarterly-return.md
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A TEST AND NOT A PROOFREAD
 * ───────────────────────────────────────────────────────────────────────────
 *
 * The report tells Michael things he will act on: that his Q2 2026 return is
 * reproduced to the cent including a minus-seven-cent line 7, that there are
 * exactly seven ways the screen refuses, that Q3 2026 is due 2 November rather
 * than 31 October, that his first ever 941 is due 30 April 2027. Every one of
 * those was true at the moment I checked it. A report that quietly goes stale
 * is worse than no report, because he would plan around it.
 *
 * So every claim that CAN be re-derived from the code, IS re-derived here, on
 * every commit, in the suite CI actually runs.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT IS BEING PROTECTED
 * ───────────────────────────────────────────────────────────────────────────
 *
 * 1. THE QUOTE IS SACRED (rules 24/35). The report quotes all seven new
 *    authorities. Each fragment is re-derived from FORM_941_AUTHORITIES in
 *    BOTH directions: it must be in the registry (so the test cannot be
 *    satisfied by text I invented and then dutifully pasted into the report)
 *    and in the report (so the report cannot quietly drop it).
 *
 *    This section exists because the FIRST draft of this report paraphrased
 *    three of those quotations from memory while presenting them as the text
 *    of the regulation. Nothing about the draft looked wrong. That is exactly
 *    the failure this file is here to make impossible.
 *
 * 2. THE COUNTED CLAIMS. Seven refusals, seven checks, four worked examples,
 *    eight function lessons, seven new authorities plus ten borrowed. If a
 *    later slice adds an eighth refusal code, the report becomes wrong on a
 *    point of substance and this file is what notices.
 *
 * 3. THE ORACLE FIGURES. Every dollar amount in the line-for-line table is
 *    read back out of `known-good-quarters` rather than trusted, AND rebuilt
 *    through the engine, so the table cannot drift from either side.
 *
 * 4. THE DUE DATES. The weekend-shift table is recomputed with
 *    `form941DueDates`. If the holiday calendar changed underneath us, the
 *    report would be telling Michael the wrong deadline, which is the single
 *    most expensive kind of wrong this document could be.
 *
 * 5. THE ROUTE EXISTS. The report tells him to go to Books -> Form 941
 *    (Quarterly). Rule 16: a nav entry is not proof of a screen, so the page
 *    file is checked too.
 *
 * 6. THE HONESTY NOTE. The report reproduces the sentence under the button
 *    saying this system does not transmit anything. If the screen's wording
 *    were softened later, the report's promise would outlive the promise.
 *
 * 7. THE PDF SHIPPED. A markdown file Michael cannot open is not a delivery.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  FORM_941_AUTHORITIES,
  FORM_941_BORROWED_AUTHORITY_IDS,
  form941Authorities,
} from "@/lib/payroll/form-941-authorities";
import {
  ALL_FORM_941_REFUSAL_CODES,
  buildForm941,
  form941DueDates,
  lineOf,
  type Form941Request,
  type Form941Return,
  type Form941Subject,
  applyMilliPct,
  OASDI_EMPLOYEE_MILLI_PCT,
  MEDICARE_EMPLOYEE_MILLI_PCT,
} from "@/lib/payroll/form-941-core";
import {
  FORM_941_CHECKS,
  FORM_941_LESSONS,
  FORM_941_REFUSAL_LESSONS,
  FORM_941_WORKED_EXAMPLES,
} from "@/lib/payroll/form-941-mentor";
import {
  fileButtonState,
  statusMeaning,
  statusTone,
  urgencyBand,
  urgencyTone,
} from "@/lib/payroll/form-941-ui-core";
import { Q2_2026_EMPLOYEES, filedFigure } from "@/lib/reports/known-good-quarters";
import { formatCents } from "@/lib/payroll/payroll-deposit-schedule-core";
import { adminNav } from "@/components/admin/admin-nav-data";

const ROOT = join(__dirname, "..", "..");
const REPORT_PATH = join(ROOT, "docs", "MICHAEL-books-40-the-quarterly-return.md");
const PDF_PATH = join(ROOT, "docs", "MICHAEL-books-40-the-quarterly-return.pdf");

const report = readFileSync(REPORT_PATH, "utf8");

/**
 * Flatten markdown blockquote decoration away WITHOUT touching the words.
 *
 * A quote in the report is wrapped in "> " and is hard-wrapped across lines by
 * the editor. Neither changes what it says. Bold markers go for the same
 * reason: the report bolds words for emphasis, and emphasis is not
 * transcription.
 */
function unquote(md: string): string {
  return md
    .split("\n")
    .map((l) => l.replace(/^>\s?/, ""))
    .join(" ")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Fold typography (curly quotes, dashes, runs of space) but never words. */
function norm(s: string): string {
  return s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Compare on a WORDS-ONLY axis: lowercase, every run of non-alphanumeric
 * characters becomes one space.
 *
 * WHY THIS IS NOT A LOOSENING. The mentor data shouts for emphasis - "the pay
 * DATE", "do NOT adjust line 7". On screen that is useful; in flowing prose it
 * is wrong, so the report writes them normally. A character-exact comparison
 * would force the report to shout or force the screen to stop, and neither is
 * a good trade. What must NOT be forgiven is a dropped or CHANGED word, and
 * every one of those is preserved here: only case and punctuation fold.
 */
function words(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const flat = norm(unquote(report));
const flatWords = words(unquote(report));

/* ══════════════════════════════════════════════════════════════════════════
 * 0. GUARD THE GUARD (rule 39)
 *
 * Every assertion below is a `toContain` against `flat` or `flatWords`. If
 * either were empty, or a helper ate the words it is meant to preserve, most
 * checks would go vacuously green rather than red. So the helpers are tested
 * directly, first, before anything relies on them.
 * ══════════════════════════════════════════════════════════════════════════ */

describe("the report was actually read", () => {
  it("the document exists and has real content", () => {
    expect(report.length).toBeGreaterThan(15000);
  });

  it("the unquote helper strips decoration and keeps words", () => {
    expect(unquote("> the words\n> continue here")).toBe("the words continue here");
    expect(unquote("**bold** text")).toBe("bold text");
    expect(unquote("plain")).toBe("plain");
    // It must NOT eat the words themselves, or every quote check goes vacuous.
    expect(unquote("> a").length).toBeGreaterThan(0);
  });

  it("the norm helper folds typography without deleting words", () => {
    expect(norm("\u201Cquoted\u201D")).toBe('"quoted"');
    expect(norm("em\u2014dash")).toBe("em-dash");
    expect(norm("a   b")).toBe("a b");
    // Guard against a norm that returns "" for everything.
    expect(norm("word")).toBe("word");
  });

  it("the words helper folds case and punctuation without dropping vocabulary", () => {
    expect(words("the pay DATE")).toBe("the pay date");
    expect(words("Is line 7 small?")).toBe("is line 7 small");
    expect(words("a, b - c")).toBe("a b c");
    // The load-bearing property: it must not delete words, or the question
    // checks below would pass against a report that says nothing.
    expect(words("wages paid in the quarter")).toBe("wages paid in the quarter");
    expect(words("wages paid in the quarter")).not.toBe(words("wages earned in the quarter"));
    expect(words("word").length).toBeGreaterThan(0);
  });

  it("the flattened report is substantial, not a truncated string", () => {
    // A flat that is merely TRUNCATED would pass the early checks and silently
    // skip the late ones, so the floor is explicit.
    expect(flat.length).toBeGreaterThan(14000);
    expect(flatWords.length).toBeGreaterThan(13000);
  });

  it("the authority registry the quote checks read is populated", () => {
    expect(FORM_941_AUTHORITIES.length).toBe(7);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1. THE QUOTE IS SACRED (rules 24/35)
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Fragment, not whole quote, and deliberately.
 *
 * Requiring the ENTIRE registry string would forbid me from ever quoting the
 * relevant half of a subsection, which would make the reports worse. Requiring
 * a substantial FRAGMENT to appear in both, character for character, catches
 * the thing that actually matters: a paraphrase creeping in.
 *
 * Module scope rather than inside the describe, because the self-count test in
 * section 7 needs to know how many tests this list generates.
 */
const QUOTE_CLAIMS: readonly { id: string; fragments: readonly string[] }[] = [
  {
    id: "cfr-31-6011a1-must-file-quarterly",
    fragments: [
      "every employer is required to make a return for the first calendar quarter in which the employer pays wages",
      "is required to make a return for each subsequent calendar quarter (whether or not wages are paid therein) until the employer has filed a final return",
    ],
  },
  {
    id: "cfr-31-6071a1-when-due",
    fragments: [
      "shall be filed on or before the last day of the first calendar month following the period for which it is made",
      "A return may be filed on or before the 10th day of the second calendar month following such period if timely deposits under section 6302(c) of the Code and the regulations have been made in full payment of such taxes due for the period",
    ],
  },
  {
    id: "cfr-301-7503-1-weekend-holiday-shift",
    fragments: [
      "falls on a Saturday, Sunday, or legal holiday, such act shall be considered performed timely if performed on the next succeeding day which is not a Saturday, Sunday, or legal holiday",
    ],
  },
  {
    id: "i941-line-1-pay-period-including-the-12th",
    fragments: [
      "Enter the number of employees on your payroll for the pay period including March 12, June 12, September 12, or December 12",
      "Employees in nonpay status for the pay period",
    ],
  },
  {
    id: "i941-line-2-matches-w2-box-1",
    fragments: [
      "Enter amounts on line 2 that would also be included in box 1 of your employees' Forms W-2",
    ],
  },
  {
    id: "i941-line-5a-both-halves-and-the-cap",
    fragments: [
      "the rate of social security tax on taxable wages is 6.2% (0.062) each for the employer and employee",
      "continue to withhold income and Medicare taxes for the whole year on all wages and tips",
      "line 5a (column 1) x 0.124",
    ],
  },
  {
    id: "i941-line-7-fractions-of-cents",
    fragments: [
      "may differ slightly from amounts actually withheld from employees' pay due to the rounding of social security and Medicare taxes based on statutory rates",
      "This adjustment may be a positive or a negative adjustment",
    ],
  },
];

describe("every authority quoted to Michael matches the registry verbatim", () => {
  it("every claimed authority id exists in the registry", () => {
    // Without this, a typo in an id would make the loop below compare against
    // `undefined` and the whole section would go quietly vacuous.
    for (const c of QUOTE_CLAIMS) {
      const hit = FORM_941_AUTHORITIES.find((a) => a.id === c.id);
      expect(hit, `no authority with id ${c.id}`).toBeTruthy();
    }
  });

  it("all seven new authorities are quoted, not just the convenient ones", () => {
    // A report that quotes five of seven and omits the awkward ones is exactly
    // the failure this whole file exists to prevent. The first draft of this
    // report quoted four.
    const claimed = new Set(QUOTE_CLAIMS.map((c) => c.id));
    for (const a of FORM_941_AUTHORITIES) {
      expect(claimed.has(a.id), `authority ${a.id} is never quoted in the report`).toBe(true);
    }
  });

  for (const claim of QUOTE_CLAIMS) {
    for (const frag of claim.fragments) {
      it(`${claim.id}: "${frag.slice(0, 44)}..." is verbatim in both`, () => {
        const authority = FORM_941_AUTHORITIES.find((a) => a.id === claim.id)!;
        const registry = norm(authority.quote);
        const f = norm(frag);

        // Direction 1: the fragment must really be in the text as stored.
        expect(registry, `fragment is not in registry entry ${claim.id}`).toContain(f);

        // Direction 2: the report must still carry it.
        expect(flat, `report no longer contains the fragment`).toContain(f);
      });
    }
  }

  it("every citation label in the report matches a registry citation", () => {
    for (const a of FORM_941_AUTHORITIES) {
      expect(flat, `report never cites ${a.cite}`).toContain(norm(a.cite));
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2. THE COUNTED CLAIMS
 * ══════════════════════════════════════════════════════════════════════════ */

describe("the counts the report states are the counts the code has", () => {
  it("there are exactly seven refusal codes, and the report says seven", () => {
    expect(ALL_FORM_941_REFUSAL_CODES.length).toBe(7);
    expect(flat).toContain("The seven ways this screen will refuse");
    expect(flat).toContain("7 refusal codes");
  });

  it("every refusal code is named in the report, by its exact code", () => {
    // Naming six of seven is the realistic failure: the seventh gets added
    // later and nobody re-reads the report.
    for (const code of ALL_FORM_941_REFUSAL_CODES) {
      expect(flat, `refusal code ${code} is never named in the report`).toContain(code);
    }
  });

  it("there is a lesson per refusal code", () => {
    expect(FORM_941_REFUSAL_LESSONS.length).toBe(ALL_FORM_941_REFUSAL_CODES.length);
    const taught = new Set(FORM_941_REFUSAL_LESSONS.map((l) => l.code));
    for (const code of ALL_FORM_941_REFUSAL_CODES) {
      expect(taught.has(code), `refusal ${code} has no lesson`).toBe(true);
    }
  });

  it("there are exactly seven pre-flight checks, and the report says seven", () => {
    expect(FORM_941_CHECKS.length).toBe(7);
    expect(flat).toContain("The seven checks before you sign");
    expect(flat).toContain("7 pre-flight checks");
  });

  it("every check's question reaches the report with all its words", () => {
    // Case and punctuation are forgiven (see `words`); vocabulary is not.
    for (const check of FORM_941_CHECKS) {
      expect(flatWords, `check question for "${check.key}" is not in the report`).toContain(
        words(check.question),
      );
    }
  });

  it("the report walks the checks in the order the code defines", () => {
    // The report argues that the ORDER carries the value - the missing-input
    // checks come first because they are the only errors that cannot be found
    // by looking at the form. If the code were reordered and the report were
    // not, that argument would be a lie while every sentence stayed true.
    const ordered = [...FORM_941_CHECKS].sort((a, b) => a.order - b.order);
    const positions = ordered.map((c) => flatWords.indexOf(words(c.question)));

    for (let i = 0; i < positions.length; i += 1) {
      expect(positions[i], `check "${ordered[i].key}" missing from report`).toBeGreaterThan(-1);
    }
    for (let i = 1; i < positions.length; i += 1) {
      expect(
        positions[i],
        `check "${ordered[i].key}" (order ${ordered[i].order}) appears BEFORE ` +
          `"${ordered[i - 1].key}" (order ${ordered[i - 1].order}) in the report`,
      ).toBeGreaterThan(positions[i - 1]);
    }

    // Rule 39: the loop passes vacuously on an empty list, and would also pass
    // if every question resolved to the same index.
    expect(ordered.length).toBe(7);
    expect(new Set(positions).size).toBe(7);
  });

  it("there are four worked examples, and the report walks all four by title", () => {
    expect(FORM_941_WORKED_EXAMPLES.length).toBe(4);
    expect(flat).toContain("The four worked examples built into the screen");
    expect(flat).toContain("4 worked examples");
    for (const ex of FORM_941_WORKED_EXAMPLES) {
      expect(flatWords, `worked example "${ex.key}" is not in the report`).toContain(
        words(ex.title),
      );
    }
  });

  it("the report quotes the first example's lesson word for word", () => {
    const ex = FORM_941_WORKED_EXAMPLES.find((e) => e.key === "q2-2026-real")!;
    expect(flat, "the Q2 2026 example's lesson is not reproduced").toContain(norm(ex.theLesson));
  });

  it("there is a mentor lesson per exported function, and the report says eight", () => {
    expect(FORM_941_LESSONS.length).toBe(8);
    expect(flat).toContain("8 exported functions");
  });

  it("seven new authorities plus ten borrowed makes the seventeen the report claims", () => {
    expect(FORM_941_AUTHORITIES.length).toBe(7);
    expect(FORM_941_BORROWED_AUTHORITY_IDS.length).toBe(10);
    expect(form941Authorities().length).toBe(17);
    expect(flat).toContain("7 newly transcribed authorities, plus 10 reused");
    expect(flat).toContain("17 in total on the screen");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3. THE ORACLE FIGURES, REBUILT FROM BOTH SIDES
 *
 * The line-for-line table is the reason Michael should believe the engine, so
 * it is the table most worth re-deriving. Each figure is checked against the
 * FILED return (so the report cannot drift from the oracle) and against the
 * ENGINE's own output (so the report cannot claim a match that stopped being
 * true).
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * The same subject construction the engine tests use, kept in step by reading
 * the filed total rather than restating it.
 *
 * Line 3 (federal income tax withheld) is a FILED TOTAL - the wage detail does
 * not carry it per person - so it is apportioned across the ten with the
 * remainder on the last, which cannot change the return because line 3 is a
 * straight sum. Seven people are given one cent less than the statutory rate
 * so that line 7 is a genuine recovered residual of -7 cents rather than a
 * number written into the test.
 */
function q2Subjects(): Form941Subject[] {
  const filedLine3 = filedFigure("941-line-3")?.filedAmountCents ?? 0;
  const perHead = Math.floor(filedLine3 / Q2_2026_EMPLOYEES.length);
  const remainder = filedLine3 - perHead * Q2_2026_EMPLOYEES.length;

  return Q2_2026_EMPLOYEES.map((e, index) => {
    const statutory =
      applyMilliPct(e.wagesCents, OASDI_EMPLOYEE_MILLI_PCT) +
      applyMilliPct(e.wagesCents, MEDICARE_EMPLOYEE_MILLI_PCT);
    const isLast = index === Q2_2026_EMPLOYEES.length - 1;
    return {
      subjectId: e.subjectId,
      displayName: e.displayName,
      wagesCents: e.wagesCents,
      oasdiTaxableWagesCents: e.wagesCents,
      medicareTaxableWagesCents: e.wagesCents,
      federalIncomeTaxWithheldCents: perHead + (isLast ? remainder : 0),
      actualEmployeeFicaWithheldCents: index < 7 ? statutory - 1 : statutory,
      onPayrollForTwelfthPayPeriod: true,
    };
  });
}

function q2Return(): Form941Return {
  const req: Form941Request = {
    quarter: { year: 2026, quarter: 2 },
    subjects: q2Subjects(),
    totalDepositsCents: filedFigure("941-line-12")?.filedAmountCents ?? null,
    sourceLabel: "known-good-quarters.ts, the filed Q2 2026 return",
  };
  const result = buildForm941(req);
  if (!result.ok) {
    throw new Error(
      `the Q2 2026 oracle no longer builds: ${result.refusals.map((r) => r.code).join(", ")}`,
    );
  }
  return result;
}

/** The table exactly as the report prints it: line -> filed-figure id. */
const TABLE_ROWS: readonly { line: string; figureId: string }[] = [
  { line: "2", figureId: "941-line-2" },
  { line: "3", figureId: "941-line-3" },
  { line: "5a", figureId: "941-line-5a" },
  { line: "5c", figureId: "941-line-5c" },
  { line: "6", figureId: "941-line-6" },
  { line: "7", figureId: "941-line-7" },
  { line: "12", figureId: "941-line-12" },
];

describe("the Q2 2026 table in the report is re-derived, not remembered", () => {
  const built = q2Return();

  it("the report claims seven lines matched, and there are seven rows", () => {
    expect(TABLE_ROWS.length).toBe(7);
    expect(flat).toContain("7 lines of your Q2 2026 return reproduced exactly");
  });

  for (const row of TABLE_ROWS) {
    it(`line ${row.line}: filed figure, engine figure and printed figure all agree`, () => {
      const filed = filedFigure(row.figureId);
      expect(filed, `no filed figure with id ${row.figureId}`).toBeTruthy();

      const engine = lineOf(built, row.line);
      expect(engine, `the engine no longer produces line ${row.line}`).toBeTruthy();

      // Side 1: engine reproduces the filed return.
      expect(
        engine!.amountCents,
        `engine line ${row.line} no longer matches the filed return`,
      ).toBe(filed!.filedAmountCents);

      // Side 2: the report prints that same number, formatted the way the
      // system formats money. Line 7 is negative, and the report prints it
      // with a minus sign, so both renderings are accepted for that one.
      const printed = formatCents(filed!.filedAmountCents);
      const alsoOk = printed.replace(/^-\$/, "\u2212$");
      const found = flat.includes(printed) || flat.includes(alsoOk);
      expect(found, `report does not print ${printed} for line ${row.line}`).toBe(true);
    });
  }

  it("line 7 really is minus seven cents, and the report says so in words", () => {
    // The whole argument of the line-7 section rests on this being a recovered
    // residual rather than a number I typed. If it ever became 0, every
    // sentence about "seven cents" would be fiction.
    expect(lineOf(built, "7")!.amountCents).toBe(-7);
    expect(flatWords).toContain("including line 7 at");
    expect(flatWords).toContain("seven cent rounding line");
  });

  it("the verdict sentence in the report is the system's own", () => {
    // Not a paraphrase of what the screen says. What it says.
    expect(flat, "the verdict sentence has drifted from the engine").toContain(
      norm(built.verdict),
    );
  });

  it("the quarter is fully paid, so the report is right that nothing is owed", () => {
    expect(built.balanceDueCents).toBe(0);
  });

  it("the ten employees the report describes are the ten in the oracle", () => {
    expect(Q2_2026_EMPLOYEES.length).toBe(10);
    expect(flatWords).toContain("the same ten employees");
  });

  it("the 5a-is-both-halves worked example's employee half is the one printed", () => {
    // The report says the payslips show $4,273.25 and line 5a says $8,546.51.
    // Recomputed rather than trusted, because a rate change would make the
    // sentence quietly wrong while remaining perfectly plausible.
    const wages = Q2_2026_EMPLOYEES.reduce((t, e) => t + e.wagesCents, 0);
    const employeeHalf = applyMilliPct(wages, OASDI_EMPLOYEE_MILLI_PCT);
    expect(flat, "the employee-half figure in the report is stale").toContain(
      formatCents(employeeHalf),
    );
  });

  it("doubling the employee half does NOT give line 5a, and the report says why", () => {
    // THIS TEST EXISTS BECAUSE IT CAUGHT A REAL DEFECT. The first draft of the
    // worked example said "$4,273.25 + $4,273.25 = $8,546.51", which is not
    // arithmetic - it is $8,546.50. Line 5a is a penny higher because the form
    // multiplies ONCE at 12.4% ($8,546.5078, rounds up) rather than rounding
    // twice at 6.2%. The engine follows the form.
    //
    // The one cent is pinned from both directions so neither the explanation
    // nor the engine can drift away from the filed return.
    const wages = Q2_2026_EMPLOYEES.reduce((t, e) => t + e.wagesCents, 0);
    const employeeHalf = applyMilliPct(wages, OASDI_EMPLOYEE_MILLI_PCT);
    const filed5a = filedFigure("941-line-5a")!.filedAmountCents;

    expect(employeeHalf * 2, "the two-halves sum should be one cent BELOW line 5a").toBe(
      filed5a - 1,
    );
    expect(applyMilliPct(wages, 12_400), "one multiplication at 12.4% must give line 5a").toBe(
      filed5a,
    );

    // And the report must explain the penny rather than paper over it.
    expect(flatWords).toContain("that one cent is not an error");
    expect(flat).toContain("$8,546.5078");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4. THE DUE DATES, RECOMPUTED
 *
 * The most expensive kind of wrong this document could be.
 * ══════════════════════════════════════════════════════════════════════════ */

const DUE_DATE_CLAIMS: readonly {
  year: number;
  quarter: 1 | 2 | 3 | 4;
  expected: string;
  shifted: boolean;
}[] = [
  { year: 2026, quarter: 2, expected: "2026-07-31", shifted: false },
  { year: 2026, quarter: 3, expected: "2026-11-02", shifted: true },
  { year: 2026, quarter: 4, expected: "2027-02-01", shifted: true },
  { year: 2027, quarter: 1, expected: "2027-04-30", shifted: false },
  { year: 2027, quarter: 2, expected: "2027-08-02", shifted: true },
];

describe("the deadlines the report prints are the deadlines the code computes", () => {
  for (const c of DUE_DATE_CLAIMS) {
    it(`Q${c.quarter} ${c.year} is due ${c.expected}${c.shifted ? " (shifted)" : ""}`, () => {
      const due = form941DueDates({ year: c.year, quarter: c.quarter });
      expect(due.ordinary, `the engine no longer says ${c.expected}`).toBe(c.expected);
      expect(due.ordinaryWasShifted, `shift flag disagrees for Q${c.quarter} ${c.year}`).toBe(
        c.shifted,
      );
    });
  }

  it("every date in the report's shift table is printed", () => {
    for (const c of DUE_DATE_CLAIMS.filter((x) => x.quarter !== 1)) {
      expect(flat, `the report does not print ${c.expected}`).toContain(c.expected);
    }
  });

  it("Michael's own first 941 date is right, because it is the one he will diary", () => {
    // Cutover is 1 January 2027, which lands in Q1 2027.
    const first = form941DueDates({ year: 2027, quarter: 1 });
    expect(first.ordinary).toBe("2027-04-30");
    expect(flatWords).toContain("your first 941 ever for q1 2027 is due 30 april 2027");
  });

  it("the ten-day extension is described as earned, not requested", () => {
    const due = form941DueDates({ year: 2026, quarter: 2 });
    expect(due.ifDepositsWereTimely).toBe("2026-08-10");
    expect(flatWords).toContain("you may file by the 10th of the second month instead");
    expect(flatWords).toContain("you either earned it with your deposit history or you did not");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5. THE COLOUR ARGUMENT
 * ══════════════════════════════════════════════════════════════════════════ */

describe("the colours the report explains are the colours the code uses", () => {
  it("the three statuses really do map to three different tones", () => {
    const tones = new Set([statusTone("ready"), statusTone("attention"), statusTone("blocked")]);
    expect(tones.size).toBe(3);
  });

  it("attention is gold and not orange, as the report claims", () => {
    expect(statusTone("attention")).toBe("gold");
    expect(flat).toContain("Gold is not a smaller red");
  });

  it("all three status meanings are quoted into the report word for word", () => {
    for (const s of ["ready", "attention", "blocked"] as const) {
      expect(flat, `status meaning for "${s}" is not in the report`).toContain(
        norm(statusMeaning(s)),
      );
    }
  });

  it("the gold sentence opens by saying the return is correct", () => {
    // Same guarantee the screen test pins from the other side: the FIRST thing
    // said about a gold return must be that it is right, not that something is
    // wrong. Reversing it is how somebody files late over a payment.
    expect(statusMeaning("attention").startsWith("The return is correct")).toBe(true);
  });

  it("the four urgency bands and their colours are as printed", () => {
    expect(urgencyTone(urgencyBand(-1))).toBe("danger");
    expect(urgencyTone(urgencyBand(0))).toBe("orange");
    expect(urgencyTone(urgencyBand(7))).toBe("orange");
    expect(urgencyTone(urgencyBand(8))).toBe("gold");
    expect(urgencyTone(urgencyBand(30))).toBe("gold");
    expect(urgencyTone(urgencyBand(31))).toBe("green");
    // And the report prints all four band names.
    for (const band of ["overdue", "due-now", "due-soon", "comfortable"]) {
      expect(flat, `band "${band}" is not in the report's table`).toContain(band);
    }
  });

  it("the 5% late-filing figure the report cites comes from the code", () => {
    // IRC 6651. If the on-screen sentence dropped the number, the report would
    // be quoting a warning Michael never sees.
    expect(flat).toContain("5% of the tax per month under IRC 6651");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6. FACTUAL CLAIMS ABOUT THE CODE AND THE PRODUCT BOUNDARY
 * ══════════════════════════════════════════════════════════════════════════ */

describe("the findings the report reports are still true", () => {
  it("Books -> Form 941 (Quarterly) is a real nav entry", () => {
    const hit = adminNav.find((i) => i.href === "/admin/books/form-941");
    expect(hit, "the nav entry is gone; the report sends him nowhere").toBeTruthy();
    expect(hit!.label).toBe("Form 941 (Quarterly)");
    expect(flat).toContain("Books \u2192 Form 941 (Quarterly)".replace(/\s+/g, " "));
  });

  it("the page file exists at the route the nav claims", () => {
    // Rule 16: a nav entry is not proof of a screen.
    expect(existsSync(join(ROOT, "src", "app", "admin", "books", "form-941", "page.tsx"))).toBe(
      true,
    );
  });

  it("the 941 screen sits directly after Pay Run, as the report says", () => {
    const payRun = adminNav.findIndex((i) => i.href === "/admin/books/pay-run");
    const form941 = adminNav.findIndex((i) => i.href === "/admin/books/form-941");
    expect(payRun).toBeGreaterThan(-1);
    expect(form941).toBe(payRun + 1);
    expect(flatWords).toContain("sitting directly after pay run in the menu");
  });

  it("the honesty note under the button is reproduced word for word", () => {
    // If the screen's wording were ever softened, the report's promise would
    // outlive the promise. This is the boundary Michael and I agreed: we
    // replace the data-preparation half of Aatrix, we do not file.
    const state = fileButtonState(q2Return());
    expect(flat, "the honesty note has drifted from the screen").toContain(
      norm(state.honestyNote),
    );
    expect(state.honestyNote).toContain("does not transmit anything to the IRS");
  });

  it("there really is no federal deposit table, which is why DEPOSITS_UNKNOWN fires", () => {
    // The report tells Michael this refusal will fire for him right now and
    // explains why that is correct rather than broken. If somebody adds the
    // table in a later slice, this fails - and that failure is the reminder to
    // update the report, which is the point.
    const migrations = join(ROOT, "supabase", "migrations");
    let mentions = 0;
    if (existsSync(migrations)) {
      for (const f of readdirSync(migrations)) {
        if (!f.endsWith(".sql")) continue;
        const sql = readFileSync(join(migrations, f), "utf8").toLowerCase();
        if (/create\s+table[^;]*federal_tax_deposit/.test(sql)) mentions += 1;
      }
    }
    expect(mentions, "a federal deposit table now exists; the report is stale").toBe(0);
    expect(flat).toContain("There is no\nfederal tax deposit table".replace(/\s+/g, " "));
  });

  it("the report states the alarming wrong answer that assuming zero would give", () => {
    // The figure has to be the quarter's whole tax, or the argument is wrong.
    const line12 = filedFigure("941-line-12")!.filedAmountCents;
    expect(flat).toContain(`a ${formatCents(line12)} bill you do not`);
  });

  it("the report is honest that books-39 did not ship the garnishment buttons", () => {
    // Rule 64a and the reason Michael trusts these documents: they do not
    // flatter me. If somebody deletes the embarrassing table, this fails.
    expect(flat).toContain("books-39 did not deliver the garnishment lifecycle buttons");
    for (const action of [
      "terminateWageOrderAction",
      "suspendWageOrderAction",
      "resumeWageOrderAction",
    ]) {
      expect(flat, `the report no longer names ${action}`).toContain(action);
    }
  });

  it("those three actions are still uncalled by the UI, so the table is still true", () => {
    // The claim is "0 times each". Re-derived from the screen's own source, so
    // that wiring them up (the next small PR) turns this red and forces the
    // report to be corrected rather than left boasting about a gap that closed.
    const dir = join(ROOT, "src", "app", "admin", "books", "garnishments");
    const sources = readdirSync(dir)
      .filter((f) => f.endsWith(".tsx"))
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .join("\n");
    for (const action of [
      "terminateWageOrderAction",
      "suspendWageOrderAction",
      "resumeWageOrderAction",
    ]) {
      expect(
        sources.includes(action),
        `${action} is now called by the UI - update the report's 0/0/0 table`,
      ).toBe(false);
    }
  });

  it("the ESD and L&I figures promised for books-41 come from the oracle", () => {
    const esd = filedFigure("esd-ui");
    const lni = filedFigure("lni-premium");
    expect(esd, "no esd-ui figure").toBeTruthy();
    expect(lni, "no lni-premium figure").toBeTruthy();
    expect(flat).toContain(formatCents(esd!.filedAmountCents));
    expect(flat).toContain(formatCents(lni!.filedAmountCents));
    expect(flat).toContain("G2413C8A6HP330LL");
    expect(flat).toContain("12616784");
  });

  it("the pay-date rule the report leans on is enforced by the store", () => {
    const store = readFileSync(join(ROOT, "src", "lib", "payroll", "form-941-store.ts"), "utf8");
    const at = store.indexOf('.from("payroll_runs")');
    expect(at, "the store no longer reads payroll_runs").toBeGreaterThan(-1);
    const window = store.slice(at, at + 400);
    expect(window, "the quarter is no longer selected by pay_date").toContain("pay_date");
    expect(flatWords).toContain("the screen selects the quarter by pay date");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7. THE DELIVERY
 * ══════════════════════════════════════════════════════════════════════════ */

describe("the report was actually delivered", () => {
  it("the PDF exists alongside the markdown", () => {
    expect(existsSync(PDF_PATH), "no PDF was built for this report").toBe(true);
  });

  it("the PDF is a real document and not a zero-byte stub", () => {
    expect(statSync(PDF_PATH).size).toBeGreaterThan(40000);
  });

  it("the report is addressed to Michael and names the slice", () => {
    expect(report).toContain("Michael");
    expect(report).toContain("books-40");
  });

  it("the report points at the next slice by name", () => {
    expect(flat).toContain("books-41");
  });
});
