import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { getPostById, getNewsletterAsset, resolveHeroSrc } from "@/lib/cms/blog-store";
import { listBlogSuggestions } from "@/lib/cms/ai-blog";
import { isAiConfigured } from "@/lib/ai/provider";
import { checkCompliance } from "@/lib/ai/compliance";
import { BLOG_CATEGORIES } from "@/lib/cms/types";
import { BlogEditorClient, type BlogEditorInitial } from "@/components/admin/blog/BlogEditorClient";
import {
  updatePostAction,
  setPostStatusAction,
  deletePostAction,
  generateBlogAiAction,
  acceptBlogSuggestionAction,
  rejectBlogSuggestionAction,
} from "../actions";

export const dynamic = "force-dynamic";

// Shared solid pill styles (mirror the Button primitive) for the inline
// server-action <form> submit buttons on this page. Solid fill, rounded-full,
// uppercase, bold — matching the back-office button DNA. No white surfaces.
const PILL_BASE =
  "inline-flex items-center justify-center rounded-full px-3.5 py-1.5 text-[0.7rem] font-black uppercase tracking-[0.1em] transition disabled:cursor-not-allowed disabled:opacity-40";
const PILL_CONFIRM = `${PILL_BASE} bg-[var(--admin-accent)] text-black hover:brightness-110`;
const PILL_GOLD = `${PILL_BASE} bg-[var(--admin-gold)] text-black hover:brightness-110`;
const PILL_DANGER = `${PILL_BASE} bg-[var(--admin-danger)] text-black hover:brightness-110`;
const PILL_NEUTRAL = `${PILL_BASE} bg-[var(--admin-surface-2)] text-[var(--admin-text)] hover:bg-[var(--admin-surface-hover)]`;

