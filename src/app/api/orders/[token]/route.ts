/**
 * GET /api/orders/[token] — guest confirmation read.
 *
 * Returns a customer-safe view of a single order looked up by its private
 * public_token (the value placed in the confirmation URL). Only fields the
 * customer should see are returned — no staff notes, no other orders.
 */
import { NextResponse } from "next/server";
import { getOrderByToken } from "@/lib/orders/orders-store";
import { ORDER_STATUS_LABELS } from "@/lib/orders/types";
import { resolveOrderDisplay } from "@/lib/orders/order-name-pool-core";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!token) {
    return NextResponse.json({ error: "Missing token." }, { status: 400 });
  }

  const order = await getOrderByToken(token);
  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  // Customer-safe projection. SLICE 113: orderNumber is the friendly pool name
  // when one was assigned, else the unique GWY-XXXXXX number — the confirmation
  // page already renders whatever this string is.
  return NextResponse.json({
    orderNumber: resolveOrderDisplay(order.display_name, order.order_number),
    status: order.status,
    statusLabel: ORDER_STATUS_LABELS[order.status],
    placedAt: order.placed_at,
    customerFirstName: order.customer_first_name,
    subtotalMinorUnits: order.subtotal_minor_units,
    estimatedTaxMinorUnits: order.estimated_tax_minor_units,
    savingsMinorUnits: order.savings_minor_units,
    totalMinorUnits: order.total_minor_units,
    lines: order.lines.map((l) => ({
      productName: l.product_name,
      brand: l.brand,
      variantLabel: l.variant_label,
      // SLICE 98: category snapshot (migration 0096; null on legacy rows) so
      // the confirmation shows ounces for topicals/edibles/liquids.
      category: l.category ?? null,
      quantity: l.quantity,
      priceMinorUnits: l.price_minor_units,
      regularPriceMinorUnits: l.regular_price_minor_units,
    })),
  });
}
