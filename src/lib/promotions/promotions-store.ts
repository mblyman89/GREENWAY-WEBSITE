/**
 * src/lib/promotions/promotions-store.ts
 *
 * Server-side service for the Slice 6 Promotions/Specials manager.
 *
 * - Staff CRUD on promotions + their targets/exclusions.
 * - setStatus (draft/scheduled/published/archived) with a publish audit snapshot.
 * - Conflict detection: which products fall under more than one published promo.
 * - Affected-products preview: resolve a promotion's targets/exclusions against
 *   the currently PUBLISHED menu version (so staff see exactly what changes
 *   before publishing).
 * - Brand list pulled from the published menu (powers the Thursday brand picker).
 * - getPublishedPromotions(): the public reader, with a static fallback to the
 *   committed daily-deal seeds so the storefront never loses its deals.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { getPublishedVersion, getVersionItems } from "@/lib/pos/menu-version";
import { getEnrichmentsForKeys, mediaUrlsForIds } from "@/lib/enrichment/store";
import type { GreenwayCategory } from "@/lib/leafly/types";
import { DAILY_DEAL_SEEDS } from "./daily-deal-seed";
import type {
  SelectableProduct,
  SelectableCompound,
  SelectionPredicate,
} from "./promotion-selector-core";
import type {
  PromotionRow,
  PromotionTargetRow,
  PromotionExclusionRow,
  PromotionWithRules,
  PublishedPromotion,
  PostStatus,
  PromoScope,
} from "./types";

// ---------------------------------------------------------------------------
// Staff CRUD
// ---------------------------------------------------------------------------

export async function listPromotions(): Promise<PromotionRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("promotions")
    .select("*")
    .order("weekday", { ascending: true, nullsFirst: false })
    .order("priority", { ascending: false })
    .order("title", { ascending: true });
  return (data as PromotionRow[] | null) ?? [];
}

export async function getPromotion(id: string): Promise<PromotionWithRules | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data: promo } = await admin.from("promotions").select("*").eq("id", id).maybeSingle();
  if (!promo) return null;
  const [{ data: targets }, { data: exclusions }] = await Promise.all([
    admin.from("promotion_targets").select("*").eq("promotion_id", id),
    admin.from("promotion_exclusions").select("*").eq("promotion_id", id),
  ]);
  return {
    ...(promo as PromotionRow),
    targets: (targets as PromotionTargetRow[] | null) ?? [],
    exclusions: (exclusions as PromotionExclusionRow[] | null) ?? [],
  };
}

export type PromotionInput = {
  promo_key?: string | null;
  title: string;
  description?: string | null;
  discount_type: PromotionRow["discount_type"];
  discount_percent: number;
  discount_fixed: number;
  multi_item_percent?: number | null;
  config?: Record<string, unknown>;
  per_item_sale: boolean;
  bonus_note?: string | null;
  weekday?: number | null;
  starts_at?: string | null;
  ends_at?: string | null;
  priority: number;
};

export type RuleInput = { scope: PromoScope; value: string | null };

export async function createPromotion(
  input: PromotionInput,
  targets: RuleInput[],
  exclusions: RuleInput[],
  actorId: string,
): Promise<string | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("promotions")
    .insert({ ...input, created_by: actorId, updated_by: actorId })
    .select("id")
    .single();
  if (error || !data) return null;
  const id = (data as { id: string }).id;
  await replaceRules(id, targets, exclusions);
  return id;
}

export async function updatePromotion(
  id: string,
  input: PromotionInput,
  targets: RuleInput[],
  exclusions: RuleInput[],
  actorId: string,
): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  const admin = createSupabaseAdminClient();
  await admin
    .from("promotions")
    .update({ ...input, updated_by: actorId })
    .eq("id", id);
  await replaceRules(id, targets, exclusions);
}

async function replaceRules(
  promotionId: string,
  targets: RuleInput[],
  exclusions: RuleInput[],
): Promise<void> {
  const admin = createSupabaseAdminClient();
  await Promise.all([
    admin.from("promotion_targets").delete().eq("promotion_id", promotionId),
    admin.from("promotion_exclusions").delete().eq("promotion_id", promotionId),
  ]);
  if (targets.length > 0) {
    await admin
      .from("promotion_targets")
      .insert(targets.map((t) => ({ promotion_id: promotionId, scope: t.scope, value: t.value })));
  }
  if (exclusions.length > 0) {
    await admin
      .from("promotion_exclusions")
      .insert(
        exclusions.map((e) => ({ promotion_id: promotionId, scope: e.scope, value: e.value })),
      );
  }
}

export async function setPromotionStatus(
  id: string,
  status: PostStatus,
  actorId: string,
): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  const admin = createSupabaseAdminClient();
  const patch: Record<string, unknown> = { status, updated_by: actorId };
  if (status === "published") patch.published_at = new Date().toISOString();
  await admin.from("promotions").update(patch).eq("id", id);

  // On publish, take an immutable snapshot (rules + affected product keys).
  if (status === "published") {
    const promo = await getPromotion(id);
    if (promo) {
      const affected = await previewAffectedProducts(promo);
      await admin.from("promotion_audit_snapshots").insert({
        promotion_id: id,
        snapshot: { promotion: promo },
        affected_count: affected.length,
        taken_by: actorId,
      });
    }
  }
}

export async function deletePromotion(id: string): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  const admin = createSupabaseAdminClient();
  await admin.from("promotions").delete().eq("id", id); // cascades to rules + snapshots
}

// ---------------------------------------------------------------------------
// Menu-aware helpers (published menu version)
// ---------------------------------------------------------------------------

type MenuLite = {
  key: string;
  name: string;
  brand: string;
  categories: string[];
  priceMinorUnits: number;
};

async function loadPublishedMenuLite(): Promise<MenuLite[]> {
  if (!isSupabaseServiceConfigured) return [];
  const version = await getPublishedVersion();
  if (!version) return [];
  const items = await getVersionItems(version.id);
  return items.map((i) => ({
    key: i.source_item_id,
    name: i.name,
    brand: i.brand_name ?? "",
    categories: i.filter_categories?.length ? i.filter_categories : [i.category],
    priceMinorUnits: i.price_minor_units,
  }));
}

/** Distinct brand names from the published menu (for the Thursday selector). */
export async function listMenuBrands(): Promise<string[]> {
  const menu = await loadPublishedMenuLite();
  const set = new Set<string>();
  for (const item of menu) {
    if (item.brand.trim()) set.add(item.brand.trim());
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/** A single published-menu product, lightweight, for the include/exclude picker. */
export type MenuProductOption = {
  key: string;
  name: string;
  brand: string;
  categories: string[];
  priceMinorUnits: number;
};

/**
 * Every product in the currently published menu, for the individual-product
 * include/exclude picker on the promotion form. Empty when no menu is
 * published. Sorted by brand then name so the searchable list reads cleanly.
 */
export async function listMenuProducts(): Promise<MenuProductOption[]> {
  const menu = await loadPublishedMenuLite();
  return menu
    .map((i) => ({
      key: i.key,
      name: i.name,
      brand: i.brand,
      categories: i.categories,
      priceMinorUnits: i.priceMinorUnits,
    }))
    .sort((a, b) => {
      const byBrand = a.brand.localeCompare(b.brand);
      return byBrand !== 0 ? byBrand : a.name.localeCompare(b.name);
    });
}

// ---------------------------------------------------------------------------
// PR-P2: the SELECTABLE product adapter (rich attributes for the selector brain)
// ---------------------------------------------------------------------------

/** Parse a potency string ("22.4%", "100mg", "  18 % ") to a number, or null. */
function parsePotencyNumber(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const n = Number.parseFloat(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Coerce compounds_json (unknown) into numeric {type,value,unit} readings. */
function parseCompounds(raw: unknown): SelectableCompound[] {
  if (!Array.isArray(raw)) return [];
  const out: SelectableCompound[] = [];
  for (const c of raw) {
    if (c && typeof c === "object") {
      const type = String((c as Record<string, unknown>).type ?? "").trim();
      const value = parsePotencyNumber((c as Record<string, unknown>).value as string);
      const unit = String((c as Record<string, unknown>).unit ?? "").trim();
      if (type && value != null) out.push({ type, value, unit });
    }
  }
  return out;
}

/**
 * The published menu as SelectableProduct[] for the deterministic selection
 * brain (promotion-selector-core). Rich attributes: strain, cannabinoids,
 * weight, size labels, inventory, ratio, plus caller-friendly flags:
 *   - onSaleAlready: the product currently falls under a PUBLISHED promotion.
 *   - newArrival: heuristic — among the newest 15% of the menu by created_at.
 * Empty when no menu is published. Never throws (fail-safe to []).
 */
export async function listSelectableProducts(): Promise<SelectableProduct[]> {
  if (!isSupabaseServiceConfigured) return [];
  const version = await getPublishedVersion();
  if (!version) return [];
  const items = await getVersionItems(version.id);
  if (items.length === 0) return [];

  // Which product keys are already inside a published promotion? (best-effort)
  const onSaleKeys = new Set<string>();
  try {
    const published = await getPublishedPromotions();
    for (const promo of published) {
      // Build a lightweight PromotionWithRules-ish shape for previewAffected.
      const affected = await previewAffectedProducts({
        targets: [
          ...(promo.storewide ? [{ scope: "all" as PromoScope, value: null }] : []),
          ...promo.targetCategories.map((v) => ({ scope: "category" as PromoScope, value: v })),
          ...promo.targetBrands.map((v) => ({ scope: "brand" as PromoScope, value: v })),
          ...promo.targetProductKeys.map((v) => ({ scope: "product" as PromoScope, value: v })),
        ],
        exclusions: [
          ...promo.excludeCategories.map((v) => ({ scope: "category" as PromoScope, value: v })),
          ...promo.excludeBrands.map((v) => ({ scope: "brand" as PromoScope, value: v })),
          ...promo.excludeProductKeys.map((v) => ({ scope: "product" as PromoScope, value: v })),
        ],
      });
      for (const a of affected) onSaleKeys.add(a.key);
    }
  } catch {
    // On-sale enrichment is best-effort; never block the picker over it.
  }

  // New-arrival heuristic: newest ~15% by created_at (ties broken by sort_order).
  const sortedByAge = [...items].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  const newCount = Math.max(1, Math.floor(items.length * 0.15));
  const newArrivalKeys = new Set(sortedByAge.slice(0, newCount).map((i) => i.source_item_id));

  return items.map((i) => {
    const variantLabels = i.variants.map((v) => v.label).filter(Boolean);
    const invLevels = i.variants.map((v) => v.inventory_level).filter((n) => Number.isFinite(n));
    const minInventoryLevel = invLevels.length ? Math.min(...invLevels) : null;
    return {
      key: i.source_item_id,
      name: i.name,
      brand: i.brand_name ?? "",
      vendor: i.vendor_name ?? "",
      categories: i.filter_categories?.length ? i.filter_categories : [i.category],
      strainType: i.strain_type ?? "unknown",
      strainName: i.strain_name ?? null,
      priceMinorUnits: i.price_minor_units,
      netWeightGrams: i.net_weight_grams ?? null,
      variantLabels,
      minInventoryLevel,
      thcPercent: parsePotencyNumber(i.thc),
      cbdPercent: parsePotencyNumber(i.cbd),
      compounds: parseCompounds(i.compounds_json),
      ratioLabel: i.ratio_label ?? null,
      inventoryStatus: i.inventory_status,
      onSaleAlready: onSaleKeys.has(i.source_item_id),
      newArrival: newArrivalKeys.has(i.source_item_id),
    };
  });
}

// ---------------------------------------------------------------------------
// PR-P3: live menu "vocabulary" for the AI Smart Selector.
// Derived from the SAME source the predicate resolves against
// (listSelectableProducts), so any AI-drafted brand/category/vendor/strain/
// status that isn't in this vocabulary can be safely dropped — the AI can only
// reference things that are actually on the shelf. Fail-safe empty on error.
// ---------------------------------------------------------------------------

export type MenuVocabulary = {
  brands: string[];
  categories: string[];
  vendors: string[];
  strainTypes: string[];
  inventoryStatuses: string[];
};

export async function listMenuVocabulary(): Promise<MenuVocabulary> {
  try {
    const products = await listSelectableProducts();
    const brands = new Set<string>();
    const categories = new Set<string>();
    const vendors = new Set<string>();
    const strainTypes = new Set<string>();
    const inventoryStatuses = new Set<string>();
    for (const p of products) {
      if (p.brand) brands.add(p.brand);
      if (p.vendor) vendors.add(p.vendor);
      for (const c of p.categories) if (c) categories.add(c);
      if (p.strainType) strainTypes.add(p.strainType);
      if (p.inventoryStatus) inventoryStatuses.add(p.inventoryStatus);
    }
    const sorted = (s: Set<string>) => Array.from(s).sort((a, b) => a.localeCompare(b));
    return {
      brands: sorted(brands),
      categories: sorted(categories),
      vendors: sorted(vendors),
      strainTypes: sorted(strainTypes),
      inventoryStatuses: sorted(inventoryStatuses),
    };
  } catch {
    return { brands: [], categories: [], vendors: [], strainTypes: [], inventoryStatuses: [] };
  }
}

// ---------------------------------------------------------------------------
// PR-P2: saved "smart audiences" (named, reusable SelectionPredicates)
// ---------------------------------------------------------------------------

export type SavedAudience = {
  id: string;
  name: string;
  description: string | null;
  predicate: SelectionPredicate;
  createdAt: string;
};

/**
 * All saved smart audiences. Fail-safe: returns [] when the table does not yet
 * exist (migration 0154 not applied) or on any error — the UI simply shows "no
 * saved audiences yet" and the manual builder still works.
 */
export async function listSavedAudiences(): Promise<SavedAudience[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("promotion_saved_audiences")
      .select("id, name, description, predicate, created_at")
      .order("name", { ascending: true });
    if (error || !data) return [];
    return data.map((r) => ({
      id: r.id as string,
      name: (r.name as string) ?? "",
      description: (r.description as string | null) ?? null,
      predicate: ((r.predicate as SelectionPredicate) ?? {}) as SelectionPredicate,
      createdAt: (r.created_at as string) ?? "",
    }));
  } catch {
    return [];
  }
}

export type CreateAudienceResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

/**
 * Create a smart audience. Returns a friendly error (never throws) when the
 * table is missing (migration not yet run) or the name collides, so the UI can
 * surface a clear message.
 */
export async function createSavedAudience(
  name: string,
  description: string | null,
  predicate: SelectionPredicate,
  createdBy: string | null,
): Promise<CreateAudienceResult> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Give the audience a name." };
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Database not configured; cannot save audiences." };
  }
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("promotion_saved_audiences")
      .insert({ name: trimmed, description: description?.trim() || null, predicate, created_by: createdBy })
      .select("id")
      .single();
    if (error || !data) {
      // 23505 = unique_violation (duplicate name); 42P01 = undefined_table.
      if (error?.code === "23505") return { ok: false, error: `An audience named "${trimmed}" already exists.` };
      if (error?.code === "42P01") {
        return { ok: false, error: "Saved audiences aren't set up yet (migration 0154 not run)." };
      }
      return { ok: false, error: error?.message ?? "Could not save the audience." };
    }
    return { ok: true, id: data.id as string };
  } catch {
    return { ok: false, error: "Could not save the audience (unexpected error)." };
  }
}

