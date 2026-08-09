/**
 * src/app/api/cron/atm-sync/route.ts  (SLICE A-2c)
 *
 * Daily cron for the ATM/PAI automatic pull. Calls runAtmLiveSync(), which logs
 * into paireports.com with the saved (encrypted) credentials, downloads the
 * Cash Load / Simple Summary / Bank Deposits CSVs, and feeds them through the
 * same verified ingest engine the manual import uses (idempotent upserts, so a
 * daily re-pull with overlap never duplicates rows).
 *
 * The report .event paths are confirmed from Michael's portal; the one still-
 * unconfirmed bit (the exact CSV custom-command value) is an OVERRIDABLE
 * default — if PAI's account differs, the pull returns a helpful message rather
 * than importing garbage. Never guesses a single HTTP detail.
 *
 * Scheduled by vercel.json ("0 14 * * *" UTC ≈ 6–7am Pacific, before the other
 * two crons). Vercel Cron invokes with `Authorization: Bearer ${CRON_SECRET}`.
 *
 * AUTH — identical fail-closed posture to /api/cron/regulatory-watch:
 *   - CRON_SECRET set            → Bearer must match, else staff-session fallback
 *                                   (the Health tab's "Sync now").
 *   - Production + secret unset  → staff session or 503 (never open).
 *   - Development + unset         → warn-and-continue for local testing.
 */
import { NextRequest, NextResponse } from "next/server";
import { shouldRefuseWhenSecretMissing } from "@/lib/security/fail-closed";
import { getStaffSession } from "@/lib/auth/session";
import { runAtmLiveSync } from "@/lib/atm/sync-server";

export const dynamic = "force-dynamic";
// Live pull will log in + download a few CSVs + upsert.
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
    console.warn("[cron/atm-sync] CRON_SECRET unset — allowing (dev only).");
    return null;
  }

  // Secret set but header didn't match — fall back to a staff session
  // (manual "Sync now" trigger from the ATM Health tab).
  const session = await getStaffSession().catch(() => null);
  if (session) return null;
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function GET(req: NextRequest) {
  const denied = await authorize(req);
  if (denied) return denied;

  const result = await runAtmLiveSync();
  return NextResponse.json(
    result.ok
      ? { ok: true, message: result.message, summary: result.summary }
      : { ok: false, error: result.error },
  );
}

// Vercel Cron uses GET; POST supported for manual triggers.
export async function POST(req: NextRequest) {
  return GET(req);
}
