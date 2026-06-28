# Greenway Back Office — "Page Builder" Vision Roadmap

**Status:** Planning complete · build not yet started
**Author:** Agent session (handoff-ready)
**Audience:** Current + future agent sessions, and the owner (Michael / Mitchell)
**Last updated:** see git log for this file

---

## 0. How to use this document

This is the **single source of truth** for the large multi-part enhancement the owner
requested after the Site Content editor / carousel / fonts work (PRs #59–#64) merged.

Standing rules that still apply every session:
- Re-read todo / roadmap / checklists / research docs **and walk the file tree** at the
  start of every session.
- AI output is **drafts only** — an employee validates before publish.
- Deliver in **incremental slices**, one PR per slice (squash-merge, delete branch, sync main).
- Owner leaves **merge timing to the agent's judgment**; prefers progress updates "just in
  the chat as you go" without blocking.
- Migrations are applied **manually by the owner** in the Supabase SQL editor. Keep them
  **idempotent** (create if not exists; drop policy/trigger if exists). Next number = **0012**.
- Repo lives at `/workspace/repo`. `cd` does not persist across `execute-command`; use
  `folder="repo"` and repo-relative paths.
- Build: `./node_modules/.bin/next build` (NOT npx). Typecheck: `npx tsc --noEmit`.
  `rm -rf .next` before/after builds (disk is tight). Push via
  `git push https://x-access-token:$GITHUB_TOKEN@github.com/mblyman89/GREENWAY-WEBSITE.git`
  — **never print the token**.

---

## 1. The vision, in the owner's words (paraphrased + grouped)

The owner wants the back office to become a true **per-page page builder** that a
non-technical employee can run like Wix/Squarespace. Concretely:

### A. Bugs to fix first
1. **Site Content publish does not update the live page** (but the Carousel tab's publish
   *does* update). Investigate + fix.
2. **Homepage product cards render as blank grey cards** (other pages' product cards are
   fine). Regression — fix.
3. **Media Library uploaded images show a blank placeholder** (no thumbnail). Fix.

### B. Universal banner editability
4. **Every banner on every page** must be fully editable: text, images, AND
   add/delete/style/label of buttons. (Midjourney art is textless; text + buttons are
   layered on top in the editor.)

### C. Navigation + per-page tabs
5. **Rename the "Home Carousel" tab to "Home."** Give that page a **top tab system** with
   two tabs:
   - **Tab 1 — Carousel** (the existing hero carousel manager).
   - **Tab 2 — Sections** (the other homepage banners/sections).
   - The homepage today has a **top "daily special highlights" section that stays as-is and
     is NOT editable**. Sections **below** it ARE editable, and the products/content under
     them are assignable in the editor.
   - Tab 2 has an **Add button** to append a new banner/section below the last one.
   - **Hard cap: 4 sections total** on the homepage.
6. **Add a dedicated side-menu tab for EVERY page that has banner(s)** — each with the same
   carousel-level customization. Include **all** pages: menu, loyalty, specials, vendors,
   FAQ, about, location, etc.
7. **Site Content tab is reduced to ONLY header + footer** (everything else moves to the new
   per-page tabs).
8. **The Carousel/Home "Preview" link** should open the **Site Content page that hosts the
   in-app preview screen** — NOT the live website.

### D. Content modules rebuilt carousel-style
9. **Blog & Newsletter** rebuilt like the Carousel tab (rich, customizable):
   - Blog cards: image **on top, no text overlay**; **date in full-month-name / DD / YYYY**
     (e.g. "July 26, 2026"); editable title (text + font size + style + alignment); short
     description; **Read Article** button; plus the ability to **add/delete buttons** that
     link to other pages.
   - Newsletter cards open an **uploaded PDF**.
10. **Newsletter builder (EXECUTIVE DECISION — see §6):** the owner wants to build
    newsletters in the back office (instead of Canva) and push them weekly to the loyalty
    email list from one centralized place. Agent decides feasibility/scope.
11. **FAQ:** add/remove questions + answers with a fancy carousel-style editor.
12. **Media Library upgrade:** smarter — tell the system *what* an asset is, *why* it was
    uploaded, *where* it belongs, so the site auto-fetches/uses it. Add **guardrails**
    (enforce formats/conventions; reject improperly-formatted uploads) so assets are easily
    fetchable later. Also fix the blank-thumbnail bug (see §A.3).
13. **Handoff docs** (this file + per-slice notes in PROGRESS_TRACKER.md).

The owner granted permission to make **executive decisions** (especially the newsletter),
use as many credits as needed, and to **stop to ask** when clarity is needed.

---

## 2. Current-state findings (verified this session)

- **Publish read path** (`src/lib/cms/render-content.ts`): correct. Non-preview readers get
  `published_value` when `status='published'`. `publishContentBlock`
  (`src/lib/cms/content-store.ts`) correctly copies `draft_value → published_value` and sets
  `status='published'`.
- **Publish revalidation** (`src/app/admin/content/actions.ts` → `revalidatePublicForPage`)
  maps home/menu/loyalty/vendors/specials/faq/footer/business → the right paths. Public
  pages are `force-dynamic`, so they re-read every request anyway.
  - **Most likely cause of "publish doesn't update":** the owner is viewing the site in
    **Preview / Draft Mode** (green "Preview mode — you're seeing unpublished drafts" banner
    is visible in their screenshot). In Draft Mode the page shows `draft_value`, so once you
    publish, draft == published and nothing *appears* to change; and if they later exit
    preview on a CDN-cached route it can look stale. **Action:** verify on a fresh
    (non-preview) load; ensure every editable block's `page` value matches a
    `revalidatePublicForPage` case; consider `revalidatePath('/', 'layout')` as a safety net
    after any publish; add a clear "you are in Preview mode" affordance + an "open the live
    page" link that disables draft mode first.
- **Homepage grey cards** (`src/components/home/HomeDailyDeals.tsx`): renders 8 grey
  `animate-pulse` skeleton tiles when `deals.length === 0`. `deals` is empty when
  `selectDailyDealItems(items, weekday)` returns nothing or `useStoreWeekday()` hasn't
  resolved. `ProductCard` itself is shared with the (working) menu page, so the regression is
  in **deal selection / weekday resolution / the preview-menu data**, OR product images
  failing to load. **Action:** confirm `posMenuPreviewItems` is non-empty and
  `selectDailyDealItems` returns items for the current weekday; add a non-skeleton fallback
  (e.g. show newest items) so the section is never permanently grey.
- **Media blank thumbnails** (`src/lib/media/store.ts`): the `media` bucket is **private**
  (code comment: "upload assets to the private `media` bucket"), but `publicUrlForKey`
  builds a `…/storage/v1/object/public/media/<key>` URL. A private bucket returns 400 on the
  public path → **blank thumbnail. CONFIRMED root cause.** **Fix options:** (a) make the
  `media` bucket public for published assets and keep RLS for writes; or (b) generate
  **signed URLs** for admin thumbnails + published-asset delivery. Decide in Slice 1.
- **Existing schema:** migrations 0001–0011 applied. `content_blocks` (draft/published +
  status), `blog_posts` + `newsletter_assets` (0005), `home_carousel_slides` (0011),
  `media_assets` + `media` bucket (0001/0003). FAQ is currently a **static file**
  (`src/content/faq`) rendered by `src/components/faq/FaqContent.tsx` — needs a DB table.
- **Carousel gold-standard pattern** to replicate for per-page banners:
  - Types: `src/lib/cms/carousel-types.ts`
  - Seed: `src/lib/cms/carousel-seed.ts`
  - Store (draft/publish/CRUD/reorder + fallback): `src/lib/cms/carousel-store.ts`
  - Actions: `src/app/admin/content/carousel/actions.ts`
  - Page: `src/app/admin/content/carousel/page.tsx`
  - Card editor: `src/components/admin/CarouselSlideCard.tsx`
  - Reusable fields: `ContentImageField.tsx`, `ContentFontField.tsx`
  - DB pattern: `0011_home_carousel.sql` (published + `draft_*` mirror cols, jsonb ctas,
    enabled, sort_order, status; RLS staff-all + public read published+enabled).

---

## 3. Target architecture — generalize the carousel into "page sections"

Rather than hand-build a bespoke editor per page, introduce **one generic, reusable
"page sections" system** that every page tab consumes. The carousel becomes one *kind* of
section list; banners become another.

### 3.1 New table: `page_sections` (migration 0012)
A single table that powers banners/sections for *all* pages.

```
page_sections
  id            uuid pk
  page_slug     text not null     -- 'home' | 'menu' | 'loyalty' | 'specials'
                                  -- | 'vendors' | 'faq' | 'about' | 'location' ...
  kind          text not null     -- 'banner' | 'highlight' | 'carousel_ref' ...
  -- published fields
  eyebrow       text
  title         text
  subtitle      text
  body          text
  image_path    text              -- media storage key or /public path or URL
  image_focus   text              -- center|top|bottom|left|right
  text_align    text              -- left|center|right
  buttons       jsonb             -- [{label,href,variant,enabled}] add/delete/style
  settings      jsonb             -- per-kind extras (font, bg, product filter, etc.)
  -- draft mirror
  draft_eyebrow text, draft_title text, draft_subtitle text, draft_body text,
  draft_image_path text, draft_image_focus text, draft_text_align text,
  draft_buttons jsonb, draft_settings jsonb,
  -- lifecycle
  enabled       boolean default true
  locked        boolean default false   -- non-editable sections (e.g. home daily-special)
  sort_order    int not null default 0
  status        post_status not null default 'draft'
  created_by/updated_by/created_at/updated_at + set_updated_at() trigger
  RLS: is_staff() all; public read where status='published' and enabled
```

Caps enforced in the store layer (NOT the DB): **home = 4 sections max** (the locked
daily-special counts as 1, so 3 addable). Other pages get a sensible cap (e.g. 6) per page.

### 3.2 Generic library (mirror the carousel files)
- `src/lib/cms/page-sections-types.ts` — `SectionRow`, `RenderSection`, `SectionAdminVM`,
  `SectionButton`, per-page caps map.
- `src/lib/cms/page-sections-seed.ts` — faithful seeds of the **current** banners on each
  page so nothing visually changes on first deploy.
- `src/lib/cms/page-sections-store.ts` — `listSections(pageSlug)`, `getSectionsForRender`,
  `ensureSeeded`, `createSection` (cap-aware), `saveSectionDraft`, `publishSection`,
  `deleteSection`, `moveSection`, `setEnabled`. Draft-aware + fallback to seed.
- `src/app/admin/pages/[slug]/actions.ts` — seed/add/save/publish/delete/move (+ button
  parsing like `parseCtas`).
- `src/app/admin/pages/[slug]/page.tsx` — generic per-page manager with a **top tab bar**
  (e.g. Home → Carousel | Sections; other pages → just Sections, or Banners | Content).
- `src/components/admin/SectionCard.tsx` — generalized `CarouselSlideCard` (image picker,
  eyebrow/title/subtitle/body, focus + align, **N buttons with add/delete/style/label**,
  enable, Save draft/Publish/Delete/reorder, unsaved-edits guard). Respects `locked`.
- Reusable button editor: `src/components/admin/ButtonListField.tsx` (add/delete/label/href/
  variant/enabled) — used by sections AND blog cards.

### 3.3 Public rendering
- A generic `<PageSection editable=… section=… />` (extends `SectionBanner.tsx`) renders a
  banner from a `RenderSection`, including its buttons and font/style settings.
- Each public page fetches `getSectionsForRender(slug)` and maps to `<PageSection>`.
- The homepage keeps `<HomeDailyDeals>` as the **locked** top section; the editable ones
  below come from `page_sections` where `page_slug='home'`.

### 3.4 Navigation (`src/components/admin/admin-nav-data.ts`)
New **"Pages" group** (or expand "Content"):
- Home (`/admin/pages/home`) — was "Home Carousel"
- Menu (`/admin/pages/menu`)
- Loyalty (`/admin/pages/loyalty`)
- Specials (`/admin/pages/specials`)
- Vendors (`/admin/pages/vendors`)
- FAQ (`/admin/pages/faq`)
- About (`/admin/pages/about`)
- Location (`/admin/pages/location`)
- Blog & Newsletter (`/admin/blog` — rebuilt)
- Media Library (`/admin/media` — upgraded)
- **Site Content (`/admin/content`)** — reduced to **Header + Footer only**.

---

## 4. Slice plan (ordered, one PR each)

> Bugfixes first (fast wins, de-risk), then the architecture, then the content modules.

### Slice 1 — Bug triage & fixes  *(PR)*
- Fix **media blank thumbnails** (public bucket or signed URLs).
- Fix **homepage grey cards** (guarantee the daily-deals section resolves; non-skeleton
  fallback).
- Fix / clarify **Site Content publish-not-updating** (verify non-preview load; safety-net
  revalidate; in-app "Preview mode" affordance + "view live" that exits draft mode).
- No schema change (or a tiny storage policy migration if we choose public bucket).
- **Owner-visible outcome:** thumbnails show, homepage cards show, publish reflects live.

### Slice 2 — `page_sections` foundation + generic Section editor  *(PR, migration 0012)*
- Migration 0012 `page_sections` (idempotent, RLS).
- Generic types/seed/store/actions + `SectionCard` + `ButtonListField` + `<PageSection>`.
- Seed home's editable sections (Category + Brand banners) into `page_sections` so the
  homepage renders identically from the new system.
- Add `/admin/pages/home` with the **2-tab** layout (Carousel | Sections), Add button on
  Sections, **cap 4**, daily-special section shown **locked**.
- **Rename nav "Home Carousel" → "Home"**; route `/admin/content/carousel` → `/admin/pages/home`
  (keep a redirect). Move the **Preview link** to the Site Content preview screen.

### Slice 3 — Roll out per-page tabs to every page with banners  *(PR)*
- Wire menu / loyalty / specials / vendors / faq / about / location to the generic
  `/admin/pages/[slug]` manager + seed each page's existing banners.
- Make **every banner editable** (text + image + buttons) via `<PageSection>`.
- Reduce **Site Content** to Header + Footer blocks only (move the rest; keep data).

### Slice 4 — Blog & Newsletter rebuilt carousel-style  *(PR, maybe migration 0013)*
- Card editor like the carousel: image-on-top (no overlay), full-month-name date,
  editable title typography (size/style/alignment), description, Read Article button,
  add/delete extra buttons (reuse `ButtonListField`).
- Newsletter card opens an uploaded PDF (reuse `newsletter_assets`).

### Slice 5 — FAQ editor  *(PR, migration for `faq_items`)*
- DB-backed `faq_items` (question/answer/sort_order/enabled/draft mirror/status + RLS).
- Fancy carousel-style add/remove/reorder editor at `/admin/pages/faq` (Content tab).
- `FaqContent.tsx` reads from DB (fallback to the current static `@/content/faq`).

### Slice 6 — Media Library upgrade  *(PR, migration for metadata + guardrails)*
- Add metadata to `media_assets`: `purpose`/`usage_type`/`placement`/`tags` so the site can
  auto-fetch the right asset (e.g. "home.carousel.slide1" or "vendor:phat-panda:logo").
- Upload guardrails: enforce mime/type/dimension/aspect conventions per `usage_type`;
  reject improperly-formatted uploads with a clear message.
- "Where it belongs" picker so an upload can be assigned to a page/section/slot.

### Slice 7 — Newsletter builder + weekly send  *(PR — only if §6 says BUILD)*
- See executive decision below.

Each slice: branch → build → `tsc`/eslint/`next build` clean → squash-merge → delete branch
→ sync main → update `PROGRESS_TRACKER.md` with PR evidence + any owner to-dos (migrations).

---

## 5. Risks / watch-items
- ESLint `react-hooks/set-state-in-effect`: compute during render (lazy `useState` init /
  render-time clamp) or `queueMicrotask`.
- `createSupabaseAdminClient()` is untyped, so `.from('page_sections')` won't fail tsc.
- Build is ~2374 static pages; keep `force-dynamic` on admin + public content pages.
- Don't break the live look on first deploy — seed faithfully from current markup.
- Owner applies migrations manually — call them out explicitly in the PR + tracker.

---

## 6. EXECUTIVE DECISION — Newsletter builder vs. Canva

**Reference:** `JULY_26_NEWSLETTER_EXAMPLE.pdf` — a 5-page A4 PDF made in **Canva**
(cover with art + "Sweet Leaf" Ozzy tribute, an educational "What are Terpenes?" page, a
daily-deals page, and a Weekly Specials + contact-footer page). It is **design-rich**:
custom layouts, background art, varied typography, full-bleed imagery.

**Recommendation (pending owner confirmation): HYBRID — do NOT rebuild a Canva-class
visual designer in the back office now.** Rationale:
- Faithfully reproducing Canva's freeform, multi-page, image-heavy layout in a web editor is
  a *large* product on its own and is high-risk for the timeline + credits. It would also be
  hard for a non-technical employee to match the polish they already get from Canva.
- The **valuable, low-risk 80%** the owner actually needs weekly is **distribution**: take a
  finished newsletter and **push it to the loyalty email list from one place**.

**Proposed build (Slice 7) — "Newsletter Send Center" (small, high-value):**
1. Reuse the rebuilt Newsletter module (Slice 4): the employee uploads the finished
   newsletter **PDF** (made in Canva) + a cover image + title + date.
2. Add a **"Send to loyalty list"** action: render a clean, on-brand **HTML email** (header
   logo, cover image, title, intro text, a "Read the full newsletter" button linking to the
   hosted PDF, store hours/contact footer, unsubscribe) and send via the existing email
   provider (Resend) to the loyalty subscribers.
3. Guardrails: confirmation step + recipient count + test-send-to-self + audit log entry;
   weekly cadence is manual (employee clicks Send) to keep a human in the loop
   (drafts-only philosophy).
4. **Defer** a true in-app visual page designer unless the owner explicitly wants it later;
   if so, scope it as its own multi-slice project.

This gives the owner the weekly one-click send they asked for, keeps Canva for the parts it's
best at, and is buildable safely. **Will confirm this direction with the owner before
building Slice 7.**

---

## 7. Open questions for the owner (to confirm before/at Slice 7)
1. Newsletter: OK with the **hybrid** (design in Canva → upload PDF → one-click branded email
   to the loyalty list), instead of a full in-app designer? (See §6.)
2. Media bucket: OK to make the `media` bucket **public-read for published assets** (simplest
   reliable thumbnails + fast delivery), or prefer **signed URLs** everywhere?
3. "About" and "Location" pages: confirm their routes exist (so we add the right page tabs).
4. Homepage section cap is **4 total** including the locked daily-special — confirm.
