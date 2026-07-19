/**
 * src/lib/purchasing/cultivera-po-core.ts
 *
 * CV-6 — PURE helpers for the Cultivera menu → purchase-order hand-off.
 * No imports, no I/O — deterministic and self-tested in the pure runner.
 *
 * Flow: the snapshot browser submits a GET form to /admin/purchasing/new with
 * `fromMenu=<snapshotId>` and one `item=<itemId>` per ticked card. The PO
 * builder page RELOADS the snapshot's items from OUR OWN database and only
 * honors ids that actually exist in that snapshot — the URL never carries
 * names, prices, or vendor ids for the lines themselves (W11: never trust a
 * raw URL param). These helpers parse the id params and map saved menu-item
 * rows into the builder's prefill (SuggestionRow) shape.
 *
 * Money rule: wholesale_price_minor is already integer cents in the store;
 * we clamp/round defensively and never touch floats for arithmetic.
 */

/** Hard cap on menu lines one hand-off can prefill (keeps URLs + UI sane). */
export const MENU_PREFILL_CAP = 60;

/**
 * Parse the `item` search param(s) into a clean id list: accepts a single
 * value, a repeated param (string[]), and comma-separated values inside
 * either; trims, drops empties, dedupes preserving first-seen order, and
 * caps at `cap`.
 */
export function parseMenuItemIds(
  raw: string | string[] | undefined,
  cap: number = MENU_PREFILL_CAP,
): string[] {
  if (!raw || cap <= 0) return [];
  const parts = (Array.isArray(raw) ? raw : [raw])
    .flatMap((v) => v.split(","))
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
    if (out.length >= cap) break;
  }
  return out;
}

/** The subset of a saved cultivera_menu_items row the mapper needs (structural). */
export type MenuPrefillItemLike = {
  id: string;
  name: string | null;
  brand: string | null;
  category: string | null;
  size_label: string | null;
  wholesale_price_minor: number | null;
};

/**
 * A prefill line in the PO builder's SuggestionRow shape (kept structurally
 * identical so the page can pass these straight to BuilderTable). Menu items
 * have no POS identity or stock history yet, so posProductKey is null and
 * the velocity fields are zero — the buyer confirms quantity and cost.
 */
export type PoPrefillLine = {
  posProductKey: string | null;
  productName: string;
  brand: string | null;
  category: string | null;
  vendorId: string | null;
  vendorName: string | null;
  onHand: number;
  unit: string;
  unitCostMinor: number;
  avgDaily: number;
  reorderPoint: number;
  suggestedQty: number;
  belowReorderPoint: boolean;
  daysOfSupplyLeft: number;
};

/**
 * Display name for a PO line: the item's name, with the size label appended
 * (" — 3.5g") when the vendor didn't already bake it into the name. Falls
 * back to a neutral label so a nameless row can never produce an empty line
 * (createPurchaseOrderAction drops lines without a productName string).
 */
export function menuItemDisplayName(item: Pick<MenuPrefillItemLike, "name" | "size_label">): string {
  const name = (item.name ?? "").trim() || "Cultivera menu item";
  const size = (item.size_label ?? "").trim();
  if (!size) return name;
  if (name.toLowerCase().includes(size.toLowerCase())) return name;
  return `${name} — ${size}`;
}

/** Integer cents from a stored wholesale price: null/NaN/negative → 0. */
export function prefillCostMinor(wholesalePriceMinor: number | null): number {
  if (wholesalePriceMinor == null || !Number.isFinite(wholesalePriceMinor)) return 0;
  return Math.max(0, Math.round(wholesalePriceMinor));
}

/**
 * Map ONE saved menu item to a builder prefill line. vendorId must already
 * be verified against the real vendors list by the caller (W11) — this pure
 * fn just threads it through. Quantity defaults to 1; every number here is a
 * draft the buyer edits before saving.
 */
export function menuItemToPoPrefill(
  item: MenuPrefillItemLike,
  vendorId: string | null,
  vendorName: string | null,
): PoPrefillLine {
  return {
    posProductKey: null,
    productName: menuItemDisplayName(item),
    brand: item.brand?.trim() || null,
    category: item.category?.trim() || null,
    vendorId,
    vendorName,
    onHand: 0,
    unit: "each",
    unitCostMinor: prefillCostMinor(item.wholesale_price_minor),
    avgDaily: 0,
    reorderPoint: 0,
    suggestedQty: 1,
    belowReorderPoint: true,
    daysOfSupplyLeft: 0,
  };
}

