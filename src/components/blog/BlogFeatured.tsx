import Link from "next/link";
import type { BlogPreviewPost } from "@/components/blog/blog-preview-data";

type BlogFeaturedProps = {
  post: BlogPreviewPost;
};

export function BlogFeatured({ post }: BlogFeaturedProps) {
  return (
    <article className="overflow-hidden rounded-[1.35rem] border border-white/10 bg-zinc-950/90 shadow-2xl shadow-black/35 backdrop-blur md:rounded-[2rem]">
      <div className="grid lg:grid-cols-[0.92fr_1.08fr]">
        <div className="relative min-h-72 overflow-hidden bg-[linear-gradient(135deg,#f7cf45_0%,#f7cf45_22%,#f09a2a_22%,#f09a2a_36%,#7ed957_36%,#7ed957_52%,#111_52%,#111_100%)] p-5 md:min-h-96 md:p-8">
          <div className="absolute inset-0 opacity-30 [background-image:repeating-linear-gradient(115deg,rgba(0,0,0,0.38)_0_2px,transparent_2px_18px)]" />
          <div className="absolute -right-10 -top-8 h-36 w-36 rounded-full border-[18px] border-black/20 md:h-52 md:w-52" />
          <div className="absolute -bottom-16 left-1/2 h-44 w-44 -translate-x-1/2 rounded-full bg-black/25 blur-2xl" />

          <div className="relative flex min-h-64 flex-col justify-between md:min-h-80">
            <span className="w-fit rounded-full bg-black px-4 py-2 text-[0.62rem] font-black uppercase tracking-[0.16em] text-[var(--gold)] md:text-xs">
              {post.category}
            </span>

            <div className="max-w-[15rem] text-black md:max-w-xs">
              <p className="text-[0.7rem] font-black uppercase tracking-[0.24em] md:text-xs">Introducing</p>
              <p className="mt-2 text-5xl font-black uppercase leading-[0.82] tracking-tight md:text-7xl">
                Greenway
              </p>
              <p className="mt-3 w-fit bg-black px-3 py-2 text-sm font-black uppercase tracking-[0.16em] text-[var(--greenway)] md:text-lg">
                Editorial
              </p>
            </div>
          </div>
        </div>

        <div className="p-5 md:p-8 lg:p-9">
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-[var(--greenway)] px-3 py-1 text-[0.62rem] font-black uppercase tracking-[0.14em] text-black md:text-xs">
              {post.category}
            </span>
            <span className="text-[0.62rem] font-black uppercase tracking-[0.18em] text-zinc-500 md:text-xs">
              {post.dateLabel} · {post.readTime}
            </span>
          </div>
          <h2 className="mt-4 text-3xl font-black leading-tight text-white md:mt-5 md:text-5xl">
            {post.title}
          </h2>
          <p className="mt-4 text-sm leading-6 text-zinc-300 md:mt-5 md:text-base md:leading-7">
            {post.excerpt}
          </p>
          <p className="mt-4 text-xs leading-5 text-zinc-500 md:text-sm md:leading-6">
            Preview only: this article card demonstrates the blog layout. Final article routes, imagery, bylines, publish dates, and SEO metadata still need approved Greenway content.
          </p>
          <div className="mt-6 flex flex-wrap gap-3 md:mt-7">
            <Link href="/blog" className="rounded-full bg-[var(--orange)] px-6 py-3 text-xs font-black uppercase tracking-[0.16em] text-black transition hover:bg-[var(--gold)]">
              Read article
            </Link>
            <Link href="/faq" className="rounded-full border border-white/15 px-6 py-3 text-xs font-black uppercase tracking-[0.16em] text-white transition hover:border-[var(--greenway)] hover:text-[var(--greenway)]">
              Read FAQ
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}
