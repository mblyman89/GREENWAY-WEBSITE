/**
 * src/lib/accounting/company-identity-mentor.ts   (books-31)
 *
 * THE CPA/CFO SITTING NEXT TO MICHAEL WHILE HE FILLS THIS SCREEN IN.
 *
 * He asked for exactly this, in these words:
 *
 *   "This page should be pretty self explanatory, but because I really like to
 *    be thorough and all inclusive, I want this screen to have a mentoring
 *    guiding cpa cfo help me fill it out properly, explain what everything is
 *    used for, where it is used, and why. Give verbatim authoritative source
 *    documents to cite it as well as plain English interpretations of the cited
 *    sources."
 *
 * So every lesson below answers four questions in Michael's order - WHAT this
 * is, WHERE it is used, WHY it matters, and WHAT GOES WRONG - and each one
 * carries the authority ids that back it. The authorities themselves live in
 * `company-identity-authorities.ts`, machine-verified as exact substrings of the
 * mirrored primary sources, so the "verbatim" half of his request is proven
 * rather than promised.
 *
 * THE PLAIN ENGLISH HALF IS NOT OPTIONAL EITHER. Michael has a Master's in
 * accounting from the University of Washington and has not used it in thirteen
 * years. He does not need to be taught what a return is; he needs the specific
 * consequence of the specific box. So `plainEnglish` never restates the quote
 * in longer words - it says what happens to HIM.
 *
 * COVERAGE GATES AT THE BOTTOM. Standing rule 26: every engine ships a mentor
 * layer, and the gate reads the core module FROM DISK rather than trusting that
 * someone remembered. It has caught real omissions in earlier slices.
 */
/*
 * books-33: THE DISK-READING COVERAGE GATES MOVED OUT OF THIS FILE.
 *
 * They now live in `company-identity-mentor-gates.ts`. Not because rule 26 got
 * weaker - the gates are unchanged and still read the engine from disk - but
 * because CompanyInformationForm.tsx is a `"use client"` component that imports
 * the lessons below. That put this module in a browser bundle, `readFileSync`
 * put `node:fs` in it too, and Turbopack refused to build:
 *
 *     the chunking context (unknown) does not support external modules
 *     (request: node:fs)
 *
 * Every Vercel deployment failed on that for several slices while GitHub
 * Actions stayed green, because CI never runs `next build`. Standing rule 65.
 */

import { join } from "node:path";

import { COMPANY_IDENTITY_AUTHORITIES } from "@/lib/accounting/company-identity-authorities";
import { COMPANY_FIELDS, COMPANY_FORMS, FORM_TITLES, fieldsForForm } from "@/lib/accounting/company-identity-core";
import type { CompanyForm } from "@/lib/accounting/company-identity-core";

/* ══════════════════════════════════════════════════════════════════════════ *
 * FIELD LESSONS - what Michael reads beside each input
 * ══════════════════════════════════════════════════════════════════════════ */

export type FieldLesson = {
  /** The company_profile column this teaches. */
  readonly field: string;
  /** WHAT it is, with no jargon. */
  readonly whatItIs: string;
  /** WHERE it is used, naming forms and boxes. */
  readonly whereItIsUsed: string;
  /** WHY it matters - the consequence, not the definition. */
  readonly whyItMatters: string;
  /** The mistake a competent person actually makes here. */
  readonly theTrap: string;
  /** Where to look it up rather than recalling it. */
  readonly howToBeSure: string;
  readonly authorityIds: readonly string[];
};

