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
    | "Accounting"
    | "Lyman"
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
  { label: "Cycle Counts", href: "/admin/inventory/cycle-counts", permission: "inventory.count", icon: "\ud83d\udccb", group: "Inventory" }, // 📋 count clipboard — books-23: the counting FLOOR, staff included, so inventory.count not inventory.manage
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
  { label: "Compliance Calendar", href: "/admin/compliance/calendar", permission: "compliance.calendar", icon: "\ud83d\udcc5", group: "Lyman" }, // 📅 S-18 recurring obligations

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
  { label: "Bank Feeds", href: "/admin/plaid", permission: "finances.view", icon: "\ud83d\udd17", group: "Lyman" }, // 🔗 Plaid: read-only bank/credit feeds for automatic bookkeeping (P2)
  { label: "Loans", href: "/admin/loans", permission: "finances.view", icon: "🏠", group: "Lyman" }, // manual loans + amortization schedule (mortgage, financing) with Timberland audit trail
  { label: "Crypto Portfolio", href: "/admin/crypto", permission: "finances.view", icon: "\u20bf", group: "Lyman" }, // ₿ watch-only crypto portfolio: read-only wallets, USD valuation, IRS cost-basis (C3)
  { label: "ATM", href: "/admin/atm", permission: "finances.view", icon: "\ud83c\udfe7", group: "Lyman" }, // ATM sign: PAI ATM (paireports.com) settlements, surcharge revenue & cash loads
  { label: "Security Log", href: "/admin/audit", permission: "audit.view", icon: "\ud83d\udd0e", group: "Lyman" }, // who did what, and when. Renamed from "Audit Log" (books-22) so it is not confused with Inventory Auditing, and re-gated from users.manage to audit.view = OWNER ONLY: this is the record an admin would have to edit to hide something, so the admin is exactly who should not be reading it.
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
  { label: "Inventory Auditing", href: "/admin/inventory/audits", permission: "inventory.audit", icon: "\ud83d\udd0d", group: "Accounting" }, // 🔍 blind counts, variance review, work papers — NOT /admin/audit, which is the security log
  { label: "Company Information", href: "/admin/books/company", permission: "books.view", icon: "\ud83c\udfe2", group: "Accounting" }, // office building: the one row every form reads - EIN, legal name, signer, state accounts (books-31)
  { label: "General Journal", href: "/admin/books/journal", permission: "books.view", icon: "\u270d\ufe0f", group: "Accounting" }, // writing hand: manual entries
  { label: "Waiting to Post", href: "/admin/books/drafts", permission: "books.view", icon: "\ud83d\udce5", group: "Accounting" }, // inbox tray: every draft the system has written and nobody has posted. books-85 built this to close D-67, where six slices of builders had been filling a queue with no outlet. It sits directly under General Journal because that page ends by saying "everything you save here is a draft" - this is where those drafts go.
  { label: "Conversion", href: "/admin/books/conversion", permission: "books.view", icon: "\ud83d\udd01", group: "Accounting" }, // leaving Cultivera and Sage, 2026-11-01
  { label: "Bills & 280E", href: "/admin/books/bills", permission: "books.view", icon: "\ud83e\uddfe", group: "Accounting" }, // receipt: what survives 280E and what it takes
  { label: "Payroll & COGS", href: "/admin/books/payroll", permission: "books.view", icon: "\ud83d\udc77", group: "Accounting" }, // construction worker: which labor may be inventoried (books-04)
  { label: "Payroll Setup (W-4)", href: "/admin/books/payroll-setup", permission: "books.view", icon: "\ud83e\uddfe", group: "Accounting" }, // W-4 -> withholding, and the mentoring blockers (books-13)
  { label: "Timesheets & Overtime", href: "/admin/books/timesheets", permission: "books.view", icon: "\u23f1\ufe0f", group: "Accounting" }, // stopwatch: punches -> payable hours, overtime per WORKWEEK not per pay period (books-32)
  { label: "Sick Leave Approvals", href: "/admin/books/leave", permission: "books.view", icon: "\ud83e\udd12", group: "Accounting" }, // face with thermometer: requests are approved BEFORE they reach a timesheet - Michael's "option 1" (books-35). Sits next to Timesheets because both feed the same pay run.
  { label: "Garnishments & Support", href: "/admin/books/garnishments", permission: "books.view", icon: "\u2696\ufe0f", group: "Accounting" }, // balance scale: court orders, child support and tax levies. Owner-only because the rows name the employee, the case number and the custodial parent. books-36 built the page that finally reaches the child-support engine Michael asked about.
  { label: "Net Pay Walkthrough", href: "/admin/books/net-pay", permission: "books.view", icon: "\ud83d\udcb5", group: "Accounting" }, // banknote: gross -> required by law -> disposable earnings -> garnishment -> authorised deductions -> the number on the cheque, in that statutory order. Also the page that reports whether the 2027-01-01 first payroll has all its rates on file (books-37).
  { label: "Year-to-Date Totals", href: "/admin/books/ytd", permission: "books.view", icon: "\ud83d\udcca", group: "Accounting" }, // bar chart: active employees only, per Michael. Year-to-date is an INPUT to the next pay run - it is what lets the Social Security wage cap engage - so the key column is room remaining, not wages paid (books-37).
  { label: "Pay Run", href: "/admin/books/pay-run", permission: "books.view", icon: "\ud83d\udcb0", group: "Accounting" }, // money bag: the slice where all the others finally meet. Timesheets give the hours, Payroll Setup gives the W-4, Garnishments give the orders, Year-to-Date says whether Social Security has stopped, and the rate registry says what this pay DATE costs - this page joins the five into one cheque per person and refuses rather than guessing when any of them is missing. Placed AFTER Year-to-Date on purpose: everything above it is an input to it, so the menu reads in the order the work is actually done (books-39).
  { label: "Form 941 (Quarterly)", href: "/admin/books/form-941", permission: "books.view", icon: "\ud83d\udcc6", group: "Accounting" }, // tear-off calendar: the quarterly federal employment tax return. Placed directly AFTER Pay Run because it is pure summation of pay runs that already happened - it adds nothing and decides nothing, it only totals the quarter and shows the arithmetic. Counted by PAY DATE, not period end date, which is the single most common way a 941 goes wrong. This screen prepares figures; it does NOT transmit to the IRS and is not a filing agent (books-40).
  { label: "WA Quarterly Returns", href: "/admin/books/wa-quarterly", permission: "books.view", icon: "\ud83c\udfd4\ufe0f", group: "Accounting" }, // snow-capped mountain: the Washington state counterpart to the 941, placed directly after it because they share a deadline and are worked in the same sitting. FOUR forms, THREE submissions, TWO agencies - and the trap is that two of the three go to ESD through different systems, so "I filed with ESD" is not a statement that means anything. Charged three incompatible ways: unemployment on capped wages and paid entirely by the business, Paid Leave and WA Cares on wages but withheld from staff and held in trust, L&I on HOURS. This screen prepares figures; it does NOT transmit to ESD or L&I and is not a filing agent (books-41).
  { label: "Form 940 (Annual FUTA)", href: "/admin/books/form-940", permission: "books.view", icon: "\ud83e\uddef", group: "Accounting" }, // firecracker: the annual federal unemployment return, placed AFTER the two quarterly screens and BEFORE the W-2 because that is the order the year is actually worked - four quarters happen, then at year end the 940 and the W-2 fall due on the same day. THIS FORM IS ABOUT A CREDIT, NOT A TAX, and that is the whole reason it needs a screen of its own. The headline federal rate is 6.0% on the first $7,000 you pay each person, but almost nobody pays it: paying Washington's state unemployment tax ON TIME earns a 5.4% credit and turns 6.0% into 0.6%. That is a TEN-TO-ONE difference decided entirely by a payment made to ESD rather than by anything sent to the IRS, which is why the form is built in an unusual order - lines 3 to 7 work out the wage base and charge nothing, line 8 charges 0.6% assuming the credit was earned, and lines 9, 10 and 11 then TAKE BACK whatever was not actually earned. Every adjustment only ever ADDS; there is no line that reduces the tax below line 8. So a Form 940 that stops at line 8 is not finished, it is merely optimistic. Two consequences Michael needs: NOT ONE CENT OF FUTA IS WITHHELD FROM AN EMPLOYEE - it never appears on a W-2, no employee ever sees it, and withholding it would be unlawful, so the whose-money bar on this screen is a solid gold bar across the full width and green anywhere on it means a line has been classified wrongly; and because the $7,000 ceiling is per person per year, FUTA is a HEADCOUNT tax far more than a wages tax - roughly $42 a head at 0.6%, barely moving when you give a raise and jumping every time you hire. The screen REFUSES rather than guesses: the experience rate, the state payment dates, the deposits and the quarterly split are all facts only Michael holds, and it names each missing one instead of inventing a default (books-47). This screen prepares figures; it does NOT transmit to the IRS and is not a filing agent.
  { label: "Form W-2 & W-3 (Annual)", href: "/admin/books/form-w2", permission: "books.view", icon: "\ud83d\udcc4", group: "Accounting" }, // page facing up: the annual wage statement, placed directly AFTER the two quarterly screens because that is the order the year is worked - four quarters of 941s happen first and the W-2 can only re-report what they already said. THIS FORM COMPUTES NOTHING. Unlike the 940 and the 941 it is not a tax return: it decides no amount and pays no debt, it only copies figures the year-to-date accumulators fixed months ago. So the engine behind it is a copier with cross-checks rather than a calculator, and it refuses far more often than it computes. The consequence Michael needs is that an error here is almost never an error HERE - it is a mistake made in March arriving in January with a deadline attached, and by then the four 941s are filed and the money is paid, so the repair is Forms W-2c, W-3c and 941-X rather than editing a box. That is why RECONCILIATION IS SECTION 4 and not an appendix: the W-3 totals are compared against the four filed 941s line by line, with the difference column always visible and always signed, because a column that appears only when something is wrong trains the eye to look for its presence instead of reading it. Two traps are Greenway's specifically rather than a generic employer's: the company-paid health premium for a 2%-or-more shareholder-employee is WAGES in box 1 but generally NOT in boxes 3 and 5, which produces a W-2 where box 1 is legitimately LARGER than boxes 3 and 5 and looks exactly like a bug - forcing them to agree either overpays FICA or understates income, and it is the single most common S-corporation W-2 error there is; and BOX 17 MUST BE BLANK, because Washington levies no state income tax and the WA money payroll does withhold (Paid Leave and WA Cares) is not income tax and does not belong there. Both are stated on screen with the instruction quoted beside them. Due 2027-02-01 for tax year 2026 - January 31 falls on a Sunday, and the date is COMPUTED from the holiday calendar rather than typed, so it cannot drift from the authority that sets it. The extension you can get for filing does NOT extend the date you must hand the copies to your staff. This screen prepares figures; it does NOT transmit to the SSA and is not a filing agent (books-46).
  { label: "Sick Leave Balances", href: "/admin/books/sick-leave-balances", permission: "books.view", icon: "\ud83c\udf81", group: "Accounting" }, // wrapped gift: earned hours kept apart from gifted ones, because only the earned column has to carry over. Michael: "I want to keep track of how generous I am being" (books-36). Sits beside Sick Leave Approvals - that one is today's decisions, this one is where everybody stands.
  { label: "Bank & Reconcile", href: "/admin/books/bank", permission: "books.view", icon: "\ud83c\udfe6", group: "Accounting" }, // bank: matching the feed to the books, and the two silent errors (books-05)
  { label: "Trial Balance", href: "/admin/books/trial-balance", permission: "books.view", icon: "\u2696\ufe0f", group: "Accounting" }, // scales: debits = credits
  { label: "Financial Statements", href: "/admin/books/financial-statements", permission: "books.view", icon: "\ud83d\udcc8", group: "Accounting" }, // chart increasing: the four statements, placed directly AFTER Trial Balance because that is the order the work is done - the trial balance is the raw material and the statements are what it becomes, and reading them in the other order teaches the wrong dependency. The engine behind this screen was finished, correct and fully tested for months while being reachable from NOWHERE: zero imports from src/app, 132 passing tests, and not one number Michael could see. That is standing rule 50 in its purest form and it is why this line exists. Only TWO of the four render today - cash flow needs an operating/investing/financing split nothing computes yet, and the equity statement needs Form 2553 + CP261, the prior Schedule M-2 line 8, and Form 7203 per shareholder - so the other two show as BLOCKED in gold with the exact document named, rather than being rendered against invented defaults. A balance sheet built on "assume no accumulated E&P" is not a draft, it is a false statement that ties (books-42).
  { label: "Learning the Books", href: "/admin/books/learn", permission: "books.view", icon: "\ud83c\udf93", group: "Accounting" }, // graduation cap: the 82 lessons, finally reachable. Six mentor modules - 2,345 lines of finished, tested teaching - had ZERO importers from src/app and src/components. Their tests passed every night while Michael could not read one word of them, which is standing rule 50 in its purest form: dead code wearing a green check. Placed directly AFTER Financial Statements because that is the screen that most often raises the question "why is it done that way", and this is where the answer lives. Organised around ONE BUSINESS in the order Greenway's year actually happens - money, dates, hiring, the pay run, checking a quarter, month end, the S-corporation year, and being late - rather than around coverage of a discipline, per Michael: "i don't need to know how to account for any other business... i need to know everything there is to know about accounting for greenway." Nothing on the page is typed prose: the count, the running order, the colours and the position lines are all derived, so if a mentor gains a lesson tomorrow the page counts 83 and names the one nobody placed (books-44).
  { label: "General Ledger", href: "/admin/books/ledger", permission: "books.view", icon: "\ud83d\udcd2", group: "Accounting" }, // ledger book
  { label: "Chart of Accounts", href: "/admin/books/accounts", permission: "books.view", icon: "\ud83d\uddc3\ufe0f", group: "Accounting" }, // card file index
  { label: "Equipment", href: "/admin/equipment", permission: "inventory.manage", icon: "\ud83d\udda8\ufe0f", group: "Admin" }, // 🖨️ hardware
  { label: "Sales Limits", href: "/admin/compliance/sales-limits", permission: "settings.manage", icon: "\u2696\ufe0f", group: "Admin" }, // ⚖️ legal limits
  { label: "AI Usage", href: "/admin/ai-usage", permission: "reports.view", icon: "\ud83e\udde0", group: "Admin" }, // 🧠 AI
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
  // books-22: the two OWNER tabs. "Accounting" is the bookkeeping surface
  // (the nine books screens plus Inventory Auditing, which is where a physical
  // count becomes a journal entry). "Lyman" is the owner's own money and the
  // Security Log. Both are placed AFTER the operating tabs and BEFORE "Admin"
  // so the day-to-day staff tabs stay leftmost where they are reached most.
  //
  // "Lyman" is owner-only in full: all five items are finances.view or
  // audit.view, both of which are ["owner"] alone. For every non-owner the
  // group has zero visible items and buildNavGroups drops the tab entirely --
  // nobody sees a tab that refuses to open.
  //
  // "Accounting" is owner-only EXCEPT for one deliberate item: Inventory
  // Auditing is "inventory.manage" (owner|admin|manager), because the audit
  // TREE is also where staff do the counting -- /admin/inventory/audits/[id]/count
  // is the employee count sheet, and migration 0191 grants staff write on
  // inventory_audit_lines precisely so they can fill it in. Locking the whole
  // tree to the owner would break the count sheet, which is the opposite of
  // the goal. What IS owner-only is everything that matters: the session rows,
  // scope approval, result approval and posting are all is_owner() in the
  // database (0191/0192), so a manager reaching this screen can see and count,
  // and cannot approve or post. nav-gate-core.test.ts records this as an
  // explicit, named exception rather than letting it pass as an oversight.
  "Accounting",
  "Lyman",
  "Admin",
];
