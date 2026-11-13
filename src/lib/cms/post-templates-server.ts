/**
 * src/lib/cms/post-templates-server.ts — D237 N-5 (SOP-22 G-115; F-22-10, F-22-16).
 *
 * Server side of "New post from…". The facts are always re-read here from the
 * "This week at Greenway" feed (N-4, with the below-cost check); the browser
 * only sends the template, the item id and the staff notes. Drafts only:
 * nothing is published, and the person picks the headline, edits and saves.
 */
import "server-only";
import { generateJSON, isAiConfigured, aiModelId } from "@/lib/ai/provider";
import { COMPLIANCE_SYSTEM, checkCompliance } from "@/lib/ai/compliance";
import { readLibraryPickerAssets } from "@/lib/media/library-picker-server";
import { getThisWeekFeed } from "./this-week-feed-server";
import {
  buildDraftPrompt,
  checkDraft,
  getTemplate,
  normalizeDraft,
  suggestPictures,
  templateItems,
  withNotes,
  draftText,
  type DraftIssue,
  type PictureSuggestion,
  type PostDraft,
  type PostTemplate,
  type PostTemplateKey,
  type TemplateItem,
} from "./post-templates-core";

export { isAiConfigured };

export type TemplateItemsOut =
  | { ok: true; items: { id: string; label: string; facts: string[] }[]; held: { label: string; reason: string }[]; partial: boolean }
  | { ok: false; error: string };

export async function loadTemplateItems(key: string): Promise<TemplateItemsOut> {
  const t = getTemplate(key);
  if (!t) return { ok: false, error: "Pick a post type." };
  const { feed, partial } = await getThisWeekFeed({ withBelowCost: true });
  const r = templateItems(t.key, feed);
  return { ok: true, items: r.items.map((i) => ({ id: i.id, label: i.label, facts: i.facts })), held: r.held, partial };
}

/** Rebuild one item from the live feed plus the notes. */
export async function resolveItem(
  key: string,
  itemId: string,
  notes: string,
): Promise<{ ok: true; t: PostTemplate; item: TemplateItem } | { ok: false; error: string }> {
  const t = getTemplate(key);
  if (!t) return { ok: false, error: "Pick a post type." };
  const { feed } = await getThisWeekFeed({ withBelowCost: true });
  const r = templateItems(t.key as PostTemplateKey, feed);
  const base = r.items.find((i) => i.id === itemId);
  if (!base) {
    const held = r.held.length ? ` ${r.held.map((h) => `${h.label}: ${h.reason}`).join(" ")}` : "";
    return { ok: false, error: `That item is no longer in this week's facts. Reload and pick again.${held}` };
  }
  const n = withNotes(t, base, notes);
  if ("error" in n) return { ok: false, error: n.error };
  return { ok: true, t, item: n.item };
}

export type TemplateDraftOut =
  | {
      ok: true;
      draft: PostDraft;
      issues: DraftIssue[];
      complianceFlags: string[];
      pictures: PictureSuggestion[];
      category: string;
      model: string;
      facts: string[];
    }
  | { ok: false; error: string };

export async function draftFromTemplate(input: {
  key: string;
  itemId: string;
  notes: string;
  actorId: string | null;
  actorEmail: string | null;
}): Promise<TemplateDraftOut> {
  if (!isAiConfigured) return { ok: false, error: "AI is not configured. Set AI_API_KEY (or OPENAI_API_KEY) to draft posts." };
  const r = await resolveItem(input.key, input.itemId, input.notes);
  if (!r.ok) return r;
  const raw = await generateJSON<unknown>({
    system: COMPLIANCE_SYSTEM,
    user: buildDraftPrompt(r.t, r.item),
    temperature: 0.6,
    maxTokens: 1400,
    context: { feature: `blog.ai.template.${r.t.key}`, entityType: "blog", actorId: input.actorId, actorEmail: input.actorEmail },
  });
  const draft = normalizeDraft(raw);
  const issues = checkDraft(r.t, r.item, draft);
  const complianceFlags = checkCompliance(draftText(draft)).flags;
  let pictures: PictureSuggestion[] = [];
  try {
    const lib = await readLibraryPickerAssets("all", {
      vendorIds: r.item.vendorIds,
      query: r.item.searchWords.slice(0, 6).join(" ") || null,
    });
    if (lib.ok) pictures = suggestPictures(lib.assets, r.item);
  } catch {
    pictures = [];
  }
  return { ok: true, draft, issues, complianceFlags, pictures, category: r.t.category, model: aiModelId, facts: r.item.facts };
}

/** The final check when a person saves the edited draft. */
export async function checkFinalDraft(
  key: string,
  itemId: string,
  notes: string,
  draft: PostDraft,
): Promise<{ ok: true; t: PostTemplate; issues: DraftIssue[]; complianceFlags: string[]; blocking: string[] } | { ok: false; error: string }> {
  const r = await resolveItem(key, itemId, notes);
  if (!r.ok) return r;
  const issues = checkDraft(r.t, r.item, draft);
  const c = checkCompliance(draftText(draft));
  const blocking = [...issues.filter((i) => i.level === "must-fix").map((i) => i.text), ...c.blockingFlags.map((f) => `${f} (must fix)`)];
  return { ok: true, t: r.t, issues, complianceFlags: c.flags, blocking };
}
