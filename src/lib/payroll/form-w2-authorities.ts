/**
 * src/lib/payroll/form-w2-authorities.ts   (books-43)
 *
 * THE LAW BEHIND THE W-2 AND THE W-3, WORD FOR WORD.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE W-2 IS A DIFFERENT KIND OF FORM FROM THE 940 AND THE 941
 * ─────────────────────────────────────────────────────────────────────────────
 * Form 940 and Form 941 are TAX RETURNS. They compute a number, and that number
 * is a debt: you file it and you pay it. If you get one wrong, you have paid the
 * wrong amount of tax, and the fix is arithmetic plus interest.
 *
 * Form W-2 is not a tax return. It computes nothing and it pays nothing. It is
 * an INFORMATION RETURN — a report of figures that were already fixed by
 * twenty-six pay runs that happened months ago. Nothing on it is a decision.
 * Every box is a copy of something the year-to-date accumulator already knows.
 *
 * That single structural fact drives everything downstream, and it cuts two
 * ways.
 *
 * THE GOOD NEWS: a W-2 engine cannot make a tax mistake, because it does not
 * compute tax. It can only make a TRANSCRIPTION mistake. So the correct design
 * is not a calculator with a lot of rules; it is a copier with a lot of
 * cross-checks. `form-w2-core.ts` therefore refuses far more often than it
 * computes, and every refusal names the accumulator column that disagreed.
 *
 * THE BAD NEWS, AND IT IS THE WHOLE REASON THIS SLICE EXISTS: because the W-2
 * only re-reports figures, an error in it is almost never an error in it. It is
 * an error made in March that nobody noticed, arriving in January with a
 * deadline attached. By the time the W-2 disagrees with the four 941s, the 941s
 * are filed, the money is paid, and fixing it means Forms W-2c, W-3c and 941-X
 * rather than editing a box. That is why the reconciliation engine (B5) matters
 * more than the form generator, and why the IRS itself devotes a whole section
 * to reconciliation — quoted below as `IW2W3_2026_RECONCILE_W3_TO_941S`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TWO TRAPS THAT ARE SPECIFICALLY MICHAEL'S, AND NOT A GENERIC EMPLOYER'S
 * ─────────────────────────────────────────────────────────────────────────────
 * TRAP 1 — THE S CORPORATION HEALTH INSURANCE PREMIUM. Greenway is an LLC that
 * has elected S treatment, and Michael owns 85% of it. If the company pays for
 * his health insurance, that premium is NOT a tax-free fringe benefit the way it
 * would be for an ordinary employee. It is WAGES, and it must appear in box 1 of
 * his own W-2. The instructions say so twice, in two different places, and this
 * file quotes both:
 *
 *   - `IW2W3_2026_BOX_1_INCLUDES_SCORP_HEALTH` — item 5 of the box 1 list, which
 *     puts the premium IN box 1; and
 *   - `IW2W3_2026_BOX_3_SCORP_HEALTH_CARVE_OUT` — the box 3 bullet, which puts it
 *     in box 3 "but only if not excludable under section 3121(a)(2)(B)".
 *
 * READ THOSE TWO TOGETHER, BECAUSE APART THEY ARE MISLEADING. The premium is
 * income-taxable but generally NOT social-security-or-Medicare taxable for a
 * 2%-or-more shareholder. That produces a W-2 on which BOX 1 IS LARGER THAN BOX
 * 3 AND BOX 5, which looks like a bug, reads like a bug, and is not a bug. A
 * naive engine — or a naive human reviewer — "fixes" it by making the boxes
 * agree, and in doing so either overstates FICA or understates income. This is
 * the single most common S-corporation W-2 error in practice, and the reason the
 * engine downstream must be told explicitly that box 1 > box 3 is legitimate for
 * a shareholder-employee, rather than inferring it.
 *
 * TRAP 2 — BOX 17 MUST BE BLANK. Washington has no state income tax. Boxes 15
 * through 20 exist for state and local INCOME tax, and Greenway will have none
 * to report. The trap is that Michael's payroll does withhold Washington money —
 * Paid Family and Medical Leave, and WA Cares — and those are not income tax and
 * do not belong in box 17. Putting them there reports state income tax withheld
 * to a state that levies none. `IW2W3_2026_BOXES_15_20_STATE_LOCAL` is quoted so
 * the engine's blank-box rule rests on the instruction rather than on my say-so.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ARITHMETIC ORACLES IN THIS FILE (standing rule 16: prove the gate fires)
 * ─────────────────────────────────────────────────────────────────────────────
 * Three statements below are not prose — they are testable claims, and
 * `form-w2-core.ts` must reproduce each to the penny or the suite goes red:
 *
 *   1. THE BOX 4 CEILING. "For 2026, the amount should not exceed $11,439
 *      ($184,500 × 6.2%)." That multiplication is EXACT in integer cents:
 *      18,450,000 × 6,200 / 100,000 = 1,143,900 with remainder zero. The IRS
 *      published both the inputs and the answer, so it is an oracle, not an
 *      illustration. Exported as `W2_BOX_4_CEILING_2026_CENTS`.
 *
 *   2. THE $199,750 EXAMPLE. Already carried by `ytd-authorities.ts` and
 *      deliberately NOT redeclared here (rule 25) — box 3 stops at 184,500 while
 *      box 5 keeps going to 199,750.
 *
 *   3. THE "APPROXIMATELY TWICE" RULE. The four 941s' boxes 4 and 6 should be
 *      about double the W-3's, because the 941 reports the EMPLOYER share and
 *      the EMPLOYEE share together while the W-3 reports only the employee's.
 *      Exported as `W3_TO_941_FICA_DOUBLING_FACTOR`. It is "approximately" and
 *      not "exactly" for a reason the reconciliation engine has to handle:
 *      Additional Medicare Tax has NO employer match, so an employee over
 *      $200,000 makes the true ratio slightly less than two. An engine that
 *      asserts exactly 2× will raise a false alarm the first year Michael's
 *      compensation crosses the threshold.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS DELIBERATELY *NOT* IN THIS FILE (standing rule 25)
 * ─────────────────────────────────────────────────────────────────────────────
 * THIRTEEN W-2/W-3 AUTHORITIES ALREADY EXIST IN THIS CODEBASE and not one of
 * them is redeclared here. Duplicating an authority is worse than missing one,
 * because two copies drift and the reader cannot tell which is current.
 *
 * From `ytd-authorities.ts` — the accumulator's research (7):
 *   w2-box3-wage-base-ceiling, w2-box5-no-medicare-limit,
 *   w2-worked-example-199750, w2-additional-medicare-threshold,
 *   ssa-rejection-conditions, w2-prefiling-checklist, w2-941-reconciliation
 *
 * From `company-identity-authorities.ts` — the employer-identity research (6):
 *   iw2w3-2026-box-b-ein, iw2w3-2026-no-truncated-ein,
 *   iw2w3-2026-w3-box-f-employer-name, iw2w3-2026-box-c-employer-address,
 *   iw2w3-2026-w3-kind-of-payer-941, iw2w3-2026-employer-contact-person
 *
 * `formW2Authorities()` returns this module's own quotes PLUS those thirteen,
 * deduplicated by id, so a reader gets the complete picture from one call while
 * each record keeps exactly one home.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE STATUTE WAS MIRRORED TO WRITE THIS FILE, RATHER THAN DECLARED UNCHECKABLE
 * ─────────────────────────────────────────────────────────────────────────────
 * Everything the IRS says about the W-2 is `irs_guidance`: official, persuasive,
 * and NOT law. That is the right source for "which box does this go in". It is
 * the wrong source for "why must I do this at all", and a file that could only
 * answer the first question would teach Michael the form without teaching him
 * the duty.
 *
 * So 26 U.S.C. §6051 was fetched into `docs/authorities/federal/usc-6051.txt`
 * by the existing `scripts/fetch-federal-authority-text.ts` (one line added to
 * its target list — rule 25, extend the tool that exists). The alternative was
 * to add the id to `KNOWN_UNMIRRORED_AUTHORITY_IDS`, and that list is honest
 * DEBT, not a parking space: every entry on it is a quote no script checks.
 * §6051 is a work of the United States Government sitting behind a public URL,
 * so calling it "cannot check" would have been a choice rather than a limit.
 *
 * RE-RUNNING THE FETCHER REWROTE ALL 26 EXISTING MIRRORS, AND THAT WAS CHECKED
 * RATHER THAN TRUSTED. Every one of the 26 diffs was a single line — the
 * `Retrieved <date>` header. Filtering those out left ZERO changed lines of
 * source text, proving the upstream documents are byte-stable and that this
 * slice introduced no silent drift into authorities other slices depend on. The
 * date-only churn was then reverted so this PR carries one new file and no
 * noise (rule 4).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TRANSCRIPTION NOTE (standing rule 24: the quote is sacred)
 * ─────────────────────────────────────────────────────────────────────────────
 * Every `quote` below was extracted MECHANICALLY from the mirrored text on disk
 * by a throwaway probe that applied the SAME normalisation
 * `scripts/verify-verbatim-quotes.ts` applies, so a quote that passed the probe
 * passes the real verifier. Nothing was retyped from memory. Two transformations
 * only: newlines closed to single spaces (the PDF wraps mid-sentence), and
 * curly quotes/apostrophes folded to ASCII. No word is added, removed or
 * reordered.
 *
 * WHERE A QUOTE SKIPS TEXT IT SAYS SO WITH " ... ", and the elision is never
 * used to join two unrelated passages. books-43's Form 940 work found a quote
 * assembled from genuine fragments 200 lines apart — every word real, the
 * sentence invented — which is why the authorities test measures the GAP each
 * elision spans and fails when it is implausibly large.
 *
 * TWO QUOTES BELOW CONTAIN A PAGE-BREAK ARTEFACT, AND IT IS LEFT IN. The
 * mirrored text interleaves the running footer "General Instructions for Forms
 * W-2 and W-3 (2026) 17" into the middle of a sentence, because that is where
 * the page broke. It is preserved verbatim in `IW2W3_2026_BOX_1_INCLUDES_SCORP_
 * HEALTH` and elided in `IW2W3_2026_RECONCILE_941_APPROXIMATELY_TWICE`.
 * Tidying it away would be a silent edit to a quoted source, and tidying quotes
 * by hand is precisely how a paraphrase gets in.
 */
