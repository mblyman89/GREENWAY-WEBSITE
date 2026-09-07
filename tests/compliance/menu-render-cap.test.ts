/**
 * SLICE B (performance) — THE MENU RENDER CAP.
 *
 * Michael's symptom, verbatim: "if I click the shop button to go to the menu,
 * it takes what feels like over a minute to load. Then once loaded things speed
 * up a bit, but not a lot. ... Going back to the menu again, again what feels
 * like over a minute of loading."
 *
 * The cause was in `InteractiveMenuBrowser.tsx`: the grid mounted EVERY matching
 * product as a live `ProductCard`, with no cap, no pagination and no
 * virtualization. Each card is itself a client component running two pricing
 * computations and subscribing to two contexts, so an unfiltered menu asked the
 * browser to build thousands of components before it could paint. Going BACK
 * being slow even with a warm server cache is the proof the cost was in the
 * browser, not the database.
 *
 * These pins lock the fix in place. They read the REAL source file rather than a
 * copy, so deleting the cap or reverting the render site fails the build instead
 * of quietly restoring the one-minute menu.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  FIRST_PAGE_SIZE,
  MAX_RENDERED_CARDS,
  PAGE_STEP,
  clampBudget,
  nextBudget,
  pageGroups,
  pagingStatusLabel,
  __runMenuPaginationTests,
  type PageableGroup,
} from "@/lib/menu/menu-pagination-core";

const repoFile = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");
const BROWSER = "src/components/menu/InteractiveMenuBrowser.tsx";

const group = (key: string, n: number): PageableGroup<string> => ({
  key,
  items: Array.from({ length: n }, (_, i) => `${key}-${i}`),
});

describe("the pure pagination core carries its own proof", () => {
  it("passes every self-assertion", () => {
    const result = __runMenuPaginationTests();
    expect(result.failed).toBe(0);
    // A harness that asserts nothing would also report zero failures.
    expect(result.passed).toBeGreaterThan(40);
  });
});

describe("THE CORE GUARANTEE: the number of mounted cards is bounded", () => {
  it("renders one screenful from a 4,500-product catalog, not 4,500 cards", () => {
    const catalog = Array.from({ length: 12 }, (_, i) => group(`cat${i}`, 375));
    const paged = pageGroups(catalog, FIRST_PAGE_SIZE);
    expect(paged.total).toBe(4500);
    expect(paged.rendered).toBe(FIRST_PAGE_SIZE);
    expect(paged.rendered).toBeLessThan(100);
  });

  it("spends the budget ACROSS groups, never per group", () => {
    // The trap: a per-group cap would render 48 x 12 = 576 cards and would grow
    // every time the owner adds a category at /admin/settings/types.
    const catalog = Array.from({ length: 12 }, (_, i) => group(`cat${i}`, 375));
    expect(pageGroups(catalog, FIRST_PAGE_SIZE).rendered).toBe(FIRST_PAGE_SIZE);
  });

  it("stays bounded no matter how many categories the owner creates", () => {
    for (const categoryCount of [1, 5, 12, 40, 200]) {
      const catalog = Array.from({ length: categoryCount }, (_, i) => group(`c${i}`, 60));
      const paged = pageGroups(catalog, FIRST_PAGE_SIZE);
      expect(paged.rendered).toBe(FIRST_PAGE_SIZE);
    }
  });

  it("never exceeds the hard ceiling, whatever budget is requested", () => {
    const catalog = Array.from({ length: 12 }, (_, i) => group(`c${i}`, 375));
    for (const budget of [48, 96, 480, 5_000, 1_000_000]) {
      expect(pageGroups(catalog, budget).rendered).toBeLessThanOrEqual(MAX_RENDERED_CARDS);
    }
  });

  it("terminates: repeated load-more converges on the ceiling", () => {
    let budget = FIRST_PAGE_SIZE;
    for (let i = 0; i < 1_000; i += 1) budget = nextBudget(budget);
    expect(budget).toBe(MAX_RENDERED_CARDS);
  });
});

describe("NOTHING IS HIDDEN — this is a render cap, not a filter", () => {
  it("reports the true total even when it renders far fewer", () => {
    const catalog = [group("a", 900), group("b", 900)];
    const paged = pageGroups(catalog, FIRST_PAGE_SIZE);
    expect(paged.total).toBe(1800);
    expect(paged.remaining).toBe(1800 - FIRST_PAGE_SIZE);
  });

  it("keeps rendered + remaining === total at every budget", () => {
    const catalog = Array.from({ length: 6 }, (_, i) => group(`c${i}`, 300));
    for (const budget of [1, 48, 96, 200, 480, 9_999]) {
      const paged = pageGroups(catalog, budget);
      expect(paged.rendered + paged.remaining).toBe(paged.total);
    }
  });

  it("withholds only the TAIL — order and content are never altered", () => {
    const paged = pageGroups([group("a", 40), group("b", 40)], FIRST_PAGE_SIZE + 12);
    expect(paged.groups[0]!.items).toEqual(group("a", 40).items);
    expect(paged.groups[1]!.items).toEqual(group("b", 40).items.slice(0, 20));
  });

  it("passes items through by reference — no copying 4,500 objects per render", () => {
    const a = { id: "a" };
    const b = { id: "b" };
    const paged = pageGroups([{ key: "k", items: [a, b] }], FIRST_PAGE_SIZE);
    expect(paged.groups[0]!.items[0]).toBe(a);
    expect(paged.groups[0]!.items[1]).toBe(b);
  });

  it("never mutates the caller's arrays", () => {
    const source = [group("a", 60), group("b", 60)];
    pageGroups(source, FIRST_PAGE_SIZE);
    expect(source).toHaveLength(2);
    expect(source[0]!.items).toHaveLength(60);
    expect(source[1]!.items).toHaveLength(60);
  });

  it("tells the shopper the honest count, never claiming 'all' prematurely", () => {
    const label = pagingStatusLabel({
      rendered: 48,
      remaining: 4452,
      total: 4500,
      atCeiling: false,
    });
    expect(label).toContain("48");
    expect(label).toContain("4500");
    expect(label).not.toContain("all");
  });

  it("says 'all' only when everything really is rendered", () => {
    expect(pagingStatusLabel({ rendered: 9, remaining: 0, total: 9, atCeiling: false })).toBe(
      "Showing all 9 products.",
    );
  });

  it("directs the shopper to filters once scrolling can no longer help", () => {
    const label = pagingStatusLabel({
      rendered: MAX_RENDERED_CARDS,
      remaining: 20,
      total: MAX_RENDERED_CARDS + 20,
      atCeiling: true,
    });
    expect(label).toContain("filters");
  });
});

describe("no heading ever sits above an empty grid", () => {
  it("drops groups that fall entirely outside the budget", () => {
    const paged = pageGroups([group("a", 100), group("b", 100)], FIRST_PAGE_SIZE);
    expect(paged.groups).toHaveLength(1);
  });

  it("never returns an empty group", () => {
    const catalog = [group("a", 0), group("b", 50), group("c", 0), group("d", 50)];
    for (const budget of [48, 96, 480]) {
      for (const kept of pageGroups(catalog, budget).groups) {
        expect(kept.items.length).toBeGreaterThan(0);
      }
    }
  });

  it("preserves the section heading/anchor fields the grid renders", () => {
    // The real groups carry { key, id, eyebrow, label } and the section element
    // renders `id={group.id}` as a scroll anchor. Trimming items must not strip
    // those or the headings and anchors break.
    const paged = pageGroups(
      [{ key: "flower", id: "flower", eyebrow: "Category", label: "Flower", items: ["a", "b"] }],
      FIRST_PAGE_SIZE,
    );
    expect(paged.groups[0]).toMatchObject({
      key: "flower",
      id: "flower",
      eyebrow: "Category",
      label: "Flower",
    });
  });
});

describe("the budget FAILS CLOSED on nonsense input", () => {
  it("collapses a non-finite budget to the smallest page, never the ceiling", () => {
    // A corrupted budget must never be read as "render everything".
    expect(clampBudget(Number.NaN)).toBe(FIRST_PAGE_SIZE);
    expect(clampBudget(Number.POSITIVE_INFINITY)).toBe(FIRST_PAGE_SIZE);
    expect(clampBudget(Number.NEGATIVE_INFINITY)).toBe(FIRST_PAGE_SIZE);
  });

  it("raises a too-small budget instead of rendering a blank grid", () => {
    expect(clampBudget(0)).toBe(FIRST_PAGE_SIZE);
    expect(clampBudget(-500)).toBe(FIRST_PAGE_SIZE);
  });

  it("handles a completely empty menu without throwing", () => {
    const paged = pageGroups<string>([], FIRST_PAGE_SIZE);
    expect(paged.rendered).toBe(0);
    expect(paged.hasMore).toBe(false);
    expect(pagingStatusLabel(paged)).toBe("");
  });
});

describe("the constants stay sane", () => {
  it("keeps the first page big enough to fill a screen and small enough to be fast", () => {
    expect(FIRST_PAGE_SIZE).toBeGreaterThanOrEqual(12);
    expect(FIRST_PAGE_SIZE).toBeLessThanOrEqual(100);
    // The 4-column grid should come out even.
    expect(FIRST_PAGE_SIZE % 4).toBe(0);
  });

  it("keeps the ceiling far below a full catalog", () => {
    expect(MAX_RENDERED_CARDS).toBeGreaterThan(FIRST_PAGE_SIZE);
    expect(MAX_RENDERED_CARDS).toBeLessThan(1_000);
  });

  it("keeps the step positive so load-more always makes progress", () => {
    expect(PAGE_STEP).toBeGreaterThan(0);
    expect(nextBudget(FIRST_PAGE_SIZE)).toBeGreaterThan(FIRST_PAGE_SIZE);
  });
});

describe("THE WIRING — the real component must actually use the cap", () => {
  const source = repoFile(BROWSER);

  it("renders the PAGED groups, not the unbounded list", () => {
    expect(source).toContain("visibleGroups.map((group, index)");
    // The exact pre-slice line. If this ever comes back, the menu is slow again.
    expect(source).not.toContain("{groupedItems.map((group, index) =>");
  });

  it("derives the visible groups from the pure core", () => {
    expect(source).toContain("pageGroups(groupedItems, cardBudget)");
  });

  it("starts at one page rather than an arbitrary number", () => {
    expect(source).toContain("useState(FIRST_PAGE_SIZE)");
  });

  it("extends the budget only through the pure helper", () => {
    expect(source).toContain("nextBudget(current)");
  });

  it("resets the budget when the filters change", () => {
    // Otherwise a shopper who scrolled deep and then filtered would mount
    // hundreds of cards on the very next paint.
    expect(source).toContain("setCardBudget(FIRST_PAGE_SIZE)");
    expect(source).toContain("budgetSignature !== resultSignature");
  });

  it("keeps a working control when IntersectionObserver is unavailable", () => {
    expect(source).toContain('typeof IntersectionObserver === "undefined"');
    expect(source).toContain("Show more products");
  });

  it("disconnects the observer so it cannot leak between renders", () => {
    expect(source).toContain("observer.disconnect()");
  });

  it("tells the shopper how many of the total are showing", () => {
    expect(source).toContain("pagingStatusLabel(pagedGroups)");
  });

  it("still renders the accessory and merch collections at the bottom", () => {
    // The cap must not swallow the non-cannabis collections.
    expect(source).toContain("showAccessoryBottom");
    expect(source).toContain("showMerchBottom");
    expect(source).toContain("accessorySectionCards.map");
    expect(source).toContain("merchProductDefs.map");
  });

  it("leaves the empty state intact", () => {
    expect(source).toContain("No products match those filters.");
  });
});
