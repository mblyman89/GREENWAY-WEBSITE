"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { isOwnerRole } from "@/lib/auth/roles";
import { recordAudit } from "@/lib/auth/audit";
import {
  MEDICAL_LIMITS,
  RECREATIONAL_LIMITS,
  clampLimitProfile,
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
  // Owner-only: even admins may VIEW the limits but only the store owner may
  // change, add, or remove them (owner directive, Slice 58).
  if (!isOwnerRole(session.profile.role)) {
    redirect(`${BASE}?error=${encodeURIComponent("Only the store owner can change sales limits.")}`);
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
    // AN-2: clamp INTO the statute before persisting AND before the audit
    // record — the owner may tighten below WAC 314-55-095 maximums but can
    // never widen past them (same discipline as normalizeSalesHoursWindow).
    rec: clampLimitProfile(
      {
        usable: num(formData, "rec_usable", 28),
        solid_edible: num(formData, "rec_solid", 448),
        concentrate: num(formData, "rec_concentrate", 7),
        liquid_edible: num(formData, "rec_liquid", 2016),
        // SLICE 16 \u2014 MILLIGRAMS of active delta-9 THC, not grams.
        // WAC 314-55-095(1)(d)(i)(F). Fallback is the statutory figure, taken
        // from the engine constant rather than retyped, so the two can never
        // drift apart.
        low_thc_liquid: num(
          formData,
          "rec_low_thc_liquid",
          RECREATIONAL_LIMITS.low_thc_liquid,
        ),
      },
      RECREATIONAL_LIMITS,
    ),
    med: clampLimitProfile(
      {
        usable: num(formData, "med_usable", 84),
        solid_edible: num(formData, "med_solid", 1344),
        concentrate: num(formData, "med_concentrate", 21),
        liquid_edible: num(formData, "med_liquid", 6048),
        // SLICE 16 \u2014 mg THC. MEDICAL_LIMITS.low_thc_liquid is 200, the SAME
        // as recreational. WAC 314-55-095(2)(d) says "and up to 200 mg"; this
        // bucket is the one that does not triple for a DOH-database patient.
        low_thc_liquid: num(
          formData,
          "med_low_thc_liquid",
          MEDICAL_LIMITS.low_thc_liquid,
        ),
      },
      MEDICAL_LIMITS,
    ),
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
