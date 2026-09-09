/**
 * src/lib/promotions/deal-badge-core.ts  (SLICE 96 — owner: Michael)
 *
 * PURE deal-badge engine for PRODUCT CARDS (no React, no DB, no server-only).
 *
 * OWNER ASK (verbatim intent): the "doobie Tuesday - 20% off - or 4 for 3"
 * badge he saw on ONE card in the PDP "More from" rail "should be included for
 * all specials, any promotion, any deal or flash sale, etc., on all the
 * product cards that it is relevant for. Monday, show it on edibles and
 * liquids, Tuesday on prerolls and blunts, including infused prerolls and
 * blunts, etc. for Friday, on all flower, Saturday and Sunday should be shown
 * on all the product cards. Thursday should be placed on all the items in the
 * brand we put on sale."
 *
 * DESIGN — RULES-DRIVEN, NEVER HARDCODED: Michael's day->category matrix is
 * already encoded in the back office's PUBLISHED promotion rules (seed
 * fallback: Munchie Monday targets edible-solid/edible-liquid/rso/tincture;
 * Doobie Tuesday targets preroll/blunt/preroll-pack + all infused variants;
 * Wax Wednesday targets carts/concentrates; Top Shelf Thursday targets the
 * featured brands; Ounce Friday targets flower/popcorn-bud/infused-flower/
 * trim; Super Saturday + Ice Cream Sunday are storewide). So the badge simply
 * asks "does ANY rule active today match this item?" — when staff edit a deal
 * or publish a flash sale (date-window promo) in the back office, the badges
 * follow automatically with zero code changes. That is the "any promotion,
 * any deal or flash sale, etc." half of the ask.
 *
 * BADGE vs STRUCK PRICE (reconciling with SLICE 40): SLICE 40's owner rule
 * hides the struck-through card PRICE on Friday/Saturday/Sunday because those
 * deals are basket-dependent (weight tiers / one-item split / 3-for-2) — a
 * single item may earn nothing by itself, so a struck price would overpromise.
 * That rule is UNCHANGED (menuCardDiscountForItem still gates the price).
 * The BADGE is different: it is an honest advertisement of the day's deal
 * ("Ounce Friday · up to 30% by the ounce"), not a price promise — so per
 * Michael's new ask it shows EVERY day the item is deal-relevant, including
 * Fri/Sat/Sun where the price stays regular and the cart reveals the savings.
 *
 * MATCH-BASED FALLBACK: Ice Cream Sunday (3-for-2) has an honest headline
 * percent of 0 (savings depend on the whole basket), so menuDiscountForItem
 * returns undefined for it — yet Michael explicitly wants Sunday badges on
 * ALL cards. When no percent-bearing deal exists but an active rule still
 * MATCHES the item, the badge falls back to the highest-priority matching
 * rule's "title · bonusNote" (e.g. "Ice Cream Sunday · 3-for-2 equivalent
 * savings"). Merch stays badge-free on storewide cannabis deals because
 * ruleMatchesLine already excludes merch from storewide rules.
 *
 * HYDRATION-SAFE: returns undefined while activeRules/weekday are still
 * resolving on the client (first paint), matching useStoreWeekday's contract
 * so SSG markup matches the server render.
 *
 * NO I/O — unit-testable via __runDealBadgeCoreTests() (registered in
 * scripts/compliance/run-pure-selftests.ts).
 */
import type { GreenwayMenuItem } from "@/lib/leafly/types";
import type { StoreWeekday } from "@/lib/specials/daily-deals";
import { ruleMatchesLine } from "./discount-engine-core";
import {
  activeSnapshotsFor,
  formatMenuDealBadge,
  itemToEngineLine,
  menuCardDiscountForItem,
  menuDiscountForItem,
  seedRuleSnapshots,
  snapshotToEngineRule,
  type PublishedRuleSnapshot,
} from "./published-rules-core";

/**
 * The single badge label a PRODUCT CARD shows for an item — or undefined when
 * no active rule is relevant to it (no badge; the card stays clean).
 *
 *  1. Best percent-bearing deal wins (same pick order the struck price uses:
 *     highest percent, then highest priority) — e.g. Tuesday preroll cards say
 *     "Doobie Tuesday · 20% off · or 4 for 3 (25%)".
 *  2. Otherwise the highest-priority ACTIVE rule that MATCHES the item badges
 *     with "title · bonusNote" (title alone when there is no note) — this is
 *     the Ice Cream Sunday path.
 *  3. No matching rule -> undefined. Unresolved weekday/rules -> undefined
 *     (hydration-safe first paint).
 */
