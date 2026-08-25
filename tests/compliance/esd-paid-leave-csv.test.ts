/**
 * tests/compliance/esd-paid-leave-csv.test.ts   (books-56)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE PAID LEAVE / WA CARES CSV IS GATED AGAINST ESD'S OWN SAMPLE FILE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Michael uploads this file to the ESD portal himself, every quarter. If it is
 * malformed, the good outcome is rejection; the bad outcome is acceptance of a
 * file that means something false about a real person's wages or exemption.
 *
 * So the fixture here is not one I invented. It is the three-row sample ESD
 * prints on page 3 of the v8 specification under the caption "If opened in a
 * plain text editor, your final .csv file should look like this", transcribed
 * at `docs/authorities/state-wa/esd-paid-leave-csv-plain-text-sample.txt` and
 * read out of that file at test time rather than retyped here.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE FIXTURE IS READ FROM THE MIRROR INSTEAD OF PASTED INTO THIS FILE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A pasted expectation drifts silently from its source. If a future reader
 * corrects the transcription — and the transcription's own risk register admits
 * exactly which characters could be wrong — a pasted copy here keeps passing
 * against the stale bytes. Reading the mirror means the authority and the
 * expectation cannot disagree without a test failing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS GATE CANNOT DO, STATED SO NOBODY OVERTRUSTS IT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ESD's sample is a MOCK-UP, not a real filing: it contains a curly apostrophe
 * in `O’Brian`, which a genuine ANSI-encoded Notepad file would not carry. So
 * matching it byte for byte proves the writer agrees with the department's
 * published illustration. It does not prove the portal accepts the file — only
 * ESD's own test tool at `resources.paidleave.wa.gov/single-employer-filing`
 * can establish that, and the specification tells filers to use it. That limit
 * is recorded in the owner report, not hidden here.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  EAMS_COLUMN_ORDER,
  PAID_LEAVE_COLUMN_COUNT,
  PAID_LEAVE_HEADER,
  buildPaidLeaveCsv,
  paidLeaveDob,
  paidLeaveHours,
  paidLeaveSsn,
  paidLeaveWaCares,
  paidLeaveWages,
  type PaidLeaveEmployeeRow,
} from "@/lib/payroll/esd-paid-leave-csv-core";

const REPO = process.cwd();
const SAMPLE_MIRROR = path.join(
  REPO,
  "docs/authorities/state-wa/esd-paid-leave-csv-plain-text-sample.txt",
);
const SPEC_MIRROR = path.join(
  REPO,
  "docs/authorities/state-wa/esd-paid-leave-wa-cares-csv-spec-v8.txt",
);

const SAMPLE_TEXT = readFileSync(SAMPLE_MIRROR, "utf8");
const SPEC_TEXT = readFileSync(SPEC_MIRROR, "utf8");

/**
 * A whitespace-normalised view of the specification, for quoting prose.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS, AND WHY THE MIRROR IS NOT REFLOWED INSTEAD
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Three assertions in the first run of this file failed because I had guessed
 * where ESD's PDF wraps its lines. It wraps "…list each" / "employee in a
 * separate row…" mid-sentence and then indents the continuation by two spaces,
 * which no amount of care will reliably predict from memory.
 *
 * The wrong fix is to reflow the mirrored authority so my regex matches. That
 * edits the law to suit the test. The right fix is to compare against a view
 * that treats any run of whitespace as one space, which is what a reader means
 * by "the document says this". The mirror keeps ESD's bytes exactly as
 * `pdftotext` produced them.
 *
 * Byte-for-byte comparison is still used where bytes are the point: the header
 * row and the sample data rows are compared literally, never through this view.
 */
const SPEC_FLAT = SPEC_TEXT.replace(/\s+/g, " ");

/**
 * Pull the four unquoted sample lines out of the mirror.
 *
 * Anchored on the header line rather than on a line number, so that editing the
 * mirror's prose cannot silently shift what the fixture is.
 */
