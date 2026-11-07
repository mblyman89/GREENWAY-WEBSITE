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
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { isPlaidConfigured } from "@/lib/plaid/env";
import { runPlaidSyncForItem } from "@/lib/plaid/sync-server";

export const dynamic = "force-dynamic";
// Live pull will log in + download a few CSVs + upsert, then refresh the ATM bank account (Plaid).
export const maxDuration = 300; // D198 S6: PAI pull + the ATM-role Plaid sync

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

/**
 * D198 S6. Owner (2026-11-07): "ensure the plaid connection is auto syncing, make sure the atm
 * account is getting utilized for the matching system."
 *
 * Before this, only /api/cron/ach-bank-watch synced Plaid on a schedule, and only the "main"
 * (Timberland) connection; the ATM-role account refreshed only when Plaid happened to send a
 * webhook. So the ATM drop match (/admin/atm/drops) and the settlement reconcile could be reading a
 * stale bank feed. This refreshes every connection that holds an account tagged role "atm", right
 * after the PAI pull, so the morning match sees both sides fresh. runPlaidSyncForItem is
 * cursor-based (Plaid /transactions/sync) and upserts by transaction id, so running it twice is
 * harmless. A Plaid failure never fails the PAI pull.
 */
async function atmItemIds(): Promise<string[]> {
  if (!isSupabaseServiceConfigured) return [];
  const { data, error } = await createSupabaseAdminClient().from("plaid_accounts").select("item_id, role, active").eq("role", "atm");
  if (error) return [];
  return [...new Set(((data ?? []) as { item_id: string; active: boolean | null }[]).filter((a) => a.active !== false).map((a) => a.item_id))];
}

async function syncAtmBankAccount(): Promise<{ attempted: number; ok: number; note: string | null }> {
  if (!isPlaidConfigured) return { attempted: 0, ok: 0, note: "Plaid is not configured." };
  const ids = await atmItemIds();
  if (ids.length === 0) return { attempted: 0, ok: 0, note: "No bank account is tagged ATM on /admin/plaid." };
  let ok = 0;
  for (const id of ids) {
    try {
      const r = await runPlaidSyncForItem(id);
      if (r.ok) ok++;
    } catch (err) {
      console.error(`[cron/atm-sync] Plaid ATM sync error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { attempted: ids.length, ok, note: ok === ids.length ? null : "One or more ATM bank connections did not sync." };
}

export async function GET(req: NextRequest) {
  const denied = await authorize(req);
  if (denied) return denied;

  const result = await runAtmLiveSync();
  const bank = await syncAtmBankAccount().catch((e: unknown) => ({ attempted: 0, ok: 0, note: e instanceof Error ? e.message : "Plaid sync failed." }));
  return NextResponse.json(
    result.ok
      ? { ok: true, message: result.message, summary: result.summary, atmBank: bank }
      : { ok: false, error: result.error, atmBank: bank },
  );
}

// Vercel Cron uses GET; POST supported for manual triggers.
export async function POST(req: NextRequest) {
  return GET(req);
}
