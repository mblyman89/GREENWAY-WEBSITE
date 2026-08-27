/**
 * src/lib/payroll/form-box-lessons-new-hire.ts   (books-68)
 *
 * A lesson for every box on DSHS 18-463, the Washington new-hire report.
 * The non-obvious fact: this is a CHILD SUPPORT form, not a payroll form —
 * which is why it wants a date of birth and an address and no wages at all.
 * The trap: an incomplete report is a failure to report, at $25/month/employee.
 *
 * Every quote below is verbatim from docs/authorities/state-wa/rcw-26.23.040.txt
 * and is checked character for character by scripts/verify-verbatim-quotes.ts
 * (rules 24 and 35).
 */

import type { BoxLesson } from "./form-box-core";
import {
  NEW_HIRE_FORM_ID,
  RCW_26_23_040_PATH,
  RCW_26_23_040_URL,
} from "./new-hire-report-core";

/** Cited on nearly every box, so it is written once. */
const CITE = "RCW 26.23.040 — Employer reporting requirements";

export const NEW_HIRE_BOX_LESSONS: readonly BoxLesson[] = [
  /* ═══════════════════════════════════════════════════════════════════════
     THE EMPLOYER BLOCK
     ═══════════════════════════════════════════════════════════════════════ */
  {
    formId: NEW_HIRE_FORM_ID,
    box: "E1",
    headline: "Who is doing the hiring",
    plainEnglish:
      "Greenway's legal name and mailing address. This is the block that tells the Division of " +
      "Child Support which employer to contact if one of your new people owes support. It is the " +
      "legal entity name, not the trade name — LYMAN'S MARIJUANA L.L.C. rather than Greenway " +
      "Marijuana — because the state matches this against the entity that holds the EIN.",
    whereItComesFrom:
      "Your company profile (Books → Company information). Nothing here is typed on the form " +
      "itself; if it is wrong here, fix it there and every form that prints it follows.",
    howToReadIt:
      "If this block shows an em dash, the company profile is incomplete and the report will " +
      "refuse rather than mail a form with a blank employer on it.",
    commonMistake:
      "Putting the trade name here because that is what the sign says. DCS matches employer " +
      "records by legal entity; a trade name can leave the report unmatched to your account.",
    whatToDo:
      "Check that the legal name and the mailing address on the company profile are the ones on " +
      "your EIN paperwork. Fix them there once and never think about it again.",
    examples: [
      {
        title: "What Greenway's block prints",
        steps: [
          "Legal entity name from the company profile: LYMAN'S MARIJUANA L.L.C.",
          "Street: 4851 GEIGER RD SE",
          "City, state, ZIP: PORT ORCHARD WA 98366",
        ],
        answer: "LYMAN'S MARIJUANA L.L.C. · 4851 GEIGER RD SE · PORT ORCHARD WA 98366",
        moral: "One profile, every form. The form never becomes a second place to keep the truth.",
      },
    ],
    quotes: [
      {
        cite: CITE,
        quote:
          "The employer's name, address, and identifying number assigned under section 6109 of the internal revenue code of 1986.",
        sourcePath: RCW_26_23_040_PATH,
        sourceUrl: RCW_26_23_040_URL,
        soWhat:
          "Three employer facts are required by statute. This block carries two of them and the " +
          "FEIN box carries the third.",
      },
    ],
    tiesTo: [
      {
        formId: "form_941",
        box: "name",
        why: "Same legal entity name as the federal return. If they disagree, one of them is stale.",
      },
    ],
  },
  {
    formId: NEW_HIRE_FORM_ID,
    box: "E2",
    headline: "Your EIN, printed the way DSHS prints it",
    plainEnglish:
      "The nine-digit federal employer identification number, shown with the hyphen after the " +
      "first two digits: 46-4217016. This is the number that ties the report to every other " +
      "filing Greenway makes, from the 941 to the W-2s.",
    whereItComesFrom:
      "The EIN on your company profile. It is stored as nine digits and the hyphen is added when " +
      "the form prints, so the same number cannot be stored two ways.",
    howToReadIt:
      "If this shows an em dash, the EIN is missing or is not nine digits, and the report refuses.",
    commonMistake:
      "Using the UBI (603-353-555) here because it is the number Washington usually wants. This " +
      "box is the FEDERAL number. The statute names section 6109 of the Internal Revenue Code.",
    whatToDo:
      "Confirm the EIN matches the one on your 941. They are the same number and there is no " +
      "situation in which they should differ.",
    examples: [
      {
        title: "Nine digits become the printed form",
        steps: ["Stored: 464217016", "Split after two digits", "Join with a hyphen"],
        answer: "46-4217016",
        moral: "Formatting is a printing detail, never a storage decision.",
      },
    ],
    quotes: [
      {
        cite: CITE,
        quote:
          "The employer's name, address, and identifying number assigned under section 6109 of the internal revenue code of 1986.",
        sourcePath: RCW_26_23_040_PATH,
        sourceUrl: RCW_26_23_040_URL,
        soWhat:
          "\"Section 6109\" is the federal EIN, which settles the UBI-versus-EIN question the box " +
          "itself does not answer.",
      },
    ],
    tiesTo: [
      {
        formId: "form_941",
        box: "ein",
        why: "The identical nine digits. A mismatch means one of the two was typed rather than read from the profile.",
      },
    ],
  },

  /* ═══════════════════════════════════════════════════════════════════════
     THE NAME BOXES
     ═══════════════════════════════════════════════════════════════════════ */
  {
    formId: NEW_HIRE_FORM_ID,
    box: "LAST NAME",
    headline: "The employee's legal surname",
    plainEnglish:
      "The surname exactly as it appears on the employee's Social Security card. This form is " +
      "how Washington finds people who owe child support, so the name and the SSN have to agree " +
      "with the federal record or the match fails silently.",
    whereItComesFrom:
      "The employee's record. It is the same legal name the W-2 uses, held once and printed by " +
      "both, so a name correction cannot fix one form and miss the other.",
    howToReadIt:
      "An em dash means no legal surname is on file for that person and the report will refuse " +
      "by name rather than print a blank.",
    commonMistake:
      "Entering a married name that has not yet been changed with Social Security. The report " +
      "goes through, matches nothing, and nobody is told.",
    whatToDo:
      "Copy the surname from the Social Security card, not from the W-4 handwriting or from what " +
      "the person is called day to day.",
    examples: [
      {
        title: "From Michael's own example report",
        steps: ["Social Security card reads CLARK", "Enter CLARK", "Printed in the LAST NAME box"],
        answer: "CLARK",
        moral: "The card is the authority for the name, every time.",
      },
    ],
    quotes: [
      {
        cite: CITE,
        quote: "The employee's name, address, social security number, and date of birth",
        sourcePath: RCW_26_23_040_PATH,
        sourceUrl: RCW_26_23_040_URL,
        soWhat:
          "Name is the first of four required employee facts. All four must be present or the " +
          "report is incomplete.",
      },
    ],
    tiesTo: [
      {
        formId: "form_w2",
        box: "e",
        why: "The same legal name. The W-2 and this report are both matched to the SSA record by it.",
      },
    ],
  },
  {
    formId: NEW_HIRE_FORM_ID,
    box: "FIRST NAME",
    headline: "The employee's legal given name",
    plainEnglish:
      "The first name on the Social Security card. Not a nickname, not a shortened version — " +
      "if the card says ZACHARY, the box says ZACHARY even though everyone says Zach.",
    whereItComesFrom: "The employee's record, same source as the W-2's name.",
    howToReadIt: "An em dash means no legal first name is on file and the report refuses.",
    commonMistake:
      "Using the name everyone uses. A nickname is the single most common reason a new-hire " +
      "report fails to match, and it fails quietly.",
    whatToDo: "Read the given name off the Social Security card and type that.",
    examples: [
      {
        title: "Nickname versus legal name",
        steps: ["Everyone says Zach", "The card says ZACHARY", "The box takes the card"],
        answer: "ZACHARY",
        moral: "The friendly name belongs on the schedule, not on a state report.",
      },
    ],
    quotes: [
      {
        cite: CITE,
        quote: "The employee's name, address, social security number, and date of birth",
        sourcePath: RCW_26_23_040_PATH,
        sourceUrl: RCW_26_23_040_URL,
        soWhat: "The statute says name, and a nickname is not the person's name.",
      },
    ],
    tiesTo: [
      {
        formId: "form_w2",
        box: "e",
        why: "Same given name on both. One record feeds them, so they cannot drift apart.",
      },
    ],
  },
  {
    formId: NEW_HIRE_FORM_ID,
    box: "MIDDLE NAME",
    headline: "Middle name — the one box on this form the law does not demand",
    plainEnglish:
      "The middle name or initial. The form prints a box for it, but RCW 26.23.040(3)(a) lists " +
      "only name, address, social security number and date of birth as required contents. So a " +
      "person with no middle name on file does not block the report.",
    whereItComesFrom: "The employee's record, if it is there.",
    howToReadIt:
      "An em dash here is genuinely fine. Every other employee box on this form refuses when it " +
      "is empty; this one does not, and that difference is deliberate.",
    commonMistake:
      "Building a system that treats every printed box as mandatory. Refusing to produce a " +
      "report because a middle initial is missing would be inventing a requirement the " +
      "legislature did not write — and it would stop a report that is due in twenty days.",
    whatToDo:
      "Fill it if you know it, because it helps DCS match the right person. Do not chase it if " +
      "you do not.",
    examples: [
      {
        title: "Why this box does not refuse",
        steps: [
          "The statute lists: name, address, social security number, date of birth",
          "A middle name is not separately listed",
          "So the report builds without it and refuses on the other nine",
        ],
        answer: "No refusal",
        moral: "A printed box and a required box are not the same thing. Read the statute, not the paper.",
      },
    ],
    quotes: [
      {
        cite: CITE,
        quote: "The employee's name, address, social security number, and date of birth",
        sourcePath: RCW_26_23_040_PATH,
        sourceUrl: RCW_26_23_040_URL,
        soWhat:
          "Four facts, and a middle name is not one of them. That is the whole reason this box " +
          "behaves differently from its neighbours.",
      },
    ],
    tiesTo: [],
  },

  /* ═══════════════════════════════════════════════════════════════════════
     THE ADDRESS BLOCK — the gap migration 0208 closed
     ═══════════════════════════════════════════════════════════════════════ */
  {
    formId: NEW_HIRE_FORM_ID,
    box: "ADDRESS",
    headline: "Where the employee lives",
    plainEnglish:
      "The employee's home street address — one line, because the form prints one box. This is " +
      "required by statute, and it is required for a reason that has nothing to do with payroll: " +
      "the Division of Child Support may need to serve documents on this person.",
    whereItComesFrom:
      "The employee's record. Until books-68 this database had no address column at all, which " +
      "meant this report could not be produced complete. Migration 0208 added it.",
    howToReadIt:
      "An em dash means the address was never captured, and the report refuses and names the " +
      "person. That refusal is doing its job.",
    commonMistake:
      "Using a mailing address such as a PO box when the person lives somewhere else, or leaving " +
      "a stale address after somebody moves. A new-hire report is a snapshot; make it a true one.",
    whatToDo:
      "Copy the address off the employee's W-4 or I-9 when you set them up. It takes ten seconds " +
      "at hire and is painful to chase later.",
    examples: [
      {
        title: "One line, because the form has one box",
        steps: [
          "The paper prints a single EMPLOYEE ADDRESS box",
          "The stored value is one street line",
          "City, state and ZIP are their own boxes below",
        ],
        answer: "3444 SW CHRISTMAS TREE LN",
        moral:
          "The database stores the shape the form asks for, so filling the form is reading rather " +
          "than parsing.",
      },
    ],
    quotes: [
      {
        cite: CITE,
        quote: "The employee's name, address, social security number, and date of birth",
        sourcePath: RCW_26_23_040_PATH,
        sourceUrl: RCW_26_23_040_URL,
        soWhat:
          "Address is named in the statute, so a report without one is not a complete report.",
      },
    ],
    tiesTo: [],
  },
  {
    formId: NEW_HIRE_FORM_ID,
    box: "CITY",
    headline: "The employee's city",
    plainEnglish:
      "The city of the home address. Held separately from the street because the form prints it " +
      "in its own box, and because splitting one long address string by guessing where the city " +
      "begins is the kind of cleverness that quietly puts the wrong thing in the wrong box.",
    whereItComesFrom: "The employee's record (migration 0208).",
    howToReadIt: "An em dash means it was never captured and the report refuses by name.",
    commonMistake:
      "Typing the postal city when the person uses a neighbourhood name. Use whatever the USPS " +
      "recognises for the ZIP.",
    whatToDo: "Enter the city exactly as it appears on the employee's own mail.",
    examples: [
      {
        title: "Separate boxes, separate columns",
        steps: ["Street: 8203 177TH AVE CT", "City: LONGBRANCH", "They never share a field"],
        answer: "LONGBRANCH",
        moral: "Store it the way the form asks for it and no parsing is ever needed.",
      },
    ],
    quotes: [
      {
        cite: CITE,
        quote: "The employee's name, address, social security number, and date of birth",
        sourcePath: RCW_26_23_040_PATH,
        sourceUrl: RCW_26_23_040_URL,
        soWhat: "The city is part of the required address.",
      },
    ],
    tiesTo: [],
  },
  {
    formId: NEW_HIRE_FORM_ID,
    box: "STATE",
    headline: "Two letters, and only two",
    plainEnglish:
      "The state as its two-letter postal abbreviation: WA. The form prints a two-character box, " +
      "so the database refuses to store anything else — \"Washington\" would not fit and the " +
      "truncation would be discovered by someone at DSHS rather than by you.",
    whereItComesFrom: "The employee's record (migration 0208).",
    howToReadIt:
      "An em dash means it was never captured. It is deliberately not defaulted to WA, even " +
      "though every current employee lives in Washington.",
    commonMistake:
      "Assuming everyone is in-state. Washington's report covers anyone who \"resides or works\" " +
      "here, so somebody living in Oregon and working in Port Orchard belongs on this report with " +
      "OR in this box.",
    whatToDo: "Enter the two-letter abbreviation for where the employee actually lives.",
    examples: [
      {
        title: "Why it is not defaulted",
        steps: [
          "Every current employee lives in Washington",
          "A default would state where a person lives with nobody having said so",
          "So the box stays empty until someone enters it",
        ],
        answer: "WA",
        moral: "A convenient default is still an unverified claim about a real person.",
      },
    ],
    quotes: [
      {
        cite: CITE,
        quote: "The employee's name, address, social security number, and date of birth",
        sourcePath: RCW_26_23_040_PATH,
        sourceUrl: RCW_26_23_040_URL,
        soWhat: "The state is part of the required address.",
      },
    ],
    tiesTo: [],
  },
  {
    formId: NEW_HIRE_FORM_ID,
    box: "ZIP CODE",
    headline: "Five digits, or ZIP+4",
    plainEnglish:
      "The postal code. Five digits is what the form expects; ZIP+4 with the hyphen is accepted " +
      "because USPS issues it and somebody copying from a W-4 may include it.",
    whereItComesFrom: "The employee's record (migration 0208).",
    howToReadIt: "An em dash means it was never captured and the report refuses.",
    commonMistake:
      "Letting a four-digit ZIP through after a keystroke is dropped. The database rejects that " +
      "at entry so the error names the employee record rather than appearing on a mailed report.",
    whatToDo: "Enter the ZIP from the employee's own mail.",
    examples: [
      {
        title: "Both forms accepted",
        steps: ["98367 is valid", "98367-1234 is valid", "9836 is rejected at entry"],
        answer: "98367",
        moral: "Validate where the person is, not where the paper is.",
      },
    ],
    quotes: [
      {
        cite: CITE,
        quote: "The employee's name, address, social security number, and date of birth",
        sourcePath: RCW_26_23_040_PATH,
        sourceUrl: RCW_26_23_040_URL,
        soWhat: "The ZIP is part of the required address.",
      },
    ],
    tiesTo: [],
  },

  /* ═══════════════════════════════════════════════════════════════════════
     SSN, DOB, HIRE DATE
     ═══════════════════════════════════════════════════════════════════════ */
  {
    formId: NEW_HIRE_FORM_ID,
    box: "SOCIAL SECURITY NUMBER",
    headline: "The full number — the one form that is not allowed to mask it",
    plainEnglish:
      "The employee's complete Social Security number, printed 534-29-8006. Everywhere else in " +
      "this system an SSN appears masked. Here it cannot be: the statute requires it, and a " +
      "masked number makes the report useless to the child support registry, which exists to " +
      "match people.",
    whereItComesFrom:
      "The employee's record. The screen that shows this form is access-gated for exactly this " +
      "reason — it is the one place the full number is on display.",
    howToReadIt:
      "An em dash means either no SSN on file or one that is not nine digits. Both refuse. A " +
      "short number is never padded to make it fit.",
    commonMistake:
      "Reading an ITIN as an SSN. An ITIN begins with 9 and is not a Social Security number; a " +
      "person working on one has a different problem that this form will not solve.",
    whatToDo:
      "Copy the number from the Social Security card during onboarding, alongside the I-9 check " +
      "you are already doing.",
    examples: [
      {
        title: "Stored plain, printed grouped",
        steps: ["Stored: 534298006", "Grouped 3-2-4 when printed"],
        answer: "534-29-8006",
        moral: "One stored form, one printed form, and no chance of two records disagreeing.",
      },
    ],
    quotes: [
      {
        cite: CITE,
        quote: "The employee's name, address, social security number, and date of birth",
        sourcePath: RCW_26_23_040_PATH,
        sourceUrl: RCW_26_23_040_URL,
        soWhat:
          "Required by name. This is why the report cannot be produced from the masked last-four " +
          "the rest of the system uses.",
      },
    ],
    tiesTo: [
      {
        formId: "form_w2",
        box: "a",
        why: "The same nine digits. If the W-2 and this report disagree, one was typed twice.",
      },
    ],
  },
  {
    formId: NEW_HIRE_FORM_ID,
    box: "BIRTH DATE",
    headline: "Date of birth — why a payroll form asks something payroll never needs",
    plainEnglish:
      "The employee's date of birth, printed MM/DD/YYYY. Payroll does not need this to calculate " +
      "anything. Child support enforcement does: a name and an SSN can collide, and a date of " +
      "birth is what distinguishes two people who look the same in a database.",
    whereItComesFrom:
      "The employee's record — the `date_of_birth` column added by migration 0207, which was " +
      "created for the ESD Paid Leave file and turns out to be required here too.",
    howToReadIt:
      "An em dash means no date of birth on file, or a value that is not a real date. Both refuse.",
    commonMistake:
      "Entering the hire date here by accident. They sit side by side on this form, they are " +
      "formatted identically, and nothing about a wrong-but-plausible date looks wrong.",
    whatToDo:
      "Capture the date of birth at onboarding. You already need it for the Paid Leave and WA " +
      "Cares quarterly file, so this is the same keystroke serving two obligations.",
    examples: [
      {
        title: "The same fact, two agencies",
        steps: [
          "DSHS wants it to identify a person for child support",
          "ESD wants it because WA Cares eligibility turns on age",
          "One column, entered once",
        ],
        answer: "10/13/1993",
        moral: "Capture a fact once and every form that needs it is already fed.",
      },
    ],
    quotes: [
      {
        cite: CITE,
        quote: "The employee's name, address, social security number, and date of birth",
        sourcePath: RCW_26_23_040_PATH,
        sourceUrl: RCW_26_23_040_URL,
        soWhat: "The fourth and last of the required employee facts.",
      },
    ],
    tiesTo: [
    ],
  },
  {
    formId: NEW_HIRE_FORM_ID,
    box: "DATE OF HIRE",
    headline: "The date the twenty-day clock starts",
    plainEnglish:
      "The date the employee first performed services for pay — not the date they signed an " +
      "offer, not the date they were added to the schedule. This box is the most consequential " +
      "one on the form, because it is what the deadline is measured from.",
    whereItComesFrom: "The employee's record (`hire_date`).",
    howToReadIt:
      "The screen shows the due date next to each person: hire date plus twenty days. Day twenty " +
      "is still on time; day twenty-one is late.",
    commonMistake:
      "Using the offer-letter date or the orientation date. The statute defines this precisely, " +
      "and the definition is about pay, not paperwork. The rehire trap is the other half: someone " +
      "who left and came back after sixty consecutive days is a NEW hire and must be reported " +
      "again, which surprises most employers.",
    whatToDo:
      "Enter the first day worked for pay. If you are rehiring somebody, count the days since " +
      "they separated — sixty or more and they go on this report again.",
    examples: [
      {
        title: "The twenty-day clock",
        steps: [
          "First day worked for pay: 01/13/2026",
          "Add twenty days",
          "Due 02/02/2026 — and the 2nd itself is still within twenty days",
        ],
        answer: "Due 02/02/2026",
        moral: "\"Within twenty days\" includes the twentieth. The penalty starts the day after.",
      },
      {
        title: "The rehire nobody reports",
        steps: [
          "A seasonal worker leaves on 01 May",
          "They come back on 15 July — seventy-five days later",
          "Seventy-five is at least sixty, so they are a new hire again",
        ],
        answer: "Report them again",
        moral: "A familiar face can still be a new hire. The clock, not the memory, decides.",
      },
    ],
    quotes: [
      {
        cite: CITE,
        quote:
          "Employers shall submit reports within twenty days of the hiring, rehiring, or return to work of the employee",
        sourcePath: RCW_26_23_040_PATH,
        sourceUrl: RCW_26_23_040_URL,
        soWhat: "Twenty days from the hire date in this box. That is the whole deadline.",
      },
      {
        cite: CITE,
        quote: "has been separated from such employment for at least sixty consecutive days",
        sourcePath: RCW_26_23_040_PATH,
        sourceUrl: RCW_26_23_040_URL,
        soWhat:
          "The rehire rule. Sixty consecutive days away turns a returning employee back into a " +
          "reportable new hire.",
      },
      {
        cite: CITE,
        quote: "Twenty-five dollars per month per employee",
        sourcePath: RCW_26_23_040_PATH,
        sourceUrl: RCW_26_23_040_URL,
        soWhat:
          "The civil penalty for failing to report, charged per employee per month — which is why " +
          "an incomplete report is treated here as no report at all.",
      },
    ],
    tiesTo: [
    ],
  },
];
