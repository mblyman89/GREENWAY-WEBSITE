/**
 * src/lib/accounting/company-identity-core.ts   (books-31)
 *
 * THE FIELD REGISTRY, THE VALIDATORS, AND THE ONE QUESTION THAT MATTERS:
 * CAN THIS FORM BE FILED WITH WHAT IS ON FILE?
 *
 * Michael's instruction for this slice was explicit about direction of travel:
 *
 *   "Since this info will be used to fill all the forms and whatever else it's
 *    used for, I want to make sure we are building forward thinking so
 *    everything downstream from this info page will flow into all the reports
 *    and forms. Please begin mindful of this when building."
 *
 * STANDING RULE 62 IS THE WHOLE DESIGN. Every field below names the forms that
 * consume it, in data, not in a comment a form builder cannot read. That single
 * decision is what makes `formReadiness()` possible: nothing here contains a
 * list of "fields Form 941 needs". The 941's requirements are DERIVED by asking
 * which fields declare 941 as a consumer. Add a field, declare its consumers,
 * and every affected form's readiness updates itself. Add a form to a field's
 * consumer list and the same thing happens. There is no second list to forget.
 *
 * STANDING RULE 62d IS ENFORCED HERE TOO: no downstream consumer may invent a
 * default. `requireField` REFUSES and names the missing field rather than
 * returning an empty string, because an empty string on a Form 941 is a
 * rejected return that looks like a filed one.
 *
 * WHAT THIS MODULE IS NOT. It is not a duplicate store. The database owns the
 * values (0196_company_profile.sql) and `ach_company_settings` /
 * `license_settings` keep owning what they already owned. This module is the
 * meaning layer: what each field is, which form eats it, whether it is present,
 * and whether it is well-formed.
 */

import { COMPANY_IDENTITY_AUTHORITIES } from "@/lib/accounting/company-identity-authorities";

/* ══════════════════════════════════════════════════════════════════════════ *
 * THE FORMS
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Every form or output this system will fill from the company profile.
 *
 * Declared as a closed union so a typo in a consumer list cannot compile. A
 * field claiming to feed "Form 9411" would silently create a form nobody ever
 * checks readiness for, which is the quiet failure mode rule 62 exists to stop.
 *
 * NACHA and EFTPS are in the list even though they are not IRS forms, because
 * they consume the same identity fields and Michael's directive was that the
 * ACH pipeline must be connected end to end. A file transmitted to a bank with
 * the wrong company identification is exactly as broken as a wrong 941.
 */
export const COMPANY_FORMS = [
  "form-941",
  "form-941-schedule-b",
  "form-940",
  "form-w-2",
  "form-w-3",
  "form-1099-nec",
  "wa-form-5208",
  "wa-lni-quarterly",
  "nacha-payroll",
  "eftps-deposit",
] as const;

export type CompanyForm = (typeof COMPANY_FORMS)[number];

/** Human-readable form names, for the mentor and the screen. */
export const FORM_TITLES: Readonly<Record<CompanyForm, string>> = {
  "form-941": "Form 941, Employer's QUARTERLY Federal Tax Return",
  "form-941-schedule-b": "Schedule B (Form 941), Report of Tax Liability for Semiweekly Schedule Depositors",
  "form-940": "Form 940, Employer's Annual Federal Unemployment (FUTA) Tax Return",
  "form-w-2": "Form W-2, Wage and Tax Statement",
  "form-w-3": "Form W-3, Transmittal of Wage and Tax Statements",
  "form-1099-nec": "Form 1099-NEC, Nonemployee Compensation",
  "wa-form-5208": "WA Form 5208A/B, ESD Quarterly Wage Detail and Tax Report",
  "wa-lni-quarterly": "WA L&I Quarterly Report",
  "nacha-payroll": "NACHA ACH file (direct deposit)",
  "eftps-deposit": "EFTPS federal tax deposit",
};

/* ══════════════════════════════════════════════════════════════════════════ *
 * THE FIELD REGISTRY
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * How a missing value should be treated for a given form.
 *
 * THREE LEVELS AND NOT TWO, because "required" and "optional" cannot express
 * the trade name. A trade name is not required - the instructions say to leave
 * the line blank when it equals the legal name - but a MISSING trade name for a
 * business that trades under a different name is a real defect. That is
 * `conditional`, and collapsing it into either of the other two would either
 * block filing for no reason or hide a genuine problem.
 */
