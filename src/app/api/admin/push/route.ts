/**
 * src/app/api/admin/push/route.ts  (Task W)
 *
 * Staff-only Web Push subscription endpoint for compliance reminders.
 *   GET    → { configured, publicKey }  (VAPID public key for PushManager.subscribe)
 *   POST   → save/refresh the browser's PushSubscription for this staff member
 *   DELETE → remove a subscription (notifications turned off)
 *
 * Follows the permission-gated JSON route pattern (orders/count). Requires a
 * signed-in staff session; subscriptions are keyed to the session's user id.
 */
import { NextRequest, NextResponse } from "next/server";
import { getStaffSession } from "@/lib/auth/session";
import {
  isPushConfigured,
  vapidPublicKey,
  savePushSubscription,
  deletePushSubscription,
} from "@/lib/notifications/push";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getStaffSession().catch(() => null);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(
    { configured: isPushConfigured(), publicKey: vapidPublicKey() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: NextRequest) {
  const session = await getStaffSession().catch(() => null);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const sub = body as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  const endpoint = typeof sub?.endpoint === "string" ? sub.endpoint : "";
  const p256dh = typeof sub?.keys?.p256dh === "string" ? sub.keys.p256dh : "";
  const auth = typeof sub?.keys?.auth === "string" ? sub.keys.auth : "";
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: "endpoint, keys.p256dh and keys.auth are required" }, { status: 400 });
  }

  const saved = await savePushSubscription({
    staffId: session.userId,
    endpoint,
    p256dh,
    auth,
    userAgent: req.headers.get("user-agent"),
  });
  if (!saved.ok) return NextResponse.json({ error: saved.error ?? "save failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await getStaffSession().catch(() => null);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const endpoint = (body as { endpoint?: string })?.endpoint;
  if (typeof endpoint !== "string" || !endpoint) {
    return NextResponse.json({ error: "endpoint is required" }, { status: 400 });
  }
  await deletePushSubscription(endpoint);
  return NextResponse.json({ ok: true });
}
