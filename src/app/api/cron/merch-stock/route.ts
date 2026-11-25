/**
 * src/app/api/cron/merch-stock/route.ts  (D232 slice M-6, SOP-11 G-83)
 *
 * Every 6 hours ("40 *\/6 * * *" UTC: 00:40, 06:40, 12:40, 18:40), copies
 * Printful's live US stock onto every published variant, so greenwaymerch.com
 * stops selling a colour or size Printful cannot make. Before this, the only
 * copy was the Merch Inventory button (F-11-8). Printful's stock_updated event
 * (relayed by the shop to /api/merch-stock) covers the hours in between.
 *
 * Same pieces as the button (loadPrintfulStock + applyStock + the M-5
 * compare-and-set write); audited as merch.stock_synced by the system actor
 * "cron:merch-stock". About one Printful call per garment; a run with no
 * products makes no Printful call.
 *
 * D285: the 12:40 UTC tick (about 4-5 am Pacific) also runs the nightly
 * Printful cost check (runMerchCostCheck: free estimate-costs per live
 * product vs. the saved cost, owner email when it moved; never edits prices),
 * so no extra cron. ?cost=1 forces it (staff / CRON_SECRET only).
 *
 * Auth: same fail-closed posture as /api/cron/platform-health (CRON_SECRET
 * Bearer, else a staff session; production with no secret -> 503).
 */
import { NextRequest, NextResponse } from "next/server";
import { shouldRefuseWhenSecretMissing } from "@/lib/security/fail-closed";
import { getStaffSession } from "@/lib/auth/session";
import { runMerchStockCopy } from "@/lib/merch/merch-stock-server";
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
    console.warn("[cron/merch-stock] CRON_SECRET unset, allowing (dev only).");
    return null;
  }
  const session = await getStaffSession().catch(() => null);
  if (session) return null;
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function GET(req: NextRequest) {
  const denied = await authorize(req);
  if (denied) return denied;
  const r = await runMerchStockCopy({ source: "cron:merch-stock" });
  if (!r.ok) console.error(`[cron/merch-stock] ${r.problem}`);
  const cost = new Date().getUTCHours() === 12 || req.nextUrl.searchParams.get("cost") === "1" ? await runMerchCostCheck() : null;
  if (cost && !cost.ok) console.error(`[cron/merch-stock] cost check: ${cost.problem}`);
  return NextResponse.json({ ...r, ...(cost ? { cost } : {}) }, { status: r.ok ? 200 : 502 });
}
