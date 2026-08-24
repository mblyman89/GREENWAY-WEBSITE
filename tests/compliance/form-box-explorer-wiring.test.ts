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
const TAUGHT_SCREENS: readonly {
  readonly label: string;
  readonly page: string;
  readonly lessonsExport: string;
  /**
   * Why this screen has no reconciliation rows yet, or null if it has them.
   * A string here is an admission, not a permission — it is the sentence that
   * has to be deleted when the gap is closed.
   */
  readonly checksMissingBecause: string | null;
}[] = [
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
];

function read(rel: string): string {
  const path = join(ROOT, rel);
  expect(existsSync(path), `${rel} does not exist`).toBe(true);
  return readFileSync(path, "utf8");
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

  it("passes real boxes rather than an empty array", () => {
    for (const screen of TAUGHT_SCREENS) {
      expect(read(screen.page)).not.toContain("boxes={[]}");
    }
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
    expect(excused.map((s) => s.label)).toEqual(["Washington quarterly returns"]);
    /*
     * WENT FROM 2 TO 1 IN books-48.
     *
     * Form 941 came off this list because the confirmation step now supplies
     * the independent side of the comparison. The one that remains is blocked
     * on data that does not exist in the system yet - the year-to-date
     * accumulators do not carry the PFML and WA Cares amounts withheld - and
     * NOT on work nobody has done, which is the distinction that decides
     * whether an excuse is honest.
     */
    expect(excused.length).toBe(1);
  });

  it("proves at least one screen really does reconcile, or the gate is vacuous", () => {
    const wired = TAUGHT_SCREENS.filter((s) => s.checksMissingBecause === null);
    expect(wired.length).toBeGreaterThanOrEqual(1);
    for (const screen of wired) {
      expect(read(screen.page)).toContain("checks={");
    }
  });
});
