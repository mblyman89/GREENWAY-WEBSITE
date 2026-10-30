/**
 * src/lib/noncannabis/register-stock.ts
 *
 * Fix Phase 4 (G-29 items 3, 4, 6; G-32 item 2; F-05b-1, F-05b-3, F-05b-15).
 * Server-only. Moves Other Inventory On hand for sales, voids and manual
 * adjustments through ONE database statement (migration 0323
 * apply_noncannabis_delta: the quantity and the ledger row together, under
 * the row lock). Before 0323 is applied it falls back to the old two-step
 * write so the register keeps working, and says so.
 *
 * Idempotency: sale and void rows carry the order line id; 0323's unique
 * index (order_line_id, reason) plus the in-function check mean a retried
 * sync, a re-complete or a second void never moves the same line twice.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isMissingDbFunctionError, isUniqueViolation } from "@/lib/db/rpc-fallback-core";
import { splitNcLines, summarizeNcSales, type NcCatalogRow, type NcItemSales, type NcSoldLine } from "@/lib/noncannabis/pos-catalog-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type NcDeltaResult =
  | { ok: true; newQty: number; applied: boolean; duplicate: boolean; usedFallback: boolean }
  | { ok: false; error: string; refused?: boolean };

/**
 * Move one item's On hand by `delta` and write its ledger row.
 * strict = refuse going below zero (manual adjustments, G-32 item 2);
 * not strict = floor at zero (a sale: the customer already has the item).
 */
export async function applyNcDelta(
  admin: Admin,
  p: {
    productId: string;
    delta: number;
    reason: string;
    note?: string | null;
    actorId?: string | null;
    strict: boolean;
    orderId?: string | null;
    orderLineId?: string | null;
  },
): Promise<NcDeltaResult> {
  const { data, error } = await admin.rpc("apply_noncannabis_delta", {
    p_product_id: p.productId,
    p_delta: p.delta,
    p_reason: p.reason,
    p_note: (p.note ?? "").trim() || null,
    p_actor: p.actorId ?? null,
    p_strict: p.strict,
    p_order_id: p.orderId ?? null,
    p_order_line_id: p.orderLineId ?? null,
  });
  if (!error) {
    const r = (data ?? {}) as { new_qty?: number; applied?: boolean; duplicate?: boolean; refused?: boolean };
    if (r.refused) {
      return { ok: false, refused: true, error: `That would take On hand below zero (${r.new_qty ?? 0} on hand). Nothing was changed.` };
    }
    return { ok: true, newQty: Number(r.new_qty ?? 0), applied: r.applied === true, duplicate: r.duplicate === true, usedFallback: false };
  }
  if (isUniqueViolation(error)) {
    return { ok: true, newQty: 0, applied: false, duplicate: true, usedFallback: false };
  }
  if (!isMissingDbFunctionError(error)) return { ok: false, error: error.message };

  // ── Before 0323: the old two-step write (ledger, then quantity). ──────────
  const { data: row } = await admin.from("noncannabis_products").select("qty_on_hand").eq("id", p.productId).maybeSingle();
  if (!row) return { ok: false, error: "Product not found." };
  const cur = Number((row as { qty_on_hand: number }).qty_on_hand) || 0;
  if (p.strict && cur + p.delta < 0) {
    return { ok: false, refused: true, error: `That would take On hand below zero (${cur} on hand). Nothing was changed.` };
  }
  const next = Math.max(0, cur + p.delta);
  const noteSuffix = p.orderId ? ` (order ${p.orderId})` : "";
  const { error: insErr } = await admin.from("noncannabis_adjustments").insert({
    product_id: p.productId,
    qty_delta: p.delta,
    reason: p.reason,
    note: (((p.note ?? "").trim() || "") + noteSuffix).trim() || null,
    actor_id: p.actorId ?? null,
  });
  if (insErr) return { ok: false, error: insErr.message };
  const { error: updErr } = await admin.from("noncannabis_products").update({ qty_on_hand: next, updated_by: p.actorId ?? null }).eq("id", p.productId);
  if (updErr) return { ok: false, error: updErr.message };
  return { ok: true, newQty: next, applied: true, duplicate: false, usedFallback: true };
}

type StockLine = { lineId: string; productId: string | null; productName: string; quantity: number };

/**
 * Sale (-qty) or void (+qty) for every Other Inventory line on an order.
 * Returns a plain-English summary for the order's timeline. Never throws.
 */
export async function moveNcStockForOrder(
  admin: Admin,
  orderId: string,
  lines: readonly StockLine[],
  kind: "sale" | "void",
): Promise<{ handled: number; summary: string }> {
  const { nc } = splitNcLines(lines);
  if (nc.length === 0) return { handled: 0, summary: "" };
  const notes: string[] = [];
  let fallback = false;
  for (const l of nc) {
    const qty = Math.floor(Number(l.quantity) || 0);
    if (qty <= 0) continue;
    try {
      const r = await applyNcDelta(admin, {
        productId: l.ncId,
        delta: kind === "sale" ? -qty : qty,
        reason: kind,
        note: kind === "sale" ? "Register sale" : "Sale voided",
        strict: false,
        orderId,
        orderLineId: l.lineId,
      });
      if (!r.ok) notes.push(`${l.productName}: FAILED (${r.error}) - fix On hand by hand`);
      else if (r.duplicate) notes.push(`${l.productName}: already done`);
      else {
        if (r.usedFallback) fallback = true;
        notes.push(`${l.productName} ${kind === "sale" ? "-" : "+"}${qty} (now ${r.newQty})`);
      }
    } catch (err) {
      notes.push(`${l.productName}: FAILED (${err instanceof Error ? err.message : String(err)}) - fix On hand by hand`);
    }
  }
  const head = kind === "sale" ? "Other Inventory" : "Other Inventory restock";
  return {
    handled: nc.length,
    summary: `${head}: ${notes.join("; ")}${fallback ? " (database update 0323 not applied: written the old two-step way)" : ""}`,
  };
}

