/**
 * tests/compliance/new-hire-report.test.ts   (books-68)
 *
 * The DSHS 18-463 Washington New Hire Report: its refusals, its blank draw, its
 * lessons, and the door Michael asked for at the top right of the W-4 screen.
 *
 * Rule 129 — one assertion per risk. The risks this form actually carries are
 * not arithmetic (nothing on it is money); they are (a) printing a form with a
 * hole in it, which is a failure to report at $25/employee/month, (b) drawing a
 * blank that looks like a filed return, and (c) the door going missing so the
 * page becomes unreachable, since it is exempt from the menu.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  NEW_HIRE_EMPLOYEE_BOXES,
  NEW_HIRE_EMPLOYER_BOXES,
  NEW_HIRE_EMPLOYEES_PER_PAGE,
  NEW_HIRE_FORM_ID,
  NEW_HIRE_REPORT_DUE_DAYS,
  buildNewHireReport,
  newHireBoxes,
  newHireDate,
  newHireDeadline,
  newHireEin,
  newHireRefusals,
  newHireSsn,
  onlyRefusalIsEmptiness,
  paginateNewHire,
  type NewHireEmployee,
  type NewHireEmployer,
} from "@/lib/payroll/new-hire-report-core";
import { NEW_HIRE_BOX_LESSONS } from "@/lib/payroll/form-box-lessons-new-hire";
import { boxText, formatBoxValue, type FormBox } from "@/lib/payroll/form-box-core";

const ROOT = process.cwd();

const GOOD_EMPLOYER: NewHireEmployer = {
  legalName: "LYMAN'S MARIJUANA L.L.C.",
  street: "4851 GEIGER RD SE",
  city: "PORT ORCHARD",
  state: "WA",
  zip: "98366",
  ein: "464217016",
};

function employee(over: Partial<NewHireEmployee> = {}): NewHireEmployee {
  return {
    employeeId: "e1",
    lastName: "Doe",
    firstName: "Jane A",
    middleName: null,
    street: "1 Main St",
    city: "Port Orchard",
    state: "WA",
    zip: "98366",
    ssn: "534298006",
    dateOfBirth: "1990-04-02",
    dateOfHire: "2026-08-10",
    displayName: "Jane Doe",
    ...over,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. THE FORMATS THE STATE READS
   ═══════════════════════════════════════════════════════════════════════════ */

