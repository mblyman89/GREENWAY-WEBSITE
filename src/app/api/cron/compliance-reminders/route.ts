/**
 * src/app/api/cron/compliance-reminders/route.ts  (Task W)
 *
 * Daily cron endpoint that plans + sends the CCRS deadline reminders
 * (weekly upload: Thursday heads-up → Saturday wrap → Sunday DUE →
 * overdue-daily; monthly LIQ-1295: due-soon → due-today → overdue-daily).
 * Idempotent — compliance_reminder_log dedupe means re-runs never double-send.
 *
 * Scheduled by vercel.json ("0 16 * * *" UTC ≈ 8–9am Pacific). Vercel Cron
 * invokes with `Authorization: Bearer ${CRON_SECRET}` when CRON_SECRET is set
 * in the project env.
 *
 * AUTH (fail-closed posture, same as the webhooks — see
 * src/lib/security/fail-closed.ts):
 *   - Production + CRON_SECRET unset  → 503 refuse (never an open endpoint).
 *   - CRON_SECRET set                 → Bearer token must match, else 401.
 *   - Development + unset             → warn-and-continue for local testing.
 *
 * A signed-in staff member may also trigger it manually (e.g. a "run
 * reminders now" button) — any valid staff session is accepted.
 */
import { NextRequest, NextResponse } from "next/server";
import { shouldRefuseWhenSecretMissing } from "@/lib/security/fail-closed";
import { getStaffSession } from "@/lib/auth/session";
import { runComplianceReminders } from "@/lib/notifications/compliance-reminders";
import { sweepStalePendingEvents } from "@/lib/pos/sync-store";

export const dynamic = "force-dynamic";
// Sends a handful of emails/pushes sequentially; give it room beyond the
// default 10s just in case the providers are slow.
export const maxDuration = 60;

async function authorize(req: NextRequest): Promise<NextResponse | null> {
  const secret = process.env.CRON_SECRET ?? "";

  if (secret) {
    const header = req.headers.get("authorization") ?? "";
    if (header === `Bearer ${secret}`) return null; // cron OK
  } else if (shouldRefuseWhenSecretMissing(secret)) {
    // Production with no secret: check for a staff session before refusing,
    // so the manual admin trigger still works.
    const session = await getStaffSession().catch(() => null);
    if (session) return null;
    return NextResponse.json(
      { error: "CRON_SECRET is not configured; refusing unauthenticated cron calls." },
      { status: 503 },
    );
  } else {
    // Development without a secret — allow (matches webhook dev posture).
    console.warn("[cron/compliance-reminders] CRON_SECRET unset — allowing (dev only).");
    return null;
  }

  // Secret set but header didn't match — fall back to a staff session
  // (manual trigger from the Command Center).
  const session = await getStaffSession().catch(() => null);
  if (session) return null;
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function GET(req: NextRequest) {
  const refusal = await authorize(req);
  if (refusal) return refusal;

  const result = await runComplianceReminders();

  // GW-023 — piggyback the stranded-sale sweeper on the daily cron (Vercel
  // Hobby allows one daily cron; this reuses it). Finds pos_sale_events rows
  // stuck at `pending` for 10+ minutes and re-processes or escalates them to
  // the manager exception queue. Never throws; a sweep hiccup must not
  // break the reminders.
  const posSweep = await sweepStalePendingEvents();

  return NextResponse.json({ ...result, posSweep }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  return GET(req);
}
