/**
 * scripts/compliance/run-pure-selftests.ts
 *
 * Runs the embedded self-tests of the PURE compliance/money modules. Exits
 * non-zero on any failure. Run with:  npx tsx scripts/compliance/run-pure-selftests.ts
 */
import { __runOrderPricingTests } from "../../src/lib/orders/order-pricing-core";
import { __runDiscountEngineTests } from "../../src/lib/promotions/discount-engine-core";
import { __runPromoGuardTests } from "../../src/lib/promotions/promo-guard-core";
import { __runSalesLimitTests } from "../../src/lib/compliance/sales-limits-core";
import { __runSalesLimitGateTests } from "../../src/lib/compliance/sales-limit-gate-core";
import { __runChunkedInTests } from "../../src/lib/supabase/chunked-in";
import { __runExemptSaleRecordTests } from "../../src/lib/medical/exempt-sale-record-core";
import { __runSalesHoursCoreTests } from "../../src/lib/compliance/sales-hours-core";
import { __runReceiptCoreTests } from "../../src/lib/printing/receipt-core";
import { __runPinHashTests } from "../../src/lib/security/pin-hash";
import { __runAtRestCryptoTests } from "../../src/lib/security/at-rest-crypto";

async function main() {
  __runOrderPricingTests();
  __runDiscountEngineTests();
  __runPromoGuardTests();
  __runSalesLimitTests();
  __runSalesLimitGateTests();
  await __runChunkedInTests();
  const exempt = __runExemptSaleRecordTests();
  if (exempt.failed > 0) throw new Error(`exempt-sale-record-core: ${exempt.failed} failure(s)`);
  __runSalesHoursCoreTests();
  __runReceiptCoreTests();
  __runPinHashTests();
  __runAtRestCryptoTests();
  console.log("ALL PURE SELF-TESTS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
