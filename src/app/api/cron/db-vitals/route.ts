/**
 * src/app/api/cron/db-vitals/route.ts   (D193 · DB HEALTH round slice B)
 *
 * Owner (2026-11-06): "Every few hours the database will become "unhealthy"
 * and I can't use the back office. ... Please look for ways you can add to the
 * ai partnership so that it can help me self heal these issues now. I want a
 * healthy db always."
 *
 * Every 10 minutes: read the database's vital signs (0345
 * platform_db_vitals), clear stuck APP connections when the Partner is on
 * Level 2 (its "touches nothing" fixes run by themselves; Level 1 only
 * explains), store a compact reading, and email staff once per database
 * restart or at most once an hour when it is in trouble.
 *
 * SCHEDULING (AGENTS rule 12). vercel.json runs this at :09, :19 ... :59
 * ("9-59/10 * * * *", 144 ticks a day; pinned by
 * tests/compliance/leafly-certification.test.ts). The 9-minute offset keeps
 * it off content-schedule (:00/:05), cutover-watch (:02), exception-retry
 * (:03), ccrs-mail (:04) and inbound-reconcile (:07). No Pacific arithmetic.
 *
 * A tick is a REQUEST TO CONSIDER: a doubled tick reads twice (harmless), the
 * heal only signals sessions that are still stuck when it runs, each email is
 * claimed in compliance_reminder_log first, and a skipped tick is caught by
 * the next. A healthy tick is one small read and, at most once an hour, one
 * insert.
 *
 * AUTH. The same fail-closed preamble as /api/cron/exception-retry.
 */
import { NextRequest, NextResponse } from "next/server";
import { shouldRefuseWhenSecretMissing } from "@/lib/security/fail-closed";
import { getStaffSession } from "@/lib/auth/session";
import { runDbVitalsTick } from "@/lib/platform/db-vitals-store";
import { getPartnerLevel } from "@/lib/ai/partner-store";
import { gateFor } from "@/lib/ai/partner-core";

export const dynamic = "force-dynamic";
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
    console.warn("[cron/db-vitals] CRON_SECRET unset, allowing (dev only).");
    return null;
  }

  const session = await getStaffSession().catch(() => null);
  if (session) return null;
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function GET(req: NextRequest) {
  const denied = await authorize(req);
  if (denied) return denied;
  const level = await getPartnerLevel();
  const result = await runDbVitalsTick({ autoHeal: gateFor("clear_stuck_sessions", level) === "auto" });
  // 200 even when the database is unwell: the tick did its job (it looked and told).
  return NextResponse.json(result, { status: 200 });
}

// Vercel Cron uses GET. POST runs the same path.
export async function POST(req: NextRequest) {
  return GET(req);
}
