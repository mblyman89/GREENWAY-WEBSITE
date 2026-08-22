/**
 * src/lib/payroll/ytd-mentor.ts   (books-34)
 *
 * THE CPA SITTING NEXT TO MICHAEL WHILE THE YEAR ADDS ITSELF UP.
 *
 * Standing rule 26: every engine ships a mentor layer. `ytd-core.ts` is the
 * engine; this is the part that explains it in words Michael can act on.
 *
 * WHY THIS PARTICULAR ENGINE NEEDS A MENTOR MORE THAN MOST. Year-to-date totals
 * are the only numbers in payroll that nobody looks at until it is far too late
 * to fix them. A wrong hourly rate shows up on the next cheque and somebody
 * complains. A wrong running total shows up in January, on a W-2, after the
 * money has been paid and the quarters have been filed - and the way it shows
 * up is a letter from the Social Security Administration rejecting the whole
 * wage report. Every lesson below exists because the mistake it describes is
 * silent at the moment it is made.
 *
 * THREE KINDS OF LESSON, THE SAME THREE MICHAEL ALREADY LIKES:
 *
 *   1. FIELD LESSONS - one per stored column, answering the same five
 *      questions in the same order as the company-information screen he asked
 *      us to copy: what it is, where it is used, why it matters, the trap, and
 *      how to be sure.
 *
 *   2. SCREEN LESSONS - the ideas that belong to no single field. Above all the
 *      one this slice exists for: Social Security stops and Medicare does not,
 *      and neither fact means anything unless the software remembers what it
 *      already paid.
 *
 *   3. REFUSAL LESSONS - what each refusal means and what to actually do. A
 *      refusal that reaches Michael as a bare code is a dead end, and a dead
 *      end in payroll is where somebody decides to override the software.
 *
 * Plus a fourth, specific to this table: the YEAR-END CHECKS, which are the
 * IRS's own pre-filing checklist turned into an ordered list of things that can
 * be answered from the accumulator before a W-2 is ever produced.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * COVERAGE GATES LIVE IN `ytd-mentor-gates.ts`, NOT HERE. Standing rule 65b.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This file must stay pure and browser-safe: it imports no `node:fs`, no
 * database client, nothing server-only. The gates that read the migration and
 * the engine FROM DISK - and they must read from disk, because a hand-typed
 * list of columns passes forever after somebody adds one and forgets the
 * lesson - live in the sibling `-gates.ts` and are imported only by tests.
 *
 * That split is not stylistic. In books-33 the timesheet mentor held its own
 * `readFileSync` gates, a client component imported the mentor, and Turbopack
 * refused every Vercel build with "the chunking context (unknown) does not
 * support external modules (request: node:fs)" while GitHub Actions stayed
 * green - because CI ran vitest and the migrations and never once ran
 * `next build`. Michael could not see several slices of work. Nothing here is
 * weakened to keep the build passing; the strictness simply lives next door.
 */

import type { YtdRefusalCode } from "@/lib/payroll/ytd-core";

/* ═══════════════════════════════════════════════════════════════════════════ *
 * FIELD LESSONS - what Michael reads beside each stored figure
 * ═══════════════════════════════════════════════════════════════════════════ */

export type FieldLesson = {
  /** `table.column` this teaches. Qualified because this slice spans two tables. */
  readonly field: string;
  /** WHAT it is, with no jargon. */
  readonly whatItIs: string;
  /** WHERE it is used, naming the forms and the screens. */
  readonly whereItIsUsed: string;
  /** WHY it matters - the consequence, not the definition. */
  readonly whyItMatters: string;
  /** The mistake a competent person actually makes here. */
  readonly theTrap: string;
  /** Where to look it up rather than recalling it. */
  readonly howToBeSure: string;
  readonly authorityIds: readonly string[];
};

/**
 * ONE LESSON PER COLUMN, AND THE PERIOD/YEAR DISTINCTION IS DELIBERATE.
 *
 * The same eleven figures appear twice: once on `payroll_run_lines` as what a
 * single cheque did, and once on `payroll_ytd_accumulators` as what the year
 * has done. It would be tidier to teach each concept once. It would also be
 * wrong, because almost every expensive mistake in this area is precisely the
 * confusion between the two - reading a period figure as a year figure is how
 * an employee gets Social Security withheld past the wage base, and reading a
 * year figure as a period figure is how a 941 gets filed with a quarter's
 * liability equal to the whole year.
 */
