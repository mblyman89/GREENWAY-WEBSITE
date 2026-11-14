/**
 * src/lib/enrichment/copilot-server.ts  (D244 R-5, strategy slice E-6)
 *
 * The Enrichment Copilot, the server half. Reads one vendor's on-hand work
 * session (the same reads as the worklist, products/page.tsx), talks to the
 * enrichment model with the SAME evidence the all-fields draft uses
 * (prepareAllFields: POS, vendor, attached photos' vision text, lots and lab
 * certificates; buildGroundedFacts: the knowledge base), and files a chosen
 * proposal as a draft that goes through the ONE accept path
 * (acceptDraftWithEdit: shape check, compliance re-scan, effects gate).
 * Potency is checked against the lab / lot / POS numbers before it is filed.
 * Nothing here writes on its own; every write follows a person's click.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { getPublishedVersion, getVersionItems, getItemBySourceKey } from "@/lib/pos/menu-version";
import { getEnrichment, getEnrichmentsForKeys, resolveEnrichmentsForItems, computeGaps } from "@/lib/enrichment/store";
import type { AiSuggestion, ProductEnrichment } from "@/lib/enrichment/types";
import { readEnrichmentAttribution } from "@/lib/enrichment/enrichment-manifest";
import { cardLotKeys } from "@/lib/inventory/vendor-identity-core";
import { readOnHandLots, readWorklistVendorData } from "@/lib/enrichment/worklist-server";
import { onHandByCard, resolveCardVendor, vendorProgress, type VendorProgress } from "@/lib/enrichment/worklist-core";
import { listSuggestions, persistSuggestion } from "@/lib/ai/suggestions";
import { resolveMediaUrls } from "@/lib/media/store";
import { loadRecommendPanel, type RecommendPanelRead } from "@/lib/enrichment/image-recommend-v3-server";
import { prepareAllFields, readLotEvidence, type DraftItem } from "@/lib/enrichment/ai-draft-v2-server";
import type { LotEvidence } from "@/lib/enrichment/lot-evidence-core";
import { checkPotencyDraft, parsePotencyText, posPotencyNumbers } from "@/lib/enrichment/lot-evidence-core";
import { FIELD_LABEL, isDraftFieldKey, photoFactLines } from "@/lib/enrichment/ai-draft-v2-core";
import { editText, resolveDraftEdit } from "@/lib/enrichment/draft-edit-core";
import { acceptDraftWithEdit, type EditAcceptOutcome } from "@/lib/enrichment/accept-drafts-server";
import { ALLOWED_PRODUCT_TAGS } from "@/lib/ai/schemas/product";
import { checkEffects } from "@/lib/ai/compliance";
import { buildGroundedFacts, loadBannedPhrases } from "@/lib/ai/kb/retrieval";
import { generateStructured, generateVisionJson } from "@/lib/ai/provider";
import { defineSchema } from "@/lib/ai/schema";
import { copilotModel } from "@/lib/ai/enrich-model";
import { enrichMaxTokens } from "@/lib/ai/enrich-model-core";
import { mediaAiModel } from "@/lib/media/media-describe-store";
import type { MenuItemWithVariants } from "@/lib/pos/menu-version";
import {
  COPILOT_SYSTEM,
  COPILOT_PHOTO_CHOICES,
  INSPECT_SYSTEM,
  copilotPhotoChoices,
  copilotQueue,
  copilotUserPrompt,
  copilotVendorStyleLine,
  inspectReply,
  inspectUserPrompt,
  isCopilotField,
  normalizeCopilotAnswer,
  parseInspect,
  type CopilotAnswer,
  type CopilotField,
  type CopilotQueue,
  type CopilotReplyRaw,
  type CopilotRow,
  type CopilotTurn,
} from "@/lib/enrichment/copilot-core";

// ---------------------------------------------------------------------------
// The session read
// ---------------------------------------------------------------------------

export type CopilotCard = {
  key: string;
  item: MenuItemWithVariants;
  enrichment: ProductEnrichment | null;
  row: CopilotRow;
  photos: { id: string; url: string | null; cover: boolean }[];
  pending: AiSuggestion[] | null;
  recommend: RecommendPanelRead;
  lots: LotEvidence | null;
};

export type CopilotSession =
  | { ok: false; reason: string }
  | {
      ok: true;
      vendors: VendorProgress[];
      vendorId: string;
      vendorLabel: string;
      queue: CopilotQueue;
      card: CopilotCard | null;
    };

const itemFacts = (i: MenuItemWithVariants): DraftItem => ({
  name: i.name,
  product_name: i.product_name,
  brand_name: i.brand_name,
  vendor_name: i.vendor_name,
  category: i.category,
  strain_type: i.strain_type,
  strain_name: i.strain_name,
  thc: i.thc,
  cbd: i.cbd,
});

/**
 * Every live card as a CopilotRow (true vendor + on-hand quantity), the
 * vendor list, the queue for `vendor`, and the full read of the card to show.
 */
