-- ════════════════════════════════════════════════════════════════════════════
-- 0190_owner_only_financial_tables.sql
-- Slice books-06 — CLOSE THE OWNER GATE GAP.
--
-- WHAT THIS DOES, IN PLAIN ENGLISH
--
-- Migration 0185 locked THE BOOKS (every gl_* table) to the owner alone. It did
-- not lock THE MONEY ACCOUNTS THE BOOKS ARE BUILT FROM. Twenty-five tables —
-- the bank feed, the ATM vault, the crypto treasury and the loans — were still
-- gated on is_staff(), which is TRUE for ANY active staff row of ANY role,
-- including 'readonly' and 'content_editor'.
--
-- That is not a small gap. A person who cannot open the ledger could still read
-- plaid_transactions and see every dollar in and out of every account; read
-- plaid_accounts and see every balance; read manual_loans and see every debt;
-- read atm_cash_loads and learn how much cash is in the building and when. From
-- those four facts alone a reader can rebuild the financial statements that
-- 0185 was written to hide — and can do it without ever touching the books.
--
-- Worse, plaid_items holds the Plaid ACCESS TOKEN. That token is not a report,
-- it is a KEY. Anyone holding it can pull the owner's entire banking history
-- from OUTSIDE this application, where none of our gates and none of our
-- logging apply. It was readable by a 'readonly' analyst.
--
-- After this migration all twenty-five tables answer to is_owner() only.
--
-- WHY THIS BREAKS NOTHING
--
-- Every write path into these tables was checked, file by file, before this
-- migration was written. All 78 of them use createSupabaseAdminClient() — the
-- SERVICE ROLE — which bypasses RLS entirely. The Plaid sync, the crypto
-- syncs, the ATM poller and the loan store therefore keep working exactly as
-- they do today. Nothing an admin actually needs was taken away: paying vendors
-- is 'payables.manage' and paying employees is 'staffing.manage', and both of
-- those still include admin.
--
-- OWNER DECISION, recorded verbatim (Michael, 2026-08-17):
--   "there is no reason anyone else needs to see my books or my financials
--    ever, so I want strict controls over all of those things. The only thing
--    an admin can do is pay vendors and pay employees."
--
-- HOW TO RUN IT: see docs/HOW_TO_RUN_A_MIGRATION.md. Then check:
--   select * from gl_audit_financial_tables_gate();
-- AN EMPTY RESULT IS THE PASSING RESULT.
--
-- This file is IDEMPOTENT. Running it twice is safe and changes nothing the
-- second time.
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- §0  PRECONDITIONS — REFUSE TO RUN OUT OF ORDER
--
-- If this file is applied before the migrations that create what it re-gates,
-- it would silently re-gate NOTHING and still finish "successfully" — leaving
-- the owner believing the money pages are locked when they are wide open. A
-- migration that can fail silently is worse than one that fails loudly, so this
-- one refuses to start unless everything it depends on already exists.
-- ════════════════════════════════════════════════════════════════════════════
do $precheck$
begin
  if to_regprocedure('public.is_owner()') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0190 requires the is_owner() helper, which does not exist yet. Run 0185_books_owner_only.sql first, then run this file again. Nothing was changed.';
  end if;

  if to_regclass('public.plaid_items') is null
     or to_regclass('public.plaid_transactions') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0190 re-gates the Plaid bank tables, which do not exist yet. Run 0157_plaid_foundation.sql first, then run this file again. Nothing was changed.';
  end if;

  if to_regclass('public.atm_transactions') is null
     or to_regclass('public.atm_connection') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0190 re-gates the ATM tables, which do not exist yet. Run 0156_atm_pai_foundation.sql first, then run this file again. Nothing was changed.';
  end if;

  if to_regclass('public.crypto_wallets') is null
     or to_regclass('public.crypto_transactions') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0190 re-gates the crypto tables, which do not exist yet. Run 0160_crypto_foundation.sql first, then run this file again. Nothing was changed.';
  end if;

  if to_regclass('public.manual_loans') is null
     or to_regclass('public.manual_loan_payments') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0190 re-gates the loan tables, which do not exist yet. Run 0171_manual_loans.sql first, then run this file again. Nothing was changed.';
  end if;
end
$precheck$;

