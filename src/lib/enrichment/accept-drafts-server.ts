/**
 * src/lib/enrichment/accept-drafts-server.ts  (D244 E-5)
 *
 * The ONE place an accepted AI draft is written to a product. Shared by the
 * product page (Accept, "Accept all >= 80%", D244 E-4) and the Bulk AI review
 * grid (per-product "Accept all >= 80%" and "Accept all >= 80% & publish",
 * D244 E-5), so a fix to one fixes both. Moved here unchanged from
 * src/app/admin/products/actions.ts (a "use server" file may only export
 * actions, and the grid needs the same writer).
 *
 * Every accept still goes through acceptWithComplianceGate first. Round 2
 * owner answers (verbatim): Q3 "lets drop it to 80%."; Q4 "best guesses
 * should auto accepted, but flagged so we can take a closer look once we
 * have time to." An accepted best guess keeps `|best-guess` on its row, so
 * listNeedsCloserLook finds it until a person presses "Looks right"
 * (markBestGuessChecked adds `|checked`).
 */
import "server-only";
import { ensureEnrichment, updateEnrichment } from "@/lib/enrichment/store";
import { listSuggestions, reviewSuggestion } from "@/lib/ai/suggestions";
import type { AiSuggestion } from "@/lib/enrichment/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { acceptWithComplianceGate } from "@/lib/ai/accept-gate";
import { writeBackOnPublish } from "@/lib/ai/kb/writeback";
import { ALLOWED_PRODUCT_TAGS } from "@/lib/ai/schemas/product";
import { SEO_FIELD_KEY, parseSeoSuggestion } from "@/lib/enrichment/seo-draft-core";
import {
  ACCEPT_ALL_THRESHOLD,
  acceptAllEligible,
  markCheckedSource,
  needsCloserLook,
  parseEvidenceSource,
  type SuggestionLite,
} from "@/lib/enrichment/ai-draft-v2-core";
import { canonicalStrainType } from "@/lib/menu/strain-taxonomy";
import { parsePotencyText, potencyCardPatch } from "@/lib/enrichment/lot-evidence-core";
import { writeCardFacts } from "@/lib/enrichment/card-facts-write-server";
import { resolveDraftEdit } from "@/lib/enrichment/draft-edit-core";
import { checkEffects } from "@/lib/ai/compliance";
import { loadBannedPhrases } from "@/lib/ai/kb/retrieval";

const TAGS = new Set<string>(ALLOWED_PRODUCT_TAGS);

/**
 * Write an accepted suggestion's value to the enrichment. Returns an error
 * sentence (nothing written) or null. Shared by Accept and "Accept all".
 */
export async function applyAcceptedValue(
  key: string,
  sugg: { field_key: string; suggested_value: string | null },
  userId: string,
): Promise<string | null> {
  if (sugg.field_key === SEO_FIELD_KEY) {
    // R23 (fix 4): one "seo" suggestion carries both parts; re-cleaned here
    // so a row edited in the database can never exceed the length rules.
    const seo = parseSeoSuggestion(sugg.suggested_value);
    if (!seo) return "That SEO draft could not be read. Draft it again.";
    await ensureEnrichment(key, {}, userId);
    await updateEnrichment(key, { seo_title: seo.title, seo_description: seo.description }, userId);
    return null;
  }
  // D244 R-2: strain type + potency are CARD facts (menu_items), stamped
  // "reviewer" because a person accepted them.
  if (sugg.field_key === "strain_type") {
    const t = canonicalStrainType(sugg.suggested_value);
    if (t === "unknown") return "That strain type draft could not be read. Draft it again.";
    const w = await writeCardFacts(key, { strain_type: t });
    return w.ok ? null : w.error;
  }
  if (sugg.field_key === "potency") {
    const p = parsePotencyText(sugg.suggested_value);
    if (!p.ok) return p.error;
    const w = await writeCardFacts(key, potencyCardPatch(p.value));
    return w.ok ? null : w.error;
  }
  await ensureEnrichment(key, {}, userId);
  if (sugg.field_key === "description") {
    await updateEnrichment(key, { description: sugg.suggested_value }, userId);
  } else if (sugg.field_key === "display_name" || sugg.field_key === "short_description") {
    // D244 E-4: the all-fields draft also proposes these two.
    const v = String(sugg.suggested_value ?? "").trim();
    if (!v) return "That draft is empty. Draft it again.";
    await updateEnrichment(key, { [sugg.field_key]: v } as Parameters<typeof updateEnrichment>[1], userId);
  } else if (sugg.field_key === "tags") {
    const tags = (sugg.suggested_value ?? "")
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter((t) => TAGS.has(t));
    await updateEnrichment(key, { tags }, userId);
  }
  // sensory + effects have no enrichment column; they are validated facts that
  // live on the accepted suggestion and are promoted to the KB (on accept here
  // and again on publish via writeBackOnPublish). No enrichment write needed.
  return null;
}