export async function loadCopilotSession(vendor: string, requestedKey: string, skips: readonly string[]): Promise<CopilotSession> {
  if (!isSupabaseServiceConfigured) return { ok: false, reason: "The database is not configured." };
  const published = await getPublishedVersion().catch(() => null);
  if (!published) return { ok: false, reason: "No published menu yet. Run an inventory sync first." };
  const items = await getVersionItems(published.id);
  const keys = items.map((i) => i.source_item_id);
  const [vendorData, onHandLots, ownEnrichments, attribution] = await Promise.all([
    readWorklistVendorData(),
    readOnHandLots(Array.from(new Set(items.flatMap((i) => cardLotKeys(i))))),
    getEnrichmentsForKeys(keys),
    readEnrichmentAttribution(items),
  ]);
  if (!vendorData) return { ok: false, reason: "The vendor list could not be read just now. Refresh to try again." };
  const { byKey: enrichments } = await resolveEnrichmentsForItems(items, ownEnrichments).catch(() => ({ byKey: ownEnrichments }));
  const attrs = attribution?.attrs ?? null;
  const qty = onHandLots ? onHandByCard(items.map((i) => ({ posKey: i.source_item_id, lotKeys: cardLotKeys(i) })), onHandLots) : null;
  const rows: CopilotRow[] = items.map((i) => {
    const e = enrichments.get(i.source_item_id) ?? null;
    const g = computeGaps(i, e, attrs?.get(i.source_item_id) ?? null);
    return {
      key: i.source_item_id,
      name: g.name,
      vendorId: resolveCardVendor(
        { ownVendorId: e?.vendor_id ?? null, attrVendorIds: attrs?.get(i.source_item_id)?.vendorIds ?? null, brandName: i.brand_name, posVendorName: i.vendor_name },
        vendorData,
      ).vendorId,
      inventoryStatus: g.inventoryStatus,
      lotQty: qty ? (qty.get(i.source_item_id) ?? 0) : null,
      enrichmentStatus: g.enrichmentStatus,
      hasImage: g.hasImage,
      hasDescription: g.hasDescription,
    };
  });
  const vendors = vendorProgress(rows, vendorData.labels);
  const v = vendor || "";
  const vp = vendors.find((p) => p.id === v) ?? null;
  const queue = copilotQueue(rows, v, skips);
  const key = requestedKey && queue.todo.includes(requestedKey) ? requestedKey : (queue.todo[0] ?? null);
  const base = { ok: true as const, vendors, vendorId: v, vendorLabel: vp?.label ?? "", queue };
  if (!v || !key) return { ...base, card: null };
  const item = items.find((i) => i.source_item_id === key)!;
  const enrichment = (await getEnrichment(key).catch(() => null)) ?? enrichments.get(key) ?? null;
  const ids = [enrichment?.primary_media_id, ...(enrichment?.image_media_ids ?? [])].filter(
    (x, i, a): x is string => typeof x === "string" && x.length > 0 && a.indexOf(x) === i,
  );
  const [urls, pending, recommend, lots] = await Promise.all([
    resolveMediaUrls(ids).catch(() => new Map<string, string>()),
    listSuggestions("product", key, "pending").catch(() => null),
    loadRecommendPanel({ item, enrichment }),
    readLotEvidence(key),
  ]);
  return {
    ...base,
    card: {
      key,
      item,
      enrichment,
      row: rows.find((r) => r.key === key)!,
      photos: ids.map((id) => ({ id, url: urls.get(id) ?? null, cover: id === enrichment?.primary_media_id })),
      pending,
      recommend,
      lots,
    },
  };
}

