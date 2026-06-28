/**
 * src/app/api/admin/orders/count/route.ts
 *
 * Tiny, permission-gated JSON endpoint the Orders dashboard polls to detect
 * NEW orders without a full page reload. Returns the live status counts.
 * Staff-only (orders.view). No order PII — just integer counts.
 */
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/session";
import { getOrderStatusCounts } from "@/lib/orders/orders-store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requirePermission("orders.view");
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const counts = await getOrderStatusCounts();
  const active = counts.new + counts.acknowledged + counts.preparing + counts.ready;
  return NextResponse.json(
    { counts, active, ts: Date.now() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
