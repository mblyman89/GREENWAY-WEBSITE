/**
 * src/lib/pos/leafly-register-lines-core.ts
 *
 * PURE: turn a Leafly order into the lines the register cart is rebuilt from.
 * No imports, no I/O - registered in scripts/compliance/run-pure-selftests.ts.
 *
 * THE BUG THIS FIXES (owner report: "When I load the order into the register
 * cart, it loads empty ... a message says the item is not on the menu").
 *
 * The register rebuilds a loaded order against its CURRENT menu bundle
 * (order-to-cart-core.rebuildOrderCart), matching each line by its VARIANT
 * id - or, for single-price items, by `${productId}-default`. A website
 * order line stores both ids (orders-store writes product_id + variant_id).
 * The local copy of a LEAFLY order stored neither: the bridge
 * (leafly/bridge-server) and the L-48 rebuild (leafly/order-cart-server)
 * wrote only name, size, quantity and price. With both ids null, every line
 * failed the match and was dropped as "(no longer on the menu)", so the cart
 * opened empty even though every product was on sale.
 *
 * WHERE THE ID COMES FROM - read, not guessed.
 *
 *   Leafly's CartItemOutgoing (docs/leafly-specs/order-api-v1.openapi.json)
 *   carries `integratorVariantId`: "id assigned to variant when submitted
 *   through Leafly Menu API". We assign it in leafly/payload-core
 *   `toLeaflyVariant` as `String(v.id)`, where v.id is the syndication
 *   variant id = `menu_variants.source_variant_id`
 *   (syndication/menu-feed-core `toSyndicationItem`). An item with no
 *   variants is sent ONE synthesized variant `${item.id}-default`
 *   (payload-core `variantsFor`).
 *
 *   The register bundle (api/pos/menu) builds `variantId` from the SAME
 *   published menu version: `variant.id` = `source_variant_id`
 *   (pos/live-menu), and the SAME synthesized `${item.id}-default` for an
 *   item with no variants. A collision-split item (leafly/collision-split-core)
 *   gets a new ITEM id but keeps each variant's ORIGINAL id (`variants: [v]`).
 *
 *   So Leafly's integratorVariantId IS the register's variantId, for every
 *   id shape we send. That is the whole match; nothing is matched by name.
 *
 * WHY THE STORED LEAFLY ORDER, NOT THE LOCAL LINES. Leafly orders already in
 * the database were saved without ids, and `leafly_orders.raw_order` is
 * Leafly's own copy - the same copy the register's order detail already
 * reads for its item list (pickup-store buildRichDetail). Reading it at load
 * time repairs every existing order with no backfill, and means the cart
 * shows exactly the items the detail pane just showed.
 */

/** A line in the shape order-to-cart-core.LoadedOrderLine expects. */
export type LeaflyRegisterLine = {
  productId: string | null;
  variantId: string | null;
  productName: string;
  quantity: number;
};

export type LeaflyRegisterLinesReading = {
  lines: LeaflyRegisterLine[];
  /** Cart items that carried no integratorVariantId (named for staff). */
  missingId: string[];
};

/** The suffix payload-core and api/pos/menu both give a variant-less item. */
export const LEAFLY_DEFAULT_VARIANT_SUFFIX = "-default";

/**
 * The POS product key implied by a synthesized default variant id, else null.
 * `${item.id}-default` is minted by BOTH payload-core and api/pos/menu, so
 * stripping it is exact. Any other id shape yields null - a product key is
 * never guessed out of an id we do not recognise.
 */
export function leaflyProductIdFromVariantId(variantId: string | null | undefined): string | null {
  if (typeof variantId !== "string") return null;
  const v = variantId.trim();
  if (!v.endsWith(LEAFLY_DEFAULT_VARIANT_SUFFIX)) return null;
  const key = v.slice(0, -LEAFLY_DEFAULT_VARIANT_SUFFIX.length).trim();
  return key === "" ? null : key;
}

