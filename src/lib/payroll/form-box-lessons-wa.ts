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
        formId: "esd_5208b",
        box: "wage-detail",
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
          "On September 30th of each year, the department shall average the number of employees reported by an employer on the last day of each quarter over the last four completed calendar quarters to determine the size of the employer for the next calendar year",
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
        formId: "esd_5208b",
        box: "wage-detail",
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
];
