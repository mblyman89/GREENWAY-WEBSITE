"use client";

/**
 * src/components/admin/books/FormSheet.tsx   (books-58)
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ONE LARGE PAGE, NOTHING ON IT BUT THE FORM
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Michael, asking for this:
 *
 *   "Even with the tab system, there is walls of text and information. I like
 *    it how it is and rather than updating or changing any of it, I want to
 *    simply add a way to display the form in one large page with nothing on it
 *    but form. And every box/field that has already been mapped to its learning
 *    lesson, when clicked, should show an info box with all of the lesson
 *    displayed. I don't want to be redirected to the learning center, but have
 *    the lesson brought to me on the form page."
 *
 * Read that as three separate promises, because they are:
 *
 *   1. NOTHING BUT FORM. No preamble, no summary cards, no explanatory prose
 *      above the sheet. The page opens on boxes.
 *   2. CLICK A BOX, GET THE WHOLE LESSON. Not a summary, not a tooltip, not a
 *      "learn more" link. All of it.
 *   3. NO REDIRECT. The lesson arrives where he is standing. Nothing in this
 *      file may navigate.
 *
 * And one promise he made by implication, when he approved marking untaught
 * boxes: a box that cannot teach must SAY so rather than look identical to one
 * that can and then do nothing.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THIS COMPONENT IS SO THIN
 * ──────────────────────────────────────────────────────────────────────────
 * Every decision worth arguing about - which boxes group together, whether a
 * box is clickable, what the value column prints when nothing is computed, how
 * coverage is counted - was made in `form-sheet-core.ts`, where it can be
 * mutation-tested without rendering anything. What is left here is markup and
 * one piece of state (which box is open). That is deliberate: React components
 * are expensive to test and easy to get subtly wrong, so the less judgement
 * they carry the better.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE IS FORBIDDEN TO DO
 * ──────────────────────────────────────────────────────────────────────────
 * Change anything that already exists. `FormBoxExplorer`, the tab system and
 * every form page are untouched - he said "rather than updating or changing
 * any of it". This is a sibling surface, and it shares the lesson renderer
 * (`BoxLessonBody`) rather than copying it, for the reason written at the top
 * of that file: a second renderer starts by showing most of the members and
 * silently stops showing the next one anybody adds.
 */

import { useId, useState } from "react";
import type { BoxLesson, FormBox } from "@/lib/payroll/form-box-core";
import type { SheetCell } from "@/lib/payroll/form-sheet-core";
import { sheetCoverage, sheetGroups } from "@/lib/payroll/form-sheet-core";
import { BoxLessonBody } from "./BoxLessonBody";

export type FormSheetProps = {
  /** The form's title as a person would say it. e.g. "Form W-2 (2025)". */
  readonly title: string;
  /** Every box on the form, from the teaching specimen or a live adapter. */
  readonly boxes: readonly FormBox[];
  /** The lessons for THIS form. Cross-form entries are ignored by `lessonFor`. */
  readonly lessons: readonly BoxLesson[];
};

/**
 * A stable, collision-free key for one box.
 *
 * `formId` is included even though a sheet only ever shows one form, because
 * the alternative - keying on the box number alone - is correct only for as
 * long as that stays true, and `sheetGroups` is the only thing enforcing it.
 */
function cellKey(cell: SheetCell): string {
  return `${cell.box.formId}::${cell.box.box}`;
}

