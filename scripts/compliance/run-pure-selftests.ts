/**
 * scripts/compliance/run-pure-selftests.ts
 *
 * Runs the embedded self-tests of the PURE compliance/money modules. Exits
 * non-zero on any failure. Run with:  npx tsx scripts/compliance/run-pure-selftests.ts
 */
import { __runOrderPricingTests } from "../../src/lib/orders/order-pricing-core";
import { __runTaxBaseCoreTests } from "../../src/lib/reports/tax-base-core";
import { __runExciseReturnTests } from "../../src/lib/compliance/excise-return-core";
// SLICE T1 -- the ONE brand matcher. Registered here because "is this
// product on the brand sale?" used to be answered by five separate
// hand-rolled copies, two of which decide MONEY (the engine and the
// register). Pure: no I/O.
import { __runBrandMatchTests } from "../../src/lib/promotions/brand-match-core";
import { __runBrandResolveCoreTests } from "../../src/lib/inventory/brand-resolve-core";
import { __runPoReceiveCoreTests } from "../../src/lib/inventory/po-receive-core";
// SLICE C1 -- clearance / vendor-day markdowns. Registered here because the
// owner's rule ("those items are excluded from any and all other sales")
// had no representation in the engine at all: a markdown shallower than the
// day's deal was silently overridden. Pure: no I/O.
import { __runMarkdownLockTests } from "../../src/lib/promotions/markdown-lock-core";
import { __runDiscountEngineTests } from "../../src/lib/promotions/discount-engine-core";
import { __runPromoGuardTests } from "../../src/lib/promotions/promo-guard-core";
import { __runPromotionSelectorTests } from "../../src/lib/promotions/promotion-selector-core";
import { __runPromotionSelectorAiTests } from "../../src/lib/promotions/promotion-selector-ai-core";
import { __runGuidedPromotionTests } from "../../src/lib/promotions/guided-promotion-core";
import { __runThursdayPlannerTests } from "../../src/lib/promotions/thursday-planner-core";
import { __runSalesLimitTests } from "../../src/lib/compliance/sales-limits-core";
// SLICE L1 -- the liquid VOLUME basis for WAC 314-55-095(1)(d)(i)(E). Pure: no
// DOM, no I/O. Registered here so CI proves the 2129.3 ml cap and the ml/L/fl oz
// parser on every push, even if the vitest mirror is ever renamed or skipped.
// Getting this wrong is a 72x over-sale (a 1.5 L bottle read as a 28 g unit).
// SLICE W1 -- the ONE weight-label parser, shared by the discount engines and
// the WAC 314-55-095 limit engine. Registered here because the two used to
// carry separate regexes and disagreed on 14 of 37 label shapes ("1/8 oz"
// read as 224 g on the discount side, granting a full-ounce tier to an
// eighth). Pure: no I/O.
import { __runWeightLabelTests } from "../../src/lib/compliance/weight-label-core";
import { __runLiquidVolumeTests } from "../../src/lib/compliance/liquid-volume-core";
import { __runLiquidVolumeDerivationTests } from "../../src/lib/compliance/liquid-volume-derivation-core";
import { __runSalesLimitGateTests } from "../../src/lib/compliance/sales-limit-gate-core";
import { __runCartLimitMeterCoreTests } from "../../src/lib/menu/cart-limit-meter-core";
import { __runChunkedInTests } from "../../src/lib/supabase/chunked-in";
import { __runReadCompletenessCoreTests } from "../../src/lib/supabase/read-completeness-core";
import { __runVendorSearchSafetyCoreTests } from "../../src/lib/inventory/vendor-search-safety-core";
import { __runExemptSaleRecordTests } from "../../src/lib/medical/exempt-sale-record-core";
import { __runSalesHoursCoreTests } from "../../src/lib/compliance/sales-hours-core";
import { __runReceiptCoreTests } from "../../src/lib/printing/receipt-core";
import { __runReceiptEscposTests } from "../../src/lib/printing/receipt-escpos-core";
import { __runVrettiSetupTests } from "../../src/lib/printing/vretti-setup-core";
import { __runPinHashTests } from "../../src/lib/security/pin-hash";
import { __runAtRestCryptoTests } from "../../src/lib/security/at-rest-crypto";
import { __runRlsCoverageTests } from "../../src/lib/security/rls-coverage-core";
import { __runEngineTests } from "../../src/lib/loyalty/engine";
import { __runLoyaltyConfigTests } from "../../src/lib/loyalty/loyalty-config-core";
import { __runLoyaltySaleTests } from "../../src/lib/loyalty/loyalty-sale-core";
import { __runSignupCustomerTests } from "../../src/lib/loyalty/signup-customer-core";
import { __runScheduleCoreTests } from "../../src/lib/staffing/schedule-core";
import { __runEmployeeLifecycleTests } from "../../src/lib/staffing/employee-lifecycle-core";
import { __runHandbookAckTests } from "../../src/lib/staffing/handbook-ack-core";
import { __runRegulatoryCoreTests } from "../../src/lib/regulatory/regulatory-core";
import { __runComplianceSurfaceTests } from "../../src/lib/regulatory/compliance-surface";
import { __runUserGuardTests } from "../../src/lib/auth/user-guards-core";
import { __runSetPasswordCoreTests } from "../../src/lib/auth/set-password-core";
import { __runLoginMessagesCoreTests } from "../../src/lib/auth/login-messages-core";
import { __runCampaignRulesTests } from "../../src/lib/marketing/campaign-rules-core";
import { __runCanvaCoreTests } from "../../src/lib/marketing/canva-core";
import { __runBlogContentCoreTests } from "../../src/lib/blog/blog-content-core";
import { __runCoreValuesTests } from "../../src/lib/about/core-values-core";
import { __runGlowCardCoreTests } from "../../src/lib/ui/glow-card-core";
import { __runSiteBackgroundTests } from "../../src/lib/ui/site-background-core";
// SLICE H — which shop facets are safe to promote to real, prerendered routes.
// Pure: no database, no network, no request. Registered here so CI proves the
// routable set stays in sync with the category taxonomy even if the vitest
// mirror is ever renamed or skipped. Getting this wrong ships either dead nav
// links (a slug with no prerendered page) or an uncrawlable menu.
import { __runMenuFacetTests } from "../../src/lib/menu/menu-facet-core";
// SLICE I — the age gate is a REGULATED gate, and it is also the storefront's
// LCP element. Pure: no DOM, no browser, no storage. Registered here so CI
// proves the fail-closed posture and the storage-key contract on every push,
// even if the vitest mirror is ever renamed or skipped. Getting this wrong
// either shows a modal to every returning customer forever (key drift) or lets
// an unverified visitor reach the menu (fail-open bootstrap).
import { __runAgeGateTests } from "../../src/lib/age-gate/age-gate-core";
// product-lookup-core imports the server-only compliance module, so its
// self-test is exercised via vitest (server-only aliased) + the parse core's
// pure test below, not this server-only-free runner. See
// tests/compliance/product-lookup-core.test.ts.
import { __runProductLookupParseTests } from "../../src/lib/inventory/product-lookup-parse";
import { __runCommitAuthorshipTests } from "../../src/lib/git/commit-authorship-core";
// SLICE 27 — the online order announcer. Pure by construction: no clock of its
// own, no database, no network, no Raspberry Pi. Registered here so CI proves
// the shop's audio rules even if the vitest mirror is ever renamed or skipped.
import { __runAnnouncerCoreTests } from "../../src/lib/announcer/announcer-core";
// SLICE 28 — the wire protocol between a Raspberry Pi and this site. Pure
// parsing and shaping; the Pi is the one client nobody can open a browser to
// debug, so every refusal it can receive is proven here.
import { __runAnnouncerProtocolTests } from "../../src/lib/announcer/announcer-protocol-core";
// SLICE 29 — deciding which speakers get told about a new order. Pure: takes the
// device list and the clock as arguments so it can be tested at 3am in July.
import { __runAnnouncerFanoutTests } from "../../src/lib/announcer/announcer-fanout-core";
import { __runAnnouncerSetupTests } from "../../src/lib/announcer/announcer-setup-core";
// SLICE 30 — what the back office shows about the speakers.
import { __runAnnouncerAdminTests } from "../../src/lib/announcer/announcer-admin-core";
import { __runAnnouncerSoundsTests } from "../../src/lib/announcer/announcer-sounds-core";
import { __runAnnouncerLibraryTests } from "../../src/lib/announcer/announcer-library-core";
// books-47, SLICE D: the Form / Why / Check teaching surface. All three are
// pure and browser-safe by construction -- none may touch node:fs, because the
// explorer that consumes them is a client component. Registering them here
// means CI runs their embedded self-tests even if the vitest file is ever
// renamed or skipped: a self-test nothing invokes is dead code wearing a green
// check (rule 50).
import { __runFormBoxCoreTests } from "../../src/lib/payroll/form-box-core";
import { __runFormBoxAdapterTests } from "../../src/lib/payroll/form-box-adapters";
import { __runFormBoxUiCoreTests } from "../../src/lib/payroll/form-box-ui-core";
import { __runFormBoxTeachingCoreTests } from "../../src/lib/payroll/form-box-teaching-core";
// books-63: the one period/employee reader every form page and tab now uses.
import { __runFormScopeCoreTests } from "../../src/lib/payroll/form-scope-core";
import { __runEsdEamsCsvTests } from "../../src/lib/payroll/esd-eams-csv-core";
import { __runExpenseClassificationCoreTests } from "../../src/lib/accounting/expense-classification-core";
// books-84: the bank-feed expense wire (D-56 / D-37).
import { __runBankExpenseCoreTests } from "../../src/lib/accounting/bank-expense-core";
// books-85: the approval path (D-67) — decides approve-then-post vs post-only.
import { __runApprovalCoreTests } from "../../src/lib/accounting/approval-core";
import { __runLargeDraftNoticeCoreTests } from "../../src/lib/accounting/large-draft-notice-core";
// books-91: journal-specimen-core's self-test is NOT registered here, and the
// omission is deliberate rather than an oversight. The specimen is built by the
// REAL engine, so it imports vendor-bill-service, which imports supabase/admin,
// which imports "server-only" -- and this runner has no alias for that marker,
// so importing it here would crash module resolution for every other test in
// the file. It is therefore invoked from tests/compliance/journal-specimen.test.ts,
// where vitest aliases the marker to a stub. Same arrangement, and same reason,
// as product-lookup-core above. The alternative -- reimplementing the bill
// engine in pure form so it could run here -- would make the specimen a
// SECOND implementation that could disagree with the one Michael actually
// uses, which is the exact failure this specimen exists to prevent.
import { __runPayrollPostingCoreTests } from "../../src/lib/accounting/payroll-posting-core";
import { __runRelatedPartyLoanCoreTests } from "../../src/lib/accounting/related-party-loan-core";
import { __runSaleJournalCoreTests } from "../../src/lib/accounting/sale-journal-core";
import { __runReceiptJournalCoreTests } from "../../src/lib/accounting/receipt-journal-core";
import { __runFactoryResetCoreTests } from "../../src/lib/accounting/factory-reset-core";
import { __runReceiptCategoryCoreTests } from "../../src/lib/accounting/receipt-category-core";
import { __runSaleCogsCoreTests } from "../../src/lib/accounting/sale-cogs-core";
// SLICE 8 — bulk fill of the fields the one-time Cultivera import never carried.
import { __runBulkFillCoreTests } from "../../src/lib/inventory/bulk-fill-core";
// SLICE 13 — the inventory page's filtering, sorting and smart-search engine.
import { __runInventorySearchCoreTests } from "../../src/lib/inventory/inventory-search-core";
import { __runInventoryFilterCoreTests } from "../../src/lib/inventory/inventory-filter-core";
import { __runInventorySortCoreTests } from "../../src/lib/inventory/inventory-sort-core";
import { __runInventoryListCoreTests } from "../../src/lib/inventory/inventory-list-core";
import { __runInventoryUrlCoreTests } from "../../src/lib/inventory/inventory-url-core";
import { __runFacetTypeaheadCoreTests } from "../../src/lib/inventory/facet-typeahead-core";
import { __runInventoryPageCoreTests } from "../../src/lib/inventory/inventory-page-core";
import { __runStrainMatcherTests } from "../../src/lib/ai/kb/strain-matcher";
import { __runEsd5208WorksheetTests } from "../../src/lib/payroll/esd-5208-worksheet-core";
import { __runCompetitivePlaybookTests } from "../../src/lib/marketing/competitive-playbook-core";
import { __runMidjourneyCoreTests } from "../../src/lib/marketing/midjourney-core";
import { __runFluxCoreTests } from "../../src/lib/marketing/flux-core";
import { __runCreativePlacementsTests } from "../../src/lib/marketing/creative-placements-core";
import { __runCcrsWeekTests } from "../../src/lib/compliance/ccrs-week-core";
import { __runCcrsDeadlineTests } from "../../src/lib/compliance/ccrs-deadline-core";
import { __runCcrsErrorTriageTests } from "../../src/lib/compliance/ccrs-error-triage-core";
import { __runMenuFeedTests } from "../../src/lib/syndication/menu-feed-core";
import { __runLeaflyPayloadTests } from "../../src/lib/leafly/payload-core";
// SLICE L-2 -- the ONE order-origin vocabulary. Registered here because three
// separate subsystems (the register pickup queue, the Raspberry Pi announcer,
// and the Pi receipt printer) all have to agree on what "where did this order
// come from" means, and the owner asked for them to behave DIFFERENTLY per
// origin (a distinct chime per source). Without one shared vocabulary that is
// three hand-rolled copies of the same enum -- the exact shape of the bug the
// brand matcher already taught this codebase. Pure: no I/O.
import { __runOrderOriginTests } from "../../src/lib/orders/order-origin-core";
import { __runOrderBoardSplitTests } from "../../src/lib/orders/order-board-split-core";
// SLICE L-40 -- the ONE set of rules both order panels (Greenway and Leafly)
// use for tabs, search, dates, totals, sort and paging. Pure: no I/O.
import { __runOrdersPanelTests } from "../../src/lib/orders/order-panels-core";
import { __runLeaflyBridgeTests } from "../../src/lib/leafly/bridge-core";
// SLICE L-2 -- the LAST GATE before a menu payload goes on the wire. Registered
// here because every defect this slice repaired would have been caught by
// reading the payload and comparing it to the published contract, and nothing
// in the codebase was responsible for doing that. Pure: no I/O.
import { __runLeaflyPayloadValidateTests } from "../../src/lib/leafly/payload-validate-core";
// SLICE L-3 — orderability (L-09) + the medical endorsement gate (L-11).
import { __runLeaflyOrderabilityTests } from "../../src/lib/leafly/orderability-core";
// SLICE L-4 — the GET /menu readback contract (L-14) and its reconciler.
import { __runLeaflyReadbackTests } from "../../src/lib/leafly/readback-core";
// SLICE L-19 — WHICH payload the read-back compares Leafly's menu against.
// Registered here because getting it wrong is not a subtle miscount: after the
// shop's first targeted push of 8 products, the read-back compared the whole
// 2,562-item feed against the 8 Leafly was asked to hold and reported "19
// PROBLEMS!" on a transmission that had in fact succeeded completely. A tool
// that cries wolf on a perfect result is worse than no tool, because the next
// warning -- the real one -- gets dismissed too.
import { __runLeaflyReadbackBaselineTests } from "../../src/lib/leafly/readback-baseline-core";
// SLICE L-19 — the picker's view logic: which quick start is in effect, which
// rows the table shows, and what exactly is about to be transmitted. Pure: no
// React, no DOM. Registered here because the highlight is DERIVED from the
// filters rather than remembered, and that derivation is the only thing
// stopping a lit-up pill from asserting something false about the list beneath
// it. It also computes how many selected products are hidden off-screen --
// items that would be sent without ever being reviewed.
import { __runLeaflyPickerViewTests } from "../../src/lib/leafly/picker-view-core";
import { __runLeaflyVariantIdentityTests } from "../../src/lib/leafly/variant-identity-core";
import { __runLeaflyMenuVisibilityTests } from "../../src/lib/leafly/menu-visibility-core";
// TASK I — the full-menu push failure.
import { __runLeaflyPotencyTests } from "../../src/lib/leafly/potency-core";
import { __runLeaflyQuarantineTests } from "../../src/lib/leafly/quarantine-core";
import { __runLeaflyDeleteRequestTests } from "../../src/lib/leafly/delete-request-core";
import { __runLeaflyProductIdentityTests } from "../../src/lib/leafly/product-identity-core";
import { __runLeaflyCollisionRemedyTests } from "../../src/lib/leafly/collision-remedy-core";
import { __runLeaflySampleRotationTests } from "../../src/lib/leafly/sample-rotation-core";
import { __runLeaflySendabilityTests } from "../../src/lib/leafly/sendability-core";
import { __runLeaflyMenuBrowserTests } from "../../src/lib/leafly/menu-browser-core";
import { __runLeaflyCollisionApplyTests } from "../../src/lib/leafly/collision-apply-core";
import { __runLeaflyCollisionSplitTests } from "../../src/lib/leafly/collision-split-core";
import { __runLeaflyFixLinkTests } from "../../src/lib/leafly/fix-link-core";
import { __runLeaflyFullMenuTests } from "../../src/lib/leafly/full-menu-core";
import { __runLeaflyAutoSyncTests } from "../../src/lib/leafly/auto-sync-core";
import { __runLeaflyReplaceMenuTests } from "../../src/lib/leafly/replace-menu-core";
import { __runLeaflyRetailerKeyTests } from "../../src/lib/leafly/retailer-key-core";
import { __runLeaflyInboundBudgetTests } from "../../src/lib/leafly/inbound-budget-core";
import { __runLeaflyCertificationProofTests } from "../../src/lib/leafly/certification-proof-core";
import { __runLeaflyOrderCartTests } from "../../src/lib/leafly/order-cart-core";
// The owner asked what "stage 2 changes how your menu looks to shoppers"
// actually means. This core is the answer: it names the listings a shopper
// would see instead of reporting a count. Registered here because the WORDING
// is the deliverable -- a regression that turned the prose back into "3
// products became 9" would satisfy every type check and still fail him.
import { __runLeaflySplitPreviewTests } from "../../src/lib/leafly/split-preview-core";
// SLICE L-4 — Leafly's five published menu-certification criteria.
import { __runLeaflyCertificationTests } from "../../src/lib/leafly/certification-core";
// SLICE L-5 — receiving orders FROM Leafly. Four pure cores, all registered
// here because each one decides something that is invisible when it goes wrong:
//   hmac-core          — whether an inbound webhook is genuine at all. A broken
//                        comparison either rejects every real order or accepts
//                        forged ones, and neither announces itself.
//   order-map-core     — the status vocabulary in both directions, including
//                        Leafly's "canceled" (one l) vs Greenway's "cancelled".
//   webhook-parse-core — fails SOFT by contract, because the spec forbids a
//                        non-200 answer; that makes a parsing bug silent unless
//                        it is tested directly.
//   preview-core       — money a shopper reads before deciding to buy.
import { __runLeaflyHmacTests } from "../../src/lib/leafly/hmac-core";
import { __runLeaflyOrderMapTests } from "../../src/lib/leafly/order-map-core";
import { __runLeaflyWebhookParseTests } from "../../src/lib/leafly/webhook-parse-core";
import { __runLeaflyPreviewTests } from "../../src/lib/leafly/preview-core";
// SLICE L-6 — talking BACK to Leafly. This core is the mirror image of the L-5
// receivers and its failure mode is the opposite one, which is why it needs its
// own registration rather than riding along with order-map-core:
//   order-ack-core     — decides whether we may acknowledge an order at all,
//                        which host to send it to, and which status changes
//                        Leafly will accept. Three things make a bug here
//                        expensive rather than merely wrong. (1) Acknowledging
//                        is a ONE-WAY DOOR: the spec says it permanently
//                        revokes our access to the customer's ID images, so an
//                        acknowledgement sent too early destroys evidence we
//                        are required to check. (2) The Order API lives on a
//                        DIFFERENT host from the Menu API while sharing the
//                        same token URL, so reusing the menu base URL produces
//                        a plausible-looking 404 instead of an obvious crash.
//                        (3) Unlike the inbound webhooks, these endpoints have
//                        DOCUMENTED error responses, so silence is not an
//                        acceptable answer — every rejection must be classified
//                        as retry, fix-config, fix-request or gone.
import { __runLeaflyOrderAckTests } from "../../src/lib/leafly/order-ack-core";
// SLICE L-17 -- deadlines. Before this slice every outbound Leafly fetch was
//               untimed; `grep -rn "AbortController\|AbortSignal.timeout"
//               src/lib/leafly/` returned nothing, while seventeen other
//               client files in this repo already bounded their requests.
//               The owner felt it directly: "i can click the acknowledge
//               button, confirm the action, then it sits waiting forever
//               stuck."
//
//               This core owns three things that are rules rather than
//               plumbing, which is why it is floored rather than trusted to
//               a code review. (1) EVERY operation has a finite budget --
//               the invariant whose violation IS the bug. (2) A TIMEOUT IS
//               NOT A DELIVERY FAILURE: when we stop listening we do not
//               learn that nothing arrived, so an acknowledge that timed out
//               may never be reported as safe to repeat -- acknowledging
//               twice cannot be undone and revokes the customer's ID images.
//               (3) The budgets must fit inside Leafly's fifteen-minute
//               auto-cancel window with room left to actually recover.
//               All three are asserted over the full 8 x 5 operation/fault
//               matrix rather than sampled.
import { __runLeaflyDeadlineTests } from "../../src/lib/leafly/deadline-core";
import { __runLeaflySetupCacheTests } from "../../src/lib/leafly/setup-cache-core";
import {
  MENU_CACHE_TAG,
  MENU_CACHE_TTL_SECONDS,
} from "../../src/lib/menu/menu-cache-policy-core";
// SLICE M-1 -- fetching the order body. The order_submit webhook carries ONLY
//              metadata (eventTime, eventType, orderId, orderIntegrationKey,
//              acknowledgeBy). The cart, the customer and the totals live
//              behind a separate GET that Leafly marks *Required*. Without
//              that GET nothing can print, because the printer is handed a
//              payload with no order id in it. Registered with a floor because
//              every failure mode in this file is SILENT: a bad URL, a dropped
//              token refresh or a mis-read 404 all end with the order simply
//              never appearing, which is exactly the bug this core exists to
//              make impossible to reintroduce.
import { __runLeaflyOrderDetailTests } from "../../src/lib/leafly/order-detail-core";
// SLICE L-25 -- the DATABASE half of "nothing may hang forever".
//
// The acknowledge button hung through two slices that both, correctly,
// bounded the NETWORK. Nobody had bounded the database: measured against a
// real black-hole HTTP server, an unbounded PostgREST query was still
// hanging at 8006ms, while the same query with `.abortSignal()` returned a
// clean error value at 1505ms (scripts/recon/supabase-hang-probe.mjs).
//
// This core owns the budgets and the arithmetic that proves one acknowledge
// click -- 80s of network worst case plus every database call it can make --
// still fits under the action's own 240s budget, which in turn loses the
// race to Vercel's 300s ceiling deliberately, so we render an explanation
// instead of being killed mid-render.
import { __selfTestDbDeadlineCore } from "../../src/lib/leafly/db-deadline-core";
import { __runOnlineOrdersReportTests } from "../../src/lib/leafly/online-orders-report-core";
import { __runLeaflyStaffAlertTests } from "../../src/lib/leafly/staff-alert-core";
import { __runLeaflyOrderFetchTests } from "../../src/lib/leafly/order-fetch-core";
// SLICE M-2 -- readiness. An order can be silent for reasons that are not
//              code defects at all: Leafly may never have been told our
//              webhook URLs, or the order integration key may not be set.
//              This core turns "nothing happened" into a named, ordered next
//              step, and decides whether the dashboard panel may hide itself.
//              Floored because a panel that wrongly hides is invisible by
//              definition -- no one can report a bug they cannot see.
import { __runLeaflyOrderReadinessTests } from "../../src/lib/leafly/order-readiness-core";
import { __runDisclosureTests } from "../../src/lib/admin/disclosure-core";
// SLICE L-21 -- the setup tab, and the rule that keeps it safe: which live
//              alarms may NOT be hidden behind a tab.
import { __runOrdersTabsTests } from "../../src/lib/admin/orders-tabs-core";
// SLICE L-22 -- what goes first on the orders board, and who gets an origin
//              label. Two judgements the owner asked to change, both of which
//              had a previous slice's reasoning behind them: L-6 put Leafly on
//              top because of the 15-minute auto-cancel clock, and L-12 hid the
//              "Website" badge because 40 identical badges train the eye to
//              skip the column. Neither was wrong; both were absolute. This
//              core makes each conditional on a fact, so the owner gets the
//              layout he asked for WITHOUT losing the protection that the
//              earlier reasoning was buying.
import { __runBoardOrderTests } from "../../src/lib/admin/orders-board-order-core";
// SLICE L-16 -- refusal diagnosis. The setup panel told the owner "Leafly is
//              reaching us but the signature didn't match ... the webhook HMAC
//              key here doesn't match the one Leafly issued" on the strength of
//              a bare COUNT of refused deliveries. Six of those refusals were
//              unsigned probes (`missing_header`), several of them run by hand
//              during diagnosis -- requests that never carried a key and so can
//              say nothing whatever about one. A fully healthy integration was
//              reporting a credential fault, and acting on that advice means
//              rotating a working key. This core splits refusals by their
//              recorded reason and permits exactly ONE of the seven
//              (`mismatch`) to point at Leafly. Floored because the failure it
//              prevents is confident, plausible, wrong advice -- the most
//              expensive kind, since it is acted on.
import {
  __runLeaflyRefusalDiagnosisTests,
} from "../../src/lib/leafly/refusal-diagnosis-core";
// SLICE L-7 -- the automatic sync schedule. Registered with a floor because the
// two things this core decides are both silent when wrong: it decides WHETHER
// to talk to Leafly (getting that wrong too often is a certification failure,
// getting it wrong too rarely freezes the published menu with no error
// anywhere), and it produces every WORD the owner reads about automation on the
// integrations page. A frozen menu under a green panel is the specific outcome
// its `summarizeAutomation` assertions exist to make impossible.
import { __runLeaflyScheduleTests } from "../../src/lib/leafly/schedule-core";
// SLICE L-8 -- the READ side of the Leafly webhook evidence log.
import { __runLeaflyEvidenceTests } from "../../src/lib/leafly/evidence-core";
// SLICE B -- the Leafly handbook. Registered here because the handbook
// QUOTES real button names and real deadlines. Its self-tests prove the
// content is internally coherent (every step explains itself, every unsafe
// control carries a caution, the checklist never returns to safety after
// going live). Whether it matches the actual screens is a separate,
// stronger check in tests/compliance/leafly-helper.test.ts, which reads the
// real source off disk. Pure: no I/O.
import { __runLeaflyHelperTests } from "../../src/lib/leafly/helper-core";
// SLICE L-11 -- the Leafly ITEM PICKER's decision core. Registered here for a
// blunter reason than most: Leafly treats POST as a FULL MENU REPLACEMENT, so
// a partial POST does not "send 20 items", it deletes the other 1,856. The
// coercion rule in this core (a selection that is not the whole feed may only
// ever go as PUT) is the single guard standing between the owner picking a
// handful of products and the store's Leafly menu going dark. It is pure -- no
// network, no database -- precisely so CI can prove that rule on every push
// without a sandbox key, even if the vitest mirror is ever renamed or skipped.
import { __runLeaflySelectionTests } from "../../src/lib/leafly/selection-core";
import { __runWmPayloadTests } from "../../src/lib/weedmaps/payload-core";
import { __runIntegrationCredentialsTests } from "../../src/lib/integrations/integration-credentials-core";
import { __runSyncPlanTests } from "../../src/lib/syndication/sync-plan-core";
import { __runCryptoCoreTests } from "../../src/lib/crypto/crypto-core";
import { __runCryptoStoreCoreTests } from "../../src/lib/crypto/crypto-store-core";
import { __runCryptoUiCoreTests } from "../../src/lib/crypto/crypto-ui-core";
import { __runCryptoProgressCoreTests } from "../../src/lib/crypto/crypto-progress-core";
import { __runXrplMapCoreTests } from "../../src/lib/crypto/xrpl/xrpl-map-core";
import { __runXrplClientCoreTests } from "../../src/lib/crypto/xrpl/xrpl-client-core";
import { __runXrplSyncCoreTests } from "../../src/lib/crypto/xrpl/xrpl-sync-core";
import { __runEvmMapCoreTests } from "../../src/lib/crypto/evm/evm-map-core";
import { __runEvmDefiCoreTests } from "../../src/lib/crypto/evm/evm-defi-core";
import { __runEvmClientCoreTests } from "../../src/lib/crypto/evm/evm-client-core";
import { __runEvmSyncCoreTests } from "../../src/lib/crypto/evm/evm-sync-core";
import { __runEvmSyncBudgetCoreTests } from "../../src/lib/crypto/evm/evm-sync-budget-core";
import { __runEvmHistoryPaginationCoreTests } from "../../src/lib/crypto/evm/evm-history-pagination-core";
import { __runEvmReceiptCoreTests } from "../../src/lib/crypto/evm/evm-receipt-core";
import { __runEvmTokenDiscoveryCoreTests } from "../../src/lib/crypto/evm/evm-token-discovery-core";
import { __runCryptoHoldingsTableCoreTests } from "../../src/lib/crypto/crypto-holdings-table-core";
import { __runCryptoPricingCoreTests } from "../../src/lib/crypto/crypto-pricing-core";
import { __runCryptoClassificationCoreTests } from "../../src/lib/crypto/crypto-classification-core";
import { __runCryptoClassificationStoreCoreTests } from "../../src/lib/crypto/crypto-classification-store-core";
import { __runCryptoCostBasisCoreTests } from "../../src/lib/crypto/crypto-cost-basis-core";
import { __runCryptoReconciliationCoreTests } from "../../src/lib/crypto/crypto-reconciliation-core";
import { __runCryptoClassifyViewCoreTests } from "../../src/lib/crypto/crypto-classify-view-core";
import { __runCryptoTransferLedgerCoreTests } from "../../src/lib/crypto/crypto-transfer-ledger-core";
import { __runCryptoTransferStoreCoreTests } from "../../src/lib/crypto/crypto-transfer-store-core";
import { __runCryptoForm8949CoreTests } from "../../src/lib/crypto/crypto-form8949-core";
import { __runCryptoIncomeReportCoreTests } from "../../src/lib/crypto/crypto-income-report-core";
import { __runCryptoMethodSandboxCoreTests } from "../../src/lib/crypto/crypto-method-sandbox-core";
import { __runCryptoFileReadinessCoreTests } from "../../src/lib/crypto/crypto-file-readiness-core";
import { __runCryptoTaxCenterCoreTests } from "../../src/lib/crypto/crypto-tax-center-core";
import { __runCryptoTaxLedgerBuilderCoreTests } from "../../src/lib/crypto/crypto-tax-ledger-builder-core";
import { __runCryptoOriginTraceCoreTests } from "../../src/lib/crypto/crypto-origin-trace-core";
import { __runCryptoExchangeRegistryCoreTests } from "../../src/lib/crypto/crypto-exchange-registry-core";
import { __runCryptoHistoricalPricingCoreTests } from "../../src/lib/crypto/crypto-historical-pricing-core";
import { __runCryptoOwnerWalletCoreTests } from "../../src/lib/crypto/crypto-owner-wallet-core";
import { __runCryptoTraceViewCoreTests } from "../../src/lib/crypto/crypto-trace-view-core";
import { __runCryptoReconstructionReportCoreTests } from "../../src/lib/crypto/crypto-reconstruction-report-core";
import { __runCoreumClientCoreTests } from "../../src/lib/crypto/coreum/coreum-client-core";
import { __runCoreumMapCoreTests } from "../../src/lib/crypto/coreum/coreum-map-core";
import { __runCoreumSyncCoreTests } from "../../src/lib/crypto/coreum/coreum-sync-core";
import { __runStellarClientCoreTests } from "../../src/lib/crypto/stellar/stellar-client-core";
import { __runStellarMapCoreTests } from "../../src/lib/crypto/stellar/stellar-map-core";
import { __runStellarSyncCoreTests } from "../../src/lib/crypto/stellar/stellar-sync-core";
// Slice books-50: the single source of truth for who owns Greenway. The filed
// Form 1120-S carries four Schedule K-1s at 85/5/5/5; many files used to
// hand-type a three-person roster instead, putting the mother at ten per cent,
// and one of them attached a dollar figure to it. Registered FIRST among the
// accounting cores because ledger-core now imports it.
import { __runShareholderRosterCoreTests } from "../../src/lib/accounting/shareholder-roster-core";
import { __runLedgerCoreTests } from "../../src/lib/accounting/ledger-core";
import { __runCoaCoreTests } from "../../src/lib/accounting/coa-core";
// Slice books-23: the category -> inventory-account map the posting engine has
// needed since books-11 and never had. Registered here because it is the last
// link between "a person counted a shelf" and "the general ledger knows".
import { __runAuditPostingAccountsTests } from "../../src/lib/inventory/audit-posting-accounts";
import { __runPostingCoreTests } from "../../src/lib/accounting/posting-core";
import { __runTrialBalanceCoreTests } from "../../src/lib/accounting/trial-balance-core";
import { __runFixedAssetsCoreTests } from "../../src/lib/accounting/fixed-assets-core";
// The two modules that stand between Michael and the books: what he is allowed
// to SEE (books-view-core) and how the books say NO (gl-refusal-core). Both
// shipped with full self-test suites that this runner never called -- 222
// assertions that only ran if a human typed the command by hand. Registered
// here so a break in either turns BOTH gates red. See the audit note in
// tests/compliance/books-view-core.test.ts.
import { __runBooksViewCoreTests } from "../../src/lib/accounting/books-view-core";
// Slice books-06: the OWNER GATE over the money pages -- the bank feed, the
// ATM vault, the crypto treasury and the loans. books-view-core guards the
// ledger; this one guards the accounts the ledger is built from, and holds
// the 25-table inventory that migration 0190 re-gates from is_staff() to
// is_owner(). If the page gate and the database gate ever disagree, these
// self-tests are what say so out loud.
import { __runOwnerGateCoreTests } from "../../src/lib/auth/owner-gate-core";
import { __runGlRefusalCoreTests } from "../../src/lib/accounting/gl-refusal-core";
import { __runJournalAdvisorCoreTests } from "../../src/lib/accounting/journal-advisor-core";
import { __runCutoverCoreTests } from "../../src/lib/accounting/cutover-core";
import { __runCutoverInventoryCoreTests } from "../../src/lib/accounting/cutover-inventory-core";
import { __runLedgerCategoryMapCoreTests } from "../../src/lib/accounting/ledger-category-map-core";
// Slice books-03: the vendor bill / accounts-payable brain. Decides what
// §280E lets Greenway keep (inventory → COGS) versus what it disallows, with
// verbatim authority behind every call.
import { __runVendorBillCoreTests } from "../../src/lib/accounting/vendor-bill-core";
import { __runLotCostClassificationTests } from "../../src/lib/accounting/lot-cost-classification-core";
import { __runRegisterCashJournalTests } from "../../src/lib/accounting/register-cash-journal-core";
import { __runRegisterCashSpecimenTests } from "../../src/lib/accounting/register-cash-specimen-core";
import { __runDepositClearingTests } from "../../src/lib/accounting/deposit-clearing-core";
import { __runDepositFifoTests } from "../../src/lib/accounting/deposit-fifo-core";
import { __runSafeBagTests } from "../../src/lib/accounting/safe-bag-core";
import { __runCardPaymentTests } from "../../src/lib/accounting/card-payment-core";
// Slice books-04: payroll and the employee-as-COGS question. Reseller vs
// producer character, the narrow evidence-gated acquisition-labor door, the
// hard block on selling labor, and the balanced payroll journal.
import { __runPayrollCogsCoreTests } from "../../src/lib/accounting/payroll-cogs-core";
// Slice books-05: bank matching and reconciliation. The sign bridge between
// Plaid's convention (positive = money out) and the ledger's (positive =
// debit), the refusals that make a silently-wrong match noisy, the
// reconciliation that adjusts BOTH sides and refuses to plug the difference,
// the three-way loan split, and the structuring pattern an examiner would see.
import { __runBankMatchCoreTests } from "../../src/lib/accounting/bank-match-core";
// Slice books-07: the guidance layer. The merged authority registry that every
// books screen quotes from, the cross-registry DRIFT SCANNER that proves all
// of those registries still agree with one another, the AS 2401.61 fingerprint
// screen on manual journal entries, and the mentor sequences. This suite is
// what stands between a verbatim quotation and a silently altered one -- a
// citation error in front of the IRS is not a cosmetic bug.
import { __runBooksGuidanceCoreTests } from "../../src/lib/accounting/books-guidance-core";
import { __runBooksLedgerGuidanceCoreTests } from "../../src/lib/accounting/books-ledger-guidance-core";
import { __runInventoryAuditAuthoritiesTests } from "../../src/lib/inventory/inventory-audit-authorities";
import { __runInventoryAuditCoreTests } from "../../src/lib/inventory/inventory-audit-core";
// Slice books-12: THE AUDITING HUB. The mentoring content and the ISA 501
// method authorities. Pure by construction: if these ever needed a database to
// run, the hub would be teaching from something that could change under it.
import { __runAuditHubAuthoritiesTests } from "../../src/lib/inventory/audit-hub-authorities";
import { __runAuditHubGuidanceCoreTests } from "../../src/lib/inventory/audit-hub-guidance-core";
// Slice books-11: THE STORE LAYER. The pure half of "post an approved count
// to the shelf and to the books" -- the gate that decides whether a session may
// be posted at all, the plan of shelf moves and journal lines it would produce,
// and the SIGN WALL check that keeps a shrink a DEBIT to COGS. The SQL half
// lives in migration 0192 and is exercised by scripts/accounting.
import { __runInventoryAuditPostCoreTests } from "../../src/lib/inventory/inventory-audit-post-core";
import { __runPreflightTests } from "../../src/lib/syndication/preflight-core";
import { __runRichnessTests } from "../../src/lib/syndication/richness-core";
import { __runSyncSettingsTests } from "../../src/lib/syndication/sync-settings-core";
import { __runApplySettingsTests } from "../../src/lib/syndication/apply-settings-core";
import { __runSyndicationPlaybookTests } from "../../src/lib/integrations/syndication-playbook";
import { __runPosSaleEventTests } from "../../src/lib/pos/sale-event-core";
import { __runIdScanCoreTests } from "../../src/lib/pos/id-scan-core";
import { __runPosSyncCoreTests } from "../../src/lib/pos/sync-core";
import { __runPendingRecoveryCoreTests } from "../../src/lib/pos/pending-recovery-core";
import { __runNotifyOutcomeCoreTests } from "../../src/lib/orders/notify-outcome-core";
import { __runEmailReadinessTests } from "../../src/lib/orders/email-readiness-core";
import { __runStatusCasCoreTests } from "../../src/lib/orders/status-cas-core";
import { __runRpcFallbackCoreTests } from "../../src/lib/db/rpc-fallback-core";
import { __runRegisterClientCoreTests } from "../../src/lib/pos/register-client-core";
import { __runRegisterPolishCoreTests } from "../../src/lib/pos/register-polish-core";
import { __runHeldStockCoreTests } from "../../src/lib/pos/held-stock-core";
import { __runSaleFlowCoreTests } from "../../src/lib/pos/sale-flow-core";
import { __runMedicalPosCoreTests } from "../../src/lib/pos/medical-pos-core";
import { __runPosReceiptCoreTests } from "../../src/lib/pos/receipt-core";
import { __runReceiptConfigCoreTests } from "../../src/lib/pos/receipt-config-core";
import { __runReceiptTaxCoreTests } from "../../src/lib/pos/receipt-tax-core";
import { __runReceiptLogoCoreTests } from "../../src/lib/pos/receipt-logo-core";
import { __runPosReturnsCoreTests } from "../../src/lib/pos/returns-core";
import { __runSaleDecrementCoreTests } from "../../src/lib/inventory/sale-decrement-core";
import { __runTillCoreTests } from "../../src/lib/pos/till-core";
import { __runDayReportCoreTests } from "../../src/lib/pos/day-report-core";
import { __runPriceDriftCoreTests } from "../../src/lib/pos/price-drift-core";
import { __runExceptionReminderCoreTests } from "../../src/lib/pos/exception-reminder-core";
import { __runRecallHoldCoreTests } from "../../src/lib/pos/recall-hold-core";
import { __runPinThrottleCoreTests } from "../../src/lib/security/pin-throttle-core";
import { __runScanToCartCoreTests } from "../../src/lib/pos/scan-to-cart-core";
import { __runVariantLotCoreTests } from "../../src/lib/pos/variant-lot-core";
import { __runPriceVariantMatchCoreTests } from "../../src/lib/inventory/price-variant-match-core";
import { __runPriceCorrectionCoreTests } from "../../src/lib/inventory/price-correction-core";
import { __runImportLotCoreTests } from "../../src/lib/pos/import-lot-core";
import { __runCardBrandCoreTests } from "../../src/lib/menu/card-brand-core";
import { __runMenuCategoryOverrideCoreTests } from "../../src/lib/menu/menu-category-override-core";
import { __runVendorDirectoryCoreTests } from "../../src/lib/menu/vendor-directory-core";
import { __runCardTypeCoreTests } from "../../src/lib/menu/card-type-core";
import { __runLotTableCoreTests } from "../../src/lib/inventory/lot-table-core";
import { __runLotEditCoreTests } from "../../src/lib/inventory/lot-edit-core";
import { __runReceivedDateCoreTests } from "../../src/lib/inventory/received-date-core";
import { __runLotWebsiteClassificationCoreTests } from "../../src/lib/inventory/lot-website-classification-core";
import { __runCategoryRegistryCoreTests } from "../../src/lib/pos/category-registry-core";
import { __runTypeRegistryCoreTests } from "../../src/lib/pos/type-registry-core";
import { __runHouseTypeCoreTests } from "../../src/lib/inventory/house-type-core";
import { __runDraftApprovalGateTests } from "../../src/lib/inventory/draft-approval-gate-core";
import { __runReceivingClassificationTests } from "../../src/lib/inventory/receiving-classification-core";
// SLICE 18F - the MEMORY for the same question. The 18-0 gate is REQUIRED,
// and a required question with no memory is a question answered under time
// pressure at a dock every week. This core decides what may be remembered
// and, more importantly, what may NOT: a machine default is not an answer.
import { __runClassificationMemoryTests } from "../../src/lib/inventory/classification-memory-core";
// SLICE 18A — the other end of the same question. receiving-classification-core
// asks it at the dock; these two find the products nobody was ever asked about
// and shape them into a worklist.
import { __runClassificationStatusTests } from "../../src/lib/inventory/classification-status-core";
import { __runClassificationWorklistTests } from "../../src/lib/inventory/classification-worklist-core";
// SLICE 18E - the provenance mirror. Decides what an approver's compliance
// answers write back onto the LOT row. Never enforcement (migration 0219).
import { __runClassificationMirrorTests } from "../../src/lib/inventory/classification-mirror-core";
// SLICE 18E - reports lot-vs-menu classification conflicts AS conflicts.
// Display only; a disagreement is never an input to a limit.
import { __runClassificationDisagreementTests } from "../../src/lib/inventory/classification-disagreement-core";
import { __runStrainFieldsCoreTests } from "../../src/lib/inventory/strain-fields-core";
import { __runStrainTypeIntelTests } from "../../src/lib/inventory/strain-type-intel-core";
import { __runBankingVaultUiTests } from "../../src/lib/payments/banking-vault-ui-core";
import { __runRelatedProductsCoreTests } from "../../src/lib/menu/related-products-core";
import { __runDealBadgeCoreTests } from "../../src/lib/promotions/deal-badge-core";
import { __runWeightDisplayCoreTests } from "../../src/lib/menu/weight-display-core";
import { __runVendorRelationsCoreTests } from "../../src/lib/vendors/vendor-relations-core";
import { __runFactExtractionCoreTests } from "../../src/lib/inventory/fact-extraction-core";
import { __runFactReviewCoreTests } from "../../src/lib/pos/fact-review-core";
import { __runFactReviewBulkCoreTests } from "../../src/lib/pos/fact-review-bulk-core";
import { __runMissingProductMasterCoreTests } from "../../src/lib/pos/missing-product-master-core";
import { __runCompleteReadPlanCoreTests } from "../../src/lib/supabase/complete-read-plan-core";
import { __runLotGapCoreTests } from "../../src/lib/inventory/lot-gap-core";
import { __runImportCommitCoreTests } from "../../src/lib/pos/import-commit-core";
import { __runCommitIntegrityCoreTests } from "../../src/lib/pos/commit-integrity-core";
import { __runIntakePotencyCoreTests } from "../../src/lib/pos/intake-potency-core";
import { __runIntakeMasteringCoreTests } from "../../src/lib/pos/intake-mastering-core";
import { __runIntakeMenuStagingCoreTests } from "../../src/lib/pos/intake-menu-staging-core";
import { __runPriceOverrideCoreTests } from "../../src/lib/pos/price-override-core";
import { __runDeviceSetupCoreTests } from "../../src/lib/pos/device-setup-core";
import { __runVoidSaleCoreTests } from "../../src/lib/pos/void-sale-core";
import { __runPickupCoreTests } from "../../src/lib/pos/pickup-core";
import { __runPickupDetailCoreTests } from "../../src/lib/pos/pickup-detail-core";
import { __runPickupProgressCoreTests } from "../../src/lib/pos/pickup-progress-core";
import { __runMemberHistoryCoreTests } from "../../src/lib/pos/member-history-core";
import { __runEmailReceiptCoreTests } from "../../src/lib/pos/email-receipt-core";
import { __runChangeCalcCoreTests } from "../../src/lib/pos/change-calc-core";
import { __runLowStockCoreTests } from "../../src/lib/pos/low-stock-core";
import { __runCashRoundingCoreTests } from "../../src/lib/pos/cash-rounding-core";
import { __runLeaderboardCoreTests } from "../../src/lib/pos/leaderboard-core";
import { __runSaleGridCoreTests } from "../../src/lib/pos/sale-grid-core";
import { __runCustomSaleCoreTests } from "../../src/lib/pos/custom-sale-core";
import { __runFavoritesCoreTests } from "../../src/lib/pos/favorites-core";
import { __runScanRequiredCoreTests } from "../../src/lib/pos/scan-required-core";
import { __runProductInfoCoreTests } from "../../src/lib/pos/product-info-core";
import { __runStockFlagCoreTests } from "../../src/lib/pos/stock-flag-core";
import { __runThemeCoreTests } from "../../src/lib/pos/theme-core";
import { __runSwCoreTests } from "../../src/lib/pos/sw-core";
import { __runVariantGramsCoreTests } from "../../src/lib/pos/variant-grams-core";
import { __runMenuLiveStepCoreTests } from "../../src/lib/inventory/menu-live-step-core";
import { __runVendorResolveCoreTests } from "../../src/lib/inventory/vendor-resolve-core";
import { __runCultiveraInvoiceTests } from "../../src/lib/inventory/pdf-cultivera-invoice-core";
import { __runGenericPdfTransportTests } from "../../src/lib/inventory/pdf-generic-transport-core";
import { __runEmailHarvestTests } from "../../src/lib/inbound-email/email-harvest-core";
import { __runLlamaparseCoreTests } from "../../src/lib/inbound-email/llamaparse-core";
import { __runLlamaParseStatusCoreTests } from "../../src/lib/inbound-email/llamaparse-status-core";
import { __runTransportFieldsCoreTests } from "../../src/lib/inventory/transport-fields-core";
import { __runIntakeChecklistCoreTests } from "../../src/lib/inventory/intake-checklist-core";
import { __runIdCaptureCoreTests } from "../../src/lib/pos/id-capture-core";
import { __runCultiveraMenuCoreTests } from "../../src/lib/purchasing/cultivera-menu-core";
import { __runGrowflowMenuCoreTests } from "../../src/lib/purchasing/growflow-menu-core";
import { __runLeaflinkMenuCoreTests } from "../../src/lib/purchasing/leaflink-menu-core";
import { __runUnifiedSearchCoreTests } from "../../src/lib/purchasing/unified-search-core";
import { __runUnifiedMenusUiCoreTests } from "../../src/lib/purchasing/unified-menus-ui-core";
import { __runEmailMenuCoreTests } from "../../src/lib/purchasing/email-menu-core";
import { __runCultiveraMenusUiCoreTests } from "../../src/lib/purchasing/cultivera-menus-ui-core";
import { __runCultiveraMediaCoreTests } from "../../src/lib/purchasing/cultivera-media-core";
import { __runCultiveraPoCoreTests } from "../../src/lib/purchasing/cultivera-po-core";
import { __runGrowflowMediaCoreTests } from "../../src/lib/purchasing/growflow-media-core";
import { __runGrowflowKbLinkCoreTests } from "../../src/lib/purchasing/growflow-kb-link-core";
import { __runLeaflinkMediaCoreTests } from "../../src/lib/purchasing/leaflink-media-core";
import { __runLeaflinkKbLinkCoreTests } from "../../src/lib/purchasing/leaflink-kb-link-core";
import { __runMenuDescriptionCoreTests } from "../../src/lib/purchasing/menu-description-core";
import { __runDescriptionQualityCoreTests } from "../../src/lib/purchasing/description-quality-core";
import { __runStrainDescriptionChoiceCoreTests } from "../../src/lib/purchasing/strain-description-choice-core";
import { __runMenuReadinessCoreTests } from "../../src/lib/purchasing/menu-readiness-core";
import { __runSaveAssetsCoreTests } from "../../src/lib/purchasing/save-assets-core";
import { __runCultiveraKbLinkCoreTests } from "../../src/lib/purchasing/cultivera-kb-link-core";
import { __runGrowflowMenuUiCoreTests } from "../../src/lib/purchasing/growflow-menu-ui-core";
import { __runMediaAutosaveCoreTests } from "../../src/lib/purchasing/media-autosave-core";
import { __runDraftSeedCoreTests } from "../../src/lib/inventory/draft-seed-core";
import { __runWedgeScanCoreTests } from "../../src/lib/pos/wedge-scan-core";
import { __runSocketScanCoreTests } from "../../src/lib/pos/socket-scan-core";
import { __runSocketResilienceCoreTests } from "../../src/lib/pos/socket-resilience-core";
// SLICE 16 — full back-office inventory sellable at the register.
import { __runRegisterAvailabilityCoreTests } from "../../src/lib/pos/register-availability-core";
import { __runPickupHandoverCoreTests } from "../../src/lib/pos/pickup-handover-core";
import { __runRestoreToSaleCoreTests } from "../../src/lib/inventory/restore-to-sale-core";
import { __runTransactionHistoryCoreTests } from "../../src/lib/pos/transaction-history-core";
import { __runBlockedStockFixCoreTests } from "../../src/lib/inventory/blocked-stock-fix-core";
import { __runReceiptReprintCoreTests } from "../../src/lib/pos/receipt-reprint-core";
import { __runComparisonBasisCoreTests } from "../../src/lib/admin/comparison-basis-core";
import { __runRefundMetricsCoreTests } from "../../src/lib/admin/refund-metrics-core";
import { __runRegisterLoyaltyCoreTests } from "../../src/lib/pos/register-loyalty-core";
import { __runOrderToCartCoreTests } from "../../src/lib/pos/order-to-cart-core";
import { __runMemberMatchCoreTests } from "../../src/lib/pos/member-match-core";
import { __runActiveSaleResumeCoreTests } from "../../src/lib/pos/active-sale-resume-core";
import { __runMenuNameDisplayCoreTests } from "../../src/lib/pos/menu-name-display-core";
import { __runMedicalTestModeCoreTests } from "../../src/lib/pos/medical-testmode-core";
import { __runSawPrefillCoreTests } from "../../src/lib/pos/saw-prefill-core";
import { __runBackLinkTests } from "../../src/lib/admin/back-link-core";
import { __runPostgrestEscapeTests } from "../../src/lib/supabase/postgrest-escape";
import { __runPgBigintTests } from "../../src/lib/supabase/pg-bigint";
import { __runPrintRetryCoreTests } from "../../src/lib/printing/print-retry-core";
// D-68 -- the ONE place that decides which secret a CloudPRNT request carries.
// Registered here because /api/cloudprnt passes BOTH the shared poll token and
// the per-receipt job token on the same `?token=` parameter: reading the query
// first for both meant Star's own GET/DELETE steps 401'd themselves and no
// receipt could ever be fetched. Pure: no I/O.
import { __runCloudPrntAuthCoreTests } from "../../src/lib/printing/cloudprnt-auth-core";
import { __runRevenueBasisTests } from "../../src/lib/reports/revenue-basis";
import { __runRejectedReportTests } from "../../src/lib/pos/rejected-report-core";
import { __runReservationExpiryTests } from "../../src/lib/orders/reservation-expiry-core";
import { __runListWindowTests } from "../../src/lib/admin/list-window-core";
import { __runListFilterTests } from "../../src/lib/admin/list-filter-core";
import { __runSpecialDiscountTests } from "../../src/lib/discounts/special-discount-core";
import { __runSpecialDiscountSaleTests } from "../../src/lib/pos/special-discount-sale-core";
import { __runSpecialDiscountReportTests } from "../../src/lib/discounts/special-discount-report-core";
import { __runSafeCoreTests } from "../../src/lib/registers/safe-core";
import { __runEodCoreTests } from "../../src/lib/registers/eod-core";
import { __runConstantTimeTests } from "../../src/lib/security/constant-time";
import { __runGramsPerOunceTests } from "../../src/lib/compliance/grams-per-ounce";
import { __runEnrichmentMatchCoreTests } from "../../src/lib/enrichment/match-core";
import { __runPublishGuardTests } from "../../src/lib/pos/publish-guard-core";
// SLICE 39 connectivity audit: the 41 suites below existed but ran nowhere.
import { __runAdminNavTests } from "../../src/components/admin/admin-nav-core";
import { __runSageExportsCoreTests } from "../../src/lib/accounting/sage-exports-core";
import { __runSageHelperCoreTests } from "../../src/lib/accounting/sage-helper-core";
import { __runSage50CoreTests } from "../../src/lib/accounting/sage50-core";
import { __runAuditAnomalyTests } from "../../src/lib/admin/audit-anomaly-core";
import { __runCockpitTests } from "../../src/lib/admin/cockpit-core";
import { __runMobileCoreTests } from "../../src/lib/admin/mobile-core";
import { __runStoreProfileTests } from "../../src/lib/admin/store-profile-core";
import { __runKbNotesTests } from "../../src/lib/ai/kb/kb-notes-core";
import { __runProductImageEditTests } from "../../src/lib/ai/kb/product-images-core";
import { __runProductResearchCoreTests } from "../../src/lib/enrichment/research-core";
import { __runEnrichmentLookupQueryCoreTests } from "../../src/lib/enrichment/lookup-query-core";
// strain-lookup-core imports the server-only compliance module (like
// product-lookup-core), so it is NOT run here; its self-tests run via
// tests/compliance/strain-lookup-core.test.ts. strain-type-suggest-core is
// pure (only the strains-data seed + taxonomy) and runs here.
import { __runStrainTypeSuggestCoreTests } from "../../src/lib/ai/kb/strain-type-suggest-core";
import { __runStrainVocabCoreTests } from "../../src/lib/ai/kb/strain-vocab-core";
// ccrs-category-match-core is pure (no server-only imports; the DB loader lives
// in writeback.ts and just feeds it category rows), so it runs here.
import { __runCcrsCategoryMatchCoreTests } from "../../src/lib/ai/kb/ccrs-category-match-core";
// ccrs-vocabulary-core is pure (derives from compliance/ccrs-batch-core, which
// is itself pure and tsx-safe), so it runs here.
import { __runCcrsVocabularyCoreTests } from "../../src/lib/ai/kb/ccrs-vocabulary-core";
// unmapped-ccrs-core is pure (imports only ccrs-vocabulary-core + ccrs-batch-core
// constants; the DB loader lives in unmapped-ccrs-server.ts), so it runs here.
import { __runUnmappedCcrsCoreTests } from "../../src/lib/ai/kb/unmapped-ccrs-core";
import { __runWebauthnCoreTests } from "../../src/lib/auth/webauthn-core";
import { __runNormalizeTests } from "../../src/lib/cms/email-events/normalize-core";
import { __runVerifyTests } from "../../src/lib/cms/email-events/verify-core";
import { __runImageSpecTests } from "../../src/lib/cms/image-spec-core";
import { __runContentSelectCoreTests } from "../../src/lib/cms/content-select-core";
import { __runContentReachabilityCoreTests } from "../../src/lib/cms/content-reachability-core";
import { __runPageWordingCoreTests } from "../../src/lib/cms/page-wording-core";
import { __runPolicyDocCoreTests } from "../../src/lib/cms/policy-doc-core";
import { __runSpecialsPresentationCoreTests } from "../../src/lib/specials/specials-presentation-core";
import { __runHomeSectionSettingsTests } from "../../src/lib/cms/home-section-settings-core";
import { __runOrderNamePoolCoreTests } from "../../src/lib/orders/order-name-pool-core";
import { __runOrderNameRotationCoreTests } from "../../src/lib/orders/order-name-rotation-core";
import { __runQrCoreTests } from "../../src/lib/printing/qr-core";
import { __runOrderNamePrefetchCoreTests } from "../../src/lib/pos/order-name-prefetch-core";
import { __runLogoPrintCoreTests } from "../../src/lib/printing/logo-print-core";
import { __runOrderNameComplianceTests } from "../../src/lib/orders/order-name-compliance-core";
import { __runNewOrderWatchCoreTests } from "../../src/lib/orders/new-order-watch-core";
import { __runMedicalContentCoreTests } from "../../src/lib/medical/medical-content-core";
import { __runLoyaltyContentCoreTests } from "../../src/lib/loyalty/loyalty-content-core";
import { __runLoyaltyHeroCoreTests } from "../../src/lib/loyalty/loyalty-hero-core";
import { __runShopCarouselCoreTests } from "../../src/lib/cms/shop-carousel-core";
import { __runMenuSpecialFiltersTests } from "../../src/lib/menu/menu-special-filters-core";
import { __runMenuDohCoreTests } from "../../src/lib/menu/menu-doh-core";
import { __runMenuDohFilterCoreTests } from "../../src/lib/menu/menu-doh-filter-core";
// SLICE 18B — the sales-limit classification shop facet + the register's
// classification search keywords.
import { __runMenuClassificationFilterTests } from "../../src/lib/menu/menu-classification-filter-core";
import { __runPosClassificationSearchTests } from "../../src/lib/pos/classification-search-core";
// SLICE 18C — the on-card classification pills + the PDP allowance disclosure.
import { __runMenuClassificationBadgeTests } from "../../src/lib/menu/menu-classification-badge-core";
import { __runMenuDohBadgeCoreTests } from "../../src/lib/menu/menu-doh-badge-core";
import { __runCcrsIdentifierTests } from "../../src/lib/compliance/ccrs-identifiers";
import { __runCcrsAdjustmentTests } from "../../src/lib/compliance/ccrs-inventory-adjustment-core";
import { __runCcrsSubmitGateTests } from "../../src/lib/compliance/ccrs-submit-gate-core";
import { __runComplianceHealthTests } from "../../src/lib/compliance/compliance-health-core";
import { __runExcisePaymentCoreTests } from "../../src/lib/compliance/excise-payment-core";
import { __runExciseSendCoreTests } from "../../src/lib/compliance/excise-send-core";
import { __runCcrsManifestCsvTests } from "../../src/lib/inventory/ccrs-manifest-csv-core";
import { __runScanCoreTests } from "../../src/lib/inventory/cycle-count-scan-core";
import { __runDispositionTests } from "../../src/lib/inventory/intake-disposition-core";
import { __runIntakeReviewTests } from "../../src/lib/inventory/intake-review-core";
import { __runIntakeReviewAdapterTests } from "../../src/lib/inventory/intake-review-adapter";
import { __runLotActivationGateTests } from "../../src/lib/inventory/lot-activation-gate-core";
import { __runManifestPipelineTests } from "../../src/lib/inventory/manifest-pipeline-core";
import { __runSampleGuardrailTests } from "../../src/lib/inventory/sample-guardrails";
import { __runCardCannabinoidTests } from "../../src/lib/menu/card-cannabinoids";
import { __runCardIdentityCoreTests } from "../../src/lib/menu/card-identity-core";
import { __runReprocessCoreTests } from "../../src/lib/inventory/reprocess-core";
import { __runTransformCoreTests } from "../../src/lib/pos/transform";
import { __runStrainTerpeneTests } from "../../src/lib/menu/strain-terpenes";
import { __runStrainTaxonomyTests } from "../../src/lib/menu/strain-taxonomy";
import { __runPosCorsCoreTests } from "../../src/lib/pos/cors-core";
import { __runPosApiBaseCoreTests } from "../../src/lib/pos/api-base-core";
import { __runCapacitorConfigCoreTests } from "../../src/lib/pos/capacitor-config-core";
import { __runIosBuildConfigCoreTests } from "../../src/lib/pos/ios-build-config-core";
import { __runStarPrinterCoreTests } from "../../src/lib/pos/star-printer-core";
import { __runPrinterPairingCoreTests } from "../../src/lib/pos/printer-pairing-core";
import { __runPosStorageCoreTests } from "../../src/lib/pos/pos-storage-core";
import { __runPosSecureStoreCoreTests } from "../../src/lib/pos/pos-secure-store-core";
import { __runRegisterHostCoreTests } from "../../src/lib/pos/register-host-core";
import { __runThemeContrastCoreTests } from "../../src/lib/pos/theme-contrast-core";
import { __runVariantSortTests } from "../../src/lib/menu/variant-sort";
import { __runVariantCollapseTests } from "../../src/lib/menu/variant-collapse-core";
import { __runNonCannabisTests } from "../../src/lib/naming/noncannabis-core";
import { __runNamingConventionTests } from "../../src/lib/naming/convention-core";
import { __runCcrsProductNameCoreTests } from "../../src/lib/compliance/ccrs-product-name-core";
import { __runNachaCoreTests } from "../../src/lib/payments/nacha-core";
import { __runVendorAchTests } from "../../src/lib/payments/vendor-ach-core";
import { __runPayeeBankingCoreTests } from "../../src/lib/payments/payee-banking-core";
import { __runPayrollCoreTests } from "../../src/lib/payroll/payroll-core";
import { __runPayrollGuardrailsCoreTests } from "../../src/lib/payroll/payroll-guardrails-core";
import { __runInventoryCatalogTests } from "../../src/lib/pos/inventory-type-catalog";
import { __runCode128Tests } from "../../src/lib/printing/code128-core";
import { __runPrinterDiagnosticsTests } from "../../src/lib/printing/printer-diagnostics-core";
import { __runPoCoreTests } from "../../src/lib/purchasing/po-core";
import { __runPoDocumentCoreTests } from "../../src/lib/purchasing/po-document-core";
import { __runPoListInsightsCoreTests } from "../../src/lib/purchasing/po-list-insights-core";
import { __runForecastTests } from "../../src/lib/reports/forecast-core";
import { __runNewsletterStatsTests } from "../../src/lib/reports/newsletter-stats-core";
import { __runRangeTests } from "../../src/lib/reports/range";
import { __runNetIncomeCoreTests } from "../../src/lib/reports/net-income-core";
import { __runZipTests } from "../../src/lib/reports/zip";
import { __runTimeclockCoreTests } from "../../src/lib/staffing/timeclock-core";
import { __runVendorGoldminerTests } from "../../src/lib/inventory/vendor-goldminer-core";
import { __runAtmCoreTests } from "../../src/lib/atm/atm-core";
import { __runAtmUiCoreTests } from "../../src/lib/atm/atm-ui-core";
import { __runAtmReconcileCoreTests } from "../../src/lib/atm/atm-reconcile-core";
import { __runAtmPostingCoreTests } from "../../src/lib/atm/atm-posting-core";
import { __runAtmSweepCoreTests } from "../../src/lib/atm/atm-sweep-core";
import { __runAtmCorroborateCoreTests } from "../../src/lib/atm/atm-corroborate-core";
import { __runAtmClassificationCoreTests } from "../../src/lib/atm/atm-classification-core";
import { __runLedgerCensusCoreTests } from "../../src/lib/accounting/ledger-census-core";
import { __runPayrollReconcileCoreTests } from "../../src/lib/payroll/payroll-reconcile-core";
import { __runPayrollUiCoreTests } from "../../src/lib/payroll/payroll-ui-core";
import { __runVendorReconcileCoreTests } from "../../src/lib/payments/vendor-reconcile-core";
import { __runVendorReconcileUiCoreTests } from "../../src/lib/payments/vendor-reconcile-ui-core";
import { __runAtmSyncCoreTests } from "../../src/lib/atm/atm-sync-core";
import { __runPaiEndpointsTests } from "../../src/lib/atm/pai-endpoints";
import { __runAtmReportDiagnosticsTests } from "../../src/lib/atm/atm-report-diagnostics";
import { __runPaiDiscoveryTests } from "../../src/lib/atm/pai-discovery";
import { __runTerminalStatusCoreTests } from "../../src/lib/atm/terminal-status-core";
import { __runPlaidUiCoreTests } from "../../src/lib/plaid/plaid-ui-core";
import { __runPlaidSyncCoreTests } from "../../src/lib/plaid/sync-core";
import { __runPlaidCoreTests } from "../../src/lib/plaid/plaid-core";
import { __runPlaidWebhookCoreTests } from "../../src/lib/plaid/plaid-webhook-core";
import { __runPlaidMoneyCoreTests } from "../../src/lib/plaid/plaid-money-core";
import { __runPlaidCredentialsCoreTests } from "../../src/lib/plaid/plaid-credentials-core";
import { __runAccountClassificationTests } from "../../src/lib/plaid/account-classification-core";
import { __runPlaidLiabilitiesCoreTests } from "../../src/lib/plaid/liabilities-core";
import { __runPlaidInvestmentsCoreTests } from "../../src/lib/plaid/investments-core";
import { __runLoanCoreTests } from "../../src/lib/loans/loan-core";

