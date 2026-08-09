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
  mapFundsMovementCsv,
  classifyFundsMovementLeg,
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

describe("mapSimpleSummaryCsv (CONFIRMED real columns: Terminal|Location|Settlement Date|Total Trxs|WD Trxs|Surcharge WDs|Surch|Settlement)", () => {
  it("maps fee/surcharge + settlement to cents (real headers)", () => {
    const csv =
      '"Terminal","Location","Settlement Date","Total Trxs","WD Trxs","Surcharge WDs","Surch","Settlement"\r\n' +
      '"HG26499","CASCADE GENERAL PARTNERS","8/2/26","114","96","96","$240.00","$9,020.00"\r\n';
    const { rows, problems } = mapSimpleSummaryCsv(csv);
    expect(problems).toHaveLength(0);
    expect(rows[0]).toMatchObject({
      terminalId: "HG26499",
      settlementDate: "2026-08-02",
      totalTrx: 114,
      withdrawalTrx: 96,
      surchargedWdTrx: 96,
      surchargeCents: 24000,
      settlementTotalCents: 902000,
      // vault-cash leg is null here; it comes from the FundsMovement "Transaction" leg
      terminalTransactionCents: null,
    });
  });
  it("remains backward-compatible with the legacy-guessed labels (WO Trxs / Surch WDs)", () => {
    const csv =
      "Terminal,Location,Settlement Date,Total Trxs,WO Trxs,Surch WDs,Surch,Settlement\r\n" +
      'HG26499,CASCADE,8/2/26,114,96,96,"$240.00","$9,020.00"\r\n';
    const { rows } = mapSimpleSummaryCsv(csv);
    expect(rows[0]).toMatchObject({ withdrawalTrx: 96, surchargedWdTrx: 96 });
  });
  it("stays faithful to duplicate source rows (dedupe is the store's job)", () => {
    const csv =
      "Terminal,Settlement Date,Surch\r\n" +
      "HG26499,8/5/26,$1.00\r\n" +
      "HG26499,8/5/26,$1.00\r\n";
    expect(mapSimpleSummaryCsv(csv).rows).toHaveLength(2);
  });
});

describe("mapFundsMovementCsv (CONFIRMED real columns; deposit-side truth, long format)", () => {
  const header =
    '"Market Partner Code","Market Partner","Acct #","Group","Location","Settlement Date","Terminal","Settlement Type","Amount"\r\n';

  it("groups by (date, terminal) and SUMS the Transaction and Surcharge legs", () => {
    const csv =
      header +
      '"02-110K804","American ATM Network","******6228","","CASCADE","7/2/26","HG26499","Transaction","$4,980.00"\r\n' +
      '"02-110K804","American ATM Network","******6228","","CASCADE","7/2/26","HG26499","Surcharge","$157.50"\r\n' +
      '"02-110K804","American ATM Network","******6228","","CASCADE","7/2/26","HG26499","Transaction","$100.00"\r\n' +
      '"02-110K804","American ATM Network","******6228","","CASCADE","7/2/26","HG26499","Surcharge","$5.00"\r\n';
    const { rows, problems } = mapFundsMovementCsv(csv);
    expect(problems).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      terminalId: "HG26499",
      settlementDate: "2026-07-02",
      terminalTransactionCents: 508000, // $4,980 + $100
      surchargeCents: 16250, // $157.50 + $5.00
      accountTail: "******6228",
      legCount: 4,
    });
  });

  it("returns grouped rows sorted by date ascending", () => {
    const csv =
      header +
      '"02-110K804","American ATM Network","******6228","","CASCADE","7/2/26","HG26499","Transaction","$100.00"\r\n' +
      '"02-110K804","American ATM Network","******6228","","CASCADE","7/1/26","HG26499","Transaction","$3,860.00"\r\n';
    const { rows } = mapFundsMovementCsv(csv);
    expect(rows.map((r) => r.settlementDate)).toEqual(["2026-07-01", "2026-07-02"]);
  });

  it("records unrecognized Settlement Type as a problem and never guesses", () => {
    const csv = header + '"02-110K804","x","******6228","","CASCADE","7/3/26","HG26499","Chargeback","$10.00"\r\n';
    const { rows, problems } = mapFundsMovementCsv(csv);
    expect(rows).toHaveLength(0);
    expect(problems).toHaveLength(1);
  });

  it("reports a header-level problem when required columns are absent", () => {
    const { rows, problems } = mapFundsMovementCsv("Market Partner,Amount\r\nx,$1.00\r\n");
    expect(rows).toHaveLength(0);
    expect(problems).toHaveLength(1);
  });
});

describe("classifyFundsMovementLeg (strict on meaning, tolerant on case/spacing)", () => {
  it("recognizes the two known legs", () => {
    expect(classifyFundsMovementLeg("Transaction")).toBe("transaction");
    expect(classifyFundsMovementLeg(" surcharge ")).toBe("surcharge");
  });
  it("returns null for anything else", () => {
    expect(classifyFundsMovementLeg("Interchange")).toBeNull();
    expect(classifyFundsMovementLeg("")).toBeNull();
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
