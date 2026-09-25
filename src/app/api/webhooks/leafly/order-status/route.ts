/**
 * POST /api/webhooks/leafly/order-status   (Slice L-5)
 *
 * Leafly tells us an order's status changed somewhere other than in our own
 * system. Marked _Recommended_: "Keeps your integration synchronized with 3rd
 * party delivery lifecycle."
 *
 * This is mostly an INBOUND mirror. Once this integration is live, per the
 * spec, "The Leafly Order Dashboard will become read-only, as your software
 * system will become the source of truth for order statuses and cart totals" —
 * so most status motion originates with us. The exception is third-party
 * delivery: "If a retailer is using both an order integration with your
 * point-of-sale and a delivery integration at the same time, the order API will
 * no longer accept updates to delivery statuses, and will instead receive
 * updates from the delivery integration, then send them to you in the form of a
 * webhook."
 *
 * Greenway does not deliver — Washington prohibits cannabis delivery to
 * consumers — so `out_for_delivery` and `arrived_at_customer` are mapped to NO
 * local status by `order-map-core.ts` rather than being forced onto a pickup
 * lifecycle where they would be nonsense. They are still recorded, because an
 * unexpected delivery status arriving here is a fact worth having.
 */
import { createLeaflyWebhookRoute } from "../route-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// SLICE L-46: Leafly counts an answer slower than 9 seconds as a failure, so
// the 200 goes out inside a 6-second budget and any unfinished work keeps
// running after it (Next `after()`). That work lives only as long as the
// function, and this is how long that is. Must be a literal (Next reads it
// statically); pinned equal to LEAFLY_WEBHOOK_MAX_DURATION_S by a test.
export const maxDuration = 300;

export const POST = createLeaflyWebhookRoute("order_status");
