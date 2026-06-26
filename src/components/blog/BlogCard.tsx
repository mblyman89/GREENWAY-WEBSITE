import Image from "next/image";
import Link from "next/link";
import type { BlogPost } from "@/lib/blog/posts";

const categoryStyles: Record<BlogPost["category"], string> = {
  PRODUCTS: "border-[var(--greenway)]/45 bg-[var(--greenway)] text-black",
  DEALS: "border-[var(--orange)]/45 bg-[var(--orange)] text-black",
  CULTURE: "border-white/20 bg-white text-black",
  NEWSLETTER: "border-[var(--gold)]/45 bg-[var(--gold)] text-black",
};

type BlogCardProps = {
  post: BlogPost;
};

export function BlogCard({ post }: BlogCardProps) {
  const isNewsletter = post.kind === "newsletter";

  if (isNewsletter) {
    return (
      <article className="group flex min-h-[38rem] flex-col overflow-hidden rounded-[1.7rem] border border-white/10 bg-zinc-950 shadow-2xl shadow-black/35 transition duration-300 hover:-translate-y-1 hover:border-[var(--orange)]/55 md:min-h-[43rem]">
        <div className="relative flex-1 overflow-hidden bg-white">
          <Image
            src={post.image.src}
            alt={post.image.alt}
            fill
            sizes="(min-width: 1024px) 33vw, 100vw"
            className="object-cover object-top transition duration-500 group-hover:scale-[1.02]"
            priority={false}
          />
          <span className={`absolute left-5 top-5 rounded-full border px-4 py-2 text-[0.68rem] font-black uppercase tracking-[0.18em] shadow-xl shadow-black/20 ${categoryStyles[post.category]}`}>
            {post.category}
          </span>
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-white/10 bg-zinc-950 p-5 md:p-6">
          <p className="text-[0.7rem] font-black uppercase tracking-[0.18em] text-zinc-300">
            {post.dateLabel}
          </p>
          <Link
            href={`/blog/${post.slug}`}
            className="shrink-0 rounded-full bg-[var(--orange)] px-5 py-3 text-[0.68rem] font-black uppercase tracking-[0.16em] text-black transition hover:bg-[var(--gold)]"
          >
            Read article
          </Link>
        </div>
      </article>
    );
  }

  return (
    <article className="group flex min-h-[38rem] flex-col overflow-hidden rounded-[1.7rem] border border-white/10 bg-zinc-950 shadow-2xl shadow-black/35 transition duration-300 hover:-translate-y-1 hover:border-[var(--orange)]/55 md:min-h-[43rem]">
      <div className="relative aspect-[1.16/1] min-h-72 overflow-hidden bg-zinc-900 md:min-h-80">
        <Image
          src={post.image.src}
          alt={post.image.alt}
          fill
          sizes="(min-width: 1024px) 33vw, 100vw"
          className="object-cover transition duration-500 group-hover:scale-105"
          priority={false}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/20" />
        <span className={`absolute left-5 top-5 rounded-full border px-4 py-2 text-[0.68rem] font-black uppercase tracking-[0.18em] shadow-xl shadow-black/20 ${categoryStyles[post.category]}`}>
          {post.category}
        </span>
      </div>

      <div className="flex flex-1 flex-col p-5 md:p-6">
        <p className="text-[0.7rem] font-black uppercase tracking-[0.18em] text-zinc-500">
          {post.dateLabel}
        </p>
        <h2 className="mt-3 text-2xl font-black leading-tight tracking-tight text-white md:text-[1.7rem]">
          {post.title}
        </h2>
        <p className="mt-4 flex-1 text-sm font-medium leading-6 text-zinc-400 md:text-base md:leading-7">
          {post.excerpt}
        </p>
        <Link
          href={`/blog/${post.slug}`}
          className="mt-6 inline-flex w-fit rounded-full bg-[var(--orange)] px-6 py-3 text-xs font-black uppercase tracking-[0.18em] text-black transition hover:bg-[var(--gold)]"
        >
          Read article
        </Link>
      </div>
    </article>
  );
}
