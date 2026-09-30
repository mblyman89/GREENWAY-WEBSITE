-- =============================================================================
-- ROLLBACK for 0240_factory_reset_scales.sql (D-82)
-- =============================================================================
-- Puts gl_factory_reset and gl_factory_reset_preview back to the 0209 bodies
-- (row by row DELETE, no function level time limits) and removes the time
-- limits 0240 added to gl_audit_factory_reset. Generated from 0209 with its
-- comments removed and its dashes written as plain hyphens so the file is
-- pure ASCII for the SQL editor. Every statement and literal is otherwise the
-- 0209 text. CREATE OR REPLACE without SET clauses clears the 0240 settings.
-- WARNING: after this rollback the reset button times out again once the
-- database holds a realistic amount of test data (D-82).
-- =============================================================================

create or replace function public.gl_factory_reset_preview()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orders   integer := 0;
  v_ccrs     integer := 0;
  v_excise   integer := 0;
  v_journals integer := 0;
begin
  if not public.is_owner() then
    raise exception 'RESET_NOT_OWNER: only the owner may inspect or run the factory reset.'
      using errcode = 'raise_exception';
  end if;

  select count(*) into v_orders from public.orders where status = 'completed';
  select (select count(*) from public.ccrs_export_batches)
       + (select count(*) from public.ccrs_adjustment_batches)
    into v_ccrs;
  select count(*) into v_excise from public.excise_return_batches;
  select count(*) into v_journals from public.gl_journals where status in ('posted','reversed');

  return jsonb_build_object(
    'completed_orders',      v_orders,
    'ccrs_batches',          v_ccrs,
    'excise_returns_filed',  v_excise,
    'posted_journals',       v_journals,
    'looks_like_real_trade', (v_orders > 0 or v_ccrs > 0 or v_excise > 0 or v_journals > 0),
    'retention_cite',        'WAC 314-55-087(1)',
    'retention_years',       5
  );
end $$;

comment on function public.gl_factory_reset_preview() is
  '0209: owner-only. Reports the four kinds of evidence that real trade has occurred (completed sales, CCRS files, filed excise returns, posted journals) so the reset screen can warn BEFORE anything is destroyed. Read-only.';

revoke all on function public.gl_factory_reset_preview() from public;
grant execute on function public.gl_factory_reset_preview() to authenticated, service_role;

