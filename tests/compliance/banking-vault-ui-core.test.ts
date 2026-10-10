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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  __runBankingVaultUiTests,
  employeeBankingBadge,
  employeeCoverageLine,
  resolveVaultTab,
  vaultSecurityPosture,
  vendorBankingBadge,
  vendorCoverageLine,
  vaultRowActions,
  splitVaultRecords,
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

describe("vendorBankingBadge — R39 S3 statuses (allow-list)", () => {
  const base = { hasRecord: true, verifiedAt: "2026-01-15T00:00:00Z", accountNumber: "9876543210" };
  it("revoked and archived beat verified and never read as payable", () => {
    for (const status of ["revoked", "archived"]) {
      const b = vendorBankingBadge({ ...base, status });
      expect(b.state).toBe(status);
      expect(b.tone).not.toBe("green");
      expect(b.detail).toMatch(/No payments/);
    }
  });
  it("only exact 'active' can show verified/unverified; anything else is blocked", () => {
    for (const status of ["Active", "ACTIVE", " active", "paused", "", null, undefined]) {
      const b = vendorBankingBadge({ ...base, status });
      expect(b.state).toBe("blocked_unknown");
      expect(b.tone).toBe("orange");
    }
    expect(vendorBankingBadge({ ...base, status: "active" }).state).toBe("verified");
  });
  it("the badge's payable states agree with canPayWithVaultRecord for every vault status", async () => {
    const { VAULT_STATUSES, canPayWithVaultRecord } = await import("@/lib/payments/payee-banking-core");
    for (const status of [...VAULT_STATUSES, "bogus"]) {
      const badge = vendorBankingBadge({ ...base, status });
      const badgeSaysPayable = badge.state === "verified" || badge.state === "unverified";
      const pay = canPayWithVaultRecord({ status, routing: "021000021", accountNumber: "9876543210" }, "Test Vendor");
      expect({ status, payable: badgeSaysPayable }).toEqual({ status, payable: pay.ok });
    }
  });
  it("coverage line reports revoked/archived and stays quiet when zero", () => {
    expect(vendorCoverageLine({ vendorsTotal: 5, withBanking: 4, onHold: 1, unverified: 0, inactive: 2 })).toBe(
      "4 of 5 vendors have banking on file (1 on hold, 2 revoked or archived)",
    );
    expect(vendorCoverageLine({ vendorsTotal: 5, withBanking: 4, onHold: 0, unverified: 0, inactive: 0 })).toBe(
      "4 of 5 vendors have banking on file",
    );
  });
});

describe("vaultRowActions — only the moves the 0259 trigger allows", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/0259_vendor_vault_change_control.sql"), "utf8");
  it("archived offers re-open only (trigger: archived -> on_hold only)", () => {
    expect(sql).toContain("if old.status = 'archived' and new.status <> 'on_hold' then");
    expect(vaultRowActions("archived", true)).toEqual(["reopen"]);
    expect(vaultRowActions("archived", false)).toEqual(["reopen"]);
  });
  it("revoked offers re-open or archive (trigger: revoked -> on_hold | archived)", () => {
    expect(sql).toContain("if old.status = 'revoked' and new.status not in ('on_hold', 'archived') then");
    expect(vaultRowActions("revoked", true)).toEqual(["reopen", "archive"]);
  });
  it("release is offered ONLY from on_hold, never from active/revoked/archived", () => {
    for (const st of ["active", "revoked", "archived", "bogus"]) {
      for (const v of [true, false]) expect(vaultRowActions(st, v)).not.toContain("release");
    }
    expect(vaultRowActions("on_hold", false)).toContain("release");
  });
  it("hold (not re-open) from active only; re-open from revoked/archived only", () => {
    expect(vaultRowActions("active", true)).toContain("hold");
    expect(vaultRowActions("on_hold", true)).not.toContain("hold");
    expect(vaultRowActions("active", true)).not.toContain("reopen");
  });
  it("verify only on active + unverified", () => {
    expect(vaultRowActions("active", false)).toContain("verify");
    for (const st of ["active", "on_hold", "revoked", "archived"]) expect(vaultRowActions(st, true)).not.toContain("verify");
    expect(vaultRowActions("on_hold", false)).not.toContain("verify");
  });
  it("unknown status offers nothing", () => {
    expect(vaultRowActions("", false)).toEqual([]);
    expect(vaultRowActions("ACTIVE", true)).toEqual([]);
  });
});

describe("splitVaultRecords — hidden inactive table (owner answer Q11)", () => {
  it("routes every status, loses nothing", () => {
    const rows = ["active", "on_hold", "revoked", "archived", "weird", "active"].map((status, i) => ({ status, i }));
    const s = splitVaultRecords(rows);
    expect(s.working.map((r) => r.i)).toEqual([0, 1, 5]);
    expect(s.inactive.map((r) => r.i)).toEqual([2, 3]);
    expect(s.unknown.map((r) => r.i)).toEqual([4]);
    expect(s.working.length + s.inactive.length + s.unknown.length).toBe(rows.length);
  });
});
