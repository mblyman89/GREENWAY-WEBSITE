/**
 * S30 (bible S30.2): which APPROVED onboarding rows have an open
 * `fact_extraction_review` flag, for the inline review controls on
 * Product Onboarding -> Approved.
 *
 * Reads only - never writes. Bounded: at most FACT_MANIFEST_READ_MAX
 * deliveries per page view, ONE newest intake version per delivery
 * (import_id IS NULL, summary_json->>manifest_id), WHATEVER its status.
 * R27 (verified in 0236_publish_archive_rule.sql): every publish archives the
 * previous live version and every older staged version. Reading `staged`
 * only therefore lost a delivery's open flags the moment ANY other update
 * went live - and since R27 a delivery whose flagged products were kept off
 * the menu alone publishes the rest, so its open flags (context.withheld)
 * sit on a published (later archived) version. The newest intake version of
 * a delivery is its truth: a newer re-stage of the same delivery supersedes
 * it, another delivery's publish does not. Saved decisions are read only
 * for deliveries whose newest update is held or has a withheld product.
 * Every failure is reported, never hidden: `ok` false means "some rows
 * could not be checked", `migrated` false means migration 0237 is missing.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { listIntakeFactReviewsResult } from "@/lib/pos/fact-review-store";
import {
  flagWithheld,
  openFlagsByDraft,
  savedFactsByKey,
  type IntakeFactDecision,
  type OpenFactFlag,
  type SavedProductFacts,
  type StagedIntakeRow,
} from "@/lib/pos/intake-fact-review-core";
import { isUuid } from "@/lib/catalog/draft-deep-link-core";

/** Deliveries checked per page view (a page shows at most 100 rows). */
export const FACT_MANIFEST_READ_MAX = 25;

/** The named JSON-path select (never `*`: summary_json can be large). */
export const STAGED_FACT_ROW_SELECT =
  "id, created_at, manifest_id:summary_json->>manifest_id, state:summary_json->publish_outcome->>state, diagnostics:summary_json->diagnostics";

export type OpenIntakeFactFlags = {
  flags: Map<string, OpenFactFlag>;
  /** False when any read failed or deliveries were left unchecked. */
  ok: boolean;
  /** False when migration 0237 is not applied (decisions cannot be saved). */
  migrated: boolean;
};

/** The distinct, valid, lower-cased delivery ids of the shown rows (capped). */
export function factManifestIds(
  rows: readonly { manifest_id: string | null }[],
): { ids: string[]; truncated: boolean } {
  const seen = new Set<string>();
  for (const r of rows) {
    const m = typeof r.manifest_id === "string" ? r.manifest_id.trim().toLowerCase() : "";
    if (m && isUuid(m)) seen.add(m);
  }
  const all = Array.from(seen);
  return { ids: all.slice(0, FACT_MANIFEST_READ_MAX), truncated: all.length > FACT_MANIFEST_READ_MAX };
}

export async function loadOpenIntakeFactFlags(
  rows: readonly { manifest_id: string | null }[],
): Promise<OpenIntakeFactFlags> {
  const empty = new Map<string, OpenFactFlag>();
  const { ids, truncated } = factManifestIds(rows);
  if (ids.length === 0) return { flags: empty, ok: true, migrated: true };
  try {
    const admin = createSupabaseAdminClient();
    let ok = !truncated;
    const staged: StagedIntakeRow[] = [];
    const reads = await Promise.all(
      ids.map((m) =>
        admin
          .from("menu_versions")
          .select(STAGED_FACT_ROW_SELECT)
          .is("import_id", null)
          .eq("summary_json->>manifest_id", m)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(1),
      ),
    );
    for (const res of reads) {
      if (res.error) {
        console.error("[intake-fact-review] intake version read failed:", res.error.message);
        ok = false;
        continue;
      }
      for (const r of (res.data as unknown as StagedIntakeRow[] | null) ?? []) staged.push(r);
    }
    const held = staged.filter(
      (r) =>
        typeof r.manifest_id === "string" &&
        (r.state === "held_for_fact_review" ||
          (Array.isArray(r.diagnostics) && (r.diagnostics as unknown[]).some((d) => flagWithheld(d)))),
    );
    if (held.length === 0) return { flags: empty, ok, migrated: true };
    const decisions = new Map<string, IntakeFactDecision[]>();
    let migrated = true;
    for (const r of held) {
      const m = String(r.manifest_id).toLowerCase();
      const res = await listIntakeFactReviewsResult(m);
      if (!res.migrated) migrated = false;
      if (!res.ok) ok = false;
      decisions.set(m, res.reviews as unknown as IntakeFactDecision[]);
    }
    return { flags: openFlagsByDraft(staged, decisions), ok, migrated };
  } catch (err) {
    console.error("[intake-fact-review] open-flag load failed:", err);
    return { flags: empty, ok: false, migrated: true };
  }
}

/**
 * R27: the facts a person SAVED for the shown products (Product facts panel
 * or a flag Fix), keyed `savedFactsMapKey(manifestId, lotKey)`. Before R27 a
 * saved Fix was visible nowhere - the owner could not see or edit what he
 * had typed. One paged decision read per distinct delivery on the page
 * (capped like the flag loader). `ok` false = some deliveries could not be
 * read (the panel says so instead of showing an empty, "nothing saved" box).
 */
export type SavedProductFactsLoad = {
  saved: Map<string, SavedProductFacts>;
  ok: boolean;
  migrated: boolean;
};

export function savedFactsMapKey(manifestId: string, key: string): string {
  return `${manifestId.trim().toLowerCase()}|${key}`;
}

export async function loadSavedProductFacts(
  rows: readonly { manifest_id: string | null }[],
): Promise<SavedProductFactsLoad> {
  const saved = new Map<string, SavedProductFacts>();
  const { ids, truncated } = factManifestIds(rows);
  if (ids.length === 0) return { saved, ok: true, migrated: true };
  let ok = !truncated;
  let migrated = true;
  try {
    const reads = await Promise.all(ids.map((m) => listIntakeFactReviewsResult(m)));
    reads.forEach((res, i) => {
      if (!res.migrated) migrated = false;
      if (!res.ok) ok = false;
      for (const [key, f] of savedFactsByKey(ids[i], res.reviews as unknown as IntakeFactDecision[])) {
        saved.set(savedFactsMapKey(ids[i], key), f);
      }
    });
    return { saved, ok, migrated };
  } catch (err) {
    console.error("[intake-fact-review] saved-facts load failed:", err);
    return { saved, ok: false, migrated };
  }
}
