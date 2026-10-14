/**
 * src/lib/pos/card-alias-store.ts  (R50 A1)
 *
 * Server-only persistence for intake_card_aliases (migration 0270): the
 * owner's remembered "this product IS that live card" answer. The rules live
 * in card-alias-core.ts and intake-mastering-core.ts (aliasTarget); this
 * module only reads and writes the table.
 *
 * Pre-migration posture (same as merge-decision-store): a missing table reads
 * as "no aliases" (the planner then behaves exactly as before A1) and a write
 * reports `migrated: false` so the page can say which migration to run. The
 * calling server actions gate permissions (inventory.manage).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { chunkedIn } from "@/lib/supabase/chunked-in";
import { CARD_ALIAS_COLUMNS, CARD_ALIAS_TABLE, aliasMapFromRows, isCardAliasTableMissing } from "@/lib/pos/card-alias-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
type Deps = { admin?: Admin; configured?: boolean };

function client(deps: Deps): Admin | null {
  const configured = deps.configured ?? isSupabaseServiceConfigured;
  if (!configured) return null;
  return deps.admin ?? createSupabaseAdminClient();
}

/**
 * The saved aliases for these identities (one chunked select). Any failure -
 * including the table not existing yet - returns an EMPTY map: no alias is
 * applied, exactly the pre-A1 behaviour (never a guess).
 */
export async function loadCardAliases(identities: readonly string[], deps: Deps = {}): Promise<Map<string, string>> {
  const ids = Array.from(new Set(identities.map((i) => (typeof i === "string" ? i.trim() : "")).filter(Boolean)));
  if (ids.length === 0) return new Map();
  try {
    const admin = client(deps);
    if (!admin) return new Map();
    let failed = false;
    const rows = await chunkedIn<string, { identity: string; card_key: string }>(ids, async (chunk, from, to) => {
      const { data, error } = await admin
        .from(CARD_ALIAS_TABLE)
        .select(CARD_ALIAS_COLUMNS)
        .in("identity", chunk)
        .order("identity", { ascending: true })
        .range(from, to);
      if (error) {
        if (!isCardAliasTableMissing(error)) console.error("[card-alias-store] load failed:", error.message);
        failed = true;
        return [];
      }
      return (data as { identity: string; card_key: string }[] | null) ?? [];
    });
    if (failed) return new Map();
    return aliasMapFromRows(rows);
  } catch (err) {
    console.error("[card-alias-store] load threw:", err);
    return new Map();
  }
}

export type CardAliasWrite = { ok: boolean; migrated: boolean; error?: string };

/** Upsert one answer (one row per identity; saving again replaces it). */
export async function saveCardAlias(
  v: { identity: string; cardKey: string; cardName: string | null; note?: string | null },
  actorId: string | null,
  deps: Deps & { now?: () => Date } = {},
): Promise<CardAliasWrite> {
  try {
    const admin = client(deps);
    if (!admin) return { ok: false, migrated: true, error: "Supabase is not configured." };
    const { error } = await admin.from(CARD_ALIAS_TABLE).upsert(
      {
        identity: v.identity,
        card_key: v.cardKey,
        card_name: v.cardName,
        decided_by: actorId,
        decided_at: (deps.now ?? (() => new Date()))().toISOString(),
        note: v.note ?? null,
      },
      { onConflict: "identity" },
    );
    if (error) {
      const missing = isCardAliasTableMissing(error);
      if (!missing) console.error("[card-alias-store] save failed:", error.message);
      return { ok: false, migrated: !missing, error: missing ? undefined : error.message };
    }
    return { ok: true, migrated: true };
  } catch (err) {
    console.error("[card-alias-store] save threw:", err);
    return { ok: false, migrated: true, error: err instanceof Error ? err.message : "Saving failed." };
  }
}

/** Delete one answer ("Forget"). `deleted` false = there was none. */
export async function forgetCardAlias(identity: string, deps: Deps = {}): Promise<CardAliasWrite & { deleted: boolean; cardKey: string | null }> {
  try {
    const admin = client(deps);
    if (!admin) return { ok: false, migrated: true, deleted: false, cardKey: null, error: "Supabase is not configured." };
    const { data, error } = await admin.from(CARD_ALIAS_TABLE).delete().eq("identity", identity).select("identity, card_key");
    if (error) {
      const missing = isCardAliasTableMissing(error);
      if (!missing) console.error("[card-alias-store] forget failed:", error.message);
      return { ok: false, migrated: !missing, deleted: false, cardKey: null, error: missing ? undefined : error.message };
    }
    const rows = (data as { identity: string; card_key: string }[] | null) ?? [];
    return { ok: true, migrated: true, deleted: rows.length > 0, cardKey: rows[0]?.card_key ?? null };
  } catch (err) {
    console.error("[card-alias-store] forget threw:", err);
    return { ok: false, migrated: true, deleted: false, cardKey: null, error: err instanceof Error ? err.message : "Forgetting failed." };
  }
}
