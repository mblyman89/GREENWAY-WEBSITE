# Greenway Back Office — Master Build TODO (Handoff-Ready)

> **Purpose:** A complete, self-contained execution roadmap for building the Greenway Marijuana back office. Any agent or developer can pick this up mid-stream. Tasks are grouped by phase and chunk. Mark `[x]` when complete with concrete evidence. **Never delete tasks — only check them off.**

## Project context (read first)
- **Repo:** `mblyman89/GREENWAY-WEBSITE`, branch `main`.
- **Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · Vercel.
- **Brand palette (must match in admin UI):** background `#000000`, foreground `#ffffff`, greenway green `#7ed957`, dark green `#12351f`, gold `#ffd700`, orange `#ff7f00`, charcoal `#1a1a1a`. Script logo for headers.
- **Data source of truth:** Cultivera POS exports `PRODUCTS.xlsx` (3,311 rows, master metadata) + `INVENTORIES.xlsx` (3,917 rows, live price/stock/THC). POS = truth for price/inventory; enrichment layered on top.
- **Transformer:** `scripts/pos/transform_pos_data.ts` (active) → writes `src/data/pos-menu-preview.json`, `pos-menu-sample-preview.json`, `src/data/vendors.json`. Build runs `npm run transform:pos && next build`.
- **Existing partial backend:** loyalty signup API (`src/app/api/loyalty-signup/route.ts`) appends JSONL; unprotected admin preview page at `src/app/admin/loyalty-signups`. Orders are client-side only (sessionStorage). No DB/auth yet.
- **Decision pending from owner:** backend stack. Recommended default: **Supabase** (Postgres + Auth + Storage + RLS). Alternative: Neon + Auth.js + R2/Vercel Blob.

---

## CHUNK / SLICE PLAN (build + inspect in order)
Each "slice" is independently shippable so the owner can inspect before continuing.

- **Slice 0 — Organized folder database + docs** *(this deliverable)*
- **Slice 1 — Admin foundation:** auth, `/admin` shell, roles, audit log, nav, dashboard skeleton.
- **Slice 2 — POS upload/import/staged-publish** (the operational backbone).
- **Slice 3 — Media library** + **Vendor/Brand database** UI (consume folder DB).
- **Slice 4 — Product enrichment** (photos, descriptions, tags, staff picks).
- **Slice 5 — Blog/newsletter CMS** + **controlled site-text editor**.
- **Slice 6 — Promotions/specials manager** (daily deals + Thursday brands + clearance).
- **Slice 7 — Real order management** (server orders, status workflow, tickets, notifications).
- **Slice 8 — Loyalty management** (DB-backed queue, CSV export, dedupe).
- **Slice 9 — Reports & analytics** (import diagnostics, inventory health, orders, promos).
- **Slice 10 — Future automation** (scheduled POS fetch, enrichment bots).

> **Cross-cutting capability — AI Enrichment Engine (NEW):** AI is woven into Slices 3b/4/5 rather than deferred. Every AI output is a **draft suggestion** an employee approves before it touches the public site — same staged-publish gate as the menu. See the dedicated "AI Enrichment Engine" section below.

> **Cross-cutting capability — Smart Spreadsheet Auto-Ingest (NEW):** Extends the Slice 2 POS pipeline so employees can simply drop the raw `PRODUCTS.xlsx` / `INVENTORIES.xlsx` into a watched intake folder (or upload in admin); the system ingests, auto-detects new vendors/brands/strains as drafts, then rotates the raw files into a size-capped `backups/` folder. See the "Smart Spreadsheet Auto-Ingest" section below.

> **Cross-cutting capability — Web Intelligence Pipeline: Crawl4AI + GPT-4o (NEW, owner-requested):** A stealthy, production-grade research engine that *feeds* the AI Enrichment Engine. **Crawl4AI** (open-source, free, Python — works like Firecrawl) gathers raw web content (vendor sites, brand pages, strain databases, social posts from dummy accounts) using stealth/undetected browsing, virtual scrolling for infinite feeds, rotating residential proxies (Bright Data / Oxylabs), and injected session/JWT tokens; **GPT-4o** then structures and enriches that content into compliant **draft suggestions**. Runs as a **separate Python worker service** (NOT inside the Next.js/Vercel runtime) that writes drafts into `ai_suggestions` via the DB/API. Every output stays drafts-only behind the employee Accept/Reject gate. Slotted for **Slice 10 (Future automation)**. See the dedicated **"Web Intelligence Pipeline — Crawl4AI Expert Playbook"** section below.

---