/** Trimmed text or null. */
function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/**
 * Read the register lines out of a stored Leafly order payload.
 *
 * Accepts the order itself or the webhook envelope `{ order: {...} }` - the
 * same two shapes bridge-core `readLeaflyOrderPayload` and pickup-detail-core
 * `readLeaflyCart` accept. Unlike those readers, an item is NOT skipped for a
 * missing price: the register reprices every line from its live bundle, so a
 * price is irrelevant here, and skipping would silently drop an item.
 */
export function readLeaflyRegisterLines(raw: unknown): LeaflyRegisterLinesReading {
  const out: LeaflyRegisterLinesReading = { lines: [], missingId: [] };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return out;
  const o = raw as Record<string, unknown>;
  const inner =
    o.order !== null && typeof o.order === "object" && !Array.isArray(o.order)
      ? (o.order as Record<string, unknown>)
      : o;
  const items = Array.isArray(inner.cartItems) ? inner.cartItems : [];

  for (const item of items) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const ci = item as Record<string, unknown>;
    const name = text(ci.name) ?? "Unnamed item";
    const size = text(ci.packageSize) ?? "";
    const unit = text(ci.packageUnit) ?? "";
    const label = `${size}${unit}`.trim();
    const productName = label === "" ? name : `${name} (${label})`;
    const quantity =
      typeof ci.quantity === "number" && Number.isInteger(ci.quantity) && ci.quantity > 0 ? ci.quantity : 1;
    const variantId = text(ci.integratorVariantId);
    if (variantId === null) out.missingId.push(productName);
    out.lines.push({
      productId: leaflyProductIdFromVariantId(variantId),
      variantId,
      productName,
      quantity,
    });
  }
  return out;
}

/**
 * Which lines the register should rebuild a loaded order from.
 *
 * Leafly's stored order wins for a marketplace order whenever it yields at
 * least one line with an id - it is the newest copy we hold (L-48 edits land
 * there first) and the only copy with ids for orders saved before this fix.
 * Otherwise the local lines are used exactly as before, so a website order
 * is untouched and a Leafly order with an unreadable payload still loads
 * whatever its local lines can prove.
 */
export function chooseRegisterLines(input: {
  isMarketplace: boolean;
  leafly: LeaflyRegisterLinesReading | null;
  stored: LeaflyRegisterLine[];
}): { lines: LeaflyRegisterLine[]; source: "leafly" | "stored" } {
  if (input.isMarketplace && input.leafly && input.leafly.lines.some((l) => l.variantId !== null)) {
    return { lines: input.leafly.lines, source: "leafly" };
  }
  return { lines: input.stored, source: "stored" };
}

// ---------------------------------------------------------------------------
// Embedded self-tests
// ---------------------------------------------------------------------------

