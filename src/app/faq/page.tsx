import type { Metadata } from "next";
import { FaqPreview } from "@/components/faq/FaqPreview";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";

export const metadata: Metadata = {
  title: "FAQ | Greenway Marijuana",
  description: "Frequently asked questions about shopping with Greenway Marijuana.",
};

export default function FaqPage() {
  return (
    <main id="top" className="min-h-screen bg-black text-white">
      <Header />
      <Breadcrumbs items={[{ label: "FAQ" }]} />
      <FaqPreview />
      <Footer />
    </main>
  );
}
