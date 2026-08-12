-- 0169_plaid_custom_roles.sql
-- Allow CUSTOM (owner-typed) account roles on plaid_accounts.role, in addition
-- to the 8 built-in roles, while keeping the "one account per role" rule (that
-- rule is enforced in the app, not the DB) and preventing junk values.
--
-- Before: 0167 constrained role to exactly one of
--   main, atm, credit, savings, reserve, mortgage, loan, personal (or NULL).
-- After: role may be NULL (unassigned) OR any short, tidy text key. We REPLACE
-- the fixed value list with a length/charset guard that matches the app's
-- normalizeCustomRoleKey():
--   • lower-case letters, digits, spaces, hyphens, underscores only
--   • 1..32 characters
-- The 8 built-in roles all satisfy this guard, so every existing row stays
-- valid; this migration only RELAXES the constraint.
--
-- "main" remains load-bearing for reconciliation (vendor-reconcile finds the
-- operating account via role='main'); the app reserves the 8 built-in names so
-- a typed custom role can never shadow them. NULL still means "unassigned".
--
-- Name-agnostic drop (same robust pattern as 0166/0167): the CHECK added in
-- 0167 is named plaid_accounts_role_check, but we drop ANY CHECK that guards
-- the role column so this is safe even if the name differs across environments.

do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'plaid_accounts'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%role%'
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
        or (
          char_length(role) between 1 and 32
          and role ~ '^[a-z0-9 _-]+$'
        )
      );
  end if;
end $$;
