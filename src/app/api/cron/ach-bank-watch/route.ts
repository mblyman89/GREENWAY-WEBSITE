/**
 * src/app/api/cron/ach-bank-watch/route.ts   (R41 S16)
 *
 * The daily bank watch on the Timberland Main account (ach-bank-watch-core).
 *
 * SCHEDULE: vercel.json "15 14 * * *" = 14:15 UTC, which is 7:15 am PDT or
 * 6:15 am PST: after Timberland's overnight posting and before the business
 * day, so an unexplained debit is seen the same morning. The Timberland
 * agreement gives the company 30 calendar days after a statement to report a
 * discrepancy (WATCH_QUOTES.agreementStatement); a daily look keeps that easy.
 *
 * FIRST it refreshes the Main connection(s) only (one /transactions/sync per
 * Main connection, the same call the "Sync now" button makes). Plaid's Trial
 * plan (mirror docs/authorities/ach/plaid-trial-plan.txt): "API calls against
 * your existing connected Items are not capped". It never creates or removes a
 * connection. A failed refresh is not fatal: the watch still runs on the data
 * already held and the feed-health section says how old it is.
 *
 * NEVER A PAYMENT GATE: nothing here is read by payroll or the file builder.
 *
 * EMAIL (claimed in compliance_reminder_log first, a real claim, like
 * /api/cron/ofac-screening; if the email fails the claim is removed so the
 * next run retries): once when the set of findings changes, and again each
 * week while they stay open. A failed read is its own email, once per day:
 * silence is never "all clear".
 *
 * AUTH: the same fail-closed preamble as the other ACH crons (copied, not
 * shared, as in the other crons).
 */
import { NextRequest, NextResponse } from "next/server";
import { shouldRefuseWhenSecretMissing } from "@/lib/security/fail-closed";
import { getStaffSession } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { runPlaidSyncForItem } from "@/lib/plaid/sync-server";
import { loadBankWatch } from "@/lib/payments/ach-bank-watch-store";
import { buildBankWatch, watchEmail, weekKeyOf } from "@/lib/payments/ach-bank-watch-core";
import { resolveNotifyContacts } from "@/lib/payments/ach-authorization-core";
import { resendOpsMailer } from "@/lib/payments/ach-ops-store";
import { opsSiteUrl } from "@/lib/payments/ach-ops-ui-core";
import { escapeHtml } from "@/lib/pos/cutover-watch-core";
import { pacificDayKey } from "@/lib/reports/timezone";

export const dynamic = "force-dynamic";
/** One sync of the Main connection plus a few reads: well under a minute, with room. */
export const maxDuration = 300;

const PAGE = "/admin/settings/banking/bank-watch";

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
    console.warn("[cron/ach-bank-watch] CRON_SECRET unset \u2014 allowing (dev only).");
    return null;
  }

  const session = await getStaffSession().catch(() => null);
  if (session) return null;
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

async function mainItemIds(): Promise<string[]> {
  const { data, error } = await createSupabaseAdminClient().from("plaid_accounts").select("item_id, role, active").eq("role", "main");
  if (error) return [];
  return [...new Set(((data ?? []) as { item_id: string; active: boolean | null }[]).filter((a) => a.active !== false).map((a) => a.item_id))];
}

export async function GET(req: NextRequest) {
  const denied = await authorize(req);
  if (denied) return denied;
  if (!isSupabaseServiceConfigured) return NextResponse.json({ ok: false, error: "Database not connected." }, { status: 503 });

  const day = pacificDayKey(new Date());
  const link = `${opsSiteUrl(process.env)}${PAGE}`;

  // 1. refresh the Main connection(s) only
  const synced: { itemId: string; ok: boolean }[] = [];
  for (const id of await mainItemIds()) {
    try {
      const r = await runPlaidSyncForItem(id);
      synced.push({ itemId: id.slice(0, 6), ok: r.ok });
    } catch {
      synced.push({ itemId: id.slice(0, 6), ok: false });
    }
  }

  // 2. build the watch
  const load = await loadBankWatch(day);
  const report = buildBankWatch(load.input);

  let planned: { dedupeKey: string; subject: string; text: string } | null = null;
  if (load.problems.length && load.input.mainAccounts.length === 0) {
    planned = {
      dedupeKey: `ach-bank-watch:failed:${day}`,
      subject: "Bank watch could not read the Timberland account today",
      text: `${load.problems.join("\n")}\n\nNothing was checked, so this is NOT an all clear.`,
    };
  } else {
    const m = watchEmail(report, link);
    if (m) {
      const extra = load.problems.length ? `\n\nAlso: ${load.problems.join(" ")}` : "";
      planned = { dedupeKey: `ach-bank-watch:${report.findingsKey.slice(0, 24)}:${weekKeyOf(day)}`, subject: m.subject, text: m.text + extra };
    }
  }

  const summary = { ok: true, day, synced, counts: report.counts, problems: load.problems.length };
  if (!planned) return NextResponse.json({ ...summary, emailed: false });

  const to = resolveNotifyContacts(process.env).contacts.michael.email;
  const db = createSupabaseAdminClient();
  const { error: claimError } = await db
    .from("compliance_reminder_log")
    .insert({ dedupe_key: planned.dedupeKey, stage: "ach-bank-watch", channel: "email", subject: planned.subject.slice(0, 300), recipients: to });
  let emailed = false;
  let emailError: string | null = null;
  if (claimError) {
    if (!/duplicate key|unique/i.test(claimError.message ?? "")) emailError = `could not claim (${claimError.message})`;
  } else {
    try {
      const html = `<p><strong>${escapeHtml(planned.subject)}</strong></p><pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(planned.text)}</pre><p><a href="${escapeHtml(link)}">Open the bank watch</a></p>`;
      emailed = (await resendOpsMailer()([to], { subject: planned.subject, html })).ok;
    } catch {
      emailed = false;
    }
    if (!emailed) {
      emailError = "email failed";
      await db.from("compliance_reminder_log").delete().eq("dedupe_key", planned.dedupeKey);
    }
  }
  return NextResponse.json({ ...summary, emailed, emailError }, { status: emailError === null ? 200 : 500 });
}

// Vercel Cron uses GET. POST runs the same path.
export async function POST(req: NextRequest) {
  return GET(req);
}
