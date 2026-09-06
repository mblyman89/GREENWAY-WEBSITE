/**
 * src/lib/orders/order-name-pool-store.ts
 *
 * SLICE 113 — server-side reader/writer for the order-NAME pool
 * (migration 0147: public.order_name_pool).
 *
 * FALLBACK-SAFE: every function degrades to a no-op / empty result when the
 * table does not exist yet (Michael hasn't applied 0147) or Supabase is not
 * configured — it NEVER throws. That is what lets checkout keep working before
 * the migration: assignNextPoolName() simply returns null and the order keeps
 * its unique GWY-XXXXXX number.
 *
 * SERVER-ONLY (service-role client). Auth/permission checks live in the admin
 * actions, not here.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  normalizeOrderName,
  pickNextOrderName,
  previewNextOrderNames,
  validateOrderName,
  type OrderNamePoolRow,
} from "./order-name-pool-core";
import {
  parseBulkNames,
  previewRotation,
  rotationCapacity,
  type RotationCapacity,
  type RotationRow,
} from "./order-name-rotation-core";

const TABLE = "order_name_pool";
/**
 * SLICE 23 adds last_assigned_seq. Older databases (0221 unapplied) reject the
 * column outright, so every read tries the richer projection first and drops
 * back to the 0147 shape on a missing-column error rather than failing.
 */
const SELECT =
  "id, name, enabled, sort_order, last_assigned_seq, last_assigned_at, assigned_count";
const SELECT_LEGACY = "id, name, enabled, sort_order, last_assigned_at, assigned_count";

/** True when a PostgREST error means the table isn't there yet (0147 unapplied). */
function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  // 42P01 = undefined_table; PostgREST also reports "could not find the table".
  return (
    error.code === "42P01" ||
    /relation .* does not exist|could not find the table|schema cache/i.test(error.message ?? "")
  );
}

/**
 * SLICE 23 — true when the error means a COLUMN or FUNCTION from 0221 is
 * absent (the migration hasn't been applied). Distinct from a missing TABLE:
 * a missing column means "0147 is here, 0221 is not", which is a working
 * state we degrade into, not an error worth showing anyone.
 *
 * 42703 = undefined_column, 42883 = undefined_function. PostgREST also answers
 * PGRST202 ("could not find the function ... in the schema cache") when an RPC
 * name is unknown, which is the shape this actually takes over HTTP.
 */
function isMissingSchemaObjectError(
  error: { code?: string; message?: string } | null,
): boolean {
  if (!error) return false;
  return (
    error.code === "42703" ||
    error.code === "42883" ||
    error.code === "PGRST202" ||
    /column .* does not exist|function .* does not exist|could not find the function/i.test(
      error.message ?? "",
    )
  );
}

type SaveResult = { ok: boolean; error?: string };

/** SLICE 23 — a bulk add reports per-name outcomes, never a single pass/fail. */
export type BulkAddResult = {
  added: string[];
  /** Name → why it was skipped (duplicate, invalid, database error). */
  skipped: { name: string; reason: string }[];
  error?: string;
};

/** Read the full pool (all names, enabled + disabled), ordered for the admin list. */
export async function listPoolNames(): Promise<OrderNamePoolRow[]> {
  return (await listPoolNamesStatus()).names;
}

/**
 * Like {@link listPoolNames}, but also reports whether the pool table exists
 * (migration 0147 applied). Needed by the admin UI so it can distinguish an
 * empty pool ("add your first name") from an unapplied migration ("ask your
 * admin to finish setup") — both otherwise look like zero rows.
 */
export async function listPoolNamesStatus(): Promise<{
  names: OrderNamePoolRow[];
  migrationReady: boolean;
}> {
  if (!isSupabaseServiceConfigured) return { names: [], migrationReady: false };
  try {
    const admin = createSupabaseAdminClient();
    const read = (cols: string) =>
      admin
        .from(TABLE)
        .select(cols)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });

    // SLICE 23 ladder: ask for last_assigned_seq first; if 0221 isn't applied
    // the column is unknown, so retry with the 0147 projection. The rotation
    // core reads a missing seq as "never used", which is the correct meaning
    // on a database that has never rotated.
    let { data, error } = await read(SELECT);
    if (error && isMissingSchemaObjectError(error)) {
      ({ data, error } = await read(SELECT_LEGACY));
    }
    if (error) {
      // Table genuinely missing → migration not applied. Any OTHER error we
      // treat as "ready but transiently unreadable" so we don't nag Michael to
      // re-run a migration he already applied.
      return { names: [], migrationReady: !isMissingTableError(error) };
    }
    return { names: (data ?? []) as unknown as OrderNamePoolRow[], migrationReady: true };
  } catch {
    return { names: [], migrationReady: false };
  }
}

/**
 * SLICE 23 — the current value of the global assignment counter, WITHOUT
 * consuming one. Returns 0 when 0221 isn't applied or the counter has never
 * been advanced; the rotation core treats every un-stamped row as never-used,
 * so 0 is a correct starting point rather than a guess.
 */
