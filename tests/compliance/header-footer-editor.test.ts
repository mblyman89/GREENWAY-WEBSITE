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
