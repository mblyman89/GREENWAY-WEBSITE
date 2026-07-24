/**
 * src/app/api/cron/regulatory-watch/route.ts  (SLICE 37)
 *
 * Daily cron for Regulatory Watch: polls the WA LCB GovDelivery bulletin feed
 * (content.govdelivery.com/accounts/WALCB/widgets/WALCB_WIDGET_1/0.json —
 * verified live), ingests anything new, fetches each new bulletin's page for
 * full text, and runs the AI analyst for cannabis-relevant items. This means
 * Greenway catches EVERY LCB bulletin even if the email forwarding is never
 * set up.
 *
 * Scheduled by vercel.json ("0 17 * * *" UTC ≈ 9–10am Pacific, an hour after
 * the compliance-reminders cron). Vercel Cron invokes with
 * `Authorization: Bearer ${CRON_SECRET}`.
 *
 * AUTH — identical fail-closed posture to /api/cron/compliance-reminders:
 *   - CRON_SECRET set             → Bearer must match, else fall back to a
 *                                    staff session (the page's "check now").
 *   - Production + secret unset   → staff session or 503 (never open).
 *   - Development + unset         → warn-and-continue for local testing.
 *
 * ADVISORY ONLY: ingested items + analyses land on /admin/compliance/regulatory
 * for a human to review. Nothing changes store behavior.
 */
import { NextRequest, NextResponse } from "next/server";
import { shouldRefuseWhenSecretMissing } from "@/lib/security/fail-closed";
import { getStaffSession } from "@/lib/auth/session";
import { pollGovDeliveryFeed } from "@/lib/regulatory/regulatory-ingest";

export const dynamic = "force-dynamic";
// Fetches the feed + up to a handful of bulletin pages + AI calls.
export const maxDuration = 60;

async function authorize(req: NextRequest): Promise<NextResponse | null> {
  const secret = process.env.CRON_SECRET ?? "";

  if (secret) {
    const header = req.headers.get("authorization") ?? "";
    if (header === `Bearer ${secret}`) return null; // cron OK
  } else if (shouldRefuseWhenSecretMissing(secret)) {
    const session = await getStaffSession().catch(() => null);
    if (session) return null;
    return NextResponse.json(
      { error: "CRON_SECRET is not configured; refusing unauthenticated cron calls." },
      { status: 503 },
    );
  } else {
    console.warn("[cron/regulatory-watch] CRON_SECRET unset — allowing (dev only).");
    return null;
  }

  // Secret set but header didn't match — fall back to a staff session
  // (manual "check now" trigger from the Regulatory Watch page).
  const session = await getStaffSession().catch(() => null);
  if (session) return null;
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function GET(req: NextRequest) {
  const denied = await authorize(req);
  if (denied) return denied;

  const summary = await pollGovDeliveryFeed();
  return NextResponse.json({ ok: true, ...summary });
}

// Vercel Cron uses GET; POST supported for manual triggers.
export async function POST(req: NextRequest) {
  return GET(req);
}
