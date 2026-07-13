/**
 * src/lib/admin/concierge-kb.ts
 *
 * E5 (Global AI chatbot). A plain-language knowledge base that grounds the
 * GLOBAL concierge so it can help with the WHOLE product — the back office, the
 * public website, compliance, and the (planned) POS — not just first-time
 * setup. Written for a non-technical owner/employee, in "baby steps".
 *
 * This is the source of truth the concierge is allowed to draw on. Keeping it
 * here (data, not prose in a prompt) means we can grow the assistant's coverage
 * without touching the model wiring, and the answers stay grounded in features
 * that ACTUALLY exist. Each topic maps to a real admin area.
 *
 * IMPORTANT: describe only real, shipped behavior. If a feature is planned but
 * not built (e.g. the POS), say so plainly so the concierge doesn't imply it
 * exists today.
 *
 * MAINTENANCE: the navigation is DATA-DRIVEN in
 * `src/components/admin/admin-nav-data.ts`. If a page moves between tabs, is
 * renamed, or is added/removed, update the matching topic here (especially the
 * `nav` topic and the page's `href`) so the concierge keeps giving accurate
 * "go to X → Y" directions. Every href below is a real admin route.
 */

export type ConciergeTopic = {
  /** Stable id. */
  id: string;
  /** Which part of the product. */
  area: "back-office" | "website" | "compliance" | "pos" | "ai";
  /** Short human title. */
  title: string;
  /** Which top-nav tab this lives under (matches admin-nav-data groups). */
  tab?: string;
  /** Where in the admin this lives (if applicable). */
  href?: string;
  /** Plain-language explanation + how-to, one idea per line. */
  facts: string[];
  /** Whether this describes something not yet built. */
  planned?: boolean;
};