describe("new-hire report: the values are formatted as the paper prints them", () => {
  it("prints an SSN unmasked, because the statute requires the number itself", () => {
    // Every other screen in this system masks. This one must not: RCW
    // 26.23.040(3)(a) requires "social security number", and a registry cannot
    // match ***-**-8006 against anything.
    expect(newHireSsn("534298006")).toBe("534-29-8006");
    expect(newHireSsn("534-29-8006")).toBe("534-29-8006");
  });

  it("prints the EIN in the two-then-seven shape", () => {
    expect(newHireEin("464217016")).toBe("46-4217016");
  });

  it("prints dates as MM/DD/YYYY, the format on the form", () => {
    expect(newHireDate("2026-08-10")).toBe("08/10/2026");
  });

  it("prints an em dash, never a zero or a blank, for an absent value", () => {
    // A zero-length string in a box reads as "answered, and the answer is
    // nothing". An em dash reads as "nobody has told me". Different claims.
    expect(newHireDate(null)).toBe("\u2014");
    expect(newHireSsn(null)).toBe("\u2014");
    expect(newHireEin(null)).toBe("\u2014");
  });

  it("refuses to reformat a malformed value into a plausible one", () => {
    // The dangerous failure is not a blank, it is a wrong-but-convincing value.
    expect(newHireSsn("12345")).toBe("\u2014");
    expect(newHireDate("not a date")).toBe("\u2014");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. THE TWENTY-DAY CLOCK
   ═══════════════════════════════════════════════════════════════════════════ */

describe("new-hire report: the twenty-day clock", () => {
  it("is twenty days, from the statute and not from a habit", () => {
    expect(NEW_HIRE_REPORT_DUE_DAYS).toBe(20);
  });

  it("does not call day twenty late", () => {
    // Off-by-one here invents lateness the statute did not declare, and would
    // put a red "OVERDUE" on a report that is filed exactly on time.
    const d = newHireDeadline("2026-08-01", "2026-08-21");
    expect(d.dueYmd).toBe("2026-08-21");
    expect(d.overdue).toBe(false);
    expect(d.daysRemaining).toBe(0);
  });

  it("calls day twenty-one late", () => {
    const d = newHireDeadline("2026-08-01", "2026-08-22");
    expect(d.overdue).toBe(true);
    expect(d.daysRemaining).toBe(-1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. REFUSALS — THE $25-A-MONTH RISK
   ═══════════════════════════════════════════════════════════════════════════ */

describe("new-hire report: an incomplete report refuses instead of printing", () => {
  it("produces nothing to complain about when every required fact is present", () => {
    // Rule 39: a refusal test that never sees a clean pass proves only that the
    // builder can say no.
    const refusals = newHireRefusals({
      employer: GOOD_EMPLOYER,
      employees: [employee()],
      todayYmd: "2026-08-27",
    });
    expect(refusals).toEqual([]);
  });

  it("names the employee AND the field, so the fix is obvious", () => {
    const refusals = newHireRefusals({
      employer: GOOD_EMPLOYER,
      employees: [employee({ street: null, displayName: "Jane Doe" })],
      todayYmd: "2026-08-27",
    });
    expect(refusals.length).toBeGreaterThan(0);
    expect(refusals[0].code).toBe("MISSING_EMPLOYEE_FIELD");
    expect(refusals[0].field).toBe("street");
    expect(refusals[0].because).toContain("Jane Doe");
  });

  it("treats a whitespace-only value as absent, not as an answer", () => {
    const refusals = newHireRefusals({
      employer: GOOD_EMPLOYER,
      employees: [employee({ city: "   " })],
      todayYmd: "2026-08-27",
    });
    expect(refusals.some((r) => r.field === "city")).toBe(true);
  });

  it("refuses on a present-but-malformed SSN as hard as on a missing one", () => {
    // This is the case that would otherwise slip through: the column is not
    // null, so a naive presence check passes, and the form prints a dash where
    // the registry expects nine digits.
    const refusals = newHireRefusals({
      employer: GOOD_EMPLOYER,
      employees: [employee({ ssn: "abc" })],
      todayYmd: "2026-08-27",
    });
    expect(refusals.some((r) => r.field === "ssn")).toBe(true);
  });

  it("does NOT refuse over a missing middle name", () => {
    // Rule 62d. RCW 26.23.040(3)(a) lists "name, address, social security
    // number, and date of birth". It does not itemise a middle name, so
    // refusing on one would enforce a rule Washington did not write and would
    // block a report that is legally complete.
    const refusals = newHireRefusals({
      employer: GOOD_EMPLOYER,
      employees: [employee({ middleName: null })],
      todayYmd: "2026-08-27",
    });
    expect(refusals).toEqual([]);
    expect(NEW_HIRE_EMPLOYEE_BOXES.find((b) => b.field === "middleName")?.required).toBe(false);
  });

  it("refuses when the EMPLOYER is unidentified, not just the employee", () => {
    const refusals = newHireRefusals({
      employer: { ...GOOD_EMPLOYER, ein: null },
      employees: [employee()],
      todayYmd: "2026-08-27",
    });
    expect(refusals.some((r) => r.code === "NO_EMPLOYER_EIN")).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. EMPTY DRAWS, BROKEN REFUSES — THE BOOKS-67 LAW
   ═══════════════════════════════════════════════════════════════════════════ */

describe("new-hire report: empty draws a blank form, broken still refuses", () => {
  it("treats 'nobody was hired' as the only refusal that may draw", () => {
    const view = buildNewHireReport({
      employer: GOOD_EMPLOYER,
      employees: [],
      todayYmd: "2026-08-27",
    });
    expect(view.refusals.map((r) => r.code)).toEqual(["NOBODY_TO_REPORT"]);
    expect(onlyRefusalIsEmptiness(view.refusals)).toBe(true);
    expect(view.emptyReason).not.toBeNull();
  });

  it("still refuses when the books are BROKEN and also empty", () => {
    // D-19/D-20's lesson, applied at birth rather than retrofitted: an empty
    // roster plus an unidentified employer is not an honest quiet month, and
    // must not draw a form that looks filed.
    const view = buildNewHireReport({
      employer: { legalName: null, street: null, city: null, state: null, zip: null, ein: null },
      employees: [],
      todayYmd: "2026-08-27",
    });
    expect(onlyRefusalIsEmptiness(view.refusals)).toBe(false);
  });

  it("puts NOBODY_TO_REPORT last, so a real fault is read first", () => {
    const view = buildNewHireReport({
      employer: { ...GOOD_EMPLOYER, legalName: null },
      employees: [],
      todayYmd: "2026-08-27",
    });
    expect(view.refusals[view.refusals.length - 1].code).toBe("NOBODY_TO_REPORT");
  });

  it("never reaches the numeric branch, because no box on this form is a figure", () => {
    /*
     * ═══ D-21, AND THE GATE THAT SHOULD HAVE CAUGHT IT ═══
     *
     * Every test in this file passed while the FILLED sheet rendered "0" in all
     * twelve boxes — employer name "0", SSN "0". The screenshot found it; the
     * suite did not, because every assertion was about the view object rather
     * than the rendered value.
     *
     * THE CAUSE. `BoxMeasure` is money | hours | count, with no text member, so
     * `formatBoxValue` sent every box down the count branch and printed
     * `quantity ?? 0`. Nothing on the 18-463 is an amount: it is names, an
     * address, an SSN and two dates.
     *
     * THIS IS THE CLASS ASSERTION (rule 23), not a spot check on twelve strings.
     * A box escapes the numeric branch only two ways: `notComputedYet`, which
     * `formatBoxValue` reads first, or `text`, which it reads second. Any box
     * added to this form later with neither will fall through to `quantity ?? 0`
     * and print a zero — and this loop fails the moment it does, on the blank
     * view and the filled one alike. Asserting the two doors are the only exits
     * is what makes the gate survive a thirteenth box.
     */
    const filled = buildNewHireReport({
      employer: GOOD_EMPLOYER,
      employees: [employee()],
      todayYmd: "2026-08-27",
    });
    for (const view of [filled, null]) {
      const boxes = newHireBoxes(view);
      expect(boxes.length, "an empty loop proves nothing (rule 39)").toBe(12);
      for (const b of boxes) {
        expect(
          b.notComputedYet !== null || boxText(b) !== null,
          `box ${b.box} carries neither text nor a not-computed reason, so formatBoxValue will ` +
            `fall through to the count branch and print a bare zero. That is D-21.`,
        ).toBe(true);
        // The count branch's output for these boxes, pinned literally: quantity
        // is null on all of them, so escaping it means never seeing "0".
        expect(formatBoxValue(b), `box ${b.box} printed the count-branch zero`).not.toBe("0");
      }
    }
  });

  it("prints the real value in the box, and greys only what is genuinely unknown", () => {
    /*
     * The second half of D-21. Flagging every box `notComputedYet` did remove
     * the false zeroes, and the suite went green again — but the screenshot
     * then showed a fully populated report reading "not computed yet" in all
     * twelve boxes, which is a different false statement about the same form.
     *
     * So "no zeroes" is only half a gate; without this one it could be
     * satisfied by a sheet that silently dropped Michael's data. These are the
     * strings measured off the rendered sheet, through the formatter he reads.
     */
    const view = buildNewHireReport({
      employer: GOOD_EMPLOYER,
      employees: [employee()],
      todayYmd: "2026-08-27",
    });
    const boxes = newHireBoxes(view);
    const shown = (boxNo: string): string => {
      const b = boxes.find((x) => x.box === boxNo);
      expect(b, `box ${boxNo} is missing from the sheet`).toBeDefined();
      return formatBoxValue(b as FormBox);
    };

    expect(shown("E1")).toContain("LYMAN'S MARIJUANA L.L.C.");
    expect(shown("E1")).toContain("4851 GEIGER RD SE");
    expect(shown("E2")).toBe("46-4217016");
    expect(shown("LAST NAME")).toBe("Doe");
    expect(shown("FIRST NAME")).toBe("Jane A");
    expect(shown("ADDRESS")).toBe("1 Main St");
    expect(shown("SOCIAL SECURITY NUMBER")).toBe("534-29-8006");
    expect(shown("BIRTH DATE")).toBe("04/02/1990");
    expect(shown("DATE OF HIRE")).toBe("08/10/2026");

    /*
     * MIDDLE NAME is the control. This employee has none, DSHS does not require
     * one, and RCW 26.23.040(3)(a) does not list it — so it must read as unknown
     * while every box beside it reads as data. If this ever flips to a value,
     * the sheet has started inventing one.
     */
    expect(shown("MIDDLE NAME")).toBe("not computed yet");

    // And the populated boxes must NOT be greyed: the inverse of the same risk.
    for (const b of boxes) {
      if (b.box === "MIDDLE NAME") continue;
      expect(
        b.notComputedYet,
        `box ${b.box} has data but is flagged not-computed, which greys it out on the sheet`,
      ).toBeNull();
    }
  });

  it("draws a blank sheet whose every box is explicitly not-computed", () => {
    // The blank must be recognisable AS a blank. A box carrying a stray figure
    // would make a specimen look like a return.
    const boxes = newHireBoxes(null);
    expect(boxes.length).toBeGreaterThan(0);
    for (const b of boxes) {
      expect(b.notComputedYet, `box ${b.box} draws blank without saying why`).toBeTruthy();
      expect(b.amountCents).toBe(0);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. PAGINATION — AS THE PAPER PAGINATES (RULE 125)
   ═══════════════════════════════════════════════════════════════════════════ */

describe("new-hire report: pagination follows the paper", () => {
  it("fits four employees to a sheet, as measured on the form", () => {
    expect(NEW_HIRE_EMPLOYEES_PER_PAGE).toBe(4);
  });

  it("leaves the last sheet short rather than padding it", () => {
    // Padding with a repeated person would be a false statement to a child
    // support registry, which is a different and worse thing than a gap.
    const blocks = Array.from({ length: 5 }, (_, i) => ({
      employeeId: `e${i}`,
      displayName: `Person ${i}`,
      cells: [],
      deadline: null,
    }));
    const pages = paginateNewHire(blocks);
    expect(pages.length).toBe(2);
    expect(pages[0].blocks.length).toBe(4);
    expect(pages[1].blocks.length).toBe(1);
  });

  it("still yields one page when there is nobody, so the blank has a sheet", () => {
    expect(paginateNewHire([]).length).toBe(1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   6. A LESSON BEHIND EVERY BOX — WHAT MICHAEL ASKED FOR
   ═══════════════════════════════════════════════════════════════════════════ */

describe("new-hire report: every box on the form has a lesson", () => {
  it("teaches every box and invents none", () => {
    /*
     * Rule 43: walk the population rather than hand-listing it. Michael:
     * "on the 941 schedule b, every single box opens with an explanation."
     * That is the standard, so the check is both directions — no box without a
     * lesson, and no lesson for a box that is not on the form.
     */
    /*
     * The population is what the sheet ACTUALLY RENDERS — newHireBoxes() — not
     * the caption tables re-read by hand. A first draft of this test compared
     * against the caption strings and reported E1/E2 as orphan lessons, which
     * was the test being wrong about the form rather than the form being wrong.
     * Comparing to the rendered boxes is both stricter and true: if a box
     * reaches Michael's screen, it opens with an explanation.
     */
    const rendered = newHireBoxes(null).map((b) => b.box);
    const taught = NEW_HIRE_BOX_LESSONS.map((l) => l.box);

    const untaught = rendered.filter((b) => !taught.includes(b));
    const orphans = taught.filter((t) => !rendered.includes(t));

    expect(orphans, `lessons for boxes that are not on the form: ${orphans.join(", ")}`).toEqual(
      [],
    );
    expect(untaught, `boxes with no lesson: ${untaught.join(", ")}`).toEqual([]);

    // Rule 39/66d: prove the population is not empty, or the two checks above
    // would pass forever on a pair of empty lists.
    expect(rendered.length).toBe(12);

    // And the caption tables really are the source of those boxes: 10 employee
    // boxes + 2 employer boxes = the 12 rendered.
    expect(NEW_HIRE_EMPLOYEE_BOXES.length + NEW_HIRE_EMPLOYER_BOXES.length).toBe(rendered.length);
  });

  it("every lesson cites the statute rather than asserting on our authority", () => {
    // Rule 24/35: verbatim authority, mechanically verified. The quote checker
    // proves the text; this proves a citation is present at all.
    // Field names MEASURED from `BoxLesson` in form-box-core.ts. A first draft
    // asserted on `whatItIs`, which does not exist — and `undefined.length`
    // threw, so the gate reported a TypeError instead of a verdict.
    for (const l of NEW_HIRE_BOX_LESSONS) {
      expect(l.plainEnglish.length, `lesson ${l.box} has no plain-English body`).toBeGreaterThan(
        20,
      );
      expect(l.whatToDo.length, `lesson ${l.box} tells Michael nothing to do`).toBeGreaterThan(10);
    }
    /*
     * MEASURED: all twelve cite RCW 26.23.040, so the bar is twelve rather than
     * "at least one". A floor of one would let eleven lessons quietly lose
     * their citation while the gate stayed green.
     */
    const cited = NEW_HIRE_BOX_LESSONS.filter((l) => JSON.stringify(l).includes("26.23.040"));
    expect(cited.length, "a lesson stopped citing RCW 26.23.040").toBe(
      NEW_HIRE_BOX_LESSONS.length,
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   7. THE DOOR ONTO THE PAYROLL SETUP SCREEN
   ═══════════════════════════════════════════════════════════════════════════ */

describe("new-hire report: the door onto the payroll setup screen", () => {
  const ROUTE = join(ROOT, "src/app/admin/books/new-hire-report/page.tsx");
  const SETUP = join(ROOT, "src/app/admin/books/payroll-setup/page.tsx");

  it("the route exists", () => {
    expect(existsSync(ROUTE)).toBe(true);
  });

  it("guards access like every other books page", () => {
    // The CALL, not the import. books-60 proved an import alone will satisfy a
    // lazy regex while the page has no guard at all.
    const src = readFileSync(ROUTE, "utf8");
    expect(src).toMatch(/await\s+requireBooksAccess\s*\(\s*\)/);
  });

  it("has no input and no server action, because a form is not editable", () => {
    /*
     * Michael, books-65: "the form should only have numbers on it based on
     * records from the books, not something i snuck in last minute by erasing
     * one and replacing another."
     */
    const src = readFileSync(ROUTE, "utf8");
    expect(src).not.toMatch(/<input/i);
    expect(src).not.toMatch(/"use server"/);
  });

  it("is reachable from payroll setup, since it is exempt from the menu", () => {
    // This assertion is what makes the nav-gate exemption honest. If it goes,
    // the page is owner-only, absent from the menu, and reachable from nowhere.
    const src = readFileSync(SETUP, "utf8");
    expect(src).toMatch(/href="\/admin\/books\/new-hire-report"/);
  });

  it("puts the door at the TOP RIGHT of the header, where Michael asked for it", () => {
    /*
     * "I want a button in the setup employee page at the top right corner."
     *
     * Pinned because "top right" is the part of the request most easily lost in
     * a later refactor, and because a link that drifts into the page body is a
     * different thing from a button in the corner.
     */
    const src = readFileSync(SETUP, "utf8");
    const header = src.slice(src.indexOf("<header"), src.indexOf("</header>"));
    expect(header, "the new-hire link is not inside the page header").toContain(
      "/admin/books/new-hire-report",
    );
    expect(header, "the header row does not push the button to the right").toMatch(
      /justify-between/,
    );
  });

  it("offers the blank form as its own door", () => {
    // "I should be able to see the form empty." A single button cannot mean
    // both "what do I owe" and "show me a specimen", so there are two.
    const src = readFileSync(SETUP, "utf8");
    expect(src).toMatch(/href="\/admin\/books\/new-hire-report\?empty=1"/);
  });

  it("draws the blank without reading anybody's record", () => {
    /*
     * The empty view must not write SSN-reveal audit rows. A log that records
     * disclosures which never happened is worse than no log, because it makes
     * the real entries unbelievable.
     */
    const src = readFileSync(ROUTE, "utf8");
    expect(src).toMatch(/wantEmpty\s*\n?\s*\?\s*null/);
  });

  it("tells a read failure apart from an honest empty", () => {
    const src = readFileSync(ROUTE, "utf8");
    expect(src).toMatch(/readFailed/);
    expect(src).toMatch(/onlyRefusalIsEmptiness/);
  });

  it("uses the same sheet component every other form uses", () => {
    // Michael: "add it to the w-4 payroll setup page in the same way the other
    // forms are displayed." Rule 25 — extend, never duplicate.
    const src = readFileSync(ROUTE, "utf8");
    expect(src).toMatch(/FormSheet/);
    expect(src).toMatch(/FormPrintBar/);
    expect(src).toMatch(/NEW_HIRE_BOX_LESSONS/);
  });

  it("is registered under the form id the teaching registry knows", () => {
    expect(NEW_HIRE_FORM_ID).toBe("dshs_18_463");
  });
});
