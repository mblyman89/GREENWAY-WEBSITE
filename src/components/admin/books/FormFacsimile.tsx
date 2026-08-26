"use client";

/**
 * src/components/admin/books/FormFacsimile.tsx   (books-61)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE FORM AS IT WOULD LOOK IF YOU WERE HOLDING IT IN YOUR HAND
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Michael, after being shown the books-58/60 sheet pages, which rendered the
 * boxes as a styled LIST:
 *
 *   "When I had asked for the physical form to be displayed on the page by
 *    itself, I meant literally. I am hoping that for all the various forms, I
 *    can see the form as it would look if I were holding it in my hand. This
 *    form would get filled with real data automatically as it should, when we
 *    begin operations via this platform. Then, if I click a box or field on the
 *    actual form, the lesson would open in the same manner, an overlay over the
 *    form that you click to see and click to un-see. I am a visual learner and
 *    this is the best way for me to learn. ... I want to be able to export the
 *    form to be added to my digital records. Sage allows me to do this and it is
 *    something we will do too. ... I want it visually because it will help me.
 *    Please focus on this intently. I really want this feature and it should be
 *    great so I don't mess up reporting and paying taxes."
 *
 * Five promises, and they are separable:
 *
 *   1. THE ACTUAL FORM, not a resemblance of one.
 *   2. FILLED AUTOMATICALLY with real figures.
 *   3. CLICK A BOX ON THE FORM ITSELF and the lesson overlays it.
 *   4. CLICK AGAIN TO UN-SEE. His words; a toggle, not a dismiss-only modal.
 *   5. PRINT AND EXPORT, because the sheet goes into his digital records.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHOSE DRAWING IS ON THE SCREEN
 * ───────────────────────────────────────────────────────────────────────────
 * Not mine. The `<img>` below is the IRS's own vector artwork, extracted
 * unmodified from a file whose checksum is recorded in the geometry, and the
 * position of every value is the IRS's own `/Widget` rectangle from that same
 * file. Measured before any of this was written:
 *
 *     md5(the blank 941 he uploaded) == md5(irs.gov/pub/irs-pdf/f941.pdf)
 *
 * The alternative - rebuilding the form in HTML - would have made every
 * hairline, caption and rule something I could get wrong, and would drift
 * silently the next time the IRS revised the form.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY EVERY POSITION IS A PERCENTAGE
 * ───────────────────────────────────────────────────────────────────────────
 * The geometry is in PDF points. The artwork is an SVG that a browser will
 * happily render at some other size - `pdftocairo` writes `width="611.976pt"`,
 * which Chromium lays out at 815.95px, because 1pt = 1.333px in CSS.
 *
 * If the values were positioned in px they would sit correctly at exactly one
 * zoom level and drift everywhere else, and "drift" here means a figure
 * printing outside its box on a tax return. Expressed as percentages of the
 * page, the value layer is locked to the artwork at every size, on every
 * screen, and on paper.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE IS FORBIDDEN TO DO
 * ───────────────────────────────────────────────────────────────────────────
 * Navigate. Inherited from `FormSheet` and re-stated because it is easy to
 * break: he asked for the lesson "brought to me on the form page", so there is
 * no router, no `<Link>`, no `href` in this file, and a test asserts it.
 *
 * Decide anything. Which rectangle receives which figure, how a figure is
 * printed on paper, and what a box shows when nothing has been computed are
 * all settled in `form-facsimile-core.ts`, where they are decidable without
 * rendering and therefore mutation-testable. What is left here is markup and
 * one piece of state: which box is open.
 */

import { useId, useState } from "react";
import type { BoxLesson, FormBox } from "@/lib/payroll/form-box-core";
import {
  copiesOnSheet,
  facsimileBoxes,
  pageArt,
  type FacsimileBox,
  type FacsimileSlot,
} from "@/lib/payroll/form-facsimile-core";
import { BoxLessonBody } from "./BoxLessonBody";

