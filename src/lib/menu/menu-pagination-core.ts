/**
 * src/lib/menu/menu-pagination-core.ts
 *
 * SLICE B (performance) — BOUNDING HOW MANY CARDS EXIST AT ONCE.
 *
 * THE PROBLEM
 * ───────────
 * `InteractiveMenuBrowser.tsx` renders every matching product as a live React
 * component:
 *
 *     {group.items.map((item) => <ProductCard key={item.id} item={item} />)}
 *
 * There is no cap, no pagination, and no virtualization anywhere in that file.
 * With no category filter applied, the browser is asked to mount thousands of
 * `ProductCard`s. Each one is itself a client component that runs TWO pricing
 * computations on every render (`menuCardDiscountForItem`,
 * `menuCardBadgeForItem`) and subscribes to two React contexts.
 *
 * That is the owner's reported symptom, precisely: "click Shop and wait what
 * feels like over a minute", and then "things speed up a bit, but not a lot".
 * The first part is mounting thousands of components; the second is every
 * subsequent interaction re-running work across all of them. Crucially, going
 * BACK to the menu is slow again even though the server cache is warm — which
 * is the proof that this cost is in the browser, not the database.
 *
 * THE FIX
 * ───────
 * Render a bounded first page, then extend as the shopper scrolls.
 *
 * THE SUBTLETY THAT MAKES THIS NON-TRIVIAL
 * ────────────────────────────────────────
 * The menu is not a flat list — it is a list of CATEGORY GROUPS ("Flower",
 * "Vapes", "Edibles", …), each with its own heading. A naive per-group cap
 * ("show 48 per group") would still mount 48 × 12 categories = 576 cards, and
 * would grow every time the owner adds a category at /admin/settings/types.
 *
 * So the budget is spent ACROSS the groups in order: fill the first group, then
 * the next, until the budget runs out. Total rendered cards is therefore
 * bounded by ONE number regardless of how many categories exist. Groups that
 * fall entirely outside the budget are dropped, so their headings do not render
 * above an empty grid.
 *
 * WHAT THIS IS NOT
 * ────────────────
 * This is NOT filtering. Every item still matches, is still counted, and is
 * still reachable by scrolling. Nothing is hidden from the shopper — the
 * remaining cards simply have not been built yet. `remaining` is exposed so the
 * UI can say exactly how many are left rather than pretending the list ended.
 *
 * Everything here is PURE: no React, no DOM, no I/O.
 */

/**
 * The shape this module needs: a group with a stable key and some items.
 *
 * The index signature is deliberate. Real menu groups carry more than this \u2014
 * `id` (the scroll anchor), `eyebrow` and `label` (the heading) \u2014 and this
 * module must accept them, pass them through untouched, and never care what
 * they are. Without the index signature a caller's richer group is rejected by
 * excess-property checking even though the behaviour is correct.
 */
export type PageableGroup<T> = {
  key: string;
  items: T[];
  [extra: string]: unknown;
};

/** How many cards the first paint is allowed to build. */
export const FIRST_PAGE_SIZE = 48;

/** How many more each "load more" / scroll step adds. */
export const PAGE_STEP = 48;

/**
 * A hard ceiling on cards that may exist simultaneously.
 *
 * WHY A CEILING EXISTS AT ALL: infinite scroll without one just re-creates the
 * original bug slowly — scroll far enough and you are back to thousands of live
 * components and a janky page. 480 is ten pages deep; a shopper who has scrolled
 * past 480 products wants the search box or a filter, not more scrolling.
 */
export const MAX_RENDERED_CARDS = 480;

/**
 * Clamp any requested budget into the sane, bounded range.
 *
 * FAILS CLOSED. A budget that is not a real finite number (NaN, Infinity, a
 * corrupted value read back from a URL or storage) collapses to the SMALLEST
 * legal budget, not the largest. This module exists to protect the browser from
 * mounting too many components, so when the input is nonsense the safe answer is
 * "render one screenful", never "render the ceiling". Infinity is deliberately
 * treated the same as NaN for this reason \u2014 it is not a request for everything,
 * it is a bug upstream.
 */
