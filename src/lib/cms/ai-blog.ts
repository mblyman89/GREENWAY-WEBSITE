/**
 * src/lib/cms/ai-blog.ts
 *
 * AI DRAFT assist for the blog/newsletter CMS (Slice 5). Generates compliant
 * draft body copy and SEO title/description from a post brief. Every output is
 * a suggestion persisted in `ai_suggestions` and shown for staff Accept/Reject
 * — nothing is auto-published, same gate as the menu.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { generate, isAiConfigured, aiModelId } from "@/lib/ai/provider";
import { COMPLIANCE_SYSTEM, PROMPT_VERSION, checkCompliance } from "@/lib/ai/compliance";
import type { AiSuggestion, AiSuggestionStatus } from "@/lib/enrichment/types";

export { isAiConfigured };

export type PostBrief = {
  title: string;
  category: string;
  topic?: string | null;
};

export type GeneratedBlogSuggestion = {
  suggestion: AiSuggestion;
  complianceFlags: string[];
};

function bodyPrompt(brief: PostBrief): { user: string; inputSummary: string } {
  const lines = [
    `Title: ${brief.title}`,
    `Category: ${brief.category}`,
    brief.topic ? `Topic / notes: ${brief.topic}` : null,
  ].filter(Boolean);
  const user = `Write a short blog article for a licensed Washington cannabis retailer's website, following all rules. Return 2-4 plain-text paragraphs separated by a blank line. No headings, no lists, no markdown. Keep it tasteful, educational, and adult-oriented. Do not mention price, stock, or specific inventory.\n\n${lines.join("\n")}`;
  return { user, inputSummary: lines.join(" · ") };
}

function seoPrompt(brief: PostBrief): { user: string; inputSummary: string } {
  const lines = [
    `Title: ${brief.title}`,
    `Category: ${brief.category}`,
    brief.topic ? `Topic / notes: ${brief.topic}` : null,
  ].filter(Boolean);
  const user = `Write SEO metadata for a blog post on a licensed Washington cannabis retailer's website, following all rules. Return exactly two lines:\nTITLE: <an SEO title, 50-60 characters>\nDESCRIPTION: <a meta description, 140-160 characters>\nNo other text.\n\n${lines.join("\n")}`;
  return { user, inputSummary: lines.join(" · ") };
}

type PersistInput = {
  entityId: string;
  fieldKey: string;
  value: string;
  inputSummary: string;
  generatedBy: string | null;
};

async function persist(input: PersistInput): Promise<AiSuggestion> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("ai_suggestions")
    .insert({
      entity_type: "blog",
      entity_id: input.entityId,
      field_key: input.fieldKey,
      suggested_value: input.value,
      status: "pending",
      model: aiModelId,
      prompt_version: PROMPT_VERSION,
      input_summary: input.inputSummary,
      generated_by: input.generatedBy,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`ai_suggestions insert failed: ${error?.message}`);
  return data as AiSuggestion;
}

/** Draft a blog body (paragraphs joined by blank lines) as a suggestion. */
export async function generateBlogBody(
  postId: string,
  brief: PostBrief,
  generatedBy: string | null,
): Promise<GeneratedBlogSuggestion> {
  const { user, inputSummary } = bodyPrompt(brief);
  const text = await generate({ system: COMPLIANCE_SYSTEM, user, temperature: 0.7, maxTokens: 500 });
  const compliance = checkCompliance(text);
  const suggestion = await persist({
    entityId: postId,
    fieldKey: "body",
    value: text,
    inputSummary,
    generatedBy,
  });
  return { suggestion, complianceFlags: compliance.flags };
}

/** Draft SEO title + description (stored as "TITLE:.../DESCRIPTION:...") . */
export async function generateBlogSeo(
  postId: string,
  brief: PostBrief,
  generatedBy: string | null,
): Promise<GeneratedBlogSuggestion> {
  const { user, inputSummary } = seoPrompt(brief);
  const text = await generate({ system: COMPLIANCE_SYSTEM, user, temperature: 0.5, maxTokens: 160 });
  const compliance = checkCompliance(text);
  const suggestion = await persist({
    entityId: postId,
    fieldKey: "seo",
    value: text,
    inputSummary,
    generatedBy,
  });
  return { suggestion, complianceFlags: compliance.flags };
}

export async function listBlogSuggestions(
  postId: string,
  status?: AiSuggestionStatus,
): Promise<AiSuggestion[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  let q = admin
    .from("ai_suggestions")
    .select("*")
    .eq("entity_type", "blog")
    .eq("entity_id", postId)
    .order("created_at", { ascending: false });
  if (status) q = q.eq("status", status);
  const { data } = await q;
  return (data as AiSuggestion[] | null) ?? [];
}

export async function reviewBlogSuggestion(
  id: string,
  status: AiSuggestionStatus,
  reviewedBy: string | null,
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("ai_suggestions")
    .update({ status, reviewed_by: reviewedBy, reviewed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function getBlogSuggestion(id: string): Promise<AiSuggestion | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("ai_suggestions").select("*").eq("id", id).maybeSingle();
  return (data as AiSuggestion | null) ?? null;
}

/**
 * Draft concise, descriptive alt text for a post's hero image. Returns a plain
 * suggestion (not persisted) for the editor to accept/edit before saving.
 * Drafts-only: never written to the post automatically.
 */
export async function generateHeroAltText(
  title: string,
  category: string,
): Promise<{ value: string; complianceFlags: string[]; model: string }> {
  const user = `Write ALT TEXT for the hero image of a blog post on a licensed Washington cannabis retailer's website, following all rules. The alt text describes the image for screen-reader users and SEO. Return ONE plain sentence, 8-16 words, no quotes, no "image of"/"photo of" prefix, tasteful and adult-oriented.\n\nPost title: ${title}\nCategory: ${category}`;
  const text = await generate({ system: COMPLIANCE_SYSTEM, user, temperature: 0.5, maxTokens: 60 });
  const clean = text.trim().replace(/^["'`]+|["'`]+$/g, "").replace(/\s+/g, " ").trim();
  const compliance = checkCompliance(clean);
  return { value: clean, complianceFlags: compliance.flags, model: aiModelId };
}

/** Parse a "TITLE: ...\nDESCRIPTION: ..." SEO suggestion into parts. */
export function parseSeoSuggestion(value: string): { title: string; description: string } {
  const titleMatch = value.match(/TITLE:\s*(.+)/i);
  const descMatch = value.match(/DESCRIPTION:\s*([\s\S]+)/i);
  return {
    title: (titleMatch?.[1] ?? "").trim(),
    description: (descMatch?.[1] ?? "").trim(),
  };
}
