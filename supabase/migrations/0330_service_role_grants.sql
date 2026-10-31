-- 0330_service_role_grants.sql  (slice R-RET · owner message 10 · customer returns broken)
--
-- WHY. The owner, verbatim (2026-10-31):
--   "the front register says, "the return was not saved and nothing was changed:
--    permission denied for function record_customer_return.""
--
-- ROOT CAUSE (reproduced on PostgreSQL 15, scripts/recon/service-role-grants-0330-pg-check.sql).
--   Supabase changed the defaults of every existing project on 2026-10-30
--   (supabase discussion #45329, "Tables not exposed to Data and GraphQL API
--   automatically"). Before that date, every table, sequence and function created
--   in `public` was automatically granted to anon, authenticated AND service_role.
--   After it, nothing is granted automatically: each object needs an explicit GRANT.
--
--   The website and the register talk to the database through the Data API with
--   the service_role key (src/lib/supabase/admin.ts). service_role bypasses RLS,
--   but NOT grants: a missing grant is "42501 permission denied".
--
--   0308 (customer returns) ends with
--       revoke execute on function public.record_customer_return(...) from public, anon, authenticated;
--   and never says `grant execute ... to service_role`. Before 2026-10-30 that was
--   harmless (service_role kept the automatic grant). A copy applied (or re-applied)
--   after 2026-10-30 leaves service_role with no right to call it, so every return
--   fails with exactly the owner's message. 0309 (vendor returns) and 0323 (Other
--   Inventory register sale / return / invoice) have the same shape, and tables
--   created by 0311/0312/0317/0318/0327 have no grants at all.
--
-- WHAT. Grants only. No table, column, policy, function body or row changes.
--   1. EXECUTE to service_role on every function the app calls that 0129-0326
--      revoked without granting back (named list, so the intent is reviewable).
--   2. A sweep for anything else in `public` that service_role cannot reach:
--        * functions (not trigger functions, not extension-owned): EXECUTE;
--        * tables / partitioned tables with NO select for service_role:
--          select, insert, update, delete;
--        * views / materialized views with no select: select;
--        * sequences with no usage: usage, select.
--      The append-only ledgers (audit_logs, the ACH and OFAC records) are named:
--      their update/delete revokes from service_role are deliberate (0130, 0193,
--      0271, 0273, 0277, 0278, 0288-0291), so if one of them has no grant at all
--      it gets only select + insert, and an existing grant is never widened. The sweep only ADDS rights service_role is missing; it never touches
--      anon or authenticated, so nothing new becomes reachable by a browser.
--   3. Default privileges for the `postgres` role in `public`: future tables,
--      sequences and functions are granted to service_role ONLY. This puts back
--      the half of the pre-2026-10-30 behaviour the server needs, without putting
--      back the half Supabase removed on purpose (anon / authenticated stay
--      explicit). If the SQL editor refuses it, a NOTICE says so and the rest of
--      the file still applies.
--   4. notify pgrst so the Data API sees the new rights immediately.
--
-- CCRS. Not touched: no CCRS table, column, function body or file-generation path
-- changes. Only who may call/read existing objects.
--
-- FACTORY RESET. Unchanged (no new tables).
-- Safe to re-run: GRANT is idempotent; every named function is guarded by
-- to_regprocedure, so a database that never ran a migration skips it with a NOTICE.

