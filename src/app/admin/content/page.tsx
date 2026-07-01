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
  }>;
}) {
  await requirePermission("content.edit");
  const { saved, published, seeded, restored, published_all, discarded } =
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

  return (
    <div>
      <AdminPageHeader
        title="Site Content"
        subtitle="Edit your site-wide text in one place — the footer (store hours, hours line, the required WA compliance warning), business info, the wording on your About, Locations, and Price-Match pages, and the titles on your Privacy Policy, Terms of Use, and Consumer Health Data pages. Edit a draft, preview it, then Publish to go live."
        breadcrumbs={<Breadcrumbs items={[{ label: "Site Content" }]} />}
        help={
          <HelpPanel
            id="content"
            title="How Site Content works"
            steps={[
              "Use the search box or the page filters to find the wording you want to change.",
              "Click Edit on a block and change the draft — nothing goes live yet.",
              "Use the live preview to see exactly how it will look.",
              "Click Publish (or “Publish all drafts”) to update the public site.",
            ]}
          >
            <p className="mb-2">
              You can only edit specific approved spots, which keeps your site looking right —
              there&apos;s no way to accidentally break the layout.
            </p>
            <p>
              <strong>Where things live:</strong> footer &amp; business info and your simple text
              pages (About, Locations, Price Match) are edited here. Your richer pages with banners
              and sections — Home, Menu, Loyalty, Specials, Vendors, FAQ — are edited under{" "}
              <strong>Pages</strong> in the sidebar.
            </p>
          </HelpPanel>
        }
        action={
          <Button href="/admin/content/seo" variant="subtle">SEO editor →</Button>
        }
      />

      {/* SEO guidance — baked in so employees learn it in-context. */}
      <div className="px-5 pt-4 sm:px-8">
        <HelpPanel
          id="seo-explainer"
          title="What is the SEO editor, and how do I use it well?"
          steps={[
            "SEO (Search Engine Optimization) controls how each page looks in Google results and when shared on social media.",
            "Open the SEO editor (button top-right). Pick a page, then set its Title and Description.",
            "Title: ~50–60 characters. Lead with what the page is + “Greenway Marijuana” + “Port Orchard, WA”. One clear idea per page; make each page’s title unique.",
            "Description: ~150–160 characters. A friendly, accurate summary with a reason to click (e.g. daily deals, fast pickup). Each page should have its own.",
            "The social/Open-Graph image is what shows when a page is shared on Facebook/Instagram — use a clean 1200×630px image from your Media library.",
            "Edit as a draft, preview, then Publish — exactly like the content blocks here.",
          ]}
        >
          <p className="mb-2">
            <strong>Why it matters:</strong> good titles and descriptions help customers find you
            on Google and make your links look professional when shared. You don&apos;t need to be
            technical — just write clear, honest wording about each page.
          </p>
          <p className="mb-2">
            <strong>Cannabis compliance:</strong> Washington I-502 rules apply to how you advertise.
            Keep wording factual and age-appropriate, never make health/medical claims, and never
            imply the product is appealing to minors. When in doubt, describe the experience and the
            deal — not medical benefits.
          </p>
          <p>
            <strong>Best results:</strong> one unique title + description per page, real keywords
            your customers actually search (your city, “dispensary”, product categories, brands),
            and keep them fresh when you run a new promotion.
          </p>
        </HelpPanel>
      </div>

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
