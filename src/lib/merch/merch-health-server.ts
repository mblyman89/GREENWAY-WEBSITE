/**
 * src/lib/merch/merch-health-server.ts  (D232 slice M-2, SOP-11 Appendix B.4)
 *
 * Owner (D232, verbatim): "I want to build all things, serious to not
 * serious. The big to the small." M-2 is the Merch Health page: one place
 * that says whether greenwaymerch.com can take, charge, make and ship an
 * order, with the exact fix for anything that is not green.
 *
 * Server-only gatherer + runner:
 *   1. Asks Printful (main-project token): scopes, stores, webhook, drafts.
 *   2. Asks the shop's own /api/health (Bearer MERCH_HEALTH_TOKEN, no
 *      redirect follow, same lesson as F-11-1).
 *   3. Reads the three public status pages, our catalog and the buckets.
 *   4. buildMerchHealth (pure, merch-health-core.ts) turns it into H-1..H-19.
 *   5. Saves one row in platform_health_runs (kind merch_health, 0331).
 *   7. Cron only (M-7, G-84): card holds 3+ / 5+ days old are emailed once per
 *      hold and stage (merch-payments-server.ts sendHeldReminders).
 *   6. Cron only (rides the daily /api/cron/platform-health run, no new cron): emails staff when the set of red checks changed since the
 *      last run, plus a Monday digest; claimed once per Pacific day in
 *      compliance_reminder_log (merch-health:daily:<day>).
 *
 * Nothing here throws; nothing returned contains a secret.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { sendStaffAlertEmail } from "@/lib/orders/staff-alert-email";
import { publicSiteOrigin } from "@/lib/site/site-domain-core";
import { pacificToday } from "@/lib/reports/timezone";
import { printful, printfulConfigured } from "@/lib/merch-studio/printful-client";
import { readMerchCatalog } from "./merch-inventory-store";
import { merchShopOrigin } from "./merch-shop-origin";
import { readHeldList, type HeldItem } from "./merch-payments-core";
import { sendHeldReminders } from "./merch-payments-server";
import {
  MERCH_HEALTH_KIND,
  MERCH_HEALTH_PAGE,
  MERCH_HEALTH_SETTINGS_KEY,
  buildMerchHealth,
  normalizeHealthSettings,
  shouldAlert,
  type CallResult,
  type MerchHealthReport,
  type ShopHealthLike,
} from "./merch-health-core";

const RUNS_TABLE = "platform_health_runs";
const TIMEOUT_MS = 12_000;
export { MERCH_SHOP_DEFAULT, merchShopOrigin } from "./merch-shop-origin";

export const STATUS_PAGES = {
  printful: "https://www.printfulstatus.com/api/v2/status.json",
  stripe: "https://www.stripestatus.com/api/v2/status.json",
  resend: "https://resend-status.com/api/v2/status.json",
} as const;


type Admin = ReturnType<typeof createSupabaseAdminClient>;

async function getJson(url: string, headers: Record<string, string> = {}): Promise<CallResult & { problem?: string }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { Accept: "application/json", ...headers }, cache: "no-store", redirect: "manual", signal: ctl.signal });
    if (res.status >= 300 && res.status < 400) {
      return { status: res.status, body: null, problem: `It redirected to ${res.headers.get("location") ?? "another address"}; set MERCH_SHOP_URL to the final address (no redirect).` };
    }
    const body = (await res.json().catch(() => null)) as unknown;
    return { status: res.status, body };
  } catch (e) {
    const aborted = (e as { name?: string })?.name === "AbortError";
    return { status: 0, body: null, problem: aborted ? "No answer within 12 seconds." : "Could not reach it (network error)." };
  } finally {
    clearTimeout(t);
  }
}

async function pf(path: string): Promise<CallResult> {
  const r = await printful<unknown>("GET", path);
  return r.ok ? { status: 200, body: r.result } : { status: r.status, body: null };
}

export async function readHealthSettings(): Promise<{ printfulTokenExpires: string; error: string | null }> {
  if (!isSupabaseServiceConfigured) return { printfulTokenExpires: "", error: "Database is not configured." };
  try {
    const { data, error } = await createSupabaseAdminClient().from("site_settings").select("value_json").eq("key", MERCH_HEALTH_SETTINGS_KEY).maybeSingle();
    if (error) return { printfulTokenExpires: "", error: error.message };
    return { ...normalizeHealthSettings(data?.value_json ?? null), error: null };
  } catch (e) {
    return { printfulTokenExpires: "", error: e instanceof Error ? e.message : "read failed" };
  }
}

export async function saveHealthSettings(next: { printfulTokenExpires: string }, updatedBy: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const clean = normalizeHealthSettings(next);
  if (next.printfulTokenExpires && !clean.printfulTokenExpires) return { ok: false, error: "Use a date like 2027-01-31." };
  try {
    const { error } = await createSupabaseAdminClient()
      .from("site_settings")
      .upsert({ key: MERCH_HEALTH_SETTINGS_KEY, label: "Merch Health settings", value_json: clean as unknown as Record<string, unknown>, updated_by: updatedBy }, { onConflict: "key" });
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

async function bucketExists(admin: Admin | null, id: string): Promise<boolean | null> {
  if (!admin) return null;
  try {
    const { data, error } = await admin.storage.getBucket(id);
    if (error) return /not.?found/i.test(error.message) ? false : null;
    return Boolean(data);
  } catch {
    return null;
  }
}

/** Gather every input and build the report. Never throws. */
export async function gatherMerchHealth(): Promise<MerchHealthReport> {
  return (await gatherMerchHealthFull()).report;
}

