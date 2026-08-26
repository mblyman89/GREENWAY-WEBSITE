/**
 * Schedule B (Form 941) as generic form boxes, plus the lessons for them.
 *
 * The box ids are the box map's: `m{1..3}d{1..31}`, `m1Total`..`m3Total`,
 * `quarterTotal`, and the header `ein` / `name` / `calendarYear`.
 *
 * THE TRAP the lessons exist for: the columns run DOWN then ACROSS (1-8, 9-16,
 * 17-24, 25-31), not left to right, so a reader transcribing by eye puts a
 * payday in the wrong space and buys a late-deposit penalty. See D-05.
 */
import type { BoxLesson, FormBox } from "./form-box-core";
import type { ScheduleB } from "./form-941-schedule-b-core";
import type { QuarterRef } from "./payroll-deposit-schedule-core";
import { formatCents } from "./payroll-deposit-schedule-core";
import type { W2Employer } from "./form-facsimile-core";

export const FORM_ID_941_SB = "form_941_sb";

/**
 * Deliberately NOT added to `ALL_TAUGHT_FORM_IDS`.
 *
 * That list drives the Form/Why/Check explorer, which is organised by numbered
 * line. Schedule B has no numbered lines - it has a 93-cell calendar - so it
 * would render there as 93 rows of "day 4" with nothing to say.
 */
export const SCHEDULE_B_TITLE =
  "Schedule B (Form 941) - Report of Tax Liability for Semiweekly Schedule Depositors (IRS)";

