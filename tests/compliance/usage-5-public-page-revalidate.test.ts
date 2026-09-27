/**
 * USAGE-5 · /specials, /loyalty and /medical are no longer `force-dynamic`.
 *
 * Measured on the production deployment (2026-09-27): every hit to those three
 * routes answered `x-vercel-cache: MISS` with `cache-control: private,
 * no-cache, no-store`, which means every visitor AND every crawler paid a full
 * server render — including, on /specials, four promotions reads, the content
 * blocks, the banners and the whole live menu — for a page identical to the one
 * rendered a second earlier. `/` and `/menu` had already been converted to
 * `revalidate = 60` (SLICE D / E) with no loss of freshness, because the TTL is
 * only the floor: every publish path clears the route explicitly.
 *
 * This file pins three things:
 *   1. the three routes export `revalidate = 60` (= MENU_CACHE_TTL_SECONDS) and
 *      nothing in them re-introduces `force-dynamic`;
 *   2. every writer that changes what those pages show still calls
 *      revalidatePath on them, so a publish is visible on the next non-preview
 *      load — the promise the old `force-dynamic` comments made is kept by the
 *      revalidation, not the TTL;
 *   3. the loyalty PROGRAM editors (config + tiers) now clear "/loyalty" too —
 *      before this slice they only cleared "/admin/loyalty", which was fine
 *      under force-dynamic and would have been a 60 s stale window without this.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { MENU_CACHE_TTL_SECONDS } from "@/lib/menu/menu-cache-policy-core";
import { PUBLIC_MENU_PAGE_PATTERNS, PUBLIC_MENU_SURFACES } from "@/lib/site/public-surfaces";

const read = (rel: string) => readFileSync(path.resolve(__dirname, "../..", rel), "utf8");
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Body of one exported async function (from its `export async function` to the next). */
function fnBody(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  expect(start, `${name} exists`).toBeGreaterThanOrEqual(0);
  const next = source.indexOf("\nexport ", start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

const ROUTES = [
  "src/app/specials/page.tsx",
  "src/app/loyalty/page.tsx",
  "src/app/medical/page.tsx",
  "src/app/menu/products/[id]/page.tsx",
] as const;

describe("USAGE-5 · the three public pages share one render per minute", () => {
  it("the TTL constant these pages cite is still 60", () => {
    expect(MENU_CACHE_TTL_SECONDS).toBe(60);
  });

  for (const route of ROUTES) {
    it(`${route} exports revalidate = 60 and not force-dynamic`, () => {
      const code = stripComments(read(route));
      expect(code).toMatch(/export const revalidate = 60;/);
      expect(code).not.toContain("force-dynamic");
      // `dynamic = "force-static"` would freeze the CMS flag at build time — the
      // exact failure SLICE 107 guarded against. Neither extreme is allowed.
      expect(code).not.toMatch(/export const dynamic\b/);
    });
  }

  it("the pages that read drafts still ask Draft Mode (route-cache bypass for staff preview)", () => {
    // Draft Mode bypasses the route cache by design; that is what keeps staff
    // preview live while the public shares a render.
    expect(stripComments(read("src/app/specials/page.tsx"))).toContain("isPreviewActive()");
    expect(stripComments(read("src/app/loyalty/page.tsx"))).toContain("isPreviewActive()");
    expect(stripComments(read("src/app/medical/page.tsx"))).toContain("getContentForRender(");
  });
});

describe("USAGE-5 · the product page (dynamic segment) is cleared by every menu publish", () => {
  it("the product route pattern is registered and the helper revalidates it with type 'page'", () => {
    expect(PUBLIC_MENU_PAGE_PATTERNS).toContain("/menu/products/[id]");
    const src = stripComments(read("src/lib/site/public-surfaces.ts"));
    // Next.js: a path with a dynamic segment REQUIRES the `type` argument.
    expect(src).toMatch(/for \(const pattern of PUBLIC_MENU_PAGE_PATTERNS\)/);
    expect(src).toContain('revalidatePath(pattern, "page")');
    // And it must run inside the same never-throw helper the publish paths call.
    const helper = src.slice(src.indexOf("export function revalidatePublicMenuSurfaces"));
    expect(helper).toContain("PUBLIC_MENU_PAGE_PATTERNS");
  });

  it("the product page renders at runtime, not at build: generateStaticParams returns an EMPTY array (USAGE-5f)", () => {
    // Measured after the USAGE-5 merge: `revalidate = 60` alone left this
    // dynamic-segment route "ƒ (Dynamic)" in the build output and MISS on every
    // production hit. Next.js: "You must always return an array from
    // generateStaticParams, even if it's empty. Otherwise, the route will be
    // dynamically rendered." An empty array = no build-time menu pull.
    const code = stripComments(read("src/app/menu/products/[id]/page.tsx"));
    expect(code).toMatch(/export function generateStaticParams\(\): Array<\{ id: string \}> \{\s*return \[\];\s*\}/);
    // Unknown ids must still reach the page and 404 there — never a frozen list.
    expect(code).not.toMatch(/export const dynamicParams\s*=\s*false/);
    expect(code).toContain("if (!baseItem) notFound();");
  });

  it("the product page is a classified cacheable surface (menu-cache-policy)", () => {
    const core = read("src/lib/menu/menu-cache-policy-core.ts");
    expect(core).toContain('name: "Product detail (/menu/products/[id])"');
    expect(core).toMatch(/Product detail \(\/menu\/products\/\[id\]\)",\s*anchor: "[^"]+",\s*cacheable: true/);
  });
});

describe("USAGE-5 · every writer still clears the page it changes", () => {
  it("/specials is on the menu-publish surface list", () => {
    expect(PUBLIC_MENU_SURFACES).toContain("/specials");
  });

  it("promotion publish/unpublish and never-discount edits clear /specials or the whole layout", () => {
    const src = stripComments(read("src/app/admin/promotions/actions.ts"));
    expect(fnBody(src, "setPromotionStatusAction")).toContain('revalidatePath("/specials")');
    expect(fnBody(src, "setPromotionStatusAction")).toContain('revalidatePath("/", "layout")');
    expect(fnBody(src, "addNeverDiscountAction")).toContain('revalidatePath("/", "layout")');
    expect(fnBody(src, "removeNeverDiscountAction")).toContain('revalidatePath("/", "layout")');
  });

  it("the Specials editor publish clears /specials", () => {
    const src = stripComments(read("src/app/admin/specials/actions.ts"));
    expect(src).toContain('revalidatePath("/specials")');
  });

  it("the Medical editor publish clears /medical (the hide flag lives there)", () => {
    const src = stripComments(read("src/app/admin/medical-page/actions.ts"));
    expect(src).toContain('revalidatePath("/medical")');
    expect(src).toContain('revalidatePath("/", "layout")');
  });

  it("the Loyalty-page editor clears /loyalty", () => {
    const src = stripComments(read("src/app/admin/loyalty-page/actions.ts"));
    expect(src.match(/revalidatePath\("\/loyalty"\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("the loyalty PROGRAM editors (config + tiers) clear /loyalty — the public page prints those numbers", () => {
    const src = stripComments(read("src/app/admin/loyalty/actions.ts"));
    for (const fn of ["saveLoyaltyConfigAction", "saveLoyaltyTierAction", "deleteLoyaltyTierAction"]) {
      expect(fnBody(src, fn), fn).toContain('revalidatePath("/loyalty")');
    }
    // And the public page really does read config + tiers, otherwise the
    // assertions above would be guarding nothing.
    const page = stripComments(read("src/app/loyalty/page.tsx"));
    expect(page).toContain("getConfig()");
    expect(page).toContain("listTiers()");
  });

  it("generic content publishes still fall back to a whole-layout revalidate", () => {
    const src = stripComments(read("src/app/admin/content/actions.ts"));
    expect(fnBody(src.replace("function revalidatePublicForPage", "export async function revalidatePublicForPage"), "revalidatePublicForPage")).toContain(
      'revalidatePath("/", "layout")',
    );
  });
});
