/**
 * src/lib/purchasing/cultivera-menu-core.ts
 *
 * PURE normalizers for Cultivera vendor-menu snapshots (Slice CV-1).
 *
 * The crawler logs into Cultivera's marketplace and fetches a vendor's LIVE menu
 * over the JSON API. Cultivera's exact field names get PINNED from a real
 * authenticated probe in CV-2/CV-3 before anything relies on them — so this core
 * is deliberately TOLERANT: every getter reads several plausible key spellings
 * and coerces defensively, so a shape drift degrades gracefully (nulls) instead
 * of throwing. Nothing here touches the network, Supabase, or the DOM; it is
 * 100% pure and self-tested (see __runCultiveraMenuCoreTests at the bottom).
 *
 * Money is INTEGER MINOR UNITS (cents), never floats — matching migration 0124
 * (cultivera_menu_items.wholesale_price_minor integer). Percentages are plain
 * numbers (e.g. 22.5 for "22.5%"). The raw payload is always preserved.
 *
 * Field names mirror the 0124 columns exactly:
 *   cultiveraItemId  -> cultivera_item_id     wholesalePriceMinor -> wholesale_price_minor
 *   sizeLabel        -> size_label            unitCount           -> unit_count
 *   strainType       -> strain_type           potencyRaw          -> potency_raw
 *   thcPct/cbdPct/totalCannabinoidsPct, imageUrl, coaUrl, raw, position
 */

export type StrainType = "sativa" | "indica" | "hybrid" | "cbd" | "unknown";

export type CultiveraMenuItem = {
  cultiveraItemId: string | null;
  name: string | null;
  brand: string | null;
  category: string | null;
  inventoryType: string | null;
  strainType: StrainType;
  sizeLabel: string | null;
  unitCount: number | null;
  /** Wholesale price in integer minor units (cents). Null if unknown. */
  wholesalePriceMinor: number | null;
  availableQty: number | null;
  thcPct: number | null;
  cbdPct: number | null;
  totalCannabinoidsPct: number | null;
  potencyRaw: Record<string, unknown>;
  description: string | null;
  imageUrl: string | null;
  coaUrl: string | null;
  raw: Record<string, unknown>;
  position: number;
};

export type CultiveraSnapshot = {
  cultiveraMarketId: string | null;
  cultiveraMarketSlug: string | null;
  sellerName: string | null;
  locationId: string | null;
  itemCount: number;
  items: CultiveraMenuItem[];
  raw: Record<string, unknown>;
};

/* --------------------------------------------------------------------------
 * Primitive coercers — tolerant, total, side-effect free.
 * ------------------------------------------------------------------------ */

/** Read a value as trimmed text, or null. Numbers/booleans stringify. */
export function asText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    const t = v.trim();
    return t.length ? t : null;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return null;
}

/** First non-null asText() across candidate keys of an object. */
function pickText(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    if (k in obj) {
      const t = asText(obj[k]);
      if (t !== null) return t;
    }
  }
  return null;
}

/** First present raw value across candidate keys (may be object/array/etc). */
function pickRaw(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (k in obj && obj[k] !== null && obj[k] !== undefined) return obj[k];
  }
  return undefined;
}

/** Parse a finite number from string/number, stripping currency/commas/%. */
export function numOrNull(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const cleaned = v.replace(/[^0-9.\-]/g, "");
    if (!cleaned || cleaned === "-" || cleaned === "." || cleaned === "-.") return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Parse a non-negative integer (floors), or null. */
export function intOrNull(v: unknown): number | null {
  const n = numOrNull(v);
  if (n === null) return null;
  const i = Math.trunc(n);
  return Number.isFinite(i) ? i : null;
}

/**
 * Convert a money value to INTEGER MINOR UNITS (cents).
 * Accepts numbers (dollars), numeric strings ("$12.50", "12,50"? -> no, dot
 * only), or an object like { amount: 1250, currency }/{ minor: 1250 } where the
 * amount may already be minor units. Rounds half-up. Null if unparseable.
 *
 * Heuristic for objects: if a `minor`/`cents`/`amount_minor` key exists we take
 * it as already-minor; otherwise a plain `amount`/`value`/number is dollars.
 */
export function moneyToMinor(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    return Math.round(v * 100);
  }
  if (typeof v === "string") {
    const n = numOrNull(v);
    if (n === null) return null;
    return Math.round(n * 100);
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const minor = pickRaw(o, ["minor", "cents", "amount_minor", "amountMinor", "minorUnits"]);
    if (minor !== undefined) {
      const m = intOrNull(minor);
      return m === null ? null : m;
    }
    const dollars = pickRaw(o, ["amount", "value", "price", "dollars"]);
    if (dollars !== undefined) return moneyToMinor(dollars);
  }
  return null;
}

