/**
 * src/lib/orders/orders-store.ts
 *
 * Server-side service for Slice 7 order management.
 *
 * - createOrder(): guest-friendly placement (no auth required). Inserts the
 *   order + lines + a 'placed' event in one logical unit using the service-role
 *   client. Returns the DB-generated GWY number + the private public_token.
 * - getOrderByToken(): the guest confirmation page reads its OWN order by token.
 * - listOrders() / getOrder(): staff dashboard reads (with lines/events).
 * - setOrderStatus(): staff status transitions; stamps timestamps, writes an
 *   order_event, and is intended to be paired with an audit log entry by the
 *   caller (the admin action records the audit + permission check).
 * - updateStaffNote(): staff-only internal note.
 *
 * All DB access here uses the service-role client and is therefore SERVER-ONLY.
 * Auth/permission checks live in the admin actions and the API route, not here.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { classifyStatusCasMiss } from "@/lib/orders/status-cas-core";
import type {
  OrderRow,
  OrderLineRow,
  OrderEventRow,
  OrderWithLines,
  OrderStatus,
  PersistOrderInput,
  PlacedOrderResult,
} from "./types";
import { evaluateOrderTransition } from "./order-lifecycle-core";
import {
  EXPIRABLE_STATUS,
  RESERVATION_SWEEP_ACTOR,
  computeReservationExpiresAt,
  reservationExpiryNote,
  shouldExpireOrder,
} from "./reservation-expiry-core";

// ---------------------------------------------------------------------------
// Placement (guest, no auth) — input is SERVER-PRICED (see order-pricing.ts)
// ---------------------------------------------------------------------------

/** True when a PostgREST error looks like "column does not exist" (migration 0096 not applied yet). */
function isMissingColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42703" || /column .* does not exist|could not find .* column/i.test(error.message ?? "");
}

export async function createOrder(input: PersistOrderInput): Promise<PlacedOrderResult | null> {
  if (!isSupabaseServiceConfigured) return null;
  if (!input.lines.length) return null;

  const admin = createSupabaseAdminClient();

  // Soft reservation window: 24h advisory hold (POS/cart engine remain
  // truth). GW-028: the window is now ENFORCED — the daily cron closes
  // never-acknowledged orders as no_show once it passes (see
  // expireStaleReservations below + reservation-expiry-core.ts).
  const reservationExpiresAt = computeReservationExpiresAt(Date.now());

  const baseOrderRow = {
    status: "new",
    customer_first_name: input.customerFirstName.trim(),
    customer_last_name: input.customerLastName?.trim() || null,
    customer_email: input.customerEmail?.trim() || null,
    customer_phone: input.customerPhone?.trim() || null,
    customer_birthday: input.customerBirthday?.trim() || null,
    customer_note: input.customerNote?.trim() || null,
    subtotal_minor_units: input.subtotalMinorUnits,
    estimated_tax_minor_units: input.estimatedTaxMinorUnits,
    savings_minor_units: input.savingsMinorUnits,
    total_minor_units: input.totalMinorUnits,
    item_count: input.lines.reduce((sum, l) => sum + l.quantity, 0),
    reservation_expires_at: reservationExpiresAt,
  };

  // Preferred shape includes the 0096 limit-flag columns; fall back to the
  // legacy shape when the owner has not applied the migration yet.
  let { data: order, error } = await admin
    .from("orders")
    .insert({ ...baseOrderRow, limit_flag: input.limitFlag, limit_reasons: input.limitReasons })
    .select("id, order_number, public_token")
    .single<Pick<OrderRow, "id" | "order_number" | "public_token">>();

  if (error && isMissingColumnError(error)) {
    ({ data: order, error } = await admin
      .from("orders")
      .insert(baseOrderRow)
      .select("id, order_number, public_token")
      .single<Pick<OrderRow, "id" | "order_number" | "public_token">>());
  }

  if (error || !order) return null;

  const buildLineRows = (withCategory: boolean, withUnitGrams: boolean) =>
    input.lines.map((l) => ({
      order_id: order!.id,
      product_id: l.productId ?? null,
      variant_id: l.variantId ?? null,
      product_name: l.productName,
      brand: l.brand ?? null,
      variant_label: l.variantLabel ?? null,
      ...(withCategory ? { category: l.category } : {}),
      quantity: l.quantity,
      price_minor_units: l.priceMinorUnits,
      regular_price_minor_units: l.regularPriceMinorUnits ?? null,
      // AN-1 — sale-time weight snapshot (migration 0122); omitted when
      // unknown so unknown-weight lines keep the category-default gate math.
      ...(withUnitGrams && typeof l.unitGrams === "number" && l.unitGrams > 0
        ? { unit_grams: l.unitGrams }
        : {}),
    }));

  // Missing-column ladder: full row → without unit_grams (0122 unapplied) →
  // without category too (0096 unapplied). Same degrade-don't-fail posture
  // the category snapshot shipped with.
  let { error: linesError } = await admin.from("order_lines").insert(buildLineRows(true, true));
  if (linesError && isMissingColumnError(linesError)) {
    ({ error: linesError } = await admin.from("order_lines").insert(buildLineRows(true, false)));
  }
  if (linesError && isMissingColumnError(linesError)) {
    ({ error: linesError } = await admin.from("order_lines").insert(buildLineRows(false, false)));
  }
  if (linesError) {
    // Roll back the orphaned order so we never strand a header with no lines.
    await admin.from("orders").delete().eq("id", order.id);
    return null;
  }

  await admin.from("order_events").insert({
    order_id: order.id,
    event_type: "placed",
    to_status: "new",
    actor_label: "customer",
    note: "Order placed online.",
  });

  return { orderNumber: order.order_number, publicToken: order.public_token, orderId: order.id };
}

