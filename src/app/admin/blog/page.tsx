import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { listPosts } from "@/lib/cms/blog-store";
import { isAiConfigured } from "@/lib/ai/provider";
import type { PostStatus } from "@/lib/cms/types";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<PostStatus, string> = {
  draft: "border-white/15 bg-white/5 text-white/60",
  scheduled: "border-[#ffd700]/40 bg-[#ffd700]/10 text-[#ffd700]",
  published: "border-[#7ed957]/40 bg-[#7ed957]/10 text-[#7ed957]",
  archived: "border-white/10 bg-white/5 text-white/35",
};

export default async function BlogAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; category?: string }>;
}) {
  await requirePermission("blog.manage");
  const { status, category } = await searchParams;

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Blog & Newsletter" subtitle="Write posts and newsletters with drafts, scheduling, SEO, and AI assist." />
        <div className="px-5 py-6 sm:px-8">
          <div className="rounded-xl border border-[#ffd700]/30 bg-[#ffd700]/5 p-5 text-sm text-[#ffd700]">
            Supabase is not configured yet. Once the database is connected and migration 0005 is applied, posts will manage here.
          </div>
        </div>
      </div>
    );
  }

  const all = await listPosts();
  let posts = all;
  if (status) posts = posts.filter((p) => p.status === status);
  if (category) posts = posts.filter((p) => p.category === category);

  const counts = {
    total: all.length,
    published: all.filter((p) => p.status === "published").length,
    draft: all.filter((p) => p.status === "draft").length,
    scheduled: all.filter((p) => p.status === "scheduled").length,
  };

  return (
    <div>
      <AdminPageHeader
        title="Blog & Newsletter"
        subtitle={`Drafts, scheduling, categories, hero images, SEO${isAiConfigured ? ", and AI-drafted copy" : ""}. Public blog falls back to built-in posts until you publish your own.`}
        breadcrumbs={<Breadcrumbs items={[{ label: "Blog" }]} />}
        help={
          <HelpPanel
            id="blog"
            title="How blogging works"
            steps={[
              "Start a new post and give it a title.",
              "Write it yourself, or use the AI helper to draft sections.",
              "Add a hero image and fill in the SEO fields.",
              "Save as a draft, preview, then Publish when ready.",
            ]}
          >
            <p>
              Posts stay drafts until you publish, so you can take your time. The
              AI helper only writes drafts for you to review and edit.
            </p>
          </HelpPanel>
        }
        action={
          <Link
            href="/admin/blog/new"
            className="rounded-lg bg-[#7ed957] px-4 py-2 text-sm font-bold text-black transition hover:bg-[#6bc746]"
          >
            + New post
          </Link>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        <div className="grid gap-4 sm:grid-cols-4">
          <StatCard label="All posts" value={counts.total} accent="muted" href="/admin/blog" />
          <StatCard label="Published" value={counts.published} accent="green" href="/admin/blog?status=published" />
          <StatCard label="Drafts" value={counts.draft} accent="orange" href="/admin/blog?status=draft" />
          <StatCard label="Scheduled" value={counts.scheduled} accent="gold" href="/admin/blog?status=scheduled" />
        </div>

        {all.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-6 text-sm text-white/60">
            No posts yet. The public blog is showing the built-in starter posts. Click{" "}
            <span className="font-semibold text-[#7ed957]">+ New post</span> to create your first database-backed post.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0a0a0a]">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-white/10 text-xs uppercase tracking-wider text-white/40">
                <tr>
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Kind</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody>
                {posts.map((p) => (
                  <tr key={p.id} className="border-b border-white/5 last:border-0 hover:bg-white/5">
                    <td className="px-4 py-3">
                      <Link href={`/admin/blog/${p.id}`} className="font-semibold text-white hover:text-[#7ed957]">
                        {p.title}
                      </Link>
                      <div className="text-xs text-white/40">/{p.slug}</div>
                    </td>
                    <td className="px-4 py-3 text-white/70">{p.category}</td>
                    <td className="px-4 py-3 text-white/70">{p.kind}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[p.status]}`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-white/50">{p.date_label ?? (p.publish_date ? p.publish_date.slice(0, 10) : "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