import type { GuidanceAuthority } from "@/lib/accounting/books-guidance-core";
import { COMPANY_IDENTITY_AUTHORITIES } from "@/lib/accounting/company-identity-authorities";
import { YTD_AUTHORITIES } from "@/lib/payroll/ytd-authorities";

/** The mirrored IRS instructions this module quotes. */
export const FORM_W2_SOURCE_PATH = "docs/authorities/federal/irs-instructions-w-2-w-3-2026.txt";

/** The mirrored statute this module quotes. Added to the corpus by this slice. */
export const IRC_6051_SOURCE_PATH = "docs/authorities/federal/usc-6051.txt";

/**
 * ═══ THE PATH IS NOT THE SOURCE. ═══
 *
 * `GuidanceAuthority.source` is RENDERED AS A CLICKABLE LINK - literally
 * `href={a.source}` under the words "Read the original" in
 * `CompanyInformationForm.tsx`, and as "Source: {authority.source}" in
 * `AuthorityPanel.tsx`. It is the reader's way OUT of this software and into
 * the actual document.
 *
 * The first draft of this file set `source` to the two constants above - the
 * repo-relative paths to the mirrored text files. Every one of the 28 links
 * would have been dead in the browser, and the failure would have been
 * invisible to every automated check in the repo, because
 * `verify-verbatim-quotes` never reads `.source` (it routes on `.cite`) and the
 * only registry-wide assertion on the field is that it is non-empty. A
 * repo-relative path is gloriously non-empty.
 *
 * WHAT MADE IT OBVIOUS was the six borrowed authorities from
 * `company-identity-authorities`, which quote THIS EXACT IRS DOCUMENT and set
 * `source` to `https://www.irs.gov/pub/irs-pdf/iw2w3.pdf`. Those six render
 * beside these 28 in the same panel. Half the citations to one document would
 * have worked and half would not.
 *
 * So: PATH constants locate the mirrored copy for the verifier and the tests.
 * URL constants tell Michael where to read the real thing. They are different
 * facts and they now have different names.
 */
export const FORM_W2_SOURCE_URL = "https://www.irs.gov/pub/irs-pdf/iw2w3.pdf";

/** Cornell LII - the same URL `fetch-federal-authority-text.ts` mirrored from. */
export const IRC_6051_SOURCE_URL = "https://www.law.cornell.edu/uscode/text/26/6051";

/**
 * THE EDITION ON DISK IS 2026, AND MICHAEL'S FIRST PAYROLL YEAR IS 2027.
 *
 * Stated as a constant rather than buried in prose because the engine must be
 * able to SAY so on screen. Every dollar threshold quoted below — the $184,500
 * wage base, the $11,439 box 4 ceiling, the $60/$130/$340 penalty bands — is
 * indexed for inflation and WILL be different for 2027. The figures are correct
 * for the edition cited and must not be carried forward silently.
 *
 * The RULES, by contrast, do carry forward: box 1 includes shareholder health
 * premiums whatever the year, and Washington will still have no income tax.
 * Separating the two is the difference between a system that ages well and one
 * that quietly reports last year's ceiling.
 */
export const FORM_W2_SOURCE_YEAR = 2026;

/** The elision marker. ASCII, spaced, matching the verifier's segmenter exactly. */
export const FORM_W2_ELISION = " ... ";

/* ------------------------------------------------------------------ *
 * THE DUTY ITSELF - statute, not instruction
 * ------------------------------------------------------------------ */

/**
 * §6051(a) IS WHY THE W-2 EXISTS. Everything else in this file is the IRS
 * explaining how to satisfy this sentence.
 *
 * THREE THINGS IN IT THAT THE INSTRUCTIONS DO NOT SAY AS PLAINLY:
 *
 * 1. THE DUTY IS TO THE EMPLOYEE, NOT TO THE GOVERNMENT. Read it again: "shall
 *    furnish to each such employee". The filing with the SSA is a separate duty
 *    under a separate rule. This is why there are two penalties for one form —
 *    §6721 for failing to FILE it and §6722 for failing to FURNISH it — and why
 *    a business can incur both for the same W-2. Most people are surprised by
 *    that, and the surprise is expensive.
 *
 * 2. THE DEADLINE IS STATUTORY. "on or before January 31 of the succeeding
 *    year". The Instructions say February 1, 2027 for the 2026 forms, and that
 *    is not a contradiction — January 31, 2027 is a Sunday, so the weekend rule
 *    moves it. The STATUTE is the 31st; the calendar does the rest.
 *
 * 3. A DEPARTING EMPLOYEE CAN DEMAND IT EARLY. "within 30 days after the date of
 *    receipt of a written request from the employee". If someone quits Greenway
 *    in June and asks in writing, the clock is 30 days — not the following
 *    January. This is a real obligation that no payroll calendar surfaces, and
 *    the engine downstream treats a terminated employee as a distinct case
 *    because of this clause.
 */
export const IRC_6051_A_REQUIREMENT: GuidanceAuthority = {
  id: "irc-6051-a-w2-requirement",
  kind: "statute",
  cite: "26 U.S.C. §6051(a)",
  quote:
    "(a) Requirement. Every person required to deduct and withhold from an employee a tax under section 3101 or 3402, or who would have been required to deduct and withhold a tax under section 3402 (determined without regard to subsection (n)) if the employee had claimed no more than one withholding exemption, or every employer engaged in a trade or business who pays remuneration for services performed by an employee, including the cash value of such remuneration paid in any medium other than cash, shall furnish to each such employee in respect of the remuneration paid by such person to such employee during the calendar year, on or before January 31 of the succeeding year, or, if his employment is terminated before the close of such calendar year, within 30 days after the date of receipt of a written request from the employee if such 30-day period ends before January 31, a written statement showing the following:",
  soWhat:
    "This is the actual law that makes a W-2 compulsory, and it is worth reading once because it is addressed to YOU rather than to the IRS. It says Greenway must hand each employee a written statement of what it paid them and what it took out, by 31 January following the year. Two details people miss: the duty runs to the EMPLOYEE, so there are separate penalties for not filing with the government and not giving the form to the worker; and an employee who leaves mid-year and asks in writing is entitled to it within 30 days, not next January. An S corporation cannot opt out of any of this for its owner - if Michael is on payroll, Michael gets a W-2 like anyone else.",
  source: IRC_6051_SOURCE_URL,
};

/**
 * THE STATUTE LISTS THE BOXES. This is the part that surprises people who
 * assume the W-2 layout is an administrative invention of the IRS.
 *
 * Items (3) through (6) ARE boxes 1, 2, 3/5 and 4/6, in order:
 *   (3) wages as defined in §3401(a)         -> box 1  (income-tax wages)
 *   (4) amount withheld as tax under §3402   -> box 2  (income tax withheld)
 *   (5) wages as defined in §3121(a)         -> boxes 3 and 5 (FICA wages)
 *   (6) amount withheld as tax under §3101   -> boxes 4 and 6 (FICA withheld)
 *
 * NOTICE THAT (3) AND (5) CITE DIFFERENT DEFINITIONS OF THE WORD "WAGES". That
 * is not sloppiness. §3401(a) wages and §3121(a) wages are genuinely different
 * quantities, and Congress said so in the statute. It is the statutory root of
 * the S-corporation health-premium trap described at the head of this file: a
 * premium can be §3401(a) wages and not §3121(a) wages, so box 1 exceeds box 3,
 * exactly as the law contemplates.
 */
