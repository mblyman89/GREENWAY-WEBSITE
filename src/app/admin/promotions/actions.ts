"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  createPromotion,
  updatePromotion,
  setPromotionStatus,
  deletePromotion,
  getPromotion,
  type PromotionInput,
  type RuleInput,
} from "@/lib/promotions/promotions-store";
import type {
  DiscountType,
  PostStatus,
  PromoScope,
  Weekday,
} from "@/lib/promotions/types";
import {
  generatePromotionCopy,
  isAiConfigured as isPromoAiConfigured,
} from "@/lib/promotions/ai-copy";

export type PromotionCopyResult =
  | {
      ok: true;
      title: string;
      description: string;
      badgeNote: string;
      complianceFlags: string[];
      model: string;
    }
  | { ok: false; error: string };

export type PromotionCopyInput = {
  discountType: DiscountType;
  discountPercent?: number | null;
  discountFixedMinor?: number | null;
  weekday?: Weekday | null;
  appliesTo?: string | null;
  currentTitle?: string | null;
  currentDescription?: string | null;
  instruction?: string | null;
};

/**
 * Generate an AI DRAFT of a promotion's name + announcement + badge from the
 * mechanics already chosen on the form. Returns the three pieces to the client
 * for Use / Edit / Discard — never saves. Drafts-only gate, permission
 * `promotions.manage`.
 */
export async function suggestPromotionCopyAction(
  input: PromotionCopyInput,
): Promise<PromotionCopyResult> {
  const session = await requirePermission("promotions.manage");

  if (!isPromoAiConfigured) {
    return {
      ok: false,
      error:
        "AI isn't set up yet. Add an AI_API_KEY in your environment to enable “Write the copy with AI.”",
    };
  }

  try {
    const suggestion = await generatePromotionCopy(
      {
        discountType: input.discountType,
        discountPercent: input.discountPercent ?? null,
        discountFixedMinor: input.discountFixedMinor ?? null,
        weekday: input.weekday ?? null,
        appliesTo: input.appliesTo?.trim() || null,
        currentTitle: input.currentTitle?.trim() || null,
        currentDescription: input.currentDescription?.trim() || null,
        instruction: input.instruction?.trim() || null,
      },
      { actorId: session.userId, actorEmail: session.email },
    );

    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "promotion.ai_copy",
      entityType: "promotion",
      after: { model: suggestion.model, flags: suggestion.complianceFlags },
    });

    return {
      ok: true,
      title: suggestion.title,
      description: suggestion.description,
      badgeNote: suggestion.badgeNote,
      complianceFlags: suggestion.complianceFlags,
      model: suggestion.model,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "AI request failed. Please try again.";
    return { ok: false, error: message };
  }
}

const DISCOUNT_TYPES: DiscountType[] = [
  "percent",
  "fixed",
  "bogo",
  "threshold_spend",
  "multi_item_tier",
  "weight_tier",
  "basket",
];