function unquotedSampleLines(): readonly string[] {
  const lines = SAMPLE_TEXT.split("\n");
  const start = lines.findIndex((l) => l.startsWith("SSN,LastName,"));
  expect(
    start,
    "the mirror must contain the unquoted sample, beginning with a header line " +
      "that starts `SSN,LastName,` — if this fails, the mirror was edited and the " +
      "fixture no longer has a source",
  ).toBeGreaterThan(-1);
  const block = lines.slice(start, start + 4).map((l) => l.trimEnd());
  for (const [i, l] of block.entries()) {
    expect(l.split(",").length, `sample line ${i} must have eight fields`).toBe(
      PAID_LEAVE_COLUMN_COUNT,
    );
  }
  return block;
}

function quotedSampleLines(): readonly string[] {
  const lines = SAMPLE_TEXT.split("\n");
  const start = lines.findIndex((l) => l.startsWith('"SSN","LastName",'));
  expect(start, "the mirror must contain the quoted sample too").toBeGreaterThan(-1);
  return lines.slice(start, start + 4).map((l) => l.trimEnd());
}

/**
 * The three employees of ESD's sample, expressed as this system's input type.
 *
 * Note what has to be converted, because each conversion is a place the writer
 * could go wrong: hours arrive exact and may be fractional, money arrives in
 * integer cents, dates arrive ISO, and the WA Cares answer arrives as a boolean
 * that a human has already decided.
 */
const SAMPLE_ROWS: readonly PaidLeaveEmployeeRow[] = [
  {
    ssn: "123-33-1234",
    lastName: "Doe",
    firstName: "John",
    middleInitial: "B",
    exactHours: 1200,
    grossWagesCents: 4_532_222,
    waCaresExempt: true,
    dateOfBirth: "1990-01-01",
  },
  {
    ssn: "034-35-4567",
    lastName: "Smith",
    firstName: "Jane",
    middleInitial: "",
    exactHours: 4,
    grossWagesCents: 7_000,
    waCaresExempt: false,
    dateOfBirth: "2000-12-11",
  },
  {
    // Bare nine digits on input; the writer hyphenates on output.
    ssn: "143556786",
    lastName: "O\u2019Brian",
    firstName: "Robert",
    middleInitial: "H",
    exactHours: 1300,
    grossWagesCents: 500_050,
    waCaresExempt: false,
    dateOfBirth: "1989-08-18",
  },
];

function ok(res: ReturnType<typeof buildPaidLeaveCsv>): {
  csv: string;
  rowsWritten: number;
  omitted: readonly string[];
} {
  if (!res.ok) {
    throw new Error(
      `expected the writer to produce a file, but it refused: ${JSON.stringify(res.refusals, null, 2)}`,
    );
  }
  return res;
}

function refusalCodes(res: ReturnType<typeof buildPaidLeaveCsv>): readonly string[] {
  if (res.ok) throw new Error("expected a refusal, but the writer produced a file");
  return res.refusals.map((r) => r.code);
}

describe("the fixture is really ESD's, and is not vacuous", () => {
  it("finds a four-line unquoted sample in the mirror", () => {
    const s = unquotedSampleLines();
    expect(s).toHaveLength(4);
    // Guard against a mirror that has been emptied or stubbed: the three data
    // rows must carry the names ESD prints.
    expect(s[1]).toContain("Doe");
    expect(s[2]).toContain("Smith");
    expect(s[3]).toContain("Brian");
    expect(SAMPLE_TEXT.length).toBeGreaterThan(4_000);
  });

  it("finds the quoted sample too, since ESD calls that form acceptable", () => {
    const q = quotedSampleLines();
    expect(q).toHaveLength(4);
    expect(q[0]).toBe(
      '"SSN","LastName","FirstName","MiddleInitial","Hours","Wages","WACaresExempt(Y/N)","DOB (MMDDYYYY)"',
    );
    expect(SPEC_FLAT).toContain("This file format is acceptable");
  });

  it("keeps the transcription risk register, which is the honesty of the mirror", () => {
    expect(SAMPLE_TEXT).toContain("TRANSCRIPTION RISK REGISTER");
    // The one disagreement between the two instruments must stay recorded.
    expect(SAMPLE_TEXT).toContain("12/11/2000");
    expect(SAMPLE_TEXT).toContain("12112000");
  });
});

