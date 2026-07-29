/**
 * SLICE 80 — payee banking vault core: vitest mirror.
 *
 * Mirrors the embedded self-tests of src/lib/payments/payee-banking-core.ts
 * and pins the fraud-control behaviors so a future edit cannot silently
 * weaken them:
 *   - validation (ABA check digit, account length, type)
 *   - masking (full numbers NEVER appear in audit-safe snapshots)
 *   - change description (masked old → new lines)
 *   - tamper detection (submitted values that differ from the vault)
 *   - payment gate (missing / on-hold / incomplete records refuse payment)
 */
import { describe, expect, it } from "vitest";

import {
  __runPayeeBankingCoreTests,
  canPayWithVaultRecord,
  describeBankChange,
  detectBankTamper,
  maskedBankSnapshot,
  validatePayeeBankInput,
} from "@/lib/payments/payee-banking-core";

describe("payee-banking-core embedded self-tests", () => {
  it("all pass", () => {
    expect(() => __runPayeeBankingCoreTests()).not.toThrow();
  });
});

describe("validatePayeeBankInput", () => {
  it("accepts a valid record and strips spaces/dashes", () => {
    const r = validatePayeeBankInput({
      bankName: " Umpqua Bank ",
      routing: "325081403", // valid ABA check digit
      accountNumber: "12-34 5678",
      accountType: "checking",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.bankName).toBe("Umpqua Bank");
      expect(r.value.routing).toBe("325081403");
      expect(r.value.accountNumber).toBe("12345678");
    }
  });

  it("rejects a routing number that fails the ABA check digit", () => {
    const r = validatePayeeBankInput({
      bankName: "B",
      routing: "123456789",
      accountNumber: "1234",
      accountType: "checking",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal).toContain("check digit");
  });

  it("rejects short routing, missing account, bad type", () => {
    expect(
      validatePayeeBankInput({ routing: "12345", accountNumber: "1234", accountType: "checking" }).ok,
    ).toBe(false);
    expect(
      validatePayeeBankInput({ routing: "325081403", accountNumber: "", accountType: "checking" }).ok,
    ).toBe(false);
    expect(
      validatePayeeBankInput({ routing: "325081403", accountNumber: "1234", accountType: "money_market" }).ok,
    ).toBe(false);
  });
});

describe("maskedBankSnapshot — audit safety", () => {
  it("never contains the full routing or account number", () => {
    const snap = maskedBankSnapshot({
      bankName: "Umpqua",
      routing: "325081403",
      accountNumber: "987654321",
      accountType: "checking",
      status: "active",
    });
    const s = JSON.stringify(snap);
    expect(s).not.toContain("325081403");
    expect(s).not.toContain("987654321");
    expect(snap.account_tail).toContain("4321");
  });
});

describe("describeBankChange", () => {
  const before = maskedBankSnapshot({
    bankName: "Old Bank",
    routing: "325081403",
    accountNumber: "11112222",
    accountType: "checking",
    status: "active",
  });

  it("reports 'banking added' when there was no prior record", () => {
    const lines = describeBankChange(null, before);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("banking added");
  });

  it("reports masked old → new for changed fields only", () => {
    const after = maskedBankSnapshot({
      bankName: "Old Bank",
      routing: "325081403",
      accountNumber: "33334444",
      accountType: "savings",
      status: "active",
    });
    const lines = describeBankChange(before, after);
    expect(lines.some((l) => l.startsWith("account:"))).toBe(true);
    expect(lines.some((l) => l.startsWith("type:"))).toBe(true);
    expect(lines.some((l) => l.startsWith("bank:"))).toBe(false);
    expect(lines.join("\n")).not.toContain("33334444");
  });

  it("reports nothing when nothing changed", () => {
    expect(describeBankChange(before, before)).toHaveLength(0);
  });
});

describe("detectBankTamper", () => {
  const vault = { vaultRouting: "325081403", vaultAccount: "11112222" };

  it("null when nothing was submitted (the honest path)", () => {
    expect(detectBankTamper({ submittedRouting: "", submittedAccount: "", ...vault })).toBeNull();
  });

  it("null when submitted values match the vault", () => {
    expect(
      detectBankTamper({ submittedRouting: "325081403", submittedAccount: "1111 2222", ...vault }),
    ).toBeNull();
  });

  it("null for a masked echo (••••2222)", () => {
    expect(
      detectBankTamper({ submittedRouting: "", submittedAccount: "\u2022\u2022\u2022\u20222222", ...vault }),
    ).toBeNull();
  });

  it("flags mismatched routing and account", () => {
    const t = detectBankTamper({
      submittedRouting: "111000025",
      submittedAccount: "99998888",
      ...vault,
    });
    expect(t).not.toBeNull();
    expect(t!.mismatchedFields).toEqual(["routing", "account"]);
  });
});

describe("canPayWithVaultRecord — the payment gate", () => {
  it("refuses when there is no record, pointing at the vault page", () => {
    const v = canPayWithVaultRecord(null, "Fairwinds");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.refusal).toContain("Banking");
  });

  it("refuses an on-hold record with phone-verification instructions", () => {
    const v = canPayWithVaultRecord(
      { status: "on_hold", routing: "325081403", accountNumber: "1234" },
      "Fairwinds",
    );
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.refusal).toContain("ON HOLD");
  });

  it("refuses an incomplete record", () => {
    const v = canPayWithVaultRecord(
      { status: "active", routing: "", accountNumber: "1234" },
      "Fairwinds",
    );
    expect(v.ok).toBe(false);
  });

  it("allows a complete active record", () => {
    const v = canPayWithVaultRecord(
      { status: "active", routing: "325081403", accountNumber: "1234" },
      "Fairwinds",
    );
    expect(v.ok).toBe(true);
  });
});
