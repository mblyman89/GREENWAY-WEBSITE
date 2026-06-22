import type { Metadata } from "next";
import { BlogPreview } from "@/components/blog/BlogPreview";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";

export const metadata: Metadata = {
  title: "Blog | Greenway Marijuana",
  description:
    "Stories, cannabis education, product highlights, deals, and culture updates from Greenway Marijuana in Port Orchard.",
};

export default function BlogPage() {
  return (
    <main id="top" className="min-h-screen bg-black text-white">
      <Header />
      <Breadcrumbs items={[{ label: "Blog" }]} />
      <BlogPreview />
      <Footer />
    </main>
  );
}
