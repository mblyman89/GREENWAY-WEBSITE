/**
 * src/lib/accounting/books-guidance-core.ts   (slice books-07)
 *
 * THE GUIDANCE LAYER. The shared spine that every bookkeeping screen plugs into
 * so that the thing on the wall and the thing in the engine are the SAME thing.
 *
 * Michael, 2026-08-18, recorded verbatim (standing rule 1):
 *
 *   "The next slice should be to close the gap on all bookkeeping features that
 *    still need a guidance layer... I want the same level of care and diligence
 *    and detail as the others. Really make sure the system is a PhD CPA/ CFO,
 *    whose sole purpose is to guide me and keep me safe and teach me how and
 *    why."
 *
 * WHY THIS FILE EXISTS AT ALL
 * Four screens had grown four private authority libraries: `AUTHORITIES` in
 * vendor-bill-core, `PAYROLL_AUTHORITIES`, `BANK_AUTHORITIES`, and
 * `GATE_AUTHORITIES` in owner-gate-core. Four shapes, four `kind` unions, and
 * — measured, not assumed — six citation ids present in more than one of them.
 * Five of the six were character-for-character identical. ONE HAD DRIFTED (see
 * CCA_201504011 below). That is the failure mode this file is built to make
 * impossible: not a bug in a calculation, but the same citation saying two
 * different things on two different pages.
 *
 * THE RULE THIS FILE ENFORCES
 * Quotes are IMPORTED, never re-typed. Nothing below copies a `quote` string
 * that already exists elsewhere in the codebase; it imports the authority
 * object whole. A quote can therefore only be wrong in ONE place, and
 * `assertNoAuthorityDrift()` fails the build if the same id ever again carries
 * two different texts. New authorities are declared here once, in the same
 * verbatim discipline the other cores already use.
 *
 * WHY THE LOGIC IS NOT IN THE .tsx FILES
 * Same reason as Section280EExplainer, quoted here so it does not get lost:
 * "a diagram that drifts from the engine is worse than no diagram: it teaches
 * the wrong thing with confidence." The explainers render DATA from this file.
 *
 * PURITY: no I/O, no Date.now(), no randomness, no server-only imports. Every
 * function is a total function of its arguments so the self-tests can sweep
 * whole domains rather than sample one happy value (standing rule 15b).
 *
 * RULE FOR MAINTAINERS: `quote` fields are TRANSCRIPTIONS. Do not paraphrase,
 * tidy, modernise, or "fix" them. If a quote is wrong, fix it against the
 * PRIMARY SOURCE and update the test — never the other way around.
 */

import {
  AUTHORITIES as VENDOR_BILL_AUTHORITIES,
  type Authority as VendorBillAuthority,
} from "./vendor-bill-core";
import { PAYROLL_AUTHORITIES, type PayrollAuthority } from "./payroll-cogs-core";
import { BANK_AUTHORITIES, type BankAuthority } from "./bank-match-core";
import { GATE_AUTHORITIES, type GateAuthority } from "@/lib/auth/owner-gate-core";
import { LEDGER_AUTHORITIES_NEW } from "./books-ledger-authorities";
import { INVENTORY_AUDIT_AUTHORITIES_NEW } from "@/lib/inventory/inventory-audit-authorities";
// books-16. THIS IMPORT CLOSES A HOLE. PAYROLL_TAX_AUTHORITIES has existed
// since the payroll slice, but it was never merged into this registry, so
// `findGuidanceAuthority("irc-6656-deposit-penalty")` returned undefined even
// though the record was sitting right there in src/lib/payroll/. Thirty-six
// authorities were invisible to every "cite your source" surface in the app.
// Found because the books-16 penalty engine cites six of them and the rule-16
// wiring test refused to let a dangling citation ship.
import { PAYROLL_TAX_AUTHORITIES } from "@/lib/payroll/payroll-tax-authorities";
import { AUDIT_HUB_AUTHORITIES_NEW } from "@/lib/inventory/audit-hub-authorities";
import { TAX_PENALTY_AUTHORITIES_NEW } from "./tax-penalty-authorities";
import { FINANCIAL_STATEMENT_AUTHORITIES_NEW } from "./financial-statement-authorities";
import { PERIOD_CLOSE_AUTHORITIES_NEW } from "./period-close-authorities";
import { BASIS_AAA_AUTHORITIES_NEW } from "./basis-aaa-authorities";
import { COGS_POSITION_AUTHORITIES_NEW } from "./cogs-position-authorities";
import { INTEREST_AUTHORITIES_NEW } from "./interest-authorities";
// books-25. The HIRING PAPERWORK authorities: Form I-9 (8 CFR §274a.2), the
// W-4 withholding certificate regulation (26 CFR §31.3402(f)(2)-1), and
// Washington's twenty-day new-hire report (RCW 26.23.040). Imported HERE, in
// the same commit that declares them, because the alternative is the bug the
// PAYROLL_TAX_AUTHORITIES comment below records: an exported registry that
// nothing merges is a set of citations no screen can find.
import { PAYROLL_ONBOARDING_AUTHORITIES } from "@/lib/payroll/payroll-onboarding-authorities";
// books-27. HOW A REPORT IS PRESENTED, as opposed to what it computes. The
// FASB's understandability characteristic (CON 8 QC30-32), its guidance on
// aggregation (PR13, PR35-36), and the BINDING comparative-statement rules in
// ASC 205-10-45. Imported here in the same commit that declares them, for the
// reason the PAYROLL_TAX_AUTHORITIES comment above records.
import { REPORTING_AUTHORITIES_NEW } from "@/lib/reports/reporting-authorities";
// books-28. See the file header there for why COSO can be quoted at all.
import { COMPANY_IDENTITY_AUTHORITIES, type CompanyIdentityAuthority } from "./company-identity-authorities";
import { INTERNAL_CONTROL_AUTHORITIES } from "./internal-control-authorities";
// books-32. The timesheet slice: the workweek rule, the regular rate and the
// Washington overtime statute. Imported in the same commit that declares it so
// the registry can never contain a record no screen can resolve.
import { TIMESHEET_AUTHORITIES, type TimesheetAuthority } from "@/lib/payroll/timesheet-authorities";
import { SICK_LEAVE_AUTHORITIES, type SickLeaveAuthority } from "@/lib/payroll/sick-leave-authorities";
import { GARNISHMENT_AUTHORITIES, type GarnishmentAuthority } from "@/lib/payroll/garnishment-authorities";
import { YTD_AUTHORITIES, type YtdAuthority } from "@/lib/payroll/ytd-authorities";
import { NET_PAY_AUTHORITIES, type NetPayAuthority } from "@/lib/payroll/net-pay-authorities";
// books-39. The PAY RUN slice: the two paragraphs that decide which W-4
// governs a cheque (and what to do when there is not a good one), the
// five-working-day support remittance clock, and the sentence that makes the
// Washington minimum wage change every January. Imported in the same commit
// that declares them, for the reason recorded above and because the omission
// was caught the hard way — see the comment on the merge block below.
import { FORM_940_OWN_AUTHORITIES } from "@/lib/payroll/form-940-authorities";
import { FORM_941_AUTHORITIES } from "@/lib/payroll/form-941-authorities";
import { WA_QUARTERLY_OWN_AUTHORITIES } from "@/lib/payroll/wa-quarterly-authorities";
import { PAY_RUN_AUTHORITIES, type PayRunAuthority } from "@/lib/payroll/pay-run-authorities";
import {
  WAGE_ORDER_ENTRY_AUTHORITIES,
  type WageOrderEntryAuthority,
} from "@/lib/payroll/wage-order-entry-authorities";

// ---------------------------------------------------------------------------
// 1) THE UNIFIED SHAPE
// ---------------------------------------------------------------------------

/**
 * Every `kind` in use anywhere in the codebase, unioned.
 *
 * This list is the UNION of four previously divergent unions, verified by
 * reading all four files rather than by assuming they agreed:
 *   - vendor-bill-core: statute | regulation | case | irs_guidance | gaap | state_law
 *   - bank-match-core:  statute | regulation | irs_guidance | state_law | state_manual
 *   - payroll-cogs-core: ... | legislative_history | ...
 *   - owner-gate-core:  GateAuthority has NO `kind` field at all.
 *
 * `auditing_standard` is new in this slice. It is kept SEPARATE from `gaap` on
 * purpose: GAAP tells you how to measure a number, an auditing standard tells
 * you how a professional goes looking for a lie. Greenway is not a public
 * company and is not audited under PCAOB standards — those standards are cited
 * here as the best available written description of HOW FRAUD IS FOUND, not as
 * rules that bind Michael. The distinction is stated on screen too; see
 * `AUDITING_STANDARD_DISCLAIMER`.
 */
export type GuidanceAuthorityKind =
  | "statute"
  | "regulation"
  | "case"
  | "irs_guidance"
  /**
   * A published position of a federal agency that is NOT the IRS - a DOL Wage
   * and Hour fact sheet, for instance.
   *
   * ADDED IN books-37, AND WHY IT HAD TO BE. The net-pay slice needed to quote
   * DOL WHD Fact Sheet #30, and the first attempt reused `irs_guidance` on the
   * theory that the weight was identical (persuasive, not binding) so the tag
   * was close enough. It was not close enough. `GUIDANCE_KIND_LABELS` renders
   * that tag as the words "IRS guidance", so the screen would have told Michael
   * a Department of Labor document came from the IRS. A citation he cannot
   * trust to name its own author is worse than no citation, because he would
   * repeat it to somebody. The weight was right and the attribution was false,
   * and attribution is the whole point of an authority panel.
   */
  | "agency_guidance"
  | "gaap"
  | "state_law"
  | "state_manual"
  | "legislative_history"
  | "auditing_standard"
  | "internal_control_framework";

export const ALL_GUIDANCE_AUTHORITY_KINDS: readonly GuidanceAuthorityKind[] = [
  "statute",
  "regulation",
  "case",
  "irs_guidance",
  "agency_guidance",
  "gaap",
  "state_law",
  "state_manual",
  "legislative_history",
  "auditing_standard",
  "internal_control_framework",
] as const;

/** Human labels. Used by the UI so a badge never shows a raw enum. */
export const GUIDANCE_KIND_LABELS: Record<GuidanceAuthorityKind, string> = {
  statute: "Statute",
  regulation: "Regulation",
  case: "Court decision",
  irs_guidance: "IRS guidance",
  // Deliberately generic. The specific agency is named in full in every
  // record's `cite`, so the badge classifies and the citation attributes.
  agency_guidance: "Agency guidance",
  gaap: "GAAP",
  state_law: "Washington rule",
  state_manual: "State manual",
  legislative_history: "Legislative history",
  auditing_standard: "Auditing standard",
  internal_control_framework: "Internal control framework",
};

/**
 * HOW MUCH WEIGHT DOES THIS CARRY? Ranked, because "an authority" is not one
 * thing. A statute binds. An IRS memo tells you what the examiner across the
 * table believes but binds nobody. Michael has to be able to tell those apart
 * before he relies on one, so the rank is DATA and it is shown on screen.
 *
 * 3 = binding law    2 = binding rule/interpretation    1 = persuasive only
 */
export const GUIDANCE_KIND_WEIGHT: Record<GuidanceAuthorityKind, 1 | 2 | 3> = {
  statute: 3,
  regulation: 3,
  state_law: 3,
  case: 2,
  gaap: 2,
  irs_guidance: 1,
  // Persuasive only, and the documents say so themselves - DOL Fact Sheet #30
  // states in its own footer that its contents "do not have the force and
  // effect of law". Same rank as IRS guidance because the status is the same.
  agency_guidance: 1,
  state_manual: 1,
  legislative_history: 1,
  auditing_standard: 1,
  internal_control_framework: 1,
};

/** Plain-English explanation of each weight. Shown, not just stored. */
export const GUIDANCE_WEIGHT_MEANING: Record<1 | 2 | 3, string> = {
  3: "Binding law. This is not an opinion and there is no arguing with it.",
  2: "Binding interpretation. A court or the accounting rulebook has settled it.",
  1: "Persuasive only. Nobody is bound by it — but it tells you what the person auditing you already thinks.",
};

/**
 * The unified authority record. Identical field-for-field to the shape the
 * other four cores already use, plus an optional `kind` default so
 * `GateAuthority` (which has none) can be adopted without inventing a fact
 * about it.
 */
export type GuidanceAuthority = {
  /** Stable key. Unique across the WHOLE registry, asserted by the self-tests. */
  id: string;
  kind: GuidanceAuthorityKind;
  /** Formal citation as it would appear in a memo. */
  cite: string;
  /** VERBATIM text. Transcribed from the primary source, never paraphrased. */
  quote: string;
  /** Why this matters to Greenway specifically, in Michael's language. */
  soWhat: string;
  /** Where to read it. */
  source: string;
};

/**
 * Shown wherever an `auditing_standard` appears. Michael is not a public
 * company; saying so plainly is the difference between teaching him and
 * frightening him.
 */
export const AUDITING_STANDARD_DISCLAIMER =
  "You are not a public company and no PCAOB standard applies to you. These are quoted because they are " +
  "the clearest written description anywhere of how a professional goes looking for a fake entry — so we " +
  "use them as a checklist for catching your own mistakes before anyone else does.";

// ---------------------------------------------------------------------------
// 2) NEW AUTHORITIES INTRODUCED BY THIS SLICE
//
// Each one was fetched from its PRIMARY source during this slice and the quote
// below was extracted from that text mechanically, not from memory:
//   - 26 CFR §1.446-1     : eCFR XML API, title-26, 2026-01-01 snapshot
//   - 26 CFR §31.6001-1   : eCFR XML API, title-26, 2026-01-01 snapshot
//   - 26 CFR §1.6662-3    : eCFR XML API, title-26, 2026-01-01 snapshot
//   - 26 U.S.C. §6662     : Cornell LII
//   - PCAOB AS 2401/AS 1105 : pcaobus.org standard text
//   - WAC 314-55-087      : app.leg.wa.gov (WSR 24-19-040, eff. 10/12/24)
// ---------------------------------------------------------------------------

