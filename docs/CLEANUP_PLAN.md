# Production-Readiness Cleanup Plan

Tracking file for the owner's request: (A) extend "Clean Slate" to reset
operational/transactional data while preserving owner settings + KB, (B) remove
mock data/features so real logic flows end-to-end, (C) prep for real inventory
intake from past JSONs.

## Standing rules
- Never guess. Find everything in the file tree. Ground in verified schema.
- Money in MINOR UNITS (cents). Always satisfy CCRS + DOH compliance.
- Migrations applied MANUALLY by owner; keep idempotent.
- `main` branch-protected: branch + PR + squash-merge only.
- Work in slices; AI output = drafts.

## TODO

### Phase 0 — Discovery (verify, never guess)
- [x] Enumerate every DB table from supabase/migrations (authoritative schema) — 105 tables.
- [x] Read existing Clean Slate (0066 + import-service + admin UI) — scoped ONLY to test-flagged pos_imports + non-published test menu_versions. Does NOT clear sales/COGS/products/loyalty/orders/inventory.
- [x] Inventory all mock modules/usages.
- [x] Classify each table (see PROPOSED CLASSIFICATION below).
- [ ] OWNER CONFIRMATION of classification before building destructive reset.

## PROPOSED TABLE CLASSIFICATION (verified from migrations)

### KEEP — Owner settings / configuration (NEVER delete)
site_settings, tax_settings, tax_category_rules, tax_base_mode, pricing_settings,
license_settings, accounting_settings, ach_company_settings, loyalty_config,
loyalty_tiers, loyalty_promotions, reorder_settings, sample_settings,
trade_sample_settings, sales_limit_settings, sales_limit_override,
medical_endorsement_config, receipt_printer_settings, integration_credentials,
flux_credentials, inventory_types, website_category_types, registers, employees,
staff_profiles, equipment_assets, webauthn_credentials, webauthn_challenges

### KEEP — Knowledge base (NEVER delete)
kb_strains, kb_terpenes, kb_brands, kb_category_terms, kb_banned_phrases,
kb_image_substitutes, kb_notes

### KEEP — CMS / marketing content authored by owner (NEVER delete by default)
content_blocks, content_revisions, page_sections, blog_posts, home_carousel_slides,
faq_items, media_assets, media_usages, newsletter_assets, seo_entries,
marketing_ideas, promotions*, brands, brand_aliases, vendors, vendor_aliases,
product_masters, product_master_members  (these are owner-curated catalog/brand config)

### CLEAR — Operational / transactional (the "test data" the owner wants reset)
Sales & COGS: orders, order_lines, order_events, medical_exempt_sales,
  sales_limit_events, excise_return_batches, excise_return_drafts,
  ccrs_export_batches, ccrs_adjustment_batches, syndication_logs
Inventory: inventory_lots, inventory_adjustments, lab_results, cycle_counts,
  cycle_count_lines, destruction_events, vendor_returns, trade_sample_events,
  inbound_manifests, manifest_events, vendor_manifest_payments,
  purchase_orders, purchase_order_lines
Products from imports: menu_versions, menu_items, menu_variants, pos_imports,
  pos_import_diagnostics, catalog_product_drafts, product_enrichments,
  product_master_suggestions, ai_suggestions
Customers/loyalty signups: customers, loyalty_accounts, loyalty_ledger,
  loyalty_redemptions, loyalty_signups, patient_authorizations,
  medical_form_scans, newsletter_sends, newsletter_email_events, inbound_email_log
Registers/tills day-to-day: drawer_sessions, drawer_counts, drawer_drops,
  till_verifications
Time/payroll: time_punches, shifts, payroll_runs, payroll_run_lines
Equipment service history: equipment_service_events
Sage rehearsal: sage_import_uploads, sage_chat_messages
AI usage ledger: ai_usage
Audit: audit_logs (KEEP by default — owner may want history; confirm)

### OWNER DECISIONS (CONFIRMED)
- product_masters / product_master_members / product_enrichments -> KEEP.
- brands / brand_aliases / vendors / vendor_aliases -> KEEP.
- promotions / promotion_targets / promotion_exclusions / promotion_audit_snapshots -> KEEP.
- audit_logs -> KEEP (relevant test history).
- employees/staff/registers/equipment_assets -> KEEP.
- Mock cleanup -> proceed as proposed (remove dead components, stop mock leaking
  into real pages, keep the "mock" inventory-status enum + "mockup" card fallback
  + admin editor previews).

