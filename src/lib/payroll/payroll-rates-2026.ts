/**
 * src/lib/payroll/payroll-rates-2026.ts  (books-15)
 *
 * GREENWAY'S ACTUAL RATE TABLE. Every row traced to a document.
 *
 * This is the file a person edits when a rate notice arrives in the mail. It is
 * deliberately the ONLY place a rate number appears, and it is deliberately data
 * rather than logic, so that changing a rate never means changing code.
 *
 * HOW TO ADD NEXT YEAR'S RATE (the whole procedure):
 *   1. Close the current row by setting `effectiveTo` to the last day it
 *      applied - usually December 31. "Usually" is doing real work in that
 *      sentence: close the row on the last day the rate LEGALLY APPLIED, which
 *      is a question about the statute, not about the calendar. WA Cares is set
 *      biennially, so its row spans two years; everything else here is annual.
 *      NEVER leave `effectiveTo: null` to mean "still current" - that is the
 *      defect books-26 fixed, and it costs a wrong paycheck rather than an
 *      error message.
 *   2. Add a new row starting the next day.
 *   3. Put the notice or news release in `documentId` and `note`.
 * If you forget step 1, the registry REFUSES to build and tells you which two
 * rows collide. If you forget step 2, the first paycheck of the new year
 * REFUSES rather than quietly reusing last year's number.
 *
 * WHY THE OLD ROWS STAY: amended returns and prior-quarter corrections have to
 * be computed with the rate that was actually in force at the time. Deleting
 * history is how a correction gets recomputed with a rate that never applied to
 * it.
 *
 * PURE DATA. No I/O.
 */

import type { PayrollRateRow } from "@/lib/payroll/payroll-rate-registry-core";
import { PayrollRateRegistry } from "@/lib/payroll/payroll-rate-registry-core";

/**
 * WA PAID FAMILY & MEDICAL LEAVE.
 *
 * ESD recalculates this EVERY OCTOBER for the following January. The 2025->2026
 * move was 0.92% -> 1.13%, a 22.8% increase, which is exactly the size of error
 * a hardcoded constant would have introduced silently.
 *
 * BECAUSE IT IS ANNUAL, EVERY PFML ROW CLOSES ON DECEMBER 31. RCW
 * 50A.10.030(6)(a): "On or around October 20th of each year, the commissioner
 * must calculate the total premium rate". The version taking effect 2028-01-01
 * changes the METHOD but not the frequency - "Annually, the commissioner must
 * set the total premium rate based on the annual report". A PFML row left
 * open-ended would therefore hand next year's payroll THIS year's premium, and
 * do it silently. books-26 found exactly that: all three rows below carried
 * `effectiveTo: null`, so on 2027-01-01 - the day of Michael's first payroll -
 * the registry served 1.13% instead of refusing. Closing them converts a wrong
 * paycheck into a refusal that names the missing notice.
 *
 * The employee/employer split is a share OF THE TOTAL premium, not a rate on
 * wages. Storing it as a share is what lets the total change without anyone
 * having to remember to restate the split.
 *
 * Michael has fewer than 50 employees, so RCW 50A.10.030(5)(a) relieves him of
 * the EMPLOYER 28.57%. It does NOT relieve him of collecting and remitting the
 * employee 71.43%. The employer row is still recorded because the waiver is a
 * fact about his headcount, not about the rate, and headcount changes.
 */
const PFML_ROWS: PayrollRateRow[] = [
  {
    key: "pfml_total",
    effectiveFrom: "2025-01-01",
    effectiveTo: "2025-12-31",
    value: 920, // 0.92%
    unit: "milli_percent",
    authorityId: "esd-pfml-2026-rate-announcement",
    documentId: "esd-news-release-2025-10-29",
    note: "2025 PFML total premium 0.92% of wages. Kept on file so a corrected 2025 quarter is recomputed with the rate that actually applied.",
  },
  {
    key: "pfml_total",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-12-31",
    value: 1_130, // 1.13%
    unit: "milli_percent",
    authorityId: "esd-pfml-2026-rate-announcement",
    documentId: "esd-news-release-2025-10-29",
    note: "2026 PFML total premium 1.13% of wages, up from 0.92%. ESD announced 2025-10-29. Closes 2026-12-31 because RCW 50A.10.030(6)(a) resets this rate every year; the 2027 figure arrives around October 20 2026.",
  },
  {
    key: "pfml_employee_share_of_total",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-12-31",
    value: 71_430, // 71.43% OF THE PREMIUM, not of wages
    unit: "milli_percent",
    authorityId: "esd-pfml-2026-rate-announcement",
    documentId: "esd-news-release-2025-10-29",
    note: "Employees pay 71.43% of the PFML premium. This is a share of the premium, not a rate on wages.",
  },
  {
    key: "pfml_employer_share_of_total",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-12-31",
    value: 28_570, // 28.57% OF THE PREMIUM
    unit: "milli_percent",
    authorityId: "esd-pfml-2026-rate-announcement",
    documentId: "esd-news-release-2025-10-29",
    note: "Employers pay 28.57% of the PFML premium - but Greenway has under 50 employees and is relieved of this portion by RCW 50A.10.030(5)(a). Recorded because the waiver depends on headcount, which can change.",
  },
];

