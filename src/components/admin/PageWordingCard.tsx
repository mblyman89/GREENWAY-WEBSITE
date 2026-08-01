import { HelpPanel } from "@/components/admin/ux";
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
import { wordingBlockPublicPath } from "@/lib/cms/page-wording-core";
import {
  seedContentBlocksAction,
  saveContentDraftAction,
  publishContentBlockAction,
  restoreContentRevisionAction,
  publishAllDraftsAction,
  discardAllDraftsAction,
} from "@/app/admin/content/actions";

/**
 * PageWordingCard — the all-inclusive "Page wording" block editor embedded in a
 * page's own admin editor (/admin/pages/[slug]).
 *
 * It is a scoped copy of the proven Header & Footer editor pattern: it lists the
 * controlled content blocks, keeps only the ones for THIS page (`b.page ===
 * slug`), and hands them to the exact same ContentEditorShell used by Site
 * Content — same draft → preview → publish flow, same revision history, same
 * shared server actions. Nothing new is invented; the wording just lives where
 * the owner expects it now (on the page's own editor).
 *
 * SAFETY:
 * - Additive only. This does NOT remove the blocks from Site Content (a later
 *   mini-slice does that), so a block is never orphaned during the move.
 * - The block SEED defaults mirror the current live values, so the public page
 *   stays pixel-identical until a staff member edits + publishes a block.
 * - Reuses the shared actions from Site Content, so save/publish/restore behave
 *   identically to every other editor.
 */
export async function PageWordingCard({
  slug,
  previewPath,
}: {
  slug: string;
  previewPath: string | null | undefined;
}) {
  // Lazy, idempotent top-up so any missing controlled blocks appear. No-op once
  // everything already exists. Same call the header-footer editor makes.
  let allBlocks = await listContentBlocks();
  if (allBlocks.length > 0) {
    const inserted = await ensureContentBlocksSeeded();
    if (inserted > 0) allBlocks = await listContentBlocks();
  }
  // Scope to THIS page's blocks only.
  const blocks = allBlocks.filter((b) => b.page === slug);
  const notSeeded = allBlocks.length === 0;

  // If nothing is seeded anywhere yet, offer the one-click initialize button
  // (it seeds the whole controlled set, this page included).
  if (notSeeded) {
    return (
      <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-6">
        <h2 className="text-base font-semibold text-[var(--admin-text)]">
          Page wording
        </h2>
        <p className="mt-2 text-sm text-[var(--admin-text-muted)]">
          The controlled content blocks haven&apos;t been initialized yet. Click
          below to create the approved editable slots (pre-filled with the
          current live values — no visible change until you edit).
        </p>
        <form action={seedContentBlocksAction} className="mt-4">
          <Button type="submit" variant="primary">
            Initialize content blocks
          </Button>
        </form>
      </section>
    );
  }

  // Blocks exist somewhere but none for this page yet — quietly render nothing
  // rather than an empty shell (keeps the editor clean).
  if (blocks.length === 0) return null;

  const aiEnabled = isAiConfigured;

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

  const revisionsByKey = new Map<
    string,
    Awaited<ReturnType<typeof listContentRevisions>>
  >();
  await Promise.all(
    blocks.map(async (b) => {
      revisionsByKey.set(b.block_key, await listContentRevisions(b.block_key, 15));
    }),
  );

  const publicPath = wordingBlockPublicPath(previewPath);

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
    publicPath,
    revisions: (revisionsByKey.get(b.block_key) ?? []).map((r) => ({
      id: r.id,
      value: r.value,
      note: r.note,
      actor_email: r.actor_email,
      created_at: r.created_at,
    })),
  }));

  return (
    <section className="space-y-5 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5 sm:p-6">
      <div>
        <h2 className="text-base font-semibold text-[var(--admin-text)]">
          Page wording
        </h2>
        <p className="mt-1 text-sm text-[var(--admin-text-muted)]">
          The editable words and images on this page. Edit a draft, preview it,
          then Publish — every publish is snapshotted so you can roll back.
        </p>
      </div>

      <HelpPanel
        id={`page-wording-${slug}`}
        title="How Page wording works"
        steps={[
          "Pick a block below and edit its draft — nothing goes live yet.",
          "Use the live preview to see the page exactly as visitors will (click ✎ Edit on a highlighted spot to jump to it).",
          "Click Publish on the block (or 'Publish all drafts') to update the public page.",
        ]}
      >
        <p>
          <strong>Nothing breaks:</strong> you can only edit these approved
          spots, so the page always stays laid out correctly. These are the same
          words you could previously edit under Site Content — now they live here
          on the page&apos;s own editor.
        </p>
      </HelpPanel>

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          label="Editable wording slots"
          value={blocks.length}
          hint="Text & images controlled on this page"
          accent="muted"
        />
        <StatCard
          label="Pending drafts"
          value={pendingCount}
          hint={
            pendingCount > 0
              ? "Unpublished edits waiting below"
              : "Everything is live"
          }
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
    </section>
  );
}
