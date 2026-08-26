/**
 * src/lib/payroll/form-facsimile-core.ts   (books-61)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE FORM AS IT WOULD LOOK IF YOU WERE HOLDING IT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Michael, on being shown the books-58/60 "sheet" pages:
 *
 *   "When I had asked for the physical form to be displayed on the page by
 *    itself, I meant literally. I am hoping that for all the various forms, I
 *    can see the form as it would look if I were holding it in my hand. This
 *    form would get filled with real data automatically as it should, when we
 *    begin operations via this platform. Then, if I click a box or field on the
 *    actual form, the lesson would open in the same manner, an overlay over the
 *    form that you click to see and click to un-see. I am a visual learner and
 *    this is the best way for me to learn. ... I want to be able to export the
 *    form to be added to my digital records."
 *
 * The sheet pages showed a styled LIST of boxes. That is not what he asked for
 * twice, so this module exists to put the real document on the screen.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHOSE DRAWING IS ON THE SCREEN
 * ───────────────────────────────────────────────────────────────────────────
 * Not mine. Measured before a line of this was written:
 *
 *     md5(the blank 941 he uploaded) == md5(irs.gov/pub/irs-pdf/f941.pdf)
 *     md5(the blank 940 he uploaded) == md5(irs.gov/pub/irs-pdf/f940.pdf)
 *
 * The artwork is extracted from those files unmodified, and the position of
 * every input area comes from the same files' `/Widget` rectangles. So neither
 * "what the form looks like" nor "where line 5a sits" is my opinion. The
 * alternative - reconstructing the form in HTML - would have made every
 * hairline, caption and rule a thing I could get wrong, and would drift
 * silently the next time the IRS revises the form.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE MISTAKE THIS FILE EXISTS TO PREVENT
 * ───────────────────────────────────────────────────────────────────────────
 * Lines 5a-5d of the 941 print two columns. Column 1 is the wage base, column 2
 * is the tax on it, and the form prints the arithmetic between them:
 *
 *     5a  Taxable social security wages [ column 1 ] x 0.124 = [ column 2 ]
 *
 * Our engine's line "5a" is NOT the wage base. Its caption is "Taxable social
 * security wages x 0.124" and its amount is the PRODUCT. The base exists only
 * inside the derivation sentence.
 *
 * So the obvious implementation - put the value in the first rectangle on the
 * row - would print Greenway's social security TAX in the column reserved for
 * WAGES. It would be correctly formatted, individually plausible, and wrong, on
 * a document he intends to copy onto a government portal. Nothing downstream
 * would catch it because every figure would still be a real figure.
 *
 * Hence `MONEY_SLOT_IS_LAST` below, and hence columns we do not model are left
 * EMPTY rather than filled with the nearest number to hand. A blank column is
 * honest. A plausible wrong number is not.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THE DECISIONS LIVE HERE AND NOT IN THE COMPONENT
 * ───────────────────────────────────────────────────────────────────────────
 * Same reason as `form-sheet-core.ts`: everything worth arguing about - which
 * rectangle receives which figure, how dollars and cents are split across the
 * form's two little boxes, what a box shows when nothing has been computed -
 * is decidable without rendering anything, and therefore mutation-testable. The
 * component that draws this is deliberately almost free of judgement.
 */
import type { BoxLesson, FormBox } from "./form-box-core";
import { formatBoxValue, lessonFor } from "./form-box-core";
import { affordanceOf, isUnusedBox, type BoxAffordance } from "./form-sheet-core";
import { renderableBoxes } from "./form-box-ui-core";
import GEOMETRY from "./form-geometry.generated.json";
import BOX_MAP from "./form-box-map.generated.json";

/* ═══════════════════════════════════════════════════════════════════════════
 * §1  WHAT THE GENERATED FILES CONTAIN
 * ═══════════════════════════════════════════════════════════════════════════ */

/** One input area on the paper, in CSS space: origin top-left, units = points. */
export type FieldRect = {
  readonly name: string;
  /** "text" for something you write in, "check" for something you tick. */
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /**
   * How the AGENCY wants its own box filled: 0 left, 1 centre, 2 right.
   *
   * Read from the PDF's `/Q`, not chosen. "Money is right-aligned" would have
   * been correct on the 941 (44 of its fields are `/Q 2`) and wrong on the
   * W-2, whose money boxes include centred and left-aligned ones.
   */
  readonly align: number;
  /** The agency's own character limit, where it states one. */
  readonly maxLen: number | null;
  /**
   * True when the agency has divided this box into `maxLen` equal cells and
   * expects ONE CHARACTER PER CELL.
   *
   * Read from bit 25 of the PDF's `/Ff`, not inferred. The 941's EIN is the
   * case that matters: the artwork prints nine little boxes with a hyphen
   * between the second and third, and Michael's own filed return shows
   * "4 6 - 4 2 1 7 0 1 6", one digit per box. Rendering that as an ordinary run
   * of text puts "46" over the first two cells and crowds the remaining seven
   * digits to the left of a row of empty boxes - legible, but visibly not the
   * form, on the one page whose entire purpose is looking like the paper.
   *
   * Measured: exactly six fields on the 941 carry it (both EIN halves, the
   * refund routing and account numbers, the line-17 final date and the designee
   * PIN) and none on the W-2.
   */
  readonly comb: boolean;
};

export type PageArt = {
  /** What a person would call this page. */
  readonly human: string;
  /** Where the official artifact came from, so provenance is checkable. */
  readonly url: string;
  readonly pdf: string;
  readonly page: number;
  readonly pdfSha256: string;
  /** Public path of the extracted artwork. */
  readonly svg: string;
  readonly svgSha256: string;
  readonly width: number;
  readonly height: number;
  readonly fields: readonly FieldRect[];
};

