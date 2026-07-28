/**
 * LL-1 — LeafLink menu normalizers (pure, tolerant, side-effect free).
 *
 * LeafLink (app.leaflink.com) is a Vue SPA backed by a COOKIE-authenticated
 * internal REST API scoped by the buyer company's slug. The owner is an
 * authenticated LeafLink RETAILER (Greenway Marijuana, company slug
 * greenway-marijuana, company id 3053) pulling seller menus into the back
 * office for the PO builder.
 *
 * Every field name below was pinned from a LIVE authenticated probe of the
 * real endpoints `shop/products/` (search rows), `brands/<id>` (brand
 * header) and `brands/<id>/products?product_lines=1` (a brand's full menu,
 * detail-shaped rows) — see crawler/docs/LEAFLINK_PINNED.md. We do NOT
 * guess: unknown shapes fall through the tolerant coercers and the RAW
 * payload is preserved so parsers can be revised without re-fetching.
 *
 * Pinned money gotcha: `wholesale_price` arrives as an object
 * {amount:"112.50",currency:"USD"}, a bare NUMBER 60, or a STRING "60.00" —
 * the shipped moneyToMinor handles all three (object → amount key). Pinned
 * quantity gotcha: `quantity` is a stringified decimal ("1857.000000").
 * Pinned images gotcha: `images` is an array of plain URL STRINGS.
 *
 * The output shape is the SAME CultiveraMenuItem/GrowflowMenuItem-compatible
 * item the rest of the command center already consumes, so the unified menus
 * UI, media saves, and PO hand-off work identically regardless of platform.
 */
import {
  asText,
  numOrNull,
  intOrNull,
  moneyToMinor,
  normalizeStrainType,
  type StrainType,
} from "./cultivera-menu-core";

/**
 * One normalized LeafLink product line. Structurally compatible with
 * CultiveraMenuItem/GrowflowMenuItem (same field names) plus LeafLink-only
 * extras (productLine, sku) the shared UI can optionally use.
 */
export type LeaflinkMenuItem = {
  leaflinkItemId: string | null;
  name: string | null;
  brand: string | null;
  category: string | null;
  inventoryType: string | null;
  strainType: StrainType;
  strainName: string | null;
  sizeLabel: string | null;
  unitCount: number | null;
  /** Wholesale price in integer minor units (cents). Null if unknown. */
  wholesalePriceMinor: number | null;
  /** Suggested retail in integer minor units (cents). Null if unknown. */
  msrpMinor: number | null;
  availableQty: number | null;
  thcPct: number | null;
  cbdPct: number | null;
  totalCannabinoidsPct: number | null;
  potencyRaw: Record<string, unknown>;
  description: string | null;
  imageUrl: string | null;
  /** Additional image URLs (LeafLink returns an array of plain strings). */
  images: string[];
  coaUrl: string | null;
  /** LeafLink product-line grouping ("Papers", "Gummies") when known. */
  productLine: string | null;
  sku: string | null;
  raw: Record<string, unknown>;
  position: number;
};

export type LeaflinkSnapshot = {
  leaflinkBrandId: string | null;
  brandName: string | null;
  companyName: string | null;
  brandDescription: string | null;
  itemCount: number;
  items: LeaflinkMenuItem[];
  raw: Record<string, unknown>;
};

/** A brand hit as grouped by the crawler worker's product search (LL-2). */
export type LeaflinkBrandHit = {
  brandId: string | null;
  brandName: string | null;
  companyId: string | null;
  companyName: string | null;
  productCount: number;
  sampleImage: string | null;
  raw: Record<string, unknown>;
};

/* --------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------ */

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/**
 * LeafLink descriptions are HTML strings ("<p>Our best seller…</p>" — pinned
 * live). Strip tags + decode the common entities so the stored description is
 * the same plain prose the other platforms save. NOT a sanitizer (we never
 * render this as HTML) — just a tolerant text extraction. "" -> null.
 */
export function htmlToPlainText(v: unknown): string | null {
  const s = asText(v);
  if (!s) return null;
  const text = s
    // <br> becomes a line break; block-level closers become paragraph breaks.
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|li|h[1-6]|tr)\s*>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/gi, "'")
    // Collapse horizontal whitespace, trim around breaks, cap blank lines at 1.
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || null;
}

/**
 * Pull one named spec's value out of LeafLink's product_specs /
 * product_data_items ([{name:"THC", value:"100 mg"}] — pinned). Name match is
 * case-insensitive. Null when absent.
 */