/** Unit cost (cents) per catalog id; null when $0 / unknown or the row is gone. */
export async function readNcUnitCosts(admin: Admin, ids: readonly string[]): Promise<{ ok: true; costs: Map<string, number | null> } | { ok: false; error: string }> {
  const costs = new Map<string, number | null>();
  const uniq = [...new Set(ids)];
  if (uniq.length === 0) return { ok: true, costs };
  const { data, error } = await admin.from("noncannabis_products").select("id, cost_minor_units").in("id", uniq);
  if (error) return { ok: false, error: error.message };
  for (const r of (data as { id: string; cost_minor_units: number | null }[] | null) ?? []) {
    const c = Number(r.cost_minor_units);
    costs.set(r.id, Number.isSafeInteger(c) && c > 0 ? c : null);
  }
  return { ok: true, costs };
}

/**
 * Phase 4 (G-29 items 1–2) — the ACTIVE Other Inventory catalog rows the
 * register (and the website "In store" list) can show. Best-effort: a failed
 * read returns [] so the cannabis menu download never breaks. Falls back
 * without barcode/reorder_point when migration 0111 is not applied.
 */
/**
 * Read every row in pages of 1000 (PostgREST caps a single read at 1000, so
 * a bigger .limit() would silently truncate; SLICE 5C rule). Stops at `max`.
 */
async function readPaged<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  max: number,
): Promise<{ ok: true; rows: T[] } | { ok: false; error: string }> {
  const out: T[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await page(from, Math.min(from + 999, max - 1));
    if (error) return { ok: false, error: error.message };
    const rows = (data as T[] | null) ?? [];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return { ok: true, rows: out };
}

export async function readNcCatalogForRegister(admin: Admin): Promise<NcCatalogRow[]> {
  const full =
    "id, sku, name, brand, type, price_minor_units, cost_minor_units, qty_on_hand, status, barcode, reorder_point";
  const lean = "id, sku, name, brand, type, price_minor_units, cost_minor_units, qty_on_hand, status";
  try {
    const first = await readPaged<NcCatalogRow>(
      (a, b) => admin.from("noncannabis_products").select(full).eq("status", "active").order("id").range(a, b),
      5000,
    );
    if (first.ok) return first.rows;
    const second = await readPaged<NcCatalogRow>(
      (a, b) => admin.from("noncannabis_products").select(lean).eq("status", "active").order("id").range(a, b),
      5000,
    );
    if (!second.ok) return [];
    return second.rows.map((r) => ({
      ...r,
      barcode: null,
      reorder_point: null,
    }));
  } catch {
    return [];
  }
}

/**
 * Phase 4 (G-29 item 8) — Other Inventory sales for the last `days` days,
 * built from the register's own ledger rows (0323: reason 'sale' carries
 * the order line and the unit cost at the moment of sale). Lines later
 * voided are left out. Returns [] when 0323 is not applied or a read fails;
 * `ok:false` says so, never a silent zero.
 */
export async function loadNcSalesReport(
  admin: Admin,
  days = 30,
): Promise<{ ok: true; rows: NcItemSales[] } | { ok: false; error: string }> {
  const since = new Date(Date.now() - Math.max(1, days) * 86_400_000).toISOString();
  const read = await readPaged<{ order_line_id: string; reason: string; unit_cost_minor_units: number | null }>(
    (a, b) =>
      admin
        .from("noncannabis_adjustments")
        .select("order_line_id, reason, unit_cost_minor_units")
        .in("reason", ["sale", "void"])
        .not("order_line_id", "is", null)
        .gte("created_at", since)
        .order("id")
        .range(a, b),
    20000,
  );
  if (!read.ok) return { ok: false, error: read.error };
  const rows = read.rows;
  const voided = new Set(rows.filter((r) => r.reason === "void").map((r) => r.order_line_id));
  const costByLine = new Map<string, number | null>();
  for (const r of rows) if (r.reason === "sale" && !voided.has(r.order_line_id)) costByLine.set(r.order_line_id, r.unit_cost_minor_units);
  const ids = [...costByLine.keys()];
  const lines: NcSoldLine[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data: ol, error: e2 } = await admin
      .from("order_lines")
      .select("id, product_id, product_name, quantity, price_minor_units")
      .in("id", ids.slice(i, i + 200));
    if (e2) return { ok: false, error: e2.message };
    for (const l of (ol as { id: string; product_id: string | null; product_name: string; quantity: number; price_minor_units: number }[] | null) ?? []) {
      lines.push({
        productId: l.product_id,
        productName: l.product_name,
        quantity: Number(l.quantity) || 0,
        priceMinorUnits: Number(l.price_minor_units) || 0,
        costMinorUnits: costByLine.get(l.id) ?? null,
      });
    }
  }
  return { ok: true, rows: summarizeNcSales(lines) };
}
