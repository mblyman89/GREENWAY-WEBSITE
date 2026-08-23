/**
 * tests/compliance/books-roadmap-agreed-order.test.ts   (books-43, closing)
 *
 * THE ROADMAP IS A PROMISE, SO IT IS HELD TO RULE 66.
 *
 * Michael asked for one thing specifically when we agreed the order of the next
 * several slices:
 *
 *   "Please make sure to record everything we have just worked out as the
 *    strategy and roadmap going forward for the next several slices. I don't
 *    want to miss something and drift from what's important."
 *
 * A roadmap that is not maintained is worse than no roadmap, because it is
 * TRUSTED — `docs/BOOKS_ROADMAP.md` says so about itself, in its own closing
 * line. Michael will plan around this document. So every checkable claim it
 * makes is re-derived here from the tree, and the day one stops being true this
 * file says so out loud.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT IS BEING PROTECTED, AND WHAT IS DELIBERATELY NOT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * PROTECTED — claims with a fact behind them:
 *
 *   1. THE AGREED ORDER ITSELF (C → A → D → B). Recorded because the ordering
 *      is the whole point of the section and a silent re-ordering is exactly
 *      the "drift" Michael named.
 *   2. THE SIX UNREACHABLE MENTOR MODULES, by file, lesson count and line
 *      count. Every number in that table is re-counted from the module.
 *   3. THE LESSON SHAPE. The roadmap claims one renderer can serve all six
 *      because they share a field shape. That is an architectural commitment
 *      for slice C, so it is verified rather than asserted.
 *   4. THE `node:fs` CONSTRAINT. The roadmap says four of the six import
 *      `node:fs` and therefore cannot go straight into a browser bundle. If
 *      that count changes, the plan for slice C changes with it.
 *   5. THE NINE RCW FAILURES, split 5 missing-file / 4 mis-routed.
 *
 * NOT PROTECTED — and the reason matters:
 *
 *   The prose explaining WHY B is last, or what the three tabs should look
 *   like, is judgement, not fact. Asserting on judgement text produces tests
 *   that break when someone improves a sentence, which trains people to edit
 *   tests instead of thinking. Rule 66c: when a gate and a document disagree,
 *   the document usually wins. So this file checks NUMBERS and STRUCTURE, and
 *   leaves the argument alone.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE TRAP THIS FILE IS BUILT TO AVOID
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Rule 66d: a guard that can pass on a deleted file is not a guard. Counting
 * lessons in a module that no longer exists yields zero, and "zero lessons"
 * would sail past a `toBeGreaterThan(-1)` style check. So existence is asserted
 * first, every count is asserted POSITIVE, and the totals are cross-footed
 * against the sum of the parts — the same discipline a trial balance uses.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { INTEREST_LESSONS } from "@/lib/accounting/interest-mentor";
import { PERIOD_CLOSE_LESSONS } from "@/lib/accounting/period-close-mentor";
import { S_CORPORATION_YEAR_LESSONS } from "@/lib/accounting/s-corporation-year-mentor";
import { TAX_PENALTY_LESSONS } from "@/lib/accounting/tax-penalty-mentor";
import { PAYROLL_ONBOARDING_LESSONS } from "@/lib/payroll/payroll-onboarding-mentor";
import { RECONCILIATION_LESSONS } from "@/lib/reports/payroll-reconciliation-mentor";

const ROOT = join(__dirname, "..", "..");
const ROADMAP_PATH = join(ROOT, "docs", "BOOKS_ROADMAP.md");
const roadmap = readFileSync(ROADMAP_PATH, "utf8");

/**
 * THE OWNER'S COPY OF THE SAME PLAN.
 *
 * The plan is deliberately recorded twice: `BOOKS_ROADMAP.md` for whoever
 * implements it, and this document for Michael, in plain English. That is a
 * good arrangement and a known hazard - TWO DOCUMENTS DESCRIBING ONE PLAN IS
 * EXACTLY HOW A PLAN FORKS IN HALF. The roadmap gets edited during a slice, the
 * owner's copy does not, and six weeks later they disagree about the order
 * while both look authoritative.
 *
 * So the claims that appear in BOTH are checked in both places, and checked to
 * AGREE. Deliberately NOT checked: the argument, the analogies, the coaching.
 * That is judgement (rule 66c) and it must stay editable, which is what the
 * silent control in `scripts/prove-roadmap-gate.sh` proves.
 *
 * Read with `existsSync` asserted first: rule 66d, assert existence before
 * absence, because every `toContain` against an empty string fails for the
 * wrong reason and sends the reader hunting the wrong defect.
 */
