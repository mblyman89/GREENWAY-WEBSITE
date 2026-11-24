/**
 * src/lib/promotions/display-rules-cache.ts — USAGE-8d
 *
 * The CACHED, DISPLAY-ONLY entry point for the published promotion rules.
 * Public storefront renders only (see DISPLAY_RULES_CALLERS). Money paths keep
 * `loadPublishedRuleSnapshots()` from discount-engine.ts, which is uncached.
 * Full reasoning: display-rules-cache-core.ts.
 */
import "server-only";
import { revalidateTag, unstable_cache } from "next/cache";
import { loadPublishedRuleSnapshots, readPublishedRuleSnapshots } from "./discount-engine";
import type { PublishedRuleSnapshot } from "./published-rules-core";
import { PUBLISHED_RULES_TAG, PUBLISHED_RULES_TTL_SECONDS } from "./display-rules-cache-core";

// Built lazily (first call, inside the try below) so importing this module
// never touches `unstable_cache` — older suites mock next/cache partially.
let cachedSnapshots: (() => Promise<PublishedRuleSnapshot[]>) | null = null;
function getCachedSnapshots(): () => Promise<PublishedRuleSnapshot[]> {
  cachedSnapshots ??= unstable_cache(
    // Throws on a failed read, so a failure is never stored (rule 18).
    async (): Promise<PublishedRuleSnapshot[]> => readPublishedRuleSnapshots(),
    ["published-rule-snapshots", "display", "v1"],
    { revalidate: PUBLISHED_RULES_TTL_SECONDS, tags: [PUBLISHED_RULES_TAG] },
  );
  return cachedSnapshots;
}

/** Published rules for PUBLIC DISPLAY. On any failure: the original uncached read (seed fallback). */
export async function loadDisplayRuleSnapshots(): Promise<PublishedRuleSnapshot[]> {
  try {
    return await getCachedSnapshots()();
  } catch {
    return loadPublishedRuleSnapshots();
  }
}

/**
 * Clear the cached display rules by name. Called next to every
 * `revalidatePath("/(site)", "layout")` in the promotion / specials /
 * never-discount actions. Never throws: the edit already committed.
 */
export function revalidateDisplayRules(): void {
  try {
    revalidateTag(PUBLISHED_RULES_TAG, "max");
  } catch (err) {
    console.error(`[display-rules-cache] revalidateTag ${PUBLISHED_RULES_TAG} failed:`, err);
  }
}
