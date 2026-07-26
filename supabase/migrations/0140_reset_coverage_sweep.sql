-- =============================================================================
-- 0140 — Reset coverage sweep (owner go-live hardening, SLICE 60)
-- =============================================================================
-- "Reset operational data" (0069, guarded in 0097) was written before many
-- newer operational tables existed, so a pre-go-live reset would leave test
-- activity behind in: register sale events, receipt print jobs, safe counts &
-- swaps, special-discount uses, customer returns, non-cannabis inventory
-- adjustments & vendor invoices, CCRS week submissions & compliance reminder
-- log, sample JSON imports, payroll source documents, and the golden-record
-- fact-review decision log.
--
-- This migration replaces reset_operational_data(boolean) with the SAME body
-- and the SAME S-6 retention guard (WAC 314-55-087) as 0097, extended with the
-- missing tables in verified child->parent order:
--   • customer_returns, receipt_print_jobs, pos_sale_events,
--     special_discount_uses, ccrs_week_submissions, compliance_reminder_log
--     delete in the Sales & COGS section BEFORE orders (their order FKs are
--     ON DELETE SET NULL, but deleting children first keeps counts honest).
--   • safe_swaps deletes BEFORE drawer_sessions (FK on delete set null);
--     safe_counts alongside it.
--   • payroll_source_documents deletes AFTER payroll_runs (payroll_runs
--     references it ON DELETE SET NULL).
--   • pos_fact_reviews deletes explicitly BEFORE pos_imports so the summary
--     shows the count (it would cascade anyway per 0139).
--   • sample_json_imports deletes AFTER trade_sample_events (which reference
--     it ON DELETE SET NULL).
--   • noncannabis_invoice_lines -> noncannabis_invoices delete AFTER
--     vendor_manifest_payments (which references noncannabis_invoices
--     ON DELETE RESTRICT per 0112); noncannabis_adjustments alongside.
--
-- STILL KEPT, deliberately: settings, the knowledge base, CMS/marketing,
-- media, product_masters/members/enrichments, brands & vendors (+aliases),
-- noncannabis_products (curated catalog), promotions, people/hardware
-- (employees, registers, pos_devices, push_subscriptions, equipment,
-- passkeys), pin_throttle (security state), handbook_acknowledgments,
-- medical_product_registry, discovery/harvest research, and audit_logs.
--
-- Idempotent: create-or-replace of the same boolean signature. Apply MANUALLY
-- in the Supabase SQL editor.
-- =============================================================================

create or replace function public.reset_operational_data(
  acknowledge_wac_314_55_087 boolean default false
)
returns jsonb
language plpgsql
as $$
declare
  counts jsonb := '{}'::jsonb;
  n integer;
  completed_orders integer;
  ccrs_batches integer;
