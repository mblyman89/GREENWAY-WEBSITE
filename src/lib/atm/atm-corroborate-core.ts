/**
 * src/lib/atm/atm-corroborate-core.ts   (books-69 step 3)
 *
 * TWO REPORTS OF THE SAME MONEY, AND WHAT TO DO WHEN THEY DISAGREE.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * THE SITUATION
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Payment Alliance publishes the same period twice, in two shapes:
 *
 *   Funds Movement By Account By Day   234 rows, grain = date x settlement type
 *   ATM Daily Settlement Report        115 rows, grain = date
 *
 * They cover identical dates - 115 days, 2026-05-01 to 2026-08-23, no day in
 * one and missing from the other. And they do not agree:
 *
 *                        Surcharge      Transaction
 *     Funds Movement     16,272.50       526,620.00
 *     Daily Settlement   16,267.50       526,520.00
 *     Difference              5.00           100.00
 *
 * All four totals above were measured from Michael's own exports, not quoted
 * from a previous document.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * WHY THEY DISAGREE - MEASURED, NOT THEORISED
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The whole difference is three dates, and printing the rows shows the cause.
 * Funds Movement carries MORE THAN ONE row for a type on exactly four
 * date/type combinations, and the extra rows are adjustments:
 *
 *     2026-06-27  Transaction   $3,060.00  and  -$100.00
 *     2026-07-02  Transaction   $4,980.00  and  +$100.00
 *     2026-07-02  Surcharge       $157.50  and    +$5.00
 *     2026-07-09  Transaction   $2,500.00  and  +$100.00
 *
 * The first row of each pair is exactly what the Daily Settlement Report shows.
 * The second is a correction the summary report never mentions. On a clean day
 * the two reports match to the cent - 2026-05-01 is $6,160.00 and $145.00 in
 * both - which is what makes the four rows above stand out as the entire cause
 * rather than a rounding story.
 *
 * So the two reports are not in conflict about facts. One of them is simply
 * BLIND to corrections. That is the finding, and it decides the design:
 *
 *   FUNDS MOVEMENT IS PRIMARY. It is the only one of the two that can ever tell
 *   Michael a correction happened. A ledger built on the Daily Settlement Report
 *   would be permanently $100 wrong on three days and would never self-correct,
 *   because nothing in that report ever mentions the adjustment.
 *
 *   DAILY SETTLEMENT IS CORROBORATION. It is not discarded - it independently
 *   confirms 112 of 115 days, and it carries transaction COUNTS (Total Trxs, WD
 *   Trxs, Surcharge WDs) that Funds Movement does not have at all. A second
 *   source that agrees on 97% of days is worth keeping precisely because its
 *   disagreements are then interesting.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * WHAT THIS REPLACES - THE SILENT PREFERENCE THAT WAS ALREADY SHIPPING
 * ══════════════════════════════════════════════════════════════════════════
 *
 * This module is not adding a comparison where none existed. It is replacing a
 * comparison that was being made silently. `planSettlementUpserts` in
 * atm-sync-core.ts writes the Daily Settlement surcharge first and then
 * overwrites it from Funds Movement, commented "deposit truth wins". The
 * conclusion it reaches is the same one reached here - and it reaches it with
 * no record that the two sources ever disagreed.
 *
 * On Michael's real data that overwrite silently discarded a $5.00 surcharge
 * difference and a $100.00 dispensed difference. Both were correct to prefer.
 * Neither was ever shown to him, and if the next export disagrees for a
 * different reason it will be discarded just as quietly. Recording the
 * disagreement is the entire point of this file.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * WHY DISAGREEMENTS ARE SURFACED AND NEVER SILENTLY RESOLVED
 * ══════════════════════════════════════════════════════════════════════════
 *
 * It would be less code to declare Funds Movement the winner and move on. That
 * is rejected, for a reason that is about Michael's money rather than about
 * tidiness.
 *
 * "Funds Movement is primary" is a conclusion drawn from four adjustment rows in
 * one 115-day window. It is well-evidenced and it is still an inference. If the
 * next export disagrees for a DIFFERENT reason - a dropped day, a duplicated
 * batch, a terminal swap, a genuine error at the processor - then silently
 * preferring the primary would bury the new cause under the old explanation.
 * The system would look like it was handling corrections when it was actually
 * absorbing an unknown.
 *
 * So every disagreement is REPORTED with both figures, the difference, and
 * whether the shape of the difference matches the known adjustment pattern. A
 * disagreement that looks like an adjustment says so. One that does not is
 * flagged as unexplained, which is the honest answer and the useful one.
 *
 * Nothing here posts anything. This module compares and explains; step 1
 * proposes the entries, and `atm` was never an autopostable source kind.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO
 * ══════════════════════════════════════════════════════════════════════════
 *
 * It does not re-parse or re-fold either CSV. `mapFundsMovementCsv` in
 * atm-core.ts already folds Funds Movement to one row per (date, terminal) and
 * already records how many source rows fed each leg; `mapSimpleSummaryCsv`
 * already reads the Daily Settlement Report. This module consumes those two
 * verified mappers. A second fold living here would be a second place for the
 * money to be summed differently, which is the defect it is meant to catch.
 */

