/**
 * tests/compliance/disposition-core.test.ts  (Task Q)
 *
 * Wires the embedded self-test suites of the two pure disposition cores into
 * vitest, plus targeted assertions pinning the Task Q compliance contract:
 *   • customer returns require the WAC 314-55-079(12) attestations (original
 *     packaging + fully legible lot ID) and encode full-line returns as CCRS
 *     Sale "Delete", partials as "Update" (per the LCB's CCRS FAQ)
 *   • the Sale correction row restates ORIGINAL identifiers/values on Delete,
 *     reports the REMAINING quantity with pro-rata money on Update, never
 *     emits negatives, and clamps UpdatedDate ≥ CreatedDate — with plain
 *     YYYY-MM-DD sale dates reformatted directly (no UTC-midnight day shift)
 *   • the internal "return" adjustment reason maps to CCRS "Other" and a
 *     positive add-back is reportable
 *   • destruction completion enforces WAC 314-55-097 (rendering method, ≥50%
 *     mix, waste destination) and WAC 314-55-225 (recall = LCB coordination
 *     REQUIRED before destruction)
 *   • the manifest workflow only moves forward (WAC 314-55-085 flow)
 */
import { describe, it, expect } from "vitest";
import {
  __runDispositionCoreTests,
  validateCustomerReturn,
  validateDestructionCompletion,
  nextManifestStatuses,
  clampHoldHours,
  computeEarliestDestroyAt,
  holdElapsed,
  HOLD_HOURS_DEFAULT,
  HOLD_HOURS_MAX,
  type CustomerReturnDraft,
  type DestructionCompletionDraft,
} from "@/lib/inventory/disposition-core";
import {
  __runSaleCorrectionTests,
  mapSaleCorrectionRow,
  ccrsDateLoose,
  prorateLineMinor,
  type SaleCorrectionSource,
} from "@/lib/compliance/ccrs-sale-correction-core";
import {
  mapAdjustmentReason,
  isReportableAdjustment,
} from "@/lib/compliance/ccrs-inventory-adjustment-core";

const LICENSE = { licenseNumber: "413541", submittedBy: "greenway" };

function returnDraft(over: Partial<CustomerReturnDraft> = {}): CustomerReturnDraft {
  return {
    quantity: 1,
    originalQuantity: 2,
    originalPackaging: true,
    lotIdLegible: true,
    disposition: "destroy",
    reason: "defective",
    refundMinor: 1500,
    ...over,
  };
}

function correctionSource(over: Partial<SaleCorrectionSource> = {}): SaleCorrectionSource {
  return {
    correctionOperation: "Update",
    saleExternalId: "GW-1001",
    saleDetailExternalId: "GW-1001-abcd1234",
    inventoryExternalId: "INV-77",
    saleType: "RecreationalRetail",
    saleDateISO: "2026-07-01",
    originalQuantity: 3,
    returnQuantity: 1,
    unitPriceMinor: 1000, // $10.00/unit pre-discount
    discountMinor: 300, // $3.00 whole line
    salesTaxMinor: 270, // $2.70 whole line
    exciseMinor: 1110, // $11.10 whole line
    returnedAtISO: "2026-07-10T12:00:00.000Z",
    ...over,
  };
}

function completionDraft(over: Partial<DestructionCompletionDraft> = {}): DestructionCompletionDraft {
  return {
    reason: "expired",
    renderingMethod: "grind_mix_compostable",
    mixMaterial: "food waste",
    fiftyPercentAttested: true,
    witnessedBy: "A. Manager",
    finalDestination: "compost bin",
    disposalFacility: null,
    lcbCoordinated: false,
    lcbOfficer: null,
    earliestDestroyAt: "2026-07-01T00:00:00.000Z",
    nowMs: Date.parse("2026-07-05T00:00:00.000Z"),
    ...over,
  };
}

describe("disposition-core embedded self-tests", () => {
  it("all pass", () => {
    const res = __runDispositionCoreTests();
    expect(res.failed).toBe(0);
    expect(res.passed).toBeGreaterThan(0);
  });
});

describe("ccrs-sale-correction-core embedded self-tests", () => {
  it("all pass", () => {
    const res = __runSaleCorrectionTests();
    expect(res.failed).toBe(0);
    expect(res.passed).toBeGreaterThan(0);
  });
});

