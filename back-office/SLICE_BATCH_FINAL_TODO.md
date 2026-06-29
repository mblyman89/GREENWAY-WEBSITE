# Final batch — Slices A–E (this session)

Owner instructions (verbatim intent):
- Newsletter: add an UNSUBSCRIBE option if not baked in (compliance-critical).
- Footer: make the store-hours IMAGE editable.
- Site Content page: reduce to FOOTER editing only (top header has nothing to edit).
- AI helpers: owner set a GPT key (likely OPENAI_API_KEY). Code reads AI_API_KEY.
  Diagnose + activate; tell owner exactly what env to set.
- Slice 3b: per-page banner seeding for non-home pages.

## Slice A — AI activation (env compatibility)
- [ ] provider.ts: accept OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL as
      fallbacks for AI_API_KEY / AI_BASE_URL / AI_MODEL (either name works).
- [ ] Verify isAiConfigured flips on; document required env for owner.

## Slice B — Newsletter unsubscribe (compliance)
- [ ] Migration 0017: loyalty_signups.email_opt_out (bool) + unsubscribe_token
      (uuid) OR a separate unsubscribes table. Keep idempotent.
- [ ] Recipients query excludes opted-out.
- [ ] Email footer: per-recipient unsubscribe link with token.
- [ ] Public /unsubscribe route (token) → mark opt-out, friendly confirmation.

## Slice C — Footer store-hours image editable + Site Content = footer only
- [ ] Find footer hours image; back it with a content block / media field.
- [ ] Site Content page renders ONLY the footer group (header removed from UI).
- [ ] Editable: footer hours image (+ existing footer fields).

## Slice D — Slice 3b per-page banner seeding (non-home pages)
STATUS: in progress. Pattern = add SectionSeed to PAGE_SECTION_SEEDS + wire the
public page via getSectionsForRender(slug) with static `||` fallback (live look
preserved). Builder UI + nav already exist for all 9 slugs. No migration (0013
already applied). Target pages with a clean hero band: specials, loyalty, menu,
vendors. (about/locations/price-match heroes are bespoke multi-span layouts —
seed faithfully where the band maps cleanly; otherwise leave as-is to avoid
breaking layout per the "approved spots" philosophy.)
- [ ] Seed + wire banners for about, locations, vendors, specials, loyalty, menu,
      price-match (faq banners already have a tab). One page at a time, faithful.

Each slice: tsc + eslint + build clean → PR → squash-merge → sync main.
Migrations applied MANUALLY by owner.
