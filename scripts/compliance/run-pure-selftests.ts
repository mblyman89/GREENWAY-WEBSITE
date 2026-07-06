/**
 * scripts/compliance/run-pure-selftests.ts
 *
 * Runs the embedded self-tests of the PURE compliance/money modules. Exits
 * non-zero on any failure. Run with:  npx tsx scripts/compliance/run-pure-selftests.ts
 */
import { __runOrderPricingTests } from "../../src/lib/orders/order-pricing-core";
import { __runDiscountEngineTests } from "../../src/lib/promotions/discount-engine-core";
import { __runSalesLimitTests } from "../../src/lib/compliance/sales-limits-core";
import { __runSalesLimitGateTests } from "../../src/lib/compliance/sales-limit-gate-core";

__runOrderPricingTests();
__runDiscountEngineTests();
__runSalesLimitTests();
__runSalesLimitGateTests();
console.log("ALL PURE SELF-TESTS PASSED");
