-- =============================================================================
-- 0097 — Retention guard on reset_operational_data (S-6 / GAP M-3)
-- =============================================================================
-- WAC 314-55-087 requires licensees to keep records (sales, inventory,
-- transport/manifest, destruction, etc.) for THREE YEARS and have them
-- available for LCB inspection. The one-click "Reset operational data" wipe
-- (migration 0069) is intended for clearing REHEARSAL data before go-live —
-- but once real trade has occurred, running it would destroy records the law
-- says must be retained.
--
-- This migration replaces reset_operational_data() with a guarded version:
--   • If COMPLETED orders exist, or any CCRS export/adjustment batches have
--     been recorded (i.e. data has plausibly been reported to the LCB), the
--     function REFUSES unless called with acknowledge_wac_314_55_087 := true.
--   • The refusal message tells the operator exactly what tripped the guard
--     and how to proceed (export everything first, then attest).
--   • The app layer (Danger Zone page) adds an export-first attestation
--     checkbox + an escalated typed confirmation naming the rule; only when
--     both are provided does it pass acknowledge_wac_314_55_087 := true.
--
-- The delete body is IDENTICAL to 0069 (same tables, same child→parent order,
-- same per-table counts). Only the guard is new.
--
-- Idempotent: drops the old zero-arg signature (so PostgREST rpc name stays
-- unambiguous) and create-or-replaces the new one. Apply MANUALLY in the
-- Supabase SQL editor.
-- =============================================================================

