/**
 * tests/compliance/d225-fallback-variety-rotation.test.ts  (D225)
 *
 * Owner: "I want to be able to add many fallback images to the categories,
 * so that the menu has a variety of images used. it should make it look
 * better. and to really make it cooler, the cards with fallback images,
 * should rotate images."
 *
 *   1. Pure core: many pictures per category, variety across a grid (no two
 *      neighbours alike), the rotation order and the rules for when it runs.
 *   2. Migration 0356: a list per category, existing rows kept, the same
 *      picture once per category, RLS + grants re-asserted, PG check.
 *   3. Server: snapshot v2 (a URL list per category), pre-0356 fallback read,
 *      the rotation lists sent once per page by the site layout.
 *   4. The page: a strip of pictures with move / remove, multi-file upload,
 *      library adds to the list, cap shown, 0356-missing banner.
 *   5. The card: only fallback cards rotate, first paint unchanged, a real
 *      pause button outside the product link (WCAG 2.2.2), reduced motion,
 *      in-view only, the next picture downloaded before it is shown.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import {
  MAX_FALLBACKS_PER_CATEGORY,
  applyMenuCardFallbacks,
  fallbackPageRows,
  fallbackRotationOrder,
  fallbackUrlForKey,
  movedOrder,
  shouldRotate,
  stableSlot,
  type FallbackableItem,
} from "@/lib/menu/menu-card-fallback-core";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

describe("D225 core: variety and rotation", () => {
  const list = ["https://cdn/a.webp", "https://cdn/b.webp", "https://cdn/c.webp", "https://cdn/d.webp"];
  const lists = new Map<string, readonly string[]>([["flower", list]]);

  it("a grid of fallback cards uses the whole list and never repeats a neighbour", () => {
    const items: FallbackableItem[] = Array.from({ length: 40 }, (_, i) => ({ id: `lot-${i}`, category: "flower" }));
    const out = applyMenuCardFallbacks(items, lists);
    expect(new Set(out.map((o) => o.imageUrl)).size).toBe(4);
    for (let i = 1; i < out.length; i += 1) expect(out[i]!.imageUrl).not.toBe(out[i - 1]!.imageUrl);
    expect(out.every((o) => o.imageIsFallback === true)).toBe(true);
  });

  it("the same product gets the same first picture on every render", () => {
    const a = applyMenuCardFallbacks<FallbackableItem>([{ id: "lot-9", category: "flower" }], lists)[0]!.imageUrl;
    const b = applyMenuCardFallbacks<FallbackableItem>([{ id: "lot-9", category: "flower" }], lists)[0]!.imageUrl;
    expect(a).toBe(b);
    expect(fallbackUrlForKey("lot-9", list)).toBe(list[stableSlot("lot-9", list.length)]);
  });

  it("a product with its own photo never gets a fallback, with one picture or many", () => {
    const own: FallbackableItem = { id: "x", category: "flower", imageUrl: "https://own.webp", imageIsFallback: false };
    expect(applyMenuCardFallbacks([own], lists)[0]).toBe(own);
  });

  it("rotation starts from the picture the card shows, wraps, and never runs with one picture", () => {
    expect(fallbackRotationOrder(list, list[2])).toEqual([list[2], list[3], list[0], list[1]]);
    expect(fallbackRotationOrder([list[0]!], list[0])).toEqual([]);
    expect(fallbackRotationOrder(list, "https://own.webp")).toEqual([]);
  });

  it("rotation stops for reduced motion, the pause control, off-screen cards and hidden tabs", () => {
    const env = { pictures: 3, reducedMotion: false, paused: false, inView: true, hidden: false };
    expect(shouldRotate(env)).toBe(true);
    expect(shouldRotate({ ...env, reducedMotion: true })).toBe(false);
    expect(shouldRotate({ ...env, paused: true })).toBe(false);
    expect(shouldRotate({ ...env, inView: false })).toBe(false);
    expect(shouldRotate({ ...env, hidden: true })).toBe(false);
  });

  it("the page lists every picture in owner order and knows the cap", () => {
    const rows = fallbackPageRows(
      [
        { website_category: "flower", media_id: "b", updated_at: null, sort_order: 1 },
        { website_category: "flower", media_id: "a", updated_at: null, sort_order: 0 },
      ],
      [],
      null,
    );
    const flower = rows.find((r) => r.category === "flower")!;
    expect(flower.pictures.map((p) => p.mediaId)).toEqual(["a", "b"]);
    expect(flower.canAdd).toBe(true);
    expect(MAX_FALLBACKS_PER_CATEGORY).toBe(12);
    expect(movedOrder(["a", "b"], "b", "up")).toEqual(["b", "a"]);
  });
});

describe("D225 migration 0356", () => {
  const sql = read("supabase/migrations/0356_menu_card_fallback_many.sql");
  it("turns the table into a list without losing rows", () => {
    expect(sql).toContain("add column if not exists id uuid not null default gen_random_uuid();");
    expect(sql).toContain("add column if not exists sort_order integer not null default 0;");
    expect(sql).toContain("primary key (id)");
    expect(sql).toContain("check (sort_order >= 0)");
    expect(sql).toContain("on public.menu_card_fallback_images(website_category, media_id);");
    expect(sql).not.toMatch(/drop table|delete from|truncate/i);
  });
  it("re-asserts RLS and service-role-only grants", () => {
    expect(sql).toContain("alter table public.menu_card_fallback_images enable row level security;");
    expect(sql).toContain("revoke all on table public.menu_card_fallback_images from public, anon, authenticated;");
    expect(sql).toContain("grant select, insert, update, delete on table public.menu_card_fallback_images to service_role;");
  });
  it("comments are editor safe (no apostrophes or semicolons)", () => {
    const comments = sql.split("\n").filter((l) => l.trim().startsWith("--"));
    for (const c of comments) {
      expect(c).not.toContain("'");
      expect(c).not.toContain(";");
    }
  });
  it("ships a rollback, a registered PG check, a run-book entry and a contract", () => {
    expect(existsSync(path.join(ROOT, "supabase/rollbacks/0356_menu_card_fallback_many.rollback.sql"))).toBe(true);
    const check = read("scripts/recon/menu-card-fallback-0356-pg-check.sql");
    expect(check).toContain("MENU CARD FALLBACK 0356 CHECK PASSED");
    expect(check).toContain("has_table_privilege('service_role', 'public.menu_card_fallback_images', 'delete')");
    expect(check).toContain("the same picture twice in one category was accepted");
    const runner = read("scripts/compliance/verify-migrations-execute.ts");
    expect(runner.indexOf("menu-card-fallback-0356-pg-check.sql")).toBeLessThan(runner.indexOf("menu-card-fallback-0355-pg-check.sql"));
    expect(read("scripts/recon/menu-card-fallback-0355-pg-check.sql")).toContain("0356_menu_card_fallback_many.rollback.sql");
    expect(read("docs/MIGRATIONS_TO_RUN.md")).toContain("0356_menu_card_fallback_many");
  });
});

describe("D225 server + layout", () => {
  const s = read("src/lib/menu/menu-card-fallback-server.ts");
  it("snapshot v2 holds a URL list per category, still cached and tagged", () => {
    expect(s).toContain('["public-snapshot", "menu-card-fallbacks", "v2"]');
    expect(s).toContain("async (): Promise<Array<[string, string[]]>>");
    expect(s).toContain("tags: [MENU_CACHE_TAG]");
  });
  it("works before 0356 is applied (missing column -> the 0355 read)", () => {
    expect(s).toContain('err.code === "42703"');
    expect(s).toContain('return { schema: "single", rows:');
  });
  it("the rotation lists travel once per page, only for 2+ pictures", () => {
    expect(s).toContain("if (urls.length >= 2) out[cat] = urls;");
    const layout = read("src/app/(site)/layout.tsx");
    expect(layout).toContain("menuCardRotationLists().catch(() => ({}))");
    expect(layout).toContain("<MenuCardRotationProvider lists={rotationLists}>");
  });
  it("the grid payload does not grow (no per-card URL list on the item)", () => {
    expect(read("src/lib/leafly/types.ts")).not.toMatch(/imageRotation|imageFallbackSlot/);
  });
});

describe("D225 the admin page", () => {
  const page = read("src/app/admin/menu-card-fallbacks/page.tsx");
  const actions = read("src/app/admin/menu-card-fallbacks/actions.ts");
  it("shows every picture with move and remove, and adds many at once", () => {
    expect(page).toContain('data-testid="fallback-pictures"');
    expect(page).toContain("action={moveFallbackAction}");
    expect(page).toContain("action={removeFallbackPictureAction}");
    expect(page).toContain("multiple={multi}");
    expect(page).toContain('data-testid="fallback-0356-missing"');
    expect(page).toContain("galleryIds: pickingRow ? pickingRow.pictures.map((p) => p.mediaId) : []");
  });
  it("uploads check every file before uploading any, and respect the cap", () => {
    expect(actions).toContain('formData.getAll("file")');
    expect(actions).toContain("roomFor(before.length, files.length)");
    expect(actions).toContain('"menu_card_fallback.removed"');
    expect(actions).toContain('"menu_card_fallback.reordered"');
  });
});

describe("D225 the rotating card", () => {
  const card = read("src/components/menu/ProductCardVisual.tsx");
  const rot = read("src/components/menu/fallback-rotation/RotatingFallbackImage.tsx");
  const env = read("src/components/menu/fallback-rotation/useRotationEnv.ts");
  it("only fallback cards rotate; own photos keep the plain image", () => {
    expect(card).toContain("{item.imageIsFallback ? (");
    expect(card).toContain("<RotatingFallbackImage itemId={item.id} category={item.category} imageUrl={item.imageUrl} alt={item.name} />");
  });
  it("the pause button sits outside the product link", () => {
    const linkClose = card.indexOf("</Link>", card.indexOf('aria-label={`View ${item.name}`}'));
    const toggle = card.indexOf("<FallbackRotationToggle");
    expect(linkClose).toBeGreaterThan(0);
    expect(toggle).toBeGreaterThan(linkClose);
    expect(rot).toContain('type="button"');
    expect(rot).toContain("aria-pressed={paused}");
  });
  it("honours reduced motion, the pause choice, visibility and on-screen", () => {
    expect(env).toContain('"(prefers-reduced-motion: reduce)"');
    expect(env).toContain("ROTATION_PAUSE_STORAGE_KEY");
    expect(env).toContain('"visibilitychange"');
    expect(rot).toContain("new IntersectionObserver(");
    expect(rot).toContain("shouldRotate({ pictures: count, reducedMotion, paused, inView, hidden })");
    expect(read("src/app/globals.css")).toContain(".gw-fallback-fade-in { animation: none; }");
  });
  it("downloads the next picture before showing it", () => {
    expect(rot).toContain("const img = new Image();");
    expect(rot).toContain("img.onload = advance;");
  });
});
