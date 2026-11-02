"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  enrollCustomer,
  adjustPoints,
  issueRedemption,
  cancelRedemption,
  updateConfig,
  renameTier,
  listTiersForEdit,
  upsertPromotion,
  setPromotionActive,
} from "@/lib/loyalty/loyalty-store";
import { rewardForPoints, rewardShortLabel } from "@/lib/loyalty/loyalty-reward-core";
import { computeLoyaltyMetrics } from "@/lib/loyalty/loyalty-metrics";
import {
  generateLoyaltyAdvice,
  isAiConfigured as isAdvisorAiConfigured,
  type LoyaltyAdvice,
} from "@/lib/loyalty/loyalty-advisor";
import {
  parseConfigDraft,
  parseTierName,
  parsePromoDraft,
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

/**
 * D137: issue a reward CODE from a customer's page for them to bring in (or to
 * be texted/emailed). Only the two fixed rewards exist — 150 pts (10% off)
 * or 300 pts (25% off); exactly that many points come off the balance now
 * and come back if the code is cancelled.
 */
export async function issueRedemptionAction(form: FormData): Promise<void> {
  const session = await requirePermission("loyalty.manage");
  const accountId = String(form.get("account_id") ?? "").trim();
  const customerId = String(form.get("customer_id") ?? "").trim();
  const reward = rewardForPoints(intFromForm(form, "rewardPoints"));
  if (!accountId || !reward) return;
  const res = await issueRedemption({
    accountId,
    points: reward.points,
    channel: "profile",
    actorId: session.userId,
  });
  if (res.ok) {
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "loyalty.reward_code.issue",
      entityType: "loyalty_account",
      entityId: accountId,
      after: { points: reward.points, percentBps: reward.percentBps, reward: rewardShortLabel(reward), code: res.code },
    });
  }
  if (customerId) revalidatePath(`/admin/customers/${customerId}`);
}

/**
 * D141: cancel an unused reward code and give its points back. Conditional
 * on the code still being open, so a code that was just used at the
 * register can never be refunded as well.
 */
export async function cancelRedemptionAction(form: FormData): Promise<void> {
  const session = await requirePermission("loyalty.manage");
  const redemptionId = String(form.get("redemption_id") ?? "").trim();
  const customerId = String(form.get("customer_id") ?? "").trim();
  if (!redemptionId) return;
  const res = await cancelRedemption({
    redemptionId,
    note: "Reward code cancelled from the customer page — points returned",
    actorId: session.userId,
  });
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: res.ok ? "loyalty.reward_code.cancel" : "loyalty.reward_code.cancel_failed",
    entityType: "loyalty_redemption",
    entityId: redemptionId,
    after: res.ok ? { code: res.code, refundedPoints: res.refundedPoints } : { error: res.error },
  });
  if (customerId) revalidatePath(`/admin/customers/${customerId}`);
}

// ---------------------------------------------------------------------------
// Customizer actions (Slice 67 — item 2). All accept UI-friendly units
// (percent, dollars) and convert to the stored minor/bps units. Values are
// validated by the pure core before touching the database.
// ---------------------------------------------------------------------------

/** Save the program configuration (earn rate, signup bonus, code expiry). D138: no point value. */
export async function saveLoyaltyConfigAction(fd: FormData): Promise<LoyaltyActionResult> {
  const session = await requirePermission("loyalty.manage");
  const parsed = parseConfigDraft({
    pointsPerDollar: fd.get("pointsPerDollar"),
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
  // USAGE-5: the public /loyalty page (revalidate = 60) advertises THESE
  // numbers, so a saved change must clear it too — the TTL is only the floor.
  revalidatePath("/loyalty");
  return { ok: true };
}

/**
 * D139 (owner, 2026-11-02): "bronze and gold stay as names only … i would
 * like the ability to change their names". Renames a member badge. Nothing
 * else about a badge is editable any more — badges carry no discount.
 */
export async function renameLoyaltyTierAction(fd: FormData): Promise<LoyaltyActionResult> {
  const session = await requirePermission("loyalty.manage");
  const id = String(fd.get("id") ?? "").trim();
  if (!id) return { ok: false, error: "Missing badge id." };
  const others = (await listTiersForEdit()).filter((t) => t.id !== id && t.isActive).map((t) => t.name);
  const parsed = parseTierName(fd.get("name"), { otherNames: others });
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  const res = await renameTier(id, parsed.value);
  if (!res.ok) return { ok: false, error: res.error };
  if (res.before !== parsed.value) {
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "loyalty.tier.rename",
      entityType: "loyalty_tier",
      entityId: id,
      before: { name: res.before },
      after: { name: parsed.value },
    });
  }
  // The badge name shows in the back office, on customer pages, at the
  // register (next sale lookup) and on the public /loyalty page.
  revalidatePath("/admin/loyalty");
  revalidatePath("/admin/customers", "layout");
  revalidatePath("/loyalty");
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

// ── AI advisor (drafts-only, aggregates only) — Task S-a ────────────────────

export type LoyaltyAdvisorResult =
  | { ok: true; advice: LoyaltyAdvice }
  | { ok: false; error: string };

export async function generateLoyaltyAdviceAction(
  question?: string,
): Promise<LoyaltyAdvisorResult> {
  await requirePermission("loyalty.view");
  if (!isAdvisorAiConfigured) return { ok: false, error: "AI is not configured (set AI_API_KEY)." };
  try {
    const metrics = await computeLoyaltyMetrics();
    const advice = await generateLoyaltyAdvice(metrics, question ?? null);
    return { ok: true, advice };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Advisor failed." };
  }
}
