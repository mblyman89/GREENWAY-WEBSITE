"use client";

/**
 * D239 N-7 (F-22-18; Q-22-7): All / Store / Culture / Newsletters chips on the
 * same /blog page. No new tab or page: the chips only filter the cards in
 * place, and the choice is kept in the address hash (/blog#culture) so a link
 * can open the page on one view.
 */
import { useEffect, useState } from "react";
import { BlogGrid } from "@/components/blog/BlogGrid";
import type { BlogPost } from "@/lib/blog/posts";
import { BLOG_VIEWS, filterPostsByView, viewCounts, viewFromHash, type BlogView } from "@/lib/blog/blog-blocks-core";

export function BlogFilterGrid({ posts, readMoreLabel }: { posts: BlogPost[]; readMoreLabel?: string }) {
  const [view, setView] = useState<BlogView>("all");
  useEffect(() => {
    const read = () => setView(viewFromHash(window.location.hash));
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  const counts = viewCounts(posts);
  const shown = filterPostsByView(posts, view);

  function choose(v: BlogView) {
    setView(v);
    const url = v === "all" ? window.location.pathname + window.location.search : `#${v}`;
    window.history.replaceState(null, "", url);
  }

  return (
    <div>
      <div role="group" aria-label="Filter posts" className="mb-6 flex flex-wrap justify-center gap-2 md:mb-8" data-testid="blog-filters">
        {BLOG_VIEWS.filter((v) => v.key === "all" || counts[v.key] > 0).map((v) => {
          const active = v.key === view;
          return (
            <button
              key={v.key}
              type="button"
              aria-pressed={active}
              onClick={() => choose(v.key)}
              className={`rounded-full border px-4 py-2 text-[0.7rem] font-black uppercase tracking-[0.16em] transition md:text-xs ${
                active ? "border-[var(--orange)] bg-[var(--orange)] text-black" : "border-white/15 text-white hover:border-[var(--orange)] hover:text-[var(--orange)]"
              }`}
            >
              {v.label} <span className={active ? "text-black/70" : "text-zinc-400"}>({counts[v.key]})</span>
            </button>
          );
        })}
      </div>
      {shown.length ? (
        <BlogGrid posts={shown} readMoreLabel={readMoreLabel} />
      ) : (
        <p className="text-center text-sm font-semibold text-zinc-400">No posts here yet.</p>
      )}
    </div>
  );
}
