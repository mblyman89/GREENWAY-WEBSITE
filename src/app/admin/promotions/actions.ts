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
  listPromotions,
  detectConflicts,
  getPublishedPromotions,
  listSelectableProducts,
  listSavedAudiences,
  createSavedAudience,
  deleteSavedAudience,
  type PromotionInput,
  type RuleInput,
  type SavedAudience,
  type CreateAudienceResult,
} from "@/lib/promotions/promotions-store";
import {
  resolveSelection,
  describePredicate,
  type SelectionPredicate,
  type SelectionMatch,
} from "@/lib/promotions/promotion-selector-core";
import type {
  DiscountType,
  PostStatus,
  Weekday,
} from "@/lib/promotions/types";
import {
  generatePromotionCopy,
  isAiConfigured as isPromoAiConfigured,
} from "@/lib/promotions/ai-copy";
import { guardPromotionPublish, auditPublishedPromotions } from "@/lib/promotions/promo-guard";
import { formatMoneyMinor } from "@/lib/promotions/discount-engine-core";
import {
  generatePromotionsAdvice,
  isAiConfigured as isAdvisorAiConfigured,
  type PromotionsAdvice,
} from "@/lib/promotions/promotions-advisor";
// SLICE 39 connectivity audit: the engine-config AI drafter (built Slice 39 of
// the promotions track) was never callable from any page — now wired here.
import { draftEngineConfig } from "@/lib/promotions/engine-ai";
import type { EngineConfig } from "@/lib/promotions/discount-engine-core";

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

export type EngineConfigDraftResult =
  | { ok: true; config: EngineConfig; summary: string; }
  | { ok: false; error: string };

/**
 * SLICE 39: draft the structured discount-engine mechanics (tiers / BOGO /
 * basket / either-or) from a plain-English description. DRAFTS-ONLY — the
 * result only pre-fills the form's cfg_* inputs; nothing is saved until the
 * manager reviews and submits. Permission `promotions.manage`.
 */
export async function draftEngineConfigAction(input: {
  discountType: DiscountType;
  request: string;
}): Promise<EngineConfigDraftResult> {
  const session = await requirePermission("promotions.manage");

  if (!isPromoAiConfigured) {
    return {
      ok: false,
      error:
        "AI isn't set up yet. Add an AI_API_KEY in your environment to enable “Draft mechanics with AI.”",
    };
  }

  const discountType: DiscountType = DISCOUNT_TYPES.includes(input.discountType)
    ? input.discountType
    : "percent";
  const request = (input.request ?? "").trim().slice(0, 500);
  if (!request) {
    return { ok: false, error: "Describe the mechanics first (e.g. “buy 2 get 15% off, 4 or more get 25%”)." };
  }

  try {
    const { draft, config } = await draftEngineConfig({ discountType, request });

    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "promotion.ai_engine_config",
      entityType: "promotion",
      after: { discountType, request, config, summary: draft.summary },
    });

    return { ok: true, config, summary: draft.summary || "" };
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

/**
 * Parse tier rows out of repeated `${prefix}_at` / `${prefix}_percent` inputs.
 * `at` is qty (multi_item_tier), grams (weight_tier) or DOLLARS (threshold_spend
 * — converted to minor units by the caller).
 */
function parseTierRows(formData: FormData, prefix: string): { at: number; percent: number }[] {
  const ats = formData.getAll(`${prefix}_at`).map((v) => Number(v));
  const pcts = formData.getAll(`${prefix}_percent`).map((v) => Number(v));
  const tiers: { at: number; percent: number }[] = [];
  for (let i = 0; i < Math.min(ats.length, pcts.length); i++) {
    const at = ats[i];
    const percent = pcts[i];
    if (Number.isFinite(at) && at > 0 && Number.isFinite(percent) && percent > 0) {
      tiers.push({ at, percent: Math.min(99, Math.round(percent)) });
    }
  }
  return tiers.sort((a, b) => a.at - b.at);
}

/**
 * Build the structured mechanics config (promotions.config jsonb) from the
 * form. Only the fields relevant to the chosen discount type are stored so the
 * engine never sees stale mechanics from a previous type.
 */