/**
 * Every value `company_profile.entity_type` accepts, in the same order as the
 * migration's check constraint.
 *
 * TRANSCRIBED FROM `0196_company_profile.sql`, not invented here. It exists so
 * that `assertEverySignerRuleExists` can prove the code answers the signer
 * question for every classification the database can hold. Standing rule 62:
 * the next slice builds the 941 signature block, and it will read this.
 */
export const STORABLE_ENTITY_TYPES = [
  "sole_proprietor",
  "partnership",
  "c_corp",
  "s_corp",
  "llc_s_corp",
  "llc_c_corp",
  "llc_partnership",
  "llc_disregarded",
  "trust_or_estate",
] as const;

export type StorableEntityType = (typeof STORABLE_ENTITY_TYPES)[number];

export type FieldNecessity = "required" | "conditional" | "optional";

export type CompanyFieldSpec = {
  /** Column name in public.company_profile. */
  readonly field: string;
  /** What a human calls it. */
  readonly label: string;
  /**
   * Which forms read this field, and how badly they need it.
   *
   * STANDING RULE 62e IN DATA FORM. This is the only place the relationship is
   * recorded, so it cannot disagree with itself.
   */
  readonly consumers: readonly { readonly form: CompanyForm; readonly necessity: FieldNecessity }[];
  /** Authority ids from company-identity-authorities.ts justifying the field. */
  readonly authorityIds: readonly string[];
  /** Shape rule, when the field has one. Null when any text is acceptable. */
  readonly pattern: RegExp | null;
  /** What to say when the pattern fails. Written for Michael, not for a log. */
  readonly patternHelp: string | null;
};

/**
 * EVERY company-profile field this system will read, with its consumers.
 *
 * Ordering follows the screen, which follows the forms: federal identity, then
 * address, then contact, then signature, then state, then calendar.
 */
