import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { ContentEditorShell } from "@/components/admin/ContentEditorShell";
import { type BlockVM } from "@/components/admin/ContentBlocksBrowser";
import type { MediaChoice } from "@/components/admin/ContentImageField";
import { ContentBulkBar } from "@/components/admin/ContentBulkBar";
import { Button } from "@/components/admin/ui";
import {
  listContentBlocks,
  listContentRevisions,
  ensureContentBlocksSeeded,
} from "@/lib/cms/content-store";
import { listMedia } from "@/lib/media/store";
import { CONTENT_BLOCK_SEEDS } from "@/lib/cms/content-blocks-seed";
import { isAiConfigured } from "@/lib/cms/ai-content";
import {
  seedContentBlocksAction,
  saveContentDraftAction,
  publishContentBlockAction,
  restoreContentRevisionAction,
  publishAllDraftsAction,
  discardAllDraftsAction,
} from "./actions";

/** Map a content block's page group to a public URL for "View on site". */
function publicPathForPage(page: string): string | null {
  switch (page) {
    case "home":
      return "/";
    case "menu":
      return "/menu";
    case "loyalty":
      return "/loyalty";
    case "vendors":
      return "/vendor-delivery";
    case "specials":
      return "/specials";
    case "faq":
      return "/faq";
    case "footer":
    case "business":
      // These render in the shared footer on every page — preview on the home page.
      return "/";
    default:
      return null;
  }
}

export const dynamic = "force-dynamic";

export default async function SiteContentPage({
  searchParams,
}: {
  searchParams: Promise<{
    saved?: string;
    published?: string;
    seeded?: string;
    restored?: string;
    published_all?: string;
    discarded?: string;
  }>;
}) {
  await requirePermission("content.edit");
  const { saved, published, seeded, restored, published_all, discarded } =
    await searchParams;

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Site Content" subtitle="Edit approved site text blocks safely — no code, no page builder." />
        <div className="px-5 py-6 sm:px-8 text-sm text-[var(--admin-gold)]">Supabase is not configured yet.</div>
      </div>
    );
  }

  // Lazy, idempotent top-up: if new controlled blocks were added in a release
  // (e.g. the editable footer store-hours image) but the table was seeded in an
  // earlier version, insert just the missing ones so they appear automatically
  // without the owner having to do anything. No-op once everything exists.
  let allBlocks = await listContentBlocks();
  if (allBlocks.length > 0) {
    const inserted = await ensureContentBlocksSeeded();
    if (inserted > 0) allBlocks = await listContentBlocks();
  }
  // Per owner: this page edits ONLY the footer section. The site header has
  // nothing worth editing, so we scope the editor to the blocks that actually
  // render in the shared footer — the store-hours image, the plain-text hours
  // line, and the WA compliance warning.
  const FOOTER_BLOCK_KEYS = new Set<string>([
    "footer.hours.image",
    "footer.compliance.warning",
    "business.hours.display",
  ]);
  const blocks = allBlocks.filter((b) => FOOTER_BLOCK_KEYS.has(b.block_key));
  // "Not seeded" must reflect the whole table — if nothing exists yet, the
  // owner still needs the one-click initialize button (which seeds everything).
  const notSeeded = allBlocks.length === 0;
  const aiEnabled = isAiConfigured;

  // Published media images for the image-block picker (banners, hero photos).
  const mediaAssets = await listMedia({ status: "published", limit: 200 });
  const mediaChoices: MediaChoice[] = mediaAssets
    .filter((m) => (m.mime_type ?? "").startsWith("image/") && m.public_url)
    .map((m) => ({
      id: m.id,
      url: m.public_url as string,
      title: m.title ?? m.filename ?? "Image",
      usageType: m.usage_type ?? null,
    }));

  // How many blocks have an unpublished draft (a draft != live, or not yet published)?
  const pendingCount = blocks.filter(
    (b) =>
      (b.draft_value ?? "") !== (b.published_value ?? "") ||
      b.status !== "published",
  ).length;

  // Fetch each block's published-value history (newest first) so the editor can
  // show "History & changes" with one-click restore. Done in parallel.
  const revisionsByKey = new Map<string, Awaited<ReturnType<typeof listContentRevisions>>>();
  await Promise.all(
    blocks.map(async (b) => {
      revisionsByKey.set(b.block_key, await listContentRevisions(b.block_key, 15));
    }),
  );

  // Build the view-models the client browser renders (search/filter/cards).
  const blockVMs: BlockVM[] = blocks.map((b) => ({
    block_key: b.block_key,
    label: b.label,
    field_type: b.field_type,
    help_text: b.help_text,
    seo_impact: b.seo_impact,
    draft_value: b.draft_value,
    published_value: b.published_value,
    updated_at: b.updated_at,
    page: b.page,
    status: b.status,
    last_edited_by: b.last_edited_by,
    publicPath: publicPathForPage(b.page),
    revisions: (revisionsByKey.get(b.block_key) ?? []).map((r) => ({
      id: r.id,
      value: r.value,
      note: r.note,
      actor_email: r.actor_email,
      created_at: r.created_at,
    })),
  }));

  return (
    <div>
      <AdminPageHeader
        title="Footer Content"
        subtitle="Edit the shared site footer — the store-hours image, the hours line, and the required WA compliance warning. Edit a draft, then Publish to push it live."
        breadcrumbs={<Breadcrumbs items={[{ label: "Footer Content" }]} />}
        help={
          <HelpPanel
            id="content"
            title="How to edit your footer"
            steps={[
              "Pick the footer block you want to change (e.g. the store-hours image).",
              "Edit the draft — your changes don't go live yet.",
              "Preview how it will look.",
              "Click Publish to update the public site.",
            ]}
          >
            <p>
              You can only edit specific approved spots, which keeps your site
              looking right. There&apos;s no way to accidentally break the layout.
            </p>
          </HelpPanel>
        }
        action={
          <Button href="/admin/content/seo" variant="subtle">SEO editor →</Button>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {(saved || published || seeded || restored || published_all || discarded) && (
          <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">
            {published
              ? "Published live. 🎉"
              : seeded
                ? "Content blocks initialized."
                : restored
                  ? "Restored into the draft — review it, then Publish."
                  : published_all
                    ? `Published ${published_all} change${published_all === "1" ? "" : "s"} live. 🚀`
                    : discarded
                      ? `Discarded ${discarded} draft${discarded === "1" ? "" : "s"}.`
                      : "Draft saved."}
          </div>
        )}

        {notSeeded ? (
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-6">
            <p className="text-sm text-[var(--admin-text-muted)]">
              The controlled content blocks haven&apos;t been initialized yet. Click below to create the {CONTENT_BLOCK_SEEDS.length}{" "}
              approved editable slots (pre-filled with the current live copy — no visible change until you edit).
            </p>
            <form action={seedContentBlocksAction} className="mt-4">
              <Button type="submit" variant="primary">Initialize content blocks</Button>
            </form>
          </div>
        ) : (
          <>
          <ContentBulkBar
            pendingCount={pendingCount}
            publishAllAction={publishAllDraftsAction}
            discardAllAction={discardAllDraftsAction}
          />
          <ContentEditorShell
            blocks={blockVMs}
            aiEnabled={aiEnabled}
            mediaChoices={mediaChoices}
            saveDraftAction={saveContentDraftAction}
            publishAction={publishContentBlockAction}
            restoreAction={restoreContentRevisionAction}
          />
          </>
        )}
      </div>
    </div>
  );
}
