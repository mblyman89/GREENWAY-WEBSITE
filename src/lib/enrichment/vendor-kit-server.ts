/**
 * src/lib/enrichment/vendor-kit-server.ts  (D244 R-8)
 *
 * The reads and the one write behind /admin/products/vendor-kits.
 * Owner (round 3, verbatim): "Many vendors use the same non labeled images
 * for all their like kind products. I want to be able to sort the vendors by
 * type/ category so I can pick a generic on brand image and add it to all
 * their like kind products that would use this image. I want the ai to help
 * with this."
 *
 * Reads: every live card with its TRUE vendor (the worklist's resolution,
 * worklist-core resolveCardVendor) and on-hand quantity; the vendor's / its
 * brands' photos plus a search for the group's type; the ranking is pure
 * (vendor-kit-core rankKitPhotos). The AI check (vision model) only READS
 * and returns verdicts. The write (applyKitPhoto) is one person's press:
 * attach to each ticked card, cover when it has none (or always, if asked),
 * the photo-first publish rule, and one audit row per card.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { getPublishedVersion, getVersionItems } from "@/lib/pos/menu-version";
import { ensureEnrichment, getEnrichment, getEnrichmentsForKeys, resolveEnrichmentsForItems, updateEnrichment } from "@/lib/enrichment/store";
import { readEnrichmentAttribution } from "@/lib/enrichment/enrichment-manifest";
import { cardLotKeys } from "@/lib/inventory/vendor-identity-core";
import { readOnHandLots, readWorklistVendorData } from "@/lib/enrichment/worklist-server";
import { isOnHandCard, onHandByCard, resolveCardVendor, vendorProgress, type VendorProgress } from "@/lib/enrichment/worklist-core";
import { readLibraryAssetsByIds, readLibraryPickerAssets, readSearchHitAssets } from "@/lib/media/library-picker-server";
import { getMedia, recordUsage } from "@/lib/media/store";
import { attachImageToGallery, setPrimaryImage } from "@/lib/ai/kb/product-images-core";
import { rememberImageAttach } from "@/lib/catalog/image-memory-server";
import { enrichmentIdentityForItem } from "@/lib/enrichment/enrichment-identity-core";
import { publishOnPhoto } from "@/lib/enrichment/publish-on-photo-server";
import { recordAudit } from "@/lib/auth/audit";
import { generateVisionJson } from "@/lib/ai/provider";
import { mediaAiModel } from "@/lib/media/media-describe-store";
import type { MenuItemWithVariants } from "@/lib/pos/menu-version";
import { identitySemanticCategory } from "@/lib/enrichment/product-identity-core";
import {
  KIT_AI_CHECK_MAX,
  KIT_CHECK_SYSTEM,
  kitApplyMessage,
  kitApplyPlan,
  kitCheckUserPrompt,
  kitGroupCards,
  kitGroups,
  parseKitCheck,
  rankKitPhotos,
  type KitApplyMode,
  type KitCard,
  type KitGroup,
  type KitGroupBy,
  type KitPhoto,
  type KitVerdict,
} from "@/lib/enrichment/vendor-kit-core";

export type KitSession =
  | { ok: false; reason: string }
  | {
      ok: true;
      vendors: VendorProgress[];
      vendorId: string;
      vendorLabel: string;
      groups: KitGroup[];
      group: KitGroup | null;
      cards: KitCard[];
      photos: KitPhoto[];
    };

type Loaded = { items: MenuItemWithVariants[]; cards: Map<string, KitCard & { vendorId: string | null }>; vendors: VendorProgress[]; labels: Map<string, string> };

async function loadCards(): Promise<Loaded | { error: string }> {
  if (!isSupabaseServiceConfigured) return { error: "The database is not configured." };
  const published = await getPublishedVersion().catch(() => null);
  if (!published) return { error: "No published menu yet. Run an inventory sync first." };
  const items = await getVersionItems(published.id);
  const keys = items.map((i) => i.source_item_id);
  const [vendorData, onHandLots, ownEnrichments, attribution] = await Promise.all([
    readWorklistVendorData(),
    readOnHandLots(Array.from(new Set(items.flatMap((i) => cardLotKeys(i))))),
    getEnrichmentsForKeys(keys),
    readEnrichmentAttribution(items),
  ]);
  if (!vendorData) return { error: "The vendor list could not be read just now. Refresh to try again." };
  const { byKey: enrichments } = await resolveEnrichmentsForItems(items, ownEnrichments).catch(() => ({ byKey: ownEnrichments }));
  const attrs = attribution?.attrs ?? null;
  const qty = onHandLots ? onHandByCard(items.map((i) => ({ posKey: i.source_item_id, lotKeys: cardLotKeys(i) })), onHandLots) : null;
  const cards = new Map<string, KitCard & { vendorId: string | null }>();
  for (const i of items) {
    const e = enrichments.get(i.source_item_id) ?? null;
    const vendorId = resolveCardVendor(
      { ownVendorId: e?.vendor_id ?? null, attrVendorIds: attrs?.get(i.source_item_id)?.vendorIds ?? null, brandName: i.brand_name, posVendorName: i.vendor_name },
      vendorData,
    ).vendorId;
    cards.set(i.source_item_id, {
      key: i.source_item_id,
      name: e?.display_name || i.product_name || i.name,
      brand: i.brand_name || null,
      category: i.category,
      posCategory: i.pos_inventory_category,
      strainName: i.strain_name,
      onHand: isOnHandCard(i.inventory_status, qty ? (qty.get(i.source_item_id) ?? 0) : null),
      status: e?.status ?? null,
      galleryIds: e?.image_media_ids ?? [],
      coverId: e?.primary_media_id ?? null,
      vendorId,
    });
  }
  const vendors = vendorProgress(
    [...cards.values()].map((c) => ({
      key: c.key,
      vendorId: c.vendorId,
      inventoryStatus: c.onHand ? "in-stock" : "unavailable",
      lotQty: null,
      enrichmentStatus: c.status,
      hasImage: c.galleryIds.length > 0 || Boolean(c.coverId),
      hasDescription: true,
    })),
    vendorData.labels,
  );
  return { items, cards, vendors, labels: vendorData.labels };
}

/** The vendor's brand cards (for "on brand": a photo filed under one of its brands). */
async function vendorBrandIds(vendorId: string): Promise<string[]> {
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin.from("brands").select("id").eq("vendor_id", vendorId).range(0, 199);
    return ((data as { id: string }[] | null) ?? []).map((r) => r.id);
  } catch {
    return [];
  }
}

