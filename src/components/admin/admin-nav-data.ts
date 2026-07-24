// Admin navigation map. Each item declares the permission required to see it.
import type { Permission } from "@/lib/auth/roles";

export type AdminNavItem = {
  label: string;
  href: string;
  permission: Permission;
  icon: string; // emoji/glyph fallback used when `glyph` is not set
  /**
   * Optional custom SVG glyph key (see src/components/admin/nav-glyphs.tsx).
   * When set, the nav renders the bespoke SVG instead of the emoji `icon`.
   */
  glyph?: string;
  group:
    | "Dashboard"
    | "Reports"
    | "CRM"
    | "Product Intake"
    | "Inventory"
    | "Website"
    | "MKTG & ADV"
    | "Employee"
    | "Medical"
    | "CCRS"
    | "Admin";
  comingSoon?: boolean;
};

// Grouped for findability (NN/G IA principles: group by task-relatedness,
// keep each group scannable, split overloaded buckets, clear labels for good
// "information scent"). The old single "Operations" group (15 items) is split
// into Sell / Inventory / Compliance / Finance so staff can find things fast.
//
// ICONS: chosen to match the conventions of top-tier POS / retail back offices
// (Square, Shopify, Toast, Dutchie, Cova) and tuned for a cannabis retailer.
// Every icon is DISTINCT within its dropdown so items are easy to scan, and
// cannabis-specific glyphs (🌿 flower, 🧾 receipts, 🛡 compliance) are used where
// they read clearly. Kept as emoji (no icon-font dependency); swap for SVG later.
export const adminNav: AdminNavItem[] = [
  // Dashboard: daily front-of-house. (The "Dashboard" landing page itself is
  // reachable via the Greenway wordmark, so no separate nav item for it.)
  { label: "Online Orders", href: "/admin/orders", permission: "orders.view", icon: "\ud83d\uded2", group: "Dashboard" }, // 🛒 shopping cart
  { label: "Loyalty signups", href: "/admin/loyalty-signups", permission: "loyalty.view", icon: "\ud83c\udf9f\ufe0f", group: "Dashboard" }, // 🎟️ ticket / signup

  // Reports: standalone top-header button (rendered as a direct link tab, not a
  // dropdown — see AdminTopNav DIRECT_LINK_GROUPS).
  { label: "Reports", href: "/admin/reports", permission: "reports.view", icon: "\ud83d\udcc8", group: "Reports" }, // 📈 chart increasing

  // CRM: customer relationship management (customers + loyalty program).
  { label: "Customers", href: "/admin/customers", permission: "customers.manage", icon: "\ud83d\udc65", group: "CRM" }, // 👥 people
  { label: "Loyalty Program", href: "/admin/loyalty", permission: "loyalty.view", icon: "\ud83c\udfc5", group: "CRM" }, // 🏅 medal / rewards

  // Product Intake: the end-to-end product workflow. W1 — ordered to mirror
  // THE canonical journey (src/lib/catalog/journey-core.ts): the Hub (the map)
  // first, then the stages in journey order, then reference surfaces
  // (fuel, not stages) last. 4 · Publish lives under Admin → Menu Imports.
  { label: "Catalog Hub", href: "/admin/catalog", permission: "products.enrich", icon: "\ud83d\uddc2\ufe0f", group: "Product Intake" }, // 🗂️ the map / front door of the journey
  { label: "Product Discovery", href: "/admin/discovery", permission: "inventory.manage", icon: "\ud83d\udd0d", group: "Product Intake" }, // 🔍 0 · Discover
  { label: "Purchasing", href: "/admin/purchasing", permission: "inventory.manage", icon: "\ud83e\uddfe", group: "Product Intake" }, // 🧾 1 · Order
  { label: "Receiving", href: "/admin/inventory/intake", permission: "inventory.manage", icon: "\ud83d\ude9a", group: "Product Intake" }, // 🚚 2 · Receive
  { label: "Product Onboarding", href: "/admin/inventory/drafts", permission: "inventory.manage", icon: "\ud83c\udd95", group: "Product Intake" }, // 🆕 3 · Onboard
  { label: "Product Enrichment", href: "/admin/products", permission: "products.enrich", icon: "\u2728", group: "Product Intake" }, // ✨ 5 · Enrich
  { label: "Product Mastering", href: "/admin/products/masters", permission: "inventory.manage", icon: "\ud83e\uddec", group: "Product Intake" }, // 🧬 6 · Master
  { label: "Accounts Payable", href: "/admin/vendor-payments", permission: "payables.manage", icon: "\ud83d\udcb3", group: "Product Intake" }, // 💳 7 · Pay (W10: scoped — purchase manager runs AP)
  { label: "CCRS Benchmarks", href: "/admin/discovery/benchmarks", permission: "inventory.manage", icon: "\ud83d\udcca", group: "Product Intake" }, // 📊 reference — fuel, not a stage
  { label: "Knowledge Base", href: "/admin/knowledge-base", permission: "products.enrich", icon: "\ud83d\udcda", group: "Product Intake" }, // 📚 reference — fuel, not a stage

  { label: "Inventory", href: "/admin/inventory", permission: "inventory.manage", icon: "\ud83c\udf41", glyph: "pot-leaf", group: "Inventory" }, // custom pot-leaf SVG (cannabis flower lots)
  { label: "Other Inventory", href: "/admin/inventory/noncannabis", permission: "inventory.manage", icon: "\ud83d\udeac", glyph: "bong", group: "Inventory" }, // custom bong SVG (non-cannabis goods) — swap to "bong-outline" for the light version
  { label: "Vendors & Brands", href: "/admin/vendors", permission: "vendors.manage", icon: "\ud83c\udfe2", group: "Inventory" }, // 🏢 suppliers
  { label: "Types & Categories", href: "/admin/settings/types", permission: "settings.manage", icon: "\ud83c\udff7\ufe0f", group: "Inventory" }, // 🏷️ tags
  { label: "Cycle Counts", href: "/admin/inventory/cycle-counts", permission: "inventory.manage", icon: "\ud83d\udccb", group: "Inventory" }, // 📋 count clipboard
  { label: "Returns & Destruction", href: "/admin/inventory/disposition", permission: "inventory.manage", icon: "\u267b\ufe0f", group: "Inventory" }, // ♻️ disposition

  // MKTG & ADV: promos, content, email, creative
  { label: "Marketing & Advertising", href: "/admin/marketing", permission: "content.edit", icon: "\ud83d\udce3", group: "MKTG & ADV" }, // 📣 megaphone
  { label: "Promotions", href: "/admin/promotions", permission: "promotions.manage", icon: "\ud83c\udff7\ufe0f", group: "MKTG & ADV" }, // 🏷️ deal tag
  { label: "Blog & Newsletter", href: "/admin/blog", permission: "blog.manage", icon: "\ud83d\udcdd", group: "MKTG & ADV" }, // 📝 writing
  { label: "Email Newsletter", href: "/admin/newsletter", permission: "blog.manage", icon: "\u2709\ufe0f", group: "MKTG & ADV" }, // ✉️ email
  { label: "Creative Studio", href: "/admin/marketing/midjourney", permission: "content.edit", icon: "\ud83c\udfa8", group: "MKTG & ADV" }, // 🎨 creative

  // Employee: the command center (roster/onboarding/offboarding + handbook),
  // then schedule + time & pay + trade samples. Task S-b restructure.
  { label: "Employees", href: "/admin/staffing/employees", permission: "staffing.manage", icon: "\ud83e\uddd1\u200d\ud83e\udd1d\u200d\ud83e\uddd1", group: "Employee" }, // 🧑‍🤝‍🧑 command center
  { label: "Schedule", href: "/admin/staffing/schedule", permission: "staffing.manage", icon: "\ud83d\udcc6", group: "Employee" }, // 📆 week builder
  { label: "Handbook & Policies", href: "/admin/staffing/handbook", permission: "staffing.manage", icon: "\ud83d\udcd6", group: "Employee" }, // 📖 handbook
  { label: "Time Clock", href: "/admin/staffing", permission: "timeclock.use", icon: "\ud83d\udd50", group: "Employee" }, // 🕐 clock
  { label: "Payroll", href: "/admin/payroll", permission: "settings.manage", icon: "\ud83d\udcb0", group: "Employee" }, // 💰 pay
  { label: "Employee Samples", href: "/admin/compliance/samples", permission: "settings.manage", icon: "\ud83e\uddea", group: "Employee" }, // 🧪 trade samples
  { label: "Sample History", href: "/admin/compliance/samples/history", permission: "settings.manage", icon: "\ud83d\udccb", group: "Employee" }, // 📋 sample receipts log
  { label: "Register Activity", href: "/admin/registers", permission: "orders.manage", icon: "\ud83d\udcb5", group: "Employee" }, // 💵 cash drawer

  // Medical: ONE page — /admin/medical carries the guided patient intake,
  // recognition cards, DOH product registry, and the exempt-sale ledger.
  // Rendered as a direct-link tab (no dropdown) — see DIRECT_LINK_GROUPS.
  { label: "Medical Cannabis", href: "/admin/medical", permission: "medical.manage", icon: "\ud83c\udfe5", group: "Medical" }, // 🏥 medical

  // CCRS: standalone top-header button → the Compliance Command Center (Task W;
  // direct link, no dropdown). Compliance Health stays reachable from the
  // command center's header link + the second item below.
  { label: "CCRS Command Center", href: "/admin/compliance/ccrs", permission: "reports.view", icon: "\ud83d\udee1\ufe0f", group: "CCRS" }, // 🛡️ compliance shield
  { label: "Compliance Health", href: "/admin/compliance/health", permission: "reports.view", icon: "\ud83e\ude7a", group: "CCRS" }, // 🩺 health check
  { label: "Regulatory Watch", href: "/admin/compliance/regulatory", permission: "reports.view", icon: "\ud83d\udce1", group: "CCRS" }, // 📡 rule-change radar (SLICE 37)
  { label: "Compliance Calendar", href: "/admin/compliance/calendar", permission: "settings.manage", icon: "\ud83d\udcc5", group: "Admin" }, // 📅 S-18 recurring obligations

  // Website: sync dashboard first, then media + site content, then public
  // page editors + menu imports. Website Sync is the harmony dashboard (Task
  // T PR 5) — what the storefront is serving RIGHT NOW, with edit links.
  { label: "Website Sync", href: "/admin/website-sync", permission: "dashboard.view", icon: "\ud83d\udd17", group: "Website" }, // 🔗 storefront harmony
  { label: "Media Library", href: "/admin/media", permission: "media.manage", icon: "\ud83d\uddbc\ufe0f", group: "Website" }, // 🖼️ media
  { label: "Site Content", href: "/admin/content", permission: "content.edit", icon: "\ud83d\udcc4", group: "Website" }, // 📄 text blocks
  { label: "Home", href: "/admin/pages/home", permission: "content.edit", icon: "\ud83c\udfe0", group: "Website" }, // 🏠 home page
  { label: "Menu", href: "/admin/pages/menu", permission: "content.edit", icon: "\ud83c\udf3f", group: "Website" }, // 🌿 product menu
  { label: "Loyalty", href: "/admin/pages/loyalty", permission: "content.edit", icon: "\ud83c\udfc5", group: "Website" }, // 🏅 loyalty page
  { label: "Specials", href: "/admin/pages/specials", permission: "content.edit", icon: "\ud83d\udd25", group: "Website" }, // 🔥 hot deals
  { label: "Vendors", href: "/admin/pages/vendors", permission: "content.edit", icon: "\ud83c\udfe2", group: "Website" }, // 🏢 vendors page
  { label: "FAQ", href: "/admin/pages/faq", permission: "content.edit", icon: "\ud83d\udcac", group: "Website" }, // 💬 Q&A
  { label: "About", href: "/admin/pages/about", permission: "content.edit", icon: "\u2139\ufe0f", group: "Website" }, // ℹ️ about
  { label: "Locations", href: "/admin/pages/locations", permission: "content.edit", icon: "\ud83d\udccd", group: "Website" }, // 📍 map pin
  { label: "Price Match", href: "/admin/pages/price-match", permission: "content.edit", icon: "\ud83c\udff7\ufe0f", group: "Website" }, // 🏷️ price tag

  // Admin: users, integrations, equipment, limits, AI usage, audit, settings,
  // help, and menu imports. Order set by the owner.
  { label: "Users", href: "/admin/users", permission: "users.manage", icon: "\ud83d\udc64", group: "Admin" }, // 👤 user
  { label: "Integrations", href: "/admin/integrations", permission: "settings.manage", icon: "\ud83d\udd0c", group: "Admin" }, // 🔌 integrations
  { label: "Banking", href: "/admin/settings/banking", permission: "settings.manage", icon: "\ud83c\udfe6", group: "Admin" }, // bank / ACH origination
  { label: "Equipment", href: "/admin/equipment", permission: "inventory.manage", icon: "\ud83d\udda8\ufe0f", group: "Admin" }, // 🖨️ hardware
  { label: "Sales Limits", href: "/admin/compliance/sales-limits", permission: "settings.manage", icon: "\u2696\ufe0f", group: "Admin" }, // ⚖️ legal limits
  { label: "AI Usage", href: "/admin/ai-usage", permission: "reports.view", icon: "\ud83e\udde0", group: "Admin" }, // 🧠 AI
  { label: "Audit Log", href: "/admin/audit", permission: "users.manage", icon: "\ud83d\udd0e", group: "Admin" }, // 🔎 audit trail
  { label: "Settings", href: "/admin/settings", permission: "settings.manage", icon: "\u2699\ufe0f", group: "Admin" }, // ⚙️ settings
  { label: "Help & FAQ", href: "/admin/help", permission: "dashboard.view", icon: "\ud83d\udca1", group: "Admin" }, // 💡 help
  { label: "Menu Imports", href: "/admin/menu-imports", permission: "menu.import", icon: "\ud83d\udce5", group: "Admin" }, // 📥 import
];

export const navGroups: AdminNavItem["group"][] = [
  "Dashboard",
  "Reports",
  "CRM",
  "Product Intake",
  "Inventory",
  "Website",
  "MKTG & ADV",
  "Employee",
  "Medical",
  "CCRS",
  "Admin",
];