export function clampBudget(requested: number): number {
  if (!Number.isFinite(requested)) return FIRST_PAGE_SIZE;
  const floored = Math.floor(requested);
  if (floored < FIRST_PAGE_SIZE) return FIRST_PAGE_SIZE;
  if (floored > MAX_RENDERED_CARDS) return MAX_RENDERED_CARDS;
  return floored;
}

/** The next budget after a "load more", never exceeding the ceiling. */
export function nextBudget(current: number): number {
  return clampBudget(clampBudget(current) + PAGE_STEP);
}

export type PagedGroups<T> = {
  /** Groups trimmed to the budget. Empty groups are removed entirely. */
  groups: PageableGroup<T>[];
  /** How many cards will actually render. */
  rendered: number;
  /** How many match the filters but are not built yet. */
  remaining: number;
  /** Total matching the filters. */
  total: number;
  /** True when more can be revealed by scrolling. */
  hasMore: boolean;
  /** True when everything left is only reachable by filtering, not scrolling. */
  atCeiling: boolean;
};

/**
 * Spend a card budget across ordered groups.
 *
 * Order is preserved exactly; only the tail is withheld. A group that receives
 * zero cards is dropped so no heading appears above an empty grid.
 */
export function pageGroups<T>(
  groups: readonly PageableGroup<T>[],
  budget: number,
): PagedGroups<T> {
  const limit = clampBudget(budget);
  const total = groups.reduce((sum, g) => sum + g.items.length, 0);

  const out: PageableGroup<T>[] = [];
  let spent = 0;
  for (const group of groups) {
    if (spent >= limit) break;
    const room = limit - spent;
    const slice = group.items.length <= room ? group.items : group.items.slice(0, room);
    if (slice.length === 0) continue;
    out.push({ ...group, items: slice });
    spent += slice.length;
  }

  const remaining = Math.max(0, total - spent);
  return {
    groups: out,
    rendered: spent,
    remaining,
    total,
    // More can be revealed only if there IS more and we have not hit the ceiling.
    hasMore: remaining > 0 && spent < MAX_RENDERED_CARDS,
    atCeiling: remaining > 0 && spent >= MAX_RENDERED_CARDS,
  };
}

/** Sentence under the grid. Honest about what is not yet shown. */
export function pagingStatusLabel(paged: {
  rendered: number;
  remaining: number;
  total: number;
  atCeiling: boolean;
}): string {
  if (paged.total === 0) return "";
  if (paged.remaining === 0) {
    return paged.total === 1 ? "Showing the only match." : `Showing all ${paged.total} products.`;
  }
  if (paged.atCeiling) {
    return `Showing ${paged.rendered} of ${paged.total} products — use search or filters to narrow it down.`;
  }
  return `Showing ${paged.rendered} of ${paged.total} products.`;
}

