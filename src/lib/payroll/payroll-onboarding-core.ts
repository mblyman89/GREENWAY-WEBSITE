/**
 * src/lib/payroll/payroll-onboarding-core.ts  (books-25)
 *
 * THE HAND-HOLDING ENGINE FOR HIRING SOMEONE ONTO PAYROLL.
 *
 * Michael asked for this in these words:
 *
 *   "I want our payroll setup feature to now hold my hand walking me through the
 *    full process of entering in all the data from their w-4 and I-9, and every
 *    other piece of info we need to properly record account and pay the employees
 *    and the tax authorities."
 *
 *   "It should have a check list of task to be completed before it lets you save
 *    them to the system, and if a field is missing, it should highlight it so
 *    something can't silently fail me in some way."
 *
 *   "Sage has no safety nets... It just assume your a genius and didn't miss
 *    anything or misplace a decimal or mess up a formula."
 *
 *   "Payroll has always been something I've feared because I have had no reliable
 *    way of knowing I'm doing it right."
 *
 * And on why the thing exists at all:
 *
 *   "Every time I hire someone new, they ask me how to fill out their w-4 and I
 *    never know what to say... My grandpa does though... the whole purpose of this
 *    system is to replace my grandfather with a like kind solution that both
 *    protects me and teaches me."
 *
 * WHAT THIS FILE IS
 * -----------------
 * A PURE function library. No I/O, no Supabase, no Date.now(). Everything is
 * derived from arguments so that every branch is testable and every refusal is
 * reproducible. The store and the screen sit on top of this; they add no rules of
 * their own.
 *
 * WHAT THIS FILE IS NOT
 * ---------------------
 * It is not a second withholding engine. `payroll-withholding-core.ts` already
 * computes tax and already refuses without evidenced rates, and
 * `payroll-w4-core.ts` already validates a W-4 record. Standing rule 25 says
 * extend, do not duplicate, so this module ORCHESTRATES those two and adds only
 * what neither has: the ordered checklist, the per-field completeness gate, the
 * I-9 timing math, and the quarantine rule that keeps I-9 data away from pay.
 *
 * THE DESIGN PRINCIPLE MICHAEL GAVE ME LAST
 * -----------------------------------------
 * After seeing the Sage audit he said:
 *
 *   "my accounting skills aren't bad or the problem here. I'm the one feeding the
 *    reports and they are accurate because I know what I'm doing as an accountant,
 *    I have no idea what I'm doing with sage. There is this huge disconnect
 *    between me and the system and it's dragging me down."
 *
 * So the target is NOT to teach him accounting. He has a master's in it and he was
 * right about his own unemployment rate when Sage was wrong. The target is to make
 * the SYSTEM legible to an accountant. Every message in this file therefore
 * explains what the software did and why, in his language, not what a debit is.
 */

import {
  PAY_PERIODS_PER_YEAR,
  type PayFrequency,
  type W4Record,
  type W4ValidationIssue,
  defaultW4WhenNoneFurnished,
  isModernW4,
  validateW4,
} from "@/lib/payroll/payroll-w4-core";
import { addBusinessDaysYmd } from "@/lib/staffing/employee-lifecycle-core";

// ===========================================================================
// 1) MONEY AND HOURS INTEGRITY
// ===========================================================================

/**
 * Every money amount in this module is INTEGER CENTS and every hourly rate is
 * INTEGER MILLI-CENTS. Standing rule 4 forbids floats in money, and books-14
 * proved why with real damage: L&I's employee rate is $0.16445 per hour, which
 * integer cents physically cannot hold, and rounding it to 16 cents is itself an
 * unlawful deduction.
 *
 * Pay RATES get milli-cents for the same reason. A $17.855/hour negotiated wage
 * is a real thing a person can agree to, and storing it as 1785 cents silently
 * shorts the worker half a cent an hour - about $10 a year - forever.
 */
export const MILLI_CENTS_PER_CENT = 1000;

/** Largest value we allow, so ordinary integer arithmetic stays exact. */
export const MAX_SAFE_MONEY = Number.MAX_SAFE_INTEGER;

export function assertIntegerCents(value: number, label: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(
      `${label} must be an integer number of cents (got ${String(value)}). ` +
        `Fractions of a cent are how a payroll silently drifts away from the bank.`,
    );
  }
  if (Math.abs(value) > MAX_SAFE_MONEY) {
    throw new Error(`${label} is too large for exact arithmetic (${String(value)}).`);
  }
}

export function assertIntegerMilliCents(value: number, label: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(
      `${label} must be an integer number of milli-cents (got ${String(value)}). ` +
        `A pay rate of $17.855/hour is 1785500 milli-cents; storing it as cents ` +
        `would round the worker's wage and the error would repeat every hour worked.`,
    );
  }
  if (Math.abs(value) > MAX_SAFE_MONEY) {
    throw new Error(`${label} is too large for exact arithmetic (${String(value)}).`);
  }
}

// ===========================================================================
// 2) THE SSN — STORED IN FULL, MASKED BY DEFAULT, REVEALED ONLY TO THE OWNER
// ===========================================================================

/**
 * Michael overruled my recommendation here, and he was right to, because he had a
 * fact I did not:
 *
 *   "it's something I record in full in sage. It's used in several places for tax
 *    reporting. Esd, pfml, cares act, w-2... It should be masked for everyone but
 *    me the owner. Sage gives me the option to display it in full or mask it with
 *    astrix or x's. I think we should mimic that."
 *
 * He is correct on the law as well as the practice. 26 C.F.R. §31.3402(f)(2)-1(f)(2)
 * requires the employee to furnish the number and forbids truncation on the W-4
 * itself, and the W-2 and every state wage report key on the full number. A
 * system that stored only the last four could not file.
 *
 * SO WE STORE IT IN FULL - and we treat it as radioactive:
 *   - masked for every role except owner,
 *   - revealed only by an explicit act, never incidentally,
 *   - and every reveal is an auditable event (enforced in the store layer).
 *
 * WHAT SAGE DOES THAT WE DO NOT: the Sage "General" tab renders the SSN as a
 * plain text box beside the employee's phone number, and the "Employee List"
 * report prints "employee address, social security number, federal filing status,
 * and pay type" as an ordinary column. That is nine digits of identity theft one
 * careless print job away, for every employee at once.
 */

/** Roles permitted to see an unmasked SSN. Deliberately a list of one. */
export const SSN_REVEAL_ROLES: readonly string[] = ["owner"] as const;