// ---------------------------------------------------------------------------
// Guest confirmation read (by private token)
// ---------------------------------------------------------------------------

export async function getOrderByToken(token: string): Promise<OrderWithLines | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();

  const { data: order } = await admin
    .from("orders")
    .select("*")
    .eq("public_token", token)
    .maybeSingle<OrderRow>();
  if (!order) return null;

  const { data: lines } = await admin
    .from("order_lines")
    .select("*")
    .eq("order_id", order.id)
    .order("created_at", { ascending: true });

  return { ...order, lines: (lines as OrderLineRow[]) ?? [] };
}

// ---------------------------------------------------------------------------
// Staff reads
// ---------------------------------------------------------------------------

export type ListOrdersFilter = {
  status?: OrderStatus | "active" | "all";
  search?: string;
  limit?: number;
};

/**
 * GW-033: paged staff read. Returns the page's rows AND the exact total so
 * the orders page can show "Showing X–Y of Z" with a real pager instead of
 * silently clipping at 200 rows.
 */
export async function listOrdersPaged(
  filter: ListOrdersFilter & { from: number; to: number },
): Promise<{ rows: OrderRow[]; total: number }> {
  if (!isSupabaseServiceConfigured) return { rows: [], total: 0 };
  const admin = createSupabaseAdminClient();

  let query = admin.from("orders").select("*", { count: "exact" });

  if (filter.status && filter.status !== "all") {
    if (filter.status === "active") {
      query = query.in("status", ["new", "acknowledged", "preparing", "ready"]);
    } else {
      query = query.eq("status", filter.status);
    }
  }

  const search = filter.search?.trim();
  if (search) {
    const like = `%${search}%`;
    query = query.or(
      [
        `order_number.ilike.${like}`,
        `customer_first_name.ilike.${like}`,
        `customer_last_name.ilike.${like}`,
        `customer_phone.ilike.${like}`,
      ].join(","),
    );
  }

  const { data, count } = await query
    .order("placed_at", { ascending: false })
    .range(filter.from, filter.to);
  return { rows: (data as OrderRow[]) ?? [], total: count ?? 0 };
}

