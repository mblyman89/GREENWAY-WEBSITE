/**
 * src/app/api/cron/expired-quarantine/route.ts  (Fix Phase 1.6b, G-24 req 4)
 *
 * Nightly job: every Active lot that is past its expiry date and is an
 * edible, liquid edible, tincture, capsule or RSO is set to Quarantine, with
 * an audit row per lot (owner decisions D36, D44). Other expired lots are
 * left Active; the register warns on them.
 *
 * SCHEDULE: vercel.json "20 11 * * *" UTC = 4:20 AM PDT / 3:20 AM PST, after
 * the midnight close and before the 8:00 AM open (WAC 314-55-147), so the
 * day's expired lots are out of stock before the first sale. Vercel cron
 * expressions are UTC (AGENTS.md rule 12).
 *
 * IDEMPOTENT: each write is compare-and-set on status "active", so a doubled
 * or overlapping tick moves (and audits) each lot once, and a Recalled lot is
 * never touched. A skipped tick loses nothing: the completion gate refuses
 * the expired lot's product all day regardless (fail-closed).
 *
 * AUTH: same fail-closed posture as compliance-reminders (CRON_SECRET bearer;
 * production with no secret refuses unless a staff session is present).
 */
import { NextRequest, NextResponse } from "next/server";
import { shouldRefuseWhenSecretMissing } from "@/lib/security/fail-closed";
import { getStaffSession } from "@/lib/auth/session";
import { quarantineExpiredHardBlockLots } from "@/lib/inventory/expired-stock-store";
import { pacificToday } from "@/lib/reports/timezone";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function authorize(req: NextRequest): Promise<NextResponse | null> {
  const secret = process.env.CRON_SECRET ?? "";
  if (secret) {
    const header = req.headers.get("authorization") ?? "";
    if (header === `Bearer ${secret}`) return null;
  } else if (shouldRefuseWhenSecretMissing(secret)) {
    const session = await getStaffSession().catch(() => null);
    if (session) return null;
    return NextResponse.json(
      { error: "CRON_SECRET is not configured; refusing unauthenticated cron calls." },
      { status: 503 },
    );
  } else {
    console.warn("[cron/expired-quarantine] CRON_SECRET unset — allowing (dev only).");
    return null;
  }
  const session = await getStaffSession().catch(() => null);
  if (session) return null;
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function GET(req: NextRequest) {
  const refusal = await authorize(req);
  if (refusal) return refusal;
  const today = pacificToday();
  const result = await quarantineExpiredHardBlockLots(today).catch((e: unknown) => ({
    ok: false,
    considered: 0,
    quarantined: [],
    skipped: 0,
    error: e instanceof Error ? e.message : String(e),
  }));
  return NextResponse.json({ storeDay: today, ...result }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  return GET(req);
}
