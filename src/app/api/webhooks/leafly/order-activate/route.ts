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
// SLICE L-46: Leafly counts an answer slower than 9 seconds as a failure, so
// the 200 goes out inside a 6-second budget and any unfinished work keeps
// running after it (Next `after()`). That work lives only as long as the
// function, and this is how long that is. Must be a literal (Next reads it
// statically); pinned equal to LEAFLY_WEBHOOK_MAX_DURATION_S by a test.
export const maxDuration = 300;

export const POST = createLeaflyWebhookRoute("order_activate");