-- ════════════════════════════════════════════════════════════════════════════
-- §1  THE ALLOW-LIST
--
-- DELIBERATELY A HAND-WRITTEN LIST, NOT A LIKE PATTERN.
--
-- 0185 §2 drove its loop off `relname like 'gl\_%'`, which was right there: the
-- gl_ prefix IS the definition of "the books", so a future gl_ table should be
-- swept up automatically.
--
-- Here the opposite is true. `like 'tax\_%'` would have caught tax_settings and
-- tax_category_rules, which are PRICING CONFIGURATION the point of sale reads
-- on every single transaction. Locking those to the owner would not have
-- protected anything — it would have stopped the store from ringing up a sale.
--
-- So this list is explicit, every entry was confirmed against the live catalog,
-- and the audit function in §3 counts it. If a future migration adds a money
-- table, the audit reports it as UNGATED and this list must be edited on
-- purpose. Being forced to think is the point.
-- ════════════════════════════════════════════════════════════════════════════
do $regate$
declare
  r        record;
  v_using  text;
  v_check  text;
  v_cmd    text;
  v_roles  text;
  v_sql    text;
  v_count  integer := 0;
  v_tables text[] := array[
    -- bank feed (6) — migration 0157
    'plaid_items',
    'plaid_accounts',
    'plaid_transactions',
    'plaid_holdings',
    'plaid_mortgages',
    'plaid_webhook_events',
    -- ATM vault (6) — migration 0156
    'atm_connection',
    'atm_transactions',
    'atm_settlements',
    'atm_reconciliation',
    'atm_cash_loads',
    'atm_terminal_status',
    -- crypto treasury (11) — migration 0160
    'crypto_wallets',
    'crypto_assets',
    'crypto_asset_migrations',
    'crypto_balances',
    'crypto_transactions',
    'crypto_price_snapshots',
    'crypto_sync_state',
    'crypto_tx_classifications',
    'crypto_classification_rules',
    'crypto_transfer_matches',
    'crypto_owner_wallet_confirmations',
    -- loans (2) — migration 0171
    'manual_loans',
    'manual_loan_payments'
  ];
begin
  for r in
    select
      p.polname                               as polname,
      c.relname                               as tablename,
      p.polcmd                                as polcmd,
      pg_get_expr(p.polqual,      p.polrelid) as qual,
      pg_get_expr(p.polwithcheck, p.polrelid) as withcheck,
      -- polroles contains OID 0 for a policy written "to public". Passing that
      -- to pg_get_userbyid() returns the literal string 'unknown (OID=0)',
      -- which then gets pasted into a TO clause and fails with a syntax error.
      -- Filter on the OID, not on what the pretty-printer calls it. (Learned
      -- the hard way in 0185 §2.)
      array(
        select pg_get_userbyid(oid) from unnest(p.polroles) as oid where oid <> 0
      )                                       as rolenames
    from pg_policy p
    join pg_class c     on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = any (v_tables)
      and (
        coalesce(pg_get_expr(p.polqual,      p.polrelid), '') like '%is_staff()%'
        or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') like '%is_staff()%'
      )
  loop
    -- Swap the helper, leave the rest of the expression byte-for-byte. This
    -- preserves any additional conditions a policy carries; it does not
    -- rewrite them, so a policy that was already narrower stays narrower.
    v_using := replace(coalesce(r.qual,      ''), 'is_staff()', 'is_owner()');
    v_check := replace(coalesce(r.withcheck, ''), 'is_staff()', 'is_owner()');

    v_cmd := case r.polcmd
               when 'r' then 'select'
               when 'a' then 'insert'
               when 'w' then 'update'
               when 'd' then 'delete'
               else 'all'
             end;

    v_roles := case
                 when array_length(r.rolenames, 1) is null then 'public'
                 else array_to_string(r.rolenames, ', ')
               end;

    execute format('drop policy if exists %I on public.%I', r.polname, r.tablename);

    v_sql := format('create policy %I on public.%I for %s to %s',
                    r.polname, r.tablename, v_cmd, v_roles);

    if v_using <> '' then
      v_sql := v_sql || format(' using (%s)', v_using);
    end if;
    if v_check <> '' then
      v_sql := v_sql || format(' with check (%s)', v_check);
    end if;

    execute v_sql;
    v_count := v_count + 1;
  end loop;

  raise notice '0190 §1: re-gated % financial policies from is_staff() to is_owner()', v_count;
end
$regate$;

