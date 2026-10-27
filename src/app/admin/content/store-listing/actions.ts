"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { DEFAULT_STORE_HOURS, normalizeStoreHours } from "@/lib/seo/store-hours-core";
import { saveStoreHours } from "@/lib/seo/store-hours-server";

const PAGE = "/admin/content/store-listing";

/** R47: save the weekly + holiday hours Google reads from the site. */
export async function saveStoreHoursAction(formData: FormData): Promise<void> {
  const session = await requirePermission("content.edit");
  const reset = formData.get("reset") === "1";
  const hours = reset ? normalizeStoreHours(DEFAULT_STORE_HOURS) : normalizeStoreHours(String(formData.get("hours") ?? ""));
  const res = await saveStoreHours(hours, session.userId);
  if (!res.ok) {
    redirect(`${PAGE}?error=save`);
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: reset ? "store_hours.reset" : "store_hours.save",
    entityType: "site_setting",
    entityId: "google_store_hours",
  });
  revalidatePath("/(site)", "layout") /* PERF-S6: public site only, not /admin */;
  revalidatePath("/locations");
  revalidatePath(PAGE);
  redirect(`${PAGE}?saved=1`);
}
