-- scripts/r36/dismiss-duplicate.selftest.sql  (R36 #2)
-- Runs against a scratch database with all migrations applied:
--   psql -v ON_ERROR_STOP=1 -d greenway -f scripts/r36/dismiss-duplicate.selftest.sql
-- Everything happens inside ONE transaction that is ROLLED BACK at the end,
-- so it never leaves data behind. Every assertion raises on failure.
begin;

-- fixtures: the owner's pair (same transfer, same vendor), + a stranger.
insert into public.inbound_manifests (id, manifest_number, vendor_label, status, created_at, dedupe_key,
  invoice_number_detected, invoice_number_source, driver_name, eta_date)
values
  ('00000000-0000-0000-0000-0000000000a1', '0000020830', 'QGT', 'in_transit', now() - interval '10 seconds', null,
   null, null, 'Kept Driver', null),
  -- the duplicate HOLDS the key (it won the insert race); the kept row is an
  -- older row staged before 0255, so it has none.
  ('00000000-0000-0000-0000-0000000000b2', '0000020830 ', 'qgt', 'in_transit', now(), '0000020830|QGT',
   '20636', 'invoice-pdf', 'Dup Driver', '2026-08-10'),
  ('00000000-0000-0000-0000-0000000000c3', '999', 'Other', 'in_transit', now(), null, null, null, null, null),
  ('00000000-0000-0000-0000-0000000000d4', '0000020830', 'QGT', 'accepted', now(), null, null, null, null, null);

insert into public.lab_results (id, labtest_external_identifier, lab_name) values
  ('00000000-0000-0000-0000-00000000aa01', 'L1', 'Confidence Analytics'),
  ('00000000-0000-0000-0000-00000000aa02', 'L2', 'Confidence Analytics');
update public.lab_results set coa_storage_path = 'coa/keep.pdf' where id = '00000000-0000-0000-0000-00000000aa02';

insert into public.inventory_lots (id, manifest_id, lab_result_id, product_name, received_qty, on_hand_qty, status) values
  ('00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-00000000aa01', 'Dup line 1', 10, 0, 'quarantine'),
  ('00000000-0000-0000-0000-00000000bb02', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-00000000aa02', 'Dup line 2', 5, 0, 'rejected'),
  ('00000000-0000-0000-0000-00000000bb03', '00000000-0000-0000-0000-0000000000a1', null, 'Kept line', 10, 0, 'quarantine');

insert into public.manifest_documents (manifest_id, role, filename, storage_path) values
  ('00000000-0000-0000-0000-0000000000b2', 'invoice', 'invoice.pdf', '00000000-0000-0000-0000-0000000000b2/01-invoice.pdf');

insert into public.catalog_product_drafts (id, manifest_id, lot_id, status)
  values ('00000000-0000-0000-0000-00000000cc01', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-00000000bb01', 'draft');

-- REFUSALS (each must raise, and change nothing)
do $$
declare refused int := 0; msg text;
begin
  begin perform public.dismiss_duplicate_manifest('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000b2',null,null);
  exception when others then refused := refused + 1; msg := sqlerrm; assert msg like '%itself%', msg; end;
  begin perform public.dismiss_duplicate_manifest('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000c3',null,null);
  exception when others then refused := refused + 1; assert sqlerrm like '%not the same transfer%', sqlerrm; end;
  begin perform public.dismiss_duplicate_manifest('00000000-0000-0000-0000-0000000000d4','00000000-0000-0000-0000-0000000000a1',null,null);
  exception when others then refused := refused + 1; assert sqlerrm like '%accepted%', sqlerrm; end;
  begin perform public.dismiss_duplicate_manifest('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000ff',null,null);
  exception when others then refused := refused + 1; assert sqlerrm like '%to keep no longer exists%', sqlerrm; end;
  assert refused = 4, format('expected 4 refusals, got %s', refused);
  assert (select count(*) from public.inventory_lots where manifest_id = '00000000-0000-0000-0000-0000000000b2') = 2, 'refusal changed lots';
  raise notice 'PASS refusals (4)';
end $$;

-- a lot with inventory history blocks the dismiss (savepoint so we can undo)
savepoint hist;
insert into public.inventory_adjustments (lot_id, qty_delta, reason) values ('00000000-0000-0000-0000-00000000bb01', 0, 'count');
do $$ begin
  begin perform public.dismiss_duplicate_manifest('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000a1',null,null);
    raise exception 'SHOULD HAVE REFUSED (history)';
  exception when others then assert sqlerrm like '%inventory history%', sqlerrm; end;
  raise notice 'PASS history refusal';
end $$;
rollback to savepoint hist;

-- an active lot blocks it
savepoint act;
update public.inventory_lots set status = 'active' where id = '00000000-0000-0000-0000-00000000bb01';
do $$ begin
  begin perform public.dismiss_duplicate_manifest('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000a1',null,null);
    raise exception 'SHOULD HAVE REFUSED (active)';
  exception when others then assert sqlerrm like '%already in stock%', sqlerrm; end;
  raise notice 'PASS in-stock refusal';
end $$;
rollback to savepoint act;

-- THE HAPPY PATH: dismiss the twin, keep the oldest
do $$
declare r jsonb; k public.inbound_manifests%rowtype; d public.inbound_manifests%rowtype;
begin
  r := public.dismiss_duplicate_manifest('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000a1',null,'test');
  assert (r->>'lots_removed')::int = 2, r::text;
  assert (r->>'labs_removed')::int = 1, 'only the lab with no archived COA is deleted: ' || r::text;
  assert (r->>'drafts_dismissed')::int = 1, r::text;
  assert (r->>'docs_moved')::int = 1, r::text;
  assert (r->>'invoice_carried')::boolean, r::text;
  assert (r->>'transport_fields_carried')::int = 1, 'only eta_date was empty on the kept row: ' || r::text;
  select * into k from public.inbound_manifests where id = '00000000-0000-0000-0000-0000000000a1';
  select * into d from public.inbound_manifests where id = '00000000-0000-0000-0000-0000000000b2';
  assert k.invoice_number_detected = '20636' and k.invoice_number_source = 'invoice-pdf', 'invoice # carried';
  assert k.driver_name = 'Kept Driver', 'fill-only-empty: kept driver not overwritten';
  assert k.eta_date = '2026-08-10', 'empty eta filled';
  assert k.status = 'in_transit', 'kept row untouched status';
  assert d.status = 'dismissed' and d.duplicate_of = k.id and d.dismissed_at is not null, 'dup dismissed';
  assert d.dedupe_key is null, 'dup released its dedupe key';
  assert k.dedupe_key = '0000020830|QGT', 'kept row took over the dedupe key (a later re-send is still guarded)';
  assert (select count(*) from public.inventory_lots where manifest_id = d.id) = 0, 'dup lots gone';
  assert (select count(*) from public.inventory_lots where manifest_id = k.id) = 1, 'kept lots untouched';
  assert (select count(*) from public.lab_results where id = '00000000-0000-0000-0000-00000000aa02') = 1, 'archived-COA lab kept';
  assert (select manifest_id from public.manifest_documents where filename = 'invoice.pdf') = k.id, 'doc moved';
  assert (select status from public.catalog_product_drafts where id = '00000000-0000-0000-0000-00000000cc01') = 'dismissed', 'draft dismissed';
  assert (select count(*) from public.manifest_events where event_type = 'dismissed_duplicate' and manifest_id = d.id) = 1, 'event on dup';
  assert (select count(*) from public.manifest_events where event_type = 'duplicate_merged' and manifest_id = k.id) = 1, 'event on kept';
  -- second dismiss is refused
  begin perform public.dismiss_duplicate_manifest(d.id, k.id, null, null); raise exception 'SHOULD HAVE REFUSED (again)';
  exception when others then assert sqlerrm like '%already dismissed%', sqlerrm; end;
  raise notice 'PASS happy path (%)', r::text;
end $$;

-- dedupe_key: a second LIVE row with the same key is impossible
do $$ begin
  begin
    insert into public.inbound_manifests (manifest_number, vendor_label, status, dedupe_key) values ('0000020830','QGT','pending','0000020830|QGT');
    raise exception 'SHOULD HAVE CONFLICTED';
  exception when unique_violation then
    assert sqlerrm like '%inbound_manifests_dedupe_key_uidx%', sqlerrm;
  end;
  raise notice 'PASS dedupe_key unique (index name in the message: %)', 'inbound_manifests_dedupe_key_uidx';
end $$;

-- identity normalization matches manifest-dedupe-core.buildManifestIdentity
do $$ begin
  assert public.inbound_manifest_identity(' ord-7208 ', 'Lilac   Labs') = 'ORD-7208|LILAC LABS';
  assert public.inbound_manifest_identity('   ', 'X') is null;
  assert public.inbound_manifest_identity(null, 'X') is null;
  assert public.inbound_manifest_identity('A', null) = 'A|';
  -- R36 parity with JS \s (measured: plain PG \s misses U+00A0 under C.UTF-8)
  assert public.inbound_manifest_identity(e'wa\u00a0123', e'acme\u3000farms\ufeff') = 'WA 123|ACME FARMS';
  assert public.inbound_manifest_identity(e'\u2028 x \t\n', e'v\u202f\u205fw') = 'X|V W';
  -- zero-width space is NOT whitespace in JS either - must be kept
  assert public.inbound_manifest_identity(e'a\u200bb', 'v') = e'A\u200bB|V';
  raise notice 'PASS identity normalization';
end $$;

-- delivery claim unique
do $$ begin
  insert into public.inbound_email_log (provider, delivery_key, claimed_at) values ('resend', 'resend:email:x', now());
  begin
    insert into public.inbound_email_log (provider, delivery_key, claimed_at) values ('resend', 'resend:email:x', now());
    raise exception 'SHOULD HAVE CONFLICTED';
  exception when unique_violation then assert sqlerrm like '%inbound_email_log_delivery_key_uidx%', sqlerrm; end;
  raise notice 'PASS delivery_key unique';
end $$;

-- privileges: never callable by anon / authenticated
do $$ begin
  assert not has_function_privilege('anon', 'public.dismiss_duplicate_manifest(uuid,uuid,uuid,text)', 'execute');
  assert not has_function_privilege('authenticated', 'public.dismiss_duplicate_manifest(uuid,uuid,uuid,text)', 'execute');
  assert has_function_privilege('service_role', 'public.dismiss_duplicate_manifest(uuid,uuid,uuid,text)', 'execute');
  raise notice 'PASS privileges';
end $$;

rollback;
\echo DISMISS-DUPLICATE SELFTEST PASSED