/**
 * WA CARES.
 *
 * 0.58% of GROSS WAGES WITH NO CAP, and 100% employee-funded.
 *
 * Two traps live in this one levy:
 *
 *  1. NO WAGE BASE. WA Cares uses the same wage DEFINITION as PFML but not the
 *     same wage CAP - it has none. A high earner who tops out of Social
 *     Security and PFML keeps paying WA Cares on every dollar. Reusing the PFML
 *     wage-base row here would under-withhold exactly the people most likely to
 *     notice. There is deliberately no `wa_cares_wage_base` key.
 *
 *  2. THE RATE-SETTER CHANGED. RCW 50B.04.080(1) moved rate-setting to the
 *     pension funding council effective 2026-01-01, biennially, "at a rate no
 *     greater than .58 percent." That is a CEILING. The rate can go down, and
 *     the next opportunity is 2028. Verified against the agency's own employer
 *     page and FAQ, which both still state 0.58% as of 2026-08.
 *
 *  3. THIS IS THE ONLY ROW IN THE FILE THAT DOES NOT CLOSE ON A DECEMBER 31
 *     OF THE CURRENT YEAR, AND THE REASON IS THE WORD "BIENNIALLY". The exact
 *     text is: "Beginning January 1, 2026, and biennially thereafter, the
 *     premium rate shall be set by the pension funding council at a rate no
 *     greater than .58 percent." A biennium that BEGINS 2026-01-01 covers 2026
 *     AND 2027, so the row legitimately reaches into Michael's first payroll
 *     year and closes 2027-12-31. The next council setting governs 2028.
 *
 *     Do not "tidy" this to 2026-12-31 to match its neighbours: that would
 *     refuse a 2027 paycheck the statute already answers, and a refusal with
 *     no notice to go fetch is a dead end. Do not restore `effectiveTo: null`
 *     either - that was the books-26 defect, and it silently served 0.58%
 *     into 2028 and every year after, where NO enacted rate exists.
 */
const WA_CARES_ROWS: PayrollRateRow[] = [
  {
    key: "wa_cares_total",
    effectiveFrom: "2023-07-01",
    effectiveTo: "2027-12-31",
    value: 580, // 0.58%
    unit: "milli_percent",
    authorityId: "rcw-50b-04-080-wa-cares",
    documentId: "wacaresfund-employers-page-2026",
    note: "WA Cares 0.58% of gross wages, NO wage cap, 100% employee-paid. Set by the pension funding council BIENNIALLY from 2026-01-01 at no more than 0.58%, so this row covers both 2026 and 2027 and closes 2027-12-31. Still 0.58% as of August 2026 per the agency employer page. The 2028 rate needs the council's next setting.",
  },
];

/**
 * WA UNEMPLOYMENT (SUTA) - Michael's own account.
 *
 * There is no public SUTA rate. ESD computes one per employer from that
 * employer's benefit-charge history and mails it every December. It cannot be
 * derived, only read off the notice, which is why the engine refuses without it.
 *
 * ES Reference Number 000-073905-00-0. The 0.4% total is 0.37% UI plus the 0.03%
 * Employment Administration Fund surcharge; the EAF is not optional and is not
 * separately reportable, so the total is what gets applied.
 */
const WA_SUTA_ROWS: PayrollRateRow[] = [
  {
    key: "wa_suta_total",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-12-31",
    value: 400, // 0.40% = 0.37% UI + 0.03% EAF
    unit: "milli_percent",
    authorityId: "esd-suta-rate-structure",
    documentId: "esd-2026-tax-rate-notice-000-073905-00-0",
    note: "Greenway 2026 unemployment rate 0.40% total (0.37% UI + 0.03% Employment Administration Fund). Employer-paid only; never withheld from an employee.",
  },
  {
    key: "wa_suta_wage_base",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-12-31",
    value: 7_820_000, // $78,200.00
    unit: "cents",
    authorityId: "esd-suta-rate-structure",
    documentId: "esd-2026-tax-rate-notice-000-073905-00-0",
    note: "2026 WA unemployment taxable wage base $78,200.00 per employee per year.",
  },
];

/**
 * L&I WORKERS' COMPENSATION - Michael's own account and risk class.
 *
 * Account 521,756-00. Risk class 6403 (Stores: Specialty Groceries).
 * Experience factor 0.9.
 *
 * Stored in MILLI-CENTS PER HOUR because the State quotes five decimal places of
 * a dollar and integer cents physically cannot hold $0.16445. This is the defect
 * books-14 fixed: the engine used to derive the employee share as half the
 * medical aid rate and produced $0.067185/hr against a true $0.16445/hr.
 *
 * Both sides are read off the notice. We do not re-derive a split the State has
 * already computed and printed.
 */