/**
 * Build the prefill lines for a hand-off: keep MENU order (position order as
 * loaded from the store), include only items whose id was ticked, and cap.
 * Unknown ids are simply ignored — they don't exist in the snapshot, so they
 * were never a real menu line.
 */
export function buildMenuPrefills(
  items: MenuPrefillItemLike[],
  selectedIds: string[],
  vendorId: string | null,
  vendorName: string | null,
  cap: number = MENU_PREFILL_CAP,
): PoPrefillLine[] {
  if (selectedIds.length === 0 || cap <= 0) return [];
  const wanted = new Set(selectedIds);
  const out: PoPrefillLine[] = [];
  for (const it of items) {
    if (!wanted.has(it.id)) continue;
    out.push(menuItemToPoPrefill(it, vendorId, vendorName));
    if (out.length >= cap) break;
  }
  return out;
}

/** Banner copy for the builder page when a menu hand-off prefilled lines. */
export function menuPrefillBanner(count: number, vendorLabel: string | null): string {
  const items = `${count} item${count === 1 ? "" : "s"}`;
  const from = vendorLabel ? ` from ${vendorLabel}` : "";
  return `Started from a Cultivera menu: ${items}${from} pre-added below as draft lines — confirm quantities, costs, and the vendor, then save.`;
}

/* ------------------------------------------------------------------
 * CH-3 — per-VARIANT hand-off (the sizes table on the item detail page).
 *
 * The detail page renders one qty <input name="vq_<variantId>"> per size in a
 * GET form to /admin/purchasing/new, alongside `fromMenu=<snapshotId>` and
 * `detailItem=<itemRowId>`. W11 holds: the URL carries only OUR row ids plus
 * the buyer's chosen quantities; every name/price/limit is rebuilt from the
 * detail payload stored on OUR item row (detailFromItemRaw), never the URL.
 * ------------------------------------------------------------------ */

/** Prefix for the per-variant quantity inputs on the detail page's form. */
export const VARIANT_QTY_PARAM_PREFIX = "vq_";

export type VariantSelection = { variantId: string; qty: number };

/** The subset of a normalized CultiveraVariant the prefill mapper needs. */
export type VariantLike = {
  variantId: string | null;
  cleanName: string | null;
  name: string | null;
  sizeLabel: string | null;
  unitPriceMinor: number | null;
  availableQty: number | null;
  maxOrderLimit: number | null;
};

/**
 * Read the buyer's variant quantities out of the search params: every
 * `vq_<variantId>` key with a positive integer value becomes a selection.
 * Junk/zero/negative quantities are dropped; order follows the param order;
 * capped like the item hand-off.
 */
