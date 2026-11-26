/**
 * OI-ACC S1 - which non-cannabis collections the shop grid shows for a set
 * of ticked categories. Pure; tested by __runMenuCollectionsTests.
 *
 * Owner (verbatim): "when I check greenway merch's box, it shows the merch
 * product cards as it should. but if I add another type, the merch product
 * cards disappear." Root cause: the merch adverts only rendered when "merch"
 * was the ONLY selection; accessories already had a "bottom" mode for mixed
 * selections and merch did not. Merch now gets the same bottom mode.
 */

export interface CollectionsInput {
  selectedCategories: readonly string[];
  hasMerchCards: boolean;
  hasAccessoryCards: boolean;
  /** Search / strain / brand / price ... narrowing filters. */
  hasOtherFiltersActive: boolean;
  /** Cannabis products left after filtering. */
  filteredCount: number;
}

export interface CollectionsView {
  showAccessorySections: boolean;
  showMerchAds: boolean;
  showAccessoryBottom: boolean;
  showMerchAdsBottom: boolean;
  showEmptyState: boolean;
}

export function decideCollections(i: CollectionsInput): CollectionsView {
  const sel = i.selectedCategories;
  const only = (c: string) => sel.length === 1 && sel[0] === c;
  const withOthers = (c: string) => sel.includes(c) && sel.length > 1;
  const showAccessorySections = i.hasAccessoryCards && only("accessories");
  const showMerchAds = i.hasMerchCards && only("merch");
  const surface = !i.hasOtherFiltersActive;
  const showAccessoryBottom =
    i.hasAccessoryCards && surface && !showAccessorySections && (sel.length === 0 || withOthers("accessories"));
  // Merch adverts are a shortcut that appears only when merch is ticked (never
  // on the unfiltered list, R72 S5), so the bottom mode is "ticked with others".
  const showMerchAdsBottom = i.hasMerchCards && surface && withOthers("merch");
  const showEmptyState =
    !showAccessorySections && !showMerchAds && i.filteredCount === 0 && !showAccessoryBottom && !showMerchAdsBottom;
  return { showAccessorySections, showMerchAds, showAccessoryBottom, showMerchAdsBottom, showEmptyState };
}

export function __runMenuCollectionsTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`FAIL menu-collections-core: ${m}`);
    }
  };
  const base = { hasMerchCards: true, hasAccessoryCards: true, hasOtherFiltersActive: false, filteredCount: 5 };
  const a = decideCollections({ ...base, selectedCategories: ["merch"] });
  ok(a.showMerchAds && !a.showMerchAdsBottom, "merch alone -> ads");
  const b = decideCollections({ ...base, selectedCategories: ["merch", "flower"] });
  ok(!b.showMerchAds && b.showMerchAdsBottom, "merch + flower -> merch stays (bottom)");
  const c = decideCollections({ ...base, selectedCategories: ["merch", "edibles"], filteredCount: 0 });
  ok(c.showMerchAdsBottom && !c.showEmptyState, "merch + empty category -> no empty state");
  const d = decideCollections({ ...base, selectedCategories: ["merch", "accessories"] });
  ok(d.showMerchAdsBottom && d.showAccessoryBottom, "merch + accessories -> both");
  const e = decideCollections({ ...base, selectedCategories: [] });
  ok(e.showAccessoryBottom && !e.showMerchAdsBottom, "unfiltered -> accessories bottom only");
  const f = decideCollections({ ...base, selectedCategories: ["merch", "flower"], hasMerchCards: false });
  ok(!f.showMerchAdsBottom, "no merch cards -> nothing");
  const g = decideCollections({ ...base, selectedCategories: ["merch", "flower"], hasOtherFiltersActive: true });
  ok(!g.showMerchAdsBottom, "narrowing filter hides bottom collections");
  const h = decideCollections({ ...base, selectedCategories: ["flower"], filteredCount: 0 });
  ok(h.showEmptyState, "flower with nothing -> empty state");
  const k = decideCollections({ ...base, selectedCategories: ["accessories"] });
  ok(k.showAccessorySections && !k.showAccessoryBottom, "accessories alone -> sections");
  return { passed, failed };
}
