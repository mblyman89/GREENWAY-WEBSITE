/**
 * tests/compliance/atm-core.test.ts  (SLICE A-1)
 *
 * Vitest mirror for the ATM / PAI reporting pure core. Verifies the money
 * boundary (dollars → integer CENTS, standing rule), the RFC-4180 CSV parser,
 * the VERIFIED PAI report column mappers (Cash Load Report + Simple Summary
 * Report — columns confirmed from Michael's own portal, see
 * outputs/PAI_PORTAL_REFERENCE.md), and the T+1..T+3 business-day bank-posting
 * window used by reconciliation.
 */
import { describe, expect, it } from "vitest";
import {
  dollarsToCents,
  parseCsv,
  normalizeHeader,
  headerIndex,
  pickColumn,
  parseUsDate,
  toIntOrNull,
  mapCashLoadCsv,
  mapSimpleSummaryCsv,
  bankPostingWindow,
  __runAtmCoreTests,
} from "@/lib/atm/atm-core";

describe("dollarsToCents (money boundary — integer cents, standing rule)", () => {
  it("parses currency strings", () => {
    expect(dollarsToCents("$1,800.00")).toBe(180000);
    expect(dollarsToCents("20")).toBe(2000);
    expect(dollarsToCents("$2.50")).toBe(250);
    expect(dollarsToCents(" $20 ")).toBe(2000);
  });
  it("rounds half-away-from-zero on the cent (no float drift)", () => {
    expect(dollarsToCents("10.005")).toBe(1001);
    expect(dollarsToCents(12.34)).toBe(1234);
  });
  it("handles negatives (accounting + minus)", () => {
    expect(dollarsToCents("(2.50)")).toBe(-250);
    expect(dollarsToCents("-2.50")).toBe(-250);
  });
  it("refuses blanks and garbage instead of guessing", () => {
    expect(dollarsToCents("")).toBeNull();
    expect(dollarsToCents("N/A")).toBeNull();
    expect(dollarsToCents(null)).toBeNull();
    expect(dollarsToCents(undefined)).toBeNull();
  });
});

describe("parseCsv (quotes, escaped quotes, embedded newlines, CRLF)", () => {
  it("parses a simple CRLF file", () => {
    const t = parseCsv("a,b,c\r\n1,2,3\r\n");
    expect(t).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });
  it("keeps commas inside quoted fields", () => {
    const t = parseCsv('name,amt\r\n"Doe, John","$1,000.00"\r\n');
    expect(t[1]).toEqual(["Doe, John", "$1,000.00"]);
  });
  it("keeps newlines inside quoted fields", () => {
    const t = parseCsv('a\n"line1\nline2"\n');
    expect(t[1][0]).toBe("line1\nline2");
  });
  it("unescapes doubled quotes", () => {
    const t = parseCsv('a,b\n"He said ""hi""",x\n');
    expect(t[1][0]).toBe('He said "hi"');
  });
  it("empty input yields no rows", () => {
    expect(parseCsv("")).toEqual([]);
  });
});

describe("header helpers (tolerant matching — never guess)", () => {
  it("normalizes labels", () => {
    expect(normalizeHeader("Trx Time")).toBe("trxtime");
    expect(normalizeHeader("Surch WDs")).toBe("surchwds");
  });
  it("maps and picks columns by alias", () => {
    const hi = headerIndex(["Terminal Number", "Cash Load", "Balance"]);
    expect(hi["cashload"]).toBe(1);
    expect(pickColumn(hi, ["load", "cashload"])).toBe(1);
    expect(pickColumn(hi, ["nope"])).toBe(-1);
  });
});

describe("parseUsDate", () => {
  it("handles M/D/YY and MM/DD/YYYY with optional time", () => {
    expect(parseUsDate("8/9/26")).toBe("2026-08-09");
    expect(parseUsDate("08/01/2026 9:54:19 AM")).toBe("2026-08-01");
    expect(parseUsDate("2026-08-01")).toBe("2026-08-01");
  });
  it("returns null for junk", () => {
    expect(parseUsDate("not a date")).toBeNull();
    expect(parseUsDate("")).toBeNull();
    expect(parseUsDate("13/40/2026")).toBeNull();
  });
});

