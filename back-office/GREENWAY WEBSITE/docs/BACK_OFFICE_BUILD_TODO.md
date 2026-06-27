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

## SLICE 5 — Blog/newsletter CMS + site-text editor (Phase 3c)
- [ ] DB tables: `blog_posts`, `newsletter_assets`, `content_blocks`, `seo_entries`.
- [ ] Migrate existing `src/lib/blog/posts.ts` into `blog_posts`.
- [ ] Blog editor: draft/scheduled/published/archived, slug uniqueness, excerpt, author, hero image, rich text/markdown + preview, SEO fields, categories (Products/Deals/Culture/Newsletter).
- [ ] Newsletter mode: PDF upload + page images, first page as preview.
- [ ] Controlled site-text editor (content blocks by key — NOT a free-form page builder). Keys per strategy report §4.4.
- [ ] SEO editor with Google-style preview + length validation; sitemap auto-update on publish.
- [ ] **Deliverable PR + owner inspect.**

## SLICE 6 — Promotions / specials manager (Phase 4)
- [ ] DB tables: `promotions`, `promotion_targets`, `promotion_exclusions`, `promotion_audit_snapshots`.
- [ ] Migrate hardcoded `src/lib/specials/daily-deals.ts` (Mon–Sun rules + Thursday brands).
- [ ] Editors: daily-deal schedule, **Thursday brand selector** (pick 4–5 from live menu + preview affected products), category/product/clearance (50% off) targeting.
- [ ] Discount types: %, fixed, BOGO, threshold/spend, multi-item tier; start/end + recurrence; store timezone `America/Los_Angeles`.
- [ ] Conflict detection (product in multiple specials); preview affected products before publish.
- [ ] Front-end sale badges/pricing read published promotion rules; cart engine remains source of truth for exact charge.
- [ ] **Deliverable PR + owner inspect.**

## SLICE 7 — Real order management (Phase 5)
- [ ] DB tables: `orders`, `order_lines`, `order_events`.
- [ ] Server-side order creation API; DB-backed order numbers (keep `GWY-XXXXXX` format).
- [ ] Replace client `sessionStorage` order persistence; confirmation page reads order by token/id.
- [ ] Staff order dashboard: large cards, status buttons (new→acknowledged→preparing→ready→completed; cancel/no-show), search by name/phone/order#, filters, print pick-ticket.
- [ ] Email notifications (Resend) to customer + staff; optional sound alert; optional SMS later.
- [ ] Soft inventory reservation w/ expiration. **No online payment** — pickup reservation only; final price/tax/limits confirmed in store.
- [ ] **Deliverable PR + owner inspect.**

## SLICE 8 — Loyalty management (Phase 3/5 adjacent)
- [ ] DB table `loyalty_signups`; migrate from `storage/loyalty-signups.jsonl`.
- [ ] Admin queue: new signups, mark-entered-into-POS, dedupe by email/phone, consent/signature record, notes, CSV export, search/filter.
- [ ] **Deliverable PR + owner inspect.**

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
