/**
 * src/lib/pos/issue-fix-link-server.ts  (S26)
 *
 * The ONLY I/O behind the receiving fix links: given the warnings on one
 * intake menu version, read what the pure registry (issue-fix-link-core)
 * needs to land each "How to fix it" button on its control.
 *
 *   - catalog_product_drafts by id (the draft_id the injector persisted);
 *   - catalog_product_drafts by pos_product_key, scoped to THIS delivery's
 *     APPROVED drafts (mastering diagnostics carry only the key);
 *   - which keys are on the PUBLISHED menu (loadMenuCategoriesForKeys), so a
 *     product-page link is emitted only when /admin/products/[key] resolves.
 *
 * Named columns only. Reads only (never writes). Bounded: issueLookupPlan caps
 * at the first 100 warnings, the same slice the page renders. Any failure
 * degrades to EMPTY_ISSUE_LOOKUPS, which yields today's list links — the page
 * never breaks because a lookup did.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { loadMenuCategoriesForKeys } from "@/lib/inventory/website-category-resolver-server";
import {
  EMPTY_ISSUE_LOOKUPS,
  indexIssueDrafts,
  issueLookupPlan,
  type IssueDiagnostic,
  type IssueDraftRow,
  type IssueLookups,
} from "@/lib/pos/issue-fix-link-core";
import { isUuid } from "@/lib/catalog/draft-deep-link-core";

/** The named columns a fix link needs (IssueDraftRow). */
export const ISSUE_DRAFT_COLUMNS = "id, lot_id, inventory_type, pos_product_key, name";

export async function loadIssueLookups(
  diagnostics: readonly IssueDiagnostic[],
  manifestId: string | null,
): Promise<IssueLookups> {
  const plan = issueLookupPlan(diagnostics);
  if (plan.draftIds.length + plan.draftKeys.length + plan.liveKeys.length === 0) return EMPTY_ISSUE_LOOKUPS;
  if (!isSupabaseServiceConfigured) return EMPTY_ISSUE_LOOKUPS;
  try {
    const admin = createSupabaseAdminClient();
    let byId: IssueDraftRow[] = [];
    let byKey: IssueDraftRow[] = [];
    if (plan.draftIds.length > 0) {
      const { data, error } = await admin
        .from("catalog_product_drafts")
        .select(ISSUE_DRAFT_COLUMNS)
        .in("id", plan.draftIds);
      if (error) console.error("[issue-fix-link] drafts-by-id read failed:", error.message);
      else byId = (data as IssueDraftRow[] | null) ?? [];
    }
    // Key → draft only inside THIS delivery (never a same-key draft from
    // another manifest), and only approved (the injector reads approved only).
    if (plan.draftKeys.length > 0 && manifestId && isUuid(manifestId)) {
      const { data, error } = await admin
        .from("catalog_product_drafts")
        .select(ISSUE_DRAFT_COLUMNS)
        .eq("manifest_id", manifestId)
        .eq("status", "approved")
        .in("pos_product_key", plan.draftKeys);
      if (error) console.error("[issue-fix-link] drafts-by-key read failed:", error.message);
      else byKey = (data as IssueDraftRow[] | null) ?? [];
    }
    // Live check covers every key a link may point at: the potency / merge
    // keys from the plan plus the keys of the drafts we just read.
    const keys = new Set(plan.liveKeys);
    for (const r of [...byId, ...byKey]) if (r.pos_product_key) keys.add(r.pos_product_key);
    const live = keys.size > 0 ? await loadMenuCategoriesForKeys([...keys]) : new Map<string, string>();
    return { ...indexIssueDrafts(byId, byKey), liveKeys: new Set(live.keys()) };
  } catch (err) {
    console.error("[issue-fix-link] lookups failed:", err);
    return EMPTY_ISSUE_LOOKUPS;
  }
}