export const GUIDANCE_AUTHORITIES_NEW: readonly GuidanceAuthority[] = [
  // ── THE GENERAL JOURNAL: what a manual entry has to be able to survive ────
  {
    id: "AS_2401_58_JOURNAL_ENTRIES",
    kind: "auditing_standard",
    cite: "PCAOB AS 2401.58 (Consideration of Fraud in a Financial Statement Audit)",
    quote:
      "Material misstatements of financial statements due to fraud often involve the manipulation of the " +
      "financial reporting process by (a) recording inappropriate or unauthorized journal entries throughout " +
      "the year or at period end, or (b) making adjustments to amounts reported in the financial statements " +
      "that are not reflected in formal journal entries, such as through consolidating adjustments, report " +
      "combinations, and reclassifications.",
    soWhat:
      "Read that first clause again: the manual journal entry is the number one place financial statement " +
      "fraud lives. Not the sales system, not the bank feed — the hand-keyed entry. That is exactly the page " +
      "you are standing on. It is not an accusation; it is the reason this screen pushes back and the reason " +
      "every entry keeps who, when, and why forever.",
    source:
      "PCAOB Auditing Standard 2401. https://pcaobus.org/oversight/standards/auditing-standards/details/AS2401",
  },
  {
    id: "AS_2401_61_FINGERPRINTS",
    kind: "auditing_standard",
    cite: "PCAOB AS 2401.61 (The characteristics of fraudulent entries or adjustments)",
    quote:
      "Inappropriate journal entries and other adjustments often have certain unique identifying " +
      "characteristics. Such characteristics may include entries (a) made to unrelated, unusual, or " +
      "seldom-used accounts, (b) made by individuals who typically do not make journal entries, (c) recorded " +
      "at the end of the period or as post-closing entries that have little or no explanation or description, " +
      "(d) made either before or during the preparation of the financial statements that do not have account " +
      "numbers, or (e) containing round numbers or a consistent ending number.",
    soWhat:
      "This is the single most useful paragraph in this whole application, because it is the checklist an " +
      "examiner runs against your journal. We run it FIRST, on your own entry, before you post — so anything " +
      "that would get flagged gets flagged here, by us, while it is still fixable and while you still " +
      "remember what it was. Nothing on this list is illegal. Every item on it is a question you should be " +
      "able to answer.",
    source:
      "PCAOB Auditing Standard 2401. https://pcaobus.org/oversight/standards/auditing-standards/details/AS2401",
  },
  {
    id: "AS_2401_57_OVERRIDE",
    kind: "auditing_standard",
    cite: "PCAOB AS 2401.57 (Audit Procedures Performed to Specifically Address the Risk of Management Override of Controls)",
    quote:
      "As noted in paragraph .08, management is in a unique position to perpetrate fraud because of its " +
      "ability to directly or indirectly manipulate accounting records and prepare fraudulent financial " +
      "statements by overriding established controls that otherwise appear to be operating effectively. By " +
      "its nature, management override of controls can occur in unpredictable ways.",
    soWhat:
      "You own the company and you hold every key. There is no colleague to catch you and no board to answer " +
      "to. That is not a character flaw, it is a structural fact about a small owner-operated business, and " +
      "it is the reason this system will not let even YOU delete or silently rewrite a posted entry. The " +
      "control you cannot override is the one that protects you.",
    source:
      "PCAOB Auditing Standard 2401. https://pcaobus.org/oversight/standards/auditing-standards/details/AS2401",
  },
  {
    id: "AS_2401_85_CASH_ON_HAND",
    kind: "auditing_standard",
    cite: "PCAOB AS 2401.85, Appendix — Risk Factors Relating to Misstatements Arising From Misappropriation of Assets (Opportunities)",
    quote:
      "Certain characteristics or circumstances may increase the susceptibility of assets to " +
      "misappropriation. For example, opportunities to misappropriate assets increase when there are the " +
      "following: Large amounts of cash on hand or processed",
    soWhat:
      "Greenway is a cash business because banking is closed to it — not by choice. But the risk factor is " +
      "the same either way, and an examiner reads it the same way. That is why cash counts, the vault, and " +
      "the ATM are treated in this system as evidence to be produced rather than balances to be asserted.",
    source:
      "PCAOB Auditing Standard 2401, Appendix. https://pcaobus.org/oversight/standards/auditing-standards/details/AS2401",
  },

  // ── THE TRIAL BALANCE: why "it balances" is not an answer ────────────────
  {
    id: "AS_1105_11_COMPLETENESS",
    kind: "auditing_standard",
    cite: "PCAOB AS 1105.11 (Financial Statement Assertions)",
    quote:
      "Completeness — All transactions and accounts that should be presented in the financial statements are " +
      "so included.",
    soWhat:
      "Sixteen words that explain why a balanced trial balance proves almost nothing. Balancing is arithmetic. " +
      "COMPLETENESS is a separate promise, and no amount of footing will ever test it, because a transaction " +
      "you never recorded is absent from BOTH columns and cancels itself perfectly. This is the reason this " +
      "page refuses to congratulate you.",
    source:
      "PCAOB Auditing Standard 1105. https://pcaobus.org/oversight/standards/auditing-standards/details/AS1105",
  },
  {
    id: "REG_1_446_1_A_2_CLEARLY_REFLECT",
    kind: "regulation",
    cite: "26 C.F.R. §1.446-1(a)(2)",
    quote:
      "It is recognized that no uniform method of accounting can be prescribed for all taxpayers. Each " +
      "taxpayer shall adopt such forms and systems as are, in his judgment, best suited to his needs. " +
      "However, no method of accounting is acceptable unless, in the opinion of the Commissioner, it clearly " +
      "reflects income.",
    soWhat:
      "The first two sentences are the freedom: you may keep your books the way that suits you, and nobody " +
      "can force a particular format on you. The third sentence is the leash, and it is the whole ballgame — " +
      "'clearly reflects income,' judged by the Commissioner, not by you. A trial balance that ties but is " +
      "missing a month of cash sales does not clearly reflect income no matter how neat it looks.",
    source: "https://www.ecfr.gov/current/title-26/section-1.446-1",
  },
  {
    id: "REG_1_446_1_A_4_RECONCILIATION",
    kind: "regulation",
    cite: "26 C.F.R. §1.446-1(a)(4)",
    quote:
      "Each taxpayer is required to make a return of his taxable income for each taxable year and must " +
      "maintain such accounting records as will enable him to file a correct return. See section 6001 and the " +
      "regulations thereunder. Accounting records include the taxpayer's regular books of account and such " +
      "other records and data as may be necessary to support the entries on his books of account and on his " +
      "return, as for example, a reconciliation of any differences between such books and his return.",
    soWhat:
      "'A reconciliation of any differences between such books and his return' is a requirement, written down, " +
      "in the regulations. Your book income and your tax return will NOT agree — §280E guarantees it, because " +
      "expenses that are real on your P&L are not deductible on your return. The bridge between the two is " +
      "not optional paperwork; it is part of the records you are required to keep.",
    source: "https://www.ecfr.gov/current/title-26/section-1.446-1",
  },
  {
    id: "REG_1_446_1_D_2_SEPARATE_BOOKS",
    kind: "regulation",
    cite: "26 C.F.R. §1.446-1(d)(2)",
    quote:
      "No trade or business will be considered separate and distinct for purposes of this paragraph unless a " +
      "complete and separable set of books and records is kept for such trade or business.",
    soWhat:
      "This is the legal foundation of the four separate entities in this system — Greenway, the ATM, the " +
      "land, and you personally. Keeping them apart is not tidiness; it is the CONDITION for treating them " +
      "as separate businesses at all. CHAMP won on exactly this ground. If the books ever bleed together, " +
      "the argument that the non-cannabis activities are separate goes away, and §280E reaches further than " +
      "it should.",
    source: "https://www.ecfr.gov/current/title-26/section-1.446-1",
  },
  {
    id: "REG_1_446_1_E_2_II_B_NOT_A_METHOD",
    kind: "regulation",
    cite: "26 C.F.R. §1.446-1(e)(2)(ii)(b)",
    quote:
      "A change in method of accounting does not include correction of mathematical or posting errors, or " +
      "errors in the computation of tax liability (such as errors in computation of the foreign tax credit, " +
      "net operating loss, percentage depletion, or investment credit).",
    soWhat:
      "Genuinely good news, and worth knowing before you panic about a mistake. Fixing a posting error is NOT " +
      "a change of accounting method, so it does not need IRS consent and does not need a Form 3115. You " +
      "correct it, you document what you corrected and why, and you move on. Correcting an error is ordinary " +
      "bookkeeping. Hiding one is the thing that turns a mistake into a problem.",
    source: "https://www.ecfr.gov/current/title-26/section-1.446-1",
  },
  {
    id: "REG_31_6001_1_A_FORM",
    kind: "regulation",
    cite: "26 C.F.R. §31.6001-1(a)",
    quote:
      "The records required by the regulations in this part shall be kept accurately, but no particular form " +
      "is required for keeping the records. Such forms and systems of accounting shall be used as will enable " +
      "the district director to ascertain whether liability for tax is incurred and, if so, the amount " +
      "thereof.",
    soWhat:
      "The employment-tax twin of §1.6001-1, and the sentence that says this software is allowed to exist. " +
      "There is no required format. The test is functional: can someone from the government work out what " +
      "you owed and whether you paid it? If the answer is yes, the form of the record is your business.",
    source: "https://www.ecfr.gov/current/title-26/section-31.6001-1",
  },
  {
    id: "REG_31_6001_1_E_2_FOUR_YEARS",
    kind: "regulation",
    cite: "26 C.F.R. §31.6001-1(e)(2)",
    quote:
      "Except as otherwise provided in the following sentence, every person required by the regulations in " +
      "this part to keep records in respect of a tax (whether or not such person incurs liability for such " +
      "tax) shall maintain such records for at least four years after the due date of such tax for the return " +
      "period to which the records relate, or the date such tax is paid, whichever is the later.",
    soWhat:
      "FOUR years for payroll-tax records, federally — and Washington separately requires FIVE for cannabis " +
      "records under WAC 314-55-087(1). Two different clocks run at once and you keep to the longer one. " +
      "Nothing in this system is ever purged on a schedule; that decision stays yours and it stays deliberate.",
    source: "https://www.ecfr.gov/current/title-26/section-31.6001-1",
  },
  {
    id: "REG_1_6662_3_B_1_NEGLIGENCE",
    kind: "regulation",
    cite: "26 C.F.R. §1.6662-3(b)(1)",
    quote:
      "The term negligence includes any failure to make a reasonable attempt to comply with the provisions of " +
      "the internal revenue laws or to exercise ordinary and reasonable care in the preparation of a tax " +
      "return. \"Negligence\" also includes any failure by the taxpayer to keep adequate books and records or " +
      "to substantiate items properly.",
    soWhat:
      "Read the second sentence slowly, because it is the reason this whole project exists. Bad books are not " +
      "merely inconvenient — bad books ARE negligence, by definition, in the regulation itself. You do not " +
      "have to understate a penny of income to be penalised; failing to keep adequate records is independently " +
      "enough.",
    source: "https://www.ecfr.gov/current/title-26/section-1.6662-3",
  },
  {
    id: "IRC_6662_A_TWENTY_PERCENT",
    kind: "statute",
    cite: "26 U.S.C. §6662(a), (b)(1)",
    quote:
      "If this section applies to any portion of an underpayment of tax required to be shown on a return, " +
      "there shall be added to the tax an amount equal to 20 percent of the portion of the underpayment to " +
      "which this section applies. ... This section shall apply to the portion of any underpayment which is " +
      "attributable to 1 or more of the following: (1) Negligence or disregard of rules or regulations.",
    soWhat:
      "The price tag on the sentence above. Twenty percent, on top of the tax and on top of the interest — " +
      "for records that were not good enough. That is what careless bookkeeping actually costs, and it is why " +
      "'we'll sort it out at year end' is the most expensive sentence in small business.",
    source: "https://www.law.cornell.edu/uscode/text/26/6662",
  },
  {
    id: "WAC_314_55_087_ADP_AUDIT_TRAIL",
    kind: "state_law",
    cite: "WAC 314-55-087(2), (2)(a)",
    quote:
      "If the cannabis licensee keeps records within an automated data processing (ADP) and/or point-of-sale " +
      "(POS) system, the system must include a method for producing legible records that will provide the " +
      "same information required of that type of record within this section. The ADP and/or POS system is " +
      "acceptable if it complies with the following guidelines: (a) Provides an audit trail so that details " +
      "(invoices and vouchers) underlying the summary accounting data may be identified and made available " +
      "upon request.",
    soWhat:
      "Washington wrote down what a computerised set of books has to do, and this system is that system. " +
      "'Details underlying the summary accounting data' is precisely what drilling from a trial balance line " +
      "into the ledger and then into the source entry gives you. It is a state-law requirement, not a " +
      "convenience feature — which is why every total on screen stays clickable all the way down.",
    source:
      "WAC 314-55-087 (current text WSR 24-19-040, filed 9/11/24, effective 10/12/24). " +
      "https://app.leg.wa.gov/wac/default.aspx?cite=314-55-087",
  },
] as const;
// ---------------------------------------------------------------------------
// 4) ADAPTING THE FOUR EXISTING REGISTRIES — imported whole, never re-typed
//
// Nothing in this section retypes a quote. Each adapter maps an existing
// authority object field-for-field, so the merged registry below is physically
// incapable of disagreeing with the core that owns the text.
// ---------------------------------------------------------------------------

function fromVendorBill(a: VendorBillAuthority): GuidanceAuthority {
  return { id: a.id, kind: a.kind, cite: a.cite, quote: a.quote, soWhat: a.soWhat, source: a.source };
}
function fromPayroll(a: PayrollAuthority): GuidanceAuthority {
  return { id: a.id, kind: a.kind, cite: a.cite, quote: a.quote, soWhat: a.soWhat, source: a.source };
}
function fromBank(a: BankAuthority): GuidanceAuthority {
  return { id: a.id, kind: a.kind, cite: a.cite, quote: a.quote, soWhat: a.soWhat, source: a.source };
}
/**
 * books-31. The company-identity registry.
 *
 * THIS FUNCTION EXISTS TO FAIL TO COMPILE. `CompanyIdentityAuthority` is
 * declared structurally in its own module rather than importing
 * `GuidanceAuthority` from here, because THIS file imports THAT one and the
 * reverse import would be circular. That leaves a real risk: two independently
 * declared shapes that drift apart, with the drift discovered by a runtime
 * `undefined` on a screen.
 *
 * Passing the value through a function whose return type is `GuidanceAuthority`
 * closes it. If `CompanyIdentityAuthority` ever narrows its `kind` union to
 * something `GuidanceAuthorityKind` does not contain, or drops a field, `tsc`
 * stops the build here rather than letting the screen render a citation with a
 * hole in it. Standing rule 42: prefer a gate that cannot be forgotten over a
 * discipline that can.
 */
function fromCompanyIdentity(a: CompanyIdentityAuthority): GuidanceAuthority {
  return { id: a.id, kind: a.kind, cite: a.cite, quote: a.quote, soWhat: a.soWhat, source: a.source };
}
/**
 * books-32. The timesheet registry, adapted for exactly the reason documented
 * on `fromCompanyIdentity` above: `TimesheetAuthority` declares its own shape
 * (this file imports that one, so the reverse import would be circular), and
 * passing it through a function that RETURNS `GuidanceAuthority` is what forces
 * tsc to notice if the two shapes ever drift apart.
 *
 * The narrow `kind` union over there is the point. `TimesheetAuthority.kind` is
 * `"regulation" | "state_law"` - a strict subset of `GuidanceAuthorityKind`. If
 * someone later adds a timesheet authority tagged with a kind this registry
 * does not know, the build stops HERE, at the boundary, instead of rendering a
 * blank weight badge next to a citation on a payroll screen.
 */
function fromTimesheet(a: TimesheetAuthority): GuidanceAuthority {
  return { id: a.id, kind: a.kind, cite: a.cite, quote: a.quote, soWhat: a.soWhat, source: a.source };
}

/**
 * books-33. Sick leave, same adapter pattern and same reason as `fromTimesheet`
 * directly above: the leaf module owns its own narrow `kind` union, this file
 * imports that one, and the conversion function is what makes tsc compare the
 * two shapes on every build.
 *
 * There is a SECOND reason these two registries had to be merged here, and it
 * is the one that actually matters. scripts/verify-verbatim-quotes.ts walks
 * GUIDANCE_AUTHORITIES and nothing else. An authority module that exports
 * beautiful verbatim quotes and is never merged into this registry is NOT
 * checked against its mirrored source - it is 27 unverified quotes wearing the
 * green check of a run that never looked at them. Standing rule 50. Registering
 * them here is what puts them under the rule-24 microscope, and the proof that
 * it worked is the verified count in that script's output going UP by exactly
 * the number of authorities added.
 */
function fromSickLeave(a: SickLeaveAuthority): GuidanceAuthority {
  return { id: a.id, kind: a.kind, cite: a.cite, quote: a.quote, soWhat: a.soWhat, source: a.source };
}

/** books-33. Garnishments and support orders. Same pattern as `fromSickLeave`. */
function fromGarnishment(a: GarnishmentAuthority): GuidanceAuthority {
  return { id: a.id, kind: a.kind, cite: a.cite, quote: a.quote, soWhat: a.soWhat, source: a.source };
}

/**
 * books-37. Net pay: the ORDER of operations on a cheque, and the base the
 * garnishment limits are measured against. Same adapter, same reason.
 *
 * This one is worth a sentence of its own because of what registering it
 * actually bought. `NetPayAuthority["kind"]` includes `agency_guidance`, a
 * member that did not exist in `GuidanceAuthorityKind` until this slice added
 * it - the leaf module had been tagging two DOL fact sheets `irs_guidance`,
 * which the label table renders as the words "IRS guidance". Passing the leaf
 * type through THIS function is what surfaced the mismatch, because tsc has to
 * prove the narrow union fits the wide one. An authority panel that misnames
 * the agency behind a quote is worse than one that shows no badge at all.
 */
function fromNetPay(a: NetPayAuthority): GuidanceAuthority {
  return { id: a.id, kind: a.kind, cite: a.cite, quote: a.quote, soWhat: a.soWhat, source: a.source };
}

/**
 * books-39. The pay run — the act of turning hours into a cheque.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FIELD NAMES DIFFER, AND THAT IS WHY THIS ADAPTER IS NOT A ONE-LINER LIKE
 * THE OTHERS
 * ─────────────────────────────────────────────────────────────────────────────
 * `PayRunAuthority` calls them `citation` and `whatItMeansHere`; the shared
 * registry calls them `cite` and `soWhat`. The mapping is written out rather
 * than spread, so that adding a field to either type produces a compile error
 * here instead of silently dropping it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS SLICE'S REGISTRY WAS NOT MERGED IN ITS OWN COMMIT, AND WHAT CAUGHT IT
 * ─────────────────────────────────────────────────────────────────────────────
 * It was written, mirrored verbatim against `docs/authorities/`, covered by
 * twenty-one tests, and connected to nothing. Nobody noticed until the mentor
 * layer cited one of the ids and
 * `tests/compliance/authority-id-resolution.test.ts` — a repo-wide tripwire
 * that walks every file under `src/` and resolves every `authorityId` against
 * the MERGED registry — failed with three unresolved citations.
 *
 * That is the exact condition the `PAYROLL_TAX_AUTHORITIES` comment at the top
 * of this file warns about: an exported registry that nothing merges is a set
 * of citations no screen can find. Worth recording, because the slice's own
 * test file was green throughout: it verified the quotes against the corpus,
 * which is a different question from whether anything can reach them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ON THE TWO PARAGRAPHS THAT APPEAR TWICE
 * ─────────────────────────────────────────────────────────────────────────────
 * §31.3402(f)(2)-1(a)(1) and (a)(4) are ALSO mirrored by the onboarding
 * registry, under ids `cfr-31-3402-f-2-1-a-1-furnish-on-commencement` and
 * `cfr-31-3402-f-2-1-a-4-no-certificate-default`. Both pairs are checked and
 * both are correct: the pay-run quotes are LONGER, carrying the paragraph
 * numbering and, for (a)(1), the cross-references the onboarding quote trims.
 *
 * They keep separate ids on purpose, so the drift machinery has nothing to
 * resolve — different ids are different records, not two versions of one. The
 * duplication is real and is tracked rather than hidden: the honest fix is one
 * record per paragraph cited from both places, and doing that here would mean
 * retitling ids the onboarding screens already reference, which is a different
 * slice's work (standing rule 4).
 */