export const COMPANY_FIELD_LESSONS: readonly FieldLesson[] = [
  {
    field: "ein",
    whatItIs:
      "The nine-digit number the IRS issued to LYMAN'S MARIJUANA L.L.C. It is the account number every " +
      "federal employment filing is posted against.",
    whereItIsUsed:
      "The header of every Form 941 and Form 940, both pages of each. Box b of every employee's Form W-2. " +
      "Box e of the Form W-3. The company identification field of the ACH file. Every EFTPS deposit.",
    whyItMatters:
      "This is the single most consequential field on the screen. An electronically filed 941 with an EIN " +
      "the IRS cannot match is not accepted at all - it is not 'filed with an error', it is not filed - " +
      "and the late-filing clock keeps running while you believe you are done.",
    theTrap:
      "Two traps, and both are common in single-member LLCs. First, using your own Social Security number " +
      "because the business feels like you; Pub. 15 forbids it in one sentence. Second, storing the number " +
      "with its hyphen in one place and without it in another, so two records that should be identical " +
      "differ by a character. This system stores nine digits and adds the hyphen when it prints.",
    howToBeSure:
      "Read it off the IRS CP 575 EIN confirmation letter, or any notice the IRS has sent you. Do not type " +
      "it from memory and do not copy it from a bank form, which may have been keyed by someone else.",
    authorityIds: [
      "pub15-2026-ein-nine-digit",
      "pub15-2026-dont-use-ssn-as-ein",
      "i941-2026-efile-requires-valid-ein",
      "i941-2026-ein-must-match-exactly",
      "iw2w3-2026-box-b-ein",
    ],
  },
  {
    field: "legal_name",
    whatItIs:
      "The business name you wrote on Form SS-4 when you applied for the EIN. For Greenway that is " +
      "LYMAN'S MARIJUANA L.L.C.",
    whereItIsUsed:
      "The Name line of Form 941 and Form 940. Box c of every Form W-2. Box f of the Form W-3. The " +
      "employer name on the WA Form 5208 and the L&I quarterly report.",
    whyItMatters:
      "The IRS matches returns on a 'name control' derived from the first few characters of this name " +
      "against the EIN. If they disagree the return can be rejected or misposted, and a misposted 941 " +
      "looks exactly like an unfiled one from the IRS side.",
    theTrap:
      "Putting 'Greenway Marijuana' here. That is the trade name and it belongs on the next line. The IRS " +
      "instructions give a worked example precisely because this is the mistake everyone makes.",
    howToBeSure:
      "The CP 575 letter, again. If the legal name on the letter differs from your Secretary of State " +
      "record, the letter is what the IRS will match against - and the difference is itself worth fixing.",
    authorityIds: [
      "i940-2025-legal-name-from-ss4",
      "i941-2026-legal-name-vs-trade-name",
      "iw2w3-2026-w3-box-f-employer-name",
    ],
  },
  {
    field: "trade_name",
    whatItIs: "The name the business actually trades under, when it is different. Greenway Marijuana.",
    whereItIsUsed: "The Trade name line of Form 941 and Form 940. Nowhere else.",
    whyItMatters:
      "It tells the IRS that the entity on the Name line is the business the public knows by another name. " +
      "It is not the matching key, so it is far less dangerous than the legal name - but a blank here on a " +
      "business that does trade under a different name means the two names never get connected on paper.",
    theTrap:
      "Filling it in with the same text as the legal name. The instructions say to leave the line blank " +
      "when they are the same, and a duplicate looks like an error to a reviewer.",
    howToBeSure:
      "Your WSLCB licence and your business licence both show the trading name. They should agree with " +
      "each other and with the sign on the building.",
    authorityIds: ["i941-2026-legal-name-vs-trade-name"],
  },
  {
    field: "entity_type",
    whatItIs:
      "How the federal government classifies the business for tax. Greenway is an LLC that elected to be " +
      "taxed as an S-corporation.",
    whereItIsUsed:
      "It decides WHO IS ALLOWED TO SIGN the Form 941 and Form 940, and it decides that you file an 1120-S " +
      "rather than a Schedule C.",
    whyItMatters:
      "The list of people permitted to sign an employment tax return is organised by entity type. Because " +
      "of your S election, Greenway signs under the CORPORATION rule - a principal officer - and not " +
      "under the disregarded-entity rule that would otherwise apply to a single-member LLC. Same person " +
      "in your case, different legal basis, and the title on the form has to reflect it.",
    theTrap:
      "Assuming 'LLC' is the answer to this question. It is not; LLC is a state-law form, and the federal " +
      "classification depends on what you elected. An LLC can be taxed four different ways.",
    howToBeSure:
      "Your accepted Form 2553 election letter, and the fact that you file an 1120-S. If you cannot find " +
      "the 2553 acceptance, that is worth resolving before it matters.",
    authorityIds: [
      "i941-2026-signer-corporation",
      "i941-2026-signer-single-member-llc",
      "i941-2026-signer-sole-proprietor",
      "i941-2026-signer-partnership",
      "i941-2026-signer-trust-or-estate",
    ],
  },
  {
    field: "federal_return_form",
    whatItIs:
      "Whether the IRS expects a Form 941 from you every quarter, or a single Form 944 once a year.",
    whereItIsUsed:
      "It decides which return the filing calendar generates, and which box is checked for Kind of Payer " +
      "on the Form W-3.",
    whyItMatters:
      "Filing the wrong one is a real problem: a 941 filer who files a 944 has three unfiled quarters. " +
      "The instructions for the W-3 say to check only one box, so this is a single stored answer.",
    theTrap:
      "Treating it as a choice. It is not - the IRS notifies employers whose annual liability is small " +
      "enough that they should file Form 944, and you must file what you were told to file.",
    howToBeSure: "The IRS notice that told you. Absent a notice telling you otherwise, you are a 941 filer.",
    authorityIds: ["iw2w3-2026-w3-kind-of-payer-941"],
  },
  {
    field: "deposit_schedule",
    whatItIs:
      "Whether federal payroll tax deposits are due monthly or twice a week, determined by how much tax " +
      "you reported in an earlier twelve-month lookback period.",
    whereItIsUsed:
      "The deposit calendar. Form 941 line 16. Whether you have to attach Schedule B, which a semiweekly " +
      "depositor does and a monthly depositor does not.",
    whyItMatters:
      "Deposit penalties are charged on the deposit being LATE, not on the tax being unpaid, so getting " +
      "the schedule wrong costs money even when every dollar is eventually paid. Depositing early is never " +
      "penalised; depositing on the wrong schedule is.",
    theTrap:
      "Guessing from current wages. The schedule comes from the LOOKBACK period, not from this year, so a " +
      "quiet year can still be a semiweekly year.",
    howToBeSure:
      "This system already computes it - the engine is in payroll-deposit-schedule-core.ts. Because 2027 " +
      "is your first year with payroll here, the answer for the first year comes from your Sage history " +
      "rather than from this system's own data.",
    authorityIds: ["pub15-2026-eft-required"],
  },
  {
    field: "address_line1",
    whatItIs: "The street address the IRS and the SSA will use to write to the business.",
    whereItIsUsed:
      "The address block of Form 941 and Form 940. Box c of every Form W-2. Box g of the Form W-3.",
    whyItMatters:
      "This is where a notice arrives. A notice you never receive still starts a response clock, and the " +
      "penalty for missing it does not care that the address was stale.",
    theTrap:
      "Typing the whole address into one line with commas. It is stored in parts here because the Postal " +
      "Service asks for no commas or periods in return addresses, and because the state has to be " +
      "readable on its own for Form 940.",
    howToBeSure:
      "Compare it to the address printed on the most recent IRS notice you received. If they differ, the " +
      "IRS has the old one and Form 8822-B is how you fix that.",
    authorityIds: ["iw2w3-2026-box-c-employer-address"],
  },
  {
    field: "city",
    whatItIs: "The city of the business mailing address.",
    whereItIsUsed: "Every federal address block: Form 941, Form 940, Form W-2 box c, Form W-3 box g.",
    whyItMatters: "Part of the same delivery address as the street line. Wrong here and the notice does not arrive.",
    theTrap: "Using the postal city when the licensed premises sit in an unincorporated area with a different name.",
    howToBeSure: "The USPS ZIP code lookup will confirm the city name the Postal Service expects for your ZIP.",
    authorityIds: ["iw2w3-2026-box-c-employer-address"],
  },
  {
    field: "state_code",
    whatItIs: "The two-letter state code of the MAILING address. WA.",
    whereItIsUsed:
      "The employer address block on the Form 941, the Form 940, box c of the Form W-2, box e of the " +
      "Form W-3, and the payer address on the Form 1099-NEC.",
    whyItMatters:
      "It is part of the delivery address, and it is deliberately a SEPARATE field from the state whose " +
      "unemployment tax you pay. For Greenway both are WA, so nothing appears to turn on the distinction " +
      "today - which is exactly why it is worth keeping separate before it does.",
    theTrap:
      "Assuming the mailing state and the unemployment-tax state are the same field because they hold the " +
      "same value. A business can be headquartered in one state and have employees in another.",
    howToBeSure:
      "It is on your own letterhead and on the WSLCB licence. If it ever differs from the address the IRS " +
      "has, the IRS copy is the one that governs where a notice is sent.",
    authorityIds: ["iw2w3-2026-box-c-employer-address"],
  },
  {
    field: "zip_code",
    whatItIs: "The five-digit ZIP, or nine digits for ZIP+4, stored without a hyphen.",
    whereItIsUsed:
      "The employer address block on the Form 941, the Form 940, box c of the Form W-2, box e of the " +
      "Form W-3, and the payer address on the Form 1099-NEC.",
    whyItMatters:
      "Same reason as the rest of the address: it is how a notice reaches you, and a notice you never " +
      "received still starts its clock on the day it was mailed. Greenway's is a ZIP+4, 98367-9350, so " +
      "this field holds nine digits rather than five.",
    theTrap:
      "Storing the hyphen in a ZIP+4. Same reasoning as the EIN - punctuation is added when the form is " +
      "printed, so two records cannot differ by a character that carries no meaning.",
    howToBeSure:
      "The USPS ZIP lookup for 4851 Geiger Rd SE returns the ZIP+4. Confirm it matches what appears on " +
      "correspondence the IRS has already sent you.",
    authorityIds: ["iw2w3-2026-box-c-employer-address"],
  },
  {
    field: "contact_name",
    whatItIs: "The person the Social Security Administration should contact about the W-2 filing.",
    whereItIsUsed: "The Employer contact person box of the Form W-3.",
    whyItMatters:
      "The instructions say plainly that this is included for the SSA's use if questions arise during " +
      "processing. It is a real box with a stated purpose, not a courtesy.",
    theTrap:
      "Leaving it blank because it feels optional on a one-person operation. If the SSA cannot resolve a " +
      "name or number mismatch, the alternative to a phone call is a written notice and a deadline.",
    howToBeSure: "It is you. The value is knowing that a call about a W-2 is legitimate when it comes.",
    authorityIds: ["iw2w3-2026-w3-contact-person"],
  },
  {
    field: "contact_phone",
    whatItIs: "The telephone number the SSA should use.",
    whereItIsUsed: "The Employer telephone number box of the Form W-3.",
    whyItMatters: "Same as the contact name: it is the fast path for fixing a W-2 problem before it becomes a notice.",
    theTrap: "A number that rings in the retail area during business hours and is never answered.",
    howToBeSure:
      "Use the number you personally answer, not the store line that rings after hours. The SSA calls " +
      "during business hours about a specific employee name or number, and a voicemail box becomes a " +
      "written notice with a deadline attached.",
    authorityIds: ["iw2w3-2026-w3-contact-person"],
  },
  {
    field: "contact_email",
    whatItIs:
      "The email address the Social Security Administration should use if a question arises while your " +
      "W-2 filing is being processed.",
    whereItIsUsed: "The Employer email address box of the Form W-3.",
    whyItMatters:
      "The instructions note the SSA will notify the employer by email or postal mail about corrections, " +
      "so this is a channel a real notice arrives on rather than a marketing field.",
    theTrap:
      "An address nobody reads, or one tied to a former bookkeeper. An SSA correction notice sitting in an " +
      "abandoned inbox is functionally an unfiled correction.",
    howToBeSure: "Use the address you read daily, and check that it is not full.",
    authorityIds: ["iw2w3-2026-w3-contact-person"],
  },
  {
    field: "signer_name",
    whatItIs: "The name of the person who signs the employment tax returns under penalty of perjury.",
    whereItIsUsed: "Part 5 of Form 941. Part 7 of Form 940. The Form W-3 signature block.",
    whyItMatters:
      "A return signed by somebody not authorised to sign it is not properly filed, and the signature is " +
      "the part that carries personal exposure. This is not a formality.",
    theTrap:
      "Having a bookkeeper or preparer sign without a valid power of attorney on file. The instructions " +
      "permit an agent to sign only when one has been filed.",
    howToBeSure: "For Greenway this is Michael, as its principal officer.",
    authorityIds: ["i941-2026-signer-corporation"],
  },
  {
    field: "signer_title",
    whatItIs: "The signer's title, which has to be one the instructions actually accept for your entity type.",
    whereItIsUsed:
      "Part 5 of the Form 941, where the return is signed, and Part 7 of the Form 940. It is also what " +
      "the ACH and EFTPS authorisations rely on to show that the person submitting money is authorised.",
    whyItMatters:
      "Because Greenway is an LLC treated as a corporation, the signer must be the president, the vice " +
      "president, or another duly authorised principal officer. 'Member' or 'Owner' describes an LLC " +
      "interest, not a corporate office, so it is the wrong answer under the rule that applies to you.",
    theTrap:
      "Writing 'Owner'. It is true and it is not the authorised description. 'President' is the ordinary " +
      "choice for a single-officer S-corporation.",
    howToBeSure:
      "Your operating agreement or corporate minutes should name officers. If they do not, appointing " +
      "yourself president in writing is a ten-minute job that removes the question permanently.",
    authorityIds: [
      "i941-2026-signer-corporation",
      "i941-2026-signer-single-member-llc",
      "i941-2026-signer-sole-proprietor",
      "i941-2026-signer-partnership",
      "i941-2026-signer-trust-or-estate",
    ],
  },
  {
    field: "esd_account_number",
    whatItIs:
      "The Employment Security Department account number Washington assigned when you registered as an " +
      "employer. Greenway's begins 000, which is why it is stored as text.",
    whereItIsUsed:
      "The WA Form 5208A wage detail and 5208B tax report every quarter. It also supports the state " +
      "unemployment information behind the FUTA credit on Form 940.",
    whyItMatters:
      "Two reasons, and the second is the expensive one. First, RCW 50.12.070 requires you to have it. " +
      "Second, the FUTA credit on Form 940 depends on state unemployment tax having actually been paid to " +
      "a state account - and without the credit the federal rate goes from 0.6 percent to 6.0 percent, a " +
      "tenfold increase on the first 7,000 dollars of every employee's wages.",
    theTrap:
      "Dropping the leading zeros, which any spreadsheet will do for you silently. 000-073905-00-0 becomes " +
      "73905000 and matches nothing.",
    howToBeSure: "Any ESD correspondence or your SecureAccess Washington account shows it in full.",
    authorityIds: ["rcw-50-12-070-esd-account-number", "i940-2025-state-reporting-number"],
  },
  {
    field: "wa_ubi",
    whatItIs:
      "The Unified Business Identifier, the nine-digit number Washington uses across its agencies. " +
      "Greenway's is 603 353 555.",
    whereItIsUsed:
      "Business licence renewal, the Department of Revenue combined excise tax return, and as a " +
      "cross-reference on ESD and L&I correspondence.",
    whyItMatters:
      "It is the number that ties your state accounts to each other. RCW 50.12.070 shows Washington treats " +
      "it as an account number to be obtained and preserved.",
    theTrap:
      "Assuming the UBI is what goes on the Form 5208. It is not - the 5208 is keyed on the ESD account " +
      "number. The two are different numbers for different agencies and confusing them wastes a filing.",
    howToBeSure: "Your Washington business licence shows it, printed with spaces.",
    authorityIds: ["rcw-50-12-070-ubi-record"],
  },
  {
    field: "lni_account_number",
    whatItIs: "The Labor & Industries account number for workers' compensation. Greenway's is 521,756-00.",
    whereItIsUsed: "The L&I quarterly report and the workers' compensation premium calculation.",
    whyItMatters:
      "L&I premiums in Washington are charged PER HOUR WORKED, not as a percentage of wages, which makes " +
      "them unlike almost every other payroll tax and makes the hours on your time cards a compliance " +
      "record rather than just a pay input.",
    theTrap:
      "Reformatting the number to remove the comma L&I itself prints. This system stores it as issued, " +
      "which is why there is no digits-only rule on this field.",
    howToBeSure: "Your L&I quarterly report or rate notice.",
    authorityIds: [],
  },
  {
    field: "lni_risk_class",
    whatItIs:
      "The L&I risk classification that describes what your workers do. Greenway's is 6403, Stores - " +
      "Specialty.",
    whereItIsUsed: "The L&I quarterly report, and the per-hour premium rate lookup.",
    whyItMatters:
      "The rate is set per classification, so the wrong class means every hour is priced wrong - in either " +
      "direction. Underpaying accrues a liability you have not recorded.",
    theTrap:
      "Assuming one class covers everyone. A business with genuinely different job types can have more " +
      "than one, and reporting all hours in the cheaper class is the kind of error L&I audits find.",
    howToBeSure: "Your L&I rate notice states the classifications assigned to your account.",
    authorityIds: [],
  },
  {
    field: "suta_state_code",
    whatItIs: "The state whose unemployment tax you are required to pay. WA.",
    whereItIsUsed: "Form 940 line 1a. The state unemployment calculation in the payroll engine.",
    whyItMatters:
      "Line 1a is what tells the IRS you paid state unemployment tax somewhere, which is the basis of the " +
      "FUTA credit. Leave it blank and you are asserting that no wages were subject to state unemployment " +
      "tax - which routes you to line 9 and the full 6.0 percent rate.",
    theTrap:
      "Confusing it with the mailing state. They are the same for Greenway and they are not the same " +
      "question, which is why they are two fields.",
    howToBeSure:
      "It is the state where the work is performed. All Greenway employees work in Port Orchard, so WA.",
    authorityIds: ["i940-2025-one-state-abbreviation", "i940-2025-state-reporting-number"],
  },
];