// ---------------------------------------------------------------------------
// The chat
// ---------------------------------------------------------------------------

const copilotSchema = defineSchema<CopilotReplyRaw>("copilot_reply", {
  reply: { kind: "string", description: "One to four short plain sentences to the owner.", maxLength: 1500 },
  changes: {
    kind: "object",
    description: "Proposed new values. Empty string for every field you are not changing.",
    fields: {
      display_name: { kind: "string", maxLength: 120 },
      description: { kind: "string", description: "2-3 sentences. No price, stock, health, medical or effect claims.", maxLength: 700 },
      short_description: { kind: "string", maxLength: 200 },
      seo_title: { kind: "string", description: "At most 39 characters. Fill seo_meta too, or leave both empty.", maxLength: 100 },
      seo_meta: { kind: "string", description: "120-160 characters, mentions in-store pickup.", maxLength: 340 },
      sensory: { kind: "string", description: "Aroma: a, b · Flavor: c · Terpenes: d", maxLength: 400 },
      effects: { kind: "string", description: "Comma-separated feelings, never medical.", maxLength: 300 },
      tags: { kind: "string", description: `Comma-separated, only from: ${ALLOWED_PRODUCT_TAGS.join(", ")}`, maxLength: 300 },
      strain_type: { kind: "string", description: "Indica, Sativa, Hybrid, Indica-Hybrid, Sativa-Hybrid or CBD.", maxLength: 40 },
      potency: { kind: "string", description: "Copied from a lab, lot or POS line, like THC 24.5% · CBD 0.1%.", maxLength: 80 },
    },
  },
  why: { kind: "string", description: "Which evidence lines the changes rest on (short).", maxLength: 600 },
  photo_pick: { kind: "number", description: "Number of the photo choice that is this product, else 0.", min: 0, max: COPILOT_PHOTO_CHOICES },
});

/** The answer budget for one chat turn (the Gemini floor is applied by the model). */
export const COPILOT_ANSWER_TOKENS = 1400;

/** A few published cards of the same vendor (house style), best-effort. */
async function readVendorStyle(vendorId: string, notKey: string): Promise<string[]> {
  if (!vendorId || vendorId === "none" || !isSupabaseServiceConfigured) return [];
  try {
    const { data } = await createSupabaseAdminClient()
      .from("product_enrichments")
      .select("pos_product_key, display_name, short_description, description")
      .eq("vendor_id", vendorId)
      .eq("status", "published")
      .not("description", "is", null)
      .limit(4);
    return ((data as { pos_product_key: string; display_name: string | null; short_description: string | null; description: string | null }[] | null) ?? [])
      .filter((r) => r.pos_product_key !== notKey)
      .slice(0, 3)
      .map((r) => copilotVendorStyleLine(r));
  } catch {
    return [];
  }
}

export type CopilotTurnResult = { ok: true; answer: CopilotAnswer; model: string } | { ok: false; error: string };

