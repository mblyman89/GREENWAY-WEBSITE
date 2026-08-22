/**
 * WAGE ORDER ENTRY - turning a court document into a row, or refusing to.
 *
 * books-38. PURE. No database, no clock, no environment. Everything this
 * module needs arrives as an argument, which is why every branch below is
 * reachable from a test (rule 43) and why "today" is a parameter rather than
 * a call to Date.now().
 *
 * WHAT THIS IS FOR
 *
 * Michael has a judgement or a writ in his hand and needs it to become a row
 * in `wage_orders`. Between those two states sit about twenty ways to be
 * wrong, and most of them produce a row that looks completely normal. A
 * percentage typed as 25 instead of 2500 basis points is a garnishment at a
 * quarter of one percent. An order kind of "creditor" on what is actually a
 * child-support IWO withholds at the wrong ceiling AND at the wrong priority.
 * A missing service date means nobody can tell whether the twenty-day answer
 * deadline has passed.
 *
 * None of those errors announce themselves. They all produce plausible
 * dollar figures on a real paycheck.
 *
 * THE DESIGN RULE THAT MATTERS MOST HERE
 *
 * This module REFUSES; it never coerces. If a field is missing or
 * contradictory the answer is a refusal with a code, a plain sentence, and
 * the name of the field to fix - never a repaired value. Rule 62d: never
 * invent a default. On this screen a default is not a convenience, it is a
 * guess about somebody's child support, made silently, that will be withheld
 * from a real person's pay every fortnight until someone notices.
 *
 * WHY VALIDATION IS DUPLICATED FROM THE DATABASE ON PURPOSE
 *
 * Migration 0198 already enforces most of this with CHECK constraints, and
 * that is the backstop that cannot be bypassed. But a CHECK constraint
 * failure surfaces as `new row for relation "wage_orders" violates check
 * constraint "wage_orders_states_one_measure"`. Michael's standing complaint
 * about Sage is being stopped without being told why. So the same rules are
 * expressed here in sentences a human can act on, and the constraint stays
 * underneath as the thing that is actually load-bearing.
 *
 * The two must not drift. `wageOrderConstraintParity()` at the bottom of this
 * file exists so a test can assert that every CHECK constraint in 0198 has a
 * refusal code here that fires FIRST.
 */

import type { WageOrderKind } from "@/lib/payroll/garnishment-core";

/* ══════════════════════════════════════════════════════════════════════════
 * §1  WHAT A JUDGEMENT LOOKS LIKE BEFORE IT IS TRUSTED
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Exactly what a human typed off the document, before any of it is believed.
 *
 * Every field is the raw shape a form produces: strings, or null for "not
 * filled in". Nothing here is a number yet, because the conversion from
 * "25%" to 2500 basis points is itself one of the places this goes wrong,
 * and a type that pretends the conversion already happened hides it.
 */
export type WageOrderDraft = {
  readonly employeeId: string | null;
  readonly orderKind: string | null;
  readonly caseNumber: string | null;
  readonly issuingAuthority: string | null;
  /** ISO yyyy-mm-dd. The date printed on the order itself. */
  readonly orderDate: string | null;
  /**
   * ISO yyyy-mm-dd. The date the paper was SERVED on Greenway.
   *
   * This is not the same as the order date and it is not the date Michael
   * opened the envelope. Every deadline in this area runs from service:
   * twenty days to answer a support order under RCW 26.18.110(1), and
   * whatever the writ says for a creditor garnishment under RCW 6.27.200.
   */
  readonly servedDate: string | null;
  readonly payeeName: string | null;
  readonly payeeAddress: string | null;
  readonly remittanceInstructions: string | null;
  /** Free text as typed, e.g. "425.00" or "$425". Parsed, never assumed. */
  readonly fixedAmountText: string | null;
  /** Free text as typed, e.g. "25" or "25%". Parsed into basis points. */
  readonly percentText: string | null;
  readonly arrearsText: string | null;
  /** Tri-state on purpose. null = the question has not been answered. */
  readonly arrearsOverTwelveWeeks: boolean | null;
  /** Tri-state on purpose. null = the question has not been answered. */
  readonly supportsSecondFamily: boolean | null;
  readonly priorityText: string | null;
  readonly effectiveFrom: string | null;
  readonly effectiveTo: string | null;
  readonly notes: string | null;
};