/* ══════════════════════════════════════════════════════════════════════════ *
 * SCREEN-LEVEL LESSONS - the things that are not about one field
 * ══════════════════════════════════════════════════════════════════════════ */

export type ScreenLesson = {
  readonly topic: string;
  readonly plainEnglish: string;
  readonly whyItMatters: string;
  readonly authorityIds: readonly string[];
};

export const COMPANY_SCREEN_LESSONS: readonly ScreenLesson[] = [
  {
    topic: "Why this is one row and not a list of companies",
    plainEnglish:
      "Pub. 15 says it in six words: you should have only one EIN. One business, one federal identity, one " +
      "record. If a second EIN ever appears in this system, the overwhelmingly likely explanation is a " +
      "typing error rather than a second business.",
    whyItMatters:
      "It is the reason the table is a singleton and the reason every form builder reads the same row. " +
      "There is no 'which company am I filing for' question to get wrong.",
    authorityIds: ["pub15-2026-only-one-ein"],
  },
  {
    topic: "Changing your name or address is an event, not an edit",
    plainEnglish:
      "The IRS requires immediate notice of a change of business name, business address or responsible " +
      "party. A name change goes by letter to the office where you file; an address or responsible-party " +
      "change goes on Form 8822-B, which must NOT be mailed with your return.",
    whyItMatters:
      "This is why editing those fields here raises a reminder instead of quietly saving. It is also why " +
      "the effective dates are stored: a Form 941 for a past quarter should carry the name that was " +
      "correct for that quarter, not the name that is correct today.",
    authorityIds: [
      "pub15-2026-change-of-business-name",
      "pub15-2026-change-of-business-address",
      "i940-2025-notify-name-address-change",
    ],
  },
  {
    topic: "Why the same information appears on several forms",
    plainEnglish:
      "It is not redundancy - it is how the agencies reconcile with each other. The SSA adds up the four " +
      "quarterly 941s filed under your EIN and compares the total to the W-2s you sent it under the same " +
      "EIN. The instructions for the W-2, the W-3 and the 941 each say the identity must match the " +
      "others, in their own words.",
    whyItMatters:
      "It is the entire justification for this screen existing. One stored value feeding every form " +
      "satisfies the matching requirement by construction. Letting each form keep its own copy means the " +
      "day they disagree is the day you find out from a notice.",
    authorityIds: [
      "i941-2026-ein-must-match-exactly",
      "iw2w3-2026-box-b-ein",
      "iw2w3-2026-w3-box-f-employer-name",
      "iw2w3-2026-box-c-employer-address",
    ],
  },
  {
    topic: "Your EIN is not masked, and that is deliberate",
    plainEnglish:
      "This system hides employee Social Security numbers everywhere. It does NOT hide the employer EIN, " +
      "because the W-2 instructions say an employer's EIN may not be truncated on any form.",
    whyItMatters:
      "The asymmetry is in the source, so it has to be in the software. A well-meaning developer applying " +
      "the SSN masking habit to the EIN would produce W-2s the SSA rejects.",
    authorityIds: ["iw2w3-2026-no-truncated-ein", "pub15-2026-dont-use-ssn-as-ein"],
  },
  {
    topic: "Why the state fields are worth as much attention as the federal ones",
    plainEnglish:
      "The FUTA rate is 6.0 percent, and employers who pay state unemployment tax on time get a 5.4 " +
      "percent credit against it, leaving 0.6 percent. The credit is claimed on Form 940 by naming the " +
      "state you paid, so a blank state field is an assertion that you paid none.",
    whyItMatters:
      "A tenfold difference in federal unemployment tax on the first 7,000 dollars of every employee's " +
      "wages, decided by two letters and an account number.",
    authorityIds: ["i940-2025-state-reporting-number", "i940-2025-one-state-abbreviation"],
  },
  {
    topic: "Washington wants HOURS, and that connects this screen to the time clock",
    plainEnglish:
      "RCW 50.12.070 lists what the quarterly report must contain: the wages paid, the full names and " +
      "Social Security numbers of the workers, each worker's occupational classification or job title, and " +
      "THE TOTAL HOURS WORKED BY EACH WORKER. L&I then charges premium per hour rather than per dollar.",
    whyItMatters:
      "Hours are not merely how pay is calculated here - they are a reportable quantity in their own " +
      "right. That is why the time clock has to feed the quarterly reports and not just the paycheck, and " +
      "why hours must survive the trip without being collapsed into money.",
    authorityIds: ["rcw-50-12-070-quarterly-report-contents", "rcw-50-12-070-esd-account-number"],
  },
  {
    topic: "Federal deposits must be electronic, which is why the bank block matters",
    plainEnglish:
      "Pub. 15 leaves no room here: federal tax deposits must be made by electronic funds transfer, and " +
      "you must use EFT for all of them. Writing a cheque is not an available option.",
    whyItMatters:
      "It makes EFTPS enrolment and the originating bank details company-level configuration rather than " +
      "a decision made per payment. Those bank details already live in ach_company_settings from the " +
      "payroll ACH slice, and this screen cross-checks that the EIN inside its company identification " +
      "matches the EIN stored here - because a NACHA file and a Form 941 naming different businesses is " +
      "a problem you want found by software, not by a bank.",
    authorityIds: ["pub15-2026-eft-required", "i941-2026-ein-identifies-taxpayer"],
  },
];

