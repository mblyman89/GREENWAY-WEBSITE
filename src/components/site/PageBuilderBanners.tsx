/**
 * R42 (owner answer Q3) — banners the owner adds in Admin → Pages for the
 * About / FAQ / Locations / Price Match pages.
 *
 * Before R42 those pages had a "+ Add section" button whose banners were saved
 * but never shown (a dead control). The owner delegated the decision; the
 * choice made (bible R42 PART 2):
 *
 *   - Each of these pages KEEPS its own designed top (big title, map, photo).
 *     Builder banners never replace it.
 *   - Builder banners render as an optional strip of SectionBanners in ONE
 *     consistent slot: after the page's own content, before the footer. This is
 *     the same pattern Vendors already uses for its "extra" banners.
 *   - No banners added = this renders NOTHING (zero markup), so all four pages
 *     are unchanged until the owner adds and publishes one.
 *
 * Server component. Published-only for visitors; drafts only in Draft Mode
 * (getPageBanners), where they also get the hub Move-mode hooks.
 */
import { SectionBanner } from "@/components/home/SectionBanner";
import { getPageBanners } from "@/lib/cms/page-sections-store";
import { pinnedImageFocus } from "@/lib/cms/page-sections-types";

export async function PageBuilderBanners({ pageSlug }: { pageSlug: string }) {
  const { extras } = await getPageBanners(pageSlug, []);
  if (extras.length === 0) return null;
  return (
    <section aria-label="More from Greenway" className="px-4 pb-8 pt-2 text-white md:px-8 md:pb-12">
      <div className="mx-auto max-w-[88rem] space-y-6 md:space-y-8">
        {extras.map((s) => (
          <SectionBanner
            key={s.key}
            imageSrc={s.image}
            imageAlt={s.imageAlt}
            eyebrow={s.eyebrow}
            title={s.title}
            subtitle={s.subtitle}
            buttons={s.buttons}
            textAlign={s.textAlign}
            imageFocus={pinnedImageFocus(s.imageFocus)}
            design={s.design}
            designOwner={s.designOwner}
            editable={s.editable}
          />
        ))}
      </div>
    </section>
  );
}