### FINAL "CLEAR" LIST (operational/transactional reset) — CONFIRMED
Sales & COGS: orders, order_lines, order_events, medical_exempt_sales,
  sales_limit_events, excise_return_batches, excise_return_drafts,
  ccrs_export_batches, ccrs_adjustment_batches, syndication_logs
Inventory: inventory_lots, inventory_adjustments, lab_results, cycle_counts,
  cycle_count_lines, destruction_events, vendor_returns, trade_sample_events,
  inbound_manifests, manifest_events, vendor_manifest_payments,
  purchase_orders, purchase_order_lines
Imported products (import-derived only; product_masters/members/enrichments KEPT):
  menu_versions, menu_items, menu_variants, pos_imports, pos_import_diagnostics,
  catalog_product_drafts, product_master_suggestions, ai_suggestions
Customers/loyalty signups: customers, loyalty_accounts, loyalty_ledger,
  loyalty_redemptions, loyalty_signups, patient_authorizations,
  medical_form_scans, newsletter_sends, newsletter_email_events, inbound_email_log
Registers day-to-day: drawer_sessions, drawer_counts, drawer_drops, till_verifications
Time/payroll: time_punches, shifts, payroll_runs, payroll_run_lines
Misc: equipment_service_events, sage_import_uploads, sage_chat_messages, ai_usage

NOTE: product_enrichments moved to KEEP per owner. audit_logs KEEP.

### Phase 1 — Broaden Clean Slate (reset operational data)
- [ ] New idempotent migration: reset_operational_data() RPC (preserves settings + KB).
- [ ] Server wrapper + confirm-gated admin action + audit log.
- [ ] UI: clear labeling of exactly what is/ isn't deleted.

### Phase 1 — Broaden Clean Slate — DONE
- [x] Migration 0069 reset_operational_data() (idempotent, child->parent order, per-table counts).
- [x] Server wrapper src/lib/admin/reset-service.ts.
- [x] Confirm-gated + audit-logged action resetOperationalDataAction (settings/actions.ts).
- [x] Danger-zone UI /admin/settings/reset + Settings hub link.

### Phase 2 — Remove mock data/features — DONE
- [x] Deleted dead mock components: menu/ProductGrid.tsx, menu/MenuFilters.tsx, menu/SortBar.tsx.
- [x] Deleted src/lib/leafly/mock-menu.ts (fully orphaned after edits).
- [x] Removed mock from product detail page (fallback, related, generateStaticParams).
- [x] Removed mock from sitemap.ts.
- [x] Removed dead getGreenwayMenuPreview() (returned mock) from leafly/client.ts.
- [x] Emptied mock placeholder IDs in InteractiveMenuBrowser clearance lane (real empty state).
- [x] Removed non-existent /menu/mock-preview from robots.ts.
- [x] Removed "mock" from InventoryStatus unions (never produced by real data).
- [x] Fixed stale "mock price" copy in SortDropdown helpers.
- [x] KEPT (legit): "mockup" stylized card fallback (image-resolver), admin editor
      previews (vendor/sale/blog SERP), transform.ts real logic.

### FLAGGED FOR OWNER (legal/policy copy — NOT auto-edited)
- src/components/home/StoreVisit.tsx and src/components/policies/policy-preview-data.ts
  contain policy/legal statements that carts/checkout are "mock" / "do not create
  real orders / reserve inventory". Whether to flip this to production language is a
  business/legal decision, not a code cleanup. Left as-is; owner to confirm.

### Phase 3 — Real inventory intake readiness
- [x] Intake pipeline (admin/menu-imports + import-service) has ZERO mock refs — clean.

### Verification
- [x] tsc --noEmit clean.
- [x] Full build succeeds (2369 pages; 11 mock product pages correctly removed).
- [x] CCRS/DOH untouched (git diff main -- src/lib/compliance empty).
- [ ] Branch + PR + squash-merge (in progress).
