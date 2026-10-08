/**
 * src/lib/inventory/line-identity-server.ts  (R31)
 *
 * SERVER-ONLY loader for the manifest review page's per-line identity chip
 * (line-identity-chip-core). It reads the same facts onboarding uses when it
 * seeds drafts (catalog-drafts.seedDraftsForManifest), with named columns:
 *   - the lots' identity columns (SEED_LOT_COLUMNS: brand_id, vendor_id,
 *     unit_weight, unit_weight_uom) and the vendor/brand display names;
 *   - which POS keys are cards on the published menu;
 *   - the live cards of THIS manifest's vendors grouped by identity
 *     (buildLiveIdentityIndex), capped exactly like onboarding: a full page
 *     could hide a second card, so it returns "unknown" instead;
 *   - kb_products rows for the lots' product slugs (KB_LINK_COLUMNS).
 *
 * NEVER THROWS and never guesses: any failed read degrades that fact to
 * "unknown" (the core then shows "New product", never a wrong match), and a
 * total failure returns an empty map (the page simply shows no chips).
 * Read-only: nothing is written.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { getPublishedVersion } from "@/lib/pos/menu-version";
import { identityForLot } from "@/lib/catalog/product-identity-core";
import {
  buildLiveIdentityIndex,
  LIVE_MENU_IDENTITY_COLUMNS,
  type LiveMenuRow,
} from "@/lib/inventory/identity-stamp-core";
import { KB_LINK_COLUMNS } from "@/lib/inventory/kb-link-store";
import { SEED_LOT_COLUMNS } from "@/lib/inventory/catalog-drafts";
import { planLineChips, type KbRowLite, type LineChip, type LineIdentityInput } from "@/lib/inventory/line-identity-chip-core";

/** Same cap as onboarding's restock hint (catalog-drafts LIVE_IDENTITY_READ_CAP). */
export const LINE_IDENTITY_LIVE_CAP = 1000;

type LotRow = {
  id: string;
  pos_product_key: string | null;
  product_name: string | null;
  brand_id: string | null;
  vendor_id: string | null;
  unit_weight: number | null;
  unit_weight_uom: string | null;
};

async function namesFor(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  table: "vendors" | "brands",
  ids: Array<string | null>,
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const unique = Array.from(new Set(ids.filter((v): v is string => Boolean(v))));
  if (unique.length === 0) return out;
  const { data, error } = await admin.from(table).select("id, display_name").in("id", unique);
  if (error) {
    console.error(`[line-identity] ${table} name read failed:`, error.message);
    return out;
  }
  for (const r of (data as { id: string; display_name: string | null }[] | null) ?? []) out.set(r.id, r.display_name ?? null);
  return out;
}

/**
 * The chip for every lot on one manifest. `websiteCategoryByLotId` comes from
 * the page's existing resolveWebsiteCategories call (no second read).
 */
export async function loadLineIdentityChips(
  manifestId: string,
  websiteCategoryByLotId: Map<string, string | null>,
): Promise<Map<string, LineChip>> {
  if (!isSupabaseServiceConfigured || !manifestId) return new Map();
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("inventory_lots")
      .select(SEED_LOT_COLUMNS)
      .eq("manifest_id", manifestId);
    if (error || !data) return new Map();
    const rows = data as unknown as LotRow[];
    if (rows.length === 0) return new Map();

    const [vendorNames, brandNames, published] = await Promise.all([
      namesFor(admin, "vendors", rows.map((r) => r.vendor_id)),
      namesFor(admin, "brands", rows.map((r) => r.brand_id)),
      getPublishedVersion(),
    ]);

    const lots: LineIdentityInput[] = rows.map((r) => {
      const id = identityForLot(r, {
        vendorName: r.vendor_id ? vendorNames.get(r.vendor_id) ?? null : null,
        brandName: r.brand_id ? brandNames.get(r.brand_id) ?? null : null,
        websiteCategory: websiteCategoryByLotId.get(r.id) ?? null,
      });
      return { lotId: r.id, posProductKey: r.pos_product_key, identityKey: id.identityKey, kb: id.kb };
    });

    const publishedKeys = new Set<string>();
    let liveIndex: Map<string, string[]> | undefined;
    if (published) {
      const keys = Array.from(new Set(rows.map((r) => r.pos_product_key).filter((k): k is string => Boolean(k))));
      if (keys.length > 0) {
        const { data: items, error: itemsErr } = await admin
          .from("menu_items")
          .select("source_item_id")
          .eq("menu_version_id", published.id)
          .in("source_item_id", keys);
        if (!itemsErr) for (const it of (items as { source_item_id: string }[] | null) ?? []) publishedKeys.add(it.source_item_id);
      }
      const vendorList = Array.from(
        new Set(Array.from(vendorNames.values()).filter((v): v is string => Boolean(v && v.trim()))),
      );
      if (vendorList.length > 0) {
        const { data: live, error: liveErr } = await admin
          .from("menu_items")
          .select(LIVE_MENU_IDENTITY_COLUMNS)
          .eq("menu_version_id", published.id)
          .in("vendor_name", vendorList)
          .range(0, LINE_IDENTITY_LIVE_CAP - 1);
        const liveRows = (live as unknown as LiveMenuRow[] | null) ?? [];
        if (!liveErr && liveRows.length < LINE_IDENTITY_LIVE_CAP) liveIndex = buildLiveIdentityIndex(liveRows);
      }
    }

    let kbRows: KbRowLite[] | undefined;
    const slugs = Array.from(new Set(lots.map((l) => l.kb?.product_slug).filter((s): s is string => Boolean(s))));
    if (slugs.length > 0) {
      const { data: kb, error: kbErr } = await admin.from("kb_products").select(KB_LINK_COLUMNS).in("product_slug", slugs);
      if (!kbErr) kbRows = (kb as unknown as KbRowLite[] | null) ?? [];
    } else {
      kbRows = [];
    }

    return planLineChips({ lots, publishedKeys, liveIndex, kbRows, hasPublishedMenu: Boolean(published) });
  } catch (err) {
    console.error("[line-identity] chip load failed (no chips shown):", err);
    return new Map();
  }
}
