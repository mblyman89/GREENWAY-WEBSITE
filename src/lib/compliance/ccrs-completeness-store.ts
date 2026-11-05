/**
 * src/lib/compliance/ccrs-completeness-store.ts   (D183, round slice S6)
 *
 * SERVER-ONLY. Reads for the CCRS sales check, the lot repair and the taxes
 * owed screen, plus the two audited repair writes. The pure rules live in
 * ccrs-completeness-core.ts and taxes-owed-core.ts.
 *
 * Every read that fails is reported, never treated as complete (rule 135).
 *
 * The repairs change records, never stock and never money:
 *   moveSaleLine     sets ONE order line's CCRS lot (order_lines.
 *                    ccrs_inventory_external_id) from the short lot to the
 *                    sibling the register really drew from. Guarded by the
 *                    old value, so a second press changes nothing.
 *   correctCount     adds ONE "count" adjustment of exactly the shortfall to a
 *                    lot whose count took away units the sales show were sold.
 *                    on_hand is NOT touched (the shelf is unchanged); the next
 *                    InventoryAdjustment file reports it as Reconciliation.
 * Both re-check against fresh data right before writing, and both audit.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { chunkedIn, pagedAllChecked } from "@/lib/supabase/chunked-in";
import { addPacificDays, pacificDayKey, pacificMonthKey, pacificToday, pacificWallTimeToUtcISO } from "@/lib/reports/timezone";
import { getWaTaxReport } from "@/lib/reports/wa-tax";
import { getDoneMap } from "@/lib/compliance/compliance-calendar-store";
import { isNonCannabisProductId } from "@/lib/noncannabis/pos-catalog-core";
import { weekContaining, weekFromKey, type CcrsWeek } from "@/lib/compliance/ccrs-week-core";
import type { LedgerEnv } from "@/lib/compliance/ccrs-ledger-core";
import { recordAudit } from "@/lib/auth/audit";
import {
  buildCompleteness,
  checkCount,
  checkMove,
  countRepairNote,
  diagnoseShortfalls,
  aboveReceived,
  filedRowMoneyMinor,
  saleDetailId,
  type Completeness,
  type CountRepair,
  type FiledRowFact,
  type HeldFact,
  type LotFact,
  type LotSaleLine,
  type MoveRepair,
  type SaleLineFact,
  type Shortfall,
} from "@/lib/compliance/ccrs-completeness-core";
import { buildTaxMonths, type TakenInput, type TaxMonthCard, type TaxMonthInput } from "@/lib/compliance/taxes-owed-core";

export const SALES_CHECK_PAGE = "/admin/compliance/sales-check";
export const TAXES_OWED_PAGE = "/admin/compliance/taxes-owed";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

function meaning(where: string, e: { message?: string; code?: string } | null | undefined): string {
  const code = e?.code ?? "";
  const hint =
    code === "42501"
      ? " (permission missing: a migration grant is needed)"
      : code === "42P01" || code === "PGRST205"
        ? " (table missing: a migration has not been applied)"
        : code === "42703"
          ? " (column missing: a migration has not been applied)"
          : "";
  return `${where}: ${e?.message ?? "read failed"}${hint}`;
}

// ---------------------------------------------------------------------------
// 1. Weekly completeness
// ---------------------------------------------------------------------------

export type WeekCheck = { week: CcrsWeek; env: LedgerEnv; weekEnded: boolean; result: Completeness };

type OrderRow = { id: string; order_number: string | null; completed_at: string | null; placed_at: string | null };
type LineRow = { id: string; order_id: string; product_id: string | null; quantity: number | null; price_minor_units: number | null; regular_price_minor_units: number | null };
type FileRowRead = { external_id: string | null; payload: Record<string, unknown> | null; ccrs_files: { file_name: string; state: string } | { file_name: string; state: string }[] | null };

export function resolveWeek(raw: string | null | undefined, todayIso: string): CcrsWeek {
  return (raw ? weekFromKey(raw) : null) ?? weekContaining(todayIso);
}

export async function checkWeek(env: LedgerEnv, week: CcrsWeek): Promise<WeekCheck> {
  const todayIso = pacificToday();
  const weekEnded = todayIso > week.end;
  const label = `Week ${week.start} to ${week.end}`;
  const errs: string[] = [];
  if (!isSupabaseServiceConfigured) {
    return { week, env, weekEnded, result: buildCompleteness({ lines: [], filed: [], held: [], readErrors: ["the database is not configured"], weekLabel: label, weekEnded }) };
  }
  const admin = createSupabaseAdminClient();
  const fromISO = pacificWallTimeToUtcISO(week.start, "start");
  const toISO = pacificWallTimeToUtcISO(week.end, "end");

  const orders = await pagedAllChecked<OrderRow>(async (from, to) => {
    const { data, error } = await admin
      .from("orders")
      .select("id, order_number, completed_at, placed_at")
      .eq("status", "completed")
      .or(`and(completed_at.gte.${fromISO},completed_at.lte.${toISO}),and(completed_at.is.null,placed_at.gte.${fromISO},placed_at.lte.${toISO})`)
      .order("id", { ascending: true })
      .range(from, to);
    if (error) errs.push(meaning("orders", error));
    return { rows: (data as OrderRow[] | null) ?? [], ok: !error };
  });
  if (!orders.verdict.complete && errs.length === 0) errs.push(`orders: ${orders.verdict.message}`);
  const orderById = new Map(orders.rows.map((o) => [o.id, o]));

  let lineErr = false;
  const lines = await chunkedIn<string, LineRow>(orders.rows.map((o) => o.id), async (chunk, from, to) => {
    const { data, error } = await admin
      .from("order_lines")
      .select("id, order_id, product_id, quantity, price_minor_units, regular_price_minor_units")
      .in("order_id", chunk)
      .order("id", { ascending: true })
      .range(from, to);
    if (error && !lineErr) {
      lineErr = true;
      errs.push(meaning("order lines", error));
    }
    return (data as LineRow[] | null) ?? [];
  });

  const facts: SaleLineFact[] = lines.map((l) => {
    const o = orderById.get(l.order_id);
    const qty = Number(l.quantity ?? 0);
    const regular = l.regular_price_minor_units ?? l.price_minor_units ?? 0;
    return {
      detailId: saleDetailId(o?.order_number, l.order_id, l.id),
      orderNumber: o?.order_number ?? l.order_id,
      day: pacificDayKey(o?.completed_at ?? o?.placed_at ?? fromISO),
      quantity: qty,
      moneyMinor: Number(l.price_minor_units ?? 0) * qty,
      // Same exclusions as ccrs-sales.ts: Other Inventory, zero quantity, no usable price.
      excluded: isNonCannabisProductId(l.product_id) || qty <= 0 || regular <= 0,
    };
  });
  const ids = facts.filter((f) => !f.excluded).map((f) => f.detailId);

  let fileErr = false;
  const fileRows = await chunkedIn<string, FileRowRead>(ids, async (chunk, from, to) => {
    const { data, error } = await admin
      .from("ccrs_file_rows")
      .select("external_id, payload, ccrs_files!inner(file_name, state, env, file_type)")
      .in("external_id", chunk)
      .eq("ccrs_files.env", env)
      .eq("ccrs_files.file_type", "Sale")
      .neq("ccrs_files.state", "abandoned")
      .order("id", { ascending: true })
      .range(from, to);
    if (error && !fileErr) {
      fileErr = true;
      errs.push(meaning("CCRS file rows", error));
    }
    return (data as FileRowRead[] | null) ?? [];
  });
  const filed: FiledRowFact[] = fileRows
    .filter((r) => r.external_id)
    .map((r) => {
      const f = Array.isArray(r.ccrs_files) ? r.ccrs_files[0] : r.ccrs_files;
      return { detailId: r.external_id as string, fileName: f?.file_name ?? "", fileState: f?.state ?? "", moneyMinor: filedRowMoneyMinor(r.payload) };
    });

  let heldErr = false;
  const heldRows = await chunkedIn<string, { record_id: string; code: string | null; reason: string | null }>(ids, async (chunk, from, to) => {
    const { data, error } = await admin
      .from("ccrs_held_sync")
      .select("record_id, code, reason, id")
      .eq("env", env)
      .eq("record_type", "Sale")
      .is("resolved_at", null)
      .in("record_id", chunk)
      .order("id", { ascending: true })
      .range(from, to);
    if (error && !heldErr) {
      heldErr = true;
      errs.push(meaning("CCRS held list", error));
    }
    return (data as { record_id: string; code: string | null; reason: string | null }[] | null) ?? [];
  });
  const held: HeldFact[] = heldRows.map((h) => ({ detailId: h.record_id, code: h.code ?? "", reason: h.reason ?? "" }));

  return { week, env, weekEnded, result: buildCompleteness({ lines: facts, filed, held, readErrors: errs, weekLabel: label, weekEnded }) };
}

/** The last `n` weeks (newest first), for the summary strip. */
export function recentWeeks(todayIso: string, n: number): CcrsWeek[] {
  const out: CcrsWeek[] = [];
  let w = weekContaining(todayIso);
  for (let i = 0; i < n; i++) {
    out.push(w);
    w = weekContaining(addPacificDays(w.start, -1));
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. Lot shortfalls
// ---------------------------------------------------------------------------

type LotRow = {
  id: string;
  lot_code: string | null;
  ccrs_inventory_external_id: string | null;
  pos_product_key: string | null;
  product_name: string | null;
  status: string | null;
  received_qty: number | string | null;
  on_hand_qty: number | string | null;
};
type AdjRow = { id: string; lot_id: string; qty_delta: number | string; reason: string | null };
type SoldRow = {
  id: string;
  quantity: number | null;
  ccrs_inventory_external_id: string | null;
  order_id: string;
  orders: { order_number: string | null; completed_at: string | null; placed_at: string | null; status: string } | { order_number: string | null; completed_at: string | null; placed_at: string | null; status: string }[] | null;
};

export type LotFacts = { lots: LotFact[]; sales: LotSaleLine[]; errors: string[] };

async function readLotFacts(admin: Admin): Promise<LotFacts> {
  const errors: string[] = [];
  const lotsR = await pagedAllChecked<LotRow>(async (from, to) => {
    const { data, error } = await admin
      .from("inventory_lots")
      .select("id, lot_code, ccrs_inventory_external_id, pos_product_key, product_name, status, received_qty, on_hand_qty")
      .order("id", { ascending: true })
      .range(from, to);
    if (error) errors.push(meaning("inventory lots", error));
    return { rows: (data as LotRow[] | null) ?? [], ok: !error };
  });
  const adjR = await pagedAllChecked<AdjRow>(async (from, to) => {
    const { data, error } = await admin.from("inventory_adjustments").select("id, lot_id, qty_delta, reason").order("id", { ascending: true }).range(from, to);
    if (error) errors.push(meaning("inventory adjustments", error));
    return { rows: (data as AdjRow[] | null) ?? [], ok: !error };
  });
  const soldR = await pagedAllChecked<SoldRow>(async (from, to) => {
    const { data, error } = await admin
      .from("order_lines")
      .select("id, quantity, ccrs_inventory_external_id, order_id, orders!inner(order_number, completed_at, placed_at, status)")
      .eq("orders.status", "completed")
      .not("ccrs_inventory_external_id", "is", null)
      .order("id", { ascending: true })
      .range(from, to);
    if (error) errors.push(meaning("sold lines", error));
    return { rows: (data as SoldRow[] | null) ?? [], ok: !error };
  });
  for (const v of [lotsR.verdict, adjR.verdict, soldR.verdict]) if (!v.complete && errors.length === 0) errors.push(v.message);

  const adjBy = new Map<string, { all: number; countRemoved: number }>();
  for (const a of adjR.rows) {
    if ((a.reason ?? "") === "receive") continue;
    const q = Number(a.qty_delta) || 0;
    const cur = adjBy.get(a.lot_id) ?? { all: 0, countRemoved: 0 };
    cur.all += q;
    if (a.reason === "count" && q < 0) cur.countRemoved += q;
    adjBy.set(a.lot_id, cur);
  }
  const lots: LotFact[] = lotsR.rows.map((l) => ({
    id: l.id,
    lotCode: l.lot_code,
    ext: l.ccrs_inventory_external_id,
    productKey: l.pos_product_key,
    productName: l.product_name,
    status: l.status,
    received: Number(l.received_qty ?? 0) || 0,
    onHand: Number(l.on_hand_qty ?? 0) || 0,
    adjustments: adjBy.get(l.id)?.all ?? 0,
    countRemoved: adjBy.get(l.id)?.countRemoved ?? 0,
  }));
  const sales: LotSaleLine[] = soldR.rows.map((s) => {
    const o = Array.isArray(s.orders) ? s.orders[0] : s.orders;
    return {
      lineId: s.id,
      detailId: saleDetailId(o?.order_number, s.order_id, s.id),
      ext: s.ccrs_inventory_external_id as string,
      quantity: Number(s.quantity ?? 0) || 0,
      completedAt: o?.completed_at ?? o?.placed_at ?? "",
      filedInProd: false,
    };
  });
  return { lots, sales, errors };
}

/** Marks the lines CCRS Production already holds (a live prod Sale file has them). */
async function markProdFiled(admin: Admin, sales: LotSaleLine[], detailIds: string[], errors: string[]): Promise<void> {
  if (detailIds.length === 0) return;
  let err = false;
  const rows = await chunkedIn<string, { external_id: string | null }>(detailIds, async (chunk, from, to) => {
    const { data, error } = await admin
      .from("ccrs_file_rows")
      .select("external_id, ccrs_files!inner(env, state, file_type)")
      .in("external_id", chunk)
      .eq("ccrs_files.env", "prod")
      .eq("ccrs_files.file_type", "Sale")
      .neq("ccrs_files.state", "abandoned")
      .order("id", { ascending: true })
      .range(from, to);
    if (error && !err) {
      err = true;
      errors.push(meaning("CCRS Production file rows", error));
    }
    return (data as { external_id: string | null }[] | null) ?? [];
  });
  const held = new Set(rows.map((r) => r.external_id).filter(Boolean) as string[]);
  for (const s of sales) if (held.has(s.detailId)) s.filedInProd = true;
}

export type LotCheck = { shortfalls: Shortfall[]; aboveReceived: LotFact[]; lots: number; errors: string[] };

async function factsWithProdFlags(admin: Admin): Promise<LotFacts> {
  const f = await readLotFacts(admin);
  // A Production read error means we cannot prove a line is safe to move:
  // treat every line on a short lot as locked.
  const first = diagnoseShortfalls(f.lots, f.sales);
  const exts = new Set(first.map((s) => s.lot.ext));
  const ids = f.sales.filter((s) => exts.has(s.ext)).map((s) => s.detailId);
  const before = f.errors.length;
  await markProdFiled(admin, f.sales, ids, f.errors);
  if (f.errors.length > before) for (const s of f.sales) if (exts.has(s.ext)) s.filedInProd = true;
  return f;
}

export async function checkLots(): Promise<LotCheck> {
  if (!isSupabaseServiceConfigured) return { shortfalls: [], aboveReceived: [], lots: 0, errors: ["the database is not configured"] };
  const admin = createSupabaseAdminClient();
  const f = await factsWithProdFlags(admin);
  return { shortfalls: diagnoseShortfalls(f.lots, f.sales), aboveReceived: aboveReceived(f.lots), lots: f.lots.length, errors: f.errors };
}

export type RepairOutcome = { ok: true; message: string } | { ok: false; error: string };

export async function moveSaleLine(r: MoveRepair, actor: { id: string; email: string | null }): Promise<RepairOutcome> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "The database is not configured." };
  const admin = createSupabaseAdminClient();
  const f = await factsWithProdFlags(admin);
  if (f.errors.length > 0) return { ok: false, error: `Could not re-check before repairing: ${f.errors[0]}` };
  const why = checkMove(r, f.lots, f.sales);
  if (why) return { ok: false, error: why };
  const { data, error } = await admin
    .from("order_lines")
    .update({ ccrs_inventory_external_id: r.toExt })
    .eq("id", r.lineId)
    .eq("ccrs_inventory_external_id", r.fromExt)
    .select("id");
  if (error) return { ok: false, error: meaning("order line", error) };
  if (!data || data.length !== 1) return { ok: false, error: "The line changed while you were looking. Reload the page." };
  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: "ccrs.lot_repair.move_line",
    entityType: "order_line",
    entityId: r.lineId,
    before: { ccrs_inventory_external_id: r.fromExt, lot_id: r.fromLotId },
    after: { ccrs_inventory_external_id: r.toExt, lot_id: r.toLotId, detailId: r.detailId, quantity: r.quantity, stockChanged: false },
  });
  return { ok: true, message: `Moved ${r.detailId} to lot ${r.toLotCode ?? r.toExt}. No stock changed; the next Sale file reports it on the right lot.` };
}

