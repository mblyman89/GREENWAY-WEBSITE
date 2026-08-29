/**
 * tests/compliance/plaid-ui-core.test.ts  (SLICE P2)
 *
 * Vitest mirror for the PURE Plaid UI/validation core that backs the
 * /admin/plaid Connect page + Health v0. It pins the money-in-CENTS rendering,
 * the item-status chip mapping (plain-English copy), the account summary
 * builder, and the "one account per role" guard (never auto-confirm a
 * conflicting role). The server actions/page are thin wrappers over this.
 */
import { describe, expect, it } from "vitest";
import {
  resolvePlaidTab,
  buildItemStatusView,
  formatCentsUsd,
  maskLabel,
  roleLabel,
  buildAccountSummary,
  normalizeCustomName,
  roleAssignmentCheck,
  __runPlaidUiCoreTests,
} from "@/lib/plaid/plaid-ui-core";

describe("plaid-ui-core self-tests (harness parity)", () => {
  it("passes the in-module self-test battery", () => {
    expect(() => __runPlaidUiCoreTests()).not.toThrow();
  });
});

describe("tab resolver", () => {
  it("defaults to connections and allow-lists health", () => {
    expect(resolvePlaidTab(undefined)).toBe("connections");
    expect(resolvePlaidTab("health")).toBe("health");
    expect(resolvePlaidTab("HEALTH")).toBe("health");
    expect(resolvePlaidTab("money")).toBe("money");
    expect(resolvePlaidTab("ACCOUNTS")).toBe("money");
    expect(resolvePlaidTab("garbage")).toBe("connections");
  });
});

describe("money rendered from CENTS at the edge", () => {
  it("formats cents to USD with grouping and sign", () => {
    expect(formatCentsUsd(0)).toBe("$0.00");
    expect(formatCentsUsd(199)).toBe("$1.99");
    expect(formatCentsUsd(123456)).toBe("$1,234.56");
    expect(formatCentsUsd(-2500)).toBe("-$25.00");
  });
  it("shows an em dash for unknown balances", () => {
    expect(formatCentsUsd(null)).toBe("—");
    expect(formatCentsUsd(undefined)).toBe("—");
    expect(formatCentsUsd(Number.NaN)).toBe("—");
  });
});

describe("status chips map to plain English", () => {
  it("maps healthy / login_required / down", () => {
    expect(buildItemStatusView(null).tone).toBe("green");
    const login = buildItemStatusView("ITEM_LOGIN_REQUIRED");
    expect(login.tone).toBe("orange");
    expect(login.needsUserAction).toBe(true);
    expect(buildItemStatusView("INSTITUTION_DOWN").tone).toBe("red");
  });
});

describe("account summary + labels", () => {
  it("builds a display row prefering name and formatting balances", () => {
    const v = buildAccountSummary({
      accountId: "a1",
      name: "Business Checking",
      officialName: "OFFICIAL",
      customName: null,
      mask: "0001",
      type: "depository",
      subtype: "checking",
      role: "main",
      currentBalanceCents: 4212300,
      availableBalanceCents: 4200000,
    });
    expect(v.displayName).toBe("Business Checking");
    expect(v.maskText).toBe("•••• 0001");
    expect(v.typeText).toBe("depository · checking");
    expect(v.currentText).toBe("$42,123.00");
    expect(v.roleText).toBe("Main operating");
  });
  it("labels roles", () => {
    expect(roleLabel("atm")).toBe("ATM deposits");
    expect(roleLabel(null)).toBe("Unassigned");
    expect(maskLabel(null)).toBe("—");
  });
});