/** One chat turn. The model only proposes; nothing is stored here. */
export async function askCopilot(input: {
  key: string;
  vendorId: string;
  history: readonly CopilotTurn[];
  message: string;
  actorId: string | null;
}): Promise<CopilotTurnResult> {
  const published = await getPublishedVersion().catch(() => null);
  const item = published ? await getItemBySourceKey(published.id, input.key).catch(() => null) : null;
  if (!item) return { ok: false, error: "That product is not on the published menu any more." };
  const enrichment = await getEnrichment(input.key).catch(() => null);
  const [prep, pending, recommend, style] = await Promise.all([
    prepareAllFields(input.key, itemFacts(item)),
    listSuggestions("product", input.key, "pending").catch(() => [] as AiSuggestion[]),
    loadRecommendPanel({ item, enrichment }),
    readVendorStyle(input.vendorId, input.key),
  ]);
  const grounded = await buildGroundedFacts(prep.facts).catch(() => ({ block: "", sources: [] as string[] }));
  const photo = photoFactLines(prep.photos);
  const choices = copilotPhotoChoices(recommend.tiles);
  const productLines = [
    `Product name (POS): ${prep.facts.name}`,
    prep.facts.brand ? `Brand (POS): ${prep.facts.brand}` : "",
    prep.vendor ? `Vendor: ${prep.vendor}` : "",
    prep.facts.category ? `Category (POS): ${prep.facts.category}` : "",
    prep.facts.strainName ? `Strain (POS): ${prep.facts.strainName}` : "",
    ...Object.entries(prep.current)
      .filter(([, v]) => typeof v === "string" && v.trim())
      .map(([k, v]) => `On record now - ${isDraftFieldKey(k) ? FIELD_LABEL[k] : k}: ${String(v).slice(0, 400)}`),
  ].filter(Boolean);
  const draftLines = (pending ?? [])
    .filter((s) => isDraftFieldKey(s.field_key))
    .slice(0, 12)
    .map((s) => `${FIELD_LABEL[s.field_key as keyof typeof FIELD_LABEL]} (${Math.round((s.confidence ?? 0) * 100)}%): ${editText(s.field_key, s.suggested_value).slice(0, 400)}`);
  const user = copilotUserPrompt(
    {
      productLines,
      lotLines: prep.lots?.lines ?? [],
      photoLines: photo.lines,
      kbBlock: grounded.block,
      draftLines,
      vendorStyle: style,
      photoChoices: choices.map((c) => `${c.n}. ${c.label} (${c.confidence}% match${c.chips.length ? `; ${c.chips.join(", ")}` : ""})`),
    },
    input.history,
    input.message,
  );
  try {
    const raw = await generateStructured({
      system: COPILOT_SYSTEM,
      user,
      schema: copilotSchema,
      tier: "heavy",
      // AI_COPILOT_MODEL (the flagship is recommended) else AI_ENRICH_MODEL.
      model: copilotModel.model,
      reasoningEffort: copilotModel.effort,
      maxTokens: enrichMaxTokens(copilotModel, COPILOT_ANSWER_TOKENS),
      context: { feature: "product.copilot", entityType: "product", entityId: input.key, actorId: input.actorId },
    });
    return { ok: true, answer: normalizeCopilotAnswer(raw, choices.length), model: copilotModel.model };
  } catch (err) {
    return { ok: false, error: `The copilot could not answer just now (${(err as Error).message.slice(0, 200)}). Try again.` };
  }
}

