"use server";

/**
 * D244 R-23: the Compliance guardrails page actions (owner round 10: "I need
 * to be in control, and if I choose something is ok to do, thats my choice
 * ... so I can fine tune them myself and enable and disable them as I see
 * fit").
 *
 * Built-in rules: Block / Warn / Off per rule, reset one, reset all.
 * Allowed words: words and phrases every rule skips.
 * Owner phrases (kb_banned_phrases): change level and reason, delete.
 *
 * Every change is saved in one site_settings row (no migration; KEEP on
 * factory reset), takes effect on the next check, and is written to the
 * audit log.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { getGuardrailsForEdit, saveGuardrails } from "@/lib/ai/guardrails-server";
import { ruleByKey } from "@/lib/ai/guardrails-catalog-core";
import {
  cleanAllowWord,
  emptyGuardrails,
  isGuardrailLevel,
  withAllowWord,
  withRuleLevel,
  withoutAllowWord,
  ALLOW_LIST_MAX,
} from "@/lib/ai/guardrails-state-core";
import { addBannedPhrase, setBannedActive, updateBannedPhrase, deleteBannedPhrase } from "@/lib/ai/kb/store";
import { seedMedicalBannedPhrases } from "@/lib/ai/kb/seed-banned";

const PAGE = "/admin/knowledge-base/compliance";

function backHere(message: string, ok = true, anchor = ""): never {
  const key = ok ? "msg" : "error";
  redirect(`${PAGE}?${key}=${encodeURIComponent(message)}${anchor ? `#${anchor}` : ""}`);
}

const LEVEL_WORD: Record<string, string> = { block: "Block", warn: "Warn", off: "Off" };

/** Set one built-in rule to Block / Warn / Off, or back to its built-in level ("default"). */
export async function setGuardrailLevelAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const key = String(formData.get("key") ?? "");
  const raw = String(formData.get("level") ?? "");
  const rule = ruleByKey(key);
  if (!rule) backHere("That rule was not found. Reload the page and try again.", false);
  const level = raw === "default" ? null : isGuardrailLevel(raw) && rule.levels.includes(raw) ? raw : undefined;
  if (level === undefined) backHere(`\u201c${rule.name}\u201d cannot be set to that.`, false, `rule-${key}`);
  const before = await getGuardrailsForEdit();
  const next = withRuleLevel(before, key, level, rule.builtIn);
  const res = await saveGuardrails(next, session.profile.id);
  if (!res.ok) backHere(`Could not save: ${res.error ?? "unknown error"}`, false, `rule-${key}`);
  await recordAudit({
    actorId: session.profile.id,
    action: "kb.guardrails.level",
    entityType: "site_settings",
    entityId: key,
    before: { level: before.rules[key] ?? rule.builtIn },
    after: { level: level ?? rule.builtIn, builtIn: rule.builtIn },
  }).catch(() => {});
  revalidatePath(PAGE);
  backHere(
    level === null ? `\u201c${rule.name}\u201d is back to its built-in level (${LEVEL_WORD[rule.builtIn]}).` : `\u201c${rule.name}\u201d is now ${LEVEL_WORD[level]}.`,
    true,
    `rule-${key}`,
  );
}

/** Put every built-in rule back to its built-in level. Allowed words stay unless asked. */
export async function resetAllGuardrailsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  if (String(formData.get("confirm") ?? "") !== "yes") backHere("Tick the box to confirm the reset.", false, "reset");
  const alsoAllow = String(formData.get("allow") ?? "") === "yes";
  const before = await getGuardrailsForEdit();
  const next = alsoAllow ? emptyGuardrails() : { ...emptyGuardrails(), allow: [...before.allow] };
  const res = await saveGuardrails(next, session.profile.id);
  if (!res.ok) backHere(`Could not save: ${res.error ?? "unknown error"}`, false, "reset");
  await recordAudit({
    actorId: session.profile.id,
    action: "kb.guardrails.reset_all",
    entityType: "site_settings",
    entityId: "compliance_guardrails",
    before: { rules: before.rules, allow: before.allow },
    after: { rules: {}, allow: next.allow },
  }).catch(() => {});
  revalidatePath(PAGE);
  backHere(alsoAllow ? "Every rule is back to its built-in level and the allowed words were cleared." : "Every rule is back to its built-in level.", true, "reset");
}

/** Allow one or more words or phrases everywhere (one per line or comma). */
export async function addAllowedWordAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const words = String(formData.get("words") ?? "")
    .split(/[\n,]+/)
    .map(cleanAllowWord)
    .filter(Boolean);
  if (words.length === 0) backHere("Type a word or phrase to allow (80 characters at most).", false, "allowed");
  const before = await getGuardrailsForEdit();
  let next = before;
  for (const w of words) next = withAllowWord(next, w);
  const added = next.allow.filter((w) => !before.allow.includes(w));
  if (added.length === 0) {
    backHere(before.allow.length >= ALLOW_LIST_MAX ? `The allowed list is full (${ALLOW_LIST_MAX}).` : "Those words are already allowed.", false, "allowed");
  }
  const res = await saveGuardrails(next, session.profile.id);
  if (!res.ok) backHere(`Could not save: ${res.error ?? "unknown error"}`, false, "allowed");
  await recordAudit({
    actorId: session.profile.id,
    action: "kb.guardrails.allow_add",
    entityType: "site_settings",
    entityId: "compliance_guardrails",
    after: { added },
  }).catch(() => {});
  revalidatePath(PAGE);
  backHere(`Allowed: ${added.map((w) => `\u201c${w}\u201d`).join(", ")}.`, true, "allowed");
}

