/**
 * scripts/discovery/test_sample_history_pure.ts
 *
 * Runner for the PURE sample-history logic (no DB, no network).
 *   npx tsx scripts/discovery/test_sample_history_pure.ts
 *
 * Covers: filtering (employee/quarter/category/type/search, AND-combined),
 * sorting (date/units/employee/type, non-mutating), summaries, per-employee/
 * quarter roll-ups vs caps, distinct quarters, and CSV export + escaping.
 */
import { __runSampleHistoryCoreTests } from "../../src/lib/compliance/sample-history-core";

try {
  console.log(__runSampleHistoryCoreTests());
  process.exit(0);
} catch (e) {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(1);
}
