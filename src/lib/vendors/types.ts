// Database row types for the Slice 3 vendor / brand tables.
// Mirror supabase/migrations/0003_slice3_vendors_brands.sql.
import type { AssetStatus } from "@/lib/supabase/types";

export type SocialLinks = {
  instagram?: string;
  facebook?: string;
  twitter?: string;
  tiktok?: string;
  youtube?: string;
  linkedin?: string;
  [key: string]: string | undefined;
};

export type Vendor = {
  id: string;
  display_name: string;
  slug: string;
  legal_name: string | null;
  license_number: string | null;
  mission_statement: string | null;
  about: string | null;
  /** How they approach/make their products (migration 0099; nullable until applied). */
  product_philosophy?: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  social_json: SocialLinks;
  internal_notes: string | null;
  vendor_day_notes: string | null;
  // Contact / address + ops facts (migration 0081, from the Cultivera export).
  vendor_number: string | null;
  dba: string | null;
  external_id: string | null;
  shipping_address1: string | null;
  shipping_address2: string | null;
  shipping_city: string | null;
  shipping_state: string | null;
  shipping_zip: string | null;
  billing_address1: string | null;
  billing_address2: string | null;
  billing_city: string | null;
  billing_state: string | null;
  billing_zip: string | null;
  billing_same_as_shipping: boolean | null;
  is_active: boolean | null;
  total_accepted_ytd_cents: number | null;
  last_accepted_at: string | null;
  /** Vendor ID in the owner's Sage 50 company (migration 0091), e.g. "01-TWO HEADS". */
  sage_vendor_id?: string | null;
  logo_media_id: string | null;
  hero_media_id: string | null;
  product_count: number;
  brand_count: number;
  status: AssetStatus;
  sort_order: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type VendorAlias = {
  id: string;
  vendor_id: string;
  source_name: string;
  source_system: string;
  created_at: string;
};

export type Brand = {
  id: string;
  display_name: string;
  slug: string;
  vendor_id: string | null;
  logo_media_id: string | null;
  about: string | null;
  mission_statement: string | null;
  product_philosophy: string | null;
  website: string | null;
  social_json: SocialLinks;
  product_count: number;
  status: AssetStatus;
  sort_order: number;
  // Brand FACTS (folded in from kb_brands — migration 0072). The golden record
  // now carries both operational + descriptive brand data.
  known_for: string | null;
  house_style: string | null;
  signature_lines: string[];
  sensory_notes: string[];
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type BrandAlias = {
  id: string;
  brand_id: string;
  source_name: string;
  source_system: string;
  created_at: string;
};

/** A vendor with its brands + resolved logo URL, for list/detail rendering. */
export type VendorWithBrands = Vendor & {
  brands: Brand[];
  logo_url: string | null;
  aliases: string[];
};