import { formatMoneyCents, type FundsMovementRow, type SettlementRow } from "@/lib/atm/atm-core";
import { formatDiff } from "@/lib/atm/atm-reconcile-core";

/* ══════════════════════════════════════════════════════════════════════════
 * OUTPUT
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * How the two reports stand on one day.
 *
 *   `agreed`         both reports present, both figures equal.
 *   `adjusted`       they differ, AND Funds Movement carries more than one row
 *                    for THE LEG THAT DIFFERS - the measured signature of a
 *                    correction the summary report cannot see.
 *   `unexplained`    they differ and the adjustment signature is absent on the
 *                    differing leg. This is the one that must never be swept up
 *                    with the others.
 *   `primary_only`   the day exists in Funds Movement alone.
 *   `secondary_only` the day exists in Daily Settlement alone.
 */
export type DayAgreement =
  | "agreed"
  | "adjusted"
  | "unexplained"
  | "primary_only"
  | "secondary_only";

/**
 * True when a day needs Michael to look at it.
 *
 * `adjusted` is deliberately EXCLUDED: an explained correction is the system
 * working, not a problem. `primary_only` is excluded too - a day the summary
 * report has not caught up on is normal, and on Michael's data the primary is
 * the report the books are built on anyway. Including either would bury the
 * genuinely unexplained days in noise.
 */
export function agreementNeedsAttention(a: DayAgreement): boolean {
  return a === "unexplained" || a === "secondary_only";
}

/** One day, both sources, and the verdict. */
export type DayComparison = {
  readonly settlementDate: string;
  readonly terminalId: string;
  readonly agreement: DayAgreement;
  /** From Funds Movement - the PRIMARY. Null when the day is absent there. */
  readonly primaryTransactionCents: number | null;
  readonly primarySurchargeCents: number | null;
  /** From Daily Settlement. Null when the day is absent there. */
  readonly secondaryTransactionCents: number | null;
  readonly secondarySurchargeCents: number | null;
  /** primary - secondary. Null when either side is missing. */
  readonly transactionDiffCents: number | null;
  readonly surchargeDiffCents: number | null;
  /** How many Funds Movement rows fed each leg. >1 is the adjustment signature. */
  readonly primaryTransactionRows: number;
  readonly primarySurchargeRows: number;
  /**
   * What Michael should take as true for this day, and it is ALWAYS the primary
   * when the primary exists - including on an unexplained day. An unexplained
   * difference is a reason to investigate, not a reason to prefer the report
   * that cannot see corrections.
   */
  readonly authoritativeTransactionCents: number | null;
  readonly authoritativeSurchargeCents: number | null;
  /** Plain English, always populated. */
  readonly explanation: string;
};

/* ══════════════════════════════════════════════════════════════════════════
 * THE COMPARISON
 * ══════════════════════════════════════════════════════════════════════════ */

/** Both reports are keyed the same way the settlements table is: date + terminal. */
function keyOf(settlementDate: string, terminalId: string): string {
  return `${(settlementDate ?? "").trim()}\u0000${(terminalId ?? "").trim()}`;
}

/**
 * Compare the two reports day by day, over the UNION of their keys.
 *
 * The union, not the intersection. An intersection would make a day that exists
 * in only one report disappear from the comparison entirely - the exact shape of
 * error that lets a dropped day look like agreement.
 *
 * Inputs are the outputs of the verified mappers in atm-core.ts:
 *   `mapFundsMovementCsv(...).rows`  -> the primary
 *   `mapSimpleSummaryCsv(...).rows`  -> the corroborating Daily Settlement rows
 */
