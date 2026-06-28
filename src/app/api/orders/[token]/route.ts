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

  // Customer-safe projection.
  return NextResponse.json({
    orderNumber: order.order_number,
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
      quantity: l.quantity,
      priceMinorUnits: l.price_minor_units,
      regularPriceMinorUnits: l.regular_price_minor_units,
    })),
  });
}