/** Delete a saved audience. Best-effort; never throws. */
export async function deleteSavedAudience(id: string): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  try {
    const admin = createSupabaseAdminClient();
    await admin.from("promotion_saved_audiences").delete().eq("id", id);
  } catch {
    // best-effort
  }
}

function ruleMatches(
  item: MenuLite,
  rules: { scope: PromoScope; value: string | null }[],
): boolean {
  return rules.some((r) => {
    if (r.scope === "all") return true;
    if (r.scope === "category") return r.value ? item.categories.includes(r.value) : false;
    if (r.scope === "brand")
      return r.value ? item.brand.trim().toLowerCase() === r.value.trim().toLowerCase() : false;
    if (r.scope === "product") return r.value ? item.key === r.value : false;
    return false;
  });
}

export type AffectedProduct = {
  key: string;
  name: string;
  brand: string;
  priceMinorUnits: number;
  /** Resolved enrichment thumbnail URL when available (image-aware preview). */
  imageUrl?: string | null;
};

/**
 * Minimal structural shape previewAffectedProducts needs: just the target and
 * exclusion rules. PromotionWithRules satisfies this; so does an ad-hoc object
 * built from a PublishedPromotion's resolved arrays (listSelectableProducts).
 */
export type PromotionRuleSets = {
  targets: { scope: PromoScope; value: string | null }[];
  exclusions: { scope: PromoScope; value: string | null }[];
};

