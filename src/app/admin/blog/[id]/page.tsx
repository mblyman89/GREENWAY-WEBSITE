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

export default async function BlogEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; ai?: string }>;
}) {
  await requirePermission("blog.manage");
  const { id } = await params;
  const { saved, ai } = await searchParams;

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
                className="text-sm text-[#7ed957] hover:text-[#6bc746]"
              >
                View on site ↗
              </Link>
            )}
            <Link href="/admin/blog" className="text-sm text-white/60 hover:text-white">
              ← Back to posts
            </Link>
          </div>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {saved && (
          <div className="rounded-lg border border-[#7ed957]/40 bg-[#7ed957]/10 px-4 py-2 text-sm text-[#7ed957]">
            Saved.
          </div>
        )}
        {ai && (
          <div className="rounded-lg border border-[#ffd700]/40 bg-[#ffd700]/10 px-4 py-2 text-sm text-[#ffd700]">
            AI draft generated — review and Accept/Reject below.
          </div>
        )}

        {/* Publish controls */}
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-[#0a0a0a] p-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-white/40">
            Status: {post.status}
          </span>
          {(["draft", "scheduled", "published", "archived"] as const).map((s) => (
            <form key={s} action={setPostStatusAction}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="status" value={s} />
              <button
                type="submit"
                disabled={post.status === s}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition disabled:opacity-30 ${
                  s === "published"
                    ? "bg-[#7ed957] text-black hover:bg-[#6bc746]"
                    : "border border-white/15 text-white/70 hover:bg-white/10"
                }`}
              >
                {s === "published" ? "Publish" : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            </form>
          ))}
          <form action={deletePostAction} className="ml-auto">
            <input type="hidden" name="id" value={id} />
            <button
              type="submit"
              className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-bold text-red-400 hover:bg-red-500/10"
            >
              Delete
            </button>
          </form>
        </div>

        {/* AI assist panel (body + SEO drafts, persisted, Accept/Reject) */}
        {isAiConfigured && (
          <div className="rounded-xl border border-[#ffd700]/25 bg-[#ffd700]/5 p-4">
            <h2 className="text-sm font-bold text-[#ffd700]">✨ Write with AI (drafts only)</h2>
            <p className="mt-1 text-xs text-white/50">
              Generates a compliant draft you can Accept or Reject. Nothing publishes automatically.
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              <form action={generateBlogAiAction} className="flex flex-1 flex-wrap items-center gap-2">
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="ai_kind" value="body" />
                <input
                  name="topic"
                  placeholder="Optional topic / angle for the draft"
                  className="min-w-[16rem] flex-1 rounded-lg border border-white/15 bg-black px-3 py-1.5 text-xs text-white outline-none focus:border-[#ffd700]"
                />
                <button
                  type="submit"
                  className="rounded-lg bg-[#ffd700] px-3 py-1.5 text-xs font-bold text-black hover:bg-[#e6c200]"
                >
                  Draft body
                </button>
              </form>
              <form action={generateBlogAiAction}>
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="ai_kind" value="seo" />
                <button
                  type="submit"
                  className="rounded-lg border border-[#ffd700]/40 px-3 py-1.5 text-xs font-bold text-[#ffd700] hover:bg-[#ffd700]/10"
                >
                  Suggest SEO
                </button>
              </form>
            </div>

            {pending.length > 0 && (
              <div className="mt-4 space-y-3">
                {pending.map((s) => {
                  const flags = checkCompliance(s.suggested_value ?? "").flags;
                  return (
                    <div key={s.id} className="rounded-lg border border-white/10 bg-black p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wider text-white/40">
                          {s.field_key} · {s.model ?? "ai"}
                        </span>
                        {flags.length > 0 && (
                          <span className="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[0.65rem] font-semibold text-red-400">
                            ⚠ {flags.length} compliance flag{flags.length > 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                      <pre className="mt-2 whitespace-pre-wrap text-sm text-white/80">
                        {s.suggested_value}
                      </pre>
                      {flags.length > 0 && (
                        <ul className="mt-2 list-disc pl-5 text-xs text-red-400/80">
                          {flags.map((f, i) => (
                            <li key={i}>{f}</li>
                          ))}
                        </ul>
                      )}
                      <div className="mt-3 flex gap-2">
                        <form action={acceptBlogSuggestionAction}>
                          <input type="hidden" name="id" value={id} />
                          <input type="hidden" name="suggestion_id" value={s.id} />
                          <button
                            type="submit"
                            className="rounded-lg bg-[#7ed957] px-3 py-1 text-xs font-bold text-black hover:bg-[#6bc746]"
                          >
                            Accept
                          </button>
                        </form>
                        <form action={rejectBlogSuggestionAction}>
                          <input type="hidden" name="id" value={id} />
                          <input type="hidden" name="suggestion_id" value={s.id} />
                          <button
                            type="submit"
                            className="rounded-lg border border-white/15 px-3 py-1 text-xs font-bold text-white/70 hover:bg-white/10"
                          >
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