export async function listOrders(filter: ListOrdersFilter = {}): Promise<OrderRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();

  let query = admin.from("orders").select("*");

  if (filter.status && filter.status !== "all") {
    if (filter.status === "active") {
      query = query.in("status", ["new", "acknowledged", "preparing", "ready"]);
    } else {
      query = query.eq("status", filter.status);
    }
  }

  const search = filter.search?.trim();
  if (search) {
    // Match order number, first/last name, or phone (digits-insensitive on phone).
    const like = `%${search}%`;
    query = query.or(
      [
        `order_number.ilike.${like}`,
        `customer_first_name.ilike.${like}`,
        `customer_last_name.ilike.${like}`,
        `customer_phone.ilike.${like}`,
      ].join(","),
    );
  }

  query = query.order("placed_at", { ascending: false }).limit(filter.limit ?? 200);

  const { data } = await query;
  return (data as OrderRow[]) ?? [];
}

export async function getOrder(id: string): Promise<OrderWithLines | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();

  const { data: order } = await admin
    .from("orders")
    .select("*")
    .eq("id", id)
    .maybeSingle<OrderRow>();
  if (!order) return null;

  const [{ data: lines }, { data: events }] = await Promise.all([
    admin.from("order_lines").select("*").eq("order_id", id).order("created_at", { ascending: true }),
    admin.from("order_events").select("*").eq("order_id", id).order("created_at", { ascending: true }),
  ]);

  return {
    ...order,
    lines: (lines as OrderLineRow[]) ?? [],
    events: (events as OrderEventRow[]) ?? [],
  };
}

/**
 * Quick counts per status for the dashboard header.
 *
 * Uses exact server-side head counts (one cheap indexed count per status \u2014
 * orders_status_idx) instead of fetching every row. The previous
 * `select("status")` approach silently truncated at PostgREST's `db.max_rows`
 * cap (default 1000), so once the store passed 1000 lifetime orders the
 * dashboard/cockpit/new-order-poll counts all under-reported.
 */
export async function getOrderStatusCounts(): Promise<Record<OrderStatus, number>> {
  const empty: Record<OrderStatus, number> = {
    new: 0,
    acknowledged: 0,
    preparing: 0,
    ready: 0,
    completed: 0,
    cancelled: 0,
    no_show: 0,
  };
  if (!isSupabaseServiceConfigured) return empty;
  const admin = createSupabaseAdminClient();
  const statuses = Object.keys(empty) as OrderStatus[];
  const counts = await Promise.all(
    statuses.map(async (status) => {
      const { count } = await admin
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("status", status);
      return count ?? 0;
    }),
  );
  statuses.forEach((status, i) => {
    empty[status] = counts[i];
  });
  return empty;
}

// ---------------------------------------------------------------------------
// Staff mutations
// ---------------------------------------------------------------------------

export type SetStatusOptions = {
  actorId?: string | null;
  actorLabel?: string | null;
  note?: string | null;
  /**
   * Written reason required for any REVERSAL (reopening a closed order or
   * moving backward in the active chain). See order-lifecycle-core.ts (S-15).
   */
  reversalReason?: string | null;
};

export type SetOrderStatusResult =
  | { ok: true; order: OrderRow }
  | { ok: false; refusal: string | null };

