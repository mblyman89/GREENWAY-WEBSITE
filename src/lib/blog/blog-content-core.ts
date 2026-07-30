/**
 * src/lib/blog/blog-content-core.ts
 *
 * SLICE 115: the editable page-chrome copy for the public Blog page
 * (/blog) and the article detail page (/blog/[slug]).
 *
 * This is a PURE core module (no server / React imports) so it can be:
 *   1. imported by content-blocks-seed.ts to derive byte-identical seeds, and
 *   2. imported by the public pages to supply safe fallbacks, and
 *   3. self-tested by run-pure-selftests.ts.
 *
 * IMPORTANT — LIVE-LOOK-SAFE: every `fallback` here is byte-for-byte identical
 * to the copy the page renders TODAY. Seeding these blocks must produce no
 * visible change until Michael edits and publishes a block. The blog POSTS
 * themselves are NOT touched by this — post content stays in /admin/blog (the
 * single source of truth). This only makes the page CHROME (headings, intro,
 * button/label text) owner-editable.
 */

export type BlogContentBlock = {
  /** content_blocks key, e.g. "blog.hero.heading.line1". */
  key: string;
  /** Human label shown in the Site Content editor list. */
  label: string;
  /** The exact live copy today — the seed default AND the render fallback. */
  fallback: string;
  /** Optional editor help text. */
  help?: string;
};

// ---------------------------------------------------------------------------
// The curated, byte-identical blog page-chrome blocks.
// (Values mirror src/components/blog/BlogContent.tsx + the detail chrome in
//  src/app/blog/[slug]/page.tsx and the card "Read article" button.)
// ---------------------------------------------------------------------------
export const BLOG_CONTENT_BLOCKS: readonly BlogContentBlock[] = [
  {
    key: "blog.hero.eyebrow",
    label: "Blog \u2014 hero eyebrow",
    fallback: "The Blog",
    help: "Small label above the big heading on the blog landing page.",
  },
  {
    key: "blog.hero.heading.part1",
    label: "Blog \u2014 heading word 1",
    fallback: "Stories",
    help: 'First word of the blog heading ("Stories | Culture | Newsletters").',
  },
  {
    key: "blog.hero.heading.part2",
    label: "Blog \u2014 heading word 2",
    fallback: "Culture",
    help: "Middle word of the blog heading.",
  },
  {
    key: "blog.hero.heading.part3",
    label: "Blog \u2014 heading word 3",
    fallback: "Newsletters",
    help: "Last word of the blog heading.",
  },
  {
    key: "blog.hero.intro",
    label: "Blog \u2014 intro paragraph",
    fallback: "Latest news, education, and Greenway vibes from Port Orchard.",
    help: "The paragraph under the blog heading.",
  },
  {
    key: "blog.card.readMore",
    label: "Blog \u2014 card button label",
    fallback: "Read article",
    help: 'The button on every blog/newsletter card (default "Read article").',
  },
  {
    key: "blog.detail.backLabel",
    label: "Blog \u2014 article back link",
    fallback: "\u2190 Back to blog",
    help: "The link at the top of an article that returns to the blog list.",
  },
] as const;

/** All blog page-chrome content_blocks keys (for getContentValues). */
export const BLOG_CONTENT_KEYS: readonly string[] = BLOG_CONTENT_BLOCKS.map(
  (b) => b.key,
);

/** Byte-identical default map, keyed by block key. */
export const BLOG_CONTENT_DEFAULTS: Readonly<Record<string, string>> =
  Object.freeze(
    BLOG_CONTENT_BLOCKS.reduce<Record<string, string>>((acc, b) => {
      acc[b.key] = b.fallback;
      return acc;
    }, {}),
  );

/**
 * Resolve one blog copy value: a non-blank override wins, otherwise the
 * byte-identical default. Unknown keys return "" (never throws).
 */
export function resolveBlogCopy(
  key: string,
  overrides?: Record<string, string | null | undefined>,
): string {
  const override = overrides?.[key];
  if (typeof override === "string" && override.trim().length > 0) {
    return override;
  }
  return BLOG_CONTENT_DEFAULTS[key] ?? "";
}

// ---------------------------------------------------------------------------
// Self-tests (pure; run by scripts/compliance/run-pure-selftests.ts).
// ---------------------------------------------------------------------------
export function runBlogContentCoreSelfTests(): string[] {
  const failures: string[] = [];
  const check = (cond: boolean, msg: string) => {
    if (!cond) failures.push(msg);
  };

  // 7 curated blocks, unique keys, all blog.* namespaced.
  check(BLOG_CONTENT_BLOCKS.length === 7, "expected 7 blog content blocks");
  check(
    new Set(BLOG_CONTENT_KEYS).size === BLOG_CONTENT_KEYS.length,
    "blog content keys must be unique",
  );
  check(
    BLOG_CONTENT_KEYS.every((k) => k.startsWith("blog.")),
    "all blog content keys must be namespaced blog.*",
  );

  // Byte-identical defaults (guards against drift from the live copy).
  check(
    BLOG_CONTENT_DEFAULTS["blog.hero.eyebrow"] === "The Blog",
    "eyebrow default must be 'The Blog'",
  );
  check(
    BLOG_CONTENT_DEFAULTS["blog.hero.heading.part1"] === "Stories" &&
      BLOG_CONTENT_DEFAULTS["blog.hero.heading.part2"] === "Culture" &&
      BLOG_CONTENT_DEFAULTS["blog.hero.heading.part3"] === "Newsletters",
    "heading parts must be Stories/Culture/Newsletters",
  );
  check(
    BLOG_CONTENT_DEFAULTS["blog.hero.intro"] ===
      "Latest news, education, and Greenway vibes from Port Orchard.",
    "intro default drift",
  );
  check(
    BLOG_CONTENT_DEFAULTS["blog.card.readMore"] === "Read article",
    "card button default must be 'Read article'",
  );
  check(
    BLOG_CONTENT_DEFAULTS["blog.detail.backLabel"] === "\u2190 Back to blog",
    "detail back label default drift",
  );

  // Resolver: default when no/blank override, override wins when non-blank.
  check(
    resolveBlogCopy("blog.hero.eyebrow") === "The Blog",
    "resolveBlogCopy default",
  );
  check(
    resolveBlogCopy("blog.hero.eyebrow", {}) === "The Blog",
    "resolveBlogCopy empty overrides -> default",
  );
  check(
    resolveBlogCopy("blog.hero.eyebrow", { "blog.hero.eyebrow": "   " }) ===
      "The Blog",
    "resolveBlogCopy blank override -> default",
  );
  check(
    resolveBlogCopy("blog.hero.eyebrow", { "blog.hero.eyebrow": "Our Blog" }) ===
      "Our Blog",
    "resolveBlogCopy non-blank override wins",
  );
  check(
    resolveBlogCopy("blog.hero.eyebrow", { "blog.hero.eyebrow": null }) ===
      "The Blog",
    "resolveBlogCopy null override -> default",
  );
  check(resolveBlogCopy("blog.unknown.key") === "", "unknown key -> empty");

  return failures;
}

/**
 * Adapter for scripts/compliance/run-pure-selftests.ts (assertNoFailures).
 */
export function __runBlogContentCoreTests(): { passed: number; failed: number } {
  const failures = runBlogContentCoreSelfTests();
  return { passed: 0, failed: failures.length };
}
