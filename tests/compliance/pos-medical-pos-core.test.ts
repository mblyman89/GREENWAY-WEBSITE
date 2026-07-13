/**
 * tests/compliance/pos-medical-pos-core.test.ts  (POS Slice B7)
 *
 * Vitest mirror of the pure medical-POS core: recognition-card capture
 * validation, the 18–20 registered-patient age allowance, exemption
 * pass-through pricing (RCW 82.08.9998 sales / WAC 314-55-090 excise with the
 * repo's conservative claim policy), the statutory high-THC hard block
 * (chapter 246-70 WAC), and the medical sale-payload block.
 */
import { describe, expect, it } from "vitest";
import {
  validateCardCapture,
  medicalAgeAllowed,
  applyMedicalPricing,
  validateMedicalSaleBlock,
  __runMedicalPosCoreTests,
  type PosCardCapture,
  type PosMedicalConfig,
} from "@/lib/pos/medical-pos-core";
import type { PricedSaleLine } from "@/lib/pos/sale-flow-core";

const TODAY = "2026-07-15";

const goodCard: PosCardCapture = {
  upid: "WA-UPID-12345",
  effectiveOn: "2026-01-01",
  expiresOn: "2026-12-31",
  holderType: "patient",
  mcrVerified: true,
};

const cfg: PosMedicalConfig = {
  endorsed: true,
  exciseExemptionUntil: "2029-06-30",
  registry: { "prod-compliant": "general_use", "prod-cbd": "high_cbd", "prod-ht": "high_thc" },
};

function mk(productId: string, category: string, unit: number, qty = 1): PricedSaleLine {
  return {
    productId,
    productName: productId,
    category,
    quantity: qty,
    unitPriceMinor: unit,
    regularPriceMinor: unit,
    brand: null,
    variantLabel: null,
  };
}

