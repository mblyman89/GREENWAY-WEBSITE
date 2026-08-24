/**
 * src/lib/payroll/form-941-checks.ts   (books-48)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE CHECK TAB FOR FORM 941 — THE RETURN AGAINST WHAT WAS ACTUALLY FILED
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Slice D gave every form screen three tabs: see the form, learn the box, check
 * the work. Form 940 got real reconciliations. The 941's Check tab has said
 * "There is nothing to reconcile on this form yet." on every load since, and
 * `tests/compliance/form-box-explorer-wiring.test.ts` carried a written excuse
 * for it:
 *
 *   "The 941's reconciliations compare the return against the totals actually
 *    filed, and nothing writes filed_form_941_totals yet. Building rows from
 *    figures nobody has entered would compare the return against itself and
 *    paint a green tick that means nothing."
 *
 * That excuse was correct and is now spent. The confirmation step writes the
 * table, so the rows below have a genuinely independent side to compare
 * against, and the excuse comes out of the gate in the same commit that makes
 * it false.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT MAKES THESE ROWS DIFFERENT FROM FORM 940'S
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Form 940's four checks are INTERNAL: line 3 − line 6 = line 7, and so on.
 * They prove the return is arithmetically consistent with itself, which is
 * worth having and is checkable with nothing but the return.
 *
 * These are EXTERNAL, and that is a categorically stronger kind of check. The
 * left side is what this software computed from the pay runs. The right side is
 * what Michael read off the return the IRS already has. The two descend from
 * different places — one from `payroll_run_lines`, one from a sheet of paper —
 * and that independence is the only reason a green tick here means anything.
 *
 * ═══ THE RULE THAT MUST NEVER BE BROKEN IN THIS FILE. ═══
 *
 * The right-hand side of every row below comes from `filed_form_941_totals` and
 * NOTHING ELSE. Not from the return. Not from the accumulators. Not from a
 * "sensible default" when the quarter has not been entered. The moment a
 * fallback is added — `filed?.line3 ?? computed.line3` — both sides share one
 * ancestor, every row goes green permanently, and the tab becomes a decoration
 * that teaches Michael to trust it (standing rule 39).
 *
 * When the quarter has not been recorded, `filed` is null and every row reports
 * `cannot_check` in orange, naming what is missing. That is the honest state and
 * it is not a failure.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THE ROWS ARE BUILT HERE AND NOT IN THE PAGE
 * ───────────────────────────────────────────────────────────────────────────
 *
 * A page component cannot be unit-tested without rendering it, and rendering
 * this one needs Supabase, cookies and a session. These rows carry arithmetic
 * and wording that must be provably right, so they are built by a PURE function
 * and the page only displays what comes back. No `node:fs`, no `server-only`,
 * no database.
 */

import { lineOf, type Form941Return } from "./form-941-core";
import { checkRow, type CheckRow } from "./form-box-ui-core";

/**
 * The filed side of the comparison, for ONE quarter.
 *
 * Deliberately a narrow shape rather than the store's `RecordedQuarter`. This
 * module is pure and the store is `server-only`; importing the store's type
 * would be harmless today and would be the first step toward importing its
 * functions, which would drag `server-only` into a file the browser may need.
 */
export type FiledQuarterFigures = {
  readonly quarter: number;
  readonly filedOn: string;
  readonly sourceNote: string;
  readonly line3FederalIncomeTaxCents: number;
  readonly line5aSsWagesCents: number;
  readonly line5aSsTaxCents: number;
  readonly line5cMedicareWagesCents: number;
  readonly line5c5dMedicareTaxCents: number;
  readonly line5dAddlMedicareTaxCents: number;
};

/** One line's amount off the computed return, or null if never emitted. */
function computed(ret: Form941Return, line: string): number | null {
  const found = lineOf(ret, line);
  return found === undefined ? null : found.amountCents;
}

/**
 * The sentence used when a quarter has not been recorded.
 *
 * Written once and reused, because five rows saying five slightly different
 * things about the same single cause reads like five separate problems.
 */
function notRecordedYet(quarterLabel: string): string {
  return (
    `${quarterLabel} has not been recorded yet, so there is nothing independent to compare ` +
    `against. Enter the figures from the return you actually filed, in the panel below this ` +
    `form. This is deliberately typed in by hand rather than filled in from the figures above: ` +
    `if the software supplied both sides of the comparison it would be comparing itself to ` +
    `itself, and it would agree every single time - including the quarter it got wrong.`
  );
}

/**
 * Every reconciliation the 941 screen can perform.
 *
 * @param ret    the return this software computed from the pay runs
 * @param filed  what Michael transcribed off the filed return, or null
 *
 * Pure. Given the same two inputs it returns the same rows, which is what lets
 * the gate assert the wording as well as the arithmetic.
 */
