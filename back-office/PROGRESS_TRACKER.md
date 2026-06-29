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

---

## PAGE BUILDER VISION (see ROADMAP_PAGE_BUILDER_VISION.md)

### Slice 1 — 3 bug fixes (PR #65, merged) — migration 0012 applied by owner
- [x] Media thumbnails: media bucket flipped public + private media-private bucket
- [x] Homepage Sunday grey cards: HomeDailyDeals fallback pool when no discount
- [x] Content publish reliability: revalidatePath('/', 'layout') safety net

### Slice 2 — page_sections foundation + Home 2-tab + Pages nav (PR #66, merged) — migration 0013 applied by owner
- [x] Migration 0013 page_sections (gold-standard carousel pattern, cap 4, RLS)
- [x] Generic SectionCard banner editor + page-sections-store + per-page actions
- [x] /admin/pages/[slug] builder; Home gets Carousel | Sections tabs
- [x] Pages nav group (Home..Price Match); Home Carousel → redirect to new page

### Slice 3 — hotfixes + home banner wiring (PR #67, merged) — NO migration
- [x] FIX: section save/publish silently failed — SectionCard forms were missing
      the required page_slug hidden input (actions bounced to /admin/content).
      Added page_slug to save/publish/delete/move forms.
- [x] FIX: Sections tab broken banner image — seed used non-existent /brand/*.png;
      corrected to /home/category-banner.webp + /home/brand-banner.webp; added
      idempotent healLegacySeedImages() to self-heal already-seeded rows.
- [x] FIX: Media Library upload "gone" — long Pages group pushed Content group
      below the fold; moved Content group above Pages.
- [x] Home Category + Brand banners now driven by getSectionsForRender('home')
      with content_blocks + hardcoded fallbacks (live look preserved).
- [x] tsc / eslint / next build all clean.
- OWNER ACTION: none (no new migration). Already-seeded rows auto-correct on next
  /admin/pages/home visit.

### Slice A — AI activation (PR #72, merged) — NO migration
- [x] provider.ts accepts OPENAI_API_KEY/OPENAI_BASE_URL/OPENAI_MODEL as fallback for AI_*.
- [x] .env.example documents either key works; default model gpt-4o-mini.
- OWNER ACTION: ensure OPENAI_API_KEY set on Vercel + redeploy; AI buttons appear automatically (confirm via Admin → AI Usage).

### Slice B — Newsletter unsubscribe / CAN-SPAM (PR #73, merged) — migration 0017 (apply manually)
- [x] Migration 0017 loyalty_signups.email_opt_out + unsubscribe_token (uuid) + unsubscribed_at + unique index + backfill.
- [x] signups-store: unsubscribeByToken() idempotent.
- [x] newsletter-send-store: recipients carry token, exclude opt-outs, per-recipient unsubscribe link in email footer.
- [x] Public /unsubscribe route (branded, noindex, force-dynamic).
- OWNER ACTION: apply migration 0017.

### Slice C — editable footer hours image + footer-only Site Content (PR #74, merged) — NO migration
- [x] footer.hours.image content block (image field_type); Footer HoursImage resolves it (draft-aware) with bundled-asset fallback.
- [x] Site Content page scoped to footer-only (hours image, hours line, compliance warning); nav + title renamed "Footer Content".
- [x] Lazy idempotent top-up seed so the new block appears automatically (no owner re-run needed).
- OWNER ACTION: none (lazy-seeds on next visit to Footer Content).

### Slice 3b — per-page banner seeding/wiring (ON HOLD — needs owner decision)
- Finding: every target page's hero (menu, loyalty, specials, vendors, faq) is ALREADY
  fully editable today via content blocks (title/subtitle/image, draft-aware). Home's
  Category/Brand banners use page_sections.
- Each non-home hero is BESPOKE markup (not the shared SectionBanner). Migrating them
  into the page_sections builder would change the live visual layout of 7 customer-facing
  pages — high risk, low incremental benefit. This is why it was deferred.
- Awaiting owner: (A) leave heroes on content blocks (recommended — already editable),
  or (B) rebuild each bespoke hero as a SectionBanner so they're add/reorder/CTA-capable
  in the Pages builder (accepts minor visual normalization per page).

### Slice 4 — Blog & Newsletter polish (PR #68, merged) — migration 0014 (apply manually)
- [x] formatBlogDate(): full-month-name "Month D, YYYY"; TZ-safe ISO parse; expands legacy abbreviated labels.
- [x] Editable blog title typography (font/size/color) — title-style.ts + editor "Title styling" panel; applied on card + hero.
- [x] Newsletter cards: "Read Article" opens uploaded PDF in new tab when present.
- [x] Migration 0014 blog_posts.title_font/title_size/title_color (+ size check constraint).
- [x] tsc / eslint / build clean.
- OWNER ACTION: apply migration 0014.

### Slice 5 — FAQ Q&A manager (PR #69, merged) — migration 0015 (apply manually)
- [x] Migration 0015 faq_items (published+draft mirror cols, enabled/draft_enabled, status, locked, set_updated_at, RLS staff-all + public read).
- [x] faq-store: draft-aware CRUD, getFaqForRender, ensureFaqSeeded (imports current static FAQ as starter).
- [x] FAQ admin page: Banners | Questions & Answers tab system; QandaTab + FaqItemCard (add/load-starter, reorder, delete, save draft, publish gated until saved).
- [x] Public /faq reads DB items (draft-aware) with static fallback; FaqContent accepts items prop; feeds FAQ JSON-LD too.
- [x] tsc / eslint / build clean.
- OWNER ACTION: apply migration 0015.

### Slice 6 — Media library upgrade (PR #70, merged) — NO migration (reused existing columns)
- [x] Smart metadata model (taxonomy.ts): WHAT=title/description, WHY=canonical purpose (usage_type), WHERE=placement tags (tags) + "Where used".
- [x] Canonical MEDIA_PURPOSES dropdown everywhere (upload, edit, filter) — replaces fragmented free-text usage_type.
- [x] Placement tag convention + normalizeTags() (kebab-case, de-dupe, cap 12); datalist suggestions.
- [x] Advisory guardrails (checkMediaMeta): live warnings for missing title/purpose/alt, filename-as-title, WEBP tip, tag convention. Never hard-blocks.
- [x] Dependency-free image dimension probe (PNG/JPEG/GIF/WEBP) on upload → width/height stored; verified vs `file`.
- [x] AI auto-fetch extended: suggestMediaMetaAction (title+description via vision/context) + existing alt suggest, wired into new MediaMetaEditor.
- [x] Thumbnail fix confirmed (public bucket from Slice 1 PR #65); detail page shows dimensions.
- [x] tsc / eslint / build clean.
- OWNER ACTION: none (no migration).

### Slice 7 — Newsletter Send Center (PR #71, merged) — migration 0016 (apply manually)
- [x] HYBRID model (owner-approved): design in Canva → upload PDF via Blog & Newsletter (kind=newsletter) → Send Center emails a branded HTML announcement via Resend.
- [x] Migration 0016 newsletter_sends (campaign record: post_id, subject snapshot, pdf_url, send_kind test|broadcast, status, recipient/delivered/failed counts, sent_by, timestamps; RLS staff-only).
- [x] newsletter-send-store: listSendableNewsletters (published + has PDF + lastSentAt), getNewsletterRecipients (loyalty_signups w/ email+consent, status new|entered, de-duped), buildNewsletterEmail (brand-token HTML, Read button → public newsletter page + direct PDF link, 21+ footer), sendNewsletter (one private message per recipient, concurrency 5, records outcome), listSendHistory.
- [x] /admin/newsletter Send Center: picker, audience stat, Test send (single address) → Broadcast (explicit confirm checkbox, "already sent on" guard), flash + send-history table. Env-gated config banner when RESEND not set.
- [x] Nav: "Newsletter Send" added under Content group.
- [x] tsc / eslint / build clean.
- OWNER ACTION: apply migration 0016; set RESEND_API_KEY + NEWSLETTER_FROM_EMAIL (verified Resend sender) once DNS verifies.
