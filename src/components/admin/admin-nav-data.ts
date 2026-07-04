// Admin navigation map. Each item declares the permission required to see it.
import type { Permission } from "@/lib/auth/roles";

export type AdminNavItem = {
  label: string;
  href: string;
  permission: Permission;
  icon: string; // simple emoji/glyph for now; swap for SVG icons later
  group:
    | "Sell"
    | "Reports"
    | "CRM"
    | "Product Intake"
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
  // Sell: daily front-of-house selling & customers
  { label: "Dashboard", href: "/admin", permission: "dashboard.view", icon: "\u25a6", group: "Sell" },
  { label: "Getting Started", href: "/admin/getting-started", permission: "dashboard.view", icon: "\ud83d\ude80", group: "Sell" },
  { label: "Orders", href: "/admin/orders", permission: "orders.view", icon: "\ud83e\uddfe", group: "Sell" },
  { label: "Register Activity", href: "/admin/registers", permission: "orders.manage", icon: "\ud83d\udcb5", group: "Sell" },
  { label: "Loyalty", href: "/admin/loyalty-signups", permission: "loyalty.view", icon: "\u2605", group: "Sell" },

  // Reports: standalone top-header button (rendered as a direct link tab, not a
  // dropdown — see AdminTopNav DIRECT_LINK_GROUPS).
  { label: "Reports", href: "/admin/reports", permission: "reports.view", icon: "\ud83d\udcca", group: "Reports" },

  // CRM: customer relationship management (customers + loyalty program).
  { label: "Customers", href: "/admin/customers", permission: "customers.manage", icon: "\ud83d\udc64", group: "CRM" },
  { label: "Loyalty Program", href: "/admin/loyalty", permission: "loyalty.view", icon: "\ud83c\udf81", group: "CRM" },

  // Product Intake: the end-to-end product workflow, from procurement through
  // receiving, onboarding, menu enrichment, mastering, and paying the vendor.
  // Order mirrors the real lifecycle so staff move top-to-bottom.
  { label: "Product Discovery", href: "/admin/discovery", permission: "inventory.manage", icon: "\ud83d\udd0d", group: "Product Intake" },
  { label: "CCRS Benchmarks", href: "/admin/discovery/benchmarks", permission: "inventory.manage", icon: "\ud83d\udcca", group: "Product Intake" },
  { label: "Catalog Hub", href: "/admin/catalog", permission: "products.enrich", icon: "\ud83d\uddc2", group: "Product Intake" },
  { label: "Purchasing", href: "/admin/purchasing", permission: "inventory.manage", icon: "\ud83d\uded2", group: "Product Intake" },
  { label: "Receiving", href: "/admin/inventory/intake", permission: "inventory.manage", icon: "\ud83d\udce5", group: "Product Intake" },
  { label: "Product Onboarding", href: "/admin/inventory/drafts", permission: "inventory.manage", icon: "\ud83d\udcdd", group: "Product Intake" },
  { label: "Product Enrichment", href: "/admin/products", permission: "products.enrich", icon: "\ud83d\udce6", group: "Product Intake" },
  { label: "Product Mastering", href: "/admin/products/masters", permission: "inventory.manage", icon: "\ud83e\uddec", group: "Product Intake" },
  { label: "Accounts Payable", href: "/admin/vendor-payments", permission: "settings.manage", icon: "\ud83d\udcb3", group: "Product Intake" },
  { label: "Knowledge Base", href: "/admin/knowledge-base", permission: "products.enrich", icon: "\ud83d\udcda", group: "Product Intake" },

  { label: "Vendors & Brands", href: "/admin/vendors", permission: "vendors.manage", icon: "\ud83c\udff7", group: "Inventory" },
  { label: "Inventory", href: "/admin/inventory", permission: "inventory.manage", icon: "\ud83e\uddfe", group: "Inventory" },
  { label: "Cycle Counts", href: "/admin/inventory/cycle-counts", permission: "inventory.manage", icon: "\ud83d\udd22", group: "Inventory" },
  { label: "Returns & Destruction", href: "/admin/inventory/disposition", permission: "inventory.manage", icon: "\u267b\ufe0f", group: "Inventory" },
  { label: "Non-Cannabis", href: "/admin/inventory/noncannabis", permission: "inventory.manage", icon: "\ud83e\uddf4", group: "Inventory" },

  // Compliance: regulatory tools (CCRS / DOH)
  { label: "Compliance Health", href: "/admin/compliance/health", permission: "reports.view", icon: "\ud83d\udee1", group: "Compliance" },
  { label: "Medical", href: "/admin/medical", permission: "medical.manage", icon: "\u2695", group: "Compliance" },
  { label: "Authorization Intake", href: "/admin/medical/intake", permission: "medical.manage", icon: "\ud83d\udcc7", group: "Compliance" },
  { label: "Sales Limits", href: "/admin/compliance/sales-limits", permission: "settings.manage", icon: "\u2696", group: "Compliance" },
  { label: "Trade Samples", href: "/admin/compliance/samples", permission: "settings.manage", icon: "\ud83e\uddea", group: "Compliance" },

  // Finance: pay, hours
  { label: "Time Clock", href: "/admin/staffing", permission: "loyalty.view", icon: "\u23f1", group: "Finance" },
  { label: "Payroll (ACH)", href: "/admin/payroll", permission: "settings.manage", icon: "\ud83c\udfe6", group: "Finance" },

  // Marketing: promos, content, email, creative
  { label: "Marketing & Advertising", href: "/admin/marketing", permission: "content.edit", icon: "\ud83d\udce3", group: "Marketing" },
  { label: "Promotions", href: "/admin/promotions", permission: "promotions.manage", icon: "%", group: "Marketing" },
  { label: "Blog & Newsletter", href: "/admin/blog", permission: "blog.manage", icon: "\u270e", group: "Marketing" },
  { label: "Newsletter Send", href: "/admin/newsletter", permission: "blog.manage", icon: "\u2709", group: "Marketing" },
  { label: "Midjourney", href: "/admin/marketing/midjourney", permission: "content.edit", icon: "\ud83c\udfa8", group: "Marketing" },

  // Website: media + site content, then public page editors + menu imports.
  // Media Library is pinned to the TOP with Site Content directly under it.
  { label: "Media Library", href: "/admin/media", permission: "media.manage", icon: "\ud83d\uddbc", group: "Website" },
  { label: "Site Content", href: "/admin/content", permission: "content.edit", icon: "\u2761", group: "Website" },
  { label: "Home", href: "/admin/pages/home", permission: "content.edit", icon: "\u2302", group: "Website" },
  { label: "Menu", href: "/admin/pages/menu", permission: "content.edit", icon: "\u25a4", group: "Website" },
  { label: "Loyalty", href: "/admin/pages/loyalty", permission: "content.edit", icon: "\u2605", group: "Website" },
  { label: "Specials", href: "/admin/pages/specials", permission: "content.edit", icon: "%", group: "Website" },
  { label: "Vendors", href: "/admin/pages/vendors", permission: "content.edit", icon: "\ud83c\udff7", group: "Website" },
  { label: "FAQ", href: "/admin/pages/faq", permission: "content.edit", icon: "?", group: "Website" },
  { label: "About", href: "/admin/pages/about", permission: "content.edit", icon: "\u24d8", group: "Website" },
  { label: "Locations", href: "/admin/pages/locations", permission: "content.edit", icon: "\u26b2", group: "Website" },
  { label: "Price Match", href: "/admin/pages/price-match", permission: "content.edit", icon: "=", group: "Website" },
  { label: "Menu Imports", href: "/admin/menu-imports", permission: "menu.import", icon: "\u2b06", group: "Website" },

  // Insights: AI usage metering (Reports now has its own top-header button).
  { label: "AI Usage", href: "/admin/ai-usage", permission: "reports.view", icon: "\u2728", group: "Insights" },

  // Admin: users, settings, integrations, equipment
  { label: "Users", href: "/admin/users", permission: "users.manage", icon: "\ud83d\udc65", group: "Admin" },
  { label: "Equipment", href: "/admin/equipment", permission: "inventory.manage", icon: "\ud83d\udee0", group: "Admin" },
  { label: "Types & Categories", href: "/admin/settings/types", permission: "settings.manage", icon: "\ud83c\udff7", group: "Admin" },
  { label: "Integrations", href: "/admin/integrations", permission: "settings.manage", icon: "\ud83d\udd0c", group: "Admin" },
  { label: "Receipt Printer", href: "/admin/settings/receipt-printer", permission: "settings.manage", icon: "\ud83e\uddfe", group: "Admin" },
  { label: "Settings", href: "/admin/settings", permission: "settings.manage", icon: "\u2699", group: "Admin" },
  { label: "Audit Log", href: "/admin/audit", permission: "users.manage", icon: "\u29d7", group: "Admin" },
  { label: "Help & FAQ", href: "/admin/help", permission: "dashboard.view", icon: "?", group: "Admin" },
];

export const navGroups: AdminNavItem["group"][] = [
  "Sell",
  "Reports",
  "CRM",
  "Product Intake",
  "Inventory",
  "Website",
  "Compliance",
  "Finance",
  "Marketing",
  "Insights",
  "Admin",
];