function buildConfig(formData: FormData, discountType: DiscountType): Record<string, unknown> {
  const config: Record<string, unknown> = {};

  if (discountType === "multi_item_tier") {
    const qtyTiers = parseTierRows(formData, "cfg_qty_tier");
    if (qtyTiers.length) config.qtyTiers = qtyTiers;
    // Either/or (Doobie Tuesday style): flat percent OR bundle N-for-M,
    // whichever yields the SMALLER savings (store-advantaged).
    const flat = num(formData, "cfg_eo_flat");
    const n = Math.round(num(formData, "cfg_eo_n"));
    const m = Math.round(num(formData, "cfg_eo_m"));
    if (flat > 0 && n >= 2 && m >= 0 && m < n) {
      config.eitherOr = { flatPercent: Math.min(99, Math.round(flat)), bundle: { n, m } };
    }
  } else if (discountType === "weight_tier") {
    const weightTiers = parseTierRows(formData, "cfg_weight_tier");
    if (weightTiers.length) config.weightTiers = weightTiers;
  } else if (discountType === "threshold_spend") {
    const spendTiers = parseTierRows(formData, "cfg_spend_tier").map((t) => ({
      at: Math.round(t.at * 100), // form takes dollars; engine wants minor units
      percent: t.percent,
    }));
    if (spendTiers.length) config.spendTiers = spendTiers;
  } else if (discountType === "bogo") {
    const buyQty = Math.round(num(formData, "cfg_bogo_buy"));
    const getQty = Math.round(num(formData, "cfg_bogo_get"));
    const getPercent = Math.round(num(formData, "cfg_bogo_percent"));
    if (buyQty >= 1 && getQty >= 1 && getPercent > 0) {
      config.bogo = { buyQty, getQty, getPercent: Math.min(99, getPercent) };
    }
  } else if (discountType === "basket") {
    const mode = str(formData, "cfg_basket_mode");
    if (mode === "top_item") {
      const topPercent = Math.round(num(formData, "cfg_top_percent"));
      const restPercent = Math.round(num(formData, "cfg_rest_percent"));
      if (topPercent > 0) {
        config.basketTopItem = {
          topPercent: Math.min(99, topPercent),
          restPercent: Math.max(0, Math.min(99, restPercent)),
        };
      }
    } else {
      const n = Math.round(num(formData, "cfg_basket_n"));
      const m = Math.round(num(formData, "cfg_basket_m"));
      if (n >= 2 && m >= 0 && m < n) config.basketNforM = { n, m };
    }
  }

  return config;
}

