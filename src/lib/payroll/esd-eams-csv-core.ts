/**
 * src/lib/payroll/esd-eams-csv-core.ts   (books-64)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE EAMS UNEMPLOYMENT WAGE FILE — AND ONLY THAT FILE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Michael, opening this slice:
 *
 *   "Let move into the Washington forms. Please work on esd first... When we go
 *    to do the pdf exports, we will need an export .csv for esd and pfml/ wa
 *    cares. Please research the upload structure and requirements for esd...
 *    Never guess."
 *
 * `esd-paid-leave-csv-core.ts` (books-56) writes the OTHER ESD file. This one
 * writes the unemployment-insurance wage file that EAMS imports. They are
 * siblings, and the whole reason this is a separate module rather than a flag on
 * that one is set out immediately below.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * TWO EIGHT-COLUMN ESD WAGE FILES, AND COLUMN 5 MEANS DIFFERENT THINGS
 * ───────────────────────────────────────────────────────────────────────────
 *
 *   EAMS / UNEMPLOYMENT (this module) — 8 columns, NO HEADER ROW:
 *     SSN, LastName, FirstName, MiddleName, Suffix, Hours, GrossWages, SOCCode
 *
 *   PAID LEAVE & WA CARES (the sibling) — 8 columns, HEADER ROW REQUIRED:
 *     SSN, LastName, FirstName, MiddleInitial, Hours, Wages,
 *     WACaresExempt(Y/N), DOB (MMDDYYYY)
 *
 * Same column COUNT. Different meanings from column 4 onward. Column 5 is a name
 * SUFFIX here and HOURS there. Column 7 is a six-digit occupation code here and
 * a Y/N flag there. And the header rules are exact opposites — ESD's EAMS
 * instructions say, verbatim:
 *
 *   "Do not label the columns. Also do not add any extra columns, headers,
 *    footers, totals, notes or comments. Start listing information for your
 *    first employee in row 1."
 *
 * while the Paid Leave spec requires the header row. ESD also says, plainly:
 *
 *   "If you are reporting wages for Paid Family & Medical Leave (Paid Leave),
 *    do not use EAMS."
 *
 * A file of the wrong shape is either rejected — the good outcome — or accepted
 * with 456 hours read as a name suffix. `assertTheTwoEsdFilesCannotBeConfused`
 * below is a permanent gate against the two formats ever converging.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THIS WRITES A FILE INSTEAD OF PRINTING THE 5208A AND 5208B
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Michael asked to see forms "as it would look if i were holding it in my hand",
 * and for the federal forms that is exactly what books-61..63 built, from the
 * IRS's own artwork and its own `/Widget` rectangles.
 *
 * The ESD forms cannot be treated the same way, and the reason is an authority
 * rather than a preference. WAC 192-310-010(3)(c)(ii):
 *
 *   "Paper forms supplied by the department (or an approved version of those
 *    forms). Agency forms include "drop-out ink" that cannot be copied.
 *    Therefore, photocopies are considered incorrectly formatted reports and
 *    forms."
 *
 * ESD's filing page says the same in plain words: "Our system cannot process
 * other forms or copies of our forms. To avoid an incomplete report penalty, get
 * paper forms from us." Both of Michael's real 5208s are stamped "THIS REPORT IS
 * EFILE ONLY".
 *
 * So a beautiful facsimile of the 5208A would be a document that is PENALISED if
 * filed. The honest artefact for ESD is the upload file plus a worksheet to read
 * on screen — which is what this module and the worksheet page provide.
 *
 * Two further measurements made the point structural rather than stylistic:
 *
 *   - `form 5208A.pdf` and `form 5208B.pdf` carry `/Widget: 0  /Rect: 0
 *     /FT: 0`, even after inflating all 30 and 32 compressed streams. The
 *     federal geometry pipeline reads exactly those entries, so it cannot be
 *     pointed at these files.
 *   - Those blanks are from 2011 (`5208A-final-draft-4-2011`) and their line
 *     numbering and wage base BOTH contradict Michael's filed 2026 returns:
 *     the blank prints gross wages on line 12 and "$37,300", his filing prints
 *     line 13 and "$78,200". Laying our figures onto that artwork would have
 *     put every amount beside the wrong caption. Rule 115.
 */
