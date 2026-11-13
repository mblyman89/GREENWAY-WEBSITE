/**
 * src/lib/cms/culture-desk-server.ts — D237 N-6 (SOP-22 G-116; F-22-13, F-22-14 S1).
 *
 * The culture news desk, server side.
 *  - Regulatory Watch items (WSLCB) with their links, read from the table.
 *  - "Find news": grounded web search, ON DEMAND ONLY (Q-22-6 (a)). The
 *    results are shown to the person who asked, with their sources; nothing
 *    from the search is stored (only the reviewed draft is saved).
 *  - Vendor wins: the same on-demand search, about one vendor.
 *  - The health-topic guard (culture-desk-core) runs on the draft AND again
 *    whenever a CULTURE post is published (Publish now or a schedule).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { generateJSON, generateWebSearch, isAiConfigured, aiModelId } from "@/lib/ai/provider";
import { COMPLIANCE_SYSTEM, checkCompliance } from "@/lib/ai/compliance";
import { looseParseLookupJson } from "@/lib/inventory/product-lookup-parse";
import { blogGuardParagraphs } from "@/lib/blog/blog-blocks-core";
import {
  CULTURE_EXTRA_RULES,
  buildFindNewsPrompt,
  guardCultureText,
  newsFacts,
  parseFoundNews,
  regulatoryToNews,
  withGuardLines,
  type GuardResult,
  type NewsItem,
  type RegulatoryRow,
} from "./culture-desk-core";
import {
  buildDraftPrompt,
  checkDraft,
  draftText,
  draftToParagraphs,
  getTemplate,
  normalizeDraft,
  type DraftIssue,
  type PostDraft,
  type TemplateItem,
} from "./post-templates-core";

export { isAiConfigured };

const DESK_WSLCB_ROWS = 30;

/** Recent Regulatory Watch items that have a source link. */
export async function listDeskNews(): Promise<{ items: NewsItem[]; note: string | null }> {
  if (!isSupabaseServiceConfigured) return { items: [], note: "The database isn't configured on this deployment." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("regulatory_items")
    .select("id, title, url, published_at, body_text, status")
    .neq("status", "archived")
    .not("url", "is", null)
    .order("published_at", { ascending: false, nullsFirst: false })
    .range(0, DESK_WSLCB_ROWS - 1);
  if (error) return { items: [], note: "Regulatory Watch could not be read." };
  const rows = (data as RegulatoryRow[] | null) ?? [];
  // The latest analysis summary, when there is one (short, plain words).
  const ids = rows.map((r) => r.id);
  if (ids.length) {
    const { data: an } = await admin
      .from("regulatory_analyses")
      .select("item_id, summary, created_at")
      .in("item_id", ids)
      .order("created_at", { ascending: false })
      .range(0, 199);
    const seen = new Set<string>();
    for (const a of (an as { item_id: string; summary: string }[] | null) ?? []) {
      if (seen.has(a.item_id)) continue;
      seen.add(a.item_id);
      const r = rows.find((x) => x.id === a.item_id);
      if (r) r.summary = a.summary;
    }
  }
  return { items: regulatoryToNews(rows), note: null };
}

export type FindNewsOut =
  | { ok: true; items: NewsItem[]; sources: string[]; searchSuggestions: string[]; model: string; usedWebSearch: boolean }
  | { ok: false; error: string };

/** On demand only (Q-22-6 (a)). Nothing here is stored. */
export async function findNews(input: {
  kind: "web" | "vendor";
  topic: string;
  actorId: string | null;
  actorEmail: string | null;
}): Promise<FindNewsOut> {
  if (!isAiConfigured) return { ok: false, error: "AI is not configured. Set AI_API_KEY (or OPENAI_API_KEY) to find news." };
  if (input.kind === "vendor" && input.topic.trim().length < 2) return { ok: false, error: "Type the vendor or brand name first." };
  const ws = await generateWebSearch({
    system:
      "You are a careful news researcher for a licensed Washington cannabis retailer's blog. You only report news you actually found, with its exact link. You never make health or therapeutic claims.",
    user: buildFindNewsPrompt(input.kind, input.topic),
    maxTokens: 2500,
    context: { feature: `blog.culture.find_news.${input.kind}`, entityType: "blog", actorId: input.actorId, actorEmail: input.actorEmail },
  });
  const items = parseFoundNews(looseParseLookupJson(ws.text), ws.sources, input.kind);
  return {
    ok: true,
    items,
    sources: ws.sources,
    searchSuggestions: ws.searchSuggestions ?? [],
    model: ws.model,
    usedWebSearch: ws.usedWebSearch,
  };
}

export type CultureDraftOut =
  | { ok: true; draft: PostDraft; issues: DraftIssue[]; complianceFlags: string[]; guard: GuardResult; model: string; facts: string[] }
  | { ok: false; error: string };

function cultureItem(news: NewsItem, notes: string): TemplateItem {
  return { id: `news:${news.url}`, label: news.title, facts: newsFacts(news, notes), vendorIds: [], searchWords: [] };
}

/** Everything that will be published, for the guard. */
export function draftPublicText(title: string, d: PostDraft, body: string[]): string {
  return [title, d.excerpt, ...body].join("\n");
}

export async function draftCultureFromNews(input: {
  news: NewsItem;
  notes: string;
  actorId: string | null;
  actorEmail: string | null;
}): Promise<CultureDraftOut> {
  if (!isAiConfigured) return { ok: false, error: "AI is not configured. Set AI_API_KEY (or OPENAI_API_KEY) to draft posts." };
  const t = getTemplate("culture")!;
  const item = cultureItem(input.news, input.notes);
  const raw = await generateJSON<unknown>({
    system: COMPLIANCE_SYSTEM,
    user: `${buildDraftPrompt(t, item)}\n\nCULTURE RULES:\n${CULTURE_EXTRA_RULES}`,
    temperature: 0.5,
    maxTokens: 1400,
    context: { feature: "blog.culture.draft", entityType: "blog", actorId: input.actorId, actorEmail: input.actorEmail },
  });
  const draft = normalizeDraft(raw);
  return { ok: true, ...checkCultureDraft(input.news, input.notes, draft), draft, model: aiModelId, facts: item.facts };
}

/** N-5 rule checks + compliance flags + the health guard, on the text that will be saved. */
export function checkCultureDraft(
  news: NewsItem,
  notes: string,
  draft: PostDraft,
  title?: string,
): { issues: DraftIssue[]; complianceFlags: string[]; guard: GuardResult; body: string[] } {
  const t = getTemplate("culture")!;
  const item = cultureItem(news, notes);
  const head = title ?? draft.headlines[0] ?? "";
  const preGuard = guardCultureText([head, draft.excerpt, ...draftToParagraphs(draft)].join("\n"), { requireSource: true });
  // The source and the provider line are added by the desk, not left to the AI.
  const body = withGuardLines(draftToParagraphs(draft), [news.url], preGuard.health);
  const issues = checkDraft(t, item, { ...draft, headlines: head ? [head] : draft.headlines }).filter(
    (i) => !i.text.startsWith("The source link is not in the draft"),
  );
  const guard = guardCultureText(draftPublicText(head, draft, body), { requireSource: true });
  const complianceFlags = checkCompliance(draftText(draft)).flags;
  return { issues, complianceFlags, guard, body };
}

/** The guard on a saved post (used before it goes live). Non-culture posts pass. */
export function cultureGuardForPost(post: { category: string; title: string; excerpt: string | null; body: string[] }): GuardResult | null {
  if ((post.category ?? "").toUpperCase() !== "CULTURE") return null;
  // D239 N-7: picture addresses in image blocks are not sources.
  return guardCultureText([post.title, post.excerpt ?? "", ...blogGuardParagraphs(post.body ?? [])].join("\n"), { requireSource: true });
}

/** For the scheduled publish: read the post and run the guard. Returns a refusal reason or null. */
export async function cultureGuardRefusal(postId: string): Promise<string | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("blog_posts").select("category, title, excerpt, body").eq("id", postId).maybeSingle();
  if (error || !data) return null;
  const g = cultureGuardForPost(data as { category: string; title: string; excerpt: string | null; body: string[] });
  if (!g || g.blocking.length === 0) return null;
  return `Culture health guard: ${g.blocking.join(" ")}`;
}
