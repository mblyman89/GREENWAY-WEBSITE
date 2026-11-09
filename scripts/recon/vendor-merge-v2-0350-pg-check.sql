-- scripts/recon/vendor-merge-v2-0350-pg-check.sql  (D220 - migration 0350)
--
-- Scenario check for 0350_vendor_merge_v2.sql on Postgres 15 with every migration applied.
-- ONE transaction, rolled back: nothing remains.
--   * 0350 applies twice (idempotent);
--   * a card archived by the OLD merge (0104 note only) gets merged_into_id from its note when 0350
--     runs, and the lots / manifests / catalog drafts left on it are swept to the survivor;
--   * a manifest moved off a duplicate keeps the duplicate's license (raw_payload.from_license_number),
--     and a manifest that already names its sending license is left as it is;
--   * chains resolve (D -> C -> A gives A) and a brand-new lot / manifest / draft written against a
--     merged card lands on the survivor (trigger);
--   * merge_vendors_v2 repoints the tables 0104 never knew (catalog_product_drafts, vendor_platform_map,
--     noncannabis_invoices ...), moves gl_vendor_profiles only when the survivor has none, stamps
--     merged_into_id, archives the duplicate, and reports (never moves) a guarded table;
--   * refused: an archived survivor, a merged survivor, a duplicate merged into a different card,
--     the survivor listed as its own duplicate;
--   * the rollback removes the columns / functions / triggers, and 0350 applies again after it.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/vendor-merge-v2-0350-pg-check.sql
--
-- "VENDOR MERGE V2 0350 CHECK PASSED" then ROLLBACK = all clear.
begin;

\i supabase/migrations/0350_vendor_merge_v2.sql
\i supabase/migrations/0350_vendor_merge_v2.sql

create temp table _c0350 (k text primary key, v uuid);

-- An old-style merge (0104 note only, no merged_into_id) with rows still on the archived card.
do $$
declare
  a uuid; c uuid; d uuid; m1 uuid; m2 uuid;
begin
  insert into public.vendors (display_name, slug, license_number, status)
    values ('__0350 Survivor A__', '__0350-a', '400001', 'draft') returning id into a;
  insert into public.vendors (display_name, slug, license_number, status, internal_notes)
    values ('__0350 Old dup C__', '__0350-c-merged-x', '400002', 'archived',
            format('Imported.' || E'\n' || 'Merged into "__0350 Survivor A__" (%s) on 2026-07-26.', a))
    returning id into c;
  insert into public.vendors (display_name, slug, license_number, status, internal_notes)
    values ('__0350 Older dup D__', '__0350-d-merged-x', '400003', 'archived',
            format('Merged into "__0350 Old dup C__" (%s) on 2026-07-20.', c))
    returning id into d;

  -- Rows written while the trigger did not exist yet: disable it for this setup only.
  alter table public.inventory_lots disable trigger trg_vendor_follow_merge;
  alter table public.inbound_manifests disable trigger trg_vendor_follow_merge;
  alter table public.catalog_product_drafts disable trigger trg_vendor_follow_merge;
  insert into public.inbound_manifests (vendor_id, raw_payload) values (c, '{}'::jsonb) returning id into m1;
  insert into public.inbound_manifests (vendor_id, raw_payload) values (c, '{"from_license_number":"499999"}'::jsonb) returning id into m2;
  insert into public.inventory_lots (vendor_id, manifest_id) values (c, m1);
  insert into public.inventory_lots (vendor_id) values (d);
  insert into public.catalog_product_drafts (vendor_id) values (c);
  alter table public.inventory_lots enable trigger trg_vendor_follow_merge;
  alter table public.inbound_manifests enable trigger trg_vendor_follow_merge;
  alter table public.catalog_product_drafts enable trigger trg_vendor_follow_merge;

  -- Pretend the column was never backfilled for these (0350 ran before they existed).
  update public.vendors set merged_into_id = null, merged_at = null where id in (c, d);

  insert into _c0350 values ('a', a), ('c', c), ('d', d), ('m1', m1), ('m2', m2);
end
$$;

-- Re-running 0350 backfills from the notes and sweeps the rows.
\i supabase/migrations/0350_vendor_merge_v2.sql