const OWNER_DOC_PATH = join(ROOT, "docs", "MICHAEL-books-43-the-plan-from-here.md");
const OWNER_PDF_PATH = join(ROOT, "docs", "MICHAEL-books-43-the-plan-from-here.pdf");

/** Physical line count, the way `wc -l` counts it. */
function lineCount(relPath: string): number {
  const text = readFileSync(join(ROOT, relPath), "utf8");
  const n = text.split("\n").length;
  return text.endsWith("\n") ? n - 1 : n;
}

/**
 * The six modules the roadmap calls unreachable teaching, with the figures it
 * prints for each. Kept as DATA so every assertion below runs over all six —
 * a loop cannot forget the sixth entry the way six copy-pasted blocks can.
 */
const UNREACHABLE_TEACHING = [
  {
    file: "src/lib/payroll/payroll-onboarding-mentor.ts",
    lessons: PAYROLL_ONBOARDING_LESSONS,
    printedLessons: 33,
    printedLines: 746,
    importsNodeFs: false,
  },
  {
    file: "src/lib/accounting/tax-penalty-mentor.ts",
    lessons: TAX_PENALTY_LESSONS,
    printedLessons: 20,
    printedLines: 540,
    importsNodeFs: false,
  },
  {
    file: "src/lib/accounting/interest-mentor.ts",
    lessons: INTEREST_LESSONS,
    printedLessons: 10,
    printedLines: 328,
    importsNodeFs: true,
  },
  {
    file: "src/lib/accounting/period-close-mentor.ts",
    lessons: PERIOD_CLOSE_LESSONS,
    printedLessons: 9,
    printedLines: 281,
    importsNodeFs: true,
  },
  {
    file: "src/lib/accounting/s-corporation-year-mentor.ts",
    lessons: S_CORPORATION_YEAR_LESSONS,
    printedLessons: 5,
    printedLines: 225,
    importsNodeFs: true,
  },
  {
    file: "src/lib/reports/payroll-reconciliation-mentor.ts",
    lessons: RECONCILIATION_LESSONS,
    printedLessons: 5,
    printedLines: 225,
    importsNodeFs: true,
  },
] as const;

