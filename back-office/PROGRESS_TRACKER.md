# Greenway Back Office — Engagement Tracker

## Phase A: Discovery & Database Setup (Slice 0)
- [x] Clone repo + authenticate
- [x] Read strategy report, transformer, types, data models, content files
- [x] Deep-analyze PRODUCTS.xlsx + INVENTORIES.xlsx (brands, vendors, categories, strains, images)
- [x] Inspect live site + capture brand design tokens
- [x] Build "GREENWAY WEBSITE" master folder tree (vendors→brands→products)
- [x] Generate per-vendor/brand/product JSON profile templates
- [x] Generate STRAINS_MASTER.xlsx (type + descriptions + gap-fill columns)
- [x] Generate category manifests
- [x] Scaffold intake/transformer/media-library/content/exports folders
- [x] Snapshot + sort current public assets into media-library
- [x] Write master README documenting the tree
- [x] Write handoff-ready BACK_OFFICE_BUILD_TODO.md
- [x] Update BACK_OFFICE_STRATEGY_REPORT.md with new findings
- [x] Add DB schema reference + media metadata sidecar template
- [x] Package deliverables
- [x] Owner confirmed backend stack = SUPABASE → starting Slice 1
- [x] Bake "always consult roadmap/checklists" standing rule into docs

## Phase B+: Build slices (see GREENWAY WEBSITE/docs/BACK_OFFICE_BUILD_TODO.md)
### Slice 1 — Admin foundation (COMPLETE — awaiting owner Supabase setup + inspect)
- [x] Re-read roadmap + schema (standing rule)
- [x] Install Supabase + auth deps; add env keys to .env.example
- [x] Supabase schema/migrations: staff_profiles, audit_logs, media_assets, media_usages, site_settings (+RLS, triggers, storage bucket)
- [x] Supabase client utils (server + browser + admin) + env + middleware
- [x] Auth: login page (password + magic link) + protected /admin route group (noindex) + logout
- [x] Branded admin layout shell (black/green/gold/orange + script wordmark)
- [x] Sidebar nav with all module placeholders + groups + role-gated visibility
- [x] Roles + permission matrix + helpers (5 roles + permissions)
- [x] Audit-log util (service-role insert)
- [x] Dashboard skeleton with command-center cards + build-progress
- [x] User management screen (invite, role change, activate/deactivate, last-owner protection)
- [x] Audit log viewer screen
- [x] Move loyalty-signups behind auth (requirePermission) + scoped into admin shell
- [x] Suppress customer age gate on /admin routes
- [x] Soft-disable fallback (setup notice) when env missing
- [x] Supabase setup guide (docs/BACK_OFFICE_SETUP.md)
- [x] Verify full build passes (2373 pages) + deploy UI preview
- [ ] Owner: connect Supabase (follow BACK_OFFICE_SETUP.md) + inspect

### Slice 2 — POS upload/import/staged publish (COMPLETE — PR #32, stacked on Slice 1)
- [x] Re-read roadmap + schema (standing rule)
- [x] Refactor transformer → FS-free `src/lib/pos/transform.ts` (verified BYTE-IDENTICAL output)
- [x] Migration `0002`: pos_imports, pos_import_diagnostics, menu_versions, menu_items, menu_variants (+RLS, single-published index, public read of published snapshot, pos-raw bucket, atomic publish fn)
- [x] Server services: import-service (upload→transform→stage→publish), menu-version (read + diff)
- [x] `/admin/menu-imports` upload + history; `/admin/menu-imports/[id]` review (diff vs live, diagnostics, hidden items, gated publish)
- [x] Publish blocked on errors; gated on menu.publish; revalidates /menu /shop /; full audit logging
- [x] Dashboard wired to live menu/import stats; setup doc updated for migration 0002
- [x] tsc + eslint clean; production build succeeds; PR opened for owner inspect
- [ ] Owner: run migration 0002 + inspect Menu Imports screen
- [ ] (Deferred to Slice 3) Public site reads DB published snapshot; vendor alias suggestions; admin-side report downloads

- [ ] Slice 3 — Media library + Vendor/Brand DB
- [ ] Slice 4 — Product enrichment
- [ ] Slice 5 — Blog/newsletter CMS + site-text editor
- [ ] Slice 6 — Promotions manager
- [ ] Slice 7 — Real order management
- [ ] Slice 8 — Loyalty management
- [ ] Slice 9 — Reports & analytics
- [ ] Slice 10 — Future automation

## Site Content Editor Enhancements (3-slice set — ALL COMPLETE, merged to main)
Goal: make every homepage banner editable, fix the editor's edit-jump, harden the snag error, give full carousel control, and add a font picker. Drafts-only, one PR per slice.

### Slice A — Editable banner images + smart edit-jump + stale-action recovery (PR #62, merged)
- [x] New "image" content field type (ContentImageField): Media Library picker, paste URL, live thumbnail, clear
- [x] Editable image blocks: loyalty hero (desktop+mobile), "Shop by Category" + "Shop by Brand" banners (image+eyebrow+title+subtitle), wired into LoyaltySignupForm / SectionBanner (PromoGrid/HomeBrands) with data-gw-block attrs
- [x] Edit-jump fix: ContentEditorShell lifts shared page filter + preview path; ✎ Edit auto-switches page → scrolls → highlights → focuses (queued retry)
- [x] "This page hit a snag" hardening: admin error boundary detects stale Server-Action errors after a deploy and auto-reloads once (one-shot guard) + friendly "Reload page"
- [x] VALUE-ADD: unsaved-edits guard (beforeunload) + per-block dirty badges
- [x] next.config remotePatterns for Supabase Storage images; tsc/eslint/build clean

### Slice B — Staff-managed home hero carousel (PR #63, merged)
- [x] Migration 0011 home_carousel_slides (published + draft_* mirror cols, ctas jsonb, image_focus/text_align, enabled, sort_order, status; RLS staff-all + public read published+enabled)  ← OWNER: run in Supabase SQL editor
- [x] carousel-store (draft-aware getCarouselForRender + seed fallback + CRUD + reorder + lazy seed); carousel actions
- [x] Home Carousel manager (/admin/content/carousel): add (cap 6), per-slide editor (image picker + copy + layout + 2 CTAs), enable toggle, reorder ↑/↓, delete, Save draft / Publish; dirty/live/hidden badges; new nav item
- [x] Hero.tsx now DB-driven (auto-rotate, hover-pause, arrows/dots when >1); removed orphaned home.hero.* seed blocks
- [x] tsc/eslint/build clean (route compiled)
- [ ] Owner: run migration 0011, then Home Carousel → "Load starter slides" once

### Slice C — Curated font library + in-editor font picker (PR #64, merged)
- [x] fonts.ts registry: 10 Google Fonts + System default, grouped by category; fonts-loader.ts loads all via next/font/google (self-hosted, swap)
- [x] New "font" field type + ContentFontField (grouped dropdown + live preview)
- [x] site.font.heading + site.font.body blocks; layout.tsx → --font-heading/--font-body (draft-aware); globals.css applies to body + h1–h6
- [x] tsc/eslint/build clean (fonts self-hosted at build, no warnings)

OWNER TO-DO after deploy: (1) run migration 0011 in Supabase; (2) open Admin → Content → Home Carousel → "Load starter slides"; (3) the font + carousel + banner blocks seed on the next Site Content visit (default font = System, so no visual change until chosen).