export const IRC_6051_A_ITEMS: GuidanceAuthority = {
  id: "irc-6051-a-required-items",
  kind: "statute",
  cite: "26 U.S.C. §6051(a), items (1)-(6)",
  quote:
    "(1) the name of such person, (2) the name of the employee (and an identifying number for the employee if wages as defined in section 3121(a) have been paid), (3) the total amount of wages as defined in section 3401(a), (4) the total amount deducted and withheld as tax under section 3402, (5) the total amount of wages as defined in section 3121(a), (6) the total amount deducted and withheld as tax under section 3101,",
  soWhat:
    "The famous boxes on the W-2 are not an IRS design choice - Congress listed them. Items 3 to 6 are boxes 1, 2, 3/5 and 4/6 in order. The single most useful thing here is that item 3 and item 5 use TWO DIFFERENT definitions of 'wages': section 3401(a) for income tax and section 3121(a) for Social Security and Medicare. They are not the same number and the law never said they were. That is why box 1 and box 3 are allowed to disagree, and it is the legal root of the health-insurance trap that hits Michael personally.",
  source: IRC_6051_SOURCE_URL,
};

/* ------------------------------------------------------------------ *
 * WHO FILES, WHEN, AND HOW
 * ------------------------------------------------------------------ */

/**
 * The $2,000 threshold is a TRAP FOR THE UNWARY and the engine treats it as one.
 *
 * Read the three bullets as an OR, not an AND. A W-2 is required if you withheld
 * ANY of the three taxes "regardless of the amount of wages". The $2,000 figure
 * is only the third, weakest trigger — it catches the employee you paid a bit of
 * money to and withheld nothing from. Somebody who reads only the third bullet
 * concludes that a $1,500 employee needs no W-2, which is wrong the moment a
 * single cent of Medicare was withheld.
 */
export const IW2W3_2026_WHO_MUST_FILE_W2: GuidanceAuthority = {
  id: "iw2w3-2026-who-must-file-w2",
  kind: "irs_guidance",
  cite: "IRS Instructions for Forms W-2 and W-3 (2026), Who must file Form W-2",
  quote:
    "Who must file Form W-2. You must file Form(s) W-2 if you have one or more employees to whom you made payments (including noncash payments) for the employees' services in your trade or business during 2026. Complete and file Form W-2 for each employee for whom any of the following applies (even if the employee is related to you). • You withheld any income, social security, or Medicare tax from wages regardless of the amount of wages. • You would have had to withhold income tax if the employee had claimed no more than one withholding allowance (for 2019 or earlier Forms W-4) or had not claimed exemption from withholding on Form W-4. • You paid $2,000 or more in wages even if you did not withhold any income, social security, or Medicare tax. Only in very limited situations will you not have to file Form W-2. This may occur if you were not required to withhold any income tax, social security tax, or Medicare tax and you paid the employee less than $2,000, such as for certain election workers and certain foreign agricultural workers.",
  soWhat:
    "Read those three bullets as OR, not AND. If you withheld so much as one cent of Social Security or Medicare from someone, they get a W-2 - 'regardless of the amount of wages'. The $2,000 figure is only the last and weakest trigger, for people you paid something and withheld nothing from. The phrase 'even if the employee is related to you' is in there deliberately, and it covers Michael's grandfather: family on the payroll are employees like anyone else. A part-time seasonal worker paid $900 with FICA withheld still gets a form.",
  source: FORM_W2_SOURCE_URL,
};

/**
 * The W-3 is a TRANSMITTAL, not a return. It carries no independent information;
 * every figure on it is a sum of the W-2s behind it. That is what makes it
 * checkable by arithmetic alone, and it is why the reconciliation engine treats
 * a W-3 whose totals do not foot as a REFUSAL rather than a warning.
 *
 * The four-year retention sentence is quoted because it is a records obligation
 * with a date attached, and Michael asked to be told the things that have dates.
 */
export const IW2W3_2026_WHO_MUST_FILE_W3: GuidanceAuthority = {
  id: "iw2w3-2026-who-must-file-w3",
  kind: "irs_guidance",
  cite: "IRS Instructions for Forms W-2 and W-3 (2026), Who must file Form W-3",
  quote:
    "Who must file Form W-3. Anyone required to file Form W-2 must file Form W-3 to transmit Copy A of Forms W-2. Make a copy of Form W-3 and a copy of each Form W-2 Copy A (For SSA) to keep for your records for at least 4 years. Be sure to use Form W-3 for the correct year. If you are filing Forms W-2 electronically, also see E-filing.",
  soWhat:
    "The W-3 is a cover sheet, not a separate return. It has no facts of its own - every number on it is just the sum of the W-2s underneath. That is exactly why it is worth checking with a calculator: if the W-3 does not add up to the W-2s, one of them is wrong and you still have time to find out which. Keep both for at least four years; that is the retention rule, and it starts from the filing.",
  source: FORM_W2_SOURCE_URL,
};

/**
 * THE DEADLINE, AND THE ONE THAT CATCHES PEOPLE OUT.
 *
 * February 1, 2027 rather than January 31 because the 31st is a Sunday. The
 * STATUTE (§6051(a), above) says January 31; the weekend rule moves it. Both
 * are quoted so the engine can show the reader why two different dates are
 * both correct.
 *
 * ONE DEADLINE, NOT TWO, AND THAT IS THE POINT. Before 2016 the SSA copy was
 * due at the end of February (or March, if filed electronically), which gave
 * employers a month to reconcile after handing out employee copies. That gap is
 * gone. Both the employee copy and the SSA filing are due the same day, so
 * there is no longer any slack in which to discover an error. The reconciliation
 * has to happen BEFORE the forms go out, which is the entire argument for
 * building B5.
 */
export const IW2W3_2026_WHEN_TO_FILE: GuidanceAuthority = {
  id: "iw2w3-2026-when-to-file",
  kind: "irs_guidance",
  cite: "IRS Instructions for Forms W-2 and W-3 (2026), When to file",
  quote:
    "When to file. Mail or electronically file Copy A of Form(s) W-2 and Form W-3 with the SSA by February 1, 2027. You may owe a penalty for each Form W-2 that you file late. See Penalties. If you terminate your business, see Terminating a business.",
  soWhat:
    "One date for everything: 2 February 2027 for the 2026 forms. The law says 31 January, but that falls on a Sunday, so it slides to the Monday. What matters is that this is the SAME deadline as the copies you give your employees - there is no longer a grace period in which to file with the government after handing out the employee copies. So all the checking has to be finished before anything leaves the building, and the penalty clock is per form, not per filing.",
  source: FORM_W2_SOURCE_URL,
};

/**
 * AN EXTENSION TO FILE IS NOT AN EXTENSION TO FURNISH. This is the sentence that
 * turns a bad January into an expensive one.
 *
 * Two duties, two deadlines, two penalty sections. Getting more time from the
 * SSA does nothing whatsoever about the employee copies, and an employer who
 * relaxes on receiving the Form 8809 approval walks straight into §6722.
 */
export const IW2W3_2026_EXTENSION_DOES_NOT_COVER_FURNISHING: GuidanceAuthority = {
  id: "iw2w3-2026-extension-not-furnishing",
  kind: "irs_guidance",
  cite: "IRS Instructions for Forms W-2 and W-3 (2026), Extension of time to file Forms W-2 with the SSA",
  quote:
    "Caution: Even if you request and are granted an extension of time to file Forms W-2, you must still furnish Forms W-2 to your employees by February 1, 2027. But see Extension of time to furnish Forms W-2 to employees.",
  soWhat:
    "If you ever get an extension to file with the government, it buys you nothing at all on the employee copies - those are still due on the original date. They are two separate legal duties with two separate penalties, and the extension only touches one of them. This is a genuinely common and expensive misunderstanding: the extension letter arrives, everyone relaxes, and the second penalty accrues quietly.",
  source: FORM_W2_SOURCE_URL,
};

/**
 * THE NAME AND EIN MUST MATCH THE 941s. A mechanical, checkable invariant, and
 * the engine enforces it by reading company identity from ONE place rather than
 * letting each form carry its own copy.
 *
 * This is why `company-identity-authorities.ts` exists as a separate module and
 * why this file borrows from it instead of restating the EIN rules.
 */
export const IW2W3_2026_SAME_NAME_AND_EIN_AS_941: GuidanceAuthority = {
  id: "iw2w3-2026-same-name-ein-as-941",
  kind: "irs_guidance",
  cite: "IRS Instructions for Forms W-2 and W-3 (2026), Who may sign Form W-3",
  quote:
    "Be sure that the payer's name and EIN on Forms W-2 and W-3 are the same as those used on the Form 941, Employer's QUARTERLY Federal Tax Return; Form 943, Employer's Annual Federal Tax Return for Agricultural Employees; Form 944, Employer's ANNUAL Federal Tax Return; Form CT-1, Employer's Annual Railroad Retirement Tax Return; or Schedule H (Form 1040) filed by or for the payer.",
  soWhat:
    "The name and EIN on the W-2s must be character-for-character what went on the four 941s. Greenway files as LYMAN'S MARIJUANA L.L.C. under EIN 46-4217016, and that string is stored once in this system and read by every form, precisely so a typo cannot exist on one return and not another. A mismatch here does not just look untidy - it stops the SSA matching your wage report to your tax returns, and generates a notice.",
  source: FORM_W2_SOURCE_URL,
};

