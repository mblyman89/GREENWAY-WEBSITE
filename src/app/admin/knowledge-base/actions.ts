"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  seedKnowledgeBase,
  addBannedPhrase,
  setBannedActive,
  upsertKbBrand,
  upsertKbStrain,
  setStrainActive,
  upsertKbNote,
  setKbNoteActive,
  upsertKbProductCategory,
  setProductCategoryActive,
  getKbProductCategoryBySlug,
  reviewKbProduct,
  reviewKbBrand,
  attachKbProductImage,
  bulkReviewKbDraftsBySource,
  upsertKbStoreFact,
  setStoreFactActive,
  upsertKbFaq,
  setFaqActive,
} from "@/lib/ai/kb/store";
import { updateBrandFacts } from "@/lib/vendors/store";
import { seedMedicalBannedPhrases } from "@/lib/ai/kb/seed-banned";
import { validateNoteInput } from "@/lib/ai/kb/kb-notes-core";
import { canonicalStrainType } from "@/lib/menu/strain-taxonomy";
import {
  canonicalizeCcrsTypeName,
  normalizeCcrsName,
} from "@/lib/ai/kb/ccrs-vocabulary-core";
import {
  upsertImageSubstitute,
  setSubstituteActive,
  deleteImageSubstitute,
  type SubstituteScope,
} from "@/lib/ai/kb/image-substitutes";
import { importImageFromUrl, HarvestImageError } from "@/lib/media/harvest";

const PATH = "/admin/knowledge-base";

function back(message: string, ok = true): never {
  const key = ok ? "msg" : "error";
  redirect(`${PATH}?${key}=${encodeURIComponent(message)}`);
}

/** Parse a comma-separated input into a trimmed, de-duped, lowercased-where-relevant list. */
function csv(value: FormDataEntryValue | null, { lower = false }: { lower?: boolean } = {}): string[] {
  const out = String(value ?? "")
    .split(",")
    .map((s) => (lower ? s.trim().toLowerCase() : s.trim()))
    .filter(Boolean);
  return Array.from(new Set(out));
}

/** Seed (idempotent) the expert starter knowledge base. */
export async function seedKbAction(): Promise<void> {
  const session = await requirePermission("products.enrich");
  const report = await seedKnowledgeBase(session.profile.id);
  await recordAudit({
    actorId: session.profile.id,
    action: "kb.seed",
    entityType: "knowledge_base",
    after: report.inserted,
  }).catch(() => {});
  back(report.message, report.ok);
}

/** Add (or refresh) an owner-defined banned phrase. */
export async function addBannedPhraseAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const phrase = String(formData.get("phrase") ?? "").trim();
  const severity = String(formData.get("severity") ?? "block") === "warn" ? "warn" : "block";
  const reason = String(formData.get("reason") ?? "").trim() || null;
  if (!phrase) back("Please enter a phrase to ban.", false);
  await addBannedPhrase(phrase, severity, reason, session.profile.id);
  await recordAudit({ actorId: session.profile.id, action: "kb.banned.add", entityType: "kb_banned_phrase", entityId: phrase }).catch(() => {});
  revalidatePath(PATH);
  back(`Added "${phrase}" to the banned list.`);
}

/** Toggle a banned phrase active/inactive. */
export async function toggleBannedAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const id = String(formData.get("id") ?? "");
  const active = String(formData.get("active") ?? "") === "true";
  if (!id) back("Missing phrase id.", false);
  await setBannedActive(id, active);
  await recordAudit({ actorId: session.profile.id, action: "kb.banned.toggle", entityType: "kb_banned_phrase", entityId: id, after: { active } }).catch(() => {});
  revalidatePath(PATH);
  back(active ? "Phrase re-enabled." : "Phrase disabled.");
}