describe("the header row is ESD's, including its inconsistent spacing", () => {
  it("matches the sample's header byte for byte", () => {
    expect(PAID_LEAVE_HEADER).toBe(unquotedSampleLines()[0]);
  });

  it("keeps `WACaresExempt(Y/N)` unspaced and `DOB (MMDDYYYY)` spaced", () => {
    /*
     * This is the assertion that stops a future tidy-up. The two headings are
     * inconsistent with each other, which reads like a typo and is not one — it
     * is what the department prints in the padded table AND in both sample
     * screenshots. Normalising it is the kind of improvement that gets a file
     * rejected.
     */
    expect(PAID_LEAVE_HEADER).toContain("WACaresExempt(Y/N)");
    expect(PAID_LEAVE_HEADER).not.toContain("WACaresExempt (Y/N)");
    expect(PAID_LEAVE_HEADER).toContain("DOB (MMDDYYYY)");
    expect(PAID_LEAVE_HEADER).not.toContain("DOB(MMDDYYYY)");
    expect(SPEC_TEXT).toContain("WACaresExempt(Y/N)");
  });

  it("has eight columns, and the spec demands all eight be labelled", () => {
    expect(PAID_LEAVE_HEADER.split(",")).toHaveLength(PAID_LEAVE_COLUMN_COUNT);
    expect(SPEC_FLAT).toContain(
      "All columns must have a label, even if there is no data in that column.",
    );
  });
});