describe("books-43: the roadmap records the agreed order", () => {
  /**
   * RULE 39 VACUITY GUARD. Every test in this file searches `roadmap`. If the
   * file were missing or emptied, `toContain` would fail everywhere — but
   * anchoring it first means the failure says WHY in one line instead of
   * twenty.
   */
  it("the roadmap exists and is substantial", () => {
    expect(existsSync(ROADMAP_PATH)).toBe(true);
    expect(roadmap.length).toBeGreaterThan(20_000);
    expect(roadmap).toContain("BOOKS ROADMAP");
  });

  it("records the section Michael asked for by name", () => {
    expect(roadmap).toContain("THE AGREED ORDER");
  });

  /**
   * MICHAEL'S OWN WORDS, VERBATIM (rule 24). The order was HIS decision, and
   * the quote is what proves the sequence below is recorded rather than
   * chosen. If someone re-orders the slices, the quote sitting immediately
   * above the new order will contradict it in the reader's face.
   */
  it("quotes Michael's instruction verbatim rather than paraphrasing it", () => {
    /*
     * THE QUOTE IS LINE-WRAPPED INSIDE A MARKDOWN BLOCKQUOTE, so a raw
     * `toContain` on a whole sentence fails on the `\n> ` that markdown
     * requires — which is a formatting artefact, not a change to the words.
     * Normalise the blockquote markers and collapse whitespace, exactly as
     * `verify-verbatim-quotes` normalises both sides before comparing. Applied
     * to the DOCUMENT only; the expected strings are written out in full, so
     * the words themselves are still being checked character for character.
     */
    const flat = roadmap.replace(/\n>\s?/g, " ").replace(/\s+/g, " ");
    expect(flat).toContain(
      "Let's start with c first, then a, then d, then b last as recommended",
    );
    expect(flat).toContain("I don't want to miss something and drift from what's important");
  });

  /**
   * THE ORDER IS THE CLAIM, so it is checked as an ORDER — by position in the
   * file, not merely by presence. Four rows that all exist but in the wrong
   * sequence would satisfy a `toContain` for each one individually. This is
   * the same reason `matchesInOrder` exists in the quote verifier.
   */
  it("puts C, A, D and B in that sequence", () => {
    const section = roadmap.slice(roadmap.indexOf("THE AGREED ORDER"));
    const at = (label: string) => section.indexOf(`| **${label}** |`);

    const c = at("C");
    const a = at("A");
    const d = at("D");
    const b = at("B");

    for (const [label, idx] of [
      ["C", c],
      ["A", a],
      ["D", d],
      ["B", b],
    ] as const) {
      expect(idx, `row ${label} is missing from the agreed-order table`).toBeGreaterThan(-1);
    }

    expect(c, "C must come before A").toBeLessThan(a);
    expect(a, "A must come before D").toBeLessThan(d);
    expect(d, "D must come before B").toBeLessThan(b);
  });

  /**
   * WHY B IS LAST IS A FACT, NOT A PREFERENCE. It is last because Form 7203
   * is not in hand, and 7203 decides whether the S-corporation losses are
   * deductible at all. If that blocker is ever dropped from the owner-blocker
   * list, the justification for the ordering evaporates and someone should
   * notice.
   */
  it("names Form 7203 as the blocker that puts B last", () => {
    expect(roadmap).toContain("Form 7203");
    expect(roadmap).toContain("1366(d)(1)");
  });
});

describe("books-43: the two W-2 traps are recorded so nobody 'fixes' them", () => {
  /**
   * These two look like defects and are not. Both are proven verbatim in
   * books-43. The roadmap is where a future maintainer will look before
   * "correcting" a W-2 that appears not to foot, so both must survive here.
   */
  it("records that box 1 legitimately exceeds boxes 3 and 5", () => {
    expect(roadmap).toContain("3121(a)(2)(B)");
    expect(roadmap.toLowerCase()).toContain("box 1 legitimately exceeds boxes 3 and 5");
  });

  it("records that box 17 must be blank and PFML belongs in box 14", () => {
    expect(roadmap).toContain("Box 17 must be blank");
    expect(roadmap).toContain("box 14");
    expect(roadmap).toContain("WA Cares");
  });
});