/* ══════════════════════════════════════════════════════════════════════════ *
 * WHAT EACH FORM NEEDS, IN PROSE
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * A plain-English account of which company fields a form consumes.
 *
 * DERIVED, not written. Standing rule 62 again: the consumer declarations in
 * `company-identity-core.ts` are the single source of truth, so this narration
 * cannot fall out of step with the readiness engine. A hand-written paragraph
 * per form would have been more elegant prose and a guaranteed future lie.
 */
export function explainFormNeeds(form: CompanyForm): {
  readonly form: CompanyForm;
  readonly title: string;
  readonly required: readonly string[];
  readonly conditional: readonly string[];
  readonly optional: readonly string[];
  readonly narration: string;
} {
  const specs = fieldsForForm(form);
  const pick = (n: string) =>
    specs.filter((s) => s.consumers.some((c) => c.form === form && c.necessity === n)).map((s) => s.label);

  const required = pick("required");
  const conditional = pick("conditional");
  const optional = pick("optional");

  const parts: string[] = [];
  if (required.length > 0) {
    parts.push(
      `${FORM_TITLES[form]} cannot be produced without ${required.length} ` +
        `${required.length === 1 ? "field" : "fields"}: ${required.join(", ")}.`,
    );
  } else {
    parts.push(`${FORM_TITLES[form]} has no absolutely required company fields recorded yet.`);
  }
  if (conditional.length > 0) {
    parts.push(
      `These depend on circumstances and are worth confirming rather than leaving blank by accident: ` +
        `${conditional.join(", ")}.`,
    );
  }
  if (optional.length > 0) {
    parts.push(`These improve the filing but do not block it: ${optional.join(", ")}.`);
  }

  return { form, title: FORM_TITLES[form], required, conditional, optional, narration: parts.join(" ") };
}

