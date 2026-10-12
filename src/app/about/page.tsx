import { PageBuilderBanners } from "@/components/site/PageBuilderBanners";
import { AboutContent } from "@/components/about/AboutContent";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { pageMetadata } from "@/lib/seo/seo";
import { withSeoOverride } from "@/lib/seo/seo-entries-server";

const baseMetadata = pageMetadata({
  title: "About Greenway Marijuana — Port Orchard Dispensary",
  description:
    "Learn about Greenway Marijuana, a trusted Port Orchard cannabis dispensary focused on education, quality, community, and friendly customer service.",
  path: "/about",
});

// R46-S2: the SEO Editor (/admin/content/seo) can override title, description,
// canonical, no-index and share image; the values above are the defaults.
export async function generateMetadata() {
  return withSeoOverride(baseMetadata, "/about");
}

export default function AboutPage() {
  return (
    <main id="top" className="min-h-screen bg-black text-white">
      <Header />
      <Breadcrumbs items={[{ label: "About" }]} />
      <AboutContent />
      {/* R42 Q3: optional banners from Admin → Pages (about); renders nothing when none are published. */}
      <PageBuilderBanners pageSlug="about" />
      <Footer />
    </main>
  );
}
