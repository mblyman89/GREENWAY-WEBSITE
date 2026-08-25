/**
 * src/lib/payroll/form-box-lessons-wa.ts
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE WASHINGTON QUARTERLY RETURNS — ESD, PAID LEAVE, WA CARES, L&I
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * These are the forms Michael said he cares about most:
 *
 *   "the majority of the forms I really am interested in are the payroll forms
 *   like 940 941 l&I esd pfml wa cares etc."
 *
 * FOUR RETURNS, THREE AGENCIES, ONE QUARTER. Every three months Greenway files:
 *
 *   ESD 5208A       unemployment tax        Employment Security Department
 *   ESD 5208B       wage detail (no money)  Employment Security Department
 *   Paid Leave +    PFML and WA Cares       Employment Security Department
 *     WA Cares        premiums                (same portal, different money)
 *   L&I quarterly   workers' compensation   Labor & Industries
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE IDEA THAT UNLOCKS ALL FOUR: WHOSE MONEY IS IT?
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Every box on these four returns is one of three things, and Washington law
 * treats them as fundamentally different:
 *
 *   GREENWAY'S OWN MONEY, and taking it from a worker is a CRIME.
 *     Unemployment: RCW 50.24.010 - "Any deduction in violation of the
 *     provisions of this section shall be unlawful."
 *     Workers' comp: RCW 51.16.140(2) - the attempt "shall be a gross
 *     misdemeanor."
 *
 *   YOUR EMPLOYEES' MONEY, which you hold as their AGENT.
 *     Paid Leave: RCW 50A.10.030(7)(b) - "the employer shall act as the agent
 *     of the employees."
 *
 *   SHARED, where THE STATE fixes the split and Michael does not choose it.
 *     L&I: RCW 51.16.140(1) permits deducting "one-half of the amount he or she
 *     is required to pay, for medical benefits" - one half of the MEDICAL AID
 *     portion, which is NOT one half of the premium.
 *
 * Get this wrong in the employer's favour and it is theft from wages. Get it
 * wrong in the employee's favour and Greenway has quietly absorbed a cost it
 * could lawfully have shared. The screen colours every box by this distinction
 * so that reading it teaches the law.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE L&I RETURN IS CHARGED ON HOURS AND NOTHING ELSE IS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Unemployment, Paid Leave and WA Cares are all percentages of WAGES. Workers'
 * compensation is a rate per HOUR WORKED. That is not an administrative quirk,
 * it follows from what the insurance covers: the risk of injury does not rise
 * because a worker is well paid, it rises with time spent exposed to the hazard.
 * Greenway's risk class 6403 is retail, and every hour in it is charged the same
 * whether the person earning it is on minimum wage or is the owner.
 *
 * The practical consequence, which matters for Michael: overtime is expensive
 * twice. The wage is 1.5x AND the hour still counts as an hour of L&I exposure.
 * Meanwhile a raise costs nothing in workers' compensation at all.
 *
 * Every quote below is VERBATIM from the mirrored statutes under
 * docs/authorities/state-wa/. A gate reads those files and confirms each quote
 * is present character for character (rules 24 and 35).
 */

import type { BoxLesson } from "./form-box-core";

/**
 * WAC 192-310-010, mirrored in books-56.
 *
 * Until this slice the rule was cited by four authority records with no held
 * text behind it, so no gate could confirm those quotes were accurate. All four
 * were checked against the newly mirrored file and all four verify byte for
 * byte — but that was luck rather than proof until the file existed, which is
 * the whole point of holding the text.
 */
export const WAC_192_310_010_PATH = "docs/authorities/state-wa/wac-192-310-010.txt";
export const WAC_192_310_010_URL =
  "https://app.leg.wa.gov/WAC/default.aspx?cite=192-310-010";

export const RCW_50_24_010_PATH = "docs/authorities/state-wa/rcw-50.24.010.txt";
export const RCW_50A_10_030_PATH = "docs/authorities/state-wa/rcw-50A.10.030.txt";
export const RCW_51_16_140_PATH = "docs/authorities/state-wa/rcw-51.16.140.txt";

export const RCW_50_24_010_URL = "https://app.leg.wa.gov/rcw/default.aspx?cite=50.24.010";
export const RCW_50A_10_030_URL = "https://app.leg.wa.gov/rcw/default.aspx?cite=50A.10.030";
export const RCW_51_16_140_URL = "https://app.leg.wa.gov/rcw/default.aspx?cite=51.16.140";

/**
 * Greenway's L&I risk class, from Michael's own account details.
 *
 * Held here as teaching text only. The premium engine reads the rate from the
 * dated registry; this constant exists so the lesson can name the class Michael
 * will see on his own statement and recognise it.
 */
export const GREENWAY_LNI_RISK_CLASS = "6403";

