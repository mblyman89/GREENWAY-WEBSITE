import type { ReactNode } from "react";
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
import { MERCH_SITE_ORIGIN } from "@/lib/merch/merch-ad-core";
import {
  seedContentBlocksAction,
  saveContentDraftAction,
  publishContentBlockAction,
  restoreContentRevisionAction,
  publishAllDraftsAction,
  discardAllDraftsAction,
} from "@/app/admin/content/actions";
import type { MerchSitePage } from "../../../../merch-site/lib/site-content-core";

/**
 * R73 S3: one shared editor for the four Website -> Merchandise pages
 * (greenwaymerch.com header/footer, banners, product cards, order emails).
 *
 * It is the Header & Footer editor's exact pattern (same draft -> publish ->
 * revision machinery, same shared server actions) scoped to one merch
 * `content_blocks` page-group. greenwaymerch.com reads the PUBLISHED values via
 * the public /api/merch-content endpoint (60s cache), so a publish shows on the
 * merch site within about a minute.
 */

export type MerchEditorSearch = {
  saved?: string;
  published?: string;
  seeded?: string;
  restored?: string;
  published_all?: string;
  discarded?: string;
};

export type MerchEditorConfig = {
  page: MerchSitePage;
  route: string;
  title: string;
  subtitle: string;
  crumb: string;
  helpId: string;
  steps: string[];
  help: ReactNode;
  slotsHint: string;
  /** Put images from the "merch" media folder first in the picker. */
  merchMediaFirst?: boolean;
};

export async function MerchSiteEditor({
  config,
  search,
}: {
  config: MerchEditorConfig;
  search: MerchEditorSearch;
}) {
  await requirePermission("content.edit");
  const { saved, published, seeded, restored, published_all, discarded } = search;

  const header = (
    <AdminPageHeader
      title={config.title}
      subtitle={config.subtitle}
      breadcrumbs={<Breadcrumbs items={[{ label: "Merchandise" }, { label: config.crumb }]} />}
      help={
        <HelpPanel id={config.helpId} title={`How ${config.title} works`} steps={config.steps}>
          {config.help}
        </HelpPanel>
      }
      action={
        <Button href={MERCH_SITE_ORIGIN} variant="neutral">
          View greenwaymerch.com ↗
        </Button>
      }
    />
  );

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        {header}
        <div className="px-5 py-6 sm:px-8 text-sm text-[var(--admin-gold)]">
          The database isn&apos;t fully set up yet. Once setup finishes, these merch settings will
          appear here to edit.
        </div>
      </div>
    );
  }

  let allBlocks = await listContentBlocks();
  if (allBlocks.length > 0) {
    const inserted = await ensureContentBlocksSeeded();
    if (inserted > 0) allBlocks = await listContentBlocks();
  }
  const blocks = allBlocks.filter((b) => b.page === config.page);
  const notSeeded = allBlocks.length === 0;

  const mediaAssets = await listMedia({ status: "published", limit: 200 });
  const mediaChoices: MediaChoice[] = mediaAssets
    .filter((m) => /^image\//.test(m.mime_type ?? "") && m.public_url)
    .map((m) => ({
      id: m.id,
      url: m.public_url as string,
      title: m.title ?? m.filename ?? "Image",
      usageType: m.usage_type ?? null,
      mimeType: m.mime_type ?? null,
    }));
  if (config.merchMediaFirst) {
    // Stable partition: Merch-folder images first, everything else after.
    const merch = mediaChoices.filter((m) => m.usageType === "merch");
    const rest = mediaChoices.filter((m) => m.usageType !== "merch");
    mediaChoices.splice(0, mediaChoices.length, ...merch, ...rest);
  }

  const pendingCount = blocks.filter(
    (b) => (b.draft_value ?? "") !== (b.published_value ?? "") || b.status !== "published",
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
    publicPath: MERCH_SITE_ORIGIN,
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
      {header}
      <div className="space-y-6 px-5 py-6 sm:px-8">
        {(saved || published || seeded || restored || published_all || discarded) && (
          <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">
            {published
              ? "Published. greenwaymerch.com shows it within about a minute. 🎉"
              : seeded
                ? "Content blocks initialized."
                : restored
                  ? "Restored into the draft. Review it, then Publish."
                  : published_all
                    ? `Published ${published_all} change${published_all === "1" ? "" : "s"}. 🚀`
                    : discarded
                      ? `Discarded ${discarded} draft${discarded === "1" ? "" : "s"}.`
                      : "Draft saved."}
          </div>
        )}

        {notSeeded ? (
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-6">
            <p className="text-sm text-[var(--admin-text-muted)]">
              The editable content slots haven&apos;t been initialized yet. Click below to create
              them (pre-filled with what greenwaymerch.com shows today, so nothing changes until
              you edit).
            </p>
            <form action={seedContentBlocksAction} className="mt-4">
              <input type="hidden" name="return_to" value={config.route} />
              <Button type="submit" variant="primary">Initialize content blocks</Button>
            </form>
          </div>
        ) : blocks.length === 0 ? (
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-6">
            <p className="text-sm text-[var(--admin-text-muted)]">
              These slots are being set up. Refresh in a moment.
            </p>
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <StatCard label="Editable slots" value={blocks.length} hint={config.slotsHint} accent="muted" />
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
              returnTo={config.route}
            />
            <ContentEditorShell
              blocks={blockVMs}
              aiEnabled={isAiConfigured}
              mediaChoices={mediaChoices}
              saveDraftAction={saveContentDraftAction}
              publishAction={publishContentBlockAction}
              restoreAction={restoreContentRevisionAction}
              returnTo={config.route}
            />
          </>
        )}
      </div>
    </div>
  );
}