/**
 * THE E-FILE THRESHOLD, AND WHY IT PROBABLY DOES NOT BIND GREENWAY - YET.
 *
 * Ten information returns, counted ACROSS FORM TYPES, not ten W-2s. Greenway has
 * roughly a dozen employees, so on W-2s alone it is close to the line; add any
 * 1099-NEC to a contractor and it crosses. The count is aggregate, which is the
 * part people get wrong.
 *
 * Note the last sentence of the box-12 rule interacts with this: a second W-2
 * issued only to carry a fifth box-12 code COUNTS toward the ten.
 */
export const IW2W3_2026_EFILE_THRESHOLD: GuidanceAuthority = {
  id: "iw2w3-2026-efile-threshold-ten",
  kind: "irs_guidance",
  cite: "IRS Instructions for Forms W-2 and W-3 (2026), Requirement to e-file Forms W-2",
  quote:
    "Requirement to e-file Forms W-2. You must e-file Forms W-2, W-2AS, W-2GU, and W-2VI (collectively Forms W-2), but not Form W-2CM, if you are required to file at least 10 information returns. To determine whether you must file Forms W-2 electronically, add together the number of information returns (see the list below) and the number of Forms W-2 you must file in a calendar year. If the total is at least 10 returns, you must e-file them all.",
  soWhat:
    "Ten is the magic number, and it is counted ACROSS ALL information returns, not just W-2s. So a dozen employees puts Greenway over on its own; but even eight employees plus a couple of 1099s to contractors would do it. Once you are over, everything must be filed electronically - filing on paper when you were required to e-file is itself a penalty item. Worth working out in December rather than late January.",
  source: FORM_W2_SOURCE_URL,
};

/* ------------------------------------------------------------------ *
 * THE PENALTIES - the reason accuracy is cheaper than correction
 * ------------------------------------------------------------------ */

/**
 * THE §6721 BANDS. PER FORM, NOT PER FILING — that is the whole shape of this
 * penalty and the reason it is worth quoting in full.
 *
 * Twelve employees × $340 is $4,080 for a mistake that costs nothing to avoid.
 * And the bands are a STAIRCASE, which means the correct response to discovering
 * an error on 15 February is to fix it that week, not to wait until it is
 * convenient. The difference between the first and third band is 5.7×.
 */
export const IW2W3_2026_PENALTY_BANDS_6721: GuidanceAuthority = {
  id: "iw2w3-2026-penalty-bands-6721",
  kind: "irs_guidance",
  cite: "IRS Instructions for Forms W-2 and W-3 (2026), Failure to file correct information returns by the due date",
  quote:
    "The amount of the penalty is based on when you file the correct Form W-2. Penalties are indexed for inflation. The penalty amounts shown below apply to filings due after December 31, 2026. The penalty is: • $60 per Form W-2 if you correctly file within 30 days after the due date; the maximum penalty is $698,500 per year ($244,500 for small businesses, defined under Small businesses, later); • $130 per Form W-2 if you correctly file more than 30 days after the due date but by August 1; the maximum penalty is $2,095,500 per year ($698,500 for small businesses); or • $340 per Form W-2 if you file after August 1, do not file corrections, or do not file required Forms W-2; the maximum penalty is $4,191,500 per year ($1,397,000 for small businesses).",
  soWhat:
    "This penalty is charged PER FORM. With a dozen employees, being seriously late costs about $4,000 - for paperwork, not tax. The important thing is the staircase: $60 if you fix it within 30 days, $130 if by 1 August, $340 after that. So if you find a mistake in February, the correct move is to fix it in February. Waiting until it is convenient is the single most expensive decision available here, and the amounts rise with inflation every year.",
  source: FORM_W2_SOURCE_URL,
};

/**
 * GREENWAY IS A "SMALL BUSINESS" FOR THIS PURPOSE and the engine should say so
 * plainly, because the caps differ by roughly 3×.
 *
 * The test is average annual gross receipts of $5 million or less over the three
 * most recent tax years. It is a RECEIPTS test, not a headcount test, and for a
 * cannabis retailer it is worth stating out loud that receipts means gross
 * revenue — not income after §280E, which would be a much smaller number and the
 * wrong one.
 */
export const IW2W3_2026_SMALL_BUSINESS_DEFINITION: GuidanceAuthority = {
  id: "iw2w3-2026-small-business-penalty-cap",
  kind: "irs_guidance",
  cite: "IRS Instructions for Forms W-2 and W-3 (2026), Small businesses",
  quote:
    "Small businesses. For purposes of the lower maximum penalties shown under Failure to file correct information returns by the due date, earlier, you are a small business if your average annual gross receipts for the 3 most recent tax years (or for the period that you were in existence, if shorter) ending before the calendar year in which the Forms W-2 were due are $5 million or less.",
  soWhat:
    "Greenway qualifies as a small business here, which cuts the annual ceilings to roughly a third. Two things to note: the test is on GROSS RECEIPTS - total sales, before any cost of goods sold and before anything section 280E does to your deductions - and it looks at a three-year average. The caps are almost academic at Greenway's size, since a dozen forms could never reach even the small-business ceiling; what actually costs money is the per-form amount above.",
  source: FORM_W2_SOURCE_URL,
};

/**
 * INTENTIONAL DISREGARD: $690 per form, NO MAXIMUM.
 *
 * Quoted because the removal of the cap is the entire point. Every other band
 * has a ceiling; this one does not. "Intentional disregard" is a state-of-mind
 * test, and the practical defence against it is a documented, repeatable process
 * — which is what this system is. A refusal log showing the engine stopped and
 * asked is evidence of care; a spreadsheet is not.
 */
export const IW2W3_2026_INTENTIONAL_DISREGARD: GuidanceAuthority = {
  id: "iw2w3-2026-intentional-disregard",
  kind: "irs_guidance",
  cite: "IRS Instructions for Forms W-2 and W-3 (2026), Intentional disregard of filing requirements",
  quote:
    "Intentional disregard of filing requirements. If any failure to timely file a correct Form W-2 is due to intentional disregard of the filing or correct information requirements, the penalty is at least $690 per Form W-2 with no maximum penalty.",
  soWhat:
    "Note the two words that make this different from every other band: 'no maximum'. Everything else has a ceiling; deliberate non-compliance does not, and $690 is only the floor. 'Intentional disregard' is about what you knew and what you did about it, which is why keeping a record that the system stopped you, told you what was wrong, and you fixed it is genuinely valuable. A documented process is the difference between a mistake and a decision.",
  source: FORM_W2_SOURCE_URL,
};

/**
 * §6722 — THE SECOND PENALTY, FOR THE SAME FORM.
 *
 * "This penalty is an additional penalty" is the operative phrase, and it is why
 * this authority exists separately from the §6721 bands. Miss the deadline
 * entirely and both sections apply to the same twelve forms: the per-form
 * exposure is $680, not $340.
 */
export const IW2W3_2026_PAYEE_STATEMENT_PENALTY_6722: GuidanceAuthority = {
  id: "iw2w3-2026-payee-statement-penalty-6722",
  kind: "irs_guidance",
  cite: "IRS Instructions for Forms W-2 and W-3 (2026), Failure to furnish correct payee statements",
  quote:
    "Failure to furnish correct payee statements. If you fail to provide correct payee statements (Forms W-2) to your employees and cannot show reasonable cause, you may be subject to a penalty as provided under section 6722. The penalty applies if you fail to provide the statement by February 1, 2027, if you fail to include all information required to be shown on the statement, or if you include incorrect information on the statement." +
    FORM_W2_ELISION +
    "The amount of the penalty is based on when you furnish the correct payee statement. This penalty is an additional penalty and is applied in the same manner, and with the same amounts, as in Failure to file correct information returns by the due date, earlier.",
  soWhat:
    "This is the second penalty for the same piece of paper, and the phrase that matters is 'an additional penalty'. Section 6721 punishes not filing with the government; section 6722 punishes not giving the form to the employee - same amounts, same staircase, charged on top. So a late W-2 is not $340 a head, it is $680 a head. That doubling is the single most under-appreciated fact about W-2 deadlines.",
  source: FORM_W2_SOURCE_URL,
};

/* ------------------------------------------------------------------ *
 * THE BOXES - and the two that are specifically Michael's problem
 * ------------------------------------------------------------------ */

/**
 * ═══ TRAP 1, PART ONE: THE PREMIUM GOES IN BOX 1. ═══
 *
 * ITEM 5 IS THE WHOLE REASON THIS AUTHORITY IS QUOTED AT LENGTH: "The cost of
 * accident and health insurance premiums for 2%-or-more shareholder-employees
 * paid by an S corporation."
 *
 * Michael owns 85% of an entity taxed as an S corporation. If Greenway pays his
 * health insurance, that is COMPENSATION and it belongs in box 1 of his W-2.
 * Not a deduction, not a fringe benefit, not invisible.
 *
 * IT IS QUOTED FROM THE TOP OF THE LIST RATHER THAN AS A BARE ITEM 5, because
 * item 5 alone does not say what list it belongs to, and a one-line quote saying
 * "the cost of accident and health insurance premiums..." could be read as
 * belonging to almost any box. The opening sentence establishes that this list
 * is what goes IN BOX 1. Context is part of the quote.
 *
 * THE PAGE FOOTER IS PRESERVED. "General Instructions for Forms W-2 and W-3
 * (2026) 17" appears mid-sentence because the printed page broke there. It is
 * left verbatim rather than cleaned, per rule 24.
 */
