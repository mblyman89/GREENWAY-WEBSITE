/**
 * src/lib/leafly/picker-view-core.ts  (SLICE L-19)
 *
 * The pure view logic behind the Leafly item picker: which quick-start is
 * currently in effect, which rows the table should show, and what exactly is
 * about to be transmitted.
 *
 * WHY THIS EXISTS AT ALL. The owner made his first real transmission with the
 * picker and reported three things: the quick-start pills never lit up, the
 * table never narrowed to the eight products the sampler had chosen, and it was
 * not possible to tell what was actually going to be sent. All three were true,
 * and all three came from the same root: the picker had selection state but no
 * *view* state, and no notion of "what does the current filter correspond to".
 *
 * THE DESIGN DECISION THAT MATTERS. The active quick-start is DERIVED from the
 * filter values, not remembered when a pill is clicked.
 *
 * Remembering is the obvious implementation and it is wrong. If you store
 * `activePreset = "with-photos"` on click, then the operator changes the
 * category dropdown by hand, the pill keeps glowing and now asserts something
 * false -- that the visible rows are "Has a real photo" when they are "Has a
 * real photo, edibles only". A highlight that can lie about the filter is worse
 * than no highlight, because the whole point of lighting it up is to answer
 * "what am I looking at?" without reading twelve controls.
 *
 * Deriving makes the lie impossible by construction. The pill is lit if and
 * only if the twelve filter values equal what that preset sets, so editing any
 * one of them un-lights it with no event handler, no bookkeeping, and no way
 * for a future contributor to add a thirteenth filter and forget to clear the
 * highlight. The cost is one comparison per render over a seven-element list.
 *
 * THE SECOND TRAP, which is the one that actually bit him. "Suggest a sample"
 * on the toolbar samples the WHOLE feed, on purpose -- it answers "give me a
 * good first push", not "give me a sample of what I am squinting at". So the
 * ids it returns are frequently NOT in the currently filtered rows. A naive
 * "show only selected" view would therefore filter 2,555 rows down to however
 * many of the eight happened to survive the filter -- sometimes three, once
 * none -- and the operator would conclude the sampler was broken.
 *
 * So `computeSelectionVisibility` reports the hidden ones as a first-class
 * number rather than letting them silently vanish. The UI can then say "5 of
 * your 8 are hidden by the current filters" and offer to clear them. An
 * invisible selected item is the single most dangerous state this screen can be
 * in: it is a product that WILL be transmitted and CANNOT be reviewed.
 *
 * Pure: no React, no DOM, no I/O. Self-tested at the bottom and registered in
 * scripts/compliance/run-pure-selftests.ts with an assertion floor.
 */

import type {
  SelectionPreset,
  SelectionSort,
  StockFilter,
  TriState,
} from "./selection-core";

// ---------------------------------------------------------------------------
// Filter state
// ---------------------------------------------------------------------------

/**
 * Exactly the twelve filter controls the picker renders, plus the sort.
 *
 * This mirrors the component's `useState` values as a single object so that
 * "what does this preset mean" and "what is on screen right now" are the same
 * type and can be compared. Keeping them as twelve loose variables is what made
 * the comparison unwriteable before.
 *
 * The numeric boxes are `string` rather than `number` deliberately: they hold
 * whatever the operator typed, including "" and mid-edit junk like "3.". The
 * spec builder is responsible for turning those into numbers; the view layer's
 * job is only to know whether the box matches the preset's, and a half-typed
 * "1" must not compare equal to an empty box.
 */
export type PickerFilterState = {
  search: string;
  category: string;
  brand: string;
  strainType: string;
  stock: StockFilter;
  hasImage: TriState;
  hasDescription: TriState;
  hasMultipleVariants: TriState;
  isDohRestricted: TriState;
  priceMin: string;
  priceMax: string;
  thcMin: string;
  thcMax: string;
  sort: SelectionSort;
};

/**
 * The state produced by "Clear filters".
 *
 * Exported so the component can apply it rather than re-listing thirteen
 * setters, which is how the cleared state and the "is it cleared?" test drift
 * apart. Note `stock: "any"`, NOT `"in-stock"`: clearing filters means clearing
 * them, even though the screen opens on in-stock as a sensible default.
 */
export const CLEARED_PICKER_FILTER_STATE: PickerFilterState = {
  search: "",
  category: "",
  brand: "",
  strainType: "",
  stock: "any",
  hasImage: "any",
  hasDescription: "any",
  hasMultipleVariants: "any",
  isDohRestricted: "any",
  priceMin: "",
  priceMax: "",
  thcMin: "",
  thcMax: "",
  sort: "relevance",
};