/** The report plus the shop's card-hold list (D232 M-7, G-84: the day-3 / day-5 reminders). */
async function gatherMerchHealthFull(): Promise<{ report: MerchHealthReport; held: HeldItem[] }> {
  const nowIso = new Date().toISOString();
  const admin = isSupabaseServiceConfigured ? createSupabaseAdminClient() : null;
  const shopOrigin = merchShopOrigin();
  const token = process.env.MERCH_HEALTH_TOKEN ?? "";
  const configured = printfulConfigured();

  const [scopes, stores, webhooks, drafts, shopRes, pfPage, stPage, rsPage, cat, settings, media, merchFiles] = await Promise.all([
    configured ? pf("/oauth/scopes") : Promise.resolve(null),
    configured ? pf("/stores") : Promise.resolve(null),
    configured ? pf("/webhooks") : Promise.resolve(null),
    configured ? pf("/orders?status=draft&limit=100") : Promise.resolve(null),
    token.length >= 32 ? getJson(`${shopOrigin}/api/health`, { Authorization: `Bearer ${token}` }) : Promise.resolve(null),
    getJson(STATUS_PAGES.printful),
    getJson(STATUS_PAGES.stripe),
    getJson(STATUS_PAGES.resend),
    readMerchCatalog(),
    readHealthSettings(),
    bucketExists(admin, "media"),
    bucketExists(admin, "merch-files"),
  ]);

  const live = cat.catalog.items.filter((i) => i.status === "live");
  const synced = live.map((i) => i.stockSyncedAt).filter(Boolean).sort();
  const shopBody = shopRes && shopRes.status === 200 ? (shopRes.body as ShopHealthLike | null) : null;
  const held = readHeldList((shopBody?.stripe?.held as { list?: unknown } | null | undefined)?.list);
  const report = buildMerchHealth({
    nowIso,
    shopOrigin,
    printfulConfigured: configured,
    scopes,
    stores,
    webhooks,
    drafts,
    tokenExpires: settings.printfulTokenExpires,
    shop: shopRes
      ? { status: shopRes.status, body: shopRes.status === 200 ? (shopRes.body as ShopHealthLike) : null, problem: shopRes.problem }
      : token
        ? { status: 0, body: null, problem: "MERCH_HEALTH_TOKEN in this project is shorter than 32 characters." }
        : null,
    statusPages: { printful: pfPage, stripe: stPage, resend: rsPage },
    catalog: { readError: cat.readError, live: live.length, oldestStockSyncIso: synced[0] ?? null, neverSynced: live.length - synced.length, productIds: [...new Set(cat.catalog.items.map((x) => x.pkg.product.blank.printfulProductId))] },
    buckets: { media, merchFiles },
  });
  return { report, held };
}

export type MerchHealthRunRow = { id: string; status: "ok" | "warn" | "fail"; summary: string; report: unknown; source: "cron" | "manual"; created_at: string };