create or replace function public.gl_factory_reset(
  confirm_phrase               text,
  acknowledge_wac_314_55_087   boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  counts   jsonb := '{}'::jsonb;
  n        integer;
  v_orders   integer := 0;
  v_ccrs     integer := 0;
  v_excise   integer := 0;
  v_journals integer := 0;
  v_trade    boolean;
  v_actor    uuid := auth.uid();
begin
  if not public.is_owner() then
    raise exception 'RESET_NOT_OWNER: only the owner may run the factory reset.'
      using errcode = 'raise_exception';
  end if;

  if coalesce(btrim(confirm_phrase), '') <> 'ERASE ALL TEST DATA' then
    raise exception 'RESET_BAD_CONFIRMATION: type exactly ERASE ALL TEST DATA to confirm. Nothing has been deleted.'
      using errcode = 'raise_exception';
  end if;

  select count(*) into v_orders from public.orders where status = 'completed';
  select (select count(*) from public.ccrs_export_batches)
       + (select count(*) from public.ccrs_adjustment_batches)
    into v_ccrs;
  select count(*) into v_excise from public.excise_return_batches;
  select count(*) into v_journals from public.gl_journals where status in ('posted','reversed');
  v_trade := (v_orders > 0 or v_ccrs > 0 or v_excise > 0 or v_journals > 0);

  if v_trade and not acknowledge_wac_314_55_087 then
    raise exception using
      errcode = 'P0001',
      message = format(
        'RETENTION GUARD (WAC 314-55-087(1)): refusing to wipe - %s completed sale(s), %s CCRS file(s), '
        '%s filed excise return(s) and %s posted journal entr(ies) exist. Records must be kept on the '
        'licensed premises for a FIVE-year period (WSR 24-19-040, effective 10/12/2024) and produced for '
        'the LCB on request. Export everything first, then re-run with acknowledge_wac_314_55_087 := true.',
        v_orders, v_ccrs, v_excise, v_journals
      );
  end if;

  perform set_config('greenway.factory_reset', 'on', true);

  delete from public.customer_returns where true;          get diagnostics n = row_count; counts := counts || jsonb_build_object('customer_returns', n);
  delete from public.receipt_print_jobs where true;        get diagnostics n = row_count; counts := counts || jsonb_build_object('receipt_print_jobs', n);
  delete from public.pos_sale_events where true;           get diagnostics n = row_count; counts := counts || jsonb_build_object('pos_sale_events', n);
  delete from public.special_discount_uses where true;     get diagnostics n = row_count; counts := counts || jsonb_build_object('special_discount_uses', n);
  delete from public.order_events where true;              get diagnostics n = row_count; counts := counts || jsonb_build_object('order_events', n);
  delete from public.order_lines where true;               get diagnostics n = row_count; counts := counts || jsonb_build_object('order_lines', n);
  delete from public.medical_exempt_sales where true;      get diagnostics n = row_count; counts := counts || jsonb_build_object('medical_exempt_sales', n);
  delete from public.sales_limit_events where true;        get diagnostics n = row_count; counts := counts || jsonb_build_object('sales_limit_events', n);
  delete from public.leafly_register_interrupts where true; get diagnostics n = row_count; counts := counts || jsonb_build_object('leafly_register_interrupts', n);
  delete from public.orders where true;                    get diagnostics n = row_count; counts := counts || jsonb_build_object('orders', n);

  delete from public.till_verifications where true;        get diagnostics n = row_count; counts := counts || jsonb_build_object('till_verifications', n);
  delete from public.drawer_drops where true;              get diagnostics n = row_count; counts := counts || jsonb_build_object('drawer_drops', n);
  delete from public.drawer_counts where true;             get diagnostics n = row_count; counts := counts || jsonb_build_object('drawer_counts', n);
  delete from public.safe_swaps where true;                get diagnostics n = row_count; counts := counts || jsonb_build_object('safe_swaps', n);
  delete from public.safe_counts where true;               get diagnostics n = row_count; counts := counts || jsonb_build_object('safe_counts', n);
  delete from public.deposit_bag_sessions where true;      get diagnostics n = row_count; counts := counts || jsonb_build_object('deposit_bag_sessions', n);
  delete from public.deposit_bags where true;              get diagnostics n = row_count; counts := counts || jsonb_build_object('deposit_bags', n);
  delete from public.drawer_sessions where true;           get diagnostics n = row_count; counts := counts || jsonb_build_object('drawer_sessions', n);

  delete from public.announcer_queue where true;           get diagnostics n = row_count; counts := counts || jsonb_build_object('announcer_queue', n);
  delete from public.announcer_pairings where true;        get diagnostics n = row_count; counts := counts || jsonb_build_object('announcer_pairings', n);

  delete from public.excise_return_drafts where true;      get diagnostics n = row_count; counts := counts || jsonb_build_object('excise_return_drafts', n);
  delete from public.excise_return_batches where true;     get diagnostics n = row_count; counts := counts || jsonb_build_object('excise_return_batches', n);
  delete from public.ccrs_adjustment_batches where true;   get diagnostics n = row_count; counts := counts || jsonb_build_object('ccrs_adjustment_batches', n);
  delete from public.ccrs_export_batches where true;       get diagnostics n = row_count; counts := counts || jsonb_build_object('ccrs_export_batches', n);
  delete from public.ccrs_week_submissions where true;     get diagnostics n = row_count; counts := counts || jsonb_build_object('ccrs_week_submissions', n);
  delete from public.compliance_reminder_log where true;   get diagnostics n = row_count; counts := counts || jsonb_build_object('compliance_reminder_log', n);
  delete from public.syndication_logs where true;          get diagnostics n = row_count; counts := counts || jsonb_build_object('syndication_logs', n);
  delete from public.syndication_sync_state where true;    get diagnostics n = row_count; counts := counts || jsonb_build_object('syndication_sync_state', n);
  delete from public.leafly_sync_runs where true;          get diagnostics n = row_count; counts := counts || jsonb_build_object('leafly_sync_runs', n);
  delete from public.leafly_outbound_attempts where true;  get diagnostics n = row_count; counts := counts || jsonb_build_object('leafly_outbound_attempts', n);
  delete from public.leafly_webhook_events where true;     get diagnostics n = row_count; counts := counts || jsonb_build_object('leafly_webhook_events', n);
  delete from public.leafly_orders where true;             get diagnostics n = row_count; counts := counts || jsonb_build_object('leafly_orders', n);

  delete from public.payroll_run_lines where true;         get diagnostics n = row_count; counts := counts || jsonb_build_object('payroll_run_lines', n);
  delete from public.payroll_runs where true;              get diagnostics n = row_count; counts := counts || jsonb_build_object('payroll_runs', n);
  delete from public.payroll_source_documents where true;  get diagnostics n = row_count; counts := counts || jsonb_build_object('payroll_source_documents', n);
  delete from public.payroll_ytd_accumulators where true;  get diagnostics n = row_count; counts := counts || jsonb_build_object('payroll_ytd_accumulators', n);
  delete from public.filed_form_941_totals where true;     get diagnostics n = row_count; counts := counts || jsonb_build_object('filed_form_941_totals', n);
  delete from public.sick_leave_ledger where true;         get diagnostics n = row_count; counts := counts || jsonb_build_object('sick_leave_ledger', n);
  delete from public.sick_leave_requests where true;       get diagnostics n = row_count; counts := counts || jsonb_build_object('sick_leave_requests', n);
  delete from public.wage_orders where true;               get diagnostics n = row_count; counts := counts || jsonb_build_object('wage_orders', n);
  delete from public.time_punches where true;              get diagnostics n = row_count; counts := counts || jsonb_build_object('time_punches', n);
  delete from public.shifts where true;                    get diagnostics n = row_count; counts := counts || jsonb_build_object('shifts', n);
  delete from public.pay_periods where true;               get diagnostics n = row_count; counts := counts || jsonb_build_object('pay_periods', n);
  delete from public.employee_ssn_reveals where true;      get diagnostics n = row_count; counts := counts || jsonb_build_object('employee_ssn_reveals', n);

  delete from public.purchase_order_lines where true;      get diagnostics n = row_count; counts := counts || jsonb_build_object('purchase_order_lines', n);
  delete from public.purchase_orders where true;           get diagnostics n = row_count; counts := counts || jsonb_build_object('purchase_orders', n);

  delete from public.ai_suggestions where true;               get diagnostics n = row_count; counts := counts || jsonb_build_object('ai_suggestions', n);
  delete from public.product_master_suggestions where true;   get diagnostics n = row_count; counts := counts || jsonb_build_object('product_master_suggestions', n);
  delete from public.catalog_product_drafts where true;       get diagnostics n = row_count; counts := counts || jsonb_build_object('catalog_product_drafts', n);
  delete from public.menu_variants where true;                get diagnostics n = row_count; counts := counts || jsonb_build_object('menu_variants', n);
  delete from public.menu_items where true;                   get diagnostics n = row_count; counts := counts || jsonb_build_object('menu_items', n);
  delete from public.menu_versions where true;                get diagnostics n = row_count; counts := counts || jsonb_build_object('menu_versions', n);
  delete from public.pos_import_diagnostics where true;       get diagnostics n = row_count; counts := counts || jsonb_build_object('pos_import_diagnostics', n);
  delete from public.pos_fact_reviews where true;             get diagnostics n = row_count; counts := counts || jsonb_build_object('pos_fact_reviews', n);
  delete from public.pos_imports where true;                  get diagnostics n = row_count; counts := counts || jsonb_build_object('pos_imports', n);

  delete from public.cultivera_menu_items where true;      get diagnostics n = row_count; counts := counts || jsonb_build_object('cultivera_menu_items', n);
  delete from public.cultivera_menu_snapshots where true;  get diagnostics n = row_count; counts := counts || jsonb_build_object('cultivera_menu_snapshots', n);
  delete from public.growflow_menu_items where true;       get diagnostics n = row_count; counts := counts || jsonb_build_object('growflow_menu_items', n);
  delete from public.growflow_menu_snapshots where true;   get diagnostics n = row_count; counts := counts || jsonb_build_object('growflow_menu_snapshots', n);
  delete from public.leaflink_menu_items where true;       get diagnostics n = row_count; counts := counts || jsonb_build_object('leaflink_menu_items', n);
  delete from public.leaflink_menu_snapshots where true;   get diagnostics n = row_count; counts := counts || jsonb_build_object('leaflink_menu_snapshots', n);
  delete from public.emailed_menu_items where true;        get diagnostics n = row_count; counts := counts || jsonb_build_object('emailed_menu_items', n);
  delete from public.emailed_menu_snapshots where true;    get diagnostics n = row_count; counts := counts || jsonb_build_object('emailed_menu_snapshots', n);

  delete from public.inventory_audit_postings where true;  get diagnostics n = row_count; counts := counts || jsonb_build_object('inventory_audit_postings', n);
  delete from public.inventory_audit_lines where true;     get diagnostics n = row_count; counts := counts || jsonb_build_object('inventory_audit_lines', n);
  delete from public.inventory_audit_history where true;   get diagnostics n = row_count; counts := counts || jsonb_build_object('inventory_audit_history', n);
  delete from public.inventory_audit_sessions where true;  get diagnostics n = row_count; counts := counts || jsonb_build_object('inventory_audit_sessions', n);

  delete from public.cycle_count_lines where true;         get diagnostics n = row_count; counts := counts || jsonb_build_object('cycle_count_lines', n);
  delete from public.cycle_counts where true;              get diagnostics n = row_count; counts := counts || jsonb_build_object('cycle_counts', n);
  delete from public.destruction_events where true;        get diagnostics n = row_count; counts := counts || jsonb_build_object('destruction_events', n);
  delete from public.vendor_returns where true;            get diagnostics n = row_count; counts := counts || jsonb_build_object('vendor_returns', n);
  delete from public.trade_sample_events where true;       get diagnostics n = row_count; counts := counts || jsonb_build_object('trade_sample_events', n);
  delete from public.sample_json_imports where true;       get diagnostics n = row_count; counts := counts || jsonb_build_object('sample_json_imports', n);
  delete from public.inventory_adjustments where true;     get diagnostics n = row_count; counts := counts || jsonb_build_object('inventory_adjustments', n);
  delete from public.lab_results where true;               get diagnostics n = row_count; counts := counts || jsonb_build_object('lab_results', n);
  delete from public.inventory_lots where true;            get diagnostics n = row_count; counts := counts || jsonb_build_object('inventory_lots', n);

  delete from public.vendor_manifest_payments where true;  get diagnostics n = row_count; counts := counts || jsonb_build_object('vendor_manifest_payments', n);
  delete from public.manifest_documents where true;        get diagnostics n = row_count; counts := counts || jsonb_build_object('manifest_documents', n);
  delete from public.manifest_events where true;           get diagnostics n = row_count; counts := counts || jsonb_build_object('manifest_events', n);
  delete from public.inbound_manifests where true;         get diagnostics n = row_count; counts := counts || jsonb_build_object('inbound_manifests', n);

  delete from public.noncannabis_invoice_lines where true; get diagnostics n = row_count; counts := counts || jsonb_build_object('noncannabis_invoice_lines', n);
  delete from public.noncannabis_invoices where true;      get diagnostics n = row_count; counts := counts || jsonb_build_object('noncannabis_invoices', n);
  delete from public.noncannabis_adjustments where true;   get diagnostics n = row_count; counts := counts || jsonb_build_object('noncannabis_adjustments', n);

  delete from public.loyalty_redemptions where true;       get diagnostics n = row_count; counts := counts || jsonb_build_object('loyalty_redemptions', n);
  delete from public.loyalty_ledger where true;            get diagnostics n = row_count; counts := counts || jsonb_build_object('loyalty_ledger', n);
  delete from public.loyalty_accounts where true;          get diagnostics n = row_count; counts := counts || jsonb_build_object('loyalty_accounts', n);
  delete from public.loyalty_signups where true;           get diagnostics n = row_count; counts := counts || jsonb_build_object('loyalty_signups', n);
  delete from public.patient_authorizations where true;    get diagnostics n = row_count; counts := counts || jsonb_build_object('patient_authorizations', n);
  delete from public.customers where true;                 get diagnostics n = row_count; counts := counts || jsonb_build_object('customers', n);

  delete from public.plaid_webhook_events where true;      get diagnostics n = row_count; counts := counts || jsonb_build_object('plaid_webhook_events', n);
  delete from public.plaid_holdings where true;            get diagnostics n = row_count; counts := counts || jsonb_build_object('plaid_holdings', n);
  delete from public.plaid_mortgages where true;           get diagnostics n = row_count; counts := counts || jsonb_build_object('plaid_mortgages', n);
  delete from public.plaid_transactions where true;        get diagnostics n = row_count; counts := counts || jsonb_build_object('plaid_transactions', n);

  delete from public.atm_reconciliation where true;        get diagnostics n = row_count; counts := counts || jsonb_build_object('atm_reconciliation', n);
  delete from public.atm_settlements where true;           get diagnostics n = row_count; counts := counts || jsonb_build_object('atm_settlements', n);
  delete from public.atm_cash_loads where true;            get diagnostics n = row_count; counts := counts || jsonb_build_object('atm_cash_loads', n);
  delete from public.atm_transactions where true;          get diagnostics n = row_count; counts := counts || jsonb_build_object('atm_transactions', n);
  delete from public.atm_terminal_status where true;       get diagnostics n = row_count; counts := counts || jsonb_build_object('atm_terminal_status', n);

  delete from public.crypto_tx_classifications where true; get diagnostics n = row_count; counts := counts || jsonb_build_object('crypto_tx_classifications', n);
  delete from public.crypto_transfer_matches where true;   get diagnostics n = row_count; counts := counts || jsonb_build_object('crypto_transfer_matches', n);
  delete from public.crypto_transactions where true;       get diagnostics n = row_count; counts := counts || jsonb_build_object('crypto_transactions', n);
  delete from public.crypto_balances where true;           get diagnostics n = row_count; counts := counts || jsonb_build_object('crypto_balances', n);
  delete from public.crypto_price_snapshots where true;    get diagnostics n = row_count; counts := counts || jsonb_build_object('crypto_price_snapshots', n);
  delete from public.crypto_sync_state where true;         get diagnostics n = row_count; counts := counts || jsonb_build_object('crypto_sync_state', n);

  delete from public.manual_loan_payments where true;      get diagnostics n = row_count; counts := counts || jsonb_build_object('manual_loan_payments', n);

  update public.plaid_items
     set transactions_cursor   = null,
         last_successful_sync  = null
   where transactions_cursor is not null
      or last_successful_sync is not null;

  update public.atm_connection
     set last_sync_at = null,
         last_error   = null
   where last_sync_at is not null
      or last_error is not null;

  delete from public.gl_bank_matches where true;             get diagnostics n = row_count; counts := counts || jsonb_build_object('gl_bank_matches', n);
  delete from public.gl_bank_reconciliations where true;     get diagnostics n = row_count; counts := counts || jsonb_build_object('gl_bank_reconciliations', n);
  delete from public.gl_classification_suggestions where true; get diagnostics n = row_count; counts := counts || jsonb_build_object('gl_classification_suggestions', n);
  delete from public.gl_opening_balances where true;         get diagnostics n = row_count; counts := counts || jsonb_build_object('gl_opening_balances', n);
  delete from public.gl_payroll_allocations where true;      get diagnostics n = row_count; counts := counts || jsonb_build_object('gl_payroll_allocations', n);
  delete from public.gl_override_log where true;             get diagnostics n = row_count; counts := counts || jsonb_build_object('gl_override_log', n);
  delete from public.gl_template_changes where true;         get diagnostics n = row_count; counts := counts || jsonb_build_object('gl_template_changes', n);
  delete from public.gl_account_proposals where true;        get diagnostics n = row_count; counts := counts || jsonb_build_object('gl_account_proposals', n);
  delete from public.gl_journal_lines where true;            get diagnostics n = row_count; counts := counts || jsonb_build_object('gl_journal_lines', n);
  delete from public.gl_journals where true;                 get diagnostics n = row_count; counts := counts || jsonb_build_object('gl_journals', n);
  delete from public.gl_periods where true;                  get diagnostics n = row_count; counts := counts || jsonb_build_object('gl_periods', n);
  delete from public.gl_audit_events where true;             get diagnostics n = row_count; counts := counts || jsonb_build_object('gl_audit_events', n);

  delete from public.discovery_ccrs_sales where true;      get diagnostics n = row_count; counts := counts || jsonb_build_object('discovery_ccrs_sales', n);
  delete from public.discovery_ccrs_products where true;   get diagnostics n = row_count; counts := counts || jsonb_build_object('discovery_ccrs_products', n);
  delete from public.discovery_ccrs_lab where true;        get diagnostics n = row_count; counts := counts || jsonb_build_object('discovery_ccrs_lab', n);
  delete from public.discovery_ccrs_licensees where true;  get diagnostics n = row_count; counts := counts || jsonb_build_object('discovery_ccrs_licensees', n);
  delete from public.discovery_benchmarks where true;      get diagnostics n = row_count; counts := counts || jsonb_build_object('discovery_benchmarks', n);
  delete from public.discovery_market_signals where true;  get diagnostics n = row_count; counts := counts || jsonb_build_object('discovery_market_signals', n);
  delete from public.discovery_competitor_stats where true; get diagnostics n = row_count; counts := counts || jsonb_build_object('discovery_competitor_stats', n);
  delete from public.discovery_supplier_stats where true;  get diagnostics n = row_count; counts := counts || jsonb_build_object('discovery_supplier_stats', n);
  delete from public.discovery_producer_stats where true;  get diagnostics n = row_count; counts := counts || jsonb_build_object('discovery_producer_stats', n);
  delete from public.discovery_product_leads where true;   get diagnostics n = row_count; counts := counts || jsonb_build_object('discovery_product_leads', n);
  delete from public.discovery_vendor_leads where true;    get diagnostics n = row_count; counts := counts || jsonb_build_object('discovery_vendor_leads', n);
  delete from public.discovery_competitors where true;     get diagnostics n = row_count; counts := counts || jsonb_build_object('discovery_competitors', n);
  delete from public.discovery_doh_sellers where true;     get diagnostics n = row_count; counts := counts || jsonb_build_object('discovery_doh_sellers', n);
  delete from public.discovery_datasets where true;        get diagnostics n = row_count; counts := counts || jsonb_build_object('discovery_datasets', n);

  delete from public.promotion_audit_snapshots where true; get diagnostics n = row_count; counts := counts || jsonb_build_object('promotion_audit_snapshots', n);
  delete from public.equipment_service_events where true;  get diagnostics n = row_count; counts := counts || jsonb_build_object('equipment_service_events', n);
  delete from public.newsletter_email_events where true;   get diagnostics n = row_count; counts := counts || jsonb_build_object('newsletter_email_events', n);
  delete from public.newsletter_sends where true;          get diagnostics n = row_count; counts := counts || jsonb_build_object('newsletter_sends', n);
  delete from public.inbound_email_log where true;         get diagnostics n = row_count; counts := counts || jsonb_build_object('inbound_email_log', n);
  delete from public.sage_chat_messages where true;        get diagnostics n = row_count; counts := counts || jsonb_build_object('sage_chat_messages', n);
  delete from public.sage_import_uploads where true;       get diagnostics n = row_count; counts := counts || jsonb_build_object('sage_import_uploads', n);
  delete from public.ai_usage where true;                  get diagnostics n = row_count; counts := counts || jsonb_build_object('ai_usage', n);

  perform set_config('greenway.factory_reset', 'off', true);

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, after_json)
  values (
    v_actor,
    'ops.factory_reset',
    'database',
    'factory_reset',
    jsonb_build_object(
      'reset_at', now(),
      'acknowledged_wac_314_55_087', acknowledge_wac_314_55_087,
      'looked_like_real_trade', v_trade,
      'evidence_at_reset', jsonb_build_object(
        'completed_orders', v_orders,
        'ccrs_batches', v_ccrs,
        'excise_returns_filed', v_excise,
        'posted_journals', v_journals
      ),
      'tables', counts
    )
  );

  return jsonb_build_object(
    'ok', true,
    'reset_at', now(),
    'acknowledged_wac_314_55_087', acknowledge_wac_314_55_087,
    'retention_cite', 'WAC 314-55-087(1)',
    'retention_years', 5,
    'evidence_at_reset', jsonb_build_object(
      'completed_orders', v_orders,
      'ccrs_batches', v_ccrs,
      'excise_returns_filed', v_excise,
      'posted_journals', v_journals
    ),
    'tables', counts,
    'tables_emptied', (select count(*) from jsonb_each_text(counts)),
    'total_rows_deleted', (
      select coalesce(sum((value)::int), 0) from jsonb_each_text(counts)
    )
  );