describe("toIntOrNull", () => {
  it("parses thousands-separated counts", () => {
    expect(toIntOrNull("1,234")).toBe(1234);
  });
  it("null on blank/garbage", () => {
    expect(toIntOrNull("")).toBeNull();
    expect(toIntOrNull("12x")).toBeNull();
  });
});

describe("mapCashLoadCsv (VERIFIED columns: Terminal Number|Location|Group|Trx Time|Cash Load|Balance)", () => {
  it("maps a real-shaped row to cents", () => {
    const csv =
      "Terminal Number,Location,Group,Trx Time,Cash Load,Balance\r\n" +
      'HG26499,CASCADE GENERAL PARTNERS,,08/01/2026 9:54:19 AM,"$2,000.00","$1,800.00"\r\n';
    const { rows, problems } = mapCashLoadCsv(csv);
    expect(problems).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      terminalId: "HG26499",
      cashLoadCents: 200000,
      balanceAfterCents: 180000,
      loadDate: "2026-08-01",
    });
  });
  it("reports a problem (does not guess) when required columns are absent", () => {
    const { rows, problems } = mapCashLoadCsv("Location,Group\r\nx,y\r\n");
    expect(rows).toHaveLength(0);
    expect(problems).toHaveLength(1);
  });
  it("flags an unparseable amount per-row without dropping the whole file", () => {
    const csv =
      "Terminal Number,Trx Time,Cash Load\r\n" +
      "HG26499,08/01/2026,$2000\r\n" +
      "HG26499,08/02/2026,oops\r\n";
    const { rows, problems } = mapCashLoadCsv(csv);
    expect(rows).toHaveLength(1);
    expect(problems).toHaveLength(1);
  });
});

describe("mapSimpleSummaryCsv (VERIFIED columns: Terminal|...|Settlement Date|Total Trxs|WO Trxs|Surch WDs|Surch|Settlement)", () => {
  it("maps fee/surcharge + settlement to cents", () => {
    const csv =
      "Terminal,Location,Settlement Date,Total Trxs,WO Trxs,Surch WDs,Surch,Settlement\r\n" +
      'HG26499,CASCADE GENERAL PARTNERS,08/05/2026,61,58,58,"$145.00","$5,000.00"\r\n';
    const { rows, problems } = mapSimpleSummaryCsv(csv);
    expect(problems).toHaveLength(0);
    expect(rows[0]).toMatchObject({
      terminalId: "HG26499",
      settlementDate: "2026-08-05",
      totalTrx: 61,
      withdrawalTrx: 58,
      surchargedWdTrx: 58,
      surchargeCents: 14500,
      settlementTotalCents: 500000,
      // vault-cash leg intentionally null until confirmed via Bank Deposits report
      terminalTransactionCents: null,
    });
  });
  it("stays faithful to duplicate source rows (dedupe is the store's job)", () => {
    const csv =
      "Terminal,Settlement Date,Surch\r\n" +
      "HG26499,08/05/2026,$1.00\r\n" +
      "HG26499,08/05/2026,$1.00\r\n";
    expect(mapSimpleSummaryCsv(csv).rows).toHaveLength(2);
  });
});

describe("bankPostingWindow (T+1..T+3 business days, weekends skipped)", () => {
  it("Wednesday settlement rolls the far edge over the weekend", () => {
    // 2026-08-05 is a Wednesday
    expect(bankPostingWindow("2026-08-05")).toEqual({
      earliest: "2026-08-06",
      latest: "2026-08-10",
    });
  });
  it("Friday settlement skips the weekend on both edges", () => {
    // 2026-08-07 is a Friday
    expect(bankPostingWindow("2026-08-07")).toEqual({
      earliest: "2026-08-10",
      latest: "2026-08-12",
    });
  });
  it("null on bad date", () => {
    expect(bankPostingWindow("nope")).toBeNull();
  });
});

describe("self-test harness", () => {
  it("runs clean", () => {
    expect(() => __runAtmCoreTests()).not.toThrow();
  });
});
