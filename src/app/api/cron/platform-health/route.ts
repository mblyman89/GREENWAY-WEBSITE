/**
 * src/app/api/cron/platform-health/route.ts  (slice G-71a, owner message 12)
 *
 * Daily database health check. Asks the database (0331
 * platform_db_contract_check) whether the server can still reach every table
 * and function the code uses, records the run, and emails staff once per
 * Pacific day: an all clear, or what broke and the exact fix.
 *
 * Why: in R-RET (owner message 10) Supabase's 2026-10-30 grant change silently
 * broke customer returns and nobody knew until a return failed at the counter.
 * This check would have caught it the morning after the change.
 *
 * Scheduled by vercel.json ("25 14 * * *" UTC = 6:25am PST / 7:25am PDT,
 * before the store opens). Vercel Cron sends `Authorization: Bearer
 * ${CRON_SECRET}`. Same fail-closed auth as /api/cron/regulatory-watch. Safe
 * to call twice: the daily email is claimed in compliance_reminder_log
 * (UNIQUE dedupe_key), so a second call records a run but sends nothing.
 *
 * G-71b: the same run also sends the monthly platform review (once per
 * Pacific month, standing rule 16) and the 30/7/1-day and overdue warnings
 * for open items in the platform changes register. No extra cron.
 */
import { NextRequest, NextResponse } from "next/server";
import { shouldRefuseWhenSecretMissing } from "@/lib/security/fail-closed";
import { getStaffSession } from "@/lib/auth/session";
import { runPlatformHealthCheck } from "@/lib/platform/platform-health-store";
import { runPlatformReview } from "@/lib/platform/platform-review-store";

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
    console.warn("[cron/platform-health] CRON_SECRET unset, allowing (dev only).");
    return null;
  }

  const session = await getStaffSession().catch(() => null);
  if (session) return null;
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function GET(req: NextRequest) {
  const denied = await authorize(req);
  if (denied) return denied;

  const out = await runPlatformHealthCheck({ source: "cron" });
  const review = await runPlatformReview().catch((e: unknown) => ({
    review: "failed" as const,
    deadlines: [],
    notes: [e instanceof Error ? e.message : String(e)],
  }));
  return NextResponse.json({
    ok: true,
    status: out.report.status,
    summary: out.report.summary,
    problems: out.report.problems.length,
    saved: out.saved,
    alert: out.alert,
    notes: out.notes,
    review,
  });
}

// Vercel Cron uses GET; POST supported for manual triggers.
export async function POST(req: NextRequest) {
  return GET(req);
}
