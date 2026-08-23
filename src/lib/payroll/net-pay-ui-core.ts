/**
 * src/lib/payroll/net-pay-ui-core.ts   (books-37)
 *
 * WHAT THE NET PAY SCREEN NEEDS, ASSEMBLED WHERE IT CAN BE TESTED.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS SCREEN IS A CALCULATOR AND NOT A REPORT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The honest answer came out of the recon, and it is worth stating plainly
 * because the alternative would have looked better and been a lie.
 *
 * `payroll_run_lines` — the only table in this database that stores a paycheck
 * — has exactly these money columns:
 *
 *     net_pay_cents, gross_pay_cents, taxes_cents, deductions_cents
 *
 * One column called `taxes_cents`. Not federal income tax, social security,
 * medicare, PFML, WA Cares and L&I as six separate figures: ONE lump. And
 * `ytd-mentor.ts` already has a lesson about exactly this, titled "Why the old
 * single 'taxes' column could never have produced a W-2 or a 941".
 *
 * That has a hard consequence for this screen. Disposable earnings under
 * 15 U.S.C. 1672(b) are gross less amounts REQUIRED BY LAW to be withheld —
 * and a single `taxes_cents` lump cannot answer that question, because nothing
 * records whether it contains a voluntary health premium. So a screen claiming
 * to show "the real net pay of last Friday's run" would either have to invent
 * the split or silently treat the whole lump as required by law. The first is
 * fabrication; the second over-states disposable earnings and over-garnishes,
 * which is the precise defect this entire slice exists to fix.
 *
 * So this screen does not pretend. It is a WORKED CALCULATOR: Michael supplies
 * the facts about one cheque, and the real engines — the same
 * `computePaycheckTaxes`, `computeAllOrders` and `computeNetPay` that a live
 * run will use — produce every line with the arithmetic shown. When the payroll
 * tables grow the itemised columns, this module's `buildNetPayWorkedExample`
 * gets its inputs from the database instead of from the form and NOTHING ELSE
 * CHANGES. That is standing rule 62e: build the seam the next slice needs, now,
 * rather than retrofitting it.
 *
 * It is also the precedent already set by `payroll-onboarding-ui-core.ts`,
 * which does the same job for the onboarding screen and for the same reason
 * Michael gave in his own words: "I don't use any of the reports in the
 * screenshot really because I don't understand fully what it is showing me."
 * A number he can re-derive is a number he owns.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS MODULE REFUSES TO DO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * It does not compute tax, garnishment, or net pay. Three tested engines
 * already do, and a second implementation here would eventually disagree with
 * the first in a way nobody notices until a 941 does not tie (standing rule 25:
 * EXTEND, do not duplicate). This module WIRES them together and formats what
 * comes back.
 *
 * It does not invent a rate. Every rate is read from `GREENWAY_RATES`, the
 * dated evidenced registry. Where a rate has no row covering the date — which
 * is the live situation for every 2027 date until L&I publishes the minimum
 * wage on 2026-09-30 — the lookup REFUSES and the refusal is carried to the
 * screen. It is never replaced with last year's figure and never with a zero,
 * because a zero rate computes a clean, confident, wrong paycheck.
 *
 * PURITY (standing rule 65b). No `node:fs`, no database, no `server-only`.
 * Every input is an argument, so this is reachable from a client component and
 * fully testable without a database.
 */

import {
  computeAllOrders,
  type MinimumWageFacts,
  type MultiOrderResult,
  type WageOrder,
} from "@/lib/payroll/garnishment-core";
import {
  computeNetPay,
  netPayReconciles,
  requiredByLawFor,
  type NetPayBreakdown,
  type NetPayRefusal,
  type RequiredByLawBreakdown,
  type VoluntaryDeduction,
} from "@/lib/payroll/net-pay-core";
import { GREENWAY_LNI_RISK_CLASS_CODE } from "@/lib/payroll/payroll-onboarding-ui-core";
import type { PayRunContext } from "@/lib/payroll/pay-run-core";
import {
  ALL_PAYROLL_RATE_KEYS,
  describeKey,
  type PayrollRateKey,
  type RateLookup,
} from "@/lib/payroll/payroll-rate-registry-core";
import { GREENWAY_RATES } from "@/lib/payroll/payroll-rates-2026";
import type { W4Record } from "@/lib/payroll/payroll-w4-core";
import {
  PAY_PERIODS_PER_YEAR,
  defaultW4WhenNoneFurnished,
  validateW4,
  type PayFrequency,
} from "@/lib/payroll/payroll-w4-core";
import {
  ZERO_YTD,
  computePaycheckTaxes,
  formatCentsPlain,
  type PaycheckTaxes,
  type YtdWageAccumulators,
} from "@/lib/payroll/payroll-withholding-core";

/* ═══════════════════════════════════════════════════════════════════════════
 * 1) THE FACTS ABOUT ONE CHEQUE
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Everything needed to work one paycheck all the way to the number on it.
 *
 * Deliberately a flat record of FACTS rather than a half-computed result. The
 * screen collects these; a future payroll run will read them from the database;
 * the function below does not care which.
 */