/** Add or update a brand fact row. */
export async function upsertBrandAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) back("Please enter a brand name.", false);
  const slug = (String(formData.get("slug") ?? "").trim() || name).toLowerCase().replace(/\s+/g, " ");
  const known_for = String(formData.get("known_for") ?? "").trim() || null;
  const house_style = String(formData.get("house_style") ?? "").trim() || null;
  const sensory_notes = String(formData.get("sensory_notes") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  await upsertKbBrand({ slug, name, known_for, house_style, sensory_notes }, session.profile.id);
  await recordAudit({ actorId: session.profile.id, action: "kb.brand.upsert", entityType: "kb_brand", entityId: slug }).catch(() => {});
  revalidatePath(PATH);
  back(`Saved brand facts for "${name}".`);
}

/**
 * Update the brand FACTS on an operational brand (migration 0072 folded these
 * columns onto `brands`). Keyed by the real brand id — this enriches an existing
 * vendor-linked brand rather than creating a KB-only brand record. Facts are
 * sensory/voice only (WA I-502: no medical/curative claims).
 */
export async function updateBrandFactsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const id = String(formData.get("id") ?? "").trim();
  if (!id) back("Missing brand id.", false);
  const known_for = String(formData.get("known_for") ?? "").trim() || null;
  const house_style = String(formData.get("house_style") ?? "").trim() || null;
  const signature_lines = String(formData.get("signature_lines") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const sensory_notes = String(formData.get("sensory_notes") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const ok = await updateBrandFacts(
    id,
    { known_for, house_style, signature_lines, sensory_notes },
    session.profile.id,
  );
  await recordAudit({
    actorId: session.profile.id,
    action: "brand.facts.update",
    entityType: "brand",
    entityId: id,
  }).catch(() => {});
  revalidatePath(PATH);
  back(ok ? "Saved brand facts." : "Could not save brand facts.", ok);
}

/**
 * Add or update a single verified strain (manual staff entry). Exposes every
 * field the kb_strains table holds. NO brand field — brand info lives on the
 * Vendors page. Sensory/factual only (WA I-502: no health/effect claims).
 */
export async function upsertStrainAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) back("Please enter a strain name.", false);

  // Canonicalize whatever the form sent (accepts any legacy spelling and the
  // new indica-hybrid / sativa-hybrid leaning tokens). Website + back office
  // only — CCRS export collapses these to "Hybrid" separately and is untouched.
  const rawType = String(formData.get("strain_type") ?? "hybrid").trim();
  const strain_type = canonicalStrainType(rawType);

  // Confidence: optional 0..1; accept blank.
  const confRaw = String(formData.get("confidence") ?? "").trim();
  let confidence: number | null = null;
  if (confRaw) {
    const n = Number(confRaw);
    if (!Number.isNaN(n)) confidence = Math.max(0, Math.min(1, n));
  }

  await upsertKbStrain(
    {
      slug: String(formData.get("slug") ?? "").trim() || null,
      name,
      aliases: csv(formData.get("aliases"), { lower: true }),
      strain_type,
      lineage: String(formData.get("lineage") ?? "").trim() || null,
      aroma_notes: csv(formData.get("aroma_notes"), { lower: true }),
      flavor_notes: csv(formData.get("flavor_notes"), { lower: true }),
      terpenes: csv(formData.get("terpenes"), { lower: true }),
      summary: String(formData.get("summary") ?? "").trim() || null,
      dominant_cannabinoid: String(formData.get("dominant_cannabinoid") ?? "").trim() || null,
      potency_note: String(formData.get("potency_note") ?? "").trim() || null,
      bud_structure: String(formData.get("bud_structure") ?? "").trim() || null,
      origin: String(formData.get("origin") ?? "").trim() || null,
      sources: csv(formData.get("sources")),
      confidence,
      active: String(formData.get("active") ?? "true") !== "false",
    },
    session.profile.id,
  );

  await recordAudit({
    actorId: session.profile.id,
    action: "kb.strain.upsert",
    entityType: "kb_strain",
    entityId: name.toLowerCase(),
  }).catch(() => {});
  revalidatePath(PATH);
  back(`Saved strain "${name}".`);
}

const ALLOWED_PRODUCT_GROUPS = new Set([
  "flower",
  "concentrate",
  "vape",
  "edible",
  "liquid",
  "topical",
]);

/**
 * Add or update a single product type/category (manual staff entry). Lets the
 * owner grow the product-type taxonomy (edibles, liquids, tinctures, topicals,
 * …) over time. Market-factual only (WA I-502: no health/effect claims).
 */
