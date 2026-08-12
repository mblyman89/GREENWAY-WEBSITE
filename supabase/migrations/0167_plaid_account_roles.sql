-- 0167_plaid_account_roles.sql
-- Widen the allowed account-role values on plaid_accounts.role so Michael has
-- MORE "assign an account" options than the original main/atm/credit.
--
-- Canonical list (kept in lock-step with src/lib/plaid/plaid-core.ts ACCOUNT_ROLES):
--   main, atm, credit, savings, reserve, mortgage, loan, personal
--
-- "main" is load-bearing for reconciliation (vendor-reconcile finds the
-- operating account via role='main') and is preserved. NULL still means
-- "unassigned". This migration only RELAXES the CHECK (adds allowed values),
-- so every existing row remains valid; nothing is dropped or rewritten.
--
-- Robust pattern (same as 0166): the original CHECK in 0157 was created inline
-- and may carry an auto-generated name, so we dynamically DROP whatever CHECK
-- currently guards the `role` column, then ADD an explicitly-named widened one.

do $$
declare
  c record;
begin
  -- Drop any existing CHECK on plaid_accounts that references the `role` column
  -- but does not yet include the new values (idempotent + name-agnostic).
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'plaid_accounts'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%role%'
      and pg_get_constraintdef(con.oid) not ilike '%personal%'
  loop
    execute format('alter table public.plaid_accounts drop constraint %I', c.conname);
  end loop;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'plaid_accounts'
      and con.contype = 'c'
      and con.conname = 'plaid_accounts_role_check'
  ) then
    alter table public.plaid_accounts
      add constraint plaid_accounts_role_check
      check (
        role is null
        or role in (
          'main', 'atm', 'credit', 'savings', 'reserve', 'mortgage', 'loan', 'personal'
        )
      );
  end if;
end $$;