/** The three month blocks, and the calendar months each holds, for a quarter. */
export function scheduleBMonths(q: QuarterRef): readonly [number, number, number] {
  const first = (q.quarter - 1) * 3 + 1;
  return [first, first + 1, first + 2];
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** Days in a calendar month, leap years included. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const AUTHORITY_PATH = "docs/authorities/federal/irs-instructions-941-schedule-b-2025.txt";
const AUTHORITY_URL = "https://www.irs.gov/pub/irs-pdf/i941sb.pdf";
const AUTHORITY_CITE = "IRS Instructions for Schedule B (Form 941) (Rev. 6-2025)";

/* ══ THE BOXES ═══════════════════════════════════════════════════════════════ */

/**
 * A day cell that no wages fall on is CORRECTLY blank, and the reason differs.
 *
 * "No wages were paid" and "this month has no 31st" are different facts, and a
 * reader who clicks an empty cell deserves the one that applies.
 */
function emptyDayReason(quarter: QuarterRef, month: 1 | 2 | 3, day: number): string {
  const calendarMonth = scheduleBMonths(quarter)[month - 1];
  const name = MONTH_NAMES[calendarMonth - 1];
  if (day > daysInMonth(quarter.year, calendarMonth)) {
    return (
      `${name} ${quarter.year} has only ${daysInMonth(quarter.year, calendarMonth)} days, so ` +
      `this numbered space has no date. Schedule B prints 31 spaces for every month ` +
      `regardless; the surplus ones stay empty on every filed schedule.`
    );
  }
  return (
    `No wages were paid on ${name} ${day}, ${quarter.year}, so no federal tax liability ` +
    `arose that day. The IRS instruction is to enter liabilities "in the spaces that ` +
    `correspond to the dates you paid wages to your employees" - a zero here would state ` +
    `that a payday happened and produced no tax.`
  );
}

/** Every box on Schedule B, filled from a reconciled schedule. */
export function scheduleBBoxes(sb: ScheduleB, employer: W2Employer): readonly FormBox[] {
  const byCell = new Map(sb.days.map((d) => [`m${d.month}d${d.day}`, d]));
  const out: FormBox[] = [];

  out.push(headerBox("ein", "Employer identification number (EIN)", employer.ein));
  out.push(headerBox("name", "Name (not your trade name)", employer.legalName));
  out.push(headerBox("calendarYear", "Calendar year", String(sb.quarter.year)));

  for (const month of [1, 2, 3] as const) {
    const calendarMonth = scheduleBMonths(sb.quarter)[month - 1];
    for (let day = 1; day <= 31; day += 1) {
      const cell = byCell.get(`m${month}d${day}`);
      out.push({
        formId: FORM_ID_941_SB,
        box: `m${month}d${day}`,
        caption: `Month ${month} (${MONTH_NAMES[calendarMonth - 1]}), day ${day}`,
        measure: "money",
        amountCents: cell?.liabilityCents ?? 0,
        quantity: null,
        whose: "shared",
        derivation:
          cell === undefined
            ? emptyDayReason(sb.quarter, month, day)
            : `Wages paid ${cell.payDate}: federal income tax and employee FICA actually ` +
              `withheld that day, plus that payday's share of Greenway's own matching FICA. ` +
              `${formatCents(cell.liabilityCents)}.`,
        blankOnPurpose: cell === undefined ? emptyDayReason(sb.quarter, month, day) : null,
        emphasise: false,
        notComputedYet: null,
      });
    }
  }

  for (const month of [1, 2, 3] as const) {
    const calendarMonth = scheduleBMonths(sb.quarter)[month - 1];
    out.push({
      formId: FORM_ID_941_SB,
      box: `m${month}Total`,
      caption: `Total liability for Month ${month}`,
      measure: "money",
      amountCents: sb.monthTotalsCents[month - 1],
      quantity: null,
      whose: "shared",
      derivation:
        `The sum of every day cell in the ${MONTH_NAMES[calendarMonth - 1]} block: ` +
        `${formatCents(sb.monthTotalsCents[month - 1])}. This is the month's LIABILITY, not ` +
        `its deposits - Schedule B never shows deposits.`,
      blankOnPurpose: null,
      emphasise: false,
      notComputedYet: null,
    });
  }

  out.push({
    formId: FORM_ID_941_SB,
    box: "quarterTotal",
    caption: "Total liability for the quarter",
    measure: "money",
    amountCents: sb.quarterTotalCents,
    quantity: null,
    whose: "shared",
    derivation:
      `Month 1 + Month 2 + Month 3 = ${formatCents(sb.quarterTotalCents)}, which equals ` +
      `Form 941 line 12 exactly. The schedule is refused rather than printed when it does ` +
      `not - see D-05.`,
    blankOnPurpose: null,
    // The one figure the IRS reconciles this whole schedule on.
    emphasise: true,
    notComputedYet: null,
  });

  return out;
}

const HEADER_NOT_A_FIGURE =
  "This box holds text rather than a figure. It is filled from the company profile and the " +
  "period being viewed, not computed from payroll, so it is never a zero.";

function headerBox(box: string, caption: string, value: string | null): FormBox {
  return {
    formId: FORM_ID_941_SB,
    box,
    caption,
    measure: "count",
    amountCents: 0,
    quantity: null,
    whose: "not_money",
    derivation:
      value === null
        ? `${HEADER_NOT_A_FIGURE} It is blank because the company profile does not hold it.`
        : HEADER_NOT_A_FIGURE,
    blankOnPurpose: null,
    emphasise: false,
    // The text arrives via `scheduleBIdentityText`, because a FormBox cannot
    // carry a name. Flagged so `paperText` refuses to print a figure here.
    notComputedYet: HEADER_NOT_A_FIGURE,
  };
}

/**
 * The blank schedule, for a quarter with no payroll.
 *
 * Every cell blank with a reason, and no figure anywhere. books-49: a teaching
 * surface gated on data that does not exist yet is a surface he cannot see.
 */
export function scheduleBTeachingBoxes(quarter: QuarterRef): readonly FormBox[] {
  return scheduleBBoxes(
    {
      ok: true,
      quarter,
      days: [],
      monthTotalsCents: [0, 0, 0],
      quarterTotalCents: 0,
      roundingSpreadCents: 0,
      plain: "",
    },
    { ein: null, legalName: null, street: null, city: null, state: null, zip: null },
  ).map((b) =>
    b.measure === "money"
      ? {
          ...b,
          amountCents: 0,
          // A specimen states no figures at all, including the totals: a zero
          // total under blank rows reads as a filed schedule showing no tax.
          notComputedYet:
            b.blankOnPurpose ??
            `No payroll exists for ${quarter.year} Q${quarter.quarter}, so there is no ` +
              `liability to total. A zero here would state to the IRS that this business ` +
              `paid nobody in the quarter.`,
        }
      : b,
  );
}

/**
 * The header text, one string per rectangle in reading order.
 *
 * The EIN is NINE one-character rectangles on this form (the 941 uses two
 * combs), and the calendar year is FOUR - so both are split per character.
 * A malformed EIN prints nothing rather than being padded into the squares.
 */
export function scheduleBIdentityText(
  employer: W2Employer,
  quarter: QuarterRef,
): Readonly<Record<string, readonly string[]>> {
  const out: Record<string, readonly string[]> = {};

  const digits = (employer.ein ?? "").replace(/\D/g, "");
  if (digits.length === 9) out["ein"] = [...digits];

  if (employer.legalName !== null && employer.legalName.trim() !== "") {
    out["name"] = [employer.legalName.trim()];
  }

  const year = String(quarter.year);
  if (year.length === 4) out["calendarYear"] = [...year];

  return out;
}

/* ══ THE LESSONS ═════════════════════════════════════════════════════════════ */

const GRID_QUOTE = {
  cite: `${AUTHORITY_CITE}, Enter Your Tax Liability by Month`,
  quote:
    "Enter your tax liabilities in the spaces that correspond to the dates you paid wages " +
    "to your employees, not the date payroll liabilities were accrued or deposits were made.",
  sourcePath: AUTHORITY_PATH,
  sourceUrl: AUTHORITY_URL,
  soWhat:
    "Greenway pays on a Friday for a period that ended the week before. The liability goes " +
    "on the FRIDAY, not on the period end - which is the single most common way a correct " +
    "total lands on the wrong day and triggers an averaged failure-to-deposit penalty.",
} as const;

const TIE_QUOTE = {
  cite: `${AUTHORITY_CITE}, Total Liability for the Quarter`,
  quote: "Your total liability for the quarter must equal line 12 on Form 941.",
  sourcePath: AUTHORITY_PATH,
  sourceUrl: AUTHORITY_URL,
  soWhat:
    "This is the check the IRS runs first. Liability summed from the payroll lines does NOT " +
    "equal line 12 on its own, because the 941 rounds each tax once on the quarter's total " +
    "while payroll rounded it on every cheque. This product refuses to print a schedule " +
    "that does not tie rather than forcing the last few cents.",
} as const;

/**
 * One lesson per day cell, generated.
 *
 * Written as a factory rather than 93 hand-typed lessons because the teaching
 * genuinely IS the same sentence with the day substituted - and the one thing
 * that differs per cell, which column of the block the day sits in, is
 * arithmetic rather than prose.
 */
function dayLesson(month: 1 | 2 | 3, day: number): BoxLesson {
  const column = day <= 8 ? 1 : day <= 16 ? 2 : day <= 24 ? 3 : 4;
  return {
    formId: FORM_ID_941_SB,
    box: `m${month}d${day}`,
    headline: `Month ${month}, day ${day} - the tax that became due that day`,
    plainEnglish:
      `This is one numbered space in the Month ${month} block. Whatever federal employment ` +
      `tax became due because Greenway paid wages on the ${day}${ordinal(day)} of that ` +
      `month goes here: the federal income tax withheld from everyone's pay, the Social ` +
      `Security and Medicare withheld from them, and Greenway's own matching Social ` +
      `Security and Medicare. It is a LIABILITY, not a payment - the deposit you make ` +
      `afterwards never appears on this schedule. If no wages were paid on that day, the ` +
      `space stays completely empty.`,
    whereItComesFrom:
      `The pay runs whose PAY DATE is the ${day}${ordinal(day)} of month ${month} of the ` +
      `quarter. The withheld figures come straight off those runs' lines; the employer ` +
      `match is the share Form 941 lines 5a and 5c imply, apportioned across the quarter's ` +
      `paydays by wage base so the cents sum exactly to the return.`,
    howToReadIt:
      `Compare it against the same day in the other two month blocks. Greenway pays on a ` +
      `fixed fortnightly cycle, so the figures should be close; one that is far larger is ` +
      `a bonus, a final cheque or a third payday in the month, and one that is far smaller ` +
      `usually means somebody's pay run was missed. In this block, day ${day} sits in ` +
      `column ${column} of four.`,
    commonMistake:
      `Reading the grid left to right. It runs DOWN each column and then across: days 1-8 ` +
      `in the first column, 9-16 in the second, 17-24 in the third, 25-31 in the fourth. ` +
      `Transcribing a figure by eye into the space one column across puts the liability ` +
      `in the wrong half of the month, which changes its deposit due date and turns a ` +
      `paid-on-time deposit into a late one.`,
    whatToDo:
      `Check that this space holds a figure only if a pay date really fell on that day, ` +
      `and that its figure matches what left the bank for taxes on that payday plus ` +
      `Greenway's own match.`,
    examples: [],
    quotes: [GRID_QUOTE],
    tiesTo: [
      {
        formId: "form_941",
        box: "12",
        why:
          "Every day cell on this schedule adds up, through the three month totals, to " +
          "line 12. That is the identity the IRS checks.",
      },
    ],
  };
}

function ordinal(day: number): string {
  const rem100 = day % 100;
  if (rem100 >= 11 && rem100 <= 13) return "th";
  const rem10 = day % 10;
  if (rem10 === 1) return "st";
  if (rem10 === 2) return "nd";
  if (rem10 === 3) return "rd";
  return "th";
}

function monthTotalLesson(month: 1 | 2 | 3): BoxLesson {
  return {
    formId: FORM_ID_941_SB,
    box: `m${month}Total`,
    headline: `Total liability for Month ${month}`,
    plainEnglish:
      `The sum of all 31 numbered spaces in the Month ${month} block. Month 1 of a quarter ` +
      `is its first calendar month - for the second quarter that is April - so this is the ` +
      `whole of that month's federal employment tax liability in one figure. It is still a ` +
      `liability and not a deposit: this schedule never shows what was actually paid over.`,
    whereItComesFrom:
      `Added from the day cells above it. Nothing separate is computed for this box, which ` +
      `is deliberate - a total that is computed independently of the figures above it can ` +
      `disagree with them, and on this form a disagreement is what the IRS looks for.`,
    howToReadIt:
      `On Greenway's fortnightly cycle most months carry two paydays and one month in ` +
      `every quarter carries three, so one of the three month totals is normally about ` +
      `half again the size of the other two. A month total that is roughly double another ` +
      `is the three-payday month, not an error.`,
    commonMistake:
      `Treating the month total as the amount to deposit. A semiweekly depositor deposits ` +
      `per PAYDAY, within a few business days of it - not monthly. The month total exists ` +
      `on this form only to be added into the quarter total.`,
    whatToDo:
      `Add the day cells in the block yourself once and confirm you get this figure. If ` +
      `you do not, the schedule below it cannot be right either.`,
    examples: [],
    quotes: [TIE_QUOTE],
    tiesTo: [
      {
        formId: FORM_ID_941_SB,
        box: "quarterTotal",
        why: "This is one of the three figures the quarter total is the sum of.",
      },
    ],
  };
}

const QUARTER_TOTAL_LESSON: BoxLesson = {
  formId: FORM_ID_941_SB,
  box: "quarterTotal",
  headline: "Total liability for the quarter - the figure that must equal line 12",
  plainEnglish:
    "The three month totals added together. This one figure is why Schedule B exists as a " +
    "reconciliation and not just a diary: the IRS requires it to equal line 12 of the Form " +
    "941 it is filed with, exactly, to the cent. If the two disagree the return is " +
    "internally inconsistent, and the notice that follows asks about the whole quarter " +
    "rather than about one day.",
  whereItComesFrom:
    "Month 1 + Month 2 + Month 3. The daily figures underneath were built so that this sum " +
    "comes out equal to line 12 by construction: the employer's matching FICA is taken as " +
    "the residual the 941's own lines 5a and 5c imply, then apportioned across the paydays, " +
    "rather than being re-rounded on each payday's wage base.",
  howToReadIt:
    "Read it beside line 12 and nothing else. They are either identical or something is " +
    "wrong; there is no acceptable difference, not even a cent. If this product cannot make " +
    "them agree it prints nothing at all and says why.",
  commonMistake:
    "Forcing the last few cents onto the final payday to make the totals match. That is " +
    "exactly what the difference is warning about - the gap is usually a pay run that was " +
    "voided, one that was added after the return was computed, or a line with no tax split " +
    "stored on it. Plugging the figure hides a real disagreement between the payroll " +
    "records and the return.",
  whatToDo:
    "Put this figure and Form 941 line 12 side by side before filing. If they differ, find " +
    "the pay run that changed rather than adjusting either number.",
  examples: [
    {
      title: "Greenway's own second quarter of 2026",
      steps: [
        "Month 1 (April): 2,089.76 + 2,500.65 = 4,590.41",
        "Month 2 (May): 2,066.54 + 2,055.59 + 1,776.45 = 5,898.58",
        "Month 3 (June): 1,965.01 + 1,750.57 = 3,715.58",
        "4,590.41 + 5,898.58 + 3,715.58 = 14,204.57",
        "Form 941 line 12 for the same quarter: 14,204.57",
      ],
      answer: "14,204.57",
      moral:
        "Seven paydays, three month blocks, and the total lands on line 12 to the cent. " +
        "The May block is the larger one because that quarter's third payday fell in May.",
    },
  ],
  quotes: [TIE_QUOTE],
  tiesTo: [
    {
      formId: "form_941",
      box: "12",
      why:
        "The IRS requires these two figures to be equal. This is the single check that " +
        "decides whether a Schedule B is acceptable.",
    },
    {
      formId: "form_941",
      box: "16",
      why:
        "Line 16's semiweekly tick is what says this schedule is attached. A ticked " +
        "semiweekly box with no Schedule B, or a Schedule B with the monthly box ticked, " +
        "is an incomplete filing.",
    },
  ],
};

const HEADER_LESSONS: readonly BoxLesson[] = [
  {
    formId: FORM_ID_941_SB,
    box: "ein",
    headline: "The EIN, repeated on the schedule so it cannot be separated from the return",
    plainEnglish:
      "Greenway's nine-digit employer identification number, printed one digit per square. " +
      "It appears here as well as on the Form 941 because the two documents are handled " +
      "separately once they arrive: a Schedule B with no EIN cannot be matched to the " +
      "return it belongs to, and an unmatched schedule counts as not filed.",
    whereItComesFrom:
      "The company profile - the same single row the Form 941, the W-2s and the W-3 all " +
      "read. One row, one answer, so the documents filed under this EIN cannot disagree " +
      "about what it is.",
    howToReadIt:
      "Check it digit by digit against the return it is stapled to. This is the field that " +
      "decides whether the schedule reaches Greenway's account at all.",
    commonMistake:
      "Typing the trading name's number, or an SSN, into an EIN box. Greenway's EIN was " +
      "issued to LYMAN'S MARIJUANA, not to GREENWAY MARIJUANA, and the name control the " +
      "IRS matches against comes from the former.",
    whatToDo:
      "Confirm the nine digits match the Form 941 this schedule is filed with before " +
      "sending either.",
    examples: [],
    quotes: [],
    tiesTo: [
      {
        // NOT form_941 box "ein": the 941's teaching specimen is organised by
        // NUMBERED LINE and has no entity boxes to point at. The W-3 does, and
        // it is the same EIN, so the cross-reference goes somewhere real.
        formId: "form_w3",
        box: "e",
        why:
          "The same nine digits carry every document filed under this EIN - the quarterly " +
          "941s, this schedule, and the annual W-3. They must be identical on all of them.",
      },
    ],
  },
  {
    formId: FORM_ID_941_SB,
    box: "name",
    headline: "The legal name - not the trade name",
    plainEnglish:
      "The name the EIN was issued to. For Greenway that is LYMAN'S MARIJUANA; GREENWAY " +
      "MARIJUANA is the trade name and belongs in the trade-name box on the Form 941 " +
      "itself. Schedule B has no trade-name box, so only the legal name appears here.",
    whereItComesFrom:
      "The company profile's legal name field, the same one the Form 941's name box reads.",
    howToReadIt:
      "It should read exactly as it does on the top of the Form 941. A mismatch between " +
      "the two is a name-control failure, which is one of the most common reasons a return " +
      "does not post to the right account.",
    commonMistake:
      "Putting the trading name here because it is the name on the door. The IRS matches " +
      "the first four characters of the legal name against its own record of the EIN.",
    whatToDo: "Check it character for character against the Form 941's name box.",
    examples: [],
    quotes: [],
    tiesTo: [
      {
        // See the EIN lesson: the 941 specimen has no entity boxes, the W-3
        // does, and it is the same legal name on both.
        formId: "form_w3",
        box: "f",
        why:
          "The same legal name. The IRS matches the first four characters against its " +
          "record of the EIN, so a trade name here fails the same way on either document.",
      },
    ],
  },
  {
    formId: FORM_ID_941_SB,
    box: "calendarYear",
    headline: "The calendar year, and the quarter tick beside it",
    plainEnglish:
      "The four digits of the year this schedule reports, printed one per square. The " +
      "quarter itself is a tick box to the right of it, and this product deliberately does " +
      "not tick it: a tick on a schedule filed under penalties of perjury is a declaration, " +
      "and declarations are yours to make rather than software's.",
    whereItComesFrom:
      "The quarter being viewed on screen. Nothing is computed - if you are looking at the " +
      "second quarter of 2026, this reads 2026.",
    howToReadIt:
      "Read it with the quarter tick as one fact. The instructions are explicit that the " +
      "quarter checked here must match the quarter checked on the Form 941.",
    commonMistake:
      "Filing a correct schedule for the wrong quarter. The grid looks plausible for any " +
      "quarter, because every month block prints 31 spaces regardless of the calendar.",
    whatToDo:
      "Tick the quarter yourself, and make sure it is the same quarter ticked at the top " +
      "of the Form 941 this is attached to.",
    examples: [],
    quotes: [
      {
        cite: `${AUTHORITY_CITE}, Who Must File?`,
        quote: "File Schedule B if you're a semiweekly schedule depositor.",
        sourcePath: AUTHORITY_PATH,
        sourceUrl: AUTHORITY_URL,
        soWhat:
          "Greenway is a semiweekly depositor, so this schedule is required with every " +
          "941 - it is not optional extra detail. The monthly liability grid on the 941 " +
          "itself stays blank, and the semiweekly box on line 16 is the one that applies.",
      },
    ],
    tiesTo: [
      {
        formId: "form_941",
        box: "16",
        why:
          "Line 16's semiweekly tick is what makes this schedule required. The quarter " +
          "ticked here must match the quarter ticked on the return.",
      },
    ],
  },
];

/** Every lesson on Schedule B: 93 day cells, 3 month totals, the quarter, the header. */
export const SCHEDULE_B_LESSONS: readonly BoxLesson[] = [
  ...HEADER_LESSONS,
  ...([1, 2, 3] as const).flatMap((m) =>
    Array.from({ length: 31 }, (_, i) => dayLesson(m, i + 1)),
  ),
  ...([1, 2, 3] as const).map(monthTotalLesson),
  QUARTER_TOTAL_LESSON,
];
