/**
 * src/lib/pos/member-history-store.ts  (POS Slice B29)
 *
 * Server fetch for the register's member purchase history: the attached
 * member's last few COMPLETED orders (any channel — website pickups and
 * register sales both carry orders.customer_id) shaped through the pure
 * privacy budget in member-history-core (recent purchases + favorites,
 * nothing else). ONLINE-ONLY like every member surface — no customer data
 * is ever cached on the iPad beyond the open panel.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  buildMemberHistory,
  HISTORY_ORDER_LIMIT,
  type HistoryOrderInput,
  type MemberHistory,
} from "@/lib/pos/member-history-core";

export type MemberHistoryResult = { ok: true; history: MemberHistory } | { ok: false; error: string };

export async function getMemberHistoryForRegister(customerId: string): Promise<MemberHistoryResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };
  const admin = createSupabaseAdminClient();

  // The customer must exist (a dangling id from a stale panel is an error,
  // not an empty history).
  const { data: customer } = await admin
    .from("customers")
    .select("id")
    .eq("id", customerId)
    .maybeSingle<{ id: string }>();
  if (!customer) return { ok: false, error: "Member not found — search again." };

  const { data: orderRows, error } = await admin
    .from("orders")
    .select("id, completed_at, total_minor_units")
    .eq("customer_id", customerId)
    .eq("status", "completed")
    .order("completed_at", { ascending: false, nullsFirst: false })
    .limit(HISTORY_ORDER_LIMIT);
  if (error) return { ok: false, error: `Could not read purchase history: ${error.message}` };

  const orders =
    (orderRows as { id: string; completed_at: string | null; total_minor_units: number }[] | null) ?? [];
  if (orders.length === 0) {
    return { ok: true, history: { purchases: [], favorites: [] } };
  }

  const { data: lineRows } = await admin
    .from("order_lines")
    .select("order_id, product_name, quantity")
    .in("order_id", orders.map((o) => o.id));
  const linesByOrder = new Map<string, { productName: string; quantity: number }[]>();
  for (const l of (lineRows as { order_id: string; product_name: string; quantity: number }[] | null) ?? []) {
    const list = linesByOrder.get(l.order_id) ?? [];
    list.push({ productName: l.product_name, quantity: l.quantity });
    linesByOrder.set(l.order_id, list);
  }

  const inputs: HistoryOrderInput[] = orders.map((o) => ({
    orderId: o.id,
    completedAtIso: o.completed_at,
    totalMinor: o.total_minor_units,
    lines: linesByOrder.get(o.id) ?? [],
  }));

  return { ok: true, history: buildMemberHistory(inputs, new Date().toISOString()) };
}