export function parseVariantSelections(
  sp: Record<string, string | string[] | undefined>,
  cap: number = MENU_PREFILL_CAP,
): VariantSelection[] {
  if (cap <= 0) return [];
  const out: VariantSelection[] = [];
  const seen = new Set<string>();
  for (const [key, value] of Object.entries(sp)) {
    if (!key.startsWith(VARIANT_QTY_PARAM_PREFIX)) continue;
    const variantId = key.slice(VARIANT_QTY_PARAM_PREFIX.length).trim();
    if (!variantId || seen.has(variantId)) continue;
    const raw = Array.isArray(value) ? value[0] : value;
    const n = Number((raw ?? "").trim());
    if (!Number.isFinite(n)) continue;
    const qty = Math.trunc(n);
    if (qty <= 0) continue;
    seen.add(variantId);
    out.push({ variantId, qty });
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Clamp a requested quantity against the vendor's per-order cap and the live
 * availability (both from OUR stored detail). Ignores null/zero limits.
 * Always returns at least 1 for a positive request (a draft the buyer edits).
 */
export function clampVariantQty(
  qty: number,
  maxOrderLimit: number | null,
  availableQty: number | null,
): number {
  let q = Math.max(1, Math.trunc(Number.isFinite(qty) ? qty : 1));
  if (maxOrderLimit != null && Number.isFinite(maxOrderLimit) && maxOrderLimit > 0) {
    q = Math.min(q, Math.trunc(maxOrderLimit));
  }
  if (availableQty != null && Number.isFinite(availableQty) && availableQty > 0) {
    q = Math.min(q, Math.trunc(availableQty));
  }
  return Math.max(1, q);
}

/** Display name for a variant line: clean name + size, with safe fallbacks. */
export function variantDisplayName(
  v: Pick<VariantLike, "cleanName" | "name" | "sizeLabel">,
  lineName: string | null,
): string {
  const base =
    (v.cleanName ?? "").trim() || (v.name ?? "").trim() || (lineName ?? "").trim() ||
    "Cultivera variant";
  const size = (v.sizeLabel ?? "").trim();
  if (!size) return base;
  if (base.toLowerCase().includes(size.toLowerCase())) return base;
  return `${base} — ${size}`;
}

/**
 * Build builder prefill lines from the buyer's per-size selections. Only
 * variant ids that exist in OUR stored detail are honored; quantities are
 * clamped to MaxOrderLimit/availability; order follows the stored variants.
 */
export function buildVariantPrefills(
  variants: VariantLike[],
  selections: VariantSelection[],
  lineName: string | null,
  vendorId: string | null,
  vendorName: string | null,
  cap: number = MENU_PREFILL_CAP,
): PoPrefillLine[] {
  if (selections.length === 0 || cap <= 0) return [];
  const wanted = new Map(selections.map((s) => [s.variantId, s.qty]));
  const out: PoPrefillLine[] = [];
  for (const v of variants) {
    const id = (v.variantId ?? "").trim();
    if (!id || !wanted.has(id)) continue;
    const qty = clampVariantQty(wanted.get(id) ?? 1, v.maxOrderLimit, v.availableQty);
    out.push({
      posProductKey: null,
      productName: variantDisplayName(v, lineName),
      brand: null,
      category: null,
      vendorId,
      vendorName,
      onHand: 0,
      unit: "each",
      unitCostMinor: prefillCostMinor(v.unitPriceMinor),
      avgDaily: 0,
      reorderPoint: 0,
      suggestedQty: qty,
      belowReorderPoint: true,
      daysOfSupplyLeft: 0,
    });
    if (out.length >= cap) break;
  }
  return out;
}

/** Banner copy for a per-variant hand-off. */
export function variantPrefillBanner(count: number, vendorLabel: string | null): string {
  const sizes = `${count} size${count === 1 ? "" : "s"}`;
  const from = vendorLabel ? ` from ${vendorLabel}` : "";
  return `Started from a Cultivera sizes table: ${sizes}${from} pre-added below with your chosen quantities — confirm costs and the vendor, then save.`;
}

/* ------------------------------------------------------------------
 * Embedded self-tests (run by scripts/compliance/run-pure-selftests.ts)
 * ------------------------------------------------------------------ */

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`cultivera-po-core self-test failed: ${msg}`);
}

function mkItem(over: Partial<MenuPrefillItemLike>): MenuPrefillItemLike {
  return {
    id: "i1",
    name: "Blue Dream",
    brand: "Acme",
    category: "Flower",
    size_label: "3.5g",
    wholesale_price_minor: 1250,
    ...over,
  };
}

