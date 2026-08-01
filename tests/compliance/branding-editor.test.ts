/**
 * MIG-4 MS-4.1 — Branding editor (ADD / additive-first).
 *
 * Verifies the new /admin/settings/branding editor surfaces the two site-wide
 * font blocks (site.font.heading / site.font.body), is registered in the admin
 * navigation under the Website group, and reuses the shared Site Content
 * save/publish machinery — WITHOUT yet removing the fonts from Site Content
 * (that duplicate removal is the MS-4.2 SUBTRACT). At this commit the fonts are
 * editable in BOTH places (same DB rows, same actions), so no block is ever
 * un-editable and the public site is byte-identical until an edit is published.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { CONTENT_BLOCK_SEEDS } from "@/lib/cms/content-blocks-seed";
import { adminNav } from "@/components/admin/admin-nav-data";
import {
  CONTENT_EDITORS,
  ownerForBlock,
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

describe("MIG-4 MS-4.1 — additive-first: fonts STILL in Site Content this slice", () => {
  const siteSrc = read(SITE_CONTENT_PAGE);

  it("Site Content has NOT yet excluded the font keys (removed in MS-4.2)", () => {
    // The SUBTRACT slice adds these to EXCLUDED_KEYS / excludes the business
    // group. Until then they remain reachable in Site Content too.
    expect(siteSrc).not.toContain('"site.font.heading"');
    expect(siteSrc).not.toContain('"site.font.body"');
    // 'business' is NOT in the page-builder exclusion Set *literal* yet. We read
    // only the array body (between the `new Set([` and its closing `])`) so the
    // MS-3.3 explanatory comment that mentions the word "business" in prose does
    // not create a false match.
    const setStart = siteSrc.indexOf("const PAGE_BUILDER_PAGES");
    const arrOpen = siteSrc.indexOf("[", setStart);
    const arrClose = siteSrc.indexOf("]", arrOpen);
    const setLiteral = siteSrc.slice(arrOpen, arrClose + 1);
    expect(setLiteral).not.toContain('"business"');
  });

  it("the reachability guard still owns the fonts as SITE_CONTENT this slice", () => {
    // Additive-first: the honest owner flips to SETTINGS_BRANDING only in MS-4.2.
    expect(ownerForBlock("site.font.heading", "business")).toBe(
      CONTENT_EDITORS.SITE_CONTENT,
    );
    expect(ownerForBlock("site.font.body", "business")).toBe(
      CONTENT_EDITORS.SITE_CONTENT,
    );
  });

  it("the SETTINGS_BRANDING editor enum exists and is a real (non-NONE) owner", () => {
    expect(CONTENT_EDITORS.SETTINGS_BRANDING).toBe("SETTINGS_BRANDING");
    expect(CONTENT_EDITORS.SETTINGS_BRANDING).not.toBe(CONTENT_EDITORS.NONE);
  });
});
