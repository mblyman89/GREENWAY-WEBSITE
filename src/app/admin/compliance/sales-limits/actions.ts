"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { recordAudit } from "@/lib/auth/audit";
import {
  updateSalesLimitSettings,
  type SalesLimitSettingsInput,
} from "@/lib/compliance/sales-limits";

const BASE = "/admin/compliance/sales-limits";

/** Parse a positive numeric form field with a fallback. */
function num(formData: FormData, key: string, fallback: number): number {
  const n = Number(formData.get(key));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export async function updateSalesLimitSettingsAction(formData: FormData) {
  const session = await requirePermission("settings.manage");
  if (!can(session.profile.role, "settings.manage")) {
    redirect(`${BASE}?error=${encodeURIComponent("Changing sales limits requires admin.")}`);
  }

  // Per-category grams-per-unit overrides: a textarea of "slug=grams" lines.
  const unitGrams: Record<string, number> = {};
  const raw = ((formData.get("unit_grams") as string | null) ?? "").trim();
  if (raw) {
    for (const line of raw.split(/\r?\n/)) {
      const [k, v] = line.split("=").map((s) => s.trim());
      const g = Number(v);
      if (k && Number.isFinite(g) && g > 0) unitGrams[k.toLowerCase()] = g;
    }
  }

  const input: SalesLimitSettingsInput = {
    enforce: formData.get("enforce") === "on",
    hardBlock: formData.get("hard_block") === "on",
    rec: {
      usable: num(formData, "rec_usable", 28),
      solid_edible: num(formData, "rec_solid", 448),
      concentrate: num(formData, "rec_concentrate", 7),
      liquid_edible: num(formData, "rec_liquid", 2016),
    },
    med: {
      usable: num(formData, "med_usable", 84),
      solid_edible: num(formData, "med_solid", 1344),
      concentrate: num(formData, "med_concentrate", 21),
      liquid_edible: num(formData, "med_liquid", 6048),
    },
    unitGrams,
    notes: ((formData.get("notes") as string | null) ?? "").trim() || null,
  };

  const result = await updateSalesLimitSettings(input, session.userId);
  if (!result.ok) redirect(`${BASE}?error=${encodeURIComponent(result.error)}`);

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "sales_limit_settings.update",
    entityType: "sales_limit_settings",
    entityId: "singleton",
    after: input,
  });
  revalidatePath(BASE);
  redirect(`${BASE}?ok=1`);
}