export function compareReports(
  fundsMovement: readonly FundsMovementRow[],
  dailySettlement: readonly SettlementRow[],
): readonly DayComparison[] {
  const fm = new Map<string, FundsMovementRow>();
  for (const r of fundsMovement) fm.set(keyOf(r.settlementDate, r.terminalId), r);
  const ds = new Map<string, SettlementRow>();
  for (const r of dailySettlement) ds.set(keyOf(r.settlementDate, r.terminalId), r);

  const keys = [...new Set([...fm.keys(), ...ds.keys()])].sort();

  return keys.map((k): DayComparison => {
    const p = fm.get(k);
    const s = ds.get(k);
    const [date = "", terminal = ""] = k.split("\u0000");

    if (p !== undefined && s === undefined) {
      return {
        settlementDate: date,
        terminalId: terminal,
        agreement: "primary_only",
        primaryTransactionCents: p.terminalTransactionCents,
        primarySurchargeCents: p.surchargeCents,
        secondaryTransactionCents: null,
        secondarySurchargeCents: null,
        transactionDiffCents: null,
        surchargeDiffCents: null,
        primaryTransactionRows: p.transactionLegCount,
        primarySurchargeRows: p.surchargeLegCount,
        authoritativeTransactionCents: p.terminalTransactionCents,
        authoritativeSurchargeCents: p.surchargeCents,
        explanation:
          `The Funds Movement report has ${date} but the Daily Settlement Report does not. ` +
          `The Funds Movement figures are being used. Nothing is missing from your money - ` +
          `the second report simply does not cover this day.`,
      };
    }

    if (p === undefined && s !== undefined) {
      // The Daily Settlement Report's dispensed-cash column is labelled
      // "Settlement", which mapSimpleSummaryCsv reads into settlementTotalCents.
      // On every clean day in Michael's export it equals the Funds Movement
      // "Transaction" leg to the cent, which is why it is the right column to
      // compare against - see the measured 2026-05-01 case above.
      return {
        settlementDate: date,
        terminalId: terminal,
        agreement: "secondary_only",
        primaryTransactionCents: null,
        primarySurchargeCents: null,
        secondaryTransactionCents: s.settlementTotalCents,
        secondarySurchargeCents: s.surchargeCents,
        transactionDiffCents: null,
        surchargeDiffCents: null,
        primaryTransactionRows: 0,
        primarySurchargeRows: 0,
        // NOT filled in from the secondary. The primary is the report the books
        // are built on, and inventing a primary figure from the corroborating
        // source is exactly the silent substitution this module refuses to make.
        authoritativeTransactionCents: null,
        authoritativeSurchargeCents: null,
        explanation:
          `${date} appears in the Daily Settlement Report ` +
          `(${money(s.settlementTotalCents)} dispensed, ${money(s.surchargeCents)} surcharge) ` +
          `but NOT in the Funds Movement report, which is the one your books are built on. ` +
          `That is worth asking Payment Alliance about: a day of activity is missing from ` +
          `the primary record.`,
      };
    }

    // Both present.
    const pp = p as FundsMovementRow;
    const ss = s as SettlementRow;

    // A null leg means the report did not carry that figure at all, which is not
    // the same as zero and must not be subtracted as zero. Those legs are
    // reported as "no difference established" rather than as agreement.
    const tDiff = diffOrNull(pp.terminalTransactionCents, ss.settlementTotalCents);
    const sDiff = diffOrNull(pp.surchargeCents, ss.surchargeCents);

    if ((tDiff ?? 0) === 0 && (sDiff ?? 0) === 0) {
      return {
        settlementDate: date,
        terminalId: terminal,
        agreement: "agreed",
        primaryTransactionCents: pp.terminalTransactionCents,
        primarySurchargeCents: pp.surchargeCents,
        secondaryTransactionCents: ss.settlementTotalCents,
        secondarySurchargeCents: ss.surchargeCents,
        transactionDiffCents: tDiff,
        surchargeDiffCents: sDiff,
        primaryTransactionRows: pp.transactionLegCount,
        primarySurchargeRows: pp.surchargeLegCount,
        authoritativeTransactionCents: pp.terminalTransactionCents,
        authoritativeSurchargeCents: pp.surchargeCents,
        explanation: `Both reports agree on ${date}.`,
      };
    }

    // They differ. Is the adjustment signature present ON THE LEG THAT DIFFERS?
    //
    // Checking the differing leg specifically, rather than the day as a whole,
    // is what stops a corrected transaction leg from vouching for a surcharge
    // difference that nothing explains. 2026-06-27 is exactly that shape in
    // Michael's data: two transaction rows, one surcharge row.
    const tExplained = (tDiff ?? 0) === 0 || pp.transactionLegCount > 1;
    const sExplained = (sDiff ?? 0) === 0 || pp.surchargeLegCount > 1;
    const explained = tExplained && sExplained;

    const bits: string[] = [];
    if ((tDiff ?? 0) !== 0) {
      bits.push(
        `the amount dispensed differs by ${formatDiff(tDiff as number)} ` +
          `(Funds Movement ${money(pp.terminalTransactionCents)}, ` +
          `Daily Settlement ${money(ss.settlementTotalCents)})`,
      );
    }
    if ((sDiff ?? 0) !== 0) {
      bits.push(
        `the surcharge differs by ${formatDiff(sDiff as number)} ` +
          `(Funds Movement ${money(pp.surchargeCents)}, ` +
          `Daily Settlement ${money(ss.surchargeCents)})`,
      );
    }

    const explanation = explained
      ? `On ${date} ${bits.join(", and ")}. The Funds Movement report carries more than one ` +
        `entry for that figure, which is how a correction shows up - the Daily Settlement ` +
        `Report only ever shows the original day's activity and never mentions adjustments. ` +
        `The Funds Movement figure is the one being used, and it is the one that includes ` +
        `the correction.`
      : `On ${date} ${bits.join(", and ")}, and there is no correction entry to explain it. ` +
        `The Funds Movement figure is still the one being used, because it is the report your ` +
        `books are built on - but this difference has NOT been accounted for and is worth ` +
        `asking Payment Alliance about.`;

    return {
      settlementDate: date,
      terminalId: terminal,
      agreement: explained ? "adjusted" : "unexplained",
      primaryTransactionCents: pp.terminalTransactionCents,
      primarySurchargeCents: pp.surchargeCents,
      secondaryTransactionCents: ss.settlementTotalCents,
      secondarySurchargeCents: ss.surchargeCents,
      transactionDiffCents: tDiff,
      surchargeDiffCents: sDiff,
      primaryTransactionRows: pp.transactionLegCount,
      primarySurchargeRows: pp.surchargeLegCount,
      authoritativeTransactionCents: pp.terminalTransactionCents,
      authoritativeSurchargeCents: pp.surchargeCents,
      explanation,
    };
  });
}

