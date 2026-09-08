/**
 * scripts/compliance/run-pure-selftests.ts
 *
 * Runs the embedded self-tests of the PURE compliance/money modules. Exits
 * non-zero on any failure. Run with:  npx tsx scripts/compliance/run-pure-selftests.ts
 */
import { __runOrderPricingTests } from "../../src/lib/orders/order-pricing-core";
import { __runTaxBaseCoreTests } from "../../src/lib/reports/tax-base-core";
import { __runExciseReturnTests } from "../../src/lib/compliance/excise-return-core";
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

async function main() {
  __runOrderPricingTests();
  __runTaxBaseCoreTests();
  __runDiscountEngineTests();
  __runPromoGuardTests();
  assertNoFailures("promotion-selector-core", __runPromotionSelectorTests());
  assertNoFailures("promotion-selector-ai", __runPromotionSelectorAiTests());
  assertNoFailures("guided-promotion-core", __runGuidedPromotionTests());
  assertNoFailures("thursday-planner-core", __runThursdayPlannerTests());
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
  __runLeaflyPayloadTests();
  __runWmPayloadTests();
  __runIntegrationCredentialsTests();
  __runSyncPlanTests();
  __runPreflightTests();
  __runRichnessTests();
  __runSyncSettingsTests();
  __runApplySettingsTests();
  __runSyndicationPlaybookTests();
  __runPosSaleEventTests();
  __runIdScanCoreTests();
  __runPosSyncCoreTests();
  __runPendingRecoveryCoreTests();
  __runNotifyOutcomeCoreTests();
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
  assertNoFailures("announcer-core", __runAnnouncerCoreTests());
  assertNoFailures("announcer-protocol-core", __runAnnouncerProtocolTests());
  assertNoFailures("announcer-fanout-core", __runAnnouncerFanoutTests());
  assertNoFailures("announcer-admin-core", __runAnnouncerAdminTests());
  assertNoFailures("announcer-sounds-core", __runAnnouncerSoundsTests());
  assertNoFailures("announcer-library-core", __runAnnouncerLibraryTests());

  console.log("ALL PURE SELF-TESTS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
