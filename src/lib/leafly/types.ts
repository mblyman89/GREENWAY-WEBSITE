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

export type GreenwayStrainType = "indica" | "sativa" | "hybrid" | "cbd" | "unknown";

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
};

export type LeaflyClientConfig = {
  environment: LeaflyEnvironment;
  menuIntegrationKey?: string;
  clientId?: string;
  clientSecret?: string;
};