const LNI_ROWS: PayrollRateRow[] = [
  {
    key: "lni_employee_rate",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-12-31",
    value: 16_445, // $0.16445/hr
    unit: "milli_cents_per_hour",
    authorityId: "lni-premium-rate-formula",
    documentId: "lni-2026-rate-notice-521756-00",
    note: "L&I employee share $0.16445 per hour worked, risk class 6403, experience factor 0.9. Read off the notice, never derived.",
  },
  {
    key: "lni_employer_rate",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-12-31",
    value: 39_485, // $0.39485/hr
    unit: "milli_cents_per_hour",
    authorityId: "lni-premium-rate-formula",
    documentId: "lni-2026-rate-notice-521756-00",
    note: "L&I employer share $0.39485 per hour worked. Employee plus employer equals the $0.55930 total premium on the notice.",
  },
];

/**
 * SOCIAL SECURITY WAGE BASE.
 *
 * Federal, published annually by SSA. Included here so that every wage base in
 * the system lives in one dated table rather than some in a registry and some in
 * a constant - a split that guarantees one of them gets updated and the other
 * does not.
 */
const FICA_ROWS: PayrollRateRow[] = [
  {
    key: "fica_oasdi_wage_base",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-12-31",
    value: 18_450_000, // $184,500.00
    unit: "cents",
    authorityId: "ssa-2026-contribution-benefit-base",
    documentId: "ssa-contribution-and-benefit-base-2026",
    note: "2026 Social Security (OASDI) taxable wage base $184,500.00, verified against SSA's published table. Medicare has no wage base. PFML uses this same ceiling by law (RCW 50A.10.030(4)); WA Cares deliberately does not.",
  },
];

/**
 * WASHINGTON MINIMUM WAGE - the legal floor under every hourly rate.
 *
 * WHY A RATE ROW AND NOT A CONSTANT. RCW 49.46.020(2)(b) has L&I recalculate
 * this every September 30, effective the following January 1. It is therefore
 * exactly the same shape of fact as a PFML premium: a number that is only true
 * for a stated span of dates. books-26 moved it here so that asking for the
 * minimum wage on a date we have no announcement for REFUSES, instead of
 * handing back last year's floor and quietly authorising an underpayment.
 *
 * WHY MILLI-CENTS PER HOUR. The statute says the adjusted rate "shall be
 * calculated to the nearest cent", so the legal figure is always whole cents
 * and $17.13 is exact. The unit is milli-cents anyway, to match the L&I rows
 * above and the `minimumWageMilliCentsAtHire` field the employee record already
 * stores. One unit for every per-hour figure in the system beats two units and
 * a conversion nobody remembers to do.
 *
 * PORT ORCHARD IS NOT A LOCAL-MINIMUM-WAGE CITY. Seattle, SeaTac, Tukwila,
 * Renton, Burien, Everett and Bellingham set their own higher floors. Greenway
 * is in Port Orchard (Kitsap County), which is not on that list, so the state
 * figure is the operative one. That is a fact about Greenway's address rather
 * than about Washington, so it is recorded here where the rate lives, and it is
 * the first thing to re-check if Greenway ever opens a second location.
 */
const MINIMUM_WAGE_ROWS: PayrollRateRow[] = [
  {
    key: "wa_minimum_wage",
    effectiveFrom: "2025-01-01",
    effectiveTo: "2025-12-31",
    value: 1_666_000, // $16.66/hr
    unit: "milli_cents_per_hour",
    authorityId: "lni-minimum-wage-announcement",
    documentId: "lni-2025-minimum-wage-announcement",
    note: "2025 Washington minimum wage $16.66/hour. Kept on file because a rate paid in 2025 has to be tested against the floor that applied in 2025, not against today's.",
  },
  {
    key: "wa_minimum_wage",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-12-31",
    value: 1_713_000, // $17.13/hr
    unit: "milli_cents_per_hour",
    authorityId: "lni-minimum-wage-announcement",
    documentId: "lni-2026-minimum-wage-announcement",
    note: "2026 Washington minimum wage $17.13/hour, up from $16.66. Closes 2026-12-31: RCW 49.46.020(2)(b) has L&I announce the next figure on September 30 2026, effective 2027-01-01. Until that notice exists this system refuses rather than reusing $17.13.",
  },
];

/** Every rate Greenway uses, as dated evidenced rows. */
export const GREENWAY_RATE_ROWS: readonly PayrollRateRow[] = [
  ...PFML_ROWS,
  ...WA_CARES_ROWS,
  ...WA_SUTA_ROWS,
  ...LNI_ROWS,
  ...FICA_ROWS,
  ...MINIMUM_WAGE_ROWS,
];

/**
 * The built registry.
 *
 * Built at module load ON PURPOSE. If someone introduces an overlapping or
 * malformed row, the import fails immediately and loudly instead of producing a
 * wrong paycheck at the end of the month. Rule 14: make the wrong thing
 * impossible, not merely discouraged.
 */
export const GREENWAY_RATES: PayrollRateRegistry =
  PayrollRateRegistry.create(GREENWAY_RATE_ROWS);