/*
 * A private `assert`, matching the house pattern.
 *
 * `form-box-core` declares `assert` privately and does NOT export it; four
 * sibling core modules — including `esd-paid-leave-csv-core` — each declare
 * their own. Extending that pattern rather than exporting one from a module that
 * deliberately keeps it private.
 */
function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`esd-eams-csv: ${message}`);
  }
}

import {
  EAMS_COLUMN_ORDER,
  PAID_LEAVE_HEADER,
} from "@/lib/payroll/esd-paid-leave-csv-core";

/* ═══════════════════════════════════════════════════════════════════════════
 * §1  THE SHAPE OF THE FILE, QUOTED FROM ESD
 * ═══════════════════════════════════════════════════════════════════════════ */

export const EAMS_AUTHORITY_PATH = "docs/authorities/state-wa/esd-eams-wage-file-import.txt";
export const EAMS_AUTHORITY_URL =
  "https://esd.wa.gov/employer-requirements/quarterly-reports/importing-wage-files-employer-account-management-system-eams";

export const EAMS_COLUMN_COUNT = 8;

/**
 * The maximum hours EAMS will accept in one quarter: "Cannot be blank or more
 * than 2,208."
 *
 * 2,208 is 24 x 92, the hours in the longest possible quarter. So the ceiling is
 * not an arbitrary limit but a physical one, and a figure above it is always a
 * data error rather than an unusually hard-working employee. That is why this
 * REFUSES instead of clamping: clamping would file a number nobody computed.
 */
export const EAMS_MAX_HOURS_PER_QUARTER = 2_208;

/** Column character limits, each one quoted in the refusal it drives. */
export const EAMS_MAX_LAST_NAME = 30;
export const EAMS_MAX_FIRST_NAME = 30;
export const EAMS_MAX_MIDDLE_NAME = 20;
export const EAMS_MAX_SUFFIX = 4;

/**
 * "No special characters except hyphens, apostrophes and spaces."
 *
 * Note what is NOT here: the comma, the period and the quotation mark. A period
 * is the interesting exclusion, because "Jr." and "III." are how many payroll
 * systems store a suffix, and ESD's own examples are "Jr", "Sr", "1st", "III" —
 * no periods. So a stored "Jr." is refused rather than silently stripped, since
 * stripping is an edit to a person's name made without being asked.
 */