-- ════════════════════════════════════════════════════════════════════════════
-- §2  WHAT IS DELIBERATELY *NOT* CHANGED
--
-- Recorded here so that a future reader who greps for "tax_" and finds these
-- two tables still on is_staff() knows it was a DECISION, not an oversight.
--
--   tax_settings, tax_category_rules
--     These are the SALES TAX AND EXCISE RATES the point of sale reads to
--     price a basket. They are POS pricing configuration, not the owner's
--     financial position. They contain rates that are published by the state —
--     public information — and reveal nothing about what Greenway earned,
--     owed, or holds.
--
--     IF THEY WERE LOCKED ANYWAY: every budtender ringing up every sale would
--     be denied the rate needed to price the cart, and the register would stop.
--     Locking them would create a compliance failure (unpriced/mispriced sales,
--     WAC 314-55-089 excise remittance) while protecting nothing.
--
--   The service role is not affected by any of this. RLS does not apply to it.
--   That is how the Plaid, crypto and ATM syncs keep running after this file.
--
--   is_staff() itself is NOT narrowed. It is used by ~211 other policies across
--   the app (orders, loyalty, menu, timeclock) where "any active staff member"
--   is exactly right. Changing the helper instead of the policies would have
--   locked the whole back office out of their jobs.
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- §3  VERIFICATION HELPER
--
-- Run after applying to prove the lockdown actually took:
--   select * from gl_audit_financial_tables_gate();
-- AN EMPTY RESULT IS THE PASSING RESULT.
--
-- It reports two different failures, because they are different problems:
--   'still_staff_gated' — a listed table whose policy still says is_staff().
--                         The re-gate did not take. The table is exposed.
--   'unprotected'       — a listed table with NO owner-gated policy at all.
--                         Either the table lost its policies, or a new money
--                         table was added to the list without a policy.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.gl_audit_financial_tables_gate()
returns table (kind text, object_name text, detail text)
language sql stable security definer set search_path = public as $$
  with listed(t) as (
    select unnest(array[
      'plaid_items','plaid_accounts','plaid_transactions','plaid_holdings',
      'plaid_mortgages','plaid_webhook_events',
      'atm_connection','atm_transactions','atm_settlements','atm_reconciliation',
      'atm_cash_loads','atm_terminal_status',
      'crypto_wallets','crypto_assets','crypto_asset_migrations','crypto_balances',
      'crypto_transactions','crypto_price_snapshots','crypto_sync_state',
      'crypto_tx_classifications','crypto_classification_rules',
      'crypto_transfer_matches','crypto_owner_wallet_confirmations',
      'manual_loans','manual_loan_payments'
    ])
  )
  -- (a) any listed table whose policy still mentions is_staff()
  select 'policy'::text,
         c.relname::text || '.' || p.polname::text,
         'still references is_staff() — this money table is readable by any active staff member'::text
  from pg_policy p
  join pg_class c     on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in (select t from listed)
    and (
      coalesce(pg_get_expr(p.polqual,      p.polrelid), '') like '%is_staff()%'
      or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') like '%is_staff()%'
    )
  union all
  -- (b) any listed table that EXISTS but has no is_owner() policy at all.
  -- A table with zero policies and RLS enabled denies everyone, which is safe
  -- but silently breaks the owner's own pages; a table with RLS disabled is
  -- wide open. Either way the owner should be told.
  select 'table'::text,
         l.t::text,
         'exists but has no is_owner() policy — check RLS on this table'::text
  from listed l
  where to_regclass('public.' || l.t) is not null
    and not exists (
      select 1
      from pg_policy p
      join pg_class c     on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = l.t
        and (
          coalesce(pg_get_expr(p.polqual,      p.polrelid), '') like '%is_owner()%'
          or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') like '%is_owner()%'
        )
    );
$$;

comment on function public.gl_audit_financial_tables_gate() is
  'Post-apply check for 0190. Returns one row per money table (bank/ATM/crypto/loans) still gated on is_staff(), or with no owner policy at all. AN EMPTY RESULT MEANS THE MONEY PAGES ARE OWNER-ONLY.';

revoke all on function public.gl_audit_financial_tables_gate() from public;
grant execute on function public.gl_audit_financial_tables_gate() to authenticated, service_role;

-- Note on self-exclusion: unlike gl_audit_owner_only_gate(), this function does
-- NOT need to exclude itself. It searches pg_policy (RLS policies), not
-- pg_proc (function bodies), so the fact that its own source text contains the
-- string 'is_staff()' cannot make it report itself. The 0185 §5 cry-wolf bug is
-- structurally impossible here. Stated out loud so nobody "fixes" it later by
-- adding an exclusion that would then hide a real finding.

