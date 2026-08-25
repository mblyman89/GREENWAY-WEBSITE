/**
 * tests/compliance/form-box-explorer-wiring.test.ts   (books-47, slice D)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE TAB SYSTEM IS ACTUALLY WIRED TO THE SCREENS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Michael asked for one thing in this slice: "I want to be able to see the
 * form, and click a box to have it teach me all there is to know about that
 * box." Three tabs — the form, the teaching, the reconciliation.
 *
 * Every piece of that is unit-tested to death. The boxes have an adapter with
 * self-tests, the lessons have verbatim gates, the screen logic has nineteen
 * tests and a mutation campaign, and the reconciliations have sixteen more.
 *
 * And NONE of that notices if a page forgets to render the explorer.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THIS GATE READS SOURCE TEXT, WHICH IS NORMALLY A BAD IDEA
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Because the failure is an ABSENCE, and an absence in a React server
 * component cannot be detected by importing it. Rendering these pages in a
 * test would require Supabase, `requireBooksAccess`, cookies and a live
 * session; that is why the repo already has precedent for asserting page
 * wiring by reading the file (see company-information-wiring.test.ts and
 * timesheet-wiring.test.ts).
 *
 * The specific bug this catches, which really was present until now:
 * `FormBoxExplorer` declares `checks` OPTIONAL with a default of `[]`. So a
 * page that renders the explorer without passing `checks` compiles cleanly,
 * type-checks cleanly, passes every test in the repository, and shows Michael
 * a third tab that says "There is nothing to reconcile on this form yet."
 * forever. A tab that always says the same thing is not a feature, it is a
 * promise (standing rule 50).
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT IS DELIBERATELY *NOT* ASSERTED
 * ───────────────────────────────────────────────────────────────────────────
 *
 * That every page passes `checks`. Some forms genuinely have nothing to
 * reconcile against yet — the reconciliations for the 941 need the filed
 * totals nobody has entered, and the W-2/W-3 comparison needs four filed
 * 941s. Demanding a checks prop everywhere would force exactly the fabricated
 * data rule 62d forbids.
 *
 * Instead the honest state is written down: a KNOWN list of pages that render
 * the explorer WITHOUT reconciliations, each with the reason. If a page is
 * added or wired up, this list must be updated, so the gap can never quietly
 * grow.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

/**
 * Every screen that is supposed to carry the Form/Why/Check tab system, with
 * the module supplying its lessons.
 *
 * Held as DATA rather than as a list of hand-written `it` blocks (rule 43), so
 * adding a form to the teaching system means adding one row here.
 */
interface TaughtScreen {
  readonly label: string;
  readonly page: string;
  readonly lessonsExport: string;
  /**
   * Why this screen has no reconciliation rows yet, or null if it has them.
   * A string here is an admission, not a permission — it is the sentence that
   * has to be deleted when the gap is closed.
   */
  readonly checksMissingBecause: string | null;
}