/** "Look closely" at one photo with the vision model (label text, size, match). */
export async function inspectPhoto(input: { key: string; mediaId: string; actorId: string | null }): Promise<{ ok: true; reply: string } | { ok: false; error: string }> {
  const published = await getPublishedVersion().catch(() => null);
  const item = published ? await getItemBySourceKey(published.id, input.key).catch(() => null) : null;
  if (!item) return { ok: false, error: "That product is not on the published menu any more." };
  const urls = await resolveMediaUrls([input.mediaId]).catch(() => new Map<string, string>());
  const url = urls.get(input.mediaId);
  if (!url) return { ok: false, error: "That photo has no public address yet, so the AI cannot look at it." };
  const lines = [
    `Product name (POS): ${item.product_name || item.name}`,
    item.brand_name ? `Brand (POS): ${item.brand_name}` : "",
    item.category ? `Category (POS): ${item.category}` : "",
  ].filter(Boolean);
  try {
    const out = await generateVisionJson({
      system: INSPECT_SYSTEM,
      user: inspectUserPrompt(lines),
      imageUrl: url,
      model: mediaAiModel(),
      detail: "high",
      maxTokens: 900,
      context: { feature: "product.copilot.inspect", entityType: "product", entityId: input.key, actorId: input.actorId },
    });
    const r = parseInspect(out.content);
    if (!r) return { ok: false, error: "The photo reader gave an answer I could not read. Try again." };
    return { ok: true, reply: inspectReply(r) };
  } catch (err) {
    return { ok: false, error: `The photo reader could not answer just now (${(err as Error).message.slice(0, 200)}).` };
  }
}

// ---------------------------------------------------------------------------
// "Use this": file the proposal as a draft, then the ONE accept path
// ---------------------------------------------------------------------------

/** Source of a copilot draft a person pressed "Use this" on (looked at, so checked). */
export const COPILOT_SOURCE = "ai2:copilot|checked";

export async function fileCopilotProposal(input: {
  key: string;
  field: string;
  value: string;
  actorId: string;
}): Promise<EditAcceptOutcome & { field?: CopilotField }> {
  if (!isCopilotField(input.field)) return { ok: false, error: "That is not a field the copilot can change." };
  const field = input.field;
  // Read the typed text into the stored shape (same reader as an edited draft).
  const shaped = resolveDraftEdit(field, "", input.value, { allowedTags: ALLOWED_PRODUCT_TAGS });
  if (shaped.error) return { ok: false, error: shaped.error };
  if (!shaped.value.trim()) return { ok: false, error: "That proposal is empty." };
  let value = shaped.value;
  if (field === "potency") {
    // Owner rule (R-2): a printed number must come from a lab, lot or POS line.
    const p = parsePotencyText(value);
    if (!p.ok) return { ok: false, error: p.error };
    const published = await getPublishedVersion().catch(() => null);
    const item = published ? await getItemBySourceKey(published.id, input.key).catch(() => null) : null;
    const lots = await readLotEvidence(input.key);
    const pos = posPotencyNumbers(item?.thc ?? null, item?.cbd ?? null);
    const numbers = { thc: [...pos.thc, ...(lots?.numbers.thc ?? [])], cbd: [...pos.cbd, ...(lots?.numbers.cbd ?? [])] };
    const checked = checkPotencyDraft(
      { thc: p.value.thc ? `${p.value.thc.value}${p.value.thc.unit}` : "", cbd: p.value.cbd ? `${p.value.cbd.value}${p.value.cbd.unit}` : "" },
      numbers,
    );
    if (checked.dropped.length) return { ok: false, error: `No lab, lot or POS number says ${checked.dropped.join(" or ")}. Check the certificate, then type the number it shows.` };
  }
  if (field === "effects") {
    const gate = checkEffects(value.split(",").map((x) => x.trim()).filter(Boolean), await loadBannedPhrases().catch(() => []));
    if (gate.rejected.length) return { ok: false, error: `Not allowed as an effect: ${gate.rejected.map((x) => `"${x.effect}" (${x.reason})`).join(", ")}.` };
    value = gate.allowed.join(", ");
  }
  let id: string;
  try {
    const s = await persistSuggestion({
      entity_type: "product",
      entity_id: input.key,
      field_key: field,
      suggested_value: value,
      input_summary: "copilot chat · a person pressed Use this",
      generated_by: input.actorId,
      confidence: 1,
      source: COPILOT_SOURCE,
      model: copilotModel.model,
    });
    id = s.id;
  } catch {
    return { ok: false, error: "The draft could not be saved just now. Nothing changed." };
  }
  const out = await acceptDraftWithEdit(id, null, input.actorId);
  return out.ok ? { ...out, field } : out;
}