export type NetPayScenario = {
  readonly employeeName: string;
  /** The date the cheque is PAID. Every rate is looked up on this date. */
  readonly payDateIso: string;
  readonly grossWagesCents: number;
  /** Hours worked, in HUNDREDTHS of an hour. L&I is charged per hour worked. */
  readonly hundredthHours: number;
  readonly payFrequency: PayFrequency;
  readonly w4: W4Record;
  /**
   * Where the employee stands for the year BEFORE this cheque.
   *
   * This is the whole reason the YTD store exists. Pass a real accumulator and
   * the Social Security ceiling can engage; pass zeros and it never can.
   */
  readonly ytd: YtdWageAccumulators;
  readonly orders: readonly WageOrder[];
  readonly voluntaryDeductions: readonly VoluntaryDeduction[];
  /**
   * Workweeks compensated by this cheque. 2 for a normal biweekly period.
   *
   * NOT derived from the pay frequency. 29 CFR 870.10(c)(2) multiplies the
   * protected floor by this figure, and a final cheque can cover a fraction of
   * a week — deriving it would produce a wrong floor on exactly the cheque
   * where the floor matters most.
   */
  readonly workweeksInPeriod: number;
};

/* ═══════════════════════════════════════════════════════════════════════════
 * 2) RATES, READ FROM EVIDENCE
 * ═══════════════════════════════════════════════════════════════════════════ */

/** A rate that could not be found, in the words the screen will show. */
export type MissingRate = {
  readonly label: string;
  readonly why: string;
};

/**
 * Unwrap a rate lookup, RECORDING the refusal rather than papering over it.
 *
 * The wrong answer here is `?? 0`. A zero rate does not look like an error: it
 * produces a tidy paycheck with one line quietly missing. Keeping the refusal
 * means the screen can show a gap where a number should be, which is the only
 * honest rendering of "we do not know this yet".
 */
export function readRate(
  label: string,
  lookup: RateLookup<number>,
  into: MissingRate[],
): number | null {
  if (lookup.ok) return lookup.value;
  into.push({ label, why: `${lookup.refusal.message} ${lookup.refusal.whatToDo}` });
  return null;
}

/** The evidence document behind a rate on a date, so a figure is auditable. */
export function documentIdFor(
  key: Parameters<typeof GREENWAY_RATES.lookup>[0],
  onIsoDate: string,
): string | null {
  const row = GREENWAY_RATES.lookup(key, onIsoDate);
  return row.ok ? row.value.documentId : null;
}

/**
 * The minimum wage facts the CCPA floor is measured against.
 *
 * TWO FLOORS, AND THE EMPLOYEE GETS THE BETTER ONE. 15 U.S.C. 1673(a) protects
 * 30x the FEDERAL minimum wage; RCW 6.27.150 protects 35x the STATE minimum
 * wage. Washington's is far higher, so in practice the state floor governs —
 * but both are supplied because the engine is what decides, not this function.
 *
 * BOTH ARE READ FROM THE REGISTRY, AND NEITHER IS TYPED IN HERE. The federal
 * row did not exist until books-37, and its absence was not theoretical: the
 * first creditor order run through this chain refused outright, because the
 * federal test cannot be performed without the federal wage. `garnishment-core`
 * refuses rather than falling back on the dollar figures printed in 29 CFR
 * 870.10 — those were frozen at the 1991 wage of $4.25, and copying $127.50 out
 * of the regulation today would over-garnish badly.
 *
 * A null on either side still means refuse. The rows are dated and both of them
 * close: Washington's on 2026-12-31 until L&I announces the 2027 figure on
 * 2026-09-30, and the federal one on the date its evidence was retrieved. That
 * is deliberate. A garnishment computed against a stale floor takes money the
 * employee was entitled to keep.
 */
/**
 * EVERY rate a paycheque needs on one date, read once, in one place.
 *
 * WHY THIS EXISTS (books-39). The illustration below assembles eleven rates by
 * hand. The pay run needs the same eleven. Written twice, the two would
 * eventually disagree about which unit a rate is in or which of them blocks a
 * cheque - and the disagreement would surface as the worked example on screen
 * and the actual paycheque printing different numbers for the same employee on
 * the same day. Standing rule 25: one reader, two callers.
 *
 * NOTHING IS DEFAULTED. Every field is `number | null` and a null is passed
 * through exactly as the registry returned it. The comment forty lines below
 * this one, headed "THE $0.00 THAT LOOKED LIKE A CORRECT ANSWER", records what
 * happened the last time a `?? 0` was written on this path: a missing PFML rate
 * became a zero premium, net pay came out $19.37 too high, disposable earnings
 * came out $19.37 too high with it, and a creditor garnishment took 25% of the
 * inflated figure. It survived tsc and review and was caught only by running
 * it. This function cannot repeat that mistake because it has no arithmetic in
 * it at all.
 *
 * `missingRates` comes back alongside, already in Michael's language, so the
 * caller can TELL HIM WHICH AGENCY TO CHASE rather than showing a blank.
 */
