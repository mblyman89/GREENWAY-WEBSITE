/**
 * tests/compliance/void-sale-core.test.ts  (POS Slice B27)
 *
 * Pins the same-day void policy: only TODAY's completed sales (Pacific
 * business day), never after a partial return, never twice; manager reason
 * validation; refund = the exact stored order total; and the printable void
 * slip (escaped, both names, cash figure).
 */
import { describe, it, expect } from "vitest";
import {
  evaluateVoidEligibility,
  validateVoidRequest,
  voidRefundMinor,
  buildVoidSlipHtml,
  VOID_REASON_PRESETS,
  __runVoidSaleCoreTests,
} from "@/lib/pos/void-sale-core";

const NOW = "2026-02-10T20:00:00Z"; // 12:00 Pacific
const SAME_DAY = "2026-02-10T17:00:00Z"; // 09:00 Pacific

const base = {
  orderStatus: "completed",
  completedAtIso: SAME_DAY,
  nowIso: NOW,
  priorReturnQuantity: 0,
  alreadyVoided: false,
};

describe("void eligibility", () => {
  it("allows a same-day completed sale with no prior returns", () => {
    expect(evaluateVoidEligibility(base).ok).toBe(true);
  });
  it("refuses a prior-day sale and points at the returns desk", () => {
    const r = evaluateVoidEligibility({ ...base, completedAtIso: "2026-02-09T20:00:00Z" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toContain("returns desk");
  });
  it("uses the PACIFIC business day, not the UTC date", () => {
    // 06:59 UTC on Feb 10 is still Feb 9 in Pacific (22:59 PST).
    const r = evaluateVoidEligibility({
      ...base,
      completedAtIso: "2026-02-10T06:59:00Z",
      nowIso: "2026-02-10T08:01:00Z",
    });
    expect(r.ok).toBe(false);
  });
  it("reports ALL failing gates together", () => {
    const r = evaluateVoidEligibility({
      ...base,
      orderStatus: "cancelled",
      priorReturnQuantity: 2,
      alreadyVoided: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBe(3);
  });
  it("refuses a double void and a post-return void", () => {
    const voided = evaluateVoidEligibility({ ...base, alreadyVoided: true });
    expect(voided.ok).toBe(false);
    const returned = evaluateVoidEligibility({ ...base, priorReturnQuantity: 1 });
    expect(returned.ok).toBe(false);
  });
});

describe("void request validation", () => {
  it("requires a reason (3–500) and an approver", () => {
    expect(validateVoidRequest({ reason: "Wrong item rung up", approvedByEmployeeId: "e1" }).ok).toBe(true);
    expect(validateVoidRequest({ reason: "x", approvedByEmployeeId: "e1" }).ok).toBe(false);
    expect(validateVoidRequest({ reason: "x".repeat(501), approvedByEmployeeId: "e1" }).ok).toBe(false);
    expect(validateVoidRequest({ reason: "Wrong item", approvedByEmployeeId: "" }).ok).toBe(false);
  });
  it("every preset reason validates", () => {
    for (const r of VOID_REASON_PRESETS) {
      expect(validateVoidRequest({ reason: r, approvedByEmployeeId: "e1" }).ok).toBe(true);
    }
  });
});

describe("refund echo", () => {
  it("returns the exact stored total; refuses non-integer / negative", () => {
    const r = voidRefundMinor(4550);
    expect(r.ok && r.refundMinor).toBe(4550);
    expect(voidRefundMinor(45.5).ok).toBe(false);
    expect(voidRefundMinor(-1).ok).toBe(false);
    expect(voidRefundMinor(0).ok).toBe(true);
  });
});

describe("void slip", () => {
  it("escapes HTML and prints the accountability facts", () => {
    const html = buildVoidSlipHtml({
      receiptNumber: "AB12CD34",
      orderNumber: "GW-1042",
      voidedAtIso: NOW,
      reason: 'Wrong <script>"x"</script>',
      approvedByName: "Casey M.",
      processedByName: "Jordan T.",
      refundMinor: 4550,
      lines: [{ productName: "Blue Dream 3.5g", quantity: 2 }],
    });
    expect(html).toContain("SALE VOIDED");
    expect(html).toContain("$45.50");
    expect(html).not.toContain("<script>");
    expect(html).toContain("Casey M.");
    expect(html).toContain("Jordan T.");
    expect(html).toContain("AB12CD34");
  });
});

describe("embedded self-tests", () => {
  it("__runVoidSaleCoreTests passes", () => {
    expect(() => __runVoidSaleCoreTests()).not.toThrow();
  });
});
