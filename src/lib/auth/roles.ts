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
  | "inventory.count"
  | "inventory.audit"
  | "compliance.calendar"
  | "reports.view"
  | "books.view"
  | "financials.view"
  | "finances.view"
  | "users.manage"
  | "audit.view"
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
  // books-23: COUNTING the shelf, which is not the same act as managing
  // inventory. Recording a blind physical count is floor work; deciding what a
  // difference means, and what it costs, is not.
  //
  // OWNER DECISION, recorded verbatim (Michael, books-23):
  //   "For question 3, yes any employee can count, it should be a blind count
  //    without cost, variances, or the approve button."
  //
  // Why this is not simply `requireStaff()`: requireStaff() only proves somebody
  // is logged in, which in role terms is dashboard.view -- and that includes
  // "readonly", described in this same file as "Reporting and exports only".
  // Handing an analyst role the ability to write counts onto the shelf record
  // would be a widening nobody asked for. It also includes content_editor, who
  // has no reason to be on the sales floor at all. This permission names the
  // four roles that actually work the floor.
  //
  // The count sheet is structurally blind: CountSheetLine (audit-hub-store.ts)
  // carries no cost, no variance and no system quantity, so this permission
  // cannot leak what the count is worth even if the page tried.
  "inventory.count": ["owner", "admin", "manager", "staff"],
  // books-23: APPROVING an inventory audit -- the scope, the reasons, and the
  // journal entry that posts the shrink to the books. Owner alone.
  //
  // OWNER DECISION, recorded verbatim (Michael, books-23):
  //   "4, yes, I am the only one that can approve an audit and create an audit.
  //    Anything accounting, bookkeeping, taxes, finance, should be hard gated to
  //    me only."
  //
  // This is separate from inventory.manage on purpose: that grants manager, and
  // a manager approving a write-off is a manager deciding cost of goods sold.
  // Migration 0191 already gates inventory_audit_sessions on is_owner() and the
  // posting RPC in 0192 raises INVENTORY_AUDIT_FORBIDDEN unless is_owner(), so
  // this list MUST stay equal to ["owner"] alone -- otherwise the page invites
  // someone in and the database refuses them, and the "fix" someone reaches for
  // is loosening the DATABASE.
  "inventory.audit": ["owner"],
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
  // F6-K (slice books-06): the MONEY PAGES -- the bank feed (Plaid), the
  // ATM vault, the crypto treasury, and the loans owed to and by the owner.
  // These pages were previously gated behind "settings.manage", which also
  // grants ADMIN. That was the last hole in the owner gate: an admin could
  // not open the books, but could still open /admin/atm, /admin/crypto and
  // /admin/loans and read every balance, every bank transaction, and every
  // note payable -- i.e. reconstruct the financial statements the books
  // permission was written to hide.
  //
  // OWNER DECISION, recorded verbatim (Michael, 2026-08-17):
  //   "there is no reason anyone else needs to see my books or my financials
  //    ever, so I want strict controls over all of those things. The only
  //    thing an admin can do is pay vendors and pay employees."
  //
  // Paying vendors and paying employees is "payables.manage" + "staffing.manage",
  // both of which still include admin. Nothing an admin needs was taken away.
  //
  // This list MUST stay equal to ["owner"] alone. Migration 0190 re-gates the
  // 25 underlying tables from is_staff() to is_owner(), so a non-owner who
  // reached these pages would hit a raw database refusal anyway -- and the
  // "fix" someone would reach for is loosening the DATABASE. Keep the page
  // gate and the database gate saying the same word: owner.
  "finances.view": ["owner"],
  // books-23: THE COMPLIANCE CALENDAR (/admin/compliance/calendar).
  //
  // Michael, verbatim: "I want it to be for me alone too, the employees should
  // not be harassed by the system for my not making a payment or filing a
  // report etc. I'll keep that burden for myself."
  //
  // It used to ride on "settings.manage" (owner + admin), and the dashboard
  // banner it feeds was shown to ALL SIX ROLES -- so a budtender saw a red
  // "3 compliance obligations are past due" card linking to a page that would
  // then refuse them. Nagging someone about a filing they cannot make, cannot
  // see, and are not responsible for.
  //
  // A SEPARATE PERMISSION RATHER THAN "finances.view": that one is labelled
  // "View money accounts (bank feed, ATM vault, crypto, loans)" and reusing it
  // would make a CCTV retention spot-check and a scale calibration into
  // "money accounts". Same reasoning that made inventory.count the right answer
  // instead of requireStaff(): the honest gate is the narrow one, and a
  // permission whose label misdescribes what it guards is a standing-rule-44
  // lie waiting for the next reader.
  //
  // Both resolve to ["owner"] today, so this costs nothing now and keeps the
  // two ideas separable later -- if a compliance manager is ever hired, this is
  // the single line that changes, and it will not hand them the bank feed.
  "compliance.calendar": ["owner"],
  "users.manage": ["owner", "admin"],
  // books-22: THE SECURITY LOG (/admin/audit, renamed from "Audit Log").
  //
  // This used to ride on "users.manage", which is ["owner","admin"] and is ALSO
  // the gate for /admin/users. That coupling meant the log could not be taken
  // away from the admin without also taking away user management -- which the
  // owner did NOT ask for. Hence a scoped permission.
  //
  // OWNER DECISION, recorded verbatim (Michael, books-22):
  //   "I am fine with my admin manager to pay employees and vendors, but they
  //    shouldn't be able to see my personal finances, the plaid feeds, the
  //    crypto, the atm, or the audit log, which you are right, let's change it
  //    to be Security Log. I do also want you to make sure the doors are all
  //    closed and locked tight."
  //
  // The log records every action every user takes, including the owner's. It is
  // the record an admin would have to edit to hide something, so the admin is
  // exactly who should not be reading it. Renamed to "Security Log" because
  // "Audit Log" sat one menu away from "Inventory Auditing" and the two mean
  // completely different things (standing rule 42).
  //
  // This list MUST stay equal to ["owner"] alone. /admin/audit reads audit_logs
  // through the SERVICE ROLE client, which bypasses RLS -- so this page gate is
  // the real lock, not a convenience. Migration 0193 additionally re-gates the
  // table's SELECT policy from is_admin() to is_owner() so both layers say the
  // same word; nav-gate-core.test.ts asserts all of it.
  "audit.view": ["owner"],
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
  "inventory.count": "Count the shelf (blind physical counts)",
  "inventory.audit": "Approve & post inventory audits (owner only)",
  "reports.view": "View reports & exports",
  "books.view": "View the accounting books (general ledger)",
  "financials.view": "View financial reports & accounting exports",
  "finances.view": "View money accounts (bank feed, ATM vault, crypto, loans)",
  "compliance.calendar": "Track filing & compliance deadlines (owner only)",
  "users.manage": "Manage staff & roles",
  "audit.view": "Read the Security Log (who did what, and when)",
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
  "inventory.count",
  "inventory.audit",
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
  "finances.view",
  "compliance.calendar",
  "staffing.manage",
  "timeclock.use",
  "sales_limit.override",
  "users.manage",
  "audit.view",
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
