/**
 * src/lib/payroll/esd-5208-worksheet-core.ts   (books-64)
 *
 * The 5208A/5208B as a WORKSHEET keyed to the line numbers on Greenway's own
 * filed returns — deliberately NOT a facsimile of the paper form.
 */

/* ═══════════════════════════════════════════════════════════════════════════
 * §1  WHY THIS IS A WORKSHEET AND NOT A FACSIMILE
 *
 * Michael's standing request is to "see the form as it would look if I were
 * holding it in my hand", and seven federal pages are drawn exactly that way.
 * The 5208A is the one form in this system that must NOT be, and the reason is
 * an authority rather than a preference.
 *
 * WAC 192-310-010(3)(c)(ii), mirrored at docs/authorities/, verbatim:
 *
 *     "Paper forms supplied by the department (or an approved version of those
 *      forms). Agency forms include "drop-out ink" that cannot be copied.
 *      Therefore, photocopies are considered incorrectly formatted reports and
 *      forms."
 *
 * And ESD's own filing page: "Our system cannot process other forms or copies
 * of our forms. To avoid an incomplete report penalty, get paper forms from us."
 *
 * Both of Michael's real 5208s are stamped "THIS REPORT IS EFILE ONLY" and
 * "Do Not File". So a pixel-perfect 5208A would be a document that is PENALISED
 * if filed — the exact opposite of the federal forms, which the IRS publishes
 * to be printed and mailed. Drawing one would be building a trap.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * AND THE ONLY BLANK 5208A WE HAVE IS FROM 2011
 * ───────────────────────────────────────────────────────────────────────────
 *
 * `pdfinfo public/forms/esd/esd5208a.pdf` reports title
 * `5208A-final-draft-4-2011`, CreationDate 2011-06-22. Its artwork prints the
 * excess-wage threshold as "$37,300" and numbers its money lines 12/13/14/15/
 * 16/22. Michael's filed 2026 returns print $78,200 and number the same figures
 * 13/14/16/17/18/24.
 *
 * Had our figures been laid onto that artwork, EVERY amount would have printed
 * one to two lines away from its own caption, and the wage base on screen would
 * have contradicted his filing by $40,900. Standing rule 115: a filed return
 * outranks both my reasoning and a stale PDF.
 *
 * So the line numbers below come from the FILED RETURNS, not from the blank
 * form, and that provenance is recorded on every row rather than in a comment
 * nobody reads.
 * ═══════════════════════════════════════════════════════════════════════════ */

import type { QuarterRef } from "@/lib/payroll/payroll-deposit-schedule-core";
import type { WaQuarterReturn } from "@/lib/payroll/wa-quarterly-core";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`esd-5208-worksheet-core: ${message}`);
}

/** Where a worksheet line's number and caption were read from. */
export type EsdLineProvenance =
  /** Read off Greenway's own filed 2026 returns. The only trusted source. */
  | "filed_return_2026"
  /**
   * Computed by this system and shown on a line the filed return leaves for
   * ESD to fill, or which exists only as a subtotal.
   */
  | "computed_not_on_filed_form";

export type EsdWorksheetLine = {
  /** The line number as printed on the FILED return, e.g. "13". */
  readonly lineNumber: string;
  /** The caption as printed on the filed return. */
  readonly caption: string;
  /** Formatted money, e.g. "61,531.21". Never a float. */
  readonly amount: string;
  /** Integer cents, for a caller that needs to total or compare. */
  readonly amountCents: number;
  /** Plain English: what this line is and where the figure came from. */
  readonly explanation: string;
  readonly provenance: EsdLineProvenance;
  /** True for the line ESD actually bills from. */
  readonly isTotal: boolean;
};

export type EsdWorksheet = {
  readonly quarter: QuarterRef;
  /** "5208A" or "5208B". */
  readonly formNumber: string;
  readonly officialName: string;
  /** The notice that must appear on every rendering. Not optional. */
  readonly notAFilingCopyNotice: string;
  readonly lines: readonly EsdWorksheetLine[];
  /** One row per employee. Empty for the 5208A. */
  readonly wageDetail: readonly EsdWorksheetWageRow[];
};

export type EsdWorksheetWageRow = {
  readonly ssnMasked: string;
  readonly name: string;
  readonly hours: string;
  readonly wages: string;
};

