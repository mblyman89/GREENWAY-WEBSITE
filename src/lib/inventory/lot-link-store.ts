import "server-only";

/**
 * src/lib/inventory/lot-link-store.ts   (S37 — Inventory fix-everything)
 *
 * The reads and the two guarded writes behind the lot page's
 * "Link this lot to a product" and "Attach a lab result" doors. Every
 * decision is made in the pure core (lot-link-core.ts); this file only
 * fetches facts and performs compare-and-set writes.
 *
 * FAIL CLOSED: a read that errors returns ok:false with the reason. The
 * caller refuses the write rather than linking on partial evidence — a
 * lot linked to a key that "probably" exists is a register that sells the
 * wrong product.
 *
 * THE GUARD IS IN THE UPDATE. Each write re-asserts the blank in its WHERE
 * clause (`.is(col, null)` / `.eq(col, "")`) together with
 * `.neq("status", "destroyed")` and `.select("id")`, so a lot filled in
 * another tab between page load and submit matches zero rows and is
 * reported as "already linked" instead of being overwritten. This is the
 * single-statement compare-and-set PostgREST gives a conditional PATCH;
 * it is the same posture as `applyBulkFill` (store.ts).
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { getPublishedVersion } from "@/lib/pos/menu-version";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";
import {
  COA_CANDIDATE_COLUMNS,
  SIZE_ID_SUFFIX,
  type CoaCandidateRow,
  type KeyEvidence,
  type LotDraftHint,
} from "@/lib/inventory/lot-link-core";

type Fail = { ok: false; error: string };
const NOT_CONFIGURED: Fail = { ok: false, error: "Supabase service role not configured." };

/** Most lab results one Lab test ID search returns (ids are near-unique). */
export const COA_SEARCH_LIMIT = 25;

/**
 * Gather the evidence that a typed key really exists. Three exact-match
 * reads, each bounded: the published card, a published size whose id
 * encodes this lot key, and Onboarding drafts carrying the key.
 */
export async function loadProductKeyEvidence(key: string): Promise<{ ok: true; evidence: KeyEvidence } | Fail> {
  if (!isSupabaseServiceConfigured) return NOT_CONFIGURED;
  const admin = createSupabaseAdminClient();

  const evidence: KeyEvidence = { publishedCard: false, publishedSize: false, draftStatuses: [] };

  const version = await getPublishedVersion();
  if (version) {
    const card = await admin
      .from("menu_items")
      .select("id")
      .eq("menu_version_id", version.id)
      .eq("source_item_id", key)
      .limit(1);
    if (card.error) return { ok: false, error: `Could not check the published menu: ${card.error.message}` };
    evidence.publishedCard = ((card.data as { id: string }[] | null) ?? []).length > 0;

    if (!evidence.publishedCard) {
      const sizes = await admin
        .from("menu_variants")
        .select("menu_item_id")
        .eq("source_variant_id", `${key}${SIZE_ID_SUFFIX}`)
        .limit(50);
      if (sizes.error) return { ok: false, error: `Could not check the published menu sizes: ${sizes.error.message}` };
      const itemIds = ((sizes.data as { menu_item_id: string }[] | null) ?? []).map((r) => r.menu_item_id);
      if (itemIds.length > 0) {
        // The size must belong to a card on the PUBLISHED version, not a draft one.
        const owners = await admin
          .from("menu_items")
          .select("id")
          .eq("menu_version_id", version.id)
          .in("id", itemIds)
          .limit(1);
        if (owners.error) return { ok: false, error: `Could not check the published menu: ${owners.error.message}` };
        evidence.publishedSize = ((owners.data as { id: string }[] | null) ?? []).length > 0;
      }
    }
  }

  const drafts = await admin
    .from("catalog_product_drafts")
    .select("status")
    .eq("pos_product_key", key)
    .limit(50);
  if (drafts.error) return { ok: false, error: `Could not check Product Onboarding: ${drafts.error.message}` };
  evidence.draftStatuses = ((drafts.data as { status: string | null }[] | null) ?? []).map((d) => d.status ?? "");

  return { ok: true, evidence };
}

/**
 * Fill an EMPTY pos_product_key. Two single-statement guarded attempts,
 * because "blank" is both NULL and '' (0023:96): first `.is(null)`, then
 * `.eq("")`. Each is atomic on its own; at most one can match a given row.
 * Provenance is written with the value (migration 0215: owner_entered).
 */