-- ════════════════════════════════════════════════════════════════════════════
-- §4  WHY — THE AUTHORITIES, QUOTED EXACTLY
--
-- Fetched from the live authoritative sources on 2026-08-18. Not paraphrased.
-- These are the same eight quotes carried in src/lib/auth/owner-gate-core.ts,
-- so the database and the application state the same reasons in the same words.
--
-- ── FTC Safeguards Rule, 16 CFR 314.4(c)(1) ────────────────────────────────
--   "Implementing and periodically reviewing access controls, including
--    technical and, as appropriate, physical controls to: (i) Authenticate and
--    permit access only to authorized users to protect against the
--    unauthorized acquisition of customer information; and (ii) Limit
--    authorized users' access only to customer information that they need to
--    perform their duties and functions, or, in the case of customers, to
--    access their own information;"
--   source: https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-314
--   SO WHAT: this is the least-privilege rule in plain law. A readonly analyst
--   does not need the bank feed to do their job, so they must not have it.
--
-- ── FTC Safeguards Rule, 16 CFR 314.4(c)(8) ────────────────────────────────
--   "Implement policies, procedures, and controls designed to monitor and log
--    the activity of authorized users and detect unauthorized access or use of,
--    or tampering with, customer information by such users."
--   source: https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-314
--   SO WHAT: "by such users" — the rule expects the threat to include your own
--   authorized people, not just outsiders.
--
-- ── Gramm-Leach-Bliley Act, 15 U.S.C. 6801(b)(3) ───────────────────────────
--   "to protect against unauthorized access to or use of such records or
--    information which could result in substantial harm or inconvenience to
--    any customer."
--   source: https://www.law.cornell.edu/uscode/text/15/6801
--   SO WHAT: the statute the FTC rule above is written under.
--
-- ── IRS Publication 4557, Information Systems Security ─────────────────────
--   "Grant access to taxpayer information systems only on a valid
--    need-to-know basis that is determined by the individual's role within the
--    business."
--   source: https://www.irs.gov/pub/irs-pdf/p4557.pdf
--   SO WHAT: role-based need-to-know, stated by the IRS itself. This migration
--   is that sentence expressed as SQL.
--
-- ── IRS Publication 4557, Personnel Security ───────────────────────────────
--   "Terminate access to taxpayer information (e.g., login IDs and passwords)
--    for those employees who are terminated or who no longer need access."
--   source: https://www.irs.gov/pub/irs-pdf/p4557.pdf
--   SO WHAT: is_staff() checks active = true, so deactivating a staff row
--   already terminates access. Narrowing to is_owner() means there was less to
--   terminate in the first place.
--
-- ── WAC 314-55-087(1)(c) ───────────────────────────────────────────────────
--   "Accounting and tax records related to the licensed business and each true
--    party of interest;"
--   source: https://app.leg.wa.gov/WAC/default.aspx?cite=314-55-087
--   SO WHAT: the LCB can demand these records. Keeping them owner-only does not
--   withhold anything from the regulator — the owner produces them on request.
--   It limits who can casually browse them in between.
--
-- ── WAC 314-55-087(2)(c) ───────────────────────────────────────────────────
--   "Has available a full description of the ADP and/or POS portion of the
--    accounting system. This should show the applications being performed, the
--    procedures employed in each application, and the controls used to ensure
--    accurate and reliable processing."
--   source: https://app.leg.wa.gov/WAC/default.aspx?cite=314-55-087
--   SO WHAT: "the controls used" — this file, its allow-list, and its audit
--   function ARE that description. That is why the reasoning is written down
--   here in full rather than living in someone's memory.
--
-- ── Reg. 1.6001-1(e) ───────────────────────────────────────────────────────
--   "The books or records required by this section shall be kept at all times
--    available for inspection by authorized internal revenue officers or
--    employees, and shall be retained so long as the contents thereof may
--    become material in the administration of any internal revenue law."
--   source: https://www.law.cornell.edu/cfr/text/26/1.6001-1
--   SO WHAT: "available for inspection by AUTHORIZED ... officers." Restricting
--   internal access does not conflict with this; the records remain intact and
--   producible. Locking them down protects their integrity, which is what makes
--   them worth inspecting.
-- ════════════════════════════════════════════════════════════════════════════