/* ══════════════════════════════════════════════════════════════════════════ *
 * COVERAGE GATES - standing rule 26, and rule 39 applied to the gates
 * ══════════════════════════════════════════════════════════════════════════ */

/** Field names that have a lesson. */
export function taughtFieldNames(): readonly string[] {
  return COMPANY_FIELD_LESSONS.map((l) => l.field);
}

/**
 * Every field in the registry must be taught.
 *
 * A field with an input on screen and no explanation beside it is exactly what
 * Michael asked us not to build. This reads COMPANY_FIELDS rather than a list,
 * so adding a field without a lesson fails here.
 */
export function assertEveryFieldIsTaught(): void {
  if (COMPANY_FIELDS.length === 0) {
    throw new Error(
      "MENTOR COVERAGE GATE BROKEN: the field registry is empty, so the gate would approve everything. " +
        "A gate that reads nothing is not a gate.",
    );
  }
  const taught = new Set(taughtFieldNames());
  const untaught = COMPANY_FIELDS.filter((f) => !taught.has(f.field)).map((f) => f.field);
  if (untaught.length > 0) {
    throw new Error(
      `MENTOR COVERAGE GAP: these company fields have no lesson: ${untaught.join(", ")}. Standing rule 26 ` +
        `requires every field on this screen to be explained before it ships, and Michael asked for a ` +
        `mentor that explains "what everything is used for, where it is used, and why".`,
    );
  }
}

