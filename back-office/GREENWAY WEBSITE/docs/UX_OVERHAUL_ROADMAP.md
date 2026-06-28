# Greenway Back Office — USER-FRIENDLINESS OVERHAUL Roadmap

> **Goal:** Transform the already-functional back office into a Squarespace/Wix-grade, visual, helper-rich, AI-first, bulletproof experience for a non-technical family business. We do NOT rebuild features — we layer a consistent UX system on top of every existing slice, plus fix the menu-import crash and upgrade charts.
>
> **STANDING RULE — DO THIS EVERY SESSION (non-negotiable):**
> 1. Re-read this roadmap + `UX_OVERHAUL_RESEARCH.md` + `UX_OVERHAUL_CHECKLIST.md` + master `BACK_OFFICE_BUILD_TODO.md`.
> 2. Walk the tree: `find src/app/admin -name "page.tsx" | sort`, `ls src/components/admin`, `ls src/lib`. Trace the logic/data flow for the page you're about to touch (page → action → lib store → supabase) so you never lose sight of what exists or duplicate it.
> 3. Verify before claiming done: `npx tsc --noEmit` (clean) + `./node_modules/.bin/next build` (EXIT 0, route present).
> 4. One slice = one PR (squash-merge, delete branch, sync main). Update the checklist + this roadmap with the PR number and evidence. Never delete tasks — only check them off.
>
> **Delivery model:** incremental UX slices, owner inspects between slices. AI does the work; humans review. Build first, fine-tune visuals continuously since visuals ARE the point of this phase.

---

## Branch / repo conventions (carry-over)
- Repo `mblyman89/GREENWAY-WEBSITE`, branch `main`. Work on `ux/<slice>-<topic>` branches.
- Build with `./node_modules/.bin/next build` (NOT `npx next`). Typecheck `npx tsc --noEmit`.
- Push via `git push https://x-access-token:$GITHUB_TOKEN@github.com/mblyman89/GREENWAY-WEBSITE.git <branch>`; PR via `gh pr create`; merge `gh pr merge --squash --delete-branch`.
- Brand tokens: bg `#000000`, fg `#ffffff`, green `#7ed957`, dark green `#12351f`, gold `#ffd700`, orange `#ff7f00`, charcoal `#1a1a1a`. Status semantics: draft=orange, published=green, archived=grey, error=red, warning=gold.

---

## OVERHAUL SLICE PLAN (build + inspect in order)

### UX-0 — Hotfix & foundation (do first)
**Why first:** stop the bleeding (menu-import crash) and build the shared UX toolkit everything else depends on.
- Crash-proof every admin page that loads DB data (a `SafeData`/error-boundary pattern + friendly fallback). Fix `/admin/menu-imports` specifically.
- Build the **shared UX component kit** in `src/components/admin/ux/`: `Tooltip`, `HelpPanel`, `InfoHint`, `EmptyState`, `ErrorState`, `ConfirmDialog`, `Toast`/`useToast`, `StatusPill`, `Skeleton`, `Breadcrumbs`, `StickyActionBar`.
- Make dashboard slice-checkmarks **data-driven** (no more hardcoded done flags) and add a **Getting Started checklist / setup-status** card (migrations applied? menu published? SMTP set? users invited?).
- Confirm + install the **charting library** (Recharts, owner-approved) wrapped in `src/components/admin/charts/`.

### UX-1 — Global shell & wayfinding
- Apply the new shell consistently: section-highlighted sidebar, breadcrumbs on all detail pages, standardized `AdminPageHeader` with a help toggle, sticky save/publish bar pattern, mobile responsiveness pass.
- Add a global `/admin/help` page (searchable FAQ per section) + a persistent "?" help launcher.
- Apply tooltips + an "How this works" `HelpPanel` to every section's top.

### UX-2 — Live preview engine (the Squarespace core)
- Implement **Next.js Draft Mode** + a reusable `PreviewFrame` (iframe of the public page in draft perspective) usable inside admin editors.
- Implement **click-to-edit overlays (Approach 1)** for controlled content blocks: small "✎ Edit" affordances on previewed regions that deep-link to the exact field editor. Start with the seeded content blocks (home hero, menu hero, loyalty hero, footer warning, business hours).
- Wire **live preview (Approach 2)** into the Content + SEO editors first (lowest risk, highest "wow").

### UX-3 — Visual content & blog editing
- Blog editor: side-by-side live preview, click-to-edit, AI "Write this post / section / SEO for me" front-and-center with Accept/Edit/Reject diff + compliance flags, image picker with thumbnails + AI alt-text.
- Content blocks + SEO: visual editing via the overlay engine; friendly Google-style previews.

### UX-4 — Visual product & media enrichment (AI-heavy)
- Products: thumbnail grid, gap charts, live product-card preview, **AI front-and-center** (description, tags, alt-text), **bulk AI review grid** so one person clears many drafts fast.
- Media: drag-drop dropzone, visual grid, AI alt-text, where-used visual, safe-delete confirmation.