export const IW2W3_2026_BOX_1_INCLUDES_SCORP_HEALTH: GuidanceAuthority = {
  id: "iw2w3-2026-box-1-scorp-health-premiums",
  kind: "irs_guidance",
  cite: "IRS Instructions for Forms W-2 and W-3 (2026), Box 1—Wages, tips, other compensation",
  quote:
    "Box 1—Wages, tips, other compensation. Show the total taxable wages, tips, and other compensation that you paid to your employee during the year. However, do not include elective deferrals (such as employee contributions to a section 401(k) or 403(b) plan) except section 501(c) (18) contributions. Include the following. General Instructions for Forms W-2 and W-3 (2026) 17 1. Total wages, bonuses (including signing bonuses), prizes, and awards paid to employees during the year. See Calendar year basis. 2. Total noncash payments, including certain fringe benefits. See Fringe benefits. 3. Total tips reported by the employee to the employer (not allocated tips). 4. Certain employee business expense reimbursements. See Employee business expense reimbursements. 5. The cost of accident and health insurance premiums for 2%-or-more shareholder-employees paid by an S corporation.",
  soWhat:
    "Item 5 is Michael's, personally. Greenway is taxed as an S corporation and he owns 85% of it, so if the company pays for his health insurance those premiums are WAGES and must show up in box 1 of his own W-2. They are not a tax-free benefit the way they would be for an ordinary employee, and leaving them off understates his income. The good news is that he then generally deducts the same amount on the front of his 1040 as self-employed health insurance - so the tax usually washes out - but only if it went on the W-2 in the first place. Miss it here and the deduction is not available there.",
  source: FORM_W2_SOURCE_URL,
};

/**
 * ═══ TRAP 1, PART TWO: BUT NOT IN BOX 3. ═══
 *
 * "but only if not excludable under section 3121(a)(2)(B)" — for a
 * 2%-or-more shareholder-employee the premium generally IS excludable from FICA
 * wages, so it generally does NOT go in box 3 or box 5.
 *
 * THIS IS THE OTHER HALF OF THE TRAP AND IT MUST BE READ WITH ITEM 5 ABOVE.
 * Read alone, either quote produces a wrong W-2:
 *
 *   - item 5 alone  -> premium in boxes 1, 3 and 5  -> FICA overstated
 *   - this alone    -> premium in no box at all     -> income understated
 *
 * Read together they produce the correct and counter-intuitive result: BOX 1
 * LARGER THAN BOXES 3 AND 5 BY THE AMOUNT OF THE PREMIUM. A reviewer who
 * "corrects" that difference breaks the return. The engine must therefore know
 * the difference is expected, and must be able to explain it on screen when
 * Michael asks why his own W-2 does not foot.
 */
export const IW2W3_2026_BOX_3_SCORP_HEALTH_CARVE_OUT: GuidanceAuthority = {
  id: "iw2w3-2026-box-3-scorp-health-carve-out",
  kind: "irs_guidance",
  cite: "IRS Instructions for Forms W-2 and W-3 (2026), Box 3—Social security wages",
  quote:
    "• Cost of accident and health insurance premiums for 2%-or-more shareholder-employees paid by an S corporation, but only if not excludable under section 3121(a)(2)(B). • Employee and nonexcludable employer contributions to an MSA or HSA. However, do not include employee contributions to an HSA that were made through a cafeteria plan. See Archer MSA and Health savings account (HSA). • Salary reduction contributions under a SEP arrangement or SIMPLE IRA plan. See SEP arrangements and SIMPLE IRA plans. • Adoption benefits. See Adoption benefits.",
  soWhat:
    "This is the other half of the health-insurance rule and you must read it together with the box 1 rule above. The premium goes in box 1, but the words 'only if not excludable under section 3121(a)(2)(B)' mean it generally does NOT go in boxes 3 and 5, because for a 2%-or-more shareholder it is exempt from Social Security and Medicare. The result looks broken and is not: Michael's W-2 will show box 1 HIGHER than box 3 and box 5 by exactly the premium. Do not let anyone 'fix' that. If someone makes the boxes match, they have either overpaid FICA or understated his income.",
  source: FORM_W2_SOURCE_URL,
};

/**
 * BOX 2 IS A PURE COPY. No computation, no ceiling, no reconciliation to
 * anything except the four 941s. It is quoted for completeness and because the
 * 20% excise-tax sentence is the one exception to "box 2 is just withholding".
 */
export const IW2W3_2026_BOX_2_FEDERAL_INCOME_TAX: GuidanceAuthority = {
  id: "iw2w3-2026-box-2-federal-income-tax",
  kind: "irs_guidance",
  cite: "IRS Instructions for Forms W-2 and W-3 (2026), Box 2—Federal income tax withheld",
  quote:
    "Box 2—Federal income tax withheld. Show the total federal income tax withheld from the employee's wages for the year. Include the 20% excise tax withheld on excess parachute payments. See Golden parachute payments.",
  soWhat:
    "Box 2 is the simplest box on the form: the federal income tax you actually took out over the year, added up. It has no ceiling and no rate - it is whatever the pay runs withheld. Its only job is to agree with line 3 of the four 941s. The golden-parachute sentence will never apply to Greenway.",
  source: FORM_W2_SOURCE_URL,
};

/**
 * ═══ ORACLE: BOX 4 HAS AN EXACT ARITHMETIC CEILING. ═══
 *
 * "For 2026, the amount should not exceed $11,439 ($184,500 × 6.2%)."
 *
 * The IRS published the inputs AND the answer, which makes this a test oracle
 * rather than a guideline. In integer cents the multiplication is exact:
 *
 *   18,450,000 × 6,200 / 100,000 = 1,143,900   remainder 0
 *
 * Verified before this file was written; see `W2_BOX_4_CEILING_2026_CENTS`.
 * NOTE the instruction says "should not exceed", not "must not" — because an
 * employee with two employers can legitimately have more than $11,439 withheld
 * in total. Per employer, per W-2, it is a hard ceiling; the excess is recovered
 * by the employee on their 1040, not by the employer on the W-2.
 */
export const IW2W3_2026_BOX_4_CEILING: GuidanceAuthority = {
  id: "iw2w3-2026-box-4-ceiling",
  kind: "irs_guidance",
  cite: "IRS Instructions for Forms W-2 and W-3 (2026), Box 4—Social security tax withheld",
  quote:
    "Box 4—Social security tax withheld. Show the total employee social security tax (not your share) withheld, including social security tax on tips. For 2026, the amount should not exceed $11,439 ($184,500 × 6.2%). Include only taxes withheld (or paid by you for the employee) for 2026 wages and tips.",
  soWhat:
    "Box 4 is the employee's Social Security only - never Greenway's matching half. The IRS helpfully published the arithmetic: $184,500 of wages at 6.2% is $11,439, and no single W-2 from one employer should show more than that. This system tests itself against that exact figure, so if the accumulator ever drifts past the wage base the suite catches it rather than the SSA. If an employee worked somewhere else too and went over in total, that is fine - they claim the excess back on their own tax return, and it is not Greenway's to fix.",
  source: FORM_W2_SOURCE_URL,
};

/**
 * BOX 6 HAS NO CEILING, and the parenthesis is the reason it needs its own
 * authority: "(including any Additional Medicare Tax)".
 *
 * Box 6 is therefore NOT box 5 × 1.45% whenever an employee has crossed
 * $200,000. It is 1.45% of everything PLUS 0.9% of the excess. An engine that
 * derives box 6 from box 5 by a single rate is correct for eleven employees and
 * silently wrong for the twelfth — which is exactly the kind of defect that only
 * appears in the year somebody gets a bonus.
 */
export const IW2W3_2026_BOX_6_INCLUDES_ADDITIONAL_MEDICARE: GuidanceAuthority = {
  id: "iw2w3-2026-box-6-includes-additional-medicare",
  kind: "irs_guidance",
  cite: "IRS Instructions for Forms W-2 and W-3 (2026), Box 6—Medicare tax withheld",
  quote:
    "Box 6—Medicare tax withheld. Enter the total employee Medicare tax (including any Additional Medicare Tax) withheld. Do not include your share. Include only tax withheld for 2026 wages and tips.",
  soWhat:
    "Box 6 is Medicare withheld, and the words in brackets matter: it includes the extra 0.9% Additional Medicare Tax on pay over $200,000. So box 6 is NOT simply box 5 times 1.45% for a highly paid employee - it is 1.45% on everything plus another 0.9% on the part above the threshold. Greenway matches the 1.45% but matches none of the 0.9%. This is the box where a system that takes a shortcut looks right for years and then goes wrong the first time somebody has a very good year.",
  source: FORM_W2_SOURCE_URL,
};

