/** `npm test` in merch-site/ - runs the pure self-tests. */
import { __runMerchCatalogTests } from "../lib/catalog-core";
import { __runCheckoutCoreTests } from "../lib/checkout-core";
import { __runOrdersCoreTests } from "../lib/orders-core";
import { __runRegionCoreTests } from "../lib/region-core";
import { __runSiteContentCoreTests } from "../lib/site-content-core";
import { __runSeoCoreTests } from "../lib/seo-core";

let failed = 0;
for (const [name, run] of [["catalog-core", __runMerchCatalogTests], ["checkout-core", __runCheckoutCoreTests], ["orders-core", __runOrdersCoreTests], ["region-core", __runRegionCoreTests], ["site-content-core", __runSiteContentCoreTests], ["seo-core", __runSeoCoreTests]] as const) {
  const r = run();
  console.log(`${name}: ${r.passed} passed, ${r.failed} failed`);
  failed += r.failed;
}
if (failed) process.exit(1);