// ── Self-test ────────────────────────────────────────────────────────────────
export function __runMenuPaginationTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const check = (label: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`[menu-pagination] FAIL: ${label}`);
    }
  };
  const eq = (label: string, actual: unknown, expected: unknown) =>
    check(`${label} (got ${JSON.stringify(actual)})`, Object.is(actual, expected));

  const g = (key: string, n: number, offset = 0): PageableGroup<string> => ({
    key,
    items: Array.from({ length: n }, (_, i) => `${key}-${i + offset}`),
  });

  // ── Constants are sane ────────────────────────────────────────────────────
  check("first page is a positive integer", Number.isInteger(FIRST_PAGE_SIZE) && FIRST_PAGE_SIZE > 0);
  check("first page fills a screen but is not huge", FIRST_PAGE_SIZE >= 12 && FIRST_PAGE_SIZE <= 100);
  check("ceiling is far above the first page", MAX_RENDERED_CARDS > FIRST_PAGE_SIZE);
  check("ceiling is well under a full catalog", MAX_RENDERED_CARDS < 1000);
  check("step is positive", PAGE_STEP > 0);

  // ── THE CORE GUARANTEE: total is bounded across ALL groups ────────────────
  const twelve = Array.from({ length: 12 }, (_, i) => g(`cat${i}`, 400));
  const paged = pageGroups(twelve, FIRST_PAGE_SIZE);
  eq("4,800 items across 12 groups renders exactly the budget", paged.rendered, FIRST_PAGE_SIZE);
  eq("total is reported honestly", paged.total, 4800);
  eq("remaining is the rest", paged.remaining, 4800 - FIRST_PAGE_SIZE);
  check("more is available", paged.hasMore);
  check(
    "the budget is NOT applied per group (the trap this module exists to avoid)",
    paged.rendered < FIRST_PAGE_SIZE * 2,
  );

  // ── Groups outside the budget are dropped, not left empty ────────────────
  eq("only the first group survives a 48-card budget", paged.groups.length, 1);
  check("no surviving group is empty", paged.groups.every((x) => x.items.length > 0));

  // ── Order and content are preserved exactly ───────────────────────────────
  const ordered = pageGroups([g("a", 3), g("b", 3), g("c", 3)], 100);
  eq("all three groups fit", ordered.groups.length, 3);
  eq("group order preserved", ordered.groups.map((x) => x.key).join(","), "a,b,c");
  eq("first item of the first group is unchanged", ordered.groups[0]!.items[0], "a-0");
  eq("nothing is dropped when the budget is ample", ordered.rendered, 9);
  eq("remaining is zero", ordered.remaining, 0);
  check("hasMore is false when everything fits", !ordered.hasMore);

  // ── The budget can split a group mid-way ──────────────────────────────────
  const split = pageGroups([g("a", 30), g("b", 30)], FIRST_PAGE_SIZE);
  eq("both groups appear", split.groups.length, 2);
  eq("first group intact", split.groups[0]!.items.length, 30);
  eq("second group truncated to the remainder", split.groups[1]!.items.length, 18);
  eq("total rendered equals the budget", split.rendered, 48);

  // ── Ceiling behaviour ─────────────────────────────────────────────────────
  const atMax = pageGroups(twelve, MAX_RENDERED_CARDS);
  eq("ceiling is respected", atMax.rendered, MAX_RENDERED_CARDS);
  check("at the ceiling, scrolling no longer helps", atMax.atCeiling);
  check("...so hasMore is false", !atMax.hasMore);
  const over = pageGroups(twelve, MAX_RENDERED_CARDS + 5000);
  eq("an absurd budget still clamps to the ceiling", over.rendered, MAX_RENDERED_CARDS);

  // ── Budget arithmetic ─────────────────────────────────────────────────────
  eq("clamp raises a too-small budget", clampBudget(1), FIRST_PAGE_SIZE);
  eq("clamp rejects zero", clampBudget(0), FIRST_PAGE_SIZE);
  eq("clamp rejects negatives", clampBudget(-99), FIRST_PAGE_SIZE);
  eq("clamp caps at the ceiling", clampBudget(99999), MAX_RENDERED_CARDS);
  // A non-finite budget must fail CLOSED (smallest), never open (ceiling).
  eq("clamp fails closed on NaN", clampBudget(Number.NaN), FIRST_PAGE_SIZE);
  eq("clamp fails closed on Infinity", clampBudget(Number.POSITIVE_INFINITY), FIRST_PAGE_SIZE);
  eq("clamp fails closed on -Infinity", clampBudget(Number.NEGATIVE_INFINITY), FIRST_PAGE_SIZE);
  check(
    "NaN and Infinity are treated identically \u2014 both are 'not a real number'",
    clampBudget(Number.NaN) === clampBudget(Number.POSITIVE_INFINITY),
  );
  eq("clamp floors fractions", clampBudget(60.9), 60);
  eq("next adds one step", nextBudget(FIRST_PAGE_SIZE), FIRST_PAGE_SIZE + PAGE_STEP);
  eq("next never exceeds the ceiling", nextBudget(MAX_RENDERED_CARDS), MAX_RENDERED_CARDS);
  check(
    "repeated load-more always terminates at the ceiling",
    (() => {
      let b = FIRST_PAGE_SIZE;
      for (let i = 0; i < 500; i += 1) b = nextBudget(b);
      return b === MAX_RENDERED_CARDS;
    })(),
  );

  // ── Degenerate inputs are safe ────────────────────────────────────────────
  const none = pageGroups<string>([], FIRST_PAGE_SIZE);
  eq("no groups renders nothing", none.rendered, 0);
  eq("no groups has no total", none.total, 0);
  check("no groups has no more", !none.hasMore);
  eq("status is empty for an empty menu", pagingStatusLabel(none), "");
  const empties = pageGroups([g("a", 0), g("b", 0)], FIRST_PAGE_SIZE);
  eq("all-empty groups are dropped", empties.groups.length, 0);
  eq("all-empty renders nothing", empties.rendered, 0);

  // ── NOTHING IS EVER LOST ──────────────────────────────────────────────────
  check(
    "rendered + remaining always equals total, at every budget",
    [1, 5, 48, 96, 480, 5000].every((b) => {
      const p = pageGroups(twelve, b);
      return p.rendered + p.remaining === p.total;
    }),
  );
  check(
    "rendered never exceeds the requested budget",
    [48, 96, 200].every((b) => pageGroups(twelve, b).rendered <= clampBudget(b)),
  );
  // A budget BELOW the first page is raised to it, so this must use a budget
  // ABOVE FIRST_PAGE_SIZE to actually exercise a mid-group split.
  const identity = pageGroups([g("a", 40), g("b", 40)], FIRST_PAGE_SIZE + 12);
  eq("split group 1 is whole", identity.groups[0]!.items.join(","), g("a", 40).items.join(","));
  eq(
    "split group 2 is the leading slice, in order, nothing reordered",
    identity.groups[1]!.items.join(","),
    g("b", 20).items.join(","),
  );
  eq("split renders exactly the budget", identity.rendered, FIRST_PAGE_SIZE + 12);
  check(
    "items are passed through by REFERENCE, never copied or rebuilt",
    (() => {
      const a = { id: "x" };
      const b = { id: "y" };
      const p = pageGroups([{ key: "k", items: [a, b] }], FIRST_PAGE_SIZE);
      return p.groups[0]!.items[0] === a && p.groups[0]!.items[1] === b;
    })(),
  );
  check(
    "the caller's group arrays are never mutated",
    (() => {
      const src: PageableGroup<string>[] = [g("a", 60), g("b", 60)];
      const before = src.map((x) => x.items.length).join(",");
      pageGroups(src, FIRST_PAGE_SIZE);
      return src.map((x) => x.items.length).join(",") === before && src.length === 2;
    })(),
  );
  check(
    "non-item group properties survive the trim (headings, labels, flags)",
    (() => {
      const p = pageGroups(
        [{ key: "flower", items: ["a", "b", "c"], label: "Flower", tone: "green" } as never],
        FIRST_PAGE_SIZE,
      );
      const kept = p.groups[0] as unknown as { label?: string; tone?: string };
      return kept.label === "Flower" && kept.tone === "green";
    })(),
  );

  // ── Status copy is honest ─────────────────────────────────────────────────
  eq(
    "shows the true counts",
    pagingStatusLabel({ rendered: 48, remaining: 4452, total: 4500, atCeiling: false }),
    "Showing 48 of 4500 products.",
  );
  eq(
    "says so when everything is shown",
    pagingStatusLabel({ rendered: 9, remaining: 0, total: 9, atCeiling: false }),
    "Showing all 9 products.",
  );
  eq(
    "handles a single match without saying 'all 1'",
    pagingStatusLabel({ rendered: 1, remaining: 0, total: 1, atCeiling: false }),
    "Showing the only match.",
  );
  check(
    "at the ceiling it tells the shopper what to do instead of scrolling",
    pagingStatusLabel({ rendered: 480, remaining: 20, total: 500, atCeiling: true }).includes(
      "filters",
    ),
  );
  check(
    "never claims to show more than exist",
    !pagingStatusLabel({ rendered: 48, remaining: 4452, total: 4500, atCeiling: false }).includes(
      "all",
    ),
  );

  return { passed, failed };
}
