/**
 * Help content — plain-language FAQ for the ENTIRE Greenway system, grouped by
 * section and category. Single source of truth for both the /admin/help page
 * and the global "?" launcher.
 *
 * Written for non-technical staff: short, friendly, action-oriented. Every
 * answer is grounded in a real, shipped feature (the admin route tree + sidebar
 * navigation). "Go there →" links point at the actual page that does the job.
 *
 * Categories mirror how the back office is organized so the Help page reads like
 * a guided tour of everything: the public website, online ordering, the
 * point-of-sale side, equipment, compliance, accounting, integrations — the
 * whole operation, end to end.
 */
export type HelpItem = {
  q: string;
  a: string;
  /** Where to go to do this, if applicable. */
  href?: string;
};

export type HelpCategory =
  | "Start here"
  | "Website & online ordering"
  | "Point of sale"
  | "Catalog & inventory"
  | "Compliance"
  | "Money & accounting"
  | "Marketing & content"
  | "Equipment & integrations"
  | "Insights"
  | "Team & administration";

export type HelpSection = {
  id: string;
  title: string;
  icon: string;
  category: HelpCategory;
  intro: string;
  items: HelpItem[];
};

/** Category display order + a short blurb for each. */
export const HELP_CATEGORIES: { name: HelpCategory; blurb: string }[] = [
  { name: "Start here", blurb: "The big picture and the order to do things in." },
  {
    name: "Website & online ordering",
    blurb: "Your public greenwaycannabis site and the orders customers place on it.",
  },
  {
    name: "Point of sale",
    blurb: "The in-store side: registers, cash drawers, receipts, and time clock.",
  },
  {
    name: "Catalog & inventory",
    blurb: "Products, brands, lots, counts, intake, purchasing, and returns.",
  },
  {
    name: "Compliance",
    blurb: "WA state rules: sales limits, CCRS, medical, and lawful destruction.",
  },
  {
    name: "Money & accounting",
    blurb: "Sales, tax, COGS, the excise return, and the Sage 50 export.",
  },
  {
    name: "Marketing & content",
    blurb: "Promotions, blog, newsletter, media, and the words on your pages.",
  },
  {
    name: "Equipment & integrations",
    blurb: "Your receipt printer, hardware assets, and Leafly / WeedMaps.",
  },
  { name: "Insights", blurb: "Reports, forecasting, and AI usage." },
  {
    name: "Team & administration",
    blurb: "Users and roles, settings, and the audit log.",
  },
];