export function specValue(specs: unknown, name: string): string | null {
  if (!Array.isArray(specs)) return null;
  const want = name.trim().toLowerCase();
  for (const entry of specs) {
    const o = asObject(entry);
    const n = asText(o.name);
    if (n && n.trim().toLowerCase() === want) {
      return asText(o.value);
    }
  }
  return null;
}

/**
 * A spec value → percentage number ONLY when it is explicitly a percentage
 * ("22.5%" → 22.5). LeafLink specs are often mg amounts ("100 mg" — pinned),
 * which are NOT percentages; converting mg to % would be a guess, so those
 * return null (the raw spec is preserved in potencyRaw).
 */
export function pctFromSpecValue(value: unknown): number | null {
  const s = asText(value);
  if (!s || !s.includes("%")) return null;
  const n = numOrNull(s.replace(/%/g, "").trim());
  return n;
}

/** The specs array from either pinned key (product_specs / product_data_items). */
function specsOf(o: Record<string, unknown>): unknown[] {
  if (Array.isArray(o.product_specs)) return o.product_specs;
  if (Array.isArray(o.product_data_items)) return o.product_data_items;
  return [];
}

/** LeafLink images: an array of plain URL strings (pinned). Junk dropped. */
export function imageList(o: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (Array.isArray(o.images)) {
    for (const entry of o.images) {
      const u = asText(entry);
      if (u) out.push(u);
    }
  }
  const featured = asText(o.featured_image);
  if (featured && !out.includes(featured)) out.push(featured);
  return out;
}

/* --------------------------------------------------------------------------
 * Brand hit normalizer — from the worker's grouped search records
 * ------------------------------------------------------------------------ */

export function normalizeBrandHit(raw: unknown): LeaflinkBrandHit {
  const o = asObject(raw);
  return {
    brandId: asText(o.brand_id),
    brandName: asText(o.brand_name),
    companyId: asText(o.company_id),
    companyName: asText(o.company_name),
    productCount: intOrNull(o.product_count) ?? 0,
    sampleImage: asText(o.sample_image),
    raw: o,
  };
}

/* --------------------------------------------------------------------------
 * Menu item normalizer — from brand-menu / product-detail rows
 * ------------------------------------------------------------------------ */

export function normalizeMenuItem(raw: unknown, position: number): LeaflinkMenuItem {
  const o = asObject(raw);

  const brand = asObject(o.brand);
  const category = asObject(o.category);
  const subCategory = asObject(o.sub_category);
  const specs = specsOf(o);
  const images = imageList(o);

  // Pinned: display_price_unit is the human pack label ("Case (18 Units)");
  // unit_denomination.label is the per-unit size ("100 mg"). Prefer the pack.
  const unitDenomination = asObject(o.unit_denomination);
  const sizeLabel = asText(o.display_price_unit) ?? asText(unitDenomination.label);

  return {
    leaflinkItemId: asText(o.id),
    name: asText(o.display_name) ?? asText(o.name),
    brand: asText(brand.name),
    category: asText(category.name),
    inventoryType: asText(subCategory.name),
    // Pinned: strain_classification is "–" when n/a; normalizeStrainType copes.
    strainType: normalizeStrainType(o.strain_classification),
    strainName: asText(o.strain_names),
    sizeLabel,
    unitCount: intOrNull(o.unit_multiplier),
    // Pinned: wholesale_price is {amount:"112.50",currency} OR 60 OR "60.00".
    wholesalePriceMinor: moneyToMinor(o.wholesale_price ?? o.sale_price ?? o.base_price),
    msrpMinor: moneyToMinor(o.retail_price),
    // Pinned: quantity is a stringified decimal ("1857.000000").
    availableQty: numOrNull(o.quantity),
    thcPct: pctFromSpecValue(specValue(specs, "THC")),
    cbdPct: pctFromSpecValue(specValue(specs, "CBD")),
    totalCannabinoidsPct: pctFromSpecValue(specValue(specs, "Total Cannabinoids")),
    // The raw specs ride along so mg-denominated potency is never lost.
    potencyRaw: { specs },
    description: htmlToPlainText(o.description),
    imageUrl: images[0] ?? null,
    images,
    coaUrl: null, // Not exposed by the pinned endpoints; tolerated as absent.
    productLine: asText(o.product_line),
    sku: asText(o.sku),
    raw: o,
    position,
  };
}