export function menuCardBadgeForItem(
  item: GreenwayMenuItem,
  activeRules: PublishedRuleSnapshot[] | undefined,
  weekday: StoreWeekday | undefined,
): string | undefined {
  if (!activeRules || !weekday || activeRules.length === 0) return undefined;

  // Percent-bearing deal: reuse the EXACT badge text the More-from rail
  // already shows (formatMenuDealBadge), so nothing changes visually where
  // the badge existed before — it just appears everywhere relevant now.
  const deal = menuDiscountForItem(item, activeRules);
  if (deal) return formatMenuDealBadge(deal);

  // Match-based fallback (basket deals with an honest 0% headline, e.g.
  // Ice Cream Sunday 3-for-2): badge from the highest-priority matching rule.
  const line = itemToEngineLine(item);
  let best: PublishedRuleSnapshot | null = null;
  for (const s of activeRules) {
    if (!ruleMatchesLine(snapshotToEngineRule(s), line)) continue;
    if (!best || s.priority > best.priority) best = s;
  }
  if (!best) return undefined;
  return best.bonusNote ? `${best.title} \u00b7 ${best.bonusNote}` : best.title;
}

// ---------------------------------------------------------------------------
// Self-tests (pure, no I/O)
// ---------------------------------------------------------------------------
export function __runDealBadgeCoreTests(): void {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`deal-badge-core self-test failed: ${msg}`);
    passed += 1;
  };

  // Minimal GreenwayMenuItem stand-ins (only the fields the engine reads).
  const mk = (id: string, over: Record<string, unknown> = {}): GreenwayMenuItem =>
    ({
      id,
      name: `Item ${id}`,
      brand: "",
      category: "flower",
      priceMinorUnits: 2000,
      variants: [],
      ...over,
    }) as unknown as GreenwayMenuItem;

  const seeds = seedRuleSnapshots();
  const rulesFor = (weekday: StoreWeekday) => activeSnapshotsFor(seeds, weekday);

  const flower = mk("f1", { category: "flower" });
  const edible = mk("e1", { category: "edible-solid" });
  const drink = mk("d1", { category: "edible-liquid" });
  const preroll = mk("p1", { category: "preroll" });
  const infusedBlunt = mk("ib1", { category: "infused-blunt" });
  const cart = mk("c1", { category: "cartridge" });
  const topical = mk("t1", { category: "topical" });
  const merch = mk("m1", { category: "merch" });
  const lifted = mk("b1", { category: "flower", brand: "Lifted" });

  // Hydration guard: unresolved weekday or rules -> no badge (SSG-safe).
  ok(menuCardBadgeForItem(flower, undefined, "friday") === undefined, "no rules -> undefined");
  ok(menuCardBadgeForItem(flower, rulesFor("friday"), undefined) === undefined, "no weekday -> undefined");
  ok(menuCardBadgeForItem(flower, [], "friday") === undefined, "empty rules -> undefined");

  // MONDAY — Michael: "show it on edibles and liquids".
  const mon = rulesFor("monday");
  ok(menuCardBadgeForItem(edible, mon, "monday") === "Munchie Monday \u00b7 25% off", "Monday edible badge");
  ok(menuCardBadgeForItem(drink, mon, "monday") === "Munchie Monday \u00b7 25% off", "Monday drink badge");
  ok(menuCardBadgeForItem(flower, mon, "monday") === undefined, "Monday flower has no badge");

  // TUESDAY — Michael: "prerolls and blunts, including infused" — the exact
  // badge he saw on the rail card.
  const tue = rulesFor("tuesday");
  ok(
    menuCardBadgeForItem(preroll, tue, "tuesday") ===
      "Doobie Tuesday \u00b7 20% off \u00b7 or 4 for 3 (25%)",
    "Tuesday preroll badge matches the one Michael saw",
  );
  ok(
    menuCardBadgeForItem(infusedBlunt, tue, "tuesday") ===
      "Doobie Tuesday \u00b7 20% off \u00b7 or 4 for 3 (25%)",
    "Tuesday infused blunt badge",
  );
  ok(menuCardBadgeForItem(edible, tue, "tuesday") === undefined, "Tuesday edible has no badge");

  // WEDNESDAY — carts/concentrates (Michael's "etc." — rules-driven).
  ok(
    menuCardBadgeForItem(cart, rulesFor("wednesday"), "wednesday") === "Wax Wednesday \u00b7 20% off \u00b7 30% at $150+",
    "Wednesday cartridge badge",
  );

  // THURSDAY — Michael: "all the items in the brand we put on sale".
  const thu = rulesFor("thursday");
  ok(menuCardBadgeForItem(lifted, thu, "thursday") === "Top Shelf Thursday \u00b7 25% off", "Thursday featured-brand badge");
  ok(menuCardBadgeForItem(flower, thu, "thursday") === undefined, "Thursday non-featured item has no badge");

  // FRIDAY — Michael: "on all flower". Badge shows even though SLICE 40 hides
  // the struck price (badge and price are now independent).
  const fri = rulesFor("friday");
  ok(
    menuCardBadgeForItem(flower, fri, "friday") === "Ounce Friday \u00b7 up to 30% by the ounce",
    "Friday flower badge",
  );
  ok(menuCardBadgeForItem(edible, fri, "friday") === undefined, "Friday edible has no badge");
  ok(menuCardDiscountForItem(flower, fri, "friday") === undefined, "SLICE 40 intact: Friday struck price still hidden");

  // SATURDAY — Michael: "shown on all the product cards" (storewide).
  const sat = rulesFor("saturday");
  ok(
    menuCardBadgeForItem(topical, sat, "saturday") === "Super Saturday \u00b7 30% one item + 15% storewide",
    "Saturday storewide badge reaches every cannabis card",
  );
  ok(menuCardBadgeForItem(merch, sat, "saturday") === undefined, "storewide never badges merch");
  ok(menuCardDiscountForItem(topical, sat, "saturday") === undefined, "SLICE 40 intact: Saturday struck price still hidden");

  // SUNDAY — the match-based fallback (3-for-2 has an honest 0% headline, so
  // there is no percent deal — the badge must still show on ALL cards).
  const sun = rulesFor("sunday");
  ok(menuDiscountForItem(topical, sun) === undefined, "Sunday has no percent-bearing deal (honest 0% headline)");
  ok(
    menuCardBadgeForItem(topical, sun, "sunday") === "Ice Cream Sunday \u00b7 3-for-2 equivalent savings",
    "Sunday fallback badge on every cannabis card",
  );
  ok(
    menuCardBadgeForItem(flower, sun, "sunday") === "Ice Cream Sunday \u00b7 3-for-2 equivalent savings",
    "Sunday badge on flower too",
  );
  ok(menuCardBadgeForItem(merch, sun, "sunday") === undefined, "Sunday storewide never badges merch");

  // FLASH SALE — a date-window (non-weekday) published rule badges its
  // targets every day inside the window ("any promotion, any deal or flash
  // sale, etc.").
  const flash: PublishedRuleSnapshot = {
    id: "db-flash-1",
    promoKey: null,
    title: "Flash Sale",
    description: "",
    discountType: "percent",
    discountPercent: 40,
    discountFixed: 0,
    perItemSale: true,
    bonusNote: null,
    weekday: null,
    startsAt: null,
    endsAt: null,
    priority: 50,
    storewide: false,
    targetCategories: ["topical"],
    targetBrands: [],
    targetProductKeys: [],
    excludeCategories: [],
    excludeBrands: [],
    excludeProductKeys: [],
    config: {},
  };
  const friPlusFlash = activeSnapshotsFor([...seeds, flash], "friday");
  ok(
    menuCardBadgeForItem(topical, friPlusFlash, "friday") === "Flash Sale \u00b7 40% off",
    "flash-sale rule badges its targets (rules-driven, no code change)",
  );
  // Best percent wins when two rules match the same item (flash 40% beats
  // Ounce Friday's 30% headline on a flower-targeted flash).
  const flowerFlash = { ...flash, id: "db-flash-2", targetCategories: ["flower"] };
  ok(
    menuCardBadgeForItem(flower, activeSnapshotsFor([...seeds, flowerFlash], "friday"), "friday") ===
      "Flash Sale \u00b7 40% off",
    "best percent-bearing deal wins the badge",
  );

  // Fallback priority: two matching 0%-headline rules -> highest priority wins.
  const basketA: PublishedRuleSnapshot = {
    ...flash,
    id: "db-basket-a",
    title: "Bundle A",
    discountType: "basket",
    discountPercent: 0,
    perItemSale: false,
    bonusNote: "mix and match",
    priority: 10,
    storewide: true,
    targetCategories: [],
  };
  const basketB: PublishedRuleSnapshot = { ...basketA, id: "db-basket-b", title: "Bundle B", bonusNote: null, priority: 20 };
  ok(
    menuCardBadgeForItem(flower, [basketA, basketB], "sunday") === "Bundle B",
    "fallback picks the highest-priority matching rule (title alone when no note)",
  );
  ok(
    menuCardBadgeForItem(flower, [basketA], "sunday") === "Bundle A \u00b7 mix and match",
    "fallback badge is title \u00b7 bonusNote when a note exists",
  );

  console.log(`deal-badge-core self-tests: ${passed} passed`);
}