/**
 * What the picker's controls look like after a preset is applied.
 *
 * This is the single definition of "applying a preset". The component calls it
 * and assigns the result; it does not re-derive the mapping inline. If those
 * two were separate implementations, a preset could apply one thing and light
 * up based on another -- which is precisely the failure mode this module is
 * meant to eliminate.
 *
 * Fields a preset does not mention are RESET, not left alone. A quick start is
 * a starting point, and a starting point that silently inherits the previous
 * brand filter is not one.
 */
export function presetFilterState(preset: SelectionPreset): PickerFilterState {
  return {
    search: preset.spec.search ?? "",
    category: preset.spec.categories?.[0] ?? "",
    brand: preset.spec.brands?.[0] ?? "",
    strainType: preset.spec.strainTypes?.[0] ?? "",
    stock: preset.spec.stock ?? "any",
    hasImage: preset.spec.hasImage ?? "any",
    hasDescription: preset.spec.hasDescription ?? "any",
    hasMultipleVariants: preset.spec.hasMultipleVariants ?? "any",
    isDohRestricted: preset.spec.isDohRestricted ?? "any",
    priceMin: "",
    priceMax: "",
    thcMin: "",
    thcMax: "",
    sort: preset.sort,
  };
}

/**
 * Field-by-field equality over the whole filter state.
 *
 * Written as an explicit key list rather than JSON.stringify because
 * stringify's answer depends on key insertion order, and two states built by
 * different code paths (one from `presetFilterState`, one accumulated by
 * thirteen setters) have no guarantee of matching order. A highlight that
 * depends on property ordering would work in every test and fail in the
 * browser.
 */
export function filterStatesEqual(
  a: PickerFilterState,
  b: PickerFilterState,
): boolean {
  return (
    a.search === b.search &&
    a.category === b.category &&
    a.brand === b.brand &&
    a.strainType === b.strainType &&
    a.stock === b.stock &&
    a.hasImage === b.hasImage &&
    a.hasDescription === b.hasDescription &&
    a.hasMultipleVariants === b.hasMultipleVariants &&
    a.isDohRestricted === b.isDohRestricted &&
    a.priceMin === b.priceMin &&
    a.priceMax === b.priceMax &&
    a.thcMin === b.thcMin &&
    a.thcMax === b.thcMax &&
    a.sort === b.sort
  );
}

/**
 * Which quick start, if any, the current filters correspond to.
 *
 * Returns the FIRST match in preset order. Two presets can legitimately share a
 * spec and differ only by sort -- "First-push sample" and "Everything in stock"
 * both filter to in-stock and differ solely in ordering -- so the sort is part
 * of the comparison and the ambiguity resolves itself. Were sort excluded, both
 * pills would light at once and the operator would learn to distrust them.
 *
 * Returns null when the filters match nothing, which is the normal state after
 * any hand edit. Null is not an error; it means "this is a custom view", and
 * the UI says so.
 */
export function matchActivePresetId(
  state: PickerFilterState,
  presets: readonly SelectionPreset[],
): string | null {
  for (const preset of presets) {
    if (filterStatesEqual(state, presetFilterState(preset))) return preset.id;
  }
  return null;
}

/** True when the filters are in the state "Clear filters" produces. */
export function isClearedFilterState(state: PickerFilterState): boolean {
  return filterStatesEqual(state, CLEARED_PICKER_FILTER_STATE);
}

/**
 * How many filter controls are away from their neutral value.
 *
 * Used to label the "Clear filters" control with a count, so the operator can
 * see at a glance that something is narrowing the list even when the offending
 * control has scrolled out of view. Sort is excluded: re-ordering a list is not
 * filtering it, and counting it would mean the screen claims a filter is active
 * the moment somebody sorts by price.
 */
export function countActiveFilters(state: PickerFilterState): number {
  let n = 0;
  if (state.search.trim() !== "") n += 1;
  if (state.category !== "") n += 1;
  if (state.brand !== "") n += 1;
  if (state.strainType !== "") n += 1;
  if (state.stock !== "any") n += 1;
  if (state.hasImage !== "any") n += 1;
  if (state.hasDescription !== "any") n += 1;
  if (state.hasMultipleVariants !== "any") n += 1;
  if (state.isDohRestricted !== "any") n += 1;
  if (state.priceMin.trim() !== "") n += 1;
  if (state.priceMax.trim() !== "") n += 1;
  if (state.thcMin.trim() !== "") n += 1;
  if (state.thcMax.trim() !== "") n += 1;
  return n;
}

