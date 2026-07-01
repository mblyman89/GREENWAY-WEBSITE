# Back Office Review Tasklist — Slices 43–64

Slices 43–61: [x] (done, merged)

## Slice 62 — Audit log: filters + AI anomaly detection
- [x] Ground: audit_logs schema, audit page, AuditTimeline, audit-humanize, full action vocabulary, AI provider
- [x] Core: audit-anomaly-core.ts — PURE action-category map + deterministic anomaly rules + tests (30 assertions)
- [x] Server: audit-anomaly.ts — load recent logs, run detector, grounded AI summary (drafts-only)
- [x] Action: anomaly AI server action (users.manage-gated)
- [x] Filters: upgrade AuditTimeline (date range, category, entity type, sensitive-only); window widened 200→500
- [x] UI: anomaly panel on audit page (deterministic findings + grounded AI assistant, collapsible)
- [x] Verify: tsc 0, eslint 0, next build ok (/admin/audit present)
- [ ] Commit → push → PR → merge → sync main
- NOTE: NO migration — detection is stateless over existing audit_logs

## Slice 63 — Settings overhaul
- [x] Ground: current hub (1 card), existing settings tables (tax_settings+tax_category_rules, pricing_settings actively READ but NO UI; site_settings unused KV; license_settings), helper signatures, nav
- [x] Store profile: store-profile-core (25 assertions) over site_settings KV + store + editor page + action (settings.manage, audited)
- [x] Tax settings: editor page for tax_settings (rates %→bps, medical endorsement, base mode) + per-category cannabis rules (tax_category_rules) + actions
- [x] Pricing settings: editor page for pricing_settings (min markup, rounding, default tax rate) + action
- [x] Hub overhaul: 6 categorized groups linking 11 REAL settings surfaces (all routes verified) with live status pills
- [x] Nav: /admin/settings stays the Settings entry (sub-pages linked from hub)
- [x] Verify: tsc 0, eslint 0, next build ok (/admin/settings/{store-profile,tax,pricing} present)
- [ ] Commit → push → PR → merge → sync main
- NOTE: NO migration — all tables already exist (site_settings, tax_settings, tax_category_rules, pricing_settings, license_settings)
## Slice 64 — Dashboard overhaul (POS cockpit)
- [ ] pending