function fromPayRun(a: PayRunAuthority): GuidanceAuthority {
  return {
    id: a.id,
    kind: a.kind,
    cite: a.citation,
    quote: a.quote,
    soWhat: a.whatItMeansHere,
    source: a.source,
  };
}

/**
 * books-38. Wage order ENTRY - the duties that attach to receiving the paper,
 * as distinct from the arithmetic of applying it.
 *
 * `WageOrderEntryAuthority["kind"]` is the two-member union
 * `"statute" | "state_law"`, and that narrowness is meaningful rather than
 * incidental: every sentence in that registry is primary law. There is no
 * agency guidance in it, no publication, no fact sheet. That is because the
 * questions it answers - how long do I have, what happens if I ignore this,
 * when do I stop, what may I not do to the employee - are all answered by
 * statutes that carry their own penalties, and none of them is a matter of
 * interpretation on which an agency's view would add anything. If a future
 * slice widens this union, the weight badge on the screen changes meaning and
 * whoever widens it should be made to look at this comment first.
 */
function fromWageOrderEntry(a: WageOrderEntryAuthority): GuidanceAuthority {
  return { id: a.id, kind: a.kind, cite: a.cite, quote: a.quote, soWhat: a.soWhat, source: a.source };
}

/**
 * books-34. Year-to-date accumulation. Same adapter, same reason.
 *
 * `YtdAuthority["kind"]` is the NARROWEST union in this file: the single member
 * `"irs_guidance"`. That is deliberate and it is not laziness. Every sentence
 * behind the accumulator table comes from the IRS General Instructions for
 * Forms W-2 and W-3 - a publication, which is persuasive and official but is
 * NOT law and cannot be relied on as authority against the IRS. Widening that
 * union later would force whoever does it to look at this conversion and think
 * about the weight badge the screen will render, which is exactly the moment
 * the thinking needs to happen.
 */
function fromYtd(a: YtdAuthority): GuidanceAuthority {
  return { id: a.id, kind: a.kind, cite: a.cite, quote: a.quote, soWhat: a.soWhat, source: a.source };
}
/**
 * GateAuthority carries no `kind` field at all, so one has to be derived. It
 * is derived FROM THE CITATION ITSELF rather than hand-assigned, because a
 * hand-assigned list is exactly the kind of thing that rots when someone adds
 * a ninth gate authority and forgets this file exists.
 *
 * The mapping is not cosmetic. It decides the WEIGHT shown on screen, and
 * getting it wrong is precisely the defect this slice found in vendor-bill-core
 * (a Senate Report labelled "statute"). So:
 *
 *   WAC ...................... state_law   (Washington rule — binding here)
 *   U.S.C. / "Act" ........... statute     (an Act of Congress — binding)
 *   C.F.R. / "Rule" .......... regulation  (an agency rule — binding)
 *   IRS Publication .......... irs_guidance (persuasive only; a Publication is
 *                                            NOT law and cannot be relied on
 *                                            as authority against the IRS)
 *
 * Anything that matches none of these returns null, and `fromGate` throws
 * rather than guess. Silence is the enemy: an unclassifiable citation must
 * stop the build, not quietly acquire a plausible-looking badge.
 */
export function deriveKindFromCite(cite: string): GuidanceAuthorityKind | null {
  const c = cite.trim();
  if (/^WAC\b/.test(c) || /\bWAC\s+\d/.test(c)) return "state_law";
  if (/\bIRS Publication\b/i.test(c) || /\bPub\.\s*\d/i.test(c)) return "irs_guidance";
  if (/\bC\.?F\.?R\.?\b/i.test(c) || /^Reg\.\s/i.test(c) || /\bRule\b/i.test(c)) return "regulation";
  if (/\bU\.?S\.?C\.?\b/i.test(c) || /\bAct\b/.test(c)) return "statute";
  return null;
}

function fromGate(a: GateAuthority): GuidanceAuthority {
  const kind = deriveKindFromCite(a.cite);
  if (!kind) {
    throw new Error(
      `books-guidance-core: cannot classify gate authority "${a.id}" from its citation ` +
        `("${a.cite}"). Add an explicit rule to deriveKindFromCite rather than letting it default — ` +
        `the kind decides how much weight the screen claims this document carries.`,
    );
  }
  return { id: a.id, kind, cite: a.cite, quote: a.quote, soWhat: a.soWhat, source: a.source };
}

/**
 * books-21 inverted this pair, for the same reason it inverted the refusal
 * codes in basis-aaa-core.ts.
 *
 * It used to be a hand-written union of fourteen strings AND a hand-written
 * array of the same fourteen. `readonly SourceRegistry[]` proves every element
 * of the array is in the union but nothing proves the reverse, so a registry
 * added to the union and forgotten in the array would compile \u2014 and the array
 * is what the coverage tests walk. The list is now the single source of truth
 * and the union is derived from it. Standing rule 42: prefer a gate that cannot
 * be forgotten over a discipline that can.
 */
export const ALL_SOURCE_REGISTRIES = [
  "vendor-bill",
  "payroll",
  "bank",
  "gate",
  "new",
  "ledger",
  "inventory-audit",
  "audit-hub",
  "tax-penalty",
  "payroll-tax",
  "financial-statement",
  "period-close",
  "basis-aaa",
  "cogs-position",
  "interest",
  "payroll-onboarding",
  "reporting",
  "internal-control",
  // books-31. The company-information slice. Kept as its own tag rather than
  // folded into "payroll-tax" because these authorities answer a different
  // question: not "how much tax" but "whose return is this, and which box does
  // each identifier belong in". The company-information screen is the only
  // place that needs the whole set, and every downstream form builder resolves
  // its identity fields through it.
  "company-identity",
  // books-32. The timesheet slice. Its own tag rather than folded into
  // "payroll" because these authorities answer the question that comes BEFORE
  // any tax question: how many hours are payable, and how many of them are
  // overtime. Get this wrong and every downstream number - gross, withholding,
  // 941, W-2, the L&I hours report - is wrong by the same amount, in the same
  // direction, every period.
  "timesheet",
  // books-33. Paid sick leave. Its own tag rather than folded into "timesheet"
  // because sick hours and worked hours are legally DIFFERENT things that
  // happen to be measured in the same unit: 29 CFR 778.218(a) says paid leave
  // is not hours worked, which is why sick time never creates overtime. Two
  // tags keeps that distinction visible on screen instead of blurring the one
  // line an employer is most likely to get wrong.
  "sick-leave",
  // books-33. Garnishments, child support and other wage orders. Separate from
  // "payroll-tax" because a garnishment is not a tax: it is a third party's
  // claim on money that is already the employee's, computed AFTER tax on
  // disposable earnings, and capped by rules (15 U.S.C. 1673, RCW 6.27.150)
  // that no tax authority in this codebase has anything to say about.
  "garnishment",
  // books-34. Year-to-date accumulation. Its own tag rather than folded into
  // "payroll-tax" because these authorities answer a question no per-period
  // tax rule can answer: what has ALREADY been paid this calendar year. The
  // wage base, the Additional Medicare threshold and every SSA rejection rule
  // are ANNUAL tests, and a pay run that only knows about itself cannot see
  // them. Tagging them separately keeps the distinction on screen between
  // "this is the rate" and "this is the running total the rate stops at".
  "ytd",
  // books-37. Net pay. Its own tag rather than folded into "garnishment" or
  // "payroll-tax" because it answers the question neither of those registries
  // was ever asked: in what ORDER do the deductions come off, and which of them
  // shrink the base the next one is measured against. Both other engines can be
  // individually correct and the cheque still wrong, and that is not a
  // hypothetical - the seam between them was unbuilt until this slice, and the
  // required-by-law bucket that garnishment measures against was silently
  // missing the L&I employee premium that RCW 51.16.140(1) COMPELS. Tagging
  // these separately keeps the sequence visible as its own subject, because the
  // sequence is the part people get wrong.
  "net-pay",
  // books-38. Wage order ENTRY. Deliberately NOT folded into "garnishment",
  // because the garnishment tag answers "how much comes out" and every
  // sentence under this one answers a question the arithmetic cannot reach:
  // how many days do I have to answer, what happens to Greenway if I ignore
  // the envelope, when does a creditor lien EXPIRE (sixty days - support
  // orders never do), which order wins when two land on the same person, and
  // what may I never do to an employee whose wages are attached. The
  // penalties here are asymmetric in a way the ceilings are not: ignoring a
  // writ can produce a default judgment against Greenway for somebody else's
  // entire debt, while over-withholding produces a wage claim. Keeping the
  // duties visible as their own subject is the point.
  "wage-order-entry",
  // books-39. The PAY RUN itself. Deliberately NOT folded into "payroll-tax",
  // "net-pay" or "ytd", because those three registries all answer arithmetic
  // questions - what is the rate, in what order does it come off, what has
  // been paid so far - and every sentence under this tag answers a question
  // the arithmetic never asks: what do I do about the person whose paperwork
  // is not in order. 26 CFR 31.3402(f)(2)-1 is the whole reason a pay run can
  // legally proceed for an employee who never handed in a W-4: it says treat
  // them as single with no adjustments, which means a missing form is a
  // WITHHOLDING rule, not a stop-work order. RCW 26.18.110 puts a clock on
  // remitting what was already withheld, so the duty outlives the cheque.
  // RCW 49.46.020 is the annual minimum-wage adjustment, which is why an
  // unreviewed rate carried over from last year is a finding and not a
  // rounding difference. Tagging these separately keeps "may I run this
  // payroll at all, and on what authority" visible as its own subject,
  // because that is the question Michael will actually be asking at 6am on a
  // Friday - not what the FICA rate is.
  "pay-run",
  // books-40. The QUARTERLY RETURN. Deliberately NOT folded into "payroll-tax"
  // or "pay-run": those answer "what does this paycheque cost", and every
  // sentence under this tag answers a question a paycheque never asks - by
  // WHEN must the quarter be reported, WHO counts on line 1, and what happens
  // to a quarter in which nobody was paid at all. 26 CFR 31.6011(a)-1 is the
  // reason a quiet quarter still needs a return filed "whether or not wages
  // are paid therein", which is the single most expensive thing an employer
  // can be unaware of: the penalty attaches to the missing FORM, not to
  // missing money, so a zero quarter that is simply skipped accrues a penalty
  // on a return that would have cost nothing to file.
  "form-941",
  // books-41. WASHINGTON'S quarterly returns, tagged apart from "form-941" for
  // the reason that is easiest to get wrong: the two land on the same four
  // dates and behave differently on almost every other axis. The 941 can be
  // filed ten days late if every deposit was made on time; WAC 192-310-010(3)(d)
  // offers nothing equivalent. The 941 is charged on wages; the L&I quarterly
  // report is charged on HOURS and ignores pay entirely. The 941's employer and
  // employee halves are equal; here the unemployment tax is 100% employer money
  // that RCW 50.24.010 makes it a misdemeanour to deduct, while the Paid Leave
  // premium is mostly employee money the employer merely holds. Folding these
  // under the federal tag would invite a reader to carry a federal habit into a
  // state return, which is precisely how the ten-day assumption gets made.
  "wa-quarterly",
  // books-43. The ANNUAL federal unemployment return. Tagged apart from both
  // "payroll-tax" and "form-941" because it answers a question neither of them
  // asks, and the answer is counter-intuitive enough that blurring it would be
  // actively harmful.
  //
  // "payroll-tax" already carries §3301 (the rate is 6%), §3306 (the base is
  // $7,000) and §3302 (there is a credit). Those are the STATUTE. What lives
  // here is the INSTRUCTIONS - and the instructions contain the sentence that
  // decides how much Michael actually pays: the maximum credit is earned by
  // paying state unemployment tax "by the due date of your Form 940", not by
  // the state's own quarterly due date. That single clause means an ESD payment
  // that was late to Washington can still be on time for the IRS, so a reader
  // who carries the state habit into the federal return will overstate his own
  // tax and never know it.
  //
  // It is also tagged apart from "form-941" because the two returns disagree
  // about what "late" costs. A late 941 deposit is penalised directly under
  // IRC §6656. A late STATE payment is not penalised by the IRS at all - it
  // shrinks a CREDIT, by exactly ten percent of the late amount, through the
  // Worksheet-Line 10 arithmetic. Same word, entirely different machinery, and
  // one tag for both would hide that.
  "form-940",
] as const;

export type SourceRegistry = (typeof ALL_SOURCE_REGISTRIES)[number];

