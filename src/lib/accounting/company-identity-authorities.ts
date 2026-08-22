/**
 * src/lib/accounting/company-identity-authorities.ts   (books-31)
 *
 * WHO GREENWAY IS, IN THE WORDS OF THE AGENCIES THAT WILL READ THE FORMS.
 *
 * Michael asked for this slice in one paragraph:
 *
 *   "Please begin work on the next slice, company information setup. I want to
 *    make sure we record every company detail we need according to all the
 *    different forms they will be auto filling for me. What ever the industry
 *    standard enterprise grade solution would do and include, we should do so
 *    as well. Since this info will be used to fill all the forms and whatever
 *    else it's used for, I want to make sure we are building forward thinking
 *    so everything downstream from this info page will flow into all the
 *    reports and forms."
 *
 * That is a data-modelling instruction, and the only honest way to answer it is
 * to READ THE FORMS FIRST. So this registry is not a list of interesting facts
 * about business identity. It is the set of sentences, quoted exactly, that say
 * what belongs in a specific box on a specific return, and what happens when
 * the box is wrong. Every field on the company-information screen traces to one
 * of these, and a field that traces to none of them does not belong on the
 * screen.
 *
 * WHY THE FORM INSTRUCTIONS AND NOT JUST PUB. 15. Publication 15 is the
 * employer's handbook: it explains what an EIN IS. The Instructions for Form
 * 941 explain which line the EIN goes on and state that an electronically filed
 * return WILL BE REJECTED if the EIN does not match IRS records. The second
 * kind of sentence is the one that justifies making a field required and
 * refusing to file without it, so the second kind of document had to be
 * mirrored. Three were added in this slice:
 *
 *   docs/authorities/federal/irs-instructions-w-2-w-3-2026.txt   (36 pp)
 *   docs/authorities/federal/irs-instructions-941-2026.txt           (17 pp)
 *   docs/authorities/federal/irs-instructions-940-2025.txt           (16 pp)
 *
 * A NOTE ON THE FORM 940 YEAR, BECAUSE IT LOOKS LIKE A MISTAKE AND IS NOT.
 * W-2/W-3 and 941 are cited at their 2026 editions; Form 940 is cited at 2025.
 * Form 940 is an ANNUAL return whose instructions are published late in the
 * year, and at the time this slice shipped the 2026 edition did not yet exist.
 * Citing a 2026 Form 940 would have been a guess (standing rule 1), so the
 * citation states the edition actually read. When the 2026 instructions appear,
 * the mirrored file and these four ids get updated together and the verbatim
 * checker will fail loudly if the wording moved.
 *
 * THE WASHINGTON SIDE. RCW 50.12.070 is the statute that makes Greenway
 * register with the Employment Security Department and obtain an employment
 * security account number, and it is also where the Unified Business Identifier
 * appears in the unemployment-insurance context. It is quoted rather than
 * paraphrased because the quarterly report contents it lists - names, SSNs,
 * hours worked, occupational classification - are precisely the columns the
 * Form 5208 builder will have to produce from the time clock.
 *
 * SOURCE DISCIPLINE (standing rules 24 and 35). Every quote below is an EXACT
 * substring of a primary source mirrored under `docs/authorities/`, and
 * `scripts/verify-verbatim-quotes.ts` proves it by machine on every run. All
 * twenty-five were verified mechanically BEFORE this file was written, against
 * the same normalisation the checker uses, not after.
 */

/**
 * The shared authority record shape used by every registry in this codebase.
 *
 * Re-declared structurally rather than imported from `books-guidance-core`
 * because that module imports THIS one; a direct import would be circular. The
 * merge function `fromCompanyIdentity` in books-guidance-core is what proves
 * the two shapes agree, and it will not compile if they drift.
 */
export type CompanyIdentityAuthority = {
  readonly id: string;
  readonly kind: "irs_guidance" | "statute";
  readonly cite: string;
  readonly quote: string;
  readonly soWhat: string;
  readonly source: string;
};