/* ═══════════════════════════════════════════════════════════════════════════
 * §2  THE NOTICE
 *
 * A CONSTANT, exported, and asserted into every worksheet this module builds.
 *
 * The tempting version leaves the notice to the page that renders it. That is
 * how a notice goes missing: a second screen appears, copies the table and not
 * the paragraph, and now there is a screen that looks like a 5208A with no
 * statement that it is not one. Making it part of the DATA means a renderer
 * cannot show the figures without also having the sentence in hand.
 * ═══════════════════════════════════════════════════════════════════════════ */

export const NOT_A_FILING_COPY =
  "This is a worksheet, not a filing copy. Employment Security cannot accept it: " +
  "WAC 192-310-010(3)(c)(ii) says agency forms use drop-out ink that cannot be " +
  'copied, so "photocopies are considered incorrectly formatted reports and forms" ' +
  "— and an incorrectly formatted report earns an incomplete-report penalty. Your " +
  'own filed 5208s are stamped "THIS REPORT IS EFILE ONLY". File through EAMS, ' +
  "using the CSV this system exports. Use this page to check the figures before " +
  "you do, and to check them against what ESD bills you afterwards.";

export const WAC_192_310_010_QUOTE =
  'Paper forms supplied by the department (or an approved version of those forms). ' +
  'Agency forms include "drop-out ink" that cannot be copied. Therefore, photocopies ' +
  "are considered incorrectly formatted reports and forms.";

/* ═══════════════════════════════════════════════════════════════════════════
 * §3  THE LINE NUMBERS, FROM THE FILED RETURNS
 *
 * These six are the ones Michael's filed Q1 and Q2 2026 5208As print. They are
 * hard-coded because they are a FACT about a document, not a computation — and
 * they are separated from the arithmetic so that the day ESD renumbers the form
 * again, one table changes and nothing else does.
 *
 * The 2011 numbering is recorded ALONGSIDE, not discarded. If somebody later
 * finds a 5208A numbered 12/13/14, this is the table that tells them which
 * vintage they are holding instead of leaving them to wonder whether we made a
 * mistake.
 * ═══════════════════════════════════════════════════════════════════════════ */

export const FILED_2026_LINE_NUMBERS = {
  headcount12thDay: "12",
  grossWages: "13",
  excessWages: "14",
  taxableWages: "16",
  uiTax: "17",
  eafTax: "18",
  /**
   * TOTAL TAX DUE — "Add lines #17 and #18".
   *
   * ═══ THIS WAS RECORDED AS LINE 24 AND THAT WAS WRONG ═══
   *
   * The books-64 slice plan said the total sits on line 24. It does not. That
   * came from reading a summary of the filed return instead of the return, and
   * it was caught by opening `1ST QUARTER FORM 5208A - SAGE.pdf` and
   * `example_form_5208_with_real_qtr_2_data.pdf` and reading the captions:
   *
   *     19) TOTAL TAX DUE          Add lines #17 and #18
   *     20) LATE PAYMENT PENALTY
   *     21) INTEREST
   *     22) LATE-REPORT PENALTY
   *     23) PRIOR BALANCE TO ADD (or credits to subtract)
   *     24) AMOUNT DUE             Add lines #19, #20, #21, #22, and #23
   *
   * The engine computes UI + EAF, which is line 19. It does NOT compute
   * penalties, interest, or a prior balance, so it cannot compute line 24 —
   * and putting its figure on line 24 would have been a claim that Greenway
   * owes nothing in penalties, which is a statement only ESD's billing
   * statement can make. Standing rule 115: the filed return outranks the plan.
   */
  totalTaxDue: "19",
  /** AMOUNT DUE, which this system deliberately does NOT compute. See above. */
  amountDue: "24",
} as const;

/** The same lines on the obsolete 2011 blank, for identifying a stale form. */
export const OBSOLETE_2011_LINE_NUMBERS = {
  headcount12thDay: "11",
  grossWages: "12",
  excessWages: "13",
  taxableWages: "14",
  uiTax: "15",
  eafTax: "16",
  totalTaxDue: "17",
  amountDue: "22",
} as const;

/**
 * A gate, not a helper.
 *
 * Proves the two numbering schemes have not been allowed to converge in the
 * source. If a careless edit made the filed table equal the 2011 table, every
 * figure would still render — on the wrong line, silently, which is precisely
 * the failure this whole module exists to avoid.
 */
