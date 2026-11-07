/**
 * D205 — returns follow the back-office policy; loyalty members may return
 * WITHOUT a receipt (owner toggle) after a member lookup, inside the window,
 * with packaging and a product scan matched to the sold line.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  __runNoReceiptReturnCoreTests,
  lineScanCodes,
  memberOwnsSale,
  memberSalesInWindow,
  noReceiptBlockedReason,
  scanMatchesLine,
} from "../../src/lib/pos/no-receipt-return-core";
import {
  DEFAULT_POS_RETURN_POLICY,
  WALK_IN_SALE_LABEL,
  categoryReturnable,
  normalizePosReturnPolicy,
} from "../../src/lib/pos/return-policy-core";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("D205 no-receipt return core", () => {
  it("self-tests pass", () => {
    const r = __runNoReceiptReturnCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(20);
  });

  it("toggle defaults off and gates the flow", () => {
    expect(DEFAULT_POS_RETURN_POLICY.noReceiptMembers).toBe(false);
    expect(noReceiptBlockedReason(DEFAULT_POS_RETURN_POLICY)).toMatch(/switched off/);
    const on = normalizePosReturnPolicy({ ...DEFAULT_POS_RETURN_POLICY, noReceiptMembers: true });
    expect(on.noReceiptMembers).toBe(true);
    expect(noReceiptBlockedReason(on)).toBeNull();
  });

  it("member must own the sale", () => {
    expect(memberOwnsSale("c1", "c1")).toBe(true);
    expect(memberOwnsSale("c1", "c2")).toBe(false);
    expect(memberOwnsSale(null, "c1")).toBe(false);
  });

  it("scan must match the sold line", () => {
    const codes = lineScanCodes({ productId: "lot-abc-123", ccrsExternalId: "WA123456", lots: [{ lotCode: "9876543210", ccrsExternalId: null }] });
    expect(scanMatchesLine("9876543210", codes, "X").ok).toBe(true);
    expect(scanMatchesLine(" wa123456 ", codes, "X").ok).toBe(true);
    expect(scanMatchesLine("1111111111", codes, "X").ok).toBe(false);
    expect(scanMatchesLine("", codes, "X").ok).toBe(false);
  });

  it("window always applies to member sales", () => {
    const pol = normalizePosReturnPolicy({ ...DEFAULT_POS_RETURN_POLICY, noReceiptMembers: true, windowDays: 7 });
    const now = "2025-06-20T19:00:00.000Z";
    const rows = memberSalesInWindow(
      [
        { orderId: "a", orderNumber: "A", saleClientUuid: "u1", purchasedAtIso: "2025-06-18T19:00:00.000Z", totalMinor: 100, items: [], itemCount: 1 },
        { orderId: "b", orderNumber: "B", saleClientUuid: "u2", purchasedAtIso: "2025-05-01T19:00:00.000Z", totalMinor: 100, items: [], itemCount: 1 },
      ],
      pol,
      now,
    );
    expect(rows.map((r) => r.orderId)).toEqual(["a"]);
  });

  it("unknown product type fails closed only when a type is excluded", () => {
    expect(categoryReturnable(DEFAULT_POS_RETURN_POLICY, null)).toBe(DEFAULT_POS_RETURN_POLICY.excludedCategories.length === 0);
    const ex = normalizePosReturnPolicy({ ...DEFAULT_POS_RETURN_POLICY, excludedCategories: ["cartridge"] });
    expect(categoryReturnable(ex, null)).toBe(false);
    expect(categoryReturnable(ex, "flower")).toBe(true);
    expect(categoryReturnable(ex, "cartridge")).toBe(false);
  });

  it("walk-in wording replaces 'Not a loyalty member'", () => {
    expect(WALK_IN_SALE_LABEL).toBe("Walk-in sale (no loyalty account)");
  });
});

describe("D205 wiring", () => {
  it("store re-checks member, window, packaging and scan", () => {
    const s = read("src/lib/pos/returns-store.ts");
    expect(s).toContain("listMemberSalesForReturn");
    expect(s).toContain("lookupSaleForMember");
    expect(s).toContain("verifyReturnScan");
    expect(s).toContain("memberOwnsSale");
    expect(s).toContain("noReceiptBlockedReason");
  });
  it("route exposes member sales, scan check and audits no_receipt", () => {
    const r = read("src/app/api/pos/returns/route.ts");
    expect(r).toContain("memberSales");
    expect(r).toContain("scanMatched");
    expect(r).toContain("no_receipt");
    expect(r).toContain("scanned_code");
  });
  it("policy editor has the toggle; register has the member lookup", () => {
    expect(read("src/components/admin/registers/ReturnPolicyEditor.tsx")).toContain("Allow returns without a receipt (loyalty members only)");
    const shell = read("src/app/(site)/pos/RegisterShell.tsx");
    expect(shell).toContain("noReceiptMembers");
    expect(shell).toContain("searchMembers");
    expect(shell).toContain("checkProductScan");
  });
});
