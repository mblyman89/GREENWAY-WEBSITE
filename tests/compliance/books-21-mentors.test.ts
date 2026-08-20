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
import {
  INTEREST_LESSONS,
  assertEveryInterestFunctionIsTaught,
  assertEveryInterestLessonIsSubstantive,
  exportedInterestFunctionNames,
  findInterestLesson,
  taughtInterestFunctionNames,
} from "@/lib/accounting/interest-mentor";
import {
  S_CORPORATION_YEAR_LESSONS,
  assertEverySCorporationYearFunctionIsTaught,
  assertEverySCorporationYearLessonIsSubstantive,
  exportedSCorporationYearFunctionNames,
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

  it("reads the real engine and finds all ten functions", () => {
    expect(exportedInterestFunctionNames()).toEqual([
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
    expect(p!.theTrap).toMatch(/7,020|7020/);
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