// Helper for suites that return { passed, failed } without throwing on
// failure: the runner must assert failed === 0 itself.
function assertNoFailures(name: string, result: { passed: number; failed: number }): void {
  if (result.failed > 0) {
    throw new Error(`${name} self-tests failed: ${result.failed} (passed: ${result.passed})`);
  }
}

/**
 * assertNoFailures, plus a FLOOR on how many assertions actually ran.
 *
 * `assertNoFailures` alone cannot tell "everything passed" apart from
 * "nothing ran". An early `return` at the top of a suite, a body lost to a
 * bad merge, or a suite commented out during debugging all report
 * `failed: 0` and sail straight through CI. The floor turns that silent
 * hole into a hard failure.
 *
 * The floor is set deliberately BELOW the current assertion count: deleting
 * a test or two is legitimate maintenance, gutting a suite is not.
 */
function assertRan(
  name: string,
  result: { passed: number; failed: number },
  minAssertions: number,
): void {
  assertNoFailures(name, result);
  if (result.passed < minAssertions) {
    throw new Error(
      `${name} self-tests ran only ${result.passed} assertion(s); expected at least ` +
        `${minAssertions}. A suite that runs no assertions is not a passing suite.`,
    );
  }
  // Report the count, not just the pass. Floored suites used to succeed in
  // total silence, which meant the log could not answer "how close is this
  // suite to its floor?" -- the one question you need when deciding whether a
  // floor is still protecting anything.
  console.log(
    `${name}: ${result.passed} assertions passed, 0 failed (floor ${minAssertions})`,
  );
}