export function payRunRatesOn(payDateIso: string): {
  readonly context: PayRunContext;
  readonly missingRates: readonly MissingRate[];
} {
  const on = payDateIso;
  const missingRates: MissingRate[] = [];
  const wages = minimumWageFactsOn(on, missingRates);

  const context: PayRunContext = {
    payDateIso: on,
    wages,
    stateUnemploymentRateMilliPct: readRate(
      "Unemployment (SUTA) rate",
      GREENWAY_RATES.lookupValue("wa_suta_total", on, "milli_percent"),
      missingRates,
    ),
    sutaRateNoticeDocumentId: documentIdFor("wa_suta_total", on),
    pfmlTotalRateMilliPct: readRate(
      "Paid Family & Medical Leave total rate",
      GREENWAY_RATES.lookupValue("pfml_total", on, "milli_percent"),
      missingRates,
    ),
    pfmlEmployerSharePctMilliPct: readRate(
      "PFML employer share of the total",
      GREENWAY_RATES.lookupValue("pfml_employer_share_of_total", on, "milli_percent"),
      missingRates,
    ),
    waCaresRateMilliPct: readRate(
      "WA Cares rate",
      GREENWAY_RATES.lookupValue("wa_cares_total", on, "milli_percent"),
      missingRates,
    ),
    lniEmployeeRateMilliCentsPerHour: readRate(
      "L&I employee rate",
      GREENWAY_RATES.lookupValue("lni_employee_rate", on, "milli_cents_per_hour"),
      missingRates,
    ),
    lniEmployerRateMilliCentsPerHour: readRate(
      "L&I employer rate",
      GREENWAY_RATES.lookupValue("lni_employer_rate", on, "milli_cents_per_hour"),
      missingRates,
    ),
    lniRiskClassCode: GREENWAY_LNI_RISK_CLASS_CODE,
    lniRateNoticeDocumentId: documentIdFor("lni_employee_rate", on),

    /*
     * The three below are FACTS ABOUT GREENWAY, not rates, and each is true
     * today for a stated reason rather than because it is a convenient value:
     *
     *   fewer than 50 WA employees - Greenway is a single Port Orchard shop.
     *     Under 50, the employer owes no share of the PFML medical premium.
     *   state contributions paid timely - governs the FUTA credit. Michael has
     *     no delinquency; if that ever changes the FUTA rate rises from 0.6% to
     *     6.0% and this must change with it.
     *   credit reduction 0 - Washington is not a credit-reduction state for
     *     2026. This is republished by USDOL every November.
     */
    employerHasFewerThan50WaEmployees: true,
    stateContributionsPaidTimely: true,
    creditReductionMilliPct: 0,
  };

  return { context, missingRates };
}

