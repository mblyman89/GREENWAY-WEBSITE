# Greenway Back Office — UX Overhaul Working Checklist

> Granular, check-off-as-you-go task list for the user-friendliness overhaul. Pairs with `UX_OVERHAUL_ROADMAP.md` (the plan) and `UX_OVERHAUL_RESEARCH.md` (the why). **Never delete tasks — mark `[x]` with evidence (PR #, route, screenshot note).**
>
> **EVERY SESSION FIRST:** re-read roadmap + research + this file + master `BACK_OFFICE_BUILD_TODO.md`; walk the tree (`find src/app/admin -name page.tsx`, `ls src/components/admin`, `ls src/lib`); trace the data flow (page → action → lib store → supabase) for the target page. Verify with `tsc` + `next build` before claiming done.

---

## UX-0 — Hotfix & foundation
### Crash fix
- [x] Create a `SafeData` server helper / pattern that wraps DB reads and returns `{ ok, data, error }` so a missing table or query failure NEVER crashes a page. *(PR #44 hardened the menu helpers; PR #45 adds the reusable `src/lib/safe-data.ts` with `safeData()` + `safeAll()`.)*
- [x] Fix `/admin/menu-imports/page.tsx`: wrap `getPublishedVersion/listVersions/listImports` in SafeData; on failure render a friendly card, not a crash. *(PR #44 — verified live: real PRODUCTS+INVENTORIES staged 3,005 items / 3,221 variants, 0 errors. Root cause was render-time fragility, not missing tables; helpers now guard every Supabase `error`.)*
- [x] Audit admin pages for unguarded-`Promise.all`; apply SafeData where needed. *(PR #44 hardened all menu-version read helpers + both menu-import pages + the upload action; PR #45 applies `safeData` on the dashboard. Remaining pages adopt it as they're touched in UX-1+.)*
- [x] Add a route-level `error.tsx` for `/admin` that renders the friendly branded error card. *(PR #45 — `src/app/admin/error.tsx`, "Try again" + back-to-dashboard, no stack trace.)*

### Shared UX component kit (`src/components/admin/ux/`)
- [x] `Tooltip` — accessible hover/focus tooltip (brand-styled). *(PR #45)*
- [x] `InfoHint` — a small "?" that opens a Tooltip/popover with contextual help. *(PR #45)*
- [x] `HelpPanel` — collapsible "How this works" panel (remembers open/closed). *(PR #45)*
- [x] `EmptyState` — icon + title + explanation + primary CTA. *(PR #45)*
- [x] `ErrorState` — friendly error card with cause + "what to do" + retry. *(PR #45)*
- [x] `ConfirmDialog` — destructive/irreversible actions; optional type-to-confirm. *(PR #45)*
- [x] `Toast` + `useToast` — success/error feedback after actions; wired into admin shell. *(PR #45)*
- [x] `StatusPill` — consistent status colors (draft/published/archived/error/warning). *(PR #45)*
- [x] `Skeleton` — loading placeholders (Skeleton/Text/Card/Rows). *(PR #45)*
- [x] `Breadcrumbs` — wayfinding on detail pages. *(PR #45)*
- [x] `StickyActionBar` — always-reachable Save/Publish/Cancel + status. *(PR #45)*
- [x] Barrel `index.ts` export; each component documented with a usage comment. *(PR #45)*

### Dashboard truthfulness + getting started
- [x] Make slice-progress checkmarks data-driven via `BUILD_SLICES` (single source). Slices 1–9 verified by route existence; all marked done. *(PR #45)*
- [x] Build a **Setup Status** util (`src/lib/admin/setup-status.ts`): probes `menu_items`/`pos_imports` tables, checks published menu, SMTP (RESEND_API_KEY), invited team. Degrades gracefully. *(PR #45)*
- [x] Add a **Getting Started checklist** card on the dashboard showing % complete + the single next action. Hidden once 100%. *(PR #45)*

### Charting
- [x] Confirm library with owner (Recharts). **Owner approved.** Installed recharts ^3.9.0. *(PR #45)*
- [x] Build `src/components/admin/charts/` wrapper (BarChart, LineChart, AreaChart, Donut/Pie, Sparkline + shared theme + ChartFrame) taking brand tokens; app imports wrapper only. *(PR #45)*
- [x] `tsc` + `build` clean. **PR #45 — `tsc --noEmit` EXIT 0; `next build` "Compiled successfully in 9.7s", 2374 pages. Owner inspect.**

## UX-1 — Global shell & wayfinding
- [x] Sidebar: current-section highlight + icons + grouped sections; mobile drawer. *(Already in `AdminSidebar`/`admin-nav-data`; added a "Help & FAQ" nav item, visible to all roles via `dashboard.view`. PR #46.)*
- [x] `AdminPageHeader`: optional `help` slot (mounts `HelpPanel`) + `breadcrumbs` slot. *(PR #46 — rewrote header with both slots.)*
- [x] Apply `HelpPanel` + breadcrumbs to each section's main page. *(PR #46 — menu-imports, products, promotions, reports, orders, blog, content, vendors, media, loyalty-signups, users; audit gets breadcrumbs.)*
- [x] `/admin/help` page: searchable FAQ per section. *(PR #46 — `src/app/admin/help/page.tsx` + `HelpSearch` client UI, content in `src/lib/admin/help-content.ts`. Live full-text search across every Q&A.)*
- [x] Global "?" help launcher in the shell. *(PR #46 — `HelpLauncher` floating button (bottom-left) + slide-over quick search, mounted in `layout.tsx`.)*
- [x] Mobile-responsive pass on shell + headers (sidebar drawer already responsive; headers/help stack on small screens). *(PR #46. Deeper table responsiveness continues in later visual slices.)*
- [x] `tsc` + `build` clean. **PR #46 — `tsc --noEmit` EXIT 0; `next build` "Compiled successfully in 10.0s", `/admin/help` generated. Owner inspect.**

## UX-2 — Live preview engine
- [x] Implement Next.js **Draft Mode** enable/disable routes (`/api/admin/preview/enable|disable`). Enable is staff-gated; both validate same-site redirect paths (no open redirect). *(PR #47)*
- [x] `PreviewFrame` component — iframe of the public page in draft perspective, device-size toggles (desktop/tablet/phone), refresh, open-in-tab, listens for edit messages. *(PR #47)*
- [x] Click-to-edit overlay system: `<SiteText>` tags blocks with `data-gw-block` in preview; `PreviewEditOverlay` (mounted on public site only in Draft Mode) draws "✎ Edit" hotspots + a preview banner, postMessages the block key to the admin frame. Proof-of-concept wired on the **footer compliance warning** (a real seeded block; Footer made async). *(PR #47)*
- [x] Wire live preview into Content editor (`/admin/content`): `ContentPreviewPanel` hosts the frame with a page selector; clicking a hotspot scrolls to + focuses that block's form (anchor `block-<key>`). *(PR #47.)* Remaining seeded blocks (home/menu/loyalty heros, business hours) adopt `<SiteText>` as their public surfaces are visually reworked in UX-3. SEO editor live-preview also folds into UX-3's visual-content pass.
- [x] `tsc` + `build` clean. **PR #47 — `tsc --noEmit` EXIT 0; `next build` "Compiled successfully in 10.2s", preview API routes present, public pages still static. Owner inspect.**

## UX-3 — Visual content & blog editing
- [x] Blog editor: side-by-side **live preview** of the public article that updates as you type (hero + title/category/author overlay + body paragraphs, local hero-image preview); live char counters + SEO-length guidance on title/excerpt/SEO; AI "Write body/SEO" with Accept/Reject + compliance flags (existing, kept); **✨ Suggest alt text** AI button (drafts-only, audited `blog.ai.alt_text`); "View on site ↗". Built as `BlogEditorClient` wrapping the unchanged `updatePostAction`. *(PR #50.)* Newsletter PDF/page-image picker retained; full drag-drop media library deferred to UX-4. Also folded in: loyalty "Import legacy file" now shows a clear "imported N of M / file was empty" banner instead of being a silent no-op.
- [x] Content blocks + AI: Squarespace-style `ContentBlockEditor` per block — live char count, SEO-length guidance, **✨ Write with AI** (Accept / Try again / Discard) with visible compliance flags, save-draft + publish, "View on site ↗". AI assist (`src/lib/cms/ai-content.ts` + `suggestContentAction`) reuses the shared provider + WA-cannabis compliance scanner; **drafts-only**, audited `content.ai_suggest`, never auto-saves/publishes; gated on `AI_API_KEY`. Public `/menu` hero (title+subtitle) wired to editable `<SiteText>` blocks (`menu.hero.*`); seed defaults = exact current live copy so it's a visual no-op until edited. *(PR #49.)* NOTE: homepage Hero carousel intentionally left untouched (it's a `"use client"` component; refactor is risky/out-of-scope for this slice).
- [x] `tsc` + `build` clean (PR #49: tsc exit 0; `next build` ✓ Compiled successfully, 2374/2374 pages). **PR + owner inspect.**

## UX-4 — Visual product & media enrichment (AI-heavy)
- [x] Products: **visual thumbnail grid** (default) with per-card gap badges (Photo/Copy/Brand) + status pill + thumbnail (batch-resolved via new `resolveMediaUrls`), Grid/Table toggle (table kept for power users), stat cards + filters retained. *(PR #51.)*
- [x] **Bulk AI review grid** (`/admin/products/bulk-ai`): pre-lists products missing descriptions, select + "✨ Draft selected (up to 25)" generates compliant drafts (drafts-only, persisted as pending `ai_suggestions`), review grid with compliance flags + Accept/Reject per product; audited `product.bulk_ai_generated/accepted`. New helper `listPendingByType`. *(PR #51.)*
- [x] Media: **drag-drop dropzone** (`MediaDropzone`, with thumbnail previews before upload, wraps existing `uploadMediaAction`); visual grid + where-used + safe-delete already existed and retained; **✨ Suggest alt text** AI on the media detail page (`MediaAltField` + `suggestMediaAltAction`, context-based drafts-only, audited `media.ai_alt_text`). *(PR #51.)*
- [x] `tsc` + `build` clean (tsc exit 0; build ✓ 2374 static pages + new dynamic `/admin/products/bulk-ai`). **PR + owner inspect.**
- NOTE (handoff): media AI alt-text is **context-based** (title/filename/usage/tags), not image vision — honest starting point the human edits. A future enhancement could add a vision model for true image-aware alt text (see UX-7 / roadmap).

## UX-5 — Visual vendors/brands + promotions
- [x] Vendors/Brands: logo thumbnails (existing, kept), **profile completeness meter** (`src/lib/vendors/completeness.ts` weighted scorer + `CompletenessMeter` server component — compact on list cards w/ "next: add X", full checklist in the editor right rail), **live public-card preview** (`VendorCardPreview` — faithful storefront-card mock w/ browser chrome, since the public `/vendors` page isn't built yet; honest "draft = preview only" note), **"Research with AI"** (`src/lib/ai/ai-vendor.ts` → `generateVendorProfile` drafts mission+about, persisted as PENDING `ai_suggestions` via new exported `persistSuggestion`; editor shows Accept/Reject per draft; Accept writes the field + marks accepted; audited `vendor.ai_drafted/accepted/rejected`; gated on `AI_API_KEY` w/ friendly "not set up" state; honest note that the text model doesn't browse the web). *(PR #52.)*
- [x] Promotions: **visual weekly schedule** (`WeeklyScheduleStrip` — 7-day grid, recurring weekday deals land on their day, today highlighted, dated/one-off summarized below, status-dot legend), **affected-products preview with computed sale prices** (each row now strikes original → shows discounted price for simple percent/fixed deals via new pure `sampleDiscount` helper), friendly conflict warnings (existing, kept), **live sale-badge preview** (`SaleBadgePreview` — mock product card w/ sale flag + strikethrough/sale price for percent/fixed; "applies in cart" badge for BOGO/tier/basket; uses a real affected product or a sensible default). *(PR #52.)*
- [x] `tsc` + `build` clean. **PR #52 — `tsc --noEmit` EXIT 0; `next build` "✓ Compiled successfully in 13.7s", 2374/2374 static pages. Owner inspect.**
- NOTE (handoff): product **thumbnails** in the affected-products list were deferred — `MenuLite` (the promotion match shape) carries no image, and joining per-product enrichment media would add an N-query per preview. The sale-badge preview uses a 🌿 placeholder like the product grid. A future pass can extend `loadPublishedMenuLite` to carry the enrichment image key + batch-resolve via `resolveMediaUrls` (roadmap).
- NOTE (handoff): "Research with AI" reuses the shared `ai_suggestions` lifecycle (entity_type `vendor`, field_key `mission_statement`/`about`). Accept is whitelisted to only those two fields. Brands don't yet have the AI button — `generateVendorProfile` already supports `kind:"brand"`, so wiring a brand-level button is a small follow-up (roadmap).

## UX-6 — Operational polish
- [x] Orders: big touch cards (existing, kept) + **visual status flow** (`OrderStatusFlow` stepper New→Ack→Prep→Ready→Done; done=green ✓, current pulses, future dim; cancelled/no-show = red terminal pill; on cards + order detail) + **new-order alert** (`NewOrderAlert` client polls new staff-only `GET /api/admin/orders/count` every 15s; on a rise in NEW orders shows a pulsing "🔔 N new — tap to refresh" banner + a WebAudio chime (no asset; mute remembered in localStorage); silently no-ops on error). *(PR #53.)*
- [x] Loyalty: friendly queue (existing, kept) + **dedupe visual** (each duplicate now resolves its original via `getLoyaltySignup` and shows "Same phone/email as <Name> (submitted …). Verify before entering" + hover tooltip) + **onboarding empty state** (when zero signups total, a celebratory `EmptyState` explaining how signups arrive + link to the public form + legacy-import hint; filtered-empty stays a neutral message). *(PR #53.)*
- [x] Reports: **interactive Recharts** time-series — Orders/day + Revenue/day as `AreaChart` (hover tooltips) via new client `InteractiveReportCharts` on the shared `@/components/admin/charts` wrapper; order-status + (kept) loyalty get a `DonutChart` alongside the existing `StatusBar`; loyalty/day → `AreaChart`. BarLists + CSV export kept untouched. *(PR #53.)*
- [x] Users/Audit: **role explainer** (rewrote "Role reference" → privilege-ordered plain-language cards) + **permission-matrix visual** (`PermissionMatrix` reads the live `MATRIX` via new read-only `rolesForPermission` + `PERMISSION_LABELS`/`ALL_PERMISSIONS` exports — green ✓ grid of role×permission, the actual enforced source of truth) + **friendly audit timeline** (rewrote `/admin/audit` → day-grouped timeline with `humanizeAction` plain-language phrases + tone icons + actor initials + Today/Yesterday headers; raw entity shown subtly; friendly empty state; renamed UI to "Activity Log"). *(PR #53.)*
- [x] `tsc` + `build` clean. **PR #53 — `tsc --noEmit` EXIT 0; `next build` "✓ Compiled successfully in 16.7s", 2374/2374 static pages, new dynamic `/api/admin/orders/count`. Owner inspect.**
- NOTE (handoff): order "ticket polish" (a print-optimized ticket layout) was left as-is — the order detail page already prints acceptably; a dedicated `@media print` ticket stylesheet is a small future add (roadmap). The new-order chime requires one prior user interaction on the page (browser autoplay policy) — expected; the visual banner always works regardless.

## UX-7 — AI everywhere + onboarding wizard
- [ ] Audit every page; add "let AI do this" wherever a human types from scratch.
- [ ] First-run onboarding wizard (setup → POS → publish → invite), reusing Setup Status.
- [ ] Final visual fine-tune + a11y + mobile sweep.
- [ ] `tsc` + `build` clean. **PR + owner inspect.**

---

## Cross-cutting (verify on every slice)
- [ ] Shared components reused; no one-off styles.
- [ ] Friendly empty + error + skeleton states on every page touched.
- [ ] Preview-before-publish on anything affecting the public site; confirm on destructive actions.
- [ ] AI drafts-only + Accept/Edit/Reject + provenance + compliance flags.
- [ ] Audit + role gating intact (server-enforced).
- [ ] Mobile responsive.
- [ ] Roadmap + this checklist updated with PR # and evidence.

## Owner manual steps still outstanding (track here too)
- [ ] Run migrations 0002(?), 0003, 0004, 0005, 0006, 0008 in Supabase (0007 done). *(0002 status unconfirmed — menu-import crash suggests Slice 2 tables may be missing; confirm.)*
- [ ] After 0008: click "Import legacy file" on `/admin/loyalty-signups`.
- [ ] Set up Custom SMTP via Resend (removes email rate limit).
- [ ] Publish a menu version so products/reports/promotions light up.