describe("customer return validation (WAC 314-55-079(12) + CCRS FAQ)", () => {
  it("refuses without original packaging", () => {
    const res = validateCustomerReturn(returnDraft({ originalPackaging: false }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/original packaging/i);
  });

  it("refuses without a fully legible lot ID", () => {
    const res = validateCustomerReturn(returnDraft({ lotIdLegible: false }));
    expect(res.ok).toBe(false);
  });

  it("full-line return ⇒ Sale Delete", () => {
    const res = validateCustomerReturn(returnDraft({ quantity: 2, originalQuantity: 2 }));
    expect(res).toEqual({ ok: true, correctionOperation: "Delete" });
  });

  it("partial return ⇒ Sale Update", () => {
    const res = validateCustomerReturn(returnDraft({ quantity: 1, originalQuantity: 2 }));
    expect(res).toEqual({ ok: true, correctionOperation: "Update" });
  });

  it("rejects over-returns and negative refunds", () => {
    expect(validateCustomerReturn(returnDraft({ quantity: 3, originalQuantity: 2 })).ok).toBe(false);
    expect(validateCustomerReturn(returnDraft({ refundMinor: -1 })).ok).toBe(false);
  });
});

describe("CCRS Sale correction row", () => {
  it("Delete restates the ORIGINAL quantity and money", () => {
    const { row } = mapSaleCorrectionRow(
      correctionSource({ correctionOperation: "Delete", returnQuantity: 3 }),
      LICENSE,
    );
    expect(row).not.toBeNull();
    // [.., Quantity, UnitPrice, Discount, RetailSalesTax, CannabisExciseTax, ...]
    expect(row![6]).toBe("3");
    expect(row![7]).toBe("10.00");
    expect(row![8]).toBe("3.00");
    expect(row![9]).toBe("2.70");
    expect(row![10]).toBe("11.10");
    expect(row![17]).toBe("Delete");
  });

  it("Update reports REMAINING quantity with pro-rata money, original ids, UpdatedBy/UpdatedDate", () => {
    const { row } = mapSaleCorrectionRow(correctionSource(), LICENSE);
    expect(row).not.toBeNull();
    expect(row![6]).toBe("2"); // 3 sold − 1 returned
    expect(row![8]).toBe("2.00"); // 300 × 2/3
    expect(row![9]).toBe("1.80"); // 270 × 2/3
    expect(row![10]).toBe("7.40"); // 1110 × 2/3
    expect(row![11]).toBe("GW-1001");
    expect(row![12]).toBe("GW-1001-abcd1234");
    expect(row![15]).toBe("greenway"); // UpdatedBy required on corrections
    expect(row![17]).toBe("Update");
    // No negatives (CCRS: "No Negative entries allowed") — quantity + money.
    for (const cell of [row![6], row![7], row![8], row![9], row![10]]) {
      expect(cell.startsWith("-")).toBe(false);
    }
  });

  it("plain YYYY-MM-DD sale dates do NOT shift a day (Pacific business day preserved)", () => {
    expect(ccrsDateLoose("2026-07-01")).toBe("07/01/2026");
  });

  it("UpdatedDate is clamped to be ≥ CreatedDate", () => {
    const { row } = mapSaleCorrectionRow(
      correctionSource({ returnedAtISO: "2026-06-20T12:00:00.000Z" }),
      LICENSE,
    );
    expect(row![16]).toBe("07/01/2026"); // clamped up to the sale date
  });

  it("skips rows missing original identifiers (required on Update/Delete)", () => {
    expect(mapSaleCorrectionRow(correctionSource({ saleExternalId: "" }), LICENSE).row).toBeNull();
    expect(mapSaleCorrectionRow(correctionSource({ inventoryExternalId: "" }), LICENSE).row).toBeNull();
    expect(
      mapSaleCorrectionRow(correctionSource({ returnQuantity: 5 }), LICENSE).row,
    ).toBeNull();
  });

  it("prorates in integer cents", () => {
    expect(prorateLineMinor(300, 2, 3)).toBe(200);
    expect(prorateLineMinor(1110, 2, 3)).toBe(740);
  });
});

describe("adjustment reason mapping for returns", () => {
  it('internal "return" maps to CCRS "Other" (LCB CCRS FAQ)', () => {
    expect(mapAdjustmentReason("return")).toBe("Other");
  });
  it("a positive return add-back is reportable", () => {
    expect(isReportableAdjustment("return", 2)).toBe(true);
  });
});

describe("destruction completion (WAC 314-55-097 / -225)", () => {
  it("accepts a compliant grind-and-mix completion", () => {
    expect(validateDestructionCompletion(completionDraft())).toEqual({ ok: true });
  });

  it("blocks before the hold elapses", () => {
    const res = validateDestructionCompletion(
      completionDraft({ earliestDestroyAt: "2026-07-10T00:00:00.000Z" }),
    );
    expect(res.ok).toBe(false);
  });

  it("RECALL: prohibited without LCB coordination (WAC 314-55-225)", () => {
    const res = validateDestructionCompletion(completionDraft({ reason: "recall" }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/314-55-225/);
    expect(
      validateDestructionCompletion(
        completionDraft({ reason: "recall", lcbCoordinated: true, lcbOfficer: "Officer Smith" }),
      ),
    ).toEqual({ ok: true });
  });

  it("grind-and-mix requires the mix material and the ≥50% attestation", () => {
    expect(validateDestructionCompletion(completionDraft({ mixMaterial: null })).ok).toBe(false);
    expect(validateDestructionCompletion(completionDraft({ fiftyPercentAttested: false })).ok).toBe(false);
  });

  it("requires a waste destination or facility in the record", () => {
    expect(
      validateDestructionCompletion(completionDraft({ finalDestination: null, disposalFacility: null })).ok,
    ).toBe(false);
  });
});

describe("manifest workflow + hold policy", () => {
  it("manifest statuses only move forward", () => {
    expect(nextManifestStatuses("none")).toEqual(["requested", "submitted"]);
    expect(nextManifestStatuses("submitted")).toEqual(["confirmed"]);
    expect(nextManifestStatuses("picked_up")).toEqual([]);
  });

  it("hold hours clamp and compute correctly", () => {
    expect(clampHoldHours("banana")).toBe(HOLD_HOURS_DEFAULT);
    expect(clampHoldHours(9999)).toBe(HOLD_HOURS_MAX);
    const start = "2026-07-01T00:00:00.000Z";
    const earliest = computeEarliestDestroyAt(start, 72);
    expect(earliest).toBe("2026-07-04T00:00:00.000Z");
    expect(holdElapsed(earliest, Date.parse("2026-07-03T00:00:00.000Z"))).toBe(false);
    expect(holdElapsed(earliest, Date.parse("2026-07-04T00:00:00.000Z"))).toBe(true);
    expect(holdElapsed(null, Date.now())).toBe(true);
  });
});