const PAGES = GEOMETRY as unknown as Record<string, PageArt>;
const PLACED = BOX_MAP as unknown as Record<
  string,
  {
    readonly labels: readonly string[];
    /** Copy 0's placement, kept for readers that only ever want the first form. */
    readonly placed: Record<string, readonly string[]>;
    /**
     * One placement per FORM PRINTED ON THE SHEET.
     *
     * ═══ A SHEET OF TAX STOCK IS NOT NECESSARILY ONE FORM ═══
     *
     * The IRS W-2 Copy B page holds TWO W-2s, one above the other, at a pitch
     * of exactly 396.0pt. This was not noticed for three renders, because every
     * screenshot taken while building the map was cropped to the top form - so
     * half the paper was going unfilled and the picture looked finished.
     *
     * It is measured rather than asserted: `copy_partition` in the derivation
     * script asks whether the page's rectangles partition into N groups that are
     * exact translations of one another, with no reference to any field name. On
     * the W-2 that is 2 groups of 47 with zero unmatched rectangles; on both 941
     * pages it is 1. The agency's own subform names - `CopyB_Top` and
     * `CopyB_Bottom` - agree independently.
     *
     * Both 941 pages therefore carry a single-element array, and one code path
     * serves both forms.
     */
    readonly copies: readonly Record<string, readonly string[]>[];
    readonly copyPitchPt: number;
    /**
     * Rectangles left BLANK on purpose, each with a recorded reason.
     *
     * ═══ WHY THIS IS DATA AND NOT A COMMENT IN A SCRIPT ═══
     *
     * Because "unclaimed" must never come to mean "unnoticed". The 941 spent
     * this whole slice rendering with 18 unplaced rectangles on page 1 and 32
     * on page 2 - including its EIN and its business name - and nothing
     * complained, because nothing was counting. Now the derivation refuses to
     * emit a map unless every rectangle on the page is either bound to a box or
     * listed here with a reason, and the reasons travel with the data so a
     * later reader can see what was declined and why.
     *
     * Optional because the W-2 records its unclaimed rectangles as a plain list
     * (its two are both box 14b, explained in `notModelled`). Making that
     * uniform would be a good next step and is not this slice's job.
     */
    readonly unclaimed?: readonly string[];
    readonly unclaimedReasons?: Readonly<Record<string, string>>;
  }
>;

/** Every page of artwork we hold, in a stable order. */
export const ALL_PAGE_KEYS: readonly string[] = Object.keys(PAGES).sort();

/**
 * How many copies of the form are printed on this sheet of paper.
 *
 * ═══ WHY A CALLER HAS TO ASK ═══
 *
 * Because the answer is not one. The IRS W-2 Copy B page is two W-2s, and the
 * whole point of surfacing this is that a caller cannot accidentally fill the
 * top one and leave the bottom blank - it has to decide what goes on each form,
 * and if it has nothing for the second form it leaves it blank ON PURPOSE.
 *
 * That distinction is the difference between a sheet at the end of an
 * odd-numbered run, which is what Michael's own W-2 stock looks like, and a
 * page that half-failed to load.
 */
export function copiesOnSheet(key: string): number {
  const placement = PLACED[key];
  if (placement === undefined) {
    throw new Error(
      `copiesOnSheet: no box map for "${key}". Known pages: ${ALL_PAGE_KEYS.join(", ")}.`,
    );
  }
  return placement.copies.length;
}