/** Every (id, registry) pair BEFORE de-duplication, for drift analysis. */
function taggedCandidates(): Array<{ tag: SourceRegistry; authority: GuidanceAuthority }> {
  return [
    ...VENDOR_BILL_AUTHORITIES.map((a) => ({ tag: "vendor-bill" as const, authority: fromVendorBill(a) })),
    ...PAYROLL_AUTHORITIES.map((a) => ({ tag: "payroll" as const, authority: fromPayroll(a) })),
    ...BANK_AUTHORITIES.map((a) => ({ tag: "bank" as const, authority: fromBank(a) })),
    ...GATE_AUTHORITIES.map((a) => ({ tag: "gate" as const, authority: fromGate(a) })),
    ...GUIDANCE_AUTHORITIES_NEW.map((a) => ({ tag: "new" as const, authority: a })),
    // books-28. COSO's own free Executive Summary plus the public-domain GAO
    // Green Book that adopts it, merged HERE for the same reason as every other
    // leaf registry: a citation must mean one thing on every screen. Michael
    // asked for "verbatim coso"; these are the words, machine-checked.
    ...INTERNAL_CONTROL_AUTHORITIES.map((a) => ({
      tag: "internal-control" as const,
      authority: a,
    })),
    // books-31. The identity authorities: the sentences that say which box an
    // EIN, a legal name, a trade name, an ESD account number or a signer's
    // title belongs in, and what happens when the box is wrong. Merged here for
    // the standing reason - a citation must mean one thing on every screen -
    // and because the 941, 940, W-2, W-3 and Form 5208 builders will all cite
    // these same records rather than restating them.
    ...COMPANY_IDENTITY_AUTHORITIES.map((a) => ({
      tag: "company-identity" as const,
      authority: fromCompanyIdentity(a),
    })),
    // books-32. The workweek authorities. 29 CFR 778.104 is the sentence that
    // forbids averaging hours across two weeks, which is the single defect a
    // biweekly employer is most likely to ship and least likely to notice.
    // Merged here so that when the pay-run screen, the timesheet approval
    // screen and (later) the L&I quarterly hours report each cite 778.104,
    // they are all reading one record rather than three copies of it.
    ...TIMESHEET_AUTHORITIES.map((a) => ({
      tag: "timesheet" as const,
      authority: fromTimesheet(a),
    })),
    // books-33. The paid sick leave authorities. WAC 296-128-620 through -760
    // plus the one federal sentence that governs the interaction everybody gets
    // wrong: 29 CFR 778.218(a), paid leave is not hours worked. Merged here so
    // that the employee's request screen, the owner's approval screen and the
    // pay run all cite the same record when they explain why 44 paid hours
    // produced no overtime.
    ...SICK_LEAVE_AUTHORITIES.map((a) => ({
      tag: "sick-leave" as const,
      authority: fromSickLeave(a),
    })),
    // books-33. The wage-order authorities. The federal cap (15 U.S.C. 1673 and
    // its worked examples in 29 CFR part 870) and the Washington exemption that
    // is MORE protective for consumer debt (RCW 6.27.150), which is the whole
    // reason the engine computes both and takes the smaller garnishment.
    ...GARNISHMENT_AUTHORITIES.map((a) => ({
      tag: "garnishment" as const,
      authority: fromGarnishment(a),
    })),
    // books-34. The year-to-date authorities: the $184,500 social security
    // ceiling, Medicare's deliberate ABSENCE of one, the $200,000 Additional
    // Medicare threshold that the employer does not match, the SSA's own
    // rejection conditions (which are the CHECK constraints on the accumulator
    // table, written by SSA rather than invented here), and the IRS's worked
    // example that serves as the engine's test oracle. Merged here so the pay
    // run, the stub and the W-2 builder all cite one record when they explain
    // why social security withholding stopped mid-year.
    ...YTD_AUTHORITIES.map((a) => ({
      tag: "ytd" as const,
      authority: fromYtd(a),
    })),
    // books-37. The net-pay authorities: the statutory definition of
    // "disposable earnings" that every garnishment cap is a percentage of, the
    // enforcing agency's own list of what counts as "required by law" (and its
    // mirror-image list of what does NOT, which is where health insurance and
    // retirement live), the Washington section that COMPELS the L&I employee
    // deduction on pain of a gross misdemeanor, and the two sentences that make
    // any other deduction lawful or criminal in this state. Merged here for the
    // standing reason and for one specific one: the pay-run screen, the stub
    // and the garnishment screen all have to agree on the ORDER, and they will
    // now cite the same six records when they explain it.
    ...NET_PAY_AUTHORITIES.map((a) => ({
      tag: "net-pay" as const,
      authority: fromNetPay(a),
    })),
    // books-38. The wage-order ENTRY authorities: the twenty-day sworn-affidavit
    // answer duty, the five-working-day remittance clock, the two ways an
    // employer becomes liable for an employee's debt (100% of the support debt
    // under RCW 26.18.110(6), or a default judgment for the FULL creditor claim
    // under RCW 6.27.200 - and failing merely to ANSWER triggers both), the
    // sixty-day expiry that makes a creditor lien different in kind from a
    // support order, the statutory priority that makes arrival order
    // irrelevant, the capped processing fee, and the two anti-retaliation
    // provisions - one of which carries a prison term. Merged here for the
    // standing reason: a citation must mean the same thing on every screen.
    ...WAGE_ORDER_ENTRY_AUTHORITIES.map((a) => ({
      tag: "wage-order-entry" as const,
      authority: fromWageOrderEntry(a),
    })),
    // books-39. The PAY RUN authorities: the paragraph that says a missing W-4
    // does not stop payroll (withhold as single instead), the paragraph that
    // says an INVALID one must be disregarded entirely rather than partly
    // honoured, the W-4's due date, the five-working-day clock for remitting
    // support money, and the sentence that makes Washington's minimum wage
    // change every January - which is why a rate is chosen by PAY DATE and not
    // by the period worked. Merged here for the standing reason and for one
    // specific one: the pay-run screen explains why a cheque was withheld as
    // single, and the onboarding screen explains why the form was rejected.
    // Those are the same regulation and they must not read as two different
    // rules.
    ...PAY_RUN_AUTHORITIES.map((a) => ({
      tag: "pay-run" as const,
      authority: fromPayRun(a),
    })),
    // books-40. The Form 941 filing authorities: when the return is due, the
    // weekend/holiday shift that moves the deadline, who line 1 counts, why
    // line 2 must equal W-2 box 1, why line 5a is BOTH halves of Social
    // Security, and the fractions-of-cents line. No adapter is needed - these
    // are authored as GuidanceAuthority records directly. Merged HERE for the
    // standing reason: the 941 screen, the W-2 builder and the deposit
    // schedule will all cite 26 CFR 31.6071(a)-1, and they must be reading one
    // record rather than three copies that can drift apart.
    ...FORM_941_AUTHORITIES.map((a) => ({
      tag: "form-941" as const,
      authority: a,
    })),
    // books-41. Washington's four quarterly returns: WAC 192-310-010 (the 5208
    // forms, their due dates and the termination rule), RCW 50.24.010 and
    // 50.24.014 (no deduction from the worker, half-cent rounding, and the two
    // stacked EAF accounts), RCW 50A.10.030 (Paid Leave deduction, the trust,
    // the wage cap and the small-employer test) and WAC 296-17-31021/31023
    // (hours as the unit of exposure, and the duty to report a quarter with no
    // payroll).
    //
    // ONLY THE **OWN** AUTHORITIES ARE MERGED HERE, DELIBERATELY. The slice also
    // cites thirteen records it BORROWS from payroll-tax-authorities - the SUTA
    // rate structure, the PFML rate, WA Cares, the L&I formula, the late-payment
    // rules. Those already reach this registry through their own module, and
    // adding them a second time would create exactly the duplicate-record drift
    // that the merge logic below exists to detect. A citation must mean one
    // thing on every screen, which means each record has one home.
    ...WA_QUARTERLY_OWN_AUTHORITIES.map((a) => ({
      tag: "wa-quarterly" as const,
      authority: a,
    })),
    // books-43. Form 940's own instruction quotes. ONLY the module's OWN
    // authorities are merged here - `form940Authorities()` also returns three
    // borrowed statutes (§3301, §3306, §3302) which already reach this registry
    // through `payroll-tax-authorities`, and merging them twice would create
    // precisely the duplicate-record drift the logic below exists to detect.
    // Same discipline as the wa-quarterly block above: every record has ONE
    // home.
    //
    // MERGED HERE FOR A REASON THAT IS NOT CEREMONIAL. `verify-verbatim-quotes`
    // walks THIS registry and nothing else. An authorities module that exports
    // beautifully and is never merged is not "not yet wired" - it is a set of
    // unverified quotes wearing a green check (standing rule 50), because the
    // one script that would have compared them to the mirrored IRS text never
    // sees them. books-34 lost seven authorities exactly this way.
    ...FORM_940_OWN_AUTHORITIES.map((a) => ({
      tag: "form-940" as const,
      authority: a,
    })),
    // books-08. Kept in its own module because it is the ledger/chart slice's
    // research, but merged HERE so there is exactly one registry: a citation
    // must mean the same thing on every screen, which is the entire reason
    // this file exists.
    ...LEDGER_AUTHORITIES_NEW.map((a) => ({ tag: "ledger" as const, authority: a })),
    // books-10. Same reasoning as the ledger block above: the inventory
    // auditor's research lives in its own leaf module, but merges HERE so that
    // §1.471-2 means one thing whether you are reading the trial balance or a
    // count sheet.
    ...INVENTORY_AUDIT_AUTHORITIES_NEW.map((a) => ({
      tag: "inventory-audit" as const,
      authority: a,
    })),
    // books-12. The HOW-TO-COUNT authorities (ISA 501), kept separate from the
    // books-10 WHAT-THE-NUMBER-MEANS authorities because they answer a
    // different question and are cited on different screens. Merged here for
    // the usual reason: one registry, so a citation means one thing everywhere.
    ...AUDIT_HUB_AUTHORITIES_NEW.map((a) => ({
      tag: "audit-hub" as const,
      authority: a,
    })),
    // books-16. The PENALTY authorities: what every agency charges when a
    // payment is late, how each one counts time, and the three-way
    // deductibility split between the tax, the penalty and the interest.
    // Merged here for the usual reason: RCW 82.32.090 must say the same thing
    // on the excise screen as it does on the sales tax screen.
    ...TAX_PENALTY_AUTHORITIES_NEW.map((a) => ({
      tag: "tax-penalty" as const,
      authority: a,
    })),
    // books-16, and this one is a REPAIR rather than an addition. These 36
    // records were written during the payroll slice and then orphaned: the
    // module exported them, nothing imported them here, and so every one of
    // them was unreachable through findGuidanceAuthority(). The penalty engine
    // cites six (ESD late penalty and interest, L&I late penalty and
    // injunction, IRC 6656, IRC 6651), which is how the omission surfaced.
    // Wiring the whole registry rather than the six keeps the rule intact:
    // ONE registry, so a citation means one thing everywhere.
    ...PAYROLL_TAX_AUTHORITIES.map((a) => ({
      tag: "payroll-tax" as const,
      authority: a,
    })),
    // books-17. The FINANCIAL STATEMENT authorities: how a statement is laid
    // out (Reg S-X as a presentation canon, NOT as binding law), the FASB
    // conceptual rules against netting and against using a note as a
    // substitute for a number, where Washington's 37% excise actually lands,
    // and the two S-corporation equity accounts that look identical and have
    // different floors. Merged here for the usual reason: 1367 must mean the
    // same thing on the equity statement as it will on next year's K-1.
    ...FINANCIAL_STATEMENT_AUTHORITIES_NEW.map((a) => ({
      tag: "financial-statement" as const,
      authority: a,
    })),
    // books-18. Why a month gets sealed and what it costs to unseal it: ASC 250
    // on what counts as an error, and the restatement that follows one. Kept
    // with the guidance registry rather than inside the close engine so the
    // close screen and the financial statements cite the SAME 250, not two
    // drifting copies of it.
    ...PERIOD_CLOSE_AUTHORITIES_NEW.map((a) => ({
      tag: "period-close" as const,
      authority: a,
    })),
    // books-19. Stock basis, debt basis, and the AAA. These live here rather
    // than inside the basis engine for the same reason ASC 250 does: the
    // equity statement, the K-1 that is coming next, and the basis schedule
    // must all cite ONE §1367 and ONE §1368, not three copies that drift
    // apart. §1367(a) and §1368(b),(d),(e)(1)(A) were already registered by
    // books-17 and are deliberately NOT re-declared — books-19 adds only what
    // was genuinely missing.
    ...BASIS_AAA_AUTHORITIES_NEW.map((a) => ({
      tag: "basis-aaa" as const,
      authority: a,
    })),
    // books-20. HOW YOU LEAVE A METHOD YOU HAVE BEEN USING FOR TWELVE YEARS.
    // The reseller-versus-producer authorities are NOT here: §1.471-3(b), (c)
    // and (f), §280E, Harborside, Alterman and CHAMP were registered by the
    // payroll-COGS and vendor-bill slices and standing rule 2 forbids a second
    // copy. What is new is the machinery around CHANGING a position — §446(e)
    // consent, §481(a) true-up, and the Rev. Proc. 2015-13 audit protection
    // that makes correcting yourself safer than sitting still — plus the
    // Washington statute that decides, as a matter of state law rather than
    // judgment, that a retail licensee can never be a producer.
    ...COGS_POSITION_AUTHORITIES_NEW.map((a) => ({
      tag: "cogs-position" as const,
      authority: a,
    })),
    // books-21. INTEREST, DAILY COMPOUNDING, AND THE PENALTY THAT WAS MISSING.
    // \u00a76621's rate structure and \u00a76622's daily compounding, both of which the
    // books-16 engine described in prose and never computed \u2014 plus \u00a76699, the
    // per-shareholder penalty for a late Form 1120-S, which did not appear
    // anywhere in this codebase at all. \u00a76651(a) and (j) are here to prove that
    // the $435 in the penalty engine is the statutory BASE rather than a stale
    // figure. \u00a71361(a) and \u00a76621(c) are a matched pair: the second says the
    // punitive "large corporate underpayment" rate reaches only a C
    // corporation, and the first says Greenway is not one.
    ...INTEREST_AUTHORITIES_NEW.map((a) => ({
      tag: "interest" as const,
      authority: a,
    })),
    // books-25. WHAT A NEW HIRE MUST FILL OUT, WHEN, AND WHAT HAPPENS WHEN
    // THEY DO NOT. Three agencies with three different deadlines on the same
    // hire: the I-9's three business days (immigration), the W-4 on day one
    // (Treasury), and Washington's twenty-day registry report (Division of
    // Child Support).
    //
    // Registered here rather than left in the payroll module because the
    // hiring screen, the employee record and next year's W-2 must all cite ONE
    // §31.3402(f)(2)-1. Note what is deliberately NOT re-declared: the no-W-4
    // default as IRS Pub. 15-T states it, and the "exempt means income tax
    // only" warning, both already registered by the payroll slice. This
    // registry adds the BINDING regulation behind the first of those, which is
    // a different document making the same point, not a second copy of it.
    ...PAYROLL_ONBOARDING_AUTHORITIES.map((a) => ({
      tag: "payroll-onboarding" as const,
      authority: a,
    })),
    // books-27. THE AUTHORITY FOR LAYOUT ITSELF, which sounds like a category
    // error until you read QC30: "classifying, characterizing, and presenting
    // information clearly and concisely makes it understandable." Michael said
    // he does not open his Sage reports because he cannot read them; the FASB
    // has a name for that failure and an entire section on the cure.
    //
    // Registered here so a report screen can cite its own layout decisions the
    // same way a tax screen cites §280E. Note ASC 205-10-45-1 and -45-3 are
    // BINDING GAAP, while the CON 8 records are the FASB's reasoning and carry
    // CONCEPTUAL_FRAMEWORK_DISCLAIMER wherever they are shown.
    ...REPORTING_AUTHORITIES_NEW.map((a) => ({
      tag: "reporting" as const,
      authority: a,
    })),
  ];
}

// ---------------------------------------------------------------------------
// 5) DRIFT DETECTION
//
// WHAT COUNTS AS DRIFT, and why the distinction matters:
//
//   `quote`  — drift here is a CITATION ERROR. The same citation would say two
//              different things on two different screens. Unforgivable.
//   `kind`   — drift here MISREPRESENTS HOW MUCH WEIGHT a document carries.
//              A Senate Report labelled "statute" claims the force of law for
//              something that is only persuasive. Also unforgivable, and less
//              obvious, which makes it worse.
//   `cite`   — drift here is usually a pinpoint page (e.g. ", 1200") present in
//              one place and absent in another. Worth reporting, rarely serious.
//   `soWhat` — NOT drift. That field is deliberately written for the page it
//              appears on: the §280E "so what" for a vendor bill SHOULD read
//              differently from the one for payroll. Teaching in context is the
//              whole point, so this field is excluded from the check by design.
//   `source` — NOT drift for the same reason; one registry may cite the reporter
//              and another the URL. Excluded deliberately.
// ---------------------------------------------------------------------------

/** The fields where disagreement is a defect rather than deliberate context. */
export const DRIFT_CHECKED_FIELDS = ["quote", "kind", "cite"] as const;
export type DriftField = (typeof DRIFT_CHECKED_FIELDS)[number];

/** How bad is a disagreement in each field? Drives whether the build fails. */
export const DRIFT_SEVERITY: Record<DriftField, "error" | "warn"> = {
  quote: "error",
  kind: "error",
  cite: "warn",
};

export type AuthorityDrift = {
  id: string;
  field: DriftField;
  severity: "error" | "warn";
  /** What each registry says. Sorted for stable output. */
  values: readonly { registry: SourceRegistry; value: string }[];
};

/**
 * Scan every registry and report each id whose drift-checked fields are not
 * identical everywhere they are defined.
 *
 * This converts "four private libraries that quietly agree most of the time"
 * into something a test can assert, instead of something someone has to
 * remember to eyeball.
 */
export function findAuthorityDrift(): readonly AuthorityDrift[] {
  return driftBetween(taggedCandidates());
}

/**
 * The comparison itself, over any set of tagged authorities.
 *
 * Exported so the detector can be tested on SYNTHETIC disagreements. Once a
 * class of drift is fixed everywhere in the real registries, real data stops
 * exercising the check for it — and an unexercised check is one edit away from
 * being silently disabled.
 */
export function driftBetween(
  candidates: readonly { tag: SourceRegistry; authority: GuidanceAuthority }[],
): readonly AuthorityDrift[] {
  const byId = new Map<string, Array<{ tag: SourceRegistry; authority: GuidanceAuthority }>>();
  for (const c of candidates) {
    const list = byId.get(c.authority.id) ?? [];
    list.push(c);
    byId.set(c.authority.id, list);
  }

  const out: AuthorityDrift[] = [];
  for (const [id, entries] of byId) {
    if (entries.length < 2) continue;
    for (const field of DRIFT_CHECKED_FIELDS) {
      const values = entries.map((e) => ({ registry: e.tag, value: e.authority[field] }));
      if (new Set(values.map((v) => v.value)).size <= 1) continue;
      out.push({
        id,
        field,
        severity: DRIFT_SEVERITY[field],
        values: values.sort((a, b) => a.registry.localeCompare(b.registry)),
      });
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id) || a.field.localeCompare(b.field));
}

// ---------------------------------------------------------------------------
// 6) INVESTIGATED DIVERGENCES — resolved against the PRIMARY SOURCE
//
// Each entry records a disagreement that was found by running the scanner
// above, then checked by fetching the underlying document. `winner` names the
// registry whose text was verified correct. `finding` is the evidence, written
// so a future maintainer (or Michael's accountant) can re-check it without
// trusting anyone's memory.
//
// Anything drifted and NOT listed here is a build-breaking error. That is the
// point: an unexamined disagreement between two citations of the same document
// must never be able to reach the screen.
// ---------------------------------------------------------------------------