begin
  -- ── S-6 retention guard (WAC 314-55-087: 3-year record retention) ──────────
  select count(*) into completed_orders from public.orders where status = 'completed';
  select
    (select count(*) from public.ccrs_export_batches)
    + (select count(*) from public.ccrs_adjustment_batches)
    into ccrs_batches;

  if (completed_orders > 0 or ccrs_batches > 0) and not acknowledge_wac_314_55_087 then
    raise exception using
      errcode = 'P0001',
      message = format(
        'RETENTION GUARD (WAC 314-55-087): refusing to wipe — %s completed order(s) and %s CCRS batch(es) exist. '
        'Licensees must retain sales/inventory/transport records for 3 years. Export everything first, then re-run '
        'with acknowledge_wac_314_55_087 := true (the Danger Zone page requires the export-first attestation).',
        completed_orders, ccrs_batches
      );
  end if;

  -- ── 1. Sales & COGS (children first) ────────────────────────────────────────
  -- 0140: newer order-adjacent operational tables, before orders.
  delete from public.customer_returns where true;        get diagnostics n = row_count; counts := counts || jsonb_build_object('customer_returns', n);
  delete from public.receipt_print_jobs where true;      get diagnostics n = row_count; counts := counts || jsonb_build_object('receipt_print_jobs', n);
  delete from public.pos_sale_events where true;         get diagnostics n = row_count; counts := counts || jsonb_build_object('pos_sale_events', n);
  delete from public.special_discount_uses where true;   get diagnostics n = row_count; counts := counts || jsonb_build_object('special_discount_uses', n);
  delete from public.order_events where true;            get diagnostics n = row_count; counts := counts || jsonb_build_object('order_events', n);
  delete from public.order_lines where true;             get diagnostics n = row_count; counts := counts || jsonb_build_object('order_lines', n);
  delete from public.medical_exempt_sales where true;    get diagnostics n = row_count; counts := counts || jsonb_build_object('medical_exempt_sales', n);
  delete from public.sales_limit_events where true;      get diagnostics n = row_count; counts := counts || jsonb_build_object('sales_limit_events', n);
  delete from public.orders where true;                  get diagnostics n = row_count; counts := counts || jsonb_build_object('orders', n);

  delete from public.excise_return_drafts where true;    get diagnostics n = row_count; counts := counts || jsonb_build_object('excise_return_drafts', n);
  delete from public.excise_return_batches where true;   get diagnostics n = row_count; counts := counts || jsonb_build_object('excise_return_batches', n);
  delete from public.ccrs_adjustment_batches where true; get diagnostics n = row_count; counts := counts || jsonb_build_object('ccrs_adjustment_batches', n);
  delete from public.ccrs_export_batches where true;     get diagnostics n = row_count; counts := counts || jsonb_build_object('ccrs_export_batches', n);
  -- 0140: CCRS command-center operational records.
  delete from public.ccrs_week_submissions where true;   get diagnostics n = row_count; counts := counts || jsonb_build_object('ccrs_week_submissions', n);
  delete from public.compliance_reminder_log where true; get diagnostics n = row_count; counts := counts || jsonb_build_object('compliance_reminder_log', n);
  delete from public.syndication_logs where true;        get diagnostics n = row_count; counts := counts || jsonb_build_object('syndication_logs', n);

  -- ── 2. Registers / tills (day-to-day; registers themselves are KEPT) ──────
  delete from public.till_verifications where true;      get diagnostics n = row_count; counts := counts || jsonb_build_object('till_verifications', n);
  delete from public.drawer_drops where true;            get diagnostics n = row_count; counts := counts || jsonb_build_object('drawer_drops', n);
  delete from public.drawer_counts where true;           get diagnostics n = row_count; counts := counts || jsonb_build_object('drawer_counts', n);
  -- 0140: store-safe activity; safe_swaps references drawer_sessions, so it
  -- deletes BEFORE drawer_sessions.
  delete from public.safe_swaps where true;              get diagnostics n = row_count; counts := counts || jsonb_build_object('safe_swaps', n);
  delete from public.safe_counts where true;             get diagnostics n = row_count; counts := counts || jsonb_build_object('safe_counts', n);
  delete from public.drawer_sessions where true;         get diagnostics n = row_count; counts := counts || jsonb_build_object('drawer_sessions', n);

  -- ── 3. Time / payroll (children first) ──────────────────────────────────────
  delete from public.payroll_run_lines where true;       get diagnostics n = row_count; counts := counts || jsonb_build_object('payroll_run_lines', n);
  delete from public.payroll_runs where true;            get diagnostics n = row_count; counts := counts || jsonb_build_object('payroll_runs', n);
  -- 0140: uploaded payroll source files, after the runs that reference them.
  delete from public.payroll_source_documents where true; get diagnostics n = row_count; counts := counts || jsonb_build_object('payroll_source_documents', n);
  delete from public.time_punches where true;            get diagnostics n = row_count; counts := counts || jsonb_build_object('time_punches', n);
  delete from public.shifts where true;                  get diagnostics n = row_count; counts := counts || jsonb_build_object('shifts', n);

  -- ── 4. Purchase orders (children first) ─────────────────────────────────────
  delete from public.purchase_order_lines where true;    get diagnostics n = row_count; counts := counts || jsonb_build_object('purchase_order_lines', n);
  delete from public.purchase_orders where true;         get diagnostics n = row_count; counts := counts || jsonb_build_object('purchase_orders', n);

  -- ── 5. Imported products / import artifacts (product_masters/members/enrich KEPT) ─
  delete from public.ai_suggestions where true;             get diagnostics n = row_count; counts := counts || jsonb_build_object('ai_suggestions', n);
  delete from public.product_master_suggestions where true; get diagnostics n = row_count; counts := counts || jsonb_build_object('product_master_suggestions', n);
  delete from public.catalog_product_drafts where true;     get diagnostics n = row_count; counts := counts || jsonb_build_object('catalog_product_drafts', n);
  delete from public.menu_variants where true;              get diagnostics n = row_count; counts := counts || jsonb_build_object('menu_variants', n);
  delete from public.menu_items where true;                 get diagnostics n = row_count; counts := counts || jsonb_build_object('menu_items', n);
  delete from public.menu_versions where true;              get diagnostics n = row_count; counts := counts || jsonb_build_object('menu_versions', n);
  delete from public.pos_import_diagnostics where true;     get diagnostics n = row_count; counts := counts || jsonb_build_object('pos_import_diagnostics', n);
  -- 0140: golden-record fact-review decisions (would cascade with pos_imports;
  -- explicit so the summary shows the count).
  delete from public.pos_fact_reviews where true;           get diagnostics n = row_count; counts := counts || jsonb_build_object('pos_fact_reviews', n);
  delete from public.pos_imports where true;                get diagnostics n = row_count; counts := counts || jsonb_build_object('pos_imports', n);

  -- ── 6. Inventory: lot children → lots → manifests (payments before manifests) ─
  delete from public.cycle_count_lines where true;       get diagnostics n = row_count; counts := counts || jsonb_build_object('cycle_count_lines', n);
  delete from public.cycle_counts where true;            get diagnostics n = row_count; counts := counts || jsonb_build_object('cycle_counts', n);
  delete from public.destruction_events where true;      get diagnostics n = row_count; counts := counts || jsonb_build_object('destruction_events', n);
  delete from public.vendor_returns where true;          get diagnostics n = row_count; counts := counts || jsonb_build_object('vendor_returns', n);
  delete from public.trade_sample_events where true;     get diagnostics n = row_count; counts := counts || jsonb_build_object('trade_sample_events', n);
  -- 0140: sample JSON imports, after the events that reference them.
  delete from public.sample_json_imports where true;     get diagnostics n = row_count; counts := counts || jsonb_build_object('sample_json_imports', n);
  delete from public.inventory_adjustments where true;   get diagnostics n = row_count; counts := counts || jsonb_build_object('inventory_adjustments', n);
  delete from public.lab_results where true;             get diagnostics n = row_count; counts := counts || jsonb_build_object('lab_results', n);
  delete from public.inventory_lots where true;          get diagnostics n = row_count; counts := counts || jsonb_build_object('inventory_lots', n);

  -- vendor_manifest_payments references inbound_manifests ON DELETE RESTRICT
  -- (and, since 0112, noncannabis_invoices ON DELETE RESTRICT), so it MUST be
  -- deleted before BOTH.
  delete from public.vendor_manifest_payments where true; get diagnostics n = row_count; counts := counts || jsonb_build_object('vendor_manifest_payments', n);
  delete from public.manifest_events where true;          get diagnostics n = row_count; counts := counts || jsonb_build_object('manifest_events', n);
  delete from public.inbound_manifests where true;        get diagnostics n = row_count; counts := counts || jsonb_build_object('inbound_manifests', n);

  -- 0140: non-cannabis operational records (the noncannabis_products catalog
  -- itself is KEPT — it is owner-curated). Invoice lines cascade from
  -- invoices, deleted explicitly for honest counts; invoices delete AFTER
  -- vendor_manifest_payments above (ON DELETE RESTRICT per 0112).
  delete from public.noncannabis_invoice_lines where true; get diagnostics n = row_count; counts := counts || jsonb_build_object('noncannabis_invoice_lines', n);
  delete from public.noncannabis_invoices where true;      get diagnostics n = row_count; counts := counts || jsonb_build_object('noncannabis_invoices', n);
  delete from public.noncannabis_adjustments where true;   get diagnostics n = row_count; counts := counts || jsonb_build_object('noncannabis_adjustments', n);

  -- ── 7. Customers / loyalty signups (children first) ─────────────────────────
  delete from public.loyalty_redemptions where true;     get diagnostics n = row_count; counts := counts || jsonb_build_object('loyalty_redemptions', n);
  delete from public.loyalty_ledger where true;          get diagnostics n = row_count; counts := counts || jsonb_build_object('loyalty_ledger', n);
  delete from public.loyalty_accounts where true;        get diagnostics n = row_count; counts := counts || jsonb_build_object('loyalty_accounts', n);
  delete from public.loyalty_signups where true;         get diagnostics n = row_count; counts := counts || jsonb_build_object('loyalty_signups', n);
  delete from public.patient_authorizations where true;  get diagnostics n = row_count; counts := counts || jsonb_build_object('patient_authorizations', n);
  delete from public.customers where true;               get diagnostics n = row_count; counts := counts || jsonb_build_object('customers', n);

  -- ── 8. Newsletter / inbound email activity ──────────────────────────────────
  delete from public.newsletter_email_events where true; get diagnostics n = row_count; counts := counts || jsonb_build_object('newsletter_email_events', n);
  delete from public.newsletter_sends where true;        get diagnostics n = row_count; counts := counts || jsonb_build_object('newsletter_sends', n);
  delete from public.inbound_email_log where true;       get diagnostics n = row_count; counts := counts || jsonb_build_object('inbound_email_log', n);

  -- ── 9. Equipment service history (equipment_assets themselves are KEPT) ───
  delete from public.equipment_service_events where true; get diagnostics n = row_count; counts := counts || jsonb_build_object('equipment_service_events', n);

  -- ── 10. Sage rehearsal + AI usage ledger ────────────────────────────────────
  delete from public.sage_chat_messages where true;      get diagnostics n = row_count; counts := counts || jsonb_build_object('sage_chat_messages', n);
  delete from public.sage_import_uploads where true;     get diagnostics n = row_count; counts := counts || jsonb_build_object('sage_import_uploads', n);
  delete from public.ai_usage where true;                get diagnostics n = row_count; counts := counts || jsonb_build_object('ai_usage', n);

  return jsonb_build_object(
    'ok', true,
    'reset_at', now(),
    'acknowledged_wac_314_55_087', acknowledge_wac_314_55_087,
    'guard', jsonb_build_object(
      'completed_orders_at_reset', completed_orders,
      'ccrs_batches_at_reset', ccrs_batches
    ),
    'tables', counts,
    'total_rows_deleted', (
      select coalesce(sum((value)::int), 0)
      from jsonb_each_text(counts)
    )
  );
end;
$$;

comment on function public.reset_operational_data(boolean) is
  '0140: 0097''s guarded operational wipe extended to the newer operational tables (pos_sale_events, receipt_print_jobs, safe_counts/safe_swaps, special_discount_uses, customer_returns, noncannabis invoices/lines/adjustments, ccrs_week_submissions, compliance_reminder_log, sample_json_imports, payroll_source_documents, pos_fact_reviews) in verified child->parent order. Same S-6 retention guard (WAC 314-55-087). Never touches settings, the knowledge base, CMS/marketing/media, product_masters/members/enrichments, brands, vendors, noncannabis_products, promotions, people/hardware, or audit_logs.';