export async function upsertProductCategoryAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) back("Please enter a product type name.", false);

  const rawGroup = String(formData.get("group_key") ?? "edible").trim().toLowerCase();
  const group_key = ALLOWED_PRODUCT_GROUPS.has(rawGroup) ? rawGroup : "edible";

  const sortRaw = String(formData.get("sort_order") ?? "").trim();
  let sort_order: number | null = null;
  if (sortRaw) {
    const n = Number(sortRaw);
    if (!Number.isNaN(n)) sort_order = Math.max(0, Math.trunc(n));
  }

  const result = await upsertKbProductCategory(
    {
      slug: String(formData.get("slug") ?? "").trim() || null,
      name,
      group_key,
      summary: String(formData.get("summary") ?? "").trim() || null,
      aliases: csv(formData.get("aliases"), { lower: true }),
      wa_inventory_types: csv(formData.get("wa_inventory_types")),
      sort_order,
      active: String(formData.get("active") ?? "true") !== "false",
    },
    session.profile.id,
  );

  await recordAudit({
    actorId: session.profile.id,
    action: "kb.product_category.upsert",
    entityType: "kb_product_category",
    entityId: name.toLowerCase(),
  }).catch(() => {});
  revalidatePath(PATH);
  if (!result.ok) back(result.message ?? "Couldn't save the product type.", false);
  back(`Saved product type "${name}".`);
}

/** Toggle a product type active/inactive. */
export async function toggleProductCategoryAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const id = String(formData.get("id") ?? "");
  const active = String(formData.get("active") ?? "") === "true";
  if (!id) back("Missing product type id.", false);
  const result = await setProductCategoryActive(id, active);
  await recordAudit({
    actorId: session.profile.id,
    action: "kb.product_category.toggle",
    entityType: "kb_product_category",
    entityId: id,
    after: { active },
  }).catch(() => {});
  revalidatePath(PATH);
  if (!result.ok) back(result.message ?? "Couldn't update the product type.", false);
  back(active ? "Product type re-enabled." : "Product type hidden from the AI.");
}

// Pages that render the "unmapped CCRS types" review panel (Slice 3). The map
// action revalidates both and returns the operator to whichever they used.
const LIBRARY_PATH = "/admin/knowledge-base/library";
const SETTINGS_TYPES_PATH = "/admin/settings/types";
const ALLOWED_MAP_RETURNS = new Set<string>([LIBRARY_PATH, SETTINGS_TYPES_PATH]);

/** Redirect back to the page the map form was submitted from, with a flash. */
function backToMapSurface(returnTo: string, message: string, ok = true): never {
  const base = ALLOWED_MAP_RETURNS.has(returnTo) ? returnTo : LIBRARY_PATH;
  const key = ok ? "msg" : "error";
  const suffix = base === SETTINGS_TYPES_PATH ? "&tab=inventory" : "";
  redirect(`${base}?${key}=${encodeURIComponent(message)}${suffix}`);
}

/**
 * SLICE 3 — one-click "map this CCRS type". Appends a CCRS inventory-type name
 * to a KB product category's wa_inventory_types, growing the CCRS→category map
 * as intake sees new (or older) types. Read-modify-write so EVERY other field
 * is preserved; idempotent (re-mapping the same name is a no-op). We store the
 * canonical modern CCRS spelling when the name is recognized, else the raw name
 * exactly as intake saw it (never invents). Never guesses a target — the
 * operator picks the category. Revalidates both surfaces.
 */
export async function mapCcrsTypeToKbCategoryAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const returnTo = String(formData.get("returnTo") ?? LIBRARY_PATH);
  const rawType = String(formData.get("ccrs_type") ?? "").trim();
  const targetSlug = String(formData.get("category_slug") ?? "").trim();

  if (!rawType) backToMapSurface(returnTo, "No CCRS type was provided.", false);
  if (!targetSlug) backToMapSurface(returnTo, "Please choose a product type to map it to.", false);

  const target = await getKbProductCategoryBySlug(targetSlug);
  if (!target) backToMapSurface(returnTo, "That product type no longer exists — refresh and try again.", false);

  // Store the canonical modern spelling when CCRS recognizes it; otherwise keep
  // the raw name exactly (older dialect / typo stays as-is, never invented).
  const storeAs = canonicalizeCcrsTypeName(rawType) ?? rawType;

  // Append idempotently, preserving order and existing entries.
  const existing = target.wa_inventory_types ?? [];
  const already = existing.some(
    (t) => normalizeCcrsName(t) === normalizeCcrsName(storeAs),
  );
  const nextTypes = already ? existing : [...existing, storeAs];

  const result = await upsertKbProductCategory(
    {
      slug: target.slug,
      name: target.name,
      group_key: target.group_key,
      summary: target.summary,
      aliases: target.aliases ?? [],
      wa_inventory_types: nextTypes,
      sort_order: target.sort_order,
      active: target.active,
    },
    session.profile.id,
  );

  await recordAudit({
    actorId: session.profile.id,
    action: "kb.product_category.map_ccrs_type",
    entityType: "kb_product_category",
    entityId: target.slug,
    after: { ccrs_type: storeAs, category: target.slug },
  }).catch(() => {});

  revalidatePath(PATH);
  revalidatePath(LIBRARY_PATH);
  revalidatePath(SETTINGS_TYPES_PATH);

  if (!result.ok) backToMapSurface(returnTo, result.message ?? "Couldn't map the CCRS type.", false);
  backToMapSurface(
    returnTo,
    already
      ? `"${storeAs}" was already mapped to ${target.name}.`
      : `Mapped "${storeAs}" to ${target.name}.`,
  );
}

/** Toggle a strain active/inactive. */
export async function toggleStrainAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const id = String(formData.get("id") ?? "");
  const active = String(formData.get("active") ?? "") === "true";
  if (!id) back("Missing strain id.", false);
  await setStrainActive(id, active);
  await recordAudit({ actorId: session.profile.id, action: "kb.strain.toggle", entityType: "kb_strain", entityId: id, after: { active } }).catch(() => {});
  revalidatePath(PATH);
  back(active ? "Strain re-enabled." : "Strain hidden from the AI.");
}

const ALLOWED_SUB_SCOPES = new Set<SubstituteScope>([
  "category",
  "inventory_type",
  "brand",
  "vendor",
  "global",
]);

/**
 * Add or update an approved image substitute (fallback). Staff pick an existing
 * media asset by id and assign it to a category / inventory type / brand /
 * vendor / global scope so product cards are never blank.
 */
export async function upsertSubstituteAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const scopeRaw = String(formData.get("scope") ?? "category") as SubstituteScope;
  const scope = ALLOWED_SUB_SCOPES.has(scopeRaw) ? scopeRaw : "category";
  const media_id = String(formData.get("media_id") ?? "").trim();
  const key = scope === "global" ? "*" : String(formData.get("key") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim() || null;
  const priorityRaw = String(formData.get("priority") ?? "").trim();
  const priority = priorityRaw ? Math.max(0, Math.trunc(Number(priorityRaw)) || 100) : 100;

  if (!media_id) back("Please choose an image (media id) for the substitute.", false);
  if (scope !== "global" && !key) back("Please choose what this fallback applies to.", false);

  await upsertImageSubstitute({ scope, key, media_id, label, priority }, session.profile.id);
  await recordAudit({
    actorId: session.profile.id,
    action: "kb.substitute.upsert",
    entityType: "kb_image_substitute",
    entityId: `${scope}:${key}`,
  }).catch(() => {});
  revalidatePath(PATH);
  back(`Saved fallback image for ${scope} "${key}".`);
}

/** Toggle a substitute active/inactive. */
export async function toggleSubstituteAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const id = String(formData.get("id") ?? "");
  const active = String(formData.get("active") ?? "") === "true";
  if (!id) back("Missing substitute id.", false);
  await setSubstituteActive(id, active);
  await recordAudit({ actorId: session.profile.id, action: "kb.substitute.toggle", entityType: "kb_image_substitute", entityId: id, after: { active } }).catch(() => {});
  revalidatePath(PATH);
  back(active ? "Fallback re-enabled." : "Fallback disabled.");
}

