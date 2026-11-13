-- D241 post-apply scenario check for 0364_budalerts_menus.
-- Run by scripts/compliance/verify-migrations-execute.ts after every
-- migration has been applied. One transaction, rolled back.
--
-- The scenario:
--   * a vendor links a Budalerts brand slug, twice is refused, a bad slug is refused;
--   * a pull with two listings (money in cents), duplicate product refused;
--   * negative price and out-of-range percent refused, unknown status refused;
--   * deleting the pull deletes its listings, deleting the vendor its links;
--   * the fetch state holds exactly one row;
--   * service role only, RLS on;
--   * rollback drops the tables, then re-apply runs.
\set ON_ERROR_STOP on
begin;

insert into public.vendors (id, display_name, slug) values ('00000000-0000-4000-8000-000000036401', 'Budalerts Check Vendor', 'budalerts-check-0364');

insert into public.budalerts_brand_links (vendor_id, slug, brand_name)
  values ('00000000-0000-4000-8000-000000036401', 'phat-panda', 'Phat Panda');

do $$
declare ok boolean;
begin
  ok := false;
  begin
    insert into public.budalerts_brand_links (vendor_id, slug) values ('00000000-0000-4000-8000-000000036401', 'phat-panda');
  exception when unique_violation then ok := true;
  end;
  assert ok, 'same link twice refused';
  ok := false;
  begin
    insert into public.budalerts_brand_links (vendor_id, slug) values ('00000000-0000-4000-8000-000000036401', 'Bad Slug');
  exception when check_violation then ok := true;
  end;
  assert ok, 'bad slug refused';
end
$$;

insert into public.budalerts_brand_snapshots (id, slug, brand_name, status, item_count, image_count, listing_count, pages_fetched)
  values ('00000000-0000-4000-8000-000000036411', 'phat-panda', 'Phat Panda', 'fetched', 2, 1, 744, 4);

insert into public.budalerts_menu_items (snapshot_id, product_id, name, price_minor, price_per_gram_minor, below_similar_pct, size_label, seen_on, position) values
  ('00000000-0000-4000-8000-000000036411', 'm9702zvp5cxet796xmq8kkrwmh8hy7gx', 'Wedding Sunset', 3000, 423, 40, '1/4oz', array['all', 'flower'], 0),
  ('00000000-0000-4000-8000-000000036411', 'm9700r4rzw07t0ssnxqbbfz7f58hy09e', 'Jack Herer', 1000, null, 50, null, array['all'], 1);

do $$
declare ok boolean;
begin
  assert (select sum(price_minor) from public.budalerts_menu_items where snapshot_id = '00000000-0000-4000-8000-000000036411') = 4000, 'cents stored';
  ok := false;
  begin
    insert into public.budalerts_menu_items (snapshot_id, product_id, name) values ('00000000-0000-4000-8000-000000036411', 'm9700r4rzw07t0ssnxqbbfz7f58hy09e', 'dup');
  exception when unique_violation then ok := true;
  end;
  assert ok, 'duplicate product in one pull refused';
  ok := false;
  begin
    insert into public.budalerts_menu_items (snapshot_id, product_id, name, price_minor) values ('00000000-0000-4000-8000-000000036411', 'mneg0000000000', 'neg', -1);
  exception when check_violation then ok := true;
  end;
  assert ok, 'negative price refused';
  ok := false;
  begin
    insert into public.budalerts_menu_items (snapshot_id, product_id, name, below_similar_pct) values ('00000000-0000-4000-8000-000000036411', 'mpct0000000000', 'pct', 101);
  exception when check_violation then ok := true;
  end;
  assert ok, 'percent over 100 refused';
  ok := false;
  begin
    insert into public.budalerts_brand_snapshots (slug, status) values ('phat-panda', 'weird');
  exception when check_violation then ok := true;
  end;
  assert ok, 'unknown status refused';
  ok := false;
  begin
    insert into public.budalerts_fetch_state (id) values (2);
  exception when check_violation then ok := true;
  end;
  assert ok, 'fetch state is one row';
  assert (select count(*) from public.budalerts_fetch_state) = 1, 'fetch state seeded';
  assert (select auto_enabled from public.budalerts_fetch_state where id = 1) = false, 'background off by default';
  assert (select relrowsecurity from pg_class where oid = 'public.budalerts_menu_items'::regclass), 'RLS on items';
  assert (select relrowsecurity from pg_class where oid = 'public.budalerts_brand_links'::regclass), 'RLS on links';
  assert not has_table_privilege('anon', 'public.budalerts_menu_items', 'select'), 'anon cannot read items';
  assert not has_table_privilege('authenticated', 'public.budalerts_brand_snapshots', 'select'), 'authenticated cannot read pulls';
  assert has_table_privilege('service_role', 'public.budalerts_fetch_state', 'update'), 'service role updates state';
end
$$;

delete from public.budalerts_brand_snapshots where id = '00000000-0000-4000-8000-000000036411';
delete from public.vendors where id = '00000000-0000-4000-8000-000000036401';
do $$
begin
  assert (select count(*) from public.budalerts_menu_items where snapshot_id = '00000000-0000-4000-8000-000000036411') = 0, 'listings go with the pull';
  assert (select count(*) from public.budalerts_brand_links where vendor_id = '00000000-0000-4000-8000-000000036401') = 0, 'links go with the vendor';
end
$$;

\ir ../../supabase/rollbacks/0364_budalerts_menus.rollback.sql
do $$
begin
  assert to_regclass('public.budalerts_menu_items') is null, 'rollback drops items';
  assert to_regclass('public.budalerts_fetch_state') is null, 'rollback drops state';
end
$$;
\ir ../../supabase/migrations/0364_budalerts_menus.sql
do $$
begin
  assert to_regclass('public.budalerts_brand_links') is not null, 're-apply after rollback';
  raise notice 'BUDALERTS MENUS 0364 CHECK PASSED';
end
$$;

rollback;
