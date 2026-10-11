"use server";

/**
 * R39 S7 — staff side of vendor e-sign (send link, cancel, countersign,
 * reject, bulk invite). settings.manage only (owner + admin: Stephen and
 * Michael, owner Q1), the same rule as the vault and the ACH card.
 *
 * Redirect targets are built here from validated ids, never from input.
 * Audit rows carry ids, states, the masked email and last-4 only.
 */
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { resolveSiteBase } from "@/lib/auth/set-password-core";
import { planBulkInvites, VENDOR_BULK_MAX, VENDOR_BULK_PAUSE_MS, BULK_SKIP_LABELS, type BulkSkip } from "@/lib/payments/vendor-esign-app-core";
import { resendVendorMailer } from "@/lib/payments/vendor-esign-mail";
import {
  cancelVendorInvite,
  countersignVendorInvite,
  createVendorInvite,
  getVendorInvite,
  participationRows,
  rejectVendorInvite,
} from "@/lib/payments/vendor-esign-store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function str(fd: FormData, k: string): string {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
}

function vendorIdFrom(fd: FormData): string {
  const id = str(fd, "vendor_id").toLowerCase();
  if (!UUID.test(id)) redirect(`/admin/vendors?error=${encodeURIComponent("Unknown vendor.")}`);
  return id;
}

function back(vendorId: string, param: "ok" | "error", message: string): never {
  const key = param === "ok" ? "note" : "error";
  const extra = param === "ok" ? "saved=1&" : "";
  redirect(`/admin/vendors/${vendorId}?${extra}${key}=${encodeURIComponent(message.slice(0, 600))}#vendor-esign`);
}

async function siteBase(): Promise<string> {
  const h = await headers();
  return resolveSiteBase({
    envSiteUrl: process.env.NEXT_PUBLIC_SITE_URL,
    forwardedProto: h.get("x-forwarded-proto"),
    forwardedHost: h.get("x-forwarded-host"),
    host: h.get("host"),
  });
}

/** The invite must belong to the vendor in the form (no cross-vendor posting). */
async function inviteFor(fd: FormData, vendorId: string) {
  const id = str(fd, "invite_id").toLowerCase();
  const inv = UUID.test(id) ? await getVendorInvite(id) : null;
  if (!inv || inv.vendor_id !== vendorId) back(vendorId, "error", "That link no longer exists. Reload the page.");
  return inv;
}

function refresh(vendorId: string) {
  revalidatePath(`/admin/vendors/${vendorId}`);
  revalidatePath("/admin/settings/banking");
}

export async function sendVendorEsignLinkAction(fd: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const vendorId = vendorIdFrom(fd);
  const nowMs = Date.now();
  const res = await createVendorInvite({
    vendorId,
    actor: { id: session.profile.id, name: session.profile.full_name || session.email },
    recipientName: str(fd, "recipient_name"),
    email: str(fd, "email"),
    siteBase: await siteBase(),
    nowMs,
    mail: resendVendorMailer(),
    replaceExpired: true,
  });
  if (!res.ok) back(vendorId, "error", res.error);
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "vendor_esign.invite",
    entityType: "vendor_esign_invite",
    entityId: res.inviteId,
    before: null,
    after: { vendor_id: vendorId, to: res.masked, email_on_file: res.emailOnFile, mailed: res.mailed },
  }).catch(() => {});
  refresh(vendorId);
  if (!res.mailed) back(vendorId, "error", `The link was created but the email did not go (${res.mailDetail ?? "unknown"}). Cancel it and try again, or check RESEND_API_KEY / ORDER_EMAIL_FROM.`);
  back(vendorId, "ok", `Link emailed to ${res.masked}. It works for 14 days.${res.emailOnFile ? "" : " That address is NOT the one on the vendor record: the receipt also goes to the address on file."}`);
}

export async function cancelVendorEsignAction(fd: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const vendorId = vendorIdFrom(fd);
  const inv = await inviteFor(fd, vendorId);
  const res = await cancelVendorInvite({ invite: inv, actorId: session.profile.id, reason: str(fd, "reason"), nowMs: Date.now() });
  if (!res.ok) back(vendorId, "error", res.error);
  await recordAudit({ actorId: session.profile.id, actorEmail: session.email, action: "vendor_esign.cancel", entityType: "vendor_esign_invite", entityId: inv.id, before: { state: inv.state }, after: { state: "cancelled" } }).catch(() => {});
  refresh(vendorId);
  back(vendorId, "ok", "Link cancelled. It no longer opens.");
}