async function main() {
  __runOrderPricingTests();
  __runTaxBaseCoreTests();
  // T1 + C1 run BEFORE the engine's own suite: the engine now depends on
  // both, so if either is broken there is no point reading the engine's
  // verdict.
  { const r = __runBrandMatchTests(); if (r.passed < 1) throw new Error("brand-match-core: no assertions ran"); console.log(`brand-match-core: ${r.passed} assertions passed`); }
  { const r = __runMarkdownLockTests(); if (r.passed < 1) throw new Error("markdown-lock-core: no assertions ran"); console.log(`markdown-lock-core: ${r.passed} assertions passed`); }
  // Rule 11: receiving intake is the REAL pipeline. Its brand resolver shares
  // brandKey() with promotions, so it runs right beside brand-match-core.
  { const r = __runBrandResolveCoreTests(); if (r.passed < 1) throw new Error("brand-resolve-core: no assertions ran"); console.log(`brand-resolve-core: ${r.passed} assertions passed`); }
  // Rule 11 / defects A+B: auto-receive WRITES, so its planner runs here too.
  { const r = __runPoReceiveCoreTests(); if (r.passed < 1) throw new Error("po-receive-core: no assertions ran"); console.log(`po-receive-core: ${r.passed} assertions passed`); }
  __runDiscountEngineTests();
  __runPromoGuardTests();
  assertNoFailures("promotion-selector-core", __runPromotionSelectorTests());
  assertNoFailures("promotion-selector-ai", __runPromotionSelectorAiTests());
  assertNoFailures("guided-promotion-core", __runGuidedPromotionTests());
  assertNoFailures("thursday-planner-core", __runThursdayPlannerTests());
  __runWeightLabelTests();
__runLiquidVolumeTests();
  __runLiquidVolumeDerivationTests();
  __runSalesLimitTests();
  __runSalesLimitGateTests();
  __runCartLimitMeterCoreTests();
  await __runChunkedInTests();
  await __runReadCompletenessCoreTests();
  __runVendorSearchSafetyCoreTests();
  const exempt = __runExemptSaleRecordTests();
  if (exempt.failed > 0) throw new Error(`exempt-sale-record-core: ${exempt.failed} failure(s)`);
  __runSalesHoursCoreTests();
  __runReceiptCoreTests();
  __runReceiptEscposTests();
  __runVrettiSetupTests();
  __runPinHashTests();
  __runAtRestCryptoTests();
  __runRlsCoverageTests();
  __runEngineTests();
  __runLoyaltyConfigTests();
  __runLoyaltySaleTests();
  __runSignupCustomerTests();
  __runScheduleCoreTests();
  __runEmployeeLifecycleTests();
  __runHandbookAckTests();
  __runRegulatoryCoreTests();
  __runComplianceSurfaceTests();
  __runUserGuardTests();
  __runSetPasswordCoreTests();
  __runLoginMessagesCoreTests();
  __runCampaignRulesTests();
  __runCompetitivePlaybookTests();
  __runMidjourneyCoreTests();
  __runFluxCoreTests();
  __runCreativePlacementsTests();
  const ccrsWeek = __runCcrsWeekTests();
  if (ccrsWeek.failed > 0) throw new Error(`ccrs-week-core: ${ccrsWeek.failed} failure(s)`);
  const ccrsDeadline = __runCcrsDeadlineTests();
  if (ccrsDeadline.failed > 0) throw new Error(`ccrs-deadline-core: ${ccrsDeadline.failed} failure(s)`);
  const ccrsTriage = __runCcrsErrorTriageTests();
  if (ccrsTriage.failed > 0) throw new Error(`ccrs-error-triage-core: ${ccrsTriage.failed} failure(s)`);
  __runMenuFeedTests();
  // SLICE L-2 -- the Leafly menu payload. Registered with a checked result AND
  // an assertion floor because the previous registration called the suite and
  // THREW THE RESULT AWAY: a suite reporting failures would have been read as
  // a pass. Getting this wrong ships an invalid menu to Leafly, Leafly rejects
  // the batch, and the store's Leafly menu goes dark with nobody told.
  assertRan("leafly-payload-core", __runLeaflyPayloadTests(), 195);
  assertRan("leafly-payload-validate-core", __runLeaflyPayloadValidateTests(), 124);
  assertRan("leafly-orderability-core", __runLeaflyOrderabilityTests(), 50);
  // Raised from 82 to 95 in SLICE L-19: the scope-aware reconciliation added
  // ~16 assertions, including the negative control proving a targeted read-back
  // still fails when an item it DID send is genuinely absent. Leaving the floor
  // at 82 would let all of that be deleted with CI still green.
  assertRan("leafly-readback-core", __runLeaflyReadbackTests(), 104);
  assertRan("leafly-certification-core", __runLeaflyCertificationTests(), 60);
  // SLICE L-5 -- receiving orders FROM Leafly. Four cores, each registered with
  // a floor for a reason specific to it:
  //   hmac-core          -- decides whether an inbound webhook is genuine. A bug
  //                         here is either "we reject real orders" (silent lost
  //                         revenue) or "we accept forged ones" (worse). Neither
  //                         shows up in a UI.
  //   order-map-core     -- the status vocabulary in BOTH directions, including
  //                         Leafly's "canceled" (one l) vs Greenway's
  //                         "cancelled" (two). A one-character mismatch here
  //                         strands an order in a status nothing can read.
  //   webhook-parse-core -- fails SOFT by contract, because the spec forbids
  //                         answering a notification with a non-200. That design
  //                         is correct and it is also exactly why a parsing bug
  //                         is INVISIBLE in production: the caller is told 200
  //                         either way. Direct assertions are the only place a
  //                         regression can surface.
  //   preview-core       -- money a shopper reads on Leafly before deciding to
  //                         buy. Wrong by construction is wrong in public.
  // Floors RAISED after the L-5 mutation sweep closed 7 survivors. The sweep
  // mutated each core 68 ways; 7 mutations changed behaviour without failing a
  // single test, and the assertions written to catch them are counted here so
  // they cannot be deleted quietly. Measured after the fix: hmac 82, map 149,
  // parse 93, preview 70. The floors sit just below each, which is the point of
  // a floor -- it catches a whole battery vanishing, not a single added case.
  // SLICE L-43: 82 -> 133 after hex-only + Ben's empty-unsigned delivery +
  // the pure admission plan. Floor just below the measured count.
  assertRan("leafly-hmac-core", __runLeaflyHmacTests(), 130);
  assertRan("leafly-order-map-core", __runLeaflyOrderMapTests(), 145);
  assertRan("leafly-webhook-parse-core", __runLeaflyWebhookParseTests(), 95);
  // SLICE L-44: 73 -> 98 with the tax-inclusive invariant (Ben, item 8).
  assertRan("leafly-preview-core", __runLeaflyPreviewTests(), 95);
  // SLICE L-6 -- talking BACK to Leafly. Floored for a reason the L-5 cores do
  // not share: the acknowledge call is IRREVERSIBLE by Leafly's own
  // documentation ("you will no longer have access to the customer's ID
  // images"), so there is no environment in which a mistake here can be undone
  // by retrying. The suite also pins the ORDER API host, which differs from the
  // Menu API host while the OAuth token URL is shared -- the single most
  // plausible copy-paste error in this slice, and one that fails as a 404 that
  // reads like a missing order rather than as a misconfiguration. Measured
  // at registration: 169, then 200 once the acknowledgement clock was added.
  // Floor raised to 195 at that point rather than left at 165, because the
  // clock section is where the suite EARNED its keep: written with `<` on both
  // urgency thresholds, it reported "soon" for an order with exactly five
  // minutes left before Leafly auto-cancels it. Both versions read correctly;
  // only the boundary assertions could tell them apart.
  //
  // Raised again to 370 (measured 382) when the ACTION PLANNER and the human
  // wording landed. The planner is what guarantees the orders dashboard cannot
  // offer a button Leafly would refuse, and that guarantee is only worth
  // stating because it is asserted as an invariant in BOTH directions over
  // every combination of acknowledgement state, current status and fulfillment
  // mechanism: nothing offered may be refused, and nothing accepted may be
  // withheld. The second direction is the one that catches an over-eager
  // filter quietly removing a legal action -- verified by sabotage, which the
  // matrix caught in six places at once.
  // Floor raised 370 -> 470 by slice L-17, which added `busyLabel` to every
  // planned action and asserts its four properties across the whole
  // acknowledgement/status/mechanism matrix (measured 478). The count moved
  // because the matrix multiplies: the wording is checked on every action the
  // planner can emit, not on a sample.
  assertRan("leafly-order-ack-core", __runLeaflyOrderAckTests(), 470);
  // SLICE L-17. Measured 515. The floor is deliberately close to the count
  // because most of these assertions ARE the 8 x 5 matrix, and the cheapest
  // way to weaken this core is to shrink the matrix rather than to change an
  // answer inside it -- which a floor catches and a green suite would not.
  // Floor raised 500 -> 640 by slice L-23, which added the body-phase
  // deadline assertions (667 measured). The floor is what stops the new
  // assertions being quietly deleted later; a deadline that covers the
  // connection but not the response is exactly the kind of regression that
  // looks fine in review.
  // SLICE L-24 raised this from 640 to 700. Adding the `media_fetch`
  // operation pushed the measured count 667 -> 737, because every invariant
  // loop in that core iterates LEAFLY_OPERATIONS. Leaving the floor at 640
  // would have let the entire ninth operation be deleted without CI noticing.
  // SLICE L-48 raised 700 -> 760: `cart_update` is the tenth operation, and
  // every invariant loop above iterates LEAFLY_OPERATIONS.
  assertRan("leafly-deadline-core", __runLeaflyDeadlineTests(), 760);
  // SLICE L-18. The cache policy behind the settings-save hang. The live menu's
  // real tag and TTL are INJECTED rather than copied, so the claim "we share
  // the live menu's invalidation" is checked against the actual constants and
  // a drift fails here instead of silently leaving a stale count on screen.
  // Floor set just under the measured count for the same reason as above: the
  // cheapest way to weaken this core is to delete a trap case.
  assertRan(
    "leafly-setup-cache-core",
    __runLeaflySetupCacheTests({
      liveMenuTag: MENU_CACHE_TAG,
      liveMenuTtlSeconds: MENU_CACHE_TTL_SECONDS,
    }),
    145,
  );
  // SLICE M. Floors set just under the current counts (92 / 46). The fetch
  // core is what makes a receipt possible at all; the readiness core is what
  // stops the dashboard from hiding while setup is half finished.
  assertRan("leafly-order-fetch-core", __runLeaflyOrderFetchTests(), 98);
  // SLICE L-24. The order detail view and the ID-image access window. The
  // decision this core owns is the one the acknowledge warning has always
  // pointed at and the product never implemented: whether the customer's
  // government and medical ID images can still be fetched. Both spec
  // conditions (not acknowledged AND status pending) are ANDed, because
  // Leafly's 15-minute auto-cancel routinely produces orders that are
  // unacknowledged and NOT pending. Measured at 153.
  // SLICE L-25 raised this floor from 140 to 200. The suite gained the
  // `classifyDetailPayload` assertions that distinguish Leafly's five-field
  // submission webhook from a real Order -- the difference between "we never
  // downloaded this order" and "this order is empty", which is what the
  // owner was shown as a blank screen. Measured at 211.
  //
  // SLICE L-25 raised it again, 200 -> 250, after the money defect. A CONTROL
  // assertion written from the vendored OpenAPI spec disagreed with the
  // reader: the spec says every Order money field is already in minor units,
  // and the reader was running a dollars-to-cents conversion over them, so a
  // $48.03 order displayed as $4,803.00 while `Order.taxes` -- an ARRAY of
  // TaxComponent -- read as null on every order ever shown.
  //
  // The suite had been GREEN through all of it, because the fixture invented
  // dollar amounts and cart keys (`totalPrice`, `total`) that appear nowhere
  // in `CartItemOutgoing`. The fixture was rebuilt from the spec's own
  // example arithmetic, `readMinorUnits` / `readTaxesMinorUnits` gained
  // direct coverage, and a negative control now pins the ghost keys so the
  // old behaviour cannot quietly return. Measured at 254.
  assertRan("leafly-order-detail-core", __runLeaflyOrderDetailTests(), 250);

  // SLICE L-25. Returns a bare assertion count rather than { passed, failed }
  // because it throws on the first failure, so a returned count is by
  // definition an all-passed count. Floored at 50; measured at 56.
  {
    const n = __selfTestDbDeadlineCore();
    if (n < 50) {
      throw new Error(
        `db-deadline-core self-tests ran only ${n} assertion(s); expected at least 50. ` +
          `A suite that runs no assertions is not a passing suite.`,
      );
    }
    console.log(`db-deadline-core: ${n} assertions passed, 0 failed (floor 50)`);
  }
  // SLICE 8 (round L-24). The Online Orders report. This core measures a
  // CONTRACT, not money: orders lost to Leafly's 15-minute auto-cancel, and
  // LIFECYCLE REACH -- how many acknowledged orders ever got a `ready` or
  // `picked_up` signal. That second number is the customer-notification
  // story, because Leafly is the "sole originator of automated consumer
  // facing communications" and only speaks when we report a transition.
  // Every rate is null-on-empty-denominator, never 0: "0% on time" and "no
  // orders yet" demand opposite reactions. Measured at 154.
  assertRan("leafly-online-orders-report-core", __runOnlineOrdersReportTests(), 145);
  // STANDING OFFER 2 (round L-24). The staff alert, deliberately built to fire
  // ONLY when the speaker/printer/register channels the owner relies on have
  // failed -- he said plainly "I don't need an email sent to us". An alert on
  // every order would train the mailbox to be ignored, which is how the one
  // alert that mattered gets missed. Measured at 84.
  // SLICE L-46 raised 80 -> 90: nine F5 "already handled" cases (measured 93).
  assertRan("leafly-staff-alert-core", __runLeaflyStaffAlertTests(), 90);
  // Floor raised 42 -> 54 by slice L-16, which added the `pickup_availability`
  // step (measured 58). Raising the floor with the count is deliberate: this
  // core is what decides whether the dashboard may call a shop READY, and the
  // bug being fixed was it saying READY about a shop that could not sell.
  assertRan("leafly-order-readiness-core", __runLeaflyOrderReadinessTests(), 60);
  assertRan("disclosure-core", __runDisclosureTests(), 30);
  assertRan("orders-tabs-core", __runOrdersTabsTests(), 52);
  // SLICE L-22. Floor 48, from a measured 57. Deliberately close: most of the
  // count is exhaustive sweeps over the three-valued pending-ack count and the
  // label matrix, so a drop below this means a sweep stopped sweeping rather
  // than a few duplicate cases being tidied away.
  // SLICE L-40. Lowered 48 -> 32, from a measured 35: the owner removed the
  // "Leafly above ours while unacknowledged" promotion, so decideBoardLayout
  // and its 22 self-tests were retired (replaced by 4 fixed-order checks).
  // Every label / tally / mix test is untouched.
  assertRan("orders-board-order-core", __runBoardOrderTests(), 32);
  // SLICE L-16. Floor 600, set from a measured 631. The gap is deliberately
  // small: most of the count comes from exhaustive sweeps over the seven
  // refusal reasons and the empty-cart cause matrix, so a drop below this
  // means a sweep stopped sweeping rather than a few cases being tidied up.
  assertRan("leafly-refusal-diagnosis-core", __runLeaflyRefusalDiagnosisTests(), 600);
  // Floor 230, set from a measured 242 at registration. Deliberately close to
  // the measured figure: this core is where a platform limit is encoded (Vercel
  // Hobby permitted one cron tick per day, so the daily full sync is driven by an
  // OR of "the configured hour has arrived" and "20 hours have passed"; on Pro
  // since L-34 the tick is every 15 minutes and the OR is the safety net), and
  // the 24-hour sweep that proves the second trigger fires at every hour of the
  // clock is exactly the kind of loop that can be made vacuous by a one-line
  // edit. It carries its own non-vacuity guards; this floor is the outer net.
  assertRan("leafly-schedule-core", __runLeaflyScheduleTests(), 330);
  // SLICE L-8 -- the Leafly webhook evidence reader.
  //
  // Floored at 300 against 316 measured. Two things in this core are worth a
  // floor rather than a bare call:
  //
  //  1. THE PRIVACY AUDIT. `EVIDENCE_FORBIDDEN_KEYS` is what stops a customer's
  //     phone number, date of birth or medical card number reaching a file the
  //     owner emails to Leafly. The suite sweeps every declared forbidden key,
  //     every exported column of a fully populated bundle, AND asserts the
  //     audit still catches a PII column when one is deliberately added -- so
  //     the guard cannot rot into a function that returns false for everything.
  //  2. THE VERDICT ORDERING. A log where every delivery failed on
  //     `missing_key` satisfies both `misconfigured` and `all_rejected`.
  //     `misconfigured` must win, because it is the one the owner can fix
  //     himself. That precedence is asserted explicitly; without it the two
  //     branches could be swapped and every other assertion would still pass.
  assertRan("leafly-evidence-core", __runLeaflyEvidenceTests(), 300);
  assertRan("leafly-helper-core", __runLeaflyHelperTests(), 300);
  __runWmPayloadTests();
  // Floored, not just called. This core gained the Leafly HMAC + order
  // integration key this slice, so it is now the thing that decides whether the
  // webhook receivers above can authenticate AT ALL -- and it was previously
  // registered as a bare call whose result was discarded. It returns
  // `{ passed }` only (it throws on the first failed assertion rather than
  // counting), so it takes the inline floor guard used for the other
  // throw-on-failure cores above, not assertRan.
  {
    const r = __runIntegrationCredentialsTests();
    if (r.passed < 55) {
      throw new Error(
        `integration-credentials-core self-tests ran only ${r.passed} assertion(s); ` +
          `expected at least 55. A suite that runs no assertions is not a passing suite.`,
      );
    }
    console.log(`integration-credentials-core: ${r.passed} assertions passed`);
  }
  __runSyncPlanTests();
  __runPreflightTests();
  __runRichnessTests();
  // Floored as of L-7 -- see the note on `__runSyncSettingsTests`. This core now
  // also resolves the automatic sync schedule, and the round trip it asserts
  // (resolve -> store -> resolve) is what stops an owner's automation setting
  // from being silently reset by an unrelated save on the same jsonb row.
  // TASK I raised this from 64: the invalidItemPolicy resolver added a
  // fail-closed loop over ten junk values plus a round-trip, taking the count
  // from 66 to 81. Raising the floor with the count is the point of the floor.
  assertRan("sync-settings-core", __runSyncSettingsTests(), 87);
  __runApplySettingsTests();
  __runSyndicationPlaybookTests();
  __runPosSaleEventTests();
  __runIdScanCoreTests();
  __runPosSyncCoreTests();
  __runPendingRecoveryCoreTests();
  __runNotifyOutcomeCoreTests();
  // SLICE L-19. The judgement that tells a FAULT (the email provider is not
  // configured, so nobody is being emailed) apart from CORRECT BEHAVIOUR (a
  // Leafly order, where emailing the shopper would breach the integration).
  // Floor set just under the measured count: the cheapest way to weaken this
  // core is to delete a severity case, and a floor is what notices.
  assertRan("email-readiness-core", __runEmailReadinessTests(), 75);
  __runStatusCasCoreTests();
  __runRpcFallbackCoreTests();
  __runExciseReturnTests();
  __runRegisterClientCoreTests();
  __runRegisterPolishCoreTests();
  __runHeldStockCoreTests();
  __runSaleFlowCoreTests();
  __runMedicalPosCoreTests();
  __runPosReceiptCoreTests();
  __runReceiptConfigCoreTests();
  __runReceiptTaxCoreTests();
  __runReceiptLogoCoreTests();
  __runPosReturnsCoreTests();
  __runSaleDecrementCoreTests();
  __runTillCoreTests();
  __runDayReportCoreTests();
  __runPriceDriftCoreTests();
  __runExceptionReminderCoreTests();
  __runRecallHoldCoreTests();
  __runPinThrottleCoreTests();
  __runScanToCartCoreTests();
  __runVariantLotCoreTests();
  __runPriceVariantMatchCoreTests();
  __runPriceCorrectionCoreTests();
  __runImportLotCoreTests();
  __runCardBrandCoreTests();
  { const r = __runMenuCategoryOverrideCoreTests(); if (r.passed < 1) throw new Error("menu-category-override-core: no assertions ran"); console.log(`menu-category-override-core: ${r.passed} assertions passed`); }
  __runVendorDirectoryCoreTests();
  __runCardTypeCoreTests();
  __runLotTableCoreTests();
  __runLotEditCoreTests();
  { const r = __runReceivedDateCoreTests(); if (r.passed < 1) throw new Error("received-date-core: no assertions ran"); console.log(`received-date-core: ${r.passed} assertions passed`); }
  { const r = __runLotWebsiteClassificationCoreTests(); if (r.passed < 1) throw new Error("lot-website-classification-core: no assertions ran"); console.log(`lot-website-classification-core: ${r.passed} assertions passed`); }
  __runCategoryRegistryCoreTests();
  __runTypeRegistryCoreTests();
  __runHouseTypeCoreTests();
  __runDraftApprovalGateTests();
  { const r = __runReceivingClassificationTests(); if (r.passed < 1) throw new Error("receiving-classification-core: no assertions ran"); console.log(`receiving-classification-core: ${r.passed} assertions passed`); }
  { const r = __runClassificationMemoryTests(); if (r.passed < 1) throw new Error("classification-memory-core: no assertions ran"); console.log(`classification-memory-core: ${r.passed} assertions passed`); }
  // SLICE 18A. The `passed < 1` guard is not ceremony: a self-test function
  // that silently returns 0 assertions would otherwise register as a pass, and
  // the sweep would report green while testing nothing.
  { const r = __runClassificationStatusTests(); if (r.passed < 1) throw new Error("classification-status-core: no assertions ran"); console.log(`classification-status-core: ${r.passed} assertions passed`); }
  { const r = __runClassificationWorklistTests(); if (r.passed < 1) throw new Error("classification-worklist-core: no assertions ran"); console.log(`classification-worklist-core: ${r.passed} assertions passed`); }
  { const r = __runClassificationMirrorTests(); if (r.passed < 1) throw new Error("classification-mirror-core: no assertions ran"); console.log(`classification-mirror-core: ${r.passed} assertions passed`); }
  { const r = __runClassificationDisagreementTests(); if (r.passed < 1) throw new Error("classification-disagreement-core: no assertions ran"); console.log(`classification-disagreement-core: ${r.passed} assertions passed`); }
  __runStrainFieldsCoreTests();
  __runStrainTypeIntelTests();
  __runBankingVaultUiTests();
  __runRelatedProductsCoreTests();
  __runDealBadgeCoreTests();
  __runWeightDisplayCoreTests();
  __runVendorRelationsCoreTests();
  __runFactExtractionCoreTests();
  __runFactReviewCoreTests();
  __runFactReviewBulkCoreTests();
  console.log(__runMissingProductMasterCoreTests());
  console.log(__runCompleteReadPlanCoreTests());
  console.log(__runLotGapCoreTests());
  __runImportCommitCoreTests();
  __runCommitIntegrityCoreTests();
  console.log("commit-integrity-core self-tests: all passed");
  __runIntakePotencyCoreTests();
  __runIntakeMasteringCoreTests();
  __runIntakeMenuStagingCoreTests();
  __runPriceOverrideCoreTests();
  __runDeviceSetupCoreTests();
  __runVoidSaleCoreTests();
  __runPickupCoreTests();
  {
    const pickupDetail = __runPickupDetailCoreTests();
    if (pickupDetail.failed > 0) throw new Error(`pickup-detail-core: ${pickupDetail.failed} failure(s)`);
    console.log(`pickup-detail-core self-tests: ${pickupDetail.passed} passed`);
  }
  __runPickupProgressCoreTests();
  __runMemberHistoryCoreTests();
  __runEmailReceiptCoreTests();
  __runChangeCalcCoreTests();
  __runLowStockCoreTests();
  __runCashRoundingCoreTests();
  __runLeaderboardCoreTests();
  __runSaleGridCoreTests();
  __runCustomSaleCoreTests();
  __runFavoritesCoreTests();
  __runScanRequiredCoreTests();
  __runProductInfoCoreTests();
  __runStockFlagCoreTests();
  __runThemeCoreTests();
  __runDraftSeedCoreTests();
  __runWedgeScanCoreTests();
  __runSocketScanCoreTests();
  __runSocketResilienceCoreTests();
  __runRegisterAvailabilityCoreTests();
  __runPickupHandoverCoreTests();
  __runRestoreToSaleCoreTests();
  __runTransactionHistoryCoreTests();
  __runBlockedStockFixCoreTests();
  __runReceiptReprintCoreTests();
  { const r = __runComparisonBasisCoreTests(); if (r.passed < 1) throw new Error("comparison-basis-core: no assertions ran"); console.log(`comparison-basis-core: ${r.passed} assertions passed`); }
  { const r = __runRefundMetricsCoreTests(); if (r.passed < 1) throw new Error("refund-metrics-core: no assertions ran"); console.log(`refund-metrics-core: ${r.passed} assertions passed`); }
  __runRegisterLoyaltyCoreTests();
  __runOrderToCartCoreTests();
  __runMemberMatchCoreTests();
  __runActiveSaleResumeCoreTests();
  __runMenuNameDisplayCoreTests();
  __runMedicalTestModeCoreTests();
  __runSawPrefillCoreTests();
  __runBackLinkTests();
  __runSwCoreTests();
  __runVariantGramsCoreTests();
  __runMenuLiveStepCoreTests();
  __runVendorResolveCoreTests();
  __runCultiveraInvoiceTests();
  assertNoFailures("generic-pdf-transport", __runGenericPdfTransportTests());
  assertNoFailures("email-harvest", __runEmailHarvestTests());
  __runIntakeChecklistCoreTests();
  __runIdCaptureCoreTests();
  __runCultiveraMenuCoreTests();
  __runGrowflowMenuCoreTests();
  __runLeaflinkMenuCoreTests();
  __runUnifiedSearchCoreTests();
  __runUnifiedMenusUiCoreTests();
  __runEmailMenuCoreTests();
  __runCultiveraMenusUiCoreTests();
  __runCultiveraMediaCoreTests();
  __runCultiveraPoCoreTests();
  __runGrowflowMediaCoreTests();
  __runGrowflowKbLinkCoreTests();
  __runLeaflinkMediaCoreTests();
  __runLeaflinkKbLinkCoreTests();
  __runMenuDescriptionCoreTests();
  __runDescriptionQualityCoreTests();
  __runStrainDescriptionChoiceCoreTests();
  __runMenuReadinessCoreTests();
  __runSaveAssetsCoreTests();
  __runCultiveraKbLinkCoreTests();
  __runGrowflowMenuUiCoreTests();
  __runMediaAutosaveCoreTests();
  __runPostgrestEscapeTests();
  __runPgBigintTests();
  __runConstantTimeTests();
  __runGramsPerOunceTests();
  __runPrintRetryCoreTests();
  __runCloudPrntAuthCoreTests();
  __runRevenueBasisTests();
  __runRejectedReportTests();
  __runReservationExpiryTests();
  __runListWindowTests();
  __runListFilterTests();
  __runSpecialDiscountTests();
  __runSpecialDiscountSaleTests();
  __runSpecialDiscountReportTests();
  __runSafeCoreTests();
  __runEodCoreTests();
  __runEnrichmentMatchCoreTests();
  __runPublishGuardTests();
  // SLICE 39 connectivity audit: previously-dark suites. Suites that throw
  // internally on assertion failure are bare calls; suites that only return
  // { passed, failed } are wrapped so a failure still fails this runner.
  __runAdminNavTests();
  __runSageExportsCoreTests();
  __runSageHelperCoreTests();
  __runSage50CoreTests();
  __runAuditAnomalyTests();
  __runCockpitTests();
  __runMobileCoreTests();
  __runStoreProfileTests();
  assertNoFailures("kb-notes-core", __runKbNotesTests());
  assertNoFailures("product-image-edit", __runProductImageEditTests());
  __runProductResearchCoreTests();
  __runEnrichmentLookupQueryCoreTests();
  __runStrainTypeSuggestCoreTests();
  __runStrainVocabCoreTests();
  __runCcrsCategoryMatchCoreTests();
  __runCcrsVocabularyCoreTests();
  __runUnmappedCcrsCoreTests();
  assertNoFailures("webauthn-core", __runWebauthnCoreTests());
  __runNormalizeTests();
  __runVerifyTests();
  assertNoFailures("image-spec-core", __runImageSpecTests());
  { const r = __runContentSelectCoreTests(); if (r.passed < 1) throw new Error("content-select-core: no assertions ran"); console.log(`content-select-core: ${r.passed} assertions passed`); }
  { const r = __runContentReachabilityCoreTests(); if (r.passed < 1) throw new Error("content-reachability-core: no assertions ran"); console.log(`content-reachability-core: ${r.passed} assertions passed`); }
  { const r = __runPageWordingCoreTests(); if (r.passed < 1) throw new Error("page-wording-core: no assertions ran"); console.log(`page-wording-core: ${r.passed} assertions passed`); }
  { const r = __runPolicyDocCoreTests(); if (r.passed < 1) throw new Error("policy-doc-core: no assertions ran"); console.log(`policy-doc-core: ${r.passed} assertions passed`); }
  { const r = __runSpecialsPresentationCoreTests(); if (r.passed < 1) throw new Error("specials-presentation-core: no assertions ran"); console.log(`specials-presentation-core: ${r.passed} assertions passed`); }
  assertNoFailures("home-section-settings-core", __runHomeSectionSettingsTests());
  assertNoFailures("order-name-pool-core", __runOrderNamePoolCoreTests());
  assertNoFailures("order-name-rotation-core", __runOrderNameRotationCoreTests());
  assertNoFailures("qr-core", __runQrCoreTests());
  assertNoFailures("pos/order-name-prefetch-core", __runOrderNamePrefetchCoreTests());
  assertNoFailures("logo-print-core", __runLogoPrintCoreTests());
  assertNoFailures("order-name-compliance-core", __runOrderNameComplianceTests());
  __runNewOrderWatchCoreTests();
  { const r = __runMedicalContentCoreTests(); if (r.passed < 1) throw new Error("medical-content-core: no assertions ran"); console.log(`medical-content-core: ${r.passed} assertions passed`); }
  { const r = __runLoyaltyContentCoreTests(); if (r.passed < 1) throw new Error("loyalty-content-core: no assertions ran"); console.log(`loyalty-content-core: ${r.passed} assertions passed`); }
  { const r = __runLoyaltyHeroCoreTests(); if (r.passed < 1) throw new Error("loyalty-hero-core: no assertions ran"); console.log(`loyalty-hero-core: ${r.passed} assertions passed`); }
  { const r = __runShopCarouselCoreTests(); if (r.passed < 1) throw new Error("shop-carousel-core: no assertions ran"); console.log(`shop-carousel-core: ${r.passed} assertions passed`); }
  { const r = __runMenuSpecialFiltersTests(); if (r.passed < 1) throw new Error("menu-special-filters-core: no assertions ran"); console.log(`menu-special-filters-core: ${r.passed} assertions passed`); }
  { const r = __runMenuDohCoreTests(); if (r.passed < 1) throw new Error("menu-doh-core: no assertions ran"); console.log(`menu-doh-core: ${r.passed} assertions passed`); }
  { const r = __runMenuDohFilterCoreTests(); if (r.passed < 1) throw new Error("menu-doh-filter-core: no assertions ran"); console.log(`menu-doh-filter-core: ${r.passed} assertions passed`); }
  { const r = __runMenuClassificationFilterTests(); if (r.passed < 1) throw new Error("menu-classification-filter-core: no assertions ran"); console.log(`menu-classification-filter-core: ${r.passed} assertions passed`); }
  { const r = __runPosClassificationSearchTests(); if (r.passed < 1) throw new Error("classification-search-core: no assertions ran"); console.log(`classification-search-core: ${r.passed} assertions passed`); }
  { const r = __runMenuDohBadgeCoreTests(); if (r.passed < 1) throw new Error("menu-doh-badge-core: no assertions ran"); console.log(`menu-doh-badge-core: ${r.passed} assertions passed`); }
  { const r = __runMenuClassificationBadgeTests(); if (r.passed < 1) throw new Error("menu-classification-badge-core: no assertions ran"); console.log(`menu-classification-badge-core: ${r.passed} assertions passed`); }
  assertNoFailures("ccrs-identifiers", __runCcrsIdentifierTests());
  __runCcrsAdjustmentTests();
  assertNoFailures("ccrs-submit-gate-core", __runCcrsSubmitGateTests());
  assertNoFailures("compliance-health-core", __runComplianceHealthTests());
  __runExcisePaymentCoreTests();
  __runExciseSendCoreTests();
  assertNoFailures("ccrs-manifest-csv-core", __runCcrsManifestCsvTests());
  __runScanCoreTests();
  assertNoFailures("intake-disposition-core", __runDispositionTests());
  assertNoFailures("intake-review-core", __runIntakeReviewTests());
  assertNoFailures("intake-review-adapter", __runIntakeReviewAdapterTests());
  assertNoFailures("lot-activation-gate-core", __runLotActivationGateTests());
  assertNoFailures("manifest-pipeline-core", __runManifestPipelineTests());
  __runSampleGuardrailTests();
  __runCardCannabinoidTests();
  __runCardIdentityCoreTests();
  __runReprocessCoreTests();
  __runTransformCoreTests();
  assertNoFailures("strain-terpenes", __runStrainTerpeneTests());
  assertNoFailures("strain-taxonomy", __runStrainTaxonomyTests());
  assertNoFailures("pos/cors-core", __runPosCorsCoreTests());
  assertNoFailures("pos/api-base-core", __runPosApiBaseCoreTests());
  assertNoFailures("pos/capacitor-config-core", __runCapacitorConfigCoreTests());
  assertNoFailures("pos/ios-build-config-core", __runIosBuildConfigCoreTests());
  assertNoFailures("pos/star-printer-core", __runStarPrinterCoreTests());
  assertNoFailures("pos/printer-pairing-core", __runPrinterPairingCoreTests());
  assertNoFailures("pos/pos-storage-core", __runPosStorageCoreTests());
  assertNoFailures("pos/pos-secure-store-core", __runPosSecureStoreCoreTests());
  assertNoFailures("pos/register-host-core", __runRegisterHostCoreTests());
  assertNoFailures("pos/theme-contrast-core", __runThemeContrastCoreTests());
  assertNoFailures("variant-sort", __runVariantSortTests());
  assertNoFailures("variant-collapse", __runVariantCollapseTests());
  __runNonCannabisTests();
  __runNamingConventionTests();
  __runCcrsProductNameCoreTests();
  assertNoFailures("nacha-core", __runNachaCoreTests());
  assertNoFailures("vendor-ach-core", __runVendorAchTests());
  __runPayeeBankingCoreTests();
  assertNoFailures("payroll-core", __runPayrollCoreTests());
  assertNoFailures("payroll-guardrails-core", __runPayrollGuardrailsCoreTests());
  __runPayrollReconcileCoreTests();
  __runPayrollUiCoreTests();
  __runVendorReconcileCoreTests();
  __runVendorReconcileUiCoreTests();
  __runInventoryCatalogTests();
  assertNoFailures("code128-core", __runCode128Tests());
  __runPrinterDiagnosticsTests();
  __runPoCoreTests();
  __runPoDocumentCoreTests();
  __runPoListInsightsCoreTests();
  assertNoFailures("forecast-core", __runForecastTests());
  __runNewsletterStatsTests();
  assertNoFailures("range", __runRangeTests());
  __runNetIncomeCoreTests();
  __runZipTests();
  __runTimeclockCoreTests();
  assertNoFailures("vendor-goldminer", __runVendorGoldminerTests());
  __runAtmCoreTests();
  __runAtmUiCoreTests();
  __runAtmReconcileCoreTests();
  __runAtmPostingCoreTests();
  __runAtmSweepCoreTests();
  __runAtmCorroborateCoreTests();
  __runAtmClassificationCoreTests();
  __runLedgerCensusCoreTests();
  __runAtmSyncCoreTests();
  __runPaiEndpointsTests();
  __runAtmReportDiagnosticsTests();
  __runPaiDiscoveryTests();
  __runTerminalStatusCoreTests();
  __runPlaidUiCoreTests();
  __runPlaidSyncCoreTests();
  __runPlaidCoreTests();
  __runPlaidWebhookCoreTests();
  __runPlaidMoneyCoreTests();
  __runPlaidCredentialsCoreTests();
  __runAccountClassificationTests();
  __runPlaidLiabilitiesCoreTests();
  __runPlaidInvestmentsCoreTests();
  __runLoanCoreTests();
  assertNoFailures("canva-core", __runCanvaCoreTests());
  assertNoFailures("blog-content-core", __runBlogContentCoreTests());
  assertNoFailures("glow-card-core", __runGlowCardCoreTests());
  assertNoFailures("site-background-core", __runSiteBackgroundTests());
  assertNoFailures("menu-facet-core", __runMenuFacetTests());
  assertNoFailures("age-gate-core", __runAgeGateTests());
  assertNoFailures("product-lookup-parse", __runProductLookupParseTests());
  __runCommitAuthorshipTests();
  assertNoFailures("core-values-core", __runCoreValuesTests());
  assertNoFailures("llamaparse-core", __runLlamaparseCoreTests());
  console.log(__runLlamaParseStatusCoreTests());
  console.log(__runTransportFieldsCoreTests());
  __runCryptoCoreTests();
  __runCryptoStoreCoreTests();
  __runCryptoUiCoreTests();
  __runCryptoProgressCoreTests();
  __runXrplMapCoreTests();
  __runXrplClientCoreTests();
  __runXrplSyncCoreTests();
  __runEvmMapCoreTests();
  __runEvmDefiCoreTests();
  __runEvmClientCoreTests();
  __runEvmSyncCoreTests();
  __runEvmSyncBudgetCoreTests();
  __runEvmHistoryPaginationCoreTests();
  __runEvmReceiptCoreTests();
  __runEvmTokenDiscoveryCoreTests();
  __runCryptoHoldingsTableCoreTests();
  __runCryptoPricingCoreTests();
  __runCryptoClassificationCoreTests();
  __runCryptoClassificationStoreCoreTests();
  __runCryptoCostBasisCoreTests();
  __runCryptoReconciliationCoreTests();
  __runCryptoClassifyViewCoreTests();
  __runCryptoTransferLedgerCoreTests();
  __runCryptoTransferStoreCoreTests();
  __runCryptoForm8949CoreTests();
  __runCryptoIncomeReportCoreTests();
  __runCryptoMethodSandboxCoreTests();
  __runCryptoFileReadinessCoreTests();
  __runCryptoTaxCenterCoreTests();
  __runCryptoTaxLedgerBuilderCoreTests();
  __runCryptoOriginTraceCoreTests();
  __runCryptoExchangeRegistryCoreTests();
  __runCryptoHistoricalPricingCoreTests();
  __runCryptoOwnerWalletCoreTests();
  __runCryptoTraceViewCoreTests();
  __runCryptoReconstructionReportCoreTests();
  __runCoreumClientCoreTests();
  __runCoreumMapCoreTests();
  __runCoreumSyncCoreTests();
  __runStellarClientCoreTests();
  __runStellarMapCoreTests();
  __runStellarSyncCoreTests();
  __runShareholderRosterCoreTests();
  console.log("shareholder-roster-core self-tests: all passed");
  __runLedgerCoreTests();
  __runCoaCoreTests();
  __runAuditPostingAccountsTests();
  console.log("audit-posting-accounts self-tests: all passed");
  __runPostingCoreTests();
  __runTrialBalanceCoreTests();
  __runFixedAssetsCoreTests();
  __runBooksViewCoreTests();
  __runOwnerGateCoreTests();
  console.log("owner-gate-core self-tests: all passed");
  __runGlRefusalCoreTests();
  __runJournalAdvisorCoreTests();
  console.log("journal-advisor-core self-tests: all passed");
  __runCutoverCoreTests();
  console.log("cutover-core self-tests: all passed");
  // books-72. The cut-over INVENTORY builder, kept separate from cutover-core
  // because that module owns the dates and this one owns the money on the shelf.
  __runCutoverInventoryCoreTests();
  console.log("cutover-inventory-core self-tests: all passed");
  // books-73. The LEDGER's own category map. Michael, verbatim: "the ledger
  // should use its own accounts and not the website map."
  __runLedgerCategoryMapCoreTests();
  console.log("ledger-category-map-core self-tests: all passed");
  __runVendorBillCoreTests();
  __runLotCostClassificationTests();
  console.log("lot-cost-classification-core self-tests: all passed");
  __runRegisterCashJournalTests();
  console.log("register-cash-journal-core self-tests: all passed");
  __runRegisterCashSpecimenTests();
  console.log("register-cash-specimen-core self-tests: all passed");
  __runDepositClearingTests();
  __runDepositFifoTests();
  __runSafeBagTests();
  __runCardPaymentTests();
  __runPayrollCogsCoreTests();
  __runBankMatchCoreTests();
  console.log("bank-match-core self-tests: all passed");
  __runBooksGuidanceCoreTests();
  console.log("books-guidance-core self-tests: all passed");

  __runBooksLedgerGuidanceCoreTests();
  console.log("books-ledger-guidance-core self-tests: all passed");

  // books-10, THE INVENTORY AUDITOR. The authorities run first: if a citation is
  // broken there is no point testing the machinery that quotes it.
  __runInventoryAuditAuthoritiesTests();
  console.log("inventory-audit-authorities self-tests: all passed");

  __runInventoryAuditCoreTests();
  console.log("inventory-audit-core self-tests: all passed");

  // books-11, THE STORE LAYER. Runs after inventory-audit-core because it
  // consumes that module's assessments: if the assessment is wrong there is no
  // point asking whether we posted it correctly.
  __runInventoryAuditPostCoreTests();
  console.log("inventory-audit-post-core self-tests: all passed");

  // books-12, THE AUDITING HUB. Authorities first, then the guidance that
  // quotes them -- same ordering rule as books-10, for the same reason.
  __runAuditHubAuthoritiesTests();
  console.log("audit-hub-authorities self-tests: all passed");

  __runAuditHubGuidanceCoreTests();
  console.log("audit-hub-guidance-core self-tests: all passed");

  // books-47 slice D, THE TEACHING SURFACE. Ordered the way the data flows:
  // the box model first, then the adapters that translate each engine into it,
  // then the screen logic that draws the result. A failure in the model makes
  // the other two meaningless, so it must report first.
  __runFormBoxCoreTests();
  console.log("form-box-core self-tests: all passed");

  __runFormBoxAdapterTests();
  console.log("form-box-adapters self-tests: all passed");

  __runFormBoxUiCoreTests();
  console.log("form-box-ui-core self-tests: all passed");

  __runFormBoxTeachingCoreTests();
  __runFormScopeCoreTests();
  console.log("form-box-teaching-core self-tests: all passed");

  __runEsdEamsCsvTests();
  console.log("esd-eams-csv-core self-tests: all passed");

  __runEsd5208WorksheetTests();
  console.log("esd-5208-worksheet-core self-tests: all passed");

  __runExpenseClassificationCoreTests();
  console.log("expense-classification-core self-tests: all passed");

  __runBankExpenseCoreTests();
  console.log("bank-expense-core self-tests: all passed");

  __runApprovalCoreTests();
  // approval-core prints its own line; this is the registry's confirmation.
  console.log("approval-core registered in the pure self-test sweep");

  __runLargeDraftNoticeCoreTests();
  console.log("large-draft-notice-core self-tests: all passed");

  __runPayrollPostingCoreTests();
  console.log("payroll-posting-core registered in the pure self-test sweep");

  __runRelatedPartyLoanCoreTests();
  console.log("related-party-loan-core self-tests: all passed");

  __runSaleJournalCoreTests();
  console.log("sale-journal-core self-tests: all passed");

  __runReceiptJournalCoreTests();
  console.log("receipt-journal-core self-tests: all passed");

  __runFactoryResetCoreTests();
  console.log("factory-reset-core self-tests: all passed");

  __runReceiptCategoryCoreTests();
  console.log("receipt-category-core self-tests: all passed");

  __runSaleCogsCoreTests();
  console.log("sale-cogs-core self-tests: all passed");

  __runBulkFillCoreTests();
  console.log("bulk-fill-core self-tests: all passed");

  // SLICE 13 — inventory filtering / sorting / smart search.
  __runStrainMatcherTests();
  __runInventorySearchCoreTests();
  __runInventoryFilterCoreTests();
  __runInventorySortCoreTests();
  __runInventoryListCoreTests();
  __runInventoryUrlCoreTests();
  __runInventoryPageCoreTests();
  __runFacetTypeaheadCoreTests();

  // SLICE 27 — online order announcer decision layer.
  // SLICE L-10 raised these from assertNoFailures to assertRan. An empty
  // suite has zero failures, so "no failures" alone would let the origin
  // assertions be deleted without CI noticing.
  assertRan("announcer-core", __runAnnouncerCoreTests(), 181);
  assertNoFailures("announcer-protocol-core", __runAnnouncerProtocolTests());
  assertRan("announcer-fanout-core", __runAnnouncerFanoutTests(), 85);
  assertNoFailures("announcer-admin-core", __runAnnouncerAdminTests());
  assertNoFailures("announcer-sounds-core", __runAnnouncerSoundsTests());
  assertNoFailures("announcer-library-core", __runAnnouncerLibraryTests());
  assertNoFailures("announcer-setup-core", __runAnnouncerSetupTests());

  // SLICE L-2 -- order origin (website vs Leafly marketplace vs in-store
  // register). Decides the announcer chime, the receipt banner and whether a
  // customer-facing email may be sent at all.
  assertRan("order-origin-core", __runOrderOriginTests(), 40);
  assertRan("order-board-split-core", __runOrderBoardSplitTests(), 43);
  // SLICE L-40. Floor 88, from a measured 94. The owner asked for the Leafly
  // panel to "look and behave identically" to ours; this core is where that
  // behaviour is written down, so a drop means a behaviour stopped being proven.
  assertRan("order-panels-core", __runOrdersPanelTests(), 88);

  // SLICE L-10 -- the Leafly bridge. Decides, for each stage of a Leafly
  // order's life, whether the PA sounds, whether paper comes out of the
  // printer, and whether a row appears in `orders` (which is what makes the
  // register able to see it at all).
  assertRan("leafly-bridge-core", __runLeaflyBridgeTests(), 374);

  // SLICE L-11 -- the item picker's decision core. Floored, not merely called:
  // the assertions that matter most here are the small ones (a 20-item pick is
  // coerced from POST to PUT; the plan never writes sync state unless the whole
  // feed was chosen; the plan never emits deletes at all), and those are
  // exactly the assertions a careless edit would quietly drop.
  assertRan("leafly-selection-core", __runLeaflySelectionTests(), 100);
  // SLICE L-19. The floors are set just under the current counts so that
  // deleting a meaningful block of assertions fails CI, while adding more
  // never does.
  assertRan("leafly-readback-baseline-core", __runLeaflyReadbackBaselineTests(), 30);
  assertRan("leafly-picker-view-core", __runLeaflyPickerViewTests(), 138);
  assertRan("leafly-variant-identity-core", __runLeaflyVariantIdentityTests(), 75);
  assertRan("leafly-menu-visibility-core", __runLeaflyMenuVisibilityTests(), 108);

  // TASK I. The three cores behind the full-menu push failure. Floors set
  // just under the current counts, per the note above: 128 / 79 / 86.
  assertRan("leafly-potency-core", __runLeaflyPotencyTests(), 120);
  assertRan("leafly-quarantine-core", __runLeaflyQuarantineTests(), 75);
  assertRan("leafly-delete-request-core", __runLeaflyDeleteRequestTests(), 80);

  // TASK J. The three cores behind the Cultivera remediation work. Floors set
  // just under the current counts (94 / 76 / 49), same convention as above: a
  // floor proves the suite RAN, so a core that silently stops asserting fails
  // CI instead of passing vacuously.
  assertRan("leafly-product-identity-core", __runLeaflyProductIdentityTests(), 90);
  assertRan("leafly-collision-remedy-core", __runLeaflyCollisionRemedyTests(), 72);
  assertRan("leafly-sample-rotation-core", __runLeaflySampleRotationTests(), 46);
  assertRan("leafly-sendability-core", __runLeaflySendabilityTests(), 80);
  assertRan("leafly-menu-browser-core", __runLeaflyMenuBrowserTests(), 66);
  assertRan("leafly-collision-apply-core", __runLeaflyCollisionApplyTests(), 66);
  assertRan("leafly-collision-split-core", __runLeaflyCollisionSplitTests(), 60);
  // TASK J ask 2: every "fix this product" button must land on a page that
  // exists. Floor set below the current 58 so an added assertion never fails
  // the build, but high enough that deleting the split/synthesized branches
  // would.
  assertRan("leafly-fix-link-core", __runLeaflyFixLinkTests(), 52);
  // TASK J ask 3: send the whole menu, withhold the bad ones, name them.
  assertRan("leafly-full-menu-core", __runLeaflyFullMenuTests(), 62);
  assertRan("leafly-split-preview-core", __runLeaflySplitPreviewTests(), 80);
  // SLICE L-41: what an automatic run transmits. Never POST while anything is
  // held back; never delete a held-back product or its split family. Floor
  // just under the measured 69.
  assertRan("leafly-auto-sync-core", __runLeaflyAutoSyncTests(), 66);
  assertRan("leafly-replace-menu-core", __runLeaflyReplaceMenuTests(), 37);
  // SLICE L-45: orderIntegrationKey == Menu Key (Ben, item 2). Blank order box
  // falls back to the menu key; a body key that differs is REPORTED, never
  // dropped. Floor just under the measured 81.
  assertRan("leafly-retailer-key-core", __runLeaflyRetailerKeyTests(), 78);
  // SLICE L-46: Ben's nine-second rule. Answer inside a 6s budget (3s of
  // headroom for cold starts), keep the rest of the work alive after the 200,
  // never assume a retry policy Leafly did not state. Floor just under the
  // measured count.
  assertRan("leafly-inbound-budget-core", __runLeaflyInboundBudgetTests(), 86);
  // SLICE L-47: certification proof. A row turns green only from a recorded
  // row; unreadable is "unknown", never "none"; >14 days is "may be gone".
  // Floor just under the measured 178.
  assertRan("leafly-certification-proof-core", __runLeaflyCertificationProofTests(), 205);
  // SLICE L-48 — "Update Order's Cart". Removal is by OMISSION at Leafly, so
  // the reader/decision assertions here are what stop a half-read cart from
  // silently deleting a customer's items. Floor just under the measured count.
  assertRan("leafly-order-cart-core", __runLeaflyOrderCartTests(), 118);

  console.log("ALL PURE SELF-TESTS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
