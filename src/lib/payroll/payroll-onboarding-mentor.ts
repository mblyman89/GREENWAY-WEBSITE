/**
 * src/lib/payroll/payroll-onboarding-mentor.ts  (books-25)
 *
 * THE GRANDFATHER LAYER.
 *
 * Michael described the job this file does better than I could:
 *
 *   "Every time I hire someone new, they ask me how to fill out their w-4 and I
 *    never know what to say... My grandpa does though... the whole purpose of this
 *    system is to replace my grandfather with a like kind solution that both
 *    protects me and teaches me."
 *
 * WHAT CHANGED ABOUT THIS FILE'S TARGET
 * -------------------------------------
 * I started books-25 intending to teach Michael payroll accounting. That was the
 * wrong target and he corrected it:
 *
 *   "my accounting skills aren't bad or the problem here. I'm the one feeding the
 *    reports and they are accurate because I know what I'm doing as an accountant,
 *    I have no idea what I'm doing with sage. There is this huge disconnect between
 *    me and the system and it's dragging me down."
 *
 * He has a master's in accounting and he was right about his own unemployment rate
 * when Sage's own wizard was wrong. So these lessons do NOT explain accounting.
 * They explain THE SYSTEM: what this software just did, why it refused, and what
 * the machine is doing on his behalf. The gap being closed is between a competent
 * accountant and an opaque program - not a gap in his knowledge.
 *
 * Every exported function in payroll-onboarding-core.ts has a lesson here. That is
 * enforced by a test that reads both files off disk and diffs the export list, so
 * a new function without a lesson fails the build rather than shipping unexplained.
 */

import type { MentorLesson } from "@/lib/accounting/cogs-position-mentor";

