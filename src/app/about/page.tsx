import { AboutContent } from "@/components/about/AboutContent";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { pageMetadata } from "@/lib/seo/seo";

export const metadata = pageMetadata({
  title: "About Greenway Marijuana — Port Orchard Dispensary",
  description:
    "Learn about Greenway Marijuana, a trusted Port Orchard cannabis dispensary focused on education, quality, community, and friendly customer service.",
  path: "/about",
});

export default function AboutPage() {
  return (
    <main id="top" className="min-h-screen bg-black text-white">
      <Header />
      <Breadcrumbs items={[{ label: "About" }]} />
      <AboutContent />
      <Footer />
    </main>
  );
}