/** Remove a substitute entirely. */
export async function deleteSubstituteAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const id = String(formData.get("id") ?? "");
  if (!id) back("Missing substitute id.", false);
  await deleteImageSubstitute(id);
  await recordAudit({ actorId: session.profile.id, action: "kb.substitute.delete", entityType: "kb_image_substitute", entityId: id }).catch(() => {});
  revalidatePath(PATH);
  back("Fallback image removed.");
}

// ---------------------------------------------------------------------------
// Owner-uploaded reference notes (item 14).
// ---------------------------------------------------------------------------

/** Add or update a free-form reference note. */
export async function upsertKbNoteAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const id = String(formData.get("id") ?? "").trim() || null;
  const parsed = validateNoteInput({
    title: String(formData.get("title") ?? ""),
    body: String(formData.get("body") ?? ""),
    tags: String(formData.get("tags") ?? ""),
    source: String(formData.get("source") ?? ""),
  });
  if (!parsed.ok) back(parsed.error, false);
  await upsertKbNote({ id, ...parsed.value }, session.profile.id);
  await recordAudit({
    actorId: session.profile.id,
    action: id ? "kb.note.update" : "kb.note.add",
    entityType: "kb_note",
    entityId: id ?? undefined,
    after: { title: parsed.value.title, tags: parsed.value.tags },
  }).catch(() => {});
  revalidatePath(PATH);
  back(id ? "Reference note updated." : "Reference note added.");
}

/** Show/hide a reference note from the AI's grounding. */
export async function toggleKbNoteAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const id = String(formData.get("id") ?? "");
  const active = String(formData.get("active") ?? "") === "true";
  if (!id) back("Missing note id.", false);
  await setKbNoteActive(id, active);
  await recordAudit({ actorId: session.profile.id, action: "kb.note.toggle", entityType: "kb_note", entityId: id, after: { active } }).catch(() => {});
  revalidatePath(PATH);
  back(active ? "Note is now in use." : "Note hidden from the AI.");
}

// ---------------------------------------------------------------------------
// KB write-back review queue (kb_products drafts) + medical blocklist seed.
// ---------------------------------------------------------------------------

const REVIEW_PATH = "/admin/knowledge-base/review";

function backReview(message: string, ok = true): never {
  const key = ok ? "msg" : "error";
  redirect(`${REVIEW_PATH}?${key}=${encodeURIComponent(message)}`);
}

/** Validate a staged kb_products row into published/active, or archive it. */
export async function reviewKbProductAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const id = String(formData.get("id") ?? "");
  const raw = String(formData.get("decision") ?? "");
  const decision = raw === "publish" ? "publish" : raw === "archive" ? "archive" : "draft";
  if (!id) backReview("Missing record id.", false);
  await reviewKbProduct(id, decision, session.profile.id);
  await recordAudit({
    actorId: session.profile.id,
    action: `kb.product.${decision}`,
    entityType: "kb_product",
    entityId: id,
    after: { decision },
  }).catch(() => {});
  revalidatePath(REVIEW_PATH);
  backReview(
    decision === "publish"
      ? "Record published into the KB."
      : decision === "archive"
        ? "Record archived."
        : "Record returned to draft.",
  );
}

/**
 * Slice H9c — attach a product image harvested from a vendor's OWN page to a
 * kb_products row. The crawler only ever REPORTS first-party image URLs
 * (research_images); downloading is this explicit human click. We fetch the
 * image server-side (size/MIME capped, private hosts refused, content-hash
 * deduped) into a media_assets DRAFT (usage_type='product', license pending
 * review), then append it to the product's gallery (first image becomes the
 * cover). Drafts-only: the product itself is NOT published by this action.
 */
