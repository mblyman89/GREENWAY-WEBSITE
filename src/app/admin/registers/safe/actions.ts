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
  const denoms = parseDenoms((k) => formData.get(k) as string | null);

  const result = await recordSafeCount({ window, denoms, countedBy, notes });
  if (!result.ok) redirect(`${BASE}?error=` + encodeURIComponent(result.error));

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "safe.counted",
    entityType: "safe_count",
    entityId: null,
    after: { window, varianceMinor: result.varianceMinor },
  });
  revalidatePath(BASE);
  redirect(
    `${BASE}?counted=` +
      encodeURIComponent(
        result.varianceMinor === 0
          ? "Safe counted — balanced on the $1,000 target."
          : result.varianceMinor > 0
            ? `Safe counted — over the target by ${formatCents(result.varianceMinor)}.`
            : `Safe counted — short of the target by ${formatCents(Math.abs(result.varianceMinor))}.`,
      ),
  );
}
