/**
 * src/lib/inventory/restock-preview-server.ts  (S19)
 *
 * SERVER reads for vendor-id identity - the ONLY place S19 touches the
 * database. Two callers, one rule:
 *   - loadVendorIdInputs: the staging executor (intake-menu-staging.ts) asks
 *     for the vendor ids of the few lots that could change a restock match;
 *   - loadRestockPreview: Product Onboarding asks what Approve WILL do for
 *     the focused delivery's rows (bible S19.2 "Preview").
 *
 * BOUNDED, NAMED, NEVER GUESSED:
 *   - Every read names its columns (no select("*")) and pages with .range()
 *     through chunkedIn / pagedAllChecked, because PostgREST silently caps an
 *     un-ranged read at db.max_rows (1,000).
 *   - The lot keys asked about come from planVendorIdLookup (pure): only the
 *     rows' own lots and the lots of live cards whose category axis + family
 *     match SOME row - never the whole store. More than
 *     VENDOR_ID_LIVE_KEY_CAP live keys -> no ids at all.
 *   - ANY failed read -> undefined = the pre-S19 name rule, byte for byte.
 *     A partial id set is never used (it could flip a match on missing data).
 *   - The preview's live-card read is capped (PREVIEW_LIVE_CARD_CAP); hitting
 *     the cap or a failed page says so on screen (previewUnavailableCopy)
 *     instead of showing a verdict built on part of the menu.
 *
 * No writes. No new egress (Supabase only, the same client every admin page
 * uses). No polling: one bounded set of reads per page render / per staging.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { chunkedIn, pagedAllChecked } from "@/lib/supabase/chunked-in";
import {
  PACK_CATEGORY_AXIS,
  buildVendorIdInputs,
  groupingCategoryAxis,
  planVendorIdLookup,
  previewRestockVerdicts,
  type LiveCardCandidate,
  type RestockPreviewDraft,
} from "@/lib/pos/intake-mastering-core";
import {
  VENDOR_ID_IDENTITY_ENV,
  vendorIdIdentityEnabled,
  type RestockVerdict,
  type VendorIdInputs,
} from "@/lib/inventory/vendor-identity-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/** The two columns a vendor-id read needs (inventory_lots, migration 0023). */
export const LOT_VENDOR_COLUMNS = "pos_product_key, vendor_id";
/** The live-card columns the preview needs (menu_items). */
export const PREVIEW_ITEM_COLUMNS = "id, source_item_id, name, brand_name, vendor_name, category, strain_name, hidden";
/** The variant columns the preview needs (menu_variants). */
export const PREVIEW_VARIANT_COLUMNS = "menu_item_id, source_variant_id, medical";
/** Most live cards one preview reads (3 pages); more = "too many to preview". */
export const PREVIEW_LIVE_CARD_CAP = 3000;

type LotVendorRow = { pos_product_key: string | null; vendor_id: string | null };

/** Every lot row for these keys (paged per chunk); null when any page failed. */
async function readLotVendors(admin: Admin, keys: string[]): Promise<LotVendorRow[] | null> {
  if (keys.length === 0) return [];
  let failed = false;
  const rows = await chunkedIn<string, LotVendorRow>(keys, async (chunk, from, to) => {
    const { data, error } = await admin
      .from("inventory_lots")
      .select(LOT_VENDOR_COLUMNS)
      .in("pos_product_key", chunk)
      .order("id", { ascending: true })
      .range(from, to);
    if (error) {
      console.error("[restock-preview] lot vendor read failed (name rule used):", error.message);
      failed = true;
      return [];
    }
    return (data as unknown as LotVendorRow[] | null) ?? [];
  });
  return failed ? null : rows;
}

/**
 * The vendor ids the restock match may use, or undefined (= the name rule).
 * Caller decides the flag; this never reads when there is nothing to ask.
 */
export async function loadVendorIdInputs(
  admin: Admin,
  input: { drafts: RestockPreviewDraft[]; liveCards: LiveCardCandidate[] },
): Promise<VendorIdInputs | undefined> {
  try {
    const plan = planVendorIdLookup(input);
    if (plan.draftLotKeys.length === 0 || plan.liveLotKeys.length === 0 || plan.overCap) return undefined;
    const draftLots = await readLotVendors(admin, plan.draftLotKeys);
    if (!draftLots) return undefined;
    const liveLots = await readLotVendors(admin, plan.liveLotKeys);
    if (!liveLots) return undefined;
    return buildVendorIdInputs({ draftLots, liveLots });
  } catch (err) {
    console.error("[restock-preview] vendor id lookup threw (name rule used):", err);
    return undefined;
  }
}