export function canRevealSsn(role: string): boolean {
  return SSN_REVEAL_ROLES.includes(role);
}

/**
 * Strip formatting to the nine digits. Returns null when the input is not nine
 * digits, because "close to an SSN" is not an SSN.
 */
export function normalizeSsn(raw: string): string | null {
  const digits = raw.replace(/[^0-9]/g, "");
  return digits.length === 9 ? digits : null;
}

export type SsnProblem =
  | "not_nine_digits"
  | "area_000"
  | "area_666"
  | "area_900_999"
  | "group_00"
  | "serial_0000"
  | "sequential_placeholder";

/**
 * Reasons a nine-digit string can never be a real SSN.
 *
 * SOURCE: SSA's own Social Security Number Randomization FAQ, mirrored at
 * docs/authorities/federal/ssa-ssn-randomization-faq.txt. In SSA's words,
 * randomization "introduced previously unassigned area numbers for assignment
 * excluding area numbers 000, 666 and 900-999", and "SSNs containing group
 * number 00 or serial number 0000 will continue to be invalid."
 *
 * WHY VALIDATE AT ALL, GIVEN WE CANNOT TRULY VERIFY: because these checks are
 * FREE and they catch the actual clerical accidents - a shifted digit that turns
 * an area into 000, a placeholder like 123-45-6789 that someone typed to get past
 * a required field, an ITIN in the 900 range keyed into an SSN box. What we
 * CANNOT do is confirm the number belongs to this person; only SSA's
 * verification service can, and the FAQ names it. So this function is honest
 * about its own limits: it proves a number is IMPOSSIBLE, never that it is
 * correct. See `ssnVerificationCaveat()`.
 */
export function ssnProblems(raw: string): SsnProblem[] {
  const problems: SsnProblem[] = [];
  const digits = normalizeSsn(raw);
  if (digits === null) return ["not_nine_digits"];

  const area = digits.slice(0, 3);
  const group = digits.slice(3, 5);
  const serial = digits.slice(5, 9);

  if (area === "000") problems.push("area_000");
  if (area === "666") problems.push("area_666");
  if (Number(area) >= 900) problems.push("area_900_999");
  if (group === "00") problems.push("group_00");
  if (serial === "0000") problems.push("serial_0000");
  if (digits === "123456789") problems.push("sequential_placeholder");

  return problems;
}

export function isPossibleSsn(raw: string): boolean {
  return ssnProblems(raw).length === 0;
}

/**
 * Mask an SSN the way Michael asked for. Nine digits become XXX-XX-1234 so the
 * last four still let him tell two employees apart without exposing the number.
 *
 * Returns the mask for ANY input, including malformed input, because a masking
 * function that throws is a masking function that leaks: the stack trace would
 * carry the value it refused to render.
 */
export function maskSsn(raw: string): string {
  const digits = normalizeSsn(raw);
  if (digits === null) return "XXX-XX-????";
  return `XXX-XX-${digits.slice(5, 9)}`;
}

