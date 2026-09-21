/**
 * MENU BROWSER -- see what is actually ON the Leafly menu, find it by name,
 * and select it for removal without ever typing an id.
 *
 * ###########################################################################
 * # THE OWNER'S WORDS (ask 6)                                               #
 * #                                                                        #
 * #   "there is no way to know what's on the menu so we can delete         #
 * #    something. we can push the read the menu back button, but it        #
 * #    doesn't really give very useful information. so we need a much      #
 * #    more powerful delete function with a much better ui for working     #
 * #    with the delete function. i do not know how this should be set up,  #
 * #    i do not know how to approach this issue. i want you, as the        #
 * #    expert and professional, to do the enterprise grade solution that   #
 * #    allows me to delete products in an easy, efficient, effective,      #
 * #    intelligent way."                                                   #
 * ###########################################################################
 *
 * WHAT WAS WRONG
 *
 * The read-back existed, but it reported a DIFF -- counts, mismatched
 * fields, items missing. That is the right tool for "did the push work" and
 * the wrong tool for "what is on my menu and which of it do I want gone".
 * Deletion then required typing raw ids into a textarea
 * (`leafly-client.tsx`), which for a 400-item menu is not a workflow; it is
 * a transcription exercise with a destructive button at the end.
 *
 * THE DESIGN, and why each decision is the way it is
 *
 *   1. SEARCH ACROSS EVERY HUMAN IDENTIFIER AT ONCE. The owner does not know
 *      whether he remembers the brand, the strain, the vendor or half the
 *      product name. One box that matches any of them is the only design
 *      that does not require him to guess which field he is remembering.
 *
 *   2. ALL TOKENS MUST MATCH (AND, not OR). On a 400-item menu, OR-matching
 *      "blue dream" returns every Blue anything and every Dream anything,
 *      which is worse than no search. AND-matching narrows.
 *
 *   3. THE SELECTION IS A SET OF IDS, BUT THE OWNER NEVER SEES ONE. Ids are
 *      carried invisibly so the delete call is exact; every surface he reads
 *      is a name.
 *
 *   4. SELECT-ALL MEANS ALL *FILTERED*, AND SAYS SO. The single most
 *      dangerous interaction in a delete UI is a select-all that silently
 *      includes rows scrolled out of view. `summarizeSelection` therefore
 *      always states the number and never lets the caller imply otherwise.
 *
 *   5. DELETION IS DESCRIBED BEFORE IT IS DONE, BY NAME. The confirmation
 *      lists what is about to disappear. "Delete 37 items?" is not informed
 *      consent; "Delete these 37, including Blue Dream 1g by Acme?" is.
 *
 * AUTHORITATIVE ANCHOR
 *   The shape browsed here is Leafly's READ-BACK contract,
 *   `docs/leafly-specs/schemas/v2-show.json` -- deliberately NOT the items
 *   POST contract. They are different documents and conflating them is a
 *   documented past defect: the read-back returns fields the write contract
 *   has no concept of, and vice versa.
 *
 * PURE: no React, no DOM, no I/O, no `server-only`. Zero imports. Runs under
 * the pure self-test runner in `scripts/compliance/run-pure-selftests.ts`.
 */

/* ========================================================================== */
/* Types                                                                      */
/* ========================================================================== */

/** One size, as Leafly currently holds it. */
export type MenuBrowserVariant = {
  id: string;
  /** Leafly's `packageSize` + `packageUnit`, pre-joined for display. */
  sizeLabel: string | null;
  priceMinorUnits: number | null;
  inventoryLevel: number | null;
};

/**
 * One product on the Leafly menu, joined to whatever we know about it
 * locally.
 *
 * `vendor` and `barcodes` are NOT on the Leafly menu -- Leafly's contract has
 * no such fields. They come from our own records, matched by id. They are
 * present because the owner asked to identify products by them, and absent
 * (null / empty) whenever the local join finds nothing. An empty barcode list
 * means "no lot recorded against this product", which is a different fact
 * from "this product has no barcode", and the wording downstream must not
 * conflate the two.
 */