/* ------------------------------------------------------------------ *
 * THE EMPLOYER IDENTIFICATION NUMBER
 * ------------------------------------------------------------------ */

/**
 * What an EIN is and what it is for.
 *
 * The reason the field is nine digits and stored WITHOUT the hyphen: the hyphen
 * is display formatting the IRS specifies for printed forms ("00-0000000"), not
 * part of the number. Storing the formatted string invites two records that
 * differ only by punctuation.
 */
export const EIN_IS_NINE_DIGITS: CompanyIdentityAuthority = {
  id: "pub15-2026-ein-nine-digit",
  kind: "irs_guidance",
  cite: "IRS Pub. 15 (2026), 'Employer identification number (EIN)'",
  quote:
    "The EIN is a nine-digit number the IRS issues. The digits are arranged as follows: 00-0000000. " +
    "It is used to identify the tax accounts of employers and certain others who have no employees. " +
    "Use your EIN on all of the items you send to the IRS and the SSA.",
  soWhat:
    "The EIN is the primary key the IRS and the Social Security Administration use for Greenway. It is " +
    "stored as nine digits with no punctuation and formatted 00-0000000 only when a form is rendered, " +
    "because the hyphen is presentation and not data.",
  source: "https://www.irs.gov/pub/irs-pdf/p15.pdf",
};

/** One business, one number. Justifies the singleton row. */
export const ONLY_ONE_EIN: CompanyIdentityAuthority = {
  id: "pub15-2026-only-one-ein",
  kind: "irs_guidance",
  cite: "IRS Pub. 15 (2026), 'Employer identification number (EIN)'",
  quote: "You should have only one EIN.",
  soWhat:
    "This is why the company profile is a single row and not a table of companies. A second EIN in this " +
    "system would almost always mean a data-entry error rather than a second business.",
  source: "https://www.irs.gov/pub/irs-pdf/p15.pdf",
};

/**
 * Never an SSN in the EIN box.
 *
 * Worth quoting even though it sounds obvious: Greenway is an LLC, and LLC
 * owners routinely put their own SSN on things. The validator refuses a value
 * that matches the owner's SSN outright.
 */
export const NO_SSN_IN_PLACE_OF_EIN: CompanyIdentityAuthority = {
  id: "pub15-2026-dont-use-ssn-as-ein",
  kind: "irs_guidance",
  cite: "IRS Pub. 15 (2026), 'Employer identification number (EIN)'",
  quote: "Don\u2019t use an SSN in place of an EIN.",
  soWhat:
    "The EIN validator rejects any value that is a known personal SSN in this system. A single-member " +
    "LLC owner is exactly the person most likely to make this substitution.",
  source: "https://www.irs.gov/pub/irs-pdf/p15.pdf",
};

/**
 * The sentence that makes the EIN a hard requirement rather than a nice-to-have.
 *
 * This is the difference between the Publication and the Instructions. Pub. 15
 * describes the number; this says the return is REJECTED without a valid one.
 */
export const EFILE_REQUIRES_VALID_EIN: CompanyIdentityAuthority = {
  id: "i941-2026-efile-requires-valid-ein",
  kind: "irs_guidance",
  cite: "IRS Instructions for Form 941 (2026), 'Employer identification number (EIN)' (Caution)",
  quote:
    "If you\u2019re filing your tax return electronically, a valid EIN is required at the time the return is " +
    "filed. If a valid EIN isn\u2019t provided, the return won\u2019t be accepted. This may result in penalties.",
  soWhat:
    "A blank or malformed EIN is not a cosmetic gap; it is a rejected return and a late-filing penalty " +
    "clock that keeps running. The company profile refuses to report itself ready to file without one.",
  source: "https://www.irs.gov/pub/irs-pdf/i941.pdf",
};