/**
 * One of the forms printed on the sheet.
 *
 * ═══ WHY THIS IS A LIST AND NOT A SINGLE BOX SET ═══
 *
 * Because the IRS W-2 Copy B page is TWO W-2s, one above the other, at a pitch
 * of exactly 396.0pt - measured, and corroborated by the agency's own subform
 * names `CopyB_Top` and `CopyB_Bottom`. The first three renders of this page
 * filled the top form and left the bottom one blank, and nobody noticed,
 * because every screenshot taken while building the map was cropped to the top.
 *
 * And two-up is not a duplicate. Michael's own Sage-produced W-2 puts two
 * DIFFERENT employees on one sheet - Teri Becker on the top form, Stephen
 * Benoit on the bottom. So the second form gets the second subject, and if
 * there is no second subject it stays blank, which is what real IRS stock looks
 * like at the end of an odd-numbered run.
 */
export type FacsimileCopy = {
  /**
   * Who or what this form is about, for the caption beside it. e.g. an employee
   * name on a W-2. Null on a form that is about the business rather than a
   * person, such as the 941.
   */
  readonly subject: string | null;
  /** Every box on this form - from a live adapter or the teaching specimen. */
  readonly boxes: readonly FormBox[];
  /**
   * Column 1 figures for the 941's FICA rows, keyed by box id.
   *
   * Supplied by the caller rather than derived here, because the engine states
   * these exactly (`oasdiTaxableWagesCents`) and recovering them by dividing
   * the tax by the rate would be a cent or two out on most quarters.
   */
  readonly columnOne?: Readonly<Record<string, number>>;
  /**
   * The boxes that are NOT numbers: name, SSN, EIN, employer address, box 15.
   *
   * ═══ WHY THIS IS SEPARATE FROM `boxes` ═══
   *
   * Because `FormBox.measure` is "money" | "hours" | "count", so a FormBox
   * cannot hold a name, and the W-2 adapter maps only the numbered money boxes.
   * Until this existed, a REAL W-2 rendered 60000.00 in box 1 and nothing in
   * boxes a, b, c, e or 15 - no name, no SSN, no EIN, no employer. Which is not
   * a W-2; it is a wage summary on IRS artwork.
   *
   * Built by `w2IdentityText` from facts the engine and the company profile
   * already state. Absent means blank, never a placeholder.
   */
  readonly identity?: Readonly<Record<string, readonly string[]>>;
};

export type FormFacsimileProps = {
  /** Which page of artwork to draw. e.g. "941-p1", "w2-copyb". */
  readonly pageKey: string;
  /**
   * One entry per form printed on the sheet, top first.
   *
   * SHORTER THAN THE SHEET IS ALLOWED AND MEANS "LEAVE THE REST BLANK". Longer
   * is refused: it would mean the caller has data for a form that does not
   * exist on this paper, and dropping it silently would lose an employee's W-2.
   */
  readonly copies: readonly FacsimileCopy[];
  /** The lessons for THIS form. Cross-form entries are ignored by `lessonFor`. */
  readonly lessons: readonly BoxLesson[];
};

/** Percent of the page, for positioning against the artwork. See the header. */
function pct(value: number, total: number): string {
  return `${(value / total) * 100}%`;
}

/** The IRS's own `/Q`: 0 left, 1 centre, 2 right. */
function justify(align: number): string {
  if (align === 2) return "flex-end";
  if (align === 1) return "center";
  return "flex-start";
}

/**
 * One drawn cell of paper.
 *
 * Usually one per rectangle. For a COMB field - a box the agency has divided
 * into `maxLen` printed squares expecting one character in each - it is one per
 * character, so `ch` carries that character and `cell` its index. `ch` is null
 * for every ordinary entry, and that null is what the renderer switches on.
 */
type DrawnCell = {
  readonly slot: FacsimileSlot;
  readonly ch: string | null;
  readonly cell: number;
  readonly cellWidth: number;
};