describe("the writer reproduces ESD's sample file exactly", () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * MY FIRST VERSION OF THIS TEST CLAIMED MORE THAN THE WRITER DOES
   * ───────────────────────────────────────────────────────────────────────────
   *
   * I asserted the whole file equalled ESD's sample byte for byte. It failed on
   * row 3, and the failure was correct: the writer is not a photocopier, and on
   * two fields it deliberately chooses the safer of two spec-legal forms.
   *
   *   ESD's row 3:  143556786,O’Brian,Robert,H,1300,5000.50,,08181989
   *   ours:         143-55-6786,O’Brian,Robert,H,1300,5000.50,N,08181989
   *
   *   • SSN. ESD writes it bare; we hyphenate. "hyphens are optional", and the
   *     department's own errors page explains why the hyphenated form is safer:
   *     "When an SSN starts with zeros, the zeros are sometimes removed."
   *   • WA Cares. ESD leaves it empty; we write N. "Otherwise enter 'N' for no
   *     or leave blank." A written N distinguishes "asked and answered no" from
   *     "this column failed to export".
   *
   * So the honest gate is: rows 1 and 2 byte for byte, row 3 identical in the
   * six fields where no choice exists, differing ONLY in the two where the spec
   * offers a choice — and the differences pinned to exact expected values so
   * they can never widen unnoticed. Weakening the test to a loose match would
   * have hidden the very normalisation it should be documenting.
   */
  it("reproduces ESD's rows 1 and 2 byte for byte", () => {
    const res = ok(buildPaidLeaveCsv(SAMPLE_ROWS));
    const ours = res.csv.split("\n");
    const theirs = unquotedSampleLines();
    expect(ours[0]).toBe(theirs[0]);
    expect(ours[1]).toBe(theirs[1]);
    expect(ours[2]).toBe(theirs[2]);
    expect(res.rowsWritten).toBe(3);
    expect(res.omitted).toEqual([]);
  });

  it("differs from ESD's row 3 in exactly two fields, both by choice", () => {
    const ours = ok(buildPaidLeaveCsv(SAMPLE_ROWS)).csv.split("\n")[3].split(",");
    const theirs = unquotedSampleLines()[3].split(",");

    const differing = ours
      .map((f, i) => (f === theirs[i] ? null : i))
      .filter((i): i is number => i !== null);
    // Column 0 is SSN, column 6 is WA Cares. Nothing else may differ.
    expect(differing).toEqual([0, 6]);

    expect(theirs[0]).toBe("143556786");
    expect(ours[0]).toBe("143-55-6786");
    expect(theirs[6]).toBe("");
    expect(ours[6]).toBe("N");

    // The six fields where the spec allows no choice must match exactly.
    for (const i of [1, 2, 3, 4, 5, 7]) {
      expect(ours[i], `column ${i} must match ESD's sample exactly`).toBe(theirs[i]);
    }

    // Both of our choices must be forms the specification permits.
    expect(SPEC_FLAT).toContain("9-digit number, hyphens are optional.");
    expect(SPEC_FLAT).toContain("Otherwise enter \u2018N\u2019 for no or leave blank.");
  });

  it("keeps the curly apostrophe of `O’Brian`, which both instruments confirm", () => {
    /*
     * A real ANSI Notepad file is an odd home for U+2019, so this is evidence
     * the sample is a mock-up. It is still what ESD published, and the padded
     * table extracts the same character, so two independent readings agree. The
     * writer must not silently "fix" a name.
     */
    const ours = ok(buildPaidLeaveCsv(SAMPLE_ROWS)).csv;
    expect(ours).toContain("O\u2019Brian");
    expect(ours).not.toContain("O'Brian");
    expect(SPEC_TEXT).toContain("O\u2019Brian");
  });

  it("writes an absent middle initial as an empty field, never as a dropped one", () => {
    const res = ok(buildPaidLeaveCsv(SAMPLE_ROWS));
    const jane = res.csv.split("\n")[2];
    // ESD's row 2: `034-35-4567,Smith,Jane,,4,70.00,N,12112000`
    expect(jane).toContain("Smith,Jane,,4,");
    expect(jane.split(",")).toHaveLength(PAID_LEAVE_COLUMN_COUNT);
  });

  it("gives every line seven commas, so no column can shift left", () => {
    const res = ok(buildPaidLeaveCsv(SAMPLE_ROWS));
    for (const line of res.csv.split("\n")) {
      expect(line.split(",").length, `wrong field count: ${line}`).toBe(
        PAID_LEAVE_COLUMN_COUNT,
      );
    }
  });

  it("ends on an employee, because column totals are forbidden", () => {
    const res = ok(buildPaidLeaveCsv(SAMPLE_ROWS));
    const lines = res.csv.split("\n");
    expect(lines[lines.length - 1]).toContain("Brian");
    expect(res.csv.toLowerCase()).not.toContain("total");
    expect(SPEC_TEXT).toContain("Ensure there are no column totals in the file.");
  });
});

describe("hours round UP, which is not this codebase's usual rule", () => {
  it("uses the spec's own worked example: 152.25 becomes 153", () => {
    /*
     * Quoted from the "How to fix common errors" page: "All hours must be
     * reported as whole numbers. Round up to the nearest whole number. 152.25
     * hours should be reported as 153 hours."
     */
    expect(SPEC_TEXT).toContain("Round up to the nearest whole number. 152.25");
    expect(paidLeaveHours(152.25)).toBe(153);
  });

  it("rounds up even a hundredth of an hour, where half-up would round down", () => {
    // The mutation that matters: Math.round(152.01) is 152, and would
    // under-report. Math.ceil is 153.
    expect(paidLeaveHours(152.01)).toBe(153);
    expect(paidLeaveHours(0.01)).toBe(1);
  });

  it("leaves whole hours alone and keeps zero at zero", () => {
    expect(paidLeaveHours(164)).toBe(164);
    expect(paidLeaveHours(0)).toBe(0);
  });
});

