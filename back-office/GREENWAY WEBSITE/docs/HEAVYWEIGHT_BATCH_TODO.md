# Heavyweight Build Batch — owner authorized "go full power"

> Owner: "Start with the small documented follow-ups. Then go back and make any
> lightweight thing from slices 0–6 a heavyweight version. Then proceed with
> slice 7. Build everything heavyweight. Add every helpful feature. Especially
> ship hardcore AI features. A feature-rich experience is what I'm after."
>
> Each numbered group = one PR (squash-merge, delete branch, sync main).
> Verify each: `npx tsc --noEmit` clean + `./node_modules/.bin/next build` EXIT 0.

---

## PR A — Documented follow-ups (the deferrals), done heavyweight ✅ #54 (main b42de90)
- [x] **Brand-level "Research with AI"** — `generateVendorProfile({kind:"brand"})`
      wired into brand editor; per-brand pending suggestions with Accept/Reject,
      compliance flags + provenance; added `product_philosophy` to the lifecycle
      (whitelisted Accept to mission_statement/about/product_philosophy).
- [x] **Promotion affected-products thumbnails** — `previewAffectedProductsWithImages`
      batch-resolves the enrichment primary image per product (2 batched queries,
      no N+1); real thumbnails in the preview + SaleBadgePreview sample image.
- [x] **Order ticket print layout** — rewritten ticket + `@media print` rules in
      globals.css (hide chrome, huge order number, boxed customer, cut line).
- [x] **New-order chime** — "test sound" button (arms autoplay), volume slider,
      one-time autoplay hint, persisted to localStorage.

## PR B — AI infrastructure upgrade (foundation for hardcore AI) ✅ #55 (main 32bde1b)
- [x] **Streaming + JSON-mode provider** — `generateJSON<T>()`, `generateStream()`,
      `looseJsonParse<T>()` added to provider.
- [x] **Vision support** — `generateVision()`; media alt-text now image-aware for
      raster images with a context fallback (surfaces method in the toast).
- [x] **AI usage ledger** — migration `0009_ai_usage_ledger.sql` (`ai_usage` table,
      staff RLS) + `src/lib/ai/usage.ts` (best-effort logging) + `/admin/ai-usage`
      dashboard (KPIs, tokens trend, feature donut, by-feature table). Nav: AI Usage.
- [x] **Reusable AI building blocks** — `AiSection`, `AiDraftCard`,
      `AiComplianceFlags`, `AiBusyButton`, `AiUsageCharts` in components/admin/ai.

## PR C — AI everywhere (slice 7 part 1): content surfaces ✅ #56 (main 24dee6d)
- [x] Blog: already had Write/Improve/SEO/Hero-alt AI (ai-blog.ts) — verified.
- [x] Content blocks: already had "Rewrite friendlier/shorter/on-brand" — verified.
- [x] SEO: **NEW** `ai-seo.ts` + `suggestSeoAction` → "✨ Generate with AI" fills
      meta-title + description (clamped 60/160) with live Google preview + char
      counters + compliance flags (SeoEntryEditor).
- [x] Products: already had AI tags + alt-text + improve description — verified.
- [x] Promotions: **NEW** `ai-copy.ts` + `suggestPromotionCopyAction` → "✨ Write
      the copy with AI" reads the chosen mechanics from the form and drafts promo
      name + announcement + badge (PromotionAiCopy, wired into new + edit forms).

## PR D — Getting-Started onboarding wizard (slice 7 part 2) ✅ #57 (main 23fb4f9)
- [x] First-run multi-step wizard at `/admin/getting-started` reusing UX-0
      setup-status probes: step rail, live Done/To do/Checking badges, per-step
      why + numbered how-to + time + deep-link CTA, Back/Next auto-advancing to
      the next unfinished step, overall progress bar.
- [x] Rich `SETUP_GUIDE` content for every step (single source of truth).
- [x] **AI setup concierge** — `ai-setup-assistant.ts` + `askSetupAction`: ask
      plain-language setup questions, answered grounded in SETUP_GUIDE (read-only).
- [x] Dashboard "Open full walkthrough →" link + nav entry (🚀 Getting Started).

## PR E — Heavyweight upgrades to lightweight slice 0–6 pieces ✅ #58 (main 442019b)
- [x] Reports: **NEW** "✨ AI insights" panel (`ai-insights.ts` +
      `generateReportInsightsAction`) — PII-free aggregate digest → headline /
      going-well / watch-out / do-next briefing (ReportInsightsPanel). Range
      buttons (7/30/90) already present.
- [x] Global command palette (⌘K / Ctrl+K) — fuzzy nav across every page the
      role can open (filtered server-side), arrow-nav + Enter, floating hint
      button (CommandPalette mounted in admin layout).
- [x] Activity log: filters (free text, actor, action tone) + search + live
      count + Clear (AuditTimeline; humanized server-side, filtered client-side).
- [~] Dashboard "daily briefing": deferred — the Reports AI insights panel
      covers the AI-narrative need; richer dashboard KPIs already shipped in UX-6.

## Cross-cutting (every PR) ✅
- [x] Friendly empty/error/loading states, tooltips, status pills, mobile-aware.
- [x] AI drafts-only, Use/Try-again/Discard, provenance, compliance flags; every
      AI surface gracefully no-ops when AI_API_KEY is unset.
- [x] Audit + permissions intact. Every action permission-gated + audited; AI
      usage logged best-effort to the ai_usage ledger.

---

## Evidence (every PR)
- `npx tsc --noEmit` → EXIT 0 on each PR.
- `./node_modules/.bin/next build` → ✓ Compiled + **2374/2374** static pages each.
- All five PRs squash-merged, branches deleted, main synced.

## Outstanding owner manual steps (no code can do these)
- Run all Supabase migrations **including the new `0009_ai_usage_ledger.sql`**.
- Set `AI_API_KEY` (+ optional `AI_BASE_URL` / `AI_MODEL` / `AI_VISION_MODEL`) to
  light up every AI feature shipped above (all degrade gracefully without it).
- Rotate the Resend API key that was exposed in chat; set up Resend Custom SMTP +
  verify the domain; create `orders@` / `loyalty@greenwaymarijuana.com` aliases.
- Publish a menu version so promotions/affected-products/reports populate.
