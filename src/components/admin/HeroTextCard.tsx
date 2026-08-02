import { HelpPanel } from "@/components/admin/ux";
import { ContentEditorShell } from "@/components/admin/ContentEditorShell";
import { type BlockVM } from "@/components/admin/ContentBlocksBrowser";
import type { MediaChoice } from "@/components/admin/ContentImageField";
import { ContentBulkBar } from "@/components/admin/ContentBulkBar";
import { StatCard } from "@/components/admin/StatCard";
import {
  listContentBlocks,
  listContentRevisions,
  ensureContentBlocksSeeded,
} from "@/lib/cms/content-store";
import { listMedia } from "@/lib/media/store";
import { isAiConfigured } from "@/lib/cms/ai-content";
import { wordingBlockPublicPath } from "@/lib/cms/page-wording-core";
import {
  saveContentDraftAction,
  publishContentBlockAction,
  restoreContentRevisionAction,
  publishAllDraftsAction,
  discardAllDraftsAction,
} from "@/app/admin/content/actions";

/**
 * HeroTextCard — a scoped "hero wording" block editor embedded in a page's own
 * dedicated admin editor (e.g. /admin/specials).
 *
 * It is a SCOPED copy of PageWordingCard: instead of showing every block whose
 * `page === slug`, it shows ONLY the explicit `blockKeys` you pass in, and hands
 * them to the exact same ContentEditorShell used by Site Content and the Page
 * wording cards — same draft → preview → publish flow, same revision history,
 * same shared server actions. Nothing new is invented.
 *
 * WHY IT EXISTS (MIG-5c): a handful of hero TEXT blocks render live on a page
 * whose Pages-builder was retired in favor of a dedicated editor, leaving the
 * copy with no editor anywhere (audit orphans). This card gives that copy a
 * home INSIDE the page's own dedicated editor — the one honest place to edit it
 * — without re-introducing a whole page builder or a Site Content duplicate.
 *
 * SAFETY:
 * - Additive only. The block SEED defaults mirror the current live values, so
 *   the public page stays byte-identical until a staff member edits + publishes.
 * - Reuses the shared actions, so save/publish/restore behave identically to
 *   every other editor.
 */
export async function HeroTextCard({
  blockKeys,
  previewPath,
  title = "Hero text",
  description = "The headline words on this page's hero. Edit a draft, preview it, then Publish — every publish is snapshotted so you can roll back.",
  helpId = "hero-text",
}: {
  /** The exact content-block keys this card is allowed to surface. */
  blockKeys: readonly string[];
  /** Public path used for the "View on site" preview deep-link (e.g. "/specials"). */
  previewPath: string | null | undefined;
  /** Card heading. */
  title?: string;
  /** Card sub-description. */
  description?: string;
  /** Stable id for the HelpPanel. */
  helpId?: string;
}) {
  const allow = new Set(blockKeys);

  // Lazy, idempotent top-up so any missing controlled blocks appear. No-op once
  // everything already exists. Same call every other embedded editor makes.
  let allBlocks = await listContentBlocks();
  if (allBlocks.length > 0) {
    const inserted = await ensureContentBlocksSeeded();
    if (inserted > 0) allBlocks = await listContentBlocks();
  }

  // Scope to ONLY the allowlisted keys, preserving the caller's order.
  const byKey = new Map(allBlocks.map((b) => [b.block_key, b]));
  const blocks = blockKeys
    .map((k) => byKey.get(k))
    .filter((b): b is NonNullable<typeof b> => !!b && allow.has(b.block_key));

  // Nothing seeded yet (or none of these keys exist) — quietly render nothing
  // rather than an empty shell (keeps the editor clean; the seed top-up above
  // will populate them on a later load).
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
          {title}
        </h2>
        <p className="mt-1 text-sm text-[var(--admin-text-muted)]">
          {description}
        </p>
      </div>

      <HelpPanel
        id={helpId}
        title="How hero text works"
        steps={[
          "Pick a field below and edit its draft — nothing goes live yet.",
          "Use the live preview to see the page exactly as visitors will (click ✎ Edit on a highlighted spot to jump to it).",
          "Click Publish on the field (or 'Publish all drafts') to update the public page.",
        ]}
      >
        <p>
          <strong>Nothing breaks:</strong> you can only edit these approved
          words, so the page always stays laid out correctly.
        </p>
      </HelpPanel>

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          label="Editable text slots"
          value={blocks.length}
          hint="Hero words controlled on this page"
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
