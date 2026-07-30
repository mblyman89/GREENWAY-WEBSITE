import { BlogGrid } from "@/components/blog/BlogGrid";
import { blogPosts } from "@/lib/blog/posts";
import type { BlogPost } from "@/lib/blog/posts";
import { resolveBlogCopy } from "@/lib/blog/blog-content-core";

type BlogContentProps = {
  posts?: BlogPost[];
  /** Published/draft overrides for the editable page-chrome copy. */
  copy?: Record<string, string | null | undefined>;
  /** When true (preview mode) render the ✎ Edit hotspot markers. */
  editable?: boolean;
};

export function BlogContent({
  posts = blogPosts,
  copy,
  editable = false,
}: BlogContentProps) {
  // SLICE 115: page CHROME is editable via content_blocks; defaults are
  // byte-identical so the live look is unchanged until Michael publishes.
  const eyebrow = resolveBlogCopy("blog.hero.eyebrow", copy);
  const part1 = resolveBlogCopy("blog.hero.heading.part1", copy);
  const part2 = resolveBlogCopy("blog.hero.heading.part2", copy);
  const part3 = resolveBlogCopy("blog.hero.heading.part3", copy);
  const intro = resolveBlogCopy("blog.hero.intro", copy);
  const readMore = resolveBlogCopy("blog.card.readMore", copy);

  return (
    <section className="relative overflow-hidden bg-black text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_8%,rgba(126,217,87,0.14),transparent_18rem),radial-gradient(circle_at_82%_12%,rgba(255,127,0,0.13),transparent_22rem),radial-gradient(circle_at_50%_78%,rgba(255,215,0,0.08),transparent_24rem)]" />
      <div className="noise-overlay" />

      <div className="relative mx-auto w-full max-w-[118rem] px-4 py-10 md:px-8 md:py-16 lg:px-10 lg:py-20">
        <div className="mx-auto max-w-6xl text-center">
          <p
            className="text-[0.7rem] font-black uppercase tracking-[0.28em] text-[var(--orange)] md:text-xs"
            {...(editable
              ? { "data-gw-block": "blog.hero.eyebrow", "data-gw-editable": "true" }
              : {})}
          >
            {eyebrow}
          </p>
          <h1 className="mt-3 text-4xl font-black uppercase leading-[0.95] tracking-tight text-white sm:text-5xl md:whitespace-nowrap md:text-6xl lg:text-7xl">
            {/* Mobile: two lines with the second line pushed DOWN so the "|"
                separator never bleeds into the Newsletters text. */}
            <span className="md:hidden">
              <span className="block">
                <span
                  {...(editable
                    ? { "data-gw-block": "blog.hero.heading.part1", "data-gw-editable": "true" }
                    : {})}
                >
                  {part1}
                </span>{" "}
                <span className="text-[var(--orange)]">|</span>{" "}
                <span
                  {...(editable
                    ? { "data-gw-block": "blog.hero.heading.part2", "data-gw-editable": "true" }
                    : {})}
                >
                  {part2}
                </span>
              </span>
              <span
                className="mt-2 block"
                {...(editable
                  ? { "data-gw-block": "blog.hero.heading.part3", "data-gw-editable": "true" }
                  : {})}
              >
                {part3}
              </span>
            </span>
            <span className="hidden md:inline">
              <span
                {...(editable
                  ? { "data-gw-block": "blog.hero.heading.part1", "data-gw-editable": "true" }
                  : {})}
              >
                {part1}
              </span>{" "}
              <span className="text-[var(--orange)]">|</span>{" "}
              <span
                {...(editable
                  ? { "data-gw-block": "blog.hero.heading.part2", "data-gw-editable": "true" }
                  : {})}
              >
                {part2}
              </span>{" "}
              <span className="text-[var(--orange)]">|</span>{" "}
              <span
                {...(editable
                  ? { "data-gw-block": "blog.hero.heading.part3", "data-gw-editable": "true" }
                  : {})}
              >
                {part3}
              </span>
            </span>
          </h1>
          <p
            className="mx-auto mt-5 max-w-2xl text-base font-semibold leading-7 text-zinc-300 md:text-xl md:leading-8"
            {...(editable
              ? { "data-gw-block": "blog.hero.intro", "data-gw-editable": "true" }
              : {})}
          >
            {intro}
          </p>
        </div>

        <div className="mt-9 md:mt-12 lg:mt-16">
          <BlogGrid posts={posts} readMoreLabel={readMore} />
        </div>
      </div>
    </section>
  );
}
