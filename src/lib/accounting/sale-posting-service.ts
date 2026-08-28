/**
 * src/lib/accounting/sale-posting-service.ts
 *
 * THE WIRE for the retail sale (census rows revenue_and_tax_collected
 * .retail_sale = D-31 and cost_of_goods_sold.cogs_on_sale = D-33).
 *
 * `buildSaleJournal` has existed and been correct for several slices. Nothing
 * called it. This file is the caller: it runs when an order reaches
 * `completed`, gathers what the builder needs, and posts the result through
 * the same ledger door every other entry uses.
 *
 * WHEN IT RUNS — and why that moment and no other
 * -----------------------------------------------
 * `src/lib/reports/revenue-basis.ts` already fixed this decision for the whole
 * codebase: `REVENUE_STATUS = "completed"`, because "money only changes hands
 * when an order reaches `completed` at pickup / POS". An order sitting in
 * `ready`, or one that ends `no_show`, never collected a cent. So the ledger
 * hangs off the SAME transition, and the reports and the books cannot drift
 * apart on the status axis.
 *
 * TWO JOURNALS, NOT ONE
 * ---------------------
 * A retail sale is two independent economic facts and `buildSaleJournal`
 * returns them separately:
 *   1. revenue  — cash/till up, revenue and the two tax liabilities recorded;
 *   2. COGS     — inventory down, cost of goods sold up.
 * They are posted in that order. If the process dies between them the books
 * hold revenue with no cost, which OVERSTATES income for the period. That is
 * visible in any margin report and is the safer of the two failures; the
 * reverse (cost with no revenue) understates income and looks like a loss
 * nobody can explain. Both are recorded on the marker either way.
 *
 * WHY IT NEVER THROWS PAST THE CALLER
 * -----------------------------------
 * The customer has already walked out with the product. Refusing to complete
 * the order at that point does not un-sell anything; it just leaves the POS
 * stuck. So this service NEVER blocks completion — but, unlike the inventory
 * and loyalty side-effects it sits beside, it never silently swallows either.
 * Every outcome is stamped on the order's own event trail, and a refusal is
 * returned to the caller so it can be surfaced. A ledger that fails quietly is
 * the exact defect this slice closes.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { buildSaleJournal, type SaleLineInput } from "@/lib/accounting/sale-journal-core";
import { mapReceiptCategory } from "@/lib/accounting/receipt-category-core";
import { costSaleFromDraws, type CostableLine, type LotDraw } from "@/lib/accounting/sale-cogs-core";
import { submitJournal } from "@/lib/accounting/posting-service";
import { pacificParts } from "@/lib/reports/timezone";

/** Event type on `order_events` — also the idempotency latch (see below). */
export const SALE_POSTING_EVENT_TYPE = "ledger_sale_posted";

export const SALE_POSTING_CODES = [
  "SALE_POSTED",
  "SALE_ALREADY_POSTED",
  "SALE_NOT_CONFIGURED",
  "SALE_ORDER_NOT_FOUND",
  "SALE_NO_LINES",
  "SALE_CATEGORY_REFUSED",
  "SALE_COST_REFUSED",
  "SALE_BUILD_REFUSED",
  "SALE_POST_FAILED",
  "SALE_READ_FAILED",
] as const;

export type SalePostingCode = (typeof SALE_POSTING_CODES)[number];

export type SalePostingResult = {
  readonly ok: boolean;
  readonly code: SalePostingCode;
  /** Plain English, aimed at Michael. */
  readonly message: string;
  /** Set when the revenue journal posted. */
  readonly revenueJournalId?: string;
  /** Set when the COGS journal posted. */
  readonly cogsJournalId?: string;
};

function result(
  ok: boolean,
  code: SalePostingCode,
  message: string,
  extra: Partial<SalePostingResult> = {},
): SalePostingResult {
  return { ok, code, message, ...extra };
}

type OrderRow = {
  id: string;
  status: string;
  total_minor_units: number;
  completed_at: string | null;
};

type LineRow = {
  id: string;
  product_id: string | null;
  variant_id: string | null;
  product_name: string;
  category: string | null;
  quantity: number;
  price_minor_units: number;
};

/**
 * Post the ledger entries for a completed order.
 *
 * Idempotent by the same mechanism `sale-decrement.ts` already relies on: a
 * CLAIMED row in `order_events`, whose partial unique index on
 * (order_id, event_type) (migration 0129) makes the insert itself the latch.
 * Two concurrent completions both pass the SELECT; only one wins the INSERT,
 * and the loser returns SALE_ALREADY_POSTED without touching the ledger. This
 * is not a new pattern invented here — reusing the proven one is the point.
 */