export function pageArt(key: string): PageArt {
  const art = PAGES[key];
  if (art === undefined) {
    throw new Error(
      `pageArt: no artwork for "${key}". Known pages: ${ALL_PAGE_KEYS.join(", ")}. ` +
        `Rendering a form page we have no artwork for would produce an empty sheet ` +
        `that reads as "this form is blank" rather than "this page does not exist".`,
    );
  }
  return art;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §2  WHICH RECTANGLE GETS THE FIGURE
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * On a row with several money slots, the figure belongs in the LAST one.
 *
 * This is the whole of the 5a defect described at the top of the file, reduced
 * to one named constant so that changing it is a deliberate act with a comment
 * attached rather than an incidental edit to an expression.
 *
 * True for every two-column row on the 941: the engine computes the RESULT of
 * the row (`base x rate`), and the result is what column 2 holds. Where a row
 * has only one money slot, first and last are the same rectangle and the
 * constant does not matter.
 */
const MONEY_SLOT_IS_LAST = true;

/**
 * Which rectangles are the CENTS half of a split money entry.
 *
 * ═══ WHY THIS IS THE AGENCY'S ANSWER AND NOT A WIDTH GUESS ═══
 *
 * The 941 prints money in two rectangles - a wide one for dollars and a narrow
 * one for cents, with the decimal printed on the artwork between them. The
 * first version of this file decided which was which by width (`w <= 28pt`).
 * That is a PROXY, and measurement showed the property itself is stated in the
 * file: on page 1 of the 941 exactly 22 fields carry `/MaxLen 3`, every one is
 * a cents box, and no dollars box carries it.
 *
 * The proxy would also have travelled badly. On the W-2, `/MaxLen 3` appears
 * four times and NONE of them are cents - they are the 14b Treasury Tipped
 * Occupation Code boxes. The W-2 does not split cents at all; its money is one
 * field per box and the filed specimen prints `11029.32` whole. So "is there a
 * cents box" is a fact about a particular form's layout, and it is read from
 * that form rather than assumed from a width.
 */
const CENTS_MAX_LEN = 3;

/**
 * How money is printed ON THE PAPER.
 *
 * ═══ MEASURED FROM GREENWAY'S OWN FILED RETURNS ═══
 *
 * `formatBoxValue` renders `$68,923.45`. That is right for the teaching sheet,
 * where the figure sits in a sentence and the currency symbol helps. It is
 * wrong for the paper, and three filed specimens say so:
 *
 *   2ND_QTR_FORM_941.pdf    line 2 prints `68923 45`,  line 7 prints `-0 07`
 *   1ST_QTR_FORM_941-SAGE   same convention
 *   2025_FORM_W-2_EMPLOYEE  box 1 prints `11029.32`
 *
 * No dollar sign, no thousands separators. The IRS instruction printed on the
 * 941 itself is "Type or print within the boxes", and a `$68,923` string in a
 * 64.8pt-wide box either overflows the rule or gets clipped - and a clipped
 * money figure on a tax return is a wrong money figure.
 *
 * So the facsimile formats for paper rather than reusing the screen formatter.
 * It deliberately derives from `amountCents` - the integer - rather than
 * parsing the screen string back apart, because parsing a formatted string is
 * how a locale that groups digits differently silently changes a tax figure.
 */
export function paperMoney(cents: number): { dollars: string; cents: string } {
  if (!Number.isInteger(cents)) {
    throw new Error(
      `paperMoney: ${cents} is not an integer number of cents. Money in this codebase ` +
        `is integer cents; a fraction here means a rounding decision was skipped ` +
        `upstream, and this would print a figure nobody computed.`,
    );
  }
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const remainder = abs % 100;
  return {
    dollars: `${negative ? "-" : ""}${whole}`,
    cents: String(remainder).padStart(2, "0"),
  };
}

/** How one rectangle should be drawn. */
export type FacsimileSlot = {
  readonly rect: FieldRect;
  /**
   * The text to print, already formatted. Empty string means "leave blank",
   * which is a deliberate outcome, not a missing one.
   */
  readonly text: string;
  /** "dollars" | "cents" | "whole" | "check" - what this rectangle holds. */
  readonly role: "dollars" | "cents" | "whole" | "check";
};

/** One of OUR boxes, positioned on the paper. */
export type FacsimileBox = {
  readonly box: FormBox;
  readonly affordance: BoxAffordance;
  readonly unusedByForm: boolean;
  readonly lesson: BoxLesson | undefined;
  readonly notComputed: boolean;
  /** The value as the sheet would print it, for the lesson header. */
  readonly printed: string;
  /** Every rectangle this box occupies, in reading order. */
  readonly slots: readonly FacsimileSlot[];
  /**
   * The clickable region: the union of the box's rectangles.
   *
   * A separate hit area rather than one button per rectangle, because 5a spans
   * four rectangles and a reader who clicks the cents box means the same thing
   * as one who clicks the dollars box. Four buttons for one lesson would also
   * mean four tab stops for one idea.
   */
  readonly hit: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
};

/**
 * What this box should print on the paper, as one string.
 *
 * Used for boxes the form does NOT split into dollars and cents - every money
 * box on the W-2, and counts like 941 line 1, which is people.
 */
export function paperText(box: FormBox): string {
  if (box.notComputedYet !== null) return "";
  /*
   * A BOX THAT IS CORRECTLY EMPTY PRINTS NOTHING - NOT ZERO.
   *
   * Michael's own filed W-2 leaves boxes 16 and 17 blank, and the engine
   * already knows why: `blankOnPurpose` says "Washington has no state income
   * tax. This is correct and permanent, not a missing figure."
   *
   * Printing `0.00` there instead would state, on a document filed with the
   * IRS, that Greenway paid Washington state wages of zero and withheld zero
   * state income tax. Those are CLAIMS about a tax that does not exist. This
   * codebase already refuses that trade on the screen - `formatBoxValue` has
   * the same rule for unknown figures - and the paper is where it matters
   * most, because the paper is what gets copied onto a portal.
   *
   * Note this is checked BEFORE the money branch, exactly as `notComputedYet`
   * is: a zero-cent box with a reason must not fall through to "$0.00".
   */
  if (box.blankOnPurpose !== null) return "";
  if (box.measure === "money") {
    const m = paperMoney(box.amountCents);
    return `${m.dollars}.${m.cents}`;
  }
  if (box.measure === "count") return String(box.quantity ?? 0);
  // Hours never appear on the 941 or the W-2. If one ever does, the screen
  // formatter is the right authority for it and it is used verbatim.
  return formatBoxValue(box);
}

function unionOf(rects: readonly FieldRect[]): FacsimileBox["hit"] {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.w));
  const bottom = Math.max(...rects.map((r) => r.y + r.h));
  return { x, y, w: right - x, h: bottom - y };
}

/**
 * Lay one form's boxes onto one page of artwork.
 *
 * Boxes that belong to a DIFFERENT page of the same form are skipped silently -
 * the 941's lines 16-18 live on page 2, and asking page 1 to place them would
 * be a bug in the caller, not in the data. Boxes that belong to NO page are a
 * different matter entirely and are refused, because a box we model and cannot
 * place is a line missing from a tax form, and the page would look complete
 * without it.
 */
export function facsimileBoxes(
  pageKey: string,
  boxes: readonly FormBox[],
  lessons: readonly BoxLesson[],
  columnOne: Readonly<Record<string, number>> = {},
  copyIndex = 0,
  identity: Readonly<Record<string, readonly string[]>> = {},
): readonly FacsimileBox[] {
  const art = pageArt(pageKey);
  const placement = PLACED[pageKey];
  if (placement === undefined) {
    throw new Error(
      `facsimileBoxes: no box map for "${pageKey}". Artwork without a map would draw ` +
        `the form correctly and fill in nothing, which looks like a form that failed ` +
        `to load rather than like a bug.`,
    );
  }

  const copy = placement.copies[copyIndex];
  if (copy === undefined) {
    throw new Error(
      `facsimileBoxes: ${pageKey} prints ${placement.copies.length} form(s) on the sheet, ` +
        `so there is no copy ${copyIndex}. Silently returning nothing would render a ` +
        `blank form beside a filled one, which reads as missing data.`,
    );
  }

  const rectByName = new Map(art.fields.map((f) => [f.name, f]));
  const rendered = renderableBoxes(boxes, lessons);
  const out: FacsimileBox[] = [];

  for (const r of rendered) {
    const names = copy[r.box.box];
    if (names === undefined || names.length === 0) continue; // lives on another page

    const rects = names.map((n) => {
      const rect = rectByName.get(n);
      if (rect === undefined) {
        throw new Error(
          `facsimileBoxes: box ${r.box.box} of ${r.box.formId} is mapped to field ` +
            `"${n}", which does not exist in the ${pageKey} artwork. The geometry and ` +
            `the box map were generated from different versions of the form.`,
        );
      }
      return rect;
    });

    const printed = formatBoxValue(r.box);
    out.push({
      box: r.box,
      affordance: affordanceOf(r),
      unusedByForm: isUnusedBox(r.box),
      lesson: lessonFor(lessons, r.box.formId, r.box.box),
      notComputed: r.box.notComputedYet !== null,
      printed,
      slots: slotsFor(
        rects,
        paperText(r.box),
        r.box.notComputedYet !== null,
        r.box.measure === "money",
        r.box.amountCents,
        Object.prototype.hasOwnProperty.call(columnOne, r.box.box)
          ? columnOne[r.box.box]
          : null,
        Object.prototype.hasOwnProperty.call(identity, r.box.box)
          ? identity[r.box.box]
          : null,
      ),
      hit: unionOf(rects),
    });
  }
  return out;
}