export const COMPANY_FIELDS: readonly CompanyFieldSpec[] = [
  {
    field: "ein",
    label: "Employer Identification Number (EIN)",
    consumers: [
      { form: "form-941", necessity: "required" },
      { form: "form-941-schedule-b", necessity: "required" },
      { form: "form-940", necessity: "required" },
      { form: "form-w-2", necessity: "required" },
      { form: "form-w-3", necessity: "required" },
      { form: "form-1099-nec", necessity: "required" },
      { form: "nacha-payroll", necessity: "required" },
      { form: "eftps-deposit", necessity: "required" },
    ],
    authorityIds: [
      "pub15-2026-ein-nine-digit",
      "pub15-2026-only-one-ein",
      "pub15-2026-dont-use-ssn-as-ein",
      "i941-2026-efile-requires-valid-ein",
      "i941-2026-ein-identifies-taxpayer",
      "i941-2026-ein-must-match-exactly",
      "iw2w3-2026-box-b-ein",
      "iw2w3-2026-no-truncated-ein",
    ],
    pattern: /^[0-9]{9}$/,
    patternHelp:
      "Nine digits, no hyphen. The IRS prints it as 00-0000000 and this system adds the hyphen when it " +
      "renders a form, so only the digits are stored.",
  },
  {
    field: "legal_name",
    label: "Legal business name (as on Form SS-4)",
    consumers: [
      { form: "form-941", necessity: "required" },
      { form: "form-940", necessity: "required" },
      { form: "form-w-2", necessity: "required" },
      { form: "form-w-3", necessity: "required" },
      { form: "form-1099-nec", necessity: "required" },
      { form: "wa-form-5208", necessity: "required" },
      { form: "wa-lni-quarterly", necessity: "required" },
    ],
    authorityIds: [
      "i940-2025-legal-name-from-ss4",
      "i941-2026-legal-name-vs-trade-name",
      "iw2w3-2026-w3-box-f-employer-name",
    ],
    pattern: null,
    patternHelp: null,
  },
  {
    field: "trade_name",
    label: "Trade name (doing business as)",
    consumers: [
      { form: "form-941", necessity: "conditional" },
      { form: "form-940", necessity: "conditional" },
    ],
    authorityIds: ["i941-2026-legal-name-vs-trade-name"],
    pattern: null,
    patternHelp: null,
  },
  {
    field: "entity_type",
    label: "Federal tax classification",
    consumers: [
      { form: "form-941", necessity: "required" },
      { form: "form-940", necessity: "required" },
    ],
    authorityIds: ["i941-2026-signer-corporation", "i941-2026-signer-single-member-llc"],
    pattern: null,
    patternHelp: null,
  },
  {
    field: "federal_return_form",
    label: "Federal employment return the IRS expects (941 or 944)",
    consumers: [
      { form: "form-941", necessity: "required" },
      { form: "form-w-3", necessity: "required" },
    ],
    authorityIds: ["iw2w3-2026-w3-kind-of-payer-941"],
    pattern: /^(941|944)$/,
    patternHelp: "Either 941 or 944. The IRS assigns this by notice; it is not a preference.",
  },
  {
    field: "deposit_schedule",
    label: "Federal deposit schedule (monthly or semiweekly)",
    consumers: [
      { form: "form-941", necessity: "required" },
      { form: "form-941-schedule-b", necessity: "required" },
      { form: "eftps-deposit", necessity: "required" },
    ],
    authorityIds: ["pub15-2026-eft-required"],
    pattern: /^(monthly|semiweekly)$/,
    patternHelp: "Either monthly or semiweekly, determined by the lookback period.",
  },
  {
    field: "address_line1",
    label: "Street address",
    consumers: [
      { form: "form-941", necessity: "required" },
      { form: "form-940", necessity: "required" },
      { form: "form-w-2", necessity: "required" },
      { form: "form-w-3", necessity: "required" },
      { form: "form-1099-nec", necessity: "required" },
    ],
    authorityIds: ["iw2w3-2026-box-c-employer-address"],
    pattern: null,
    patternHelp: null,
  },
  {
    field: "city",
    label: "City",
    consumers: [
      { form: "form-941", necessity: "required" },
      { form: "form-940", necessity: "required" },
      { form: "form-w-2", necessity: "required" },
      { form: "form-w-3", necessity: "required" },
      { form: "form-1099-nec", necessity: "required" },
    ],
    authorityIds: ["iw2w3-2026-box-c-employer-address"],
    pattern: null,
    patternHelp: null,
  },
  {
    field: "state_code",
    label: "State of the mailing address",
    consumers: [
      { form: "form-941", necessity: "required" },
      { form: "form-940", necessity: "required" },
      { form: "form-w-2", necessity: "required" },
      { form: "form-w-3", necessity: "required" },
      { form: "form-1099-nec", necessity: "required" },
    ],
    authorityIds: ["iw2w3-2026-box-c-employer-address"],
    pattern: /^[A-Z]{2}$/,
    patternHelp: "Two capital letters, the USPS abbreviation.",
  },
  {
    field: "zip_code",
    label: "ZIP code",
    consumers: [
      { form: "form-941", necessity: "required" },
      { form: "form-940", necessity: "required" },
      { form: "form-w-2", necessity: "required" },
      { form: "form-w-3", necessity: "required" },
      { form: "form-1099-nec", necessity: "required" },
    ],
    authorityIds: ["iw2w3-2026-box-c-employer-address"],
    pattern: /^[0-9]{5}([0-9]{4})?$/,
    patternHelp: "Five digits, or nine digits for ZIP+4, with no hyphen.",
  },
  {
    field: "contact_name",
    label: "Employer contact person",
    consumers: [{ form: "form-w-3", necessity: "required" }],
    authorityIds: ["iw2w3-2026-w3-contact-person"],
    pattern: null,
    patternHelp: null,
  },
  {
    field: "contact_phone",
    label: "Employer telephone number",
    consumers: [{ form: "form-w-3", necessity: "required" }],
    authorityIds: ["iw2w3-2026-w3-contact-person"],
    pattern: null,
    patternHelp: null,
  },
  {
    field: "contact_email",
    label: "Employer email address",
    consumers: [{ form: "form-w-3", necessity: "required" }],
    authorityIds: ["iw2w3-2026-w3-contact-person"],
    pattern: null,
    patternHelp: null,
  },
  {
    field: "signer_name",
    label: "Name of the person who signs the returns",
    consumers: [
      { form: "form-941", necessity: "required" },
      { form: "form-940", necessity: "required" },
      { form: "form-w-3", necessity: "required" },
    ],
    authorityIds: ["i941-2026-signer-corporation"],
    pattern: null,
    patternHelp: null,
  },
  {
    field: "signer_title",
    label: "Title of the signer",
    consumers: [
      { form: "form-941", necessity: "required" },
      { form: "form-940", necessity: "required" },
      { form: "form-w-3", necessity: "required" },
    ],
    authorityIds: ["i941-2026-signer-corporation", "i941-2026-signer-single-member-llc"],
    pattern: null,
    patternHelp: null,
  },
  {
    field: "esd_account_number",
    label: "WA Employment Security Department account number",
    consumers: [
      { form: "wa-form-5208", necessity: "required" },
      { form: "form-940", necessity: "required" },
    ],
    authorityIds: ["rcw-50-12-070-esd-account-number", "i940-2025-state-reporting-number"],
    pattern: /^[0-9]{3}-[0-9]{6}-[0-9]{2}-[0-9]$/,
    patternHelp: "Format 000-000000-00-0, exactly as the state issues it.",
  },
  {
    field: "wa_ubi",
    label: "WA Unified Business Identifier (UBI)",
    consumers: [{ form: "wa-form-5208", necessity: "optional" }],
    authorityIds: ["rcw-50-12-070-ubi-record"],
    pattern: /^[0-9]{9}$/,
    patternHelp: "Nine digits. Washington prints it with spaces; only the digits are stored.",
  },
  {
    field: "lni_account_number",
    label: "WA Labor & Industries account number",
    consumers: [{ form: "wa-lni-quarterly", necessity: "required" }],
    authorityIds: [],
    pattern: null,
    patternHelp: null,
  },
  {
    field: "lni_risk_class",
    label: "L&I risk classification",
    consumers: [{ form: "wa-lni-quarterly", necessity: "required" }],
    authorityIds: [],
    pattern: null,
    patternHelp: null,
  },
  {
    field: "suta_state_code",
    label: "State whose unemployment tax you pay",
    consumers: [{ form: "form-940", necessity: "required" }],
    authorityIds: ["i940-2025-one-state-abbreviation", "i940-2025-state-reporting-number"],
    pattern: /^[A-Z]{2}$/,
    patternHelp: "Two capital letters. For Greenway this is WA.",
  },
];

