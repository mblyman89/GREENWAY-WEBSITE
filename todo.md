# Greenway — Site Content Editor Enhancements (3 Slices)

Standing rule: re-read roadmap/checklists + walk file tree each session. AI output = drafts-only, staff-validated. One PR per slice (squash-merge, delete branch, sync main).

## Context (read & understood this session)
- Content system: `src/lib/cms/content-store.ts` (CRUD), `content-blocks-seed.ts` (curated block list), `render-content.ts` (`getContentForRender`/`getContentValues`, draft-aware via Draft Mode), `types.ts` (`ContentFieldType` already has `"image"`).
- Admin UI: `src/app/admin/content/page.tsx` + `actions.ts`; `ContentPreviewPanel.tsx` (own page selector), `ContentBlocksBrowser.tsx` (own page filter — THIS mismatch causes the edit-jump bug), `ContentBlockEditor.tsx` (only handles plain/rich), `PreviewFrame.tsx` (iframe + postMessage `gw-preview-edit`).
- Public: `Hero.tsx` (hardcoded `SLIDES[3]`; only slide1 "welcome" text editable), `SectionBanner.tsx`, `LoyaltySignupForm.tsx` (hero img from `greenwayBusiness.assets.loyaltyHero`), `SiteText.tsx`, `PreviewEditOverlay.tsx`.
- Migrations: 0001–0010 done (0010 = content_revisions). New migration → 0011.
- Brand tokens: green #7ed957, dark-green #12351f, gold #ffd700, orange #ff7f00, charcoal #1a1a1a/#0a0a0a.

## SLICE A — Editable banner images + fix edit-jump bug + snag hardening — ✅ DONE (PR pending merge)
- [x] Re-read roadmap + schema (standing rule)
- [x] Implement `"image"` field type in ContentBlockEditor (ContentImageField: Media Library picker + paste URL + live thumbnail + clear)
- [x] Add image content blocks: home hero image, loyalty hero (desktop+mobile), category banner, brand banner
- [x] Wire those images into Hero.tsx / LoyaltySignupForm.tsx / SectionBanner (category+brand) via render-content + data-gw-block attrs
- [x] Fix edit-jump bug: ContentEditorShell lifts shared pageFilter+previewPath; clicking ✎ Edit auto-switches page + scrolls + focuses (queued retry)
- [x] Harden "Server Action not found" snag: admin error boundary auto-reloads once on stale-action error (one-shot guard) + friendly "Reload page"
- [x] VALUE-ADD: unsaved-edits guard + per-block dirty indicator (beforeunload warning, gold "● unsaved edits" badge)
- [x] tsc clean + eslint clean + build clean (~2374 pages)
- [ ] PR; update tracker

## SLICE B — Full carousel management (add/edit/delete slides, max 6)
- [ ] Re-read roadmap (standing rule)
- [ ] Migration 0011: `home_carousel_slides` table (or JSON content block) — image, eyebrow, title, subtitle, ctas[], sort_order, enabled (+RLS, public read)
- [ ] Carousel manager UI: add slide, edit each (image+text+2 CTAs), reorder (up/down), enable/disable, delete; cap 6
- [ ] Migrate existing 3 hardcoded slides as seed
- [ ] Hero.tsx reads slides from DB (draft-aware); fallback to seed if empty
- [ ] tsc + eslint + build clean; PR; update tracker

## SLICE C — Font library + font picker
- [ ] Re-read roadmap (standing rule)
- [ ] Font library: curated Google Fonts + brand fonts (DB-backed list or typed registry + loader)
- [ ] Load chosen fonts via next/font or <link>; expose CSS vars
- [ ] Font picker control in editor for heading-bearing blocks; store choice
- [ ] Public pages apply chosen font to the matching text
- [ ] tsc + eslint + build clean; PR; update tracker

## VALUE-ADD (agent's professional judgement — not explicitly requested)
- [ ] "Unsaved changes" guard + per-block dirty indicator in editor (prevents losing edits)
- [ ] Decide + implement during slices where it fits best (likely Slice A editor work)

## NOTES
- Disk tight: clear .next before/after builds. Build = ~2374 static pages. Use ./node_modules/.bin/next build.
- Image blocks store a URL string (media public URL or path under /public). Keep field_type union intact.
