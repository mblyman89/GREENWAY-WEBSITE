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

  const sizeLabel = pickText(o, ["size", "sizeLabel", "size_label", "unitSize", "unit_size", "packageSize", "weight"]);
  const unitCountRaw = pickRaw(o, ["unitCount", "unit_count", "units", "packSize", "pack_size", "quantityPerUnit"]);
  const unitCount = intOrNull(unitCountRaw) ?? packCountFromLabel(sizeLabel);

  const priceRaw = pickRaw(o, [
    "wholesalePrice", "wholesale_price", "unitPrice", "unit_price",
    "price", "priceMinor", "price_minor", "cost",
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
    cultiveraItemId: pickText(o, ["id", "listingId", "listing_id", "itemId", "item_id", "productId", "product_id", "sku"]),
    name: pickText(o, ["name", "productName", "product_name", "title", "listingName", "listing_name"]),
    brand: pickText(o, ["brand", "brandName", "brand_name", "producer", "vendor", "vendorName"]),
    category: pickText(o, ["category", "categoryName", "category_name", "productType", "product_type", "type"]),
    inventoryType: pickText(o, ["inventoryType", "inventory_type", "inventoryCategory", "unitOfMeasure", "uom"]),
    strainType: normalizeStrainType(pickRaw(o, ["strainType", "strain_type", "strain", "classification", "lineage"])),
    sizeLabel,
    unitCount,
    wholesalePriceMinor: moneyToMinor(priceRaw),
    availableQty: numOrNull(pickRaw(o, ["availableQty", "available_qty", "quantity", "qty", "available", "inventoryCount", "stock"])),
    thcPct: pctToNumber(thc),
    cbdPct: pctToNumber(cbd),
    totalCannabinoidsPct: pctToNumber(total),
    potencyRaw,
    description: pickText(o, ["description", "productDescription", "product_description", "summary", "details", "longDescription"]),
    imageUrl: pickText(o, ["imageUrl", "image_url", "image", "imageURL", "thumbnail", "thumbnailUrl", "photoUrl", "primaryImage"]),
    coaUrl: pickText(o, ["coaUrl", "coa_url", "coa", "labResultUrl", "lab_result_url", "coaPdf", "coaDocument", "certificateUrl"]),
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
    itemsRaw = pickRaw(root, ["items", "listings", "products", "menu", "data", "results", "menuItems", "menu_items"]);
    // If the picked value is itself an envelope, unwrap one common level.
    if (itemsRaw && typeof itemsRaw === "object" && !Array.isArray(itemsRaw)) {
      const inner = itemsRaw as Record<string, unknown>;
      const nested = pickRaw(inner, ["items", "listings", "products", "results", "data"]);
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

  // normalizeSnapshot — empty / junk
  const snap4 = normalizeSnapshot(null);
  assert(snap4.itemCount === 0 && snap4.items.length === 0, "snap null safe");
}