do $$
declare
  a uuid := (select v from _c0350 where k = 'a');
  c uuid := (select v from _c0350 where k = 'c');
  d uuid := (select v from _c0350 where k = 'd');
  m1 uuid := (select v from _c0350 where k = 'm1');
  m2 uuid := (select v from _c0350 where k = 'm2');
  new_lot uuid; new_m uuid; s jsonb;
begin
  assert (select merged_into_id from public.vendors where id = c) = a, 'C backfilled from its note';
  assert (select merged_into_id from public.vendors where id = d) = c, 'D backfilled from its note';
  assert (select merged_at::date from public.vendors where id = c) = date '2026-07-26', 'merged_at from the note';
  assert public.vendor_survivor_id(d) = a, 'chain D -> C -> A';
  assert public.vendor_survivor_id(a) = a, 'a live card is its own survivor';
  assert public.vendor_survivor_id(null) is null, 'null in, null out';

  assert (select count(*) from public.inventory_lots where vendor_id in (c, d)) = 0, 'no lots left on merged cards';
  assert (select count(*) from public.inventory_lots where vendor_id = a) = 2, 'both lots on the survivor';
  assert (select count(*) from public.catalog_product_drafts where vendor_id = a) = 1, 'catalog draft swept';
  assert (select vendor_id from public.inbound_manifests where id = m1) = a, 'manifest swept';
  assert (select raw_payload->>'from_license_number' from public.inbound_manifests where id = m1) = '400002',
    'moved manifest keeps the old card''s license for CCRS';
  assert (select raw_payload->>'from_license_number' from public.inbound_manifests where id = m2) = '499999',
    'a manifest that names its own license is untouched';

  -- New writes against a merged card land on the survivor.
  insert into public.inventory_lots (vendor_id) values (d) returning id into new_lot;
  assert (select vendor_id from public.inventory_lots where id = new_lot) = a, 'new lot follows the merge';
  insert into public.inbound_manifests (vendor_id, raw_payload) values (c, '{}'::jsonb) returning id into new_m;
  assert (select vendor_id from public.inbound_manifests where id = new_m) = a, 'new manifest follows the merge';
  assert (select raw_payload->>'from_license_number' from public.inbound_manifests where id = new_m) = '400002',
    'new manifest keeps the merged card''s license';
  update public.inventory_lots set vendor_id = c where id = new_lot;
  assert (select vendor_id from public.inventory_lots where id = new_lot) = a, 'an update to a merged card follows too';

  s := public.sweep_merged_vendor_rows();
  assert (s->>'rows_moved')::integer = 0, 'second sweep finds nothing';
end
$$;

-- merge_vendors_v2 on two live cards.
do $$
declare
  a  uuid := (select v from _c0350 where k = 'a');
  c  uuid := (select v from _c0350 where k = 'c');
  e  uuid; f uuid; g uuid; r jsonb;
