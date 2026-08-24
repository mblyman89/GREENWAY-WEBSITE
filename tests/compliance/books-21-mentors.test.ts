/**
 * tests/compliance/books-21-mentors.test.ts   (books-21)
 *
 * THE MENTOR LAYER FOR BOTH BOOKS-21 ENGINES, AND PROOF THE GATES FIRE.
 *
 * Standing rule 26 requires a lesson per exported function. Standing rule 39
 * requires that the check on that requirement be proven capable of failing,
 * because in books-18 a mutation that disabled a coverage gate survived an
 * entire suite \u2014 the self-check had re-implemented the gate instead of calling
 * it, so it was testing a copy.
 *
 * Every failability proof below therefore calls the REAL exported gate and
 * feeds it a fixture file on disk that it controls.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import { findGuidanceAuthority } from "@/lib/accounting/books-guidance-core";
// books-50: imported so the lesson's dollar figure can be checked against what
// the engine actually computes, rather than against another hand-typed copy.
import { formatSection6699MaximumUsd } from "@/lib/accounting/interest-core";
import {
  assertEveryInterestFunctionIsTaught,
  assertEveryInterestLessonIsSubstantive,
  exportedInterestFunctionNames,
} from "@/lib/accounting/interest-mentor-gates";
import {
  INTEREST_LESSONS,
  findInterestLesson,
  taughtInterestFunctionNames,
} from "@/lib/accounting/interest-mentor";
import {
  assertEverySCorporationYearFunctionIsTaught,
  assertEverySCorporationYearLessonIsSubstantive,
  exportedSCorporationYearFunctionNames,
} from "@/lib/accounting/s-corporation-year-mentor-gates";
import {
  S_CORPORATION_YEAR_LESSONS,
  findSCorporationYearLesson,
  taughtSCorporationYearFunctionNames,
} from "@/lib/accounting/s-corporation-year-mentor";

/** A throwaway .ts file on disk, so the gates read something real. */
const fixture = (body: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "books21-mentor-"));
  const p = join(dir, "fixture-core.ts");
  writeFileSync(p, body, "utf8");
  return p;
};

describe("M1: the S-corporation-year mentor covers the engine", () => {
  it("teaches every exported function", () => {
    expect(() => assertEverySCorporationYearFunctionIsTaught()).not.toThrow();
  });

  it("reads the real engine and finds the five functions", () => {
    const exported = exportedSCorporationYearFunctionNames();
    expect(exported).toEqual([
      "validateSElectionFacts",
      "classifySYear",
      "aaaMustOpenAtZero",
      "openingBalancesMustBeCarriedForward",
      "describeOpeningBalanceSource",
    ]);
  });

  it("has no lesson for a function that does not exist", () => {
    // Guards the other direction: a lesson left behind after a rename is dead
    // documentation that still counts toward coverage.
    const exported = new Set(exportedSCorporationYearFunctionNames());
    for (const name of taughtSCorporationYearFunctionNames()) {
      expect(exported, `lesson for ${name} teaches a function that no longer exists`).toContain(name);
    }
  });

  it("every lesson is substantive, not a placeholder", () => {
    expect(() => assertEverySCorporationYearLessonIsSubstantive()).not.toThrow();
  });

  it("finds a lesson by name and misses cleanly", () => {
    expect(findSCorporationYearLesson("aaaMustOpenAtZero")?.fn).toBe("aaaMustOpenAtZero");
    expect(findSCorporationYearLesson("nope")).toBeUndefined();
  });

  it("THE COVERAGE GATE FIRES \u2014 rule 39", () => {
    // A fixture exporting a function nobody taught. If this does not throw, the
    // green result above means nothing.
    const p = fixture("export function someUntaughtFunction(): void {}\n");
    expect(() => assertEverySCorporationYearFunctionIsTaught(p)).toThrow(/COVERAGE GAP/);
  });

  it("THE VACUOUS-READ GUARD FIRES \u2014 rule 39", () => {
    // A file with no exports at all. A gate that scanned nothing would pass.
    const p = fixture("// no exports here\nconst x = 1;\nexport const y = x;\n");
    expect(() => assertEverySCorporationYearFunctionIsTaught(p)).toThrow(/GATE BROKEN/);
  });

  it("THE THINNESS GATE FIRES \u2014 rule 39", () => {
    expect(() =>
      assertEverySCorporationYearLessonIsSubstantive([
        { fn: "x", plainEnglish: "too short", whyItExists: "x", theTrap: "x", whatIWouldDo: "x", authorityIds: [] },
      ]),
    ).toThrow(/TOO THIN/);
  });

  it("THE THINNESS GATE REFUSES AN EMPTY LIST \u2014 rule 39", () => {
    expect(() => assertEverySCorporationYearLessonIsSubstantive([])).toThrow(/GATE BROKEN/);
  });

  it("teaches the actual lesson of the shipped defect, in the trap field", () => {
    // Rule 29 with teeth: the mentor layer exists to stop a recurrence, so the
    // lesson has to name the mechanism, not just say "be careful".
    const l = findSCorporationYearLesson("aaaMustOpenAtZero");
    expect(l).toBeDefined();
    expect(l!.theTrap).toMatch(/first year/i);
    expect(l!.theTrap).toMatch(/capital gain/i);
    const v = findSCorporationYearLesson("validateSElectionFacts");
    expect(v!.whyItExists).toMatch(/2026/);
    expect(v!.whatIWouldDo).toMatch(/1120-S/);
  });
});

