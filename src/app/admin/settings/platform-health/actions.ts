"use server";

/**
 * /admin/settings/platform-health: server action (slice G-71a, owner message 12).
 *
 * One action: run the database health check now. It records a run (source
 * "manual") but never sends the daily email; that stays once a day from the
 * cron. Audited.
 */
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { runPlatformHealthCheck, PLATFORM_HEALTH_PAGE } from "@/lib/platform/platform-health-store";

export type RunHealthCheckResult = { ok: true; status: "ok" | "warn" | "fail"; summary: string } | { ok: false; error: string };

export async function runHealthCheckNowAction(): Promise<RunHealthCheckResult> {
  const session = await requirePermission("settings.manage");
  const out = await runPlatformHealthCheck({ source: "manual", runBy: session.profile.id });
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "platform.health_check_run",
    entityType: "platform_health",
    entityId: "db_contract",
    after: { status: out.report.status, summary: out.report.summary, saved: out.saved },
  });
  revalidatePath(PLATFORM_HEALTH_PAGE);
  if (!out.saved && out.notes.length > 0) return { ok: false, error: `${out.report.summary} (${out.notes.join("; ")})` };
  return { ok: true, status: out.report.status, summary: out.report.summary };
}

// ---------------------------------------------------------------------------
// D193 (DB health B): database vital signs. "Clear stuck connections" ends
// only APP connections stuck past the floors (0345); it changes no saved row.
// ---------------------------------------------------------------------------

export type ClearStuckResult = { ok: true; message: string } | { ok: false; error: string };

export async function clearStuckConnectionsAction(): Promise<ClearStuckResult> {
  const session = await requirePermission("settings.manage");
  const { readVitalsNow, healStuckSessions } = await import("@/lib/platform/db-vitals-store");
  const { healPlan } = await import("@/lib/platform/db-vitals-core");
  const { report } = await readVitalsNow();
  const plan = healPlan(report.vitals);
  if (!plan) {
    revalidatePath(PLATFORM_HEALTH_PAGE);
    return { ok: true, message: report.vitals ? "Nothing is stuck right now." : report.summary };
  }
  const r = await healStuckSessions({
    pids: plan.pids,
    idleTxMinutes: plan.idleTxMinutes,
    activeMinutes: plan.activeMinutes,
    source: "manual",
    actor: { id: session.profile.id, email: session.email },
  });
  revalidatePath(PLATFORM_HEALTH_PAGE);
  return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.error };
}
