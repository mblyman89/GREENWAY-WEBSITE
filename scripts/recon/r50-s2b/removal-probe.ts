// R50 S2b: legacy-lot removal plan (read-only) against the local harness.
// Copy to the repo root to run (it imports @/), then delete. Never shipped.
import { loadLegacyRemovalPlan } from "@/lib/pos/legacy-lot-removal-store";

const A = "abcd1234-0000-4000-8000-00000000000a";
(async () => {
  try {
    const r = await loadLegacyRemovalPlan(A);
    console.log(
      "REMOVAL A",
      JSON.stringify({
        found: r.manifestFound,
        flagged: r.flaggedCards,
        rows: r.plan.rows.map((x) => x.id).sort(),
      }),
    );
  } catch (e) {
    console.log("REMOVAL A THREW", JSON.stringify(e instanceof Error ? e.message : String(e)));
  }
})();
