// Admin navigation map. Each item declares the permission required to see it.
import type { Permission } from "@/lib/auth/roles";

export type AdminNavItem = {
  label: string;
  href: string;
  permission: Permission;
  icon: string; // simple emoji/glyph for now; swap for SVG icons later
  group: "Operations" | "Catalog" | "Content" | "Pages" | "Insights" | "Admin";
  comingSoon?: boolean;
};

export const adminNav: AdminNavItem[] = [
  { label: "Dashboard", href: "/admin", permission: "dashboard.view", icon: "▦", group: "Operations" },
  { label: "Getting Started", href: "/admin/getting-started", permission: "dashboard.view", icon: "🚀", group: "Operations" },
  { label: "Menu Imports", href: "/admin/menu-imports", permission: "menu.import", icon: "⬆", group: "Operations" },
  { label: "Orders", href: "/admin/orders", permission: "orders.view", icon: "🧾", group: "Operations" },
  { label: "Loyalty", href: "/admin/loyalty-signups", permission: "loyalty.view", icon: "★", group: "Operations" },
  { label: "Loyalty Program", href: "/admin/loyalty", permission: "loyalty.view", icon: "🎁", group: "Operations" },
  { label: "Customers", href: "/admin/customers", permission: "customers.manage", icon: "👤", group: "Operations" },
  { label: "Medical", href: "/admin/medical", permission: "medical.manage", icon: "⚕", group: "Operations" },
  { label: "Time Clock", href: "/admin/staffing", permission: "loyalty.view", icon: "⏱", group: "Operations" },
  { label: "Registers & Drawers", href: "/admin/registers", permission: "orders.manage", icon: "💵", group: "Operations" },
  { label: "Equipment", href: "/admin/equipment", permission: "inventory.manage", icon: "🛠", group: "Operations" },

  { label: "Vendors & Brands", href: "/admin/vendors", permission: "vendors.manage", icon: "🏷", group: "Catalog" },
  { label: "Products", href: "/admin/products", permission: "products.enrich", icon: "📦", group: "Catalog" },
  { label: "Product Mastering", href: "/admin/products/masters", permission: "inventory.manage", icon: "🧬", group: "Catalog" },
  { label: "Inventory", href: "/admin/inventory", permission: "inventory.manage", icon: "🧾", group: "Catalog" },
  { label: "Vendor Intake", href: "/admin/inventory/intake", permission: "inventory.manage", icon: "📥", group: "Catalog" },
  { label: "Product Drafts", href: "/admin/inventory/drafts", permission: "inventory.manage", icon: "📝", group: "Catalog" },
  { label: "Cycle Counts", href: "/admin/inventory/cycle-counts", permission: "inventory.manage", icon: "🔢", group: "Catalog" },
  { label: "Returns & Destruction", href: "/admin/inventory/disposition", permission: "inventory.manage", icon: "♻️", group: "Catalog" },
  { label: "Promotions", href: "/admin/promotions", permission: "promotions.manage", icon: "%", group: "Catalog" },
  { label: "Knowledge Base", href: "/admin/knowledge-base", permission: "products.enrich", icon: "📚", group: "Catalog" },

  // Per-page builders — each page with banners/sections gets its own tab.
  { label: "Home", href: "/admin/pages/home", permission: "content.edit", icon: "⌂", group: "Pages" },
  { label: "Menu", href: "/admin/pages/menu", permission: "content.edit", icon: "▤", group: "Pages" },
  { label: "Loyalty", href: "/admin/pages/loyalty", permission: "content.edit", icon: "★", group: "Pages" },
  { label: "Specials", href: "/admin/pages/specials", permission: "content.edit", icon: "%", group: "Pages" },
  { label: "Vendors", href: "/admin/pages/vendors", permission: "content.edit", icon: "🏷", group: "Pages" },
  { label: "FAQ", href: "/admin/pages/faq", permission: "content.edit", icon: "?", group: "Pages" },
  { label: "About", href: "/admin/pages/about", permission: "content.edit", icon: "ⓘ", group: "Pages" },
  { label: "Locations", href: "/admin/pages/locations", permission: "content.edit", icon: "⚲", group: "Pages" },
  { label: "Price Match", href: "/admin/pages/price-match", permission: "content.edit", icon: "=", group: "Pages" },

  { label: "Media Library", href: "/admin/media", permission: "media.manage", icon: "🖼", group: "Content" },
  { label: "Blog & Newsletter", href: "/admin/blog", permission: "blog.manage", icon: "✎", group: "Content" },
  { label: "Newsletter Send", href: "/admin/newsletter", permission: "blog.manage", icon: "✉", group: "Content" },
  { label: "Site Content", href: "/admin/content", permission: "content.edit", icon: "❡", group: "Content" },

  { label: "Reports", href: "/admin/reports", permission: "reports.view", icon: "📊", group: "Insights" },
  { label: "AI Usage", href: "/admin/ai-usage", permission: "reports.view", icon: "✨", group: "Insights" },

  { label: "Users", href: "/admin/users", permission: "users.manage", icon: "👥", group: "Admin" },
  { label: "Types & Categories", href: "/admin/settings/types", permission: "settings.manage", icon: "🏷", group: "Admin" },
  { label: "Sales Limits", href: "/admin/compliance/sales-limits", permission: "settings.manage", icon: "⚖", group: "Admin" },
  { label: "Integrations", href: "/admin/integrations", permission: "settings.manage", icon: "🔌", group: "Admin" },
  { label: "Receipt Printer", href: "/admin/settings/receipt-printer", permission: "settings.manage", icon: "🧾", group: "Admin" },
  { label: "Settings", href: "/admin/settings", permission: "settings.manage", icon: "⚙", group: "Admin" },
  { label: "Audit Log", href: "/admin/audit", permission: "users.manage", icon: "⧗", group: "Admin" },
  { label: "Help & FAQ", href: "/admin/help", permission: "dashboard.view", icon: "?", group: "Admin" },
];

export const navGroups: AdminNavItem["group"][] = [
  "Operations",
  "Catalog",
  "Content",
  "Pages",
  "Insights",
  "Admin",
];