export async function removeAllowedWordAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const word = cleanAllowWord(formData.get("word"));
  if (!word) backHere("Missing word.", false, "allowed");
  const before = await getGuardrailsForEdit();
  if (!before.allow.includes(word)) backHere(`\u201c${word}\u201d was not on the allowed list.`, false, "allowed");
  const res = await saveGuardrails(withoutAllowWord(before, word), session.profile.id);
  if (!res.ok) backHere(`Could not save: ${res.error ?? "unknown error"}`, false, "allowed");
  await recordAudit({
    actorId: session.profile.id,
    action: "kb.guardrails.allow_remove",
    entityType: "site_settings",
    entityId: "compliance_guardrails",
    before: { word },
  }).catch(() => {});
  revalidatePath(PAGE);
  backHere(`\u201c${word}\u201d is checked again.`, true, "allowed");
}

/** Change one of the owner's own phrases: level (block / warn) and reason. */
export async function updateBannedPhraseAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const id = String(formData.get("id") ?? "");
  const severity = String(formData.get("severity") ?? "") === "warn" ? "warn" : "block";
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 300) || null;
  if (!id) backHere("Missing phrase id.", false, "phrases");
  try {
    await updateBannedPhrase(id, severity, reason);
  } catch (e) {
    backHere(`Could not save: ${e instanceof Error ? e.message : "unknown error"}`, false, "phrases");
  }
  await recordAudit({ actorId: session.profile.id, action: "kb.banned.update", entityType: "kb_banned_phrase", entityId: id, after: { severity, reason } }).catch(() => {});
  revalidatePath(PAGE);
  backHere("Phrase saved.", true, "phrases");
}

export async function deleteBannedPhraseAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const id = String(formData.get("id") ?? "");
  const phrase = String(formData.get("phrase") ?? "").slice(0, 200);
  if (!id) backHere("Missing phrase id.", false, "phrases");
  try {
    await deleteBannedPhrase(id);
  } catch (e) {
    backHere(`Could not delete: ${e instanceof Error ? e.message : "unknown error"}`, false, "phrases");
  }
  await recordAudit({ actorId: session.profile.id, action: "kb.banned.delete", entityType: "kb_banned_phrase", entityId: id, before: { phrase } }).catch(() => {});
  revalidatePath(PAGE);
  backHere(phrase ? `\u201c${phrase}\u201d deleted.` : "Phrase deleted.", true, "phrases");
}

/** Add (or refresh) one of the owner's own phrases; returns to this page. */
export async function addOwnerPhraseAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const phrase = String(formData.get("phrase") ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  const severity = String(formData.get("severity") ?? "block") === "warn" ? "warn" : "block";
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 300) || null;
  if (!phrase) backHere("Please type a phrase.", false, "phrases");
  try {
    await addBannedPhrase(phrase, severity, reason, session.profile.id);
  } catch (e) {
    backHere(`Could not save: ${e instanceof Error ? e.message : "unknown error"}`, false, "phrases");
  }
  await recordAudit({ actorId: session.profile.id, action: "kb.banned.add", entityType: "kb_banned_phrase", entityId: phrase, after: { severity, reason } }).catch(() => {});
  revalidatePath(PAGE);
  backHere(`\u201c${phrase}\u201d added (${severity === "warn" ? "Warn" : "Block"}).`, true, "phrases");
}

/** Turn one of the owner's phrases on or off; returns to this page. */
export async function toggleOwnerPhraseAction(formData: FormData): Promise<void> {
  const session = await requirePermission("products.enrich");
  const id = String(formData.get("id") ?? "");
  const active = String(formData.get("active") ?? "") === "true";
  if (!id) backHere("Missing phrase id.", false, "phrases");
  try {
    await setBannedActive(id, active);
  } catch (e) {
    backHere(`Could not save: ${e instanceof Error ? e.message : "unknown error"}`, false, "phrases");
  }
  await recordAudit({ actorId: session.profile.id, action: "kb.banned.toggle", entityType: "kb_banned_phrase", entityId: id, after: { active } }).catch(() => {});
  revalidatePath(PAGE);
  backHere(active ? "Phrase turned on." : "Phrase turned off.", true, "phrases");
}

/**
 * Add any missing starter medical phrases. Phrases already in the list are
 * left exactly as they are (on/off, level, reason), so this never undoes a
 * choice the owner made.
 */
export async function seedMedicalHereAction(): Promise<void> {
  const session = await requirePermission("products.enrich");
  const res = await seedMedicalBannedPhrases(session.profile.id);
  await recordAudit({
    actorId: session.profile.id,
    action: "kb.banned.seed_medical",
    entityType: "kb_banned_phrases",
    after: { attempted: res.attempted, ok: res.ok, error: res.error ?? null },
  }).catch(() => {});
  revalidatePath(PAGE);
  backHere(res.ok ? "Missing starter phrases added. Phrases you already had were not changed." : `Could not add them: ${res.error ?? "unknown error"}`, res.ok, "phrases");
}
