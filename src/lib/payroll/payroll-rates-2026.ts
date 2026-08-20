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
 *      applied - usually December 31.
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
    effectiveTo: null,
    value: 1_130, // 1.13%
    unit: "milli_percent",
    authorityId: "esd-pfml-2026-rate-announcement",
    documentId: "esd-news-release-2025-10-29",
    note: "2026 PFML total premium 1.13% of wages, up from 0.92%. ESD announced 2025-10-29.",
  },
  {
    key: "pfml_employee_share_of_total",
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    value: 71_430, // 71.43% OF THE PREMIUM, not of wages
    unit: "milli_percent",
    authorityId: "esd-pfml-2026-rate-announcement",
    documentId: "esd-news-release-2025-10-29",
    note: "Employees pay 71.43% of the PFML premium. This is a share of the premium, not a rate on wages.",
  },
  {
    key: "pfml_employer_share_of_total",
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
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
 */
const WA_CARES_ROWS: PayrollRateRow[] = [
  {
    key: "wa_cares_total",
    effectiveFrom: "2023-07-01",
    effectiveTo: null,
    value: 580, // 0.58%
    unit: "milli_percent",
    authorityId: "rcw-50b-04-080-wa-cares",
    documentId: "wacaresfund-employers-page-2026",
    note: "WA Cares 0.58% of gross wages, NO wage cap, 100% employee-paid. Set by the pension funding council biennially from 2026-01-01 at no more than 0.58%; still 0.58% as of August 2026.",
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

/** Every rate Greenway uses, as dated evidenced rows. */
export const GREENWAY_RATE_ROWS: readonly PayrollRateRow[] = [
  ...PFML_ROWS,
  ...WA_CARES_ROWS,
  ...WA_SUTA_ROWS,
  ...LNI_ROWS,
  ...FICA_ROWS,
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
