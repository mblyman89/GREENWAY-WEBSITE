import type { Metadata } from "next";
import { AboutPreview } from "@/components/about/AboutPreview";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";

export const metadata: Metadata = {
  title: "About | Greenway Marijuana",
  description:
    "Learn about Greenway Marijuana, a trusted Port Orchard cannabis dispensary focused on education, quality, community, and customer service.",
};

export default function AboutPage() {
  return (
    <main id="top" className="min-h-screen bg-black text-white">
      <Header />
      <Breadcrumbs items={[{ label: "About" }]} />
      <AboutPreview />
      <Footer />
    </main>
  );
}
