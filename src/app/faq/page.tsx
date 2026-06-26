import { FaqContent } from "@/components/faq/FaqContent";
import { faqItems } from "@/content/faq";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { JsonLd } from "@/components/seo/JsonLd";
import { faqSchema, pageMetadata } from "@/lib/seo/seo";

export const metadata = pageMetadata({
  title: "Frequently Asked Questions — Hours, ID, Payment & Limits",
  description:
    "Answers to common questions about Greenway Marijuana in Port Orchard: store hours, accepted ID, payment, purchase limits, and dispensary policies for adults 21+.",
  path: "/faq",
});

export default function FaqPage() {
  return (
    <main id="top" className="min-h-screen bg-black text-white">
      <JsonLd
        data={faqSchema(faqItems.map((item) => ({ question: item.question, answer: item.answer })))}
        id="faq"
      />
      <Header />
      <Breadcrumbs items={[{ label: "FAQ", href: "/faq" }]} />
      <FaqContent />
      <Footer />
    </main>
  );
}
