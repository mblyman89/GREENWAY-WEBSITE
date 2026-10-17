/** `npm test` in merch-site/ - runs the pure self-tests. */
import { __runMerchCatalogTests } from "../lib/catalog-core";
import { __runCheckoutCoreTests } from "../lib/checkout-core";

let failed = 0;
for (const [name, run] of [["catalog-core", __runMerchCatalogTests], ["checkout-core", __runCheckoutCoreTests]] as const) {
  const r = run();
  console.log(`${name}: ${r.passed} passed, ${r.failed} failed`);
  failed += r.failed;
}
if (failed) process.exit(1);
