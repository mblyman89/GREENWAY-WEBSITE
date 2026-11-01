-- 0335_customer_search.sql  (G-75, owner message 17, D118-D120)
--
-- Owner: "i am having a hard time searching for customers on the front
-- register ... find all matches even if we spell the name partially, or use
-- their last name or phone number, etc. ... the spreadsheet i uploaded has
-- spent and last purchase date, which our system did not pick up ... we get
-- all data from the spreadsheet".
--
-- What this does (safe to re-run):
--   1. Two columns for the Cultivera export columns that were not saved:
--        customers.imported_created_at  <- "Date Created"
--        customers.tax_designations     <- "Tax Designations" (e.g. Veteran)
--      (Total Spent and Last Purchase Date were already saved, in
--      imported_spend_minor_units and last_purchase_at; the screens now show
--      them.)
--   2. pg_trgm trigram indexes so "contains" searches on first name, last
--      name, email and phone digits stay fast with 16,000+ customers.
--   3. public.customer_search_fuzzy(p_query, p_limit): the typo search
--      ("bil mclendon" finds Bill McClendon). Used only when the normal
--      search finds nobody. Server (service_role) only.
--
-- Grants: the new columns inherit the existing customers table grants (no
-- change). The function is revoked from public / anon / authenticated and
-- granted to service_role only.

create extension if not exists pg_trgm;

-- On Supabase pg_trgm may already live in the "extensions" schema, which is
-- on the default search path there; the function pins public + extensions.

alter table public.customers add column if not exists imported_created_at timestamptz;
alter table public.customers add column if not exists tax_designations text;

comment on column public.customers.imported_created_at is
  'G-75 (0335): "Date Created" from the old POS (Cultivera) customer export - when the customer was added there. Null for customers made in this system.';
comment on column public.customers.tax_designations is
  'G-75 (0335): "Tax Designations" from the old POS (Cultivera) customer export, e.g. Veteran. Information for staff only; discounts are still applied at the register after checking ID.';

create index if not exists customers_first_name_trgm_idx on public.customers using gin (first_name gin_trgm_ops);
create index if not exists customers_last_name_trgm_idx on public.customers using gin (last_name gin_trgm_ops);
create index if not exists customers_email_trgm_idx on public.customers using gin (email gin_trgm_ops);
create index if not exists customers_phone_normalized_trgm_idx on public.customers using gin (phone_normalized gin_trgm_ops);

create or replace function public.customer_search_fuzzy(p_query text, p_limit integer default 25)
returns table (customer_id uuid, score real)
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  with q as (
    select lower(btrim(regexp_replace(coalesce(p_query, ''), '\s+', ' ', 'g'))) as t
  ),
  scored as (
    select c.id,
           greatest(
             similarity(lower(c.first_name || ' ' || coalesce(c.last_name, '')), q.t),
             similarity(lower(coalesce(c.last_name, '') || ' ' || c.first_name), q.t),
             word_similarity(q.t, lower(c.first_name || ' ' || coalesce(c.last_name, '')))
           )::real as s
      from public.customers c, q
     where length(q.t) >= 3
  )
  select id, s
    from scored
   where s >= 0.3
   order by s desc, id
   limit least(greatest(coalesce(p_limit, 25), 1), 100);
$$;

comment on function public.customer_search_fuzzy(text, integer) is
  'G-75 (0335): typo-tolerant customer name search (pg_trgm). Returns up to p_limit (max 100) customer ids with a 0..1 similarity score >= 0.3, best first. Server only.';

revoke all on function public.customer_search_fuzzy(text, integer) from public, anon, authenticated;
grant execute on function public.customer_search_fuzzy(text, integer) to service_role;

notify pgrst, 'reload schema';
