"use server";

/**
 * /admin/merch-studio/health: server actions (D232 slice M-2).
 *
 * Owner & admin only (settings.manage, the same gate as Platform health).
 *   - runMerchHealthNowAction: runs H-1..H-19 now and records a run (source
 *     "manual"). It never sends the email; that stays with the morning cron.
 *   - saveTokenExpiryAction: saves the Printful token's expiry date (Printful
 *     has no API that tells us, so the owner types it from the token list).
 * Both are audited.
 */
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { MERCH_HEALTH_PAGE } from "@/lib/merch/merch-health-core";
import { runMerchHealth, saveHealthSettings } from "@/lib/merch/merch-health-server";

export type MerchHealthActionResult = { ok: true; status: "ok" | "warn" | "fail"; summary: string } | { ok: false; error: string };

export async function runMerchHealthNowAction(): Promise<MerchHealthActionResult> {
  const session = await requirePermission("settings.manage");
  const out = await runMerchHealth({ source: "manual", runBy: session.profile.id });
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "merch.health_check_run",
    entityType: "platform_health",
    entityId: "merch_health",
    after: { status: out.report.status, summary: out.report.summary, saved: out.saved },
  });
  revalidatePath(MERCH_HEALTH_PAGE);
  if (!out.saved && out.notes.length > 0) return { ok: false, error: `${out.report.summary} (${out.notes.join("; ")})` };
  return { ok: true, status: out.report.status, summary: out.report.summary };
}

export async function saveTokenExpiryAction(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requirePermission("settings.manage");
  const date = String(formData.get("printfulTokenExpires") ?? "").trim();
  const r = await saveHealthSettings({ printfulTokenExpires: date }, session.profile.id);
  if (!r.ok) return r;
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "merch.health_settings_saved",
    entityType: "site_settings",
    entityId: "merch_health_settings",
    after: { printfulTokenExpires: date },
  });
  revalidatePath(MERCH_HEALTH_PAGE);
  return { ok: true };
}
