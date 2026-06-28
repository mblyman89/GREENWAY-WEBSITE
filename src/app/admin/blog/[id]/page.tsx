import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { getPostById, getNewsletterAsset } from "@/lib/cms/blog-store";
import { listBlogSuggestions } from "@/lib/cms/ai-blog";
import { isAiConfigured } from "@/lib/ai/provider";
import { checkCompliance } from "@/lib/ai/compliance";
import { BLOG_CATEGORIES } from "@/lib/cms/types";
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
  const bodyText = (post.body ?? []).join("\n\n");

  return (
    <div>
      <AdminPageHeader
        title={post.title}
        subtitle={`/${post.slug} · ${post.category} · ${post.kind} · ${post.status}`}
        action={
          <Link href="/admin/blog" className="text-sm text-white/60 hover:text-white">
            ← Back to posts
          </Link>
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
          <span className="text-xs font-semibold uppercase tracking-wider text-white/40">Status: {post.status}</span>
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

        {/* AI assist panel */}
        {isAiConfigured && (
          <div className="rounded-xl border border-[#ffd700]/25 bg-[#ffd700]/5 p-4">
            <h2 className="text-sm font-bold text-[#ffd700]">AI assist (drafts only)</h2>
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
                <button type="submit" className="rounded-lg bg-[#ffd700] px-3 py-1.5 text-xs font-bold text-black hover:bg-[#e6c200]">
                  Draft body
                </button>
              </form>
              <form action={generateBlogAiAction}>
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="ai_kind" value="seo" />
                <button type="submit" className="rounded-lg border border-[#ffd700]/40 px-3 py-1.5 text-xs font-bold text-[#ffd700] hover:bg-[#ffd700]/10">
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
                      <pre className="mt-2 whitespace-pre-wrap text-sm text-white/80">{s.suggested_value}</pre>
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
                          <button type="submit" className="rounded-lg bg-[#7ed957] px-3 py-1 text-xs font-bold text-black hover:bg-[#6bc746]">
                            Accept
                          </button>
                        </form>
                        <form action={rejectBlogSuggestionAction}>
                          <input type="hidden" name="id" value={id} />
                          <input type="hidden" name="suggestion_id" value={s.id} />
                          <button type="submit" className="rounded-lg border border-white/15 px-3 py-1 text-xs font-bold text-white/70 hover:bg-white/10">
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

        {/* Editor form */}
        <form action={updatePostAction} encType="multipart/form-data" className="max-w-3xl space-y-5">
          <input type="hidden" name="id" value={id} />

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-white/50">Title</label>
              <input
                name="title"
                defaultValue={post.title}
                className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-white/50">Slug</label>
              <input
                name="slug"
                defaultValue={post.slug}
                className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-white/50">Category</label>
              <select
                name="category"
                defaultValue={post.category}
                className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
              >
                {BLOG_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-white/50">Kind</label>
              <select
                name="kind"
                defaultValue={post.kind}
                className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
              >
                <option value="article">Article</option>
                <option value="newsletter">Newsletter</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-white/50">Author</label>
              <input
                name="author"
                defaultValue={post.author}
                className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-white/50">Excerpt</label>
            <textarea
              name="excerpt"
              rows={2}
              defaultValue={post.excerpt ?? ""}
              className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-white/50">Body (paragraphs separated by a blank line)</label>
            <textarea
              name="body"
              rows={8}
              defaultValue={bodyText}
              className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-white/50">Hero image (upload)</label>
              <input
                type="file"
                name="hero_image"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="w-full text-xs text-white/60 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
              />
              {post.hero_image_path && (
                <p className="mt-1 text-xs text-white/40">Current path: {post.hero_image_path}</p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-white/50">Hero image alt text</label>
              <input
                name="hero_image_alt"
                defaultValue={post.hero_image_alt ?? ""}
                className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-white/50">Publish date (ISO, optional)</label>
              <input
                name="publish_date"
                type="datetime-local"
                defaultValue={post.publish_date ? post.publish_date.slice(0, 16) : ""}
                className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-white/50">Date label</label>
              <input
                name="date_label"
                defaultValue={post.date_label ?? ""}
                className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
              />
            </div>
          </div>

          {/* Newsletter mode */}
          <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-white/50">Newsletter assets (used only when Kind = newsletter)</h3>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-white/50">PDF upload</label>
                <input
                  type="file"
                  name="pdf_file"
                  accept="application/pdf"
                  className="w-full text-xs text-white/60 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-white/50">Page image paths (one per line; first = preview)</label>
                <textarea
                  name="page_paths"
                  rows={3}
                  defaultValue={(newsletter?.page_paths ?? []).join("\n")}
                  placeholder="/blog/newsletters/2026-06-20-p1.png"
                  className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-xs text-white outline-none focus:border-[#7ed957]"
                />
              </div>
            </div>
          </div>

          {/* SEO */}
          <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-white/50">SEO</h3>
            <div className="mt-3 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-white/50">
                  SEO title <span className="text-white/30">(aim 50–60 chars)</span>
                </label>
                <input
                  name="seo_title"
                  defaultValue={post.seo_title ?? ""}
                  className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-white/50">
                  SEO description <span className="text-white/30">(aim 140–160 chars)</span>
                </label>
                <textarea
                  name="seo_description"
                  rows={2}
                  defaultValue={post.seo_description ?? ""}
                  className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-white/50">Canonical path (optional)</label>
                  <input
                    name="canonical_path"
                    defaultValue={post.canonical_path ?? ""}
                    className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
                  />
                </div>
                <label className="flex items-center gap-2 self-end pb-2 text-sm text-white/70">
                  <input type="checkbox" name="noindex" defaultChecked={post.noindex} className="h-4 w-4" />
                  Noindex this post
                </label>
              </div>
              {/* Google-style preview */}
              <div className="rounded-lg border border-white/10 bg-black p-3">
                <div className="text-xs text-white/40">Search preview</div>
                <div className="mt-1 text-sm text-[#8ab4f8]">{post.seo_title ?? post.title}</div>
                <div className="text-xs text-[#7ed957]/80">greenwaymarijuana.com/blog/{post.slug}</div>
                <div className="mt-0.5 text-xs text-white/55">
                  {post.seo_description ?? post.excerpt ?? "Add an SEO description to control this snippet."}
                </div>
              </div>
            </div>
          </div>

          <button
            type="submit"
            className="rounded-lg bg-[#7ed957] px-5 py-2.5 text-sm font-bold text-black transition hover:bg-[#6bc746]"
          >
            Save changes
          </button>
        </form>
      </div>
    </div>
  );
}