describe("M2: the interest mentor covers the engine", () => {
  it("teaches every exported function", () => {
    expect(() => assertEveryInterestFunctionIsTaught()).not.toThrow();
  });

  it("reads the real engine and finds all eleven functions", () => {
    // The order is SOURCE order, not alphabetical, which is why the newest
    // function is first rather than last: formatSection6699MaximumUsd sits up in
    // the constants section beside SECTION_6699_STATUTORY_BASE_CENTS and
    // SECTION_6699_MAX_MONTHS, the two values it multiplies, rather than down
    // among the date helpers.
    expect(exportedInterestFunctionNames()).toEqual([
      "formatSection6699MaximumUsd",
      "isIsoDate",
      "daysBetween",
      "daysInYearOf",
      "quarterOf",
      "compoundDailyInterestCents",
      "rateKindFor",
      "computeInterest",
      "computeSection6699Penalty",
      "section6651MinimumFor",
      "validateSection6651Rows",
    ]);
  });

  it("has no orphaned lesson", () => {
    const exported = new Set(exportedInterestFunctionNames());
    for (const name of taughtInterestFunctionNames()) {
      expect(exported, `lesson for ${name} teaches a function that no longer exists`).toContain(name);
    }
  });

  it("every lesson is substantive", () => {
    expect(() => assertEveryInterestLessonIsSubstantive()).not.toThrow();
  });

  it("finds a lesson by name and misses cleanly", () => {
    expect(findInterestLesson("computeInterest")?.fn).toBe("computeInterest");
    expect(findInterestLesson("nope")).toBeUndefined();
  });

  it("THE COVERAGE GATE FIRES \u2014 rule 39", () => {
    const p = fixture("export function anotherUntaughtOne(): void {}\n");
    expect(() => assertEveryInterestFunctionIsTaught(p)).toThrow(/COVERAGE GAP/);
  });

  it("THE VACUOUS-READ GUARD FIRES \u2014 rule 39", () => {
    const p = fixture("export const notAFunction = 1;\n");
    expect(() => assertEveryInterestFunctionIsTaught(p)).toThrow(/GATE BROKEN/);
  });

  it("THE THINNESS GATE FIRES \u2014 rule 39", () => {
    expect(() =>
      assertEveryInterestLessonIsSubstantive([
        { fn: "x", plainEnglish: "short", whyItExists: "short", theTrap: "short", whatIWouldDo: "short", authorityIds: [] },
      ]),
    ).toThrow(/TOO THIN/);
  });

  it("teaches the two findings that cost or save real money", () => {
    // The §6699 blind spot.
    const p = findInterestLesson("computeSection6699Penalty");
    expect(p!.whyItExists).toMatch(/answered zero|answered \$0/i);
    // THIS LINE USED TO REQUIRE "$7,020", AND THAT IS WHY IT IS COMMENTED. [SUPERSEDED-ROSTER]
    //
    // $7,020 is $195 x 12 months x THREE shareholders. Greenway has FOUR, and [SUPERSEDED-ROSTER]
    // the filed Schedule K-1s always did; the roster recorded in migration 0172
    // was wrong (85/10/5, with one row named only "Mother"), and books-50 [SUPERSEDED-ROSTER]
    // corrected it to 85/5/5/5. The correct twelve-month figure at the statutory
    // base is $9,360.
    //
    // So this assertion had quietly inverted: it was pinning the lesson to the
    // UNDERSTATED number and would have FAILED the day the lesson was corrected
    // — a test defending the defect it was written to expose. A test is a
    // suspect too (standing rule 22a). It now requires the right figure, which
    // means it still does its original job — proving the lesson names a concrete
    // amount rather than waving at "a large penalty" — while no longer voting
    // for the wrong one.
    expect(p!.theTrap).toMatch(/9,360|9360/);
    // And it must NOT have quietly kept the old figure alongside the new one.
    expect(p!.theTrap).not.toMatch(/7,020|7020/);
    expect(p!.theTrap).toMatch(/any part of the year/i);
    // The §6621(c) immunity.
    const r = findInterestLesson("rateKindFor");
    expect(r!.whatIWouldDo).toMatch(/cannot be charged/i);
    expect(r!.authorityIds).toContain("irc-1361-a-s-and-c-corporation-defined");
    // And the correction I had to make to my own assumption.
    const m = findInterestLesson("section6651MinimumFor");
    expect(m!.theTrap).toMatch(/statutory BASE|statutory base/);
  });

  it("explains WHY the engine refuses, since that is the first question", () => {
    const c = findInterestLesson("computeInterest");
    expect(c!.theTrap).toMatch(/previous quarter/i);
    expect(c!.theTrap).toMatch(/reconciles perfectly against itself/i);
  });

  // -------------------------------------------------------------------------
  // books-50: the roster correction reached this engine, so it must reach the
  // lesson too.
  // -------------------------------------------------------------------------
  it("teaches the derived-figure helper, and teaches WHY it is derived", () => {
    const f = findInterestLesson("formatSection6699MaximumUsd");
    expect(f, "formatSection6699MaximumUsd ships untaught \u2014 standing rule 26").toBeTruthy();
    // The whole reason the function exists is that a hand-typed figure went
    // stale when the roster changed. If the lesson does not say that, it is
    // teaching the mechanics and withholding the point.
    expect(`${f!.whyItExists} ${f!.theTrap}`).toMatch(/roster|headcount|shareholder/i);
    expect(f!.whyItExists).toMatch(/2,340|2340/);
    // It must also warn that this is a floor, not a worst case, because the
    // statutory base has been inflation-adjusted every year since 2014.
    expect(`${f!.theTrap} ${f!.whatIWouldDo}`).toMatch(/floor|minimum|indexed|inflat/i);
  });

  it("the taught figure AGREES with what the engine actually computes", () => {
    // A lesson that quotes a number the code does not produce is worse than no
    // lesson, because it is believed. This is the same class of defect the
    // helper was written to kill, so it is checked rather than trusted: the
    // figure is read out of the ENGINE and looked for in the PROSE.
    const computed = formatSection6699MaximumUsd(); // e.g. "$9,360"
    expect(computed).toBe("$9,360");
    const penalty = findInterestLesson("computeSection6699Penalty");
    expect(
      penalty!.theTrap,
      `the \u00a76699 lesson must quote ${computed}, the figure the engine computes`,
    ).toContain(computed);
  });

  it("no lesson in this module still quotes the three-shareholder figure", () => {
    // The sweep, not the spot-check. $7,020 was correct for a roster of three [SUPERSEDED-ROSTER]
    // and is now simply wrong; if it survives anywhere in these lessons, the
    // owner reads an exposure $2,340 lower than it is.
    for (const lesson of INTEREST_LESSONS) {
      const prose = `${lesson.plainEnglish} ${lesson.whyItExists} ${lesson.theTrap} ${lesson.whatIWouldDo}`;
      expect(prose, `lesson for ${lesson.fn} still quotes the pre-correction figure`).not.toMatch(
        /\$7,020|\$7020/, // [SUPERSEDED-ROSTER] this regex FORBIDS the figure
      );
    }
  });
});

