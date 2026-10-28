"use server";

/**
 * Save the written recall plan (Fix Phase 1.6c · G-25 req 1; F-05a-15;
 * WAC 314-55-225(3)(d)). Coordinator = the admin, no back-up (D37).
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { pacificToday } from "@/lib/reports/timezone";
import { normalizeRecallPlan, evaluateRecallPlanSave, RECALL_EVENT_AUDIT, EMPTY_RECALL_PLAN } from "@/lib/inventory/recall-event-core";
import { getRecallPlan, saveRecallPlan, RECALL_PLAN_KEY } from "@/lib/inventory/recall-event-store";

const ROOT = "/admin/settings/recall-plan";

export async function saveRecallPlanAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const raw: Record<string, string> = {};
  for (const k of Object.keys(EMPTY_RECALL_PLAN)) raw[k] = String(formData.get(k) ?? "");
  const plan = normalizeRecallPlan(raw);
  const v = evaluateRecallPlanSave(plan, pacificToday());
  if (!v.ok) redirect(`${ROOT}?error=${encodeURIComponent(v.refusals.map((r) => r.message).join(" "))}`);
  const before = await getRecallPlan();
  const res = await saveRecallPlan(plan, session.profile.id);
  if (!res.ok) redirect(`${ROOT}?error=${encodeURIComponent(res.error)}`);
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: RECALL_EVENT_AUDIT.planSave,
    entityType: "site_settings",
    entityId: RECALL_PLAN_KEY,
    before: before as unknown as Record<string, unknown> | null,
    after: plan as unknown as Record<string, unknown>,
  });
  revalidatePath(ROOT);
  revalidatePath("/admin/inventory");
  redirect(`${ROOT}?saved=1`);
}
