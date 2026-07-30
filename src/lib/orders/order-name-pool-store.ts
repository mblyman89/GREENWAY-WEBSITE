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
  type OrderNamePoolRow,
} from "./order-name-pool-core";

const TABLE = "order_name_pool";
const SELECT = "id, name, enabled, sort_order, last_assigned_at, assigned_count";

/** True when a PostgREST error means the table isn't there yet (0147 unapplied). */
function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  // 42P01 = undefined_table; PostgREST also reports "could not find the table".
  return (
    error.code === "42P01" ||
    /relation .* does not exist|could not find the table|schema cache/i.test(error.message ?? "")
  );
}

type SaveResult = { ok: boolean; error?: string };

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
    const { data, error } = await admin
      .from(TABLE)
      .select(SELECT)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) {
      // Table genuinely missing → migration not applied. Any OTHER error we
      // treat as "ready but transiently unreadable" so we don't nag Michael to
      // re-run a migration he already applied.
      return { names: [], migrationReady: !isMissingTableError(error) };
    }
    return { names: (data ?? []) as OrderNamePoolRow[], migrationReady: true };
  } catch {
    return { names: [], migrationReady: false };
  }
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

/** A deterministic preview of the next `count` names the pool will assign. */
export async function previewNextNames(count: number): Promise<string[]> {
  const pool = await listPoolNames();
  return previewNextOrderNames(pool, count);
}

/**
 * Claim the next pool name for a NEW order (LRU): read the current pool, pick
 * the least-recently-used ENABLED name, stamp its last_assigned_at + bump its
 * assigned_count, and return the name. Returns null when the pool is
 * empty/all-disabled OR the table doesn't exist yet — the caller then leaves
 * display_name null and the order keeps its GWY-XXXXXX number.
 *
 * NOTE: this is a read-then-write claim, not a transaction. Online-order volume
 * is low (roadmap), so two near-simultaneous orders briefly sharing a name is
 * acceptable AND harmless — display_name is intentionally non-unique and the
 * unique order_number remains the true key. This keeps checkout fast and never
 * blocks placement on a lock.
 */
export async function assignNextPoolName(): Promise<string | null> {
  if (!isSupabaseServiceConfigured) return null;
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
