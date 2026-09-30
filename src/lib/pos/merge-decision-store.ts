/**
 * src/lib/pos/merge-decision-store.ts  (bible S32)
 *
 * Server-only persistence for intake_merge_decisions (migration 0239): the
 * remembered "join card X" / "keep separate" answer per product identity.
 * The pure rules live in merge-review-core.ts and intake-mastering-core.ts;
 * this module only reads and writes the table.
 *
 * Pre-migration posture (the repo's usual one): a missing table reads as "no
 * decisions" (the planner then behaves exactly as before S32) and a write
 * reports `migrated: false` so the page can say which migration to run.
 * The calling server actions gate permissions (inventory.manage).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { chunkedIn } from "@/lib/supabase/chunked-in";
import type { MergeDecision } from "@/lib/pos/intake-mastering-core";
import { isMergeDecisionTableMissing, type MergeDecisionInput } from "@/lib/pos/merge-review-core";

export const MERGE_DECISION_COLUMNS = "identity, decision, target_card_key, candidate_card_keys, own_card_key, decided_by, decided_at, note";

export type MergeDecisionRow = {
  identity: string;
  decision: "join" | "separate";
  target_card_key: string | null;
  candidate_card_keys: string[];
  own_card_key: string | null;
  decided_by: string | null;
  decided_at: string;
  note: string | null;
};

function toDecision(r: MergeDecisionRow): MergeDecision | null {
  if (r.decision !== "join" && r.decision !== "separate") return null;
  if (!Array.isArray(r.candidate_card_keys)) return null;
  return {
    decision: r.decision,
    target_card_key: r.target_card_key ?? null,
    candidate_card_keys: r.candidate_card_keys.filter((k): k is string => typeof k === "string"),
    own_card_key: r.own_card_key ?? null,
  };
}

/**
 * Every decision for these identities (one chunked select). Any failure -
 * including the table not existing yet - returns an EMPTY map: no decision is
 * applied, which is exactly the pre-S32 behaviour (never a guess).
 */
export async function loadMergeDecisions(identities: readonly string[]): Promise<Map<string, MergeDecision>> {
  const out = new Map<string, MergeDecision>();
  const ids = Array.from(new Set(identities.map((i) => i.trim()).filter(Boolean)));
  if (ids.length === 0 || !isSupabaseServiceConfigured) return out;
  try {
    const admin = createSupabaseAdminClient();
    let failed = false;
    const rows = await chunkedIn<string, MergeDecisionRow>(ids, async (chunk, from, to) => {
      const { data, error } = await admin
        .from("intake_merge_decisions")
        .select(MERGE_DECISION_COLUMNS)
        .in("identity", chunk)
        .order("identity", { ascending: true })
        .range(from, to);
      if (error) {
        if (!isMergeDecisionTableMissing(error)) {
          console.error("[merge-decision-store] load failed:", error.message);
        }
        failed = true;
        return [];
      }
      return (data as MergeDecisionRow[] | null) ?? [];
    });
    if (failed) return new Map();
    for (const r of rows) {
      const d = toDecision(r);
      if (d) out.set(r.identity, d);
    }
    return out;
  } catch (err) {
    console.error("[merge-decision-store] load threw:", err);
    return new Map();
  }
}

/** One identity's saved row (for the match page), with read status. */
export async function getMergeDecision(
  identity: string,
): Promise<{ row: MergeDecisionRow | null; ok: boolean; migrated: boolean }> {
  if (!isSupabaseServiceConfigured) return { row: null, ok: false, migrated: true };
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("intake_merge_decisions")
      .select(MERGE_DECISION_COLUMNS)
      .eq("identity", identity)
      .maybeSingle();
    if (error) {
      const missing = isMergeDecisionTableMissing(error);
      if (!missing) console.error("[merge-decision-store] get failed:", error.message);
      return { row: null, ok: false, migrated: !missing };
    }
    return { row: (data as MergeDecisionRow | null) ?? null, ok: true, migrated: true };
  } catch (err) {
    console.error("[merge-decision-store] get threw:", err);
    return { row: null, ok: false, migrated: true };
  }
}

export type MergeDecisionWrite = { ok: boolean; migrated: boolean; error?: string };

/** Upsert one answer (one row per identity; saving again replaces it). */
export async function saveMergeDecision(v: MergeDecisionInput, actorId: string | null): Promise<MergeDecisionWrite> {
  if (!isSupabaseServiceConfigured) return { ok: false, migrated: true, error: "Supabase is not configured." };
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("intake_merge_decisions").upsert(
      {
        identity: v.identity,
        decision: v.decision,
        target_card_key: v.decision === "join" ? v.targetCardKey : null,
        candidate_card_keys: v.candidateCardKeys,
        own_card_key: v.ownCardKey,
        decided_by: actorId,
        decided_at: new Date().toISOString(),
        note: v.note,
      },
      { onConflict: "identity" },
    );
    if (error) {
      const missing = isMergeDecisionTableMissing(error);
      if (!missing) console.error("[merge-decision-store] save failed:", error.message);
      return { ok: false, migrated: !missing, error: missing ? undefined : error.message };
    }
    return { ok: true, migrated: true };
  } catch (err) {
    console.error("[merge-decision-store] save threw:", err);
    return { ok: false, migrated: true, error: err instanceof Error ? err.message : "Saving failed." };
  }
}

/** Delete one answer ("Forget my choice"). `deleted` false = there was none. */
export async function forgetMergeDecision(identity: string): Promise<MergeDecisionWrite & { deleted: boolean }> {
  if (!isSupabaseServiceConfigured) return { ok: false, migrated: true, deleted: false, error: "Supabase is not configured." };
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.from("intake_merge_decisions").delete().eq("identity", identity).select("identity");
    if (error) {
      const missing = isMergeDecisionTableMissing(error);
      if (!missing) console.error("[merge-decision-store] forget failed:", error.message);
      return { ok: false, migrated: !missing, deleted: false, error: missing ? undefined : error.message };
    }
    return { ok: true, migrated: true, deleted: Array.isArray(data) && data.length > 0 };
  } catch (err) {
    console.error("[merge-decision-store] forget threw:", err);
    return { ok: false, migrated: true, deleted: false, error: err instanceof Error ? err.message : "Forgetting failed." };
  }
}