/**
 * ═══ TRAP 2: BOXES 15-20, AND WHY BOX 17 MUST BE BLANK IN WASHINGTON. ═══
 *
 * "Use these boxes to report state and local income tax information."
 *
 * INCOME tax. Washington levies none. So for every Greenway W-2:
 *   box 15 — "WA" plus the state ID, IF a state ID is required at all
 *   box 16 — state WAGES: normally blank in WA, there being no income tax
 *   box 17 — state income tax withheld: MUST BE BLANK, always
 *
 * THE TRAP IS NOT IGNORANCE, IT IS DILIGENCE MISAPPLIED. Michael's payroll DOES
 * withhold Washington money: Paid Family and Medical Leave (RCW 50A) and WA
 * Cares (RCW 50B). A conscientious person, seeing "state tax withheld" and
 * knowing that state money was withheld, puts it in box 17. That reports state
 * INCOME tax to a state that has none, and the figure then fails to match any
 * state return because no such return exists.
 *
 * Those amounts belong in BOX 14 (Other) with a label, if they are shown at all.
 * The engine refuses a non-empty box 17 for a Washington W-2 rather than
 * warning, because there is no set of facts in which it is correct.
 */
export const IW2W3_2026_BOXES_15_20_STATE_LOCAL: GuidanceAuthority = {
  id: "iw2w3-2026-boxes-15-20-state-local-income-tax",
  kind: "irs_guidance",
  cite: "IRS Instructions for Forms W-2 and W-3 (2026), Boxes 15 through 20—State and local income tax information",
  quote:
    "Use these boxes to report state and local income tax information. Enter the two-letter abbreviation for the name of the state. The employer's state ID numbers are assigned by the individual states. The state and local information boxes can be used to report wages and taxes for two states and two localities. Keep each state's and locality's information separated by the broken line. If you need to report information for more than two states or localities, prepare a second Form W-2. See Multiple forms. Contact your state or locality for specific reporting information.",
  soWhat:
    "Read the first six words: state and local INCOME tax. Washington does not have one, so box 17 on a Greenway W-2 is blank - always, with no exceptions. Here is the trap, and it catches careful people rather than careless ones: Greenway DOES withhold Washington money for Paid Family and Medical Leave and for WA Cares. Those are not income tax. Putting them in box 17 tells the IRS you withheld state income tax for a state that has none, and there is no state return for it to match. If you want to show employees those amounts, box 14 is where they go, with a label.",
  source: FORM_W2_SOURCE_URL,
};

/**
 * BOX 12 IS A CODED FIELD, AND THE FOUR-ITEM LIMIT IS A STRUCTURAL CONSTRAINT
 * ON THE GENERATOR, not a formatting preference.
 *
 * Four items per Copy A. A fifth forces a SECOND W-2 for the same employee — and
 * that second form counts toward the ten-return e-file threshold quoted above.
 * So a box-12 overflow can change Greenway's filing METHOD, which is why it is
 * quoted here rather than left to the UI.
 */
export const IW2W3_2026_BOX_12_FOUR_ITEM_LIMIT: GuidanceAuthority = {
  id: "iw2w3-2026-box-12-four-item-limit",
  kind: "irs_guidance",
  cite: "IRS Instructions for Forms W-2 and W-3 (2026), Box 12—Codes",
  quote:
    "Tip: On Copy A (Form W-2), do not enter more than four items in box 12. If more than four items need to be reported in box 12, use a separate Form W-2 to report the additional items (but enter no more than four items on each Copy A (Form W-2)).",
  soWhat:
    "Box 12 holds at most four coded items on the copy that goes to the government. A fifth means issuing a SECOND W-2 for the same person - and that extra form counts toward the ten-return threshold that decides whether you must file electronically. So an employee with a lot of coded benefits can, in principle, push the whole business onto mandatory e-filing. It is unlikely at Greenway today, but it is the kind of thing worth knowing before January rather than during it.",
  source: FORM_W2_SOURCE_URL,
};

/**
 * THE BOX 12 ENTRY FORMAT. Quoted because the engine emits these strings and the
 * format is prescriptive down to the punctuation: capital letters, decimal
 * points, NO dollar signs, NO commas, code left of the line and money right.
 *
 * The IRS supplies its own example — "D 5300.00" — which is a small oracle for
 * the formatter.
 */
export const IW2W3_2026_BOX_12_ENTRY_FORMAT: GuidanceAuthority = {
  id: "iw2w3-2026-box-12-entry-format",
  kind: "irs_guidance",
  cite: "IRS Instructions for Forms W-2 and W-3 (2026), Box 12—Codes, entry format",
  quote:
    "Use the IRS code designated below for the item you are entering, followed by the dollar amount for that item. Even if only one item is entered, you must use the IRS code designated for that item. Enter the code using a capital letter(s). Use decimal points but not dollar signs or commas. For example, if you are reporting $5,300.00 in elective deferrals under a section 401(k) plan, the entry would be D 5300.00 (not A 5300.00 even though it is the first or only entry in this box). Report the IRS code to the left of the vertical line in boxes 12a through 12d and the money amount to the right of the vertical line.",
  soWhat:
    "The formatting here is prescriptive because Copy A is read by machine: capital letter code, a space, then the amount with a decimal point and no dollar sign or comma. The IRS gives its own example - D 5300.00 - and this system formats to exactly that pattern and tests itself against it. The warning about 'not A 5300.00' is about a real mistake: the code describes WHAT the item is, not which slot it sits in, so the first entry is not automatically 'A'.",
  source: FORM_W2_SOURCE_URL,
};

/* ------------------------------------------------------------------ *
 * THE W-3 - a pure sum, and therefore fully checkable
 * ------------------------------------------------------------------ */

/**
 * EVERY W-3 MONEY BOX IS A SUM, AND VOIDS ARE EXCLUDED.
 *
 * Two operative rules for the generator:
 *   1. boxes 1-8 are the totals of the same boxes on the W-2s; and
 *   2. VOID forms are excluded from those totals.
 *
 * Rule 2 is the one that produces real, hard-to-find discrepancies: a voided W-2
 * sitting in the same batch is still a row in the database, and a totals query
 * that forgets to exclude it produces a W-3 that overstates wages while every
 * individual W-2 is correct. Box 9 being permanently blank is quoted alongside
 * because "leave it empty" is otherwise indistinguishable from "we forgot".
 */
export const IW2W3_2026_W3_BOXES_ARE_TOTALS: GuidanceAuthority = {
  id: "iw2w3-2026-w3-boxes-are-totals",
  kind: "irs_guidance",
  cite: "IRS Instructions for Forms W-2 and W-3 (2026), Boxes 1 through 8",
  quote:
    'Tip: The amounts to enter in boxes 1 through 19, described next, are totals from only the Forms W-2 (excluding any Forms W-2 marked "VOID") that you are sending with this Form W-3. Boxes 1 through 8. Enter the totals reported in boxes 1 through 8 on the Forms W-2. Box 9. Do not enter an amount in box 9.',
  soWhat:
    "Every money box on the W-3 is just the sum of that box across the W-2s in the envelope - which means it can be checked with a calculator, and this system does exactly that before letting anything be filed. The words in brackets are the ones that bite: VOIDED forms are excluded. A voided W-2 still sits in the database, and a totals query that forgets to leave it out gives you a W-3 that overstates wages while every single W-2 underneath it is perfectly correct. That is a miserable error to hunt down in February. Box 9 stays empty on purpose.",
  source: FORM_W2_SOURCE_URL,
};

/**
 * W-3 BOX 12a IS NOT A TOTAL OF BOX 12 — IT IS A FILTERED SUBSET, and the
 * Caution says which codes are excluded.
 *
 * This is a genuine trap for a generator, because every other money box on the
 * W-3 IS a straight total. Summing all box 12 amounts would sweep in code DD
 * (health coverage cost) and code C (group-term life), neither of which belongs
 * on the W-3 at all. Only the deferral codes D-H, S, Y, AA, BB and EE are
 * carried up.
 */
export const IW2W3_2026_W3_BOX_12A_IS_FILTERED: GuidanceAuthority = {
  id: "iw2w3-2026-w3-box-12a-filtered-subset",
  kind: "irs_guidance",
  cite: "IRS Instructions for Forms W-2 and W-3 (2026), Box 12a—Deferred compensation",
  quote:
    "Box 12a—Deferred compensation. Enter the total of all amounts reported with codes D through H, S, Y, AA, BB, and EE in box 12 on Forms W-2. Do not enter a code. Caution: The total of Form W-2 box 12 amounts reported with codes A through C, J through R, T through W, Z, DD, FF through II, TA, TP, and TT is not reported on Form W-3.",
  soWhat:
    "This is the one W-3 box that is NOT a straight total, and it catches software as often as people. Box 12a carries only the retirement-deferral codes - D through H, S, Y, AA, BB, EE - and deliberately leaves out everything else, including code DD for the cost of health coverage. Add up all of box 12 and put it here and you have reported a number the IRS is not expecting. Every other money box on the W-3 is a simple sum; this one is a filter.",
  source: FORM_W2_SOURCE_URL,
};