export function assertFiledNumberingIsNotThe2011Numbering(): void {
  const keys = Object.keys(FILED_2026_LINE_NUMBERS) as (keyof typeof FILED_2026_LINE_NUMBERS)[];
  assert(keys.length === 8, `expected eight line numbers, got ${keys.length}`);
  let differences = 0;
  for (const k of keys) {
    if (FILED_2026_LINE_NUMBERS[k] !== OBSOLETE_2011_LINE_NUMBERS[k]) differences += 1;
  }
  assert(
    differences === keys.length,
    `every one of the eight lines was renumbered between the 2011 form and the 2026 filing, ` +
      `but only ${differences} of ${keys.length} differ in this source. If the tables have ` +
      `been made equal, figures will print against the wrong captions.`,
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §4  MONEY
 * ═══════════════════════════════════════════════════════════════════════════ */

function money(cents: number): string {
  assert(Number.isInteger(cents), `money must be integer cents, got ${cents}`);
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

function hours(hundredths: number): string {
  assert(Number.isInteger(hundredths), `hours must be integer hundredths, got ${hundredths}`);
  return (hundredths / 100).toFixed(2);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §5  THE 5208A WORKSHEET
 *
 * EXCESS WAGES IS THE LINE THAT BITES, AND IT IS COMPUTED HERE RATHER THAN
 * READ, BECAUSE THE ENGINE DOES NOT PRODUCE IT.
 *
 * `WaQuarterReturn` carries gross wages and the ESD taxable figure. The filed
 * form shows THREE wage lines, and the middle one is the difference:
 *
 *     line 13 gross  −  line 14 excess  =  line 16 taxable
 *
 * "Excess" is the part of each person's year-to-date pay above the annual wage
 * base ($78,200 for 2026), and it is the single most misread line on the form:
 * it is cumulative across the YEAR, not the quarter, so a person who crossed
 * the base in Q3 has excess wages in Q3 and Q4 and none in Q1 and Q2. It is
 * derived here by SUBTRACTION rather than recomputed, so it cannot disagree
 * with the taxable figure the tax lines are actually charged on.
 * ═══════════════════════════════════════════════════════════════════════════ */

export function build5208aWorksheet(ret: WaQuarterReturn): EsdWorksheet {
  assertFiledNumberingIsNotThe2011Numbering();

  const ui = ret.lines.find((l) => l.id === "esd-ui");
  const eaf = ret.lines.find((l) => l.id === "esd-eaf");
  const total = ret.lines.find((l) => l.id === "esd-total");

  // A missing line is a broken engine, not a blank worksheet. Throwing here is
  // right because the caller has already had the engine's own refusals handed
  // to it; reaching this function with an ok result and no UI line is a bug.
  assert(ui !== undefined, "the quarter has no esd-ui line");
  assert(eaf !== undefined, "the quarter has no esd-eaf line");
  assert(total !== undefined, "the quarter has no esd-total line");

  /*
   * TAXABLE WAGES ARE RECOVERED FROM THE TAX LINE'S OWN BASIS.
   *
   * `WaQuarterReturn` exposes gross but not the ESD taxable total as a field of
   * its own; the taxable figure is what the UI and EAF lines were charged on.
   * Summing the subjects' `esdTaxableWagesCents` here would be a SECOND
   * computation of the same quantity, and two computations of one number is how
   * they come to differ. So it is taken from the line that used it.
   */
  const taxableCents = ret.subjectsEsdTaxableCents;
  const excessCents = ret.grossWagesCents - taxableCents;

  assert(
    excessCents >= 0,
    `excess wages came out negative (${excessCents}c): taxable ${taxableCents}c exceeds gross ` +
      `${ret.grossWagesCents}c, which cannot happen — the wage base can only ever reduce the ` +
      `taxable figure below gross.`,
  );

  const L = FILED_2026_LINE_NUMBERS;

  return {
    quarter: ret.quarter,
    formNumber: "5208A",
    officialName: "Quarterly Tax Report (Form 5208A)",
    notAFilingCopyNotice: NOT_A_FILING_COPY,
    wageDetail: [],
    lines: [
      {
        lineNumber: L.grossWages,
        caption: "TOTAL GROSS WAGES PAID THIS QUARTER",
        amount: money(ret.grossWagesCents),
        amountCents: ret.grossWagesCents,
        provenance: "filed_return_2026",
        isTotal: false,
        explanation:
          "Everything you paid in cash wages this quarter, before any deduction and before " +
          "the wage base is applied. This is the figure the 5208B wage-detail rows must add " +
          "up to exactly — Employment Security reconciles the two halves, and a mismatch " +
          "makes the filing incomplete rather than merely wrong.",
      },
      {
        lineNumber: L.excessWages,
        caption: "EXCESS WAGES",
        amount: money(excessCents),
        amountCents: excessCents,
        provenance: "filed_return_2026",
        isTotal: false,
        explanation:
          "The part of each person's pay this quarter that sits ABOVE the annual taxable " +
          "wage base ($78,200 for 2026) counting from 1 January. This is the line people get " +
          "wrong, and always the same way: it is cumulative across the YEAR, not the quarter. " +
          "Somebody who crosses the base in the middle of Q3 has excess wages in Q3 and Q4 " +
          "and none at all in Q1 and Q2. It is worked out here by subtracting taxable wages " +
          "from gross, so it can never disagree with the figure your tax is actually charged " +
          "on. Zero here is normal and correct until somebody's year-to-date pay passes the base.",
      },
      {
        lineNumber: L.taxableWages,
        caption: "TAXABLE WAGES",
        amount: money(taxableCents),
        amountCents: taxableCents,
        provenance: "filed_return_2026",
        isTotal: false,
        explanation:
          "Gross wages minus excess wages. Both taxes below are percentages of THIS number, " +
          "not of gross. In a quarter where nobody has passed the wage base, taxable and " +
          "gross are the same figure — as they were on your Q1 2026 return, where both were " +
          "$61,531.21 — and that identity is the easiest way to check the line is right.",
      },
      {
        lineNumber: L.uiTax,
        caption: "UI TAX DUE",
        amount: money(ui!.amountCents),
        amountCents: ui!.amountCents,
        provenance: "filed_return_2026",
        isTotal: false,
        explanation:
          ui!.shownAs +
          " This is Greenway's own money. RCW 50.24.010 makes deducting any part of " +
          "unemployment tax from a worker's pay unlawful, which is why it never appears on " +
          "a pay stub as a withholding.",
      },
      {
        lineNumber: L.eafTax,
        caption: "EAF TAX DUE",
        amount: money(eaf!.amountCents),
        amountCents: eaf!.amountCents,
        provenance: "filed_return_2026",
        isTotal: false,
        explanation:
          eaf!.shownAs +
          " The Employment Administration Fund is small enough to be ignored and separate " +
          "enough that it cannot be: it is its own line, rounded on its own figure, and it " +
          "is not part of your experience-rated UI tax.",
      },
      {
        lineNumber: L.totalTaxDue,
        caption: "TOTAL TAX DUE",
        amount: money(total!.amountCents),
        amountCents: total!.amountCents,
        provenance: "filed_return_2026",
        isTotal: true,
        explanation:
          total!.shownAs +
          ` This is line ${L.totalTaxDue}, "Add lines #${L.uiTax} and #${L.eafTax}" — the tax ` +
          `for the quarter. It is NOT line ${L.amountDue}, "AMOUNT DUE", which adds late-payment ` +
          `penalty, interest, late-report penalty and any prior balance or credit. This system ` +
          `does not compute those four, so it does not fill line ${L.amountDue}: printing this ` +
          `figure there would assert you owe no penalties, and only ESD's monthly billing ` +
          `statement can say that. Check this against what ESD bills. On your Q1 2026 filing the ` +
          `two differ by one cent — ESD charged $246.12 where rounding each fund separately gives ` +
          `$246.13. The likely reason, worked out in books-65: ESD appears to drop the CENTS from ` +
          `taxable wages before applying the rate, which reproduces all four figures across both ` +
          `filed quarters where no rounding rule could. It is not implemented, because a pattern ` +
          `that fits four numbers is not a published rule and a filed tax figure is not computed ` +
          `from a guess. See D-10 for the one document that would settle it.`,
      },
    ],
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §6  THE 5208B WORKSHEET
 *
 * The 5208B is not a list of boxes. It is one row per employee, and the ONLY
 * thing that matters about it is that the rows total to the 5208A's line 13.
 *
 * THE SSN IS MASKED HERE AND NOT ON THE CSV, WHICH IS NOT AN INCONSISTENCY.
 * The CSV is a file ESD's importer reads and requires nine digits. This
 * worksheet is a SCREEN, and a screen showing eleven full social security
 * numbers is a screen that gets photographed, screen-shared, and cached. Same
 * reasoning that made form-w2-store refuse to write an SSN reveal row.
 * ═══════════════════════════════════════════════════════════════════════════ */

export function build5208bWorksheet(ret: WaQuarterReturn): EsdWorksheet {
  const rows: EsdWorksheetWageRow[] = ret.wageDetail.map((r) => ({
    // The engine's wage detail carries no SSN at all, which is the safest
    // possible answer. The column is shown as unavailable rather than omitted,
    // because ESD's form HAS the column and a reader must not conclude the
    // filing lacks it.
    ssnMasked: "•••-••-••••",
    name: r.displayName,
    hours: hours(r.hours),
    wages: money(r.wagesCents),
  }));

  const rowTotalCents = ret.wageDetail.reduce((a, r) => a + r.wagesCents, 0);

  /*
   * THE RECONCILIATION IS AN ASSERTION, NOT A NOTE.
   *
   * ESD reconciles 5208B rows against 5208A line 13 and treats a mismatch as an
   * INCOMPLETE report — a penalty, not a correction letter. So the check runs
   * every time the worksheet is built, and it throws rather than rendering a
   * pair of tables that quietly disagree.
   */
  assert(
    rowTotalCents === ret.grossWagesCents,
    `the ${rows.length} wage-detail rows total ${money(rowTotalCents)} but gross wages on the ` +
      `5208A are ${money(ret.grossWagesCents)}. Employment Security reconciles these two halves ` +
      `and treats a mismatch as an incomplete report, which is a penalty rather than a query.`,
  );

  return {
    quarter: ret.quarter,
    formNumber: "5208B",
    officialName: "Quarterly Wage Detail Report (Form 5208B)",
    notAFilingCopyNotice: NOT_A_FILING_COPY,
    lines: [
      {
        lineNumber: "—",
        caption: "TOTAL WAGES, ALL EMPLOYEES",
        amount: money(rowTotalCents),
        amountCents: rowTotalCents,
        provenance: "computed_not_on_filed_form",
        isTotal: true,
        explanation:
          `The ${rows.length} rows below add to this, and this must equal line ` +
          `${FILED_2026_LINE_NUMBERS.grossWages} on the 5208A to the cent. That equality is ` +
          `checked every time this page is built, because Employment Security reconciles the ` +
          `two reports and a mismatch makes the filing incomplete rather than merely wrong.`,
      },
    ],
    wageDetail: rows,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §7  SELF-TESTS
 * ═══════════════════════════════════════════════════════════════════════════ */

export function __runEsd5208WorksheetTests(): void {
  assertFiledNumberingIsNotThe2011Numbering();

  // Michael's real filed Q1 2026, used as the fixture because a filed return
  // outranks anything invented (rule 115). Gross 61,531.21; nobody had passed
  // the wage base, so taxable equals gross and excess is zero.
  const q1: WaQuarterReturn = {
    quarter: { year: 2026, quarter: 1 },
    grossWagesCents: 6_153_121,
    subjectsEsdTaxableCents: 6_153_121,
    totalHours: 0,
    headcount: 11,
    wageDetail: [
      { subjectId: "a", displayName: "A", wagesCents: 6_153_121, hours: 0 },
    ],
    lines: [
      {
        id: "esd-ui",
        form: "esd_5208a",
        boxLabel: "UI tax due",
        amountCents: 22_766,
        measure: "money",
        quantity: null,
        whoseMoney: "employer_cost",
        shownAs: "ui basis.",
      },
      {
        id: "esd-eaf",
        form: "esd_5208a",
        boxLabel: "EAF tax due",
        amountCents: 1_846,
        measure: "money",
        quantity: null,
        whoseMoney: "employer_cost",
        shownAs: "eaf basis.",
      },
      {
        id: "esd-total",
        form: "esd_5208a",
        boxLabel: "Total due",
        amountCents: 24_612,
        measure: "money",
        quantity: null,
        whoseMoney: "employer_cost",
        shownAs: "total basis.",
      },
    ],
    esdTotalCents: 24_612,
    pfmlWaCaresTotalCents: 0,
    lniTotalCents: 0,
    employeeFundedCents: 0,
    employerFundedCents: 24_612,
  };

  const a = build5208aWorksheet(q1);
  assert(a.lines.length === 6, `expected six 5208A lines, got ${a.lines.length}`);

  // The figures must land on the FILED line numbers, not the 2011 ones. This is
  // the assertion the whole module exists for.
  const byNumber = new Map(a.lines.map((l) => [l.lineNumber, l]));
  assert(byNumber.get("13")?.amount === "61,531.21", `line 13 = ${byNumber.get("13")?.amount}`);
  assert(byNumber.get("14")?.amount === "0.00", `line 14 = ${byNumber.get("14")?.amount}`);
  assert(byNumber.get("16")?.amount === "61,531.21", `line 16 = ${byNumber.get("16")?.amount}`);
  assert(byNumber.get("17")?.amount === "227.66", `line 17 = ${byNumber.get("17")?.amount}`);
  assert(byNumber.get("18")?.amount === "18.46", `line 18 = ${byNumber.get("18")?.amount}`);
  assert(byNumber.get("19")?.amount === "246.12", `line 19 = ${byNumber.get("19")?.amount}`);
  /*
   * LINE 24 MUST BE ABSENT. It is "AMOUNT DUE", which adds penalties, interest
   * and any prior balance to line 19. The engine computes none of those, so a
   * figure on line 24 would assert Greenway owes no penalties. Asserting its
   * ABSENCE is the point: this is the assertion that would have failed while
   * the slice plan said the total belonged on 24.
   */
  assert(!byNumber.has("24"), "line 24 (AMOUNT DUE, after penalties) must not be filled");

  // And the 2011 numbers must be ABSENT, or a stale reading would still render.
  for (const stale of ["15", "22"]) {
    assert(!byNumber.has(stale), `line ${stale} is 2011 numbering and must not appear`);
  }

  // 13 − 14 = 16, the identity the form itself asserts.
  assert(
    byNumber.get("13")!.amountCents - byNumber.get("14")!.amountCents ===
      byNumber.get("16")!.amountCents,
    "gross minus excess must equal taxable",
  );

  // 17 + 18 = 19, which is what the form's own caption says that line is.
  assert(
    byNumber.get("17")!.amountCents + byNumber.get("18")!.amountCents ===
      byNumber.get("19")!.amountCents,
    "UI + EAF must equal line 19, TOTAL TAX DUE",
  );

  // The notice is part of the data, so it cannot be dropped by a renderer.
  assert(a.notAFilingCopyNotice.length > 200, "the notice must be present and substantive");
  assert(
    a.notAFilingCopyNotice.includes("drop-out ink"),
    "the notice must carry the WAC's own reason, not merely say 'do not file'",
  );

  // ── EXCESS WAGES WITH SOMEBODY OVER THE BASE ────────────────────────────
  const q3: WaQuarterReturn = {
    ...q1,
    quarter: { year: 2026, quarter: 3 },
    grossWagesCents: 9_000_000,
    subjectsEsdTaxableCents: 7_820_000,
    wageDetail: [{ subjectId: "a", displayName: "A", wagesCents: 9_000_000, hours: 0 }],
  };
  const a3 = build5208aWorksheet(q3);
  const n3 = new Map(a3.lines.map((l) => [l.lineNumber, l]));
  assert(n3.get("14")?.amountCents === 1_180_000, `excess = ${n3.get("14")?.amountCents}`);
  assert(
    n3.get("13")!.amountCents - n3.get("14")!.amountCents === n3.get("16")!.amountCents,
    "the identity must hold when excess is non-zero too",
  );

  // ── THE REFUSALS MUST BE REACHABLE (rule 15: provably failable) ─────────
  let threw = false;
  try {
    build5208aWorksheet({ ...q1, subjectsEsdTaxableCents: q1.grossWagesCents + 1 });
  } catch {
    threw = true;
  }
  assert(threw, "taxable above gross must throw, since the wage base can only reduce");

  threw = false;
  try {
    build5208bWorksheet({
      ...q1,
      wageDetail: [{ subjectId: "a", displayName: "A", wagesCents: 1, hours: 0 }],
    });
  } catch {
    threw = true;
  }
  assert(threw, "wage rows that do not total to gross must throw, not render");

  // ACCEPT CONTROL (rule 55): the check must discriminate, or its refusals are
  // noise. The matching fixture must build cleanly.
  const b = build5208bWorksheet(q1);
  assert(b.wageDetail.length === 1, `expected one wage row, got ${b.wageDetail.length}`);
  assert(b.wageDetail[0]!.wages === "61,531.21", `row wages = ${b.wageDetail[0]!.wages}`);
  assert(
    !b.wageDetail[0]!.ssnMasked.match(/\d/),
    "the worksheet must not put a single SSN digit on screen",
  );
  assert(b.notAFilingCopyNotice === NOT_A_FILING_COPY, "the 5208B carries the notice too");
}