export async function attachKbProductImageAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const productId = String(formData.get("productId") ?? "").trim();
  const imageUrl = String(formData.get("imageUrl") ?? "").trim();
  const displayName = String(formData.get("displayName") ?? "").trim() || "product";
  if (!productId || !imageUrl) backReview("Missing product or image URL.", false);
  if (!/^https?:\/\//i.test(imageUrl)) backReview("Enter a valid http(s) image URL.", false);

  try {
    const { asset, deduped } = await importImageFromUrl({
      imageUrl,
      usageType: "product",
      title: `${displayName} (harvested)`,
      altText: `${displayName} product image`,
      uploadedBy: session.profile.id,
      tags: ["product"],
    });
    const res = await attachKbProductImage(productId, asset.id, session.profile.id);
    if (!res.ok) backReview(res.error ?? "Couldn't attach the image.", false);

    await recordAudit({
      actorId: session.profile.id,
      action: "kb.product.image_attached",
      entityType: "kb_product",
      entityId: productId,
      after: { imageUrl, mediaAssetId: asset.id, deduped, becamePrimary: res.becamePrimary },
    }).catch(() => {});

    revalidatePath(REVIEW_PATH);
    const note = res.alreadyPresent
      ? "That image is already on this product."
      : res.becamePrimary
        ? `Image saved and set as the cover for ${displayName} (license: pending review).`
        : `Image saved and added to ${displayName}'s gallery (license: pending review).`;
    backReview(note);
  } catch (err) {
    if (err instanceof HarvestImageError) backReview(err.message, false);
    throw err; // let NEXT_REDIRECT (success path) propagate
  }
}

/** Slice B — validate a staged kb_brands row into published/active, or archive it. */
export async function reviewKbBrandAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const id = String(formData.get("id") ?? "");
  const raw = String(formData.get("decision") ?? "");
  const decision = raw === "publish" ? "publish" : raw === "archive" ? "archive" : "draft";
  if (!id) backReview("Missing record id.", false);
  await reviewKbBrand(id, decision, session.profile.id);
  await recordAudit({
    actorId: session.profile.id,
    action: `kb.brand.${decision}`,
    entityType: "kb_brand",
    entityId: id,
    after: { decision },
  }).catch(() => {});
  revalidatePath(REVIEW_PATH);
  backReview(
    decision === "publish"
      ? "Brand published into the KB."
      : decision === "archive"
        ? "Brand archived."
        : "Brand returned to draft.",
  );
}

/**
 * Slice B — bulk publish/archive all CCRS-sourced DRAFTS (source like 'ccrs:%').
 * Only status='draft' rows move; curated/published records are never touched.
 */
export async function bulkReviewCcrsDraftsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const raw = String(formData.get("decision") ?? "");
  const decision = raw === "publish" ? "publish" : raw === "archive" ? "archive" : null;
  if (!decision) backReview("Missing bulk decision.", false);
  const { products, brands } = await bulkReviewKbDraftsBySource("ccrs:", decision, session.profile.id);
  await recordAudit({
    actorId: session.profile.id,
    action: `kb.bulk.${decision}_ccrs_drafts`,
    entityType: "kb_products",
    after: { products, brands },
  }).catch(() => {});
  revalidatePath(REVIEW_PATH);
  backReview(
    decision === "publish"
      ? `Published ${products} product and ${brands} brand CCRS draft(s) into the KB.`
      : `Archived ${products} product and ${brands} brand CCRS draft(s).`,
  );
}

/** Sync the code-defined medical-claim blocklist into kb_banned_phrases. */
export async function seedMedicalBlocklistAction(): Promise<void> {
  const session = await requirePermission("products.enrich");
  const res = await seedMedicalBannedPhrases(session.profile.id);
  await recordAudit({
    actorId: session.profile.id,
    action: "kb.banned.seed_medical",
    entityType: "kb_banned_phrases",
    after: { attempted: res.attempted, ok: res.ok, error: res.error ?? null },
  }).catch(() => {});
  revalidatePath(PATH);
  back(
    res.ok
      ? `Synced ${res.attempted} medical-claim phrases into the blocklist.`
      : `Could not sync blocklist: ${res.error ?? "unknown error"}`,
    res.ok,
  );
}

// ---------------------------------------------------------------------------
// Store/brand facts + FAQ pack (Slice 4). Owner-extendable "about us" cards and
// curated Q&A. Same drafts-first, compliance-gated KB pattern as the rest.
// ---------------------------------------------------------------------------

