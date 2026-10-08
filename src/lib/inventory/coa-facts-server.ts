/**
 * src/lib/inventory/coa-facts-server.ts
 *
 * R28 - the bridge staging uses to fill an edible's serving facts from its
 * lab certificate. One bounded read per staging run:
 *
 *   approved drafts -> their lots (inventory_lots.lab_result_id)
 *                   -> lab_results.coa_extract_json (0252, the stored read)
 *                   -> coa-extract-core coaFactsForDrafts (pure, self-tested)
 *
 * The result goes on each draft's DraftEnrichment.coaFacts, and
 * draft-injection-core merges it into the fact engine (source "coa").
 *
 * Never throws: a database without 0252, or any failed read, returns an empty
 * map and staging runs exactly as it did before R28 (the name/column engine).
 * Reads only: the certificates are read and stored at finalize
 * (coa-extract.ts), never here.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { chunkedIn } from "@/lib/supabase/chunked-in";
import {
  coaFactsForDrafts,
  isMissingColumnError,
  type StoredLabForFacts,
} from "@/lib/inventory/coa-extract-core";
import type { CoaDraftFacts } from "@/lib/inventory/coa-facts-core";
import { MG_FACT_TYPES } from "@/lib/inventory/fact-extraction-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type DraftForCoaFacts = { id: string; name: string; inventory_type: string | null; lot_id: string | null };

/** draftId -> the certificate's serving facts. Only mg-dosed drafts with a stored read. */
export async function loadCoaFactsForDrafts(admin: Admin, drafts: readonly DraftForCoaFacts[]): Promise<Map<string, CoaDraftFacts>> {
  const empty = new Map<string, CoaDraftFacts>();
  const edibles = drafts.filter((d) => d.lot_id && MG_FACT_TYPES.has((d.inventory_type ?? "").trim()));
  if (edibles.length === 0) return empty;
  try {
    const lotIds = Array.from(new Set(edibles.map((d) => d.lot_id as string)));
    const lots = await chunkedIn<string, { id: string; lab_result_id: string | null }>(lotIds, async (chunk, from, to) => {
      const { data, error } = await admin
        .from("inventory_lots")
        .select("id, lab_result_id")
        .in("id", chunk)
        .order("id", { ascending: true })
        .range(from, to);
      if (error) throw error;
      return (data as { id: string; lab_result_id: string | null }[] | null) ?? [];
    });
    const labIdByLotId = new Map<string, string>();
    for (const l of lots) if (l.lab_result_id) labIdByLotId.set(l.id, l.lab_result_id);
    const labIds = Array.from(new Set(labIdByLotId.values()));
    if (labIds.length === 0) return empty;
    const labs = await chunkedIn<string, StoredLabForFacts & { id: string }>(labIds, async (chunk, from, to) => {
      const { data, error } = await admin
        .from("lab_results")
        .select("id, coa_extract_json, total_thc_pct, total_cbd_pct, cbd_pct")
        .in("id", chunk)
        .order("id", { ascending: true })
        .range(from, to);
      if (error) throw error;
      return (data as (StoredLabForFacts & { id: string })[] | null) ?? [];
    });
    const labById = new Map<string, StoredLabForFacts>();
    for (const l of labs) labById.set(l.id, l);
    return coaFactsForDrafts(edibles, labIdByLotId, labById);
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (!isMissingColumnError(e)) console.error("[coa-facts] stored certificate read failed:", e?.message ?? String(err));
    return empty;
  }
}
