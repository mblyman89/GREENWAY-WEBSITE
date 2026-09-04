/**
 * src/lib/inventory/classification-worklist-store.ts   (SLICE 18A)
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The server-side assembler behind the sales-limit classification worklist.
 *
 * It does the four reads the pure core cannot do, then hands the result to
 * classification-worklist-core.ts, which owns every decision about grouping,
 * ordering and filtering:
 *
 *   1. every ACTIVE inventory lot (paged, and PROVABLY complete — see below)
 *   2. which of those lots came from the one-time Cultivera import
 *   3. the effective website category for each lot (override → menu → type map)
 *   4. the menu-side classification flags, joined by pos_product_key
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THE READ MUST PROVE IT WAS COMPLETE
 *
 * `listLots()` caps at 500 rows (store.ts:177) and PostgREST silently truncates
 * at db.max_rows (1,000) regardless. On a ~3,800-lot catalog either ceiling
 * quietly drops most of the inventory.
 *
 * For a browsing screen that is a nuisance. For THIS screen it is a lie with a
 * legal edge: the page would print "0 products need classifying", the owner
 * would reasonably read that as an all-clear, and the unclassified suppository
 * would be sitting in row 2,300 where nothing ever looked. A compliance list
 * that silently under-reports is worse than no list, because it manufactures
 * false confidence.
 *
 * So this uses `pagedAllChecked`, which reports whether the read actually
 * finished, and the page states plainly when it did not. Rule: never print a
 * reassuring number we cannot stand behind.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY SCOPE IS "ACTIVE" LOTS
 *
 * Identical to every SLICE 7 gap (lot-gap-core.ts:48-55): destroyed, recalled
 * and sold-out lots cannot be sold, so their classification cannot break a
 * limit. Listing them would bury the rows that still matter.
 * ────────────────────────────────────────────────────────────────────────────
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";
import { resolveWebsiteCategories } from "@/lib/inventory/website-category-resolver-server";
import { getMenuClassificationFlags } from "@/lib/inventory/classification-status-store";
import {
  buildClassificationWorklist,
  type ClassificationWorklistEntry,
  type WorklistLotInput,
} from "@/lib/inventory/classification-worklist-core";

/**
 * The manifest_number prefix the Cultivera migration stamps on its synthetic
 * manifest (import-service.ts:519: `POS-IMPORT-${importId.slice(0, 8)}`).
 *
 * This is the ONLY durable discriminator between the two doors. Both doors
 * write real `inventory_lots` rows with a `manifest_id`, and SLICE 58
 * deliberately gave the migration manifest the same lifecycle fingerprint as a
 * native delivery ("nothing downstream can tell an imported manifest from a
 * native one", import-service.ts:512-514) — so status, timestamps and events
 * cannot tell them apart. The manifest NUMBER can.
 *
 * Used ONLY to power the optional source filter. It never affects whether a
 * product is in scope, and never affects its status. If this prefix ever
 * changed, the worklist would still list every product; only the "From
 * Cultivera import" tab would mis-sort.
 */
const IMPORT_MANIFEST_PREFIX = "POS-IMPORT-";

type LotRow = {
  id: string;
  pos_product_key: string | null;
  product_name: string | null;
  inventory_type: string | null;
  category: string | null;
  on_hand_qty: number | string | null;
  manifest_id: string | null;
  vendor_id: string | null;
};

export type ClassificationWorklistData = {
  entries: ClassificationWorklistEntry[];
  /**
   * False when the lot read did not provably finish. The page MUST disclose
   * this instead of printing a total as if it were the whole truth.
   */
  complete: boolean;
  /**
   * The verdict's plain-English explanation when the read fell short, so the
   * page can say WHAT went wrong rather than a vague "something failed".
   * Null when the read was complete.
   */
  incompleteMessage: string | null;
  /** How many active lots were actually examined. */
  lotsScanned: number;
  /** True when Supabase isn't configured — "unknown", not "all clear". */
  configured: boolean;
};

/**
 * numeric(10,3) arrives from PostgREST as a STRING. Unparseable reads as 0 for
 * an on-hand quantity specifically, because this figure is only ever used to
 * report how much stock an answer affects — never to enforce anything.
 */
