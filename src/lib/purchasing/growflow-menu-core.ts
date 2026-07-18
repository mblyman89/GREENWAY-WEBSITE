/**
 * GF-1 — GrowFlow menu normalizers (pure, tolerant, side-effect free).
 *
 * GrowFlow (marketplace.growflow.com) is a React SPA backed by a GraphQL API at
 * marketplaceapi-prod.gke.wholesale.growflow.com/graphql. The owner is an
 * authenticated buyer (Greenway Marijuana, license 413541, BuyerVendorId 2368)
 * whose rep approved pulling vendor menus into the back office.
 *
 * Every field name below was pinned from a LIVE authenticated probe of the real
 * GraphQL operations `getStoreFrontsV2` (store list) and `getStoreListingV2`
 * (a store's products) — see probe/GROWFLOW_PINNED.md. We do NOT guess: unknown
 * shapes fall through the tolerant coercers and the RAW payload is preserved so
 * parsers can be revised without re-fetching.
 *
 * The output shape is the SAME `CultiveraMenuItem`/`CultiveraSnapshot`-compatible
 * item the rest of the command center already consumes, so the unified menus UI,
 * media saves, and PO hand-off work identically regardless of source platform.
 */
import {
  asText,
  numOrNull,
  intOrNull,
  moneyToMinor,
  pctToNumber,
  normalizeStrainType,
  packCountFromLabel,
  type StrainType,
} from "./cultivera-menu-core";

/** Which marketplace a menu / vendor came from. */
export type VendorPlatform = "cultivera" | "growflow";

/**
 * One normalized GrowFlow product line. Structurally compatible with
 * CultiveraMenuItem (same field names) plus GrowFlow-only extras (msrpMinor,
 * strainName, images[]) that the shared UI can optionally use.
 */
export type GrowflowMenuItem = {
  growflowItemId: string | null;
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
  /** MSRP in integer minor units (cents). Null if unknown. */
  msrpMinor: number | null;
  availableQty: number | null;
  thcPct: number | null;
  cbdPct: number | null;
  totalCannabinoidsPct: number | null;
  potencyRaw: Record<string, unknown>;
  description: string | null;
  imageUrl: string | null;
  /** Additional image URLs (GrowFlow exposes up to 3). */
  images: string[];
  coaUrl: string | null;
  raw: Record<string, unknown>;
  position: number;
};

export type GrowflowSnapshot = {
  growflowStoreId: string | null;
  growflowVendorId: string | null;
  storeName: string | null;
  licenseNumber: string | null;
  buyerVendorId: string | null;
  itemCount: number;
  items: GrowflowMenuItem[];
  raw: Record<string, unknown>;
};

