/**
 * GET /api/orders/[token] — guest confirmation read.
 *
 * Returns a customer-safe view of a single order looked up by its private
 * public_token (the value placed in the confirmation URL). Only fields the
 * customer should see are returned — no staff notes, no other orders.
 */
import { NextResponse } from "next/server";
import { getOrderByToken, registerPickedUpOrderIds } from "@/lib/orders/orders-store";
import { REGISTER_PICKED_UP_LABEL } from "@/lib/pos/pickup-progress-core";
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

  // SLICE L-37 — an order the customer picked up at the register is closed with
  // the NON-REVENUE "cancelled" status (the register sale is the sale of
  // record). The customer must see "Picked up", never "Cancelled". Best-effort:
  // registerPickedUpOrderIds never throws (empty set on error).
  const pickedUpAtRegister =
    order.status === "cancelled" && (await registerPickedUpOrderIds([order.id])).has(order.id);

  // Customer-safe projection. SLICE 113: orderNumber is the friendly pool name
  // when one was assigned, else the unique GWY-XXXXXX number — the confirmation
  // page already renders whatever this string is.
  return NextResponse.json({
    orderNumber: resolveOrderDisplay(order.display_name, order.order_number),
    status: order.status,
    statusLabel: pickedUpAtRegister ? REGISTER_PICKED_UP_LABEL : ORDER_STATUS_LABELS[order.status],
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