/** Why the EIN is monitored across every filing, not just checked once. */
export const EIN_IDENTIFIES_TAXPAYER: CompanyIdentityAuthority = {
  id: "i941-2026-ein-identifies-taxpayer",
  kind: "irs_guidance",
  cite: "IRS Instructions for Form 941 (2026), 'Employer identification number (EIN)'",
  quote:
    "To make sure businesses comply with federal tax laws, the IRS monitors tax filings and payments by " +
    "using a numerical system to identify taxpayers. A unique nine-digit EIN is assigned to all " +
    "corporations, partnerships, and some sole proprietors. A business needing an EIN must apply for a " +
    "number and use it throughout the life of the business on all tax returns, payments, and reports.",
  soWhat:
    "'Throughout the life of the business on all tax returns, payments, and reports' is the design " +
    "requirement: one stored EIN feeds the 941, the 940, the W-2 batch, the W-3 and the ACH file, and " +
    "none of those consumers may hold its own copy.",
  source: "https://www.irs.gov/pub/irs-pdf/i941.pdf",
};

/** Cross-form consistency is itself a rule, not just good practice. */
export const EIN_MUST_MATCH_EXACTLY: CompanyIdentityAuthority = {
  id: "i941-2026-ein-must-match-exactly",
  kind: "irs_guidance",
  cite: "IRS Instructions for Form 941 (2026), 'Employer identification number (EIN)'",
  quote:
    "Always be sure the EIN on the form you file exactly matches the EIN the IRS assigned to your business.",
  soWhat:
    "The word is 'exactly'. This is the authority behind storing the EIN in one place and deriving every " +
    "form from it, rather than letting each form builder carry a default.",
  source: "https://www.irs.gov/pub/irs-pdf/i941.pdf",
};

/** The W-2 must carry the same EIN as the 941. */
export const W2_BOX_B_EIN: CompanyIdentityAuthority = {
  id: "iw2w3-2026-box-b-ein",
  kind: "irs_guidance",
  cite: "IRS Instructions for Forms W-2 and W-3 (2026), 'Box b - Employer identification number (EIN)'",
  quote:
    "Show the EIN assigned to you by the IRS (00-0000000). This should be the same number that you used " +
    "on your federal employment tax returns (Forms 941, 943, 944, CT-1, or Schedule H (Form 1040)). Do " +
    "not truncate your EIN.",
  soWhat:
    "The SSA reconciles the W-2 batch against the four quarterly 941s under one EIN. A mismatch produces " +
    "an SSA notice, not a silent acceptance, so the W-2 builder reads the same stored field the 941 " +
    "builder reads.",
  source: "https://www.irs.gov/pub/irs-pdf/iw2w3.pdf",
};

/**
 * Truncation is allowed for an employee SSN and forbidden for an employer EIN.
 *
 * A genuinely asymmetric rule, and worth its own record because a developer who
 * has just implemented SSN masking will reasonably assume the same treatment
 * applies to the EIN.
 */
export const EIN_MAY_NOT_BE_TRUNCATED: CompanyIdentityAuthority = {
  id: "iw2w3-2026-no-truncated-ein",
  kind: "irs_guidance",
  cite: "IRS Instructions for Forms W-2 and W-3 (2026), 'Reminders'",
  quote: "An employer\u2019s EIN may not be truncated on any form.",
  soWhat:
    "This system masks employee SSNs everywhere. It must NOT extend that habit to the employer EIN - the " +
    "asymmetry is deliberate in the source and is therefore deliberate in the renderer.",
  source: "https://www.irs.gov/pub/irs-pdf/iw2w3.pdf",
};

/* ------------------------------------------------------------------ *
 * LEGAL NAME, TRADE NAME AND ADDRESS
 * ------------------------------------------------------------------ */

/**
 * The single most important field distinction on the whole screen.
 *
 * Greenway trades as "Greenway Marijuana". Its legal name is
 * "LYMAN'S MARIJUANA L.L.C.". These are two fields, they go on two different
 * lines, and putting the trade name on the Name line is the classic cause of an
 * IRS name-control mismatch.
 */