describe("wages carry two decimals and never a thousands separator", () => {
  it("formats the sample's three amounts exactly", () => {
    expect(paidLeaveWages(4_532_222)).toBe("45322.22");
    expect(paidLeaveWages(7_000)).toBe("70.00");
    expect(paidLeaveWages(500_050)).toBe("5000.50");
  });

  it("never inserts a comma, however large the amount", () => {
    // The obvious money formatter, toLocaleString, would render this
    // "1,234,567.89" — the one thing the spec forbids.
    expect(paidLeaveWages(123_456_789)).toBe("1234567.89");
    expect(paidLeaveWages(123_456_789)).not.toContain(",");
    expect(SPEC_TEXT).toContain(
      "Must include a decimal mark and two decimal places. Do not include a comma.",
    );
  });

  it("keeps two decimal places for whole dollars and for single cents", () => {
    expect(paidLeaveWages(100_000)).toBe("1000.00");
    expect(paidLeaveWages(1)).toBe("0.01");
    expect(paidLeaveWages(0)).toBe("0.00");
  });
});

describe("the SSN is written hyphenated, to protect a leading zero", () => {
  it("hyphenates a bare nine-digit input", () => {
    expect(paidLeaveSsn("143556786")).toBe("143-55-6786");
  });

  it("preserves a leading zero, the failure ESD documents by name", () => {
    expect(paidLeaveSsn("012345678")).toBe("012-34-5678");
    expect(paidLeaveSsn("034-35-4567")).toBe("034-35-4567");
    expect(SPEC_TEXT).toContain("When an SSN starts with zeros, the zeros are");
  });

  it("accepts either input form, since hyphens are optional on input", () => {
    expect(paidLeaveSsn("123-33-1234")).toBe(paidLeaveSsn("123331234"));
    expect(SPEC_TEXT).toContain("9-digit number, hyphens are optional.");
  });
});

describe("the date of birth is written unpunctuated, as in ESD's finished file", () => {
  it("converts ISO to MMDDYYYY for all three sample employees", () => {
    expect(paidLeaveDob("1990-01-01")).toBe("01011990");
    expect(paidLeaveDob("2000-12-11")).toBe("12112000");
    expect(paidLeaveDob("1989-08-18")).toBe("08181989");
  });

  it("writes row 2 as `12112000`, not as the table's `12/11/2000`", () => {
    /*
     * This is the finding that the screenshot corrected. The padded table shows
     * `12/11/2000`; the finished file shows `12112000`. The file is the
     * authority for what a file contains.
     */
    const res = ok(buildPaidLeaveCsv(SAMPLE_ROWS));
    expect(res.csv).toContain("12112000");
    expect(res.csv).not.toContain("12/11/2000");
    /*
     * "No slashes" must be asserted of the DATA ROWS, not of the whole file.
     * My first attempt said `expect(res.csv).not.toContain("/")` and it failed
     * — correctly — because the header legitimately contains `(Y/N)`. The test
     * was wrong, not the writer. Worth keeping as a caution: an assertion
     * broader than the thing it means will eventually fail on something
     * innocent, and the temptation then is to weaken it into uselessness.
     */
    const dataRows = res.csv.split("\n").slice(1);
    expect(dataRows).toHaveLength(3);
    for (const row of dataRows) {
      expect(row, `no date separators belong in a data row: ${row}`).not.toContain("/");
      expect(row).not.toContain("-19");
      expect(row).not.toContain("-20");
    }
  });

  it("keeps the leading zero of a January date, which a number would lose", () => {
    expect(paidLeaveDob("1990-01-01").startsWith("0")).toBe(true);
    expect(paidLeaveDob("1990-01-01")).toHaveLength(8);
  });
});

describe("WA Cares is Y or N and is never decided by the engine", () => {
  it("writes Y only for a held exemption letter", () => {
    expect(paidLeaveWaCares(true)).toBe("Y");
    expect(paidLeaveWaCares(false)).toBe("N");
  });

  it("keeps the spec's permission for a blank on record, though we write N", () => {
    expect(SPEC_TEXT).toContain("Otherwise enter \u2018N\u2019 for no or leave blank.");
  });
});