/**
 * No lesson may teach a field that does not exist.
 *
 * The other direction, and it matters: a lesson for a renamed or deleted column
 * renders help text beside nothing, which reads as reassurance while covering a
 * field the software no longer has.
 */
export function assertNoLessonForUnknownField(): void {
  const known = new Set(COMPANY_FIELDS.map((f) => f.field));
  const stray = COMPANY_FIELD_LESSONS.filter((l) => !known.has(l.field)).map((l) => l.field);
  if (stray.length > 0) {
    throw new Error(
      `MENTOR TEACHES FIELDS THAT DO NOT EXIST: ${stray.join(", ")}. Either the column was renamed and ` +
        `the lesson was not, or the lesson is for a field that was never added.`,
    );
  }
}

/** Every authority id cited by any lesson must exist. */
export function assertEveryCitedAuthorityExists(): void {
  const known = new Set(COMPANY_IDENTITY_AUTHORITIES.map((a) => a.id));
  if (known.size === 0) {
    throw new Error(
      "MENTOR CITATION GATE BROKEN: the authority registry is empty, so every citation would pass " +
        "vacuously.",
    );
  }
  const dangling: string[] = [];
  for (const l of COMPANY_FIELD_LESSONS) {
    for (const id of l.authorityIds) if (!known.has(id)) dangling.push(`${l.field} -> ${id}`);
  }
  for (const l of COMPANY_SCREEN_LESSONS) {
    for (const id of l.authorityIds) if (!known.has(id)) dangling.push(`${l.topic} -> ${id}`);
  }
  if (dangling.length > 0) {
    throw new Error(
      `MENTOR CITES AUTHORITIES THAT DO NOT EXIST: ${dangling.join(", ")}. A citation with nothing ` +
        `behind it is worse than none, because the reader believes it was checked.`,
    );
  }
}

