/**
 * PAY RUN AUTHORITIES — the law that governs ACTUALLY CUTTING A CHEQUE.
 *
 * books-39. This slice exists because of a finding, not a feature request.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FINDING
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `computeNetPay` is called in exactly ONE place in the entire codebase:
 * `net-pay-ui-core.ts`, inside `buildNetPayWorkedExample`. That is an
 * ILLUSTRATION. It runs on an invented employee with invented hours, and it
 * says so on screen, honestly.
 *
 * Meanwhile `/admin/payroll` — the screen named "payroll", the one Michael
 * would reasonably walk to on a Friday — reads a net pay figure out of a form
 * field he TYPED, and writes it to the ledger:
 *
 *     const net = dollarsToCents(String(formData.get(`net_${id}`) ?? ""));
 *
 * So the system had a correct, tested, thoroughly-mirrored withholding engine
 * that no paycheque ever passed through, and a payroll screen that was a
 * calculator-shaped box for numbers computed somewhere else. Both halves
 * worked. Nothing joined them.
 *
 * This file is the law for the join.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SEPARATE REGISTRY (rule 25 — extend, do not duplicate)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Four registries already exist and none of them answers these questions:
 *
 *   payroll-tax-authorities     — how much tax? (the arithmetic)
 *   garnishment-authorities     — how much can be taken? (the ceilings)
 *   wage-order-entry-authorities— what must we DO when a writ arrives?
 *   timesheet-authorities       — what counts as an hour worked?
 *
 * A pay RUN is a different act from all four. It asks:
 *
 *   - Whose W-4 governs this cheque, and what if there isn't one?
 *   - What if the W-4 on file is defective?
 *   - What must be true before money moves at all?
 *
 * The first two have answers that are written down, mirrored on disk, and
 * MEASURABLY DIFFERENT from "just use zero". That is the whole reason this
 * registry exists rather than six more records bolted onto the tax file.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * STANDING RULE 24: THE QUOTE IS SACRED
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Every `quote` below is a character-for-character copy from the mirrored
 * source file named in `sourceFile`, which lives in `docs/authorities/`. None
 * of them was retyped from memory and none is a paraphrase.
 *
 * A COMPLIANCE TEST re-reads each quote out of its corpus file on every commit
 * and fails on a single character of drift. That test is in
 * `tests/compliance/pay-run-authorities.test.ts`, and it is the reason you can
 * trust the text below without going to look it up.
 *
 * WHAT IS DELIBERATELY ABSENT, AND WHY (rule 1 — never guess)
 *
 * I wanted to cite RCW 49.48.010 (wages due on the regular payday) and
 * WAC 296-126-040 (the itemised pay statement). Both are directly on point for
 * a pay run. NEITHER IS MIRRORED in `docs/authorities/`. I checked:
 *
 *     ls docs/authorities/state-wa/
 *       rcw-26.18.090  rcw-26.18.110  rcw-26.23.040  rcw-49.46.020
 *       rcw-49.46.130  rcw-49.46.210  rcw-49.52.050  rcw-49.52.060
 *       rcw-50.12.070  rcw-51.16.140  rcw-6.27.150   rcw-6.27.200
 *       rcw-6.27.350   rcw-69.50.325  rcw-69.50.328  wac-296-128-...
 *
 * Quoting them from memory would produce exactly the thing rule 24 forbids: a
 * sentence in quotation marks that no test can check. So they are named in the
 * mentor layer as things to look up, and they are NOT quoted here. When the
 * corpus grows to include them, they get entries.
 */

/** One mirrored authority for the act of running payroll. */
export type PayRunAuthority = {
  /** Stable id. Referenced by refusal codes and by the mentor layer. */
  readonly id: string;
  /** Human citation, as it would appear in a memo. */
  readonly citation: string;
  /** The file under docs/authorities/ this was copied out of. */
  readonly sourceFile: string;
  /** VERBATIM. Character for character. Never edited for length or style. */
  readonly quote: string;
  /**
   * What it means for Greenway, in Michael's language.
   *
   * This is NOT a summary of the quote. A summary would be redundant — he can
   * read. This says what the sentence DOES to the software: which branch it
   * forces, which refusal it justifies, what would go wrong without it.
   */
  readonly whatItMeansHere: string;
};

/* ═══════════════════════════════════════════════════════════════════════════
 * 1) THE NO-W-4 DEFAULT — the single most valuable sentence in this file
 * ═══════════════════════════════════════════════════════════════════════════ */

