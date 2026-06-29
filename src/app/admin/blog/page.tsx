import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { listPosts } from "@/lib/cms/blog-store";
import { isAiConfigured } from "@/lib/ai/provider";
import { Button } from "@/components/admin/ui/Button";
import { StatusPill, EmptyState } from "@/components/admin/ux";

export const dynamic = "force-dynamic";

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
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-5 text-sm text-[var(--admin-gold)]">
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
          <Button href="/admin/blog/new" variant="primary">
            + New post
          </Button>
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
          <EmptyState
            icon="📰"
            title="No posts yet"
            description="The public blog is showing the built-in starter posts. Create your first database-backed post to take over."
            action={
              <Button href="/admin/blog/new" variant="primary">
                + New post
              </Button>
            }
          />
        ) : (
          <div className="overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)]">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[var(--admin-border)] bg-[var(--admin-surface-2)] text-xs uppercase tracking-wider text-[var(--admin-text-faint)]">
                <tr>
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Kind</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--admin-border)]">
                {posts.map((p) => (
                  <tr key={p.id} className="transition hover:bg-[var(--admin-surface-hover)]">
                    <td className="px-4 py-3">
                      <Link href={`/admin/blog/${p.id}`} className="font-semibold text-[var(--admin-text)] hover:text-[var(--admin-accent)]">
                        {p.title}
                      </Link>
                      <div className="text-xs text-[var(--admin-text-faint)]">/{p.slug}</div>
                    </td>
                    <td className="px-4 py-3 text-[var(--admin-text-muted)]">{p.category}</td>
                    <td className="px-4 py-3 text-[var(--admin-text-muted)]">{p.kind}</td>
                    <td className="px-4 py-3">
                      <StatusPill status={p.status} />
                    </td>
                    <td className="px-4 py-3 text-[var(--admin-text-faint)]">{p.date_label ?? (p.publish_date ? p.publish_date.slice(0, 10) : "—")}</td>
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
