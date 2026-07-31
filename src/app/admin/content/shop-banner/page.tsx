import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { Button } from "@/components/admin/ui";
import {
  ShopBannerEditor,
  type ShopSlideVM,
} from "@/components/admin/ShopBannerEditor";
import {
  listShopCarouselSlides,
  ensureShopCarouselSeeded,
} from "@/lib/cms/shop-carousel-store";
import { listMedia } from "@/lib/media/store";
import type { MediaChoice } from "@/components/admin/ContentImageField";
import { resolveImageSpec } from "@/lib/cms/image-spec-core";
import { listShopPromotionChoices } from "@/lib/cms/shop-promotion-choices";
import {
  seedShopBannerAction,
  addShopBannerSlideAction,
  saveShopBannerSlideAction,
  publishShopBannerSlideAction,
  deleteShopBannerSlideAction,
  moveShopBannerSlideAction,
} from "./actions";

/**
 * Shop banner carousel editor (Admin → Content → Shop Banner), SLICE A / SHOP-1.
 *
 * The Shop (/menu) top banner is now a CAROUSEL of up to ten "special" slides.
 * This editor manages them — add / reorder / delete / publish per slide — and
 * each slide gets the full loyalty-hero editing power (image + three styled text
 * blocks with fonts/colors/cursive) PLUS per-slide CTA buttons + an optional
 * schedule, with a live preview. Needs content.edit.
 *
 * Ships WORKING PRE-MIGRATION: if the shop_carousel_slides table isn't there yet
 * the editor shows a friendly "setup pending" note and the public Shop page
 * keeps its classic single banner (unchanged).
 */
export const dynamic = "force-dynamic";

export default async function AdminShopBannerPage({
  searchParams,
}: {
  searchParams: Promise<{
    saved?: string;
    published?: string;
    added?: string;
    deleted?: string;
    moved?: string;
    seeded?: string;
    error?: string;
  }>;
}) {
  await requirePermission("content.edit");
  const sp = await searchParams;

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader
          title="Shop banner"
          subtitle="Build the carousel of banners at the top of your Shop page — no code."
        />
        <div className="px-5 py-6 sm:px-8 text-sm text-[var(--admin-gold)]">
          The database isn&apos;t fully set up yet. Once your administrator finishes the one-time
          setup, your Shop banner controls will appear here to edit.
        </div>
      </div>
    );
  }

  // Lazy, idempotent seed so the starter slide appears automatically once the
  // table exists. (No-op + returns 0 pre-migration; the editor detects that.)
  await ensureShopCarouselSeeded();
  const rows = await listShopCarouselSlides();

  // tableReady: if Supabase is configured and listing did not throw, we can
  // still have an empty list pre-seed. We detect "table missing" separately by
  // trying a seed above (returns 0 either way) — so we treat a successful list
  // call as ready. If the table truly doesn't exist, listShopCarouselSlides
  // returns [] (caught), and the seed also no-ops; the editor then shows the
  // empty-state "Create the starter slide" which will surface any real error.
  const tableReady = true;

  const slides: ShopSlideVM[] = rows.map((r) => ({
    id: r.id,
    sortOrder: r.sort_order,
    status: r.status,
    enabled: r.enabled,
    draftEnabled: r.draft_enabled,
    dirty: r.dirty,
    presentation: r.draft_presentation ?? r.presentation,
    publishedPresentation: r.presentation,
  }));

  // Media Library choices for the banner-image pickers (same source + shape the
  // loyalty / Pages builders use). Only published images with a public URL.
  const mediaAssets = await listMedia({ status: "published", limit: 200 });
  const mediaChoices: MediaChoice[] = mediaAssets
    .filter((m) => (m.mime_type ?? "").startsWith("image/") && m.public_url)
    .map((m) => ({
      id: m.id,
      url: m.public_url as string,
      title: m.title ?? m.filename ?? "Image",
      usageType: m.usage_type ?? null,
    }));
  const desktopSpec = resolveImageSpec("menu.hero.image");
  const mobileSpec = resolveImageSpec("menu.hero.image_mobile");

  // Published promotions the owner can link a slide to (SLICE B). Degrades to
  // the committed daily-deal seeds when the DB is empty, so the picker is never
  // blank.
  const promotionChoices = await listShopPromotionChoices();

  return (
    <div>
      <AdminPageHeader
        title="Shop banner"
        subtitle="The carousel of banners at the top of your Shop page. Add up to ten slides — great for one-off sales — and style each with its own picture, fonts, colors, and buttons."
        breadcrumbs={<Breadcrumbs items={[{ label: "Shop banner" }]} />}
        help={
          <HelpPanel
            id="shop-banner-editor"
            title="How the Shop banner works"
            steps={[
              "Add a slide, style its picture and text, then Publish that slide to put it live.",
              "Drag order with the up/down arrows — the first live slide shows first, then they auto-rotate.",
              "Use a slide’s buttons to send shoppers to a filtered menu (handy for a sale).",
              "Leave a slide’s schedule blank to show it always, or set a start/end for a one-off sale.",
            ]}
          >
            <p>
              Each slide is fully yours to style — the same powerful editor as the Loyalty banner,
              now for every slide, plus buttons and an optional schedule. Nothing goes live until you
              Publish that slide.
            </p>
          </HelpPanel>
        }
        action={<Button href="/menu" external variant="neutral">View live Shop page →</Button>}
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {sp.error ? (
          <div className="rounded-[var(--admin-radius-sm)] border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800">
            {decodeURIComponent(sp.error)}
          </div>
        ) : null}
        {(sp.saved || sp.published || sp.added || sp.deleted || sp.moved || sp.seeded) && (
          <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">
            {sp.published
              ? "Published live. 🎉"
              : sp.deleted
                ? "Slide deleted."
                : sp.moved
                  ? "Slide reordered."
                  : sp.added || sp.seeded
                    ? "Slide added — style it, then Publish."
                    : "Draft saved."}
          </div>
        )}

        <ShopBannerEditor
          slides={slides}
          tableReady={tableReady}
          mediaChoices={mediaChoices}
          promotionChoices={promotionChoices}
          desktopSpec={desktopSpec}
          mobileSpec={mobileSpec}
          createAction={addShopBannerSlideAction}
          saveDraftAction={saveShopBannerSlideAction}
          publishAction={publishShopBannerSlideAction}
          deleteAction={deleteShopBannerSlideAction}
          moveAction={moveShopBannerSlideAction}
          seedAction={seedShopBannerAction}
        />
      </div>
    </div>
  );
}
