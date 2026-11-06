/**
 * src/lib/platform/db-vitals-store.ts   (D193 · DB HEALTH round slice B)
 *
 * SERVER-ONLY. Reads the database's vital signs (0345 platform_db_vitals),
 * keeps a compact history in platform_health_runs (kind "db_vitals"), clears
 * stuck app sessions (0345 platform_db_heal_stuck) when the Partner's level
 * allows it, and emails staff when the database restarted or is in trouble.
 *
 * Called every 10 minutes by /api/cron/db-vitals, by the Partner (facts and
 * the "Clear stuck sessions" fix), and by the platform-health page.
 *
 * Storage stays small on purpose: a reading is stored only when something is
 * wrong, the database start time moved (a restart), or the last stored reading
 * is an hour old. That is about 24 rows on a quiet day.
 *
 * Emails are claimed first in compliance_reminder_log (UNIQUE dedupe_key):
 * one per restart (keyed by the new start time) and at most one an hour for
 * other trouble. Warnings are never emailed; they show on the page and to the
 * Partner. Every database call reads its error (rule 135). Nothing throws.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { sendStaffAlertEmail } from "@/lib/orders/staff-alert-email";
import { publicSiteOrigin } from "@/lib/site/site-domain-core";
import { recordAudit } from "@/lib/auth/audit";
import {
  buildVitalsReport,
  countRestarts,
  HEAL_KIND,
  HEAL_RPC,
  healPlan,
  healSentence,
  parseHealResult,
  parseVitals,
  VITALS_KIND,
  VITALS_RPC,
  type HealResult,
  type VitalsReport,
} from "./db-vitals-core";

const RUNS_TABLE = "platform_health_runs";
export const DB_VITALS_PAGE = "/admin/settings/platform-health";
const STORE_EVERY_MS = 60 * 60_000;

type Admin = ReturnType<typeof createSupabaseAdminClient>;

type LastReading = { startedAt: string | null; createdAt: string | null; error: string | null };

/** The newest stored reading (its database start time and when it was stored). */
async function lastReading(admin: Admin): Promise<LastReading> {
  try {
    const { data, error } = await admin
      .from(RUNS_TABLE)
      .select("report, created_at")
      .eq("kind", VITALS_KIND)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) return { startedAt: null, createdAt: null, error: error.message };
    const row = ((data as { report: { vitals?: { startedAt?: string } | null } | null; created_at: string }[] | null) ?? [])[0];
    return { startedAt: row?.report?.vitals?.startedAt ?? null, createdAt: row?.created_at ?? null, error: null };
  } catch (e) {
    return { startedAt: null, createdAt: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Ask the database for its vital signs right now (no storing). */
export async function readVitalsNow(): Promise<{ report: VitalsReport; lastStoredAt: string | null }> {
  if (!isSupabaseServiceConfigured) return { report: buildVitalsReport(null, null, "Supabase is not configured on this deployment."), lastStoredAt: null };
  const admin = createSupabaseAdminClient();
  const last = await lastReading(admin);
  try {
    const { data, error } = await admin.rpc(VITALS_RPC);
    if (error) return { report: buildVitalsReport(null, last.startedAt, `${error.code ?? "?"}: ${error.message}`), lastStoredAt: last.createdAt };
    const v = parseVitals(data);
    return { report: buildVitalsReport(v, last.startedAt, v ? null : "unexpected shape"), lastStoredAt: last.createdAt };
  } catch (e) {
    return { report: buildVitalsReport(null, last.startedAt, e instanceof Error ? e.message : String(e)), lastStoredAt: last.createdAt };
  }
}

async function store(admin: Admin, kind: string, status: "ok" | "warn" | "fail", summary: string, report: unknown, source: "cron" | "manual", runBy: string | null): Promise<string | null> {
  try {
    const { error } = await admin.from(RUNS_TABLE).insert({ kind, status, summary: summary.slice(0, 500), report, source, run_by: runBy });
    return error ? `could not save (${error.code ?? "?"}): ${error.message}` : null;
  } catch (e) {
    return `could not save: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** Clear stuck app sessions. Changes no table rows. Audited and stored. */
export async function healStuckSessions(opts: {
  pids: number[] | null;
  idleTxMinutes: number;
  activeMinutes: number;
  source: "cron" | "manual";
  actor: { id: string | null; email: string | null };
}): Promise<{ ok: true; result: HealResult; message: string } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  const admin = createSupabaseAdminClient();
  try {
    const { data, error } = await admin.rpc(HEAL_RPC, { p_pids: opts.pids, p_idle_tx_minutes: opts.idleTxMinutes, p_active_minutes: opts.activeMinutes });
    if (error) return { ok: false, error: `${error.code ?? "?"}: ${error.message}` };
    const result = parseHealResult(data);
    if (!result) return { ok: false, error: "The heal answered in an unexpected shape. Nothing else was tried." };
    const message = healSentence(result);
    if (result.ended + result.cancelled + result.failed > 0) {
      const saveErr = await store(admin, HEAL_KIND, result.failed ? "warn" : "ok", message, data, opts.source, opts.actor.id);
      if (saveErr) console.warn(`[db-vitals] heal ${saveErr}`);
    }
    await recordAudit({
      actorId: opts.actor.id,
      actorEmail: opts.actor.email ?? (opts.source === "cron" ? "db-vitals cron" : null),
      action: "platform.db_heal",
      entityType: "database",
      after: { source: opts.source, pids: opts.pids, ...result },
    });
    return { ok: true, result, message };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function staffEmails(): string[] {
  return (process.env.ORDER_STAFF_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function claim(admin: Admin, key: string, subject: string): Promise<"claimed" | "taken" | "error"> {
  try {
    const { error } = await admin
      .from("compliance_reminder_log")
      .insert({ dedupe_key: key, stage: "db_vitals", week_key: null, channel: "email", subject, recipients: "pending" });
    if (!error) return "claimed";
    return error.code === "23505" ? "taken" : "error";
  } catch {
    return "error";
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

/** Alert key: one per restart, else at most one per UTC hour. Null = no email (ok / warn). */
export function alertKeyFor(r: VitalsReport, nowIso: string): string | null {
  if (r.status !== "fail") return null;
  if (r.restarted && r.vitals) return `db-vitals:restart:${r.vitals.startedAt}`;
  return `db-vitals:fail:${nowIso.slice(0, 13)}`;
}

export type VitalsTickOutcome = {
  status: "ok" | "warn" | "fail";
  summary: string;
  stored: boolean;
  healed: string | null;
  alert: "sent" | "already-sent" | "not-configured" | "skipped" | "failed";
  notes: string[];
};

/**
 * One check (the 10-minute cron). `autoHeal` is true when the Partner's level
 * lets a "touches nothing" fix run by itself (Level 2).
 */
export async function runDbVitalsTick(opts: { autoHeal: boolean }): Promise<VitalsTickOutcome> {
  const notes: string[] = [];
  if (!isSupabaseServiceConfigured) return { status: "fail", summary: "Supabase is not configured.", stored: false, healed: null, alert: "skipped", notes: ["not configured"] };
  const admin = createSupabaseAdminClient();
  const { report, lastStoredAt } = await readVitalsNow();

  let healed: string | null = null;
  const plan = healPlan(report.vitals);
  if (plan && opts.autoHeal) {
    const h = await healStuckSessions({ pids: plan.pids, idleTxMinutes: plan.idleTxMinutes, activeMinutes: plan.activeMinutes, source: "cron", actor: { id: null, email: null } });
    healed = h.ok ? h.message : `heal failed: ${h.error}`;
  } else if (plan) {
    notes.push("stuck sessions found; Partner is on Level 1, so they wait for a person");
  }

  const due = !lastStoredAt || Date.now() - Date.parse(lastStoredAt) >= STORE_EVERY_MS;
  let stored = false;
  if (report.status !== "ok" || report.restarted || due || healed) {
    const compact = { ...report, healed, vitals: report.vitals ? { ...report.vitals, stuck: report.vitals.stuck.slice(0, 5) } : null };
    const err = await store(admin, VITALS_KIND, report.status, report.summary, compact, "cron", null);
    if (err) notes.push(err);
    else stored = true;
  }

  const key = alertKeyFor(report, new Date().toISOString());
  if (!key) return { status: report.status, summary: report.summary, stored, healed, alert: "skipped", notes };
  const subject = report.restarted ? "Greenway database restarted (it is back up)" : "Greenway database needs attention";
  const c = await claim(admin, key, subject);
  if (c === "taken") return { status: report.status, summary: report.summary, stored, healed, alert: "already-sent", notes };
  if (c === "error") notes.push("could not claim the alert row (database busy or down); sending anyway");

  const to = staffEmails();
  if (!process.env.RESEND_API_KEY || !process.env.ORDER_EMAIL_FROM || to.length === 0) return { status: report.status, summary: report.summary, stored, healed, alert: "not-configured", notes };
  const pageUrl = `${publicSiteOrigin(process.env)}${DB_VITALS_PAGE}`;
  const items = report.findings.map((f) => `<li><strong>${esc(f.what)}</strong><br/>What to do: ${esc(f.todo)}</li>`).join("");
  const html = `<p>${esc(report.summary)}</p><ul>${items}</ul>${healed ? `<p>Self-heal: ${esc(healed)}</p>` : ""}<p><a href="${pageUrl}">Open Platform health</a> or ask Greenway Partner what happened.</p>`;
  const r = await sendStaffAlertEmail({ apiKey: process.env.RESEND_API_KEY ?? "", from: process.env.ORDER_EMAIL_FROM ?? "", to, subject, html });
  if (!r.ok) notes.push(`email failed: ${r.detail}`);
  return { status: report.status, summary: report.summary, stored, healed, alert: r.ok ? "sent" : "failed", notes };
}

export type VitalsHistory = { restarts7d: { count: number; at: string[] }; heals7d: number; error: string | null };

/** Restarts and heals in the last 7 days (from stored readings). */
export async function vitalsHistory(): Promise<VitalsHistory> {
  if (!isSupabaseServiceConfigured) return { restarts7d: { count: 0, at: [] }, heals7d: 0, error: "not configured" };
  try {
    const admin = createSupabaseAdminClient();
    const since = new Date(Date.now() - 7 * 24 * 3_600_000).toISOString();
    const [v, h] = await Promise.all([
      // Newest 900 readings are plenty (hourly = 168/week); stays under the 1000-row cap census (slice 5C).
      admin.from(RUNS_TABLE).select("report, created_at").eq("kind", VITALS_KIND).gte("created_at", since).order("created_at", { ascending: false }).limit(900),
      admin.from(RUNS_TABLE).select("id", { count: "exact", head: true }).eq("kind", HEAL_KIND).gte("created_at", since),
    ]);
    if (v.error) return { restarts7d: { count: 0, at: [] }, heals7d: 0, error: v.error.message };
    if (h.error) return { restarts7d: { count: 0, at: [] }, heals7d: 0, error: h.error.message };
    const starts = ((v.data as { report: { vitals?: { startedAt?: string } | null } | null }[] | null) ?? [])
      .map((r) => r.report?.vitals?.startedAt ?? "")
      .filter(Boolean);
    return { restarts7d: countRestarts(starts), heals7d: h.count ?? 0, error: null };
  } catch (e) {
    return { restarts7d: { count: 0, at: [] }, heals7d: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
