-- 0092_sage50_dynamic_buckets.sql
-- ---------------------------------------------------------------------------
-- Owner decision (Model A, detailed categories): track Sage sales by DETAILED
-- category (rosin, cartridges, gummies, ...) instead of only the seven broad
-- types. This migration removes the hard-coded 7-bucket CHECK constraints so
-- the owner can add category buckets from the admin UI. The seven seeded
-- buckets from 0091 are unchanged and keep working.
--
-- Idempotent: drop constraint if exists; safe to run repeatedly.
-- Apply AFTER 0091_sage50_exports.sql.
-- ---------------------------------------------------------------------------

-- 1) sage_category_accounts: allow arbitrary bucket keys.
--    (0091 declared the check inline on the column; Postgres auto-names it
--    <table>_<column>_check.)
alter table public.sage_category_accounts
  drop constraint if exists sage_category_accounts_bucket_check;

-- Enforce a sane key format instead (lowercase slug, 1-40 chars).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'sage_category_accounts_bucket_key_format'
      and conrelid = 'public.sage_category_accounts'::regclass
  ) then
    alter table public.sage_category_accounts
      add constraint sage_category_accounts_bucket_key_format
      check (bucket ~ '^[a-z0-9][a-z0-9_-]{0,39}$');
  end if;
end $$;

-- 2) sage_category_map: same treatment.
alter table public.sage_category_map
  drop constraint if exists sage_category_map_bucket_check;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'sage_category_map_bucket_key_format'
      and conrelid = 'public.sage_category_map'::regclass
  ) then
    alter table public.sage_category_map
      add constraint sage_category_map_bucket_key_format
      check (bucket ~ '^[a-z0-9][a-z0-9_-]{0,39}$');
  end if;
end $$;

comment on table public.sage_category_accounts is
  'Sage 50 category buckets (dynamic since 0092). One row per tracked sales category: customers (01-*/07-*), G/L trio, cannabis flag. Seven broad types seeded by 0091; owner adds detailed categories (rosin, cartridges, ...) from the admin UI.';
