/**
 * src/lib/payroll/payroll-w4-core.ts  (books-13)
 *
 * THE W-4 RECORD: what we capture from an employee, and what we refuse to guess.
 *
 * Michael asked for "a way to setup payroll for my employees using their w-4
 * data." This file is that data model. It is deliberately separate from the
 * arithmetic (payroll-withholding-core.ts) because the two rot differently: the
 * tables change every January, but what a W-4 *is* changes about once a decade.
 *
 * TWO ERAS OF FORM W-4. The 2020 redesign deleted withholding allowances. Both
 * eras are still legally live — Pub. 15-T says the percentage method "works for
 * Forms W-4 for all prior, current, and future years" — so an employee hired in
 * 2015 who never refiled is still on the old form, and we must handle it. We do
 * NOT force anyone to refile; the IRS does not require it and telling Michael
 * otherwise would be inventing an obligation.
 *
 * All money is INTEGER CENTS. Float is forbidden in money paths (Rule 13e).
 * PURE — no I/O, no server imports.
 */

// ---------------------------------------------------------------------------
// 1) FILING STATUS
// ---------------------------------------------------------------------------

/**
 * The three withholding schedules in Pub. 15-T. These are WITHHOLDING statuses,
 * not the full set of filing statuses on a 1040 — "qualifying surviving spouse"
 * uses the married-filing-jointly schedule, which is why it is not listed here.
 */
export type W4FilingStatus =
  | "married_filing_jointly"
  | "single_or_married_filing_separately"
  | "head_of_household";

export const ALL_W4_FILING_STATUSES: readonly W4FilingStatus[] = [
  "married_filing_jointly",
  "single_or_married_filing_separately",
  "head_of_household",
] as const;

/** Labels for the UI so a select never shows a raw enum. */
export const W4_FILING_STATUS_LABELS: Record<W4FilingStatus, string> = {
  married_filing_jointly: "Married filing jointly (or qualifying surviving spouse)",
  single_or_married_filing_separately: "Single or married filing separately",
  head_of_household: "Head of household",
};

// ---------------------------------------------------------------------------
// 2) PAY FREQUENCY  (Pub. 15-T Table 3)
// ---------------------------------------------------------------------------

export type PayFrequency =
  | "weekly"
  | "biweekly"
  | "semimonthly"
  | "monthly"
  | "quarterly"
  | "semiannually"
  | "daily";

/**
 * VERBATIM from Pub. 15-T (2026) Table 3. These are not "about" numbers — the
 * whole worksheet annualizes and de-annualizes through them, so an off-by-one
 * here silently mis-withholds every paycheck of the year.
 *
 * The classic error is treating semimonthly (24) and biweekly (26) as the same
 * thing. They are not. Twice a month is 24; every two weeks is 26.
 */
export const PAY_PERIODS_PER_YEAR: Record<PayFrequency, number> = {
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
  quarterly: 4,
  semiannually: 2,
  daily: 260,
};

export const PAY_FREQUENCY_LABELS: Record<PayFrequency, string> = {
  weekly: "Weekly (52 per year)",
  biweekly: "Every two weeks (26 per year)",
  semimonthly: "Twice a month (24 per year)",
  monthly: "Monthly (12 per year)",
  quarterly: "Quarterly (4 per year)",
  semiannually: "Twice a year (2 per year)",
  daily: "Daily (260 per year)",
};

// ---------------------------------------------------------------------------
// 3) THE W-4 RECORD
// ---------------------------------------------------------------------------

/**
 * The first year of the redesigned form. An employee's most recent W-4 is either
 * from this year or later ("modern") or before it ("legacy", allowance-based).
 */
export const W4_REDESIGN_YEAR = 2020;

