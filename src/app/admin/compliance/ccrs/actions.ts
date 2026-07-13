"use server";

/**
 * Server actions for the CCRS Compliance Command Center (Task W).
 *
 * Recording a week as SUBMITTED (or nothing-to-report) is the owner's
 * compliance evidence, so every action is permission-gated (settings.manage)
 * and audited. The ledger store enforces the hard rules (a week can only be
 * resolved after it has completed; on_time computed at write).
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { resolveWeek, unresolveWeek, setWeekErrorStatus } from "@/lib/compliance/ccrs-week-store";
import { weekFromKey } from "@/lib/compliance/ccrs-week-core";
import { resolveRange } from "@/lib/reports/range";
import { buildCcrsBatch } from "@/lib/compliance/ccrs-batch";

const BASE = "/admin/compliance/ccrs";

function back(weekKey: string, extra?: string): never {
  redirect(`${BASE}?week=${encodeURIComponent(weekKey)}${extra ? `&${extra}` : ""}`);
}

/** Record a completed week as submitted or nothing-to-report. */
export async function resolveWeekAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const weekKey = String(formData.get("week_key") ?? "");
  const resolution = String(formData.get("resolution") ?? "");
  const notes = String(formData.get("notes") ?? "").trim() || null;

  const week = weekFromKey(weekKey);
  if (!week || (resolution !== "submitted" && resolution !== "nothing_to_report")) {
    redirect(`${BASE}?error=${encodeURIComponent("Invalid week or resolution.")}`);
  }

  // For a SUBMITTED week, snapshot the batch summary as ledger evidence
  // (file names + record counts actually generated for that week's range).
  let files: { type: string; fileName: string; recordCount: number }[] = [];
  let totalRecords = 0;
  if (resolution === "submitted") {
    try {
      const range = resolveRange({ from: week.start, to: week.end });
      const batch = await buildCcrsBatch(range.fromISO, range.toISO);
      files = batch.files.map((f) => ({
        type: String(f.type),
        fileName: f.fileName,
        recordCount: f.recordCount,
      }));
      totalRecords = batch.totalRecords;
    } catch {
      // Evidence snapshot is best-effort — the resolution itself still records.
    }
  }

  const res = await resolveWeek({
    weekKey: week.key,
    resolution,
    byId: session.profile.id,
    byEmail: session.email,
    files,
    totalRecords,
    notes,
  });
  if (!res.ok) back(week.key, `error=${encodeURIComponent(res.error ?? "Could not save.")}`);

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: resolution === "submitted" ? "ccrs_week.submitted" : "ccrs_week.nothing_to_report",
    entityType: "ccrs_week_submission",
    entityId: week.key,
    after: { weekKey: week.key, resolution, totalRecords, notes },
  });

  revalidatePath(BASE);
  back(week.key, "saved=1");
}

/** Undo a mistaken week sign-off. */
export async function unresolveWeekAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const weekKey = String(formData.get("week_key") ?? "");
  if (!weekFromKey(weekKey)) redirect(`${BASE}?error=${encodeURIComponent("Invalid week.")}`);

  const res = await unresolveWeek(weekKey);
  if (!res.ok) back(weekKey, `error=${encodeURIComponent(res.error ?? "Could not undo.")}`);

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ccrs_week.unresolved",
    entityType: "ccrs_week_submission",
    entityId: weekKey,
    after: { weekKey },
  });

  revalidatePath(BASE);
  back(weekKey, "saved=1");
}

/** Flag or clear the error-email status on a submitted week. */
export async function setWeekErrorStatusAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const weekKey = String(formData.get("week_key") ?? "");
  const errorStatus = String(formData.get("error_status") ?? "");
  const errorNotes = String(formData.get("error_notes") ?? "").trim() || null;

  if (
    !weekFromKey(weekKey) ||
    (errorStatus !== "clean" && errorStatus !== "errors_reported" && errorStatus !== "resolved")
  ) {
    redirect(`${BASE}?error=${encodeURIComponent("Invalid week or error status.")}`);
  }

  const res = await setWeekErrorStatus({
    weekKey,
    errorStatus: errorStatus as "clean" | "errors_reported" | "resolved",
    errorNotes,
  });
  if (!res.ok) back(weekKey, `error=${encodeURIComponent(res.error ?? "Could not save.")}`);

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ccrs_week.error_status",
    entityType: "ccrs_week_submission",
    entityId: weekKey,
    after: { weekKey, errorStatus, errorNotes },
  });

  revalidatePath(BASE);
  back(weekKey, "saved=1");
}