export async function setOrderStatus(
  id: string,
  toStatus: OrderStatus,
  opts: SetStatusOptions = {},
): Promise<SetOrderStatusResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, refusal: null };
  const admin = createSupabaseAdminClient();

  const { data: current } = await admin
    .from("orders")
    .select("status")
    .eq("id", id)
    .maybeSingle<{ status: OrderStatus }>();
  if (!current) return { ok: false, refusal: null };
  const fromStatus = current.status;

  // ── S-15 lifecycle gate: enforce the legal transition matrix at the STORE
  //    layer so no caller can rewind a closed sale without a reasoned,
  //    audited reversal (completed→new was previously possible).
  const verdict = evaluateOrderTransition(fromStatus, toStatus, {
    reversalReason: opts.reversalReason ?? null,
  });
  if (!verdict.allowed) {
    return { ok: false, refusal: verdict.reason ?? "Status change not permitted." };
  }
  if (verdict.kind === "noop") {
    const { data: same } = await admin
      .from("orders")
      .select("*")
      .eq("id", id)
      .maybeSingle<OrderRow>();
    return same ? { ok: true, order: same } : { ok: false, refusal: null };
  }

  const patch: Record<string, unknown> = {
    status: toStatus,
    handled_by: opts.actorId ?? null,
  };
  const now = new Date().toISOString();
  if (toStatus === "acknowledged") patch.acknowledged_at = now;
  if (toStatus === "ready") patch.ready_at = now;
  if (toStatus === "completed") patch.completed_at = now;
  // Reversals rewind history — clear the timestamps of statuses being undone
  // so the row reflects the true current position in the workflow.
  if (verdict.kind === "reversal") {
    if (fromStatus === "completed") patch.completed_at = null;
    if (toStatus === "new" || toStatus === "acknowledged" || toStatus === "preparing") {
      patch.ready_at = null;
    }
    if (toStatus === "new") patch.acknowledged_at = null;
  }

  // ── GW-011: TRUE compare-and-swap. The update only lands if the status is
  //    still the one we read a moment ago — two actors completing the same
  //    order in the same instant can no longer BOTH win and BOTH run the
  //    side effects (double inventory decrement, double loyalty earn).
  const { data: updated } = await admin
    .from("orders")
    .update(patch)
    .eq("id", id)
    .eq("status", fromStatus)
    .select("*")
    .maybeSingle<OrderRow>();
  if (!updated) {
    // CAS miss: somebody changed the order between our read and our write.
    const { data: after } = await admin
      .from("orders")
      .select("*")
      .eq("id", id)
      .maybeSingle<OrderRow>();
    const verdict = classifyStatusCasMiss(toStatus, after?.status ?? null);
    if (verdict.kind === "converged" && after) {
      // The other actor made the SAME transition and already ran the side
      // effects (which are DB-latched anyway) — converge quietly.
      return { ok: true, order: after };
    }
    return {
      ok: false,
      refusal: verdict.kind === "conflict" ? verdict.refusal : null,
    };
  }

  const reversalNote =
    verdict.kind === "reversal"
      ? `REVERSAL (${fromStatus} → ${toStatus}): ${(opts.reversalReason ?? "").trim()}`
      : null;
  await admin.from("order_events").insert({
    order_id: id,
    event_type: "status_changed",
    from_status: fromStatus,
    to_status: toStatus,
    note: reversalNote ?? opts.note ?? null,
    actor_id: opts.actorId ?? null,
    actor_label: opts.actorLabel ?? null,
  });

  // Loyalty code release (Task S-a): when an order closes WITHOUT completing,
  // any redemption code consumed by it is returned to the customer — the sale
  // never happened, so their stored value must survive. Best-effort; never
  // blocks the transition.
  if ((toStatus === "cancelled" || toStatus === "no_show") && fromStatus !== toStatus) {
    try {
      const { releaseLoyaltyCodeForOrder } = await import("@/lib/loyalty/loyalty-sale-store");
      await releaseLoyaltyCodeForOrder(id);
    } catch {
      // Release must never block the cancellation.
    }
  }

  // Inventory decrement (POS B19): when an order completes, reduce the
  // published menu variant levels and consume inventory lots FIFO. Idempotent
  // per order (order_events marker); best-effort — a stock-write failure
  // leaves a visible note but NEVER blocks the completed sale.
  if (toStatus === "completed" && fromStatus !== "completed") {
    try {
      const { decrementInventoryForOrder } = await import("@/lib/inventory/sale-decrement");
      await decrementInventoryForOrder(id);
    } catch {
      // Decrement must never block order completion.
    }
  }

  // Loyalty accrual: when an order is completed, earn points on the PRETAX
  // subtotal for the linked customer (idempotent per order; no-op if there is
  // no customer or no points to earn). The subtotal is post-discount, so
  // points reflect what the customer actually paid.
  if (toStatus === "completed" && fromStatus !== "completed") {
    const customerId = (updated as unknown as { customer_id?: string | null }).customer_id ?? null;
    if (customerId) {
      try {
        const { accrueForOrder } = await import("@/lib/loyalty/loyalty-store");
        await accrueForOrder({
          customerId,
          orderId: id,
          subtotalMinor: updated.subtotal_minor_units,
          actorId: opts.actorId ?? null,
        });
      } catch {
        // Accrual must never block order completion.
      }
    }
  }

  return { ok: true, order: updated };
}