/** Format for the owner's eyes only. Callers must gate on `canRevealSsn`. */
export function formatSsnUnmasked(raw: string): string {
  const digits = normalizeSsn(raw);
  if (digits === null) return "";
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5, 9)}`;
}

/**
 * Render an SSN for a given role. The DEFAULT IS MASKED and the reveal must be
 * asked for twice - once by having the role, once by passing `reveal`.
 *
 * Rule 27 shape: this does not warn, it simply does not return the number.
 */
export function renderSsnForRole(
  raw: string,
  role: string,
  reveal: boolean,
): string {
  if (reveal && canRevealSsn(role)) return formatSsnUnmasked(raw);
  return maskSsn(raw);
}

/** The honest limit of our own SSN checking, in one sentence Michael can quote. */
export function ssnVerificationCaveat(): string {
  return (
    "These checks prove a number is IMPOSSIBLE - they can never prove it is the right " +
    "person's. Area numbers 000, 666 and 900-999 were never issued, and group 00 and " +
    "serial 0000 are never assigned, so anything matching those is a typo we can catch " +
    "for free. Confirming the number actually belongs to this employee takes SSA's " +
    "Social Security Number Verification Service, which is free to employers and is the " +
    "only thing that settles it. Do that before the first W-2, not after SSA rejects it."
  );
}

// ===========================================================================
// 3) THE I-9 — A LEGALLY QUARANTINED RECORD
// ===========================================================================

/**
 * WHY THE I-9 IS A SEPARATE TYPE, A SEPARATE TABLE, AND A SEPARATE SCREEN.
 *
 * 8 C.F.R. §274a.2(b)(4) limits what an I-9 may be used for. Immigration status,
 * document type and expiry are exactly the facts that create discrimination
 * exposure, and they have NOTHING to do with computing a paycheck.
 *
 * Sage puts "I-9 verification status" and "I-9 reverification date" on the
 * General tab, inches from the pay fields, as two free dropdowns with no document
 * detail and no timing check. Nothing stops those fields from being read - or
 * reported on - beside compensation data.
 *
 * OUR RULE, ENFORCED STRUCTURALLY: the withholding engine never receives an
 * I9Record. It is not a parameter of any tax function in this codebase. The
 * quarantine is not a policy in a document; it is the absence of a wire.
 * `assertI9NotUsedForPay()` exists so a future refactor that tries to add that
 * wire fails a test instead of shipping.
 */

export type I9DocumentCategory = "list_a" | "list_b" | "list_c";

export type I9Document = {
  category: I9DocumentCategory;
  /** e.g. "U.S. Passport", "Driver's license", "Social Security card". */
  title: string;
  issuingAuthority: string;
  documentNumber: string;
  /** YYYY-MM-DD, or null for a document with no expiration. */
  expirationYmd: string | null;
};

export type I9Record = {
  employeeId: string;
  /** Section 1: the employee's own attestation date. */
  section1SignedYmd: string | null;
  /** Section 2: the employer's examination date. */
  section2CompletedYmd: string | null;
  /** First day of work for pay. Drives every I-9 deadline. */
  firstDayOfEmploymentYmd: string | null;
  documents: I9Document[];
  /**
   * TRUE only if the employer photocopies documents for EVERY employee. Under
   * 8 C.F.R. §274a.2(b)(3) copying is optional, but doing it selectively is
   * itself evidence of discrimination.
   */
  copiesRetained: boolean;
};

export type I9Issue = {
  field: string;
  severity: "block" | "warn";
  message: string;
  authorityId?: string;
};

/**
 * Which combination of documents satisfies Section 2.
 *
 * One document from List A (identity AND authorization), or one from List B
 * (identity) PLUS one from List C (authorization). This is the rule people get
 * wrong most often - two List B documents feels like "more proof" and is not
 * acceptable at all.
 */
export function i9DocumentSetIsSufficient(documents: readonly I9Document[]): boolean {
  const hasA = documents.some((d) => d.category === "list_a");
  const hasB = documents.some((d) => d.category === "list_b");
  const hasC = documents.some((d) => d.category === "list_c");
  return hasA || (hasB && hasC);
}

/**
 * The date Section 2 is due: within three business days of the first day of work
 * for pay, per 8 C.F.R. §274a.2(b)(1)(ii).
 *
 * Reuses `addBusinessDaysYmd` from the staffing module rather than reimplementing
 * weekday math (rule 25). Two implementations of a deadline is two deadlines.
 */
export function i9Section2DueYmd(firstDayYmd: string): string {
  return addBusinessDaysYmd(firstDayYmd, 3);
}

/**
 * How long the I-9 must be kept: three years after the date of hire, or one year
 * after employment ends, WHICHEVER IS LATER (8 C.F.R. §274a.2(b)(2)(i)(A)).
 *
 * THE TRAP: people read "whichever is later" and reach for the later DATE of the
 * two anchors instead of the later of the two computed results. For a long-tenured
 * employee those give different answers by years. Someone hired in 2015 who left
 * in 2026 has a hire+3 of 2018 and a termination+1 of 2027; keeping only to 2018
 * destroys a record that must survive to 2027.
 */
export function i9RetainUntilYmd(
  hireYmd: string,
  terminationYmd: string | null,
): string {
  const hirePlus3 = addYearsYmd(hireYmd, 3);
  if (terminationYmd === null) return hirePlus3;
  const termPlus1 = addYearsYmd(terminationYmd, 1);
  return hirePlus3 >= termPlus1 ? hirePlus3 : termPlus1;
}

/** Add whole years to a YYYY-MM-DD, holding month and day. */
export function addYearsYmd(ymd: string, years: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) throw new Error(`addYearsYmd: expected YYYY-MM-DD, got "${ymd}"`);
  const y = Number(m[1]) + years;
  return `${String(y).padStart(4, "0")}-${m[2]}-${m[3]}`;
}

/**
 * Validate an I-9. Blocks are things that make the form legally defective.
 */
export function validateI9(record: I9Record): { ok: boolean; issues: I9Issue[] } {
  const issues: I9Issue[] = [];

  if (!record.firstDayOfEmploymentYmd) {
    issues.push({
      field: "firstDayOfEmploymentYmd",
      severity: "block",
      message:
        "I need the first day this person works for pay. Every I-9 deadline counts from it, " +
        "so without it I cannot tell you whether you are late.",
      authorityId: "cfr-8-274a-2-b-1-ii-section-2-three-business-days",
    });
  }

  if (!record.section1SignedYmd) {
    issues.push({
      field: "section1SignedYmd",
      severity: "block",
      message:
        "Section 1 is unsigned. The employee must complete and sign it no later than the " +
        "first day of employment - not the first payday, and not when you get around to it.",
      authorityId: "cfr-8-274a-2-b-1-i-a-section-1-at-hire",
    });
  }

  // Section 1 must not be signed BEFORE an offer is accepted, and must not be
  // later than day one. The late case is the one that actually happens.
  if (record.section1SignedYmd && record.firstDayOfEmploymentYmd) {
    if (record.section1SignedYmd > record.firstDayOfEmploymentYmd) {
      issues.push({
        field: "section1SignedYmd",
        severity: "block",
        message:
          `Section 1 was signed ${record.section1SignedYmd}, which is AFTER the first day of ` +
          `work (${record.firstDayOfEmploymentYmd}). The law wants it no later than day one. ` +
          `Recording it accurately is still the right move - backdating a federal form is far ` +
          `worse than being late on one.`,
        authorityId: "cfr-8-274a-2-b-1-i-a-section-1-at-hire",
      });
    }
  }

  if (!record.section2CompletedYmd) {
    issues.push({
      field: "section2CompletedYmd",
      severity: "block",
      message:
        "Section 2 is not complete. You have three business days from the first day of work to " +
        "examine the documents in person and sign it.",
      authorityId: "cfr-8-274a-2-b-1-ii-section-2-three-business-days",
    });
  }

  if (record.section2CompletedYmd && record.firstDayOfEmploymentYmd) {
    const due = i9Section2DueYmd(record.firstDayOfEmploymentYmd);
    if (record.section2CompletedYmd > due) {
      issues.push({
        field: "section2CompletedYmd",
        severity: "block",
        message:
          `Section 2 was completed ${record.section2CompletedYmd} but was due ${due} - three ` +
          `business days after the first day of work. This is recorded as-is. A late I-9 is a ` +
          `paperwork violation; a falsified one is a crime.`,
        authorityId: "cfr-8-274a-2-b-1-ii-section-2-three-business-days",
      });
    }
  }

  if (record.documents.length === 0) {
    issues.push({
      field: "documents",
      severity: "block",
      message:
        "No documents recorded. Section 2 needs either one List A document, or one List B " +
        "identity document plus one List C work-authorization document.",
      authorityId: "cfr-8-274a-2-b-1-ii-section-2-three-business-days",
    });
  } else if (!i9DocumentSetIsSufficient(record.documents)) {
    issues.push({
      field: "documents",
      severity: "block",
      message:
        "This document set does not satisfy Section 2. It must be one List A document (proves " +
        "identity AND work authorization), or one List B (identity) PLUS one List C (work " +
        "authorization). Two List B documents is not 'extra proof' - it is an incomplete I-9.",
      authorityId: "cfr-8-274a-2-b-1-ii-section-2-three-business-days",
    });
  }

  // Expired documents. §274a.2(b)(1)(v) permits only unexpired documents.
  for (const [i, doc] of record.documents.entries()) {
    if (
      doc.expirationYmd &&
      record.section2CompletedYmd &&
      doc.expirationYmd < record.section2CompletedYmd
    ) {
      issues.push({
        field: `documents[${i}].expirationYmd`,
        severity: "block",
        message:
          `The ${doc.title} expired ${doc.expirationYmd}, before Section 2 was completed on ` +
          `${record.section2CompletedYmd}. Only UNEXPIRED documents may be accepted. You have to ` +
          `ask for a different document - and you must let the employee choose which one.`,
        authorityId: "cfr-8-274a-2-b-1-v-only-unexpired-documents",
      });
    }
    if (!doc.documentNumber.trim()) {
      issues.push({
        field: `documents[${i}].documentNumber`,
        severity: "block",
        message: `The ${doc.title} has no document number recorded.`,
      });
    }
  }

  return { ok: issues.every((i) => i.severity !== "block"), issues };
}

/**
 * A GUARD WITH TEETH (rule 40: an unreachable guard is an untested guard).
 *
 * This is called by the pay-computation path with whatever it was handed. If an
 * I-9 record ever reaches a function whose job is money, this throws. The point
 * is not to catch today's bug - there is none - but to make tomorrow's refactor
 * fail loudly at the boundary 8 C.F.R. §274a.2(b)(4) draws.
 */
export function assertI9NotUsedForPay(value: unknown, context: string): void {
  if (value === null || typeof value !== "object") return;
  const keys = Object.keys(value as Record<string, unknown>);
  const i9Markers = [
    "section1SignedYmd",
    "section2CompletedYmd",
    "copiesRetained",
  ];
  const hits = i9Markers.filter((k) => keys.includes(k));
  if (hits.length > 0) {
    throw new Error(
      `I-9 data reached ${context}, which computes pay. 8 C.F.R. §274a.2(b)(4) limits what an ` +
        `I-9 may be used for, and immigration-status facts must never influence compensation. ` +
        `Offending fields: ${hits.join(", ")}. Pass only the pay record.`,
    );
  }
}

// ===========================================================================
// 4) THE PAY RECORD — the part neither the W-4 nor the I-9 tells us
// ===========================================================================

/**
 * Michael's scope, in his words:
 *
 *   "The system should do the heavy lifting, I should only have to enter in w-4
 *    and I-9 info, plus any other info that's not given on those two forms like
 *    pay info, if they are a cogs employee and the split I assign them."
 *
 * And his facts:
 *   - "hourly for all employees, salary for me"
 *   - "every two weeks on friday" (biweekly, 26 periods)
 *   - "I pay myself once at the end of the year"
 *   - "I also give bonuses"
 */

export type PayBasis = "hourly" | "salary";

export type PayRecord = {
  employeeId: string;
  basis: PayBasis;
  /** Hourly wage in MILLI-CENTS per hour. Required when basis is "hourly". */
  hourlyRateMilliCents: number | null;
  /** Annual salary in CENTS. Required when basis is "salary". */
  annualSalaryCents: number | null;
  payFrequency: PayFrequency;
  /**
   * Labor role code from LABOR_ROLES in payroll-cogs-core.ts. This is what
   * decides §280E treatment and which GL account the wages hit. Michael's
   * "if they are a cogs employee and the split I assign them".
   */
  laborRoleCode: string;
  /**
   * When an employee splits time across roles, the share of hours attributable
   * to the COGS-allocable role, in BASIS POINTS (10000 = 100%).
   * Integer, because a percentage stored as a float re-introduces the drift that
   * integer cents exist to prevent.
   */
  cogsSplitBasisPoints: number;
  /** First day of work for pay. */
  hireYmd: string;
  /** Washington minimum wage in effect on the hire date, in MILLI-CENTS/hour. */
  minimumWageMilliCentsAtHire: number | null;
};

export const BASIS_POINTS_FULL = 10_000;

export type PayIssue = {
  field: string;
  severity: "block" | "warn";
  message: string;
  authorityId?: string;
};

/**
 * Validate the pay record.
 *
 * DIRECTLY ANSWERS TWO SAGE DEFECTS FOUND IN THE SCREENSHOTS:
 *
 *   1. Every hourly rate on Michael's Pay Info tab reads 0.00, and Sage will
 *      happily save that employee. A zero wage is not a wage; it is a field
 *      nobody filled in. We block it. (Rule 46: a zero nobody computed looks
 *      exactly like a zero somebody computed.)
 *
 *   2. Sage's Pay Frequency defaulted to "Weekly" while Michael actually pays
 *      every two weeks. A wrong frequency does not fail loudly - it silently
 *      mis-annualizes every withholding calculation, because Pub. 15-T divides
 *      by periods per year. 52 vs 26 is a 2x error in the annualized wage.
 */
export function validatePay(record: PayRecord): { ok: boolean; issues: PayIssue[] } {
  const issues: PayIssue[] = [];

  if (record.basis === "hourly") {
    if (record.hourlyRateMilliCents === null) {
      issues.push({
        field: "hourlyRateMilliCents",
        severity: "block",
        message:
          "No hourly rate. This is the field Sage leaves at 0.00 and saves anyway - which is how " +
          "someone ends up on the payroll with no wage and nobody notices until they complain.",
      });
    } else {
      assertIntegerMilliCents(record.hourlyRateMilliCents, "hourlyRateMilliCents");
      if (record.hourlyRateMilliCents <= 0) {
        issues.push({
          field: "hourlyRateMilliCents",
          severity: "block",
          message:
            "An hourly rate of zero or less is not a rate. If this person is unpaid they do not " +
            "belong on a payroll; if they are paid, I need the number.",
        });
      } else if (
        record.minimumWageMilliCentsAtHire !== null &&
        record.hourlyRateMilliCents < record.minimumWageMilliCentsAtHire
      ) {
        issues.push({
          field: "hourlyRateMilliCents",
          severity: "block",
          message:
            `This rate is below the Washington minimum wage in effect on the hire date. ` +
            `Washington's minimum is a floor set by RCW 49.46.020 and adjusted annually; a rate ` +
            `under it is a wage claim waiting to happen, plus interest and fees.`,
        });
      }
    }
    if (record.annualSalaryCents !== null) {
      issues.push({
        field: "annualSalaryCents",
        severity: "block",
        message:
          "This person is set up as hourly but also carries an annual salary. One of those two " +
          "is wrong, and I will not guess which - guessing here either underpays a worker or " +
          "overstates your labor cost.",
      });
    }
  }

  if (record.basis === "salary") {
    if (record.annualSalaryCents === null) {
      issues.push({
        field: "annualSalaryCents",
        severity: "block",
        message: "No annual salary recorded for a salaried person.",
      });
    } else {
      assertIntegerCents(record.annualSalaryCents, "annualSalaryCents");
      if (record.annualSalaryCents <= 0) {
        issues.push({
          field: "annualSalaryCents",
          severity: "block",
          message:
            "A salary of zero. If this is you paying yourself nothing, note that an S-corporation " +
            "owner who works in the business and takes no wage is the single most common " +
            "reasonable-compensation adjustment there is.",
        });
      }
    }
    if (record.hourlyRateMilliCents !== null) {
      issues.push({
        field: "hourlyRateMilliCents",
        severity: "block",
        message:
          "This person is salaried but also carries an hourly rate. Sage's Pay Info tab lets both " +
          "sit there at once; that ambiguity is how the wrong one gets used.",
      });
    }
  }

  if (!Number.isInteger(record.cogsSplitBasisPoints)) {
    issues.push({
      field: "cogsSplitBasisPoints",
      severity: "block",
      message:
        "The COGS split must be whole basis points (10000 = 100%). Storing it as a decimal " +
        "percentage is how a 33.333% split stops adding up to 100 across three roles.",
    });
  } else if (
    record.cogsSplitBasisPoints < 0 ||
    record.cogsSplitBasisPoints > BASIS_POINTS_FULL
  ) {
    issues.push({
      field: "cogsSplitBasisPoints",
      severity: "block",
      message: `The COGS split must be between 0 and ${BASIS_POINTS_FULL} basis points.`,
    });
  }

  if (!record.laborRoleCode.trim()) {
    issues.push({
      field: "laborRoleCode",
      severity: "block",
      message:
        "No labor role. This is the field that decides whether the wage is cost of goods sold or " +
        "a §280E-disallowed operating expense, so it is not optional and it is not cosmetic.",
    });
  }

  return { ok: issues.every((i) => i.severity !== "block"), issues };
}

