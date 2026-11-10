-- D221 (M5 to M8) post-apply scenario check for 0354_media_library_m5_m8.
-- Run by scripts/compliance/verify-migrations-execute.ts after every
-- migration has been applied. One transaction, rolled back.
--
-- The scenario:
--   * undo auto-publish (one picture, then all) sets them back to draft with
--     publish_reason auto-reverted, and a human-published picture is untouched;
--   * media_auto_publish() does not re-publish an undone picture, nor a draft
--     a person set back (published_at set);
--   * redo puts the undone picture back, but not one flagged for review;
--   * media_similar() finds the same-vendor / same-strain sibling with reasons,
--     never the picture itself, never an archived row;
--   * collections: slug rule, one live slug, archive frees the slug;
--   * the search log and its summary (zero-result searches first);
--   * the new health counters answer; service role only.
\set ON_ERROR_STOP on
begin;

\ir ../../supabase/migrations/0354_media_library_m5_m8.sql

insert into public.vendors (id, display_name, slug, license_number) values
  ('00000000-0000-4000-8000-0000000354a1', 'Similar Farms', 'similar-farms', '419101'),
  ('00000000-0000-4000-8000-0000000354a2', 'Elsewhere Co', 'elsewhere-co', '419102')
on conflict do nothing;

insert into public.media_assets (id, storage_key, filename, mime_type, status, usage_type, title, publish_reason, published_at, review_state, vendor_id, platform, product_name, strain_name, category, role) values
  ('00000000-0000-4000-8000-000000035401', 'product/a354000000000001-a.png', 'a.png', 'image/png', 'published', 'product', 'Blue Dream 3.5g',
   'vendor-source-auto', now(), 'ok', '00000000-0000-4000-8000-0000000354a1', 'cultivera', 'Blue Dream 3.5g', 'Blue Dream', 'flower', 'product'),
  ('00000000-0000-4000-8000-000000035402', 'product/a354000000000002-b.png', 'b.png', 'image/png', 'published', 'product', 'Blue Dream 1g',
   'vendor-source-auto', now(), 'ok', '00000000-0000-4000-8000-0000000354a1', 'cultivera', 'Blue Dream 1g', 'Blue Dream', 'flower', 'product'),
  ('00000000-0000-4000-8000-000000035403', 'product/a354000000000003-c.png', 'c.png', 'image/png', 'published', 'product', 'Typed by a person',
   'human', now(), 'ok', '00000000-0000-4000-8000-0000000354a1', 'upload', 'Gelato', 'Gelato', 'flower', 'product'),
  ('00000000-0000-4000-8000-000000035404', 'product/a354000000000004-d.png', 'd.png', 'image/png', 'draft', 'product', 'Set back by a person',
   null, now() - interval '1 day', 'ok', '00000000-0000-4000-8000-0000000354a1', 'cultivera', 'Sour Diesel', null, 'flower', 'product'),
  ('00000000-0000-4000-8000-000000035405', 'product/a354000000000005-e.png', 'e.png', 'image/png', 'archived', 'product', 'Blue Dream old copy',
   null, null, 'ok', '00000000-0000-4000-8000-0000000354a1', 'cultivera', 'Blue Dream 3.5g', 'Blue Dream', 'flower', 'product'),
  ('00000000-0000-4000-8000-000000035406', 'product/a354000000000006-f.png', 'f.png', 'image/png', 'published', 'product', 'Unrelated thing',
   'vendor-source-auto', now(), 'ok', '00000000-0000-4000-8000-0000000354a2', 'growflow', 'Mango Gummies', null, 'edible', 'product');

do $$
declare
  h jsonb;
  n integer;
  r record;