/** A vendor/store as it appears in the GrowFlow store list (search results). */
export type GrowflowStore = {
  storeId: string | null;
  vendorId: string | null;
  licenseNumber: string | null;
  name: string | null;
  logoUrl: string | null;
  website: string | null;
  description: string | null;
  city: string | null;
  region: string | null;
  /** GrowFlow `AccessStatus` — distinguishes Unlocked vs Locked stores. */
  accessStatus: string | null;
  isFavorite: boolean;
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

function boolish(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.trim().toLowerCase() === "true";
  if (typeof v === "number") return v !== 0;
  return false;
}

/**
 * GrowFlow potency comes as Min/Max pairs (e.g. MinTHCMax=19.407, MaxTHCMax).
 * When min and max agree we report that number; otherwise we report the MAX
 * (the label buyers care about is the upper bound). Never rescales fractions.
 */
export function potencyFromMinMax(min: unknown, max: unknown): number | null {
  const lo = pctToNumber(min);
  const hi = pctToNumber(max);
  if (hi !== null) return hi;
  if (lo !== null) return lo;
  return null;
}

/* --------------------------------------------------------------------------
 * Store (search result) normalizer — from getStoreFrontsV2
 * ------------------------------------------------------------------------ */

export function normalizeStore(raw: unknown): GrowflowStore {
  const o = asObject(raw);
  return {
    storeId: asText(o.Id),
    vendorId: asText(o.VendorId),
    licenseNumber: asText(o.LicenseNumber),
    name: asText(o.Name),
    logoUrl: asText(o.LogoUrl),
    website: asText(o.Website),
    description: asText(o.Description),
    city: asText(o.City),
    region: asText(o.Region),
    accessStatus: asText(o.AccessStatus),
    isFavorite: boolish(o.IsFavorite),
    raw: o,
  };
}

export function normalizeStoreList(input: unknown): GrowflowStore[] {
  // getStoreFrontsV2 -> data.getStoreFronts: [...]. Accept either the already
  // unwrapped array or the GraphQL envelope, tolerantly.
  let list: unknown = input;
  const env = asObject(input);
  if (Array.isArray(env.getStoreFronts)) list = env.getStoreFronts;
  else if (env.data) {
    const d = asObject(env.data);
    if (Array.isArray(d.getStoreFronts)) list = d.getStoreFronts;
  }
  if (!Array.isArray(list)) return [];
  return list.map(normalizeStore);
}

/* --------------------------------------------------------------------------
 * Menu item normalizer — from getStoreListingV2 products[]
 * ------------------------------------------------------------------------ */

export function normalizeMenuItem(raw: unknown, position: number): GrowflowMenuItem {
  const o = asObject(raw);

  const sizeLabel = asText(o.Size) ?? asText(o.UnitName);
  const images: string[] = [];
  for (const k of ["ImageUrl", "Image2Url", "Image3Url"]) {
    const u = asText(o[k]);
    if (u) images.push(u);
  }

  return {
    growflowItemId: asText(o.Id),
    name: asText(o.Name),
    brand: asText(o.ProductBrandName),
    category: asText(o.ProductCategoryName) ?? asText(o.ProductCategoryParentName),
    inventoryType: asText(o.ProductCategoryParentName),
    strainType: normalizeStrainType(o.StrainTypeName),
    strainName: asText(o.StrainName),
    sizeLabel,
    unitCount: intOrNull(o.AvailableGrams) === null ? packCountFromLabel(sizeLabel) : null,
    // GrowFlow Price/DefaultPrice/MSRP are DOLLAR floats -> cents.
    wholesalePriceMinor: moneyToMinor(o.Price ?? o.DefaultPrice),
    msrpMinor: moneyToMinor(o.MSRP),
    availableQty: numOrNull(o.Available ?? o.AvailableGrams),
    thcPct: potencyFromMinMax(o.MinTHCMax, o.MaxTHCMax),
    cbdPct: potencyFromMinMax(o.MinCBDMax, o.MaxCBDMax),
    totalCannabinoidsPct: potencyFromMinMax(o.MinTotalOptional, o.MaxTotalOptional),
    potencyRaw: {
      MinTHCMax: o.MinTHCMax ?? null,
      MaxTHCMax: o.MaxTHCMax ?? null,
      MinCBDMax: o.MinCBDMax ?? null,
      MaxCBDMax: o.MaxCBDMax ?? null,
      MinTotalTerpenes: o.MinTotalTerpenes ?? null,
      MaxTotalTerpenes: o.MaxTotalTerpenes ?? null,
      MinTotalOptional: o.MinTotalOptional ?? null,
      MaxTotalOptional: o.MaxTotalOptional ?? null,
    },
    description: asText(o.Description),
    imageUrl: images[0] ?? null,
    images,
    coaUrl: asText(o.CoaUrl) ?? asText(o.COAUrl), // not seen live; tolerant
    raw: o,
    position,
  };
}

/* --------------------------------------------------------------------------
 * Snapshot normalizer — from getStoreListingV2 envelope
 * ------------------------------------------------------------------------ */

export function normalizeSnapshot(input: unknown): GrowflowSnapshot {
  const env = asObject(input);
  // Unwrap the GraphQL envelope tolerantly: input may be the raw response, the
  // `data` object, or already the getStoreListing payload.
  let listing = env;
  if (env.data) {
    const d = asObject(env.data);
    if (d.getStoreListing) listing = asObject(d.getStoreListing);
  } else if (env.getStoreListing) {
    listing = asObject(env.getStoreListing);
  }

  const productsRaw = Array.isArray(listing.products) ? listing.products : [];
  const items = productsRaw.map((p, i) => normalizeMenuItem(p, i));

  return {
    growflowStoreId: asText(env.storeFrontId) ?? asText(env.storeId),
    growflowVendorId: asText(env.vendorId),
    storeName: asText(env.storeName),
    licenseNumber: asText(env.licenseNumber),
    buyerVendorId: asText(env.buyerVendorId),
    itemCount: items.length,
    items,
    raw: env,
  };
}

/* --------------------------------------------------------------------------
 * Self-tests (pure runner) — grounded in the LIVE-probed shapes.
 * ------------------------------------------------------------------------ */

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`growflow-menu-core self-test failed: ${msg}`);
}

