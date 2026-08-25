/**
 * src/lib/payroll/esd-paid-leave-csv-core.ts   (books-56)
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * THE PAID LEAVE / WA CARES QUARTERLY WAGE FILE — AND ONLY THAT FILE
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Michael files this himself, on the ESD portal, every quarter. So this module's
 * job is not to be clever: it is to produce bytes that ESD accepts, and to
 * REFUSE rather than produce bytes that ESD might accept while meaning
 * something false.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THERE ARE TWO EIGHT-COLUMN ESD WAGE FILES AND THEY ARE NOT INTERCHANGEABLE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This is the single most important fact in this file, and it was found by
 * reading the two documents Michael supplied side by side rather than by
 * assuming "the ESD CSV" was one thing.
 *
 *   PAID LEAVE & WA CARES (this module) — 8 columns, HEADER ROW REQUIRED:
 *     SSN, LastName, FirstName, MiddleInitial, Hours, Wages,
 *     WACaresExempt(Y/N), DOB (MMDDYYYY)
 *
 *   EAMS / UNEMPLOYMENT INSURANCE (NOT this module) — 8 columns, NO HEADERS:
 *     SSN, LastName, FirstName, MiddleName, Suffix, Hours, GrossWages, SOC code
 *
 * Same count. Different meanings. Column 5 is Hours in one file and Suffix in
 * the other; column 7 is a WA Cares flag in one and a six-digit occupation code
 * in the other. The header rules are exact opposites: the Paid Leave spec says
 * to "list each employee in a separate row with the headers in the order shown
 * below", while the EAMS instructions say "Do not label the columns... Start
 * listing information for your first employee in row 1."
 *
 * And ESD says plainly, in the EAMS document:
 *
 *   "If you are reporting wages for Paid Family & Medical Leave (Paid Leave),
 *    do not use EAMS."
 *
 * A file of the wrong shape is either rejected — the good outcome — or accepted
 * with an hours figure read as a name suffix. So `PAID_LEAVE_HEADER` is exported
 * and asserted, and a gate proves this writer's output cannot be mistaken for
 * the EAMS format.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VERSION, RECORDED HONESTLY
 * ─────────────────────────────────────────────────────────────────────────────
 * The file Michael supplied is named `...v8.1-2025.08.pdf`. The document itself
 * says "(v8)" and "Updated May 2024" in its title and in the footer of all four
 * pages. This module follows THE DOCUMENT, and the mirrored copy at
 * `docs/authorities/state-wa/esd-paid-leave-wa-cares-csv-spec-v8.txt` is the
 * text as published. Where the filename and the content disagree, the content
 * is the authority — rule 109's reasoning applied to a specification.
 */
/*
 * A private `assert`, declared here rather than imported.
 *
 * I first wrote `import { assert } from "@/lib/payroll/form-box-core"` and it
 * was wrong: that module declares `assert` privately at line 722 and does not
 * export it. Four sibling core modules (form-box-core, form-box-adapters,
 * form-box-ui-core, form-box-teaching-core) each declare their own. That is the
 * house pattern, so this module follows it instead of widening another module's
 * public surface to suit a convenience import.
 *
 * These assertions guard INVARIANTS OF THIS WRITER, not user data. Bad user
 * data returns a refusal (see PaidLeaveCsvRefusalCode); a thrown error here
 * means the writer itself is broken, which must be loud (rule 48).
 */
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`esd-paid-leave-csv-core self-check: ${msg}`);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §1  WHAT ESD REQUIRES, QUOTED
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The header row, byte for byte as the specification prints it.
 *
 * Not assembled from a list of field names. The spec's own table headings are
 * inconsistent in a way that matters — `WACaresExempt(Y/N)` has no spaces while
 * `DOB (MMDDYYYY)` has one — and "tidying" that is exactly the kind of
 * improvement that gets a file rejected.
 */
export const PAID_LEAVE_HEADER =
  "SSN,LastName,FirstName,MiddleInitial,Hours,Wages,WACaresExempt(Y/N),DOB (MMDDYYYY)";

/** The eight columns, in the one order ESD accepts. */
export const PAID_LEAVE_COLUMN_COUNT = 8;

/**
 * The EAMS header, present ONLY so a gate can prove the two never converge.
 * Nothing in this module writes it. EAMS forbids a header row at all; this is
 * the column ORDER, used to assert difference.
 */
