import "server-only";
import { unstable_cache } from "next/cache";
import { posExceptionSnapshot } from "@/lib/pos/sync-store";
import { countWaitingForOwner } from "@/lib/payments/ach-requests-store";
import { formatBadgeCount } from "@/lib/pos/exception-reminder-core";

/**
 * PERF-S3: nav badge counts used to be awaited SERIALLY in the admin layout
 * before any page byte could stream. They are now:
 *  - fetched in parallel,
 *  - cached for 30 s in the Data Cache (service-role reads, no cookies, so the
 *    result is the same for every staff member who may see the badge), and
 *  - rendered inside a Suspense boundary (see AdminNavWithBadges), so a slow
 *    count can never hold up the page.
 * A badge can lag the truth by up to 30 s; that is fine for a reminder chip.
 */
export const ADMIN_BADGES_TAG = "admin-nav-badges";

const readExceptionLabel = unstable_cache(
  async () => formatBadgeCount((await posExceptionSnapshot()).count) ?? "",
  ["admin-badge-pos-exceptions", "v1"],
  { revalidate: 30, tags: [ADMIN_BADGES_TAG] },
);

const readOwnerLabel = unstable_cache(
  async () => {
    const w = await countWaitingForOwner().catch(() => ({ pending: 0, toReview: 0 }));
    return formatBadgeCount(w.pending + w.toReview) ?? "";
  },
  ["admin-badge-owner-waiting", "v1"],
  { revalidate: 30, tags: [ADMIN_BADGES_TAG] },
);

export async function loadAdminBadges(opts: { exceptions: boolean; owner: boolean }): Promise<Record<string, string>> {
  const [exc, own] = await Promise.all([
    opts.exceptions ? readExceptionLabel().catch(() => "") : Promise.resolve(""),
    opts.owner ? readOwnerLabel().catch(() => "") : Promise.resolve(""),
  ]);
  const badges: Record<string, string> = {};
  if (exc) badges["/admin/registers"] = exc;
  if (own) badges["/admin/settings/banking"] = own;
  return badges;
}
