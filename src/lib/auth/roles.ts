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
  | "payables.manage"
  | "products.enrich"
  | "content.edit"
  | "blog.manage"
  | "loyalty.view"
  | "loyalty.manage"
  | "customers.manage"
  | "inventory.manage"
  | "reports.view"
  | "books.view"
  | "financials.view"
  | "users.manage"
  | "settings.manage"
  | "staffing.manage"
  | "timeclock.use"
  | "medical.manage"
  | "sales_limit.override";

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
  // W10 (owner decision, Q2): the purchase manager runs Accounts Payable.
  // Scoped permission — AP was previously gated behind settings.manage, which
  // dragged in user management and store settings just to pay a vendor.
  // Payments remain drafts-only (NACHA file for manual bank upload / recorded
  // manual payments); nothing is transmitted from the app.
  "payables.manage": ["owner", "admin", "manager"],
  "products.enrich": ["owner", "admin", "manager", "content_editor"],
  "content.edit": ["owner", "admin", "manager", "content_editor"],
  "blog.manage": ["owner", "admin", "manager", "content_editor"],
  "loyalty.view": ["owner", "admin", "manager", "staff"],
  "loyalty.manage": ["owner", "admin", "manager", "staff"],
  "customers.manage": ["owner", "admin", "manager", "staff"],
  "inventory.manage": ["owner", "admin", "manager"],
  "reports.view": ["owner", "admin", "manager", "readonly"],
  // F5-K: the GENERAL LEDGER / books. This is DELIBERATELY a separate
  // permission from "reports.view", which also grants manager and readonly.
  // The database gates every accounting RPC on is_owner() = owner (migration
  // 0185). If the books nav were hung off reports.view, a manager would see the
  // link, click it, and hit a raw database refusal -- and the "fix" someone
  // would reach for is loosening the DATABASE, which would hand over the entire
  // ledger.
  //
  // OWNER DECISION, recorded verbatim (Michael, 2026-08-17):
  //   "I know at the beginning of the books build I wanted it to be owner and
  //    admin, but I've changed my mind, there is no reason anyone else needs to
  //    see my books or my financials ever, so I want strict controls over all of
  //    those things. The only thing an admin can do is pay vendors and pay
  //    employees."
  //
  // This list MUST stay equal to ["owner"] alone; the test in books-view-core.ts
  // asserts it against the page gate, and a mutation test proves re-adding admin
  // fails the build.
  "books.view": ["owner"],
  // The financial REPORTS (P&L, sales, COGS, excise, cash, the Sage journal and
  // COA mapping, and the CSV exports of all of it). Split out from reports.view
  // -- which grants manager and readonly -- for exactly the reason above. Same
  // owner decision, same rule: owner alone.
  "financials.view": ["owner"],
  "users.manage": ["owner", "admin"],
  "settings.manage": ["owner", "admin"],
  "staffing.manage": ["owner", "admin", "manager"],
  // Task S-b: the time clock previously piggybacked on "loyalty.view" as a
  // proxy for "any active floor staff". A scoped permission keeps the matrix
  // honest (same roles — no behavior change, clearer intent).
  "timeclock.use": ["owner", "admin", "manager", "staff"],
  "medical.manage": ["owner", "admin", "manager"],
  // Authorizing an OVER-LIMIT sale is a manager+ decision (Slice 109). Regular
  // staff/clerks cannot override the statutory transaction limit.
  "sales_limit.override": ["owner", "admin", "manager"],
};

export function can(role: StaffRole | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return MATRIX[permission]?.includes(role) ?? false;
}

/** Plain-language label for each permission, for the admin permission matrix. */
export const PERMISSION_LABELS: Record<Permission, string> = {
  "dashboard.view": "View the dashboard",
  "menu.import": "Import & stage the menu",
  "menu.publish": "Publish the menu live",
  "orders.view": "View orders",
  "orders.manage": "Update order status",
  "promotions.manage": "Manage promotions & specials",
  "media.manage": "Manage the media library",
  "vendors.manage": "Manage vendors & brands",
  "payables.manage": "Pay vendors (accounts payable — drafts only)",
  "products.enrich": "Enrich products (descriptions, photos)",
  "content.edit": "Edit site content & page text",
  "blog.manage": "Write & publish blog posts",
  "loyalty.view": "View loyalty signups",
  "loyalty.manage": "Process loyalty signups",
  "customers.manage": "Manage customer & patient records",
  "inventory.manage": "Manage inventory lots, COAs & manifests",
  "reports.view": "View reports & exports",
  "books.view": "View the accounting books (general ledger)",
  "financials.view": "View financial reports & accounting exports",
  "users.manage": "Manage staff & roles",
  "settings.manage": "Change settings",
  "staffing.manage": "Manage employees, shifts & time clock",
  "timeclock.use": "Clock in & out (time clock)",
  "medical.manage": "Issue & manage medical recognition cards (consultant)",
  "sales_limit.override": "Authorize an over-limit sale (logged override)",
};

/** Display order for the matrix rows (grouped roughly by area). */
export const ALL_PERMISSIONS: Permission[] = [
  "dashboard.view",
  "orders.view",
  "orders.manage",
  "loyalty.view",
  "loyalty.manage",
  "customers.manage",
  "medical.manage",
  "inventory.manage",
  "menu.import",
  "menu.publish",
  "promotions.manage",
  "products.enrich",
  "vendors.manage",
  "payables.manage",
  "content.edit",
  "blog.manage",
  "media.manage",
  "reports.view",
  "books.view",
  "financials.view",
  "staffing.manage",
  "timeclock.use",
  "sales_limit.override",
  "users.manage",
  "settings.manage",
];

/**
 * Read-only snapshot of which roles hold a given permission. Returned as a
 * copy so callers (e.g. the visual permission matrix) can't mutate the matrix.
 */
export function rolesForPermission(permission: Permission): StaffRole[] {
  return [...(MATRIX[permission] ?? [])];
}

export function isAdminRole(role: StaffRole | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

/**
 * True only for the store OWNER. Use this to gate owner-reserved controls (e.g.
 * editing statutory sales limits) that even admins should NOT be able to change.
 */
export function isOwnerRole(role: StaffRole | null | undefined): boolean {
  return role === "owner";
}

export function atLeast(role: StaffRole | null | undefined, min: StaffRole): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[min];
}
