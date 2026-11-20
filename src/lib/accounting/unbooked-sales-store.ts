import "server-only";
/**
 * src/lib/accounting/unbooked-sales-store.ts  (D261)
 *
 * The owner's "sales not in the books" tool: lists the sales the ledger
 * refused (order_events ledger_sale_posted note "NOT recorded ..."), the sales
 * that booked with a FLAG (a lot topped up / costed from a duplicate card, or
 * a line left out), and re-posts refused sales through the normal
 * postSaleForOrder path (which since D261 books the good lines and supplies
 * short lots from their own costed lot).
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { postSaleForOrder, SALE_POSTING_EVENT_TYPE } from "@/lib/accounting/sale-posting-service";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type UnbookedRow = { orderId: string; orderNumber: string; at: string; totalCents: number; note: string };

async function withOrders(admin: Admin, ev: { order_id: string; note: string | null; created_at: string }[]): Promise<UnbookedRow[]> {
  const ids = [...new Set(ev.map((e) => e.order_id))];
  const byId = new Map<string, { order_number: string; total_minor_units: number; completed_at: string | null }>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin.from("orders").select("id, order_number, total_minor_units, completed_at").in("id", ids.slice(i, i + 200));
    for (const o of (data ?? []) as { id: string; order_number: string; total_minor_units: number; completed_at: string | null }[]) byId.set(o.id, o);
  }
  return ev.map((e) => {
    const o = byId.get(e.order_id);
    return { orderId: e.order_id, orderNumber: o?.order_number ?? e.order_id, at: o?.completed_at ?? e.created_at, totalCents: o?.total_minor_units ?? 0, note: e.note ?? "" };
  });
}

async function events(admin: Admin, pattern: string, limit: number) {
  const { data, error } = await admin
    .from("order_events")
    .select("order_id, note, created_at")
    .eq("event_type", SALE_POSTING_EVENT_TYPE)
    .ilike("note", pattern)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as { order_id: string; note: string | null; created_at: string }[];
}

/** Refused sales (whole sale not in the books) and sales booked with a flag. */
export async function readUnbooked(admin: Admin = createSupabaseAdminClient()) {
  const refused = await withOrders(admin, await events(admin, "NOT recorded%", 1000));
  const flagged = await withOrders(admin, await events(admin, "%FLAG %", 300));
  return { refused, flagged };
}

/** Re-post up to `max` refused sales (oldest first), or the one order number given. */
export async function repostUnbooked(opts: { orderNumber?: string; max?: number }, admin: Admin = createSupabaseAdminClient()) {
  let ids: string[];
  if (opts.orderNumber) {
    const { data } = await admin.from("orders").select("id, status").eq("order_number", opts.orderNumber.trim()).limit(1);
    const o = (data ?? [])[0] as { id: string; status: string } | undefined;
    if (!o) return { posted: 0, failed: [`${opts.orderNumber}: no such order`] };
    if (o.status !== "completed") return { posted: 0, failed: [`${opts.orderNumber}: not completed (${o.status})`] };
    ids = [o.id];
  } else {
    ids = (await events(admin, "NOT recorded%", 1000)).map((e) => e.order_id).reverse().slice(0, opts.max ?? 40);
  }
  let posted = 0;
  const failed: string[] = [];
  for (const id of ids) {
    // Only a REFUSED latch is released; a booked sale is never posted twice.
    await admin.from("order_events").delete().eq("order_id", id).eq("event_type", SALE_POSTING_EVENT_TYPE).ilike("note", "NOT recorded%");
    const r = await postSaleForOrder(id);
    if (r.code === "SALE_POSTED") posted++;
    else if (r.code !== "SALE_ALREADY_POSTED") failed.push(`${id.slice(0, 8)}: ${r.message}`.slice(0, 300));
  }
  return { posted, failed };
}
