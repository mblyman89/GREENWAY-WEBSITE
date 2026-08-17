/**
 * tests/compliance/sage50-core.test.ts
 *
 * ADVERSARIAL MIRROR for src/lib/accounting/sage50-core.ts.
 *
 * This module builds the CSV that gets imported into Sage 50. Every defect
 * here lands as a wrong number in a real set of books, so the tests below are
 * written against a REAL RFC 4180 PARSER rather than against string equality.
 * Comparing the output to an expected string only proves the output has not
 * changed; parsing it proves a CSV reader will see what we intended.
 *
 * DEFECT FOUND AND FIXED WHILE WRITING THIS FILE
 * ---------------------------------------------------------------------------
 * csvCell quoted on /[,\n]/ and therefore NOT on a lone carriage return. A
 * description containing a bare `\r` -- ordinary when text has been pasted out
 * of Excel or authored on Windows -- was written unquoted, and a reader that
 * treats `\r` as a line terminator (RFC 4180, and Sage 50) split ONE journal
 * line into TWO. The orphan fragment carries no date, no account and no
 * amount. Best case the import throws on a row that does not exist in the
 * source; worst case a partial line posts.
 */
import { describe, it, expect } from "vitest";

import {
  dollars,
  mmddyyyy,
  clean,
  csvCell,
  makeFileName,
  assembleCsv,
  rebalance,
  missingGlAccounts,
  DEFAULT_ACCOUNTING_SETTINGS,
  __runSage50CoreTests,
  type JournalLine,
  type AccountingSettings,
} from "@/lib/accounting/sage50-core";