export const PAYROLL_ONBOARDING_LESSONS: readonly MentorLesson[] = [
  // -------------------------------------------------------------------------
  // Money and hours integrity
  // -------------------------------------------------------------------------
  {
    fn: "assertIntegerCents",
    plainEnglish:
      "Refuses any money amount that is not a whole number of cents.",
    whyItExists:
      "Payroll is thousands of small multiplications - a rate times hours, a percentage times " +
      "a wage - and every one is a chance for a floating-point remainder to appear. Once one " +
      "does, it propagates into the general ledger, and the ledger stops tying to the bank by " +
      "amounts too small to notice and too persistent to find.",
    theTrap:
      "The trap is that floating point looks fine in testing. 0.1 + 0.2 is 0.30000000000000004, " +
      "which prints as 0.30 in almost every report you would look at. You discover it at " +
      "year-end when the W-2 totals disagree with the 941 by four cents and you cannot explain " +
      "which paycheck did it.",
    whatIWouldDo:
      "Keep every amount in integer cents from the moment it enters the system to the moment it " +
      "is formatted for a human, and never store a computed dollar figure as a decimal. If you " +
      "ever see a money column typed as float in a database, treat it as a defect regardless of " +
      "whether it has caused a problem yet.",
    authorityIds: [],
  },
  {
    fn: "assertIntegerMilliCents",
    plainEnglish:
      "Refuses an hourly rate that is not a whole number of thousandths of a cent.",
    whyItExists:
      "Some real hourly rates cannot be written in cents. Washington L&I charges you $0.16445 " +
      "per hour worked for the employee's share of workers' comp - five decimal places of a " +
      "dollar. Integer cents physically cannot hold it, and negotiated wages have the same " +
      "problem the moment someone agrees to $17.855 an hour.",
    theTrap:
      "Rounding the rate before you multiply, instead of after. Rounding $0.16445 to 16 cents " +
      "looks harmless - it is less than half a cent. Multiply it by 2,080 hours and you have " +
      "under-deducted $9.26 for one employee for one year, and under-deducting L&I is a gross " +
      "misdemeanor under RCW 51.16.140(2), not a rounding difference.",
    whatIWouldDo:
      "Store rates at higher precision than money and round only the final product, once. This " +
      "is the exact defect books-14 found in our own code, where the employee L&I share was " +
      "being derived as $0.067185/hour against a true $0.16445 - a 59% shortfall, silently, " +
      "forever.",
    // Two authorities because the lesson makes two claims: the rate really does
    // carry five decimals (the L&I formula page), and under-deducting it is a
    // crime rather than a variance (the statute). Citing only one would leave
    // half the paragraph unsupported.
    authorityIds: ["lni-premium-rate-formula", "rcw-51-16-140-lni-deduction"],
  },

  // -------------------------------------------------------------------------
  // SSN handling
  // -------------------------------------------------------------------------
  {
    fn: "canRevealSsn",
    plainEnglish:
      "Answers whether a given role is allowed to see an unmasked Social Security number. Only " +
      "the owner is.",
    whyItExists:
      "You asked for Sage's behavior - full number for you, asterisks for everyone else - and " +
      "you were right that the number has to be stored in full, because the W-2 and every " +
      "Washington wage report key on all nine digits. A system holding only the last four " +
      "could not file.",
    theTrap:
      "Treating 'who can see it' as a UI concern. If the permission check lives in the screen, " +
      "then the API, the report export, and the next developer's debug endpoint all bypass it. " +
      "Sage's own Employee List report prints the SSN as an ordinary column next to the " +
      "address, which is nine digits of identity theft one careless print job away.",
    whatIWouldDo:
      "Make masked the default return value and require two separate things to unmask - the " +
      "role AND an explicit request - so that no code path leaks the number by forgetting to " +
      "ask for a mask. Then log every reveal, because a permission you cannot audit is a " +
      "permission you cannot defend.",
    authorityIds: ["cfr-31-3402-f-2-1-f-2-ssn-no-truncation"],
  },
  {
    fn: "normalizeSsn",
    plainEnglish:
      "Strips dashes and spaces and returns the nine digits, or nothing at all if there are not " +
      "exactly nine.",
    whyItExists:
      "The same number arrives as 123-45-6789, 123 45 6789, and 123456789 depending on who " +
      "typed it. Storing all three forms means the duplicate check never fires and one employee " +
      "quietly becomes two on the W-2 run.",
    theTrap:
      "Accepting 'close enough'. Eight digits is not a truncated SSN you can pad - it is a " +
      "transcription error, and padding it invents a different person's number.",
    whatIWouldDo:
      "Normalize on the way in, store one canonical form, and format only for display.",
    authorityIds: [],
  },
  {
    fn: "ssnProblems",
    plainEnglish:
      "Lists the reasons a nine-digit string could not possibly be a real Social Security " +
      "number - area 000, 666, or 900-999, group 00, serial 0000, or the 123-45-6789 placeholder.",
    whyItExists:
      "These checks cost nothing and catch the clerical accidents that actually happen: a " +
      "shifted digit that turns the area into 000, or an ITIN in the 900 range keyed into an SSN " +
      "box. SSA's own randomization FAQ states that area numbers 000, 666 and 900-999 were " +
      "excluded from assignment, and that group 00 and serial 0000 remain invalid.",
    theTrap:
      "Believing a passing check means the number is right. It does not. This function can prove " +
      "a number is IMPOSSIBLE; nothing in this software can prove the number belongs to the " +
      "person standing in front of you. Sage offers no check at all, which is worse, but a " +
      "green checkmark that implies verification would be worse still.",
    whatIWouldDo:
      "Run these checks at entry, and then run the employee through SSA's Social Security Number " +
      "Verification Service before the first W-2. It is free to employers and it is the only " +
      "thing that actually settles the question. Finding a mismatch in January is a correction; " +
      "finding it after SSA rejects your W-2 filing is a penalty.",
    authorityIds: [],
  },
  {
    fn: "socCodeProblems",
    plainEnglish:
      "Judges the ESD work code - the six-digit Standard Occupational Classification that " +
      "Washington wants beside every name on the quarterly wage report. A blank raises a " +
      "warning, a malformed code blocks the save, and a good one passes silently.",
    whyItExists:
      "Michael asked for it in one line: \"for esd, they require a work code for each employee, " +
      "so i will need a way to enter that code in. the code my employees use is, 41-2031.\" He " +
      "is right that the state requires it. The reason blank only WARNS is that RCW " +
      "50.12.070(2)(a)(i) asks for the classification OR a job title, and ESD's own wage-file " +
      "spec says the column can be six digits or blank - so an empty box is a lawful filing " +
      "in which the title gets typed into EAMS instead.",
    theTrap:
      "Treating the two failure modes as one thing. A blank is a filing choice; a malformed " +
      "code is a typo that makes EAMS reject the ENTIRE wage file rather than the one row, so " +
      "nine correct employees fail to upload because of the tenth. That is why the malformed " +
      "case blocks here, next to the person's name, instead of surfacing three months later " +
      "as an error that names a filename. The second trap is subtler: this function checks the " +
      "SHAPE of the code and nothing else. BLS publishes roughly 870 detailed codes and this " +
      "system holds no copy of that list, so a well-formed code for the wrong occupation " +
      "passes cleanly. It proves the code could be real, never that it is right.",
    whatIWouldDo:
      "Set 41-2031 on everyone who sells, because that is what the filed 5208B already says, " +
      "and leave it blank rather than guessing for anyone whose job genuinely differs - a " +
      "guessed code is a statement to the state about what a named person does for a living. " +
      "Look the real one up on the BLS SOC list when there is a minute, and fix it then.",
    authorityIds: [
      "rcw-50-12-070-occupational-classification",
      "wac-192-310-010-soc-six-digits",
    ],
  },
  {
    fn: "isPossibleSsn",
    plainEnglish:
      "A yes/no wrapper on the impossibility checks, for when you only need the verdict.",
    whyItExists:
      "Form validation needs a boolean; the detailed reasons are for the message the human " +
      "reads. Keeping both means the UI never has to re-derive one from the other.",
    theTrap:
      "Naming it 'isValidSsn'. It is deliberately called POSSIBLE, because valid implies " +
      "verified and this function verifies nothing.",
    whatIWouldDo:
      "Read the name as the honest limit it describes, and never let it gate anything that " +
      "matters more than a form field.",
    authorityIds: [],
  },
  {
    fn: "maskSsn",
    plainEnglish:
      "Turns a Social Security number into XXX-XX-1234, keeping only the last four digits.",
    whyItExists:
      "The last four are enough to tell two employees apart on a screen, which is the only " +
      "reason anyone needs to see the number day to day.",
    theTrap:
      "A masking function that throws on bad input. The exception carries the value it was " +
      "refusing to display - into a log file, a monitoring service, and an email alert. That is " +
      "how a mask becomes a leak.",
    whatIWouldDo:
      "Always return a mask, even for garbage input, and never let the unmasked value appear in " +
      "an error path.",
    authorityIds: [],
  },
  {
    fn: "formatSsnUnmasked",
    plainEnglish:
      "Formats the full nine digits as 123-45-6789. Callers must check permission first.",
    whyItExists:
      "You need the real number when you file, and when you are checking a card against what is " +
      "on file.",
    theTrap:
      "Calling this directly. It does not check anything - it is the raw capability. The check " +
      "lives in renderSsnForRole, and going around that is how the number reaches a screen it " +
      "should not.",
    whatIWouldDo:
      "Treat any direct call to this function outside the render path as a finding in code review.",
    authorityIds: [],
  },
  {
    fn: "renderSsnForRole",
    plainEnglish:
      "The one function screens should call. Returns the full number only when the role is owner " +
      "AND the reveal was explicitly requested; otherwise the mask.",
    whyItExists:
      "This is the Sage behavior you asked to mimic, with the defaults inverted. Sage renders " +
      "the number as a plain text box and offers masking as an option. Here masking is what " +
      "happens if nobody does anything.",
    theTrap:
      "Defaults that fail open. If the safe path requires remembering to ask for it, then every " +
      "new screen is one forgotten parameter away from exposing every employee's number.",
    whatIWouldDo:
      "Insist that the dangerous thing take two deliberate acts and the safe thing take none. " +
      "That is the whole difference between this and the Sage tab.",
    authorityIds: ["cfr-31-3402-f-2-1-f-2-ssn-no-truncation"],
  },
  {
    fn: "ssnVerificationCaveat",
    plainEnglish:
      "One paragraph stating exactly what our SSN checking can and cannot prove, in language you " +
      "can repeat to an auditor.",
    whyItExists:
      "Because the most dangerous thing this module could do is imply it verified something it " +
      "did not. Writing the limit down means nobody - including me, later - mistakes a format " +
      "check for identity verification.",
    theTrap:
      "Software that says 'valid' and means 'well-formed'. That single word is how a business " +
      "concludes it has done its due diligence when it has done arithmetic.",
    whatIWouldDo:
      "Keep this text in the interface next to the field, not buried in documentation, and use " +
      "SSA's verification service before your first W-2 run.",
    authorityIds: [],
  },

  // -------------------------------------------------------------------------
  // I-9
  // -------------------------------------------------------------------------
  {
    fn: "i9DocumentSetIsSufficient",
    plainEnglish:
      "Checks that the documents you examined actually satisfy Section 2: one List A document, " +
      "or one List B plus one List C.",
    whyItExists:
      "List A proves identity and work authorization together - a passport. List B proves only " +
      "identity, like a driver's license. List C proves only authorization, like a Social " +
      "Security card. You need both halves covered, from either one document or two.",
    theTrap:
      "Two List B documents. A driver's license and a state ID card feels like more proof than " +
      "one passport, and it satisfies nothing - you have established identity twice and work " +
      "authorization not at all. This is the single most common I-9 defect, and Sage cannot " +
      "catch it because Sage does not record which documents you saw. It stores a status " +
      "dropdown and nothing else.",
    whatIWouldDo:
      "Let the employee choose which documents to present from the official lists, record the " +
      "category of each one, and never ask for a specific document - directing the choice is " +
      "itself a violation even when the paperwork ends up correct.",
    authorityIds: [
      "cfr-8-274a-2-b-1-ii-section-2-three-business-days",
      "cfr-8-274a-2-b-1-v-only-unexpired-documents",
    ],
  },
  {
    fn: "i9Section2DueYmd",
    plainEnglish:
      "Gives the date Section 2 is due: three business days after the first day of work for pay.",
    whyItExists:
      "The regulation says business days, and the difference is not academic. Hire someone on a " +
      "Thursday and the deadline is the following Tuesday, not Sunday.",
    theTrap:
      "Counting calendar days, which makes you think you are late when you are not - or worse, " +
      "counting from the offer date instead of the first day of work, which makes you think you " +
      "have time when the deadline has already passed.",
    whatIWouldDo:
      "Compute it from the first day of work for pay, every time, and put the date on the " +
      "checklist where you will see it. Sage does neither: it has no timing check at all, just " +
      "a date field you can leave blank.",
    authorityIds: ["cfr-8-274a-2-b-1-ii-section-2-three-business-days"],
  },
  {
    fn: "i9RetainUntilYmd",
    plainEnglish:
      "Works out how long to keep an I-9: three years after hire, or one year after they leave, " +
      "whichever date is later.",
    whyItExists:
      "The retention rule has two anchors and people apply the wrong one. A long-tenured " +
      "employee's hire-plus-three passed years ago, and their termination-plus-one has not " +
      "happened yet.",
    theTrap:
      "Reading 'whichever is later' as the later of the two starting points rather than the " +
      "later of the two computed answers. Someone hired in 2015 who left in 2026 has " +
      "hire-plus-three of 2018 and termination-plus-one of 2027. Destroying that file in 2018 " +
      "logic destroys a record you must produce until 2027.",
    whatIWouldDo:
      "Recompute this on every termination, not on hire, and never purge on a schedule that does " +
      "not know the termination date.",
    authorityIds: ["cfr-8-274a-2-b-2-i-a-retention-period"],
  },
  {
    fn: "addYearsYmd",
    plainEnglish:
      "Adds whole years to a date, keeping the same month and day.",
    whyItExists:
      "Retention periods are expressed in years, and doing that with millisecond arithmetic " +
      "introduces leap-year drift that shows up as a deadline one day early.",
    theTrap:
      "Adding 365 days per year. Over a three-year retention window that is off by at least one " +
      "day, and the one place it matters is the one day you are audited.",
    whatIWouldDo:
      "Do calendar math on calendar fields, and keep date handling in one small function that " +
      "can be tested against known boundaries like February 29.",
    authorityIds: ["cfr-8-274a-2-b-2-i-a-retention-period"],
  },
  {
    fn: "validateI9",
    plainEnglish:
      "Checks a whole I-9 and returns a list of exactly which fields are wrong and why, rather " +
      "than a pass/fail.",
    whyItExists:
      "You asked for this directly: 'if a field is missing, it should highlight it so something " +
      "can't silently fail me in some way.' A boolean cannot highlight anything.",
    theTrap:
      "Backdating. When this tells you Section 2 was completed late, the tempting fix is to " +
      "change the date to one that would have been on time. A late I-9 is a paperwork " +
      "violation with a fine. A falsified federal form is a different category of problem " +
      "entirely, and it is the kind that reaches a person rather than a company.",
    whatIWouldDo:
      "Record what actually happened, fix the process so the next one is on time, and never let " +
      "software make backdating convenient.",
    authorityIds: [
      "cfr-8-274a-2-b-1-i-a-section-1-at-hire",
      "cfr-8-274a-2-b-1-ii-section-2-three-business-days",
      "cfr-8-274a-2-b-1-v-only-unexpired-documents",
    ],
  },
  {
    fn: "assertI9NotUsedForPay",
    plainEnglish:
      "Throws if I-9 data ever reaches a function whose job is computing money.",
    whyItExists:
      "8 C.F.R. §274a.2(b)(4) limits what an I-9 may be used for. Immigration status, document " +
      "type and expiry dates are exactly the facts that create discrimination exposure, and they " +
      "have nothing to do with arithmetic on a paycheck. So the payroll engine does not merely " +
      "decline to read them - it cannot, because no tax function in this codebase takes an I-9 " +
      "as a parameter.",
    theTrap:
      "A future convenience. Someone will eventually want to join the employee's I-9 status into " +
      "a payroll report, because it is one query and it would be handy. That join is the " +
      "violation, and it will look like a small feature request.",
    whatIWouldDo:
      "Keep the two in separate tables with separate access, and keep this guard in the pay path " +
      "so the refactor that tries to wire them together fails a test instead of shipping. Sage " +
      "puts I-9 status on the same tab as pay data, inches apart, which is how the temptation " +
      "becomes the default.",
    authorityIds: ["cfr-8-274a-2-b-4-limitation-on-use"],
  },

  // -------------------------------------------------------------------------
  // Pay
  // -------------------------------------------------------------------------
  {
    fn: "validatePay",
    plainEnglish:
      "Checks the pay setup - rate or salary, frequency, labor role, COGS split - and names each " +
      "field that is wrong.",
    whyItExists:
      "This is the information neither the W-4 nor the I-9 contains, so it is the part you have " +
      "to supply from the offer letter. It is also where Sage's screenshots showed every hourly " +
      "rate sitting at 0.00 on a saveable employee record.",
    theTrap:
      "A zero that nobody entered looks exactly like a zero somebody entered. Sage will save an " +
      "employee at 0.00 an hour without a murmur, and the failure surfaces as a person asking " +
      "why their check is empty. The second trap is the frequency: Sage defaulted to Weekly " +
      "while you actually pay every two weeks, and a wrong frequency does not fail loudly - it " +
      "silently mis-annualizes every withholding calculation for the entire year, because " +
      "Pub. 15-T divides by periods per year. Fifty-two against twenty-six is a factor of two.",
    whatIWouldDo:
      "Refuse to save a wage of zero, refuse to hold an hourly rate and a salary on the same " +
      "person, and check the rate against the Washington minimum in force on the hire date. " +
      "None of those three refusals exist in Sage.",
    authorityIds: [],
  },
  {
    fn: "salaryGrossForPeriodCents",
    plainEnglish:
      "Splits an annual salary across the pay periods in a year, giving the leftover cents to the " +
      "first period so the year adds up exactly.",
    whyItExists:
      "Salaries rarely divide evenly. $70,000 across 26 periods is $2,692.3076..., and 26 " +
      "payments of $2,692.30 comes to $69,999.80. Those twenty cents have to go somewhere " +
      "explicit, or the W-2 will not match the salary you agreed to pay.",
    theTrap:
      "Letting each period round independently. The error is invisible per paycheck and shows up " +
      "at year-end as a total that is close to the salary but not equal to it - and by then you " +
      "have 26 rounding decisions to reconstruct.",
    whatIWouldDo:
      "Decide once, in code, where the remainder lands, and document it. Your own case is the " +
      "simple one - 'I pay myself once at the end of the year' means one period, so the whole " +
      "salary lands there and there is no remainder to place at all.",
    authorityIds: [],
  },
  {
    fn: "hourlyGrossCents",
    plainEnglish:
      "Multiplies hours worked by an hourly rate and rounds to the nearest cent, rounding up on " +
      "an exact half.",
    whyItExists:
      "It is the most-run calculation in the system, so its rounding rule is a policy decision " +
      "rather than a detail.",
    theTrap:
      "Rounding down, or truncating, because it feels conservative. It is conservative for the " +
      "company and adverse to the worker, and 'we systematically rounded pay down' is a " +
      "sentence you do not want read back to you in a wage-and-hour proceeding. Half a cent a " +
      "paycheck is nothing; the finding is not.",
    whatIWouldDo:
      "Round half up so the boundary favors the employee, keep hours as whole hundredths so the " +
      "inputs are exact too, and never let a float touch either side of the multiplication.",
    authorityIds: [],
  },

  // -------------------------------------------------------------------------
  // The checklist and the gate
  // -------------------------------------------------------------------------
  {
    fn: "findOnboardingStep",
    plainEnglish:
      "Looks up one step of the checklist by its key.",
    whyItExists:
      "The checklist is data, not a hard-coded screen, so the UI, the server action and the " +
      "tests all read the same list. One definition means the screen cannot require something " +
      "different from what the database enforces.",
    theTrap:
      "Duplicating the step list in the interface 'just for display'. The moment there are two " +
      "lists, one of them is out of date, and it is always the one being enforced.",
    whatIWouldDo:
      "Keep the definition in one exported constant and treat any second copy as a bug.",
    authorityIds: [],
  },
  {
    fn: "evaluateOnboarding",
    plainEnglish:
      "Runs the whole checklist and reports, step by step, what is done, what is missing, which " +
      "exact fields are wrong, and whether this person can be saved to payroll at all.",
    whyItExists:
      "This is the function you asked for: 'It should have a check list of task to be completed " +
      "before it lets you save them to the system.' The screen and the server action both call " +
      "it, so what you see highlighted and what the database refuses are computed by the same " +
      "code. They cannot drift apart.",
    theTrap:
      "Warning instead of refusing. Sage's payroll wizard enables its Finish button on the very " +
      "first screen, marks exactly one field as required in the entire flow, and congratulates " +
      "you at the end regardless of what you left blank. A warning that does not stop the save " +
      "is a warning that gets clicked through on a Friday afternoon, and then it is in the data " +
      "forever.",
    whatIWouldDo:
      "Separate the things that legally must be right before you may run payroll - identity, " +
      "I-9, W-4, pay, labor role - from the things that are real obligations on their own clock, " +
      "like the 20-day new-hire report. Block on the first set. Surface the second set with its " +
      "deadline, and do not pretend it prevents you from paying someone.",
    authorityIds: [
      "cfr-8-274a-2-b-1-i-a-section-1-at-hire",
      "cfr-31-3402-f-2-1-a-1-furnish-on-commencement",
      "rcw-26-23-040-twenty-day-new-hire-report",
    ],
  },
  {
    fn: "onboardingDeadlines",
    plainEnglish:
      "Lists the dates that flow from a hire date: I-9 Section 2, the Washington new-hire report, " +
      "and how long to keep the I-9.",
    whyItExists:
      "Three different clocks start when someone begins work, they run on different units, and " +
      "none of them announce themselves. Business days for the I-9, calendar days for the state " +
      "report, years for retention.",
    theTrap:
      "Assuming they are all calendar days. They are not, and the I-9 one is the tightest of the " +
      "three.",
    whatIWouldDo:
      "Put all three on the screen the day you hire, not in a calendar you have to remember to " +
      "check.",
    authorityIds: [
      "cfr-8-274a-2-b-1-ii-section-2-three-business-days",
      "cfr-8-274a-2-b-2-i-a-retention-period",
      "rcw-26-23-040-twenty-day-new-hire-report",
    ],
  },

  // -------------------------------------------------------------------------
  // The W-4 conversation
  // -------------------------------------------------------------------------
  {
    fn: "noW4DefaultComparison",
    plainEnglish:
      "Builds the two W-4 records worth comparing - the one the employee gave you, and the " +
      "statutory default that applies when nobody gives you one - so you can run both through " +
      "the real tax engine and show the difference in dollars.",
    whyItExists:
      "This is the answer to the question you said you never know how to answer. When someone " +
      "asks how to fill out their W-4, the safe and genuinely useful thing you can tell them is " +
      "what happens if they do nothing: 26 C.F.R. §31.3402(f)(2)-1(a)(4) says you withhold as " +
      "though they were single with no adjustments. For anyone married, or with children, or " +
      "with deductions, that takes MORE tax than they owe, and they are lending the government " +
      "money until they file. That sentence is true, it is citable, and it is not tax advice.",
    theTrap:
      "Answering the question they actually asked. Telling an employee what to write on their " +
      "W-4 is advising on someone else's tax return, and if it is wrong they are the one " +
      "assessed - but you are the one who told them. The line to hold is: explain what the form " +
      "does and what the default costs, hand them the IRS estimator, and never fill in a number " +
      "for them.",
    whatIWouldDo:
      "Show them the comparison in dollars per paycheck, point them at the IRS withholding " +
      "estimator, and put nothing in the boxes yourself. That is exactly the line your " +
      "grandfather would hold, and it is the whole reason this function returns two records " +
      "instead of a recommendation.",
    authorityIds: [
      "cfr-31-3402-f-2-1-a-4-no-certificate-default",
      "cfr-31-3402-f-2-1-a-1-furnish-on-commencement",
    ],
  },
  {
    fn: "payPeriodsRemainingInYear",
    plainEnglish:
      "Estimates how many pay periods are left in the calendar year after a mid-year hire.",
    whyItExists:
      "Federal withholding annualizes each paycheck as though it were earned all year long. " +
      "Someone hired in November whose biweekly gross implies a $60,000 salary has tax withheld " +
      "at $60,000 rates, even though they will actually earn about $5,000 this year.",
    theTrap:
      "Thinking that is a bug and trying to correct for it. It is the method Pub. 15-T " +
      "prescribes, the employee gets the excess back when they file, and 'fixing' it by " +
      "under-withholding creates a real liability for them. The only defect here is surprise.",
    whatIWouldDo:
      "Say it out loud before the first payday of a late-year hire. It costs you one sentence " +
      "and it prevents the conversation where a new employee thinks payroll made a mistake.",
    authorityIds: [],
  },
  {
    fn: "w4RequiredFieldPaths",
    plainEnglish:
      "Lists every W-4 field the screen must render.",
    whyItExists:
      "A field that is not on the form cannot be filled in, and its absence is invisible - it " +
      "looks like a complete form. Listing the fields in code lets a test assert the screen " +
      "shows all of them.",
    theTrap:
      "Omitting the ones that are usually blank, like Step 4(b) deductions. Usually-blank is not " +
      "never-used, and the employee who needs it is the one with an unusual return.",
    whatIWouldDo:
      "Render every field, mark the optional ones as optional, and test that the list and the " +
      "screen agree.",
    authorityIds: ["cfr-31-3402-f-2-1-a-1-furnish-on-commencement"],
  },
  {
    fn: "i9RequiredFieldPaths",
    plainEnglish:
      "Lists every I-9 field the screen must render.",
    whyItExists:
      "Same reason as the W-4 list, with sharper consequences: Sage records I-9 status as two " +
      "dropdowns and captures no document detail whatsoever, so it is structurally incapable of " +
      "telling you that your document set is insufficient.",
    theTrap:
      "Treating the I-9 as a checkbox that says 'done'. That is precisely what the old employee " +
      "record in this repo did, and it is why this slice exists.",
    whatIWouldDo:
      "Capture the documents themselves - category, title, number, expiry - because the document " +
      "set is the thing that is either sufficient or not.",
    authorityIds: ["cfr-8-274a-2-b-1-ii-section-2-three-business-days"],
  },
  {
    fn: "payRequiredFieldPaths",
    plainEnglish:
      "Lists every pay field the screen must render.",
    whyItExists:
      "The pay record is the only part of onboarding with no government form behind it, so " +
      "nothing external reminds you what belongs in it.",
    theTrap:
      "Forgetting the labor role, because it is the one field that has no equivalent in ordinary " +
      "payroll software. For a §280E business it is the field that decides whether a wage is " +
      "cost of goods sold or a disallowed expense.",
    whatIWouldDo:
      "Treat the labor role as mandatory and never default it. Sage's answer to the same problem " +
      "is two pay types both named 'REGULAR' that differ only by which GL account they hit, " +
      "which is a coin flip dressed as a dropdown.",
    authorityIds: [],
  },

  // -------------------------------------------------------------------------
  // THE SCREEN LAYER (payroll-onboarding-ui-core.ts)
  //
  // These are taught for the same reason the engine functions are. Michael's
  // stated problem was not that he cannot do accounting - he has a Master's in
  // it - but that "there is this huge disconnect between me and the system."
  // A function that decides what he sees on screen is exactly the kind of thing
  // that becomes a black box if nobody writes down what it does.
  // -------------------------------------------------------------------------
  {
    fn: "buildChecklistView",
    plainEnglish:
      "Turns the verdict on an employee's setup into the rows you see on screen: what is done, " +
      "what is missing, which boxes to highlight in red, and the one sentence explaining why " +
      "the Save button will not press.",
    whyItExists:
      "You asked for a checklist that refuses to save until it is complete, and for a missing " +
      "field to be highlighted so nothing can silently fail you. This is that checklist. It " +
      "also settles WHO decides: the screen makes no judgement of its own, it renders what the " +
      "engine already concluded.",
    theTrap:
      "Letting the screen decide what counts as 'done'. The moment two screens can disagree " +
      "about whether the same employee is ready, the truth becomes whichever page you happen " +
      "to have open - and a second screen built later would quietly get it wrong.",
    whatIWouldDo:
      "Read the highlighted fields top to bottom and fix them in order. If a row shows a " +
      "deadline, that date is statutory and it is not negotiable - the I-9 one is three " +
      "business days from the first day of work.",
    authorityIds: [],
  },
  {
    fn: "buildWorkedPaycheck",
    plainEnglish:
      "Computes one illustrative paycheck from the setup on screen and shows every line with " +
      "the actual arithmetic next to it, so each figure can be checked on paper.",
    whyItExists:
      "You said you do not use the Sage reports because you do not fully understand what they " +
      "are showing you. That is not an accounting problem, it is a legibility problem: Sage " +
      "prints 'WAPFL ER 26' and gives you no way to see where it came from. This shows the " +
      "formula beside the result. A number you can re-derive is a number you own.",
    theTrap:
      "Believing a total because it is bolded. The dangerous line here is L&I, which is a rate " +
      "per HOUR WORKED, not a percentage of dollars - so on a bonus-only check with no hours " +
      "the correct L&I withholding is nothing at all, and a percentage-based system would " +
      "confidently take money anyway.",
    whatIWouldDo:
      "Nothing here is stored and no liability is created - it is a preview. Read the formula " +
      "column, not just the amounts, and if a line says it could not be computed, that is a " +
      "missing rate notice and not a zero.",
    authorityIds: ["rcw-51-16-140-lni-deduction", "pub15t-2026-automated-method"],
  },
  {
    fn: "formatMilliCentsAsRate",
    plainEnglish:
      "Prints an hourly rate that is stored as thousandths of a cent, so $0.16445 an hour shows " +
      "as $0.16445 rather than being rounded to $0.16.",
    whyItExists:
      "Your L&I notice quotes five decimal places of a dollar, and whole cents physically " +
      "cannot hold that number. Rounding it for display would make the arithmetic on screen " +
      "stop matching the arithmetic in the answer, and then the formula you were given to " +
      "check the number would not reproduce it.",
    theTrap:
      "Rounding for display and then reusing the rounded figure in a calculation. At $0.16 " +
      "instead of $0.16445, a year of full-time hours is off by about $9 per employee - small " +
      "enough to ignore and large enough to make a reconciliation never tie.",
    whatIWouldDo:
      "Treat the five-decimal rate as the real one, because L&I does. It is read straight off " +
      "your rate notice and never derived.",
    authorityIds: ["lni-premium-rate-formula"],
  },
  {
    fn: "formatMilliPct",
    plainEnglish: "Prints a percentage that is stored as thousandths of a percent, so 920 shows as 0.92%.",
    whyItExists:
      "Every Washington premium rate is stored as a whole number to keep floats out of money " +
      "paths, which means 920 has to become '0.92%' somewhere. Doing it in one place is how the " +
      "same rate cannot appear as 0.92% on one line and 0.9% on another.",
    theTrap:
      "Storing rates as decimals like 0.0092 in the first place. That is how a rate ends up a " +
      "hundred or a thousand times too big with nothing to catch it, because every one of those " +
      "numbers looks plausible.",
    whatIWouldDo:
      "Compare the printed percentage against the agency notice it came from. They are all " +
      "dated rows with a document attached, so there is always something to compare to.",
    authorityIds: [],
  },
  {
    fn: "formatHours",
    plainEnglish: "Prints hours that are stored as whole hundredths, so 8000 shows as 80.00 hours.",
    whyItExists:
      "Hours are counted in integer hundredths for the same reason money is counted in integer " +
      "cents: 7.4 hours cannot be represented exactly in binary floating point, and L&I " +
      "premiums are charged per hour worked, so drift in hours becomes drift in a filed premium.",
    theTrap:
      "Dividing by 100 in floating point to display it. That is the one operation here that can " +
      "reintroduce the drift the integer storage exists to prevent, which is why this uses " +
      "integer division and pads the remainder.",
    whatIWouldDo:
      "Check displayed hours against the timeclock total before running payroll. L&I is charged " +
      "on hours, so an hours error is a premium error and a wage error at the same time.",
    authorityIds: ["rcw-51-16-060-lni-hours"],
  },
  {
    fn: "refusalSentence",
    plainEnglish:
      "Joins a refusal into one sentence: what stopped, and the single concrete thing to do " +
      "about it.",
    whyItExists:
      "A refusal that only says what went wrong leaves you stuck. Every refusal in this system " +
      "carries both halves - the problem and the fix - and this is what makes sure the fix is " +
      "actually shown rather than dropped on the floor by whatever is rendering the message.",
    theTrap:
      "Showing 'calculation failed' and nothing else. That is the Sage behaviour you described " +
      "as having no safety nets: it tells you something is wrong without telling you what to do, " +
      "so the practical response is to ignore it.",
    whatIWouldDo:
      "Do the thing the second half of the sentence says. It is written to be the one action " +
      "that unblocks the calculation, usually finding a rate notice.",
    authorityIds: [],
  },
];