// ---------------------------------------------------------------------------
// Which rows to show
// ---------------------------------------------------------------------------

/** The two table modes: everything matching the filters, or only the picks. */
export type PickerView = "all" | "selected";

/** The minimum a row must have for this module to reason about it. */
export type RowLike = { id: string };

/**
 * The rows the table should render.
 *
 * In "selected" mode this returns the selected rows IN THE ORDER THEY APPEAR in
 * the matched list, not in selection order. The operator is reviewing a list he
 * sorted by category or price; re-ordering it by the accident of which checkbox
 * he ticked first would make the review harder, and review is the entire point
 * of the mode.
 */
export function visibleRows<T extends RowLike>(
  rows: readonly T[],
  selectedIds: ReadonlySet<string>,
  view: PickerView,
): T[] {
  if (view === "all") return rows.slice();
  return rows.filter((row) => selectedIds.has(row.id));
}

/**
 * Where the selected items are relative to what is on screen.
 *
 * `hidden` is the number that matters. It is the count of products that will be
 * transmitted and are not currently reviewable, which happens routinely because
 * the toolbar's "Suggest a sample" draws from the whole feed while the table
 * shows a filtered slice.
 */
export type SelectionVisibility = {
  /** Total selected, visible or not. */
  total: number;
  /** Selected and present in the current rows. */
  visible: number;
  /** Selected but NOT present in the current rows. */
  hidden: number;
  /** The ids of the hidden ones, so the UI can offer to reveal them. */
  hiddenIds: string[];
};

/**
 * Split the selection into what the operator can see and what he cannot.
 *
 * Tolerates duplicate ids in `rows` (a feed with a repeated id is a data bug,
 * but it must not make this function double-count and report more visible items
 * than exist) by resolving through a Set.
 */
export function computeSelectionVisibility(
  rows: readonly RowLike[],
  selectedIds: ReadonlySet<string>,
): SelectionVisibility {
  const present = new Set<string>();
  for (const row of rows) present.add(row.id);

  const hiddenIds: string[] = [];
  let visible = 0;
  for (const id of selectedIds) {
    if (present.has(id)) visible += 1;
    else hiddenIds.push(id);
  }

  return {
    total: selectedIds.size,
    visible,
    hidden: hiddenIds.length,
    hiddenIds,
  };
}

/**
 * A plain-English sentence about hidden selections, or null when there is
 * nothing to say.
 *
 * Returning null in the healthy case is deliberate and is the property the
 * self-tests pin hardest. A banner that renders on every load teaches the
 * operator to scroll past it, and then it is not there when it matters. This
 * one appears only when a product is genuinely about to be sent unseen.
 */
export function describeHiddenSelection(
  visibility: SelectionVisibility,
): string | null {
  if (visibility.hidden === 0) return null;
  const n = visibility.hidden;
  // The noun agrees with the TOTAL it modifies ("1 of the 2 products"), while
  // the verb agrees with the hidden count ("1 ... is hidden"). Getting these
  // from the same number produces "1 of the 2 product", which reads like a bug
  // report about the sentence rather than about the menu.
  const noun = visibility.total === 1 ? "product" : "products";
  const verb = n === 1 ? "is" : "are";

  // "1 of the 1 product" is grammatical and reads like a machine wrote it. When
  // every selected item is hidden -- which is the common case, because the
  // toolbar sampler draws from the whole feed while the table shows a filtered
  // slice -- say so directly instead.
  const subject =
    n === visibility.total
      ? n === 1
        ? "The product you have selected"
        : `All ${n} ${noun} you have selected`
      : `${n} of the ${visibility.total} ${noun} you have selected`;

  return (
    `${subject} ${verb} hidden by the filters above, so ` +
    `${n === 1 ? "it is" : "they are"} not in the table right now. ` +
    `${n === 1 ? "It" : "They"} would still be sent. Clear the filters to see ` +
    `${n === 1 ? "it" : "them"}.`
  );
}

// ---------------------------------------------------------------------------
// What is about to be sent
// ---------------------------------------------------------------------------

/** One line of the manifest: enough to recognise a product without the table. */
export type ManifestRow = {
  id: string;
  name: string;
  category: string;
  priceMinorUnits: number;
};

/** A row carrying the fields the manifest displays. */
export type ManifestSource = RowLike & {
  name: string;
  category: string;
  priceMinorUnits: number;
};

/**
 * A reviewable list of what the current selection will transmit.
 *
 * `unknownIds` exists because the manifest can only describe products that are
 * in the rows currently loaded from the server, and the selection deliberately
 * survives filter changes. Rather than quietly omit those -- producing a
 * manifest that says "6 items" next to a button that says "Send these 8" -- the
 * count and the descriptions are reported separately and the UI reconciles them
 * out loud.
 */