export function FormSheet({ title, boxes, lessons }: FormSheetProps) {
  /*
   * WHICH BOX IS OPEN, not whether a modal is open.
   *
   * Holding the id rather than a boolean plus a payload makes the impossible
   * state - "open, but no box selected" - unrepresentable, and means clicking a
   * second box while the first is open simply moves the panel rather than
   * needing a close-then-open dance.
   */
  const [openKey, setOpenKey] = useState<string | null>(null);
  const headingId = useId();

  const groups = sheetGroups(boxes, lessons);
  const coverage = sheetCoverage(groups);

  return (
    <section aria-labelledby={headingId} className="mx-auto w-full max-w-5xl px-4 py-6">
      {/*
        The ONLY text above the boxes. He asked for nothing on the page but the
        form, and a form does have a name printed at its head - but this is a
        title and a count, not an explanation. Anything longer belongs on the
        existing tabbed screen, which is staying exactly as it is.
      */}
      <header className="mb-5 flex flex-wrap items-baseline justify-between gap-2 border-b border-white/10 pb-3">
        <h1 id={headingId} className="text-lg font-semibold tracking-tight">
          {title}
        </h1>
        <p className="text-xs text-white/50">
          {coverage.total} boxes
          {coverage.untaught > 0 ? ` · ${coverage.untaught} not taught yet` : " · all taught"}
        </p>
      </header>

      {groups.map((group) => (
        <div key={group.key} className="mb-6">
          <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-white/40">
            {group.heading}
          </h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {group.cells.map((cell) => {
              const key = cellKey(cell);
              const isOpen = openKey === key;
              const teachable = cell.affordance === "teachable";

              return (
                <div key={key} className={isOpen ? "sm:col-span-2 lg:col-span-3" : undefined}>
                  {/*
                    ═══ WHY THIS IS A <button> AND NOT A CLICKABLE <div> ═══
                    A div with an onClick cannot be reached by keyboard, is not
                    announced as interactive, and gives no focus ring. The boxes
                    that teach are the entire point of the page, so they are
                    real buttons. An untaught box is rendered as a plain div -
                    NOT a disabled button - because a disabled control is still
                    announced as a control that happens to be off, whereas this
                    box is simply not one yet.
                  */}
                  {teachable ? (
                    <button
                      type="button"
                      onClick={() => setOpenKey(isOpen ? null : key)}
                      aria-expanded={isOpen}
                      className={[
                        "w-full rounded-md border p-3 text-left transition",
                        "hover:border-[var(--admin-accent)]/60 focus:outline-none",
                        "focus-visible:ring-2 focus-visible:ring-[var(--admin-accent)]",
                        isOpen
                          ? "border-[var(--admin-accent)]/60 bg-[var(--admin-accent-soft)]"
                          : "border-white/12 bg-white/[0.03]",
                      ].join(" ")}
                    >
                      <BoxFace cell={cell} />
                    </button>
                  ) : (
                    <div className="w-full rounded-md border border-dashed border-white/12 bg-transparent p-3 text-left">
                      <BoxFace cell={cell} />
                    </div>
                  )}

                  {/*
                    THE LESSON, IN PLACE. He said: "I don't want to be
                    redirected to the learning center, but have the lesson
                    brought to me on the form page." So it is rendered directly
                    beneath the box that was clicked, inside the same grid,
                    spanning the full width. No route change, no dialog, no
                    portal - the sheet simply grows.
                  */}
                  {isOpen && cell.lesson !== undefined ? (
                    <div className="mt-2 rounded-md border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] p-4">
                      <div className="flex items-baseline justify-between gap-3">
                        <h3 className="text-sm font-semibold">
                          Box {cell.box.box} — {cell.lesson.headline}
                        </h3>
                        <button
                          type="button"
                          onClick={() => setOpenKey(null)}
                          className="shrink-0 rounded px-2 py-1 text-xs text-white/60 hover:text-white focus-visible:ring-2 focus-visible:ring-[var(--admin-accent)]"
                        >
                          Close
                        </button>
                      </div>
                      <BoxLessonBody lesson={cell.lesson} />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}

/**
 * The face of one box: its number, its caption as the form prints it, and its
 * value. Extracted so the taught and untaught branches above cannot drift into
 * showing different things - which is the same argument `BoxLessonBody` makes
 * about lesson renderers, one level down.
 */
function BoxFace({ cell }: { readonly cell: SheetCell }) {
  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[11px] text-white/50">{cell.box.box}</span>

        {/*
          THE TWO FLAGS, WHICH SAY DIFFERENT THINGS ON PURPOSE.

          "not used" is a fact about the FORM: the IRS prints the box and wants
          nothing in it. It is finished.

          "not taught yet" is a fact about THIS PRODUCT: nobody has written the
          lesson. It is pending, and it is an admission.

          A box can carry both, and W-2 box 9 is exactly why they are separate -
          it is not used AND it is taught, so it shows "not used" and is still
          clickable. Collapsing these two into one grey badge was a real bug in
          the first draft of the core; see the long note there.
        */}
        <span className="flex items-center gap-1">
          {cell.unusedByForm ? (
            <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/50">
              not used
            </span>
          ) : null}
          {cell.affordance === "untaught" ? (
            <span className="rounded border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] px-1.5 py-0.5 text-[10px] text-[var(--admin-gold)]">
              not taught yet
            </span>
          ) : null}
        </span>
      </div>

      <p className="mt-1 text-xs leading-snug text-white/80">{cell.box.caption}</p>

      {/*
        `printed` comes from `formatBoxValue`, which returns "not computed yet"
        rather than "$0.00" for an unknown figure. That is load-bearing: a zero
        in box 5a is a CLAIM that no Social Security wages were paid, and this
        page exists to be copied onto a government portal.
      */}
      <p className="mt-2 font-mono text-sm">
        {cell.notComputed ? (
          <span className="text-white/40">{cell.printed}</span>
        ) : (
          <span>{cell.printed}</span>
        )}
      </p>

      {cell.correctlyBlank && cell.box.blankOnPurpose !== null ? (
        <p className="mt-1 text-[11px] leading-snug text-white/45">
          Blank on purpose: {cell.box.blankOnPurpose}
        </p>
      ) : null}
    </>
  );
}
