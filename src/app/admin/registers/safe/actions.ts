"use server";

/**
 * /admin/registers/safe — server actions (Feature slice 31).
 *
 * One action: record a manager count of the store safe. Counts are OPEN
 * (the $1,000 target is known policy), so the live variance shows while
 * counting — unlike drawer closes, which stay blind.
 *
 * Permission: inventory.manage (owner/admin/manager) — the same level that
 * reconciles drawers, because a safe count is the other half of the store's
 * cash-accountability loop.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { parseDenoms, formatCents } from "@/lib/registers/cash";
import { recordSafeCount } from "@/lib/registers/safe-store";
import { listEmployees } from "@/lib/staffing/store";
import { isOverShortWarning } from "@/lib/registers/over-short-warning-core";

const BASE = "/admin/registers/safe";

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

/** Record a safe count (AM, PM, or an extra "other" count). */
export async function recordSafeCountAction(formData: FormData): Promise<void> {
  const session = await requirePermission("inventory.manage");
  const window = str(formData, "count_window");
  const countedBy = str(formData, "counted_by") || null;
  const notes = str(formData, "notes") || null;
  const varianceReason = str(formData, "variance_reason");
  const denoms = parseDenoms((k) => formData.get(k) as string | null);

  // Fix Phase 2.3 (G-03, owner D7 "Who"; finding F-02-4): Counted by is
  // required and must be an active employee on the roster.
  if (!countedBy) {
    redirect(`${BASE}?error=` + encodeURIComponent("Pick who counted the master till (Counted by). Nothing was saved."));
  }
  const active = await listEmployees();
  if (!active.some((e) => e.id === countedBy)) {
    redirect(`${BASE}?error=` + encodeURIComponent("Counted by must be an active employee. Nothing was saved."));
  }

  const result = await recordSafeCount({ window, denoms, countedBy, notes, varianceReason });
  if (!result.ok) {
    if (result.varianceMinor != null && isOverShortWarning(result.varianceMinor)) {
      await recordAudit({
        actorId: session.userId,
        actorEmail: session.email,
        action: "safe.count_refused",
        entityType: "safe_count",
        entityId: null,
        after: { window, counted_by: countedBy, varianceMinor: result.varianceMinor, reason_required: true },
      });
    }
    redirect(`${BASE}?error=` + encodeURIComponent(result.error));
  }

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "safe.counted",
    entityType: "safe_count",
    // F-02-4: the audit entry now names the count row it belongs to.
    entityId: result.id,
    after: {
      window,
      counted_by: countedBy,
      varianceMinor: result.varianceMinor,
      over_short_warning: result.warning,
      variance_reason: result.reason,
      variance_reason_saved: result.reasonSaved,
    },
  });
  if (result.warning) {
    // D7 / D16: "Just warnings for now", and it applies to the master till too.
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "safe.over_short_warning",
      entityType: "safe_count",
      entityId: result.id,
      after: { window, counted_by: countedBy, varianceMinor: result.varianceMinor, reason: result.reason },
    });
  }
  revalidatePath(BASE);
  revalidatePath("/admin/registers/over-short");
  const base =
    result.varianceMinor === 0
      ? "Safe counted — balanced on the $1,000 target."
      : result.varianceMinor > 0
        ? `Safe counted — over the target by ${formatCents(result.varianceMinor)}.`
        : `Safe counted — short of the target by ${formatCents(Math.abs(result.varianceMinor))}.`;
  const extra =
    (result.warning ? " Warning: more than $5.00. The reason is saved and the owner sees it on Over / short warnings." : "") +
    (result.reason && !result.reasonSaved
      ? " The reason is in the Security Log only: migration 0315 is not applied yet."
      : "");
  redirect(`${BASE}?counted=` + encodeURIComponent(base + extra));
}
