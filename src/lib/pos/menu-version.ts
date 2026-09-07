/**
 * src/lib/pos/menu-version.ts
 *
 * Read helpers for menu versions: load a version's items, the current published
 * version, import history, and a diff between two versions (used by the import
 * review screen to show new / price-changed / removed products before publish).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
// SLICE 3: PostgREST caps every response at `db.max_rows` (1,000) and reports
// no error when it truncates. These helpers page with `.range()` until a short
// page proves the end of the data.
import { pagedAll, pagedAllChecked, chunkedIn, MENU_READ_CONCURRENCY } from "@/lib/supabase/chunked-in";
import type { ReadCompletenessVerdict } from "@/lib/supabase/read-completeness-core";
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

/**
 * List STAGED intake-origin menu versions (import_id IS NULL — auto-carried
 * from an accepted/approved manifest, not a POS-export upload). These are the
 * "menu drafts from receiving" a manager reviews + publishes without any
 * Cultivera Menu Imports upload.
 */
export async function listIntakeStagedVersions(limit = 30): Promise<MenuVersion[]> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("menu_versions")
      .select("*")
      .is("import_id", null)
      .eq("status", "staged")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      console.error("[menu-version] listIntakeStagedVersions error:", error.message);
      return [];
    }
    return (data as MenuVersion[] | null) ?? [];
  } catch (err) {
    console.error("[menu-version] listIntakeStagedVersions exception:", err);
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

/**
 * Diagnostics for an import.
 *
 * SLICE 3: paged. The publish COMMIT GATE calls this (via
 * `import-service.publishMenuVersion`) to count how many fact-review rows are
 * still awaiting a human decision. `.limit(5000)` was being passed in the
 * belief it raised the ceiling — it cannot; `.limit()` only ever lowers the
 * number of rows below PostgREST's `db.max_rows` (1,000). So a big import's
 * diagnostics were cut at 1,000, and the gate could see ZERO pending reviews
 * simply because the pending ones sat past the cap, and open the door to
 * publish. A safety gate that reads partial evidence is not a safety gate.
 *
 * `opts.limit` is preserved for the genuine "show me the first N" callers
 * (screens that page for display). When it is omitted, EVERY diagnostic is
 * returned.
 */
export async function getImportDiagnostics(
  importId: string,
  opts?: { severity?: string; limit?: number },
): Promise<PosImportDiagnostic[]> {
  try {
    const admin = createSupabaseAdminClient();
    const build = (from: number, to: number) => {
      let query = admin
        .from("pos_import_diagnostics")
        .select("*")
        .eq("import_id", importId)
        .order("severity", { ascending: true })
        // Stable tiebreaker: `severity` repeats heavily (most rows are
        // "warning"), so without a unique second key the pages are not a
        // deterministic partition of the set.
        .order("id", { ascending: true })
        .range(from, to);
      if (opts?.severity) query = query.eq("severity", opts.severity);
      return query;
    };

    // Caller asked for a bounded slice (a display screen) — honour it exactly.
    if (opts?.limit != null) {
      const { data, error } = await build(0, Math.max(0, opts.limit - 1));
      if (error) {
        console.error("[menu-version] getImportDiagnostics error:", error.message);
        return [];
      }
      return (data as PosImportDiagnostic[] | null) ?? [];
    }

    let failed = false;
    const rows = await pagedAll<PosImportDiagnostic>(async (from, to) => {
      const { data, error } = await build(from, to);
      if (error) {
        console.error("[menu-version] getImportDiagnostics error:", error.message);
        failed = true;
        return [];
      }
      return (data as PosImportDiagnostic[] | null) ?? [];
    });
    // Never hand the commit gate a half-read diagnostic set.
    return failed ? [] : rows;
  } catch (err) {
    console.error("[menu-version] getImportDiagnostics exception:", err);
    return [];
  }
}

/**
 * SLICE 6A: how many diagnostics does this import REALLY have?
 *
 * `count: "exact", head: true` is a server-side COUNT(*) -- it returns a
 * number, not rows, so PostgREST's `db.max_rows` ceiling cannot touch it.
 * Returns null for "witness unavailable", NEVER zero (an unusable count that
 * is coerced to 0 is how a truncated read gets excused as complete).
 */
export async function countImportDiagnostics(importId: string): Promise<number | null> {
  try {
    const admin = createSupabaseAdminClient();
    const { count, error } = await admin
      .from("pos_import_diagnostics")
      .select("id", { count: "exact", head: true })
      .eq("import_id", importId);
    if (error) {
      console.error("[menu-version] countImportDiagnostics error:", error.message);
      return null;
    }
    return typeof count === "number" ? count : null;
  } catch (err) {
    console.error("[menu-version] countImportDiagnostics exception:", err);
    return null;
  }
}

/** Hard stop for the diagnostics scan -- a runaway read fails loudly, not forever. */
export const DIAGNOSTICS_SCAN_MAX_ROWS = 200_000;

/**
 * SLICE 6A — THE READ THE FACT REVIEW SCREEN SHOULD ALWAYS HAVE USED.
 *
 * ═══ THE DEFECT THIS CLOSES (measured on the owner's Sep-1-2026 import) ═══
 *
 * Three display screens called `getImportDiagnostics(id, { limit: 5000 })`:
 *   - src/app/admin/menu-imports/[id]/facts/page.tsx        (Fact Review)
 *   - src/app/admin/menu-imports/[id]/facts/export/route.ts (CSV export)
 *   - src/app/admin/menu-imports/[id]/page.tsx              (Import Review)
 *
 * `.limit(5000)` cannot raise PostgREST's `db.max_rows` ceiling of 1,000 -- a
 * `.limit()` only ever LOWERS a result below it. So all three received exactly
 * 1,000 rows out of 6,603 and reported no error, because a capped read is not
 * an error.
 *
 * It compounded badly. `getImportDiagnostics` orders by `severity` ASC, and
 * `diagnostic_severity` is an ENUM declared ('error','warning','info')
 * (migration 0002_slice2_pos_import.sql:28). Enums sort in DECLARATION order,
 * so `info` sorts LAST. That import had 4,160 warnings -- more than the whole
 * ceiling by itself -- so the 1,000 rows the screens received were 100%
 * warnings and contained ZERO info rows.
 *
 * Two of the four review-feeding codes are `info` severity
 * (`fact_extraction_review` 488, `cannabinoid_missing` 257 = 745 of 764
 * review diagnostics). Result: the publish gate, which reads UNLIMITED, saw
 * 614 pending reviews and refused; the Fact Review screen, reading its capped
 * 1,000, could only ever show 11 and displayed "Queue clear". The owner was
 * told to go clear 604 rows that the clearing screen could not render, and no
 * product could reach the public website.
 *
 * This function pages EVERY diagnostic and returns a verdict saying whether
 * the read is provably whole, so a screen can say "this list is incomplete"
 * out loud instead of quietly showing a subset as if it were everything.
 */
export async function getImportDiagnosticsChecked(
  importId: string,
  opts?: { severity?: string },
): Promise<{ rows: PosImportDiagnostic[]; verdict: ReadCompletenessVerdict }> {
  // Independent witness first (best-effort -- an unavailable count stays null).
  let expectedTotal: number | null = null;
  if (!opts?.severity) expectedTotal = await countImportDiagnostics(importId);

  try {
    const admin = createSupabaseAdminClient();
    const { rows, verdict } = await pagedAllChecked<PosImportDiagnostic>(
      async (from, to) => {
        let query = admin
          .from("pos_import_diagnostics")
          .select("*")
          .eq("import_id", importId)
          // Stable, UNIQUE ordering. The old read ordered by `severity` first,
          // which put every `info` row behind 4,160 warnings and past the cap.
          // Paging needs a unique key to be a genuine partition anyway, and
          // ordering by id alone means no severity can be starved.
          .order("id", { ascending: true })
          .range(from, to);
        if (opts?.severity) query = query.eq("severity", opts.severity);
        const { data, error } = await query;
        if (error) {
          console.error("[menu-version] getImportDiagnosticsChecked error:", error.message);
          return { rows: [], ok: false };
        }
        return { rows: (data as PosImportDiagnostic[] | null) ?? [], ok: true };
      },
      { maxRows: DIAGNOSTICS_SCAN_MAX_ROWS, expectedTotal },
    );
    return { rows, verdict };
  } catch (err) {
    console.error("[menu-version] getImportDiagnosticsChecked exception:", err);
    return {
      rows: [],
      verdict: {
        complete: false,
        reason: "read_failed",
        rowsRead: 0,
        missing: null,
        message: "The diagnostics read failed, so this list is not the whole set.",
      },
    };
  }
}

/**
 * Load all items (with variants) for a version. Used by review + public reads.
 *
 * SLICE 3 — THE READ BEHIND THE CUSTOMER MENU.
 *
 * This function feeds `loadLiveMenuItems()` (the public /menu page), the admin
 * Products page, the syndication feed, the promotions simulator, AND the
 * publish commit gate. Before this slice it had NO pagination at all:
 *
 *   1. The `menu_items` read had no `.range()`, so PostgREST returned at most
 *      `db.max_rows` (1,000) rows and reported no error. A catalog larger than
 *      that was silently cut off at 1,000 EVERYWHERE this is called.
 *
 *   2. The variant read chunked item ids 200 at a time, but never paged WITHIN
 *      a chunk. 200 items can easily own more than 1,000 variants (each item
 *      commonly has several sizes), so variants were being dropped from the
 *      tail of a chunk — a product would render with some of its sizes missing
 *      and nothing anywhere would say so.
 *
 * Both reads now page to exhaustion. `pagedAll`/`chunkedIn` walk `.range()`
 * until a short page comes back, which is the only reliable end-of-data signal
 * when the server silently truncates.
 *
 * ORDERING: pagination is only correct against a STABLE, TOTAL order.
 * `sort_order` is not unique on its own (the importer assigns it per batch via
 * `start + idx`, and draft injection appends), so `id` is added as a
 * tiebreaker. Without it two rows sharing a `sort_order` could swap between
 * page requests and be duplicated or skipped.
 */
/**
 * SLICE 4A: server-side COUNT of the staged items in a version.
 *
 * `count: "exact", head: true` asks Postgres to COUNT(*) and return only the
 * number -- no rows travel back, so PostgREST's `db.max_rows` ceiling (the
 * cause of every silent truncation in SLICES 2-3) cannot apply. That makes it
 * an INDEPENDENT witness for the publish commit gate: it does not share a
 * failure mode with the paged read it corroborates.
 *
 * Returns `null` when the count is unavailable. Callers MUST treat null as
 * "this witness could not be consulted" and never as zero -- reporting zero
 * here would invent the very false confidence the gate exists to prevent.
 */
export async function countVersionItems(versionId: string): Promise<number | null> {
  try {
    const admin = createSupabaseAdminClient();
    const { count, error } = await admin
      .from("menu_items")
      .select("id", { count: "exact", head: true })
      .eq("menu_version_id", versionId);
    if (error) {
      console.error("[menu-version] countVersionItems error:", error.message);
      return null;
    }
    return typeof count === "number" ? count : null;
  } catch (err) {
    console.error("[menu-version] countVersionItems exception:", err);
    return null;
  }
}

export async function getVersionItems(versionId: string): Promise<MenuItemWithVariants[]> {
  try {
    const admin = createSupabaseAdminClient();
    let itemsFailed = false;
    const itemRows = await pagedAll<MenuItemRow>(async (from, to) => {
      const { data, error } = await admin
        .from("menu_items")
        .select("*")
        .eq("menu_version_id", versionId)
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);
      if (error) {
        console.error("[menu-version] getVersionItems items error:", error.message);
        itemsFailed = true;
        return [];
      }
      return (data as MenuItemRow[] | null) ?? [];
    });
    // A failed page must not masquerade as "the catalog ended here". Returning
    // a partial menu is exactly the silent truncation this slice exists to
    // remove, so a read error yields [] and is logged.
    if (itemsFailed) return [];
    if (itemRows.length === 0) return [];

    // Fetch variants for every item in this version, then group. chunkedIn()
    // splits the id list to keep the URL short AND pages within each chunk, so
    // an item-rich chunk can never lose its tail of variants.
    const itemIds = itemRows.map((i) => i.id);
    const variantsByItem = new Map<string, MenuVariantRow[]>();
    let variantsFailed = false;
    const variantRows = await chunkedIn<string, MenuVariantRow>(
      itemIds,
      async (chunk, from, to) => {
        const { data, error } = await admin
          .from("menu_variants")
          .select("*")
          .in("menu_item_id", chunk)
          .order("sort_order", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to);
        if (error) {
          console.error("[menu-version] getVersionItems variants error:", error.message);
          variantsFailed = true;
          return [];
        }
        return (data as MenuVariantRow[] | null) ?? [];
      },
      // SLICE D (performance): 23 serial round trips at 4,500 items, inside
      // the cached menu load, so every cache miss paid all of them in a row.
      //
      // SAFE DESPITE BEING A PRICE PATH. Chunks cover disjoint menu_item_ids
      // and every row is filed by its own v.menu_item_id below, so no
      // variant can land on the wrong item regardless of completion order.
      // chunkedIn additionally guarantees the returned array is identical to
      // the serial one. The variantsFailed guard is unchanged: any failed
      // page still fails the whole load rather than half-pricing an item.
      { chunkSize: 200, concurrency: MENU_READ_CONCURRENCY },
    );
    for (const v of variantRows) {
      const list = variantsByItem.get(v.menu_item_id) ?? [];
      list.push(v);
      variantsByItem.set(v.menu_item_id, list);
    }
    // Variants decide the PRICE a customer is shown. Serving an item whose
    // sizes only partly loaded would put a wrong price on the shelf, so a
    // variant read failure fails the whole load rather than half-pricing it.
    if (variantsFailed) return [];

    return itemRows.map((item) => ({ ...item, variants: variantsByItem.get(item.id) ?? [] }));
  } catch (err) {
    console.error("[menu-version] getVersionItems exception:", err);
    return [];
  }
}

