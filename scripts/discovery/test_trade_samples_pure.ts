/**
 * scripts/discovery/test_trade_samples_pure.ts
 *
 * Runner for the PURE trade-sample / IQC compliance logic (no DB, no network).
 * Run with the already-present `tsx`:
 *
 *   npx tsx scripts/discovery/test_trade_samples_pure.ts
 *
 * Covers: quarter math, per-unit size caps (trade + IQC), quarterly cap
 * evaluation (incoming, outgoing, IQC 50-cap + 25-concentrate sub-cap),
 * category-aware record parsing (IQC forced outgoing), and sample-JSON import.
 *
 * STANDING RULE (verify by running): asserts the behaviors the server layer +
 * UI rely on. Exits non-zero on first failure.
 */
import { __runTradeSamplesCoreTests } from "../../src/lib/compliance/trade-samples-core";

try {
  const result = __runTradeSamplesCoreTests();
  console.log(result);
  process.exit(0);
} catch (e) {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(1);
}
