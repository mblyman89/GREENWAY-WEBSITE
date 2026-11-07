/**
 * src/app/api/cron/coa-trust-all/route.ts   (D206)
 *
 * Owner: "it should run on the server in the background, I will push the
 * button before bed and hopefully when I wake up it will be finished reading
 * all of them and accepting them regardless of how it feels about them."
 *
 * The Fix-later button only writes the run (site_settings coa_trust_all_run).
 * Every 5 minutes at :01, :06, ... :56 ("1-59/5 * * * *") this route takes the
 * run's lease by compare-and-set and reads the next certificates for about
 * 280 seconds (coa-trust-all-store.tickTrustAll). An idle tick (no run going)
 * is ONE site_settings read and writes nothing.
 *
 * AUTH. The same fail-closed preamble as /api/cron/exception-retry.
 */
import { NextRequest, NextResponse } from "next/server";
import { shouldRefuseWhenSecretMissing } from "@/lib/security/fail-closed";
import { getStaffSession } from "@/lib/auth/session";
import { tickTrustAll } from "@/lib/inventory/coa-trust-all-store";

export const dynamic = "force-dynamic";
/** TRUST_TICK_MS (280 s) of reading plus headroom; the lease (330 s) outlives it. */
export const maxDuration = 300;

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
    console.warn("[cron/coa-trust-all] CRON_SECRET unset \u2014 allowing (dev only).");
    return null;
  }

  const session = await getStaffSession().catch(() => null);
  if (session) return null;
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function GET(req: NextRequest) {
  const denied = await authorize(req);
  if (denied) return denied;
  const result = await tickTrustAll();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

// Vercel Cron uses GET. POST runs the same path.
export async function POST(req: NextRequest) {
  return GET(req);
}
