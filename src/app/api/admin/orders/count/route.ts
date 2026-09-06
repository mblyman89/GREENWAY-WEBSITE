/**
 * src/app/api/admin/orders/count/route.ts
 *
 * Tiny, permission-gated JSON endpoint the Orders dashboard polls to detect
 * NEW orders without a full page reload. Staff-only (orders.view). No order
 * PII — just integer counts plus the customer-facing label already shown on
 * the dashboard.
 *
 * SLICE 22 — now also returns recent ARRIVALS.
 *
 * The chime used to be driven by `counts.new`, the number of orders currently
 * sitting in status "new". That is a LEVEL: acknowledging an order lowers it,
 * so an order placed right after staff worked the queue produced no sound at
 * all (the owner's report). `orders.placed_at` is DB-assigned at insert and
 * never altered by a status change, so a list of recent arrivals gives the
 * client a signal that only moves forward. The pure rules live in
 * new-order-watch-core.ts.
 *
 * `counts` is kept EXACTLY as it was so existing readers are unaffected.
 */
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/session";
import { getOrderStatusCounts, getRecentOrderArrivals } from "@/lib/orders/orders-store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requirePermission("orders.view");
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [counts, arrivals] = await Promise.all([
    getOrderStatusCounts(),
    getRecentOrderArrivals(20),
  ]);
  const active = counts.new + counts.acknowledged + counts.preparing + counts.ready;
  return NextResponse.json(
    { counts, active, arrivals, ts: Date.now() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
