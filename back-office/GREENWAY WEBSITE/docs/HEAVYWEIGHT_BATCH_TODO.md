# Heavyweight Build Batch — owner authorized "go full power"

> Owner: "Start with the small documented follow-ups. Then go back and make any
> lightweight thing from slices 0–6 a heavyweight version. Then proceed with
> slice 7. Build everything heavyweight. Add every helpful feature. Especially
> ship hardcore AI features. A feature-rich experience is what I'm after."
>
> Each numbered group = one PR (squash-merge, delete branch, sync main).
> Verify each: `npx tsc --noEmit` clean + `./node_modules/.bin/next build` EXIT 0.

---

## PR A — Documented follow-ups (the deferrals), done heavyweight
- [ ] **Brand-level "Research with AI"** — wire `generateVendorProfile({kind:"brand"})`
      into brand editor with full Accept/Reject + compliance + provenance. Add
      brand profile fields (product_philosophy) to the suggestion lifecycle.
- [ ] **Promotion affected-products thumbnails** — extend the menu-lite loader to
      carry the enrichment image key; batch-resolve media URLs; show real
      thumbnails in the affected-products preview (replace 🌿 placeholder).
- [ ] **Order ticket print layout** — dedicated `@media print` ticket stylesheet
      (hide chrome, big item list, barcode-ish order number, cut line).
- [ ] **New-order chime** — already visual-first; add a "test sound" button +
      clearer enable hint (autoplay policy) and volume in settings.

## PR B — AI infrastructure upgrade (foundation for hardcore AI)
- [ ] **Streaming + JSON-mode provider** — add `generateJSON<T>()` and
      `generateStream()` to provider; structured output for reliable parsing.
- [ ] **Vision support** — `generateVision()` for true image-aware alt-text &
      product photo analysis (upgrade media alt-text from context-only).
- [ ] **AI usage ledger** — `ai_usage` table + logging (model, tokens est,
      feature, actor) for cost visibility; surface on a dashboard card.
- [ ] **Reusable AI building blocks** — `AiDraftCard`, `AiAcceptRejectBar`,
      `AiComplianceFlags`, `AiBusyButton` components so every AI surface looks
      identical and consistent.

## PR C — AI everywhere (slice 7 part 1): content surfaces
- [ ] Blog: "Write full post", "Improve", "SEO meta", "Outline", "Summarize"
      AI actions with diff Accept/Edit/Reject.
- [ ] Content blocks: "Rewrite friendlier / shorter / on-brand" per block.
- [ ] SEO: AI meta-title + meta-description + OG generation with live Google preview.
- [ ] Products: AI tags + alt-text + "improve description" (beyond bulk).
- [ ] Promotions: AI promo name + announcement copy generator.

## PR D — Getting-Started onboarding wizard (slice 7 part 2)
- [ ] First-run multi-step wizard reusing UX-0 setup-status: migrations →
      upload POS → publish menu → brand basics → invite staff → AI key → email.
- [ ] Persistent progress, resumable, celebratory completion, dismissible.
- [ ] Dashboard "Finish setup" card linking into the wizard.

## PR E — Heavyweight upgrades to lightweight slice 0–6 pieces
- [ ] Reports: add date-range filter, more interactive charts, AI "explain these
      numbers" narrative summary, top-movers, comparison vs prior period.
- [ ] Vendor card preview → make it a true live preview if public route added,
      else richer mock with brand chips & product count.
- [ ] Global command palette (⌘K) for fast navigation + quick AI actions.
- [ ] Activity log: filters (by actor, by type, by date), search.
- [ ] Dashboard: richer KPIs, sparklines, AI "daily briefing".

## Cross-cutting (every PR)
- [ ] Friendly empty/error/loading states, tooltips, status pills, mobile.
- [ ] AI drafts-only, Accept/Edit/Reject, provenance, compliance flags.
- [ ] Audit + permissions intact. Update checklist + roadmap with PR # + evidence.