const ABOUT_PATH = "/admin/knowledge-base/about";
const FAQ_PATH = "/admin/knowledge-base/faqs";

function backTo(path: string, message: string, ok = true): never {
  const key = ok ? "msg" : "error";
  redirect(`${path}?${key}=${encodeURIComponent(message)}`);
}

/** Add or update an owner store fact (hours, address, mission, etc.). */
export async function upsertKbStoreFactAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const key = String(formData.get("key") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!key) backTo(ABOUT_PATH, "A key is required.", false);
  if (!label) backTo(ABOUT_PATH, "A label is required.", false);
  if (!body) backTo(ABOUT_PATH, "The fact can't be empty.", false);
  const sortRaw = Number.parseInt(String(formData.get("sort_order") ?? ""), 10);
  const res = await upsertKbStoreFact(
    {
      key,
      label,
      category: String(formData.get("category") ?? "basics"),
      body,
      tags: csv(formData.get("tags"), { lower: true }),
      sort_order: Number.isFinite(sortRaw) ? sortRaw : 100,
      sources: csv(formData.get("sources")),
    },
    session.profile.id,
  );
  await recordAudit({
    actorId: session.profile.id,
    action: "kb.store_fact.upsert",
    entityType: "kb_store_fact",
    entityId: key,
    after: { label },
  }).catch(() => {});
  revalidatePath(ABOUT_PATH);
  backTo(ABOUT_PATH, res.message, res.ok);
}

/** Show/hide a store fact from the AI. */
export async function toggleKbStoreFactAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const key = String(formData.get("key") ?? "");
  const active = String(formData.get("active") ?? "") === "true";
  if (!key) backTo(ABOUT_PATH, "Missing key.", false);
  const res = await setStoreFactActive(key, active, session.profile.id);
  await recordAudit({ actorId: session.profile.id, action: "kb.store_fact.toggle", entityType: "kb_store_fact", entityId: key, after: { active } }).catch(() => {});
  revalidatePath(ABOUT_PATH);
  backTo(ABOUT_PATH, res.ok ? (active ? "Fact is now in use." : "Fact hidden.") : res.message, res.ok);
}

/** Add or update a curated FAQ. */
export async function upsertKbFaqAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const slug = String(formData.get("slug") ?? "").trim();
  const question = String(formData.get("question") ?? "").trim();
  const answer = String(formData.get("answer") ?? "").trim();
  if (!slug) backTo(FAQ_PATH, "A slug is required.", false);
  if (!question) backTo(FAQ_PATH, "A question is required.", false);
  if (!answer) backTo(FAQ_PATH, "An answer is required.", false);
  const sortRaw = Number.parseInt(String(formData.get("sort_order") ?? ""), 10);
  const res = await upsertKbFaq(
    {
      slug,
      question,
      answer,
      category: String(formData.get("category") ?? "basics"),
      tags: csv(formData.get("tags"), { lower: true }),
      sort_order: Number.isFinite(sortRaw) ? sortRaw : 100,
      sources: csv(formData.get("sources")),
    },
    session.profile.id,
  );
  await recordAudit({
    actorId: session.profile.id,
    action: "kb.faq.upsert",
    entityType: "kb_faq",
    entityId: slug,
    after: { question },
  }).catch(() => {});
  revalidatePath(FAQ_PATH);
  backTo(FAQ_PATH, res.message, res.ok);
}

/** Show/hide an FAQ from the AI. */
export async function toggleKbFaqAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const slug = String(formData.get("slug") ?? "");
  const active = String(formData.get("active") ?? "") === "true";
  if (!slug) backTo(FAQ_PATH, "Missing slug.", false);
  const res = await setFaqActive(slug, active, session.profile.id);
  await recordAudit({ actorId: session.profile.id, action: "kb.faq.toggle", entityType: "kb_faq", entityId: slug, after: { active } }).catch(() => {});
  revalidatePath(FAQ_PATH);
  backTo(FAQ_PATH, res.ok ? (active ? "FAQ is now in use." : "FAQ hidden.") : res.message, res.ok);
}
