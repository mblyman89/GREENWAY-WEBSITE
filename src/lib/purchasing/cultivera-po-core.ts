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

  console.log(`cultivera-po-core: ${n} self-tests passed`);
}