describe("custom account name (owner-assigned nickname)", () => {
  it("normalizeCustomName trims, collapses spaces, caps length, and blanks to null", () => {
    expect(normalizeCustomName("  Timberland Checking  ")).toBe("Timberland Checking");
    expect(normalizeCustomName("Citi  Costco  Visa")).toBe("Citi Costco Visa");
    expect(normalizeCustomName("")).toBeNull();
    expect(normalizeCustomName("   ")).toBeNull();
    expect(normalizeCustomName(null)).toBeNull();
    expect(normalizeCustomName(undefined)).toBeNull();
    expect(normalizeCustomName("A".repeat(80))).toHaveLength(60);
  });
  it("customName wins over the bank-provided name in the summary", () => {
    const v = buildAccountSummary({
      accountId: "a2",
      name: "Checking Account",
      officialName: "TIMBERLAND BANK CHECKING",
      customName: "  Wife Citi Visa  ",
      mask: "1234",
      type: "credit",
      subtype: null,
      role: "credit",
      currentBalanceCents: 5000,
      availableBalanceCents: null,
    });
    expect(v.displayName).toBe("Wife Citi Visa");
    expect(v.customName).toBe("Wife Citi Visa");
  });
  it("a blank customName falls back to the bank name and reports empty nickname", () => {
    const v = buildAccountSummary({
      accountId: "a3",
      name: "Business Checking",
      officialName: null,
      customName: "   ",
      mask: null,
      type: null,
      subtype: null,
      role: null,
      currentBalanceCents: null,
      availableBalanceCents: null,
    });
    expect(v.displayName).toBe("Business Checking");
    expect(v.customName).toBe("");
  });
});

describe("role assignment: only `main` is unique (books-101, D-79)", () => {
  const existing = [
    { accountId: "acc_main", role: "main" as const },
    { accountId: "acc_atm", role: "atm" as const },
  ];
  it("allows a free role, clearing, and re-asserting the same account's role", () => {
    expect(roleAssignmentCheck("acc_new", "credit", existing)).toEqual({ ok: true, role: "credit" });
    expect(roleAssignmentCheck("acc_main", "", existing)).toEqual({ ok: true, role: null });
    expect(roleAssignmentCheck("acc_main", "main", existing)).toEqual({ ok: true, role: "main" });
  });

  // THE DEFECT. Michael's Citi Mastercard could not be tagged while any other
  // card held `credit`, and the only way to make the screen accept it was to
  // untag the other one -- which silently stops that card's feed from posting.
  it("allows a SECOND credit card, which D-79 refused", () => {
    const withCard = [...existing, { accountId: "acc_card1", role: "credit" }];
    expect(roleAssignmentCheck("acc_card2", "credit", withCard)).toEqual({
      ok: true,
      role: "credit",
    });
  });

  it("allows repeats of every non-main role Michael is about to link", () => {
    for (const role of ["credit", "savings", "reserve", "mortgage", "loan", "personal"]) {
      const held = [{ accountId: "acc_first", role }];
      const r = roleAssignmentCheck("acc_second", role, held);
      expect(r, `"${role}" must be repeatable`).toEqual({ ok: true, role });
    }
  });

  it("still blocks a SECOND `main`, because two reconcilers loop over every one", () => {
    const r = roleAssignmentCheck("acc_new", "main", existing);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.toLowerCase()).toContain("already assigned");
  });

  // Rule 26: a refusal that does not explain itself gets worked around. If the
  // message only says "taken", the obvious move is to untag the real operating
  // account -- which breaks vendor and payroll reconciliation silently.
  it("explains WHY main is the exception rather than just refusing", () => {
    const r = roleAssignmentCheck("acc_new", "main", existing);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("reconciliation");
  });

  it("rejects a punctuation-only custom role string", () => {
    expect(roleAssignmentCheck("acc_new", "###", existing).ok).toBe(false);
  });
});

describe("custom (free-text) roles normalize, and repeat like any non-main role", () => {
  const existing = [
    { accountId: "acc_main", role: "main" },
    { accountId: "acc_escrow", role: "escrow" },
  ];
  it("assigns a normalized custom role", () => {
    expect(roleAssignmentCheck("acc_new", "Petty Cash", existing)).toEqual({ ok: true, role: "petty cash" });
  });
  it("allows a repeated custom role, normalizing the case (books-101, D-79)", () => {
    expect(roleAssignmentCheck("acc_new", "ESCROW", existing)).toEqual({ ok: true, role: "escrow" });
  });
  it("lets the same account re-assert its own custom role", () => {
    expect(roleAssignmentCheck("acc_escrow", "escrow", existing)).toEqual({ ok: true, role: "escrow" });
  });
  it("Title-Cases custom roles in roleLabel", () => {
    expect(roleLabel("petty cash")).toBe("Petty Cash");
    expect(roleLabel("escrow")).toBe("Escrow");
    expect(roleLabel("main")).toBe("Main operating");
    expect(roleLabel(null)).toBe("Unassigned");
  });
});
