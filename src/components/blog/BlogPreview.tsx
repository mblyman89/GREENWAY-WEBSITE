import { BlogGrid } from "@/components/blog/BlogGrid";
import { blogPosts } from "@/lib/blog/posts";

export function BlogPreview() {
  return (
    <section className="relative overflow-hidden bg-black text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_8%,rgba(126,217,87,0.14),transparent_18rem),radial-gradient(circle_at_82%_12%,rgba(255,127,0,0.13),transparent_22rem),radial-gradient(circle_at_50%_78%,rgba(255,215,0,0.08),transparent_24rem)]" />
      <div className="noise-overlay" />

      <div className="relative mx-auto w-full max-w-[118rem] px-4 py-10 md:px-8 md:py-16 lg:px-10 lg:py-20">
        <div className="mx-auto max-w-6xl text-center">
          <p className="text-[0.7rem] font-black uppercase tracking-[0.28em] text-[var(--orange)] md:text-xs">
            The Blog
          </p>
          <h1 className="mt-3 text-4xl font-black uppercase leading-[0.95] tracking-tight text-white sm:text-5xl md:whitespace-nowrap md:text-6xl lg:text-7xl">
            {/* Mobile: two lines. Desktop: single line. */}
            <span className="md:hidden">
              Stories <span className="text-[var(--orange)]">|</span> Culture
              <br />
              Newsletters
            </span>
            <span className="hidden md:inline">
              Stories <span className="text-[var(--orange)]">|</span> Culture{" "}
              <span className="text-[var(--orange)]">|</span> Newsletters
            </span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base font-semibold leading-7 text-zinc-300 md:text-xl md:leading-8">
            Latest news, education, and Greenway vibes from Port Orchard.
          </p>
        </div>

        <div className="mt-9 md:mt-12 lg:mt-16">
          <BlogGrid posts={blogPosts} />
        </div>
      </div>
    </section>
  );
}
