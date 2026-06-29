/**
 * src/lib/enrichment/types.ts
 *
 * Types for the product enrichment (marketing) layer and AI suggestions.
 * Enrichment is keyed by the stable POS product key (menu_items.source_item_id)
 * and is merged over the published menu item at read time. It never overrides
 * POS price/stock.
 */
import type { AssetStatus } from "@/lib/supabase/types";

export type ProductTag =
  | "new-arrival"
  | "best-seller"
  | "staff-pick"
  | "local"
  | "high-cbd"
  | "high-thc"
  | "value"
  | "limited";

export type ProductEnrichment = {
  id: string;
  pos_product_key: string;
  last_seen_name: string | null;
  last_seen_brand: string | null;
  last_seen_category: string | null;
  display_name: string | null;
  description: string | null;
  short_description: string | null;
  image_media_ids: string[];
  primary_media_id: string | null;
  brand_id: string | null;
  vendor_id: string | null;
  tags: string[];
  staff_pick: boolean;
  featured: boolean;
  staff_note: string | null;
  hidden_override: boolean | null;
  hidden_reason: string | null;
  seo_title: string | null;
  seo_description: string | null;
  status: AssetStatus;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AiSuggestionStatus = "pending" | "accepted" | "rejected" | "edited";

export type AiSuggestion = {
  id: string;
  entity_type: string;
  entity_id: string;
  field_key: string;
  suggested_value: string | null;
  status: AiSuggestionStatus;
  model: string | null;
  prompt_version: string | null;
  input_summary: string | null;
  generated_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  /** 0..1 grounding confidence (added in migration 0018; null on older rows). */
  confidence?: number | null;
  /** Provenance of the facts: model | kb | pos | crawl:<url> (migration 0018). */
  source?: string | null;
};

/** A published menu item merged with its enrichment (for the front end). */
export type EnrichedMenuItem = {
  posKey: string;
  // POS truth (never overridden):
  priceLabel: string;
  priceMinorUnits: number;
  inventoryStatus: string;
  // Display fields (enrichment over POS):
  name: string;
  description: string;
  shortDescription: string | null;
  brandName: string;
  category: string;
  tags: string[];
  staffPick: boolean;
  featured: boolean;
  staffNote: string | null;
  primaryImageUrl: string | null;
  imageUrls: string[];
  hidden: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
};