/** Format integer minor units as "$12.50". Null -> "". */
export function formatMinor(minor: number | null): string {
  if (minor === null || !Number.isFinite(minor)) return "";
  const neg = minor < 0;
  const abs = Math.abs(Math.trunc(minor));
  const dollars = Math.floor(abs / 100);
  const cents = abs % 100;
  return `${neg ? "-" : ""}$${dollars}.${String(cents).padStart(2, "0")}`;
}

/**
 * Parse a potency percentage to a plain number (e.g. "22.5%" -> 22.5).
 * If the value looks like a fraction (0..1) with no % sign we DO NOT rescale —
 * Cultivera reports percentages, and rescaling would be a guess. Null if empty.
 */
export function pctToNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = numOrNull(v);
    return n;
  }
  return null;
}

const STRAIN_MAP: Array<[RegExp, StrainType]> = [
  [/\bsativa\b/i, "sativa"],
  [/\bindica\b/i, "indica"],
  [/\bhybrid\b/i, "hybrid"],
  [/\bcbd\b/i, "cbd"],
];

/** Normalize a free-text strain descriptor to a known bucket. */
export function normalizeStrainType(v: unknown): StrainType {
  const t = asText(v);
  if (!t) return "unknown";
  for (const [re, bucket] of STRAIN_MAP) if (re.test(t)) return bucket;
  return "unknown";
}

/**
 * Infer a pack/unit count from a size label like "10pk", "5 pack", "2-count".
 * Returns null when no count is expressed (a single-unit gram weight etc.).
 */
