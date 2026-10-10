"use server";

/**
 * R39 S4 — the vendor ACH card's buttons (needs bank info / opted out).
 * settings.manage only: managers who edit vendors never see or change
 * whether a vendor is paid by ACH (same rule as the vault badge, SLICE 94).
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { changeVendorAchFlag } from "@/lib/payments/vendor-ach-enrollment-store";

export async function changeVendorAchFlagAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const vendorId = String(formData.get("vendor_id") ?? "").trim();
  const action = String(formData.get("ach_action") ?? "").trim();
  const reason = String(formData.get("opt_out_reason") ?? "");
  // Return to the page the button was on (vendor page or the vault list), never an outside URL.
  const ret = String(formData.get("return_to") ?? "");
  const base = ret === "vault" ? "/admin/settings/banking?tab=vendors" : `/admin/vendors/${encodeURIComponent(vendorId)}`;
  const join = base.includes("?") ? "&" : "?";
  if (!vendorId) redirect(`/admin/settings/banking?tab=vendors&error=${encodeURIComponent("Missing vendor.")}`);

  const res = await changeVendorAchFlag({ vendorId, action, reason, actorId: session.profile.id, nowIso: new Date().toISOString() });
  if (!res.ok) redirect(`${base}${join}error=${encodeURIComponent(res.error)}`);

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: `vendor.ach_flag.${action}`,
    entityType: "vendor",
    entityId: vendorId,
    before: {
      ach_needs_bank_info: res.before.needsBankInfo,
      ach_opted_out: res.before.optedOut,
      ach_opted_out_reason: res.before.optedOutReason,
    },
    after: { ach_needs_bank_info: res.patch.ach_needs_bank_info, ach_opted_out: res.patch.ach_opted_out, ach_opted_out_reason: res.patch.ach_opted_out_reason },
  }).catch(() => {});

  revalidatePath(`/admin/vendors/${vendorId}`);
  revalidatePath("/admin/settings/banking");
  const note = `${res.vendorName || "Vendor"}: ${res.summary}`;
  if (ret === "vault") redirect(`${base}${join}msg=${encodeURIComponent(note)}`);
  redirect(`${base}${join}saved=1&note=${encodeURIComponent(note)}`);
}