## SLICE 0 — Organized folder database + documentation
- [x] Clone repo, read every key file, map architecture.
- [x] Analyze `PRODUCTS.xlsx` + `INVENTORIES.xlsx` (counts, brands, vendors, categories, strains, image/desc coverage).
- [x] Inspect live site + extract brand palette/design tokens.
- [x] Build `GREENWAY WEBSITE/` master folder tree (vendors→brands→products with profiles + image folders).
- [x] Generate `database/vendors/_index.json` and per-vendor/brand/product JSON profile templates.
- [x] Generate `database/strains/STRAINS_MASTER.xlsx` (+ csv) with type + descriptions + gap-fill columns.
- [x] Generate `database/categories/` website + POS category manifests.
- [x] Create `intake/`, `transformer/`, `media-library/`, `content/`, `exports/` scaffolding.
- [x] Snapshot current `/public` assets into `site-assets/` and sort into `media-library/`.
- [x] Write master `README.md` documenting the whole tree.
- [x] Write this handoff TODO + update the strategy report with new findings.
- [ ] Owner review of folder structure + confirm backend stack decision (Supabase vs other).

---

## SLICE 1 — Admin foundation (Phase 1)
- [ ] Confirm + install backend stack (Supabase client, or Neon+Drizzle/Prisma + Auth.js).
- [ ] Add `.env` keys (DB URL, auth secrets, storage keys) to `.env.example`.
- [ ] Create DB schema/migrations: `users`, `roles`, `audit_logs`, `media_assets`, `media_usages`, `site_settings`.
- [ ] Implement auth + protected `/admin` route group (middleware; admin routes `noindex`).
- [ ] Build admin layout shell matching Greenway branding (dark + green/gold/orange, script logo header).
- [ ] Sidebar nav with placeholders: Dashboard, Menu Imports, Orders, Promotions, Media, Vendors & Brands, Products, Content, Blog, Loyalty, Reports, Users, Settings.
- [ ] Roles & permission matrix: Owner/Admin, Manager, Content Editor, Budtender/Staff, Read-only.
- [ ] Audit-log middleware/util: record actor, action, entity, before/after, timestamp.
- [ ] Dashboard skeleton with command-center cards (placeholder data wired to real later).
- [ ] User management screen (invite, set role, deactivate).
- [ ] Migrate `admin/loyalty-signups` behind auth (stop unprotected exposure).
- [ ] **Deliverable PR + owner inspect.**

## SLICE 2 — POS upload / import / staged publish (Phase 2)
- [ ] Refactor `transform_pos_data.ts` into reusable library functions (`src/lib/pos/transform.ts`) callable from CLI **and** server.
- [ ] DB tables: `pos_imports`, `pos_import_diagnostics`, `menu_versions`, `menu_items`, `menu_variants`.
- [ ] Upload UI: drag-drop `PRODUCTS.xlsx` + `INVENTORIES.xlsx`; store raw to private storage w/ hash, uploader, timestamp.
- [ ] Background job runs transform → writes staged `menu_version` (status `staged`) + diagnostics.
- [ ] Import review screen: counts, warnings/errors, hidden items, category-mapping review, vendor alias suggestions.
- [ ] Diff vs previous published version: new / changed-price / removed products.
- [ ] Block publish on serious errors; manager approval → publish (status `published`).
- [ ] Front end reads published menu snapshot; trigger revalidation of `/menu` + product pages on publish.
- [ ] Import history list + downloadable reports (summary, anomaly, hidden-items xlsx).
- [ ] **Deliverable PR + owner inspect.**

