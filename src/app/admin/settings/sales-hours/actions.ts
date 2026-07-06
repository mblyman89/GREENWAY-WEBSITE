"use server";

/**
 * Save action for the sales-hours window (S-12, WAC 314-55-147). The window
 * can be TIGHTENED by the owner but never widened past the statute — the core
 * normalizer clamps into 8:00 AM–midnight Pacific regardless of input.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  minutesToHm,
  normalizeSalesHoursWindow,
  parseHmToMinutes,
} from "@/lib/compliance/sales-hours-core";
import { saveSalesHoursWindow } from "@/lib/compliance/sales-hours-store";

const ROOT = "/admin/settings/sales-hours";

export async function saveSalesHoursAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");

  const openRaw = String(formData.get("open_time") ?? "").trim();
  const closeRaw = String(formData.get("close_time") ?? "").trim();

  const openMinutes = parseHmToMinutes(openRaw);
  const closeMinutes = parseHmToMinutes(closeRaw);
  if (openMinutes == null || closeMinutes == null) {
    redirect(`${ROOT}?error=` + encodeURIComponent("Enter times as HH:MM (24-hour, e.g. 08:00 and 24:00)."));
  }
  if (openMinutes >= closeMinutes) {
    redirect(`${ROOT}?error=` + encodeURIComponent("Opening time must be before closing time."));
  }

  const normalized = normalizeSalesHoursWindow({ openMinutes, closeMinutes });
  // Surface (rather than silently accept) an attempt to widen past the statute.
  if (normalized.openMinutes !== openMinutes || normalized.closeMinutes !== closeMinutes) {
    redirect(
      `${ROOT}?error=` +
        encodeURIComponent(
          "WAC 314-55-147 limits cannabis sales to 8:00 AM–midnight (store time). " +
            `The window was clamped to ${minutesToHm(normalized.openMinutes)}–${minutesToHm(normalized.closeMinutes)}; ` +
            "enter times inside that range.",
        ),
    );
  }

  const res = await saveSalesHoursWindow(normalized, session.profile.id);
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "settings.sales_hours.save",
    entityType: "site_settings",
    entityId: "compliance_sales_hours",
    after: { openMinutes: normalized.openMinutes, closeMinutes: normalized.closeMinutes },
  }).catch(() => {});

  revalidatePath(ROOT);
  redirect(
    res.ok
      ? `${ROOT}?saved=1`
      : `${ROOT}?error=${encodeURIComponent(res.error ?? "Save failed.")}`,
  );
}