export async function currentAssignmentSeq(): Promise<number> {
  if (!isSupabaseServiceConfigured) return 0;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc("current_order_name_seq");
    if (error) return 0;
    const n = typeof data === "number" ? data : Number(data);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * SLICE 23 — what the pool can actually promise, in the owner's own numbers.
 *
 * The owner asked that "no two of the same overlays can be used within a
 * certain number of uses". With P enabled names the best achievable spacing is
 * P - 1, so rather than imply a guarantee the arithmetic cannot support, this
 * reports the real ceiling and how many names would be needed to hit a target.
 */
export async function getRotationCapacity(
  targetGap?: number,
  dailyVolume?: number,
): Promise<RotationCapacity> {
  const pool = await listPoolNames();
  const enabled = pool.filter((r) => r.enabled).length;
  return rotationCapacity(enabled, targetGap, dailyVolume);
}

/** Add a name to the pool (appended at the end). Caller has validated + normalized. */
export async function addPoolName(name: string): Promise<SaveResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  const value = normalizeOrderName(name);
  if (!value) return { ok: false, error: "Enter a name." };
  try {
    const admin = createSupabaseAdminClient();
    // Append after the current max sort_order so new names land at the bottom.
    const { data: maxRow } = await admin
      .from(TABLE)
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle<{ sort_order: number }>();
    const nextSort = (maxRow?.sort_order ?? -1) + 1;
    const { error } = await admin.from(TABLE).insert({ name: value, sort_order: nextSort });
    if (error) {
      if (isMissingTableError(error)) {
        return { ok: false, error: "Order-name pool isn't set up yet (migration 0147 not applied)." };
      }
      // Unique-index violation → friendly duplicate message.
      if (error.code === "23505") return { ok: false, error: "That name is already in the pool." };
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not add the name." };
  }
}

/**
 * SLICE 23 — add many names at once from a pasted block.
 *
 * The owner asked for this so building the pool isn't fifty round trips. It
 * validates against the pool ONCE (one read), then inserts the survivors in a
 * single statement, and — critically — reports every skipped name with its
 * reason. Silently dropping half a pasted list would be the worst possible
 * behaviour here: the owner would believe names were added that were not.
 *
 * Duplicate detection is case-insensitive and covers BOTH directions: against
 * names already in the pool, and within the paste itself (parseBulkNames
 * collapses those, keeping the first spelling typed).
 */
export async function bulkAddPoolNames(raw: string): Promise<BulkAddResult> {
  if (!isSupabaseServiceConfigured) {
    return { added: [], skipped: [], error: "Database is not configured." };
  }
  const candidates = parseBulkNames(raw);
  if (candidates.length === 0) {
    return { added: [], skipped: [], error: "Paste at least one name." };
  }

  const skipped: BulkAddResult["skipped"] = [];
  try {
    const existing = await listPoolNames();
    const admin = createSupabaseAdminClient();

    const { data: maxRow } = await admin
      .from(TABLE)
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle<{ sort_order: number }>();
    let nextSort = (maxRow?.sort_order ?? -1) + 1;

    // Validate against the pool AS IT GROWS, so two identical names inside one
    // paste cannot both slip through on a stale snapshot.
    const running: Pick<OrderNamePoolRow, "id" | "name">[] = existing.map((r) => ({
      id: r.id,
      name: r.name,
    }));
    const rows: { name: string; sort_order: number }[] = [];

    for (const candidate of candidates) {
      const check = validateOrderName(running, candidate);
      if (!check.ok) {
        skipped.push({ name: candidate, reason: check.error ?? "Invalid name." });
        continue;
      }
      rows.push({ name: check.value, sort_order: nextSort++ });
      running.push({ id: `pending-${rows.length}`, name: check.value });
    }

    if (rows.length === 0) return { added: [], skipped };

    const { error } = await admin.from(TABLE).insert(rows);
    if (error) {
      if (isMissingTableError(error)) {
        return {
          added: [],
          skipped,
          error: "Order-name pool isn't set up yet (migration 0147 not applied).",
        };
      }
      return { added: [], skipped, error: error.message };
    }
    return { added: rows.map((r) => r.name), skipped };
  } catch (err) {
    return {
      added: [],
      skipped,
      error: err instanceof Error ? err.message : "Could not add the names.",
    };
  }
}

/** Rename an existing pool entry. Caller has validated + normalized. */
export async function updatePoolName(id: string, name: string): Promise<SaveResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  const value = normalizeOrderName(name);
  if (!value) return { ok: false, error: "Enter a name." };
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from(TABLE).update({ name: value }).eq("id", id);
    if (error) {
      if (error.code === "23505") return { ok: false, error: "That name is already in the pool." };
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not save the name." };
  }
}

/** Enable/disable a name (disabled names are kept but never assigned). */
export async function setPoolNameEnabled(id: string, enabled: boolean): Promise<SaveResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from(TABLE).update({ enabled }).eq("id", id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not update the name." };
  }
}

/** Remove a name from the pool entirely. */
export async function deletePoolName(id: string): Promise<SaveResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from(TABLE).delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not remove the name." };
  }
}