/**
 * Split one slot into the cells it actually prints as.
 *
 * ═══ WHY A COMB FIELD CANNOT JUST BE TEXT ═══
 *
 * The agency divides some boxes into `maxLen` equal cells and expects exactly
 * one character in each. The 941's EIN is the case that matters: the artwork
 * prints nine little squares with a hyphen between the second and third, and
 * Michael's own filed Q2 2026 return shows "4 6 - 4 2 1 7 0 1 6", one digit per
 * square.
 *
 * Rendered as an ordinary run of text, "4217016" would sit crowded against the
 * left edge of seven squares sized for one character each. Legible - and
 * visibly not the form, on the one page whose entire purpose is to look like
 * the paper in his hand.
 *
 * The cell width is `w / maxLen`, which is arithmetic on the agency's own
 * rectangle exactly as the PDF specification defines a comb field. No font
 * metric is involved and nothing is positioned by eye, so it scales with the
 * paper like every other entry. Read from the /Ff comb bit, so the day the IRS
 * stops combing a box this renders as ordinary text with no edit here.
 *
 * Text longer than the cell count is TRUNCATED rather than overflowed. That is
 * the lesser of two bad outcomes and it should never happen: the only combed
 * boxes we fill are the two EIN halves, and `paperEin` has already refused
 * anything that is not exactly nine digits.
 */
function drawnCells(s: FacsimileSlot): readonly DrawnCell[] {
  const maxLen = s.rect.maxLen;
  if (!s.rect.comb || maxLen === null || s.text.includes("\n")) {
    return [{ slot: s, ch: null, cell: 0, cellWidth: s.rect.w }];
  }
  return [...s.text]
    .slice(0, maxLen)
    .map((ch, i) => ({ slot: s, ch, cell: i, cellWidth: s.rect.w / maxLen }));
}