### UX-5 — Visual vendors/brands + promotions
- Vendors/Brands: logo thumbnails, profile-completeness meter, live public-card preview, **"Research with AI"** button (enqueues a job for the Slice 10 pipeline; until that ships, it uses the existing `src/lib/ai/` provider on available metadata).
- Promotions: visual schedule/calendar, affected-products preview with thumbnails, friendly conflict warnings, live sale-badge preview.

### UX-6 — Operational polish: orders, loyalty, reports, users/audit
- Orders: big touch-friendly counter cards, visual status flow, new-order sound/visual alert, ticket print polish.
- Loyalty: friendly queue + dedupe visual + onboarding empty state.
- Reports: upgrade to rich interactive charts (Recharts wrapper), keep CSV.
- Users/Audit: role explainer + permission-matrix visual + friendly audit timeline.

### UX-7 — AI everywhere + Getting-Started wizard
- Audit every page for "where could AI do this instead of the human typing?" and add the button.
- First-run onboarding wizard (setup → upload POS → publish menu → invite staff), reusing the setup-status from UX-0.
- Final visual fine-tune pass + accessibility + mobile sweep.

> **Note on Slice 10 (Crawl4AI worker):** still the separate Python pipeline from the master plan. The "Research with AI" buttons added in UX-5 produce the enqueue points that Slice 10 will consume. Slice 10 remains a separate, owner-gated effort (needs external host + proxies + dummy accounts + ToS decision).

---

## Discovered while building (UX-5 / UX-6) — small follow-ups for a later pass
These are intentional, honest deferrals — each is a small, isolated add, none block the current slices:
- **Public `/vendors` page doesn't exist yet.** The vendor admin revalidates `/vendors`, but there's no public route. UX-5's "live public-card preview" is therefore an in-admin faithful mock (`VendorCardPreview`), not an iframe. Building the real public vendors page is its own (storefront) task; the preview already shows the intended design.
- **"Research with AI" for brands.** `generateVendorProfile` already supports `kind:"brand"`; only the vendor-level button is wired. Adding a brand-level button reusing the same `ai_suggestions` lifecycle is a ~30-line follow-up.
- **Promotion affected-products thumbnails.** `MenuLite` (the match shape) carries no image; per-product enrichment-media joins would be N queries per preview. Currently a 🌿 placeholder (consistent with the product grid). Future: extend `loadPublishedMenuLite` to carry the enrichment image key, then batch-resolve with `resolveMediaUrls`.
- **Order ticket print layout.** The order detail page already prints acceptably (a `PrintButton` exists). A dedicated `@media print` ticket stylesheet (hide chrome, large item list) is a small polish add.
- **Media AI alt-text is context-based, not vision.** (From UX-4.) Text model only. A vision-model upgrade for true image-aware alt text fits in UX-7.
- **New-order chime needs one prior page interaction** (browser autoplay policy). The visual "🔔 N new orders" banner always works regardless; the chime is a bonus once the staffer clicks anything.

## Heavyweight Batch — owner authorized "go full power" ✅ (PRs #54–#58)
Owner: *"continue building… make any lightweight thing heavyweight… proceed with
slice 7… really ship hardcore AI features."* Delivered as five squash-merged PRs;
full detail + evidence in `HEAVYWEIGHT_BATCH_TODO.md`.
- **PR #54 (b42de90)** — resolved the four UX-5/UX-6 follow-ups below to heavyweight:
  brand-level "Research with AI", promotion affected-product **thumbnails** (batched,
  no N+1), dedicated print **ticket** stylesheet, new-order **chime** test+volume.
- **PR #55 (32bde1b)** — AI infra: `generateJSON` / `generateStream` / `generateVision`,
  **vision** alt-text (resolves the context-only deferral), `ai_usage` ledger
  (migration **0009**) + `/admin/ai-usage` dashboard, reusable AI components.
- **PR #56 (24dee6d)** — UX-7 AI everywhere: **SEO** meta AI (live Google preview) +
  **Promotions** copy AI (name/announcement/badge). Blog/content/products already had AI.
- **PR #57 (23fb4f9)** — UX-7 **Getting-Started wizard** (`/admin/getting-started`)
  reusing UX-0 setup-status + an **AI setup concierge** grounded in SETUP_GUIDE.
- **PR #58 (442019b)** — heavyweight upgrades: **Reports AI insights** briefing,
  **⌘K command palette**, **Activity-log filters + search**.

> All UX-5/UX-6 deferrals listed below are now **resolved** (brand AI, promo
> thumbnails, print ticket, vision alt-text, chime). The only remaining honest
> deferral is the public `/vendors` storefront route (a storefront task, not
> back-office), so the in-admin `VendorCardPreview` remains a faithful mock.

## Definition of done (per UX slice)
1. Shared components reused (no one-off styling).
2. Every new/changed page has: friendly empty state, caught/ friendly error state, tooltips/help, loading skeleton, consistent status pills.
3. Anything that changes the public site has a preview before publish; destructive actions confirm.
4. AI buttons present wherever a human would otherwise type from scratch; AI output is drafts-only with Accept/Edit/Reject + provenance + compliance flags.
5. `tsc` clean + `next build` EXIT 0 + route present. Mobile check.
6. Audit + permissions intact. Checklist + roadmap updated with PR # and evidence. Owner inspected.