/*
 * WHY wslcb_license_number IS NOT IN THE LIST ABOVE, RECORDED BECAUSE IT LOOKS
 * LIKE AN OMISSION.
 *
 * The column exists in public.company_profile - Greenway's licence number is
 * part of who it is, and the identity screen shows it. But NONE of the forms in
 * COMPANY_FORMS consume it: the WSLCB licence feeds CCRS reporting and the
 * cannabis excise return, and `license_settings` (0031) already owns the copy
 * the CCRS exporter reads.
 *
 * The first draft of this file listed it with `consumers: []`, which broke the
 * rule stated at the top of this module: a field whose consumer list is empty
 * is a field that does not belong in a consumer-driven registry. An empty list
 * would also make it invisible to every readiness check while LOOKING like it
 * was covered, which is the worst of both. So it is deliberately absent, and
 * `assertNoFieldWithoutConsumers` below makes that a rule rather than a habit.
 *
 * The same applies to lni_account_number and lni_risk_class in one respect:
 * their `authorityIds` are empty, because no L&I quarterly-report instruction
 * has been mirrored yet. That is honest recorded debt, not an oversight - the
 * fields are real and the WA L&I authority is a later slice's job. Rule 24
 * forbids inventing a citation to fill the gap.
 */


/* ══════════════════════════════════════════════════════════════════════════ *
 * FORMATTING AND VALIDATION
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Render a nine-digit EIN in the IRS printed format.
 *
 * Refuses rather than guessing. Given eight digits it would be trivial to pad,
 * and padding an EIN invents a taxpayer - so a malformed input throws with the
 * value named. The Instructions for Form 941 say the return is not accepted
 * without a valid EIN, so silently producing a plausible one is the worst
 * available behaviour.
 */
export function formatEin(nineDigits: string): string {
  if (!/^[0-9]{9}$/.test(nineDigits)) {
    throw new Error(
      `formatEin: refusing to format "${nineDigits}" as an EIN. An EIN is exactly nine digits with no ` +
        `punctuation. Padding or trimming it here would invent a taxpayer identification number, and the ` +
        `IRS instructions for Form 941 state that a return without a valid EIN is not accepted.`,
    );
  }
  return `${nineDigits.slice(0, 2)}-${nineDigits.slice(2)}`;
}