export type AcceptAllOutcome =
  | { ok: false; error: string }
  | {
      ok: true;
      eligible: number;
      accepted: string[];
      blocked: string[];
      /** Accepted fields that were best guesses (flagged for a closer look). */
      flagged: string[];
      writeback: Awaited<ReturnType<typeof writeBackOnPublish>>;
    };

/**
 * Accept every eligible draft (newest per field, >= ACCEPT_ALL_THRESHOLD, or
 * a best guess - accepted but flagged) for ONE product, each through the
 * compliance gate. Never throws for a single field: a blocked or unreadable
 * one is named in blocked.
 */
export async function acceptHighConfidenceForKey(key: string, userId: string): Promise<AcceptAllOutcome> {
  const pending = await listSuggestions("product", key, "pending").catch(() => null);
  if (!pending) return { ok: false, error: "The drafts could not be read just now. Nothing was accepted." };
  const ids = acceptAllEligible(pending as SuggestionLite[], ACCEPT_ALL_THRESHOLD);
  const byId = new Map(pending.map((p) => [p.id, p] as const));
  const accepted: string[] = [];
  const blocked: string[] = [];
  const flagged: string[] = [];
  for (const id of ids) {
    const sugg = byId.get(id)!;
    const gate = await acceptWithComplianceGate(sugg);
    if (!gate.ok) {
      blocked.push(sugg.field_key);
      continue;
    }
    const err = await applyAcceptedValue(key, sugg, userId);
    if (err) {
      blocked.push(sugg.field_key);
      continue;
    }
    await reviewSuggestion(id, "accepted", userId);
    accepted.push(sugg.field_key);
    if (parseEvidenceSource(sugg.source).bestGuess) flagged.push(sugg.field_key);
  }
  const writeback = accepted.length ? await writeBackOnPublish(key, userId) : null;
  return { ok: true, eligible: ids.length, accepted, blocked, flagged, writeback };
}

/** Source flag: a person typed over the draft before accepting it (D244 R-2). */
export const EDITED_FLAG = "edited";

export type EditAcceptOutcome =
  | { ok: false; error: string; audit?: Record<string, unknown> }
  | { ok: true; key: string; field: string; edited: boolean; audit: Record<string, unknown> };

/**
 * D244 R-2: accept ONE pending draft, optionally with the person's typed
 * edit (bulk grid and product page). The typed text is read back into the
 * field's stored shape (resolveDraftEdit), then the SAME gates as Accept:
 * compliance re-scan on the final text, effects re-gated, then
 * applyAcceptedValue. An edited row stores the person's text and gets
 * `|edited|checked` (a person looked at it, so it is not left in "Needs a
 * closer look"); the AI's original is kept in the audit. Status stays
 * "accepted" so every reader of accepted facts (KB writeback, sensory) sees it.
 */
