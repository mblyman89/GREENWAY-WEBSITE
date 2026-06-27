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
