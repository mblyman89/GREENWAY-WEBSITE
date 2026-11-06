/**
 * src/lib/promotions/revalidate-promotions.ts  (D195 step 4: freshness)
 *
 * The Promotions pages (command center, each promotion's preview, the bad
 * product queue, clearance) read the live menu and the inventory costs. When
 * an inventory save changes a price, a cost, a lot's size, its product link,
 * its status or its category, those pages must re-check on the next view
 * instead of showing a cached answer. One "layout" revalidation covers every
 * page under /admin/promotions (Next.js revalidatePath, type "layout").
 */
import { revalidatePath } from "next/cache";

export const PROMOTIONS_ROOT = "/admin/promotions";

export function revalidatePromotionSurfaces(): void {
  revalidatePath(PROMOTIONS_ROOT, "layout");
}
