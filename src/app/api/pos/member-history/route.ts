/**
 * GET /api/pos/member-history?customerId=...  (POS Slice B29)
 *
 * The register's privacy-BUDGETED window into an attached loyalty member's
 * purchase history: their last few completed orders and their favorites —
 * and deliberately nothing else (no contact details, no notes, no
 * birthdate; same budget discipline as the B14 member lookup this extends).
 *
 * The customerId comes from the register's OWN /api/pos/member lookup
 * moments earlier — it never originates on the device. ONLINE-ONLY by
 * design. Device-authenticated like every register endpoint.
 */
import { NextResponse, type NextRequest } from "next/server";
import { authenticateDevice } from "@/lib/pos/sync-store";
import { getMemberHistoryForRegister } from "@/lib/pos/member-history-store";
import { posPreflightResponse, withPosCors } from "@/lib/pos/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isUuid(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

async function handleGet(req: NextRequest): Promise<NextResponse> {
  const auth = await authenticateDevice(
    req.headers.get("x-pos-device-id") ?? "",
    req.headers.get("x-pos-device-key") ?? "",
  );
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const customerId = req.nextUrl.searchParams.get("customerId");
  if (!isUuid(customerId)) {
    return NextResponse.json({ error: "customerId must be the id from the member lookup." }, { status: 400 });
  }

  const result = await getMemberHistoryForRegister(customerId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json({ history: result.history });
}

/**
 * CORS preflight. The packaged register app ("Greenway Point of Transaction")
 * calls this API cross-origin from capacitor://localhost. Policy lives in
 * @/lib/pos/cors-core (pure).
 */
export async function OPTIONS(req: NextRequest): Promise<NextResponse> {
  return posPreflightResponse(req);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Wrap once so EVERY return path carries the CORS headers.
  return withPosCors(req, await handleGet(req));
}