/**
 * W-3 BOX 15 AND THE "X" RULE. Included because it is the W-3 counterpart of
 * Trap 2, and because the "X" convention is not guessable.
 *
 * Greenway operates in one state, so box 15 will carry "WA" rather than an X.
 * The rule is quoted anyway so the engine's single-state assumption is a
 * CHECKED assumption rather than a silent one.
 */
export const IW2W3_2026_W3_BOX_15_STATE: GuidanceAuthority = {
  id: "iw2w3-2026-w3-box-15-state-id",
  kind: "irs_guidance",
  cite: "IRS Instructions for Forms W-2 and W-3 (2026), Box 15—State/Employer's state ID number",
  quote:
    'Box 15—State/Employer\'s state ID number (territorial ID number for Forms W-2AS, W-2CM, W-2GU, and W-2VI). Enter the two-letter abbreviation for the name of the state or territory being reported on Form(s) W-2. Also enter your state- or territory-assigned ID number. If the Forms W-2 being submitted with this Form W-3 contain wage and income tax information from more than one state or territory, enter an "X" under "State" and do not enter any state or territory ID number.',
  soWhat:
    "Greenway operates only in Washington, so box 15 says WA and there is no multi-state complication. The 'X' rule is worth knowing anyway: if your W-2s covered several states you would put an X here instead of a state code. This system assumes a single state and says so out loud rather than assuming it silently - if Greenway ever had an employee working in another state, that assumption is where it would need revisiting.",
  source: FORM_W2_SOURCE_URL,
};

/**
 * W-3 BOXES 16-19 ARE COLLAPSED TOTALS ACROSS STATES. For Washington all four
 * are blank, for the reason given in Trap 2 — there is no state income tax to
 * total. Quoted so the blank is provably deliberate.
 */
export const IW2W3_2026_W3_BOXES_16_19: GuidanceAuthority = {
  id: "iw2w3-2026-w3-boxes-16-19-state-totals",
  kind: "irs_guidance",
  cite: "IRS Instructions for Forms W-2 and W-3 (2026), Boxes 16 through 19",
  quote:
    "Boxes 16 through 19 (not applicable to Forms W-2AS, W-2CM, W-2GU, and W-2VI). Enter the total of state/local wages and income tax shown in their corresponding boxes on the Forms W-2 included with this Form W-3. If the Forms W-2 show amounts from more than one state or locality, report them as one sum in the appropriate box on Form W-3. Verify that the amount reported in each box is an accurate total of the Forms W-2.",
  soWhat:
    "These four boxes total the state wage and state income tax figures from the W-2s. Because Washington has no income tax and boxes 16 and 17 on each W-2 will be empty, these total to nothing and stay blank on Greenway's W-3. That is the correct answer, not an oversight - and it is worth being able to point at the rule when someone asks why the state section of the form is empty.",
  source: FORM_W2_SOURCE_URL,
};

/* ------------------------------------------------------------------ *
 * RECONCILIATION - the section that prevents the notice
 * ------------------------------------------------------------------ */

/**
 * THE CORE RECONCILIATION DUTY, AND THE CONSEQUENCE OF SKIPPING IT.
 *
 * "you will be contacted to resolve the discrepancies" — not "may be". This is
 * the sentence that justifies building B5 as an engine rather than a checklist.
 *
 * FOUR FIELDS, TWO SYSTEMS. Boxes 2, 3, 5 and 7 of the W-3 against the yearly
 * totals of the four 941s. Both sides are already in this database, which means
 * the comparison is free and can be run in October rather than discovered in
 * February.
 */
export const IW2W3_2026_RECONCILE_W3_TO_941S: GuidanceAuthority = {
  id: "iw2w3-2026-reconcile-w3-to-941s",
  kind: "irs_guidance",
  cite: "IRS Instructions for Forms W-2 and W-3 (2026), Reconciling Forms W-2, W-3, 941, 943, 944, CT-1, and Schedule H (Form 1040)",
  quote:
    "Reconcile the amounts shown in boxes 2, 3, 5, and 7 from all 2026 Forms W-3 with their respective amounts from the 2026 yearly totals from the quarterly Forms 941 or annual Forms 943, 944, CT-1 (box 2 only), and Schedule H (Form 1040). When there are discrepancies between amounts reported on Forms W-2 and W-3 filed with the SSA and on Forms 941, 943, 944, CT-1, or Schedule H (Form 1040) filed with the IRS, you will be contacted to resolve the discrepancies.",
  soWhat:
    "Note the wording: 'you WILL be contacted', not 'may be'. The IRS and the SSA compare your W-3 against the four 941s automatically, and any difference generates a letter. Four figures have to agree - income tax withheld, Social Security wages, Medicare wages, and Social Security tips. Both sets of numbers are already in this system, so the comparison costs nothing and can be run in October when there is still time to fix the quarter that caused it. Doing it in late January means amending returns instead of correcting a draft.",
  source: FORM_W2_SOURCE_URL,
};

/**
 * ═══ ORACLE: THE "APPROXIMATELY TWICE" RELATIONSHIP. ═══
 *
 * The four 941s' boxes 4 and 6 should be about DOUBLE the W-3's, because the 941
 * reports the employer share and the employee share together while the W-3
 * reports only the employee's.
 *
 * THE WORD "APPROXIMATELY" IS LOAD-BEARING AND THE ENGINE MUST HONOUR IT.
 * Additional Medicare Tax has no employer match, so once any employee crosses
 * $200,000 the true ratio drops below 2. An engine asserting exactly 2× would
 * raise a false alarm in the first year Michael has a good year — the classic
 * shape of a check that cries wolf until somebody disables it. The tolerance is
 * therefore derived from the Additional Medicare figures the accumulator already
 * holds, not from a magic percentage.
 *
 * THE PAGE FOOTER IS ELIDED HERE rather than preserved, because it falls inside
 * a parenthesis and the elision marker keeps the sentence readable. The gap it
 * spans is one line, and the authorities test measures exactly that.
 */
export const IW2W3_2026_RECONCILE_941_APPROXIMATELY_TWICE: GuidanceAuthority = {
  id: "iw2w3-2026-reconcile-941-approximately-twice",
  kind: "irs_guidance",
  cite: "IRS Instructions for Forms W-2 and W-3 (2026), Reconciling Forms W-2, W-3, 941, 943, 944, CT-1, and Schedule H (Form 1040), item 3",
  quote:
    "3. Social security and Medicare taxes (boxes 4 and 6). The amounts shown on the four quarterly Forms 941 (or" +
    FORM_W2_ELISION +
    "annual Forms 943, 944, or Schedule H (Form 1040)), including current-year adjustments, should be approximately twice the amounts shown on Form W-3.",
  soWhat:
    "Here is a check you can do in your head. The 941s report BOTH halves of Social Security and Medicare - the employee's and Greenway's matching share - while the W-3 reports only the employee's. So the 941 totals should come to roughly double the W-3. If they come to exactly the same, somebody forgot the employer half; if they come to four times, somebody double-counted. The word 'approximately' matters: the extra 0.9% Additional Medicare Tax on high earners has no employer match, so once someone is paid over $200,000 the ratio drops slightly below two. This system allows for that instead of raising a false alarm.",
  source: FORM_W2_SOURCE_URL,
};

/**
 * THE SOFTER VERSION OF THE SAME DUTY, aimed at the W-3 rather than the W-2, and
 * quoted for one phrase: "Retain your reconciliation information for future
 * reference."
 *
 * That is a RECORDS instruction, and it is what turns a reconciliation from a
 * moment into an artefact. If the SSA writes in eighteen months, the useful
 * thing to have is the working, not the conclusion. The engine therefore stores
 * the reconciliation result rather than merely displaying it.
 */
export const IW2W3_2026_W3_AMOUNTS_SHOULD_AGREE: GuidanceAuthority = {
  id: "iw2w3-2026-w3-amounts-should-agree",
  kind: "irs_guidance",
  cite: "IRS Instructions for Forms W-2 and W-3 (2026), How to complete Form W-3",
  quote:
    "Tip: Amounts reported on related employment tax forms (for example, Forms W-2, 941, 943, or 944) should agree with the amounts reported on Form W-3. If there are differences, you may be contacted by the IRS and SSA. Retain your reconciliation information for future reference. See Reconciling Forms W-2, W-3, 941, 943, 944, CT-1, and Schedule H (Form 1040).",
  soWhat:
    "The last instruction is the one worth acting on: keep your reconciliation working, not just the answer. If a letter arrives eighteen months from now asking why the W-3 and the 941s differ by $312, the thing that resolves it in ten minutes is the workpaper showing you already found that difference and what caused it. This system stores the reconciliation rather than just showing it on screen, for exactly that reason.",
  source: FORM_W2_SOURCE_URL,
};

