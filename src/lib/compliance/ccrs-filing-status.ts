import "server-only";

/**
 * src/lib/compliance/ccrs-filing-status.ts  (Slice 106)
 *
 * SERVER reader that turns the raw `ccrs_export_batches` audit log into a
 * monthly reporting-deadline picture, so the back office can flag an UNFILED
 * period BEFORE it goes past the statutory due date.
 *
 * VERIFIED FACT — two distinct WA cannabis-retail obligations (see
 * docs/COMPLIANCE_HARDENING_ROADMAP.md, grounded in LCB guides + WAC/RCW):
 *   1. CCRS file uploads are WEEKLY seed-to-sale traceability (WAC 314-55-083).
 *   2. The LIQ-1295 Retailer Sales & Tax report + excise PAYMENT is MONTHLY,
 *      due the 20th of the following month (rolled off weekends/holidays), even
 *      with no sales; a 2% late penalty accrues after the due date
 *      (RCW 69.50.535, WAC 314-55-089 / 314-55-092).
 *
 * This reader models obligation #2 — the one with a hard statutory date and a
 * money penalty. Whether a sales month has been "handled" is inferred from
 * whether a full-calendar-month export exists on record in `ccrs_export_batches`
 * (range_from / range_to). We label this HONESTLY as "export on record" — it is
 * evidence that the owner generated the month's file, NOT proof that the LCB
 * filing/payment was completed. The owner remains the source of truth.
 *
 * All the date math lives in the PURE, tsx-tested `ccrs-deadline-core`; this file
 * only does I/O (Supabase read) + assembly.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  monthsFullyCoveredByRange,
  reportingDeadlineOverview,
  type PeriodDeadline,
} from "@/lib/compliance/ccrs-deadline-core";

export type CcrsFilingOverview = {
  /** True when we could read the export log (service configured + query ok). */
  available: boolean;
  /** Newest-first monthly deadlines over the lookback window. */
  periods: PeriodDeadline[];
  /** Single most urgent UNFILED period (oldest overdue first), or null. */
  mostUrgent: PeriodDeadline | null;
  /** Any period past due without an export on record. */
  anyOverdue: boolean;
  /** "YYYY-MM" keys with a full-month export on record (informational). */
  exportedMonths: string[];
};

const EMPTY: CcrsFilingOverview = {
  available: false,
  periods: [],
  mostUrgent: null,
  anyOverdue: false,
  exportedMonths: [],
};

/**
 * Read `ccrs_export_batches`, derive which sales months have a full-month export
 * on record, and compute the monthly deadline overview relative to `todayIso`.
 *
 * @param todayIso   ISO YYYY-MM-DD "today" (caller supplies for testability).
 * @param opts.holidays        optional ISO holiday dates that also roll the 20th.
 * @param opts.soonDays        "due soon" window in days (default 5).
 * @param opts.lookbackMonths  how many prior months to evaluate (default 3).
 */
export async function getCcrsFilingOverview(
  todayIso: string,
  opts?: { holidays?: ReadonlySet<string>; soonDays?: number; lookbackMonths?: number },
): Promise<CcrsFilingOverview> {
  if (!isSupabaseServiceConfigured) return EMPTY;

  let rows: { range_from: string; range_to: string }[] = [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("ccrs_export_batches")
      .select("range_from, range_to")
      .order("range_from", { ascending: false })
      .limit(500);
    if (error) return EMPTY;
    rows = (data as typeof rows | null) ?? [];
  } catch {
    return EMPTY;
  }

  // Union of every full calendar month any export batch fully covers.
  const exported = new Set<string>();
  for (const r of rows) {
    if (!r?.range_from || !r?.range_to) continue;
    for (const key of monthsFullyCoveredByRange(r.range_from, r.range_to)) {
      exported.add(key);
    }
  }

  const overview = reportingDeadlineOverview(todayIso, exported, {
    holidays: opts?.holidays,
    soonDays: opts?.soonDays,
    lookbackMonths: opts?.lookbackMonths,
  });

  return {
    available: true,
    periods: overview.periods,
    mostUrgent: overview.mostUrgentUnfiled,
    anyOverdue: overview.anyOverdue,
    exportedMonths: Array.from(exported).sort().reverse(),
  };
}