export const EAMS_COLUMN_ORDER: readonly string[] = [
  "SSN",
  "LastName",
  "FirstName",
  "MiddleName",
  "Suffix",
  "Hours",
  "GrossWages",
  "SOCCode",
];

/* ═══════════════════════════════════════════════════════════════════════════
 * §2  THE INPUT, INCLUDING THE TWO FIELDS THE ENGINE DOES NOT YET HOLD
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * One employee's row.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY `dateOfBirth` AND `waCaresExempt` ARE REQUIRED AND NOT OPTIONAL
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `WaQuarterSubject` in `wa-quarterly-core.ts` carries wages and hours. It does
 * NOT carry a date of birth or a WA Cares exemption status. The specification
 * marks both as **Required**, and DOB has been required since 1 October 2023.
 *
 * So this file CANNOT be produced from what the engine holds today. That is a
 * real gap, and the honest response is for the type to demand the fields and
 * for the writer to refuse without them — not to default DOB to something
 * plausible, and not to default the exemption to "N".
 *
 * Standing rule 62d: never invent a default. The exemption default is the more
 * tempting of the two, because the spec itself says "Otherwise enter 'N' for no
 * or leave blank" — so `N` looks free. It is not. Entering `N` is an assertion
 * that Greenway holds no exemption letter for that person this quarter. Only
 * Michael knows that. The engine may not say it on his behalf.
 */
export type PaidLeaveEmployeeRow = {
  /** Nine digits. Hyphens optional per the spec; stored however it is held. */
  readonly ssn: string;
  readonly lastName: string;
  readonly firstName: string;
  /** A single alphabetical character, or empty. Optional per the spec. */
  readonly middleInitial: string;
  /**
   * Hours worked this quarter, as an EXACT value which may be fractional.
   * Rounding is this module's job, because the spec dictates the direction.
   */
  readonly exactHours: number;
  /** Gross wages in integer cents. Never a float — this system's money rule. */
  readonly grossWagesCents: number;
  /**
   * True only if Greenway holds the employee's WA Cares exemption approval
   * letter for THIS reporting quarter. There is no third state: see the
   * docblock above on why this is not optional.
   */
  readonly waCaresExempt: boolean;
  /** ISO `YYYY-MM-DD`. Converted to the spec's MMDDYYYY on write. */
  readonly dateOfBirth: string;
};

export type PaidLeaveCsvRefusalCode =
  | "NO_EMPLOYEES"
  | "SSN_NOT_NINE_DIGITS"
  | "MISSING_LAST_NAME"
  | "MISSING_FIRST_NAME"
  | "MIDDLE_INITIAL_TOO_LONG"
  | "NEGATIVE_HOURS"
  | "NEGATIVE_WAGES"
  | "MISSING_DOB"
  | "MALFORMED_DOB"
  | "NON_INTEGER_CENTS"
  /**
   * A name field contains the delimiter itself.
   *
   * Found by asking what happens to `buildPaidLeaveCsv` if a name contains a
   * comma. The answer was: the eight-field self-check at the end of the writer
   * throws. That is the WRONG CHANNEL. The self-check exists to catch a broken
   * WRITER; a comma in an employee's name is broken INPUT, and input problems
   * must come back as a refusal Michael can read and act on, not as an internal
   * error that looks like a crash.
   *
   * The specification does not permit the character: "May contain letters,
   * spaces, hyphens, and/or apostrophes." A comma is none of those. So this
   * refuses rather than quoting the field — quoting IS legal (ESD prints a
   * fully-quoted sample and calls it "acceptable"), but partial quoting of only
   * the offending field is a third format that ESD never shows, and inventing a
   * format is how a file gets silently mis-parsed. Refusing puts the decision
   * where it belongs: with the person who knows the employee's real name.
   */
  | "NAME_CONTAINS_DELIMITER";

export type PaidLeaveCsvRefusal = {
  readonly code: PaidLeaveCsvRefusalCode;
  readonly subject: string;
  readonly explanation: string;
};

export type PaidLeaveCsvResult =
  | { readonly ok: true; readonly csv: string; readonly rowsWritten: number; readonly omitted: readonly string[] }
  | { readonly ok: false; readonly refusals: readonly PaidLeaveCsvRefusal[] };