/**
 * Every authority in the registry is used by something.
 *
 * An unused authority is mirrored text nobody reads - not harmful, but it means
 * research was done and then not connected, and the honest response is to
 * notice rather than to accumulate. Reported as a list rather than thrown,
 * because there are legitimate reasons for one (an authority kept to document
 * an alternative branch, like the disregarded-entity signer rule).
 */
export function unusedAuthorityIds(): readonly string[] {
  const used = new Set<string>();
  for (const l of COMPANY_FIELD_LESSONS) for (const id of l.authorityIds) used.add(id);
  for (const l of COMPANY_SCREEN_LESSONS) for (const id of l.authorityIds) used.add(id);
  for (const f of COMPANY_FIELDS) for (const id of f.authorityIds) used.add(id);
  return COMPANY_IDENTITY_AUTHORITIES.filter((a) => !used.has(a.id)).map((a) => a.id);
}

/** Every form in COMPANY_FORMS can be narrated. Cheap, and catches a missing title. */
export function assertEveryFormCanBeExplained(): void {
  for (const f of COMPANY_FORMS) {
    const e = explainFormNeeds(f);
    if (!e.title || e.title.trim() === "") {
      throw new Error(`FORM WITH NO TITLE: ${f}. Add it to FORM_TITLES.`);
    }
    if (e.narration.trim() === "") {
      throw new Error(`FORM WITH NO NARRATION: ${f}.`);
    }
  }
}