export function packCountFromLabel(label: unknown): number | null {
  const t = asText(label);
  if (!t) return null;
  const m = t.match(/(\d+)\s*[-\s]?\s*(?:x|pk|pack|packs|ct|count|cnt)\b/i);
  if (m) {
    const n = Number(m[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

/* --------------------------------------------------------------------------
 * Item + snapshot normalizers.
 * ------------------------------------------------------------------------ */

/** Normalize one raw Cultivera listing into a CultiveraMenuItem at `position`. */
export function normalizeMenuItem(raw: unknown, position: number): CultiveraMenuItem {
  const o: Record<string, unknown> =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  const sizeLabel = pickText(o, ["size", "sizeLabel", "size_label", "unitSize", "unit_size", "packageSize", "weight", "Size", "PackageSize"]);
  const unitCountRaw = pickRaw(o, ["unitCount", "unit_count", "units", "packSize", "pack_size", "quantityPerUnit"]);
  const unitCount = intOrNull(unitCountRaw) ?? packCountFromLabel(sizeLabel);

  // Price keys include Cultivera's LIVE-probed `MinPrice` (dollar float on the
  // POST /listings/market/{id} product list). See probe/CULTIVERA_PINNED.md.
  const priceRaw = pickRaw(o, [
    "wholesalePrice", "wholesale_price", "unitPrice", "unit_price",
    "price", "priceMinor", "price_minor", "cost",
    "MinPrice", "Price", "UnitPrice",
  ]);

  const potencyRawVal = pickRaw(o, ["potency", "potencyRaw", "potency_raw", "cannabinoids", "labResults", "lab_results"]);
  const potencyRaw: Record<string, unknown> =
    potencyRawVal && typeof potencyRawVal === "object" && !Array.isArray(potencyRawVal)
      ? (potencyRawVal as Record<string, unknown>)
      : {};

  // THC / CBD / total may live at the top level or inside a potency object.
  const thc = pickRaw(o, ["thc", "thcPct", "thc_pct", "thcPercent", "thc_percent"]) ??
    pickRaw(potencyRaw, ["thc", "thcPct", "thc_pct", "THC", "thcTotal", "totalThc", "total_thc"]);
  const cbd = pickRaw(o, ["cbd", "cbdPct", "cbd_pct", "cbdPercent", "cbd_percent"]) ??
    pickRaw(potencyRaw, ["cbd", "cbdPct", "cbd_pct", "CBD", "cbdTotal", "totalCbd", "total_cbd"]);
  const total = pickRaw(o, ["totalCannabinoids", "total_cannabinoids", "totalCannabinoidsPct", "total_cannabinoids_pct"]) ??
    pickRaw(potencyRaw, ["totalCannabinoids", "total_cannabinoids", "total", "totalActive"]);

  return {
    // Key lists include Cultivera's LIVE-probed PascalCase fields (Id, Cid,
    // Name, ImageUrl) from the real product list. See probe/CULTIVERA_PINNED.md.
    cultiveraItemId: pickText(o, ["id", "listingId", "listing_id", "itemId", "item_id", "productId", "product_id", "sku", "Id", "Cid"]),
    name: pickText(o, ["name", "productName", "product_name", "title", "listingName", "listing_name", "Name"]),
    brand: pickText(o, ["brand", "brandName", "brand_name", "producer", "vendor", "vendorName", "Brand", "BrandName"]),
    category: pickText(o, ["category", "categoryName", "category_name", "productType", "product_type", "type", "Category", "CategoryName"]),
    inventoryType: pickText(o, ["inventoryType", "inventory_type", "inventoryCategory", "unitOfMeasure", "uom", "InventoryType"]),
    strainType: normalizeStrainType(pickRaw(o, ["strainType", "strain_type", "strain", "classification", "lineage"])),
    sizeLabel,
    unitCount,
    wholesalePriceMinor: moneyToMinor(priceRaw),
    availableQty: numOrNull(pickRaw(o, ["availableQty", "available_qty", "quantity", "qty", "available", "inventoryCount", "stock", "Available", "AvailableQty"])),
    thcPct: pctToNumber(thc),
    cbdPct: pctToNumber(cbd),
    totalCannabinoidsPct: pctToNumber(total),
    potencyRaw,
    description: pickText(o, ["description", "productDescription", "product_description", "summary", "details", "longDescription", "Description"]),
    imageUrl: pickText(o, ["imageUrl", "image_url", "image", "imageURL", "thumbnail", "thumbnailUrl", "photoUrl", "primaryImage", "ImageUrl", "Image", "ImageURL"]),
    coaUrl: pickText(o, ["coaUrl", "coa_url", "coa", "labResultUrl", "lab_result_url", "coaPdf", "coaDocument", "certificateUrl", "CoaUrl", "COAUrl"]),
    raw: o,
    position,
  };
}

/**
 * Normalize a whole snapshot input. `items` may arrive under several keys or as
 * the top-level array itself; snapshot metadata is read tolerantly.
 */
export function normalizeSnapshot(input: unknown): CultiveraSnapshot {
  // Accept either an object envelope or a bare array of items.
  let root: Record<string, unknown> = {};
  let itemsRaw: unknown = undefined;

  if (Array.isArray(input)) {
    itemsRaw = input;
  } else if (input && typeof input === "object") {
    root = input as Record<string, unknown>;
    // Cultivera's LIVE-probed menu envelope is PascalCase: { Data: [...] }
    // (POST /listings/market/<id> -> { Data, Count, TimeStamp }). Keep the
    // lowercase variants too so older/other shapes still normalize.
    itemsRaw = pickRaw(root, ["Data", "items", "listings", "products", "menu", "data", "results", "menuItems", "menu_items"]);
    // If the picked value is itself an envelope, unwrap one common level.
    if (itemsRaw && typeof itemsRaw === "object" && !Array.isArray(itemsRaw)) {
      const inner = itemsRaw as Record<string, unknown>;
      const nested = pickRaw(inner, ["Data", "items", "listings", "products", "results", "data"]);
      if (Array.isArray(nested)) itemsRaw = nested;
    }
  }

  const arr = Array.isArray(itemsRaw) ? itemsRaw : [];
  const items = arr.map((r, i) => normalizeMenuItem(r, i));

  return {
    cultiveraMarketId: pickText(root, ["marketId", "market_id", "cultiveraMarketId", "id", "sellerId", "seller_id"]),
    cultiveraMarketSlug: pickText(root, ["slug", "marketSlug", "market_slug", "cultiveraMarketSlug", "handle"]),
    sellerName: pickText(root, ["sellerName", "seller_name", "name", "businessName", "business_name", "vendorName", "displayName"]),
    locationId: pickText(root, ["locationId", "location_id", "activeLocationId"]),
    itemCount: items.length,
    items,
    raw: Array.isArray(input) ? { items: input } : root,
  };
}

/* --------------------------------------------------------------------------
 * Product DETAIL (per-variant) normalizers — CH-2.
 *
 * Pinned from a LIVE authenticated probe of Cultivera's own storefront (see
 * probe/CULTIVERA_PINNED.md): GET /listings/{productId}/market/{marketId}
 * returns ONE product-line object whose `Products` array holds the per-size
 * variants. Verified variant keys: Id, Name, Description (lineage), Uom,
 * UnitPrice (DOLLAR float), ImageUrl, AvailableQuantity, UnitSize (grams),
 * MaxOrderLimit, MinOrderLimit, QuantityIncreament, SortOrder, IsDOHComplaint.
 * Variant Name embeds size/strain/DOH in brackets, e.g.
 * "Wedding Cake [3.5g] [Indica] [D.O.H. COMPLIANT]".
 *
 * Same tolerance rules as above: several key spellings per field, dollars ->
 * integer cents via moneyToMinor, junk degrades to nulls, raw preserved.
 * ------------------------------------------------------------------------ */

export type CultiveraVariant = {
  /** Cultivera's numeric variant id, as text (stable for re-fetch diffing). */
  variantId: string | null;
  /** Full name exactly as Cultivera sent it (brackets included). */
  name: string | null;
  /** Name with the bracketed size/strain/DOH tags stripped. */
  cleanName: string | null;
  strainType: StrainType;
  /** "3.5g" — from the Name brackets, else derived from UnitSize grams. */
  sizeLabel: string | null;
  /** Unit weight in grams (Cultivera's UnitSize), when present. */
  unitSizeGrams: number | null;
  /**
   * EFFECTIVE wholesale price per unit in INTEGER MINOR UNITS (cents) — i.e.
   * what the buyer actually pays. When the vendor applies a discount this is
   * the SALE price (Cultivera's `ProductDiscount.Price`); otherwise it is the
   * list `UnitPrice`. Never a float. Downstream (PO builder) uses THIS.
   */
  unitPriceMinor: number | null;
  /**
   * ORIGINAL / pre-discount price in cents (Cultivera's `UnitPrice`) — set
   * ONLY when a discount is active, for the struck-through "was" display.
   * Null when there is no discount (nothing to strike through).
   */
  wasPriceMinor: number | null;
  /** True when a vendor discount is active (effective < original). */
  onSale: boolean;
  availableQty: number | null;
  /** Vendor-imposed per-order cap (null = uncapped). */
  maxOrderLimit: number | null;
  /** Lineage / cross text (Cultivera puts it in the variant Description). */
  description: string | null;
  imageUrl: string | null;
  isDohCompliant: boolean;
  raw: Record<string, unknown>;
  position: number;
};

export type CultiveraProductDetail = {
  /** Cultivera's numeric product-line id, as text. */
  productId: string | null;
  name: string | null;
  description: string | null;
  imageUrl: string | null;
  isDohCompliant: boolean;
  variantCount: number;
  variants: CultiveraVariant[];
  raw: Record<string, unknown>;
};

/** Parsed bracket tags from a variant name like "X [3.5g] [Indica] [D.O.H. COMPLIANT]". */
export type VariantNameParts = {
  cleanName: string | null;
  sizeLabel: string | null;
  strainType: StrainType;
  dohTagged: boolean;
};

const SIZE_TAG_RE = /^\d+(?:\.\d+)?\s*(?:g|mg|kg|oz|ml|l)$/i;

/**
 * Split a Cultivera variant Name into its bracketed tags. Unrecognized tags
 * are simply dropped from the clean name but never break parsing.
 */
export function parseVariantName(v: unknown): VariantNameParts {
  const t = asText(v);
  if (!t) return { cleanName: null, sizeLabel: null, strainType: "unknown", dohTagged: false };
  let sizeLabel: string | null = null;
  let strainType: StrainType = "unknown";
  let dohTagged = false;
  const clean = t
    .replace(/\[([^\]]*)\]/g, (_m, inner: string) => {
      const tag = inner.trim();
      if (!tag) return "";
      if (SIZE_TAG_RE.test(tag)) {
        if (sizeLabel === null) sizeLabel = tag.replace(/\s+/g, "").toLowerCase();
      } else if (/d\.?\s*o\.?\s*h\.?/i.test(tag) || /\bdoh\b/i.test(tag)) {
        dohTagged = true;
      } else {
        const s = normalizeStrainType(tag);
        if (s !== "unknown" && strainType === "unknown") strainType = s;
      }
      return "";
    })
    .replace(/\s{2,}/g, " ")
    .trim();
  return { cleanName: clean.length ? clean : null, sizeLabel, strainType, dohTagged };
}

/** "3.5" -> "3.5g", 1 -> "1g". Null when the grams value is missing/junk. */
export function sizeLabelFromGrams(grams: unknown): string | null {
  const n = numOrNull(grams);
  if (n === null || n <= 0) return null;
  // Trim trailing zeros ("1.0" -> "1", "3.50" -> "3.5") without float drift.
  const s = String(n);
  return `${s}g`;
}

/** Tolerant truthiness for Cultivera booleans (true, "true", 1). */
export function boolish(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1;
  if (typeof v === "string") return v.trim().toLowerCase() === "true" || v.trim() === "1";
  return false;
}

/** Normalize one raw per-size variant (a `Products[]` entry) at `position`. */
export function normalizeVariant(raw: unknown, position: number): CultiveraVariant {
  const o: Record<string, unknown> =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  const name = pickText(o, ["Name", "name", "productName", "product_name"]);
  const parts = parseVariantName(name);
  const unitSizeGrams = numOrNull(pickRaw(o, ["UnitSize", "unitSize", "unit_size"]));

  // Pricing (LIVE-probed): Cultivera's `UnitPrice` is the ORIGINAL/list price;
  // an active vendor discount carries the real SALE price under
  // `ProductDiscount.Price`. The buyer pays the sale price when present, so the
  // EFFECTIVE unitPriceMinor is the discount price if any, else the list price.
  // We surface the original as wasPriceMinor for a struck-through display, but
  // ONLY when it is genuinely higher than the effective price (a real discount).
  const listPriceMinor = moneyToMinor(pickRaw(o, ["UnitPrice", "unitPrice", "unit_price", "price", "Price"]));
  const discountRaw = pickRaw(o, ["ProductDiscount", "productDiscount", "product_discount", "Discount", "discount"]);
  const discountObj: Record<string, unknown> =
    discountRaw && typeof discountRaw === "object" && !Array.isArray(discountRaw)
      ? (discountRaw as Record<string, unknown>)
      : {};
  const salePriceMinor = moneyToMinor(pickRaw(discountObj, ["Price", "price", "DiscountPrice", "discountPrice", "amount", "Amount"]));
  const hasRealDiscount =
    salePriceMinor != null && listPriceMinor != null && salePriceMinor < listPriceMinor;
  const effectiveMinor = hasRealDiscount ? salePriceMinor : listPriceMinor;

  return {
    variantId: pickText(o, ["Id", "id", "variantId", "variant_id", "ExternalId"]),
    name,
    cleanName: parts.cleanName,
    strainType: parts.strainType,
    sizeLabel: parts.sizeLabel ?? sizeLabelFromGrams(unitSizeGrams),
    unitSizeGrams,
    unitPriceMinor: effectiveMinor,
    wasPriceMinor: hasRealDiscount ? listPriceMinor : null,
    onSale: hasRealDiscount,
    availableQty: intOrNull(pickRaw(o, ["AvailableQuantity", "availableQuantity", "available_quantity", "AvailableQty", "availableQty", "available_qty"])),
    maxOrderLimit: intOrNull(pickRaw(o, ["MaxOrderLimit", "maxOrderLimit", "max_order_limit"])),
    description: pickText(o, ["Description", "description"]),
    imageUrl: pickText(o, ["ImageUrl", "imageUrl", "image_url", "Image", "image"]),
    isDohCompliant: boolish(pickRaw(o, ["IsDOHComplaint", "IsDohCompliant", "isDohCompliant", "is_doh_compliant"])) || parts.dohTagged,
    raw: o,
    position,
  };
}

/**
 * Normalize a whole product-DETAIL payload (the raw response of
 * GET /listings/{productId}/market/{marketId}). Tolerant of envelope drift;
 * junk input yields an empty detail, never a throw.
 */
export function normalizeProductDetail(input: unknown): CultiveraProductDetail {
  const o: Record<string, unknown> =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};

  const variantsRaw = pickRaw(o, ["Products", "products", "variants", "Variants", "items"]);
  const arr = Array.isArray(variantsRaw) ? variantsRaw : [];
  const variants = arr.map((v, i) => normalizeVariant(v, i));

  return {
    productId: pickText(o, ["Id", "id", "productId", "product_id"]),
    name: pickText(o, ["Name", "name"]),
    description: pickText(o, ["Description", "description"]),
    imageUrl: pickText(o, ["ImageUrl", "imageUrl", "image_url"]),
    isDohCompliant: boolish(pickRaw(o, ["IsDOHComplaint", "IsDohCompliant", "isDohCompliant"])),
    variantCount: variants.length,
    variants,
    raw: o,
  };
}

/**
 * Reserved key under which a fetched product-DETAIL payload is stored inside
 * the item row's `raw` jsonb (no schema change — the owner has applied all
 * migrations). cultivera-store.saveItemDetail writes it; readers use
 * detailFromItemRaw to rebuild variants FROM OUR OWN DATABASE (W11).
 */
export const ITEM_DETAIL_RAW_KEY = "__cultivera_detail";
export const ITEM_DETAIL_FETCHED_AT_KEY = "__cultivera_detail_fetched_at";

/** Read + normalize a stored detail payload out of an item row's raw jsonb. */
export function detailFromItemRaw(raw: unknown): CultiveraProductDetail | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const payload = (raw as Record<string, unknown>)[ITEM_DETAIL_RAW_KEY];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  return normalizeProductDetail(payload);
}

/* --------------------------------------------------------------------------
 * Self-tests (registered in scripts/compliance/run-pure-selftests.ts and
 * mirrored in tests/compliance/cultivera-menu-core.test.ts).
 * ------------------------------------------------------------------------ */

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`cultivera-menu-core self-test failed: ${msg}`);
}

