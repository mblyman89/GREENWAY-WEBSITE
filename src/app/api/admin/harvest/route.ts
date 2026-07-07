/**
 * src/app/api/admin/harvest/route.ts — Slice H4.
 *
 * Tiny, permission-gated JSON proxy the Harvest Console polls for live job
 * progress. The browser never talks to the crawler worker directly (the
 * shared secret stays server-side); this route relays the worker's job list.
 */
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/session";
import { isCrawlerConfigured, listHarvestJobs } from "@/lib/ai/crawler-client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requirePermission("vendors.manage");
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isCrawlerConfigured()) {
    return NextResponse.json({ configured: false, jobs: [] }, { headers: { "Cache-Control": "no-store" } });
  }
  try {
    const jobs = await listHarvestJobs();
    return NextResponse.json(
      { configured: true, jobs, ts: Date.now() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json(
      { configured: true, jobs: [], error: e instanceof Error ? e.message : "worker unreachable" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