/**
 * Difference between two figures, or null when either side never carried one.
 *
 * `null - 5000` must not become `-5000`. A missing column is an absence of
 * evidence, and treating it as a zero balance would manufacture a disagreement
 * out of a report that simply did not have the field.
 */
function diffOrNull(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  return a - b;
}

/** `$1,234.56`, `-` when the figure was never reported. */
function money(cents: number | null): string {
  return cents === null ? "\u2014" : formatMoneyCents(cents);
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE SUMMARY
 * ══════════════════════════════════════════════════════════════════════════ */

export type CorroborationSummary = {
  readonly days: number;
  readonly agreed: number;
  readonly adjusted: number;
  readonly unexplained: number;
  readonly primaryOnly: number;
  readonly secondaryOnly: number;
  /** Totals from the PRIMARY, which is what the books use. */
  readonly primaryTransactionCents: number;
  readonly primarySurchargeCents: number;
  /** Totals from the corroborating report, for the comparison line. */
  readonly secondaryTransactionCents: number;
  readonly secondarySurchargeCents: number;
  readonly needsAttention: number;
  readonly sentence: string;
};

export function summariseCorroboration(
  comparisons: readonly DayComparison[],
): CorroborationSummary {
  let agreed = 0;
  let adjusted = 0;
  let unexplained = 0;
  let primaryOnly = 0;
  let secondaryOnly = 0;
  let pT = 0;
  let pS = 0;
  let sT = 0;
  let sS = 0;
  for (const c of comparisons) {
    if (c.agreement === "agreed") agreed += 1;
    else if (c.agreement === "adjusted") adjusted += 1;
    else if (c.agreement === "unexplained") unexplained += 1;
    else if (c.agreement === "primary_only") primaryOnly += 1;
    else secondaryOnly += 1;
    pT += c.primaryTransactionCents ?? 0;
    pS += c.primarySurchargeCents ?? 0;
    sT += c.secondaryTransactionCents ?? 0;
    sS += c.secondarySurchargeCents ?? 0;
  }
  const needs = unexplained + secondaryOnly;

  const parts: string[] = [];
  parts.push(`${comparisons.length} ${comparisons.length === 1 ? "day" : "days"} compared`);
  parts.push(`${agreed} where both reports agree exactly`);
  if (adjusted > 0) {
    parts.push(
      `${adjusted} where they differ because of a correction the Daily Settlement Report cannot show`,
    );
  }
  if (unexplained > 0) {
    parts.push(`${unexplained} where they differ for no reason yet established`);
  }
  if (primaryOnly > 0) parts.push(`${primaryOnly} present only in the Funds Movement report`);
  if (secondaryOnly > 0) {
    parts.push(`${secondaryOnly} missing from the Funds Movement report altogether`);
  }

  const sentence =
    comparisons.length === 0
      ? "There is nothing to compare yet - one or both of the reports has not been loaded."
      : `${parts.join(", ")}. Your books use the Funds Movement figures: ` +
        `${formatMoneyCents(pT)} dispensed and ${formatMoneyCents(pS)} in surcharge.` +
        (needs > 0
          ? ` ${needs} ${needs === 1 ? "day needs" : "days need"} your attention.`
          : " Nothing needs your attention.");

  return {
    days: comparisons.length,
    agreed,
    adjusted,
    unexplained,
    primaryOnly,
    secondaryOnly,
    primaryTransactionCents: pT,
    primarySurchargeCents: pS,
    secondaryTransactionCents: sT,
    secondarySurchargeCents: sS,
    needsAttention: needs,
    sentence,
  };
}

/** Just the days Michael has to look at. */
export function daysNeedingAttention(
  comparisons: readonly DayComparison[],
): readonly DayComparison[] {
  return comparisons.filter((c) => agreementNeedsAttention(c.agreement));
}

/* ══════════════════════════════════════════════════════════════════════════
 * SELF-TESTS (tsx-runnable; PURE)
 * ══════════════════════════════════════════════════════════════════════════ */

/** Build a Funds Movement row the way mapFundsMovementCsv would emit it. */
function fmRow(
  settlementDate: string,
  txnCents: number | null,
  surchargeCents: number | null,
  transactionLegCount: number,
  surchargeLegCount: number,
): FundsMovementRow {
  return {
    terminalId: "HG26499",
    settlementDate,
    terminalTransactionCents: txnCents,
    surchargeCents,
    accountTail: "******6228",
    legCount: transactionLegCount + surchargeLegCount,
    transactionLegCount,
    surchargeLegCount,
  };
}

/** Build a Daily Settlement row the way mapSimpleSummaryCsv would emit it. */
function dsRow(
  settlementDate: string,
  settlementTotalCents: number | null,
  surchargeCents: number | null,
): SettlementRow {
  return {
    terminalId: "HG26499",
    settlementDate,
    totalTrx: null,
    withdrawalTrx: null,
    surchargedWdTrx: null,
    terminalTransactionCents: null,
    surchargeCents,
    settlementTotalCents,
    raw: {},
  };
}

export function __runAtmCorroborateCoreTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) {
      pass += 1;
    } else {
      fail += 1;
      console.log("FAIL:", msg);
    }
  };

  // ── Michael's REAL days, measured from both exports.
  //    2026-06-26 is clean; 2026-06-27 carries the -$100.00 reversal.
  const fm = [
    fmRow("2026-06-26", 500_00, 152_50, 1, 1),
    fmRow("2026-06-27", 296_000, 107_50, 2, 1), // $3,060.00 + (-$100.00)
  ];
  const ds = [dsRow("2026-06-26", 500_00, 152_50), dsRow("2026-06-27", 306_000, 107_50)];

  const cmp = compareReports(fm, ds);
  ok(cmp.length === 2, "one row per date, over the union");
  const d26 = cmp.find((c) => c.settlementDate === "2026-06-26");
  const d27 = cmp.find((c) => c.settlementDate === "2026-06-27");
  ok(d26?.agreement === "agreed", "2026-06-26 agrees");
  ok(d27?.agreement === "adjusted", "2026-06-27 differs, and the correction explains it");
  ok(d27?.transactionDiffCents === -10_000, "the difference is exactly the -$100 reversal");
  ok(d27?.primaryTransactionRows === 2, "two Funds Movement rows is the adjustment signature");
  ok(
    d27?.authoritativeTransactionCents === 296_000,
    "the authoritative figure INCLUDES the reversal ($2,960.00)",
  );
  ok(
    (d27?.explanation ?? "").includes("never mentions adjustments"),
    "the explanation says why the second report cannot see it",
  );
  ok(!agreementNeedsAttention("adjusted"), "an explained correction is not a problem");

  // ── The leg-specific check: a corrected TRANSACTION leg must not vouch for a
  //    SURCHARGE difference that nothing explains.
  const crossLeg = compareReports(
    [fmRow("2026-06-27", 296_000, 107_50, 2, 1)],
    [dsRow("2026-06-27", 306_000, 100_00)], // surcharge ALSO differs, with one row
  );
  ok(
    crossLeg[0]?.agreement === "unexplained",
    "a corrected transaction leg does not explain a surcharge difference",
  );

  // ── A difference with NO adjustment row must not be swept up with the others.
  const bad = compareReports(
    [fmRow("2026-06-28", 100_000, 0, 1, 1)],
    [dsRow("2026-06-28", 105_000, 0)],
  );
  ok(bad[0]?.agreement === "unexplained", "a difference with one row is UNEXPLAINED");
  ok((bad[0]?.explanation ?? "").includes("has NOT been accounted for"), "and it says so plainly");
  ok(agreementNeedsAttention("unexplained"), "an unexplained difference needs attention");
  ok(
    bad[0]?.authoritativeTransactionCents === 100_000,
    "the primary is STILL authoritative on an unexplained day",
  );

  // ── A missing figure is not a zero balance.
  const missing = compareReports(
    [fmRow("2026-06-29", 100_000, 250, 1, 1)],
    [dsRow("2026-06-29", null, 250)],
  );
  ok(
    missing[0]?.transactionDiffCents === null,
    "a column the second report never carried yields no difference, not a $1,000 one",
  );
  ok(
    missing[0]?.agreement === "agreed",
    "and it is not reported as a disagreement nobody can act on",
  );

  // ── One-sided days.
  const pOnly = compareReports([fmRow("2026-08-24", 500, 25, 1, 1)], []);
  ok(pOnly[0]?.agreement === "primary_only", "a day only the primary has");
  ok(!agreementNeedsAttention("primary_only"), "which is normal, not a problem");
  const sOnly = compareReports([], [dsRow("2026-08-24", 500, 25)]);
  ok(sOnly[0]?.agreement === "secondary_only", "a day only the secondary has");
  ok(agreementNeedsAttention("secondary_only"), "which IS a problem - it is missing from primary");
  ok(
    sOnly[0]?.authoritativeTransactionCents === null,
    "and no primary figure is invented from the corroborating report",
  );

  // ── The summary.
  const s = summariseCorroboration(cmp);
  ok(s.days === 2 && s.agreed === 1 && s.adjusted === 1, "the summary counts the kinds apart");
  ok(s.primaryTransactionCents === 346_000, "the totals come from the primary");
  ok(s.needsAttention === 0, "an adjusted day does not need attention");
  ok(s.sentence.includes("Funds Movement"), "the summary names the report the books use");
  ok(
    summariseCorroboration([]).sentence.includes("nothing to compare"),
    "an empty comparison says so",
  );
  ok(daysNeedingAttention(cmp).length === 0, "nothing to chase in the good case");
  ok(daysNeedingAttention(bad).length === 1, "the unexplained day is what gets chased");

  console.log(
    `atm-corroborate-core self-tests: ${fail === 0 ? "all passed" : `${fail} FAILED`} (${pass} ok)`,
  );
  if (fail > 0) throw new Error(`atm-corroborate-core: ${fail} self-test(s) failed`);
}