export function FormFacsimile({ pageKey, copies, lessons }: FormFacsimileProps) {
  /*
   * WHICH BOX IS OPEN, not whether an overlay is open.
   *
   * Holding the id makes "open, but nothing selected" unrepresentable, and
   * makes his "click to see and click to un-see" a one-line toggle.
   *
   * Keyed by COPY as well as box, because the same box number appears on both
   * forms of a two-up sheet and they are different employees' figures. Opening
   * box 1 on the bottom form must not highlight box 1 on the top one.
   */
  const [openBox, setOpenBox] = useState<string | null>(null);
  const headingId = useId();

  const art = pageArt(pageKey);
  const onSheet = copiesOnSheet(pageKey);

  if (copies.length > onSheet) {
    /*
     * Refused rather than truncated. `copies` longer than the sheet means the
     * caller has a form's worth of data - on a W-2, an entire employee - that
     * this paper has nowhere to print. Dropping it silently would lose that
     * employee's W-2 while the page looked complete, which is the same class of
     * failure as filling only the top form.
     */
    throw new Error(
      `FormFacsimile: ${copies.length} form(s) of data for ${pageKey}, which prints ` +
        `${onSheet} form(s) per sheet. Printing the first ${onSheet} and dropping the ` +
        `rest would silently lose a return.`,
    );
  }

  /** One placement per form on the paper. Absent entries stay blank on purpose. */
  const forms = Array.from({ length: onSheet }, (_, index) => {
    const copy = copies[index];
    return {
      index,
      subject: copy?.subject ?? null,
      /*
       * A form with no data for it is given NO BOXES rather than the teaching
       * specimen. Blank IRS stock is what the second half of a real sheet looks
       * like when the run is odd-numbered; the specimen's figures are not
       * anybody's, and printing them here would read as a second employee.
       */
      placed:
        copy === undefined
          ? []
          : facsimileBoxes(
              pageKey,
              copy.boxes,
              lessons,
              copy.columnOne ?? {},
              index,
              copy.identity ?? {},
            ),
    };
  });

  const open: { form: (typeof forms)[number]; box: FacsimileBox } | undefined = (() => {
    for (const form of forms) {
      for (const box of form.placed) {
        if (`${form.index}::${box.box.box}` === openBox) return { form, box };
      }
    }
    return undefined;
  })();

  return (
    <section aria-labelledby={headingId} className="mx-auto w-full max-w-[860px] px-4 py-6">
      <h2 id={headingId} className="sr-only">
        {art.human}
      </h2>

      {/*
        The sheet itself. `aspect-ratio` from the PDF's own page size, so the
        container is the shape of the paper before the artwork has loaded and
        nothing reflows underneath a reader mid-click.

        White, always - including in the dark admin theme. This is a piece of
        paper, and a tax form printed on a dark background is not the thing he
        asked to see.
      */}
      <div
        data-testid="facsimile-sheet"
        className="relative w-full bg-white shadow-lg print:shadow-none"
        style={{ aspectRatio: `${art.width} / ${art.height}` }}
      >
        {/*
          The IRS's artwork. `alt` describes the DOCUMENT rather than saying
          "form image", because to a screen reader this is the page.
        */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={art.svg}
          alt={art.human}
          className="pointer-events-none absolute inset-0 h-full w-full select-none"
          draggable={false}
        />

        {/* ── EVERY FORM ON THE SHEET ─────────────────────────────────────
            One iteration per form printed on this paper, which is TWO on the
            IRS W-2 Copy B page and one on each 941 page. The loop is not an
            optimisation - it is the fix for a defect where the top W-2 was
            filled and the bottom one silently was not. */}
        {forms.map((form) => (
          <div key={form.index} data-testid="facsimile-form" data-copy={form.index}>
            {/* ── The values ─────────────────────────────────────────
                One absolutely-positioned cell per rectangle the IRS defined.
                Deliberately `pointer-events-none`: the figure must never
                swallow a click meant for the box behind it. */}
            {form.placed.flatMap((p) =>
              p.slots
                .filter((s) => s.text !== "")
                // One cell per rectangle, EXCEPT on a combed box, where the
                // agency prints one square per character. See `drawnCells`.
                .flatMap(drawnCells)
                .map(({ slot: s, ch, cell, cellWidth }) => (
                  <div
                    key={`${p.box.box}::${s.rect.name}::${cell}`}
                    data-testid="facsimile-value"
                    data-copy={form.index}
                    data-box={p.box.box}
                    className={[
                      "pointer-events-none absolute flex overflow-hidden font-mono font-semibold text-[#12306b]",
                      /*
                       * A MULTI-LINE BOX IS TOP-ALIGNED AND WRAPS; EVERY OTHER
                       * BOX IS CENTRED AND DOES NOT.
                       *
                       * Box c holds the employer's name, street and city on
                       * three lines inside one tall rectangle. Centring that
                       * vertically would float the block in the middle of the
                       * box instead of starting where the form's own rule is,
                       * and `whitespace-nowrap` would collapse it to one line
                       * that runs out of the box.
                       */
                      s.text.includes("\n")
                        ? "items-start whitespace-pre-line leading-tight"
                        : "items-center whitespace-nowrap",
                    ].join(" ")}
                    style={{
                      // A comb cell is placed at its own offset inside the
                      // agency's rectangle; every other entry fills the whole
                      // rectangle, and `cellWidth` is then the full width.
                      left: pct(s.rect.x + cell * cellWidth, art.width),
                      top: pct(s.rect.y, art.height),
                      width: pct(cellWidth, art.width),
                      height: pct(s.rect.h, art.height),
                      // One character centred in its own printed cell. The
                      // agency's /Q applies to the run as a whole and has no
                      // meaning for a single character in a fixed cell.
                      justifyContent: ch !== null ? "center" : justify(s.rect.align),
                      /*
                       * Sized from the rectangle rather than in px, so the
                       * figure scales with the paper exactly as the printed
                       * captions do.
                       *
                       * A multi-line block is sized from ONE LINE of it rather
                       * than from the whole rectangle: box c is three lines tall,
                       * and 62% of its full height would render each line at
                       * roughly three times the size of every other entry on the
                       * form.
                       */
                      fontSize: `${
                        (s.rect.h / art.height) *
                        100 *
                        0.62 *
                        (s.text.includes("\n") ? 1 / s.text.split("\n").length : 1)
                      }%`,
                      // A comb cell is already exactly one character wide;
                      // padding it would push the glyph out of its own square.
                      paddingInline: ch !== null ? 0 : pct(2, art.width),
                    }}
                  >
                    {ch ?? s.text}
                  </div>
                )),
            )}

            {/* ── The clickable boxes ─────────────────────────────────
                One button per BOX, not per rectangle. Line 5a spans four
                rectangles and a reader who clicks the cents box means the same
                thing as one who clicks the dollars box; four buttons for one
                idea would also be four tab stops.

                Untaught boxes are rendered as a plain div, NOT a disabled
                button: a disabled control is still announced as a control that
                happens to be off, whereas this box simply is not one yet. Same
                reasoning as FormSheet, kept identical on purpose. */}
            {form.placed.map((p) => {
              const key = `${form.index}::${p.box.box}`;
              const isOpen = openBox === key;
              const teachable = p.affordance === "teachable";
              const style = {
                left: pct(p.hit.x, art.width),
                top: pct(p.hit.y, art.height),
                width: pct(p.hit.w, art.width),
                height: pct(p.hit.h, art.height),
              };

              if (!teachable) {
                return (
                  <div
                    key={key}
                    data-testid="facsimile-box-untaught"
                    data-copy={form.index}
                    data-box={p.box.box}
                    title={`Box ${p.box.box} \u2014 no lesson written yet`}
                    className="absolute border-b-2 border-dotted border-amber-500/50 print:hidden"
                    style={style}
                  />
                );
              }

              return (
                <button
                  key={key}
                  type="button"
                  data-testid="facsimile-box"
                  data-copy={form.index}
                  data-box={p.box.box}
                  aria-expanded={isOpen}
                  aria-label={
                    form.subject === null
                      ? `Box ${p.box.box}: ${p.box.caption}`
                      : `Box ${p.box.box}: ${p.box.caption} (${form.subject})`
                  }
                  onClick={() => setOpenBox(isOpen ? null : key)}
                  className={[
                    "absolute rounded-[2px] transition-colors",
                    "hover:bg-sky-400/25 focus-visible:outline focus-visible:outline-2",
                    "focus-visible:outline-sky-600",
                    isOpen ? "bg-sky-400/30 ring-2 ring-sky-600" : "bg-transparent",
                    // The whole point of printing is to get the paper WITHOUT
                    // the software's affordances on it.
                    "print:hidden",
                  ].join(" ")}
                  style={style}
                />
              );
            })}
          </div>
        ))}

        {/* ── The lesson, overlaying the form ─────────────────────────────
            "An overlay over the form that you click to see and click to
            un-see." So it sits ON the sheet rather than beside it, and the
            backdrop is a real button: clicking anywhere off the panel closes
            it, which is what "click to un-see" means when you have already
            moved the mouse. */}
        {open !== undefined && open.box.lesson !== undefined ? (
          <div className="absolute inset-0 z-10 print:hidden" data-testid="facsimile-overlay">
            <button
              type="button"
              aria-label="Close the lesson"
              onClick={() => setOpenBox(null)}
              className="absolute inset-0 h-full w-full cursor-zoom-out bg-slate-900/45"
            />
            <div
              className="absolute inset-x-[6%] top-[8%] max-h-[84%] overflow-y-auto rounded-lg border border-slate-300 bg-white p-4 text-slate-900 shadow-2xl"
              role="dialog"
              aria-label={`Box ${open.box.box.box}: ${open.box.box.caption}`}
            >
              <div className="flex items-baseline justify-between gap-3 border-b border-slate-200 pb-2">
                <h3 className="text-sm font-semibold">
                  Box {open.box.box.box} &mdash; {open.box.box.caption}
                </h3>
                <button
                  type="button"
                  onClick={() => setOpenBox(null)}
                  className="shrink-0 rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-100"
                >
                  Close
                </button>
              </div>

              {/*
                The figure, repeated inside the overlay.

                Not decoration: when a box is not computed yet it prints BLANK
                on the paper - a 64pt-wide rectangle cannot hold a sentence, and
                any text in a money box on a tax form reads as an entry. So the
                reason lives here, where there is room for it, and the reader is
                never left wondering whether a blank box is an oversight.

                WHICH FORM, when the sheet holds more than one. On a two-up W-2
                the same box number appears twice and they are different people;
                "box 1 reads 60000.00" is ambiguous without saying whose.
              */}
              <p className="mt-2 text-xs text-slate-600">
                {forms.length > 1 && open.form.subject !== null
                  ? `${open.form.subject}: `
                  : null}
                {open.box.notComputed
                  ? "This box is blank on the form because the figure has not been computed yet \u2014 not because it is zero."
                  : `On the form this box reads ${open.box.printed}.`}
              </p>

              <div className="[&_*]:!text-slate-800">
                <BoxLessonBody lesson={open.box.lesson} />
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
