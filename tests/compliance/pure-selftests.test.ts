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
import { __runSignupCustomerTests } from "@/lib/loyalty/signup-customer-core";
import { __runScheduleCoreTests } from "@/lib/staffing/schedule-core";
import { __runEmployeeLifecycleTests } from "@/lib/staffing/employee-lifecycle-core";
import { __runUserGuardTests } from "@/lib/auth/user-guards-core";
import { __runCampaignRulesTests } from "@/lib/marketing/campaign-rules-core";
import { __runCompetitivePlaybookTests } from "@/lib/marketing/competitive-playbook-core";
import { __runMidjourneyCoreTests } from "@/lib/marketing/midjourney-core";
import { __runFluxCoreTests } from "@/lib/marketing/flux-core";
import { __runCreativePlacementsTests } from "@/lib/marketing/creative-placements-core";
import { __runCcrsWeekTests } from "@/lib/compliance/ccrs-week-core";
import { __runCcrsDeadlineTests } from "@/lib/compliance/ccrs-deadline-core";
import { __runCcrsErrorTriageTests } from "@/lib/compliance/ccrs-error-triage-core";
import { __runMenuFeedTests } from "@/lib/syndication/menu-feed-core";
import { __runLeaflyPayloadTests } from "@/lib/leafly/payload-core";
import { __runWmPayloadTests } from "@/lib/weedmaps/payload-core";
import { __runIntegrationCredentialsTests } from "@/lib/integrations/integration-credentials-core";
import { __runSyncPlanTests } from "@/lib/syndication/sync-plan-core";
import { __runPreflightTests } from "@/lib/syndication/preflight-core";
import { __runRichnessTests } from "@/lib/syndication/richness-core";
import { __runSyncSettingsTests } from "@/lib/syndication/sync-settings-core";
import { __runApplySettingsTests } from "@/lib/syndication/apply-settings-core";

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
  it("signup-customer-core (Task V: signup → customer create-or-link)", () => {
    expect(() => __runSignupCustomerTests()).not.toThrow();
  });
  it("schedule-core (week math, Pacific)", () => {
    expect(() => __runScheduleCoreTests()).not.toThrow();
  });
  it("employee-lifecycle-core (Task S-b: RCW 49.94 order, activation gate, deadlines, sick leave)", () => {
    const n = __runEmployeeLifecycleTests();
    expect(n).toBeGreaterThan(0);
  });
  it("user-guards-core (Task S-c: self-rule, rank rule, privilege ceiling, last-owner rule)", () => {
    const n = __runUserGuardTests();
    expect(n).toBeGreaterThan(0);
  });
  it("campaign-rules-core (Task S-d: WAC 314-55-155 per-channel rules, warnings map)", () => {
    const n = __runCampaignRulesTests();
    expect(n).toBeGreaterThan(0);
  });
  it("competitive-playbook-core (Task S-d: legal plays, in-app tool links, guardrails)", () => {
    const n = __runCompetitivePlaybookTests();
    expect(n).toBeGreaterThan(0);
  });
  it("midjourney-core (Creative Studio brief -> prompt assembly)", () => {
    expect(() => __runMidjourneyCoreTests()).not.toThrow();
  });
  it("flux-core (Task U: verified per-endpoint FLUX request contracts)", () => {
    expect(() => __runFluxCoreTests()).not.toThrow();
  });
  it("creative-placements-core (Task U: verified destination sizes, 4MP ceiling)", () => {
    expect(() => __runCreativePlacementsTests()).not.toThrow();
  });
  it("ccrs-week-core (Task W: Sun–Sat week, due next Sunday, reminder planner)", () => {
    const r = __runCcrsWeekTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThan(0);
  });
  it("ccrs-deadline-core (Slice 106 + Task W: LIQ-1295 due dates + monthly reminder planner)", () => {
    const r = __runCcrsDeadlineTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThan(0);
  });
  it("ccrs-error-triage-core (Task W: error-email triage + examiner draft)", () => {
    const r = __runCcrsErrorTriageTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThan(0);
  });
  it("menu-feed-core (syndication feed mapping: strain normalize, stock, quantity, image)", () => {
    expect(() => __runMenuFeedTests()).not.toThrow();
  });
  it("leafly-payload-core (Leafly v2 wire format: cents, quantity, null-not-NA)", () => {
    expect(() => __runLeaflyPayloadTests()).not.toThrow();
  });
  it("weedmaps-payload-core (Task X: verified Request_MenuItem variants/price/weight)", () => {
    expect(() => __runWmPayloadTests()).not.toThrow();
  });
  it("integration-credentials-core (DB-over-env overrides + masking)", () => {
    expect(() => __runIntegrationCredentialsTests()).not.toThrow();
  });
  it("sync-plan-core (Task X: payload-hash idempotency + delta sync plan)", () => {
    expect(() => __runSyncPlanTests()).not.toThrow();
  });
  it("preflight-core (Task X: pre-push validation — dup ids, prices, weights)", () => {
    expect(() => __runPreflightTests()).not.toThrow();
  });
  it("richness-core (Task X: menu richness scoring + connection health)", () => {
    expect(() => __runRichnessTests()).not.toThrow();
  });
  it("sync-settings-core (Task X: owner-tunable transmission parameters)", () => {
    expect(() => __runSyncSettingsTests()).not.toThrow();
  });
  it("apply-settings-core (Task X: owner toggles applied to channel payloads)", () => {
    expect(() => __runApplySettingsTests()).not.toThrow();
  });
});
