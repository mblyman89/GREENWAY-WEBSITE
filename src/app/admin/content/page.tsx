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

/**
 * Map a content block to a public URL for "View on site".
 *
 * Most page groups map 1:1 to a public route. The "legal" group bundles a few
 * statically-authored policy pages, so those are resolved by block-key prefix.
 */
function publicPathForBlock(page: string, blockKey: string): string | null {
  if (page === "legal") {
    if (blockKey.startsWith("privacy.")) return "/privacy-policy";
    if (blockKey.startsWith("terms.")) return "/terms-of-use";
    if (blockKey.startsWith("chd.")) return "/consumer-health-data";
    return null;
  }
  switch (page) {
    case "home":
      return "/";
    case "menu":
      return "/menu";
    case "loyalty":
      return "/loyalty";
    case "medical":
      return "/medical";
    case "vendors":
      return "/vendor-delivery";
    case "specials":
      return "/specials";
    case "faq":
      return "/faq";
    case "about":
      return "/about";
    case "locations":
      return "/locations";
    case "price-match":
      return "/price-match";
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
    warning_error?: string;
  }>;
}) {
  await requirePermission("content.edit");
  const { saved, published, seeded, restored, published_all, discarded, warning_error } =
    await searchParams;

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Site Content" subtitle="Edit approved site text blocks safely — no code, no page builder." />
        <div className="px-5 py-6 sm:px-8 text-sm text-[var(--admin-gold)]">The database isn&apos;t fully set up yet. Once your administrator finishes the one-time setup, your site content will appear here to edit.</div>
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
  // Site Content is the home for editable SITE-WIDE / cross-page text that
  // doesn't live inside a single page builder: the shared footer (store-hours
  // image, hours line, WA compliance warning), business info (hours display,
  // site fonts), and the simple text pages whose copy isn't managed in the
  // Pages builder (About, Locations, Price Match heroes). The richer
  // banner/section pages (Home, Menu, Loyalty, Specials, Vendors, FAQ) are
  // edited in their own tabs under PAGES, so we exclude them here to avoid
  // duplicating that work.
  const PAGE_BUILDER_PAGES = new Set<string>([
    "home",
    "menu",
    "loyalty",
    "specials",
    "vendors",
    "faq",
  ]);
  const blocks = allBlocks.filter((b) => !PAGE_BUILDER_PAGES.has(b.page));
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
    publicPath: publicPathForBlock(b.page, b.block_key),
    revisions: (revisionsByKey.get(b.block_key) ?? []).map((r) => ({
      id: r.id,
      value: r.value,
      note: r.note,
      actor_email: r.actor_email,
      created_at: r.created_at,
    })),
  }));

  // At-a-glance numbers for the stat row (SEO-flagged blocks get a shortcut).
  const seoCount = blocks.filter((b) => b.seo_impact).length;

  return (
    <div>
      <AdminPageHeader
        title="Site Content"
        subtitle="Your site-wide wording — footer, business info, and simple text pages. Edit a draft, preview it, then Publish."
        breadcrumbs={<Breadcrumbs items={[{ label: "Site Content" }]} />}
        help={
          <HelpPanel
            id="content"
            title="How Site Content works (and where SEO fits in)"
            steps={[
              "Search or use the page filters to find the wording you want to change, then click a block to open it.",
              "Edit the draft — nothing goes live yet. Use the live preview to see exactly how it will look (click ✎ Edit on the preview to jump to a field).",
              "Click Publish on the block (or “Publish all drafts”) to update the public site. Every publish is snapshotted so you can roll back from History.",
              "SEO editor (button top-right): set each page’s Google Title (~50–60 characters, unique, include “Greenway Marijuana” + “Port Orchard, WA”), Description (~150–160 characters with a reason to click), and a 1200×630 social share image from Media.",
            ]}
          >
            <p className="mb-2">
              You can only edit specific approved spots, which keeps your site looking right —
              there&apos;s no way to accidentally break the layout.
            </p>
            <p className="mb-2">
              <strong>Where things live:</strong> footer &amp; business info and your simple text
              pages (About, Locations, Price Match) are edited here. Your richer pages with banners
              and sections — Home, Menu, Loyalty, Specials, Vendors, FAQ — are edited under{" "}
              <strong>Pages</strong> in the sidebar.
            </p>
            <p>
              <strong>Cannabis compliance:</strong> Washington I-502 rules apply to public wording.
              Keep it factual and age-appropriate, never make health/medical claims, and never
              imply appeal to minors. Describe the experience and the deal — not medical benefits.
            </p>
          </HelpPanel>
        }
        action={
          <Button href="/admin/content/seo" variant="neutral">SEO editor →</Button>
        }
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
              The controlled content blocks haven&apos;t been initialized yet. Click below to create the {CONTENT_BLOCK_SEEDS.length}{" "}
              approved editable slots (pre-filled with the current live copy — no visible change until you edit).
            </p>
            <form action={seedContentBlocksAction} className="mt-4">
              <Button type="submit" variant="primary">Initialize content blocks</Button>
            </form>
          </div>
        ) : (
          <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label="Editable blocks"
              value={blocks.length}
              hint="Approved site-wide text & image slots"
              accent="muted"
            />
            <StatCard
              label="Pending drafts"
              value={pendingCount}
              hint={pendingCount > 0 ? "Unpublished edits waiting below" : "Everything is live"}
              accent={pendingCount > 0 ? "orange" : "green"}
            />
            <StatCard
              label="SEO-flagged blocks"
              value={seoCount}
              hint="Wording that affects Google results"
              accent="gold"
              href="/admin/content/seo"
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
