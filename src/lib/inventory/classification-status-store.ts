/**
 * src/lib/inventory/classification-status-store.ts   (SLICE 18A)
 *
 * ───────────────────────────────────────────────────────────────────────────
 * READS the compliance-classification truth for a set of products, and WRITES
 * a correction through to the surface that actually enforces it.
 *
 * WHY THIS FILE READS `menu_items` AND NOT `inventory_lots`
 *
 * The register enforces from the MENU row (live-menu.ts:94-100). Nothing reads
 * the four flags back off `inventory_lots` to decide a limit — grep proves it.
 *
 * Meanwhile the two doors write to different places:
 *   - fact review (Cultivera)  -> menu_items only   (fact-review-store.ts:122)
 *   - intake/onboarding (18-0) -> inventory_lots, then menu_items at approval
 *
 * And the Cultivera lot insert (import-service.ts:588-616) writes NONE of the
 * four flags, so every imported lot has NULL lot-flags regardless of whether a
 * human already classified it in fact review.
 *
 * Therefore a worklist built on the LOT columns would list every imported
 * product forever, including the ones already settled. That is the "nag about
 * finished work" failure 18-0 removed from the receiving dock, and re-adding
 * it across ~3,800 products would be worse: staff would learn, correctly, that
 * the compliance list is noise.
 *
 * So the menu row is the source of truth here. The lot row is provenance.
 *
 * GRACEFUL DEGRADATION, like every other store in this repo: unconfigured
 * Supabase or a pre-migration database returns "nothing known" rather than
 * throwing into a page render.
 * ───────────────────────────────────────────────────────────────────────────
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
// SLICE 3 doctrine: PostgREST silently truncates at db.max_rows (1,000), so
// every multi-key read goes through the chunked+paged helper.
import { chunkedIn } from "@/lib/supabase/chunked-in";
import { getPublishedVersion, listIntakeStagedVersions } from "@/lib/pos/menu-version";

/** The four enforcement flags as stored on a menu row. */
export type MenuClassificationFlags = {
  otherwiseTaken: boolean | null;
  unitsPerPackage: number | null;
  lowThcLiquid: boolean | null;
  unitThcMg: number | null;
};

type MenuFlagRow = {
  source_item_id: string;
  low_thc_liquid: boolean | null;
  unit_thc_mg: number | string | null;
  otherwise_taken: boolean | null;
  units_per_package: number | string | null;
};

/**
 * Postgres "relation/column does not exist" — the migration hasn't run here.
 * Mirrors product-classification-overrides.ts:29-35 so every store in this
 * area recognises a pre-migration database the same way.
 */
function isMissingSchema(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return (
    err.code === "42P01" ||
    err.code === "42703" ||
    /relation .* does not exist|column .* does not exist|could not find the .* column|schema cache/i.test(
      err.message ?? "",
    )
  );
}

/**
 * numeric(10,3) comes back from PostgREST as a STRING, not a number.
 *
 * This is not pedantry: `"5" > 4` is true in JS but `"5" > 4` after a bad parse
 * could be `NaN > 4` = false, which would silently hide a low-THC
 * contradiction. Parse explicitly, and treat unparseable as UNKNOWN rather
 * than as zero — zero would read as a valid 0 mg claim.
 */