/** Persist a new manual order for the pool (array of ids in the desired order). */
export async function reorderPoolNames(orderedIds: string[]): Promise<SaveResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  try {
    const admin = createSupabaseAdminClient();
    // Write each row's new sort_order. Small list → a handful of updates is fine.
    for (let i = 0; i < orderedIds.length; i++) {
      const { error } = await admin
        .from(TABLE)
        .update({ sort_order: i })
        .eq("id", orderedIds[i]);
      if (error) return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not reorder the pool." };
  }
}

/**
 * A deterministic preview of the next `count` names the pool will assign.
 *
 * SLICE 23: this now simulates the SAME rotation the register runs (sequence
 * ordering, not wall clock), so what the admin screen promises is what the
 * next sales actually get. When 0221 isn't applied the counter reads 0 and
 * every row is un-stamped, which degrades to the 0147 order — still correct,
 * just without the gap guarantee.
 */
export async function previewNextNames(count: number): Promise<string[]> {
  const pool = await listPoolNames();
  if (pool.length === 0) return [];
  const seq = await currentAssignmentSeq();
  const preview = previewRotation(pool as RotationRow[], seq, count);
  // Belt and braces: if the rotation returns nothing (no enabled names) fall
  // back to the 0147 preview so the screen never goes mysteriously blank.
  return preview.length > 0 ? preview : previewNextOrderNames(pool, count);
}

/**
 * SLICE 23 — the LEGACY read-then-write claim, kept as the middle rung of the
 * fallback ladder. Used only when the atomic RPC is unavailable (0221 not yet
 * applied). Documented race: two simultaneous claims can read the same LRU
 * head. Harmless (display_name is non-unique) but it is exactly what the RPC
 * exists to eliminate, so this path is no longer the default.
 */
async function assignNextPoolNameLegacy(): Promise<string | null> {
  try {
    const pool = await listPoolNames();
    const pick = pickNextOrderName(pool);
    if (!pick) return null;
    const admin = createSupabaseAdminClient();
    await admin
      .from(TABLE)
      .update({
        last_assigned_at: new Date().toISOString(),
        assigned_count: (pick.assigned_count ?? 0) + 1,
      })
      .eq("id", pick.id);
    return pick.name;
  } catch {
    return null;
  }
}

/**
 * Claim the next pool name for a NEW order or walk-in sale.
 *
 * SLICE 23 — this is now an ATOMIC pick-and-stamp. The database function
 * assign_order_name() selects the least-recently-used enabled name, stamps it
 * with the next value of a monotonic counter, and returns it, all inside one
 * statement under an advisory lock. Two sales rung up in the same second
 * therefore cannot receive the same name — which the previous read-then-write
 * could not promise, and which stops being theoretical at ~200 sales a day.
 *
 * FALLBACK LADDER, in order, exactly as the owner asked for ("the fall back
 * can be to just use the real receipt number"):
 *
 *   1. assign_order_name() RPC             — atomic, gap-accurate  (0221)
 *   2. read-then-write LRU claim           — correct, slightly racy (0147)
 *   3. null → caller prints the REAL receipt number
 *
 * Rung 3 also covers the offline case the owner described: no server, no name,
 * and the receipt falls back to the number it always had. Nothing blocks a
 * sale on a name lookup — a customer never waits on a flourish.
 */
export async function assignNextPoolName(): Promise<string | null> {
  if (!isSupabaseServiceConfigured) return null;
  const detail = await assignNextPoolNameDetailed();
  return detail.name;
}

/** The assignment plus its gap, for callers that want to warn about a thin pool. */
export type AssignmentDetail = {
  name: string | null;
  /** Assignments since this name was last used; null when never used/unknown. */
  gap: number | null;
  /** Which rung of the ladder produced the answer. */
  source: "atomic" | "legacy" | "none";
};

export async function assignNextPoolNameDetailed(): Promise<AssignmentDetail> {
  if (!isSupabaseServiceConfigured) return { name: null, gap: null, source: "none" };
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc("assign_order_name");

    if (!error) {
      // The function RETURNS TABLE, so PostgREST delivers an array. Zero rows
      // is a real, meaningful answer: the pool is empty or fully disabled, so
      // the caller should print the real number. That is NOT a failure and
      // must not fall through to the legacy path, which would only repeat the
      // same empty read.
      const rows = Array.isArray(data) ? data : data ? [data] : [];
      const row = rows[0] as { name?: string | null; gap?: number | null } | undefined;
      const name = typeof row?.name === "string" && row.name.trim() !== "" ? row.name : null;
      const rawGap = row?.gap;
      const gap = typeof rawGap === "number" && Number.isFinite(rawGap) ? rawGap : null;
      return { name, gap, source: name ? "atomic" : "none" };
    }

    // Only a MISSING function/column sends us down the ladder. A transient
    // database error must not silently degrade to the racy path — it returns
    // no name, and the receipt shows the real number, which is always safe.
    if (isMissingSchemaObjectError(error)) {
      const legacy = await assignNextPoolNameLegacy();
      return { name: legacy, gap: null, source: legacy ? "legacy" : "none" };
    }
    return { name: null, gap: null, source: "none" };
  } catch {
    return { name: null, gap: null, source: "none" };
  }
}