function num(formData: FormData, key: string, fallback = 0): number {
  const raw = formData.get(key);
  if (raw === null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

/**
 * Parse rule rows out of the form. Brand multi-selects (Thursday selector) come
 * in as repeated `${prefix}_brand` values; categories as `${prefix}_category`;
 * a storewide checkbox as `${prefix}_scope=all`.
 */
function parseRules(formData: FormData, prefix: "target" | "exclude"): RuleInput[] {
  const rules: RuleInput[] = [];

  for (const scope of formData.getAll(`${prefix}_scope`).map(String)) {
    if (scope === "all") rules.push({ scope: "all", value: null });
  }
  for (const b of formData.getAll(`${prefix}_brand`).map(String)) {
    const value = b.trim();
    if (value) rules.push({ scope: "brand", value });
  }
  for (const c of formData.getAll(`${prefix}_category`).map(String)) {
    const value = c.trim();
    if (value) rules.push({ scope: "category", value });
  }
  for (const p of formData.getAll(`${prefix}_product`).map(String)) {
    const value = p.trim();
    if (value) rules.push({ scope: "product", value });
  }

  const seen = new Set<string>();
  return rules.filter((r) => {
    const key = `${r.scope}:${r.value ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildInput(formData: FormData): PromotionInput {
  const discountTypeRaw = str(formData, "discount_type") as DiscountType;
  const discount_type = DISCOUNT_TYPES.includes(discountTypeRaw) ? discountTypeRaw : "percent";
  const weekdayRaw = str(formData, "weekday");
  const weekday = weekdayRaw === "" ? null : Number(weekdayRaw);
  const multiRaw = str(formData, "multi_item_percent");

  return {
    promo_key: str(formData, "promo_key") || null,
    title: str(formData, "title"),
    description: str(formData, "description") || null,
    discount_type,
    discount_percent: num(formData, "discount_percent"),
    discount_fixed: Math.round(num(formData, "discount_fixed")),
    multi_item_percent: multiRaw === "" ? null : Number(multiRaw),
    per_item_sale: formData.get("per_item_sale") === "on",
    bonus_note: str(formData, "bonus_note") || null,
    weekday: weekday !== null && weekday >= 0 && weekday <= 6 ? weekday : null,
    starts_at: str(formData, "starts_at") || null,
    ends_at: str(formData, "ends_at") || null,
    priority: Math.round(num(formData, "priority", 0)),
  };
}

export async function createPromotionAction(formData: FormData): Promise<void> {
  const session = await requirePermission("promotions.manage");
  const input = buildInput(formData);
  if (!input.title) redirect("/admin/promotions/new?error=Title+is+required");

  const targets = parseRules(formData, "target");
  const exclusions = parseRules(formData, "exclude");
  const id = await createPromotion(input, targets, exclusions, session.userId);
  if (!id) redirect("/admin/promotions/new?error=Could+not+create+promotion");

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "promotion.create",
    entityType: "promotion",
    entityId: id,
    after: { ...input, targets, exclusions },
  });
  revalidatePath("/admin/promotions");
  redirect(`/admin/promotions/${id}?saved=1`);
}

export async function updatePromotionAction(formData: FormData): Promise<void> {
  const session = await requirePermission("promotions.manage");
  const id = str(formData, "id");
  if (!id) redirect("/admin/promotions");
  const existing = await getPromotion(id);
  if (!existing) redirect("/admin/promotions");

  const input = buildInput(formData);
  if (!input.title) redirect(`/admin/promotions/${id}?error=Title+is+required`);

  const targets = parseRules(formData, "target");
  const exclusions = parseRules(formData, "exclude");
  await updatePromotion(id, input, targets, exclusions, session.userId);

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "promotion.update",
    entityType: "promotion",
    entityId: id,
    before: { title: existing.title, status: existing.status },
    after: { ...input, targets, exclusions },
  });
  revalidatePath("/admin/promotions");
  revalidatePath(`/admin/promotions/${id}`);
  redirect(`/admin/promotions/${id}?saved=1`);
}

export async function setPromotionStatusAction(formData: FormData): Promise<void> {
  const session = await requirePermission("promotions.manage");
  const id = str(formData, "id");
  const status = str(formData, "status") as PostStatus;
  if (!id) redirect("/admin/promotions");

  await setPromotionStatus(id, status, session.userId);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: `promotion.${status}`,
    entityType: "promotion",
    entityId: id,
    after: { status },
  });
  revalidatePath("/admin/promotions");
  revalidatePath(`/admin/promotions/${id}`);
  // Promotions feed the storefront menu/specials — refresh those too.
  revalidatePath("/specials");
  revalidatePath("/menu");
  redirect(`/admin/promotions/${id}?status=${status}`);
}

export async function deletePromotionAction(formData: FormData): Promise<void> {
  const session = await requirePermission("promotions.manage");
  const id = str(formData, "id");
  if (!id) redirect("/admin/promotions");
  await deletePromotion(id);
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "promotion.delete",
    entityType: "promotion",
    entityId: id,
  });
  revalidatePath("/admin/promotions");
  redirect("/admin/promotions?deleted=1");
}