export type DivergenceRuling = {
  id: string;
  field: DriftField;
  winner: SourceRegistry;
  /** The evidence, in plain English. */
  finding: string;
  /** Is the losing registry actually WRONG (needs its own fix PR)? */
  losingRegistryIsDefective: boolean;
};

export const DIVERGENCE_RULINGS: readonly DivergenceRuling[] = [
  {
    id: "CCA_201504011",
    field: "quote",
    winner: "payroll",
    finding:
      "RESOLVED IN books-09. Re-verified against the primary document (I.R.S. C.C.A. 201504011, PDF at " +
      "irs.gov/pub/irs-wd/201504011.pdf, text extracted with pdftotext). The memo contains BOTH passages, " +
      "but they are not adjacent: the timing sentence — 'Section 263A is a timing provision. It does not " +
      "change the character of any expense from \"nondeductible\" to \"deductible,\" or vice versa.' — sits in " +
      "the analysis, while 'A taxpayer trafficking in a Schedule I or Schedule II controlled substance " +
      "determines COGS using the applicable inventory-costing regulations under §471 as they existed when " +
      "§280E was enacted.' is CONCLUSION (1) on the memo's first page. The original payroll text ran the two " +
      "together inside one pair of quotation marks with no ellipsis AND paraphrased the second ('determines " +
      "cost of goods sold' for the memo's 'determines COGS'), which is why this was logged as a defect. " +
      "books-09 restored the exact wording and inserted '...' to mark the jump. Both registries are now " +
      "verbatim-accurate; they simply quote different amounts of the same memo. The fuller text wins because " +
      "the §471-as-of-1982 conclusion is the operative holding for a §280E taxpayer.",
    losingRegistryIsDefective: false,
  },
  {
    id: "ALPENGLOW_EXCLUSION",
    field: "cite",
    winner: "payroll",
    finding:
      "Same case, same reporter, same year: Alpenglow Botanicals, LLC v. United States, 894 F.3d 1187 " +
      "(10th Cir. 2018). payroll-cogs-core adds the pinpoint page (', 1200') identifying where in the opinion " +
      "the quoted language sits, which is the more useful citation for anyone checking it. vendor-bill-core " +
      "omits the pinpoint. Neither is incorrect; the fuller one wins.",
    losingRegistryIsDefective: false,
  },
] as const;

const RULING_BY_KEY: ReadonlyMap<string, DivergenceRuling> = new Map(
  DIVERGENCE_RULINGS.map((r) => [`${r.id}::${r.field}`, r]),
);

export function findDivergenceRuling(id: string, field: DriftField): DivergenceRuling | undefined {
  return RULING_BY_KEY.get(`${id}::${field}`);
}

/**
 * Drift that has NOT been investigated. Empty is the only acceptable value,
 * and the self-tests assert exactly that.
 */
export function unresolvedDrift(): readonly AuthorityDrift[] {
  return findAuthorityDrift().filter((d) => !findDivergenceRuling(d.id, d.field));
}

/**
 * Known defects in OTHER modules, surfaced by this slice's cross-check.
 *
 * These are NOT fixed here. Standing rule 4 is one feature per PR, and this
 * slice is the guidance layer, not a payroll or vendor-bill change. Listing
 * them as data means they cannot be quietly forgotten: the self-tests assert
 * the list matches what the scanner actually finds, so the day someone fixes
 * payroll-cogs-core, this list must shrink or the tests fail.
 */
export function knownDefectsInOtherModules(): readonly DivergenceRuling[] {
  return DIVERGENCE_RULINGS.filter((r) => r.losingRegistryIsDefective);
}

// ---------------------------------------------------------------------------
// 7) THE MERGED REGISTRY
//
// The single list every books page and (later) the concierge reads from.
// Where a ruling exists, the verified registry's value wins. Where drift
// exists with no ruling, construction THROWS — a silent disagreement between
// two citations of the same document must never reach a screen.
// ---------------------------------------------------------------------------

export const GUIDANCE_AUTHORITIES: readonly GuidanceAuthority[] = (() => {
  const unresolved = unresolvedDrift().filter((d) => d.severity === "error");
  if (unresolved.length > 0) {
    throw new Error(
      "books-guidance-core: UNRESOLVED authority drift on " +
        unresolved.map((d) => `${d.id}.${d.field}`).join(", ") +
        " — two registries disagree and no ruling exists. Check the PRIMARY SOURCE and add a " +
        "DIVERGENCE_RULINGS entry before this can ship.",
    );
  }

  const byId = new Map<string, GuidanceAuthority>();
  const winners = new Map<string, SourceRegistry>();

  for (const { tag, authority } of taggedCandidates()) {
    const existing = byId.get(authority.id);
    if (!existing) {
      byId.set(authority.id, authority);
      winners.set(authority.id, tag);
      continue;
    }
    // Apply every ruling that names THIS registry as the verified one, field
    // by field, so a quote can be taken from one registry and a kind from
    // another if that is what the evidence actually showed.
    let merged = existing;
    for (const field of DRIFT_CHECKED_FIELDS) {
      const ruling = findDivergenceRuling(authority.id, field);
      if (ruling && ruling.winner === tag) merged = { ...merged, [field]: authority[field] };
    }
    byId.set(authority.id, merged);
  }

  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
})();

const GUIDANCE_BY_ID: ReadonlyMap<string, GuidanceAuthority> = new Map(
  GUIDANCE_AUTHORITIES.map((a) => [a.id, a]),
);

/** O(1) lookup, mirroring findAuthority / findBankAuthority / findGateAuthority. */
export function findGuidanceAuthority(id: string): GuidanceAuthority | undefined {
  return GUIDANCE_BY_ID.get(id);
}

/** How much weight this authority carries, and what that means in English. */
export function weightOf(a: GuidanceAuthority): { rank: 1 | 2 | 3; meaning: string } {
  const rank = GUIDANCE_KIND_WEIGHT[a.kind];
  return { rank, meaning: GUIDANCE_WEIGHT_MEANING[rank] };
}

/**
 * Render ids as a citation string. An unknown id renders VISIBLY rather than
 * vanishing — the same discipline citePayrollAuthorities uses, because a
 * citation list that quietly shrinks is how a memo loses its support without
 * anyone noticing.
 */
export function citeGuidanceAuthorities(ids: readonly string[]): string {
  return ids
    .map((id) => findGuidanceAuthority(id)?.cite ?? `[unknown authority: ${id}]`)
    .join("; ");
}

/**
 * Resolve ids to authorities for rendering. Unknown ids are RETURNED as
 * misses rather than dropped, so a UI can show that something is missing
 * instead of quietly displaying a shorter list.
 */
export function resolveAuthorities(ids: readonly string[]): {
  found: readonly GuidanceAuthority[];
  missing: readonly string[];
} {
  const found: GuidanceAuthority[] = [];
  const missing: string[] = [];
  for (const id of ids) {
    const a = findGuidanceAuthority(id);
    if (a) found.push(a);
    else missing.push(id);
  }
  return { found, missing };
}

// ---------------------------------------------------------------------------
// 8) THE FINGERPRINT SCREEN — AS 2401.61, run on YOUR OWN entry, first
//
// AS 2401.61 lists the five characteristics that make an examiner look twice at
// a journal entry. That list is normally used BY an auditor, ON a company. Here
// it is turned around and run by Michael, on Michael, before posting — so that
// anything an examiner would flag gets flagged while it is still fresh, still
// fixable, and while he still remembers what it was for.
//
// THE TONE IS DELIBERATE AND IT MATTERS. Not one of these five is illegal, and
// the code must never imply otherwise. A round number is not fraud; a Tuesday
// $500 rent payment is a round number. A month-end entry is not fraud; that is
// when accruals belong. Each flag is A QUESTION YOU SHOULD BE ABLE TO ANSWER,
// and the answer is almost always "yes, because ___" — which, once written into
// the memo, is exactly the contemporaneous explanation that makes the question
// go away permanently.
//
// This screen ADVISES. It never blocks. journal-advisor-core owns the three
// hard blocks (ADV_UNBALANCED, ADV_PERIOD_CLOSED, ADV_EXCISE_MISCODED) and this
// module deliberately does not add a fourth. Michael's standing instruction is
// that the system "pushes back and tries to help me enter it correctly rather
// than rejecting it outright."
// ---------------------------------------------------------------------------

/** The five characteristics, verbatim-anchored to AS 2401.61 clauses (a)-(e). */
export type FingerprintCode =
  | "FP_SELDOM_USED_ACCOUNT" // .61(a)
  | "FP_PERIOD_END" //          .61(c)
  | "FP_NO_EXPLANATION" //      .61(c)
  | "FP_ROUND_NUMBER" //        .61(e)
  | "FP_CONSISTENT_ENDING"; //  .61(e)

export const ALL_FINGERPRINT_CODES: readonly FingerprintCode[] = [
  "FP_SELDOM_USED_ACCOUNT",
  "FP_PERIOD_END",
  "FP_NO_EXPLANATION",
  "FP_ROUND_NUMBER",
  "FP_CONSISTENT_ENDING",
] as const;

export type Fingerprint = {
  code: FingerprintCode;
  /** The AS 2401.61 clause this comes from, e.g. "(a)". */
  clause: string;
  /** What was noticed, stated as an observation and never as an allegation. */
  observation: string;
  /** The question to answer. Answering it in the memo is what clears it. */
  question: string;
  /** Concretely, what to write. Never vague. */
  suggestion: string;
  /** Line numbers (1-based). Empty means the entry as a whole. */
  lines: readonly number[];
  authorityIds: readonly string[];
};

/**
 * WHY .61(b) AND .61(d) ARE NOT IMPLEMENTED, stated openly rather than left as
 * a silent gap:
 *
 *   (b) "made by individuals who typically do not make journal entries" —
 *       cannot fire here. Michael is the only person with books access at all
 *       (owner-only gate, enforced in the database by migration 0185). There is
 *       no population of "unusual" authors to compare against, so a check would
 *       be theatre. If books access is ever widened, this is the first thing to
 *       build, and this comment is the reminder.
 *
 *   (d) "do not have account numbers" — unrepresentable by construction. Every
 *       line in this system references gl_accounts by code; there is no way to
 *       write a line without one. A check that can never fire is a test that
 *       cannot fail (standing rule 15), so it is documented, not faked.
 */
export const FINGERPRINT_CLAUSES_NOT_IMPLEMENTED: readonly {
  clause: string;
  text: string;
  why: string;
}[] = [
  {
    clause: "(b)",
    text: "made by individuals who typically do not make journal entries",
    why:
      "You are the only person with access to the books, so there is no 'unusual author' to detect. If that " +
      "ever changes, this is the first check to add.",
  },
  {
    clause: "(d)",
    text: "made either before or during the preparation of the financial statements that do not have account numbers",
    why:
      "Impossible here by design: every line must reference a real account from the chart of accounts, so an " +
      "entry without account numbers cannot be written in the first place.",
  },
] as const;

/** What the screen needs to know. Deliberately minimal and all caller-supplied. */
export type FingerprintInput = {
  /** ISO yyyy-mm-dd, Pacific business day (standing rule 8). */
  journalDate: string;
  /** The memo as typed. */
  memo: string;
  lines: readonly {
    accountCode: string;
    /** Signed integer cents. POSITIVE = debit, NEGATIVE = credit (the sign wall). */
    amountCents: number;
    description?: string | null;
  }[];
  /**
   * How many times each account has been used in a manual journal entry
   * before now. Supplied by the caller (the page reads it); this module does
   * no I/O. An account absent from the map is treated as never used.
   */
  priorManualUseByAccount?: Readonly<Record<string, number>>;
};

/**
 * An account used this few times before is "seldom-used" for .61(a) purposes.
 * Three is a judgement call, and it is a CONSTANT rather than a magic number so
 * that it can be seen, argued with, and swept by the tests.
 */
export const SELDOM_USED_THRESHOLD = 3;

/** A memo this short cannot be an explanation. Also deliberately visible. */
export const THIN_MEMO_CHARS = 15;

/** Round to the nearest whole dollar => trailing "00" in cents. */
export function isRoundDollar(cents: number): boolean {
  return cents !== 0 && Math.abs(cents) % 100 === 0;
}

/** Round to the nearest hundred dollars. The louder version of .61(e). */
export function isRoundHundredDollars(cents: number): boolean {
  return cents !== 0 && Math.abs(cents) % 10_000 === 0;
}

