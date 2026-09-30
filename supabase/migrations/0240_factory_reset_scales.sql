-- =============================================================================
-- 0240 - The factory reset scales (D-82)
-- =============================================================================
-- The owner asked, in his own words:
--
--   "I just want the back office feature to work so I can wipe it, test it,
--    wipe it, etc. ... Please build it so it scales, so we are not just
--    barely making it in time to delete everything, so if we grow more, we
--    can still use the reset feature without hitting timeouts or limits."
--
-- WHAT WAS BROKEN
-- Pressing Reset on /admin/settings/reset showed
--   Reset failed: canceling statement due to statement timeout
-- The button calls gl_factory_reset() through the Supabase API as the signed
-- in owner. Supabase gives that role (authenticated) an 8 second statement
-- timeout. 0209 empties the 139 WIPE tables one row at a time (139 DELETE
-- statements). Row-by-row deletes fire every row trigger. The worst is the
-- 0232 customer rollup trigger on orders, which recomputes a customer on
-- every deleted order. Measured on a throwaway Postgres 15 with 0001-0239
-- applied, 40000 orders and 2.4 million CCRS discovery rows, with the
-- timeout set to 8s exactly as Supabase sets it:
--   0209 reset: canceled after 8.0 s at delete ... public.orders
-- The time grows with every order, every CCRS upload and every Cultivera
-- upload, so the reset only ever gets slower as the store grows.
--
-- WHAT THIS FILE DOES
-- Re-creates gl_factory_reset with the SAME name, arguments, owner gate,
-- typed phrase, retention guard, audit record and result shape, and changes
-- only HOW the tables are emptied:
--   1. It locks the 139 WIPE tables, counts each one (so the owner still
--      sees an exact per-table count), then empties all of them with ONE
--      TRUNCATE statement. TRUNCATE drops the table storage in one step. Its
--      cost does not grow with the number of rows, and it fires no row
--      triggers, so the rollup and guard triggers cost nothing.
--   2. Before touching anything it checks that every WIPE table exists, that
--      it may be emptied, and that no KEPT table has a foreign key into a
--      WIPE table (TRUNCATE would refuse, and CASCADE would silently empty a
--      kept table, so CASCADE is never used). Any problem stops the reset
--      with a plain RESET_... message and nothing is deleted.
--   3. It declares its own time limits: statement_timeout 55s (Supabase
--      honours a function level statement_timeout on API calls) and
--      lock_timeout 20s (so a busy table produces a clear error, never a
--      hang). Measured on the same data the whole reset takes well under one
--      second, so 55s is headroom, not a target.
--   4. The preview (now also reporting reset_engine) and the post-reset audit
--      get the same time limits.
-- What does NOT change: the same 139 tables are emptied (the list is the one
-- 0209 deletes, in the same order), the connections and their cursor rewinds
-- (D-65) are unchanged, sequences are not restarted (TRUNCATE without
-- RESTART IDENTITY), audit_logs keeps the one ops.factory_reset record, and
-- every immutability guard still refuses UPDATE and DELETE outside a reset.
-- No trigger is dropped or disabled.
--
-- Depends on 0209. Refuses to run, by name, if 0209 is missing. Idempotent:
-- create or replace and alter only. APPLY MANUALLY in the Supabase SQL editor
-- (standing rule 6). The editor will warn about a destructive operation
-- because the function body contains the word truncate. That warning is
-- expected: running this file deletes nothing, it only installs the function.
-- Owner steps: docs/MICHAEL-0240-fix-the-reset-button.md
-- ROLLBACK: supabase/rollbacks/0240_factory_reset_scales.rollback.sql
-- =============================================================================

do $precheck$
begin
  if to_regprocedure('public.gl_factory_reset_active()') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0240 depends on gl_factory_reset_active() from 0209_factory_reset.sql';
  end if;
  if to_regprocedure('public.gl_factory_reset(text, boolean)') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0240 depends on gl_factory_reset(text, boolean) from 0209_factory_reset.sql';
  end if;
  if to_regprocedure('public.gl_audit_factory_reset()') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0240 depends on gl_audit_factory_reset() from 0209_factory_reset.sql';
  end if;
  if to_regclass('public.audit_logs') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0240 depends on audit_logs';
  end if;
end
$precheck$;

-- 1. The preview. Same body as 0209, plus reset_engine so the reset screen can
-- tell whether this file has been applied, plus the time limits.
create or replace function public.gl_factory_reset_preview()
returns jsonb
language plpgsql
security definer
set search_path = public
set statement_timeout = '55s'
set lock_timeout = '20s'
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
    'retention_years',       5,
    'reset_engine',          'truncate-0240'
  );
end $$;

comment on function public.gl_factory_reset_preview() is
  '0209, time limits and reset_engine added by 0240 (D-82): owner-only. Reports the four kinds of evidence that real trade has occurred (completed sales, CCRS files, filed excise returns, posted journals) so the reset screen can warn BEFORE anything is destroyed. Read-only.';