describe("books-43: the slice-C recon figures are real", () => {
  /**
   * RULE 66d — ASSERT EXISTENCE BEFORE ABSENCE. A module that has been deleted
   * has zero lessons and zero importers, which reads identically to "finished,
   * buried work" in every count below. Existence first, always.
   */
  it("every module the roadmap names still exists", () => {
    for (const m of UNREACHABLE_TEACHING) {
      expect(existsSync(join(ROOT, m.file)), `${m.file} is gone — the roadmap describes a ghost`).toBe(
        true,
      );
    }
  });

  it("the roadmap names each module in its recon table", () => {
    for (const m of UNREACHABLE_TEACHING) {
      // Named by path minus the `src/lib/` prefix, as the table prints them.
      const printed = m.file.replace("src/lib/", "");
      expect(roadmap, `the recon table stopped naming ${printed}`).toContain(printed);
    }
  });

  /**
   * THE LESSON COUNTS, RE-DERIVED. Each figure in the roadmap table is
   * recounted from the module itself. Asserted POSITIVE as well as equal, so
   * an emptied array cannot satisfy the test by making both sides zero.
   */
  it("prints the true lesson count for every module", () => {
    for (const m of UNREACHABLE_TEACHING) {
      expect(m.lessons.length, `${m.file}: no lessons at all`).toBeGreaterThan(0);
      expect(m.lessons.length, `${m.file}: roadmap says ${m.printedLessons}`).toBe(
        m.printedLessons,
      );
      expect(roadmap, `roadmap must print ${m.printedLessons} for ${m.file}`).toContain(
        `| ${m.printedLessons} |`,
      );
    }
  });

  /**
   * THE LINE COUNTS — CHECKED IN BOTH DIRECTIONS (rule 66b).
   *
   * The first draft only compared `lineCount(file)` against the number held in
   * THIS TEST, and the tamper campaign walked straight through it: changing
   * `746` to `747` in the DOCUMENT was NOT CAUGHT, because nothing ever read
   * the document's copy of the figure. The test was verifying the test.
   *
   * One direction alone is theatre. The figure must match the module AND the
   * document must actually print it.
   */
  it("prints the true line count for every module", () => {
    for (const m of UNREACHABLE_TEACHING) {
      expect(lineCount(m.file), `${m.file}: roadmap says ${m.printedLines} lines`).toBe(
        m.printedLines,
      );
    }
  });

  it("the recon table's own row for each module carries the true figures", () => {
    for (const m of UNREACHABLE_TEACHING) {
      const printed = m.file.replace("src/lib/", "");
      // The row as the table renders it: | `path` | lessons | lines | **0** |
      const row = new RegExp(
        `\\|\\s*\`${printed.replace(/[.]/g, "\\.")}\`\\s*\\|\\s*(\\d+)\\s*\\|\\s*([\\d,]+)\\s*\\|`,
      ).exec(roadmap);
      expect(row, `no recon-table row found for ${printed}`).not.toBeNull();
      const rowLessons = Number((row as RegExpExecArray)[1]);
      const rowLines = Number((row as RegExpExecArray)[2]!.replace(/,/g, ""));
      expect(rowLessons, `${printed}: the table's lesson figure is stale`).toBe(m.lessons.length);
      expect(rowLines, `${printed}: the table's line figure is stale`).toBe(lineCount(m.file));
    }
  });

  /**
   * THE CROSS-FOOT. A trial balance does not trust its own rows; it adds them
   * up and compares to the total. Same here: the roadmap prints 82 lessons and
   * 2,345 lines, and both are checked against the sum of the parts rather than
   * re-counted independently. If a row is edited and the total is not, this
   * fails — which is the entire value of a cross-foot.
   */
  it("the totals foot to the sum of the rows", () => {
    const lessons = UNREACHABLE_TEACHING.reduce((n, m) => n + m.lessons.length, 0);
    const lines = UNREACHABLE_TEACHING.reduce((n, m) => n + lineCount(m.file), 0);

    expect(lessons).toBe(82);
    expect(lines).toBe(2_345);

    expect(roadmap, "the roadmap's lesson total is stale").toContain("**82**");
    expect(roadmap, "the roadmap's line total is stale").toContain("**2,345**");
  });

  /**
   * THE ARCHITECTURAL CLAIM. The roadmap commits slice C to ONE renderer for
   * all six modules, on the grounds that they share a field shape. That is a
   * design decision resting on a fact, so the fact is verified. If a seventh
   * field appears in one module, the "build it once" plan needs revisiting
   * before code is written, not after.
   */
  it("all six share the field shape one renderer can consume", () => {
    const REQUIRED = ["fn", "plainEnglish", "whyItExists", "theTrap", "whatIWouldDo", "authorityIds"];
    for (const m of UNREACHABLE_TEACHING) {
      for (const lesson of m.lessons) {
        expect(Object.keys(lesson).sort(), `${m.file}: lesson "${lesson.fn}" has a different shape`).toEqual(
          [...REQUIRED].sort(),
        );
      }
    }
  });

  /**
   * EVERY LESSON IS SUBSTANTIVE. "Reachable" is worthless if what becomes
   * reachable is a stub. Michael is going to READ these, so each field must
   * carry real prose.
   */
  it("every lesson is substantive prose, not a stub", () => {
    for (const m of UNREACHABLE_TEACHING) {
      for (const l of m.lessons) {
        expect(l.fn.trim().length, `${m.file}: empty fn`).toBeGreaterThan(0);
        expect(l.plainEnglish.trim().length, `${m.file} ${l.fn}: plainEnglish`).toBeGreaterThan(20);
        expect(l.whyItExists.trim().length, `${m.file} ${l.fn}: whyItExists`).toBeGreaterThan(20);
        expect(l.theTrap.trim().length, `${m.file} ${l.fn}: theTrap`).toBeGreaterThan(20);
        expect(l.whatIWouldDo.trim().length, `${m.file} ${l.fn}: whatIWouldDo`).toBeGreaterThan(20);
      }
    }
  });

  /**
   * ═══ AN UNCITED LESSON IS NOT AUTOMATICALLY A DEFECT. ═══
   *
   * The first draft of this file asserted `authorityIds.length > 0` for all 82
   * lessons. Sixteen of the thirty-three onboarding lessons failed it, and the
   * interesting part is that THE MODULE IS RIGHT AND THE ASSERTION WAS WRONG.
   *
   * The sixteen are `formatMilliPct`, `maskSsn`, `hourlyGrossCents`,
   * `buildChecklistView` and their kin — formatters, validators and view
   * builders. There is no statute governing how to render a percentage. The
   * seventeen that DO cite are exactly the ones with law behind them: the I-9
   * deadlines, the W-4 default, the SSN disclosure rules, `evaluateOnboarding`.
   *
   * Forcing a citation onto a formatter would produce a decorative one, and a
   * decorative citation is worse than none: it teaches the reader that the
   * badge means nothing. So the property worth asserting is not "everything
   * cites something", it is:
   *
   *   1. NO EMPTY-STRING IDS — a blank id is a broken link, unlike an empty
   *      list which is an honest silence.
   *   2. THE LEGAL LESSONS STILL CITE. Named individually, because those are
   *      the ones where losing a citation would be a real regression.
   */
  it("distinguishes an honest silence from a broken citation", () => {
    for (const m of UNREACHABLE_TEACHING) {
      for (const l of m.lessons) {
        for (const id of l.authorityIds) {
          expect(id.trim().length, `${m.file} ${l.fn}: an empty authority id is a dead link`).toBeGreaterThan(
            3,
          );
        }
      }
    }
  });

  it("the lessons that rest on law still cite it", () => {
    const MUST_CITE: readonly string[] = [
      "evaluateOnboarding",
      "validateI9",
      "i9Section2DueYmd",
      "i9RetainUntilYmd",
      "noW4DefaultComparison",
      "canRevealSsn",
      "renderSsnForRole",
    ];
    const byFn = new Map(PAYROLL_ONBOARDING_LESSONS.map((l) => [l.fn, l]));
    for (const fn of MUST_CITE) {
      const lesson = byFn.get(fn);
      expect(lesson, `${fn} has no lesson at all`).toBeDefined();
      expect(
        lesson?.authorityIds.length,
        `${fn} rests on statute and must keep citing it`,
      ).toBeGreaterThan(0);
    }
  });

  /**
   * THE `node:fs` CONSTRAINT — the fact that decides how slice C is built.
   *
   * Four of the six import `node:fs` at module scope for their build-time
   * coverage gates. That import cannot reach a browser bundle, so the wiring
   * must pull the lesson DATA without dragging `readFileSync` behind it.
   *
   * This is asserted per-module rather than as a bare count of four, because
   * WHICH modules carry the constraint is what the implementer needs to know.
   */
  it("records which modules carry the node:fs constraint", () => {
    for (const m of UNREACHABLE_TEACHING) {
      const code = readFileSync(join(ROOT, m.file), "utf8");
      const has = /from\s+["']node:fs["']/.test(code);
      expect(
        has,
        `${m.file}: roadmap says importsNodeFs=${m.importsNodeFs}, tree says ${has}. ` +
          `This decides whether the module can be imported by a client component.`,
      ).toBe(m.importsNodeFs);
    }
    const count = UNREACHABLE_TEACHING.filter((m) => m.importsNodeFs).length;
    expect(count).toBe(4);
    expect(roadmap).toContain("node:fs");
  });
});

describe("books-43: slice C's other two findings are recorded accurately", () => {
  /**
   * THE NINE RCW FAILURES, AND WHY THEY ARE TWO DEFECTS RATHER THAN ONE.
   *
   * Five cite files that were never fetched. Four route to `rcw-50.txt`
   * because the pattern truncates `50A.10.030` to `50` — the same
   * swallow-the-suffix bug that once sent §280E to `usc-280.txt`. The
   * distinction is load-bearing: fetching before fixing the router would file
   * the text under a name nothing looks for.
   */
  it("splits the nine RCW failures into missing-file and mis-routed", () => {
    expect(roadmap).toContain("rcw-50-24-010");
    expect(roadmap).toContain("rcw-50a-10-030");
    expect(roadmap).toContain("rcw-50.txt");

    /*
     * ASSERT THE SUBSTANCE, NOT A PHRASE.
     *
     * The first draft checked for the words "routing bug". The tamper campaign
     * removed one occurrence and the test STAYED GREEN, because the phrase
     * happens to appear twice — once naming the defect and once in the
     * sentence about fixing it. A keyword that appears more than once is not a
     * gate; it is a coin flip about which copy the vandal edits.
     *
     * The claim that actually matters to the implementer is the ORDER OF
     * OPERATIONS: fix the router BEFORE fetching, or the fetched text lands
     * under a filename nothing looks for. So assert that dependency.
     */
    expect(roadmap, "the roadmap must say the router is fixed BEFORE fetching").toMatch(
      /routing bug must be fixed \*before\* fetching/,
    );
    expect(roadmap).toContain("swallow-the-suffix");
  });

  /** The float `applyMilliPct`. Money is integer cents by house law. */
  it("records the duplicated rounding helper", () => {
    expect(roadmap).toContain("applyMilliPct");
  });

  /**
   * RULE 66a, IN THE DIRECTION THAT ACTUALLY BITES. Slice C will make these
   * six modules reachable, which will turn `owner-report-books-38` red — by
   * design. The roadmap must tell the implementer to MOVE the entries rather
   * than delete them, because deleting them throws away the only thing
   * watching for a regression.
   */
  it("tells the implementer to update the reachability probe, not delete it", () => {
    expect(roadmap).toContain("owner-report-books-38");
    expect(roadmap).toContain("UPDATED, not deleted");
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE OWNER'S COPY OF THE PLAN (rule 66)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Michael asked, in the instruction that opens this file, that the plan be
 * recorded so he does not "drift from what's important." A plan recorded only
 * in the implementer's roadmap is not recorded FOR HIM. So there are two
 * documents, and the load-bearing facts in them must match each other and
 * match the code.
 *
 * WHAT IS CHECKED HERE, AND WHY EACH ONE:
 *
 *   1. IT EXISTS AND IS SUBSTANTIAL. Rule 66d.
 *   2. IT AGREES WITH THE ROADMAP ABOUT THE ORDER. Checked by POSITION, the
 *      same way the roadmap's own order is checked - four labels that all
 *      appear but in the wrong sequence would satisfy a presence check.
 *   3. THE LESSON TOTAL IS RE-DERIVED FROM THE CODE. Not compared to the
 *      roadmap's figure - compared to the actual sum of the six arrays. Two
 *      documents agreeing on a wrong number is the failure mode that a
 *      document-to-document comparison cannot see.
 *   4. THE TWO W-2 TRAPS SURVIVE. These are the two things a future
 *      bookkeeper will try to "fix". If the explanation ever falls out of the
 *      owner's copy, he loses the ability to stop them.
 *   5. THE FORM 7203 BLOCKER IS NAMED. It is the one thing he has to go and
 *      fetch; a plan that does not say so has failed at its only job.
 *   6. THE PDF SHIPPED. A markdown file Michael cannot open is not a delivery
 *      - the same standard books-40, books-41 and books-42 are held to.
 */
describe("books-43: the owner's copy of the plan says the same thing", () => {
  it("the owner document exists and is substantial", () => {
    expect(
      existsSync(OWNER_DOC_PATH),
      "docs/MICHAEL-books-43-the-plan-from-here.md is missing - the plan was recorded for the implementer but not for Michael",
    ).toBe(true);
    const doc = readFileSync(OWNER_DOC_PATH, "utf8");
    expect(doc.length).toBeGreaterThan(8_000);
  });

  /**
   * THE SAME ORDER, CHECKED THE SAME WAY. If the owner's copy and the roadmap
   * ever disagree about the sequence, Michael and the implementer are working
   * from different plans and neither of them knows it.
   */
  it("agrees with the roadmap about C -> A -> D -> B, by position", () => {
    const doc = readFileSync(OWNER_DOC_PATH, "utf8");
    const at = (label: string) => doc.indexOf(`| **${label}** |`);

    const positions = [
      ["C", at("C")],
      ["A", at("A")],
      ["D", at("D")],
      ["B", at("B")],
    ] as const;

    for (const [label, idx] of positions) {
      expect(idx, `row ${label} is missing from the owner document's order table`).toBeGreaterThan(
        -1,
      );
    }

    const [[, c], [, a], [, d], [, b]] = positions;
    expect(c, "C must come before A in the owner document too").toBeLessThan(a);
    expect(a, "A must come before D in the owner document too").toBeLessThan(d);
    expect(d, "D must come before B in the owner document too").toBeLessThan(b);

    /*
     * AND THE HEADING ITSELF STATES THE SEQUENCE. The table could be right
     * while a heading above it says something else, and the heading is what a
     * skimming reader actually reads.
     */
    expect(doc, "the owner document's heading must state the agreed sequence").toMatch(
      /C\s*→\s*A\s*→\s*D\s*→\s*B/,
    );
  });

  /**
   * THE TOTAL IS RE-DERIVED FROM THE CODE, NOT COPIED FROM THE ROADMAP.
   *
   * This is the assertion that catches the case both documents get wrong
   * together - which is the likely case, because the second document is
   * written by copying the first.
   */
  it("prints a lesson total that matches the sum of the six modules", () => {
    const doc = readFileSync(OWNER_DOC_PATH, "utf8");
    const actualTotal = UNREACHABLE_TEACHING.reduce((sum, m) => sum + m.lessons.length, 0);
    expect(actualTotal).toBeGreaterThan(0);

    const row = doc.match(/\|\s*\*\*Total\*\*\s*\|\s*\*\*(\d+)\*\*\s*\|/);
    expect(row, "the owner document must print a Total row for the lesson table").not.toBeNull();
    expect(
      Number(row?.[1]),
      `the owner document says ${row?.[1]} lessons; the six modules actually contain ${actualTotal}`,
    ).toBe(actualTotal);

    // The prose figure has to agree with the table figure in the same document.
    expect(doc).toContain(`${actualTotal} individual lessons`);
  });

  /**
   * THE TWO TRAPS. Not the wording - the SUBSTANCE. Box 17 must be stated as
   * blank, and the reason box 1 exceeds boxes 3 and 5 must still be there,
   * because "box 1 is bigger" without "§3121(a)(2)(B) excludes the premium
   * from FICA wages" is a claim he cannot defend to anybody.
   */
  it("keeps both W-2 traps, with their reasons", () => {
    const doc = readFileSync(OWNER_DOC_PATH, "utf8");

    expect(doc, "the box 17 trap must survive in the owner document").toContain(
      "Box 17 must be blank",
    );
    expect(doc, "box 17's replacement destination must be named").toContain("box 14");

    expect(doc, "the box 1 vs boxes 3/5 trap must survive").toMatch(
      /box 1 (will be|exceeds)/i,
    );
    expect(doc, "the trap without its authority is not defensible").toContain("3121(a)(2)(B)");
  });

  /** The one thing Michael has to go and fetch before slice B can finish. */
  it("names the Form 7203 blocker and what it gates", () => {
    const doc = readFileSync(OWNER_DOC_PATH, "utf8");
    expect(doc).toContain("Form 7203");
    expect(doc, "the reason 7203 blocks B is the basis limitation").toContain("1366(d)(1)");
  });

  /**
   * A MARKDOWN FILE MICHAEL CANNOT OPEN IS NOT A DELIVERY.
   *
   * Held to the same standard as every previous owner report. The size floor
   * exists because `wkhtmltopdf` will happily emit a valid, empty PDF if the
   * input path is wrong, and an empty PDF passes `existsSync` (rule 39).
   */
  it("shipped a PDF that is not a stub", () => {
    expect(
      existsSync(OWNER_PDF_PATH),
      "the PDF has not been built - a markdown file is not a delivery",
    ).toBe(true);
    expect(statSync(OWNER_PDF_PATH).size).toBeGreaterThan(20_000);
  });
});