begin
  -- undo ONE
  h := public.media_set_auto_publish('undo', array['00000000-0000-4000-8000-000000035401'::uuid]);
  if (h->>'changed')::int <> 1 then raise exception 'undo one changed %', h; end if;
  if (select status::text || '/' || publish_reason from public.media_assets where id = '00000000-0000-4000-8000-000000035401') <> 'draft/auto-reverted' then
    raise exception 'undo one did not set draft/auto-reverted';
  end if;
  -- auto-publish must not re-publish the undone picture, nor the one a person set back
  perform public.media_auto_publish();
  if (select status::text from public.media_assets where id = '00000000-0000-4000-8000-000000035401') <> 'draft' then
    raise exception 'auto-publish re-published an undone picture';
  end if;
  if (select status::text from public.media_assets where id = '00000000-0000-4000-8000-000000035404') <> 'draft' then
    raise exception 'auto-publish re-published a picture a person set back to draft';
  end if;
  -- redo refuses a picture now waiting for review
  update public.media_assets set review_state = 'needs_review' where id = '00000000-0000-4000-8000-000000035401';
  h := public.media_set_auto_publish('redo', array['00000000-0000-4000-8000-000000035401'::uuid]);
  if (h->>'changed')::int <> 0 then raise exception 'redo published a picture waiting for review'; end if;
  update public.media_assets set review_state = 'ok' where id = '00000000-0000-4000-8000-000000035401';
  h := public.media_set_auto_publish('redo', array['00000000-0000-4000-8000-000000035401'::uuid]);
  if (h->>'changed')::int <> 1 then raise exception 'redo one changed %', h; end if;
  if (select status::text || '/' || publish_reason from public.media_assets where id = '00000000-0000-4000-8000-000000035401') <> 'published/vendor-source-auto' then
    raise exception 'redo did not restore published/vendor-source-auto';
  end if;
  -- undo ALL leaves the human-published picture alone
  h := public.media_set_auto_publish('undo', null);
  if (select status::text from public.media_assets where id = '00000000-0000-4000-8000-000000035403') <> 'published' then
    raise exception 'undo all touched a human-published picture';
  end if;
  if (select count(*) from public.media_assets where id in ('00000000-0000-4000-8000-000000035401', '00000000-0000-4000-8000-000000035402', '00000000-0000-4000-8000-000000035406') and status = 'draft' and publish_reason = 'auto-reverted') <> 3 then
    raise exception 'undo all missed a picture';
  end if;
  h := public.media_set_auto_publish('redo', null);
  if (select count(*) from public.media_assets where id in ('00000000-0000-4000-8000-000000035401', '00000000-0000-4000-8000-000000035402', '00000000-0000-4000-8000-000000035406') and status = 'published') <> 3 then
    raise exception 'redo all missed a picture';
  end if;
  begin
    perform public.media_set_auto_publish('bogus', null);
    raise exception 'unknown mode accepted';
  exception when raise_exception then
    if sqlerrm = 'unknown mode accepted' then raise; end if;
  end;

  -- find similar
  select count(*) into n from public.media_similar('00000000-0000-4000-8000-000000035401', 24) s
   where s.media_id = '00000000-0000-4000-8000-000000035401';
  if n <> 0 then raise exception 'similar returned the picture itself'; end if;
  select count(*) into n from public.media_similar('00000000-0000-4000-8000-000000035401', 24) s
   where s.media_id = '00000000-0000-4000-8000-000000035405';
  if n <> 0 then raise exception 'similar returned an archived copy'; end if;
  select count(*) into n from public.media_similar('00000000-0000-4000-8000-000000035401', 24) s
   where s.media_id = '00000000-0000-4000-8000-000000035406';
  if n <> 0 then raise exception 'similar returned an unrelated other-vendor picture'; end if;
  select * into r from public.media_similar('00000000-0000-4000-8000-000000035401', 24) s limit 1;
  if r.media_id is distinct from '00000000-0000-4000-8000-000000035402' then raise exception 'best similar is not the sibling: %', r.media_id; end if;
  if not (r.reasons @> array['same-vendor', 'same-strain', 'similar-name']) then raise exception 'similar reasons: %', r.reasons; end if;

  -- collections
  insert into public.media_collections (name, slug, kind) values ('Hero shots', 'hero-shots', 'collection');
  begin
    insert into public.media_collections (name, slug) values ('Hero shots again', 'hero-shots');
    raise exception 'duplicate live slug accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into public.media_collections (name, slug) values ('Bad', 'Bad Slug!');
    raise exception 'bad slug accepted';
  exception when check_violation then null;
  end;
  update public.media_collections set archived_at = now() where slug = 'hero-shots';
  insert into public.media_collections (name, slug, kind) values ('Hero shots v2', 'hero-shots', 'brand-kit');
  insert into public.media_collection_items (collection_id, media_id)
    select c.id, '00000000-0000-4000-8000-000000035401' from public.media_collections c where c.slug = 'hero-shots' and c.archived_at is null;

  -- search log + summary
  insert into public.media_search_log (surface, query, results) values
    ('library', 'blue dream', 4), ('library', 'Blue Dream ', 2), ('picker', 'purple jar', 0);
  begin
    insert into public.media_search_log (surface, query, results) values ('elsewhere', 'x', 0);
    raise exception 'bad surface accepted';
  exception when check_violation then null;
  end;
  select * into r from public.media_search_summary(30) limit 1;
  if r.query <> 'purple jar' or r.zero_hits <> 1 then raise exception 'summary should list the zero-result search first: %', r.query; end if;
  if (select s.searches from public.media_search_summary(30) s where s.query = 'blue dream') <> 2 then
    raise exception 'summary did not group case and spaces';
  end if;

  h := public.media_library_health();
  if not (h ? 'auto_reverted' and h ? 'collections' and h ? 'searches_30d' and h ? 'zero_result_30d' and h ? 'ai_spend_usd') then
    raise exception 'health keys: %', h;
  end if;
  if (h->>'collections')::int < 1 or (h->>'zero_result_30d')::int < 1 then raise exception 'health counts: %', h; end if;
end $$;

-- service role only
do $$
begin
  if has_function_privilege('anon', 'public.media_set_auto_publish(text, uuid[])', 'execute') then
    raise exception 'anon can run media_set_auto_publish';
  end if;
  if has_function_privilege('authenticated', 'public.media_similar(uuid, integer)', 'execute') then
    raise exception 'authenticated can run media_similar';
  end if;
  if not has_function_privilege('service_role', 'public.media_set_auto_publish(text, uuid[])', 'execute')
     or not has_function_privilege('service_role', 'public.media_similar(uuid, integer)', 'execute')
     or not has_function_privilege('service_role', 'public.media_search_summary(integer)', 'execute')
     or not has_function_privilege('service_role', 'public.media_library_health()', 'execute')
     or not has_function_privilege('service_role', 'public.media_auto_publish()', 'execute') then
    raise exception 'service_role is missing an execute grant';
  end if;
  if has_table_privilege('anon', 'public.media_collections', 'select')
     or has_table_privilege('authenticated', 'public.media_search_log', 'select') then
    raise exception 'new tables readable outside the service role';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.media_collections'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.media_collection_items'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.media_search_log'::regclass) then
    raise exception 'row level security is off on a new table';
  end if;
end $$;

-- Rollback then re-apply, so both files are proven.
\ir ../../supabase/rollbacks/0354_media_library_m5_m8.rollback.sql
do $$
begin
  if to_regprocedure('public.media_set_auto_publish(text, uuid[])') is not null then raise exception 'rollback left the function'; end if;
  if to_regclass('public.media_collections') is not null then raise exception 'rollback left the table'; end if;
end $$;
\ir ../../supabase/migrations/0354_media_library_m5_m8.sql

\echo MEDIA LIBRARY M5 0354 CHECK PASSED
rollback;
