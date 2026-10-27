// PERF-S2 — published promotion rules for the Banner Design Studio ONLY.
//
// Before PERF-S2 the public-site root layout wrapped /admin too, so all 264
// admin pages paid for `loadPublishedRuleSnapshots()` (promotions + targets +
// exclusions + configs + never-discount, ~4-5 queries) on every navigation,
// although only the studio's live-deal preview (`LiveFields`, `StudioBoxText`)
// reads `usePublishedRules()`. Admin now has its own root layout
// (`src/app/admin/layout.tsx`), and the five routes that mount the studio get
// the rules from this tiny segment layout instead.
import { PublishedRulesProvider } from "@/components/promotions/PublishedRulesProvider";
import { loadPublishedRuleSnapshots } from "@/lib/promotions/discount-engine";

export async function StudioRulesLayout({ children }: { children: React.ReactNode }) {
  const snapshots = await loadPublishedRuleSnapshots();
  return <PublishedRulesProvider snapshots={snapshots}>{children}</PublishedRulesProvider>;
}
