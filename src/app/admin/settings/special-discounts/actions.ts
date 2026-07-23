"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  formatBps,
  isSpecialDiscountKind,
  parsePercentToBps,
} from "@/lib/discounts/special-discount-core";
import { saveSpecialDiscountSetting } from "@/lib/discounts/special-discount-store";

const ROOT = "/admin/settings/special-discounts";

const KIND_LABEL: Record<string, string> = {
  employee: "Employee",
  industry: "Industry",
  veteran: "Veteran",
};

/**
 * Save one special discount program's rate and on/off switch. Admin-only
 * (settings.manage = owner/admin) — deliberately NOT a promotions permission.
 */
export async function saveSpecialDiscountAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");

  const kind = String(formData.get("kind") ?? "").trim();
  if (!isSpecialDiscountKind(kind)) {
    redirect(`${ROOT}?error=${encodeURIComponent("Unknown discount program.")}`);
  }

  const rawPercent = String(formData.get("percent") ?? "").trim();
  const percentBps = parsePercentToBps(rawPercent);
  if (percentBps === null) {
    redirect(
      `${ROOT}?error=${encodeURIComponent(
        `Enter the ${KIND_LABEL[kind]} rate as a percent between 0 and 100 (like 35 or 12.5).`,
      )}`,
    );
  }

  const enabled = formData.get("enabled") === "on";

  const res = await saveSpecialDiscountSetting(kind, percentBps, enabled, session.profile.id);
  await recordAudit({
    actorId: session.profile.id,
    action: "special_discount.settings.save",
    entityType: "special_discount_settings",
    entityId: kind,
    after: { percentBps, enabled },
  }).catch(() => {});

  revalidatePath(ROOT);
  redirect(
    res.ok
      ? `${ROOT}?msg=${encodeURIComponent(
          `${KIND_LABEL[kind]} discount saved: ${formatBps(percentBps)}${enabled ? "" : " (turned off)"}.`,
        )}`
      : `${ROOT}?error=${encodeURIComponent(res.error ?? "Save failed.")}`,
  );
}