describe("validateCardCapture", () => {
  it("accepts a complete, current, MCR-verified card", () => {
    expect(validateCardCapture(goodCard, TODAY).ok).toBe(true);
  });

  it("refuses an expired card", () => {
    const r = validateCardCapture({ ...goodCard, expiresOn: "2026-07-01" }, TODAY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toContain("expired");
  });

  it("refuses a not-yet-effective card", () => {
    expect(validateCardCapture({ ...goodCard, effectiveOn: "2026-08-01" }, TODAY).ok).toBe(false);
  });

  it("refuses when the MCR verification is not attested", () => {
    const r = validateCardCapture({ ...goodCard, mcrVerified: false }, TODAY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toContain("DOH database");
  });

  it("refuses a short UPID and a bad holder type", () => {
    expect(validateCardCapture({ ...goodCard, upid: "x" }, TODAY).ok).toBe(false);
    expect(validateCardCapture({ ...goodCard, holderType: "friend" as never }, TODAY).ok).toBe(false);
  });
});

describe("medicalAgeAllowed (18–20 registered-patient allowance)", () => {
  it("21+ always allowed", () => {
    expect(medicalAgeAllowed(21, false).allowed).toBe(true);
  });
  it("18–20 allowed only WITH a valid card", () => {
    expect(medicalAgeAllowed(19, true).allowed).toBe(true);
    expect(medicalAgeAllowed(19, false).allowed).toBe(false);
  });
  it("under 18 never allowed at retail", () => {
    expect(medicalAgeAllowed(17, true).allowed).toBe(false);
  });
});

describe("applyMedicalPricing (exemption pass-through)", () => {
  it("fully exempt registered line reprices to its pre-tax base", () => {
    // $14.63 inclusive → $10.00 base; both exemptions ⇒ patient pays $10.00.
    const r = applyMedicalPricing([mk("prod-compliant", "edibles", 1463)], cfg, {
      cardedValid: true,
      saleDateYmd: TODAY,
    });
    expect(r.lines[0].unitPriceMinor).toBe(1000);
    expect(r.lines[0].medicalSavingsMinor).toBe(463);
    expect(r.medicalSavingsMinor).toBe(463);
  });

  it("unregistered product stays at full price (conservative claim policy)", () => {
    const r = applyMedicalPricing([mk("prod-unknown", "flower", 1463)], cfg, {
      cardedValid: true,
      saleDateYmd: TODAY,
    });
    expect(r.lines[0].unitPriceMinor).toBe(1463);
    expect(r.medicalSavingsMinor).toBe(0);
  });

  it("uncarded buyer claims nothing — even high-CBD (over-remit, never under-document)", () => {
    const r = applyMedicalPricing([mk("prod-cbd", "edibles", 1463)], cfg, {
      cardedValid: false,
      saleDateYmd: TODAY,
    });
    expect(r.lines[0].unitPriceMinor).toBe(1463);
    expect(r.medicalSavingsMinor).toBe(0);
  });

  it("high-THC to an uncarded buyer is a violation; carded is allowed + exempt", () => {
    const blocked = applyMedicalPricing([mk("prod-ht", "edibles", 5000)], cfg, {
      cardedValid: false,
      saleDateYmd: TODAY,
    });
    expect(blocked.highThcViolations).toEqual(["prod-ht"]);

    const allowed = applyMedicalPricing([mk("prod-ht", "edibles", 1463)], cfg, {
      cardedValid: true,
      saleDateYmd: TODAY,
    });
    expect(allowed.highThcViolations).toEqual([]);
    expect(allowed.lines[0].unitPriceMinor).toBe(1000);
  });

  it("post-sunset (WAC 314-55-090(6)): sales exemption survives, excise is due", () => {
    const r = applyMedicalPricing([mk("prod-compliant", "edibles", 1463)], cfg, {
      cardedValid: true,
      saleDateYmd: "2029-07-01",
    });
    expect(r.exciseSunsetPassed).toBe(true);
    // base $10.00 + 37% excise $3.70, sales tax exempt.
    expect(r.lines[0].unitPriceMinor).toBe(1370);
  });

  it("unendorsed store grants no exemptions; merch never exempt; savings scale with qty", () => {
    const noEnd = applyMedicalPricing([mk("prod-compliant", "edibles", 1463)], { ...cfg, endorsed: false }, {
      cardedValid: true,
      saleDateYmd: TODAY,
    });
    expect(noEnd.medicalSavingsMinor).toBe(0);

    const merch = applyMedicalPricing([mk("prod-compliant", "merch", 1093)], cfg, {
      cardedValid: true,
      saleDateYmd: TODAY,
    });
    expect(merch.lines[0].unitPriceMinor).toBe(1093);

    const qty = applyMedicalPricing([mk("prod-compliant", "edibles", 1463, 2)], cfg, {
      cardedValid: true,
      saleDateYmd: TODAY,
    });
    expect(qty.lines[0].medicalSavingsMinor).toBe(926);
  });
});

describe("validateMedicalSaleBlock", () => {
  const U = "11111111-1111-4111-8111-111111111111";

  it("accepts a complete block", () => {
    expect(
      validateMedicalSaleBlock({ card: goodCard, cardEventUuid: U, medicalSavingsMinor: 463 }, TODAY).ok,
    ).toBe(true);
  });

  it("refuses without the card-capture audit event UUID", () => {
    expect(validateMedicalSaleBlock({ card: goodCard, medicalSavingsMinor: 463 }, TODAY).ok).toBe(false);
  });

  it("refuses without a card and refuses negative savings", () => {
    expect(validateMedicalSaleBlock({ cardEventUuid: U, medicalSavingsMinor: 0 }, TODAY).ok).toBe(false);
    expect(
      validateMedicalSaleBlock({ card: goodCard, cardEventUuid: U, medicalSavingsMinor: -1 }, TODAY).ok,
    ).toBe(false);
  });
});

describe("embedded self-tests", () => {
  it("run clean", () => {
    expect(() => __runMedicalPosCoreTests()).not.toThrow();
  });
});
