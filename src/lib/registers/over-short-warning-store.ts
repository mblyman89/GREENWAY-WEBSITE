/**
 * src/lib/registers/over-short-warning-store.ts  (Fix Phase 2.3 · G-03)
 *
 * Reads for the admin-only Over / short warnings screen
 * (/admin/registers/over-short): register drawers and master till counts
 * that were MORE than $5.00 over or short (owner D7, D16), with who, when,
 * how much and the reason. Read only: warnings never block anything.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  OVER_SHORT_WARN_MINOR,
  type DrawerWarningInput,
  type SafeWarningInput,
} from "@/lib/registers/over-short-warning-core";

/** Rows read per source. Far above a real store's warnings for a year. */
export const WARNING_READ_CAP = 500;

export type WarningSources = {
  drawers: DrawerWarningInput[];
  safeCounts: SafeWarningInput[];
  /** False when a read failed: the screen says so instead of showing "none". */
  drawersOk: boolean;
  safeOk: boolean;
  /** False before migration 0315 (reasons cannot be read yet). */
  reasonsReady: boolean;
  /** True when a source hit WARNING_READ_CAP (the screen says so). */
  capped: boolean;
};

const OUTSIDE = `over_short_minor.gt.${OVER_SHORT_WARN_MINOR},over_short_minor.lt.${-OVER_SHORT_WARN_MINOR}`;
const SAFE_OUTSIDE = `variance_minor.gt.${OVER_SHORT_WARN_MINOR},variance_minor.lt.${-OVER_SHORT_WARN_MINOR}`;

type DrawerRow = {
  id: string;
  register_id: string;
  business_day: string;
  over_short_minor: number | null;
  closed_by: string | null;
  second_counted_by?: string | null;
  reconciled_by?: string | null;
  closed_at: string | null;
  reconciled_at: string | null;
  over_short_reason?: string | null;
};

type SafeRow = {
  id: string;
  business_day: string;
  count_window: string;
  variance_minor: number;
  counted_by: string | null;
  counted_at: string;
  notes: string | null;
  variance_reason?: string | null;
};

function missingColumn(err: { code?: string } | null): boolean {
  return !!err && (err.code === "42703" || err.code === "PGRST204");
}

/** Warnings on or after `sinceDay` (YYYY-MM-DD, Pacific business day). */
export async function loadWarningSources(sinceDay: string): Promise<WarningSources> {
  const out: WarningSources = { drawers: [], safeCounts: [], drawersOk: false, safeOk: false, reasonsReady: true, capped: false };
  if (!isSupabaseServiceConfigured) return out;
  const admin = createSupabaseAdminClient();

  const drawerCols = (withReason: boolean) =>
    "id, register_id, business_day, over_short_minor, closed_by, second_counted_by, reconciled_by, closed_at, reconciled_at" +
    (withReason ? ", over_short_reason" : "");
  const readDrawers = (withReason: boolean) =>
    admin
      .from("drawer_sessions")
      .select(drawerCols(withReason))
      .gte("business_day", sinceDay)
      .or(OUTSIDE)
      .order("business_day", { ascending: false })
      .limit(WARNING_READ_CAP);
  let d = await readDrawers(true);
  if (missingColumn(d.error)) {
    out.reasonsReady = false;
    d = await readDrawers(false);
  }
  if (!d.error) {
    const rows = (d.data as unknown as DrawerRow[] | null) ?? [];
    out.drawersOk = true;
    if (rows.length >= WARNING_READ_CAP) out.capped = true;
    const regIds = [...new Set(rows.map((r) => r.register_id))];
    const names = new Map<string, string>();
    if (regIds.length > 0) {
      const { data: regs } = await admin.from("registers").select("id, name").in("id", regIds);
      for (const r of (regs as { id: string; name: string }[] | null) ?? []) names.set(r.id, r.name);
    }
    out.drawers = rows.map((r) => ({
      id: r.id,
      registerName: names.get(r.register_id) ?? "Register",
      businessDay: r.business_day,
      overShortMinor: r.over_short_minor,
      closedBy: r.closed_by,
      secondCountedBy: r.second_counted_by ?? null,
      reconciledBy: r.reconciled_by ?? null,
      closedAt: r.closed_at,
      reconciledAt: r.reconciled_at,
      reason: r.over_short_reason ?? null,
    }));
  }

  const safeCols = (withReason: boolean) =>
    "id, business_day, count_window, variance_minor, counted_by, counted_at, notes" + (withReason ? ", variance_reason" : "");
  const readSafe = (withReason: boolean) =>
    admin
      .from("safe_counts")
      .select(safeCols(withReason))
      .gte("business_day", sinceDay)
      .or(SAFE_OUTSIDE)
      .order("counted_at", { ascending: false })
      .limit(WARNING_READ_CAP);
  let s = await readSafe(true);
  if (missingColumn(s.error)) {
    out.reasonsReady = false;
    s = await readSafe(false);
  }
  if (!s.error) {
    const rows = (s.data as unknown as SafeRow[] | null) ?? [];
    out.safeOk = true;
    if (rows.length >= WARNING_READ_CAP) out.capped = true;
    out.safeCounts = rows.map((r) => ({
      id: r.id,
      businessDay: r.business_day,
      window: r.count_window,
      varianceMinor: r.variance_minor,
      countedBy: r.counted_by,
      countedAt: r.counted_at,
      reason: r.variance_reason ?? null,
      notes: r.notes,
    }));
  }
  return out;
}
