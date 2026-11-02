"use server";

/**
 * CVB-5 - Admin -> Cultivera Archive server actions. Owner only ("cultivera.benchmark").
 *
 *   startArchiveAction    -> the crawler starts (or continues) the read-only harvest of Cultivera's back office
 *   cancelArchiveAction   -> stop between calls (Continue picks up where it stopped)
 *   archiveRunAction      -> copy a FINISHED run into the private cultivera-archive bucket (every file checked
 *                            against the manifest's sha256), register it, and store Cultivera's daily figures.
 *                            Resumable: if it runs out of time it says how far it got; press again to continue
 *   rebuildDaysAction     -> re-read the daily figures from the bucket copy (not the crawler)
 *
 * Owner request 2026-11-01: "This will also allow me to retain Cultivera historical data safely in our system.
 * This will be owner only access."
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { isValidArchiveRunId } from "@/lib/reports/cultivera-benchmark-core";
import { cancelArchiveRun, startArchiveRun } from "@/lib/reports/cultivera-archive-client";
import { archiveFinishedRun, ingestDailyFigures } from "@/lib/reports/cultivera-archive-runner";

const PAGE = "/admin/cultivera-archive";
const withRun = (id: string, q = "") => `${PAGE}?run=${id}${q}`;
const err = (m: string) => "&error=" + encodeURIComponent(m);
const msg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export async function startArchiveAction(formData: FormData): Promise<void> {
  const session = await requirePermission("cultivera.benchmark");
  const fresh = String(formData.get("fresh") ?? "") === "on";
  let runId = "";
  try {
    const out = await startArchiveRun(fresh);
    runId = out.runId;
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: out.resumed ? "cultivera_archive.harvest_resumed" : "cultivera_archive.harvest_started",
      entityType: "cultivera_archive_run",
      entityId: runId,
      after: { fresh },
    });
  } catch (e) {
    redirect(`${PAGE}?error=${encodeURIComponent(msg(e, "Could not start the harvest."))}`);
  }
  redirect(withRun(runId));
}

export async function cancelArchiveAction(formData: FormData): Promise<void> {
  const session = await requirePermission("cultivera.benchmark");
  const runId = String(formData.get("run_id") ?? "");
  if (!isValidArchiveRunId(runId)) redirect(`${PAGE}?error=${encodeURIComponent("Unknown run.")}`);
  try {
    await cancelArchiveRun(runId);
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "cultivera_archive.harvest_cancel_requested",
      entityType: "cultivera_archive_run",
      entityId: runId,
    });
  } catch (e) {
    redirect(withRun(runId, err(msg(e, "Stop failed."))));
  }
  redirect(withRun(runId));
}

export async function archiveRunAction(formData: FormData): Promise<void> {
  const session = await requirePermission("cultivera.benchmark");
  const runId = String(formData.get("run_id") ?? "");
  if (!isValidArchiveRunId(runId)) redirect(`${PAGE}?error=${encodeURIComponent("Unknown run.")}`);
  let q = "";
  try {
    const r = await archiveFinishedRun(runId, session.userId);
    if (r.kind === "partial") {
      await recordAudit({
        actorId: session.userId,
        actorEmail: session.email,
        action: "cultivera_archive.copy_partial",
        entityType: "cultivera_archive_run",
        entityId: runId,
        after: { uploaded: r.uploaded, remaining: r.remaining, total: r.total },
      });
      q = `&partial=1&uploaded=${r.uploaded}&remaining=${r.remaining}&total=${r.total}`;
    } else {
      await recordAudit({
        actorId: session.userId,
        actorEmail: session.email,
        action: r.register.status === "already" ? "cultivera_archive.days_refreshed" : "cultivera_archive.archived",
        entityType: "cultivera_archive_run",
        entityId: runId,
        after: { register: r.register, uploaded: r.uploaded, days: { ...r.days, problemSample: undefined } },
      });
      q = `&archived=1&days=${r.days.stored}&written=${r.days.written}&kept=${r.days.keptNewer}&problems=${r.days.problems}&conflicts=${r.days.conflicts.length}`;
    }
  } catch (e) {
    redirect(withRun(runId, err(msg(e, "Archive failed."))));
  }
  revalidatePath(PAGE);
  redirect(withRun(runId, q));
}

export async function rebuildDaysAction(formData: FormData): Promise<void> {
  const session = await requirePermission("cultivera.benchmark");
  const runId = String(formData.get("run_id") ?? "");
  if (!isValidArchiveRunId(runId)) redirect(`${PAGE}?error=${encodeURIComponent("Unknown run.")}`);
  let q = "";
  try {
    const d = await ingestDailyFigures(runId);
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "cultivera_archive.days_refreshed",
      entityType: "cultivera_archive_run",
      entityId: runId,
      after: { ...d, problemSample: undefined },
    });
    q = `&archived=1&days=${d.stored}&written=${d.written}&kept=${d.keptNewer}&problems=${d.problems}&conflicts=${d.conflicts.length}`;
  } catch (e) {
    redirect(withRun(runId, err(msg(e, "Could not rebuild the daily figures."))));
  }
  revalidatePath(PAGE);
  redirect(withRun(runId, q));
}
