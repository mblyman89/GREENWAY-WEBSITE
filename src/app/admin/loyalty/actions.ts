"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  enrollCustomer,
  adjustPoints,
  issueRedemption,
  updateConfig,
  upsertTier,
  deactivateTier,
  upsertPromotion,
  setPromotionActive,
} from "@/lib/loyalty/loyalty-store";
import {
  parseConfigDraft,
  parseTierDraft,
  parsePromoDraft,
  dollarsToMinor,
  percentToBps,
} from "@/lib/loyalty/loyalty-config-core";

export type LoyaltyActionResult = { ok: boolean; error?: string; errors?: string[] };

function intFromForm(form: FormData, key: string): number {
  const raw = String(form.get(key) ?? "").trim();
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

export async function enrollCustomerAction(form: FormData): Promise<void> {
  const session = await requirePermission("loyalty.manage");
  const customerId = String(form.get("customer_id") ?? "").trim();
  if (!customerId) return;
  const res = await enrollCustomer(customerId, session.userId);
  if (res.ok) {
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "loyalty.enroll",
      entityType: "loyalty_account",
      entityId: res.account.id,
    });
  }
  revalidatePath(`/admin/customers/${customerId}`);
}

export async function adjustPointsAction(form: FormData): Promise<void> {
  const session = await requirePermission("loyalty.manage");
  const accountId = String(form.get("account_id") ?? "").trim();
  const customerId = String(form.get("customer_id") ?? "").trim();
  const points = intFromForm(form, "points");
  const note = String(form.get("note") ?? "").trim() || "Manual adjustment";
  if (!accountId || points === 0) return;
  const res = await adjustPoints({ accountId, points, note, actorId: session.userId });
  if (res.ok) {
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "loyalty.adjust",
      entityType: "loyalty_account",
      entityId: accountId,
      after: { points, note },
    });
  }
  if (customerId) revalidatePath(`/admin/customers/${customerId}`);
}

export async function issueRedemptionAction(form: FormData): Promise<void> {
  const session = await requirePermission("loyalty.manage");
  const accountId = String(form.get("account_id") ?? "").trim();
  const customerId = String(form.get("customer_id") ?? "").trim();
  const points = intFromForm(form, "points");
  const channelRaw = String(form.get("channel") ?? "both").trim();
  const channel = (["sms", "email", "both"].includes(channelRaw) ? channelRaw : "both") as
    | "sms"
    | "email"
    | "both";
  if (!accountId || points <= 0) return;
  const res = await issueRedemption({ accountId, points, channel, actorId: session.userId });
  if (res.ok) {
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "loyalty.redeem",
      entityType: "loyalty_account",
      entityId: accountId,
      after: { points, code: res.code, valueMinor: res.valueMinor },
    });
  }
  if (customerId) revalidatePath(`/admin/customers/${customerId}`);
}

// ---------------------------------------------------------------------------
// Customizer actions (Slice 67 — item 2). All accept UI-friendly units
// (percent, dollars) and convert to the stored minor/bps units. Values are
// validated by the pure core before touching the database.
// ---------------------------------------------------------------------------

/** Save the program configuration (earn rate, point value, min redeem, etc.). */
export async function saveLoyaltyConfigAction(fd: FormData): Promise<LoyaltyActionResult> {
  const session = await requirePermission("loyalty.manage");
  const parsed = parseConfigDraft({
    pointsPerDollar: fd.get("pointsPerDollar"),
    // UI collects dollars-per-point; convert to minor units for validation.
    pointValueMinor: dollarsToMinor(fd.get("pointValueDollars")),
    minRedeemPoints: fd.get("minRedeemPoints"),
    signupBonusPoints: fd.get("signupBonusPoints"),
    codeExpiryDays: fd.get("codeExpiryDays"),
  });
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  const notes = String(fd.get("notes") ?? "").trim() || null;
  const res = await updateConfig({ ...parsed.value, notes }, session.userId);
  if (!res.ok) return { ok: false, error: res.error };
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "loyalty.config.update",
    entityType: "loyalty_config",
    entityId: "active",
    after: parsed.value,
  });
  revalidatePath("/admin/loyalty");
  return { ok: true };
}

