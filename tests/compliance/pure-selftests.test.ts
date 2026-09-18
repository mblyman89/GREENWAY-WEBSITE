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
import { __runBrandMatchTests } from "@/lib/promotions/brand-match-core";
import { __runBrandResolveCoreTests } from "@/lib/inventory/brand-resolve-core";
import { __runPoReceiveCoreTests } from "@/lib/inventory/po-receive-core";
import { __runMarkdownLockTests } from "@/lib/promotions/markdown-lock-core";
import { __runBundleApportionmentTests } from "@/lib/promotions/bundle-apportionment-core";
import { __runSaturdayHeadlineTests } from "@/lib/promotions/saturday-headline-core";
import { __runWeightLabelTests } from "@/lib/compliance/weight-label-core";
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
import { __runCcrsSubmitGateTests } from "@/lib/compliance/ccrs-submit-gate-core";
import { __runCcrsPreflightCoreTests } from "@/lib/compliance/ccrs-preflight-core";
import { __runMenuFeedTests } from "@/lib/syndication/menu-feed-core";
import { __runLeaflyPayloadTests } from "@/lib/leafly/payload-core";
import { __runLeaflyPayloadValidateTests } from "@/lib/leafly/payload-validate-core";
import { __runLeaflyOrderabilityTests } from "@/lib/leafly/orderability-core";
import { __runLeaflyReadbackTests } from "@/lib/leafly/readback-core";
import { __runLeaflyCertificationTests } from "@/lib/leafly/certification-core";
import { __runLeaflyHmacTests } from "@/lib/leafly/hmac-core";
import { __runLeaflyOrderMapTests } from "@/lib/leafly/order-map-core";
import { __runLeaflyWebhookParseTests } from "@/lib/leafly/webhook-parse-core";
import { __runLeaflyPreviewTests } from "@/lib/leafly/preview-core";
import { __runLeaflyOrderAckTests } from "@/lib/leafly/order-ack-core";
import { __runLeaflyScheduleTests } from "@/lib/leafly/schedule-core";
import { __runLeaflyEvidenceTests } from "@/lib/leafly/evidence-core";
import { __runOrderOriginTests } from "@/lib/orders/order-origin-core";
import { __runLeaflyBridgeTests } from "@/lib/leafly/bridge-core";
import { __runWmPayloadTests } from "@/lib/weedmaps/payload-core";
import { __runIntegrationCredentialsTests } from "@/lib/integrations/integration-credentials-core";
import { __runSyncPlanTests } from "@/lib/syndication/sync-plan-core";
import { __runPreflightTests } from "@/lib/syndication/preflight-core";
import { __runRichnessTests } from "@/lib/syndication/richness-core";
import { __runSyncSettingsTests } from "@/lib/syndication/sync-settings-core";
import { __runApplySettingsTests } from "@/lib/syndication/apply-settings-core";
import { __runSyndicationPlaybookTests } from "@/lib/integrations/syndication-playbook";

