import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { isAiConfigured } from "@/lib/ai/provider";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { BackLink } from "@/components/admin/ux";
import { Button, Field, Input, Select, Textarea } from "@/components/admin/ui";
import { BlogIdeaAssistant } from "@/components/admin/blog/BlogIdeaAssistant";
import { BLOG_CATEGORIES } from "@/lib/cms/types";
import { createPostAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewBlogPostPage({
  searchParams,
}: {
  searchParams?: Promise<{ back?: string; error?: string }>;
}) {
  await requirePermission("blog.manage");
  const sp: { back?: string; error?: string } = searchParams ? await searchParams : {};

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="New post" />
        <div className="px-5 py-6 sm:px-8 text-sm text-[var(--admin-gold)]">
          The database isn&apos;t fully set up yet. Once your administrator finishes the one-time
          setup, you can create posts here.
        </div>
      </div>
    );
  }

  return (
    <div>
      <AdminPageHeader
        title="New post"
        subtitle="Get an idea from the assistant, then create a draft. You can add the body, hero image, SEO, and AI assist on the next screen."
        action={
          <BackLink
            fallback="/admin/blog"
            back={sp.back}
            className="text-sm text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]"
          >
            ← Back to posts
          </BackLink>
        }
      />

      {/* Centered content column */}
      <div className="mx-auto w-full max-w-3xl space-y-6 px-5 py-6 sm:px-8">
        {/* GPT-4o idea / headline / trend assistant (local focus) */}
        <BlogIdeaAssistant aiEnabled={isAiConfigured} />

        {/* S31: createPostAction redirects here with ?error=title|slug; the
            page used to drop it, so a rejected post looked like a no-op. */}
        {sp.error === "title" || sp.error === "slug" ? (
          <div role="alert" className="rounded-lg border border-[var(--admin-orange)]/40 bg-[var(--admin-orange)]/10 px-4 py-2 text-sm text-[var(--admin-orange)]">
            {sp.error === "title"
              ? "Give the post a title before creating it."
              : "That title does not make a usable web address (slug). Use some letters or numbers."}
          </div>
        ) : null}

        <form action={createPostAction} className="space-y-5">
          {/* Seed passed to the next screen's body-draft AI when an idea is used. */}
          <input type="hidden" name="ai_topic_seed" defaultValue="" />

          <Field label="Title" required>
            <Input name="title" required placeholder="Fresh Flower Picks for Your Next Visit" />
          </Field>

          <Field label="Slug" help="Optional — auto-generated from the title">
            <Input name="slug" placeholder="fresh-flower-picks" />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category">
              <Select name="category" defaultValue="CULTURE">
                {BLOG_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Kind">
              <Select name="kind" defaultValue="article">
                <option value="article">Article</option>
                <option value="newsletter">Newsletter</option>
              </Select>
            </Field>
          </div>

          <Field label="Excerpt" help="A one or two sentence summary shown on the blog grid">
            <Textarea name="excerpt" rows={2} placeholder="A short summary shown on the blog grid." />
          </Field>

          <Field label="Body" help="Paragraphs separated by a blank line — or leave blank and use AI assist next">
            <Textarea
              name="body"
              rows={6}
              placeholder="You can leave this blank and use AI assist on the next screen."
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Author">
              <Input name="author" defaultValue="Greenway Team" />
            </Field>
            <Field label="Date label" help="e.g. JUN 20, 2026">
              <Input name="date_label" />
            </Field>
          </div>

          <input type="hidden" name="publish_date" value="" />

          <Button type="submit" variant="confirm">
            Create draft →
          </Button>
        </form>
      </div>
    </div>
  );
}
