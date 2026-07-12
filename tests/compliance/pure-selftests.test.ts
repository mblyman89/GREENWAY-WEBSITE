/**
 * tests/compliance/pure-selftests.test.ts  (S-14 / GAP M-11)
 *
 * Runs every embedded __run*Tests() self-test suite under vitest so the whole
 * pure-module regression net executes in CI on every PR (same coverage as
 * scripts/compliance/run-pure-selftests.ts, which remains for quick local
 * runs). Each suite throws on its first failure.
 */
import { describe, it, expect } from "vitest";
import { __runOrderPricingTests } from "@/lib/orders/order-pricing-core";
import { __runDiscountEngineTests } from "@/lib/promotions/discount-engine-core";
import { __runPromoGuardTests } from "@/lib/promotions/promo-guard-core";
import { __runSalesLimitTests } from "@/lib/compliance/sales-limits-core";
import { __runSalesLimitGateTests } from "@/lib/compliance/sales-limit-gate-core";
import { __runChunkedInTests } from "@/lib/supabase/chunked-in";
import { __runExemptSaleRecordTests } from "@/lib/medical/exempt-sale-record-core";
import { __runMedTaxTests } from "@/lib/medical/tax";
import { __runMedicalAuthorizationTests } from "@/lib/medical/medical-authorization-core";
import { __runMedicalIntakeTests } from "@/lib/medical/medical-intake-core";
import { __runMedicalSaleTests } from "@/lib/medical/medical-sale-core";
import { __runSalesHoursCoreTests } from "@/lib/compliance/sales-hours-core";
import { __runReceiptCoreTests } from "@/lib/printing/receipt-core";
import { __runPinHashTests } from "@/lib/security/pin-hash";
import { __runAtRestCryptoTests } from "@/lib/security/at-rest-crypto";
import { __runEngineTests } from "@/lib/loyalty/engine";
import { __runLoyaltyConfigTests } from "@/lib/loyalty/loyalty-config-core";
import { __runLoyaltySaleTests } from "@/lib/loyalty/loyalty-sale-core";

describe("embedded pure self-test suites", () => {
  it("order-pricing-core (S-2/S-3 money math + floor)", () => {
    expect(() => __runOrderPricingTests()).not.toThrow();
  });
  it("discount-engine-core (promotions engine)", () => {
    expect(() => __runDiscountEngineTests()).not.toThrow();
  });
  it("promo-guard-core (Task R: CCRS below-cost publish guard)", () => {
    expect(() => __runPromoGuardTests()).not.toThrow();
  });
  it("sales-limits-core (WAC 314-55-095 buckets)", () => {
    expect(() => __runSalesLimitTests()).not.toThrow();
  });
  it("sales-limit-gate-core (S-1 completion gate)", () => {
    expect(() => __runSalesLimitGateTests()).not.toThrow();
  });
  it("chunked-in (S-7 pagination)", async () => {
    await expect(__runChunkedInTests()).resolves.not.toThrow();
  });
  it("exempt-sale-record-core (S-8 / WAC 314-55-090(2))", () => {
    const r = __runExemptSaleRecordTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThan(0);
  });
  it("medical/tax (RCW 82.08.9998 + WAC 314-55-090 exemptions, card validity)", () => {
    expect(() => __runMedTaxTests()).not.toThrow();
  });
  it("medical-authorization-core (DOH 608-048 issuance + validity-at-date)", () => {
    const r = __runMedicalAuthorizationTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThan(0);
  });
  it("medical-sale-core (Task O: DOH categories, exemption plan, high-THC gate)", () => {
    expect(() => __runMedicalSaleTests()).not.toThrow();
  });
  it("medical-intake-core (Task P: RCW 69.51A.230(4) date rules, age classes, card number)", () => {
    const r = __runMedicalIntakeTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThan(0);
  });
  it("sales-hours-core (WAC 314-55-147 window)", () => {
    expect(() => __runSalesHoursCoreTests()).not.toThrow();
  });
  it("receipt-core (Pacific timestamps, receipt shape)", () => {
    expect(() => __runReceiptCoreTests()).not.toThrow();
  });
  it("pin-hash (S-10 scrypt + throttle)", () => {
    expect(() => __runPinHashTests()).not.toThrow();
  });
  it("at-rest-crypto (S-10 AES-256-GCM envelope)", () => {
    expect(() => __runAtRestCryptoTests()).not.toThrow();
  });
  it("loyalty engine (points math, tiers, code gen)", () => {
    expect(() => __runEngineTests()).not.toThrow();
  });
  it("loyalty-config-core (customizer drafts, RCW discount cap)", () => {
    expect(() => __runLoyaltyConfigTests()).not.toThrow();
  });
  it("loyalty-sale-core (Task S-a: best-deal-wins, code spread, floors)", () => {
    expect(() => __runLoyaltySaleTests()).not.toThrow();
  });
});
