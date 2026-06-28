/**
 * src/lib/pos/menu-version.ts
 *
 * Read helpers for menu versions: load a version's items, the current published
 * version, import history, and a diff between two versions (used by the import
 * review screen to show new / price-changed / removed products before publish).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type {
  MenuItemRow,
  MenuVariantRow,
  MenuVersion,
  PosImport,
  PosImportDiagnostic,
} from "@/lib/pos/db-types";

export type MenuItemWithVariants = MenuItemRow & { variants: MenuVariantRow[] };

export async function getPublishedVersion(): Promise<MenuVersion | null> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("menu_versions")
      .select("*")
      .eq("status", "published")
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error("[menu-version] getPublishedVersion error:", error.message);
      return null;
    }
    return (data as MenuVersion | null) ?? null;
  } catch (err) {
    console.error("[menu-version] getPublishedVersion exception:", err);
    return null;
  }
}

export async function getVersion(versionId: string): Promise<MenuVersion | null> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("menu_versions")
      .select("*")
      .eq("id", versionId)
      .maybeSingle();
    if (error) {
      console.error("[menu-version] getVersion error:", error.message);
      return null;
    }
    return (data as MenuVersion | null) ?? null;
  } catch (err) {
    console.error("[menu-version] getVersion exception:", err);
    return null;
  }
}

export async function listVersions(limit = 50): Promise<MenuVersion[]> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("menu_versions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      console.error("[menu-version] listVersions error:", error.message);
      return [];
    }
    return (data as MenuVersion[] | null) ?? [];
  } catch (err) {
    console.error("[menu-version] listVersions exception:", err);
    return [];
  }
}

export async function listImports(limit = 50): Promise<PosImport[]> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("pos_imports")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      console.error("[menu-version] listImports error:", error.message);
      return [];
    }
    return (data as PosImport[] | null) ?? [];
  } catch (err) {
    console.error("[menu-version] listImports exception:", err);
    return [];
  }
}

export async function getImport(importId: string): Promise<PosImport | null> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("pos_imports")
      .select("*")
      .eq("id", importId)
      .maybeSingle();
    if (error) {
      console.error("[menu-version] getImport error:", error.message);
      return null;
    }
    return (data as PosImport | null) ?? null;
  } catch (err) {
    console.error("[menu-version] getImport exception:", err);
    return null;
  }
}

export async function getImportDiagnostics(
  importId: string,
  opts?: { severity?: string; limit?: number },
): Promise<PosImportDiagnostic[]> {
  try {
    const admin = createSupabaseAdminClient();
    let query = admin
      .from("pos_import_diagnostics")
      .select("*")
      .eq("import_id", importId)
      .order("severity", { ascending: true })
      .limit(opts?.limit ?? 1000);
    if (opts?.severity) query = query.eq("severity", opts.severity);
    const { data, error } = await query;
    if (error) {
      console.error("[menu-version] getImportDiagnostics error:", error.message);
      return [];
    }
    return (data as PosImportDiagnostic[] | null) ?? [];
  } catch (err) {
    console.error("[menu-version] getImportDiagnostics exception:", err);
    return [];
  }
}

/** Load all items (with variants) for a version. Used by review + public reads. */
export async function getVersionItems(versionId: string): Promise<MenuItemWithVariants[]> {
  try {
    const admin = createSupabaseAdminClient();
    const { data: items, error: itemsError } = await admin
      .from("menu_items")
      .select("*")
      .eq("menu_version_id", versionId)
      .order("sort_order", { ascending: true });
    if (itemsError) {
      console.error("[menu-version] getVersionItems items error:", itemsError.message);
      return [];
    }
    const itemRows = (items as MenuItemRow[] | null) ?? [];
    if (itemRows.length === 0) return [];

    // Fetch variants for all items in this version in one query, then group.
    const itemIds = itemRows.map((i) => i.id);
    const variantsByItem = new Map<string, MenuVariantRow[]>();
    // Supabase .in() handles large lists; chunk to stay well under URL limits.
    const CHUNK = 200;
    for (let i = 0; i < itemIds.length; i += CHUNK) {
      const slice = itemIds.slice(i, i + CHUNK);
      const { data: variants, error: variantsError } = await admin
        .from("menu_variants")
        .select("*")
        .in("menu_item_id", slice)
        .order("sort_order", { ascending: true });
      if (variantsError) {
        console.error("[menu-version] getVersionItems variants error:", variantsError.message);
        continue;
      }
      for (const v of (variants as MenuVariantRow[] | null) ?? []) {
        const list = variantsByItem.get(v.menu_item_id) ?? [];
        list.push(v);
        variantsByItem.set(v.menu_item_id, list);
      }
    }

    return itemRows.map((item) => ({ ...item, variants: variantsByItem.get(item.id) ?? [] }));
  } catch (err) {
    console.error("[menu-version] getVersionItems exception:", err);
    return [];
  }
}

