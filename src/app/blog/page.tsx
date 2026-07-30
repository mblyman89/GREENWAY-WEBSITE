import { BlogContent } from "@/components/blog/BlogContent";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { pageMetadata } from "@/lib/seo/seo";
import { getPublicPosts } from "@/lib/cms/blog-store";
import { getContentValues, isPreviewActive } from "@/lib/cms/render-content";
import { BLOG_CONTENT_KEYS } from "@/lib/blog/blog-content-core";
import type { BlogPost } from "@/lib/blog/posts";

export const metadata = pageMetadata({
  title: "Cannabis Blog \u2014 Education, Product Highlights & Culture",
  description:
    "Stories, cannabis education, product highlights, deals, and culture updates from Greenway Marijuana in Port Orchard, WA.",
  path: "/blog",
});

// Revalidate periodically so newly published posts appear without a redeploy
// (publish actions also call revalidatePath('/blog')).
export const revalidate = 300;

export default async function BlogPage() {
  // DB-backed posts with automatic fallback to the built-in starter posts.
  // SLICE 115: the page CHROME (eyebrow, heading, intro, "Read article" label)
  // is now owner-editable via the Site Content editor (content_blocks). Post
  // content itself still lives in /admin/blog. Defaults are byte-identical, so
  // the page looks the same until Michael edits + publishes a block.
  const [posts, copy, preview] = await Promise.all([
    getPublicPosts() as Promise<BlogPost[]>,
    getContentValues([...BLOG_CONTENT_KEYS]),
    isPreviewActive(),
  ]);
  return (
    <main id="top" className="min-h-screen bg-black text-white">
      <Header />
      <Breadcrumbs items={[{ label: "Blog" }]} />
      <BlogContent posts={posts} copy={copy} editable={preview} />
      <Footer />
    </main>
  );
}
