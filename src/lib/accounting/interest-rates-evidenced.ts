/**
 * src/lib/accounting/interest-rates-evidenced.ts   (books-21)
 *
 * THE RATES MICHAEL ACTUALLY SUPPLIED, AND NOTHING ELSE.
 *
 * Separate from `interest-core.ts` on purpose. The engine is arithmetic and is
 * true forever; this file is EVIDENCE and has a shelf life. Keeping them apart
 * means a stale rate can never hide inside a function, and it means this file
 * can be read on its own to answer "what do we actually have receipts for?"
 *
 * WHAT IS HERE AND WHAT IS DELIBERATELY MISSING
 * ---------------------------------------------------------------------------
 *
 * Michael gave me, verbatim: the §6621 structure, the DOR annual rate for 2026
 * and 2027 (6% each), and the §6651(j) minimums for 2023-2026. Those are below.
 *
 * He did NOT give me the quarterly FEDERAL SHORT-TERM RATES, and I will not
 * infer them. §6621(b)(1) has the Secretary set that rate quarterly and publish
 * it in a revenue ruling; it is a document to be looked up, not a number to be
 * reasoned toward. So `FEDERAL_SHORT_TERM_RATES` is deliberately EMPTY, and
 * every interest computation refuses until it is filled. That refusal is the
 * feature. An engine that quietly assumed 5% would produce numbers that
 * reconcile perfectly against themselves and are wrong against the IRS.
 *
 * He also did not give me the §6699(e) per-shareholder amount, because neither
 * of us knew §6699 was missing from this system until this slice found it. That
 * is on the outstanding list.
 */
import type { Section6651MinimumRow, ShortTermRateRow } from "@/lib/accounting/interest-core";

/**
 * QUARTERLY FEDERAL SHORT-TERM RATES — §6621(b).
 *
 * EMPTY ON PURPOSE. See the header. Each row, when added, needs the revenue
 * ruling it was read off; the registry rejects a row with no source.
 *
 * The shape to follow:
 *
 *     { year: 2026, quarter: 3, shortTermRateBasisPoints: 400,
 *       evidenceSource: "Rev. Rul. 2026-NN, Table 1" }
 *
 * Note the rate stored is the SHORT-TERM rate, not the finished underpayment
 * rate. The engine adds the §6621 points itself, so the three-point addition
 * lives in exactly one place and cannot be double-counted by a well-meaning
 * data entry.
 */
export const FEDERAL_SHORT_TERM_RATES: readonly ShortTermRateRow[] = [];

/**
 * §6651(j) inflation-adjusted 60-day minimums, by the calendar year the return
 * was REQUIRED TO BE FILED.
 *
 * Supplied by Michael. Every figure is a multiple of $5, which is what
 * §6651(j)(2)'s "next lowest multiple of $5" requires — a mechanical check on
 * his numbers that could have failed and did not. `validateSection6651Rows`
 * runs that check in a test rather than trusting this comment.
 */
export const SECTION_6651_MINIMUMS: readonly Section6651MinimumRow[] = [
  { filingYear: 2023, minimumCents: 450_00, evidenceSource: "supplied by owner 2026-08-20" },
  { filingYear: 2024, minimumCents: 485_00, evidenceSource: "supplied by owner 2026-08-20" },
  { filingYear: 2025, minimumCents: 525_00, evidenceSource: "supplied by owner 2026-08-20" },
  { filingYear: 2026, minimumCents: 525_00, evidenceSource: "supplied by owner 2026-08-20" },
];

/**
 * Washington Department of Revenue annual interest rate, in basis points.
 *
 * Kept here beside the federal rates so the two are easy to compare, because
 * the contrast is the lesson. DOR interest is SIMPLE and resets ANNUALLY
 * (RCW 82.32.050); federal interest COMPOUNDS DAILY and resets QUARTERLY
 * (§6621(b), §6622). The same nominal rate therefore costs materially more
 * federally, and the gap grows with time. The books-16 engine already keeps the
 * two schedules strictly separate; this table exists so nobody has to guess
 * which cadence they are looking at.
 */
export const DOR_ANNUAL_RATES: readonly {
  readonly year: number;
  readonly basisPoints: number;
  readonly evidenceSource: string;
}[] = [
  { year: 2026, basisPoints: 600, evidenceSource: "supplied by owner 2026-08-20" },
  { year: 2027, basisPoints: 600, evidenceSource: "supplied by owner 2026-08-20" },
];
