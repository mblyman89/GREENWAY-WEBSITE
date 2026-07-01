# Working TODO — Back-Office Enhancements (execution)

Owner approved: finish enhancements first. Proceed in most-logical order, 6 slices at a time,
stop only for clarification. Ground everything in fact. One branch + PR per slice, squash-merge.

## Confirmed owner answers
- Q1 POS platform: DISCUSS strategy more before building POS (owner unfamiliar with SwiftUI). NOT building POS yet.
- Q2 Hardware: Star TSP143IIIBi (BT thermal, auto-cutter), Socket DuraScan D760, iPad Pro 12.9" 6th gen, POS-X drawer via printer cable.
- Q3 Payments: cash-only now; build GENERIC compliant credit/debit pipeline stub for future provider.
- Q4 Strain types: display + website only; map to nearest CCRS base category on export. VERIFY CCRS value first.
- Q5 Nav org: research-backed reorg; extra dropdowns OK; best judgement.
- Q6 Order: my judgement.

## Execution order (my judgement — quick wins + compliance-adjacent first, grouped for coherence)
### Batch 1 (6 slices) — DONE (PR pending)
- [x] S1 (E12) Quick-search: circle-only, removed "Quick search" text; stacked above Help "?"; ⌘K + aria kept
- [x] S2 (E2)  Nav dropdown hover fix: hover-intent close delay (220ms) + pt-2 bridge (no dead gap) + menu-hover keeps open
- [x] S3 (E10) Preview banner -> glowing bottom-right badge (gw-preview-glow keyframe, reduced-motion aware); expand for Exit; header no longer covered
- [x] S4 (E6)  Newsletter engagement surfaced on Send Center (reuses NewsletterStatsSection + getNewsletterStats, 90-day window)
- [x] S5 (E11) Nav reorg into 8 research-backed buckets: Sell/Inventory/Compliance/Finance/Marketing/Website/Insights/Admin
- [x] S6 (E4)  Strain types: VERIFIED CCRS accepts only Indica/Sativa/Hybrid; leaning labels contain "hybrid" -> export as Hybrid (proven). Added to VALID_STRAIN, MenuFilters, StrainEditor; interactive filter derives dynamically; no DB migration (text col, no constraint)

### Batch 2 (6 slices)
- [ ] S7  (E7)  Inventory intake: surface + autofill manifest fields from Vendors (CCRS/WAC 314-55-085)
- [ ] S8  (E9)  Vendor ACH portal UI (core exists; template = payroll ACH)
- [ ] S9  (E1)  Marketing & Advertising page + GPT-4o compliant-strategy assistant + save ideas
- [ ] S10 (E5)  Global AI chatbot (extend concierge to full back office/website/POS)
- [ ] S11 (E3)  Flux image builder: up to 8 reference images + pro features
- [ ] S12 (E8)  Menu-imports hardening + Clean-Slate test-data reset
- [ ] S13 (E13) Integrations page: helpers + AI assistance (depends on S10 assistant)

Note: 13 items total; "6 at a time" = two batches then a remainder. Will pause after each batch to report.