export function __runCultiveraMenuCoreTests(): void {
  // asText
  assert(asText("  hi ") === "hi", "asText trims");
  assert(asText("") === null, "asText empty -> null");
  assert(asText(null) === null, "asText null");
  assert(asText(12) === "12", "asText number");
  assert(asText(true) === "true", "asText bool");

  // numOrNull / intOrNull
  assert(numOrNull("$12.50") === 12.5, "numOrNull strips currency");
  assert(numOrNull("22.5%") === 22.5, "numOrNull strips percent");
  assert(numOrNull("abc") === null, "numOrNull junk");
  assert(numOrNull(3) === 3, "numOrNull number");
  assert(intOrNull("10pk") === 10, "intOrNull floors from string");
  assert(intOrNull("2.9") === 2, "intOrNull truncates");
  assert(intOrNull("") === null, "intOrNull empty");

  // moneyToMinor
  assert(moneyToMinor(12.5) === 1250, "moneyToMinor dollars number");
  assert(moneyToMinor("$12.50") === 1250, "moneyToMinor dollar string");
  assert(moneyToMinor("12.505") === 1251, "moneyToMinor rounds half up");
  assert(moneyToMinor({ minor: 1250 }) === 1250, "moneyToMinor object minor");
  assert(moneyToMinor({ amount: 12.5 }) === 1250, "moneyToMinor object dollars");
  assert(moneyToMinor({ cents: 999 }) === 999, "moneyToMinor object cents");
  assert(moneyToMinor(null) === null, "moneyToMinor null");
  assert(moneyToMinor("free") === null, "moneyToMinor junk");

  // formatMinor
  assert(formatMinor(1250) === "$12.50", "formatMinor basic");
  assert(formatMinor(5) === "$0.05", "formatMinor pads cents");
  assert(formatMinor(-1250) === "-$12.50", "formatMinor negative");
  assert(formatMinor(null) === "", "formatMinor null -> empty");

  // pctToNumber
  assert(pctToNumber("22.5%") === 22.5, "pctToNumber string");
  assert(pctToNumber(0.5) === 0.5, "pctToNumber does NOT rescale fractions");
  assert(pctToNumber("n/a") === null, "pctToNumber junk");

  // normalizeStrainType
  assert(normalizeStrainType("Sativa Dominant") === "sativa", "strain sativa");
  assert(normalizeStrainType("INDICA") === "indica", "strain indica");
  assert(normalizeStrainType("Hybrid") === "hybrid", "strain hybrid");
  assert(normalizeStrainType("High CBD") === "cbd", "strain cbd");
  assert(normalizeStrainType("") === "unknown", "strain unknown");

  // packCountFromLabel
  assert(packCountFromLabel("10pk") === 10, "pack 10pk");
  assert(packCountFromLabel("5 pack") === 5, "pack 5 pack");
  assert(packCountFromLabel("2-count") === 2, "pack 2-count");
  assert(packCountFromLabel("1g") === null, "pack no count");
  assert(packCountFromLabel("") === null, "pack empty");

  // normalizeMenuItem — tolerant field spellings + cents + potency nesting
  const item = normalizeMenuItem(
    {
      id: "L-1",
      product_name: "Blue Dream",
      brand_name: "Acme",
      category: "Flower",
      strain: "Sativa",
      size: "3.5g 10pk",
      wholesale_price: "$14.99",
      quantity: "42",
      potency: { thc: "22.5%", cbd: "0.3%", total: "24.1%" },
      description: "  fresh  ",
      image_url: "https://x/i.jpg",
      coa_url: "https://x/c.pdf",
    },
    3,
  );
  assert(item.cultiveraItemId === "L-1", "item id");
  assert(item.name === "Blue Dream", "item name");
  assert(item.brand === "Acme", "item brand");
  assert(item.strainType === "sativa", "item strain");
  assert(item.wholesalePriceMinor === 1499, "item price cents");
  assert(item.availableQty === 42, "item qty");
  assert(item.unitCount === 10, "item unitCount from label");
  assert(item.thcPct === 22.5, "item thc from nested potency");
  assert(item.cbdPct === 0.3, "item cbd from nested potency");
  assert(item.totalCannabinoidsPct === 24.1, "item total from nested potency");
  assert(item.description === "fresh", "item desc trimmed");
  assert(item.imageUrl === "https://x/i.jpg", "item image");
  assert(item.coaUrl === "https://x/c.pdf", "item coa");
  assert(item.position === 3, "item position");
  assert(item.raw && (item.raw as Record<string, unknown>).id === "L-1", "item raw preserved");

  // empty / junk item stays safe
  const empty = normalizeMenuItem(null, 0);
  assert(empty.name === null && empty.wholesalePriceMinor === null && empty.strainType === "unknown", "empty item safe");
  assert(empty.position === 0, "empty item position");

  // normalizeSnapshot — envelope with items key
  const snap = normalizeSnapshot({
    marketId: "M-9",
    slug: "acme-farms",
    sellerName: "Acme Farms",
    locationId: "LOC-1",
    listings: [{ name: "A", price: 10 }, { name: "B", price: 20 }],
  });
  assert(snap.cultiveraMarketId === "M-9", "snap market id");
  assert(snap.cultiveraMarketSlug === "acme-farms", "snap slug");
  assert(snap.sellerName === "Acme Farms", "snap seller");
  assert(snap.locationId === "LOC-1", "snap location");
  assert(snap.itemCount === 2 && snap.items.length === 2, "snap item count");
  assert(snap.items[0].wholesalePriceMinor === 1000, "snap item0 price");
  assert(snap.items[1].position === 1, "snap item1 position");

  // normalizeSnapshot — bare array input
  const snap2 = normalizeSnapshot([{ name: "X", price: 5 }]);
  assert(snap2.itemCount === 1 && snap2.items[0].wholesalePriceMinor === 500, "snap bare array");
  assert(snap2.sellerName === null, "snap bare array no seller");

  // normalizeSnapshot — nested envelope (data.items)
  const snap3 = normalizeSnapshot({ data: { items: [{ name: "Z" }] }, name: "Nested Co" });
  assert(snap3.itemCount === 1 && snap3.items[0].name === "Z", "snap nested unwrap");
  assert(snap3.sellerName === "Nested Co", "snap nested seller");

  // normalizeSnapshot — LIVE Cultivera envelope: PascalCase { Data:[...] }
  // (POST /listings/market/<id> -> { Data, Count, TimeStamp }). This is the
  // real shape; without the "Data" key the menu normalized to zero items.
  const snapData = normalizeSnapshot({
    Data: [
      { Id: 4899, Name: "Flower", MinPrice: 4.0, ImageUrl: "https://files.cultivera.com/x/Sunset-Runtz.jpg" },
      { Id: 4900, Name: "Pre-Roll", MinPrice: 6.0 },
    ],
    Count: 2,
    TimeStamp: "2025-01-01",
  });
  assert(snapData.itemCount === 2 && snapData.items.length === 2, "snap Data envelope count");
  assert(snapData.items[0].name === "Flower", "snap Data item0 name");
  assert(snapData.items[0].wholesalePriceMinor === 400, "snap Data item0 MinPrice dollars->cents");
  assert(snapData.items[0].imageUrl === "https://files.cultivera.com/x/Sunset-Runtz.jpg", "snap Data item0 image");

  // normalizeSnapshot — empty / junk
  const snap4 = normalizeSnapshot(null);
  assert(snap4.itemCount === 0 && snap4.items.length === 0, "snap null safe");

  // LIVE-probed Cultivera product-list item (PascalCase, MinPrice dollars).
  // Shape verified from POST /listings/market/174 — see probe/CULTIVERA_PINNED.md.
  const live = normalizeMenuItem(
    {
      Id: 1357,
      SellerId: 660,
      Cid: "BC175678-645A-4DB3-9AF9-F051D51F64E7",
      Name: "Get MotaVated",
      ImageUrl: "https://files.cultivera.com/435553542D57533130393037/ProductImages/x.jpg",
      MinPrice: 2.66,
      IsSale: true,
      IsDOHComplaint: false,
    },
    0,
  );
  assert(live.cultiveraItemId === "1357", "live Id parsed");
  assert(live.name === "Get MotaVated", "live Name parsed");
  assert(live.wholesalePriceMinor === 266, "live MinPrice 2.66 -> 266 cents");
  assert(live.imageUrl?.includes("files.cultivera.com") === true, "live ImageUrl parsed");

  // ------------------------------------------------------------------
  // CH-2 — product DETAIL (per-variant) normalizers.
  // ------------------------------------------------------------------

  // parseVariantName — live-probed bracket format
  const vn = parseVariantName("Wedding Cake [3.5g] [Indica] [D.O.H. COMPLIANT]");
  assert(vn.cleanName === "Wedding Cake", "variant clean name");
  assert(vn.sizeLabel === "3.5g", "variant size tag");
  assert(vn.strainType === "indica", "variant strain tag");
  assert(vn.dohTagged === true, "variant DOH tag");
  const vn2 = parseVariantName("Luxor [1g] [Sativa]");
  assert(vn2.cleanName === "Luxor" && vn2.sizeLabel === "1g" && vn2.strainType === "sativa", "variant luxor");
  assert(vn2.dohTagged === false, "variant no doh");
  const vn3 = parseVariantName("Plain Name");
  assert(vn3.cleanName === "Plain Name" && vn3.sizeLabel === null && vn3.strainType === "unknown", "variant no tags");
  assert(parseVariantName("").cleanName === null, "variant empty name");

  // sizeLabelFromGrams
  assert(sizeLabelFromGrams(1.0) === "1g", "grams 1.0 -> 1g");
  assert(sizeLabelFromGrams(3.5) === "3.5g", "grams 3.5 -> 3.5g");
  assert(sizeLabelFromGrams(0) === null, "grams 0 -> null");
  assert(sizeLabelFromGrams("junk") === null, "grams junk -> null");

  // boolish
  assert(boolish(true) === true && boolish("true") === true && boolish(1) === true, "boolish truthy");
  assert(boolish(false) === false && boolish("no") === false && boolish(null) === false, "boolish falsy");

  // normalizeVariant — LIVE-probed shape (see probe/CULTIVERA_PINNED.md)
  const variant = normalizeVariant(
    {
      Id: 447772,
      Name: "Luxor [1g] [Sativa] [D.O.H. COMPLIANT]",
      Description: "Gorilla Butter F2 (Vegas Cut) x Alien Apple Kush",
      Uom: 8,
      UnitPrice: 4.5,
      ImageUrl: "https://cdn1.s2solutions.com/x/ProductImages/LUXOR.jpg",
      AvailableQuantity: 20,
      UnitSize: 1.0,
      MaxOrderLimit: null,
      IsDOHComplaint: true,
    },
    6,
  );
  assert(variant.variantId === "447772", "variant id");
  assert(variant.cleanName === "Luxor", "variant cleanName");
  assert(variant.strainType === "sativa", "variant strain");
  assert(variant.sizeLabel === "1g", "variant size label");
  assert(variant.unitSizeGrams === 1, "variant grams");
  assert(variant.unitPriceMinor === 450, "variant $4.50 -> 450 cents");
  // no ProductDiscount here -> not on sale, nothing to strike through
  assert(variant.onSale === false, "variant not on sale");
  assert(variant.wasPriceMinor === null, "variant no was-price");
  assert(variant.availableQty === 20, "variant qty");
  assert(variant.maxOrderLimit === null, "variant no cap");
  assert(variant.description === "Gorilla Butter F2 (Vegas Cut) x Alien Apple Kush", "variant lineage");
  assert(variant.isDohCompliant === true, "variant doh");
  assert(variant.position === 6, "variant position");
  // size falls back to UnitSize grams when the name has no size bracket
  const v2 = normalizeVariant({ Name: "Loose Flower", UnitSize: 3.5, UnitPrice: 14 }, 0);
  assert(v2.sizeLabel === "3.5g", "variant size from grams fallback");
  assert(v2.unitPriceMinor === 1400, "variant $14 -> 1400 cents");
  const vEmpty = normalizeVariant(null, 0);
  assert(vEmpty.name === null && vEmpty.unitPriceMinor === null && vEmpty.strainType === "unknown", "variant junk safe");

  // DISCOUNT pricing (LIVE-probed): UnitPrice is the ORIGINAL, and
  // ProductDiscount.Price is the SALE price the buyer actually pays. The
  // effective unitPriceMinor must be the SALE price, with the original exposed
  // as a struck-through wasPriceMinor. Matches the screenshotted "$4.00 (was $5.00)".
  const vSale = normalizeVariant(
    {
      Id: 418143,
      Name: "*SUPREME - Colorado Nightshifter - 1g",
      UnitPrice: 5.0,
      UnitSize: 1.0,
      AvailableQuantity: 2868,
      ProductDiscount: { DiscountId: 418143, Price: 4.0 },
      MaxOrderLimit: 20,
      IsDOHComplaint: true,
    },
    0,
  );
  assert(vSale.unitPriceMinor === 400, "sale variant effective = $4.00 (discount price)");
  assert(vSale.wasPriceMinor === 500, "sale variant was = $5.00 (original UnitPrice)");
  assert(vSale.onSale === true, "sale variant onSale true");
  // A discount whose price is NOT lower than list must NOT create a fake strike.
  const vNoDrop = normalizeVariant(
    { Id: 9, Name: "X [1g]", UnitPrice: 4.0, ProductDiscount: { Price: 4.0 } },
    0,
  );
  assert(vNoDrop.unitPriceMinor === 400, "non-drop discount keeps list price");
  assert(vNoDrop.onSale === false && vNoDrop.wasPriceMinor === null, "non-drop discount not on sale");

  // normalizeProductDetail — live top-level shape
  const detail = normalizeProductDetail({
    Id: 4462,
    Name: "Signature Flower Line",
    Description: "Our signature line.",
    ImageUrl: "https://files.cultivera.com/x/line.jpg",
    IsDOHComplaint: true,
    Products: [
      { Id: 1, Name: "A [1g] [Indica]", UnitPrice: 4.5, AvailableQuantity: 20 },
      { Id: 2, Name: "B [3.5g] [Sativa]", UnitPrice: 14, AvailableQuantity: 1471, MaxOrderLimit: 75 },
    ],
  });
  assert(detail.productId === "4462", "detail id");
  assert(detail.name === "Signature Flower Line", "detail name");
  assert(detail.isDohCompliant === true, "detail doh");
  assert(detail.variantCount === 2 && detail.variants.length === 2, "detail variant count");
  assert(detail.variants[0].unitPriceMinor === 450, "detail v0 cents");
  assert(detail.variants[1].maxOrderLimit === 75, "detail v1 cap");
  assert(detail.variants[1].position === 1, "detail v1 position");
  const detailEmpty = normalizeProductDetail(null);
  assert(detailEmpty.variantCount === 0 && detailEmpty.productId === null, "detail junk safe");

  // detailFromItemRaw — round-trip through the reserved raw key
  const itemRaw = {
    Id: 4462,
    [ITEM_DETAIL_RAW_KEY]: { Id: 4462, Products: [{ Id: 9, Name: "C [1g] [Hybrid]", UnitPrice: 5 }] },
  };
  const stored = detailFromItemRaw(itemRaw);
  assert(stored !== null && stored.variantCount === 1, "detailFromItemRaw reads");
  assert(stored !== null && stored.variants[0].unitPriceMinor === 500, "detailFromItemRaw cents");
  assert(detailFromItemRaw({ Id: 1 }) === null, "detailFromItemRaw absent -> null");
  assert(detailFromItemRaw(null) === null, "detailFromItemRaw null safe");
  assert(detailFromItemRaw([1, 2]) === null, "detailFromItemRaw array safe");
}