export async function listMerchHealthRuns(limit = 20): Promise<{ rows: MerchHealthRunRow[]; error: string | null }> {
  if (!isSupabaseServiceConfigured) return { rows: [], error: "Supabase is not configured." };
  try {
    const { data, error } = await createSupabaseAdminClient()
      .from(RUNS_TABLE)
      .select("id, status, summary, report, source, created_at")
      .eq("kind", MERCH_HEALTH_KIND)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      const hint = error.code === "42P01" || error.code === "PGRST205" ? "The health-run table is not installed: run supabase/migrations/0331_platform_health.sql." : `Could not load runs (${error.code ?? "?"}): ${error.message}`;
      return { rows: [], error: hint };
    }
    return { rows: (data ?? []) as MerchHealthRunRow[], error: null };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** The last saved run's report (no live calls), for quick reads: the Studio header and form 8.1. */
export async function latestMerchHealthReport(): Promise<{ report: MerchHealthReport | null; error: string | null }> {
  const r = await listMerchHealthRuns(1);
  const rep = (r.rows[0]?.report ?? null) as MerchHealthReport | null;
  return { report: rep && Array.isArray(rep.checks) ? rep : null, error: r.error };
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function merchAlertHtml(r: MerchHealthReport, pageUrl: string, why: "changed" | "weekly"): string {
  const bad = r.checks.filter((c) => c.level === "fail" || c.level === "warn");
  const rows = bad
    .map((c) => `<li><strong>${c.level === "fail" ? "RED" : "AMBER"} ${esc(c.id)} ${esc(c.title)}</strong>: ${esc(c.detail)}${c.fix ? `<br/>Fix: ${esc(c.fix)} (SOP-11 ${esc(c.sop)})` : ""}</li>`)
    .join("");
  return `<p>${why === "weekly" ? "Weekly Merch Health digest." : "Something changed in Merch Health since the last check."}</p><p>${esc(r.summary)}</p>${rows ? `<ul>${rows}</ul>` : ""}<p><a href="${esc(pageUrl)}">Open Merch Health</a></p>`;
}

export type MerchHealthOutcome = { report: MerchHealthReport; saved: boolean; alert: "sent" | "already-sent" | "not-needed" | "not-configured" | "skipped" | "failed"; notes: string[] };

export async function runMerchHealth(opts: { source: "cron" | "manual"; runBy?: string | null }): Promise<MerchHealthOutcome> {
  const notes: string[] = [];
  const { report, held } = await gatherMerchHealthFull();
  if (!isSupabaseServiceConfigured) return { report, saved: false, alert: "skipped", notes: ["supabase not configured"] };
  const admin = createSupabaseAdminClient();

  // Read the previous run BEFORE saving this one (for "did the reds change?").
  let prev: MerchHealthReport | null = null;
  try {
    const { data } = await admin.from(RUNS_TABLE).select("report").eq("kind", MERCH_HEALTH_KIND).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const rep = (data as { report?: unknown } | null)?.report as MerchHealthReport | undefined;
    prev = rep && Array.isArray(rep.checks) ? rep : null;
  } catch {
    prev = null;
  }

  let saved = false;
  try {
    const { error } = await admin.from(RUNS_TABLE).insert({ kind: MERCH_HEALTH_KIND, status: report.status, summary: report.summary.slice(0, 500), report, source: opts.source, run_by: opts.runBy ?? null });
    if (error) notes.push(`could not save the run (${error.code ?? "?"}): ${error.message}`);
    else saved = true;
  } catch (e) {
    notes.push(`could not save the run: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (opts.source !== "cron") return { report, saved, alert: "skipped", notes };

  // D232 M-7 (G-84): a card hold 3+ days old gets one email, 5+ days a second
  // one (claimed per hold and stage), whether or not the reds changed.
  notes.push(...(await sendHeldReminders(admin, held)));

  const day = pacificToday();
  const isMonday = new Date(`${day}T12:00:00Z`).getUTCDay() === 1;
  const decide = shouldAlert(prev, report, isMonday);
  if (!decide.send) return { report, saved, alert: "not-needed", notes };

  const to = (process.env.ORDER_STAFF_EMAILS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const apiKey = process.env.RESEND_API_KEY ?? "";
  const from = process.env.ORDER_EMAIL_FROM ?? "";
  if (!apiKey || !from || to.length === 0) return { report, saved, alert: "not-configured", notes };

  const subject = `Merch Health ${day}: ${report.status === "ok" ? "all green" : report.status === "warn" ? "needs a look" : "ACTION NEEDED"}`;
  const key = `merch-health:daily:${day}`;
  try {
    const { error } = await admin.from("compliance_reminder_log").insert({ dedupe_key: key, stage: "merch_health", week_key: null, channel: "email", subject, recipients: "pending" });
    if (error && error.code === "23505") return { report, saved, alert: "already-sent", notes };
    if (error) notes.push("could not claim today's alert row; sending anyway");
  } catch {
    notes.push("could not claim today's alert row; sending anyway");
  }
  const r = await sendStaffAlertEmail({
    apiKey,
    from,
    to,
    subject,
    html: merchAlertHtml(report, `${publicSiteOrigin(process.env)}${MERCH_HEALTH_PAGE}`, decide.why === "weekly" ? "weekly" : "changed"),
  });
  if (!r.ok) {
    notes.push(`email failed: ${r.detail}`);
    return { report, saved, alert: "failed", notes };
  }
  try {
    await admin.from("compliance_reminder_log").update({ recipients: to.join(", ").slice(0, 1000) }).eq("dedupe_key", key);
  } catch {
    // best effort
  }
  return { report, saved, alert: "sent", notes };
}
