/**
 * src/lib/payroll/new-hire-report-core.ts   (books-68)
 *
 * The DSHS 18-463 new-hire report as data: who must be on it, what each box
 * holds, and what is missing. Pure — no database, no React, no dates from the
 * clock. The trap: an incomplete report is a FAILURE to report under
 * RCW 26.23.040(5), so a missing field must refuse, never print blank.
 */

import type { FormBox } from "./form-box-core";

/** The form id every box and lesson is keyed by. */
export const NEW_HIRE_FORM_ID = "dshs_18_463";

/**
 * The form's own identifier, measured off page 1 of Michael's copy:
 * "NEW HIRE REPORTING METHODS AND INSTRUCTIONS / DSHS 18-463 (REV. 04/2023)".
 */
export const NEW_HIRE_FORM_TITLE = "DSHS 18-463 (Rev. 04/2023) — Washington New Hire Report";

export const RCW_26_23_040_PATH = "docs/authorities/state-wa/rcw-26.23.040.txt";
export const RCW_26_23_040_URL = "https://app.leg.wa.gov/rcw/default.aspx?cite=26.23.040";

/**
 * Twenty days, from RCW 26.23.040(3): "within twenty days of the hiring".
 *
 * Held as a number so the deadline is computed rather than restated. The same
 * figure already drives `onboardingDeadlines`; this constant exists so the form
 * cites its own source instead of importing a scheduling concern.
 */
export const NEW_HIRE_REPORT_DUE_DAYS = 20;

/**
 * Four employee blocks per page, measured with `pdftotext -bbox-layout` on the
 * filed example: blocks begin at y=147.27, 271.23, 394.23, 518.19 — a pitch of
 * 123.64pt, four to a sheet, page 2 being instructions rather than data.
 *
 * Rule 125(a): paginate as the paper paginates, and MEASURE the pitch.
 */
export const NEW_HIRE_EMPLOYEES_PER_PAGE = 4;

/* ═══════════════════════════════════════════════════════════════════════════
   WHAT THE STATUTE REQUIRES, AS DATA

   RCW 26.23.040(3) lists the required contents. Holding them as a list rather
   than as scattered `if` statements means the refusal logic and the coverage
   test walk the same population — rule 43.
   ═══════════════════════════════════════════════════════════════════════════ */

export type NewHireField =
  | "lastName"
  | "firstName"
  | "middleName"
  | "street"
  | "city"
  | "state"
  | "zip"
  | "ssn"
  | "dateOfBirth"
  | "dateOfHire";

/**
 * Every employee box on the paper, in the order the paper prints them, with
 * whether the statute requires it.
 *
 * MIDDLE NAME is the one box the form prints and the statute does not demand:
 * RCW 26.23.040(3)(a) says "name, address, social security number, and date of
 * birth". So a missing middle name must NOT refuse the report — refusing on it
 * would invent a requirement the legislature did not write (rule 62d).
 */
export const NEW_HIRE_EMPLOYEE_BOXES: readonly {
  readonly field: NewHireField;
  /** The caption AS PRINTED on the form. Measured, not paraphrased. */
  readonly caption: string;
  readonly required: boolean;
}[] = [
  { field: "lastName", caption: "EMPLOYEE LAST NAME", required: true },
  { field: "firstName", caption: "EMPLOYEE FIRST NAME", required: true },
  { field: "middleName", caption: "EMPLOYEE MIDDLE NAME", required: false },
  { field: "street", caption: "EMPLOYEE ADDRESS", required: true },
  { field: "city", caption: "EMPLOYEE CITY", required: true },
  { field: "state", caption: "EMPLOYEE STATE", required: true },
  { field: "zip", caption: "EMPLOYEE ZIP CODE", required: true },
  { field: "ssn", caption: "EMPLOYEE SOCIAL SECURITY NUMBER", required: true },
  { field: "dateOfBirth", caption: "EMPLOYEE BIRTH DATE", required: true },
  { field: "dateOfHire", caption: "EMPLOYEE DATE OF HIRE", required: true },
];

/**
 * The employer boxes, measured off the same page.
 *
 * TWO, not three. The form prints name and address under ONE caption
 * ("EMPLOYER NAME AND ADDRESS") with the FEIN in its own box to the right —
 * that is what `pdftotext -bbox-layout` shows at y=49.23, x=28.44 and x=299.40.
 * Splitting them into three here would invent a box the paper does not have.
 */