export const LEGAL_NAME_VS_TRADE_NAME: CompanyIdentityAuthority = {
  id: "i941-2026-legal-name-vs-trade-name",
  kind: "irs_guidance",
  cite: "IRS Instructions for Form 941 (2026), 'Enter Your Business Information at the Top of the Form'",
  quote:
    "Generally, enter the business (legal) name you used when you applied for your EIN. For example, if " +
    "you\u2019re a sole proprietor, enter \u201cHaleigh Smith\u201d on the \u201cName\u201d line and \u201cHaleigh\u2019s Cycles\u201d on the " +
    "\u201cTrade name\u201d line. Leave the \u201cTrade name\u201d line blank if it is the same as your \u201cName.\u201d",
  soWhat:
    "Legal name and trade name are two stored fields, never one. Greenway's legal name is LYMAN'S " +
    "MARIJUANA L.L.C. and its trade name is Greenway Marijuana; the 941 Name line takes the first and " +
    "the Trade name line takes the second.",
  source: "https://www.irs.gov/pub/irs-pdf/i941.pdf",
};

/** The same rule, restated by Form 940, tied explicitly to the SS-4 application. */
export const LEGAL_NAME_FROM_SS4: CompanyIdentityAuthority = {
  id: "i940-2025-legal-name-from-ss4",
  kind: "irs_guidance",
  cite: "IRS Instructions for Form 940 (2025), 'Enter Your Business Information at the Top of the Form'",
  quote:
    "Enter your EIN, name, and address in the spaces provided. You must enter your name and EIN here and " +
    "on page 2. Enter the business (legal) name that you used when you applied for your EIN on Form SS-4.",
  soWhat:
    "The authoritative version of the legal name is whatever was written on the SS-4, not whatever the " +
    "Secretary of State shows today and not what the sign says. The field's help text says so, and asks " +
    "Michael to check the CP 575 EIN confirmation letter rather than recall it.",
  source: "https://www.irs.gov/pub/irs-pdf/i940.pdf",
};

/** The W-3 employer name must match the 941 employer name. */
export const W3_BOX_F_EMPLOYER_NAME: CompanyIdentityAuthority = {
  id: "iw2w3-2026-w3-box-f-employer-name",
  kind: "irs_guidance",
  cite: "IRS Instructions for Forms W-2 and W-3 (2026), 'Box f - Employer\u2019s name'",
  quote:
    "Enter the same name as shown on your Forms 941, 943, 944, CT-1, or Schedule H (Form 1040).",
  soWhat:
    "Another cross-form identity constraint stated by the source itself. One stored legal name satisfies " +
    "it by construction; two copies eventually will not.",
  source: "https://www.irs.gov/pub/irs-pdf/iw2w3.pdf",
};

/**
 * The employer address, including the Postal Service's punctuation preference.
 *
 * The 'no commas or periods' sentence is quoted because it changes how the
 * address is STORED - in structured parts, so the renderer can emit it without
 * punctuation - rather than as one free-text blob typed with commas.
 */
export const W2_BOX_C_EMPLOYER_ADDRESS: CompanyIdentityAuthority = {
  id: "iw2w3-2026-box-c-employer-address",
  kind: "irs_guidance",
  cite: "IRS Instructions for Forms W-2 and W-3 (2026), 'Box c - Employer\u2019s name, address, and ZIP code'",
  quote:
    "This entry should be the same as shown on your Forms 941, 943, 944, CT-1, or Schedule H (Form 1040). " +
    "The U.S. Postal Service recommends that no commas or periods be used in return addresses.",
  soWhat:
    "The address is stored as separate street / city / state / ZIP fields rather than one text box, so " +
    "the renderer can satisfy the punctuation preference and so the state field can also answer Form " +
    "940 line 1a. A single blob could do neither.",
  source: "https://www.irs.gov/pub/irs-pdf/iw2w3.pdf",
};

/* ------------------------------------------------------------------ *
 * CHANGES OF NAME, ADDRESS AND RESPONSIBLE PARTY
 * ------------------------------------------------------------------ */