/** Products in the published menu a promotion would apply to (targets minus exclusions). */
export async function previewAffectedProducts(
  promo: PromotionRuleSets,
): Promise<AffectedProduct[]> {
  const menu = await loadPublishedMenuLite();
  if (menu.length === 0) return [];
  const targets = promo.targets.map((t) => ({ scope: t.scope, value: t.value }));
  const exclusions = promo.exclusions.map((e) => ({ scope: e.scope, value: e.value }));
  return menu
    .filter((item) => ruleMatches(item, targets) && !ruleMatches(item, exclusions))
    .map((item) => ({
      key: item.key,
      name: item.name,
      brand: item.brand,
      priceMinorUnits: item.priceMinorUnits,
    }));
}

/**
 * Like previewAffectedProducts, but batch-resolves each product's enrichment
 * thumbnail so the affected-products preview can show real photos instead of a
 * placeholder. Two extra batched queries total (enrichments-by-key, then
 * media-by-id) — no N+1. Falls back to imageUrl=null when a product has no
 * enrichment image yet.
 */
export async function previewAffectedProductsWithImages(
  promo: PromotionWithRules,
  limit = 60,
): Promise<AffectedProduct[]> {
  const base = await previewAffectedProducts(promo);
  if (base.length === 0) return base;

  // Only resolve images for the slice we'll actually render (keeps it cheap).
  const slice = base.slice(0, limit);
  const keys = slice.map((p) => p.key);
  const enrichments = await getEnrichmentsForKeys(keys);

  // Collect the primary media id per product (primary_media_id or first image).
  const primaryIdByKey = new Map<string, string>();
  const mediaIds = new Set<string>();
  for (const p of slice) {
    const e = enrichments.get(p.key);
    if (!e) continue;
    const primaryId = e.primary_media_id ?? e.image_media_ids?.[0] ?? null;
    if (primaryId) {
      primaryIdByKey.set(p.key, primaryId);
      mediaIds.add(primaryId);
    }
  }

  const urlById = await mediaUrlsForIds(Array.from(mediaIds));

  const withImages = base.map((p, i) => {
    if (i >= limit) return p;
    const mid = primaryIdByKey.get(p.key);
    return { ...p, imageUrl: mid ? urlById.get(mid) ?? null : null };
  });
  return withImages;
}