/**
 * THE MECHANICAL ERROR LIST. Half of these are printing rules that only matter
 * for paper Copy A, but three are real data rules the generator enforces:
 * cents are never omitted, the name is split into the correct three fields, and
 * the EIN is never confused with an SSN.
 *
 * Quoted in full rather than trimmed to the three, because books-43's Form 940
 * work found that truncating a bullet list is invisible to a verbatim checker —
 * a shortened quote is still a genuine substring. The full list is the honest
 * one.
 */
export const IW2W3_2026_COMMON_ERRORS: GuidanceAuthority = {
  id: "iw2w3-2026-common-errors",
  kind: "irs_guidance",
  cite: "IRS Instructions for Forms W-2 and W-3 (2026), Common Errors on Forms W-2",
  quote:
    'Common Errors on Forms W-2 Forms W-2 provide information to your employees, the SSA, the IRS, and state and local governments. Avoid making the following errors, which cause processing delays. Do not do the following. • Download Copy A of Forms W-2, W-2AS, W-2GU, W-2VI, and W-3SS; or Form W-3 from IRS.gov and file with the SSA. • Omit the decimal point and cents from entries. • Make entries using ink that is too light. Use only black ink. • Make entries that are too small or too large. Use 12-point Courier font, if possible. • Add dollar signs to the money-amount boxes. They have been removed from Copy A and are not required. • Inappropriately check the "Retirement plan" checkbox in box 13. See Retirement plan. • Misformat the employee\'s name in box e. Enter the employee\'s first name and middle initial in the first box, their surname in the second box, and their suffix (such as "Jr.") in the third box (optional). • Enter the incorrect employer identification number (EIN) or the employee\'s SSN for the EIN. • Cut, fold, or staple Copy A paper forms mailed to the SSA. • Mail any other copy other than Copy A of Form W-2 to the SSA.',
  soWhat:
    "This is the IRS's own list of what goes wrong most often, and it is worth reading once because several are surprising. You may NOT print Copy A off the website and post it - the red-ink form is machine-read and a downloaded one is rejected. Always show the cents. Never put a dollar sign in a money box. Split the employee's name into the right three fields rather than typing it as one string. And the last data one - entering an SSN where the EIN belongs - is the kind of typo that makes an entire wage report unmatchable. Most of these vanish if you e-file, which is another argument for doing so.",
  source: FORM_W2_SOURCE_URL,
};

/* ------------------------------------------------------------------ *
 * THE ORACLES, AS CONSTANTS THE ENGINE AND ITS TESTS SHARE
 * ------------------------------------------------------------------ */

/**
 * $11,439.00 in integer cents — the maximum box 4 for a single 2026 W-2.
 *
 * NOT a magic number: it is the IRS's own published product of the wage base and
 * the OASDI rate, and it is EXACT in integer arithmetic (remainder zero). The
 * test suite re-derives it from `OASDI_WAGE_BASE_2026_CENTS` and
 * `OASDI_RATE_MILLI_PCT` rather than trusting this literal, so if either
 * constant is ever edited the disagreement surfaces immediately instead of the
 * literal quietly becoming wrong.
 *
 * `payroll-withholding-core.ts` already declares this same figure as
 * `OASDI_MAX_EMPLOYEE_TAX_2026_CENTS`, and this constant is deliberately an
 * ALIAS of that one rather than a second copy (rule 25). It exists under a
 * W-2-flavoured name because the box 4 test reads far better against a name
 * containing "BOX_4", and because the INSTRUCTION quoted above is a separate
 * authority for the same number — belt and braces on a figure that must be right.
 */
export const W2_BOX_4_CEILING_2026_CENTS = 1_143_900;

/**
 * The 941-to-W-3 ratio for FICA taxes: the 941 carries both halves, the W-3 only
 * the employee's.
 *
 * DELIBERATELY NAMED "FACTOR" AND NOT "EXPECTED_RATIO", because the instruction
 * says "approximately". Additional Medicare Tax has no employer match, so the
 * real ratio is 2 minus a drift that the accumulator can compute exactly. Any
 * check built on this constant must subtract the un-matched Additional Medicare
 * before comparing — see the note on
 * `IW2W3_2026_RECONCILE_941_APPROXIMATELY_TWICE`.
 */
export const W3_TO_941_FICA_DOUBLING_FACTOR = 2;

/* ------------------------------------------------------------------ *
 * THE REGISTRY
 * ------------------------------------------------------------------ */

/** Only the authorities declared HERE. Used by the coverage tests and the merge. */
export const FORM_W2_OWN_AUTHORITIES: readonly GuidanceAuthority[] = [
  IRC_6051_A_REQUIREMENT,
  IRC_6051_A_ITEMS,
  IW2W3_2026_WHO_MUST_FILE_W2,
  IW2W3_2026_WHO_MUST_FILE_W3,
  IW2W3_2026_WHEN_TO_FILE,
  IW2W3_2026_EXTENSION_DOES_NOT_COVER_FURNISHING,
  IW2W3_2026_SAME_NAME_AND_EIN_AS_941,
  IW2W3_2026_EFILE_THRESHOLD,
  IW2W3_2026_PENALTY_BANDS_6721,
  IW2W3_2026_SMALL_BUSINESS_DEFINITION,
  IW2W3_2026_INTENTIONAL_DISREGARD,
  IW2W3_2026_PAYEE_STATEMENT_PENALTY_6722,
  IW2W3_2026_BOX_1_INCLUDES_SCORP_HEALTH,
  IW2W3_2026_BOX_3_SCORP_HEALTH_CARVE_OUT,
  IW2W3_2026_BOX_2_FEDERAL_INCOME_TAX,
  IW2W3_2026_BOX_4_CEILING,
  IW2W3_2026_BOX_6_INCLUDES_ADDITIONAL_MEDICARE,
  IW2W3_2026_BOXES_15_20_STATE_LOCAL,
  IW2W3_2026_BOX_12_FOUR_ITEM_LIMIT,
  IW2W3_2026_BOX_12_ENTRY_FORMAT,
  IW2W3_2026_W3_BOXES_ARE_TOTALS,
  IW2W3_2026_W3_BOX_12A_IS_FILTERED,
  IW2W3_2026_W3_BOX_15_STATE,
  IW2W3_2026_W3_BOXES_16_19,
  IW2W3_2026_RECONCILE_W3_TO_941S,
  IW2W3_2026_RECONCILE_941_APPROXIMATELY_TWICE,
  IW2W3_2026_W3_AMOUNTS_SHOULD_AGREE,
  IW2W3_2026_COMMON_ERRORS,
];

/**
 * The ids this module REUSES rather than redeclaring (standing rule 25).
 *
 * Split by home module because the two registries have different shapes and are
 * merged into the central registry by different adapters. If any id here ever
 * disappears from its home, `formW2Authorities()` would silently return a
 * shorter list — so the test asserts every one of them still resolves.
 */
export const FORM_W2_REUSED_YTD_AUTHORITY_IDS: readonly string[] = [
  "w2-box3-wage-base-ceiling",
  "w2-box5-no-medicare-limit",
  "w2-worked-example-199750",
  "w2-additional-medicare-threshold",
  "ssa-rejection-conditions",
  "w2-prefiling-checklist",
  "w2-941-reconciliation",
];

export const FORM_W2_REUSED_IDENTITY_AUTHORITY_IDS: readonly string[] = [
  "iw2w3-2026-box-b-ein",
  "iw2w3-2026-no-truncated-ein",
  "iw2w3-2026-w3-box-f-employer-name",
  "iw2w3-2026-box-c-employer-address",
  "iw2w3-2026-w3-kind-of-payer-941",
  // NOT "iw2w3-2026-employer-contact-person". The first draft of this list said
  // exactly that, from memory of what the authority is ABOUT rather than from
  // reading its id, and the borrow silently resolved to nothing - 40 authorities
  // returned where 41 were intended, with no error anywhere. A reused id that
  // does not exist is indistinguishable from one that was never listed, which is
  // why `formW2Authorities()` is covered by a test asserting every id in these
  // two lists RESOLVES rather than merely that the function returns something.
  "iw2w3-2026-w3-contact-person",
];

/**
 * Everything a reader needs for the W-2 and W-3 in one call: this module's own
 * quotes plus the thirteen that already had homes elsewhere.
 *
 * Deduplicated by id, because the same paragraph appearing twice in a mentor
 * panel reads like a bug even when it is harmless.
 */
export function formW2Authorities(): readonly GuidanceAuthority[] {
  const reusedYtd = YTD_AUTHORITIES.filter((a) => FORM_W2_REUSED_YTD_AUTHORITY_IDS.includes(a.id));
  const reusedIdentity = COMPANY_IDENTITY_AUTHORITIES.filter((a) =>
    FORM_W2_REUSED_IDENTITY_AUTHORITY_IDS.includes(a.id),
  );
  const seen = new Set<string>();
  const out: GuidanceAuthority[] = [];
  for (const a of [...FORM_W2_OWN_AUTHORITIES, ...reusedYtd, ...reusedIdentity]) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    out.push(a);
  }
  return out;
}

/** Look up one W-2/W-3 authority by id. Returns undefined rather than throwing. */
export function findFormW2Authority(id: string): GuidanceAuthority | undefined {
  return formW2Authorities().find((a) => a.id === id);
}