revoke all on function public.gl_factory_reset_preview() from public;
grant execute on function public.gl_factory_reset_preview() to authenticated, service_role;

-- 2. The reset.
create or replace function public.gl_factory_reset(
  confirm_phrase               text,
  acknowledge_wac_314_55_087   boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
set statement_timeout = '55s'
set lock_timeout = '20s'
as $$
declare
  -- The 139 WIPE tables, in the order 0209 deleted them. The set is pinned
  -- to factory-reset-core.ts by tests/compliance/d82-factory-reset-scales.test.ts
  wipe constant text[] := array[
    'customer_returns',
    'receipt_print_jobs',
    'pos_sale_events',
    'special_discount_uses',
    'order_events',
    'order_lines',
    'medical_exempt_sales',
    'sales_limit_events',
    'leafly_register_interrupts',
    'orders',
    'till_verifications',
    'drawer_drops',
    'drawer_counts',
    'safe_swaps',
    'safe_counts',
    'deposit_bag_sessions',
    'deposit_bags',
    'drawer_sessions',
    'announcer_queue',
    'announcer_pairings',
    'excise_return_drafts',
    'excise_return_batches',
    'ccrs_adjustment_batches',
    'ccrs_export_batches',
    'ccrs_week_submissions',
    'compliance_reminder_log',
    'syndication_logs',
    'syndication_sync_state',
    'leafly_sync_runs',
    'leafly_outbound_attempts',
    'leafly_webhook_events',
    'leafly_orders',
    'payroll_run_lines',
    'payroll_runs',
    'payroll_source_documents',
    'payroll_ytd_accumulators',
    'filed_form_941_totals',
    'sick_leave_ledger',
    'sick_leave_requests',
    'wage_orders',
    'time_punches',
    'shifts',
    'pay_periods',
    'employee_ssn_reveals',
    'purchase_order_lines',
    'purchase_orders',
    'ai_suggestions',
    'product_master_suggestions',
    'catalog_product_drafts',
    'menu_variants',
    'menu_items',
    'menu_versions',
    'pos_import_diagnostics',
    'pos_fact_reviews',
    'pos_imports',
    'cultivera_menu_items',
    'cultivera_menu_snapshots',
    'growflow_menu_items',
    'growflow_menu_snapshots',
    'leaflink_menu_items',
    'leaflink_menu_snapshots',
    'emailed_menu_items',
    'emailed_menu_snapshots',
    'inventory_audit_postings',
    'inventory_audit_lines',
    'inventory_audit_history',
    'inventory_audit_sessions',
    'cycle_count_lines',
    'cycle_counts',
    'destruction_events',
    'vendor_returns',
    'trade_sample_events',
    'sample_json_imports',
    'inventory_adjustments',
    'lab_results',
    'inventory_lots',
    'vendor_manifest_payments',
    'manifest_documents',
    'manifest_events',
    'inbound_manifests',
    'noncannabis_invoice_lines',
    'noncannabis_invoices',
    'noncannabis_adjustments',
    'loyalty_redemptions',
    'loyalty_ledger',
    'loyalty_accounts',
    'loyalty_signups',
    'patient_authorizations',
    'customers',
    'plaid_webhook_events',
    'plaid_holdings',
    'plaid_mortgages',
    'plaid_transactions',
    'atm_reconciliation',
    'atm_settlements',
    'atm_cash_loads',
    'atm_transactions',
    'atm_terminal_status',
    'crypto_tx_classifications',
    'crypto_transfer_matches',
    'crypto_transactions',
    'crypto_balances',
    'crypto_price_snapshots',
    'crypto_sync_state',
    'manual_loan_payments',
    'gl_bank_matches',
    'gl_bank_reconciliations',
    'gl_classification_suggestions',
    'gl_opening_balances',
    'gl_payroll_allocations',
    'gl_override_log',
    'gl_template_changes',
    'gl_account_proposals',
    'gl_journal_lines',
    'gl_journals',
    'gl_periods',
    'gl_audit_events',
    'discovery_ccrs_sales',
    'discovery_ccrs_products',
    'discovery_ccrs_lab',
    'discovery_ccrs_licensees',
    'discovery_benchmarks',
    'discovery_market_signals',
    'discovery_competitor_stats',
    'discovery_supplier_stats',
    'discovery_producer_stats',
    'discovery_product_leads',
    'discovery_vendor_leads',
    'discovery_competitors',
    'discovery_doh_sellers',
    'discovery_datasets',
    'promotion_audit_snapshots',
    'equipment_service_events',
    'newsletter_email_events',
    'newsletter_sends',
    'inbound_email_log',
    'sage_chat_messages',
    'sage_import_uploads',
    'ai_usage'
  ];
  counts     jsonb := '{}'::jsonb;
  n          bigint;
  t          text;
  v_list     text;
  v_oids     oid[];
  v_problem  text;
  v_orders   integer := 0;
  v_ccrs     integer := 0;
  v_excise   integer := 0;
  v_journals integer := 0;
  v_trade    boolean;
  v_actor    uuid := auth.uid();
begin
  -- Who
  if not public.is_owner() then
    raise exception 'RESET_NOT_OWNER: only the owner may run the factory reset.'
      using errcode = 'raise_exception';
  end if;

  -- Deliberate intent: the sentence in full, exactly as 0209.
  if coalesce(btrim(confirm_phrase), '') <> 'ERASE ALL TEST DATA' then
    raise exception 'RESET_BAD_CONFIRMATION: type exactly ERASE ALL TEST DATA to confirm. Nothing has been deleted.'
      using errcode = 'raise_exception';
  end if;

  -- Is this still a rehearsal? Same four questions as 0209.
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

  -- Preflight. Nothing below this block runs unless all three checks pass,
  -- and nothing above it changed anything.
  select string_agg(x, ', ' order by ord) into v_problem
    from unnest(wipe) with ordinality as w(x, ord)
   where to_regclass('public.' || quote_ident(x)) is null;
  if v_problem is not null then
    raise exception 'RESET_SCHEMA_DRIFT: the reset expects these tables and the database does not have them: %. Nothing has been deleted.', v_problem
      using errcode = 'raise_exception';
  end if;

  select array_agg(to_regclass('public.' || quote_ident(x))::oid) into v_oids
    from unnest(wipe) as w(x);

  select string_agg(c.relname, ', ' order by c.relname) into v_problem
    from pg_class c
   where c.oid = any (v_oids)
     and not has_table_privilege(c.oid, 'TRUNCATE');
  if v_problem is not null then
    raise exception 'RESET_NO_PRIVILEGE: the reset function is not allowed to empty: %. Nothing has been deleted.', v_problem
      using errcode = 'raise_exception';
  end if;

  select string_agg(format('%s.%s points at %s', src.relname, k.conname, dst.relname), ', '
                    order by src.relname, k.conname) into v_problem
    from pg_constraint k
    join pg_class src on src.oid = k.conrelid
    join pg_class dst on dst.oid = k.confrelid
   where k.contype = 'f'
     and k.confrelid = any (v_oids)
     and not (k.conrelid = any (v_oids));
  if v_problem is not null then
    raise exception 'RESET_KEPT_TABLE_POINTS_AT_WIPE: a kept table has a foreign key into a table the reset empties (%). Classify it in factory-reset-core.ts and ship a migration. Nothing has been deleted.', v_problem
      using errcode = 'raise_exception';
  end if;

  select string_agg(format('public.%I', x), ', ' order by ord) into v_list
    from unnest(wipe) with ordinality as w(x, ord);

  -- The door stays marked exactly as in 0209, so anything that asks
  -- gl_factory_reset_active() during this transaction gets the same answer.
  perform set_config('greenway.factory_reset', 'on', true);

  -- Lock first so the counts are exact: nobody can add a row between the
  -- count and the empty. lock_timeout (20s) turns a busy table into a clear
  -- error instead of a hang.
  execute format('lock table %s in access exclusive mode', v_list);

  foreach t in array wipe loop
    execute format('select count(*) from public.%I', t) into n;
    counts := counts || jsonb_build_object(t, n);
  end loop;

  -- One statement, 139 tables. No CASCADE (the preflight proved nothing kept
  -- depends on them) and no RESTART IDENTITY (sequences carry on, as in 0209).
  execute format('truncate table %s', v_list);

  -- Rewind the readers on the connections we kept (D-65), exactly as 0209.
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

  perform set_config('greenway.factory_reset', 'off', true);

  -- The audit log is KEPT: it records the reset itself.
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, after_json)
  values (
    v_actor,
    'ops.factory_reset',
    'database',
    'factory_reset',
    jsonb_build_object(
      'reset_at', now(),
      'reset_engine', 'truncate-0240',
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
    'reset_engine', 'truncate-0240',
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
      select coalesce(sum((value)::bigint), 0) from jsonb_each_text(counts)
    )
  );
end $$;

comment on function public.gl_factory_reset(text, boolean) is
  '0209 (books-80), made to scale by 0240 (D-82): THE factory reset. Owner-only, requires the typed phrase ERASE ALL TEST DATA, keeps the retention guard (WAC 314-55-087(1), five years), and empties every table classified WIPE by src/lib/accounting/factory-reset-core.ts with ONE lock and ONE truncate, after counting each table, so its run time does not grow with the number of rows. Declares statement_timeout 55s and lock_timeout 20s. Keeps the chart of accounts, entities, shareholders, settings, integration credentials, the knowledge base, curated catalogue, people, logins, connections (cursors rewound, D-65) and the audit log.';

revoke all on function public.gl_factory_reset(text, boolean) from public;
grant execute on function public.gl_factory_reset(text, boolean) to authenticated, service_role;

-- 3. The post-reset audit: body unchanged, same time limits.
alter function public.gl_audit_factory_reset() set statement_timeout = '55s';
alter function public.gl_audit_factory_reset() set lock_timeout = '20s';

-- The API reads function time limits from its schema cache. Refresh it.
notify pgrst, 'reload schema';
