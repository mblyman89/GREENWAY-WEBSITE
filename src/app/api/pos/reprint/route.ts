/**
 * GET /api/pos/reprint?receipt=XXXXXXXX   (SLICE 20)
 *
 * Rebuild a PAST sale's receipt so the register can print it again.
 *
 * Owner: "will you tell me how I can reprint past order receipts in our
 * register? I see I can reprint the last transactions receipt, but not any
 * others. is that what you are saying about above, that it is not wise to give
 * that ability, or is that feature of ours just not connected yet?"
 *
 * It was not connected. The register held exactly one receipt — the last sale
 * on that device, kept in React state and localStorage — so an earlier sale,
 * or any sale from the other till, could not be reprinted. Reprinting past
 * receipts is ordinary retail practice (Lightspeed offers it as a Sales
 * History row action; Xstore has its own reprint), and the data was already
 * stored. This connects it.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * READ-ONLY. A reprint moves no money, changes no stock and files no
 * compliance record — it re-renders numbers the register already committed in
 * `pos_sale_events.payload`. Nothing here writes.
 *
 * THE DRAWER STAYS SHUT. `star-printer-core` refuses a "reprint" job with
 * openDrawer true, because reprints happen with a customer at the counter and
 * no cash is moving. The client prints this with that same job kind.
 *
 * Device-authenticated and ONLINE-ONLY, like every other register endpoint
 * that reads durable server facts.
 */
import { NextResponse, type NextRequest } from "next/server";
import { authenticateDevice } from "@/lib/pos/sync-store";
import { reprintReceiptByNumber } from "@/lib/pos/receipt-reprint-store";
import { posPreflightResponse, withPosCors } from "@/lib/pos/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGet(req: NextRequest): Promise<NextResponse> {
  const auth = await authenticateDevice(
    req.headers.get("x-pos-device-id") ?? "",
    req.headers.get("x-pos-device-key") ?? "",
  );
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const receipt = req.nextUrl.searchParams.get("receipt") ?? "";
  const result = await reprintReceiptByNumber(receipt);
  if (!result.ok) {
    // "Not found" and "could not look" are different answers; both are the
    // client's to display, so neither is flattened into an empty success.
    return NextResponse.json({ error: result.error }, { status: 404 });
  }

  return NextResponse.json({ receipt: result.receipt });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return withPosCors(req, await handleGet(req));
}

export async function OPTIONS(req: NextRequest): Promise<NextResponse> {
  return posPreflightResponse(req);
}