/** Every category that shares a grouping axis with one of these (packs fold). */
export function previewCategories(categories: Array<string | null | undefined>): string[] {
  const axes = new Set<string>();
  for (const c of categories) {
    const t = c?.trim();
    if (t) axes.add(groupingCategoryAxis(t));
  }
  const out = new Set<string>(axes);
  for (const [pack, single] of Object.entries(PACK_CATEGORY_AXIS)) if (axes.has(single)) out.add(pack);
  return [...out].sort();
}

export type RestockPreviewResult =
  | { ok: true; verdicts: Map<string, RestockVerdict>; matchedByVendorId: boolean }
  | { ok: false; reason: "flag_off" | "read_incomplete" | "too_many" };

type PreviewItemRow = {
  id: string;
  source_item_id: string;
  name: string;
  brand_name: string | null;
  vendor_name: string | null;
  category: string;
  strain_name: string | null;
  hidden: boolean | null;
};
type PreviewVariantRow = { menu_item_id: string; source_variant_id: string; medical: boolean | null };

/**
 * S19.2 Preview for one delivery's rows: what Approve will do, from the SAME
 * pure planner the staging uses (previewRestockVerdicts). Nothing live yet ->
 * every usable row is "New card" (true: there is no card to join).
 */
export async function loadRestockPreview(drafts: RestockPreviewDraft[]): Promise<RestockPreviewResult> {
  if (!vendorIdIdentityEnabled(process.env[VENDOR_ID_IDENTITY_ENV])) return { ok: false, reason: "flag_off" };
  const categories = previewCategories(drafts.map((d) => d.category));
  if (categories.length === 0) return { ok: true, verdicts: new Map(), matchedByVendorId: false };
  try {
    const admin = createSupabaseAdminClient();
    const { data: pub, error: pErr } = await admin
      .from("menu_versions")
      .select("id")
      .eq("status", "published")
      .limit(1)
      .maybeSingle();
    if (pErr) {
      console.error("[restock-preview] published version read failed:", pErr.message);
      return { ok: false, reason: "read_incomplete" };
    }
    const publishedId = (pub as { id: string } | null)?.id ?? null;
    if (!publishedId) {
      return { ok: true, verdicts: previewRestockVerdicts({ drafts, liveCards: [] }), matchedByVendorId: false };
    }

    const items = await pagedAllChecked<PreviewItemRow>(
      async (from, to) => {
        const { data, error } = await admin
          .from("menu_items")
          .select(PREVIEW_ITEM_COLUMNS)
          .eq("menu_version_id", publishedId)
          .in("category", categories)
          .order("id", { ascending: true })
          .range(from, to);
        if (error) console.error("[restock-preview] live card read failed:", error.message);
        return { rows: (data as unknown as PreviewItemRow[] | null) ?? [], ok: !error };
      },
      { maxRows: PREVIEW_LIVE_CARD_CAP },
    );
    if (!items.verdict.complete) {
      return { ok: false, reason: items.verdict.reason === "limit_reached" ? "too_many" : "read_incomplete" };
    }

    let variantsFailed = false;
    const variants = await chunkedIn<string, PreviewVariantRow>(
      items.rows.map((r) => r.id),
      async (chunk, from, to) => {
        const { data, error } = await admin
          .from("menu_variants")
          .select(PREVIEW_VARIANT_COLUMNS)
          .in("menu_item_id", chunk)
          .order("id", { ascending: true })
          .range(from, to);
        if (error) {
          console.error("[restock-preview] live variant read failed:", error.message);
          variantsFailed = true;
          return [];
        }
        return (data as unknown as PreviewVariantRow[] | null) ?? [];
      },
    );
    if (variantsFailed) return { ok: false, reason: "read_incomplete" };

    const byItem = new Map<string, { source_variant_id: string; medical: boolean }[]>();
    for (const v of variants) {
      const list = byItem.get(v.menu_item_id) ?? [];
      list.push({ source_variant_id: v.source_variant_id, medical: v.medical === true });
      byItem.set(v.menu_item_id, list);
    }
    const liveCards: LiveCardCandidate[] = items.rows.map((r) => ({
      source_item_id: r.source_item_id,
      name: r.name,
      brand_name: r.brand_name ?? "",
      vendor_name: r.vendor_name,
      category: r.category,
      strain_name: r.strain_name,
      hidden: r.hidden === true,
      variants: byItem.get(r.id) ?? [],
    }));
    const vendorIds = await loadVendorIdInputs(admin, { drafts, liveCards });
    const verdicts = previewRestockVerdicts({ drafts, liveCards, vendorIds });
    return { ok: true, verdicts, matchedByVendorId: Boolean(vendorIds) };
  } catch (err) {
    console.error("[restock-preview] preview failed (display unaffected):", err);
    return { ok: false, reason: "read_incomplete" };
  }
}