/**
 * Strip punctuation from an EIN a human typed, WITHOUT accepting nonsense.
 *
 * Deliberately narrow. It removes hyphens and spaces, which is what someone
 * copying from a CP 575 letter will include, and then insists on nine digits.
 * It does not strip letters, because "EIN 46-4217016" losing its letters would
 * produce a number from a label.
 */
export function normaliseEinInput(raw: string): string | null {
  const stripped = raw.replace(/[\s-]/g, "");
  return /^[0-9]{9}$/.test(stripped) ? stripped : null;
}

/**
 * Which persons may sign an employment tax return, given the entity type.
 *
 * Returns the rule in plain words plus the authority that states it. Returns
 * null for an entity type the IRS instructions do not address in the Part 5
 * list, because rule 48 says a check that cannot classify its input must not
 * quietly produce an answer.
 *
 * EVERY VALUE `company_profile.entity_type` ACCEPTS IS HANDLED HERE. The first
 * draft of this function handled only the four corporate cases and the
 * disregarded LLC, returning null for the other four the database happily
 * stores - which would have been rule 48 used as an excuse rather than obeyed.
 * Null is for input the authority does not address, not for cases the author
 * did not finish. A test asserts the two lists agree, so widening the check
 * constraint without widening this function fails the suite.
 */
export function signerRuleFor(entityType: string): { readonly rule: string; readonly authorityId: string } | null {
  switch (entityType) {
    case "sole_proprietor":
      return {
        rule: "The individual who owns the business. There is no officer title to record.",
        authorityId: "i941-2026-signer-sole-proprietor",
      };
    case "partnership":
    case "llc_partnership":
      return {
        rule:
          "A responsible and duly authorised partner, member, or officer having knowledge of its affairs. " +
          "Note the second requirement: authority alone is not enough, the signer must know the affairs " +
          "of the business.",
        authorityId: "i941-2026-signer-partnership",
      };
    case "trust_or_estate":
      return {
        rule: "The fiduciary, and nobody else.",
        authorityId: "i941-2026-signer-trust-or-estate",
      };
    case "c_corp":
    case "s_corp":
    case "llc_s_corp":
    case "llc_c_corp":
      return {
        rule:
          "The president, the vice president, or another principal officer duly authorised to sign. An LLC " +
          "that is treated as a corporation signs under this rule, which is Greenway's situation.",
        authorityId: "i941-2026-signer-corporation",
      };
    case "llc_disregarded":
      return {
        rule: "The owner of the LLC, or a principal officer duly authorised to sign.",
        authorityId: "i941-2026-signer-single-member-llc",
      };
    default:
      return null;
  }
}

/* ══════════════════════════════════════════════════════════════════════════ *
 * READINESS - THE QUESTION THE SCREEN EXISTS TO ANSWER
 * ══════════════════════════════════════════════════════════════════════════ */

export type FieldProblem = {
  readonly field: string;
  readonly label: string;
  readonly necessity: FieldNecessity;
  readonly problem: "missing" | "malformed";
  readonly help: string;
};

export type FormReadiness = {
  readonly form: CompanyForm;
  readonly title: string;
  readonly ready: boolean;
  readonly blockers: readonly FieldProblem[];
  readonly warnings: readonly FieldProblem[];
};

/** A company-profile row as this module reads it: field name to value. */
export type CompanyProfileValues = Readonly<Record<string, string | null | undefined>>;

/**
 * Which fields a given form needs, DERIVED from the consumer declarations.
 *
 * There is no hand-written list of "what Form 941 requires" anywhere in this
 * codebase, and that is the point of rule 62. A second list would be a second
 * thing to forget.
 */
export function fieldsForForm(form: CompanyForm): readonly CompanyFieldSpec[] {
  return COMPANY_FIELDS.filter((f) => f.consumers.some((c) => c.form === form));
}

/** The necessity a specific form attaches to a specific field. */
function necessityFor(spec: CompanyFieldSpec, form: CompanyForm): FieldNecessity | null {
  return spec.consumers.find((c) => c.form === form)?.necessity ?? null;
}