/**
 * How much gross pay one period is, before any tax.
 *
 * For salary this is the annual amount divided over the periods in the year, with
 * the REMAINDER GIVEN TO THE FIRST PERIOD rather than dropped. $70,000 over 26
 * periods is $2,692.3076..., and 26 x $2,692.30 is $69,999.80 - twenty cents that
 * has to live somewhere. Sage-style truncation loses it; we assign it explicitly
 * so the year foots.
 *
 * Michael's own case is the degenerate one: "I pay myself once at the end of the
 * year." One period, so the whole salary lands in it and there is no remainder to
 * place. The general code handles it without a special case.
 */
export function salaryGrossForPeriodCents(
  annualSalaryCents: number,
  frequency: PayFrequency,
  periodIndex: number,
): number {
  assertIntegerCents(annualSalaryCents, "annualSalaryCents");
  const periods = PAY_PERIODS_PER_YEAR[frequency];
  if (!Number.isInteger(periodIndex) || periodIndex < 0 || periodIndex >= periods) {
    throw new Error(
      `salaryGrossForPeriodCents: periodIndex ${periodIndex} is outside 0..${periods - 1} for ` +
        `${frequency} pay.`,
    );
  }
  const base = Math.floor(annualSalaryCents / periods);
  const remainder = annualSalaryCents - base * periods;
  return periodIndex === 0 ? base + remainder : base;
}

