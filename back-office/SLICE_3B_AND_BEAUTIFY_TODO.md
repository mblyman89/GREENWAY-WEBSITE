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

### Beautify Slice 1 — Design system + shell (foundation) ✅ MERGED (PR #78)
- [x] Audit current admin look. FINDINGS: 81 files hardcoded brand hex; CSS vars existed in :root but were
      UNUSED in admin; 5 ad-hoc card backgrounds (#050505/#0a0a0a/#0d0d0d/#0f0f0f/#0f1a10); scattered radii;
      no shared Button/Card/Input primitives (inputCls/labelCls copy-pasted everywhere). A solid ux/ kit
      (StatusPill, EmptyState, Skeleton, Toast…) + charts/ kit already existed — kept & built on.
- [x] Added ADMIN DESIGN TOKENS to globals.css: --admin-canvas/surface/surface-2/surface-hover, --admin-border(-strong),
      --admin-text(-muted/-faint), --admin-accent/gold/orange/danger (+ -soft), radius scale (sm/.75/lg/xl),
      shadow scale. Added `.admin-shell` canvas (quiet brand glow over near-black), slim scrollbar, `.admin-focus`
      ring, `.admin-card-interactive` hover lift. Scoped to admin — public site untouched.
- [x] Shared primitives at `src/components/admin/ui/`: Button (primary/save/subtle/ghost/danger; sm/md/lg; href→Link),
      Card + CardHeader (one surface, accent stripe, interactive), Field/Input/Textarea/Select (+ exported
      controlClassName/labelClassName), Section (titled block), Badge. Barrel `ui/index.ts`.
- [x] Applied to shell: `.admin-shell` on layout.tsx wrappers; AdminSidebar rebuilt (premium feel, active accent bar,
      avatar/profile footer, token surfaces, backdrop blur); AdminPageHeader (sticky, blurred, token-driven);
      StatCard (token surfaces + optional accent icon).
- [x] Showcase: redesigned /admin dashboard with the new primitives (Section/Card/Button/StatCard). Updated ux
      EmptyState/Skeleton/StatusPill + SectionCard to use tokens.
- [x] tsc clean, eslint clean, `next build` EXIT=0 (all ~2340 pages). Static preview built + screenshotted for owner.

### Beautify Slice 2 — Dashboard + high-traffic pages ✅ MERGED (PR #79)
- [x] Dashboard already redesigned in Slice 1 (Section/Card/Button/StatCard + icons). Kept.
- [x] **Orders**: STATUS_STYLES→tokens; StatCards w/ icons; filter pills + search Input + Button; order
      cards `<Card padding="sm">`; "Mark X"→`<Button variant="primary" size="sm">`, "Details"→`<Button href
      variant="subtle">`; empty view→`<EmptyState icon="🧾">`.
- [x] **Products**: warning banners→tokens; filters use Input/Select/Button + grid/table toggle; bulk-AI
      callout→Button variant="save"; table→token zebra/hover + sticky header + `<StatusPill>`; empty/overflow→EmptyState/token.
- [x] **Media**: flash banners→tokens; filters→primitives; **grid tiles now SHOW pixel dimensions** (owner
      request): `{w}×{h}` badge bottom-left + `· {w}×{h}px` in caption; tiles use admin-card-interactive; empty→EmptyState.
- [x] **Blog**: removed local STATUS_STYLES; "+ New post"→Button; empty→EmptyState w/ action; table→token
      zebra/hover/sticky + `<StatusPill status={p.status}>`.
- [x] **Newsletter**: all flash/config banners→tokens; empty→EmptyState w/ "Go to Blog & Newsletter" Button;
      picker cards→tokens; test-send (Input+Button subtle) + broadcast (orange Button) + send-history table (StatusPill)→tokens.
- [x] **Content/Footer**: not-configured notice, SEO link→Button, flash banner, not-seeded card+Initialize
      button→tokens/primitives (page body is ContentEditorShell/ContentBulkBar components, already consistent).
- [x] **Pages builder** (`pages/[slug]`): not-configured notice, flash banner, home/faq tab segmented
      controls→tokens, preview link→tokens; Carousel/Sections/Q&A tabs: add/seed buttons→Button, empty states→EmptyState.
- [x] tsc clean, eslint clean, `next build` EXIT=0 (all ~2340 pages).

### Beautify Slice 3 — Tables, forms, empty/loading states + final pass ✅ MERGED (PR #80)
- [x] Shared UX kit tokenized (highest leverage — appears everywhere): Toast tones→tokens,
      ConfirmDialog modal surface→tokens, StickyActionBar→tokens, charts/ChartFrame surface→tokens.
- [x] Consistent table styling on secondary list pages: **Promotions** table → token zebra
      (`odd:bg-surface`) + hover + sticky `backdrop-blur` header + `<StatusPill>` (removed local STATUS_STYLES).
- [x] **Vendors** → EmptyState for the no-vendors case; filters rebuilt on Input/Select/Button;
      vendor cards use `admin-card-interactive` + token surfaces.
- [x] **Users** → token select/save/deactivate controls + token empty text.
- [x] **Menu-imports** → token Review link + token empty text.
- [x] **Loyalty-signups** → token empty box + token card surface (primary path already on EmptyState).
- [x] Backgrounds across ALL remaining pages already unified by the Slice-2 surface shim; brand-accent
      hexes (#7ed957/#ffd700) already equal the accent tokens so they render correctly — no recolor needed.
- [x] Full build QA: tsc clean, eslint clean (1 PRE-EXISTING ConfirmDialog effect warning, untouched),
      `next build` EXIT=0 (~2340 pages).

### DOCS this batch
- [x] **Receipt/pick-ticket printer** roadmap entry added to ROADMAP_PAGE_BUILDER_VISION.md §8
      (industry best practice = Star CloudPRNT / Epson Server Direct Print pull-printer + tiny
      print_jobs queue + 2 API routes off the existing notify.ts hook, reusing the existing
      /admin/orders/[id]/ticket layout). Owner advised in chat.

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