export const NEW_HIRE_EMPLOYER_BOXES: readonly {
  readonly field: "employerNameAndAddress" | "employerFein";
  readonly caption: string;
}[] = [
  { field: "employerNameAndAddress", caption: "EMPLOYER NAME AND ADDRESS" },
  { field: "employerFein", caption: "EMPLOYER FEDERAL ID NUMBER (FEIN)" },
];

/* ═══════════════════════════════════════════════════════════════════════════
   INPUT
   ═══════════════════════════════════════════════════════════════════════════ */

export type NewHireEmployee = {
  readonly employeeId: string;
  /** As held. Empty string or null both mean "not captured". */
  readonly lastName: string | null;
  readonly firstName: string | null;
  readonly middleName: string | null;
  readonly street: string | null;
  readonly city: string | null;
  readonly state: string | null;
  readonly zip: string | null;
  /** FULL SSN. Masked by this module before it reaches any view. */
  readonly ssn: string | null;
  /** ISO YYYY-MM-DD. */
  readonly dateOfBirth: string | null;
  /** ISO YYYY-MM-DD. */
  readonly dateOfHire: string | null;
  /** For the roster line and refusal messages, when the legal name is absent. */
  readonly displayName: string;
};

export type NewHireEmployer = {
  readonly legalName: string | null;
  readonly street: string | null;
  readonly city: string | null;
  readonly state: string | null;
  readonly zip: string | null;
  /** Nine digits, hyphen optional. Printed as 46-4217016. */
  readonly ein: string | null;
};

export type BuildNewHireInput = {
  readonly employer: NewHireEmployer;
  /**
   * The people to report. EMPTY IS LEGITIMATE and draws a blank form —
   * books-67 established that an empty period is not a broken one (see D-20).
   */
  readonly employees: readonly NewHireEmployee[];
  /** Today, ISO. Used only to age the 20-day clock. Never read from a clock here. */
  readonly todayYmd: string;
};

/* ═══════════════════════════════════════════════════════════════════════════
   FORMATTERS
   ═══════════════════════════════════════════════════════════════════════════ */

const DASH = "\u2014";

/** ISO YYYY-MM-DD to the MM/DD/YYYY the form prints ("01/13/2026", measured). */
export function newHireDate(iso: string | null): string {
  if (iso === null) return DASH;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (m === null) return DASH;
  return `${m[2]}/${m[3]}/${m[1]}`;
}

/**
 * SSN as the form prints it: 534-29-8006 (measured off the filed example).
 *
 * NOT masked. This is the one document in the system that must carry the full
 * number, because RCW 26.23.040(3)(a) requires it and a masked SSN makes the
 * report useless to the child support registry. Every OTHER surface masks; the
 * screen that shows this form is access-gated for that reason.
 */
export function newHireSsn(raw: string | null): string {
  if (raw === null) return DASH;
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.length !== 9) return DASH;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

/** EIN as the form prints it: 46-4217016 (measured). */
export function newHireEin(raw: string | null): string {
  if (raw === null) return DASH;
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.length !== 9) return DASH;
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

/** A value, or an em dash. Never an empty string — a blank box is invisible. */
function textOrDash(v: string | null): string {
  if (v === null) return DASH;
  const t = v.trim();
  return t === "" ? DASH : t;
}