/**
 * Can this form be filled from what is on file?
 *
 * A `required` field that is empty or malformed is a BLOCKER: the form cannot
 * be produced. A `conditional` or `optional` field that is malformed is a
 * WARNING: it will render, but somebody should look at it. A missing optional
 * field is neither, because absence is a legitimate answer.
 *
 * A MALFORMED REQUIRED FIELD IS A BLOCKER AND NOT A WARNING, and that is
 * deliberate. Nine digits that are actually eight will be accepted by this
 * system and rejected by the IRS, which is the worst place to find out.
 */
export function formReadiness(form: CompanyForm, values: CompanyProfileValues): FormReadiness {
  const blockers: FieldProblem[] = [];
  const warnings: FieldProblem[] = [];

  for (const spec of fieldsForForm(form)) {
    const necessity = necessityFor(spec, form);
    if (!necessity) continue;

    const raw = values[spec.field];
    const value = typeof raw === "string" ? raw.trim() : "";

    if (value === "") {
      if (necessity === "required") {
        blockers.push({
          field: spec.field,
          label: spec.label,
          necessity,
          problem: "missing",
          help: `${FORM_TITLES[form]} cannot be produced without ${spec.label}.`,
        });
      } else if (necessity === "conditional") {
        warnings.push({
          field: spec.field,
          label: spec.label,
          necessity,
          problem: "missing",
          help:
            `${spec.label} is blank. That is correct if it genuinely does not apply - the instructions ` +
            `say to leave the trade name line blank when it matches the legal name - but confirm it ` +
            `rather than leaving it by accident.`,
        });
      }
      continue;
    }

    if (spec.pattern && !spec.pattern.test(value)) {
      const problem: FieldProblem = {
        field: spec.field,
        label: spec.label,
        necessity,
        problem: "malformed",
        help: spec.patternHelp ?? `${spec.label} is not in the expected format.`,
      };
      if (necessity === "required") blockers.push(problem);
      else warnings.push(problem);
    }
  }

  return {
    form,
    title: FORM_TITLES[form],
    ready: blockers.length === 0,
    blockers,
    warnings,
  };
}

/** Readiness for every form, for the screen's summary panel. */
export function allFormReadiness(values: CompanyProfileValues): readonly FormReadiness[] {
  return COMPANY_FORMS.map((f) => formReadiness(f, values));
}

/**
 * Read a field that a form builder MUST have, or refuse.
 *
 * STANDING RULE 62d, MADE MECHANICAL. Michael's directive said everything
 * downstream must flow from this page. The failure mode that ruins such a
 * design is a downstream consumer that finds nothing and quietly substitutes
 * `""` or `0`, producing a form that looks filed and is not. This function is
 * the only sanctioned way for a form builder to read a required identity field,
 * and it throws with the field and the form named.
 */
export function requireField(
  values: CompanyProfileValues,
  field: string,
  form: CompanyForm,
): string {
  const spec = COMPANY_FIELDS.find((f) => f.field === field);
  if (!spec) {
    throw new Error(
      `requireField: "${field}" is not a declared company-profile field. Add it to COMPANY_FIELDS with ` +
        `its consumers rather than reading an undeclared column - an undeclared field appears in no ` +
        `readiness check, so nothing would ever tell Michael it was blank.`,
    );
  }
  const raw = values[field];
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value === "") {
    throw new Error(
      `MISSING COMPANY INFORMATION: ${FORM_TITLES[form]} needs ${spec.label} ` +
        `(company_profile.${field}) and it is blank. Refusing to substitute a default. Fill it in on the ` +
        `company information screen and try again.`,
    );
  }
  if (spec.pattern && !spec.pattern.test(value)) {
    throw new Error(
      `MALFORMED COMPANY INFORMATION: ${FORM_TITLES[form]} needs ${spec.label} ` +
        `(company_profile.${field}) and the stored value "${value}" is not in the expected format. ` +
        `${spec.patternHelp ?? ""}`.trim(),
    );
  }
  return value;
}

/* ══════════════════════════════════════════════════════════════════════════ *
 * SELF-CHECKS
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Every authority id named by a field must exist in the registry.
 *
 * Guards the failure mode where a field cites `pub15-2026-ein` - a plausible id
 * that does not exist - and the screen renders a citation with nothing behind
 * it. Rule 39: a citation nobody resolves is not evidence.
 */
