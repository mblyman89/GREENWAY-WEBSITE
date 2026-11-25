/**
 * src/app/api/cron/merch-cost-check/route.ts  (D285 slice C)
 *
 * Nightly ("15 11 * * *" UTC, ~3-4 am Pacific): runMerchCostCheck - Printful's
 * free cost estimate for each live product's priciest variant vs. the cost
 * saved at publish; emails the owner when it moved. Never edits prices.
 * Auth: same fail-closed posture as /api/cron/merch-stock.
 */
import { NextRequest, NextResponse } from "next/server";
import { shouldRefuseWhenSecretMissing } from "@/lib/security/fail-closed";
import { getStaffSession } from "@/lib/auth/session";
import { runMerchCostCheck } from "@/lib/merch/merch-cost-server";

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
    return NextResponse.json({ error: "CRON_SECRET is not configured; refusing unauthenticated cron calls." }, { status: 503 });
  } else {
    console.warn("[cron/merch-cost-check] CRON_SECRET unset, allowing (dev only).");
    return null;
  }
  const session = await getStaffSession().catch(() => null);
  if (session) return null;
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function GET(req: NextRequest) {
  const denied = await authorize(req);
  if (denied) return denied;
  const r = await runMerchCostCheck();
  if (!r.ok) console.error(`[cron/merch-cost-check] ${r.problem}`);
  return NextResponse.json(r, { status: r.ok ? 200 : 502 });
}