/** Lightweight per-version index of source_item_id -> { name, price, hidden }. */
async function versionItemIndex(versionId: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("menu_items")
    .select("source_item_id, name, brand_name, category, price_minor_units, hidden")
    .eq("menu_version_id", versionId);
  if (error) {
    console.error("[menu-version] versionItemIndex error:", error.message);
  }
  const map = new Map<
    string,
    { name: string; brand: string; category: string; price: number; hidden: boolean }
  >();
  for (const r of (data as
    | {
        source_item_id: string;
        name: string;
        brand_name: string;
        category: string;
        price_minor_units: number;
        hidden: boolean;
      }[]
    | null) ?? []) {
    map.set(r.source_item_id, {
      name: r.name,
      brand: r.brand_name,
      category: r.category,
      price: r.price_minor_units,
      hidden: r.hidden,
    });
  }
  return map;
}

export type MenuDiffEntry = {
  sourceId: string;
  name: string;
  brand: string;
  category: string;
  oldPrice?: number;
  newPrice?: number;
};

export type MenuDiff = {
  added: MenuDiffEntry[];
  removed: MenuDiffEntry[];
  priceChanged: MenuDiffEntry[];
  unchangedCount: number;
};

/**
 * Diff a staged version against the currently-published one (or any base
 * version). Returns added / removed / price-changed products so a manager can
 * see exactly what publishing this version will do.
 */
export async function diffVersions(stagedId: string, baseId: string | null): Promise<MenuDiff> {
  try {
    return await diffVersionsInner(stagedId, baseId);
  } catch (err) {
    console.error("[menu-version] diffVersions exception:", err);
    return { added: [], removed: [], priceChanged: [], unchangedCount: 0 };
  }
}

async function diffVersionsInner(stagedId: string, baseId: string | null): Promise<MenuDiff> {
  const staged = await versionItemIndex(stagedId);
  const base = baseId ? await versionItemIndex(baseId) : new Map<string, never>();

  const added: MenuDiffEntry[] = [];
  const removed: MenuDiffEntry[] = [];
  const priceChanged: MenuDiffEntry[] = [];
  let unchangedCount = 0;

  for (const [sourceId, s] of staged) {
    const b = base.get(sourceId);
    if (!b) {
      added.push({ sourceId, name: s.name, brand: s.brand, category: s.category, newPrice: s.price });
    } else if (b.price !== s.price) {
      priceChanged.push({
        sourceId,
        name: s.name,
        brand: s.brand,
        category: s.category,
        oldPrice: b.price,
        newPrice: s.price,
      });
    } else {
      unchangedCount += 1;
    }
  }
  for (const [sourceId, b] of base) {
    if (!staged.has(sourceId)) {
      removed.push({ sourceId, name: b.name, brand: b.brand, category: b.category, oldPrice: b.price });
    }
  }

  added.sort((a, z) => a.name.localeCompare(z.name));
  removed.sort((a, z) => a.name.localeCompare(z.name));
  priceChanged.sort((a, z) => a.name.localeCompare(z.name));

  return { added, removed, priceChanged, unchangedCount };
}

/**
 * Fetch a single menu item (with variants) from a version by its stable POS
 * source key. Used by the product enrichment editor.
 */
export async function getItemBySourceKey(
  versionId: string,
  sourceItemId: string,
): Promise<MenuItemWithVariants | null> {
  try {
    const admin = createSupabaseAdminClient();
    const { data: item, error: itemError } = await admin
      .from("menu_items")
      .select("*")
      .eq("menu_version_id", versionId)
      .eq("source_item_id", sourceItemId)
      .maybeSingle();
    if (itemError) {
      console.error("[menu-version] getItemBySourceKey item error:", itemError.message);
      return null;
    }
    if (!item) return null;
    const row = item as MenuItemRow;
    const { data: variants, error: variantsError } = await admin
      .from("menu_variants")
      .select("*")
      .eq("menu_item_id", row.id)
      .order("sort_order", { ascending: true });
    if (variantsError) {
      console.error("[menu-version] getItemBySourceKey variants error:", variantsError.message);
    }
    return { ...row, variants: (variants as MenuVariantRow[] | null) ?? [] };
  } catch (err) {
    console.error("[menu-version] getItemBySourceKey exception:", err);
    return null;
  }
}
