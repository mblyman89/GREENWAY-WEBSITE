import "server-only";
/**
 * src/lib/reports/cultivera-weekday-store.ts  (D260)  Reads behind Reports -> Cultivera Benchmark -> Average day.
 * Owner only (the page checks "cultivera.benchmark"). Read-only.
 *
 *   cultiveraDays()  the newest archived run's sales_lines parts, each sha256-checked against the register,
 *                    folded per Pacific day (cultivera-weekday-core). Cached 7 days per run id: the archive never
 *                    changes, so the 15 parts (~20 MB) are read once, not per page view.
 *   ourDays()        completed orders from..to, their lines (order_lines.category), medical exemptions and each
 *                    sale's own COGS entry (order:<id>#cogs; its "COGS — <slug>" lines give the cost per group).
 */
import { gunzipSync } from "node:zlib";
import { unstable_cache } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ADMIN_PAGED_CONCURRENCY, chunkedIn, pagedAll } from "@/lib/supabase/chunked-in";
import { pacificDayKey, pacificWallTimeToUtcISO } from "@/lib/reports/timezone";
import { getCannabisCategorySet, getTaxSettings, isCannabisCategory } from "@/lib/reports/tax";
import { parseJsonlRows } from "@/lib/reports/cultivera-archive-core";
import { sha256Hex } from "@/lib/reports/cultivera-archive-client";
import { downloadArchiveFile, listArchivedFiles, listArchivedRuns } from "@/lib/reports/cultivera-benchmark-store";
import {
  CultiveraLineFold,
  addOurGroupCost,
  foldOurDays,
  packDays,
  unpackDays,
  type DayFacts,
  type OurWeekdayLine,
} from "@/lib/reports/cultivera-weekday-core";
import type { OurRates } from "@/lib/reports/cultivera-benchmark-report-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
const fail = (what: string, e: { message?: string } | null | undefined): never => {
  throw new Error(`Could not read ${what}: ${e?.message ?? "unknown error"}`);
};

async function rates(): Promise<OurRates> {
  const s = await getTaxSettings();
  return { combinedSalesRateBps: s.stateSalesRateBps + s.localSalesRateBps, exciseRateBps: s.exciseRateBps };
}

const SALES_LINES_RE = /^sales_lines\.p\d{4}\.jsonl\.gz$/;

const foldRun = unstable_cache(
  async (runId: string, r: OurRates) => {
    const parts = (await listArchivedFiles(runId)).filter((f) => SALES_LINES_RE.test(f.name)).sort((a, b) => (a.name < b.name ? -1 : 1));
    if (!parts.length) throw new Error("The archived Cultivera run has no sales_lines files.");
    const fold = new CultiveraLineFold(r);
    let bad = 0;
    for (const f of parts) {
      const b = await downloadArchiveFile(runId, f.name);
      if (b.length !== f.bytes || sha256Hex(b) !== f.sha256) throw new Error(`${f.name} in storage does not match its registered sha256.`);
      const p = parseJsonlRows(gunzipSync(b).toString("utf8"));
      bad += p.bad;
      fold.add(p.rows);
    }
    return { packed: packDays(fold.result()), files: parts.length, rows: fold.rows, skipped: fold.skipped + bad };
  },
  ["cvb-weekday-cultivera-v1"],
  { revalidate: 7 * 86400 },
);

export type CultiveraDays = { runId: string; days: DayFacts[]; files: number; rows: number; skipped: number };
export async function cultiveraDays(): Promise<CultiveraDays | null> {
  const [run] = await listArchivedRuns(1);
  if (!run) return null;
  const r = await foldRun(run.runId, await rates());
  return { runId: run.runId, days: unpackDays(r.packed), files: r.files, rows: r.rows, skipped: r.skipped };
}