/* ═══════════════════════════════════════════════════════════════════════════
 * §3  THE FOUR FORMATTING RULES, EACH ONE A QUOTED REQUIREMENT
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Hours: "Must be a whole number. Round fractional hours up to the nearest
 * whole number." The spec even works the example: "152.25 hours should be
 * reported as 153 hours."
 *
 * ROUNDING UP IS NOT THE USUAL RULE IN THIS CODEBASE and that is the point.
 * Everywhere else, money rounds half-up at the cent under
 * `statutoryRoundCents`. Here ESD demands CEILING on hours, so 152.01 becomes
 * 153. Using the house rounding rule would under-report hours by up to an hour
 * per employee per quarter, which on an L&I-adjacent figure is a real
 * misstatement. A mutation test flips this to `Math.round` and to `Math.floor`.
 */
export function paidLeaveHours(exactHours: number): number {
  return Math.ceil(exactHours);
}

/**
 * Wages: "Must include a decimal mark and two decimal places. Do not include a
 * comma."
 *
 * Built from integer cents by string surgery, NOT by dividing and formatting.
 * `(4532222 / 100).toFixed(2)` happens to work here, but division introduces a
 * float where this system has spent considerable effort never having one, and
 * `toLocaleString` — the obvious way to format money — inserts exactly the
 * thousands separator the spec forbids.
 */
export function paidLeaveWages(grossWagesCents: number): string {
  assert(
    Number.isInteger(grossWagesCents),
    `wages must be integer cents, got ${grossWagesCents}`,
  );
  assert(grossWagesCents >= 0, `wages must not be negative, got ${grossWagesCents}`);
  const dollars = Math.floor(grossWagesCents / 100);
  const cents = grossWagesCents % 100;
  return `${dollars}.${String(cents).padStart(2, "0")}`;
}

/**
 * SSN: "9-digit number, hyphens are optional. Format: ######### or
 * ###-##-####."
 *
 * Written WITH hyphens, deliberately, because of the failure ESD documents
 * under "How to fix common errors":
 *
 *   "When an SSN starts with zeros, the zeros are sometimes removed. Example:
 *    If '012345678' is changed to '12345678', the SSN is invalid because it has
 *    only eight digits."
 *
 * A bare nine-digit string in a .csv is read as a NUMBER by every spreadsheet
 * that opens it, and a leading zero does not survive that. `012-34-5678` is not
 * a number, so it survives. Both forms are legal; one of them is safe. A
 * mutation test strips the hyphens and asserts the gate notices.
 */