export const NO_W4_TREAT_AS_SINGLE: PayRunAuthority = {
  id: "pay-run-cfr-31-3402-f2-1-no-certificate",
  citation: "26 C.F.R. § 31.3402(f)(2)-1(a)(4)",
  sourceFile: "federal/cfr-31.3402(f)(2)-1.txt",
  quote:
    "(4) If an employee has no valid withholding allowance certificate in effect with the " +
    "employer at the time of the payment of the wages, and fails to furnish a valid withholding " +
    "allowance certificate to the employer, the employee will be treated as single but having " +
    "the withholding allowance provided in forms, instructions, publications, and other guidance " +
    "prescribed by the Commissioner.",
  whatItMeansHere:
    "This is the sentence that says a missing W-4 does NOT stop payroll, and it is the reason " +
    "the pay run has a documented fallback instead of a refusal. If somebody never handed in a " +
    "W-4, the law does not tell you to withhold nothing and it does not tell you to guess — it " +
    "tells you to treat them as SINGLE with no adjustments. That is a specific, named treatment " +
    "with a specific dollar consequence, and it is almost always MORE withholding than the " +
    "employee would have chosen for themselves. The software applies exactly that treatment, " +
    "labels the cheque as having used it, and tells you to go collect the form — because the " +
    "employee is the one paying for the missing paperwork out of every cheque until it arrives.",
};

/* ═══════════════════════════════════════════════════════════════════════════
 * 2) AN INVALID W-4 IS WORSE THAN A MISSING ONE
 * ═══════════════════════════════════════════════════════════════════════════ */

export const INVALID_W4_MUST_BE_DISREGARDED: PayRunAuthority = {
  id: "pay-run-cfr-31-3402-f2-1-invalid-certificate",
  citation: "26 C.F.R. § 31.3402(f)(2)-1(e)(1)(ii)",
  sourceFile: "federal/cfr-31.3402(f)(2)-1.txt",
  quote:
    "(ii) Employer disregard of invalid withholding allowance certificate. If an employer " +
    "receives an invalid withholding allowance certificate, the employer must disregard it for " +
    "purposes of computing withholding. The employer must inform the employee who furnished the " +
    "certificate that it is invalid and must request another withholding allowance certificate " +
    "from the employee. If the employee who furnished the invalid certificate fails to comply " +
    "with the employer's request, the employer must treat the employee as single but having the " +
    "withholding allowance provided by the forms, instructions, publications, and other guidance " +
    "prescribed by the Commissioner. If, however, a prior certificate is in effect with respect " +
    "to the employee, the employer must continue to withhold in accordance with the prior " +
    "certificate.",
  whatItMeansHere:
    "Three separate duties hide in this paragraph, and payroll software usually implements none " +
    "of them. First, an invalid form must be DISREGARDED — not partially honoured, not " +
    "'best-effort' interpreted. Second, you must TELL the employee it is invalid and ask for " +
    "another; that is an affirmative obligation on Greenway, not a courtesy. Third — and this is " +
    "the one everybody misses — if the employee previously filed a GOOD form, you keep using the " +
    "OLD one. You do not fall back to single. The system enforces this by never deleting a " +
    "superseded W-4: `is_current` is flipped, the row stays, so the prior certificate is still " +
    "there to fall back to. An unsigned form is the common case of 'invalid' here, and the " +
    "software treats a null signature date as 'no W-4', which is exactly this rule.",
};

/* ═══════════════════════════════════════════════════════════════════════════
 * 3) THE EMPLOYEE MUST FURNISH ONE — so chasing it is not nagging
 * ═══════════════════════════════════════════════════════════════════════════ */

export const W4_MUST_BE_FURNISHED_ON_HIRE: PayRunAuthority = {
  id: "pay-run-cfr-31-3402-f2-1-furnish-on-hire",
  citation: "26 C.F.R. § 31.3402(f)(2)-1(a)(1)",
  sourceFile: "federal/cfr-31.3402(f)(2)-1.txt",
  quote:
    "(1) On or before the date on which an individual commences employment with an employer, the " +
    "individual must furnish the employer with a signed withholding allowance certificate (see " +
    "§ 31.3402(f)(5)-1) relating to the filing status the employee reasonably expects to claim " +
    "under § 31.3402(l)-1(b) for the calendar year for which the withholding allowance " +
    "certificate is in effect and the withholding allowance under § 31.3402(f)(1)-1(b) that the " +
    "employee claims.",
  whatItMeansHere:
    "The word is 'must', the deadline is 'on or before' the first day, and the duty is the " +
    "EMPLOYEE'S. This matters for how the screen talks to you. When the pay run reports a " +
    "missing W-4 it is not reporting a Greenway failure and it is not asking you to apologise " +
    "for chasing it — the form was due before that person's first shift. It also means the " +
    "signature is part of the requirement, not decoration: 'a signed withholding allowance " +
    "certificate'. A form with data and no signature has not been furnished.",
};

