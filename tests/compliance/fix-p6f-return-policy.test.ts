/**
 * tests/compliance/fix-p6f-return-policy.test.ts  (Fix Phase 6F, G-67 / G-68)
 *
 * Owner message 9: "allow anyone to return products so long as they have the
 * original packaging and the receipt to go with it and it falls within the 7
 * day return period ... we should allow it to be a setting in the register
 * activity page, so we can toggle it on and off ... a setting for choosing a
 * return window as well as the types of products we allow to be returned."
 * Also: "I just want to make sure the cashier is accountable for their tips
 * too."
 *
 * Pins the pure rules plus the wiring (source greps) so the settings cannot
 * silently fall off a surface.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  __runReturnPolicyCoreTests,
  DEFAULT_POS_RETURN_POLICY,
  lineNotReturnableReason,
  normalizePosReturnPolicy,
  returnPolicyReceiptText,
} from "@/lib/pos/return-policy-core";
import { defaultReturnPolicyText, evaluateReturnEligibility } from "@/lib/pos/returns-core";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("Fix 6F — return policy settings", () => {
  it("pure self-tests pass", () => {
    expect(__runReturnPolicyCoreTests().failed).toBe(0);
  });

  it("defaults to owner message 9: anyone, 7 days, every product type", () => {
    expect(DEFAULT_POS_RETURN_POLICY).toEqual({ loyaltyRequired: false, windowDays: 7, excludedCategories: [] });
    expect(normalizePosReturnPolicy(undefined)).toEqual(DEFAULT_POS_RETURN_POLICY);
  });

  it("the loyalty gate follows the toggle and the window follows the setting", () => {
    const base = {
      orderStatus: "completed",
      orderCustomerId: null,
      purchasedAtIso: "2026-07-01T19:00:00.000Z",
      nowIso: "2026-07-10T19:00:00.000Z", // day 9
    };
    expect(evaluateReturnEligibility(base).ok).toBe(false); // 7-day default
    expect(evaluateReturnEligibility({ ...base, policy: { loyaltyRequired: false, windowDays: 10, excludedCategories: [] } }).ok).toBe(true);
    const loyal = evaluateReturnEligibility({ ...base, policy: { loyaltyRequired: true, windowDays: 10, excludedCategories: [] } });
    expect(loyal.ok).toBe(false);
    if (!loyal.ok) expect(loyal.errors.join(" ")).toMatch(/loyalty/i);
  });

  it("a blocked product type gives a reason; others do not", () => {
    const p = normalizePosReturnPolicy({ excludedCategories: ["topical"] });
    expect(lineNotReturnableReason(p, "topical", "Topical")).toMatch(/^Topical is not a returnable product type/);
    expect(lineNotReturnableReason(p, "flower", "Flower")).toBeNull();
  });

  it("the default receipt policy text follows the settings", () => {
    expect(defaultReturnPolicyText()).toBe(returnPolicyReceiptText(DEFAULT_POS_RETURN_POLICY));
    expect(defaultReturnPolicyText({ loyaltyRequired: false, windowDays: 3, excludedCategories: [] })).toContain("3 days");
  });

  it("wiring: settings page, toolbar button, lookup, register, desk, receipts", () => {
    expect(src("src/app/admin/registers/page.tsx")).toContain("/return-policy`}");
    expect(src("src/app/admin/registers/return-policy/actions.ts")).toContain('requirePermission("settings.manage")');
    expect(src("src/app/admin/registers/return-policy/actions.ts")).toContain("pos.return_policy_saved");
    const store = src("src/lib/pos/returns-store.ts");
    expect(store).toContain("getPosReturnPolicy()");
    expect(store).toContain("line.notReturnableReason");
    expect(store).not.toMatch(/\.limit\(\s*\d{4,}/);
    expect(src("src/app/api/pos/returns/route.ts")).toContain("notReturnableReason: l.notReturnableReason");
    expect(src("src/app/api/pos/menu/route.ts")).toContain("getPosReturnPolicy()");
    const shell = src("src/app/(site)/pos/RegisterShell.tsx");
    expect(shell).not.toContain("15-day");
    expect(shell).toContain("l.notReturnableReason");
    expect(src("src/components/admin/registers/CounterReturnDesk.tsx")).not.toContain("within 15 days");
    expect(src("src/app/(site)/pos/SaleFlow.tsx")).toContain("defaultReturnPolicyText(normalizePosReturnPolicy(bundle.returnPolicy))");
    expect(src("src/lib/pos/receipt-reprint-store.ts")).toContain("defaultReturnPolicyText(returnPolicy)");
  });

  it("customer copy says 7 days and no loyalty requirement", () => {
    expect(src("src/content/faq.ts")).toContain("within 7 days of purchase");
    expect(src("src/lib/ai/kb/seed.ts")).toContain("within 7 days of purchase");
  });
});

describe("Fix 6F — tip accountability on the iPad close", () => {
  it("a blank tips box blocks the close; 0 is allowed", () => {
    const shell = src("src/app/(site)/pos/RegisterShell.tsx");
    expect(shell).toContain('const tipsBlank = tips.trim() === "";');
    expect(shell).toContain("const tipsValid = !tipsBlank && tipsMinor !== null");
    expect(shell).toContain("type 0 if there were no tips");
  });
});