export const CONCIERGE_KB: ConciergeTopic[] = [
  // ── Navigation / orientation ───────────────────────────────────────────
  {
    id: "nav",
    area: "back-office",
    title: "Finding your way around (the top navigation)",
    facts: [
      "The top navigation has these tabs, left to right: the Greenway wordmark (click it to go to the Dashboard home), then Dashboard, Reports, CRM, Product Intake, Inventory, Website, MKTG & ADV, Employee, Medical, CCRS, and Admin.",
      "Most tabs are dropdown menus — hover (or tap) a tab to open its menu, then pick a page.",
      "Reports and CCRS are single-click buttons, not dropdowns: Reports opens the reports hub; CCRS opens Compliance Health.",
      "There's a Quick Search circle (bottom-left) — press ⌘K (Mac) or Ctrl+K (Windows) to jump to any page fast.",
      "The '?' button (bottom-left) opens contextual help for the page you're on; the full Help & FAQ lives under Admin → Help & FAQ.",
      "The floating chat bubble (bottom-right) is me, the concierge — ask me anything about the product.",
    ],
  },
  {
    id: "tab-map",
    area: "back-office",
    title: "What's in each tab (menu contents)",
    facts: [
      "Dashboard: Online Orders, Loyalty signups.",
      "Reports: opens the reporting hub (sales, tax, excise, COGS, customers, employees, loyalty, medical, compliance, forecast, accounting export).",
      "CRM: Customers, Loyalty Program.",
      "Product Intake: Product Discovery, CCRS Benchmarks, Catalog Hub, Purchasing, Receiving, Product Onboarding, Product Enrichment, Product Mastering, Accounts Payable, Knowledge Base.",
      "Inventory: Inventory, Other Inventory, Vendors & Brands, Types & Categories, Cycle Counts, Returns & Destruction.",
      "Website: Media Library, Site Content, Home, Menu, Loyalty, Specials, Vendors, FAQ, About, Locations, Price Match.",
      "MKTG & ADV: Marketing & Advertising, Promotions, Blog & Newsletter, Email Newsletter, Creative Studio.",
      "Employee: Time Clock, Payroll, Samples, Register Activity.",
      "Medical: Patient Records, Authorization Intake.",
      "CCRS: opens Compliance Health.",
      "Admin: Users, Integrations, Equipment, Sales Limits, AI Usage, Audit Log, Settings, Help & FAQ, Menu Imports.",
    ],
  },
  {
    id: "dashboard",
    area: "back-office",
    title: "Dashboard",
    tab: "Dashboard",
    href: "/admin",
    facts: [
      "The Dashboard is the home page — click the Greenway wordmark (top-left) to reach it.",
      "Until the store is fully set up, the Dashboard shows a setup-progress banner that links straight to the next incomplete step (database, migrations, menu import, publish, email, team). It reads real data, so the progress is trustworthy.",
      "Printable one-page SOPs (truck day + every intake stage) live at Dashboard → Printable SOPs (/admin/sop).",
    ],
  },

  // ── Reports & analytics ────────────────────────────────────────────────
  {
    id: "reports",
    area: "back-office",
    title: "Reports & analytics",
    tab: "Reports",
    href: "/admin/reports",
    facts: [
      "The Reports tab is a single button that opens the reporting hub.",
      "Available reports include: Sales, Tax, Excise, COGS (cost of goods), Customers, Employees, Loyalty, Medical, Compliance, and a Forecast.",
      "The Accounting export builds a balanced Sage 50 general journal (one entry per business day) — see Reports → Accounting, and map your GL accounts in Settings → Accounting settings.",
    ],
  },

  // ── CRM ────────────────────────────────────────────────────────────────
  {
    id: "customers",
    area: "back-office",
    title: "Customers (CRM)",
    tab: "CRM",
    href: "/admin/customers",
    facts: [
      "CRM → Customers is where you build customer and patient profiles — the foundation for loyalty, purchase history, and (later) purchase-limit enforcement at the register.",
      "You can add a customer manually, or import a list under Customers → Import.",
      "New public loyalty signups arrive in Dashboard → Loyalty signups; marking one as entered automatically creates (or links) its customer record here and enrolls it in the loyalty program.",
    ],
  },
  {
    id: "loyalty-program",
    area: "back-office",
    title: "Loyalty program",
    tab: "CRM",
    href: "/admin/loyalty",
    facts: [
      "CRM → Loyalty Program manages points, tiers, promotions, and redemptions.",
      "The public-facing Loyalty page (what customers see) is edited under Website → Loyalty.",
      "People who sign up on the website land in Dashboard → Loyalty signups for you to review and approve.",
    ],
  },

  // ── Product Intake (procure → receive → onboard → enrich → master → pay)─
  {
    id: "product-intake",
    area: "back-office",
    title: "Product Intake — the whole product lifecycle",
    tab: "Product Intake",
    href: "/admin/catalog",
    facts: [
      "Product Intake groups the end-to-end product journey in lifecycle order so you move top-to-bottom: Discovery → Purchasing → Receiving → Onboarding → Enrichment → Mastering → Accounts Payable.",
      "Catalog Hub (the Product Intake Hub) is the one-stop dashboard tying those steps together.",
      "Product Discovery helps you find products and vendors worth pursuing; CCRS Benchmarks shows statewide pricing/velocity so you buy smart.",
      "Purchasing builds AI-assisted purchase orders (reorder suggestions, send to vendors, receive against POs). Set reorder points via Settings → Reorder points.",
      "Receiving records inbound vendor transfers with the WA transport-manifest details (WAC 314-55-085): driver, vehicle, plate, departed/arrived times.",
      "Product Onboarding reviews and approves brand-new products onto the menu.",
      "Product Enrichment adds descriptions, images, tags, and AI-assisted copy to products.",
      "Product Mastering groups items that are the same product at different sizes (e.g. 1g / 3.5g / 7g).",
      "Accounts Payable (vendor bills) lets you enter what you owe each vendor and generate a NACHA ACH file for your bank.",
    ],
  },
  {
    id: "knowledge-base",
    area: "back-office",
    title: "Product knowledge base & starter data",
    tab: "Product Intake",
    href: "/admin/knowledge-base",
    facts: [
      "The Knowledge Base is the single source of truth the AI writes from — your data command center for strains, terpenes, brands, and category vocabulary.",
      "Load a curated baseline anytime via Knowledge Base → Setup (also linked from Settings → Starter data) so the catalog and AI start with good data.",
      "Strain types include Indica, Sativa, Hybrid, plus the customer-friendly 'indica-leaning hybrid' and 'sativa-leaning hybrid'.",
      "The leaning labels show on the website and in the US, but they always map to Hybrid when you export to CCRS.",
    ],
  },

  // ── Inventory ──────────────────────────────────────────────────────────
  {
    id: "inventory",
    area: "back-office",
    title: "Inventory (lots, COAs & traceability)",
    tab: "Inventory",
    href: "/admin/inventory",
    facts: [
      "Inventory tracks cannabis lots with their COAs (certificates of analysis) and full traceability.",
      "Other Inventory (Inventory → Other Inventory) tracks non-cannabis goods — glass, accessories, papers, devices — professionally, but these are NOT CCRS-reported.",
      "Vendors & Brands manages vendor profiles (logo, mission, contact) and their brands; save a vendor's WA license number so it auto-fills on Receiving manifests, and you can publish vendor profiles to the public Vendors page.",
      "Types & Categories renames/reorders the website categories and catalogs the POS inventory types behind them (also reachable from Settings).",
      "Cycle Counts are periodic blind physical counts; variances post as audited 'count' adjustments.",
      "Returns & Destruction handles vendor returns and compliant destruction with a quarantine hold, plus sample-pricing rules.",
    ],
  },

  // ── Website ────────────────────────────────────────────────────────────
  {
    id: "website-pages",
    area: "website",
    title: "Editing the public website",
    tab: "Website",
    href: "/admin/pages/home",
    facts: [
      "Each public page has its own editor under the Website tab: Home, Menu, Loyalty, Specials, Vendors, FAQ, About, Locations, and Price Match.",
      "Media Library (Website → Media Library) is where you upload and manage logos, banners, and images.",
      "Site Content (Website → Site Content) edits approved text blocks safely — no code, no page builder.",
      "Preview mode shows unpublished edits with a glowing badge in the bottom-right; click it to exit preview. Nothing is public until you publish.",
    ],
  },

  // ── MKTG & ADV ─────────────────────────────────────────────────────────
  {
    id: "marketing",
    area: "back-office",
    title: "Marketing & Advertising",
    tab: "MKTG & ADV",
    href: "/admin/marketing",
    facts: [
      "Marketing & Advertising has an AI strategist: type a goal (e.g. 'grow our newsletter list') and get a Washington-compliant strategy DRAFT grounded in your real store and vendors.",
      "Every plan is scanned against WA advertising rules before it appears; plans with health/medical or minor-appealing angles are withheld.",
      "Save good plans to your idea notebook and triage them (idea → planned → done).",
    ],
  },
  {
    id: "promotions",
    area: "back-office",
    title: "Promotions & specials",
    tab: "MKTG & ADV",
    href: "/admin/promotions",
    facts: [
      "Promotions runs daily deals, the Thursday brand selector, and clearance — all with a preview-before-publish gate so nothing goes live by accident.",
      "The public-facing deals appear on the website's Specials page (edit that under Website → Specials).",
    ],
  },
  {
    id: "blog-newsletter",
    area: "back-office",
    title: "Blog & newsletters",
    tab: "MKTG & ADV",
    href: "/admin/blog",
    facts: [
      "Blog & Newsletter is where you write posts and newsletters with drafts, scheduling, SEO help, and AI assist.",
      "Once a newsletter is published, send it to your loyalty list from MKTG & ADV → Email Newsletter (the Newsletter Send Center).",
      "The Send Center shows engagement stats (opens/clicks) for the last 90 days, with a link to the full customer newsletter report.",
    ],
  },
  {
    id: "image-generator",
    area: "back-office",
    title: "Creative Studio (AI image generation)",
    tab: "MKTG & ADV",
    href: "/admin/marketing/midjourney",
    facts: [
      "The Creative Studio generates images with FLUX at the exact pixel size for a chosen destination — website banners, social posts, email headers, blog heroes, or print/in-store pieces.",
      "Greenway AI drafts the image brief from a one-line idea, grounded in the store profile and LIVE weekly deals; the same brief also builds a copy-paste Midjourney prompt.",
      "Generated images are DRAFTS — review before using them on the website or in marketing.",
    ],
  },

  // ── Employee ───────────────────────────────────────────────────────────
  {
    id: "time-clock",
    area: "back-office",
    title: "Time Clock & staffing",
    tab: "Employee",
    href: "/admin/staffing",
    facts: [
      "Employee → Time Clock lets staff clock in and out and tracks shifts.",
      "Related staffing tools cover employees, a schedule builder, and hour adjustments.",
    ],
  },
  {
    id: "payroll",
    area: "back-office",
    title: "Payroll (direct deposit)",
    tab: "Employee",
    href: "/admin/payroll",
    facts: [
      "Employee → Payroll is manual-entry payroll that produces an ACH direct-deposit file.",
      "Enter each employee's pay totals (net/gross/taxes) and banking once; the system builds a NACHA file to upload to your bank.",
      "Amounts are handled in cents. The originating bank/company block is configured once and shared with Accounts Payable/vendor payments.",
    ],
  },
  {
    id: "samples",
    area: "back-office",
    title: "Employee samples",
    tab: "Employee",
    href: "/admin/compliance/samples",
    facts: [
      "Employee → Samples is where you assign trade samples to paid employees: pick the sample from the table, choose the employee, and the system records it and marks it out of inventory the CCRS-required way.",
      "Limits are enforced automatically: 30 units per employee per quarter (hard-blocked); the 120 units per processor per quarter intake cap is enforced at Receiving, where samples arrive.",
    ],
  },
  {
    id: "registers",
    area: "back-office",
    title: "Register Activity",
    tab: "Employee",
    href: "/admin/registers",
    facts: [
      "Employee → Register Activity gives live oversight of shifts, registers, and store activity (drawer counts, cash, open/close).",
      "It's the management view of what's happening on the floor.",
    ],
  },

  // ── Medical ────────────────────────────────────────────────────────────
  {
    id: "medical",
    area: "back-office",
    title: "Medical cannabis (patient records & DOH)",
    tab: "Medical",
    href: "/admin/medical",
    facts: [
      "Medical → Patient Records manages medical recognition cards and DOH compliance.",
      "Medical → Authorization Intake is where you take in a new medical authorization.",
      "Medical purchases follow separate DOH rules and higher limits than recreational — keep patient records accurate.",
    ],
  },

  // ── Compliance (always applies) ────────────────────────────────────────
  {
    id: "compliance-health",
    area: "compliance",
    title: "Compliance Health (the CCRS tab)",
    tab: "CCRS",
    href: "/admin/compliance/health",
    facts: [
      "The CCRS tab is a single button that opens Compliance Health — a one-glance 'am I safe?' view.",
      "It checks every compliance gate live: CCRS batch readiness, sales limits, transport manifests, and more.",
      "Use it before submitting a CCRS batch to make sure nothing is blocking you.",
    ],
  },
  {
    id: "ccrs",
    area: "compliance",
    title: "CCRS reporting",
    tab: "CCRS",
    href: "/admin/compliance/health",
    facts: [
      "CCRS has no live API — reporting is a CSV a human uploads to the state's SAW/CCRS portal.",
      "Cadence: a weekly batch (Sunday–Saturday, due the following Sunday) plus the monthly LIQ-1295.",
      "Before uploading, the system runs a DO-NOT-UPLOAD check that blocks a batch with errors, so you never submit a bad file.",
      "CCRS strain types are only Indica, Sativa, or Hybrid — friendly 'leaning' labels collapse to Hybrid on export.",
    ],
  },
  {
    id: "sales-limits",
    area: "compliance",
    title: "Sales limits",
    tab: "Admin",
    href: "/admin/compliance/sales-limits",
    facts: [
      "Admin → Sales Limits (also linked from Settings) sets WA single-transaction purchase limits (WAC 314-55-095) that are enforced at checkout.",
      "These protect you from accidentally selling over the legal per-transaction amount.",
    ],
  },
  {
    id: "compliance-general",
    area: "compliance",
    title: "Washington advertising & DOH rules",
    facts: [
      "No health, medical, therapeutic, or curative claims anywhere (menu, marketing, signage).",
      "Nothing that appeals to minors; no associations with alcohol or tobacco; adults 21+ only.",
      "The AI copy and strategy tools enforce these automatically and refuse prohibited output.",
    ],
  },

  // ── Admin (settings, users, hardware, integrations) ────────────────────
  {
    id: "settings",
    area: "back-office",
    title: "Settings (the configuration hub)",
    tab: "Admin",
    href: "/admin/settings",
    facts: [
      "Admin → Settings is the one place that links to everything you can configure, grouped into cards.",
      "Store: Store profile (name, contact, address, hours), Tax settings (excise + sales rates, which categories are cannabis), Pricing settings (minimum markup floor + rounding).",
      "Catalog & inventory: Types & categories, Reorder points, and Starter data (load baseline strains/terpenes/categories).",
      "Compliance: Sales limits and Compliance health.",
      "Money & accounting: Accounting settings (GL mapping + Sage 50 export) and AI usage & cost.",
      "Equipment & integrations: Equipment (hardware hub), Receipt printer, and Integrations (Leafly/WeedMaps).",
      "Team & security: Users & roles, Activity log, and Security & passkeys (Face ID / Touch ID sign-in).",
      "Data & lifecycle: Reset operational data — clears test sales/inventory/imports/customers before going live, while keeping your settings and knowledge base.",
    ],
  },
  {
    id: "users",
    area: "back-office",
    title: "Users & roles",
    tab: "Admin",
    href: "/admin/users",
    facts: [
      "Admin → Users invites employees by email and controls their role: Owner/Manager (most things), Content/Editor (content only), or Read-only (view).",
      "The last owner is protected from lockout. Start least-privilege and expand as needed.",
      "New teammates get an email invite to set a password and sign in — this needs email (Resend) configured.",
    ],
  },
  {
    id: "integrations",
    area: "back-office",
    title: "Integrations",
    tab: "Admin",
    href: "/admin/integrations",
    facts: [
      "Admin → Integrations handles menu syndication (Leafly, WeedMaps), accounting export, and external service status.",
      "Enter your Leafly/WeedMaps API credentials, then push your menu. Menu pushes are draft/preview-safe until you explicitly confirm.",
      "There's an integrations helper (a chat) that walks you through connecting each service step by step.",
    ],
  },
  {
    id: "equipment",
    area: "back-office",
    title: "Equipment (store hardware)",
    tab: "Admin",
    href: "/admin/equipment",
    facts: [
      "Admin → Equipment is one home for every piece of store hardware — integrated devices, POS terminals, scales, safes, and cameras.",
      "Integrated devices (receipt printer, label printer, scanner, laminator) show a live online/offline badge.",
      "The Receipt Printer lives as a tab on this page (Equipment → Receipt Printer): setup guide, live diagnostics, connection details, token rotation, a test print, an AI diagnostic assistant, and the recent print-jobs list.",
    ],
  },
  {
    id: "audit",
    area: "back-office",
    title: "Activity log (audit)",
    tab: "Admin",
    href: "/admin/audit",
    facts: [
      "Admin → Audit Log is a plain-language history of every change made across the back office, with a security review.",
      "Use it to answer 'who changed what, and when'.",
    ],
  },
  {
    id: "menu-imports",
    area: "back-office",
    title: "Menu imports (POS export → staged menu)",
    tab: "Admin",
    href: "/admin/menu-imports",
    facts: [
      "Admin → Menu Imports is where you upload your POS PRODUCTS and INVENTORIES exports; the system stages them into a draft menu version for review.",
      "Nothing goes public until you Publish. You can roll back to a previous published version.",
      "Re-upload anytime your POS changes — each upload is a new staged version.",
    ],
  },

  // ── POS (PLANNED — not built yet) ──────────────────────────────────────
  {
    id: "pos",
    area: "pos",
    planned: true,
    title: "Point of Sale (planned)",
    facts: [
      "The in-store POS is PLANNED, not built yet — we're finishing back-office enhancements first, then discussing the POS approach.",
      "The current recommendation is a Capacitor iPad app that reuses the same compliance logic as the web back office, works offline, and drives the hardware.",
      "Planned hardware: Star TSP143IIIBi receipt printer, Socket DuraScan D760 scanner, iPad Pro 12.9\", and a cash drawer that opens from the printer on sale completion.",
      "Payments are cash-only today; a generic, provider-agnostic card pipeline is planned for when cannabis card payments are allowed.",
    ],
  },

  // ── AI itself ──────────────────────────────────────────────────────────
  {
    id: "ai",
    area: "ai",
    title: "How the AI helpers work",
    facts: [
      "AI features are drafts-only and grounded in your real data — they never invent facts and always pass a compliance scan.",
      "You'll find AI assistants in Marketing (strategy), Creative Studio, Blog & Newsletter, Purchasing, Reports → COGS, Integrations, the Receipt Printer diagnostics, and this global concierge (the chat bubble, bottom-right).",
      "If an AI feature is greyed out, an AI key (AI_API_KEY or OPENAI_API_KEY) isn't set in the environment.",
      "You can see AI usage and cost under Admin → AI Usage (also linked from Settings → AI usage & cost).",
    ],
  },
];

/** Render the KB as a grounding block for the model. */
export function conciergeGroundingBlock(): string {
  const lines: string[] = ["BACK-OFFICE KNOWLEDGE BASE (the source of truth):"];
  for (const t of CONCIERGE_KB) {
    lines.push(`\n## ${t.title}${t.planned ? " (PLANNED — not built yet)" : ""}`);
    const loc = [
      t.tab ? `Tab: ${t.tab}` : null,
      t.href ? `Page: ${t.href}` : null,
      `Area: ${t.area}`,
    ]
      .filter(Boolean)
      .join(" · ");
    lines.push(loc);
    for (const f of t.facts) lines.push(`- ${f}`);
  }
  return lines.join("\n");
}
