/**
 * tests/compliance/po-paid-stamp-core.test.ts
 *
 * W9 — pins the "Mark PO paid" settlement contract (audit gap G3):
 *   - NEVER GUESS: a PO with no linked manifests, or with zero cost basis,
 *     is NEVER declared paid;
 *   - settlement is PER-MANIFEST: overpaying one invoice cannot cover a
 *     shortfall on another;
 *   - outstanding balance is reported in CENTS and surfaced in dollars in
 *     the plain-English reason;
 *   - payment reference preference: what the human typed (check #, memo)
 *     > NACHA batch ref > method label — identifiers are never invented;
 *   - bookkeeping only: the verdict carries no side effects (first-settle-
 *     wins and never-overwrite live in the server layer + DB guard).
 */
import { describe, expect, it } from "vitest";
import {
  evaluatePoSettlement,
  paymentReferenceLabel,
  __runPoPaidStampCoreTests,
  type ManifestSettlementFacts,
} from "@/lib/purchasing/po-paid-stamp-core";

function m(owed: number, paid: number, id = "m1"): ManifestSettlementFacts {
  return { manifestId: id, owedMinorUnits: owed, paidMinorUnits: paid };
}

describe("po-paid-stamp-core (W9)", () => {
  it("no linked manifests → never settled, honest reason", () => {
    const v = evaluatePoSettlement([]);
    expect(v.settled).toBe(false);
    expect(v.reason).toMatch(/no manifests/i);
    expect(v.outstandingMinorUnits).toBe(0);
  });

  it("zero cost basis → refuses to declare paid on unknown amounts", () => {
    const v = evaluatePoSettlement([m(0, 0)]);
    expect(v.settled).toBe(false);
    expect(v.reason).toMatch(/refusing/i);
  });

  it("partial payment → not settled, outstanding in cents and dollars", () => {
    const v = evaluatePoSettlement([m(250000, 100000)]);
    expect(v.settled).toBe(false);
    expect(v.outstandingMinorUnits).toBe(150000);
    expect(v.reason).toContain("$1,500.00");
  });

  it("fully paid single invoice → settled with zero outstanding", () => {
    const v = evaluatePoSettlement([m(250000, 250000)]);
    expect(v.settled).toBe(true);
    expect(v.outstandingMinorUnits).toBe(0);
    expect(v.reason).toContain("$2,500.00");
  });

  it("overpay on one manifest does NOT cover a shortfall on another (per-manifest math)", () => {
    const v = evaluatePoSettlement([m(100000, 150000, "a"), m(100000, 50000, "b")]);
    expect(v.settled).toBe(false);
    expect(v.outstandingMinorUnits).toBe(50000);
  });

  it("all linked manifests settled (overpay tolerated) → settled", () => {
    const v = evaluatePoSettlement([m(100000, 100000, "a"), m(50000, 60000, "b")]);
    expect(v.settled).toBe(true);
  });

  it("reference label: human-typed reference wins over batch ref and method", () => {
    expect(
      paymentReferenceLabel({ reference: "check #1042", achBatchRef: "batch-x", paymentMethod: "check" }),
    ).toBe("check #1042");
  });

  it("reference label: NACHA batch ref second; method label fallback; never invented", () => {
    expect(paymentReferenceLabel({ reference: " ", achBatchRef: "vendor-ach-2026-01-07-abc" })).toBe(
      "vendor-ach-2026-01-07-abc",
    );
    expect(paymentReferenceLabel({ paymentMethod: "wire" })).toBe("wire payment");
    expect(paymentReferenceLabel({})).toBe("payment");
  });

  it("embedded self-tests pass", () => {
    const { passed } = __runPoPaidStampCoreTests();
    expect(passed).toBeGreaterThan(0);
  });
});