export type W4Record = {
  employeeId: string;

  /**
   * The YEAR PRINTED ON THE FORM the employee actually signed — not the year we
   * keyed it in. This single field decides which half of Worksheet 1A runs, so
   * it must come off the paper, never from `new Date()`.
   */
  formYear: number;

  /** Step 1(c) on a modern form; "marital status" line 3 on a legacy form. */
  filingStatus: W4FilingStatus;

  // --- modern (2020+) fields ------------------------------------------------
  /** Step 2 checkbox: multiple jobs / spouse works. Raises withholding. */
  step2MultipleJobs: boolean;
  /** Step 3: total annual credit for dependents and other credits. */
  step3AnnualCreditCents: number;
  /** Step 4(a): other income (not from jobs) expected this year. */
  step4aOtherIncomeAnnualCents: number;
  /** Step 4(b): deductions beyond the standard deduction. */
  step4bDeductionsAnnualCents: number;
  /** Step 4(c): extra withholding the employee wants PER PAY PERIOD. */
  step4cExtraPerPeriodCents: number;

  // --- legacy (pre-2020) field ----------------------------------------------
  /** Withholding allowances. Only meaningful when formYear < 2020. */
  legacyAllowances: number | null;

  /**
   * Exemption from federal income tax withholding (2026: a checkbox below Step
   * 4(c); before that, the employee wrote "Exempt").
   *
   * ⚠ THIS EXEMPTS FEDERAL INCOME TAX ONLY. It does NOT exempt Social Security
   * or Medicare. See PUB15T_EXEMPT_IS_INCOME_TAX_ONLY. The withholding engine
   * enforces this and there is a test that fails if anyone ever "simplifies" it.
   */
  exemptFromFederalIncomeTax: boolean;

  /**
   * When the employee signed under penalty of perjury. NULL means unsigned.
   *
   * An unsigned W-4 is not a W-4. Pub. 15-T's rules for electronic substitute
   * forms require the perjury statement to be the FINAL entry the employee
   * makes, so a record with data but no signature is an incomplete submission,
   * not a usable form — and we treat it as "no W-4 on file" rather than
   * silently honoring unsigned elections.
   */
  signedAt: string | null;
};

/** Is this form from the 2020 redesign or later? */
export function isModernW4(record: Pick<W4Record, "formYear">): boolean {
  return record.formYear >= W4_REDESIGN_YEAR;
}

/**
 * THE NO-W-4 DEFAULT, from Pub. 15-T:
 *   "treated as if they had checked the box for Single or Married filing
 *    separately in Step 1(c) and made no entries in Step 2, Step 3, or Step 4"
 *
 * We build it explicitly rather than letting zeros fall out of an empty object,
 * because this default has a real consequence for the employee — it is close to
 * the highest withholding there is — and it must be visible in the code and on
 * the screen, not implied.
 */
export function defaultW4WhenNoneFurnished(employeeId: string, formYear: number): W4Record {
  return {
    employeeId,
    formYear,
    filingStatus: "single_or_married_filing_separately",
    step2MultipleJobs: false,
    step3AnnualCreditCents: 0,
    step4aOtherIncomeAnnualCents: 0,
    step4bDeductionsAnnualCents: 0,
    step4cExtraPerPeriodCents: 0,
    legacyAllowances: null,
    exemptFromFederalIncomeTax: false,
    signedAt: null,
  };
}

// ---------------------------------------------------------------------------
// 4) VALIDATION
// ---------------------------------------------------------------------------

export type W4ValidationIssue = {
  field: string;
  /** "block" = we will not use this record. "warn" = usable but say something. */
  severity: "block" | "warn";
  message: string;
  /** Authority id in payroll-tax-authorities, when one applies. */
  authorityId?: string;
};

export type W4Validation = {
  ok: boolean;
  issues: W4ValidationIssue[];
};

/**
 * Validate a captured W-4.
 *
 * Design note on severity: a MISSING SIGNATURE blocks, because an unsigned form
 * is not a form. A LEGACY form only warns, because there is nothing wrong with
 * it — the IRS still honors it, and nagging Michael to chase paperwork the law
 * does not require would be inventing an obligation (Rule 1).
 */