function buildInput(formData: FormData): PromotionInput {
  const discountTypeRaw = str(formData, "discount_type") as DiscountType;
  const discount_type = DISCOUNT_TYPES.includes(discountTypeRaw) ? discountTypeRaw : "percent";
  const weekdayRaw = str(formData, "weekday");
  const weekday = weekdayRaw === "" ? null : Number(weekdayRaw);
  const multiRaw = str(formData, "multi_item_percent");

  return {
    config: buildConfig(formData, discount_type),
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

  // CCRS HARD BLOCK: a discount may not take the sale price below the cost of
  // acquisition (CCRS Upload User Guide, Sale.csv Discount; RCW 69.50.357).
  // Refuse to publish any promotion whose worst case would cross a product's
  // cost floor — the register clamp would silently break the advertised deal.
  if (status === "published") {
    const promo = await getPromotion(id);
    if (promo) {
      const guard = await guardPromotionPublish(promo);
      if (guard.blocked) {
        const hits = guard.findings.filter((f) => f.reason === "below_cost");
        const sample = hits
          .slice(0, 3)
          .map(
            (f) =>
              `${f.name} (floor ${formatMoneyMinor(f.floorMinorUnits)}, worst case ${formatMoneyMinor(f.worstCasePriceMinorUnits)})`,
          )
          .join("; ");
        const more = hits.length > 3 ? ` and ${hits.length - 3} more` : "";
        await recordAudit({
          actorId: session.userId,
          actorEmail: session.email,
          action: "promotion.publish_blocked",
          entityType: "promotion",
          entityId: id,
          after: {
            reason: "below_cost",
            blockedCount: hits.length,
            products: hits.slice(0, 20).map((f) => ({
              key: f.key,
              name: f.name,
              floorMinorUnits: f.floorMinorUnits,
              worstCasePriceMinorUnits: f.worstCasePriceMinorUnits,
            })),
          },
        });
        redirect(
          `/admin/promotions/${id}?error=${encodeURIComponent(
            `Publish blocked — ${hits.length} product${hits.length === 1 ? "" : "s"} would be discounted below acquisition cost (CCRS): ${sample}${more}. Raise the price, soften the discount, or exclude the product.`,
          )}`,
        );
      }
    }
  }

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
  // PROMOTIONS HARMONY (Task T / PR 1): the published-rules snapshot is loaded
  // in the ROOT LAYOUT (it prices the cart + card badges everywhere), so a
  // publish/unpublish must refresh every route that renders the layout.
  revalidatePath("/", "layout");
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

// ── AI advisor (drafts-only, aggregates only) ─────────────────────────────

export type PromotionsAdvisorResult =
  | { ok: true; advice: PromotionsAdvice }
  | { ok: false; error: string };

export async function generatePromotionsAdviceAction(
  question?: string,
): Promise<PromotionsAdvisorResult> {
  await requirePermission("promotions.manage");
  if (!isAdvisorAiConfigured) return { ok: false, error: "AI is not configured (set AI_API_KEY)." };
  try {
    const [promos, conflicts, audit, published] = await Promise.all([
      listPromotions(),
      detectConflicts(),
      auditPublishedPromotions(),
      getPublishedPromotions(),
    ]);
    const weekdays = new Set(published.filter((p) => p.weekday != null).map((p) => p.weekday));
    const advice = await generatePromotionsAdvice({
      totalPromotions: promos.length,
      published: promos.filter((p) => p.status === "published").length,
      drafts: promos.filter((p) => p.status === "draft").length,
      scheduled: promos.filter((p) => p.status === "scheduled").length,
      archived: promos.filter((p) => p.status === "archived").length,
      weekdaysCovered: weekdays.size,
      conflictsCount: conflicts.length,
      belowCostHits: audit.totals.belowCost,
      costUnknownHits: audit.totals.costUnknown,
      regularBelowCostHits: audit.totals.regularBelowCost,
      menuProducts: audit.productCount,
      costedProducts: audit.costedProductCount,
      aiQuestion: question ?? null,
    });
    return { ok: true, advice };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Advisor failed." };
  }
}

// ---------------------------------------------------------------------------
// PR-P2: deterministic selection brain — resolve a predicate + smart audiences
// ---------------------------------------------------------------------------

/**
 * Resolve a SelectionPredicate against the LIVE published menu and return the
 * exact matched products with per-match reasons + advisory warnings. Pure
 * resolution (no AI) — this is the validation table the manual rule builder
 * (and, in PR-P3, the AI selector) render before applying anything.
 */
export async function resolvePredicateAction(
  predicate: SelectionPredicate,
): Promise<{
  ok: true;
  description: string;
  matched: SelectionMatch[];
  totalMenu: number;
  warnings: string[];
}> {
  await requirePermission("promotions.manage");
  const products = await listSelectableProducts();
  const result = resolveSelection(products, predicate);
  return {
    ok: true,
    description: describePredicate(predicate),
    matched: result.matched,
    totalMenu: products.length,
    warnings: result.warnings,
  };
}

/** List saved smart audiences (named, reusable predicates). */
export async function listAudiencesAction(): Promise<SavedAudience[]> {
  await requirePermission("promotions.manage");
  return listSavedAudiences();
}

/** Save a smart audience. Returns a friendly error string on failure. */
export async function saveAudienceAction(input: {
  name: string;
  description?: string | null;
  predicate: SelectionPredicate;
}): Promise<CreateAudienceResult> {
  const session = await requirePermission("promotions.manage");
  const res = await createSavedAudience(
    input.name,
    input.description ?? null,
    input.predicate,
    session.userId,
  );
  if (res.ok) {
    await recordAudit({
      action: "promotion.audience.create",
      entityType: "promotion_saved_audience",
      entityId: res.id,
      after: { name: input.name.trim() },
    });
    revalidatePath("/admin/promotions");
  }
  return res;
}

/** Delete a smart audience. */
export async function deleteAudienceAction(id: string): Promise<{ ok: true }> {
  await requirePermission("promotions.manage");
  await deleteSavedAudience(id);
  revalidatePath("/admin/promotions");
  return { ok: true };
}
