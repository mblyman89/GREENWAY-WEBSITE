# Greenway Back Office — Master Build TODO (Handoff-Ready)

> **Purpose:** A complete, self-contained execution roadmap for building the Greenway Marijuana back office. Any agent or developer can pick this up mid-stream. Tasks are grouped by phase and chunk. Mark `[x]` when complete with concrete evidence. **Never delete tasks — only check them off.**

## ⛳ STANDING PROCESS RULES (apply automatically every session — do not wait to be told)
1. **At the start of every work session/chat, re-read this file, `todo.md`, and `DATABASE_SCHEMA.md`** to re-establish exactly where the build is and what's next.
2. **Continuously consult these checklists while working** — pick the next unchecked task in the current slice, do it, then check it off with evidence.
3. **Mark `[x]` only with concrete proof** (file created, migration applied, screenshot, passing build). Never delete tasks.
4. **Confirmed decisions (locked):** Backend stack = **Supabase** (Postgres + Auth + Storage + RLS). Orders = email alerts + dashboard + printable tickets. Build all 5 roles.
5. **Work in slices**, open a PR per slice, and pause for owner inspection between slices.
6. **Always honor the cross-cutting requirements** (audit log, noindex admin, perf, POS-truth separation, compliance, mobile-first, brand identity).
7. Keep this file and `todo.md` in sync after every meaningful step.

## Project context (read first)
- **Repo:** `mblyman89/GREENWAY-WEBSITE`, branch `main`.
- **Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · Vercel.
- **Brand palette (must match in admin UI):** background `#000000`, foreground `#ffffff`, greenway green `#7ed957`, dark green `#12351f`, gold `#ffd700`, orange `#ff7f00`, charcoal `#1a1a1a`. Script logo for headers.
- **Data source of truth:** Cultivera POS exports `PRODUCTS.xlsx` (3,311 rows, master metadata) + `INVENTORIES.xlsx` (3,917 rows, live price/stock/THC). POS = truth for price/inventory; enrichment layered on top.
- **Transformer:** `scripts/pos/transform_pos_data.ts` (active) → writes `src/data/pos-menu-preview.json`, `pos-menu-sample-preview.json`, `src/data/vendors.json`. Build runs `npm run transform:pos && next build`.
- **Existing partial backend:** loyalty signup API (`src/app/api/loyalty-signup/route.ts`) appends JSONL; unprotected admin preview page at `src/app/admin/loyalty-signups`. Orders are client-side only (sessionStorage). No DB/auth yet.
- **Backend stack (LOCKED):** **Supabase** — Postgres + Auth + Storage + Row-Level Security. Admin UI stays inside the existing Next.js app under `/admin`.

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
- **Slice 10 — Future automation** (scheduled POS fetch, AI copy drafts, enrichment bots).

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
- [x] Confirm + install backend stack (Supabase client, or Neon+Drizzle/Prisma + Auth.js).
- [x] Add `.env` keys (DB URL, auth secrets, storage keys) to `.env.example`.
- [x] Create DB schema/migrations: `users`, `roles`, `audit_logs`, `media_assets`, `media_usages`, `site_settings`.
- [x] Implement auth + protected `/admin` route group (middleware; admin routes `noindex`).
- [x] Build admin layout shell matching Greenway branding (dark + green/gold/orange, script logo header).
- [x] Sidebar nav with placeholders: Dashboard, Menu Imports, Orders, Promotions, Media, Vendors & Brands, Products, Content, Blog, Loyalty, Reports, Users, Settings.
- [x] Roles & permission matrix: Owner/Admin, Manager, Content Editor, Budtender/Staff, Read-only.
- [x] Audit-log middleware/util: record actor, action, entity, before/after, timestamp.
- [x] Dashboard skeleton with command-center cards (placeholder data wired to real later).
- [x] User management screen (invite, set role, deactivate).
- [x] Migrate `admin/loyalty-signups` behind auth (stop unprotected exposure).
- [x] **Deliverable PR + owner inspect.**

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

## SLICE 3 — Media library + Vendor/Brand database (Phase 3a)
- [ ] Media upload (images/svg/pdf), thumbnails, responsive sizes, focal point.
- [ ] Metadata: alt text, title, description, source/license, usage tags, status.
- [ ] Usage tracking (`media_usages`) + "where used" before delete.
- [ ] Draft-replace + preview-before-publish for controlled image slots (hero, banners, logos).
- [ ] DB tables: `vendors`, `vendor_aliases`, `brands`, `brand_aliases`.
- [ ] Seed vendors/brands from `database/vendors/` folder DB + reconcile POS aliases (merge duplicate vendor strings → 105 canonical groups).
- [ ] Vendor/brand profile editor: logo, mission, about, contact, social, public/private fields.
- [ ] Alias-merge tool for duplicate POS vendor/brand names (capitalization/legal-name variants).
- [ ] Front end: replace 112 placeholder vendor cards with DB-driven profiles + real logos; brand logos on product cards.
- [ ] **Deliverable PR + owner inspect.**

## SLICE 4 — Product enrichment (Phase 3b)
- [ ] DB table `product_enrichments` keyed by POS product key (separate from POS truth).
- [ ] Editor: display-name override, description override, image gallery, brand/vendor link, tags (new arrival/best seller/staff pick/local/high-CBD), staff-pick + featured flags, hide-override + reason, SEO override.
- [ ] Front end merges enrichment over published menu item without touching price/stock.
- [ ] Gap dashboard: products missing image / description / brand logo / vendor profile.
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
- [x] Scheduled/auto POS fetch (if Cultivera API available) → staged import queue.
- [x] AI-assisted product description drafts (staff review/approve).
- [x] Vendor profile enrichment suggestions; image normalization/cropping; advanced analytics.

---

## Cross-cutting requirements (apply to every slice)
- [x] Every write action → audit log entry.
- [x] All `/admin` routes `noindex` + role-gated.
- [x] Preserve front-end performance: published snapshots + caching + revalidation, not all-dynamic.
- [x] Keep POS truth (price/stock) separate from marketing enrichment.
- [x] Compliance: age gate stays, compliance warnings preserved, no-payment language, disclaimers on promos, private order/loyalty data protected, data retention policy.
- [x] Accessibility + mobile-responsive admin (staff use phones/tablets at the counter).
- [x] Match Greenway visual identity in all admin UI.

## Definition of done (per slice)
1. Schema/migrations applied. 2. Feature works end-to-end with real data. 3. Audit + permissions enforced. 4. Front end (if affected) still builds + looks correct. 5. Owner inspected + signed off.