/** Changing the legal name is an event with an obligation attached. */
export const NOTIFY_NAME_CHANGE: CompanyIdentityAuthority = {
  id: "pub15-2026-change-of-business-name",
  kind: "irs_guidance",
  cite: "IRS Pub. 15 (2026), 'Change of business name'",
  quote: "Notify the IRS immediately if you change your business name.",
  soWhat:
    "Editing the legal name in this system is therefore not a silent field update. The screen raises a " +
    "reminder that the IRS must be told, and the change is recorded with its effective date so the " +
    "correct name lands on the correct quarter's return.",
  source: "https://www.irs.gov/pub/irs-pdf/p15.pdf",
};

/** Same for address and for the responsible party. */
export const NOTIFY_ADDRESS_CHANGE: CompanyIdentityAuthority = {
  id: "pub15-2026-change-of-business-address",
  kind: "irs_guidance",
  cite: "IRS Pub. 15 (2026), 'Change of business address or responsible party'",
  quote: "Notify the IRS immediately if you change your business address or responsible party.",
  soWhat:
    "'Responsible party' is a distinct concept from owner or officer and it has its own notification " +
    "duty, which is why it is a stored field rather than something inferred from the signer.",
  source: "https://www.irs.gov/pub/irs-pdf/p15.pdf",
};

/** Form 940 names the mechanism: Form 8822-B, and it is not attached to the return. */
export const NOTIFY_VIA_FORM_8822B: CompanyIdentityAuthority = {
  id: "i940-2025-notify-name-address-change",
  kind: "irs_guidance",
  cite:
    "IRS Instructions for Form 940 (2025), 'Tell Us if You Change Your Business Name, Business Address, " +
    "or Responsible Party'",
  quote:
    "Notify the IRS immediately if you change your business name, business address, or responsible party.",
  soWhat:
    "The reminder this system raises names the actual mechanism - a written notice for a name change, " +
    "Form 8822-B for an address or responsible-party change - so the prompt is actionable rather than " +
    "merely worrying.",
  source: "https://www.irs.gov/pub/irs-pdf/i940.pdf",
};

/* ------------------------------------------------------------------ *
 * WHAT KIND OF FILER GREENWAY IS
 * ------------------------------------------------------------------ */

/**
 * Kind of Payer on the W-3.
 *
 * Greenway files Forms 941 and nothing else in this family, so the answer is
 * the '941' box. It is stored rather than hardcoded because the same screen has
 * to survive Greenway becoming a 944 filer, which the IRS decides and notifies.
 */
export const W3_KIND_OF_PAYER: CompanyIdentityAuthority = {
  id: "iw2w3-2026-w3-kind-of-payer-941",
  kind: "irs_guidance",
  cite: "IRS Instructions for Forms W-2 and W-3 (2026), 'Box b - Kind of Payer'",
  quote:
    "Check the box that applies to you. Check only one box. If you have more than one type of Form W-2, " +
    "send each type with a separate Form W-3.",
  soWhat:
    "'Check only one box' makes this a single stored enumeration, not a set of independent flags. " +
    "Greenway's value is 941; the field exists because the IRS can move an employer to Form 944 by " +
    "notice, and when it does, the W-3 must follow.",
  source: "https://www.irs.gov/pub/irs-pdf/iw2w3.pdf",
};

/**
 * Who may sign, for an LLC treated as a corporation.
 *
 * Greenway is an LLC with an S-corporation election, so it is 'a limited
 * liability company (LLC) treated as a corporation' and this is the governing
 * line. Michael signs as its principal officer.
 */
export const SIGNER_CORPORATION: CompanyIdentityAuthority = {
  id: "i941-2026-signer-corporation",
  kind: "irs_guidance",
  cite: "IRS Instructions for Form 941 (2026), 'Part 5: Sign Here (Approved Roles)'",
  quote:
    "Corporation (including a limited liability company (LLC) treated as a corporation)\u2014The president, " +
    "the vice president, or another principal officer duly authorized to sign.",
  soWhat:
    "The stored signer name and title are not decoration on the form; this sentence is the rule they " +
    "have to satisfy. Because Greenway is an LLC that elected S-corporation treatment, this line " +
    "governs and the title recorded must be a principal-officer title.",
  source: "https://www.irs.gov/pub/irs-pdf/i941.pdf",
};