export type MenuBrowserRow = {
  id: string;
  name: string | null;
  brand: string | null;
  strainName: string | null;
  type: string | null;
  vendor: string | null;
  barcodes: string[];
  hidden: boolean | null;
  variants: MenuBrowserVariant[];
  /** True when our published feed no longer contains this product. */
  orphaned: boolean;
};

export type MenuBrowserFilter = {
  /** Free text, matched across every human identifier. */
  query?: string | null;
  brand?: string | null;
  vendor?: string | null;
  type?: string | null;
  /** Only products Leafly holds that our feed no longer has. */
  orphanedOnly?: boolean;
  /** Only products Leafly is currently hiding. */
  hiddenOnly?: boolean;
};

export type MenuBrowserSort =
  | "name"
  | "brand"
  | "vendor"
  | "type"
  | "sizes";

export type MenuBrowserFacets = {
  brands: Array<{ value: string; count: number }>;
  vendors: Array<{ value: string; count: number }>;
  types: Array<{ value: string; count: number }>;
  orphanedCount: number;
  hiddenCount: number;
  total: number;
};

/* ========================================================================== */
/* Helpers                                                                    */
/* ========================================================================== */

const norm = (v: string | null | undefined): string =>
  String(v ?? "").trim().toLowerCase();

const clean = (v: string | null | undefined): string | null => {
  const s = String(v ?? "").trim();
  return s.length > 0 ? s : null;
};

/**
 * Every string by which a human might look for this product.
 *
 * Includes the id LAST and deliberately: somebody pasting an id from a log
 * should still find the row, even though no part of the UI asks for one.
 */
export function rowSearchTerms(row: MenuBrowserRow): string[] {
  const terms: string[] = [];
  const push = (v: string | null | undefined): void => {
    const s = norm(v);
    if (s.length > 0) terms.push(s);
  };
  push(row.name);
  push(row.brand);
  push(row.strainName);
  push(row.vendor);
  push(row.type);
  for (const b of row.barcodes) push(b);
  for (const v of row.variants) push(v.sizeLabel);
  push(row.id);
  return terms;
}

/**
 * Match a free-text query against a row.
 *
 * AND across whitespace-separated tokens (design rule 2); substring within a
 * token so partial recall still works ("drag" finds "Dragon Balm").
 */
export function rowMatchesQuery(row: MenuBrowserRow, query: string | null | undefined): boolean {
  const q = norm(query);
  if (q.length === 0) return true;
  const tokens = q.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return true;
  const hay = rowSearchTerms(row);
  return tokens.every((t) => hay.some((term) => term.includes(t)));
}

/* ========================================================================== */
/* Filtering and sorting                                                      */
/* ========================================================================== */

export function filterMenuRows(
  rows: readonly MenuBrowserRow[],
  filter: MenuBrowserFilter = {},
): MenuBrowserRow[] {
  const brand = norm(filter.brand);
  const vendor = norm(filter.vendor);
  const type = norm(filter.type);
  return (rows ?? []).filter((row) => {
    if (brand.length > 0 && norm(row.brand) !== brand) return false;
    if (vendor.length > 0 && norm(row.vendor) !== vendor) return false;
    if (type.length > 0 && norm(row.type) !== type) return false;
    if (filter.orphanedOnly === true && row.orphaned !== true) return false;
    if (filter.hiddenOnly === true && row.hidden !== true) return false;
    if (!rowMatchesQuery(row, filter.query)) return false;
    return true;
  });
}

