/**
 * /api/pos/drop-status   (D181, round slice S4)
 *
 * GET -> { drop: DropStatus | null }: does THIS register's open drawer owe the
 * safe a drop? Owner, verbatim: "Cash should be dropped if over 2k in sales
 * for their register." The register polls it and shows a banner on the home
 * screen; "due" is loud. It never blocks a sale.
 *
 * Device-authenticated (x-pos-device-id/-key) like every register endpoint.
 * Read-only. Online-only: offline, the register keeps selling and the back
 * office (cockpit and Register Activity) still shows the same alert.
 */
import { NextResponse, type NextRequest } from "next/server";
import { authenticateDevice } from "@/lib/pos/sync-store";
import { posPreflightResponse, withPosCors } from "@/lib/pos/cors";
import { getRegister } from "@/lib/registers/store";
import { dropStatusForRegister } from "@/lib/registers/guided-cash-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGet(req: NextRequest): Promise<NextResponse> {
  const auth = await authenticateDevice(req.headers.get("x-pos-device-id") ?? "", req.headers.get("x-pos-device-key") ?? "");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const registerId = auth.device.register_id;
  if (!registerId) return NextResponse.json({ drop: null });
  const reg = await getRegister(registerId);
  const drop = await dropStatusForRegister(registerId, reg?.name ?? "This register");
  return NextResponse.json({ drop });
}

export async function OPTIONS(req: NextRequest): Promise<NextResponse> {
  return posPreflightResponse(req);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return withPosCors(req, await handleGet(req));
}