-- Remove the old zero-argument version so only ONE function named
-- reset_operational_data exists (PostgREST resolves rpc by name).
drop function if exists public.reset_operational_data();

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

  -- ── 1. Sales & COGS (children first) ──────────────────────────────────────
  delete from public.order_events where true;            get diagnostics n = row_count; counts := counts || jsonb_build_object('order_events', n);
  delete from public.order_lines where true;             get diagnostics n = row_count; counts := counts || jsonb_build_object('order_lines', n);
  delete from public.medical_exempt_sales where true;    get diagnostics n = row_count; counts := counts || jsonb_build_object('medical_exempt_sales', n);
  delete from public.sales_limit_events where true;      get diagnostics n = row_count; counts := counts || jsonb_build_object('sales_limit_events', n);
  delete from public.orders where true;                  get diagnostics n = row_count; counts := counts || jsonb_build_object('orders', n);

  delete from public.excise_return_drafts where true;    get diagnostics n = row_count; counts := counts || jsonb_build_object('excise_return_drafts', n);
  delete from public.excise_return_batches where true;   get diagnostics n = row_count; counts := counts || jsonb_build_object('excise_return_batches', n);
  delete from public.ccrs_adjustment_batches where true; get diagnostics n = row_count; counts := counts || jsonb_build_object('ccrs_adjustment_batches', n);
  delete from public.ccrs_export_batches where true;     get diagnostics n = row_count; counts := counts || jsonb_build_object('ccrs_export_batches', n);
  delete from public.syndication_logs where true;        get diagnostics n = row_count; counts := counts || jsonb_build_object('syndication_logs', n);

  -- ── 2. Registers / tills (day-to-day; registers themselves are KEPT) ──────
  delete from public.till_verifications where true;      get diagnostics n = row_count; counts := counts || jsonb_build_object('till_verifications', n);
  delete from public.drawer_drops where true;            get diagnostics n = row_count; counts := counts || jsonb_build_object('drawer_drops', n);
  delete from public.drawer_counts where true;           get diagnostics n = row_count; counts := counts || jsonb_build_object('drawer_counts', n);
  delete from public.drawer_sessions where true;         get diagnostics n = row_count; counts := counts || jsonb_build_object('drawer_sessions', n);

  -- ── 3. Time / payroll (children first) ────────────────────────────────────
  delete from public.payroll_run_lines where true;       get diagnostics n = row_count; counts := counts || jsonb_build_object('payroll_run_lines', n);
  delete from public.payroll_runs where true;            get diagnostics n = row_count; counts := counts || jsonb_build_object('payroll_runs', n);
  delete from public.time_punches where true;            get diagnostics n = row_count; counts := counts || jsonb_build_object('time_punches', n);
  delete from public.shifts where true;                  get diagnostics n = row_count; counts := counts || jsonb_build_object('shifts', n);

  -- ── 4. Purchase orders (children first) ───────────────────────────────────
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
  delete from public.pos_imports where true;                get diagnostics n = row_count; counts := counts || jsonb_build_object('pos_imports', n);

  -- ── 6. Inventory: lot children → lots → manifests (payments before manifests) ─
  delete from public.cycle_count_lines where true;       get diagnostics n = row_count; counts := counts || jsonb_build_object('cycle_count_lines', n);
  delete from public.cycle_counts where true;            get diagnostics n = row_count; counts := counts || jsonb_build_object('cycle_counts', n);
  delete from public.destruction_events where true;      get diagnostics n = row_count; counts := counts || jsonb_build_object('destruction_events', n);
  delete from public.vendor_returns where true;          get diagnostics n = row_count; counts := counts || jsonb_build_object('vendor_returns', n);
  delete from public.trade_sample_events where true;     get diagnostics n = row_count; counts := counts || jsonb_build_object('trade_sample_events', n);
  delete from public.inventory_adjustments where true;   get diagnostics n = row_count; counts := counts || jsonb_build_object('inventory_adjustments', n);
  delete from public.lab_results where true;             get diagnostics n = row_count; counts := counts || jsonb_build_object('lab_results', n);
  delete from public.inventory_lots where true;          get diagnostics n = row_count; counts := counts || jsonb_build_object('inventory_lots', n);

  -- vendor_manifest_payments references inbound_manifests ON DELETE RESTRICT,
  -- so it MUST be deleted before inbound_manifests.
  delete from public.vendor_manifest_payments where true; get diagnostics n = row_count; counts := counts || jsonb_build_object('vendor_manifest_payments', n);
  delete from public.manifest_events where true;          get diagnostics n = row_count; counts := counts || jsonb_build_object('manifest_events', n);
  delete from public.inbound_manifests where true;        get diagnostics n = row_count; counts := counts || jsonb_build_object('inbound_manifests', n);

  -- ── 7. Customers / loyalty signups (children first) ───────────────────────
  delete from public.loyalty_redemptions where true;     get diagnostics n = row_count; counts := counts || jsonb_build_object('loyalty_redemptions', n);
  delete from public.loyalty_ledger where true;          get diagnostics n = row_count; counts := counts || jsonb_build_object('loyalty_ledger', n);
  delete from public.loyalty_accounts where true;        get diagnostics n = row_count; counts := counts || jsonb_build_object('loyalty_accounts', n);
  delete from public.loyalty_signups where true;         get diagnostics n = row_count; counts := counts || jsonb_build_object('loyalty_signups', n);
  delete from public.patient_authorizations where true;  get diagnostics n = row_count; counts := counts || jsonb_build_object('patient_authorizations', n);
  delete from public.customers where true;               get diagnostics n = row_count; counts := counts || jsonb_build_object('customers', n);

  -- ── 8. Newsletter / inbound email activity ────────────────────────────────
  delete from public.newsletter_email_events where true; get diagnostics n = row_count; counts := counts || jsonb_build_object('newsletter_email_events', n);
  delete from public.newsletter_sends where true;        get diagnostics n = row_count; counts := counts || jsonb_build_object('newsletter_sends', n);
  delete from public.inbound_email_log where true;       get diagnostics n = row_count; counts := counts || jsonb_build_object('inbound_email_log', n);

  -- ── 9. Equipment service history (equipment_assets themselves are KEPT) ───
  delete from public.equipment_service_events where true; get diagnostics n = row_count; counts := counts || jsonb_build_object('equipment_service_events', n);

  -- ── 10. Sage rehearsal + AI usage ledger ──────────────────────────────────
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
  '0097: 0069''s operational wipe + S-6 retention guard — refuses when completed orders or CCRS batches exist unless acknowledge_wac_314_55_087 := true (WAC 314-55-087 three-year record retention). Deletes ONLY operational/transactional data in child->parent order; never touches settings, the knowledge base, CMS/marketing, product_masters/members/enrichments, brands, vendors, promotions, people/hardware, or audit_logs.';
