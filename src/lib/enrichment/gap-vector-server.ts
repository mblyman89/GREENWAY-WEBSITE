/**
 * src/lib/enrichment/gap-vector-server.ts   (Round 20, slice S23)
 *
 * The ONE read S23 adds: a card's onboarding fact history
 * (product_fact_provenance, 0235) for the detail-page gap header. Every
 * decision is in gap-vector-core.ts; this file only does I/O.
 *
 *   - Two keyed reads, run concurrently, merged by row id:
 *       identity_key IN (the card's S03 identity), and
 *       pos_product_key IN (the card's lot keys, vendor-identity-core
 *       cardLotKeys). The S07 door stamps identityForDraft(draft), whose
 *       category comes from the DRAFT (chosen_website_category ?? category)
 *       and can be spelled differently from the menu row's; it also stamps
 *       the draft's own pos_product_key (the lot key). Reading both means a
 *       fact that was really attached is not silently missed (fact-memory.ts
 *       historyKeysFor precedent).
 *   - Named columns, only the gap fields, newest first, bounded per read.
 *   - Never throws. null = "not read" (no keys, no service credentials, 0235
 *     not applied, or an error on EITHER read) so the header says the
 *     history could not be read instead of pretending nothing was attached.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { PROVENANCE_TABLE, isMissingAttachedFactsError } from "@/lib/catalog/attach-facts-core";
import {
  GAP_PROVENANCE_FIELDS,
  GAP_PROVENANCE_LIMIT,
  GAP_PROVENANCE_SELECT,
  type GapProvenanceRow,
} from "./gap-vector-core";

/** Keys to read: trimmed, de-duplicated, blanks dropped. */
export function gapProvenanceKeys(keys: readonly (string | null | undefined)[] | null | undefined): string[] {
  const out: string[] = [];
  for (const k of keys ?? []) {
    const v = typeof k === "string" ? k.trim() : "";
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

type Row = GapProvenanceRow & { id?: string | null };

export async function loadGapProvenance(
  keys: { identityKeys?: readonly (string | null | undefined)[] | null; posKeys?: readonly (string | null | undefined)[] | null },
  admin?: ReturnType<typeof createSupabaseAdminClient>,
): Promise<GapProvenanceRow[] | null> {
  const identityKeys = gapProvenanceKeys(keys.identityKeys);
  const posKeys = gapProvenanceKeys(keys.posKeys);
  if ((identityKeys.length === 0 && posKeys.length === 0) || !isSupabaseServiceConfigured) return null;
  try {
    const db = admin ?? createSupabaseAdminClient();
    const read = async (column: "identity_key" | "pos_product_key", values: string[]) => {
      if (values.length === 0) return { rows: [] as Row[], error: null };
      const { data, error } = await db
        .from(PROVENANCE_TABLE)
        .select(`id, ${GAP_PROVENANCE_SELECT}`)
        .in(column, values)
        .in("field", [...GAP_PROVENANCE_FIELDS])
        .order("created_at", { ascending: false })
        .limit(GAP_PROVENANCE_LIMIT);
      return { rows: ((data as unknown as Row[] | null) ?? []), error };
    };
    const [byIdentity, byPos] = await Promise.all([read("identity_key", identityKeys), read("pos_product_key", posKeys)]);
    const error = byIdentity.error ?? byPos.error;
    if (error) {
      if (!isMissingAttachedFactsError(error)) {
        console.error("[gap-vector] fact history read failed (header shows no chips):", error.message);
      }
      return null;
    }
    const seen = new Set<string>();
    const out: GapProvenanceRow[] = [];
    for (const r of [...byIdentity.rows, ...byPos.rows]) {
      const id = typeof r.id === "string" ? r.id : null;
      if (id) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      out.push({
        field: String(r.field ?? ""),
        value_json: r.value_json,
        source: String(r.source ?? ""),
        confidence: r.confidence ?? null,
        created_at: String(r.created_at ?? ""),
      });
    }
    return out;
  } catch (err) {
    console.error("[gap-vector] fact history read threw (header shows no chips):", String(err).slice(0, 200));
    return null;
  }
}
