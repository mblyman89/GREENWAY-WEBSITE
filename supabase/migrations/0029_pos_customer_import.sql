-- 0029_pos_customer_import.sql
-- Slice 11: import the Cultivera customer export. Adds an external id to dedupe
-- against the source system, plus a few captured fields, and a normalized email.
--
-- Idempotent: safe to run more than once.

alter table public.customers
  add column if not exists external_id text;            -- Cultivera "Customer ID"

alter table public.customers
  add column if not exists email_normalized text;       -- lower(trim(email)) for dedupe

alter table public.customers
  add column if not exists city text;

alter table public.customers
  add column if not exists state text;

alter table public.customers
  add column if not exists zip text;

alter table public.customers
  add column if not exists import_source text;          -- e.g. 'cultivera-export'

alter table public.customers
  add column if not exists last_purchase_at timestamptz;

-- Dedupe keys. external_id is unique when present (one row per source customer).
create unique index if not exists customers_external_id_uidx
  on public.customers (external_id)
  where external_id is not null;

create index if not exists customers_email_normalized_idx
  on public.customers (email_normalized);