/**
 * The line that would govern if the S election did not exist.
 *
 * Kept deliberately. The signer rule depends on the entity's federal tax
 * classification, so the classification is a stored field and this record is
 * what makes the alternative branch visible instead of assumed away.
 */
export const SIGNER_SINGLE_MEMBER_LLC: CompanyIdentityAuthority = {
  id: "i941-2026-signer-single-member-llc",
  kind: "irs_guidance",
  cite: "IRS Instructions for Form 941 (2026), 'Part 5: Sign Here (Approved Roles)'",
  quote:
    "Single-member LLC treated as a disregarded entity for federal income tax purposes\u2014The owner of the " +
    "LLC or a principal officer duly authorized to sign.",
  soWhat:
    "Stored side by side with the corporation rule so the screen can show Michael WHY his S election " +
    "changes who signs. If the election ever lapsed, this is the line that would take over.",
  source: "https://www.irs.gov/pub/irs-pdf/i941.pdf",
};

/**
 * Who signs for a sole proprietorship.
 *
 * Not Greenway's classification, and stored anyway. `company_profile` accepts
 * nine entity types because the check constraint accepts nine, and standing
 * rule 48 says a check that cannot classify its input must FAIL rather than
 * skip. If `signerRuleFor` returned null for a value the database happily
 * stores, the screen would go quiet on a question it is supposed to answer, so
 * every storable classification gets the line that governs it.
 */
export const SIGNER_SOLE_PROPRIETOR: CompanyIdentityAuthority = {
  id: "i941-2026-signer-sole-proprietor",
  kind: "irs_guidance",
  cite: "IRS Instructions for Form 941 (2026), 'Part 5: Sign Here (Approved Roles)'",
  quote: "Sole proprietorship\u2014The individual who owns the business.",
  soWhat:
    "For a sole proprietorship there is no officer title to record: the owner signs personally. Stored " +
    "so the screen can answer the signer question for this classification instead of falling silent.",
  source: "https://www.irs.gov/pub/irs-pdf/i941.pdf",
};

/**
 * Who signs for a partnership, an LLC treated as a partnership, or an
 * unincorporated organisation.
 *
 * The IRS groups all three in one sentence, so one record covers the three
 * stored entity types that map to it.
 */
export const SIGNER_PARTNERSHIP: CompanyIdentityAuthority = {
  id: "i941-2026-signer-partnership",
  kind: "irs_guidance",
  cite: "IRS Instructions for Form 941 (2026), 'Part 5: Sign Here (Approved Roles)'",
  quote:
    "Partnership (including an LLC treated as a partnership) or unincorporated organization\u2014A " +
    "responsible and duly authorized partner, member, or officer having knowledge of its affairs.",
  soWhat:
    "Notice the extra requirement the corporate rule does not carry: the signer must have KNOWLEDGE OF " +
    "ITS AFFAIRS, not merely authority. A partner who signs without knowing the numbers does not " +
    "satisfy this sentence.",
  source: "https://www.irs.gov/pub/irs-pdf/i941.pdf",
};

/** Who signs for a trust or an estate. */
export const SIGNER_TRUST_OR_ESTATE: CompanyIdentityAuthority = {
  id: "i941-2026-signer-trust-or-estate",
  kind: "irs_guidance",
  cite: "IRS Instructions for Form 941 (2026), 'Part 5: Sign Here (Approved Roles)'",
  quote: "Trust or estate\u2014The fiduciary.",
  soWhat:
    "The shortest rule in the list and the strictest: only the fiduciary. Stored for completeness so " +
    "that no value the database accepts leaves the signer question unanswered.",
  source: "https://www.irs.gov/pub/irs-pdf/i941.pdf",
};