export type SendManifest = {
  /** Everything selected, described or not. */
  totalSelected: number;
  /** The selected rows this manifest could describe, in row order. */
  rows: ManifestRow[];
  /** Selected ids not present in the loaded rows, so they cannot be described. */
  unknownIds: string[];
  /** Category → count, over the describable rows only. */
  byCategory: { category: string; count: number }[];
  /** Sum of the describable rows' base prices, in minor units. */
  totalPriceMinorUnits: number;
};

/**
 * Build the manifest for a selection.
 *
 * Categories are counted case-insensitively but reported using the first
 * spelling encountered, so a feed carrying both "Flower" and "flower" produces
 * one line rather than two. Splitting them would suggest a coverage spread the
 * push does not actually have.
 */
export function buildSendManifest(
  rows: readonly ManifestSource[],
  selectedIds: ReadonlySet<string>,
): SendManifest {
  const out: ManifestRow[] = [];
  const seen = new Set<string>();
  const categoryCounts = new Map<string, { category: string; count: number }>();
  let totalPriceMinorUnits = 0;

  for (const row of rows) {
    if (!selectedIds.has(row.id)) continue;
    if (seen.has(row.id)) continue;
    seen.add(row.id);

    out.push({
      id: row.id,
      name: row.name,
      category: row.category,
      priceMinorUnits: row.priceMinorUnits,
    });
    totalPriceMinorUnits += row.priceMinorUnits;

    const key = row.category.trim().toLowerCase();
    const existing = categoryCounts.get(key);
    if (existing) existing.count += 1;
    else categoryCounts.set(key, { category: row.category, count: 1 });
  }

  const unknownIds: string[] = [];
  for (const id of selectedIds) {
    if (!seen.has(id)) unknownIds.push(id);
  }

  const byCategory = Array.from(categoryCounts.values()).sort(
    (a, b) => b.count - a.count || a.category.localeCompare(b.category),
  );

  return {
    totalSelected: selectedIds.size,
    rows: out,
    unknownIds,
    byCategory,
    totalPriceMinorUnits,
  };
}

/**
 * One sentence naming what is about to go, for the line directly above the
 * send button.
 *
 * Deliberately leads with the number of PRODUCTS rather than the number of
 * categories or the total value, because that is the number the operator is
 * asked to confirm and the one that appears in the read-back afterwards.
 */
export function describeSendManifest(manifest: SendManifest): string {
  if (manifest.totalSelected === 0) {
    return "Nothing is selected yet, so there is nothing to send.";
  }
  const noun = manifest.totalSelected === 1 ? "product" : "products";
  const spread =
    manifest.byCategory.length > 0
      ? ` across ${manifest.byCategory.length} ${
          manifest.byCategory.length === 1 ? "category" : "categories"
        } (${manifest.byCategory.map((c) => `${c.category} ×${c.count}`).join(", ")})`
      : "";
  const caveat =
    manifest.unknownIds.length > 0
      ? ` ${manifest.unknownIds.length} of them cannot be shown under the current filters.`
      : "";
  return `This will send ${manifest.totalSelected} ${noun}${spread}.${caveat}`;
}

// ---------------------------------------------------------------------------
// Self-tests (pure; run by the compliance suite)
// ---------------------------------------------------------------------------

function fakePreset(over: Partial<SelectionPreset> & { id: string }): SelectionPreset {
  return {
    id: over.id,
    label: over.label ?? over.id,
    description: over.description ?? "A preset used by the self-tests.",
    spec: over.spec ?? {},
    sort: over.sort ?? "name",
  };
}

function srcRow(
  id: string,
  name: string,
  category: string,
  priceMinorUnits: number,
): ManifestSource {
  return { id, name, category, priceMinorUnits };
}

