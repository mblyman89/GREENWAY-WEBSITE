import { BlogContent } from "@/components/blog/BlogContent";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { pageMetadata } from "@/lib/seo/seo";
import { getPublicPosts } from "@/lib/cms/blog-store";
import type { BlogPost } from "@/lib/blog/posts";

export const metadata = pageMetadata({
  title: "Cannabis Blog — Education, Product Highlights & Culture",
  description:
    "Stories, cannabis education, product highlights, deals, and culture updates from Greenway Marijuana in Port Orchard, WA.",
  path: "/blog",
});

// Revalidate periodically so newly published posts appear without a redeploy
// (publish actions also call revalidatePath('/blog')).
export const revalidate = 300;

export default async function BlogPage() {
  // DB-backed posts with automatic fallback to the built-in starter posts.
  const posts = (await getPublicPosts()) as BlogPost[];
  return (
    <main id="top" className="min-h-screen bg-black text-white">
      <Header />
      <Breadcrumbs items={[{ label: "Blog" }]} />
      <BlogContent posts={posts} />
      <Footer />
    </main>
  );
}
