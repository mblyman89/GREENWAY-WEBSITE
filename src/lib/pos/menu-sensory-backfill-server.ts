/**
 * src/lib/pos/menu-sensory-backfill-server.ts  (R35 #6, server half - migration 0254)
 *
 * "Fill effects and aroma on live cards" (Products page). New menus carry the
 * approved product's counted effects / aroma as they are built (golden record,
 * draft-injection + intake-menu-staging). This owner-pressed catch-up fills
 * the cards that were ALREADY live when 0254 was applied.
 *
 * RULES (all pure, menu-sensory-core planSensoryBackfill):
 *   * Fill-only: a column is written only where it is NULL, and the UPDATE
 *     itself repeats that condition (.is(column, null)) so a list somebody
 *     wrote in between is never overwritten. Safe to press again.
 *   * Same survivorship as the menu build: only COUNTED attached facts
 *     (golden-record-core pickAttachedSensory: a person, the lab, the
 *     manifest, the published KB, or an AI / KB-draft / Cultivera value at
 *     >= 90%), from APPROVED drafts only.
 *   * Same compliance gate as the menu build (golden-record-server
 *     gateGoldenSensory: checkEffects / lintTerms + kb_banned_phrases).
 *     Without the owner's banned list nothing is written (fail closed).
 *   * A read that is not provably complete changes nothing.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { chunkedIn, pagedAllChecked, MENU_READ_CONCURRENCY } from "@/lib/supabase/chunked-in";
import { getPublishedVersion } from "@/lib/pos/menu-version";
import { loadBannedPhrases } from "@/lib/ai/kb/retrieval";
import { pickAttachedSensory } from "@/lib/catalog/golden-record-core";
import { gateGoldenSensory } from "@/lib/catalog/golden-record-server";
import {
  isMissingSensoryColumnError,
  planSensoryBackfill,
  sensoryBackfillMessage,
  sensoryKeysForCards,
  type SensoryBackfillCard,
  type SensoryPair,
} from "@/lib/pos/menu-sensory-core";

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

/** Audit action for the button (pinned by tests/compliance/r35-menu-effects-aroma.test.ts). */
export const MENU_SENSORY_BACKFILL_AUDIT_ACTION = "menu.sensory_backfill";

const PAGE = 1000;
const KEY_CHUNK = 200;
const UPDATE_CHUNK = 200;

export type MenuSensoryBackfillResult =
  | { ok: false; error: string }
  | {
      ok: true;
      filled: number;
      alreadyFilled: number;
      nothingCounted: number;
      failed: number;
      message: string;
    };

type DraftRow = { pos_product_key: string | null; attached_facts: unknown; updated_at: string | null };

