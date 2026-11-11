"use server";

/**
 * /admin/merch-studio/health: server actions (D232 slice M-2).
 *
 * Owner & admin only (settings.manage, the same gate as Platform health).
 *   - runMerchHealthNowAction: runs H-1..H-19 now and records a run (source
 *     "manual"). It never sends the email; that stays with the morning cron.
 *   - saveTokenExpiryAction: saves the Printful token's expiry date (Printful
 *     has no API that tells us, so the owner types it from the token list).
 *   - previewPrintfulWebhookAction / registerPrintfulWebhookAction (D232
 *     M-6, G-89): read Printful's webhook, then set it with all 5 events
 *     after the shop confirms Token C. The register step is audited
 *     (merch.webhook_registered) with the masked before/after.
 * All writes are audited.
 */
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { MERCH_HEALTH_PAGE } from "@/lib/merch/merch-health-core";
import { runMerchHealth, saveHealthSettings } from "@/lib/merch/merch-health-server";
import { applyWebhook, previewWebhook, type WebhookPreview } from "@/lib/merch/merch-webhook-server";

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

export async function previewPrintfulWebhookAction(): Promise<WebhookPreview> {
  await requirePermission("settings.manage");
  return previewWebhook();
}

export async function registerPrintfulWebhookAction(): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const session = await requirePermission("settings.manage");
  const r = await applyWebhook();
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: r.ok ? "merch.webhook_registered" : "merch.webhook_register_failed",
    entityType: "printful_webhook",
    entityId: "printful_webhook",
    before: r.before,
    after: r.ok ? { ...r.after, changes: r.changes } : { error: r.error },
  });
  revalidatePath(MERCH_HEALTH_PAGE);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, message: r.changes.length ? `Registered: ${r.changes.join(" ")}` : "Registered again; nothing needed changing." };
}
