/**
 * SLICE 115 — Blog page editor + Canva jump + full connections.
 *
 * Michael: make the blog page an editable page (all page-chrome elements
 * editable) WITHOUT touching post content, connect it to the blog & newsletter
 * editors in the MKTG & ADV dropdown, and add a "jump to Canva" button.
 *
 * NEVER GUESS contracts under test:
 *  - blog-content-core exposes 7 blog.* page-chrome blocks whose defaults are
 *    BYTE-IDENTICAL to the copy the page renders today (live-look-safe), plus a
 *    resolver where a non-blank override wins and blank/unknown fall back.
 *  - Those blocks are seeded (page:"blog") into CONTENT_BLOCK_SEEDS, byte for
 *    byte, and blog is NOT in PAGE_BUILDER_PAGES (so they show in Site Content).
 *  - The public pages read the blocks via getContentValues + render them with
 *    data-gw-block markers when preview is on; the "Read article" and
 *    "Back to blog" labels are editable with the correct defaults.
 *  - Canva: resolveCanvaUrl only ever returns an https canva.com URL (default
 *    the dashboard); hostile/off-domain/non-https values fall back. The
 *    "Open Canva" button appears in BOTH the blog and newsletter admin pages.
 *  - Individual published posts are added to the sitemap.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  BLOG_CONTENT_BLOCKS,
  BLOG_CONTENT_KEYS,
  BLOG_CONTENT_DEFAULTS,
  resolveBlogCopy,
  runBlogContentCoreSelfTests,
} from "@/lib/blog/blog-content-core";
import {
  CANVA_DEFAULT_URL,
  resolveCanvaUrl,
  runCanvaCoreSelfTests,
} from "@/lib/marketing/canva-core";
import { CONTENT_BLOCK_SEEDS } from "@/lib/cms/content-blocks-seed";

const read = (p: string) => readFileSync(p, "utf8");

describe("SLICE 115 — blog-content-core (pure)", () => {
  it("passes its own self-tests", () => {
    expect(runBlogContentCoreSelfTests()).toEqual([]);
  });

  it("exposes exactly 7 unique blog.* blocks", () => {
    expect(BLOG_CONTENT_BLOCKS.length).toBe(7);
    expect(new Set(BLOG_CONTENT_KEYS).size).toBe(7);
    expect(BLOG_CONTENT_KEYS.every((k) => k.startsWith("blog."))).toBe(true);
  });

  it("keeps byte-identical live defaults (live-look-safe)", () => {
    expect(BLOG_CONTENT_DEFAULTS["blog.hero.eyebrow"]).toBe("The Blog");
    expect(BLOG_CONTENT_DEFAULTS["blog.hero.heading.part1"]).toBe("Stories");
    expect(BLOG_CONTENT_DEFAULTS["blog.hero.heading.part2"]).toBe("Culture");
    expect(BLOG_CONTENT_DEFAULTS["blog.hero.heading.part3"]).toBe("Newsletters");
    expect(BLOG_CONTENT_DEFAULTS["blog.hero.intro"]).toBe(
      "Latest news, education, and Greenway vibes from Port Orchard.",
    );
    expect(BLOG_CONTENT_DEFAULTS["blog.card.readMore"]).toBe("Read article");
    expect(BLOG_CONTENT_DEFAULTS["blog.detail.backLabel"]).toBe(
      "\u2190 Back to blog",
    );
  });

  it("resolver: non-blank override wins; blank/null/unknown fall back", () => {
    expect(resolveBlogCopy("blog.hero.eyebrow")).toBe("The Blog");
    expect(resolveBlogCopy("blog.hero.eyebrow", {})).toBe("The Blog");
    expect(resolveBlogCopy("blog.hero.eyebrow", { "blog.hero.eyebrow": "  " })).toBe(
      "The Blog",
    );
    expect(
      resolveBlogCopy("blog.hero.eyebrow", { "blog.hero.eyebrow": null }),
    ).toBe("The Blog");
    expect(
      resolveBlogCopy("blog.hero.eyebrow", { "blog.hero.eyebrow": "Our Blog" }),
    ).toBe("Our Blog");
    expect(resolveBlogCopy("blog.unknown")).toBe("");
  });
});

describe("SLICE 115 — canva-core (pure)", () => {
  it("passes its own self-tests", () => {
    expect(runCanvaCoreSelfTests()).toEqual([]);
  });

  it("defaults to the Canva dashboard and only allows https canva.com", () => {
    expect(CANVA_DEFAULT_URL).toBe("https://www.canva.com/");
    expect(resolveCanvaUrl()).toBe(CANVA_DEFAULT_URL);
    expect(resolveCanvaUrl("https://www.canva.com/brand/kit")).toBe(
      "https://www.canva.com/brand/kit",
    );
    expect(resolveCanvaUrl("https://canva.com/design/x")).toBe(
      "https://canva.com/design/x",
    );
    // hostile / wrong -> default
    expect(resolveCanvaUrl("http://www.canva.com/")).toBe(CANVA_DEFAULT_URL);
    expect(resolveCanvaUrl("https://evil.com")).toBe(CANVA_DEFAULT_URL);
    expect(resolveCanvaUrl("https://canva.com.evil.com")).toBe(CANVA_DEFAULT_URL);
    expect(resolveCanvaUrl("javascript:alert(1)")).toBe(CANVA_DEFAULT_URL);
    expect(resolveCanvaUrl("nonsense")).toBe(CANVA_DEFAULT_URL);
  });
});

describe("SLICE 115 — seeds (no migration, byte-identical)", () => {
  it("seeds every blog block on page 'blog' with the byte-identical default", () => {
    for (const block of BLOG_CONTENT_BLOCKS) {
      const seed = CONTENT_BLOCK_SEEDS.find((s) => s.block_key === block.key);
      expect(seed, `seed for ${block.key}`).toBeTruthy();
      expect(seed!.page).toBe("blog");
      expect(seed!.field_type).toBe("plain");
      expect(seed!.defaultValue).toBe(block.fallback);
    }
  });

  it("adds all 7 blog seeds", () => {
    const blogSeeds = CONTENT_BLOCK_SEEDS.filter((s) => s.page === "blog");
    expect(blogSeeds.length).toBe(7);
  });
});

describe("SLICE 115 — blog is editable in Site Content", () => {
  it("blog is NOT filtered out of the Site Content editor", () => {
    const src = read("src/app/admin/content/page.tsx");
    const set = src.slice(
      src.indexOf("PAGE_BUILDER_PAGES = new Set"),
      src.indexOf("]);", src.indexOf("PAGE_BUILDER_PAGES = new Set")),
    );
    expect(set.includes('"blog"')).toBe(false);
  });

  it("blog is wired into the preview page picker", () => {
    const src = read("src/components/admin/ContentPreviewPanel.tsx");
    expect(src).toContain('path: "/blog", page: "blog"');
  });
});

describe("SLICE 115 — public wiring (live-look-safe + preview hotspots)", () => {
  it("blog/page.tsx reads the blog content keys + preview", () => {
    const src = read("src/app/blog/page.tsx");
    expect(src).toContain("BLOG_CONTENT_KEYS");
    expect(src).toContain("getContentValues");
    expect(src).toContain("isPreviewActive");
    expect(src).toContain("editable={preview}");
  });

  it("BlogContent renders editable eyebrow/heading/intro with data-gw markers", () => {
    const src = read("src/components/blog/BlogContent.tsx");
    expect(src).toContain("resolveBlogCopy");
    expect(src).toContain('"data-gw-block": "blog.hero.eyebrow"');
    expect(src).toContain('"data-gw-block": "blog.hero.intro"');
    expect(src).toContain("readMoreLabel={readMore}");
  });

  it("BlogCard uses the editable button label with a Read article default", () => {
    const src = read("src/components/blog/BlogCard.tsx");
    expect(src).toContain('readMoreLabel?.trim() || "Read article"');
    expect(src.match(/\{buttonLabel\}/g)?.length ?? 0).toBe(3);
  });

  it("the detail page uses the editable back label", () => {
    const src = read("src/app/blog/[slug]/page.tsx");
    expect(src).toContain('resolveBlogCopy("blog.detail.backLabel"');
    expect(src).toContain("{backLabel}");
  });
});

describe("SLICE 115 — Canva button + cross-links + connections", () => {
  it("the CanvaButton resolves from NEXT_PUBLIC_CANVA_URL, opens a new tab", () => {
    const src = read("src/components/admin/marketing/CanvaButton.tsx");
    expect(src).toContain("resolveCanvaUrl(process.env.NEXT_PUBLIC_CANVA_URL)");
    expect(src).toContain("external");
    expect(src).toContain("Open Canva");
  });

  it("the Canva button appears in BOTH admin pages", () => {
    expect(read("src/app/admin/blog/page.tsx")).toContain("<CanvaButton />");
    expect(read("src/app/admin/newsletter/page.tsx")).toContain("<CanvaButton />");
  });

  it("blog admin cross-links to Site Content (blog), newsletter, and live blog", () => {
    const src = read("src/app/admin/blog/page.tsx");
    expect(src).toContain("/admin/content?block=blog.hero.heading.part1");
    expect(src).toContain('href="/admin/newsletter"');
    expect(src).toContain('href="/blog"');
  });

  it("blog publish revalidates the public blog + detail routes", () => {
    const src = read("src/app/admin/blog/actions.ts");
    expect(src).toContain('revalidatePath("/blog")');
    expect(src).toContain("revalidatePath(`/blog/${slug}`)");
  });

  it("individual published posts are included in the sitemap", () => {
    const src = read("src/app/sitemap.ts");
    expect(src).toContain("getPublishedSlugs");
    expect(src).toContain("/blog/${slug}");
  });
});