export async function runMenuSensoryBackfill(admin?: AdminClient): Promise<MenuSensoryBackfillResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase is not configured." };
  let client: AdminClient;
  try {
    client = admin ?? createSupabaseAdminClient();
  } catch {
    return { ok: false, error: "Supabase is not configured." };
  }
  try {
    const version = await getPublishedVersion();
    if (!version) return { ok: false, error: "No published menu yet: publish a menu first, then fill it." };

    // 1. The live cards and their two lists.
    let missingColumn = false;
    const menu = await pagedAllChecked<{ id: string; source_item_id: string; effects: unknown; aroma_notes: unknown }>(
      async (from, to) => {
        const { data, error } = await client
          .from("menu_items")
          .select("id, source_item_id, effects, aroma_notes")
          .eq("menu_version_id", version.id)
          .order("id", { ascending: true })
          .range(from, to);
        if (error && isMissingSensoryColumnError(error)) missingColumn = true;
        return {
          rows: (data as unknown as { id: string; source_item_id: string; effects: unknown; aroma_notes: unknown }[] | null) ?? [],
          ok: !error,
        };
      },
      { pageSize: PAGE },
    );
    if (missingColumn) {
      return {
        ok: false,
        error: "The effects and aroma columns are not in the database yet (migration 0254). Nothing was changed.",
      };
    }
    if (!menu.verdict.complete) {
      return { ok: false, error: `Could not read the whole live menu (${menu.verdict.message}). Nothing was changed; try again.` };
    }
    const asList = (v: unknown): string[] | null =>
      Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string") ? (v as string[]) : null;
    const open = menu.rows.filter((r) => !asList(r.effects) || !asList(r.aroma_notes));

    // 2. Sizes for the open cards only (their onboarded lot keys).
    let variantFailed = false;
    const variants = await chunkedIn<string, { menu_item_id: string; source_variant_id: string }>(
      open.map((r) => r.id),
      async (chunk, from, to) => {
        if (variantFailed) return [];
        const { data, error } = await client
          .from("menu_variants")
          .select("menu_item_id, source_variant_id")
          .in("menu_item_id", chunk)
          .order("id", { ascending: true })
          .range(from, to);
        if (error) {
          variantFailed = true;
          return [];
        }
        return (data as { menu_item_id: string; source_variant_id: string }[] | null) ?? [];
      },
      { chunkSize: KEY_CHUNK, concurrency: MENU_READ_CONCURRENCY },
    );
    if (variantFailed) return { ok: false, error: "Could not read the menu sizes. Nothing was changed; try again." };
    const variantIds = new Map<string, string[]>();
    for (const v of variants) {
      const list = variantIds.get(v.menu_item_id) ?? [];
      list.push(v.source_variant_id);
      variantIds.set(v.menu_item_id, list);
    }
    const cards: SensoryBackfillCard[] = menu.rows.map((r) => ({
      id: r.id,
      source_item_id: r.source_item_id,
      effects: asList(r.effects),
      aroma_notes: asList(r.aroma_notes),
      variantIds: variantIds.get(r.id) ?? [],
    }));

    // 3. The approved drafts' counted lists for every key the open cards need.
    const keys = sensoryKeysForCards(cards);
    let draftFailed = false;
    const drafts = await chunkedIn<string, DraftRow>(
      keys,
      async (chunk, from, to) => {
        if (draftFailed) return [];
        const { data, error } = await client
          .from("catalog_product_drafts")
          .select("pos_product_key, attached_facts, updated_at")
          .eq("status", "approved")
          .in("pos_product_key", chunk)
          .order("id", { ascending: true })
          .range(from, to);
        if (error) {
          draftFailed = true;
          return [];
        }
        return (data as DraftRow[] | null) ?? [];
      },
      { chunkSize: KEY_CHUNK, concurrency: MENU_READ_CONCURRENCY },
    );
    if (draftFailed) return { ok: false, error: "Could not read the approved products. Nothing was changed; try again." };

    // 4. Gate (fail closed without the owner's banned list).
    let banned: Awaited<ReturnType<typeof loadBannedPhrases>>;
    try {
      banned = await loadBannedPhrases();
    } catch {
      return { ok: false, error: "Could not load your banned phrases, so nothing could be cleared. Nothing was changed; try again." };
    }
    // The most recently updated approved draft per key decides (one product
    // can have been re-approved; its newest answer is the current one).
    const newest = new Map<string, DraftRow>();
    for (const d of drafts) {
      const k = String(d.pos_product_key ?? "").trim();
      if (!k) continue;
      const prev = newest.get(k);
      if (!prev || String(d.updated_at ?? "") > String(prev.updated_at ?? "")) newest.set(k, d);
    }
    const byKey = new Map<string, SensoryPair>();
    for (const [k, d] of newest) {
      const { goldenEffects, goldenAroma } = gateGoldenSensory(
        pickAttachedSensory(d.attached_facts, "effects"),
        pickAttachedSensory(d.attached_facts, "aroma"),
        banned,
      );
      if (goldenEffects || goldenAroma) {
        byKey.set(k, { effects: goldenEffects?.values ?? null, aroma: goldenAroma?.values ?? null });
      }
    }

    // 5. Plan + fill-only batched updates.
    const plan = planSensoryBackfill(cards, byKey);
    const filledIds = new Set<string>();
    const failedIds = new Set<string>();
    for (const u of plan.updates) {
      for (let i = 0; i < u.ids.length; i += UPDATE_CHUNK) {
        const chunk = u.ids.slice(i, i + UPDATE_CHUNK);
        const { data, error } = await client
          .from("menu_items")
          .update({ [u.column]: u.values })
          .in("id", chunk)
          .is(u.column, null)
          .select("id");
        if (error) for (const id of chunk) failedIds.add(id);
        else for (const r of (data as { id: string }[] | null) ?? []) filledIds.add(r.id);
        // Fewer rows than asked = somebody filled them first: not ours, not a failure.
      }
    }
    for (const id of filledIds) failedIds.delete(id);
    const counts = {
      filled: filledIds.size,
      alreadyFilled: plan.alreadyFilled,
      nothingCounted: plan.nothingCounted,
      failed: failedIds.size,
    };
    return { ok: true, ...counts, message: sensoryBackfillMessage(counts) };
  } catch (err) {
    return { ok: false, error: `Filling failed: ${err instanceof Error ? err.message : String(err)}. Nothing further was changed.` };
  }
}