export function paidLeaveSsn(ssn: string): string {
  const digits = ssn.replace(/[^0-9]/g, "");
  assert(digits.length === 9, `SSN must have nine digits, got ${digits.length}`);
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

/**
 * DOB: "Format DOB using MMDDYYYY or MM/DD/YYY or MM-DD-YYYY."
 *
 * MMDDYYYY chosen — the unpunctuated form.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * I CORRECTED MY OWN REASONING HERE, AND THE ORIGINAL IS WORTH KEEPING
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * I first wrote that the specification's example table "is inconsistent here
 * (it shows `01011990`, `12/11/2000` and `08181989` in one three-row sample),
 * which is evidence that all three are accepted, not that any is preferred."
 * The conclusion — write MMDDYYYY — was right. The reasoning was wrong, and it
 * was wrong because I was reading the only part of the document that extracts
 * as text.
 *
 * On page 3, ESD prints two screenshots captioned "If opened in a plain text
 * editor, your final .csv file should look like this". Those are IMAGES; they
 * do not extract, so the mirrored prose file is blank at that point. Extracted
 * with `pdfimages` and enlarged, they show the finished bytes — and in the
 * finished file all three rows are unpunctuated:
 *
 *     123-33-1234,Doe,John,B,1200,45322.22,Y,01011990
 *     034-35-4567,Smith,Jane,,4,70.00,N,12112000
 *     143556786,O’Brian,Robert,H,1300,5000.50,,08181989
 *
 * Row 2 is `12112000` in the FILE and `12/11/2000` in the padded table. So the
 * table was never "inconsistent": it was illustrating accepted INPUT styles,
 * exactly as the prose says — "Format DOB using MMDDYYYY or MM/DD/YYY or
 * MM-DD-YYYY" — while the file itself carries one style. The unpunctuated form
 * is not merely "least surprising", it is what ESD's own sample file contains.
 *
 * Transcribed and reasoned in
 * `docs/authorities/state-wa/esd-paid-leave-csv-plain-text-sample.txt`, with a
 * register of what a pixel-reading could get wrong.
 */
export function paidLeaveDob(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  assert(m !== null, `date of birth must be ISO YYYY-MM-DD, got ${JSON.stringify(isoDate)}`);
  return `${m![2]}${m![3]}${m![1]}`;
}

/**
 * WA Cares: "enter 'Y' for yes. Otherwise enter 'N' for no or leave blank."
 *
 * `N` is written rather than blank. Both are legal; a visible `N` is a positive
 * statement that the question was answered, where a blank cell is
 * indistinguishable from a column that failed to export.
 *
 * ESD's own sample file uses BOTH: row 2 carries `N`, and row 3 leaves the
 * field empty (`...,5000.50,,08181989`). So writing `N` is squarely within what
 * the department publishes, and the choice between them is ours to make on the
 * grounds above rather than a requirement either way.
 *
 * What this function must NOT be is a way to answer the question for Michael.
 * It takes a boolean that somebody has already decided. `waCaresExempt` is not
 * optional on the input type precisely so that "we don't know yet" cannot be
 * quietly rendered as `N` — see the type's docblock, and rule 62d.
 */
export function paidLeaveWaCares(exempt: boolean): string {
  return exempt ? "Y" : "N";
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §4  THE WRITER
 * ═══════════════════════════════════════════════════════════════════════════ */

function validate(rows: readonly PaidLeaveEmployeeRow[]): readonly PaidLeaveCsvRefusal[] {
  const out: PaidLeaveCsvRefusal[] = [];
  if (rows.length === 0) {
    out.push({
      code: "NO_EMPLOYEES",
      subject: "(file)",
      explanation:
        "A quarterly wage file with no employees is not an empty report, it is a missing " +
        "report. If Greenway genuinely paid nobody this quarter, that is a no-payroll " +
        "filing and it is not made with this file.",
    });
    return out;
  }
  for (const r of rows) {
    const who = r.lastName || r.ssn || "(unnamed)";
    if (r.ssn.replace(/[^0-9]/g, "").length !== 9) {
      out.push({
        code: "SSN_NOT_NINE_DIGITS",
        subject: who,
        explanation:
          `The SSN has ${r.ssn.replace(/[^0-9]/g, "").length} digits, not nine. ESD records ` +
          `that leading zeros are "sometimes removed" by spreadsheets, so an eight-digit ` +
          `value is the documented symptom of a lost leading zero rather than a typo.`,
      });
    }
    if (r.lastName.trim() === "") {
      out.push({
        code: "MISSING_LAST_NAME",
        subject: who,
        explanation: "Last name is Required by the specification and cannot be blank.",
      });
    }
    if (r.firstName.trim() === "") {
      out.push({
        code: "MISSING_FIRST_NAME",
        subject: who,
        explanation: "First name is Required by the specification and cannot be blank.",
      });
    }
    /*
     * The delimiter must not appear inside a field. Checked on every field this
     * writer copies through verbatim, not just the two names, because the check
     * is about the DELIMITER rather than about names: any unescaped comma shifts
     * every later column left, and a shifted row is the failure that puts a date
     * of birth in the WA Cares column.
     */
    for (const [label, value] of [
      ["last name", r.lastName],
      ["first name", r.firstName],
      ["middle initial", r.middleInitial],
    ] as const) {
      if (value.includes(",")) {
        out.push({
          code: "NAME_CONTAINS_DELIMITER",
          subject: who,
          explanation:
            `The ${label} contains a comma, which is the field delimiter of this file: ` +
            `${JSON.stringify(value)}. The specification allows names that "May contain ` +
            `letters, spaces, hyphens, and/or apostrophes" — a comma is none of those. ` +
            `Left in place it would shift every later column left, so that a date of ` +
            `birth lands in the WA Cares column and the row is silently wrong rather ` +
            `than rejected. Correct the name in the payroll record.`,
        });
      }
    }
    if (r.middleInitial.length > 1) {
      out.push({
        code: "MIDDLE_INITIAL_TOO_LONG",
        subject: who,
        explanation:
          `Middle initial must be, in the specification's words, "A single alphabetical ` +
          `character only" \u2014 got ` +
          `${JSON.stringify(r.middleInitial)}. This file wants an INITIAL; the EAMS ` +
          `unemployment file is the one that takes a middle NAME of up to 20 characters.`,
      });
    }
    if (r.exactHours < 0) {
      out.push({
        code: "NEGATIVE_HOURS",
        subject: who,
        explanation: `Hours cannot be negative, got ${r.exactHours}.`,
      });
    }
    if (r.grossWagesCents < 0) {
      out.push({
        code: "NEGATIVE_WAGES",
        subject: who,
        explanation: `Gross wages cannot be negative, got ${r.grossWagesCents} cents.`,
      });
    }
    if (!Number.isInteger(r.grossWagesCents)) {
      out.push({
        code: "NON_INTEGER_CENTS",
        subject: who,
        explanation:
          `Wages must be integer cents, got ${r.grossWagesCents}. A fractional cent here ` +
          `means a float leaked into a money path.`,
      });
    }
    if (r.dateOfBirth.trim() === "") {
      out.push({
        code: "MISSING_DOB",
        subject: who,
        explanation:
          "Date of birth is Required and has been since 1 October 2023. There is no safe " +
          "default: a guessed DOB is a false statement about a person, and the WA Cares " +
          "programme uses it. Enter the real one or do not file this row.",
      });
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(r.dateOfBirth)) {
      out.push({
        code: "MALFORMED_DOB",
        subject: who,
        explanation: `Date of birth must be ISO YYYY-MM-DD internally, got ${JSON.stringify(r.dateOfBirth)}.`,
      });
    }
  }
  return out;
}

/**
 * Build the file.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO OMISSION RULES THAT ARE EASY TO GET BACKWARDS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 1. "Do not include employees who have zero hours and zero wages." BOTH, not
 *    either. Somebody with 40 hours and no wages stays in the file, and so does
 *    somebody with wages and no hours — the spec explicitly provides for the
 *    latter, saying "If there are no hours to report enter '0'", and its own
 *    example row has 4 hours against $70.00. Dropping on `||` instead of `&&`
 *    would silently delete real people from a filing. A mutation test flips it.
 *
 * 2. "Ensure there are no column totals in the file." No totals row. The 5208B
 *    on screen HAS a report total, because a human reading a form needs to see
 *    it foot. This file must not carry one. Two different artefacts for two
 *    different readers, and the gate asserts the last line is an employee.
 */
export function buildPaidLeaveCsv(
  rows: readonly PaidLeaveEmployeeRow[],
): PaidLeaveCsvResult {
  const refusals = validate(rows);
  if (refusals.length > 0) return { ok: false, refusals };

  const omitted: string[] = [];
  const lines: string[] = [PAID_LEAVE_HEADER];

  for (const r of rows) {
    const hours = paidLeaveHours(r.exactHours);
    // Rule 1 above: AND, never OR.
    if (hours === 0 && r.grossWagesCents === 0) {
      omitted.push(r.ssn);
      continue;
    }
    lines.push(
      [
        paidLeaveSsn(r.ssn),
        r.lastName,
        r.firstName,
        r.middleInitial,
        String(hours),
        paidLeaveWages(r.grossWagesCents),
        paidLeaveWaCares(r.waCaresExempt),
        paidLeaveDob(r.dateOfBirth),
      ].join(","),
    );
  }

  /*
   * Every line has exactly eight fields, including the empty middle initial.
   * "All columns must have a label, even if there is no data in that column" —
   * and by the same logic every ROW must have all eight commas. A row that
   * drops an empty trailing field shifts every later column left, which is how
   * a date of birth ends up in the WA Cares column.
   */
  for (const [i, line] of lines.entries()) {
    assert(
      line.split(",").length === PAID_LEAVE_COLUMN_COUNT,
      `line ${i} has ${line.split(",").length} fields, not ${PAID_LEAVE_COLUMN_COUNT}: ${line}`,
    );
  }

  return { ok: true, csv: lines.join("\n"), rowsWritten: lines.length - 1, omitted };
}