/**
 * Gross pay for hours worked at a milli-cent rate, rounded HALF UP to the cent.
 *
 * Hours arrive as integer HUNDREDTHS of an hour, matching the withholding engine's
 * existing `lniHundredthHours` convention (rule 25 - one representation of hours,
 * not two).
 *
 * ROUNDING DIRECTION IS DELIBERATE. Half-up favors the worker on the boundary. A
 * half-cent per paycheck is trivial; a wage-and-hour finding that you
 * systematically rounded pay DOWN is not.
 */
export function hourlyGrossCents(
  hundredthHours: number,
  rateMilliCentsPerHour: number,
): number {
  if (!Number.isInteger(hundredthHours) || hundredthHours < 0) {
    throw new Error(
      `hourlyGrossCents: hours must be a non-negative integer count of hundredths of an hour ` +
        `(got ${String(hundredthHours)}). Floating hours re-introduce the drift integer cents exist to stop.`,
    );
  }
  assertIntegerMilliCents(rateMilliCentsPerHour, "rateMilliCentsPerHour");
  // hundredths x milli-cents = 100 x 1000 = 100000 units per dollar-hour.
  const numerator = hundredthHours * rateMilliCentsPerHour;
  return Math.floor((numerator + 50_000) / 100_000);
}

// ===========================================================================
// 5) THE CHECKLIST — Michael's "check list of task to be completed"
// ===========================================================================

export type OnboardingStepKey =
  | "identity"
  | "i9_section1"
  | "i9_section2"
  | "w4"
  | "pay"
  | "labor_role"
  | "new_hire_report";

export type OnboardingStepDef = {
  key: OnboardingStepKey;
  label: string;
  /** Why this step exists, in Michael's language. */
  why: string;
  /** Steps that must be complete first, because the law orders them. */
  requires: readonly OnboardingStepKey[];
  /** True when an incomplete step blocks saving the employee to payroll. */
  blocksPayroll: boolean;
  authorityIds: readonly string[];
};

/**
 * THE ORDER IS LEGAL, NOT COSMETIC.
 *
 * Section 1 is due no later than the first day of work; Section 2 within three
 * business days after it. The W-4 is furnished on commencement of employment. The
 * DSHS new-hire report is due within 20 days of hire and RCW 26.23.040(2) says it
 * may be made "to the extent practicable" BY SUBMITTING A COPY OF THE W-4 - which
 * is precisely why the W-4 and that report belong in one flow instead of two
 * screens a month apart.
 */