## SLICE 3 — Media library + Vendor/Brand database (Phase 3a)  *(PR #33)*
- [x] Media upload (images/svg/pdf), metadata, status. *(`/admin/media`, multi-upload, sha256 keys; thumbnails via object-contain preview. Responsive sizes + focal point deferred to a polish pass.)*
- [x] Metadata: alt text, title, description, source/license, usage tags, status. *(asset detail page `/admin/media/[id]`)*
- [x] Usage tracking (`media_usages`) + "where used" before delete. *(`whereUsed` + guarded `deleteMediaAction` refuses in-use assets)*
- [x] Draft-replace + preview-before-publish for controlled image slots. *(draft/published/archived status controls + logo upload publishes on save; preview shown on detail page)*
- [x] DB tables: `vendors`, `vendor_aliases`, `brands`, `brand_aliases`. *(migration `0003_slice3_vendors_brands.sql`)*
- [~] Seed vendors/brands from folder DB + reconcile POS aliases. *(script `npm run seed:vendors` DONE & verified against folder DB: 105 vendors / 168 brands; **runs once migration 0003 is applied by owner**)*
- [x] Vendor/brand profile editor: logo, mission, about, contact, social, public/private fields. *(`/admin/vendors/[id]` + actions)*
- [ ] Alias-merge tool for duplicate POS vendor/brand names (capitalization/legal-name variants).
- [ ] Front end: replace placeholder vendor cards with DB-driven profiles + real logos; brand logos on product cards.
- [ ] **Deliverable PR + owner inspect.** *(PR #33 open; awaiting owner migration run + review)*

## SLICE 4 — Product enrichment + AI assist (Phase 3b)  *(PR pending)*
- [x] DB table `product_enrichments` keyed by POS product key (separate from POS truth). *(migration 0004; also `ai_suggestions`)*
- [x] Editor: display-name override, description override, image gallery, brand/vendor link, tags, staff-pick + featured flags, hide-override + reason, SEO override. *(`/admin/products/[key]`)*
- [x] **AI draft descriptions:** "Draft description" + "Suggest tags" per product → compliant draft from POS metadata, **Accept / Reject** in a review panel with compliance flags; never auto-published. *(`src/lib/ai/*` + product actions)*
- [~] **AI bulk enrich queue:** single-product generate done; batch grid deferred to AI Engine follow-on (single-item flow covers the need for now).
- [x] Front end merge helper (`mergeForDisplay`) for enrichment over published menu item without touching price/stock. *(public-page swap activates once a menu version is published via Slice 2 flow)*
- [x] Gap dashboard: products missing image / description / brand link. *(stat cards + gap filters on `/admin/products`)*
- [ ] **Deliverable PR + owner inspect.**

## SLICE 5 — Blog/newsletter CMS + site-text editor (Phase 3c)  *(PR pending)*
- [x] DB tables: `blog_posts`, `newsletter_assets`, `content_blocks`, `seo_entries`. *(migration `0005_slice5_cms.sql`; adds `post_status` enum; RLS staff-all + public-read-published; reuses `set_updated_at` + `is_staff()`)*
- [x] Migrate existing `src/lib/blog/posts.ts` into `blog_posts`. *(public blog now reads DB via `getPublicPosts/getPublicPost` with automatic fallback to the committed static `blogPosts` when DB is empty/unconfigured — zero-blank guarantee; no destructive migration needed)*
- [x] Blog editor: draft/scheduled/published/archived, slug uniqueness, excerpt, author, hero image, rich text/markdown + preview, SEO fields, categories (Products/Deals/Culture/Newsletter). *(`/admin/blog`, `/admin/blog/new`, `/admin/blog/[id]`; paragraph-block body; hero upload→media library; status controls; Google-style SEO preview)*
- [x] Newsletter mode: PDF upload + page images, first page as preview. *(`kind=newsletter`; `newsletter_assets` PDF upload + page paths; first page = preview on public article page)*
- [x] Controlled site-text editor (content blocks by key — NOT a free-form page builder). Keys per strategy report §4.4. *(`/admin/content`; seeded set in `content-blocks-seed.ts`: home.hero.title/subtitle, menu.hero.title/subtitle, loyalty.hero.title/subtitle, vendors.outreach.heading, specials.hero.subtitle, footer.compliance.warning, business.hours.display; draft→publish per block; `getPublishedContent()` reader with default fallback)*
- [x] SEO editor with Google-style preview + length validation; sitemap auto-update on publish. *(`/admin/content/seo`; per-path title/desc/canonical/noindex/sitemap-include; live char counters w/ 50–60 / 140–160 targets; `seo_entries` table; revalidates path on save)*
- [x] **AI woven in (per owner request):** "Draft body" + "Suggest SEO" buttons on the blog editor → compliant drafts via `src/lib/ai/`, persisted as `ai_suggestions` (entity_type `blog`), shown with compliance flags + Accept/Reject. Never auto-published. *(`src/lib/cms/ai-blog.ts` + blog actions)*
- [x] Un-hid Blog & Newsletter + Site Content nav items. *(removed `comingSoon`)*
- [ ] **Deliverable PR + owner inspect.** *(PR open; awaiting owner to run migration 0005 + review)*

## SLICE 6 — Promotions / specials manager (Phase 4)  *(PR pending)*
- [x] DB tables: `promotions`, `promotion_targets`, `promotion_exclusions`, `promotion_audit_snapshots`. *(migration `0006_slice6_promotions.sql`; adds `discount_type` + `promo_scope` enums, reuses `post_status` lifecycle + `set_updated_at` + `is_staff`; RLS staff-all + public-read-published; idempotent)*
- [x] Migrate hardcoded `src/lib/specials/daily-deals.ts` (Mon–Sun rules + Thursday brands). *(`src/lib/promotions/daily-deal-seed.ts` mirrors all 7 days + the 5 Thursday brands exactly; doubles as the public static FALLBACK so the storefront never loses its deals — non-destructive, same pattern as the blog)*
- [x] Editors: daily-deal schedule, **Thursday brand selector** (pick 4–5 from live menu + preview affected products), category/product/clearance targeting. *(`/admin/promotions/new` + `/admin/promotions/[id]`; brand picker reads distinct brands from the published menu version via `listMenuBrands()`; category checkbox grid; storewide toggle for clearance/Super-Saturday)*
- [x] Discount types: %, fixed, BOGO, threshold/spend, multi-item tier, weight tier, basket; start/end + weekly recurrence; store timezone `America/Los_Angeles`. *(`discount_type` enum + form fields; weekday OR date-window scheduling)*
- [x] Conflict detection (product in multiple specials); preview affected products before publish. *(`detectConflicts()` flags products under >1 published promo on the list page; `previewAffectedProducts()` resolves targets−exclusions against the live menu in the editor right-rail before publishing; publish writes a `promotion_audit_snapshots` row)*
- [~] Front-end sale badges/pricing read published promotion rules; cart engine remains source of truth for exact charge. *(reader `getPublishedPromotions()` + `getPublishedPromotionForWeekday()` return normalized `PublishedPromotion` rules with static fallback; wiring the existing `daily-deals.ts` consumers to read these is a thin follow-on — see note)*
- [x] Un-hide Promotions in admin nav. *(removed `comingSoon` flag)*
- [ ] **Deliverable PR + owner inspect.** *(manual step: run migration `0006_slice6_promotions.sql` in Supabase)*

> **Slice 6 follow-on (small):** the storefront currently still reads the hardcoded `src/lib/specials/daily-deals.ts`. The DB-backed reader (`getPublishedPromotions`) returns the exact same rules via fallback, so behaviour is identical today. Swapping the menu/specials/cart consumers to call the reader is a low-risk follow-on PR (keeps this slice focused on the admin + data layer, mirroring how Slice 5 shipped the blog reader then swapped consumers).

## SLICE 7 — Real order management (Phase 5)  *(PR #39)*
- [x] DB tables: `orders`, `order_lines`, `order_events` (migration `0007_slice7_orders.sql`; `order_status` enum; DB `generate_order_number()` keeps `GWY-XXXXXX`; private `public_token` for guest reads; RLS staff-all + public-insert).
- [x] Server-side order creation API (`POST /api/orders`); DB-backed order numbers; service-role `orders-store.ts`.
- [x] Replace client `sessionStorage` order persistence (CheckoutFlow now POSTs to the API, keeps sessionStorage as instant fallback); confirmation page reads order by token via `GET /api/orders/[token]` and shows live status.
- [x] Staff order dashboard (`/admin/orders`): large cards, status buttons (new→acknowledged→preparing→ready→completed; cancel/no-show), search by name/phone/order#, status filters, detail page + print pick-ticket (`/admin/orders/[id]/ticket`).
- [x] Email notifications (Resend, env-gated best-effort no-op) to customer + staff (`notify.ts`). Sound alert / SMS deferred.
- [x] Soft inventory reservation w/ 24h expiry (advisory `reservation_expires_at`). **No online payment** — pickup reservation only; final price/tax/limits confirmed in store.
- [x] Audit log on every status change + note (`order.status_changed`, `order.note_updated`); permissions `orders.view`/`orders.manage`; Orders nav un-`comingSoon`.
- [x] **Deliverable PR + owner inspect.**

> **Slice 7 owner manual step:** apply migration `0007_slice7_orders.sql` in Supabase. Until then `/admin/orders` shows a "not configured" notice and checkout falls back to the local confirmation. Optional: set `ORDER_EMAIL_FROM` + `ORDER_STAFF_EMAILS` (+ existing `RESEND_API_KEY`) to turn on order emails.

## SLICE 8 — Loyalty management (Phase 3/5 adjacent)  *(PR #40)*
- [x] DB table `loyalty_signups` (migration `0008_slice8_loyalty.sql`; `loyalty_status` + `loyalty_notify_status` enums; `phone_normalized` + `lower(email)` indexes for dedupe; `dedupe_of` self-FK; RLS staff-all + public-insert). Public write path (`signup.ts`) now writes to the DB when configured, with the JSONL append kept as a durable fallback. One-click **Import legacy file** action migrates remaining `storage/loyalty-signups.jsonl` rows (idempotent on `legacy_id`).
- [x] Admin queue (`/admin/loyalty-signups`): status tabs (new/entered/duplicate/archived/all) + counts, search (name/email/phone), **dedupe flag** ("Possible duplicate" by email/phone), mark-entered (stamps `entered_by`/`entered_at`) / duplicate / archive / reopen, consent + notification-status shown, per-row staff **notes**, and **CSV export** (`/admin/loyalty-signups/export`, honors filters). Audit log on every status/note change + import. Falls back to the JSONL reader when Supabase isn't configured.
- [x] **Deliverable PR + owner inspect.**

> **Slice 8 owner manual step:** apply migration `0008_slice8_loyalty.sql` in Supabase. Then open `/admin/loyalty-signups` and click **Import legacy file** once to bring any existing JSONL signups into the DB queue (safe to re-run). New signups flow into the queue automatically.

## SLICE 9 — Reports & analytics (Phase 6)
- [ ] Import diagnostics report; inventory health (OOS/low/zero-price/no-desc/suspicious potency).
- [ ] Category mapping report; vendor/brand completion report; product enrichment gap report.
- [ ] Price-change + new/removed products report.
- [ ] Order/sales charts (by day/week/month, AOV, items/order, top products/brands/categories, cancel/no-show, pickup time).
- [ ] Promotion performance; content/media reports (posts by status, missing SEO, missing alt text, unused assets).
- [ ] Charts (Recharts/Tremor), date filters, CSV/XLSX export, saved presets, optional scheduled email.
- [ ] **Deliverable PR + owner inspect.**

## SLICE 10 — Future automation (Phase 7)
- [ ] Scheduled/auto POS fetch (if Cultivera API available) → staged import queue.
- [ ] Smart Spreadsheet Auto-Ingest watcher + backup rotation (see dedicated section — may land earlier as a Slice 2 follow-on).
- [ ] AI Enrichment Engine background batch jobs (overnight draft generation for new products/vendors/strains; see dedicated section).
- [ ] **Web Intelligence Pipeline (Crawl4AI + GPT-4o)** — stand up the standalone Python worker service that crawls vendor/brand/strain/social sources with stealth + proxies + session injection and feeds compliant drafts into `ai_suggestions` (see dedicated "Web Intelligence Pipeline — Crawl4AI Expert Playbook" section).
- [ ] Image normalization/cropping/focal-point automation; advanced analytics.

---

## CAPABILITY — AI Enrichment Engine (cross-cutting; built across Slices 3b–5)
> **Principle:** AI drafts, humans approve. Every AI-generated field is stored as a *suggestion* with provenance (model, prompt version, timestamp, generated_by) and goes through the same employee-validated publish gate as menu data. Nothing AI writes reaches the public site without a staff Accept.

- [ ] **Provider abstraction** (`src/lib/ai/`): single `generate()` interface so the model/provider is swappable; API key in env (`AI_API_KEY`); graceful no-op when unset.
- [ ] **Compliance guardrails:** prompt templates enforce WA cannabis rules — no health/medical claims, no appeal-to-minors language, no dosing advice; include required disclaimers; profanity/claim filter on output.
- [ ] **`ai_suggestions` table:** entity_type, entity_id, field_key, suggested_value, status (pending/accepted/rejected/edited), model, prompt_version, generated_by, created_at, reviewed_by, reviewed_at. Full audit trail.
- [ ] **Product copy:** compliant description + tag suggestions from POS metadata (Slice 4).
- [ ] **Vendor/brand curation:** draft mission/about/product-philosophy from vendor name + known brands + (optional) website scrape; suggest social links; flag likely-duplicate vendor strings for the alias-merge tool.
- [ ] **Strain intelligence:** enrich `STRAINS_MASTER` — type (indica/sativa/hybrid), aroma/flavor/effect descriptors, lineage, plain-language summary; cross-reference public strain data; gap-fill missing rows. All staff-validated.
- [ ] **Image assistance:** AI alt-text generation for media library; (later) image search/normalization suggestions for products missing photos — staff picks the final image.
- [ ] **Review UX everywhere:** consistent Accept / Edit / Reject control; bulk review grids; "regenerate" with optional steering note; show provenance.
- [ ] **Cost/safety controls:** per-run limits, dry-run preview, rate limiting, no PII in prompts.
- [ ] **Data source = Web Intelligence Pipeline (Crawl4AI + GPT-4o):** the vendor/brand/strain/image research above is *fed* by the Crawl4AI worker (stealth crawling + GPT-4o structuring). All crawled output enters here as `ai_suggestions` drafts with source-URL provenance and flows through the same Accept/Edit/Reject gate. See the dedicated "Web Intelligence Pipeline — Crawl4AI Expert Playbook" section.

## CAPABILITY — Web Intelligence Pipeline: Crawl4AI Expert Playbook (feeds the AI Enrichment Engine)
> **What this is:** the owner wants a "powerhouse AI agent feedback loop." This pipeline pairs **Crawl4AI** (free, open-source Python crawler — the Firecrawl alternative) as the *gatherer* with **GPT-4o** as the *structurer/enricher*. Crawl4AI is the eyes (stealthily reads the web); GPT-4o is the brain (turns messy HTML/markdown into clean, compliant draft fields). Output is always a **draft suggestion** in `ai_suggestions` — employees Accept/Edit/Reject before anything is published.
>
> **Architecture rule (non-negotiable):** Crawl4AI is **Python** and drives a real (Playwright) browser; the Greenway site is **Next.js on Vercel**. They do NOT run in the same process. Crawl4AI runs as a **separate long-lived Python worker / microservice** (own container/VM/cron, e.g. a small Fly.io / Railway / Render box or a self-hosted runner). It talks to the app only through the database (`ai_suggestions`) or a thin authenticated internal API. Never try to `pip install crawl4ai` into the Vercel build.
>
> **The feedback loop (target design):**
> 1. **Trigger** — overnight cron, or "Research this vendor/brand/strain" button in admin enqueues a job (vendor id, brand id, strain name, or a URL/social handle) into a `research_jobs` table/queue.
> 2. **Gather (Crawl4AI)** — worker picks up the job, crawls the target with the right stealth/proxy/scroll profile, returns clean markdown + extracted media URLs.
> 3. **Structure (GPT-4o)** — either Crawl4AI's built-in `LLMExtractionStrategy(provider="openai/gpt-4o")` with a JSON schema, OR pass the markdown to our existing `src/lib/ai/` provider for the compliant-draft prompt templates (preferred, since the WA-cannabis guardrails already live there).
> 4. **Persist as drafts** — write each field as a row in `ai_suggestions` (entity_type vendor/brand/strain/product/blog, field_key, suggested_value, **provenance**: model, prompt_version, source_url, crawl_timestamp, generated_by="crawl4ai-worker").
> 5. **Human gate** — the existing Accept/Edit/Reject review UX surfaces these exactly like our other AI drafts. Nothing reaches the public site without a staff Accept.

### Install & environment
- [ ] **Install (separate Python env):** `pip install -U crawl4ai` then `crawl4ai-setup` (installs/patches Playwright Chromium). Pin a recent version — **0.6.3 had a proxy bug (GitHub #1174: `net::ERR_NO_SUPPORTED_PROXIES`)**; use a current 0.7.x+/0.9.x line. Verify with `crawl4ai-doctor`.
- [ ] **Secrets/env (worker only, never in the Next.js repo):** `OPENAI_API_KEY` (GPT-4o); proxy creds for Bright Data / Oxylabs; optional `PROXIES` env (comma-separated `ip:port:user:pass,...`) for `ProxyConfig.from_env()`.
- [ ] **Core objects to learn:** `AsyncWebCrawler`, `BrowserConfig`, `CrawlerRunConfig`, `CacheMode`, `arun()` / `arun_many()`.

### Stealth ladder — match the tool to the target's defenses
> Crawl4AI offers four escalating levels. Use the *lightest* one that works (heavier = slower) and only climb when blocked.
- [ ] **Level 1 — Base (no protection):** plain `AsyncWebCrawler()` — fastest, for open vendor/brand sites and most strain databases.
- [ ] **Level 2 — Magic Mode (light anti-bot):** `CrawlerRunConfig(magic=True, remove_overlay_elements=True, page_timeout=60000)`. One flag that auto-handles cookie/consent popups, simulates basic human-ish interaction, and removes overlays. Good first escalation.
- [ ] **Level 3 — Stealth Mode (moderate anti-bot):** `BrowserConfig(enable_stealth=True)` — applies playwright-stealth patches (masks `navigator.webdriver`, plugins, WebGL, etc.). Combine with Magic Mode for stubborn sites.
- [ ] **Level 4 — Undetected Browser (advanced anti-bot, e.g. Cloudflare/DataDome):** use the `UndetectedAdapter` with `AsyncPlaywrightCrawlerStrategy`:
  ```python
  from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig
  from crawl4ai.async_crawler_strategy import AsyncPlaywrightCrawlerStrategy
  from crawl4ai.browser_adapter import UndetectedAdapter

  adapter = UndetectedAdapter()
  strategy = AsyncPlaywrightCrawlerStrategy(browser_config=BrowserConfig(headless=True), browser_adapter=adapter)
  async with AsyncWebCrawler(crawler_strategy=strategy) as crawler:
      result = await crawler.arun("https://target", config=CrawlerRunConfig(magic=True))
  ```
- [ ] **Decision table (bake into worker logic):**

  | Site defense level | Recommended setting |
  |---|---|
  | None | Base crawler |
  | Basic | `magic=True` (Magic Mode) |
  | Moderate | `enable_stealth=True` (Stealth) |
  | Advanced | `UndetectedAdapter` |
  | Maximum | Undetected + Stealth + proxies + realistic geolocation/locale |

### Virtual Scroll — capture infinite feeds (Twitter/X, Instagram, LinkedIn, Reddit, TikTok)
> Critical for the dummy-social-account research. Sites that *replace* DOM content as you scroll (virtualized lists) only give you ~the first screen of content without this. Crawl4AI's `VirtualScrollConfig` captures **20–83× more content**.
- [ ] Configure per-platform:
  ```python
  from crawl4ai import VirtualScrollConfig, CrawlerRunConfig

  vs = VirtualScrollConfig(
      container_selector="[data-testid='primaryColumn']",  # the scrolling container
      scroll_count=30,              # how many scroll steps
      scroll_by="container_height", # or a pixel int, or "page_height"
      wait_after_scroll=1.0,        # seconds for lazy content to load
  )
  config = CrawlerRunConfig(virtual_scroll_config=vs)
  ```
- [ ] **Selector cheatsheet to start from (verify live, they drift):** X/Twitter `[data-testid='primaryColumn']`; Instagram `article` / main feed container; Reddit `.scrollerItem`/feed container; LinkedIn `.scaffold-finite-scroll`. Tune `scroll_count` + `wait_after_scroll` per target.
- [ ] **Know the difference:** Virtual Scroll = content is *replaced* (use `VirtualScrollConfig`). Infinite scroll that *appends* content can instead use a `scan_full_page`/JS scroll approach. Pick correctly or you lose data.

### Proxies — Bright Data / Oxylabs rotating residential IPs
> Hide origin IP, rotate per request, geo-target. **Prefer per-request `CrawlerRunConfig.proxy_config`** over the older `BrowserConfig.proxy_config` (per-request is the supported, flexible path).
- [ ] **Single proxy:**
  ```python
  from crawl4ai import ProxyConfig, CrawlerRunConfig
  proxy = ProxyConfig(server="http://gw.dc.brightdata.com:22225", username="USER", password="PASS")
  config = CrawlerRunConfig(proxy_config=proxy)
  ```
- [ ] **From string / env helpers:** `ProxyConfig.from_string("http://user:pass@ip:port")` (also supports `socks5://...` and the `ip:port:user:pass` shorthand); `ProxyConfig.from_env()` reads the `PROXIES` env var (`ip:port:user:pass,ip:port:user:pass,...`).
- [ ] **Rotation:** build a list of `ProxyConfig` and rotate with `RoundRobinProxyStrategy`:
  ```python
  from crawl4ai.proxy_strategy import RoundRobinProxyStrategy
  strategy = RoundRobinProxyStrategy(proxies=[p1, p2, p3])
  config = CrawlerRunConfig(proxy_rotation_strategy=strategy)
  ```
- [ ] **Bright Data / Oxylabs notes:** both expose an auth gateway host:port with username/password (Bright Data zones encode country/session in the username, e.g. `brd-customer-...-zone-...-country-us`; Oxylabs uses `customer-USER-cc-us` style). Use the gateway endpoint as `server`. Rotation can be provider-side (sticky vs rotating sessions via username flags) **or** client-side via `RoundRobinProxyStrategy`. Start with a small pool, watch for `ERR_NO_SUPPORTED_PROXIES` (version/format bug) and CAPTCHA rates.
- [ ] **Combine proxy + geolocation + locale + timezone** so the IP and the browser fingerprint agree (a US IP with `en-US` + a US timezone + US geo looks human; mismatches get flagged).

### Identity-based crawling — session / JWT injection for dummy accounts
> The owner specifically wants to inject Session IDs / JWT tokens for dummy social accounts so the crawler reads logged-in content. Two supported mechanisms:
- [ ] **A) `storage_state` (cookies + localStorage):** capture a logged-in session once, then replay it. Pass either a path to a JSON file or a dict:
  ```python
  config = CrawlerRunConfig(storage_state="x_dummy_account_state.json")
  # storage_state JSON holds cookies + localStorage origins — this is where session
  # cookies and JWTs in localStorage live, so the crawl is authenticated.
  ```
  - [ ] Generate it with `BrowserProfiler` or by exporting Playwright's `context.storage_state(path=...)` after a manual login, or via the CLI (below).
- [ ] **B) Managed Browser + persistent profile:** `BrowserConfig(use_managed_browser=True, user_data_dir="/profiles/x_dummy")` keeps a real Chrome profile (cookies/localStorage persist across runs — closest to "just stay logged in").
- [ ] **CLI profile workflow:** `crwl profiles` → create/list/use named profiles; created profiles live at `~/.crawl4ai/profiles/<name>/` with a `storage_state.json` you can point `storage_state` at. `BrowserProfiler.create_profile()` does the same programmatically (opens a window, you log in, it saves state).
- [ ] **Security/ops:** store these state files like secrets (they ARE live sessions). Encrypt at rest, scope to the worker, rotate when accounts get challenged. Keep dummy accounts plausibly human (profile pics, age, occasional activity) so they survive longer. **Compliance/ToS note for the owner:** scraping logged-in social platforms with dummy accounts can violate those platforms' Terms of Service — flag this so the owner decides scope; default the pipeline to public sources first.