export async function loadKitSession(p: { vendor: string; by: KitGroupBy; group: string; verdicts: ReadonlyMap<string, KitVerdict> }): Promise<KitSession> {
  const l = await loadCards();
  if ("error" in l) return { ok: false, reason: l.error };
  const vendorId = p.vendor && p.vendor !== "none" ? p.vendor : "";
  const vp = l.vendors.find((v) => v.id === vendorId) ?? null;
  const base = { ok: true as const, vendors: l.vendors.filter((v) => v.id !== "none"), vendorId, vendorLabel: vp?.label ?? "" };
  if (!vendorId || !vp) return { ...base, groups: [], group: null, cards: [], photos: [] };
  const mine = [...l.cards.values()].filter((c) => c.vendorId === vendorId);
  const groups = kitGroups(mine, p.by);
  const group = groups.find((g) => g.key === p.group) ?? null;
  if (!group) return { ...base, groups, group: null, cards: [], photos: [] };
  const cards = kitGroupCards(mine, p.by, group.key);
  const brandIds = await vendorBrandIds(vendorId);
  const typeQ = `${vp.label} ${identitySemanticCategory({ category: cards[0]?.category ?? "" })}`.trim();
  const inUse = [...new Set(cards.flatMap((c) => [c.coverId, ...c.galleryIds]).filter((x): x is string => Boolean(x)))];
  const [shelf, hits, used] = await Promise.all([
    readLibraryPickerAssets("all", { vendorIds: [vendorId], brandIds }),
    readSearchHitAssets(typeQ, 40),
    readLibraryAssetsByIds(inUse),
  ]);
  const scoped = shelf.assets.filter((a) => a.vendor_id === vendorId || (a.brand_id && brandIds.includes(a.brand_id)));
  const photos = rankKitPhotos({ assets: [...used, ...scoped, ...hits], cards, vendorId, brandIds, form: group.form, verdicts: p.verdicts });
  return { ...base, groups, group, cards, photos };
}

