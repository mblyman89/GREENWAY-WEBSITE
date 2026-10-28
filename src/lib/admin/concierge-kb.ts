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
      "The top navigation has these tabs, left to right: the Greenway wordmark (click it to go to the Dashboard home), then Online Orders, Reports, CRM, Product Intake, Inventory, Website, MKTG & ADV, Employee, Medical, CCRS, and Admin.",
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
      "Online Orders: a single button (no dropdown) that opens the online orders queue.",
      "Reports: opens the reporting hub (sales, tax, excise, COGS, customers, employees, loyalty, medical, compliance, forecast, accounting export).",
      "CRM: Loyalty Signups, Customers, Customer Insights, Loyalty Program.",
      "Product Intake: Product Discovery, CCRS Benchmarks, Catalog Hub, Purchasing, Receiving, Product Onboarding, Product Enrichment, Product Mastering, Accounts Payable, Knowledge Base.",
      "Inventory: Inventory, Other Inventory, Vendors & Brands, Types & Categories, Cycle Counts, Returns & Destruction.",
      "Website: Site Content, Home, Menu, Loyalty, Specials, Vendors, FAQ, About, Locations, Price Match.",
      "MKTG & ADV: Digital Assets, Marketing & Advertising, Promotions, Blog & Newsletter, Email Newsletter, Creative Studio.",
      "Employee: Time Clock, Payroll, Samples, Register Activity.",
      "Medical: Patient Records, Authorization Intake.",
      "CCRS: opens Compliance Health.",
      "Admin: Users, Integrations, Equipment, Sales Limits, AI Usage, Settings, Help & FAQ, Menu Imports.",
      "Accounting (owner only): the general ledger, journal, trial balance, chart of accounts, bills & 280E, payroll & COGS, bank reconciliation, conversion, and Inventory Auditing.",
      "Lyman (owner only): Bank Feeds, Loans, Crypto Portfolio, ATM, and the Security Log.",
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
      "New public loyalty signups arrive in CRM → Loyalty Signups; marking one as entered automatically creates (or links) its customer record here and enrolls it in the loyalty program.",
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
      "People who sign up on the website land in CRM → Loyalty Signups for you to review and approve.",
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
      "The cannabis line: a cannabis product can never be filed under Greenway Merch, Accessories or Paraphernalia, and a non-cannabis item can never be made cannabis. The lot page's Website category box, Move products and the inventory-type mapping all refuse a crossing outright for everyone (owner rule D48), the attempt is written to the audit log, and any cannabis lot already filed under a non-cannabis category shows as a blocking row on Inventory \u2192 Issues.",
      "Customer return \u2192 Destroy (Phase 1.4): a returned unit marked Destroy is added back to its lot and HELD (Held for destruction on the lot page): it counts on hand and in CCRS, but the register, the menu and the website never sell it. The return, the add-back, the hold and the destruction event are saved in one step, so an error means nothing changed: keep the unit and the cash aside and tell the owner. Still put the unit in the sealed destroy bin at once and write form 8.1 (SOP-15 \u00a74.7). Held units leave only when that destruction is completed; a vendor return, another destruction or a manual adjustment cannot take them. If the owner cancels the destruction the units are released and become sellable again. Until the owner applies migration 0308 the app cannot hold the unit and says so; then the sealed bin is the only control.",
      "Returns & Destruction \u2192 destruction (Phase 1.3): Schedule a destruction lists Active and Quarantine lots with their status. Recalled lots are never listed and never destroyed by us (owner decision D65): they go back to the vendor (the admin tells the LCB officer, then Log a vendor return with reason Recall). Scheduling moves an Active lot to Quarantine and remembers its earlier status; a Quarantine lot stays. Only the owner can cancel a scheduled destruction, with a written reason; the app then puts the lot back to its earlier status (only Quarantine \u2192 Active, only if it was Active) and says what it did. A customer-returned unit's destruction never moves the lot. After a partial destruction the rest of the lot goes back to its earlier status the same way.",
      "Returns & Destruction \u2192 vendor return (Phase 1.5): log the return as soon as the processor's written acceptance (RMA) arrives. Logging RESERVES the units on the lot: out of sale (register, menu, website) but still on hand and in CCRS. Active and Recalled lots can be returned; a Recalled lot stays Recalled. Greenway is the origin, so fill in the transport details, press Download Manifest.CSV (it is built from the return, the lot and Settings; if a field is missing it refuses and names it rather than guess) and upload it at cannabisreporting.lcb.wa.gov. Wait for the LCB's automatic email: success has the manifest PDF attached, error means fix and upload again. Print the PDF; it travels with the product (WAC 314-55-085). The steps are checked in order on the server. Only at Departure (pickup time and driver) does on-hand come off and the CCRS Other adjustment post. The LCB guide gives no lead time, so never quote one. Only the owner can cancel a return, which releases the units. Until the owner applies migration 0309 the app refuses to log a return and says so.",
      "Recalls (Phase 1.6c, G-25; WAC 314-55-225; coordinator = the admin, no back-up, D37): the moment a recall or market-withdrawal notice arrives, a manager opens Inventory \u2192 Recalls \u2192 Open a recall event (unsure? Recall), then on the event searches each lot and presses Add and set Recalled (the same gated, audited status change as the lot page). A recalled product then leaves the register menu, the website and online ordering by itself (if the recall status cannot be read, online orders are refused); you no longer set Always hide for a recall. Customers are never told \u201crecall\u201d: they see \u201cno longer available on the current menu\u201d. Pull, bin and count the units. Inventory \u2192 Issues shows open pickup orders holding it (call those customers), \u201cRecall: LCB not yet notified\u201d (blocking) or the 48-hour market-withdrawal countdown, and the weekly LCB progress report due every 7 days. Only the owner or the admin records the LCB notification (officer, method, store time) and closes the event; Released needs the written clearance reference and every lot set back to Active first. Recalled product is never destroyed by us (D65): it goes back with a vendor return, reason Recall, which takes the officer and date from the event. The written recall plan (coordinator, LCB officer, sections A\u2013D, owner approval, yearly review) is in Settings \u2192 Recall plan (owner and admin); Issues warns when it is incomplete or due for review. Before migration 0311 is applied the Recalls page says so and the paper forms 8.4 and 8.5 are used.",
      "Expired stock (Phase 1.6b; owner D36: \"hard block edibles and liquid edibles, warnings for everything else.\"; D44: \"same with rso too.\"): an expired Solid Edible, Liquid Edible, Tincture, Capsule or RSO (RSO is filed in CCRS as Concentrate for Inhalation, so the app also reads the store category and the name) is left off the register menu and refused at completion with NO override; while such a lot still has units, every sale of that product is refused, so set the expired lot to Quarantine (the nightly job does this at 4:20 AM) and the fresh stock sells again. Every other expired item sells only after the budtender tells the customer and ticks \"I told the customer\" (register payment screen, or the order page button \"I told the customer \u2014 complete the sale\"); the sale is noted on the order. Sales draw the soonest-expiring lot first (FEFO). SOP-05a \u00a74.16.",
      "Returns & Destruction \u2192 completing a destruction (Phase 1.6a): two people and on camera (owner D64: anyone may witness; it has to be done on camera). Complete destruction requires Witness (from the roster): anyone on the active staff roster except you; the app refuses yourself. It also requires Camera plus the camera date, start and end time (Pacific), and for Other method the LCB approval reference and date. Every missing item is listed at once and the refusal is logged. Schedule a destruction refuses a quantity larger than the lot has free (on hand less held units less units already scheduled) and gives the figures. All destruction times are Pacific. Destruction log (print) above the events opens the month\u2019s log (what, when, method, mix, destination, witness, camera, who); print it monthly and keep it five years with the forms 8.3. Until the owner applies migration 0310 the witness and camera are kept in the witness line.",
      "Returns & Destruction \u2192 photo and video evidence (Phase 1.7a, G-43 req 7; owner: \"please build the photo upload (G-43), as well as a video upload just in case.\"): on any destruction event that is not cancelled, Add photo or video (optional) takes a short note and Choose photo or video (on a phone it opens the camera or library). Photos: JPG, PNG, WebP or iPhone HEIC up to 50 MB. Videos: MP4, WebM or iPhone .MOV up to 200 MB (large files resume if the connection drops). Files go to a PRIVATE bucket, never the public website; the server checks the stored size, type and the file\u2019s first bytes and refuses (and removes) a file whose contents do not match its type. A saved photo or video can never be edited or deleted, and is kept five years with the destruction record. View / print this record on the event opens one destruction\u2019s printable record with its photos (videos are listed by name, with a player on screen); viewing links last 10 minutes. The monthly Destruction log has a Photo / video column. Until the owner applies migration 0312 the panel says so and nothing uploads; write the photo reference on form 8.3.",
      "Returns & Destruction \u2192 vendor-return packet (Phase 1.7b, G-42 req 7; owner: \"please also build the printable vendor-return packet (G-42).\"): every row in Vendor returns & manifests has Print packet (form 8.2) under its status, at every step including Departed and Cancelled. It opens form 8.2 filled in from the app: the return number (manifest number, else the GWVR identifier), Greenway as origin (license, address, phone, email from License settings), the processor (name, license, phone, email from Vendors & Brands), reason and detail (Recall: the LCB officer and contact date), the RMA, product, lot, quantity and reserve, the manifest number, transport, driver and vehicle, estimated departure and arrival, the LCB success email date, the pickup time, or the cancel with why; each step shows who recorded it and when (Pacific) and [x] done in the app or [ ] not yet. Anything the app does not hold prints as a blank line to fill by hand (never guessed); a done step without a stamp says not recorded. Print it at pickup, have the driver sign it, staple the RMA email, the LCB success email and the manifest PDF, and file it by month for five years (WAC 314-55-087). SOP-15 \u00a74.13.",
      "Lot page \u2192 Adjust quantity (Phase 1.2): reasons are Shrink, Damage, Sample (lab/QA), Employee sample, Cycle-count correction, Theft, Seizure and Other. Receive (add), Destruction and Recall removal are gone (owner decision D39): stock arrives through Receiving, and destruction (including recalled product) goes through the Schedule destruction link to Returns & Destruction. Theft and Seizure need the incident reference (police or LCB report number) \u2014 call the owner first. A note is required for Employee sample, Theft and Other (CCRS withholds the row without one) and is asked for every time. The change can never take the lot below zero, an Active lot that reaches zero becomes Sold out, every adjustment is audited, and the history shows who and when in Pacific time.",
      "Lot page \u2192 Lifecycle status (Phase 1.1): pick Active, Quarantine, Recalled or Sold out and write a reason (required). Destroyed is not on the list \u2014 destruction only goes through Inventory \u2192 Returns & Destruction. Setting Active runs the same go-live check as Finalize (CCRS identifier, a COA on file, not FAILED) and is refused with the reasons. Releasing a recall hold (Recalled \u2192 anything else) is owner or admin only (the admin is the recall coordinator) and needs the clearance reference. Every change is audited and listed under Status history with the name and Pacific time.",
      "Cannabis unit cost is never typed (owner rule D38: cost comes from the state CCRS manifest created by the vendor). Bulk fill offers only Expiration date and POS product key; a lot with no cost shows \u201cCost missing \u2014 correct from the manifest\u201d on Inventory \u2192 Issues, and the owner has it corrected from the manifest on Receiving.",
      "Cycle Counts is where staff record blind physical counts. It records what was counted and posts nothing; a difference only changes inventory once the owner approves it in Inventory Auditing, which writes the shelf correction and the journal entry together.",
      "Returns & Destruction handles vendor returns and compliant destruction with a quarantine hold. Trade samples are never sold: sample lots are kept off the menu, the register and the website, and are given out only from the Employee Samples hub (WAC 314-55-096(1)(i)).",
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
      "Digital Assets (MKTG & ADV → Digital Assets, formerly the Media Library) is where you upload and manage logos, banners, and images.",
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
      "The Creative Studio has three tabs: FLUX Image (default), FLUX Video, and Midjourney prompt.",
      "FLUX Image works like the BFL Playground: the prompt is sent to FLUX exactly as typed. Settings are aspect ratio (or custom or exact size, or a website/social destination size), safety tolerance 0–5 (default 2), output format (JPEG/PNG/WebP), prompt upsampling, and 1, 2, 3, 4 or 8 images. There's an optional seed and a model choice (FLUX.2 max/pro/flex or FLUX 3 Image).",
      "Reference images: up to 8 (FLUX.2) or 10 (FLUX 3). FLUX sees them in order as image 1, image 2…, so name them in the prompt. FLUX has no negative prompts; describe what you want instead.",
      "FLUX Video (FLUX 3): text → video, image → video with 1–10 keyframes, continue a clip, edit a clip, or upscale a clip. Duration is 5–20 s (or auto), resolution HD/Full HD/QHD/4K, with optional audio. Draft first gives a fast HD preview for about a third of the cost; Enhance renders the same shot at full quality.",
      "The Midjourney tab builds a copy-paste prompt from a structured brief, with Greenway AI assist grounded in the store profile and live weekly deals.",
      "Generated images and videos are DRAFTS in Digital Assets. Review them before using them on the website or in marketing.",
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
      "New hires: Employee \u2192 Employees \u2192 Add a person creates them as a Candidate with no clock PIN, so they cannot clock in or unlock the register yet. Open their file and work the onboarding checklist (offer, background check, 21+ ID check, I-9, W-4, handbook, training, badge).",
      "Only the owner or an admin can press Activate, Terminate or Rehire on an employee file (managers see \"owner or admin only\"). Activate unlocks only when the required steps are done. The clock PIN can be set only after the person is Active.",
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
    id: "ach-helper",
    area: "back-office",
    title: "ACH helper (guide, calendar, legal library)",
    tab: "Settings",
    href: "/admin/settings/banking/guide",
    facts: [
      "Admin → Banking has three helper tabs beside the vault tabs: Guide & unblocker, Calendar & reminders, and Legal library. They are owner/admin only.",
      "Guide & unblocker: four short checklists (setup, employees, vendors, payday) with progress bars and green ticks, a button for the next step, and a list of everything that would stop a payment today with the exact fix. There is a box that explains any payroll or vendor-payment error message in plain words.",
      "If a direct deposit cannot be fixed before payday, pay that employee by paper check: Washington requires wages on payday. Leave that person's line blank in the payroll run and write a check.",
      "Calendar & reminders: the monthly bank-statement check, the quarterly Nacha rule check, yearly reviews, the Timberland agreement and the written fraud procedure. 'Mark done' records who and when. Stephen, Michael and the store are emailed when something is due, weekly while overdue. It also lists Nacha rule changes with the exact words and whether the code is already updated.",
      "Legal library: court cases and Washington laws quoted word for word from official sources, explained in plain English, with seven ways to protect the business. It is education, not legal advice.",
      "Legal library \u2192 'Your Timberland agreement' (/admin/settings/banking/library#timberland): seven sections of the ACH Origination Agreement (signed by Greenway 10/13/26, countersigned by Timberland 10/14/26), quoted word for word from a redacted copy carrying the PDF's SHA-256. The signed PDF itself is kept by Michael, not on the website.",
      "Yearly Calendar tasks added in R41 S8: re-read the Timberland agreement (section 28 lets Timberland change it by notice), re-confirm the Schedule C limits, re-confirm Greenway's company name and ID with Brenda, and the Schedule F security self-check (phone 1-800-562-8761 at once if a code may be stolen, then confirm in writing within 1 calendar day).",
      "Direct pages: Guide & unblocker is /admin/settings/banking/guide, Calendar & reminders is /admin/settings/banking/calendar, Legal library is /admin/settings/banking/library, File checker is /admin/settings/banking/checker, Sanctions screening is /admin/settings/banking/screening, Bank watch is /admin/settings/banking/bank-watch, Notice email is /admin/settings/banking/notice-email, Policies is /admin/settings/banking/policies, Bank setup & glossary is /admin/settings/banking/bank-setup, Yearly review is /admin/settings/banking/yearly-review.",
      "Yearly review (R41 S14, /admin/settings/banking/yearly-review): Nacha Fraud Monitoring Phase 2 requires written, risk-based procedures reviewed at least annually. The page shows the 12-item written fraud procedure, Greenway's risk assessment (higher risk: bank-account changes, new vendors, new employees, bank login; lower: repeat payroll and repeat vendors; very low: prenotes and account-check test credits), the yearly review record (who and when; one per year, corrections are new rows, nothing is ever changed or deleted; owner only records it) and the segregation-of-duties report (who holds owner or admin, every ACH action by person, every approval request and its outcome; owner only, because it reads the Security Log). Recording this year's review ticks the Calendar task. 'Print the packet' gives a plain-text copy.",
      "Bank watch (R41 S16, /admin/settings/banking/bank-watch): the daily watch of the Timberland Main account from the Plaid feed (finances.view, the owner). Each morning (cron /api/cron/ach-bank-watch) it syncs only the Main connection (Plaid Trial plan: calls on existing connections are not capped; it never adds or removes a connection, since a removed one still counts against the 10) and explains each money-out line by: an ACH file match from the ACH Payments report, the books, a Timberland fee amount (Schedule B), an owner known-payee rule (name as on the statement, optional dollar limit; migration 0289; retired, never deleted) or a review (owner or active admin; known, reported to bank, returned payment, fee, not ours; append-only, newest stands). Unexplained settled lines, possible returns (money in equal to a payment we sent), fee/notice gaps and feed health (status, sync age, last four vs the agreement) are emailed once per change and weekly while open. Never blocks a payment. Plaid account checks for payees are not used: each payee link would use one of the 10 Trial connections; prenotes and call-backs are used instead. Plaid Statements is not turned on (Timberland support not confirmed).",
      "Notice email (R41 S17, /admin/settings/banking/notice-email): a heads-up for ACH return and NOC notices. Brenda (Timberland, email 3, answer 9) says notices come two ways: a secure encrypted email from the Federal Reserve and the Timberland portal's Reporting tab under Electronic Documents. The Fed's guide says the email comes from encryptedmail.achedi.com, reports stay in the achedi.com portal 60 calendar days, and not to rely on the email but check the portal every day. The watch is OFF by default; only the owner turns it on (ach.act) by typing I STILL CHECK THE PORTAL. When on, once an hour (cron /api/cron/ach-notice-mail) it searches the same Google Workspace mailbox the CCRS email monitor uses (same sign-in, no new keys), including Spam and Trash, for mail from the senders set (default encryptedmail.achedi.com). Each email is stored once, encrypted (migration 0290, ach_notice_mail; needs DATA_ENCRYPTION_KEY), and Michael gets one email per new message. It never opens links or reads the notice: it shows the sender, Google's DMARC result, which sites the links go to (warning when a link is not achedi.com) and whether it was in Spam. Owner or an active admin marks each one Logged on ACH operations or Not a notice, once, with a note. Off = no Google call. Never blocks a payment. If a payroll ACH cannot go, the existing skip-and-pay-by-written-check path is used.",
      "Policies (R41 S18, /admin/settings/banking/policies): Greenway's eight written ACH policies in plain words: 1 how a payment is made (initiate, approve, send, reconcile; two people), 2 how long records are kept (Timberland agreement), 3 incident response (phone Timberland at 1-800-562-8761 at once, then confirm in writing), 4 who can touch ACH (owner and admin only; reviewed every quarter), 5 logins, the Timberland token and the encryption key (checked every year), 6 watching the account daily and monthly, 7 the computer and connection used for banking, 8 if an ACH payroll cannot go out (skip it and pay by written checks, the owner's existing practice). Each policy has a Why with the exact words of the Washington State Auditor's Office guidance or the Timberland agreement. The owner adopts them once a year (the page stores a fingerprint of the wording, so a later change asks for a re-adopt), records the quarterly access review (who holds owner or admin, active or not, last sign-in; anyone not signed in for 90 days is flagged) and the six yearly key checks. Records are dated today, owner only (ach.act), append-only (migration 0291, ach_control_records). Owner and admins can read the page. 'Print the packet' gives a plain-text copy.",
      "Bank setup & glossary (R41 S19, /admin/settings/banking/bank-setup): the checklist for the owner's meeting with Brenda at Timberland Cash Management. Questions first (testing the system with Timberland, which release code the login uses, whether Timberland offers an ACH debit block or an ACH filter, the Fed encrypted notice email), then the owner's decision (dual approval: off today, Timberland prefers it on, needs a second person with a login), then what Brenda already confirmed (limits $50,000 per transaction and $100,000 per month, credits-only unbalanced batches, no Same Day ACH, reversals by phone, Timberland also screens OFAC). Nothing is assumed: if it is not in Brenda's words or the agreement, it is a question. Print the meeting sheet at bank-setup/sheet. Below it, a 20-term ACH glossary (ODFI, RDFI, prenote, NOC, return, effective date, PPD, CCD, PAYROLL and more), each in plain words with the source's own definition.",
      "Sanctions screening (R41 S11, /admin/settings/banking/screening): every morning (13:30 UTC) the site downloads OFAC's SDN and Consolidated data files and screens every employee and vendor name (HR, W-2, legal, DBA, bank-record and authorization names) with Jaro-Winkler and Soundex as OFAC FAQ 249 describes; 85 or more is shown as a possible match. It NEVER blocks a payment (owner's rule). Possible matches are emailed to Michael; he records 'Not a match' or 'True match' with a note of what he compared (OFAC FAQ 5). A true match: do not pay, call the attorney and Timberland at 1-800-562-8761. Records are never changed or deleted. 'Screen now' runs it at once. Weak aliases and vessel/aircraft entries are not screened.",
      "File checker (R41 S9, /admin/settings/banking/checker): pick the file downloaded from ACH operations and it re-checks every Nacha record, count and total, Timberland's routing and Greenway's Company ID, credits only, PAYROLL, the deadline, the $50,000 limits, and that it is the exact released file (not uploaded or voided yet). It stores nothing. A file cannot be cancelled after Timberland receives it (section 18). 'Practice run' checks a $0 file built from the real settings.",
      "Funding (R41 S9): Timberland's agreement section 14 needs the money in the account by 9:00 am Pacific on the settlement date. The app cannot read the balance. On ACH operations the owner types the balance he saw (at least the file total; the suggestion adds the $50.00 monthly ACH Service Fee) and ticks the box; it is recorded once. An email goes out at 8:00 am Pacific on the settlement day. Return or NOC fee is $5.00 per item.",
      "Payroll files always use the Nacha-required 'PAYROLL' description on wage credits (required since March 20, 2026); vendor files say VENDOR PAY.",
      "LlamaParse's data protection agreement is a DocuSign form, not something signed in the back office. The link is on the Calendar tab, and it only matters if LlamaParse is turned on.",
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
      "Reconcile (managers, Phase 2.1, G-05): nobody types cash sales any more. Each closed drawer's Reconcile card shows the system figure built from the server's records: Opening float, Sales on this drawer (every processed sale that carries this drawer's id), Cash rounding, Employee tab (no cash), = Cash sales, Refunds paid from this drawer (voids and returns tied to it, listed), Drops to the safe, = Expected in drawer, Counted at close and Over / short. Tap Reconcile; you are recorded as the reconciler (no name box), and the server rebuilds the figure at the click. If two managers click at once only the first counts. SOP-01 \u00a74.30.",
      "Reconcile waits until (Phase 2.1): the Reconcile button stays off while the card lists a sale from this drawer still processing (wait for the register to sync), a cash refund of the day not tied to a drawer or the safe, a read that did not finish (try again in a minute), or no opening count. For an untied refund pick where its cash came from under Paid from\u2026 (a drawer of that day, or Store safe) and tap Tie refund. Check the close slips and receipts first; never guess. A refund can be tied once and never to a reconciled drawer. A sale refused by the server is not counted and is noted on the card. SOP-01 \u00a74.30 steps 3\u20134.",
      "Which drawer paid a refund (Phase 2.1): a void or a return done on the register is tied to the drawer open on that register. The back-office Returns desk asks Cash paid from (an open drawer or Store safe) and will not process until one is picked. A register with two drawers in one day no longer needs an X report to split the sales. The till summary prints the drawer's cash sales and refunds after reconcile. SOP-01 \u00a74.22, \u00a74.23, \u00a74.27; SOP-15 \u00a74.5.",
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
      "CCRS has no live API — reporting is a CSV a human uploads to the state's CCRS portal (WA.gov login).",
      "Cadence: a weekly batch (Sunday–Saturday, due the following Sunday) plus the monthly LIQ-1295.",
      "Before uploading, the system runs a DO-NOT-UPLOAD check that blocks a batch with errors, so you never submit a bad file.",
      "CCRS strain types are only Indica, Sativa, or Hybrid — friendly 'leaning' labels collapse to Hybrid on export.",
    ],
  },
  {
    id: "regulatory-watch",
    area: "compliance",
    title: "Regulatory Watch (rule-change radar)",
    tab: "CCRS",
    href: "/admin/compliance/regulatory",
    facts: [
      "Regulatory Watch tracks WSLCB rulemaking so you stay ahead of rule changes \u2014 it polls the LCB's GovDelivery bulletin feed daily and can also receive forwarded LCB newsletter emails.",
      "Each bulletin is analyzed: the AI writes a plain-English briefing, flags the rulemaking stage (CR-101 preproposal, CR-102 proposed, CR-103 adopted, emergency), pulls out WAC/RCW citations with deep links, and lists comment deadlines and effective dates.",
      "It proposes roadmap tasks when a rule change may require updating how the store or the software operates \u2014 you accept, start, finish, or dismiss each task.",
      "Reach it from the CCRS Command Center's 'Regulatory Watch' header link or via Quick Search (\u2318K / Ctrl+K).",
      "It is advisory only \u2014 it never changes settings or code by itself, and you can always comment on proposed rules at rules@lcb.wa.gov.",
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
      "Lyman → Security Log is a plain-language history of every change made across the back office, with a security review. Owner only.",
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