export type PromotionConflict = {
  productKey: string;
  productName: string;
  promotionIds: string[];
  promotionTitles: string[];
};

/**
 * Detect products that fall under MORE THAN ONE published promotion (so staff
 * can resolve overlaps before customers see conflicting badges).
 */
export async function detectConflicts(): Promise<PromotionConflict[]> {
  if (!isSupabaseServiceConfigured) return [];
  const menu = await loadPublishedMenuLite();
  if (menu.length === 0) return [];
  const promos = (await listPromotions()).filter((p) => p.status === "published");
  if (promos.length < 2) return [];

  const admin = createSupabaseAdminClient();
  const withRules: PromotionWithRules[] = [];
  for (const p of promos) {
    const [{ data: t }, { data: e }] = await Promise.all([
      admin.from("promotion_targets").select("*").eq("promotion_id", p.id),
      admin.from("promotion_exclusions").select("*").eq("promotion_id", p.id),
    ]);
    withRules.push({
      ...p,
      targets: (t as PromotionTargetRow[] | null) ?? [],
      exclusions: (e as PromotionExclusionRow[] | null) ?? [],
    });
  }

  const byProduct = new Map<string, { name: string; ids: string[]; titles: string[] }>();
  for (const item of menu) {
    for (const promo of withRules) {
      const targets = promo.targets.map((t) => ({ scope: t.scope, value: t.value }));
      const exclusions = promo.exclusions.map((x) => ({ scope: x.scope, value: x.value }));
      if (ruleMatches(item, targets) && !ruleMatches(item, exclusions)) {
        const entry = byProduct.get(item.key) ?? { name: item.name, ids: [], titles: [] };
        entry.ids.push(promo.id);
        entry.titles.push(`${promo.title}${promo.weekday !== null ? "" : " (dated)"}`);
        byProduct.set(item.key, entry);
      }
    }
  }

  const conflicts: PromotionConflict[] = [];
  for (const [key, v] of byProduct.entries()) {
    if (v.ids.length > 1) {
      conflicts.push({
        productKey: key,
        productName: v.name,
        promotionIds: v.ids,
        promotionTitles: v.titles,
      });
    }
  }
  return conflicts;
}

