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
 * Branding editor (Admin -> Website -> Branding).
 *
 * A focused editor for the site-wide typography that applies everywhere on the
 * public site: the Heading font (big titles & headlines) and the Body font
 * (paragraphs & general text). These are the two `site.font.*` content blocks.
 *
 * It reuses the exact same safe editing machinery as Site Content (draft ->
 * preview -> publish, with revision history), just scoped to these two blocks
 * and previewing on the homepage where the fonts are visible. Everything stays
 * pixel-identical to the live site until a staff member picks a new font and
 * publishes, because each block's seed default mirrors the current live value
 * (the safe "system" stack).
 */
/**
 * The two site-wide typography blocks. Kept as an explicit allowlist (not a
 * broad `site.font.` prefix) so ONLY these two known font blocks are pulled in
 * here -- never anything unexpected a future block-key might match.
 *
 * MIG-4 MS-4.1 is the ADDITIVE-FIRST half: we surface these here (editable in
 * this Branding editor) while they STILL remain in Site Content for now -- a
 * harmless duplicate, because both edit the SAME database rows via the SAME
 * save/publish actions. The reachability guard's honest owner stays SITE_CONTENT
 * until the MS-4.2 SUBTRACT removes the Site Content copy and flips the owner to
 * SETTINGS_BRANDING. No block is un-editable at any commit; the public site is
 * byte-identical until an edit is published.
 */
const BRANDING_FONT_KEYS: ReadonlySet<string> = new Set<string>([
  "site.font.heading", // Heading font (titles & headlines) -- applies site-wide
  "site.font.body", // Body font (paragraphs & general text) -- applies site-wide
]);

function publicPathForBrandingBlock(): string | null {
  // The site fonts apply to every page, so "View on site" and the live preview
  // both point at the homepage where the typography is clearly visible.
  return "/";
}

export const dynamic = "force-dynamic";

export default async function BrandingPage({
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
          title="Branding"
          subtitle="Choose the fonts used across your whole site — no code."
        />
        <div className="px-5 py-6 sm:px-8 text-sm text-[var(--admin-gold)]">
          The database isn&apos;t fully set up yet. Once your administrator finishes the
          one-time setup, your branding settings will appear here to edit.
        </div>
      </div>
    );
  }

  // Lazy, idempotent top-up: insert any missing controlled blocks (including
  // the two font blocks) so they appear automatically. No-op once everything
  // already exists.
  let allBlocks = await listContentBlocks();
  if (allBlocks.length > 0) {
    const inserted = await ensureContentBlocksSeeded();
    if (inserted > 0) allBlocks = await listContentBlocks();
  }
  // Scope this editor to the two site-wide font blocks (see BRANDING_FONT_KEYS
  // above). This is the additive-first surface: they also still show in Site
  // Content until MS-4.2 removes that duplicate.
  const blocks = allBlocks.filter((b) => BRANDING_FONT_KEYS.has(b.block_key));
  // If NOTHING is seeded anywhere yet, offer the one-click initialize button
  // (it seeds the whole controlled set, the font blocks included).
  const notSeeded = allBlocks.length === 0;
  const aiEnabled = isAiConfigured;

  // Published media images for the image-block picker (none needed for fonts,
  // but kept for parity so the shared editor shell works out of the box).
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
    publicPath: publicPathForBrandingBlock(),
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
        title="Branding"
        subtitle="The fonts used across your whole site. Pick a heading font and a body font, preview it, then Publish."
        breadcrumbs={<Breadcrumbs items={[{ label: "Branding" }]} />}
        help={
          <HelpPanel
            id="branding"
            title="How the Branding editor works"
            steps={[
              "Pick the Heading font (big titles) and the Body font (paragraphs) from the curated library below — each choice is a draft, so nothing goes live yet.",
              "Use the live preview to see exactly how the new fonts look (click ✎ Edit on a highlighted spot to jump to it).",
              "Click Publish on the block (or 'Publish all drafts') to update the public site everywhere at once. Every publish is snapshotted so you can roll back.",
            ]}
          >
            <p className="mb-2">
              <strong>Heading vs. Body:</strong> the <strong>Heading</strong> font is used for big
              titles and headlines; the <strong>Body</strong> font is used for regular paragraph and
              interface text. A clean pairing (a characterful heading with a highly readable body) is
              usually the safest, most professional look.
            </p>
            <p className="mb-2">
              <strong>Why a curated list?</strong> web pages can only use fonts the browser can fetch,
              so we ship a hand-picked set of high-quality, license-clean fonts (plus the fast
              &ldquo;System default&rdquo;). Each is loaded for performance with no layout shift.
            </p>
            <p>
              <strong>Nothing breaks:</strong> your fonts apply site-wide the moment you Publish, and
              you can roll back to any previous choice from History at any time.
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
              Your branding editable slots are being set up. Refresh in a moment — if this
              persists, use &ldquo;Initialize content blocks&rdquo; on the Site Content page.
            </p>
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <StatCard
                label="Font settings"
                value={blocks.length}
                hint="Your site-wide heading & body fonts"
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