export const YTD_FIELD_LESSONS: readonly FieldLesson[] = [
  /* ── payroll_run_lines: what ONE cheque did ──────────────────────────── */
  {
    field: "payroll_run_lines.oasdi_wages_cents",
    whatItIs:
      "The part of this one cheque that Social Security tax was actually charged on. Not the gross " +
      "pay - the portion that was still below the annual ceiling when this cheque was written.",
    whereItIsUsed:
      "Adds into the employee's year-to-date Social Security wages, which become box 3 of the W-2 " +
      "and line 5a of Form 941.",
    whyItMatters:
      "This is the figure that stops. Once an employee has crossed the annual wage base, later " +
      "cheques carry zero here even though the employee was paid in full, and that zero is correct.",
    theTrap:
      "Assuming this equals gross pay. On the cheque that straddles the ceiling it is a fraction of " +
      "gross, and on every cheque after it, it is zero. Software that copies gross into this column " +
      "keeps withholding Social Security all year and nobody notices until the W-2 exceeds the base " +
      "and the SSA rejects the report.",
    howToBeSure:
      "Add this column across the whole year for one employee. The total can equal the wage base or " +
      "be under it. It can never exceed it.",
    authorityIds: ["w2-box3-wage-base-ceiling", "w2-worked-example-199750"],
  },
  {
    field: "payroll_run_lines.medicare_wages_cents",
    whatItIs: "The part of this cheque that Medicare tax was charged on. In practice, all of it.",
    whereItIsUsed:
      "Adds into year-to-date Medicare wages, which become box 5 of the W-2 and line 5c of Form 941.",
    whyItMatters:
      "Medicare has no ceiling. This figure keeps growing for the whole year no matter how much the " +
      "employee earns, which is exactly why it cannot share a column with the Social Security figure.",
    theTrap:
      "Capping it. Somebody who knows there is a wage base applies it here too, and the W-2 comes out " +
      "with box 5 lower than box 3 - the single condition the SSA lists first among its reasons for " +
      "rejecting a wage report outright.",
    howToBeSure:
      "On any given cheque, Medicare wages are greater than or equal to Social Security wages. Never " +
      "less. The database enforces it and so does the engine.",
    authorityIds: ["w2-box5-no-medicare-limit", "ssa-rejection-conditions"],
  },
  {
    field: "payroll_run_lines.futa_wages_cents",
    whatItIs:
      "The part of this cheque subject to federal unemployment tax, which stops after the first " +
      "$7,000 of an employee's wages for the year.",
    whereItIsUsed: "Adds into year-to-date FUTA wages, which drive Form 940.",
    whyItMatters:
      "FUTA is entirely the employer's cost - nothing comes out of the employee's pay - so an error " +
      "here never shows up as a payroll complaint. It shows up as a wrong Form 940.",
    theTrap:
      "The $7,000 base is per employee per YEAR, not per job and not per quarter. For most of " +
      "Greenway's staff it is exhausted within the first few months, after which this column is zero " +
      "for the rest of the year.",
    howToBeSure:
      "The year total for any one employee can never exceed $7,000. That ceiling has not moved since " +
      "1983, so unlike the Social Security base it is safe to recognise on sight.",
    authorityIds: [],
  },
  {
    field: "payroll_run_lines.wa_suta_wages_cents",
    whatItIs:
      "The part of this cheque subject to Washington state unemployment insurance, reported to the " +
      "Employment Security Department.",
    whereItIsUsed: "Adds into year-to-date SUTA wages, which drive the quarterly ESD 5208 report.",
    whyItMatters:
      "Washington's taxable wage base is separate from the federal one and much higher, and it is " +
      "re-set every year. Keeping it in its own column is what allows the two to disagree correctly.",
    theTrap:
      "Assuming the state base equals the federal $7,000. It does not, it is not close, and it moves " +
      "annually.",
    howToBeSure:
      "Greenway's ESD account is 000-073905-00-0. The taxable wage base for the year is stated on the " +
      "rate notice ESD sends each December.",
    authorityIds: [],
  },
  {
    field: "payroll_run_lines.wa_pfml_wages_cents",
    whatItIs:
      "The part of this cheque subject to Washington Paid Family and Medical Leave premiums.",
    whereItIsUsed: "Adds into year-to-date PFML wages, which drive the quarterly PFML report.",
    whyItMatters:
      "PFML is a shared premium - part employee, part employer - so this one wage figure feeds two " +
      "different money columns and both have to agree with it.",
    theTrap:
      "PFML uses the SAME annual cap as Social Security, but it is a different programme with its own " +
      "report and its own filing deadline. Sharing a cap is not the same as sharing a column.",
    howToBeSure:
      "Compare this column's year total against the Social Security wage figure. They will usually " +
      "match, and when they do not, that difference is a real fact about the employee's wage types, " +
      "not a bug to be flattened.",
    authorityIds: [],
  },
  {
    field: "payroll_run_lines.wa_cares_wages_cents",
    whatItIs: "The part of this cheque subject to the WA Cares Fund long-term care premium.",
    whereItIsUsed: "Adds into year-to-date WA Cares wages, reported alongside PFML.",
    whyItMatters:
      "WA Cares has NO wage cap at all, which makes it the odd one out among the state programmes " +
      "and the reason it cannot reuse the PFML column.",
    theTrap:
      "Capping it at the Social Security base because the neighbouring PFML figure is capped there. " +
      "WA Cares keeps accruing on every dollar for the whole year.",
    howToBeSure:
      "Over a full year this column's total should track gross wages, not the capped Social Security " +
      "figure. Employees with an approved exemption are the deliberate exception and carry zero.",
    authorityIds: [],
  },
  {
    field: "payroll_run_lines.lni_hundredth_hours",
    whatItIs:
      "Hours worked on this cheque, stored as hundredths of an hour. 4000 means 40.00 hours. This " +
      "column is not money.",
    whereItIsUsed:
      "Adds into year-to-date hours, which drive the Washington L&I quarterly report. L&I charges by " +
      "the HOUR WORKED, not by wages.",
    whyItMatters:
      "It is the only quantity in this whole table that is not currency, and the only one where a " +
      "units mistake produces a number a hundred times too large without looking obviously absurd.",
    theTrap:
      "Writing 40 instead of 4000, or storing 40.5 as a decimal. Both produce totals that survive " +
      "every other check in the system and land wrong on an L&I report.",
    howToBeSure:
      "Greenway's L&I account is 521,756-00, risk class 6403. Divide any figure here by 100 before " +
      "reading it as hours. A full-time fortnight is 8000, not 80.",
    authorityIds: [],
  },
  {
    field: "payroll_run_lines.federal_income_tax_cents",
    whatItIs:
      "Federal income tax withheld from this one cheque, based on the employee's Form W-4.",
    whereItIsUsed: "Adds into year-to-date federal withholding: box 2 of the W-2, line 3 of Form 941.",
    whyItMatters:
      "This is money already sent to the IRS on the employee's behalf. It is not an estimate and it " +
      "is not adjustable after the fact - it is a deposit that has been made.",
    theTrap:
      "Treating it as something that can be trued up at year end. It cannot. The employee's tax " +
      "return settles the difference; the employer's job is to report exactly what was withheld.",
    howToBeSure:
      "The sum of this column across all employees for a quarter must equal what was actually " +
      "deposited with the IRS for that quarter, and Form 941 will compare the two.",
    authorityIds: ["w2-941-reconciliation"],
  },
  {
    field: "payroll_run_lines.oasdi_employee_cents",
    whatItIs: "The employee's half of Social Security tax withheld from this cheque - 6.2%.",
    whereItIsUsed: "Adds into year-to-date Social Security tax: box 4 of the W-2, line 5a of Form 941.",
    whyItMatters:
      "It is one of the two figures the SSA cross-checks mechanically. Tax present with no wages " +
      "behind it is an automatic rejection.",
    theTrap:
      "Recording tax on a cheque where the wage column is zero because the ceiling was already " +
      "reached. If the wages stopped, the tax must stop in the same cheque.",
    howToBeSure:
      "Divide the year's tax by the year's Social Security wages. It should come to 6.2% within a " +
      "few cents of rounding. If it comes to more, the ceiling was missed somewhere.",
    authorityIds: ["ssa-rejection-conditions", "w2-box3-wage-base-ceiling"],
  },
  {
    field: "payroll_run_lines.medicare_employee_cents",
    whatItIs: "The employee's Medicare tax withheld from this cheque - 1.45%, with no ceiling.",
    whereItIsUsed: "Adds into year-to-date Medicare tax: box 6 of the W-2, line 5c of Form 941.",
    whyItMatters:
      "Same mechanical cross-check as Social Security: Medicare tax with zero Medicare wages behind " +
      "it is one of the SSA's listed rejection conditions.",
    theTrap:
      "Rolling the extra 0.9% Additional Medicare into this column for high earners. It belongs in " +
      "its own column because it has no employer match, and merging them makes the employer's share " +
      "impossible to derive.",
    howToBeSure:
      "This column divided by Medicare wages is 1.45% for every employee, at every income level, " +
      "with no exceptions. Anything above that is the Additional Medicare figure in the wrong place.",
    authorityIds: ["ssa-rejection-conditions", "w2-box5-no-medicare-limit"],
  },
  {
    field: "payroll_run_lines.addl_medicare_employee_cents",
    whatItIs:
      "The extra 0.9% Additional Medicare tax, withheld only after an employee passes $200,000 of " +
      "wages for the year.",
    whereItIsUsed: "Adds into the year-to-date figure and is reported within box 6 of the W-2.",
    whyItMatters:
      "THE EMPLOYER DOES NOT MATCH THIS. Every other payroll tax here either has an employer half or " +
      "is entirely the employer's. This one, alone, comes out of the employee and stops there.",
    theTrap:
      "Matching it. Booking an employer share against this figure overstates payroll expense and " +
      "overstates the 941 liability, and the error compounds every period the employee stays above " +
      "the threshold.",
    howToBeSure:
      "The $200,000 threshold is a flat figure that does not index and does not vary by filing " +
      "status for withholding purposes. At Greenway's wage levels this column is expected to be zero " +
      "for everyone - if it is ever not zero, that is worth understanding before the cheque is cut.",
    authorityIds: ["w2-additional-medicare-threshold"],
  },
  {
    field: "payroll_run_lines.wa_pfml_employee_cents",
    whatItIs: "The employee's share of the Washington PFML premium withheld from this cheque.",
    whereItIsUsed: "Reported quarterly to the Employment Security Department with the PFML return.",
    whyItMatters:
      "It is a deduction from the employee's pay, so it must appear on the pay stub and it must " +
      "reconcile to what is remitted. An unremitted employee deduction is money held that is not the " +
      "employer's.",
    theTrap:
      "The employee/employer split is set by statute and changes. Hardcoding last year's percentage " +
      "produces a shortfall that is only discovered when the quarterly return is assessed.",
    howToBeSure:
      "The premium rate and the split are published by ESD each year before January. Check them " +
      "against the rate notice, not against last year's payroll.",
    authorityIds: [],
  },
  {
    field: "payroll_run_lines.wa_cares_employee_cents",
    whatItIs:
      "The WA Cares long-term care premium withheld from this cheque. Entirely the employee's cost.",
    whereItIsUsed: "Reported quarterly to ESD alongside PFML.",
    whyItMatters:
      "There is no employer share, so this column has no employer twin - and that absence is " +
      "information, not an oversight.",
    theTrap:
      "Withholding from an employee who holds an approved exemption. The exemption is the employee's " +
      "to obtain and the employer's to honour once shown the approval letter; withholding anyway is " +
      "an over-deduction that has to be refunded.",
    howToBeSure:
      "Keep the exemption approval letter in the employee's file. If there is no letter, the premium " +
      "is withheld.",
    authorityIds: [],
  },
  {
    field: "payroll_run_lines.wa_lni_employee_cents",
    whatItIs:
      "The employee's share of the Washington L&I workers' compensation premium for this cheque, " +
      "charged per hour worked.",
    whereItIsUsed: "Reported on the L&I quarterly report and deducted on the pay stub.",
    whyItMatters:
      "L&I is the one payroll tax at Greenway computed from HOURS rather than wages, and part of it " +
      "is lawfully deducted from the employee. Both halves come from the same hours figure.",
    theTrap:
      "Deducting the employer's portion from the employee. Only the medical aid portion is the " +
      "employee's share; the accident fund portion is the employer's alone.",
    howToBeSure:
      "Greenway's rate notice for account 521,756-00, risk class 6403, states the employee and " +
      "employer portions separately, per hour.",
    authorityIds: [],
  },
  {
    field: "payroll_run_lines.oasdi_employer_cents",
    whatItIs: "Greenway's matching half of Social Security tax on this cheque - 6.2%.",
    whereItIsUsed: "Payroll tax expense in the general ledger, and line 5a of Form 941.",
    whyItMatters:
      "It is a real cost of employment that never appears on the employee's stub, so it is easy to " +
      "leave out of a labour-cost calculation and then wonder why payroll costs more than budgeted.",
    theTrap:
      "Forgetting that it stops when the employee's wages stop. The employer's match ends at exactly " +
      "the same ceiling, on exactly the same cheque.",
    howToBeSure:
      "This column should equal the employee column, cheque for cheque, all year. If they ever " +
      "diverge, one of the two missed the ceiling.",
    authorityIds: ["w2-box3-wage-base-ceiling"],
  },
  {
    field: "payroll_run_lines.medicare_employer_cents",
    whatItIs: "Greenway's matching Medicare tax on this cheque - 1.45%, no ceiling.",
    whereItIsUsed: "Payroll tax expense, and line 5c of Form 941.",
    whyItMatters:
      "Unlike Social Security this one never stops, so it is a cost that scales with total payroll " +
      "without limit.",
    theTrap:
      "Matching the Additional Medicare 0.9% as well. The match is 1.45% of Medicare wages and " +
      "nothing more, however much the employee earns.",
    howToBeSure:
      "This column should equal the employee's ordinary Medicare column exactly - never the employee " +
      "column plus the Additional Medicare column.",
    authorityIds: ["w2-additional-medicare-threshold", "w2-box5-no-medicare-limit"],
  },
  {
    field: "payroll_run_lines.futa_employer_cents",
    whatItIs:
      "Federal unemployment tax on this cheque. Entirely Greenway's cost, charged on the first " +
      "$7,000 of each employee's annual wages.",
    whereItIsUsed: "Payroll tax expense, and Form 940 once a year.",
    whyItMatters:
      "Nothing is withheld from anyone, so no employee will ever query it. The only thing that " +
      "catches an error is Form 940 itself.",
    theTrap:
      "The headline 6.0% rate is almost never what is paid. Employers who pay their state " +
      "unemployment tax on time receive a credit that brings it down to 0.6%, and applying the gross " +
      "rate overstates the expense tenfold.",
    howToBeSure:
      "Form 940 computes the credit explicitly. Whatever this column accrues during the year has to " +
      "be reconciled to that computation before the return is filed.",
    authorityIds: [],
  },
  {
    field: "payroll_run_lines.wa_suta_employer_cents",
    whatItIs:
      "Washington state unemployment insurance tax on this cheque. Entirely Greenway's cost.",
    whereItIsUsed: "Payroll tax expense, and the quarterly ESD 5208 report.",
    whyItMatters:
      "The rate is specific to Greenway - it is experience-rated, meaning it reflects the company's " +
      "own history of unemployment claims. It is not a rate that can be looked up in a general table.",
    theTrap:
      "Carrying last year's rate into the new year. ESD issues a fresh rate notice every December " +
      "and the change is often material.",
    howToBeSure:
      "The rate notice for account 000-073905-00-0 states both the rate and the taxable wage base " +
      "for the coming year. Both change; both must be entered before the first run of January.",
    authorityIds: [],
  },
  {
    field: "payroll_run_lines.wa_pfml_employer_cents",
    whatItIs: "Greenway's share of the Washington PFML premium on this cheque.",
    whereItIsUsed: "Payroll tax expense, and the quarterly PFML report.",
    whyItMatters:
      "Small employers can be exempt from the employer share while still being required to withhold " +
      "and remit the EMPLOYEE share. The two are separate obligations.",
    theTrap:
      "Concluding that an employer-share exemption means nothing is owed. The employee's premium is " +
      "still withheld and still remitted, and failing to do so is withholding that was never sent on.",
    howToBeSure:
      "The employer-share threshold is stated in ESD's annual PFML guidance and is based on average " +
      "headcount. Check headcount against the threshold each year, not once.",
    authorityIds: [],
  },
  {
    field: "payroll_run_lines.wa_lni_employer_cents",
    whatItIs:
      "Greenway's share of the L&I workers' compensation premium for this cheque, charged per hour " +
      "worked.",
    whereItIsUsed: "Payroll tax expense, and the L&I quarterly report.",
    whyItMatters:
      "L&I premiums are the reason hours are stored at all. Get the hours wrong and both the " +
      "employee and employer sides of this premium are wrong together, in the same direction, which " +
      "makes the error invisible to any check that compares the two.",
    theTrap:
      "Reporting hours PAID rather than hours WORKED. Paid sick leave, holiday pay and vacation are " +
      "paid hours that were not worked, and L&I is assessed on hours worked.",
    howToBeSure:
      "Greenway's risk class 6403 rate notice states the hourly premium. Reconcile the hours behind " +
      "this column against the timesheet's worked hours, not against the hours on the cheque.",
    authorityIds: [],
  },

  /* ── payroll_ytd_accumulators: what the YEAR has done ────────────────── */
  {
    field: "payroll_ytd_accumulators.tax_year",
    whatItIs:
      "The calendar year these running totals belong to. Every ceiling in payroll - the Social " +
      "Security wage base, the $7,000 FUTA base, the $200,000 Additional Medicare threshold - is " +
      "defined on the calendar year and resets on 1 January.",
    whereItIsUsed:
      "Keys the accumulator row. Determines which W-2 the totals eventually become and which four " +
      "941s they must add up to.",
    whyItMatters:
      "Wages belong to the year they are PAID, not the year they are earned. A pay period running " +
      "21 December to 3 January is reported entirely in the later year, because that is when the " +
      "money changed hands and that is how the IRS builds the W-2.",
    theTrap:
      "Keying off the pay period's END date instead of the PAY date. It is right for fifty weeks of " +
      "the year and wrong for the one that matters, and the error moves a whole fortnight of wages " +
      "onto the wrong W-2 for two employees' worth of years at once.",
    howToBeSure:
      "Look at the cheque date, never the timesheet. Greenway pays biweekly on Fridays, so the " +
      "boundary case is whichever Friday in early January pays for hours worked in December.",
    authorityIds: ["w2-worked-example-199750"],
  },
  {
    field: "payroll_ytd_accumulators.oasdi_wages_cents",
    whatItIs:
      "Social Security wages for this employee for the whole year so far. This is the number that " +
      "answers 'have they hit the ceiling yet'.",
    whereItIsUsed:
      "Read before every pay run to tell the withholding engine where it is. Becomes box 3 of the W-2.",
    whyItMatters:
      "This single figure is the entire reason the table exists. The withholding engine has always " +
      "known how to stop at the wage base; until this column existed, nothing could tell it how far " +
      "along the employee already was.",
    theTrap:
      "Letting it exceed the annual wage base. The IRS pre-filing checklist names this explicitly, " +
      "and the SSA rejects the wage report when it happens.",
    howToBeSure:
      "For 2026 the ceiling is $184,500 - so this column can reach 18,450,000 cents and no further. " +
      "The base is indexed and moves most years, so confirm the current figure from the IRS " +
      "instructions rather than from memory.",
    authorityIds: ["w2-box3-wage-base-ceiling", "w2-prefiling-checklist"],
  },
  {
    field: "payroll_ytd_accumulators.medicare_wages_cents",
    whatItIs: "Medicare wages for this employee for the whole year so far. Uncapped.",
    whereItIsUsed: "Becomes box 5 of the W-2 and is cross-footed against the four 941s.",
    whyItMatters:
      "The IRS's own worked example is the clearest statement of the relationship: an employee paid " +
      "$199,750 in 2026 shows box 3 of 184500.00 and box 5 of 199750.00. Two different numbers from " +
      "one salary, and both are right.",
    theTrap:
      "Expecting boxes 3 and 5 to agree. For anyone below the wage base they do agree, which teaches " +
      "the wrong lesson right up until the first employee crosses it.",
    howToBeSure:
      "This figure is greater than or equal to the Social Security figure, always. The database " +
      "refuses to store a row where it is not.",
    authorityIds: ["w2-box5-no-medicare-limit", "w2-worked-example-199750", "ssa-rejection-conditions"],
  },
  {
    field: "payroll_ytd_accumulators.futa_wages_cents",
    whatItIs: "FUTA-taxable wages for the year so far, which stop at $7,000 per employee.",
    whereItIsUsed: "Drives Form 940, filed once a year in January.",
    whyItMatters:
      "For most Greenway employees this figure reaches its ceiling early in the year and then stays " +
      "flat. A column that stops moving is easy to mistake for a column that stopped working.",
    theTrap:
      "Restarting it for an employee who leaves and is rehired in the same year. The $7,000 is per " +
      "employee per year, not per period of employment.",
    howToBeSure:
      "The database refuses any value above 700,000 cents. If a rehire looks like it is accruing " +
      "FUTA again, the second employment record is the problem, not the ceiling.",
    authorityIds: [],
  },
  {
    field: "payroll_ytd_accumulators.wa_suta_wages_cents",
    whatItIs: "Washington unemployment-taxable wages for the year so far.",
    whereItIsUsed:
      "Drives the quarterly ESD 5208 report filed with the Employment Security Department, and is " +
      "the figure Form 940 asks for when it computes the credit against federal unemployment tax.",
    whyItMatters:
      "The state ceiling is far higher than the federal one, so this column keeps moving long after " +
      "the FUTA column has stopped. Seeing them diverge is normal.",
    theTrap:
      "Reporting the year-to-date figure on a quarterly return. ESD wants the quarter, not the year. " +
      "This column is the year; the quarter is derived by subtracting the prior quarter-end.",
    howToBeSure:
      "The four quarterly figures reported to ESD must sum to this column at 31 December.",
    authorityIds: [],
  },
  {
    field: "payroll_ytd_accumulators.wa_pfml_wages_cents",
    whatItIs:
      "Wages covered by Washington Paid Family and Medical Leave for the year so far, capped at the " +
      "same annual figure as Social Security.",
    whereItIsUsed: "Drives the quarterly PFML report and the premium calculation.",
    whyItMatters:
      "PFML shares the Social Security cap, so this column and the Social Security column usually " +
      "stop at the same point in the year - a coincidence of the law, not a shared calculation.",
    theTrap:
      "Deriving one from the other. They are capped alike but their wage bases include different " +
      "pay types, so copying one into the other propagates any difference as an error.",
    howToBeSure:
      "Compare against the Social Security column at year end. A difference should be explainable by " +
      "a specific pay type, not shrugged at.",
    authorityIds: [],
  },
  {
    field: "payroll_ytd_accumulators.wa_cares_wages_cents",
    whatItIs: "WA Cares-covered wages for the year so far. No cap.",
    whereItIsUsed: "Drives the WA Cares premium reported quarterly alongside PFML.",
    whyItMatters:
      "It is the only state wage figure with no ceiling, which makes it the closest thing here to " +
      "total gross wages and therefore a useful sanity check on everything else.",
    theTrap:
      "Expecting it to stop where PFML stops. It does not stop.",
    howToBeSure:
      "Over a full year this should approximate total gross pay for any employee without an " +
      "approved exemption.",
    authorityIds: [],
  },
  {
    field: "payroll_ytd_accumulators.lni_hundredth_hours",
    whatItIs:
      "Total hours worked this year, in hundredths of an hour. 208000 means 2,080.00 hours, which " +
      "is a standard full-time year.",
    whereItIsUsed: "Drives the L&I quarterly report, which is assessed per hour worked.",
    whyItMatters:
      "It is the only non-money total in the table. Every check that looks for a plausible dollar " +
      "figure passes over this column without examining it.",
    theTrap:
      "Reading it as hours without dividing by 100, and concluding an employee worked 208,000 hours.",
    howToBeSure:
      "A full-time year is roughly 208,000 in this column. Anything an order of magnitude away from " +
      "that for a full-time employee is a units error, not overtime.",
    authorityIds: [],
  },
  {
    field: "payroll_ytd_accumulators.oasdi_employee_cents",
    whatItIs: "Social Security tax withheld from this employee for the whole year so far.",
    whereItIsUsed: "Becomes box 4 of the W-2 and is cross-footed against the four 941s.",
    whyItMatters:
      "It is the figure an employee checks against their own records, and the figure the SSA checks " +
      "against the wages beside it.",
    theTrap:
      "Tax accumulating past the point where wages stopped. If the wage column has flattened at the " +
      "ceiling and this one is still climbing, the ceiling was applied to one and not the other.",
    howToBeSure:
      "Divide by the Social Security wage column. It comes to 6.2%, within rounding, or something is " +
      "wrong. For 2026 the maximum possible value is 6.2% of $184,500.",
    authorityIds: ["ssa-rejection-conditions", "w2-prefiling-checklist"],
  },
  {
    field: "payroll_ytd_accumulators.medicare_employee_cents",
    whatItIs: "Ordinary Medicare tax withheld for the year so far, at 1.45%.",
    whereItIsUsed: "Combines with the Additional Medicare figure to form box 6 of the W-2.",
    whyItMatters:
      "Box 6 is a SUM of two separately-tracked taxes, and only one of them has an employer match. " +
      "Keeping them apart here is what makes the employer's share derivable at all.",
    theTrap:
      "Reporting this alone as box 6 for a high earner, understating the employee's withholding by " +
      "the Additional Medicare amount.",
    howToBeSure:
      "This column divided by Medicare wages is 1.45% for everyone, always. Box 6 is this column " +
      "plus the Additional Medicare column.",
    authorityIds: ["ssa-rejection-conditions", "w2-additional-medicare-threshold"],
  },
  {
    field: "payroll_ytd_accumulators.addl_medicare_employee_cents",
    whatItIs:
      "Additional Medicare tax withheld for the year so far - 0.9% on wages above $200,000, with no " +
      "employer match.",
    whereItIsUsed: "Included within box 6 of the W-2 and reported on Form 941.",
    whyItMatters:
      "This is a running total whose very existence depends on a running total: the 0.9% starts the " +
      "moment YEAR-TO-DATE wages cross $200,000, which is a fact no single cheque can know by itself.",
    theTrap:
      "Booking an employer match against it. There is none. The employer's Medicare cost is 1.45% of " +
      "Medicare wages and stops there, whatever the employee earns.",
    howToBeSure:
      "At Greenway's wage levels this is expected to be zero for every employee. If it is not zero, " +
      "confirm the employee genuinely passed $200,000 of year-to-date wages before accepting it.",
    authorityIds: ["w2-additional-medicare-threshold"],
  },
  {
    field: "payroll_ytd_accumulators.federal_income_tax_cents",
    whatItIs: "Federal income tax withheld from this employee for the whole year so far.",
    whereItIsUsed: "Becomes box 2 of the W-2 and must agree with the four 941s added together.",
    whyItMatters:
      "The IRS compares the W-2 totals filed with the SSA against the 941s filed during the year. A " +
      "mismatch generates a notice regardless of whether the underlying money was correct.",
    theTrap:
      "Correcting a withholding error by adjusting the year-to-date figure directly. That fixes the " +
      "W-2 and breaks its agreement with the 941 that was already filed.",
    howToBeSure:
      "Box 2 across all employees must equal the sum of line 3 from the four quarterly 941s. If it " +
      "does not, the fix is an amended 941, not an edited total.",
    authorityIds: ["w2-941-reconciliation", "w2-prefiling-checklist"],
  },
  {
    field: "payroll_ytd_accumulators.last_run_id",
    whatItIs:
      "Which pay run last added to these totals. Empty before the first run of the year.",
    whereItIsUsed:
      "The double-post guard. Before adding a run, the engine checks whether this is already that run.",
    whyItMatters:
      "A retried request, a double-clicked button or a resumed background job all send the same run " +
      "twice. Without this, the employee's whole year silently doubles - and doubled payroll totals " +
      "do not look like an error, they look like money.",
    theTrap:
      "Treating it as an audit trail. It records only the MOST RECENT run, not the history. The " +
      "history lives in the pay run lines, which is what a rebuild reads.",
    howToBeSure:
      "If a pay run appears to have posted but the totals did not move, check whether this already " +
      "names it. The engine will have refused, and said so, rather than adding twice.",
    authorityIds: [],
  },
  {
    field: "payroll_ytd_accumulators.last_recomputed_at",
    whatItIs:
      "When these totals were last rebuilt from the underlying pay run lines, rather than simply " +
      "added to.",
    whereItIsUsed:
      "The reconciliation screen, and any investigation into whether a stored total can be trusted.",
    whyItMatters:
      "A running total is a CLAIM about rows that live somewhere else. Without a timestamp saying " +
      "when that claim was last verified against those rows, it is an assertion with no provenance.",
    theTrap:
      "Assuming an old date means the totals are wrong. It means they are unverified, which is a " +
      "different and more useful thing to know.",
    howToBeSure:
      "Run the reconciliation before any quarterly filing. It reports every figure that disagrees, " +
      "with both numbers and the difference, and it never repairs anything silently.",
    authorityIds: ["w2-941-reconciliation"],
  },
];