describe("embedded pure self-test suites", () => {
  it("order-pricing-core (S-2/S-3 money math + floor)", () => {
    expect(() => __runOrderPricingTests()).not.toThrow();
  });
  it("discount-engine-core (promotions engine)", () => {
    expect(() => __runDiscountEngineTests()).not.toThrow();
  });
  it("brand-match-core (SLICE T1: ONE brand matcher, real catalogue fixtures)", () => {
    const r = __runBrandMatchTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThan(0);
  });
  it("markdown-lock-core (SLICE C1: clearance is excluded from other deals)", () => {
    const r = __runMarkdownLockTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThan(0);
  });
  it("brand-resolve-core (rule 11: RECEIVING intake shares the ONE brand matcher)", () => {
    const r = __runBrandResolveCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThan(0);
  });
  it("po-receive-core (defects A+B: auto-receive refuses ambiguous names)", () => {
    const r = __runPoReceiveCoreTests();
    expect(r.passed).toBeGreaterThan(0);
  });
  it("bundle-apportionment-core (SLICE D1: exact-cent N-for-M splitting)", () => {
    const r = __runBundleApportionmentTests();
    expect(r.passed).toBeGreaterThan(0);
  });
  it("saturday-headline-core (SLICE D3: headline target + exact-cent blend)", () => {
    const r = __runSaturdayHeadlineTests();
    expect(r.passed).toBeGreaterThan(0);
  });
  it("weight-label-core (SLICE W1: one grams parser for discounts AND the WAC limit)", () => {
    expect(() => __runWeightLabelTests()).not.toThrow();
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
  // CCRS bible slice S-01 / gap N-06: this suite existed but was never imported,
  // so the gate that decides whether a batch may be uploaded had NO enforced
  // coverage. Errors reach the owner only by email after the fact [G L0051].
  it("ccrs-submit-gate-core (S-01/N-06: the upload gate — errors block, warnings do not)", () => {
    const r = __runCcrsSubmitGateTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThan(0);
  });
  // CCRS bible slice S-02 / gaps E7-E13: the pre-flight checks that stop a
  // file CCRS would reject outright. Registered here so the embedded
  // assertions actually execute under Vitest (the N-06 lesson).
  it("ccrs-preflight-core (S-02: E7-E13 blocking pre-flight checks)", () => {
    const out = __runCcrsPreflightCoreTests();
    expect(out).toContain("0 failed");
  });
  it("menu-feed-core (syndication feed mapping: strain normalize, stock, quantity, image)", () => {
    expect(() => __runMenuFeedTests()).not.toThrow();
  });
  it("leafly-payload-core (Leafly v2 wire format: cents, quantity, null-not-NA)", () => {
    expect(() => __runLeaflyPayloadTests()).not.toThrow();
  });
  it("leafly-payload-validate-core (SLICE L-2: fail-closed last gate before the wire)", () => {
    const r = __runLeaflyPayloadValidateTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThan(100);
  });
  it("leafly-orderability-core (SLICE L-3: fail-closed pickup + DOH/endorsement gates)", () => {
    const r = __runLeaflyOrderabilityTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThan(50);
  });
  it("leafly-readback-core (SLICE L-4: GET /menu parse + reconcile, fails soft)", () => {
    const r = __runLeaflyReadbackTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThan(82);
  });
  it("leafly-certification-core (SLICE L-4: Leafly's five criteria, fails closed)", () => {
    const r = __runLeaflyCertificationTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThan(60);
  });
  it("leafly-hmac-core (SLICE L-5: raw-body HMAC, timing-safe, fails closed)", () => {
    const r = __runLeaflyHmacTests();
    expect(r.failed).toBe(0);
    // Floor raised 70 -> 80 after the L-5 mutation sweep. Three mutations of
    // timingSafeStringEqual survived the whole suite (a plain `===`
    // short-circuit, a length short-circuit, and dropping the length fold), so
    // a NUL-padding case and a structural check that the compare has no early
    // return were added. Measured: 82.
    expect(r.passed).toBeGreaterThan(80);
  });
  it("leafly-order-map-core (SLICE L-5: status vocabulary in both directions)", () => {
    const r = __runLeaflyOrderMapTests();
    expect(r.failed).toBe(0);
    // Floor raised 135 -> 145 after the L-5 mutation sweep: repointing
    // LEAFLY_CANCEL_REASON_WE_MISSED_ACK at "store_closed" survived, because
    // the only assertion touching it interpolated the constant into the very
    // message it then searched. Measured: 149.
    expect(r.passed).toBeGreaterThan(145);
  });
  it("leafly-webhook-parse-core (SLICE L-5: fails soft, because the spec demands 200)", () => {
    const r = __runLeaflyWebhookParseTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThan(90);
  });
  it("leafly-preview-core (SLICE L-5: the money a shopper reads before buying)", () => {
    const r = __runLeaflyPreviewTests();
    expect(r.failed).toBe(0);
    // Floor raised 45 -> 68 after the L-5 mutation sweep: a halved excise rate,
    // two identical tax labels, and accepting a blank variant id all survived.
    // The first two survived because the tax-exclusive presentation derives
    // sales tax as the RESIDUAL, so the total still reconciled to the penny
    // while the breakdown was wrong. Measured: 73.
    //
    // A blank variant id needed a SECOND attempt: checking that it never
    // reaches the body did not close the mutation, because with the guard
    // removed the blank id falls through to the catalogue lookup and is removed
    // by the next branch with the identical adjustment code. The only
    // observable difference is the diagnostic NOTE -- "carried no variant id"
    // versus "not found in the Greenway catalogue" -- which is also the more
    // useful of the two, so that is what is asserted.
    expect(r.passed).toBeGreaterThan(71);
  });
  it("leafly-order-ack-core (SLICE L-6: talking back to Leafly, one-way doors)", () => {
    const r = __runLeaflyOrderAckTests();
    expect(r.failed).toBe(0);
    // Floor set at registration from a measured 169. Unlike the L-5 receivers,
    // every decision in this core produces an OUTBOUND side effect on Leafly's
    // side that we cannot take back: acknowledging permanently revokes our
    // access to the customer's ID images, and a status change is visible to the
    // shopper immediately. The suite therefore asserts the refusals, not just
    // the happy paths -- including that acknowledging twice is refused, that a
    // terminal order cannot be acknowledged, that `order_api_unacknowledged` is
    // rejected as an OUTBOUND cancel reason even though it is a legal INBOUND
    // one, and that HTTP 200 on acknowledge is NOT success because the spec
    // documents 204.
    //
    // Floor raised 165 -> 195 when the acknowledgement clock landed (measured
    // 200). The clock section is where this suite paid for itself: both
    // urgency thresholds were written with `<`, so an order with EXACTLY five
    // minutes left before Leafly auto-cancels it was classified "soon" instead
    // of "urgent". Both readings look right in review; only an assertion
    // sitting precisely on the boundary distinguishes them.
    //
    // Raised again 195 -> 370 (measured 382) when the ACTION PLANNER landed.
    // The planner decides which buttons the online orders dashboard shows, and
    // it exists so the screen can never offer an action Leafly would refuse.
    // Leafly's dashboard goes read-only once we are live -- "your software
    // system will become the source of truth for order statuses" -- so this
    // screen is the ONLY place a real customer's order can be moved, and a
    // button that looks live but is refused on click teaches staff that the
    // screen lies to them. The invariant is asserted in both directions
    // (nothing offered is refused; nothing accepted is withheld) across every
    // acknowledgement state x status x fulfillment mechanism, with a
    // non-vacuity guard so a planner that returns nothing at all cannot make
    // the matrix pass by iterating zero times.
    expect(r.passed).toBeGreaterThan(370);
  });
  it("leafly-schedule-core (SLICE L-7: both automation and the manual button)", () => {
    const r = __runLeaflyScheduleTests();
    expect(r.failed).toBe(0);
    // Floor 230, from a measured 242 at registration.
    //
    // This core answers two questions that both fail SILENTLY. First, whether
    // to contact Leafly at all: too often is the erratic request pattern their
    // certification checklist marks down, and too rarely freezes the published
    // menu without raising an error anywhere. Second, every word the owner
    // reads about automation -- so a wrong string here is nearly as damaging as
    // a wrong decision, because he acts on what he reads.
    //
    // The assertion this suite exists for is the frozen-menu case: an enabled,
    // configured, never-failed schedule whose next tick is calmly "not due"
    // while the authoritative full sync has not landed for two days. A summary
    // built from the next decision alone reports "Not due" in green over a dead
    // menu, and the suite asserts both that this is caught AND that an
    // identical calm decision over a fresh sync still reads healthy -- without
    // that second half, a function returning "Overdue" unconditionally would
    // pass.
    //
    // It also pins a measured PLATFORM limit rather than a preference. Vercel's
    // cron documentation (read 2026-09-18) states Hobby accounts are limited to
    // once-per-day crons and that more frequent expressions fail at deploy
    // time, so the daily full sync fires on an OR of "the configured Pacific
    // hour has arrived" and "20 hours have elapsed". The 24-hour sweep proving
    // the second trigger fires at every hour of the clock carries its own
    // non-vacuity guards, because a sweep is the easiest kind of test to
    // accidentally empty.
    expect(r.passed).toBeGreaterThanOrEqual(255);
  });
  it("leafly-evidence-core (SLICE L-8: the webhook evidence reader)", () => {
    const r = __runLeaflyEvidenceTests();
    expect(r.failed).toBe(0);
    // Floored at 300 against 323 measured. The two load-bearing properties:
    //
    //  * THE PRIVACY AUDIT. This core decides what leaves the building in a
    //    file the owner emails to Leafly. Leafly's own Order schema REQUIRES
    //    firstName, lastName, emailAddress and phoneNumber and may carry
    //    dateOfBirth and medicalCardNumber, all of which land in
    //    leafly_orders.raw_order. The suite proves every exported column is
    //    PII-free AND that the audit still catches a PII column when one is
    //    deliberately added -- so the guard cannot decay into a function that
    //    returns false for everything and passes vacuously.
    //  * THE VERDICT PRECEDENCE. A log in which every delivery failed on
    //    `missing_key` satisfies both `misconfigured` and `all_rejected`.
    //    `misconfigured` must win, because "you have not saved your HMAC key"
    //    is actionable and "everything is failing" is not. Swapping the two
    //    branches would leave every other assertion in this suite passing, so
    //    the precedence is asserted directly.
    expect(r.passed).toBeGreaterThanOrEqual(300);
  });
  it("order-origin-core (SLICE L-2: website vs Leafly vs register)", () => {
    const r = __runOrderOriginTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThan(40);
  });
  // SLICE L-10 -- the bridge between a Leafly order and the shop floor. This
  // core encodes the owner's two-stage split: announce + print on ARRIVAL so
  // staff have the fifteen-minute acknowledgement window in front of them,
  // then create the local order (and therefore register visibility) only on
  // ACCEPTANCE. A floor is asserted because the most dangerous regression
  // here is silent: if the suite body were gutted the pipeline would still
  // "pass" while double-printing or never printing at all.
  it("leafly-bridge-core (SLICE L-10: arrival announces/prints, acceptance creates)", () => {
    const r = __runLeaflyBridgeTests();
    expect(r.failed).toBe(0);
    // Raised 171 -> 281 when decideCancelPlan landed: a Leafly cancellation
    // must follow the order all the way to the floor, and all fourteen
    // status/till combinations are proven here.
    //
    // Raised 281 -> 354 when the workflow board landed (the owner's question
    // Q-C: run Leafly from our own back office instead of Leafly Biz). The
    // added assertions cover bucket placement, bucket ORDER -- needs_attention
    // is second, not buried -- and the three-state pipeline tracking where an
    // ABSENT announced_at/printed_at column means "not tracked" and must stay
    // silent, rather than accusing every order in the shop of never having
    // rung the bell while migration 0228 is still unapplied.
    expect(r.passed).toBeGreaterThanOrEqual(354);
  });
  it("weedmaps-payload-core (Task X: verified Request_MenuItem variants/price/weight)", () => {
    expect(() => __runWmPayloadTests()).not.toThrow();
  });
  // SLICE L-5 gave this core the Leafly HMAC key and order integration key, so
  // it is now what decides whether the webhook receivers can authenticate at
  // all. A floor is added because `not.toThrow()` alone also passes if the
  // suite body were ever emptied.
  it("integration-credentials-core (DB-over-env overrides + masking; L-5 Leafly keys)", () => {
    const r = __runIntegrationCredentialsTests();
    expect(r.passed).toBeGreaterThan(55);
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
  it("sync-settings-core (Task X + L-7: transmission parameters AND the schedule)", () => {
    // Was `expect(() => ...).not.toThrow()`, which a suite running zero
    // assertions would also have satisfied. L-7 moved the automatic sync
    // schedule into this same core and the same stored jsonb row, so the blind
    // spot covered the round trip that stops an unrelated save from silently
    // switching the owner's automation off. Counted and floored now, at 45 from
    // a measured 52.
    const r = __runSyncSettingsTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(45);
  });
  it("apply-settings-core (Task X: owner toggles applied to channel payloads)", () => {
    expect(() => __runApplySettingsTests()).not.toThrow();
  });
  it("syndication-playbook (Task X: verified connect/stay/reconnect playbook + AI grounding)", () => {
    expect(() => __runSyndicationPlaybookTests()).not.toThrow();
  });
});
