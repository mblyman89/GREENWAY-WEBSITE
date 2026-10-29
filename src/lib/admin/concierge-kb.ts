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
      "Receiving \u2192 COAs and lab results (Phase 3.1a; owner: \"didn't or couldn't attach the coa lab results to the products in the receiving detail page\"): when a manifest email arrives at vendor_intake@, every lab PDF in it (QA_1.pdf, QA_2.pdf, Lab Results, COA Summary, or any PDF that reads like a certificate) is split into its single certificates and each is matched to a line \u2014 first by a lab or batch id the line carries, then by a product name only that one certificate prints. A line that already has a lab result from the vendor's transfer file is never changed. The app never guesses: a line two certificates could fit is left for a person, and a word that only names a kind of product (flower, pre-roll, rosin, 10pk) never counts. What happened is one sentence in the email result and a timeline event on the delivery: \"Lab results attached from the emailed COAs\" (done) or \"Lab results \u00b7 some lines still need a COA (or a name match to verify)\" (look at it); a lab PDF that cannot be read is named. Each PDF is filed only under the lab results read from it. SOP-04 \u00a74.4, \u00a74.15.",
      "Receiving \u2192 the COA column on a delivery: \u2705 matched by lab id (safe); \u2705 matched by name \u2014 verify (gold: open the certificate and check the sample name and lot before Finalize); \u2705 attached by hand; \u2705 (came with the vendor's transfer file); a Choose its certificate\u2026 / Attach lab result box (no lab result yet, and this delivery's lab documents hold certificates); \u2014 (nothing on file). While lines have no lab result a row above the table offers Re-read COAs from this delivery's documents: it reads every lab PDF on file again (with the document reader) and attaches what matches; it never changes a line that has a lab result. Attach lab result (manager): pick the certificate (it reads lab id \u00b7 sample name \u00b7 THC \u00b7 PASS/FAIL), check the name against the line, press Attach lab result; a pick is refused if the documents now read differently (reload and choose again) or the line already has a lab result. Both are audited (manifest.coa_reread, inventory_lot.coa_linked) and on the delivery timeline. A line still with no lab result is held in quarantine at Finalize. SOP-04 \u00a74.6, \u00a74.15, \u00a75.2.",
      "Receiving \u2192 Count short (Phase 3.1; owner: \"receiving: accept '18 of 20'\" and \"we need a way to accept less than what came in\"): when fewer units arrive than a line says (for example 18 of 20), recount with a second person, then press Count short on the line (manager), type what you counted, pick why the rest was refused (Short shipment, Damaged / broke in transit, Wrong product, Failed COA / quality, Expired / short-dated, or Other with a reason) and press Save count. The line says Accepting 18 of 20 and the Qty column 18 of 20 / 2 refused; the 2 go back with the driver and the vendor Updates their CCRS manifest to 18; Greenway files nothing for them. At Finalize the lot goes in at 18, the delivery is Partially Accepted (write the why-partial note) and the timeline says Received short; the weekly CCRS transfer, Inventory.csv and the vendor bill all use 18. Counted 0 refuses the whole line. More than the manifest can never be received: refuse the line as Overage. Wrong count: press Recount (typing the manifest quantity removes the short count); reject instead puts the manifest quantity back. Only before Finalize: never accept 20 and adjust later. If Count short is missing, migration 0319 is not applied yet: refuse the whole short line and have the vendor re-send. SOP-04 \u00a74.11.",
      "Receiving \u2192 a line did not save (Phase 3.2b; owner: \"Add value if you can\"): if a line of the vendor's manifest could not be saved when the manifest was staged, the delivery shows a red banner (\"N line(s) from the vendor's manifest did not save, so they are not on this screen\") naming each line, the timeline shows Staging \u00b7 line(s) did not save, and the email row and batch import result say it. The missing line cannot be received from the screen. Tell the manager, who decides: the missing lines go back with the driver (tick The missing lines go back with the driver next to the Finalize button; the delivery becomes partial and needs the note), or refuse the whole delivery and call the owner. Without the tick Finalize changes nothing (Not finalized). Also: when some lines are marked and others are not, the sticky bar says how many were not marked one by one (they are accepted because they were not rejected) and the Finalize timeline counts them. Always compare the lines on screen with the vendor's paper on form 8.1. SOP-04 \u00a74.6, \u00a74.17.",
      "Receiving \u2192 GrowFlow emails and duplicate rows (Phase 3.3; owner: \"in the future, these emails with the manifests and invoices will be sent directly to the vendor_intake@ address rather than me forwarding them ... i think it would be worth adding a button to dismiss duplicate manifests that somehow make it to the table\"): vendors may email the manifest, invoice, QA results and transfer log straight to vendor_intake@greenwaymarijuana.com; nobody needs to forward them. A GrowFlow QA Results PDF (one table, one row per lot with THC, CBD and total) is read line by line by Child ID, so every line it lists gets its lab result at staging, and Re-read COAs from this delivery's documents attaches the rest the same way. The GrowFlow invoice fills in the unit prices. A second copy of the same delivery (the same vendor and the same invoice #, or the same vendor and the same lots, under another manifest number) is not staged again; if one is already on the table, the delivery page offers Dismiss duplicate (manager) as a second copy of the same delivery, and the dismiss is refused if the kept row is not a real twin. Words like Manifest ID are never taken as the vendor's name. The dismiss for siblings needs migration 0321_inbound_sibling_dismiss.sql applied. SOP-04 \u00a74.4, \u00a74.7a, \u00a74.15.",
      "Receiving \u2192 Needs attention (Phase 3.2a; owner: \"I need a way to ask the system to grab the ones it missed or failed to get ... I want this table to receive every manifest, no exceptions\"): every manifest comes by email to vendor_intake@. The system checks that mailbox (Gmail, Spam and Trash included, and Resend's copy) every 15 minutes and pulls in any email the instant delivery missed; nothing is ever staged twice. An email that still did not make a manifest is listed on the Incoming (email) tab under Needs attention (a red \"did not make a manifest\" line shows on every Receiving tab): Could not read / Fetch failed / Stuck are fetched again by themselves (5 min, 30 min, 2 h, 6 h) and Try again does it now; No manifest found needs a look in the mailbox, then Try again or Resolved with a reason (audited). Can see an email in the mailbox but not on the table? Find an email \u2192 type the sender, a subject word or the manifest number \u2192 Find and pull in. Check the mailbox now runs the check at once. A person is alerted once per email that needs one, and once if the check fails for an hour. Manager only (inventory.manage). Needs database update 0320 for Try again, Resolved, retries and alerts (SOP-04 \u00a74.4a\u2013c).",
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
      "Tip Tracker (Phase 2.1c): Employee \u2192 Tip Tracker (/admin/staffing/tips). Everyone with a time clock sees their own tips; managers see everyone. Pick From and To (up to 366 days) and tap Show: Total tips, Average per close, Closes not recorded, Best day of the week; By employee (total, closes, average, highest, hours worked from the time clock, per hour); By day of the week; every session. Print or Download CSV.",
      "Where tips come from: the Tips (counted separately) box at drawer close (iPad or back-office close). Tips never enter the drawer count or over/short. A blank box is Not recorded, which is different from $0.00 (an empty jar was counted). The tips of a drawer go to the employee who CLOSED it; the app never splits tips, so if two people shared a drawer settle it by hand and have a manager correct the figure.",
      "Correcting a tip figure (managers): in the session's Correct column type the amount (blank = not recorded) and a reason (5-300 characters), then Save. An open drawer is refused. If someone changed it since the page loaded, nothing changes: reload and try again. Every correction is logged with old and new amounts and the reason. If the page says your sign-in is not linked to an employee record, ask a manager to link it. SOP-01 \u00a74.36.",
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
      "Second count at close (Phase 2.2, G-01, owner rule D2: close only, any second employee): closing a drawer is two steps. The closer counts, enters tips and their PIN and taps Next: second count; then any other employee counts the drawer blind (the closer's count is hidden), types their own PIN and taps Record blind count & close. The server refuses the closer's own PIN. Count-in has no second count. SOP-01 \u00a74.27 steps 8\u201311.",
      "If the two counts differ (Phase 2.2) it is a warning only: the drawer still closes, both counts and both names are saved, and over / short uses the closer's count. The register says WARNING: the second count by <name> differs by $X; the manager sees both counts on the Reconcile card and in the till history. A back-office close (for example the Manager Till) needs Counted by plus a Second count and the second person's PIN. An iPad on an older app build cannot close until the app is updated; use the browser register or the back office meanwhile. SOP-01 \u00a74.27 step 12, \u00a74.30.",
      "Over / short reason (Phase 2.3, G-03, owner rules D7 and D21): when a drawer at Reconcile, or the master till at a Store safe count, is more than $5.00 over or short, a written reason is required; the server checks its own figure and refuses a blank reason (nothing saved). At $5.00 or less the reason is optional. A warning never blocks: the drawer still reconciles and the count still saves. The master till count also needs the counter's PIN (the employee who counted). SOP-01 \u00a74.30 step 6; SOP-02 \u00a74.5, \u00a74.8.",
      "Master till count (Phase 2.7a, G-08, G-09, G-13; owner D11, D15): any back-office login can open Register Activity \u2192 Safe and record the count; the employee who counted types their own PIN in Counted by: your PIN (required), checked on the server against active employees (wrong PINs lock the pad for a short time; nothing is saved). The standard is 32 \u00d7 $10, 64 \u00d7 $5, 318 \u00d7 $1, 95 \u00d7 25\u00a2, 120 \u00d7 10\u00a2, 100 \u00d7 5\u00a2, 125 \u00d7 1\u00a2 = $1,000.00; the grid shows Standard and Diff under every box, and Mix on standard / Mix off apart from Balanced / Over / Short. The window starts on the next count due (AM, then PM, then Extra). Managers see Count history for any days (From / To), a printable master till sheet with signature lines, and CSV / Excel export; the end-of-day report says mix on standard yes or no. Drops and takings are never master till money. SOP-02 \u00a74.2, \u00a74.5, \u00a74.9, \u00a74.16, \u00a74.18.",
      "Little safe exchange (Phase 2.7b, G-02, owner D3): when the master till is balanced with the little safe, record it on Register Activity \u2192 Safe \u2192 Little safe exchange: the big bills OUT of the master till into the little safe and the small bills and coin IN from the little safe, by denomination; the two sides must be the same value (Record exchange stays greyed out until they are); the employee who did it types their own PIN in Done by. Any employee may record one; managers see the Little safe exchanges log, and the printable master till sheet and the CSV / Excel export list them. There is no little-safe balance (D3). If the page says the log is not set up yet, migration 0317 has not been run: use paper form 8.2 and tell the owner. The register Change swap now asks for the bills both ways: Big bills to the safe (from this till) and Change back (from the master till), each equal to the swap; an iPad app built before Phase 2.7b saves the value only, so fill in form 8.3 and ask the owner to rebuild the iPad app. SOP-02 \u00a74.10, \u00a74.11; SOP-01 \u00a74.26.",
      "Supply runs (Phase 2.7c, G-11, owner D17): the store rule is still the shop card. If cash must be taken from the master till for supplies, use Register Activity \u2192 Supply runs (/admin/registers/supply-runs) \u2192 Cash out of the master till (two PINs): the amount (up to $1,000.00), why the shop card was not used (required), the PIN of the person taking it, and a manager or lead PIN that is not the taker; press Record cash out. The books show it as money owed back by that person (12100 Employee Advances), not as an expense. When they return, a different employee counts the change and settles the open run: Receipt total, Change handed back (receipt + change must equal the cash taken), What the receipt was for (Packaging & Store Supplies, Office Supplies, Janitorial, Repairs & Maintenance, Fuel, or Postage outbound), their PIN, Settle. A receipt bigger than the cash taken is refused (money owed to the employee: give it to the owner). The master till counts short by every open run; the Store safe page says how much. NOT POSTED means press Post to the books. Needs migration 0318; form 8.4 is the paper backup (SOP-02 4.13).",
      "Over / Short Warnings (Phase 2.3, owner and admin only): Employee \u2192 Over / Short Warnings, or the Over / short warnings button on Register Activity, lists every drawer and master till count more than $5.00 over or short: when, what, who counted, who signed off, how much and the reason, with a link to the till summary or the Store safe page. Pick 7, 30, 90 or 365 days and print. Managers do not see this screen. SOP-01 \u00a74.30; SOP-02 \u00a72.",
      "Cash drops in the books (Phase 2.4, G-12): when a drawer is reconciled, the close entry books the takings AND the drops made during the shift to 10100 (the safe) and relieves 10110 Tills by the same, less any over or short (to 50920). The line reads \"Cash from Register 1 to safe (incl. $200.00 dropped during the shift)\". Staff do nothing differently. Drawers reconciled before this fix posted without their drops and are not re-posted. SOP-02 \u00a74.12.",
      "Clearing a bank deposit (Phase 2.5, G-14, owner only, D25): Books \u2192 Bank, section \"Clear store cash deposits against the sealed bags\", press Clear against bags on a money-in line of the Main operating account (last 60 days). It moves the cash from 10400 Undeposited Funds to 10200 Bank \u2014 Operating, oldest business day first; pressing twice writes nothing twice. Never clear a transfer between your own accounts, an ATM settlement or money you put in yourself. Only bags sealed on the Deposit bags screen (Phase 2.6) are in 10400; with none waiting the press is refused with \"Nothing is sitting in Undeposited Funds\" and nothing is written. The EOD panel's green box means every sealed bag in the books was matched; unsealed cash in the safe is not counted there. SOP-03 \u00a74.13, \u00a74.15.",
      "Refunds in the books (Phase 2.8, G-48, owner only): Books \u2192 Waiting to be posted \u2192 Refunds for a day. Pick the Business day (it starts on yesterday; today is refused because it is not over) and press Draft refunds. It writes ONE draft for every void and customer return of that day: debit 50910 Returns & Refunds with the pre-tax amount, debit 32000 excise and 32100 sales tax with the tax handed back (the same split as the sale, so accessories give back no excise), credit 10110 for refunds paid from a drawer and 10100 for refunds paid from the safe. It is a draft: check it in the list and press Post. Pressing it twice writes nothing twice. If any refund of the day is not tied to a drawer or the safe, nothing is drafted: tie it on the drawer's Reconcile card (Paid from\u2026, Tie refund) and press again. If it says an entry already exists with different figures, a refund was added after the draft: tell the developer if it is still a draft, or write the difference as a journal entry if it is posted. Cost of returned units (Phase 2.8b): the same press also drafts a second entry, Cost of returned units (refunds:<day>#cogs): debit inventory (2xxxx) and credit cost of goods sold (6xxxx) per category. A void reverses the sale's own cost entry line for line; a restocked return uses the lot's unit cost times the units returned; a destroyed return keeps its cost in cost of goods sold (destroying stock posts nothing, so putting the cost back would overstate inventory). If a cost is unknown, only the cost draft is refused and the page says why; the money draft still goes through. Fix the lot's unit cost and press again. Post both drafts. Excise: Box 1 on the excise screen is now cannabis sales less the month's customer returns (pre-tax, by the day the cash went back), shown under How Box 1 is made; do not file if it warns that Box 1 is NOT net of returns. SOP-15 \u00a74.24.",
      "Deposit bags (Phase 2.6, G-04; owner rules D23\u2013D27): Register Activity \u2192 Deposit bags. NIGHT: one person counts the day's deposit (drops plus each closed drawer's count minus its float; the screen works out the expected figure) by denomination, types the pre-printed Bag #, their PIN, and taps Save night count; the bag stays UNSEALED in the safe overnight. One day, one bag. MORNING: a DIFFERENT employee recounts without seeing last night's figure and taps Save recount with their own PIN; the night closer's PIN is refused. If the counts differ by more than $5.00 a reason is required; both counts are kept. SEAL: anyone taps Seal bag with their PIN; it posts 10400 Undeposited Funds up, 10100 Vault down, on the bag's business day. If it says NOT POSTED, tap Post to the books (never books twice). BANK: only the owner records the bank run (tick every sealed bag; a bag left behind needs a note). The bag log prints and downloads as CSV. SOP-03 \u00a74.5, \u00a74.10, \u00a74.11, \u00a74.13.",
      "A bag counted at night but not recounted (Phase 2.6, owner rule D27: warning only): Register Activity shows a gold warning naming the bag and the button reads Deposit bags (N to recount). It never blocks a till close or anything else; a different employee should recount it as soon as possible. A sealed bag cannot be changed or deleted. If the screen says Deposit bag screen not set up yet, migration 0316 is not applied: use the paper night sheet and bag log. SOP-03 \u00a74.6, \u00a75.",
      "Cashier shift report (Phase 2.1b, G-05, managers): Register Activity \u2192 Cashier shift report (/admin/registers/cashiers). Pick From and To (up to 31 days) and tap Show. A summary table lists each cashier (Shifts, Sales, Gross, Cash, Discounts, No-sales, Adjustments, Voids, Returns, Net) and a Store row; then one section per cashier, each shift (one cashier on one business day) with sales, gross, pre-tax and tax, average sale, cash, tab, other tender, rounding, medical, registers, discounts split into deals and sale prices, manager overrides, loyalty, special programs and medical exempt (they add up to the total), no-sales with reason and approver, cart adjustments, voids and returns of their sales, net after refunds. Voids and returns count against the cashier who rang the sale, on the refund day; online-order refunds are listed apart. Print (sign-off line, one cashier per page) or Download CSV. If it says the report is incomplete, do not file it: reload; the CSV refuses until it loads. SOP-01 \u00a74.35.",
      "Register Activity buttons (Phase 2.9): the buttons along the top now sit in their own row under the title and wrap onto as many lines as needed, so none is cut off: End-of-day report, Cashier shift report, Cash drawer reports, Over / short warnings, Exceptions, Returns desk, Safe, Deposit bags, Supply runs, Tip tracker, POS devices, Receipt design, Cash rounding, Scan-required mode. SOP-01 \u00a74.37.",
      "End-of-day report (Phase 2.6b, G-15; the owner's end-of-day sheet): Register Activity \u2192 End-of-day report. Pick another day in Business day and tap Show day; a bad date shows an error, never today. Deposit: what goes in the bag lists each till's closing count minus float plus drops and the Expected deposit. Cash check (refunds taken off): cash sales with rounding minus voids and counter returns paid from drawers = Net cash from sales; Expected deposit minus net cash should match the drawers' total over/short. Gross sales is NOT the cash. Refunds paid from the safe are listed, not taken off. The day's bag shows by denomination; the night figure says hidden until the morning recount until a different employee saves the recount. Two signature lines: the night closer, then the morning recounter. If it says This report may be incomplete. Do not file it., a record failed to read: reload, and export stays off. Export: CSV or Excel (six sheets). The master till sheet export is still to come (Phase 2.7). SOP-03 \u00a74.8, \u00a74.9.",
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