/** "Ask the AI": the vision model checks the top photos for a printed product name. READ ONLY. */
export async function checkKitPhotos(p: {
  vendorLabel: string;
  groupLabel: string;
  products: readonly string[];
  mediaIds: readonly string[];
  actorId: string | null;
}): Promise<{ ok: true; verdicts: Map<string, KitVerdict>; failed: number } | { ok: false; error: string }> {
  const ids = [...new Set(p.mediaIds)].slice(0, KIT_AI_CHECK_MAX);
  if (ids.length === 0) return { ok: false, error: "There are no photos to check." };
  const assets = await readLibraryAssetsByIds(ids);
  const verdicts = new Map<string, KitVerdict>();
  let failed = 0;
  await Promise.all(
    assets.map(async (a) => {
      if (!a.url) {
        failed += 1;
        return;
      }
      try {
        const out = await generateVisionJson({
          system: KIT_CHECK_SYSTEM,
          user: kitCheckUserPrompt({ vendor: p.vendorLabel, group: p.groupLabel, products: p.products }),
          imageUrl: a.url,
          model: mediaAiModel(),
          detail: "high",
          maxTokens: 600,
          context: { feature: "product.vendor_kit.check", entityType: "media", entityId: a.id, actorId: p.actorId },
        });
        const v = parseKitCheck(out.content);
        if (v) verdicts.set(a.id, v);
        else failed += 1;
      } catch {
        failed += 1;
      }
    }),
  );
  if (verdicts.size === 0) return { ok: false, error: "The photo reader could not answer just now. Try again." };
  return { ok: true, verdicts, failed };
}

/** Apply one photo to the ticked cards of one vendor. Every card re-checked on the server. */
export async function applyKitPhoto(p: {
  vendorId: string;
  mediaId: string;
  keys: readonly string[];
  mode: KitApplyMode;
  groupLabel: string;
  actor: { userId: string; email?: string | null };
}): Promise<{ ok: true; message: string; attached: number } | { ok: false; error: string }> {
  const asset = await getMedia(p.mediaId).catch(() => null);
  if (!asset) return { ok: false, error: "That photo no longer exists in the media library." };
  const l = await loadCards();
  if ("error" in l) return { ok: false, error: l.error };
  // Only this vendor's cards: a forged key from another vendor is dropped.
  const picked = [...new Set(p.keys)].map((k) => l.cards.get(k)).filter((c): c is KitCard & { vendorId: string | null } => Boolean(c && c.vendorId === p.vendorId));
  if (picked.length === 0) return { ok: false, error: "Tick at least one of this vendor's products." };
  const plan = kitApplyPlan(picked, p.mediaId, p.mode);
  const items = new Map(l.items.map((i) => [i.source_item_id, i] as const));
  let attached = 0;
  let covers = 0;
  let published = 0;
  let skipped = 0;
  for (const step of plan) {
    if (!step.attach && !step.cover) {
      skipped += 1;
      continue;
    }
    const item = items.get(step.key);
    await ensureEnrichment(step.key, { name: item?.name, brand: item?.brand_name, category: item?.category }, p.actor.userId);
    const current = await getEnrichment(step.key);
    const merge = attachImageToGallery({ image_media_ids: current?.image_media_ids ?? [], primary_media_id: current?.primary_media_id ?? null }, p.mediaId);
    const cover = step.cover ? setPrimaryImage(merge, p.mediaId) : null;
    if (!merge.alreadyPresent || cover?.changed) {
      await updateEnrichment(
        step.key,
        { image_media_ids: cover?.changed ? cover.image_media_ids : merge.image_media_ids, primary_media_id: cover?.changed ? cover.primary_media_id : merge.primary_media_id },
        p.actor.userId,
      );
    }
    if (!merge.alreadyPresent) {
      attached += 1;
      await recordUsage(p.mediaId, "product", step.key, "image").catch(() => undefined);
    } else skipped += 1;
    if (cover?.changed || merge.becamePrimary) covers += 1;
    const identityKey = (current?.identity_key ?? "").trim() || (item ? (enrichmentIdentityForItem(item) ?? "") : "");
    if (identityKey) await rememberImageAttach({ identityKey, mediaId: p.mediaId, posProductKey: step.key, source: "library", actorId: p.actor.userId }).catch(() => undefined);
    await recordAudit({
      actorId: p.actor.userId,
      actorEmail: p.actor.email ?? null,
      action: "product.match_image_attached",
      entityType: "product",
      entityId: step.key,
      after: { mediaId: p.mediaId, source: "vendor-kit", vendorId: p.vendorId, group: p.groupLabel, mode: p.mode, becamePrimary: Boolean(cover?.changed || merge.becamePrimary) },
    });
    const pub = await publishOnPhoto(step.key, p.actor).catch(() => null);
    if (pub?.published) published += 1;
  }
  await recordAudit({
    actorId: p.actor.userId,
    actorEmail: p.actor.email ?? null,
    action: "product.vendor_kit_applied",
    entityType: "vendor",
    entityId: p.vendorId,
    after: { mediaId: p.mediaId, group: p.groupLabel, mode: p.mode, keys: plan.map((s) => s.key), attached, covers, published, skipped },
  });
  return { ok: true, attached, message: kitApplyMessage({ attached, covers, published, skipped }) };
}
