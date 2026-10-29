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
import { pacificWallTimeToUtcISO } from "@/lib/reports/timezone";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";
import { type DenomCounts } from "@/lib/registers/cash";
import {
  type SafeCountWindow,
  SAFE_TARGET_MINOR,
  validateSafeCount,
} from "@/lib/registers/safe-core";
import { checkOverShortReason, isMissingReasonColumn, isOverShortWarning } from "@/lib/registers/over-short-warning-core";

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
  /** Fix Phase 2.3 (0315, G-03): why it was over or short. */
  variance_reason?: string | null;
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
  /** Fix Phase 2.7b (0317, F-01-8): big bills IN from the till; null before 0317. */
  in_denoms?: Partial<DenomCounts> | null;
  /** Fix Phase 2.7b (0317, F-01-8): change OUT to the till; null before 0317. */
  out_denoms?: Partial<DenomCounts> | null;
};

/** Fix Phase 2.7b (0317, G-02, owner D3): one master till <-> little safe exchange. */
export type LittleSafeExchangeRow = {
  id: string;
  business_day: string;
  out_denoms: Partial<DenomCounts>;
  in_denoms: Partial<DenomCounts>;
  value_minor: number;
  recorded_by: string | null;
  notes: string | null;
  occurred_at: string;
};

const EXCHANGE_MIGRATION_HINT =
  "The little safe exchange log is not set up yet \u2014 run migration 0317_little_safe_exchanges.sql in the Supabase SQL editor. Nothing was saved; use paper form 8.2 (SOP-02 \u00a74.10) until then.";

/** A missing 0317 column on safe_swaps (in_denoms / out_denoms). */
function isMissingSwapDenoms(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  // Only when the error names one of the two new columns: any other error
  // (a refused check, a lost connection) must fail the swap, not drop bills.
  return /\b(in_denoms|out_denoms)\b/.test(err.message ?? "") && /column|schema cache/i.test(err.message ?? "");
}

/**
 * Record a manager count of the safe. Totals/variance are derived by the
 * pure validator — never trusted from the caller.
 *
 * Fix Phase 2.3 (G-03, owner D7 / D16 / D21): a master till count more than
 * $5.00 over or short needs a written reason, checked here against the
 * variance this function works out (never a number the page sent). The
 * caller must name who counted (D7: "Who"); the action checks the person is
 * an active employee.
 */
export async function recordSafeCount(opts: {
  window: SafeCountWindow | string;
  denoms: DenomCounts;
  countedBy: string | null;
  notes?: string | null;
  varianceReason?: string | null;
}): Promise<
  | { ok: true; varianceMinor: number; id: string | null; reason: string | null; reasonSaved: boolean; warning: boolean }
  | { ok: false; error: string; varianceMinor?: number }
> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };

  const validated = validateSafeCount({
    window: opts.window,
    denoms: opts.denoms,
    notes: opts.notes ?? undefined,
  });
  if (!validated.ok) return { ok: false, error: validated.error };
  const c = validated.count;
  if (!opts.countedBy) {
    return { ok: false, error: "Pick who counted the master till (Counted by). Nothing was saved." };
  }
  const reasonCheck = checkOverShortReason(c.varianceMinor, opts.varianceReason ?? "", "The master till");
  if (!reasonCheck.ok) return { ok: false, error: reasonCheck.error, varianceMinor: c.varianceMinor };
  const reason = reasonCheck.reason;

  const admin = createSupabaseAdminClient();
  const row = {
    business_day: businessDayFor(new Date().toISOString()),
    count_window: c.window,
    counted_by: opts.countedBy,
    ...c.denoms,
    total_minor: c.totalMinor,
    expected_minor: c.expectedMinor,
    variance_minor: c.varianceMinor,
    notes: c.notes ?? null,
  };
  let reasonSaved = true;
  let { data, error } = await admin
    .from("safe_counts")
    .insert({ ...row, variance_reason: reason })
    .select("id")
    .single();
  // Before migration 0315 there is no reason column: the count still lands
  // (a count must never be lost) and the reason is kept in the audit entry.
  if (error && isMissingReasonColumn(error)) {
    reasonSaved = false;
    ({ data, error } = await admin.from("safe_counts").insert(row).select("id").single());
  }
  if (error) {
    return { ok: false, error: isMissingTable(error) ? MIGRATION_HINT : error.message };
  }
  return {
    ok: true,
    varianceMinor: c.varianceMinor,
    id: (data as { id: string } | null)?.id ?? null,
    reason,
    reasonSaved: reason ? reasonSaved : true,
    warning: isOverShortWarning(c.varianceMinor),
  };
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
  /**
   * Fix Phase 2.7b (F-01-8): the bills both ways, already checked equal to
   * the amount (little-safe-core#checkSwapDenoms). Null from an iPad build
   * made before 2.7b.
   */
  inDenoms?: Partial<DenomCounts> | null;
  outDenoms?: Partial<DenomCounts> | null;
}): Promise<{ ok: boolean; error?: string; billsSaved?: boolean }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };
  if (opts.amountMinor <= 0) return { ok: false, error: "Swap amount must be greater than zero." };

  const admin = createSupabaseAdminClient();
  const base: Record<string, unknown> = {
    session_id: opts.sessionId,
    device_id: opts.deviceId,
    amount_minor: opts.amountMinor,
    performed_by: opts.performedBy,
    approved_by: opts.approvedBy,
    notes: opts.notes ?? null,
  };
  const hasBills = !!opts.inDenoms && !!opts.outDenoms;
  const { error } = await admin
    .from("safe_swaps")
    .insert(hasBills ? { ...base, in_denoms: opts.inDenoms, out_denoms: opts.outDenoms } : base);
  if (error) {
    // Before 0317 the columns do not exist: the swap itself must still be
    // recorded (its value and approver); the bills stay in the Security Log.
    if (hasBills && isMissingSwapDenoms(error)) {
      const retry = await admin.from("safe_swaps").insert(base);
      if (retry.error) {
        return { ok: false, error: isMissingTable(retry.error) ? MIGRATION_HINT : retry.error.message };
      }
      return { ok: true, billsSaved: false };
    }
    return { ok: false, error: isMissingTable(error) ? MIGRATION_HINT : error.message };
  }
  return { ok: true, billsSaved: hasBills };
}

/**
 * Fix Phase 2.7b (G-02, owner D3): record one master till <-> little safe
 * exchange. The caller has already checked the two sides are equal
 * (little-safe-core#validateExchange); the database checks it again (0317
 * little_safe_exchanges_sides_equal). NEVER best-effort: before 0317 it
 * refuses and says so.
 */
export async function recordLittleSafeExchange(opts: {
  outDenoms: Partial<DenomCounts>;
  inDenoms: Partial<DenomCounts>;
  valueMinor: number;
  recordedBy: string;
  notes: string | null;
}): Promise<{ ok: true; id: string | null } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };
  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("little_safe_exchanges")
    .insert({
      business_day: businessDayFor(now),
      out_denoms: opts.outDenoms,
      in_denoms: opts.inDenoms,
      value_minor: opts.valueMinor,
      recorded_by: opts.recordedBy,
      notes: opts.notes,
      occurred_at: now,
    })
    .select("id")
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) return { ok: false, error: EXCHANGE_MIGRATION_HINT };
    if (/little_safe_exchanges_sides_equal/.test(error.message ?? "")) {
      return { ok: false, error: "The database refused it: the two sides are not the same value. Recount both sides. Nothing was saved." };
    }
    return { ok: false, error: `${error.message} Nothing was saved.` };
  }
  return { ok: true, id: (data as { id: string } | null)?.id ?? null };
}

/**
 * Fix Phase 2.7b (G-02 requirements 3 and 5): every exchange with a business
 * day From..To (inclusive), newest first, read in full pages. Before 0317,
 * ready is false (the page says so); a read that fails part-way is reported.
 */
