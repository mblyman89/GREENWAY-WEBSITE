# Settings completeness + AI hardening

## Verbatim request (Msg G)
"Thank you. Now will you make sure the settings page has everything it should with
respect to the entire project. Also, since you will be walking the full tree for the
settings page task, I want you to document every single little thing you can about the
project and how to use it. I noticed our in app ai is not very good at all and doesn't
know anything about the project or how to use it. I want you to harden it so it give
useful and accurate information when asked. Please proceed. Thank you."

## Plan
### Part 1 — Walk the full tree (documentation source of truth)
- [x] Enumerate every /admin route (page.tsx) + purpose (~110 routes)
- [x] Enumerate configurable surfaces (settings, stores, actions)
- [x] Map admin nav groups -> pages (admin-nav-data.ts canonical)
- [x] Identify the in-app AI assistant(s) + how they get context
      (ConciergeWidget -> concierge-actions -> concierge-assistant grounded
       on SETUP_GUIDE + CONCIERGE_KB. KB is thin (14 topics) & STALE.)

### Part 2 — Settings completeness audit
- [x] List every settings-like destination in the app
- [x] Compare against current settings/page.tsx cards
- [x] Add missing config surfaces: Equipment hub, KB starter data,
      AI usage & cost, Compliance health (grouped, no clutter)
- [x] Verify live-status reads still cheap/safe (unchanged: profile/tax/pricing)

### Part 3 — Document everything (project knowledge)
- [x] Write comprehensive project doc (docs/PROJECT_GUIDE.md)

### Part 4 — Harden in-app AI
- [x] Find how AI assistant builds its system prompt / context (concierge)
- [x] Inject accurate project knowledge — rewrote concierge-kb.ts
      (14 stale topics -> 30 current topics, all 11 tabs, tab+href each) and
      tightened the SYSTEM prompt with the real tab list.
- [x] Verify tsc / eslint / build (all exit 0)
- [ ] Branch + PR + squash-merge

## Notes
- Money in MINOR UNITS (cents). CCRS + DOH compliance always.
- AI output = drafts only. Never guess. Handoff-ready.