export function form941Checks(
  ret: Form941Return,
  filed: FiledQuarterFigures | null,
): readonly CheckRow[] {
  const label = ret.quarterLabel;
  const missing = notRecordedYet(label);

  const rows: CheckRow[] = [];

  /* ── 1. Federal income tax withheld ─────────────────────────────────────
     First because it is the one figure on the form that cannot be recomputed
     from a rate. Income tax withholding depends on each person's W-4, so the
     payroll record is the only source, and a difference here is always a real
     difference in the underlying pay data rather than a rounding artefact. */
  rows.push(
    checkRow({
      title: "Line 3 — federal income tax withheld",
      question:
        "Does the income tax withheld that this system computed from the pay runs match what the " +
        "return you filed actually said?",
      leftLabel: "Computed from pay runs",
      leftCents: computed(ret, "3"),
      rightLabel: "As filed",
      rightCents: filed?.line3FederalIncomeTaxCents ?? null,
      agreesMeaning:
        "These agree exactly, which is the strongest single result on this screen. Line 3 is the " +
        "one figure on the form that cannot be derived from a rate - it depends on every " +
        "employee's W-4 - so agreement means the pay runs behind this quarter are the same pay " +
        "runs that produced the return you filed. Nothing was missed and nothing was " +
        "double-counted.",
      disagreesMeaning:
        "This is the difference worth chasing hardest. Because line 3 cannot be recomputed from a " +
        "rate, a gap here is not a rounding question - it means a pay run reached one side and " +
        "not the other. The usual causes, in order of likelihood: a run posted after the return " +
        "went out, a voided run that was included in the filing, or a pay date that belongs to " +
        "the neighbouring quarter. Whichever it is, it will also be wrong on the W-2s in January " +
        "unless it is found now.",
      missingMeaning: missing,
    }),
  );

  /* ── 2. Social security wages ──────────────────────────────────────────── */
  rows.push(
    checkRow({
      title: "Line 5a column 1 — social security wages",
      question:
        "Does the social security wage base match? This is wages after the annual cap, so both " +
        "sides should be counting the same thing.",
      // The engine's own wage base, NOT column 2 divided by 12.4%. The
      // division does not invert applyMilliPct's rounding, so a reconstructed
      // base would be a cent or two out and this row would report a phantom
      // difference every quarter.
      leftLabel: "Computed from pay runs",
      leftCents: ret.oasdiTaxableWagesCents,
      rightLabel: "As filed",
      rightCents: filed?.line5aSsWagesCents ?? null,
      agreesMeaning:
        "The wage base agrees. This is the figure that will have to appear again in box 3 of every " +
        "W-2 and in box 3 of the W-3, so agreement here is a January problem already avoided.",
      disagreesMeaning:
        "The wage bases differ. The most common cause is the annual cap: social security stops at " +
        "the wage base each year, so if one side applied the cap and the other did not - or " +
        "applied a different year's base - the gap appears here first. Check whether anybody is " +
        "near the cap this year; if nobody is, the cause is a missing or extra pay run instead.",
      missingMeaning: missing,
    }),
  );

  /* ── 3. Social security tax ─────────────────────────────────────────────
     The row most likely to catch the classic error, and the reason the meaning
     text names the halved case explicitly: half is a recognisable shape, and
     naming it turns "these do not match" into "you copied the employee half". */
  rows.push(
    checkRow({
      title: "Line 5a column 2 — social security tax, both halves",
      question:
        "The 941 carries BOTH halves of social security tax - the employees' 6.2% and Greenway's " +
        "matching 6.2%, so 12.4% in total. Does the filed figure match the computation?",
      leftLabel: "Computed at 12.4%",
      leftCents: computed(ret, "5a"),
      rightLabel: "As filed",
      rightCents: filed?.line5aSsTaxCents ?? null,
      agreesMeaning:
        "Both halves are present and correct. Worth internalising the shape of this number: it " +
        "should always be almost exactly double what came out of the paycheques, because Greenway " +
        "matches every dollar the employees pay.",
      disagreesMeaning:
        "Look at the size of the gap before anything else. If the filed figure is roughly HALF the " +
        "computed one, only the employee share was reported and the employer match was left off - " +
        "that is the single most common error on this line. If it is roughly DOUBLE, something " +
        "was counted twice. If it is a small odd amount, it is a transposed digit. A few cents is " +
        "different again: that is rounding, and line 7 exists to absorb it.",
      missingMeaning: missing,
    }),
  );

  /* ── 4. Medicare wages ─────────────────────────────────────────────────── */
  rows.push(
    checkRow({
      title: "Line 5c column 1 — Medicare wages",
      question:
        "Medicare has no wage ceiling at all, so this base should be every dollar of taxable " +
        "wages. Do the two sides agree?",
      // Again the engine's own base, for the same reason as line 5a above.
      leftLabel: "Computed from pay runs",
      leftCents: ret.medicareTaxableWagesCents,
      rightLabel: "As filed",
      rightCents: filed?.line5cMedicareWagesCents ?? null,
      agreesMeaning:
        "The Medicare base agrees. Because Medicare is uncapped, this figure is the cleanest " +
        "measure of total taxable wages for the quarter - and it is the one that has to reappear " +
        "in box 5 of the W-3.",
      disagreesMeaning:
        "Medicare wages differ. Since there is no cap to get wrong, this almost always means a " +
        "whole pay run is on one side and not the other. Compare it against the social security " +
        "row above: if BOTH differ by the same amount, one run is missing. If only this one " +
        "differs, something was treated as capped that should not have been.",
      missingMeaning: missing,
    }),
  );

  /* ── 5. Medicare tax ───────────────────────────────────────────────────── */
  rows.push(
    checkRow({
      title: "Lines 5c and 5d column 2 — Medicare tax",
      question:
        "Both halves of Medicare at 2.9%, plus any Additional Medicare Tax on pay above $200,000. " +
        "Does the filed total match?",
      leftLabel: "Computed at 2.9%",
      leftCents: computed(ret, "5c"),
      rightLabel: "As filed (5c + 5d)",
      rightCents: filed?.line5c5dMedicareTaxCents ?? null,
      agreesMeaning:
        "Medicare tax agrees. One thing to know for later: Additional Medicare Tax - the extra " +
        "0.9% on pay over $200,000 - has NO employer match, so it is the one FICA figure that " +
        "does not double. Nobody at Greenway is near that threshold today, which is why the two " +
        "sides can be compared directly.",
      disagreesMeaning:
        "The same three shapes apply as on social security: roughly half means the employer match " +
        "was omitted, roughly double means double-counting, a small odd amount means a " +
        "transposition. One extra possibility is specific to this line - if anybody was paid over " +
        "$200,000 this year, Additional Medicare Tax belongs in the filed figure and needs to be " +
        "entered in the 5d box as well, on its own, so the annual W-2 comparison does not double " +
        "it.",
      missingMeaning: missing,
    }),
  );

  /* ── 6. Total tax ──────────────────────────────────────────────────────
     Last, deliberately. It is the figure the deposits were measured against
     and the one a penalty is computed on, so it is the most consequential - but
     it is also the SUM of the rows above, which means it is the least
     diagnostic. Reading it first tells you something is wrong; reading it last
     tells you what. */
  rows.push(
    checkRow({
      title: "Line 12 — total tax for the quarter",
      question:
        "The bottom line: total tax after adjustments. This is the figure your deposits were " +
        "measured against, so a difference here has money attached to it.",
      leftLabel: "Computed total",
      leftCents: computed(ret, "12"),
      rightLabel: "As filed (lines 3 + 5a + 5c/5d)",
      rightCents: filed === null ? null : filedTotalTax(filed),
      agreesMeaning:
        "The total tax agrees, and since the components above agree too, this quarter is settled. " +
        "Line 12 is what the deposit schedule is judged against - the failure-to-deposit penalty " +
        "runs from this figure, not from the wages - so agreement here means the deposits made " +
        "during the quarter were measured against the right target.",
      disagreesMeaning:
        "The totals differ, which means at least one line above differs. Read this row LAST and " +
        "the rows above first: this one tells you there is a problem, and the rows above tell you " +
        "which figure caused it. Note that this row is computed from lines 3, 5a and 5c as filed, " +
        "so if it disagrees while all three of those agree, the cause is the fractions-of-cents " +
        "adjustment on line 7.",
      missingMeaning: missing,
    }),
  );

  return rows;
}

/**
 * Total tax implied by the FILED figures — line 3 + line 5a + lines 5c/5d.
 *
 * ═══ WHY THIS IS DERIVED AND NOT STORED, WHICH LOOKS LIKE THE WRONG CALL. ═══
 *
 * The obvious alternative is an eighth column holding line 12 as filed. It was
 * rejected. Line 12 on a real return also carries the line 7 fractions-of-cents
 * adjustment, which is a few cents either way, so a stored line 12 would
 * disagree with the sum of the components by design - and the screen would then
 * be reporting a difference that is not an error, every quarter, forever. That
 * is the false alarm that teaches somebody to ignore a red line.
 *
 * Deriving it means this row answers a precise question: "do the three
 * components you filed add up to the total this system computed?" The
 * disagreement text says so explicitly, and points at line 7 as the cause when
 * the components all agree.
 *
 * It is a plain sum of three stored figures. No rate, no rounding, nothing this
 * module could get wrong in a way the engine would not.
 */
export function filedTotalTax(filed: FiledQuarterFigures): number {
  return (
    filed.line3FederalIncomeTaxCents +
    filed.line5aSsTaxCents +
    filed.line5c5dMedicareTaxCents
  );
}