const TAUGHT_SCREENS: readonly TaughtScreen[] = [
  {
    label: "Form 940 (annual FUTA)",
    page: "src/app/admin/books/form-940/page.tsx",
    lessonsExport: "FORM_940_LESSONS",
    checksMissingBecause: null,
  },
  {
    label: "Form 941 (quarterly federal)",
    page: "src/app/admin/books/form-941/page.tsx",
    lessonsExport: "FORM_941_LESSONS",
    /*
     * CLOSED IN books-48. The admission that used to sit here read:
     *
     *   "The 941's reconciliations compare the return against the totals
     *    actually filed, and nothing writes filed_form_941_totals yet.
     *    Building rows from figures nobody has entered would compare the
     *    return against itself and paint a green tick that means nothing."
     *
     * Something writes it now: the confirmation step on the 941 screen, backed
     * by `saveFiledForm941`. The reasoning in that sentence was right and was
     * honoured rather than worked around - the figures are TYPED IN from the
     * filed paper, not copied from the computed return, so the two sides of
     * every check row come from genuinely independent sources and a green tick
     * now carries information. Quoted rather than deleted so the reason the
     * gap existed survives the closing of it.
     */
    checksMissingBecause: null,
  },
  {
    label: "Washington quarterly returns",
    page: "src/app/admin/books/wa-quarterly/page.tsx",
    lessonsExport: "WA_QUARTERLY_LESSONS",
    checksMissingBecause:
      "The Washington forms reconcile against ESD and L&I confirmations, and against the PFML " +
      "and WA Cares amounts withheld — which the year-to-date accumulators do not yet carry. " +
      "Until they do, any row here would be arithmetic against a number we invented.",
  },
  {
    // ADDED books-49. This screen had NO explorer at all: `w2Boxes` was written
    // and called by nothing, and `FORM_W2_LESSONS` is a MentorLesson, which the
    // explorer cannot consume. The eight BoxLessons were written for this slice.
    label: "Form W-2 (annual wage report)",
    page: "src/app/admin/books/form-w2/page.tsx",
    lessonsExport: "FORM_W2_BOX_LESSONS",
    checksMissingBecause:
      "The W-2/W-3 reconciliation compares the annual totals against four filed 941s, and this " +
      "screen already renders that comparison itself in its own reconciliation card rather than " +
      "through the explorer's Check tab. Duplicating it into the tab would show Michael the same " +
      "figures twice and give two places for them to disagree.",
  },
  {
    /*
     * ADDED books-55. The W-3 rendered as a TABLE on this page and nothing
     * else: the thirty-one W-3 lessons were written, gated and UNREACHABLE
     * from the interface. A table shows the figures; it cannot say what a box
     * means, whose money it is, or which line of which 941 must agree with it.
     *
     * It shares a page with the W-2 explorer rather than having its own route,
     * because the W-2 and the W-3 are filed together and reconciled against
     * each other, and Michael reads them as one job. It is a SEPARATE explorer
     * on that page rather than a merged box list, because the two forms number
     * their boxes differently — "box 13" is a row of checkboxes on the W-2 and
     * a reserved third-party sick pay field on the W-3 — and one list
     * containing two different box 13s would teach the wrong thing about both.
     */
    label: "Form W-3 (annual transmittal)",
    page: "src/app/admin/books/form-w2/page.tsx",
    lessonsExport: "FORM_W3_BOX_LESSONS",
    checksMissingBecause:
      "The W-3's reconciliation is the same comparison as the W-2's — the annual totals against " +
      "the four filed 941s — and it is already rendered in this page's own reconciliation card. " +
      "Putting it in this explorer's Check tab as well would show Michael the same figures " +
      "twice, in two places that can disagree with each other.",
  },
];

/**
 * ═══ WHY THIS FILE NOW STRIPS COMMENTS BEFORE IT SEARCHES (books-49) ═══
 *
 * Standing rule 89: a grep gate must not read the comments that explain the
 * gate. This is not hypothetical here. The pages carry comments that QUOTE the
 * defective code they replaced, verbatim, so the reason for the fix survives —
 * form-940/page.tsx contains the literal text
 *
 *     `{result.ok ? <FormBoxExplorer .../> : null}`
 *
 * inside a comment explaining why that gating was wrong. A scan looking for
 * conditionally-rendered explorers finds that comment and fails a page that is
 * correct, and the natural "fix" is to delete the explanation — trading a
 * comment that teaches for a gate that passes.
 *
 * So comments come out first, and the search runs on code only.
 */