export async function acceptDraftWithEdit(id: string, editedRaw: FormDataEntryValue | null, userId: string): Promise<EditAcceptOutcome> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase is not configured." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("ai_suggestions").select("*").eq("id", id).maybeSingle();
  if (error || !data) return { ok: false, error: "That draft could not be found." };
  const row = data as AiSuggestion;
  if (row.status !== "pending") return { ok: false, error: "That draft was already reviewed. Refresh the page." };
  const r = resolveDraftEdit(row.field_key, row.suggested_value, editedRaw, { allowedTags: ALLOWED_PRODUCT_TAGS });
  if (r.error) return { ok: false, error: r.error };
  let value = r.value;
  if (r.edited && row.field_key === "effects") {
    const gate = checkEffects(value.split(",").map((x) => x.trim()).filter(Boolean), await loadBannedPhrases().catch(() => []));
    if (gate.rejected.length) return { ok: false, error: `Not allowed as an effect: ${gate.rejected.map((x) => `"${x.effect}" (${x.reason})`).join(", ")}.` };
    value = gate.allowed.join(", ");
  }
  const gate = await acceptWithComplianceGate({ field_key: row.field_key, suggested_value: value });
  const audit = { suggestionId: id, field: row.field_key, edited: r.edited, ...(r.edited ? { original: row.suggested_value, value } : {}), ...gate.audit };
  if (!gate.ok) return { ok: false, error: gate.message, audit };
  const err = await applyAcceptedValue(row.entity_id, { field_key: row.field_key, suggested_value: value }, userId);
  if (err) return { ok: false, error: err, audit };
  if (r.edited) {
    const src = String(row.source ?? "");
    const next = src.startsWith("ai2:") ? `${markCheckedSource(src)}|${EDITED_FLAG}` : src || null;
    const up = await admin.from("ai_suggestions").update({ suggested_value: value, source: next }).eq("id", id);
    if (up.error) return { ok: false, error: "The edit was applied but the draft row did not save. Refresh and check.", audit };
  }
  await reviewSuggestion(id, "accepted", userId);
  return { ok: true, key: row.entity_id, field: row.field_key, edited: r.edited, audit };
}

export function acceptAllMessage(accepted: string[], blocked: string[], flagged: string[] = []): string {
  return `Accepted ${accepted.length} draft${accepted.length === 1 ? "" : "s"} (${ACCEPT_ALL_THRESHOLD}% or better, plus best guesses)${accepted.length ? `: ${accepted.join(", ")}` : ""}.${flagged.length ? ` ${flagged.length} best guess${flagged.length === 1 ? " is" : "es are"} live and flagged for a closer look (${flagged.join(", ")}).` : ""}${blocked.length ? ` Skipped ${blocked.join(", ")} - review those by hand.` : ""}`;
}

/** Most accepted rows scanned for the "Needs a closer look" list. */
export const CLOSER_LOOK_SCAN = 2000;

/**
 * Accepted best guesses nobody has checked yet, newest first. `entityId`
 * narrows to one product. Reads accepted product rows and filters in code
 * (the flag lives inside `source`). Returns null when the read fails, so a
 * page can say so instead of showing "nothing to check".
 */
export async function listNeedsCloserLook(opts: { entityId?: string; limit?: number } = {}): Promise<AiSuggestion[] | null> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    let q = admin
      .from("ai_suggestions")
      .select("*")
      .eq("entity_type", "product")
      .eq("status", "accepted")
      .not("source", "is", null)
      .order("created_at", { ascending: false })
      .limit(CLOSER_LOOK_SCAN);
    if (opts.entityId) q = q.eq("entity_id", opts.entityId);
    const { data, error } = await q;
    if (error) return null;
    const rows = ((data as AiSuggestion[] | null) ?? []).filter((r) => needsCloserLook(r));
    return opts.limit ? rows.slice(0, opts.limit) : rows;
  } catch {
    return null;
  }
}

/**
 * "Looks right": a person checked an accepted best guess. Adds `|checked` to
 * its source (it leaves the list; the badge and evidence stay) and stamps
 * reviewed_by / reviewed_at. Returns the product key, or an error sentence.
 */
export async function markBestGuessChecked(id: string, userId: string): Promise<{ ok: true; key: string; field: string } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase is not configured." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("ai_suggestions").select("id, entity_id, field_key, status, source").eq("id", id).maybeSingle();
  if (error || !data) return { ok: false, error: "That draft could not be found." };
  const row = data as { id: string; entity_id: string; field_key: string; status: string; source: string | null };
  if (row.status !== "accepted") return { ok: false, error: "Only an accepted draft can be marked as checked." };
  const next = markCheckedSource(row.source);
  if (!next) return { ok: false, error: "That is not an all-fields draft." };
  const { error: upErr } = await admin
    .from("ai_suggestions")
    .update({ source: next, reviewed_by: userId, reviewed_at: new Date().toISOString() })
    .eq("id", id);
  if (upErr) return { ok: false, error: upErr.message };
  return { ok: true, key: row.entity_id, field: row.field_key };
}