export const HELP_SECTIONS: HelpSection[] = [
  // ── Start here ───────────────────────────────────────────────────────────
  {
    id: "getting-started",
    title: "Getting started",
    icon: "🚀",
    category: "Start here",
    intro: "What this system does and the order to do things in.",
    items: [
      {
        q: "What is this back office?",
        a: "It's the single control panel for everything Greenway: your public website, the products and prices customers see, online orders, your in-store point-of-sale tools, compliance filings, accounting exports, and reports — all without touching any code.",
      },
      {
        q: "Where should I start?",
        a: "Open Getting Started. It shows a checklist with the single next step to take. In general: upload your POS menu, publish it, then enrich products, set up promotions, and connect your equipment.",
        href: "/admin/getting-started",
      },
      {
        q: "What's the difference between the Dashboard and Getting Started?",
        a: "Getting Started is the setup checklist for a new store. The Dashboard is your day-to-day cockpit — the live overview of sales and store activity you check during a shift.",
        href: "/admin",
      },
      {
        q: "Will my changes go live immediately?",
        a: "No — anything that affects your public site is saved as a draft first. You review it, then click Publish when you're ready. Nothing surprises your customers.",
      },
      {
        q: "Does the AI post or send things automatically?",
        a: "Never. AI only writes drafts and flags things for your attention to save you work. You always review, edit, and approve before anything is published, sent, or filed.",
      },
      {
        q: "I'm stuck on a page — where's help?",
        a: "Every page has a \"?\" button in the bottom-left corner that opens quick answers, and most pages have a blue Help panel near the top explaining that page. This full Help & FAQ is always in the sidebar.",
        href: "/admin/help",
      },
    ],
  },

  // ── Website & online ordering ────────────────────────────────────────────
  {
    id: "website",
    title: "Your public website",
    icon: "🌐",
    category: "Website & online ordering",
    intro: "The greenwaycannabis site your customers browse.",
    items: [
      {
        q: "How does my website get its products?",
        a: "From the menu you upload out of your POS. Once you publish an upload, those products, prices, and stock levels appear on the public menu automatically. Photos and descriptions you add here make each product look great.",
        href: "/admin/menu-imports",
      },
      {
        q: "How do I change the words on my homepage or other pages?",
        a: "Use Site Content, or open the specific page builder (Home, Menu, Loyalty, Specials, Vendors, FAQ, About, Locations, Price Match) in the Pages section. You edit blocks like the hero headline or business hours and preview before it goes live.",
        href: "/admin/content",
      },
      {
        q: "How do I change the big rotating banners on the homepage?",
        a: "Use the Home page builder or the Carousel editor. You can add, reorder, schedule, and preview banner slides before publishing.",
        href: "/admin/content/carousel",
      },
      {
        q: "What is SEO and where do I set it?",
        a: "SEO is how your site shows up in Google. The SEO tools let you set page titles and descriptions so your store is found more easily. Sensible defaults are already in place.",
        href: "/admin/content/seo",
      },
      {
        q: "How do I edit the public FAQ that customers see?",
        a: "That's the FAQ page builder in the Pages section — it controls the questions shown to shoppers on your site. (This Help & FAQ you're reading now is the internal staff guide.)",
        href: "/admin/pages/faq",
      },
    ],
  },
  {
    id: "online-orders",
    title: "Online orders",
    icon: "🧾",
    category: "Website & online ordering",
    intro: "Handling orders customers place through your site.",
    items: [
      {
        q: "Where do online orders show up?",
        a: "In Orders. Each order shows its status, the items, and a printable ticket. Update the status as you prepare and complete it so the customer and your team stay in sync.",
        href: "/admin/orders",
      },
      {
        q: "How do I print an order ticket?",
        a: "Open the order and use its ticket view to print. If your receipt printer is connected, new online orders can also print automatically.",
        href: "/admin/orders",
      },
      {
        q: "A customer wants to sign up for rewards online — where does that go?",
        a: "Loyalty sign-ups collected on the site appear under Loyalty. You review and manage them there; the rewards rules live under Loyalty Program.",
        href: "/admin/loyalty-signups",
      },
    ],
  },

  // ── Point of sale ──────────────────────────────────────────────────────────
  {
    id: "registers",
    title: "Registers & cash drawers",
    icon: "💵",
    category: "Point of sale",
    intro: "Opening, counting, and closing the drawer for each shift.",
    items: [
      {
        q: "How do I open a register for a shift?",
        a: "Go to Registers & Drawers, pick the register, and open it with a starting cash count. That count is what the closing count is measured against.",
        href: "/admin/registers",
      },
      {
        q: "How do I close out and count the drawer?",
        a: "At the end of a shift, close the drawer and enter the counted cash. The system compares it to what should be there and records any over/short. Pay-ins and pay-outs are logged too.",
        href: "/admin/registers",
      },
      {
        q: "Can I see past drawer sessions?",
        a: "Yes — Registers history shows every opened/closed session with its counts and any discrepancies, so nothing is a mystery later.",
        href: "/admin/registers/history",
      },
    ],
  },
  {
    id: "receipts-pos",
    title: "Receipts & printing",
    icon: "🖨️",
    category: "Point of sale",
    intro: "The receipt printer that prints tickets and receipts.",
    items: [
      {
        q: "How do I set up the receipt printer?",
        a: "Open Receipt Printer. There's a full plain-language setup guide (plug it in, point it at our Poll URL, confirm it's online) plus live diagnostics and an assistant that troubleshoots problems for you.",
        href: "/admin/settings/receipt-printer",
      },
      {
        q: "My receipts aren't printing — what do I check?",
        a: "Open Receipt Printer and read the live diagnostics panel; it tells you exactly what's wrong (offline, wrong Poll URL, out of paper, queued jobs). The built-in assistant walks you through the fix step by step.",
        href: "/admin/settings/receipt-printer",
      },
    ],
  },
  {
    id: "timeclock",
    title: "Time clock & staffing",
    icon: "⏱",
    category: "Point of sale",
    intro: "Clocking in and out and managing the schedule.",
    items: [
      {
        q: "How do employees clock in and out?",
        a: "Through Time Clock. It records shifts and breaks so you have accurate hours for payroll and coverage.",
        href: "/admin/staffing",
      },
      {
        q: "Where do I manage the employee list?",
        a: "Under the Employees area of staffing. You add employees, set their details, and review their time.",
        href: "/admin/staffing/employees",
      },
    ],
  },

  // ── Catalog & inventory ─────────────────────────────────────────────────────
  {
    id: "menu-imports",
    title: "Menu uploads",
    icon: "⬆️",
    category: "Catalog & inventory",
    intro: "Bringing your live inventory in from your point-of-sale system.",
    items: [
      {
        q: "How do I upload my menu?",
        a: "Export the PRODUCTS and INVENTORIES files from your POS as spreadsheets, then upload both here. We stage them so you can review before anything changes on the site.",
        href: "/admin/menu-imports",
      },
      {
        q: "The upload said something didn't load — what do I do?",
        a: "Make sure you're uploading the original .xlsx or .csv files straight from your POS (don't rename a .csv to .xlsx). If a file is empty or the wrong export, re-export and try again. The page tells you exactly what it found.",
        href: "/admin/menu-imports",
      },
      {
        q: "How do I make an uploaded menu actually show on the site?",
        a: "After uploading, open the staged version, review the changes, and click Publish. Products and prices then appear on your public menu.",
        href: "/admin/menu-imports",
      },
    ],
  },
  {
    id: "products",
    title: "Products",
    icon: "📦",
    category: "Catalog & inventory",
    intro: "Photos, descriptions, and details that make products shine online.",
    items: [
      {
        q: "Why are some products missing photos or descriptions?",
        a: "Your POS only gives us names and prices. You (or the AI helper) add photos, descriptions, and tags here so each product looks great on the site.",
        href: "/admin/products",
      },
      {
        q: "Can AI write product descriptions for me?",
        a: "Yes. Use the AI helper on a product to draft a description, tags, or alt-text. Review and edit it, then save. It's always a draft until you approve it.",
        href: "/admin/products",
      },
      {
        q: "Can I enrich lots of products at once?",
        a: "Yes — Bulk AI drafts descriptions and details across many products in one pass, and you approve them together. Still drafts-first, always.",
        href: "/admin/products/bulk-ai",
      },
      {
        q: "What is Product Mastering?",
        a: "It groups the many batch-level items from your POS into one clean 'master' product (one Blue Dream, not twenty batches) so your menu is tidy and photos/descriptions attach in one place.",
        href: "/admin/products/masters",
      },
    ],
  },
  {
    id: "vendors",
    title: "Vendors & brands",
    icon: "🏷",
    category: "Catalog & inventory",
    intro: "The producers and brands behind your products.",
    items: [
      {
        q: "Where do I manage vendors and brands?",
        a: "In Vendors & Brands. You can edit brand names, logos, and details that appear on product pages and the Vendors page.",
        href: "/admin/vendors",
      },
    ],
  },
  {
    id: "inventory",
    title: "Inventory & lots",
    icon: "🧾",
    category: "Catalog & inventory",
    intro: "The actual stock on hand, tracked by lot.",
    items: [
      {
        q: "Where do I see current stock?",
        a: "Inventory lists what's on hand by lot with quantities and status. This is the source your public stock levels and compliance reports draw from.",
        href: "/admin/inventory",
      },
      {
        q: "What is Vendor Intake?",
        a: "It's how you receive incoming transfers from suppliers. Upload the vendor's transfer manifest and review it before accepting it into inventory.",
        href: "/admin/inventory/intake",
      },
      {
        q: "What are Product Drafts?",
        a: "New items that came in but need a little setup (category, details) before they're menu-ready. You finish them here and they flow into your catalog.",
        href: "/admin/inventory/drafts",
      },
      {
        q: "How do I do a cycle count?",
        a: "Cycle Counts lets you count a section of inventory, compare it to the system, and record adjustments — with a clear trail for compliance.",
        href: "/admin/inventory/cycle-counts",
      },
      {
        q: "How do I record a return or destroy product lawfully?",
        a: "Returns & Destruction handles customer returns, samples, and lawful destruction with the documentation WA compliance requires.",
        href: "/admin/inventory/disposition",
      },
    ],
  },
  {
    id: "purchasing",
    title: "Purchasing",
    icon: "🛒",
    category: "Catalog & inventory",
    intro: "Purchase orders to your suppliers.",
    items: [
      {
        q: "How do I create a purchase order?",
        a: "Go to Purchasing and start a new PO. Add the vendor and items, then track it from ordered to received. Received POs line up with Vendor Intake.",
        href: "/admin/purchasing/new",
      },
    ],
  },
  {
    id: "types",
    title: "Types & categories",
    icon: "🏷",
    category: "Catalog & inventory",
    intro: "How product types map to the categories shoppers browse.",
    items: [
      {
        q: "What are Types & Categories?",
        a: "It's the map from your POS inventory types (like 'Live Resin' or 'Gummies') to the website categories customers filter by. The common types come pre-loaded; you can adjust how any type is shown.",
        href: "/admin/settings/types",
      },
    ],
  },

  // ── Compliance ──────────────────────────────────────────────────────────────
  {
    id: "sales-limits",
    title: "Sales limits",
    icon: "⚖",
    category: "Compliance",
    intro: "Washington single-transaction purchase limits.",
    items: [
      {
        q: "What are sales limits?",
        a: "Washington caps how much a customer can buy in one transaction (by product type, and higher for medical). This page shows the exact limits everyone should know and enforces them.",
        href: "/admin/compliance/sales-limits",
      },
      {
        q: "Who can change the limits?",
        a: "Only the store owner can change the enforced limits. Everyone else sees a clear, read-only reference sheet of the current rules so budtenders always know the numbers.",
        href: "/admin/compliance/sales-limits",
      },
    ],
  },
  {
    id: "ccrs",
    title: "CCRS reporting",
    icon: "🗂",
    category: "Compliance",
    intro: "The state traceability files (Sale, Inventory, adjustments, etc.).",
    items: [
      {
        q: "How do I file my CCRS reports?",
        a: "Open Reports → Compliance. It builds the full set of CCRS files from your real data, runs a pre-upload data-integrity check, and gives you a ready-to-upload .zip with step-by-step upload instructions.",
        href: "/admin/reports/compliance",
      },
      {
        q: "It flagged data problems before upload — what now?",
        a: "The check lists exactly what to fix (for example a lot missing its ID). Fix the flagged items, then rebuild the batch. Blocking errors must be cleared; warnings are advisory.",
        href: "/admin/reports/compliance",
      },
    ],
  },
  {
    id: "medical",
    title: "Medical",
    icon: "⚕",
    category: "Compliance",
    intro: "Medical patient cards and endorsement tracking.",
    items: [
      {
        q: "Where do I manage medical patient cards?",
        a: "In Medical. You track patient authorization cards, their status, and expiry so medical sales and tax exemptions stay valid.",
        href: "/admin/medical",
      },
      {
        q: "Where do medical numbers show up in reports?",
        a: "Reports → Medical breaks down endorsement status, card expiry outlook, exempt sales, and the sales/excise tax exempted, with exports.",
        href: "/admin/reports/medical",
      },
    ],
  },

  // ── Money & accounting ───────────────────────────────────────────────────────
  {
    id: "sales-tax-reports",
    title: "Sales & tax reports",
    icon: "📈",
    category: "Money & accounting",
    intro: "How the store is doing and what you owe in tax.",
    items: [
      {
        q: "Where do I see sales?",
        a: "Reports → Sales shows revenue with breakdowns by product type and category, over the date range you choose, with CSV/Excel export.",
        href: "/admin/reports/sales",
      },
      {
        q: "Where's my sales tax?",
        a: "Reports → Tax separates taxable non-cannabis sales and breaks tax down by type and category so filing is straightforward.",
        href: "/admin/reports/tax",
      },
      {
        q: "How do I see profit / cost of goods sold?",
        a: "Reports → COGS shows cost of goods sold and inventory valuation/aging by type, with an assistant that explains any missing-cost gaps.",
        href: "/admin/reports/cogs",
      },
    ],
  },
  {
    id: "excise",
    title: "Excise return (LIQ-1295)",
    icon: "🧾",
    category: "Money & accounting",
    intro: "Your monthly cannabis excise tax return and payment.",
    items: [
      {
        q: "How do I file the excise return?",
        a: "Reports → Excise builds the LIQ-1295 from your sales. You can edit every field, save a draft, then export the official spreadsheet. It also walks you through paying (pre-filled PayStation link or CCRS ACH checklist).",
        href: "/admin/reports/excise",
      },
      {
        q: "It shows review issues before filing — what do they mean?",
        a: "Each issue is clickable and jumps you to the exact field to fix (license, email, a box amount). Clear them and your return is ready to file and pay.",
        href: "/admin/reports/excise",
      },
    ],
  },
  {
    id: "accounting",
    title: "Accounting (Sage 50)",
    icon: "📒",
    category: "Money & accounting",
    intro: "Getting your numbers into Sage 50.",
    items: [
      {
        q: "How do I get sales into Sage 50?",
        a: "Reports → Accounting builds a balanced Sage 50 General Journal file you import into Sage. No live connection is needed. Map your GL accounts once and the export lines up automatically.",
        href: "/admin/reports/accounting",
      },
      {
        q: "Can something help me with Sage 50?",
        a: "Yes — the Accounting page has an upload area for your Sage/POS reports and a Sage 50 assistant grounded in the official import rules that answers questions in plain language.",
        href: "/admin/reports/accounting",
      },
    ],
  },

  // ── Marketing & content ──────────────────────────────────────────────────────
  {
    id: "promotions",
    title: "Promotions",
    icon: "%",
    category: "Marketing & content",
    intro: "Daily deals, brand days, and clearance — scheduled and previewed.",
    items: [
      {
        q: "How do I create a sale?",
        a: "Go to Promotions and create a new one. Pick the products or brands, set the discount and dates, preview how the sale badge will look, then publish.",
        href: "/admin/promotions/new",
      },
      {
        q: "Will promotions conflict with each other?",
        a: "If two promotions overlap on the same products, you'll get a friendly warning so you can decide which one wins before publishing.",
        href: "/admin/promotions",
      },
      {
        q: "Can I test a promo before it's live?",
        a: "Yes — the Simulator shows exactly how a promotion changes prices on real products before you commit.",
        href: "/admin/promotions/simulator",
      },
    ],
  },
  {
    id: "blog-newsletter",
    title: "Blog & newsletter",
    icon: "✎",
    category: "Marketing & content",
    intro: "Posts, and emails to your subscribers.",
    items: [
      {
        q: "How do I write a blog post?",
        a: "Open Blog & Newsletter, start a new post, and write — or ask the AI helper to draft it. You'll see a live preview. Publish when it's ready.",
        href: "/admin/blog/new",
      },
      {
        q: "How do I send a newsletter?",
        a: "Use Newsletter Send. You compose (or AI-draft) the email, preview it, and send to your subscribers. Engagement — opens and clicks — shows up in the Customers report.",
        href: "/admin/newsletter",
      },
    ],
  },
  {
    id: "media",
    title: "Media library",
    icon: "🖼",
    category: "Marketing & content",
    intro: "Your photos and images in one place.",
    items: [
      {
        q: "Where do my uploaded images live?",
        a: "In the Media Library. Upload once and reuse across products, banners, and posts. You can add alt-text so images are accessible and SEO-friendly.",
        href: "/admin/media",
      },
    ],
  },
  {
    id: "knowledge-base",
    title: "Knowledge base",
    icon: "📚",
    category: "Marketing & content",
    intro: "Cannabis reference info used to enrich your catalog.",
    items: [
      {
        q: "What is the Knowledge Base?",
        a: "A library of cannabis reference details (strains, effects, terms) the system draws on to help write accurate product descriptions and answer shopper questions.",
        href: "/admin/knowledge-base",
      },
    ],
  },

  // ── Equipment & integrations ──────────────────────────────────────────────────
  {
    id: "equipment",
    title: "Equipment",
    icon: "🛠",
    category: "Equipment & integrations",
    intro: "Tracking your store's hardware and assets.",
    items: [
      {
        q: "What's the Equipment page for?",
        a: "It's your register of store hardware and assets — what you own, where it is, and its details — so nothing gets lost and maintenance is easy to track.",
        href: "/admin/equipment",
      },
      {
        q: "Where's the receipt printer setup, specifically?",
        a: "The receipt printer has its own dedicated page (Receipt Printer) with a full setup guide, live diagnostics, and a troubleshooting assistant.",
        href: "/admin/settings/receipt-printer",
      },
    ],
  },
  {
    id: "integrations",
    title: "Integrations (Leafly / WeedMaps)",
    icon: "🔌",
    category: "Equipment & integrations",
    intro: "Syndicating your menu and connecting outside services.",
    items: [
      {
        q: "What are integrations?",
        a: "They connect Greenway to outside services — mainly pushing your menu to Leafly and WeedMaps, plus the Sage 50 accounting export. The Integrations page shows the status of each.",
        href: "/admin/integrations",
      },
      {
        q: "How do I enter my Leafly / WeedMaps API keys?",
        a: "On the Integrations page there's a Credentials section. Enter the keys from your Leafly business login and WeedMaps back office right there and save — no code or environment files needed. Secrets are stored securely and shown masked.",
        href: "/admin/integrations",
      },
      {
        q: "Does saving keys push my menu anywhere?",
        a: "No. Saving credentials sends nothing to Leafly or WeedMaps. A live menu push always requires you to open the Leafly or WeedMaps page and explicitly confirm it. Preview (dry-run) is always safe.",
        href: "/admin/integrations",
      },
      {
        q: "How do I push my menu to Leafly or WeedMaps?",
        a: "Open the Leafly or WeedMaps page from Integrations. Use Preview to see exactly what would be sent, then confirm a live push once your account is set up and certified.",
        href: "/admin/integrations/leafly",
      },
    ],
  },

  // ── Insights ──────────────────────────────────────────────────────────────────
  {
    id: "reports",
    title: "Reports & forecasting",
    icon: "📊",
    category: "Insights",
    intro: "The full picture, in easy-to-read charts.",
    items: [
      {
        q: "What reports are available?",
        a: "Sales, Tax, COGS, Customers, Employees, Loyalty, Medical, Excise, Accounting, and CCRS Compliance — each with a date range and CSV/Excel export.",
        href: "/admin/reports",
      },
      {
        q: "Can it predict demand?",
        a: "Yes — the Forecast report uses AI to project demand so you can plan reorders. Like all AI here, it's guidance you review, not an automatic action.",
        href: "/admin/reports/forecast",
      },
      {
        q: "How much am I spending on AI?",
        a: "AI Usage shows how much the AI helpers have been used, so there are no surprises.",
        href: "/admin/ai-usage",
      },
    ],
  },

  // ── Team & administration ──────────────────────────────────────────────────────
  {
    id: "users",
    title: "Team & access",
    icon: "👥",
    category: "Team & administration",
    intro: "Inviting staff and controlling who can do what.",
    items: [
      {
        q: "How do I invite a teammate?",
        a: "Go to Users and send an invite. You choose their role, which controls what they can see and change.",
        href: "/admin/users",
      },
      {
        q: "What do the roles mean?",
        a: "Higher roles can do more. Read-only staff view reports and exports; managers and admins edit content, publish, and manage the catalog; the owner controls the most sensitive settings (like sales limits). The Users page explains each role.",
        href: "/admin/users",
      },
    ],
  },
  {
    id: "settings",
    title: "Settings",
    icon: "⚙",
    category: "Team & administration",
    intro: "Store-wide configuration.",
    items: [
      {
        q: "Where are store settings?",
        a: "The Settings area holds store-wide configuration. Some settings also have their own dedicated pages — Types & Categories, Sales Limits, Integrations, and Receipt Printer — grouped nearby for quick access.",
        href: "/admin/settings",
      },
    ],
  },
  {
    id: "audit",
    title: "Audit log",
    icon: "⧗",
    category: "Team & administration",
    intro: "A record of who changed what, and when.",
    items: [
      {
        q: "Can I see who changed what?",
        a: "Yes — the Audit Log records important actions with who did them and when, so nothing important is a mystery.",
        href: "/admin/audit",
      },
    ],
  },
];

/** Flattened, searchable list of every Q&A with its section context. */
export type FlatHelp = HelpItem & {
  sectionId: string;
  sectionTitle: string;
  sectionIcon: string;
  category: HelpCategory;
};

export function flattenHelp(): FlatHelp[] {
  return HELP_SECTIONS.flatMap((s) =>
    s.items.map((item) => ({
      ...item,
      sectionId: s.id,
      sectionTitle: s.title,
      sectionIcon: s.icon,
      category: s.category,
    })),
  );
}

/** Sections grouped by category, in HELP_CATEGORIES order (empty groups dropped). */
export function sectionsByCategory(): { category: HelpCategory; blurb: string; sections: HelpSection[] }[] {
  return HELP_CATEGORIES.map(({ name, blurb }) => ({
    category: name,
    blurb,
    sections: HELP_SECTIONS.filter((s) => s.category === name),
  })).filter((g) => g.sections.length > 0);
}
