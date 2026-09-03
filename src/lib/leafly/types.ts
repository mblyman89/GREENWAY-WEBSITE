import type { DohCategory } from "@/lib/medical/medical-sale-core";

export type LeaflyEnvironment = "sandbox" | "production";

export type GreenwayCategory =
  | "flower"
  | "popcorn-bud"
  | "infused-flower"
  | "blunt"
  | "infused-blunt"
  | "tincture"
  | "rso"
  | "paraphernalia"
  | "accessories"
  | "merch"
  | "preroll-pack"
  | "cartridge"
  | "disposable-cartridge"
  | "edible-solid"
  | "concentrate"
  | "infused-preroll"
  | "infused-preroll-pack"
  | "preroll"
  | "edible-liquid"
  | "topical"
  | "trim";

export type GreenwayStrainType =
  | "indica"
  | "sativa"
  | "hybrid"
  // Leaning hybrids (website + back office only; collapse to CCRS "Hybrid").
  | "indica-hybrid"
  | "sativa-hybrid"
  | "cbd"
  | "unknown";

export type GreenwayCannabinoid = {
  type: "thc" | "thca" | "cbd" | "cbda" | "cbg" | "cbn" | "cbc" | "cbdv";
  value: string | null;
  unit: "%" | "mg";
};

export type GreenwayMenuVariant = {
  id: string;
  label: string;
  priceMinorUnits: number;
  inventoryLevel: number;
  medical: boolean;
};

export type GreenwayMenuItem = {
  id: string;
  name: string;
  productName?: string;
  brand: string;
  vendor?: string;
  category: GreenwayCategory;
  filterCategories?: GreenwayCategory[];
  posInventoryType?: string;
  posInventoryCategory?: string;
  strainType: GreenwayStrainType;
  strainName?: string;
  /**
   * Dominant terpene names attached to this item (e.g. ["myrcene","limonene"]).
   * SENSORY/descriptive only — no effects/medical claims, not tracked/reported.
   * Populated at menu-build time from the matching KB strain (single source of
   * truth). Absent/empty when the strain has no curated terpenes. Used to power
   * the website menu terpene filter.
   */
  terpenes?: string[];
  thc: string | null;
  cbd: string | null;
  /**
   * SLICE 16 — low-THC beverage classification (WAC 314-55-095(1)(d)(i)(E)+(F)).
   * true = packaged in individual units of ≤ 4 mg active delta-9 THC, so it
   * counts against the 200 mg THC limit instead of the 72 oz liquid limit.
   * Absent/null = not classified = treated as a normal liquid (fail-safe).
   */
  lowThcLiquid?: boolean | null;
  /** SLICE 16 — mg of active delta-9 THC in ONE sellable unit (one can). */
  unitThcMg?: number | null;
  totalThc: GreenwayCannabinoid | null;
  totalCbd: GreenwayCannabinoid | null;
  compounds: GreenwayCannabinoid[];
  description: string;
  priceLabel: string;
  priceMinorUnits: number;
  inventoryStatus: "in-stock" | "low-stock" | "unavailable";
  hidden?: boolean;
  hiddenReason?: string;
  variants: GreenwayMenuVariant[];
  /**
   * Resolved product image URL (DF-3). Populated at render time by the image
   * resolver: the product's own approved photo, or an honest approved
   * substitute. Absent → the card renders the stylized mockup.
   */
  imageUrl?: string;
  /** True when `imageUrl` is a representative substitute, not the exact product. */
  imageIsFallback?: boolean;
  /**
   * SLICE D (SHOP-4): true when the store has VERIFIED this product as DOH
   * (WA DOH 246-70) compliant and recorded it in the durable
   * medical_product_registry (migration 0113), keyed by the stable POS product
   * key (= this item's `id`), so the verification survives menu re-imports.
   * This is the SAME registry the medical checkout uses to zero the sales/excise
   * tax, so the public flag and the register agree by construction. Threaded at
   * menu-build time by withDohCompliance(); absent/false when unverified or
   * pre-migration (the honest default — no badge until verified). The badge
   * render lands in Slice F.
   */
  dohCompliant?: boolean;
  /**
   * SLICE D (SHOP-4): the WAC 246-70 DOH lane for a compliant product
   * (general_use / high_thc / high_cbd), carried alongside the boolean from the
   * same registry read so Slices E (filter) + F (badge) can label it honestly
   * without a second DB round-trip. null when not compliant.
   */
  dohCategory?: DohCategory | null;
};

export type LeaflyClientConfig = {
  environment: LeaflyEnvironment;
  menuIntegrationKey?: string;
  clientId?: string;
  clientSecret?: string;
};
