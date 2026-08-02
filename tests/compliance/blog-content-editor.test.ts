/**
 * MIG-6 Slice 1 — Blog page-wording editor (ADD).
 *
 * Michael: build a dedicated editor for the blog page's wording (the hero
 * heading/intro and the button labels) so those settings have a real home,
 * without editing the blog card design or the "glow" feature, and without
 * disrupting the audit roadmap. Slice 1 was the ADD half (the 7 blog chrome
 * blocks surfaced in /admin/blog/content while they still lived in Site Content).
 * Slice 2 is the SUBTRACT half: blog now defaults to the BLOG editor and is
 * excluded from Site Content, so the junk drawer is finally empty and nothing
 * is stranded (the dedicated editor owns all 7).
 *
 * These tests pin the safe-by-default wiring:
 *   - the 7 curated blog chrome blocks exist, page "blog", field "plain",
 *   - the pure-core scope guard accepts exactly those 7 keys and nothing else,
 *   - the 3 sections (hero / card / detail) cover all 7 keys once,
 *   - the new editor page + scoped actions + client component are in place,
 *   - the nav item + the repointed /admin/blog deep-link are wired,
 *   - reachability is FLIPPED: blog now defaults to BLOG, IS in
 *     SITE_CONTENT_EXCLUDED_PAGES and PAGE_BUILDER_PAGES (SUBTRACT slice), and
 *     the 17-orphan snapshot is untouched.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { CONTENT_BLOCK_SEEDS } from "@/lib/cms/content-blocks-seed";
import {
  BLOG_CONTENT_BLOCKS,
  BLOG_CONTENT_KEYS,
  BLOG_CONTENT_SECTIONS,
  isBlogContentBlock,
  blogContentBlock,
} from "@/lib/blog/blog-content-core";
import {
  CONTENT_EDITORS,
  ownerForBlock,
  PAGE_GROUP_DEFAULT_OWNER,
  SITE_CONTENT_EXCLUDED_PAGES,
} from "@/lib/cms/content-reachability-core";

const BLOG_BLOCKS = [
  "blog.hero.eyebrow",
  "blog.hero.heading.part1",
  "blog.hero.heading.part2",
  "blog.hero.heading.part3",
  "blog.hero.intro",
  "blog.card.readMore",
  "blog.detail.backLabel",
] as const;

describe("MIG-6 Slice 1 — blog chrome content-block seeds", () => {
  const byKey = new Map(CONTENT_BLOCK_SEEDS.map((s) => [s.block_key, s]));

  it("seeds all 7 blog chrome blocks on page 'blog' as plain fields", () => {
    for (const key of BLOG_BLOCKS) {
      const seed = byKey.get(key);
      expect(seed, key).toBeTruthy();
      expect(seed?.page).toBe("blog");
      expect(seed?.field_type).toBe("plain");
    }
  });

  it("the curated block list is exactly these 7 keys", () => {
    expect([...BLOG_CONTENT_KEYS].sort()).toEqual([...BLOG_BLOCKS].sort());
    expect(BLOG_CONTENT_BLOCKS.length).toBe(7);
  });

  it("keeps the live copy byte-identical (seed defaults == curated fallbacks)", () => {
    for (const b of BLOG_CONTENT_BLOCKS) {
      expect(byKey.get(b.key)?.defaultValue).toBe(b.fallback);
    }
  });
});

describe("MIG-6 Slice 1 — pure-core scope guard + sections", () => {
  it("isBlogContentBlock accepts exactly the 7 curated keys", () => {
    for (const key of BLOG_BLOCKS) expect(isBlogContentBlock(key)).toBe(true);
  });

  it("isBlogContentBlock rejects foreign / unknown / empty keys", () => {
    for (const key of [
      "medical.hero.eyebrow",
      "footer.social.facebook.url",
      "blog.unknown.key",
      "",
    ]) {
      expect(isBlogContentBlock(key)).toBe(false);
    }
  });

  it("the 3 sections (hero/card/detail) cover all 7 keys exactly once", () => {
    const ids = BLOG_CONTENT_SECTIONS.map((s) => s.id);
    expect(ids).toEqual(["hero", "card", "detail"]);
    const keys = BLOG_CONTENT_SECTIONS.flatMap((s) => s.keys);
    expect(keys.length).toBe(7);
    expect(new Set(keys).size).toBe(7);
    expect([...keys].sort()).toEqual([...BLOG_BLOCKS].sort());
  });

  it("blogContentBlock resolves known keys and returns undefined otherwise", () => {
    expect(blogContentBlock("blog.hero.eyebrow")?.fallback).toBe("The Blog");
    expect(blogContentBlock("blog.card.readMore")?.fallback).toBe("Read article");
    expect(blogContentBlock("nope")).toBeUndefined();
  });
});

describe("MIG-6 Slice 1 — editor page, actions, component wiring", () => {
  const page = readFileSync("src/app/admin/blog/content/page.tsx", "utf8");
  const actions = readFileSync("src/app/admin/blog/content/actions.ts", "utf8");
  const component = readFileSync("src/components/admin/BlogContentEditor.tsx", "utf8");

  it("the editor page renders the BlogContentEditor from the curated sections", () => {
    expect(page).toContain("BLOG_CONTENT_SECTIONS");
    expect(page).toContain("<BlogContentEditor");
    expect(page).toContain('requirePermission("content.edit")');
  });

  it("the server actions are scoped to blog blocks and reuse the content store", () => {
    expect(actions).toContain('"use server"');
    expect(actions).toContain("isBlogContentBlock");
    expect(actions).toContain("saveContentDraft");
    expect(actions).toContain("publishContentBlock");
    expect(actions).toContain("restoreContentRevisionToDraft");
    // publishing refreshes the public blog routes
    expect(actions).toContain('revalidatePath("/blog")');
  });

  it("the client editor is lean — no hide switch and no card-design controls", () => {
    expect(component).toContain('"use client"');
    expect(component).toContain("Save draft");
    expect(component).toContain("Publish");
    // deliberately simple: none of the medical hide-switch machinery
    expect(component).not.toContain("HideSwitch");
    expect(component).not.toContain("isMedicalPageHidden");
  });
});

describe("MIG-6 Slice 1 — discoverability wiring", () => {
  const nav = readFileSync("src/components/admin/admin-nav-data.ts", "utf8");
  const blogPage = readFileSync("src/app/admin/blog/page.tsx", "utf8");

  it("adds a Blog wording nav entry pointing at the new editor", () => {
    expect(nav).toContain('"/admin/blog/content"');
    expect(nav).toContain("Blog wording");
  });

  it("MIG-6 Slice 2: the Blog wording entry lives in the Website group", () => {
    // Michael: all page editors belong under Website. The entry moved out of
    // "MKTG & ADV" so the whole nav line must now carry group: "Website".
    const line = nav
      .split("\n")
      .find((l) => l.includes('label: "Blog wording"'));
    expect(line).toBeDefined();
    expect(line).toContain('group: "Website"');
    expect(line).not.toContain('group: "MKTG & ADV"');
  });

  it("repoints the /admin/blog deep-link from Site Content to the new editor", () => {
    expect(blogPage).toContain('href="/admin/blog/content"');
    expect(blogPage).not.toContain("/admin/content?block=blog.hero.heading.part1");
  });
});

describe("MIG-6 Slice 2 — reachability FLIPPED to BLOG (SUBTRACT)", () => {
  const guard = readFileSync("src/lib/cms/content-reachability-core.ts", "utf8");
  const content = readFileSync("src/app/admin/content/page.tsx", "utf8");

  it("blog now defaults to BLOG (flipped from SITE_CONTENT in Slice 2)", () => {
    expect(PAGE_GROUP_DEFAULT_OWNER.blog).toBe(CONTENT_EDITORS.BLOG);
  });

  it("all 7 blog blocks are now owned by the BLOG editor (none stranded)", () => {
    for (const key of BLOG_BLOCKS) {
      expect(ownerForBlock(key, "blog")).toBe(CONTENT_EDITORS.BLOG);
    }
  });

  it("blog IS now excluded from Site Content (moved to its dedicated editor)", () => {
    expect(SITE_CONTENT_EXCLUDED_PAGES.has("blog")).toBe(true);
    const pb = content.slice(
      content.indexOf("const PAGE_BUILDER_PAGES"),
      content.indexOf("]", content.indexOf("const PAGE_BUILDER_PAGES")) + 1,
    );
    expect(pb.includes('"blog"')).toBe(true);
  });

  it("the BLOG editor enum exists and the orphan snapshot reflects MIG-5a (7 remain)", () => {
    expect(CONTENT_EDITORS.BLOG).toBe("BLOG");
    // MIG-5a rescued 10 orphans (faq.hero.* -> PAGES_FAQ,
    // home.category.*/home.brand.* -> PAGES_HOME), so the guard's countdown
    // snapshot moved from 17 to 7. The BLOG editor itself is unchanged.
    expect(guard).toContain("KNOWN_ORPHANS_V1.size === 7");
  });
});
