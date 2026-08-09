/**
 * tests/compliance/atm-ui-core.test.ts  (SLICE A-2a)
 *
 * Vitest mirror for the ATM back-office presentation core (/admin/atm). Pins
 * the tab allow-list, the plain-English connection status line (with masked
 * values only), the HONEST security-posture readout, and the no-secret-leak
 * invariant. No I/O — pure UI logic.
 */
import { describe, expect, it } from "vitest";
import {
  resolveAtmTab,
  atmConnectionStatusLine,
  atmSecurityPosture,
  passwordHint,
  centsToUsd,
  fmtIsoDate,
  buildSettlementRowView,
  summarizeSettlements,
  buildCashLoadsView,
  validateManualCashLoad,
  __runAtmUiCoreTests,
} from "@/lib/atm/atm-ui-core";

describe("resolveAtmTab (allow-list; unknown → health)", () => {
  it("defaults to health", () => {
    expect(resolveAtmTab(undefined)).toBe("health");
    expect(resolveAtmTab("")).toBe("health");
    expect(resolveAtmTab("nonsense")).toBe("health");
  });
  it("passes through known tabs (case-insensitive)", () => {
    expect(resolveAtmTab("health")).toBe("health");
    expect(resolveAtmTab("transactions")).toBe("transactions");
    expect(resolveAtmTab("TRANSACTIONS")).toBe("transactions");
    expect(resolveAtmTab("loads")).toBe("loads");
  });
  it("accepts friendly aliases", () => {
    expect(resolveAtmTab("settlements")).toBe("transactions");
    expect(resolveAtmTab("fees")).toBe("transactions");
    expect(resolveAtmTab("cash-loads")).toBe("loads");
    expect(resolveAtmTab("cash")).toBe("loads");
  });
});

describe("atmConnectionStatusLine", () => {
  it("ok → green Connected with terminal + last sync", () => {
    const v = atmConnectionStatusLine({
      status: "ok",
      terminalId: "HG26499",
      lastSyncAt: "2026-01-05T14:00:00Z",
    });
    expect(v.tone).toBe("green");
    expect(v.label).toBe("Connected");
    expect(v.detail).toContain("HG26499");
    expect(v.detail).toContain("last sync");
  });

  it("error → orange with last error", () => {
    const v = atmConnectionStatusLine({ status: "error", lastError: "401 Unauthorized" });
    expect(v.tone).toBe("orange");
    expect(v.label).toBe("Needs attention");
    expect(v.detail).toContain("401 Unauthorized");
  });

  it("unconfigured (no creds) points at the portal", () => {
    const v = atmConnectionStatusLine({ status: "unconfigured", hasCredentials: false });
    expect(v.tone).toBe("neutral");
    expect(v.label).toBe("Not connected");
    expect(v.detail.toLowerCase()).toContain("paireports.com");
  });

  it("unconfigured (creds saved) nudges Test connection", () => {
    const v = atmConnectionStatusLine({ status: "unconfigured", hasCredentials: true });
    expect(v.detail.toLowerCase()).toContain("test connection");
  });

  it("normalizes unknown status to unconfigured", () => {
    expect(atmConnectionStatusLine({ status: "weird" }).status).toBe("unconfigured");
  });

  it("truncates a very long error", () => {
    const v = atmConnectionStatusLine({ status: "error", lastError: "x".repeat(500) });
    expect(v.detail.length).toBeLessThan(500);
    expect(v.detail).toContain("…");
  });
});

describe("atmSecurityPosture (honest readout)", () => {
  it("reports encryption OK when the key is set", () => {
    const p = atmSecurityPosture({ encryptionOn: true });
    expect(p).toHaveLength(4);
    expect(p.find((x) => x.key === "encryption")!.ok).toBe(true);
  });
  it("reports encryption NOT ok (and names the env var) when the key is missing", () => {
    const p = atmSecurityPosture({ encryptionOn: false });
    const enc = p.find((x) => x.key === "encryption")!;
    expect(enc.ok).toBe(false);
    expect(enc.note).toContain("DATA_ENCRYPTION_KEY");
  });
  it("always ships RLS/masking/audit as ok (migration guarantees them)", () => {
    const p = atmSecurityPosture({ encryptionOn: false });
    expect(p.find((x) => x.key === "rls")!.ok).toBe(true);
    expect(p.find((x) => x.key === "masking")!.ok).toBe(true);
    expect(p.find((x) => x.key === "audit")!.ok).toBe(true);
  });
});

describe("passwordHint", () => {
  it("has-password hint says leave blank to keep", () => {
    expect(passwordHint(true).toLowerCase()).toContain("leave blank");
  });
  it("no-password hint says none saved", () => {
    expect(passwordHint(false).toLowerCase()).toContain("no password");
  });
});

describe("no-secret-leak invariant", () => {
  it("no output string exposes a password value", () => {
    const sweep = JSON.stringify([
      atmConnectionStatusLine({ status: "ok", terminalId: "HG26499", lastSyncAt: "2026-01-05T14:00:00Z" }),
      atmSecurityPosture({ encryptionOn: true }),
      passwordHint(true),
    ]);
    expect(sweep.toLowerCase()).not.toContain("password:");
  });
});

describe("centsToUsd (display only — source of truth stays in cents)", () => {
  it("formats dollars with grouping and 2 decimals", () => {
    expect(centsToUsd(0)).toBe("$0.00");
    expect(centsToUsd(5)).toBe("$0.05");
    expect(centsToUsd(902000)).toBe("$9,020.00");
    expect(centsToUsd(123456789)).toBe("$1,234,567.89");
  });
  it("renders negatives with a minus", () => {
    expect(centsToUsd(-500)).toBe("-$5.00");
  });
  it("is HONEST about missing data (null → em-dash, never fake $0.00)", () => {
    expect(centsToUsd(null)).toBe("—");
    expect(centsToUsd(undefined)).toBe("—");
    expect(centsToUsd(Number.NaN)).toBe("—");
  });
});

