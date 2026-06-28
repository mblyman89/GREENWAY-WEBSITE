import { FaqContent } from "@/components/faq/FaqContent";
import { faqItems } from "@/content/faq";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { JsonLd } from "@/components/seo/JsonLd";
import { faqSchema, pageMetadata } from "@/lib/seo/seo";
import { getContentValues, isPreviewActive } from "@/lib/cms/render-content";
import { getFaqForRender } from "@/lib/cms/faq-store";

export const metadata = pageMetadata({
  title: "Frequently Asked Questions — Hours, ID, Payment & Limits",
  description:
    "Answers to common questions about Greenway Marijuana in Port Orchard: store hours, accepted ID, payment, purchase limits, and dispensary policies for adults 21+.",
  path: "/faq",
});

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
      <Footer />
    </main>
  );
}