export function __runLeaflyPickerViewTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const check = (label: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`  [leafly-picker-view-core] FAIL: ${label}`);
    }
  };

  // ---- CLEARED_PICKER_FILTER_STATE ----
  check("cleared state has no search", CLEARED_PICKER_FILTER_STATE.search === "");
  check("cleared state stock is any", CLEARED_PICKER_FILTER_STATE.stock === "any");
  check(
    "cleared state sort is relevance",
    CLEARED_PICKER_FILTER_STATE.sort === "relevance",
  );
  check("cleared state is recognised as cleared", isClearedFilterState(CLEARED_PICKER_FILTER_STATE));
  check("cleared state has zero active filters", countActiveFilters(CLEARED_PICKER_FILTER_STATE) === 0);

  // ---- presetFilterState ----
  const inStockPreset = fakePreset({ id: "p1", spec: { stock: "in-stock" }, sort: "category" });
  const s1 = presetFilterState(inStockPreset);
  check("preset stock is carried through", s1.stock === "in-stock");
  check("preset sort is carried through", s1.sort === "category");
  check("unmentioned tri-state defaults to any", s1.hasImage === "any");
  check("unmentioned search defaults to empty", s1.search === "");
  check("price boxes are always reset by a preset", s1.priceMin === "" && s1.priceMax === "");
  check("thc boxes are always reset by a preset", s1.thcMin === "" && s1.thcMax === "");

  const richPreset = fakePreset({
    id: "p2",
    spec: {
      search: "gummy",
      categories: ["edible"],
      brands: ["Acme"],
      strainTypes: ["hybrid"],
      stock: "in-stock",
      hasImage: "yes",
      hasDescription: "no",
      hasMultipleVariants: "yes",
      isDohRestricted: "no",
    },
    sort: "price-asc",
  });
  const s2 = presetFilterState(richPreset);
  check("preset search maps", s2.search === "gummy");
  check("preset first category maps", s2.category === "edible");
  check("preset first brand maps", s2.brand === "Acme");
  check("preset first strain type maps", s2.strainType === "hybrid");
  check("preset hasImage maps", s2.hasImage === "yes");
  check("preset hasDescription maps", s2.hasDescription === "no");
  check("preset hasMultipleVariants maps", s2.hasMultipleVariants === "yes");
  check("preset isDohRestricted maps", s2.isDohRestricted === "no");

  // Only the FIRST entry of each list is representable by the single-select UI.
  const multiPreset = fakePreset({
    id: "p3",
    spec: { categories: ["flower", "edible"] },
  });
  check(
    "only the first category is taken (the control is single-select)",
    presetFilterState(multiPreset).category === "flower",
  );

  // ---- filterStatesEqual ----
  check("a state equals itself", filterStatesEqual(s2, s2));
  check("a rebuilt state equals the original", filterStatesEqual(s2, presetFilterState(richPreset)));
  check(
    "differing search breaks equality",
    !filterStatesEqual(s2, { ...s2, search: "gummies" }),
  );
  check("differing sort breaks equality", !filterStatesEqual(s2, { ...s2, sort: "name" }));
  check("differing stock breaks equality", !filterStatesEqual(s2, { ...s2, stock: "any" }));
  check("differing priceMin breaks equality", !filterStatesEqual(s2, { ...s2, priceMin: "5" }));
  check("differing thcMax breaks equality", !filterStatesEqual(s2, { ...s2, thcMax: "30" }));
  check("differing category breaks equality", !filterStatesEqual(s2, { ...s2, category: "flower" }));
  check("differing brand breaks equality", !filterStatesEqual(s2, { ...s2, brand: "Other" }));
  check(
    "differing strainType breaks equality",
    !filterStatesEqual(s2, { ...s2, strainType: "indica" }),
  );
  check("differing hasImage breaks equality", !filterStatesEqual(s2, { ...s2, hasImage: "no" }));
  check(
    "differing hasDescription breaks equality",
    !filterStatesEqual(s2, { ...s2, hasDescription: "yes" }),
  );
  check(
    "differing hasMultipleVariants breaks equality",
    !filterStatesEqual(s2, { ...s2, hasMultipleVariants: "no" }),
  );
  check(
    "differing isDohRestricted breaks equality",
    !filterStatesEqual(s2, { ...s2, isDohRestricted: "yes" }),
  );
  check("differing priceMax breaks equality", !filterStatesEqual(s2, { ...s2, priceMax: "99" }));
  check("differing thcMin breaks equality", !filterStatesEqual(s2, { ...s2, thcMin: "1" }));

  // Every field must participate. This loop is the guard against somebody
  // adding a filter control and forgetting to add it to the comparison, which
  // would silently make the pill lie again.
  {
    const base = presetFilterState(richPreset);
    const mutations: PickerFilterState[] = [
      { ...base, search: `${base.search}x` },
      { ...base, category: `${base.category}x` },
      { ...base, brand: `${base.brand}x` },
      { ...base, strainType: `${base.strainType}x` },
      { ...base, stock: base.stock === "any" ? "in-stock" : "any" },
      { ...base, hasImage: base.hasImage === "any" ? "yes" : "any" },
      { ...base, hasDescription: base.hasDescription === "any" ? "yes" : "any" },
      { ...base, hasMultipleVariants: base.hasMultipleVariants === "any" ? "yes" : "any" },
      { ...base, isDohRestricted: base.isDohRestricted === "any" ? "yes" : "any" },
      { ...base, priceMin: "1" },
      { ...base, priceMax: "2" },
      { ...base, thcMin: "3" },
      { ...base, thcMax: "4" },
      { ...base, sort: base.sort === "name" ? "brand" : "name" },
    ];
    check("the mutation sweep covers all 14 fields", mutations.length === 14);
    check(
      "every single-field change breaks equality",
      mutations.every((m) => !filterStatesEqual(base, m)),
    );
  }

  // ---- matchActivePresetId ----
  const presets: SelectionPreset[] = [inStockPreset, richPreset];
  check(
    "a freshly applied preset is reported active",
    matchActivePresetId(presetFilterState(inStockPreset), presets) === "p1",
  );
  check(
    "the second preset is reported active when applied",
    matchActivePresetId(presetFilterState(richPreset), presets) === "p2",
  );
  check(
    "a hand edit un-lights the preset",
    matchActivePresetId({ ...presetFilterState(richPreset), brand: "Zeta" }, presets) === null,
  );
  check(
    "changing ONLY the sort un-lights the preset",
    matchActivePresetId({ ...presetFilterState(richPreset), sort: "thc-desc" }, presets) === null,
  );
  check(
    "an empty preset list matches nothing",
    matchActivePresetId(presetFilterState(richPreset), []) === null,
  );
  check(
    "the cleared state matches no preset here",
    matchActivePresetId(CLEARED_PICKER_FILTER_STATE, presets) === null,
  );

  // Two presets sharing a spec and differing only by sort must not both light.
  {
    const a = fakePreset({ id: "same-a", spec: { stock: "in-stock" }, sort: "category" });
    const b = fakePreset({ id: "same-b", spec: { stock: "in-stock" }, sort: "name" });
    const both = [a, b];
    check(
      "sort disambiguates presets with identical specs (a)",
      matchActivePresetId(presetFilterState(a), both) === "same-a",
    );
    check(
      "sort disambiguates presets with identical specs (b)",
      matchActivePresetId(presetFilterState(b), both) === "same-b",
    );
  }

  // A preset whose spec is empty is exactly the cleared state, and must light.
  {
    const emptyPreset = fakePreset({ id: "empty", spec: {}, sort: "relevance" });
    check(
      "an empty preset equals the cleared state",
      filterStatesEqual(presetFilterState(emptyPreset), CLEARED_PICKER_FILTER_STATE),
    );
    check(
      "the cleared state lights an empty preset",
      matchActivePresetId(CLEARED_PICKER_FILTER_STATE, [emptyPreset]) === "empty",
    );
  }

  // ---- countActiveFilters ----
  check(
    "one filter counts as one",
    countActiveFilters({ ...CLEARED_PICKER_FILTER_STATE, category: "flower" }) === 1,
  );
  check(
    "three filters count as three",
    countActiveFilters({
      ...CLEARED_PICKER_FILTER_STATE,
      category: "flower",
      stock: "in-stock",
      hasImage: "yes",
    }) === 3,
  );
  check(
    "sort is NOT counted as a filter",
    countActiveFilters({ ...CLEARED_PICKER_FILTER_STATE, sort: "price-desc" }) === 0,
  );
  check(
    "whitespace-only search is not an active filter",
    countActiveFilters({ ...CLEARED_PICKER_FILTER_STATE, search: "   " }) === 0,
  );
  check(
    "whitespace-only price box is not an active filter",
    countActiveFilters({ ...CLEARED_PICKER_FILTER_STATE, priceMin: "  " }) === 0,
  );
  check(
    "all thirteen can be active at once",
    countActiveFilters({
      search: "a",
      category: "b",
      brand: "c",
      strainType: "d",
      stock: "in-stock",
      hasImage: "yes",
      hasDescription: "yes",
      hasMultipleVariants: "yes",
      isDohRestricted: "yes",
      priceMin: "1",
      priceMax: "2",
      thcMin: "3",
      thcMax: "4",
      sort: "name",
    }) === 13,
  );

  // ---- visibleRows ----
  const rows: ManifestSource[] = [
    srcRow("a", "Alpha", "flower", 1000),
    srcRow("b", "Bravo", "edible", 2000),
    srcRow("c", "Charlie", "Flower", 3000),
    srcRow("d", "Delta", "concentrate", 4000),
  ];
  const sel = new Set(["b", "d"]);

  check("view=all returns every row", visibleRows(rows, sel, "all").length === 4);
  check(
    "view=all is a copy, not the same array",
    visibleRows(rows, sel, "all") !== (rows as unknown as ManifestSource[]),
  );
  check("view=selected returns only the picks", visibleRows(rows, sel, "selected").length === 2);
  check(
    "view=selected preserves row order, not selection order",
    visibleRows(rows, new Set(["d", "a"]), "selected")
      .map((r) => r.id)
      .join(",") === "a,d",
  );
  check(
    "view=selected with nothing selected is empty",
    visibleRows(rows, new Set<string>(), "selected").length === 0,
  );
  check(
    "view=all with nothing selected still returns everything",
    visibleRows(rows, new Set<string>(), "all").length === 4,
  );
  check(
    "selected ids absent from rows simply do not appear",
    visibleRows(rows, new Set(["zzz"]), "selected").length === 0,
  );

  // ---- computeSelectionVisibility ----
  {
    const v = computeSelectionVisibility(rows, new Set(["a", "b"]));
    check("all-visible: total is 2", v.total === 2);
    check("all-visible: visible is 2", v.visible === 2);
    check("all-visible: hidden is 0", v.hidden === 0);
    check("all-visible: no hidden ids", v.hiddenIds.length === 0);
  }
  {
    const v = computeSelectionVisibility(rows, new Set(["a", "zzz", "yyy"]));
    check("partly-hidden: total is 3", v.total === 3);
    check("partly-hidden: visible is 1", v.visible === 1);
    check("partly-hidden: hidden is 2", v.hidden === 2);
    check(
      "partly-hidden: the hidden ids are named",
      v.hiddenIds.slice().sort().join(",") === "yyy,zzz",
    );
  }
  {
    const v = computeSelectionVisibility([], new Set(["a", "b"]));
    check("empty table: everything selected is hidden", v.hidden === 2 && v.visible === 0);
  }
  {
    const v = computeSelectionVisibility(rows, new Set<string>());
    check("nothing selected: all counts are zero", v.total === 0 && v.visible === 0 && v.hidden === 0);
  }
  {
    // A duplicated id in the feed must not inflate the visible count.
    const dup = [srcRow("a", "Alpha", "flower", 1000), srcRow("a", "Alpha again", "flower", 1000)];
    const v = computeSelectionVisibility(dup, new Set(["a"]));
    check("duplicate row ids do not double-count", v.visible === 1 && v.total === 1);
  }
  check(
    "visible + hidden always equals total",
    (() => {
      const cases: ReadonlySet<string>[] = [
        new Set<string>(),
        new Set(["a"]),
        new Set(["a", "zzz"]),
        new Set(["zzz", "yyy"]),
        new Set(["a", "b", "c", "d"]),
      ];
      return cases.every((s) => {
        const v = computeSelectionVisibility(rows, s);
        return v.visible + v.hidden === v.total;
      });
    })(),
  );

  // ---- describeHiddenSelection (negative control first) ----
  check(
    "NEGATIVE CONTROL: says nothing when nothing is hidden",
    describeHiddenSelection(computeSelectionVisibility(rows, new Set(["a", "b"]))) === null,
  );
  check(
    "NEGATIVE CONTROL: says nothing when nothing is selected",
    describeHiddenSelection(computeSelectionVisibility(rows, new Set<string>())) === null,
  );
  {
    const msg = describeHiddenSelection(computeSelectionVisibility(rows, new Set(["a", "zzz"])));
    check("warns when one is hidden", msg !== null);
    check("the warning names the hidden count", (msg ?? "").includes("1 of the 2"));
    // The noun tracks the total (2 → "products"), the verb tracks the hidden
    // count (1 → "is"). "1 of the 2 products ... is hidden" is the correct
    // reading; "1 of the 2 product" is not.
    check(
      "the warning uses singular grammar for one hidden item",
      (msg ?? "").includes("is hidden by the"),
    );
    check(
      "the warning pluralises the noun against the total, not the hidden count",
      (msg ?? "").includes("of the 2 products"),
    );
    check("the warning refers to it in the singular", (msg ?? "").includes("It would still be sent"));
    check(
      "the warning says it would still be sent",
      (msg ?? "").toLowerCase().includes("would still be sent"),
    );
    check("the warning tells the operator what to do", (msg ?? "").includes("Clear the filters"));
  }
  {
    // ALL of the selection is hidden here, so the "N of the M" form would read
    // "2 of the 2 products". The all-hidden phrasing is used instead.
    const msg = describeHiddenSelection(computeSelectionVisibility(rows, new Set(["zzz", "yyy"])));
    check("the warning uses plural grammar for two", (msg ?? "").includes("are hidden by the"));
    check("all-hidden says so plainly", (msg ?? "").startsWith("All 2 products"));
    check("NEGATIVE CONTROL: all-hidden avoids the 'N of the N' form", !(msg ?? "").includes("2 of the 2"));
    check(
      "the warning refers to them in the plural",
      (msg ?? "").includes("They would still be sent"),
    );
  }
  {
    // Total of one, all hidden: must not say "1 of the 1 product".
    const msg = describeHiddenSelection(computeSelectionVisibility(rows, new Set(["zzz"])));
    check(
      "a lone hidden item is described without the 'N of the N' form",
      (msg ?? "").startsWith("The product you have selected is hidden"),
    );
    check("NEGATIVE CONTROL: no '1 of the 1'", !(msg ?? "").includes("1 of the 1"));
  }

  // ---- buildSendManifest ----
  {
    const m = buildSendManifest(rows, new Set(["a", "b", "c"]));
    check("manifest total counts the selection", m.totalSelected === 3);
    check("manifest describes three rows", m.rows.length === 3);
    check("manifest has no unknowns here", m.unknownIds.length === 0);
    check("manifest sums prices", m.totalPriceMinorUnits === 1000 + 2000 + 3000);
    check(
      "manifest folds case-variant categories together",
      m.byCategory.length === 2,
    );
    check(
      "manifest reports the largest category first",
      m.byCategory[0].count === 2 && m.byCategory[0].category.toLowerCase() === "flower",
    );
    check(
      "manifest keeps the first spelling of a folded category",
      m.byCategory[0].category === "flower",
    );
    check(
      "manifest rows carry the display fields",
      m.rows[0].name === "Alpha" && m.rows[0].priceMinorUnits === 1000,
    );
    check(
      "manifest rows follow row order",
      m.rows.map((r) => r.id).join(",") === "a,b,c",
    );
  }
  {
    const m = buildSendManifest(rows, new Set(["a", "nope"]));
    check("manifest counts undescribable ids in the total", m.totalSelected === 2);
    check("manifest describes only what it can", m.rows.length === 1);
    check("manifest names the undescribable id", m.unknownIds.join(",") === "nope");
  }
  {
    const m = buildSendManifest(rows, new Set<string>());
    check("empty manifest has no rows", m.rows.length === 0);
    check("empty manifest has zero total", m.totalSelected === 0);
    check("empty manifest has zero price", m.totalPriceMinorUnits === 0);
    check("empty manifest has no categories", m.byCategory.length === 0);
  }
  {
    const dup = [srcRow("a", "Alpha", "flower", 1000), srcRow("a", "Alpha", "flower", 1000)];
    const m = buildSendManifest(dup, new Set(["a"]));
    check("manifest does not duplicate a repeated row id", m.rows.length === 1);
    check("manifest does not double-count a repeated price", m.totalPriceMinorUnits === 1000);
  }
  check(
    "manifest rows + unknowns always equals the total",
    (() => {
      const cases: ReadonlySet<string>[] = [
        new Set<string>(),
        new Set(["a"]),
        new Set(["a", "nope"]),
        new Set(["nope", "nah"]),
        new Set(["a", "b", "c", "d"]),
      ];
      return cases.every((s) => {
        const m = buildSendManifest(rows, s);
        return m.rows.length + m.unknownIds.length === m.totalSelected;
      });
    })(),
  );

  // ---- describeSendManifest ----
  check(
    "empty selection is described as nothing to send",
    describeSendManifest(buildSendManifest(rows, new Set<string>())).includes("nothing to send"),
  );
  {
    const text = describeSendManifest(buildSendManifest(rows, new Set(["a", "b", "c"])));
    check("description leads with the product count", text.startsWith("This will send 3 products"));
    check("description names the categories", text.includes("flower ×2"));
    check("description counts the categories", text.includes("2 categories"));
    check(
      "NEGATIVE CONTROL: no caveat when everything is describable",
      !text.includes("cannot be shown"),
    );
  }
  {
    const text = describeSendManifest(buildSendManifest(rows, new Set(["a", "nope"])));
    check("description warns about undescribable items", text.includes("cannot be shown"));
    check("description still reports the true total", text.startsWith("This will send 2 products"));
  }
  {
    const text = describeSendManifest(buildSendManifest(rows, new Set(["a"])));
    check("singular grammar for one product", text.startsWith("This will send 1 product "));
    check("singular grammar for one category", text.includes("1 category"));
  }

  console.log(`leafly picker-view-core self-tests: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
