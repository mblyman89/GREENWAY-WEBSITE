/**
 * POST /api/webhooks/leafly/order-deactivate   (Slice L-5)
 *
 * Leafly tells us a retailer has been deactivated from the order integration.
 * Marked _Optional_ ("Notifies your integration of retailer deactivation").
 *
 * Deliberately NON-DESTRUCTIVE. A deactivation notice does not delete orders,
 * does not clear credentials, and does not cancel anything. Two reasons:
 * deactivation is frequently temporary (a billing or configuration change), and
 * any in-flight order still has a real customer attached to it who is expecting
 * to collect it. The event is recorded and surfaced; acting on it is a human
 * decision.
 *
 * Like `order_activate`, this payload carries no `orderId`.
 */
import { createLeaflyWebhookRoute } from "../route-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createLeaflyWebhookRoute("order_deactivate");