export const WA_QUARTERLY_LESSONS: readonly BoxLesson[] = [
  /* ═══════════════════════════ ESD 5208A — UNEMPLOYMENT ═══════════════════ */
  {
    formId: "esd_5208a",
    box: "esd-ui",
    headline: "Unemployment tax — 100% Greenway's, and deducting it is unlawful",
    plainEnglish:
      "The unemployment insurance tax. It funds benefits for people who lose their jobs, and it is " +
      "entirely Greenway's own cost. Not a penny of it may come out of anyone's pay cheque. This is " +
      "the single most important thing to know about this box, and Washington law says it in one " +
      "blunt sentence: any deduction in violation of it is unlawful.",
    whereItComesFrom:
      "Your experience-rated tax rate multiplied by the quarter's wages, counting each employee only " +
      "up to the annual taxable wage base. Once a person's year-to-date wages pass the base, their " +
      "further wages stop being taxable for unemployment — which is why this figure falls late in " +
      "the year even when payroll does not.",
    howToReadIt:
      "Your RATE is the number to watch, not the amount. It is experience-rated: it reflects how " +
      "much has been paid out in benefits to former Greenway employees. A rising rate means past " +
      "layoffs are still being paid for; a falling rate is a dividend from stable employment. It is " +
      "the only payroll tax where how you treat people changes the price.",
    commonMistake:
      "Deducting it from wages, or netting it against an employee's final cheque. RCW 50.24.010 " +
      "makes any such deduction unlawful, full stop. The subtler error is forgetting the taxable " +
      "wage base and continuing to accrue on wages that are no longer taxable — which overstates " +
      "the liability and overpays the State.",
    whatToDo:
      "Confirm the rate on the return matches the rate notice ESD sent for the year, and confirm the " +
      "wage base cut off correctly for anyone highly paid. Then pay it from Greenway's own funds.",
    examples: [
      {
        title: "Greenway's 2026 unemployment tax on a quarter of wages",
        steps: [
          "Quarterly wages subject to unemployment tax: $100,000.00.",
          "Greenway's 2026 UI rate: 0.37% (370 milli-percent).",
          "$100,000.00 x 0.37% = $370.00.",
          "All $370.00 is Greenway's own money. Nothing is withheld from staff.",
        ],
        answer: "$370.00",
        moral:
          "A low rate is worth real money: at 5.4% the same wages would cost $5,400. Stable " +
          "employment is the cheapest payroll tax strategy there is.",
      },
    ],
    quotes: [
      {
        cite: "RCW 50.24.010",
        quote:
          "Contributions shall become due and be paid by each employer to the treasurer for the unemployment compensation fund in accordance with such regulations as the commissioner may prescribe, and shall not be deducted, in whole or in part, from the remuneration of individuals in employment of the employer. Any deduction in violation of the provisions of this section shall be unlawful.",
        sourcePath: RCW_50_24_010_PATH,
        sourceUrl: RCW_50_24_010_URL,
        soWhat:
          "\u201cIn whole or in part\u201d closes every loophole. There is no lawful way to shift any portion " +
          "of unemployment tax onto an employee — not by deduction, not by netting, not by agreement.",
      },
    ],
    tiesTo: [
      {
        /*
         * Was `box: "wage-detail"` until books-54, which is a box the 5208B
         * has never had. The specimen carries `wage-detail-wages`,
         * `wage-detail-hours` and `wage-detail-total`; this tie is about WAGES
         * adding up, so it points at the per-person wages column. The dead
         * reference was found by `assertEveryTieResolves`, added in the same
         * slice precisely because nothing had ever checked a tie target.
         */
        formId: "esd_5208b",
        box: "wage-detail-wages",
        why:
          "The 5208A says what is owed; the 5208B says who earned it. The wages listed person by " +
          "person on the 5208B must add up to the wage figure the 5208A taxed.",
      },
    ],
  },

  {
    formId: "esd_5208a",
    box: "esd-eaf",
    headline: "The Employment Administration Fund — a tiny separate tax people forget",
    plainEnglish:
      "A small additional tax that funds ESD's own administration rather than benefits. It is " +
      "charged on the same wages as the unemployment tax, at its own much smaller rate, and it is " +
      "also entirely Greenway's cost.",
    whereItComesFrom:
      "The EAF rate applied to the same taxable wages as the unemployment tax on the line above. " +
      "Greenway's 2026 EAF rate is 0.03%.",
    howToReadIt:
      "It should be a small, stable fraction of the unemployment line. If the ratio between the two " +
      "changes, one of the two rates was entered wrongly — a useful self-check that takes seconds.",
    commonMistake:
      "Omitting it because it is small, or folding it into the unemployment figure. It is a separate " +
      "line with a separate rate, and a return that reports only one of the two is short.",
    whatToDo: "Verify both rates against the ESD rate notice for the year, then report both lines.",
    examples: [
      {
        title: "EAF on the same $100,000 of wages",
        steps: [
          "Quarterly taxable wages: $100,000.00.",
          "Greenway's 2026 EAF rate: 0.03% (30 milli-percent).",
          "$100,000.00 x 0.03% = $30.00.",
        ],
        answer: "$30.00",
        moral:
          "Thirty dollars is easy to overlook and just as overdue as the rest if you do. Small does " +
          "not mean optional.",
      },
    ],
    quotes: [],
    tiesTo: [],
  },

  /* ═══════════════════════════ PAID LEAVE + WA CARES ══════════════════════ */
  {
    formId: "pfml_wa_cares",
    box: "pfml-employee",
    headline: "Paid Leave withheld from staff — you are their agent, not the owner of this money",
    plainEnglish:
      "Paid Family and Medical Leave premiums you took out of your employees' cheques. The statute " +
      "uses a precise and unusual word for what Greenway is doing with it: you act as the AGENT of " +
      "the employees. The money was never Greenway's. You collected it on their behalf and you are " +
      "passing it to the State.",
    whereItComesFrom:
      "The employee share of the total Paid Leave premium, applied to each person's wages up to the " +
      "annual cap, which by RCW 50A.10.030 tracks the Social Security wage base. Summed across the " +
      "quarter's pay runs from the year-to-date accumulators.",
    howToReadIt:
      "Compare it to what actually came off the cheques. This box and the payroll deductions must be " +
      "the same number. If the box is larger, Greenway is about to pay a shortfall out of its own " +
      "funds; if smaller, money was withheld from staff and not remitted — which is the worse of the " +
      "two problems by a wide margin.",
    commonMistake:
      "Treating the employee share as a fixed percentage of wages. It is not: the statute defines it " +
      "as a share OF THE PREMIUM, and the premium rate itself changes by legislative action. A " +
      "hard-coded percentage will be wrong the first year the rate moves.",
    whatToDo:
      "Reconcile this figure against the actual payroll deductions for the quarter before filing. " +
      "They must match to the cent.",
    examples: [
      {
        title: "The employee share of Paid Leave for a quarter",
        steps: [
          "Quarterly wages subject to Paid Leave: $100,000.00.",
          "2026 total premium rate: 1.13% of wages.",
          "Total premium = $100,000.00 x 1.13% = $1,130.00.",
          "Employee share of that premium in 2026: 71.43%.",
          "$1,130.00 x 71.43% = $807.16 withheld from staff.",
        ],
        answer: "$807.16",
        moral:
          "Two steps, not one: a percentage of wages to get the premium, then a percentage of the " +
          "PREMIUM to get the employee's share. Collapsing them into a single rate is how this box " +
          "goes wrong.",
      },
    ],
    quotes: [
      {
        cite: "RCW 50A.10.030(7)(b)",
        quote:
          "In collecting employee premiums through payroll deductions, the employer shall act as the agent of the employees and shall remit the amounts to the department as required by this title.",
        sourcePath: RCW_50A_10_030_PATH,
        sourceUrl: RCW_50A_10_030_URL,
        soWhat:
          "\u201cAgent\u201d is a legal relationship, not a courtesy. This money is not Greenway's working " +
          "capital and it cannot be used to bridge a slow week.",
      },
    ],
    tiesTo: [
      {
        formId: "form_w2",
        box: "14",
        why:
          "Paid Leave withheld from an employee belongs in BOX 14 of their W-2, not box 17. " +
          "Washington has no personal income tax, so box 17 must be blank — putting Paid Leave there " +
          "tells the IRS your employees paid a state income tax that does not exist.",
      },
    ],
  },

  {
    formId: "pfml_wa_cares",
    box: "pfml-employer",
    headline: "The employer share of Paid Leave — Greenway owes nothing here, and that is the law",
    plainEnglish:
      "The employer half of the Paid Leave premium. Greenway does not currently owe it. Employers " +
      "with fewer than 50 Washington employees are not required to pay the employer portion, and " +
      "with twelve people Greenway is comfortably inside that exemption. THIS BOX BEING ZERO IS A " +
      "CORRECT ANSWER, not a missing one.",
    whereItComesFrom:
      "Nothing, while the exemption applies. When it does apply, the size test is not a headcount " +
      "taken on the day you file: ESD averages the employees you reported on the last day of each of " +
      "the four preceding quarters, decides on 30 September, and that answer governs the WHOLE of " +
      "the following calendar year.",
    howToReadIt:
      "Read it as a threshold to watch rather than a number to check. Growing from 12 to 50 " +
      "employees in Washington adds this whole line to Greenway's costs, and it arrives on 1 January " +
      "following the determination — not on the day you hire the 50th person.",
    commonMistake:
      "Counting today's employees to decide the question. The determination is made once a year from " +
      "an average of four quarter-end counts, so an employer can be over 50 in June and still owe " +
      "nothing that year, or under 50 today and owe for every quarter because last September's " +
      "average was above the line.",
    whatToDo:
      "Each October, check the headcount ESD determined for the coming year. If it crossed 50, " +
      "budget the employer share into next year's payroll cost before January.",
    examples: [
      {
        title: "Why Greenway's employer share is zero",
        steps: [
          "Count Washington employees: 12.",
          "The statutory threshold is 50.",
          "12 is fewer than 50, so the employer portion is not required.",
          "The employee share on the line above is still owed in full.",
        ],
        answer: "$0.00",
        moral:
          "A zero here is the exemption working, not a figure someone forgot. The screen says so " +
          "rather than leaving a silent blank.",
      },
    ],
    quotes: [
      {
        cite: "RCW 50A.10.030(5)(a)",
        quote:
          "Employers with fewer than 50 employees employed in the state are not required to pay the employer portion of premiums for family and medical leave.",
        sourcePath: RCW_50A_10_030_PATH,
        sourceUrl: RCW_50A_10_030_URL,
        soWhat:
          "This is the sentence that makes Greenway's zero correct. Keep it in view — the day the " +
          "headcount crosses 50, this line stops being zero.",
      },
      {
        cite: "RCW 50A.10.030(7)(c)",
        quote:
          "On September 30th of each year, the department shall average the number of employees reported by an employer on the last day of each quarter over the last four completed calendar quarters to determine the size of the employer for the next calendar year for the purposes of this section, RCW 50A.24.010, and 50A.24.030.",
        sourcePath: RCW_50A_10_030_PATH,
        sourceUrl: RCW_50A_10_030_URL,
        soWhat:
          "The size test is an annual average fixed on 30 September, not a live headcount. This is " +
          "why the software refuses to infer it from how many people are on the payroll today.",
      },
    ],
    tiesTo: [],
  },

  {
    formId: "pfml_wa_cares",
    box: "wa-cares",
    headline: "WA Cares — entirely the employee's, with no wage cap at all",
    plainEnglish:
      "The WA Cares Fund long-term care premium. Two things make it different from Paid Leave " +
      "sitting on the same return: it is 100% employee money with no employer share at all, and " +
      "there is NO WAGE CAP. Paid Leave stops at the Social Security wage base; WA Cares keeps " +
      "charging on every dollar.",
    whereItComesFrom:
      "The WA Cares rate applied to uncapped quarterly wages, less anyone with an approved " +
      "exemption. 2026 rate: 0.58% of wages.",
    howToReadIt:
      "For a highly-paid employee, WA Cares can exceed their Paid Leave premium late in the year, " +
      "because Paid Leave has stopped at the cap and WA Cares has not. If the two lines move " +
      "together all year, check whether the cap is being applied to Paid Leave at all.",
    commonMistake:
      "Applying the Paid Leave wage cap to WA Cares. They share a return and a portal, which makes " +
      "it easy to assume they share a cap. They do not.",
    whatToDo:
      "Confirm WA Cares was charged on FULL wages, and that anyone with an approved exemption was " +
      "excluded. An exemption is granted to the employee by ESD, not decided by Greenway.",
    examples: [
      {
        title: "WA Cares on a quarter of wages",
        steps: [
          "Quarterly wages, uncapped: $100,000.00.",
          "2026 WA Cares rate: 0.58% (580 milli-percent).",
          "$100,000.00 x 0.58% = $580.00.",
          "All of it withheld from employees. Greenway owes no share.",
        ],
        answer: "$580.00",
        moral:
          "No cap means this figure keeps rising with payroll all year, while Paid Leave flattens " +
          "out. Late in the year they will diverge, and that divergence is correct.",
      },
    ],
    quotes: [],
    tiesTo: [
      {
        formId: "form_w2",
        box: "14",
        why:
          "Like Paid Leave, WA Cares withheld belongs in box 14 of the W-2 — never box 17. It is not " +
          "a state income tax, because Washington does not have one.",
      },
    ],
  },

  /* ═══════════════════════════ L&I QUARTERLY ══════════════════════════════ */
  {
    formId: "lni_quarterly",
    box: "lni-hours",
    headline: "Hours worked — the only box on any payroll form charged on time, not money",
    plainEnglish:
      "The total hours your workers were exposed to the hazards of your risk class. Workers' " +
      `compensation in Washington is priced per HOUR WORKED, not as a percentage of wages. Greenway ` +
      `is risk class ${GREENWAY_LNI_RISK_CLASS}, and every hour in it costs the same whether the ` +
      "person working it earns minimum wage or is the owner.",
    whereItComesFrom:
      "Actual hours from the timesheets for the quarter, carried in integer hundredths so a half " +
      "hour cannot be lost to rounding. Salaried people still generate reportable hours — a salary " +
      "does not exempt anyone from workers' compensation.",
    howToReadIt:
      "Divide the premium by these hours and you have your true cost of an hour of labour beyond the " +
      "wage. It is also the number that shows overtime's real price: an overtime hour costs 1.5x in " +
      "wages AND a full hour of L&I exposure, while a pay RISE costs nothing here at all.",
    commonMistake:
      "Reporting paid hours instead of hours WORKED. Vacation, holiday and paid sick leave are paid " +
      "hours where no work was performed and no hazard was faced. Reporting them inflates the " +
      "premium — Greenway pays for exposure that never happened.",
    whatToDo:
      "Report hours actually worked. Keep paid-leave hours out of this box, and confirm the risk " +
      `class on the return is ${GREENWAY_LNI_RISK_CLASS} before filing.`,
    examples: [
      {
        title: "Why a raise is free here and overtime is not",
        steps: [
          "An employee works 40 hours at $20.00: 40 reportable hours.",
          "You raise them to $25.00 for the same 40 hours: still 40 reportable hours.",
          "L&I premium: unchanged. A raise costs nothing in workers' compensation.",
          "Now they work 10 hours of overtime instead: 50 reportable hours.",
          "L&I premium: 25% higher, on top of paying time-and-a-half in wages.",
        ],
        answer: "40 hours vs 50 hours",
        moral:
          "Overtime is expensive twice and a raise is expensive once. This box is where the second " +
          "cost of overtime shows up, and it is the reason to read it.",
      },
    ],
    quotes: [],
    tiesTo: [
      {
        /*
         * Also `box: "wage-detail"` until books-54. This tie is about HOURS,
         * not wages, so it resolves to the hours column rather than the wages
         * one — the two dead references were identical in text and had to be
         * repointed differently, which is exactly why a gate is worth more
         * than a search-and-replace.
         */
        formId: "esd_5208b",
        box: "wage-detail-hours",
        why:
          "Both returns report hours for the same quarter. If the L&I hours and the ESD wage-detail " +
          "hours disagree, one of the two returns is wrong and the agencies can see it.",
      },
    ],
  },

  {
    formId: "lni_quarterly",
    box: "lni-employee",
    headline: "The employee's half — of the MEDICAL AID portion only, and this trap is a crime",
    plainEnglish:
      "The part of the workers' compensation premium you may lawfully deduct from your workers. " +
      "READ THE RULE PRECISELY, because the obvious reading is wrong and the penalty is criminal. " +
      "The statute permits deducting one-half of the amount required for MEDICAL BENEFITS — the " +
      "medical aid portion. It does NOT permit deducting half of the total premium. Those are two " +
      "different numbers, and taking the larger one is a gross misdemeanour.",
    whereItComesFrom:
      "The employee rate per hour for the risk class, multiplied by reportable hours. The rate " +
      "already embodies the one-half-of-medical-aid rule, which is exactly why the engine holds " +
      "separate employee and employer rates per hour rather than one rate and a division.",
    howToReadIt:
      "Compare it to the employer line beside it. The employee share is the SMALLER of the two and " +
      "should be roughly a quarter to a third of the total, not half. If it ever approaches half the " +
      "total premium, the medical-aid rule has been misapplied and the over-deduction is unlawful.",
    commonMistake:
      "Deducting half the total premium. It is the single most consequential error on this return: " +
      "RCW 51.16.140(2) makes deducting any part of the premium you are required to pay a GROSS " +
      "MISDEMEANOUR, not a civil penalty.",
    whatToDo:
      "Check that the employee deduction per hour matches the employee rate L&I published for risk " +
      `class ${GREENWAY_LNI_RISK_CLASS}. Never compute it as half of anything yourself.`,
    examples: [
      {
        title: "The right way and the unlawful way, on the same quarter",
        steps: [
          "Reportable hours: 3,558.00.",
          "Published EMPLOYEE rate: $0.16445 per hour.",
          "Published EMPLOYER rate: $0.39485 per hour.",
          "Correct employee deduction: 3,558 x $0.16445 = $585.11.",
          "Total premium: 3,558 x ($0.16445 + $0.39485) = $1,989.99. This is the figure actually " +
            "filed for Q2 2026 under confirmation 12616784.",
          "Half of the total premium would be $995.00 — over-deducting $409.89.",
        ],
        answer: "$585.11 — not $995.00",
        moral:
          "The unlawful figure is nearly 70% larger than the lawful one. This is why the rate is " +
          "published per hour for each side rather than left to a division.",
      },
    ],
    quotes: [
      {
        cite: "RCW 51.16.140(1)",
        quote:
          "Every employer who is not a self-insurer shall deduct from the pay of each of his or her workers one-half of the amount he or she is required to pay, for medical benefits within each risk classification.",
        sourcePath: RCW_51_16_140_PATH,
        sourceUrl: RCW_51_16_140_URL,
        soWhat:
          "\u201cFor medical benefits\u201d is the whole of it. One-half of the MEDICAL AID amount, not one-half " +
          "of the premium. Note also \u201cshall\u201d — this is a duty, not an option.",
      },
      {
        cite: "RCW 51.16.140(2)",
        quote:
          "It shall be unlawful for the employer, unless specifically authorized by this title, to deduct or obtain any part of the premium or other costs required to be by him or her paid from the wages or earnings of any of his or her workers, and the making of or attempt to make any such deduction shall be a gross misdemeanor.",
        sourcePath: RCW_51_16_140_PATH,
        sourceUrl: RCW_51_16_140_URL,
        soWhat:
          "\u201cOr attempt to make\u201d means the offence is complete before any money moves. This is the " +
          "only payroll deduction rule in Washington carrying a criminal charge for getting it wrong.",
      },
    ],
    tiesTo: [],
  },

  {
    formId: "lni_quarterly",
    box: "lni-employer",
    headline: "Greenway's share of workers' compensation — the accident fund half",
    plainEnglish:
      "The part of the workers' compensation premium Greenway pays itself. It covers the accident " +
      "fund and the supplemental pension fund, neither of which may be charged to a worker at all, " +
      "plus the employer's half of medical aid.",
    whereItComesFrom:
      `The employer rate per hour for risk class ${GREENWAY_LNI_RISK_CLASS}, multiplied by the same ` +
      "reportable hours as the employee line.",
    howToReadIt:
      "This is the real cost of an hour of exposure to Greenway. Added to wages and the federal " +
      "payroll taxes, it is what an hour of labour actually costs — always more than the wage, and " +
      "this is one of the pieces people forget when pricing a job.",
    commonMistake:
      "Assuming it is the same as the employee share. It is not; for retail risk classes the " +
      "employer rate is typically more than twice the employee rate, because the accident and " +
      "pension funds are employer-only.",
    whatToDo:
      "Confirm the employer rate against the L&I rate notice for the year, and treat this as a real " +
      "cost of labour when you price work.",
    examples: [
      {
        title: "The employer share on the same 3,558 hours",
        steps: [
          "Reportable hours: 3,558.",
          "Published EMPLOYER rate: $0.39485 per hour.",
          "3,558 x $0.39485 = $1,404.8763, which rounds to $1,404.88.",
          "Compare the employee share: $585.11. The employer carries 70.60% of the total.",
        ],
        answer: "$1,404.88",
        moral:
          "The split is roughly 70/30 against Greenway, nowhere near 50/50 — which is exactly why " +
          "\u201chalf the premium\u201d is the wrong mental model for the employee deduction.",
      },
    ],
    quotes: [],
    tiesTo: [],
  },

  /* ═══════════════════════════════════════════════════════════════════════════
   * books-56 — THE SIX BOXES THAT HAD NO LESSON
   * ═══════════════════════════════════════════════════════════════════════════
   *
   * Measured before writing anything, rather than assumed: of the fourteen
   * boxes across the four Washington specimens, eight were taught and six were
   * not. `pfml_wa_cares` was complete at 3 of 3. The gap was `esd-total` on the
   * 5208A, `lni-premium` on the L&I return, and ALL FOUR boxes of the 5208B —
   * a whole form with no lesson on any box.
   *
   * The 5208B gap deserves its own note, because it explains itself. The 5208B
   * produces no engine lines: it computes no tax, so it emits no amounts. A
   * form that emits nothing is easy for a teaching layer to skip silently, and
   * that is exactly what had happened. It is also the form that carries every
   * employee's name, number, hours and wages — the one Michael actually has to
   * get right person by person, and the one the ESD .csv writer built in this
   * same slice exists to produce.
   */

  /* ═════════════════════ ESD 5208A — the total line ═════════════════════ */
  {
    formId: "esd_5208a",
    box: "esd-total",
    headline: "Total due — two funds added AFTER each is rounded, never before",
    plainEnglish:
      "What Greenway owes Employment Security for the quarter: the unemployment tax plus the " +
      "Employment Administration Fund tax. It looks like a box that just adds two numbers up, " +
      "and it is — but the ORDER of the adding and the rounding is set by two different statutes, " +
      "and doing it in the natural order gives the wrong answer often enough to matter. Both " +
      "funds are entirely Greenway's cost; none of this may be deducted from anyone's pay.",
    whereItComesFrom:
      "The UI line plus the EAF line from this same return. Each of those is computed on the " +
      "quarter's ESD-taxable wages at its own rate and rounded to the cent on its own figure " +
      "FIRST. This total is the sum of two already-rounded amounts, which is why the engine " +
      "stores them as separate integer-cent values rather than as one blended rate.",
    howToReadIt:
      "This is the single number that has to arrive at ESD, and it is the one to reconcile " +
      "against the bank. Divide it by the quarter's taxable wages and you have Greenway's true " +
      "combined unemployment cost as a percentage — useful because the UI rate is " +
      "experience-rated and moves every year, while the EAF portion does not.",
    commonMistake:
      "Collapsing the two rates into one and multiplying once — or adding the two exact amounts " +
      "and rounding at the end. Both feel more accurate and both are wrong: each statute " +
      "commands rounding for its own section, so the rounding happens twice, before the " +
      "addition. The error is a cent or two per quarter, which is small in money and awkward in " +
      "kind, because it makes the return disagree with the agency's own arithmetic.",
    whatToDo:
      "Compute UI and EAF separately, round each to the cent, then add. Check this total against " +
      "the amount actually paid, and confirm not a penny of it was withheld from any employee.",
    examples: [
      {
        title: "Why the rounding order changes the answer",
        steps: [
          "Take a quarter's ESD-taxable wages of $68,923.45.",
          "UI at an illustrative 1.00%: $689.2345, which rounds to $689.23.",
          "EAF at the statutory 0.03%: $20.677035, which rounds to $20.68.",
          "Correct total: $689.23 + $20.68 = $709.91.",
          "Now the tempting shortcut — one blended rate of 1.03%: $709.911535, rounding to $709.91.",
          "Here they agree. Change the wages to $68,923.55 and they do not: " +
            "$689.24 + $20.68 = $709.92, but the blended rate gives $709.9126 → $709.91.",
        ],
        answer: "$709.91 — but by two roundings, not one",
        moral:
          "A method that happens to agree on this quarter's figures is not a correct method. It " +
          "is a method that has not been caught yet. Round each fund, then add.",
      },
    ],
    quotes: [
      {
        cite: "RCW 50.24.010",
        quote:
          "Contributions shall become due and be paid by each employer to the treasurer for the unemployment compensation fund in accordance with such regulations as the commissioner may prescribe, and shall not be deducted, in whole or in part, from the remuneration of individuals in employment of the employer. Any deduction in violation of the provisions of this section shall be unlawful.",
        sourcePath: RCW_50_24_010_PATH,
        sourceUrl: RCW_50_24_010_URL,
        soWhat:
          "This total is the sum of two employer-only taxes, so the no-deduction rule governs the " +
          "whole of it and not merely the UI line. \u201cIn whole or in part\u201d leaves no room for " +
          "recovering even the EAF pennies from a worker.",
      },
      {
        cite: "WAC 192-310-010(3)(a)",
        quote:
          "Tax report. Each calendar quarter, every employer must file a tax report with the commissioner. The report must list the total wages paid to every employee during that quarter.",
        sourcePath: WAC_192_310_010_PATH,
        sourceUrl: WAC_192_310_010_URL,
        soWhat:
          "The rule asks for total wages and nothing else — no names, no hours. Everything on this " +
          "return, including this total, is a percentage of that one figure, which is why an error " +
          "in the wage total is more expensive than an error in any single person's line.",
      },
    ],
    tiesTo: [
      {
        formId: "esd_5208b",
        box: "wage-detail-total",
        why:
          "This tax is charged on the wages the 5208B lists person by person. The detail rows must " +
          "add up to the wage figure this tax was computed on; if they do not, one of the two " +
          "halves of the same filing is wrong and ESD can see it immediately.",
      },
    ],
  },

  /* ═════════════════════ ESD 5208B — the whole form ═════════════════════ */
  {
    formId: "esd_5208b",
    box: "employee",
    headline: "Name and Social Security number — the box where a mismatch credits nobody",
    plainEnglish:
      "One row for every person Greenway paid in the quarter, identified by full name and Social " +
      "Security number. No money is calculated here and no tax is charged on it, which is why it " +
      "is easy to treat as paperwork. It is not paperwork: this is the box that decides WHOSE " +
      "earnings record gets the credit for the wages reported beside it.",
    whereItComesFrom:
      "The employee record, spelled exactly as the Social Security Administration has it — not as " +
      "the person signs their emails, and not a nickname. The rule also accepts an ITIN in place " +
      "of a Social Security number, and it says what to do when a new hire has neither yet.",
    howToReadIt:
      "Count the rows. That count is the size of Greenway's workforce for the quarter as the state " +
      "sees it, and it should match the number of W-2s issued for the year once you allow for " +
      "starters and leavers. Ten people appear on Greenway's Q2 2026 detail.",
    commonMistake:
      "A name that does not match the number. It is the most common reason a wage report is " +
      "rejected, and the damage is quiet: the wages credit nobody, so the employee's benefit " +
      "record is short and nothing on Greenway's side looks wrong. Married names changed with the " +
      "employer but never with the Social Security Administration are the usual cause.",
    whatToDo:
      "Match every name and number to the Social Security card, not to the payroll nickname. When " +
      "a new hire has no card yet, follow the seven-day rule in the regulation rather than " +
      "inventing a placeholder number — and never file a made-up SSN.",
    examples: [
      {
        title: "What the state asks for, and what the federal return asks for",
        steps: [
          "WAC 192-310-010(3)(b) requires five facts per person: full name, Social Security " +
            "number, occupational code or job title, total hours worked, wages paid.",
          "Form 941 asks for none of the five. It reports one company-wide set of totals.",
          "So the federal return can be right while this one is wrong about every person on it.",
          "And the wage detail is half of one filing: the 5208A carries the money, this carries " +
            "the people. Sending one without the other is an incomplete report with its own penalty.",
        ],
        answer: "Five facts per person, versus none",
        moral:
          "This is the form that knows who works at Greenway. That is why the time clock and the " +
          "employee records are compliance systems and not merely conveniences.",
      },
    ],
    quotes: [
      {
        cite: "WAC 192-310-010(3)(b)",
        quote:
          "Report of employees' wages. Each calendar quarter, every employer must file a report of employees' wages with the commissioner. This report must list each employee by full name, Social Security number, standard occupational classification code or job title, and total hours worked and wages paid during that quarter.",
        sourcePath: WAC_192_310_010_PATH,
        sourceUrl: WAC_192_310_010_URL,
        soWhat:
          "Five facts, per person, every quarter. Read it beside the 941 and the difference is the " +
          "single most useful fact about Washington payroll: the state wants to know who, and the " +
          "federal return does not.",
      },
      {
        cite: "WAC 192-310-010(3)(b)(v)",
        quote:
          /*
           * Ends with a SEMICOLON, not a full stop. It is item (v) in a list,
           * and the published text punctuates it as one. I first wrote a full
           * stop and the gate caught it, which is exactly the silent alteration
           * rule 24/35 exists to prevent: a quote that reads correctly and is
           * not what the regulation says.
           */
          "For the purposes of this section, if an employee does not have a Social Security number but does have an individual taxpayer identification number (ITIN), the ITIN qualifies as a Social Security number. If the employee later obtains a Social Security number, the employer should use the Social Security number when filing the report of employees' wages;",
        sourcePath: WAC_192_310_010_PATH,
        sourceUrl: WAC_192_310_010_URL,
        soWhat:
          "An ITIN is a lawful answer here, so \u201cno SSN\u201d is not a reason to leave somebody off the " +
          "report. Note the second sentence: once a real number arrives, it replaces the ITIN on " +
          "future reports.",
      },
    ],
    tiesTo: [
      {
        formId: "form_w2",
        box: "e",
        why:
          "The same name and number appear on that person's W-2. If the two disagree, at least one " +
          "of the two filings is crediting the wrong record, and the employee is the one who " +
          "discovers it years later.",
      },
    ],
  },

  {
    formId: "esd_5208b",
    box: "wage-detail-wages",
    headline: "One person's gross wages — and these rows must add to the 5208A's total",
    plainEnglish:
      "That one employee's gross pay for the quarter. No tax is computed on this box; it is a wage " +
      "amount, not a bill. Its job is to say how much of the company-wide total on the 5208A " +
      "belongs to this particular person, so the state knows whose earnings to credit if they " +
      "later claim unemployment.",
    whereItComesFrom:
      "Gross wages paid to that person during the quarter, from the payroll register. Gross means " +
      "before any deduction — before withholding, before their Paid Leave premium, before their " +
      "share of medical aid.",
    howToReadIt:
      "Add every row up and compare the sum to the single wage figure on the 5208A. Those two " +
      "numbers are the same money counted two ways and they must agree exactly. This is the " +
      "cheapest reconciliation in the whole quarter and it catches a whole class of error before " +
      "the agency does.",
    commonMistake:
      "Reporting NET pay, or reporting taxable wages after the excess over the wage base has been " +
      "removed. Both understate the row. The taxable-wage ceiling belongs on the tax computation, " +
      "not on this detail line — this box reports what the person was actually paid.",
    whatToDo:
      "Report gross pay per person and prove the rows sum to the 5208A total before filing. If " +
      "they differ by even a cent, find it now: one of the two returns is wrong.",
    examples: [
      {
        title: "The reconciliation that has to hold",
        steps: [
          "Greenway's Q2 2026 wage total on the 5208A: $68,923.45.",
          "The 5208B lists ten people, each with their own gross for the quarter.",
          "Add the ten rows. The sum must be $68,923.45 exactly.",
          "If it is not, the error is in one place or the other and it is findable in minutes.",
          "Note what is NOT relevant here: the taxable wage base. A person past the base still " +
            "shows their full gross on this row; the ceiling only affects the tax on the 5208A.",
        ],
        answer: "The rows must total $68,923.45",
        moral:
          "Two halves of one filing, cross-footing to the penny. A preparer who checks this " +
          "finds their own mistakes; one who does not waits for a notice.",
      },
    ],
    quotes: [
      {
        cite: "WAC 192-310-010(3)(a)",
        quote:
          "Tax report. Each calendar quarter, every employer must file a tax report with the commissioner. The report must list the total wages paid to every employee during that quarter.",
        sourcePath: WAC_192_310_010_PATH,
        sourceUrl: WAC_192_310_010_URL,
        soWhat:
          "The 5208A carries the TOTAL wages; this box carries one person's share of it. The same " +
          "regulation demands both, one sentence apart, which is why they have to agree.",
      },
    ],
    tiesTo: [
      {
        formId: "esd_5208a",
        box: "esd-total",
        why:
          "The tax on the 5208A is charged on the wages these rows describe. The detail must sum " +
          "to the total the tax was computed on.",
      },
      {
        formId: "pfml_wa_cares",
        box: "pfml-employee",
        why:
          "The Paid Leave return reports wages for the same people over the same quarter, and the " +
          "ESD .csv wage file carries this same per-person gross figure. If the two disagree about " +
          "what somebody earned, at least one filing is wrong.",
      },
    ],
  },

  {
    formId: "esd_5208b",
    box: "wage-detail-hours",
    headline: "Hours worked, per person — required even though no tax is charged on them here",
    plainEnglish:
      "The total hours that one person actually worked during the quarter. Nothing on this return " +
      "is charged on hours, which is why this box gets treated as optional. It is not optional: " +
      "the regulation lists total hours worked as one of the five facts required for every " +
      "employee, and the same hour count is what the L&I premium is actually billed on.",
    whereItComesFrom:
      "The time clock, per person, for the quarter. Salaried people still generate reportable " +
      "hours — a salary is a way of paying somebody, not an exemption from counting their time.",
    howToReadIt:
      "Add the rows and compare the total to the hours on the L&I return for the same quarter. " +
      "Greenway's Q2 2026 hours add to 3,558. Two agencies are being told the same fact, and if " +
      "the two returns disagree about it, both are visible to both.",
    commonMistake:
      "Reporting PAID hours instead of hours WORKED. Vacation, holiday and paid sick leave are " +
      "hours paid for where no work was performed. Including them overstates this box and, on the " +
      "L&I return, makes Greenway pay premium on exposure that never happened.",
    whatToDo:
      "Report hours actually worked, per person, and reconcile the total against the L&I return " +
      "before either is filed. Keep paid-leave hours out of both.",
    examples: [
      {
        title: "Why hours are a compliance figure and not a payroll convenience",
        steps: [
          "The regulation requires \u201ctotal hours worked\u201d for every employee, every quarter.",
          "No tax on this return is computed from them.",
          "But L&I charges premium PER HOUR, on the same hours: 3,558 for Greenway's Q2 2026.",
          "So an hours error is free on this form and expensive on the next one.",
          "And the two returns are filed with different agencies from the same underlying record, " +
            "which is what makes a disagreement between them hard to explain.",
        ],
        answer: "3,558 hours, on both returns",
        moral:
          "The box that charges nothing is the box that proves the box that charges something. " +
          "That is why it is required.",
      },
    ],
    quotes: [
      {
        cite: "WAC 192-310-010(3)(b)",
        quote:
          "This report must list each employee by full name, Social Security number, standard occupational classification code or job title, and total hours worked and wages paid during that quarter.",
        sourcePath: WAC_192_310_010_PATH,
        sourceUrl: WAC_192_310_010_URL,
        soWhat:
          "\u201cTotal hours worked\u201d is in the list of required facts, with no exception for salaried " +
          "staff and no relief for a form that charges no tax on them.",
      },
    ],
    tiesTo: [
      {
        formId: "lni_quarterly",
        box: "lni-hours",
        why:
          "L&I charges premium on hours, and these are the same hours. If the ESD wage detail and " +
          "the L&I return disagree, one of the two is wrong and the agencies can each see it.",
      },
    ],
  },

  {
    formId: "esd_5208b",
    box: "wage-detail-total",
    headline: "Report total — the form that bills nothing, and reconciles everything",
    plainEnglish:
      "The sum of every row on the wage detail. This form computes no tax and produces no bill of " +
      "its own, so this total is not an amount owed. It is the reconciliation point: the figure " +
      "that has to equal the total wages on the 5208A, penny for penny.",
    whereItComesFrom:
      "Adding up the per-person gross wages on this form. Nothing else feeds it; if it disagrees " +
      "with the 5208A, the cause is in the rows or in the other return, never in this box.",
    howToReadIt:
      "Read it as a checksum rather than as information. It answers one question — do the two " +
      "halves of this quarter's ESD filing agree? — and that question is worth asking before " +
      "filing rather than after a notice arrives.",
    commonMistake:
      "Filing the tax report and not the wage detail, on the reasoning that the money has been " +
      "paid so the obligation is met. It is not met: the two reports are separate requirements in " +
      "the same regulation, and an incomplete report carries its own penalty even when the payment " +
      "was correct and on time.",
    whatToDo:
      "Prove this total equals the 5208A wage total, then file BOTH halves together. If a quarter " +
      "ends the business, file both immediately rather than waiting for the normal due date.",
    examples: [
      {
        title: "Two reports, one filing",
        steps: [
          "The regulation states the tax report requirement in (3)(a) and the wage report " +
            "requirement in (3)(b) — separate sentences, separate duties.",
          "Greenway's Q2 2026: the 5208A says $68,923.45 of wages; the 5208B's rows must total the " +
            "same $68,923.45.",
          "The 5208A produces a bill. The 5208B produces none.",
          "Paying the bill does not satisfy (3)(b). Filing (3)(b) does not satisfy (3)(a).",
        ],
        answer: "$68,923.45 on both, and both filed",
        moral:
          "A form with no total due is still a form with a penalty for not filing it.",
      },
    ],
    quotes: [
      {
        cite: "WAC 192-310-010(3)(b)(iv)",
        quote:
          "If the employee does not show his or her Social Security card or application for a card within seven days and the employer continues to employ the worker, the employer does not meet the reporting requirements of this section. The department will not allow waiver of the incomplete report penalty",
        sourcePath: WAC_192_310_010_PATH,
        sourceUrl: WAC_192_310_010_URL,
        soWhat:
          "Proof that this form carries a penalty of its own despite computing no tax — and note " +
          "the last clause: for this particular failure the department will NOT waive it.",
      },
      {
        cite: "WAC 192-310-010(3)(e)",
        quote:
          "Termination of business. Each employer who stops doing business or whose account is closed by the department must immediately file:",
        sourcePath: WAC_192_310_010_PATH,
        sourceUrl: WAC_192_310_010_URL,
        soWhat:
          "\u201cImmediately\u201d replaces the ordinary due date if Greenway ever closes or sells. Both " +
          "reports are named in the sentences that follow, so both are due at once.",
      },
    ],
    tiesTo: [
      {
        formId: "esd_5208a",
        box: "esd-total",
        why:
          "These two boxes are the two halves of one ESD filing. The wage detail total must equal " +
          "the wage total the tax was computed on.",
      },
    ],
  },

  /* ═════════════════════ L&I — the amount owed ═════════════════════ */
  {
    formId: "lni_quarterly",
    box: "lni-premium",
    headline: "Amount owed — the only payroll bill in Washington charged on time, not money",
    plainEnglish:
      "The total workers' compensation premium for the quarter: Greenway's own share plus the part " +
      "lawfully deducted from workers, added together. It is billed on HOURS WORKED at a rate per " +
      "hour for the risk class, so wages never enter the calculation at all. A raise does not " +
      "change it. An hour of overtime does.",
    whereItComesFrom:
      `Reportable hours multiplied by the combined employee and employer rate per hour for risk ` +
      `class ${GREENWAY_LNI_RISK_CLASS}. The engine computes it on the combined rate because that ` +
      "is how the L&I notice quotes it and how L&I bills it — but it holds the two sides " +
      "separately as well, because only one of them may lawfully be deducted.",
    howToReadIt:
      "Divide it by the hours and you have the true premium cost of an hour of labour at Greenway, " +
      "on top of the wage. Then read the employee and employer lines beside it: the employee share " +
      "should be roughly a quarter to a third of this total, never half. If it approaches half, " +
      "the medical-aid rule has been misapplied.",
    commonMistake:
      "Treating this total as the thing to split in two. The lawful employee deduction is one-half " +
      "of the MEDICAL AID amount, not half of this figure — and RCW 51.16.140(2) makes taking any " +
      "part of the premium Greenway is required to pay a gross misdemeanour. The other frequent " +
      "error is including paid leave hours, which buys premium on exposure that never happened.",
    whatToDo:
      `Confirm the risk class is ${GREENWAY_LNI_RISK_CLASS} and the rates match the current L&I ` +
      "rate notice, report hours actually worked, and take the employee deduction from the " +
      "published employee rate per hour — never by dividing this total.",
    examples: [
      {
        title: "The quarter actually filed, and the two ways to get it wrong",
        steps: [
          "Reportable hours: 3,558.00.",
          "Published rates: employee $0.16445 per hour, employer $0.39485 per hour.",
          "Combined: $0.55930 per hour. 3,558 x $0.55930 = $1,989.99 — the figure filed for " +
            "Q2 2026 under confirmation 12616784.",
          "Lawful employee deduction: 3,558 x $0.16445 = $585.11, which is 29.4% of the total.",
          "Error one — deducting half of this total: $995.00, over-deducting $409.89, and a crime.",
          "Error two — including 200 hours of paid vacation: 3,758 x $0.55930 = $2,101.85, or " +
            "$111.86 of premium bought for hours nobody worked.",
        ],
        answer: "$1,989.99",
        moral:
          "One box, two expensive mistakes: one that overcharges the workers and is criminal, one " +
          "that overcharges Greenway and is merely wasteful.",
      },
    ],
    quotes: [
      {
        cite: "RCW 51.16.140(2)",
        quote:
          "It shall be unlawful for the employer, unless specifically authorized by this title, to deduct or obtain any part of the premium or other costs required to be by him or her paid from the wages or earnings of any of his or her workers, and the making of or attempt to make any such deduction shall be a gross misdemeanor.",
        sourcePath: RCW_51_16_140_PATH,
        sourceUrl: RCW_51_16_140_URL,
        soWhat:
          "This is the sentence that makes \u201chalf the premium\u201d dangerous rather than merely " +
          "inaccurate. Any part of the employer's required premium taken from a worker is a gross " +
          "misdemeanour, and the attempt alone completes the offence.",
      },
    ],
    tiesTo: [
      {
        formId: "esd_5208b",
        box: "wage-detail-hours",
        why:
          "This premium is charged on the same hours the ESD wage detail reports person by person. " +
          "The two returns go to different agencies from one time record, so they must agree.",
      },
    ],
  },
];
