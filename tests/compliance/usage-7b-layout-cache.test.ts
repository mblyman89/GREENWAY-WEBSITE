/**
 * USAGE-7b · the shared site layout never reads a `live-menu`-tagged cache.
 *
 * Owner request (2026-11-24, verbatim in docs/USAGE-BLEED-ROADMAP.md §USAGE-7):
 * "please begin fixing all issues, one slice at a time."
 *
 * Pins:
 *   1. the pure core's invariants (`__runLayoutCacheTests`);
 *   2. the menu-card fallback snapshot (read by the layout) carries its OWN tag
 *      and backstop TTL, never MENU_CACHE_TAG;
 *   3. the fallback admin actions clear that tag on every save;
 *   4. `revalidatePublicMenuSurfaces()` does NOT clear it (that would re-couple
 *      every menu edit to every public page — the bug this slice removes);
 *   5. the layout's direct server imports do not pull a `live-menu` read in.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  __runLayoutCacheTests,
  MENU_CARD_FALLBACK_TAG,
  MENU_CARD_FALLBACK_TTL_SECONDS,
  layoutTagsAreIsolated,
} from "@/lib/site/layout-cache-core";
import { MENU_CACHE_TAG } from "@/lib/menu/menu-cache-policy-core";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("USAGE-7b core", () => {
  it("self-test passes", () => {
    const r = __runLayoutCacheTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(14);
  });
  it("forbidden tag is the real menu tag", () => {
    expect(layoutTagsAreIsolated([MENU_CACHE_TAG])).toBe(false);
    expect(MENU_CARD_FALLBACK_TAG).not.toBe(MENU_CACHE_TAG);
    expect(MENU_CARD_FALLBACK_TTL_SECONDS).toBeGreaterThan(60);
  });
});

describe("USAGE-7b wiring", () => {
  const server = read("src/lib/menu/menu-card-fallback-server.ts");
  it("fallback snapshot uses its own tag + TTL, never live-menu", () => {
    expect(server).toContain("tags: [MENU_CARD_FALLBACK_TAG]");
    expect(server).toContain("revalidate: MENU_CARD_FALLBACK_TTL_SECONDS");
    expect(server).not.toMatch(/import\s*\{[^}]*MENU_CACHE_TAG[^}]*\}/);
    expect(server).not.toContain("tags: [MENU_CACHE_TAG]");
  });
  it("fallback admin saves clear the fallback tag before the menu surfaces", () => {
    const a = read("src/app/admin/menu-card-fallbacks/actions.ts");
    const tagAt = a.indexOf("revalidateTag(MENU_CARD_FALLBACK_TAG");
    const surfAt = a.indexOf("revalidatePublicMenuSurfaces();");
    expect(tagAt).toBeGreaterThan(0);
    expect(surfAt).toBeGreaterThan(tagAt);
  });
  it("menu edits do not clear the fallback tag (would re-couple every page)", () => {
    const ps = read("src/lib/site/public-surfaces.ts");
    expect(ps).not.toContain("MENU_CARD_FALLBACK_TAG");
    expect(ps).not.toContain(`"${MENU_CARD_FALLBACK_TAG}"`);
  });
  it("the layout reads the rotation lists from the isolated snapshot", () => {
    const layout = read("src/app/(site)/layout.tsx");
    expect(layout).toContain('from "@/lib/menu/menu-card-fallback-server"');
    expect(layout).not.toContain("MENU_CACHE_TAG");
    expect(layout).not.toContain("loadLiveMenu");
  });
});
