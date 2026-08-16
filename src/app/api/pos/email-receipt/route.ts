/**
 * POST /api/pos/email-receipt  (POS Slice B30)
 *
 * Opt-in digital receipt: the customer asks for their receipt by email at
 * the "Sale complete" screen, the budtender types the address, and the
 * server emails the SAME frozen receipt snapshot the paper receipt prints
 * from — restyled for inboxes, byte-identical on every number.
 *
 * Privacy contract: the address is used ONCE and never persisted; the
 * audit row stores only a masked form. Transactional content only — no
 * marketing. ONLINE-ONLY (an email cannot be sent offline; the paper
 * receipt is always available). Device-authenticated like every register
 * endpoint. GET reports whether the email provider is configured so the
 * register can hide the option cleanly when it is not.
 */
import { NextResponse, type NextRequest } from "next/server";
import { authenticateDevice } from "@/lib/pos/sync-store";
import {
  normalizeReceiptEmail,
  validateEmailReceiptSnapshot,
} from "@/lib/pos/email-receipt-core";
import { isEmailReceiptConfigured, sendEmailReceipt } from "@/lib/pos/email-receipt-store";
import { posPreflightResponse, withPosCors } from "@/lib/pos/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGet(req: NextRequest): Promise<NextResponse> {
  const auth = await authenticateDevice(
    req.headers.get("x-pos-device-id") ?? "",
    req.headers.get("x-pos-device-key") ?? "",
  );
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json({ configured: isEmailReceiptConfigured() });
}

async function handlePost(req: NextRequest): Promise<NextResponse> {
  const auth = await authenticateDevice(
    req.headers.get("x-pos-device-id") ?? "",
    req.headers.get("x-pos-device-key") ?? "",
  );
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await req.json().catch(() => null)) as { email?: unknown; receipt?: unknown } | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? normalizeReceiptEmail(body.email) : null;
  if (!email) {
    return NextResponse.json(
      { error: "That email address doesn't look right — check it and try again." },
      { status: 400 },
    );
  }

  const validated = validateEmailReceiptSnapshot(body.receipt);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.errors.join(" ") }, { status: 400 });
  }

  const result = await sendEmailReceipt({
    email,
    receipt: validated.receipt,
    deviceId: auth.device.id,
    deviceName: auth.device.name,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ sent: true, receiptNumber: result.receiptNumber });
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

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Wrap once so EVERY return path carries the CORS headers.
  return withPosCors(req, await handlePost(req));
}