// ---------------------------------------------------------------------------
// Public reader (with static fallback to the committed daily-deal seeds)
// ---------------------------------------------------------------------------

function seedsToPublished(): PublishedPromotion[] {
  return DAILY_DEAL_SEEDS.map((s) => ({
    id: `seed-${s.promoKey}`,
    promoKey: s.promoKey,
    title: s.title,
    description: s.description,
    discountType: s.discountType,
    discountPercent: s.discountPercent,
    discountFixed: 0,
    multiItemPercent: s.multiItemPercent ?? null,
    perItemSale: s.perItemSale,
    bonusNote: s.bonusNote ?? null,
    weekday: s.weekday,
    startsAt: null,
    endsAt: null,
    priority: s.priority,
    targetCategories: (s.targetCategories ?? []) as GreenwayCategory[],
    targetBrands: s.targetBrands ?? [],
    targetProductKeys: [],
    storewide: Boolean(s.storewide),
    excludeCategories: [],
    excludeBrands: [],
    excludeProductKeys: [],
  }));
}

function rowToPublished(
  p: PromotionRow,
  targets: PromotionTargetRow[],
  exclusions: PromotionExclusionRow[],
): PublishedPromotion {
  const cats = (scope: PromoScope, rules: { scope: PromoScope; value: string | null }[]) =>
    rules.filter((r) => r.scope === scope && r.value).map((r) => r.value as string);
  return {
    id: p.id,
    promoKey: p.promo_key,
    title: p.title,
    description: p.description,
    discountType: p.discount_type,
    discountPercent: Number(p.discount_percent),
    discountFixed: p.discount_fixed,
    multiItemPercent: p.multi_item_percent !== null ? Number(p.multi_item_percent) : null,
    perItemSale: p.per_item_sale,
    bonusNote: p.bonus_note,
    weekday: p.weekday,
    startsAt: p.starts_at,
    endsAt: p.ends_at,
    priority: p.priority,
    targetCategories: cats("category", targets) as GreenwayCategory[],
    targetBrands: cats("brand", targets),
    targetProductKeys: cats("product", targets),
    storewide: targets.some((t) => t.scope === "all"),
    excludeCategories: cats("category", exclusions) as GreenwayCategory[],
    excludeBrands: cats("brand", exclusions),
    excludeProductKeys: cats("product", exclusions),
  };
}