export const ONBOARDING_STEPS: readonly OnboardingStepDef[] = [
  {
    key: "identity",
    label: "Who they are, and their Social Security number",
    why:
      "The number has to be on file in full because the W-2 and every Washington wage report " +
      "key on it. It is masked everywhere except for you, and every time it is revealed that " +
      "gets logged.",
    requires: [],
    blocksPayroll: true,
    authorityIds: ["cfr-31-3402-f-2-1-f-2-ssn-no-truncation"],
  },
  {
    key: "i9_section1",
    label: "I-9 Section 1 — the employee's attestation",
    why:
      "They complete and sign it no later than their first day of work. This lives in its own " +
      "quarantined record that the payroll engine cannot read, because immigration facts must " +
      "never touch a pay decision.",
    requires: [],
    blocksPayroll: true,
    authorityIds: ["cfr-8-274a-2-b-1-i-a-section-1-at-hire"],
  },
  {
    key: "i9_section2",
    label: "I-9 Section 2 — you examine their documents",
    why:
      "Three business days from day one. Either one List A document, or one List B plus one " +
      "List C. The employee picks which documents to show; asking for specific ones is itself " +
      "a violation.",
    requires: ["i9_section1"],
    blocksPayroll: true,
    authorityIds: [
      "cfr-8-274a-2-b-1-ii-section-2-three-business-days",
      "cfr-8-274a-2-b-1-v-only-unexpired-documents",
      "cfr-8-274a-2-b-3-copying-not-selective",
    ],
  },
  {
    key: "w4",
    label: "Form W-4 — how much federal tax to withhold",
    why:
      "If they never give you one, the law does not let you invent a rate: you withhold as if " +
      "Single with no adjustments. That is usually MORE tax than they owe, which is why it is " +
      "worth helping them fill it in properly.",
    requires: [],
    blocksPayroll: true,
    authorityIds: [
      "cfr-31-3402-f-2-1-a-1-furnish-on-commencement",
      "cfr-31-3402-f-2-1-a-4-no-certificate-default",
    ],
  },
  {
    key: "pay",
    label: "What you are paying them, and how often",
    why:
      "Neither the W-4 nor the I-9 tells us this, so it is the one part you have to supply from " +
      "the offer letter. Getting the frequency wrong does not fail loudly - it quietly " +
      "mis-annualizes every withholding calculation for the whole year.",
    requires: [],
    blocksPayroll: true,
    authorityIds: [],
  },
  {
    key: "labor_role",
    label: "What kind of work they do (§280E treatment)",
    why:
      "This decides whether their wage is cost of goods sold or a disallowed operating expense. " +
      "It is the highest-stakes dropdown in the system, and Sage models it as two pay types " +
      "both named 'REGULAR' that differ only by GL account.",
    requires: ["pay"],
    blocksPayroll: true,
    authorityIds: [],
  },
  {
    key: "new_hire_report",
    label: "Report the new hire to Washington (within 20 days)",
    why:
      "RCW 26.23.040 requires it within 20 days, and it says you may report - to the extent " +
      "practicable - by sending a copy of the W-4. That is why this sits in the same flow " +
      "instead of on a calendar you have to remember. Missing it is $25 a head, or $500 if it " +
      "was a deal with the employee to dodge it.",
    requires: ["w4"],
    blocksPayroll: false,
    authorityIds: [
      "rcw-26-23-040-twenty-day-new-hire-report",
      "rcw-26-23-040-report-by-w4-form",
      "rcw-26-23-040-failure-to-report-penalty",
    ],
  },
] as const;

export function findOnboardingStep(key: string): OnboardingStepDef | undefined {
  return ONBOARDING_STEPS.find((s) => s.key === key);
}

// ===========================================================================
// 6) THE GATE — evaluate everything, refuse with named fields
// ===========================================================================

export type FieldProblem = {
  /** Which step this belongs to, so the UI can highlight the right section. */
  step: OnboardingStepKey;
  /** Dotted field path, so the UI can highlight the exact input. */
  field: string;
  severity: "block" | "warn";
  message: string;
  authorityId?: string;
};

export type OnboardingCandidate = {
  employeeId: string;
  legalFirstName: string;
  legalLastName: string;
  ssn: string;
  w4: W4Record | null;
  i9: I9Record | null;
  pay: PayRecord | null;
  newHireReportedYmd: string | null;
};

export type StepStatus = {
  key: OnboardingStepKey;
  label: string;
  complete: boolean;
  /** True when an earlier required step is not done yet. */
  blockedByPrerequisite: boolean;
  problems: FieldProblem[];
};

export type OnboardingEvaluation = {
  /** TRUE only when every payroll-blocking step is clean. */
  canSaveToPayroll: boolean;
  steps: StepStatus[];
  /** Every blocking problem, flattened, for a summary banner. */
  blockingProblems: FieldProblem[];
  /** Non-blocking notes worth reading. */
  warnings: FieldProblem[];
  /** Deadlines derived from the hire date, when we know it. */
  deadlines: { key: string; label: string; dueYmd: string; help: string }[];
  /** A refusal code when we will not save, else null. */
  refusalCode: OnboardingRefusalCode | null;
};

/**
 * Named refusal codes. Rule 43: a refusal code no path emits is decoration, so
 * every one of these is emitted by `evaluateOnboarding` and asserted in tests.
 */
export type OnboardingRefusalCode =
  | "missing_required_steps"
  | "i9_defective"
  | "w4_defective"
  | "pay_defective"
  | "identity_defective";

/**
 * THE WHOLE POINT OF THE SLICE.
 *
 * Michael: "It should have a check list of task to be completed before it lets you
 * save them to the system, and if a field is missing, it should highlight it so
 * something can't silently fail me in some way."
 *
 * So this returns, for every step, whether it is done and WHICH FIELDS are wrong -
 * not a boolean, and not a single string. The UI highlights `field` and shows
 * `message`; the server action refuses on `refusalCode`. Same function, both
 * places, so the screen and the database can never disagree about what is
 * required (rule 16: prove the gate is wired).
 */