export async function countersignVendorEsignAction(fd: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const vendorId = vendorIdFrom(fd);
  const inv = await inviteFor(fd, vendorId);
  if (str(fd, "callback_done") !== "on") back(vendorId, "error", "Confirm you phoned the vendor's second contact at a number already on file (not one from the form or the email).");
  const res = await countersignVendorInvite({
    invite: inv,
    actor: { id: session.profile.id, name: session.profile.full_name || session.email, email: session.email },
    title: str(fd, "title"),
    note: str(fd, "note"),
    nowMs: Date.now(),
    mail: resendVendorMailer(),
  });
  if (!res.ok) back(vendorId, "error", res.error);
  await recordAudit({ actorId: session.profile.id, actorEmail: session.email, action: "vendor_esign.countersign", entityType: "vendor_esign_invite", entityId: inv.id, before: { state: "signed" }, after: { state: "countersigned", account_last4: inv.account_last4, vendor_mailed: res.mailed } }).catch(() => {});
  refresh(vendorId);
  back(vendorId, "ok", `Countersigned. The agreement is in effect${res.mailed ? " and the vendor was emailed the acceptance" : " (the vendor email did NOT go; send the acceptance by hand)"}.`);
}

export async function rejectVendorEsignAction(fd: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const vendorId = vendorIdFrom(fd);
  const inv = await inviteFor(fd, vendorId);
  const reason = str(fd, "reason");
  if (reason.length < 5) back(vendorId, "error", "Say why (at least 5 characters). The vendor is told to call; the reason stays internal.");
  const res = await rejectVendorInvite({ invite: inv, actorId: session.profile.id, reason });
  if (!res.ok) back(vendorId, "error", res.error);
  await recordAudit({ actorId: session.profile.id, actorEmail: session.email, action: "vendor_esign.reject", entityType: "vendor_esign_invite", entityId: inv.id, before: { state: "signed" }, after: { state: "rejected" } }).catch(() => {});
  refresh(vendorId);
  back(vendorId, "ok", "Rejected. The vendor keeps being paid by check. Put the vault record on hold or archive it in Banking if it should not be used.");
}

/**
 * Banking page: email a link to every eligible vendor (not opted out, not
 * already on ACH, no link out, an email on file). Sequential with a pause:
 * Resend allows 10 requests/second per team; at most VENDOR_BULK_MAX per press.
 */
export async function bulkInviteVendorsAction(fd: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const BASE = "/admin/settings/banking?tab=vendors";
  if (str(fd, "confirm") !== "on") redirect(`${BASE}&error=${encodeURIComponent("Tick the box to confirm the bulk email.")}`);
  const nowMs = Date.now();
  const part = await participationRows(nowMs);
  if (!part.ready) redirect(`${BASE}&error=${encodeURIComponent("Vendor e-sign is not set up yet: apply migration 0262 first.")}`);
  const plan = planBulkInvites(
    part.rows.map((r) => ({ vendorId: r.vendorId, name: r.name, email: r.email, active: r.active, optedOut: r.optedOut, achReady: r.achActive, openInvite: r.invite, openInviteExpired: r.inviteExpired })),
    VENDOR_BULK_MAX,
  );
  const base = await siteBase();
  const mail = resendVendorMailer();
  let sent = 0;
  const failed: string[] = [];
  for (const [i, t] of plan.send.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, VENDOR_BULK_PAUSE_MS));
    const res = await createVendorInvite({
      vendorId: t.vendorId,
      actor: { id: session.profile.id, name: session.profile.full_name || session.email },
      recipientName: `${t.name} accounts receivable`.slice(0, 120),
      email: t.email,
      siteBase: base,
      nowMs: Date.now(),
      mail,
      replaceExpired: t.cancelExpired,
    });
    if (res.ok && res.mailed) sent++;
    else failed.push(t.name);
    if (res.ok) {
      await recordAudit({ actorId: session.profile.id, actorEmail: session.email, action: "vendor_esign.invite_bulk", entityType: "vendor_esign_invite", entityId: res.inviteId, before: null, after: { vendor_id: t.vendorId, to: res.masked, mailed: res.mailed } }).catch(() => {});
    }
  }
  revalidatePath("/admin/settings/banking");
  const skips = (Object.keys(plan.skipped) as BulkSkip[]).filter((k) => plan.skipped[k] > 0).map((k) => `${plan.skipped[k]} ${BULK_SKIP_LABELS[k]}`);
  const msg =
    `Emailed ${sent} vendor${sent === 1 ? "" : "s"}.` +
    (failed.length ? ` Not sent: ${failed.slice(0, 8).join(", ")}${failed.length > 8 ? "..." : ""}.` : "") +
    (plan.overflow ? ` ${plan.overflow} more are eligible: press again to send the next batch.` : "") +
    (skips.length ? ` Skipped: ${skips.join("; ")}.` : "");
  redirect(`${BASE}&${failed.length ? "error" : "msg"}=${encodeURIComponent(msg.slice(0, 600))}`);
}
