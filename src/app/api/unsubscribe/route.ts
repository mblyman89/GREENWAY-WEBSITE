/**
 * POST /api/unsubscribe?token=…   (SOP-22 G-109, F-22-2; D237 slice N-1)
 *
 * RFC 8058 one-click unsubscribe. Gmail, Yahoo and other mail apps show an
 * "Unsubscribe" button next to the sender; pressing it makes the mail
 * provider POST here with the body "List-Unsubscribe=One-Click". No login,
 * no page, no redirect. The member's own token (the same one in the footer
 * link) is the only key.
 *
 * GET (a person clicking the address) goes to the same friendly
 * /unsubscribe page as the footer link.
 */
import { NextResponse } from "next/server";
import { unsubscribeByToken } from "@/lib/loyalty/signups-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const url = new URL(request.url);
  const token = (url.searchParams.get("token") ?? "").trim();
  if (!token) return NextResponse.json({ ok: false, error: "missing token" }, { status: 400 });
  const res = await unsubscribeByToken(token);
  if (!res.ok) {
    // not-found is still a 200 for the mail provider: the address is not on
    // the list either way. Only a broken setup is reported as an error.
    if (res.reason === "not-configured") {
      return NextResponse.json({ ok: false, error: "not configured" }, { status: 503 });
    }
    return NextResponse.json({ ok: true, alreadyOff: true }, { status: 200 });
  }
  return NextResponse.json({ ok: true, alreadyOff: res.alreadyOff }, { status: 200 });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const dest = new URL("/unsubscribe", url.origin);
  if (token) dest.searchParams.set("token", token);
  return NextResponse.redirect(dest, 303);
}