/**
 * Decide what goes in each rectangle of one box.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY AN UNCOMPUTED FIGURE PRINTS NOTHING RATHER THAN A DASH
 * ───────────────────────────────────────────────────────────────────────────
 * `formatBoxValue` returns explanatory wording for a figure that has not been
 * computed, which is right on the sheet, where there is room for a sentence.
 * On the facsimile there is not: the rectangle is 64pt wide and the sentence
 * would either overflow the paper or be clipped mid-word. Worse, ANY text in a
 * money box on a tax form reads as an entry.
 *
 * So an uncomputed figure leaves the paper blank and says so in the overlay
 * instead. The box still highlights and is still clickable; it simply does not
 * pretend to hold a number. This is the same promise the sheet makes ("never a
 * bare 0 for an unknown figure"), kept in the medium this file draws in.
 */
/**
 * Tick boxes, always empty.
 *
 * A tick box is never filled by this product. We compute figures; we do not
 * decide, for example, whether Michael wants an overpayment refunded, or
 * whether he is a monthly or semiweekly depositor. Drawing a tick he did not
 * choose would be putting words in his mouth on a signed return.
 *
 * Still EMITTED rather than skipped, so a reader can see the form has a tick
 * box there and that we have deliberately not ticked it.
 */
function checkSlots(checks: readonly FieldRect[]): FacsimileSlot[] {
  return checks.map((rect) => ({ rect, text: "", role: "check" }));
}

function slotsFor(
  rects: readonly FieldRect[],
  printed: string,
  notComputed: boolean,
  isMoney: boolean,
  amountCents: number,
  columnOneCents: number | null,
  identityText: readonly string[] | null,
): readonly FacsimileSlot[] {
  const ordered = [...rects].sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));

  const checks = ordered.filter((r) => r.kind === "check");
  const texts = ordered.filter((r) => r.kind !== "check");

  /*
   * ═══ THE BOXES THAT SAY WHO THIS FORM IS ABOUT ═══
   *
   * THE DEFECT THIS EXISTS TO FIX. Rendering a real W-2 produced a form with
   * 60000.00 in box 1 and NOTHING in boxes a, b, c or e - no Social Security
   * number, no EIN, no employer, no employee name. Found by dumping the
   * rendered attribution as text (rule 120) rather than by looking at the
   * picture, where a blank name box on a blank-looking form reads as normal.
   *
   * The cause is structural: `FormBox.measure` is "money" | "hours" | "count",
   * so the box model has no way to carry a NAME. Every identity box therefore
   * arrived as a count of zero flagged `notComputedYet` and printed blank -
   * correctly, by `paperText`, which is right to refuse to invent a figure.
   *
   * But a W-2 with no name on it is not a W-2. It cannot be given to an
   * employee, it cannot go in a file, and the whole point of this page is that
   * it is "part of the process for bookkeeping and taxes, not just informative".
   *
   * So identity text is passed ALONGSIDE the boxes rather than squeezed into
   * them. The caller supplies the strings, one per rectangle in reading order,
   * because only the caller knows them: the employee's name comes from the W-2
   * engine and the employer's EIN comes from the company profile, and neither
   * belongs to a FormBox. Nothing here invents any of it - a box with no entry
   * in `identity` prints exactly as blank as it did before.
   *
   * Reading order matters and is already established: box e is
   * (first name, last name, suffix) and box 15 is (state, employer state id),
   * in the order the IRS's own `/Widget` rectangles appear on the page.
   */
  if (identityText !== null && texts.length > 0) {
    const idSlots: FacsimileSlot[] = texts.map((rect, i) => ({
      rect,
      // Fewer strings than rectangles is normal - a suffix is usually absent -
      // and the surplus rectangles stay blank rather than being padded.
      text: identityText[i] ?? "",
      role: "whole",
    }));
    return [...idSlots, ...checkSlots(checks)];
  }

  if (texts.length === 0) return checkSlots(checks);

  // Does THIS form split money into dollars and cents? The agency says so per
  // field, via /MaxLen. See the note on CENTS_MAX_LEN: the 941 splits, the W-2
  // does not, and neither fact is inferred from a width.
  const centsRects = texts.filter((r) => r.maxLen === CENTS_MAX_LEN);
  const wholeRects = texts.filter((r) => r.maxLen !== CENTS_MAX_LEN);

  // On a two-column row the engine's figure is the RESULT of the row, so it
  // belongs in the LAST slot - see the note at the top of this file about line
  // 5a, which is the defect this whole constant exists to prevent.
  const dollarRect = MONEY_SLOT_IS_LAST ? wholeRects.at(-1) : wholeRects.at(0);
  const centsRect = MONEY_SLOT_IS_LAST ? centsRects.at(-1) : centsRects.at(0);

  // Only split the figure when the FORM has somewhere to put the halves.
  //
  // ═══ THE DEFECT THIS GUARD EXISTS TO PREVENT ═══
  //
  // The first version split money whenever the box was money, then printed
  // `split.dollars` in the one text rectangle. On the 941 that is right, because
  // the cents have their own rectangle beside it. On the W-2 there is no second
  // rectangle - box 1 is a single field - so the cents were computed and then
  // thrown away, and $60,000.00 printed as `60000` while Michael's real filed
  // W-2 prints `11029.32`.
  //
  // It would have understated every W-2 figure by up to 99 cents, silently,
  // on the copy an employee files with their own return. Caught by checking
  // the output against his filed W-2 rather than against my expectation of it.
  const canSplit = centsRects.length > 0;
  const split = notComputed || !isMoney || !canSplit ? null : paperMoney(amountCents);

  // Column 1 of a 941 FICA row - the WAGE BASE the rate is applied to.
  //
  // The engine states this figure rather than implying it: `Form941Return`
  // carries `oasdiTaxableWagesCents` and `medicareTaxableWagesCents` as exact
  // integers, precisely because recovering the base by dividing the tax by the
  // rate does not invert the rounding and would be a cent or two out.
  //
  // Before this existed the column printed blank, which was SAFE but not
  // right: Michael's filed Q2 2026 return has 68923.45 there, and a person
  // copying our facsimile onto the portal would have had to know to go and
  // find it. Filled only where the caller supplies the figure; still blank
  // otherwise, because a blank column is honest and an invented one is not.
  const firstDollar = MONEY_SLOT_IS_LAST ? wholeRects.at(0) : wholeRects.at(-1);
  const firstCents = MONEY_SLOT_IS_LAST ? centsRects.at(0) : centsRects.at(-1);
  const twoColumn = wholeRects.length > 1 && centsRects.length > 1;
  const base =
    !notComputed && twoColumn && columnOneCents !== null ? paperMoney(columnOneCents) : null;

  const slots: FacsimileSlot[] = [];
  for (const rect of texts) {
    if (rect === dollarRect) {
      slots.push({
        rect,
        // `printed` already carries the full figure including cents - see
        // `paperText`. It is used whenever the form does not split.
        text: notComputed ? "" : split !== null ? split.dollars : printed,
        role: split !== null ? "dollars" : "whole",
      });
    } else if (rect === centsRect && split !== null) {
      slots.push({ rect, text: notComputed ? "" : split.cents, role: "cents" });
    } else if (rect === firstDollar && base !== null) {
      slots.push({ rect, text: base.dollars, role: "dollars" });
    } else if (rect === firstCents && base !== null) {
      slots.push({ rect, text: base.cents, role: "cents" });
    } else {
      // A column the engine does not model - most often column 1 of a 941 FICA
      // row, the wage base. Left EMPTY on purpose: see the note at the top of
      // this file. Still emitted, so the reader can see the form has a box
      // there and that we have deliberately not filled it.
      slots.push({ rect, text: "", role: rect.maxLen === CENTS_MAX_LEN ? "cents" : "dollars" });
    }
  }
  return [...slots, ...checkSlots(checks)];
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §3  DID EVERY BOX LAND?
 * ═══════════════════════════════════════════════════════════════════════════ */

