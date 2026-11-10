// Shared types for the back-office Supabase layer.

export type StaffRole =
  | "owner"
  | "admin"
  | "manager"
  | "content_editor"
  | "staff"
  | "readonly";

export type AssetStatus = "draft" | "published" | "archived";

export type StaffProfile = {
  id: string;
  email: string;
  full_name: string | null;
  role: StaffRole;
  active: boolean;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
};

export type MediaAsset = {
  id: string;
  storage_key: string;
  public_url: string | null;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  alt_text: string | null;
  title: string | null;
  description: string | null;
  source: string | null;
  license_status: string | null;
  usage_type: string | null;
  tags: string[];
  focal_x: number | null;
  focal_y: number | null;
  status: AssetStatus;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
  // D221 M1+M2 (0352). Optional: absent on a database without 0352 and in
  // reads that name their columns.
  vendor_id?: string | null;
  brand_id?: string | null;
  kb_product_id?: string | null;
  platform?: string | null;
  source_url?: string | null;
  product_name?: string | null;
  menu_item_ref?: string | null;
  role?: string | null;
  category?: string | null;
  pack_size?: string | null;
  ai_description?: string | null;
  ai_caption?: string | null;
  visible_text?: string | null;
  ai_tags?: string[];
  ai_status?: string | null;
  seo_title?: string | null;
  seo_alt?: string | null;
  credit_text?: string | null;
  content_hash?: string | null;
  canonical_id?: string | null;
  duplicate_count?: number | null;
  publish_reason?: string | null;
  published_at?: string | null;
  review_state?: string | null;
  review_note?: string | null;
  // D221 M3 (0353).
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  // D221 M7 (detail page: SEO / provenance view; columns from 0352).
  seo_description?: string | null;
  seo_slug?: string | null;
  seo_keywords?: string[] | null;
  strain_name?: string | null;
  source_page_url?: string | null;
  captured_at?: string | null;
  field_provenance?: Record<string, unknown> | null;
  published_by?: string | null;
  ai_model?: string | null;
  ai_described_at?: string | null;
};

export type AuditLog = {
  id: number;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  before_json: unknown;
  after_json: unknown;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
};

export type SiteSetting = {
  key: string;
  value_json: unknown;
  draft_value_json: unknown;
  label: string | null;
  published_at: string | null;
  updated_by: string | null;
  updated_at: string;
};