/** Create or update a tier. UI collects a percent discount. */
export async function saveLoyaltyTierAction(fd: FormData): Promise<LoyaltyActionResult> {
  const session = await requirePermission("loyalty.manage");
  const id = String(fd.get("id") ?? "").trim() || null;
  const parsed = parseTierDraft({
    name: fd.get("name"),
    minPoints: fd.get("minPoints"),
    discountBps: percentToBps(fd.get("discountPercent")),
  });
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  const res = await upsertTier({ id, ...parsed.value });
  if (!res.ok) return { ok: false, error: res.error };
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: id ? "loyalty.tier.update" : "loyalty.tier.create",
    entityType: "loyalty_tier",
    entityId: id ?? parsed.value.name,
    after: parsed.value,
  });
  revalidatePath("/admin/loyalty");
  return { ok: true };
}

/** Retire (soft-delete) a tier. */
export async function deleteLoyaltyTierAction(fd: FormData): Promise<LoyaltyActionResult> {
  const session = await requirePermission("loyalty.manage");
  const id = String(fd.get("id") ?? "").trim();
  if (!id) return { ok: false, error: "Missing tier id." };
  const res = await deactivateTier(id);
  if (!res.ok) return { ok: false, error: res.error };
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "loyalty.tier.retire",
    entityType: "loyalty_tier",
    entityId: id,
  });
  revalidatePath("/admin/loyalty");
  return { ok: true };
}

/** Create or update a promotion. UI collects a multiplier (e.g. 2 => 2x). */
export async function saveLoyaltyPromotionAction(fd: FormData): Promise<LoyaltyActionResult> {
  const session = await requirePermission("loyalty.manage");
  const id = String(fd.get("id") ?? "").trim() || null;
  // Convert a human multiplier ("2" => 2.0x => 20000 bps).
  const multRaw = String(fd.get("multiplier") ?? "1").trim();
  const multNum = Number(multRaw);
  const multiplierBps = Number.isFinite(multNum) ? Math.round(multNum * 10000) : NaN;
  const parsed = parsePromoDraft({
    name: fd.get("name"),
    kind: fd.get("kind"),
    multiplierBps,
    flatBonusPoints: fd.get("flatBonusPoints"),
    hourStart: fd.get("hourStart"),
    hourEnd: fd.get("hourEnd"),
    isActive: fd.get("isActive"),
  });
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  const notes = String(fd.get("notes") ?? "").trim() || null;
  const res = await upsertPromotion({ id, ...parsed.value, notes, createdBy: session.userId });
  if (!res.ok) return { ok: false, error: res.error };
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: id ? "loyalty.promo.update" : "loyalty.promo.create",
    entityType: "loyalty_promotion",
    entityId: id ?? parsed.value.name,
    after: parsed.value,
  });
  revalidatePath("/admin/loyalty");
  return { ok: true };
}

/** Toggle a promotion active / paused. */
export async function toggleLoyaltyPromotionAction(fd: FormData): Promise<LoyaltyActionResult> {
  const session = await requirePermission("loyalty.manage");
  const id = String(fd.get("id") ?? "").trim();
  const isActive = String(fd.get("isActive") ?? "").trim() === "true";
  if (!id) return { ok: false, error: "Missing promotion id." };
  const res = await setPromotionActive(id, isActive);
  if (!res.ok) return { ok: false, error: res.error };
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: isActive ? "loyalty.promo.activate" : "loyalty.promo.pause",
    entityType: "loyalty_promotion",
    entityId: id,
  });
  revalidatePath("/admin/loyalty");
  return { ok: true };
}