export async function postSaleForOrder(orderId: string): Promise<SalePostingResult> {
  if (!isSupabaseServiceConfigured) {
    return result(false, "SALE_NOT_CONFIGURED", "Supabase service credentials are not configured; nothing was posted.");
  }

  const admin = createSupabaseAdminClient();
  let claimId: string | null = null;

  try {
    // ── Idempotency: fast path, then the real latch ─────────────────────
    const { data: marker } = await admin
      .from("order_events")
      .select("id")
      .eq("order_id", orderId)
      .eq("event_type", SALE_POSTING_EVENT_TYPE)
      .limit(1);
    if (marker && marker.length > 0) {
      return result(true, "SALE_ALREADY_POSTED", "This sale was already recorded in the books; nothing was posted twice.");
    }

    const { data: claim, error: claimError } = await admin
      .from("order_events")
      .insert({
        order_id: orderId,
        event_type: SALE_POSTING_EVENT_TYPE,
        note: "Recording this sale in the books…",
        actor_label: "system",
      })
      .select("id")
      .single();
    if (claimError) {
      // 23505 = another runner owns the latch. Not an error worth alarming on.
      const code = (claimError as { code?: string }).code;
      if (code === "23505") {
        return result(true, "SALE_ALREADY_POSTED", "Another process is already recording this sale; nothing was posted twice.");
      }
      return result(false, "SALE_READ_FAILED", `Could not claim the posting marker: ${claimError.message}`);
    }
    claimId = (claim as { id: string }).id;

    // ── Gather the order and its lines ──────────────────────────────────
    const { data: orderData, error: orderError } = await admin
      .from("orders")
      .select("id, status, total_minor_units, completed_at")
      .eq("id", orderId)
      .single();
    if (orderError || !orderData) {
      return await fail(admin, claimId, result(false, "SALE_ORDER_NOT_FOUND", `Order ${orderId} could not be read: ${orderError?.message ?? "not found"}`));
    }
    const order = orderData as OrderRow;

    const { data: lineData, error: lineError } = await admin
      .from("order_lines")
      .select("id, product_id, variant_id, product_name, category, quantity, price_minor_units")
      .eq("order_id", orderId);
    if (lineError) {
      return await fail(admin, claimId, result(false, "SALE_READ_FAILED", `Order lines could not be read: ${lineError.message}`));
    }
    const lines = (lineData as LineRow[] | null) ?? [];
    if (lines.length === 0) {
      return await fail(admin, claimId, result(false, "SALE_NO_LINES", "This order has no lines, so there is nothing to record."));
    }

    // ── Categories: map free text, refuse rather than guess ─────────────
    // Same discipline as the receiving path (D-64). The category decides the
    // revenue, COGS and inventory account, and three categories are outside
    // 280E, so a guess here changes the tax owed.
    const categoryBySlug = new Map<string, string>();
    for (const l of lines) {
      const mapped = mapReceiptCategory(l.category);
      if (mapped.kind === "mapped") {
        categoryBySlug.set(l.id, mapped.slug);
        continue;
      }
      const what = l.category === null || l.category.trim() === "" ? "(blank)" : l.category;
      return await fail(
        admin,
        claimId,
        result(
          false,
          "SALE_CATEGORY_REFUSED",
          `Line "${l.product_name}" has the category ${what}, which the books do not recognise, so this sale was not recorded. ` +
            `Add that spelling to the category list — do not let it fall back to a default, because three categories are outside 280E and a wrong guess changes the tax.`,
        ),
      );
    }

    // ── Costs: from the lots this sale actually consumed ────────────────
    const cost = await gatherCosts(admin, orderId, lines);
    if (cost.kind === "failed") {
      return await fail(admin, claimId, result(false, "SALE_COST_REFUSED", cost.message));
    }

    // ── Build ───────────────────────────────────────────────────────────
    // Pacific business date: a 5pm Pacific sale is already tomorrow in UTC,
    // and filing it in the wrong period is a real reporting error.
    const basis = order.completed_at ? new Date(order.completed_at) : new Date();
    const p = pacificParts(basis);
    const saleDate = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;

    const saleLines: SaleLineInput[] = lines.map((l) => ({
      lineId: l.id,
      categorySlug: categoryBySlug.get(l.id) as string,
      description: l.product_name,
      quantity: l.quantity,
      paidCents: l.price_minor_units * l.quantity,
      unitCostCentsTotal: cost.costByLineId.get(l.id) ?? null,
    }));

    const built = buildSaleJournal({
      saleDate,
      orderRef: order.id,
      lines: saleLines,
      // CHECKED, not trusted. Lines are insert-only after placement, so the
      // stored total must still reproduce from them; if it does not, the
      // drawer and the books would disagree and the builder refuses.
      posTotalCents: order.total_minor_units,
    });

    if (built.kind === "refused") {
      return await fail(
        admin,
        claimId,
        result(false, "SALE_BUILD_REFUSED", `${built.explanation} ${built.resolution}`),
      );
    }

    // ── Post: revenue FIRST, then cost (see header) ─────────────────────
    const revenue = await submitJournal({
      entityCode: "greenway",
      sourceKind: "pos_sale",
      sourceRef: `order:${order.id}#revenue`,
      journalDate: saleDate,
      memo: `Retail sale ${order.id}`,
      lines: built.revenueJournal.lines.map((l) => ({
        accountCode: l.accountCode,
        amountCents: l.amountCents,
        costClass: l.costClass,
        description: l.description ?? undefined,
      })),
    });
    if (!revenue.ok) {
      return await fail(
        admin,
        claimId,
        result(false, "SALE_POST_FAILED", `The revenue entry was refused by the ledger: ${revenue.message}`),
      );
    }

    const cogs = await submitJournal({
      entityCode: "greenway",
      sourceKind: "pos_sale",
      sourceRef: `order:${order.id}#cogs`,
      journalDate: saleDate,
      memo: `Cost of goods sold ${order.id}`,
      lines: built.cogsJournal.lines.map((l) => ({
        accountCode: l.accountCode,
        amountCents: l.amountCents,
        costClass: l.costClass,
        description: l.description ?? undefined,
      })),
    });
    if (!cogs.ok) {
      // Revenue is already on the books. Say so plainly — this is exactly the
      // state a silent catch would have hidden.
      return await fail(
        admin,
        claimId,
        result(false, "SALE_POST_FAILED", `The revenue entry posted but the cost entry was refused: ${cogs.message}. Income is overstated for this period until the cost entry is posted.`, {
          revenueJournalId: revenue.journalId ?? undefined,
        }),
      );
    }

    const residual = built.roundingResidualCents;
    const note =
      `Sale recorded in the books: revenue ${built.totalRevenueCents}c, excise ${built.totalExciseCents}c, ` +
      `sales tax ${built.totalSalesTaxCents}c, cost ${built.totalCostCents}c across ${built.splits.length} category(ies).` +
      (residual !== 0 ? ` Rounding residual ${residual}c (D-10, reported not resolved).` : "");
    await admin.from("order_events").update({ note: note.slice(0, 2000) }).eq("id", claimId);

    return result(true, "SALE_POSTED", note, {
      revenueJournalId: revenue.journalId ?? undefined,
      cogsJournalId: cogs.journalId ?? undefined,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (claimId) {
      // RELEASE the latch: the work did not finish, and a held latch would
      // make every retry skip the posting forever. Same reasoning as the
      // decrement's catch block.
      try {
        await admin.from("order_events").delete().eq("id", claimId);
      } catch {
        // If even the release fails there is nothing further to try here; the
        // message below still reaches the caller and the trail.
      }
    }
    return result(false, "SALE_POST_FAILED", `The sale could not be recorded in the books: ${reason}`);
  }
}

/** Stamp the failure on the claimed marker so it is never invisible. */
async function fail(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  claimId: string,
  r: SalePostingResult,
): Promise<SalePostingResult> {
  try {
    await admin
      .from("order_events")
      .update({ note: `NOT recorded in the books: ${r.message}`.slice(0, 2000) })
      .eq("id", claimId);
  } catch {
    // The returned result still carries the reason to the caller.
  }
  return r;
}

type CostGather =
  | { kind: "ok"; costByLineId: Map<string, number | null> }
  | { kind: "failed"; message: string };

/**
 * Work out what this sale cost, from the lots it actually drew down.
 *
 * The FIFO draw itself is planned by `sale-decrement.ts`, which runs on the
 * same completion. It records which lots it touched on the order's own event
 * trail but does not persist a machine-readable per-lot draw, so the draw is
 * reconstructed here from the same inputs and the same planner — never
 * re-derived by a second, differently-behaving rule.
 */
async function gatherCosts(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  orderId: string,
  lines: readonly LineRow[],
): Promise<CostGather> {
  const { lotKeyForSaleLine, lotKeysForLines } = await import("@/lib/pos/variant-lot-core");
  const { buildLotDecrementPlan } = await import("@/lib/inventory/sale-decrement-core");
  const { isCustomLineProductId } = await import("@/lib/pos/custom-sale-core");
  const { drawsFromLotUpdates } = await import("@/lib/accounting/sale-cogs-core");

  const forPlan = lines
    .filter((l) => !isCustomLineProductId(l.product_id))
    .map((l) => ({
      lineId: l.id,
      productId: l.product_id,
      variantId: l.variant_id,
      productName: l.product_name,
      quantity: l.quantity,
    }));

  const costByLineId = new Map<string, number | null>();
  if (forPlan.length === 0) {
    for (const l of lines) costByLineId.set(l.id, null);
    return { kind: "ok", costByLineId };
  }

  const keys = lotKeysForLines(forPlan);
  // These filters MIRROR sale-decrement.ts exactly (active, on_hand > 0,
  // oldest first). Same lines + same lots + same planner = the same draw, so
  // the cost booked here is the cost of the units the decrement removes. Any
  // divergence in this query is a divergence in the books.
  const { data: lotRows, error } = await admin
    .from("inventory_lots")
    .select("id, pos_product_key, on_hand_qty, unit_cost_minor_units")
    .in("pos_product_key", keys)
    .eq("status", "active")
    .gt("on_hand_qty", 0)
    .order("created_at", { ascending: true });
  if (error) {
    return { kind: "failed", message: `Lot costs could not be read: ${error.message}` };
  }

  const rows = (lotRows as { id: string; pos_product_key: string | null; on_hand_qty: number; unit_cost_minor_units: number | null }[] | null) ?? [];

  // Reconstruct the draw with the SAME planner that moved the stock. Writing a
  // second FIFO rule here would be the classic accounting failure: two
  // implementations of one policy that agree until the day they do not, and
  // then quietly disagree about cost. The lots are passed oldest-first exactly
  // as the decrement passes them.
  //
  // ORDERING REQUIREMENT — why this must run BEFORE the inventory decrement.
  //
  // The decrement does not persist its per-lot draw in machine-readable form
  // (it writes a prose summary onto order_events). So the only way to know
  // which lots a sale consumed is to plan it from the SAME pre-sale lot
  // picture with the SAME planner. Run after the decrement, `on_hand_qty` is
  // already reduced, and any lot this sale drained to exactly zero can no
  // longer supply the replan — the plan would report a shortfall and refuse a
  // perfectly good sale, every time a sale happens to finish a lot.
  //
  // Hence `postSaleForOrder` is wired ahead of `decrementInventoryForOrder` in
  // orders-store.ts. Both call `buildLotDecrementPlan` with the same lines and
  // the same oldest-first lots, so the cost recorded is by construction the
  // cost of the units the decrement then removes.
  const preSaleLots = rows
    .filter((r) => !!r.pos_product_key)
    .map((r) => ({
      id: r.id,
      posProductKey: r.pos_product_key as string,
      onHandQty: r.on_hand_qty,
    }));

  const plan = buildLotDecrementPlan(forPlan, preSaleLots);
  const draws: LotDraw[] = [...drawsFromLotUpdates(plan.lotUpdates)];
  const costByLot = new Map<string, number | null>();
  for (const r of rows) costByLot.set(r.id, r.unit_cost_minor_units);
  const costRows = plan.lotUpdates.map((u) => ({
    lotId: u.id,
    unitCostCents: costByLot.get(u.id) ?? null,
  }));

  if (plan.shortfalls.length > 0) {
    return {
      kind: "failed",
      message:
        `This sale drew more stock than the lots can account for (${plan.shortfalls.join("; ")}), so its cost cannot be` +
        ` established. Receive the delivery that supplied this product so its cost is on the books, then re-post this sale.`,
    };
  }

  const costable: CostableLine[] = forPlan.map((l) => ({
    lineId: l.lineId,
    posProductKey: lotKeyForSaleLine(l),
    quantity: l.quantity,
  }));

  const costed = costSaleFromDraws(costable, draws, costRows);
  if (costed.kind === "refused") {
    return { kind: "failed", message: `${costed.explanation} ${costed.resolution}` };
  }

  for (const l of costed.lines) costByLineId.set(l.lineId, l.costCents);
  // Custom keypad lines track no stock and are priced without a lot; they get
  // an explicit null so the builder decides what to do, rather than this file
  // inventing a zero that would look like a real costed line.
  for (const l of lines) if (!costByLineId.has(l.id)) costByLineId.set(l.id, null);
  void orderId;
  return { kind: "ok", costByLineId };
}