/** The SSA wants a human being to call. */
export const W3_CONTACT_PERSON: CompanyIdentityAuthority = {
  id: "iw2w3-2026-w3-contact-person",
  kind: "irs_guidance",
  cite:
    "IRS Instructions for Forms W-2 and W-3 (2026), 'Employer\u2019s contact person, Employer\u2019s telephone " +
    "number, Employer\u2019s fax number, and Employer\u2019s email address'",
  quote: "Include this information for use by the SSA if any questions arise during processing.",
  soWhat:
    "Contact person, phone and email are real W-3 boxes with a stated purpose, not CRM data. They are " +
    "stored on the company profile so the W-3 builder never has to ask at filing time.",
  source: "https://www.irs.gov/pub/irs-pdf/iw2w3.pdf",
};

/* ------------------------------------------------------------------ *
 * FEDERAL DEPOSITS
 * ------------------------------------------------------------------ */

/**
 * Why bank details belong to the company record.
 *
 * EFT is mandatory, which means the account the deposits come out of is company
 * configuration and not a per-payment choice.
 */
export const EFT_REQUIRED: CompanyIdentityAuthority = {
  id: "pub15-2026-eft-required",
  kind: "irs_guidance",
  cite: "IRS Pub. 15 (2026), section 11, 'How Must You Deposit Your Federal Tax Deposits?'",
  quote:
    "Federal tax deposits must be made by electronic funds transfer (EFT). You must use EFT to make all " +
    "federal tax deposits.",
  soWhat:
    "Paying a federal deposit by cheque is not an option, so EFTPS enrolment is a company-level fact the " +
    "profile records. This is also the join to the existing ach_company_settings row, which already " +
    "holds the originating bank details for payroll.",
  source: "https://www.irs.gov/pub/irs-pdf/p15.pdf",
};

/* ------------------------------------------------------------------ *
 * WASHINGTON STATE
 * ------------------------------------------------------------------ */

/** The ESD account number exists because a statute says to go and get one. */
export const ESD_ACCOUNT_NUMBER_REQUIRED: CompanyIdentityAuthority = {
  id: "rcw-50-12-070-esd-account-number",
  kind: "statute",
  cite: "RCW 50.12.070(2)(a)(i)",
  quote:
    "Each employer shall register with the department and obtain an employment security account number.",
  soWhat:
    "Greenway's ESD number (000-073905-00-0) is a statutory identifier, not an internal reference. It " +
    "keys the quarterly Form 5208 and it is what the state uses to apply the experience rate.",
  source: "https://app.leg.wa.gov/RCW/default.aspx?cite=50.12.070",
};

/**
 * The quarterly report's contents, which are also the Form 5208 columns.
 *
 * Quoted in full because this single sentence is the specification for what the
 * time clock must be able to produce per employee per quarter: name, SSN,
 * occupational classification, and TOTAL HOURS WORKED. Hours are a Washington
 * reporting requirement in their own right, separate from anything federal.
 */
export const ESD_QUARTERLY_REPORT_CONTENTS: CompanyIdentityAuthority = {
  id: "rcw-50-12-070-quarterly-report-contents",
  kind: "statute",
  cite: "RCW 50.12.070(2)(a)(i)",
  quote:
    "Each employer shall make periodic reports at such intervals as the commissioner may by regulation " +
    "prescribe, setting forth the remuneration paid for employment to workers in its employ, the full " +
    "names and social security numbers of all such workers, the standard occupational classification or " +
    "job title of each worker, and the total hours worked by each worker and such other information as " +
    "the commissioner may by regulation prescribe.",
  soWhat:
    "This is the Form 5208 column list in statutory form, and it is why the time clock is load-bearing " +
    "for compliance rather than merely for pay. Washington wants HOURS per worker per quarter, so hours " +
    "must survive the trip from time_punches to the quarterly report without being collapsed into money.",
  source: "https://app.leg.wa.gov/RCW/default.aspx?cite=50.12.070",
};

