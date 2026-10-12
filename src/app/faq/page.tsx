import { PageBuilderBanners } from "@/components/site/PageBuilderBanners";
import { FaqContent } from "@/components/faq/FaqContent";
import { faqItems } from "@/content/faq";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { JsonLd } from "@/components/seo/JsonLd";
import { faqSchema, pageMetadata } from "@/lib/seo/seo";
import { withSeoOverride } from "@/lib/seo/seo-entries-server";
import { getContentValues, isPreviewActive } from "@/lib/cms/render-content";
import { getFaqForRender } from "@/lib/cms/faq-store";

const baseMetadata = pageMetadata({
  title: "Frequently Asked Questions — Hours, ID, Payment & Limits",
  description:
    "Answers to common questions about Greenway Marijuana in Port Orchard: store hours, accepted ID, payment, purchase limits, and dispensary policies for adults 21+.",
  path: "/faq",
});

// R46-S2: the SEO Editor (/admin/content/seo) can override title, description,
// canonical, no-index and share image; the values above are the defaults.
export async function generateMetadata() {
  return withSeoOverride(baseMetadata, "/faq");
}

export default async function FaqPage() {
  const [copy, preview, dbFaq] = await Promise.all([
    getContentValues(["faq.hero.title", "faq.hero.subtitle"]),
    isPreviewActive(),
    getFaqForRender(),
  ]);

  // DB-backed Q&A when present; otherwise the committed static list.
  const items =
    dbFaq.length > 0
      ? dbFaq.map((i) => ({ question: i.question, answer: i.answer }))
      : faqItems.map((i) => ({ question: i.question, answer: i.answer }));

  return (
    <main id="top" className="min-h-screen bg-black text-white">
      <JsonLd
        data={faqSchema(items.map((item) => ({ question: item.question, answer: item.answer })))}
        id="faq"
      />
      <Header />
      <Breadcrumbs items={[{ label: "FAQ", href: "/faq" }]} />
      <FaqContent
        content={{
          title: copy["faq.hero.title"],
          subtitle: copy["faq.hero.subtitle"],
          editable: preview,
        }}
        items={items}
      />
      {/* R42 Q3: optional banners from Admin → Pages (faq); renders nothing when none are published. */}
      <PageBuilderBanners pageSlug="faq" />
      <Footer />
    </main>
  );
}