/**
 * Lightweight per-version index of source_item_id -> { name, price, hidden }.
 *
 * SLICE 3: paged. This index backs `diffVersions()`, which powers the "new /
 * price-changed / removed" review screen shown before a publish. Capped at
 * 1,000 rows it would report products as REMOVED simply because they sat past
 * the cap in the previous version — a diff that invents deletions is worse
 * than no diff, because a manager would act on it.
 */
type VersionIndexRow = {
  source_item_id: string;
  name: string;
  brand_name: string;
  category: string;
  price_minor_units: number;
  hidden: boolean;
};

async function versionItemIndex(versionId: string) {
  const admin = createSupabaseAdminClient();
  const data = await pagedAll<VersionIndexRow>(async (from, to) => {
    const { data: page, error } = await admin
      .from("menu_items")
      .select("source_item_id, name, brand_name, category, price_minor_units, hidden")
      .eq("menu_version_id", versionId)
      .order("id", { ascending: true })
      .range(from, to);
    if (error) {
      console.error("[menu-version] versionItemIndex error:", error.message);
      return [];
    }
    return (page as VersionIndexRow[] | null) ?? [];
  });
  const map = new Map<
    string,
    { name: string; brand: string; category: string; price: number; hidden: boolean }
  >();
  for (const r of data) {
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

/**
 * SLICE 76 housekeeping — after a MANUAL publish succeeds, archive
 * intake-origin staged drafts that are OLDER than the version just published.
 * Each was built from an older live snapshot, so publishing one later would
 * silently DROP newer products (the exact trap the owner hit). Newer drafts
 * are left alone. Best-effort: failures log and never break the publish.
 */
export async function archiveStaleIntakeDrafts(publishedVersionId: string): Promise<number> {
  try {
    const admin = createSupabaseAdminClient();
    const { data: pub } = await admin
      .from("menu_versions")
      .select("id, created_at")
      .eq("id", publishedVersionId)
      .single();
    if (!pub) return 0;
    const { data, error } = await admin
      .from("menu_versions")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .is("import_id", null)
      .eq("status", "staged")
      .neq("id", publishedVersionId)
      .lt("created_at", (pub as { created_at: string }).created_at)
      .select("id");
    if (error) {
      console.error("[menu-version] archiveStaleIntakeDrafts error:", error.message);
      return 0;
    }
    return (data ?? []).length;
  } catch (err) {
    console.error("[menu-version] archiveStaleIntakeDrafts exception:", err);
    return 0;
  }
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
