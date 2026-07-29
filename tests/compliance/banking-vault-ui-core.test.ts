/**
 * SLICE 94 — banking vault door UI core: vitest mirror.
 *
 * Mirrors the embedded self-tests of src/lib/payments/banking-vault-ui-core.ts
 * and pins the behaviors the vault door depends on, so a future edit cannot
 * silently weaken them:
 *   - tab resolution (vendors is the default; legacy "payees" maps to vendors)
 *   - badge leak guards (full account/routing numbers NEVER appear in output)
 *   - badge lifecycle (none / unverified / verified / on hold)
 *   - security posture honesty (never claims encryption/RLS that isn't live)
 */
import { describe, expect, it } from "vitest";

import {
  __runBankingVaultUiTests,
  employeeBankingBadge,
  employeeCoverageLine,
  resolveVaultTab,
  vaultSecurityPosture,
  vendorBankingBadge,
  vendorCoverageLine,
} from "@/lib/payments/banking-vault-ui-core";

describe("banking-vault-ui-core embedded self-tests", () => {
  it("all pass", () => {
    expect(() => __runBankingVaultUiTests()).not.toThrow();
  });
});

describe("resolveVaultTab", () => {
  it("defaults to vendors (the owner's most common trip)", () => {
    expect(resolveVaultTab(undefined)).toBe("vendors");
    expect(resolveVaultTab(null)).toBe("vendors");
    expect(resolveVaultTab("")).toBe("vendors");
    expect(resolveVaultTab("garbage")).toBe("vendors");
  });
  it("resolves each tab and the legacy aliases", () => {
    expect(resolveVaultTab("vendors")).toBe("vendors");
    expect(resolveVaultTab("employees")).toBe("employees");
    expect(resolveVaultTab("company")).toBe("company");
    expect(resolveVaultTab("mine")).toBe("company");
    expect(resolveVaultTab("my-banking")).toBe("company");
    // SLICE 80's old page used ?tab=payees semantics — old links keep working.
    expect(resolveVaultTab("payees")).toBe("vendors");
  });
});

describe("vendorBankingBadge — leak guard + lifecycle", () => {
  const FULL_ACCOUNT = "9876543210";
  it("never leaks the full account number in ANY badge field", () => {
    const badge = vendorBankingBadge({
      hasRecord: true,
      status: "active",
      verifiedAt: "2026-01-15T00:00:00Z",
      accountNumber: FULL_ACCOUNT,
      bankName: "Umpqua Bank",
    });
    expect(JSON.stringify(badge)).not.toContain(FULL_ACCOUNT);
    expect(JSON.stringify(badge)).toContain("3210"); // masked tail only
  });
  it("no record → neutral 'none' badge", () => {
    const b = vendorBankingBadge({ hasRecord: false });
    expect(b.state).toBe("none");
    expect(b.tone).toBe("neutral");
  });
  it("on hold wins over verified (payments blocked)", () => {
    const b = vendorBankingBadge({
      hasRecord: true,
      status: "on_hold",
      verifiedAt: "2026-01-15T00:00:00Z",
      accountNumber: FULL_ACCOUNT,
    });
    expect(b.state).toBe("on_hold");
    expect(b.tone).toBe("orange");
    expect(b.detail).toContain("blocked");
  });
  it("verified → green; unverified → gold with call-to-verify guidance", () => {
    const v = vendorBankingBadge({
      hasRecord: true,
      status: "active",
      verifiedAt: "2026-01-15T00:00:00Z",
      accountNumber: FULL_ACCOUNT,
    });
    expect(v.state).toBe("verified");
    expect(v.tone).toBe("green");
    const u = vendorBankingBadge({
      hasRecord: true,
      status: "active",
      verifiedAt: null,
      accountNumber: FULL_ACCOUNT,
    });
    expect(u.state).toBe("unverified");
    expect(u.tone).toBe("gold");
    expect(u.detail.toLowerCase()).toContain("verify");
  });
});

describe("employeeBankingBadge — leak guard", () => {
  const ROUTING = "325081403";
  const ACCOUNT = "1234567890";
  it("never leaks routing or account numbers", () => {
    const b = employeeBankingBadge({
      routing: ROUTING,
      accountNumber: ACCOUNT,
      accountType: "savings",
    });
    const s = JSON.stringify(b);
    expect(s).not.toContain(ROUTING);
    expect(s).not.toContain(ACCOUNT);
    expect(s).toContain("7890"); // masked tail only
    expect(b.state).toBe("verified");
  });
  it("no banking → neutral badge (drops off the NACHA file)", () => {
    const b = employeeBankingBadge({ routing: null, accountNumber: null, accountType: null });
    expect(b.state).toBe("none");
    expect(b.tone).toBe("neutral");
  });
});

describe("coverage lines", () => {
  it("report honest counts", () => {
    const v = vendorCoverageLine({ vendorsTotal: 10, withBanking: 4, onHold: 1, unverified: 2 });
    expect(v).toContain("4 of 10");
    expect(v).toContain("1 on hold");
    expect(v).toContain("2 not yet verified");
    expect(employeeCoverageLine({ activeTotal: 6, withBanking: 6 })).toContain("6 of 6");
  });
});

describe("vaultSecurityPosture — honesty", () => {
  it("all five controls green when encryption + table are live", () => {
    const items = vaultSecurityPosture({ encryptionConfigured: true, vendorTableReady: true });
    expect(items).toHaveLength(5);
    expect(items.every((i) => i.ok)).toBe(true);
  });
  it("NEVER claims encryption or RLS that isn't live", () => {
    const items = vaultSecurityPosture({ encryptionConfigured: false, vendorTableReady: false });
    expect(items[0].ok).toBe(false);
    expect(items[0].detail).toContain("DATA_ENCRYPTION_KEY");
    expect(items[1].ok).toBe(false);
    expect(items[1].detail).toContain("0143_payee_banking_vault.sql");
  });
});