const EAMS_NAME_ALLOWED = /^[A-Za-z\-' ]*$/;

/* ═══════════════════════════════════════════════════════════════════════════
 * §2  THE INPUT
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * One employee's row on the unemployment wage file.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY `socCode` IS `string` AND MAY BE EMPTY, WHILE PAID LEAVE'S DOB MAY NOT
 * ───────────────────────────────────────────────────────────────────────────
 *
 * The sibling module makes `dateOfBirth` mandatory because the Paid Leave spec
 * marks it Required and there is no honest default. ESD's rule for the SOC code
 * is different, and the difference is quoted: "Can be only 6 digits or blank."
 * Blank is expressly permitted. So an empty string here is a legitimate value
 * that ESD documents, not a gap being papered over — and a six-digit code that
 * Greenway has not actually determined would be a false statement about what
 * work a person does.
 *
 * Michael's filed 5208B shows `41-2031` (Retail Salespersons) against his staff,
 * which is 412031 without the hyphen. The engine does not hold SOC codes today,
 * so callers pass "" and the column is written empty, exactly as permitted.
 */
export type EamsEmployeeRow = {
  /** Nine digits, or empty — "Leave it blank. But don't add any spaces." */
  readonly ssn: string;
  /** "Cannot be blank." */
  readonly lastName: string;
  readonly firstName: string;
  /** A name OR an initial, up to 20 characters. Empty when it does not apply. */
  readonly middleName: string;
  /** "Jr", "Sr", "1st", "III". Empty when it does not apply. */
  readonly suffix: string;
  /**
   * Hours this quarter, EXACT and possibly fractional. Rounding is this
   * module's job because ESD dictates the direction.
   */
  readonly exactHours: number;
  /** Gross wages in integer cents. Never a float — this system's money rule. */
  readonly grossWagesCents: number;
  /** Six digits, or empty. See the docblock above. */
  readonly socCode: string;
};

export type EamsCsvRefusalCode =
  | "NO_EMPLOYEES"
  | "SSN_NOT_NINE_DIGITS"
  | "SSN_CONTAINS_SPACE"
  | "MISSING_LAST_NAME"
  | "NAME_TOO_LONG"
  | "NAME_HAS_FORBIDDEN_CHARACTER"
  | "NEGATIVE_HOURS"
  | "HOURS_ABOVE_QUARTER_MAXIMUM"
  | "MISSING_WAGES"
  | "NEGATIVE_WAGES"
  | "NON_INTEGER_CENTS"
  | "SOC_CODE_NOT_SIX_DIGITS";

export type EamsCsvRefusal = {
  readonly code: EamsCsvRefusalCode;
  readonly subject: string;
  readonly explanation: string;
};

export type EamsCsvResult =
  | {
      readonly ok: true;
      readonly csv: string;
      readonly rowsWritten: number;
      readonly omitted: readonly string[];
    }
  | { readonly ok: false; readonly refusals: readonly EamsCsvRefusal[] };

/* ═══════════════════════════════════════════════════════════════════════════
 * §3  THE COLUMN RULES, EACH ONE A QUOTED REQUIREMENT
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Hours: "Requires a positive whole number instead of a decimal. Round up
 * partial hours or fractions."
 *
 * CEILING, not the house half-up rounding. Identical in direction to the Paid
 * Leave file, and identically NOT the rule used anywhere else in this codebase.
 * `Math.round` would under-report by up to half an hour per person per quarter,
 * and hours are what ESD checks a claim against.
 */
export function eamsHours(exactHours: number): number {
  return Math.ceil(exactHours);
}

/**
 * Gross wages: "Decimals are OK. If you enter a decimal, you can include up to 2
 * digits to the right of the decimal."
 *
 * Built from integer cents by string surgery rather than by dividing, for the
 * same reason as the sibling module: division introduces a float into a money
 * path this system has worked hard to keep integral, and `toLocaleString` — the
 * obvious formatter — inserts a thousands separator that would split this field
 * across two CSV columns.
 */
export function eamsWages(grossWagesCents: number): string {
  assert(Number.isInteger(grossWagesCents), `wages must be integer cents, got ${grossWagesCents}`);
  assert(grossWagesCents >= 0, `wages must not be negative, got ${grossWagesCents}`);
  const dollars = Math.floor(grossWagesCents / 100);
  const cents = grossWagesCents % 100;
  return `${dollars}.${String(cents).padStart(2, "0")}`;
}

/**
 * SSN: "Format it with or without dashes... 123-45-6789 and 123456789 are both
 * OK. Leave it blank. But don't add any spaces."
 *
 * Written WITH dashes. Both forms are legal and one of them is safe: a bare
 * nine-digit string in a .csv is read as a NUMBER by every spreadsheet that
 * opens it, and a leading zero does not survive that. ESD's own error guidance
 * on the sibling file documents exactly this failure — "If '012345678' is
 * changed to '12345678', the SSN is invalid because it has only eight digits."
 * `012-34-5678` is not a number, so it survives a round trip through Excel.
 *
 * An empty SSN is returned empty, because ESD permits blank.
 */
export function eamsSsn(ssn: string): string {
  if (ssn.trim() === "") return "";
  const digits = ssn.replace(/[^0-9]/g, "");
  assert(digits.length === 9, `SSN must have nine digits, got ${digits.length}`);
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

/**
 * SOC code: "Can be only 6 digits or blank."
 *
 * Michael's filed 5208B prints `41-2031`; EAMS wants `412031`. So a hyphenated
 * code is normalised rather than refused — the hyphen is a display convention
 * for the same six digits, and the SOC standard itself writes them that way.
 * Anything that is not six digits after removing one optional hyphen refuses,
 * because "only 6 digits or blank" leaves no third option.
 */
export function eamsSocCode(socCode: string): string {
  if (socCode.trim() === "") return "";
  return socCode.replace(/-/g, "");
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §4  VALIDATION — REFUSALS, NEVER COERCIONS
 * ═══════════════════════════════════════════════════════════════════════════ */

function checkName(
  out: EamsCsvRefusal[],
  who: string,
  column: string,
  value: string,
  max: number,
): void {
  if (value.length > max) {
    out.push({
      code: "NAME_TOO_LONG",
      subject: who,
      explanation:
        `${column} is ${value.length} characters; EAMS allows up to ${max}. Truncating ` +
        `would file a name that is not the person's name, so this refuses instead.`,
    });
  }
  if (!EAMS_NAME_ALLOWED.test(value)) {
    out.push({
      code: "NAME_HAS_FORBIDDEN_CHARACTER",
      subject: who,
      explanation:
        `${column} is ${JSON.stringify(value)}. EAMS allows "no special characters except ` +
        `hyphens, apostrophes and spaces". A comma would also split this row into nine ` +
        `columns, and a period is not on ESD's list even though "Jr." is how many systems ` +
        `store a suffix. Fix the stored name rather than letting this file edit it.`,
    });
  }
}

function validate(rows: readonly EamsEmployeeRow[]): EamsCsvRefusal[] {
  const out: EamsCsvRefusal[] = [];

  if (rows.length === 0) {
    out.push({
      code: "NO_EMPLOYEES",
      subject: "(the whole file)",
      explanation:
        "There are no employees to report. An empty wage file is not the same as a " +
        "no-payroll quarter: ESD wants a no-payroll report filed a different way (its own " +
        'page says to call 888-836-1900 or use the "no payroll" flow), so writing a ' +
        "zero-row file here would look like a filing while telling ESD nothing.",
    });
    return out;
  }

  for (const r of rows) {
    const who = `${r.lastName || "(no last name)"}, ${r.firstName} [${r.ssn || "no SSN"}]`;

    if (r.ssn.trim() !== "") {
      if (/\s/.test(r.ssn)) {
        out.push({
          code: "SSN_CONTAINS_SPACE",
          subject: who,
          explanation:
            `SSN ${JSON.stringify(r.ssn)} contains a space. ESD is explicit: "Leave it ` +
            `blank. But don't add any spaces."`,
        });
      }
      const digits = r.ssn.replace(/[^0-9]/g, "");
      if (digits.length !== 9) {
        out.push({
          code: "SSN_NOT_NINE_DIGITS",
          subject: who,
          explanation:
            `SSN has ${digits.length} digits, not nine. An SSN or ITIN is a 9-digit ` +
            `number. Blank is allowed; a wrong-length number is not.`,
        });
      }
    }

    if (r.lastName.trim() === "") {
      out.push({
        code: "MISSING_LAST_NAME",
        subject: who,
        explanation:
          'Column B (last name) "Cannot be blank." It is one of the three columns ESD ' +
          "requires in every completed row, alongside hours and gross wages.",
      });
    }

    checkName(out, who, "Last name (column B)", r.lastName, EAMS_MAX_LAST_NAME);
    checkName(out, who, "First name (column C)", r.firstName, EAMS_MAX_FIRST_NAME);
    checkName(out, who, "Middle name (column D)", r.middleName, EAMS_MAX_MIDDLE_NAME);
    checkName(out, who, "Suffix (column E)", r.suffix, EAMS_MAX_SUFFIX);

    if (r.exactHours < 0) {
      out.push({
        code: "NEGATIVE_HOURS",
        subject: who,
        explanation: `Hours cannot be negative, got ${r.exactHours}. ESD requires "a positive whole number".`,
      });
    }
    if (eamsHours(r.exactHours) > EAMS_MAX_HOURS_PER_QUARTER) {
      out.push({
        code: "HOURS_ABOVE_QUARTER_MAXIMUM",
        subject: who,
        explanation:
          `Hours round up to ${eamsHours(r.exactHours)}, and EAMS "cannot be blank or more ` +
          `than ${EAMS_MAX_HOURS_PER_QUARTER}". That ceiling is 24 x 92 — every hour in the ` +
          `longest possible quarter — so a figure above it is always a data error, never a ` +
          `hard-working employee. Clamping it would file a number nobody computed.`,
      });
    }

    if (!Number.isInteger(r.grossWagesCents)) {
      out.push({
        code: "NON_INTEGER_CENTS",
        subject: who,
        explanation:
          `Wages must be integer cents, got ${r.grossWagesCents}. A fractional cent means ` +
          `a float leaked into a money path.`,
      });
    } else if (r.grossWagesCents < 0) {
      out.push({
        code: "NEGATIVE_WAGES",
        subject: who,
        explanation:
          `Gross wages cannot be negative, got ${r.grossWagesCents} cents. ESD: "Requires a ` +
          `positive number. Do not enter a negative value." A refund or correction is an ` +
          `amended return, not a negative row.`,
      });
    }

    const soc = eamsSocCode(r.socCode);
    if (soc !== "" && !/^\d{6}$/.test(soc)) {
      out.push({
        code: "SOC_CODE_NOT_SIX_DIGITS",
        subject: who,
        explanation:
          `SOC code ${JSON.stringify(r.socCode)} normalises to ${JSON.stringify(soc)}, which ` +
          `is not six digits. ESD: "Can be only 6 digits or blank." Blank is a legitimate ` +
          `value; a malformed code is not, and inventing one would state what work this ` +
          `person does without knowing.`,
      });
    }
  }

  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §5  THE WRITER
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Build the EAMS unemployment wage file.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THREE RULES THAT ARE EASY TO GET BACKWARDS
 * ───────────────────────────────────────────────────────────────────────────
 *
 * 1. NO HEADER ROW. "Do not label the columns... Start listing information for
 *    your first employee in row 1." The sibling file REQUIRES a header. Getting
 *    this backwards on either file turns row 1 into either a lost employee or a
 *    person named "LastName".
 *
 * 2. NO TOTALS, FOOTERS OR NOTES. "do not add any extra columns, headers,
 *    footers, totals, notes or comments." The 5208B worksheet on screen DOES
 *    foot to a total, because a human checking a form needs to see it balance.
 *    Two artefacts, two readers. The gate asserts the last line is an employee.
 *
 * 3. Every row carries all eight fields even when the last ones are empty. A row
 *    that drops an empty trailing field shifts every later column left, which is
 *    how an hours figure becomes a name suffix.
 *
 * Unlike the Paid Leave file, ESD publishes no "omit zero-hours zero-wage
 * people" rule for EAMS — so nobody is dropped, and `omitted` stays empty. It is
 * kept in the return type so both writers answer the same shape to one caller.
 */
export function buildEamsCsv(rows: readonly EamsEmployeeRow[]): EamsCsvResult {
  const refusals = validate(rows);
  if (refusals.length > 0) return { ok: false, refusals };

  const lines: string[] = [];

  for (const r of rows) {
    lines.push(
      [
        eamsSsn(r.ssn),
        r.lastName,
        r.firstName,
        r.middleName,
        r.suffix,
        String(eamsHours(r.exactHours)),
        eamsWages(r.grossWagesCents),
        eamsSocCode(r.socCode),
      ].join(","),
    );
  }

  for (const [i, line] of lines.entries()) {
    assert(
      line.split(",").length === EAMS_COLUMN_COUNT,
      `line ${i} has ${line.split(",").length} fields, not ${EAMS_COLUMN_COUNT}: ${line}`,
    );
  }

  assert(
    lines.length === rows.length,
    `wrote ${lines.length} lines for ${rows.length} employees; EAMS forbids any extra ` +
      `"headers, footers, totals, notes or comments", so the counts must match exactly`,
  );

  return { ok: true, csv: lines.join("\n"), rowsWritten: lines.length, omitted: [] };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §6  THE GATE AGAINST THE TWO FILES CONVERGING
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Prove the two eight-column ESD files can never be mistaken for each other.
 *
 * This is the one check that cannot be written inside either module alone, and
 * it is the check that matters most: both files are eight comma-separated
 * columns of names and numbers, so a human glancing at either one cannot tell
 * them apart, and ESD's own systems will happily read hours as a suffix.
 *
 * It deliberately does NOT count-pin anything a comparison can discover
 * (rule 129). It asserts the RELATIONSHIPS: the orders differ, the header rules
 * are opposites, and an EAMS file never begins with the Paid Leave header.
 */
export function assertTheTwoEsdFilesCannotBeConfused(sampleEamsCsv: string): void {
  assert(
    EAMS_COLUMN_ORDER.length === EAMS_COLUMN_COUNT,
    `the recorded EAMS column order has ${EAMS_COLUMN_ORDER.length} columns but this writer ` +
      `emits ${EAMS_COLUMN_COUNT}`,
  );

  const paidLeaveColumns = PAID_LEAVE_HEADER.split(",");
  assert(
    paidLeaveColumns.length === EAMS_COLUMN_ORDER.length,
    "the two files no longer have the same column count — which would make this gate " +
      "pointless, but also means one of the specs changed and must be re-read",
  );
  assert(
    paidLeaveColumns.join("|") !== EAMS_COLUMN_ORDER.join("|"),
    "the two ESD wage files now describe the same columns in the same order. One of them " +
      "has been edited to match the other, and a file is about to be uploaded to the wrong " +
      "programme",
  );

  const firstLine = sampleEamsCsv.split("\n")[0] ?? "";
  assert(
    firstLine !== PAID_LEAVE_HEADER,
    "this EAMS file starts with the Paid Leave header row. EAMS: \"Do not label the " +
      'columns... Start listing information for your first employee in row 1."',
  );
  assert(
    !/^SSN,/i.test(firstLine),
    `this EAMS file appears to start with a header row (${JSON.stringify(firstLine)}). ` +
      `EAMS forbids one, and row 1 must already be an employee`,
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §7  SELF-TESTS
 * ═══════════════════════════════════════════════════════════════════════════ */

function eq<T>(actual: T, expected: T, what: string): void {
  if (actual !== expected) {
    throw new Error(`esd-eams-csv self-test: ${what}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

/**
 * Runs the pure checks. Called by `scripts/compliance/run-pure-selftests.ts`
 * and by the vitest gate, so the same assertions guard both the build and CI.
 */
export function __runEsdEamsCsvTests(): void {
  /* ---- the column rules ------------------------------------------------- */

  eq(eamsHours(152.25), 153, "152.25 hours rounds UP to 153");
  eq(eamsHours(152.01), 153, "any fraction rounds up, not to nearest");
  eq(eamsHours(152), 152, "a whole number is unchanged");
  eq(eamsHours(0), 0, "zero hours stays zero");

  eq(eamsWages(4_532_222), "45322.22", "cents become dollars with two places");
  eq(eamsWages(0), "0.00", "zero wages still print two decimal places");
  eq(eamsWages(6_153_121), "61531.21", "Michael's filed Q1 gross, to the cent");
  eq(
    eamsWages(123_456_789).includes(","),
    false,
    "no thousands separator, which would split the CSV column",
  );

  eq(eamsSsn("531231883"), "531-23-1883", "a bare SSN gains dashes so Excel cannot eat it");
  eq(eamsSsn("531-23-1883"), "531-23-1883", "an already-dashed SSN is unchanged");
  eq(eamsSsn("012345678"), "012-34-5678", "the leading zero survives, which is the whole point");
  eq(eamsSsn(""), "", "blank is permitted and stays blank");

  eq(eamsSocCode("41-2031"), "412031", "the SOC hyphen is a display convention");
  eq(eamsSocCode("412031"), "412031", "an unhyphenated code is unchanged");
  eq(eamsSocCode(""), "", "blank is expressly permitted");

  /* ---- a real file, from his own filed wage detail ---------------------- */

  const good: EamsEmployeeRow[] = [
    {
      ssn: "531231883",
      lastName: "BENOIT",
      firstName: "STEPHEN",
      middleName: "",
      suffix: "",
      exactHours: 451,
      grossWagesCents: 1_399_650,
      socCode: "41-2031",
    },
    {
      ssn: "534298006",
      lastName: "CLARK",
      firstName: "AUTUMN",
      middleName: "E",
      suffix: "",
      exactHours: 123.4,
      grossWagesCents: 212_601,
      socCode: "",
    },
  ];

  const built = buildEamsCsv(good);
  eq(built.ok, true, "a clean two-employee file is written");
  if (!built.ok) throw new Error("unreachable");
  eq(built.rowsWritten, good.length, "one line per employee");
  const written = built.csv.split("\n");
  eq(written.length, good.length, "no header, no footer, no totals row");
  eq(
    written[0],
    "531-23-1883,BENOIT,STEPHEN,,,451,13996.50,412031",
    "row 1 is an employee and carries all eight fields",
  );
  eq(
    written[1],
    "534-29-8006,CLARK,AUTUMN,E,,124,2126.01,",
    "123.4 hours rounds up to 124 and an empty SOC code still leaves its column present",
  );

  assertTheTwoEsdFilesCannotBeConfused(built.csv);

  /* ---- the refusals ----------------------------------------------------- */

  const refuse = (row: Partial<EamsEmployeeRow>, code: EamsCsvRefusalCode, what: string): void => {
    const r = buildEamsCsv([{ ...good[0], ...row }]);
    eq(r.ok, false, `${what} is refused`);
    if (r.ok) throw new Error("unreachable");
    eq(
      r.refusals.some((x) => x.code === code),
      true,
      `${what} refuses with ${code}, got ${r.refusals.map((x) => x.code).join("+")}`,
    );
  };

  refuse({ lastName: "" }, "MISSING_LAST_NAME", "a blank last name");
  refuse({ lastName: "O,BRIEN" }, "NAME_HAS_FORBIDDEN_CHARACTER", "a comma in a name");
  refuse({ suffix: "Jr." }, "NAME_HAS_FORBIDDEN_CHARACTER", "a period in a suffix");
  refuse({ suffix: "Junior" }, "NAME_TOO_LONG", "a suffix over four characters");
  refuse({ ssn: "5312318" }, "SSN_NOT_NINE_DIGITS", "a short SSN");
  refuse({ ssn: "531 23 1883" }, "SSN_CONTAINS_SPACE", "a space in an SSN");
  refuse({ exactHours: -1 }, "NEGATIVE_HOURS", "negative hours");
  refuse({ exactHours: 2_209 }, "HOURS_ABOVE_QUARTER_MAXIMUM", "hours above 2,208");
  refuse({ grossWagesCents: -1 }, "NEGATIVE_WAGES", "negative wages");
  refuse({ grossWagesCents: 10.5 }, "NON_INTEGER_CENTS", "a fractional cent");
  refuse({ socCode: "4120" }, "SOC_CODE_NOT_SIX_DIGITS", "a four-digit SOC code");

  const empty = buildEamsCsv([]);
  eq(empty.ok, false, "an empty file is refused rather than filed as nothing");

  /* ---- 2,208 is a boundary, so both sides of it are checked ------------- */

  const atCeiling = buildEamsCsv([{ ...good[0], exactHours: EAMS_MAX_HOURS_PER_QUARTER }]);
  eq(atCeiling.ok, true, "exactly 2,208 hours is accepted — the limit is inclusive");
}
