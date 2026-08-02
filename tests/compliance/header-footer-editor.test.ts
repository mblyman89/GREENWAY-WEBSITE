/**
 * SLICE 104 — Header & Footer editor + editable footer links.
 *
 * Michael: add a Header & Footer editor page under the Website menu that lets
 * me edit the "Follow Greenway" links and the App download links. They don't
 * work yet, so show a friendly message when a link with no destination is
 * clicked — and don't break anything.
 *
 * These tests pin the safe-by-default wiring:
 *   - the 8 new editable footer blocks exist and are well-formed,
 *   - social links seed with the LIVE business.ts URLs (so nothing changes),
 *   - the two app-store links seed BLANK on purpose (so they show the message),
 *   - the footer resolves the blocks at render (draft-aware) with fallbacks,
 *   - the "not connected" click-interception component is wired in,
 *   - the editor page + nav item + taller/extended preview are in place.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { CONTENT_BLOCK_SEEDS } from "@/lib/cms/content-blocks-seed";
import {
  CONTENT_EDITORS,
  ownerForBlock,
  SITE_CONTENT_EXCLUDED_PAGES,
} from "@/lib/cms/content-reachability-core";

const FOOTER_URL_BLOCKS = [
  "footer.social.facebook.url",
  "footer.social.instagram.url",
  "footer.social.google.url",
  "footer.social.yelp.url",
  "footer.social.leafly.url",
  "footer.app.apple.url",
  "footer.app.google.url",
] as const;

describe("SLICE 104 — footer content-block seeds", () => {
  const byKey = new Map(CONTENT_BLOCK_SEEDS.map((s) => [s.block_key, s]));

  it("adds all 8 header-footer editable blocks", () => {
    for (const key of FOOTER_URL_BLOCKS) {
      expect(byKey.get(key)?.page).toBe("header-footer");
    }
    expect(byKey.get("footer.link.unavailable.message")?.page).toBe("header-footer");
  });

  it("social/app link blocks are url fields; the message is plain text", () => {
    for (const key of FOOTER_URL_BLOCKS) {
      expect(byKey.get(key)?.field_type).toBe("url");
    }
    expect(byKey.get("footer.link.unavailable.message")?.field_type).toBe("plain");
  });

  it("social links seed with a real https URL so the footer looks unchanged", () => {
    for (const key of [
      "footer.social.facebook.url",
      "footer.social.instagram.url",
      "footer.social.google.url",
      "footer.social.yelp.url",
      "footer.social.leafly.url",
    ]) {
      const v = byKey.get(key)?.defaultValue ?? "";
      expect(v.startsWith("https://")).toBe(true);
    }
  });

  it("app-store links seed BLANK on purpose (show the friendly message)", () => {
    expect(byKey.get("footer.app.apple.url")?.defaultValue).toBe("");
    expect(byKey.get("footer.app.google.url")?.defaultValue).toBe("");
  });

  it("the not-connected message has a friendly, non-empty default", () => {
    const msg = byKey.get("footer.link.unavailable.message")?.defaultValue ?? "";
    expect(msg.length).toBeGreaterThan(20);
    expect(msg.toLowerCase()).toContain("check back");
  });

  it("keeps every seed block_key unique (no collisions with the new ones)", () => {
    const keys = CONTENT_BLOCK_SEEDS.map((s) => s.block_key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("SLICE 104 — footer render wiring", () => {
  const footer = readFileSync("src/components/site/Footer.tsx", "utf8");
  const unavail = readFileSync("src/components/site/FooterLinkUnavailable.tsx", "utf8");

  it("Footer resolves the editable link blocks at render (draft-aware)", () => {
    expect(footer).toContain("getContentValues");
    expect(footer).toContain("FOOTER_LINK_BLOCKS");
    expect(footer).toContain("export async function Footer()");
  });

  it("Footer uses the click-interception component for app + social links", () => {
    expect(footer).toContain("FooterLinkUnavailable");
    // Social links fall back to the live business.ts URL if the block is empty.
    expect(footer).toContain("social.fallback");
  });

  it("the interception component shows the message only when the URL is blank", () => {
    expect(unavail).toContain('"use client"');
    expect(unavail).toContain("hasDestination");
    // A real URL renders a normal anchor; blank renders a button + dialog.
    expect(unavail).toContain("<a");
    expect(unavail).toContain('role="dialog"');
    // Accessible: closes on Escape and returns focus to the trigger.
    expect(unavail).toContain('e.key === "Escape"');
  });
});

describe("SLICE 104 — editor page, nav item & preview", () => {
  const editor = readFileSync("src/app/admin/header-footer/page.tsx", "utf8");
  const nav = readFileSync("src/components/admin/admin-nav-data.ts", "utf8");
  const preview = readFileSync("src/components/admin/ContentPreviewPanel.tsx", "utf8");

  it("the editor page reuses the safe content-editor machinery, scoped to header-footer", () => {
    expect(editor).toContain("requirePermission(\"content.edit\")");
    expect(editor).toContain("ContentEditorShell");
    expect(editor).toContain('b.page === "header-footer"');
  });

  it("adds the Header & Footer item to the Website nav", () => {
    expect(nav).toContain('href: "/admin/header-footer"');
    expect(nav).toContain('label: "Header & Footer"');
  });

  it("the live preview is taller and lists every public page", () => {
    expect(preview).toContain("height={820}");
    for (const label of [
      "Homepage",
      "About",
      "Location",
      "Price Match",
      "Medical",
      "Blog",
      "Privacy Policy",
      "Terms of Use",
      "Consumer Health Data",
    ]) {
      expect(preview).toContain(label);
    }
  });
});

describe("MIG-3 MS-3.1 — footer compliance/hours surfaced in Header & Footer (ADD)", () => {
  const editor = readFileSync("src/app/admin/header-footer/page.tsx", "utf8");
  const byKey = new Map(CONTENT_BLOCK_SEEDS.map((s) => [s.block_key, s]));

  const EXTRA = [
    "footer.compliance.warning",
    "footer.hours.image",
    "business.hours.display",
  ] as const;

  it("declares the explicit extra-keys allowlist (not a broad prefix)", () => {
    expect(editor).toContain("HEADER_FOOTER_EXTRA_KEYS");
    for (const key of EXTRA) {
      expect(editor).toContain(key);
    }
  });

  it("broadens the editor scope to header-footer OR the three extra keys", () => {
    // Still scoped to the header-footer group...
    expect(editor).toContain('b.page === "header-footer"');
    // ...PLUS the allowlisted footer-rendered blocks (additive-first).
    expect(editor).toContain("HEADER_FOOTER_EXTRA_KEYS.has(b.block_key)");
  });

  it("the three extra blocks really do render in the site footer", () => {
    // page grouping is historical; they render in the footer, hence the rehome.
    expect(byKey.get("footer.compliance.warning")?.page).toBe("footer");
    expect(byKey.get("footer.hours.image")?.page).toBe("footer");
    expect(byKey.get("business.hours.display")?.page).toBe("business");
  });

  it("does NOT drag the font blocks in (those go to Branding in MIG-4)", () => {
    // site.font.* are page 'business' too, but must stay OUT of this editor.
    expect(editor).not.toContain("site.font.heading");
    expect(editor).not.toContain("site.font.body");
  });
});

describe("MIG-3 MS-3.3 — footer + business.hours removed from Site Content (SUBTRACT)", () => {
  // MIG-7 PR-B retired the Site Content page (src/app/admin/content/page.tsx),
  // so the "excluded from Site Content" facts are now asserted purely against
  // the reachability core (the true source of truth for owner resolution).
  const guard = readFileSync("src/lib/cms/content-reachability-core.ts", "utf8");

  it("the 'footer' page group is owned by Header & Footer, not Site Content", async () => {
    // footer.compliance.warning + footer.hours.image (page 'footer') now live
    // only in the Header & Footer editor.
    const { PAGE_GROUP_DEFAULT_OWNER, CONTENT_EDITORS } = await import(
      "@/lib/cms/content-reachability-core"
    );
    expect(PAGE_GROUP_DEFAULT_OWNER["footer"]).toBe(
      CONTENT_EDITORS.HEADER_FOOTER,
    );
    expect(PAGE_GROUP_DEFAULT_OWNER["footer"]).not.toBe(
      CONTENT_EDITORS.SITE_CONTENT,
    );
  });

  it("the font blocks are owned by Branding, not Site Content (MS-4.2)", async () => {
    // MIG-4 MS-4.2: the 'business' split is RESOLVED — the fonts (site.font.*)
    // moved to the Branding editor and the whole 'business' group is owned there.
    const { ownerForBlock, CONTENT_EDITORS } = await import(
      "@/lib/cms/content-reachability-core"
    );
    expect(ownerForBlock("site.font.heading", "business")).toBe(
      CONTENT_EDITORS.SETTINGS_BRANDING,
    );
    expect(ownerForBlock("site.font.body", "business")).toBe(
      CONTENT_EDITORS.SETTINGS_BRANDING,
    );
    expect(ownerForBlock("site.font.heading", "business")).not.toBe(
      CONTENT_EDITORS.SITE_CONTENT,
    );
  });

  it("the reachability guard now owns footer + hours in Header & Footer", () => {
    // footer group default flipped to HEADER_FOOTER; hours block overridden.
    expect(guard).toContain("footer: CONTENT_EDITORS.HEADER_FOOTER");
    expect(guard).toContain(
      '"business.hours.display": CONTENT_EDITORS.HEADER_FOOTER',
    );
    // MIG-4 MS-4.2: business group default flipped SITE_CONTENT -> SETTINGS_BRANDING
    // (the fonts follow it into the Branding editor; the hours override still wins).
    expect(guard).toContain("business: CONTENT_EDITORS.SETTINGS_BRANDING");
  });

  it("the 'footer' AND 'business' groups are now in SITE_CONTENT_EXCLUDED_PAGES", () => {
    const excl = guard.slice(
      guard.indexOf("SITE_CONTENT_EXCLUDED_PAGES: ReadonlySet<string> = new Set<string>(["),
      guard.indexOf(
        "]);",
        guard.indexOf("SITE_CONTENT_EXCLUDED_PAGES: ReadonlySet<string> = new Set<string>(["),
      ),
    );
    expect(excl).toContain('"footer"');
    // MIG-4 MS-4.2: business is now excluded wholesale (its last blocks — the
    // fonts — moved to Branding), so nothing is stranded.
    expect(excl).toContain('"business"');
  });
});

describe("MIG-5 Slice 4 — header-footer removed from Site Content (SUBTRACT)", () => {
  // MIG-7 PR-B retired the Site Content page; its "excludes header-footer" fact
  // is now proven via the reachability core (SITE_CONTENT_EXCLUDED_PAGES + owner
  // resolution) rather than by reading the deleted page's filter literal.
  const guard = readFileSync("src/lib/cms/content-reachability-core.ts", "utf8");
  const editor = readFileSync("src/app/admin/header-footer/page.tsx", "utf8");

  // Every block that renders in the site header/footer and lives on the
  // 'header-footer' page group (already surfaced in the editor since Slice 104).
  const HF_BLOCKS = [
    "footer.social.facebook.url",
    "footer.social.instagram.url",
    "footer.social.google.url",
    "footer.social.yelp.url",
    "footer.social.leafly.url",
    "footer.app.apple.url",
    "footer.app.google.url",
    "footer.link.unavailable.message",
    "header.hours.size",
    "header.phone.display",
  ] as const;

  it("the 'header-footer' group is excluded from Site Content (SITE_CONTENT_EXCLUDED_PAGES)", () => {
    // The runtime set is the source of truth now that the page is retired.
    expect(SITE_CONTENT_EXCLUDED_PAGES.has("header-footer")).toBe(true);
  });

  it("'header-footer' is now in SITE_CONTENT_EXCLUDED_PAGES", () => {
    const start = guard.indexOf(
      "SITE_CONTENT_EXCLUDED_PAGES: ReadonlySet<string> = new Set<string>([",
    );
    const excl = guard.slice(start, guard.indexOf("]);", start));
    expect(excl).toContain('"header-footer"');
    // and the runtime set agrees
    expect(SITE_CONTENT_EXCLUDED_PAGES.has("header-footer")).toBe(true);
  });

  it("the group default stays HEADER_FOOTER (no flip needed — clean subtract)", () => {
    expect(guard).toContain('"header-footer": CONTENT_EDITORS.HEADER_FOOTER');
  });

  it("all 10 header-footer blocks resolve to the Header & Footer editor (none stranded)", () => {
    for (const key of HF_BLOCKS) {
      const owner = ownerForBlock(key, "header-footer");
      expect(owner).toBe(CONTENT_EDITORS.HEADER_FOOTER);
      expect(owner).not.toBe(CONTENT_EDITORS.SITE_CONTENT);
      expect(owner).not.toBe(CONTENT_EDITORS.NONE);
    }
  });

  it("the ADD is intact: the editor still surfaces the header-footer group", () => {
    // The subtract removes only the Site Content duplicate; the dedicated
    // editor (which has owned these since Slice 104) is untouched.
    expect(editor).toContain('b.page === "header-footer"');
  });
});
