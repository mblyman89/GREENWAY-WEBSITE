// PERF-S2 — published promotion rules for the Banner Design Studio ONLY.
//
// Before PERF-S2 the public-site root layout wrapped /admin too, so all 264
// admin pages paid for `loadPublishedRuleSnapshots()` (promotions + targets +
// exclusions + configs + never-discount, ~4-5 queries) on every navigation,
// although only the studio's live-deal preview (`LiveFields`, `StudioBoxText`)
// reads `usePublishedRules()`. Admin now has its own root layout
// (`src/app/admin/layout.tsx`), and the five routes that mount the studio get
// the rules from this tiny segment layout instead.
//
// D234 C-1 (SOP-11b, G-94): the same five routes also get the website's
// Heading / Body fonts (`site.font.heading` / `site.font.body`, read exactly
// like `src/app/(site)/layout.tsx`), so the studio canvas draws "Site font"
// text in the website's font. An uploaded site font gets its @font-face here.
import { PublishedRulesProvider } from "@/components/promotions/PublishedRulesProvider";
import { StudioSiteFontsProvider } from "@/components/admin/banner-studio/StudioSiteFonts";
import { loadPublishedRuleSnapshots } from "@/lib/promotions/discount-engine";
import { getContentValues } from "@/lib/cms/render-content";
import { SITE_FONT_KEYS, normalizeSiteFontIds, siteFontFaces } from "@/lib/cms/studio-fonts-core";

export async function StudioRulesLayout({ children }: { children: React.ReactNode }) {
  const [snapshots, fontValues] = await Promise.all([
    loadPublishedRuleSnapshots(),
    getContentValues([...SITE_FONT_KEYS]).catch(() => ({}) as Record<string, string>),
  ]);
  const fonts = normalizeSiteFontIds(fontValues["site.font.heading"], fontValues["site.font.body"]);
  const faces = siteFontFaces(fonts);
  return (
    <PublishedRulesProvider snapshots={snapshots}>
      {faces ? <style dangerouslySetInnerHTML={{ __html: faces }} /> : null}
      <StudioSiteFontsProvider fonts={fonts}>{children}</StudioSiteFontsProvider>
    </PublishedRulesProvider>
  );
}
