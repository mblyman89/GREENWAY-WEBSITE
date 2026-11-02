import "server-only";
/**
 * src/lib/reports/cultivera-benchmark-report-store.ts  (CVB-6)
 *
 * The reads behind Reports -> Cultivera Benchmark. Owner only (the page and every action check
 * "cultivera.benchmark"). Read-only: the only write in CVB-6 is the payback ledger insert, done by the actions
 * through cultivera-benchmark-store.insertPaybackEntry.
 *
 *   cutoverDate()        gl_conversion_config.cutover_date (migration 0186): the first day the business ran on
 *                        this platform. Our side starts there. Missing = our side is not shown (never guessed).
 *   loadOurDays()        completed orders on the canonical completed_at basis (placed_at fallback for legacy
 *                        rows, docs/PERIOD_BASIS.md), their lines, the WA medical exemptions, each order's own
 *                        cost entry in the books (order:<id>#cogs, draft or posted) and our customer returns,
 *                        folded per Pacific day by the pure core.
 *   buildBenchmark()     our period vs Cultivera's same calendar period one year earlier, through the CVB-4
 *                        comparison engine, with Cultivera's own formulas measured on the compared days.
 *
 * Every database read checks its error and throws a plain message: a failed read is never an empty period.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { ADMIN_PAGED_CONCURRENCY, chunkedIn, pagedAll } from "@/lib/supabase/chunked-in";
import { pacificDayKey, pacificToday, pacificWallTimeToUtcISO } from "@/lib/reports/timezone";
import { getCannabisCategorySet, getTaxSettings, isCannabisCategory } from "@/lib/reports/tax";
import { buildCategoryLookup } from "@/lib/reports/wa-tax";
import {
  comparePeriods,
  samePeriodLastYear,
  sumPeriod,
  type BenchmarkDayRow,
  type PeriodComparison,
} from "@/lib/reports/cultivera-benchmark-core";
import {
  buildOurDays,
  dayList,
  measureIdentities,
  ourLiveWindow,
  ourPeriodTotals,
  type Identities,
  type OurDay,
  type OurLine,
  type OurOrder,
  type OurPeriod,
} from "@/lib/reports/cultivera-benchmark-report-core";
import { benchmarkDays } from "@/lib/reports/cultivera-benchmark-store";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

const fail = (what: string, e: { message?: string } | null | undefined): never => {
  throw new Error(`Could not read ${what}: ${e?.message ?? "unknown error"}`);
};

/** The first Pacific day on this platform (0186), or null when the row is missing. */
export async function cutoverDate(admin: Admin = createSupabaseAdminClient()): Promise<string | null> {
  const { data, error } = await admin.from("gl_conversion_config").select("cutover_date").eq("id", 1).maybeSingle();
  if (error) fail("the cut-over date", error);
  const d = (data as { cutover_date?: string } | null)?.cutover_date;
  return d ? String(d).slice(0, 10) : null;
}