/** Look up the lesson for one function. */
export function findOnboardingLesson(fn: string): MentorLesson | undefined {
  return PAYROLL_ONBOARDING_LESSONS.find((l) => l.fn === fn);
}

/**
 * The plain-English handout Michael can give an employee who asks how to fill out
 * their W-4.
 *
 * NOTE WHAT THIS DOES NOT DO: it does not tell them what to write. Every sentence
 * is either a description of what a box does or a statement of what happens by
 * default. That boundary is the entire point - it is the difference between
 * helping an employee and advising on their tax return.
 */
export function w4EmployeeHandout(): readonly string[] {
  return [
    "This form has one job: it tells your employer how much federal income tax to hold back " +
      "from each paycheck. It is not a tax return and nothing on it is final - you can hand in " +
      "a new one any time your situation changes.",
    "If you give us nothing, the law does not let us guess. We are required to withhold as " +
      "though you were single with no adjustments. For a lot of people that takes out more than " +
      "they actually owe, and they get it back when they file. Some people prefer that. It is a " +
      "real choice, not a mistake.",
    "Step 1 is your name, address, Social Security number and filing status. The name has to " +
      "match your Social Security card - if it does not, the government cannot match your " +
      "earnings to you, and that is a problem for your benefits later, not just for paperwork.",
    "Step 2 is only for people with more than one job, or a working spouse. Two employers each " +
      "withholding as though yours is the only income is the most common reason someone owes " +
      "money in April.",
    "Step 3 is for dependents and other credits. It reduces withholding.",
    "Step 4 has three optional boxes: other income that has no withholding of its own, " +
      "deductions beyond the standard one, and any extra flat amount you want held back each " +
      "period.",
    "Step 5 is your signature. Without it the form is not valid and we have to fall back to the " +
      "default above.",
    "If you want a specific number rather than a guess, the IRS publishes a free withholding " +
      "estimator that does the arithmetic properly using your actual situation. That is the " +
      "right tool for the question 'what should I put here'.",
    "One thing we cannot do is fill this in for you or tell you what to claim. Your W-4 drives " +
      "your tax return, and it has to be your answer. We will happily explain what any box " +
      "means, and we will show you what the default withholding would cost you.",
  ] as const;
}
