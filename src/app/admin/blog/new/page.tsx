import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { BLOG_CATEGORIES } from "@/lib/cms/types";
import { createPostAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewBlogPostPage() {
  await requirePermission("blog.manage");

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="New post" />
        <div className="px-5 py-6 sm:px-8 text-sm text-[#ffd700]">Supabase is not configured yet.</div>
      </div>
    );
  }

  return (
    <div>
      <AdminPageHeader
        title="New post"
        subtitle="Create a draft. You can add the body, hero image, SEO, and AI assist on the next screen."
        action={
          <Link href="/admin/blog" className="text-sm text-white/60 hover:text-white">
            ← Back to posts
          </Link>
        }
      />

      <form action={createPostAction} className="max-w-3xl space-y-5 px-5 py-6 sm:px-8">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-white/50">Title</label>
          <input
            name="title"
            required
            className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
            placeholder="Fresh Flower Picks for Your Next Visit"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-white/50">Slug (optional — auto from title)</label>
          <input
            name="slug"
            className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
            placeholder="fresh-flower-picks"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-white/50">Category</label>
            <select
              name="category"
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
              className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
            >
              <option value="article">Article</option>
              <option value="newsletter">Newsletter</option>
            </select>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-white/50">Excerpt</label>
          <textarea
            name="excerpt"
            rows={2}
            className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
            placeholder="A one or two sentence summary shown on the blog grid."
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-white/50">Body (paragraphs separated by a blank line)</label>
          <textarea
            name="body"
            rows={6}
            className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
            placeholder="You can leave this blank and use AI assist on the next screen."
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-white/50">Author</label>
            <input
              name="author"
              defaultValue="Greenway Team"
              className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-white/50">Date label (e.g. JUN 20, 2026)</label>
            <input
              name="date_label"
              className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
            />
          </div>
        </div>

        <input type="hidden" name="publish_date" value="" />

        <button
          type="submit"
          className="rounded-lg bg-[#7ed957] px-5 py-2.5 text-sm font-bold text-black transition hover:bg-[#6bc746]"
        >
          Create draft →
        </button>
      </form>
    </div>
  );
}
