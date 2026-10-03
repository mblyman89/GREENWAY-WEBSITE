/**
 * src/lib/catalog/waiting-facts-server.ts  (Round 23, items 2 + 6, server half)
 *
 * READS ONLY. The pending ai_suggestions the onboarding rows' "Facts
 * waiting for you" lists are built from (waiting-facts-core.ts), in ONE
 * bounded read for the whole page, and the single-row re-read the attach
 * action trusts (never the browser's text).
 *
 * Google grounding terms (Gemini API "Grounding with Google Search"): this
 * adds NO new storage of grounded results - it only shows suggestions the
 * S07 door already filed, for a person to confirm.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { suggestionTargetKey } from "@/lib/enrichment/enrichment-identity-core";
import { enrichmentFollowsIdentityOn } from "@/lib/enrichment/enrichment-identity-server";
import { WAITING_SUGGESTION_KEYS, type WaitingSuggestionRow } from "./waiting-facts-core";

/** Named columns only (no select("*")). */
export const WAITING_SUGGESTION_SELECT = "id, entity_id, field_key, suggested_value, status, confidence, source, created_at";
/** Hard cap on the page read (a page shows at most 100 rows; ~4 keys each). */
export const WAITING_SUGGESTION_LIMIT = 1000;

/** The draft's suggestion key - the SAME rule the S07 door files under. */
export function waitingKeyForDraft(d: { pos_product_key?: string | null; restock_of_card_key?: string | null }): string | null {
  return suggestionTargetKey({
    posProductKey: (d.pos_product_key ?? "").trim() || null,
    restockOfCardKey: d.restock_of_card_key ?? null,
    enabled: enrichmentFollowsIdentityOn(),
  });
}

/**
 * Every pending, row-attachable suggestion on these keys. Never throws:
 * `ok:false` when the read failed, so the page says "could not check"
 * instead of showing an empty list as if nothing were waiting.
 */
export async function loadWaitingSuggestions(keys: readonly (string | null)[]): Promise<{ ok: boolean; rows: WaitingSuggestionRow[] }> {
  const uniq = Array.from(new Set(keys.map((k) => (k ?? "").trim()).filter(Boolean)));
  if (uniq.length === 0 || !isSupabaseServiceConfigured) return { ok: true, rows: [] };
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("ai_suggestions")
      .select(WAITING_SUGGESTION_SELECT)
      .eq("entity_type", "product")
      .eq("status", "pending")
      .in("entity_id", uniq)
      .in("field_key", [...WAITING_SUGGESTION_KEYS])
      .order("created_at", { ascending: false })
      .limit(WAITING_SUGGESTION_LIMIT);
    if (error) return { ok: false, rows: [] };
    return { ok: true, rows: (data as WaitingSuggestionRow[] | null) ?? [] };
  } catch {
    return { ok: false, rows: [] };
  }
}

/** One suggestion by id (the action's trusted re-read). null = gone or unreadable. */
export async function readWaitingSuggestion(id: string): Promise<WaitingSuggestionRow | null> {
  const v = (id ?? "").trim();
  if (!v || !isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("ai_suggestions").select(WAITING_SUGGESTION_SELECT).eq("id", v).eq("entity_type", "product").maybeSingle();
  if (error) return null;
  return (data as WaitingSuggestionRow | null) ?? null;
}

/** The draft's own suggestion key + status, re-read on the server. */
export async function readDraftForWaiting(draftId: string): Promise<{ status: string | null; key: string | null; row: Record<string, unknown> } | null> {
  const v = (draftId ?? "").trim();
  if (!v || !isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  // "*" so a database without 0234 (no restock_of_card_key) or 0235 still answers.
  const { data, error } = await admin.from("catalog_product_drafts").select("*").eq("id", v).maybeSingle();
  if (error || !data) return null;
  const d = data as Record<string, unknown> & { status?: string | null; pos_product_key?: string | null; restock_of_card_key?: string | null };
  return { status: d.status ?? null, key: waitingKeyForDraft(d), row: d };
}