/** An empty draft. Used by the form for its initial state. */
export const EMPTY_WAGE_ORDER_DRAFT: WageOrderDraft = {
  employeeId: null,
  orderKind: null,
  caseNumber: null,
  issuingAuthority: null,
  orderDate: null,
  servedDate: null,
  payeeName: null,
  payeeAddress: null,
  remittanceInstructions: null,
  fixedAmountText: null,
  percentText: null,
  arrearsText: null,
  arrearsOverTwelveWeeks: null,
  supportsSecondFamily: null,
  priorityText: null,
  effectiveFrom: null,
  effectiveTo: null,
  notes: null,
};

/* ══════════════════════════════════════════════════════════════════════════
 * §2  THE REFUSAL VOCABULARY
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Every way an entry can be refused.
 *
 * A closed union rather than free-form strings, so that a test can assert
 * every single one is reachable (rule 43) and so the mentor layer can be
 * gated on covering all of them.
 */
export type WageOrderRefusalCode =
  | "NO_EMPLOYEE"
  | "UNKNOWN_ORDER_KIND"
  | "NO_CASE_NUMBER"
  | "NO_ISSUING_AUTHORITY"
  | "NO_PAYEE"
  | "NO_ORDER_DATE"
  | "BAD_ORDER_DATE"
  | "NO_SERVED_DATE"
  | "BAD_SERVED_DATE"
  | "SERVED_BEFORE_ORDERED"
  | "NO_MEASURE"
  | "TWO_MEASURES"
  | "BAD_AMOUNT"
  | "AMOUNT_NOT_POSITIVE"
  | "BAD_PERCENT"
  | "PERCENT_OUT_OF_RANGE"
  | "BAD_ARREARS"
  | "ARREARS_NEGATIVE"
  | "SUPPORT_NEEDS_SECOND_FAMILY_ANSWER"
  | "SUPPORT_NEEDS_ARREARS_AGE_ANSWER"
  | "BAD_PRIORITY"
  | "PRIORITY_NOT_POSITIVE"
  | "NO_EFFECTIVE_FROM"
  | "BAD_EFFECTIVE_FROM"
  | "BAD_EFFECTIVE_TO"
  | "EFFECTIVE_DATES_REVERSED"
  | "DUPLICATE_CASE_NUMBER";

export type WageOrderRefusal = {
  readonly code: WageOrderRefusalCode;
  /** The draft field this belongs to, so the form can point at it. */
  readonly field: keyof WageOrderDraft;
  /** A sentence Michael can act on. Never a constraint name. */
  readonly message: string;
};

/* ══════════════════════════════════════════════════════════════════════════
 * §3  THE ROW THAT COMES OUT THE OTHER SIDE
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * A validated order, in the shape the database column names expect.
 *
 * Snake_case deliberately: this is the boundary object handed to the store,
 * and naming it after the columns makes a mismatch a compile error rather
 * than a silently dropped field.
 */
export type ValidatedWageOrder = {
  readonly employee_id: string;
  readonly order_kind: WageOrderKind;
  readonly case_number: string;
  readonly issuing_authority: string;
  readonly order_date: string;
  readonly served_date: string;
  readonly payee_name: string;
  readonly payee_address: string | null;
  readonly remittance_instructions: string | null;
  readonly amount_cents_per_period: number | null;
  readonly percent_of_disposable_basis_points: number | null;
  readonly arrears_cents: number | null;
  readonly arrears_over_twelve_weeks: boolean | null;
  readonly supports_second_family: boolean | null;
  readonly priority: number;
  readonly effective_from: string;
  readonly effective_to: string | null;
  readonly notes: string | null;
};

export type WageOrderValidation =
  | { readonly ok: true; readonly order: ValidatedWageOrder; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly refusals: readonly WageOrderRefusal[] };

/* ══════════════════════════════════════════════════════════════════════════
 * §4  PARSING HELPERS - each one refuses rather than repairing
 * ══════════════════════════════════════════════════════════════════════════ */

const KNOWN_ORDER_KINDS: readonly WageOrderKind[] = [
  "child_support",
  "spousal_support",
  "creditor",
  "consumer_debt",
  "student_loan",
  "federal_tax_levy",
  "state_tax_levy",
];

export function isSupportOrder(kind: WageOrderKind): boolean {
  return kind === "child_support" || kind === "spousal_support";
}

