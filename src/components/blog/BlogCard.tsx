import Image from "next/image";
import Link from "next/link";
import type { BlogPost } from "@/lib/blog/posts";
import { formatBlogDate } from "@/lib/blog/format-date";
import { resolveTitleStyle } from "@/lib/blog/title-style";
import { blogCategoryGlowTone, glowCardStyle } from "@/lib/ui/glow-card-core";

const categoryStyles: Record<BlogPost["category"], string> = {
  PRODUCTS: "border-[var(--greenway)]/45 bg-[var(--greenway)] text-black",
  DEALS: "border-[var(--orange)]/45 bg-[var(--orange)] text-black",
  CULTURE: "border-white/20 bg-white text-black",
  NEWSLETTER: "border-[var(--gold)]/45 bg-[var(--gold)] text-black",
};

type BlogCardProps = {
  post: BlogPost;
  /** Owner-editable button label (SLICE 115); defaults to "Read article". */
  readMoreLabel?: string;
};

/**
 * The shared card shell classes. The signature edge-lit glow comes from the
 * inline glowCardStyle(tone) (reused from src/lib/ui/glow-card-core.ts, the same
 * recipe as the product / vendor / specials cards). On hover the card keeps its
 * existing slight lift, and `group-hover:brightness-110` makes the whole glow
 * (radial edges + strips) read brighter. The image zoom lives on the <Image>.
 */
const CARD_SHELL_CLASS =
  "group relative isolate flex min-h-[38rem] flex-col overflow-hidden rounded-[1.7rem] border transition duration-300 hover:-translate-y-1 group-hover:brightness-110 hover:brightness-110 md:min-h-[43rem]";

/** The three shared "glow strips" (left / right verticals + soft bottom line),
 *  colored from the tone and brightened on hover. */
function GlowStrips({ left, right }: { left: string; right: string }) {
  return (
    <>
      <span
        className="pointer-events-none absolute -left-px top-10 h-[42%] w-px opacity-90 blur-[1px] transition duration-300 group-hover:opacity-100"
        style={{ background: left }}
        aria-hidden="true"
      />
      <span
        className="pointer-events-none absolute -right-px top-[31%] h-[46%] w-px opacity-90 blur-[1px] transition duration-300 group-hover:opacity-100"
        style={{ background: right }}
        aria-hidden="true"
      />
      <span
        className="pointer-events-none absolute inset-x-7 -bottom-px h-px opacity-70 blur-[1px] transition duration-300 group-hover:opacity-100"
        style={{ background: right }}
        aria-hidden="true"
      />
    </>
  );
}

export function BlogCard({ post, readMoreLabel }: BlogCardProps) {
  const isNewsletter = post.kind === "newsletter";
  const buttonLabel = readMoreLabel?.trim() || "Read article";
  const dateText = formatBlogDate(post.publishDate, post.dateLabel);
  // Newsletter cards open the uploaded PDF directly (in a new tab); regular
  // articles open the full article page. Falls back to the article page if a
  // newsletter has no PDF yet.
  const newsletterPdf = post.newsletter?.pdfSrc?.trim();
  const titleStyle = resolveTitleStyle(post.titleStyle, "card");
  // The signature glow, colored to match this card's category pill.
  const tone = blogCategoryGlowTone(post.category);

  if (isNewsletter) {
    return (
      <article className={CARD_SHELL_CLASS} style={glowCardStyle(tone)}>
        <GlowStrips left={tone.glowLeft} right={tone.glowRight} />
        <div className="relative z-10 flex-1 overflow-hidden bg-white">
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

        <div className="relative z-10 flex items-center justify-between gap-4 border-t border-white/10 p-5 md:p-6">
          <p className="text-[0.7rem] font-black uppercase tracking-[0.14em] text-zinc-300">
            {dateText}
          </p>
          {newsletterPdf ? (
            <a
              href={newsletterPdf}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 rounded-full bg-[var(--orange)] px-5 py-3 text-[0.68rem] font-black uppercase tracking-[0.16em] text-black transition hover:bg-[var(--gold)]"
            >
              {buttonLabel}
            </a>
          ) : (
            <Link
              href={`/blog/${post.slug}`}
              className="shrink-0 rounded-full bg-[var(--orange)] px-5 py-3 text-[0.68rem] font-black uppercase tracking-[0.16em] text-black transition hover:bg-[var(--gold)]"
            >
              {buttonLabel}
            </Link>
          )}
        </div>
      </article>
    );
  }

  return (
    <article className={CARD_SHELL_CLASS} style={glowCardStyle(tone)}>
      <GlowStrips left={tone.glowLeft} right={tone.glowRight} />
      <div className="relative z-10 aspect-[1.16/1] min-h-72 overflow-hidden md:min-h-80">
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

      <div className="relative z-10 flex flex-1 flex-col p-5 md:p-6">
        <p className="text-[0.7rem] font-black uppercase tracking-[0.14em] text-zinc-500">
          {dateText}
        </p>
        <h2
          className={`mt-3 font-black leading-tight tracking-tight text-white ${titleStyle.className}`}
          style={titleStyle.style}
        >
          {post.title}
        </h2>
        <p className="mt-4 flex-1 text-sm font-medium leading-6 text-zinc-400 md:text-base md:leading-7">
          {post.excerpt}
        </p>
        <Link
          href={`/blog/${post.slug}`}
          className="mt-6 inline-flex w-fit rounded-full bg-[var(--orange)] px-6 py-3 text-xs font-black uppercase tracking-[0.18em] text-black transition hover:bg-[var(--gold)]"
        >
          {buttonLabel}
        </Link>
      </div>
    </article>
  );
}