/** Whitespace-only counts as absent. A spacebar is not a captured fact. */
function present(v: string | null): boolean {
  return v !== null && v.trim() !== "";
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE DEADLINE
   ═══════════════════════════════════════════════════════════════════════════ */

/** Adds days to an ISO date in UTC. No timezone drift: the input has no time. */
export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map((s) => Number(s));
  const t = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b`. Negative when `b` is earlier. */
export function daysBetweenIso(a: string, b: string): number {
  const pa = a.split("-").map((s) => Number(s));
  const pb = b.split("-").map((s) => Number(s));
  const ta = Date.UTC(pa[0] ?? 1970, (pa[1] ?? 1) - 1, pa[2] ?? 1);
  const tb = Date.UTC(pb[0] ?? 1970, (pb[1] ?? 1) - 1, pb[2] ?? 1);
  return Math.round((tb - ta) / 86_400_000);
}

export type NewHireDeadline = {
  readonly dueYmd: string;
  readonly daysRemaining: number;
  readonly overdue: boolean;
};

/**
 * The 20-day clock for one hire.
 *
 * `overdue` is `daysRemaining < 0`, so the due date itself is NOT overdue —
 * RCW 26.23.040(3) says "within twenty days", and day twenty is within.
 */
export function newHireDeadline(hireYmd: string, todayYmd: string): NewHireDeadline {
  const dueYmd = addDaysIso(hireYmd, NEW_HIRE_REPORT_DUE_DAYS);
  const daysRemaining = daysBetweenIso(todayYmd, dueYmd);
  return { dueYmd, daysRemaining, overdue: daysRemaining < 0 };
}

/* ═══════════════════════════════════════════════════════════════════════════
   REFUSALS

   Every refusal names the PERSON and the FIELD, because the fix is a data
   entry task and a message that does not say whose address is missing sends
   Michael through the whole roster to find out.
   ═══════════════════════════════════════════════════════════════════════════ */

export type NewHireRefusalCode =
  | "NO_EMPLOYER_NAME"
  | "NO_EMPLOYER_ADDRESS"
  | "NO_EMPLOYER_EIN"
  | "MISSING_EMPLOYEE_FIELD"
  | "NOBODY_TO_REPORT";

export type NewHireRefusal = {
  readonly code: NewHireRefusalCode;
  readonly because: string;
  /** Set when the refusal is about one person, so the UI can link to them. */
  readonly employeeId: string | null;
  readonly field: NewHireField | null;
};

/** The caption for a field, so refusals speak the form's language. */
export function captionFor(field: NewHireField): string {
  const box = NEW_HIRE_EMPLOYEE_BOXES.find((b) => b.field === field);
  /* istanbul ignore next — unreachable while NewHireField and the box list agree,
     and the coverage test proves they do. */
  return box?.caption ?? field;
}

function valueOf(e: NewHireEmployee, field: NewHireField): string | null {
  switch (field) {
    case "lastName":
      return e.lastName;
    case "firstName":
      return e.firstName;
    case "middleName":
      return e.middleName;
    case "street":
      return e.street;
    case "city":
      return e.city;
    case "state":
      return e.state;
    case "zip":
      return e.zip;
    case "ssn":
      return e.ssn;
    case "dateOfBirth":
      return e.dateOfBirth;
    case "dateOfHire":
      return e.dateOfHire;
  }
}

export function newHireRefusals(input: BuildNewHireInput): readonly NewHireRefusal[] {
  const out: NewHireRefusal[] = [];
  const { employer, employees } = input;

  if (!present(employer.legalName)) {
    out.push({
      code: "NO_EMPLOYER_NAME",
      because:
        "The employer's legal name is not on the company profile. RCW 26.23.040(3)(b) " +
        "requires the employer's name on every new-hire report.",
      employeeId: null,
      field: null,
    });
  }
  if (!present(employer.street) || !present(employer.city) || !present(employer.zip)) {
    out.push({
      code: "NO_EMPLOYER_ADDRESS",
      because:
        "The company profile is missing part of Greenway's mailing address. " +
        "RCW 26.23.040(3)(b) requires the employer's address.",
      employeeId: null,
      field: null,
    });
  }
  if (newHireEin(employer.ein) === DASH) {
    out.push({
      code: "NO_EMPLOYER_EIN",
      because:
        "The EIN on the company profile is missing or is not nine digits. " +
        "RCW 26.23.040(3)(b) requires the employer's federal identifying number.",
      employeeId: null,
      field: null,
    });
  }

  for (const e of employees) {
    for (const box of NEW_HIRE_EMPLOYEE_BOXES) {
      if (!box.required) continue;
      const raw = valueOf(e, box.field);
      if (!present(raw)) {
        out.push({
          code: "MISSING_EMPLOYEE_FIELD",
          because: `${e.displayName} has no ${box.caption.replace(/^EMPLOYEE /, "").toLowerCase()} on file, and RCW 26.23.040(3)(a) requires it.`,
          employeeId: e.employeeId,
          field: box.field,
        });
        continue;
      }
      /*
       * PRESENT BUT UNUSABLE IS ALSO MISSING.
       *
       * A malformed SSN or date would print as an em dash on the paper, which
       * is a blank box on a mailed report — the exact failure this module
       * exists to prevent. So the format check raises the same refusal rather
       * than letting a dash through.
       */
      if (box.field === "ssn" && newHireSsn(raw) === DASH) {
        out.push({
          code: "MISSING_EMPLOYEE_FIELD",
          because: `${e.displayName} has a social security number on file that is not nine digits, so it cannot be printed on the report.`,
          employeeId: e.employeeId,
          field: "ssn",
        });
      }
      if ((box.field === "dateOfBirth" || box.field === "dateOfHire") && newHireDate(raw) === DASH) {
        out.push({
          code: "MISSING_EMPLOYEE_FIELD",
          because: `${e.displayName} has a ${box.caption.replace(/^EMPLOYEE /, "").toLowerCase()} that is not a valid date, so it cannot be printed on the report.`,
          employeeId: e.employeeId,
          field: box.field,
        });
      }
    }
  }

  /*
   * NOBODY TO REPORT IS LAST, AND IT IS THE ONLY ONE THAT DRAWS A BLANK FORM.
   *
   * Ordered last so a caller checking `refusals[0]` sees a real problem first.
   * The route uses the same test books-67 established for the EAMS
   * confirmation: an EMPTY report draws, a BROKEN one refuses (D-20).
   */
  if (employees.length === 0) {
    out.push({
      code: "NOBODY_TO_REPORT",
      because: "Nobody has been hired in this window, so there is nothing to report yet.",
      employeeId: null,
      field: null,
    });
  }

  return out;
}

/**
 * True when the ONLY thing wrong is that nobody was hired.
 *
 * This is the single test the route branches on. Written here, beside the
 * refusals it reads, so a new refusal code cannot change the answer without
 * this function being looked at — the failure mode books-67 recorded as the
 * reason to keep the probe (`probe-books-67-empty.ts`).
 */
export function onlyRefusalIsEmptiness(refusals: readonly NewHireRefusal[]): boolean {
  return refusals.length === 1 && refusals[0]!.code === "NOBODY_TO_REPORT";
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE VIEW
   ═══════════════════════════════════════════════════════════════════════════ */

export type NewHireEmployeeBlock = {
  readonly employeeId: string;
  readonly displayName: string;
  /** Every box, in printed order, already formatted. Never an empty string. */
  readonly cells: readonly { readonly caption: string; readonly value: string }[];
  readonly deadline: NewHireDeadline | null;
};

export type NewHirePage = {
  readonly pageNumber: number;
  readonly blocks: readonly NewHireEmployeeBlock[];
};

export type NewHireReportView = {
  readonly title: string;
  readonly employerName: string;
  readonly employerAddressLine1: string;
  readonly employerAddressLine2: string;
  readonly employerEin: string;
  readonly pages: readonly NewHirePage[];
  readonly totalEmployees: number;
  /** Non-null ONLY when the form is blank because nobody was hired. */
  readonly emptyReason: string | null;
  readonly refusals: readonly NewHireRefusal[];
};

/**
 * Split into pages of four, exactly as the paper does.
 *
 * The tail of the last page is left SHORT rather than padded — rule 125(c).
 * Padding with a repeated person is a plausible-looking invention, and on this
 * form it would be a false statement to a child support registry.
 */
export function paginateNewHire(
  blocks: readonly NewHireEmployeeBlock[],
): readonly NewHirePage[] {
  if (blocks.length === 0) return [{ pageNumber: 1, blocks: [] }];
  const pages: NewHirePage[] = [];
  for (let i = 0; i < blocks.length; i += NEW_HIRE_EMPLOYEES_PER_PAGE) {
    pages.push({
      pageNumber: pages.length + 1,
      blocks: blocks.slice(i, i + NEW_HIRE_EMPLOYEES_PER_PAGE),
    });
  }
  return pages;
}

export function buildNewHireReport(input: BuildNewHireInput): NewHireReportView {
  const { employer, employees, todayYmd } = input;
  const refusals = newHireRefusals(input);

  const blocks: NewHireEmployeeBlock[] = employees.map((e) => ({
    employeeId: e.employeeId,
    displayName: e.displayName,
    cells: NEW_HIRE_EMPLOYEE_BOXES.map((box) => ({
      caption: box.caption,
      value:
        box.field === "ssn"
          ? newHireSsn(e.ssn)
          : box.field === "dateOfBirth"
            ? newHireDate(e.dateOfBirth)
            : box.field === "dateOfHire"
              ? newHireDate(e.dateOfHire)
              : textOrDash(valueOf(e, box.field)),
    })),
    deadline: present(e.dateOfHire) ? newHireDeadline(e.dateOfHire!.trim(), todayYmd) : null,
  }));

  const city = textOrDash(employer.city);
  const st = textOrDash(employer.state);
  const zip = textOrDash(employer.zip);

  return {
    title: NEW_HIRE_FORM_TITLE,
    employerName: textOrDash(employer.legalName),
    employerAddressLine1: textOrDash(employer.street),
    employerAddressLine2: `${city}   ${st} ${zip}`,
    employerEin: newHireEin(employer.ein),
    pages: paginateNewHire(blocks),
    totalEmployees: employees.length,
    emptyReason:
      employees.length === 0
        ? "This report is blank because nobody has been hired in the window you are looking at — " +
          "not because anything is wrong. It is the real layout, with every box in the place DSHS " +
          "prints it, so you can see what will be reported before there is anything to report. " +
          "Washington wants a report within twenty days of a hire; with no hires, there is nothing " +
          "due and nothing to mail."
        : null,
    refusals,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE BOXES, FOR THE SHEET

   `FormSheet` renders `FormBox[]`. Nothing on this form is money, so every box
   is `measure: "count"` with `whose: "not_money"` — the vocabulary the rest of
   the system already speaks (rule 25: extend, never duplicate).
   ═══════════════════════════════════════════════════════════════════════════ */

function box(
  boxNo: string,
  caption: string,
  derivation: string,
  notComputedYet: string | null,
  emphasise: boolean,
  text: string | null = null,
): FormBox {
  return {
    formId: NEW_HIRE_FORM_ID,
    box: boxNo,
    caption,
    measure: "count",
    amountCents: 0,
    quantity: null,
    whose: "not_money",
    derivation,
    blankOnPurpose: null,
    emphasise,
    notComputedYet,
    /*
     * Every box on this form is words (D-21). `measure` stays "count" because
     * the vocabulary has no text member and widening it would touch every form
     * in the system; `text` is what the reader actually sees.
     */
    text,
  };
}

/**
 * The eleven boxes of DSHS 18-463 as a teaching sheet.
 *
 * `view` is nullable so the sheet draws with or without data — books-67's rule,
 * applied here from the start rather than retrofitted (D-20).
 */
export function newHireBoxes(view: NewHireReportView | null): readonly FormBox[] {
  const first = view?.pages[0]?.blocks[0] ?? null;
  const cell = (caption: string): string | null =>
    first?.cells.find((c) => c.caption === caption)?.value ?? null;

  const shown = (v: string | null): string | null =>
    v === null || v === DASH ? null : v;

  /*
   * ═══ D-21: EVERY BOX ON THIS FORM IS TEXT, AND A FormBox CANNOT HOLD TEXT ═══
   *
   * FOUND BY LOOKING, not by a gate. All 11,695 tests were green and the
   * screenshot showed a form whose every box read "0" — the employer's name,
   * the employee's name, the SSN, all of them "0". Exactly the D-19 class:
   * assertions checked the view object, which was correct, while the PAGE was
   * wrong. This is why rule 130c exists.
   *
   * THE CAUSE. `BoxMeasure` is "money" | "hours" | "count". There is no "text"
   * member, so `formatBoxValue` sends every box down the count branch and
   * prints `quantity ?? 0` — a literal zero. Nothing on the 18-463 is a figure:
   * it is names, an address, an SSN and two dates.
   *
   * THE FIX, and why it is not "add a text measure". Adding a fourth member to
   * `BoxMeasure` changes a union that `form-box-adapters`, `form-box-teaching-
   * core`, `wa-quarterly-mentor-gates`, `form-941-schedule-b-boxes`,
   * `form-box-ui-core` and every exhaustive switch over it must then handle —
   * every form in the system, for one form's benefit. Michael: "We need to find
   * a fair balance between having perfect code verse acceptable code within
   * budget."
   *
   * THE FIRST ATTEMPT, AND WHY IT WAS ALSO FALSE. The codebase already had a
   * road for this: `employerEntityBoxes` in form-box-adapters.ts carries the
   * 941's EIN, legal name and address, and flags them `notComputedYet` so
   * `paperText` refuses to print a figure — that branch runs FIRST in
   * `formatBoxValue`, ahead of every numeric one. Following it (rule 25:
   * extend, never duplicate) removed the twelve zeroes and the suite went
   * green. The next screenshot showed the real defect: a fully populated
   * report reading "not computed yet" in all twelve boxes. Trading a false
   * zero for a false "unknown" is not a fix; those identity boxes are headers
   * repeated from a profile, whereas these twelve ARE the return.
   *
   * THE FIX THAT SHIPPED. One additive, optional `text` field on `FormBox`,
   * read only through `boxText()`, checked by `formatBoxValue` second — after
   * `notComputedYet`, so an unknown figure still refuses to print, and before
   * the numeric branches, so a person's name is never formatted as `quantity
   * ?? 0`. `assertBoxTextIsHonest` forbids a money box from carrying words,
   * and `sheetGroups()` calls it, so every sheet in the system passes through
   * that one door (rule 23).
   *
   * Widening `BoxMeasure` to a fourth "text" member was the alternative and
   * was rejected: it is a union that form-box-adapters, form-box-teaching-core,
   * wa-quarterly-mentor-gates, form-941-schedule-b-boxes, form-box-ui-core and
   * every exhaustive switch must then handle — every form in the system, for
   * one form's benefit. Michael: "We need to find a fair balance between having
   * perfect code verse acceptable code within budget."
   *
   * So `text` carries the words, and `notComputedYet` now means only what it
   * says: this value is genuinely not known. On a blank specimen that is all
   * twelve boxes; on a filed report it is MIDDLE NAME and nothing else.
   */

  const out: FormBox[] = [
    box(
      "E1",
      "EMPLOYER NAME AND ADDRESS",
      view === null
        ? "Greenway's legal name and mailing address, from the company profile."
        : `${view.employerName} · ${view.employerAddressLine1} · ${view.employerAddressLine2}`,
      view === null ? "No company profile loaded on this view." : null,
      true,
      view === null
        ? null
        : `${view.employerName}, ${view.employerAddressLine1}, ${view.employerAddressLine2}`,
    ),
    box(
      "E2",
      "EMPLOYER FEDERAL ID NUMBER (FEIN)",
      view === null
        ? "The EIN from the company profile, printed with the hyphen DSHS shows."
        : view.employerEin,
      view === null ? "No company profile loaded on this view." : null,
      true,
      view === null ? null : view.employerEin,
    ),
  ];

  for (const b of NEW_HIRE_EMPLOYEE_BOXES) {
    const v = shown(cell(b.caption));
    out.push(
      box(
        b.caption.replace(/^EMPLOYEE /, ""),
        b.caption,
        v === null
          ? b.required
            ? "Required by RCW 26.23.040(3)(a). Comes from the employee's record."
            : "Printed by the form but not required by RCW 26.23.040(3)(a)."
          : v,
        v === null ? "Nobody to report yet, so this box has nothing in it." : null,
        b.required,
        v,
      ),
    );
  }

  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════
   SELF-TESTS (rule 39: an empty loop proves nothing)
   ═══════════════════════════════════════════════════════════════════════════ */

function ok(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`new-hire-report-core self-test failed: ${msg}`);
}

const GOOD_EMPLOYER: NewHireEmployer = {
  legalName: "LYMAN'S MARIJUANA L.L.C.",
  street: "4851 GEIGER RD SE",
  city: "PORT ORCHARD",
  state: "WA",
  zip: "98366",
  ein: "464217016",
};

const GOOD_EMPLOYEE: NewHireEmployee = {
  employeeId: "e1",
  lastName: "CLARK",
  firstName: "AUTUMN",
  middleName: "E",
  street: "3444 SW CHRISTMAS TREE LN",
  city: "PORT ORCHARD",
  state: "WA",
  zip: "98367",
  ssn: "534298006",
  dateOfBirth: "1993-10-13",
  dateOfHire: "2026-01-13",
  displayName: "Autumn Clark",
};

export function runNewHireSelfTests(): void {
  // Formats, measured off the filed example.
  ok(newHireDate("2026-01-13") === "01/13/2026", "date prints MM/DD/YYYY");
  ok(newHireDate(null) === DASH, "absent date is a dash");
  ok(newHireDate("13/01/2026") === DASH, "non-ISO input is a dash, never guessed");
  ok(newHireSsn("534298006") === "534-29-8006", "SSN prints grouped");
  ok(newHireSsn("534-29-8006") === "534-29-8006", "SSN already grouped survives");
  ok(newHireSsn("5342") === DASH, "short SSN is a dash, never padded");
  ok(newHireEin("464217016") === "46-4217016", "EIN prints 2-7");

  // Twenty days, and day twenty is NOT late.
  const d = newHireDeadline("2026-01-13", "2026-02-02");
  ok(d.dueYmd === "2026-02-02", `due is hire+20, got ${d.dueYmd}`);
  ok(!d.overdue, "the due date itself is within twenty days");
  ok(newHireDeadline("2026-01-13", "2026-02-03").overdue, "day 21 is overdue");

  // A complete report refuses nothing.
  const good = buildNewHireReport({
    employer: GOOD_EMPLOYER,
    employees: [GOOD_EMPLOYEE],
    todayYmd: "2026-01-20",
  });
  ok(good.refusals.length === 0, `complete report should not refuse, got ${good.refusals.length}`);
  ok(good.emptyReason === null, "a report with somebody on it is not empty");

  // A missing address refuses BY NAME — the whole point of migration 0208.
  const noAddr = buildNewHireReport({
    employer: GOOD_EMPLOYER,
    employees: [{ ...GOOD_EMPLOYEE, street: null }],
    todayYmd: "2026-01-20",
  });
  ok(noAddr.refusals.length === 1, "one missing field, one refusal");
  ok(noAddr.refusals[0]!.field === "street", "the refusal names the field");
  ok(
    noAddr.refusals[0]!.because.includes("Autumn Clark"),
    "the refusal names the person, so the fix is a data entry task",
  );

  // A middle name is NOT required — refusing on it would invent a rule.
  const noMiddle = buildNewHireReport({
    employer: GOOD_EMPLOYER,
    employees: [{ ...GOOD_EMPLOYEE, middleName: null }],
    todayYmd: "2026-01-20",
  });
  ok(noMiddle.refusals.length === 0, "a missing middle name must not refuse (rule 62d)");

  // Whitespace is not a captured fact.
  const spaces = buildNewHireReport({
    employer: GOOD_EMPLOYER,
    employees: [{ ...GOOD_EMPLOYEE, city: "   " }],
    todayYmd: "2026-01-20",
  });
  ok(spaces.refusals.some((r) => r.field === "city"), "whitespace-only city refuses");

  // Empty draws, and says so, and prints no zeros anywhere.
  const empty = buildNewHireReport({
    employer: GOOD_EMPLOYER,
    employees: [],
    todayYmd: "2026-01-20",
  });
  ok(empty.emptyReason !== null, "an empty report explains itself");
  ok(onlyRefusalIsEmptiness(empty.refusals), "emptiness is the only refusal on a clean empty report");
  ok(empty.pages.length === 1, "an empty report still has one page to look at");
  ok(empty.totalEmployees === 0, "count is honest");

  // Broken AND empty is still broken — the books-67 distinction.
  const brokenEmpty = buildNewHireReport({
    employer: { ...GOOD_EMPLOYER, ein: null },
    employees: [],
    todayYmd: "2026-01-20",
  });
  ok(
    !onlyRefusalIsEmptiness(brokenEmpty.refusals),
    "a missing EIN must not hide behind an empty report",
  );

  // Four to a page, tail left short (rule 125c).
  const five = buildNewHireReport({
    employer: GOOD_EMPLOYER,
    employees: [0, 1, 2, 3, 4].map((i) => ({
      ...GOOD_EMPLOYEE,
      employeeId: `e${i}`,
      displayName: `Person ${i}`,
    })),
    todayYmd: "2026-01-20",
  });
  ok(five.pages.length === 2, `five people fill two pages, got ${five.pages.length}`);
  ok(five.pages[0]!.blocks.length === 4, "first page holds four");
  ok(five.pages[1]!.blocks.length === 1, "the tail is left short, never padded");

  // The sheet draws with no data and never invents a value.
  const blankBoxes = newHireBoxes(null);
  ok(
    blankBoxes.length === NEW_HIRE_EMPLOYER_BOXES.length + NEW_HIRE_EMPLOYEE_BOXES.length,
    `the sheet must show every measured box, got ${blankBoxes.length}`,
  );
  ok(
    new Set(blankBoxes.map((b) => b.box)).size === blankBoxes.length,
    "box numbers must be unique or FormSheet keys collide",
  );
  for (const b of blankBoxes) {
    ok(b.notComputedYet !== null, `blank sheet box ${b.box} must say it has no figure`);
  }
}

runNewHireSelfTests();