describe("fmtIsoDate", () => {
  it("passes through an ISO date and em-dashes null", () => {
    expect(fmtIsoDate("2026-07-02")).toBe("2026-07-02");
    expect(fmtIsoDate(null)).toBe("—");
  });
});

describe("buildSettlementRowView (two deposit legs; never invents a total)", () => {
  it("computes expected deposit = txn + surcharge when both present", () => {
    const v = buildSettlementRowView({
      settlementDate: "2026-07-02",
      terminalId: "HG26499",
      totalTrx: 114,
      withdrawalTrx: 96,
      surchargedWdTrx: 96,
      terminalTransactionCents: 508000,
      surchargeCents: 16250,
      settlementTotalCents: 524250,
    });
    expect(v.withdrawalsLabel).toBe("96 of 114");
    expect(v.txnUsd).toBe("$5,080.00");
    expect(v.surchargeUsd).toBe("$162.50");
    expect(v.expectedDepositCents).toBe(524250);
    expect(v.expectedDepositUsd).toBe("$5,242.50");
  });
  it("leaves expected null when a leg is missing", () => {
    const v = buildSettlementRowView({
      settlementDate: "2026-07-03",
      terminalId: "HG26499",
      totalTrx: null,
      withdrawalTrx: null,
      surchargedWdTrx: null,
      terminalTransactionCents: null,
      surchargeCents: 100,
      settlementTotalCents: null,
    });
    expect(v.expectedDepositCents).toBeNull();
    expect(v.expectedDepositUsd).toBe("—");
    expect(v.withdrawalsLabel).toBe("—");
  });
});

describe("summarizeSettlements (sums only known money; no NaN from nulls)", () => {
  it("rolls up totals and date range", () => {
    const s = summarizeSettlements([
      {
        settlementDate: "2026-07-01",
        terminalId: "HG26499",
        totalTrx: 50,
        withdrawalTrx: 43,
        surchargedWdTrx: 43,
        terminalTransactionCents: 386000,
        surchargeCents: 12000,
        settlementTotalCents: 398000,
      },
      {
        settlementDate: "2026-07-02",
        terminalId: "HG26499",
        totalTrx: 114,
        withdrawalTrx: 96,
        surchargedWdTrx: 96,
        terminalTransactionCents: 508000,
        surchargeCents: 16250,
        settlementTotalCents: 524250,
      },
    ]);
    expect(s.count).toBe(2);
    expect(s.totalTxnCents).toBe(894000);
    expect(s.totalSurchargeCents).toBe(28250);
    expect(s.totalExpectedCents).toBe(922250);
    expect(s.earliestDate).toBe("2026-07-01");
    expect(s.latestDate).toBe("2026-07-02");
  });
});

describe("buildCashLoadsView (expected-in-machine from PAI's own reported balance)", () => {
  it("totals loads and takes the newest reported balance", () => {
    const v = buildCashLoadsView([
      { terminalId: "HG26499", loadedAtRaw: "8/8/26 8:49:11 PM", loadDate: "2026-08-08", cashLoadCents: 236000, balanceAfterCents: 308000, source: "pai" },
      { terminalId: "HG26499", loadedAtRaw: "8/8/26 3:45:06 PM", loadDate: "2026-08-08", cashLoadCents: 284000, balanceAfterCents: 286000, source: "pai" },
    ]);
    expect(v.loadCount).toBe(2);
    expect(v.totalLoadedCents).toBe(520000);
    expect(v.expectedInMachineCents).toBe(308000);
    expect(v.rows[0].sourceLabel).toBe("PAI (auto)");
  });
  it("em-dashes expected-in-machine when no balance reported (manual entry)", () => {
    const v = buildCashLoadsView([
      { terminalId: "HG26499", loadedAtRaw: null, loadDate: "2026-08-01", cashLoadCents: 200000, balanceAfterCents: null, source: "manual" },
    ]);
    expect(v.expectedInMachineCents).toBeNull();
    expect(v.expectedInMachineUsd).toBe("—");
    expect(v.rows[0].sourceLabel).toBe("Manual");
    expect(v.rows[0].loadedAt).toBe("2026-08-01");
  });
});

describe("validateManualCashLoad (integer cents; never guesses)", () => {
  it("parses good input to cents", () => {
    const r = validateManualCashLoad({ amount: "2000", date: "2026-08-01" });
    expect(r).toEqual({ ok: true, cents: 200000, isoDate: "2026-08-01" });
    const r2 = validateManualCashLoad({ amount: "$2,360.50", date: "2026-08-08" });
    expect(r2.ok && r2.cents).toBe(236050);
  });
  it("rejects blanks, non-positive, garbage, and bad dates", () => {
    expect(validateManualCashLoad({ amount: "", date: "2026-08-01" }).ok).toBe(false);
    expect(validateManualCashLoad({ amount: "0", date: "2026-08-01" }).ok).toBe(false);
    expect(validateManualCashLoad({ amount: "-5", date: "2026-08-01" }).ok).toBe(false);
    expect(validateManualCashLoad({ amount: "abc", date: "2026-08-01" }).ok).toBe(false);
    expect(validateManualCashLoad({ amount: "2000", date: "" }).ok).toBe(false);
    expect(validateManualCashLoad({ amount: "2000", date: "13/40/2026" }).ok).toBe(false);
  });
});

describe("self-test harness parity", () => {
  it("__runAtmUiCoreTests passes (same assertions as the pure runner)", () => {
    expect(() => __runAtmUiCoreTests()).not.toThrow();
  });
});