export function __runCultiveraPoCoreTests(): void {
  let n = 0;
  const ok = (cond: boolean, msg: string) => {
    assert(cond, msg);
    n += 1;
  };

  // parseMenuItemIds
  ok(parseMenuItemIds(undefined).length === 0, "undefined → empty");
  ok(parseMenuItemIds("").length === 0, "empty string → empty");
  ok(parseMenuItemIds("a").join(",") === "a", "single value");
  ok(parseMenuItemIds(["a", "b"]).join(",") === "a,b", "repeated param");
  ok(parseMenuItemIds("a,b,c").join(",") === "a,b,c", "csv value");
  ok(parseMenuItemIds(["a,b", "c"]).join(",") === "a,b,c", "csv inside repeated");
  ok(parseMenuItemIds([" a ", "", "b"]).join(",") === "a,b", "trims + drops empties");
  ok(parseMenuItemIds(["a", "b", "a"]).join(",") === "a,b", "dedupes, keeps order");
  ok(parseMenuItemIds(["a", "b", "c"], 2).join(",") === "a,b", "cap applies");
  ok(parseMenuItemIds("a", 0).length === 0, "cap 0 → empty");
  ok(parseMenuItemIds("a", -1).length === 0, "negative cap → empty");
  const many = Array.from({ length: 100 }, (_, i) => `id${i}`);
  ok(parseMenuItemIds(many).length === MENU_PREFILL_CAP, "default cap enforced");

  // menuItemDisplayName
  ok(menuItemDisplayName({ name: "Blue Dream", size_label: "3.5g" }) === "Blue Dream — 3.5g", "appends size");
  ok(
    menuItemDisplayName({ name: "Blue Dream 3.5g Jar", size_label: "3.5g" }) === "Blue Dream 3.5g Jar",
    "size already in name → unchanged",
  );
  ok(
    menuItemDisplayName({ name: "Blue Dream 3.5G Jar", size_label: "3.5g" }) === "Blue Dream 3.5G Jar",
    "size match is case-insensitive",
  );
  ok(menuItemDisplayName({ name: "Blue Dream", size_label: null }) === "Blue Dream", "no size → name only");
  ok(menuItemDisplayName({ name: "  Blue Dream  ", size_label: "" }) === "Blue Dream", "trims name");
  ok(menuItemDisplayName({ name: null, size_label: null }) === "Cultivera menu item", "null name fallback");
  ok(menuItemDisplayName({ name: "  ", size_label: "1g" }) === "Cultivera menu item — 1g", "blank name fallback + size");

  // prefillCostMinor
  ok(prefillCostMinor(1250) === 1250, "integer cents pass through");
  ok(prefillCostMinor(null) === 0, "null → 0");
  ok(prefillCostMinor(-50) === 0, "negative clamped to 0");
  ok(prefillCostMinor(12.6) === 13, "fraction rounds");
  ok(prefillCostMinor(Number.NaN) === 0, "NaN → 0");
  ok(prefillCostMinor(Number.POSITIVE_INFINITY) === 0, "Infinity → 0");

  // menuItemToPoPrefill
  const line = menuItemToPoPrefill(mkItem({}), "v1", "Acme Farms");
  ok(line.posProductKey === null, "no pos key");
  ok(line.productName === "Blue Dream — 3.5g", "display name used");
  ok(line.brand === "Acme" && line.category === "Flower", "brand + category thread through");
  ok(line.vendorId === "v1" && line.vendorName === "Acme Farms", "vendor threads through");
  ok(line.onHand === 0 && line.avgDaily === 0 && line.reorderPoint === 0, "no stock history");
  ok(line.unit === "each", "unit defaults to each");
  ok(line.unitCostMinor === 1250, "wholesale cents become unit cost");
  ok(line.suggestedQty === 1 && line.belowReorderPoint === true, "qty 1, pre-tick flag set");
  ok(line.daysOfSupplyLeft === 0, "days of supply 0");
  const bare = menuItemToPoPrefill(
    mkItem({ brand: "  ", category: null, wholesale_price_minor: null }),
    null,
    null,
  );
  ok(bare.brand === null && bare.category === null, "blank brand/category → null");
  ok(bare.unitCostMinor === 0 && bare.vendorId === null && bare.vendorName === null, "nulls stay null, cost 0");

  // buildMenuPrefills
  const items = [
    mkItem({ id: "a", name: "Alpha" }),
    mkItem({ id: "b", name: "Bravo" }),
    mkItem({ id: "c", name: "Charlie" }),
  ];
  const built = buildMenuPrefills(items, ["c", "a"], "v1", "Acme Farms");
  ok(built.length === 2, "only ticked items");
  ok(built[0].productName.startsWith("Alpha") && built[1].productName.startsWith("Charlie"), "menu order kept");
  ok(buildMenuPrefills(items, ["nope"], null, null).length === 0, "unknown ids ignored");
  ok(buildMenuPrefills(items, [], "v1", "x").length === 0, "no selection → no prefills");
  ok(buildMenuPrefills(items, ["a", "b", "c"], null, null, 2).length === 2, "cap applies");
  ok(buildMenuPrefills([], ["a"], null, null).length === 0, "no items → no prefills");

  // menuPrefillBanner
  ok(
    menuPrefillBanner(3, "Acme Farms") ===
      "Started from a Cultivera menu: 3 items from Acme Farms pre-added below as draft lines — confirm quantities, costs, and the vendor, then save.",
    "plural banner with vendor",
  );
  ok(
    menuPrefillBanner(1, null) ===
      "Started from a Cultivera menu: 1 item pre-added below as draft lines — confirm quantities, costs, and the vendor, then save.",
    "singular banner without vendor",
  );

  // ------------------------------------------------------------------
  // CH-3 — per-variant hand-off helpers
  // ------------------------------------------------------------------

  // parseVariantSelections
  const sels = parseVariantSelections({ vq_447772: "3", vq_9: "1", other: "x" });
  ok(sels.length === 2, "selections count");
  ok(sels[0].variantId === "447772" && sels[0].qty === 3, "selection parses id+qty");
  ok(parseVariantSelections({ vq_1: "0" }).length === 0, "zero qty dropped");
  ok(parseVariantSelections({ vq_1: "-2" }).length === 0, "negative qty dropped");
  ok(parseVariantSelections({ vq_1: "junk" }).length === 0, "junk qty dropped");
  ok(parseVariantSelections({ vq_1: "2.9" })[0].qty === 2, "fraction truncates");
  ok(parseVariantSelections({ vq_1: ["4", "9"] })[0].qty === 4, "array takes first");
  ok(parseVariantSelections({ vq_: "3" }).length === 0, "empty id dropped");
  ok(parseVariantSelections({}, 0).length === 0, "cap 0 empty");
  ok(
    parseVariantSelections({ vq_1: "1", vq_2: "1", vq_3: "1" }, 2).length === 2,
    "cap applies",
  );

  // clampVariantQty
  ok(clampVariantQty(5, null, null) === 5, "no limits pass through");
  ok(clampVariantQty(100, 75, null) === 75, "MaxOrderLimit caps");
  ok(clampVariantQty(100, null, 20) === 20, "availability caps");
  ok(clampVariantQty(100, 75, 20) === 20, "tightest cap wins");
  ok(clampVariantQty(0, null, null) === 1, "min 1");
  ok(clampVariantQty(Number.NaN, null, null) === 1, "NaN -> 1");
  ok(clampVariantQty(5, 0, 0) === 5, "zero limits ignored");

  // variantDisplayName
  ok(
    variantDisplayName({ cleanName: "Luxor", name: "Luxor [1g]", sizeLabel: "1g" }, "Line") ===
      "Luxor — 1g",
    "variant clean name + size",
  );
  ok(
    variantDisplayName({ cleanName: null, name: null, sizeLabel: "1g" }, "Signature Line") ===
      "Signature Line — 1g",
    "falls back to line name",
  );
  ok(
    variantDisplayName({ cleanName: null, name: null, sizeLabel: null }, null) ===
      "Cultivera variant",
    "total fallback",
  );
  ok(
    variantDisplayName({ cleanName: "Luxor 1g", name: null, sizeLabel: "1g" }, null) ===
      "Luxor 1g",
    "size already in name unchanged",
  );

  // buildVariantPrefills
  const vlist: VariantLike[] = [
    { variantId: "1", cleanName: "Luxor", name: "Luxor [1g]", sizeLabel: "1g",
      unitPriceMinor: 450, availableQty: 20, maxOrderLimit: null },
    { variantId: "2", cleanName: "Wedding Cake", name: "Wedding Cake [3.5g]", sizeLabel: "3.5g",
      unitPriceMinor: 1400, availableQty: 1471, maxOrderLimit: 75 },
    { variantId: "3", cleanName: "Ghost", name: null, sizeLabel: null,
      unitPriceMinor: null, availableQty: null, maxOrderLimit: null },
  ];
  const vp = buildVariantPrefills(
    vlist,
    [{ variantId: "2", qty: 100 }, { variantId: "1", qty: 3 }],
    "Signature Flower Line",
    "v1",
    "Lifted Cannabis",
  );
  ok(vp.length === 2, "variant prefills count");
  ok(vp[0].productName === "Luxor — 1g", "stored order kept (variant 1 first)");
  ok(vp[0].suggestedQty === 3 && vp[0].unitCostMinor === 450, "variant qty + cents");
  ok(vp[1].suggestedQty === 75, "qty clamped to MaxOrderLimit");
  ok(vp[1].vendorId === "v1" && vp[1].vendorName === "Lifted Cannabis", "vendor threads");
  ok(
    buildVariantPrefills(vlist, [{ variantId: "nope", qty: 1 }], null, null, null).length === 0,
    "unknown variant ids ignored",
  );
  ok(buildVariantPrefills(vlist, [], null, null, null).length === 0, "no selections");
  ok(
    buildVariantPrefills(vlist, [{ variantId: "1", qty: 1 }, { variantId: "2", qty: 1 }], null, null, null, 1).length === 1,
    "variant cap applies",
  );
  const vpNull = buildVariantPrefills(vlist, [{ variantId: "3", qty: 2 }], "Line", null, null);
  ok(vpNull[0].unitCostMinor === 0 && vpNull[0].productName === "Ghost", "null price -> 0 cents");

  // variantPrefillBanner
  ok(
    variantPrefillBanner(2, "Lifted Cannabis").startsWith("Started from a Cultivera sizes table: 2 sizes from Lifted Cannabis"),
    "variant banner plural",
  );
  ok(
    variantPrefillBanner(1, null).startsWith("Started from a Cultivera sizes table: 1 size "),
    "variant banner singular",
  );

  console.log(`cultivera-po-core: ${n} self-tests passed`);
}