export async function correctCount(r: CountRepair, actor: { id: string; email: string | null }): Promise<RepairOutcome> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "The database is not configured." };
  const admin = createSupabaseAdminClient();
  const f = await factsWithProdFlags(admin);
  if (f.errors.length > 0) return { ok: false, error: `Could not re-check before repairing: ${f.errors[0]}` };
  const why = checkCount(r, f.lots, f.sales);
  if (why) return { ok: false, error: why };
  const { data, error } = await admin
    .from("inventory_adjustments")
    .insert({ lot_id: r.lotId, qty_delta: r.quantity, reason: "count", note: countRepairNote(r.quantity, r.ext), actor_id: actor.id })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: meaning("inventory adjustment", error) };
  const adjId = (data as { id: string }).id;
  // Two presses at once: if the record now overshoots the shelf, take ours back.
  const after = await factsWithProdFlags(admin);
  const lot = after.lots.find((l) => l.id === r.lotId);
  const sold = after.sales.filter((s) => s.ext === r.ext).reduce((s, x) => s + x.quantity, 0);
  if (lot && lot.received + lot.adjustments - sold > lot.onHand + 1e-9) {
    await admin.from("inventory_adjustments").delete().eq("id", adjId);
    return { ok: false, error: "Someone else already corrected this lot. Nothing was added." };
  }
  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: "ccrs.lot_repair.count_correction",
    entityType: "inventory_lot",
    entityId: r.lotId,
    after: { adjustmentId: adjId, qtyDelta: r.quantity, reason: "count", ext: r.ext, onHandChanged: false },
  });
  return { ok: true, message: `Corrected the count on lot ${r.ext} by +${r.quantity}. The shelf is unchanged; CCRS gets the Reconciliation in the next adjustment file.` };
}