export async function listLittleSafeExchangesRange(
  from: string,
  to: string,
): Promise<{ ready: boolean; exchanges: LittleSafeExchangeRow[]; error: string | null }> {
  if (!isSupabaseServiceConfigured) return { ready: false, exchanges: [], error: null };
  const admin = createSupabaseAdminClient();
  let missing = false;
  let firstError: string | null = null;
  const read = await pagedAllChecked<LittleSafeExchangeRow>(async (a, b) => {
    const { data, error } = await admin
      .from("little_safe_exchanges")
      .select("*")
      .gte("business_day", from)
      .lte("business_day", to)
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: true })
      .range(a, b);
    if (error) {
      if (isMissingTable(error)) missing = true;
      firstError ??= error.message;
      return { rows: [], ok: false };
    }
    return { rows: (data as LittleSafeExchangeRow[] | null) ?? [], ok: true };
  });
  if (missing) return { ready: false, exchanges: [], error: null };
  if (!read.verdict.complete) {
    return { ready: true, exchanges: read.rows, error: firstError ?? read.verdict.message };
  }
  return { ready: true, exchanges: read.rows, error: null };
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

/**
 * Fix Phase 2.7a (G-09 requirement 3, F-02-13): every count with a business
 * day From..To (inclusive), newest first, read in full pages. A read that
 * fails part-way is reported (`error`), never shown as a short list.
 */
export async function listSafeCountsRange(
  from: string,
  to: string,
): Promise<{ ready: boolean; counts: SafeCountRow[]; error: string | null }> {
  if (!isSupabaseServiceConfigured) return { ready: false, counts: [], error: null };
  const admin = createSupabaseAdminClient();
  let missing = false;
  let firstError: string | null = null;
  const read = await pagedAllChecked<SafeCountRow>(async (a, b) => {
    const { data, error } = await admin
      .from("safe_counts")
      .select("*")
      .gte("business_day", from)
      .lte("business_day", to)
      .order("counted_at", { ascending: false })
      .order("id", { ascending: true })
      .range(a, b);
    if (error) {
      if (isMissingTable(error)) missing = true;
      firstError ??= error.message;
      return { rows: [], ok: false };
    }
    return { rows: (data as SafeCountRow[] | null) ?? [], ok: true };
  });
  if (missing) return { ready: false, counts: [], error: null };
  if (!read.verdict.complete) {
    return { ready: true, counts: read.rows, error: firstError ?? read.verdict.message };
  }
  return { ready: true, counts: read.rows, error: null };
}

/**
 * Fix Phase 2.7a (G-09, F-02-13): every register change swap between the
 * start of From and the end of To (Pacific), newest first, read in full pages.
 */
export async function listSwapsRange(
  from: string,
  to: string,
): Promise<{ ready: boolean; swaps: SafeSwapRow[]; error: string | null }> {
  if (!isSupabaseServiceConfigured) return { ready: false, swaps: [], error: null };
  const admin = createSupabaseAdminClient();
  const start = pacificWallTimeToUtcISO(from, "start");
  const end = pacificWallTimeToUtcISO(to, "end");
  let missing = false;
  let firstError: string | null = null;
  const read = await pagedAllChecked<SafeSwapRow>(async (a, b) => {
    const { data, error } = await admin
      .from("safe_swaps")
      .select("*")
      .gte("occurred_at", start)
      .lte("occurred_at", end)
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: true })
      .range(a, b);
    if (error) {
      if (isMissingTable(error)) missing = true;
      firstError ??= error.message;
      return { rows: [], ok: false };
    }
    return { rows: (data as SafeSwapRow[] | null) ?? [], ok: true };
  });
  if (missing) return { ready: false, swaps: [], error: null };
  if (!read.verdict.complete) {
    return { ready: true, swaps: read.rows, error: firstError ?? read.verdict.message };
  }
  return { ready: true, swaps: read.rows, error: null };
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
