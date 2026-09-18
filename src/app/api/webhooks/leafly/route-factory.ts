import "server-only";

/**
 * src/app/api/webhooks/leafly/route-factory.ts  (Slice L-5)
 *
 * The five "notification" Leafly order webhooks are byte-for-byte the same
 * handler with a different event name. Writing that handler once and naming it
 * five times is not laziness — it is the whole point. Leafly's rule is
 * unforgiving and uniform:
 *
 *   "Unless Leafly's outbound HMAC keys fails your validation, webhook requests
 *    should only be responded to with status codes 200 or 201. These webhook
 *    events are not the place to apply business rules or validations on the
 *    order lifecycle."
 *
 * Five hand-written copies is five chances for one of them to grow a `return
 * NextResponse.json(..., { status: 400 })` during a late-night fix. A 400 here
 * makes Leafly retry and then auto-cancel a paying customer's order, so the
 * cheapest way to guarantee all five behave is to give them one body.
 *
 * `order_preview` is deliberately NOT built by this factory. It is the only
 * event that must answer with a populated JSON body, and it has its own route
 * so that difference is visible in the file tree rather than hidden behind a
 * flag.
 */

import { NextResponse } from "next/server";
import { handleLeaflyWebhook } from "@/lib/leafly/webhook-server";
import type { LeaflyWebhookEventType } from "@/lib/leafly/webhook-parse-core";

/**
 * Build the POST handler for a notification-style Leafly order webhook.
 *
 * Returns an EMPTY body on success, which is what Leafly's requirements table
 * asks for: "200 Ok, empty response bodies". We use 200 rather than 204 because
 * the table names 200 explicitly and 204 is a different status; matching the
 * documented expectation exactly is free, and deviating from it is the kind of
 * thing that shows up in a certification review as a question we would rather
 * not have to answer.
 */
export function createLeaflyWebhookRoute(expectedEvent: LeaflyWebhookEventType) {
  return async function POST(request: Request): Promise<Response> {
    // The RAW body, read exactly once and never re-serialised. The HMAC is over
    // these precise bytes; JSON.parse + JSON.stringify would reorder keys and
    // change whitespace, and the signature would never match again.
    let rawBody: string;
    try {
      rawBody = await request.text();
    } catch {
      // We could not even read the request. There is nothing to verify and
      // nothing to store. Answering 401 would wrongly accuse Leafly of a bad
      // signature; answering 500 would trigger the retry-then-auto-cancel path.
      // 200 with an empty body is the honest, least-harmful answer: Leafly's
      // own retry on a genuinely dropped connection will bring it back.
      console.error(`[leafly ${expectedEvent}] could not read the request body`);
      return new NextResponse(null, { status: 200 });
    }

    const handled = await handleLeaflyWebhook({
      rawBody,
      headers: request.headers,
      expectedEvent,
    });

    if (handled.status === 401) {
      // Log the real reason on OUR side only. Telling an unauthenticated caller
      // why their signature failed is free reconnaissance for forging the next
      // one.
      console.warn(handled.logLine);
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }

    console.log(handled.logLine);
    return new NextResponse(null, { status: 200 });
  };
}
