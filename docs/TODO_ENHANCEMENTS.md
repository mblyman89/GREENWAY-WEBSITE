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
- [x] S7  (E7)  Manifest transport form + schema ALREADY existed (0044/Slice 33). Added stable vendor license_number (migration 0064) + autofill origin license/name from linked vendor on the manifest transport form. MIGRATION 0064 = manual apply.
- [x] S8  (E9)  Vendor ACH portal UI built at /admin/vendor-payments (Finance nav) reusing vendor-ach-core + shared payroll ACH settings; dollars→cents; validates then downloads NACHA CCD draft; audit logged.
- [x] S9  (E1)  Marketing & Advertising page + GPT-4o compliant-strategy assistant + save-to-notebook. Reuses COMPLIANCE_SYSTEM + checkCompliance + buildBrandContext grounding. MIGRATION 0065 (marketing_ideas) = manual apply.
- [x] S10 (E5)  Global AI concierge chatbot mounted on every admin page (bottom-right 🤖, clear of Help "?" + Quick-search). Grounded on SETUP_GUIDE + CONCIERGE_KB; POS flagged planned-not-built; read-only.
- [x] S11 (E3)  FLUX.2 multi-reference: up to 8 reference images (VERIFIED via docs.bfl.ai — input_image/input_image_2… URL or base64) + prompt-upsampling toggle + numbered reference gallery picker. 39 self-test assertions pass.
- [x] S12 (E8)  Menu-imports test-mode flag + confirm-gated Clean Slate. MIGRATION 0066 adds is_test to pos_imports+menu_versions and clean_slate_test_data() (deletes ONLY is_test, never published, never kb_*). Requires typing "DELETE TEST DATA". = manual apply.
- [x] S13 (E13) Integrations page: collapsible step-by-step "How to connect" panels per card (INTEGRATION_GUIDES: leafly/weedmaps/flux/sage50/cultivera) + grounded "Ask about integrations" AI helper (answerIntegrationQuestion). settings.manage-gated, audit-logged, read-only.

## Manual migrations to apply (owner, in Supabase SQL editor — idempotent)
- 0064_vendor_license_number.sql (S7)
- 0065_marketing_ideas.sql (S9)
- 0066_test_data_clean_slate.sql (S12)

## Status: ALL 13 enhancements complete. POS build NOT started — awaiting Q1 strategy discussion.

Note: 13 items total; "6 at a time" = two batches then a remainder. Will pause after each batch to report.
