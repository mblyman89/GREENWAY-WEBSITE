// Admin navigation map. Each item declares the permission required to see it.
import type { Permission } from "@/lib/auth/roles";

export type AdminNavItem = {
  label: string;
  href: string;
  permission: Permission;
  icon: string; // simple emoji/glyph for now; swap for SVG icons later
  group: "Operations" | "Catalog" | "Content" | "Insights" | "Admin";
  comingSoon?: boolean;
};

export const adminNav: AdminNavItem[] = [
  { label: "Dashboard", href: "/admin", permission: "dashboard.view", icon: "▦", group: "Operations" },
  { label: "Menu Imports", href: "/admin/menu-imports", permission: "menu.import", icon: "⬆", group: "Operations" },
  { label: "Orders", href: "/admin/orders", permission: "orders.view", icon: "🧾", group: "Operations" },
  { label: "Loyalty", href: "/admin/loyalty-signups", permission: "loyalty.view", icon: "★", group: "Operations" },

  { label: "Vendors & Brands", href: "/admin/vendors", permission: "vendors.manage", icon: "🏷", group: "Catalog" },
  { label: "Products", href: "/admin/products", permission: "products.enrich", icon: "📦", group: "Catalog" },
  { label: "Promotions", href: "/admin/promotions", permission: "promotions.manage", icon: "%", group: "Catalog" },

  { label: "Media Library", href: "/admin/media", permission: "media.manage", icon: "🖼", group: "Content" },
  { label: "Blog & Newsletter", href: "/admin/blog", permission: "blog.manage", icon: "✎", group: "Content" },
  { label: "Site Content", href: "/admin/content", permission: "content.edit", icon: "❡", group: "Content" },

  { label: "Reports", href: "/admin/reports", permission: "reports.view", icon: "📊", group: "Insights", comingSoon: true },

  { label: "Users", href: "/admin/users", permission: "users.manage", icon: "👥", group: "Admin" },
  { label: "Settings", href: "/admin/settings", permission: "settings.manage", icon: "⚙", group: "Admin", comingSoon: true },
  { label: "Audit Log", href: "/admin/audit", permission: "users.manage", icon: "⧗", group: "Admin" },
];

export const navGroups: AdminNavItem["group"][] = [
  "Operations",
  "Catalog",
  "Content",
  "Insights",
  "Admin",
];
