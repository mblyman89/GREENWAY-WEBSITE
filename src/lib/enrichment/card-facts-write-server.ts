/**
 * src/lib/enrichment/card-facts-write-server.ts  (D244 R-2)  SERVER-ONLY.
 *
 * A person accepted (or typed) a strain type or potency draft. Those two
 * facts live on the website CARD (menu_items.strain_type / thc / cbd /
 * total_*_json), not on the enrichment row, so this writes them to the
 * product's own cards on the PUBLISHED version and every intake-STAGED
 * version (the same two loadLotMenuCards and the price correction use, so a
 * pending publish does not revert it) and stamps fact_provenance with
 * "reviewer" for each key written: a person's answer, which the strain
 * library (product-facts-overlay) and the reprocess sweep never override.
 *
 * Only cards whose source_item_id IS this product key are written. A
 * mastered card that also sells other lots is left to the lot page's
 * propagation (it knows the sibling lots); we never guess for them.
 * Never throws: returns the count written or an error sentence.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";

/** fact_provenance word for a person's answer (same as lot-strain-propagation-core). */
export const CARD_FACT_REVIEWER = "reviewer" as const;

export async function writeCardFacts(
  key: string,
  patch: Record<string, unknown>,
): Promise<{ ok: true; cards: number } | { ok: false; error: string }> {
  const keys = Object.keys(patch).filter((k) => !k.endsWith("_json"));
  if (!key || keys.length === 0) return { ok: false, error: "Nothing to write." };
  if (!isSupabaseServiceConfigured) return { ok: false, error: "The database is not configured here." };
  try {
    const admin = createSupabaseAdminClient();
    const versions = await admin.from("menu_versions").select("id, status, import_id").in("status", ["published", "staged"]);
    if (versions.error) return { ok: false, error: "The live menu could not be read just now. Nothing was changed." };
    const ids = ((versions.data ?? []) as { id: string; status: string; import_id: string | null }[])
      .filter((v) => v.status === "published" || (v.status === "staged" && v.import_id === null))
      .map((v) => v.id);
    if (ids.length === 0) return { ok: false, error: "There is no live menu yet, so there is no card to update." };
    const cards = await admin.from("menu_items").select("id, fact_provenance").in("menu_version_id", ids).eq("source_item_id", key);
    if (cards.error) return { ok: false, error: "The website card could not be read just now. Nothing was changed." };
    const rows = (cards.data ?? []) as { id: string; fact_provenance: unknown }[];
    if (rows.length === 0) return { ok: false, error: "This product has no card on the live menu, so there is nothing to update." };
    let n = 0;
    for (const r of rows) {
      const prov =
        r.fact_provenance && typeof r.fact_provenance === "object" && !Array.isArray(r.fact_provenance)
          ? (r.fact_provenance as Record<string, unknown>)
          : {};
      const stamp = Object.fromEntries(keys.map((k) => [k, CARD_FACT_REVIEWER]));
      const { error } = await admin
        .from("menu_items")
        .update({ ...patch, fact_provenance: { ...prov, ...stamp } })
        .eq("id", r.id);
      if (!error) n += 1;
    }
    if (n === 0) return { ok: false, error: "The website card did not save. Try again." };
    return { ok: true, cards: n };
  } catch {
    return { ok: false, error: "The website card could not be updated just now." };
  }
}
