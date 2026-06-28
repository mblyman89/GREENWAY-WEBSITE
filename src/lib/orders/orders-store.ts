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
import type {
  OrderRow,
  OrderLineRow,
  OrderEventRow,
  OrderWithLines,
  OrderStatus,
  NewOrderInput,
  PlacedOrderResult,
} from "./types";

// ---------------------------------------------------------------------------
// Placement (guest, no auth)
// ---------------------------------------------------------------------------

export async function createOrder(input: NewOrderInput): Promise<PlacedOrderResult | null> {
  if (!isSupabaseServiceConfigured) return null;
  if (!input.lines.length) return null;

  const admin = createSupabaseAdminClient();

  // Soft reservation window: 24h advisory hold (POS/cart engine remain truth).
  const reservationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { data: order, error } = await admin
    .from("orders")
    .insert({
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
    })
    .select("id, order_number, public_token")
    .single<Pick<OrderRow, "id" | "order_number" | "public_token">>();

  if (error || !order) return null;

  const lineRows = input.lines.map((l) => ({
    order_id: order.id,
    product_id: l.productId ?? null,
    variant_id: l.variantId ?? null,
    product_name: l.productName,
    brand: l.brand ?? null,
    variant_label: l.variantLabel ?? null,
    quantity: l.quantity,
    price_minor_units: l.priceMinorUnits,
    regular_price_minor_units: l.regularPriceMinorUnits ?? null,
  }));

  const { error: linesError } = await admin.from("order_lines").insert(lineRows);
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

  return { orderNumber: order.order_number, publicToken: order.public_token };
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

/** Quick counts per active status for the dashboard header. */
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
  const { data } = await admin.from("orders").select("status");
  if (!data) return empty;
  for (const row of data as { status: OrderStatus }[]) {
    empty[row.status] = (empty[row.status] ?? 0) + 1;
  }
  return empty;
}

// ---------------------------------------------------------------------------
// Staff mutations
// ---------------------------------------------------------------------------

export type SetStatusOptions = {
  actorId?: string | null;
  actorLabel?: string | null;
  note?: string | null;
};

export async function setOrderStatus(
  id: string,
  toStatus: OrderStatus,
  opts: SetStatusOptions = {},
): Promise<OrderRow | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();

  const { data: current } = await admin
    .from("orders")
    .select("status")
    .eq("id", id)
    .maybeSingle<{ status: OrderStatus }>();
  if (!current) return null;
  const fromStatus = current.status;

  const patch: Record<string, unknown> = {
    status: toStatus,
    handled_by: opts.actorId ?? null,
  };
  const now = new Date().toISOString();
  if (toStatus === "acknowledged") patch.acknowledged_at = now;
  if (toStatus === "ready") patch.ready_at = now;
  if (toStatus === "completed") patch.completed_at = now;

  const { data: updated } = await admin
    .from("orders")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle<OrderRow>();
  if (!updated) return null;

  await admin.from("order_events").insert({
    order_id: id,
    event_type: "status_changed",
    from_status: fromStatus,
    to_status: toStatus,
    note: opts.note ?? null,
    actor_id: opts.actorId ?? null,
    actor_label: opts.actorLabel ?? null,
  });

  return updated;
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
