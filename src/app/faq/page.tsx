import { FaqContent } from "@/components/faq/FaqContent";
import { faqItems } from "@/content/faq";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { JsonLd } from "@/components/seo/JsonLd";
import { faqSchema, pageMetadata } from "@/lib/seo/seo";
import { getContentValues, isPreviewActive } from "@/lib/cms/render-content";

export const metadata = pageMetadata({
  title: "Frequently Asked Questions — Hours, ID, Payment & Limits",
  description:
    "Answers to common questions about Greenway Marijuana in Port Orchard: store hours, accepted ID, payment, purchase limits, and dispensary policies for adults 21+.",
  path: "/faq",
});

export default async function FaqPage() {
  const [copy, preview] = await Promise.all([
    getContentValues(["faq.hero.title", "faq.hero.subtitle"]),
    isPreviewActive(),
  ]);

  return (
    <main id="top" className="min-h-screen bg-black text-white">
      <JsonLd
        data={faqSchema(faqItems.map((item) => ({ question: item.question, answer: item.answer })))}
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
      />
      <Footer />
    </main>
  );
}