// ---------------------------------------------------------------------------
// GW-028 — reservation-window enforcement (daily cron sweep)
// ---------------------------------------------------------------------------

export type ReservationSweepResult = {
  ok: boolean;
  /** Orders closed as no_show this run. */
  expired: number;
  /** Candidates that could not be closed (CAS miss / lifecycle refusal). */
  skipped: number;
  error?: string;
};

/** Bounded batch per run — the daily cron drains any backlog across days. */
const RESERVATION_SWEEP_MAX = 200;

/**
 * Close website orders whose 24h reservation window has passed while still
 * sitting at `new` (never acknowledged by staff). They become `no_show` —
 * the same terminal status a manual no-show uses — via the full
 * setOrderStatus path, so the lifecycle gate, CAS guard, order_events
 * trail, and loyalty-code release all apply exactly as they would for a
 * human action. If the customer shows up later, staff reopen the order
 * (no_show → new reversal) like any other no-show.
 *
 * Safe by construction:
 *  - Only `new` orders qualify (a status the sweep re-checks via the pure
 *    policy AND setOrderStatus re-reads under CAS — an order acknowledged
 *    mid-sweep is skipped, never closed).
 *  - Inventory is untouched: stock only decrements at COMPLETION, so an
 *    expired order releases nothing — it just stops cluttering the queue.
 *  - Never throws; the cron reports the outcome and moves on.
 */
export async function expireStaleReservations(now = new Date()): Promise<ReservationSweepResult> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, expired: 0, skipped: 0, error: "Database not configured." };
  }
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("orders")
    .select("id, status, reservation_expires_at")
    .eq("status", EXPIRABLE_STATUS)
    .lt("reservation_expires_at", now.toISOString())
    .order("reservation_expires_at", { ascending: true })
    .limit(RESERVATION_SWEEP_MAX);
  if (error) {
    return { ok: false, expired: 0, skipped: 0, error: error.message };
  }

  let expired = 0;
  let skipped = 0;
  for (const row of (data ?? []) as { id: string; status: string; reservation_expires_at: string | null }[]) {
    // Belt-and-suspenders: re-check via the pure policy (the SQL filter and
    // the policy must agree; if they ever drift, the policy wins and the
    // order is left for a human).
    if (!shouldExpireOrder(row, now.getTime())) {
      skipped += 1;
      continue;
    }
    const result = await setOrderStatus(row.id, "no_show", {
      note: reservationExpiryNote(row.reservation_expires_at),
      actorLabel: RESERVATION_SWEEP_ACTOR,
    });
    if (result.ok) expired += 1;
    else skipped += 1; // CAS miss (staff grabbed it mid-sweep) or refusal — leave it.
  }
  return { ok: true, expired, skipped };
}

export async function updateStaffNote(
  id: string,
  note: string,
  opts: SetStatusOptions = {},
): Promise<boolean> {
  if (!isSupabaseServiceConfigured) return false;
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("orders").update({ staff_note: note }).eq("id", id);
  if (error) return false;
  await admin.from("order_events").insert({
    order_id: id,
    event_type: "note",
    note,
    actor_id: opts.actorId ?? null,
    actor_label: opts.actorLabel ?? null,
  });
  return true;
}
