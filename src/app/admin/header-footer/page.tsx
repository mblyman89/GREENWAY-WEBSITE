import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { ContentEditorShell } from "@/components/admin/ContentEditorShell";
import { type BlockVM } from "@/components/admin/ContentBlocksBrowser";
import type { MediaChoice } from "@/components/admin/ContentImageField";
import { ContentBulkBar } from "@/components/admin/ContentBulkBar";
import { StatCard } from "@/components/admin/StatCard";
import { Button } from "@/components/admin/ui";
import {
  listContentBlocks,
  listContentRevisions,
  ensureContentBlocksSeeded,
} from "@/lib/cms/content-store";
import { listMedia } from "@/lib/media/store";
import { isAiConfigured } from "@/lib/cms/ai-content";
import {
  seedContentBlocksAction,
  saveContentDraftAction,
  publishContentBlockAction,
  restoreContentRevisionAction,
  publishAllDraftsAction,
  discardAllDraftsAction,
} from "@/app/admin/content/actions";

/**
 * Header & Footer editor (Admin -> Website -> Header & Footer).
 *
 * A focused editor for the site-wide header/footer wording and links that
 * appear on every page: the "Follow Greenway" social links, the App download
 * links, and the friendly "not connected yet" message shown when a link has no
 * destination saved. These are the `header-footer` content blocks.
 *
 * It reuses the exact same safe editing machinery as Site Content (draft ->
 * preview -> publish, with revision history), just scoped to these blocks and
 * previewing on the homepage where the footer renders. Everything stays
 * pixel-identical to the live site until a staff member edits a block, because
 * each block's seed default mirrors the current live value.
 */
function publicPathForHeaderFooterBlock(): string | null {
  // Every header-footer block renders in the shared footer on every page, so
  // "View on site" and the live preview both point at the homepage.
  return "/";
}

export const dynamic = "force-dynamic";

export default async function HeaderFooterPage({
  searchParams,
}: {
  searchParams: Promise<{
    saved?: string;
    published?: string;
    seeded?: string;
    restored?: string;
    published_all?: string;
    discarded?: string;
    warning_error?: string;
  }>;
}) {
  await requirePermission("content.edit");
  const { saved, published, seeded, restored, published_all, discarded, warning_error } =
    await searchParams;

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader
          title="Header & Footer"
          subtitle="Edit the footer links and messages that appear on every page — no code."
        />
        <div className="px-5 py-6 sm:px-8 text-sm text-[var(--admin-gold)]">
          The database isn&apos;t fully set up yet. Once your administrator finishes the
          one-time setup, your header &amp; footer content will appear here to edit.
        </div>
      </div>
    );
  }

  // Lazy, idempotent top-up: insert any missing controlled blocks (including
  // the new header-footer ones) so they appear automatically. No-op once
  // everything already exists.
  let allBlocks = await listContentBlocks();
  if (allBlocks.length > 0) {
    const inserted = await ensureContentBlocksSeeded();
    if (inserted > 0) allBlocks = await listContentBlocks();
  }
  // Scope this editor to the header/footer blocks only.
  const blocks = allBlocks.filter((b) => b.page === "header-footer");
  // If NOTHING is seeded anywhere yet, offer the one-click initialize button
  // (it seeds the whole controlled set, header-footer included).
  const notSeeded = allBlocks.length === 0;
  const aiEnabled = isAiConfigured;

  // Published media images for the image-block picker (none needed today, but
  // kept for parity so future header/footer image blocks work out of the box).
  const mediaAssets = await listMedia({ status: "published", limit: 200 });
  const mediaChoices: MediaChoice[] = mediaAssets
    .filter((m) => (m.mime_type ?? "").startsWith("image/") && m.public_url)
    .map((m) => ({
      id: m.id,
      url: m.public_url as string,
      title: m.title ?? m.filename ?? "Image",
      usageType: m.usage_type ?? null,
    }));

  const pendingCount = blocks.filter(
    (b) =>
      (b.draft_value ?? "") !== (b.published_value ?? "") ||
      b.status !== "published",
  ).length;

  const revisionsByKey = new Map<string, Awaited<ReturnType<typeof listContentRevisions>>>();
  await Promise.all(
    blocks.map(async (b) => {
      revisionsByKey.set(b.block_key, await listContentRevisions(b.block_key, 15));
    }),
  );

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
    publicPath: publicPathForHeaderFooterBlock(),
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
        title="Header & Footer"
        subtitle="The links and messages in your site footer — shown on every page. Edit a draft, preview it, then Publish."
        breadcrumbs={<Breadcrumbs items={[{ label: "Header & Footer" }]} />}
        help={
          <HelpPanel
            id="header-footer"
            title="How the Header & Footer editor works"
            steps={[
              "Pick a block below (like a 'Follow Greenway' social link) and edit its draft — nothing goes live yet.",
              "Use the live preview to see the footer exactly as visitors will (click ✎ Edit on a highlighted spot to jump to it).",
              "Click Publish on the block (or 'Publish all drafts') to update the public site. Every publish is snapshotted so you can roll back.",
            ]}
          >
            <p className="mb-2">
              <strong>Follow Greenway links:</strong> paste the full web address (starting with
              <code> https:// </code>) for each social button. Leave one blank to show your friendly
              &ldquo;not connected yet&rdquo; message instead of a broken link.
            </p>
            <p className="mb-2">
              <strong>App download links:</strong> these ship blank on purpose until your app is
              live. Visitors who click them see your editable &ldquo;not connected yet&rdquo; message.
              When your app launches, paste the App Store / Google Play links here and the buttons
              start working automatically.
            </p>
            <p>
              <strong>Nothing breaks:</strong> you can only edit these approved spots, so the footer
              always stays laid out correctly.
            </p>
          </HelpPanel>
        }
        action={<Button href="/admin/content" variant="neutral">Site Content →</Button>}
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {warning_error ? (
          <div className="rounded-[var(--admin-radius-sm)] border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800">
            <strong>Blocked:</strong> {warning_error}
          </div>
        ) : null}
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
              The controlled content blocks haven&apos;t been initialized yet. Click below to
              create the approved editable slots (pre-filled with the current live values — no
              visible change until you edit).
            </p>
            <form action={seedContentBlocksAction} className="mt-4">
              <Button type="submit" variant="primary">Initialize content blocks</Button>
            </form>
          </div>
        ) : blocks.length === 0 ? (
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-6">
            <p className="text-sm text-[var(--admin-text-muted)]">
              Your header &amp; footer editable slots are being set up. Refresh in a moment — if this
              persists, use &ldquo;Initialize content blocks&rdquo; on the Site Content page.
            </p>
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <StatCard
                label="Editable footer slots"
                value={blocks.length}
                hint="Follow Greenway links, App links & the not-connected message"
                accent="muted"
              />
              <StatCard
                label="Pending drafts"
                value={pendingCount}
                hint={pendingCount > 0 ? "Unpublished edits waiting below" : "Everything is live"}
                accent={pendingCount > 0 ? "orange" : "green"}
              />
            </div>
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