function toNum(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Read the classification flags for many products at once, keyed by
 * pos_product_key (=== menu_items.source_item_id; the identity that holds for
 * BOTH import and intake products — price-write-store.ts:70-77 documents why).
 *
 * Reads the PUBLISHED menu version, because that is the one the register and
 * the website are actually serving. A staged version's answer is not yet in
 * force, and reporting it as the truth would tell the owner a product is
 * classified when the register still isn't enforcing it.
 *
 * Returns an empty map on any failure so a page can still render; callers
 * treat "absent" as "unknown", which is the safe reading everywhere.
 */
export async function getMenuClassificationFlags(
  keys: Array<string | null | undefined>,
): Promise<Map<string, MenuClassificationFlags>> {
  const out = new Map<string, MenuClassificationFlags>();
  const unique = Array.from(
    new Set(keys.filter((k): k is string => typeof k === "string" && k.trim().length > 0)),
  );
  if (!isSupabaseServiceConfigured || unique.length === 0) return out;

  try {
    const published = await getPublishedVersion();
    if (!published) return out;

    const admin = createSupabaseAdminClient();
    let failed = false;
    // chunkedIn is (ids, fetchPage(chunk, from, to), opts) — the `.range()`
    // paging is NOT optional. A 300-key chunk can match more rows than
    // PostgREST's 1,000-row ceiling, which is enforced silently, so a product
    // late in the list would come back "unclassified" and land on the worklist
    // even though a human had already answered it.
    const rows = await chunkedIn<string, MenuFlagRow>(
      unique,
      async (chunk, from, to) => {
        const { data, error } = await admin
          .from("menu_items")
          .select(
            "source_item_id, low_thc_liquid, unit_thc_mg, otherwise_taken, units_per_package",
          )
          .eq("menu_version_id", published.id)
          .in("source_item_id", chunk)
          .order("source_item_id", { ascending: true })
          .range(from, to);
        if (error) {
          // A pre-0216/0217 database has no such columns. That is a known,
          // recoverable state — degrade to "nothing known" rather than break
          // the inventory page.
          if (!isMissingSchema(error)) {
            console.error("[classification-status] read error:", error.message);
          }
          failed = true;
          return [];
        }
        return (data as MenuFlagRow[] | null) ?? [];
      },
      { chunkSize: 300 },
    );
    if (failed) return out;

    for (const r of rows) {
      if (!r.source_item_id) continue;
      out.set(r.source_item_id, {
        otherwiseTaken: r.otherwise_taken ?? null,
        unitsPerPackage: toNum(r.units_per_package),
        lowThcLiquid: r.low_thc_liquid ?? null,
        unitThcMg: toNum(r.unit_thc_mg),
      });
    }
    return out;
  } catch (err) {
    console.error("[classification-status] read exception:", err);
    return out;
  }
}

export type ClassificationWriteResult =
  | { ok: true; versionsUpdated: number; rowsUpdated: number }
  | { ok: false; error: string };

/**
 * Write a classification correction through to every menu version that
 * matters: the PUBLISHED one (so the register changes immediately — the
 * owner's standing instruction for price corrections, applied to the same
 * shape of problem) plus any staged intake versions (so a pending publish
 * doesn't silently revert the fix).
 *
 * DELIBERATELY writes the whole set of four columns every time, including
 * nulls. A partial update would let a product keep a stale `unit_thc_mg` from
 * a previous answer after being re-classified as not-low-THC, and that orphan
 * number is exactly what a later reader would trust.
 *
 * Never throws: returns { ok:false, error } with a sentence a human can act
 * on, matching applyLotAfterTaxPrice()'s contract (price-write-store.ts:259).
 */
export async function applyClassificationToMenu(
  posProductKey: string,
  flags: MenuClassificationFlags,
): Promise<ClassificationWriteResult> {
  const key = (posProductKey ?? "").trim();
  if (!key) {
    return {
      ok: false,
      error:
        "This lot isn't linked to a POS product key yet, so there's no menu listing to classify. The link is made automatically when the product goes onto the menu.",
    };
  }
  if (!isSupabaseServiceConfigured) {
    return {
      ok: false,
      error: "The menu database isn't configured in this environment, so the change can't be saved.",
    };
  }

  try {
    const admin = createSupabaseAdminClient();
    const [published, staged] = await Promise.all([
      getPublishedVersion(),
      listIntakeStagedVersions(30),
    ]);

    const versionIds = [
      ...(published ? [published.id] : []),
      ...staged.map((v) => v.id),
    ];
    if (versionIds.length === 0) {
      return {
        ok: false,
        error:
          "There's no live menu yet, so there's nothing to classify. Publish the menu first, then set the classification here.",
      };
    }

    const update = {
      otherwise_taken: flags.otherwiseTaken,
      units_per_package: flags.unitsPerPackage,
      low_thc_liquid: flags.lowThcLiquid,
      unit_thc_mg: flags.unitThcMg,
    };

    let versionsUpdated = 0;
    let rowsUpdated = 0;
    for (const versionId of versionIds) {
      const { data, error } = await admin
        .from("menu_items")
        .update(update)
        .eq("menu_version_id", versionId)
        .eq("source_item_id", key)
        .select("id");
      if (error) {
        if (isMissingSchema(error)) {
          return {
            ok: false,
            error:
              "The compliance columns aren't in the database yet. Apply migration 0216 and 0217 in Supabase, then try again.",
          };
        }
        return { ok: false, error: `Saving the classification failed: ${error.message}` };
      }
      const n = ((data as { id: string }[] | null) ?? []).length;
      if (n > 0) {
        versionsUpdated += 1;
        rowsUpdated += n;
      }
    }

    if (rowsUpdated === 0) {
      return {
        ok: false,
        error:
          "Couldn't find this product on the live menu. A classification only sticks once the product is published to the menu — publish it first, then set it here.",
      };
    }
    return { ok: true, versionsUpdated, rowsUpdated };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Saving the classification failed: ${msg}` };
  }
}
