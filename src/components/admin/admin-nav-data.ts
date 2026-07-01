// Admin navigation map. Each item declares the permission required to see it.
import type { Permission } from "@/lib/auth/roles";

export type AdminNavItem = {
  label: string;
  href: string;
  permission: Permission;
  icon: string; // simple emoji/glyph for now; swap for SVG icons later
  group:
    | "Sell"
    | "Inventory"
    | "Compliance"
    | "Finance"
    | "Marketing"
    | "Website"
    | "Insights"
    | "Admin";
  comingSoon?: boolean;
};

// Grouped for findability (NN/G IA principles: group by task-relatedness,
// keep each group scannable, split overloaded buckets, clear labels for good
// "information scent"). The old single "Operations" group (15 items) is split
// into Sell / Inventory / Compliance / Finance so staff can find things fast.
export const adminNav: AdminNavItem[] = [
  // ── Sell: daily front-of-house selling & customers ──────────────────────
  { label: "Dashboard", href: "/admin", permission: "dashboard.view", icon: "▦", group: "Sell" },
  { label: "Getting Started", href: "/admin/getting-started", permission: "dashboard.view", icon: "🚀", group: "Sell" },
  { label: "Orders", href: "/admin/orders", permission: "orders.view", icon: "🧾", group: "Sell" },
  { label: "Registers & Drawers", href: "/admin/registers", permission: "orders.manage", icon: "💵", group: "Sell" },
  { label: "Customers", href: "/admin/customers", permission: "customers.manage", icon: "👤", group: "Sell" },
  { label: "Loyalty", href: "/admin/loyalty-signups", permission: "loyalty.view", icon: "★", group: "Sell" },
  { label: "Loyalty Program", href: "/admin/loyalty", permission: "loyalty.view", icon: "🎁", group: "Sell" },

  // ── Inventory: catalog, receiving, counts, purchasing ───────────────────
  { label: "Vendors & Brands", href: "/admin/vendors", permission: "vendors.manage", icon: "🏷", group: "Inventory" },
  { label: "Products", href: "/admin/products", permission: "products.enrich", icon: "📦", group: "Inventory" },
  { label: "Product Mastering", href: "/admin/products/masters", permission: "inventory.manage", icon: "🧬", group: "Inventory" },
  { label: "Inventory", href: "/admin/inventory", permission: "inventory.manage", icon: "🧾", group: "Inventory" },
  { label: "Vendor Intake", href: "/admin/inventory/intake", permission: "inventory.manage", icon: "📥", group: "Inventory" },
  { label: "Product Drafts", href: "/admin/inventory/drafts", permission: "inventory.manage", icon: "📝", group: "Inventory" },
  { label: "Cycle Counts", href: "/admin/inventory/cycle-counts", permission: "inventory.manage", icon: "🔢", group: "Inventory" },
  { label: "Returns & Destruction", href: "/admin/inventory/disposition", permission: "inventory.manage", icon: "♻️", group: "Inventory" },
  { label: "Purchasing", href: "/admin/purchasing", permission: "inventory.manage", icon: "🛒", group: "Inventory" },
  { label: "Equipment", href: "/admin/equipment", permission: "inventory.manage", icon: "🛠", group: "Inventory" },
  { label: "Knowledge Base", href: "/admin/knowledge-base", permission: "products.enrich", icon: "📚", group: "Inventory" },

  // ── Compliance: regulatory tools (CCRS / DOH) ───────────────────────────
  { label: "Compliance Health", href: "/admin/compliance/health", permission: "reports.view", icon: "🛡", group: "Compliance" },
  { label: "Medical", href: "/admin/medical", permission: "medical.manage", icon: "⚕", group: "Compliance" },
  { label: "Authorization Intake", href: "/admin/medical/intake", permission: "medical.manage", icon: "📇", group: "Compliance" },
  { label: "Sales Limits", href: "/admin/compliance/sales-limits", permission: "settings.manage", icon: "⚖", group: "Compliance" },
  { label: "Trade Samples", href: "/admin/compliance/samples", permission: "settings.manage", icon: "🧪", group: "Compliance" },

  // ── Finance: pay, hours ─────────────────────────────────────────────────
  { label: "Time Clock", href: "/admin/staffing", permission: "loyalty.view", icon: "⏱", group: "Finance" },
  { label: "Payroll (ACH)", href: "/admin/payroll", permission: "settings.manage", icon: "🏦", group: "Finance" },

  // ── Marketing: promos, content, email, creative ─────────────────────────
  { label: "Promotions", href: "/admin/promotions", permission: "promotions.manage", icon: "%", group: "Marketing" },
  { label: "Blog & Newsletter", href: "/admin/blog", permission: "blog.manage", icon: "✎", group: "Marketing" },
  { label: "Newsletter Send", href: "/admin/newsletter", permission: "blog.manage", icon: "✉", group: "Marketing" },
  { label: "Media Library", href: "/admin/media", permission: "media.manage", icon: "🖼", group: "Marketing" },
  { label: "Midjourney", href: "/admin/marketing/midjourney", permission: "content.edit", icon: "🎨", group: "Marketing" },

  // ── Website: public page editors + site content + menu imports ──────────
  { label: "Home", href: "/admin/pages/home", permission: "content.edit", icon: "⌂", group: "Website" },
  { label: "Menu", href: "/admin/pages/menu", permission: "content.edit", icon: "▤", group: "Website" },
  { label: "Loyalty", href: "/admin/pages/loyalty", permission: "content.edit", icon: "★", group: "Website" },
  { label: "Specials", href: "/admin/pages/specials", permission: "content.edit", icon: "%", group: "Website" },
  { label: "Vendors", href: "/admin/pages/vendors", permission: "content.edit", icon: "🏷", group: "Website" },
  { label: "FAQ", href: "/admin/pages/faq", permission: "content.edit", icon: "?", group: "Website" },
  { label: "About", href: "/admin/pages/about", permission: "content.edit", icon: "ⓘ", group: "Website" },
  { label: "Locations", href: "/admin/pages/locations", permission: "content.edit", icon: "⚲", group: "Website" },
  { label: "Price Match", href: "/admin/pages/price-match", permission: "content.edit", icon: "=", group: "Website" },
  { label: "Site Content", href: "/admin/content", permission: "content.edit", icon: "❡", group: "Website" },
  { label: "Menu Imports", href: "/admin/menu-imports", permission: "menu.import", icon: "⬆", group: "Website" },

  // ── Insights: reporting ─────────────────────────────────────────────────
  { label: "Reports", href: "/admin/reports", permission: "reports.view", icon: "📊", group: "Insights" },
  { label: "AI Usage", href: "/admin/ai-usage", permission: "reports.view", icon: "✨", group: "Insights" },

  // ── Admin: users, settings, integrations ────────────────────────────────
  { label: "Users", href: "/admin/users", permission: "users.manage", icon: "👥", group: "Admin" },
  { label: "Types & Categories", href: "/admin/settings/types", permission: "settings.manage", icon: "🏷", group: "Admin" },
  { label: "Integrations", href: "/admin/integrations", permission: "settings.manage", icon: "🔌", group: "Admin" },
  { label: "Receipt Printer", href: "/admin/settings/receipt-printer", permission: "settings.manage", icon: "🧾", group: "Admin" },
  { label: "Settings", href: "/admin/settings", permission: "settings.manage", icon: "⚙", group: "Admin" },
  { label: "Audit Log", href: "/admin/audit", permission: "users.manage", icon: "⧗", group: "Admin" },
  { label: "Help & FAQ", href: "/admin/help", permission: "dashboard.view", icon: "?", group: "Admin" },
];

export const navGroups: AdminNavItem["group"][] = [
  "Sell",
  "Inventory",
  "Compliance",
  "Finance",
  "Marketing",
  "Website",
  "Insights",
  "Admin",
];