describe("employees with zero hours AND zero wages are omitted — and only those", () => {
  const base = SAMPLE_ROWS[0];

  it("omits somebody with neither hours nor wages", () => {
    const res = ok(
      buildPaidLeaveCsv([
        base,
        { ...base, ssn: "999-99-9999", lastName: "Nobody", exactHours: 0, grossWagesCents: 0 },
      ]),
    );
    expect(res.rowsWritten).toBe(1);
    expect(res.omitted).toEqual(["999-99-9999"]);
    expect(res.csv).not.toContain("Nobody");
  });

  it("KEEPS somebody with wages but no hours, which `||` would have deleted", () => {
    /*
     * The rule is AND. The spec says "Do not include employees who have zero
     * hours and zero wages", and separately says "If there are no hours to
     * report enter '0'" — an instruction that only makes sense for a row that
     * gets filed. An `||` here silently deletes a paid person from a filing.
     */
    const res = ok(
      buildPaidLeaveCsv([
        { ...base, ssn: "111-11-1111", lastName: "Paid", exactHours: 0, grossWagesCents: 5_000 },
      ]),
    );
    expect(res.rowsWritten).toBe(1);
    expect(res.omitted).toEqual([]);
    expect(res.csv).toContain("Paid");
    expect(res.csv).toContain(",0,50.00,");
    expect(SPEC_TEXT).toContain(
      "Do not include employees who have zero hours and zero wages.",
    );
  });

  it("KEEPS somebody with hours but no wages", () => {
    const res = ok(
      buildPaidLeaveCsv([
        { ...base, ssn: "222-22-2222", lastName: "Unpaid", exactHours: 40, grossWagesCents: 0 },
      ]),
    );
    expect(res.rowsWritten).toBe(1);
    expect(res.csv).toContain("Unpaid");
    expect(res.csv).toContain(",40,0.00,");
  });

  it("judges omission on ROUNDED hours, not exact ones", () => {
    /*
     * A quarter of an hour with no wages rounds UP to 1, so the row is filed.
     * Deciding on exactHours would drop it — which would be a person vanishing
     * from a filing because of a rounding rule applied in the wrong order.
     */
    const res = ok(
      buildPaidLeaveCsv([
        { ...base, ssn: "333-33-3333", lastName: "Fraction", exactHours: 0.25, grossWagesCents: 0 },
      ]),
    );
    expect(res.rowsWritten).toBe(1);
    expect(res.csv).toContain(",1,0.00,");
  });
});

