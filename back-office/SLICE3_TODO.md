# Slice 3 — Hotfixes + Public Page Sections

## A. Hotfixes (owner-reported, must ship first)
- [ ] Bug 1: Sections tab shows no banner image. Root cause: seed paths
      `/brand/greenway-shop-by-*-banner.png` don't exist; real files are
      `/home/category-banner.webp` & `/home/brand-banner.webp`. Fix seed +
      self-heal already-seeded rows.
- [ ] Bug 2: Can't save/publish section edits. Root cause: SectionCard save &
      publish forms omit required `page_slug` hidden input → server action
      bounces to /admin/content. Pass `pageSlug` prop → render hidden inputs in
      every form (save, publish, delete, move).
- [ ] Bug 3: Media upload "gone". Root cause: long Pages group pushed Content
      group (Media Library/Blog/Site Content) below the fold. Reorder nav so
      Content is discoverable (move above Pages).

## B. Public page sections (Slice 3 proper)
- [ ] Create `<PageSection>` public renderer (mirror SectionBanner styling,
      buttons, focus, align, editable data attrs).
- [ ] Wire home Category + Brand banners to page_sections (draft-aware, static
      fallback so live look never breaks).
- [DEFERRED → Slice 3b] Seed remaining pages' banners faithfully. Each page's
      banner markup is bespoke (not a shared SectionBanner), so faithful
      seeding + per-page wiring is its own focused slice. Infra already supports
      it via PAGE_SECTION_SEEDS + getSectionsForRender(slug).

## C. Verify
- [ ] tsc clean, eslint clean, `next build` clean.
- [ ] Update PROGRESS_TRACKER.md + ROADMAP progress log.

## D. In-chat (non-code), parallel
- [ ] Answer preview-tab question (keep Site Content preview screen + top
      "Preview mode" banner).
- [ ] Careful Resend + GoDaddy/SecureServer DNS walkthrough (registrar is
      SecureServer/GoDaddy, NOT Google Workspace DNS — domain greenwaymarijuana.com).
