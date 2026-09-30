/**
 * src/lib/pos/merge-review-server.ts  (bible S32)
 *
 * Reads for the match review page (intake/[id]/match). Read-only, bounded:
 *   1. the delivery's newest intake version that is STAGED or PUBLISHED
 *      (import_id IS NULL, summary_json->>manifest_id = the delivery - the
 *      filter pair intake-menu-staging.ts and intake-fact-review-server.ts
 *      use), named JSON-path columns only (never `*`);
 *   2. the candidate cards + the product's own card, by source_item_id, from
 *      THAT version (at most live_card_keys + 1 rows) and their variants;
 *   3. which of those keys are on the currently published version.
 * Every failure is reported (`ok: false`), never hidden or guessed around.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  findMergeWarning,
  decidedOutcome,
  type MergeReviewDiagnostic,
  type MergeWarning,
  type ReviewCard,
} from "@/lib/pos/merge-review-core";

export const MATCH_VERSION_SELECT =
  "id, status, created_at, manifest_id:summary_json->>manifest_id, diagnostics:summary_json->diagnostics";

export type MatchReviewData = {
  ok: boolean;
  versionId: string | null;
  versionStatus: string | null;
  warning: MergeWarning | null;
  decided: "join" | "separate" | null;
  cards: ReviewCard[];
  ownCard: ReviewCard | null;
  liveKeys: Set<string>;
};

type VersionRow = { id: string; status: string; created_at: string; diagnostics: unknown };
type ItemRow = {
  id: string;
  source_item_id: string;
  name: string;
  brand_name: string | null;
  vendor_name: string | null;
  category: string;
  strain_name: string | null;
  hidden: boolean | null;
};
type VariantRow = { menu_item_id: string; source_variant_id: string; label: string; medical: boolean; sort_order: number };

export async function loadMatchReview(manifestId: string, identity: string): Promise<MatchReviewData> {
  const empty: MatchReviewData = {
    ok: false,
    versionId: null,
    versionStatus: null,
    warning: null,
    decided: null,
    cards: [],
    ownCard: null,
    liveKeys: new Set(),
  };
  if (!isSupabaseServiceConfigured) return empty;
  try {
    const admin = createSupabaseAdminClient();
    const { data: vData, error: vErr } = await admin
      .from("menu_versions")
      .select(MATCH_VERSION_SELECT)
      .is("import_id", null)
      .in("status", ["staged", "published"])
      .eq("summary_json->>manifest_id", manifestId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1);
    if (vErr) {
      console.error("[merge-review] version read failed:", vErr.message);
      return empty;
    }
    const version = ((vData as unknown as VersionRow[] | null) ?? [])[0] ?? null;
    if (!version) return { ...empty, ok: true };
    const diagnostics = Array.isArray(version.diagnostics) ? (version.diagnostics as MergeReviewDiagnostic[]) : [];
    const warning = findMergeWarning(diagnostics, identity);
    const decided = decidedOutcome(diagnostics, identity);
    const base = { ...empty, ok: true, versionId: version.id, versionStatus: version.status, warning, decided };
    if (!warning) return base;

    const keys = Array.from(new Set([...warning.liveCardKeys, ...(warning.ownCardKey ? [warning.ownCardKey] : [])]));
    const { data: iData, error: iErr } = await admin
      .from("menu_items")
      .select("id, source_item_id, name, brand_name, vendor_name, category, strain_name, hidden")
      .eq("menu_version_id", version.id)
      .in("source_item_id", keys);
    if (iErr) {
      console.error("[merge-review] card read failed:", iErr.message);
      return { ...base, ok: false };
    }
    const items = (iData as ItemRow[] | null) ?? [];
    const variantsByItem = new Map<string, VariantRow[]>();
    if (items.length > 0) {
      const { data: vr, error: vrErr } = await admin
        .from("menu_variants")
        .select("menu_item_id, source_variant_id, label, medical, sort_order")
        .in("menu_item_id", items.map((i) => i.id))
        .order("sort_order", { ascending: true });
      if (vrErr) {
        console.error("[merge-review] size read failed:", vrErr.message);
        return { ...base, ok: false };
      }
      for (const v of (vr as VariantRow[] | null) ?? []) {
        const list = variantsByItem.get(v.menu_item_id) ?? [];
        list.push(v);
        variantsByItem.set(v.menu_item_id, list);
      }
    }
    const toCard = (i: ItemRow): ReviewCard => ({
      source_item_id: i.source_item_id,
      name: i.name,
      brand_name: i.brand_name ?? "",
      vendor_name: i.vendor_name,
      category: i.category,
      strain_name: i.strain_name,
      hidden: i.hidden === true,
      variants: (variantsByItem.get(i.id) ?? []).map((v) => ({
        source_variant_id: v.source_variant_id,
        label: v.label,
        medical: v.medical === true,
      })),
    });
    const cards = items.filter((i) => warning.liveCardKeys.includes(i.source_item_id)).map(toCard);
    const ownRow = warning.ownCardKey ? items.find((i) => i.source_item_id === warning.ownCardKey) : undefined;

    // Which keys are on the live menu now.
    const liveKeys = new Set<string>();
    const { data: pub, error: pErr } = await admin.from("menu_versions").select("id").eq("status", "published").limit(1).maybeSingle();
    if (pErr) {
      console.error("[merge-review] published read failed:", pErr.message);
      return { ...base, ok: false, cards, ownCard: ownRow ? toCard(ownRow) : null };
    }
    if (pub) {
      const { data: lk, error: lkErr } = await admin
        .from("menu_items")
        .select("source_item_id")
        .eq("menu_version_id", (pub as { id: string }).id)
        .in("source_item_id", keys);
      if (lkErr) {
        console.error("[merge-review] live key read failed:", lkErr.message);
        return { ...base, ok: false, cards, ownCard: ownRow ? toCard(ownRow) : null };
      }
      for (const r of (lk as { source_item_id: string }[] | null) ?? []) liveKeys.add(r.source_item_id);
    }
    return { ...base, cards, ownCard: ownRow ? toCard(ownRow) : null, liveKeys };
  } catch (err) {
    console.error("[merge-review] load threw:", err);
    return empty;
  }
}