/**
 * All PUBLISHED promotions for the public front-end / cart engine, normalized
 * into PublishedPromotion. Falls back to the committed daily-deal seeds when
 * the DB is empty or unconfigured so the storefront never loses its deals.
 */
export async function getPublishedPromotions(): Promise<PublishedPromotion[]> {
  if (!isSupabaseServiceConfigured) return seedsToPublished();
  const admin = createSupabaseAdminClient();
  const { data: promos } = await admin
    .from("promotions")
    .select("*")
    .eq("status", "published")
    .order("priority", { ascending: false });
  const rows = (promos as PromotionRow[] | null) ?? [];
  if (rows.length === 0) return seedsToPublished();

  const ids = rows.map((r) => r.id);
  const [{ data: targets }, { data: exclusions }] = await Promise.all([
    admin.from("promotion_targets").select("*").in("promotion_id", ids),
    admin.from("promotion_exclusions").select("*").in("promotion_id", ids),
  ]);
  const tRows = (targets as PromotionTargetRow[] | null) ?? [];
  const eRows = (exclusions as PromotionExclusionRow[] | null) ?? [];
  return rows.map((p) =>
    rowToPublished(
      p,
      tRows.filter((t) => t.promotion_id === p.id),
      eRows.filter((e) => e.promotion_id === p.id),
    ),
  );
}

/** Convenience: the published promotion active for a given weekday (0=Sun..6=Sat). */
export async function getPublishedPromotionForWeekday(
  weekday: number,
): Promise<PublishedPromotion | null> {
  const all = await getPublishedPromotions();
  const matches = all.filter((p) => p.weekday === weekday);
  if (matches.length === 0) return null;
  return matches.sort((a, b) => b.priority - a.priority)[0];
}
