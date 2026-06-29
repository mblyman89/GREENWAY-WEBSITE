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
} from "@/lib/ai/kb/store";

const PATH = "/admin/knowledge-base";

function back(message: string, ok = true): never {
  const key = ok ? "msg" : "error";
  redirect(`${PATH}?${key}=${encodeURIComponent(message)}`);
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