// ---------------------------------------------------------------------------
// A real RFC 4180 parser, used as the oracle for every CSV assertion.
// ---------------------------------------------------------------------------
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// The parser is the oracle, so the oracle itself gets tested first. An oracle
// that is wrong in the same direction as the code under test proves nothing.
describe("the CSV parser used as the oracle", () => {
  it("splits plain rows and fields", () => {
    expect(parseCsv("a,b\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("keeps commas, newlines and carriage returns inside quoted fields", () => {
    expect(parseCsv('a,"b,c"')).toEqual([["a", "b,c"]]);
    expect(parseCsv('a,"b\nc"')).toEqual([["a", "b\nc"]]);
    expect(parseCsv('a,"b\rc"')).toEqual([["a", "b\rc"]]);
  });

  it("treats a LONE carriage return as a row break when unquoted", () => {
    // This is the behaviour that made the defect dangerous.
    expect(parseCsv("a,b\rc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("understands doubled quotes", () => {
    expect(parseCsv('"say ""hi"""')).toEqual([['say "hi"']]);
  });
});

// ---------------------------------------------------------------------------
// Embedded suite
// ---------------------------------------------------------------------------
describe("embedded self-tests", () => {
  it("passes its own suite", () => {
    expect(() => __runSage50CoreTests()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// dollars -- money formatting
// ---------------------------------------------------------------------------
describe("dollars", () => {
  it("formats whole and fractional amounts to exactly two places", () => {
    expect(dollars(0)).toBe("0.00");
    expect(dollars(1)).toBe("0.01");
    expect(dollars(100)).toBe("1.00");
    expect(dollars(123456)).toBe("1234.56");
  });

  it("preserves the sign, because credits are negative here", () => {
    // In this format a credit is a negative amount. Dropping the sign would
    // turn every credit into a debit and silently double the imbalance.
    expect(dollars(-1)).toBe("-0.01");
    expect(dollars(-123456)).toBe("-1234.56");
  });

  it("always emits two decimal places for a sweep of values", () => {
    for (let cents = -250; cents <= 250; cents++) {
      expect(dollars(cents)).toMatch(/^-?\d+\.\d{2}$/);
    }
  });

  it("round-trips back to the original cents across a sweep", () => {
    for (let cents = -5000; cents <= 5000; cents += 7) {
      expect(Math.round(parseFloat(dollars(cents)) * 100)).toBe(cents);
    }
  });

  it("never uses thousands separators, which would break the CSV column", () => {
    expect(dollars(123456789)).toBe("1234567.89");
    expect(dollars(123456789)).not.toContain(",");
  });
});

// ---------------------------------------------------------------------------
// mmddyyyy
// ---------------------------------------------------------------------------
describe("mmddyyyy", () => {
  it("converts an ISO date to Sage's expected order", () => {
    expect(mmddyyyy("2026-01-05")).toBe("01/05/2026");
    expect(mmddyyyy("2026-12-31")).toBe("12/31/2026");
  });

  it("does not silently reorder an already-converted date", () => {
    // Calling it twice must not produce a plausible-looking wrong date. It
    // returns something obviously broken instead, which is far safer than
    // turning 01/05/2026 into a different real date.
    const once = mmddyyyy("2026-01-05");
    expect(mmddyyyy(once)).not.toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });

  it("keeps the day and month distinct across a sweep", () => {
    for (let d = 1; d <= 28; d++) {
      const dd = String(d).padStart(2, "0");
      expect(mmddyyyy(`2026-03-${dd}`)).toBe(`03/${dd}/2026`);
    }
  });
});

// ---------------------------------------------------------------------------
// clean
// ---------------------------------------------------------------------------
describe("clean", () => {
  it("removes double quotes entirely", () => {
    expect(clean('say "hi"')).toBe("say hi");
  });

  it("collapses every kind of line break to a single space", () => {
    expect(clean("a\nb")).toBe("a b");
    expect(clean("a\rb")).toBe("a b");
    expect(clean("a\r\nb")).toBe("a b");
    expect(clean("a\n\n\nb")).toBe("a b");
  });

  it("leaves ordinary text untouched", () => {
    expect(clean("ACME Distributing, Inc.")).toBe("ACME Distributing, Inc.");
  });

  it("output never contains a quote or a line break", () => {
    for (const s of ['a"b', "a\rb", "a\nb", 'mix"ed\r\ntext', '""\r\n']) {
      const out = clean(s);
      expect(out).not.toContain('"');
      expect(out).not.toMatch(/[\r\n]/);
    }
  });
});

// ---------------------------------------------------------------------------
// csvCell -- THE DEFECT
// ---------------------------------------------------------------------------
describe("csvCell", () => {
  it("leaves a plain value unquoted", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell(10100)).toBe("10100");
  });

  it("quotes a value containing a comma", () => {
    expect(csvCell("ACME, Inc.")).toBe('"ACME, Inc."');
  });

  it("quotes a value containing a newline", () => {
    expect(csvCell("a\nb")).toBe('"a\nb"');
  });

  it("REGRESSION: quotes a value containing a LONE carriage return", () => {
    // The defect. Unquoted, this splits one journal line into two.
    expect(csvCell("a\rb")).toBe('"a\rb"');
  });

  it("quotes a CRLF value", () => {
    expect(csvCell("a\r\nb")).toBe('"a\r\nb"');
  });

  it("renders null and undefined as empty, not as the words", () => {
    // "null" in the G/L Account ID column would be imported as an account name.
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(null)).not.toContain("null");
  });

  it("strips embedded quotes rather than doubling them (deliberate)", () => {
    // Lossy but not corrupting, and it is what the Sage import expects.
    // Asserted so nobody changes it into RFC-style doubling by accident.
    expect(csvCell('say "hi"')).toBe("say hi");
    expect(csvCell('a,"b')).toBe('"a,b"');
  });

  it("REGRESSION: strips quotes even when the cell does NOT need quoting", () => {
    // THE SECOND DEFECT. Quotes were stripped only on the quoting branch, so a
    // value with a quote but no comma was emitted raw -- a bare `"` inside an
    // unquoted field, which is malformed CSV.
    expect(csvCell('Shelf 6" bracket')).toBe("Shelf 6 bracket");
    expect(csvCell('Paid ACME "rebate"')).toBe("Paid ACME rebate");
  });

  it("never emits a bare quote inside an unquoted field", () => {
    for (const value of [
      'Shelf 6" bracket',
      'a "b" c',
      '"leading',
      'trailing"',
      '""',
      'one " quote',
    ]) {
      const cell = csvCell(value);
      const isQuotedField = cell.startsWith('"') && cell.endsWith('"');
      if (!isQuotedField) {
        expect(cell, `bare quote leaked into an unquoted field for ${JSON.stringify(value)}`)
          .not.toContain('"');
      }
    }
  });

  it("every produced cell survives a round trip through the parser", () => {
    const nasty = [
      "plain",
      "with,comma",
      "with\nnewline",
      "with\rcarriage",
      "with\r\nboth",
      "",
      "trailing space ",
      "10100",
      'Shelf 6" bracket',
      'a "quoted" word',
      'unbalanced " quote',
      '"',
      'comma,and"quote',
    ];
    for (const value of nasty) {
      const row = parseCsv(`${csvCell(value)},END`);
      expect(row.length, `"${JSON.stringify(value)}" broke the row count`).toBe(1);
      expect(row[0].length, `"${JSON.stringify(value)}" broke the field count`).toBe(2);
      expect(row[0][1]).toBe("END");
    }
  });
});

// ---------------------------------------------------------------------------
// assembleCsv -- the whole file must parse back to what went in
// ---------------------------------------------------------------------------
describe("assembleCsv", () => {
  const line = (over: Partial<JournalLine> = {}): JournalLine => ({
    date: "01/05/2026",
    reference: "GW1",
    transactionNumber: 1,
    glAccountId: "10100",
    description: "Daily sales",
    amountMinor: 1000,
    ...over,
  });

  it("emits a header even when there are no lines", () => {
    const rows = parseCsv(assembleCsv([]));
    expect(rows.length).toBe(1);
    expect(rows[0]).toEqual([
      "Date",
      "Reference",
      "Transaction Number",
      "G/L Account ID",
      "Description",
      "Amount",
    ]);
  });

  it("emits exactly one row per line, plus the header", () => {
    for (const n of [1, 2, 5, 25]) {
      const rows = parseCsv(assembleCsv(Array.from({ length: n }, () => line())));
      expect(rows.length).toBe(n + 1);
    }
  });

  it("REGRESSION: a carriage return in a description does not create a phantom row", () => {
    // Before the fix this produced 3 rows for 1 journal line, and the extra
    // row had no date, no account and no amount.
    const csv = assembleCsv([line({ description: "Paid vendor\rACME" })]);
    const rows = parseCsv(csv);
    expect(rows.length).toBe(2);
    expect(rows[1].length).toBe(6);
    expect(rows[1][4]).toBe("Paid vendor\rACME");
    // The amount must still be in the amount column.
    expect(rows[1][5]).toBe("10.00");
  });

  it("keeps every column aligned when text contains commas and quotes", () => {
    const csv = assembleCsv([
      line({ description: 'ACME, Inc. "rebate"', reference: "GW,1" }),
    ]);
    const rows = parseCsv(csv);
    expect(rows.length).toBe(2);
    expect(rows[1].length).toBe(6);
    expect(rows[1][0]).toBe("01/05/2026");
    expect(rows[1][3]).toBe("10100");
    expect(rows[1][5]).toBe("10.00");
  });

  it("every data row has exactly as many fields as the header", () => {
    const csv = assembleCsv([
      line({ description: "plain" }),
      line({ description: "with,comma" }),
      line({ description: "with\rcarriage" }),
      line({ description: "with\nnewline" }),
      line({ description: 'with "quotes"' }),
      line({ description: "" }),
    ]);
    const rows = parseCsv(csv);
    const width = rows[0].length;
    for (const r of rows) expect(r.length).toBe(width);
  });

  it("REGRESSION: a stray quote never swallows the Amount column", () => {
    // THE SECOND DEFECT, at the level where it costs money. `Shelf 6" bracket`
    // used to parse as FIVE fields, with the description reading
    // `Shelf 6 bracket,10.00` -- the amount absorbed into the text and the
    // Amount column simply gone.
    const hostile = [
      'Shelf 6" bracket',
      'Paid ACME "rebate"',
      'unbalanced " quote',
      'comma,and"quote',
      '"',
    ];
    for (const description of hostile) {
      const rows = parseCsv(assembleCsv([line({ description, amountMinor: 1000 })]));
      expect(rows.length, `row count for ${JSON.stringify(description)}`).toBe(2);
      expect(rows[1].length, `field count for ${JSON.stringify(description)}`).toBe(6);
      // The amount must be in the amount column, and must still be a number.
      expect(rows[1][5], `amount for ${JSON.stringify(description)}`).toBe("10.00");
      expect(Number.isFinite(parseFloat(rows[1][5]))).toBe(true);
      // And the account id must not have drifted into another column.
      expect(rows[1][3]).toBe("10100");
    }
  });

  it("writes credits as negative amounts", () => {
    const rows = parseCsv(assembleCsv([line({ amountMinor: -2500 })]));
    expect(rows[1][5]).toBe("-25.00");
  });

  it("the debits and credits of a balanced entry sum to zero after parsing", () => {
    const csv = assembleCsv([
      line({ amountMinor: 10000, transactionNumber: 7 }),
      line({ amountMinor: -7500, transactionNumber: 7 }),
      line({ amountMinor: -2500, transactionNumber: 7 }),
    ]);
    const rows = parseCsv(csv).slice(1);
    const total = rows.reduce((s, r) => s + Math.round(parseFloat(r[5]) * 100), 0);
    expect(total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// makeFileName
// ---------------------------------------------------------------------------
describe("makeFileName", () => {
  it("stamps the date in a sortable order", () => {
    expect(makeFileName(new Date(Date.UTC(2026, 0, 5)))).toBe(
      "Sage50_GeneralJournal_20260105.csv",
    );
  });

  it("zero-pads months and days so names sort correctly", () => {
    const name = makeFileName(new Date(Date.UTC(2026, 8, 9)));
    expect(name).toBe("Sage50_GeneralJournal_20260909.csv");
    expect(name).not.toContain("_202699");
  });

  it("produces names that sort chronologically as plain strings", () => {
    const jan = makeFileName(new Date(Date.UTC(2026, 0, 9)));
    const oct = makeFileName(new Date(Date.UTC(2026, 9, 1)));
    expect(jan < oct).toBe(true);
  });

  it("always ends in .csv", () => {
    expect(makeFileName(new Date(Date.UTC(2026, 5, 15)))).toMatch(/\.csv$/);
  });
});

// ---------------------------------------------------------------------------
// rebalance
// ---------------------------------------------------------------------------
describe("rebalance", () => {
  const settings = (): AccountingSettings => ({
    ...DEFAULT_ACCOUNTING_SETTINGS,
    glDiscounts: "49000",
  });

  const mk = (over: Partial<JournalLine>): JournalLine => ({
    date: "01/05/2026",
    reference: "GW1",
    transactionNumber: 1,
    glAccountId: "10100",
    description: "x",
    amountMinor: 0,
    ...over,
  });

  it("removes discount distribution lines so the entry balances", () => {
    const lines = [
      mk({ amountMinor: 10000 }),
      mk({ amountMinor: -10000 }),
      mk({ glAccountId: "49000", description: "Sales discounts applied", amountMinor: 500 }),
    ];
    const warnings: string[] = [];
    rebalance(lines, settings(), warnings);
    expect(lines.length).toBe(2);
    expect(lines.some((l) => l.glAccountId === "49000")).toBe(false);
  });

  it("only removes lines whose description marks them as discounts", () => {
    // A real posting to the discount account must survive.
    const lines = [
      mk({ glAccountId: "49000", description: "Manual discount correction", amountMinor: 100 }),
      mk({ amountMinor: -100 }),
    ];
    const warnings: string[] = [];
    rebalance(lines, settings(), warnings);
    expect(lines.length).toBe(2);
  });

  it("does nothing when no discount account is configured", () => {
    const lines = [
      mk({ glAccountId: "49000", description: "Sales discounts applied", amountMinor: 500 }),
      mk({ amountMinor: -500 }),
    ];
    const warnings: string[] = [];
    rebalance(lines, { ...DEFAULT_ACCOUNTING_SETTINGS, glDiscounts: "" }, warnings);
    expect(lines.length).toBe(2);
    expect(warnings).toEqual([]);
  });

  it("stays silent when everything balances", () => {
    const lines = [mk({ amountMinor: 10000 }), mk({ amountMinor: -10000 })];
    const warnings: string[] = [];
    rebalance(lines, settings(), warnings);
    expect(warnings).toEqual([]);
  });

  it("warns when an entry does not balance", () => {
    const lines = [mk({ amountMinor: 10000 }), mk({ amountMinor: -9999 })];
    const warnings: string[] = [];
    rebalance(lines, settings(), warnings);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/imbalance/i);
  });

  it("counts DAYS out of balance, not lines", () => {
    const lines = [
      mk({ transactionNumber: 1, amountMinor: 100 }),
      mk({ transactionNumber: 1, amountMinor: -99 }),
      mk({ transactionNumber: 2, amountMinor: 100 }),
      mk({ transactionNumber: 2, amountMinor: -98 }),
      mk({ transactionNumber: 3, amountMinor: 100 }),
      mk({ transactionNumber: 3, amountMinor: -100 }),
    ];
    const warnings: string[] = [];
    rebalance(lines, settings(), warnings);
    expect(warnings[0]).toContain("2 day(s)");
  });

  it("treats each transaction number independently", () => {
    // Two entries that are individually wrong but cancel out in total must
    // still be reported. A net-zero total across days hides two real errors.
    const lines = [
      mk({ transactionNumber: 1, amountMinor: 100 }),
      mk({ transactionNumber: 1, amountMinor: -50 }),
      mk({ transactionNumber: 2, amountMinor: 50 }),
      mk({ transactionNumber: 2, amountMinor: -100 }),
    ];
    const warnings: string[] = [];
    rebalance(lines, settings(), warnings);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("2 day(s)");
  });

  it("handles an empty set of lines without warning", () => {
    const warnings: string[] = [];
    rebalance([], settings(), warnings);
    expect(warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// missingGlAccounts
// ---------------------------------------------------------------------------
describe("missingGlAccounts", () => {
  it("names every unconfigured required account by default", () => {
    const missing = missingGlAccounts(DEFAULT_ACCOUNTING_SETTINGS);
    expect(missing).toContain("Cash / clearing");
    expect(missing).toContain("Cannabis sales");
    expect(missing).toContain("Sales tax payable");
  });

  it("returns nothing once the required accounts are set", () => {
    expect(
      missingGlAccounts({
        ...DEFAULT_ACCOUNTING_SETTINGS,
        glCashClearing: "10100",
        glSalesCannabis: "40100",
        glSalesTaxPayable: "23100",
      }),
    ).toEqual([]);
  });

  it("treats whitespace-only configuration as missing", () => {
    // "   " is not a G/L account, and it would sail through a falsy check.
    const missing = missingGlAccounts({
      ...DEFAULT_ACCOUNTING_SETTINGS,
      glCashClearing: "   ",
      glSalesCannabis: "40100",
      glSalesTaxPayable: "23100",
    });
    expect(missing).toEqual(["Cash / clearing"]);
  });

  it("reports human labels, never variable names", () => {
    for (const label of missingGlAccounts(DEFAULT_ACCOUNTING_SETTINGS)) {
      expect(label).not.toMatch(/^gl[A-Z]/);
    }
  });
});
