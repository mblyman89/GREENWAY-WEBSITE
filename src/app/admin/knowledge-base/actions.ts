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
} from "@/lib/ai/kb/store";
import { validateNoteInput } from "@/lib/ai/kb/kb-notes-core";
import { canonicalStrainType } from "@/lib/menu/strain-taxonomy";
import {
  upsertImageSubstitute,
  setSubstituteActive,
  deleteImageSubstitute,
  type SubstituteScope,
} from "@/lib/ai/kb/image-substitutes";

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