/* --------------------------------------------------------------------------
 * Snapshot normalizer — from the worker's {brand, products} payload
 * ------------------------------------------------------------------------ */

export function normalizeSnapshot(input: unknown): LeaflinkSnapshot {
  const env = asObject(input);
  const brandHeader = asObject(env.brand);
  const productsRaw = Array.isArray(env.products) ? env.products : [];
  const items = productsRaw.map((p, i) => normalizeMenuItem(p, i));

  // Brand header (pinned: brands/<id>): {id, name, company, description, ...}.
  // `company` may be an object ({id,name}) or a bare value — tolerate both.
  const company = brandHeader.company;
  const companyName =
    asText(asObject(company).name) ?? (typeof company === "string" ? asText(company) : null);

  return {
    leaflinkBrandId: asText(brandHeader.id),
    brandName: asText(brandHeader.name),
    companyName,
    brandDescription: htmlToPlainText(brandHeader.description),
    itemCount: items.length,
    items,
    raw: env,
  };
}

/* --------------------------------------------------------------------------
 * Self-tests (pure runner) — grounded in the LIVE-probed shapes.
 * ------------------------------------------------------------------------ */

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`leaflink-menu-core self-test failed: ${msg}`);
}

export function __runLeaflinkMenuCoreTests(): void {
  // --- htmlToPlainText ------------------------------------------------------
  assert(
    htmlToPlainText("<p>Our <b>best</b> seller &amp; more</p>") === "Our best seller & more",
    "html stripped + entity decoded",
  );
  assert(
    htmlToPlainText("<p>One</p><p>Two</p>") === "One\n\nTwo",
    "paragraphs become blank-line breaks",
  );
  assert(htmlToPlainText("Line<br/>Break") === "Line\nBreak", "br becomes newline");
  assert(htmlToPlainText("plain text") === "plain text", "plain passthrough");
  assert(htmlToPlainText("<p>&nbsp;</p>") === null, "whitespace-only -> null");
  assert(htmlToPlainText(null) === null, "null -> null");
  assert(htmlToPlainText("&quot;hi&quot; &#39;there&#39;") === "\"hi\" 'there'", "quote entities");

  // --- specValue / pctFromSpecValue ------------------------------------------
  const specs = [
    { name: "THC", value: "100 mg" },
    { name: "CBD", value: "0.3%" },
  ];
  assert(specValue(specs, "thc") === "100 mg", "spec lookup case-insensitive");
  assert(specValue(specs, "CBD") === "0.3%", "spec lookup exact");
  assert(specValue(specs, "Terpenes") === null, "missing spec -> null");
  assert(specValue("junk", "THC") === null, "non-array specs -> null");
  assert(pctFromSpecValue("22.5%") === 22.5, "pct parsed");
  assert(pctFromSpecValue("100 mg") === null, "mg is NOT a percentage");
  assert(pctFromSpecValue(null) === null, "null pct");

  // --- normalizeBrandHit ------------------------------------------------------
  const hit = normalizeBrandHit({
    brand_id: 11765,
    brand_name: "Blazy Susan",
    company_id: 20774,
    company_name: "Blazy Susan LLC",
    product_count: 16,
    sample_image: "https://d3nec6hp1jgjd8.cloudfront.net/media/x.png",
  });
  assert(hit.brandId === "11765", "hit brand id");
  assert(hit.brandName === "Blazy Susan", "hit brand name");
  assert(hit.companyName === "Blazy Susan LLC", "hit company name");
  assert(hit.productCount === 16, "hit product count");
  assert(hit.sampleImage?.includes("cloudfront") === true, "hit sample image");
  const hitEmpty = normalizeBrandHit(null);
  assert(hitEmpty.brandId === null && hitEmpty.productCount === 0, "empty hit tolerated");

  // --- menu item (real probed detail-shaped row) ------------------------------
  const item = normalizeMenuItem(
    {
      id: 4451353,
      name: "Sour Watermelon Gummies",
      display_name: "Smokiez Sour Watermelon Fruit Chews",
      brand: { id: 3059, name: "Smokiez Edibles", company: { id: 1200, name: "Smokiez WA" } },
      category: { id: 7, name: "Edibles", slug: "edibles" },
      sub_category: { id: 31, name: "Gummies" },
      unit_denomination: { value: 100, label: "100 mg" },
      unit_multiplier: 18,
      unit_of_measure: "Unit",
      display_price_unit: "Case (18 Units)",
      strain_classification: "–",
      strain_names: "Watermelon OG",
      wholesale_price: { amount: "112.50", currency: "USD" },
      retail_price: { amount: "10.00", currency: "USD" },
      quantity: "1857.000000",
      description: "<p>Our <b>best</b> seller</p>",
      product_specs: [
        { name: "THC", value: "100 mg" },
        { name: "CBD", value: "0.3%" },
      ],
      images: [
        "https://d3nec6hp1jgjd8.cloudfront.net/media/one.png",
        "https://d3nec6hp1jgjd8.cloudfront.net/media/two.png",
      ],
      featured_image: "https://d3nec6hp1jgjd8.cloudfront.net/media/one.png",
      sku: "SMKZ-SW-100",
      product_line: "Fruit Chews",
    },
    0,
  );
  assert(item.leaflinkItemId === "4451353", "item id");
  assert(item.name === "Smokiez Sour Watermelon Fruit Chews", "display_name preferred");
  assert(item.brand === "Smokiez Edibles", "brand from nested object");
  assert(item.category === "Edibles", "category name");
  assert(item.inventoryType === "Gummies", "sub_category as inventory type");
  // money object {amount:"112.50"} -> cents
  assert(item.wholesalePriceMinor === 11250, "wholesale 112.50 -> 11250 cents");
  assert(item.msrpMinor === 1000, "retail 10.00 -> 1000 cents");
  // stringified decimal quantity
  assert(item.availableQty === 1857, "quantity string decimal -> 1857");
  assert(item.unitCount === 18, "unit_multiplier -> unitCount");
  assert(item.sizeLabel === "Case (18 Units)", "display_price_unit as size");
  assert(item.strainType === "unknown", "'–' strain classification -> unknown");
  assert(item.strainName === "Watermelon OG", "strain names");
  assert(item.thcPct === null, "THC '100 mg' NOT coerced to a pct");
  assert(item.cbdPct === 0.3, "CBD '0.3%' -> 0.3");
  assert(item.description === "Our best seller", "HTML description -> plain text");
  assert(item.images.length === 2, "two images (featured deduped)");
  assert(item.imageUrl?.endsWith("one.png") === true, "first image is imageUrl");
  assert(item.productLine === "Fruit Chews", "product line");
  assert(item.sku === "SMKZ-SW-100", "sku");
  assert(item.position === 0, "position threaded");

  // money variants pinned live: bare number and bare string dollars
  const itemNum = normalizeMenuItem({ id: 1, wholesale_price: 60 }, 1);
  assert(itemNum.wholesalePriceMinor === 6000, "number 60 -> 6000 cents");
  const itemStr = normalizeMenuItem({ id: 2, wholesale_price: "60.00" }, 2);
  assert(itemStr.wholesalePriceMinor === 6000, "string '60.00' -> 6000 cents");

  // featured_image only (search-row shape) still yields an image
  const itemFeat = normalizeMenuItem(
    { id: 3, featured_image: "https://cdn.example/f.png" },
    3,
  );
  assert(itemFeat.imageUrl === "https://cdn.example/f.png", "featured_image fallback");
  assert(itemFeat.images.length === 1, "featured-only image list");

  // --- snapshot ----------------------------------------------------------------
  const snap = normalizeSnapshot({
    brand: {
      id: 11765,
      name: "Blazy Susan",
      company: { id: 20774, name: "Blazy Susan LLC" },
      description: "<p>Pink papers &amp; more</p>",
    },
    products: [
      { id: 10, name: "A", wholesale_price: "25.50" },
      { id: 11, name: "B", wholesale_price: 10 },
    ],
  });
  assert(snap.leaflinkBrandId === "11765", "snapshot brand id");
  assert(snap.brandName === "Blazy Susan", "snapshot brand name");
  assert(snap.companyName === "Blazy Susan LLC", "snapshot company name");
  assert(snap.brandDescription === "Pink papers & more", "brand description plain");
  assert(snap.itemCount === 2, "two items");
  assert(snap.items[0].wholesalePriceMinor === 2550, "25.50 -> 2550 cents");
  assert(snap.items[1].wholesalePriceMinor === 1000, "10 -> 1000 cents");

  // empty / junk tolerant
  assert(normalizeSnapshot({}).itemCount === 0, "empty snapshot");
  assert(normalizeSnapshot(null).items.length === 0, "null snapshot");
  assert(normalizeMenuItem(null, 0).leaflinkItemId === null, "null item tolerated");

  console.log("leaflink-menu-core: self-tests passed");
}