### Geolocation / locale / timezone (fingerprint realism)
- [ ] ```python
  from crawl4ai import GeolocationConfig, CrawlerRunConfig
  config = CrawlerRunConfig(
      geolocation=GeolocationConfig(latitude=47.65, longitude=-122.30, accuracy=50.0),  # Seattle-ish
      locale="en-US",
      timezone_id="America/Los_Angeles",
  )
  ```
- [ ] Keep geo/locale/timezone consistent with the chosen proxy country (WA-local where it makes sense for Greenway's market).

### Extraction — GPT-4o structuring (the "brain")
- [ ] **Option A — Crawl4AI built-in LLM extraction (schema-first):**
  ```python
  from crawl4ai import LLMExtractionStrategy, LLMConfig, CrawlerRunConfig
  strat = LLMExtractionStrategy(
      llm_config=LLMConfig(provider="openai/gpt-4o", api_token="env:OPENAI_API_KEY"),
      schema=VendorProfile.model_json_schema(),   # pydantic schema -> structured JSON
      extraction_type="schema",
      instruction="Extract the brand mission, about, product categories, and social links. "
                  "WA cannabis compliance: no health/medical claims, no minor-appeal language, no dosing advice.",
  )
  config = CrawlerRunConfig(extraction_strategy=strat)
  ```
  Use a cheaper model (`openai/gpt-4o-mini`) for bulk/first-pass extraction; reserve full `gpt-4o` for the high-value enrichment writeups.
- [ ] **Option B (preferred for compliance) — hand Crawl4AI's clean markdown to our existing `src/lib/ai/` provider** so the WA-cannabis guardrail prompt templates and provenance logic are reused in ONE place. The worker calls our internal AI endpoint with the crawled markdown; the draft comes back already compliance-checked.
- [ ] **Cost controls:** chunk long pages, cap tokens, prefer `fit_markdown`/pruned content over raw HTML, batch with `arun_many()` + a `MemoryAdaptiveDispatcher`, cache with `CacheMode.ENABLED` during dev.

### Other production knobs to use
- [ ] **Robots/ethics:** `CrawlerRunConfig(check_robots_txt=True)`; throttle with delays/semaphores; identify a sane user agent; respect rate limits — be a polite crawler on public sites.
- [ ] **Media/screenshots/PDF:** `screenshot=True`, `pdf=True`, and `result.media["images"]` to harvest candidate product/brand images (which then become *draft* media-library suggestions — staff still pick the final).
- [ ] **Reliability:** retries with backoff, per-job timeouts, structured logging, dead-letter for failed jobs, idempotency by (entity, source_url).

### Build checklist (Slice 10 deliverable for this pipeline)
- [ ] Stand up the standalone Python worker repo/dir (`crawl4ai-worker/`) — its own deps, Dockerfile, README; explicitly documented as separate from the Vercel app.
- [ ] `research_jobs` table/queue + an admin "Research this {vendor|brand|strain}" button that enqueues jobs.
- [ ] Worker: stealth-ladder selector logic, proxy pool (Bright Data/Oxylabs) + round-robin, virtual-scroll profiles per social platform, `storage_state` session injection for dummy accounts, geo/locale alignment.
- [ ] GPT-4o structuring → write rows to `ai_suggestions` with full provenance (model, prompt_version, source_url, crawl_timestamp, generated_by).
- [ ] Reuse the existing Accept/Edit/Reject review UX so crawled drafts flow through the same human gate.
- [ ] Cost/safety: per-run token/proxy budgets, dry-run mode, rate limiting, no PII in prompts, encrypted session-state storage.
- [ ] Compliance review with owner on logged-in social scraping (ToS) + WA cannabis guardrails on all generated copy.
- [ ] **Deliverable PR + owner inspect.**

---

## CAPABILITY — Smart Spreadsheet Auto-Ingest + Backup Rotation (extends Slice 2 pipeline)
> **Goal:** an employee does as little as possible — drop the raw exports, click one button (or have it auto-detected), review, publish.

- [ ] **Drop-in intake:** admin upload *and* a watched intake folder (`intake/inbound/`) accept `PRODUCTS.xlsx` + `INVENTORIES.xlsx`; detect the pair, validate headers, reject malformed files with a clear message.
- [ ] **One-click ingest** reuses the Slice 2 transform → staged `menu_version` + diagnostics → employee review → publish.
- [ ] **New-entity auto-detection:** vendors/brands/strains present in the new sheet but not yet in the DB are created as **drafts** and surfaced in a "New since last import" review list (never auto-published).
- [ ] **Backup rotation:** after a successful ingest, move raw files to `intake/backups/` renamed with UTC timestamp + import id; keep the most recent **N (default 10)**; auto-delete the oldest beyond the cap.
- [ ] **Restore:** "restore from backup" lets staff re-run a prior raw export through the pipeline.
- [ ] **History + audit:** every ingest logged (who, when, file hashes, counts, backups pruned).
- [ ] **Deliverable PR + owner inspect.**

---

## Cross-cutting requirements (apply to every slice)
- [ ] Every write action → audit log entry.
- [ ] All `/admin` routes `noindex` + role-gated.
- [ ] Preserve front-end performance: published snapshots + caching + revalidation, not all-dynamic.
- [ ] Keep POS truth (price/stock) separate from marketing enrichment.
- [ ] Compliance: age gate stays, compliance warnings preserved, no-payment language, disclaimers on promos, private order/loyalty data protected, data retention policy.
- [ ] Accessibility + mobile-responsive admin (staff use phones/tablets at the counter).
- [ ] Match Greenway visual identity in all admin UI.
- [ ] **AI = drafts only.** Any AI-generated content is a suggestion with provenance and must be employee-validated (Accept/Edit/Reject) before it reaches the public site. No silent auto-publish.
- [ ] **Minimal-effort ingest.** Prefer drop-in / one-click flows; new vendors/brands/strains from fresh exports auto-queue as drafts; raw files auto-rotate into capped backups.

## Definition of done (per slice)
1. Schema/migrations applied. 2. Feature works end-to-end with real data. 3. Audit + permissions enforced. 4. Front end (if affected) still builds + looks correct. 5. Owner inspected + signed off.