function stripComments(src: string): string {
  // Block comments first (they can contain //), then line comments.
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function read(rel: string): string {
  const path = join(ROOT, rel);
  expect(existsSync(path), `${rel} does not exist`).toBe(true);
  return readFileSync(path, "utf8");
}

/**
 * How many explorer blocks a page ACTUALLY renders.
 *
 * Comments are stripped first. Without that, the count is wrong: form-940's
 * page has one explorer and a comment that quotes `<FormBoxExplorer .../>`
 * while explaining the books-49 bug, and a naive grep reports two. A gate that
 * miscounts upward is worse than no gate, because it can be satisfied by
 * writing prose.
 */
function explorerCount(rel: string): number {
  return (stripComments(read(rel)).match(/<FormBoxExplorer/g) ?? []).length;
}

/**
 * Rows grouped by the file they live in, because TWO taught screens can share
 * one page. See the docblock on the "own explorer block" test below.
 */
function rowsByPage(): Map<string, readonly TaughtScreen[]> {
  const byPage = new Map<string, TaughtScreen[]>();
  for (const screen of TAUGHT_SCREENS) {
    const list = byPage.get(screen.page) ?? [];
    list.push(screen);
    byPage.set(screen.page, list);
  }
  return byPage;
}

describe("books-47: every taught screen actually renders the tab system", () => {
  /**
   * RULE 39 VACUITY GUARD.
   *
   * Every test below iterates TAUGHT_SCREENS. If that list were ever emptied
   * by a refactor, all of them would pass by iterating nothing. Anchor it.
   */
  it("has a non-trivial list of screens to check", () => {
    expect(TAUGHT_SCREENS.length).toBeGreaterThanOrEqual(3);
  });

  it("renders FormBoxExplorer on every screen that claims to teach", () => {
    for (const screen of TAUGHT_SCREENS) {
      const src = read(screen.page);
      expect(src, `${screen.label} does not import the explorer`).toContain("FormBoxExplorer");
      // Imported but never rendered is the same failure with extra steps.
      expect(src, `${screen.label} imports the explorer but never renders it`).toContain(
        "<FormBoxExplorer",
      );
    }
  });

  it("passes real lessons rather than an empty array", () => {
    for (const screen of TAUGHT_SCREENS) {
      const src = read(screen.page);
      expect(src, `${screen.label} does not pass ${screen.lessonsExport}`).toContain(
        screen.lessonsExport,
      );
      // `lessons={[]}` renders a Why tab where every box is untaught. It is
      // the exact shape of shipped-but-empty teaching.
      expect(src).not.toContain("lessons={[]}");
    }
  });

  /**
   * ═══════════════════════════════════════════════════════════════════════
   * EVERY ROW OWNS AN EXPLORER BLOCK OF ITS OWN
   * ═══════════════════════════════════════════════════════════════════════
   *
   * FOUND IN books-55 BY MUTATION, NOT BY REVIEW.
   *
   * The mutation: delete the entire `<FormBoxExplorer title="Form W-3, box by
   * box" ... />` block from the W-2 page. That is the whole feature the slice
   * was for — the thirty-one W-3 lessons become unreachable from the interface
   * again, which is precisely the defect Michael reported in his own words
   * ("the form pages are still just walls of text").
   *
   * THE SUITE STAYED GREEN. Eleven of eleven.
   *
   * WHY, EXACTLY. Every assertion above is keyed on `screen.page`, and the
   * W-2 row and the W-3 row name THE SAME FILE. So:
   *   - `toContain("<FormBoxExplorer")` was satisfied by the W-2's explorer;
   *   - `toContain("FORM_W3_BOX_LESSONS")` was satisfied by the surviving
   *     IMPORT statement, because `noUnusedLocals` is not enabled in this
   *     repo's tsconfig and the CI eslint scope does not cover `src/app`, so
   *     an import with no remaining use is not an error anywhere;
   *   - the reachability gate iterated the explorers that were still there.
   *
   * Each assertion asked "does this FILE contain X" when the question was
   * "does this SCREEN render X". With one row per file those two questions
   * have the same answer, which is why the gate looked sound for four slices.
   * The W-3 was the first time two rows shared a file, and the flaw became
   * load-bearing the moment it existed.
   *
   * THIS IS THE SAME CLASS OF HOLE ALREADY FIXED ONCE IN THIS SLICE (rule 23:
   * fix the class, not the instance). In form-box-teaching-core.test.ts the
   * source-tree gate compared lesson-set FILE NAMES through a Set, so a second
   * lesson set added to an existing file was invisible. Same shape: a
   * file-level identity standing in for a thing-level identity, and a dedupe
   * silently absorbing the second thing. Two independent gates in one slice
   * had it. It is a pattern in how I write these, not an accident.
   *
   * THE FIX IS COUNTING, WHICH IS WHY IT CANNOT BE SATISFIED BY PROSE:
   *   (a) a page shared by N rows must render AT LEAST N explorer blocks;
   *   (b) every row's lessons export must appear as an actual `lessons={...}`
   *       PROP, not merely somewhere in the file.
   * Deleting the W-3 block now fails (a) — 1 block for 2 rows — and fails (b)
   * — the import survives but the prop does not.
   */
  it("gives every taught screen its own explorer block, not a shared one", () => {
    for (const [page, rows] of rowsByPage()) {
      const rendered = explorerCount(page);
      expect(
        rendered,
        `${page} is listed as the page for ${rows.length} taught screen(s) ` +
          `(${rows.map((r) => r.label).join(", ")}) but renders only ${rendered} ` +
          `<FormBoxExplorer> block(s). One block cannot teach two different forms: ` +
          `the W-2 and the W-3 both have a "box 13" and it means a different thing ` +
          `on each. A missing block here means real lessons exist and are ` +
          `unreachable from the screen.`,
      ).toBeGreaterThanOrEqual(rows.length);
    }
  });

  it("passes each screen's lessons as a prop, not merely as a stale import", () => {
    let checked = 0;
    for (const screen of TAUGHT_SCREENS) {
      const code = stripComments(read(screen.page));
      /*
       * Deliberately matching the PROP, `lessons={THE_EXPORT}`, and allowing
       * whitespace because a formatter may wrap it. An import statement can
       * never match this shape, which is the entire point: the import is what
       * made the deletion invisible.
       */
      const asProp = new RegExp(`lessons=\\{\\s*${screen.lessonsExport}\\s*\\}`);
      expect(
        asProp.test(code),
        `${screen.label}: ${screen.lessonsExport} appears in ${screen.page} but never as ` +
          `a lessons={...} prop on an explorer. An unused import satisfies a ` +
          `toContain() check and teaches Michael nothing — this repo has ` +
          `noUnusedLocals off and does not lint src/app in CI, so nothing else ` +
          `would ever report it.`,
      ).toBe(true);
      checked += 1;
    }
    // Rule 39 / 66d: existence before absence.
    expect(checked).toBe(TAUGHT_SCREENS.length);
  });

  /**
   * The counting gate above is a FLOOR (`>=`), so it cannot notice an explorer
   * block that belongs to no row at all — a sixth explorer wired to a lessons
   * module nobody registered here. That is the mirror-image absence (rule 66b:
   * check both directions), and it is how a taught screen gets built without
   * ever being reconciled or excused.
   */
  it("has no explorer block that belongs to no registered screen", () => {
    const byPage = rowsByPage();
    let totalRendered = 0;
    for (const page of byPage.keys()) totalRendered += explorerCount(page);
    expect(
      totalRendered,
      `the taught pages render ${totalRendered} explorer blocks but only ` +
        `${TAUGHT_SCREENS.length} screens are registered in TAUGHT_SCREENS. An ` +
        `unregistered explorer is a screen that is never checked for ` +
        `reconciliations and never counted in the honest gap total below. Add a ` +
        `row for it.`,
    ).toBe(TAUGHT_SCREENS.length);
  });

  it("passes real boxes rather than an empty array", () => {
    for (const screen of TAUGHT_SCREENS) {
      expect(read(screen.page)).not.toContain("boxes={[]}");
    }
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * books-49: THE EXPLORER IS REACHABLE, NOT MERELY PRESENT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * THE BUG THIS FILE MISSED, IN MICHAEL'S WORDS:
 *
 *   "I am unable to see or use the tab system we built to let me see the
 *    various forms and be able to click them for learning about them. The form
 *    pages are still just walls of text."
 *
 * Every assertion above passed the whole time. `<FormBoxExplorer` was in all
 * three files, real lessons were passed, real boxes were passed, and the Check
 * tab was wired. The gate was green and the feature was invisible.
 *
 * The reason: the explorer was nested inside `{result.ok ? ... : null}`, and
 * `result.ok` is FALSE until real pay runs exist. Greenway's first payroll is
 * 1 January 2027. So the teaching surface was correctly built, correctly
 * tested, and unreachable for a year — standing rule 40 (an unreachable guard
 * is an untested guard) applied to UI, and rule 88 (no UI branch for a state
 * the core cannot produce) turned inside out: this was a UI branch for a state
 * the core could not YET produce.
 *
 * This file's own header claimed it "catches an ABSENCE". It did not. A
 * rendered-but-unreachable component is textually present and visually absent,
 * and `toContain` cannot tell those apart. That is why the assertions below
 * are about POSITION rather than existence.
 */
describe("books-49: the teaching tabs are reachable before any payroll exists", () => {
  /**
   * The core assertion: no `<FormBoxExplorer` may be preceded, on its own line
   * or the lines just above it, by a data-dependent ternary that could render
   * `null` instead.
   *
   * Implemented by finding each explorer and walking BACKWARDS through the
   * enclosing JSX expression to see whether it sits on the true-branch of a
   * conditional keyed on computed results.
   */
  it("never nests the explorer inside a result.ok conditional", () => {
    let checked = 0;
    for (const screen of TAUGHT_SCREENS) {
      const code = stripComments(read(screen.page));
      const lines = code.split("\n");
      for (let i = 0; i < lines.length; i += 1) {
        if (!lines[i].includes("<FormBoxExplorer")) continue;
        checked += 1;
        // The five lines above an explorer are where a wrapping ternary lives.
        const preamble = lines.slice(Math.max(0, i - 5), i).join("\n");
        /*
         * The shapes that made the tabs invisible, all three of them real:
         *   {result.ok ? <FormBoxExplorer
         *   {result.ok && result.subjectCount > 0 ? <FormBoxExplorer
         *   {result.ok && result.value.lines.length > 0 ? ( ... <FormBoxExplorer
         * A ternary on `result.` opening just above an explorer is the pattern.
         */
        const gated = /\{\s*result\.[A-Za-z0-9_.]*[^}]*\?\s*\(?\s*$/m.test(preamble);
        expect(
          gated,
          `${screen.label} line ${i + 1}: the explorer is nested inside a conditional on ` +
            `computed data. It will not render until real payroll exists, which is exactly ` +
            `the bug Michael reported. Render it unconditionally and branch on the BOXES ` +
            `instead: figures when they exist, teachingBoxes() when they do not.`,
        ).toBe(false);
      }
    }
    // Rule 39 / rule 66d: assert existence before absence. If the explorers
    // ever vanish, the loop above passes by inspecting nothing.
    expect(checked, "no explorers were found at all, so this gate proved nothing").toBeGreaterThanOrEqual(4);
  });

  /**
   * A page may not fall back to an EMPTY box list either.
   *
   * `boxes={result.ok ? adapter(ret) : []}` renders the tabs, satisfies the
   * assertion above, and shows Michael a form with no rows — a working screen
   * with nothing on it, which looks like a bug in his data rather than a
   * missing feature. Every page must name a teaching fallback instead.
   */
  it("falls back to a teaching specimen rather than to no boxes", () => {
    for (const screen of TAUGHT_SCREENS) {
      const code = stripComments(read(screen.page));
      expect(code, `${screen.label} passes an empty box list`).not.toMatch(/boxes=\{[^}]*:\s*\[\]\s*\}/);
      expect(
        code,
        `${screen.label} renders the explorer but never calls teachingBoxes(), so before ` +
          `payroll exists it has nothing to show`,
      ).toContain("teachingBoxes(");
    }
  });

  /**
   * THE WASHINGTON SCREEN MAY NOT SKIP A FORM FOR HAVING NO BOXES.
   *
   * Separate assertion because it is a separate defect with a separate cause.
   * The tab loop used to end with `if (boxes.length === 0) return null`, and
   * Form 5208B produces ZERO engine lines BY DESIGN — it is a wage detail, one
   * row per person, carried in `ret.wageDetail`. So that tab was dropped even
   * with a full year of real payroll behind it. Not a timing bug like the
   * others; that one never healed on its own.
   */
  it("does not drop a Washington form for having no engine lines", () => {
    const code = stripComments(read("src/app/admin/books/wa-quarterly/page.tsx"));
    expect(
      code,
      "the Washington screen still skips forms with no boxes, which permanently drops the " +
        "5208B wage detail — the one form that never has engine lines at all",
    ).not.toMatch(/boxes\.length\s*===\s*0\s*\)\s*return null/);
  });
});

describe("books-47: the Check tab is either wired or honestly declared empty", () => {
  /**
   * THE GATE THAT FOUND THE BUG.
   *
   * When this file was written, `checks=` appeared on ZERO pages — the third
   * tab said "There is nothing to reconcile on this form yet." on every
   * screen in the system. That is not a state anyone chose; it is a state
   * nothing was watching.
   */
  it("wires reconciliations on every screen not explicitly excused", () => {
    for (const screen of TAUGHT_SCREENS) {
      if (screen.checksMissingBecause !== null) continue;
      const src = read(screen.page);
      expect(src, `${screen.label} renders a permanently empty Check tab`).toContain("checks={");
    }
  });

  it("requires a written reason for every screen with no reconciliations", () => {
    for (const screen of TAUGHT_SCREENS) {
      if (screen.checksMissingBecause === null) continue;
      // The reason must be a real explanation, not "TODO".
      expect(
        screen.checksMissingBecause.length,
        `${screen.label} is excused without a real reason`,
      ).toBeGreaterThan(80);
      expect(screen.checksMissingBecause.toLowerCase()).not.toContain("todo");
    }
  });

  /**
   * THE COUNT, PINNED.
   *
   * This is the number that must go DOWN. It is here so that closing one of
   * the two gaps forces a deliberate edit to this test, and so that nobody can
   * add a fourth un-reconciled screen without noticing they did.
   */
  it("states exactly how many screens still lack reconciliations", () => {
    const excused = TAUGHT_SCREENS.filter((s) => s.checksMissingBecause !== null);
    expect(excused.map((s) => s.label)).toEqual([
      "Washington quarterly returns",
      "Form W-2 (annual wage report)",
      "Form W-3 (annual transmittal)",
    ]);
    /*
     * WENT FROM 2 TO 1 IN books-48.
     *
     * Form 941 came off this list because the confirmation step now supplies
     * the independent side of the comparison. The one that remains is blocked
     * on data that does not exist in the system yet - the year-to-date
     * accumulators do not carry the PFML and WA Cares amounts withheld - and
     * NOT on work nobody has done, which is the distinction that decides
     * whether an excuse is honest.
     *
     * WENT FROM 1 TO 2 IN books-49, AND THIS TEST IS WHY THE INCREASE IS HERE
     * IN WRITING. The W-2 screen gained an explorer in that slice (it had none
     * at all), so it joined the list. Adding it made this test fail, which is
     * the behaviour that was designed in: a new un-reconciled screen cannot be
     * added quietly, only deliberately, with the reason typed out above.
     *
     * The W-2's excuse is a different KIND from Washington's. Washington's is
     * blocked on data the system does not carry. The W-2's is a deliberate
     * choice not to render the same reconciliation twice - that screen already
     * compares the W-3 against the four filed 941s in its own card. Showing it
     * again in the Check tab would give two places for one answer to disagree
     * with itself.
     *
     * WENT FROM 2 TO 3 IN books-55, for the same reason as the W-2 and with
     * the same caveat. The W-3 gained an explorer in that slice - it had a
     * TABLE and nothing else, so its thirty-one lessons were unreachable from
     * the interface. It shares the W-2's excuse because it shares the W-2's
     * reconciliation: comparing the W-3's totals against the four filed 941s
     * is ONE comparison, already rendered once on that page. It is counted as
     * a separate screen here because it is a separate explorer with its own
     * box list, and a gate that quietly folded it into the W-2's row would be
     * a gate that stops being able to see it (rule 39).
     *
     * READ THIS NUMBER HONESTLY: 3 is not three unsolved problems. Two of the
     * three are one deliberate design decision counted twice, and the third is
     * blocked on the PFML and WA Cares accumulators. It goes DOWN when those
     * accumulators land, and it must never go up without a paragraph here.
     */
    expect(excused.length).toBe(3);
  });

  it("proves at least one screen really does reconcile, or the gate is vacuous", () => {
    const wired = TAUGHT_SCREENS.filter((s) => s.checksMissingBecause === null);
    expect(wired.length).toBeGreaterThanOrEqual(1);
    for (const screen of wired) {
      expect(read(screen.page)).toContain("checks={");
    }
  });
});
