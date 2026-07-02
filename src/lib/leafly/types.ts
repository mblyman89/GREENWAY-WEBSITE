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
  type: "thc" | "thca" | "cbd" | "cbda" | "cbg" | "cbn" | "cbdv";
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
  thc: string | null;
  cbd: string | null;
  totalThc: GreenwayCannabinoid | null;
  totalCbd: GreenwayCannabinoid | null;
  compounds: GreenwayCannabinoid[];
  description: string;
  priceLabel: string;
  priceMinorUnits: number;
  inventoryStatus: "mock" | "in-stock" | "low-stock" | "unavailable";
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
};

export type LeaflyClientConfig = {
  environment: LeaflyEnvironment;
  menuIntegrationKey?: string;
  clientId?: string;
  clientSecret?: string;
};