/** Our per-day figures for the Pacific days from..to (all must be live days; the caller clips). */
export async function loadOurDays(from: string, to: string): Promise<OurDay[]> {
  const admin = createSupabaseAdminClient();
  const fromISO = pacificWallTimeToUtcISO(from, "start");
  const toISO = pacificWallTimeToUtcISO(to, "end");

  const [settings, cannabisSet, categoryLookup] = await Promise.all([getTaxSettings(), getCannabisCategorySet(), buildCategoryLookup(admin)]);

  type OrderRow = { id: string; placed_at: string; completed_at: string | null };
  const orderRows = await pagedAll<OrderRow>(
    async (f, t) => {
      const { data, error } = await admin
        .from("orders")
        .select("id, placed_at, completed_at")
        .eq("status", "completed")
        .or(`and(completed_at.gte.${fromISO},completed_at.lte.${toISO}),and(completed_at.is.null,placed_at.gte.${fromISO},placed_at.lte.${toISO})`)
        .order("id", { ascending: true })
        .range(f, t);
      if (error) fail("completed orders", error);
      return (data as OrderRow[] | null) ?? [];
    },
    { concurrency: ADMIN_PAGED_CONCURRENCY },
  );
  const orders: OurOrder[] = orderRows.map((o) => ({ id: o.id, day: pacificDayKey(o.completed_at ?? o.placed_at) }));
  const ids = orders.map((o) => o.id);

  type LineRow = { order_id: string; product_id: string | null; quantity: number; price_minor_units: number; regular_price_minor_units: number | null };
  const lineRows = ids.length
    ? await chunkedIn<string, LineRow>(
        ids,
        async (chunk, f, t) => {
          const { data, error } = await admin
            .from("order_lines")
            .select("order_id, product_id, quantity, price_minor_units, regular_price_minor_units")
            .in("order_id", chunk)
            .order("id", { ascending: true })
            .range(f, t);
          if (error) fail("order lines", error);
          return (data as LineRow[] | null) ?? [];
        },
        { concurrency: ADMIN_PAGED_CONCURRENCY },
      )
    : [];

  // WAC 314-55-090(2) medical exemptions, joined exactly as the WA tax report does (order_id + product_sku).
  type ExemptRow = { order_id: string | null; product_sku: string | null; sales_tax_exempt: boolean | null; excise_tax_exempt: boolean | null };
  const exemptRows = await pagedAll<ExemptRow>(
    async (f, t) => {
      const { data, error } = await admin
        .from("medical_exempt_sales")
        .select("order_id, product_sku, sales_tax_exempt, excise_tax_exempt, id")
        .gte("sale_date", from)
        .lte("sale_date", to)
        .order("id", { ascending: true })
        .range(f, t);
      if (error) fail("medical exempt sales", error);
      return (data as ExemptRow[] | null) ?? [];
    },
    { concurrency: ADMIN_PAGED_CONCURRENCY },
  );
  const exempt = new Map<string, { s: boolean; e: boolean }>();
  for (const r of exemptRows) {
    if (!r.order_id || !r.product_sku) continue;
    const k = `${r.order_id}|${r.product_sku}`;
    const prev = exempt.get(k);
    exempt.set(k, { s: (prev?.s ?? false) || r.sales_tax_exempt === true, e: (prev?.e ?? false) || r.excise_tax_exempt === true });
  }

  const lines: OurLine[] = lineRows.map((l) => {
    const meta = l.product_id ? categoryLookup.get(l.product_id) : undefined;
    const ex = l.product_id ? exempt.get(`${l.order_id}|${l.product_id}`) : undefined;
    return {
      orderId: l.order_id,
      quantity: Number(l.quantity ?? 0),
      priceMinor: Number(l.price_minor_units ?? 0),
      regularPriceMinor: l.regular_price_minor_units === null || l.regular_price_minor_units === undefined ? null : Number(l.regular_price_minor_units),
      isCannabis: isCannabisCategory(meta?.category ?? "", cannabisSet),
      salesExempt: ex?.s === true,
      exciseExempt: ex?.e === true,
    };
  });

  // Each sale's own cost entry (order:<id>#cogs): the debits are the cost. More than one entry = unknown.
  type JournalRow = { id: string; source_ref: string };
  const refs = ids.map((id) => `order:${id}#cogs`);
  const journals = refs.length
    ? await chunkedIn<string, JournalRow>(
        refs,
        async (chunk, f, t) => {
          const { data, error } = await admin
            .from("gl_journals")
            .select("id, source_ref")
            .in("source_ref", chunk)
            .in("status", ["draft", "posted"])
            .order("id", { ascending: true })
            .range(f, t);
          if (error) fail("the cost entries", error);
          return (data as JournalRow[] | null) ?? [];
        },
        { concurrency: ADMIN_PAGED_CONCURRENCY },
      )
    : [];
  const journalsByOrder = new Map<string, string[]>();
  for (const j of journals) {
    const id = j.source_ref.slice("order:".length, -"#cogs".length);
    journalsByOrder.set(id, [...(journalsByOrder.get(id) ?? []), j.id]);
  }
  const single = new Map<string, string>();
  for (const [orderId, js] of journalsByOrder) if (js.length === 1) single.set(js[0], orderId);
  type JLine = { journal_id: string; amount_cents: number | string };
  const jlines = single.size
    ? await chunkedIn<string, JLine>(
        [...single.keys()],
        async (chunk, f, t) => {
          const { data, error } = await admin
            .from("gl_journal_lines")
            .select("journal_id, amount_cents, id")
            .in("journal_id", chunk)
            .order("id", { ascending: true })
            .range(f, t);
          if (error) fail("the cost entry lines", error);
          return (data as JLine[] | null) ?? [];
        },
        { concurrency: ADMIN_PAGED_CONCURRENCY },
      )
    : [];
  const costByOrder = new Map<string, number>();
  for (const orderId of single.values()) costByOrder.set(orderId, 0);
  for (const l of jlines) {
    const orderId = single.get(l.journal_id);
    const amt = Number(l.amount_cents);
    if (!orderId || !Number.isSafeInteger(amt)) continue;
    if (amt > 0) costByOrder.set(orderId, (costByOrder.get(orderId) ?? 0) + amt);
  }

  type ReturnRow = { created_at: string };
  const returnRows = await pagedAll<ReturnRow>(
    async (f, t) => {
      const { data, error } = await admin
        .from("customer_returns")
        .select("created_at, id")
        .gte("created_at", fromISO)
        .lte("created_at", toISO)
        .order("id", { ascending: true })
        .range(f, t);
      if (error) fail("customer returns", error);
      return (data as ReturnRow[] | null) ?? [];
    },
    { concurrency: ADMIN_PAGED_CONCURRENCY },
  );

  return buildOurDays({
    liveDays: dayList(from, to),
    orders,
    lines,
    costByOrder,
    returnDays: returnRows.map((r) => pacificDayKey(r.created_at)),
    rates: { combinedSalesRateBps: settings.stateSalesRateBps + settings.localSalesRateBps, exciseRateBps: settings.exciseRateBps },
  });
}

export type Benchmark = {
  from: string;
  to: string;
  today: string;
  cutover: string | null;
  /** The part of from..to our system was live for (null = none). */
  live: { from: string; to: string } | null;
  theirsRange: { from: string; to: string } | null;
  theirDays: BenchmarkDayRow[];
  ids: Identities;
  ours: OurPeriod;
  cmp: PeriodComparison | null;
};

/** Our from..to against Cultivera's same calendar days one year earlier. */
export async function buildBenchmark(from: string, to: string): Promise<Benchmark> {
  const today = pacificToday();
  const theirsRange = samePeriodLastYear(from, to);
  if (!isSupabaseServiceConfigured) {
    const ids = measureIdentities([]);
    return { from, to, today, cutover: null, live: null, theirsRange, theirDays: [], ids, ours: ourPeriodTotals([], from, to, ids), cmp: null };
  }
  const cutover = await cutoverDate();
  const live = ourLiveWindow(from, to, cutover, today);
  const theirDays = theirsRange ? await benchmarkDays(theirsRange.from, theirsRange.to) : [];
  const ids = measureIdentities(theirDays);
  const ourDays = live ? await loadOurDays(live.from, live.to) : [];
  const ours = ourPeriodTotals(ourDays, from, to, ids);
  const cmp = theirsRange ? comparePeriods(ours, sumPeriod(theirDays, theirsRange.from, theirsRange.to)) : null;
  return { from, to, today, cutover, live, theirsRange, theirDays, ids, ours, cmp };
}
