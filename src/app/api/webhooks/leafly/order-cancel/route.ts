/**
 * POST /api/webhooks/leafly/order-cancel   (Slice L-5)
 *
 * Leafly tells us an order has been cancelled. Marked **_Required_** for
 * production graduation.
 *
 * The `cancelationReasonCode` matters operationally and is stored verbatim.
 * Leafly's enum is: not_picked_up, customer, dispensary, pos, delivery_partner,
 * ecommerce_partner, order_api_unacknowledged. The last one means WE missed the
 * fifteen-minute acknowledgement window — it is the integration failing, not a
 * shopper changing their mind, and collapsing the two into a single "cancelled"
 * would hide exactly the failure we most need to see.
 *
 * Note also the spelling: Leafly writes "canceled" with ONE l throughout, while
 * Greenway's own order status is "cancelled" with two. `order-map-core.ts` owns
 * that translation so it is done in one place.
 */
import { createLeaflyWebhookRoute } from "../route-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createLeaflyWebhookRoute("order_cancel");