describe("M3: both mentors cite authorities that resolve", () => {
  // The tripwire in authority-id-resolution.test.ts scans src/ for
  // `authorityIds` positions, and books-21 widened it to see lower-kebab ids.
  // This is the same requirement asserted directly on the lesson objects, so a
  // change in the extractor's regex cannot quietly stop covering the mentors.
  const all = [...S_CORPORATION_YEAR_LESSONS, ...INTEREST_LESSONS];

  it("every cited id resolves to a real authority", () => {
    const bad: string[] = [];
    for (const l of all) {
      for (const id of l.authorityIds) {
        if (!findGuidanceAuthority(id)) bad.push(`${l.fn} -> ${id}`);
      }
    }
    expect(bad, `unresolved: ${bad.join(", ")}`).toEqual([]);
  });

  it("this check is not vacuous \u2014 there are citations to check", () => {
    const total = all.reduce((n, l) => n + l.authorityIds.length, 0);
    expect(total).toBeGreaterThan(15);
  });

  it("a made-up id would be caught", () => {
    // Proving the assertion above can fail. These two are the exact ids I
    // invented and shipped into this branch before the tripwire caught them.
    expect(findGuidanceAuthority("IRC_1361_S_CORPORATION_DEFINED")).toBeUndefined();
    expect(findGuidanceAuthority("REG_1_1368_2_AAA_MECHANICS")).toBeUndefined();
  });

  it("every lesson teaching a refusing function cites something", () => {
    for (const l of all) {
      expect(l.authorityIds.length, `${l.fn} teaches nothing to look up`).toBeGreaterThan(0);
    }
  });
});

