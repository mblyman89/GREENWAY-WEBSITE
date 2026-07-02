-- =============================================================================
-- 0069 — "Reset Operational Data" (production-readiness clean slate)
-- =============================================================================
-- The owner is moving from rehearsal/testing toward a production-ready state and
-- wants a one-click way to wipe OPERATIONAL / TRANSACTIONAL data (sales, COGS,
-- inventory, imported products, customers/loyalty signups, till/drawer sessions,
-- time/payroll, etc.) WITHOUT losing owner-authored configuration or the
-- validated cannabis knowledge base.
--
-- This is DELIBERATELY broader than clean_slate_test_data() (migration 0066),
-- which only removed test-flagged imports/versions. This function removes the
-- confirmed operational set below and NOTHING else.
--
-- ── PRESERVED (never touched) ────────────────────────────────────────────────
--   • All settings / configuration: site_settings, tax_settings,
--     tax_category_rules, pricing_settings, license_settings,
--     accounting_settings, ach_company_settings, loyalty_config, loyalty_tiers,
--     loyalty_promotions, reorder_settings, sample_settings,
--     trade_sample_settings, sales_limit_settings, sales_limit_override,
--     medical_endorsement_config, receipt_printer_settings,
--     integration_credentials, flux_credentials, inventory_types,
--     website_category_types.
--   • Knowledge base: kb_strains, kb_terpenes, kb_brands, kb_category_terms,
--     kb_banned_phrases, kb_image_substitutes, kb_notes.
--   • Owner-authored CMS/marketing: content_blocks, content_revisions,
--     page_sections, blog_posts, home_carousel_slides, faq_items, media_assets,
--     media_usages, newsletter_assets, seo_entries, marketing_ideas.
--   • Owner-curated catalog/brand/vendor config: product_masters,
--     product_master_members, product_enrichments, brands, brand_aliases,
--     vendors, vendor_aliases.
--   • Owner-authored promotions: promotions, promotion_targets,
--     promotion_exclusions, promotion_audit_snapshots.
--   • People/hardware provisioning: employees, staff_profiles, registers,
--     equipment_assets, webauthn_credentials, webauthn_challenges.
--   • Compliance history: audit_logs (owner keeps test history for reference).
--
-- ── CLEARED (operational / transactional) ───────────────────────────────────
--   Deleted in explicit child → parent order so the two ON DELETE RESTRICT
--   edges in the schema (vendor_manifest_payments → inbound_manifests, and
--   drawer_sessions → registers[KEPT]) never block. Explicit ordering also
--   yields accurate per-table counts even where a cascade would have handled it.
--
-- SECURITY INVOKER: RLS + the app's requirePermission gate + a typed-confirm UI
-- control who may call it. The application layer additionally audit-logs the
-- call (action = 'ops.reset_operational_data').
--
-- Idempotent: create-or-replace only. Apply MANUALLY in the Supabase SQL editor.
-- =============================================================================

create or replace function public.reset_operational_data()
returns jsonb
language plpgsql
as $$
declare
  counts jsonb := '{}'::jsonb;

  -- Helper pattern: delete a table and record how many rows went. We inline the
  -- deletes (rather than dynamic SQL) so every target is statically verified at
  -- create time — a typo'd or non-existent table fails loudly on apply.
  n integer;
