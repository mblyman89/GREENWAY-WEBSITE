// Role definitions + permission helpers for the Greenway back office.
import type { StaffRole } from "@/lib/supabase/types";

export const ROLE_LABELS: Record<StaffRole, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  content_editor: "Content Editor",
  staff: "Budtender / Staff",
  readonly: "Read-only / Analyst",
};

export const ROLE_DESCRIPTIONS: Record<StaffRole, string> = {
  owner: "Full access including user management, settings, and publish approvals.",
  admin: "Full access including user management and settings.",
  manager: "Menu imports, promotions, orders, content, vendors, and reports.",
  content_editor: "Blog, banners, page text, and media library.",
  staff: "Order dashboard, loyalty review, and limited reporting.",
  readonly: "Reporting and exports only.",
};

// Ordered most→least privileged for simple hierarchy checks.
export const ROLE_RANK: Record<StaffRole, number> = {
  owner: 100,
  admin: 90,
  manager: 70,
  content_editor: 50,
  staff: 30,
  readonly: 10,
};

export const ALL_ROLES: StaffRole[] = [
  "owner",
  "admin",
  "manager",
  "content_editor",
  "staff",
  "readonly",
];

/** Permission keys used across the admin to gate UI + actions. */
export type Permission =
  | "dashboard.view"
  | "menu.import"
  | "menu.publish"
  | "orders.view"
  | "orders.manage"
  | "promotions.manage"
  | "media.manage"
  | "vendors.manage"
  | "products.enrich"
  | "content.edit"
  | "blog.manage"
  | "loyalty.view"
  | "loyalty.manage"
  | "reports.view"
  | "users.manage"
  | "settings.manage";

// Role → granted permissions. Higher roles inherit by explicit listing to keep
// the matrix auditable and obvious.
const MATRIX: Record<Permission, StaffRole[]> = {
  "dashboard.view": ["owner", "admin", "manager", "content_editor", "staff", "readonly"],
  "menu.import": ["owner", "admin", "manager"],
  "menu.publish": ["owner", "admin", "manager"],
  "orders.view": ["owner", "admin", "manager", "staff"],
  "orders.manage": ["owner", "admin", "manager", "staff"],
  "promotions.manage": ["owner", "admin", "manager"],
  "media.manage": ["owner", "admin", "manager", "content_editor"],
  "vendors.manage": ["owner", "admin", "manager", "content_editor"],
  "products.enrich": ["owner", "admin", "manager", "content_editor"],
  "content.edit": ["owner", "admin", "manager", "content_editor"],
  "blog.manage": ["owner", "admin", "manager", "content_editor"],
  "loyalty.view": ["owner", "admin", "manager", "staff"],
  "loyalty.manage": ["owner", "admin", "manager", "staff"],
  "reports.view": ["owner", "admin", "manager", "readonly"],
  "users.manage": ["owner", "admin"],
  "settings.manage": ["owner", "admin"],
};

export function can(role: StaffRole | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return MATRIX[permission]?.includes(role) ?? false;
}

export function isAdminRole(role: StaffRole | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export function atLeast(role: StaffRole | null | undefined, min: StaffRole): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[min];
}
