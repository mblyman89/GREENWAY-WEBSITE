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
- [ ] pending
## Slice 64 — Dashboard overhaul (POS cockpit)
- [ ] pending