export function __runLeaflyRegisterLinesTests(): { passed: number; failed: number } {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) pass += 1;
    else {
      fail += 1;
      console.log("FAIL:", msg);
    }
  };

  // -- leaflyProductIdFromVariantId -----------------------------------------
  ok(leaflyProductIdFromVariantId("pos-abc-default") === "pos-abc", "default suffix strips to the item key");
  ok(leaflyProductIdFromVariantId(" pos-abc-default ") === "pos-abc", "default id is trimmed first");
  ok(leaflyProductIdFromVariantId("pos-abc-onboarded") === null, "an onboarded id is not a default id");
  ok(leaflyProductIdFromVariantId("3cf37035-68e7-4b2c-97af-570f10e0bd03") === null, "a uuid yields no key");
  ok(leaflyProductIdFromVariantId("-default") === null, "a bare suffix yields no key");
  ok(leaflyProductIdFromVariantId("") === null, "blank yields no key");
  ok(leaflyProductIdFromVariantId(null) === null, "null yields no key");
  ok(leaflyProductIdFromVariantId(undefined) === null, "undefined yields no key");
  ok(leaflyProductIdFromVariantId("a-defaultx") === null, "suffix must be at the end");

  // -- readLeaflyRegisterLines ----------------------------------------------
  const spec = {
    id: "o1",
    cartItems: [
      { name: "bubbler", integratorVariantId: "3cf37035", packageSize: "1.0", packageUnit: "gram", quantity: 2, priceCents: 6710 },
      { name: "  Pre-roll ", integratorVariantId: " pos-9-default ", quantity: 3 },
    ],
  };
  const r = readLeaflyRegisterLines(spec);
  ok(r.lines.length === 2, "every cart item becomes a line");
  ok(r.lines[0].variantId === "3cf37035", "integratorVariantId becomes the variant id");
  ok(r.lines[0].productId === null, "a real variant id implies no product key");
  ok(r.lines[0].quantity === 2, "quantity is carried");
  ok(r.lines[0].productName === "bubbler (1.0gram)", "size and unit are shown with the name");
  ok(r.lines[1].variantId === "pos-9-default", "variant id is trimmed");
  ok(r.lines[1].productId === "pos-9", "a default id implies its product key");
  ok(r.lines[1].productName === "Pre-roll", "no size -> plain trimmed name");
  ok(r.missingId.length === 0, "no missing ids when all present");

  const env = readLeaflyRegisterLines({ order: spec });
  ok(env.lines.length === 2 && env.lines[0].variantId === "3cf37035", "the webhook envelope is unwrapped");

  const noPrice = readLeaflyRegisterLines({ cartItems: [{ name: "X", integratorVariantId: "v", quantity: 1 }] });
  ok(noPrice.lines.length === 1, "an item with no price is NOT dropped");

  const missing = readLeaflyRegisterLines({ cartItems: [{ name: "Mystery", quantity: 1 }] });
  ok(missing.lines.length === 1 && missing.lines[0].variantId === null, "missing id kept as a null line");
  ok(missing.missingId[0] === "Mystery", "missing id is named");

  const badQty = readLeaflyRegisterLines({ cartItems: [{ integratorVariantId: "v", quantity: 0 }, { integratorVariantId: "w", quantity: 1.5 }] });
  ok(badQty.lines.every((l) => l.quantity === 1), "a bad quantity becomes 1, never 0");
  ok(badQty.lines[0].productName === "Unnamed item", "a blank name gets a placeholder");

  ok(readLeaflyRegisterLines(null).lines.length === 0, "null payload -> no lines");
  ok(readLeaflyRegisterLines([]).lines.length === 0, "array payload -> no lines");
  ok(readLeaflyRegisterLines("x").lines.length === 0, "string payload -> no lines");
  ok(readLeaflyRegisterLines({ cartItems: "nope" }).lines.length === 0, "non-array cartItems -> no lines");
  ok(readLeaflyRegisterLines({ cartItems: [null, 5, ["a"]] }).lines.length === 0, "junk items are skipped");
  ok(readLeaflyRegisterLines({ order: null, cartItems: [{ integratorVariantId: "v" }] }).lines.length === 1, "null envelope falls back to the root");

  // -- chooseRegisterLines --------------------------------------------------
  const stored: LeaflyRegisterLine[] = [{ productId: null, variantId: null, productName: "Old", quantity: 1 }];
  const c1 = chooseRegisterLines({ isMarketplace: true, leafly: r, stored });
  ok(c1.source === "leafly" && c1.lines === r.lines, "marketplace + readable Leafly order -> Leafly lines");
  const c2 = chooseRegisterLines({ isMarketplace: false, leafly: r, stored });
  ok(c2.source === "stored" && c2.lines === stored, "a website order always uses its own lines");
  const c3 = chooseRegisterLines({ isMarketplace: true, leafly: null, stored });
  ok(c3.source === "stored", "no Leafly payload -> stored lines");
  const c4 = chooseRegisterLines({ isMarketplace: true, leafly: missing, stored });
  ok(c4.source === "stored", "a Leafly payload with no ids at all -> stored lines");
  const c5 = chooseRegisterLines({ isMarketplace: true, leafly: { lines: [], missingId: [] }, stored });
  ok(c5.source === "stored", "an empty Leafly cart -> stored lines");

  return { passed: pass, failed: fail };
}