function clean(v: string | null): string | null {
  if (v === null) return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

/**
 * A strict ISO date. Deliberately does NOT accept "8/22/2026".
 *
 * An ambiguous date format is how 03/04 becomes March the fourth in one
 * place and the fourth of March in another. Everything downstream compares
 * these as strings, so the format has to be exact.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealIsoDate(v: string): boolean {
  if (!ISO_DATE.test(v)) return false;
  const [y, m, d] = v.split("-").map((p) => Number.parseInt(p, 10));
  if (m < 1 || m > 12 || d < 1) return false;
  // Day-of-month bound comes from the calendar, not from a 31 everywhere.
  // Date.UTC normalises an overflow, so a mismatch means the day was invalid.
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
  );
}

/**
 * Money, as typed by a human, into integer cents.
 *
 * Accepts "$1,234.56", "1234.56", "1234". Rejects anything else rather than
 * salvaging digits out of it, because a partially-understood amount is worse
 * than no amount: the salvage always succeeds and always looks plausible.
 */
export function parseMoneyToCents(raw: string): number | null {
  const t = raw.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  const cents = Number.parseInt(whole, 10) * 100 + Number.parseInt(frac.padEnd(2, "0"), 10);
  return Number.isFinite(cents) ? cents : null;
}

/**
 * A percentage into BASIS POINTS. "25" -> 2500. "12.5" -> 1250.
 *
 * THE MOST DANGEROUS CONVERSION ON THIS SCREEN. The column is basis points
 * and a human writes percent. Store 25 where 2500 belongs and the order
 * withholds a quarter of one percent - $2.88 instead of $288.20 on the
 * worked example. It never errors, the cheque balances, and the support
 * obligee is short by 99% every fortnight.
 *
 * Two decimal places are allowed because a court can and does order 22.5%.
 */
export function parsePercentToBasisPoints(raw: string): number | null {
  const t = raw.trim().replace(/%$/, "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  const bp = Number.parseInt(whole, 10) * 100 + Number.parseInt(frac.padEnd(2, "0"), 10);
  return Number.isFinite(bp) ? bp : null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * §5  THE VALIDATION ITSELF
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Turn a typed draft into a storable order, or explain every reason why not.
 *
 * ALL refusals are collected rather than returning at the first one. A form
 * that reveals one problem per submission turns a five-field mistake into
 * five round trips, and the fifth one is where people give up and write the
 * order on a sticky note instead.
 *
 * @param draft         what the human typed
 * @param existingCaseNumbers case numbers already ACTIVE for this employee.
 *        Passed in rather than read, so this stays pure and so the duplicate
 *        rule is testable without a database. Mirrors the unique index
 *        `wage_orders_one_live_per_case`.
 */
export function validateWageOrderDraft(
  draft: WageOrderDraft,
  existingCaseNumbers: readonly string[] = [],
): WageOrderValidation {
  const refusals: WageOrderRefusal[] = [];
  const warnings: string[] = [];
  const add = (code: WageOrderRefusalCode, field: keyof WageOrderDraft, message: string) =>
    refusals.push({ code, field, message });

  /* ---- who ---- */
  const employeeId = clean(draft.employeeId);
  if (!employeeId) {
    add("NO_EMPLOYEE", "employeeId", "Choose the employee this order applies to.");
  }

  /* ---- what kind ---- */
  const kindRaw = clean(draft.orderKind);
  const kind = KNOWN_ORDER_KINDS.find((k) => k === kindRaw);
  if (!kind) {
    add(
      "UNKNOWN_ORDER_KIND",
      "orderKind",
      "Pick the kind of order from the list. The kind decides which legal ceiling applies and " +
        "which order gets paid first, so it cannot be guessed from the rest of the paperwork.",
    );
  }

  /* ---- identification ---- */
  const caseNumber = clean(draft.caseNumber);
  if (!caseNumber) {
    add(
      "NO_CASE_NUMBER",
      "caseNumber",
      "Type the case number exactly as it appears on the order. Every payment you send has to " +
        "reference it or the money can be credited to the wrong case.",
    );
  } else if (existingCaseNumbers.some((c) => c.trim() === caseNumber)) {
    add(
      "DUPLICATE_CASE_NUMBER",
      "caseNumber",
      `This employee already has an active order with case number ${caseNumber}. Entering it ` +
        "twice would withhold twice. If the court amended the order, end the existing one first " +
        "and then add the amended version.",
    );
  }

  if (!clean(draft.issuingAuthority)) {
    add(
      "NO_ISSUING_AUTHORITY",
      "issuingAuthority",
      "Type the court or agency that issued this - for example 'Kitsap County Superior Court' " +
        "or 'WA State Support Registry'. You will need it to answer the order.",
    );
  }

  if (!clean(draft.payeeName)) {
    add(
      "NO_PAYEE",
      "payeeName",
      "Type who the money goes to. Sending a withholding to the wrong payee does not discharge " +
        "the obligation - you can be asked for it a second time.",
    );
  }

  /* ---- the two dates, and their ordering ---- */
  const orderDate = clean(draft.orderDate);
  if (!orderDate) {
    add("NO_ORDER_DATE", "orderDate", "Type the date printed on the order itself.");
  } else if (!isRealIsoDate(orderDate)) {
    add("BAD_ORDER_DATE", "orderDate", "The order date must be a real date in yyyy-mm-dd form.");
  }

  const servedDate = clean(draft.servedDate);
  if (!servedDate) {
    add(
      "NO_SERVED_DATE",
      "servedDate",
      "Type the date this was SERVED on Greenway - not the date you opened it. Every deadline " +
        "runs from service: twenty days to answer a support order, and whatever the writ says " +
        "for a creditor garnishment.",
    );
  } else if (!isRealIsoDate(servedDate)) {
    add("BAD_SERVED_DATE", "servedDate", "The served date must be a real date in yyyy-mm-dd form.");
  }

  if (orderDate && servedDate && isRealIsoDate(orderDate) && isRealIsoDate(servedDate)) {
    if (servedDate < orderDate) {
      add(
        "SERVED_BEFORE_ORDERED",
        "servedDate",
        "The served date is before the order date, which cannot happen. Check which is which - " +
          "getting them the wrong way round moves your answer deadline.",
      );
    }
  }

  /* ---- exactly one measure. Mirrors wage_orders_states_one_measure. ---- */
  const amountText = clean(draft.fixedAmountText);
  const percentText = clean(draft.percentText);
  let amountCents: number | null = null;
  let basisPoints: number | null = null;

  if (amountText !== null && percentText !== null) {
    add(
      "TWO_MEASURES",
      "fixedAmountText",
      "This order has both a fixed amount and a percentage. A writ states one or the other, " +
        "never both. Enter whichever the document actually says and clear the other.",
    );
  } else if (amountText === null && percentText === null) {
    add(
      "NO_MEASURE",
      "fixedAmountText",
      "Enter either a fixed amount per pay period or a percentage of disposable earnings - " +
        "whichever the order states. Without one there is nothing to withhold.",
    );
  } else if (amountText !== null) {
    amountCents = parseMoneyToCents(amountText);
    if (amountCents === null) {
      add(
        "BAD_AMOUNT",
        "fixedAmountText",
        "The amount must be a plain figure like 425.00. Nothing was assumed about what you meant.",
      );
    } else if (amountCents <= 0) {
      add(
        "AMOUNT_NOT_POSITIVE",
        "fixedAmountText",
        "The amount has to be more than zero. An order for nothing is not an order.",
      );
    }
  } else if (percentText !== null) {
    basisPoints = parsePercentToBasisPoints(percentText);
    if (basisPoints === null) {
      add(
        "BAD_PERCENT",
        "percentText",
        "The percentage must be a plain figure like 25 or 22.5. Type the percent, not the decimal " +
          "- 25 means twenty-five percent.",
      );
    } else if (basisPoints < 1 || basisPoints > 10000) {
      add(
        "PERCENT_OUT_OF_RANGE",
        "percentText",
        "The percentage has to be between 0.01 and 100. If the order says something outside that " +
          "range, re-read it - it is probably a fixed amount.",
      );
    }
  }

  /* ---- arrears ---- */
  let arrearsCents: number | null = null;
  const arrearsText = clean(draft.arrearsText);
  if (arrearsText !== null) {
    arrearsCents = parseMoneyToCents(arrearsText);
    if (arrearsCents === null) {
      add("BAD_ARREARS", "arrearsText", "Arrears must be a plain figure like 1200.00, or left blank.");
    } else if (arrearsCents < 0) {
      add("ARREARS_NEGATIVE", "arrearsText", "Arrears cannot be a negative amount.");
    }
  }

  /* ---- the two support questions. Mirrors
   *      wage_orders_support_needs_family_answer, and goes further. ---- */
  if (kind && isSupportOrder(kind)) {
    if (draft.supportsSecondFamily === null) {
      add(
        "SUPPORT_NEEDS_SECOND_FAMILY_ANSWER",
        "supportsSecondFamily",
        "Answer whether this employee supports another spouse or dependent child. This is the " +
          "difference between a 50% ceiling and a 60% one under 15 U.S.C. 1673(b)(2) - up to ten " +
          "percent of their pay. There is no safe default, so the order cannot be saved without it.",
      );
    }
    if (draft.arrearsOverTwelveWeeks === null) {
      add(
        "SUPPORT_NEEDS_ARREARS_AGE_ANSWER",
        "arrearsOverTwelveWeeks",
        "Answer whether any arrears are more than twelve weeks old. If they are, the ceiling rises " +
          "by five percentage points. The order usually says; if it does not, ask the issuing " +
          "agency rather than guessing.",
      );
    }
  }

  /* ---- priority ---- */
  let priority = kind && isSupportOrder(kind) ? 1 : 100;
  const priorityText = clean(draft.priorityText);
  if (priorityText !== null) {
    const p = Number.parseInt(priorityText, 10);
    if (!/^\d+$/.test(priorityText) || !Number.isFinite(p)) {
      add("BAD_PRIORITY", "priorityText", "Priority must be a whole number. Lower is paid first.");
    } else if (p <= 0) {
      add("PRIORITY_NOT_POSITIVE", "priorityText", "Priority must be 1 or higher.");
    } else {
      priority = p;
    }
  }

  /* ---- the effective window ---- */
  const effectiveFrom = clean(draft.effectiveFrom);
  if (!effectiveFrom) {
    add(
      "NO_EFFECTIVE_FROM",
      "effectiveFrom",
      "Type the date withholding starts. For a support order that is normally the date you " +
        "received it - RCW 26.18.110(2) says withholding starts immediately on receipt.",
    );
  } else if (!isRealIsoDate(effectiveFrom)) {
    add("BAD_EFFECTIVE_FROM", "effectiveFrom", "The start date must be a real date in yyyy-mm-dd form.");
  }

  const effectiveTo = clean(draft.effectiveTo);
  if (effectiveTo !== null && !isRealIsoDate(effectiveTo)) {
    add("BAD_EFFECTIVE_TO", "effectiveTo", "The end date must be a real date in yyyy-mm-dd form, or blank.");
  }

  if (
    effectiveFrom &&
    effectiveTo &&
    isRealIsoDate(effectiveFrom) &&
    isRealIsoDate(effectiveTo) &&
    effectiveTo < effectiveFrom
  ) {
    add(
      "EFFECTIVE_DATES_REVERSED",
      "effectiveTo",
      "The end date is before the start date. Check which is which.",
    );
  }

  /* ---- warnings: true, useful, and NOT blocking ---- */
  if (kind && !isSupportOrder(kind) && priority < 100) {
    warnings.push(
      "You have given a non-support order a priority ahead of the default. Under RCW 26.18.110(5) " +
        "child support outranks every other garnishment and spousal maintenance outranks everything " +
        "except child support, whatever order they arrived in. Make sure this is what the court said.",
    );
  }
  if (kind === "creditor" || kind === "consumer_debt") {
    warnings.push(
      "This is a creditor garnishment, and it EXPIRES. Under RCW 6.27.350(1) the lien runs until " +
        "the writ amount is collected or until the payroll period ending on or before sixty days " +
        "after the effective date, whichever comes first. Diary the end date now - withholding " +
        "after a writ dies is an unlawful deduction, not a paperwork slip.",
    );
  }
  if (kind && isSupportOrder(kind)) {
    warnings.push(
      "Support order: withholding starts IMMEDIATELY on receipt and the money must reach the " +
        "registry within five working days of each pay interval (RCW 26.18.110(2)). You must also " +
        "answer by sworn affidavit within twenty days of service (RCW 26.18.110(1)) - failing to " +
        "answer is its own route to liability for the whole support debt under subsection (6).",
    );
  }
  if (amountCents !== null && basisPoints === null && kind && isSupportOrder(kind)) {
    warnings.push(
      "This support order is a fixed amount. The legal ceiling still applies on top of it: if the " +
        "fixed amount exceeds the percentage cap for the period, only the capped amount comes out " +
        "and the rest is a shortfall you should report, not make up from elsewhere.",
    );
  }

  if (refusals.length > 0) return { ok: false, refusals };

  // Non-null assertions are safe here ONLY because every one of these fields
  // has a refusal above that would have returned already. That coupling is
  // load-bearing, and `wageOrderRefusalGuards()` below exists so a test can
  // prove it stays true.
  return {
    ok: true,
    warnings,
    order: {
      employee_id: employeeId as string,
      order_kind: kind as WageOrderKind,
      case_number: caseNumber as string,
      issuing_authority: clean(draft.issuingAuthority) as string,
      order_date: orderDate as string,
      served_date: servedDate as string,
      payee_name: clean(draft.payeeName) as string,
      payee_address: clean(draft.payeeAddress),
      remittance_instructions: clean(draft.remittanceInstructions),
      amount_cents_per_period: amountCents,
      percent_of_disposable_basis_points: basisPoints,
      arrears_cents: arrearsCents,
      arrears_over_twelve_weeks: draft.arrearsOverTwelveWeeks,
      supports_second_family: draft.supportsSecondFamily,
      priority,
      effective_from: effectiveFrom as string,
      effective_to: effectiveTo,
      notes: clean(draft.notes),
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * §6  THE DEADLINE THE ENVELOPE STARTED
 * ══════════════════════════════════════════════════════════════════════════ */

export type AnswerDeadline = {
  readonly orderKind: WageOrderKind;
  readonly servedDate: string;
  /** ISO date the answer is due, or null when the statute does not fix one. */
  readonly dueDate: string | null;
  /** Negative once overdue. Null when there is no computable deadline. */
  readonly daysRemaining: number | null;
  readonly overdue: boolean;
  readonly authorityId: string;
  /** Plain English. Names the consequence, never just the date. */
  readonly whatHappensIfMissed: string;
  readonly explanation: string;
};

/** Days between two ISO dates. Pure; both sides are arguments. */
function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.UTC(
    Number.parseInt(fromIso.slice(0, 4), 10),
    Number.parseInt(fromIso.slice(5, 7), 10) - 1,
    Number.parseInt(fromIso.slice(8, 10), 10),
  );
  const b = Date.UTC(
    Number.parseInt(toIso.slice(0, 4), 10),
    Number.parseInt(toIso.slice(5, 7), 10) - 1,
    Number.parseInt(toIso.slice(8, 10), 10),
  );
  return Math.round((b - a) / 86_400_000);
}

/** Add whole days to an ISO date, returning ISO. */
function addDays(iso: string, days: number): string {
  const d = new Date(
    Date.UTC(
      Number.parseInt(iso.slice(0, 4), 10),
      Number.parseInt(iso.slice(5, 7), 10) - 1,
      Number.parseInt(iso.slice(8, 10), 10),
    ),
  );
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** RCW 26.18.110(1). Twenty days, from SERVICE. */
export const SUPPORT_ANSWER_DAYS = 20;

/**
 * When must this order be answered, and what happens if it is not.
 *
 * CREDITOR WRITS DELIBERATELY RETURN A NULL DEADLINE. RCW 6.27.200 measures
 * the deadline as "the time prescribed in the writ" - it is printed on the
 * paper and it is not always twenty days. Computing one anyway would be
 * inventing a default (rule 62d) about the date a default judgment for
 * somebody else's entire debt becomes available. So the honest answer is
 * "read the writ", said loudly, rather than a confident wrong date.
 *
 * @param today ISO date. An ARGUMENT, never the system clock, so the caller
 *        owns the definition of "now" and every branch is testable.
 */
export function answerDeadlineFor(
  orderKind: WageOrderKind,
  servedDate: string,
  today: string,
): AnswerDeadline {
  if (isSupportOrder(orderKind)) {
    const dueDate = addDays(servedDate, SUPPORT_ANSWER_DAYS);
    const daysRemaining = daysBetween(today, dueDate);
    return {
      orderKind,
      servedDate,
      dueDate,
      daysRemaining,
      overdue: daysRemaining < 0,
      authorityId: "wage-order-rcw-26-18-110-answer",
      whatHappensIfMissed:
        "Failing to answer is its own independent route to liability under RCW 26.18.110(6)(b) - " +
        "Greenway can be held liable for 100% of the support debt, plus costs, interest and the " +
        "other side's attorney fees. Withholding correctly does not cure a missing answer.",
      explanation:
        `Served ${servedDate}. RCW 26.18.110(1) requires an answer by sworn affidavit within ` +
        `twenty days of service, so the answer is due ${dueDate}. The affidavit must say whether ` +
        "this person works here, whether Greenway will honour the order, and whether there are " +
        "other support attachments already running against them.",
    };
  }

  return {
    orderKind,
    servedDate,
    dueDate: null,
    daysRemaining: null,
    overdue: false,
    authorityId: "wage-order-rcw-6-27-200-default",
    whatHappensIfMissed:
      "If the writ is not answered in time the court may enter judgment against GREENWAY for the " +
      "full amount the employee owes - not the part you should have withheld, the whole debt, " +
      "with interest and costs. There is a seven-day relief window after the execution writ, but " +
      "it requires you to notice and move.",
    explanation:
      `Served ${servedDate}. RCW 6.27.200 measures this deadline as "the time prescribed in the ` +
      'writ" - it is printed on the document itself and is not always twenty days. This system ' +
      "will not invent one for you. Read the deadline off the writ and diary it today.",
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * §7  WHEN DOES THIS STOP?
 * ══════════════════════════════════════════════════════════════════════════ */

export type ExpiryOutlook = {
  readonly orderKind: WageOrderKind;
  readonly expires: boolean;
  /** Latest ISO date the lien can still run, when one is computable. */
  readonly latestPossibleEnd: string | null;
  readonly authorityId: string;
  readonly explanation: string;
};

/** RCW 6.27.350(1). Sixty days from the effective date. */
export const CREDITOR_LIEN_DAYS = 60;

/**
 * Does this order stop by itself, and if so when at the latest?
 *
 * The asymmetry here is the single most common source of both errors in this
 * area: stopping a support order that should have continued, and continuing
 * a creditor lien that expired two months ago.
 */
export function expiryOutlookFor(orderKind: WageOrderKind, effectiveFrom: string): ExpiryOutlook {
  if (orderKind === "creditor" || orderKind === "consumer_debt") {
    return {
      orderKind,
      expires: true,
      latestPossibleEnd: addDays(effectiveFrom, CREDITOR_LIEN_DAYS),
      authorityId: "wage-order-rcw-6-27-350-sixty-days",
      explanation:
        `This lien ends when the writ amount is collected OR at the payroll period ending on or ` +
        `before ${addDays(effectiveFrom, CREDITOR_LIEN_DAYS)} - sixty days after the effective ` +
        "date - whichever comes first. It also ends early if the employee leaves, or if the " +
        "judgment is vacated, satisfied or the writ dismissed. Keep withholding past the end and " +
        "you are taking money with no authority, which is RCW 49.52.050 territory and reaches " +
        "officers personally.",
    };
  }

  if (isSupportOrder(orderKind)) {
    return {
      orderKind,
      expires: false,
      latestPossibleEnd: null,
      authorityId: "wage-order-rcw-26-18-110-answer",
      explanation:
        "A support order does NOT expire on its own. Under RCW 26.18.110(3) you keep withholding " +
        "until the court tells you it is modified or terminated, or the state support registry " +
        "tells you the debt is paid. If the employee leaves, tell the addressee promptly - and " +
        "note the order stays live for a year afterwards, so if they come back you resume at once.",
    };
  }

  return {
    orderKind,
    expires: false,
    latestPossibleEnd: null,
    authorityId: "wage-order-rcw-6-27-350-sixty-days",
    explanation:
      "This kind of order does not carry the sixty-day continuing-lien clock that an ordinary " +
      "creditor writ does. Tax levies in particular run until the issuing agency releases them " +
      "in writing. Do not stop on your own initiative - get the release and keep it.",
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * §8  THE PROCESSING FEE - offered, never taken silently
 * ══════════════════════════════════════════════════════════════════════════ */

/** RCW 26.18.110(4). Ten dollars first, one dollar after. */
export const FIRST_DISBURSEMENT_FEE_CENTS = 1000;
export const SUBSEQUENT_DISBURSEMENT_FEE_CENTS = 100;

export type ProcessingFeeGuidance = {
  readonly maximumCents: number;
  readonly isFirstDisbursement: boolean;
  readonly authorityId: string;
  readonly explanation: string;
};

/**
 * The most Greenway may charge for handling this disbursement.
 *
 * Returns a CEILING and an explanation, never a decision. Michael has said he
 * gives more than the minimum on demand; whether to charge a garnished
 * employee ten dollars is a judgement call that belongs to him, and a system
 * that quietly took it would be making that call on his behalf.
 */
export function processingFeeGuidance(isFirstDisbursement: boolean): ProcessingFeeGuidance {
  return {
    maximumCents: isFirstDisbursement
      ? FIRST_DISBURSEMENT_FEE_CENTS
      : SUBSEQUENT_DISBURSEMENT_FEE_CENTS,
    isFirstDisbursement,
    authorityId: "wage-order-rcw-26-18-110-fee",
    explanation: isFirstDisbursement
      ? "RCW 26.18.110(4) lets you deduct up to $10.00 for the FIRST disbursement to the support " +
        "registry. It comes out of what is left after the withholding, and the statute expressly " +
        "allows it to reach into the otherwise-exempt remainder. You MAY charge it; nothing " +
        "requires you to."
      : "RCW 26.18.110(4) lets you deduct up to $1.00 for each disbursement after the first. Same " +
        "rules: it comes from the remainder after withholding, it may reach the exempt portion, " +
        "and it is optional.",
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * §9  PARITY WITH THE DATABASE - so the two cannot drift apart
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Each CHECK constraint in migration 0198 paired with the refusal code that
 * must fire BEFORE the database ever sees the row.
 *
 * This exists so a test can prove the friendly layer still covers the
 * load-bearing one. If someone adds a constraint to 0198 and not a refusal
 * here, the pairing test is where they find out - rather than Michael
 * finding out via a raw Postgres error string on a Friday afternoon.
 */
export const WAGE_ORDER_CONSTRAINT_PARITY: readonly {
  readonly constraint: string;
  readonly refusal: WageOrderRefusalCode;
  readonly why: string;
}[] = [
  {
    constraint: "wage_orders_states_one_measure",
    refusal: "TWO_MEASURES",
    why: "The XOR between a fixed amount and a percentage. A row satisfying neither or both means two contradictory things.",
  },
  {
    constraint: "wage_orders_support_needs_family_answer",
    refusal: "SUPPORT_NEEDS_SECOND_FAMILY_ANSWER",
    why: "A support order with no answer on the second-family question cannot pick between a 50% and a 60% ceiling.",
  },
  {
    constraint: "wage_orders_dates_ordered",
    refusal: "EFFECTIVE_DATES_REVERSED",
    why: "effective_to must not precede effective_from.",
  },
  {
    constraint: "wage_orders_one_live_per_case",
    refusal: "DUPLICATE_CASE_NUMBER",
    why: "The unique index that stops a re-entered writ from withholding twice.",
  },
] as const;

/* ═══════════════════════════════════════════════════════════════════════════
 * THE EMPLOYEE PICKER'S SHAPE
 *
 * WHY THIS LIVES HERE AND NOT IN THE STORE OR THE FORM
 *
 * Two modules need to agree on it: the server store that reads employees out
 * of the table, and the client form that renders them in a dropdown. It was
 * originally declared in BOTH, which is standing rule 25's exact failure mode
 * - the day a field is added to one copy, the other keeps compiling and the
 * two quietly mean different things.
 *
 * It cannot live in the store, because the store is `import "server-only"` and
 * the form is `"use client"`; importing it would drag the Supabase admin
 * client into the browser bundle (rule 65b). It cannot live in the form,
 * because then a server module would import a `"use client"` module to get a
 * type. This file is pure, node-free and already imported by both sides, so
 * this is the one place the definition can sit without either problem.
 *
 * `active` is on here deliberately. See `listEmployeesForOrderEntry` for why a
 * former employee must still be selectable rather than filtered away.
 * ═══════════════════════════════════════════════════════════════════════════ */

export type EmployeeChoice = {
  readonly id: string;
  readonly name: string;
  /**
   * False when the employee has been marked inactive in Staffing.
   *
   * NOT a reason to hide them. RCW 26.18.110(1) requires the answer to state
   * "whether the obligor is employed by ... the employer" - which means an
   * order served naming somebody who has left still has to be answered, and
   * answered with a NO. The screen's job is to make that answer easy to give
   * correctly, not to pretend the person never existed.
   */
  readonly active: boolean;
};

/**
 * Every refusal code, for the coverage gate.
 *
 * A runtime array as well as a type, precisely because books-37 hit the case
 * where only a TYPE existed and no test could enumerate it (rule 43).
 */
export const ALL_WAGE_ORDER_REFUSAL_CODES: readonly WageOrderRefusalCode[] = [
  "NO_EMPLOYEE",
  "UNKNOWN_ORDER_KIND",
  "NO_CASE_NUMBER",
  "NO_ISSUING_AUTHORITY",
  "NO_PAYEE",
  "NO_ORDER_DATE",
  "BAD_ORDER_DATE",
  "NO_SERVED_DATE",
  "BAD_SERVED_DATE",
  "SERVED_BEFORE_ORDERED",
  "NO_MEASURE",
  "TWO_MEASURES",
  "BAD_AMOUNT",
  "AMOUNT_NOT_POSITIVE",
  "BAD_PERCENT",
  "PERCENT_OUT_OF_RANGE",
  "BAD_ARREARS",
  "ARREARS_NEGATIVE",
  "SUPPORT_NEEDS_SECOND_FAMILY_ANSWER",
  "SUPPORT_NEEDS_ARREARS_AGE_ANSWER",
  "BAD_PRIORITY",
  "PRIORITY_NOT_POSITIVE",
  "NO_EFFECTIVE_FROM",
  "BAD_EFFECTIVE_FROM",
  "BAD_EFFECTIVE_TO",
  "EFFECTIVE_DATES_REVERSED",
  "DUPLICATE_CASE_NUMBER",
] as const;