begin
  insert into public.vendors (display_name, slug, license_number, status, website)
    values ('__0350 E survivor__', '__0350-e', '400010', 'published', null) returning id into e;
  insert into public.vendors (display_name, slug, license_number, status, website, legal_name)
    values ('__0350 F dup__', '__0350-f', '400011', 'published', 'https://f.example', 'F Legal LLC') returning id into f;
  insert into public.vendors (display_name, slug, status) values ('__0350 G other__', '__0350-g', 'draft') returning id into g;

  insert into public.catalog_product_drafts (vendor_id) values (f);
  insert into public.vendor_platform_map (vendor_id, vendor_key, platform) values (f, '__0350 f key__', 'leaflink');
  insert into public.gl_vendor_profiles (vendor_id) values (f);
  insert into public.inbound_manifests (vendor_id, raw_payload) values (f, '{}'::jsonb);
  insert into public.ai_suggestions (entity_type, entity_id, field_key, suggested_value, status)
    values ('vendor', f::text, 'about', 'x', 'pending');

  r := public.merge_vendors_v2(e, array[f]);
  assert (r->>'ok')::boolean, 'v2 ok';
  assert (r->>'version')::integer = 2, 'v2 reports its version';
  assert (r->'tables'->>'catalog_product_drafts')::integer = 1, 'catalog drafts repointed (0104 missed these)';
  assert (r->'tables'->>'vendor_platform_map')::integer = 1, 'platform map repointed (0104 missed these)';
  assert (r->'tables'->>'gl_vendor_profiles')::integer = 1, 'gl profile moved (survivor had none)';
  assert (r->'tables'->>'ai_suggestions')::integer = 1, 'drafts follow';
  assert (r->'tables'->>'inbound_manifests_license_stamped')::integer = 1, 'license stamped before the move';
  assert (select merged_into_id from public.vendors where id = f) = e, 'merged_into_id stamped';
  assert (select status::text from public.vendors where id = f) = 'archived', 'duplicate archived';
  assert (select website from public.vendors where id = e) = 'https://f.example', 'gap-filled website';
  assert (select legal_name from public.vendors where id = e) = 'F Legal LLC', 'gap-filled legal name';
  assert exists (select 1 from public.vendor_aliases where vendor_id = e and source_name = 'license:400011'), 'license alias kept';

  -- Re-running the same merge is harmless and does not double the notes.
  r := public.merge_vendors_v2(e, array[f]);
  assert (r->>'total_rows_repointed')::integer = 0, 're-run moves nothing';
  assert (select count(*) from regexp_matches((select internal_notes from public.vendors where id = f), 'Merged into', 'g')) = 1,
    'note not doubled on the duplicate';

  -- A second dup with its own GL profile: survivor already has one, so it stays and is reported.
  update public.vendors set merged_into_id = null where id = g;
  insert into public.gl_vendor_profiles (vendor_id) values (g);
  r := public.merge_vendors_v2(e, array[g]);
  assert (r->'needs_attention'->>'gl_vendor_profiles')::integer = 1, 'second GL profile reported, not forced';
  assert exists (select 1 from public.gl_vendor_profiles where vendor_id = g), 'second GL profile left in place';

  -- Refusals.
  begin
    perform public.merge_vendors_v2(c, array[g]);
    raise exception 'TEST_FAILED: merged survivor accepted';
  exception when raise_exception then
    if sqlerrm like 'TEST_FAILED%' then raise; end if;
  end;
  begin
    perform public.merge_vendors_v2(f, array[a]);
    raise exception 'TEST_FAILED: archived survivor accepted';
  exception when raise_exception then
    if sqlerrm like 'TEST_FAILED%' then raise; end if;
  end;
  begin
    perform public.merge_vendors_v2(a, array[f]);
    raise exception 'TEST_FAILED: duplicate already merged elsewhere accepted';
  exception when raise_exception then
    if sqlerrm like 'TEST_FAILED%' then raise; end if;
  end;
  begin
    perform public.merge_vendors_v2(a, array[a]);
    raise exception 'TEST_FAILED: survivor as its own duplicate accepted';
  exception when raise_exception then
    if sqlerrm like 'TEST_FAILED%' then raise; end if;
  end;
  begin
    update public.vendors set merged_into_id = id where id = a;
    raise exception 'TEST_FAILED: self-merge accepted';
  exception when check_violation then null;
  end;
end
$$;

-- Grants: functions are server-only.
do $$
begin
  assert has_function_privilege('service_role', 'public.merge_vendors_v2(uuid, uuid[])', 'execute'), 'service_role may merge';
  assert not has_function_privilege('anon', 'public.merge_vendors_v2(uuid, uuid[])', 'execute'), 'anon may not merge';
  assert not has_function_privilege('authenticated', 'public.sweep_merged_vendor_rows()', 'execute'), 'authenticated may not sweep';
end
$$;

-- Rollback, then 0350 again.
\i supabase/rollbacks/0350_vendor_merge_v2.rollback.sql
do $$
begin
  assert not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'vendors' and column_name = 'merged_into_id'),
    'rollback drops merged_into_id';
  assert to_regprocedure('public.merge_vendors_v2(uuid, uuid[])') is null, 'rollback drops merge_vendors_v2';
  assert to_regprocedure('public.merge_vendors(uuid, uuid[])') is not null, '0104 merge_vendors still there';
  assert not exists (select 1 from pg_trigger where tgname = 'trg_vendor_follow_merge'), 'rollback drops the triggers';
end
$$;
\i supabase/migrations/0350_vendor_merge_v2.sql
do $$
begin
  assert (select merged_into_id from public.vendors where slug = '__0350-c-merged-x')
       = (select id from public.vendors where slug = '__0350-a'), 're-apply restores merged_into_id from the notes';
  raise notice 'VENDOR MERGE V2 0350 CHECK PASSED';
end
$$;

rollback;
