/**
 * R39 S3 — prenote support in nacha-core.buildNachaFile.
 *
 * Owner answer Q3: prenote or a $1 test credit, whichever is easiest; Michael
 * is asking Timberland. Prenotes are built in so either answer works.
 *
 * Facts pinned here (verbatim sources in the roadmap doc):
 *   - Nacha ACH Developer Guide, "Transaction Codes": 23 – Credit Prenote
 *     (checking), 33 – Credit Prenote (savings).
 *   - Hancock Whitney NACHA format guide: amount "Enter 10 zeros for prenotes."
 *   - Nacha Rules (via Time Bank rules-awareness page): "If the Originator
 *     initiates a prenotification, it must wait three (3) banking days prior
 *     to initiating the live dollar amount."
 */
import { describe, expect, it } from "vitest";
import {
  PRENOTE_WAIT_BANKING_DAYS,
  __runNachaCoreTests,
  buildNachaFile,
  transactionCode,
  type AchEntry,
} from "@/lib/payments/nacha-core";

const O = {
  destinationRouting: "125000105",
  destinationName: "TIMBERLAND BANK",
  immediateOrigin: "1911234567",
  companyName: "GREENWAY",
  companyId: "1911234567",
  originatingDfi: "125000105",
};
const build = (entries: AchEntry[]) =>
  buildNachaFile({ originator: O, entries, secCode: "PPD", companyEntryDescription: "PAYROLL", effectiveDate: new Date("2026-03-02T00:00:00Z") });
const sixes = (file: string) => file.split("\n").filter((r) => r[0] === "6");

describe("nacha-core embedded self-tests", () => {
  it("all pass with the floor", () => {
    const r = __runNachaCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(41);
  });
});

describe("prenote entries", () => {
  it("every account type maps to the documented code, live and prenote", () => {
    expect(transactionCode({ accountType: "checking" })).toBe("22");
    expect(transactionCode({ accountType: "savings" })).toBe("32");
    expect(transactionCode({ accountType: "checking", prenote: true })).toBe("23");
    expect(transactionCode({ accountType: "savings", prenote: true })).toBe("33");
    expect(transactionCode({ accountType: "checking", prenote: false })).toBe("22");
  });
  it("prenote record: code 23, amount 10 zeros, controls add nothing", () => {
    const r = build([{ accountType: "checking", routing: "021000021", accountNumber: "555", amountCents: 0, name: "Jane", prenote: true }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [six] = sixes(r.file);
    expect(six.slice(1, 3)).toBe("23");
    expect(six.slice(29, 39)).toBe("0000000000");
    const eight = r.file.split("\n").find((l) => l[0] === "8")!;
    expect(eight.slice(32, 44)).toBe("000000000000");
    expect(eight.slice(4, 10)).toBe("000001"); // still counted as an entry
    expect(r.totalCents).toBe(0);
  });
  it("a prenote carrying money is refused; a live $0 is still refused", () => {
    const a = build([{ accountType: "savings", routing: "021000021", accountNumber: "1", amountCents: 100, name: "X", prenote: true }]);
    expect(a.ok).toBe(false);
    const b = build([{ accountType: "savings", routing: "021000021", accountNumber: "1", amountCents: 0, name: "X" }]);
    expect(b.ok).toBe(false);
  });
  it("prenote + live credit to one account in one file is refused (3-banking-day wait)", () => {
    expect(PRENOTE_WAIT_BANKING_DAYS).toBe(3);
    const r = build([
      { accountType: "checking", routing: "021000021", accountNumber: "0042", amountCents: 0, name: "X", prenote: true },
      { accountType: "checking", routing: "021000021", accountNumber: "42", amountCents: 100, name: "X" },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/3 banking days/);
  });
  it("live then prenote order is refused too (order does not matter)", () => {
    const r = build([
      { accountType: "checking", routing: "021000021", accountNumber: "42", amountCents: 100, name: "X" },
      { accountType: "checking", routing: "021000021", accountNumber: "42", amountCents: 0, name: "X", prenote: true },
    ]);
    expect(r.ok).toBe(false);
  });
  it("an unknown account type is refused, not written as 'undefined'", () => {
    const r = build([{ accountType: "money_market" as never, routing: "021000021", accountNumber: "1", amountCents: 100, name: "X" }]);
    expect(r.ok).toBe(false);
  });
  it("live-only files are byte-identical to before (no prenote flag = 22/32)", () => {
    const r = build([{ accountType: "checking", routing: "021000021", accountNumber: "9", amountCents: 1234, name: "X" }]);
    expect(r.ok && sixes(r.file)[0].slice(0, 3)).toBe("622");
  });
});
