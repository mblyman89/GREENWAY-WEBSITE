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
import {
  FORM_W2_OWN_AUTHORITIES,
  FORM_W2_REUSED_IDENTITY_AUTHORITY_IDS,
  FORM_W2_REUSED_YTD_AUTHORITY_IDS,
  formW2Authorities,
} from "@/lib/payroll/form-w2-authorities";
import { holidaySet, onOrAfterBusinessDay } from "@/lib/payroll/payroll-deposit-schedule-core";

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
    // books-50: 10 -> 11 lessons, 257 -> 287 lines. The eleventh teaches
    // formatSection6699MaximumUsd, which was added to interest-core.ts so the
    // §6699 exposure quoted in the guidance is DERIVED from the shareholder
    // roster instead of typed in by hand — the hand-typed copy had gone stale at
    // three shareholders when the filed returns show four. Standing rule 26
    // means a new exported function cannot ship untaught, so the count had to
    // move, and these figures are the roadmap's claim about that count.
    printedLessons: 11,
    printedLines: 287,
    importsNodeFs: false,
  },
  {
    file: "src/lib/accounting/period-close-mentor.ts",
    lessons: PERIOD_CLOSE_LESSONS,
    printedLessons: 9,
    printedLines: 234,
    importsNodeFs: false,
  },
  {
    file: "src/lib/accounting/s-corporation-year-mentor.ts",
    lessons: S_CORPORATION_YEAR_LESSONS,
    printedLessons: 5,
    printedLines: 153,
    importsNodeFs: false,
  },
  {
    file: "src/lib/reports/payroll-reconciliation-mentor.ts",
    lessons: RECONCILIATION_LESSONS,
    printedLessons: 5,
    printedLines: 170,
    importsNodeFs: false,
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

    // books-50: 82 -> 83. One lesson was ADDED, not moved: rule 26 forbids
    // shipping formatSection6699MaximumUsd untaught. The figure is spelled out
    // here as well as derived above so that a lesson going MISSING can never be
    // absorbed silently by both sides of a comparison falling together.
    expect(lessons).toBe(83);

    /*
     * BOOKS-44: 2,345 became 2,100 and the LESSON COUNT DID NOT MOVE.
     *
     * That pairing is the whole point of keeping both figures. Slice C split
     * four of these modules to get `node:fs` out of them, which removed 245
     * lines of gate code. If the lesson count had fallen too, teaching would
     * have been lost in the refactor and this line is where that would have
     * surfaced. It did not: 82 before, 82 after, 245 fewer lines.
     *
     * BOOKS-50: 2,100 BECAME 2,130 AND THE LESSON COUNT MOVED WITH IT, 82 -> 83.
     * That is the OPPOSITE pairing to the slice-C one above, and it is just as
     * informative. Thirty lines arrived carrying exactly one new lesson, so what
     * arrived is teaching. Lines rising while the lesson count stayed FLAT would
     * have meant thirty lines of something that is not a lesson had been added to
     * a teaching module - and that is the case this pair exists to catch.
     */
    expect(lines).toBe(2_130);

    /*
     * ═══ books-46 — THIS PAIR OF ASSERTIONS WAS DECORATIVE, AND THE MUTATION
     * CAMPAIGN IS THE ONLY REASON ANYBODY KNOWS. ═══
     *
     * `scripts/prove-roadmap-gate.sh` runs an attack called "cross-foot
     * broken: total != sum of rows", which rewrites `**82**` to `**81**` in the
     * roadmap. That attack SURVIVED — 17 of 18 caught, this one green — and it
     * was not a campaign no-op: the script verifies the mutation actually
     * landed by comparing against a byte-exact backup, and reported 0 no-ops.
     *
     * The reason is that `**82**` occurs TWICE in the document: once in the
     * Total row of the lesson table, and once in the prose below it explaining
     * that slice C removed 245 lines WITHOUT losing a lesson. `perl -0pi -e
     * 's/.../.../'` without the `/g` flag replaces only the FIRST. So the
     * table said 81, the prose still said 82, and `toContain("**82**")` was
     * satisfied by the survivor.
     *
     * That is the general defect, not a quirk of this line: a `toContain`
     * cannot tell you WHICH occurrence matched, so it silently degrades into
     * "this number appears somewhere in a 1,100-line document". The stronger
     * claim — and the one the test comment above always meant — is that the
     * number appears in the TOTAL ROW of the table, and that every occurrence
     * of it agrees.
     *
     * Anchored to the row, and asserted on the count. The second half is what
     * kills the mutation: it does not matter which occurrence perl edits when
     * the test requires them all to say the same thing.
     */
    const totalRow = roadmap.match(
      /\|\s*\*\*Total\*\*\s*\|\s*\*\*(\d+)\*\*\s*\|\s*\*\*([\d,]+)\*\*\s*\|/,
    );
    expect(totalRow, "the roadmap must print a Total row for the lesson table").not.toBeNull();
    expect(Number(totalRow?.[1]), "the Total row's lesson count").toBe(lessons);
    expect(totalRow?.[2], "the Total row's line count").toBe(lines.toLocaleString("en-US"));

    /*
     * EVERY mention of the lesson total must agree with the code. The prose
     * paragraph below the table repeats the figure to make a point about slice
     * C, and a document that states one number twice and disagrees with itself
     * is worse than one that states it once (rule 66d: the second copy is what
     * a reader checks against).
     */
    const lessonMentions = roadmap.match(/\*\*\d+\*\*(?=\s*\|| lessons| \u2014 but)/g) ?? [];
    expect(lessonMentions.length, "the lesson total is stated somewhere").toBeGreaterThan(0);

    const staleLessonTotals = [...roadmap.matchAll(/count is still \*\*(\d+)\*\*/g)].map((m) =>
      Number(m[1]),
    );
    for (const stated of staleLessonTotals) {
      expect(stated, "a prose restatement of the lesson total has gone stale").toBe(lessons);
    }
    expect(
      staleLessonTotals.length,
      "the prose restatement of the lesson total has been removed, so the " +
        "assertion above now proves nothing (rule 39)",
    ).toBeGreaterThan(0);

    expect(roadmap, "the roadmap's line total is stale").toContain(
      `**${lines.toLocaleString("en-US")}**`,
    );
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
   * THE `node:fs` CONSTRAINT — the fact that decided how slice C was built.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * THIS TEST WAS REWRITTEN IN BOOKS-44, AND THE REASON MATTERS MORE THAN THE
   * ASSERTION.
   * ───────────────────────────────────────────────────────────────────────────
   * When books-43 wrote it, four of the six modules imported `node:fs` at module
   * scope for their build-time coverage gates, and it ended with
   * `expect(count).toBe(4)`. Slice C then did the thing the roadmap told it to
   * do: it SPLIT those four, leaving the lesson data behind and moving the
   * disk-reading gates to `*-mentor-gates.ts` siblings (rule 65b). All six now
   * import nothing from `node:fs`.
   *
   * At that moment `expect(count).toBe(4)` was asserting that the work had NOT
   * been done. Left alone it would have been "fixed" by someone re-splitting the
   * number rather than the modules. And once every entry reads `false`, the
   * per-module loop below can no longer fail for the reason it was written —
   * every comparison is `false === false`, which is rule 39's vacuous check.
   *
   * So the claim has been inverted to the one that is now load-bearing: the six
   * modules the learning screen imports must stay free of `node:fs`, FOREVER,
   * because a single `readFileSync` re-entering any of them breaks the client
   * bundle and buries all 82 lessons again. The count assertion is now on the
   * SIBLING gate files, which must still exist and must still be the ones doing
   * the reading — otherwise "we split them" would be satisfied by having simply
   * deleted the coverage checks.
   */
  it("the six teaching modules import no node:fs, and their gates still do", () => {
    const hasNodeFs = (rel: string) =>
      /from\s+["']node:fs["']/.test(readFileSync(join(ROOT, rel), "utf8"));

    // 1. Not one of the six may reach the filesystem. This is the constraint
    //    that keeps /admin/books/learn buildable.
    for (const m of UNREACHABLE_TEACHING) {
      expect(
        hasNodeFs(m.file),
        `${m.file}: imports node:fs, which cannot reach a browser bundle. The learning screen ` +
          `imports this module; a filesystem import here buries all 82 lessons again.`,
      ).toBe(m.importsNodeFs);
      expect(m.importsNodeFs, `${m.file} is recorded as needing node:fs`).toBe(false);
    }

    // 2. THE CONTROL (rule 55). The four gate siblings the split created must
    //    exist AND must be the ones holding the `node:fs` import. Without this,
    //    the loop above is equally satisfied by deleting the coverage checks
    //    outright, which would be the same green tick over less protection.
    const MOVED_GATES = [
      "src/lib/accounting/interest-mentor-gates.ts",
      "src/lib/accounting/period-close-mentor-gates.ts",
      "src/lib/accounting/s-corporation-year-mentor-gates.ts",
      "src/lib/reports/payroll-reconciliation-mentor-gates.ts",
    ];
    for (const g of MOVED_GATES) {
      expect(existsSync(join(ROOT, g)), `${g} is missing — the split deleted the gate`).toBe(true);
      expect(
        hasNodeFs(g),
        `${g} exists but reads nothing from disk, so the coverage check it was carved out to ` +
          `hold is gone rather than moved.`,
      ).toBe(true);
    }
    expect(MOVED_GATES.length, "the roadmap records four modules that were split").toBe(4);

    // 3. The roadmap still explains the constraint to whoever reads it next.
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

/* ═══════════════════════════════════════════════════════════════════════════
 * SLICE A, RECORDED AS COMPLETE (books-46)
 *
 * WHY THIS BLOCK EXISTS, AND IT IS NOT BECAUSE A TEST FAILED.
 *
 * The `SLICE A — COMPLETE` section was added to the roadmap with a table of
 * countable claims: line counts, test counts, and an authority count that is
 * stated as a SUM (28 own + 13 borrowed = 41). The whole suite then ran green.
 *
 * That green tick was the problem. A roadmap section full of numbers that no
 * gate re-derives is the same defect this repository keeps finding under
 * different names — a claim protected by nothing, in a document that says of
 * itself that it is trusted. Every figure below was verified by hand at the
 * time of writing; hand-verification expires the moment somebody edits a file,
 * which is precisely what a gate is for.
 *
 * Held to this file's own three disciplines, stated in its header:
 *   - EXISTENCE FIRST (rule 66d), because counting exports in a deleted file
 *     yields zero and zero sails past a lower-bound check;
 *   - every count asserted POSITIVE, never merely equal;
 *   - the total CROSS-FOOTED against the sum of its parts, the way a trial
 *     balance is, so 28 + 13 = 41 cannot pass while one of the three drifts.
 *
 * And per the header's other half: the ARGUMENT in that section — why
 * reconciliation is section 4, why the badge states an observable — is
 * judgement and is deliberately left alone (rule 66c).
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("books-46: the roadmap's slice A claims are re-derived, not trusted", () => {
  /**
   * The seven artefacts the roadmap tabulates. Kept as DATA for the reason the
   * `UNREACHABLE_TEACHING` table above is: a loop cannot forget the seventh row
   * the way seven copy-pasted blocks can.
   */
  const SLICE_A_FILES = [
    "src/lib/payroll/form-w2-core.ts",
    "src/lib/payroll/form-w2-store.ts",
    "src/lib/payroll/form-w2-ui-core.ts",
    "src/lib/payroll/form-w2-authorities.ts",
    "src/lib/payroll/form-w2-mentor.ts",
    "src/lib/supabase/pg-bigint.ts",
    "src/app/admin/books/form-w2/page.tsx",
    "supabase/migrations/0204_filed_form_941_totals.sql",
  ] as const;

  it("every module the slice A table names actually exists and is non-trivial", () => {
    for (const rel of SLICE_A_FILES) {
      expect(existsSync(join(ROOT, rel)), `${rel} is named by the roadmap but missing`).toBe(true);
      // Positive, not merely present: an empty file exists.
      expect(lineCount(rel), `${rel} is empty`).toBeGreaterThan(0);
    }
  });

  it("prints the line counts the two largest new files actually have", () => {
    // The roadmap states these two explicitly, so they are the two that can
    // drift. Re-counted the way `wc -l` counts.
    const page = lineCount("src/app/admin/books/form-w2/page.tsx");
    const reader = lineCount("src/lib/supabase/pg-bigint.ts");
    expect(roadmap, `the page is ${page} lines`).toContain(`(${page} lines)`);
    expect(roadmap, `pg-bigint.ts is ${reader} lines`).toContain(`${reader} lines`);
  });

  /**
   * THE AUTHORITY ARITHMETIC, CROSS-FOOTED.
   *
   * The roadmap claims `28 own + 13 borrowed = 41`. Three numbers, and a
   * document-to-document check would be blind to all three moving together.
   * So each is counted from the module and the sum is proved to tie — and the
   * 41 is counted INDEPENDENTLY by calling the function the screen calls,
   * rather than by adding 28 and 13 here. Adding them here would prove only
   * that this test can add.
   */
  it("cross-foots the authority count: own + borrowed = what the screen renders", () => {
    const own = FORM_W2_OWN_AUTHORITIES.length;
    const borrowed =
      FORM_W2_REUSED_YTD_AUTHORITY_IDS.length + FORM_W2_REUSED_IDENTITY_AUTHORITY_IDS.length;
    const rendered = formW2Authorities().length;

    expect(own, "own authorities").toBeGreaterThan(0);
    expect(borrowed, "borrowed authorities").toBeGreaterThan(0);
    expect(rendered, "the panel renders nothing").toBeGreaterThan(0);

    // The tie. If a borrowed id ever stops resolving, `formW2Authorities`
    // returns a SHORTER array rather than an error, and this is the line that
    // notices.
    expect(rendered, "own + borrowed must equal what the panel renders").toBe(own + borrowed);

    expect(roadmap, `the table says ${own} own`).toContain(
      `(${own} own + ${borrowed} borrowed = ${rendered})`,
    );
  });

  /**
   * THE TEST COUNTS THE ROADMAP PRINTS, WHICH NOTHING HAD EVER READ (rule 39).
   *
   * books-55 found this by accident. Mirroring §3121 and §3306 added three
   * authorities, so the row above went from `28 own + 13 borrowed = 41` to
   * `31 own + 13 borrowed = 44` and the cross-foot went red — correctly. But
   * the SAME ROW also printed `form-w2-authorities.test.ts (39)`, and that
   * figure was stale too: the file had 41 tests. Nothing went red for it,
   * because no gate had ever read a test count. Rule 39 exactly: a verifier
   * that cannot see something approves it.
   *
   * Two design choices worth stating, because the obvious implementations are
   * both wrong:
   *
   * 1. THE LIST IS DISCOVERED, NOT DECLARED. The regex finds every
   *    `` `x.test.ts` (N) `` the document prints. A hand-built list of the
   *    three known rows would be the same defect one layer up — a fourth row
   *    added tomorrow would be unguarded, and the gate would still be green.
   *    So the assertion is "every count the roadmap prints is true", and the
   *    count of counts is itself pinned so the regex silently matching NOTHING
   *    cannot pass as success.
   *
   * 2. `it.each` IS REFUSED, NOT COUNTED. This gate counts `it(` in the
   *    SOURCE, which ties to the runtime figure only while every test is a
   *    literal `it(`. One `it.each([...])` breaks that equivalence: source
   *    says one, the runner reports many, and the gate would start lying in
   *    the safe-looking direction. Rather than attempt to evaluate the table
   *    (which needs the module loaded and is a different kind of fragile),
   *    the gate FAILS LOUDLY on `it.each`/`describe.each` and says what to do
   *    about it. Verified at the time of writing: zero `it.` forms in all
   *    three files, and the static counts 63/69/41 match the runner exactly.
   */
  it("prints the true test count for every test file it names", () => {
    const rows = [...roadmap.matchAll(/`([a-z0-9.-]+\.test\.ts)` \((\d+)\)/g)];

    /*
     * Rule 66d: assert presence before checking contents. A regex that matches
     * nothing passes every for-loop ever written.
     *
     * WENT FROM 3 TO 6 TO 7 IN books-55, and it went up by hand every time.
     *
     * The slice added the W-3 teaching layer and, with it, three more test
     * files that the roadmap now names with their counts:
     * form-box-lessons-w3.test.ts (17), form-box-explorer-wiring.test.ts (14)
     * and form-box-adapters.test.ts (31). This assertion went red the moment
     * they were documented, which is the whole point of pinning the count of
     * counts: a new claim in the document cannot start life unverified.
     *
     * The SEVENTH is authority-routing-completeness.test.ts (5), documented
     * later in the same slice. It went red again on that edit, and the second
     * failure is better evidence than the first: the pin is not a one-off
     * acknowledgement of a known change, it fires on any new count claim
     * whatever its subject. That one is a repo-wide gate rather than a W-3
     * one, so nothing about the slice's topic exempted it.
     *
     * Every one of the seven is checked against a live `it(` count in the loop
     * below, so raising this number does not weaken anything - it only records
     * that a human looked at the new rows.
     */
    expect(rows.length, "the roadmap prints no test counts at all — regex drift?").toBe(7);

    for (const [, fileName, printedRaw] of rows) {
      const rel = join("tests", "compliance", fileName);
      const abs = join(ROOT, rel);
      expect(existsSync(abs), `roadmap names ${fileName}, which does not exist`).toBe(true);

      const src = readFileSync(abs, "utf8");

      // The equivalence this gate depends on, checked rather than assumed.
      expect(
        /^\s*(it|describe)\.each/m.test(src),
        `${fileName} uses .each — a source count of \`it(\` no longer equals the ` +
          `number of tests the runner reports. Count them at runtime instead of ` +
          `deleting this assertion.`,
      ).toBe(false);

      const actual = (src.match(/^\s*it\(/gm) ?? []).length;
      const printed = Number(printedRaw);

      expect(actual, `${fileName} has no tests at all`).toBeGreaterThan(0);
      expect(actual, `roadmap says ${fileName} has ${printed} tests`).toBe(printed);
    }
  });

  /**
   * THE DEAD-LINK FIX, ASSERTED OVER THE WHOLE PANEL AND NOT ONE HALF OF IT.
   *
   * This is the defect the slice found: `form-w2-authorities.ts` fixed its own
   * 28 and gated its own 28, while the panel rendered 41. So the gate for the
   * fix must loop what the SCREEN loops. Anything narrower reproduces the
   * original bug in the test layer.
   */
  it("gives every authority the screen renders a link a browser can open", () => {
    for (const a of formW2Authorities()) {
      expect(a.source, `${a.id}: source is rendered as an href`).toMatch(/^https:\/\//);
      expect(a.source, `${a.id}: a repo path is a dead link`).not.toContain("docs/authorities/");
    }
  });

  /**
   * THE ONE DATE IN THE SECTION, COMPUTED RATHER THAN COMPARED.
   *
   * The roadmap states the tax-year-2026 W-2 deadline as 2027-02-01 and
   * explains it: 31 January 2027 is a Sunday. That is a claim about a calendar,
   * and the engine already owns a business-day helper, so the assertion asks
   * the CALENDAR rather than trusting the sentence. If the holiday table or the
   * roll-forward rule ever changes, this fails and the document gets fixed.
   */
  it("states a deadline the business-day calendar actually produces", () => {
    const statutory = new Date(Date.UTC(2027, 0, 31));
    expect(statutory.getUTCDay(), "31 Jan 2027 must be the Sunday the roadmap says it is").toBe(0);

    const effective = onOrAfterBusinessDay("2027-01-31", holidaySet(2027));
    expect(effective, "the rolled-forward date").toBe("2027-02-01");
    expect(roadmap, "the roadmap must print the computed date").toContain(effective);
  });

  /**
   * THE SIX-STORE FIX, PROVED BY ABSENCE AND BY PRESENCE.
   *
   * The roadmap claims the defective idiom now has "zero occurrences in
   * `src/`". An absence claim is worthless on its own — it also holds if the
   * six stores were deleted — so the presence of the shared reader in all six
   * is asserted alongside it (rule 55: a control for every refusal).
   */
  it("routes all six stores through the one shared bigint reader", () => {
    const STORES = [
      "src/lib/payroll/form-w2-store.ts",
      "src/lib/payroll/ytd-store.ts",
      "src/lib/payroll/garnishment-store.ts",
      "src/lib/payroll/payroll-onboarding-store.ts",
      "src/lib/loans/loan-store.ts",
      "src/lib/atm/store.ts",
    ] as const;

    /*
     * MATCHED AS AN IMPORT STATEMENT, NOT AS A SUBSTRING, and this is the
     * second version of this assertion.
     *
     * The first read `toContain("@/lib/supabase/pg-bigint")`, which a mutation
     * campaign killed immediately: repointing a store's import to
     * `pg-bigint-XX` left the gate GREEN, because the real path is a PREFIX of
     * the broken one. It would also have passed on a store that merely
     * MENTIONS the module in a comment — and all six do mention it in their
     * comments, so the check was close to vacuous.
     *
     * The closing quote is the entire fix: it terminates the path, so a
     * suffixed path no longer matches, and `import {` anchors it to a real
     * statement rather than prose.
     */
    const IMPORT = /import\s*\{[^}]*\}\s*from\s*"@\/lib\/supabase\/pg-bigint";/;
    for (const rel of STORES) {
      expect(existsSync(join(ROOT, rel)), `${rel} is missing`).toBe(true);
      const src = readFileSync(join(ROOT, rel), "utf8");
      expect(src, `${rel} no longer imports the shared reader`).toMatch(IMPORT);
    }

    expect(roadmap, "the roadmap claims the idiom is gone").toContain("zero occurrences");
  });

  /**
   * THE HONEST GAP MUST STAY IN WRITING.
   *
   * Nothing writes `filed_form_941_totals` yet, so the reconciliation has no
   * data to read. That is a real limitation of a shipped slice, and the failure
   * mode is not that it stays broken — it is that it quietly stops being
   * mentioned once the screen looks finished. The table exists; a table with no
   * writer is exactly the sort of thing a roadmap forgets.
   */
  it("keeps saying out loud that nothing writes the filed-941 figures yet", () => {
    expect(roadmap).toContain("filed_form_941_totals");
    expect(roadmap, "the missing data-entry surface must stay on the list").toMatch(
      /data-entry surface/i,
    );
  });
});