/* ═══════════════════════════════════════════════════════════════════════════
 * 4) WITHHELD SUPPORT MONEY HAS A CLOCK ON IT
 * ═══════════════════════════════════════════════════════════════════════════ */

export const SUPPORT_REMITTED_WITHIN_FIVE_WORKING_DAYS: PayRunAuthority = {
  id: "pay-run-rcw-26-18-110-remit-clock",
  citation: "RCW 26.18.110(2)",
  sourceFile: "state-wa/rcw-26.18.110.txt",
  quote:
    "(2) If the employer possesses any earnings or remuneration due and owing to the obligor, " +
    "the earnings subject to the wage assignment order or income withholding order shall be " +
    "withheld immediately upon receipt of the wage assignment order or income withholding order. " +
    "The withheld earnings shall be delivered to the Washington state support registry or, if " +
    "the wage assignment order is to satisfy a duty of maintenance, to the addressee specified " +
    "in the assignment within five working days of each regular pay interval.",
  whatItMeansHere:
    "The moment a pay run takes support money out of somebody's cheque, a five-working-day clock " +
    "starts on Greenway to send it on. This is why the pay run does not stop at 'here is the net " +
    "pay' — when an order withheld anything, the result carries the remittance amount, the payee, " +
    "and the deadline, so the obligation is visible on the same screen that created it. Money " +
    "withheld and not remitted is the worst position to be in: the employee has already been " +
    "docked, so they are made whole in nobody's eyes, and Greenway is sitting on funds that " +
    "belong to a court registry.",
};

/* ═══════════════════════════════════════════════════════════════════════════
 * 5) THE MINIMUM WAGE FLOOR IS ANNUAL AND IT IS NOT OPTIONAL
 * ═══════════════════════════════════════════════════════════════════════════ */

export const WA_MINIMUM_WAGE_ADJUSTS_EVERY_JANUARY: PayRunAuthority = {
  id: "pay-run-rcw-49-46-020-annual-adjustment",
  citation: "RCW 49.46.020(2)(b)",
  sourceFile: "state-wa/rcw-49.46.020.txt",
  quote:
    "(b) On September 30, 2020, and on each following September 30th, the department of labor " +
    "and industries shall calculate an adjusted minimum wage rate to maintain employee " +
    "purchasing power by increasing the current year's minimum wage rate by the rate of " +
    "inflation. The adjusted minimum wage rate shall be calculated to the nearest cent using the " +
    "consumer price index for urban wage earners and clerical workers, CPI-W, or a successor " +
    "index, for the twelve months prior to each September 1st as calculated by the United States " +
    "department of labor. Each adjusted minimum wage rate calculated under this subsection " +
    "(2)(b) takes effect on the following January 1st.",
  whatItMeansHere:
    "Two consequences for a pay run, one obvious and one not. The obvious one: the minimum wage " +
    "changes every January 1st, so a rate loaded for 2026 is WRONG for 2027 and the system " +
    "refuses rather than carrying it forward. The non-obvious one: the minimum wage is an input " +
    "to GARNISHMENT, not just to wages. The federal exemption protects 30 times the minimum " +
    "hourly wage, and Washington's is higher, so an out-of-date minimum wage silently changes " +
    "how much can be taken from a garnished employee. That is why a missing minimum wage blocks " +
    "the whole run and not merely the low-paid cheques.",
};

/* ═══════════════════════════════════════════════════════════════════════════
 * THE REGISTRY
 * ═══════════════════════════════════════════════════════════════════════════ */

export const PAY_RUN_AUTHORITIES: readonly PayRunAuthority[] = [
  NO_W4_TREAT_AS_SINGLE,
  INVALID_W4_MUST_BE_DISREGARDED,
  W4_MUST_BE_FURNISHED_ON_HIRE,
  SUPPORT_REMITTED_WITHIN_FIVE_WORKING_DAYS,
  WA_MINIMUM_WAGE_ADJUSTS_EVERY_JANUARY,
];

/** Look one up by id. Returns null rather than throwing: a missing authority
 * is a bug in the caller, and the caller's own test should say so in its own
 * words rather than inheriting an exception message from here. */
export function payRunAuthorityById(id: string): PayRunAuthority | null {
  return PAY_RUN_AUTHORITIES.find((a) => a.id === id) ?? null;
}
