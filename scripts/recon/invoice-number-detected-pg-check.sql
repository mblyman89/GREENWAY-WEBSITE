-- scripts/recon/invoice-number-detected-pg-check.sql  (R26 - migration 0245)
--
-- Scenario check for 0245_manifest_invoice_number_detected.sql against a real
-- Postgres. ONE transaction, rolled back, so it leaves nothing behind. If the
-- base table is missing (a bare build-sandbox database) a minimal stand-in is
-- created first inside the same transaction. Applies the migration TWICE
-- (idempotency), proves both columns are nullable text with their comments,
-- that an existing row keeps NULL (no backfill), that the writer's update
-- shape works, then applies the rollback and proves both columns are gone and
-- the row survives. A run that prints INVOICE NUMBER DETECTED CHECK PASSED
-- then ROLLBACK is the all-clear.
--
--   sudo -u postgres psql -d greenway -v ON_ERROR_STOP=1 \
--     -f scripts/recon/invoice-number-detected-pg-check.sql
begin;

create table if not exists public.inbound_manifests (
  id uuid primary key default gen_random_uuid(),
  manifest_number text,
  invoice_number_override text,
  updated_by uuid
);

insert into public.inbound_manifests (id, manifest_number)
values ('00000000-0000-4000-8000-000000000245', '15410217973875889');

\i supabase/migrations/0245_manifest_invoice_number_detected.sql
\i supabase/migrations/0245_manifest_invoice_number_detected.sql

do $$
declare
  n int;
  v text;
  s text;
begin
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'inbound_manifests'
     and column_name in ('invoice_number_detected', 'invoice_number_source')
     and data_type = 'text' and is_nullable = 'YES';
  assert n = 2, 'both columns must be nullable text (got ' || n || ')';

  select count(*) into n from pg_description d
    join pg_attribute a on a.attrelid = d.objoid and a.attnum = d.objsubid
   where d.objoid = 'public.inbound_manifests'::regclass
     and a.attname in ('invoice_number_detected', 'invoice_number_source');
  assert n = 2, 'both columns must carry a comment (got ' || n || ')';

  select invoice_number_detected, invoice_number_source into v, s
    from public.inbound_manifests where id = '00000000-0000-4000-8000-000000000245';
  assert v is null and s is null, 'an existing row must stay NULL (no backfill)';

  -- the writer's (intake-store.recordInvoiceNumberDetected) update shape
  update public.inbound_manifests
     set invoice_number_detected = '20636',
         invoice_number_source = 'invoice:vision+layer:QGT_FreddysFuego_INVOICE.pdf'
   where id = '00000000-0000-4000-8000-000000000245';
  select invoice_number_detected into v from public.inbound_manifests
   where id = '00000000-0000-4000-8000-000000000245';
  assert v = '20636', 'writer update must persist';
end $$;

\i supabase/rollbacks/0245_manifest_invoice_number_detected.rollback.sql

do $$
declare
  n int;
begin
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'inbound_manifests'
     and column_name in ('invoice_number_detected', 'invoice_number_source');
  assert n = 0, 'rollback must drop both columns (got ' || n || ')';
  select count(*) into n from public.inbound_manifests
   where id = '00000000-0000-4000-8000-000000000245' and manifest_number = '15410217973875889';
  assert n = 1, 'rollback must keep the row';
  raise notice 'INVOICE NUMBER DETECTED CHECK PASSED';
end $$;

rollback;