export function validateW4(record: W4Record): W4Validation {
  const issues: W4ValidationIssue[] = [];

  const cents = (v: number, field: string, label: string) => {
    if (!Number.isFinite(v) || !Number.isInteger(v)) {
      issues.push({
        field,
        severity: "block",
        message: `${label} must be a whole number of cents. Fractional cents cannot be withheld or reported.`,
      });
      return;
    }
    if (v < 0) {
      issues.push({
        field,
        severity: "block",
        message:
          `${label} cannot be negative. A W-4 can only ever increase or leave withholding alone — ` +
          `there is no line on the form that reduces it below the table amount. If you are trying to ` +
          `give someone back money that was over-withheld, that is a payroll correction, not a W-4 entry.`,
      });
    }
  };

  if (!record.employeeId || record.employeeId.trim() === "") {
    issues.push({ field: "employeeId", severity: "block", message: "A W-4 must belong to an employee." });
  }

  if (!Number.isInteger(record.formYear) || record.formYear < 1900 || record.formYear > 2200) {
    issues.push({
      field: "formYear",
      severity: "block",
      message:
        "Enter the year printed on the form the employee signed. This decides which set of IRS rules " +
        "applies to them, so it has to come off the paper rather than being assumed.",
    });
  }

  if (!ALL_W4_FILING_STATUSES.includes(record.filingStatus)) {
    issues.push({ field: "filingStatus", severity: "block", message: "Choose a filing status from the form." });
  }

  cents(record.step3AnnualCreditCents, "step3AnnualCreditCents", "Step 3 credits");
  cents(record.step4aOtherIncomeAnnualCents, "step4aOtherIncomeAnnualCents", "Step 4(a) other income");
  cents(record.step4bDeductionsAnnualCents, "step4bDeductionsAnnualCents", "Step 4(b) deductions");
  cents(record.step4cExtraPerPeriodCents, "step4cExtraPerPeriodCents", "Step 4(c) extra withholding");

  const modern = isModernW4(record);

  if (modern) {
    if (record.legacyAllowances !== null) {
      issues.push({
        field: "legacyAllowances",
        severity: "block",
        message:
          "This form is from 2020 or later, and the redesigned W-4 has no allowances on it at all — " +
          "the IRS removed them. Recording an allowance count here would mean we are reading a number " +
          "off a form that does not have that number on it.",
        authorityId: "pub15t-2026-automated-method",
      });
    }
  } else {
    // Legacy form.
    if (record.legacyAllowances === null) {
      issues.push({
        field: "legacyAllowances",
        severity: "block",
        message:
          "This form is from before 2020, so it claims a number of withholding allowances. That number " +
          "is required to compute withholding for this employee.",
      });
    } else if (!Number.isInteger(record.legacyAllowances) || record.legacyAllowances < 0) {
      issues.push({
        field: "legacyAllowances",
        severity: "block",
        message: "Allowances must be a whole number, zero or more.",
      });
    }

    if (record.step2MultipleJobs) {
      issues.push({
        field: "step2MultipleJobs",
        severity: "block",
        message:
          "The Step 2 checkbox only exists on the 2020-and-later form. It cannot be checked on an older " +
          "one, and Pub. 15-T runs a different calculation for these forms entirely.",
      });
    }

    if (record.filingStatus === "head_of_household") {
      issues.push({
        field: "filingStatus",
        severity: "block",
        message:
          "Head of household is not an option on a pre-2020 W-4 — that form only had single and married. " +
          "The IRS says in Pub. 15-T: \"Don't use the Head of Household table if the Form W-4 is from " +
          "2019 or earlier.\" If this employee wants head-of-household withholding, they need to give " +
          "you a current W-4.",
        authorityId: "pub15t-2026-automated-method",
      });
    }

    issues.push({
      field: "formYear",
      severity: "warn",
      message:
        "This employee is still on a pre-2020 W-4. That is perfectly legal and you do not have to make " +
        "them refile — the IRS still honors it. Just know their withholding is computed a different way " +
        "than everyone else's, using allowances the current form no longer has.",
    });
  }

  if (!record.signedAt) {
    issues.push({
      field: "signedAt",
      severity: "block",
      message:
        "This W-4 has not been signed. A W-4 is signed under penalty of perjury, and until it is signed " +
        "it is a draft, not a form. We will withhold at the no-W-4 default (single, nothing claimed) " +
        "until the employee signs it — and that usually means MORE tax out of their check, so it is " +
        "worth telling them.",
      authorityId: "pub15t-2026-no-w4-default",
    });
  }

  if (record.exemptFromFederalIncomeTax) {
    issues.push({
      field: "exemptFromFederalIncomeTax",
      severity: "warn",
      message:
        "This employee claims exemption from federal income tax withholding. That is their call to make, " +
        "not yours. But be clear on what it does and does not do: it stops FEDERAL INCOME TAX only. " +
        "Social Security and Medicare still come out of every check, and you still owe your employer " +
        "half. Anyone who tells you 'exempt means no payroll taxes' is wrong.",
      authorityId: "pub15t-2026-exempt-scope",
    });
  }

  return { ok: !issues.some((i) => i.severity === "block"), issues };
}

