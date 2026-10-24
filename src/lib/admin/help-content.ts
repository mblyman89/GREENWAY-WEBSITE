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
  | "Customers & loyalty"
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
    blurb: "Your public greenwaymarijuana.com site and the orders customers place on it.",
  },
  {
    name: "Point of sale",
    blurb: "The in-store side: registers, cash drawers, receipts, and time clock.",
  },
  {
    name: "Customers & loyalty",
    blurb: "Customer and patient profiles, and your rewards program.",
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
        a: "Start at the Dashboard. Until your store is fully set up it shows a setup-progress banner that takes you straight to the next step. In general: upload your POS menu, publish it, then enrich products, set up promotions, and connect your equipment.",
        href: "/admin",
      },
      {
        q: "Where are the printable SOPs?",
        a: "The one-page procedures — the truck-day master sheet plus a sheet for every stage of the product journey — live under Printable SOPs. Print them and put them on the wall for new hires.",
        href: "/admin/sop",
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
    intro: "The greenwaymarijuana.com site your customers browse.",
    items: [
      {
        q: "How does my website get its products?",
        a: "From the menu you upload out of your POS. Once you publish an upload, those products, prices, and stock levels appear on the public menu automatically. Photos and descriptions you add here make each product look great.",
        href: "/admin/menu-imports",
      },
      {
        q: "How do I change the words on my homepage or other pages?",
        a: "Open the specific page builder (Home, Menu, Loyalty, Specials, Vendors, FAQ, About, Locations, Price Match) in the Pages section, or use Header & Footer / Branding / Legal Policies for those areas. You edit blocks like the hero headline or business hours and preview before it goes live. To see the whole site as it will look, use the Live preview tab on Website Sync.",
        href: "/admin/website-sync",
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
      {
        q: "How do I edit the Price Match page?",
        a: "Open the Price Match page builder in the Pages section to edit your price-match policy and the words customers see, with preview before it goes live.",
        href: "/admin/pages/price-match",
      },
      {
        q: "Where do I edit the Home page specifically?",
        a: "The Home page builder edits your homepage blocks — hero, banners, featured sections — with a preview before anything goes live.",
        href: "/admin/pages/home",
      },
      {
        q: "Where do I edit the Menu page's words and layout?",
        a: "The Shop (Menu) page's top banner is now the Shop Banner editor \u2014 a carousel of up to ten fully-editable \"special\" slides (image, styled text, buttons, and an optional schedule) with a live preview. The products themselves come from your published menu upload.",
        href: "/admin/content/shop-banner",
      },
      {
        q: "Where do I edit the Specials page?",
        a: "The Specials editor controls the top hero image, the weekly deal cards, and the Today's Deal banner \u2014 each with live previews. The deals themselves come from Promotions, and the hero wording comes from Site Content.",
        href: "/admin/specials",
      },
      {
        q: "Where do I edit the Vendors page?",
        a: "The Vendors page builder edits the public page that showcases the brands and farms you carry.",
        href: "/admin/pages/vendors",
      },
      {
        q: "Where do I edit the About page?",
        a: "The About page builder edits your store's story, team, and photos on the public site, with preview before publishing.",
        href: "/admin/pages/about",
      },
      {
        q: "Where do I edit the Locations page?",
        a: "The Locations page builder edits your address, hours, parking notes, and map details customers see.",
        href: "/admin/pages/locations",
      },
      {
        q: "How do I check that my public site matches what I published?",
        a: "Website Sync reads your storefront through the exact same loaders the public site uses and shows what's being served right now — a one-page harmony check between the back office and the live site.",
        href: "/admin/website-sync",
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
        a: "Loyalty sign-ups collected on the site appear under Loyalty signups. Mark one as entered and the customer record is created automatically; the rewards rules live under Loyalty Program.",
        href: "/admin/loyalty-signups",
      },
    ],
  },

  // ── Point of sale ──────────────────────────────────────────────────────────
  {
    id: "registers",
    title: "Register Activity",
    icon: "💵",
    category: "Point of sale",
    intro: "The back-office oversight console: who's working, what each register is doing, and a live feed of store activity.",
    items: [
      {
        q: "What is the Register Activity page for?",
        a: "It's the manager oversight console for the sales floor — like Lightspeed's BackOffice Shifts Summary or Square Dashboard. It shows the day's headline numbers, who is currently clocked in, each register's live status, and a live activity feed. The hands-on drawer counting happens on the front-end iPad POS at the register; here a manager monitors it.",
        href: "/admin/registers",
      },
      {
        q: "Which sales figures does it show?",
        a: "It shows online pickup-order sales — the only itemized transactions in this back office. In-store card/cash sales are captured at the register and aren't broken out here. Over/short reflects reconciled cash drawers.",
        href: "/admin/registers",
      },
      {
        q: "What are the reconcile and verify sign-offs?",
        a: "After a cashier blind-closes a drawer at the register, a manager reconciles it (enters the day's cash sales to reveal over/short) and verifies the shared manager till the next morning. These two manager sign-offs appear under 'Needs attention' when there's something to do.",
        href: "/admin/registers",
      },
      {
        q: "Where are the cash drawer reports?",
        a: "Cash drawer reports (History) shows every opened, closed, reconciled, and verified session with its counts and any discrepancies, so nothing is a mystery later.",
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
        href: "/admin/equipment?tab=printer",
      },
      {
        q: "My receipts aren't printing — what do I check?",
        a: "Open Receipt Printer and read the live diagnostics panel; it tells you exactly what's wrong (offline, wrong Poll URL, out of paper, queued jobs). The built-in assistant walks you through the fix step by step.",
        href: "/admin/equipment?tab=printer",
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
      {
        q: "How do I plan the week's shifts?",
        a: "The Schedule builder lets you plan each week's shifts per employee, so coverage is decided ahead of time and everyone can see when they work.",
        href: "/admin/staffing/schedule",
      },
      {
        q: "Where is the employee handbook?",
        a: "The Employee Handbook page holds your policies in a printable form. Print it, have each employee read and sign the last page, then mark the handbook \"Read & signed\" in their file.",
        href: "/admin/staffing/handbook",
      },
    ],
  },

  // Customers & loyalty (CRM)
  {
    id: "customers",
    title: "Customers",
    icon: "👥",
    category: "Customers & loyalty",
    intro: "Customer and patient profiles — the foundation for history and rewards.",
    items: [
      {
        q: "What are Customers for?",
        a: "Customer profiles are the foundation for loyalty, purchase history, and (later) register limit checks. You build a record for each shopper or patient so their rewards and history follow them.",
        href: "/admin/customers",
      },
      {
        q: "How do I add customers?",
        a: "Add them one at a time from the Customers page, or bring in a whole list at once using Customers → Import.",
        href: "/admin/customers/import",
      },
      {
        q: "Where do website loyalty signups go?",
        a: "New signups from the public site land in Loyalty signups on the Dashboard. Mark one as entered and its customer record is created here automatically — deduped against people you already have, and enrolled in the loyalty program.",
        href: "/admin/loyalty-signups",
      },
    ],
  },
  {
    id: "loyalty",
    title: "Loyalty program",
    icon: "🏅",
    category: "Customers & loyalty",
    intro: "Points, tiers, promotions, and redemptions.",
    items: [
      {
        q: "How does the loyalty program work?",
        a: "The Loyalty Program area is where you manage points, tiers, promotions, and redemptions for your rewards members. It's the back-office control panel for the program.",
        href: "/admin/loyalty",
      },
      {
        q: "How is that different from the public Loyalty page?",
        a: "This area runs the program (points and rules). The words and design customers see are edited separately under Website → Loyalty, with preview before publish.",
        href: "/admin/loyalty-page",
      },
      {
        q: "Where do I see loyalty performance?",
        a: "The Loyalty report under Reports summarizes program activity — signups, points, and redemptions — so you can see how it's doing.",
        href: "/admin/reports/loyalty",
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
    title: "Product Enrichment",
    icon: "📦",
    category: "Catalog & inventory",
    intro: "Photos, descriptions, and details that make live products shine online.",
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
      {
        q: "How do I research a vendor with Google Gemini?",
        a: "Open the vendor and find Research with Google Gemini (step 1). Add an optional hint and press Research. It searches Google and shows the website, social profiles, mission, about and product philosophy it found, plus the pages it used and Google's search suggestions. Nothing is saved unless you press Save as draft on a field, and drafts still need Accept below (with the compliance check). Results disappear when you leave the page (Google's terms). If the website looks right, type it into the profile's Website field and save, then use step 2 (the crawler) to read the whole site. It needs AI_API_KEY plus AI_MODEL_HEAVY set to a gemini model and AI_GEMINI_API_KEY in Vercel.",
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
        q: "What is Receiving?",
        a: "It's how you receive incoming transfers from suppliers. Upload the vendor's transfer manifest and review it before accepting it into inventory. Receiving lives in the Product Intake tab.",
        href: "/admin/inventory/intake",
      },
      {
        q: "What is Product Onboarding?",
        a: "When you receive a lot that isn't on the live menu yet, the system drafts the new product from the transfer + COA. You review it, set a price (guarded by the cost floor), and approve it onto the menu. Nothing is customer-facing until you approve it. After it publishes, add photos and a description in Product Enrichment.",
        href: "/admin/inventory/drafts",
      },
      {
        q: "How do I do a cycle count?",
        a: "Cycle Counts is the counting floor: open a job the owner has approved and enter what you physically count, without seeing the system figure. Recording a count changes nothing on its own. The owner reviews every difference in Inventory Auditing and approves the correction, which is what posts to inventory and to the books.",
        href: "/admin/inventory/cycle-counts",
      },
      {
        q: "How do I give products without an expiration date one?",
        a: "Inventory → Expiration rules lists every category and type from Settings → Types (new ones appear on their own). Set a rule (months or days after receiving, a fixed date, or does not expire), Save, then Preview and Apply. Dates from the manifest / JSON / COA are never changed; dates you typed by hand are only replaced when you turn Override on. Each row shows a research-based suggestion with its sources. Washington does not require an expiration date (WAC 314-55-105(8) makes a best-by date optional), so rule dates print as \"Best by\".",
        href: "/admin/inventory/expiration-rules",
      },
      {
        q: "How do I put tags like New or Staff Pick on products?",
        a: "Inventory \u2192 Tags. Create a tag (name, colour, order), then choose it under Add or remove products, search the live menu, tick products and press Apply. Tags show on the product cards (up to 3 per card) and shoppers can filter the menu by them (Tags in the filter panel, or a link like /menu?tags=staff-pick). The built-in New tag is automatic: a product shows it for 14 days (you can change the number) from the first time it was on a published menu, then it comes off by itself. You can rename, recolour or turn New off, but not delete it. Every change shows on the website on the next page load.",
        href: "/admin/inventory/tags",
      },
      {
        q: "How do I record a return or destroy product lawfully?",
        a: "Returns & Destruction handles customer returns, samples, and lawful destruction with the documentation WA compliance requires.",
        href: "/admin/inventory/disposition",
      },
      {
        q: "Where do I track glass, papers, and other non-cannabis merchandise?",
        a: "Non-cannabis inventory tracks your accessories — glass, papers, devices — professionally (counts, costs, restock) without touching CCRS, since the state doesn't require reporting for them.",
        href: "/admin/inventory/noncannabis",
      },
    ],
  },
  {
    id: "discovery",
    title: "Product discovery & sourcing",
    icon: "🔍",
    category: "Catalog & inventory",
    intro: "Find products and vendors worth pursuing, and see how your buying compares to the market.",
    items: [
      {
        q: "What is Product Discovery?",
        a: "Product Discovery is where you find products and vendors worth pursuing — the very start of the intake lifecycle, before you raise a purchase order.",
        href: "/admin/discovery",
      },
      {
        q: "What are CCRS Benchmarks?",
        a: "CCRS Benchmarks give you statewide market insights from public WA CCRS data: retail and wholesale prices, price per gram, brand and strain premiums, sales velocity, the top-25 vendors, and a \"your numbers vs. the market\" comparison so you can see if you're over- or under-paying. (This is the statewide view; the local competitor view lives under Reports → Benchmarks.)",
        href: "/admin/discovery/benchmarks",
      },
      {
        q: "What is the Catalog Hub?",
        a: "The Catalog Hub is the one-stop Product Intake dashboard that ties the whole lifecycle together — discovery, purchasing, receiving, onboarding, enrichment, and mastering.",
        href: "/admin/catalog",
      },
      {
        q: "Where do new products get approved onto the menu?",
        a: "Product Onboarding is where you review and approve newly received products before they appear on the menu.",
        href: "/admin/inventory/drafts",
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
        a: "Go to Purchasing and start a new PO. Add the vendor and items, then track it from ordered to received. Received POs line up with Receiving.",
        href: "/admin/purchasing/new",
      },
      {
        q: "How do I pay a vendor?",
        a: "Accounts Payable (in the Product Intake tab) is where you queue and send vendor ACH payments once a PO is received and reconciled. Every payment is drafted for review before it's sent.",
        href: "/admin/vendor-payments",
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
      {
        q: "Is there a guided weekly CCRS routine?",
        a: "Yes — the CCRS command center walks the whole weekly upload: pick the reporting week, review activity, pass the validation gate, follow the upload walkthrough (with the state's dependency order and wait timers), then record the week in the submission ledger.",
        href: "/admin/compliance/ccrs",
      },
      {
        q: "How do I compare our records with what CCRS holds?",
        a: "Ask the LCB Service Desk for a CCRS data copy, then upload its four CSVs (Inventory, Product, Strain, Area) on CCRS Records. It compares the State's copy with our live lots, our CCRS ledger and every record we sent, shows a sync score and a needs-action list (CSV download), and lets you merge the copy into our ledger with one guarded button.",
        href: "/admin/compliance/ccrs/records",
      },
      {
        q: "How do I know if I'm compliant overall right now?",
        a: "Compliance Health is the one-glance \"am I safe?\" page — it checks every compliance gate live (filings, limits, data integrity) and tells you what needs attention.",
        href: "/admin/compliance/health",
      },
      {
        q: "How do I keep up with LCB rule changes?",
        a: "Regulatory Watch tracks upcoming rule changes and what they might mean for the store, so future compliance never sneaks up on you.",
        href: "/admin/compliance/regulatory",
      },
      {
        // books-23: the answer says WHO can open this, and the `href` is gone.
        //
        // HelpItem has no permission field, so this catalogue is shown to
        // everyone. Leaving the link here sent a budtender who searched
        // "deadlines" to a page that refuses them -- the same nagging Michael
        // asked to be rid of, arriving by a different route.
        //
        // Rewording rather than adding permissions to the help system: gating
        // help is a real feature and belongs in its own slice, not smuggled in
        // here. Naming the owner is honest and costs nothing.
        q: "Where are my recurring licensing deadlines?",
        a:
          "The Compliance calendar lists the recurring obligations — renewals, filings, " +
          "and due dates — in one place so nothing is missed. It lives in the owner's own " +
          "menu and Michael keeps that burden himself, so staff are never chased for a " +
          "filing that is not theirs to make.",
      },
    ],
  },
  {
    id: "employee-samples",
    title: "Employee samples",
    icon: "🎁",
    category: "Compliance",
    intro: "Trade samples for paid employees, within WA limits (WAC 314-55-096).",
    items: [
      {
        q: "How do I give employees product samples legally?",
        a: "Use Employee Samples. It assigns trade samples to paid employees and enforces the state's per-employee limits automatically (WAC 314-55-096), so a sample can never put you out of compliance.",
        href: "/admin/compliance/samples",
      },
      {
        q: "Where can I see past sample assignments?",
        a: "Employee Sample History is the read-only record of every sample assigned — who received what, when, and against which limit period.",
        href: "/admin/compliance/samples/history",
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
      {
        q: "Which products are expiring soon?",
        a: "Reports → Expiration shows on-hand stock by how soon it expires (lots and value at cost), a 12-month forecast, where each date came from, categories with undated stock, how much each rule dated, and a 90-day watchlist you can export to Excel or CSV.",
        href: "/admin/reports/expiration",
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
  {
    id: "payroll",
    title: "Payroll direct deposit",
    icon: "💵",
    category: "Money & accounting",
    intro: "Paying your employees by ACH direct deposit.",
    items: [
      {
        q: "How do I pay employees by direct deposit?",
        a: "The Payroll page turns a manual-entry payroll run into a bank-ready ACH (NACHA) file: enter each employee's net pay, generate the file, and upload it to your bank. Every run is recorded with its status.",
        href: "/admin/payroll",
      },
      {
        q: "Where do I set up the bank details for ACH files?",
        a: "The Banking page (Admin → Banking) is the vault: vendor bank details, employee direct deposit, and — on the My banking tab — your originating bank and company details for ACH files. Set it once; Payroll and Accounts Payable both use it.",
        href: "/admin/settings/banking",
      },
      {
        q: "I'm stuck, or a payment was refused. What do I do?",
        a: "Open Banking → Guide & unblocker. It shows four short checklists (setup, employees, vendors, payday) with green ticks for what is done and a button for the next step, then a list of everything that would stop a payment today with the exact fix. If payroll or a vendor payment shows an error you don't understand, paste it into 'Explain an error message' at the bottom. If a direct deposit can't be fixed before payday, pay that person by paper check: Washington requires wages on payday.",
        href: "/admin/settings/banking/guide",
      },
      {
        q: "How do I keep track of ACH record keeping and yearly to-dos?",
        a: "Banking → Calendar & reminders lists what is due: the monthly bank-statement check, the quarterly Nacha rule check, the yearly reviews (including re-reading the Timberland agreement, re-confirming Timberland's limits and Greenway's company name/ID with Brenda, and the Schedule F security self-check), the Timberland agreement and the written fraud procedure. Press 'Mark done' when you finish a task. It is saved with your name and date, and Stephen, Michael and the store are emailed when something is due or overdue. It also lists every Nacha rule change with the exact words and whether our code already handles it.",
        href: "/admin/settings/banking/calendar",
      },
      {
        q: "Where can I read the court cases and laws about ACH fraud, and how do I protect the business?",
        a: "Banking → Legal library. Each court case and Washington law is quoted word for word from the court's or legislature's own website, then explained in plain English, with how Greenway already protects you. It opens with seven things to do to protect the business. Its last section, 'Your Timberland agreement', quotes the agreement Greenway signed on 10/09/26 word for word: liability, indemnity, cancelling a file, reversals, account numbers, the 30-day statement rule and the Schedule F security notice. It is education, not legal advice: ask a Washington business lawyer before a real decision.",
        href: "/admin/settings/banking/library",
      },
      {
        q: "How do I sign LlamaParse's data protection agreement?",
        a: "It is not signed inside the back office. LlamaParse (the optional scanner for paper ACH forms) uses a DocuSign form. Open Banking → Calendar & reminders → 'LlamaParse data protection agreement', press the button, fill in Greenway's details and sign, then save the signed copy and mark the task done. You only need it if LlamaParse is turned on.",
        href: "/admin/settings/banking/calendar#llamaparse",
      },
      {
        q: "How do I check an ACH file before I upload it to Timberland?",
        a: "Banking \u2192 File checker. On ACH operations press Download on the file (do not open or edit it), then pick it on the File checker and press 'Check this file'. It re-checks every record, count and total, Timberland's routing number and Greenway's Company ID, credits only, the PAYROLL description, the upload deadline and the $50,000 limits, and that it is byte for byte the file you released and not yet uploaded or voided. Green means upload it. Red means do not. Timberland cannot cancel a file once it has it (agreement section 18), so this is the last check. 'Practice run' builds a $0 file from your real settings so you can see a passing result; nothing is saved.",
        href: "/admin/settings/banking/checker",
      },
      {
        q: "How does the OFAC sanctions screening work, and can it stop a payment?",
        a: "Banking \u2192 Sanctions screening. Every morning the site downloads OFAC's SDN and Consolidated lists and checks every employee and vendor name against them (the way OFAC's FAQ 249 describes: Jaro-Winkler and Soundex). It never stops a payment: payroll and vendor files run as usual. If a name looks similar to a list entry, it shows under Possible matches and Michael gets an email. Compare the details in the Remarks column (date of birth, country, business location). Most are false positives (OFAC FAQ 5): record 'Not a match' with what you compared. If several details match, record 'True match', do not send them money, and call your attorney and Timberland at 1-800-562-8761. Only the owner records a decision; Stephen's goes to Michael for approval. Every decision is kept and never changed. 'Screen now' runs it at once.",
        href: "/admin/settings/banking/screening",
      },
      {
        q: "What does Nacha require me to do once a year for ACH fraud?",
        a: "Banking \u2192 Yearly review. Nacha's fraud-monitoring rule (Phase 2) says every business that sends ACH payments must have written, risk-based procedures to spot payments made under false pretenses, and review them at least once a year. The page shows the 12-item written procedure, Greenway's risk assessment (which payments are higher risk, like a bank-account change or a new vendor, and which are lower risk, like repeat payroll), each tied to Nacha's own words, and who did what with ACH this year: who holds owner or admin, every ACH action by person, and every approval request and how it ended (only the owner sees that part, because it reads the Security Log). Once a year the owner re-reads it, ticks the two boxes, writes what was found and presses Record. Recording this year's review also ticks the Calendar task. A review is never changed: to fix one, record a correction. 'Print the packet' gives a plain-text copy for your files.",
        href: "/admin/settings/banking/yearly-review",
      },
      {
        q: "How does the site watch the Timberland account for money I didn't expect?",
        a: "Banking \u2192 Bank watch. Every morning the site refreshes the Timberland Main account from Plaid (the same Bank Feeds connection; no new connection is used) and explains every money-out line it can: an ACH file settling (the ACH Payments report), something already in the books, a Timberland fee from Schedule B, or a known payee Michael added (with an optional dollar limit). Anything left over is listed under Not explained and Michael gets an email. Open each one and say what it is, with how you know. If nobody recognises it, call Timberland Cash Management at 1-800-562-8761 the same day. It also lists money that came back for exactly the amount of a payment we sent (a possible return: log it on ACH operations), months with more return/NOC fee debits than notices logged, and whether the feed is healthy and is the account ending in the digits on the signed agreement. It never blocks a payment. Pending lines are shown but not counted. On ACH operations, the owner also sees Plaid's balance beside the funding box as a hint; you still look and type what you saw.",
        href: "/admin/settings/banking/bank-watch",
      },
      {
        q: "Can the site tell me when a Fed ACH notice email arrives?",
        a: "Banking \u2192 Notice email. Timberland says ACH notices (returns and NOCs) come two ways: a secure encrypted email from the Federal Reserve, and the Timberland portal under Reporting \u2192 Electronic Documents. The Fed's guide says that email comes from encryptedmail.achedi.com, that you should not rely on it, and that you should sign in to the portal every day. So the watch is OFF until Michael turns it on, and turning it on means typing I STILL CHECK THE PORTAL. When it is on, once an hour it looks in the company Google Workspace mailbox (the same sign-in the CCRS email monitor uses), including Spam, for mail from that sender, stores each email once (encrypted) and emails Michael. It never clicks a link or reads the notice: it shows who sent it, whether Google checked the sender, and where its links go (a warning if any link is not achedi.com). You then sign in to achedi.com yourself (type it), read the notice, log it on ACH operations, and mark the email Logged. Reports stay in the portal 60 days, so download them. It never blocks a payment.",
        href: "/admin/settings/banking/notice-email",
      },
      {
        q: "Where are Greenway's written ACH policies, and what do I have to do each year?",
        a: "Banking \u2192 Policies. There are eight short policies: how a payment is made, how long records are kept, what to do if something looks wrong, who can touch ACH, looking after logins and keys, watching the account, the banking computer, and what happens if an ACH payroll cannot go out (it is skipped and paid by written checks). Hover the small i next to each one for a plain explanation, and open Why to read the exact words from the State Auditor's guidance or the Timberland agreement. Michael does three things: once a year he reads and adopts the policies (if the wording changes later, the page asks him to adopt again); every quarter he records the access review (the page lists everyone who holds owner or admin and flags anyone inactive or not signed in for 90 days); and once a year he records the six key checks (Timberland token, Timberland login, back-office passkeys, the encryption key backup, the Google Workspace sign-in and the banking computer). Records are dated today and are never changed. If anything looks wrong, call Timberland at 1-800-562-8761 at once.",
        href: "/admin/settings/banking/policies",
      },
      {
        q: "What do I need to settle with Timberland before the first ACH payroll, and what do the ACH words mean?",
        a: "Banking \u2192 Bank setup & glossary. It lists what to ask Brenda (how the test file works, the release code, an ACH debit block, an ACH filter, the Fed notice email), your own decision (dual approval) and what she has already confirmed, each with her words. Print the meeting sheet and write her answers on it. The glossary below explains ODFI, RDFI, prenote, NOC, returns and the rest in plain words.",
        href: "/admin/settings/banking/bank-setup",
      },
      {
        q: "How do I confirm the money is in the account for an ACH file?",
        a: "On ACH operations, each released or uploaded file has a 'Confirm funding' box. It shows the file total plus Timberland's $50.00 monthly ACH Service Fee (Schedule B). Look at the balance of the account ending 6048 yourself (the owner also sees the Plaid balance beside the box as a hint; it can lag), type the balance you saw and tick the box. It must be at least the file total. Timberland's agreement (section 14) needs the money there by 9:00 am Pacific on the settlement date, and Brenda confirmed that is when it must be there (Email 3, answer 5). Never let the account go negative: Timberland only asks for pre-funding from customers who overdraw. You get an email at 8:00 am Pacific on the settlement day. If it is short, move money in and call Timberland at 1-800-562-8761. Only the owner confirms funding.",
        href: "/admin/settings/banking/operations#files",
      },
    ],
  },

  // ── Marketing & content ──────────────────────────────────────────────────────
  {
    id: "marketing",
    title: "Marketing & advertising",
    icon: "📣",
    category: "Marketing & content",
    intro: "The AI marketing strategist and where your ideas live — always WA-compliant, always drafts.",
    items: [
      {
        q: "What does Marketing & Advertising do?",
        a: "You enter a goal and the AI strategist returns a WA-compliant marketing strategy draft grounded in your real store and vendors. Plans are automatically scanned against WA advertising rules, and anything with health/medical claims or appeal to minors is withheld.",
        href: "/admin/marketing",
      },
      {
        q: "Does it post anything for me?",
        a: "No. Everything is a draft you review. You save promising ideas to the idea notebook and move them from idea → planned → done. You always approve before anything is used.",
        href: "/admin/marketing",
      },
      {
        q: "How do I generate marketing images?",
        a: "Open the Creative Studio. It opens on FLUX Image, which works like the BFL Playground: type your prompt (sent word for word), optionally add reference images (image 1, image 2…), choose the aspect ratio or a destination size, the number of images (1–4 or 8), format, safety and prompt upsampling, then Generate. Results save to Digital Assets (MKTG & ADV) as drafts. FLUX Video makes clips (with Draft first to save credits), and the Midjourney tab builds a copy-paste prompt.",
        href: "/admin/marketing/midjourney",
      },
    ],
  },
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
        a: "In Digital Assets (MKTG & ADV → Digital Assets). Upload once and reuse across products, banners, and posts. You can add alt-text so images are accessible and SEO-friendly.",
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
    intro: "One home for every piece of store hardware.",
    items: [
      {
        q: "What's the Equipment page for?",
        a: "It's the single home for all your hardware. The top shows your integrated devices (receipt printer, label printer, scanner, laminator) with a link to the page each one drives. Below that is the full asset registry — POS terminals, scales, safes, cameras — so nothing gets lost and maintenance is easy to track.",
        href: "/admin/equipment",
      },
      {
        q: "What does “Needs attention” show?",
        a: "It surfaces anything actionable: scales with calibration due or coming due, and assets whose warranty expires within 60 days. When nothing needs attention the section is hidden.",
        href: "/admin/equipment",
      },
      {
        q: "Where's the receipt printer setup, specifically?",
        a: "The receipt printer has its own dedicated page (Receipt Printer) with a full setup guide, live diagnostics, and a troubleshooting assistant. Its live online/offline status also shows on its Equipment card, which links straight there.",
        href: "/admin/equipment?tab=printer",
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
      {
        q: "Is there a full walkthrough of the Leafly push and preview page?",
        a: "Yes \u2014 the Leafly handbook walks the page one step at a time, explains what every control does and why it behaves that way, lists what to do when something looks wrong, and includes a first-time checklist ordered so every reversible step happens before any step a customer can see.",
        href: "/admin/integrations/leafly/help",
      },
      {
        q: "What is the difference between acknowledging a Leafly order and confirming it?",
        a: "Acknowledging is a receipt: it tells Leafly the order reached us and stops the auto-cancel countdown. Confirming is the business decision that we will actually fill it. They are separate because they answer different questions, and acknowledging is irreversible \u2014 it permanently ends our access to the shopper's ID images, so read any ID you need first. The Leafly handbook covers this in full.",
        href: "/admin/integrations/leafly/help",
      },
      {
        q: "Will pushing to Leafly delete items from my listing?",
        a: "It can, and that is intended. A POST is a full sync: Leafly's menu becomes exactly what we send, so anything missing from the feed is removed from the listing. That is what keeps Leafly matching the shop. A PUT only adds and updates, leaving anything unmentioned alone. The Leafly handbook explains when to reach for each.",
        href: "/admin/integrations/leafly/help",
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
        q: "How are my customers and their spending trending?",
        a: "The Customers report breaks down customer activity and spending so you can spot your best shoppers and how retention is trending.",
        href: "/admin/reports/customers",
      },
      {
        q: "How do I see employee performance or hours?",
        a: "The Employees report summarizes staff activity and hours, useful alongside the time clock and payroll.",
        href: "/admin/reports/employees",
      },
      {
        q: "Where's the loyalty program report?",
        a: "The Loyalty report shows signups, points, and redemptions so you can measure how the rewards program is performing.",
        href: "/admin/reports/loyalty",
      },
      {
        q: "How do I see who's been given employee, industry, or veteran discounts?",
        a: "The Special Discounts report tracks every use of the three courtesy programs: which cashier gave it, which employee or company received it, who approved employee purchases, and how often — with CSV/XLSX export.",
        href: "/admin/reports/special-discounts",
      },
      {
        q: "How do I compare against local competitors?",
        a: "The Benchmarks report (under Reports) is the local competitor view of pricing and assortment. For the statewide market view from CCRS data, use CCRS Benchmarks in the Product Intake tab.",
        href: "/admin/reports/benchmarks",
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
        a: "Yes — the Security Log records important actions with who did them and when, so nothing important is a mystery. It is owner-only, because it is the record someone would have to edit to hide something.",
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
