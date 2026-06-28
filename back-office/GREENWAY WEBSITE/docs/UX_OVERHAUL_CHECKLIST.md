# Greenway Back Office — UX Overhaul Working Checklist

> Granular, check-off-as-you-go task list for the user-friendliness overhaul. Pairs with `UX_OVERHAUL_ROADMAP.md` (the plan) and `UX_OVERHAUL_RESEARCH.md` (the why). **Never delete tasks — mark `[x]` with evidence (PR #, route, screenshot note).**
>
> **EVERY SESSION FIRST:** re-read roadmap + research + this file + master `BACK_OFFICE_BUILD_TODO.md`; walk the tree (`find src/app/admin -name page.tsx`, `ls src/components/admin`, `ls src/lib`); trace the data flow (page → action → lib store → supabase) for the target page. Verify with `tsc` + `next build` before claiming done.

---

## UX-0 — Hotfix & foundation
### Crash fix
- [ ] Create a `SafeData` server helper / pattern that wraps DB reads and returns `{ ok, data, error }` so a missing table or query failure NEVER crashes a page.
- [ ] Fix `/admin/menu-imports/page.tsx`: wrap `getPublishedVersion/listVersions/listImports` in SafeData; on failure render a friendly "Your database tables aren't set up yet — here's how" card (link to migration step), not a crash. (Root cause: Slice 2 migration likely not applied + page didn't guard the queries.)
- [ ] Audit ALL admin pages for the same unguarded-`Promise.all` pattern; apply SafeData where needed (`menu-imports/[id]`, products, vendors, promotions, orders, reports, blog, content — anything reading DB at the top).
- [ ] Add a route-level `error.tsx` for `/admin` that renders the friendly branded error card (replaces the current generic preview-error screen for admin).

### Shared UX component kit (`src/components/admin/ux/`)
- [ ] `Tooltip` — accessible hover/focus tooltip (brand-styled).
- [ ] `InfoHint` — a small "?" that opens a Tooltip/popover with contextual help.
- [ ] `HelpPanel` — collapsible "How this works" panel for the top of complex pages.
- [ ] `EmptyState` — icon + title + explanation + primary CTA (per NN/g guidance).
- [ ] `ErrorState` — friendly error card with cause + "what to do" + retry.
- [ ] `ConfirmDialog` — for destructive/irreversible actions (explains consequence).
- [ ] `Toast` + `useToast` — success/error feedback after actions.
- [ ] `StatusPill` — consistent status colors (draft/published/archived/error/warning).
- [ ] `Skeleton` — loading placeholders (no blank/misleading states).
- [ ] `Breadcrumbs` — wayfinding on detail pages.
- [ ] `StickyActionBar` — always-reachable Save/Publish/Cancel.
- [ ] Barrel `index.ts` export; document each with a short usage comment.

### Dashboard truthfulness + getting started
- [ ] Make slice-progress checkmarks data-driven (read from a single source, not hardcoded) so they reflect reality (Slices 1–9 done).
- [ ] Build a **Setup Status** util: which migrations are applied (probe each table), is a menu published, is SMTP configured (env), are non-bootstrap users invited.
- [ ] Add a **Getting Started checklist** card on the dashboard that shows the next single action, using Setup Status.

### Charting
- [ ] Confirm library with owner (Recharts recommended). Install once approved.
- [ ] Build `src/components/admin/charts/` wrapper (BarChart, LineChart, AreaChart, Donut/Pie, Sparkline) taking brand tokens; the app imports the wrapper only.
- [ ] `tsc` + `build` clean. **PR + owner inspect.**

## UX-1 — Global shell & wayfinding
- [ ] Sidebar: current-section highlight + icons + grouped sections; mobile drawer.
- [ ] `AdminPageHeader`: add optional help toggle (mounts `HelpPanel`) + breadcrumbs slot.
- [ ] Apply `HelpPanel` + tooltips to each section's main page.
- [ ] `/admin/help` page: searchable FAQ per section (mirrors `BACK_OFFICE_USER_GUIDE.md`).
- [ ] Global "?" help launcher in the shell.
- [ ] Mobile-responsive pass on shell + tables (counter staff on phones).
- [ ] `tsc` + `build` clean. **PR + owner inspect.**

## UX-2 — Live preview engine
- [ ] Implement Next.js **Draft Mode** enable/disable routes (`/api/admin/preview/...`).
- [ ] `PreviewFrame` component (iframe of public page in draft perspective, with device-size toggles desktop/tablet/mobile).
- [ ] Click-to-edit overlay system for controlled content blocks (data-attribute → deep-link to field editor). Start with seeded blocks (home hero, menu hero, loyalty hero, footer warning, business hours).
- [ ] Wire live preview into Content editor (`/admin/content`) + SEO editor first.
- [ ] `tsc` + `build` clean. **PR + owner inspect.**

## UX-3 — Visual content & blog editing
- [ ] Blog editor: side-by-side `PreviewFrame`, click-to-edit, AI "Write post/section/SEO" with Accept/Edit/Reject diff + compliance flags, image picker w/ thumbnails + AI alt-text.
- [ ] Content blocks + SEO: visual editing via overlays; friendly previews.
- [ ] `tsc` + `build` clean. **PR + owner inspect.**

## UX-4 — Visual product & media enrichment (AI-heavy)
- [ ] Products: thumbnail grid, gap charts, live product-card preview, AI description/tags/alt-text front-and-center, **bulk AI review grid**.
- [ ] Media: drag-drop dropzone, visual grid, AI alt-text, where-used visual, safe-delete confirm.
- [ ] `tsc` + `build` clean. **PR + owner inspect.**

## UX-5 — Visual vendors/brands + promotions
- [ ] Vendors/Brands: logo thumbnails, completeness meter, live public-card preview, "Research with AI" enqueue button.
- [ ] Promotions: visual schedule/calendar, affected-products preview w/ thumbnails, friendly conflict warnings, live sale-badge preview.
- [ ] `tsc` + `build` clean. **PR + owner inspect.**

## UX-6 — Operational polish
- [ ] Orders: big touch cards, visual status flow, new-order alert, ticket polish.
- [ ] Loyalty: friendly queue + dedupe visual + onboarding empty state.
- [ ] Reports: rich interactive charts (Recharts wrapper), keep CSV.
- [ ] Users/Audit: role explainer + permission-matrix visual + friendly audit timeline.
- [ ] `tsc` + `build` clean. **PR + owner inspect.**

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
