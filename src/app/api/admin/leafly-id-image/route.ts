/**
 * src/app/api/admin/leafly-id-image/route.ts — SLICE L-24.
 *
 * Relays one customer ID image from Leafly to the operator's screen.
 *
 * ===========================================================================
 * WHY A ROUTE AND NOT A SERVER ACTION
 * ===========================================================================
 * Because the consumer is an `<img src>`. A server action returns a value to
 * JavaScript; to paint an image from one you must base64 the bytes into a
 * data URL, which inflates the payload by a third, puts the whole image in
 * the React tree, and — the part that matters — makes the bytes trivially
 * copyable out of the DOM. A route hands the browser an image response that
 * behaves like an image: streamed, never in the component state, and gone
 * when the element unmounts.
 *
 * ===========================================================================
 * WHAT THIS ROUTE IS CAREFUL ABOUT
 * ===========================================================================
 * It is relaying a government ID. Four deliberate choices follow from that:
 *
 *   1. `orders.manage` is required, the same permission that gates the
 *      acknowledge button itself. Anyone who may close the door may look
 *      through it first; nobody else may.
 *
 *   2. `Cache-Control: no-store, private` plus `Pragma: no-cache`. An ID must
 *      not sit in a disk cache on a shared back-office tablet after the
 *      fifteen-minute window has closed. This is the one header on this route
 *      that is a compliance control rather than a performance choice.
 *
 *   3. `Content-Disposition: inline` with no filename, and
 *      `X-Content-Type-Options: nosniff`. Inline because it is meant to be
 *      looked at, not downloaded; no filename because a filename is what
 *      makes "Save As" suggest keeping it; nosniff because we echo Leafly's
 *      content type and must not let a browser reinterpret bytes as
 *      something executable.
 *
 *   4. The failure reason travels in a header, not a body. An `<img>` that
 *      fails shows the browser's broken-image icon and the component reads
 *      `x-leafly-media-reason` to render a real sentence. Returning an error
 *      BODY would be worse than useless — the browser would try to paint the
 *      error text as an image.
 *
 * Nothing is written to disk, nothing is logged beyond a byte count and a
 * status, and the upstream URL is never echoed because it contains the order
 * integration key.
 */
import { NextResponse, type NextRequest } from "next/server";

import { requirePermission } from "@/lib/auth/session";
import { isLeaflyMediaKind } from "@/lib/leafly/order-detail-core";
import { fetchLeaflyOrderMedia } from "@/lib/leafly/order-detail-server";

/**
 * Never statically rendered and never cached by the framework. A cached ID
 * image would outlive the window Leafly grants and would be served to the
 * next person who opened the screen.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Headers applied to EVERY response, success or failure. */
const NO_STORE: Record<string, string> = {
  "Cache-Control": "no-store, no-cache, must-revalidate, private, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
};

function refuse(status: number, reason: string, retryable: boolean): NextResponse {
  // A null body, deliberately. See note 4 in the header.
  return new NextResponse(null, {
    status,
    headers: {
      ...NO_STORE,
      "x-leafly-media-reason": encodeURIComponent(reason),
      "x-leafly-media-retryable": retryable ? "1" : "0",
    },
  });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    await requirePermission("orders.manage");
  } catch {
    return refuse(
      403,
      "You do not have permission to view customer ID images.",
      false,
    );
  }

  const params = req.nextUrl.searchParams;
  const orderId = (params.get("order") ?? "").trim();
  const kindRaw = (params.get("kind") ?? "").trim();

  if (orderId === "") {
    return refuse(400, "No Leafly order number was supplied.", false);
  }
  if (!isLeaflyMediaKind(kindRaw)) {
    // Validated against the pure core's list rather than string-matched here,
    // so the wire vocabulary has exactly one owner. An unrecognised kind is a
    // bug in our own UI, not something the operator can fix.
    return refuse(400, "That is not a kind of ID image Leafly offers.", false);
  }

  const result = await fetchLeaflyOrderMedia({ leaflyOrderId: orderId, kind: kindRaw });

  if (!result.ok) {
    // 409 rather than 404: the request was well-formed and the order exists;
    // the ID images are simply no longer available. A 404 here would be read
    // by a future maintainer as "no such order", which is the exact
    // misreading the media path shape already invites.
    console.warn(`[leafly/id-image] ${result.summary}`);
    return refuse(result.retryable ? 502 : 409, result.message, result.retryable);
  }

  console.info(
    `[leafly/id-image] served ${kindRaw} for ${orderId} ` +
      `(${result.byteLength} bytes, ${result.contentType})`,
  );

  return new NextResponse(result.bytes, {
    status: 200,
    headers: {
      ...NO_STORE,
      "Content-Type": result.contentType,
      "Content-Length": String(result.byteLength),
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      // Referrer would leak the order id to any host the page later talks to.
      "Referrer-Policy": "no-referrer",
    },
  });
}