export function sortMenuRows(
  rows: readonly MenuBrowserRow[],
  sort: MenuBrowserSort = "name",
): MenuBrowserRow[] {
  const out = [...(rows ?? [])];
  // Every comparator falls back to the id so the order is total and stable.
  // An unstable list under a destructive action is how the wrong row gets
  // clicked.
  const byId = (a: MenuBrowserRow, b: MenuBrowserRow): number =>
    String(a.id).localeCompare(String(b.id));
  const text = (v: string | null): string => {
    const s = norm(v);
    // Blanks sort last rather than first: an unnamed product at the top of
    // every list is noise, and there is nothing to read.
    return s.length > 0 ? s : "\uffff";
  };
  out.sort((a, b) => {
    let d = 0;
    if (sort === "name") d = text(a.name).localeCompare(text(b.name));
    else if (sort === "brand") d = text(a.brand).localeCompare(text(b.brand));
    else if (sort === "vendor") d = text(a.vendor).localeCompare(text(b.vendor));
    else if (sort === "type") d = text(a.type).localeCompare(text(b.type));
    else if (sort === "sizes") d = b.variants.length - a.variants.length;
    return d !== 0 ? d : byId(a, b);
  });
  return out;
}

export function computeMenuFacets(rows: readonly MenuBrowserRow[]): MenuBrowserFacets {
  const brands = new Map<string, number>();
  const vendors = new Map<string, number>();
  const types = new Map<string, number>();
  let orphanedCount = 0;
  let hiddenCount = 0;

  for (const row of rows ?? []) {
    const b = clean(row.brand);
    if (b !== null) brands.set(b, (brands.get(b) ?? 0) + 1);
    const v = clean(row.vendor);
    if (v !== null) vendors.set(v, (vendors.get(v) ?? 0) + 1);
    const t = clean(row.type);
    if (t !== null) types.set(t, (types.get(t) ?? 0) + 1);
    if (row.orphaned) orphanedCount += 1;
    if (row.hidden === true) hiddenCount += 1;
  }

  // Commonest first, then alphabetical. A facet list ordered by raw insertion
  // is a list nobody can scan.
  const toList = (m: Map<string, number>): Array<{ value: string; count: number }> =>
    Array.from(m.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.value.localeCompare(b.value)));

  return {
    brands: toList(brands),
    vendors: toList(vendors),
    types: toList(types),
    orphanedCount,
    hiddenCount,
    total: (rows ?? []).length,
  };
}

/* ========================================================================== */
/* Describing a product (design rule 3: never lead with an id)                */
/* ========================================================================== */

/** One-line human description of a menu row. */
export function describeMenuRow(row: MenuBrowserRow): string {
  const parts: string[] = [];
  parts.push(clean(row.name) ?? "Unnamed product");
  const brand = clean(row.brand);
  if (brand !== null) parts.push(`by ${brand}`);
  const vendor = clean(row.vendor);
  if (vendor !== null && norm(vendor) !== norm(brand)) parts.push(`from ${vendor}`);
  const sizes = row.variants.map((v) => clean(v.sizeLabel)).filter((s): s is string => s !== null);
  if (sizes.length > 0) parts.push(`(${sizes.join(", ")})`);
  const barcode = row.barcodes.map((b) => b.trim()).filter((b) => b.length > 0)[0];
  if (barcode !== undefined) parts.push(`barcode ${barcode}`);
  if (row.orphaned) parts.push("— no longer in your menu feed");
  return parts.join(" ");
}

/* ========================================================================== */
/* Selection and the delete confirmation (design rules 4 and 5)               */
/* ========================================================================== */

export type SelectionSummary = {
  count: number;
  /** Ids to send to the delete call. The UI never displays these. */
  ids: string[];
  /** Human names, in display order. */
  labels: string[];
  /** Sentence for the confirm dialog. */
  confirmation: string;
};

/**
 * Summarise what is about to be deleted, by name.
 *
 * `visibleRows` is what the owner can currently see. Selected ids that are
 * NOT among them are still counted and are called out explicitly, because a
 * selection that survives a filter change is the classic way a delete UI
 * removes something nobody meant to touch.
 */