describe("the writer refuses rather than inventing", () => {
  const base = SAMPLE_ROWS[0];

  it("refuses an empty roster, because that is a missing report not an empty one", () => {
    expect(refusalCodes(buildPaidLeaveCsv([]))).toEqual(["NO_EMPLOYEES"]);
  });

  it("refuses a missing date of birth instead of guessing one", () => {
    expect(refusalCodes(buildPaidLeaveCsv([{ ...base, dateOfBirth: "" }]))).toEqual([
      "MISSING_DOB",
    ]);
  });

  it("refuses a malformed date of birth", () => {
    expect(refusalCodes(buildPaidLeaveCsv([{ ...base, dateOfBirth: "01/01/1990" }]))).toEqual([
      "MALFORMED_DOB",
    ]);
  });

  it("refuses an eight-digit SSN, the documented symptom of a lost leading zero", () => {
    expect(refusalCodes(buildPaidLeaveCsv([{ ...base, ssn: "12345678" }]))).toEqual([
      "SSN_NOT_NINE_DIGITS",
    ]);
  });

  it("refuses blank names", () => {
    expect(refusalCodes(buildPaidLeaveCsv([{ ...base, lastName: "  " }]))).toEqual([
      "MISSING_LAST_NAME",
    ]);
    expect(refusalCodes(buildPaidLeaveCsv([{ ...base, firstName: "" }]))).toEqual([
      "MISSING_FIRST_NAME",
    ]);
  });

  it("refuses a middle NAME, which belongs to the other ESD file", () => {
    expect(refusalCodes(buildPaidLeaveCsv([{ ...base, middleInitial: "Quentin" }]))).toEqual([
      "MIDDLE_INITIAL_TOO_LONG",
    ]);
  });

  it("refuses negative hours and negative wages", () => {
    expect(refusalCodes(buildPaidLeaveCsv([{ ...base, exactHours: -1 }]))).toEqual([
      "NEGATIVE_HOURS",
    ]);
    expect(refusalCodes(buildPaidLeaveCsv([{ ...base, grossWagesCents: -1 }]))).toEqual([
      "NEGATIVE_WAGES",
    ]);
  });

  it("refuses fractional cents, which mean a float leaked into a money path", () => {
    expect(refusalCodes(buildPaidLeaveCsv([{ ...base, grossWagesCents: 1234.5 }]))).toEqual([
      "NON_INTEGER_CENTS",
    ]);
  });

  it("refuses a comma inside a name as a REFUSAL, not as an internal crash", () => {
    /*
     * This test exists because the writer originally threw its own eight-field
     * self-check here. Bad input must come back as something Michael can read
     * and act on; only a broken writer should throw.
     */
    const res = buildPaidLeaveCsv([{ ...base, lastName: "Doe, Jr" }]);
    expect(refusalCodes(res)).toEqual(["NAME_CONTAINS_DELIMITER"]);
    if (res.ok) throw new Error("unreachable");
    expect(res.refusals[0].explanation).toContain("field delimiter");
  });

  it("reports every problem at once, rather than stopping at the first", () => {
    const res = buildPaidLeaveCsv([
      { ...base, ssn: "1", lastName: "", dateOfBirth: "" },
    ]);
    const codes = refusalCodes(res);
    expect(codes).toContain("SSN_NOT_NINE_DIGITS");
    expect(codes).toContain("MISSING_LAST_NAME");
    expect(codes).toContain("MISSING_DOB");
  });

  it("names the person in every refusal, so Michael knows whose row to fix", () => {
    const res = buildPaidLeaveCsv([{ ...base, lastName: "Doe", dateOfBirth: "" }]);
    if (res.ok) throw new Error("unreachable");
    expect(res.refusals[0].subject).toBe("Doe");
  });
});

describe("this file and the EAMS unemployment file can never be confused", () => {
  it("differs from the EAMS column order despite both having eight columns", () => {
    expect(EAMS_COLUMN_ORDER).toHaveLength(PAID_LEAVE_COLUMN_COUNT);
    const ours = PAID_LEAVE_HEADER.split(",");
    expect(ours).toHaveLength(EAMS_COLUMN_ORDER.length);
    expect(ours).not.toEqual([...EAMS_COLUMN_ORDER]);
  });

  it("puts Hours in column 5 where EAMS puts Suffix", () => {
    /*
     * The dangerous coincidence: same field count, different meanings. A file of
     * the wrong shape is either rejected — fine — or accepted with hours read as
     * a name suffix.
     */
    expect(PAID_LEAVE_HEADER.split(",")[4]).toBe("Hours");
    expect(EAMS_COLUMN_ORDER[4]).toBe("Suffix");
  });

  it("carries a WA Cares flag and a DOB where EAMS carries wages and an SOC code", () => {
    const ours = PAID_LEAVE_HEADER.split(",");
    expect(ours[6]).toBe("WACaresExempt(Y/N)");
    expect(ours[7]).toBe("DOB (MMDDYYYY)");
    expect(EAMS_COLUMN_ORDER[7]).toBe("SOCCode");
  });

  it("writes a header row, which the EAMS file forbids", () => {
    const res = ok(buildPaidLeaveCsv(SAMPLE_ROWS));
    expect(res.csv.split("\n")[0]).toBe(PAID_LEAVE_HEADER);
    expect(SPEC_FLAT).toContain(
      "list each employee in a separate row with the headers in the order shown below",
    );
  });
});
