import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { getPublicPost, getPublishedSlugs } from "@/lib/cms/blog-store";

type BlogArticlePageProps = {
  params: Promise<{
    slug: string;
  }>;
};

// Allow slugs created in the CMS that weren't known at build time.
export const dynamicParams = true;
export const revalidate = 300;

export async function generateStaticParams() {
  const slugs = await getPublishedSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: BlogArticlePageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPublicPost(slug);

  if (!post) {
    return {
      title: "Blog Article | Greenway Marijuana",
    };
  }

  return {
    title: `${post.title} | Greenway Marijuana`,
    description: post.excerpt,
  };
}

export default async function BlogArticlePage({ params }: BlogArticlePageProps) {
  const { slug } = await params;
  const post = await getPublicPost(slug);

  if (!post) notFound();

  const isNewsletter = post.kind === "newsletter";

  return (
    <main id="top" className="min-h-screen bg-black text-white">
      <Header />
      <Breadcrumbs items={[{ label: "Blog", href: "/blog" }, { label: post.title }]} />

      <article className="relative overflow-hidden bg-black text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_8%,rgba(126,217,87,0.14),transparent_18rem),radial-gradient(circle_at_86%_10%,rgba(255,127,0,0.14),transparent_22rem)]" />
        <div className="noise-overlay" />

        <div className="relative mx-auto max-w-6xl px-4 py-8 md:px-8 md:py-14 lg:py-18">
          <div className="mb-5 flex items-center justify-between gap-4 md:mb-7">
            <span className="rounded-full bg-[var(--orange)] px-4 py-2 text-[0.68rem] font-black uppercase tracking-[0.18em] text-black md:text-xs">
              {post.category}
            </span>
            <Link href="/blog" className="rounded-full border border-white/15 px-4 py-2 text-[0.68rem] font-black uppercase tracking-[0.16em] text-white transition hover:border-[var(--orange)] hover:text-[var(--orange)] md:text-xs">
              ← Back to blog
            </Link>
          </div>

          {isNewsletter && post.newsletter ? (
            <div className="mx-auto max-w-4xl">
              <div className="grid gap-6 md:gap-8">
                {post.newsletter.pages.map((pageSrc, index) => (
                  <figure key={pageSrc} className="overflow-hidden rounded-[1.25rem] border border-white/10 bg-white shadow-2xl shadow-black/35 md:rounded-[1.75rem]">
                    <Image
                      src={pageSrc}
                      alt={`${post.title} page ${index + 1}`}
                      width={993}
                      height={1404}
                      sizes="(min-width: 768px) 768px, 100vw"
                      className="h-auto w-full"
                      priority={index === 0}
                    />
                  </figure>
                ))}
              </div>
            </div>
          ) : (
            <div className="overflow-hidden rounded-[1.6rem] border border-white/10 bg-zinc-950 shadow-2xl shadow-black/40 md:rounded-[2.1rem]">
              <div className="relative min-h-[22rem] overflow-hidden bg-zinc-900 md:min-h-[34rem] lg:min-h-[40rem]">
                <Image
                  src={post.image.src}
                  alt={post.image.alt}
                  fill
                  sizes="(min-width: 1024px) 1100px, 100vw"
                  className="object-cover"
                  priority
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/15 to-black/20" />
                <div className="absolute bottom-0 left-0 right-0 p-5 md:p-8 lg:p-10">
                  <p className="text-[0.7rem] font-black uppercase tracking-[0.18em] text-[var(--orange)] md:text-xs">
                    {post.dateLabel}
                  </p>
                  <h1 className="mt-3 max-w-5xl text-3xl font-black leading-tight tracking-tight text-white md:text-5xl lg:text-6xl">
                    {post.title}
                  </h1>
                  <div className="mt-4 flex flex-wrap items-center gap-3 text-xs font-black uppercase tracking-[0.14em] text-zinc-300 md:text-sm">
                    <span>{post.author}</span>
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--greenway)]" aria-hidden="true" />
                    <time dateTime={post.publishDate}>{post.dateLabel}</time>
                  </div>
                </div>
              </div>

              <div className="px-5 py-7 md:px-9 md:py-10 lg:px-12">
                <div className="mx-auto max-w-4xl space-y-6 text-base font-medium leading-8 text-zinc-200 md:text-lg md:leading-9">
                  {post.content.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </article>

      <Footer />
    </main>
  );
}