export function assertEveryFieldAuthorityExists(): void {
  const known = new Set(COMPANY_IDENTITY_AUTHORITIES.map((a) => a.id));
  if (known.size === 0) {
    throw new Error(
      "COMPANY IDENTITY AUTHORITY CHECK BROKEN: the authority registry is empty, so every citation " +
        "would pass vacuously. A gate that reads nothing approves everything.",
    );
  }
  const dangling: string[] = [];
  for (const f of COMPANY_FIELDS) {
    for (const id of f.authorityIds) {
      if (!known.has(id)) dangling.push(`${f.field} -> ${id}`);
    }
  }
  if (dangling.length > 0) {
    throw new Error(
      `COMPANY FIELDS CITE AUTHORITIES THAT DO NOT EXIST: ${dangling.join(", ")}. A citation with ` +
        `nothing behind it is worse than none, because the reader believes it was checked.`,
    );
  }
}

/**
 * Every form must be reachable from at least one field.
 *
 * A form in COMPANY_FORMS that no field feeds would report `ready: true` with
 * no blockers forever - a green light that means nothing, which is exactly the
 * vacuous pass rule 39 forbids.
 */
export function assertNoFieldWithoutConsumers(): void {
  if (COMPANY_FIELDS.length === 0) {
    throw new Error(
      "COMPANY FIELD REGISTRY IS EMPTY: every readiness check would pass vacuously. A gate that reads " +
        "nothing approves everything.",
    );
  }
  const orphans = COMPANY_FIELDS.filter((f) => f.consumers.length === 0).map((f) => f.field);
  if (orphans.length > 0) {
    throw new Error(
      `COMPANY FIELDS WITH NO CONSUMERS: ${orphans.join(", ")}. This registry is consumer-driven ` +
        `(standing rule 62): a field with an empty consumer list appears in no readiness check, so ` +
        `nothing would ever tell Michael it was blank, while the entry makes it look covered. Either ` +
        `declare which form reads it or leave it out of COMPANY_FIELDS and document why, as ` +
        `wslcb_license_number does.`,
    );
  }
}

/**
 * Every entity type the database can store has a signer rule.
 *
 * The failure this prevents is subtle and real: someone widens the check
 * constraint in a later migration, the profile screen accepts the new value,
 * and `signerRuleFor` returns null - so the mentor panel silently shows nothing
 * where it should show who is legally permitted to sign a federal return.
 * Standing rule 48: a check that cannot classify its input must fail loudly.
 */
export function assertEverySignerRuleExists(): void {
  // No emptiness guard here, and deliberately so. STORABLE_ENTITY_TYPES is
  // declared `as const`, so its length is a literal type and TypeScript refuses
  // to compile a comparison against zero - the compiler is the vacuous-read
  // guard that rule 39 asks for, and a runtime check would be dead code
  // pretending to be a safeguard. The guard that DOES matter is that this list
  // still matches the check constraint in 0196_company_profile.sql, and that
  // lives in company-identity-core.test.ts because it needs to read the
  // migration off disk and this module must stay importable by the browser.
  const known = new Set(COMPANY_IDENTITY_AUTHORITIES.map((a) => a.id));
  const missing: string[] = [];
  const dangling: string[] = [];
  for (const t of STORABLE_ENTITY_TYPES) {
    const rule = signerRuleFor(t);
    if (!rule) {
      missing.push(t);
      continue;
    }
    if (!known.has(rule.authorityId)) dangling.push(`${t} -> ${rule.authorityId}`);
  }
  if (missing.length > 0) {
    throw new Error(
      `ENTITY TYPES WITH NO SIGNER RULE: ${missing.join(", ")}. company_profile.entity_type accepts ` +
        `these values, so the screen can hold them, and signerRuleFor returns nothing for them - the ` +
        `mentor would go silent on who may legally sign a federal employment tax return. Add the ` +
        `governing line from the Instructions for Form 941, Part 5, rather than guessing.`,
    );
  }
  if (dangling.length > 0) {
    throw new Error(`SIGNER RULES CITING AUTHORITIES THAT DO NOT EXIST: ${dangling.join(", ")}.`);
  }
}

export function assertEveryFormHasFields(): void {
  const orphans = COMPANY_FORMS.filter((f) => fieldsForForm(f).length === 0);
  if (orphans.length > 0) {
    throw new Error(
      `FORMS WITH NO FIELDS: ${orphans.join(", ")}. Each would report itself ready to file while ` +
        `reading nothing at all. Either declare the fields it consumes or remove it from COMPANY_FORMS.`,
    );
  }
}
