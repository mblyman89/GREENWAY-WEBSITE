/**
 * D239 N-9 (SOP-22 G-119; F-22-12; Q-22-2 (a) curated): the Curated reviews
 * list (quote, first name, Google link, permission tick) usable in posts and
 * the newsletter canvas. No live Google block, nothing copied without permission.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  __runCuratedReviewsCoreTests,
  normalizeReviews,
  usableChoices,
  reviewToBlogParagraph,
  spotlightNotesProblem,
  reviewToNotes,
} from "@/lib/cms/curated-reviews-core";
import { parseBlogBlock } from "@/lib/blog/blog-blocks-core";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("D239 N-9 curated reviews", () => {
  it("pure self-tests pass", () => {
    const r = __runCuratedReviewsCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(41);
  });

  it("only ticked reviews with a first name and no health wording are usable", () => {
    const list = normalizeReviews([
      { id: "rv-a", quote: "Great staff", firstName: "Sam", permission: true },
      { id: "rv-b", quote: "Nice shop", firstName: "Al", permission: false },
      { id: "rv-c", quote: "It relieves my pain", firstName: "Bo", permission: true },
    ]);
    expect(usableChoices(list).map((c) => c.id)).toEqual(["rv-a"]);
  });

  it("a picked review becomes an N-7 quote block on the blog", () => {
    const b = parseBlogBlock(reviewToBlogParagraph({ id: "rv-a", quote: "Great staff", firstName: "Sam", googleUrl: "https://g.page/r/x" }));
    expect(b).toEqual({ type: "quote", text: "Great staff", name: "Sam", href: "https://g.page/r/x" });
  });

  it("the review spotlight is refused unless the notes carry a curated review (server side)", () => {
    const c = { id: "rv-a", quote: "Great staff", firstName: "Sam", googleUrl: "" };
    expect(spotlightNotesProblem(reviewToNotes(c), [c])).toBeNull();
    expect(spotlightNotesProblem("pasted from somewhere", [c])).not.toBeNull();
    const actions = read("src/app/admin/blog/actions.ts");
    expect(actions.match(/spotlightNotesProblem\(/g)?.length).toBe(2);
  });

  it("the list page is gated and audited, stored in site_settings (no migration)", () => {
    const page = read("src/app/admin/blog/reviews/page.tsx");
    expect(page).toContain('requirePermission("blog.manage")');
    const actions = read("src/app/admin/blog/reviews/actions.ts");
    expect(actions.match(/requirePermission\("blog\.manage"\)/g)?.length).toBe(2);
    expect(actions).toContain('"blog.review.remove"');
    expect(actions).toContain('"blog.review.add"');
    const srv = read("src/lib/cms/curated-reviews-server.ts");
    expect(srv).toContain('from("site_settings")');
    expect(srv).toContain("usableChoices(");
  });

  it("the canvas, the post editor and the spotlight picker get only usable reviews", () => {
    expect(read("src/app/admin/newsletter/canvas/[id]/page.tsx")).toContain("usableCuratedReviews()");
    expect(read("src/app/admin/blog/[id]/page.tsx")).toContain("usableCuratedReviews()");
    expect(read("src/app/admin/blog/new/page.tsx")).toContain("usableCuratedReviews()");
    expect(read("src/components/admin/newsletter/NewsletterCanvasEditor.tsx")).toContain('data-testid="canvas-review-pick"');
    expect(read("src/components/admin/blog/BlogEditorClient.tsx")).toContain('data-testid="blog-review-pick"');
    expect(read("src/components/admin/blog/NewPostFromPicker.tsx")).toContain('data-testid="spotlight-review-pick"');
    expect(read("src/app/admin/blog/page.tsx")).toContain('href="/admin/blog/reviews"');
  });
});