export default async function BlogEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; ai?: string; topic?: string }>;
}) {
  await requirePermission("blog.manage");
  const { id } = await params;
  const { saved, ai, topic } = await searchParams;
  const topicSeed = (topic ?? "").slice(0, 300);

  if (!isSupabaseServiceConfigured) notFound();
  const post = await getPostById(id);
  if (!post) notFound();

  const newsletter = post.kind === "newsletter" ? await getNewsletterAsset(id) : null;
  const pending = await listBlogSuggestions(id, "pending");
  const heroSrc = await resolveHeroSrc(post.hero_media_id, post.hero_image_path);

  const initial: BlogEditorInitial = {
    id,
    title: post.title,
    slug: post.slug,
    category: post.category,
    kind: post.kind,
    author: post.author,
    excerpt: post.excerpt ?? "",
    body: (post.body ?? []).join("\n\n"),
    heroImageSrc: heroSrc,
    heroImageAlt: post.hero_image_alt ?? "",
    dateLabel: post.date_label ?? "",
    publishDate: post.publish_date ? post.publish_date.slice(0, 16) : "",
    titleFont: post.title_font ?? "inherit",
    titleSize: post.title_size ?? "md",
    titleColor: post.title_color ?? "",
    seoTitle: post.seo_title ?? "",
    seoDescription: post.seo_description ?? "",
    canonicalPath: post.canonical_path ?? "",
    noindex: post.noindex,
    newsletterPagePaths: (newsletter?.page_paths ?? []).join("\n"),
    heroImagePath: post.hero_image_path,
  };

  return (
    <div>
      <AdminPageHeader
        title={post.title}
        subtitle={`/${post.slug} · ${post.category} · ${post.kind} · ${post.status}`}
        action={
          <div className="flex items-center gap-3">
            {post.status === "published" && (
              <Link
                href={`/blog/${post.slug}`}
                target="_blank"
                className="text-sm text-[var(--admin-accent)] hover:brightness-110"
              >
                View on site ↗
              </Link>
            )}
            <Link href="/admin/blog" className="text-sm text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]">
              ← Back to posts
            </Link>
          </div>
        }
      />

      <div className="mx-auto w-full max-w-5xl space-y-6 px-5 py-6 sm:px-8">
        {saved && (
          <div className="rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">
            Saved.
          </div>
        )}
        {ai && (
          <div className="rounded-lg border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] px-4 py-2 text-sm text-[var(--admin-gold)]">
            AI draft generated — review and Accept/Reject below.
          </div>
        )}

        {/* Publish controls */}
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--admin-text-faint)]">
            Status: {post.status}
          </span>
          {(["draft", "scheduled", "published", "archived"] as const).map((s) => (
            <form key={s} action={setPostStatusAction}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="status" value={s} />
              <button
                type="submit"
                disabled={post.status === s}
                className={s === "published" ? PILL_CONFIRM : PILL_NEUTRAL}
              >
                {s === "published" ? "Publish" : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            </form>
          ))}
          <form action={deletePostAction} className="ml-auto">
            <input type="hidden" name="id" value={id} />
            <button type="submit" className={PILL_DANGER}>
              Delete
            </button>
          </form>
        </div>

        {/* AI assist panel (body + SEO drafts, persisted, Accept/Reject) */}
        {isAiConfigured && (
          <div className="rounded-xl border border-[var(--admin-gold)]/25 bg-[var(--admin-gold-soft)] p-4">
            <h2 className="text-sm font-black uppercase tracking-[0.14em] text-[var(--admin-gold)]">✨ Write with AI (drafts only)</h2>
            <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
              Generates a compliant draft you can Accept or Reject. Nothing publishes automatically.
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              <form action={generateBlogAiAction} className="flex flex-1 flex-wrap items-center gap-2">
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="ai_kind" value="body" />
                <input
                  name="topic"
                  defaultValue={topicSeed}
                  placeholder="Optional topic / angle for the draft"
                  className="min-w-[16rem] flex-1 rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-1.5 text-xs text-[var(--admin-text)] outline-none focus:border-[var(--admin-gold)]"
                />
                <button type="submit" className={PILL_GOLD}>
                  Draft body
                </button>
              </form>
              <form action={generateBlogAiAction}>
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="ai_kind" value="seo" />
                <button type="submit" className={PILL_GOLD}>
                  Suggest SEO
                </button>
              </form>
            </div>

            {pending.length > 0 && (
              <div className="mt-4 space-y-3">
                {pending.map((s) => {
                  const flags = checkCompliance(s.suggested_value ?? "").flags;
                  return (
                    <div key={s.id} className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--admin-text-faint)]">
                          {s.field_key} · {s.model ?? "ai"}
                        </span>
                        {flags.length > 0 && (
                          <span className="rounded-full border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--admin-danger)]">
                            ⚠ {flags.length} compliance flag{flags.length > 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                      <pre className="mt-2 whitespace-pre-wrap text-sm text-[var(--admin-text-muted)]">
                        {s.suggested_value}
                      </pre>
                      {flags.length > 0 && (
                        <ul className="mt-2 list-disc pl-5 text-xs text-[var(--admin-danger)]/80">
                          {flags.map((f, i) => (
                            <li key={i}>{f}</li>
                          ))}
                        </ul>
                      )}
                      <div className="mt-3 flex gap-2">
                        <form action={acceptBlogSuggestionAction}>
                          <input type="hidden" name="id" value={id} />
                          <input type="hidden" name="suggestion_id" value={s.id} />
                          <button type="submit" className={PILL_CONFIRM}>
                            Accept
                          </button>
                        </form>
                        <form action={rejectBlogSuggestionAction}>
                          <input type="hidden" name="id" value={id} />
                          <input type="hidden" name="suggestion_id" value={s.id} />
                          <button type="submit" className={PILL_NEUTRAL}>
                            Reject
                          </button>
                        </form>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Visual editor + live preview */}
        <BlogEditorClient
          initial={initial}
          categories={BLOG_CATEGORIES}
          aiEnabled={isAiConfigured}
          updateAction={updatePostAction}
        />
      </div>
    </div>
  );
}