/**
 * Should we use this record, or fall back to the no-W-4 default?
 *
 * This is the seam where an unsigned or invalid form quietly becomes the IRS
 * default instead of quietly becoming zeros. Returning the reason alongside the
 * record is deliberate: the UI is required to SAY which one it used.
 */
export function effectiveW4(
  record: W4Record | null,
  employeeId: string,
  currentYear: number,
): { record: W4Record; usedDefault: boolean; reason: string | null } {
  if (!record) {
    return {
      record: defaultW4WhenNoneFurnished(employeeId, currentYear),
      usedDefault: true,
      reason:
        "No W-4 on file. The IRS tells us exactly what to do here: withhold as single with nothing " +
        "claimed. That is a high rate — get the form signed and it will usually come down.",
    };
  }
  const v = validateW4(record);
  if (!v.ok) {
    const blocking = v.issues.filter((i) => i.severity === "block").map((i) => i.message);
    return {
      record: defaultW4WhenNoneFurnished(employeeId, currentYear),
      usedDefault: true,
      reason:
        "This employee's W-4 can't be used yet, so we're withholding at the IRS default (single, " +
        "nothing claimed) until it's fixed: " + blocking.join(" "),
    };
  }
  return { record, usedDefault: false, reason: null };
}

// ---------------------------------------------------------------------------
// 5) SELF-TESTS
// ---------------------------------------------------------------------------

export function __runPayrollW4CoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const check = (name: string, cond: boolean) => {
    if (cond) passed++;
    else {
      failed++;
      // eslint-disable-next-line no-console
      console.error(`payroll-w4-core self-test FAILED: ${name}`);
    }
  };

  check("biweekly is 26", PAY_PERIODS_PER_YEAR.biweekly === 26);
  check("semimonthly is 24", PAY_PERIODS_PER_YEAR.semimonthly === 24);
  check("biweekly !== semimonthly", PAY_PERIODS_PER_YEAR.biweekly !== PAY_PERIODS_PER_YEAR.semimonthly);
  check("daily is 260", PAY_PERIODS_PER_YEAR.daily === 260);

  const def = defaultW4WhenNoneFurnished("e1", 2026);
  check("default is single/MFS", def.filingStatus === "single_or_married_filing_separately");
  check("default claims nothing", def.step3AnnualCreditCents === 0 && def.step4aOtherIncomeAnnualCents === 0);
  check("default is not exempt", def.exemptFromFederalIncomeTax === false);

  check("2020 is modern", isModernW4({ formYear: 2020 }));
  check("2019 is legacy", !isModernW4({ formYear: 2019 }));

  const signedModern: W4Record = { ...def, signedAt: "2026-01-05T00:00:00Z" };
  check("signed modern default validates", validateW4(signedModern).ok);

  check("unsigned blocks", !validateW4(def).ok);

  const modernWithAllowances: W4Record = { ...signedModern, legacyAllowances: 2 };
  check("modern form rejects allowances", !validateW4(modernWithAllowances).ok);

  const legacyHoh: W4Record = { ...signedModern, formYear: 2019, legacyAllowances: 1, filingStatus: "head_of_household" };
  check("legacy rejects head of household", !validateW4(legacyHoh).ok);

  const legacyOk: W4Record = { ...signedModern, formYear: 2019, legacyAllowances: 1 };
  check("legacy with allowances validates", validateW4(legacyOk).ok);
  check("legacy warns about old form", validateW4(legacyOk).issues.some((i) => i.severity === "warn"));

  const negative: W4Record = { ...signedModern, step4cExtraPerPeriodCents: -100 };
  check("negative W-4 amount blocks", !validateW4(negative).ok);

  const fractional: W4Record = { ...signedModern, step3AnnualCreditCents: 1.5 };
  check("fractional cents block", !validateW4(fractional).ok);

  const eff = effectiveW4(null, "e9", 2026);
  check("null W-4 falls back to default", eff.usedDefault && eff.reason !== null);

  const eff2 = effectiveW4(signedModern, "e1", 2026);
  check("valid W-4 is used as-is", !eff2.usedDefault && eff2.reason === null);

  const eff3 = effectiveW4(def, "e1", 2026);
  check("unsigned W-4 falls back to default", eff3.usedDefault);

  return { passed, failed };
}