export type PlacementReport = {
  /** Box ids we model and successfully placed on one of the given pages. */
  readonly placed: readonly string[];
  /** Box ids we model and could NOT place anywhere. Must be empty. */
  readonly unplaced: readonly string[];
  /** Field rectangles on the artwork that no box of ours claims. */
  readonly unclaimedFields: readonly string[];
};

/**
 * Check a form's boxes against the pages that are supposed to hold them.
 *
 * `unclaimedFields` is reported rather than treated as an error, because it is
 * expected and informative: the 941's entity block (name, EIN, address) and its
 * signature area are real input areas that our engine does not model as boxes.
 * Counting them as failures would force either a fake box per address line or a
 * suppression list, and both hide the honest answer, which is "the IRS asks for
 * 116 things here and we compute 27 of them".
 *
 * `unplaced` is a different matter and callers are expected to refuse on it.
 */
export function placementReport(
  pageKeys: readonly string[],
  boxes: readonly FormBox[],
): PlacementReport {
  const claimed = new Set<string>();
  const placed = new Set<string>();
  const allFields = new Set<string>();

  for (const key of pageKeys) {
    for (const f of pageArt(key).fields) allFields.add(`${key}::${f.name}`);
    const placement = PLACED[key];
    if (placement === undefined) continue;
    // EVERY copy printed on the sheet, not just the first. Reporting only copy
    // 0 would have called the W-2's entire second form "unclaimed" - which is
    // exactly how the two-up defect stayed invisible.
    for (const copy of placement.copies) {
      for (const [boxId, names] of Object.entries(copy)) {
        if (!boxes.some((b) => b.box === boxId)) continue;
        placed.add(boxId);
        for (const n of names) claimed.add(`${key}::${n}`);
      }
    }
  }

  return {
    placed: [...placed].sort(),
    unplaced: boxes.map((b) => b.box).filter((b) => !placed.has(b)).sort(),
    unclaimedFields: [...allFields].filter((f) => !claimed.has(f)).sort(),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §4  THE RUN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Michael, after seeing the first single-sheet W-2:
 *
 *   "I am hoping you are building these forms in a way that is genius and
 *    professional and expert. This is where you add value as if you are the one
 *    using this platform. How would you want and need to interact with these
 *    forms? I want what the cpa needs. We have many employees so that means
 *    many w-2s. We have multiple quarters, so that means needing forms that can
 *    produce those quarters or those data and such. ... It's meant to be a part
 *    of the process for bookkeeping and taxes, not just informative."
 *
 * So one sheet showing one employee is not the deliverable. Greenway has ten
 * employees on its 2025 filing; a page that shows the first one and stops is a
 * demo of a form, and he has asked twice now not to be given a demo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW HIS OWN FILING PAGINATES - MEASURED, NOT CHOSEN
 * ─────────────────────────────────────────────────────────────────────────────
 * `2025_FORM_W-2_EMPLOYEE.pdf`, produced by Sage:
 *
 *     page 1: TERI BECKER        | STEPHEN BENOIT
 *     page 2: ANGELA BRITTON     | LARRY DEE
 *     page 3: BAILEY GIOVANNINI  | JERMAINE JOHNSON
 *     page 4: MICHAEL LYMAN      | ISANA SOLIS
 *     page 5: RAELENE TAITAGUE   | MICHAEL ZENGER
 *
 * Ten employees, two per sheet, five sheets, filled top-then-bottom. And the
 * order is SURNAME then first name, which was checked against the alternative
 * rather than adopted because it looked right: sorting by first name does not
 * reproduce his output, sorting by (last, first) does. Greenway employs two
 * people called Michael, so the tie-break is doing real work.
 *
 * `2025_FORM_W-2_EMPLOYER.pdf` is the same ten people 4-up across 3 sheets -
 * twelve slots, of which the last two print blank. That is his own software
 * confirming rule 124 from the other direction: the tail of a run is left
 * empty, never padded with a repeat of somebody.
 *
 * It also proves the copy count belongs to the COPY and not to the form: Copy B
 * is 2-up and Copy D is 4-up, and they are the same W-2. Which is why the
 * number here comes from `copiesOnSheet(pageKey)` - read from the geometry -
 * rather than from a constant called something like `W2_PER_PAGE`.
 */

/**
 * One subject on one form of one sheet.
 *
 * `sortKey` is SEPARATE from `label` on purpose. The label is what a reader
 * sees ("MICHAEL B LYMAN"); the sort key is the fact the order depends on (the
 * surname, "LYMAN"). Deriving one from the other is exactly the mistake rule
 * 121 exists to prevent - a last-word rule files "ANN MARIE DE LA CRUZ" under C
 * and "JOHN SMITH JR" under J, and both put an employee on the wrong sheet.
 *
 * The W-2 engine carries `employeeLastName` for precisely this, so the caller
 * hands over a fact rather than a string this module has to interpret.
 */
export type RunSubject<T> = {
  /** How the subject should be named on screen. */
  readonly label: string;
  /** The value the run is ORDERED by - a surname, a quarter, a period end. */
  readonly sortKey: string;
  /** Whatever the caller needs to build the boxes - a W2Form, typically. */
  readonly value: T;
};

export type RunSheet<T> = {
  /** 1-based, as a person counts sheets of paper. */
  readonly sheet: number;
  /**
   * One entry per form printed on this sheet, top first.
   *
   * SHORTER THAN THE SHEET ON THE LAST PAGE, and that is the point: it means
   * "leave the rest blank", which is what his Copy D does with its two spare
   * slots. Never padded.
   */
  readonly subjects: readonly RunSubject<T>[];
};

export type FormRun<T> = {
  readonly pageKey: string;
  /** Forms printed per sheet of paper, from the geometry. */
  readonly perSheet: number;
  readonly totalSubjects: number;
  readonly sheets: readonly RunSheet<T>[];
};

/**
 * Split a run of subjects into sheets of paper.
 *
 * ═══ WHY THIS IS A FUNCTION AND NOT A `.slice()` IN THE PAGE ═══
 *
 * Because it has three decisions in it that are all easy to get quietly wrong,
 * and every one of them is invisible on screen:
 *
 *   1. The ORDER. Get it wrong and every sheet still looks perfect - it just
 *      does not match the run his accountant is reconciling against.
 *   2. WHERE THE BREAKS FALL. Off by one and an employee moves sheets, or worse,
 *      appears twice.
 *   3. THE TAIL. Padding it would duplicate somebody onto a form (rule 124).
 *
 * None of those can be caught by looking at a rendered page, which is the same
 * reason `form-sheet-core` exists. Here they are decidable without rendering,
 * so they are mutation-testable.
 *
 * `compare` is REQUIRED rather than defaulted. A default would silently pick an
 * order, and "the order the database happened to return" is precisely the bug
 * this function exists to prevent.
 */
export function paginateRun<T>(
  pageKey: string,
  subjects: readonly RunSubject<T>[],
  compare: (a: RunSubject<T>, b: RunSubject<T>) => number,
): FormRun<T> {
  const perSheet = copiesOnSheet(pageKey);
  if (!Number.isInteger(perSheet) || perSheet < 1) {
    throw new Error(
      `paginateRun: ${pageKey} reports ${perSheet} forms per sheet. A sheet holds at ` +
        `least one form; zero would paginate an entire payroll into no pages at all.`,
    );
  }

  const ordered = [...subjects].sort(compare);
  const sheets: RunSheet<T>[] = [];
  for (let index = 0; index < ordered.length; index += perSheet) {
    sheets.push({
      sheet: sheets.length + 1,
      // NOT padded to `perSheet`. The last sheet of an odd-numbered run is
      // short, and the component leaves the remaining forms blank - which is
      // what real IRS stock looks like and what his Copy D actually does.
      subjects: ordered.slice(index, index + perSheet),
    });
  }

  /*
   * A run of nobody is ONE BLANK SHEET, not zero sheets.
   *
   * Greenway's first payroll under this system is 1 January 2027, so for now
   * every W-2 run is empty. Returning no sheets would render nothing at all,
   * and books-49 already recorded what that costs: "I am unable to see or use
   * the tab system." A blank form is the honest picture of a year with no
   * payroll in it, and it is also the thing he can learn from.
   */
  if (sheets.length === 0) sheets.push({ sheet: 1, subjects: [] });

  return { pageKey, perSheet, totalSubjects: ordered.length, sheets };
}

/* ══════════════════════════════════════════════════════════════════════════
 * §5  THE BOXES THAT ARE NOT NUMBERS
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ═══ THE DEFECT THIS SECTION EXISTS TO FIX ═══
 *
 * The first render of a REAL W-2 - as opposed to the teaching specimen - put
 * 60000.00 in box 1, 3720.00 in box 4, and NOTHING AT ALL in boxes a, b, c, e
 * or 15. No Social Security number. No EIN. No employer. No employee name.
 *
 * It was not visible in a screenshot, because a W-2 with empty name boxes looks
 * like a blank form rather than like a broken one. It was found by dumping the
 * rendered box-to-value attribution AS TEXT and counting: the specimen produced
 * 26 boxes and the real W-2 produced 8. Rule 120, again: a picture proves
 * position, not attribution.
 *
 * The cause is structural rather than careless. `FormBox.measure` is
 * "money" | "hours" | "count", so a FormBox cannot hold a NAME, and the W-2
 * adapter quite correctly maps only the numbered money boxes. Every identity
 * box therefore arrived flagged `notComputedYet` and printed blank - which is
 * `paperText` doing its job, since it must never invent a figure.
 *
 * But a W-2 with no name on it is not a W-2. It cannot be handed to an
 * employee, it cannot go in a file, and it fails the specific job Michael named:
 * "It's meant to be a part of the process for bookkeeping and taxes, not just
 * informative."
 *
 * ═══ WHY THE FACTS ARE PASSED IN AND NOT LOOKED UP ═══
 *
 * Because they come from two different places and neither belongs to a FormBox.
 * The employee's name and masked SSN come from the W-2 engine; the EIN, legal
 * name and address come from the company profile. This module knows about
 * geometry, so it is the wrong place to reach for either.
 *
 * NOTHING HERE INVENTS ANYTHING. Every string is required, `null` is a
 * legitimate value meaning "not on file", and a null prints BLANK - never a
 * placeholder, never "N/A", and never a zero. A blank name box is obviously
 * unfinished; "N/A" in a name box looks like a decision somebody made.
 */

/** The employer half of a W-2 - the same on every form in the run. */
export type W2Employer = {
  /**
   * Nine digits, unpunctuated, or null when not on file.
   *
   * ═══ THE ASYMMETRY THAT MUST NOT BE TIDIED AWAY ═══
   *
   * This system masks employee SSNs everywhere, and it must NOT extend that
   * habit to the EIN. The IRS Instructions for Forms W-2 and W-3 say, of the
   * employer's number, "Do not truncate your EIN" and "An employer's EIN may
   * not be truncated on any form", while explicitly permitting a truncated SSN
   * on the employee copies. Both statements are recorded as authorities in
   * company-identity-authorities.ts. The asymmetry is deliberate in the source,
   * so it is deliberate here.
   */
  readonly ein: string | null;
  /** The name as on Form SS-4, not the trade name. */
  readonly legalName: string | null;
  readonly street: string | null;
  readonly city: string | null;
  readonly state: string | null;
  readonly zip: string | null;
};

/** The employee half - different on every form in the run. */
export type W2Identity = {
  /** Box e, first part. */
  readonly firstNameAndInitial: string | null;
  /** Box e, second part. */
  readonly lastName: string | null;
  /** Box e, third part. Usually absent, and absent prints blank. */
  readonly suffix: string | null;
  /** Box a. Already masked by the engine; see the note on `W2Employer.ein`. */
  readonly ssnMasked: string | null;
  /** Box d. Optional on the real form, so null is normal. */
  readonly controlNumber: string | null;
  /** Box 15, first part. */
  readonly stateCode: string | null;
  /** Box 15, second part. */
  readonly employerStateIdNumber: string | null;
};

/**
 * Format an EIN for the paper: 00-0000000.
 *
 * Refuses anything that is not exactly nine digits rather than padding it,
 * because padding would invent a taxpayer identification number. Mirrors
 * `formatEin` in company-identity-core, which cannot be imported here without
 * making a geometry module depend on the accounting layer; the shapes are
 * pinned against each other by a test.
 */
export function paperEin(nineDigits: string): string | null {
  if (!/^[0-9]{9}$/.test(nineDigits)) return null;
  return `${nineDigits.slice(0, 2)}-${nineDigits.slice(2)}`;
}

/**
 * The employer's address as the W-2 prints it: one box, three lines.
 *
 * Box c is a single rectangle holding name, street and "city, state zip", so the
 * parts are joined with newlines and the component renders them as lines. Empty
 * parts are DROPPED rather than left as blank lines, so a missing street does
 * not push the city out of the box.
 */
export function paperEmployerBlock(e: W2Employer): string {
  const cityLine = [e.city, e.state].filter((x) => x !== null && x.trim() !== "").join(", ");
  const lastLine = [cityLine, e.zip ?? ""].filter((x) => x.trim() !== "").join(" ");
  return [e.legalName ?? "", e.street ?? "", lastLine]
    .map((x) => x.trim())
    .filter((x) => x !== "")
    .join("\n");
}

/**
 * Which strings go in which W-2 box, in the IRS's own reading order.
 *
 * The arrays are positional, matching the order of the `/Widget` rectangles on
 * the page as recorded in the box map: box e is (first, last, suffix) and box 15
 * is (state, employer state id). A shorter array than there are rectangles is
 * normal - most people have no suffix - and the surplus rectangles stay blank.
 *
 * Boxes with nothing to say are OMITTED from the map entirely rather than mapped
 * to an empty string, so "we have no control number" and "this box is not an
 * identity box" stay distinguishable to the caller.
 */
export function w2IdentityText(
  employer: W2Employer,
  who: W2Identity,
): Readonly<Record<string, readonly string[]>> {
  const out: Record<string, readonly string[]> = {};

  if (who.ssnMasked !== null && who.ssnMasked !== "") out["a"] = [who.ssnMasked];

  if (employer.ein !== null) {
    const ein = paperEin(employer.ein);
    // An EIN that is not nine digits prints NOTHING rather than printing what
    // was stored. A malformed EIN on a W-2 is rejected by the SSA, and a blank
    // box is a visible problem where a wrong number is an invisible one.
    if (ein !== null) out["b"] = [ein];
  }

  const block = paperEmployerBlock(employer);
  if (block !== "") out["c"] = [block];

  if (who.controlNumber !== null && who.controlNumber !== "") out["d"] = [who.controlNumber];

  const e = [who.firstNameAndInitial ?? "", who.lastName ?? "", who.suffix ?? ""];
  if (e.some((x) => x.trim() !== "")) out["e"] = e;

  const fifteen = [who.stateCode ?? "", who.employerStateIdNumber ?? ""];
  if (fifteen.some((x) => x.trim() !== "")) out["15"] = fifteen;

  return out;
}

/**
 * The Form 941's entity area - the part of the return that says WHO is filing.
 *
 * ═══ THE SAME DEFECT, FOUND ON A SECOND FORM BY ASKING ═══
 *
 * An hour after the W-2 was found to be printing wages with no name on them,
 * the same question was put to the 941 - not "is my fix working" but "where
 * else is this true". The answer, measured by partitioning every rectangle on
 * the page into placed and unplaced:
 *
 *     941 page 1    70 rectangles    52 placed    18 UNPLACED
 *     941 page 2    35 rectangles     3 placed    32 UNPLACED
 *
 * Among the 18 were the EIN, the legal name, the trade name and the address.
 * Among the 32 were the name and EIN that repeat at the top of page 2.
 *
 * A 941 with no EIN on it is not a return. It is a page of arithmetic the IRS
 * cannot match to a taxpayer. And it looked completely fine, because a blank
 * name box on a form reads as a blank form rather than as a broken one - the
 * exact trap rule 123 was written about after the W-2 two-up finding.
 *
 * ═══ WHY THE TRADE NAME IS A SEPARATE BOX AND NOT PART OF THE NAME ═══
 *
 * Because the IRS asks for them separately and Greenway HAS both, differing:
 * his filed Q2 2026 return prints "LYMAN'S MARIJUANA" as the name and
 * "GREENWAY MARIJUANA" as the trade name. The paper's own caption is "Name (not
 * your trade name)", which is the agency going out of its way to say these are
 * not interchangeable. Collapsing them - or filling the name box with whichever
 * one the profile happened to have - would misstate the filer.
 *
 * Every string here is required from the caller and `null` prints BLANK. There
 * is no placeholder, no "N/A", and no fallback from one field to another: a
 * blank name box is visibly unfinished, whereas a trade name sitting in the
 * legal-name box looks like somebody decided that.
 */
export function nine41IdentityText(
  employer: W2Employer,
  tradeName: string | null,
): Readonly<Record<string, readonly string[]>> {
  const out: Record<string, readonly string[]> = {};

  if (employer.ein !== null) {
    /*
     * The 941 splits the EIN across TWO rectangles - a 2-cell comb and a
     * 7-cell comb - with the hyphen printed on the artwork between them. So
     * unlike the W-2, which has one box and takes "46-4217016", this form wants
     * "46" and "4217016" and must NOT be handed the hyphen: a hyphen typed into
     * a comb cell consumes a cell, and the last digit would fall off the end of
     * the box.
     *
     * `paperEin` is still used rather than slicing the raw string, so the
     * nine-digit validation happens in exactly one place. A malformed EIN
     * prints nothing at all - see the note in `w2IdentityText`.
     */
    const formatted = paperEin(employer.ein);
    if (formatted !== null) {
      const [prefix, rest] = formatted.split("-");
      out["ein"] = [prefix, rest];
    }
  }

  if (employer.legalName !== null && employer.legalName.trim() !== "") {
    out["name"] = [employer.legalName.trim()];
  }

  if (tradeName !== null && tradeName.trim() !== "") {
    out["tradeName"] = [tradeName.trim()];
  }

  if (employer.street !== null && employer.street.trim() !== "") {
    out["address"] = [employer.street.trim()];
  }

  /*
   * City, state and ZIP are three rectangles on one row, and they are filled
   * POSITIONALLY in that order - which is the order the IRS's own rectangles
   * appear on the page and the order its captions read, "City / State / ZIP
   * code". Empty parts are passed through as empty strings rather than
   * compacted, because compacting would slide the ZIP into the state box the
   * moment a city was missing.
   */
  const cityRow = [employer.city ?? "", employer.state ?? "", employer.zip ?? ""];
  if (cityRow.some((x) => x.trim() !== "")) out["cityStateZip"] = cityRow;

  return out;
}

/**
 * The order his own filing prints a run in: sort key first, then the label.
 *
 * ═══ MEASURED AGAINST HIS FILED W-2 RUN, NOT CHOSEN ═══
 *
 * Sage printed Greenway's ten 2025 W-2s in this order:
 *
 *     BECKER, BENOIT, BRITTON, DEE, GIOVANNINI,
 *     JOHNSON, LYMAN, SOLIS, TAITAGUE, ZENGER
 *
 * Checked against the alternative rather than assumed: sorting by first name
 * does NOT reproduce that (`sorted(firstNames) === firstNames` is false), and
 * sorting by (surname, full name) DOES. Greenway employs two people called
 * Michael, so the tie-break is load-bearing rather than decorative.
 *
 * The tie-break also makes the order TOTAL, which matters beyond neatness: an
 * unstable comparator would let two employees swap sheets between one render
 * and the next, so the sheet a person printed on Monday is not the sheet they
 * print on Tuesday. For a document that gets filed, that is not cosmetic.
 */
export function byPaperOrder<T>(a: RunSubject<T>, b: RunSubject<T>): number {
  const ka = a.sortKey.toUpperCase();
  const kb = b.sortKey.toUpperCase();
  if (ka !== kb) return ka < kb ? -1 : 1;
  const la = a.label.toUpperCase();
  const lb = b.label.toUpperCase();
  if (la !== lb) return la < lb ? -1 : 1;
  return 0;
}
