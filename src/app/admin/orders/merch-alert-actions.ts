"use server";
/**
 * D232 M-7 (G-85, SOP-11 §4.21): Acknowledge a greenwaymerch.com alert.
 * Anyone who works merch orders may (orders.manage, the same gate as Confirm
 * and Cancel). Who and when are kept on the row (0361 merch_alerts) and in
 * the audit log (merch.alert_acknowledged). A repeat of the same alert
 * re-opens it.
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { acknowledgeMerchAlert } from "@/lib/merch/merch-alerts-server";

function safeReturn(v: string): string {
  return /^\/admin\/[A-Za-z0-9/_\-.%?=&#]*$/.test(v) && !v.startsWith("//") ? v : "/admin/orders#merch-alerts";
}

export async function acknowledgeMerchAlertAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.manage");
  const id = String(formData.get("alertId") ?? "").trim();
  const back = safeReturn(String(formData.get("returnTo") ?? ""));
  const r = await acknowledgeMerchAlert(id, session.email ?? "");
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "merch.alert_acknowledged",
    entityType: "merch_alert",
    entityId: id.slice(0, 40),
    after: r.ok ? { ok: true, subject: r.subject.slice(0, 200) } : { ok: false, error: r.error },
  });
  revalidatePath("/admin/orders");
  revalidatePath("/admin/merch-studio/health");
  redirect(back);
}
