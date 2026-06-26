import { BlogContent } from "@/components/blog/BlogContent";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { pageMetadata } from "@/lib/seo/seo";

export const metadata = pageMetadata({
  title: "Cannabis Blog — Education, Product Highlights & Culture",
  description:
    "Stories, cannabis education, product highlights, deals, and culture updates from Greenway Marijuana in Port Orchard, WA.",
  path: "/blog",
});

export default function BlogPage() {
  return (
    <main id="top" className="min-h-screen bg-black text-white">
      <Header />
      <Breadcrumbs items={[{ label: "Blog" }]} />
      <BlogContent />
      <Footer />
    </main>
  );
}