end $$;

comment on function public.gl_factory_reset(text, boolean) is
  '0209 (books-80): THE factory reset. Owner-only, requires the typed phrase ERASE ALL TEST DATA, and empties every table classified WIPE by src/lib/accounting/factory-reset-core.ts - INCLUDING the general ledger, which reset_operational_data() (0069/0097/0140) never touched because the ledger was born 32 migrations later (D-62). Keeps the chart of accounts, entities, shareholders, settings, integration credentials, the knowledge base, curated catalogue, people, logins and the audit log. Also keeps the CONNECTIONS themselves (D-65) - plaid_items, plaid_accounts, atm_connection, manual_loans and the crypto wallets/assets/rules - so a rehearsal never costs a re-link through Plaid MFA or a re-entry of the PAI password; their activity still clears, and their sync cursors are rewound so the wiped history genuinely re-downloads. Retention guard cites WAC 314-55-087(1) FIVE years per WSR 24-19-040 eff. 10/12/2024 (the old guard said three - D-63). Immutability is not weakened: it gains one transaction-local exception via gl_factory_reset_active().';

revoke all on function public.gl_factory_reset(text, boolean) from public;
grant execute on function public.gl_factory_reset(text, boolean) to authenticated, service_role;

alter function public.gl_audit_factory_reset() reset statement_timeout;
alter function public.gl_audit_factory_reset() reset lock_timeout;

notify pgrst, 'reload schema';