export function minimumWageFactsOn(
  payDateIso: string,
  into: MissingRate[],
): MinimumWageFacts {
  const state = readRate(
    "Washington minimum wage",
    GREENWAY_RATES.lookupValue("wa_minimum_wage", payDateIso, "milli_cents_per_hour"),
    into,
  );
  const federal = readRate(
    "Federal minimum wage",
    GREENWAY_RATES.lookupValue("federal_minimum_wage", payDateIso, "milli_cents_per_hour"),
    into,
  );
  return {
    federalMilliCentsPerHour: federal,
    stateMilliCentsPerHour: state,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 3) THE WORKED EXAMPLE
 * ═══════════════════════════════════════════════════════════════════════════ */

/** One line of the required-by-law bucket, with the reason it is in there. */
export type RequiredLine = {
  readonly label: string;
  readonly amountCents: number;
  /** Why the LAW requires this, in one sentence. */
  readonly why: string;
  readonly authorityId: string;
};

export type NetPayWorkedExample =
  | {
      readonly ok: true;
      readonly employeeName: string;
      readonly payDateIso: string;
      readonly taxes: PaycheckTaxes;
      readonly breakdown: NetPayBreakdown;
      readonly requiredLines: readonly RequiredLine[];
      /** `netPayReconciles` run on the breakdown. Shown, not assumed. */
      readonly reconciliation: ReturnType<typeof netPayReconciles>;
      /** Rates with no evidenced row for this date. */
      readonly missingRates: readonly MissingRate[];
      /** The tax engine's own refusals, in Michael's language. */
      readonly engineNotes: readonly string[];
    }
  | {
      readonly ok: false;
      readonly employeeName: string;
      readonly payDateIso: string;
      readonly refusals: readonly NetPayRefusal[];
      readonly missingRates: readonly MissingRate[];
    };

/**
 * Itemise the required-by-law bucket for display, WITH the reason each line
 * belongs in it.
 *
 * The reasons are the point. "Required by law" is a legal test, not a list, and
 * the single most consequential mistake available on this screen is putting a
 * voluntary deduction in this bucket — which shrinks disposable earnings and
 * under-garnishes a support order, and that shortfall can land on the employer
 * personally. Naming the statute next to each line makes the test visible
 * rather than tribal.
 *
 * The L&I line is here because RCW 51.16.140(1) says "shall deduct". It was
 * missing from the base before books-37.
 */
export function requiredLinesFor(r: RequiredByLawBreakdown): readonly RequiredLine[] {
  return [
    {
      label: "Federal income tax",
      amountCents: r.federalIncomeTaxCents,
      why: "IRC §3402 requires the employer to deduct and withhold on wages.",
      authorityId: "pub15t-2026-automated-method",
    },
    {
      label: "Social Security (OASDI)",
      amountCents: r.socialSecurityCents,
      why: "IRC §3101(a) imposes the tax and §3102 requires the employer to collect it by deducting it from wages.",
      authorityId: "irc-3101-employee-fica",
    },
    {
      label: "Medicare",
      amountCents: r.medicareCents,
      why: "IRC §3101(b). No wage ceiling — Medicare runs on every dollar.",
      authorityId: "irc-3101-employee-fica",
    },
    {
      label: "Additional Medicare",
      amountCents: r.additionalMedicareCents,
      why: "0.9% on wages above the threshold. Employee only — there is no employer match on this part.",
      authorityId: "w2-additional-medicare-threshold",
    },
    {
      label: "WA Paid Family & Medical Leave",
      amountCents: r.waPfmlCents,
      why: 'RCW 50A.10.030(3)(a): for medical leave premiums an employer "may deduct from the wages of each employee up to the full amount of the premium required." The premium itself is not optional — the deduction is how the employee\'s statutory share is collected.',
      authorityId: "rcw-50a-10-030-pfml",
    },
    {
      label: "WA Cares",
      amountCents: r.waCaresCents,
      why: 'RCW 50B.04.080(2)(a): the employer "must collect from the employees the premiums ... through payroll deductions and remit the amounts collected" to ESD, acting as the employees\' agent in doing so.',
      authorityId: "rcw-50b-04-080-wa-cares",
    },
    {
      label: "L&I medical aid (employee half)",
      amountCents: r.waLniCents,
      why: 'RCW 51.16.140(1): the employer "shall deduct" half the medical benefit premium from the worker\'s pay. Subsection (2) makes deducting the wrong amount a gross misdemeanor.',
      authorityId: "rcw-51-16-140-lni-deduction",
    },
  ];
}

/**
 * Work one cheque, end to end, through the real engines.
 *
 * THE ORDER IS THE LAW AND IT IS NOT NEGOTIABLE:
 *
 *   1. gross
 *   2. less amounts required by law   -> disposable earnings (the CCPA base)
 *   3. less garnishment, capped on (2)
 *   4. less voluntary deductions
 *   5. = net pay
 *
 * Step 4 is after step 3 and is not part of step 2. Every instinct says a
 * health premium is a deduction like any other; DOL Fact Sheet #30 says
 * otherwise in as many words. Subtracting it at step 2 shrinks the base,
 * shrinks the garnishment, and leaves the employer holding the difference.
 *
 * This function does not implement any of that. `computeNetPay` does. What
 * happens here is assembly, and the assembly is the part that was missing.
 */
export function buildNetPayWorkedExample(scenario: NetPayScenario): NetPayWorkedExample {
  const on = scenario.payDateIso;
  const missingRates: MissingRate[] = [];

  /*
   * THE W-4 IS VALIDATED BEFORE THE ENGINE SEES IT, AND THIS IS NOT CEREMONY.
   *
   * Found by running this module rather than by reading it. A probe passed a
   * filing status of "single" — a plausible-looking string that is not one of
   * the three the IRS worksheet defines — and the result was not a refusal. It
   * was an uncaught crash five frames down:
   *
   *     TypeError: Cannot read properties of undefined (reading 'length')
   *       at findBracket (payroll-withholding-core.ts:414)
   *
   * `selectRateSchedule` has no default branch (correctly — TypeScript proves
   * the switch total for the declared union), so an out-of-union value falls
   * through and returns `undefined`, and `findBracket` then reads `.length` off
   * it. Every layer behaved reasonably and the composite behaved terribly.
   *
   * TypeScript cannot save us at THIS boundary. `W4Record` will one day be read
   * from a database row and cast, and a cast is a promise, not a check. The
   * same is true of a JSON request body. So the string arriving here is
   * genuinely unknown at runtime even though it is typed.
   *
   * `validateW4` already knew the answer — it blocks a filing status outside
   * the three — but nothing on this path was calling it. That was the defect:
   * not a missing rule, an unenforced one. Calling it here converts a stack
   * trace about `undefined.length` into a refusal that names the field and says
   * what to do, which is the difference between Michael seeing a broken screen
   * and Michael seeing a sentence he can act on (standing rule 48: a check that
   * cannot classify must FAIL, not sail past).
   */
  const w4Check = validateW4(scenario.w4);
  const blocking = w4Check.issues.filter((i) => i.severity === "block");
  if (blocking.length > 0) {
    return {
      ok: false,
      employeeName: scenario.employeeName,
      payDateIso: on,
      refusals: blocking.map((i) => ({
        code: "NET_PAY_TAXES_REFUSED" as const,
        message:
          `This employee's Form W-4 cannot be used as recorded, so no tax could be ` +
          `computed and therefore no net pay. ${i.message}`,
        whatToDo:
          `Correct the "${i.field}" entry on the employee's W-4 record, then work the ` +
          `cheque again. Nothing has been withheld or paid.`,
      })),
      missingRates,
    };
  }

  const pfmlTotal = readRate(
    "Paid Family & Medical Leave total rate",
    GREENWAY_RATES.lookupValue("pfml_total", on, "milli_percent"),
    missingRates,
  );
  const pfmlEmployerShare = readRate(
    "PFML employer share of the total",
    GREENWAY_RATES.lookupValue("pfml_employer_share_of_total", on, "milli_percent"),
    missingRates,
  );
  const waCares = readRate(
    "WA Cares rate",
    GREENWAY_RATES.lookupValue("wa_cares_total", on, "milli_percent"),
    missingRates,
  );
  const suta = readRate(
    "Unemployment (SUTA) rate",
    GREENWAY_RATES.lookupValue("wa_suta_total", on, "milli_percent"),
    missingRates,
  );
  const lniEmployee = readRate(
    "L&I employee rate",
    GREENWAY_RATES.lookupValue("lni_employee_rate", on, "milli_cents_per_hour"),
    missingRates,
  );
  const lniEmployer = readRate(
    "L&I employer rate",
    GREENWAY_RATES.lookupValue("lni_employer_rate", on, "milli_cents_per_hour"),
    missingRates,
  );
  const wages = minimumWageFactsOn(on, missingRates);

  /*
   * ─────────────────────────────────────────────────────────────────────────
   * THE $0.00 THAT LOOKED LIKE A CORRECT ANSWER
   * ─────────────────────────────────────────────────────────────────────────
   *
   * Found by RUNNING this module against Michael's actual cutover date rather
   * than by reading it. Working a 2027-01-08 cheque returned `ok: true` and a
   * confident net pay — with "WA Paid Family & Medical Leave  $0.00" sitting in
   * the required-by-law list.
   *
   * The mechanism is one operator. `computePaycheckTaxes` takes the PFML and WA
   * Cares rates as plain `number`, not `number | null`, so a missing rate has
   * to become SOMETHING before the call. Writing `pfmlTotal ?? 0` makes it a
   * zero, a zero rate computes a zero premium, and a zero premium is not an
   * error the engine can detect — it is a perfectly ordinary number. So no
   * refusal was raised. Contrast L&I and SUTA, whose rates the engine accepts
   * as nullable: both refused loudly and explained themselves.
   *
   * This is the exact `?? 0` anti-pattern the `readRate` doc-comment above
   * warns about, and I wrote it anyway while wiring the call. It survived
   * `tsc`, it survived review, and it was caught only by executing it.
   *
   * WHY IT IS NOT A COSMETIC BUG. The missing premium is $19.37 on this cheque.
   * That $19.37 was never subtracted, so disposable earnings came out $19.37
   * too HIGH — and a creditor garnishment takes 25% of disposable earnings.
   * Over-stating the base over-garnishes someone already being garnished, which
   * is precisely the defect this whole slice was opened to fix, reintroduced
   * one layer up. It is also a live condition, not a hypothetical: every 2027
   * date is missing rates today, and 2027 is when Michael starts.
   *
   * WHY REFUSING BEATS WARNING. `missingRates` already carried the fact to the
   * screen, so this was not invisible. But a warning beside a confident-looking
   * net pay is worse than no number, because the number is what gets paid and
   * the warning is what gets scrolled past. Standing rule 48: a check that
   * cannot classify must FAIL, not proceed with a caveat. So an employee-side
   * rate that is not on file stops the calculation.
   *
   * WHY ONLY THE EMPLOYEE-SIDE RATES. SUTA is employer-only in Washington
   * (`WaSutaResult.employeeCents` is typed as the literal `0`), so a missing
   * SUTA rate cannot change net pay or disposable earnings. It is reported and
   * does not block. L&I is employee-side but the engine already refuses on it
   * by name and says the premium was not withheld, so it needs no help here.
   * PFML is the one that was silent, and its total and employer share are both
   * required because the employee share is the remainder of the two.
   */
  const SILENTLY_ZEROABLE: readonly { readonly rate: number | null; readonly label: string }[] = [
    { rate: pfmlTotal, label: "Paid Family & Medical Leave total rate" },
    { rate: pfmlEmployerShare, label: "PFML employer share of the total" },
    { rate: waCares, label: "WA Cares rate" },
  ];
  const silentlyZeroed = SILENTLY_ZEROABLE.filter((r) => r.rate === null);
  if (silentlyZeroed.length > 0) {
    return {
      ok: false,
      employeeName: scenario.employeeName,
      payDateIso: on,
      refusals: silentlyZeroed.map((r) => ({
        code: "NET_PAY_TAXES_REFUSED" as const,
        message:
          `The ${r.label} in force on ${on} is not on file, and this premium comes out of the ` +
          `employee's cheque. Computing net pay without it would withhold nothing for it, which ` +
          `would overstate both the take-home figure and the disposable earnings any garnishment ` +
          `is measured against.`,
        whatToDo:
          `Add the rate effective for ${on} to the payroll rate registry, with the notice or ` +
          `announcement it came from, then work this cheque again. Nothing has been withheld.`,
      })),
      missingRates,
    };
  }

  const taxes = computePaycheckTaxes({
    w4: scenario.w4,
    payFrequency: scenario.payFrequency,
    grossWagesCents: scenario.grossWagesCents,
    // THE REAL YEAR-TO-DATE, not ZERO_YTD. This is the entire difference
    // between a ceiling that can engage and one that never can.
    ytd: scenario.ytd,
    hundredthHours: scenario.hundredthHours,
    // Nulls are passed through where a rate refused. The engine already knows
    // how to refuse a line for want of an evidenced rate, and it explains
    // itself in Michael's language. A zero here would buy a wrong number in
    // exchange for a tidy-looking screen.
    stateUnemploymentRateMilliPct: suta,
    sutaRateNoticeDocumentId: documentIdFor("wa_suta_total", on),
    stateContributionsPaidTimely: true,
    creditReductionMilliPct: 0,
    // NOT `?? 0`. The guard above has already returned a refusal if any of
    // these is null, so by this line they are known numbers. The non-null
    // assertion is doing no work the guard has not already done, and writing
    // `?? 0` here again would quietly restore the defect the guard exists to
    // prevent the moment somebody deletes the guard.
    pfmlTotalRateMilliPct: pfmlTotal!,
    pfmlEmployerSharePctMilliPct: pfmlEmployerShare!,
    employerHasFewerThan50WaEmployees: true,
    waCaresRateMilliPct: waCares!,
    waCaresExemptionApprovalDocumentId: null,
    employeeClaimsWaCaresExemption: false,
    lniEmployeeRateMilliCentsPerHour: lniEmployee,
    lniEmployerRateMilliCentsPerHour: lniEmployer,
    lniRiskClassCode: GREENWAY_LNI_RISK_CLASS_CODE,
    lniRateNoticeDocumentId: documentIdFor("lni_employee_rate", on),
  });

  const result = computeNetPay({
    taxes,
    orders: scenario.orders,
    wages,
    workweeksInPeriod: scenario.workweeksInPeriod,
    voluntaryDeductions: scenario.voluntaryDeductions,
  });

  if (!result.ok) {
    return {
      ok: false,
      employeeName: scenario.employeeName,
      payDateIso: on,
      refusals: result.refusals,
      missingRates,
    };
  }

  return {
    ok: true,
    employeeName: scenario.employeeName,
    payDateIso: on,
    taxes,
    breakdown: result.value,
    requiredLines: requiredLinesFor(result.value.requiredByLaw),
    // Run, not asserted. Two compensating errors produce a correct-looking net
    // pay with a wrong garnishment remittance behind it, and re-adding the
    // parts is the only way to see that.
    reconciliation: netPayReconciles(result.value),
    missingRates,
    engineNotes: [
      ...taxes.refusals.map((r) => `${r.message} ${r.whatToDo}`),
      ...taxes.notes,
    ],
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 4) SMALL HELPERS THE SCREEN USES
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The three figures that must always sit in this order, with the check stated.
 *
 * Gross ≥ disposable ≥ net is true BY DEFINITION: disposable has more taken off
 * than gross and less taken off than net. So an ordering violation is not a
 * business problem, it is a proof that something upstream is wrong — and
 * `NET_PAY_REVIEW_CHECKS` opens with exactly this question. Showing all three
 * side by side turns that check into something a reader performs by glancing
 * rather than by doing arithmetic.
 */
export function orderingHolds(b: NetPayBreakdown): boolean {
  return (
    b.grossWagesCents >= b.disposableEarningsCents &&
    b.disposableEarningsCents >= b.netPayCents
  );
}

/**
 * What the pre-garnishment figure is, said in words, next to what it is not.
 *
 * `computePaycheckTaxes` returns a field called `netPayCents` that is gross less
 * taxes. It is arithmetically right and the NAME is wrong — it is net pay only
 * for an employee with no garnishment and no deductions. A name that overstates
 * what it measures is the most dangerous kind of correct code, because nobody
 * double-checks a field called `netPayCents`. This sentence is how the screen
 * shows the two numbers meeting.
 */
export function afterTaxVersusNetSentence(b: NetPayBreakdown): string {
  const gap = b.afterTaxBeforeDeductionsCents - b.netPayCents;
  if (gap === 0) {
    return (
      `After tax this cheque is ${formatCentsPlain(b.afterTaxBeforeDeductionsCents)}, and that ` +
      `is also the net pay: nothing was garnished and there were no voluntary deductions.`
    );
  }
  return (
    `After tax this cheque is ${formatCentsPlain(b.afterTaxBeforeDeductionsCents)}. ` +
    `A further ${formatCentsPlain(gap)} comes off after that — ` +
    `${formatCentsPlain(b.totalGarnishedCents)} withheld under court or agency orders and ` +
    `${formatCentsPlain(b.totalVoluntaryCents)} in deductions the employee authorised in ` +
    `writing — leaving ${formatCentsPlain(b.netPayCents)} on the cheque.`
  );
}

/**
 * How many workweeks a full period of this frequency covers.
 *
 * OFFERED AS A STARTING POINT, NEVER IMPOSED. The CCPA floor in 29 CFR
 * 870.10(c)(2) scales with the workweeks the cheque actually compensates, and a
 * final cheque routinely covers a fraction of one. So the scenario carries
 * `workweeksInPeriod` as its own fact and this function only suggests the
 * default for a FULL period. Returns null where a period is not a whole number
 * of weeks — semimonthly, monthly, quarterly — rather than rounding, because a
 * rounded floor is a wrong floor on precisely the cheque where the floor is
 * doing the work.
 */
export function suggestedWorkweeksFor(frequency: PayFrequency): number | null {
  const periods = PAY_PERIODS_PER_YEAR[frequency];
  switch (frequency) {
    case "weekly":
      return 1;
    case "biweekly":
      return 2;
    case "daily":
      return null;
    default:
      // 52 weeks does not divide evenly into a semimonthly, monthly, quarterly,
      // semiannual or annual period. Saying so beats inventing 4.33.
      return Number.isInteger(52 / periods) ? 52 / periods : null;
  }
}

/** Total the orders actually withheld against, for the screen's summary line. */
export function garnishmentSummary(g: MultiOrderResult | null): string {
  if (g === null || g.lines.length === 0) {
    return "No court or agency orders attach to this cheque.";
  }
  const n = g.lines.length;
  const base =
    `${n} order${n === 1 ? "" : "s"} took ${formatCentsPlain(g.totalWithheldCents)} in total, ` +
    `measured against disposable earnings of ${formatCentsPlain(g.disposable.disposableCents)}.`;
  if (g.totalShortfallCents > 0) {
    return (
      `${base} The legal ceiling stopped ${formatCentsPlain(g.totalShortfallCents)} of what was ` +
      `asked for. A shortfall on a support order normally has to be reported to the issuing ` +
      `agency — it does not simply lapse.`
    );
  }
  return base;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 6) CAN THE FIRST PAYROLL ACTUALLY RUN?
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * MICHAEL'S FIRST PAYROLL IS 1 JANUARY 2027, AND TODAY IT CANNOT BE COMPUTED.
 *
 * This is not a prediction. It was found by running `buildNetPayWorkedExample`
 * against that exact date, which returned `ok: false` with seven rates missing:
 * PFML total, PFML employer share, SUTA, both L&I rates, the Washington minimum
 * wage and the federal minimum wage. Every one of those rows deliberately
 * closes on 2026-12-31, because the agency that sets it had not yet published
 * the 2027 figure when the row was written.
 *
 * That is the registry behaving CORRECTLY. RCW 49.46.020(2)(b) has L&I announce
 * the next minimum wage on 30 September; ESD issues a new SUTA rate notice each
 * December; the L&I rate notice arrives in December too. Refusing beats reusing
 * 2026's numbers, because a paycheque computed on a stale rate adds up perfectly
 * and is still wrong against the State — and against the employee.
 *
 * But "correct" and "safe" are not the same thing. If nobody notices until the
 * morning of the first payroll, the first payroll does not run. The date is
 * fixed, the notices arrive on somebody else's schedule, and the gap between
 * those two facts is exactly where a cutover fails.
 *
 * So the check is a FUNCTION OF A DATE rather than a fact recorded about one.
 * It iterates `ALL_PAYROLL_RATE_KEYS`, so a twelfth rate added next year is
 * covered the day it is added and cannot be silently forgotten here (standing
 * rule 50: the alternative is a hand-typed list wearing a green check).
 */
export type RateReadiness = {
  readonly key: PayrollRateKey;
  /** The rate in Michael's words, from the registry's own describeKey. */
  readonly label: string;
  readonly onFile: boolean;
  /** Present only when `onFile` is false: what is missing and what to do. */
  readonly why: string | null;
  readonly whatToDo: string | null;
};

export type PayDateReadiness = {
  readonly payDateIso: string;
  /** True only when EVERY rate is on file. Not a score, not a percentage. */
  readonly canRun: boolean;
  readonly rates: readonly RateReadiness[];
  readonly missingCount: number;
  /** One sentence Michael can act on. Never blank, never a bare count. */
  readonly summary: string;
};

/**
 * Which rates are on file for a pay date, and therefore whether it can run.
 *
 * PURE and total: no clock, no I/O, no throw. The date is an argument because a
 * function that read `new Date()` would answer a different question every day
 * and could not be tested (standing rule 15).
 */
export function payDateReadiness(payDateIso: string): PayDateReadiness {
  const rates: RateReadiness[] = ALL_PAYROLL_RATE_KEYS.map((key) => {
    const hit = GREENWAY_RATES.lookup(key, payDateIso);
    return {
      key,
      label: describeKey(key),
      onFile: hit.ok,
      why: hit.ok ? null : hit.refusal.message,
      whatToDo: hit.ok ? null : hit.refusal.whatToDo,
    };
  });

  const missing = rates.filter((r) => !r.onFile);
  const canRun = missing.length === 0;

  // The summary NAMES the missing rates rather than counting them. "7 rates
  // missing" tells Michael he has a problem; naming them tells him which four
  // agencies to chase, which is the difference between a warning and an action.
  const summary = canRun
    ? `Every rate a paycheque needs is on file for ${payDateIso}. This pay date can be computed today.`
    : `${missing.length} of ${rates.length} rates have no evidenced row covering ${payDateIso}: ` +
      `${missing.map((m) => m.label).join(", ")}. Until each one is on file with the notice it ` +
      `came from, no paycheque dated ${payDateIso} can be calculated — the system refuses rather ` +
      `than reusing the prior year's figure.`;

  return { payDateIso, canRun, rates, missingCount: missing.length, summary };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 7) THE ILLUSTRATION, DERIVED RATHER THAN TYPED
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * WHY THIS SCREEN SHOWS AN ILLUSTRATION AND SAYS SO IN SO MANY WORDS.
 *
 * There is no real cheque to show yet, and there are two independent reasons —
 * both verified, neither assumed:
 *
 *   1. Michael's first payroll is 1 January 2027. Today is 2026. There are no
 *      pay runs, so there is nothing to display.
 *   2. Even after the first run, `payroll_run_lines` stores ONE `taxes_cents`
 *      column. Disposable earnings under 15 U.S.C. 1672(b) are gross less the
 *      amounts REQUIRED BY LAW to be withheld, and a single lump cannot say
 *      whether a voluntary health premium is hiding inside it. Reading that
 *      column and calling the answer "disposable earnings" would reintroduce
 *      the exact over/under-garnishment defect this slice exists to prevent.
 *
 * The dishonest option is to fill a screen with plausible numbers. The number
 * $2,740.80 looks like evidence and is nothing of the kind — it is a number
 * somebody typed. So the illustration below TYPES NOTHING it can derive:
 *
 *   hourly rate  = the Washington minimum wage row for that date, from the
 *                  registry, with the L&I announcement behind it
 *   hours        = 80, which is 2 × the 40-hour FLSA workweek, and the same 2
 *                  that `workweeksInPeriod` passes to 29 CFR 870.10(c)(2)
 *   gross        = rate × hours, computed, not asserted
 *
 * The only genuinely chosen inputs are the shape of the example — full-time,
 * biweekly, one child-support order — and those are choices about WHAT TO
 * TEACH, not claims about Michael's payroll. They are labelled as such on the
 * screen rather than left for him to infer.
 */
export type IllustrationShape = "no_orders" | "child_support";

export type IllustrationScenario = {
  readonly scenario: NetPayScenario;
  /**
   * Exactly where every figure came from, for the screen to print verbatim.
   * A worked example whose inputs are unexplained teaches the wrong lesson.
   */
  readonly provenance: string;
  /** Null when the minimum wage for this date is not on file. */
  readonly hourlyRateMilliCents: number | null;
};

/** Two 40-hour FLSA workweeks. Named because 80 on its own is a magic number. */
const ILLUSTRATION_HOURS_PER_PERIOD = 80;
const ILLUSTRATION_WORKWEEKS = 2;

/**
 * Build the illustration for a pay date, deriving the pay rate from evidence.
 *
 * PURE and total. When the minimum wage row for the date is missing the gross
 * comes back as zero AND `hourlyRateMilliCents` is null — the caller must not
 * paper over that, and `payDateReadiness` will already be saying so loudly.
 */
export function buildIllustrationScenario(
  payDateIso: string,
  shape: IllustrationShape,
): IllustrationScenario {
  const wageLookup = GREENWAY_RATES.lookupValue(
    "wa_minimum_wage",
    payDateIso,
    "milli_cents_per_hour",
  );
  const hourlyRateMilliCents = wageLookup.ok ? wageLookup.value : null;

  // Milli-cents per hour × hours ÷ 1000 = cents. Integer arithmetic throughout;
  // no floating point ever touches money in this codebase.
  const grossWagesCents =
    hourlyRateMilliCents === null
      ? 0
      : Math.round((hourlyRateMilliCents * ILLUSTRATION_HOURS_PER_PERIOD) / 1000);

  /*
   * A SIGNED W-4 AT THE PUB. 15-T DEFAULT.
   *
   * `defaultW4WhenNoneFurnished` is the IRS's own no-W-4 treatment — single,
   * nothing claimed in Steps 2, 3 or 4 — so the elections are not invented
   * either. The signature date is added because `validateW4` BLOCKS an unsigned
   * form, and correctly: a W-4 is signed under penalty of perjury, so an
   * unsigned one is a draft. Verified by running it, not by reading it.
   */
  const w4: W4Record = {
    ...defaultW4WhenNoneFurnished("illustration-employee", 2026),
    signedAt: "2026-11-02",
  };

  /*
   * THE CHILD-SUPPORT ORDER, WITH BOTH DETERMINING FACTS SUPPLIED.
   *
   * Michael asked specifically about child support. `garnishment-core` REFUSES
   * a support order when `arrearsOverTwelveWeeks` or `supportsSecondFamily` is
   * null, because those two facts pick the row of the 15 U.S.C. 1673(b)(2)
   * matrix — 50, 55, 60 or 65 percent — and guessing picks a ceiling that is
   * wrong in one direction or the other. Both are stated here so the example
   * demonstrates the arithmetic; on a real order they come off the paperwork.
   */
  const orders: readonly WageOrder[] =
    shape === "child_support"
      ? [
          {
            id: "illustration-order",
            employeeId: "illustration-employee",
            orderKind: "child_support",
            caseNumber: "ILLUSTRATION — NOT A REAL CASE",
            amountCents: null,
            percentOfDisposableBasisPoints: 2500,
            arrearsOverTwelveWeeks: false,
            supportsSecondFamily: true,
            priority: 1,
          },
        ]
      : [];

  const rateSentence =
    hourlyRateMilliCents === null
      ? `The Washington minimum wage for ${payDateIso} is not on file, so this illustration has no pay rate to work from and shows a refusal instead of a cheque.`
      : `The pay rate is the Washington minimum wage in force on ${payDateIso}, read from the rate registry with the L&I announcement behind it — not a figure typed into this page. ` +
        `${formatCentsPlain(Math.round(hourlyRateMilliCents / 1000))} per hour × ${ILLUSTRATION_HOURS_PER_PERIOD} hours ` +
        `(two 40-hour workweeks) = ${formatCentsPlain(grossWagesCents)} gross.`;

  const shapeSentence =
    shape === "child_support"
      ? "One child-support order is attached at 25% of disposable earnings, with no arrears over twelve weeks and a second family supported — the two facts that pick the ceiling under 15 U.S.C. 1673(b)(2). The case number is not a real case."
      : "No court or agency orders are attached, so net pay and after-tax pay are the same figure here.";

  return {
    hourlyRateMilliCents,
    provenance:
      `This is a worked ILLUSTRATION, not a record of a cheque anybody was paid. ` +
      `${rateSentence} ${shapeSentence} ` +
      `Year-to-date starts at zero, so the Social Security wage cap does not engage — on a real ` +
      `cheque the year-to-date store supplies that figure and the cap can engage mid-year. ` +
      `Every amount below was produced by the same engines a real pay run uses; nothing on the ` +
      `screen is a stored number.`,
    scenario: {
      employeeName:
        shape === "child_support"
          ? "Illustration — full-time, one support order"
          : "Illustration — full-time, no orders",
      payDateIso,
      grossWagesCents,
      // L&I is charged per HOUR worked, in hundredths of an hour.
      hundredthHours: ILLUSTRATION_HOURS_PER_PERIOD * 100,
      payFrequency: "biweekly",
      w4,
      ytd: ZERO_YTD,
      orders,
      voluntaryDeductions: [],
      workweeksInPeriod: ILLUSTRATION_WORKWEEKS,
    },
  };
}

/** Re-exported so a screen never has to reach past this module for the engine. */
export { computeAllOrders, requiredByLawFor };
