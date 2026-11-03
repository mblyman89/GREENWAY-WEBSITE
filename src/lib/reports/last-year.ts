import "server-only";

/**
 * src/lib/reports/last-year.ts  (CVB-10, server-only)
 *
 * Loads "Same period last year" for Reports → Overview and Sales. Both sides are read here on ONE basis (completed
 * orders' tax-inclusive totals, item counts, Pacific placed_at days), so the change is like for like:
 *   Greenway days   public.orders (status completed)
 *   Cultivera days  public.cultivera_history_days (0338), before the cut-over, owner only
 * Every read checks its error; a failed read is "could not be read", never an empty period.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";
import { pacificWallTimeToUtcISO } from "@/lib/reports/timezone";
import { isRevenueOrder } from "@/lib/reports/revenue-basis";
import { cutoverDate } from "@/lib/reports/cultivera-benchmark-report-store";
import { historyDays } from "@/lib/reports/cultivera-history-store";
import { comparePeriod, type LastYearComparison, type Segment, type Totals } from "@/lib/reports/last-year-core";

const MAX_ROWS = 300_000;

function dayCount(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
}

/** Greenway completed-order totals for Pacific days from..to, or null when the read failed / was incomplete. */
export async function greenwayTotals(from: string, to: string): Promise<Totals | null> {
  const admin = createSupabaseAdminClient();
  type Row = { id: string; status: string; total_minor_units: number | null; item_count: number | null };
  const { rows, verdict } = await pagedAllChecked<Row>(
    async (a, b) => {
      const { data, error } = await admin
        .from("orders")
        .select("id, status, total_minor_units, item_count")
        .gte("placed_at", pacificWallTimeToUtcISO(from, "start"))
        .lte("placed_at", pacificWallTimeToUtcISO(to, "end"))
        .eq("status", "completed")
        .order("id", { ascending: true })
        .range(a, b);
      if (error) return { rows: [], ok: false };
      return { rows: (data as Row[] | null) ?? [], ok: true };
    },
    { maxRows: MAX_ROWS },
  );
  if (!verdict.complete) return null;
  const t: Totals = { revenueMinor: 0, orders: 0, units: 0, days: dayCount(from, to) };
  for (const r of rows) {
    if (!isRevenueOrder(r.status)) continue;
    t.revenueMinor += r.total_minor_units ?? 0;
    t.orders += 1;
    t.units += r.item_count ?? 0;
  }
  return t;
}

async function cultiveraTotals(from: string, to: string): Promise<Totals | null> {
  try {
    const days = await historyDays(from, to);
    const t: Totals = { revenueMinor: 0, orders: 0, units: 0, days: dayCount(from, to) };
    for (const d of days) {
      t.revenueMinor += d.revenue_minor;
      t.orders += d.orders;
      t.units += d.units;
    }
    t.units = Math.round(t.units * 1000) / 1000;
    return t;
  } catch {
    return null;
  }
}

export type LastYearResult = { comparison: LastYearComparison | null; error: string | null };

/** This period (Pacific from..to) vs the same calendar days a year earlier, split at the cut-over. */
export async function getLastYearComparison(from: string, to: string, canSeeCultivera: boolean): Promise<LastYearResult> {
  if (!isSupabaseServiceConfigured) return { comparison: null, error: null };
  try {
    const [now, cutover] = await Promise.all([greenwayTotals(from, to), cutoverDate()]);
    if (!now) return { comparison: null, error: "This period's orders could not be read completely." };
    // Load each segment first (async), then hand the pure core a lookup.
    const probe = comparePeriod({ from, to, now, cutover, canSeeCultivera, partTotals: () => null });
    if (!probe) return { comparison: null, error: null };
    const loaded = new Map<string, Totals | null>();
    await Promise.all(
      probe.parts
        .filter((p) => !p.hidden)
        .map(async (p) => {
          const s = p.segment;
          loaded.set(`${s.source}:${s.from}`, s.source === "cultivera" ? await cultiveraTotals(s.from, s.to) : await greenwayTotals(s.from, s.to));
        }),
    );
    const comparison = comparePeriod({
      from, to, now, cutover, canSeeCultivera,
      partTotals: (s: Segment) => loaded.get(`${s.source}:${s.from}`) ?? null,
    });
    return { comparison, error: null };
  } catch (e) {
    return { comparison: null, error: e instanceof Error ? e.message : "Last year could not be read." };
  }
}