/** The field names this mentor teaches. Used by the coverage gate. */
export function taughtFieldNames(): readonly string[] {
  return YTD_FIELD_LESSONS.map((l) => l.field);
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 * SCREEN LESSONS - the ideas that belong to no single field
 * ═══════════════════════════════════════════════════════════════════════════ */

export type ScreenLesson = {
  readonly topic: string;
  readonly plainEnglish: string;
  readonly whyItMatters: string;
  readonly authorityIds: readonly string[];
};

export const YTD_SCREEN_LESSONS: readonly ScreenLesson[] = [
  {
    topic: "The one idea this whole table exists to protect: a ceiling you cannot see is a ceiling you cannot stop at",
    plainEnglish:
      "Social Security tax is charged on the first $184,500 an employee earns in 2026 and on nothing " +
      "above that. Medicare is charged on every dollar with no ceiling at all. To apply the first " +
      "rule, payroll has to know what the employee has ALREADY been paid this year - and a single " +
      "pay run, looked at on its own, has no way of knowing that.",
    whyItMatters:
      "The withholding engine has always known how to stop at the wage base. It could not, because " +
      "nothing told it where the employee stood. Before this table, every run started the year over " +
      "from zero. For a Greenway employee that produces the right answer all year and would keep " +
      "producing it - which is exactly why the gap survived so long unnoticed - but the same code " +
      "path is the one that will be wrong the first time a shareholder-employee salary or a bonus " +
      "pushes somebody past the base.",
    authorityIds: ["w2-box3-wage-base-ceiling", "w2-box5-no-medicare-limit"],
  },
  {
    topic: "One salary, two different wage figures on the same W-2, and both are right",
    plainEnglish:
      "The IRS gives the worked example directly: an employee paid $199,750 in 2026 has box 3 " +
      "(social security wages) of 184500.00 and box 5 (Medicare wages and tips) of 199750.00. Box 3 " +
      "stopped at the ceiling. Box 5 never stops.",
    whyItMatters:
      "For every employee below the wage base those two boxes are identical, which quietly teaches " +
      "everyone that they should match. The first time they do not, the instinct is to 'fix' it. " +
      "That instinct produces the exact condition the SSA rejects. This example is run as a test " +
      "against the engine, accumulating over 26 biweekly periods, so the software cannot forget it.",
    authorityIds: ["w2-worked-example-199750", "w2-box3-wage-base-ceiling", "w2-box5-no-medicare-limit"],
  },
  {
    topic: "The Social Security Administration rejects wage reports mechanically, before a human reads them",
    plainEnglish:
      "The SSA lists conditions that cause a Form W-2 to be rejected outright: Medicare wages and " +
      "tips less than the sum of social security wages and social security tips; social security tax " +
      "greater than zero when social security wages and tips are zero; and Medicare tax greater than " +
      "zero when Medicare wages and tips are zero.",
    whyItMatters:
      "These are not judgement calls, they are arithmetic - which means they can be enforced the " +
      "moment a figure is written rather than discovered in January when the whole wage report comes " +
      "back. All three are database constraints on the accumulator table and all three are also " +
      "checked in the engine before a run is applied, so a bad figure is refused at the point it is " +
      "created, with an explanation, instead of being stored and rejected months later by somebody " +
      "who cannot see what caused it.",
    authorityIds: ["ssa-rejection-conditions"],
  },
  {
    topic: "Wages belong to the year they are PAID, not the year they were earned",
    plainEnglish:
      "A pay period running 21 December to 3 January is reported entirely in the later year, because " +
      "the W-2 is built on when the money changed hands. The hours were worked in December; the " +
      "wages are January's.",
    whyItMatters:
      "Greenway pays biweekly on Fridays, so one pay period every year straddles New Year. Keying " +
      "the accumulator off the period end date instead of the pay date is right for twenty-five " +
      "periods and wrong for the twenty-sixth, and the error moves a full fortnight of wages between " +
      "two tax years for every employee at once. The engine has a named function for this single " +
      "decision - `taxYearForPayDate` - precisely so the choice is visible rather than buried in a " +
      "date expression.",
    authorityIds: ["w2-worked-example-199750"],
  },
  {
    topic: "Additional Medicare is the employee's alone - there is no employer match",
    plainEnglish:
      "Once an employee's wages pass $200,000 for the year, an extra 0.9% comes out of their pay. " +
      "Every other payroll tax here is either matched by the employer or paid entirely by the " +
      "employer. This one is not matched at all.",
    whyItMatters:
      "Matching it overstates payroll expense and overstates the 941 liability, and the overstatement " +
      "grows with every period the employee stays above the threshold. It is also a threshold that " +
      "only a running total can detect: no single cheque knows whether the year has passed $200,000.",
    authorityIds: ["w2-additional-medicare-threshold"],
  },
  {
    topic: "Posting a run twice, and voiding one that was never unwound",
    plainEnglish:
      "The two ways a running total goes wrong without anybody typing a wrong number. A pay run " +
      "posted twice doubles the year. A pay run voided without subtracting it back out leaves the " +
      "employee permanently over-accumulated.",
    whyItMatters:
      "Neither produces anything that looks like an error. Doubled payroll totals look like money, " +
      "and an over-accumulated employee just appears to have earned more. The engine keys every " +
      "addition by pay run id and refuses a run it has already seen; voiding runs the exact inverse " +
      "of applying, and the two are tested together as a round trip that must return to the starting " +
      "figures exactly.",
    authorityIds: [],
  },
  {
    topic: "A stored total is a claim about rows somewhere else, so it is checked - and never silently repaired",
    plainEnglish:
      "The accumulator holds sums. The pay run lines hold the detail those sums came from. " +
      "Reconciliation recomputes the sums from the lines and reports every figure that disagrees, " +
      "with the stored number, the recomputed number and the difference.",
    whyItMatters:
      "It deliberately does not fix anything. A total that quietly corrects itself hides the defect " +
      "that caused the drift, and the next occurrence is just as invisible as the first. Detection " +
      "is not explanation - so the rebuild is a separate, deliberate act with its own call site, " +
      "taken after somebody has understood why the two disagreed.",
    authorityIds: ["w2-941-reconciliation"],
  },
  {
    topic: "The Social Security wage base moves almost every year, and the software does not guess it",
    plainEnglish:
      "$184,500 is the 2026 figure. It is indexed to average wages and changes most Januaries. The " +
      "engine takes the wage base as an argument rather than assuming one, and the 2026 value is " +
      "offered only as the default for the year its authorities were verified against.",
    whyItMatters:
      "A ceiling hardcoded into a database constraint becomes wrong on 1 January and stays wrong " +
      "until somebody notices a rejected wage report. The table therefore enforces what is PERMANENT " +
      "- that Medicare wages are never below Social Security wages, that no figure is negative, that " +
      "no employee-year reaches a hundred million dollars - and leaves the year-specific ceiling to " +
      "the engine, where the year is known and the authority for the figure is cited.",
    authorityIds: ["w2-box3-wage-base-ceiling", "w2-prefiling-checklist"],
  },
  {
    topic: "Why the old single 'taxes' column could never have produced a W-2 or a 941",
    plainEnglish:
      "Until this slice, a pay run line stored one lump figure for all taxes together. That is enough " +
      "to work out net pay and nothing else. A W-2 needs Social Security wages, Medicare wages, " +
      "federal withholding, Social Security tax and Medicare tax as five separate numbers, and a 941 " +
      "needs them split again between the employee's half and the employer's.",
    whyItMatters:
      "The lump column was not removed - it is still written, so nothing that reads it broke. Twenty " +
      "new columns were added beside it, each nullable with no default, because a default of zero " +
      "would have invented a fact about every historical row: it would assert that those cheques " +
      "withheld no Social Security, when the truth is that nobody recorded it separately. Empty means " +
      "unknown. Zero means measured. They are not the same and the difference is the whole reason " +
      "year-end reconciliation can be trusted.",
    authorityIds: ["w2-941-reconciliation"],
  },
];

/* ═══════════════════════════════════════════════════════════════════════════ *
 * REFUSAL LESSONS - what a refusal means, in Michael's language
 * ═══════════════════════════════════════════════════════════════════════════ */

export type RefusalLesson = {
  readonly code: YtdRefusalCode;
  /** One line, for a banner. */
  readonly headline: string;
  /** Why refusing is better than computing anyway. */
  readonly whyWeStop: string;
  /** What Michael actually does about it. */
  readonly whatToDo: string;
};

/**
 * Every refusal code the engine can emit is explained here.
 *
 * The gate in `ytd-mentor-gates.ts` parses the engine's own union type FROM
 * DISK and fails if a code ships untaught - or if a lesson outlives the code it
 * explains, which is the more dangerous of the two because the count looks
 * right while a live code goes unexplained.
 */
export const YTD_REFUSAL_LESSONS: readonly RefusalLesson[] = [
  {
    code: "YTD_RUN_ALREADY_APPLIED",
    headline: "This pay run has already been added to that employee's year. Nothing was changed.",
    whyWeStop:
      "Adding it twice would double the employee's year-to-date wages and taxes, and the result " +
      "would look like ordinary money rather than an error - no total would be negative, nothing " +
      "would fail a check, and the first sign of trouble would be a W-2 that says the employee " +
      "earned twice what they did.",
    whatToDo:
      "Nothing, usually. This almost always means a button was clicked twice or a request was " +
      "retried, and the first attempt succeeded. Check the employee's year-to-date figures against " +
      "the pay run - if the run is already in there, the work is done.",
  },
  {
    code: "YTD_NEGATIVE_INPUT",
    headline: "A pay run is trying to contribute a negative amount of wages or tax.",
    whyWeStop:
      "A negative contribution is not a correction, it is a symptom. Accepting it would let a running " +
      "total go down for a reason nothing recorded, and there would be no way afterwards to tell a " +
      "deliberate reversal from a calculation that produced a negative number by accident.",
    whatToDo:
      "If the intention is to reverse a pay run, VOID it - that unwinds exactly the figures that were " +
      "added, through the same path that added them, and leaves a record of both. If nothing is being " +
      "reversed, the negative figure came from the calculation upstream and that is what needs looking " +
      "at.",
  },
  {
    code: "YTD_NON_INTEGER_INPUT",
    headline: "A figure arrived that is not a whole number of cents.",
    whyWeStop:
      "Every amount in payroll is stored as whole cents, and hours as whole hundredths of an hour. A " +
      "fraction arriving here means a rounding decision was skipped somewhere upstream. Rounding it " +
      "quietly at this point would hide where that happened, and the difference - pennies at first - " +
      "compounds across 26 pay periods and every employee until the year does not reconcile and " +
      "nobody can say why.",
    whatToDo:
      "The refusal names the field. Follow that figure back to whatever produced it: a percentage " +
      "applied without rounding, or a dollar amount that was never converted to cents. This is also " +
      "the refusal used when a pay date is not a real YYYY-MM-DD date.",
  },
  {
    code: "YTD_YEAR_MISMATCH",
    headline: "This pay run belongs to a different tax year than the totals it is being added to.",
    whyWeStop:
      "Wages belong to the year they are PAID. Adding a January cheque to December's totals would " +
      "overstate one W-2 and understate the next, and both would be internally consistent - so " +
      "neither would ever look wrong on its own.",
    whatToDo:
      "Check the pay DATE on the run, not the pay period end date. The period running late December " +
      "into early January is paid in January and belongs entirely to January's year. If the pay date " +
      "is right, the run needs to be posted against the new year's totals, which the system will " +
      "create on first use.",
  },
  {
    code: "YTD_EMPLOYEE_MISMATCH",
    headline: "These totals belong to a different employee than the pay run line does.",
    whyWeStop:
      "Crediting one employee's wages to another's year produces two wrong W-2s and no error message " +
      "anywhere. Both employees' figures stay positive, both stay internally consistent, and both are " +
      "wrong. There is no downstream check that would ever catch it.",
    whatToDo:
      "This is a wiring problem rather than a data-entry one - something looked up the wrong " +
      "accumulator row. Do not adjust the totals to compensate. Report it, because the same fault " +
      "will have applied to every employee in the run.",
  },
  {
    code: "YTD_WOULD_GO_NEGATIVE",
    headline: "Voiding this pay run would drive a year-to-date total below zero.",
    whyWeStop:
      "It means the stored totals and this pay run disagree about what was actually posted - either " +
      "the run was never added, or the totals were changed by something else in between. Clamping at " +
      "zero would produce a tidy-looking figure that is wrong, and would destroy the evidence needed " +
      "to work out what happened.",
    whatToDo:
      "The refusal names which figure would go negative and by how much. Rebuild the employee's " +
      "totals from the pay run lines first - that recomputes them from the detail rather than " +
      "trusting the stored sums - then void the run. The rebuild is deliberately a separate step so " +
      "that nobody repairs a total without first seeing what was wrong with it.",
  },
  {
    code: "YTD_MEDICARE_BELOW_OASDI",
    headline: "This pay run reports less Medicare wages than Social Security wages.",
    whyWeStop:
      "That combination cannot be true. Social Security stops at the annual wage base and Medicare " +
      "never stops, so Medicare wages are always the larger of the two. It is also the first " +
      "condition the SSA lists for rejecting a Form W-2 outright - so storing it would guarantee a " +
      "rejected wage report months from now, rather than a clear message today.",
    whatToDo:
      "Look at how the two wage figures were calculated for this run. The usual cause is the wage " +
      "base ceiling being applied to Medicare as well as to Social Security. Medicare has no ceiling.",
  },
];

/* ═══════════════════════════════════════════════════════════════════════════ *
 * YEAR-END CHECKS - the IRS pre-filing checklist, as things this table answers
 * ═══════════════════════════════════════════════════════════════════════════ */

export type YtdYearEndCheckKey =
  | "reconcile-to-lines"
  | "wage-base-not-exceeded"
  | "medicare-not-below-social-security"
  | "no-tax-without-wages"
  | "additional-medicare-unmatched"
  | "cross-foot-to-941s";

export type YtdYearEndCheck = {
  readonly key: YtdYearEndCheckKey;
  readonly label: string;
  /** What is actually compared, in plain English. */
  readonly theCheck: string;
  /** What it means when it fails, and what to do. */
  readonly ifItFails: string;
  /** Checks that must pass before this one is meaningful. */
  readonly requires: readonly YtdYearEndCheckKey[];
  /** Whether a failure here should stop a W-2 being produced. */
  readonly blocksFiling: boolean;
  readonly authorityIds: readonly string[];
};

/**
 * ORDERED, AND THE ORDER IS THE POINT.
 *
 * Every check after the first is only meaningful once the totals have been
 * proven to match the lines beneath them. Checking a wage base against a figure
 * that has drifted tells you about the drift, not about the wage base.
 */
export const YTD_YEAR_END_CHECKS: readonly YtdYearEndCheck[] = [
  {
    key: "reconcile-to-lines",
    label: "The year-to-date totals agree with the pay run lines they came from",
    theCheck:
      "Every figure on the accumulator is recomputed by adding up the pay run lines for that " +
      "employee and year, and the two are compared field by field.",
    ifItFails:
      "The report names each figure that disagrees, with the stored number, the recomputed number " +
      "and the difference. Understand the difference before rebuilding - a rebuild makes the numbers " +
      "agree but destroys the only evidence of what went wrong.",
    requires: [],
    blocksFiling: true,
    authorityIds: ["w2-941-reconciliation"],
  },
  {
    key: "wage-base-not-exceeded",
    label: "No employee's Social Security wages exceed the annual wage base",
    theCheck:
      "Each employee's year-to-date Social Security wages are compared against the wage base for " +
      "that year - $184,500 for 2026.",
    ifItFails:
      "The ceiling was missed on at least one pay run. Both the employee's withholding and the " +
      "employer's match will be overstated, and the over-withheld amount has to be refunded to the " +
      "employee before the W-2 is issued.",
    requires: ["reconcile-to-lines"],
    blocksFiling: true,
    authorityIds: ["w2-prefiling-checklist", "w2-box3-wage-base-ceiling"],
  },
  {
    key: "medicare-not-below-social-security",
    label: "No employee's Medicare wages are below their Social Security wages",
    theCheck:
      "Box 5 is compared against box 3 for every employee. Medicare must be greater than or equal.",
    ifItFails:
      "The SSA will reject the wage report. The usual cause is the wage base ceiling having been " +
      "applied to Medicare, which has no ceiling.",
    requires: ["reconcile-to-lines"],
    blocksFiling: true,
    authorityIds: ["ssa-rejection-conditions", "w2-box5-no-medicare-limit"],
  },
  {
    key: "no-tax-without-wages",
    label: "No employee shows Social Security or Medicare tax with no wages behind it",
    theCheck:
      "For every employee: if Social Security tax is above zero, Social Security wages must be too, " +
      "and the same pairing for Medicare.",
    ifItFails:
      "Another automatic SSA rejection. It usually means a manual adjustment was made to a tax " +
      "figure without the corresponding wage figure.",
    requires: ["reconcile-to-lines"],
    blocksFiling: true,
    authorityIds: ["ssa-rejection-conditions"],
  },
  {
    key: "additional-medicare-unmatched",
    label: "No employer match was booked against Additional Medicare tax",
    theCheck:
      "The employer's Medicare cost is compared against 1.45% of Medicare wages. It must not include " +
      "any part of the 0.9% Additional Medicare withheld from employees.",
    ifItFails:
      "Payroll tax expense and the 941 liability are both overstated. At Greenway's wage levels the " +
      "Additional Medicare figure is expected to be zero for everyone, so any amount here deserves " +
      "confirming before it is accepted.",
    requires: ["reconcile-to-lines"],
    blocksFiling: false,
    authorityIds: ["w2-additional-medicare-threshold"],
  },
  {
    key: "cross-foot-to-941s",
    label: "The W-2 totals agree with the four quarterly 941s added together",
    theCheck:
      "Total federal withholding, Social Security wages and tax, and Medicare wages and tax across " +
      "all employees are compared against the sum of the four Forms 941 filed during the year.",
    ifItFails:
      "The IRS compares these itself and issues a notice when they disagree, whether or not the " +
      "underlying money was right. Do not adjust the W-2 totals to force agreement - if a 941 was " +
      "wrong, it is amended.",
    requires: [
      "reconcile-to-lines",
      "wage-base-not-exceeded",
      "medicare-not-below-social-security",
      "no-tax-without-wages",
    ],
    blocksFiling: true,
    authorityIds: ["w2-941-reconciliation", "w2-prefiling-checklist"],
  },
];