// ---------------------------------------------------------------------------
// 3. Taxes owed
// ---------------------------------------------------------------------------

export type TaxesOwed = { cards: TaxMonthCard[]; errors: string[]; todayIso: string };

function monthStart(month: string): string {
  return `${month}-01`;
}
function monthEnd(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, "0")}`;
}
function monthsBack(todayIso: string, n: number): string[] {
  const out: string[] = [];
  let y = Number(todayIso.slice(0, 4));
  let m = Number(todayIso.slice(5, 7));
  for (let i = 0; i < n; i++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

export async function taxesOwed(nMonths = 6): Promise<TaxesOwed> {
  const todayIso = pacificToday();
  const errors: string[] = [];
  const months = monthsBack(todayIso, nMonths);
  const oldest = months[months.length - 1]!;
  const fromISO = pacificWallTimeToUtcISO(monthStart(oldest), "start");
  const toISO = pacificWallTimeToUtcISO(monthEnd(months[0]!), "end");

  const [report, done] = await Promise.all([
    getWaTaxReport(fromISO, toISO).catch((e: unknown) => {
      errors.push(`tax report: ${e instanceof Error ? e.message : "failed"}`);
      return null;
    }),
    getDoneMap(),
  ]);

  let taken: TakenInput[] | null = null;
  if (isSupabaseServiceConfigured) {
    const admin = createSupabaseAdminClient();
    type O = { id: string; total_minor_units: number | null; completed_at: string | null; placed_at: string | null };
    const r = await pagedAllChecked<O>(async (from, to) => {
      const { data, error } = await admin
        .from("orders")
        .select("id, total_minor_units, completed_at, placed_at")
        .eq("status", "completed")
        .or(`and(completed_at.gte.${fromISO},completed_at.lte.${toISO}),and(completed_at.is.null,placed_at.gte.${fromISO},placed_at.lte.${toISO})`)
        .order("id", { ascending: true })
        .range(from, to);
      if (error) errors.push(meaning("orders (money taken)", error));
      return { rows: (data as O[] | null) ?? [], ok: !error };
    });
    if (r.verdict.complete) {
      const by = new Map<string, TakenInput>();
      for (const o of r.rows) {
        const mk = pacificMonthKey(o.completed_at ?? o.placed_at ?? fromISO);
        const t = by.get(mk) ?? { month: mk, takenMinor: 0, lines: 0 };
        t.takenMinor += Number(o.total_minor_units ?? 0);
        t.lines += 1; // one order: tolerance grows by order; refined below with line counts
        by.set(mk, t);
      }
      // Line counts give the honest rounding allowance (each line rounds its own taxes).
      let lineErr = false;
      const lines = await chunkedIn<string, { order_id: string }>(r.rows.map((o) => o.id), async (chunk, from, to) => {
        const { data, error } = await admin.from("order_lines").select("order_id, id").in("order_id", chunk).order("id", { ascending: true }).range(from, to);
        if (error && !lineErr) {
          lineErr = true;
          errors.push(meaning("order lines (rounding allowance)", error));
        }
        return (data as { order_id: string }[] | null) ?? [];
      });
      if (!lineErr) {
        const monthOf = new Map(r.rows.map((o) => [o.id, pacificMonthKey(o.completed_at ?? o.placed_at ?? fromISO)]));
        for (const t of by.values()) t.lines = 0;
        for (const l of lines) {
          const t = by.get(monthOf.get(l.order_id) ?? "");
          if (t) t.lines += 1;
        }
      }
      taken = [...by.values()];
    }
  }

  const rows: TaxMonthInput[] = (report?.byMonth ?? []).map((m) => ({
    month: m.month,
    label: m.label,
    exciseTaxMinor: m.exciseTaxMinor,
    salesTaxMinor: m.salesTaxMinor,
    stateSalesTaxMinor: m.stateSalesTaxMinor,
    localSalesTaxMinor: m.localSalesTaxMinor,
    totalBaseMinor: m.totalBaseMinor,
    cannabisBaseMinor: m.cannabisBaseMinor,
    nonCannabisBaseMinor: m.nonCannabisBaseMinor,
    orders: m.orders,
  }));
  return { cards: buildTaxMonths({ months: rows, taken, done, todayIso }), errors, todayIso };
}
