# Greenway Marijuana — Back Office Project Guide

A plain-language, comprehensive reference to **what this system is, every page it
has, and how to use it**. Written for the owner/operator and any future
teammate or engineer picking this up. Grounded in the actual code (routes,
nav map, page headers) as of this writing — not aspirational.

> **What this is.** A Wix/Squarespace-style admin back office for **Greenway
> Marijuana**, a licensed Washington State I-502 cannabis retailer in Port
> Orchard (license 413541). It runs the public website, the product/inventory
> lifecycle, compliance (CCRS + DOH), marketing, employees, medical, and store
> configuration. The in-store **Point of Sale (POS) is planned, not built yet.**

---

## 1. Orientation — how to move around

- The **top navigation** has these tabs, left to right:
  **Greenway wordmark** (click for the Dashboard home), then **Dashboard,
  Reports, CRM, Product Intake, Inventory, Website, MKTG & ADV, Employee,
  Medical, CCRS, Admin.**
- Most tabs are **dropdown menus** — hover/tap to open, then pick a page.
- **Reports** and **CCRS** are **single-click buttons** (not dropdowns):
  Reports opens the reporting hub; CCRS opens **Compliance Health**.
- **Quick Search** (bottom-left circle): press **⌘K / Ctrl+K** to jump to any page.
- **"?" button** (bottom-left): contextual help for the current page. The full
  library is **Admin → Help & FAQ**.
- **Chat bubble** (bottom-right): the **global AI concierge** — ask it anything
  about the product. It's read-only/advisory and grounded in the real feature
  knowledge base, so it won't invent pages or capabilities.

### Tab → page map (source of truth: `src/components/admin/admin-nav-data.ts`)

| Tab | Pages |
| --- | --- |
| **Dashboard** | Online Orders, Loyalty signups, Getting Started |
| **Reports** | (button) Reports hub |
| **CRM** | Customers, Loyalty Program |
| **Product Intake** | Product Discovery, CCRS Benchmarks, Catalog Hub, Purchasing, Receiving, Product Onboarding, Product Enrichment, Product Mastering, Accounts Payable, Knowledge Base |
| **Inventory** | Inventory, Other Inventory, Vendors & Brands, Types & Categories, Cycle Counts, Returns & Destruction |
| **Website** | Media Library, Site Content, Home, Menu, Loyalty, Specials, Vendors, FAQ, About, Locations, Price Match |
| **MKTG & ADV** | Marketing & Advertising, Promotions, Blog & Newsletter, Email Newsletter, Image Generator |
| **Employee** | Time Clock, Payroll, Samples, Register Activity |
| **Medical** | (button) Medical Cannabis — patient records + guided intake |
| **CCRS** | (button) Compliance Health |
| **Admin** | Users, Integrations, Equipment, Sales Limits, AI Usage, Audit Log, Settings, Help & FAQ, Menu Imports |

---

## 2. First-time setup (Getting Started)

**Dashboard → Getting Started** reads real data and turns each step green when done:

1. **Connect the database (Supabase)** — add `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and
   `ADMIN_BOOTSTRAP_EMAILS` (your email → becomes Owner). Redeploy.
2. **Run migrations** — in Supabase → SQL Editor, run every file in
   `supabase/migrations/` in number order. Re-running is safe (idempotent).
3. **Import your menu** — Admin → Menu Imports: upload POS **PRODUCTS** +
   **INVENTORIES** exports; it stages a draft version.
4. **Publish the menu** — review counts/warnings, then Publish → live on `/menu`.
   You can roll back to a prior version.
5. **Email (Resend)** — verify `greenwaymarijuana.com`, enable **Sending only**
   (leave **Receiving OFF** so it doesn't hijack your inbox), set
   `RESEND_API_KEY`. Powers invites + notifications.
6. **Invite staff** — Admin → Users; pick least-privilege roles.

**AI (optional but recommended):** set `OPENAI_API_KEY` (or `AI_API_KEY`).
Optional: `AI_MODEL` (default `gpt-4o-mini`), `AI_BASE_URL`. When unset, AI
features soft-disable (grey out) with a clear message.

---

## 3. Dashboard tab

- **Online Orders** (`/admin/orders`) — live pickup orders; acknowledge,
  prepare, complete from any device. Each order has a printable ticket.
- **Loyalty signups** (`/admin/loyalty-signups`) — review new public loyalty
  signups and add them to the customer list / POS.
- **Getting Started** (`/admin/getting-started`) — the setup checklist (§2).

---

## 4. Reports tab (`/admin/reports`)

Single-click hub. Reports include **Sales, Tax, Excise, COGS, Customers,
Employees, Loyalty, Medical, Compliance, Forecast**, plus **Accounting export**
(a balanced Sage 50 general journal — one entry per business day). Map your GL
accounts under **Settings → Accounting settings**.

---

## 5. CRM tab

- **Customers** (`/admin/customers`) — build customer & patient profiles: the
  foundation for loyalty, purchase history, and (later) register limit checks.
  Add manually or **Customers → Import** a list.
- **Loyalty Program** (`/admin/loyalty`) — points, tiers, promotions,
  redemptions. (The public loyalty page is edited under **Website → Loyalty**.)

---

## 6. Product Intake tab — the product lifecycle

Ordered top-to-bottom to mirror the real journey:

1. **Product Discovery** (`/admin/discovery`) — find products/vendors worth pursuing.
2. **CCRS Benchmarks** (`/admin/discovery/benchmarks`) — **Statewide** market
   insights from public CCRS data: statewide retail/wholesale prices, $/gram,
   brand/strain premiums, velocity, top-25 vendors, and a "your numbers vs. the
   market" over/under-paying comparison. (Distinct from the local competitor
   view under Reports → Benchmarks.)
3. **Catalog Hub** (`/admin/catalog`) — the one-stop Product Intake dashboard.
4. **Purchasing** (`/admin/purchasing`) — AI-assisted purchase orders: reorder
   suggestions, send to vendors, receive against POs. (Reorder points are set in
   Settings → Reorder points.)
5. **Receiving** (`/admin/inventory/intake`) — record inbound vendor transfers
   with WA transport-manifest details (WAC 314-55-085: driver, vehicle, plate,
   departed/arrived). Origin/transporter license auto-fills from the linked
   vendor's saved WA license number.
6. **Product Onboarding** (`/admin/inventory/drafts`) — review & approve new
   products onto the menu.
7. **Product Enrichment** (`/admin/products`) — descriptions, images, tags,
   AI-assisted copy (drafts).
8. **Product Mastering** (`/admin/products/masters`) — group the same product at
   different sizes (1g / 3.5g / 7g).
9. **Accounts Payable** (`/admin/vendor-payments`) — enter vendor bills → build
   a NACHA (CCD) ACH file for your bank. Shares bank/company settings with Payroll.
10. **Knowledge Base** (`/admin/knowledge-base`) — the single source of truth the
    AI writes from (strains, terpenes, brands, categories). Load baseline data via
    **Knowledge Base → Setup** (also **Settings → Starter data**). Strain types:
    Indica, Sativa, Hybrid + friendly "leaning hybrid" labels that collapse to
    **Hybrid** on CCRS export.

---

## 7. Inventory tab

- **Inventory** (`/admin/inventory`) — cannabis lots with COAs and traceability.
- **Other Inventory** (`/admin/inventory/noncannabis`) — glass, accessories,
  papers, devices. Tracked professionally but **not CCRS-reported**.
- **Vendors & Brands** (`/admin/vendors`) — vendor profiles (logo, mission,
  contact) + brands; save the WA license number (auto-fills receiving); publish
  to the public Vendors page.
- **Types & Categories** (`/admin/settings/types`) — rename/reorder website
  categories; catalog the POS inventory types behind them.
- **Cycle Counts** (`/admin/inventory/cycle-counts`) — periodic **blind**
  physical counts; variances post as audited "count" adjustments.
- **Returns & Destruction** (`/admin/inventory/disposition`) — vendor returns +
  compliant destruction with quarantine hold, plus sample-pricing rules.

---

## 8. Website tab

Each public page has its own safe editor (no code/page builder):
**Home, Menu, Loyalty, Specials, Vendors, FAQ, About, Locations, Price Match**.
Plus **Media Library** (logos/banners/images) and **Site Content** (approved text
blocks). **Preview mode** shows unpublished edits with a glowing badge
(bottom-right); nothing is public until you publish.

---

## 9. MKTG & ADV tab

- **Marketing & Advertising** (`/admin/marketing`) — AI strategist: enter a goal,
  get a WA-compliant strategy **draft** grounded in your real store/vendors.
  Plans are scanned against WA ad rules (health/medical/minor-appeal are
  withheld). Save to the idea notebook and triage idea → planned → done.
- **Promotions** (`/admin/promotions`) — daily deals, the Thursday brand
  selector, and clearance, all preview-before-publish.
- **Blog & Newsletter** (`/admin/blog`) — write posts/newsletters with drafts,
  scheduling, SEO, AI assist.
- **Email Newsletter** (`/admin/newsletter`) — the Send Center: email a published
  newsletter to the loyalty list; shows 90-day opens/clicks + full report link.
- **Image Generator** (`/admin/marketing/midjourney`) — build one image brief;
  copy a Midjourney prompt or generate with FLUX into the Media Library (drafts).

---

## 10. Employee tab

- **Time Clock** (`/admin/staffing`) — clock in/out, track shifts (plus employees,
  schedule builder, hour adjustments).
- **Payroll** (`/admin/payroll`) — manual-entry payroll → NACHA ACH direct-deposit
  file. Amounts in **cents**. Bank/company block configured once, shared with AP.
- **Samples** (`/admin/compliance/samples`) — trade samples tracked against WA limits.
- **Register Activity** (`/admin/registers`) — live oversight of shifts, registers,
  drawer counts, and store activity.

---

## 11. Medical tab

- **Patient Records** (`/admin/medical`) — medical recognition cards + DOH compliance.
- **Authorization Intake** (`/admin/medical/intake`) — take in a new medical
  authorization. Medical follows separate DOH rules and higher limits.

---

## 12. CCRS tab & compliance (always applies)

- **Compliance Health** (`/admin/compliance/health`) — one-glance "am I safe?":
  every compliance gate checked live (CCRS batch readiness, sales limits,
  manifests). Check it before submitting a batch.
- **CCRS reporting** — **no live API**; it's a **CSV a human uploads** to the
  state's SAW/CCRS portal. Cadence: weekly batch (Sun–Sat, due the following
  Sunday) + monthly **LIQ-1295**. A **DO-NOT-UPLOAD** check blocks bad batches.
  CCRS strain types = Indica / Sativa / Hybrid only.
- **WA advertising & DOH rules:** no health/medical/therapeutic/curative claims
  anywhere; nothing appealing to minors; no alcohol/tobacco association; 21+ only.
  AI tools enforce these and refuse prohibited output.

---

## 13. Admin tab

- **Users** (`/admin/users`) — invite by email; roles: Owner/Manager,
  Content/Editor, Read-only. Last owner protected from lockout. Least-privilege.
- **Integrations** (`/admin/integrations`) — Leafly/WeedMaps menu syndication,
  accounting export, service status. Menu pushes are draft/preview-safe until
  confirmed. Includes a step-by-step setup helper chat.
- **Equipment** (`/admin/equipment`) — one home for all store hardware
  (integrated devices with live online/offline badge, POS, scales, safes,
  cameras). **Receipt Printer** is a tab here: setup guide, live diagnostics,
  connection + token rotation, test print, AI diagnostic assistant, recent jobs.
- **Sales Limits** (`/admin/compliance/sales-limits`) — WA single-transaction
  limits (WAC 314-55-095) enforced at checkout.
- **AI Usage** (`/admin/ai-usage`) — how much AI is used and where (last 30 days).
- **Audit Log** (`/admin/audit`) — plain-language history of every change.
- **Settings** (`/admin/settings`) — the configuration hub (see §14).
- **Help & FAQ** (`/admin/help`) — plain-language answers for everything.
- **Menu Imports** (`/admin/menu-imports`) — POS export → staged menu → publish;
  rollback supported.

---

## 14. Settings hub (`/admin/settings`)

Grouped cards, each linking to a configurable surface:

- **Store** — Store profile (name/contact/address/hours), Tax settings
  (excise + sales rates, cannabis categories), Pricing settings (min markup +
  rounding). *(These three show live status on the card.)*
- **Catalog & inventory** — Types & categories, Reorder points, Starter data.
- **Compliance** — Sales limits, Compliance health.
- **Money & accounting** — Accounting settings (GL mapping + Sage 50), AI usage & cost.
- **Equipment & integrations** — Equipment (hardware hub), Receipt printer, Integrations.
- **Team & security** — Users & roles, Activity log, Security & passkeys (Face/Touch ID).
- **Data & lifecycle** — **Reset operational data** (clears test sales, inventory,
  imported products, customers & loyalty signups; **keeps** settings + knowledge base).

---

## 15. AI in the product

- All AI is **drafts-only**, grounded in your real data, and passes a
  **compliance scan** before showing.
- Assistants live in: **Marketing** (strategy), **Image Generator**, **Blog &
  Newsletter**, **Purchasing**, **Reports → COGS**, **Integrations**, the
  **Receipt Printer diagnostics**, and the **global concierge** (bottom-right bubble).
- **Provider:** OpenAI-compatible; key = `AI_API_KEY` or `OPENAI_API_KEY`
  (`src/lib/ai/provider.ts`). Model default `gpt-4o-mini`. Usage logged to the
  `ai_usage` ledger → **Admin → AI Usage**.
- **Concierge grounding** lives in `src/lib/admin/concierge-kb.ts` (feature KB)
  + `SETUP_GUIDE` in `src/lib/admin/setup-status.ts`. **Keep the KB current when
  pages move/rename** so the concierge stays accurate.

---

## 16. Planned — Point of Sale (NOT built yet)

- The in-store **POS is planned**, back-office enhancements come first.
- Direction: a **Capacitor iPad app** reusing the same compliance logic, working
  offline, driving the hardware.
- Planned hardware: **Star TSP143IIIBi** receipt printer, **Socket DuraScan
  D760** scanner, **iPad Pro 12.9"**, cash drawer opened by the printer on sale.
- **Cash-only today**; a provider-agnostic card pipeline is planned for when
  cannabis card payments are allowed.

---

## 17. Engineering notes (for future maintainers)

- **Stack:** Next.js (App Router, Turbopack), React 19, TypeScript, Tailwind v4,
  Supabase, Vercel.
- **Money:** always stored/handled in **minor units (cents)**.
- **Migrations:** applied **manually** by the owner in Supabase; keep **idempotent**.
- **Branching:** `main` is branch-protected → branch + PR + squash-merge only.
- **Nav is data-driven:** edit `src/components/admin/admin-nav-data.ts`
  (`adminNav` items + `navGroups` order). Direct-link tabs (Reports, CCRS) are set
  in `AdminTopNav.tsx` via `DIRECT_LINK_GROUPS`.
- **AI output is drafts-only.** Never guess. Ground everything in verified fact.
- **Compliance first:** always satisfy CCRS + DOH.
