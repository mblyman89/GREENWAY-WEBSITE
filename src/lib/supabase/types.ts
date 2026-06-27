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