export function summarizeSelection(
  visibleRows: readonly MenuBrowserRow[],
  selectedIds: readonly string[],
  sampleSize = 5,
): SelectionSummary {
  const selected = new Set(
    (selectedIds ?? []).map((id) => String(id ?? "").trim()).filter((id) => id.length > 0),
  );
  const rows = (visibleRows ?? []).filter((r) => selected.has(r.id));
  const labels = rows.map((r) => describeMenuRow(r));
  const ids = Array.from(selected);

  const offscreen = selected.size - rows.length;
  const count = selected.size;

  if (count === 0) {
    return { count: 0, ids: [], labels: [], confirmation: "Nothing is selected." };
  }

  const cap = Math.max(1, Math.floor(sampleSize));
  const shown = labels.slice(0, cap);
  const noun = count === 1 ? "product" : "products";
  let sentence =
    `Remove ${count} ${noun} from your Leafly menu. This cannot be undone from here.`;
  if (shown.length > 0) {
    sentence += ` Including: ${shown.join("; ")}`;
    const hidden = labels.length - shown.length;
    if (hidden > 0) sentence += `; and ${hidden} more`;
    sentence += ".";
  }
  // Design rule 4: never let a selection hide off-screen.
  if (offscreen > 0) {
    sentence +=
      ` ${offscreen} of the selected ${offscreen === 1 ? "product is" : "products are"} ` +
      `not shown by your current filter and would also be removed.`;
  }
  return { count, ids, labels, confirmation: sentence };
}

/**
 * Describe what a select-all would do, so the button can be honest.
 *
 * Deliberately phrased in terms of the FILTERED count, because that is what
 * the action actually does.
 */
export function describeSelectAll(matchedCount: number, totalCount: number): string {
  if (matchedCount === 0) return "Nothing matches your filter, so there is nothing to select.";
  if (matchedCount === totalCount) {
    return `Select all ${matchedCount} products on the menu.`;
  }
  return `Select the ${matchedCount} products matching your filter (of ${totalCount} on the menu).`;
}

/* ========================================================================== */
/* Embedded self-tests                                                        */
/* ========================================================================== */

export function __runLeaflyMenuBrowserTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const check = (name: string, cond: boolean): void => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.log(`FAIL: ${name}`);
    }
  };

  const mk = (over: Partial<MenuBrowserRow> & { id: string }): MenuBrowserRow => ({
    id: over.id,
    name: over.name ?? null,
    brand: over.brand ?? null,
    strainName: over.strainName ?? null,
    type: over.type ?? null,
    vendor: over.vendor ?? null,
    barcodes: over.barcodes ?? [],
    hidden: over.hidden ?? null,
    variants: over.variants ?? [],
    orphaned: over.orphaned ?? false,
  });

  const v = (id: string, sizeLabel: string | null): MenuBrowserVariant => ({
    id,
    sizeLabel,
    priceMinorUnits: null,
    inventoryLevel: null,
  });

  const blue = mk({
    id: "pos-1",
    name: "Blue Dream",
    brand: "Acme",
    vendor: "Fire Bros",
    strainName: "Blue Dream",
    type: "Flower",
    barcodes: ["0123456789012"],
    variants: [v("pos-1-a", "1g"), v("pos-1-b", "3.5g")],
  });
  const dragon = mk({
    id: "pos-45c6e282e0e8",
    name: "Dragon Balm CBD RED",
    brand: "Dragon Balm",
    vendor: "Fire Bros",
    type: "Topical",
    variants: [v("x", "1g"), v("y", "3g")],
  });
  const ghost = mk({ id: "pos-3", name: "Ghost Train", brand: "Zed", orphaned: true });
  const hiddenRow = mk({ id: "pos-4", name: "Hidden Thing", brand: "Acme", hidden: true });
  const all = [blue, dragon, ghost, hiddenRow];

  /* ---------------- search: rule 1 ---------------- */

  check("finds by product name", rowMatchesQuery(blue, "blue dream"));
  check("finds by partial name", rowMatchesQuery(dragon, "drag"));
  check("finds by brand", rowMatchesQuery(blue, "acme"));
  check("finds by vendor", rowMatchesQuery(blue, "fire bros"));
  check("finds by strain", rowMatchesQuery(blue, "blue dream"));
  check("finds by type", rowMatchesQuery(dragon, "topical"));
  check("finds by barcode", rowMatchesQuery(blue, "0123456789012"));
  check("finds by size label", rowMatchesQuery(blue, "3.5g"));
  check("finds by id for anyone pasting from a log", rowMatchesQuery(blue, "pos-1"));
  check("search is case-insensitive", rowMatchesQuery(blue, "BLUE DREAM"));
  check("empty query matches everything", rowMatchesQuery(blue, ""));
  check("whitespace query matches everything", rowMatchesQuery(blue, "   "));
  check("null query matches everything", rowMatchesQuery(blue, null));

  /* rule 2: AND, not OR -- the property that makes search usable at scale */
  check("all tokens must match", !rowMatchesQuery(blue, "blue zzzz"));
  check("tokens may come from DIFFERENT fields", rowMatchesQuery(blue, "blue acme"));
  check(
    "cross-field AND narrows: dragon is not Acme",
    !rowMatchesQuery(dragon, "dragon acme"),
  );
  check("non-matching query rejects", !rowMatchesQuery(blue, "gelato"));

  /* ---------------- filtering ---------------- */

  check("filter by brand", filterMenuRows(all, { brand: "Acme" }).length === 2);
  check("filter by vendor", filterMenuRows(all, { vendor: "Fire Bros" }).length === 2);
  check("filter by type", filterMenuRows(all, { type: "Flower" }).length === 1);
  check("filter is case-insensitive", filterMenuRows(all, { brand: "acme" }).length === 2);
  check("orphaned filter", filterMenuRows(all, { orphanedOnly: true }).length === 1);
  check(
    "orphaned filter finds the right one",
    filterMenuRows(all, { orphanedOnly: true })[0].id === "pos-3",
  );
  check("hidden filter", filterMenuRows(all, { hiddenOnly: true }).length === 1);
  check("no filter returns everything", filterMenuRows(all, {}).length === 4);
  check("filters combine", filterMenuRows(all, { brand: "Acme", hiddenOnly: true }).length === 1);
  check(
    "query combines with a facet filter",
    filterMenuRows(all, { brand: "Acme", query: "blue" }).length === 1,
  );
  check("empty input is safe", filterMenuRows([], { query: "x" }).length === 0);

  /* ---------------- sorting ---------------- */

  const byName = sortMenuRows(all, "name");
  check("sorts by name", byName[0].name === "Blue Dream");
  const unnamed = sortMenuRows([mk({ id: "z" }), blue], "name");
  check("unnamed products sort LAST, not first", unnamed[0].id === "pos-1");
  const bySizes = sortMenuRows(all, "sizes");
  check("sorts by size count, most first", bySizes[0].variants.length === 2);
  check(
    "sort is stable and total (ties break by id)",
    sortMenuRows([mk({ id: "b", name: "Same" }), mk({ id: "a", name: "Same" })], "name")[0].id ===
      "a",
  );
  check(
    "sorting does not mutate the input",
    (() => {
      const input = [blue, dragon];
      sortMenuRows(input, "name");
      return input[0].id === "pos-1";
    })(),
  );

  /* ---------------- facets ---------------- */

  const facets = computeMenuFacets(all);
  check("facets count brands", facets.brands.length === 3);
  check("commonest brand first", facets.brands[0].value === "Acme" && facets.brands[0].count === 2);
  check("facets count vendors", facets.vendors[0].count === 2);
  check("facets count orphans", facets.orphanedCount === 1);
  check("facets count hidden", facets.hiddenCount === 1);
  check("facets count total", facets.total === 4);
  check("facets ignore blanks", computeMenuFacets([mk({ id: "q" })]).brands.length === 0);

  /* ---------------- describing: rule 3 ---------------- */

  const desc = describeMenuRow(blue);
  check("description leads with the name", desc.startsWith("Blue Dream"));
  check("description does NOT lead with an id", !desc.startsWith("pos-"));
  check("description carries the brand", desc.includes("by Acme"));
  check("description carries the vendor", desc.includes("from Fire Bros"));
  check("description carries every size", desc.includes("1g, 3.5g"));
  check("description carries the barcode", desc.includes("barcode 0123456789012"));
  check(
    "orphans are called out",
    describeMenuRow(ghost).includes("no longer in your menu feed"),
  );
  check(
    "unnamed is admitted rather than faked",
    describeMenuRow(mk({ id: "q" })).startsWith("Unnamed product"),
  );
  check(
    "vendor equal to brand is not repeated",
    (describeMenuRow(mk({ id: "r", name: "N", brand: "Acme", vendor: "Acme" })).match(/Acme/g) ?? [])
      .length === 1,
  );

  /* ---------------- selection: rules 4 and 5 ---------------- */

  const none = summarizeSelection(all, []);
  check("empty selection is stated plainly", none.confirmation === "Nothing is selected.");
  check("empty selection has no ids", none.ids.length === 0);

  const two = summarizeSelection(all, ["pos-1", "pos-3"]);
  check("selection counts", two.count === 2);
  check("selection carries ids for the API", two.ids.length === 2);
  check("confirmation names products, not ids", two.confirmation.includes("Blue Dream"));
  check("confirmation says it cannot be undone", two.confirmation.includes("cannot be undone"));
  check(
    "confirmation does not read out raw ids",
    !two.confirmation.includes("pos-1"),
  );

  // Rule 4: the dangerous case -- selected rows hidden by the current filter.
  const filtered = filterMenuRows(all, { brand: "Acme" });
  const risky = summarizeSelection(filtered, ["pos-1", "pos-3"]);
  check("off-screen selections are still counted", risky.count === 2);
  check(
    "off-screen selections are DISCLOSED",
    risky.confirmation.includes("not shown by your current filter"),
  );
  check(
    "off-screen disclosure gives the number",
    risky.confirmation.includes("1 of the selected"),
  );
  check(
    "no false disclosure when everything is visible",
    !two.confirmation.includes("not shown by your current filter"),
  );

  // Long selections are summarised, never silently truncated.
  const many = Array.from({ length: 12 }, (_, i) => mk({ id: `m${i}`, name: `Product ${i}` }));
  const big = summarizeSelection(many, many.map((m) => m.id), 3);
  check("long selection counts all", big.count === 12);
  check("long selection shows a sample", big.confirmation.includes("Product 0"));
  check("long selection admits the remainder", big.confirmation.includes("and 9 more"));

  check("selection ignores blank ids", summarizeSelection(all, ["", "  "]).count === 0);
  check(
    "selection deduplicates",
    summarizeSelection(all, ["pos-1", "pos-1"]).count === 1,
  );
  check("singular grammar for one", two.confirmation.includes("products") && summarizeSelection(all, ["pos-1"]).confirmation.includes("1 product"));

  /* ---------------- select-all honesty: rule 4 ---------------- */

  check(
    "select-all names the FILTERED count",
    describeSelectAll(12, 400).includes("12 products matching your filter"),
  );
  check(
    "select-all mentions the total so the scope is clear",
    describeSelectAll(12, 400).includes("of 400"),
  );
  check(
    "select-all with no filter says all",
    describeSelectAll(400, 400) === "Select all 400 products on the menu.",
  );
  check(
    "select-all with no matches says so",
    describeSelectAll(0, 400).includes("Nothing matches"),
  );

  return { passed, failed };
}
