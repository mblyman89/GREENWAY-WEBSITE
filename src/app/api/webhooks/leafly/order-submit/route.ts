/**
 * POST /api/webhooks/leafly/order-submit   (Slice L-5)
 *
 * Leafly tells us a shopper has placed an order. This is the single most
 * important endpoint in the whole integration:
 *
 *   • It is marked **_Required_** in Leafly's production-readiness table.
 *   • It is the only event that carries `acknowledgeBy` — Leafly's OWN deadline.
 *     Per the spec: "Orders are acknowledged as having been retrieved in whole
 *     by your system within fifteen minutes of receiving an order submission
 *     webhook. Any orders not acknowledged by this deadline will be auto
 *     canceled."
 *
 * The deadline is STORED AS LEAFLY SENT IT and never recomputed locally as
 * "now + 15 minutes". Our clock and theirs will differ, and any error we
 * introduce lands in the direction that loses a real customer's order.
 *
 * NOTE ON WHAT THIS ROUTE DOES *NOT* DO: it does not acknowledge the order.
 * Acknowledgement is an outbound API call and belongs to slice L-6. Until that
 * lands, this endpoint records the order and its deadline so nothing is lost,
 * and the deadline is visible rather than implicit.
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

export const POST = createLeaflyWebhookRoute("order_submit");