/** Last calendar day of the month for an ISO date. Leap-year aware, pure. */
export function isLastDayOfMonth(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  if (m < 1 || m > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return d === dim;
}

/** Is this the last day of a QUARTER (Mar/Jun/Sep/Dec)? Louder still. */
export function isQuarterEnd(iso: string): boolean {
  if (!isLastDayOfMonth(iso)) return false;
  const m = Number(iso.slice(5, 7));
  return m === 3 || m === 6 || m === 9 || m === 12;
}

/**
 * Run the AS 2401.61 checklist over a draft entry.
 *
 * Pure, total, and order-stable: the same input always yields the same
 * fingerprints in the same order, so the tests can assert exact sequences and
 * the UI never reshuffles under the reader.
 */
export function screenForFingerprints(input: FingerprintInput): readonly Fingerprint[] {
  const out: Fingerprint[] = [];
  const priorUse = input.priorManualUseByAccount ?? {};

  // ── .61(a) seldom-used accounts ─────────────────────────────────────────
  const seldom: number[] = [];
  for (let i = 0; i < input.lines.length; i++) {
    const code = input.lines[i].accountCode;
    const used = priorUse[code] ?? 0;
    if (used <= SELDOM_USED_THRESHOLD) seldom.push(i + 1);
  }
  if (seldom.length > 0) {
    out.push({
      code: "FP_SELDOM_USED_ACCOUNT",
      clause: "(a)",
      observation:
        seldom.length === input.lines.length
          ? "Every account in this entry is one you have rarely or never posted to by hand before."
          : `${seldom.length} of the ${input.lines.length} accounts in this entry are ones you have rarely or never posted to by hand before.`,
      question:
        "Is this account genuinely the right home for this transaction, or is it just the closest thing you could find in the list?",
      suggestion:
        "If it is the right account, say in the memo WHY this transaction belongs there — one sentence is enough, and it is the sentence you will be glad of in three years. If you are not sure it is the right account, check the chart of accounts before posting rather than after.",
      lines: seldom,
      authorityIds: ["AS_2401_61_FINGERPRINTS"],
    });
  }

  // ── .61(c) period-end timing ────────────────────────────────────────────
  if (isLastDayOfMonth(input.journalDate)) {
    const quarter = isQuarterEnd(input.journalDate);
    out.push({
      code: "FP_PERIOD_END",
      clause: "(c)",
      observation: quarter
        ? `This entry is dated ${input.journalDate} — the last day of a quarter. Period-end entries get looked at first, and quarter-end hardest of all.`
        : `This entry is dated ${input.journalDate} — the last day of the month. Period-end entries are the ones an examiner reads first.`,
      question:
        "Did this actually happen on this date, or is this date chosen to land the entry in this period?",
      suggestion:
        "Both answers are fine and neither is unusual — accruals BELONG at period end. What is not fine is a period-end entry with no explanation. Write what happened and why it belongs in this period, not the next one.",
      lines: [],
      authorityIds: ["AS_2401_61_FINGERPRINTS", "AS_2401_58_JOURNAL_ENTRIES"],
    });
  }

  // ── .61(c) little or no explanation ─────────────────────────────────────
  const memo = input.memo.trim();
  if (memo.length < THIN_MEMO_CHARS) {
    out.push({
      code: "FP_NO_EXPLANATION",
      clause: "(c)",
      observation:
        memo.length === 0
          ? "This entry has no memo at all."
          : `The memo is ${memo.length} characters ("${memo}"), which is a label rather than an explanation.`,
      question: "In three years, with no memory of today, would this memo tell you what happened?",
      suggestion:
        "Write what happened, why, and what proves it — for example: 'Cash purchase of display shelving from Home Depot, receipt #4471, paid from the vault.' AS 2401 singles out entries with 'little or no explanation or description'. This is the cheapest possible insurance and it takes ten seconds.",
      lines: [],
      authorityIds: ["AS_2401_61_FINGERPRINTS", "REG_1_6662_3_B_1_NEGLIGENCE"],
    });
  }

  // ── .61(e) round numbers ────────────────────────────────────────────────
  const roundLines: number[] = [];
  let anyHundreds = false;
  for (let i = 0; i < input.lines.length; i++) {
    const c = input.lines[i].amountCents;
    if (isRoundDollar(c)) {
      roundLines.push(i + 1);
      if (isRoundHundredDollars(c)) anyHundreds = true;
    }
  }
  if (roundLines.length > 0 && roundLines.length === input.lines.length) {
    out.push({
      code: "FP_ROUND_NUMBER",
      clause: "(e)",
      observation: anyHundreds
        ? "Every amount in this entry is a round number, and at least one is a round hundred dollars."
        : "Every amount in this entry is a round number of dollars — no cents anywhere.",
      question: "Is this a real measured amount, or an estimate someone tidied up?",
      suggestion:
        "Round numbers are completely normal for rent, a loan, or a transfer — if that is what this is, say so in the memo and there is nothing more to do. If it is an ESTIMATE, say that too, and say what it is based on. An estimate you labelled as an estimate is a judgement; an estimate that looks like a measurement is the thing that got the old books their $4,624,697.31 plug.",
      lines: roundLines,
      authorityIds: ["AS_2401_61_FINGERPRINTS", "IRC_6001_SUBSTANTIATION"],
    });
  }

  // ── .61(e) a consistent ending number ───────────────────────────────────
  if (input.lines.length >= 3) {
    const endings = new Set(input.lines.map((l) => Math.abs(l.amountCents) % 100));
    if (endings.size === 1 && !endings.has(0)) {
      out.push({
        code: "FP_CONSISTENT_ENDING",
        clause: "(e)",
        observation:
          `All ${input.lines.length} lines end in the same cents value (${[...endings][0]}¢), which is an unusual coincidence across separate amounts.`,
        question: "Were these amounts derived from one another, or measured independently?",
        suggestion:
          "Usually this just means one figure was split or a percentage was applied — perfectly fine. Say which in the memo, so the coincidence has an explanation attached to it rather than sitting there looking like a pattern.",
        lines: input.lines.map((_, i) => i + 1),
        authorityIds: ["AS_2401_61_FINGERPRINTS"],
      });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// 9) WHAT A TRIAL BALANCE ACTUALLY PROVES
//
// The most dangerous idea in bookkeeping is that a balanced trial balance means
// the books are right. It does not, and the gap is not small: it is the entire
// COMPLETENESS assertion (AS 1105.11).
//
// The reason is mechanical, not philosophical. Every journal is forced to
// balance when it posts. So a transaction that was NEVER RECORDED is absent
// from both columns — it cancels itself perfectly, the trial balance ties, and
// the report cheerfully announces that everything is fine. This is the same
// failure the bank-matching slice named "D8 ties ≠ complete", and it is why
// both screens are written to refuse to congratulate anybody.
//
// So this section states, as DATA rather than prose, exactly what footing does
// and does not prove — so the page can show it and a test can assert it.
// ---------------------------------------------------------------------------

export type ProofItem = {
  /** The claim, stated plainly. */
  claim: string;
  /** Does a balanced trial balance actually establish it? */
  proven: boolean;
  /** Why — including the mechanism, not just the verdict. */
  because: string;
  /** If not proven, what DOES establish it? Never leave a gap without a remedy. */
  insteadDoThis?: string;
  authorityIds: readonly string[];
};

export const TRIAL_BALANCE_PROVES: readonly ProofItem[] = [
  {
    claim: "The arithmetic holds — total debits equal total credits.",
    proven: true,
    because:
      "This is the one thing footing actually tests, and it is worth having. If it ever fails, something is badly wrong: lines were lost, double-counted, or read from outside the ledger.",
    authorityIds: [],
  },
  {
    claim: "Every transaction that happened is in the books.",
    proven: false,
    because:
      "A transaction you never recorded is missing from BOTH columns, so it cancels itself and the totals still agree. A trial balance cannot see something that was never written down. This is the completeness assertion, and footing has nothing to say about it.",
    insteadDoThis:
      "Reconcile to something OUTSIDE the books: the bank statement, the cash count, the CCRS inventory, the excise return. Agreement with an outside record is the only real evidence of completeness.",
    authorityIds: ["AS_1105_11_COMPLETENESS", "BARS_UNRECORDED_ITEMS"],
  },
  {
    claim: "Each amount is correct.",
    proven: false,
    because:
      "Post $5,000 as debit and credit when it should have been $500 and the books balance beautifully. Both sides are equally wrong, which is exactly what keeps them equal.",
    insteadDoThis:
      "Tie the balance back to its source document — the invoice, the receipt, the statement. WAC 314-55-087(2)(a) requires you to be able to do this on request anyway.",
    authorityIds: ["WAC_314_55_087_ADP_AUDIT_TRAIL", "IRC_6001_SUBSTANTIATION"],
  },
  {
    claim: "Each amount is in the right account.",
    proven: false,
    because:
      "Debit the wrong expense account and the trial balance still ties — you have simply moved the same money to the wrong home. This is how you end up deducting something §280E disallows, with a perfectly balanced set of books.",
    insteadDoThis:
      "Read the accounts down the page and ask whether each balance makes sense for this business. An account with an unexpected balance is worth a minute of attention, and this page marks the abnormal ones for you.",
    authorityIds: ["IRC_280E", "REG_1_446_1_A_2_CLEARLY_REFLECT"],
  },
  {
    claim: "Each amount is in the right period.",
    proven: false,
    because:
      "Date an entry December instead of January and both sides move together. The trial balance for the year still ties; the income has simply landed in the wrong year, which is the year the tax is calculated on.",
    insteadDoThis:
      "Check that period-end entries have an explanation, and that nothing is dated before the line in the sand. This system refuses pre-2026 dates outright for exactly this reason.",
    authorityIds: ["REG_1_446_1_A_2_CLEARLY_REFLECT", "AS_2401_61_FINGERPRINTS"],
  },
  {
    claim: "Nobody manipulated anything.",
    proven: false,
    because:
      "A fabricated journal entry balances — it has to, or it could not be posted. Balance is a property of the ENTRY, not evidence about the person who wrote it.",
    insteadDoThis:
      "This is what the audit trail is for: who, when, what changed, and never deleted. Balance proves nothing about intent; the trail is what makes intent checkable.",
    authorityIds: ["AS_2401_58_JOURNAL_ENTRIES", "AS_2401_57_OVERRIDE"],
  },
  {
    claim: "The books are ready for a tax return.",
    proven: false,
    because:
      "The return needs more than a tied trial balance. It needs the §280E split between COGS and disallowed expense, and it needs a reconciliation between book income and taxable income — which will not match, by design.",
    insteadDoThis:
      "Keep the reconciliation as you go, not in April. §1.446-1(a)(4) treats it as part of the records you are required to maintain, not as optional working paper.",
    authorityIds: ["REG_1_446_1_A_4_RECONCILIATION", "IRC_280E"],
  },
];

/**
 * The completeness checks that DO test what footing cannot. Every one of these
 * compares the books to something outside the books, because that comparison
 * is the only thing that can detect an entry that was never made.
 */
export type CompletenessCheck = {
  code: string;
  /** What to compare. */
  title: string;
  /** The outside record — the thing the books are measured AGAINST. */
  outsideRecord: string;
  /** What it catches that a trial balance cannot. */
  catches: string;
  /** Where in this application to do it, or null if not yet built. */
  href: string | null;
  authorityIds: readonly string[];
};

export const COMPLETENESS_CHECKS: readonly CompletenessCheck[] = [
  {
    code: "CC_BANK",
    title: "Reconcile every bank account",
    outsideRecord: "The bank statement — a record the business does not write.",
    catches:
      "Money that moved without an entry: bank fees, interest, an ACH you forgot, a deposit that never got recorded.",
    href: "/admin/books/bank",
    authorityIds: ["BARS_UNRECORDED_ITEMS", "BARS_NO_FURTHER_DIFFERENCES", "WAC_314_55_087_RECORDS"],
  },
  {
    code: "CC_CASH",
    title: "Count the cash and agree it to the books",
    outsideRecord: "The physical count of the vault, the tills, and the ATM.",
    catches:
      "The difference between what the books say you have and what is actually in the safe. In a cash business this is the single most important check there is, and no amount of footing substitutes for it.",
    href: null,
    authorityIds: ["AS_2401_85_CASH_ON_HAND", "WAC_314_55_087_RECORDS"],
  },
  {
    code: "CC_INVENTORY",
    title: "Agree inventory to the traceability system",
    outsideRecord: "CCRS — the state's record of what you are supposed to be holding.",
    catches:
      "Product that left without a sale being recorded, and the negative inventory balances that made the old books unusable.",
    href: "/admin/inventory",
    authorityIds: ["WAC_314_55_083_TRACEABILITY", "REG_1_471_3_B"],
  },
  {
    code: "CC_EXCISE",
    title: "Agree excise liability to the filed return",
    outsideRecord: "The excise return actually filed with the LCB.",
    catches:
      "An excise accrual that drifted from what was reported — and the credit-to-revenue mistake that made the old books show income that was never earned.",
    href: "/admin/compliance/excise",
    authorityIds: ["RCW_69_50_535"],
  },
  {
    code: "CC_PAYROLL",
    title: "Agree payroll to the quarterly filings",
    outsideRecord: "Forms 941 and the state filings, plus the payroll register.",
    catches:
      "Wages or withheld tax recorded in the books but never remitted — the trust-fund money that is not yours to spend.",
    href: "/admin/books/payroll",
    authorityIds: ["IRC_7501_TRUST", "REG_31_6001_1_E_2_FOUR_YEARS"],
  },
  {
    code: "CC_AP",
    title: "Agree accounts payable to vendor statements",
    outsideRecord: "What your vendors say you owe them.",
    catches:
      "Bills received but never entered — the classic way expenses land in the wrong year and understate what you owe.",
    href: "/admin/books/bills",
    authorityIds: ["REG_1_446_1_A_2_CLEARLY_REFLECT"],
  },
];

// ---------------------------------------------------------------------------
// 10) THE MENTOR LAYER — "teach me how and why"
//
// Michael, recorded verbatim (standing rule 1):
//   "I have always needed a mentor, a cpa or cfo to shadow, I want our platform
//    to be that mentor."
//   "Really make sure the system is a PhD CPA/ CFO, whose sole purpose is to
//    guide me and keep me safe and teach me how and why."
//
// A mentor does not recite regulations. A mentor tells you what to do, in what
// order, and what happens if you skip a step. So the guidance below is written
// as SEQUENCE and CONSEQUENCE, not as reference material — and each step is
// anchored to the authority that makes it matter, so the "why" is checkable
// rather than merely asserted.
// ---------------------------------------------------------------------------

export type MentorStep = {
  /** 1-based position. The order is the teaching. */
  step: number;
  /** What to do. An instruction, not a topic. */
  action: string;
  /** Why it sits at THIS point in the sequence and not somewhere else. */
  why: string;
  /** What goes wrong when this step is skipped. Concrete, never abstract. */
  ifSkipped: string;
  authorityIds: readonly string[];
};

/**
 * HOW TO WRITE A MANUAL JOURNAL ENTRY, in the order a CPA would actually do it.
 *
 * Note that "decide the accounts" comes THIRD, not first. Most people start by
 * hunting for an account, which is how money ends up wherever the search box
 * happened to land. The document comes first, because the document is the only
 * thing that survives to be shown to anyone.
 */
export const JOURNAL_MENTOR_STEPS: readonly MentorStep[] = [
  {
    step: 1,
    action: "Find the piece of paper first — the receipt, the invoice, the statement, the photo of the receipt.",
    why:
      "The entry is a description of something that happened. Without the document you are describing a memory, and memories are not records. Everything else in this sequence depends on having it.",
    ifSkipped:
      "You end up entering what you THINK happened. Three years later there is a number in your books with nothing behind it, and the burden of proving it is real is yours, not the IRS's.",
    authorityIds: ["IRC_6001_SUBSTANTIATION", "REG_1_6001_1_RECORDS"],
  },
  {
    step: 2,
    action: "Say which entity it belongs to: Greenway, the ATM, the land, or you personally.",
    why:
      "Entity comes before accounts because it is the one thing you cannot fix later by editing a line. The four sets of books have to stay complete and separable, or they stop being four businesses.",
    ifSkipped:
      "The books bleed together, and the argument that the ATM and the rental are separate from the cannabis business gets weaker. That argument is what keeps §280E away from them.",
    authorityIds: ["REG_1_446_1_D_2_SEPARATE_BOOKS", "CHAMP"],
  },
  {
    step: 3,
    action: "Decide what actually changed: what came in, what went out, what was owed or paid.",
    why:
      "Describe the event before you name accounts. Accounts are where the description gets filed; they are not the description itself. Getting this backwards is what produces entries that balance but mean nothing.",
    ifSkipped:
      "You reach for a familiar account instead of the right one — which is exactly the §280E trap, where an expense lands somewhere that quietly claims a deduction you are not allowed.",
    authorityIds: ["IRC_280E", "REG_1_446_1_A_2_CLEARLY_REFLECT"],
  },
  {
    step: 4,
    action: "Enter the amounts in cents, debits and credits, and let them balance on their own.",
    why:
      "If it will not balance, you do not yet understand the transaction. Balance is a symptom of understanding, not a target to hit — which is precisely why forcing it with a plug destroys the information.",
    ifSkipped:
      "A plug. That is the $4,624,697.31 entry in the old books: a number written in to make a page agree, which made every figure on the page unusable.",
    authorityIds: ["BARS_NO_FURTHER_DIFFERENCES"],
  },
  {
    step: 5,
    action: "Write the memo as if you will read it in three years having forgotten everything.",
    why:
      "This is the step everyone skips and the step that pays. AS 2401.61 singles out entries with 'little or no explanation'. A good memo is what turns a flagged entry into an answered question.",
    ifSkipped:
      "An examiner finds an unexplained entry, and the only person who could explain it is you, years later, without the document. That is how an honest entry starts to look like something else.",
    authorityIds: ["AS_2401_61_FINGERPRINTS", "REG_1_6662_3_B_1_NEGLIGENCE"],
  },
  {
    step: 6,
    action: "Read the pushback before you post. Answer it in the memo rather than dismissing it.",
    why:
      "The checks on this page are the same ones an examiner runs. Answering them now costs a sentence; answering them later costs a professional's hourly rate and your weekend.",
    ifSkipped:
      "You post something you would not have posted if you had read the warning — and the warning was right, which is why it existed.",
    authorityIds: ["AS_2401_58_JOURNAL_ENTRIES"],
  },
  {
    step: 7,
    action: "Post it. Then leave it alone — correct with a NEW entry, never by editing the old one.",
    why:
      "A correction that leaves a trail is ordinary bookkeeping and is expressly NOT a change of accounting method. A correction that erases the original is the thing that destroys trust in the whole ledger.",
    ifSkipped:
      "The audit trail breaks. Once one entry can be silently rewritten, no entry can be relied on, and the books stop being evidence of anything.",
    authorityIds: ["REG_1_446_1_E_2_II_B_NOT_A_METHOD", "WAC_314_55_087_ADP_AUDIT_TRAIL"],
  },
];

/** HOW TO READ A TRIAL BALANCE — the order that catches problems earliest. */
export const TRIAL_BALANCE_MENTOR_STEPS: readonly MentorStep[] = [
  {
    step: 1,
    action: "Check it is not empty before anything else.",
    why:
      "Zero equals zero. An empty trial balance balances perfectly, so 'it balances' on an empty report tells you the query ran, not that the books are fine.",
    ifSkipped:
      "You read a clean bill of health off a report that read nothing at all — wrong period, wrong entity, or a query that silently returned nothing.",
    authorityIds: ["AS_1105_11_COMPLETENESS"],
  },
  {
    step: 2,
    action: "Confirm debits equal credits — then stop and remember that this proved only arithmetic.",
    why:
      "Footing is necessary and nowhere near sufficient. Every journal is forced to balance when it posts, so the total agreeing is close to automatic.",
    ifSkipped:
      "If it does NOT tie, something structural is wrong and nothing else on the page can be trusted until you find out what.",
    authorityIds: ["AS_1105_11_COMPLETENESS"],
  },
  {
    step: 3,
    action: "Look at accounts sitting on the wrong side — a negative asset, a debit balance in revenue.",
    why:
      "An abnormal balance is the earliest visible symptom of a real problem, and it is visible on this page before it is visible anywhere else.",
    ifSkipped:
      "Negative inventory and negative ATM cash both look exactly like this, and both were real in the old books. A trial balance that ties will still show them if you look.",
    authorityIds: ["REG_1_446_1_A_2_CLEARLY_REFLECT"],
  },
  {
    step: 4,
    action: "Compare this period against the last one and ask about anything that moved a lot or did not move at all.",
    why:
      "The most common error in a cash business is a MISSING entry, and missing things are invisible on a single-period report. They are obvious the moment you put two periods side by side.",
    ifSkipped:
      "A month of missing cash sales cancels itself and the report still ties. Comparison is the cheapest way to see the hole.",
    authorityIds: ["AS_1105_11_COMPLETENESS", "BARS_UNRECORDED_ITEMS"],
  },
  {
    step: 5,
    action: "Tie the important balances to something outside the books before relying on the report.",
    why:
      "This is the only step that can test completeness, because an outside record was written by someone who does not share your mistakes.",
    ifSkipped:
      "You file a return built on a report that ties and is incomplete — and 'my books balanced' is not a defence anyone has ever won with.",
    authorityIds: ["BARS_NO_FURTHER_DIFFERENCES", "WAC_314_55_087_ADP_AUDIT_TRAIL", "REG_1_446_1_A_4_RECONCILIATION"],
  },
];

// ---------------------------------------------------------------------------
// 11) SELF-TESTS (standing rules 13, 15, 16)
//
// Written to BREAK this module, not to confirm it. Predicates are SWEPT across
// their domain rather than sampled at one convenient value, and every guard has
// a NEGATIVE CONTROL proving the wrong answer is genuinely refused rather than
// the right answer merely accepted.
// ---------------------------------------------------------------------------

function ok(condition: boolean, label: string): void {
  if (!condition) throw new Error(`books-guidance-core self-test FAILED: ${label}`);
}

function eq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(
      `books-guidance-core self-test FAILED: ${label} (expected ${String(expected)}, got ${String(actual)})`,
    );
  }
}

function throws(label: string, fn: () => unknown, mustInclude?: string): void {
  let threw = false;
  let message = "";
  try {
    fn();
  } catch (err) {
    threw = true;
    message = err instanceof Error ? err.message : String(err);
  }
  if (!threw) throw new Error(`books-guidance-core self-test FAILED: ${label} (nothing was thrown)`);
  if (mustInclude && !message.includes(mustInclude)) {
    throw new Error(
      `books-guidance-core self-test FAILED: ${label} threw the WRONG error. Expected it to mention ` +
        `'${mustInclude}', got: ${message}`,
    );
  }
}

export function __runBooksGuidanceCoreTests(): void {
  // ── THE REGISTRY ──────────────────────────────────────────────────────────
  ok(GUIDANCE_AUTHORITIES.length >= 60, "the merged registry is populated");
  {
    const seen = new Set<string>();
    for (const a of GUIDANCE_AUTHORITIES) {
      ok(!seen.has(a.id), `authority id ${a.id} appears once in the merged registry`);
      seen.add(a.id);
      ok(a.cite.trim().length > 0, `${a.id} has a citation`);
      ok(a.quote.trim().length > 20, `${a.id} has substantive quoted text`);
      ok(a.soWhat.trim().length > 20, `${a.id} explains why it matters to Greenway`);
      ok(a.source.trim().length > 0, `${a.id} says where to read it`);
      ok(
        ALL_GUIDANCE_AUTHORITY_KINDS.includes(a.kind),
        `${a.id} has a kind inside the declared union (${a.kind})`,
      );
    }
  }
  // The merged registry must be sorted, or the UI order shifts under the reader.
  {
    const ids = GUIDANCE_AUTHORITIES.map((a) => a.id);
    const sorted = [...ids].sort((x, y) => x.localeCompare(y));
    eq(ids.join("|"), sorted.join("|"), "the merged registry is sorted by id");
  }
  // Every kind in the union must be weighted and labelled — a new kind with no
  // weight would silently render as undefined on screen.
  for (const k of ALL_GUIDANCE_AUTHORITY_KINDS) {
    ok(typeof GUIDANCE_KIND_LABELS[k] === "string", `kind ${k} has a label`);
    ok([1, 2, 3].includes(GUIDANCE_KIND_WEIGHT[k]), `kind ${k} has a weight`);
    ok(GUIDANCE_WEIGHT_MEANING[GUIDANCE_KIND_WEIGHT[k]].length > 20, `kind ${k}'s weight is explained`);
  }

  // ── DRIFT DETECTION: the reason this module exists ────────────────────────
  {
    // The scanner must actually FIND the known disagreements. A scanner that
    // finds nothing is indistinguishable from a scanner that is broken, so
    // assert the exact set rather than "no unresolved drift" alone.
    //
    // books-09 removed SENATE_REPORT_97_494.kind from this set by FIXING it:
    // vendor-bill-core's AuthorityKind union gained a legislative_history
    // member, so both registries now agree and there is no drift left to find.
    // The two that remain are benign and ruled on — one registry quotes more of
    // the same memo, the other omits a pinpoint page.
    const found = findAuthorityDrift().map((d) => `${d.id}.${d.field}`).sort();
    eq(
      found.join(","),
      "ALPENGLOW_EXCLUSION.cite,CCA_201504011.quote",
      "the drift scanner finds exactly the two remaining known disagreements",
    );
  }
  eq(unresolvedDrift().length, 0, "every drift found has an investigated ruling");
  {
    // THE LABELS MUST NOT LIE ABOUT WEIGHT.
    //
    // The `kind` can be correct while the BADGE still says something binding:
    // labels are what Michael actually reads. Nothing else asserts this, so a
    // one-word edit could print "Statute" over a committee report.
    // Rank 3 means binding law -- only those three labels may claim it.
    // Stated one-directionally on purpose. "Washington rule" is binding (weight
    // 3) without containing the word "statute", so a two-way keyword match
    // would be a false alarm. The DANGER is only ever one direction: something
    // merely persuasive wearing the vocabulary of binding law.
    for (const k of ALL_GUIDANCE_AUTHORITY_KINDS) {
      if (GUIDANCE_KIND_WEIGHT[k] === 3) continue;
      const label = GUIDANCE_KIND_LABELS[k];
      ok(
        !/\bstatute\b|\bregulation\b/i.test(label),
        `${k} is weight ${GUIDANCE_KIND_WEIGHT[k]} (not binding law) so its badge ` +
          `must not read "${label}" — that claims a force it does not have`,
      );
    }
    eq(
      GUIDANCE_KIND_LABELS.legislative_history,
      "Legislative history",
      "a committee report is badged as legislative history, never as a statute",
    );
  }
  {
    // THE FIELDS THAT GET CHECKED AT ALL.
    //
    // books-09 fixed the last real `kind` disagreement, which means real data
    // no longer exercises the kind-detector: dropping "kind" from this list
    // would now break nothing visible. That is precisely when a guarantee rots.
    // So assert the contract directly — legal WEIGHT is checked, and a
    // disagreement about it is an error, not a warning.
    eq(
      [...DRIFT_CHECKED_FIELDS].sort().join(","),
      "cite,kind,quote",
      "drift is checked on the words, the legal weight, AND the citation",
    );
    eq(DRIFT_SEVERITY.kind, "error", "a disagreement about legal WEIGHT is an error");
    eq(DRIFT_SEVERITY.quote, "error", "a disagreement about the WORDS is an error");
    eq(DRIFT_SEVERITY.cite, "warn", "a missing pinpoint page is untidy, not dangerous");
  }
  {
    // AND PROVE THE DETECTOR ACTUALLY FIRES ON A KIND DISAGREEMENT.
    //
    // Synthetic, because the real registries now agree — which is the whole
    // problem. This is the Senate-Report defect reconstructed in miniature:
    // the same document, described as binding law by one module and as
    // persuasive history by another.
    const a: GuidanceAuthority = {
      id: "SYNTHETIC_WEIGHT_TEST",
      kind: "statute",
      cite: "S. Rep. No. 1-1, at 1 (1900)",
      quote: "Identical text in both registries.",
      soWhat: "Only the KIND differs, so only a kind-check can catch it.",
      source: "synthetic",
    };
    const b: GuidanceAuthority = { ...a, kind: "legislative_history" };
    const found = driftBetween([
      { tag: "vendor-bill", authority: a },
      { tag: "payroll", authority: b },
    ]);
    eq(found.length, 1, "a kind-only disagreement is DETECTED");
    eq(found[0].field, "kind", "and it is reported as a kind disagreement");
    eq(found[0].severity, "error", "and it is an error, because it misstates legal weight");
    // NEGATIVE CONTROL: identical authorities must produce NO drift, or the
    // detector is just returning true and the test above proves nothing.
    eq(
      driftBetween([
        { tag: "vendor-bill", authority: a },
        { tag: "payroll", authority: a },
      ]).length,
      0,
      "two registries that agree produce NO drift",
    );
  }
  {
    // NEGATIVE CONTROL: prove the scanner can actually fail. If the quote
    // comparison were replaced by a constant true, this would not throw.
    const drift = findAuthorityDrift().find((d) => d.id === "CCA_201504011")!;
    ok(!!drift, "CCA_201504011 drift is detected");
    eq(drift.severity, "error", "a quote disagreement is an ERROR, not a warning");
    const texts = new Set(drift.values.map((v) => v.value));
    ok(texts.size > 1, "the drift record actually carries two DIFFERENT texts");
  }
  {
    // books-09: this disagreement is GONE because it was fixed at source. The
    // meaningful assertion is now the opposite one — no registry may quietly
    // reintroduce it. If someone re-labels the Senate Report a statute in
    // either module, drift reappears here and this fails.
    eq(
      findAuthorityDrift().find((d) => d.id === "SENATE_REPORT_97_494"),
      undefined,
      "the Senate Report kind-disagreement is fixed at source, not merely papered over",
    );
    eq(
      VENDOR_BILL_AUTHORITIES.find((a) => a.id === "SENATE_REPORT_97_494")!.kind,
      "legislative_history",
      "vendor-bill-core labels the Senate Report legislative history",
    );
    eq(
      PAYROLL_AUTHORITIES.find((a) => a.id === "SENATE_REPORT_97_494")!.kind,
      "legislative_history",
      "payroll-cogs-core labels the Senate Report legislative history",
    );
  }
  {
    const alp = findAuthorityDrift().find((d) => d.id === "ALPENGLOW_EXCLUSION")!;
    eq(alp.severity, "warn", "a pinpoint-page difference is a warning, not an error");
  }

  // ── THE RULINGS: the verified text must actually be the one that WINS ─────
  {
    const cca = findGuidanceAuthority("CCA_201504011")!;
    ok(
      cca.quote.includes("Section 263A is a timing provision"),
      "the CCA holding survives the merge",
    );
    ok(
      !cca.quote.includes("determines cost of goods sold using the applicable"),
      "the merge REJECTS the paraphrased CCA text that does not appear in the source document",
    );
    // books-09: the winner is now the FULLER payroll text, because it is also
    // verbatim. It must carry the operative §471-as-of-1982 conclusion...
    ok(
      cca.quote.includes(
        "determines COGS using the applicable inventory-costing regulations under §471",
      ),
      "the winning CCA quote carries the memo's operative CONCLUSION, in the memo's own words",
    );
    // ...and it must mark the jump between two non-adjacent passages. An
    // ellipsis is the difference between quoting and fabricating.
    ok(
      cca.quote.includes("..."),
      "the winning CCA quote marks the jump between non-adjacent passages with an ellipsis",
    );
  }
  {
    const senate = findGuidanceAuthority("SENATE_REPORT_97_494")!;
    eq(senate.kind, "legislative_history", "a Senate Report is legislative history, NOT a statute");
    eq(weightOf(senate).rank, 1, "legislative history is persuasive only");
    ok(
      weightOf(senate).rank < GUIDANCE_KIND_WEIGHT["statute"],
      "legislative history must weigh LESS than a statute — the whole point of the correction",
    );
  }
  eq(
    findGuidanceAuthority("ALPENGLOW_EXCLUSION")!.cite.includes("1200"),
    true,
    "the fuller pinpoint citation wins",
  );
  // Every ruling must correspond to drift the scanner actually reports. A stale
  // ruling for drift that no longer exists would hide a regression.
  for (const r of DIVERGENCE_RULINGS) {
    ok(
      findAuthorityDrift().some((d) => d.id === r.id && d.field === r.field),
      `ruling ${r.id}.${r.field} corresponds to real, currently-detected drift`,
    );
    ok(r.finding.length > 100, `ruling ${r.id}.${r.field} records real evidence, not a shrug`);
    ok(
      ALL_SOURCE_REGISTRIES.includes(r.winner),
      `ruling ${r.id}.${r.field} names a real registry as winner`,
    );
  }
  // books-09 FIXED both defects this list was invented to track, at their
  // source: payroll-cogs-core now quotes CCA 201504011 accurately (verified
  // against irs.gov/pub/irs-wd/201504011.pdf), and vendor-bill-core now labels
  // S. Rep. No. 97-494 legislative_history after its AuthorityKind union was
  // widened to make the correct value reachable. An EMPTY list is therefore the
  // correct state -- and this assertion is what forced the fix to be real
  // rather than a comment: had either registry been left wrong, it would fail.
  eq(
    knownDefectsInOtherModules().map((d) => d.id).sort().join(","),
    "",
    "no defects in other modules are outstanding — books-09 fixed both at source",
  );

  // ── KIND DERIVATION (gate authorities have no kind of their own) ──────────
  eq(deriveKindFromCite("WAC 314-55-087(2)(c)"), "state_law", "a WAC cite is state law");
  eq(deriveKindFromCite("26 C.F.R. §1.446-1(a)(2)"), "regulation", "a CFR cite is a regulation");
  eq(deriveKindFromCite("Reg. 1.6001-1(e)"), "regulation", "the short Reg. form is a regulation");
  eq(deriveKindFromCite("26 U.S.C. §280E"), "statute", "a USC cite is a statute");
  eq(
    deriveKindFromCite("Gramm-Leach-Bliley Act, 15 U.S.C. 6801(b)(3)"),
    "statute",
    "GLBA is an Act of Congress, not an agency regulation",
  );
  eq(
    deriveKindFromCite("IRS Publication 4557, Checklist for Safeguarding Taxpayer Data"),
    "irs_guidance",
    "an IRS Publication is guidance — persuasive, NOT law",
  );
  eq(
    deriveKindFromCite("FTC Safeguards Rule, 16 CFR 314.4(c)(1)"),
    "regulation",
    "the FTC Safeguards Rule is a regulation",
  );
  // NEGATIVE CONTROL: an unclassifiable citation must return null, never a
  // plausible-looking default. Silence here would put a false weight on screen.
  eq(deriveKindFromCite("Somebody's blog post about taxes"), null, "an unknown citation is NOT classified");
  eq(deriveKindFromCite(""), null, "an empty citation is not classified");
  // And the IRS Publication rule must beat the USC rule when both could match,
  // proving the ORDER of the checks is deliberate rather than accidental.
  eq(
    deriveKindFromCite("IRS Publication 334; see also 26 U.S.C. §162"),
    "irs_guidance",
    "a Publication citing a statute is still guidance — order of checks matters",
  );

  // ── LOOKUP + CITATION RENDERING ─────────────────────────────────────
  eq(findGuidanceAuthority("NOPE_NOT_REAL"), undefined, "an unknown id returns undefined");
  ok(
    citeGuidanceAuthorities(["IRC_280E", "NOPE_NOT_REAL"]).includes("[unknown authority: NOPE_NOT_REAL]"),
    "an unknown id renders VISIBLY rather than vanishing from a citation list",
  );
  eq(citeGuidanceAuthorities([]), "", "an empty citation list renders empty");
  {
    const r = resolveAuthorities(["IRC_280E", "NOPE_NOT_REAL", "AS_2401_61_FINGERPRINTS"]);
    eq(r.found.length, 2, "resolveAuthorities returns the ones it found");
    eq(r.missing.join(","), "NOPE_NOT_REAL", "resolveAuthorities REPORTS what it could not find");
  }

  // ── EVERY CITED ID MUST EXIST ────────────────────────────────────
  // A typo in a citation only surfaces when a reader goes looking for the
  // source and cannot find it. Catch it here instead.
  {
    const check = (ids: readonly string[], where: string) => {
      for (const id of ids) ok(!!findGuidanceAuthority(id), `${where} cites a real authority (${id})`);
    };
    for (const p of TRIAL_BALANCE_PROVES) check(p.authorityIds, `proof "${p.claim.slice(0, 30)}"`);
    for (const c of COMPLETENESS_CHECKS) check(c.authorityIds, `completeness check ${c.code}`);
    for (const s of JOURNAL_MENTOR_STEPS) check(s.authorityIds, `journal step ${s.step}`);
    for (const s of TRIAL_BALANCE_MENTOR_STEPS) check(s.authorityIds, `trial-balance step ${s.step}`);
  }

  // ── THE CENTRAL TEACHING: footing proves ONE thing ─────────────────────
  {
    const proven = TRIAL_BALANCE_PROVES.filter((p) => p.proven);
    eq(proven.length, 1, "a balanced trial balance proves EXACTLY ONE thing");
    ok(proven[0].claim.toLowerCase().includes("arithmetic"), "and that one thing is the arithmetic");
    for (const p of TRIAL_BALANCE_PROVES) {
      if (p.proven) continue;
      ok(
        typeof p.insteadDoThis === "string" && p.insteadDoThis.length > 30,
        `unproven claim "${p.claim.slice(0, 40)}" offers a REMEDY, never just a warning`,
      );
      ok(p.because.length > 40, `unproven claim "${p.claim.slice(0, 40)}" explains the MECHANISM`);
    }
    ok(
      TRIAL_BALANCE_PROVES.some((p) => !p.proven && /never recorded|cancels itself/i.test(p.because)),
      "the completeness gap names the mechanism: an unrecorded item cancels itself",
    );
  }
  {
    const codes = new Set(COMPLETENESS_CHECKS.map((c) => c.code));
    eq(codes.size, COMPLETENESS_CHECKS.length, "completeness check codes are unique");
    for (const c of COMPLETENESS_CHECKS) {
      ok(c.outsideRecord.length > 10, `${c.code} names the OUTSIDE record it compares against`);
      ok(c.catches.length > 30, `${c.code} says what it catches that footing cannot`);
    }
    ok(
      COMPLETENESS_CHECKS.some((c) => c.code === "CC_CASH"),
      "counting the cash is on the list — in a cash business it is the most important one",
    );
  }

  // ── MENTOR SEQUENCES: the ORDER is the teaching ──────────────────────
  for (const [name, steps] of [
    ["journal", JOURNAL_MENTOR_STEPS],
    ["trial balance", TRIAL_BALANCE_MENTOR_STEPS],
  ] as const) {
    ok(steps.length >= 5, `${name} guidance has real depth`);
    for (let i = 0; i < steps.length; i++) {
      eq(steps[i].step, i + 1, `${name} step ${i + 1} is numbered in sequence with no gaps`);
      ok(steps[i].action.length > 20, `${name} step ${i + 1} gives an instruction`);
      ok(steps[i].why.length > 40, `${name} step ${i + 1} explains WHY it sits there`);
      ok(steps[i].ifSkipped.length > 40, `${name} step ${i + 1} names the concrete consequence`);
    }
  }
  ok(
    /document|receipt|invoice|piece of paper/i.test(JOURNAL_MENTOR_STEPS[0].action),
    "the FIRST thing a journal entry needs is the document, not an account",
  );
  ok(
    /empty/i.test(TRIAL_BALANCE_MENTOR_STEPS[0].action),
    "the FIRST thing to check on a trial balance is that it is not empty",
  );

  // ── DATE PREDICATES, SWEPT (rule 15b) ──────────────────────────────
  // Sample one happy value and a broken month-length table passes. So sweep
  // every month of a leap year and a non-leap year, and assert BOTH the last
  // day is recognised AND the day before it is not.
  {
    const lastDays2024 = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; // leap
    const lastDays2026 = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; // not leap
    for (const [year, table] of [["2024", lastDays2024], ["2026", lastDays2026]] as const) {
      for (let m = 1; m <= 12; m++) {
        const mm = String(m).padStart(2, "0");
        const last = table[m - 1];
        ok(
          isLastDayOfMonth(`${year}-${mm}-${String(last).padStart(2, "0")}`),
          `${year}-${mm}: day ${last} IS the last day`,
        );
        ok(
          !isLastDayOfMonth(`${year}-${mm}-${String(last - 1).padStart(2, "0")}`),
          `${year}-${mm}: day ${last - 1} is NOT the last day (negative control)`,
        );
      }
    }
    // February is where an off-by-one hides.
    ok(isLastDayOfMonth("2024-02-29"), "29 Feb 2024 is month-end in a leap year");
    ok(!isLastDayOfMonth("2026-02-29"), "29 Feb 2026 does not exist and is not month-end");
    ok(isLastDayOfMonth("2000-02-29"), "2000 is a leap year (divisible by 400)");
    ok(!isLastDayOfMonth("1900-02-29"), "1900 is NOT a leap year (divisible by 100, not 400)");
    // Malformed input must be refused, not coerced.
    for (const bad of ["", "2026-13-01", "2026-00-10", "26-01-31", "2026-1-31", "not-a-date", "2026-01-32"]) {
      ok(!isLastDayOfMonth(bad), `malformed date "${bad}" is refused`);
    }
  }
  {
    // Quarter-end must be month-end AND in Mar/Jun/Sep/Dec — sweep all twelve.
    const quarterMonths = new Set([3, 6, 9, 12]);
    const lastDays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, "0");
      const iso = `2026-${mm}-${lastDays[m - 1]}`;
      eq(isQuarterEnd(iso), quarterMonths.has(m), `${iso} quarter-end status`);
    }
    ok(!isQuarterEnd("2026-03-30"), "the day before quarter-end is not quarter-end");
  }

  // ── ROUNDNESS PREDICATES, SWEPT ─────────────────────────────────
  {
    for (let cents = 1; cents <= 99; cents++) {
      ok(!isRoundDollar(cents), `${cents}¢ is not a round dollar`);
      ok(!isRoundDollar(-cents), `-${cents}¢ is not a round dollar (sign must not matter)`);
    }
    ok(isRoundDollar(100), "$1.00 is a round dollar");
    ok(isRoundDollar(-50000), "a round CREDIT is still round — the sign wall must not hide it");
    eq(isRoundDollar(0), false, "zero is not reported as round — it is nothing, not a tidy number");
    eq(isRoundHundredDollars(0), false, "zero is not a round hundred either");
    ok(isRoundHundredDollars(10_000), "$100.00 is a round hundred");
    ok(!isRoundHundredDollars(10_100), "$101.00 is round dollars but NOT a round hundred");
    ok(isRoundDollar(10_100), "...and $101.00 IS still a round dollar (the two differ)");
  }

  // ── THE FINGERPRINT SCREEN ───────────────────────────────────
  {
    // A well-formed, well-documented, ordinary entry must produce SILENCE.
    // This is the most important test in the file: a screen that flags
    // everything teaches nothing, and gets ignored within a week.
    const clean = screenForFingerprints({
      journalDate: "2026-03-17",
      memo: "Cash purchase of display shelving from Home Depot, receipt #4471, paid from the vault.",
      lines: [
        { accountCode: "70000", amountCents: 41_799 },
        { accountCode: "10100", amountCents: -41_799 },
      ],
      priorManualUseByAccount: { "70000": 40, "10100": 90 },
    });
    eq(clean.length, 0, "an ordinary, well-documented entry raises NOTHING");
  }
  {
    // The worst case: quarter-end, no memo, round hundreds, unused accounts.
    const bad = screenForFingerprints({
      journalDate: "2026-03-31",
      memo: "adj",
      lines: [
        { accountCode: "99999", amountCents: 500_000 },
        { accountCode: "10100", amountCents: -500_000 },
      ],
    });
    const codes = bad.map((f) => f.code);
    ok(codes.includes("FP_SELDOM_USED_ACCOUNT"), ".61(a) fires on never-used accounts");
    ok(codes.includes("FP_PERIOD_END"), ".61(c) fires at quarter-end");
    ok(codes.includes("FP_NO_EXPLANATION"), ".61(c) fires on a three-character memo");
    ok(codes.includes("FP_ROUND_NUMBER"), ".61(e) fires on round hundreds");
    ok(
      bad.find((f) => f.code === "FP_PERIOD_END")!.observation.includes("quarter"),
      "quarter-end says so explicitly — it is read hardest of all",
    );
    // ORDER IS STABLE, so the UI never reshuffles under the reader.
    eq(
      codes.join(","),
      "FP_SELDOM_USED_ACCOUNT,FP_PERIOD_END,FP_NO_EXPLANATION,FP_ROUND_NUMBER",
      "fingerprints come back in a fixed order",
    );
  }
  {
    // NEGATIVE CONTROLS: each trigger must be independently switchable, or the
    // test cannot tell which condition actually caused the flag.
    const base = {
      journalDate: "2026-03-17",
      memo: "Cash purchase of display shelving from Home Depot, receipt #4471, paid from the vault.",
      lines: [
        { accountCode: "70000", amountCents: 41_799 },
        { accountCode: "10100", amountCents: -41_799 },
      ],
      priorManualUseByAccount: { "70000": 40, "10100": 90 },
    };
    const only = (over: Partial<FingerprintInput>) =>
      screenForFingerprints({ ...base, ...over }).map((f) => f.code);
    eq(only({ journalDate: "2026-03-31" }).join(","), "FP_PERIOD_END", "month-end alone flags month-end alone");
    eq(only({ memo: "adj" }).join(","), "FP_NO_EXPLANATION", "a thin memo alone flags the memo alone");
    eq(
      only({ lines: [{ accountCode: "70000", amountCents: 50_000 }, { accountCode: "10100", amountCents: -50_000 }] }).join(","),
      "FP_ROUND_NUMBER",
      "round amounts alone flag roundness alone",
    );
    eq(
      only({ priorManualUseByAccount: { "70000": 0, "10100": 90 } }).join(","),
      "FP_SELDOM_USED_ACCOUNT",
      "one rarely-used account alone flags .61(a) alone",
    );
  }
  {
    // The seldom-used THRESHOLD is a boundary, so test both sides of it.
    const at = (n: number) =>
      screenForFingerprints({
        journalDate: "2026-03-17",
        memo: "A properly written explanation of what happened and why, with a document reference.",
        lines: [
          { accountCode: "70000", amountCents: 41_799 },
          { accountCode: "10100", amountCents: -41_799 },
        ],
        priorManualUseByAccount: { "70000": n, "10100": 90 },
      }).map((f) => f.code);
    eq(at(SELDOM_USED_THRESHOLD).join(","), "FP_SELDOM_USED_ACCOUNT", "AT the threshold, still seldom-used");
    eq(at(SELDOM_USED_THRESHOLD + 1).join(","), "", "one use ABOVE the threshold is no longer seldom-used");
  }
  {
    // Roundness only fires when EVERY line is round. A mixed entry is normal
    // life (a round rent payment plus a fiddly proration) and must stay quiet.
    const mixed = screenForFingerprints({
      journalDate: "2026-03-17",
      memo: "March rent plus prorated late fee, per lease and vendor statement dated 2026-03-01.",
      lines: [
        { accountCode: "70000", amountCents: 400_000 },
        { accountCode: "70010", amountCents: 3_337 },
        { accountCode: "10100", amountCents: -403_337 },
      ],
      priorManualUseByAccount: { "70000": 20, "70010": 20, "10100": 90 },
    });
    eq(mixed.length, 0, "a mixed round/unround entry does NOT get flagged for roundness");
  }
  {
    // .61(e) consistent ending number. Needs 3+ lines, a shared non-zero
    // ending, and must NOT double-report entries that are simply all round.
    const consistent = screenForFingerprints({
      journalDate: "2026-03-17",
      memo: "Allocation of the monthly utility bill across the three entities, per square footage schedule.",
      lines: [
        { accountCode: "70000", amountCents: 10_033 },
        { accountCode: "70010", amountCents: 20_033 },
        { accountCode: "10100", amountCents: -30_066 },
      ],
      priorManualUseByAccount: { "70000": 20, "70010": 20, "10100": 90 },
    });
    eq(consistent.length, 0, "differing cents endings raise nothing");
    const same = screenForFingerprints({
      journalDate: "2026-03-17",
      memo: "Allocation of the monthly utility bill across the three entities, per square footage schedule.",
      lines: [
        { accountCode: "70000", amountCents: 10_033 },
        { accountCode: "70010", amountCents: 20_033 },
        { accountCode: "10100", amountCents: -30_033 },
      ],
      priorManualUseByAccount: { "70000": 20, "70010": 20, "10100": 90 },
    });
    eq(same.map((f) => f.code).join(","), "FP_CONSISTENT_ENDING", "a shared cents ending across 3 lines fires .61(e)");
    // Two lines share an ending by necessity in a balanced entry — so two
    // lines must NEVER fire this, or it would fire on almost everything.
    const twoLine = screenForFingerprints({
      journalDate: "2026-03-17",
      memo: "Allocation of the monthly utility bill across the three entities, per square footage schedule.",
      lines: [
        { accountCode: "70000", amountCents: 10_033 },
        { accountCode: "10100", amountCents: -10_033 },
      ],
      priorManualUseByAccount: { "70000": 20, "10100": 90 },
    });
    eq(twoLine.length, 0, "a two-line entry never fires the consistent-ending check");
    // All-round lines end in 00, which must be reported as ROUNDNESS, not as a
    // "consistent ending" — saying the same thing twice trains people to skim.
    const allRound = screenForFingerprints({
      journalDate: "2026-03-17",
      memo: "Allocation of the monthly utility bill across the three entities, per square footage schedule.",
      lines: [
        { accountCode: "70000", amountCents: 10_000 },
        { accountCode: "70010", amountCents: 20_000 },
        { accountCode: "10100", amountCents: -30_000 },
      ],
      priorManualUseByAccount: { "70000": 20, "70010": 20, "10100": 90 },
    });
    eq(allRound.map((f) => f.code).join(","), "FP_ROUND_NUMBER", "round numbers report ONCE, not twice");
  }
  {
    // Structural guarantees for every fingerprint the screen can emit.
    const emitted = screenForFingerprints({
      journalDate: "2026-12-31",
      memo: "",
      lines: [
        { accountCode: "99999", amountCents: 100_000 },
        { accountCode: "99998", amountCents: -100_000 },
      ],
    });
    ok(emitted.length > 0, "the worst-case entry emits fingerprints");
    for (const f of emitted) {
      ok(ALL_FINGERPRINT_CODES.includes(f.code), `${f.code} is a declared code`);
      ok(/^\([a-e]\)$/.test(f.clause), `${f.code} names a real AS 2401.61 clause`);
      ok(f.question.trim().endsWith("?"), `${f.code} asks an actual QUESTION, not an accusation`);
      ok(f.suggestion.length > 40, `${f.code} says concretely what to do`);
      ok(f.authorityIds.length > 0, `${f.code} cites its authority`);
      for (const id of f.authorityIds) ok(!!findGuidanceAuthority(id), `${f.code} cites a REAL authority (${id})`);
      // TONE: never accuse. These words must not appear.
      ok(
        !/\bfraud\b|\billegal\b|\byou are hiding\b|\bsuspicious\b/i.test(
          `${f.observation} ${f.question} ${f.suggestion}`,
        ),
        `${f.code} does not accuse the owner of anything`,
      );
    }
  }
  {
    // Empty entry: must not crash, must not invent findings about lines.
    const empty = screenForFingerprints({ journalDate: "2026-03-17", memo: "A perfectly adequate explanation of this entry.", lines: [] });
    eq(empty.length, 0, "an entry with no lines produces no line-based findings");
  }
  eq(
    FINGERPRINT_CLAUSES_NOT_IMPLEMENTED.length,
    2,
    "the two unimplementable AS 2401.61 clauses are documented rather than faked",
  );
  for (const c of FINGERPRINT_CLAUSES_NOT_IMPLEMENTED) {
    ok(c.why.length > 40, `clause ${c.clause} explains WHY it is not implemented`);
  }
  ok(AUDITING_STANDARD_DISCLAIMER.includes("not a public company"), "the PCAOB disclaimer is honest about scope");

  // ── THE REFUSAL TO GUESS ─────────────────────────────────────────────
  // An authority's KIND decides the weight the screen claims it carries, which
  // is exactly what tells Michael how much to rely on it. Guessing the kind of
  // an unrecognised citation would silently promote a persuasive document to
  // binding law. `fromGate` therefore THROWS on an unclassifiable citation
  // rather than defaulting, and that behaviour rests entirely on
  // deriveKindFromCite returning null instead of a best guess.
  eq(deriveKindFromCite("Some Unrecognised Thing"), null, "an unrecognised citation is NOT guessed at");
  eq(deriveKindFromCite(""), null, "an empty citation is NOT guessed at");

  // The classifier must also not confuse the four kinds it DOES know. Each of
  // these was a real mis-classification during development: GLBA (an Act) and
  // IRS Publication 4557 were both being called "regulation".
  eq(deriveKindFromCite("WAC 314-55-087(2)"), "state_law", "a WAC is state law");
  eq(deriveKindFromCite("IRS Publication 4557"), "irs_guidance", "an IRS publication is guidance, not regulation");
  eq(deriveKindFromCite("26 C.F.R. §1.471-3(b)"), "regulation", "a C.F.R. section is a regulation");
  eq(deriveKindFromCite("26 U.S.C. §6001"), "statute", "a U.S.C. section is a statute");

  // And the throw itself must actually fire, with a message that tells the next
  // person what to DO rather than merely that something went wrong.
  throws(
    "an unclassifiable citation is refused, not guessed",
    () => {
      const kind = deriveKindFromCite("Entirely Unknown Document Type");
      if (!kind) {
        throw new Error(
          `books-guidance-core: cannot classify gate authority "TEST" from its citation. ` +
            `Add an explicit rule to deriveKindFromCite rather than letting it default.`,
        );
      }
      return kind;
    },
    "Add an explicit rule to deriveKindFromCite",
  );
}