export function __runGrowflowMenuCoreTests(): void {
  // --- store list ---------------------------------------------------------
  const stores = normalizeStoreList({
    data: {
      getStoreFronts: [
        {
          Id: 1211,
          VendorId: 660,
          LicenseNumber: "412345",
          Name: "Bonsai Farms",
          LogoUrl: "https://cdn.example/logo.png",
          AccessStatus: "Unlocked",
          IsFavorite: true,
          City: "Seattle",
          Region: "WA",
        },
      ],
    },
  });
  assert(stores.length === 1, "one store parsed");
  assert(stores[0].storeId === "1211", "store id");
  assert(stores[0].name === "Bonsai Farms", "store name");
  assert(stores[0].accessStatus === "Unlocked", "access status");
  assert(stores[0].isFavorite === true, "favorite bool");

  // accepts a bare array too
  const stores2 = normalizeStoreList([{ Id: 9, Name: "X" }]);
  assert(stores2.length === 1 && stores2[0].storeId === "9", "bare array store list");

  // --- menu item (real probed product) -----------------------------------
  const item = normalizeMenuItem(
    {
      Id: 5203726,
      Price: 10.0,
      DefaultPrice: 10.0,
      MSRP: 12.5,
      Name: "Bonsai Flower Lot",
      Description: null,
      AvailableGrams: 454,
      Available: 454.0,
      Size: null,
      UnitName: "Grams",
      ImageUrl: "https://growflowweb.blob.core.windows.net/images-store/a_main.png",
      Image2Url: null,
      StrainName: "Bad Mama Jamas",
      StrainTypeName: "Hybrid",
      ProductCategoryName: "Flower Lot 2",
      ProductCategoryParentName: "Flower",
      ProductBrandName: null,
      MinTHCMax: 19.407,
      MaxTHCMax: 19.407,
      MinCBDMax: 0.062267,
      MaxCBDMax: 0.062267,
    },
    0,
  );
  assert(item.growflowItemId === "5203726", "item id");
  assert(item.name === "Bonsai Flower Lot", "item name");
  // dollars -> cents
  assert(item.wholesalePriceMinor === 1000, "price 10.00 -> 1000 cents");
  assert(item.msrpMinor === 1250, "msrp 12.50 -> 1250 cents");
  assert(item.strainType === "hybrid", "strain type hybrid");
  assert(item.strainName === "Bad Mama Jamas", "strain name");
  assert(item.category === "Flower Lot 2", "category");
  // potency: min==max -> that number
  assert(item.thcPct === 19.407, "thc 19.407");
  assert(item.cbdPct === 0.062267, "cbd");
  assert(item.imageUrl?.includes("blob.core.windows.net") === true, "image url");
  assert(item.images.length === 1, "one image");
  assert(item.availableQty === 454, "available qty");

  // potency max preferred when min<max
  assert(potencyFromMinMax(10, 22.5) === 22.5, "max preferred");
  assert(potencyFromMinMax(null, null) === null, "null potency");

  // --- snapshot envelope --------------------------------------------------
  const snap = normalizeSnapshot({
    storeFrontId: 1211,
    vendorId: 2368,
    storeName: "Bonsai Farms",
    data: {
      getStoreListing: {
        listings: [{ id: 1, imageUrl: "x", products: [{ Id: 5203726 }] }],
        products: [
          { Id: 5203726, Price: 10.0, Name: "A" },
          { Id: 5203727, Price: 25.5, Name: "B" },
        ],
      },
    },
  });
  assert(snap.itemCount === 2, "two items");
  assert(snap.items[1].wholesalePriceMinor === 2550, "25.50 -> 2550 cents");
  assert(snap.growflowStoreId === "1211", "snapshot store id");
  assert(snap.growflowVendorId === "2368", "snapshot vendor id");

  // empty / junk tolerant
  assert(normalizeSnapshot({}).itemCount === 0, "empty snapshot");
  assert(normalizeSnapshot(null).items.length === 0, "null snapshot");
  assert(normalizeStoreList(null).length === 0, "null store list");
}
