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
  // (fuel, not stages) last. SLICE 76: 4 · Publish has its own command center;
  // 7 · Inventory keeps its long-standing spot in the Inventory group below.
  { label: "Catalog Hub", href: "/admin/catalog", permission: "products.enrich", icon: "\ud83d\uddc2\ufe0f", group: "Product Intake" }, // 🗂️ the map / front door of the journey
  { label: "Product Discovery", href: "/admin/discovery", permission: "inventory.manage", icon: "\ud83d\udd0d", group: "Product Intake" }, // 🔍 0 · Discover
  { label: "Purchasing", href: "/admin/purchasing", permission: "inventory.manage", icon: "\ud83e\uddfe", group: "Product Intake" }, // 🧾 1 · Order
  { label: "Receiving", href: "/admin/inventory/intake", permission: "inventory.manage", icon: "\ud83d\ude9a", group: "Product Intake" }, // 🚚 2 · Receive
  { label: "Product Onboarding", href: "/admin/inventory/drafts", permission: "inventory.manage", icon: "\ud83c\udd95", group: "Product Intake" }, // 🆕 3 · Onboard
  { label: "Publish Menu", href: "/admin/publish", permission: "menu.import", icon: "\ud83d\udce2", group: "Product Intake" }, // 📢 4 · Publish (SLICE 76 command center)
  { label: "Product Enrichment", href: "/admin/products", permission: "products.enrich", icon: "\u2728", group: "Product Intake" }, // ✨ 5 · Enrich
  { label: "Product Mastering", href: "/admin/products/masters", permission: "inventory.manage", icon: "\ud83e\uddec", group: "Product Intake" }, // 🧬 6 · Master
  { label: "Accounts Payable", href: "/admin/vendor-payments", permission: "payables.manage", icon: "\ud83d\udcb3", group: "Product Intake" }, // 💳 8 · Pay (W10: scoped — purchase manager runs AP)
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
  // "Site Content" nav entry removed (MIG-7 PR-B): the /admin/content junk-drawer
  // page was retired -- every content block now has a dedicated editor (Pages,
  // Header & Footer, Branding, Legal, etc.) and the live preview + SEO editor
  // moved to Website Sync. Nothing links here anymore.
  { label: "Header & Footer", href: "/admin/header-footer", permission: "content.edit", icon: "\ud83d\udd17", group: "Website" }, // 🔗 footer links & messages (SLICE 104)
  { label: "Branding", href: "/admin/settings/branding", permission: "content.edit", icon: "\ud83c\udfa8", group: "Website" }, // 🎨 site-wide fonts (heading + body) — MIG-4 MS-4.1
  { label: "Legal Policies", href: "/admin/legal-policies", permission: "content.edit", icon: "\u2696\ufe0f", group: "Website" }, // ⚖️ privacy / terms / consumer health data (SLICE 105b)
  { label: "Blog wording", href: "/admin/blog/content", permission: "content.edit", icon: "\ud83d\udcc4", group: "Website" }, // blog page wording (hero heading/intro + button labels) -- MIG-6 Slice 1; relocated MKTG -> Website in MIG-6 Slice 2 so all page editors live under Website; posts live in Blog & Newsletter, card design not editable here
  { label: "Home", href: "/admin/pages/home", permission: "content.edit", icon: "\ud83c\udfe0", group: "Website" }, // 🏠 home page
  { label: "Shop Banner", href: "/admin/content/shop-banner", permission: "content.edit", icon: "\ud83c\udf9e\ufe0f", group: "Website" }, // 🎞️ the Shop (/menu) top-banner carousel — up to 10 "special" slides, full loyalty-style editor + per-slide CTAs + optional schedule (SLICE A / SHOP-1)
  { label: "Loyalty", href: "/admin/loyalty-page", permission: "content.edit", icon: "\ud83c\udfc5", group: "Website" }, // 🏅 public /loyalty page: editable friendly copy (signup form + program-terms headings) — SLICE 108. Numbers stay live from CRM Loyalty Program; consent text is fixed. Re-pointed from /admin/pages/loyalty per SLICE 106 Specials precedent.
  { label: "Specials", href: "/admin/specials", permission: "content.edit", icon: "\ud83d\udd25", group: "Website" }, // deal-area presentation controls (SLICE 106) — which cards show/order/badge/copy; prices come from Promotions
  { label: "Medical page", href: "/admin/medical-page", permission: "content.edit", icon: "\ud83e\ude7a", group: "Website" }, // 🩺 public /medical page: hide-page switch + editable copy (SLICE 107). Distinct from /admin/medical patient intake (medical.manage).
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
  { label: "Bank Feeds", href: "/admin/plaid", permission: "finances.view", icon: "\ud83d\udd17", group: "Admin" }, // 🔗 Plaid: read-only bank/credit feeds for automatic bookkeeping (P2)
  { label: "Loans", href: "/admin/loans", permission: "finances.view", icon: "🏠", group: "Admin" }, // manual loans + amortization schedule (mortgage, financing) with Timberland audit trail
  { label: "Crypto Portfolio", href: "/admin/crypto", permission: "finances.view", icon: "\u20bf", group: "Admin" }, // ₿ watch-only crypto portfolio: read-only wallets, USD valuation, IRS cost-basis (C3)
  { label: "ATM", href: "/admin/atm", permission: "finances.view", icon: "\ud83c\udfe7", group: "Admin" }, // ATM sign: PAI ATM (paireports.com) settlements, surcharge revenue & cash loads
  // Slice books-06: the four MONEY pages moved from "settings.manage"
  // (owner+admin) to "finances.view" (OWNER ONLY), matching migration 0190,
  // which re-gates the 25 tables behind them from is_staff() to is_owner().
  // "Banking" above deliberately stays on settings.manage -- it is the vendor
  // and employee payee vault, i.e. how an admin pays vendors and pays
  // employees, which the owner explicitly kept with admin.
  // F5-K: THE BOOKS. Gated on "books.view" (OWNER ONLY as of the 2026-08-17
  // owner decision), which mirrors the database's is_owner() check on every
  // accounting RPC (migration 0185). Do NOT change these to "reports.view" --
  // that permission also grants manager and readonly, who would see the links
  // and then hit a raw database refusal.
  { label: "General Journal", href: "/admin/books/journal", permission: "books.view", icon: "\u270d\ufe0f", group: "Admin" }, // writing hand: manual entries
  { label: "Conversion", href: "/admin/books/conversion", permission: "books.view", icon: "\ud83d\udd01", group: "Admin" }, // leaving Cultivera and Sage, 2026-11-01
  { label: "Bills & 280E", href: "/admin/books/bills", permission: "books.view", icon: "\ud83e\uddfe", group: "Admin" }, // receipt: what survives 280E and what it takes
  { label: "Payroll & COGS", href: "/admin/books/payroll", permission: "books.view", icon: "\ud83d\udc77", group: "Admin" }, // construction worker: which labor may be inventoried (books-04)
  { label: "Bank & Reconcile", href: "/admin/books/bank", permission: "books.view", icon: "\ud83c\udfe6", group: "Admin" }, // bank: matching the feed to the books, and the two silent errors (books-05)
  { label: "Trial Balance", href: "/admin/books/trial-balance", permission: "books.view", icon: "\u2696\ufe0f", group: "Admin" }, // scales: debits = credits
  { label: "General Ledger", href: "/admin/books/ledger", permission: "books.view", icon: "\ud83d\udcd2", group: "Admin" }, // ledger book
  { label: "Chart of Accounts", href: "/admin/books/accounts", permission: "books.view", icon: "\ud83d\uddc3\ufe0f", group: "Admin" }, // card file index
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