function toQty(v: number | string | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Build the whole worklist.
 *
 * Reads are batched, not per-row: `resolveWebsiteCategories` does its three
 * lookups in one pass and `getMenuClassificationFlags` chunks its key list, so
 * a 3,800-lot catalog costs a bounded number of round trips rather than 3,800.
 */
export async function getClassificationWorklist(): Promise<ClassificationWorklistData> {
  if (!isSupabaseServiceConfigured) {
    // Not "there is no work" — "we could not look". The page says so.
    return {
      entries: [],
      complete: false,
      incompleteMessage:
        "Supabase is not configured in this environment, so no inventory could be read. This is not an all-clear.",
      lotsScanned: 0,
      configured: false,
    };
  }

  const admin = createSupabaseAdminClient();

  // ── 1. every ACTIVE lot, paged, with completeness reported ───────────────
  // Ordered by a UNIQUE column (`id`). Paging an unstable order can repeat or
  // skip rows between requests, which would corrupt the list more subtly than
  // truncating it: a skipped product simply never appears, and nothing looks
  // wrong.
  const lotPage = await pagedAllChecked<LotRow>(async (from, to) => {
    const { data, error } = await admin
      .from("inventory_lots")
      .select("id, pos_product_key, product_name, inventory_type, category, on_hand_qty, manifest_id, vendor_id")
      .eq("status", "active")
      .order("id", { ascending: true })
      .range(from, to);
    if (error) {
      console.error("[classification-worklist] lot read failed:", error.message);
      return { rows: [], ok: false };
    }
    return { rows: (data as LotRow[] | null) ?? [], ok: true };
  });

  const lotRows = lotPage.rows;
  const incompleteMessage = lotPage.verdict.complete ? null : lotPage.verdict.message;
  if (lotRows.length === 0) {
    return {
      entries: [],
      complete: lotPage.verdict.complete,
      incompleteMessage,
      lotsScanned: 0,
      configured: true,
    };
  }

  // ── 2. which manifests are the Cultivera migration ──────────────────────
  const manifestIds = [...new Set(lotRows.map((l) => l.manifest_id).filter((m): m is string => !!m))];
  const importManifestIds = new Set<string>();
  if (manifestIds.length > 0) {
    // `.like()` on the prefix keeps the filter in the database rather than
    // pulling every manifest back to compare in JS.
    const { data, error } = await admin
      .from("inbound_manifests")
      .select("id")
      .in("id", manifestIds)
      .like("manifest_number", `${IMPORT_MANIFEST_PREFIX}%`);
    if (error) {
      // Degrade to "unknown provenance" rather than failing the page. Every
      // product still appears; only the source TAB loses precision, and the
      // default view is source-agnostic anyway.
      console.error("[classification-worklist] manifest read failed:", error.message);
    } else {
      for (const row of (data as { id: string }[] | null) ?? []) importManifestIds.add(row.id);
    }
  }

  // ── 3. effective website category per lot ───────────────────────────────
  const resolutions = await resolveWebsiteCategories(
    lotRows.map((l) => ({
      posProductKey: l.pos_product_key,
      category: l.category,
      inventoryType: l.inventory_type,
      productName: l.product_name,
    })),
  );

  const inputs: WorklistLotInput[] = lotRows.map((l, i) => ({
    lotId: l.id,
    posProductKey: l.pos_product_key,
    productName: l.product_name,
    inventoryType: l.inventory_type,
    resolvedWebsiteCategory: resolutions[i]?.websiteCategory ?? null,
    vendorName: null,
    onHandQty: toQty(l.on_hand_qty),
    fromImport: l.manifest_id ? importManifestIds.has(l.manifest_id) : false,
  }));

  // ── 4. menu truth, joined by pos_product_key ────────────────────────────
  // THE decisive read. Status comes from here and nowhere else, because
  // menu_items is the only surface the register enforces from
  // (live-menu.ts:94-100) and the Cultivera importer writes none of the four
  // flags onto the lot row (import-service.ts:588-616).
  const flags = await getMenuClassificationFlags(inputs.map((l) => l.posProductKey));

  return {
    entries: buildClassificationWorklist(inputs, flags),
    complete: lotPage.verdict.complete,
    incompleteMessage,
    lotsScanned: lotRows.length,
    configured: true,
  };
}
