/**
 * POST /api/webhooks/leafly/order-activate   (Slice L-5)
 *
 * Leafly tells us a retailer has been activated on the order integration.
 * Marked _Optional_ ("Opportunity to gate retailer activation"), but built
 * because the owner asked for all six and because the alternative — an
 * unimplemented URL returning a 404 to Leafly — looks like a broken integration
 * during certification review.
 *
 * IMPORTANT SHAPE DIFFERENCE: this event carries NO `orderId`. The activation
 * and deactivation payloads are the two exceptions, which is why
 * `leafly_webhook_events.order_id` is nullable and why the parse core treats a
 * missing order id on these events as normal rather than as an error.
 */
import { createLeaflyWebhookRoute } from "../route-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createLeaflyWebhookRoute("order_activate");
