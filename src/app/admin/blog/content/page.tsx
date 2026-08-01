import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { Button } from "@/components/admin/ui";
import {
  BlogContentEditor,
  type BlogBlockVM,
  type BlogSectionVM,
} from "@/components/admin/BlogContentEditor";
import {
  listContentBlocks,
  listContentRevisions,
  ensureContentBlocksSeeded,
} from "@/lib/cms/content-store";
import {
  BLOG_CONTENT_SECTIONS,
  blogContentBlock,
  resolveBlogCopy,
} from "@/lib/blog/blog-content-core";
import {
  saveBlogCopyDraftAction,
  publishBlogCopyAction,
  restoreBlogCopyRevisionAction,
} from "./actions";

/**
 * Blog page-wording editor (Blog & Newsletter → Blog wording), MIG-6 Slice 1.
 *
 * Controls the public /blog page CHROME: the hero eyebrow/heading/intro, the
 * "Read article" card button label, and the "Back to blog" link. Reuses the
 * Site Content draft → publish → revision/restore machinery, so the public
 * blog stays byte-identical until a staff member edits and Publishes.
 *
 * SCOPE: wording only. Blog POSTS are managed under /admin/blog; the blog card
 * DESIGN is intentionally not editable here (owner decision).
 */
export const dynamic = "force-dynamic";

/** Which copy blocks are long enough to want a textarea. */
const MULTILINE_KEYS = new Set<string>(["blog.hero.intro"]);

export default async function AdminBlogContentPage({
  searchParams,
}: {
  searchParams: Promise<{
    saved?: string;
    published?: string;
    restored?: string;
    error?: string;
  }>;
}) {
  await requirePermission("content.edit");
  const sp = await searchParams;

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader
          title="Blog wording"
          subtitle="Edit the wording on your public blog page — no code."
        />
        <div className="px-5 py-6 sm:px-8 text-sm text-[var(--admin-gold)]">
          The database isn&apos;t fully set up yet. Once your administrator finishes the one-time
          setup, your blog wording controls will appear here to edit.
        </div>
      </div>
    );
  }

  // Lazy, idempotent top-up so the blog blocks appear automatically.
  let allBlocks = await listContentBlocks();
  if (allBlocks.length > 0) {
    const inserted = await ensureContentBlocksSeeded();
    if (inserted > 0) allBlocks = await listContentBlocks();
  }
  const byKey = new Map(allBlocks.map((b) => [b.block_key, b]));

  // Build a VM for one editable block, given its byte-identical fallback.
  const buildVM = async (key: string): Promise<BlogBlockVM> => {
    const meta = blogContentBlock(key);
    const fallback = resolveBlogCopy(key);
    const row = byKey.get(key);
    const draftValue = row?.draft_value ?? row?.published_value ?? fallback;
    const publishedValue = row?.published_value ?? fallback;
    const revRows = await listContentRevisions(key, 10);
    return {
      key,
      label: meta?.label ?? key,
      help: meta?.help ?? null,
      multiline: MULTILINE_KEYS.has(key),
      draftValue,
      publishedValue,
      hasUnpublishedDraft: !!row && (row.draft_value ?? "") !== (row.published_value ?? ""),
      revisions: revRows.map((r) => ({
        id: r.id,
        created_at: r.created_at,
        actor_email: r.actor_email,
      })),
    };
  };

  const sections: BlogSectionVM[] = await Promise.all(
    BLOG_CONTENT_SECTIONS.map(async (sec) => ({
      id: sec.id,
      heading: sec.heading,
      blocks: await Promise.all(sec.keys.map((k) => buildVM(k))),
    })),
  );

  return (
    <div>
      <AdminPageHeader
        title="Blog wording"
        subtitle="Edit the wording on your public blog page — the hero heading, intro, and button labels — then Save draft or Publish."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Blog", href: "/admin/blog" },
              { label: "Blog wording" },
            ]}
          />
        }
        help={
          <HelpPanel
            id="blog-content-editor"
            title="How the blog wording editor works"
            steps={[
              "Edit any field — the hero heading, the intro line, or a button label.",
              "Save draft (private) or Publish (updates the live blog page).",
              "Every publish is saved, so you can open History on any field and roll back.",
            ]}
          >
            <p className="mb-2">
              This edits the blog page&rsquo;s <strong>wording only</strong>. Your actual posts and
              newsletters are written in <strong>Blog &amp; Newsletter</strong>, and the card design
              isn&rsquo;t changed here.
            </p>
            <p>
              Defaults match the live page exactly, so nothing looks different until you edit a field
              and Publish.
            </p>
          </HelpPanel>
        }
        action={<Button href="/blog" external variant="neutral">View live blog &rarr;</Button>}
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {sp.error === "restore" ? (
          <div className="rounded-[var(--admin-radius-sm)] border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800">
            Couldn&apos;t restore that version. Please try again.
          </div>
        ) : null}
        {(sp.saved || sp.published || sp.restored) && (
          <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">
            {sp.published
              ? "Published live. \ud83c\udf89"
              : sp.restored
                ? "Restored into the draft \u2014 review it, then Publish."
                : "Draft saved."}
          </div>
        )}

        <BlogContentEditor
          sections={sections}
          saveDraftAction={saveBlogCopyDraftAction}
          publishAction={publishBlogCopyAction}
          restoreAction={restoreBlogCopyRevisionAction}
        />
      </div>
    </div>
  );
}