export async function linkLotProductKey(
  lotId: string,
  key: string,
  actorId: string | null,
): Promise<{ ok: true; linked: boolean } | Fail> {
  if (!isSupabaseServiceConfigured) return NOT_CONFIGURED;
  const admin = createSupabaseAdminClient();
  const patch = {
    pos_product_key: key,
    pos_product_key_source: "owner_entered",
    pos_product_key_set_by: actorId,
    pos_product_key_set_at: new Date().toISOString(),
    updated_by: actorId,
  };

  const first = await admin
    .from("inventory_lots")
    .update(patch)
    .eq("id", lotId)
    .neq("status", "destroyed")
    .is("pos_product_key", null)
    .select("id");
  if (first.error) return { ok: false, error: first.error.message };
  if (((first.data as { id: string }[] | null) ?? []).length > 0) return { ok: true, linked: true };

  const second = await admin
    .from("inventory_lots")
    .update(patch)
    .eq("id", lotId)
    .neq("status", "destroyed")
    .eq("pos_product_key", "")
    .select("id");
  if (second.error) return { ok: false, error: second.error.message };
  return { ok: true, linked: ((second.data as { id: string }[] | null) ?? []).length > 0 };
}

/** Does this lab result exist? (The FK would refuse a bad id; we say why first.) */
export async function labResultExists(labId: string): Promise<{ ok: true; exists: boolean } | Fail> {
  if (!isSupabaseServiceConfigured) return NOT_CONFIGURED;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("lab_results").select("id").eq("id", labId).limit(1);
  if (error) return { ok: false, error: error.message };
  return { ok: true, exists: ((data as { id: string }[] | null) ?? []).length > 0 };
}

/** Fill an EMPTY lab_result_id, guarded in the UPDATE. */
export async function linkLotLabResult(
  lotId: string,
  labId: string,
  actorId: string | null,
): Promise<{ ok: true; linked: boolean } | Fail> {
  if (!isSupabaseServiceConfigured) return NOT_CONFIGURED;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("inventory_lots")
    .update({ lab_result_id: labId, updated_by: actorId })
    .eq("id", lotId)
    .neq("status", "destroyed")
    .is("lab_result_id", null)
    .select("id");
  if (error) return { ok: false, error: error.message };
  return { ok: true, linked: ((data as { id: string }[] | null) ?? []).length > 0 };
}

/**
 * Every imported lab result carrying EXACTLY this Lab test ID, plus how many
 * other lots already link each one. Exact match on purpose: a COA is
 * identified by its id, never by a partial or fuzzy match.
 */
export async function findLabResultsByLabtestId(
  term: string,
  excludeLotId: string,
): Promise<{ ok: true; rows: CoaCandidateRow[]; linkedLots: Map<string, number> } | Fail> {
  if (!isSupabaseServiceConfigured) return NOT_CONFIGURED;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("lab_results")
    .select(COA_CANDIDATE_COLUMNS)
    .eq("labtest_external_identifier", term)
    .order("id", { ascending: true })
    .limit(COA_SEARCH_LIMIT);
  if (error) return { ok: false, error: error.message };
  const rows = (data as unknown as CoaCandidateRow[] | null) ?? [];
  const linkedLots = new Map<string, number>();
  if (rows.length > 0) {
    // Paged with an honest verdict (ordered on the unique id), so PostgREST's
    // 1000-row cap can never silently under-count; an incomplete read fails
    // closed rather than showing a too-small "already linked" number.
    const ids = rows.map((r) => r.id);
    const used = await pagedAllChecked<{ id: string; lab_result_id: string }>(async (from, to) => {
      const { data: page, error: pageError } = await admin
        .from("inventory_lots")
        .select("id, lab_result_id")
        .in("lab_result_id", ids)
        .order("id", { ascending: true })
        .range(from, to);
      if (pageError) return { rows: [], ok: false };
      return { rows: (page as { id: string; lab_result_id: string }[] | null) ?? [], ok: true };
    });
    if (!used.verdict.complete) return { ok: false, error: `Could not count the lots using these lab results: ${used.verdict.message}` };
    for (const r of rows) linkedLots.set(r.id, 0);
    for (const u of used.rows) {
      if (u.id === excludeLotId) continue;
      linkedLots.set(u.lab_result_id, (linkedLots.get(u.lab_result_id) ?? 0) + 1);
    }
  }
  return { ok: true, rows, linkedLots };
}

/** Onboarding drafts seeded FROM this lot (provenance column lot_id, 0026). */
export async function listDraftHintsForLot(lotId: string): Promise<LotDraftHint[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("catalog_product_drafts")
    .select("pos_product_key, name, status")
    .eq("lot_id", lotId)
    .limit(20);
  if (error) return [];
  return (data as LotDraftHint[] | null) ?? [];
}
