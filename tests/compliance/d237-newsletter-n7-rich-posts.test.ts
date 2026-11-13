/**
 * D239 N-7 (SOP-22 G-117; F-22-15, F-22-18, F-22-20; Q-22-7): rich blog posts.
 * Block body kept backward-compatible with the text[] paragraphs, a Digital
 * Assets picker for hero and inline images, same-page Store / Culture filters
 * on /blog (no new tab or page), and Article JSON-LD.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { __runBlogBlocksCoreTests, parseBlogBody, filterPostsByView, blogArticleSchema, jsonLdText } from "@/lib/blog/blog-blocks-core";
import { blogPosts } from "@/lib/blog/posts";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("D239 N-7 rich posts", () => {
  it("pure self-tests pass", () => {
    const r = __runBlogBlocksCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(70);
  });

  it("every built-in starter post still renders as plain paragraphs (backward compatible)", () => {
    for (const p of blogPosts) {
      const blocks = parseBlogBody(p.content);
      expect(blocks.length).toBe(p.content.filter((c) => c.trim()).length);
      expect(blocks.every((b) => b.type === "paragraph")).toBe(true);
    }
  });

  it("the public post page renders blocks and Article JSON-LD", () => {
    const page = read("src/app/(site)/blog/[slug]/page.tsx");
    expect(page).toContain("<BlogBody paragraphs={post.content} />");
    expect(page).toContain('type="application/ld+json"');
    expect(page).toContain("blogArticleSchema(");
    expect(page).not.toContain("post.content.map((paragraph)");
    const ld = jsonLdText(blogArticleSchema({ slug: "a", title: "</script>", excerpt: "", publishDate: "2026-01-01", author: "Greenway Team", imageSrc: "/a.png" }, "https://www.greenwaymarijuana.com", "Greenway Marijuana", "/l.png"));
    expect(ld).not.toContain("</script>");
  });

  it("/blog filters on the same page (Q-22-7: no new tab or page)", () => {
    const content = read("src/components/blog/BlogContent.tsx");
    expect(content).toContain("<BlogFilterGrid");
    const grid = read("src/components/blog/BlogFilterGrid.tsx");
    expect(grid).toContain("replaceState");
    expect(grid).not.toMatch(/href=["'{]`?\/blog\//);
    expect(filterPostsByView(blogPosts, "culture").every((p) => p.category === "CULTURE")).toBe(true);
    expect(filterPostsByView(blogPosts, "store").every((p) => p.category === "PRODUCTS" || p.category === "DEALS")).toBe(true);
  });

  it("the editor has the block toolbar and the Digital Assets picker; the save takes the picked hero", () => {
    const ed = read("src/components/admin/blog/BlogEditorClient.tsx");
    expect(ed).toContain('data-testid="blog-block-toolbar"');
    expect(ed).toContain('data-testid="blog-media-picker"');
    expect(ed).toContain('name="hero_media_pick"');
    const page = read("src/app/admin/blog/[id]/page.tsx");
    expect(page).toContain('listMedia({ status: "published", limit: 200 })');
    expect(page).toContain("media={media}");
    const actions = read("src/app/admin/blog/actions.ts");
    expect(actions).toContain('pickedHeroId(formData.get("hero_media_pick"), false)');
    expect(actions).toMatch(/getMedia\(picked\)/);
  });

  it("the culture guard does not count a picture address as a source", () => {
    const srv = read("src/lib/cms/culture-desk-server.ts");
    expect(srv).toContain("blogGuardParagraphs(post.body ?? [])");
  });
});