describe("M4: the lessons read as English, not as code comments", () => {
  const all = [...S_CORPORATION_YEAR_LESSONS, ...INTEREST_LESSONS];

  it("no lesson field contains an identifier from the source", () => {
    // Rule 29. Michael has an accounting degree and has not opened a book in
    // thirteen years; `beginningAaaCents` means nothing to him.
    for (const l of all) {
      for (const field of [l.plainEnglish, l.whyItExists, l.theTrap, l.whatIWouldDo]) {
        expect(field, `${l.fn} leaks camelCase`).not.toMatch(/\b[a-z]+[A-Z][a-zA-Z]*\b/);
        expect(field, `${l.fn} leaks SCREAMING_SNAKE`).not.toMatch(/\b[A-Z]{2,}_[A-Z_]+\b/);
      }
    }
  });

  it("every lesson names a concrete consequence somewhere", () => {
    // A trap with no consequence is a caution sign in a field. Each lesson must
    // mention money, tax, a dollar figure or a filing.
    for (const l of all) {
      const joined = `${l.whyItExists} ${l.theTrap} ${l.whatIWouldDo}`;
      expect(joined, `${l.fn} never says what goes wrong`).toMatch(
        /\$|dollar|tax|money|penalt|interest|gain|file|filed|filing|return/i,
      );
    }
  });

  it("the two lesson sets do not overlap", () => {
    const a = new Set(taughtSCorporationYearFunctionNames());
    for (const n of taughtInterestFunctionNames()) expect(a).not.toContain(n);
  });
});