begin
  -- ── 1. Sales & COGS (children first) ──────────────────────────────────────
  delete from public.order_events;            get diagnostics n = row_count; counts := counts || jsonb_build_object('order_events', n);
  delete from public.order_lines;             get diagnostics n = row_count; counts := counts || jsonb_build_object('order_lines', n);
  delete from public.medical_exempt_sales;    get diagnostics n = row_count; counts := counts || jsonb_build_object('medical_exempt_sales', n);
  delete from public.sales_limit_events;      get diagnostics n = row_count; counts := counts || jsonb_build_object('sales_limit_events', n);
  delete from public.orders;                  get diagnostics n = row_count; counts := counts || jsonb_build_object('orders', n);

  delete from public.excise_return_drafts;    get diagnostics n = row_count; counts := counts || jsonb_build_object('excise_return_drafts', n);
  delete from public.excise_return_batches;   get diagnostics n = row_count; counts := counts || jsonb_build_object('excise_return_batches', n);
  delete from public.ccrs_adjustment_batches; get diagnostics n = row_count; counts := counts || jsonb_build_object('ccrs_adjustment_batches', n);
  delete from public.ccrs_export_batches;     get diagnostics n = row_count; counts := counts || jsonb_build_object('ccrs_export_batches', n);
  delete from public.syndication_logs;        get diagnostics n = row_count; counts := counts || jsonb_build_object('syndication_logs', n);

  -- ── 2. Registers / tills (day-to-day; registers themselves are KEPT) ──────
  delete from public.till_verifications;      get diagnostics n = row_count; counts := counts || jsonb_build_object('till_verifications', n);
  delete from public.drawer_drops;            get diagnostics n = row_count; counts := counts || jsonb_build_object('drawer_drops', n);
  delete from public.drawer_counts;           get diagnostics n = row_count; counts := counts || jsonb_build_object('drawer_counts', n);
  delete from public.drawer_sessions;         get diagnostics n = row_count; counts := counts || jsonb_build_object('drawer_sessions', n);

  -- ── 3. Time / payroll (children first) ────────────────────────────────────
  delete from public.payroll_run_lines;       get diagnostics n = row_count; counts := counts || jsonb_build_object('payroll_run_lines', n);
  delete from public.payroll_runs;            get diagnostics n = row_count; counts := counts || jsonb_build_object('payroll_runs', n);
  delete from public.time_punches;            get diagnostics n = row_count; counts := counts || jsonb_build_object('time_punches', n);
  delete from public.shifts;                  get diagnostics n = row_count; counts := counts || jsonb_build_object('shifts', n);

  -- ── 4. Purchase orders (children first) ───────────────────────────────────
  delete from public.purchase_order_lines;    get diagnostics n = row_count; counts := counts || jsonb_build_object('purchase_order_lines', n);
  delete from public.purchase_orders;         get diagnostics n = row_count; counts := counts || jsonb_build_object('purchase_orders', n);

  -- ── 5. Imported products / import artifacts (product_masters/members/enrich KEPT) ─
  delete from public.ai_suggestions;             get diagnostics n = row_count; counts := counts || jsonb_build_object('ai_suggestions', n);
  delete from public.product_master_suggestions; get diagnostics n = row_count; counts := counts || jsonb_build_object('product_master_suggestions', n);
  delete from public.catalog_product_drafts;     get diagnostics n = row_count; counts := counts || jsonb_build_object('catalog_product_drafts', n);
  delete from public.menu_variants;              get diagnostics n = row_count; counts := counts || jsonb_build_object('menu_variants', n);
  delete from public.menu_items;                 get diagnostics n = row_count; counts := counts || jsonb_build_object('menu_items', n);
  delete from public.menu_versions;              get diagnostics n = row_count; counts := counts || jsonb_build_object('menu_versions', n);
  delete from public.pos_import_diagnostics;     get diagnostics n = row_count; counts := counts || jsonb_build_object('pos_import_diagnostics', n);
  delete from public.pos_imports;                get diagnostics n = row_count; counts := counts || jsonb_build_object('pos_imports', n);

  -- ── 6. Inventory: lot children → lots → manifests (payments before manifests) ─
  delete from public.cycle_count_lines;       get diagnostics n = row_count; counts := counts || jsonb_build_object('cycle_count_lines', n);
  delete from public.cycle_counts;            get diagnostics n = row_count; counts := counts || jsonb_build_object('cycle_counts', n);
  delete from public.destruction_events;      get diagnostics n = row_count; counts := counts || jsonb_build_object('destruction_events', n);
  delete from public.vendor_returns;          get diagnostics n = row_count; counts := counts || jsonb_build_object('vendor_returns', n);
  delete from public.trade_sample_events;     get diagnostics n = row_count; counts := counts || jsonb_build_object('trade_sample_events', n);
  delete from public.inventory_adjustments;   get diagnostics n = row_count; counts := counts || jsonb_build_object('inventory_adjustments', n);
  delete from public.lab_results;             get diagnostics n = row_count; counts := counts || jsonb_build_object('lab_results', n);
  delete from public.inventory_lots;          get diagnostics n = row_count; counts := counts || jsonb_build_object('inventory_lots', n);

  -- vendor_manifest_payments references inbound_manifests ON DELETE RESTRICT,
  -- so it MUST be deleted before inbound_manifests.
  delete from public.vendor_manifest_payments; get diagnostics n = row_count; counts := counts || jsonb_build_object('vendor_manifest_payments', n);
  delete from public.manifest_events;          get diagnostics n = row_count; counts := counts || jsonb_build_object('manifest_events', n);
  delete from public.inbound_manifests;        get diagnostics n = row_count; counts := counts || jsonb_build_object('inbound_manifests', n);

  -- ── 7. Customers / loyalty signups (children first) ───────────────────────
  delete from public.loyalty_redemptions;     get diagnostics n = row_count; counts := counts || jsonb_build_object('loyalty_redemptions', n);
  delete from public.loyalty_ledger;          get diagnostics n = row_count; counts := counts || jsonb_build_object('loyalty_ledger', n);
  delete from public.loyalty_accounts;        get diagnostics n = row_count; counts := counts || jsonb_build_object('loyalty_accounts', n);
  delete from public.loyalty_signups;         get diagnostics n = row_count; counts := counts || jsonb_build_object('loyalty_signups', n);
  delete from public.patient_authorizations;  get diagnostics n = row_count; counts := counts || jsonb_build_object('patient_authorizations', n);
  delete from public.customers;               get diagnostics n = row_count; counts := counts || jsonb_build_object('customers', n);

  -- ── 8. Newsletter / inbound email activity ────────────────────────────────
  delete from public.newsletter_email_events; get diagnostics n = row_count; counts := counts || jsonb_build_object('newsletter_email_events', n);
  delete from public.newsletter_sends;        get diagnostics n = row_count; counts := counts || jsonb_build_object('newsletter_sends', n);
  delete from public.inbound_email_log;       get diagnostics n = row_count; counts := counts || jsonb_build_object('inbound_email_log', n);

  -- ── 9. Equipment service history (equipment_assets themselves are KEPT) ───
  delete from public.equipment_service_events; get diagnostics n = row_count; counts := counts || jsonb_build_object('equipment_service_events', n);

  -- ── 10. Sage rehearsal + AI usage ledger ──────────────────────────────────
  delete from public.sage_chat_messages;      get diagnostics n = row_count; counts := counts || jsonb_build_object('sage_chat_messages', n);
  delete from public.sage_import_uploads;     get diagnostics n = row_count; counts := counts || jsonb_build_object('sage_import_uploads', n);
  delete from public.ai_usage;                get diagnostics n = row_count; counts := counts || jsonb_build_object('ai_usage', n);

  return jsonb_build_object(
    'ok', true,
    'reset_at', now(),
    'tables', counts,
    'total_rows_deleted', (
      select coalesce(sum((value)::int), 0)
      from jsonb_each_text(counts)
    )
  );
end;
$$;

comment on function public.reset_operational_data() is
  '0069: deletes ONLY operational/transactional data (sales, COGS, inventory, imported products, customers/loyalty signups, tills, time/payroll, etc.) in child->parent order. NEVER touches settings, the knowledge base, CMS/marketing, product_masters/members/enrichments, brands, vendors, promotions, people/hardware, or audit_logs. Returns a per-table JSONB summary.';
