/**
 * src/lib/registers/safe-store.ts  (Feature slice 31 — master till / safe)
 *
 * Server-side persistence for the store safe: twice-daily manager counts
 * (safe_counts) and register-side change swaps (safe_swaps), both from
 * migration 0135.
 *
 * Missing-migration behavior: unlike the tips column (0134, best-effort),
 * a swap or count CANNOT be silently skipped — an untracked trip into the
 * safe is exactly what this feature exists to prevent. So writes return a
 * clear "run migration 0135" error instead, and reads return empty with a
 * `ready: false` flag the UI turns into a friendly note.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { businessDayFor } from "@/lib/staffing/time";
import { type DenomCounts } from "@/lib/registers/cash";
import {
  type SafeCountWindow,
  SAFE_TARGET_MINOR,
  validateSafeCount,
} from "@/lib/registers/safe-core";

const MIGRATION_HINT =
  "The safe tables aren't set up yet — run migration 0135_safe_counts_swaps.sql in the Supabase SQL editor.";

/** PostgREST error codes/messages that mean "the table doesn't exist". */
function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.code === "42P01") return true; // undefined_table
  return /relation .* does not exist|Could not find the table/i.test(err.message ?? "");
}

export type SafeCountRow = {
  id: string;
  business_day: string;
  count_window: SafeCountWindow;
  counted_by: string | null;
  total_minor: number;
  expected_minor: number;
  variance_minor: number;
  notes: string | null;
  counted_at: string;
} & DenomCounts;

export type SafeSwapRow = {
  id: string;
  session_id: string | null;
  device_id: string | null;
  amount_minor: number;
  performed_by: string | null;
  approved_by: string | null;
  notes: string | null;
  occurred_at: string;
};

/**
 * Record a manager count of the safe. Totals/variance are derived by the
 * pure validator — never trusted from the caller.
 */
export async function recordSafeCount(opts: {
  window: SafeCountWindow | string;
  denoms: DenomCounts;
  countedBy: string | null;
  notes?: string | null;
}): Promise<{ ok: true; varianceMinor: number } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };

  const validated = validateSafeCount({
    window: opts.window,
    denoms: opts.denoms,
    notes: opts.notes ?? undefined,
  });
  if (!validated.ok) return { ok: false, error: validated.error };
  const c = validated.count;

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("safe_counts").insert({
    business_day: businessDayFor(new Date().toISOString()),
    count_window: c.window,
    counted_by: opts.countedBy,
    ...c.denoms,
    total_minor: c.totalMinor,
    expected_minor: c.expectedMinor,
    variance_minor: c.varianceMinor,
    notes: c.notes ?? null,
  });
  if (error) {
    return { ok: false, error: isMissingTable(error) ? MIGRATION_HINT : error.message };
  }
  return { ok: true, varianceMinor: c.varianceMinor };
}

/**
 * Record a value-neutral change swap between a register drawer and the
 * safe. NEVER best-effort — a missing table refuses loudly.
 */
export async function recordSwap(opts: {
  sessionId: string | null;
  deviceId: string | null;
  amountMinor: number;
  performedBy: string | null;
  approvedBy: string | null;
  notes?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };
  if (opts.amountMinor <= 0) return { ok: false, error: "Swap amount must be greater than zero." };

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("safe_swaps").insert({
    session_id: opts.sessionId,
    device_id: opts.deviceId,
    amount_minor: opts.amountMinor,
    performed_by: opts.performedBy,
    approved_by: opts.approvedBy,
    notes: opts.notes ?? null,
  });
  if (error) {
    return { ok: false, error: isMissingTable(error) ? MIGRATION_HINT : error.message };
  }
  return { ok: true };
}

/** Recent safe counts, newest first. */
export async function listSafeCounts(limit = 30): Promise<{ ready: boolean; counts: SafeCountRow[] }> {
  if (!isSupabaseServiceConfigured) return { ready: false, counts: [] };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("safe_counts")
    .select("*")
    .order("counted_at", { ascending: false })
    .limit(limit);
  if (error) return { ready: !isMissingTable(error), counts: [] };
  return { ready: true, counts: (data as SafeCountRow[] | null) ?? [] };
}

/** Recent swaps, newest first. */
export async function listSwaps(limit = 30): Promise<{ ready: boolean; swaps: SafeSwapRow[] }> {
  if (!isSupabaseServiceConfigured) return { ready: false, swaps: [] };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("safe_swaps")
    .select("*")
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (error) return { ready: !isMissingTable(error), swaps: [] };
  return { ready: true, swaps: (data as SafeSwapRow[] | null) ?? [] };
}

export type SafeStatus = {
  /** false = migration 0135 not applied (or DB unavailable). */
  ready: boolean;
  targetMinor: number;
  /** Latest count on record, if any. */
  latest: SafeCountRow | null;
  /** Which of today's two policy counts are done. */
  todayAmDone: boolean;
  todayPmDone: boolean;
};

/** Current safe status for the back-office page. */
export async function safeStatus(): Promise<SafeStatus> {
  const base: SafeStatus = {
    ready: false,
    targetMinor: SAFE_TARGET_MINOR,
    latest: null,
    todayAmDone: false,
    todayPmDone: false,
  };
  const { ready, counts } = await listSafeCounts(60);
  if (!ready) return base;
  const today = businessDayFor(new Date().toISOString());
  return {
    ...base,
    ready: true,
    latest: counts[0] ?? null,
    todayAmDone: counts.some((c) => c.business_day === today && c.count_window === "am"),
    todayPmDone: counts.some((c) => c.business_day === today && c.count_window === "pm"),
  };
}
