/**
 * scripts/discovery/test_sample_capacity_pure.ts
 *
 * Runner for the PURE sample-capacity logic (no DB, no network).
 *   npx tsx scripts/discovery/test_sample_capacity_pure.ts
 *
 * Covers: distribution-capacity lanes (trade / iqc / concentrate), traffic-light
 * tones, zero-employee + full-quarter edge cases, late-quarter tightening,
 * per-batch verdicts (fits / tight / no-room), and calendar-quarter day math.
 */
import { __runSampleCapacityCoreTests } from "../../src/lib/compliance/sample-capacity-core";

try {
  console.log(__runSampleCapacityCoreTests());
  process.exit(0);
} catch (e) {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(1);
}