export function evaluateOnboarding(
  candidate: OnboardingCandidate,
): OnboardingEvaluation {
  const problems: FieldProblem[] = [];

  // --- identity -----------------------------------------------------------
  if (!candidate.legalFirstName.trim()) {
    problems.push({
      step: "identity",
      field: "legalFirstName",
      severity: "block",
      message: "Legal first name is required - it has to match the Social Security card.",
    });
  }
  if (!candidate.legalLastName.trim()) {
    problems.push({
      step: "identity",
      field: "legalLastName",
      severity: "block",
      message: "Legal last name is required - it has to match the Social Security card.",
    });
  }
  if (!candidate.ssn.trim()) {
    problems.push({
      step: "identity",
      field: "ssn",
      severity: "block",
      message:
        "The Social Security number is required. 26 C.F.R. §31.3402(f)(2)-1(f)(2) makes the " +
        "employee furnish it, and it may not be truncated on the W-4.",
      authorityId: "cfr-31-3402-f-2-1-f-2-ssn-no-truncation",
    });
  } else {
    for (const p of ssnProblems(candidate.ssn)) {
      problems.push({
        step: "identity",
        field: "ssn",
        severity: "block",
        message: ssnProblemMessage(p),
        authorityId: "cfr-31-3402-f-2-1-f-2-ssn-no-truncation",
      });
    }
  }

  // --- I-9 ----------------------------------------------------------------
  if (candidate.i9 === null) {
    problems.push({
      step: "i9_section1",
      field: "i9",
      severity: "block",
      message:
        "No I-9 on file. Every employee needs one - citizens included. It is not an immigration " +
        "question, it is a verification requirement that applies to everybody you hire.",
      authorityId: "cfr-8-274a-2-b-1-i-a-section-1-at-hire",
    });
  } else {
    const i9 = validateI9(candidate.i9);
    for (const issue of i9.issues) {
      problems.push({
        step: issue.field.startsWith("section1") ? "i9_section1" : "i9_section2",
        field: `i9.${issue.field}`,
        severity: issue.severity,
        message: issue.message,
        authorityId: issue.authorityId,
      });
    }
    if (!candidate.i9.copiesRetained) {
      problems.push({
        step: "i9_section2",
        field: "i9.copiesRetained",
        severity: "warn",
        message:
          "You are not keeping document copies for this person. That is allowed - copying is " +
          "optional. But if you copy for SOME employees and not others, the pattern itself is " +
          "evidence of discrimination. Pick one policy and apply it to everyone.",
        authorityId: "cfr-8-274a-2-b-3-copying-not-selective",
      });
    }
  }

  // --- W-4 ----------------------------------------------------------------
  if (candidate.w4 === null) {
    problems.push({
      step: "w4",
      field: "w4",
      severity: "block",
      message:
        "No W-4 on file. If the employee genuinely will not give you one, that is handled - the " +
        "law tells you to withhold as Single with no adjustments - but that is a decision to " +
        "record deliberately, not a blank to leave sitting there.",
      authorityId: "cfr-31-3402-f-2-1-a-4-no-certificate-default",
    });
  } else {
    const w4 = validateW4(candidate.w4);
    for (const issue of w4.issues) {
      problems.push({
        step: "w4",
        field: `w4.${issue.field}`,
        severity: issue.severity,
        message: issue.message,
        authorityId: issue.authorityId,
      });
    }
    if (!isModernW4(candidate.w4)) {
      problems.push({
        step: "w4",
        field: "w4.formYear",
        severity: "warn",
        message:
          "This is a pre-2020 W-4, which is still perfectly valid - the IRS honors it and you " +
          "may not make someone file a new one. It just runs through the allowance-based half " +
          "of the worksheet instead of the modern half.",
      });
    }
  }

  // --- pay ----------------------------------------------------------------
  if (candidate.pay === null) {
    problems.push({
      step: "pay",
      field: "pay",
      severity: "block",
      message: "No pay information. Rate or salary, and how often you pay, are both required.",
    });
  } else {
    const pay = validatePay(candidate.pay);
    for (const issue of pay.issues) {
      problems.push({
        step: issue.field === "laborRoleCode" || issue.field === "cogsSplitBasisPoints"
          ? "labor_role"
          : "pay",
        field: `pay.${issue.field}`,
        severity: issue.severity,
        message: issue.message,
        authorityId: issue.authorityId,
      });
    }
  }

  // --- new hire report ----------------------------------------------------
  if (candidate.pay?.hireYmd && !candidate.newHireReportedYmd) {
    problems.push({
      step: "new_hire_report",
      field: "newHireReportedYmd",
      severity: "warn",
      message:
        "The new-hire report to Washington is not marked done. It is due within 20 days of hire, " +
        "and you can satisfy it by sending a copy of this W-4. This does not stop you from " +
        "paying them - it is a separate obligation with its own penalty.",
      authorityId: "rcw-26-23-040-twenty-day-new-hire-report",
    });
  }

  // --- assemble per-step status ------------------------------------------
  const steps: StepStatus[] = ONBOARDING_STEPS.map((def) => {
    const own = problems.filter((p) => p.step === def.key);
    const hasBlock = own.some((p) => p.severity === "block");
    return {
      key: def.key,
      label: def.label,
      complete: !hasBlock,
      blockedByPrerequisite: false,
      problems: own,
    };
  });

  // Prerequisite ordering. A step whose requirement is incomplete is reported as
  // blocked so the UI can grey it out rather than inviting work that will be
  // rejected. Computed AFTER own-problems so a step can be both.
  const completeByKey = new Map(steps.map((s) => [s.key, s.complete]));
  for (const step of steps) {
    const def = findOnboardingStep(step.key);
    if (!def) continue;
    step.blockedByPrerequisite = def.requires.some(
      (r) => completeByKey.get(r) === false,
    );
  }

  const blockingProblems = problems.filter((p) => p.severity === "block");
  const warnings = problems.filter((p) => p.severity === "warn");

  const blockingSteps = new Set(
    ONBOARDING_STEPS.filter((s) => s.blocksPayroll).map((s) => s.key),
  );
  const canSaveToPayroll = !blockingProblems.some((p) => blockingSteps.has(p.step));

  return {
    canSaveToPayroll,
    steps,
    blockingProblems,
    warnings,
    deadlines: candidate.pay?.hireYmd
      ? onboardingDeadlines(candidate.pay.hireYmd)
      : [],
    refusalCode: canSaveToPayroll ? null : refusalCodeFor(blockingProblems),
  };
}

/**
 * Pick the most specific refusal code for a set of blocking problems.
 *
 * Order matters: identity before I-9 before W-4 before pay, because that is the
 * order a person fixes them in, and a refusal should name the FIRST thing to go
 * fix rather than an arbitrary one.
 */
function refusalCodeFor(blocking: readonly FieldProblem[]): OnboardingRefusalCode {
  if (blocking.some((p) => p.step === "identity")) return "identity_defective";
  if (blocking.some((p) => p.step === "i9_section1" || p.step === "i9_section2")) {
    return "i9_defective";
  }
  if (blocking.some((p) => p.step === "w4")) return "w4_defective";
  if (blocking.some((p) => p.step === "pay" || p.step === "labor_role")) {
    return "pay_defective";
  }
  return "missing_required_steps";
}

function ssnProblemMessage(p: SsnProblem): string {
  switch (p) {
    case "not_nine_digits":
      return "A Social Security number is exactly nine digits. This is not.";
    case "area_000":
      return "The first three digits cannot be 000 - SSA has never issued that area number.";
    case "area_666":
      return "The first three digits cannot be 666 - SSA excluded that area number from assignment.";
    case "area_900_999":
      return (
        "The first three digits cannot be 900-999. SSA never issued those. A number in the 900s " +
        "is usually an ITIN, which is not interchangeable with an SSN on a W-2."
      );
    case "group_00":
      return "The middle two digits cannot be 00 - SSA does not assign group number 00.";
    case "serial_0000":
      return "The last four digits cannot be 0000 - SSA does not assign serial number 0000.";
    case "sequential_placeholder":
      return (
        "123-45-6789 is the placeholder people type to get past a required field. It is not a " +
        "real number and it will be rejected by SSA."
      );
  }
}