-- 1. Named functions the app calls through the service role -----------------
do $$
declare
  sig text;
  sigs text[] := array[
    -- 0308 customer returns (the owner's error)
    'public.record_customer_return(uuid, numeric, text, uuid, boolean, jsonb, jsonb)',
    'public.consume_lot_hold(uuid, numeric, uuid)',
    'public.release_lot_hold(uuid, numeric, uuid)',
    -- 0309 vendor returns
    'public.reserve_vendor_return(uuid, numeric, uuid, jsonb)',
    'public.depart_vendor_return(uuid, text, timestamptz, text, uuid)',
    'public.release_vendor_return(uuid, text, uuid)',
    -- 0323 Other Inventory on the register (sale, return, invoice)
    'public.apply_noncannabis_delta(uuid, integer, text, text, uuid, boolean, uuid, uuid)',
    'public.record_noncannabis_invoice(jsonb, jsonb, uuid)',
    'public.record_noncannabis_return(uuid, integer, boolean, text, uuid, jsonb)',
    -- 0326 audit counter check
    'public.inventory_audit_counter_check(uuid, boolean)',
    -- 0129 stock deltas
    'public.apply_lot_delta(uuid, numeric, boolean, uuid, boolean)',
    'public.apply_variant_delta(uuid, integer)',
    -- 0175 / 0176 / 0186 general ledger
    'public.gl_trial_balance_check(text, date, date)',
    'public.gl_general_ledger(text, text, date, date)',
    'public.gl_open_fiscal_year(integer)',
    'public.gl_opening_balance_summary(text)',
    'public.gl_bless_opening_balances(text, text)',
    'public.gl_close_opening_balance_equity(text, text)',
    'public.gl_audit_cutover_date()',
    'public.gl_opening_balance_date()',
    'public.gl_cutover_date()',
    -- 0187 / 0188 / 0189 vendor bills, payroll, bank
    'public.gl_post_vendor_bill(text, date, text, text, jsonb, bigint, boolean, boolean, text, text, uuid, uuid)',
    'public.gl_audit_vendor_bill_wiring()',
    'public.gl_post_payroll_run(text, date, text, text, jsonb, bigint, text, uuid, text)',
    'public.gl_audit_payroll_wiring()',
    'public.gl_bank_sign_agrees(bigint, bigint)',
    'public.gl_post_bank_match(text, uuid, text, integer, text)',
    'public.gl_unmatch_bank_row(text, text)',
    'public.gl_bank_reconcile(text, text, text, date, date, bigint)',
    'public.gl_sign_off_bank_reconciliation(uuid, text)',
    'public.gl_audit_bank_wiring()',
    -- 0195 / 0196 / 0198 audits
    'public.gl_audit_employee_payroll_setup()',
    'public.gl_audit_company_profile()',
    'public.gl_audit_sick_and_orders()',
    -- 0222 announcer
    'public.announcer_claim_work(uuid, integer, integer, integer)',
    'public.announcer_expire_stale(integer)'
  ];
begin
  foreach sig in array sigs loop
    if to_regprocedure(sig) is null then
      raise notice '0330: % is not in this database (its migration has not run) - skipped', sig;
    else
      execute format('grant execute on function %s to service_role', sig);
    end if;
  end loop;
end $$;

-- 2. Sweep: anything else in public that service_role cannot reach ----------
do $$
declare
  r record;
  -- Deliberately append-only for service_role. Never re-granted here.
  protected text[] := array[
    'audit_logs',
    'ach_change_requests', 'ach_change_request_events', 'ach_owner_reviews',
    'ach_files', 'ach_timberland_comms',
    'ofac_screening_runs', 'ofac_screening_results', 'ofac_match_reviews',
    'ach_annual_reviews', 'ach_bank_watch_rules', 'ach_bank_watch_reviews',
    'ach_notice_mail', 'ach_control_records'
  ];
  n_fn int := 0; n_tb int := 0; n_vw int := 0; n_sq int := 0;
begin
  for r in
    select p.oid::regprocedure as sig, p.prokind
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind in ('f', 'p')
       and p.prorettype <> 'trigger'::regtype
       and not exists (select 1 from pg_depend d
                        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
       and not has_function_privilege('service_role', p.oid, 'EXECUTE')
  loop
    execute format('grant execute on %s %s to service_role',
                   case when r.prokind = 'p' then 'procedure' else 'function' end,
                   r.sig);
    n_fn := n_fn + 1;
  end loop;

  for r in
    select c.oid, c.relname, c.relkind
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p', 'v', 'm')
       and not exists (select 1 from pg_depend d
                        where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
       and not has_table_privilege('service_role', c.oid, 'SELECT')
  loop
    if r.relname = any (protected) then
      -- append-only: read and add, never change or remove
      execute format('grant select, insert on table public.%I to service_role', r.relname);
      n_tb := n_tb + 1;
    elsif r.relkind in ('r', 'p') then
      execute format('grant select, insert, update, delete on table public.%I to service_role', r.relname);
      n_tb := n_tb + 1;
    else
      execute format('grant select on table public.%I to service_role', r.relname);
      n_vw := n_vw + 1;
    end if;
  end loop;

  for r in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'S'
       and not exists (select 1 from pg_depend d
                        where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
       -- CASE: the planner may test rows before the relkind filter, and
       -- has_sequence_privilege errors on anything that is not a sequence.
       and (case when c.relkind = 'S' then not has_sequence_privilege('service_role', c.oid, 'USAGE') else false end)
  loop
    execute format('grant usage, select on sequence public.%I to service_role', r.relname);
    n_sq := n_sq + 1;
  end loop;

  raise notice '0330: granted service_role % function(s), % table(s), % view(s), % sequence(s) it could not reach',
    n_fn, n_tb, n_vw, n_sq;
end $$;

-- 3. Future objects: service_role only (anon / authenticated stay explicit) --
do $$
begin
  alter default privileges for role postgres in schema public
    grant select, insert, update, delete on tables to service_role;
  alter default privileges for role postgres in schema public
    grant usage, select on sequences to service_role;
  alter default privileges for role postgres in schema public
    grant execute on functions to service_role;
exception when insufficient_privilege or undefined_object then
  raise notice '0330: could not set default privileges for role postgres (%). Grants above still applied; every new migration must grant service_role explicitly (tests/compliance/r-ret-service-role-grants.test.ts enforces it).', sqlerrm;
end $$;

-- 4. Tell the Data API.
notify pgrst, 'reload schema';