/** Where the UBI appears in the unemployment-insurance statute. */
export const UBI_RECORD_REQUIRED: CompanyIdentityAuthority = {
  id: "rcw-50-12-070-ubi-record",
  kind: "statute",
  cite: "RCW 50.12.070(1)(b)",
  quote:
    "An employer who contracts with another person or entity for work subject to chapter 18.27 or 19.28 " +
    "RCW shall obtain and preserve a record of the unified business identifier account number for and " +
    "compensation paid to the person or entity performing the work.",
  soWhat:
    "Quoted for an honest reason and a narrow one: it shows the UBI is a real statutory identifier that " +
    "Washington expects to be recorded and preserved. It does NOT say Greenway's own UBI goes on Form " +
    "5208 - this subsection is about contractors - so the field's help text states that limit rather " +
    "than overselling the citation.",
  source: "https://app.leg.wa.gov/RCW/default.aspx?cite=50.12.070",
};

/** The state unemployment account number, from the federal side's point of view. */
export const STATE_REPORTING_NUMBER: CompanyIdentityAuthority = {
  id: "i940-2025-state-reporting-number",
  kind: "irs_guidance",
  cite: "IRS Instructions for Form 940 (2025), 'State unemployment information'",
  quote:
    "When you registered as an employer with your state, the state assigned you a state reporting number. " +
    "If you don\u2019t have a state unemployment account and state experience tax rate, or if you have " +
    "questions about your state account, you must contact your state unemployment agency.",
  soWhat:
    "The ESD account number and the experience rate are named together by the IRS because the FUTA " +
    "credit on Form 940 depends on state unemployment tax actually having been paid. One missing state " +
    "field turns a 0.6% federal rate into 6.0%.",
  source: "https://www.irs.gov/pub/irs-pdf/i940.pdf",
};

/** Why the state code is a company field and not a constant. */
export const FORM_940_STATE_ABBREVIATION: CompanyIdentityAuthority = {
  id: "i940-2025-one-state-abbreviation",
  kind: "irs_guidance",
  cite: "IRS Instructions for Form 940 (2025), 'Line 1a. One state only'",
  quote:
    "Enter the two-letter USPS abbreviation for the state where you were required to pay your state " +
    "unemployment tax on line 1a.",
  soWhat:
    "Form 940 line 1a is filled from the stored SUTA state, which for Greenway is WA. It is stored " +
    "rather than assumed because the moment a second state appears the form changes shape entirely - " +
    "line 1b and Schedule A instead of line 1a.",
  source: "https://www.irs.gov/pub/irs-pdf/i940.pdf",
};

/**
 * EVERY company-identity authority, in one array.
 *
 * Exported as the registry; `books-guidance-core.ts` merges it into
 * GUIDANCE_AUTHORITIES under the tag "company-identity" so a citation means the
 * same thing on this screen as on every other.
 */
export const COMPANY_IDENTITY_AUTHORITIES: readonly CompanyIdentityAuthority[] = [
  EIN_IS_NINE_DIGITS,
  ONLY_ONE_EIN,
  NO_SSN_IN_PLACE_OF_EIN,
  EFILE_REQUIRES_VALID_EIN,
  EIN_IDENTIFIES_TAXPAYER,
  EIN_MUST_MATCH_EXACTLY,
  W2_BOX_B_EIN,
  EIN_MAY_NOT_BE_TRUNCATED,
  LEGAL_NAME_VS_TRADE_NAME,
  LEGAL_NAME_FROM_SS4,
  W3_BOX_F_EMPLOYER_NAME,
  W2_BOX_C_EMPLOYER_ADDRESS,
  NOTIFY_NAME_CHANGE,
  NOTIFY_ADDRESS_CHANGE,
  NOTIFY_VIA_FORM_8822B,
  W3_KIND_OF_PAYER,
  SIGNER_SOLE_PROPRIETOR,
  SIGNER_CORPORATION,
  SIGNER_PARTNERSHIP,
  SIGNER_SINGLE_MEMBER_LLC,
  SIGNER_TRUST_OR_ESTATE,
  W3_CONTACT_PERSON,
  EFT_REQUIRED,
  ESD_ACCOUNT_NUMBER_REQUIRED,
  ESD_QUARTERLY_REPORT_CONTENTS,
  UBI_RECORD_REQUIRED,
  STATE_REPORTING_NUMBER,
  FORM_940_STATE_ABBREVIATION,
];