export async function ourDays(from: string, to: string, admin: Admin = createSupabaseAdminClient()): Promise<DayFacts[]> {
  const fromISO = pacificWallTimeToUtcISO(from, "start");
  const toISO = pacificWallTimeToUtcISO(to, "end");
  const [r, cannabisSet] = await Promise.all([rates(), getCannabisCategorySet()]);
  const cann = (c: string | null) => isCannabisCategory(c ?? "", cannabisSet);

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
  const orders = orderRows.map((o) => ({ id: o.id, day: pacificDayKey(o.completed_at ?? o.placed_at) }));
  const dayOf = new Map(orders.map((o) => [o.id, o.day]));
  const ids = orders.map((o) => o.id);
  if (!ids.length) return [];

  type LineRow = { order_id: string; product_id: string | null; quantity: number; price_minor_units: number; regular_price_minor_units: number | null; category: string | null };
  const lineRows = await chunkedIn<string, LineRow>(
    ids,
    async (chunk, f, t) => {
      const { data, error } = await admin
        .from("order_lines")
        .select("order_id, product_id, quantity, price_minor_units, regular_price_minor_units, category")
        .in("order_id", chunk)
        .order("id", { ascending: true })
        .range(f, t);
      if (error) fail("order lines", error);
      return (data as LineRow[] | null) ?? [];
    },
    { concurrency: ADMIN_PAGED_CONCURRENCY },
  );

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
  for (const x of exemptRows) {
    if (!x.order_id || !x.product_sku) continue;
    const k = `${x.order_id}|${x.product_sku}`;
    const p = exempt.get(k);
    exempt.set(k, { s: (p?.s ?? false) || x.sales_tax_exempt === true, e: (p?.e ?? false) || x.excise_tax_exempt === true });
  }
  const lines: OurWeekdayLine[] = lineRows.map((l) => {
    const ex = l.product_id ? exempt.get(`${l.order_id}|${l.product_id}`) : undefined;
    return {
      orderId: l.order_id,
      quantity: Number(l.quantity ?? 0),
      priceMinor: Number(l.price_minor_units ?? 0),
      regularPriceMinor: l.regular_price_minor_units === null || l.regular_price_minor_units === undefined ? null : Number(l.regular_price_minor_units),
      isCannabis: cann(l.category),
      salesExempt: ex?.s === true,
      exciseExempt: ex?.e === true,
      category: l.category,
    };
  });

  // Each sale's own COGS entry; an order with none (or more than one) is uncosted.
  type JournalRow = { id: string; source_ref: string };
  const journals = await chunkedIn<string, JournalRow>(
    ids.map((id) => `order:${id}#cogs`),
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
  );
  const perOrder = new Map<string, string[]>();
  for (const j of journals) {
    const id = j.source_ref.slice("order:".length, -"#cogs".length);
    perOrder.set(id, [...(perOrder.get(id) ?? []), j.id]);
  }
  const single = new Map<string, string>();
  for (const [orderId, js] of perOrder) if (js.length === 1) single.set(js[0], orderId);
  type JLine = { journal_id: string; amount_cents: number | string; description: string | null };
  const jlines = single.size
    ? await chunkedIn<string, JLine>(
        [...single.keys()],
        async (chunk, f, t) => {
          const { data, error } = await admin
            .from("gl_journal_lines")
            .select("journal_id, amount_cents, description, id")
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
  const costLines: { day: string; slug: string; cents: number }[] = [];
  for (const l of jlines) {
    const orderId = single.get(l.journal_id);
    const amt = Number(l.amount_cents);
    if (!orderId || !Number.isSafeInteger(amt) || amt <= 0) continue;
    costByOrder.set(orderId, (costByOrder.get(orderId) ?? 0) + amt);
    const slug = (l.description ?? "").replace(/^COGS\s*\S\s*/, "").trim();
    costLines.push({ day: dayOf.get(orderId) as string, slug, cents: amt });
  }

  const days = foldOurDays({ orders, lines, costByOrder, rates: r });
  addOurGroupCost(days, costLines, (s) => cann(s));
  return days;
}