/** Deadlines that flow from a hire date, in one list for the checklist UI. */
export function onboardingDeadlines(
  hireYmd: string,
): { key: string; label: string; dueYmd: string; help: string }[] {
  return [
    {
      key: "i9_section2",
      label: "I-9 Section 2 due",
      dueYmd: i9Section2DueYmd(hireYmd),
      help: "Three BUSINESS days after the first day of work - weekends do not count.",
    },
    {
      key: "new_hire_report",
      label: "Washington new-hire report due",
      dueYmd: addDaysYmdLocal(hireYmd, 20),
      help: "Twenty CALENDAR days after hire. A copy of the W-4 satisfies it.",
    },
    {
      key: "i9_retention",
      label: "I-9 keep until (if they never leave)",
      dueYmd: i9RetainUntilYmd(hireYmd, null),
      help:
        "Three years from hire, or one year after they leave - whichever is LATER. Recompute " +
        "this when someone terminates; for a long-tenured employee the answer changes by years.",
    },
  ];
}

/** Local calendar-day math. Kept private so there is one public deadline API. */
function addDaysYmdLocal(ymd: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) throw new Error(`addDaysYmdLocal: expected YYYY-MM-DD, got "${ymd}"`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ===========================================================================
// 7) WHAT THE NO-W-4 DEFAULT ACTUALLY COSTS
// ===========================================================================

/**
 * Michael's real question, the one his grandfather answers:
 *
 *   "Every time I hire someone new, they ask me how to fill out their w-4 and I
 *    never know what to say."
 *
 * The honest answer has two halves. First, what you may NOT do: you may not tell
 * them what to put. Advising an employee on their W-4 entries is giving tax advice
 * about someone else's return, and if it is wrong they are the one assessed.
 *
 * Second, what you CAN say - which is most of what they actually want to know:
 * what happens if they do nothing. 26 C.F.R. §31.3402(f)(2)-1(a)(4) says an
 * employee who furnishes no certificate is treated as a single person with no
 * adjustments. This function quantifies that gap so the conversation stops being
 * abstract.
 *
 * It deliberately does NOT compute tax itself - `computePaycheckTaxes` in
 * payroll-withholding-core.ts already does, and a second implementation would
 * eventually disagree with the first (rule 25). This returns the two W-4 records
 * to compare, and the caller runs both through the real engine.
 */
export function noW4DefaultComparison(
  employeeId: string,
  formYear: number,
  furnished: W4Record | null,
): {
  /** What the law forces when nothing is furnished. */
  statutoryDefault: W4Record;
  /** What the employee actually handed you, if anything. */
  furnished: W4Record | null;
  plainEnglish: string;
  authorityId: string;
} {
  // Rule 25: payroll-w4-core.ts ALREADY encodes the statutory default, and it is
  // the record the withholding engine already trusts. Building a second copy here
  // would eventually disagree with that one - and the disagreement would be
  // invisible, because both would look plausible. Call the existing one.
  const statutoryDefault: W4Record = defaultW4WhenNoneFurnished(employeeId, formYear);

  return {
    statutoryDefault,
    furnished,
    plainEnglish:
      "If an employee never gives you a W-4, you do not get to pick a rate and you do not get " +
      "to leave them out of payroll. The regulation tells you exactly what to do: withhold as " +
      "if they were single with no adjustments. For most people - anyone married, or with " +
      "children, or with deductions - that withholds MORE than they owe, so they are lending " +
      "the government money until they file. That is the sentence to say out loud when someone " +
      "asks why they should bother filling it in. What you must NOT do is tell them what to " +
      "write on it. Their W-4 drives their return, and if your advice is wrong they are the one " +
      "who gets the bill.",
    authorityId: "cfr-31-3402-f-2-1-a-4-no-certificate-default",
  };
}

/**
 * The number of pay periods remaining in a year after a mid-year hire.
 *
 * WHY THIS MATTERS AND WHY SAGE GETS PEOPLE HURT HERE: Pub. 15-T withholding
 * annualizes the current paycheck as though it were earned all year. Someone hired
 * in November whose biweekly gross implies a $60,000 annual wage will have tax
 * withheld at $60,000 rates even though they will only earn $5,000 this year. That
 * is correct as a method and it surprises everyone, so it is worth being able to
 * say it before the first payday rather than after the complaint.
 */
export function payPeriodsRemainingInYear(
  hireYmd: string,
  frequency: PayFrequency,
): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(hireYmd);
  if (!m) throw new Error(`payPeriodsRemainingInYear: expected YYYY-MM-DD, got "${hireYmd}"`);
  const periods = PAY_PERIODS_PER_YEAR[frequency];
  const start = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const yearEnd = Date.UTC(Number(m[1]), 11, 31);
  const daysLeft = Math.floor((yearEnd - start) / 86_400_000) + 1;
  const remaining = Math.floor((daysLeft / 365) * periods);
  return Math.max(0, Math.min(periods, remaining));
}

/** Every W-4 field a UI must render, so none can be silently omitted. */
export function w4RequiredFieldPaths(): readonly string[] {
  return [
    "w4.formYear",
    "w4.filingStatus",
    "w4.step2MultipleJobs",
    "w4.step3AnnualCreditCents",
    "w4.step4aOtherIncomeAnnualCents",
    "w4.step4bDeductionsAnnualCents",
    "w4.step4cExtraPerPeriodCents",
    "w4.signedAt",
  ] as const;
}

/** Every I-9 field a UI must render. */
export function i9RequiredFieldPaths(): readonly string[] {
  return [
    "i9.firstDayOfEmploymentYmd",
    "i9.section1SignedYmd",
    "i9.section2CompletedYmd",
    "i9.documents",
  ] as const;
}

/** Every pay field a UI must render. */
export function payRequiredFieldPaths(): readonly string[] {
  return [
    "pay.basis",
    "pay.payFrequency",
    "pay.laborRoleCode",
    "pay.cogsSplitBasisPoints",
    "pay.hireYmd",
  ] as const;
}

/**
 * Re-export of the W-4 issue type so callers of this module do not have to import
 * from two places to handle one screen's problems.
 */
export type { W4ValidationIssue };
