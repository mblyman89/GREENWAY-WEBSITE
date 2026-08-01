/**
 * MIG-4 Branding editor tests.
 *
 * MS-4.1 (ADD): the new /admin/settings/branding editor surfaces the two
 * site-wide font blocks (site.font.heading / site.font.body), is registered in
 * the admin navigation under the Website group, and reuses the shared Site
 * Content save/publish machinery.
 *
 * MS-4.2 (SUBTRACT): the fonts are removed from the Site Content junk drawer
 * (the whole "business" group is now excluded wholesale) and the reachability
 * guard's honest owner for them flips to SETTINGS_BRANDING, while
 * business.hours.display keeps its Header & Footer key-override. The public site
 * stays byte-identical until an owner picks a new font and publishes.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { CONTENT_BLOCK_SEEDS } from "@/lib/cms/content-blocks-seed";
import { adminNav } from "@/components/admin/admin-nav-data";
import {
  CONTENT_EDITORS,
  ownerForBlock,
  SITE_CONTENT_EXCLUDED_PAGES,
} from "@/lib/cms/content-reachability-core";

const BRANDING_PAGE = "src/app/admin/settings/branding/page.tsx";
const SITE_CONTENT_PAGE = "src/app/admin/content/page.tsx";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("MIG-4 MS-4.1 — the two site fonts exist as content blocks", () => {
  it("site.font.heading & site.font.body are seeded on page 'business' as font fields", () => {
    const heading = CONTENT_BLOCK_SEEDS.find(
      (b) => b.block_key === "site.font.heading",
    );
    const body = CONTENT_BLOCK_SEEDS.find(
      (b) => b.block_key === "site.font.body",
    );
    expect(heading).toBeDefined();
    expect(body).toBeDefined();
    expect(heading!.page).toBe("business");
    expect(body!.page).toBe("business");
    expect(heading!.field_type).toBe("font");
    expect(body!.field_type).toBe("font");
    // Byte-identical safe default so the live site is unchanged until an edit.
    expect(heading!.defaultValue).toBe("system");
    expect(body!.defaultValue).toBe("system");
  });
});

describe("MIG-4 MS-4.1 — Branding editor page surfaces exactly the two fonts", () => {
  const src = read(BRANDING_PAGE);

  it("scopes to the two font keys via an explicit allowlist", () => {
    expect(src).toContain("BRANDING_FONT_KEYS");
    expect(src).toContain('"site.font.heading"');
    expect(src).toContain('"site.font.body"');
    // Filters the full block set down to just those keys.
    expect(src).toContain("BRANDING_FONT_KEYS.has(b.block_key)");
  });

  it("reuses the shared Site Content save/publish/restore actions (same DB rows)", () => {
    expect(src).toContain('from "@/app/admin/content/actions"');
    expect(src).toContain("saveContentDraftAction");
    expect(src).toContain("publishContentBlockAction");
    expect(src).toContain("restoreContentRevisionAction");
    // Uses the same reusable editor shell as Site Content & Header & Footer.
    expect(src).toContain("ContentEditorShell");
  });

  it("guards the content.edit permission and previews on the homepage", () => {
    expect(src).toContain('requirePermission("content.edit")');
    expect(src).toContain("publicPathForBrandingBlock");
  });

  it("does NOT hard-code any font choice (keeps whatever is stored)", () => {
    // The editor must not inject a specific font id; it only surfaces the blocks.
    expect(src).not.toContain('draft_value: "poppins"');
    expect(src).not.toContain("setFont(");
  });
});

describe("MIG-4 MS-4.1 — Branding is registered in the admin nav (Website group)", () => {
  it("has a Branding nav item pointing at /admin/settings/branding with content.edit", () => {
    const item = adminNav.find(
      (n) => n.href === "/admin/settings/branding",
    );
    expect(item).toBeDefined();
    expect(item!.label).toBe("Branding");
    expect(item!.group).toBe("Website");
    expect(item!.permission).toBe("content.edit");
  });
});

describe("MIG-4 MS-4.2 — SUBTRACT: fonts removed from Site Content, now owned by Branding", () => {
  const siteSrc = read(SITE_CONTENT_PAGE);

  it("Site Content now excludes the whole 'business' group (wholesale)", () => {
    // We read only the PAGE_BUILDER_PAGES array body (between its `[` and `]`)
    // so an explanatory comment mentioning the word "business" in prose does not
    // create a false match.
    const setStart = siteSrc.indexOf("const PAGE_BUILDER_PAGES");
    const arrOpen = siteSrc.indexOf("[", setStart);
    const arrClose = siteSrc.indexOf("]", arrOpen);
    const setLiteral = siteSrc.slice(arrOpen, arrClose + 1);
    expect(setLiteral).toContain('"business"');
  });

  it("the per-key hours hide is no longer needed (EXCLUDED_KEYS is empty)", () => {
    // The whole business group is excluded now, so the earlier per-KEY hide of
    // business.hours.display is redundant; EXCLUDED_KEYS is emptied.
    expect(siteSrc).toContain("const EXCLUDED_KEYS = new Set<string>([])");
  });

  it("the reachability guard now owns BOTH fonts as SETTINGS_BRANDING", () => {
    expect(ownerForBlock("site.font.heading", "business")).toBe(
      CONTENT_EDITORS.SETTINGS_BRANDING,
    );
    expect(ownerForBlock("site.font.body", "business")).toBe(
      CONTENT_EDITORS.SETTINGS_BRANDING,
    );
  });

  it("business.hours.display STILL resolves to Header & Footer (override wins)", () => {
    // The KEY_OWNER_OVERRIDE takes precedence over the new group default, so the
    // hours block continues to live in Header & Footer, not Branding.
    expect(ownerForBlock("business.hours.display", "business")).toBe(
      CONTENT_EDITORS.HEADER_FOOTER,
    );
  });

  it("'business' is now in SITE_CONTENT_EXCLUDED_PAGES and does NOT default to SITE_CONTENT", () => {
    expect(SITE_CONTENT_EXCLUDED_PAGES.has("business")).toBe(true);
    // Self-test #7 invariant: an excluded page must not default to SITE_CONTENT.
    expect(ownerForBlock("site.font.heading", "business")).not.toBe(
      CONTENT_EDITORS.SITE_CONTENT,
    );
  });

  it("the Branding editor still surfaces exactly the two fonts (unchanged by SUBTRACT)", () => {
    const b = read("src/app/admin/settings/branding/page.tsx");
    expect(b).toContain('"site.font.heading"');
    expect(b).toContain('"site.font.body"');
    expect(b).toContain("BRANDING_FONT_KEYS.has(b.block_key)");
  });
});
