# Slice 3b + Back-Office Beautification — Working TODO

> **STANDING RULE (every session):** Before doing anything, (1) `git checkout main && git pull`,
> (2) walk the file tree (`find src/app/admin -type f`, `ls back-office/`), (3) re-read this file +
> PROGRESS_TRACKER.md + ROADMAP_PAGE_BUILDER_VISION.md + relevant research/screenshots. AI output is
> drafts-only (employee validates before publish). Migrations applied MANUALLY by owner in Supabase
> SQL editor (keep idempotent). One PR per slice: squash-merge, delete branch, sync main. Push via
> `git push https://x-access-token:$GITHUB_TOKEN@github.com/mblyman89/GREENWAY-WEBSITE.git`. Never print token.

## Working dir note
- Repo at **/workspace/repo**. `cd` does NOT persist across execute-command — always `cd /workspace/repo` first.
- Build: `./node_modules/.bin/next build` (NOT npx). Typecheck: `npx tsc --noEmit`. Lint: `npx eslint <files>`.
- `rm -rf .next` before/after builds (disk tight). ~2340 pages.

---

## SLICE 3b — per-page banners (owner approved the "right route")
Owner decision: roll the section builder onto the band-style pages; keep bespoke pages bespoke but
make their hero editable via content blocks.

### 3b-A: Builder onto band-style pages (uses shared SectionBanner — low visual risk)
- [x] Extend `SectionBanner` to optionally render CTA buttons (SectionBannerButton/SectionBannerData types).
- [x] **Specials**: seed `specials.hero`; SpecialsContent renders hero copy + CTAs from builder, extras at bottom; content-block fallback.
- [x] **Vendors**: seed `vendors.grow` + `vendors.brands` (2 banners, were HARDCODED → now editable); VendorDirectory wired + extras.
- [x] **Menu**: seed `menu.hero`; menu hero band gets CTA buttons + extra banners below.
- [x] **Loyalty**: seed `loyalty.hero`; image-led hero keeps its look, builder supplies title/subtitle copy.
- [x] Added getPageBanners(slug, primaryKeys) + toBannerData + BannerData to page-sections-store.

### 3b-B: Bespoke pages — make hero editable via content blocks (keep distinct design)
- [x] **About**: about.hero.title/.subtitle blocks; AboutContent hero now SiteText-driven (kept big display styling).
- [x] **Locations**: locations.hero.title + locations.hero.image blocks; LocationsContent async, storefront photo + title editable.
- [x] **Price Match**: pricematch.hero.title + .subtitle blocks; PriceMatchContent two headlines now SiteText-driven.

### 3b verify
- [x] tsc / eslint / build clean (build EXIT=0, all 7 pages compiled, no warnings).
- [x] Live look preserved (every change falls back to the exact current hardcoded value).
- [x] No migration (page_sections 0013 + content_blocks already exist). Lazy top-up seed (Slice C) adds the new blocks/sections automatically.

---

## BEAUTIFY — Back-office UI cleanup/beautification (3 focused slices)
Goal: a gorgeous, consistent, presentable admin. NOT rushed. Owner: "presentability matters."

### Beautify Slice 1 — Design system + shell (foundation)
- [ ] Audit current admin look (layout.tsx, AdminPageHeader, nav, cards, buttons, inputs).
- [ ] Establish a small admin design-token set (spacing, radius, shadows, brand accents) + shared primitives
      (Button, Card, Badge, Input, Section) so every page is consistent.
- [ ] Polish the sidebar/nav + top bar + page header (active states, icons, grouping, hover).

### Beautify Slice 2 — Dashboard + high-traffic pages
- [ ] Redesign /admin landing dashboard (at-a-glance cards, recent activity, quick actions).
- [ ] Beautify the most-used pages: Orders, Products, Media, Blog, Newsletter, Content/Footer, Pages builder.

### Beautify Slice 3 — Tables, forms, empty/loading states + final pass
- [ ] Consistent table styling (zebra/hover, sticky headers, status pills).
- [ ] Consistent form styling (labels, help text, validation, primary/secondary actions).
- [ ] Polished empty states, loading skeletons, toasts/flash messages.
- [ ] Full visual QA pass; screenshots for owner inspection.

---

## DOCS / HANDOFF (do alongside)
- [ ] Update PROGRESS_TRACKER.md (3b + beautify slices as they land).
- [ ] Update ROADMAP_PAGE_BUILDER_VISION.md progress log.
- [ ] Keep this file current; ensure standing rule is at top of trackers.

## AFTER THIS BATCH
- [ ] crawl4ai Python workhorse build.
- [ ] Final polish/touchups phase.

## OWNER STATUS (confirmed)
- SQL through 0017 run. AI working. Resend DNS nearly verified.
- TODO for owner re: Resend "from email" — see chat (verify domain in Resend, set NEWSLETTER_FROM_EMAIL on Vercel to a from-address on the verified domain, or rely on ORDER_EMAIL_FROM fallback).
